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
type Leg = { mint: string; tok: number; usd: number; sol: number; ts: number; sig: string };
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
  const usdTotal = usd + sol * solUsdAt(ts);
  if (!(tok > 0 && usdTotal < 0) && !(tok < 0 && usdTotal > 0)) return null;   // not a buy or a sell
  return { mint, tok, usd: usdTotal, sol, ts, sig };
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
    if (leg.tok > 0) {
      if (!p) p = state[leg.mint] = { b: 0, s: 0, inv: 0, ret: 0, first: leg.ts, last: leg.ts, sig: leg.sig };
      p.b += leg.tok; p.inv += -leg.usd; p.last = leg.ts;
    } else {
      if (!p || p.b <= 0) continue;                              // sell of a bag bought before tracking: unknown cost, skipped
      p.s += -leg.tok; p.ret += leg.usd; p.last = leg.ts;
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
      };
      const { error } = await db.from("trades").insert(row);
      if (!error) imported++; else if (!String(error.code).includes("23505")) console.error("insert", error.message);
    }
  }

  // 5. cursor + state
  await db.from("connected_accounts").update({
    last_sig: batch[done - 1].signature, last_synced_at: new Date().toISOString(), sync_error: null,
    sync_state: { positions: state },
  }).eq("id", acc.id);
  return { imported, pending: sigs.length - done };
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  const h = { ...cors(origin), "Content-Type": "application/json" };
  if (req.method === "OPTIONS") return new Response(null, { headers: h });
  if (req.method !== "POST") return new Response('{"error":"method"}', { status: 405, headers: h });
  const deadline = Date.now() + TIME_BUDGET_MS;

  let accounts: any[] = [];
  let userId: string | null = null;
  const cronKey = req.headers.get("x-cron-key");
  if (cronKey) {
    const { data: ok } = await db.rpc("verify_sync_cron_key", { k: cronKey });
    if (ok !== true) return new Response('{"error":"forbidden"}', { status: 403, headers: h });
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
  return new Response(JSON.stringify({ synced, imported, pending, repaired }), { headers: h });
});
