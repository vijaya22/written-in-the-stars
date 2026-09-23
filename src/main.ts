import "./style.css";
import { visibleBodies, visibleSky, type CatalogStar, type SkyBody, type SkyStar } from "./astro.ts";
import { solarSystem } from "./ephemeris.ts";
import { matchName, type NameMatch } from "./matcher.ts";
import { darkTimes } from "./night.ts";
import type { NightRequest, NightStep } from "./night.worker.ts";
import { renderSky } from "./render.ts";

type Place = [label: string, lat: number, lon: number, timeZone: string];

const PLACES: Place[] = [
  ["Bengaluru", 12.97, 77.59, "Asia/Kolkata"],
  ["Mumbai", 19.08, 72.88, "Asia/Kolkata"],
  ["Delhi", 28.61, 77.21, "Asia/Kolkata"],
  ["London", 51.51, -0.13, "Europe/London"],
  ["New York", 40.71, -74.01, "America/New_York"],
  ["San Francisco", 37.77, -122.42, "America/Los_Angeles"],
  ["São Paulo", -23.55, -46.63, "America/Sao_Paulo"],
  ["Lagos", 6.52, 3.38, "Africa/Lagos"],
  ["Nairobi", -1.29, 36.82, "Africa/Nairobi"],
  ["Cairo", 30.04, 31.24, "Africa/Cairo"],
  ["Tokyo", 35.68, 139.69, "Asia/Tokyo"],
  ["Sydney", -33.87, 151.21, "Australia/Sydney"],
  ["Reykjavík", 64.15, -21.94, "Atlantic/Reykjavik"],
];

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;
const form = $<HTMLFormElement>("#form");
const nameInput = $<HTMLInputElement>("#name");
const placeSelect = $<HTMLSelectElement>("#place");
const whenInput = $<HTMLInputElement>("#when");
const locateBtn = $<HTMLButtonElement>("#locate");
const canvas = $<HTMLCanvasElement>("#sky");
const caption = $<HTMLElement>("#caption");
const legend = $<HTMLElement>("#legend");
const status = $<HTMLElement>("#status");

let catalog: CatalogStar[] = [];
let sky: SkyStar[] = [];
let bodies: SkyBody[] = [];
let match: NameMatch | null = null;
let progress = 1;
let custom: [number, number] | null = null;
let lastPlace: Place;

for (const [i, [label]] of PLACES.entries()) placeSelect.add(new Option(label, String(i)));

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
  if (placeSelect.value === "here" && custom) return ["your location", custom[0], custom[1], BROWSER_TZ];
  return PLACES[Number(placeSelect.value)];
}

function draw() {
  renderSky(canvas, { sky, bodies, match, progress });
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
  if (alt > 75) return "straight up";
  const az = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  return `face ${COMPASS[Math.round(az / 45) % 8]}, about ${Math.round(alt / 5) * 5}° up`;
}

/**
 * Show the sky at `when` with `found` letters. `found === undefined` matches
 * the name at that moment; `null` shows the sky alone (e.g. while searching).
 */
function show(when: Date, found: NameMatch | null | undefined, headline: string | null) {
  const [place, lat, lon, timeZone] = currentPlace();
  lastPlace = currentPlace();
  whenInput.value = dateToWallTime(when, timeZone);
  sky = visibleSky(catalog, when, lat, lon);
  // Same naked-eye limit as the star catalog: Uranus sometimes makes it, Neptune never does.
  bodies = visibleBodies(solarSystem(when), when, lat, lon).filter((b) => b.mag <= 6);
  const name = nameInput.value.trim();
  match = found !== undefined ? found : name ? matchName(name, sky) : null;

  const dateText = when.toLocaleString(undefined, { dateStyle: "long", timeStyle: "short", timeZone });
  caption.textContent = match?.letters.length
    ? `${headline ?? `“${name}” over ${place}, ${dateText}`} · ${lookDirection(match)}`
    : `The sky over ${place}, ${dateText}`;

  legend.replaceChildren();
  if (match) {
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

  const alsoUp = bodies.map((b) => (b.kind === "moon" ? `Moon (${Math.round(100 * (b.illuminated ?? 1))}% lit)` : b.name));
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

/** The exact moment in the date/time box. */
function showExact() {
  stopSearch();
  status.textContent = "";
  const timeZone = currentPlace()[3];
  if (!whenInput.value) whenInput.value = dateToWallTime(new Date(), timeZone);
  show(wallTimeToDate(whenInput.value, timeZone), undefined, null);
}

// Night search: the night is split across a few workers running in parallel.
let workers: Worker[] = [];
let searchId = 0;

function stopSearch() {
  workers.forEach((w) => w.terminate());
  workers = [];
  searchId++;
}

/** Try the name at each of `times` on the worker pool. */
function tryTimes(base: Omit<NightRequest, "times">, times: number[], onStep: () => void): Promise<NightStep[]> {
  return new Promise((resolve, reject) => {
    const results: NightStep[] = [];
    workers.forEach((w, i) => {
      w.onmessage = (e: MessageEvent<NightStep>) => {
        results.push(e.data);
        onStep();
        if (results.length === times.length) resolve(results);
      };
      w.onerror = (e) => reject(new Error(e.message || "worker error"));
      w.postMessage({ ...base, times: times.filter((_, j) => j % workers.length === i) } satisfies NightRequest);
    });
  });
}

const best = (steps: NightStep[]) => steps.reduce((a, b) => (b.rank < a.rank ? b : a));

/** Search the night that the date/time box falls in, from dusk to dawn. */
async function findBestTime() {
  const name = nameInput.value.trim();
  if (!name) return showExact();
  const [place, lat, lon, timeZone] = currentPlace();
  if (!whenInput.value) whenInput.value = dateToWallTime(new Date(), timeZone);

  // "Tonight" runs from local noon to noon: before noon still counts as last night.
  const [y, mo, d, h] = whenInput.value.split(/[-T:]/).map(Number);
  const day = new Date(Date.UTC(y, mo - 1, d - (h < 12 ? 1 : 0))).toISOString().slice(0, 10);
  const from = wallTimeToDate(`${day}T12:00`, timeZone);

  stopSearch();
  const id = searchId;
  show(wallTimeToDate(whenInput.value, timeZone), null, null); // the sky, while we search

  // Every 30 minutes through the dark hours, then a closer look around the best one.
  const dark = darkTimes(from, lat, lon, 30);
  if (dark.length === 0) {
    status.textContent = `It doesn’t get dark enough over ${place} that night for the stars to show. Showing the chosen time instead.`;
    show(wallTimeToDate(whenInput.value, timeZone), undefined, null);
    return;
  }
  const count = Math.max(1, Math.min(dark.length, (navigator.hardwareConcurrency || 4) - 1, 6));
  for (let i = 0; i < count; i++) workers.push(new Worker(new URL("./night.worker.ts", import.meta.url), { type: "module" }));

  const base = { catalog, name, lat, lon };
  const first = dark[0].date.getTime(), last = dark[dark.length - 1].date.getTime();
  let done = 0;
  const total = dark.length + 4;
  const onStep = () => (status.textContent = `Searching the night sky over ${place}… ${Math.round((100 * ++done) / total)}%`);
  onStep();
  done = 0;

  let pick: NightStep | null = null;
  try {
    const coarse = best(await tryTimes(base, dark.map((t) => t.date.getTime()), onStep));
    if (id !== searchId) return;
    if (coarse.rank < Infinity) {
      const near = [-20, -10, 10, 20].map((m) => coarse.time + m * 60000).filter((t) => t >= first && t <= last);
      pick = near.length ? best([coarse, ...(await tryTimes(base, near, onStep))]) : coarse;
    }
  } catch (err) {
    if (id !== searchId) return;
    stopSearch();
    status.textContent = `The search failed (${(err as Error).message}). Showing the chosen time instead.`;
    show(wallTimeToDate(whenInput.value, timeZone), undefined, null);
    return;
  }
  if (id !== searchId) return;
  stopSearch();

  if (!pick) {
    // Nothing fits in order all night: numbered letters at the darkest moment.
    const darkest = dark.reduce((a, b) => (b.sunAlt < a.sunAlt ? b : a)).date;
    status.textContent = "Tonight’s sky can’t spell this name in order, so the letters are numbered.";
    show(darkest, undefined, null);
    return;
  }
  const when = new Date(pick.time);
  const time = when.toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit", timeZone });
  status.textContent = "Change the time to see the sky at any other moment.";
  show(when, pick.match, `“${name}” is clearest ${time} over ${place}`);
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  findBestTime();
});
placeSelect.addEventListener("change", () => {
  // Keep the same instant, shown in the new place's local time, then search that night.
  const instant = wallTimeToDate(whenInput.value, lastPlace[3]);
  whenInput.value = dateToWallTime(instant, currentPlace()[3]);
  findBestTime();
});
whenInput.addEventListener("change", showExact);
window.addEventListener("resize", draw);

locateBtn.addEventListener("click", () => {
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      custom = [pos.coords.latitude, pos.coords.longitude];
      if (!placeSelect.querySelector('option[value="here"]')) placeSelect.add(new Option("My location", "here"), 0);
      placeSelect.value = "here";
      findBestTime();
    },
    () => (locateBtn.textContent = "Location unavailable"),
  );
});

const params = new URLSearchParams(window.location.search);
const stillFrame = params.has("still") || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
if (params.get("name")) nameInput.value = params.get("name")!;
if (params.get("place")) {
  const i = PLACES.findIndex(([p]) => p.toLowerCase() === params.get("place")!.toLowerCase());
  if (i >= 0) placeSelect.value = String(i);
}
if (params.get("when")) whenInput.value = params.get("when")!;

fetch(`${import.meta.env.BASE_URL}stars.json`)
  .then((r) => r.json())
  .then((data: CatalogStar[]) => {
    catalog = data;
    // A link with an exact time shows that moment; otherwise find the best time tonight.
    if (params.get("when")) showExact();
    else findBestTime();
  });
