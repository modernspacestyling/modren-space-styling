/**
 * /api/agent-approval.js — Admin-only agent approval endpoint
 *
 * POST body: { agentId: string, action: "approve" | "reject", adminToken: string }
 */

const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const twilio = require('twilio');

function sanitize(str, max = 200) {
    if (typeof str !== 'string') return '';
    return str.trim().slice(0, max).replace(/[<>]/g, '');
}

module.exports = async function handler(req, res) {
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    // ── Admin auth ──
    const adminToken = req.headers['x-admin-token'] || req.body?.adminToken;
    if (!adminToken || adminToken !== process.env.ADMIN_SECRET_TOKEN) {
        return res.status(403).json({ error: 'Forbidden — admin access required' });
    }

    const { agentId, action } = req.body;

    if (!agentId || !action) {
        return res.status(400).json({ error: 'Missing agentId or action' });
    }

    if (!['approve', 'reject'].includes(action)) {
        return res.status(400).json({ error: 'action must be "approve" or "reject"' });
    }

    const supabase = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    // ── Fetch agent ──
    const { data: agent, error: fetchErr } = await supabase
        .from('agents')
        .select('*')
        .eq('id', sanitize(agentId, 50))
        .single();

    if (!agent || fetchErr) {
        return res.status(404).json({ error: 'Agent not found' });
    }

    if (agent.status !== 'pending') {
        return res.status(409).json({ error: `Agent is already ${agent.status}` });
    }

    // ── Apply action ──
    const newStatus = action === 'approve' ? 'approved' : 'rejected';
    const { error: updateErr } = await supabase
        .from('agents')
        .update({ status: newStatus, updated_at: new Date().toISOString() })
        .eq('id', agentId);

    if (updateErr) {
        return res.status(500).json({ error: 'Failed to update agent status' });
    }

    // ── Activity log ──
    await supabase.from('activity_log').insert({
        message: `Agent ${agent.email} (${agent.name}) ${newStatus} by admin`,
        actor: 'Admin',
    });

    // ── Send SMS to agent ──
    if (process.env.TWILIO_ACCOUNT_SID && agent.phone) {
        const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
        let smsBody = '';

        if (newStatus === 'approved') {
            smsBody =
                `Hi ${agent.name}, your Modern Space Styling agent account has been approved! ` +
                `Login at: https://www.modernspacestyling.com.au/portal/login.html — Welcome aboard!`;
        } else {
            smsBody =
                `Hi ${agent.name}, unfortunately your Modern Space Styling agent registration could not be approved at this time. ` +
                `Please contact us at modrenspacestyling@gmail.com for assistance.`;
        }

        try {
            const msg = await client.messages.create({
                from: process.env.TWILIO_PHONE_NUMBER,
                to: agent.phone,
                body: smsBody,
            });
            await supabase.from('sms_log').insert({
                direction: 'outbound', to_number: agent.phone,
                from_number: process.env.TWILIO_PHONE_NUMBER,
                body: smsBody, status: 'sent', twilio_sid: msg.sid,
            });
        } catch (err) {
            console.error('[agent-approval] SMS failed:', err.message);
        }
    }

    return res.status(200).json({
        success: true,
        agentId,
        status: newStatus,
        message: `Agent ${newStatus} successfully. SMS sent to ${agent.phone || 'N/A'}.`,
    });
};
