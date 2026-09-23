// Tries a name at a list of times, off the main thread. Several of these run
// in parallel, each with its own share of the night.

import { visibleSky, type CatalogStar } from "./astro.ts";
import { matchName, type NameMatch } from "./matcher.ts";
import { rank } from "./night.ts";

export interface NightRequest {
  catalog: CatalogStar[];
  name: string;
  lat: number;
  lon: number;
  times: number[]; // ms timestamps
}

export interface NightStep {
  time: number;
  match: NameMatch;
  rank: number;
}

self.onmessage = (e: MessageEvent<NightRequest>) => {
  const { catalog, name, lat, lon, times } = e.data;
  for (const time of times) {
    const match = matchName(name, visibleSky(catalog, new Date(time), lat, lon), { scatterFallback: false });
    self.postMessage({ time, match, rank: rank(match) } satisfies NightStep);
  }
};
