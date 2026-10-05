-- Applied 2026-10-05 (migration trade_sanity). A wallet card can't make more than its own prices allow.
-- When a sell includes tokens the wallet got some other way (a DCA, a transfer, a bag from before tracking), its proceeds
-- inflated the PnL (e.g. +$17,839 on a $0.18 "buy"). PnL / ROI are brought back to what the tracked buy made at the real
-- average prices (entry -> exit market cap): exactly "sells counted only up to the tokens actually bought".
-- A card with no real buy price at all (entry market cap 0) is removed (soft delete).
create or replace function public.trade_sanity() returns trigger language plpgsql set search_path = public as $$
declare ratio numeric; inv numeric; fair numeric; diff numeric;
begin
  if new.source <> 'wallet' or new.deleted_at is not null then return new; end if;
  if coalesce(new.entry_mc, 0) <= 0 and coalesce(new.exit_mc, 0) > 0 then
    new.deleted_at := now(); return new;
  end if;
  if coalesce(new.entry_mc, 0) <= 0 or coalesce(new.exit_mc, 0) <= 0 or coalesce(new.roi, 0) = 0 or new.pnl is null then return new; end if;
  ratio := new.exit_mc::numeric / new.entry_mc;
  inv := new.pnl / (new.roi / 100.0);
  if inv <= 0 then return new; end if;
  fair := inv * (ratio - 1);
  diff := new.pnl - fair;
  if diff > greatest(1, 0.15 * inv) then
    new.pnl := round(fair, 2);
    new.roi := round(greatest(-100, (ratio - 1) * 100), 1);
    if new.pnl_net is not null then new.pnl_net := round(new.pnl_net - diff, 2); end if;
  end if;
  return new;
end $$;
drop trigger if exists trades_sanity on public.trades;
create trigger trades_sanity before insert or update of pnl, roi, entry_mc, exit_mc, pnl_net on public.trades
  for each row execute function public.trade_sanity();
update public.trades set pnl = pnl where source = 'wallet' and deleted_at is null;
