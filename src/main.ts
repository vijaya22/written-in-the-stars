import "./style.css";
import { visibleBodies, visibleSky, type CatalogStar, type SkyBody, type SkyStar } from "./astro.ts";
import { solarSystem } from "./ephemeris.ts";
import { normalizeName, unsupportedChars, type NameMatch } from "./matcher.ts";
import { GLYPHS } from "./glyphs.ts";
import { nextDark, sunAltitude, type NightResult } from "./night.ts";
import { isSkyQuality, SKY_LABEL, SKY_LIMIT, twilightLimit, type SkyQuality } from "./sky.ts";
import { createPlacePicker, placeLabel, type ApiPlace } from "./place-picker.ts";
import { renderSky } from "./render.ts";
import { createExplorer } from "./explore.ts";
import { imageText as describeImage, lookDirection } from "./describe.ts";
import { dateToWallTime, wallTimeToDate } from "./time.ts";
import { composeImage, download, isPosterSize, POSTER_SIZES, THEME_LABELS, toBlob, type ImageFormat } from "./share.ts";
import { isThemeName, PALETTES } from "./render.ts";

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
const skySummary = $<HTMLElement>("#sky-summary");
const exploreHint = $<HTMLElement>("#explore-hint");

const SKY_WORD: Record<SkyQuality, string> = { city: "city sky", suburb: "suburban sky", dark: "dark sky" };

/** One line under "Choose my sky": where, when and how dark, so the options can stay folded away. */
function updateSkySummary(when: Date) {
  const [label, , , timeZone] = currentPlace();
  const time = when.toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone });
  skySummary.textContent = `${label} · ${time} · ${SKY_WORD[skyQuality()]}`;
}
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

const explorer = createExplorer({
  canvas,
  card: $<HTMLElement>("#star-card"),
  state: () => ({ catalog, sky, bodies, match, limitMag, skyLabel: SKY_LABEL[skyQuality()] }),
  redraw: () => draw(),
});

function draw() {
  renderSky(canvas, { sky, bodies, match, progress, sunAlt, limitMag, focusLetter: explorer.focusLetter(), selected: explorer.selectedPoint() });
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
  return describeImage(shown?.name ?? "", label, shown!.when, timeZone, match!);
}

const slug = () => (shown?.name ?? "sky").toLowerCase().replace(/[^a-z0-9]+/g, "-");

const browserCanvas = (w: number, h: number) => {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
};

function drawImage(format: ImageFormat, theme = "midnight" as keyof typeof PALETTES) {
  return composeImage({ sky, bodies, match, progress: 1, sunAlt, limitMag }, imageText(), format, { theme, createCanvas: browserCanvas });
}

const makeCard = () => toBlob(drawImage("card"));

$<HTMLButtonElement>("#share-btn").addEventListener("click", async () => {
  const data = { title: imageText().title, text: `${imageText().title} over ${currentPlace()[0]}`, url: location.href };
  try {
    const file = new File([await makeCard()], `${slug()}-in-the-stars.png`, { type: "image/png" });
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

$<HTMLButtonElement>("#save-card").addEventListener("click", async () => {
  download(await makeCard(), `${slug()}-in-the-stars.png`);
});

// Poster: pick a size and style, preview it here; the print PDF is drawn by the server.
const posterDialog = $<HTMLDialogElement>("#poster-dialog");
const posterSize = $<HTMLSelectElement>("#poster-size");
const posterPreview = $<HTMLElement>("#poster-preview");
const posterLink = $<HTMLAnchorElement>("#poster-download");
const themeInputs = () => [...document.querySelectorAll<HTMLInputElement>('input[name="poster-theme"]')];

for (const [key, { label }] of Object.entries(POSTER_SIZES)) posterSize.add(new Option(label, key));
$<HTMLElement>("#poster-themes").replaceChildren(
  ...Object.entries(THEME_LABELS).map(([key, label], i) => {
    const l = document.createElement("label");
    l.innerHTML = `<input type="radio" name="poster-theme" value="${key}"${i === 0 ? " checked" : ""} /> `;
    l.append(label);
    return l;
  }),
);

function updatePoster() {
  const size = posterSize.value;
  const theme = themeInputs().find((i) => i.checked)?.value;
  if (!isPosterSize(size) || !isThemeName(theme)) return;
  const preview = drawImage(size, theme);
  preview.setAttribute("aria-label", `Preview of the ${THEME_LABELS[theme]} poster`);
  posterPreview.replaceChildren(preview);
  posterLink.href = `/poster.pdf${location.search}&size=${size}&theme=${theme}`;
  posterLink.download = `${slug()}-in-the-stars-${size}-${theme}.pdf`;
}

posterSize.addEventListener("change", updatePoster);
$<HTMLElement>("#poster-themes").addEventListener("change", updatePoster);
$<HTMLButtonElement>("#save-poster").addEventListener("click", () => {
  updatePoster();
  posterDialog.showModal();
});
$<HTMLButtonElement>("#poster-close").addEventListener("click", () => posterDialog.close());

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
  explorer.reset();
  exploreHint.hidden = !match?.letters.length;
  shown = { when, name };
  updateSkySummary(when);
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
    // Estimates only: weather, haze, moonlight and nearby lights all hide stars.
    const moon = bodies.find((b) => b.kind === "moon" && (b.illuminated ?? 0) > 0.5);
    const moonNote = moon ? " Tonight’s bright Moon may hide more." : "";
    if (all.length) {
      const li = document.createElement("li");
      li.className = "note";
      if (sunAlt > -12) {
        li.textContent = `In twilight only about ${seen} of the ${all.length} stars in this name may show yet; more appear as the sky darkens.`;
      } else if (seen < all.length) {
        li.textContent = `About ${seen} of the ${all.length} stars in this name may be visible from ${SKY_LABEL[skyQuality()]} on a clear night. ` +
          `The dashed rings are likely too faint there; weather and nearby lights can hide more.${moonNote}`;
      } else {
        li.textContent = `All ${all.length} stars in this name should be visible from ${SKY_LABEL[skyQuality()]} on a clear night, ` +
          `though weather and nearby lights can hide some.${moonNote}`;
      }
      legend.append(li);
    }
    if (match.layout === "scattered" && match.letters.length > 1) {
      const li = document.createElement("li");
      li.className = "note";
      li.textContent = "This sky can’t fit the name in one line, so the letters are numbered in reading order.";
      legend.append(li);
    }
    match.letters.forEach((l, i) => {
      const li = document.createElement("li");
      // Each star once, brightest first; each name opens that star's card.
      const unique = [...new Map([...l.stars].sort((a, b) => a.mag - b.mag).map((s) => [s.id, s])).values()];
      const stars = document.createElement("span");
      stars.className = "stars";
      unique.forEach((s, j) => {
        if (j) stars.append(" · ");
        stars.append(explorer.starButton(s, i));
      });
      const hidden = l.stars.filter((s) => s.mag > limitMag).length;
      if (hidden) stars.append(` (${hidden} likely too faint here)`);
      li.append(explorer.letterButton(i, l.char), stars);
      legend.append(li);
    });
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
  const { top } = status.getBoundingClientRect();
  const { bottom } = canvas.getBoundingClientRect();
  // The explanation line, chart and caption are sized to fit one screen: scroll only if they don't show.
  if (top < 0 || bottom > window.innerHeight) {
    status.scrollIntoView({ behavior: stillFrame ? "auto" : "smooth", block: "start" });
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

  const asked = wallTimeToDate(whenInput.value, timeZone);
  const askedInDaylight = sunAltitude(asked, lat, lon) > -0.83;
  const clock = (d: Date) => d.toLocaleString(undefined, { hour: "numeric", minute: "2-digit", timeZone });

  stopSearch();
  show(asked, null, null); // the sky, while we search
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
        status.textContent = `Tonight’s sky can’t spell this name in order at any hour, so the letters are numbered. ` +
          `This is the darkest moment, ${clock(when)}.`;
        show(when, result.match, null);
        revealChart();
        return;
      }
      const time = when.toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit", timeZone });
      // Say why the time moved, so it reads as a choice rather than a glitch.
      const minutes = (when.getTime() - asked.getTime()) / 60000;
      const dayOf = (d: Date) => dateToWallTime(d, timeZone).slice(0, 10);
      const moment = dayOf(when) > dayOf(asked) ? "early tomorrow morning"
        : dayOf(when) < dayOf(asked) ? "earlier in the night"
        : minutes > 0 ? "later tonight" : "earlier tonight";
      status.textContent = askedInDaylight
        ? `It’s still light at ${clock(asked)}, so we found the clearest arrangement after dark, at ${clock(when)}.`
        : Math.abs(minutes) <= 20
          ? `This is the clearest arrangement tonight.`
          : `We found the clearest arrangement ${moment}, at ${clock(when)}.`;
      status.textContent += " Other times are under “Choose my sky”.";
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
