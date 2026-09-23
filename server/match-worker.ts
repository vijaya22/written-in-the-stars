// Worker thread: matches a name against the sky at one moment.

import { readFileSync } from "node:fs";
import { parentPort } from "node:worker_threads";
import { visibleSky, type CatalogStar } from "../src/astro.ts";
import { matchName, type NameMatch } from "../src/matcher.ts";

export interface MatchTask {
  name: string;
  lat: number;
  lon: number;
  time: number; // ms timestamp
  scatter: boolean; // allow the numbered-letters fallback
  visibleMag: number; // faintest star the viewer's sky shows
}

const catalog: CatalogStar[] = JSON.parse(readFileSync(new URL("../public/stars.json", import.meta.url), "utf8"));

parentPort!.on("message", ({ id, task }: { id: number; task: MatchTask }) => {
  try {
    const sky = visibleSky(catalog, new Date(task.time), task.lat, task.lon);
    const match: NameMatch = matchName(task.name, sky, { scatterFallback: task.scatter, visibleMag: task.visibleMag });
    parentPort!.postMessage({ id, match });
  } catch (err) {
    parentPort!.postMessage({ id, error: (err as Error).message });
  }
});
