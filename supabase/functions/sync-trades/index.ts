// DEGENCARDS — sync-trades
// Reads each connected Solana wallet's on-chain history, rebuilds positions (buy with SOL/USDC/USDT -> sell back),
// and turns every fully closed position into a trade card. Runs every 10 min via pg_cron, or on demand by a signed-in user.
// Never fabricates: open positions and sells without a known buy are skipped.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { PublicKey } from "npm:@solana/web3.js@1.98.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const HELIUS = Deno.env.get("HELIUS_API_KEY") || "";
const RPC_URL = HELIUS ? `https://mainnet.helius-rpc.com/?api-key=${HELIUS}` : "https://api.mainnet-beta.solana.com";
const ALLOWED_ORIGIN = "https://degencards.vercel.app";
const WSOL = "So11111111111111111111111111111111111111112";
const USD_MINTS = new Set(["EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB"]);
const B58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const BACKFILL_DAYS = 30, MAX_SIGS = 2000, MAX_TX_PER_ACCOUNT = HELIUS ? 400 : 120, CONCURRENCY = HELIUS ? 8 : 3;
const TIME_BUDGET_MS = 95_000, MANUAL_COOLDOWN_MS = 60_000;

const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function cors(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin === ALLOWED_ORIGIN ? ALLOWED_ORIGIN : "null",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

async function rpc(method: string, params: unknown[], tries = 5): Promise<any> {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(RPC_URL, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
      if (r.status === 429 || r.status >= 500) { await sleep(600 * (i + 1) ** 2); continue; }
      const j = await r.json();
      if (j.error) { if (String(j.error.code) === "-32429") { await sleep(600 * (i + 1) ** 2); continue; } throw new Error(j.error.message); }
      return j.result;
    } catch (e) { if (i === tries - 1) throw e; await sleep(500 * (i + 1)); }
  }
  throw new Error("rpc rate limited");
}

async function rpcObj(method: string, params: Record<string, unknown>): Promise<any> {
  const r = await fetch(RPC_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const j = await r.json(); if (j.error) throw new Error(j.error.message); return j.result;
}

/* ---------- SOL/USD history (hourly) ---------- */
let priceSeries: [number, number][] | null = null;
async function loadSolPrices(fromMs: number) {
  const days = Math.min(90, Math.max(2, Math.ceil((Date.now() - fromMs) / 864e5) + 1));
  try {
    const r = await fetch(`https://api.coingecko.com/api/v3/coins/solana/market_chart?vs_currency=usd&days=${days}`);
    const j = await r.json();
    if (Array.isArray(j.prices) && j.prices.length) { priceSeries = j.prices; return; }
  } catch (_) { /* fallback below */ }
  try {
    const out: [number, number][] = [];
    let start = Date.now() - days * 864e5;
    while (start < Date.now() && out.length < 3000) {
      const r = await fetch(`https://data-api.binance.vision/api/v3/klines?symbol=SOLUSDT&interval=1h&limit=1000&startTime=${start}`);
      const k = await r.json(); if (!Array.isArray(k) || !k.length) break;
      for (const c of k) out.push([c[0], Number(c[4])]);
      start = k[k.length - 1][0] + 3600e3;
    }
    if (out.length) { priceSeries = out; return; }
  } catch (_) { /* no price */ }
  throw new Error("SOL price unavailable");
}
function solUsdAt(ts: number) {
  const s = priceSeries!; let lo = 0, hi = s.length - 1;
  if (ts <= s[0][0]) return s[0][1];
  if (ts >= s[hi][0]) return s[hi][1];
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (s[m][0] <= ts) lo = m; else hi = m; }
  return (ts - s[lo][0]) < (s[hi][0] - ts) ? s[lo][1] : s[hi][1];
}

/* ---------- one transaction -> swap leg ---------- */
type Leg = { mint: string; tok: number; usd: number; gusd: number; sol: number; ts: number; sig: string };
function parseTx(tx: any, wallet: string, sig: string): Leg | null {
  if (!tx?.meta || tx.meta.err) return null;
  const msg = tx.transaction.message;
  const keys: string[] = [...msg.accountKeys, ...(tx.meta.loadedAddresses?.writable || []), ...(tx.meta.loadedAddresses?.readonly || [])];
  const idx = keys.indexOf(wallet);
  const ts = (tx.blockTime || 0) * 1000;
  let lamports = idx >= 0 ? tx.meta.postBalances[idx] - tx.meta.preBalances[idx] : 0;
  const delta = new Map<string, number>();
  const add = (list: any[], sign: number) => {
    for (const b of list || []) {
      if (b.owner !== wallet) continue;
      const v = Number(b.uiTokenAmount?.uiAmountString ?? b.uiTokenAmount?.uiAmount ?? 0);
      delta.set(b.mint, (delta.get(b.mint) || 0) + sign * v);
    }
  };
  add(tx.meta.preTokenBalances, -1); add(tx.meta.postTokenBalances, 1);
  let usd = 0;
  for (const [mint, v] of delta) {
    if (mint === WSOL) { lamports += Math.round(v * 1e9); delta.delete(mint); }
    else if (USD_MINTS.has(mint)) { usd += v; delta.delete(mint); }
  }
  const moved = [...delta].filter(([, v]) => Math.abs(v) > 0);
  if (moved.length !== 1) return null;                          // transfers, airdrops, token<->token swaps: skipped
  const [mint, tok] = moved[0];
  const sol = lamports / 1e9;
  const solUsd = solUsdAt(ts);
  const usdTotal = usd + sol * solUsd;                          // NET: what really left / entered the wallet (fees included)
  if (!(tok > 0 && usdTotal < 0) && !(tok < 0 && usdTotal > 0)) return null;   // not a buy or a sell
  // GROSS (trade price, like pump.fun / Fomo show it): what the pool / bonding curve received or paid.
  // Counterparty = the other owner whose balance of this token moved the opposite way by ~the same amount.
  const byOwner = new Map<string, Map<string, number>>();
  const addO = (list: any[], sign: number) => {
    for (const b of list || []) {
      if (!b.owner || b.owner === wallet) continue;
      const m = byOwner.get(b.owner) || new Map<string, number>(); byOwner.set(b.owner, m);
      m.set(b.mint, (m.get(b.mint) || 0) + sign * Number(b.uiTokenAmount?.uiAmountString ?? b.uiTokenAmount?.uiAmount ?? 0));
    }
  };
  addO(tx.meta.preTokenBalances, -1); addO(tx.meta.postTokenBalances, 1);
  let best: string | null = null, bestErr = Infinity;
  for (const [owner, m] of byOwner) {
    const d = m.get(mint) || 0;
    if (d === 0 || Math.sign(d) === Math.sign(tok)) continue;
    const err = Math.abs(Math.abs(d) - Math.abs(tok)) / Math.abs(tok);
    if (err < bestErr) { bestErr = err; best = owner; }
  }
  // value (USD) the counterparty received for the token, following up to 3 intermediate hops (route tokens)
  const lam = (owner: string) => { const i = keys.indexOf(owner); return i >= 0 ? (tx.meta.postBalances[i] - tx.meta.preBalances[i]) / 1e9 : 0; };
  const quoteVal = (owner: string, seen: Set<string>, depth: number): number => {
    const m = byOwner.get(owner) || new Map<string, number>();
    let v = (lam(owner) + (m.get(WSOL) || 0)) * solUsd; for (const u of USD_MINTS) v += m.get(u) || 0;
    if (Math.abs(v) > 1e-9 || depth >= 3) return v;
    for (const [q, dq] of m) {                                  // received an intermediate token: who gave it, and for what?
      if (q === mint || seen.has(q) || Math.abs(dq) === 0) continue;
      let o2: string | null = null, e2 = Infinity;
      for (const [o, mm] of byOwner) {
        if (o === owner) continue;
        const d = mm.get(q) || 0;
        if (d === 0 || Math.sign(d) === Math.sign(dq)) continue;
        const e = Math.abs(Math.abs(d) - Math.abs(dq)) / Math.abs(dq); if (e < e2) { e2 = e; o2 = o; }
      }
      if (o2 && e2 < 0.05) { const r = quoteVal(o2, new Set([...seen, q]), depth + 1); if (Math.abs(r) > 1e-9) return r; }
    }
    return 0;
  };
  let gusd = usdTotal;
  if (best && bestErr < 0.05) {
    const g = -quoteVal(best, new Set([mint]), 0);              // counterparty received value  <=>  we paid it
    if (Math.sign(g) === Math.sign(usdTotal) && Math.abs(g) > 1e-6 && Math.abs(g) < 1e7) gusd = g;
  }
  return { mint, tok, usd: usdTotal, gusd, sol, ts, sig };
}

/* ---------- token metadata ---------- */
const MPL = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");
function readMplSymbol(b: Uint8Array): string {
  // Metaplex Metadata: key(1) update_authority(32) mint(32) name(borsh string) symbol(borsh string) ...
  try {
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength); let o = 65;
    const str = () => { const n = dv.getUint32(o, true); if (n > 200) throw 0; o += 4; const s = new TextDecoder().decode(b.slice(o, o + n)); o += n; return s.replace(/\0/g, "").trim(); };
    str(); return str();
  } catch (_) { return ""; }
}
async function symbols(mints: string[]) {
  const out = new Map<string, string>();
  for (let i = 0; i < mints.length; i += 30) {
    try {
      const r = await fetch(`https://api.dexscreener.com/tokens/v1/solana/${mints.slice(i, i + 30).join(",")}`);
      const arr = await r.json();
      for (const p of Array.isArray(arr) ? arr : []) if (p?.baseToken?.address && !out.has(p.baseToken.address)) out.set(p.baseToken.address, String(p.baseToken.symbol || ""));
    } catch (_) { /* fallback below */ }
  }
  // pump.fun coins (mint ends with "pump"): real ticker from pump.fun's API, full mint as key
  const pumpMissing = mints.filter((m) => !out.get(m) && m.endsWith("pump"));
  for (let i = 0; i < pumpMissing.length; i += 4) {
    await Promise.all(pumpMissing.slice(i, i + 4).map(async (m) => {
      try {
        const r = await fetch(`https://frontend-api-v3.pump.fun/coins-v2/${m}`, { headers: { "Accept": "application/json" }, signal: AbortSignal.timeout(8000) });
        if (!r.ok) return;
        const j = await r.json();
        if (j?.mint === m && j?.symbol) out.set(m, String(j.symbol));
      } catch (_) { /* next fallback */ }
    }));
  }
  // on-chain metadata (free, any launchpad): Token-2022 metadata extension, else Metaplex metadata account
  const chainMissing = mints.filter((m) => !out.get(m));
  for (let i = 0; i < chainMissing.length; i += 100) {
    const chunk = chainMissing.slice(i, i + 100);
    try {
      const mintAccs = await rpc("getMultipleAccounts", [chunk, { encoding: "jsonParsed" }]);
      const needMpl: string[] = [];
      chunk.forEach((m, j) => {
        const ext = mintAccs?.value?.[j]?.data?.parsed?.info?.extensions?.find((e: any) => e.extension === "tokenMetadata");
        if (ext?.state?.symbol) out.set(m, String(ext.state.symbol)); else needMpl.push(m);
      });
      if (needMpl.length) {
        const pdas = needMpl.map((m) => PublicKey.findProgramAddressSync([new TextEncoder().encode("metadata"), MPL.toBytes(), new PublicKey(m).toBytes()], MPL)[0].toBase58());
        const accs = await rpc("getMultipleAccounts", [pdas, { encoding: "base64" }]);
        needMpl.forEach((m, j) => {
          const a = accs?.value?.[j]; if (!a?.data?.[0]) return;
          const sym = readMplSymbol(Uint8Array.from(atob(a.data[0]), (c) => c.charCodeAt(0)));
          if (sym) out.set(m, sym);
        });
      }
    } catch (e) { console.error("onchain meta", (e as Error).message); }
  }
  const missing = mints.filter((m) => !out.get(m));
  if (HELIUS && missing.length) {                                // rugged / unlisted tokens: on-chain metadata via Helius DAS
    try {
      const assets = await rpcObj("getAssetBatch", { ids: missing.slice(0, 100) });
      for (const a of assets || []) { const sym = a?.content?.metadata?.symbol || a?.token_info?.symbol; if (a?.id && sym) out.set(a.id, String(sym)); }
    } catch (_) { /* short mint */ }
  }
  return out;
}
const cleanSym = (s: string, mint: string) =>
  (s || "").replace(/[\u0000-\u001f\u007f<>&"'`\\$]/g, "").trim().toUpperCase().slice(0, 24) || (mint.slice(0, 4) + "…" + mint.slice(-4)).toUpperCase();

/* ---------- one connected account ---------- */
async function syncAccount(acc: any, deadline: number) {
  const wallet = acc.handle;
  if (!B58.test(wallet)) return { imported: 0, error: "not a Solana address" };
  const first = !acc.last_sig;
  if (first) await db.from("trades").delete().eq("user_id", acc.user_id).eq("source", "wallet").is("ext_id", null);   // legacy client-side imports

  // 1. new signatures since the cursor (newest first), first sync = last 30 days
  const cutoff = Date.now() - BACKFILL_DAYS * 864e5;
  const sigs: any[] = []; let before: string | undefined;
  while (sigs.length < MAX_SIGS) {
    const opts: any = { limit: 1000 }; if (before) opts.before = before; if (acc.last_sig) opts.until = acc.last_sig;
    const page = await rpc("getSignaturesForAddress", [wallet, opts]);
    if (!page?.length) break;
    let stop = false;
    for (const s of page) { if (first && s.blockTime && s.blockTime * 1000 < cutoff) { stop = true; break; } sigs.push(s); }
    if (stop || page.length < 1000) break;
    before = page[page.length - 1].signature;
  }
  if (!sigs.length) { await db.from("connected_accounts").update({ last_synced_at: new Date().toISOString(), sync_error: null }).eq("id", acc.id); return { imported: 0 }; }
  sigs.reverse();                                              // oldest first
  const batch = sigs.slice(0, MAX_TX_PER_ACCOUNT);
  const oldestTs = (batch[0].blockTime || Date.now() / 1000) * 1000;
  if (!priceSeries || priceSeries[0][0] > oldestTs) await loadSolPrices(oldestTs);

  // 2. fetch + parse (bounded concurrency, stop cleanly on time budget)
  const legs: (Leg | null)[] = new Array(batch.length).fill(null);
  let done = 0;
  for (let i = 0; i < batch.length && Date.now() < deadline; i += CONCURRENCY) {
    const chunk = batch.slice(i, i + CONCURRENCY);
    const res = await Promise.all(chunk.map((s) => s.err ? null :
      rpc("getTransaction", [s.signature, { encoding: "json", maxSupportedTransactionVersion: 0, commitment: "confirmed" }])));
    res.forEach((tx, j) => { legs[i + j] = parseTx(tx, wallet, chunk[j].signature); });
    done = i + chunk.length;
    if (!HELIUS) await sleep(250);
  }
  if (!done) return { imported: 0, error: null };

  // 3. rebuild positions
  const state = acc.sync_state?.positions || {};
  const closed: any[] = [];
  for (const leg of legs.slice(0, done)) {
    if (!leg) continue;
    let p = state[leg.mint];
    const px = Math.abs(leg.gusd / leg.tok);                     // USD per token at this fill (trade price)
    if (leg.tok > 0) {
      if (!p) p = state[leg.mint] = { b: 0, s: 0, inv: 0, ret: 0, ninv: 0, nret: 0, first: leg.ts, last: leg.ts, sig: leg.sig };
      p.b += leg.tok; p.inv += -leg.gusd; p.ninv = (p.ninv || 0) - leg.usd; p.last = leg.ts;
      p.bl = [...(p.bl || []), [leg.ts, px]].slice(-10);
    } else {
      if (!p || p.b <= 0) continue;                              // sell of a bag bought before tracking: unknown cost, skipped
      p.s += -leg.tok; p.ret += leg.gusd; p.nret = (p.nret || 0) + leg.usd; p.last = leg.ts;
      p.sl = [...(p.sl || []), [leg.ts, px]].slice(-10);
      if (p.s >= p.b * 0.98) { closed.push({ mint: leg.mint, ...p }); delete state[leg.mint]; }
    }
  }
  const openMints = Object.keys(state);
  if (openMints.length > 300) for (const m of openMints.sort((a, b) => state[a].last - state[b].last).slice(0, openMints.length - 300)) delete state[m];

  // 4. closed positions -> trade cards
  let imported = 0;
  if (closed.length) {
    const syms = await symbols([...new Set(closed.map((c) => c.mint))]);
    const supply = new Map<string, number>();
    for (const m of new Set(closed.map((c) => c.mint))) {
      try { const r = await rpc("getTokenSupply", [m]); supply.set(m, Number(r?.value?.uiAmountString || 0)); } catch (_) { supply.set(m, 0); }
    }
    for (const c of closed) {
      if (c.inv <= 0) continue;
      const sup = supply.get(c.mint) || 0;
      const pnl = c.ret - c.inv;
      const row = {
        user_id: acc.user_id, source: "wallet", mint: c.mint, ext_id: `${wallet}:${c.mint}:${c.sig}`.slice(0, 200),
        ticker: cleanSym(syms.get(c.mint) || "", c.mint),
        pnl: Math.round(Math.max(-1e10, Math.min(1e10, pnl)) * 100) / 100,
        roi: Math.round(Math.max(-100, Math.min(1e7, (pnl / c.inv) * 100)) * 10) / 10,
        entry_mc: Math.round(Math.min(1e13, sup ? (c.inv / c.b) * sup : 0)),
        exit_mc: Math.round(Math.min(1e13, sup && c.s ? (c.ret / c.s) * sup : 0)),
        hold_time: Math.max(1, Math.min(31536000, Math.round((c.last - c.first) / 1000))),
        timestamp_ms: Math.max(1230768000000, c.last),
        pnl_net: c.ninv ? Math.round(Math.max(-1e10, Math.min(1e10, (c.nret || 0) - c.ninv)) * 100) / 100 : null,
        fees_usd: c.ninv ? Math.round(Math.max(-1e10, Math.min(1e10, (c.ninv - c.inv) + (c.ret - (c.nret || 0)))) * 100) / 100 : null,
        legs: sup ? [...(c.bl || []).map(([t, px]: number[]) => [t, "b", Math.round(px * sup)]), ...(c.sl || []).map(([t, px]: number[]) => [t, "s", Math.round(px * sup)])] : null,
      };
      const { error } = await db.from("trades").insert(row);
      if (!error) imported++;
      else if (String(error.code).includes("23505")) {                // already imported (rescan): refresh the figures only
        const { user_id: _u, source: _s, ext_id, ...fig } = row as any;
        await db.from("trades").update(fig).eq("user_id", acc.user_id).eq("ext_id", ext_id);
      } else console.error("insert", error.message);
    }
  }

  // 5. cursor + state
  await db.from("connected_accounts").update({
    last_sig: batch[done - 1].signature, last_synced_at: new Date().toISOString(), sync_error: null,
    sync_state: { positions: state },
  }).eq("id", acc.id);
  return { imported, pending: sigs.length - done };
}

/* ---------- second-level candles for pump.fun coins ----------
   pump.fun's trade feed gives every swap (signature, second, price). We rebuild candles over
   [first fill - 2 min, last fill + 2 min] (clipped to the coin's first trade), bucket size picked for ~50 candles,
   and place B / S exactly on this wallet's own fills. Non-pump coins fall back to minute candles built in the browser. */
const BUCKETS = [1, 2, 3, 5, 10, 15, 30, 60, 120, 300];
let pumpLast = 0;
async function pumpTrades(mint: string, t0: number, t1: number) {
  const out: any[] = []; let cursor = `9999999999999999999999-${t1 + 1000}`;
  for (let page = 0; page < 40; page++) {
    let r: Response | null = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      const wait = pumpLast + 2500 - Date.now(); if (wait > 0) await sleep(wait);          // stay under pump.fun's rate limit
      pumpLast = Date.now();
      r = await fetch(`https://swap-api.pump.fun/v2/coins/${mint}/trades?limit=100&cursor=${encodeURIComponent(cursor)}&minSolAmount=0`,
        { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(10000) });
      if (r.status !== 429) break;
      pumpLast = Date.now() + 4000 * (attempt + 1);
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
async function buildPumpCharts(deadline: number, userId: string | null) {
  let q = db.from("trades").select("id,mint,ext_id,timestamp_ms,hold_time,legs,chart,chart_tries")
    .like("mint", "%pump").is("deleted_at", null).lt("chart_tries", 3).lt("timestamp_ms", Date.now() - 150_000)
    .or("chart.is.null,chart->>v.is.null").order("timestamp_ms", { ascending: false }).limit(15);
  if (userId) q = q.eq("user_id", userId);
  const { data: rows, error } = await q;
  if (error) { console.error("charts query", error.message); return 0; }
  let built = 0, rateHits = 0; const supplyCache = new Map<string, number>();
  for (const t of rows || []) {
    if (Date.now() > deadline - 6_000) break;
    try {
      const wallet = String(t.ext_id || "").split(":")[0];
      const legTs = Array.isArray(t.legs) ? t.legs.map((l: any) => Number(l[0])).filter(Number.isFinite) : [];
      const end = legTs.length ? Math.max(...legTs) : Number(t.timestamp_ms);
      const start = legTs.length ? Math.min(...legTs) : end - Number(t.hold_time) * 1000;
      const t0 = start - 120_000, t1 = end + 120_000;
      if (!supplyCache.has(t.mint)) { const r = await rpc("getTokenSupply", [t.mint]); supplyCache.set(t.mint, Number(r?.value?.uiAmountString || 0)); }
      const sup = supplyCache.get(t.mint) || 0;
      const all = (await pumpTrades(t.mint, t0, t1))
        .map((x: any) => ({ ts: Date.parse(x.timestamp), slot: String(x.slotIndexId || ""), px: Number(x.priceUsd), fill: Number(x.fillPriceUsd || x.priceUsd), type: x.type, user: x.userAddress, tx: x.tx }))
        .filter((x) => x.ts >= t0 && x.ts <= t1 && x.px > 0)
        .sort((a, b) => a.ts - b.ts || (a.slot < b.slot ? -1 : 1));
      if (all.length < 2 || !sup) { await db.from("trades").update({ chart_tries: (t.chart_tries || 0) + 1 }).eq("id", t.id); continue; }
      const a = all[0].ts, b = Math.max(all[all.length - 1].ts, Math.min(t1, end + 1000));
      const spanS = Math.max(1, (b - a) / 1000);
      const bucket = BUCKETS.find((x) => spanS / x <= 60) || 300, bms = bucket * 1000;
      const candles: number[][] = [];
      for (const x of all) {
        const k = a + Math.floor((x.ts - a) / bms) * bms, v = x.px * sup;
        const c = candles[candles.length - 1];
        if (c && c[0] === k) { c[2] = Math.max(c[2], v); c[3] = Math.min(c[3], v); c[4] = v; }
        else { const o = c ? c[4] : v; candles.push([k, o, Math.max(o, v), Math.min(o, v), v]); }   // open = previous close (continuous)
      }
      const round = (n: number) => Math.round(n * 100) / 100;
      const marks = all.filter((x) => wallet && x.user === wallet && (x.type === "buy" || x.type === "sell"))
        .map((x) => [x.ts, x.type === "buy" ? "b" : "s", round(x.fill * sup)]).slice(0, 20);
      const chart = { v: 2, src: "pump", i: bms, w: [a, b + bms], c: candles.map((c) => [c[0], round(c[1]), round(c[2]), round(c[3]), round(c[4])]), m: marks };
      const { error: e2 } = await db.from("trades").update({ chart }).eq("id", t.id);
      if (e2) throw new Error(e2.message);
      built++;
    } catch (e) {
      const msg = (e as Error).message;
      if (msg === "RATE") {                                      // pump.fun is throttling us: stop this run
        console.error("pump chart rate limited, retry next run");
        rateHits++; if (rateHits === 1) await db.from("trades").update({ chart_tries: (t.chart_tries || 0) + 1 }).eq("id", t.id);   // after 3 blocked runs the browser builds minute candles instead
        break;
      }
      console.error("pump chart", msg);
      await db.from("trades").update({ chart_tries: (t.chart_tries || 0) + 1 }).eq("id", t.id);
    }
  }
  return built;
}

/* ---------- coin images ----------
   Found on pump.fun, DexScreener, the token's on-chain metadata (Token-2022 or Metaplex -> JSON -> image) or Helius,
   then COPIED into our public storage bucket (fast, never disappears with an IPFS gateway, CORS-clean for the share image).
   Only real raster images are kept (magic bytes checked), 3 MB max. */
const IMG_BUCKET = "coin-images", IMG_MAX = 3 * 1024 * 1024;
const ipfs = (u: string) => u.startsWith("ipfs://") ? "https://ipfs.io/ipfs/" + u.slice(7).replace(/^ipfs\//, "") : u;
function mplUri(b: Uint8Array): string {
  try {
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength); let o = 65;
    const str = () => { const n = dv.getUint32(o, true); if (n > 300) throw 0; o += 4; const s = new TextDecoder().decode(b.slice(o, o + n)); o += n; return s.replace(/\0/g, "").trim(); };
    str(); str(); return str();
  } catch (_) { return ""; }
}
const IPFS_GW = ["https://gateway.pinata.cloud/ipfs/", "https://ipfs.io/ipfs/", "https://dweb.link/ipfs/", "https://w3s.link/ipfs/", "https://nftstorage.link/ipfs/"];
function variants(url: string): string[] {                          // IPFS gateways rate-limit a lot: try several
  const m = url.match(/\/ipfs\/([A-Za-z0-9]+[^?#]*)/);
  return m ? [...new Set([url, ...IPFS_GW.map((g) => g + m[1])])] : [url];
}
async function getJson(url: string, ms = 8000) {
  for (const u of variants(url)) {
    try { const r = await fetch(u, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(ms) }); if (r.ok) return await r.json(); } catch (_) {}
  }
  return null;
}
async function imageCandidates(mint: string): Promise<string[]> {
  const out: string[] = [];
  if (mint.endsWith("pump")) { try { const j = await getJson(`https://frontend-api-v3.pump.fun/coins-v2/${mint}`); if (j?.image_uri) out.push(j.image_uri); } catch (_) {} }
  try {
    const arr = await getJson(`https://api.dexscreener.com/tokens/v1/solana/${mint}`);
    for (const p of Array.isArray(arr) ? arr : []) if (p?.baseToken?.address === mint && p?.info?.imageUrl) { out.push(p.info.imageUrl); break; }
  } catch (_) {}
  try {
    const acc = await rpc("getAccountInfo", [mint, { encoding: "jsonParsed" }]);
    const ext = acc?.value?.data?.parsed?.info?.extensions?.find((e: any) => e.extension === "tokenMetadata");
    let uri = ext?.state?.uri || "";
    if (!uri) {
      const pda = PublicKey.findProgramAddressSync([new TextEncoder().encode("metadata"), MPL.toBytes(), new PublicKey(mint).toBytes()], MPL)[0].toBase58();
      const a = await rpc("getAccountInfo", [pda, { encoding: "base64" }]);
      if (a?.value?.data?.[0]) uri = mplUri(Uint8Array.from(atob(a.value.data[0]), (c) => c.charCodeAt(0)));
    }
    if (uri) { const j = await getJson(ipfs(uri)); if (j?.image) out.push(String(j.image)); }
  } catch (_) {}
  if (HELIUS) { try { const a = await rpcObj("getAsset", { id: mint }); const u = a?.content?.links?.image || a?.content?.files?.[0]?.uri; if (u) out.push(u); } catch (_) {} }
  return [...new Set(out.map((u) => ipfs(String(u).trim())).filter((u) => /^https:\/\//i.test(u)))];
}
function sniff(b: Uint8Array): [string, string] | null {
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return ["image/png", "png"];
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return ["image/jpeg", "jpg"];
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return ["image/gif", "gif"];
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return ["image/webp", "webp"];
  return null;
}
async function download(url: string): Promise<[Uint8Array, string, string] | null> {
  const r = await fetch(url, { signal: AbortSignal.timeout(12000), redirect: "follow" });
  if (!r.ok || !r.body) return null;
  if (Number(r.headers.get("content-length") || 0) > IMG_MAX) return null;
  const reader = r.body.getReader(); const parts: Uint8Array[] = []; let size = 0;
  while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > IMG_MAX) { try { reader.cancel(); } catch (_) {} return null; } parts.push(value); }
  const buf = new Uint8Array(size); let o = 0; for (const p of parts) { buf.set(p, o); o += p.length; }
  const kind = sniff(buf); return kind ? [buf, kind[0], kind[1]] : null;
}
async function fillCoinImages(deadline: number, userId: string | null) {
  let q = db.from("trades").select("mint,image_tries").is("image", null).not("mint", "is", null).lt("image_tries", 3).order("timestamp_ms", { ascending: false }).limit(200);
  if (userId) q = q.eq("user_id", userId);
  const { data: rows } = await q;
  const mints = [...new Set((rows || []).map((r: any) => r.mint))].slice(0, 30);
  let done = 0;
  for (const mint of mints) {
    if (Date.now() > deadline - 8_000) break;
    let url: string | null = null;
    try {
      // already stored for another trade / user? reuse it
      const { data: have } = await db.from("trades").select("image").eq("mint", mint).not("image", "is", null).limit(1);
      if (have?.[0]?.image) url = have[0].image;
      else {
        for (const src of await imageCandidates(mint)) {
          let got: [Uint8Array, string, string] | null = null;
          for (const v of variants(src)) { got = await download(v).catch(() => null); if (got) break; }
          if (!got) continue;
          const [bytes, type, ext] = got, path = `${mint}.${ext}`;
          const { error } = await db.storage.from(IMG_BUCKET).upload(path, bytes, { contentType: type, upsert: true, cacheControl: "31536000" });
          if (error) { console.error("img upload", error.message); continue; }
          url = db.storage.from(IMG_BUCKET).getPublicUrl(path).data.publicUrl; break;
        }
      }
    } catch (e) { console.error("img", (e as Error).message); }
    if (url) { await db.from("trades").update({ image: url }).eq("mint", mint).is("image", null); done++; }
    else {
      const tries = Math.max(...(rows || []).filter((r: any) => r.mint === mint).map((r: any) => r.image_tries || 0)) + 1;
      await db.from("trades").update({ image_tries: tries }).eq("mint", mint).is("image", null);
    }
  }
  return done;
}


Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  const h = { ...cors(origin), "Content-Type": "application/json" };
  if (req.method === "OPTIONS") return new Response(null, { headers: h });
  if (req.method !== "POST") return new Response('{"error":"method"}', { status: 405, headers: h });
  const deadline = Date.now() + TIME_BUDGET_MS;
  const body: any = await req.json().catch(() => ({}));
  const task = body?.task === "images" ? "images" : body?.task === "charts" ? "charts" : "all";   // cron runs dedicated passes

  let accounts: any[] = [];
  let userId: string | null = null;
  const cronKey = req.headers.get("x-cron-key");
  if (cronKey) {
    const { data: ok } = await db.rpc("verify_sync_cron_key", { k: cronKey });
    if (ok !== true) return new Response('{"error":"forbidden"}', { status: 403, headers: h });
    if (task === "charts") {
      let charts = 0; try { charts = await buildPumpCharts(deadline, null); } catch (e) { console.error("charts", (e as Error).message); }
      return new Response(JSON.stringify({ charts }), { headers: h });
    }
    if (task === "images") {
      let images = 0; try { images = await fillCoinImages(deadline, null); } catch (e) { console.error("images", (e as Error).message); }
      return new Response(JSON.stringify({ images }), { headers: h });
    }
    const { data } = await db.from("connected_accounts").select("*").order("last_synced_at", { ascending: true, nullsFirst: true }).limit(60);
    accounts = data || [];
  } else {
    const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: u, error } = await db.auth.getUser(jwt);
    if (error || !u?.user) return new Response('{"error":"unauthorized"}', { status: 401, headers: h });
    userId = u.user.id;
    const { data } = await db.from("connected_accounts").select("*").eq("user_id", u.user.id);
    accounts = (data || []).filter((a) => !a.last_synced_at || Date.now() - Date.parse(a.last_synced_at) > MANUAL_COOLDOWN_MS || !a.last_sig);
  }

  let imported = 0, synced = 0, pending = 0, repaired = 0;
  for (const acc of accounts) {
    if (Date.now() > deadline) break;
    try {
      const r: any = await syncAccount(acc, deadline);
      imported += r.imported || 0; pending += r.pending || 0; synced++;
      if (r.error) await db.from("connected_accounts").update({ sync_error: r.error, last_synced_at: new Date().toISOString() }).eq("id", acc.id);
    } catch (e) {
      console.error("sync", acc.id, (e as Error).message);
      await db.from("connected_accounts").update({ sync_error: String((e as Error).message).slice(0, 200) }).eq("id", acc.id);
    }
  }
  // repair cards still showing a shortened mint (imported before a ticker source was available)
  if (Date.now() < deadline) {
    try {
      let q = db.from("trades").select("id,mint").eq("source", "wallet").not("mint", "is", null).like("ticker", "%…%").limit(100);
      if (userId) q = q.eq("user_id", userId);
      const { data: rows } = await q;
      if (rows?.length) {
        const syms = await symbols([...new Set(rows.map((r: any) => r.mint))]);
        for (const r of rows) {
          const sym = syms.get(r.mint);
          if (sym) { const t = cleanSym(sym, r.mint); if (!t.includes("…")) { await db.from("trades").update({ ticker: t }).eq("id", r.id); repaired++; } }
        }
      }
    } catch (e) { console.error("repair", (e as Error).message); }
  }
  let charts = 0;
  if (userId && Date.now() < deadline - 10_000) { try { charts = await buildPumpCharts(deadline, userId); } catch (e) { console.error("charts", (e as Error).message); } }
  let images = 0;
  if (userId && Date.now() < deadline - 10_000) { try { images = await fillCoinImages(deadline, userId); } catch (e) { console.error("images", (e as Error).message); } }
  return new Response(JSON.stringify({ synced, imported, pending, repaired, charts, images }), { headers: h });
});
