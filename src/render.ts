// Draws the sky chart onto a 2D canvas: in the browser, or on the server
// (link previews, posters). Colours come from a theme.

import type { SkyBody, SkyStar } from "./astro.ts";
import type { NameMatch } from "./matcher.ts";

type Rgb = [number, number, number];

export interface Palette {
  dome: [Rgb, Rgb, Rgb]; // centre, middle, horizon
  day?: [Rgb, Rgb, Rgb]; // if set, the dome brightens through twilight into this
  domeEdge: string;
  compass: string;
  star: (ci: number) => string;
  planet?: string; // one colour for all planets (else each planet's own)
  planetRing: string;
  label: string;
  moonDark: string;
  moonLit: string;
  moonGlow: string; // "r, g, b"
  moonOutline?: string;
  letterStroke: string;
  letterWidth?: number; // stroke weight multiplier: print themes have no glow, so they draw bolder
  letterShadow?: string;
  letterStar: string;
  letterHalo?: [string, string];
  hiddenRing: string;
  order: string; // numbers and thread for scattered letters
  fontSans: string;
}

/** Rough B-V color index -> star color. */
function starColor(ci: number): string {
  const t = Math.max(-0.4, Math.min(2, ci));
  if (t < 0) return "#aabfff";
  if (t < 0.3) return "#cad7ff";
  if (t < 0.6) return "#f8f7ff";
  if (t < 0.8) return "#fff4ea";
  if (t < 1.4) return "#ffd2a1";
  return "#ffb56c";
}

export const PALETTES = {
  /** The site's look: night blue, gold letters. */
  midnight: {
    dome: [[11, 20, 51], [8, 16, 41], [18, 25, 58]],
    day: [[92, 150, 222], [110, 165, 230], [170, 205, 240]],
    domeEdge: "rgba(160, 180, 255, 0.25)",
    compass: "rgba(190, 200, 240, 0.6)",
    star: starColor,
    planetRing: "rgba(255, 255, 255, 0.35)",
    label: "rgba(200, 210, 240, 0.75)",
    moonDark: "#3a3f52",
    moonLit: "#f4f1e8",
    moonGlow: "240, 236, 220",
    letterStroke: "rgba(255, 214, 140, 0.85)",
    letterShadow: "rgba(255, 200, 110, 0.9)",
    letterStar: "#fffaf0",
    letterHalo: ["rgba(255, 240, 210, 0.9)", "rgba(255, 220, 160, 0)"],
    hiddenRing: "rgba(255, 230, 190, 0.8)",
    order: "rgba(255, 214, 140, 0.9)",
    fontSans: "system-ui, sans-serif",
  },
  /** Cream paper, dark ink stars, amber letters: prints well. */
  paper: {
    dome: [[241, 232, 214], [235, 224, 201], [226, 212, 184]],
    domeEdge: "rgba(90, 70, 40, 0.35)",
    compass: "rgba(80, 60, 35, 0.7)",
    star: () => "#2b2f45",
    planet: "#2b2f45",
    planetRing: "rgba(40, 30, 20, 0.35)",
    label: "rgba(60, 50, 35, 0.85)",
    moonDark: "#e3d6bb",
    moonLit: "#fbf6ea",
    moonGlow: "160, 130, 80",
    moonOutline: "#6b5d43",
    letterStroke: "#a8641c",
    letterWidth: 1.5,
    letterStar: "#1f2436",
    letterHalo: ["rgba(168, 100, 28, 0.35)", "rgba(168, 100, 28, 0)"],
    hiddenRing: "rgba(120, 80, 30, 0.8)",
    order: "#a8641c",
    fontSans: "system-ui, sans-serif",
  },
  /** Black on white, no glow: line-art. */
  ink: {
    dome: [[255, 255, 255], [255, 255, 255], [255, 255, 255]],
    domeEdge: "#111111",
    compass: "#333333",
    star: () => "#111111",
    planet: "#111111",
    planetRing: "#111111",
    label: "#333333",
    moonDark: "#ffffff",
    moonLit: "#111111",
    moonGlow: "0, 0, 0",
    moonOutline: "#111111",
    letterStroke: "#111111",
    letterWidth: 2.2,
    letterStar: "#111111",
    hiddenRing: "#555555",
    order: "#111111",
    fontSans: "system-ui, sans-serif",
  },
} satisfies Record<string, Palette>;

export type ThemeName = keyof typeof PALETTES;
export const isThemeName = (v: unknown): v is ThemeName => typeof v === "string" && v in PALETTES;

function starRadius(mag: number): number {
  return Math.max(0.45, 3.4 - 0.55 * mag);
}

/** Moon disk with its real phase; `litAngle` points toward the Sun. */
function drawMoon(ctx: CanvasRenderingContext2D, p: Palette, x: number, y: number, r: number, lit: number, litAngle: number) {
  const glow = ctx.createRadialGradient(x, y, r * 0.8, x, y, r * 3.5);
  glow.addColorStop(0, `rgba(${p.moonGlow}, ${0.08 + 0.22 * lit})`);
  glow.addColorStop(1, `rgba(${p.moonGlow}, 0)`);
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(x, y, r * 3.5, 0, Math.PI * 2);
  ctx.fill();

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(litAngle);
  ctx.fillStyle = p.moonDark;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  // Lit limb on the Sun side (+x), closed off by the terminator ellipse.
  ctx.fillStyle = p.moonLit;
  ctx.beginPath();
  ctx.arc(0, 0, r, -Math.PI / 2, Math.PI / 2);
  const rx = r * Math.abs(2 * lit - 1);
  if (lit >= 0.5) ctx.ellipse(0, 0, rx, r, 0, Math.PI / 2, (3 * Math.PI) / 2, false);
  else ctx.ellipse(0, 0, rx, r, 0, Math.PI / 2, -Math.PI / 2, true);
  ctx.fill();
  if (p.moonOutline) {
    ctx.strokeStyle = p.moonOutline;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

export interface RenderState {
  sky: SkyStar[];
  bodies: SkyBody[];
  match: NameMatch | null;
  progress: number; // 0..1, animates the letter strokes
  sunAlt: number; // degrees: sets daylight / twilight / night
  limitMag: number; // faintest star the viewer can see (light pollution, twilight)
  focusLetter?: number | null; // index into match.letters: that letter stands out, the rest fade
  selected?: { x: number; y: number } | null; // chart position of the object whose card is open
}

/**
 * Where things land on a chart of `size` px, turned so the name reads left to
 * right. Drawing and tapping both use this, so a tap finds what was drawn there.
 */
export function chartGeometry(size: number, match: NameMatch | null) {
  const rot = -(match?.readingAngle ?? 0);
  const rc = Math.cos(rot), rs = Math.sin(rot);
  const R = size / 2 - 22 * Math.max(1, size / 640);
  const cx = size / 2, cy = size / 2;
  const px = (s: { x: number; y: number }) => [cx + (s.x * rc - s.y * rs) * R, cy + (s.x * rs + s.y * rc) * R] as const;
  return { rot, R, cx, cy, px, k: size / 640 };
}

const mix = (a: Rgb, b: Rgb | undefined, t: number) =>
  `rgb(${a.map((v, i) => Math.round(v + ((b ?? a)[i] - v) * t)).join(",")})`;

/** 0 at full night (Sun 18° down) … 1 in daylight. */
const daylight = (sunAlt: number) => Math.min(1, Math.max(0, (sunAlt + 18) / 18)) ** 2;

export interface RenderTarget {
  size?: number; // chart size in CSS px / points (default: the canvas's CSS width)
  pixelRatio?: number;
  ctx?: CanvasRenderingContext2D; // draw into this context instead (images, posters)
  origin?: [number, number]; // chart's top-left within `ctx`
  palette?: Palette;
}

/**
 * Draw the sky chart. On screen it fills the canvas's CSS width. For images
 * and posters, pass `ctx` + `size` + `origin`; `canvas` may then be null.
 */
export function renderSky(canvas: HTMLCanvasElement | null, state: RenderState, out: RenderTarget = {}) {
  const { sky, bodies, match, progress, sunAlt, limitMag, focusLetter, selected } = state;
  const p: Palette = out.palette ?? PALETTES.midnight;
  const size = out.size ?? canvas!.clientWidth;
  // Turn the chart so the name reads left to right (the sky has no "up").
  const { rot, R, cx, cy, px, k } = chartGeometry(size, match);
  let ctx: CanvasRenderingContext2D;
  if (out.ctx) {
    ctx = out.ctx;
    ctx.save();
    ctx.translate(...(out.origin ?? [0, 0]));
  } else {
    const dpr = out.pixelRatio ?? (window.devicePixelRatio || 1);
    if (canvas!.width !== size * dpr) {
      canvas!.width = size * dpr;
      canvas!.height = size * dpr;
    }
    ctx = canvas!.getContext("2d")!;
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);
  }
  // Only a theme with a daytime colour shows daylight; print themes always look like night.
  const day = p.day ? daylight(sunAlt) : 0;

  const line = Math.max(1, k); // line widths and text grow on big outputs, never shrink below 1

  // Sky dome: night, brightening through twilight into day
  const bg = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
  bg.addColorStop(0, mix(p.dome[0], p.day?.[0], day));
  bg.addColorStop(0.75, mix(p.dome[1], p.day?.[1], day));
  bg.addColorStop(1, mix(p.dome[2], p.day?.[2], day));
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = p.domeEdge;
  ctx.lineWidth = line;
  ctx.stroke();

  ctx.fillStyle = p.compass;
  ctx.font = `${Math.round(12 * line)}px ${p.fontSans}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const edge = (R + 11 * line) / R;
  for (const [label, x, y] of [["N", 0, -1], ["S", 0, 1], ["E", -1, 0], ["W", 1, 0]] as const) {
    const [lx, ly] = px({ x: x * edge, y: y * edge });
    ctx.fillText(label, lx, ly);
  }

  // Stars (faintest first so bright ones sit on top)
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.clip();
  for (let i = sky.length - 1; i >= 0; i--) {
    const s = sky[i];
    // Stars the viewer's sky hides stay as a faint hint (none at all in daylight).
    const hidden = s.mag > limitMag;
    if (hidden && day > 0.6) continue;
    const [x, y] = px(s);
    ctx.globalAlpha = Math.min(1, 0.35 + (6 - s.mag) * 0.14) * (s.alt < 10 ? 0.4 + s.alt * 0.06 : 1) * (hidden ? 0.18 : 1);
    ctx.fillStyle = p.star(s.ci);
    ctx.beginPath();
    ctx.arc(x, y, starRadius(s.mag) * k, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // Moon and planets, labelled so they can be told apart from stars.
  // A label moves around its dot to stay off the letters, or is left out.
  const letterPts = (match?.letters ?? []).flatMap((l) => l.stars.map(px));
  const labelFont = Math.round(11 * line);
  ctx.font = `${labelFont}px ${p.fontSans}`;
  const labelSpot = (x: number, y: number, r: number, text: string): [number, number, CanvasTextAlign] | null => {
    const w = ctx.measureText(text).width, h = labelFont, pad = 10 * k, gap = r + 5 * k;
    const spots: [number, number, CanvasTextAlign][] = [
      [x + gap, y, "left"], [x - gap, y, "right"], [x, y - gap - h / 2, "center"], [x, y + gap + h / 2, "center"],
    ];
    return spots.find(([lx, ly, align]) => {
      const left = align === "left" ? lx : align === "right" ? lx - w : lx - w / 2;
      if (left < 2 || left + w > size - 2 || ly - h / 2 < 2 || ly + h / 2 > size - 2) return false; // off the canvas
      return !letterPts.some(([px_, py_]) => px_ > left - pad && px_ < left + w + pad && py_ > ly - h / 2 - pad && py_ < ly + h / 2 + pad);
    }) ?? null;
  };
  for (const b of bodies) {
    // Planets follow the same rule as stars: too faint for this sky means a faint hint, or nothing by day.
    const hiddenPlanet = b.kind === "planet" && b.mag > limitMag;
    if (hiddenPlanet && day > 0.6) continue;
    ctx.globalAlpha = hiddenPlanet ? 0.25 : 1;
    const [x, y] = px(b);
    let r: number;
    if (b.kind === "sun") {
      r = 13 * k;
      const glow = ctx.createRadialGradient(x, y, r * 0.5, x, y, r * 5);
      glow.addColorStop(0, "rgba(255, 250, 225, 0.9)");
      glow.addColorStop(1, "rgba(255, 250, 225, 0)");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(x, y, r * 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = b.color;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    } else if (b.kind === "moon") {
      r = 11 * k;
      drawMoon(ctx, p, x, y, r, b.illuminated ?? 1, (b.litAngle ?? 0) + rot);
    } else {
      r = Math.max(2.2, starRadius(b.mag)) * k;
      ctx.fillStyle = p.planet ?? b.color;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = p.planetRing;
      ctx.lineWidth = line;
      ctx.beginPath();
      ctx.arc(x, y, r + 3 * k, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    // The Sun needs no label (and one would vanish in its glare); hidden planets aren't named.
    const spot = b.kind === "sun" || hiddenPlanet ? null : labelSpot(x, y, r, b.name);
    if (spot) {
      ctx.fillStyle = p.label;
      ctx.textAlign = spot[2];
      ctx.fillText(b.name, spot[0], spot[1]);
    }
  }
  ctx.restore();

  const drawSelection = () => {
    if (!selected) return;
    const [x, y] = px(selected);
    ctx.save();
    ctx.strokeStyle = p.order;
    ctx.lineWidth = 1.5 * line;
    ctx.beginPath();
    ctx.arc(x, y, 11 * Math.max(k, 0.8), 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  };

  if (!match) {
    drawSelection();
    ctx.restore();
    return;
  }

  // Scattered letters: a faint thread and numbers carry the reading order.
  if (match.layout === "scattered" && match.letters.length > 1) {
    const centre = (l: (typeof match.letters)[number]) => px({ x: l.cx, y: l.cy });
    ctx.save();
    ctx.globalAlpha = Math.min(1, progress * 1.5);
    ctx.strokeStyle = p.order;
    ctx.globalAlpha *= 0.35;
    ctx.setLineDash([2 * k, 6 * k]);
    ctx.lineWidth = line;
    ctx.beginPath();
    match.letters.forEach((l, i) => (i ? ctx.lineTo : ctx.moveTo).call(ctx, ...centre(l)));
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = Math.min(1, progress * 1.5);
    ctx.fillStyle = p.order;
    ctx.font = `600 ${Math.round(12 * line)}px ${p.fontSans}`;
    ctx.textAlign = "center";
    match.letters.forEach((l, i) => {
      // Put the number just above the letter, as the chart is shown.
      const pts = l.stars.map(px);
      const top = Math.min(...pts.map(([, y]) => y));
      const mid = pts.reduce((m, [x]) => m + x, 0) / pts.length;
      ctx.fillText(String(i + 1), mid, top - 12 * k);
    });
    ctx.restore();
  }

  // Letters: strokes draw in one after another
  const n = match.letters.length;
  const focusing = focusLetter !== null && focusLetter !== undefined;
  match.letters.forEach((l, i) => {
    const local = Math.max(0, Math.min(1, progress * n - i));
    if (local <= 0) return;
    // Exploring one letter: it stands out, the others fade back.
    const fade = focusing && i !== focusLetter ? 0.22 : 1;
    const bold = focusing && i === focusLetter ? 1.5 : 1;
    ctx.save();
    ctx.globalAlpha = fade;
    ctx.strokeStyle = p.letterStroke;
    ctx.lineWidth = 1.6 * line * (p.letterWidth ?? 1) * bold;
    ctx.lineCap = "round";
    if (p.letterShadow) {
      ctx.shadowColor = p.letterShadow;
      ctx.shadowBlur = 8 * line;
    }
    const edges = l.edges;
    const shown = local * edges.length;
    edges.forEach(([a, b], e) => {
      const f = Math.max(0, Math.min(1, shown - e));
      if (f <= 0) return;
      const [x1, y1] = px(l.stars[a]);
      const [x2, y2] = px(l.stars[b]);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x1 + (x2 - x1) * f, y1 + (y2 - y1) * f);
      ctx.stroke();
    });
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = local * fade;
    for (const s of l.stars) {
      const [x, y] = px(s);
      if (s.mag > limitMag) {
        // Too faint for this sky: a hollow ring marks where the star is.
        ctx.strokeStyle = p.hiddenRing;
        ctx.lineWidth = 1.2 * line;
        ctx.setLineDash([2 * k, 2 * k]);
        ctx.beginPath();
        ctx.arc(x, y, 4.5 * k, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        continue;
      }
      if (p.letterHalo) {
        const halo = ctx.createRadialGradient(x, y, 0, x, y, 9 * k);
        halo.addColorStop(0, p.letterHalo[0]);
        halo.addColorStop(1, p.letterHalo[1]);
        ctx.fillStyle = halo;
        ctx.beginPath();
        ctx.arc(x, y, 9 * k, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = p.letterStar;
      ctx.beginPath();
      ctx.arc(x, y, Math.max(1.6, starRadius(s.mag)) * k, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  });
  drawSelection();
  ctx.restore();
}
