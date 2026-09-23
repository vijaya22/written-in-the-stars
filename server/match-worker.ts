// Worker thread: matches a name against the sky at one moment, or draws an
// image of it (link preview, poster).

import { readFileSync } from "node:fs";
import { parentPort } from "node:worker_threads";
import { visibleSky, type CatalogStar } from "../src/astro.ts";
import { matchName } from "../src/matcher.ts";
import { renderImage, type ImageTask } from "./render-image.ts";

export interface MatchTask {
  name: string;
  lat: number;
  lon: number;
  time: number; // ms timestamp
  scatter: boolean; // allow the numbered-letters fallback
  visibleMag: number; // faintest star the viewer's sky shows
}

export type WorkerTask = { kind: "match"; task: MatchTask } | { kind: "image"; task: ImageTask };

const catalog: CatalogStar[] = JSON.parse(readFileSync(new URL("../public/stars.json", import.meta.url), "utf8"));

parentPort!.on("message", async ({ id, job }: { id: number; job: WorkerTask }) => {
  try {
    if (job.kind === "match") {
      const t = job.task;
      const sky = visibleSky(catalog, new Date(t.time), t.lat, t.lon);
      parentPort!.postMessage({ id, result: matchName(t.name, sky, { scatterFallback: t.scatter, visibleMag: t.visibleMag }) });
    } else {
      const image = await renderImage(catalog, job.task);
      parentPort!.postMessage({ id, result: image }, [image.buffer as ArrayBuffer]);
    }
  } catch (err) {
    parentPort!.postMessage({ id, error: (err as Error).message });
  }
});
