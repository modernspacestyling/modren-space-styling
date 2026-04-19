// Shared Supabase client for admin pages.
// The publishable key is safe to expose in browser JS — it only grants read access via RLS.
// Source: Supabase settings → API Keys (publishable).
(function() {
  const SUPABASE_URL = 'https://wyagfofpthtzcepurswp.supabase.co';
  const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_isSqnRmgSDl3pQigUgh_zg_8ytua13e';

  // Load Supabase SDK from CDN if not already loaded
  function loadSdk() {
    return new Promise((resolve, reject) => {
      if (window.supabase && window.supabase.createClient) { resolve(); return; }
      const s = document.createElement('script');
      s.src = '/admin/supabase.min.js';
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('Failed to load Supabase SDK'));
      document.head.appendChild(s);
    });
  }

  window.MSSAuth = {
    _client: null,
    async client() {
      if (this._client) return this._client;
      await loadSdk();
      this._client = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
          storage: window.localStorage,
          storageKey: 'mss_sb_auth',
        }
      });
      return this._client;
    },

    // Compat shim: populate legacy sessionStorage used by existing admin pages.
    // This allows the old Auth.requireAdmin() checks to pass without touching every admin file.
    async syncLegacySession(user) {
      try {
        const session = user ? {
          id: user.id,
          email: user.email,
          name: (user.email || '').split('@')[0],
          role: 'admin',
          loggedInAt: new Date().toISOString()
        } : null;
        if (session) {
          sessionStorage.setItem('mss_session', JSON.stringify(session));
          // Also seed the legacy users record so app.js lookups work
          const users = JSON.parse(localStorage.getItem('mss_users') || '[]');
          if (!users.find(u => u.email === user.email)) {
            users.push({
              id: user.id, email: user.email, name: session.name,
              role: 'admin', status: 'approved'
            });
            localStorage.setItem('mss_users', JSON.stringify(users));
          }
        } else {
          sessionStorage.removeItem('mss_session');
        }
      } catch (e) { /* ignore */ }
    },

    async getSession() {
      const c = await this.client();
      const { data } = await c.auth.getSession();
      return data.session;
    },

    async signIn(email, password) {
      const c = await this.client();
      const { data, error } = await c.auth.signInWithPassword({ email, password });
      if (error) throw error;
      await this.syncLegacySession(data.user);
      return data;
    },

    async signOut() {
      const c = await this.client();
      await c.auth.signOut();
      await this.syncLegacySession(null);
    },

    async resetPassword(email) {
      const c = await this.client();
      const { error } = await c.auth.resetPasswordForEmail(email, {
        redirectTo: 'https://www.modernspacestyling.com.au/admin/reset.html'
      });
      if (error) throw error;
    },

    async updatePassword(newPassword) {
      const c = await this.client();
      const { data, error } = await c.auth.updateUser({ password: newPassword });
      if (error) throw error;
      return data;
    },

    async requireAdmin(redirectUrl) {
      const session = await this.getSession();
      if (!session) {
        window.location.href = redirectUrl || 'login.html';
        return null;
      }
      await this.syncLegacySession(session.user);
      return session.user;
    },

    async currentUser() {
      const session = await this.getSession();
      return session ? session.user : null;
    },

    // Auto-inject "My Account" + "Logout" links into any admin page's sidebar.
    // Runs on DOMContentLoaded — pages already include this script so no edits needed elsewhere.
    injectAccountLinks() {
      try {
        const sidebar = document.querySelector('.sidebar');
        if (!sidebar) return;
        // Don't duplicate if we're on profile.html or if link already exists
        if (sidebar.querySelector('[data-mss-profile-link]')) return;

        // Find Management section or sidebar-footer to inject into
        const footer = sidebar.querySelector('.sidebar-footer');
        const mgmtSection = Array.from(sidebar.querySelectorAll('.sidebar-section-label'))
          .find(el => (el.textContent || '').trim().toLowerCase() === 'management');
        const isActiveProfile = /\/admin\/profile\.html/.test(location.pathname);

        // 1. Add "My Account" link to Management section (if not already there)
        if (mgmtSection && !sidebar.querySelector('a[href="profile.html"]')) {
          const link = document.createElement('a');
          link.className = 'sidebar-link' + (isActiveProfile ? ' active' : '');
          link.href = 'profile.html';
          link.setAttribute('data-mss-profile-link', '1');
          const icon = document.createElement('span');
          icon.className = 'sidebar-icon';
          icon.textContent = '👤';
          link.appendChild(icon);
          link.appendChild(document.createTextNode(' My Account'));
          const section = mgmtSection.parentElement;
          section.appendChild(link);
        }

        // 1b. Add "Manual Booking" link to Main section (right after Bookings)
        const isActiveManual = /\/admin\/manual-booking\.html/.test(location.pathname);
        if (!sidebar.querySelector('a[href="manual-booking.html"]')) {
          const bookingsLink = sidebar.querySelector('a[href="bookings.html"]');
          if (bookingsLink) {
            const mbLink = document.createElement('a');
            mbLink.className = 'sidebar-link' + (isActiveManual ? ' active' : '');
            mbLink.href = 'manual-booking.html';
            mbLink.setAttribute('data-mss-manual-link', '1');
            const mbIcon = document.createElement('span');
            mbIcon.className = 'sidebar-icon';
            mbIcon.textContent = '✍️';
            mbLink.appendChild(mbIcon);
            mbLink.appendChild(document.createTextNode(' Manual Booking'));
            // Insert immediately after Bookings
            bookingsLink.parentNode.insertBefore(mbLink, bookingsLink.nextSibling);
          }
        }

        // 2. Replace any existing "Logout" click handler with Supabase signOut
        const logoutLinks = sidebar.querySelectorAll('a[onclick*="logout"], a[onclick*="Logout"], #logoutLink');
        logoutLinks.forEach(l => {
          l.removeAttribute('onclick');
          l.addEventListener('click', async (e) => {
            e.preventDefault();
            try { await MSSAuth.signOut(); } catch(_) {}
            window.location.href = 'login.html';
          });
        });

        // Update topbar user name/avatar if they exist, using the real Supabase email
        (async () => {
          try {
            const u = await this.currentUser();
            if (!u) return;
            const nm = (u.email || '').split('@')[0];
            const initial = nm.charAt(0).toUpperCase();
            const nameEl = document.getElementById('userName');
            const avEl = document.getElementById('userAvatar');
            if (nameEl) nameEl.textContent = nm;
            if (avEl) avEl.textContent = initial;
          } catch(_) {}
        })();
      } catch(_) { /* ignore */ }
    }
  };

  // Auto-inject sidebar links when DOM is ready (on any page that loads this script)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => window.MSSAuth.injectAccountLinks());
  } else {
    window.MSSAuth.injectAccountLinks();
  }
})();
