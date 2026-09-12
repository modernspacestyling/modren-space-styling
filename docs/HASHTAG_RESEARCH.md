# Hashtag Research (SerpAPI + Apify)

Finds the hashtags most likely to get personal car / travel content seen, and
hands back copy-paste sets for Instagram (30) and TikTok (5–8).

Built-in niches:

| key | what it covers |
|-----|----------------|
| `gwagon` | Mercedes G-Wagon / G63 |
| `lamborghini` | Lamborghini (Urus, Huracán, Aventador) |
| `defender` | Land Rover Defender |
| `rangerover` | Range Rover Autobiography / Sport / SV |
| `mustang` | Ford Mustang / Shelby |
| `businessclass` | Business & first class flights, lounges |
| `luxurylifestyle` | Cross-niche lifestyle / motivation tags |

## How it works

1. **Curated seeds** – 30 hand-picked tags per niche ship in the code, so you
   always get a usable set even with no API keys.
2. **SerpAPI** (`SERPAPI_KEY`)
   - Google Trends *related queries* (rising + top) → what's spiking this quarter
   - Google Autocomplete → the exact phrases people type
   - YouTube search → hashtags used in the highest-viewed videos
3. **Apify** (`APIFY_TOKEN`)
   - `apify/instagram-hashtag-scraper` → real posts under the seed tags, their
     likes+comments and every co-occurring hashtag
   - `clockworks/tiktok-hashtag-scraper` → real videos, play counts, co-tags
4. **Scoring** – each tag gets one number from: how often it appears, median
   engagement of the posts using it, median views, Trends rising %, how many
   different platforms it showed up on. Spammy / banned-style tags are dropped;
   mega-generic tags (#love, #fyp…) are penalised so they never crowd out the
   ones that actually rank.
5. **Set builder** – picks ~20% broad, ~50% mid, ~30% niche tags. Seeds always
   go first. Instagram gets 30, TikTok gets 8.

## Setup

Add the two keys wherever you run it:

| Variable | Where to get it |
|----------|-----------------|
| `SERPAPI_KEY` | https://serpapi.com/manage-api-key |
| `APIFY_TOKEN` | https://console.apify.com/account/integrations |

- **Locally:** put them in a `.env` file in the repo root (git-ignored) or export them in your shell.
- **Vercel (admin page):** Project → Settings → Environment Variables → add both → Redeploy.

## Run from the command line

```bash
# all niches, Markdown report to stdout
node scripts/hashtag-research.js

# just the cars, save JSON + Markdown to a folder
node scripts/hashtag-research.js --niche gwagon,lamborghini,defender,rangerover,mustang --out docs/hashtags

# business class, US trends
node scripts/hashtag-research.js --niche businessclass --geo US

# no API calls, curated only
node scripts/hashtag-research.js --offline
```

Each Apify run costs actor credits (roughly 5 seeds × 40 posts per platform).
SerpAPI uses 3 searches per query phrase. One full run over all 7 niches is
about 60 SerpAPI searches and 14 Apify actor runs.

## Run from the admin panel

`/admin/hashtags.html` → pick a niche → **Run research**. Requires an admin
login. The serverless route is `api/hashtag-research.js`; it uses smaller
Apify limits than the CLI so it finishes inside Vercel's function timeout.
If a run times out on Vercel, use the CLI instead.

## Posting tips that pair with these tags

- Instagram: 3–5 niche tags in the caption, the rest in the first comment. Swap
  5–10 tags every post; never paste the identical block twice in a row.
- Reels: the first 3 tags matter most — put the car model first (`#g63`,
  `#lamborghiniurus`), then a lifestyle tag, then a discovery tag.
- TikTok: 5–8 tags max, mix one broad (`#fyp`) with the car model and one
  descriptive tag. Say the car name in the on-screen text too.
- Business class: tag the airline and aircraft (`#emirates`, `#a380`) plus
  `#businessclass` — airline-specific tags rank far easier than generic travel.
- Re-run research monthly; the **Rising** list changes fast.

## Tests

```bash
node --test tests/hashtag-research.test.mjs
```

Pure-function tests plus mocked SerpAPI / Apify responses. No keys or network needed.
