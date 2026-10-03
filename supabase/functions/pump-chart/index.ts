// DEGENCARDS — pump-chart
// A very short trade on a pump.fun coin whose GeckoTerminal minute chart has nothing around it (chart.coarse, set by the
// compact_chart trigger) gets second-level candles rebuilt from pump.fun's own trade feed, with B / S on the wallet's exact fills.
// Saved as { src: "pump", fine: 1 } with chart_tries = 8: the minute-chart cron and the trigger then leave it alone.
// Only the signed-in user's own trades, max 6 per call. Never fabricates: no swaps -> the minute chart stays.
import { createClient } from "jsr:@supabase/supabase-js@2";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });
const HELIUS = Deno.env.get("HELIUS_API_KEY") || "";
const RPCS = [...(HELIUS ? [`https://mainnet.helius-rpc.com/?api-key=${HELIUS}`] : []), "https://api.mainnet-beta.solana.com", "https://solana-rpc.publicnode.com"];
const ORIGIN = "https://degencards.vercel.app";
const BUCKETS = [1, 2, 3, 5, 10, 15, 30, 60, 120, 300];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function supply(mint: string): Promise<number> {
  for (const url of RPCS) {
    try {
      const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getTokenSupply", params: [mint] }), signal: AbortSignal.timeout(10000) });
      const j = await r.json(); const v = Number(j?.result?.value?.uiAmountString || 0);
      if (v > 0) return v;
    } catch (_) { /* next node */ }
  }
  return 0;
}

let last = 0;
async function pumpTrades(mint: string, t0: number, t1: number) {
  const out: any[] = []; let cursor = `9999999999999999999999-${t1 + 1000}`;
  for (let page = 0; page < 30; page++) {
    let r: Response | null = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      const wait = last + 700 - Date.now(); if (wait > 0) await sleep(wait);
      last = Date.now();
      r = await fetch(`https://swap-api.pump.fun/v2/coins/${mint}/trades?limit=100&cursor=${encodeURIComponent(cursor)}&minSolAmount=0`,
        { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(10000) });
      if (r.status !== 429) break;
      last = Date.now() + 4000 * (attempt + 1);
    }
    if (r!.status === 429) throw new Error("RATE");
    if (!r!.ok) throw new Error(`pump trades ${r!.status}`);
    const j = await r!.json(); const tr = j?.trades || [];
    for (const t of tr) out.push(t);
    const oldest = tr.length ? Date.parse(tr[tr.length - 1].timestamp) : 0;
    if (!j?.pagination?.hasMore || !tr.length || oldest < t0) break;
    cursor = j.pagination.nextCursor;
  }
  return out;
}

async function build(t: any): Promise<boolean> {
  const wallet = String(t.ext_id || "").split(":")[0];
  const legTs = Array.isArray(t.legs) ? t.legs.map((l: any) => Number(l[0])).filter(Number.isFinite) : [];
  const mTs = Array.isArray(t.chart?.m) ? t.chart.m.map((m: any) => Number(m[0])).filter(Number.isFinite) : [];
  const ts = legTs.length ? legTs : mTs;
  const end = ts.length ? Math.max(...ts) : Number(t.timestamp_ms);
  const start = ts.length ? Math.min(...ts) : end - Number(t.hold_time) * 1000;
  const t0 = start - 120_000, t1 = end + 120_000;
  const sup = await supply(t.mint);
  if (!sup) return false;
  const all = (await pumpTrades(t.mint, t0, t1))
    .map((x: any) => ({ ts: Date.parse(x.timestamp), slot: String(x.slotIndexId || ""), px: Number(x.priceUsd), fill: Number(x.fillPriceUsd || x.priceUsd), type: x.type, user: x.userAddress }))
    .filter((x) => x.ts >= t0 && x.ts <= t1 && x.px > 0)
    .sort((a, b) => a.ts - b.ts || (a.slot < b.slot ? -1 : 1));
  if (all.length < 2) return false;
  const a = all[0].ts, b = Math.max(all[all.length - 1].ts, Math.min(t1, end + 1000));
  const spanS = Math.max(1, (b - a) / 1000);
  const bucket = BUCKETS.find((x) => spanS / x <= 60) || 300, bms = bucket * 1000;
  const candles: number[][] = [];
  for (const x of all) {
    const k = a + Math.floor((x.ts - a) / bms) * bms, v = x.px * sup;
    const c = candles[candles.length - 1];
    if (c && c[0] === k) { c[2] = Math.max(c[2], v); c[3] = Math.min(c[3], v); c[4] = v; }
    else { const o = c ? c[4] : v; candles.push([k, o, Math.max(o, v), Math.min(o, v), v]); }   // open = previous close
  }
  if (candles.length < 12) return false;                             // not better than the minute chart: keep it
  const round = (n: number) => Math.round(n * 100) / 100;
  let marks = all.filter((x) => wallet && x.user === wallet && (x.type === "buy" || x.type === "sell"))
    .map((x) => [x.ts, x.type === "buy" ? "b" : "s", round(x.fill * sup)]).slice(0, 20);
  if (!marks.length && Array.isArray(t.chart?.m)) marks = t.chart.m;   // wallet not in the feed: the known fills
  const chart = { v: 2, src: "pump", fine: 1, i: bms, w: [a, b + bms], c: candles.map((c) => [c[0], round(c[1]), round(c[2]), round(c[3]), round(c[4])]), m: marks };
  const { error } = await db.from("trades").update({ chart, chart_tries: 8 }).eq("id", t.id);
  if (error) throw new Error(error.message);
  return true;
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  const h = { "Access-Control-Allow-Origin": origin === ORIGIN ? ORIGIN : "null", "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS", "Vary": "Origin", "Content-Type": "application/json" };
  if (req.method === "OPTIONS") return new Response(null, { headers: h });
  if (req.method !== "POST") return new Response('{"error":"method"}', { status: 405, headers: h });
  const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: u, error } = await db.auth.getUser(jwt);
  if (error || !u?.user) return new Response('{"error":"unauthorized"}', { status: 401, headers: h });
  let body: any = {}; try { body = await req.json(); } catch (_) { /* empty */ }
  const ids = (Array.isArray(body?.ids) ? body.ids : []).map((x: any) => String(x || "")).filter((x: string) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 6);
  if (!ids.length) return new Response('{"error":"ids"}', { status: 400, headers: h });
  const { data: rows } = await db.from("trades").select("id,mint,ext_id,legs,timestamp_ms,hold_time,chart,chart_tries")
    .eq("user_id", u.user.id).in("id", ids).like("mint", "%pump").is("deleted_at", null).lt("chart_tries", 3)
    .eq("chart->>src", "gt").eq("chart->>coarse", "true");
  const deadline = Date.now() + 50_000; let charts = 0;
  for (const t of rows || []) {
    if (Date.now() > deadline) break;
    try { if (await build(t)) charts++; else await db.from("trades").update({ chart_tries: (t.chart_tries || 0) + 1 }).eq("id", t.id); }
    catch (e) {
      const msg = (e as Error).message; console.error("pump chart", msg);
      await db.from("trades").update({ chart_tries: (t.chart_tries || 0) + 1 }).eq("id", t.id);
      if (msg === "RATE") break;
    }
  }
  return new Response(JSON.stringify({ charts }), { headers: h });
});
