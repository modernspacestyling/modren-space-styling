/**
 * /api/hashtag-research.js
 *
 * Admin-only endpoint: run hashtag research for one niche using SerpAPI +
 * Apify (keys live in Vercel env: SERPAPI_KEY, APIFY_TOKEN).
 *
 *   GET /api/hashtag-research?niche=gwagon[&geo=AU][&offline=1]
 *   GET /api/hashtag-research?list=1       → available niches (still auth'd)
 *
 * Security:
 *   - Requires "Authorization: Bearer <supabase-jwt>" header
 *   - JWT verified via Supabase; user.email must be in ADMIN_EMAILS
 *   - Rate limited per IP (Apify runs cost credits)
 */

const { createClient } = require('@supabase/supabase-js');
const { NICHES, researchNiche } = require('../lib/hashtag-research');

const ADMIN_EMAILS = new Set([
    'modernspacestyling@gmail.com',
    'bhumika.sood1@gmail.com',
    'rathore6@gmail.com',
    'hundalteji@gmail.com',
]);

const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW_MS = 10 * 60_000;
const RATE_LIMIT_MAX = 12;
function isRateLimited(ip) {
    const now = Date.now();
    const entry = rateLimitMap.get(ip) || { count: 0, start: now };
    if (now - entry.start > RATE_LIMIT_WINDOW_MS) { rateLimitMap.set(ip, { count: 1, start: now }); return false; }
    entry.count++;
    rateLimitMap.set(ip, entry);
    return entry.count > RATE_LIMIT_MAX;
}

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', 'https://www.modernspacestyling.com.au');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') { res.status(204).end(); return; }
    if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed' }); return; }

    try {
        const authHeader = req.headers.authorization || req.headers.Authorization || '';
        const match = authHeader.match(/^Bearer\s+(.+)$/i);
        if (!match) { res.status(401).json({ error: 'Missing Authorization header' }); return; }
        const jwt = match[1];

        const supabaseUrl = (process.env.SUPABASE_URL || '').trim();
        const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
        if (!supabaseUrl || !serviceRoleKey) { res.status(500).json({ error: 'Server not configured' }); return; }

        const authClient = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
        const { data: userData, error: userErr } = await authClient.auth.getUser(jwt);
        if (userErr || !userData || !userData.user) { res.status(401).json({ error: 'Invalid or expired session' }); return; }
        const email = (userData.user.email || '').toLowerCase();
        if (!ADMIN_EMAILS.has(email)) { res.status(403).json({ error: 'Not authorised' }); return; }

        const q = req.query || {};
        if (q.list) {
            res.status(200).json({
                success: true,
                niches: Object.entries(NICHES).map(([key, n]) => ({ key, label: n.label, seeds: n.seeds })),
                serpapi: !!(process.env.SERPAPI_KEY || process.env.SERPAPI_API_KEY),
                apify: !!(process.env.APIFY_TOKEN || process.env.APIFY_API_TOKEN),
            });
            return;
        }

        const niche = String(q.niche || '').trim();
        if (!NICHES[niche]) { res.status(400).json({ error: `Unknown niche. Use one of: ${Object.keys(NICHES).join(', ')}` }); return; }

        const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || 'unknown';
        if (isRateLimited(ip)) { res.status(429).json({ error: 'Too many research runs. Wait a few minutes.' }); return; }

        const offline = q.offline === '1' || q.offline === 'true';
        const geo = /^[A-Z]{2}$/.test(String(q.geo || '')) ? String(q.geo) : 'AU';
        const report = await researchNiche(niche, {
            geo,
            serpApiKey: offline ? null : undefined,
            apifyToken: offline ? null : undefined,
            // keep serverless runs inside Vercel's function timeout
            instagramLimit: 30,
            tiktokLimit: 25,
        });
        res.status(200).json({ success: true, report });
    } catch (e) {
        console.error('[hashtag-research] unexpected:', e);
        res.status(500).json({ error: e.message || 'Unexpected server error' });
    }
};
