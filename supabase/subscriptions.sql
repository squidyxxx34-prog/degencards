-- DEGENCARDS PRO (Whop). One row per user, written only by the `whop` edge function (service role).
-- The app reads its own row to unlock PRO; nothing client-side can grant it.
create table if not exists public.subscriptions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  membership_id text unique,
  plan_id text,
  status text not null default 'none',          -- whop membership status: active, trialing, past_due, canceling, canceled, expired...
  cancel_at_period_end boolean not null default false,
  renews_at timestamptz,
  manage_url text,
  updated_at timestamptz not null default now()
);
alter table public.subscriptions enable row level security;
drop policy if exists "own subscription" on public.subscriptions;
create policy "own subscription" on public.subscriptions for select to authenticated using (user_id = (select auth.uid()));
revoke insert, update, delete on public.subscriptions from anon, authenticated;

-- one-time tickets to download the PRO studio script (service role only: RLS on, no policy)
create table if not exists public.pro_tickets (
  ticket text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null
);
alter table public.pro_tickets enable row level security;
revoke all on public.pro_tickets from anon, authenticated;

-- server-side PRO check for the signed-in user only (usable in RLS / RPCs)
create or replace function public.is_pro()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.subscriptions s where s.user_id = auth.uid()
    and s.status in ('active','trialing','completed','canceling','past_due')
    and (s.renews_at is null or s.renews_at > now() - interval '3 days'));
$$;
revoke all on function public.is_pro() from public, anon;
grant execute on function public.is_pro() to authenticated;
-- applied in prod 2026-10-05 (migrations pro_subscriptions + is_pro_self_only)
