// How well does matching work across real skies? Runs a set of names against
// several cities and times, and reports success rate, fit error, brightness.
//   npm run eval            summary
//   npm run eval -- -v      per-name detail

import { readFileSync } from "node:fs";
import { visibleSky, type CatalogStar } from "../src/astro.ts";
import { matchName } from "../src/matcher.ts";

const catalog: CatalogStar[] = JSON.parse(readFileSync("public/stars.json", "utf8"));
const verbose = process.argv.includes("-v");

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

let letters = 0, found = 0, fullNames = 0, runs = 0, errSum = 0, magSum = 0, ms = 0;
const perChar = new Map<string, [number, number]>();

for (const [place, lat, lon] of PLACES) {
  for (const day of DATES) {
    const date = new Date(`${day}T22:00:00Z`);
    date.setUTCHours(date.getUTCHours() - Math.round(lon / 15));
    const sky = visibleSky(catalog, date, lat, lon);
    for (const name of NAMES) {
      const t0 = performance.now();
      const m = matchName(name, sky);
      ms += performance.now() - t0;
      runs++;
      letters += name.length;
      found += m.letters.length;
      if (m.missing.length === 0) fullNames++;
      for (const l of m.letters) { errSum += l.error; magSum += l.meanMag; }
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
        console.log(`${place.padEnd(10)} ${day} ${name.padEnd(10)} ${desc}${m.missing.length ? "  MISSING " + m.missing.map((x) => x.char).join("") : ""}`);
      }
    }
  }
}

console.log(`\nruns: ${runs}   avg time: ${(ms / runs).toFixed(0)} ms/name`);
console.log(`letters found: ${found}/${letters} (${((100 * found) / letters).toFixed(1)}%)   full names: ${fullNames}/${runs}`);
console.log(`mean fit error: ${(errSum / found).toFixed(3)} letter-heights   mean star magnitude: ${(magSum / found).toFixed(2)}`);
const weak = [...perChar].filter(([, [ok, n]]) => ok < n).map(([c, [ok, n]]) => `${c} ${ok}/${n}`);
if (weak.length) console.log(`letters sometimes missing: ${weak.join(", ")}`);
