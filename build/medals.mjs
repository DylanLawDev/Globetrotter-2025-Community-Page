/*
 * medals.mjs — shared Discord medal + avatar join for the Globetrotter 2025 Atlas.
 *
 * The fuller Discord export (sibling of this repo by default) carries, per user:
 *   roles.json            — id, name (handle), display_name, roles[] (incl. medal roles)
 *   avatars/manifest.json — id -> local PNG (avatars/<id>.png) + CDN url
 *   avatars/<id>.png      — the avatar images
 *
 * Awarded medal roles ("Globetrotter 2025 Gold/Silver/Bronze") are the single source of
 * truth for a contributor's gold/silver/bronze status — NOT their submission count.
 *
 * The site's CONTRIBUTORS[key].handle matches the Discord `name` field exactly, so we
 * join on handle. Used by both build_data.mjs (full pipeline) and build/apply_medals.mjs.
 */
import fs from "node:fs";
import path from "node:path";

// Default export location: sibling of the repo root.
export const DEFAULT_EXPORT_DIR = (root) =>
  path.join(root, "..", "discord-forum-export", "data");

const MEDAL_ROLE = {
  "Globetrotter 2025 Gold": "gold",
  "Globetrotter 2025 Silver": "silver",
  "Globetrotter 2025 Bronze": "bronze",
};

// Highest medal a user's roles array confers (gold > silver > bronze), else null.
export function medalOf(roles = []) {
  const tiers = new Set(roles.map((r) => MEDAL_ROLE[r.name]).filter(Boolean));
  return tiers.has("gold") ? "gold" : tiers.has("silver") ? "silver"
       : tiers.has("bronze") ? "bronze" : null;
}

// Web path the optimized avatar will live at (referenced by data.js).
export const avatarDest = (key) => `media/avatars/${key}.webp`;

/*
 * Build a handle -> { id, medal, avatarFile } lookup from the export.
 * avatarFile is an ABSOLUTE path to the source PNG (only set when the file exists).
 * Returns null if the export dir is absent, so callers can degrade gracefully.
 */
export function loadMedalLookup(exportDir) {
  if (!exportDir || !fs.existsSync(exportDir)) return null;
  const rolesPath = path.join(exportDir, "roles.json");
  const manifestPath = path.join(exportDir, "avatars", "manifest.json");
  if (!fs.existsSync(rolesPath) || !fs.existsSync(manifestPath)) return null;

  const roles = JSON.parse(fs.readFileSync(rolesPath, "utf8"));
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

  const avatarByName = new Map();
  for (const m of manifest) {
    if (!m.avatar_file) continue;
    const abs = path.join(exportDir, m.avatar_file);
    if (fs.existsSync(abs)) avatarByName.set(m.name, abs);
  }

  const lookup = new Map();
  for (const u of roles) {
    lookup.set(u.name, {
      id: u.id,
      medal: medalOf(u.roles),
      avatarFile: avatarByName.get(u.name) || null,
    });
  }
  return lookup;
}

/*
 * Enrich a CONTRIBUTORS map in place using the lookup:
 *   - sets `tier` to the awarded medal (gold|silver|bronze|null) — REPLACING any count tier
 *   - sets `avatar` to the web path when the contributor has a source image
 * Returns the avatar jobs ([{ key, srcPng, dest }]) for the media optimizer.
 */
export function enrichContributors(contributors, lookup) {
  const jobs = [];
  for (const [key, c] of Object.entries(contributors)) {
    const hit = lookup && lookup.get(c.handle);
    c.tier = hit ? hit.medal : null;
    if (hit && hit.avatarFile) {
      c.avatar = avatarDest(key);
      jobs.push({ key, srcPng: hit.avatarFile, dest: avatarDest(key) });
    } else {
      delete c.avatar;
    }
  }
  return jobs;
}
