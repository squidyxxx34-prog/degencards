-- Applied 2026-10-02. Charts over the 16 kB check (trades_chart_size) were silently rejected:
-- long holds produce 250-400 candles. This trigger merges candles (OHLC kept) until they fit.
create or replace function public.compact_chart() returns trigger language plpgsql set search_path = public as $$
declare n int; k int; out jsonb;
begin
  if new.chart is null or jsonb_typeof(new.chart->'c') <> 'array' then return new; end if;
  n := jsonb_array_length(new.chart->'c');
  if n <= 140 and pg_column_size(new.chart) < 15000 then return new; end if;
  k := greatest(2, ceil(n / 140.0)::int);
  select jsonb_agg(jsonb_build_array(g.ts, g.o, g.hi, g.lo, g.cl) order by g.grp) into out from (
    select grp,
      (array_agg((c->>0)::numeric order by idx))[1] ts,
      (array_agg((c->>1)::numeric order by idx))[1] o,
      max((c->>2)::numeric) hi, min((c->>3)::numeric) lo,
      (array_agg((c->>4)::numeric order by idx desc))[1] cl
    from (select c, idx, (idx - 1) / k grp from jsonb_array_elements(new.chart->'c') with ordinality e(c, idx)) s
    group by grp) g;
  new.chart := jsonb_set(jsonb_set(new.chart, '{c}', out), '{i}', to_jsonb(coalesce((new.chart->>'i')::numeric, 60000) * k));
  return new;
end $$;
drop trigger if exists trades_compact_chart on public.trades;
create trigger trades_compact_chart before insert or update of chart on public.trades
  for each row execute function public.compact_chart();
update public.trades set chart_tries = 0 where chart is null and mint is not null and deleted_at is null;

-- 2026-10-03: compact_chart() also (1) flags GeckoTerminal charts of very short trades with an empty market around them
-- (chart.coarse: all fills in <= 2 minute candles and < 12 candles that move >= 2% of the range) so pump.fun coins get
-- second-level candles from the pump-chart edge function, and (2) never lets a minute chart overwrite those
-- ({ src: "pump", fine: 1 }). Full function body: see migrations chart_keep_fine_pump in Supabase.
