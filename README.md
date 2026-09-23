# written-in-the-stars

Find your name spelled out in the real stars above you, for any place and time.

## Run

```sh
npm install
npm run dev          # http://localhost:5173  (?name=Omar&place=Sydney&when=2026-09-23T21:30&still)
npm run eval         # matching quality across names, cities, dates (-- -v for detail)
```

`public/stars.json` is generated from the [HYG database](https://github.com/astronexus/HYG-Database) (CC BY-SA 4.0):

```sh
curl -L -o data/hygdata_v41.csv https://raw.githubusercontent.com/astronexus/HYG-Database/main/hyg/CURRENT/hygdata_v41.csv
npm run stars
```

## How it works

- `src/astro.ts`: sidereal time → altitude/azimuth for each star → zenith-centred sky chart.
- `src/glyphs.ts`: each letter as a few vertices + strokes.
- `src/matcher.ts`: finds placements where every vertex of a letter lands on a real star
  (shift/scale/small tilt, least-squares refit), prefers bright stars, then picks one
  placement per letter with a beam search (no shared stars, no overlaps, word-like layout).
