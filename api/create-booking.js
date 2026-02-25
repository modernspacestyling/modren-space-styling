/**
 * /api/create-booking.js — Secure booking creation endpoint
 *
 * Called by booking.html when deployed on Vercel (IS_PROD flag).
 * POST body: booking form fields (JSON)
 * Returns: { success: true, jobNumber: "MSS-2026-0001" }
 */

const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const twilio = require('twilio');

// ── Encryption helpers (AES-256-GCM) ──
const ALGORITHM = 'aes-256-gcm';

function encryptLockbox(plaintext) {
    const key = Buffer.from(
        (process.env.LOCKBOX_ENCRYPTION_KEY || '').padEnd(32, '0').slice(0, 32),
        'utf8'
    );
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    // Format: base64(iv + tag + encrypted)
    return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

// ── Rate limiting ──
const rateLimitMap = new Map();
function isRateLimited(ip) {
    const now = Date.now();
    const e = rateLimitMap.get(ip) || { count: 0, start: now };
    if (now - e.start > 60_000) { rateLimitMap.set(ip, { count: 1, start: now }); return false; }
    e.count++; rateLimitMap.set(ip, e);
    return e.count > 5; // Max 5 bookings/min per IP
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
        .from('bookings')
        .select('*', { count: 'exact', head: true });
    const seq = String((count || 0) + 1).padStart(4, '0');
    return `MSS-${year}-${seq}`;
}

// ── Pricing calculator ──
function calculatePrice(fields, config) {
    const c = config || {};
    let total = c.base_price || 800;
    total += (fields.bedrooms || 0) * (c.bedroom_rate || 250);
    total += (fields.bathrooms || 0) * (c.bathroom_rate || 150);
    total += (fields.livingAreas || 0) * (c.living_rate || 200);
    total += (fields.diningAreas || 0) * (c.dining_rate || 150);
    if (!fields.vacant) total += (c.occupied_surcharge || 300);
    if (fields.travelSurcharge) total += (c.travel_surcharge || 50);
    return total;
}

// ── SMS sender helper ──
async function sendSms(to, body, jobNumber, supabase) {
    if (!process.env.TWILIO_ACCOUNT_SID) return; // Skip if no Twilio configured
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
        console.error('[create-booking] SMS failed to', to, err.message);
    }
}

// ── Format date for SMS ──
function fmtDate(dateStr) {
    if (!dateStr) return '—';
    return new Date(dateStr).toLocaleDateString('en-AU', {
        day: '2-digit', month: 'short', year: 'numeric'
    });
}

module.exports = async function handler(req, res) {
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const ip = req.headers['x-forwarded-for']?.split(',')[0] || 'unknown';
    if (isRateLimited(ip)) {
        return res.status(429).json({ error: 'Too many requests. Please try again shortly.' });
    }

    // ── Parse & validate body ──
    const {
        agentName, agentPhone, agentEmail, agency,
        address, installDate, installTime,
        bedrooms, bathrooms, livingAreas, diningAreas,
        garage, vacant, lockbox, notes, travelSurcharge,
    } = req.body;

    const required = { agentName, agentPhone, agentEmail, address, installDate, bedrooms, lockbox };
    for (const [field, value] of Object.entries(required)) {
        if (!value && value !== 0) {
            return res.status(400).json({ error: `Missing required field: ${field}` });
        }
    }

    // Email format
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(agentEmail)) {
        return res.status(400).json({ error: 'Invalid email address' });
    }

    // Phone format
    if (!/^\+?[0-9\s\-().]{8,20}$/.test(agentPhone)) {
        return res.status(400).json({ error: 'Invalid phone number' });
    }

    // Date is in future
    const installDateObj = new Date(installDate);
    if (isNaN(installDateObj.getTime()) || installDateObj < new Date()) {
        return res.status(400).json({ error: 'Install date must be in the future' });
    }

    // Sanity on numeric fields
    if (bedrooms < 1 || bedrooms > 10) {
        return res.status(400).json({ error: 'Bedrooms must be between 1 and 10' });
    }

    // ── Supabase ──
    const supabase = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    // ── Fetch pricing config ──
    const { data: pricingData } = await supabase
        .from('pricing_config')
        .select('*')
        .single();

    // ── Generate job number ──
    const jobNumber = await generateJobNumber(supabase);

    // ── Encrypt lockbox ──
    const lockboxEnc = encryptLockbox(sanitize(lockbox, 50));

    // ── Calculate end date (6 weeks from install) ──
    const endDate = new Date(installDateObj);
    endDate.setDate(endDate.getDate() + 42);
    const endDateStr = endDate.toISOString().slice(0, 10);

    // ── Calculate price ──
    const estimatedPrice = calculatePrice({
        bedrooms: parseInt(bedrooms) || 0,
        bathrooms: parseInt(bathrooms) || 0,
        livingAreas: parseInt(livingAreas) || 0,
        diningAreas: parseInt(diningAreas) || 0,
        garage: Boolean(garage),
        vacant: Boolean(vacant),
        travelSurcharge: Boolean(travelSurcharge),
    }, pricingData);

    // ── Insert booking ──
    const { data: booking, error: insertErr } = await supabase
        .from('bookings')
        .insert({
            job_number: jobNumber,
            status: 'pending',
            agent_name: sanitize(agentName),
            agent_phone: sanitize(agentPhone, 20),
            agent_email: sanitize(agentEmail, 100).toLowerCase(),
            agency: sanitize(agency || '', 100),
            address: sanitize(address, 300),
            install_date: installDate,
            install_time: sanitize(installTime || '09:00', 10),
            bedrooms: parseInt(bedrooms) || 0,
            bathrooms: parseInt(bathrooms) || 0,
            living_areas: parseInt(livingAreas) || 0,
            dining_areas: parseInt(diningAreas) || 0,
            garage: Boolean(garage),
            vacant: Boolean(vacant),
            lockbox_enc: lockboxEnc,
            notes: sanitize(notes || '', 1000),
            end_date: endDateStr,
            estimated_price: estimatedPrice,
        })
        .select()
        .single();

    if (insertErr) {
        console.error('[create-booking] Insert failed:', insertErr);
        return res.status(500).json({ error: 'Failed to save booking. Please try again.' });
    }

    // ── Activity log ──
    await supabase.from('activity_log').insert({
        message: `New booking ${jobNumber} from ${sanitize(agentName)} (${sanitize(agentEmail)}) — ${sanitize(address)}`,
        actor: sanitize(agentName),
        ip_address: ip,
    });

    // ── Send SMS messages ──
    const agentSms =
        `Hi ${sanitize(agentName)}, your staging booking ${jobNumber} has been received for ` +
        `${sanitize(address)} on ${fmtDate(installDate)}. ` +
        `We'll confirm via SMS within 2 business hours. — Modern Space Styling`;

    const adminPhone = process.env.ADMIN_PHONE || null;
    const adminSms =
        `NEW BOOKING ${jobNumber}: ${sanitize(agentName)} (${sanitize(agency || '')}) — ` +
        `${sanitize(address)}. Install: ${fmtDate(installDate)} ${installTime || ''}. ` +
        `Beds: ${bedrooms}. Est: $${estimatedPrice.toLocaleString('en-AU')}.`;

    // Fetch verified team numbers for dispatch
    const { data: teamNumbers } = await supabase
        .from('verified_numbers')
        .select('phone_number, role, name')
        .eq('active', true)
        .in('role', ['transport', 'designer', 'installer']);

    await sendSms(sanitize(agentPhone, 20), agentSms, jobNumber, supabase);
    if (adminPhone) await sendSms(adminPhone, adminSms, jobNumber, supabase);

    if (teamNumbers?.length) {
        const teamDispatch =
            `NEW STAGING ${jobNumber}: ${sanitize(address)}. Install: ${fmtDate(installDate)} ${installTime || '09:00'}. ` +
            `${bedrooms} bed. Reply CONFIRMED ${jobNumber} to acknowledge.`;
        for (const member of teamNumbers) {
            await sendSms(member.phone_number, teamDispatch, jobNumber, supabase);
        }
    }

    return res.status(200).json({
        success: true,
        jobNumber,
        estimatedPrice,
        endDate: endDateStr,
        message: 'Booking received. SMS confirmation sent.',
    });
};
