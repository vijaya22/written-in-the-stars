// Images of a result: the social card, the link preview, and print posters.
// Drawn with the same chart renderer as the page, in the browser (card) or on
// the server (preview, posters: see server/render-image.ts).

import { PALETTES, renderSky, type Palette, type RenderState, type ThemeName } from "./render.ts";

export interface ImageText {
  title: string; // “Vijaya” written in the stars
  lines: string[]; // place and time, where to look
  letters: { char: string; stars: string }[]; // posters: the stars in each letter
  credit: string;
}

// Posters are sized in points (1/72 in), which PDF uses for the page size.
const cm = (v: number) => Math.round((v / 2.54) * 72);
export const POSTER_SIZES = {
  a3: { w: cm(29.7), h: cm(42), label: "A3 (29.7 × 42 cm)" },
  a2: { w: cm(42), h: cm(59.4), label: "A2 (42 × 59.4 cm)" },
  "30x40": { w: cm(30), h: cm(40), label: "30 × 40 cm" },
  "12x16": { w: 12 * 72, h: 16 * 72, label: "12 × 16 in" },
  "18x24": { w: 18 * 72, h: 24 * 72, label: "18 × 24 in" },
};
export type PosterSize = keyof typeof POSTER_SIZES;
export const isPosterSize = (v: unknown): v is PosterSize => typeof v === "string" && v in POSTER_SIZES;

export type ImageFormat = "card" | "og" | PosterSize;

// Card: 4:5 portrait, shown large by social apps. Preview: the 1.91:1 link-preview shape.
const PIXEL_FORMATS = { card: { w: 1080, h: 1350 }, og: { w: 1200, h: 630 } };

export const THEME_LABELS: Record<ThemeName, string> = { midnight: "Midnight", paper: "Paper", ink: "Ink" };

/** Page colours around the chart, per theme. */
const PAGE: Record<ThemeName, { bg: [string, string]; title: string; text: string; muted: string; credit: string }> = {
  midnight: { bg: ["#0d1430", "#050814"], title: "#ffd68c", text: "#e6e9f5", muted: "#9aa3c3", credit: "#6f7897" },
  paper: { bg: ["#f6f0e4", "#f1e9da"], title: "#7a4a14", text: "#2b2f45", muted: "#5b5f73", credit: "#8a8472" },
  ink: { bg: ["#ffffff", "#ffffff"], title: "#111111", text: "#111111", muted: "#444444", credit: "#777777" },
};

export interface ComposeOptions {
  theme?: ThemeName;
  /** Makes a canvas: document.createElement in the browser, skia-canvas on the server. */
  createCanvas: (w: number, h: number) => HTMLCanvasElement;
  fonts?: { serif: string; sans: string };
}

const BROWSER_FONTS = { serif: `Georgia, "Times New Roman", serif`, sans: "system-ui, -apple-system, sans-serif" };

function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, font: (px: number) => string, px: number) {
  ctx.font = font(px);
  while (ctx.measureText(text).width > maxWidth && px > 6) ctx.font = font(--px);
}

export function composeImage(state: RenderState, text: ImageText, format: ImageFormat, opts: ComposeOptions): HTMLCanvasElement {
  const theme = opts.theme ?? "midnight";
  const fonts = opts.fonts ?? BROWSER_FONTS;
  const palette: Palette = { ...PALETTES[theme], fontSans: fonts.sans };
  const page = PAGE[theme];
  const { w, h } = format in PIXEL_FORMATS ? PIXEL_FORMATS[format as "card" | "og"] : POSTER_SIZES[format as PosterSize];
  const canvas = opts.createCanvas(w, h);
  const ctx = canvas.getContext("2d")!;
  const serif = (px: number) => `${px}px ${fonts.serif}`;
  const sans = (px: number) => `${px}px ${fonts.sans}`;

  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, page.bg[0]);
  bg.addColorStop(1, page.bg[1]);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  const draw = (size: number, x: number, y: number) =>
    renderSky(null, { ...state, progress: 1 }, { ctx, origin: [x, y], size, palette });

  if (format === "og") {
    // Landscape preview: chart on the left, words on the right.
    const pad = 30;
    const chart = h - 2 * pad;
    draw(chart, pad, pad);
    const x = chart + 2 * pad + 10, maxW = w - x - 40;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    const [quoted] = text.title.split(" written");
    ctx.fillStyle = page.title;
    fitText(ctx, quoted, maxW, serif, 76);
    ctx.fillText(quoted, x, 230);
    ctx.font = serif(40);
    ctx.fillText("written in the stars", x, 290);
    ctx.fillStyle = page.text;
    let y = 380;
    for (const line of text.lines) {
      fitText(ctx, line, maxW, sans, 26);
      ctx.fillText(line, x, y);
      y += 40;
    }
    ctx.fillStyle = page.credit;
    ctx.font = sans(18);
    ctx.fillText("stars.vijaya.io", x, h - 40);
    return canvas;
  }

  const u = w / 1080; // layout unit: 1 at card width
  const margin = 60 * u;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = page.title;
  fitText(ctx, text.title, w - 2 * margin, serif, Math.round(60 * u));
  ctx.fillText(text.title, w / 2, 115 * u);

  // The chart, as large as the text below it allows.
  const poster = format !== "card";
  const chartTop = 150 * u;
  const letterRows = poster && text.letters.length ? Math.ceil(text.letters.length / 2) : 0;
  const reserved = (50 + 42 * text.lines.length + (letterRows ? 30 + 52 * letterRows : 0) + 90) * u;
  const chart = Math.min(w - 2 * margin, h - chartTop - reserved);
  draw(chart, (w - chart) / 2, chartTop);

  let y = chartTop + chart + 50 * u;
  ctx.fillStyle = page.text;
  for (const line of text.lines) {
    fitText(ctx, line, w - 2 * margin, sans, Math.round(30 * u));
    ctx.fillText(line, w / 2, y);
    y += 42 * u;
  }

  if (letterRows) {
    // Two columns: each letter and the named stars it is made of.
    y += 30 * u;
    const colW = (w - 2 * margin) / 2;
    ctx.textAlign = "left";
    text.letters.forEach(({ char, stars }, i) => {
      const x = margin + (i >= letterRows ? colW : 0);
      const ly = y + (i % letterRows) * 52 * u;
      ctx.fillStyle = page.title;
      ctx.font = serif(Math.round(34 * u));
      ctx.fillText(char, x, ly);
      ctx.fillStyle = page.muted;
      fitText(ctx, stars, colW - 70 * u, sans, Math.round(22 * u));
      ctx.fillText(stars, x + 50 * u, ly);
    });
    ctx.textAlign = "center";
  }

  ctx.fillStyle = page.credit;
  ctx.font = sans(Math.round(20 * u));
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
