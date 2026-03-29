/**
 * /api/create-photo-booking.js — Photography booking creation endpoint
 *
 * Called by photography-booking.html when deployed on Vercel.
 * POST body: photo booking form fields (JSON)
 * Returns: { success: true, jobNumber: "PHOTO-2026-0001" }
 */

const { createClient } = require('@supabase/supabase-js');
const twilio = require('twilio');

// ── Rate limiting ──
const rateLimitMap = new Map();
function isRateLimited(ip) {
    const now = Date.now();
    const e = rateLimitMap.get(ip) || { count: 0, start: now };
    if (now - e.start > 60_000) { rateLimitMap.set(ip, { count: 1, start: now }); return false; }
    e.count++; rateLimitMap.set(ip, e);
    return e.count > 5;
}

// ── Input sanitisation ──
function sanitize(str, maxLen = 200) {
    if (typeof str !== 'string') return '';
    return str.trim().slice(0, maxLen).replace(/[<>]/g, '');
}

// ── Job number generator ──
async function generateJobNumber(supabase) {
    const year = new Date().getFullYear();
    const { count } = await supabase
        .from('photo_bookings')
        .select('*', { count: 'exact', head: true });
    const seq = String((count || 0) + 1).padStart(4, '0');
    return `PHOTO-${year}-${seq}`;
}

// ── SMS sender helper ──
async function sendSms(to, body, jobNumber, supabase) {
    if (!process.env.TWILIO_ACCOUNT_SID) return;
    const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    try {
        const msg = await client.messages.create({
            from: process.env.TWILIO_PHONE_NUMBER,
            to,
            body,
        });
        await supabase.from('sms_log').insert({
            direction: 'outbound', to_number: to,
            from_number: process.env.TWILIO_PHONE_NUMBER,
            body, job_number: jobNumber, status: 'sent', twilio_sid: msg.sid,
        });
    } catch (err) {
        console.error('[create-photo-booking] SMS failed to', to, err.message);
    }
}

// ── Format date for SMS ──
function fmtDate(dateStr) {
    if (!dateStr) return '—';
    return new Date(dateStr).toLocaleDateString('en-AU', {
        day: '2-digit', month: 'short', year: 'numeric'
    });
}

// ── Package pricing ──
const PACKAGE_PRICES = {
    essential: 349,
    premium: 449,
    ultimate: 599,
};

module.exports = async function handler(req, res) {
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const ip = req.headers['x-forwarded-for']?.split(',')[0] || 'unknown';
    if (isRateLimited(ip)) {
        return res.status(429).json({ error: 'Too many requests. Please try again shortly.' });
    }

    // ── Parse & validate body ──
    const {
        clientName, clientPhone, clientEmail, agency,
        address, propertyType, preferredDate, preferredTime,
        package: pkg, addons, bedrooms, bathrooms, notes,
    } = req.body;

    const required = { clientName, clientPhone, clientEmail, address, preferredDate, package: pkg };
    for (const [field, value] of Object.entries(required)) {
        if (!value) {
            return res.status(400).json({ error: `Missing required field: ${field}` });
        }
    }

    // Email format
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clientEmail)) {
        return res.status(400).json({ error: 'Invalid email address' });
    }

    // Phone format
    if (!/^\+?[0-9\s\-().]{8,20}$/.test(clientPhone)) {
        return res.status(400).json({ error: 'Invalid phone number' });
    }

    // Valid package
    if (!PACKAGE_PRICES[pkg]) {
        return res.status(400).json({ error: 'Invalid package selected' });
    }

    // Valid property type
    if (!['sale', 'rent'].includes(propertyType)) {
        return res.status(400).json({ error: 'Property type must be sale or rent' });
    }

    // Date in future
    const dateObj = new Date(preferredDate);
    if (isNaN(dateObj.getTime()) || dateObj < new Date()) {
        return res.status(400).json({ error: 'Preferred date must be in the future' });
    }

    // ── Calculate price ──
    let estimatedPrice = PACKAGE_PRICES[pkg];
    const safeAddons = Array.isArray(addons) ? addons : [];
    safeAddons.forEach(addon => {
        if (addon.key === 'twilight') estimatedPrice += 150;
        else if (addon.key === 'drone') estimatedPrice += 200;
        else if (addon.key === 'virtual_staging') estimatedPrice += 100 * (parseInt(addon.rooms) || 1);
    });

    // ── Supabase ──
    const supabase = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    // ── Generate job number ──
    const jobNumber = await generateJobNumber(supabase);

    // ── Insert booking ──
    const { data: booking, error: insertErr } = await supabase
        .from('photo_bookings')
        .insert({
            job_number: jobNumber,
            status: 'pending',
            client_name: sanitize(clientName),
            client_phone: sanitize(clientPhone, 20),
            client_email: sanitize(clientEmail, 100).toLowerCase(),
            agency: sanitize(agency || '', 100),
            address: sanitize(address, 300),
            property_type: propertyType,
            preferred_date: preferredDate,
            preferred_time: sanitize(preferredTime || '09:00', 10),
            package: pkg,
            addons: safeAddons,
            bedrooms: parseInt(bedrooms) || 0,
            bathrooms: parseInt(bathrooms) || 0,
            notes: sanitize(notes || '', 1000),
            estimated_price: estimatedPrice,
        })
        .select()
        .single();

    if (insertErr) {
        console.error('[create-photo-booking] Insert failed:', insertErr);
        return res.status(500).json({ error: 'Failed to save booking. Please try again.' });
    }

    // ── Activity log ──
    await supabase.from('activity_log').insert({
        message: `New photo booking ${jobNumber} from ${sanitize(clientName)} (${sanitize(clientEmail)}) — ${sanitize(address)} [${pkg}]`,
        actor: sanitize(clientName),
        ip_address: ip,
    });

    // ── Send SMS messages ──
    const packageName = pkg.charAt(0).toUpperCase() + pkg.slice(1);
    const clientSms =
        `Hi ${sanitize(clientName)}, your photography booking ${jobNumber} has been received for ` +
        `${sanitize(address)} on ${fmtDate(preferredDate)}. ` +
        `Package: ${packageName} ($${estimatedPrice}+GST). ` +
        `We'll confirm via SMS within 2 business hours. — Modern Space Styling`;

    const adminPhone = process.env.ADMIN_PHONE || null;
    const adminSms =
        `NEW PHOTO BOOKING ${jobNumber}: ${sanitize(clientName)} — ` +
        `${sanitize(address)} (${propertyType}). ` +
        `Date: ${fmtDate(preferredDate)} ${preferredTime || ''}. ` +
        `Package: ${packageName}. Est: $${estimatedPrice}.`;

    await sendSms(sanitize(clientPhone, 20), clientSms, jobNumber, supabase);
    if (adminPhone) await sendSms(adminPhone, adminSms, jobNumber, supabase);

    return res.status(200).json({
        success: true,
        jobNumber,
        estimatedPrice,
        message: 'Photography booking received. SMS confirmation sent.',
    });
};
