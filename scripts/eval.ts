// How well does matching work across real skies? Runs a set of names against
// several cities and times, and reports success rate, fit error, brightness.
//   npm run eval            summary
//   npm run eval -- -v      per-name detail
//   npm run eval -- --night search dusk to dawn (30-min steps) instead of one fixed time

import { readFileSync } from "node:fs";
import { visibleSky, type CatalogStar } from "../src/astro.ts";
import { lettersOverlap, matchName, type NameMatch } from "../src/matcher.ts";
import { bestTimeTonight, darkTimes, rank } from "../src/night.ts";

const catalog: CatalogStar[] = JSON.parse(readFileSync("public/stars.json", "utf8"));
const verbose = process.argv.includes("-v");
const night = process.argv.includes("--night");

const NAMES = ["ANA", "LEO", "MAYA", "OMAR", "SOFIA", "VIJAYA", "PRIYA", "JAMES", "ZOE", "BEATRIZ", "KWAME", "GUSTAVO", "XU", "QUINN", "ELIZABETH"];
const PLACES: [string, number, number][] = [
  ["London", 51.5, -0.13],
  ["Bengaluru", 12.97, 77.59],
  ["Sydney", -33.87, 151.21],
  ["Nairobi", -1.29, 36.82],
  ["Anchorage", 61.2, -149.9],
];
// Local ~22:00 at a few dates across the year (UTC hour adjusted by longitude).
const DATES = ["2026-01-15", "2026-04-15", "2026-07-15", "2026-09-23"];

let overlaps = 0;
let letters = 0, found = 0, fullNames = 0, runs = 0, errSum = 0, magSum = 0, ms = 0;
const perChar = new Map<string, [number, number]>();
const layouts = new Map<string, Map<string, number>>(); // name-length bucket -> layout -> count
const bucket = (n: number) => (n <= 3 ? "2-3" : n <= 5 ? "4-5" : n <= 7 ? "6-7" : "8+");

for (const [place, lat, lon] of PLACES) {
  for (const day of DATES) {
    const date = new Date(`${day}T22:00:00Z`);
    date.setUTCHours(date.getUTCHours() - Math.round(lon / 15));
    const sky = visibleSky(catalog, date, lat, lon);
    const noon = new Date(date.getTime() - 10 * 3600000);
    const times = night ? darkTimes(noon, lat, lon, 30) : [];
    if (night && times.length === 0) {
      console.log(`${place} ${day}: no dark hours, skipped`);
      continue;
    }
    for (const name of NAMES) {
      const t0 = performance.now();
      let m: NameMatch;
      if (night) {
        const result = await bestTimeTonight(noon, lat, lon, {
          evaluate: async (ts) => ts.map((time) => {
            const match = matchName(name, visibleSky(catalog, new Date(time), lat, lon), { scatterFallback: false });
            return { time, match, rank: rank(match) };
          }),
          scattered: async (time) => matchName(name, visibleSky(catalog, new Date(time), lat, lon)),
        });
        if (result.status === "no-night") continue;
        m = result.match;
      } else {
        m = matchName(name, sky);
      }
      ms += performance.now() - t0;
      runs++;
      letters += name.length;
      found += m.letters.length;
      if (m.missing.length === 0) fullNames++;
      const b = layouts.get(bucket(name.length)) ?? new Map<string, number>();
      b.set(m.layout, (b.get(m.layout) ?? 0) + 1);
      layouts.set(bucket(name.length), b);
      for (const l of m.letters) { errSum += l.error; magSum += l.meanMag; }
      m.letters.forEach((a, i) => m.letters.slice(i + 1).forEach((b) => {
        if (lettersOverlap(a, b, 0)) overlaps++;
      }));
      for (const ch of name) {
        const e = perChar.get(ch) ?? [0, 0];
        e[1]++;
        if (!m.missing.some((x) => x.char === ch)) e[0]++;
        perChar.set(ch, e);
      }
      if (verbose) {
        const desc = m.letters
          .map((l) => `${l.char}(err ${l.error.toFixed(3)}, mag ${l.meanMag.toFixed(1)}, h ${l.height.toFixed(2)})`)
          .join(" ");
        console.log(`${place.padEnd(10)} ${day} ${name.padEnd(10)} ${m.layout.padEnd(9)} ${desc}${m.missing.length ? "  MISSING " + m.missing.map((x) => x.char).join("") : ""}`);
      }
    }
  }
}

console.log(`\nruns: ${runs}   avg time: ${(ms / runs).toFixed(0)} ms/name`);
console.log(`letters found: ${found}/${letters} (${((100 * found) / letters).toFixed(1)}%)   full names: ${fullNames}/${runs}`);
console.log(`mean fit error: ${(errSum / found).toFixed(3)} letter-heights   mean star magnitude: ${(magSum / found).toFixed(2)}`);
console.log(`overlapping letter pairs: ${overlaps}`);
console.log("reading order by name length:");
for (const [b, counts] of [...layouts].sort()) {
  const n = [...counts.values()].reduce((x, y) => x + y, 0);
  const inOrder = n - (counts.get("scattered") ?? 0);
  const detail = [...counts].map(([l, c]) => `${l} ${c}`).join(", ");
  console.log(`  ${b.padEnd(4)} letters: ${inOrder}/${n} in order (${detail})`);
}
const weak = [...perChar].filter(([, [ok, n]]) => ok < n).map(([c, [ok, n]]) => `${c} ${ok}/${n}`);
if (weak.length) console.log(`letters sometimes missing: ${weak.join(", ")}`);
