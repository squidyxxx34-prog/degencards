# DEGENCARDS

Trade Cards module — every crypto trade becomes a collectible card (rarity, grade, achievements, XP).

- Single-file app (`index.html`) — vanilla JS, no build step
- Auth: Supabase (Web3 Wallet — Solana / Ethereum, magic link email, Google, watch-only public key)
- Data: Supabase Postgres, RLS-scoped per user (`trades`, `connected_accounts`)
- Supabase project ref: `wlxyepkewatmwlziybfb`

## Setup
Enable in the Supabase dashboard (Authentication → Providers):
- Web3 Wallet (Solana + Ethereum)
- Google OAuth (Client ID/Secret from Google Cloud Console)
- Anonymous sign-ins (used for watch-only public-key login)
