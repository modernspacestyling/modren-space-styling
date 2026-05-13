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

    // ── v1.2: Multiplexed action — admin invite (uses Bearer JWT + admin_users membership) ──
    const queryAction = (req.query && req.query.action) || (req.body && req.body.action);
    if (queryAction === 'invite_admin') {
        return inviteAdmin(req, res);
    }

    // ── Admin auth (legacy static-token path for approve/reject) ──
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

// ── v1.2 admin invite — gated on Bearer JWT + admin_users membership ──
async function inviteAdmin(req, res) {
    const authHeader = req.headers['authorization'] || req.headers['Authorization'] || '';
    const m = authHeader.match(/^Bearer\s+(.+)$/i);
    if (!m) return res.status(401).json({ error: 'Missing Authorization header' });
    const token = m[1].trim();

    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
        return res.status(500).json({ error: 'Server misconfigured' });
    }
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

    // Verify caller is signed in
    let callerId = null;
    let callerEmail = null;
    try {
        const { data: u, error: uErr } = await supabase.auth.getUser(token);
        if (uErr || !u?.user) return res.status(401).json({ error: 'Invalid or expired session' });
        callerId = u.user.id;
        callerEmail = (u.user.email || '').toLowerCase();
    } catch (e) {
        console.error('[invite_admin] getUser failed', e);
        return res.status(401).json({ error: 'Could not verify session' });
    }

    // Verify caller is an admin
    const { data: adminRow, error: aErr } = await supabase
        .from('admin_users')
        .select('id')
        .eq('id', callerId)
        .maybeSingle();
    if (aErr || !adminRow) {
        return res.status(403).json({ error: 'Not an admin' });
    }

    // Validate input
    const email = sanitize((req.body && req.body.email) || '', 100).toLowerCase();
    const full_name = sanitize((req.body && req.body.full_name) || '', 100);
    if (!email || !full_name) {
        return res.status(400).json({ error: 'email + full_name are required' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ error: 'Invalid email address' });
    }

    // v1.3: enforce max 4 admins (DB trigger backs this up).
    // Skip the cap if this email is ALREADY an admin (re-sending an invite is fine).
    const { count: adminCount } = await supabase
        .from('admin_users')
        .select('*', { count: 'exact', head: true });
    const { data: existingAdmin } = await supabase
        .from('admin_users')
        .select('id')
        .eq('email', email)
        .maybeSingle();
    if (!existingAdmin && (adminCount || 0) >= 4) {
        return res.status(400).json({ error: 'Admin limit reached: maximum 4 admin accounts. Remove an admin in Supabase before adding another.' });
    }

    // Send Supabase invite (creates the auth user + emails them a set-password link)
    let invitedUserId = null;
    try {
        const redirectTo = (req.headers['origin'] || 'https://www.modernspacestyling.com.au') + '/admin/login.html';
        const { data: inv, error: invErr } = await supabase.auth.admin.inviteUserByEmail(email, { redirectTo });
        if (invErr) {
            // If the user already exists in auth.users, look them up so we can still promote to admin.
            if (/already.*registered|already.*exists/i.test(invErr.message || '')) {
                const { data: list } = await supabase.auth.admin.listUsers();
                const existing = (list && list.users || []).find(u => (u.email || '').toLowerCase() === email);
                if (!existing) return res.status(400).json({ error: invErr.message });
                invitedUserId = existing.id;
            } else {
                return res.status(400).json({ error: invErr.message });
            }
        } else {
            invitedUserId = inv?.user?.id || null;
        }
    } catch (e) {
        console.error('[invite_admin] inviteUserByEmail failed', e);
        return res.status(500).json({ error: 'Invite failed: ' + (e.message || 'unknown') });
    }
    if (!invitedUserId) return res.status(500).json({ error: 'Invite returned no user id' });

    // Insert (or no-op) into admin_users
    const { error: insErr } = await supabase
        .from('admin_users')
        .upsert({ id: invitedUserId, email, full_name, added_by: callerId }, { onConflict: 'id' });
    if (insErr) {
        console.error('[invite_admin] admin_users upsert failed', insErr);
        return res.status(500).json({ error: 'Invited, but admin_users save failed: ' + insErr.message });
    }

    // Activity log
    await supabase.from('activity_log').insert({
        message: `Admin invited: ${email} (${full_name}) by ${callerEmail}`,
        actor: callerEmail,
    }).then(() => {}, () => {}); // best-effort

    return res.status(200).json({ success: true, user_id: invitedUserId });
}
