// DEGENCARDS — sync-trades
// Reads each connected Solana wallet's on-chain history, rebuilds positions (buy with SOL/USDC/USDT -> sell back),
// and turns every fully closed position into a trade card. Runs every 10 min via pg_cron, or on demand by a signed-in user.
// Never fabricates: open positions and sells without a known buy are skipped.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { PublicKey } from "npm:@solana/web3.js@1.98.0";
import bs58 from "npm:bs58@5.0.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const HELIUS = Deno.env.get("HELIUS_API_KEY") || "";
// history (signatures, transactions) only from full-history nodes; simple reads can also use a backup node
const RPCS_HIST = HELIUS ? [`https://mainnet.helius-rpc.com/?api-key=${HELIUS}`, "https://api.mainnet-beta.solana.com"] : ["https://api.mainnet-beta.solana.com"];
const RPCS = [...RPCS_HIST, "https://solana-rpc.publicnode.com"];
const HIST_METHODS = new Set(["getSignaturesForAddress", "getTransaction"]);
let rpcIdx = 0;
const RPC_URL = RPCS[0];                                              // kept for rpcObj (Helius DAS)
const ALLOWED_ORIGIN = "https://degencards.vercel.app";
const WSOL = "So11111111111111111111111111111111111111112";
const USD_MINTS = new Set(["EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB"]);
const B58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const BACKFILL_DAYS = 30, MAX_SIGS = 30000, MAX_TX_PER_ACCOUNT = HELIUS ? 800 : 500, CONCURRENCY = HELIUS ? 8 : 3;
const TIME_BUDGET_MS = 95_000, MANUAL_COOLDOWN_MS = 60_000;
const freshPump: string[] = [];                                     // pump trades imported during this run -> chart them right away

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

async function rpc(method: string, params: unknown[], tries = 6): Promise<any> {
  let lastErr: unknown = null;
  const pool = HIST_METHODS.has(method) ? RPCS_HIST : RPCS;
  for (let i = 0; i < tries; i++) {
    const url = pool[(rpcIdx + i) % pool.length];                    // rotate endpoints: one being rate-limited or down never blocks the sync
    try {
      const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(15000) });
      if (r.status === 429 || r.status >= 500) { lastErr = new Error(`rpc ${r.status}`); await sleep(300 * (i + 1)); continue; }
      const j = await r.json();
      if (j.error) {
        if (String(j.error.code) === "-32429" || /rate|limit|timeout|unavailable/i.test(String(j.error.message))) { lastErr = new Error(j.error.message); await sleep(300 * (i + 1)); continue; }
        throw new Error(j.error.message);
      }
      rpcIdx = (rpcIdx + i) % pool.length;                            // stick with the endpoint that answered
      return j.result;
    } catch (e) { lastErr = e; if (i === tries - 1) break; await sleep(400 * (i + 1)); }
  }
  throw lastErr || new Error("rpc failed");
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
type Leg = { mint: string; tok: number; usd: number; gusd: number; sol: number; ts: number; sig: string; cb: number; made: string[]; wmade: string[]; closedRent: [string, number][]; px0?: number };
type Refund = { refund: true; closed: string[]; usd: number; ts: number };

/* ---------- pump.fun cashback, straight from the program's own trade events ----------
   Bonding curve: TradeEvent.cashback (lamports). PumpSwap: BuyEvent / SellEvent .cashback (quote units, SOL pools).
   Events come as "Program data:" logs or as self-CPI inner instructions (anchor event tag e445a52e51cb9a1d). */
const EV_TRADE = [189, 219, 127, 211, 78, 230, 97, 238], EV_BUY = [103, 244, 82, 31, 44, 245, 119, 119], EV_SELL = [62, 47, 55, 10, 165, 3, 220, 42];
const EV_CPI = [0xe4, 0x45, 0xa5, 0x2e, 0x51, 0xcb, 0x9a, 0x1d];
const startsWith = (b: Uint8Array, p: number[]) => p.every((x, i) => b[i] === x);
function readCashback(b: Uint8Array, kind: "trade" | "buy" | "sell", wallet: string): number {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength); let o = 0;
  const pk = () => { const v = new PublicKey(b.slice(o, o + 32)).toBase58(); o += 32; return v; };
  const u64 = () => { const v = Number(dv.getBigUint64(o, true)); o += 8; return v; };
  const boo = () => { o += 1; }, i64 = () => { o += 8; }, str = () => { const n = dv.getUint32(o, true); o += 4 + n; };
  if (kind === "trade") {
    pk(); u64(); u64(); boo(); const user = pk(); i64(); u64(); u64(); u64(); u64(); pk(); u64(); u64(); pk(); u64(); u64();
    boo(); u64(); u64(); u64(); i64(); str(); boo(); u64(); const cb = u64();
    return user === wallet ? cb : 0;
  }
  i64(); for (let k = 0; k < 13; k++) u64(); pk(); const user = pk(); pk(); pk(); pk(); pk(); pk(); u64(); u64();
  if (kind === "buy") { boo(); u64(); u64(); u64(); i64(); u64(); str(); }
  u64(); const cb = u64();
  return user === wallet ? cb : 0;
}
function cashbackLamports(tx: any, wallet: string): number {
  const blobs: Uint8Array[] = [];
  for (const l of tx?.meta?.logMessages || []) if (l.startsWith("Program data: ")) { try { blobs.push(Uint8Array.from(atob(l.slice(14)), (c) => c.charCodeAt(0))); } catch (_) {} }
  for (const inner of tx?.meta?.innerInstructions || []) for (const ix of inner.instructions || []) {
    try { const d = bs58.decode(ix.data); if (d.length > 16 && startsWith(d, EV_CPI)) blobs.push(d.slice(8)); } catch (_) {}
  }
  let total = 0; const seen = new Set<string>();
  for (const b of blobs) {
    const key = Array.from(b.slice(0, 48)).join(","); if (seen.has(key)) continue; seen.add(key);   // same event can appear as log AND inner ix
    try {
      if (startsWith(b, EV_TRADE)) total += readCashback(b.slice(8), "trade", wallet);
      else if (startsWith(b, EV_BUY)) total += readCashback(b.slice(8), "buy", wallet);
      else if (startsWith(b, EV_SELL)) total += readCashback(b.slice(8), "sell", wallet);
    } catch (_) { /* unknown layout: no cashback */ }
  }
  return total;
}
function parseTx(tx: any, wallet: string, sig: string): Leg | null {
  if (!tx?.meta || tx.meta.err) return null;
  const msg = tx.transaction.message;
  const keys: string[] = [...msg.accountKeys, ...(tx.meta.loadedAddresses?.writable || []), ...(tx.meta.loadedAddresses?.readonly || [])];
  const idx = keys.indexOf(wallet);
  const ts = (tx.blockTime || 0) * 1000;
  let lamports = idx >= 0 ? tx.meta.postBalances[idx] - tx.meta.preBalances[idx] : 0;
  // deposits: when the wallet pays this tx, lamports put into accounts CREATED here (pre 0 -> post > 0) are rent it gets
  // back when they're closed (usually a CloseAccount right after the sell): not a cost. Rent of accounts CLOSED here is
  // listed and decided in the position pass (neutral if it was one of our trades' deposits, credited to this trade otherwise).
  const made: string[] = [];
  if (idx > 0) {                                                     // a relayer paid this tx: remember the accounts it created,
    const pre = tx.meta.preBalances, post = tx.meta.postBalances;   // their rent can come back to the wallet when they're closed
    for (let j = 1; j < post.length; j++) if (pre[j] === 0 && post[j] > 0 && post[j] <= 10_000_000) made.push(keys[j]);
  }
  const wmade: string[] = [], closedLam: [string, number][] = [];
  if (idx === 0) {
    const pre = tx.meta.preBalances, post = tx.meta.postBalances;
    for (let j = 1; j < post.length; j++) {
      if (pre[j] === 0 && post[j] > 0 && post[j] <= 10_000_000) { lamports += post[j]; wmade.push(keys[j]); }   // new account's rent (≤ 0.01 SOL): a deposit, not a cost
      else if (pre[j] > 0 && post[j] === 0 && pre[j] <= 10_000_000) closedLam.push([keys[j], pre[j]]);          // rent returned in this tx: decided per account later
    }
  }   // relayer-paid txs: closed rent may go back to the relayer, so nothing is credited from them here
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
  const cb = cashbackLamports(tx, wallet) / 1e9 * solUsd;            // pump.fun cashback earned by this trade (USD)
  const closedRent: [string, number][] = closedLam.map(([a, l]) => [a, l / 1e9 * solUsd]);
  return { mint, tok, usd: usdTotal, gusd, sol, ts, sig, cb, made, wmade, closedRent };
}

/* a tx that only closes accounts and pays their rent to the wallet (no token moved): a refund of an earlier deposit */
function parseRefund(tx: any, wallet: string): Refund | null {
  if (!tx?.meta || tx.meta.err) return null;
  const msg = tx.transaction.message;
  const keys: string[] = [...msg.accountKeys, ...(tx.meta.loadedAddresses?.writable || []), ...(tx.meta.loadedAddresses?.readonly || [])];
  const idx = keys.indexOf(wallet); if (idx < 0) return null;
  const pre = tx.meta.preBalances, post = tx.meta.postBalances, gain = post[idx] - pre[idx];
  if (gain <= 0) return null;
  const mine = [...(tx.meta.preTokenBalances || []), ...(tx.meta.postTokenBalances || [])].filter((b: any) => b.owner === wallet);
  if (mine.some((b: any) => Number(b.uiTokenAmount?.uiAmountString || 0) !== 0)) return null;   // a real token movement: not a refund
  const closed: string[] = []; for (let j = 0; j < post.length; j++) if (j !== idx && pre[j] > 0 && post[j] === 0 && pre[j] <= 10_000_000) closed.push(keys[j]);
  if (!closed.length) return null;
  const ts = (tx.blockTime || 0) * 1000;
  return { refund: true, closed, usd: gain / 1e9 * solUsdAt(ts), ts };
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

/* ---------- is this really a wallet? ---------- */
const SYSTEM_PROGRAM = "11111111111111111111111111111111";
async function checkWallet(addr: string): Promise<string | null> {
  const info = await rpc("getAccountInfo", [addr, { encoding: "base64" }]);
  const v = info?.value;
  if (!v) {                                                           // no account at all: never funded
    const sigs = await rpc("getSignaturesForAddress", [addr, { limit: 1 }]);
    return sigs?.length ? null : "No activity on this address yet. Check it's your trading wallet's address.";
  }
  if (v.executable) return "This is a program address, not a wallet. Paste your wallet's public address.";
  if (v.owner === "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" || v.owner === "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb") return "This is a coin (token) address, not your wallet. Paste your wallet's public address.";
  if (v.owner !== SYSTEM_PROGRAM) return null;                        // smart / embedded wallets can be owned by another program: allowed
  return null;
}

/* ---------- one connected account ---------- */
async function syncAccount(acc: any, deadline: number) {
  const wallet = acc.handle;
  if (!B58.test(wallet)) return { imported: 0, error: "not a Solana address" };
  const first = !acc.last_sig;
  if (first) {
    const bad = await checkWallet(wallet);
    if (bad) return { imported: 0, error: bad };
    await db.from("trades").delete().eq("user_id", acc.user_id).eq("source", "wallet").is("ext_id", null);   // legacy client-side imports
  }

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
  if (!sigs.length) { await db.from("connected_accounts").update({ last_synced_at: new Date().toISOString(), sync_error: null, sync_pending: 0 }).eq("id", acc.id); return { imported: 0 }; }
  sigs.reverse();                                              // oldest first
  const batch = sigs.slice(0, MAX_TX_PER_ACCOUNT);
  const oldestTs = (batch[0].blockTime || Date.now() / 1000) * 1000;
  if (!priceSeries || priceSeries[0][0] > oldestTs) await loadSolPrices(oldestTs);

  // 2. fetch + parse (bounded concurrency, stop cleanly on time budget)
  const legs: (Leg | null)[] = new Array(batch.length).fill(null);
  let done = 0, stuck: { sig: string; n: number } | null = null;
  const prevStuck = acc.sync_state?.stuck || null;                   // a tx unreadable 5 runs in a row is skipped (logged), so a wallet can never stay blocked
  for (let i = 0; i < batch.length && Date.now() < deadline; i += CONCURRENCY) {
    const chunk = batch.slice(i, i + CONCURRENCY);
    const res = await Promise.all(chunk.map(async (s) => {
      if (s.err) return { ok: true, tx: null, err: "" };                // failed on-chain: nothing to import
      let err = "";
      for (let k = 0; k < 3; k++) {                                   // an empty answer means "not available yet", NOT "nothing there"
        try { const tx = await rpc("getTransaction", [s.signature, { encoding: "json", maxSupportedTransactionVersion: 1, commitment: "confirmed" }]); if (tx) return { ok: true, tx, err: "" }; err = ""; }
        catch (e) { err = String((e as Error).message || e); }
        await sleep(500 * (k + 1));
      }
      // only an EMPTY answer 5 runs in a row can be skipped; a real error (new format, bad params…) always blocks and is reported
      if (!err && prevStuck?.sig === s.signature && prevStuck.n >= 5) { console.error("skipping permanently empty tx", s.signature); return { ok: true, tx: null, err: "" }; }
      return { ok: false, tx: null, err };
    }));
    const firstMiss = res.findIndex((r) => !r.ok);
    const usable = firstMiss < 0 ? res.length : firstMiss;            // stop BEFORE an unreadable tx: the cursor never moves past it
    for (let j = 0; j < usable; j++) legs[i + j] = parseTx(res[j].tx, wallet, chunk[j].signature) || (parseRefund(res[j].tx, wallet) as any);
    done = i + usable;
    if (usable < res.length) {
      const sig = chunk[usable].signature, err = (res[usable] as any).err || "";
      stuck = { sig, n: err ? 0 : (prevStuck?.sig === sig ? prevStuck.n + 1 : 1), ...(err ? { err: err.slice(0, 160) } : {}) } as any;
      console.error("unreadable tx, will retry next run", sig, err || `empty x${(stuck as any).n}`); break;
    }
    if (!HELIUS) await sleep(250);
  }
  if (!done) {
    if (stuck) await db.from("connected_accounts").update({ sync_state: { ...(acc.sync_state || {}), stuck }, sync_pending: sigs.length }).eq("id", acc.id);
    return { imported: 0, error: (stuck as any)?.err || null, pending: sigs.length };
  }

  // 3. rebuild positions
  const state = acc.sync_state?.positions || {};
  const owners: Record<string, string> = { ...(acc.sync_state?.owners || {}) };
  const walletMade = new Set<string>(acc.sync_state?.walletMade || []);   // deposits our tracked trades made (their rent coming back is neutral)
  const closed: any[] = [];
  const lateRefunds: Record<string, number> = {};                   // ext_id -> refund USD for cards already saved
  for (const leg of legs.slice(0, done) as any[]) {
    if (!leg) continue;
    if (leg.refund) {                                                 // deposit coming back: credit the trade whose account it was
      const hit = (arr: string[] | undefined) => !!arr && leg.closed.some((a: string) => arr.includes(a));
      const open = Object.values(state).find((p: any) => hit(p.made)) as any;
      const done_ = open ? null : closed.find((c: any) => hit(c.made));
      if (open) open.nret = (open.nret || 0) + leg.usd;
      else if (done_) done_.nret = (done_.nret || 0) + leg.usd;
      else { const ext = leg.closed.map((a: string) => owners[a]).find(Boolean); if (ext) lateRefunds[ext] = (lateRefunds[ext] || 0) + leg.usd; }
      continue;
    }
    // rent returned inside this swap tx: if the account was a deposit made by one of our tracked trades (already excluded
    // from its cost) it's neutral; otherwise (an older account closed now) the money really came back during this trade,
    // so it's credited to it, in gross and net alike (same as Fomo / pump.fun)
    const g0 = leg.gusd;
    for (const [a, v] of leg.closedRent || []) {
      if (walletMade.has(a)) { leg.usd -= v; walletMade.delete(a); }
      else leg.gusd += v;
    }
    for (const a of leg.wmade || []) walletMade.add(a);
    let p = state[leg.mint];
    const px = Math.abs(g0 / leg.tok);                           // USD per token at this fill (swap price, for market caps)
    if (leg.tok > 0) {
      if (!p) p = state[leg.mint] = { b: 0, s: 0, inv: 0, ret: 0, ninv: 0, nret: 0, first: leg.ts, last: leg.ts, sig: leg.sig };
      p.b += leg.tok; p.inv += -leg.gusd; p.im = (p.im || 0) - g0; p.ninv = (p.ninv || 0) - leg.usd; p.cb = (p.cb || 0) + (leg.cb || 0); p.last = leg.ts;
      if (leg.made?.length) p.made = [...(p.made || []), ...leg.made].slice(-12);
      p.bl = [...(p.bl || []), [leg.ts, px]].slice(-10);
    } else {
      if (!p || p.b <= 0) continue;                              // sell of a bag bought before tracking: unknown cost, skipped
      p.s += -leg.tok; p.ret += leg.gusd; p.rm = (p.rm || 0) + g0; p.nret = (p.nret || 0) + leg.usd; p.cb = (p.cb || 0) + (leg.cb || 0); p.last = leg.ts;
      if (leg.made?.length) p.made = [...(p.made || []), ...leg.made].slice(-12);
      p.sl = [...(p.sl || []), [leg.ts, px]].slice(-10);
      const leftUsd = Math.max(0, p.b - p.s) * px;                   // what the remaining bag is worth at this sell price
      if (p.s >= p.b * 0.97 || leftUsd < Math.max(0.05, p.inv * 0.01)) { closed.push({ mint: leg.mint, ...p }); delete state[leg.mint]; }
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
        entry_mc: Math.round(Math.min(1e13, sup ? ((c.im ?? c.inv) / c.b) * sup : 0)),
        exit_mc: Math.round(Math.min(1e13, sup && c.s ? ((c.rm ?? c.ret) / c.s) * sup : 0)),
        hold_time: Math.max(1, Math.min(31536000, Math.round((c.last - c.first) / 1000))),
        timestamp_ms: Math.max(1230768000000, c.last),
        // net = what the wallet really made: trade flows minus real fees (refundable deposits excluded) plus pump.fun cashback
        pnl_net: c.ninv ? Math.round(Math.max(-1e10, Math.min(1e10, (c.nret || 0) - c.ninv + (c.cb || 0))) * 100) / 100 : null,
        fees_usd: c.ninv ? Math.round(Math.max(-1e10, Math.min(1e10, (c.ninv - c.inv) + (c.ret - (c.nret || 0)))) * 100) / 100 : null,
        cashback_usd: c.cb ? Math.round(c.cb * 10000) / 10000 : 0,
        legs: sup ? [...(c.bl || []).map(([t, px]: number[]) => [t, "b", Math.round(px * sup)]), ...(c.sl || []).map(([t, px]: number[]) => [t, "s", Math.round(px * sup)])] : null,
      };
      const { data: ins, error } = await db.from("trades").insert(row).select("id").maybeSingle();
      if (!error) { imported++; if (ins?.id && c.mint.endsWith("pump")) freshPump.push(ins.id); }
      else if (String(error.code).includes("23505")) {                // already imported (rescan): refresh the figures only
        const { user_id: _u, source: _s, ext_id, ...fig } = row as any;
        await db.from("trades").update(fig).eq("user_id", acc.user_id).eq("ext_id", ext_id);
      } else console.error("insert", error.message);
    }
  }

  for (const c of closed) for (const a of c.made || []) owners[a] = `${wallet}:${c.mint}:${c.sig}`.slice(0, 200);
  for (const [ext, add] of Object.entries(lateRefunds)) {            // refund arrived after the card was saved: bump its net, lower its fees
    const { data: row } = await db.from("trades").select("pnl_net,fees_usd").eq("user_id", acc.user_id).eq("ext_id", ext).maybeSingle();
    if (row && row.pnl_net != null) await db.from("trades").update({
      pnl_net: Math.round((Number(row.pnl_net) + add) * 100) / 100, fees_usd: row.fees_usd == null ? null : Math.round((Number(row.fees_usd) - add) * 100) / 100,
    }).eq("user_id", acc.user_id).eq("ext_id", ext);
  }
  const ownerKeys = Object.keys(owners); if (ownerKeys.length > 400) for (const k of ownerKeys.slice(0, ownerKeys.length - 400)) delete owners[k];

  // 5. cursor + state
  await db.from("connected_accounts").update({
    last_sig: batch[done - 1].signature, last_synced_at: new Date().toISOString(), sync_error: null,
    sync_state: { positions: state, owners, walletMade: [...walletMade].slice(-500), ...(stuck ? { stuck } : {}) }, sync_pending: Math.max(0, sigs.length - done), sync_imported: (acc.sync_imported || 0) + imported,
  }).eq("id", acc.id);
  return { imported, pending: sigs.length - done };
}

/* ---------- second-level candles for pump.fun coins ----------
   pump.fun's trade feed gives every swap (signature, second, price). We rebuild candles over
   [first fill - 2 min, last fill + 2 min] (clipped to the coin's first trade), bucket size picked for ~50 candles,
   and place B / S exactly on this wallet's own fills. Non-pump coins fall back to minute candles built in the browser. */
const BUCKETS = [1, 2, 3, 5, 10, 15, 30, 60, 120, 300];
let pumpLast = 0, pumpGap = 2500;
async function pumpTrades(mint: string, t0: number, t1: number) {
  const out: any[] = []; let cursor = `9999999999999999999999-${t1 + 1000}`;
  for (let page = 0; page < 40; page++) {
    let r: Response | null = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      const wait = pumpLast + pumpGap - Date.now(); if (wait > 0) await sleep(wait);        // stay under pump.fun's rate limit
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
async function buildPumpCharts(deadline: number, userId: string | null, onlyIds: string[] | null = null) {
  const onlyId = onlyIds && onlyIds.length ? onlyIds : null;
  let q = db.from("trades").select("id,mint,ext_id,timestamp_ms,hold_time,legs,chart,chart_tries")
    .like("mint", "%pump").is("deleted_at", null).lt("chart_tries", onlyId ? 6 : 3).lt("timestamp_ms", Date.now() - 150_000)
    .or("chart.is.null,chart->>v.is.null,chart->>src.eq.gt").order("timestamp_ms", { ascending: false }).limit(onlyId ? onlyId.length : 15);   // pump coins drawn in minutes get upgraded to seconds
  if (userId) q = q.eq("user_id", userId);
  if (onlyId) q = q.in("id", onlyId);
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

/* ---------- second-level candles for ANY coin, straight from the chain ----------
   For coins outside pump.fun (Meteora, Raydium, launchpads…) or whose minute data is too thin: read the coin's pools'
   own transactions around the trade, price each swap from the pool's balance changes (quote / token), bucket ~50 candles. */
function poolPrice(tx: any, mint: string, solUsd: number): number {
  if (!tx?.meta || tx.meta.err) return 0;
  const by = new Map<string, Map<string, number>>();
  const add = (list: any[], sign: number) => { for (const b of list || []) { if (!b.owner) continue; const m = by.get(b.owner) || new Map<string, number>(); by.set(b.owner, m);
    m.set(b.mint, (m.get(b.mint) || 0) + sign * Number(b.uiTokenAmount?.uiAmountString ?? 0)); } };
  add(tx.meta.preTokenBalances, -1); add(tx.meta.postTokenBalances, 1);
  let best = 0, bestAmt = 0;
  for (const [, m] of by) {                                           // the pool: holds the coin AND the quote, moving opposite ways
    const d = m.get(mint) || 0; if (!d) continue;
    let q = (m.get(WSOL) || 0) * solUsd; for (const u of USD_MINTS) q += m.get(u) || 0;
    if (!q || Math.sign(q) === Math.sign(d)) continue;
    if (Math.abs(d) > bestAmt) { bestAmt = Math.abs(d); best = Math.abs(q / d); }
  }
  return best;
}
async function buildChainChart(t: any, deadline: number): Promise<boolean> {
  const legTs = Array.isArray(t.legs) ? t.legs.map((l: any) => Number(l[0])).filter(Number.isFinite) : [];
  const end = legTs.length ? Math.max(...legTs) : Number(t.timestamp_ms), start = legTs.length ? Math.min(...legTs) : end - Number(t.hold_time) * 1000;
  const t0 = start - 120_000, t1 = end + 120_000;
  // the pool is found in the trade itself: the token vault of the counterparty in the buy tx (unique per pool).
  // Its history is read starting AT the trade (before = the sell/buy tx), not from today, so busy coins stay cheap.
  const buySig = String(t.ext_id || "").split(":")[2] || "";
  const anchors: { acct: string; before?: string }[] = [];
  if (buySig) {
    try {
      const tx = await rpc("getTransaction", [buySig, { encoding: "json", maxSupportedTransactionVersion: 1 }]);
      const keys: string[] = [...tx.transaction.message.accountKeys, ...(tx.meta.loadedAddresses?.writable || []), ...(tx.meta.loadedAddresses?.readonly || [])];
      const d = new Map<number, number>();
      for (const b of tx.meta.preTokenBalances || []) if (b.mint === t.mint) d.set(b.accountIndex, (d.get(b.accountIndex) || 0) - Number(b.uiTokenAmount?.uiAmountString || 0));
      for (const b of tx.meta.postTokenBalances || []) if (b.mint === t.mint) d.set(b.accountIndex, (d.get(b.accountIndex) || 0) + Number(b.uiTokenAmount?.uiAmountString || 0));
      let vault = "", big = 0; for (const [ix, v] of d) if (v < 0 && -v > big) { big = -v; vault = keys[ix]; }   // the account that GAVE the tokens to the buyer
      if (vault) anchors.push({ acct: vault });
    } catch (_) { /* fall back to listed pools */ }
  }
  try {
    const r = await fetch(`https://api.geckoterminal.com/api/v2/networks/solana/tokens/${t.mint}/pools?page=1`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(10000) });
    const j = await r.json();
    for (const p of (j?.data || []).slice(0, 3)) if (!p?.attributes?.pool_created_at || Date.parse(p.attributes.pool_created_at) <= t1) anchors.push({ acct: p.attributes.address });
  } catch (_) { /* vault only */ }
  if (!anchors.length) return false;
  const sup = Number((await rpc("getTokenSupply", [t.mint]))?.value?.uiAmountString || 0);
  if (!sup) return false;
  if (!priceSeries || priceSeries[0][0] > t0) await loadSolPrices(t0);
  const sigs = new Map<string, number>();
  for (const { acct } of anchors) {
    // jump near the trade first: page backwards from "now" only until we pass t1, then collect until t0
    let before: string | undefined;
    for (let page = 0; page < 12 && Date.now() < deadline - 25_000; page++) {
      const opts: any = { limit: 1000 }; if (before) opts.before = before;
      const list = await rpc("getSignaturesForAddress", [acct, opts]);
      if (!list?.length) break;
      let done = false;
      for (const s of list) { const ts = (s.blockTime || 0) * 1000; if (ts > t1 || s.err) continue; if (ts < t0) { done = true; break; } sigs.set(s.signature, ts); }
      if (done || list.length < 1000) break;
      before = list[list.length - 1].signature;
    }
    if (sigs.size > 40) break;                                        // the trade's own pool already gives plenty
  }
  let all = [...sigs.entries()].sort((a, b) => a[1] - b[1]);
  const N = HELIUS ? 200 : 60;
  if (all.length > N) { const k = all.length / N; all = Array.from({ length: N }, (_, i) => all[Math.floor(i * k)]); }   // even sample: plenty for ~50 candles
  // read order: coarse-to-fine across the whole window (every 8th, then every 4th…), fills' neighbourhood first,
  // so if the RPC is slow and time runs out, the chart still spans the whole window
  const near = (ts: number) => legTs.some((x: number) => Math.abs(x - ts) < 8_000);
  const order: number[] = [];
  all.forEach((x, i) => { if (near(x[1])) order.push(i); });
  for (const step of [8, 4, 2, 1]) for (let i = 0; i < all.length; i += step) if (!order.includes(i)) order.push(i);
  // the public RPC allows ~4 reads/s: pace them (Helius: parallel). Each read retried with backoff instead of dropped.
  const readTx = async (sig: string) => {
    for (let k = 0; k < 4; k++) {
      try {
        const r = await fetch(HELIUS ? RPCS_HIST[0] : "https://api.mainnet-beta.solana.com", { method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(12000),
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getTransaction", params: [sig, { encoding: "json", maxSupportedTransactionVersion: 1 }] }) });
        if (r.status === 429) { await sleep(1200 * (k + 1)); continue; }
        const j = await r.json();
        if (j?.error) { await sleep(1200 * (k + 1)); continue; }
        return j?.result || null;
      } catch (_) { await sleep(800); }
    }
    return null;
  };
  const pts: { ts: number; px: number }[] = [];
  if (HELIUS) {
    for (let i = 0; i < order.length && Date.now() < deadline - 4_000; i += 8) {
      const chunk = order.slice(i, i + 8).map((k) => all[k]);
      const txs = await Promise.all(chunk.map(([sig]) => readTx(sig)));
      txs.forEach((tx, j) => { const px = poolPrice(tx, t.mint, solUsdAt(chunk[j][1])); if (px > 0) pts.push({ ts: chunk[j][1], px }); });
    }
  } else {
    for (const k of order) {
      if (Date.now() > deadline - 4_000) break;
      const [sig, ts] = all[k], t0r = Date.now();
      const px = poolPrice(await readTx(sig), t.mint, solUsdAt(ts)); if (px > 0) pts.push({ ts, px });
      const wait = 280 - (Date.now() - t0r); if (wait > 0) await sleep(wait);
    }
  }
  if (pts.length < 4) return false;
  pts.sort((a, b) => a.ts - b.ts);
  const a = pts[0].ts, b = Math.max(pts[pts.length - 1].ts, Math.min(t1, end + 1000)), spanS = Math.max(1, (b - a) / 1000);
  const bucket = BUCKETS.find((x) => spanS / x <= 60) || 300, bms = bucket * 1000;
  const candles: number[][] = []; let prev: number | null = null;
  for (let k = a; k <= b && candles.length < 400; k += bms) {        // every bucket gets a candle (flat when nobody traded)
    const inB = pts.filter((x) => x.ts >= k && x.ts < k + bms).map((x) => x.px * sup);
    const o = prev ?? (inB[0] ?? pts[0].px * sup);
    if (inB.length) { candles.push([k, o, Math.max(o, ...inB), Math.min(o, ...inB), inB[inB.length - 1]]); prev = inB[inB.length - 1]; }
    else candles.push([k, o, o, o, o]);
  }
  const round = (n: number) => Math.round(n * 100) / 100;
  const marks = (Array.isArray(t.legs) ? t.legs : []).map((l: any) => [Number(l[0]), l[1], round(Number(l[2]) || 0)]).slice(0, 20);
  const chart = { v: 2, src: "chain", q: 2, i: bms, w: [a, b + bms], c: candles.map((c) => [c[0], round(c[1]), round(c[2]), round(c[3]), round(c[4])]), m: marks };
  const { error } = await db.from("trades").update({ chart }).eq("id", t.id);
  return !error;
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
  pumpGap = 2500;                                                    // default pacing; the on-demand path speeds it up
  const body: any = await req.json().catch(() => ({}));
  const task = ["images", "charts", "chart", "catchup"].includes(body?.task) ? body.task : "all";   // cron: images / charts passes; user: one chart

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
    if (task === "catchup") {                                         // extra passes only for wallets still catching up on history
      const { data } = await db.from("connected_accounts").select("*").gt("sync_pending", 0).order("sync_pending", { ascending: false }).limit(6);
      accounts = data || [];
    } else {
      const { data } = await db.from("connected_accounts").select("*").order("last_synced_at", { ascending: true, nullsFirst: true }).limit(60);
      accounts = data || [];
    }
  } else {
    const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: u, error } = await db.auth.getUser(jwt);
    if (error || !u?.user) return new Response('{"error":"unauthorized"}', { status: 401, headers: h });
    userId = u.user.id;
    if (task === "chart") {                                            // "open a card" / "cards on screen": build these charts now
      const raw = Array.isArray(body?.ids) ? body.ids : [body?.id];
      const ids = raw.map((x: any) => String(x || "")).filter((x: string) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 10);
      if (!ids.length) return new Response('{"error":"id"}', { status: 400, headers: h });
      pumpGap = 700;
      const dl = Date.now() + 55_000;
      let charts = 0; try { charts = await buildPumpCharts(dl, userId, ids); } catch (e) { console.error("chart", (e as Error).message); }
      try {                                                           // coins outside pump.fun (or thin minute data): candles from the chain
        const { data: rows } = await db.from("trades").select("id,mint,ext_id,legs,timestamp_ms,hold_time,chart").eq("user_id", userId).in("id", ids).not("mint", "is", null);
        for (const t of rows || []) {
          if (Date.now() > dl - 15_000) break;
          const weak = !t.chart || t.chart?.v !== 2 || (t.chart?.src === "gt" && (t.chart?.c?.length || 0) < 12);
          if (!weak || String(t.mint).endsWith("pump")) continue;
          if (await buildChainChart(t, dl)) charts++;
        }
      } catch (e) { console.error("chain chart", (e as Error).message); }
      return new Response(JSON.stringify({ charts }), { headers: h });
    }
    if (body?.task === "resync" && ["pumpfun", "fomo", "wallet"].includes(body?.provider)) {   // start this wallet over (cards are kept, duplicates impossible)
      await db.from("connected_accounts").update({ last_sig: null, sync_state: {}, sync_pending: 0, sync_error: null, last_synced_at: null })
        .eq("user_id", u.user.id).eq("provider", body.provider);
    }
    const { data } = await db.from("connected_accounts").select("*").eq("user_id", u.user.id);
    accounts = (data || []).filter((a) => !a.last_synced_at || Date.now() - Date.parse(a.last_synced_at) > MANUAL_COOLDOWN_MS || !a.last_sig);
  }

  let imported = 0, synced = 0, pending = 0, repaired = 0;
  const seen = new Set<string>();
  for (const acc of accounts) {
    if (Date.now() > deadline) break;
    const key = acc.user_id + ":" + acc.handle;
    if (seen.has(key)) continue; seen.add(key);                       // same wallet linked twice (e.g. Pump.fun + Fomo): read it once
    const { data: locked } = await db.rpc("try_lock_account", { p_id: acc.id, p_seconds: 150 });
    if (locked !== true) continue;                                    // another sync is already on this wallet
    try {
      // fair share: one huge wallet can't starve the others (its backlog continues in the catch-up passes)
      const r: any = await syncAccount(acc, accounts.length > 1 ? Math.min(deadline, Date.now() + 30_000) : deadline);
      imported += r.imported || 0; pending += r.pending || 0; synced++;
      if (r.error) await db.from("connected_accounts").update({ sync_error: r.error, last_synced_at: new Date().toISOString() }).eq("id", acc.id);
    } catch (e) {
      console.error("sync", acc.id, (e as Error).message);
      await db.from("connected_accounts").update({ sync_error: String((e as Error).message).slice(0, 200) }).eq("id", acc.id);
    } finally {
      await db.from("connected_accounts").update({ sync_lock_until: null }).eq("id", acc.id);
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
  const fresh = freshPump.splice(0);
  if (fresh.length && Date.now() < deadline - 10_000) { try { charts += await buildPumpCharts(deadline, null, fresh.slice(0, 15)); } catch (e) { console.error("charts", (e as Error).message); } }
  if (userId && Date.now() < deadline - 10_000) { try { charts += await buildPumpCharts(deadline, userId); } catch (e) { console.error("charts", (e as Error).message); } }
  let images = 0;
  if (userId && Date.now() < deadline - 10_000) { try { images = await fillCoinImages(deadline, userId); } catch (e) { console.error("images", (e as Error).message); } }
  return new Response(JSON.stringify({ synced, imported, pending, repaired, charts, images }), { headers: h });
});
