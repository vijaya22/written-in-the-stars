// Compares src/ephemeris.ts against JPL Horizons (astrometric J2000 RA/Dec,
// geocentric). Reference values fetched from ssd.jpl.nasa.gov/api/horizons.api.
//   node scripts/check-ephemeris.ts

import { solarSystem } from "../src/ephemeris.ts";

// [UTC time, body, RA deg, Dec deg, V mag]
const HORIZONS: [string, string, number, number, number][] = [
  ["2026-09-23T16:00Z", "Mercury", 198.22012, -8.62311, -0.231],
  ["2026-09-23T16:00Z", "Venus", 211.91075, -19.593, -4.804],
  ["2026-09-23T16:00Z", "Mars", 119.21909, 21.632, 1.175],
  ["2026-09-23T16:00Z", "Jupiter", 140.49562, 16.02464, -1.85],
  ["2026-09-23T16:00Z", "Saturn", 11.87531, 2.16058, 0.38],
  ["2026-09-23T16:00Z", "Uranus", 63.35042, 21.02158, 5.664],
  ["2026-09-23T16:00Z", "Neptune", 3.02681, -0.23584, 7.679],
  ["2026-09-23T16:00Z", "Moon", 326.11275, -14.12932, -11.704],
  ["2027-03-10T00:00Z", "Mercury", 324.78969, -13.62659, 0.415],
  ["2027-03-10T00:00Z", "Venus", 312.40091, -17.53469, -4.029],
  ["2027-03-10T00:00Z", "Mars", 147.52042, 17.44253, -0.912],
  ["2027-03-10T00:00Z", "Jupiter", 141.16031, 16.33537, -2.481],
  ["2027-03-10T00:00Z", "Saturn", 13.51899, 3.34329, 0.772],
  ["2027-03-10T00:00Z", "Uranus", 59.60052, 20.37432, 5.738],
  ["2027-03-10T00:00Z", "Neptune", 3.42095, 0.01263, 7.822],
  ["2027-03-10T00:00Z", "Moon", 5.47243, 6.56966, -5.866],
];

const RAD = Math.PI / 180;
let worst = 0;
for (const [t, name, ra, dec, mag] of HORIZONS) {
  const b = solarSystem(new Date(t)).find((x) => x.name === name)!;
  const ra1 = b.ra * 15 * RAD, d1 = b.dec * RAD, ra2 = ra * RAD, d2 = dec * RAD;
  const sep = Math.acos(Math.min(1, Math.sin(d1) * Math.sin(d2) + Math.cos(d1) * Math.cos(d2) * Math.cos(ra1 - ra2))) / RAD;
  worst = Math.max(worst, sep);
  const magText = b.kind === "moon" ? `lit ${(100 * b.illuminated!).toFixed(0)}%` : `mag ${b.mag.toFixed(2)} (JPL ${mag})`;
  console.log(`${t}  ${name.padEnd(8)} off by ${(sep * 60).toFixed(1).padStart(5)}'   ${magText}`);
}
console.log(`\nworst error: ${(worst * 60).toFixed(1)} arcmin (${worst.toFixed(2)}°)`);
