-- DEGENCARDS — hardening v2 (déjà appliqué en prod le 2026-09-28 via migration security_hardening_v2). Safe to re-run.
revoke all on public.trades, public.connected_accounts, public.goals from anon, authenticated;
grant select, insert, delete on public.trades to authenticated;
grant select, insert, update, delete on public.connected_accounts to authenticated;
grant select, insert, update on public.goals to authenticated;

drop policy if exists "own accounts update" on public.connected_accounts;
create policy "own accounts update" on public.connected_accounts for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

alter table public.trades drop constraint if exists trades_source_ok;
alter table public.trades add constraint trades_source_ok check (source in ('manual','wallet'));
alter table public.trades drop constraint if exists trades_ticker_chars;
alter table public.trades add constraint trades_ticker_chars check (ticker !~ '[[:cntrl:]<>&"''`\\]');
alter table public.connected_accounts drop constraint if exists ca_handle_chars;
alter table public.connected_accounts add constraint ca_handle_chars check (handle ~ '^[A-Za-z0-9_.@-]{2,120}$');

create or replace function public.assign_trade_id() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare n integer; recent integer;
begin
  if new.user_id is distinct from (select auth.uid()) then raise exception 'forbidden'; end if;
  perform pg_advisory_xact_lock(hashtext('trades:' || new.user_id::text));
  select count(*), coalesce(max(trade_id),0), count(*) filter (where created_at > now() - interval '1 minute')
    into n, new.trade_id, recent from public.trades where user_id = new.user_id;
  if n >= 5000 then raise exception 'trade limit reached'; end if;
  if recent >= 120 then raise exception 'rate limit'; end if;
  new.trade_id := new.trade_id + 1;
  new.created_at := now();
  return new;
end $$;
revoke all on function public.assign_trade_id() from public, anon, authenticated;
drop trigger if exists assign_trade_id on public.trades;
drop trigger if exists trades_assign_id on public.trades;
create trigger trades_assign_id before insert on public.trades for each row execute function public.assign_trade_id();

create or replace function public.touch_goal() returns trigger language plpgsql security invoker set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists goals_touch on public.goals;
create trigger goals_touch before insert or update on public.goals for each row execute function public.touch_goal();

create or replace function public.touch_account() returns trigger language plpgsql security invoker set search_path = '' as $$
begin new.connected_at := now(); return new; end $$;
drop trigger if exists accounts_touch on public.connected_accounts;
create trigger accounts_touch before insert or update on public.connected_accounts for each row execute function public.touch_account();
revoke all on function public.touch_goal(), public.touch_account() from public, anon, authenticated;

drop extension if exists pg_graphql;   -- API GraphQL inutilisée
