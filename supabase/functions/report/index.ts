// DEGENCARDS — report
// A short AI read of the user's own recent trades (Home > REPORT). One report per user per UTC day, cached in
// public.ai_reports, so a user costs at most one model call a day.
//   POST { action:"status" }          -> { live }   (false until the ANTHROPIC_API_KEY secret is set: the app hides the section)
//   POST { action:"get" }             -> { report, day } today's report, generated on first ask
// The stats are computed HERE from public.trades (never sent by the client), last 30 days, and only the free-plan
// figures are given to the model (no profit factor, drawdown, best hour or top coin: those stay PRO).
// Secret: ANTHROPIC_API_KEY. Optional: REPORT_MODEL (default claude-haiku-5-5).
import { createClient } from "jsr:@supabase/supabase-js@2";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });
const KEY = Deno.env.get("ANTHROPIC_API_KEY") || "";
const MODEL = Deno.env.get("REPORT_MODEL") || "claude-haiku-5-5";
const ORIGIN = "https://degencards.vercel.app";
const cors = (o: string | null) => ({ "Access-Control-Allow-Origin": o === ORIGIN ? ORIGIN : "null", "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info", "Access-Control-Allow-Methods": "POST, OPTIONS", "Vary": "Origin" });

type T = { pnl: number; roi: number; timestamp_ms: number; hold_time: number | null; ticker: string | null };

function stats(rows: T[], now: number) {
  const r2 = (v: number) => Math.round(v * 100) / 100;
  const sum = (a: T[]) => r2(a.reduce((s, t) => s + (+t.pnl || 0), 0));
  const wr = (a: T[]) => a.length ? Math.round(a.filter(t => t.pnl > 0).length / a.length * 100) : null;
  const d7 = rows.filter(t => t.timestamp_ms >= now - 7 * 864e5), p7 = rows.filter(t => t.timestamp_ms >= now - 14 * 864e5 && t.timestamp_ms < now - 7 * 864e5);
  const wins = rows.filter(t => t.pnl > 0), losses = rows.filter(t => t.pnl < 0);
  const avg = (a: T[]) => a.length ? r2(a.reduce((s, t) => s + (+t.pnl || 0), 0) / a.length) : null;
  const hold = (a: number, b: number) => { const L = rows.filter(t => (t.hold_time || 0) >= a && (t.hold_time || 0) < b); return { trades: L.length, pnl: sum(L), win_rate: wr(L) }; };
  const days = new Set(rows.map(t => new Date(t.timestamp_ms).toISOString().slice(0, 10)));
  let curL = 0; for (const t of [...rows].sort((a, b) => b.timestamp_ms - a.timestamp_ms)) { if (t.pnl < 0) curL++; else break; }
  const best = rows.reduce((m: T | null, t) => !m || t.pnl > m.pnl ? t : m, null), worst = rows.reduce((m: T | null, t) => !m || t.pnl < m.pnl ? t : m, null);
  const tk = (t: T | null) => t ? String(t.ticker || "?").replace(/[^A-Za-z0-9$_.-]/g, "").slice(0, 16) : null;
  return {
    window: "last 30 days", trades: rows.length, pnl: sum(rows), win_rate: wr(rows), trading_days: days.size,
    avg_win: avg(wins), avg_loss: avg(losses),
    last_7_days: { trades: d7.length, pnl: sum(d7), win_rate: wr(d7) }, previous_7_days: { trades: p7.length, pnl: sum(p7), win_rate: wr(p7) },
    hold_time: { under_30s: hold(0, 30), "30s_to_5m": hold(30, 300), "5m_to_1h": hold(300, 3600), over_1h: hold(3600, 1e12) },
    biggest_win: best && best.pnl > 0 ? { ticker: tk(best), pnl: r2(best.pnl), roi: r2(best.roi) } : null,
    biggest_loss: worst && worst.pnl < 0 ? { ticker: tk(worst), pnl: r2(worst.pnl), roi: r2(worst.roi) } : null,
    current_losing_streak: curL,
  };
}

const SYSTEM = `You are the trading coach inside DEGENCARDS, an app where Solana memecoin traders turn their closed trades into cards.
Write a brief report on the trader's last 30 days from the JSON stats you are given. Rules:
- 3 to 5 short bullet points, then one line starting with "Focus:" giving the single most useful thing to change or keep doing.
- Under 110 words in total. Plain English, direct, a little degen in tone, never cringe. No emoji, no hashtags, no markdown headers.
- Every claim must come from the numbers given. Quote the key figures ($ and %). Never invent trades, prices or coins.
- No financial advice: never tell them to buy, sell or hold a coin. Talk about their own behaviour (hold times, sizing of wins vs losses, consistency, tilt after losses).
- If there are fewer than 5 trades, say there is not enough data yet and keep it to 2 lines.`;

async function generate(s: unknown) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: MODEL, max_tokens: 400, system: SYSTEM, messages: [{ role: "user", content: "Stats:\n" + JSON.stringify(s) }] }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`anthropic ${r.status}: ${JSON.stringify(j).slice(0, 200)}`);
  const text = (j.content || []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("").trim();
  if (!text) throw new Error("empty");
  return text.slice(0, 3000);
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  const j = (b: unknown, s: number) => new Response(JSON.stringify(b), { status: s, headers: { ...cors(origin), "Content-Type": "application/json" } });
  if (req.method !== "POST") return j({ error: "method" }, 405);
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: au } = await db.auth.getUser(token);
  const uid = au?.user?.id;
  if (!uid) return j({ error: "auth" }, 401);
  let body: any = {}; try { body = await req.json(); } catch (_) { /* empty */ }
  if (body.action === "status") return j({ live: !!KEY }, 200);
  if (!KEY) return j({ error: "not_configured" }, 503);
  const day = new Date().toISOString().slice(0, 10);
  const { data: cached } = await db.from("ai_reports").select("body, created_at").eq("user_id", uid).eq("day", day).maybeSingle();
  if (cached) return j({ report: cached.body, day, at: cached.created_at }, 200);
  const now = Date.now();
  const { data: rows, error } = await db.from("trades").select("pnl, roi, timestamp_ms, hold_time, ticker")
    .eq("user_id", uid).is("deleted_at", null).gte("timestamp_ms", now - 30 * 864e5).order("timestamp_ms", { ascending: false }).limit(2000);
  if (error) return j({ error: "db" }, 500);
  if (!rows || rows.length < 3) return j({ error: "few_trades" }, 200);
  try {
    const text = await generate(stats(rows as T[], now));
    await db.from("ai_reports").upsert({ user_id: uid, day, body: text }, { onConflict: "user_id,day" });
    return j({ report: text, day, at: new Date().toISOString() }, 200);
  } catch (e) {
    console.error(e);
    return j({ error: "model" }, 502);
  }
});
