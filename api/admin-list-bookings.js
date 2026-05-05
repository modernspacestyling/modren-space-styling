/**
 * /api/admin-list-bookings.js
 *
 * Admin-only endpoint that returns ALL bookings from Supabase.
 * Used by /admin/bookings.html and /admin/dashboard.html so manual
 * bookings (which write directly to Supabase) appear on every device,
 * not just the browser that saved them.
 *
 * Security:
 *   - Requires "Authorization: Bearer <supabase-jwt>" header
 *   - JWT verified via Supabase; user.email must be in ADMIN_EMAILS
 */

const { createClient } = require('@supabase/supabase-js');

const ADMIN_EMAILS = new Set([
    'modernspacestyling@gmail.com',
    'bhumika.sood1@gmail.com',
    'rathore6@gmail.com',
    'hundalteji@gmail.com',
]);

function addDays(isoDate, days) {
    const d = new Date(isoDate);
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
}

// Convert a Supabase row (snake_case) to the camelCase shape the
// admin pages expect (matches DB.get(KEYS.BOOKINGS) records).
function rowToCamel(r) {
    const installDate = r.install_date || r.start_date || null;
    const endDate = r.end_date || (installDate ? addDays(installDate, 42) : null);
    return {
        id:              String(r.id),
        jobNumber:       r.job_number,
        status:          r.status || 'pending',
        agentName:       r.agent_name || '',
        agentPhone:      r.agent_phone || '',
        agentEmail:      r.agent_email || '',
        agency:          r.agency || '',
        customerName:    r.customer_name || '',
        customerEmail:   r.customer_email || '',
        customerPhone:   r.customer_phone || '',
        customerAddress: r.customer_address || '',
        address:         r.address || '',
        installDate:     installDate,
        installTime:     r.install_time || '09:00',
        bedrooms:        r.bedrooms || 0,
        bathrooms:       r.bathrooms || 0,
        livingAreas:     r.living_areas || 0,
        diningAreas:     r.dining_areas || 0,
        garage:          !!r.garage,
        vacant:          r.vacant !== false,
        notes:           r.notes || '',
        startDate:       r.start_date || installDate,
        endDate:         endDate,
        estimatedPrice:  r.estimated_price || 0,
        finalPrice:      r.final_price || null,
        manualEntry:     !!r.manual_entry,
        createdAt:       r.created_at,
        updatedAt:       r.updated_at,
    };
}

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', 'https://www.modernspacestyling.com.au');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') { res.status(204).end(); return; }
    if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed' }); return; }

    try {
        const authHeader = req.headers.authorization || req.headers.Authorization || '';
        const match = authHeader.match(/^Bearer\s+(.+)$/i);
        if (!match) { res.status(401).json({ error: 'Missing Authorization header' }); return; }
        const jwt = match[1];

        const supabaseUrl = (process.env.SUPABASE_URL || '').trim();
        const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
        if (!supabaseUrl || !serviceRoleKey) {
            res.status(500).json({ error: 'Server not configured' });
            return;
        }

        const authClient = createClient(supabaseUrl, serviceRoleKey, {
            auth: { persistSession: false, autoRefreshToken: false }
        });
        const { data: userData, error: userErr } = await authClient.auth.getUser(jwt);
        if (userErr || !userData || !userData.user) {
            res.status(401).json({ error: 'Invalid or expired session' });
            return;
        }
        const email = (userData.user.email || '').toLowerCase();
        if (!ADMIN_EMAILS.has(email)) {
            res.status(403).json({ error: 'Not authorised' });
            return;
        }

        const supabase = createClient(supabaseUrl, serviceRoleKey);
        const { data, error } = await supabase
            .from('bookings')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(500);

        if (error) {
            console.error('[admin-list-bookings] select error:', error);
            res.status(500).json({ error: 'Failed to load bookings: ' + error.message });
            return;
        }

        const bookings = (data || []).map(rowToCamel);
        res.status(200).json({ success: true, bookings, count: bookings.length });
    } catch (e) {
        console.error('[admin-list-bookings] unexpected:', e);
        res.status(500).json({ error: e.message || 'Unexpected server error' });
    }
};
