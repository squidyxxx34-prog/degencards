// DEGENCARDS — radar
// Feed of active Solana tokens with an on-chain SAFETY score (0-100). Run by pg_cron every 5 min (x-cron-key, same key as sync-trades).
// A high score only means fewer rug signals in what the chain and public APIs show right now: never a guarantee, never advice.
// Sources: pump.fun lists (unofficial API), DexScreener (activity, liquidity), Solana RPC (authorities, Token-2022 extensions,
// holders), RugCheck summary (extra risk flags). Writes public.radar_tokens with the service role; users only read it.
import { createClient } from "jsr:@supabase/supabase-js@2";

const db = createClient(Deno.env.get("SUPABASE_URL") || "http://x", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "x", { auth: { persistSession: false, autoRefreshToken: false } });
const HELIUS = Deno.env.get("HELIUS_API_KEY") || "";
const RPC = HELIUS ? `https://mainnet.helius-rpc.com/?api-key=${HELIUS}` : "https://api.mainnet-beta.solana.com";
const RPC_GAP = HELIUS ? 120 : 280;                                   // public RPC: ~4 reads/s
const B58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const SYSTEM = "11111111111111111111111111111111";
const POOL_AUTH = new Set(["5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1", "GpMZbSM2GgvTKHJirzeGfMFoaZ8UR2X7F4v8vHTvxFbL"]);   // Raydium AMM v4 / CPMM authorities
const BUDGET_MS = 115_000, MAX_DEEP = 24, MAX_IMAGES = 6;
const MIN_MC = 15_000, MIN_VOL_H1 = 3_000, MIN_TX_H1 = 40;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const clean = (s: unknown, n: number) => String(s ?? "").replace(/[\u0000-\u001f\u007f<>&"'`\\]/g, "").trim().slice(0, n);
const fin = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const text = (s: unknown, n: number) => String(s ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, n);
/* the coin's own links (X, Telegram, website…): https only, no credentials, short; kind from the host */
function link(u: unknown): { t: string; u: string } | null {
  try {
    const x = new URL(String(u ?? "").trim());
    if (x.protocol !== "https:" || x.username || x.password) return null;
    const h = x.hostname.replace(/^www\./, "").toLowerCase(), s = x.toString();
    if (s.length > 200 || /(^|\.)(pump\.fun|dexscreener\.com)$/.test(h)) return null;
    const t = /^(x|twitter)\.com$/.test(h) ? "x" : /^(t\.me|telegram\.me)$/.test(h) ? "telegram" : /(^|\.)discord\.(gg|com)$/.test(h) ? "discord"
      : /(^|\.)tiktok\.com$/.test(h) ? "tiktok" : /(^|\.)(youtube\.com|youtu\.be)$/.test(h) ? "youtube" : "website";
    return { t, u: s };
  } catch (_) { return null; }
}
function links(list: unknown[]): { t: string; u: string }[] {
  const out: { t: string; u: string }[] = [], seen = new Set<string>();
  for (const u of list) { const l = link(u); if (l && !seen.has(l.u) && !out.some((o) => o.t === l.t && l.t !== "website")) { seen.add(l.u); out.push(l); } }
  return out.slice(0, 5);
}
const CURVE_TOKENS = 793_100_000_000_000;                             // pump.fun: real token reserves of a fresh bonding curve (raw, 6 decimals)

async function getJson(url: string, ms = 10_000): Promise<any> {
  try { const r = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(ms) }); return r.ok ? await r.json() : null; }
  catch (_) { return null; }
}
let lastRpc = 0;
async function rpc(method: string, params: unknown[]): Promise<any> {
  for (let k = 0; k < 4; k++) {
    const wait = lastRpc + RPC_GAP - Date.now(); if (wait > 0) await sleep(wait); lastRpc = Date.now();
    try {
      const r = await fetch(RPC, { method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(12_000),
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
      if (r.status === 429 || r.status >= 500) { await sleep(1000 * (k + 1)); continue; }
      const j = await r.json();
      if (j?.error) { if (j.error.code === -32602) return null; await sleep(1000 * (k + 1)); continue; }
      return j?.result ?? null;
    } catch (_) { await sleep(800 * (k + 1)); }
  }
  throw new Error("rpc " + method);
}

/* ---------- 1. candidates ---------- */
type Pump = { creator: string; curve: string; pool: string; complete: boolean; name: string; symbol: string; image: string;
  description: string; links: string[]; curvePct: number | null; live: boolean };
function pumpInfo(c: any): Pump | null {
  if (!B58.test(c?.mint || "") || c.is_banned || c.nsfw) return null;
  const rtr = fin(c.real_token_reserves);
  return { creator: B58.test(c.creator || "") ? c.creator : "", curve: B58.test(c.bonding_curve || "") ? c.bonding_curve : "",
    pool: B58.test(c.pool_address || "") ? c.pool_address : "", complete: !!c.complete, name: clean(c.name, 64), symbol: clean(c.symbol, 24),
    image: typeof c.image_uri === "string" ? c.image_uri : "", description: text(c.description, 280),
    links: [c.twitter, c.telegram, c.website].filter((x) => typeof x === "string" && x),
    curvePct: c.complete ? 100 : rtr == null ? null : Math.max(0, Math.min(100, (CURVE_TOKENS - rtr) / CURVE_TOKENS * 100)), live: !!c.is_currently_live };
}
async function candidates(): Promise<{ mints: string[]; pump: Map<string, Pump> }> {
  const pump = new Map<string, Pump>(), set = new Set<string>();
  const lists = await Promise.all([
    getJson("https://frontend-api-v3.pump.fun/coins?offset=0&limit=50&sort=last_trade_timestamp&order=DESC&includeNsfw=false"),
    getJson("https://frontend-api-v3.pump.fun/coins/currently-live?offset=0&limit=50&includeNsfw=false"),
    getJson("https://frontend-api-v3.pump.fun/coins?offset=0&limit=50&sort=market_cap&order=DESC&includeNsfw=false&complete=false"),
  ]);
  for (const list of lists) for (const c of Array.isArray(list) ? list : []) {
    const p = pumpInfo(c); if (!p) continue;
    set.add(c.mint); pump.set(c.mint, p);
  }
  for (const u of ["https://api.dexscreener.com/token-profiles/latest/v1", "https://api.dexscreener.com/token-boosts/latest/v1"]) {
    const arr = await getJson(u);
    for (const p of Array.isArray(arr) ? arr : []) if (p?.chainId === "solana" && B58.test(p.tokenAddress || "")) set.add(p.tokenAddress);
  }
  // keep the current feed fresh: tokens that scored well recently are re-checked every pass (they drop out if they degrade)
  const { data: prev } = await db.from("radar_tokens").select("mint").gte("score", 70).gt("scanned_at", new Date(Date.now() - 3 * 3600e3).toISOString()).limit(40);
  for (const r of prev || []) set.add(r.mint);
  return { mints: [...set], pump };
}

/* ---------- 2. market data (DexScreener, 30 mints per call) ---------- */
type Market = { name: string; symbol: string; mc: number; liq: number; volH1: number; volH24: number; buys: number; sells: number; changeH1: number | null;
  createdAt: number | null; pairs: string[]; mainPair: string; image: string; dexIds: string[];
  changeM5: number | null; changeH6: number | null; changeH24: number | null; buys24: number; sells24: number; links: string[] };
async function markets(mints: string[]): Promise<Map<string, Market>> {
  const out = new Map<string, Market>();
  for (let i = 0; i < mints.length; i += 30) {
    const arr = await getJson(`https://api.dexscreener.com/tokens/v1/solana/${mints.slice(i, i + 30).join(",")}`);
    for (const p of Array.isArray(arr) ? arr : []) {
      const mint = p?.baseToken?.address; if (!B58.test(mint || "")) continue;
      const liq = fin(p.liquidity?.usd) || 0;
      const m = out.get(mint) || { name: clean(p.baseToken.name, 64), symbol: clean(p.baseToken.symbol, 24), mc: 0, liq: 0, volH1: 0, volH24: 0, buys: 0, sells: 0,
        changeH1: null, createdAt: null, pairs: [], mainPair: "", image: "", dexIds: [], changeM5: null, changeH6: null, changeH24: null, buys24: 0, sells24: 0, links: [], _best: -1 } as Market & { _best: number };
      const best = (m as any)._best;
      m.liq += liq; m.volH1 += fin(p.volume?.h1) || 0; m.volH24 += fin(p.volume?.h24) || 0;
      m.buys += fin(p.txns?.h1?.buys) || 0; m.sells += fin(p.txns?.h1?.sells) || 0;
      m.buys24 += fin(p.txns?.h24?.buys) || 0; m.sells24 += fin(p.txns?.h24?.sells) || 0;
      if (!m.links.length && p.info) m.links = [...(p.info.socials || []).map((x: any) => x?.url), ...(p.info.websites || []).map((x: any) => x?.url)].filter((x) => typeof x === "string");
      if (B58.test(p.pairAddress || "")) m.pairs.push(p.pairAddress);
      if (p.dexId) m.dexIds.push(String(p.dexId));
      const c = fin(p.pairCreatedAt); if (c && (!m.createdAt || c < m.createdAt)) m.createdAt = c;
      if (liq > best) {                                               // the deepest pool gives price, market cap and image
        (m as any)._best = liq; m.mc = fin(p.marketCap) || fin(p.fdv) || m.mc; m.changeH1 = fin(p.priceChange?.h1);
        m.changeM5 = fin(p.priceChange?.m5); m.changeH6 = fin(p.priceChange?.h6); m.changeH24 = fin(p.priceChange?.h24);
        m.mainPair = B58.test(p.pairAddress || "") ? p.pairAddress : m.mainPair; if (p.info?.imageUrl) m.image = String(p.info.imageUrl);
      }
      out.set(mint, m);
    }
  }
  return out;
}

/* ---------- 3. on-chain + RugCheck checks, score ---------- */
type Check = { k: string; s: 0 | 1 | 2; t: string; d: string };      // s: 2 pass, 1 so-so, 0 fail
const DANGER_EXT = new Set(["permanentDelegate", "nonTransferable", "transferHook", "transferFeeConfig", "defaultAccountState", "pausableConfig"]);
const FAKE_MAJORS = new Set(["SOL", "WSOL", "USDC", "USDT", "USDP", "PYUSD", "USDS", "USDE", "DAI", "BTC", "WBTC", "ETH", "WETH", "BNB", "XRP", "JUP", "BONK", "WIF", "TRUMP", "JTO", "PYTH", "RAY"]);
const pct = (x: number) => (x < 10 ? x.toFixed(1) : Math.round(x).toString()) + "%";

async function deepScan(mint: string, mk: Market, pm: Pump | undefined) {
  const checks: Check[] = []; let score = 0, cap = 100;
  const add = (k: string, pts: number, max: number, t: string, d: string) => { score += pts; checks.push({ k, s: pts >= max ? 2 : pts > 0 ? 1 : 0, t, d }); };

  const acc = await rpc("getAccountInfo", [mint, { encoding: "jsonParsed" }]);
  const info = acc?.value?.data?.parsed?.info;
  if (!info || acc?.value?.data?.parsed?.type !== "mint") return null;
  const decimals = Number(info.decimals) || 0, supply = Number(info.supply) / 10 ** decimals;
  if (!(supply > 0)) return null;

  const sym = (mk.symbol || pm?.symbol || "").replace(/^\$/, "").toUpperCase();
  const young = !mk.createdAt || Date.now() - mk.createdAt < 30 * 864e5;   // the real majors are years old
  if (FAKE_MAJORS.has(sym) && (young || !!pm)) { checks.push({ k: "name", s: 0, t: "Ticker", d: `Copies a major asset ($${sym})` }); cap = 40; }
  if (info.mintAuthority) { add("mint", 0, 15, "Mint authority", "Still active: supply can be inflated"); cap = 40; }
  else add("mint", 15, 15, "Mint authority", "Revoked");
  if (info.freezeAuthority) { add("freeze", 0, 15, "Freeze authority", "Still active: wallets can be frozen"); cap = 40; }
  else add("freeze", 15, 15, "Freeze authority", "Revoked");

  const exts: any[] = Array.isArray(info.extensions) ? info.extensions : [];
  const bad = exts.filter((e) => {
    if (!DANGER_EXT.has(e?.extension)) return false;
    const st = e.state || {};
    if (e.extension === "transferHook") return !!st.programId;
    if (e.extension === "transferFeeConfig") return Number(st.newerTransferFee?.transferFeeBasisPoints || 0) > 0 || Number(st.olderTransferFee?.transferFeeBasisPoints || 0) > 0;
    if (e.extension === "defaultAccountState") return st.accountState === "frozen";
    if (e.extension === "permanentDelegate") return !!st.delegate;
    return true;
  }).map((e) => e.extension);
  if (bad.length) { checks.push({ k: "ext", s: 0, t: "Token extensions", d: "Risky: " + bad.join(", ") }); cap = 40; }
  else checks.push({ k: "ext", s: 2, t: "Token extensions", d: "No transfer fee, hook or delegate" });

  // holders: largest token accounts, minus pools / bonding curve / program-owned vaults, grouped by wallet
  const largest = (await rpc("getTokenLargestAccounts", [mint]))?.value || [];
  const tokAccs: string[] = largest.map((a: any) => a.address).filter((a: string) => B58.test(a));
  const amount = new Map<string, number>(largest.map((a: any) => [a.address, Number(a.uiAmountString ?? a.uiAmount ?? 0)]));
  const owners = new Map<string, number>();
  if (tokAccs.length) {
    const parsed = (await rpc("getMultipleAccounts", [tokAccs, { encoding: "jsonParsed" }]))?.value || [];
    const ownerOf = tokAccs.map((a, i) => String(parsed[i]?.data?.parsed?.info?.owner || ""));
    const uniq = [...new Set(ownerOf.filter((o) => B58.test(o)))];
    const progOwner = new Map<string, string | null>();
    for (let i = 0; i < uniq.length; i += 100) {
      const r = (await rpc("getMultipleAccounts", [uniq.slice(i, i + 100), { encoding: "base64", dataSlice: { offset: 0, length: 0 } }]))?.value || [];
      uniq.slice(i, i + 100).forEach((o, j) => progOwner.set(o, r[j] ? String(r[j].owner) : null));
    }
    const pools = new Set([...mk.pairs, ...(pm ? [pm.curve, pm.pool] : [])].filter(Boolean));
    tokAccs.forEach((a, i) => {
      const o = ownerOf[i]; if (!o) return;
      const po = progOwner.get(o);
      if (pools.has(o) || POOL_AUTH.has(o) || (po && po !== SYSTEM)) return;   // pool, curve or program vault: not a holder
      owners.set(o, (owners.get(o) || 0) + (amount.get(a) || 0));
    });
  }
  const held = [...owners.entries()].sort((a, b) => b[1] - a[1]);
  const top10 = held.slice(0, 10).reduce((s, [, v]) => s + v, 0) / supply * 100;
  const biggest = held.length ? held[0][1] / supply * 100 : 0;
  add("top10", top10 <= 15 ? 20 : top10 <= 25 ? 15 : top10 <= 35 ? 8 : 0, 20, "Top 10 holders", pct(top10) + " of supply (pools excluded)");
  add("whale", biggest <= 5 ? 5 : biggest <= 10 ? 2 : 0, 5, "Biggest holder", pct(biggest) + " of supply");
  if (biggest > 10) cap = Math.min(cap, 70);                        // one wallet can dump the chart on its own

  let devPct: number | null = null;
  if (pm?.creator) {
    devPct = (owners.get(pm.creator) || 0) / supply * 100;
    add("dev", devPct <= 1 ? 10 : devPct <= 3 ? 6 : devPct <= 5 ? 3 : 0, 10, "Dev wallet", devPct < 0.05 ? "Holds nothing" : "Holds " + pct(devPct));
  } else add("dev", 5, 10, "Dev wallet", "Creator not identified");

  const onCurve = !!pm && !pm.complete && mk.dexIds.includes("pumpfun");
  if (onCurve) add("liq", 10, 10, "Liquidity", "pump.fun bonding curve: no LP to pull");
  else {
    const ratio = mk.mc > 0 ? mk.liq / mk.mc : 0;
    add("liq", mk.liq >= 25_000 && ratio >= 0.05 ? 10 : mk.liq >= 10_000 ? 6 : 0, 10, "Liquidity", mk.liq < 1 ? "No pool liquidity found" : "$" + Math.round(mk.liq).toLocaleString("en-US") + " in pools");
    if (mk.liq < 5_000) cap = Math.min(cap, 70);
  }

  const tx = mk.buys + mk.sells, ratio = mk.sells ? mk.buys / mk.sells : mk.buys ? 99 : 0;
  const organic = ratio >= 0.4 && ratio <= 3;
  if (tx >= 100 && ratio > 8) { add("activity", 0, 10, "Activity (1h)", `${mk.buys} buys / ${mk.sells} sells: sells look blocked or botted`); cap = Math.min(cap, 40); }
  else add("activity", tx >= 150 && organic ? 10 : tx >= 60 && organic ? 6 : 2, 10, "Activity (1h)", `${tx} trades, ${mk.buys} buys / ${mk.sells} sells`);

  const ageH = mk.createdAt ? (Date.now() - mk.createdAt) / 3600e3 : 0;
  if (mk.createdAt && ageH < 0.5) cap = Math.min(cap, 70);          // too fresh to judge holders and dev behaviour
  add("age", ageH >= 6 ? 5 : ageH >= 1 ? 3 : 0, 5, "Age", !mk.createdAt ? "Unknown" : ageH < 1 ? Math.round(ageH * 60) + " min" : ageH < 48 ? Math.round(ageH) + " h" : Math.round(ageH / 24) + " days");

  const rc = await getJson(`https://api.rugcheck.xyz/v1/tokens/${mint}/report/summary`, 8000);
  const risks: any[] = Array.isArray(rc?.risks) ? rc.risks : [];
  if (!rc) add("rugcheck", 5, 10, "RugCheck", "Unavailable");
  else {
    const danger = risks.filter((r) => r?.level === "danger").map((r) => clean(r.name, 40));
    const warns = risks.filter((r) => r?.level === "warn").length;
    if (danger.length) { add("rugcheck", 0, 10, "RugCheck", danger.slice(0, 3).join(", ")); cap = Math.min(cap, 60); }
    else add("rugcheck", warns > 2 ? 6 : 10, 10, "RugCheck", warns ? `${warns} warning${warns > 1 ? "s" : ""}, no danger` : "No risk flagged");
  }

  return { score: Math.max(0, Math.min(cap, Math.round(score))), checks, top10, devPct, biggest, supply, holders: held.length };
}

/* ---------- 4. logo copied to our bucket (CSP only allows our storage) ---------- */
const IMG_BUCKET = "coin-images", IMG_MAX = 3 * 1024 * 1024;
const IPFS_GW = ["https://gateway.pinata.cloud/ipfs/", "https://ipfs.io/ipfs/", "https://dweb.link/ipfs/"];
function variants(url: string): string[] {
  url = url.startsWith("ipfs://") ? "https://ipfs.io/ipfs/" + url.slice(7).replace(/^ipfs\//, "") : url;
  const m = url.match(/\/ipfs\/([A-Za-z0-9]+[^?#]*)/);
  return (m ? [...new Set([url, ...IPFS_GW.map((g) => g + m[1])])] : [url]).filter((u) => /^https:\/\//i.test(u));
}
function sniff(b: Uint8Array): [string, string] | null {
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return ["image/png", "png"];
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return ["image/jpeg", "jpg"];
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return ["image/gif", "gif"];
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return ["image/webp", "webp"];
  return null;
}
async function download(url: string): Promise<[Uint8Array, string, string] | null> {
  const r = await fetch(url, { signal: AbortSignal.timeout(10_000), redirect: "follow" });
  if (!r.ok || !r.body || Number(r.headers.get("content-length") || 0) > IMG_MAX) return null;
  const reader = r.body.getReader(); const parts: Uint8Array[] = []; let size = 0;
  while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > IMG_MAX) { try { reader.cancel(); } catch (_) {} return null; } parts.push(value); }
  const buf = new Uint8Array(size); let o = 0; for (const p of parts) { buf.set(p, o); o += p.length; }
  const k = sniff(buf); return k ? [buf, k[0], k[1]] : null;
}
async function copyImage(mint: string, srcs: string[]): Promise<string | null> {
  const { data: have } = await db.from("trades").select("image").eq("mint", mint).not("image", "is", null).limit(1);   // already stored for a card?
  if (have?.[0]?.image) return have[0].image;
  for (const src of srcs.filter(Boolean)) for (const v of variants(src)) {
    const got = await download(v).catch(() => null); if (!got) continue;
    const path = `${mint}.${got[2]}`;
    const { error } = await db.storage.from(IMG_BUCKET).upload(path, got[0], { contentType: got[1], upsert: true, cacheControl: "31536000" });
    if (error) { console.error("img upload", error.message); return null; }
    return db.storage.from(IMG_BUCKET).getPublicUrl(path).data.publicUrl;
  }
  return null;
}

/* ---------- pass ---------- */
async function pass() {
  const t0 = Date.now(), deadline = t0 + BUDGET_MS;
  const { mints, pump } = await candidates();
  const mk = await markets(mints);
  const pre = mints.filter((m) => { const x = mk.get(m); return x && x.mc >= MIN_MC && x.volH1 >= MIN_VOL_H1 && x.buys + x.sells >= MIN_TX_H1; })
    .sort((a, b) => mk.get(b)!.volH1 - mk.get(a)!.volH1).slice(0, MAX_DEEP);
  // tokens re-checked from the feed may be missing from this pass's pump.fun lists: fetch their pump.fun details one by one
  for (const mint of pre) if (!pump.has(mint) && (mint.endsWith("pump") || mk.get(mint)!.dexIds.some((d) => d.startsWith("pump")))) {
    const p = pumpInfo(await getJson(`https://frontend-api-v3.pump.fun/coins-v2/${mint}`, 8000)); if (p) pump.set(mint, p);
  }
  const { data: known } = await db.from("radar_tokens").select("mint,image,image_tries").in("mint", pre.length ? pre : ["x"]);
  const prev = new Map((known || []).map((r: any) => [r.mint, r]));
  let scanned = 0, passed = 0, images = 0, errors = 0; const sample: string[] = [];
  for (const mint of pre) {
    if (Date.now() > deadline - 12_000) break;
    const m = mk.get(mint)!, pm = pump.get(mint);
    try {
      const r = await deepScan(mint, m, pm); if (!r) continue;
      scanned++; if (r.score >= 80) passed++;
      sample.push(`${m.symbol}:${r.score}:${r.checks.filter((c) => c.s < 2).map((c) => c.k + "=" + c.d).join("|")}`);
      const row: any = { mint, symbol: m.symbol || pm?.symbol || "", name: m.name || pm?.name || "", source: pm ? "pumpfun" : "dex",
        graduated: !!pm?.complete || (!!pm && !m.dexIds.includes("pumpfun")), score: r.score, checks: r.checks,
        mc: m.mc || null, liq: m.liq || null, vol_h1: m.volH1, vol_h24: m.volH24, buys_h1: m.buys, sells_h1: m.sells, change_h1: m.changeH1,
        top10_pct: r.top10, dev_pct: r.devPct, holders_checked: r.holders, created_at_ms: m.createdAt, pair: m.mainPair || null, scanned_at: new Date().toISOString(),
        supply: r.supply, biggest_pct: r.biggest, change_m5: m.changeM5, change_h6: m.changeH6, change_h24: m.changeH24, buys_h24: m.buys24, sells_h24: m.sells24,
        curve_pct: pm?.curvePct ?? null, live: !!pm?.live, description: pm?.description || null, links: links([...(pm?.links || []), ...m.links]),
        pairs: [...new Set([m.mainPair, ...m.pairs].filter(Boolean))].slice(0, 4) };
      const p = prev.get(mint);
      if (r.score >= 80 && !p?.image && (p?.image_tries || 0) < 3 && images < MAX_IMAGES && Date.now() < deadline - 25_000) {
        const url = await copyImage(mint, [pm?.image || "", m.image]).catch(() => null);
        if (url) { row.image = url; images++; } else row.image_tries = (p?.image_tries || 0) + 1;
      }
      const { error } = await db.from("radar_tokens").upsert(row, { onConflict: "mint" });
      if (error) { errors++; console.error("upsert", mint, error.message); }
    } catch (e) { errors++; console.error("scan", mint, (e as Error).message); }
  }
  await db.from("radar_tokens").delete().lt("scanned_at", new Date(Date.now() - 24 * 3600e3).toISOString());   // forget tokens not seen for 24 h
  const res = { candidates: mints.length, withMarket: mk.size, prefiltered: pre.length, scanned, passed, images, errors, ms: Date.now() - t0, sample };
  console.log("radar", JSON.stringify(res));
  return res;
}

Deno.serve(async (req) => {
  const h = { "Content-Type": "application/json" };
  if (req.method !== "POST") return new Response('{"error":"method"}', { status: 405, headers: h });
  const k = req.headers.get("x-cron-key");
  const { data: ok } = k ? await db.rpc("verify_sync_cron_key", { k }) : { data: false };
  if (ok !== true) return new Response('{"error":"forbidden"}', { status: 403, headers: h });
  try { return new Response(JSON.stringify(await pass()), { headers: h }); }
  catch (e) { console.error("radar", (e as Error).message); return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: h }); }
});
