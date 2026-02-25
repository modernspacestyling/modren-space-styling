/**
 * /api/twilio-incoming.js — Twilio SMS webhook handler
 *
 * Configure in Twilio Console:
 *   Messaging → Phone Number → Webhook (POST):
 *   https://www.modernspacestyling.com.au/api/twilio-incoming
 *
 * Supported commands (from verified numbers only):
 *   CONFIRMED <JobNumber>
 *   COMPLETED <JobNumber>
 *   EXTEND <JobNumber> 1W
 *   EXTEND <JobNumber> 2W
 *   PICKEDUP <JobNumber>
 */

const twilio = require('twilio');
const { createClient } = require('@supabase/supabase-js');

// Same rate limiter pattern
const rateLimitMap = new Map();
function isRateLimited(ip) {
    const now = Date.now();
    const e = rateLimitMap.get(ip) || { count: 0, start: now };
    if (now - e.start > 60_000) { rateLimitMap.set(ip, { count: 1, start: now }); return false; }
    e.count++; rateLimitMap.set(ip, e);
    return e.count > 30; // Higher limit for Twilio's webhook
}

module.exports = async function handler(req, res) {
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).send('Method not allowed');

    const ip = req.headers['x-forwarded-for']?.split(',')[0] || 'unknown';
    if (isRateLimited(ip)) return res.status(429).send('Too many requests');

    // ── Validate Twilio signature ──
    const twilioSignature = req.headers['x-twilio-signature'];
    const webhookUrl = `https://www.modernspacestyling.com.au/api/twilio-incoming`;

    const isValid = twilio.validateRequest(
        process.env.TWILIO_AUTH_TOKEN,
        twilioSignature,
        webhookUrl,
        req.body
    );

    if (!isValid) {
        console.warn('[twilio-incoming] Invalid Twilio signature — rejected');
        return res.status(403).send('Forbidden');
    }

    const from = (req.body.From || '').trim();
    const rawBody = (req.body.Body || '').trim();
    const command = rawBody.toUpperCase().trim();

    const supabase = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    // ── Log inbound SMS ──
    await supabase.from('sms_log').insert({
        direction: 'inbound',
        from_number: from,
        to_number: process.env.TWILIO_PHONE_NUMBER,
        body: rawBody,
        status: 'received',
    });

    // ── Check verified numbers ──
    const { data: verified } = await supabase
        .from('verified_numbers')
        .select('role, name')
        .eq('phone_number', from)
        .eq('active', true)
        .single();

    if (!verified) {
        console.warn(`[twilio-incoming] Unverified number: ${from}`);
        const twiml = new twilio.twiml.MessagingResponse();
        twiml.message('This number is not authorised to send commands. Contact your admin.');
        return res.type('text/xml').send(twiml.toString());
    }

    // ── Parse command ──
    const patterns = [
        { re: /^CONFIRMED\s+(MSS-\d{4}-\d{4})$/, action: 'CONFIRMED' },
        { re: /^COMPLETED\s+(MSS-\d{4}-\d{4})$/, action: 'COMPLETED' },
        { re: /^PICKEDUP\s+(MSS-\d{4}-\d{4})$/, action: 'PICKEDUP' },
        { re: /^EXTEND\s+(MSS-\d{4}-\d{4})\s+(1W|2W)$/, action: 'EXTEND' },
        { re: /^ON THE WAY\s+(MSS-\d{4}-\d{4})$/, action: 'ON_THE_WAY' },
        { re: /^ARRIVED\s+(MSS-\d{4}-\d{4})$/, action: 'ARRIVED' },
    ];

    let parsed = null;
    for (const p of patterns) {
        const m = command.match(p.re);
        if (m) {
            parsed = { action: p.action, jobNumber: m[1] };
            if (p.action === 'EXTEND') parsed.weeks = m[2] === '1W' ? 1 : 2;
            break;
        }
    }

    const twiml = new twilio.twiml.MessagingResponse();

    if (!parsed) {
        twiml.message(
            'Command not recognised. Valid commands:\n' +
            'CONFIRMED MSS-YYYY-####\n' +
            'COMPLETED MSS-YYYY-####\n' +
            'PICKEDUP MSS-YYYY-####\n' +
            'EXTEND MSS-YYYY-#### 1W\n' +
            'EXTEND MSS-YYYY-#### 2W'
        );
        return res.type('text/xml').send(twiml.toString());
    }

    // ── Fetch booking ──
    const { data: booking, error: bookErr } = await supabase
        .from('bookings')
        .select('*')
        .eq('job_number', parsed.jobNumber)
        .single();

    if (!booking || bookErr) {
        twiml.message(`Job ${parsed.jobNumber} not found. Check job number and try again.`);
        return res.type('text/xml').send(twiml.toString());
    }

    // ── Execute status updates ──
    let updates = {};
    let replyMsg = '';
    const today = new Date().toISOString().slice(0, 10);

    if (parsed.action === 'CONFIRMED') {
        updates = { status: 'confirmed' };
        replyMsg = `✓ ${parsed.jobNumber} confirmed. See you on install day.`;
    }
    else if (parsed.action === 'ON_THE_WAY') {
        updates = { status: 'on_the_way' };
        replyMsg = `✓ ${parsed.jobNumber} — on the way recorded.`;
    }
    else if (parsed.action === 'ARRIVED') {
        updates = { status: 'arrived' };
        replyMsg = `✓ ${parsed.jobNumber} — arrival recorded.`;
    }
    else if (parsed.action === 'COMPLETED') {
        const endDate = new Date();
        endDate.setDate(endDate.getDate() + 42); // 6 weeks
        updates = {
            status: 'active',
            start_date: today,
            end_date: endDate.toISOString().slice(0, 10),
        };
        replyMsg = `✓ ${parsed.jobNumber} completed & active. End date: ${endDate.toISOString().slice(0, 10)}.`;

        // Notify agent of job completion
        await sendSmsInternal(
            booking.agent_phone,
            `Hi ${booking.agent_name}, staging is complete at ${booking.address} (${parsed.jobNumber}). ` +
            `6-week period ends ${endDate.toISOString().slice(0, 10)}. — Modern Space Styling`,
            parsed.jobNumber
        );
    }
    else if (parsed.action === 'PICKEDUP') {
        updates = { status: 'closed' };
        replyMsg = `✓ ${parsed.jobNumber} closed — pickup confirmed.`;
    }
    else if (parsed.action === 'EXTEND') {
        const currentEnd = new Date(booking.end_date);
        currentEnd.setDate(currentEnd.getDate() + parsed.weeks * 7);
        const newEnd = currentEnd.toISOString().slice(0, 10);
        updates = { end_date: newEnd, status: 'active' };
        replyMsg = `✓ ${parsed.jobNumber} extended ${parsed.weeks}W. New end: ${newEnd}.`;

        // Notify agent
        await sendSmsInternal(
            booking.agent_phone,
            `Hi ${booking.agent_name}, ${parsed.jobNumber} at ${booking.address} extended by ${parsed.weeks} week(s). ` +
            `New end date: ${newEnd}. — Modern Space Styling`,
            parsed.jobNumber
        );
    }

    // Apply update
    await supabase.from('bookings').update(updates).eq('id', booking.id);
    await supabase.from('activity_log').insert({
        message: `${parsed.action} received for ${parsed.jobNumber} from ${verified.name} (${from})`,
        actor: verified.name,
    });

    // Update SMS log with job number
    await supabase.from('sms_log').update({ job_number: parsed.jobNumber })
        .eq('from_number', from)
        .is('job_number', null)
        .order('created_at', { ascending: false })
        .limit(1);

    twiml.message(replyMsg);
    return res.type('text/xml').send(twiml.toString());
};

// Internal helper — calls send-sms via Supabase client directly (no HTTP)
async function sendSmsInternal(to, body, jobNumber) {
    const client = require('twilio')(
        process.env.TWILIO_ACCOUNT_SID,
        process.env.TWILIO_AUTH_TOKEN
    );
    try {
        const msg = await client.messages.create({
            from: process.env.TWILIO_PHONE_NUMBER,
            to,
            body,
        });
        const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
        await supabase.from('sms_log').insert({
            direction: 'outbound',
            to_number: to,
            from_number: process.env.TWILIO_PHONE_NUMBER,
            body,
            job_number: jobNumber,
            status: 'sent',
            twilio_sid: msg.sid,
        });
    } catch (err) {
        console.error('[twilio-incoming] Failed to send reply SMS:', err.message);
    }
}
