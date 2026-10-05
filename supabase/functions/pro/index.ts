// DEGENCARDS — pro
// Delivers the PRO studio code (studio.js) ONLY to a verified subscriber. The code is never a static file.
//   POST (user JWT)  -> { ticket }  one-time, 60 s, only if public.subscriptions says PRO
//   GET  ?t=<ticket> -> the studio script (application/javascript, no-store); the ticket is burnt on use
// verify_jwt = false: the GET comes from a <script> tag (no header); every path does its own checks.
// The studio code lives in public.pro_assets (service role only), loaded from supabase/functions/pro/studio.js by
// supabase/pro_assets.sql — update both together.
import { createClient } from "jsr:@supabase/supabase-js@2";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });
const ORIGIN = "https://degencards.vercel.app";
const PRO = new Set(["active", "trialing", "completed", "canceling", "past_due"]);
const cors = (o: string | null) => ({ "Access-Control-Allow-Origin": o === ORIGIN ? ORIGIN : "null", "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info", "Access-Control-Allow-Methods": "POST, OPTIONS", "Vary": "Origin" });

async function isPro(uid: string) {
  const { data } = await db.from("subscriptions").select("status, renews_at").eq("user_id", uid).maybeSingle();
  return !!(data && PRO.has(data.status) && (!data.renews_at || new Date(data.renews_at).getTime() > Date.now() - 3 * 864e5));
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });

  if (req.method === "GET") {
    const deny = () => new Response("/* PRO only */", { status: 403, headers: { "Content-Type": "application/javascript", "Cache-Control": "no-store" } });
    const t = new URL(req.url).searchParams.get("t") || "";
    if (!/^[a-f0-9]{64}$/.test(t)) return deny();
    const { data } = await db.from("pro_tickets").delete().eq("ticket", t).gt("expires_at", new Date().toISOString()).select("user_id").maybeSingle();
    if (!data || !(await isPro(data.user_id))) return deny();
    const { data: a } = await db.from("pro_assets").select("body").eq("name", "studio").maybeSingle();
    if (!a) return deny();
    return new Response(a.body, { status: 200, headers: { "Content-Type": "application/javascript; charset=utf-8", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  }

  if (req.method !== "POST") return new Response("method", { status: 405, headers: cors(origin) });
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: au } = await db.auth.getUser(token);
  const uid = au?.user?.id;
  const j = (b: unknown, s: number) => new Response(JSON.stringify(b), { status: s, headers: { ...cors(origin), "Content-Type": "application/json" } });
  if (!uid) return j({ error: "auth" }, 401);
  if (!(await isPro(uid))) return j({ error: "not_pro" }, 403);
  const b = new Uint8Array(32); crypto.getRandomValues(b);
  const ticket = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  await db.from("pro_tickets").delete().lt("expires_at", new Date().toISOString());
  const { error } = await db.from("pro_tickets").insert({ ticket, user_id: uid, expires_at: new Date(Date.now() + 60_000).toISOString() });
  if (error) return j({ error: "ticket" }, 500);
  return j({ ticket }, 200);
});
