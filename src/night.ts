// Dusk-to-dawn search: as the Earth turns, different stars pass overhead.
// Try the name at regular times through the night and keep the moment where
// it reads best (in order, on one line, bright stars).

import { altitude, visibleSky, type CatalogStar } from "./astro.ts";
import { sunPosition } from "./ephemeris.ts";
import { matchName, type NameMatch } from "./matcher.ts";

/** Sun this far below the horizon: sky dark enough for the stars we use. */
const DARK_SUN_ALT = -12;

export interface NightTime {
  date: Date;
  sunAlt: number;
}

/** Dark times in the 24 h after `from` (pass local noon to get "tonight"). */
export function darkTimes(from: Date, lat: number, lon: number, stepMin = 15): NightTime[] {
  const out: NightTime[] = [];
  for (let t = 0; t < 24 * 60; t += stepMin) {
    const date = new Date(from.getTime() + t * 60000);
    const sun = sunPosition(date);
    const sunAlt = altitude(sun.ra, sun.dec, date, lat, lon);
    if (sunAlt <= DARK_SUN_ALT) out.push({ date, sunAlt });
  }
  return out;
}

const LAYOUT_PENALTY = { line: 0, "two-lines": 1.5, scattered: 5 };

/** Lower is better: layout first, then fit and brightness per letter. */
export function rank(m: NameMatch): number {
  if (m.letters.length === 0) return Infinity;
  return 100 * m.missing.length + LAYOUT_PENALTY[m.layout] + m.cost / m.letters.length;
}

export interface NightProgress {
  done: number;
  total: number;
  best: { date: Date; match: NameMatch } | null;
}

/**
 * Yields after every time tried, with the best result so far. Only ordered
 * layouts are considered; if none fits all night, falls back to scattered
 * letters at the darkest moment.
 */
export function* searchNight(
  name: string, catalog: CatalogStar[], times: NightTime[], lat: number, lon: number,
): Generator<NightProgress> {
  let best: NightProgress["best"] = null;
  let bestRank = Infinity;
  for (const [i, { date }] of times.entries()) {
    const match = matchName(name, visibleSky(catalog, date, lat, lon), { scatterFallback: false });
    const r = rank(match);
    if (r < bestRank) {
      bestRank = r;
      best = { date, match };
    }
    yield { done: i + 1, total: times.length, best };
  }
  if (!best && times.length) {
    const darkest = times.reduce((a, b) => (b.sunAlt < a.sunAlt ? b : a));
    best = { date: darkest.date, match: matchName(name, visibleSky(catalog, darkest.date, lat, lon)) };
    yield { done: times.length, total: times.length, best };
  }
}
