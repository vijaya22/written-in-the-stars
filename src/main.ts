import "./style.css";
import { visibleBodies, visibleSky, type CatalogStar, type SkyBody, type SkyStar } from "./astro.ts";
import { solarSystem } from "./ephemeris.ts";
import { normalizeName, unsupportedChars, type NameMatch } from "./matcher.ts";
import { GLYPHS } from "./glyphs.ts";
import { nextDark, sunAltitude, type NightResult } from "./night.ts";
import { isSkyQuality, SKY_LABEL, SKY_LIMIT, twilightLimit, type SkyQuality } from "./sky.ts";
import { createPlacePicker, placeLabel, type ApiPlace } from "./place-picker.ts";
import { renderSky } from "./render.ts";
import { composeImage, download, toBlob, type ImageFormat } from "./share.ts";

type Place = [label: string, lat: number, lon: number, timeZone: string];

// Used only if the server can't suggest a starting city.
const FALLBACK_PLACE: Place = ["London, United Kingdom", 51.509, -0.126, "Europe/London"];

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;
const form = $<HTMLFormElement>("#form");
const nameInput = $<HTMLInputElement>("#name");
const placeInput = $<HTMLInputElement>("#place");
const placeList = $<HTMLUListElement>("#place-list");
const whenInput = $<HTMLInputElement>("#when");
const locateBtn = $<HTMLButtonElement>("#locate");
const canvas = $<HTMLCanvasElement>("#sky");
const caption = $<HTMLElement>("#caption");
const legend = $<HTMLElement>("#legend");
const status = $<HTMLElement>("#status");
const nameNote = $<HTMLElement>("#name-note");
const shareBar = $<HTMLElement>("#share");
const shareStatus = $<HTMLElement>("#share-status");

/** The name to draw, or null (with a note) when nothing in it can be drawn. */
function drawableName(): string | null {
  const name = nameInput.value.trim();
  const skipped = unsupportedChars(name);
  const drawable = [...normalizeName(name)].some((ch) => GLYPHS[ch]);
  if (name && !drawable) {
    nameNote.textContent = "Only the letters A–Z can be drawn in the stars for now.";
    return null;
  }
  nameNote.textContent = skipped.length
    ? `${skipped.map((c) => `“${c}”`).join(" ")} can’t be drawn in the stars yet, so ${skipped.length > 1 ? "they’re" : "it’s"} left out.`
    : "";
  return name || null;
}

let catalog: CatalogStar[] = [];
let sky: SkyStar[] = [];
let bodies: SkyBody[] = [];
let match: NameMatch | null = null;
let progress = 1;
let sunAlt = -90;
let limitMag = 6;

// The viewer's sky (city / suburb / dark), remembered on this device.
const skyInputs = [...document.querySelectorAll<HTMLInputElement>('input[name="sky"]')];
function skyQuality(): SkyQuality {
  const v = skyInputs.find((i) => i.checked)?.value;
  return isSkyQuality(v) ? v : "suburb";
}
try {
  const saved = localStorage.getItem("sky");
  if (isSkyQuality(saved)) skyInputs.forEach((i) => (i.checked = i.value === saved));
} catch {
  // storage unavailable: keep the default
}
let place: Place = FALLBACK_PLACE;

const BROWSER_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;

/** Milliseconds that `timeZone` is ahead of UTC at the given instant. */
function tzOffset(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23",
    year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric",
  }).formatToParts(new Date(utcMs));
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  return Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second")) - utcMs;
}

/** "2026-09-23T22:00" read as wall-clock time in `timeZone` -> Date. */
function wallTimeToDate(value: string, timeZone: string): Date {
  const [y, mo, d, h, mi] = value.split(/[-T:]/).map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  let utc = guess - tzOffset(guess, timeZone);
  utc = guess - tzOffset(utc, timeZone); // settle across DST changes
  return new Date(utc);
}

/** Date -> "2026-09-23T22:00" wall-clock time in `timeZone`. */
function dateToWallTime(date: Date, timeZone: string): string {
  return new Date(date.getTime() + tzOffset(date.getTime(), timeZone)).toISOString().slice(0, 16);
}

function currentPlace(): Place {
  return place;
}

/** Switch place, keeping the same moment (shown in the new place's local time), then search that night. */
function moveTo(next: Place) {
  const instant = whenInput.value ? wallTimeToDate(whenInput.value, place[3]) : new Date();
  place = next;
  whenInput.value = dateToWallTime(instant, place[3]);
  findBestTime();
}

const fromApi = (p: ApiPlace): Place => [placeLabel(p), p.lat, p.lon, p.timeZone];
const picker = createPlacePicker(placeInput, placeList, (p) => moveTo(fromApi(p)));

function draw() {
  renderSky(canvas, { sky, bodies, match, progress, sunAlt, limitMag });
}

const COMPASS = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"];

/** Where to look for the name: average direction of its stars. */
function lookDirection(m: NameMatch): string {
  let x = 0, y = 0, z = 0;
  for (const l of m.letters)
    for (const s of l.stars) {
      const alt = (s.alt * Math.PI) / 180, az = (s.az * Math.PI) / 180;
      x += Math.cos(alt) * Math.cos(az);
      y += Math.cos(alt) * Math.sin(az);
      z += Math.sin(alt);
    }
  const alt = (Math.atan2(z, Math.hypot(x, y)) * 180) / Math.PI;
  if (alt > 75) return "look straight up";
  const az = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  return `face ${COMPASS[Math.round(az / 45) % 8]}, about ${Math.round(alt / 5) * 5}° up`;
}

// ---------------------------------------------------------------------------
// Sharing: the address bar always holds a link that reopens exactly this sky.

let shown: { when: Date; name: string } | null = null;

function updateLink() {
  if (!shown) return;
  const [label, lat, lon, timeZone] = currentPlace();
  const q = new URLSearchParams();
  if (shown.name) q.set("name", shown.name);
  q.set("place", label);
  q.set("lat", lat.toFixed(3));
  q.set("lon", lon.toFixed(3));
  q.set("tz", timeZone);
  q.set("when", dateToWallTime(shown.when, timeZone));
  q.set("sky", skyQuality());
  history.replaceState(null, "", `?${q}`);
}

function imageText() {
  const [label, , , timeZone] = currentPlace();
  const name = shown?.name ?? "";
  const when = shown!.when.toLocaleString(undefined, { dateStyle: "long", timeStyle: "short", timeZone });
  const look = lookDirection(match!);
  return {
    title: `“${name}” written in the stars`,
    lines: [`${label} · ${when}`, look[0].toUpperCase() + look.slice(1)],
    letters: match!.letters.map((l) => ({
      char: l.char,
      stars: [...new Set([...l.stars].sort((a, b) => a.mag - b.mag).map((s) => s.name))].join(" · "),
    })),
    credit: "Real star positions: HYG database (CC BY-SA 4.0) · Written in the Stars",
  };
}

const fileName = (format: ImageFormat) =>
  `${(shown?.name ?? "sky").toLowerCase().replace(/[^a-z0-9]+/g, "-")}-in-the-stars${format === "poster" ? "-poster" : ""}.png`;

async function makeImage(format: ImageFormat): Promise<Blob> {
  return toBlob(composeImage({ sky, bodies, match, progress: 1, sunAlt, limitMag }, imageText(), format));
}

$<HTMLButtonElement>("#share-btn").addEventListener("click", async () => {
  const data = { title: imageText().title, text: `${imageText().title} over ${currentPlace()[0]}`, url: location.href };
  try {
    const file = new File([await makeImage("card")], fileName("card"), { type: "image/png" });
    if (navigator.canShare?.({ files: [file] })) await navigator.share({ ...data, files: [file] });
    else if (navigator.share) await navigator.share(data);
    else {
      await navigator.clipboard.writeText(location.href);
      shareStatus.textContent = "Link copied. Anyone who opens it sees this exact sky.";
    }
  } catch (err) {
    if ((err as Error).name !== "AbortError") shareStatus.textContent = "Couldn’t share. Copy the address bar link instead.";
  }
});

for (const [id, format] of [["#save-card", "card"], ["#save-poster", "poster"]] as const) {
  $<HTMLButtonElement>(id).addEventListener("click", async () => {
    shareStatus.textContent = format === "poster" ? "Drawing the poster…" : "";
    download(await makeImage(format), fileName(format));
    if (format === "poster") shareStatus.textContent = "Poster saved: 3000 × 4000 px, prints at 30 × 40 cm.";
  });
}

/** Show the sky at `when`, with the name's letters if `found`. */
function show(when: Date, found: NameMatch | null, headline: string | null) {
  const [place, lat, lon, timeZone] = currentPlace();
  whenInput.value = dateToWallTime(when, timeZone);
  sky = visibleSky(catalog, when, lat, lon);
  // Same naked-eye limit as the star catalog: Uranus sometimes makes it, Neptune never does.
  bodies = visibleBodies(solarSystem(when), when, lat, lon).filter((b) => b.mag <= 6);
  sunAlt = sunAltitude(when, lat, lon);
  limitMag = Math.min(SKY_LIMIT[skyQuality()], twilightLimit(sunAlt));
  const name = nameInput.value.trim();
  match = found;
  shown = { when, name };
  shareBar.hidden = !match?.letters.length;
  shareStatus.textContent = "";
  updateLink();

  const dateText = when.toLocaleString(undefined, { dateStyle: "long", timeStyle: "short", timeZone });
  caption.textContent = match?.letters.length
    ? `${headline ?? `“${name}” over ${place}, ${dateText}`} · ${lookDirection(match)}`
    : `The sky over ${place}, ${dateText}`;

  canvas.setAttribute("aria-label", match?.letters.length
    ? `Star chart: “${name}” written in the stars over ${place}. The stars in each letter are listed below.`
    : `Star chart of the sky over ${place}, ${dateText}.`);

  legend.replaceChildren();
  if (match) {
    const all = match.letters.flatMap((l) => l.stars);
    const seen = all.filter((s) => s.mag <= limitMag).length;
    if (all.length && seen < all.length) {
      const li = document.createElement("li");
      li.className = "note";
      li.textContent = sunAlt > -12
        ? `In twilight you’ll see ${seen} of the ${all.length} stars in this name; the dashed rings appear as the sky darkens.`
        : `From ${SKY_LABEL[skyQuality()]} you’ll see ${seen} of the ${all.length} stars in this name. The dashed rings are too faint there; a darker spot shows them all.`;
      legend.append(li);
    }
    if (match.layout === "scattered" && match.letters.length > 1) {
      const li = document.createElement("li");
      li.className = "note";
      li.textContent = "This sky can’t fit the name in one line, so the letters are numbered in reading order.";
      legend.append(li);
    }
    for (const l of match.letters) {
      const li = document.createElement("li");
      const letter = document.createElement("span");
      letter.className = "letter";
      letter.textContent = l.char;
      const names = [...new Set([...l.stars].sort((a, b) => a.mag - b.mag).map((s) => s.name))];
      const stars = document.createElement("span");
      stars.textContent = names.join(" · ");
      const hidden = l.stars.filter((s) => s.mag > limitMag).length;
      if (hidden) stars.textContent += ` (${hidden} too faint here)`;
      li.append(letter, stars);
      legend.append(li);
    }
    for (const m of match.missing) {
      const li = document.createElement("li");
      li.className = "missing";
      li.textContent = `${m.char}: no room left in this sky`;
      legend.append(li);
    }
  }

  const alsoUp = bodies.filter((b) => b.kind === "moon" || (b.kind === "planet" && b.mag <= limitMag)).map((b) => (b.kind === "moon" ? `Moon (${Math.round(100 * (b.illuminated ?? 1))}% lit)` : b.name));
  if (alsoUp.length) {
    const li = document.createElement("li");
    li.className = "also";
    li.textContent = `Also in the sky: ${alsoUp.join(" · ")}`;
    legend.append(li);
  }

  // Animate the letters drawing in
  if (stillFrame) {
    progress = 1;
    draw();
    return;
  }
  progress = 0;
  const start = performance.now();
  const dur = 900 + 450 * (match?.letters.length ?? 0);
  const tick = (t: number) => {
    progress = Math.min(1, (t - start) / dur);
    draw();
    if (progress < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

// Matching runs on the server; the page only draws.
let inflight: AbortController | null = null;

function stopSearch() {
  inflight?.abort();
  inflight = null;
}

async function api<T>(path: string, query: Record<string, string | number>, signal: AbortSignal): Promise<T> {
  const qs = new URLSearchParams(Object.entries(query).map(([k, v]) => [k, String(v)]));
  const res = await fetch(`/api/${path}?${qs}`, { signal });
  // Anything but JSON (e.g. the site's own HTML) means the request never reached the API server.
  if (!res.headers.get("content-type")?.includes("application/json")) {
    throw new Error("the API server isn’t reachable");
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `server error ${res.status}`);
  }
  return res.json();
}

/** Runs `work` as the current request, replacing any earlier one. Handles cancel and errors. */
async function request(work: (signal: AbortSignal) => Promise<void>, onError: (message: string) => void) {
  stopSearch();
  const controller = (inflight = new AbortController());
  try {
    await work(controller.signal);
  } catch (err) {
    if (controller.signal.aborted) return;
    onError((err as Error).message);
  } finally {
    if (inflight === controller) inflight = null;
  }
}

/** On small screens the chart starts below the form; bring it into view once there's a result. */
function revealChart() {
  const fig = canvas.parentElement!;
  if (fig.getBoundingClientRect().top > window.innerHeight * 0.6) {
    fig.scrollIntoView({ behavior: stillFrame ? "auto" : "smooth", block: "start" });
  }
}

/** The exact moment in the date/time box. */
function showExact() {
  const [, lat, lon, timeZone] = currentPlace();
  if (!whenInput.value) whenInput.value = dateToWallTime(new Date(), timeZone);
  const when = wallTimeToDate(whenInput.value, timeZone);
  const name = drawableName();
  stopSearch();
  show(when, null, null);
  if (sunAlt > -0.83) {
    // Daylight: the stars are up there but can't be seen, so there's no name to draw.
    const dark = nextDark(when, lat, lon);
    const at = (d: Date) => d.toLocaleString(undefined, { hour: "numeric", minute: "2-digit", timeZone });
    status.textContent = `The Sun is up at ${at(when)}, so daylight hides the stars.` +
      (dark ? ` It’s dark enough from about ${at(dark)}. Press Find for the best time tonight.` : "");
    return;
  }
  if (!name) {
    status.textContent = "";
    return;
  }
  status.textContent = "Finding the name in this sky…";
  request(
    async (signal) => {
      const { match: found } = await api<{ match: NameMatch }>("match", { name, lat, lon, time: when.getTime(), sky: skyQuality() }, signal);
      status.textContent = "";
      show(when, found, null);
    },
    (message) => (status.textContent = `Couldn’t reach the server (${message}). Showing the sky without the name.`),
  );
}

/** Search the night that the date/time box falls in, from dusk to dawn. */
function findBestTime() {
  const name = drawableName();
  if (!name) return showExact();
  const [place, lat, lon, timeZone] = currentPlace();
  if (!whenInput.value) whenInput.value = dateToWallTime(new Date(), timeZone);

  // "Tonight" runs from local noon to noon: before noon still counts as last night.
  const [y, mo, d, h] = whenInput.value.split(/[-T:]/).map(Number);
  const day = new Date(Date.UTC(y, mo - 1, d - (h < 12 ? 1 : 0))).toISOString().slice(0, 10);
  const from = wallTimeToDate(`${day}T12:00`, timeZone);

  stopSearch();
  show(wallTimeToDate(whenInput.value, timeZone), null, null); // the sky, while we search
  status.textContent = `Searching the night sky over ${place}…`;
  request(
    async (signal) => {
      const result = await api<NightResult>("night", { name, lat, lon, from: from.getTime(), sky: skyQuality() }, signal);
      if (result.status === "no-night") {
        status.textContent = `It doesn’t get dark enough over ${place} that night for the stars to show.`;
        return;
      }
      const when = new Date(result.time);
      if (result.status === "scattered") {
        status.textContent = "Tonight’s sky can’t spell this name in order, so the letters are numbered.";
        show(when, result.match, null);
        revealChart();
        return;
      }
      const time = when.toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit", timeZone });
      status.textContent = "Change the time to see the sky at any other moment.";
      show(when, result.match, `“${name}” is clearest ${time} over ${place}`);
      revealChart();
    },
    (message) => (status.textContent = `The search failed (${message}). Please try again.`),
  );
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  findBestTime();
});
whenInput.addEventListener("change", showExact);
for (const input of skyInputs)
  input.addEventListener("change", () => {
    try {
      localStorage.setItem("sky", skyQuality());
    } catch {
      // storage unavailable: the choice still applies now
    }
    findBestTime();
  });
window.addEventListener("resize", draw);

locateBtn.addEventListener("click", () => {
  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      const { latitude: lat, longitude: lon } = pos.coords;
      // The nearest listed city gives the time zone (and a friendly label).
      let timeZone = BROWSER_TZ, label = "your location";
      try {
        const { place: near } = await (await fetch(`/api/places/near?lat=${lat}&lon=${lon}`)).json();
        timeZone = near.timeZone;
        label = `your location (near ${near.name})`;
      } catch {
        // keep the browser's time zone
      }
      picker.setLabel("My location");
      moveTo([label, lat, lon, timeZone]);
    },
    () => (locateBtn.textContent = "Location unavailable"),
  );
});

const params = new URLSearchParams(window.location.search);
const stillFrame = params.has("still") || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
if (params.get("name")) nameInput.value = params.get("name")!;
if (params.get("when")) whenInput.value = params.get("when")!;
const skyParam = params.get("sky");
if (isSkyQuality(skyParam)) skyInputs.forEach((i) => (i.checked = i.value === skyParam));

/** Starting place: exact spot from a shared link, a ?place= search, else the biggest city in the visitor's time zone. */
async function startingPlace(): Promise<Place> {
  const lat = Number(params.get("lat")), lon = Number(params.get("lon")), tz = params.get("tz");
  if (params.has("lat") && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && tz) {
    try {
      new Intl.DateTimeFormat("en", { timeZone: tz }); // throws on an unknown zone
      return [params.get("place") || "the shared place", lat, lon, tz];
    } catch {
      // bad time zone: fall through to searching
    }
  }
  try {
    const q = params.get("place");
    if (q) {
      const { places } = await (await fetch(`/api/places?q=${encodeURIComponent(q)}`)).json();
      if (places?.length) return fromApi(places[0]);
    }
    const res = await fetch(`/api/places/default?tz=${encodeURIComponent(BROWSER_TZ)}`);
    if (res.ok) return fromApi((await res.json()).place);
  } catch {
    // server unreachable: fall through
  }
  return FALLBACK_PLACE;
}

Promise.all([
  fetch(`${import.meta.env.BASE_URL}stars.json`).then((r) => r.json() as Promise<CatalogStar[]>),
  startingPlace(),
]).then(([data, start]) => {
  catalog = data;
  place = start;
  picker.setLabel(start[0]);
  // A link with an exact time shows that moment; otherwise find the best time tonight.
  if (params.get("when")) showExact();
  else findBestTime();
});
