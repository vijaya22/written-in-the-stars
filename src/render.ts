import type { SkyBody, SkyStar } from "./astro.ts";
import type { NameMatch } from "./matcher.ts";

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

function starRadius(mag: number): number {
  return Math.max(0.45, 3.4 - 0.55 * mag);
}

/** Moon disk with its real phase; `litAngle` points toward the Sun. */
function drawMoon(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, lit: number, litAngle: number) {
  const glow = ctx.createRadialGradient(x, y, r * 0.8, x, y, r * 3.5);
  glow.addColorStop(0, `rgba(240, 236, 220, ${0.08 + 0.22 * lit})`);
  glow.addColorStop(1, "rgba(240, 236, 220, 0)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(x, y, r * 3.5, 0, Math.PI * 2);
  ctx.fill();

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(litAngle);
  ctx.fillStyle = "#3a3f52";
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  // Lit limb on the Sun side (+x), closed off by the terminator ellipse.
  ctx.fillStyle = "#f4f1e8";
  ctx.beginPath();
  ctx.arc(0, 0, r, -Math.PI / 2, Math.PI / 2);
  const rx = r * Math.abs(2 * lit - 1);
  if (lit >= 0.5) ctx.ellipse(0, 0, rx, r, 0, Math.PI / 2, (3 * Math.PI) / 2, false);
  else ctx.ellipse(0, 0, rx, r, 0, Math.PI / 2, -Math.PI / 2, true);
  ctx.fill();
  ctx.restore();
}

export interface RenderState {
  sky: SkyStar[];
  bodies: SkyBody[];
  match: NameMatch | null;
  progress: number; // 0..1, animates the letter strokes
  sunAlt: number; // degrees: sets daylight / twilight / night
  limitMag: number; // faintest star the viewer can see (light pollution, twilight)
}

type Rgb = [number, number, number];
const NIGHT: Rgb[] = [[11, 20, 51], [8, 16, 41], [18, 25, 58]]; // centre, middle, horizon
const DAY: Rgb[] = [[92, 150, 222], [110, 165, 230], [170, 205, 240]];
const mix = (a: Rgb, b: Rgb, t: number) => `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(",")})`;

/** 0 at full night (Sun 18° down) … 1 in daylight. */
const daylight = (sunAlt: number) => Math.min(1, Math.max(0, (sunAlt + 18) / 18)) ** 2;

/**
 * Draw the sky chart. On screen it fills the canvas's CSS width; for exports,
 * `size` (CSS px) and `pixelRatio` set the output resolution, and `ctx` may be
 * any 2D context (e.g. a poster canvas) with `origin` as the chart's top-left.
 */
export function renderSky(
  canvas: HTMLCanvasElement,
  state: RenderState,
  out: { size?: number; pixelRatio?: number; ctx?: CanvasRenderingContext2D; origin?: [number, number] } = {},
) {
  const { sky, bodies, match, progress, sunAlt, limitMag } = state;
  // Turn the chart so the name reads left to right (the sky has no "up").
  const rot = -(match?.readingAngle ?? 0);
  const rc = Math.cos(rot), rs = Math.sin(rot);
  const dpr = out.pixelRatio ?? (window.devicePixelRatio || 1);
  const size = out.size ?? canvas.clientWidth;
  let ctx: CanvasRenderingContext2D;
  if (out.ctx) {
    ctx = out.ctx;
    ctx.save();
    ctx.translate(...(out.origin ?? [0, 0]));
  } else {
    if (canvas.width !== size * dpr) {
      canvas.width = size * dpr;
      canvas.height = size * dpr;
    }
    ctx = canvas.getContext("2d")!;
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);
  }
  const day = daylight(sunAlt);

  const R = size / 2 - 22;
  const cx = size / 2, cy = size / 2;
  const px = (s: { x: number; y: number }) => [cx + (s.x * rc - s.y * rs) * R, cy + (s.x * rs + s.y * rc) * R] as const;
  const k = size / 640; // scale star sizes with the canvas

  // Sky dome: night blue, brightening through twilight into day
  const bg = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
  bg.addColorStop(0, mix(NIGHT[0], DAY[0], day));
  bg.addColorStop(0.75, mix(NIGHT[1], DAY[1], day));
  bg.addColorStop(1, mix(NIGHT[2], DAY[2], day));
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(160, 180, 255, 0.25)";
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.fillStyle = "rgba(190, 200, 240, 0.6)";
  ctx.font = `${Math.round(12 * Math.max(1, k))}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const edge = (R + 11) / R;
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
    ctx.fillStyle = starColor(s.ci);
    ctx.beginPath();
    ctx.arc(x, y, starRadius(s.mag) * k, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // Moon and planets, labelled so they can be told apart from stars.
  // A label moves around its dot to stay off the letters, or is left out.
  const letterPts = (match?.letters ?? []).flatMap((l) => l.stars.map(px));
  const labelFont = Math.round(11 * Math.max(1, k));
  ctx.font = `${labelFont}px system-ui, sans-serif`;
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
      drawMoon(ctx, x, y, r, b.illuminated ?? 1, (b.litAngle ?? 0) + rot);
    } else {
      r = Math.max(2.2, starRadius(b.mag)) * k;
      ctx.fillStyle = b.color;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(255, 255, 255, 0.35)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(x, y, r + 3 * k, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    // The Sun needs no label (and one would vanish in its glare); hidden planets aren't named.
    const spot = b.kind === "sun" || hiddenPlanet ? null : labelSpot(x, y, r, b.name);
    if (spot) {
      ctx.fillStyle = "rgba(200, 210, 240, 0.75)";
      ctx.textAlign = spot[2];
      ctx.fillText(b.name, spot[0], spot[1]);
    }
  }
  ctx.restore();

  if (!match) {
    ctx.restore();
    return;
  }

  // Scattered letters: a faint thread and numbers carry the reading order.
  if (match.layout === "scattered" && match.letters.length > 1) {
    const centre = (l: (typeof match.letters)[number]) => px({ x: l.cx, y: l.cy });
    ctx.save();
    ctx.globalAlpha = Math.min(1, progress * 1.5);
    ctx.strokeStyle = "rgba(255, 214, 140, 0.3)";
    ctx.setLineDash([2 * k, 6 * k]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    match.letters.forEach((l, i) => (i ? ctx.lineTo : ctx.moveTo).call(ctx, ...centre(l)));
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "rgba(255, 214, 140, 0.9)";
    ctx.font = `600 ${Math.round(12 * Math.max(1, k))}px system-ui, sans-serif`;
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
  match.letters.forEach((l, i) => {
    const local = Math.max(0, Math.min(1, progress * n - i));
    if (local <= 0) return;
    ctx.save();
    ctx.strokeStyle = "rgba(255, 214, 140, 0.85)";
    ctx.lineWidth = 1.6 * Math.max(1, k);
    ctx.lineCap = "round";
    ctx.shadowColor = "rgba(255, 200, 110, 0.9)";
    ctx.shadowBlur = 8;
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
    ctx.globalAlpha = local;
    for (const s of l.stars) {
      const [x, y] = px(s);
      if (s.mag > limitMag) {
        // Too faint for this sky: a hollow ring marks where the star is.
        ctx.strokeStyle = "rgba(255, 230, 190, 0.8)";
        ctx.lineWidth = 1.2 * Math.max(1, k);
        ctx.setLineDash([2 * k, 2 * k]);
        ctx.beginPath();
        ctx.arc(x, y, 4.5 * k, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        continue;
      }
      const halo = ctx.createRadialGradient(x, y, 0, x, y, 9 * k);
      halo.addColorStop(0, "rgba(255, 240, 210, 0.9)");
      halo.addColorStop(1, "rgba(255, 220, 160, 0)");
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(x, y, 9 * k, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#fffaf0";
      ctx.beginPath();
      ctx.arc(x, y, Math.max(1.6, starRadius(s.mag)) * k, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  });
  ctx.restore();
}
