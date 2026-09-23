// Positions of the Moon and planets, J2000 equatorial, geocentric.
// Planets: Keplerian elements from Standish, "Approximate Positions of the
// Planets" (JPL, valid 1800–2050), good to a few arcminutes.
// Moon: Paul Schlyter's method with the main perturbation terms, ~0.1°.

import { julianDate } from "./astro.ts";

const RAD = Math.PI / 180;
const OBLIQUITY = 23.43928 * RAD; // J2000

type Vec = [number, number, number];

export interface Body {
  name: string;
  kind: "planet" | "moon";
  ra: number; // hours, J2000
  dec: number; // degrees, J2000
  mag: number;
  color: string;
  illuminated?: number; // Moon only: lit fraction 0..1
  sunRa?: number; // Moon only: where the Sun is, to orient the lit side
  sunDec?: number;
  parallaxDeg?: number; // Moon only: horizontal parallax
}

// a (AU), e, I, L, long. perihelion, long. ascending node (degrees); then rates per Julian century.
type Elements = [number, number, number, number, number, number];
const PLANETS: Record<string, [Elements, Elements]> = {
  Mercury: [[0.38709927, 0.20563593, 7.00497902, 252.2503235, 77.45779628, 48.33076593],
            [0.00000037, 0.00001906, -0.00594749, 149472.67411175, 0.16047689, -0.12534081]],
  Venus:   [[0.72333566, 0.00677672, 3.39467605, 181.9790995, 131.60246718, 76.67984255],
            [0.0000039, -0.00004107, -0.0007889, 58517.81538729, 0.00268329, -0.27769418]],
  EMBary:  [[1.00000261, 0.01671123, -0.00001531, 100.46457166, 102.93768193, 0],
            [0.00000562, -0.00004392, -0.01294668, 35999.37244981, 0.32327364, 0]],
  Mars:    [[1.52371034, 0.0933941, 1.84969142, -4.55343205, -23.94362959, 49.55953891],
            [0.00001847, 0.00007882, -0.00813131, 19140.30268499, 0.44441088, -0.29257343]],
  Jupiter: [[5.202887, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909],
            [-0.00011607, -0.00013253, -0.00183714, 3034.74612775, 0.21252668, 0.20469106]],
  Saturn:  [[9.53667594, 0.05386179, 2.48599187, 49.95424423, 92.59887831, 113.66242448],
            [-0.0012506, -0.00050991, 0.00193609, 1222.49362201, -0.41897216, -0.28867794]],
  Uranus:  [[19.18916464, 0.04725744, 0.77263783, 313.23810451, 170.9542763, 74.01692503],
            [-0.00196176, -0.00004397, -0.00242939, 428.48202785, 0.40805281, 0.04240589]],
  Neptune: [[30.06992276, 0.00859048, 1.77004347, -55.12002969, 44.96476227, 131.78422574],
            [0.00026291, 0.00005105, 0.00035372, 218.45945325, -0.32241464, -0.00508664]],
};

// Apparent magnitude from distances (AU) and phase angle α (degrees).
const MAGNITUDE: Record<string, (r: number, delta: number, a: number) => number> = {
  Mercury: (r, d, a) => -0.42 + 5 * Math.log10(r * d) + 0.038 * a - 0.000273 * a ** 2 + 0.000002 * a ** 3,
  Venus: (r, d, a) => -4.4 + 5 * Math.log10(r * d) + 0.0009 * a + 0.000239 * a ** 2 - 0.00000065 * a ** 3,
  Mars: (r, d, a) => -1.52 + 5 * Math.log10(r * d) + 0.016 * a,
  Jupiter: (r, d, a) => -9.4 + 5 * Math.log10(r * d) + 0.005 * a,
  Saturn: (r, d, a) => -8.88 + 5 * Math.log10(r * d) + 0.044 * a,
  Uranus: (r, d) => -7.19 + 5 * Math.log10(r * d),
  Neptune: (r, d) => -6.87 + 5 * Math.log10(r * d),
};

const COLORS: Record<string, string> = {
  Mercury: "#d8c8b4", Venus: "#fff6d8", Mars: "#ff9a6b", Jupiter: "#f6e2bd",
  Saturn: "#f0dca4", Uranus: "#b4ecf4", Neptune: "#9fb4ff", Moon: "#f4f1e8",
};

function solveKepler(M: number, e: number): number {
  let E = M + e * Math.sin(M);
  for (let i = 0; i < 8; i++) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
  return E;
}

/** Heliocentric ecliptic J2000 position (AU). */
function heliocentric(name: string, T: number): Vec {
  const [el, rate] = PLANETS[name];
  const [a, e, I, L, peri, node] = el.map((v, i) => v + rate[i] * T);
  const w = (peri - node) * RAD, O = node * RAD, inc = I * RAD;
  const M = ((((L - peri) % 360) + 540) % 360 - 180) * RAD;
  const E = solveKepler(M, e);
  const xp = a * (Math.cos(E) - e), yp = a * Math.sqrt(1 - e * e) * Math.sin(E);
  const cw = Math.cos(w), sw = Math.sin(w), cO = Math.cos(O), sO = Math.sin(O), ci = Math.cos(inc), si = Math.sin(inc);
  return [
    (cw * cO - sw * sO * ci) * xp + (-sw * cO - cw * sO * ci) * yp,
    (cw * sO + sw * cO * ci) * xp + (-sw * sO + cw * cO * ci) * yp,
    sw * si * xp + cw * si * yp,
  ];
}

/** Ecliptic J2000 vector -> RA (hours), Dec (degrees). */
function toEquatorial([x, y, z]: Vec): [number, number] {
  const ye = y * Math.cos(OBLIQUITY) - z * Math.sin(OBLIQUITY);
  const ze = y * Math.sin(OBLIQUITY) + z * Math.cos(OBLIQUITY);
  const ra = Math.atan2(ye, x) / RAD / 15;
  return [(ra + 24) % 24, Math.atan2(ze, Math.hypot(x, ye)) / RAD];
}

const len = (v: Vec) => Math.hypot(...v);
const sub = (p: Vec, q: Vec): Vec => [p[0] - q[0], p[1] - q[1], p[2] - q[2]];
const dot = (p: Vec, q: Vec) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];

/** Geocentric Moon, ecliptic J2000, in Earth radii. */
function moonVector(date: Date): Vec {
  const d = julianDate(date) - 2451543.5;
  const N = (125.1228 - 0.0529538083 * d) * RAD;
  const inc = 5.1454 * RAD;
  const w = (318.0634 + 0.1643573223 * d) * RAD;
  const a = 60.2666, e = 0.0549;
  const M = (115.3654 + 13.0649929509 * d) * RAD;
  const E = solveKepler(M % (2 * Math.PI), e);
  const xv = a * (Math.cos(E) - e), yv = a * Math.sqrt(1 - e * e) * Math.sin(E);
  const v = Math.atan2(yv, xv);
  let r = Math.hypot(xv, yv);
  const xh = r * (Math.cos(N) * Math.cos(v + w) - Math.sin(N) * Math.sin(v + w) * Math.cos(inc));
  const yh = r * (Math.sin(N) * Math.cos(v + w) + Math.cos(N) * Math.sin(v + w) * Math.cos(inc));
  const zh = r * Math.sin(v + w) * Math.sin(inc);
  let lon = Math.atan2(yh, xh) / RAD;
  let lat = Math.atan2(zh, Math.hypot(xh, yh)) / RAD;

  // Largest perturbations (degrees / Earth radii)
  const Ms = (356.047 + 0.9856002585 * d) * RAD;
  const Ls = Ms + (282.9404 + 4.70935e-5 * d) * RAD;
  const Lm = M + w + N;
  const D = Lm - Ls, F = Lm - N;
  const s = Math.sin, c = Math.cos;
  lon += -1.274 * s(M - 2 * D) + 0.658 * s(2 * D) - 0.186 * s(Ms) - 0.059 * s(2 * M - 2 * D)
    - 0.057 * s(M - 2 * D + Ms) + 0.053 * s(M + 2 * D) + 0.046 * s(2 * D - Ms) + 0.041 * s(M - Ms)
    - 0.035 * s(D) - 0.031 * s(M + Ms) - 0.015 * s(2 * F - 2 * D) + 0.011 * s(M - 4 * D);
  lat += -0.173 * s(F - 2 * D) - 0.055 * s(M - F - 2 * D) - 0.046 * s(M + F - 2 * D)
    + 0.033 * s(F + 2 * D) + 0.017 * s(2 * M + F);
  r += -0.58 * c(M - 2 * D) - 0.46 * c(2 * D);

  lon -= 3.82394e-5 * d; // ecliptic of date -> J2000 (precession)
  const L = lon * RAD, B = lat * RAD;
  return [r * Math.cos(B) * Math.cos(L), r * Math.cos(B) * Math.sin(L), r * Math.sin(B)];
}

/** The Sun's position, J2000 RA (hours) / Dec (degrees). */
export function sunPosition(date: Date): { ra: number; dec: number } {
  const earth = heliocentric("EMBary", (julianDate(date) - 2451545) / 36525);
  const [ra, dec] = toEquatorial([-earth[0], -earth[1], -earth[2]]);
  return { ra, dec };
}

export function solarSystem(date: Date): Body[] {
  const T = (julianDate(date) - 2451545) / 36525;
  const earth = heliocentric("EMBary", T);
  const sun: Vec = [-earth[0], -earth[1], -earth[2]];
  const bodies: Body[] = [];

  for (const name of Object.keys(MAGNITUDE)) {
    const helio = heliocentric(name, T);
    const geo = sub(helio, earth);
    const r = len(helio), delta = len(geo), R = len(earth);
    const phase = Math.acos(Math.max(-1, Math.min(1, (r * r + delta * delta - R * R) / (2 * r * delta)))) / RAD;
    const [ra, dec] = toEquatorial(geo);
    bodies.push({ name, kind: "planet", ra, dec, mag: MAGNITUDE[name](r, delta, phase), color: COLORS[name] });
  }

  const moon = moonVector(date);
  const [ra, dec] = toEquatorial(moon);
  const [sunRa, sunDec] = toEquatorial(sun);
  const elongation = Math.acos(dot(moon, sun) / (len(moon) * len(sun)));
  const illuminated = (1 - Math.cos(elongation)) / 2;
  bodies.push({
    name: "Moon", kind: "moon", ra, dec, color: COLORS.Moon,
    mag: -12.7, // full-Moon value; the Moon is drawn by phase, not by magnitude
    illuminated, sunRa, sunDec,
    parallaxDeg: Math.asin(1 / len(moon)) / RAD,
  });
  return bodies;
}
