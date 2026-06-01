/* ==========================================================================
   GLOBETROTTER 2025 ATLAS — shared site helpers (vanilla)
   header / footer / formatting / photo rendering / data joins
   Model: CITIES (places) + SUBMISSIONS (threads, joined by cityId)
   ========================================================================== */

const FLAGS = {
  MX:"🇲🇽", CA:"🇨🇦", RO:"🇷🇴", PT:"🇵🇹", JP:"🇯🇵", MA:"🇲🇦", ZA:"🇿🇦", VN:"🇻🇳",
  NZ:"🇳🇿", CO:"🇨🇴", IS:"🇮🇸", GE:"🇬🇪", ES:"🇪🇸", BR:"🇧🇷", KR:"🇰🇷", TH:"🇹🇭",
  TR:"🇹🇷", EG:"🇪🇬", TZ:"🇹🇿", KE:"🇰🇪", AR:"🇦🇷", CL:"🇨🇱", PE:"🇵🇪", US:"🇺🇸",
  GB:"🏴󠁧󠁢󠁳󠁣󠁴󠁿", NO:"🇳🇴", AT:"🇦🇹", SI:"🇸🇮", BA:"🇧🇦", EE:"🇪🇪", AU:"🇦🇺"
};
// Use the curated override if present (e.g. GB→Scotland); otherwise derive the
// flag emoji from the ISO code's two regional-indicator letters.
const flag = (cc) => FLAGS[cc] || (/^[A-Za-z]{2}$/.test(cc || "")
  ? String.fromCodePoint(...[...cc.toUpperCase()].map((ch) => 0x1F1E6 + ch.charCodeAt(0) - 65))
  : "🏳️");

const fmtPop = (n) => n >= 1e6 ? (n/1e6).toFixed(n>=1e7?1:2).replace(/\.?0+$/,'') + "M"
                    : n >= 1e3 ? Math.round(n/1e3) + "k" : "" + n;

// gold/silver/bronze = awarded Globetrotter 2025 medal roles (see build/medals.mjs).
const TIER_LABEL = { gold:"Gold", silver:"Silver", bronze:"Bronze" };
const TIER_COLOR = { gold:"var(--gold)", silver:"var(--silver)", bronze:"var(--bronze)" };
const TIER_GLYPH = { gold:"★", silver:"✦", bronze:"✶" };

/* Avatar: real Discord image when present, else the styled first-letter fallback. */
const avatarHTML = (m, cls = "av") => m && m.avatar
  ? `<img class="${cls}" src="${m.avatar}" alt="${m.display}" loading="lazy" />`
  : `<span class="${cls}">${(m && m.display || "?")[0]}</span>`;

/* ---- data joins ----------------------------------------------------------- */
const contributor = (key) => CONTRIBUTORS[key] || { display:key, handle:key, count:0, tier:null };
const tierMembers = (t) => Object.entries(CONTRIBUTORS)
  .filter(([,v]) => v.tier === t).map(([k,v]) => ({ key:k, ...v }))
  .sort((a,b) => b.count - a.count);

const cityById = (id) => CITIES.find(c => c.id === id);
const submissionById = (id) => SUBMISSIONS.find(s => s.id === id);
const byDate = (a,b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);

/* submissions for one city (chronological) */
const submissionsForCity = (cityId) => SUBMISSIONS.filter(s => s.cityId === cityId).sort(byDate);
/* submissions by one member (chronological — their journey) */
const submissionsBy = (key) => SUBMISSIONS.filter(s => s.submittedBy === key).sort(byDate);
/* the place record a submission belongs to */
const cityOf = (sub) => cityById(sub.cityId);

/* distinct cities that actually have ≥1 submission */
const submittedCities = () => {
  const ids = new Set(SUBMISSIONS.map(s => s.cityId));
  return CITIES.filter(c => ids.has(c.id));
};
const submissionCount = (cityId) => SUBMISSIONS.filter(s => s.cityId === cityId).length;
const totalReacts = (s) => s.reactions.reduce((n,r)=>n+r.c,0);

/* ---- photo HTML ----------------------------------------------------------- */
const isVideo = (src) => /\.(mp4|mov|webm)$/i.test(src || "");
function photoHTML(p, { glyph = true, full = false } = {}) {
  if (p && p.src) {
    if (isVideo(p.src)) {
      // full = lightbox (playable); otherwise a muted poster tile with a play badge
      return full
        ? `<div class="photo vid"><video src="${p.src}" controls autoplay playsinline></video></div>`
        : `<div class="photo vid"><video src="${p.src}#t=0.1" muted playsinline preload="metadata"></video><span class="play-badge">▶</span></div>`;
    }
    return `<div class="photo"><img src="${p.src}" alt="${(p.caption||'').replace(/"/g,'&quot;')}" loading="lazy"></div>`;
  }
  const mood = (p && p.mood) || "warm";
  return `<div class="photo ph ph-${mood}">${glyph ? `<div class="ph-glyph">
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,.9)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8.5A1.5 1.5 0 0 1 4.5 7H7l1.2-1.8A1 1 0 0 1 9 4.7h6a1 1 0 0 1 .8.5L17 7h2.5A1.5 1.5 0 0 1 21 8.5v9A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5z"/><circle cx="12" cy="12.5" r="3.2"/></svg>
    <span>photo</span></div>` : ""}</div>`;
}

/* coordinate label e.g. 45.50°N · 73.57°W */
const coordLabel = (lat,lng) =>
  `${Math.abs(lat).toFixed(2)}°${lat<0?'S':'N'} · ${Math.abs(lng).toFixed(2)}°${lng<0?'W':'E'}`;

/* ---- header / footer ------------------------------------------------------ */
function siteHeader(active = "") {
  const links = [
    ["index.html", "Home", "home"],
    ["atlas.html", "Submissions", "atlas"],
    ["map.html", "World Map", "map"],
    ["contributors.html", "Trotters", "contributors"],
  ];
  return `<header class="site-header"><div class="bar">
    <a class="brand" href="index.html">
      <span class="seal">G</span>
      <span class="name">GLOBETROTTER<b>2025 ATLAS</b></span>
    </a>
    <nav class="nav">
      ${links.map(([href,label,key]) => `<a href="${href}" class="${key===active?'active':''}">${label}</a>`).join("")}
    </nav>
  </div></header>`;
}

function siteFooter() {
  return `<footer class="site-footer"><div class="inner">
    <div>
      <div class="brand" style="margin-bottom:12px">
        <span class="seal">G</span>
        <span class="name">GLOBETROTTER<b>2025 ATLAS</b></span>
      </div>
      <div class="mono">A community keepsake of everywhere we went in 2025.</div>
    </div>
    <div class="mono">
      <a href="atlas.html">All Submissions</a><br>
      <a href="map.html">World Map</a><br>
      <a href="contributors.html">Trotters &amp; Ranks</a>
    </div>
    <div class="mono">
      ${STATS.submissions} submissions · ${STATS.cities} cities<br>
      ${STATS.countries} countries · ${STATS.continents} continents<br>
      <span class="dim">Gold 15 · Silver 10 · Bronze 5</span>
    </div>
  </div></footer>`;
}

function mountChrome(active) {
  const h = document.getElementById("header");
  const f = document.getElementById("footer");
  if (h) h.outerHTML = siteHeader(active);
  if (f) f.outerHTML = siteFooter();
}

if (typeof window !== "undefined") {
  Object.assign(window, {
    flag, fmtPop, TIER_LABEL, TIER_COLOR, TIER_GLYPH, avatarHTML,
    contributor, tierMembers, cityById, submissionById,
    submissionsForCity, submissionsBy, cityOf, submittedCities,
    submissionCount, totalReacts, photoHTML, coordLabel,
    siteHeader, siteFooter, mountChrome,
  });
}
