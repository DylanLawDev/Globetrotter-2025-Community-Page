/*
 * 01_extract.mjs — read the Discord export and emit a flat working file:
 *   build/threads.raw.json
 * One entry per thread with the fields the standardization step needs.
 * No world-knowledge here; purely mechanical extraction + a deterministic
 * "first pass" split of the freeform title into city / region / country.
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(process.argv[2] || ".");
const THREADS_DIR = path.join(ROOT, "data", "threads");

/* ---- sources of truth (from carls-example) -------------------------------
 * Two things we treat as authoritative over our own deterministic cleaning:
 *   1. DISQUALIFIED_THREAD_IDS — threads to drop entirely (info/meta + a few
 *      that aren't valid submissions). Skipped before anything else.
 *   2. PLACE_OVERRIDES — hand-curated corrections for ambiguous / misspelled
 *      titles. When one matches, Carl's value wins over our cleanTitle() guess.
 * Verbatim from carls-example/parser.js and carls-example/enrich-geo.js.
 */
const DISQUALIFIED_THREAD_IDS = new Set([
  "1334953230358151279", // Info thread
  "1324002473891069962", // General discussion
  "1456118171542098121", // Let's get lost in Amsterdam
  "1456117000626507837", // Brussels Belgium
  "1456114922940268679", // Tijuana (herman loves it here)
  "1456075818592633086", // Zermatt
  "1438742820633575435", // Iceland
  "1438742901126467727", // Iceland
  "1438741006358024302", // Madriduski
]);

const PLACE_OVERRIDES = {
  "athens": "athens greece",
  "72 hours in budapest hungary": "budapest hungary",
  "bratislavaa": "bratislava slovakia",
  "bucharest not budapest": "bucharest romania",
  "my ultimate 2 4h pisa guide": "pisa italy",
  "nepali pompeii": "pompeii italy",
  "roskilde near copenhagen": "roskilde denmark",
  "nuuk greenland denmark": "nuuk greenland",
  "land of the pirates greenville north carolina usa": "greenville north carolina usa",
  "the city i have fallen in love with cusco peru": "cusco peru",
  "the entertainment appetizer myrtle beach south carolina usa": "myrtle beach south carolina usa",
  "the quiet miraflores district in lima peru": "miraflores lima peru",
  "barcelonaaaaaa": "barcelona spain",
  "labubu city zurich": "zurich switzerland",
  "madriduski": "madrid spain",
  "nakhchivan autonomous region of azerbaijan": "nakhchivan azerbaijan",
  "el calafete argentina": "el calafate argentina",
  "budapest hungrary specifically pest": "budapest hungary",
  "boracay aklan philippines my island getaway": "boracay philippines",
  "puerto princesa palawan philippines stayed at astoria resort and visit to the subterranean river": "puerto princesa palawan philippines",
  "siem reap cambodia my journey to angkor wat": "siem reap cambodia",
  "vang vieng laos scenic and adventure capital": "vang vieng laos",
  "budapest the pearl of the danube": "budapest hungary",
  "garmisch partenkirchen and surroundings": "garmisch partenkirchen germany",
  "marrakesh morroco": "marrakesh morocco",
  "trier pearl of the moselle": "trier germany",
  "victoria falls zimbabwe livingstone zambia": "livingstone zambia",
  "lucern switzerstan": "lucerne switzerland",
  "salzburg shauuu": "salzburg austria",
  "hanoi vietnam southeast asia": "hanoi vietnam",
};

// Carl's normalization for matching override keys: NFKD, drop pictographs &
// combining marks, collapse every non-alphanumeric run to a single space.
function overrideKey(raw) {
  let t = String(raw || "").normalize("NFKD");
  t = t.replace(/\p{Extended_Pictographic}/gu, " ");
  t = t.replace(/[̀-ͯ]/g, "");
  t = t.replace(/[^\p{L}\p{N}]+/gu, " ");
  return t.trim().replace(/\s+/g, " ").toLowerCase();
}

// Split an override value ("greenville north carolina usa") into our guess
// shape, mirroring Carl's deriveFromQuery: first token = city, last = country.
function splitOverride(value) {
  const parts = value.split(/\s+/).filter(Boolean);
  return {
    city: parts[0] || null,
    mid: parts.length > 2 ? parts.slice(1, -1).join(" ") : null,
    tail: parts.length > 1 ? parts[parts.length - 1] : null,
  };
}

/* ---- deterministic title cleaning ---------------------------------------- */

// strip emoji / regional-indicator flags / pictographs / variation selectors
const EMOJI = /[\u{1F1E6}-\u{1F1FF}\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{FE0F}\u{200D}]/gu;

// editorial lead-ins people prepend: "Land of the Pirates: Greenville..."
//  -> we keep the part after a ": " when the part before looks like a slogan.
function stripEditorial(name) {
  let n = name;
  // "72 hours in X", "A weekend in X", "Exploring X"
  n = n.replace(/^\s*\d+\s*hours?\s+in\s+/i, "");
  n = n.replace(/^\s*(a\s+)?(weekend|day|days|week|trip|guide)\s+(in|to)\s+/i, "");
  n = n.replace(/^\s*(exploring|visiting|discover(ing)?|welcome to)\s+/i, "");
  // "Slogan: Actual City, Country"  -> take the part after the first colon
  //   only when there's a comma after it (i.e. it parses like a place)
  const colon = n.match(/^[^:]{3,40}:\s*(.+,.+)$/);
  if (colon) n = colon[1];
  // "X: subtitle"  (e.g. "Trier: Pearl of the Moselle") -> keep X
  else {
    const colon2 = n.match(/^(.+?):\s*.+$/);
    if (colon2) n = colon2[1];
  }
  return n.trim();
}

function cleanTitle(name) {
  let n = (name || "").replace(EMOJI, "");
  n = n.replace(/\s+/g, " ").trim();
  n = stripEditorial(n);
  // normalize separators: " - ", " · " etc into commas for splitting
  n = n.replace(/\s*[–—\-·|]\s*/g, ", ");
  n = n.replace(/\s*\.\s*(?=[A-Z])/g, ", "); // "York. United Kingdom"
  n = n.replace(/\s+,/g, ",").replace(/,\s*/g, ", ").replace(/,\s*$/, "");
  return n.trim();
}

// pull a "(note)" aside out of the title
function extractNote(name) {
  const m = name.match(/\(([^)]+)\)/);
  const note = m ? m[1].trim() : null;
  const stripped = name.replace(/\([^)]*\)/g, "").replace(/\s+/g, " ").trim();
  return { stripped, note };
}

function firstPassSplit(cleaned) {
  const parts = cleaned.split(",").map((s) => s.trim()).filter(Boolean);
  return {
    city: parts[0] || null,
    mid: parts.length > 2 ? parts.slice(1, -1).join(", ") : null, // region/state
    tail: parts.length > 1 ? parts[parts.length - 1] : null,      // usually country
  };
}

/* ---- population hint from starter content -------------------------------- */
function popHint(content = "") {
  const m = /population[^0-9]{0,25}([\d][\d.,\s]*)/i.exec(content);
  if (!m) return null;
  const n = parseInt(m[1].replace(/[^\d]/g, ""), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/* ---- walk threads -------------------------------------------------------- */
const ids = fs.readdirSync(THREADS_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory()).map((d) => d.name);

const out = [];
let disqualified = 0;
let overridden = 0;
for (const id of ids) {
  // source of truth #1: drop disqualified threads before doing any work
  if (DISQUALIFIED_THREAD_IDS.has(id)) { disqualified++; continue; }

  const file = path.join(THREADS_DIR, id, "thread.json");
  if (!fs.existsSync(file)) continue;
  const t = JSON.parse(fs.readFileSync(file, "utf8"));
  const starter = (t.author_posts || []).find((p) => p.is_starter) || (t.author_posts || [])[0];
  const content = starter?.content || "";
  const imgs = (starter?.attachments || []).filter((a) => (a.content_type || "").startsWith("image/"));
  const vids = (starter?.attachments || []).filter((a) => (a.content_type || "").startsWith("video/"));

  const { stripped, note } = extractNote(t.name || "");
  let cleaned = cleanTitle(stripped);
  let split = firstPassSplit(cleaned);

  // source of truth #2: a matching place override wins over our own cleaning
  const override = PLACE_OVERRIDES[overrideKey(t.name || "")] || null;
  if (override) {
    cleaned = override;
    split = splitOverride(override);
    overridden++;
  }

  out.push({
    id,
    rawName: t.name || "",
    note,
    cleaned,
    override,
    guess: split,
    owner: { name: t.owner?.name || null, display: t.owner?.display_name || null },
    created_at: t.created_at || starter?.created_at || null,
    populationHint: popHint(content),
    imageCount: imgs.length,
    videoCount: vids.length,
    contentLen: content.length,
    looksLikeSubmission: /population|country/i.test(content) && imgs.length > 0,
  });
}

out.sort((a, b) => (a.created_at || "").localeCompare(b.created_at || ""));
fs.mkdirSync(path.join(ROOT, "build"), { recursive: true });
fs.writeFileSync(path.join(ROOT, "build", "threads.raw.json"), JSON.stringify(out, null, 2));
console.log(`extracted ${out.length} threads -> build/threads.raw.json`);
console.log(`  dropped (disqualified): ${disqualified}`);
console.log(`  place overrides applied: ${overridden}`);
console.log(`  with image+pop/country (likely submissions): ${out.filter((t) => t.looksLikeSubmission).length}`);
console.log(`  no images: ${out.filter((t) => t.imageCount === 0).length}`);
