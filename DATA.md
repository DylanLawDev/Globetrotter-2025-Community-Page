# Globetrotter 2025 Atlas — Data Pipeline

This is the **current, authoritative** description of how the Discord forum export becomes
the data the site reads. It supersedes the original `handoff/HANDOFF.md` (which described a
flat one-card-per-thread model with AI-extracted "things to do" / "getting there" — both
since dropped).

## The model

The export's freeform thread titles are messy (emoji, misspellings, editorial slogans,
missing countries, duplicates). They are standardized into three normalized collections so
the site can browse **by city, by submission, or by contributor**:

- **CITIES** — deduplicated. One card per real city. Threads about the same place (Budapest
  ×5, Amsterdam ×5, Bangkok ×4 …) collapse into one city that **aggregates** their
  submissions and photos. Each has `cc` / `continent` / `lat` / `lng` / `population` so it
  plots on the map.
- **SUBMISSIONS** — one per thread. Keeps the member's **raw post content** (cleaned of
  Discord markup only — *no* AI extraction). Links to its city (`cityId`) and author
  (`submittedBy`).
- **CONTRIBUTORS** — one per submitter, with submission `count` and a `tier`.

## Pipeline (run in order)

| Step | Script | Reads | Writes |
|------|--------|-------|--------|
| 1. Extract | `build/01_extract.mjs` | `data/threads/*/thread.json` | `build/threads.raw.json` (+ `build/_names_for_curation.txt`) |
| 2. Standardize | **6 Haiku sub-agents** | `build/chunks/chunk_*.tsv` | `build/maps/map_*.json` (threadId → `{name, region, country, cc, continent, lat, lng, population, note, isCity, uncertain, reviewNote}`) |
| 3. Merge + dedup | `build/02_merge.mjs` | `build/maps/*`, `build/threads.raw.json` | `build/city-map.json`, `out/cities.json`, `out/submissions.json`, `out/contributors.json`, `out/cities-review.md` |
| 4. Assemble site data | `build_data.mjs` | `out/*`, `data/threads/*/thread.json` | `data.js` |

Steps 1–3 are the **standardization** (the "data fixes"). Step 4 produces the file the site
loads. Re-running step 4 is cheap; steps 1–3 only need re-running if titles/maps change.

```bash
node build/01_extract.mjs .
# (standardization done by Haiku agents -> build/maps/map_01..06.json)
node build/02_merge.mjs .
node build_data.mjs            # add --copy-photos to materialize photos/<id>/<file>
```

### The standardization step (2)
Titles are split into 6 chunks and handed to Haiku sub-agents, each emitting a dictionary
map keyed by threadId. The agents handle world knowledge: fix misspellings (Hungrary→Hungary,
Morroco→Morocco), strip emoji/slogans ("Land of the Pirates: Greenville"→Greenville), infer
country for single-token names (Munich→Germany), assign `cc`/`continent`/`lat`/`lng`/
`population`, and mark `isCity:false` for admin threads. **US states are valid** — "Topeka,
KS" → name Topeka, region Kansas, country United States. Anything ambiguous is flagged
`uncertain` and lands in `out/cities-review.md`.

## `data.js` schema (what the site reads)

`data.js` attaches four globals to `window`:

```js
CONTRIBUTORS = {
  "<key>": { handle, display, count, tier /* gold≥15 silver≥10 bronze≥5 else null */ }
}

CITIES = [{
  id, name, region, country, cc, continent, lat, lng, population,
  submissionCount, photoCount,
  submissionIds: [...],                 // ordered: most-photos submission first (hero source)
  photos: [{ src, caption, by, threadId }],  // AGGREGATED across all the city's submissions
}]

SUBMISSIONS = [{
  id, cityId, title /* original raw thread title */, note, submittedBy, date,
  imageCount, videoCount,
  content,                              // member's post, Discord-markup stripped, NO AI extraction
  photos:    [{ src, caption, by }],    // this submission's starter-post images only
  reactions: [{ e, c }],                // custom Discord emoji aliased or dropped
  comments:  [{ by, date, text, reactions }],   // replies, oldest→newest
}]

STATS = { cities, countries, continents, submissions, photos, contributors, comments }
```

## Photos
Referenced **in place** by default: `src = "data/threads/<threadId>/images/originals/<attId>_<file>"`
(no duplication of the 8.6 GB image set). Run `node build_data.mjs --copy-photos` to instead
copy clean-named files into `photos/<threadId>/<filename>` and rewrite `src` accordingly.
Only starter-post images are gallery photos (per the challenge rules); reply images and
videos are excluded.

## Review queue
`out/cities-review.md` lists everything needing a human eye: the 2 skipped admin threads,
~23 submissions whose starter post has 0 images (their city still shows photos from other
submissions), and ~12 `uncertain` calls (Istanbul's continent, Bethlehem PS vs PA, Dakhla/
Western Sahara, Orange County as a county, small towns, etc.). Confirm/correct in the maps
and re-run steps 3–4.

## Current totals
278 cities · 357 submissions · 49 contributors · 2158 photos · 1202 comments · 82 countries · 6 continents.
