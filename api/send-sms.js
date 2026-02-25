/**
 * /api/send-sms.js — Internal SMS sender via Twilio
 * Called by other API routes (not directly from frontend)
 * 
 * POST body: { to: string, body: string, jobNumber?: string }
 * Auth: requires ADMIN_SECRET_TOKEN header
 */

const twilio = require('twilio');
const { createClient } = require('@supabase/supabase-js');

// Simple in-memory rate limiter (resets per function instance)
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const RATE_LIMIT_MAX = 10;     // max 10 calls/min per IP

function isRateLimited(ip) {
    const now = Date.now();
    const entry = rateLimitMap.get(ip) || { count: 0, start: now };
    if (now - entry.start > RATE_LIMIT_WINDOW_MS) {
        rateLimitMap.set(ip, { count: 1, start: now });
        return false;
    }
    entry.count++;
    rateLimitMap.set(ip, entry);
    return entry.count > RATE_LIMIT_MAX;
}

module.exports = async function handler(req, res) {
    // CORS pre-flight
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    // Rate limit by IP
    const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress || 'unknown';
    if (isRateLimited(ip)) {
        return res.status(429).json({ error: 'Too many requests. Please wait.' });
    }

    // Auth check — only internal API calls allowed
    const authToken = req.headers['x-admin-token'];
    if (authToken !== process.env.ADMIN_SECRET_TOKEN) {
        return res.status(403).json({ error: 'Forbidden' });
    }

    // Parse + validate body
    const { to, body: smsBody, jobNumber } = req.body;

    if (!to || !smsBody) {
        return res.status(400).json({ error: 'Missing required fields: to, body' });
    }

    // Validate phone format
    if (!/^\+[1-9]\d{6,14}$/.test(to)) {
        return res.status(400).json({ error: 'Invalid phone number format. Must be E.164 (+61...)' });
    }

    if (smsBody.length > 1600) {
        return res.status(400).json({ error: 'SMS body too long (max 1600 chars)' });
    }

    // Send via Twilio
    const client = twilio(
        process.env.TWILIO_ACCOUNT_SID,
        process.env.TWILIO_AUTH_TOKEN
    );

    let twilioSid = null;
    try {
        const message = await client.messages.create({
            from: process.env.TWILIO_PHONE_NUMBER,
            to,
            body: smsBody,
        });
        twilioSid = message.sid;
    } catch (err) {
        console.error('[send-sms] Twilio error:', err.message);
        return res.status(502).json({ error: 'SMS delivery failed', detail: err.message });
    }

    // Log to Supabase
    const supabase = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    await supabase.from('sms_log').insert({
        direction: 'outbound',
        to_number: to,
        from_number: process.env.TWILIO_PHONE_NUMBER,
        body: smsBody,
        job_number: jobNumber || null,
        status: 'sent',
        twilio_sid: twilioSid,
    });

    return res.status(200).json({ success: true, sid: twilioSid });
};
