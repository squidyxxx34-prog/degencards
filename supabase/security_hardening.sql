-- DEGENCARDS — database hardening. Paste the whole thing in Supabase > SQL Editor > Run. Safe to re-run.

-- 1. clean exact duplicate wallet imports, then renumber trades per user (fixes duplicated #numbers)
delete from public.trades a using public.trades b
 where a.source = 'wallet' and b.source = 'wallet'
   and a.user_id = b.user_id and a.ticker = b.ticker
   and a.timestamp_ms = b.timestamp_ms and a.id > b.id;

with ranked as (
  select id, row_number() over (partition by user_id order by timestamp_ms, created_at, id) as rn
  from public.trades
)
update public.trades t set trade_id = r.rn from ranked r where t.id = r.id and t.trade_id is distinct from r.rn;

create unique index if not exists trades_user_tradeid_uidx on public.trades (user_id, trade_id);
create unique index if not exists trades_wallet_dedupe_uidx on public.trades (user_id, ticker, timestamp_ms) where source = 'wallet';

-- 2. server-side validation (NOT VALID = applies to every new row, legacy rows untouched)
alter table public.trades alter column trade_id set default 0;
alter table public.trades drop constraint if exists trades_ticker_len, drop constraint if exists trades_source_valid,
  drop constraint if exists trades_hold_valid, drop constraint if exists trades_num_valid, drop constraint if exists trades_ts_valid;
alter table public.trades
  add constraint trades_ticker_len check (char_length(ticker) between 1 and 24) not valid,
  add constraint trades_source_valid check (source in ('manual','pumpfun','fomo','wallet')) not valid,
  add constraint trades_hold_valid check (hold_time >= 0 and hold_time <= 31536000) not valid,
  add constraint trades_num_valid check (abs(pnl) <= 1e12 and roi between -100 and 1e7 and entry_mc between 0 and 1e15 and exit_mc between 0 and 1e15) not valid,
  add constraint trades_ts_valid check (timestamp_ms between 946684800000 and 4102444800000) not valid;
alter table public.connected_accounts drop constraint if exists accounts_handle_len;
alter table public.connected_accounts add constraint accounts_handle_len check (char_length(handle) between 1 and 120) not valid;
alter table public.goals drop constraint if exists goals_target_valid;
alter table public.goals add constraint goals_target_valid check (target_pnl between 0 and 1000000000) not valid;

-- 3. server-side trade numbering + per-user cap (no client-computed ids, no race conditions)
create or replace function public.assign_trade_id() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(new.user_id::text, 0));
  if (select count(*) from public.trades where user_id = new.user_id) >= 5000 then
    raise exception 'trade limit reached';
  end if;
  select coalesce(max(trade_id), 0) + 1 into new.trade_id from public.trades where user_id = new.user_id;
  return new;
end $$;
drop trigger if exists trades_assign_id on public.trades;
create trigger trades_assign_id before insert on public.trades for each row execute function public.assign_trade_id();

-- 4. RLS: authenticated role only, cached auth.uid(), WITH CHECK on updates
drop policy if exists "own trades select" on public.trades;
drop policy if exists "own trades insert" on public.trades;
drop policy if exists "own trades delete" on public.trades;
create policy "own trades select" on public.trades for select to authenticated using ((select auth.uid()) = user_id);
create policy "own trades insert" on public.trades for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "own trades delete" on public.trades for delete to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "own accounts select" on public.connected_accounts;
drop policy if exists "own accounts insert" on public.connected_accounts;
drop policy if exists "own accounts delete" on public.connected_accounts;
create policy "own accounts select" on public.connected_accounts for select to authenticated using ((select auth.uid()) = user_id);
create policy "own accounts insert" on public.connected_accounts for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "own accounts delete" on public.connected_accounts for delete to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "own goal select" on public.goals;
drop policy if exists "own goal upsert" on public.goals;
drop policy if exists "own goal insert" on public.goals;
drop policy if exists "own goal update" on public.goals;
create policy "own goal select" on public.goals for select to authenticated using ((select auth.uid()) = user_id);
create policy "own goal insert" on public.goals for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "own goal update" on public.goals for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- 5. defense in depth: the logged-out (anon) role gets no table privileges at all
revoke all on public.trades from anon;
revoke all on public.connected_accounts from anon;
revoke all on public.goals from anon;
