-- DEGENCARDS — profiles: unique @username + opt-in weekly leaderboard
-- Applied on the live project as migrations `profiles_usernames_leaderboard` and `claim_username_grace`.
-- Kept here for reference / re-creation. Writes only go through the security definer functions below:
-- users can read their own row, never write the table directly.

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique check (username ~ '^[a-z0-9_]{3,20}$'),
  on_board boolean not null default false,              -- shown on the weekly leaderboard (opt-in)
  created_at timestamptz not null default now(),
  username_changed_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
create policy profiles_own on public.profiles for select to authenticated using (user_id = (select auth.uid()));
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;

-- names nobody can take (brand, staff-looking, platform names)
create or replace function public.username_reserved(n text) returns boolean
language sql immutable set search_path = '' as $$
  select n in ('admin','root','support','help','team','staff','mod','mods','moderator','official','system','null','undefined','api','www','mail',
               'degencards','degen_cards','degencard','pumpfun','pump_fun','fomo','phantom','solana','whop','anthropic','claude','me','you','everyone')
      or n ~ '(degencards|admin|moderator|official|support)';
$$;
revoke all on function public.username_reserved(text) from public, anon, authenticated;

-- live check while typing (true = free for the caller)
create or replace function public.username_available(p_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select lower(trim(coalesce(p_name,''))) ~ '^[a-z0-9_]{3,20}$'
     and not public.username_reserved(lower(trim(p_name)))
     and not exists (select 1 from public.profiles where username = lower(trim(p_name)) and user_id <> (select auth.uid()));
$$;

-- claim or rename: { ok:true, username } | { ok:false, error: auth|format|reserved|taken|cooldown, next? }
-- one rename per 7 days (free during the first hour after the first claim, to fix a typo)
create or replace function public.claim_username(p_name text, p_board boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); n text := lower(trim(coalesce(p_name,''))); cur public.profiles%rowtype;
begin
  if uid is null then return jsonb_build_object('ok', false, 'error', 'auth'); end if;
  if n !~ '^[a-z0-9_]{3,20}$' then return jsonb_build_object('ok', false, 'error', 'format'); end if;
  if public.username_reserved(n) then return jsonb_build_object('ok', false, 'error', 'reserved'); end if;
  select * into cur from public.profiles where user_id = uid;
  if found and cur.username <> n and cur.username_changed_at > now() - interval '7 days' and cur.created_at < now() - interval '1 hour' then
    return jsonb_build_object('ok', false, 'error', 'cooldown', 'next', cur.username_changed_at + interval '7 days');
  end if;
  if exists (select 1 from public.profiles where username = n and user_id <> uid) then return jsonb_build_object('ok', false, 'error', 'taken'); end if;
  insert into public.profiles (user_id, username, on_board) values (uid, n, coalesce(p_board, false))
  on conflict (user_id) do update set username = excluded.username, on_board = coalesce(p_board, public.profiles.on_board),
    username_changed_at = case when public.profiles.username <> excluded.username then now() else public.profiles.username_changed_at end;
  return jsonb_build_object('ok', true, 'username', n);
exception when unique_violation then return jsonb_build_object('ok', false, 'error', 'taken');
end $$;

-- join / leave the leaderboard
create or replace function public.set_leaderboard(p_on boolean) returns boolean
language sql security definer set search_path = '' as $$
  update public.profiles set on_board = coalesce(p_on, false) where user_id = (select auth.uid()) returning on_board;
$$;

-- weekly leaderboard: verified on-chain trades only (ext_id is set by the import functions; users cannot write it),
-- since Monday 00:00 UTC, top 50 + the caller's own row
create or replace function public.leaderboard_week()
returns table(rank int, username text, pnl numeric, trades int, wins int, best_roi numeric, me boolean)
language sql stable security definer set search_path = '' as $$
  with t0 as (select (extract(epoch from date_trunc('week', now() at time zone 'utc')) * 1000)::bigint as ms),
  agg as (
    select p.user_id, p.username, sum(t.pnl) as pnl, count(*)::int as trades, (count(*) filter (where t.pnl > 0))::int as wins, max(t.roi) as best_roi
    from public.profiles p join public.trades t on t.user_id = p.user_id
    where p.on_board and t.deleted_at is null and t.ext_id is not null and t.timestamp_ms >= (select ms from t0)
    group by p.user_id, p.username
  ),
  ranked as (select (rank() over (order by a.pnl desc))::int as rk, a.* from agg a)
  select r.rk, r.username, round(r.pnl, 2), r.trades, r.wins, round(r.best_roi, 1), r.user_id = (select auth.uid())
  from ranked r where r.rk <= 50 or r.user_id = (select auth.uid()) order by r.rk limit 51;
$$;

revoke all on function public.username_available(text), public.claim_username(text, boolean), public.set_leaderboard(boolean), public.leaderboard_week() from public, anon;
grant execute on function public.username_available(text), public.claim_username(text, boolean), public.set_leaderboard(boolean), public.leaderboard_week() to authenticated;
