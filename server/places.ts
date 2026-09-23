// City search over GeoNames (cities over 15,000 people), with time zones.
// Data: server/data/places.json, built by scripts/build-places.mjs.

import { readFileSync } from "node:fs";

export interface Place {
  name: string;
  region: string;
  country: string;
  lat: number;
  lon: number;
  timeZone: string;
  population: number;
}

type Row = [name: string, region: string, country: string, lat: number, lon: number, tz: number, pop: number, names: string];

const data: { timeZones: string[]; places: Row[] } = JSON.parse(
  readFileSync(new URL("./data/places.json", import.meta.url), "utf8"),
);

// Rows come sorted by population, so earlier = bigger.
const rows = data.places.map((r) => {
  const [own, others] = r[7].split(";");
  return { row: r, own: own.split("|"), others: others ? others.split("|") : [], where: `${key(r[1])} ${key(r[2])}` };
});

/** Lower-case, accent-free form used for matching ("St. Louis" → "saint louis"). Keep in sync with the build script. */
function key(s: string) {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[.'’]/g, "").replace(/\bst\b/g, "saint").replace(/\s+/g, " ").trim();
}

function toPlace([name, region, country, lat, lon, tz, population]: Row): Place {
  return { name, region, country, lat, lon, timeZone: data.timeZones[tz], population };
}

/**
 * "beng" → Bengaluru first. "springfield, illinois" narrows by region/country.
 * A city's own name beats its other names ("paris" → Paris before any place
 * that lists "Paris" as an alias); exact beats prefix; a later word ("york" →
 * New York) comes last. Within a tier, bigger places first.
 */
export function searchPlaces(query: string, limit = 8): Place[] {
  const [cityPart, ...rest] = key(query).split(",");
  const q = cityPart.trim();
  const where = rest.join(" ").trim();
  if (q.length < 2) return [];

  const wordStart = (k: string) => k.split(/[\s-]/).some((word) => word.startsWith(q));
  const tiers: Row[][] = [[], [], [], [], []];
  for (const { row, own, others, where: w } of rows) {
    if (where && !w.includes(where)) continue;
    let tier = -1;
    if (own.includes(q)) tier = 0;
    else if (own.some((k) => k.startsWith(q))) tier = 1;
    // A big city's well-known other name counts as its own ("calcutta" → Kolkata).
    else if (others.includes(q)) tier = row[6] >= 1_000_000 ? 0 : 2;
    else if (others.some((k) => k.startsWith(q))) tier = 3;
    else if ([...own, ...others].some(wordStart)) tier = 4;
    if (tier < 0) continue;
    tiers[tier].push(row);
    if (tiers[0].length >= limit) break;
  }
  return tiers.flat().slice(0, limit).map(toPlace);
}

/** The closest listed city, e.g. to label a GPS position and get its time zone. */
export function nearestPlace(lat: number, lon: number): { place: Place; distanceKm: number } {
  const rad = Math.PI / 180;
  let best = rows[0].row, bestD = Infinity;
  for (const { row } of rows) {
    const dLat = (row[3] - lat) * rad, dLon = (row[4] - lon) * rad;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat * rad) * Math.cos(row[3] * rad) * Math.sin(dLon / 2) ** 2;
    if (a < bestD) { bestD = a; best = row; }
  }
  return { place: toPlace(best), distanceKm: Math.round(2 * 6371 * Math.asin(Math.sqrt(bestD))) };
}

/** The biggest city in a time zone: a sensible starting place for a visitor. */
export function largestInTimeZone(timeZone: string): Place | null {
  const tz = data.timeZones.indexOf(timeZone);
  const hit = tz >= 0 ? rows.find(({ row }) => row[5] === tz) : undefined;
  return hit ? toPlace(hit.row) : null;
}
