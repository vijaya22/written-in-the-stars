// Minimal positional astronomy: where is each catalog star in the observer's sky?
// Precision is ~0.5° (no precession/nutation/refraction), plenty for drawing.

export type CatalogStar = [ra: number, dec: number, mag: number, ci: number, name: string];

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

/** Visible stars (alt > 0) projected onto a zenith-centred stereographic chart. */
export function visibleSky(catalog: CatalogStar[], date: Date, latDeg: number, lonDeg: number): SkyStar[] {
  const lst = localSiderealTime(date, lonDeg);
  const sinLat = Math.sin(latDeg * RAD);
  const cosLat = Math.cos(latDeg * RAD);
  const out: SkyStar[] = [];

  catalog.forEach(([ra, dec, mag, ci, name], id) => {
    const ha = (lst - ra * 15) * RAD;
    const sinDec = Math.sin(dec * RAD);
    const cosDec = Math.cos(dec * RAD);
    const sinAlt = sinLat * sinDec + cosLat * cosDec * Math.cos(ha);
    const alt = Math.asin(sinAlt) / RAD;
    if (alt <= 0) return;
    const az = Math.atan2(-cosDec * Math.sin(ha), sinDec * cosLat - cosDec * sinLat * Math.cos(ha)) / RAD;

    // Stereographic: horizon maps to r = 1. Looking up, east is on the left.
    const r = Math.tan(((90 - alt) / 2) * RAD);
    out.push({
      id, name, mag, ci, alt,
      az: (az + 360) % 360,
      x: -r * Math.sin(az * RAD),
      y: -r * Math.cos(az * RAD),
    });
  });
  return out;
}
