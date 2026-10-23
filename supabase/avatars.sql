-- DEGENCARDS — profile picture (nav chip + Account + weekly leaderboard for opted-in users; never on cards or share images)
-- Applied on the live project as migration `avatars`.
-- Stored as a small data: URL (client crops/resizes to 256x256 before upload). Users read their own row;
-- writes only through set_avatar / clear_avatar. Deleted with the account (FK on delete cascade).

create table if not exists public.avatars (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data text not null check (length(data) <= 80000 and data ~ '^data:image/(webp|jpeg|png);base64,[A-Za-z0-9+/=]+$'),
  updated_at timestamptz not null default now()
);
alter table public.avatars enable row level security;
create policy avatars_own on public.avatars for select to authenticated using (user_id = (select auth.uid()));
revoke all on public.avatars from anon, authenticated;
grant select on public.avatars to authenticated;

create or replace function public.set_avatar(p_data text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid();
begin
  if uid is null then return false; end if;
  if p_data is null or length(p_data) > 80000 or p_data !~ '^data:image/(webp|jpeg|png);base64,[A-Za-z0-9+/=]+$' then return false; end if;
  insert into public.avatars (user_id, data, updated_at) values (uid, p_data, now())
  on conflict (user_id) do update set data = excluded.data, updated_at = now();
  return true;
end $$;

create or replace function public.clear_avatar() returns boolean
language sql security definer set search_path = '' as $$
  with d as (delete from public.avatars where user_id = (select auth.uid()) returning 1) select true;
$$;

revoke all on function public.set_avatar(text), public.clear_avatar() from public, anon;
grant execute on function public.set_avatar(text), public.clear_avatar() to authenticated;

-- leaderboard pictures (opted-in users only), applied on the live project as migration `leaderboard_avatars` (2026-10-23)
create or replace function public.leaderboard_avatars(p_names text[])
returns table(username text, data text, updated_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select p.username, a.data, a.updated_at
  from public.profiles p join public.avatars a on a.user_id = p.user_id
  where p.on_board and p.username = any(p_names[1:60]);
$$;
revoke all on function public.leaderboard_avatars(text[]) from public, anon;
grant execute on function public.leaderboard_avatars(text[]) to authenticated;
