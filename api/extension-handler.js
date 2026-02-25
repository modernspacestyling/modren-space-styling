/**
 * /api/extension-handler.js — Vercel Cron Job handler
 *
 * Set up in Vercel as a cron job running daily at 8am AEST:
 *   vercel.json crons entry:
 *   { "path": "/api/extension-handler", "schedule": "0 22 * * *" }
 *   (22:00 UTC = 08:00 AEST / 09:00 AEDT)
 *
 * What it does:
 *   1. Finds active jobs ending in exactly 5 days → sends extension warning SMS
 *   2. Finds active jobs past end date → moves to pickup_ready, sends pickup alert
 *   3. Finds jobs ending in 7 days → admin countdown alert
 */

const { createClient } = require('@supabase/supabase-js');
const twilio = require('twilio');

// ── Date helpers ──
function today() {
    return new Date().toISOString().slice(0, 10);
}
function addDays(dateStr, n) {
    const d = new Date(dateStr);
    d.setDate(d.getDate() + n);
    return d.toISOString().slice(0, 10);
}
function fmtDate(dateStr) {
    if (!dateStr) return '—';
    return new Date(dateStr).toLocaleDateString('en-AU', {
        day: '2-digit', month: 'short', year: 'numeric'
    });
}

// Twilio helper
async function sendSms(to, body, jobNumber, supabase) {
    if (!process.env.TWILIO_ACCOUNT_SID || !to) return;
    const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    try {
        const msg = await client.messages.create({
            from: process.env.TWILIO_PHONE_NUMBER, to, body,
        });
        await supabase.from('sms_log').insert({
            direction: 'outbound', to_number: to,
            from_number: process.env.TWILIO_PHONE_NUMBER,
            body, job_number: jobNumber, status: 'sent', twilio_sid: msg.sid,
        });
        return true;
    } catch (err) {
        console.error('[extension-handler] SMS error →', to, err.message);
        return false;
    }
}

module.exports = async function handler(req, res) {
    // Vercel cron sends GET. Also allow POST for manual trigger with auth.
    if (req.method === 'POST') {
        const token = req.headers['x-admin-token'] || req.body?.adminToken;
        if (token !== process.env.ADMIN_SECRET_TOKEN) {
            return res.status(403).json({ error: 'Forbidden' });
        }
    } else if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const supabase = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    const todayStr = today();
    const in5Days = addDays(todayStr, 5);
    const in7Days = addDays(todayStr, 7);

    const results = {
        warningsSent: 0,
        overdueMarked: 0,
        adminAlerts: 0,
        errors: [],
    };

    // ── 1. Fetch all active + confirmed jobs ──
    const { data: activeJobs, error: fetchErr } = await supabase
        .from('bookings')
        .select('*')
        .in('status', ['active', 'confirmed'])
        .not('end_date', 'is', null);

    if (fetchErr) {
        console.error('[extension-handler] Fetch error:', fetchErr);
        return res.status(500).json({ error: fetchErr.message });
    }

    const { data: templates } = await supabase.from('sms_templates').select('key, body');
    const tplMap = {};
    (templates || []).forEach(t => (tplMap[t.key] = t.body));

    function fillTemplate(key, booking) {
        const tpl = tplMap[key] || '';
        return tpl
            .replace(/{agentName}/g, booking.agent_name || '')
            .replace(/{jobNumber}/g, booking.job_number || '')
            .replace(/{address}/g, booking.address || '')
            .replace(/{date}/g, fmtDate(booking.install_date))
            .replace(/{time}/g, booking.install_time || '')
            .replace(/{endDate}/g, fmtDate(booking.end_date));
    }

    const adminPhone = process.env.ADMIN_PHONE || null;

    for (const booking of activeJobs || []) {
        const endDate = booking.end_date;

        try {
            // ── Overdue: past end date → mark pickup_ready ──
            if (endDate < todayStr && booking.status === 'active') {
                await supabase
                    .from('bookings')
                    .update({ status: 'pickup_ready' })
                    .eq('id', booking.id);

                await supabase.from('activity_log').insert({
                    message: `${booking.job_number} auto-marked pickup_ready (end date was ${endDate})`,
                    actor: 'System (Cron)',
                });

                const pickupSms = fillTemplate('pickup_alert', booking);
                if (adminPhone) await sendSms(adminPhone, pickupSms, booking.job_number, supabase);

                // Also notify transport if available
                const { data: transport } = await supabase
                    .from('verified_numbers')
                    .select('phone_number')
                    .eq('role', 'transport')
                    .eq('active', true);
                for (const t of (transport || [])) {
                    await sendSms(t.phone_number, pickupSms, booking.job_number, supabase);
                }

                results.overdueMarked++;
            }

            // ── 5-day warning ──
            else if (endDate === in5Days) {
                const msg = fillTemplate('extension_warn', booking);
                const sent = await sendSms(booking.agent_phone, msg, booking.job_number, supabase);
                if (sent) {
                    await supabase.from('activity_log').insert({
                        message: `5-day extension warning sent to ${booking.agent_name} for ${booking.job_number}`,
                        actor: 'System (Cron)',
                    });
                    results.warningsSent++;
                }
                // Also alert admin
                if (adminPhone) {
                    await sendSms(
                        adminPhone,
                        `REMINDER: ${booking.job_number} ends in 5 days (${endDate}) — ${booking.address}`,
                        booking.job_number,
                        supabase
                    );
                }
            }

            // ── 7-day countdown (admin dashboard alert) ──
            else if (endDate === in7Days) {
                await supabase.from('activity_log').insert({
                    message: `7-day countdown alert: ${booking.job_number} ends ${endDate} — ${booking.address}`,
                    actor: 'System (Cron)',
                });
                results.adminAlerts++;
            }
        } catch (err) {
            console.error(`[extension-handler] Error processing ${booking.job_number}:`, err.message);
            results.errors.push({ jobNumber: booking.job_number, error: err.message });
        }
    }

    console.log('[extension-handler] Complete:', results);
    return res.status(200).json({ success: true, processed: (activeJobs || []).length, ...results });
};
