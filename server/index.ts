// API + static site server.
//
//   GET /api/night?name=&lat=&lon=&from=   best time tonight (from = local noon, ms)
//   GET /api/match?name=&lat=&lon=&time=   the name at one exact moment
//   GET /api/places?q=                     city search
//   GET /api/places/near?lat=&lon=         closest city (label + time zone for a GPS fix)
//   GET /api/places/default?tz=            biggest city in a time zone
//   GET /api/health
//   everything else: the built site in dist/ (after `npm run build`)
//
//   PORT (default 8787), WORKERS (default: CPU cores - 1)

import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeName, type NameMatch } from "../src/matcher.ts";
import { bestTimeTonight, rank, type NightResult } from "../src/night.ts";
import { largestInTimeZone, nearestPlace, searchPlaces } from "./places.ts";
import { MatchPool } from "./pool.ts";

const PORT = Number(process.env.PORT ?? 8787);
const DIST = fileURLToPath(new URL("../dist/", import.meta.url));
const pool = new MatchPool(process.env.WORKERS ? Number(process.env.WORKERS) : undefined);

// ---------------------------------------------------------------------------
// Input

class BadRequest extends Error {}

// The planet theory used is valid 1800–2050.
const MIN_TIME = Date.UTC(1900, 0, 1), MAX_TIME = Date.UTC(2050, 0, 1);

function params(url: URL) {
  const name = (url.searchParams.get("name") ?? "").trim();
  if (!name || name.length > 40) throw new BadRequest("name must be 1–40 characters");
  const num = (key: string, min: number, max: number) => {
    const v = Number(url.searchParams.get(key));
    if (!url.searchParams.has(key) || !Number.isFinite(v) || v < min || v > max) throw new BadRequest(`${key} must be a number in [${min}, ${max}]`);
    return v;
  };
  return { name, lat: num("lat", -90, 90), lon: num("lon", -180, 180), num };
}

// ---------------------------------------------------------------------------
// Night search, cached. Identical requests share one computation.

const CACHE_SIZE = 1000;
const cache = new Map<string, Promise<NightResult>>();

function night(name: string, lat: number, lon: number, from: number): Promise<NightResult> {
  // ~1 km of rounding doesn't change the sky visibly.
  const key = [normalizeName(name), lat.toFixed(2), lon.toFixed(2), from].join("|");
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key); // move to most-recent
    cache.set(key, hit);
    return hit;
  }
  const job = bestTimeTonight(new Date(from), lat, lon, {
    evaluate: (times) =>
      Promise.all(times.map(async (time) => {
        const match = await pool.run({ name, lat, lon, time, scatter: false });
        return { time, match, rank: rank(match) };
      })),
    scattered: (time) => pool.run({ name, lat, lon, time, scatter: true }),
  });
  cache.set(key, job);
  job.catch(() => cache.delete(key));
  if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!);
  return job;
}

// ---------------------------------------------------------------------------
// HTTP

function json(res: ServerResponse, status: number, body: unknown, maxAge = 0) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": maxAge ? `public, max-age=${maxAge}` : "no-store",
  });
  res.end(JSON.stringify(body));
}

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon",
  ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8",
};

function serveStatic(url: URL, res: ServerResponse) {
  let path: string;
  try {
    path = decodeURIComponent(url.pathname);
  } catch {
    return json(res, 400, { error: "bad path" });
  }
  if (path.endsWith("/")) path += "index.html";
  const file = resolve(join(DIST, path));
  if (!file.startsWith(DIST.endsWith(sep) ? DIST : DIST + sep)) return json(res, 404, { error: "not found" });
  if (!existsSync(file) || !statSync(file).isFile()) {
    if (!existsSync(join(DIST, "index.html"))) return json(res, 404, { error: "site not built: run npm run build" });
    return json(res, 404, { error: "not found" });
  }
  res.writeHead(200, {
    "Content-Type": TYPES[extname(file)] ?? "application/octet-stream",
    // Vite gives built assets content-hashed names, so they never change.
    "Cache-Control": path.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache",
  });
  createReadStream(file).pipe(res);
}

async function handle(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (req.method !== "GET" && req.method !== "HEAD") return json(res, 405, { error: "method not allowed" });

  if (url.pathname === "/api/health") return json(res, 200, { ok: true, workers: pool.size });

  if (url.pathname === "/api/night") {
    const { name, lat, lon, num } = params(url);
    const from = num("from", MIN_TIME, MAX_TIME);
    return json(res, 200, await night(name, lat, lon, from), 3600);
  }

  if (url.pathname === "/api/match") {
    const { name, lat, lon, num } = params(url);
    const time = num("time", MIN_TIME, MAX_TIME);
    const match: NameMatch = await pool.run({ name, lat, lon, time, scatter: true });
    return json(res, 200, { match }, 3600);
  }

  if (url.pathname === "/api/places") {
    const q = (url.searchParams.get("q") ?? "").slice(0, 80);
    return json(res, 200, { places: searchPlaces(q) }, 86400);
  }

  if (url.pathname === "/api/places/near") {
    const lat = Number(url.searchParams.get("lat")), lon = Number(url.searchParams.get("lon"));
    if (!(Math.abs(lat) <= 90 && Math.abs(lon) <= 180)) throw new BadRequest("lat/lon out of range");
    return json(res, 200, nearestPlace(lat, lon), 86400);
  }

  if (url.pathname === "/api/places/default") {
    const place = largestInTimeZone(url.searchParams.get("tz") ?? "");
    return place ? json(res, 200, { place }, 86400) : json(res, 404, { error: "unknown time zone" });
  }

  if (url.pathname.startsWith("/api/")) return json(res, 404, { error: "not found" });
  serveStatic(url, res);
}

createServer((req, res) => {
  const start = performance.now();
  handle(req, res)
    .catch((err) => {
      if (err instanceof BadRequest) return json(res, 400, { error: err.message });
      console.error(err);
      json(res, 500, { error: "internal error" });
    })
    .finally(() => {
      // Path only: query strings hold people's names and locations.
      const path = (req.url ?? "").split("?")[0];
      if (path.startsWith("/api/")) console.log(`${req.method} ${path} ${res.statusCode} ${(performance.now() - start).toFixed(0)}ms`);
    });
}).listen(PORT, () => console.log(`listening on http://localhost:${PORT} (${pool.size} match workers)`));
