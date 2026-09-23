// How dark the viewer's sky is, and how much of the sky that shows.

export type SkyQuality = "city" | "suburb" | "dark";

/** Faintest star visible to the naked eye under each sky (magnitude). */
export const SKY_LIMIT: Record<SkyQuality, number> = { city: 3.5, suburb: 4.5, dark: 6 };

export const SKY_LABEL: Record<SkyQuality, string> = { city: "a city", suburb: "a suburb", dark: "a dark sky" };

export const isSkyQuality = (v: unknown): v is SkyQuality => v === "city" || v === "suburb" || v === "dark";

/**
 * Faintest star visible with the Sun at `sunAlt` degrees: none in daylight,
 * the brightest few in civil twilight, most by the end of nautical twilight.
 */
export function twilightLimit(sunAlt: number): number {
  if (sunAlt > -0.83) return -3.5; // Sun up: stars hidden (only the Moon and Venus show)
  if (sunAlt > -6) return 1.5;
  if (sunAlt > -12) return 3.5;
  return 6; // dark: the same threshold the night search uses, so shared times look the same
}
