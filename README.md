# written-in-the-stars

Find your name spelled out in the real stars above you, for any place and time.

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

Needs Node ≥ 22.18 (runs TypeScript directly). To host it on a server with HTTPS, see [DEPLOY.md](DEPLOY.md).

## Checks

```sh
npm run eval                        # matching quality: names × cities × dates, overlap count
npm run eval -- --night             # same, searching dusk to dawn (slow)
node scripts/check-ephemeris.ts     # Moon/planet positions vs JPL Horizons
```

## API

| | |
|---|---|
| `GET /api/night?name=&lat=&lon=&from=` | best time that night (`from` = local noon, ms); cached |
| `GET /api/match?name=&lat=&lon=&time=` | the name at one moment |
| `GET /api/places?q=` | city search |
| `GET /api/places/near?lat=&lon=` | closest city (label and time zone for a GPS fix) |
| `GET /api/places/default?tz=` | biggest city in a time zone (starting place) |

Logs record paths only, never names or locations.

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
- `src/matcher.ts`: finds placements where every vertex of a letter lands on a real star, then lays
  the name out like text (any direction; the chart is turned to read left to right). Letters never
  overlap. Falls back to numbered letters when no ordered layout fits.
- `src/night.ts`: tries the name from dusk to dawn and keeps the moment it reads best.
- `server/`: HTTP API, worker-thread pool, result cache, city search.
