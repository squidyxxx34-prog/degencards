// DEGENCARDS — report
// A short, neutral, analytical read of the user's own last 30 days (Home > REPORT). Costs nothing:
//   - always: a factual analysis computed here from public.trades (no model, no API, $0), recomputed on each ask
//   - optional: if the GROQ_API_KEY secret is set (Groq free tier, no card), the same facts are rewritten by an open
//     model (Llama) into a tighter read; cached once per user per UTC day in public.ai_reports, so the free quota holds.
//   POST { action:"status" } -> { live:true, ai }
//   POST { action:"get" }    -> { report, day, source:"ai"|"auto" }
// Neutral by design: it describes what the trades show, never judges, never advises.
// Only free-plan figures are used (no profit factor, drawdown, best hour or top coin: those stay PRO).
import { createClient } from "jsr:@supabase/supabase-js@2";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });
const GROQ = Deno.env.get("GROQ_API_KEY") || "";
const MODEL = Deno.env.get("REPORT_MODEL") || "llama-3.3-70b-versatile";
const ORIGIN = "https://degencards.vercel.app";
const cors = (o: string | null) => ({ "Access-Control-Allow-Origin": o === ORIGIN ? ORIGIN : "null", "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info", "Access-Control-Allow-Methods": "POST, OPTIONS", "Vary": "Origin" });

type T = { pnl: number; roi: number; timestamp_ms: number; hold_time: number | null; ticker: string | null };
const usd = (v: number) => (v < 0 ? "-" : "+") + "$" + Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const abs$ = (v: number) => "$" + Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (a: number, b: number) => b ? Math.round(a / b * 100) : 0;
const dur = (s: number) => s < 60 ? `${Math.round(s)}s` : s < 3600 ? `${Math.floor(s / 60)}m ${Math.round(s % 60)}s` : `${Math.floor(s / 3600)}h ${Math.round(s % 3600 / 60)}m`;

// facts: one neutral sentence each, figures only
function facts(rows: T[], now: number): string[] {
  const sum = (a: T[]) => a.reduce((s, t) => s + (+t.pnl || 0), 0);
  const wins = rows.filter(t => t.pnl > 0), losses = rows.filter(t => t.pnl < 0);
  const days = new Set(rows.map(t => new Date(t.timestamp_ms).toISOString().slice(0, 10)));
  const out: string[] = [];
  out.push(`${rows.length} trades over ${days.size} trading day${days.size > 1 ? "s" : ""} (${(rows.length / Math.max(1, days.size)).toFixed(1)} per active day). Net ${usd(sum(rows))}, ${pct(wins.length, rows.length)}% of trades closed green.`);
  if (wins.length && losses.length) {
    const aw = sum(wins) / wins.length, al = Math.abs(sum(losses) / losses.length);
    out.push(`Average win ${abs$(aw)}, average loss ${abs$(al)}: a win is ${(aw / al).toFixed(2)}x the size of a loss.`);
  }
  const B: [string, number, number][] = [["under 30s", 0, 30], ["30s to 5m", 30, 300], ["5m to 1h", 300, 3600], ["over 1h", 3600, 1e12]];
  const bk = B.map(([l, a, b]) => { const L = rows.filter(t => (t.hold_time || 0) >= a && (t.hold_time || 0) < b); return { l, n: L.length, p: sum(L), w: pct(L.filter(t => t.pnl > 0).length, L.length) }; }).filter(b => b.n);
  if (bk.length) {
    const main = bk.slice().sort((a, b) => b.n - a.n)[0];
    out.push(`Most trades are held ${main.l} (${pct(main.n, rows.length)}%). By hold time: ${bk.map(b => `${b.l} ${usd(b.p)} at ${b.w}% green (${b.n})`).join("; ")}.`);
  }
  const holds = rows.map(t => t.hold_time || 0).sort((a, b) => a - b);
  if (holds.length) out.push(`Median hold ${dur(holds[holds.length >> 1])}; winners median ${dur(med(wins))}, losers median ${dur(med(losses))}.`);
  const d7 = rows.filter(t => t.timestamp_ms >= now - 7 * 864e5), p7 = rows.filter(t => t.timestamp_ms >= now - 14 * 864e5 && t.timestamp_ms < now - 7 * 864e5);
  if (d7.length || p7.length) out.push(`Last 7 days: ${d7.length} trades, ${usd(sum(d7))}, ${pct(d7.filter(t => t.pnl > 0).length, d7.length)}% green. The 7 days before: ${p7.length} trades, ${usd(sum(p7))}${p7.length ? `, ${pct(p7.filter(t => t.pnl > 0).length, p7.length)}% green` : ""}.`);
  const asc = rows.slice().sort((a, b) => a.timestamp_ms - b.timestamp_ms);
  let afterL = 0, afterLW = 0; for (let i = 1; i < asc.length; i++) if (asc[i - 1].pnl < 0) { afterL++; if (asc[i].pnl > 0) afterLW++; }
  if (afterL >= 5) out.push(`Right after a losing trade, the next one closes green ${pct(afterLW, afterL)}% of the time (${afterL} cases), against ${pct(wins.length, rows.length)}% overall.`);
  const best = wins.slice().sort((a, b) => b.pnl - a.pnl)[0], worst = losses.slice().sort((a, b) => a.pnl - b.pnl)[0];
  const tk = (t: T) => "$" + String(t.ticker || "?").replace(/^\$/, "").replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 16);
  if (best && sum(wins) > 0) out.push(`Largest win ${tk(best)} ${usd(best.pnl)} (${pct(best.pnl, sum(wins))}% of all gains)${worst ? `; largest loss ${tk(worst)} ${usd(worst.pnl)} (${pct(Math.abs(worst.pnl), Math.abs(sum(losses)))}% of all losses)` : ""}.`);
  return out;
  function med(a: T[]) { const h = a.map(t => t.hold_time || 0).sort((x, y) => x - y); return h.length ? h[h.length >> 1] : 0; }
}

const SYSTEM = `You rewrite trading statistics into a short analytical report for the trader who made the trades.
Rules:
- 4 to 6 bullet points starting with "- ". Under 110 words in total. English.
- Neutral and analytical: describe what the numbers show and how the figures relate (patterns, contrasts, distributions).
- No judgment and no advice: never use words like good, bad, great, poor, mistake, should, must, try, avoid, improve, discipline, tilt. No praise, no warnings.
- Use only the facts given. Keep every figure exactly as written. Never add numbers, coins or reasons that are not in the facts.
- No emoji, no headers, no intro or conclusion sentence.`;

async function rewrite(f: string[]) {
  const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${GROQ}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, temperature: 0.2, max_tokens: 350, messages: [{ role: "system", content: SYSTEM }, { role: "user", content: "Facts:\n" + f.map(x => "- " + x).join("\n") }] }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`groq ${r.status}: ${JSON.stringify(j).slice(0, 200)}`);
  const text = String(j.choices?.[0]?.message?.content || "").trim();
  if (!text || !/^\s*-/m.test(text)) throw new Error("empty");
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
  if (body.action === "status") return j({ live: true, ai: !!GROQ }, 200);
  const now = Date.now(), day = new Date(now).toISOString().slice(0, 10);
  if (GROQ) {
    const { data: cached } = await db.from("ai_reports").select("body, created_at").eq("user_id", uid).eq("day", day).maybeSingle();
    if (cached) return j({ report: cached.body, day, source: "ai" }, 200);
  }
  const { data: rows, error } = await db.from("trades").select("pnl, roi, timestamp_ms, hold_time, ticker")
    .eq("user_id", uid).is("deleted_at", null).gte("timestamp_ms", now - 30 * 864e5).order("timestamp_ms", { ascending: false }).limit(2000);
  if (error) return j({ error: "db" }, 500);
  if (!rows || rows.length < 3) return j({ error: "few_trades" }, 200);
  const f = facts(rows as T[], now);
  if (GROQ) {
    try {
      const text = await rewrite(f);
      await db.from("ai_reports").upsert({ user_id: uid, day, body: text }, { onConflict: "user_id,day" });
      return j({ report: text, day, source: "ai" }, 200);
    } catch (e) { console.error(e); /* free quota hit or model down: the factual report below */ }
  }
  return j({ report: f.map(x => "- " + x).join("\n"), day, source: "auto" }, 200);
});
