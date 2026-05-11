/**
 * /api/my-bookings.js — Return the signed-in user's bookings.
 *
 * Authentication: HTTP Authorization: Bearer <supabase access_token>.
 *   - We validate the token against Supabase Auth using the publishable key.
 *   - We extract the user's email from the verified user object.
 *   - We then query the bookings table using the service role key, filtered
 *     by agent_email matching the verified email.
 *
 * Why service role for the read?
 *   The bookings table has RLS enabled but doesn't yet have customer-scoped
 *   policies. Using the service role server-side AFTER verifying the token
 *   gives us the same effect — the API itself is the security boundary.
 *
 * Returns: { bookings: [...] } ordered by most recent install_date first.
 *
 * Only safe fields are returned (job_number, status, address, install_date,
 * bedrooms, end_date, agent_name, agent_phone, agent_email, agency, notes).
 * Never returns: lockbox_enc, internal IDs, pricing_data, raw user data.
 */

const { createClient } = require('@supabase/supabase-js');

// Public columns customers are allowed to see on their own bookings.
// Explicitly excludes lockbox_enc and any internal-only field.
const SAFE_COLUMNS = [
  'job_number',
  'status',
  'agent_name',
  'agent_phone',
  'agent_email',
  'agency',
  'address',
  'install_date',
  'install_time',
  'end_date',
  'bedrooms',
  'bathrooms',
  'living_areas',
  'dining_areas',
  'notes',
  'estimated_price',
  'created_at',
].join(',');

module.exports = async function handler(req, res) {
  // CORS preflight
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  // Extract bearer token
  const authHeader = req.headers['authorization'] || req.headers['Authorization'] || '';
  const m = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!m) return res.status(401).json({ error: 'Missing Authorization header' });
  const accessToken = m[1].trim();
  if (!accessToken) return res.status(401).json({ error: 'Empty access token' });

  // Sanity envs
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: 'Server misconfigured' });
  }

  // Validate token — ask Supabase Auth who this token belongs to.
  // We use the service role client + getUser(jwt) which verifies signature
  // and expiry server-side.
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  let userEmail = null;
  try {
    const { data: userData, error: userErr } = await supabase.auth.getUser(accessToken);
    if (userErr || !userData?.user) {
      return res.status(401).json({ error: 'Invalid or expired session' });
    }
    userEmail = (userData.user.email || '').toLowerCase();
    if (!userEmail) {
      return res.status(401).json({ error: 'User has no email' });
    }
  } catch (e) {
    console.error('[my-bookings] getUser failed', e);
    return res.status(401).json({ error: 'Could not verify session' });
  }

  // Query bookings owned by this user's email (case-insensitive match).
  // We store agent_email lowercased on insert (see create-booking.js) so
  // ilike '=' style match is sufficient.
  let bookings;
  try {
    const { data, error: queryErr } = await supabase
      .from('bookings')
      .select(SAFE_COLUMNS)
      .eq('agent_email', userEmail)
      .order('install_date', { ascending: false })
      .limit(50);
    if (queryErr) throw queryErr;
    bookings = data || [];
  } catch (e) {
    console.error('[my-bookings] query failed', e);
    return res.status(500).json({ error: 'Could not load bookings' });
  }

  // Also include photo bookings (separate table — same email column).
  // Fail-soft: if photo_bookings table doesn't exist or query fails,
  // we still return staging bookings.
  try {
    const { data: photo } = await supabase
      .from('photo_bookings')
      .select('job_number, status, client_name, client_phone, client_email, agency, address, preferred_date, package, bedrooms, bathrooms, notes, estimated_price, created_at')
      .eq('client_email', userEmail)
      .order('preferred_date', { ascending: false })
      .limit(50);
    if (photo && photo.length) {
      // Normalise photo bookings into the same shape as staging bookings
      // so the frontend can render them with a single template.
      const normalised = photo.map(p => ({
        job_number: p.job_number,
        status: p.status,
        agent_name: p.client_name,
        agent_phone: p.client_phone,
        agent_email: p.client_email,
        agency: p.agency,
        address: p.address,
        install_date: p.preferred_date,
        install_time: null,
        end_date: null,
        bedrooms: p.bedrooms,
        bathrooms: p.bathrooms,
        living_areas: null,
        dining_areas: null,
        notes: p.notes,
        estimated_price: p.estimated_price,
        created_at: p.created_at,
        package: p.package,
      }));
      bookings = bookings.concat(normalised);
      // Re-sort the merged list by install_date desc.
      bookings.sort((a, b) => {
        const da = a.install_date ? new Date(a.install_date).getTime() : 0;
        const db = b.install_date ? new Date(b.install_date).getTime() : 0;
        return db - da;
      });
    }
  } catch (e) {
    // Non-fatal — staging bookings still returned above.
    console.warn('[my-bookings] photo_bookings fetch failed (non-fatal)', e.message);
  }

  return res.status(200).json({ bookings });
};
