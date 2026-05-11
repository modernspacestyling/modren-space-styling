/**
 * /api/cron-keepalive.js
 *
 * Vercel cron job that pings Supabase every 3 days to prevent the
 * free-tier 7-day inactivity auto-pause.
 *
 * Triggered by the schedule defined in vercel.json -> crons.
 * Vercel cron requests carry an Authorization header with CRON_SECRET
 * (set as a Vercel env var) so this endpoint cannot be abused publicly.
 *
 * The query is intentionally tiny — just a count against bookings.
 */

const { createClient } = require('@supabase/supabase-js');

module.exports = async (req, res) => {
    // Vercel cron auth — see https://vercel.com/docs/cron-jobs/manage-cron-jobs#securing-cron-jobs
    const cronSecret = process.env.CRON_SECRET;
    if (cronSecret) {
        const auth = req.headers.authorization || '';
        if (auth !== `Bearer ${cronSecret}`) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }
    }

    const url = (process.env.SUPABASE_URL || '').trim();
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
        res.status(500).json({ error: 'Supabase env missing' });
        return;
    }

    try {
        const supabase = createClient(url, key, {
            auth: { persistSession: false, autoRefreshToken: false }
        });
        const { count, error } = await supabase
            .from('bookings')
            .select('*', { count: 'exact', head: true });

        if (error) {
            console.error('[cron-keepalive] supabase error:', error);
            res.status(500).json({ ok: false, error: error.message });
            return;
        }

        res.status(200).json({
            ok: true,
            ts: new Date().toISOString(),
            bookings_count: count ?? 0,
        });
    } catch (e) {
        console.error('[cron-keepalive] unexpected:', e);
        res.status(500).json({ ok: false, error: e.message || 'unknown' });
    }
};
