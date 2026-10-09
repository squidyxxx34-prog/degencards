-- DEGENCARDS — profile picture (own UI only: nav chip + Account; never on cards, leaderboard or share images)
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
