// Dusk-to-dawn search: as the Earth turns, different stars pass overhead.
// Try the name through the night and keep the moment where it reads best
// (in order, on one line, bright stars).
//
// The caller supplies `evaluate`, which matches the name at a batch of times
// (the server spreads a batch over worker threads; the eval runs it inline).

import { altitude } from "./astro.ts";
import { sunPosition } from "./ephemeris.ts";
import type { NameMatch } from "./matcher.ts";

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

/** Sun altitude (degrees) for an observer. */
export function sunAltitude(date: Date, lat: number, lon: number): number {
  const sun = sunPosition(date);
  return altitude(sun.ra, sun.dec, date, lat, lon);
}

/** The next moment (within a day) the sky is dark enough for the stars, or null. */
export function nextDark(after: Date, lat: number, lon: number): Date | null {
  for (let t = 0; t <= 24 * 60; t += 5) {
    const date = new Date(after.getTime() + t * 60000);
    if (sunAltitude(date, lat, lon) <= DARK_SUN_ALT) return date;
  }
  return null;
}

const LAYOUT_PENALTY = { line: 0, "two-lines": 1.5, scattered: 5 };

/** Lower is better: layout first, then fit and brightness per letter. */
export function rank(m: NameMatch): number {
  if (m.letters.length === 0) return Infinity;
  return 100 * m.missing.length + LAYOUT_PENALTY[m.layout] + m.cost / m.letters.length;
}

export interface NightStep {
  time: number; // ms timestamp
  match: NameMatch;
  rank: number;
}

export type NightResult =
  | { status: "found"; time: number; match: NameMatch } // readable in order
  | { status: "scattered"; time: number; match: NameMatch } // numbered letters, darkest moment
  | { status: "no-night" }; // the Sun never gets low enough

export interface NightSearch {
  /** Match the name (ordered layouts only) at each time. */
  evaluate: (times: number[]) => Promise<NightStep[]>;
  /** Match the name allowing scattered letters, at one time. */
  scattered: (time: number) => Promise<NameMatch>;
}

const best = (steps: NightStep[]) => steps.reduce((a, b) => (b.rank < a.rank ? b : a));

/**
 * Every 30 minutes through the dark hours, then a closer look around the
 * best one. The sky turns as a whole, so a match found at 23:00 is mostly
 * still there at 23:15; the coarse pass loses little.
 */
export async function bestTimeTonight(from: Date, lat: number, lon: number, search: NightSearch): Promise<NightResult> {
  const dark = darkTimes(from, lat, lon, 30);
  if (dark.length === 0) return { status: "no-night" };

  const coarse = best(await search.evaluate(dark.map((t) => t.date.getTime())));
  if (coarse.rank < Infinity) {
    const first = dark[0].date.getTime(), last = dark[dark.length - 1].date.getTime();
    const near = [-20, -10, 10, 20].map((m) => coarse.time + m * 60000).filter((t) => t >= first && t <= last);
    const pick = near.length ? best([coarse, ...(await search.evaluate(near))]) : coarse;
    return { status: "found", time: pick.time, match: pick.match };
  }

  const darkest = dark.reduce((a, b) => (b.sunAlt < a.sunAlt ? b : a)).date.getTime();
  return { status: "scattered", time: darkest, match: await search.scattered(darkest) };
}
