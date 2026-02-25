/**
 * Modern Space Styling — Core Data Layer & Utility Library
 * All data stored in localStorage (no server needed for demo)
 * Replace with real API calls when deploying to production backend
 */

// ============================================================
// STORAGE KEYS
// ============================================================
const KEYS = {
  BOOKINGS: 'mss_bookings',
  AGENTS: 'mss_agents',
  INVENTORY: 'mss_inventory',
  PRICING: 'mss_pricing',
  SMS_LOG: 'mss_sms_log',
  TEAM: 'mss_team',
  TEMPLATES: 'mss_templates',
  ACTIVITY: 'mss_activity',
  USERS: 'mss_users',
  SESSION: 'mss_session',
};

// ============================================================
// ENCRYPTION (AES-256-GCM via Web Crypto API)
// ============================================================
const Crypto = {
  async getKey() {
    const raw = 'MSS_AES_KEY_2026_GEELONG_VIC_PROD'; // In prod: from env
    const enc = new TextEncoder().encode(raw.padEnd(32, '0').slice(0, 32));
    return await window.crypto.subtle.importKey('raw', enc, 'AES-GCM', false, ['encrypt', 'decrypt']);
  },
  async encrypt(text) {
    try {
      const key = await this.getKey();
      const iv = window.crypto.getRandomValues(new Uint8Array(12));
      const enc = new TextEncoder().encode(text);
      const ciphered = await window.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc);
      const buf = new Uint8Array(ciphered);
      const combined = new Uint8Array(iv.length + buf.length);
      combined.set(iv);
      combined.set(buf, iv.length);
      return btoa(String.fromCharCode(...combined));
    } catch { return text; }
  },
  async decrypt(base64) {
    try {
      const key = await this.getKey();
      const combined = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
      const iv = combined.slice(0, 12);
      const data = combined.slice(12);
      const plain = await window.crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
      return new TextDecoder().decode(plain);
    } catch { return base64; }
  },
  hash(str) {
    // Simple SHA-256 via Web Crypto for passwords
    return window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(str))
      .then(buf => Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join(''));
  }
};

// ============================================================
// DATABASE — Generic CRUD
// ============================================================
const DB = {
  get(key) {
    try { return JSON.parse(localStorage.getItem(key)) || []; } catch { return []; }
  },
  set(key, data) {
    localStorage.setItem(key, JSON.stringify(data));
  },
  getOne(key, id) {
    return this.get(key).find(r => r.id === id) || null;
  },
  insert(key, record) {
    const data = this.get(key);
    const newRecord = { ...record, id: record.id || genId(), createdAt: new Date().toISOString() };
    data.push(newRecord);
    this.set(key, data);
    return newRecord;
  },
  update(key, id, changes) {
    const data = this.get(key);
    const idx = data.findIndex(r => r.id === id);
    if (idx < 0) return null;
    data[idx] = { ...data[idx], ...changes, updatedAt: new Date().toISOString() };
    this.set(key, data);
    return data[idx];
  },
  delete(key, id) {
    const data = this.get(key).filter(r => r.id !== id);
    this.set(key, data);
  },
  query(key, predicate) {
    return this.get(key).filter(predicate);
  }
};

// ============================================================
// ID & JOB NUMBER GENERATION
// ============================================================
function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function genJobNumber() {
  const year = new Date().getFullYear();
  const bookings = DB.get(KEYS.BOOKINGS);
  const seq = String(bookings.length + 1).padStart(4, '0');
  return `MSS-${year}-${seq}`;
}

// ============================================================
// SESSION / AUTH
// ============================================================
const Auth = {
  login(user) {
    sessionStorage.setItem(KEYS.SESSION, JSON.stringify(user));
  },
  logout() {
    sessionStorage.removeItem(KEYS.SESSION);
    window.location.href = '/';
  },
  current() {
    try { return JSON.parse(sessionStorage.getItem(KEYS.SESSION)); } catch { return null; }
  },
  isLoggedIn() { return !!this.current(); },
  isAdmin() {
    const u = this.current();
    return u && (u.role === 'admin' || u.role === 'staff');
  },
  isAgent() {
    const u = this.current();
    return u && u.role === 'agent' && u.status === 'approved';
  },
  requireAdmin() {
    if (!this.isAdmin()) { window.location.href = '/admin/login.html'; return false; }
    return true;
  },
  requireAgent() {
    if (!this.isAgent()) { window.location.href = '/portal/login.html'; return false; }
    return true;
  },
};

// ============================================================
// SEED DEFAULT DATA (runs once)
// ============================================================
async function seedDatabase() {
  if (localStorage.getItem('mss_seeded')) return;

  // Admin user (password: Admin@2026)
  const passwordHash = await Crypto.hash('Admin@2026');
  DB.insert(KEYS.USERS, {
    id: 'admin-001',
    email: 'admin@modernspacestyling.com.au',
    password: passwordHash,
    name: 'MSS Admin',
    role: 'admin',
    status: 'approved'
  });

  // Pricing Config — "from approx" indicative rates
  // 3 bed full staging: base 800 + 3×250 + 2×150 + 1×200 + 1×150 = $2,050 ≈ "from $2,000"
  // 4 bed full staging: base 800 + 4×250 + 2×150 + 1×200 + 1×150 = $2,300 ≈ "from $2,500 with decor"
  localStorage.setItem('mss_pricing_config', JSON.stringify({
    basePrice: 800,          // Base 6-week package
    baseWeeks: 6,
    weeklyRate: 200,         // $200/week extension + GST
    travelSurcharge: 50,     // $50 over 50km
    occupiedSurcharge: 300,  // Occupied property surcharge
    bedroomRate: 250,        // Per bedroom
    bathroomRate: 150,       // Per bathroom
    livingRate: 200,         // Per living area
    diningRate: 150,         // Per dining area
    garageRate: 0,           // No garage surcharge by default
    gst: 0.10,               // GST 10%
  }));

  // Inventory
  const inventoryItems = [
    { name: 'Queen Beds', category: 'bedroom', total: 12, available: 12 },
    { name: 'King Beds', category: 'bedroom', total: 8, available: 8 },
    { name: 'Single Beds', category: 'bedroom', total: 6, available: 6 },
    { name: '3-Seat Sofas', category: 'lounge', total: 10, available: 10 },
    { name: '2-Seat Sofas', category: 'lounge', total: 8, available: 8 },
    { name: 'Dining Tables', category: 'dining', total: 8, available: 8 },
    { name: 'Dining Chairs', category: 'dining', total: 40, available: 40 },
    { name: 'Rugs', category: 'decor', total: 15, available: 15 },
    { name: 'Artwork Pieces', category: 'decor', total: 30, available: 30 },
    { name: 'Coffee Tables', category: 'lounge', total: 10, available: 10 },
    { name: 'Outdoor Sets', category: 'outdoor', total: 4, available: 4 },
    { name: 'Decor Items (Box)', category: 'decor', total: 20, available: 20 },
  ];
  inventoryItems.forEach(item => DB.insert(KEYS.INVENTORY, item));

  // SMS Templates
  const templates = [
    { key: 'booking_confirm', name: 'Booking Confirmation', body: 'Hi {agentName}, your staging job {jobNumber} has been confirmed for {address} on {date} at {time}. Lockbox: {lockbox}. Thanks, Modern Space Styling.' },
    { key: 'team_dispatch', name: 'Team Dispatch', body: 'New job {jobNumber} — {address}. Installation: {date} {time}. Lockbox: {lockbox}. Reply CONFIRMED {jobNumber} when acknowledged.' },
    { key: 'job_confirmed', name: 'Job Confirmed by Team', body: 'Hi {agentName}, your staging at {address} ({jobNumber}) has been confirmed by our team. See you on {date}!' },
    { key: 'job_on_way', name: 'Team On The Way', body: 'Hi {agentName}, our team is on their way to {address} for job {jobNumber}.' },
    { key: 'job_completed', name: 'Job Completed', body: 'Hi {agentName}, staging is complete at {address} ({jobNumber}). Staging period ends {endDate}. Modern Space Styling.' },
    { key: 'extension_warn', name: '5-Day Warning', body: 'Hi {agentName}, staging job {jobNumber} at {address} ends in 5 days ({endDate}). Reply EXTEND {jobNumber} 1W or EXTEND {jobNumber} 2W to extend.' },
    { key: 'pickup_ready', name: 'Ready for Pickup', body: 'PICKUP REQUIRED: Job {jobNumber} at {address} staging period has ended. Please arrange pickup.' },
    { key: 'job_extended', name: 'Extension Confirmed', body: 'Hi {agentName}, job {jobNumber} at {address} has been extended. New end date: {endDate}.' },
  ];
  templates.forEach(t => DB.insert(KEYS.TEMPLATES, t));

  // Team Members (verified SMS numbers)
  DB.insert(KEYS.TEAM, { name: 'Team Lead', phone: '+61400000001', role: 'installer', active: true });
  DB.insert(KEYS.TEAM, { name: 'Transport', phone: '+61400000002', role: 'transport', active: true });

  // Sample Booking
  (async () => {
    const lockboxEnc = await Crypto.encrypt('4827');
    DB.insert(KEYS.BOOKINGS, {
      id: 'booking-demo-001',
      jobNumber: 'MSS-2026-0001',
      status: 'confirmed',
      agentName: 'Sarah Mitchell',
      agentEmail: 'sarah@premierproperty.com.au',
      agentPhone: '+61412345678',
      agency: 'Premier Property Geelong',
      address: '42 Bellarine Street, Newtown, VIC 3220',
      installDate: '2026-03-01',
      installTime: '09:00',
      bedrooms: 3,
      bathrooms: 2,
      livingAreas: 1,
      diningAreas: 1,
      garage: true,
      vacant: true,
      lockbox: lockboxEnc,
      notes: 'Brand new build, all white walls.',
      startDate: '2026-03-01',
      endDate: '2026-04-12',
      estimatedPrice: 0,
      createdAt: new Date().toISOString(),
    });
  })();

  localStorage.setItem('mss_seeded', '1');
}

// ============================================================
// PRICING ENGINE
// ============================================================
const Pricing = {
  getConfig() {
    try { return JSON.parse(localStorage.getItem('mss_pricing_config')) || {}; } catch { return {}; }
  },
  saveConfig(config) {
    localStorage.setItem('mss_pricing_config', JSON.stringify(config));
  },
  calculate({ bedrooms = 0, bathrooms = 0, livingAreas = 0, diningAreas = 0, garage = false, vacant = false, travelSurcharge = false, extraWeeks = 0 }) {
    const c = this.getConfig();
    let total = c.basePrice || 0;
    total += (bedrooms || 0) * (c.bedroomRate || 0);
    total += (bathrooms || 0) * (c.bathroomRate || 0);
    total += (livingAreas || 0) * (c.livingRate || 0);
    total += (diningAreas || 0) * (c.diningRate || 0);
    if (garage) total += (c.garageRate || 0);
    if (!vacant) total += (c.occupiedSurcharge || 0);
    if (travelSurcharge) total += (c.travelSurcharge || 50);
    total += (extraWeeks || 0) * (c.weeklyRate || 0);
    return total;
  },
  format(amount) {
    if (!amount || amount === 0) return 'TBD';
    return '$' + amount.toLocaleString('en-AU', { minimumFractionDigits: 2 });
  }
};

// ============================================================
// INVENTORY MANAGER
// ============================================================
const Inventory = {
  getAll() { return DB.get(KEYS.INVENTORY); },
  update(id, data) { return DB.update(KEYS.INVENTORY, id, data); },
  allocateForJob(jobId, allocations) {
    // allocations: [{ inventoryId, qty }]
    allocations.forEach(({ inventoryId, qty }) => {
      const item = DB.getOne(KEYS.INVENTORY, inventoryId);
      if (!item) return;
      DB.update(KEYS.INVENTORY, inventoryId, { available: Math.max(0, item.available - qty) });
      DB.insert('mss_allocations', { jobId, inventoryId, qty });
      logActivity(`Allocated ${qty}x "${item.name}" to job ${jobId}`);
    });
  },
  releaseForJob(jobId) {
    const allocs = DB.query('mss_allocations', a => a.jobId === jobId);
    allocs.forEach(a => {
      const item = DB.getOne(KEYS.INVENTORY, a.inventoryId);
      if (!item) return;
      DB.update(KEYS.INVENTORY, a.inventoryId, { available: item.available + a.qty });
    });
    const remaining = DB.query('mss_allocations', a => a.jobId !== jobId);
    DB.set('mss_allocations', remaining);
    logActivity(`Released inventory for job ${jobId}`);
  },
  getLowStock(threshold = 0.2) {
    return this.getAll().filter(item => item.total > 0 && (item.available / item.total) <= threshold);
  }
};

// ============================================================
// SMS LOGGER
// ============================================================
const SMS = {
  log(direction, to, from, body, jobNumber = null, status = 'sent') {
    DB.insert(KEYS.SMS_LOG, { direction, to, from, body, jobNumber, status, timestamp: new Date().toISOString() });
  },
  parseSmsCommand(body, from) {
    const cleaned = body.trim().toUpperCase();
    const teamMembers = DB.get(KEYS.TEAM);
    const verified = teamMembers.some(m => m.phone === from && m.active);
    if (!verified) return { action: 'UNVERIFIED', from };

    const patterns = [
      { re: /^CONFIRMED\s+(MSS-\d{4}-\d{4})$/, action: 'CONFIRMED' },
      { re: /^ON THE WAY\s+(MSS-\d{4}-\d{4})$/, action: 'ON_THE_WAY' },
      { re: /^ARRIVED\s+(MSS-\d{4}-\d{4})$/, action: 'ARRIVED' },
      { re: /^COMPLETED\s+(MSS-\d{4}-\d{4})$/, action: 'COMPLETED' },
      { re: /^PICKEDUP\s+(MSS-\d{4}-\d{4})$/, action: 'PICKEDUP' },
      { re: /^EXTEND\s+(MSS-\d{4}-\d{4})\s+(1W|2W)$/, action: 'EXTEND' },
    ];

    for (const p of patterns) {
      const m = cleaned.match(p.re);
      if (m) {
        const result = { action: p.action, jobNumber: m[1] };
        if (p.action === 'EXTEND') result.weeks = m[2] === '1W' ? 1 : 2;
        return result;
      }
    }
    return { action: 'UNKNOWN', body: cleaned };
  },
  processInbound(body, from) {
    const parsed = this.parseSmsCommand(body, from);
    this.log('inbound', 'system', from, body, parsed.jobNumber || null, 'received');

    if (parsed.action === 'UNVERIFIED') {
      return { success: false, message: 'Number not verified' };
    }
    if (parsed.action === 'UNKNOWN') {
      return { success: false, message: 'Command not recognised' };
    }

    const statusMap = {
      CONFIRMED: 'confirmed',
      ON_THE_WAY: 'on_the_way',
      ARRIVED: 'arrived',
      COMPLETED: 'active',
      PICKEDUP: 'closed',
    };

    if (parsed.action === 'EXTEND') {
      const booking = DB.query(KEYS.BOOKINGS, b => b.jobNumber === parsed.jobNumber)[0];
      if (!booking) return { success: false, message: 'Job not found' };
      const currentEnd = new Date(booking.endDate);
      currentEnd.setDate(currentEnd.getDate() + parsed.weeks * 7);
      DB.update(KEYS.BOOKINGS, booking.id, { endDate: currentEnd.toISOString().slice(0, 10), status: 'active' });
      logActivity(`Extended job ${parsed.jobNumber} by ${parsed.weeks} week(s)`);
      return { success: true, message: `Job extended. New end date: ${currentEnd.toISOString().slice(0, 10)}` };
    }

    const newStatus = statusMap[parsed.action];
    if (!newStatus) return { success: false, message: 'Unknown action' };

    const booking = DB.query(KEYS.BOOKINGS, b => b.jobNumber === parsed.jobNumber)[0];
    if (!booking) return { success: false, message: 'Job not found' };

    const updates = { status: newStatus };
    if (parsed.action === 'COMPLETED') {
      updates.startDate = new Date().toISOString().slice(0, 10);
      const end = new Date();
      end.setDate(end.getDate() + 42); // 6 weeks
      updates.endDate = end.toISOString().slice(0, 10);
    }
    if (parsed.action === 'PICKEDUP') {
      Inventory.releaseForJob(booking.id);
    }

    DB.update(KEYS.BOOKINGS, booking.id, updates);
    logActivity(`Job ${parsed.jobNumber} status → ${newStatus}`);
    return { success: true, message: `Job ${parsed.jobNumber} updated to ${newStatus}` };
  }
};

// ============================================================
// ACTIVITY LOG
// ============================================================
function logActivity(message, user = 'System') {
  DB.insert(KEYS.ACTIVITY, {
    message,
    user,
    timestamp: new Date().toISOString()
  });
}

// ============================================================
// DATE HELPERS
// ============================================================
const DateUtils = {
  daysUntil(dateStr) {
    const target = new Date(dateStr);
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    target.setHours(0, 0, 0, 0);
    return Math.round((target - now) / 86400000);
  },
  daysAgo(dateStr) {
    return -this.daysUntil(dateStr);
  },
  format(dateStr, opts = {}) {
    if (!dateStr) return '—';
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-AU', {
      day: '2-digit', month: 'short', year: 'numeric', ...opts
    });
  },
  addDays(dateStr, days) {
    const d = new Date(dateStr);
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  },
  countdown(endDate) {
    const days = this.daysUntil(endDate);
    const totalDays = 42; // 6 weeks base
    const pct = Math.max(0, Math.min(100, Math.round((days / totalDays) * 100)));
    let colorClass = 'green';
    if (days <= 5) colorClass = 'red';
    else if (days <= 14) colorClass = 'amber';
    return { days, pct, colorClass };
  }
};

// ============================================================
// DOM HELPERS
// ============================================================
const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

function el(tag, props = {}, ...children) {
  const e = document.createElement(tag);
  Object.entries(props).forEach(([k, v]) => {
    if (k === 'class') e.className = v;
    else if (k === 'html') e.innerHTML = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  });
  children.forEach(c => {
    if (typeof c === 'string') e.appendChild(document.createTextNode(c));
    else if (c) e.appendChild(c);
  });
  return e;
}

// Toast system
function toast(message, type = 'success', duration = 4000) {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = el('div', { id: 'toast-container', class: 'toast-container' });
    document.body.appendChild(container);
  }
  const t = el('div', { class: `toast ${type}` });
  const icons = { success: '✓', error: '✕', warning: '⚠' };
  t.innerHTML = `<span>${icons[type] || '•'}</span> ${message}`;
  container.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transform = 'translateX(20px)'; t.style.transition = '0.3s'; setTimeout(() => t.remove(), 300); }, duration);
}

// Modal control
function openModal(id) { const m = document.getElementById(id); if (m) m.classList.add('open'); }
function closeModal(id) { const m = document.getElementById(id); if (m) m.classList.remove('open'); }
function closeAllModals() { $$('.modal-overlay').forEach(m => m.classList.remove('open')); }

// Scroll animations
function initScrollAnimations() {
  const observer = new IntersectionObserver(entries => {
    entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('visible'); observer.unobserve(e.target); } });
  }, { threshold: 0.12 });
  $$('.animate-on-scroll').forEach(el => observer.observe(el));
}

// Sticky nav
function initNav() {
  const nav = document.querySelector('.nav');
  if (!nav) return;
  window.addEventListener('scroll', () => {
    nav.classList.toggle('scrolled', window.scrollY > 50);
  });
  const toggler = document.querySelector('.nav-toggler');
  const mobileMenu = document.querySelector('.nav-mobile');
  if (toggler && mobileMenu) {
    toggler.addEventListener('click', () => mobileMenu.classList.toggle('open'));
  }
  // Active link
  const current = location.pathname.split('/').pop() || 'index.html';
  $$('.nav-link').forEach(a => {
    if (a.getAttribute('href') === current || (current === '' && a.getAttribute('href') === 'index.html')) {
      a.classList.add('active');
    }
  });
}

// Countdown bar render
function renderCountdown(endDate, container) {
  if (!container) return;
  const { days, pct, colorClass } = DateUtils.countdown(endDate);
  container.innerHTML = `
    <div class="countdown-wrap">
      <div class="countdown-label">
        <span>${days > 0 ? days + ' days remaining' : days === 0 ? 'Ends today!' : 'Overdue'}</span>
        <span>${DateUtils.format(endDate)}</span>
      </div>
      <div class="countdown-bar">
        <div class="countdown-fill ${colorClass}" style="width:${pct}%"></div>
      </div>
    </div>`;
}

// ============================================================
// STATUS LABELS & BADGE CLASSES
// ============================================================
const STATUS = {
  labels: {
    pending: 'Pending Review',
    confirmed: 'Confirmed',
    on_the_way: 'On The Way',
    arrived: 'Team Arrived',
    active: 'Staging Active',
    pickup_ready: 'Ready for Pickup',
    closed: 'Closed',
    rejected: 'Rejected',
  },
  badges: {
    pending: 'badge-pending',
    confirmed: 'badge-confirmed',
    on_the_way: 'badge-info',
    arrived: 'badge-info',
    active: 'badge-active',
    pickup_ready: 'badge-warning',
    closed: 'badge-closed',
    rejected: 'badge-warning',
  },
  badge(status) {
    const label = this.labels[status] || status;
    const cls = this.badges[status] || 'badge-pending';
    return `<span class="badge ${cls}">${label}</span>`;
  }
};

// ============================================================
// DAILY COUNTDOWN CHECK (simulate cron)
// ============================================================
function runDailyCountdownCheck() {
  const bookings = DB.query(KEYS.BOOKINGS, b => b.status === 'active' || b.status === 'confirmed');
  bookings.forEach(b => {
    const days = DateUtils.daysUntil(b.endDate);
    if (days <= 0 && b.status === 'active') {
      DB.update(KEYS.BOOKINGS, b.id, { status: 'pickup_ready' });
      SMS.log('outbound', b.agentPhone, 'MSS', SMS.buildTemplate('pickup_ready', b), b.jobNumber);
      logActivity(`Job ${b.jobNumber} → Ready for Pickup`);
    } else if (days === 5 && b.status === 'active') {
      SMS.log('outbound', b.agentPhone, 'MSS', SMS.buildTemplate('extension_warn', b), b.jobNumber);
      logActivity(`5-day warning sent for job ${b.jobNumber}`);
    }
  });
}

// Template builder
SMS.buildTemplate = function (key, booking) {
  const templates = DB.get(KEYS.TEMPLATES);
  const tpl = templates.find(t => t.key === key);
  if (!tpl) return '';
  return tpl.body
    .replace(/{agentName}/g, booking.agentName || '')
    .replace(/{jobNumber}/g, booking.jobNumber || '')
    .replace(/{address}/g, booking.address || '')
    .replace(/{date}/g, DateUtils.format(booking.installDate))
    .replace(/{time}/g, booking.installTime || '')
    .replace(/{lockbox}/g, '****') // Never send real lockbox in plaintext
    .replace(/{endDate}/g, DateUtils.format(booking.endDate));
};

// ============================================================
// INIT
// ============================================================
document.addEventListener('DOMContentLoaded', async () => {
  await seedDatabase();
  initNav();
  initScrollAnimations();
  // Run check once per session
  if (!sessionStorage.getItem('mss_cron_ran')) {
    runDailyCountdownCheck();
    sessionStorage.setItem('mss_cron_ran', '1');
  }
});
