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
