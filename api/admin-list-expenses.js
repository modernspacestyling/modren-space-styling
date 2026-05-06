/**
 * /api/admin-list-expenses.js
 *
 * Admin-only endpoint that returns ALL expenses from Supabase.
 * Used by /admin/expenses.html, /admin/dashboard.html, /admin/reports.html
 * so that expenses entered via the Telegram bot (Mini/Sony/Mandeep) appear
 * on every device, not only the one that saved them.
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

// Convert a Supabase row (snake_case) to the camelCase shape the
// admin pages expect (matches DB.get(KEYS.EXPENSES) records).
function rowToCamel(r) {
    return {
        id:           String(r.id),
        date:         r.date,
        description:  r.description || '',
        category:     r.category || 'other',
        type:         r.type || 'one-off',
        amount:       Number(r.amount) || 0,
        gst:          Number(r.gst) || 0,
        total:        Number(r.total) || 0,
        jobNumber:    r.job_number || null,
        source:       r.source || 'manual',
        receiptUrl:   r.receipt_url || null,
        createdBy:    r.created_by || null,
        createdAt:    r.created_at,
        updatedAt:    r.updated_at,
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
            auth: { persistSession: false, autoRefreshToken: false },
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
            .from('expenses')
            .select('*')
            .order('date', { ascending: false })
            .limit(1000);

        if (error) {
            console.error('[admin-list-expenses] select error:', error);
            res.status(500).json({ error: 'Failed to load expenses: ' + error.message });
            return;
        }

        const expenses = (data || []).map(rowToCamel);
        res.status(200).json({ success: true, expenses, count: expenses.length });
    } catch (e) {
        console.error('[admin-list-expenses] unexpected:', e);
        res.status(500).json({ error: e.message || 'Unexpected server error' });
    }
};
