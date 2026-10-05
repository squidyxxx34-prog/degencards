// DEGENCARDS — whop
// PRO subscriptions sold on Whop (account DEGENCARDS biz_6CeBfKshynanPD, product DEGENCARDS PRO).
//   { action:"checkout", plan:"monthly"|"yearly" } -> a Whop checkout link tagged with the user's id (metadata.uid)
//   { action:"sync" }                              -> reads the user's membership back from Whop and stores it in public.subscriptions
// No webhook needed: the app syncs on return from checkout (?pro=1) and on load when the user already has a row.
// Secrets: WHOP_API_KEY (Whop dashboard > Developer > API keys, company key of DEGENCARDS). Optional: WHOP_PLAN_MONTHLY, WHOP_PLAN_YEARLY.
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WHOP_KEY = Deno.env.get("WHOP_API_KEY") || "";
const ACCOUNT = "biz_6CeBfKshynanPD";
const PRODUCT = "prod_tsBbdHC0PSZlN";
const PLANS: Record<string, string> = {
  monthly: Deno.env.get("WHOP_PLAN_MONTHLY") || "",
  yearly: Deno.env.get("WHOP_PLAN_YEARLY") || "",
};
const SITE = "https://degencards.vercel.app";
const ALLOWED_ORIGIN = SITE;
const API = "https://api.whop.com/api/v1";
const PRO_STATUSES = new Set(["active", "trialing", "completed", "canceling", "past_due"]);

const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

function cors(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin === ALLOWED_ORIGIN ? ALLOWED_ORIGIN : "null",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}
const json = (body: unknown, status: number, origin: string | null) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors(origin), "Content-Type": "application/json" } });

async function whop(path: string, init: RequestInit = {}) {
  const r = await fetch(API + path, { ...init, headers: { Authorization: `Bearer ${WHOP_KEY}`, "Content-Type": "application/json", ...(init.headers || {}) } });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`whop ${r.status}: ${JSON.stringify(body).slice(0, 300)}`);
  return body;
}

// membership -> row (field names checked defensively: the API has renamed period fields over versions)
function rowOf(uid: string, m: any) {
  const end = m.renewal_period_end || m.current_period_end || m.expires_at || null;
  const status = m.cancel_at_period_end && m.status === "active" ? "canceling" : String(m.status || "none");
  return {
    user_id: uid, membership_id: m.id, plan_id: m.plan?.id || m.plan_id || null, status,
    cancel_at_period_end: !!m.cancel_at_period_end,
    renews_at: end ? new Date(typeof end === "number" ? end * 1000 : end).toISOString() : null,
    manage_url: m.manage_url || "https://whop.com/@me/settings/memberships/",
    updated_at: new Date().toISOString(),
  };
}

// the user's membership: the stored one first, else scan the product's memberships for metadata.uid (newest first)
async function findMembership(uid: string) {
  const { data: cur } = await db.from("subscriptions").select("membership_id").eq("user_id", uid).maybeSingle();
  if (cur?.membership_id) {
    try { const m = await whop(`/memberships/${cur.membership_id}`); if (m?.metadata?.uid === uid) return m; } catch (_) { /* fall through */ }
  }
  let after = "", best: any = null;
  for (let page = 0; page < 20; page++) {
    const q = new URLSearchParams({ account_id: ACCOUNT, product_id: PRODUCT, first: "100", direction: "desc" });
    if (after) q.set("after", after);
    const res = await whop(`/memberships?${q}`);
    for (const m of res.data || []) {
      if (m?.metadata?.uid !== uid) continue;
      if (!best || (PRO_STATUSES.has(m.status) && !PRO_STATUSES.has(best.status))) best = m;
      if (PRO_STATUSES.has(m.status)) return m;
    }
    if (!res.page_info?.has_next_page) break;
    after = res.page_info.end_cursor;
  }
  return best;
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  if (req.method !== "POST") return json({ error: "method" }, 405, origin);
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: au } = await db.auth.getUser(token);
  const uid = au?.user?.id;
  if (!uid) return json({ error: "auth" }, 401, origin);
  if (!WHOP_KEY) return json({ error: "not_configured" }, 503, origin);
  let body: any = {};
  try { body = await req.json(); } catch (_) { /* empty */ }

  try {
    if (body.action === "checkout") {
      const plan = PLANS[body.plan === "yearly" ? "yearly" : "monthly"];
      if (!plan) return json({ error: "not_configured" }, 503, origin);
      const cfg = await whop("/checkout_configurations", {
        method: "POST",
        body: JSON.stringify({ account_id: ACCOUNT, plan_id: plan, metadata: { uid }, redirect_url: `${SITE}/?pro=1` }),
      });
      const url = cfg.purchase_url || cfg.url || `https://whop.com/checkout/${plan}?session=${cfg.id}`;
      return json({ url }, 200, origin);
    }
    if (body.action === "sync") {
      const m = await findMembership(uid);
      if (!m) return json({ pro: false }, 200, origin);
      const row = rowOf(uid, m);
      await db.from("subscriptions").upsert(row, { onConflict: "user_id" });
      return json({ pro: PRO_STATUSES.has(row.status), sub: row }, 200, origin);
    }
    return json({ error: "action" }, 400, origin);
  } catch (e) {
    console.error(e);
    return json({ error: "whop" }, 502, origin);
  }
});
