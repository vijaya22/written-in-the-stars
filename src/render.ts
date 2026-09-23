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
}

export function renderSky(canvas: HTMLCanvasElement, { sky, bodies, match, progress }: RenderState) {
  // Turn the chart so the name reads left to right (the sky has no "up").
  const rot = -(match?.readingAngle ?? 0);
  const rc = Math.cos(rot), rs = Math.sin(rot);
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
  const px = (s: { x: number; y: number }) => [cx + (s.x * rc - s.y * rs) * R, cy + (s.x * rs + s.y * rc) * R] as const;
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
    const [x, y] = px(s);
    ctx.globalAlpha = Math.min(1, 0.35 + (6 - s.mag) * 0.14) * (s.alt < 10 ? 0.4 + s.alt * 0.06 : 1);
    ctx.fillStyle = starColor(s.ci);
    ctx.beginPath();
    ctx.arc(x, y, starRadius(s.mag) * k, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // Moon and planets, labelled so they can be told apart from stars
  ctx.font = `${Math.round(11 * Math.max(1, k))}px system-ui, sans-serif`;
  ctx.textAlign = "left";
  for (const b of bodies) {
    const [x, y] = px(b);
    let r: number;
    if (b.kind === "moon") {
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
    ctx.fillStyle = "rgba(200, 210, 240, 0.75)";
    ctx.fillText(b.name, x + r + 5 * k, y);
  }
  ctx.restore();

  if (!match) return;

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
