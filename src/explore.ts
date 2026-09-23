// Exploring the result: hover or tap a letter to bring it forward; tap any star,
// planet or the Moon for a card of facts. The letter list offers the same with
// buttons, so it all works from the keyboard and with screen readers too.

import type { CatalogStar, SkyBody, SkyStar } from "./astro.ts";
import type { NameMatch } from "./matcher.ts";
import { chartGeometry } from "./render.ts";
import { starFacts } from "./star-facts.ts";

export interface ExploreState {
  catalog: CatalogStar[];
  sky: SkyStar[];
  bodies: SkyBody[];
  match: NameMatch | null;
  limitMag: number;
  skyLabel: string; // "a suburb"
}

interface Deps {
  canvas: HTMLCanvasElement;
  card: HTMLElement;
  state: () => ExploreState;
  redraw: () => void;
}

type Target =
  | { kind: "star"; star: SkyStar; letter: number | null }
  | { kind: "body"; body: SkyBody };

const HIT_STAR = 16; // px: generous, for fingers
const HIT_LETTER = 14;

function distToSegment(px: number, py: number, [ax, ay]: readonly number[], [bx, by]: readonly number[]) {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

export function createExplorer({ canvas, card, state, redraw }: Deps) {
  let pinned: number | null = null; // letter chosen by click/tap
  let hover: number | null = null; // letter under the mouse or keyboard focus
  let selected: Target | null = null;
  let returnFocus: HTMLElement | null = null;
  let pointerType = "mouse"; // of the latest press: touch taps work in two steps
  const letterButtons: HTMLButtonElement[] = [];

  const focusLetter = () => hover ?? pinned;

  function syncButtons() {
    letterButtons.forEach((b, i) => b.setAttribute("aria-pressed", String(pinned === i)));
  }

  function setHover(i: number | null) {
    if (hover === i) return;
    hover = i;
    redraw();
  }

  function togglePin(i: number) {
    pinned = pinned === i ? null : i;
    syncButtons();
    redraw();
  }

  // ------------------------------------------------------------------ hit tests

  function geometry() {
    return chartGeometry(canvas.clientWidth, state().match);
  }

  /** What's under a point on the canvas (CSS px): a star of the name first, then planets, then any star. */
  function targetAt(x: number, y: number): Target | null {
    const { px } = geometry();
    const { match, bodies, sky } = state();
    let best: Target | null = null, bestD = HIT_STAR;
    match?.letters.forEach((l, i) =>
      l.stars.forEach((s) => {
        const [sx, sy] = px(s);
        const d = Math.hypot(sx - x, sy - y);
        if (d < bestD) { bestD = d; best = { kind: "star", star: s, letter: i }; }
      }));
    if (best) return best;
    for (const b of bodies) {
      if (b.kind === "sun") continue;
      const [bx, by] = px(b);
      const d = Math.hypot(bx - x, by - y);
      if (d < bestD) { bestD = d; best = { kind: "body", body: b }; }
    }
    if (best) return best;
    bestD = HIT_STAR * 0.75;
    for (const s of sky) {
      const [sx, sy] = px(s);
      // Slightly favour brighter stars when two are close together.
      const d = Math.hypot(sx - x, sy - y) + Math.max(0, s.mag - 3);
      if (d < bestD) { bestD = d; best = { kind: "star", star: s, letter: null }; }
    }
    return best;
  }

  /** The letter whose strokes pass near a point, if any. */
  function letterAt(x: number, y: number): number | null {
    const { px } = geometry();
    let best: number | null = null, bestD = HIT_LETTER;
    state().match?.letters.forEach((l, i) => {
      for (const [a, b] of l.edges) {
        const d = distToSegment(x, y, px(l.stars[a]), px(l.stars[b]));
        if (d < bestD) { bestD = d; best = i; }
      }
    });
    return best;
  }

  // ------------------------------------------------------------------ the card

  function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string) {
    const e = document.createElement(tag);
    if (className) e.className = className;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function cardContent(t: Target): { title: string; sub: string; facts: string[] } {
    const { catalog, match, limitMag, skyLabel } = state();
    if (t.kind === "body") {
      const b = t.body;
      if (b.kind === "moon") {
        return {
          title: "The Moon",
          sub: `${Math.round(100 * (b.illuminated ?? 1))}% lit tonight`,
          facts: [
            "Our nearest neighbour, about 384,000 km away: its light takes just over a second to reach you.",
            "Moonlight brightens the whole sky, so fainter stars nearby may be harder to see.",
          ],
        };
      }
      const bright = b.mag < -1 ? "brighter than any star" : b.mag < 1 ? "as bright as the brightest stars" : "about as bright as a middling star";
      return {
        title: b.name,
        sub: "A planet",
        facts: [
          `Not a star: a planet in our own solar system, shining by reflected sunlight, ${bright} tonight.`,
          "Planets drift against the stars from night to night, so it won’t stay in this spot.",
          ...(b.mag > limitMag ? [`Likely too faint to see from ${skyLabel} tonight.`] : []),
        ],
      };
    }
    const f = starFacts(catalog, t.star.id);
    const letter = t.letter !== null && match ? match.letters[t.letter].char : null;
    const facts = [...f.facts];
    if (t.star.mag > limitMag) facts.push(`Likely too faint to see from ${skyLabel} tonight.`);
    return {
      title: f.name,
      sub: [f.where && f.where[0].toUpperCase() + f.where.slice(1), letter && `part of your “${letter}”`].filter(Boolean).join(" · "),
      facts,
    };
  }

  function open(t: Target, from: HTMLElement | null = null) {
    selected = t;
    returnFocus = from;
    const { title, sub, facts } = cardContent(t);
    const close = el("button", "card-close", "×");
    close.type = "button";
    close.setAttribute("aria-label", "Close");
    close.addEventListener("click", () => closeCard(true));
    const heading = el("h3", "", title);
    heading.id = "star-card-title";
    const list = el("ul", "");
    for (const fact of facts) list.append(el("li", "", fact));
    card.replaceChildren(close, heading, ...(sub ? [el("p", "card-sub", sub)] : []), list);
    card.hidden = false;
    place(t);
    redraw();
    if (from) close.focus(); // opened from the keyboard: move into the card
    keepInView(t);
  }

  /** Phones show the card as a sheet over the bottom of the screen: keep the chosen object above it. */
  function keepInView(t: Target) {
    if (!isSheet()) return;
    requestAnimationFrame(() => {
      const [, y] = geometry().px(t.kind === "star" ? t.star : t.body);
      const objectY = canvas.getBoundingClientRect().top + y;
      const room = window.innerHeight - card.offsetHeight - 24;
      if (objectY > room || objectY < 16) window.scrollBy({ top: objectY - Math.min(room, window.innerHeight / 3), behavior: "smooth" });
    });
  }

  const isSheet = () => matchMedia("(max-width: 560px)").matches;

  /** Beside the object on wide screens; small screens show the card as a sheet (CSS). */
  function place(t: Target) {
    if (isSheet()) {
      card.style.left = card.style.top = "";
      return;
    }
    const { px } = geometry();
    const [x, y] = px(t.kind === "star" ? t.star : t.body);
    const fig = card.offsetParent as HTMLElement;
    const ox = canvas.offsetLeft, oy = canvas.offsetTop;
    const w = card.offsetWidth, h = card.offsetHeight, gap = 16;
    const clampX = (v: number) => Math.max(8, Math.min(v, fig.clientWidth - w - 8));

    // Keep the name in view: put the card above or below the whole name if there's room.
    const pts = state().match?.letters.flatMap((l) => l.stars.map(px)) ?? [];
    if (pts.length) {
      const top = oy + Math.min(...pts.map(([, py]) => py)), bottom = oy + Math.max(...pts.map(([, py]) => py));
      const spot = top - gap - h >= 8 ? top - gap - h : bottom + gap + h <= fig.clientHeight - 8 ? bottom + gap : null;
      if (spot !== null) {
        card.style.left = `${clampX(ox + x - w / 2)}px`;
        card.style.top = `${spot}px`;
        return;
      }
    }
    // Otherwise beside the object: its right, or its left if that would run off the figure.
    let left = ox + x + 18;
    if (left + w > fig.clientWidth - 8) left = ox + x - 18 - w;
    card.style.left = `${clampX(left)}px`;
    card.style.top = `${Math.max(8, Math.min(oy + y - h / 2, fig.clientHeight - h - 8))}px`;
  }

  function closeCard(restoreFocus = false) {
    if (card.hidden && !selected) return;
    card.hidden = true;
    selected = null;
    redraw();
    if (restoreFocus) returnFocus?.focus();
    returnFocus = null;
  }

  // ------------------------------------------------------------------ events

  canvas.addEventListener("pointermove", (e) => {
    if (e.pointerType !== "mouse" || !state().match) return;
    const target = targetAt(e.offsetX, e.offsetY);
    const letter = target?.kind === "star" && target.letter !== null ? target.letter : letterAt(e.offsetX, e.offsetY);
    setHover(letter);
    canvas.style.cursor = target || letter !== null ? "pointer" : "";
  });
  canvas.addEventListener("pointerleave", () => {
    setHover(null);
    canvas.style.cursor = "";
  });
  canvas.addEventListener("pointerdown", (e) => (pointerType = e.pointerType));
  canvas.addEventListener("click", (e) => {
    const target = targetAt(e.offsetX, e.offsetY);
    const letter = target?.kind === "star" && target.letter !== null ? target.letter : letterAt(e.offsetX, e.offsetY);
    // Touch: the first tap on a letter just brings it forward (no card over it yet);
    // tapping one of its stars then opens that star. A mouse already highlights on hover.
    if (letter !== null && pinned !== letter && pointerType !== "mouse") {
      closeCard();
      togglePin(letter);
      return;
    }
    if (target) {
      if (letter !== null && pinned !== letter) togglePin(letter);
      open(target);
      return;
    }
    closeCard();
    if (letter !== null) togglePin(letter);
    else if (pinned !== null) togglePin(pinned);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !card.hidden) closeCard(true);
  });
  window.addEventListener("resize", () => {
    if (selected) place(selected);
  });

  return {
    focusLetter,
    selectedPoint: () => (selected ? (selected.kind === "star" ? selected.star : selected.body) : null),

    /** A new result: forget the old letter and card. */
    reset() {
      pinned = hover = null;
      letterButtons.length = 0;
      closeCard();
    },

    /** The letter in the list: hover/focus previews it on the chart, click keeps it highlighted. */
    letterButton(i: number, char: string) {
      const b = el("button", "letter", char);
      b.type = "button";
      b.setAttribute("aria-pressed", "false");
      b.setAttribute("aria-label", `Highlight the letter ${char}`);
      b.addEventListener("pointerenter", () => setHover(i));
      b.addEventListener("pointerleave", () => setHover(null));
      b.addEventListener("focus", () => setHover(i));
      b.addEventListener("blur", () => setHover(null));
      b.addEventListener("click", () => togglePin(i));
      letterButtons[i] = b;
      return b;
    },

    /** A star's name in the list: opens its card. */
    starButton(star: SkyStar, letter: number) {
      const b = el("button", "star-name", star.name);
      b.type = "button";
      b.addEventListener("click", () => open({ kind: "star", star, letter }, b));
      b.addEventListener("pointerenter", () => setHover(letter));
      b.addEventListener("pointerleave", () => setHover(null));
      return b;
    },
  };
}
