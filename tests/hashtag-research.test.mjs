// tests/hashtag-research.test.mjs
// Pure-function tests for lib/hashtag-research.js — no network, no keys needed.
// Run: node --test tests/hashtag-research.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const H = require('../lib/hashtag-research.js');

test('normalizeTag strips #, punctuation, spaces and case', () => {
    assert.equal(H.normalizeTag('#G-Wagon!'), 'gwagon');
    assert.equal(H.normalizeTag('  Range Rover Autobiography '), 'rangeroverautobiography');
    assert.equal(H.normalizeTag('#123'), '');
    assert.equal(H.normalizeTag('a'), '');
    assert.equal(H.normalizeTag(''), '');
    assert.equal(H.normalizeTag('g63_amg'), 'g63_amg');
});

test('extractTags pulls every hashtag from free text', () => {
    assert.deepEqual(H.extractTags('New whip 🔥 #G63 #gwagon, #Lambo... no tag here'), ['g63', 'gwagon', 'lambo']);
    assert.deepEqual(H.extractTags(null), []);
});

test('phraseToTag collapses a search phrase into one tag', () => {
    assert.equal(H.phraseToTag('emirates business class'), 'emiratesbusinessclass');
});

test('every niche has seeds, queries and 30 curated tags with no blocked/duplicate entries', () => {
    for (const [key, n] of Object.entries(H.NICHES)) {
        assert.ok(n.label, key + ' label');
        assert.ok(n.seeds.length >= 3, key + ' seeds');
        assert.ok(n.queries.length >= 2, key + ' queries');
        assert.equal(n.curated.length, 30, key + ' curated should be 30');
        assert.equal(new Set(n.curated).size, n.curated.length, key + ' curated has duplicates');
        for (const t of n.curated) {
            assert.equal(H.normalizeTag(t), t, `${key}: "${t}" is not normalized`);
            assert.ok(!H.BLOCKED_TAGS.has(t), `${key}: "${t}" is blocked`);
        }
    }
    for (const k of ['gwagon', 'lamborghini', 'defender', 'rangerover', 'mustang', 'businessclass']) {
        assert.ok(H.NICHES[k], 'missing niche ' + k);
    }
});

test('scoreTags aggregates occurrences, drops blocked tags, rewards multi-source and engagement', () => {
    const rows = H.scoreTags([
        { tag: 'gwagon', source: 'instagram', engagement: 5000 },
        { tag: 'gwagon', source: 'tiktok', views: 200000 },
        { tag: 'gwagon', source: 'curated' },
        { tag: 'g63', source: 'instagram', engagement: 100 },
        { tag: 'like4like', source: 'instagram', engagement: 999999 },
        { tag: '#GWagon', source: 'trends', rising: 250 },
    ], ['gwagon']);
    const tags = rows.map(r => r.tag);
    assert.ok(!tags.includes('like4like'), 'blocked tag must be removed');
    assert.equal(rows[0].tag, 'gwagon');
    assert.equal(rows[0].occurrences, 4);
    assert.deepEqual(rows[0].sources, ['curated', 'instagram', 'tiktok', 'trends']);
    assert.equal(rows[0].rising, 250);
    assert.equal(rows[0].medianEngagement, 5000);
    assert.ok(rows[0].isSeed);
    assert.ok(rows[0].score > rows[1].score);
});

test('scoreTags penalises mega-generic tags', () => {
    const rows = H.scoreTags([
        { tag: 'love', source: 'instagram', engagement: 100 },
        { tag: 'gwagonlife', source: 'instagram', engagement: 100 },
    ]);
    const love = rows.find(r => r.tag === 'love');
    const niche = rows.find(r => r.tag === 'gwagonlife');
    assert.ok(niche.score > love.score);
});

test('bucketTags uses Instagram post count when known, heuristics otherwise', () => {
    const b = H.bucketTags([
        { tag: 'cars', postCount: 80_000_000 },
        { tag: 'gwagonlife', postCount: 400_000 },
        { tag: 'g63brabus2025', postCount: 5_000 },
        { tag: 'love', postCount: 0 },
        { tag: 'carlifestyle', postCount: 0 },
        { tag: 'rangeroverautobiography', postCount: 0 },
    ]);
    assert.deepEqual(b.broad.map(r => r.tag), ['cars', 'love']);
    assert.deepEqual(b.mid.map(r => r.tag), ['gwagonlife', 'carlifestyle']);
    assert.deepEqual(b.niche.map(r => r.tag), ['g63brabus2025', 'rangeroverautobiography']);
});

test('buildSet returns the requested size, seeds first, no duplicates', () => {
    const ev = H.NICHES.gwagon.curated.map(t => ({ tag: t, source: 'curated' }));
    const rows = H.scoreTags(ev, H.NICHES.gwagon.seeds);
    const set30 = H.buildSet(rows, { size: 30, seeds: H.NICHES.gwagon.seeds });
    assert.equal(set30.length, 30);
    assert.equal(new Set(set30.map(r => r.tag)).size, 30);
    assert.equal(set30[0].tag, 'gwagon');
    const set8 = H.buildSet(rows, { size: 8, seeds: ['gwagon', 'g63'] });
    assert.equal(set8.length, 8);
    assert.deepEqual(set8.slice(0, 2).map(r => r.tag), ['gwagon', 'g63']);
});

test('researchNiche works offline with curated data only', async () => {
    const logs = [];
    const r = await H.researchNiche('businessclass', { serpApiKey: null, apifyToken: null, log: m => logs.push(m) });
    assert.equal(r.niche, 'businessclass');
    assert.deepEqual(r.sourcesUsed, ['curated']);
    assert.equal(r.instagram.length, 30);
    assert.ok(r.tiktok.length >= 5 && r.tiktok.length <= 8);
    assert.ok(r.instagram.includes('businessclass'));
    assert.deepEqual(r.errors, []);
    assert.ok(logs.some(l => /SERPAPI_KEY not set/.test(l)));
    const md = H.formatReportMarkdown(r);
    assert.match(md, /## Business Class Travel/);
    assert.match(md, /#businessclass/);
});

test('researchNiche rejects unknown niches', async () => {
    await assert.rejects(() => H.researchNiche('nope', { serpApiKey: null, apifyToken: null }), /Unknown niche/);
});

test('serpapi / apify parsers turn raw payloads into evidence (mocked fetch)', async () => {
    const origFetch = globalThis.fetch;
    const calls = [];
    globalThis.fetch = async (url, init) => {
        calls.push({ url: String(url), init });
        const u = String(url);
        let body;
        if (u.includes('engine=google_trends')) body = { related_queries: { rising: [{ query: 'g wagon 2025', value: 'Breakout', extracted_value: 5000 }], top: [{ query: 'g63 amg' }] } };
        else if (u.includes('engine=google_autocomplete')) body = { suggestions: [{ value: 'g wagon price' }] };
        else if (u.includes('engine=youtube')) body = { video_results: [{ title: 'G63 #gwagon #brabus', description: '', views: 1200000 }] };
        else if (u.includes('instagram-hashtag-scraper')) body = [{ likesCount: 900, commentsCount: 30, hashtags: ['gwagon', 'g63'], caption: 'sunday #blackonblack' }];
        else if (u.includes('tiktok-hashtag-scraper')) body = [{ playCount: 3_000_000, diggCount: 100000, commentCount: 500, shareCount: 200, hashtags: [{ name: 'gwagon' }, { name: 'fyp' }], text: '#g63 rip' }];
        else body = {};
        return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    try {
        const r = await H.researchNiche('gwagon', { serpApiKey: 'serp-test', apifyToken: 'apify-test', geo: 'AU' });
        assert.deepEqual(r.sourcesUsed.sort(), ['apify', 'curated', 'serpapi']);
        assert.deepEqual(r.errors, []);
        const top = Object.fromEntries(r.top.map(x => [x.tag, x]));
        assert.ok(top.gwagon.sources.includes('instagram') && top.gwagon.sources.includes('tiktok') && top.gwagon.sources.includes('youtube'));
        assert.equal(top.gwagon2025.rising, 5000);
        assert.ok(top.gwagonprice.sources.includes('autocomplete'));
        assert.equal(top.blackonblack.medianEngagement, 930);
        assert.equal(top.g63.medianViews, 3_000_000);
        assert.equal(r.meta.instagram, 1);
        assert.equal(r.meta.tiktok, 1);
        assert.equal(r.rising[0].tag, 'gwagon2025');
        // Apify calls are POSTs to run-sync with the actor input
        const apifyCall = calls.find(c => c.url.includes('instagram-hashtag-scraper'));
        assert.equal(apifyCall.init.method, 'POST');
        assert.deepEqual(JSON.parse(apifyCall.init.body).hashtags, H.NICHES.gwagon.seeds);
        // keys are sent, never logged into the report
        assert.ok(calls.some(c => c.url.includes('api_key=serp-test')));
        assert.ok(!JSON.stringify(r).includes('serp-test'));
        assert.ok(!JSON.stringify(r).includes('apify-test'));
    } finally {
        globalThis.fetch = origFetch;
    }
});

test('a failing source is reported in errors but does not break the run', async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
        if (String(url).includes('apify.com')) return new Response(JSON.stringify({ error: { message: 'Actor quota exceeded' } }), { status: 402 });
        return new Response('{}', { status: 200 });
    };
    try {
        const r = await H.researchNiche('mustang', { serpApiKey: 'x', apifyToken: 'y' });
        assert.equal(r.errors.length, 2);
        assert.match(r.errors[0], /Actor quota exceeded/);
        assert.equal(r.instagram.length, 30);
    } finally {
        globalThis.fetch = origFetch;
    }
});
