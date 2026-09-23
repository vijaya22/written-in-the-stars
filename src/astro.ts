// Minimal positional astronomy: where is each catalog star in the observer's sky?
// Precision is ~0.5° (no precession/nutation/refraction), plenty for drawing.

import type { Body } from "./ephemeris.ts";

export type CatalogStar = [
  ra: number, dec: number, mag: number, ci: number, name: string,
  distanceLy: number | null, constellation: string, spectrum: string, luminosity: number | null,
];

export interface SkyStar {
  id: number;
  name: string;
  mag: number;
  ci: number;
  alt: number; // degrees above horizon
  az: number; // degrees, north = 0, east = 90
  x: number; // chart coords: unit disk, zenith at origin, north up, east left
  y: number; // y grows downward (screen convention)
}

const RAD = Math.PI / 180;

export function julianDate(date: Date): number {
  return date.getTime() / 86400000 + 2440587.5;
}

/** Local sidereal time in degrees. */
export function localSiderealTime(date: Date, lonDeg: number): number {
  const d = julianDate(date) - 2451545.0;
  const gmst = 280.46061837 + 360.98564736629 * d;
  return (((gmst + lonDeg) % 360) + 360) % 360;
}

/** Altitude/azimuth (degrees) of a J2000 RA (hours) / Dec (degrees). */
function horizontal(ra: number, dec: number, lstDeg: number, latDeg: number) {
  const ha = (lstDeg - ra * 15) * RAD;
  const sinLat = Math.sin(latDeg * RAD), cosLat = Math.cos(latDeg * RAD);
  const sinDec = Math.sin(dec * RAD), cosDec = Math.cos(dec * RAD);
  const alt = Math.asin(sinLat * sinDec + cosLat * cosDec * Math.cos(ha)) / RAD;
  const az = Math.atan2(-cosDec * Math.sin(ha), sinDec * cosLat - cosDec * sinLat * Math.cos(ha)) / RAD;
  return { alt, az: (az + 360) % 360 };
}

/** Altitude (degrees) of a J2000 RA/Dec for an observer. */
export function altitude(ra: number, dec: number, date: Date, latDeg: number, lonDeg: number): number {
  return horizontal(ra, dec, localSiderealTime(date, lonDeg), latDeg).alt;
}

/** Stereographic chart: zenith at the origin, horizon at r = 1. Looking up, east is on the left. */
function chartXY(alt: number, az: number) {
  const r = Math.tan(((90 - alt) / 2) * RAD);
  return { x: -r * Math.sin(az * RAD), y: -r * Math.cos(az * RAD) };
}

/** Visible stars (alt > 0) projected onto a zenith-centred stereographic chart. */
export function visibleSky(catalog: CatalogStar[], date: Date, latDeg: number, lonDeg: number): SkyStar[] {
  const lst = localSiderealTime(date, lonDeg);
  const out: SkyStar[] = [];
  catalog.forEach(([ra, dec, mag, ci, name], id) => {
    const { alt, az } = horizontal(ra, dec, lst, latDeg);
    if (alt <= 0) return;
    out.push({ id, name, mag, ci, alt, az, ...chartXY(alt, az) });
  });
  return out;
}

export interface SkyBody extends Body {
  alt: number;
  az: number;
  x: number;
  y: number;
  litAngle?: number; // Moon only: chart direction (radians) from the Moon toward the Sun
}

const unit = (ra: number, dec: number): [number, number, number] => [
  Math.cos(dec * RAD) * Math.cos(ra * 15 * RAD),
  Math.cos(dec * RAD) * Math.sin(ra * 15 * RAD),
  Math.sin(dec * RAD),
];

/** Moon and planets above the horizon, projected like the stars. */
export function visibleBodies(bodies: Body[], date: Date, latDeg: number, lonDeg: number): SkyBody[] {
  const lst = localSiderealTime(date, lonDeg);
  const out: SkyBody[] = [];
  for (const b of bodies) {
    let { alt, az } = horizontal(b.ra, b.dec, lst, latDeg);
    // Seen from Earth's surface rather than its centre, the Moon sits up to ~1° lower.
    if (b.parallaxDeg) alt -= b.parallaxDeg * Math.cos(alt * RAD);
    if (alt <= 0) continue;
    const body: SkyBody = { ...b, alt, az, ...chartXY(alt, az) };

    if (b.sunRa !== undefined && b.sunDec !== undefined) {
      // Step 1° from the Moon toward the Sun along the sky, and see which way that is on the chart.
      const m = unit(b.ra, b.dec), s = unit(b.sunRa, b.sunDec);
      const k = Math.cos(1 * RAD) - 1;
      const dir = s.map((v, i) => v - m[i] * (m[0] * s[0] + m[1] * s[1] + m[2] * s[2]));
      const n = Math.hypot(...dir);
      const p = m.map((v, i) => v * (1 + k) + (dir[i] / n) * Math.sin(1 * RAD));
      const ra = Math.atan2(p[1], p[0]) / RAD / 15;
      const dec = Math.asin(p[2]) / RAD;
      // Parallax shifts both points alike, so the direction uses the unshifted positions.
      const from = horizontal(b.ra, b.dec, lst, latDeg), to = horizontal(ra, dec, lst, latDeg);
      const p0 = chartXY(from.alt, from.az), p1 = chartXY(to.alt, to.az);
      body.litAngle = Math.atan2(p1.y - p0.y, p1.x - p0.x);
    }
    out.push(body);
  }
  return out;
}
