#!/usr/bin/env node
/**
 * scripts/hashtag-research.js — CLI for the hashtag research engine.
 *
 * Usage:
 *   SERPAPI_KEY=... APIFY_TOKEN=... node scripts/hashtag-research.js                # all niches
 *   node scripts/hashtag-research.js --niche gwagon,lamborghini                     # some niches
 *   node scripts/hashtag-research.js --niche businessclass --geo AU --out docs/hashtags
 *   node scripts/hashtag-research.js --list                                          # show niches
 *   node scripts/hashtag-research.js --offline                                       # curated only, no API calls
 *
 * Output: prints a Markdown report to stdout and (with --out) writes
 *   <out>/<niche>.json  and  <out>/<niche>.md  and  <out>/README.md (combined).
 *
 * Keys are read from env (SERPAPI_KEY, APIFY_TOKEN). A local .env file in the
 * repo root is loaded automatically if present (it is git-ignored).
 */

'use strict';

const fs = require('fs');
const path = require('path');

// Tiny .env loader (no dependency) — only sets vars that are not already set.
(function loadDotEnv() {
    const p = path.join(__dirname, '..', '.env');
    if (!fs.existsSync(p)) return;
    for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
        if (!m) continue;
        const v = m[2].replace(/^["']|["']$/g, '');
        if (!process.env[m[1]]) process.env[m[1]] = v;
    }
})();

const { NICHES, researchNiche, formatReportMarkdown, hashtagLine } = require('../lib/hashtag-research');

function parseArgs(argv) {
    const args = { niches: null, geo: 'AU', out: null, offline: false, list: false, json: false, quiet: false };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        const next = () => argv[++i];
        if (a === '--niche' || a === '-n') args.niches = next().split(',').map(s => s.trim()).filter(Boolean);
        else if (a === '--geo') args.geo = next();
        else if (a === '--out' || a === '-o') args.out = next();
        else if (a === '--offline') args.offline = true;
        else if (a === '--list') args.list = true;
        else if (a === '--json') args.json = true;
        else if (a === '--quiet' || a === '-q') args.quiet = true;
        else if (a === '--help' || a === '-h') { printHelp(); process.exit(0); }
        else { console.error(`Unknown arg: ${a}`); printHelp(); process.exit(1); }
    }
    return args;
}

function printHelp() {
    console.log(`Hashtag research (SerpAPI + Apify)

  --niche, -n   comma list of niches (default: all)
  --geo         Google Trends / autocomplete region (default AU)
  --out, -o     directory to write <niche>.json + <niche>.md + README.md
  --offline     skip API calls, curated tags only
  --json        print JSON instead of Markdown
  --list        list niches and exit
  --quiet, -q   no progress logs on stderr

Niches: ${Object.keys(NICHES).join(', ')}
Env:    SERPAPI_KEY, APIFY_TOKEN (or a .env file in the repo root)`);
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    if (args.list) {
        for (const [k, n] of Object.entries(NICHES)) console.log(`${k.padEnd(16)} ${n.label}  seeds: ${n.seeds.map(s => '#' + s).join(' ')}`);
        return;
    }

    const niches = args.niches || Object.keys(NICHES);
    for (const k of niches) if (!NICHES[k]) { console.error(`Unknown niche "${k}". Run --list.`); process.exit(1); }

    const serpApiKey = args.offline ? null : (process.env.SERPAPI_KEY || process.env.SERPAPI_API_KEY || null);
    const apifyToken = args.offline ? null : (process.env.APIFY_TOKEN || process.env.APIFY_API_TOKEN || null);
    const log = args.quiet ? () => {} : (m) => console.error('  · ' + m);

    if (!args.offline && !serpApiKey && !apifyToken) {
        console.error('⚠️  Neither SERPAPI_KEY nor APIFY_TOKEN is set — running with curated tags only.');
        console.error('    Put them in your shell env or a .env file in the repo root.\n');
    }

    const reports = [];
    for (const k of niches) {
        if (!args.quiet) console.error(`▶ ${NICHES[k].label}`);
        const r = await researchNiche(k, { serpApiKey, apifyToken, geo: args.geo, log });
        reports.push(r);
    }

    if (args.out) {
        fs.mkdirSync(args.out, { recursive: true });
        const combined = ['# Hashtag research', '', `Generated ${new Date().toISOString()}`, ''];
        for (const r of reports) {
            fs.writeFileSync(path.join(args.out, `${r.niche}.json`), JSON.stringify(r, null, 2));
            const md = formatReportMarkdown(r);
            fs.writeFileSync(path.join(args.out, `${r.niche}.md`), md);
            combined.push(md, '');
        }
        fs.writeFileSync(path.join(args.out, 'README.md'), combined.join('\n'));
        if (!args.quiet) console.error(`\n✅ Wrote ${reports.length} report(s) to ${args.out}/`);
    }

    if (args.json) {
        console.log(JSON.stringify(reports.length === 1 ? reports[0] : reports, null, 2));
    } else {
        for (const r of reports) console.log(formatReportMarkdown(r));
        console.log('## Quick copy (Instagram)');
        for (const r of reports) console.log(`\n**${r.label}**\n\`\`\`\n${hashtagLine(r.instagram)}\n\`\`\``);
    }
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
