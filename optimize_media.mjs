/*
 * optimize_media.mjs — Globetrotter 2025 web-media optimizer
 *
 * Produces lean, web-sized derivatives of the photos the site actually uses, so
 * the deployable payload drops from ~8.6 GB of originals to ~1 GB and loads fast.
 *
 * What it does:
 *   1. Reads data.js and extracts every image path the site references
 *      (data/threads/<id>/images/originals/<name>.<ext>). Only referenced
 *      images are processed — unreferenced files and videos are ignored.
 *   2. Resizes each image to fit within MAX_EDGE (no upscaling) and re-encodes
 *      to WebP at QUALITY, writing to media/<id>/<name>.webp.
 *   3. Rewrites the referenced paths in data.js to point at the new media/ files.
 *      The original data.js is backed up to data.js.orig (once).
 *   4. With --with-videos, also re-encodes the .mov/.mp4 files under data/threads to
 *      720p H.264 in media/<id>/<name>.mp4. NOTE: videos are not referenced by
 *      data.js today, so this only prepares them — it does not put them on the
 *      site until the data layer is updated to include them.
 *
 * Run:
 *   node optimize_media.mjs                 # images only, rewrite data.js
 *   node optimize_media.mjs --limit 20      # process only first 20 images (test)
 *   node optimize_media.mjs --no-rewrite    # build media/ but leave data.js alone
 *   node optimize_media.mjs --with-videos   # also transcode videos
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import sharp from "sharp";

// ---- tunables (match the agreed targets) --------------------------------
const MAX_EDGE = 2048;        // longest image edge, px (no upscaling)
const QUALITY = 82;           // WebP quality
const VIDEO_HEIGHT = 720;     // video target height
const VIDEO_BITRATE = "2M";   // video target bitrate
const IMG_CONCURRENCY = Math.max(2, os.cpus().length - 1);
const VIDEO_CONCURRENCY = 2;  // ffmpeg is heavy; keep this low
// -------------------------------------------------------------------------

const argv = process.argv.slice(2);
const hasFlag = (f) => argv.includes(f);
const getOpt = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };

const ROOT = path.resolve(".");
const DATA_JS = path.join(ROOT, "data.js");
const MEDIA_DIR = path.join(ROOT, "media");
const LIMIT = getOpt("--limit") ? parseInt(getOpt("--limit"), 10) : Infinity;
const REWRITE = !hasFlag("--no-rewrite");

const IMG_RE = /data\/threads\/(\d+)\/images\/originals\/([^"'\\]+?)\.(jpe?g|png|webp)/gi;

function fmtMB(bytes) { return (bytes / 1048576).toFixed(1) + " MB"; }

// derivative path for a referenced original image
function webDest(id, name) { return path.join("media", id, name + ".webp"); }

async function pool(items, concurrency, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function run() {
    while (next < items.length) {
      const i = next++;
      results[i] = await worker(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
  return results;
}

async function optimizeImages() {
  const dataText = fs.readFileSync(DATA_JS, "utf8");

  // unique referenced image paths
  const seen = new Map(); // srcRel -> {id, name, srcRel, destRel}
  for (const m of dataText.matchAll(IMG_RE)) {
    const srcRel = m[0];
    if (seen.has(srcRel)) continue;
    seen.set(srcRel, { id: m[1], name: m[2], srcRel, destRel: webDest(m[1], m[2]) });
  }
  let jobs = [...seen.values()];
  if (LIMIT < jobs.length) jobs = jobs.slice(0, LIMIT);
  console.log(`Found ${seen.size} referenced images${LIMIT < seen.size ? `, processing first ${jobs.length}` : ""}.`);

  let srcBytes = 0, destBytes = 0, done = 0, missing = 0, failed = 0;
  await pool(jobs, IMG_CONCURRENCY, async (job) => {
    const src = path.join(ROOT, job.srcRel);
    const dest = path.join(ROOT, job.destRel);
    if (!fs.existsSync(src)) { missing++; job.skip = true; return; }
    try {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      await sharp(src, { failOn: "none" })
        .rotate() // respect EXIF orientation
        .resize(MAX_EDGE, MAX_EDGE, { fit: "inside", withoutEnlargement: true })
        .webp({ quality: QUALITY })
        .toFile(dest);
      srcBytes += fs.statSync(src).size;
      destBytes += fs.statSync(dest).size;
      if (++done % 200 === 0) console.log(`  ${done}/${jobs.length} images...`);
    } catch (e) {
      failed++; job.skip = true;
      console.warn(`  ! failed ${job.srcRel}: ${e.message}`);
    }
  });

  console.log(`Images done: ${done} ok, ${missing} missing, ${failed} failed.`);
  if (destBytes) console.log(`  ${fmtMB(srcBytes)} -> ${fmtMB(destBytes)} (${(100 - destBytes / srcBytes * 100).toFixed(0)}% smaller)`);

  // rewrite data.js (only paths we actually produced)
  if (REWRITE && LIMIT === Infinity) {
    const backup = DATA_JS + ".orig";
    if (!fs.existsSync(backup)) fs.copyFileSync(DATA_JS, backup);
    let out = dataText;
    let rewritten = 0;
    for (const job of seen.values()) {
      if (job.skip) continue;
      const before = out;
      out = out.split(job.srcRel).join(job.destRel.split(path.sep).join("/"));
      if (out !== before) rewritten++;
    }
    fs.writeFileSync(DATA_JS, out);
    console.log(`Rewrote ${rewritten} unique paths in data.js (backup: data.js.orig).`);
  } else if (REWRITE) {
    console.log("Skipped data.js rewrite (--limit set; run without --limit to rewrite).");
  }
}

function findVideos(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) findVideos(p, acc);
    else if (/\.(mov|mp4)$/i.test(e.name)) acc.push(p);
  }
  return acc;
}

function ffmpeg(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    proc.stderr.on("data", (d) => { err += d.toString(); });
    proc.on("close", (code) => code === 0 ? resolve() : reject(new Error(err.slice(-400))));
  });
}

async function optimizeVideos() {
  const threadsDir = path.join(ROOT, "data", "threads");
  if (!fs.existsSync(threadsDir)) return;
  const vids = findVideos(threadsDir);
  console.log(`\nFound ${vids.length} videos to transcode (not referenced by site).`);
  let srcBytes = 0, destBytes = 0, done = 0, failed = 0;
  await pool(vids, VIDEO_CONCURRENCY, async (src) => {
    const id = path.relative(threadsDir, src).split(path.sep)[0];
    const base = path.basename(src).replace(/\.[^.]+$/, "");
    const dest = path.join(MEDIA_DIR, id, base + ".mp4");
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    try {
      await ffmpeg([
        "-y", "-i", src,
        "-vf", `scale=-2:'min(${VIDEO_HEIGHT},ih)'`,
        "-c:v", "libx264", "-preset", "medium", "-b:v", VIDEO_BITRATE,
        "-movflags", "+faststart",
        "-c:a", "aac", "-b:a", "128k",
        dest,
      ]);
      srcBytes += fs.statSync(src).size;
      destBytes += fs.statSync(dest).size;
      console.log(`  [${++done}/${vids.length}] ${path.basename(src)} -> ${fmtMB(fs.statSync(dest).size)}`);
    } catch (e) {
      failed++;
      console.warn(`  ! failed ${src}: ${e.message}`);
    }
  });
  console.log(`Videos done: ${done} ok, ${failed} failed.`);
  if (destBytes) console.log(`  ${fmtMB(srcBytes)} -> ${fmtMB(destBytes)} (${(100 - destBytes / srcBytes * 100).toFixed(0)}% smaller)`);
}

console.log(`Optimizing media -> ${MEDIA_DIR}`);
console.log(`  images: max ${MAX_EDGE}px, WebP q${QUALITY}, ${IMG_CONCURRENCY} workers`);
if (!hasFlag("--no-images")) await optimizeImages();
if (hasFlag("--with-videos")) await optimizeVideos();
console.log("Done.");
