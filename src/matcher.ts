// Finds a name spelled out in real stars, in reading order where possible.
//
// A letter "matches" when every vertex of its skeleton lands on a star under a
// similarity transform (shift, scale, rotation; no mirroring). Placements are
// seeded from star pairs matching the glyph's two farthest vertices, then
// refit by least squares and scored on fit + brightness.
//
// Layout, tried in order:
//  1. "line": written like text. The first letter may face any direction (the
//     chart is rotated afterwards so the word reads horizontally); each next
//     letter is searched for only in the slot right after the previous one:
//     same size, roughly the same baseline, allowed to bend a little.
//  2. "two-lines": the same, wrapped onto two lines (long names).
//  3. "scattered": letters placed anywhere, drawn with numbers so the order
//     is still readable.
// Each step reaches for fainter stars only when brighter ones can't do it.

import type { SkyStar } from "./astro.ts";
import { GLYPHS, type Glyph } from "./glyphs.ts";

export interface MatchOptions {
  minAlt: number; // ignore stars low on the horizon (haze, buildings)
  minHeight: number; // letter cap height, in chart units (horizon radius = 1)
  maxHeight: number;
  tolerance: number; // max vertex miss, as a fraction of letter height
  magLimits: number[]; // widen to fainter stars only when a letter can't be found
  minCandidates: number;
  beamWidth: number;
  letterGap: number; // space between letters, in letter heights
  maxBendDeg: number; // how much the baseline may turn from one letter to the next
  maxTotalBendDeg: number;
  maxWordWidth: number; // chart units a single line may span
  minClearance: number; // letters keep at least this far apart, in letter heights
  slotGap: [number, number]; // how far off the expected spacing a letter may sit, in letter heights
  slotShift: number; // how far above/below the baseline
  slotGrow: number; // max size ratio between neighbouring letters
  minWrapLength: number; // try two lines for names at least this long
  scatterFallback: boolean; // when no ordered layout fits, place letters anywhere
  visibleMag: number; // faintest star the viewer's sky shows; fainter ones are used only when needed
}

export const DEFAULT_OPTIONS: MatchOptions = {
  minAlt: 15,
  minHeight: 0.07,
  maxHeight: 0.3,
  tolerance: 0.1,
  magLimits: [4.5, 5.0, 5.5],
  minCandidates: 25,
  beamWidth: 150,
  letterGap: 0.3,
  maxBendDeg: 12,
  maxTotalBendDeg: 45,
  maxWordWidth: 1.4,
  minClearance: 0.2, // star glows are ~0.15 letter heights wide
  slotGap: [-0.3, 0.6],
  slotShift: 0.3,
  slotGrow: 1.25,
  minWrapLength: 6,
  scatterFallback: true,
  visibleMag: 6,
};

export interface LetterMatch {
  char: string;
  position: number; // index of the letter within the name
  line: number;
  stars: SkyStar[]; // one per glyph vertex
  edges: [number, number][];
  error: number; // rms vertex miss, in letter heights
  meanMag: number;
  height: number;
  angle: number; // radians: direction of the letter's baseline on the chart
  origin: [number, number]; // where the glyph's (0,0) (baseline, left) lands
  cx: number;
  cy: number;
  box: [number, number, number, number]; // minX, minY, maxX, maxY
  hull: [number, number][]; // convex outline of the letter's stars
  score: number;
}

export type Layout = "line" | "two-lines" | "scattered";

export interface NameMatch {
  name: string;
  layout: Layout;
  letters: LetterMatch[];
  missing: { char: string; position: number }[];
  cost: number;
  /** Rotate the chart by -readingAngle to make the name read left to right. */
  readingAngle: number;
}

// ---------------------------------------------------------------------------
// Geometry

const DEG = Math.PI / 180;

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
  /** Stars within distance r of (x, y). (A plain array: this is the hottest loop.) */
  near(x: number, y: number, r: number): SkyStar[] {
    const out: SkyStar[] = [];
    const r2 = r * r;
    const x0 = Math.floor((x - r) / this.size), x1 = Math.floor((x + r) / this.size);
    const y0 = Math.floor((y - r) / this.size), y1 = Math.floor((y + r) / this.size);
    for (let ix = x0; ix <= x1; ix++)
      for (let iy = y0; iy <= y1; iy++) {
        const cell = this.cells.get(this.key(ix, iy));
        if (!cell) continue;
        for (const s of cell) {
          const dx = s.x - x, dy = s.y - y;
          if (dx * dx + dy * dy <= r2) out.push(s);
        }
      }
    return out;
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
  let sq = 0;
  for (let i = 0; i < n; i++) {
    const px = src[i][0] - sx, py = src[i][1] - sy;
    const ex = dx + a * px - b * py - dst[i].x;
    const ey = dy + b * px + a * py - dst[i].y;
    sq += ex * ex + ey * ey;
  }
  const scale = Math.hypot(a, b);
  return {
    scale,
    angle: Math.atan2(b, a),
    rms: Math.sqrt(sq / n) / scale,
    origin: [dx - (a * sx - b * sy), dy - (b * sx + a * sy)] as [number, number],
  };
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

const wrapAngle = (a: number) => a - 2 * Math.PI * Math.round(a / (2 * Math.PI));

type Pt = [number, number];

/** Convex hull (monotone chain), counter-clockwise in math orientation. */
function convexHull(points: Pt[]): Pt[] {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: Pt, a: Pt, b: Pt) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (list: Pt[]) => {
    const h: Pt[] = [];
    for (const p of list) {
      while (h.length >= 2 && cross(h[h.length - 2], h[h.length - 1], p) <= 0) h.pop();
      h.push(p);
    }
    h.pop();
    return h;
  };
  return [...half(pts), ...half([...pts].reverse())];
}

/**
 * True if two letters come closer than `gap` (chart units): their outlines,
 * grown by `gap`, touch. Separating-axis test on the convex hulls.
 */
export function lettersOverlap(a: LetterMatch, b: LetterMatch, gap: number): boolean {
  const axes: Pt[] = [];
  for (const hull of [a.hull, b.hull]) {
    for (let i = 0; i < hull.length; i++) {
      const p = hull[i], q = hull[(i + 1) % hull.length];
      axes.push([q[1] - p[1], p[0] - q[0]]); // edge normal
    }
    if (hull.length === 2) axes.push([hull[1][0] - hull[0][0], hull[1][1] - hull[0][1]]);
  }
  for (const [ax, ay] of axes) {
    const len = Math.hypot(ax, ay);
    if (len === 0) continue;
    const proj = (h: Pt[]) => h.map(([x, y]) => (x * ax + y * ay) / len);
    const pa = proj(a.hull), pb = proj(b.hull);
    if (Math.min(...pb) - Math.max(...pa) > gap || Math.min(...pa) - Math.max(...pb) > gap) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Matching one letter

interface Template {
  char: string;
  glyph: Glyph;
  pts: [number, number][]; // screen orientation (y down), cap height 1
  ia: number; // anchor vertices: the farthest pair
  ib: number;
  width: number;
}

function template(char: string): Template {
  const glyph = GLYPHS[char];
  const pts: [number, number][] = glyph.pts.map(([x, y]) => [x, -y]);
  const [ia, ib] = farthestPair(pts);
  return { char, glyph, pts, ia, ib, width: Math.max(...glyph.pts.map(([x]) => x)) };
}

/** Pool of stars at one brightness level, with a spatial index. */
interface Pool {
  stars: SkyStar[];
  grid: Grid;
}

function makePool(stars: SkyStar[]): Pool {
  return { stars, grid: new Grid(stars, 0.04) };
}

/**
 * Given stars for the two anchor vertices, find stars for the rest.
 * `accept` sees the implied transform before the (costlier) vertex search.
 */
function complete(
  t: Template, a: SkyStar, b: SkyStar, pool: Pool, opt: MatchOptions,
  accept: (scale: number, angle: number) => boolean,
): LetterMatch | null {
  // Transform = (star vector) / (template vector) as complex numbers: scale·cos + i·scale·sin.
  const tdx = t.pts[t.ib][0] - t.pts[t.ia][0], tdy = t.pts[t.ib][1] - t.pts[t.ia][1];
  const vx = b.x - a.x, vy = b.y - a.y;
  const tl2 = tdx * tdx + tdy * tdy;
  const cos = (vx * tdx + vy * tdy) / tl2, sin = (vy * tdx - vx * tdy) / tl2;
  const scale = Math.hypot(cos, sin);
  if (scale < opt.minHeight || scale > opt.maxHeight || !accept(scale, Math.atan2(sin, cos))) return null;

  const used: SkyStar[] = new Array(t.pts.length);
  used[t.ia] = a;
  used[t.ib] = b;
  const tol = opt.tolerance * scale;
  for (let k = 0; k < t.pts.length; k++) {
    if (k === t.ia || k === t.ib) continue;
    const px = t.pts[k][0] - t.pts[t.ia][0], py = t.pts[k][1] - t.pts[t.ia][1];
    const qx = a.x + cos * px - sin * py, qy = a.y + sin * px + cos * py;
    let best: SkyStar | undefined, bestD = tol;
    for (const s of pool.grid.near(qx, qy, tol)) {
      const d = Math.hypot(s.x - qx, s.y - qy);
      if (d <= bestD && !used.includes(s)) { best = s; bestD = d; }
    }
    if (!best) return null;
    used[k] = best;
  }

  const fit = fitSimilarity(t.pts, used);
  if (fit.rms > opt.tolerance * 0.75) return null;
  const meanMag = used.reduce((m, s) => m + s.mag, 0) / used.length;
  const xs = used.map((s) => s.x), ys = used.map((s) => s.y);
  const box: LetterMatch["box"] = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  return {
    char: t.char, position: -1, line: 0,
    stars: used, edges: t.glyph.edges,
    error: fit.rms, meanMag,
    height: fit.scale, angle: fit.angle, origin: fit.origin,
    cx: (box[0] + box[2]) / 2, cy: (box[1] + box[3]) / 2, box,
    hull: convexHull(used.map((s) => [s.x, s.y])),
    score: fit.rms / opt.tolerance + 0.35 * Math.max(0, meanMag - 2)
      + 1.5 * used.filter((s) => s.mag > opt.visibleMag).length / used.length, // stars this sky hides
  };
}

/** Every placement of a letter anywhere in the sky (within size/tilt limits). */
function searchAnywhere(t: Template, pool: Pool, opt: MatchOptions, maxTilt: number, maxHeight: number): LetterMatch[] {
  const tLen = Math.hypot(t.pts[t.ib][0] - t.pts[t.ia][0], t.pts[t.ib][1] - t.pts[t.ia][1]);
  const lim = { ...opt, maxHeight };
  const minLen2 = (opt.minHeight * tLen) ** 2;
  const seen = new Set<string>();
  const out: LetterMatch[] = [];
  for (const a of pool.stars) {
    for (const b of pool.grid.near(a.x, a.y, maxHeight * tLen)) {
      const dx = b.x - a.x, dy = b.y - a.y;
      if (dx * dx + dy * dy < minLen2) continue; // also skips a === b
      const m = complete(t, a, b, pool, lim, (_, angle) => Math.abs(angle) <= maxTilt);
      if (!m) continue;
      const key = m.stars.map((s) => s.id).join(",");
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(m);
    }
  }
  return out.sort((p, q) => p.score - q.score).slice(0, 1000);
}

/** Where the next letter is expected: its origin, size and direction. */
interface Slot {
  origin: [number, number];
  height: number;
  angle: number;
  looseness: number; // scales the allowed offset (a new line may start further from its guess)
}

/** Placements of a letter close to an expected slot, with the cost of deviating from it. */
function searchSlot(t: Template, slot: Slot, pool: Pool, opt: MatchOptions): { m: LetterMatch; dev: number }[] {
  const { origin, height: h, angle } = slot;
  const cos = Math.cos(angle), sin = Math.sin(angle);
  const at = (p: [number, number]) => [origin[0] + h * (cos * p[0] - sin * p[1]), origin[1] + h * (sin * p[0] + cos * p[1])];
  const [ax, ay] = at(t.pts[t.ia]);
  const [bx, by] = at(t.pts[t.ib]);
  const k = slot.looseness;
  const r = (0.3 + k * Math.max(opt.slotGap[1], opt.slotShift)) * h;
  const maxBend = opt.maxBendDeg * DEG;

  const out: { m: LetterMatch; dev: number }[] = [];
  const nearB = pool.grid.near(bx, by, r);
  for (const a of pool.grid.near(ax, ay, r)) {
    for (const b of nearB) {
      if (a === b) continue;
      const m = complete(t, a, b, pool, opt, (scale, ang) =>
        Math.abs(Math.log(scale / h)) <= Math.log(opt.slotGrow * 1.05) && Math.abs(wrapAngle(ang - angle)) <= maxBend * 1.3);
      if (!m) continue;
      // Deviation measured in the slot's own frame, in letter heights.
      const vx = m.origin[0] - origin[0], vy = m.origin[1] - origin[1];
      const along = (vx * cos + vy * sin) / h / k;
      const perp = (-vx * sin + vy * cos) / h / k;
      const bend = wrapAngle(m.angle - angle);
      const grow = Math.log(m.height / h);
      if (along < opt.slotGap[0] || along > opt.slotGap[1] || Math.abs(perp) > opt.slotShift) continue;
      if (Math.abs(bend) > maxBend || Math.abs(grow) > Math.log(opt.slotGrow)) continue;
      const dev = 2 * along * along + 6 * perp * perp + 8 * grow * grow + 0.6 * (bend / maxBend) ** 2;
      out.push({ m, dev });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Layouts

// Letters that don't come apart into A–Z + accent marks.
const SPECIAL: Record<string, string> = { ß: "SS", ẞ: "SS", Æ: "AE", Œ: "OE", Ø: "O", Ł: "L", Đ: "D", Þ: "TH", Ð: "D", Ħ: "H" };

// Name punctuation: hyphens and dots separate parts like a space; apostrophes just drop out.
const WORD_BREAK = /[\s\-‐–.]/;
const SILENT = /['’`]/;

/** Upper-case A–Z form: accents dropped (É → E), special letters spelled out (ß → SS). */
export function normalizeName(name: string): string {
  return [...name.toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")].map((ch) => SPECIAL[ch] ?? ch).join("");
}

/** Characters in a name that can't be drawn (beyond A–Z and name punctuation), each listed once. */
export function unsupportedChars(name: string): string[] {
  return [...new Set([...normalizeName(name)].filter((ch) => !GLYPHS[ch] && !WORD_BREAK.test(ch) && !SILENT.test(ch)))];
}

interface Entry {
  t: Template;
  position: number;
  space: boolean; // a word break comes before this letter
}

const WORD_SPACE = 0.6; // extra room at a space, in letter heights

/** Width of a line of letters, in letter heights. */
function lineWidth(l: Entry[], opt: MatchOptions): number {
  return l.reduce((w, e, i) => w + e.t.width + (i > 0 && e.space ? WORD_SPACE : 0), 0) + opt.letterGap * (l.length - 1);
}

interface State {
  picks: LetterMatch[];
  used: Set<number>;
  cost: number;
  bend: number; // accumulated turn of the baseline
}

/** Next slot for letter `i` of a layout, from what has been placed so far. */
function nextSlot(st: State, lines: Entry[][], line: number, idx: number, opt: MatchOptions): Slot {
  const prev = st.picks[st.picks.length - 1];
  const cos = Math.cos(prev.angle), sin = Math.sin(prev.angle);
  if (idx > 0) {
    const adv = prev.height * (lines[line][idx - 1].t.width + opt.letterGap + (lines[line][idx].space ? WORD_SPACE : 0));
    return { origin: [prev.origin[0] + cos * adv, prev.origin[1] + sin * adv], height: prev.height, angle: prev.angle, looseness: 1 };
  }
  // First letter of a new line: below the previous line's first letter, centred under it.
  const first = st.picks.find((p) => p.line === line - 1)!;
  const width = (l: Entry[]) => lineWidth(l, opt);
  const h = first.height, fc = Math.cos(first.angle), fs = Math.sin(first.angle);
  const shift = ((width(lines[line - 1]) - width(lines[line])) / 2) * h;
  const down = 1.6 * h;
  return {
    origin: [first.origin[0] + fc * shift - fs * down, first.origin[1] + fs * shift + fc * down],
    height: h,
    angle: first.angle,
    looseness: 3,
  };
}

function writeLines(lines: Entry[][], pools: Pool[], opt: MatchOptions): State | null {
  const all = lines.flat();
  const widthInHeights = Math.max(...lines.map((l) => lineWidth(l, opt)));
  const maxHeight = Math.min(opt.maxHeight, opt.maxWordWidth / widthInHeights);
  if (maxHeight < opt.minHeight) return null;

  let beam: State[] = [];
  // First letter: anywhere, facing any direction.
  for (let level = 0; level < pools.length && beam.length === 0; level++) {
    const cands = searchAnywhere(all[0].t, pools[level], opt, Math.PI, maxHeight);
    if (cands.length < opt.minCandidates && level < pools.length - 1) continue;
    beam = cands.slice(0, opt.beamWidth * 2).map((m) => ({
      picks: [{ ...m, position: all[0].position, line: 0 }],
      used: new Set(m.stars.map((s) => s.id)),
      cost: m.score,
      bend: 0,
    }));
  }

  const maxTotal = opt.maxTotalBendDeg * DEG;
  let line = 0, idx = 0;
  for (const entry of all.slice(1)) {
    if (++idx >= lines[line].length) { line++; idx = 0; }
    let next: State[] = [];
    for (let level = 0; level < pools.length && next.length === 0; level++) {
      for (const st of beam) {
        const slot = nextSlot(st, lines, line, idx, opt);
        for (const { m, dev } of searchSlot(entry.t, slot, pools[level], opt)) {
          if (m.stars.some((s) => st.used.has(s.id))) continue;
          if (st.picks.some((p) => lettersOverlap(p, m, opt.minClearance * Math.min(p.height, m.height)))) continue;
          const bend = idx > 0 ? st.bend + wrapAngle(m.angle - slot.angle) : st.bend;
          if (Math.abs(bend) > maxTotal) continue;
          const used = new Set(st.used);
          m.stars.forEach((s) => used.add(s.id));
          next.push({ picks: [...st.picks, { ...m, position: entry.position, line }], used, cost: st.cost + m.score + dev, bend });
        }
      }
    }
    if (next.length === 0) return null;
    // Keep the beam diverse: at most a few states per first-letter placement.
    next.sort((p, q) => p.cost - q.cost);
    const perRoot = new Map<string, number>();
    beam = [];
    for (const st of next) {
      const root = st.picks[0].stars.map((s) => s.id).join(",");
      const n = perRoot.get(root) ?? 0;
      if (n >= 4) continue;
      perRoot.set(root, n + 1);
      beam.push(st);
      if (beam.length >= opt.beamWidth) break;
    }
  }
  return beam[0] ?? null;
}

/** Fallback: each letter wherever it fits best (order shown by numbering instead). */
function scatter(entries: Entry[], pools: Pool[], opt: MatchOptions): { state: State; missing: NameMatch["missing"] } {
  const cache = new Map<string, LetterMatch[]>();
  const candidates = (t: Template, level: number) => {
    const key = `${t.char}:${level}`;
    if (!cache.has(key)) cache.set(key, searchAnywhere(t, pools[level], opt, 25 * DEG, opt.maxHeight));
    return cache.get(key)!;
  };
  let beam: State[] = [{ picks: [], used: new Set(), cost: 0, bend: 0 }];
  const missing: NameMatch["missing"] = [];
  for (const { t, position } of entries) {
    let placed = false;
    for (let level = 0; level < pools.length && !placed; level++) {
      const cands = candidates(t, level);
      if (cands.length < opt.minCandidates && level < pools.length - 1) continue;
      const next: State[] = [];
      for (const st of beam)
        for (const c of cands) {
          if (c.stars.some((s) => st.used.has(s.id))) continue;
          // Scattered letters get extra room so they read as separate shapes.
          if (st.picks.some((p) => lettersOverlap(p, c, 2 * opt.minClearance * Math.min(p.height, c.height)))) continue;
          const used = new Set(st.used);
          c.stars.forEach((s) => used.add(s.id));
          next.push({ picks: [...st.picks, { ...c, position }], used, cost: st.cost + c.score, bend: 0 });
        }
      if (next.length) {
        beam = next.sort((p, q) => p.cost - q.cost).slice(0, opt.beamWidth);
        placed = true;
      }
    }
    if (!placed) missing.push({ char: t.char, position });
  }
  return { state: beam[0], missing };
}

/** Direction the text runs: along the first line, first letter to the end of the last. */
function readingAngle(letters: LetterMatch[]): number {
  const first = letters[0];
  const onLine = letters.filter((l) => l.line === 0);
  const last = onLine[onLine.length - 1];
  if (last === first) return first.angle;
  const w = Math.max(...GLYPHS[last.char].pts.map(([x]) => x)) * last.height;
  const ex = last.origin[0] + Math.cos(last.angle) * w, ey = last.origin[1] + Math.sin(last.angle) * w;
  return Math.atan2(ey - first.origin[1], ex - first.origin[0]);
}

export function matchName(rawName: string, sky: SkyStar[], options: Partial<MatchOptions> = {}): NameMatch {
  const opt = { ...DEFAULT_OPTIONS, ...options };
  const chars = [...normalizeName(rawName)];
  const entries: Entry[] = [];
  let pendingSpace = false;
  chars.forEach((ch, position) => {
    if (WORD_BREAK.test(ch)) pendingSpace = entries.length > 0;
    if (!GLYPHS[ch]) return; // spaces, punctuation, unsupported scripts
    entries.push({ t: template(ch), position, space: pendingSpace });
    pendingSpace = false;
  });
  const empty: NameMatch = { name: rawName, layout: "line", letters: [], missing: [], cost: 0, readingAngle: 0 };
  if (entries.length === 0) return empty;

  const high = sky.filter((s) => s.alt >= opt.minAlt);
  const pools = opt.magLimits.map((limit) => makePool(high.filter((s) => s.mag <= limit)));

  const perLetter = (s: State) => s.cost / s.picks.length;
  let best: { state: State; layout: Layout } | null = null;

  const one = writeLines([entries], pools, opt);
  if (one) best = { state: one, layout: "line" };
  if (entries.length >= opt.minWrapLength) {
    // Break at the space nearest the middle if there is one ("Mary Ann"), else halfway.
    const spaces = entries.map((e, i) => (e.space ? i : -1)).filter((i) => i > 0);
    const split = spaces.length
      ? spaces.reduce((a, b) => (Math.abs(b - entries.length / 2) < Math.abs(a - entries.length / 2) ? b : a))
      : Math.ceil(entries.length / 2);
    const two = writeLines([entries.slice(0, split), entries.slice(split)], pools, opt);
    // One line reads best; wrap only when it is clearly better.
    if (two && (!one || perLetter(two) + 0.5 < perLetter(one))) best = { state: two, layout: "two-lines" };
  }

  if (best) {
    const letters = best.state.picks;
    return { name: rawName, layout: best.layout, letters, missing: [], cost: best.state.cost, readingAngle: readingAngle(letters) };
  }
  if (!opt.scatterFallback) {
    return { ...empty, layout: "scattered", missing: entries.map(({ t, position }) => ({ char: t.char, position })) };
  }
  const { state, missing } = scatter(entries, pools, opt);
  return { name: rawName, layout: "scattered", letters: state.picks, missing, cost: state.cost, readingAngle: 0 };
}
