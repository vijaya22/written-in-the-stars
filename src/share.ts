// Images to share or print: a social card and a poster, drawn from the
// same chart renderer as the page.

import { renderSky, type RenderState } from "./render.ts";

export interface ImageText {
  title: string; // “Vijaya” written in the stars
  lines: string[]; // place and time, where to look
  letters: { char: string; stars: string }[]; // poster only: the stars in each letter
  credit: string;
}

export type ImageFormat = "card" | "poster";

// Card: 4:5 portrait, the shape social apps show largest.
// Poster: 30 × 40 cm at 250 dpi (12 MP stays under mobile browsers' canvas limits).
const FORMATS = {
  card: { w: 1080, h: 1350 },
  poster: { w: 3000, h: 4000 },
};

function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, font: (px: number) => string, px: number) {
  ctx.font = font(px);
  while (ctx.measureText(text).width > maxWidth && px > 10) ctx.font = font(--px);
}

export function composeImage(state: RenderState, text: ImageText, format: ImageFormat): HTMLCanvasElement {
  const { w, h } = FORMATS[format];
  const u = w / 1080; // layout unit: 1 at card size
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;

  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, "#0d1430");
  bg.addColorStop(1, "#050814");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  const margin = 60 * u;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#ffd68c";
  fitText(ctx, text.title, w - 2 * margin, (px) => `${px}px Georgia, "Times New Roman", serif`, Math.round(60 * u));
  ctx.fillText(text.title, w / 2, 115 * u);

  // The chart, as large as the layout allows.
  const chartTop = 150 * u;
  // Room for what goes below the chart: caption lines, the poster's star list, the credit.
  const letterRows = format === "poster" && text.letters.length ? Math.ceil(text.letters.length / 2) : 0;
  const reserved = (50 + 42 * text.lines.length + (letterRows ? 30 + 52 * letterRows : 0) + 90) * u;
  const chart = Math.min(w - 2 * margin, h - chartTop - reserved);
  renderSky(canvas, { ...state, progress: 1 }, { ctx, origin: [(w - chart) / 2, chartTop], size: chart, pixelRatio: 1 });

  let y = chartTop + chart + 50 * u;
  ctx.fillStyle = "#e6e9f5";
  for (const line of text.lines) {
    fitText(ctx, line, w - 2 * margin, (px) => `${px}px system-ui, -apple-system, sans-serif`, Math.round(30 * u));
    ctx.fillText(line, w / 2, y);
    y += 42 * u;
  }

  if (format === "poster" && text.letters.length) {
    // Two columns: each letter and the named stars it is made of.
    y += 30 * u;
    const perColumn = Math.ceil(text.letters.length / 2);
    const colW = (w - 2 * margin) / 2;
    const rowH = 52 * u;
    ctx.textAlign = "left";
    text.letters.forEach(({ char, stars }, i) => {
      const x = margin + (i >= perColumn ? colW : 0);
      const ly = y + (i % perColumn) * rowH;
      ctx.fillStyle = "#ffd68c";
      ctx.font = `${Math.round(34 * u)}px Georgia, serif`;
      ctx.fillText(char, x, ly);
      ctx.fillStyle = "#9aa3c3";
      fitText(ctx, stars, colW - 70 * u, (px) => `${px}px system-ui, sans-serif`, Math.round(22 * u));
      ctx.fillText(stars, x + 50 * u, ly);
    });
    ctx.textAlign = "center";
  }

  ctx.fillStyle = "#6f7897";
  ctx.font = `${Math.round(20 * u)}px system-ui, sans-serif`;
  ctx.fillText(text.credit, w / 2, h - 36 * u);
  return canvas;
}

export function toBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("image export failed"))), "image/png"));
}

export function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
