// Builds server/data/places.json from GeoNames (CC BY 4.0, https://www.geonames.org):
// every city with population > 15,000, with its IANA timezone.
//
// Download into data/ first:
//   curl -L -o data/cities15000.zip https://download.geonames.org/export/dump/cities15000.zip && unzip -o data/cities15000.zip -d data
//   curl -L -o data/admin1CodesASCII.txt https://download.geonames.org/export/dump/admin1CodesASCII.txt
//   curl -L -o data/countryInfo.txt https://download.geonames.org/export/dump/countryInfo.txt

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const rows = (file) =>
  readFileSync(`data/${file}`, "utf8").split("\n").filter((l) => l && !l.startsWith("#")).map((l) => l.split("\t"));

const countries = new Map(rows("countryInfo.txt").map((f) => [f[0], f[4]]));
const regions = new Map(rows("admin1CodesASCII.txt").map((f) => [f[0], f[1]]));

/** Lower-case, accent-free form used for matching ("St. Louis" → "saint louis"). Keep in sync with server/places.ts. */
const key = (s) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[.'’]/g, "").replace(/\bst\b/g, "saint").replace(/\s+/g, " ").trim();

const timeZones = [];
const tzIndex = new Map();
const places = [];

for (const f of rows("cities15000.txt")) {
  const [, name, ascii, alternates, lat, lon, , , cc, , admin1, , , , population, , , tz] = f;
  if (!tz) continue;
  if (!tzIndex.has(tz)) { tzIndex.set(tz, timeZones.length); timeZones.push(tz); }
  const pop = Number(population);

  const own = new Set([key(name), key(ascii)]);
  // Other names people type, e.g. "Bangalore", "Bombay", "München": Latin script, bigger places.
  const others = new Set();
  if (pop >= 100000) {
    for (const alt of alternates.split(",")) {
      if (others.size >= 8) break;
      const k = key(alt);
      if (/^\p{Script=Latin}[\p{Script=Latin} .'-]{2,29}$/u.test(alt) && !/^[A-Z]{2,4}$/.test(alt) && !own.has(k)) others.add(k);
    }
  }

  places.push([
    name,
    regions.get(`${cc}.${admin1}`) ?? "",
    countries.get(cc) ?? cc,
    Number(Number(lat).toFixed(3)),
    Number(Number(lon).toFixed(3)),
    tzIndex.get(tz),
    pop,
    `${[...own].join("|")};${[...others].join("|")}`, // own names ; other names
  ]);
}

places.sort((a, b) => b[6] - a[6]); // biggest first: searches return them first
mkdirSync("server/data", { recursive: true });
writeFileSync("server/data/places.json", JSON.stringify({ timeZones, places }));
console.log(`wrote ${places.length} places, ${timeZones.length} time zones to server/data/places.json`);
