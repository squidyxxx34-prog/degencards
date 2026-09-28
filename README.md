# DEGENCARDS

Every trade becomes a collectible card (rarity, grade, achievements, XP, monthly goal).

Static site (no build): `index.html` + `styles.css` + `app.js`. supabase-js is **self-hosted** in `vendor/` (pinned, see `vendor/README.txt`).

## Security model
- **CSP + security headers** in `vercel.json`: scripts only from `'self'`, no inline script, no third-party CDN code, `frame-ancestors 'none'`, HSTS, nosniff, no-referrer, COOP/CORP, locked Permissions-Policy.
- **Auth**: Supabase PKCE flow (no raw token in the URL, URL scrubbed after login), Web3 sign-in (Solana/Ethereum), Google, email magic link (30s client cooldown).
- **XSS**: every DB-derived string is sanitized on read (`cleanTicker`, allow-lists) and escaped on render (`esc`).
- **Inputs**: all numbers clamped client-side and re-validated by DB CHECK constraints; wallet addresses must be valid base58; handles are allow-listed.
- **Data isolation**: RLS on every table (`authenticated` only, `auth.uid() = user_id`), anon role has no table privileges, trade numbering + per-user cap enforced by a DB trigger.
- The Supabase anon key in `app.js` is public by design; RLS is the protection.

## One-time setup
1. Run `supabase/security_hardening.sql` in Supabase → SQL Editor (safe to re-run).
2. Supabase → Authentication → URL Configuration: Site URL = your Vercel URL, and only that URL in the Redirect allow-list.
3. Authentication → Providers: enable Web3 Wallet (Solana + Ethereum), Google (Client ID/Secret), Anonymous sign-ins (public-key login).
4. Authentication → Attack Protection: enable CAPTCHA (Turnstile/hCaptcha) to stop bot sign-ups.
