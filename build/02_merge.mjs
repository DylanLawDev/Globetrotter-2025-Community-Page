/*
 * 02_merge.mjs — assemble the standardized data layer from the Haiku maps.
 *
 * Inputs:
 *   build/threads.raw.json   (mechanical extraction: id, rawName, owner, date, image/video counts)
 *   build/maps/map_*.json     (Haiku-standardized per-thread records, keyed by threadId)
 *
 * Outputs:
 *   build/city-map.json       the merged dictionary map (threadId -> standardized record)
 *   out/cities.json           deduplicated canonical city registry
 *   out/submissions.json      one per city thread, linked to a city
 *   out/contributors.json     derived from submitters
 *   out/cities-review.md      everything ambiguous / skipped, for human review
 *
 * No world-knowledge here — that all came from the Haiku agents. This is glue.
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(process.argv[2] || ".");
const OUT = path.join(ROOT, "out");
fs.mkdirSync(OUT, { recursive: true });

const threads = JSON.parse(fs.readFileSync(path.join(ROOT, "build/threads.raw.json"), "utf8"));
const byId = new Map(threads.map((t) => [t.id, t]));

// --- merge the 6 maps ------------------------------------------------------
const mapDir = path.join(ROOT, "build/maps");
const merged = {};
for (const f of fs.readdirSync(mapDir).filter((f) => f.endsWith(".json")).sort()) {
  const obj = JSON.parse(fs.readFileSync(path.join(mapDir, f), "utf8"));
  for (const [id, rec] of Object.entries(obj)) merged[id] = rec;
}
fs.writeFileSync(path.join(ROOT, "build/city-map.json"), JSON.stringify(merged, null, 2));

// sanity: every thread should have a map entry
const missing = threads.filter((t) => !merged[t.id]).map((t) => `${t.id} ${t.rawName}`);
if (missing.length) console.warn(`! ${missing.length} threads missing a map entry:\n  ` + missing.join("\n  "));

const slug = (s = "") =>
  s.normalize("NFKD").replace(/[̀-ͯ]/g, "")        // strip combining diacritics
   .replace(/[ł]/gi, "l").replace(/[ø]/gi, "o").replace(/[ı]/g, "i")
   .toLowerCase().replace(/['".]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

// --- group city threads into canonical cities ------------------------------
const review = []; // {kind, threadId, name, reason}
const cityThreads = [];
for (const t of threads) {
  const m = merged[t.id] || {};
  if (m.isCity === false) {
    review.push({ kind: "skipped (non-city)", threadId: t.id, name: t.rawName, reason: "isCity=false" });
    continue;
  }
  if (!m.name) {
    review.push({ kind: "skipped (no name)", threadId: t.id, name: t.rawName, reason: "map produced no name" });
    continue;
  }
  cityThreads.push(t);
  if (m.uncertain) review.push({ kind: "uncertain", threadId: t.id, name: `${m.name}, ${m.country}`, reason: m.reviewNote || "agent flagged uncertain" });
  if (t.imageCount === 0) review.push({ kind: "no photos", threadId: t.id, name: `${m.name} (${t.rawName})`, reason: "starter post has 0 images" });
}

// dedup key: name + country-code + region (region distinguishes Portland ME vs OR)
const keyOf = (m) => `${slug(m.name)}|${(m.cc || "").toUpperCase()}|${slug(m.region || "")}`;
const groups = new Map();
for (const t of cityThreads) {
  const m = merged[t.id];
  const k = keyOf(m);
  if (!groups.has(k)) groups.set(k, []);
  groups.get(k).push(t);
}

// assign unique slugs; disambiguate base-slug collisions across different groups
const baseCount = new Map();
for (const k of groups.keys()) {
  const m = merged[groups.get(k)[0].id];
  const b = slug(m.name);
  baseCount.set(b, (baseCount.get(b) || 0) + 1);
}

const cities = [];
const threadToCity = new Map();
for (const [k, ts] of groups) {
  // pick the representative record (the one with the most images, ties -> earliest)
  ts.sort((a, b) => b.imageCount - a.imageCount || (a.created_at || "").localeCompare(b.created_at || ""));
  const m = merged[ts[0].id];
  const base = slug(m.name);
  let id = base;
  if (baseCount.get(base) > 1) {
    const tag = slug(m.region || "") || slug(m.country || "");
    id = `${base}-${tag}`;
  }
  // guard against any residual id collision
  let unique = id, n = 2;
  while (cities.some((c) => c.id === unique)) unique = `${id}-${n++}`;
  id = unique;

  const photoCount = ts.reduce((s, t) => s + (t.imageCount || 0), 0);
  cities.push({
    id,
    name: m.name,
    region: m.region || null,
    country: m.country,
    cc: (m.cc || "").toUpperCase(),
    continent: m.continent,
    lat: m.lat,
    lng: m.lng,
    population: m.population ?? null,
    submissionCount: ts.length,
    photoCount,
    submissionIds: ts.map((t) => t.id),
  });
  ts.forEach((t) => threadToCity.set(t.id, id));
}
cities.sort((a, b) => a.name.localeCompare(b.name));

// --- submissions -----------------------------------------------------------
const contribByKey = new Map();
const submissions = cityThreads.map((t) => {
  const m = merged[t.id];
  const ckey = slug(t.owner.display || t.owner.name || "member");
  if (!contribByKey.has(ckey)) {
    contribByKey.set(ckey, { handle: t.owner.name, display: t.owner.display || t.owner.name, count: 0 });
  }
  contribByKey.get(ckey).count++;
  return {
    id: t.id,
    cityId: threadToCity.get(t.id),
    title: t.rawName,
    note: m.note || null,
    submittedBy: ckey,
    date: (t.created_at || "").slice(0, 10),
    imageCount: t.imageCount,
    videoCount: t.videoCount,
  };
});
submissions.sort((a, b) => (a.date || "").localeCompare(b.date || ""));

// --- contributors ----------------------------------------------------------
const tierOf = (n) => (n >= 15 ? "gold" : n >= 10 ? "silver" : n >= 5 ? "bronze" : null);
const contributors = {};
for (const [key, c] of contribByKey) contributors[key] = { ...c, tier: tierOf(c.count) };

// --- write -----------------------------------------------------------------
fs.writeFileSync(path.join(OUT, "cities.json"), JSON.stringify(cities, null, 2));
fs.writeFileSync(path.join(OUT, "submissions.json"), JSON.stringify(submissions, null, 2));
fs.writeFileSync(path.join(OUT, "contributors.json"), JSON.stringify(contributors, null, 2));

// review markdown
const byKind = {};
for (const r of review) (byKind[r.kind] ||= []).push(r);
let md = `# Cities — review queue\n\nGenerated from the Haiku standardization pass. Confirm or correct these, then re-run.\n\n`;
md += `**Totals:** ${threads.length} threads → ${cities.length} unique cities, ${submissions.length} submissions, ${Object.keys(contributors).length} contributors.\n\n`;
for (const kind of Object.keys(byKind)) {
  md += `## ${kind} (${byKind[kind].length})\n\n`;
  for (const r of byKind[kind]) md += `- \`${r.threadId}\` **${r.name}** — ${r.reason}\n`;
  md += `\n`;
}
fs.writeFileSync(path.join(OUT, "cities-review.md"), md);

// console report
console.log(`threads:        ${threads.length}`);
console.log(`city threads:   ${cityThreads.length}`);
console.log(`unique cities:  ${cities.length}`);
console.log(`submissions:    ${submissions.length}`);
console.log(`contributors:   ${Object.keys(contributors).length}`);
console.log(`review items:   ${review.length}  (${Object.entries(byKind).map(([k, v]) => `${k}:${v.length}`).join(", ")})`);
const multi = cities.filter((c) => c.submissionCount > 1).sort((a, b) => b.submissionCount - a.submissionCount);
console.log(`\ntop merged cities:`);
multi.slice(0, 12).forEach((c) => console.log(`  ${c.submissionCount}x  ${c.name}, ${c.country}  -> ${c.id}`));
