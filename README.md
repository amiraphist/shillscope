# shillscope

Paste a shill thread. See every piece.

**Live:** https://shillscope.amiraphist.workers.dev · **Demo:** https://shillscope.amiraphist.workers.dev/?demo

Paste an X post link, hit **go**, and every image reply becomes a card: artwork, artist, followers, verification, price, platform, edition, and a direct collect link.

## Features

- Sorts: smart, rising now, ready to collect, lowest price, newest, and more
- gems ↔ hype slider to blend hidden gems with popular pieces
- Sale slider: all · auction · buy now · edition
- Filters: 1/1, collect list, platform / chain
- GIFs and videos play inline (muted, only while visible), with sound in the lightbox
- Card size control: 1–4 columns on mobile, more on desktop
- Collect list, full-screen viewer, mobile friendly

## Data

- Default: free, no API key (public FxTwitter API, top replies only)
- Optional: add Worker secret `X_BEARER_TOKEN` for the full X API, and `ACCESS_KEY` to restrict who can use it

## Deploy

Cloudflare Worker: upload `worker.js` (built with `python3 build.py`).

## Files

- `worker.js` — the app (page + `/api/replies`)
- `worker.head.js`, `worker.tail.js` — worker source
- `index.src.html` — page source
- `index.html` — built page
- `build.py` — build script
- `bg.jpg` — background

by [@amiraphist](https://x.com/amiraphist)
