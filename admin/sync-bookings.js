// Sync bookings from Supabase into localStorage (KEYS.BOOKINGS = 'mss_bookings')
// before the admin page renders. This makes manual bookings (and any other
// server-side bookings) visible on every device, not just the browser that
// created them.
//
// Strategy: server is source of truth. We REPLACE the localStorage array
// with the server response, then keep any local entries that the server
// doesn't know about (e.g. demo seed data) by merging on jobNumber.
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

  async function syncBookings() {
    try {
      const token = await getAccessToken();
      if (!token) {
        console.warn('[sync-bookings] no access token; skipping server sync');
        return { synced: false, reason: 'no-token' };
      }

      const res = await fetch('/api/admin-list-bookings', {
        method: 'GET',
        headers: { 'Authorization': 'Bearer ' + token }
      });
      if (!res.ok) {
        console.warn('[sync-bookings] server returned', res.status);
        return { synced: false, reason: 'http-' + res.status };
      }
      const json = await res.json();
      if (!json || !Array.isArray(json.bookings)) {
        return { synced: false, reason: 'bad-payload' };
      }

      // Merge: server records take precedence (matched by jobNumber).
      // Any purely-local records (seed data without a jobNumber match) are kept.
      const serverList = json.bookings;
      const serverJobs = new Set(serverList.map(b => b.jobNumber).filter(Boolean));
      let local = [];
      try { local = JSON.parse(localStorage.getItem('mss_bookings') || '[]'); } catch (_) { local = []; }
      const localOnly = local.filter(b => !b.jobNumber || !serverJobs.has(b.jobNumber));
      const merged = [...serverList, ...localOnly];
      localStorage.setItem('mss_bookings', JSON.stringify(merged));
      return { synced: true, serverCount: serverList.length, localOnlyKept: localOnly.length };
    } catch (e) {
      console.warn('[sync-bookings] unexpected error:', e);
      return { synced: false, reason: 'exception' };
    }
  }

  // Expose for explicit calls before rendering.
  window.syncBookingsFromServer = syncBookings;
})();
