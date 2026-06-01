/*
 * build_data.mjs — Globetrotter 2025 Atlas data builder.
 * Emits data.js in the exact contract site.js expects:
 *   CITIES (place registry) + SUBMISSIONS (threads, joined by cityId) + CONTRIBUTORS + STATS.
 *
 * Reads:
 *   out/cities.json, out/submissions.json, out/contributors.json   (02_merge.mjs output)
 *   data/threads/<id>/thread.json                                  (Discord export)
 * Writes:
 *   data.js   (photos referenced in place at data/threads/...; site assembled at repo root)
 *
 * Prose fields (getThere / thingsToDo / blurb) are lifted MECHANICALLY from the member's
 * own labelled markdown sections — no AI generation. Missing sections -> lite:true.
 *
 * Run:  node build_data.mjs
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(".");
const EXPORT_DIR = path.join(ROOT, "data/threads");
const HOST_HANDLES = new Set(["index.php"]); // Carl = host

const EMOJI_ALIAS = {
  ChefKiss: "🤌", LetsFuckingGo: "🔥", letsfuckinggo: "🔥", bourdain: "🧑‍🍳",
  this: "💯", This: "💯",
};

function clean(md = "") {
  return md.replace(/\r/g, "")
    .replace(/<a?:(\w+):\d+>/g, (_, n) => EMOJI_ALIAS[n] || "")
    .replace(/<#\d+>/g, "").replace(/<@!?\d+>/g, "").replace(/<@&\d+>/g, "")
    .replace(/\|\|(.+?)\|\|/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*(.+?)\*\*/g, "$1").replace(/\*(.+?)\*/g, "$1")
    .replace(/__(.+?)__/g, "$1").replace(/~~(.+?)~~/g, "$1")
    .replace(/`{1,3}([^`]+)`{1,3}/g, "$1")
    .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, "$1 ($2)")
    .replace(/\n{3,}/g, "\n\n").trim();
}

function mapReactions(reactions = []) {
  return reactions.map((r) => {
    let e = r.emoji;
    const m = /^<a?:(\w+):\d+>$/.exec(e || "");
    if (m) e = EMOJI_ALIAS[m[1]] || null;
    return e ? { e, c: r.count } : null;
  }).filter(Boolean).filter((r) => r.c > 0).sort((a, b) => b.c - a.c);
}

const ymd = (iso) => (iso || "").slice(0, 10);
const slug = (s = "") =>
  s.normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[ł]/gi, "l").replace(/[ø]/gi, "o")
   .toLowerCase().replace(/['".]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

/* ---- mechanical prose extraction from the starter markdown ---------------- */
function extractProse(raw = "") {
  const text = raw.replace(/\r/g, "");
  const lines = text.split("\n");

  const sectionBody = (re) => {
    const idx = lines.findIndex((l) => re.test(l));
    if (idx < 0) return null;
    const body = [];
    for (let i = idx + 1; i < lines.length; i++) {
      if (/^#{1,6}\s/.test(lines[i])) break;
      body.push(lines[i]);
    }
    return clean(body.join("\n")).trim() || null;
  };

  const getThere = sectionBody(/how to get there|getting there|how to get|how to arrive/i);

  let thingsToDo = [];
  const tIdx = lines.findIndex((l) => /things to (do|see)|what to do|see (and|&) do|must[- ]?see/i.test(l));
  if (tIdx >= 0) {
    for (let i = tIdx + 1; i < lines.length; i++) {
      if (/^#{1,6}\s/.test(lines[i])) break;
      const b = /^\s*[*\-•]\s+(.*)|^\s*\d+[.)]\s+(.*)/.exec(lines[i]);
      if (b) { const v = clean(b[1] || b[2]).trim(); if (v) thingsToDo.push(v); }
    }
  }

  // blurb: the member's first real intro paragraph (skip headings, labels, bullets)
  let blurb = "";
  for (const l of lines) {
    const t = clean(l).trim();
    if (!t) continue;
    if (/^(population|country|how to|things to|getting there)/i.test(t)) continue;
    if (/^[*\-•\d]/.test(l.trim())) continue;
    blurb = t;
    if (blurb.length > 40) break;
  }
  if (blurb.length > 320) blurb = blurb.slice(0, 317).replace(/\s+\S*$/, "") + "…";

  return { getThere, thingsToDo, blurb };
}

function gatherComments(t) {
  const seen = new Set();
  const out = [];
  const push = (m) => {
    if (!m || m.is_starter || seen.has(m.id)) return;
    seen.add(m.id);
    const text = clean(m.content || "");
    if (!text) return;
    out.push({
      by: slug(m.author?.display_name || m.author?.name || "member"),
      date: ymd(m.created_at),
      text,
      reactions: mapReactions(m.reactions),
    });
  };
  (t.author_posts || []).forEach(push);
  (t.comments || []).forEach(push);
  out.sort((a, b) => (a.date < b.date ? -1 : 1));
  return out;
}

/* ============================== build ====================================== */
const citiesIn = JSON.parse(fs.readFileSync(path.join(ROOT, "out/cities.json"), "utf8"));
const subsIn = JSON.parse(fs.readFileSync(path.join(ROOT, "out/submissions.json"), "utf8"));
const contribIn = JSON.parse(fs.readFileSync(path.join(ROOT, "out/contributors.json"), "utf8"));

// SUBMISSIONS — one per thread, id = s-<cityId>-<memberKey> (deduped).
// Drop ownerless stub threads (null owner + no starter author) — nothing to attribute.
const usedIds = new Set();
const SUBMISSIONS = subsIn.map((s) => {
  const t = JSON.parse(fs.readFileSync(path.join(EXPORT_DIR, s.id, "thread.json"), "utf8"));
  const starter = (t.author_posts || []).find((p) => p.is_starter) || (t.author_posts || [])[0] || {};
  const hasAuthor = (t.owner && (t.owner.display_name || t.owner.name)) || (starter.author && (starter.author.display_name || starter.author.name));
  if (!hasAuthor) return null;

  let sid = `s-${s.cityId}-${s.submittedBy}`;
  if (usedIds.has(sid)) { let n = 2; while (usedIds.has(`${sid}-${n}`)) n++; sid = `${sid}-${n}`; }
  usedIds.add(sid);

  // Reference the web-optimized derivatives produced by optimize_media.mjs:
  // images -> media/<thread>/<name>.webp, videos -> media/<thread>/<name>.mp4
  const mediaName = (orig) => orig.replace(/^.*\//, "").replace(/\.[^.]+$/, "");
  const atts = starter.attachments || [];
  const photos = atts
    .filter((a) => (a.content_type || "").startsWith("image/"))
    .map((a) => ({ src: `media/${s.id}/${mediaName(a.original)}.webp`, by: s.submittedBy, caption: "" }));
  const videos = atts
    .filter((a) => (a.content_type || "").startsWith("video/"))
    .map((a) => ({ src: `media/${s.id}/${mediaName(a.original)}.mp4`, by: s.submittedBy, caption: "" }));

  const { getThere, thingsToDo, blurb } = extractProse(starter.content || "");
  const lite = !thingsToDo.length && (!blurb || blurb.length < 60) && !getThere;

  const out = {
    id: sid, cityId: s.cityId, submittedBy: s.submittedBy, date: s.date,
    photos, blurb: blurb || "", getThere: getThere || "", thingsToDo,
    reactions: mapReactions(starter.reactions),
    comments: gatherComments(t),
  };
  if (videos.length) out.videos = videos;
  if (s.note) out.note = s.note;
  if (lite) out.lite = true;
  return out;
}).filter(Boolean).sort((a, b) => (a.date < b.date ? -1 : 1));

// CITIES — pure place registry; only cities that still have ≥1 submission.
const usedCityIds = new Set(SUBMISSIONS.map((s) => s.cityId));
const CITIES = citiesIn.filter((c) => usedCityIds.has(c.id)).map((c) => ({
  id: c.id, name: c.name, country: c.country, cc: c.cc,
  continent: c.continent, lat: c.lat, lng: c.lng, population: c.population,
})).sort((a, b) => a.name.localeCompare(b.name));

// CONTRIBUTORS — derived from the surviving submissions; count = their submissions.
const tierOf = (n) => (n >= 15 ? "gold" : n >= 10 ? "silver" : n >= 5 ? "bronze" : null);
const counts = {};
for (const s of SUBMISSIONS) counts[s.submittedBy] = (counts[s.submittedBy] || 0) + 1;
const CONTRIBUTORS = {};
for (const [key, count] of Object.entries(counts)) {
  const c = contribIn[key] || {};
  const entry = { handle: c.handle || key, display: c.display || c.handle || key, count, tier: tierOf(count) };
  if (HOST_HANDLES.has(entry.handle)) entry.role = "Host";
  // keep field order natural: handle, display, [role], count, tier
  CONTRIBUTORS[key] = entry.role
    ? { handle: entry.handle, display: entry.display, role: entry.role, count, tier: entry.tier }
    : { handle: entry.handle, display: entry.display, count, tier: entry.tier };
}

/* ---- emit data.js (STATS derives itself, verbatim per the spec) ----------- */
const totals = {
  submissions: SUBMISSIONS.length,
  cities: new Set(SUBMISSIONS.map((s) => s.cityId)).size,
  countries: new Set(CITIES.filter((c) => SUBMISSIONS.some((s) => s.cityId === c.id)).map((c) => c.country)).size,
  photos: SUBMISSIONS.reduce((n, s) => n + s.photos.length, 0),
  comments: SUBMISSIONS.reduce((n, s) => n + s.comments.length, 0),
};
const banner = `/* AUTO-GENERATED by build_data.mjs — do not edit by hand.\n` +
  `   ${totals.submissions} submissions · ${totals.cities} cities · ${totals.countries} countries · ${totals.photos} photos */\n`;
const js = banner +
  `const CONTRIBUTORS = ${JSON.stringify(CONTRIBUTORS, null, 2)};\n\n` +
  `const CITIES = ${JSON.stringify(CITIES, null, 2)};\n\n` +
  `const SUBMISSIONS = ${JSON.stringify(SUBMISSIONS, null, 2)};\n\n` +
  `const STATS = (() => {\n` +
  `  const ids = new Set(SUBMISSIONS.map(s => s.cityId));\n` +
  `  const sc = CITIES.filter(c => ids.has(c.id));\n` +
  `  return {\n` +
  `    submissions: SUBMISSIONS.length,\n` +
  `    cities: sc.length,\n` +
  `    countries: new Set(sc.map(c => c.country)).size,\n` +
  `    continents: new Set(sc.map(c => c.continent)).size,\n` +
  `    photos: SUBMISSIONS.reduce((n,s) => n + s.photos.length, 0),\n` +
  `    contributors: Object.keys(CONTRIBUTORS).length,\n` +
  `    comments: SUBMISSIONS.reduce((n,s) => n + s.comments.length, 0),\n` +
  `  };\n})();\n\n` +
  `if (typeof window !== "undefined") Object.assign(window, { CONTRIBUTORS, CITIES, SUBMISSIONS, STATS });\n`;
fs.writeFileSync(path.join(ROOT, "data.js"), js);

console.log("wrote data.js");
console.log(`  cities (with submissions): ${totals.cities} / ${CITIES.length} registry`);
console.log(`  submissions:  ${totals.submissions}`);
console.log(`  contributors: ${Object.keys(CONTRIBUTORS).length}`);
console.log(`  countries:    ${totals.countries} · photos: ${totals.photos} · comments: ${totals.comments}`);
console.log(`  lite submissions (no parsed prose): ${SUBMISSIONS.filter((s) => s.lite).length}`);
