# DEGENCARDS

Every trade becomes a collectible card (rarity, grade, achievements, XP, monthly goal).

Static site (no build): `index.html` + `styles.css` + `app.js`. supabase-js is **self-hosted** in `vendor/` (pinned, see `vendor/README.txt`).

## Security model
- **CSP + security headers** in `vercel.json`: scripts only from `'self'`, no inline script, no third-party CDN code, `frame-ancestors 'none'`, HSTS, nosniff, no-referrer, COOP/CORP, locked Permissions-Policy.
- **Auth**: email + password (sign up with email confirmation, reset link), Google (PKCE), watch-only wallet by public key (anonymous user). Visible hCaptcha on email and wallet flows. Generic error messages (no account enumeration).
- **XSS**: every DB-derived string is sanitized on read (`cleanTicker`, allow-lists) and escaped on render (`esc`).
- **Inputs**: all numbers clamped client-side and re-validated by DB CHECK constraints; wallet addresses must be valid base58; handles are allow-listed.
- **Data isolation**: RLS on every table (`authenticated` only, `auth.uid() = user_id`), anon role has no table privileges, trade numbering + per-user cap enforced by a DB trigger.
- **Least privilege (v2)**: `authenticated` only gets the verbs the app uses (no UPDATE on trades, no TRUNCATE anywhere), trade numbering / `created_at` / `updated_at` / `connected_at` are server-owned, 120 trades/min + 5000 trades per user, all CHECK constraints validated, trigger functions are SECURITY INVOKER, GraphQL API removed. See `supabase/security_hardening_v2.sql`.
- **No third party at runtime** except Supabase, Solana RPC, CoinGecko and hCaptcha (invisible, required on email / anonymous / wallet sign-in): fonts are self-hosted (`fonts/`), supabase-js pinned with SRI.
- **Not deployed**: `.vercelignore` keeps README/HANDOFF/SQL off the public site.
- **Auto-import**: Edge Function `sync-trades` (server-side, cron every 10 min) reads connected Solana addresses and turns closed positions into cards. Users can only write `user_id/provider/handle` on `connected_accounts`; sync columns are server-owned.
- The Supabase anon key in `app.js` is public by design; RLS is the protection.

## One-time setup
1. SQL in `supabase/` already applied (hardening v1/v2, soft delete, auto-import, subscriptions, pro_assets...). New table = RLS + minimal grants, then `get_advisors`.
2. Supabase > Authentication > URL Configuration: Site URL = https://degencards.vercel.app, only that URL in the Redirect allow-list.
3. Authentication > Providers: Email (password + confirm email), Google, Anonymous sign-ins. Web3 Wallet off.
4. Authentication > Attack Protection: hCaptcha on (done), Leaked password protection on.
5. Edge Function secrets: `HELIUS_API_KEY`, `WHOP_API_KEY` (PRO goes live by itself once it is set).
6. `legal-config.js`: legal identity (name, address, SIRET, email, mediator) before selling.

## Launch assets
`favicon.svg`, `icon-192.png`, `icon-512.png`, `apple-touch-icon.png`, `site.webmanifest`, `og.png` (1200x630 link preview), `robots.txt` (landing + legal pages only), `sitemap.xml`, `404.html`.
