# Self-hosted webfonts

The site used to pull its fonts from `fonts.googleapis.com` via two `@import`s at the top
of `styles.css`. Those files now live here, so the site renders correctly with **no
third-party egress** — which is what lets the container serve a complete page on a locked-
down network, and stops every visitor from being announced to a third party.

`styles.css` imports `assets/fonts/fonts.css`; nothing else references these files.

## What's here

| Family | Files | Role |
|---|---|---|
| Archivo | `archivo-*.woff2` | Body text (`--ff-body`). Variable, weight 100–900, roman + italic |
| Archivo Black | `archivo-black-*.woff2` | Display headings (`--ff-display`) |
| Space Mono | `space-mono-*.woff2` | Mono UI/metadata text (`--ff-mono`), 400 + 700 |
| Noto Color Emoji | `noto-color-emoji-*.woff2` | Emoji fallback in all three stacks |

24 files, ~2.3 MB. Each family is split by unicode subset (latin, latin-ext, vietnamese) and
the emoji font into 10 COLRv1 subsets; every `@font-face` keeps its `unicode-range`, so a
browser still downloads only the subsets a page actually uses. Archivo is a variable font —
Google serves one file per (subset, style) covering the whole weight range, so several
`@font-face` blocks intentionally share a file.

The emoji font is the largest piece (~1.9 MB across 10 subsets) and it earns its place:
subset 0 is the regional-indicator range `U+1F1E6–1F1FF`, which is what makes flag emoji
render as flags rather than as two letters on platforms whose system font won't (Windows).
Pages that show no emoji download none of it.

## Refreshing

```bash
node assets/fonts/refresh_fonts.mjs
```

Re-fetches from the Google Fonts CSS API, rewrites `fonts.css` to point at the local copies,
and removes any file no longer referenced. It needs network access; the site does not. The
script is idempotent — re-running it on an up-to-date directory rewrites the same bytes.

To add or change a family, edit the `SOURCES` URLs at the top of the script and re-run.
`fonts.css` is generated — edit the script, not the CSS.

## Licensing

All four families are under the SIL Open Font License 1.1, which requires the license to
travel with the fonts. Verbatim upstream copies are in `licenses/`, one per family. Keep
them alongside the `.woff2` files if these are ever moved or copied elsewhere.
