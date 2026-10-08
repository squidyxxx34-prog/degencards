-- DEGENCARDS — RADAR : feed des tokens Solana actifs avec un score de sécurité on-chain (0-100).
-- Appliqué le 2026-10-08 via le connecteur (3 migrations : radar_tokens, radar_tokens_grants, radar_cron).
-- NB : le connecteur Supabase annule sans prévenir tout SQL « destructif » (drop, delete, unschedule…) : le passer à part ou au SQL Editor.
-- Rempli uniquement par l'edge function `radar` (service_role, cron 3-59/5). Lecture seule pour les utilisateurs connectés.
-- Données publiques (aucune donnée utilisateur) ; un score élevé = moins de signaux de rug, jamais une garantie.

create table if not exists public.radar_tokens (
  mint            text primary key check (mint ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  symbol          text not null default '' check (char_length(symbol) <= 24),
  name            text not null default '' check (char_length(name) <= 64),
  source          text not null default 'dex' check (source in ('pumpfun', 'dex')),
  graduated       boolean not null default false,
  image           text check (image is null or image like 'https://wlxyepkewatmwlziybfb.supabase.co/storage/v1/object/public/coin-images/%'),
  image_tries     smallint not null default 0,
  score           smallint not null default 0 check (score between 0 and 100),
  checks          jsonb not null default '[]'::jsonb,
  mc              double precision,
  liq             double precision,
  vol_h1          double precision,
  vol_h24         double precision,
  buys_h1         integer,
  sells_h1        integer,
  change_h1       double precision,
  top10_pct       double precision,
  dev_pct         double precision,
  holders_checked smallint,
  created_at_ms   bigint,
  pair            text check (pair is null or pair ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  first_seen      timestamptz not null default now(),
  scanned_at      timestamptz not null default now()
);
create index if not exists radar_tokens_feed on public.radar_tokens (score desc, scanned_at desc);

alter table public.radar_tokens enable row level security;
revoke all on public.radar_tokens from anon, authenticated;
grant select on public.radar_tokens to authenticated;
create policy radar_read on public.radar_tokens for select to authenticated using (true);

-- ménage : la fonction `radar` supprime elle-même les tokens non revus depuis 24 h (pas de fonction SQL).

-- cron (même clé que sync-trades), décalé des passages pump.fun existants
select cron.schedule('radar', '3-59/5 * * * *', $$
  select net.http_post(url := 'https://wlxyepkewatmwlziybfb.supabase.co/functions/v1/radar',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-key',(select decrypted_secret from vault.decrypted_secrets where name = 'sync_cron_key')),
    body := '{}'::jsonb, timeout_milliseconds := 140000); $$);
