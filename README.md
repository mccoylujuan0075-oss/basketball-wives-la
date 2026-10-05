# Basketball Wives LA — Episode Library & Local Video Player

A 100-episode metadata library for *Basketball Wives LA* (VH1) paired with a video player that
plays **your own local video files**. One self-contained `index.html` — no build step, no
dependencies, no accounts, and **no network calls of any kind**. Every byte of video you load
stays on your device.

## Run it

Open `index.html` directly in a browser, or serve the folder:

```bash
npm start            # python3 -m http.server 8000 --bind 0.0.0.0
# then open http://localhost:8000
```

Serving over HTTP (rather than `file://`) is recommended: browsers give origin-scoped storage
more room, so IndexedDB persistence behaves consistently.

## What it does

**Library**

- Exactly **100 episodes** across 6 seasons (14 / 16 / 17 / 18 / 20 / 15).
- Every episode has a generated title, description, air date, runtime, cast list, keywords and
  view count. Metadata is **deterministic** — seeded PRNG, so the library is identical on every
  reload instead of reshuffling.
- Air dates follow a weekly cadence per season, premiering 2011 → 2016.

**Loading your videos**

- **Drag & drop** onto the upload box, or browse. Accepts MP4/WebM/MOV/M4V.
- Filenames are matched to episodes automatically: `S02E05.mp4`, `s2e5`, `S02-E05`, `S02_E05`,
  `show.3x12.hdtv.mp4`, `4x17.mp4`, `S03.07_finale.mp4`, `Season 4 Episode 9.mp4`.
- Unmatched files fill the next empty episode slot. Batches get **distinct** targets — no two
  files collide on the same episode.
- Each import shows a queue row with its target episode, which you can change before importing.
- **"Assign to current episode"** forces the next file onto whatever is loaded in the player.
- **"Generate a demo clip"** renders a short branded clip locally with canvas + `MediaRecorder`
  (no external media) so the player can be exercised without owning any files.

**Persistence**

- Videos and thumbnails are stored in **IndexedDB**; watch progress, favorites and preferences in
  **localStorage**. Everything is restored on reload, including your last-watched position.
- Thumbnails are captured from the video itself (a frame at ~12% runtime); if a browser can't
  decode the file, cards fall back to a deterministic gradient placeholder.
- The summary bar reports episodes, videos loaded, total local runtime and storage used, and can
  request persistent storage where the browser supports it.

**Player & browsing**

- Continue-watching rail, resume-at-position, per-card progress bars and "watched" state.
- Autoplay-next (skips ahead to the next episode that actually has a video loaded).
- Prev/next episode, favorites, search across title/description/cast/code/keywords.
- Filters: season, cast member, loaded / missing / favorites. Sorts: library order, most viewed,
  air date, title, recently loaded, least remaining.
- Grid or list view, paginated 24 at a time so 100 cards stay responsive.
- Keyboard shortcuts: `Space`/`K` play-pause · `←`/`→` 5s · `J`/`L` 10s · `↑`/`↓` volume ·
  `M` mute · `F` fullscreen · `N`/`P` next/prev episode · `/` focus search.

## Tests

Two suites, no test framework required beyond jsdom for the DOM suite:

```bash
npm install
npm test          # both suites
npm run test:data # library/metadata + pure helpers (Node only)
npm run test:dom  # full UI in jsdom: import, playback, persistence, clear, XSS
```

- `tests/data.test.js` lifts the block between the `/* #region pure-data */` markers in
  `index.html` and runs it under Node, so the tested code *is* the shipped code. Keep that region
  free of DOM and browser APIs.
- `tests/dom.test.js` runs the real page in jsdom against an in-memory IndexedDB shim, a shared
  localStorage (so reloads are meaningful) and a controllable `<video>` stub. It covers initial
  render, filtering, sorting, pagination, playback, progress, drag-and-drop import, batch import,
  persistence across reload, clear-all, non-video rejection and XSS-via-filename.

Current status: **180 checks passing** (74 data + 106 DOM).

## Notes

- Episode metadata is generated placeholder content, not a licensed episode guide.
- Only you can supply the video files. Nothing is streamed, fetched or uploaded anywhere.
- Browsers cap origin storage; very large libraries may hit that quota. Use **Clear All Loaded
  Videos** to reclaim space (watch history and favorites are kept).
