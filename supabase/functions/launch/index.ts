// DEGENCARDS — launch
// Coin launcher. Non-custodial: this function only BUILDS transactions; the user's own wallet signs and pays.
// It holds no user key and no user funds. The only key it ever signs with is a throwaway one (the new mint address,
// and the LP position NFT), which has no authority once the transaction has landed.
//   { action:"status" }                       -> config for the UI (paid mode live?, fee)
//   { action:"prepare", mode:"pump"|"lp", wallet, name, symbol, description?, twitter?, telegram?, website?, image (data URL),
//     devBuy (SOL), liquidity (SOL, lp only), accept:true }
//        pump: free. Token created on pump.fun (bonding curve) via PumpPortal, with the creator's initial buy in the same tx.
//        lp  : paid (flat fee in SOL to LAUNCH_FEE_WALLET, inside the creator's own transaction).
//              tx1: SPL mint (6 dec, 1B supply) + metadata (immutable) + mint authority revoked + fee
//              tx2: Meteora DAMM v2 pool with the whole supply + the creator's SOL, liquidity PERMANENTLY locked
//                   (the creator keeps the 1% trading fees), and the creator's initial buy in the same tx (first buyer).
//   { action:"resume", id }                   -> lp only: builds tx2 once tx1 has landed (also: retry if tx2 expired / failed)
//   { action:"send", id, tx }                 -> relays a tx the wallet signed (must touch this launch's mint), waits for confirmation
// Secrets: HELIUS_API_KEY (RPC), LAUNCH_FEE_WALLET (paid mode off until set), LAUNCH_FEE_SOL (default 0.15).
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction, ComputeBudgetProgram, VersionedTransaction, LAMPORTS_PER_SOL,
} from "npm:@solana/web3.js@1.98.0";
import {
  MINT_SIZE, TOKEN_PROGRAM_ID, NATIVE_MINT, AuthorityType, getAssociatedTokenAddressSync, createInitializeMint2Instruction,
  createAssociatedTokenAccountIdempotentInstruction, createMintToInstruction, createSetAuthorityInstruction,
} from "npm:@solana/spl-token@0.4.9";
import BN from "npm:bn.js@5.2.1";
import * as cp from "npm:@meteora-ag/cp-amm-sdk@1.5.1";
import { Buffer } from "node:buffer";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const HELIUS = Deno.env.get("HELIUS_API_KEY") || "";
const RPC = Deno.env.get("LAUNCH_RPC") || (HELIUS ? `https://mainnet.helius-rpc.com/?api-key=${HELIUS}` : "https://api.mainnet-beta.solana.com");
const FEE_WALLET = (Deno.env.get("LAUNCH_FEE_WALLET") || "").trim();
const FEE_SOL = Math.max(0, Number(Deno.env.get("LAUNCH_FEE_SOL") || "0.15")) || 0.15;
const ALLOWED_ORIGIN = "https://degencards.vercel.app";
const SITE = "https://degencards.vercel.app";
const MPL = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");
const DEC = 6, SUPPLY = new BN(1_000_000_000).mul(new BN(10).pow(new BN(DEC)));
const B58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const LIMITS = { pumpBuyMax: 20, lpLiqMin: 0.5, lpLiqMax: 1000, lpBuyMax: 100 };
// tickers / names people would mistake for something else
const RESERVED = new Set(["SOL","WSOL","USDC","USDT","BTC","WBTC","ETH","WETH","JUP","BONK","WIF","PYTH","JTO","RAY","ORCA","PUMP","TRUMP","MELANIA","DEGENCARDS","DEGEN CARDS"]);

const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const conn = new Connection(RPC, "confirmed");

function cors(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin === ALLOWED_ORIGIN ? ALLOWED_ORIGIN : "null",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}
class UserErr extends Error {}
const fail = (m: string) => { throw new UserErr(m); };
const b64 = (u8: Uint8Array) => Buffer.from(u8).toString("base64");
const cleanText = (s: unknown, max: number) => String(s ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
const cleanUrl = (s: unknown) => { const v = String(s ?? "").trim(); if (!v) return ""; try { const u = new URL(v.startsWith("http") ? v : "https://" + v); return u.protocol === "https:" ? u.toString().slice(0, 200) : ""; } catch (_) { return ""; } };
const sol = (v: unknown, min: number, max: number) => { const n = Number(v); if (!Number.isFinite(n) || n < min || n > max) return NaN; return Math.round(n * 1e9) / 1e9; };

/* ---------- metadata: image + JSON ---------- */
function parseImage(dataUrl: unknown) {
  const m = /^data:(image\/(png|jpeg|gif|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ""));
  if (!m) fail("image");
  const bytes = Buffer.from(m![3], "base64");
  if (bytes.length < 100 || bytes.length > 1_000_000) fail("image_size");
  return { type: m![1], ext: m![2] === "jpeg" ? "jpg" : m![2], bytes };
}
async function storePublic(path: string, body: Uint8Array | string, type: string) {
  const { error } = await db.storage.from("launch-meta").upload(path, body, { contentType: type, upsert: true });
  if (error) throw error;
  return db.storage.from("launch-meta").getPublicUrl(path).data.publicUrl;
}
// pump.fun's IPFS endpoint pins the image (+ metadata JSON for pump launches)
async function pumpIpfs(img: { type: string; ext: string; bytes: Uint8Array }, f: Record<string, string>) {
  const fd = new FormData();
  fd.append("file", new Blob([img.bytes], { type: img.type }), "image." + img.ext);
  for (const k of ["name", "symbol", "description", "twitter", "telegram", "website"]) if (f[k]) fd.append(k, f[k]);
  fd.append("showName", "true");
  const r = await fetch("https://pump.fun/api/ipfs", { method: "POST", body: fd, signal: AbortSignal.timeout(25000) });
  if (!r.ok) throw new Error("ipfs " + r.status);
  const j = await r.json();
  if (!j?.metadataUri || !j?.metadata?.image) throw new Error("ipfs body");
  return { uri: String(j.metadataUri), image: String(j.metadata.image) };
}

/* ---------- builders ---------- */
const str = (s: string) => { const b = Buffer.from(s, "utf8"); const l = Buffer.alloc(4); l.writeUInt32LE(b.length); return Buffer.concat([l, b]); };
function metadataIx(mint: PublicKey, auth: PublicKey, name: string, symbol: string, uri: string) {
  const [md] = PublicKey.findProgramAddressSync([Buffer.from("metadata"), MPL.toBuffer(), mint.toBuffer()], MPL);
  // CreateMetadataAccountV3: DataV2 { name, symbol, uri, seller_fee 0, creators None, collection None, uses None }, is_mutable=false, collection_details None
  const data = Buffer.concat([Buffer.from([33]), str(name), str(symbol), str(uri), Buffer.alloc(2), Buffer.from([0, 0, 0]), Buffer.from([0]), Buffer.from([0])]);
  return new TransactionInstruction({ programId: MPL, data, keys: [
    { pubkey: md, isSigner: false, isWritable: true }, { pubkey: mint, isSigner: false, isWritable: false },
    { pubkey: auth, isSigner: true, isWritable: false }, { pubkey: auth, isSigner: true, isWritable: true },
    { pubkey: auth, isSigner: false, isWritable: false }, { pubkey: SystemProgram.programId, isSigner: false, isWritable: false } ] });
}
const priority = (units: number) => [ComputeBudgetProgram.setComputeUnitLimit({ units }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 150_000 })];

async function buildLpTx1(user: PublicKey, mint: Keypair, name: string, symbol: string, uri: string, blockhash: string) {
  const ata = getAssociatedTokenAddressSync(mint.publicKey, user);
  const rent = await conn.getMinimumBalanceForRentExemption(MINT_SIZE);
  const tx = new Transaction().add(
    ...priority(120_000),
    SystemProgram.createAccount({ fromPubkey: user, newAccountPubkey: mint.publicKey, lamports: rent, space: MINT_SIZE, programId: TOKEN_PROGRAM_ID }),
    createInitializeMint2Instruction(mint.publicKey, DEC, user, null),                     // no freeze authority
    metadataIx(mint.publicKey, user, name, symbol, uri),
    createAssociatedTokenAccountIdempotentInstruction(user, ata, user, mint.publicKey),
    createMintToInstruction(mint.publicKey, ata, user, BigInt(SUPPLY.toString())),
    createSetAuthorityInstruction(mint.publicKey, user, AuthorityType.MintTokens, null),     // supply fixed forever
    SystemProgram.transfer({ fromPubkey: user, toPubkey: new PublicKey(FEE_WALLET), lamports: Math.round(FEE_SOL * LAMPORTS_PER_SOL) }),
  );
  tx.feePayer = user; tx.recentBlockhash = blockhash;
  tx.partialSign(mint);
  return tx.serialize({ requireAllSignatures: false, verifySignatures: false });
}
async function buildLpTx2(user: PublicKey, mint: PublicKey, liqSol: number, buySol: number, blockhash: string) {
  const amm = new cp.CpAmm(conn);
  const liq = new BN(Math.round(liqSol * LAMPORTS_PER_SOL));
  const { initSqrtPrice, liquidityDelta } = amm.preparePoolCreationParams({ tokenAAmount: SUPPLY, tokenBAmount: liq, minSqrtPrice: cp.MIN_SQRT_PRICE,
    maxSqrtPrice: cp.MAX_SQRT_PRICE, tokenADecimal: DEC, tokenBDecimal: 9, collectFeeMode: cp.CollectFeeMode.OnlyB } as any);
  const baseFee = cp.getBaseFeeParams({ baseFeeMode: cp.BaseFeeMode.FeeTimeSchedulerLinear, feeTimeSchedulerParam: { startingFeeBps: 100, endingFeeBps: 100, numberOfPeriod: 0, totalDuration: 0 } } as any, 9 as any, cp.ActivationType.Timestamp as any);
  const positionNft = Keypair.generate();
  const { tx: poolTx, pool } = await amm.createCustomPool({ payer: user, creator: user, positionNft: positionNft.publicKey, tokenAMint: mint, tokenBMint: NATIVE_MINT,
    tokenAAmount: SUPPLY, tokenBAmount: liq, sqrtMinPrice: cp.MIN_SQRT_PRICE, sqrtMaxPrice: cp.MAX_SQRT_PRICE, liquidityDelta, initSqrtPrice,
    poolFees: { baseFee, compoundingFeeBps: 0, padding: 0, dynamicFee: null }, hasAlphaVault: false, activationType: cp.ActivationType.Timestamp,
    collectFeeMode: cp.CollectFeeMode.OnlyB, activationPoint: null, tokenAProgram: TOKEN_PROGRAM_ID, tokenBProgram: TOKEN_PROGRAM_ID, isLockLiquidity: true } as any);
  const ixs = poolTx.instructions.filter((i: TransactionInstruction) => !i.programId.equals(ComputeBudgetProgram.programId));
  if (buySol > 0) {                                                    // creator's buy, same tx: nobody can buy before it
    const swapTx = await amm.swap({ payer: user, pool, inputTokenMint: NATIVE_MINT, outputTokenMint: mint, amountIn: new BN(Math.round(buySol * LAMPORTS_PER_SOL)),
      minimumAmountOut: new BN(1), tokenAMint: mint, tokenBMint: NATIVE_MINT, tokenAVault: cp.deriveTokenVaultAddress(mint, pool), tokenBVault: cp.deriveTokenVaultAddress(NATIVE_MINT, pool),
      tokenAProgram: TOKEN_PROGRAM_ID, tokenBProgram: TOKEN_PROGRAM_ID, referralTokenAccount: null,
      poolState: { poolFees: { baseFee: { baseFeeInfo: { data: Buffer.alloc(40) } } } } } as any);   // fresh pool, flat fee: no state to fetch
    ixs.push(...swapTx.instructions.filter((i: TransactionInstruction) => !i.programId.equals(ComputeBudgetProgram.programId)));
  }
  const tx = new Transaction().add(...priority(400_000), ...ixs);
  tx.feePayer = user; tx.recentBlockhash = blockhash;
  tx.partialSign(positionNft);
  return { raw: tx.serialize({ requireAllSignatures: false, verifySignatures: false }), pool: pool.toBase58() };
}
async function buildPumpTx(user: PublicKey, mint: Keypair, name: string, symbol: string, uri: string, buySol: number) {
  const r = await fetch("https://pumpportal.fun/api/trade-local", { method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(20000),
    body: JSON.stringify({ publicKey: user.toBase58(), action: "create", tokenMetadata: { name, symbol, uri }, mint: mint.publicKey.toBase58(),
      denominatedInSol: "true", amount: buySol, slippage: 10, priorityFee: 0.0005, pool: "pump" }) });
  if (!r.ok) throw new Error("pumpportal " + r.status + " " + (await r.text()).slice(0, 200));
  const tx = VersionedTransaction.deserialize(new Uint8Array(await r.arrayBuffer()));
  const keys = tx.message.staticAccountKeys.map((k) => k.toBase58());
  if (keys[0] !== user.toBase58() || !keys.includes(mint.publicKey.toBase58())) throw new Error("pumpportal tx shape");
  tx.sign([mint]);
  return tx.serialize();
}

/* ---------- send + confirm ---------- */
async function sendAndConfirm(raw: Uint8Array) {
  const sig = await conn.sendRawTransaction(raw, { skipPreflight: false, maxRetries: 5 });
  for (let i = 0; i < 45; i++) {
    const st = (await conn.getSignatureStatuses([sig])).value[0];
    if (st?.err) return { sig, ok: false, err: JSON.stringify(st.err) };
    if (st && (st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized")) return { sig, ok: true };
    await new Promise((r) => setTimeout(r, 1000));
  }
  return { sig, ok: false, err: "timeout" };
}
function touchesMint(raw: Uint8Array, mint: string) {
  try { return VersionedTransaction.deserialize(raw).message.staticAccountKeys.some((k) => k.toBase58() === mint); } catch (_) { return false; }
}

export { buildLpTx1, buildLpTx2, buildPumpTx, sendAndConfirm, touchesMint, parseImage };
if (!Deno.env.get("LOCAL_TEST")) Deno.serve(async (req) => {
  const origin = req.headers.get("Origin"), h = { ...cors(origin), "Content-Type": "application/json" };
  const out = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: h });
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  if (req.method !== "POST") return out({ error: "method" }, 405);
  const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: au } = await db.auth.getUser(jwt);
  const uid = au?.user?.id;
  if (!uid) return out({ error: "auth" }, 401);
  let body: any = {};
  try { body = await req.json(); } catch (_) { /* empty */ }

  try {
    if (body.action === "status") return out({ lp: !!FEE_WALLET && B58.test(FEE_WALLET), feeSol: FEE_SOL, limits: LIMITS });

    if (body.action === "prepare") {
      if (body.accept !== true) fail("accept");
      const mode = body.mode === "lp" ? "lp" : "pump";
      if (mode === "lp" && !(FEE_WALLET && B58.test(FEE_WALLET))) fail("lp_off");
      if (!B58.test(String(body.wallet || ""))) fail("wallet");
      const user = new PublicKey(body.wallet);
      const name = cleanText(body.name, 32), symbol = cleanText(body.symbol, 10).toUpperCase().replace(/[^A-Z0-9]/g, "");
      if (name.length < 2) fail("name");
      if (symbol.length < 2) fail("symbol");
      if (RESERVED.has(symbol) || RESERVED.has(name.toUpperCase())) fail("reserved");
      const f = { name, symbol, description: cleanText(body.description, 500), twitter: cleanUrl(body.twitter), telegram: cleanUrl(body.telegram), website: cleanUrl(body.website) };
      const buy = sol(body.devBuy ?? 0, 0, mode === "lp" ? LIMITS.lpBuyMax : LIMITS.pumpBuyMax);
      const liq = mode === "lp" ? sol(body.liquidity, LIMITS.lpLiqMin, LIMITS.lpLiqMax) : 0;
      if (!Number.isFinite(buy)) fail("buy");
      if (mode === "lp" && !Number.isFinite(liq)) fail("liquidity");
      if (mode === "lp" && buy > liq) fail("buy_share");                // creator never takes more than half the supply
      // rate limit: 5 prepared launches per hour per user
      const { count } = await db.from("launches").select("id", { count: "exact", head: true }).eq("user_id", uid).gte("created_at", new Date(Date.now() - 3600e3).toISOString());
      if ((count || 0) >= 5) fail("rate");
      // balance check (approx.: rent + network fees ~0.05 SOL)
      const need = buy + (mode === "lp" ? liq + FEE_SOL + 0.06 : 0.04);
      const bal = (await conn.getBalance(user)) / LAMPORTS_PER_SOL;
      if (bal < need) return out({ error: "balance", need: Math.ceil(need * 1000) / 1000, have: Math.floor(bal * 1000) / 1000 }, 400);

      const img = parseImage(body.image);
      const mint = Keypair.generate(), mintStr = mint.publicKey.toBase58();
      const appImage = await storePublic(`${mintStr}/image.${img.ext}`, img.bytes, img.type);
      let uri = "", image = appImage;
      try { const p = await pumpIpfs(img, f); image = p.image; uri = p.uri; } catch (e) { console.error(e); if (mode === "pump") fail("ipfs"); }
      if (mode === "lp") {                                             // our own metadata JSON (image pinned on IPFS when possible)
        const meta = { name, symbol, description: f.description, image, external_url: f.website || undefined,
          extensions: { twitter: f.twitter || undefined, telegram: f.telegram || undefined, website: f.website || undefined }, createdOn: SITE };
        uri = await storePublic(`${mintStr}/metadata.json`, JSON.stringify(meta), "application/json");
      }
      const { blockhash } = await conn.getLatestBlockhash("confirmed");
      let txs: string[] = [], pool: string | null = null;
      if (mode === "pump") txs = [b64(await buildPumpTx(user, mint, name, symbol, uri, buy))];
      else {                                                           // tx2 (pool) is built once tx1 has landed (action "resume"): each tx the wallet sees simulates cleanly
        txs = [b64(await buildLpTx1(user, mint, name, symbol, uri, blockhash))];
        pool = cp.deriveCustomizablePoolAddress(mint.publicKey, NATIVE_MINT).toBase58();
      }
      const { data: row, error } = await db.from("launches").insert({ user_id: uid, mode, wallet: user.toBase58(), mint: mintStr, pool, name, symbol, image: appImage, uri,
        dev_buy_sol: buy, liquidity_sol: mode === "lp" ? liq : null, fee_sol: mode === "lp" ? FEE_SOL : 0 }).select("id").single();
      if (error) throw error;
      return out({ id: row.id, mint: mintStr, pool, txs, feeSol: mode === "lp" ? FEE_SOL : 0 });
    }

    if (body.action === "resume") {                                    // lp: token exists, pool tx missing or expired
      const { data: L } = await db.from("launches").select("*").eq("id", String(body.id || "")).eq("user_id", uid).maybeSingle();
      if (!L || L.mode !== "lp" || L.status === "live") fail("resume");
      const mintPk = new PublicKey(L.mint);
      if (!(await conn.getAccountInfo(mintPk))) fail("resume_restart");    // tx1 never landed: start over
      const { blockhash } = await conn.getLatestBlockhash("confirmed");
      const t2 = await buildLpTx2(new PublicKey(L.wallet), mintPk, Number(L.liquidity_sol), Number(L.dev_buy_sol), blockhash);
      await db.from("launches").update({ pool: t2.pool }).eq("id", L.id);
      return out({ id: L.id, mint: L.mint, pool: t2.pool, txs: [b64(t2.raw)], resume: true });
    }

    if (body.action === "send") {
      const { data: L } = await db.from("launches").select("*").eq("id", String(body.id || "")).eq("user_id", uid).maybeSingle();
      if (!L) fail("send");
      const raw = new Uint8Array(Buffer.from(String(body.tx || ""), "base64"));
      if (raw.length < 100 || raw.length > 1232 || !touchesMint(raw, L.mint)) fail("send_tx");
      const r = await sendAndConfirm(raw);
      const sigs = [...(L.sigs || []), r.sig];
      const last = L.mode === "pump" || (!!L.pool && touchesMint(raw, L.pool));   // pump: single tx; lp: the pool tx
      await db.from("launches").update({ sigs, ...(r.ok && last ? { status: "live", live_at: new Date().toISOString(), error: null } : {}), ...(!r.ok ? { error: r.err } : {}) }).eq("id", L.id);
      return out(r);
    }
    return out({ error: "action" }, 400);
  } catch (e) {
    if (e instanceof UserErr) return out({ error: e.message }, 400);
    const msg = String((e as Error)?.message || e);
    console.error(msg);
    if (/blockhash/i.test(msg)) return out({ error: "expired" }, 400);
    if (/insufficient|0x1\b/i.test(msg)) return out({ error: "balance" }, 400);
    return out({ error: "server", detail: msg.slice(0, 200) }, 500);
  }
});
