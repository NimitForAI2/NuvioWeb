# Poster-perf feature port → NuvioWeb

These two files add the **catalog poster downsizing + incremental "see all" grid**
performance work (the weak-Samsung-set optimization) on top of a vanilla Nuvio
fork. No renaming, no icon, no app-id, no build changes — so it still compiles
and installs normally.

## What this is / isn't

- **Included here (poster perf):**
  - `js/core/media/imageProxy.js` — adds `resizeImageUrlForDisplay()` (TMDB/metahub
    URL downsizing). Rest of the file is unchanged vanilla.
  - `js/ui/screens/catalog/catalogSeeAllScreen.js` — extracts a shared
    `renderSeeAllCard()`, uses the resized poster URL, and appends new cards on
    paging (`appendNewCards()`) instead of rebuilding the whole grid.

- **Included here (boot splash):**
  - `boot-guard.js` — adds an animated boot splash (app icon with a shimmer
    sweep) plus a "Built by Nimit" signature at the bottom-right. Also carries
    the "Next" rename in its user-facing strings (splash label, error title,
    unsupported-TV message). The splash loads `assets/images/tizenIcon.png` and
    self-dismisses on `guard.ready()`, window load, or an 8s hard cap.

- **Included here (app rename → "Next", display name only):**
  - `scripts/package-tizen.mjs` — `appName = "Next"` (drives the Tizen `<name>`
    and window `<title>`). The Tizen package/app ids stay `NuvioTV001` /
    `NuvioTV001.NuvioTV` ON PURPOSE, so the .wgt installs and updates the same
    app instead of breaking install like a full rename would.
  - `appinfo.json` — webOS `title` → "Next". The webOS `id`
    (`space.nuvio.webos`) and service id are unchanged.

- **NOT included (already present in your `NimitForAI/NuvioWeb` fork):**
  - The **subtitle fix** — `playerController.js` already has `avplaySubtitleUserEngaged`
    and `playerScreen.js` already has `embeddedSubtitleFallbackLabel`. Nothing to do.

- **NOT included (branding/build that broke TizenBrew install):**
  - `scripts/package-tizen.mjs`, `.github/workflows/build-tizen.yml`, `boot-guard.js`
    splash, `README.md`, `assets/images/tizenIcon.png`, and `local.properties`.

## How to apply

Drag the `js/` folder, `boot-guard.js`, `appinfo.json`, and the `scripts/`
folder onto your `NimitForAI2/NuvioWeb` repo root in the GitHub web UI (or copy
into your local clone). GitHub will overwrite the files in place. All replace
whole files, so no manual merging is needed.

## Note on secrets

Do not copy Flux's committed `local.properties` into a public repo — it contains
a live `TRAKT_CLIENT_SECRET` and other keys. Use `local.example.properties` +
repo secrets instead, and consider rotating that Trakt secret since it is already
public in the Flux repo.
