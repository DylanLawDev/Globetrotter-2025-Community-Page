/*
 * apply_medals.mjs — enrich the committed data.js with Discord medals + avatars,
 * WITHOUT a full pipeline rebuild.
 *
 * build_data.mjs is the canonical home for this join, but it needs the raw export
 * (data/threads) + pipeline intermediates (out/*.json), which aren't always present.
 * This bridge reads the existing data.js CONTRIBUTORS, applies the SAME join via
 * build/medals.mjs, rewrites only the CONTRIBUTORS block in place, and writes
 * out/avatar_jobs.json for the media optimizer. Everything else in data.js is byte-identical.
 *
 * Run:  node build/apply_medals.mjs       (then: node optimize_media.mjs)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_EXPORT_DIR, loadMedalLookup, enrichContributors } from "./medals.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA_JS = path.join(ROOT, "data.js");
const MEDAL_EXPORT = process.env.MEDAL_EXPORT || DEFAULT_EXPORT_DIR(ROOT);

const lookup = loadMedalLookup(MEDAL_EXPORT);
if (!lookup) {
  console.error(`medal export not found at ${MEDAL_EXPORT}`);
  process.exit(1);
}

const text = fs.readFileSync(DATA_JS, "utf8");

// Pull CONTRIBUTORS out of data.js (it defines top-level consts, not exports).
const CONTRIBUTORS = new Function(text + "\nreturn CONTRIBUTORS;")();
const before = Object.keys(CONTRIBUTORS).length;

const jobs = enrichContributors(CONTRIBUTORS, lookup);

// Replace ONLY the `const CONTRIBUTORS = { ... };` block; the closing brace sits at
// column 0 (JSON.stringify indent), so `\n};` matches the top-level close uniquely.
const block = `const CONTRIBUTORS = ${JSON.stringify(CONTRIBUTORS, null, 2)};`;
const re = /const CONTRIBUTORS = \{[\s\S]*?\n\};/;
if (!re.test(text)) {
  console.error("could not locate the CONTRIBUTORS block in data.js");
  process.exit(1);
}
fs.writeFileSync(DATA_JS, text.replace(re, block));

fs.mkdirSync(path.join(ROOT, "out"), { recursive: true });
fs.writeFileSync(path.join(ROOT, "out/avatar_jobs.json"), JSON.stringify(jobs, null, 2));

const medaled = Object.values(CONTRIBUTORS).filter((c) => c.tier).length;
console.log(`enriched ${before} contributors in data.js`);
console.log(`  medals: ${medaled} medalists · avatars: ${jobs.length} jobs -> out/avatar_jobs.json`);
