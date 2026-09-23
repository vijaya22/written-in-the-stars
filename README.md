# Written in the Stars

Find your name spelled out in the real stars above you, for any place and time.
Live at **https://stars.vijaya.io**.

## What it does

- **Real sky:** 5,000 naked-eye stars from the HYG catalog, placed for your city and time;
  the Moon (with its phase) and planets are computed too.
- **Your name in stars:** each letter is a real star pattern; letters never overlap, and the
  chart is turned so the name reads left to right. Each letter lists the named stars it uses.
- **Best time tonight:** "Find" searches dusk to dawn and picks the moment the name reads best,
  with where to look ("face south-east, about 55° up").
- **Honest about visibility:** choose City / Suburb / Dark sky; stars too faint for your sky
  show as dashed rings. Daylight and twilight are shown as they are.
- **Any city:** search 34,000 cities (time zones included), or use your location.
- **Share:** the address bar always links to the exact sky shown, and pasting that link into
  WhatsApp, iMessage, Slack, X etc. shows a preview image of that sky. Share or save an image.
- **Posters:** print-ready vector PDFs in five sizes (A3, A2, 30 × 40 cm, 12 × 16 in,
  18 × 24 in) and three styles (Midnight, Paper, Ink), with every letter's stars listed.

## Run

```sh
npm install
npm run server       # API on :8787 (matching runs here, on worker threads)
npm run dev          # site on :5173, proxies /api to the server
```

Production: one process serves the API and the built site.

```sh
npm run build && npm start          # http://localhost:8787   (PORT, WORKERS env vars)
```

Needs Node ≥ 22.18 (runs TypeScript directly).

## Checks

```sh
npm run eval                        # matching quality: names × cities × dates, overlap count
npm run eval -- --night             # same, searching dusk to dawn (slow)
node scripts/check-ephemeris.ts     # Moon/planet positions vs JPL Horizons
```

## API

| | |
|---|---|
| `GET /api/night?name=&lat=&lon=&from=&sky=` | best time that night (`from` = local noon, ms); cached |
| `GET /api/match?name=&lat=&lon=&time=&sky=` | the name at one moment |
| `GET /api/places?q=` | city search |
| `GET /api/places/near?lat=&lon=` | closest city (label and time zone for a GPS fix) |
| `GET /api/places/default?tz=` | biggest city in a time zone (starting place) |
| `GET /og.png?<share link>` | link-preview image of a shared sky (1200 × 630); cached |
| `GET /poster.pdf?<share link>&size=&theme=` | print poster PDF (`size`: a3, a2, 30x40, 12x16, 18x24; `theme`: midnight, paper, ink) |
| `GET /?<share link>` | the page, with preview tags for that sky (chat apps read these; they don't run scripts) |

A share link is the page's own address: `?name=&place=&lat=&lon=&tz=&when=&sky=`.

`sky` is `city`, `suburb` or `dark` (default): the matcher prefers stars visible from there.

Searches are rate-limited per visitor (20 a minute, bursts of 10), and new searches get a
429 while the server is working through a long queue. Logs record paths only, never names or
locations.

## Data

Both generated files are committed; rebuild them only to update the sources.

- `public/stars.json` from the [HYG database](https://github.com/astronexus/HYG-Database) (CC BY-SA 4.0):
  ```sh
  curl -L -o data/hygdata_v41.csv https://raw.githubusercontent.com/astronexus/HYG-Database/main/hyg/CURRENT/hygdata_v41.csv
  npm run stars
  ```
- `server/data/places.json` from [GeoNames](https://www.geonames.org) (CC BY 4.0), cities over 15,000 people:
  ```sh
  curl -L -o data/cities15000.zip https://download.geonames.org/export/dump/cities15000.zip && unzip -o data/cities15000.zip -d data
  curl -L -o data/admin1CodesASCII.txt https://download.geonames.org/export/dump/admin1CodesASCII.txt
  curl -L -o data/countryInfo.txt https://download.geonames.org/export/dump/countryInfo.txt
  node scripts/build-places.mjs
  ```

## How it works

- `src/astro.ts`: sidereal time → altitude/azimuth for each star → zenith-centred sky chart.
- `src/ephemeris.ts`: Moon (with phase) and planets from orbital elements; within ~5′ of JPL Horizons.
- `src/glyphs.ts`: each letter as a few vertices + strokes.
- `src/sky.ts`: sky brightness (city / suburb / dark) and twilight: which stars can be seen.
- `src/matcher.ts`: finds placements where every vertex of a letter lands on a real star, then lays
  the name out like text (any direction; the chart is turned to read left to right). Letters never
  overlap. Falls back to numbered letters when no ordered layout fits.
- `src/night.ts`: tries the name from dusk to dawn and keeps the moment it reads best.
- `src/render.ts`: draws the chart (night, twilight or day) on a canvas.
- `src/share.ts`: the social card, link preview and posters, drawn with the same renderer;
  `src/describe.ts` writes their captions, `src/time.ts` handles time zones.
- `server/render-image.ts`: draws previews (PNG) and posters (PDF) on the server with
  [skia-canvas](https://github.com/samizdatco/skia-canvas), using bundled fonts
  (`server/fonts`: EB Garamond and Inter, SIL Open Font License).
- `src/place-picker.ts`, `src/main.ts`: the page.
- `server/`: HTTP API, worker-thread pool, result cache, rate limits, city search.

## Deploying

Runs as two Docker containers (Node app + Caddy for HTTPS). See [DEPLOY.md](DEPLOY.md).
