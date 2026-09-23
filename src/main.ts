import "./style.css";
import { visibleBodies, visibleSky, type CatalogStar, type SkyBody, type SkyStar } from "./astro.ts";
import { solarSystem } from "./ephemeris.ts";
import { matchName, type NameMatch } from "./matcher.ts";
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

function run() {
  const [place, lat, lon, timeZone] = currentPlace();
  if (!whenInput.value) whenInput.value = dateToWallTime(new Date(), timeZone);
  const when = wallTimeToDate(whenInput.value, timeZone);
  lastPlace = currentPlace();
  sky = visibleSky(catalog, when, lat, lon);
  // Same naked-eye limit as the star catalog: Uranus sometimes makes it, Neptune never does.
  bodies = visibleBodies(solarSystem(when), when, lat, lon).filter((b) => b.mag <= 6);
  const name = nameInput.value.trim();
  match = name ? matchName(name, sky) : null;

  const dateText = when.toLocaleString(undefined, { dateStyle: "long", timeStyle: "short", timeZone });
  caption.textContent = match
    ? `“${name}” in the sky over ${place}, ${dateText}`
    : `The sky over ${place}, ${dateText}`;

  legend.replaceChildren();
  if (match) {
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
      li.textContent = `${m.char}: no room left in tonight's sky`;
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

form.addEventListener("submit", (e) => {
  e.preventDefault();
  run();
});
placeSelect.addEventListener("change", () => {
  // Keep the same instant, shown in the new place's local time.
  const instant = wallTimeToDate(whenInput.value, lastPlace[3]);
  whenInput.value = dateToWallTime(instant, currentPlace()[3]);
  run();
});
whenInput.addEventListener("change", run);
window.addEventListener("resize", draw);

locateBtn.addEventListener("click", () => {
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      custom = [pos.coords.latitude, pos.coords.longitude];
      if (!placeSelect.querySelector('option[value="here"]')) placeSelect.add(new Option("My location", "here"), 0);
      placeSelect.value = "here";
      run();
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
    run();
  });
