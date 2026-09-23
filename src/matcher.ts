// Finds a name spelled out in real stars.
//
// 1. For each letter, search for placements of its skeleton where every vertex
//    lands on a star (similarity transform: shift, scale, small tilt, no mirror).
//    Candidates are seeded from star pairs matching the glyph's two farthest
//    vertices, then refit by least squares and scored on fit + brightness.
// 2. Choose one candidate per letter with a beam search that forbids shared
//    stars / overlapping letters and prefers a left-to-right, word-like layout.

import type { SkyStar } from "./astro.ts";
import { GLYPHS, type Glyph } from "./glyphs.ts";

export interface MatchOptions {
  minAlt: number; // ignore stars low on the horizon (haze, buildings)
  minHeight: number; // letter cap height, in chart units (horizon radius = 1)
  maxHeight: number;
  maxTiltDeg: number; // letters stay roughly upright
  tolerance: number; // max vertex miss, as a fraction of letter height
  magLimits: number[]; // widen to fainter stars only when a letter can't be found
  minCandidates: number;
  beamWidth: number;
}

export const DEFAULT_OPTIONS: MatchOptions = {
  minAlt: 15,
  minHeight: 0.1,
  maxHeight: 0.3,
  maxTiltDeg: 25,
  tolerance: 0.1,
  magLimits: [4.5, 5.0, 5.5],
  minCandidates: 25,
  beamWidth: 80,
};

export interface LetterMatch {
  char: string;
  position: number; // index of the letter within the name
  stars: SkyStar[]; // one per glyph vertex
  edges: [number, number][];
  error: number; // rms vertex miss, in letter heights
  meanMag: number;
  height: number;
  tiltDeg: number;
  cx: number;
  cy: number;
  box: [number, number, number, number]; // minX, minY, maxX, maxY
  score: number;
}

export interface NameMatch {
  name: string;
  letters: LetterMatch[];
  missing: { char: string; position: number }[];
  cost: number;
}

// ---------------------------------------------------------------------------

class Grid {
  private cells = new Map<number, SkyStar[]>();
  private size: number;
  constructor(stars: SkyStar[], size: number) {
    this.size = size;
    for (const s of stars) {
      const k = this.key(Math.floor(s.x / size), Math.floor(s.y / size));
      let cell = this.cells.get(k);
      if (!cell) this.cells.set(k, (cell = []));
      cell.push(s);
    }
  }
  private key(ix: number, iy: number) {
    return (ix + 1000) * 4000 + (iy + 1000);
  }
  *near(x: number, y: number, r: number): Generator<SkyStar> {
    const x0 = Math.floor((x - r) / this.size), x1 = Math.floor((x + r) / this.size);
    const y0 = Math.floor((y - r) / this.size), y1 = Math.floor((y + r) / this.size);
    for (let ix = x0; ix <= x1; ix++)
      for (let iy = y0; iy <= y1; iy++) {
        const cell = this.cells.get(this.key(ix, iy));
        if (cell) yield* cell;
      }
  }
}

/** Least-squares similarity transform (no reflection) from template -> stars. */
function fitSimilarity(src: [number, number][], dst: { x: number; y: number }[]) {
  const n = src.length;
  let sx = 0, sy = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) { sx += src[i][0]; sy += src[i][1]; dx += dst[i].x; dy += dst[i].y; }
  sx /= n; sy /= n; dx /= n; dy /= n;
  let a = 0, b = 0, norm = 0;
  for (let i = 0; i < n; i++) {
    const px = src[i][0] - sx, py = src[i][1] - sy;
    const qx = dst[i].x - dx, qy = dst[i].y - dy;
    a += px * qx + py * qy;
    b += px * qy - py * qx;
    norm += px * px + py * py;
  }
  a /= norm; b /= norm; // scale*cos, scale*sin
  const scale = Math.hypot(a, b);
  let sq = 0;
  for (let i = 0; i < n; i++) {
    const px = src[i][0] - sx, py = src[i][1] - sy;
    const ex = dx + a * px - b * py - dst[i].x;
    const ey = dy + b * px + a * py - dst[i].y;
    sq += ex * ex + ey * ey;
  }
  return { scale, angle: Math.atan2(b, a), rms: Math.sqrt(sq / n) / scale };
}

function farthestPair(pts: [number, number][]): [number, number] {
  let best: [number, number] = [0, 1], bestD = -1;
  for (let i = 0; i < pts.length; i++)
    for (let j = i + 1; j < pts.length; j++) {
      const d = Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1]);
      if (d > bestD) { bestD = d; best = [i, j]; }
    }
  return best;
}

function letterCandidates(char: string, glyph: Glyph, stars: SkyStar[], opt: MatchOptions): LetterMatch[] {
  // Template in screen orientation (y down), cap height 1.
  const tpl: [number, number][] = glyph.pts.map(([x, y]) => [x, -y]);
  const [ia, ib] = farthestPair(tpl);
  const tdx = tpl[ib][0] - tpl[ia][0], tdy = tpl[ib][1] - tpl[ia][1];
  const tLen = Math.hypot(tdx, tdy);
  const tAng = Math.atan2(tdy, tdx);
  const maxTilt = (opt.maxTiltDeg * Math.PI) / 180;

  const grid = new Grid(stars, 0.05);
  const seen = new Set<string>();
  const out: LetterMatch[] = [];

  for (const a of stars) {
    for (const b of grid.near(a.x, a.y, opt.maxHeight * tLen)) {
      if (a === b) continue;
      const sdx = b.x - a.x, sdy = b.y - a.y;
      const len = Math.hypot(sdx, sdy);
      const scale = len / tLen;
      if (scale < opt.minHeight || scale > opt.maxHeight) continue;
      let tilt = Math.atan2(sdy, sdx) - tAng;
      tilt = Math.atan2(Math.sin(tilt), Math.cos(tilt));
      if (Math.abs(tilt) > maxTilt) continue;

      const cos = Math.cos(tilt) * scale, sin = Math.sin(tilt) * scale;
      const used: SkyStar[] = new Array(tpl.length);
      used[ia] = a; used[ib] = b;
      const tolAbs = opt.tolerance * scale;
      let ok = true;
      for (let k = 0; k < tpl.length && ok; k++) {
        if (k === ia || k === ib) continue;
        const px = tpl[k][0] - tpl[ia][0], py = tpl[k][1] - tpl[ia][1];
        const qx = a.x + cos * px - sin * py, qy = a.y + sin * px + cos * py;
        let best: SkyStar | undefined, bestD = tolAbs;
        for (const s of grid.near(qx, qy, tolAbs)) {
          const d = Math.hypot(s.x - qx, s.y - qy);
          if (d <= bestD && !used.includes(s)) { best = s; bestD = d; }
        }
        if (best) used[k] = best; else ok = false;
      }
      if (!ok) continue;

      const key = used.map((s) => s.id).join(",");
      if (seen.has(key)) continue;
      seen.add(key);

      const fit = fitSimilarity(tpl, used);
      if (fit.rms > opt.tolerance * 0.75 || Math.abs(fit.angle) > maxTilt) continue;
      const meanMag = used.reduce((m, s) => m + s.mag, 0) / used.length;
      const xs = used.map((s) => s.x), ys = used.map((s) => s.y);
      const box: LetterMatch["box"] = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
      out.push({
        char,
        position: -1,
        stars: used,
        edges: glyph.edges,
        error: fit.rms,
        meanMag,
        height: fit.scale,
        tiltDeg: (fit.angle * 180) / Math.PI,
        cx: (box[0] + box[2]) / 2,
        cy: (box[1] + box[3]) / 2,
        box,
        score: fit.rms / opt.tolerance + 0.35 * Math.max(0, meanMag - 2) + 0.3 * Math.abs(fit.angle / maxTilt),
      });
    }
  }
  return out.sort((p, q) => p.score - q.score).slice(0, 1000);
}

function boxesOverlap(p: LetterMatch["box"], q: LetterMatch["box"], pad: number) {
  return p[0] - pad < q[2] && q[0] - pad < p[2] && p[1] - pad < q[3] && q[1] - pad < p[3];
}

/** Penalty for how a letter sits next to the one before it (word-like layout). */
function layoutCost(prev: LetterMatch, cur: LetterMatch): number {
  const h = (prev.height + cur.height) / 2;
  const dx = (cur.box[0] - prev.box[2]) / h; // gap between letters, in letter heights
  const dy = Math.abs(cur.cy - prev.cy) / h;
  let cost = 0;
  if (dx < -0.2) cost += 3 + Math.min(-dx, 3); // going backwards
  else if (dx > 0.8) cost += (dx - 0.8) * 0.8; // drifting apart
  cost += dy * 0.8;
  cost += Math.abs(Math.log(cur.height / prev.height)) * 1.5;
  return cost;
}

export function normalizeName(name: string): string {
  return name.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
}

export function matchName(rawName: string, sky: SkyStar[], options: Partial<MatchOptions> = {}): NameMatch {
  const opt = { ...DEFAULT_OPTIONS, ...options };
  const name = normalizeName(rawName);
  const high = sky.filter((s) => s.alt >= opt.minAlt);

  // Candidates per letter and magnitude level (level i uses stars up to magLimits[i]).
  const cache = new Map<string, LetterMatch[]>();
  const candidatesFor = (ch: string, level: number) => {
    const key = `${ch}:${level}`;
    if (!cache.has(key)) {
      const pool = high.filter((s) => s.mag <= opt.magLimits[level]);
      cache.set(key, letterCandidates(ch, GLYPHS[ch], pool, opt));
    }
    return cache.get(key)!;
  };

  interface State { picks: LetterMatch[]; used: Set<number>; cost: number; }
  let beam: State[] = [{ picks: [], used: new Set(), cost: 0 }];
  const missing: NameMatch["missing"] = [];

  const extend = (cands: LetterMatch[], position: number): State[] => {
    const next: State[] = [];
    for (const st of beam) {
      const prev = st.picks[st.picks.length - 1];
      for (const c of cands) {
        if (c.stars.some((s) => st.used.has(s.id))) continue;
        if (st.picks.some((p) => boxesOverlap(p.box, c.box, 0.25 * Math.min(p.height, c.height)))) continue;
        const cost = st.cost + c.score + (prev ? layoutCost(prev, c) : 0);
        const used = new Set(st.used);
        c.stars.forEach((s) => used.add(s.id));
        next.push({ picks: [...st.picks, { ...c, position }], used, cost });
      }
    }
    return next.sort((p, q) => p.cost - q.cost).slice(0, opt.beamWidth);
  };

  [...name].forEach((ch, position) => {
    if (!GLYPHS[ch]) return; // spaces, punctuation, unsupported scripts
    // Prefer bright stars; reach for fainter ones only when the letter can't be placed.
    for (let level = 0; level < opt.magLimits.length; level++) {
      const cands = candidatesFor(ch, level);
      if (cands.length < opt.minCandidates && level < opt.magLimits.length - 1) continue;
      const next = extend(cands, position);
      if (next.length) { beam = next; return; }
    }
    missing.push({ char: ch, position });
  });

  return { name: rawName, letters: beam[0].picks, missing, cost: beam[0].cost };
}
