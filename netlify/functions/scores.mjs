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

const better = (a, b) => b.m - a.m || b.k - a.k || b.c - a.c;
const keyOf = (name) => Buffer.from(name.toLowerCase()).toString("hex");

async function loadAll(store) {
  const { blobs } = await store.list();
  const entries = await Promise.all(
    blobs.slice(0, 1000).map((b) => store.get(b.key, { type: "json" }).catch(() => null))
  );
  return entries.filter((e) => e && typeof e.n === "string").sort(better);
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
