import { getStore } from "@netlify/blobs";

// Grenzen für plausible Läufe – bei Bedarf anpassen
const MAX_M = 60000; // Meter
const MAX_K = 2000;  // Wachen
const MAX_C = 3000;  // Münzen
const NAME_LEN = 14;
const TOP = 10;
const HEX = /^#[0-9a-f]{6}$/i;

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

const cleanName = (v) =>
  String(v ?? "").replace(/[<>&"]/g, "").replace(/\s+/g, " ").trim().slice(0, NAME_LEN);

const num = (v, max) => {
  const x = Math.floor(Number(v));
  return Number.isFinite(x) && x >= 0 && x <= max ? x : null;
};

// Bund: Flagge aus 3 Farben + Perkussion oben/unten
const cleanFlag = (f) =>
  Array.isArray(f) && f.length === 3 && f.every((c) => typeof c === "string" && HEX.test(c))
    ? f.map((c) => c.toLowerCase())
    : null;
const okPerc = (v) => v === "none" || v === "gold" || v === "silver" || (typeof v === "string" && HEX.test(v));
const cleanPerc = (p) => ({
  t: okPerc(p?.t) ? p.t : "none",
  b: okPerc(p?.b) ? p.b : "none",
});


// ---- Namensfilter --------------------------------------------------------
// Die Listen sind bewusst kurz und lassen sich unten beliebig erweitern.
// Geprüft wird nach Normalisierung (Groß-/Kleinschreibung, Umlaute, Leetspeak wie "n4zi").
const BLOCK_SUBSTR = [ // unmissverständlich, wird auch mitten im Namen erkannt
  "nigger", "nigga", "hurensohn", "schwuchtel", "wichser", "fotze", "kanake",
  "arschloch", "hitler", "heilhitler", "siegheil",
];
const BLOCK_PREFIX = ["arsch", "schwul", "spast", "scheiss"]; // Wortanfang, z. B. "Arschgeige"
const BLOCK_EQUALS = [ // nur als ganzes Wort, damit z. B. "Nazim" oder "Minute" erlaubt bleiben
  "fick", "ficker", "ficken", "fickt", "gay", "homo", "nazi", "nazis", "hure", "huren",
  "nutte", "nutten", "spasti", "penis", "pimmel", "titten", "pussy", "schlampe", "neger",
];
// Eigene Namen oder Personen, die nicht in der Liste auftauchen sollen (ohne Leerzeichen,
// Kleinbuchstaben, ohne Umlaute), z. B. ["maxmustermann"]
const PROTECTED = [];

const LEET = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", "$": "s", "!": "i", "|": "i" };
const normalize = (s) =>
  String(s ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ß/g, "ss")
    .replace(/[0134578@$!|]/g, (ch) => LEET[ch]);

export function isBlocked(name) {
  const tokens = normalize(name).split(/[^a-z]+/).filter(Boolean);
  const joined = tokens.join("");
  if (BLOCK_SUBSTR.some((w) => joined.includes(w))) return true;
  if (PROTECTED.some((w) => joined.includes(w))) return true;
  return tokens.some((t) => BLOCK_EQUALS.includes(t) || BLOCK_PREFIX.some((w) => t.startsWith(w)));
}

const better = (a, b) => b.m - a.m || b.k - a.k || b.c - a.c;
const keyOf = (name) => Buffer.from(name.toLowerCase()).toString("hex");

async function loadAll(store) {
  const { blobs } = await store.list();
  const entries = await Promise.all(
    blobs.slice(0, 1000).map((b) => store.get(b.key, { type: "json" }).catch(() => null))
  );
  return entries.filter((e) => e && typeof e.n === "string" && !isBlocked(e.n)).sort(better);
}

export async function handle(req, store) {
  if (req.method === "GET") {
    const all = await loadAll(store);
    return json({
      top: all.slice(0, TOP).map(({ n, m, k, c, f, p }) => ({ n, m, k, c, f, p })),
      total: all.length,
    });
  }

  if (req.method === "POST") {
    const raw = await req.text();
    if (raw.length > 2000) return json({ error: "too large" }, 413);
    let b;
    try {
      b = JSON.parse(raw);
    } catch {
      return json({ error: "bad json" }, 400);
    }
    const n = cleanName(b?.n);
    if (n && isBlocked(n)) return json({ error: "name" }, 400);
    const m = num(b?.m, MAX_M);
    const k = num(b?.k, MAX_K);
    const c = num(b?.c, MAX_C);
    if (!n || n.toLowerCase() === "anonym" || m === null || k === null || c === null) {
      return json({ error: "invalid" }, 400);
    }
    const f = cleanFlag(b?.f);
    const p = cleanPerc(b?.p);

    const key = keyOf(n);
    const old = await store.get(key, { type: "json" });
    let changed = false;
    if (!old || m > old.m) {
      await store.setJSON(key, { n, m, k, c, f, p, t: Date.now() });
      changed = true;
    } else if (f) {
      // Rekord bleibt, aber der Bund (Flagge) darf sich ändern
      await store.setJSON(key, { ...old, f, p });
    }
    const all = await loadAll(store);
    const i = all.findIndex((e) => e.n.toLowerCase() === n.toLowerCase());
    return json({ ok: true, changed, rank: i + 1, total: all.length });
  }

  return json({ error: "method not allowed" }, 405);
}

export default async (req) =>
  handle(req, getStore({ name: "leaderboard", consistency: "strong" }));

export const config = { path: "/api/scores" };
