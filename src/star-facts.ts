// Plain-language facts about a star, worked out from the catalog: where it is,
// how far, what kind of star, how bright. No hand-written text to maintain.

import type { CatalogStar } from "./astro.ts";

const CONSTELLATIONS: Record<string, string> = {
  And: "Andromeda", Ant: "Antlia", Aps: "Apus", Aqr: "Aquarius", Aql: "Aquila", Ara: "Ara", Ari: "Aries",
  Aur: "Auriga", Boo: "Boötes", Cae: "Caelum", Cam: "Camelopardalis", Cnc: "Cancer", CVn: "Canes Venatici",
  CMa: "Canis Major", CMi: "Canis Minor", Cap: "Capricornus", Car: "Carina", Cas: "Cassiopeia",
  Cen: "Centaurus", Cep: "Cepheus", Cet: "Cetus", Cha: "Chamaeleon", Cir: "Circinus", Col: "Columba",
  Com: "Coma Berenices", CrA: "Corona Australis", CrB: "Corona Borealis", Crv: "Corvus", Crt: "Crater",
  Cru: "Crux (the Southern Cross)", Cyg: "Cygnus", Del: "Delphinus", Dor: "Dorado", Dra: "Draco",
  Equ: "Equuleus", Eri: "Eridanus", For: "Fornax", Gem: "Gemini", Gru: "Grus", Her: "Hercules",
  Hor: "Horologium", Hya: "Hydra", Hyi: "Hydrus", Ind: "Indus", Lac: "Lacerta", Leo: "Leo",
  LMi: "Leo Minor", Lep: "Lepus", Lib: "Libra", Lup: "Lupus", Lyn: "Lynx", Lyr: "Lyra", Men: "Mensa",
  Mic: "Microscopium", Mon: "Monoceros", Mus: "Musca", Nor: "Norma", Oct: "Octans", Oph: "Ophiuchus",
  Ori: "Orion", Pav: "Pavo", Peg: "Pegasus", Per: "Perseus", Phe: "Phoenix", Pic: "Pictor", Psc: "Pisces",
  PsA: "Piscis Austrinus", Pup: "Puppis", Pyx: "Pyxis", Ret: "Reticulum", Sge: "Sagitta",
  Sgr: "Sagittarius", Sco: "Scorpius", Scl: "Sculptor", Sct: "Scutum", Ser: "Serpens", Sex: "Sextans",
  Tau: "Taurus", Tel: "Telescopium", Tri: "Triangulum", TrA: "Triangulum Australe", Tuc: "Tucana",
  UMa: "Ursa Major (the Great Bear)", UMi: "Ursa Minor (the Little Bear)", Vel: "Vela", Vir: "Virgo",
  Vol: "Volans", Vul: "Vulpecula",
};

// Surface temperature (K) at subclass 0 and 9 of each spectral class, and the class's colour.
const CLASSES: Record<string, [number, number, string]> = {
  O: [45000, 31000, "blue"], B: [30000, 10500, "blue-white"], A: [9700, 7400, "white"],
  F: [7200, 6100, "yellow-white"], G: [5900, 5300, "yellow"], K: [5200, 3900, "orange"], M: [3800, 2400, "red"],
};

/**
 * Temperature (°C) and colour: from the spectral type when the catalog has one
 * (reliable for hot stars), else from the B-V colour index (Ballesteros 2012).
 */
function temperatureAndColour(spectrum: string, ci: number): [number, string] {
  const m = spectrum.match(/^([OBAFGKM])([0-9.]*)/);
  if (m) {
    const [hot, cool, colour] = CLASSES[m[1]];
    const sub = Math.min(9, Number(m[2] || 5));
    return [hot + ((cool - hot) * sub) / 9 - 273, colour];
  }
  const kelvin = 4600 * (1 / (0.92 * ci + 1.7) + 1 / (0.92 * ci + 0.62));
  const colour = ci < 0 ? "blue-white" : ci < 0.3 ? "white" : ci < 0.6 ? "yellow-white" : ci < 0.8 ? "yellow" : ci < 1.4 ? "orange" : "red";
  return [kelvin - 273, colour];
}

/** Luminosity class from the spectral type: "M2Ib" → supergiant, "G2V" → like the Sun. */
function kind(spectrum: string): string | null {
  if (/^D/.test(spectrum)) return "white dwarf";
  const m = spectrum.match(/^[OBAFGKMC][0-9.:]*[-/0-9.:]*\s*(Ia|Iab|Ib|III|II|IV|V|I)(?![IV])/);
  if (!m) return null;
  return { Ia: "supergiant", Iab: "supergiant", Ib: "supergiant", I: "supergiant", II: "bright giant", III: "giant", IV: "subgiant", V: "dwarf" }[m[1]] ?? null;
}

const round = (n: number, step: number) => Math.round(n / step) * step;
const ordinal = (n: number) => `${n}${["th", "st", "nd", "rd"][((n % 100) - 20) % 10] ?? ["th", "st", "nd", "rd"][n % 100] ?? "th"}`;

function times(n: number): string {
  if (n >= 1000) return `${round(n, n >= 10000 ? 1000 : 100).toLocaleString("en")}×`;
  if (n >= 10) return `${Math.round(n)}×`;
  return `${Number(n.toPrecision(2))}×`;
}

export interface StarFacts {
  name: string;
  where: string; // "in Orion"
  facts: string[];
}

/**
 * Facts for catalog star `id` (the catalog is sorted brightest first, so the
 * index is the brightness rank). `now` sets the "light left it in…" year.
 */
export function starFacts(catalog: CatalogStar[], id: number, now = new Date()): StarFacts {
  const [, , mag, ci, name, ly, con, spectrum, lum] = catalog[id];
  const facts: string[] = [];

  if (ly !== null) {
    const year = now.getFullYear() - ly;
    const away = ly < 20 ? `${ly} light-years away` : `About ${round(ly, ly < 200 ? 5 : 10).toLocaleString("en")} light-years away`;
    facts.push(year > 0
      ? `${away}: the light you see tonight left it around ${year < 1000 ? `the year ${year}` : round(year, ly < 200 ? 1 : 10)}.`
      : `${away}: the light you see tonight left it more than ${round(ly, 100).toLocaleString("en")} years ago.`);
  }

  const k = kind(spectrum);
  const [celsius, colour] = temperatureAndColour(spectrum, ci);
  const temp = round(celsius, celsius > 20000 ? 1000 : 100).toLocaleString("en");
  const a = /^[aeiou]/.test(colour) ? "An" : "A";
  const type = k === "dwarf"
    ? `${a} ${colour} star in the steady middle of its life, as the Sun is`
    : k ? `${a} ${colour} ${k}` : `${a} ${colour} star`;
  facts.push(`${type}, about ${temp} °C at the surface (the Sun is about 5,500 °C).`);

  if (lum !== null && lum >= 2) facts.push(`Gives out ${times(lum)} as much light as the Sun.`);
  else if (lum !== null && lum <= 0.5) facts.push(`Gives out only ${Math.round(lum * 100)}% of the Sun’s light.`);

  const rank = id + 1;
  if (rank === 1) facts.push("The brightest star in the night sky.");
  else if (rank <= 100) facts.push(`The ${ordinal(rank)} brightest star in the night sky.`);
  else if (mag <= 4) facts.push("Bright enough to see from most suburbs on a clear night.");

  return { name, where: CONSTELLATIONS[con] ? `in ${CONSTELLATIONS[con]}` : "", facts };
}
