// Converts the HYG v4.1 catalog (data/hygdata_v41.csv) into a compact
// public/stars.json containing naked-eye stars only.
//
// Download the catalog first:
//   curl -L -o data/hygdata_v41.csv \
//     https://raw.githubusercontent.com/astronexus/HYG-Database/main/hyg/CURRENT/hygdata_v41.csv
//
// HYG is licensed CC BY-SA 4.0 (https://github.com/astronexus/HYG-Database).

import { readFileSync, writeFileSync } from "node:fs";

const MAG_LIMIT = 6.0;

const GREEK = {
  Alp: "α", Bet: "β", Gam: "γ", Del: "δ", Eps: "ε", Zet: "ζ", Eta: "η", The: "θ",
  Iot: "ι", Kap: "κ", Lam: "λ", Mu: "μ", Nu: "ν", Xi: "ξ", Omi: "ο", Pi: "π",
  Rho: "ρ", Sig: "σ", Tau: "τ", Ups: "υ", Phi: "φ", Chi: "χ", Psi: "ψ", Ome: "ω",
};

function parseLine(line) {
  const out = [];
  let cur = "";
  let quoted = false;
  for (const ch of line) {
    if (ch === '"') quoted = !quoted;
    else if (ch === "," && !quoted) { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

function displayName(r) {
  if (r.proper) return r.proper;
  if (r.bayer) {
    const m = r.bayer.match(/^([A-Za-z]+)(-?\d*)$/);
    const greek = m && GREEK[m[1]];
    if (greek) return `${greek}${m[2] ? m[2].replace("-", "") : ""} ${r.con}`;
  }
  if (r.flam) return `${r.flam} ${r.con}`;
  if (r.hip) return `HIP ${r.hip}`;
  return `HD ${r.hd}`;
}

const lines = readFileSync("data/hygdata_v41.csv", "utf8").split("\n");
const header = parseLine(lines[0]);
const col = Object.fromEntries(header.map((h, i) => [h, i]));

const stars = [];
for (const line of lines.slice(1)) {
  if (!line) continue;
  const f = parseLine(line);
  const r = Object.fromEntries(Object.keys(col).map((k) => [k, f[col[k]]]));
  if (r.id === "0") continue; // the Sun
  const mag = Number(r.mag);
  if (!(mag <= MAG_LIMIT)) continue;
  stars.push([
    Number(Number(r.ra).toFixed(5)),   // right ascension, hours (J2000)
    Number(Number(r.dec).toFixed(4)),  // declination, degrees (J2000)
    Number(mag.toFixed(2)),            // apparent magnitude
    r.ci === "" ? 0.6 : Number(Number(r.ci).toFixed(2)), // B-V color index
    displayName(r),
  ]);
}

stars.sort((a, b) => a[2] - b[2]);
writeFileSync("public/stars.json", JSON.stringify(stars));
console.log(`wrote ${stars.length} stars (mag <= ${MAG_LIMIT}) to public/stars.json`);
