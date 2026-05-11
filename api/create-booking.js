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
    const rawKey = process.env.LOCKBOX_ENCRYPTION_KEY || '';
    // Fail closed — refuse to encrypt with a weak/missing key.
    // Must be at least 32 bytes of high-entropy material.
    if (rawKey.length < 32) {
        throw new Error('LOCKBOX_ENCRYPTION_KEY missing or too short (must be >= 32 bytes)');
    }
    // Derive a stable 32-byte key via SHA-256 so the env var can be any length >= 32.
    const key = crypto.createHash('sha256').update(rawKey, 'utf8').digest();
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
    total += (fields.masterBedrooms || 0) * (c.master_bedroom_rate || 300);
    total += (fields.bathrooms || 0) * (c.bathroom_rate || 150);
    total += (fields.livingAreas || 0) * (c.living_rate || 250);
    total += (fields.diningAreas || 0) * (c.dining_rate || 150);
    if (fields.alfresco) total += (c.alfresco_rate || 200);
    if (fields.pantry)   total += (c.pantry_rate || 100);
    // hallway: free — intentionally not added
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

// ── GET handler: list signed-in user's bookings ──
// Merged in from /api/my-bookings.js on 2026-05-11 to stay under the
// Vercel Hobby 12-function limit. Conceptually still a "bookings"
// endpoint — POST creates, GET lists for the authenticated user.
const MY_BOOKINGS_SAFE_COLUMNS = [
    'job_number', 'status',
    'agent_name', 'agent_phone', 'agent_email', 'agency',
    'address', 'install_date', 'install_time', 'end_date',
    'bedrooms', 'bathrooms', 'living_areas', 'dining_areas',
    'notes', 'estimated_price', 'created_at',
].join(',');

async function listBookingsForUser(req, res) {
    const authHeader = req.headers['authorization'] || req.headers['Authorization'] || '';
    const m = authHeader.match(/^Bearer\s+(.+)$/i);
    if (!m) return res.status(401).json({ error: 'Missing Authorization header' });
    const accessToken = m[1].trim();
    if (!accessToken) return res.status(401).json({ error: 'Empty access token' });

    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
        return res.status(500).json({ error: 'Server misconfigured' });
    }

    const supabase = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    // Verify JWT and extract authoritative user email.
    let userEmail = null;
    try {
        const { data: userData, error: userErr } = await supabase.auth.getUser(accessToken);
        if (userErr || !userData?.user) {
            return res.status(401).json({ error: 'Invalid or expired session' });
        }
        userEmail = (userData.user.email || '').toLowerCase();
        if (!userEmail) return res.status(401).json({ error: 'User has no email' });
    } catch (e) {
        console.error('[bookings:GET] getUser failed', e);
        return res.status(401).json({ error: 'Could not verify session' });
    }

    // Staging bookings owned by this email.
    let bookings;
    try {
        const { data, error: queryErr } = await supabase
            .from('bookings')
            .select(MY_BOOKINGS_SAFE_COLUMNS)
            .eq('agent_email', userEmail)
            .order('install_date', { ascending: false })
            .limit(50);
        if (queryErr) throw queryErr;
        bookings = data || [];
    } catch (e) {
        console.error('[bookings:GET] query failed', e);
        return res.status(500).json({ error: 'Could not load bookings' });
    }

    // Photo bookings — fail-soft (separate table, missing-table not fatal).
    try {
        const { data: photo } = await supabase
            .from('photo_bookings')
            .select('job_number, status, client_name, client_phone, client_email, agency, address, preferred_date, package, bedrooms, bathrooms, notes, estimated_price, created_at')
            .eq('client_email', userEmail)
            .order('preferred_date', { ascending: false })
            .limit(50);
        if (photo && photo.length) {
            const normalised = photo.map(p => ({
                job_number: p.job_number, status: p.status,
                agent_name: p.client_name, agent_phone: p.client_phone,
                agent_email: p.client_email, agency: p.agency,
                address: p.address, install_date: p.preferred_date,
                install_time: null, end_date: null,
                bedrooms: p.bedrooms, bathrooms: p.bathrooms,
                living_areas: null, dining_areas: null,
                notes: p.notes, estimated_price: p.estimated_price,
                created_at: p.created_at, package: p.package,
            }));
            bookings = bookings.concat(normalised);
            bookings.sort((a, b) => {
                const da = a.install_date ? new Date(a.install_date).getTime() : 0;
                const db = b.install_date ? new Date(b.install_date).getTime() : 0;
                return db - da;
            });
        }
    } catch (e) {
        console.warn('[bookings:GET] photo_bookings fetch failed (non-fatal)', e.message);
    }

    return res.status(200).json({ bookings });
}

module.exports = async function handler(req, res) {
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method === 'GET') return listBookingsForUser(req, res);
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
        masterBedrooms, alfresco, pantry, hallway,
        garage, vacant, lockbox, notes, travelSurcharge,
    } = req.body;

    const required = { agentName, agentPhone, agentEmail, address, installDate, bedrooms };
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

    // ── Encrypt lockbox (optional — agents often add this later when access is arranged) ──
    const lockboxClean = sanitize(lockbox || '', 50);
    const lockboxEnc = lockboxClean ? encryptLockbox(lockboxClean) : null;

    // ── Calculate end date (6 weeks from install) ──
    const endDate = new Date(installDateObj);
    endDate.setDate(endDate.getDate() + 42);
    const endDateStr = endDate.toISOString().slice(0, 10);

    // ── Calculate price ──
    const estimatedPrice = calculatePrice({
        bedrooms: parseInt(bedrooms) || 0,
        masterBedrooms: parseInt(masterBedrooms) || 0,
        bathrooms: parseInt(bathrooms) || 0,
        livingAreas: parseInt(livingAreas) || 0,
        diningAreas: parseInt(diningAreas) || 0,
        alfresco: Boolean(parseInt(alfresco) || 0),
        pantry: Boolean(parseInt(pantry) || 0),
        hallway: Boolean(parseInt(hallway) || 0),
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

    // Fetch verified team numbers for dispatch (transport, designer, installer)
    const { data: teamNumbers } = await supabase
        .from('verified_numbers')
        .select('phone_number, role, name')
        .eq('active', true)
        .in('role', ['transport', 'designer', 'installer']);

    // Fetch admin/partner numbers — these get FULL details including price
    const { data: partnerNumbers } = await supabase
        .from('verified_numbers')
        .select('phone_number, role, name')
        .eq('active', true)
        .in('role', ['admin', 'partner']);

    // Parallelise all SMS sends so the API responds in ~3s instead of ~20s.
    // Uses Promise.allSettled so one failed number (e.g. unverified on Twilio trial)
    // doesn't block the rest.
    const smsTasks = [];
    smsTasks.push(sendSms(sanitize(agentPhone, 20), agentSms, jobNumber, supabase));
    if (adminPhone) smsTasks.push(sendSms(adminPhone, adminSms, jobNumber, supabase));

    // Send full details (WITH price) to admin/partner numbers
    if (partnerNumbers?.length) {
        for (const partner of partnerNumbers) {
            smsTasks.push(sendSms(partner.phone_number, adminSms, jobNumber, supabase));
        }
    }

    // Send team dispatch (NO price) to transport, designer, installer
    if (teamNumbers?.length) {
        const teamDispatch =
            `NEW STAGING ${jobNumber}: ${sanitize(address)}. Install: ${fmtDate(installDate)} ${installTime || '09:00'}. ` +
            `${bedrooms} bed${bedrooms > 1 ? 's' : ''}. Agent: ${sanitize(agentName)} (${sanitize(agentPhone, 20)}). ` +
            `Reply CONFIRMED ${jobNumber} to acknowledge.`;
        for (const member of teamNumbers) {
            smsTasks.push(sendSms(member.phone_number, teamDispatch, jobNumber, supabase));
        }
    }

    // Wait for all SMS (or failures) in parallel, capped so the API still returns fast.
    const SMS_DEADLINE_MS = 5000;
    await Promise.race([
        Promise.allSettled(smsTasks),
        new Promise(r => setTimeout(r, SMS_DEADLINE_MS)),
    ]);

    // ── Auto-generate and email invoice ──
    try {
        const invoicePayload = {
            type: 'staging',
            jobNumber,
            booking: {
                agentName: sanitize(agentName),
                agentEmail: sanitize(agentEmail, 100).toLowerCase(),
                agentPhone: sanitize(agentPhone, 20),
                agency: sanitize(agency || '', 100),
                address: sanitize(address, 300),
                installDate: installDate,
                bedrooms: parseInt(bedrooms) || 0,
                masterBedrooms: parseInt(masterBedrooms) || 0,
                bathrooms: parseInt(bathrooms) || 0,
                livingAreas: parseInt(livingAreas) || 0,
                diningAreas: parseInt(diningAreas) || 0,
                alfresco: Boolean(parseInt(alfresco) || 0),
                pantry: Boolean(parseInt(pantry) || 0),
                hallway: Boolean(parseInt(hallway) || 0),
                vacant: Boolean(vacant),
                travelSurcharge: Boolean(travelSurcharge),
                notes: sanitize(notes || '', 1000),
            },
            pricingConfig: pricingData,
        };

        // Call invoice endpoint internally
        const sendInvoice = require('./send-invoice');
        const invoiceReq = { method: 'POST', body: invoicePayload, headers: {} };
        const invoiceRes = {
            _status: 200, _json: null,
            status(code) { this._status = code; return this; },
            json(data) { this._json = data; return this; },
            end() { return this; },
        };
        await sendInvoice(invoiceReq, invoiceRes);
        console.log('[create-booking] Invoice generated:', invoiceRes._json);
    } catch (invoiceErr) {
        console.error('[create-booking] Invoice generation failed (non-blocking):', invoiceErr.message);
    }

    return res.status(200).json({
        success: true,
        jobNumber,
        estimatedPrice,
        endDate: endDateStr,
        message: 'Booking received. Invoice emailed. SMS confirmation sent.',
    });
};
