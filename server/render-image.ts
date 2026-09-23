// Draws link previews (PNG) and posters (PDF) on the server, with the same
// chart and layout code as the page. Runs inside the worker threads.

import type { CatalogStar } from "../src/astro.ts";
import { visibleBodies, visibleSky } from "../src/astro.ts";
import { imageText } from "../src/describe.ts";
import { solarSystem } from "../src/ephemeris.ts";
import { matchName } from "../src/matcher.ts";
import { sunAltitude } from "../src/night.ts";
import type { ThemeName } from "../src/render.ts";
import { composeImage, POSTER_SIZES, type ImageFormat } from "../src/share.ts";
import { twilightLimit } from "../src/sky.ts";

export interface ImageTask {
  name: string;
  lat: number;
  lon: number;
  time: number; // ms timestamp
  timeZone: string;
  placeLabel: string;
  visibleMag: number;
  format: ImageFormat;
  theme: ThemeName;
}

const FONTS = { serif: `"EB Garamond"`, sans: "Inter" };
let skia: typeof import("skia-canvas") | null = null;

/** skia-canvas loads on first use, so workers that only match stay small. */
async function loadSkia() {
  if (!skia) {
    skia = await import("skia-canvas");
    const font = (f: string) => new URL(`./fonts/${f}`, import.meta.url).pathname;
    skia.FontLibrary.use("EB Garamond", [font("EBGaramond.ttf")]);
    skia.FontLibrary.use("Inter", [font("Inter.ttf")]);
  }
  return skia;
}

export async function renderImage(catalog: CatalogStar[], t: ImageTask): Promise<Uint8Array> {
  const { Canvas } = await loadSkia();
  const when = new Date(t.time);
  const sky = visibleSky(catalog, when, t.lat, t.lon);
  const bodies = visibleBodies(solarSystem(when), when, t.lat, t.lon).filter((b) => b.mag <= 6);
  const sunAlt = sunAltitude(when, t.lat, t.lon);
  const limitMag = Math.min(t.visibleMag, twilightLimit(sunAlt));
  // Same settings as /api/match, so the image shows what the shared link shows.
  const match = matchName(t.name, sky, { visibleMag: limitMag });

  const canvas = composeImage(
    { sky, bodies, match, progress: 1, sunAlt, limitMag },
    imageText(t.name, t.placeLabel, when, t.timeZone, match),
    t.format,
    { theme: t.theme, fonts: FONTS, createCanvas: (w, h) => new Canvas(w, h) as unknown as HTMLCanvasElement },
  );
  const skiaCanvas = canvas as unknown as InstanceType<typeof Canvas>;
  const buffer = await skiaCanvas.toBuffer(t.format in POSTER_SIZES ? "pdf" : "png");
  return new Uint8Array(buffer);
}
