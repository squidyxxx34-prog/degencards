-- DEGENCARDS — coin launcher (edge function `launch`). Applied as migration `launches`.
create table if not exists public.launches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  mode text not null check (mode in ('pump','lp')),
  wallet text not null,
  mint text not null unique,
  pool text,
  name text not null,
  symbol text not null,
  image text,
  uri text,
  dev_buy_sol numeric not null default 0,
  liquidity_sol numeric,
  fee_sol numeric not null default 0,
  status text not null default 'prepared' check (status in ('prepared','live','failed')),
  sigs text[] not null default '{}',
  error text,
  created_at timestamptz not null default now(),
  live_at timestamptz
);
create index if not exists launches_user_idx on public.launches(user_id, created_at desc);
alter table public.launches enable row level security;
create policy launches_own on public.launches for select to authenticated using (user_id = (select auth.uid()));
revoke all on public.launches from anon, authenticated;
grant select on public.launches to authenticated;     -- writes: edge function (service role) only

-- public bucket: coin images (shown in the app) + metadata JSON of liquidity-pool launches
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('launch-meta', 'launch-meta', true, 1048576, array['image/png','image/jpeg','image/gif','image/webp','application/json'])
on conflict (id) do nothing;
