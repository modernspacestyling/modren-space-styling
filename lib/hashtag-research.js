/**
 * lib/hashtag-research.js
 *
 * Hashtag research engine for personal / lifestyle content
 * (luxury cars, business-class travel, etc.).
 *
 * Data sources (both optional — the engine degrades gracefully):
 *   - SerpAPI  (env SERPAPI_KEY)   → Google Trends related queries, Google
 *                                     autocomplete, YouTube search titles.
 *   - Apify    (env APIFY_TOKEN)   → Instagram hashtag scraper + TikTok
 *                                     hashtag scraper (real posts, real
 *                                     engagement, co-occurring hashtags).
 *
 * With no keys set at all the engine still returns a curated seed set so the
 * caller always gets a usable, copy-paste hashtag block.
 *
 * Public API:
 *   NICHES                         → { key: { label, seeds, curated } }
 *   researchNiche(nicheKey, opts)  → Promise<Report>
 *   researchAll(opts)              → Promise<Report[]>
 *   formatReportMarkdown(report)   → string
 *
 * Pure helpers exported for tests: normalizeTag, extractTags, scoreTags,
 * bucketTags, buildSet.
 */

'use strict';

// ─────────────────────────────────────────────────────────────
// Niche definitions
// ─────────────────────────────────────────────────────────────
// `seeds`   – hashtags handed to Apify/SerpAPI as the starting point.
// `queries` – natural-language phrases for Google Trends / autocomplete / YouTube.
// `curated` – always-good tags shipped offline; merged with live results.
const NICHES = {
    gwagon: {
        label: 'Mercedes G-Wagon',
        seeds: ['gwagon', 'g63', 'gclass', 'amgg63', 'mercedesamg'],
        queries: ['g wagon', 'mercedes g63 amg', 'g class'],
        curated: [
            'gwagon', 'g63', 'g63amg', 'gclass', 'amgg63', 'gwagen', 'mercedesamg', 'mercedesbenz',
            'gwagonlife', 'g63brabus', 'brabus', 'mercedesg63', 'g500', 'gwagonnation', 'amg',
            'luxurycars', 'luxurylifestyle', 'carsofinstagram', 'carlifestyle', 'supercars',
            'dreamcar', 'carporn', 'exoticcars', 'carspotting', 'luxurysuv', 'blackonblack',
            'carswithoutlimits', 'instacar', 'carphotography', 'reels',
        ],
    },
    lamborghini: {
        label: 'Lamborghini',
        seeds: ['lamborghini', 'lambo', 'urus', 'huracan', 'aventador'],
        queries: ['lamborghini', 'lamborghini urus', 'lamborghini huracan'],
        curated: [
            'lamborghini', 'lambo', 'lamborghiniurus', 'urus', 'huracan', 'aventador', 'revuelto',
            'lamborghinihuracan', 'lamborghiniaventador', 'lambolife', 'lamborghinilovers',
            'supercar', 'supercars', 'hypercar', 'exoticcars', 'carporn', 'luxurycars',
            'carsofinstagram', 'carlifestyle', 'dreamcar', 'carspotting', 'itswhitenoise',
            'blacklist', 'amazingcars247', 'carswithoutlimits', 'luxurylifestyle', 'millionairelifestyle',
            'instacar', 'carphotography', 'reels',
        ],
    },
    defender: {
        label: 'Land Rover Defender',
        seeds: ['defender', 'landroverdefender', 'defender110', 'newdefender'],
        queries: ['land rover defender', 'defender 110', 'defender 130'],
        curated: [
            'defender', 'landroverdefender', 'landrover', 'defender110', 'defender90', 'defender130',
            'newdefender', 'defenderlife', 'defenderocta', 'defenderv8', 'landroverlife', 'landroverlovers',
            'offroad', 'overland', 'overlanding', 'adventure', 'adventurevehicle', '4x4', '4x4life',
            'luxurysuv', 'suv', 'carsofinstagram', 'carlifestyle', 'luxurycars', 'roadtrip',
            'explore', 'wanderlust', 'instacar', 'carphotography', 'reels',
        ],
    },
    rangerover: {
        label: 'Range Rover Autobiography',
        seeds: ['rangerover', 'rangeroverautobiography', 'autobiography', 'rangeroversport'],
        queries: ['range rover autobiography', 'range rover 2025', 'range rover sv'],
        curated: [
            'rangerover', 'rangeroverautobiography', 'autobiography', 'rangeroversport', 'rangeroversv',
            'rangerovervogue', 'landrover', 'rangeroverlife', 'rangeroverlovers', 'rangerovervelar',
            'luxurysuv', 'luxurycars', 'luxurylifestyle', 'suv', 'carsofinstagram', 'carlifestyle',
            'dreamcar', 'carporn', 'britishluxury', 'blackonblack', 'carswithoutlimits', 'instacar',
            'carphotography', 'luxury', 'richlifestyle', 'billionairelifestyle', 'carspotting',
            'exoticcars', 'chauffeur', 'reels',
        ],
    },
    mustang: {
        label: 'Ford Mustang',
        seeds: ['mustang', 'fordmustang', 'mustanggt', 'shelby'],
        queries: ['ford mustang', 'mustang gt', 'shelby gt500'],
        curated: [
            'mustang', 'fordmustang', 'mustanggt', 'mustangnation', 'mustanglovers', 'shelby',
            'shelbygt500', 'gt500', 'darkhorse', 'mustangdarkhorse', 'musclecar', 'musclecars',
            'americanmuscle', 'v8', 'v8power', 'ford', 'fordperformance', 'stang', 'mustangfanclub',
            'carsofinstagram', 'carlifestyle', 'carporn', 'dreamcar', 'carspotting', 'carswithoutlimits',
            'exhaustsound', 'burnout', 'instacar', 'carphotography', 'reels',
        ],
    },
    businessclass: {
        label: 'Business Class Travel',
        seeds: ['businessclass', 'firstclass', 'luxurytravel', 'flyingbusinessclass'],
        queries: ['business class', 'business class flight', 'emirates business class', 'qantas business class'],
        curated: [
            'businessclass', 'firstclass', 'businessclassflight', 'flyingbusinessclass', 'luxurytravel',
            'travelinstyle', 'aviation', 'avgeek', 'lounge', 'airportlounge', 'emirates', 'qatarairways',
            'singaporeairlines', 'qantas', 'etihad', 'flatbed', 'liedownseat', 'inflight', 'jetsetter',
            'jetset', 'luxurylifestyle', 'travelgram', 'travel', 'instatravel', 'travelphotography',
            'wanderlust', 'frequentflyer', 'pointsandmiles', 'traveldiaries', 'reels',
        ],
    },
    luxurylifestyle: {
        label: 'Luxury Lifestyle (cross-niche)',
        seeds: ['luxurylifestyle', 'luxurycars', 'richlifestyle', 'lifestyle'],
        queries: ['luxury lifestyle', 'luxury cars', 'rich lifestyle'],
        curated: [
            'luxurylifestyle', 'luxury', 'luxurycars', 'luxurylife', 'richlifestyle', 'millionairelifestyle',
            'billionairelifestyle', 'lifestyle', 'success', 'motivation', 'hustle', 'entrepreneur',
            'entrepreneurlife', 'businessowner', 'goals', 'dreambig', 'mindset', 'grind', 'wealth',
            'luxurytravel', 'supercars', 'carsofinstagram', 'dreamcar', 'exoticcars', 'jetset',
            'moneymotivation', 'successmindset', 'lifegoals', 'viral', 'reels',
        ],
    },
};

// Very generic tags that are so large they get buried in seconds.
// They still belong in the "broad" bucket but never dominate the set.
const MEGA_TAGS = new Set([
    'love', 'instagood', 'photooftheday', 'fashion', 'beautiful', 'happy', 'cute', 'tbt', 'like4like',
    'followme', 'picoftheday', 'follow', 'me', 'selfie', 'summer', 'art', 'instadaily', 'friends',
    'repost', 'nature', 'girl', 'fun', 'style', 'smile', 'food', 'instalike', 'likeforlike',
    'family', 'travel', 'fitness', 'fyp', 'foryou', 'foryoupage', 'viral', 'explore', 'explorepage',
    'reels', 'reelsinstagram', 'trending', 'instagram', 'tiktok',
]);

// Tags that are spammy / banned-ish / hurt reach. Always dropped.
const BLOCKED_TAGS = new Set([
    'like4like', 'likeforlike', 'follow4follow', 'followforfollow', 'f4f', 'l4l', 'followme',
    'likeforlikes', 'follow4followback', 'followback', 'sfs', 'shoutout', 'gainpost', 'nsfw',
    'adulting', 'alone', 'always', 'asia', 'assday', 'beautyblogger', 'boho', 'brain', 'costumes',
    'curvy', 'dating', 'desk', 'direct', 'dm', 'easter', 'elevator', 'humpday', 'iphonegraphy',
    'kansas', 'kickoff', 'killingit', 'master', 'models', 'mustfollow', 'newyears', 'petite',
    'pornfood', 'pushups', 'saltwater', 'shower', 'single', 'skateboarding', 'snap', 'snowstorm',
    'stranger', 'streetphoto', 'sunbathing', 'tag4like', 'tagsforlikes', 'teens', 'thought',
    'valentinesday', 'workflow', 'goddess', 'hardworkpaysoff', 'italiano', 'undies',
]);

// ─────────────────────────────────────────────────────────────
// Pure helpers
// ─────────────────────────────────────────────────────────────

/** "#G-Wagon!" → "gwagon". Returns '' for junk. Keeps unicode letters/digits. */
function normalizeTag(raw) {
    if (!raw) return '';
    let t = String(raw).trim().toLowerCase();
    t = t.replace(/^#+/, '');
    t = t.replace(/[\s\-.'’"!?,;:()\[\]{}/\\|+*&%$@^~`<>=]+/g, '');
    // Keep letters (any script), digits and underscore only
    t = t.replace(/[^\p{L}\p{N}_]/gu, '');
    if (!t || t.length < 2 || t.length > 40) return '';
    if (/^\d+$/.test(t)) return '';
    return t;
}

/** Pull every #hashtag out of free text (captions, titles). */
function extractTags(text) {
    if (!text) return [];
    const out = [];
    const re = /#([\p{L}\p{N}_]+)/gu;
    let m;
    while ((m = re.exec(String(text)))) {
        const t = normalizeTag(m[1]);
        if (t) out.push(t);
    }
    return out;
}

/** Turn a query phrase like "g wagon 2025 price" into a hashtag "gwagon2025price". */
function phraseToTag(phrase) {
    return normalizeTag(String(phrase || '').replace(/\s+/g, ''));
}

function median(nums) {
    const a = nums.filter(n => Number.isFinite(n)).sort((x, y) => x - y);
    if (!a.length) return 0;
    const mid = Math.floor(a.length / 2);
    return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

/**
 * Aggregate evidence about each tag into a single score.
 *
 * evidence: Array<{ tag, source, engagement?, views?, rising?, count?, postCount? }>
 *   source     'instagram' | 'tiktok' | 'trends' | 'autocomplete' | 'youtube' | 'curated'
 *   engagement likes+comments of the post the tag appeared on (instagram)
 *   views      play count of the video the tag appeared on (tiktok)
 *   rising     Google Trends "rising" percentage (trends)
 *   postCount  official IG postsCount for the hashtag (instagram, from hashtag meta)
 *
 * Returns Array<{ tag, score, sources, occurrences, medianEngagement, medianViews, postCount, rising }>
 * sorted by score desc.
 */
function scoreTags(evidence, seeds = []) {
    const seedSet = new Set(seeds.map(normalizeTag).filter(Boolean));
    const byTag = new Map();

    for (const ev of evidence) {
        const tag = normalizeTag(ev.tag);
        if (!tag || BLOCKED_TAGS.has(tag)) continue;
        let e = byTag.get(tag);
        if (!e) {
            e = { tag, sources: new Set(), occurrences: 0, engagements: [], views: [], postCount: 0, rising: 0, isSeed: seedSet.has(tag) };
            byTag.set(tag, e);
        }
        e.sources.add(ev.source);
        e.occurrences += ev.count || 1;
        if (Number.isFinite(ev.engagement)) e.engagements.push(ev.engagement);
        if (Number.isFinite(ev.views)) e.views.push(ev.views);
        if (Number.isFinite(ev.postCount)) e.postCount = Math.max(e.postCount, ev.postCount);
        if (Number.isFinite(ev.rising)) e.rising = Math.max(e.rising, ev.rising);
    }

    const rows = [];
    for (const e of byTag.values()) {
        const medianEngagement = median(e.engagements);
        const medianViews = median(e.views);
        // log-scaled so a single 10M-view post can't drown everything
        const freqScore = Math.log2(1 + e.occurrences) * 10;
        const engScore = Math.log10(1 + medianEngagement) * 6;
        const viewScore = Math.log10(1 + medianViews) * 4;
        const risingScore = Math.min(30, Math.log10(1 + e.rising) * 10);
        const sourceBonus = (e.sources.size - 1) * 8; // seen on multiple platforms → stronger
        const seedBonus = e.isSeed ? 5 : 0;
        const megaPenalty = MEGA_TAGS.has(e.tag) ? -15 : 0;
        const score = Math.round((freqScore + engScore + viewScore + risingScore + sourceBonus + seedBonus + megaPenalty) * 10) / 10;
        rows.push({
            tag: e.tag,
            score,
            sources: [...e.sources].sort(),
            occurrences: e.occurrences,
            medianEngagement: Math.round(medianEngagement),
            medianViews: Math.round(medianViews),
            postCount: e.postCount,
            rising: e.rising,
            isSeed: e.isSeed,
        });
    }
    rows.sort((a, b) => b.score - a.score || a.tag.localeCompare(b.tag));
    return rows;
}

/**
 * Split scored tags into reach buckets by Instagram post count when known,
 * falling back to a heuristic on tag genericness.
 *   broad  ≥ 5M posts  – discovery, very competitive
 *   mid    100k–5M     – the sweet spot for reach
 *   niche  < 100k      – rank #1 easily, targeted audience
 */
function bucketTags(rows) {
    const out = { broad: [], mid: [], niche: [] };
    for (const r of rows) {
        let bucket;
        if (r.postCount > 0) {
            bucket = r.postCount >= 5_000_000 ? 'broad' : r.postCount >= 100_000 ? 'mid' : 'niche';
        } else if (MEGA_TAGS.has(r.tag) || r.tag.length <= 5) {
            bucket = 'broad';
        } else if (r.tag.length >= 16 || /\d{2,}/.test(r.tag)) {
            bucket = 'niche';
        } else {
            bucket = 'mid';
        }
        out[bucket].push(r);
    }
    return out;
}

/**
 * Build the final copy-paste set: Instagram allows 30, TikTok works best ≤ 8.
 * Mix: ~20% broad, ~50% mid, ~30% niche. Seeds are always included first.
 */
function buildSet(rows, { size = 30, seeds = [] } = {}) {
    const buckets = bucketTags(rows);
    const nBroad = Math.max(1, Math.round(size * 0.2));
    const nNiche = Math.max(1, Math.round(size * 0.3));
    const nMid = size - nBroad - nNiche;

    const chosen = [];
    const seen = new Set();
    const push = (r) => { if (r && !seen.has(r.tag) && chosen.length < size) { seen.add(r.tag); chosen.push(r); } };

    for (const s of seeds.map(normalizeTag)) {
        const r = rows.find(x => x.tag === s);
        if (r) push(r);
    }
    buckets.broad.slice(0, nBroad).forEach(push);
    buckets.mid.slice(0, nMid).forEach(push);
    buckets.niche.slice(0, nNiche).forEach(push);
    // Fill any remaining slots with the best leftovers in score order
    for (const r of rows) push(r);

    return chosen;
}

// ─────────────────────────────────────────────────────────────
// HTTP helpers
// ─────────────────────────────────────────────────────────────
async function getJson(url, { method = 'GET', body, timeoutMs = 120_000, headers = {} } = {}) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
        const res = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json', ...headers },
            body: body ? JSON.stringify(body) : undefined,
            signal: ctrl.signal,
        });
        const text = await res.text();
        let json;
        try { json = JSON.parse(text); } catch { json = null; }
        if (!res.ok) {
            const msg = (json && (json.error?.message || json.error)) || text.slice(0, 200);
            throw new Error(`HTTP ${res.status}: ${msg}`);
        }
        return json;
    } finally {
        clearTimeout(timer);
    }
}

// ─────────────────────────────────────────────────────────────
// SerpAPI
// ─────────────────────────────────────────────────────────────
const SERPAPI_BASE = 'https://serpapi.com/search.json';

function serpUrl(params, key) {
    const u = new URL(SERPAPI_BASE);
    for (const [k, v] of Object.entries(params)) if (v != null) u.searchParams.set(k, String(v));
    u.searchParams.set('api_key', key);
    return u.toString();
}

/** Google Trends → related queries (top + rising) for a phrase. */
async function serpTrendsRelated(phrase, key, geo) {
    const json = await getJson(serpUrl({
        engine: 'google_trends', q: phrase, data_type: 'RELATED_QUERIES', geo: geo || undefined, date: 'today 3-m',
    }, key));
    const rq = json.related_queries || {};
    const ev = [];
    for (const r of rq.rising || []) {
        const pct = typeof r.value === 'number' ? r.value : parseInt(String(r.extracted_value || r.value || '0').replace(/\D/g, ''), 10) || 0;
        const tag = phraseToTag(r.query);
        if (tag) ev.push({ tag, source: 'trends', rising: pct, raw: r.query });
    }
    for (const r of rq.top || []) {
        const tag = phraseToTag(r.query);
        if (tag) ev.push({ tag, source: 'trends', count: 1, raw: r.query });
    }
    return ev;
}

/** Google autocomplete → what people actually type for a phrase. */
async function serpAutocomplete(phrase, key, gl) {
    const json = await getJson(serpUrl({ engine: 'google_autocomplete', q: phrase, gl: gl || undefined }, key));
    const ev = [];
    for (const s of json.suggestions || []) {
        const tag = phraseToTag(s.value);
        if (tag) ev.push({ tag, source: 'autocomplete', count: 1, raw: s.value });
    }
    return ev;
}

/** YouTube search → hashtags/keywords in titles+descriptions of top videos, weighted by views. */
async function serpYoutube(phrase, key) {
    const json = await getJson(serpUrl({ engine: 'youtube', search_query: phrase }, key));
    const ev = [];
    for (const v of json.video_results || []) {
        const views = Number(v.views) || 0;
        const tags = new Set([...extractTags(v.title), ...extractTags(v.description)]);
        for (const tag of tags) ev.push({ tag, source: 'youtube', views, count: 1 });
    }
    return ev;
}

async function runSerpApi(niche, key, { geo = 'AU', log = () => {} } = {}) {
    const ev = [];
    const errors = [];
    for (const phrase of niche.queries) {
        const tasks = [
            ['trends', () => serpTrendsRelated(phrase, key, geo)],
            ['autocomplete', () => serpAutocomplete(phrase, key, geo.toLowerCase())],
            ['youtube', () => serpYoutube(phrase, key)],
        ];
        const results = await Promise.allSettled(tasks.map(([, fn]) => fn()));
        results.forEach((r, i) => {
            const name = tasks[i][0];
            if (r.status === 'fulfilled') { ev.push(...r.value); log(`serpapi ${name} "${phrase}": ${r.value.length} tags`); }
            else { errors.push(`serpapi ${name} "${phrase}": ${r.reason.message}`); log(`serpapi ${name} "${phrase}" failed: ${r.reason.message}`); }
        });
    }
    return { evidence: ev, errors };
}

// ─────────────────────────────────────────────────────────────
// Apify
// ─────────────────────────────────────────────────────────────
const APIFY_BASE = 'https://api.apify.com/v2';
const APIFY_ACTORS = {
    instagram: 'apify~instagram-hashtag-scraper',
    tiktok: 'clockworks~tiktok-hashtag-scraper',
};

/** Run an actor synchronously and return its dataset items. */
async function apifyRunSync(actorId, input, token, { timeoutMs = 300_000 } = {}) {
    const url = `${APIFY_BASE}/acts/${actorId}/run-sync-get-dataset-items?token=${encodeURIComponent(token)}&timeout=${Math.floor(timeoutMs / 1000)}&clean=true`;
    const items = await getJson(url, { method: 'POST', body: input, timeoutMs: timeoutMs + 15_000 });
    return Array.isArray(items) ? items : [];
}

/** Instagram: posts under the seed hashtags → co-occurring tags + engagement. */
async function apifyInstagram(seeds, token, { resultsLimit = 40 } = {}) {
    const items = await apifyRunSync(APIFY_ACTORS.instagram, {
        hashtags: seeds,
        resultsLimit,
        resultsType: 'posts',
    }, token);
    const ev = [];
    for (const p of items) {
        const engagement = (Number(p.likesCount) || 0) + (Number(p.commentsCount) || 0);
        const views = Number(p.videoViewCount || p.videoPlayCount) || undefined;
        const tags = new Set([...(p.hashtags || []).map(normalizeTag), ...extractTags(p.caption)].filter(Boolean));
        for (const tag of tags) ev.push({ tag, source: 'instagram', engagement, views, count: 1 });
    }
    return { evidence: ev, posts: items.length };
}

/** TikTok: videos under the seed hashtags → co-occurring tags + play counts. */
async function apifyTiktok(seeds, token, { resultsPerPage = 30 } = {}) {
    const items = await apifyRunSync(APIFY_ACTORS.tiktok, {
        hashtags: seeds,
        resultsPerPage,
        shouldDownloadVideos: false,
        shouldDownloadCovers: false,
        shouldDownloadSubtitles: false,
        shouldDownloadSlideshowImages: false,
    }, token);
    const ev = [];
    for (const v of items) {
        const views = Number(v.playCount) || 0;
        const engagement = (Number(v.diggCount) || 0) + (Number(v.commentCount) || 0) + (Number(v.shareCount) || 0);
        const tags = new Set([...(v.hashtags || []).map(h => normalizeTag(h?.name || h)), ...extractTags(v.text)].filter(Boolean));
        for (const tag of tags) ev.push({ tag, source: 'tiktok', views, engagement, count: 1 });
    }
    return { evidence: ev, videos: items.length };
}

async function runApify(niche, token, { log = () => {}, instagramLimit, tiktokLimit } = {}) {
    const ev = [];
    const errors = [];
    const meta = {};
    const tasks = [
        ['instagram', () => apifyInstagram(niche.seeds, token, { resultsLimit: instagramLimit })],
        ['tiktok', () => apifyTiktok(niche.seeds, token, { resultsPerPage: tiktokLimit })],
    ];
    const results = await Promise.allSettled(tasks.map(([, fn]) => fn()));
    results.forEach((r, i) => {
        const name = tasks[i][0];
        if (r.status === 'fulfilled') {
            ev.push(...r.value.evidence);
            meta[name] = r.value.posts ?? r.value.videos ?? 0;
            log(`apify ${name}: ${meta[name]} items, ${r.value.evidence.length} tag hits`);
        } else {
            errors.push(`apify ${name}: ${r.reason.message}`);
            log(`apify ${name} failed: ${r.reason.message}`);
        }
    });
    return { evidence: ev, errors, meta };
}

// ─────────────────────────────────────────────────────────────
// Orchestration
// ─────────────────────────────────────────────────────────────

/**
 * researchNiche('gwagon', { serpApiKey, apifyToken, geo, log })
 */
async function researchNiche(nicheKey, opts = {}) {
    const niche = NICHES[nicheKey];
    if (!niche) throw new Error(`Unknown niche "${nicheKey}". Known: ${Object.keys(NICHES).join(', ')}`);

    const serpApiKey = opts.serpApiKey ?? process.env.SERPAPI_KEY ?? process.env.SERPAPI_API_KEY;
    const apifyToken = opts.apifyToken ?? process.env.APIFY_TOKEN ?? process.env.APIFY_API_TOKEN;
    const log = opts.log || (() => {});
    const startedAt = new Date().toISOString();

    const evidence = niche.curated.map(tag => ({ tag, source: 'curated', count: 1 }));
    const errors = [];
    const sourcesUsed = ['curated'];
    const meta = {};

    const jobs = [];
    if (serpApiKey) jobs.push(runSerpApi(niche, serpApiKey, { geo: opts.geo || 'AU', log }).then(r => { evidence.push(...r.evidence); errors.push(...r.errors); sourcesUsed.push('serpapi'); }));
    else log('SERPAPI_KEY not set — skipping SerpAPI');
    if (apifyToken) jobs.push(runApify(niche, apifyToken, { log, instagramLimit: opts.instagramLimit, tiktokLimit: opts.tiktokLimit }).then(r => { evidence.push(...r.evidence); errors.push(...r.errors); Object.assign(meta, r.meta); sourcesUsed.push('apify'); }));
    else log('APIFY_TOKEN not set — skipping Apify');
    await Promise.all(jobs);

    const scored = scoreTags(evidence, niche.seeds);
    const instagramSet = buildSet(scored, { size: 30, seeds: niche.seeds });
    const tiktokSet = buildSet(scored.filter(r => !MEGA_TAGS.has(r.tag) || ['fyp', 'viral'].includes(r.tag)), { size: 8, seeds: niche.seeds.slice(0, 2) });
    const risingTags = scored.filter(r => r.rising > 0).sort((a, b) => b.rising - a.rising).slice(0, 10);

    return {
        niche: nicheKey,
        label: niche.label,
        generatedAt: startedAt,
        sourcesUsed,
        meta,
        errors,
        totalEvidence: evidence.length,
        top: scored.slice(0, 60),
        buckets: bucketTags(scored.slice(0, 60)),
        rising: risingTags,
        instagram: instagramSet.map(r => r.tag),
        tiktok: tiktokSet.map(r => r.tag),
    };
}

async function researchAll(opts = {}) {
    const keys = opts.niches || Object.keys(NICHES);
    const out = [];
    for (const k of keys) out.push(await researchNiche(k, opts)); // sequential: be nice to API quotas
    return out;
}

function hashtagLine(tags) {
    return tags.map(t => '#' + t).join(' ');
}

function formatReportMarkdown(report) {
    const L = [];
    L.push(`## ${report.label}  (\`${report.niche}\`)`);
    L.push('');
    L.push(`_Generated ${report.generatedAt} · sources: ${report.sourcesUsed.join(', ')} · evidence rows: ${report.totalEvidence}_`);
    if (report.errors.length) { L.push(''); L.push('> ⚠️ ' + report.errors.join('  \n> ⚠️ ')); }
    L.push('');
    L.push('### Instagram / Reels (30 tags — paste in first comment or caption)');
    L.push('```');
    L.push(hashtagLine(report.instagram));
    L.push('```');
    L.push('');
    L.push('### TikTok (keep it to 5–8)');
    L.push('```');
    L.push(hashtagLine(report.tiktok));
    L.push('```');
    if (report.rising.length) {
        L.push('');
        L.push('### 🔥 Rising right now (Google Trends)');
        for (const r of report.rising) L.push(`- #${r.tag}  (+${r.rising}%)`);
    }
    L.push('');
    L.push('### Top 30 by score');
    L.push('| # | Tag | Score | Sources | Seen | Median eng. | Median views | IG posts |');
    L.push('|---|-----|------:|---------|-----:|------------:|-------------:|---------:|');
    report.top.slice(0, 30).forEach((r, i) => {
        L.push(`| ${i + 1} | #${r.tag} | ${r.score} | ${r.sources.join(', ')} | ${r.occurrences} | ${r.medianEngagement || ''} | ${r.medianViews || ''} | ${r.postCount || ''} |`);
    });
    L.push('');
    return L.join('\n');
}

module.exports = {
    NICHES,
    MEGA_TAGS,
    BLOCKED_TAGS,
    normalizeTag,
    extractTags,
    phraseToTag,
    scoreTags,
    bucketTags,
    buildSet,
    researchNiche,
    researchAll,
    formatReportMarkdown,
    hashtagLine,
    // exported for tests / advanced use
    _internal: { serpTrendsRelated, serpAutocomplete, serpYoutube, apifyInstagram, apifyTiktok, apifyRunSync, APIFY_ACTORS },
};
