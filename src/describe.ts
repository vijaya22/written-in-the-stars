// Words for a result: where to look, what the image says. Shared by the page and
// the server (link previews, posters) so they always agree.

import type { NameMatch } from "./matcher.ts";
import type { ImageText } from "./share.ts";

const COMPASS = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"];

/** Where to look for the name: average direction of its stars. */
export function lookDirection(m: NameMatch): string {
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

/** The named stars of each letter, brightest first. */
export function letterStars(m: NameMatch): { char: string; stars: string }[] {
  return m.letters.map((l) => ({
    char: l.char,
    stars: [...new Set([...l.stars].sort((a, b) => a.mag - b.mag).map((s) => s.name))].join(" · "),
  }));
}

/** Title and caption lines for an image of `name` over `placeLabel` at `when`. */
export function imageText(name: string, placeLabel: string, when: Date, timeZone: string, m: NameMatch): ImageText {
  const date = when.toLocaleString("en-GB", { dateStyle: "long", timeStyle: "short", timeZone });
  const look = lookDirection(m);
  const lookLine = look[0].toUpperCase() + look.slice(1);
  return {
    title: `“${name}” written in the stars`,
    lines: [`${placeLabel} · ${date}`, lookLine],
    posterLines: [date, lookLine],
    letters: letterStars(m),
    credit: "Real star positions: HYG database (CC BY-SA 4.0) · stars.vijaya.io",
  };
}
