import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import { addDays } from 'date-fns';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { agentName, agencyName, email, phone } = req.body;

    if (!agentName || !agencyName || !email || !phone) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    // Check if email already registered
    const { data: existing, error: checkErr } = await supabase
      .from('agent_registrations')
      .select('id')
      .eq('email', email)
      .single();

    if (existing) {
      return res.status(409).json({ error: 'Email already registered. Please contact support.' });
    }

    // Generate unique agent code (e.g., MSS-ABC123XYZ)
    const agentCode = 'MSS-' + crypto.randomBytes(6).toString('hex').toUpperCase().slice(0, 9);

    // Set locked_until to 1 year from today
    const lockedUntil = addDays(new Date(), 365).toISOString().split('T')[0];

    // Insert registration
    const { data, error } = await supabase
      .from('agent_registrations')
      .insert([
        {
          agent_name: agentName,
          agency_name: agencyName,
          email,
          phone,
          agent_code: agentCode,
          pricing_tier: 'agent',
          locked_until: lockedUntil,
          status: 'active'
        }
      ])
      .select('agent_code, locked_until')
      .single();

    if (error) {
      console.error('Supabase error:', error);
      return res.status(500).json({ error: 'Registration failed. Please try again.' });
    }

    // Send confirmation email (optional, best-effort)
    try {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.RESEND_API_KEY}`
        },
        body: JSON.stringify({
          from: 'modernspacestyling@gmail.com',
          to: email,
          subject: 'Your MSS Agent Registration Confirmed',
          html: `
            <h2>Welcome to Modern Space Styling Agent Program</h2>
            <p>Hi ${agentName},</p>
            <p>Your agent code is: <strong>${agentCode}</strong></p>
            <p>Use this code when booking photography services to receive locked-in discounted rates.</p>
            <p>Your registration is valid until <strong>${lockedUntil}</strong>.</p>
            <p>Best regards,<br>Modern Space Styling Team</p>
          `
        })
      });
    } catch (err) {
      console.warn('Email send failed (non-fatal):', err.message);
    }

    return res.status(200).json({
      success: true,
      agentCode: data.agent_code,
      lockedUntil: data.locked_until
    });
  } catch (err) {
    console.error('Error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
}
