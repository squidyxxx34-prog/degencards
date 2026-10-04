// DEGENCARDS — fine-chart
// Every chart should read like a lively one: ~32 candles, none flat. When GeckoTerminal's minute candles around a trade are
// mostly empty (chart.coarse, set by the compact_chart trigger), the real swaps are read straight from the coin's pool on
// chain (Helius) and grouped into ~32 candles of consecutive swaps — each candle is real trading, quiet minutes take no room.
// Saved as { src: "chain", fine: 1 } with chart_tries = 8: the minute-chart cron and the trigger then leave it alone.
// Only the signed-in user's own trades. Never fabricates: not enough real swaps -> the minute chart stays.
import { createClient } from "jsr:@supabase/supabase-js@2";

const db = createClient(Deno.env.get("SUPABASE_URL") || "http://x", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "x", { auth: { persistSession: false, autoRefreshToken: false } });
const HELIUS = Deno.env.get("HELIUS_API_KEY") || "";
const RPC = HELIUS ? `https://mainnet.helius-rpc.com/?api-key=${HELIUS}` : "https://api.mainnet-beta.solana.com";
const ORIGIN = "https://degencards.vercel.app";
const WSOL = "So11111111111111111111111111111111111111112";
const USD_MINTS = new Set(["EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB"]);
const B58 = /^[1-9A-HJ-NP-Za-km-z]{32,88}$/;
const N = 32, MAX_READS = HELIUS ? 220 : 70, PER_S = HELIUS ? 9 : 3;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function rpc(method: string, params: unknown[]): Promise<any> {
  for (let k = 0; k < 5; k++) {
    try {
      const r = await fetch(RPC, { method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(15000),
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
      if (r.status === 429 || r.status >= 500) { await sleep(1200 * (k + 1)); continue; }
      const j = await r.json();
      if (j?.error) { await sleep(1200 * (k + 1)); continue; }
      return j?.result ?? null;
    } catch (_) { await sleep(800 * (k + 1)); }
  }
  return null;
}

/* SOL/USD by the minute around the trade (Binance public data), nearest minute */
async function solPrices(t0: number, t1: number): Promise<[number, number][]> {
  try {
    const r = await fetch(`https://data-api.binance.vision/api/v3/klines?symbol=SOLUSDT&interval=1m&startTime=${t0 - 60_000}&endTime=${t1 + 60_000}&limit=1000`, { signal: AbortSignal.timeout(10000) });
    const k = await r.json(); if (Array.isArray(k) && k.length) return k.map((c: any) => [Number(c[0]), Number(c[4])]);
  } catch (_) { /* below */ }
  try {
    const r = await fetch(`https://api.coingecko.com/api/v3/coins/solana/market_chart/range?vs_currency=usd&from=${Math.floor(t0 / 1000) - 7200}&to=${Math.floor(t1 / 1000) + 7200}`, { signal: AbortSignal.timeout(10000) });
    const j = await r.json(); if (Array.isArray(j?.prices) && j.prices.length) return j.prices;
  } catch (_) { /* none */ }
  return [];
}
const solAt = (s: [number, number][], ts: number) => { let best = s[0], d = Infinity; for (const p of s) { const e = Math.abs(p[0] - ts); if (e < d) { d = e; best = p; } } return best[1]; };

/* a swap's price, from the pool's own balance changes (quote / token) */
function poolPrice(tx: any, mint: string, solUsd: number, poolOwner: string): number {
  if (!tx?.meta || tx.meta.err) return 0;
  const by = new Map<string, Map<string, number>>();
  const add = (list: any[], sign: number) => { for (const b of list || []) { if (!b.owner) continue; const m = by.get(b.owner) || new Map<string, number>(); by.set(b.owner, m);
    m.set(b.mint, (m.get(b.mint) || 0) + sign * Number(b.uiTokenAmount?.uiAmountString ?? 0)); } };
  add(tx.meta.preTokenBalances, -1); add(tx.meta.postTokenBalances, 1);
  const quote = (m: Map<string, number>, owner: string) => {
    let q = (m.get(WSOL) || 0) * solUsd; for (const u of USD_MINTS) q += m.get(u) || 0;
    if (!q) {                                                         // bonding curves hold native SOL, not wSOL
      const keys: string[] = [...tx.transaction.message.accountKeys, ...(tx.meta.loadedAddresses?.writable || []), ...(tx.meta.loadedAddresses?.readonly || [])];
      const i = keys.indexOf(owner); if (i >= 0) q = (tx.meta.postBalances[i] - tx.meta.preBalances[i]) / 1e9 * solUsd;
    }
    return q;
  };
  if (poolOwner && by.has(poolOwner)) { const m = by.get(poolOwner)!, d = m.get(mint) || 0, q = quote(m, poolOwner);
    if (d && q && Math.sign(q) !== Math.sign(d)) return Math.abs(q / d); }
  let best = 0, bestAmt = 0;
  for (const [owner, m] of by) {
    const d = m.get(mint) || 0; if (!d) continue;
    const q = quote(m, owner); if (!q || Math.sign(q) === Math.sign(d)) continue;
    if (Math.abs(d) > bestAmt) { bestAmt = Math.abs(d); best = Math.abs(q / d); }
  }
  return best;
}

async function build(t: any, deadline: number): Promise<string> {
  const legs = Array.isArray(t.legs) ? t.legs : [];
  const legTs = legs.map((l: any) => Number(l[0])).filter(Number.isFinite);
  const end = legTs.length ? Math.max(...legTs) : Number(t.timestamp_ms), start = legTs.length ? Math.min(...legTs) : end - Number(t.hold_time) * 1000;
  const pad = Math.max(300_000, (end - start) * 0.5), t0 = start - pad, t1 = end + pad;
  const [wallet, , buySig] = String(t.ext_id || "").split(":");
  if (!buySig || !B58.test(buySig)) return "no buy signature";
  // the pool: the account that gave the coin to the buyer in the buy tx, and its owner
  const btx = await rpc("getTransaction", [buySig, { encoding: "json", maxSupportedTransactionVersion: 1 }]);
  if (!btx?.meta) return "buy tx unreadable";
  const keys: string[] = [...btx.transaction.message.accountKeys, ...(btx.meta.loadedAddresses?.writable || []), ...(btx.meta.loadedAddresses?.readonly || [])];
  const d = new Map<number, number>();
  for (const b of btx.meta.preTokenBalances || []) if (b.mint === t.mint) d.set(b.accountIndex, (d.get(b.accountIndex) || 0) - Number(b.uiTokenAmount?.uiAmountString || 0));
  for (const b of btx.meta.postTokenBalances || []) if (b.mint === t.mint) d.set(b.accountIndex, (d.get(b.accountIndex) || 0) + Number(b.uiTokenAmount?.uiAmountString || 0));
  let vault = "", big = 0, vix = -1; for (const [ix, v] of d) if (v < 0 && -v > big) { big = -v; vault = keys[ix]; vix = ix; }
  if (!vault) return "no pool";
  const poolOwner = [...(btx.meta.preTokenBalances || []), ...(btx.meta.postTokenBalances || [])].find((b: any) => b.accountIndex === vix)?.owner || "";
  const sup = Number((await rpc("getTokenSupply", [t.mint]))?.value?.uiAmountString || 0);
  if (!sup) return "no supply";
  // the pool's history around the trade, anchored on our own buy (cheap however busy the coin is today)
  const sigs = new Map<string, number>();
  const keep = (list: any[]) => { for (const s of list || []) { const ts = (s.blockTime || 0) * 1000; if (!s.err && ts >= t0 && ts <= t1) sigs.set(s.signature, ts); } };
  let cur: string | undefined = buySig;                               // before (and at) the buy, back to t0
  for (let p = 0; p < 6; p++) {
    const list: any[] = await rpc("getSignaturesForAddress", [vault, { limit: 1000, before: cur }]) || [];
    keep(list); if (list.length < 1000 || (list[list.length - 1].blockTime || 0) * 1000 < t0) break;
    cur = list[list.length - 1].signature;
  }
  sigs.set(buySig, (btx.blockTime || 0) * 1000 || start);
  // after the buy: newest first down to the buy — only when that's a reasonable amount of history
  let after: any[] = [], c2: string | undefined;
  for (let p = 0; p < 8; p++) {
    const list: any[] = await rpc("getSignaturesForAddress", [vault, { limit: 1000, until: buySig, ...(c2 ? { before: c2 } : {}) }]) || [];
    after.push(...list); if (list.length < 1000) break;
    if ((list[list.length - 1].blockTime || 0) * 1000 < t1) {         // already inside the window: keep paging down to the buy
      c2 = list[list.length - 1].signature; continue;
    }
    c2 = list[list.length - 1].signature;
    if (p === 7) after = after.filter((s) => (s.blockTime || 0) * 1000 <= t1);
  }
  keep(after);
  const all = [...sigs.entries()].sort((a, b) => a[1] - b[1]);
  if (all.length < 16) return `only ${all.length} swaps`;
  // read an even sample (by order: busy moments get more reads, quiet ones less), always our own fills
  const pick: [string, number][] = [];
  const step = Math.max(1, all.length / MAX_READS);
  for (let x = 0; x < all.length && pick.length < MAX_READS; x += step) pick.push(all[Math.floor(x)]);
  for (const e of all) if (e[0] === buySig && !pick.includes(e)) pick.push(e);
  pick.sort((a, b) => a[1] - b[1]);
  const sol = await solPrices(all[0][1], all[all.length - 1][1]);
  if (!sol.length) return "no SOL price";
  const pts: { ts: number; mc: number }[] = [];
  for (let i = 0; i < pick.length && Date.now() < deadline; i += PER_S) {
    const chunk = pick.slice(i, i + PER_S), tc = Date.now();
    const txs = await Promise.all(chunk.map(([s]) => rpc("getTransaction", [s, { encoding: "json", maxSupportedTransactionVersion: 1 }])));
    txs.forEach((tx, j) => { const px = poolPrice(tx, t.mint, solAt(sol, chunk[j][1]), poolOwner); if (px > 0) pts.push({ ts: chunk[j][1], mc: px * sup }); });
    const wait = 1000 - (Date.now() - tc); if (wait > 0) await sleep(wait);
  }
  // our own fills are exact prices too
  for (const l of legs) if (Number(l[2]) > 0) pts.push({ ts: Number(l[0]), mc: Number(l[2]) });
  pts.sort((a, b) => a.ts - b.ts);
  // a price far off its neighbours (a routed / odd tx) is dropped
  const clean = pts.filter((p, i) => { const nb = pts.slice(Math.max(0, i - 3), i + 4).filter((q) => q !== p).map((q) => q.mc).sort((a, b) => a - b);
    const m = nb[nb.length >> 1]; return !m || (p.mc < m * 3 && p.mc > m / 3); });
  // consecutive swaps -> ~32 candles, each with real movement
  const n = Math.min(N, clean.length - 1);                           // each candle: at least one new real price
  if (n < 16) return `only ${clean.length} prices`;
  const candles: number[][] = []; let prev = clean[0].mc;
  for (let g = 0; g < n; g++) {
    const grp = clean.slice(Math.round(g * clean.length / n), Math.round((g + 1) * clean.length / n)); if (!grp.length) continue;
    const v = grp.map((p) => p.mc), o = prev, c = v[v.length - 1];
    candles.push([grp[0].ts, o, Math.max(o, ...v), Math.min(o, ...v), c]); prev = c;
  }
  const round = (x: number) => Math.round(x * 100) / 100;
  const span = clean[clean.length - 1].ts - clean[0].ts;
  const chart = { v: 2, src: "chain", fine: 1, q: 2, i: Math.max(1000, Math.round(span / Math.max(1, candles.length))), w: [candles[0][0], clean[clean.length - 1].ts + 1000],
    c: candles.map((x) => [x[0], round(x[1]), round(x[2]), round(x[3]), round(x[4])]), m: legs.map((l: any) => [Number(l[0]), l[1], round(Number(l[2]) || 0)]).slice(0, 20) };
  if (t.id === "local") { console.log(JSON.stringify(chart)); return "ok"; }
  const { error } = await db.from("trades").update({ chart, chart_tries: 8 }).eq("id", t.id);
  return error ? error.message : "ok";
}

if (Deno.env.get("LOCAL_TEST")) {                                     // deno run -A index.ts with LOCAL_TEST='{...trade}'
  console.error(await build({ id: "local", ...JSON.parse(Deno.env.get("LOCAL_TEST")!) }, Date.now() + 120_000));
} else Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  const h = { "Access-Control-Allow-Origin": origin === ORIGIN ? ORIGIN : "null", "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS", "Vary": "Origin", "Content-Type": "application/json" };
  if (req.method === "OPTIONS") return new Response(null, { headers: h });
  if (req.method !== "POST") return new Response('{"error":"method"}', { status: 405, headers: h });
  const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: u, error } = await db.auth.getUser(jwt);
  if (error || !u?.user) return new Response('{"error":"unauthorized"}', { status: 401, headers: h });
  let body: any = {}; try { body = await req.json(); } catch (_) { /* empty */ }
  const ids = (Array.isArray(body?.ids) ? body.ids : []).map((x: any) => String(x || "")).filter((x: string) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 3);
  if (!ids.length) return new Response('{"error":"ids"}', { status: 400, headers: h });
  const { data: rows } = await db.from("trades").select("id,mint,ext_id,legs,timestamp_ms,hold_time,chart,chart_tries")
    .eq("user_id", u.user.id).in("id", ids).not("mint", "is", null).is("deleted_at", null).lt("chart_tries", 8).eq("chart->>coarse", "true");
  const deadline = Date.now() + 120_000; let charts = 0;
  for (const t of rows || []) {
    if (Date.now() > deadline - 20_000) break;
    let res = "";
    try { res = await build(t, deadline); } catch (e) { res = (e as Error).message; }
    console.log(`fine chart ${t.id}: ${res}`);
    const final = /^(only |no buy signature|no pool)/.test(res);         // the chain really doesn't have more: stop asking
    if (res === "ok") charts++; else await db.from("trades").update({ chart_tries: final ? 8 : (t.chart_tries || 0) + 1 }).eq("id", t.id);
  }
  return new Response(JSON.stringify({ charts }), { headers: h });
});
