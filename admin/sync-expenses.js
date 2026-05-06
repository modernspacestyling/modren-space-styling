// Sync expenses from Supabase into localStorage (KEYS.EXPENSES = 'mss_expenses')
// before admin pages render. Mirrors the bookings-sync pattern so that
// expenses added via Telegram (Mini/Sony) show up on every device, not only
// the browser that created them.
//
// Strategy: server is source of truth. We REPLACE the localStorage array with
// the server response, then keep any purely-local entries the server doesn't
// know about (legacy seed data) by merging on id.
//
// Failure mode: if the API call fails for any reason, we leave localStorage
// untouched — pages still render the old (possibly stale) cached data.

(function() {
  async function getAccessToken() {
    // 1) Try the live Supabase client first.
    try {
      if (window.MSSAuth && typeof window.MSSAuth.client === 'function') {
        const c = await window.MSSAuth.client();
        const sessionRes = await Promise.race([
          c.auth.getSession(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('getSession timeout')), 2500)),
        ]);
        const tok = sessionRes && sessionRes.data && sessionRes.data.session && sessionRes.data.session.access_token;
        if (tok) return tok;
      }
    } catch (_) { /* fall through */ }

    // 2) Fallback: read directly from the persisted Supabase auth blob.
    try {
      const raw = localStorage.getItem('mss_sb_auth');
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return (parsed && (parsed.access_token || (parsed.currentSession && parsed.currentSession.access_token))) || null;
    } catch (_) { return null; }
  }

  async function syncExpenses() {
    try {
      const token = await getAccessToken();
      if (!token) {
        console.warn('[sync-expenses] no access token; skipping server sync');
        return { synced: false, reason: 'no-token' };
      }

      const res = await fetch('/api/admin-list-expenses', {
        method: 'GET',
        headers: { 'Authorization': 'Bearer ' + token },
      });
      if (!res.ok) {
        console.warn('[sync-expenses] server returned', res.status);
        return { synced: false, reason: 'http-' + res.status };
      }
      const json = await res.json();
      if (!json || !Array.isArray(json.expenses)) {
        return { synced: false, reason: 'bad-payload' };
      }

      // Merge: server records take precedence (matched by id).
      // Any purely-local records (entries without a matching id) are kept.
      const serverList = json.expenses;
      const serverIds = new Set(serverList.map(e => e.id).filter(Boolean));
      let local = [];
      try { local = JSON.parse(localStorage.getItem('mss_expenses') || '[]'); } catch (_) { local = []; }
      const localOnly = local.filter(e => !e.id || !serverIds.has(e.id));
      const merged = [...serverList, ...localOnly];
      localStorage.setItem('mss_expenses', JSON.stringify(merged));
      return { synced: true, serverCount: serverList.length, localOnlyKept: localOnly.length };
    } catch (e) {
      console.warn('[sync-expenses] unexpected error:', e);
      return { synced: false, reason: 'exception' };
    }
  }

  window.syncExpensesFromServer = syncExpenses;
})();
