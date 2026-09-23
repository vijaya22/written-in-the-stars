import type { SkyStar } from "./astro.ts";
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

export interface RenderState {
  sky: SkyStar[];
  match: NameMatch | null;
  progress: number; // 0..1, animates the letter strokes
}

export function renderSky(canvas: HTMLCanvasElement, { sky, match, progress }: RenderState) {
  const dpr = window.devicePixelRatio || 1;
  const size = canvas.clientWidth;
  if (canvas.width !== size * dpr) {
    canvas.width = size * dpr;
    canvas.height = size * dpr;
  }
  const ctx = canvas.getContext("2d")!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, size, size);

  const R = size / 2 - 22;
  const cx = size / 2, cy = size / 2;
  const px = (s: { x: number; y: number }) => [cx + s.x * R, cy + s.y * R] as const;
  const k = size / 640; // scale star sizes with the canvas

  // Sky dome
  const bg = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
  bg.addColorStop(0, "#0b1433");
  bg.addColorStop(0.75, "#081029");
  bg.addColorStop(1, "#12193a");
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
  ctx.fillText("N", cx, cy - R - 11);
  ctx.fillText("S", cx, cy + R + 11);
  ctx.fillText("E", cx - R - 11, cy);
  ctx.fillText("W", cx + R + 11, cy);

  // Stars (faintest first so bright ones sit on top)
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.clip();
  for (let i = sky.length - 1; i >= 0; i--) {
    const s = sky[i];
    const [x, y] = px(s);
    ctx.globalAlpha = Math.min(1, 0.35 + (6 - s.mag) * 0.14) * (s.alt < 10 ? 0.4 + s.alt * 0.06 : 1);
    ctx.fillStyle = starColor(s.ci);
    ctx.beginPath();
    ctx.arc(x, y, starRadius(s.mag) * k, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.restore();

  if (!match) return;

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
}
