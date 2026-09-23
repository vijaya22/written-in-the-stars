// API + static site server.
//
//   GET /api/night?name=&lat=&lon=&from=&sky=   best time tonight (from = local noon, ms)
//   GET /api/match?name=&lat=&lon=&time=&sky=   the name at one exact moment
//     sky = city | suburb | dark (default dark): prefer stars visible from there
//   GET /api/places?q=                     city search
//   GET /api/places/near?lat=&lon=         closest city (label + time zone for a GPS fix)
//   GET /api/places/default?tz=            biggest city in a time zone
//   GET /api/health
//   GET /og.png?<share link params>              link-preview image (1200×630)
//   GET /poster.pdf?<share link params>&size=&theme=   print poster
//   GET /?<share link params>                     the page, with link-preview tags for that sky
//   everything else: the built site in dist/ (after `npm run build`)
//
//   PORT (default 8787), WORKERS (default: one per CPU core)
//   TRUST_PROXY=1 when behind a reverse proxy (Caddy): client IP from X-Forwarded-For
//   PUBLIC_ORIGIN, e.g. https://stars.vijaya.io: absolute URLs in link previews

import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeName, type NameMatch } from "../src/matcher.ts";
import { bestTimeTonight, rank, sunAltitude, type NightResult } from "../src/night.ts";
import { isSkyQuality, SKY_LIMIT, twilightLimit } from "../src/sky.ts";
import { isThemeName } from "../src/render.ts";
import { isPosterSize, POSTER_SIZES, type ImageFormat } from "../src/share.ts";
import { wallTimeToDate } from "../src/time.ts";
import { largestInTimeZone, nearestPlace, searchPlaces } from "./places.ts";
import { MatchPool } from "./pool.ts";

const PORT = Number(process.env.PORT ?? 8787);
const DIST = fileURLToPath(new URL("../dist/", import.meta.url));
const pool = new MatchPool(process.env.WORKERS ? Number(process.env.WORKERS) : undefined);
const TRUST_PROXY = process.env.TRUST_PROXY === "1";

// ---------------------------------------------------------------------------
// Abuse limits: a night search is ~25 matching jobs, so it is metered per visitor,
// and the whole server refuses new searches when the job queue is already long.

class TooMany extends Error {}

const LIMITS = { search: { perMinute: 20, burst: 10 }, light: { perMinute: 240, burst: 60 } };
const buckets = new Map<string, { tokens: number; at: number }>();

function clientIp(req: IncomingMessage): string {
  const forwarded = TRUST_PROXY ? String(req.headers["x-forwarded-for"] ?? "").split(",")[0].trim() : "";
  return forwarded || req.socket.remoteAddress || "unknown";
}

/** Token bucket per visitor and kind of request. */
function rateLimit(req: IncomingMessage, kind: keyof typeof LIMITS) {
  const { perMinute, burst } = LIMITS[kind];
  const key = `${kind}|${clientIp(req)}`;
  const now = Date.now();
  const b = buckets.get(key) ?? { tokens: burst, at: now };
  b.tokens = Math.min(burst, b.tokens + ((now - b.at) / 60000) * perMinute);
  b.at = now;
  if (b.tokens < 1) throw new TooMany("too many requests; please wait a moment");
  b.tokens -= 1;
  buckets.set(key, b);
}

// Forget idle visitors so the table doesn't grow forever.
setInterval(() => {
  const cutoff = Date.now() - 10 * 60000;
  for (const [k, b] of buckets) if (b.at < cutoff) buckets.delete(k);
}, 60000).unref();

const MAX_BACKLOG = 400; // queued matching jobs (~16 night searches) before new searches are turned away

function checkCapacity() {
  if (pool.backlog > MAX_BACKLOG) throw new TooMany("the stars are busy right now; please try again in a minute");
}

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
  const sky = url.searchParams.get("sky") ?? "dark";
  if (!isSkyQuality(sky)) throw new BadRequest("sky must be city, suburb or dark");
  return { name, lat: num("lat", -90, 90), lon: num("lon", -180, 180), visibleMag: SKY_LIMIT[sky], num };
}

// ---------------------------------------------------------------------------
// Night search, cached. Identical requests share one computation.

const CACHE_SIZE = 1000;
const cache = new Map<string, Promise<NightResult>>();

function night(name: string, lat: number, lon: number, from: number, visibleMag: number): Promise<NightResult> {
  // ~1 km of rounding doesn't change the sky visibly.
  const key = [normalizeName(name), lat.toFixed(2), lon.toFixed(2), from, visibleMag].join("|");
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key); // move to most-recent
    cache.set(key, hit);
    return hit;
  }
  const job = bestTimeTonight(new Date(from), lat, lon, {
    evaluate: (times) =>
      Promise.all(times.map(async (time) => {
        const match = await pool.run({ name, lat, lon, time, scatter: false, visibleMag });
        return { time, match, rank: rank(match) };
      })),
    scattered: (time) => pool.run({ name, lat, lon, time, scatter: true, visibleMag }),
  });
  cache.set(key, job);
  job.catch(() => cache.delete(key));
  if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!);
  return job;
}

// ---------------------------------------------------------------------------
// Shared links: ?name=&place=&lat=&lon=&tz=&when=&sky= describe one exact sky.

function shareParams(url: URL) {
  const { name, lat, lon, visibleMag } = params(url);
  const tz = url.searchParams.get("tz") ?? "";
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
  } catch {
    throw new BadRequest("tz must be a time zone like Asia/Kolkata");
  }
  const when = url.searchParams.get("when") ?? "";
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(when)) throw new BadRequest("when must look like 2026-09-24T21:30");
  const time = wallTimeToDate(when, tz).getTime();
  if (!(time >= MIN_TIME && time <= MAX_TIME)) throw new BadRequest("when is out of range");
  const placeLabel = (url.searchParams.get("place") ?? "").slice(0, 80) || "the shared place";
  return { name, lat, lon, visibleMag, timeZone: tz, time, placeLabel };
}

// Rendered images, cached: a shared link's preview is fetched by every chat app it's pasted into.
const IMAGE_CACHE_SIZE = 200;
const images = new Map<string, Promise<Uint8Array>>();

function image(url: URL, format: ImageFormat, theme: string): Promise<Uint8Array> {
  const p = shareParams(url);
  if (!isThemeName(theme)) throw new BadRequest("theme must be midnight, paper or ink");
  const key = [format, theme, normalizeName(p.name), p.lat.toFixed(3), p.lon.toFixed(3), p.time, p.visibleMag, p.placeLabel].join("|");
  const hit = images.get(key);
  if (hit) return hit;
  checkCapacity();
  const job = pool.image({ ...p, format, theme });
  images.set(key, job);
  job.catch(() => images.delete(key));
  if (images.size > IMAGE_CACHE_SIZE) images.delete(images.keys().next().value!);
  return job;
}

function sendBytes(res: ServerResponse, bytes: Uint8Array, type: string, extra: Record<string, string> = {}) {
  res.writeHead(200, { "Content-Type": type, "Content-Length": bytes.length, "Cache-Control": "public, max-age=86400", ...extra });
  res.end(bytes);
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function origin(req: IncomingMessage): string {
  if (process.env.PUBLIC_ORIGIN) return process.env.PUBLIC_ORIGIN.replace(/\/$/, "");
  return `http://${req.headers.host ?? `localhost:${PORT}`}`;
}

// The built page, re-read whenever a new build replaces it (its asset names change each build).
let indexHtml = { html: "", mtime: 0 };
function builtPage(): string {
  const file = join(DIST, "index.html");
  const mtime = statSync(file).mtimeMs;
  if (mtime !== indexHtml.mtime) indexHtml = { html: readFileSync(file, "utf8"), mtime };
  return indexHtml.html;
}

/**
 * The page for a shared link, with Open Graph tags describing that sky, so chat
 * apps and social sites show its picture. (They read tags; they don't run scripts.)
 */
function sharePage(req: IncomingMessage, url: URL, res: ServerResponse): boolean {
  if (!url.searchParams.has("name") || !url.searchParams.has("when")) return false;
  let p: ReturnType<typeof shareParams>;
  try {
    p = shareParams(url);
  } catch {
    return false; // malformed link: the plain page still works
  }
  const date = new Date(p.time).toLocaleString("en-GB", { dateStyle: "long", timeStyle: "short", timeZone: p.timeZone });
  const title = `“${p.name}” written in the stars`;
  const description = `Real stars over ${p.placeLabel}, ${date}. Find your own name in tonight’s sky.`;
  const imageUrl = `${origin(req)}/og.png${url.search}`;
  const tags = [
    `<meta property="og:url" content="${escapeHtml(`${origin(req)}/${url.search}`)}" />`,
    `<meta property="og:image" content="${escapeHtml(imageUrl)}" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta property="og:image:alt" content="${escapeHtml(title)}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
  ].join("\n    ");
  const html = builtPage()
    .replace(/<meta property="og:title" content="[^"]*"/, `<meta property="og:title" content="${escapeHtml(title)}"`)
    .replace(/<meta property="og:description" content="[^"]*"/, `<meta property="og:description" content="${escapeHtml(description)}"`)
    .replace("</head>", `    ${tags}\n  </head>`);
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" });
  res.end(html);
  return true;
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
    rateLimit(req, "search");
    const { name, lat, lon, visibleMag, num } = params(url);
    const from = num("from", MIN_TIME, MAX_TIME);
    checkCapacity();
    return json(res, 200, await night(name, lat, lon, from, visibleMag), 3600);
  }

  if (url.pathname === "/api/match") {
    rateLimit(req, "light");
    checkCapacity();
    const { name, lat, lon, visibleMag, num } = params(url);
    const time = num("time", MIN_TIME, MAX_TIME);
    // In twilight the sky itself hides the fainter stars.
    const limit = Math.min(visibleMag, twilightLimit(sunAltitude(new Date(time), lat, lon)));
    const match: NameMatch = await pool.run({ name, lat, lon, time, scatter: true, visibleMag: limit });
    return json(res, 200, { match }, 3600);
  }

  if (url.pathname.startsWith("/api/places")) rateLimit(req, "light");

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

  if (url.pathname === "/og.png") {
    rateLimit(req, "light");
    return sendBytes(res, await image(url, "og", "midnight"), "image/png");
  }

  if (url.pathname === "/poster.pdf") {
    rateLimit(req, "search");
    const size = url.searchParams.get("size") ?? "a3";
    if (!isPosterSize(size)) throw new BadRequest(`size must be one of ${Object.keys(POSTER_SIZES).join(", ")}`);
    const theme = url.searchParams.get("theme") ?? "midnight";
    const pdf = await image(url, size, theme);
    const file = `${normalizeName(url.searchParams.get("name") ?? "sky").toLowerCase().replace(/[^a-z0-9]+/g, "-")}-in-the-stars-${size}-${theme}.pdf`;
    return sendBytes(res, pdf, "application/pdf", { "Content-Disposition": `attachment; filename="${file}"` });
  }

  if (url.pathname.startsWith("/api/")) return json(res, 404, { error: "not found" });
  if (url.pathname === "/" && sharePage(req, url, res)) return;
  serveStatic(url, res);
}

const server = createServer((req, res) => {
  const start = performance.now();
  handle(req, res)
    .catch((err) => {
      if (err instanceof BadRequest) return json(res, 400, { error: err.message });
      if (err instanceof TooMany) return json(res, 429, { error: err.message });
      console.error(err);
      json(res, 500, { error: "internal error" });
    })
    .finally(() => {
      // Path only: query strings hold people's names and locations.
      const path = (req.url ?? "").split("?")[0];
      if (path.startsWith("/api/")) console.log(`${req.method} ${path} ${res.statusCode} ${(performance.now() - start).toFixed(0)}ms`);
    });
});
server.listen(PORT, () => console.log(`listening on http://localhost:${PORT} (${pool.size} match workers)`));

// Docker/systemd stop: finish in-flight requests, then exit.
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    console.log(`${signal}: shutting down`);
    server.close(() => {
      pool.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000).unref();
  });
}
