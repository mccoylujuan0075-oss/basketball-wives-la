# basketball-wives-la

Basketball Wives LA — 100-Video Episode Library with MP4 Video Player | VH1 | TV Guide

## Features

- **100-episode library** across 6 seasons (metadata generated deterministically in the browser)
- **MP4 upload** — drag & drop or browse; files fill the currently selected episode first, then open slots in order
- **Video player** with Previous / Next navigation and auto-advance to the next loaded episode
- **Search** across titles, descriptions, and cast + **season filter** and **sorting** (episode order, most viewed, title)
- **Watched tracking** — episodes marked watched (manually or on completion) persist via `localStorage`
- **Library stats** — episode count, MP4s loaded, and watched count at a glance

## Run it

It's a single static page — just open `index.html` in a browser, or serve it:

```bash
python3 -m http.server 8000
# then visit http://localhost:8000
```

All video playback is local to your browser (object URLs); no files are uploaded anywhere.
