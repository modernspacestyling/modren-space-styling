/**
 * /api/admin-create-booking.js
 *
 * Admin-only endpoint to record a booking MANUALLY with a custom final price.
 * Used for back-dated jobs entered via /admin/manual-booking.html.
 *
 * Security:
 *   - Requires "Authorization: Bearer <supabase-jwt>" header
 *   - JWT is verified via Supabase; the user's email must be in ADMIN_EMAILS below
 *
 * Behaviour:
 *   - Does NOT send SMS
 *   - Does NOT send invoice email
 *   - Writes directly to the bookings table using the service-role key
 *   - Stores finalPrice (inc GST) so it appears in the admin bookings list and reports
 */

const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';

// Admins allowed to record manual bookings (emails lowercased for compare)
const ADMIN_EMAILS = new Set([
    'modernspacestyling@gmail.com',
    'bhumika.sood1@gmail.com',
    'rathore6@gmail.com',
    'hundalteji@gmail.com',
]);

function sanitize(s, max = 300) {
    if (typeof s !== 'string') return '';
    return s.trim().slice(0, max).replace(/[<>]/g, '');
}

function encryptLockbox(plaintext) {
    const rawKey = process.env.LOCKBOX_ENCRYPTION_KEY || '';
    if (rawKey.length < 32) throw new Error('LOCKBOX_ENCRYPTION_KEY missing or too short');
    const key = crypto.createHash('sha256').update(rawKey, 'utf8').digest();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, enc]).toString('base64');
}

async function generateJobNumber(supabase) {
    const year = new Date().getFullYear();
    const { data, error } = await supabase
        .from('bookings')
        .select('job_number')
        .like('job_number', `MSS-${year}-%`)
        .order('created_at', { ascending: false })
        .limit(1);
    if (error) throw error;
    let next = 1;
    if (data && data.length > 0) {
        const last = data[0].job_number;
        const m = last && last.match(/MSS-\d{4}-(\d+)/);
        if (m) next = parseInt(m[1], 10) + 1;
    }
    return `MSS-${year}-${String(next).padStart(4, '0')}`;
}

function addDays(isoDate, days) {
    const d = new Date(isoDate);
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
}

module.exports = async (req, res) => {
    // CORS (same origin expected but explicit is fine)
    res.setHeader('Access-Control-Allow-Origin', 'https://www.modernspacestyling.com.au');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') { res.status(204).end(); return; }
    if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

    try {
        // --- Auth ---
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

        // Use a client bound to the user's JWT to read their session
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

        // --- Validate body ---
        const b = req.body || {};
        const required = ['agentName', 'agentPhone', 'address', 'installDate'];
        for (const k of required) {
            if (!b[k] || String(b[k]).trim() === '') {
                res.status(400).json({ error: `Missing required field: ${k}` });
                return;
            }
        }
        const finalPrice = Number(b.finalPrice);
        if (!finalPrice || finalPrice <= 0) {
            res.status(400).json({ error: 'finalPrice (inc GST) is required and must be > 0' });
            return;
        }

        // --- Build row ---
        const supabase = createClient(supabaseUrl, serviceRoleKey);
        const jobNumber = await generateJobNumber(supabase);

        // Staging period = 6 weeks from install date
        const installDate = b.installDate;
        const endDate = addDays(installDate, 42);

        let lockboxEncrypted = null;
        if (b.lockbox && String(b.lockbox).trim()) {
            try { lockboxEncrypted = encryptLockbox(String(b.lockbox).trim()); }
            catch (e) { /* skip if key missing — don't fail the save */ }
        }

        const status = ['pending','confirmed','on_the_way','arrived','active','pickup_ready','closed']
            .includes(b.status) ? b.status : 'closed';

        const row = {
            job_number:      jobNumber,
            status:          status,
            agent_name:      sanitize(b.agentName, 120),
            agent_phone:     sanitize(b.agentPhone, 20),
            agent_email:     sanitize(b.agentEmail, 160),
            agency:          sanitize(b.agency, 160),
            address:         sanitize(b.address, 300),
            install_date:    installDate,
            install_time:    sanitize(b.installTime || '09:00', 8),
            bedrooms:        parseInt(b.bedrooms, 10) || 0,
            bathrooms:       parseInt(b.bathrooms, 10) || 0,
            living_areas:    parseInt(b.livingAreas, 10) || 0,
            dining_areas:    parseInt(b.diningAreas, 10) || 0,
            garage:          !!b.garage,
            vacant:          b.vacant !== false,
            lockbox_enc:     lockboxEncrypted,
            notes:           sanitize(b.notes, 1000),
            start_date:      installDate,
            end_date:        endDate,
            estimated_price: Math.round(finalPrice / 1.1), // ex-GST estimate
            final_price:     finalPrice,
            manual_entry:    true,
            created_by:      email,
            created_at:      new Date().toISOString(),
        };

        const { data, error } = await supabase
            .from('bookings')
            .insert(row)
            .select()
            .single();

        if (error) {
            console.error('[admin-create-booking] insert error:', error);
            // If 'final_price' or 'manual_entry' columns don't exist yet, retry without them
            if (error.message && /column .*(final_price|manual_entry|created_by)/i.test(error.message)) {
                const fallback = { ...row };
                delete fallback.final_price;
                delete fallback.manual_entry;
                delete fallback.created_by;
                const retry = await supabase.from('bookings').insert(fallback).select().single();
                if (retry.error) { res.status(500).json({ error: 'Failed to save booking: ' + retry.error.message }); return; }
                res.status(200).json({ success: true, jobNumber: jobNumber, warning: 'final_price column missing — run schema update SQL', booking: retry.data });
                return;
            }
            res.status(500).json({ error: 'Failed to save booking: ' + error.message });
            return;
        }

        res.status(200).json({
            success: true,
            jobNumber: jobNumber,
            booking: data,
            total: finalPrice,
        });
    } catch (e) {
        console.error('[admin-create-booking] unexpected:', e);
        res.status(500).json({ error: e.message || 'Unexpected server error' });
    }
};
