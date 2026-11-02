/* ============================================================================
   DEGENCARDS — Journal
   Every closed trade can be journaled: why you entered (setups), how you felt (mood), whether you followed your plan,
   mistakes and a note. The Journal page lists the trades of a period with their real candles, and Patterns describes
   what the numbers show (after a loss, time of day, hold time, setups / moods once journaled). Descriptive, no advice.
   Stored in public.journal_entries (one row per trade, RLS: own rows only).
   Uses app.js globals: sb, session, trades, computedTrades, miniChart, chartState, ensureChart, chartObserver,
   openDetail, esc, tk, fmt, coinImg, showToast.
   ============================================================================ */
(function(){
const SETUPS = ['Fresh launch', 'Volume spike', 'KOL call', 'Narrative', 'Dip buy', 'Migration', 'Copy trade', 'Gut feeling'];
const MOODS = ['Calm', 'Confident', 'FOMO', 'Greedy', 'Revenge', 'Bored'];
const PLANS = [['yes', 'Yes'], ['partly', 'Partly'], ['no', 'No']];
const MISTAKES = ['Sold too early', 'Held too long', 'Chased green', 'Oversized', 'No exit plan', 'Ignored red flags'];
const PERIODS = [['1d', 'Today'], ['7d', '7D'], ['30d', '30D'], ['all', 'All']];
const DAY = 86400000, PAGE = 40;

const entries = new Map();                                            // trade id -> { setups, mood, plan, mistakes, note }
let period = (() => { try{ const v = localStorage.getItem('dc_journal_p'); return PERIODS.some(p => p[0] === v) ? v : '7d'; }catch(e){ return '7d'; } })();
let limit = PAGE, editing = null, draft = null, saving = false;

const pick = (v, list) => list.includes(v) ? v : null;
const picks = (a, list) => Array.isArray(a) ? [...new Set(a.filter(x => list.includes(x)))] : [];
const money = v => (v < 0 ? '−$' : '+$') + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const short = v => { const a = Math.abs(v), s = v < 0 ? '−' : '+'; return a >= 1e6 ? s + (a / 1e6).toFixed(2) + 'M' : a >= 1e3 ? s + (a / 1e3).toFixed(a >= 1e4 ? 1 : 2) + 'K' : s + a.toFixed(0); };
const has = e => !!(e && (e.setups.length || e.mood || e.plan || e.mistakes.length || e.note));
const opened = t => t.timestamp - (t.holdTime || 0) * 1000;

async function load(){
  entries.clear();
  if(!session) return;
  const { data, error } = await sb.from('journal_entries').select('trade_id,setups,mood,plan,mistakes,note').limit(5000);
  if(error){ console.error('journal load failed'); return; }
  for(const r of data || []) entries.set(String(r.trade_id), { setups: picks(r.setups, SETUPS), mood: pick(r.mood, MOODS), plan: pick(r.plan, PLANS.map(p => p[0])), mistakes: picks(r.mistakes, MISTAKES), note: typeof r.note === 'string' ? r.note.slice(0, 2000) : '' });
}
async function save(t, e){
  const row = { trade_id: t.id, user_id: session.user.id, setups: e.setups, mood: e.mood, plan: e.plan, mistakes: e.mistakes, note: e.note.slice(0, 2000), updated_at: new Date().toISOString() };
  if(!has(e)){ const { error } = await sb.from('journal_entries').delete().eq('trade_id', t.id); if(error) return false; entries.delete(t.id); return true; }
  const { error } = await sb.from('journal_entries').upsert(row, { onConflict: 'trade_id' });
  if(error){ console.error('journal save failed'); return false; }
  entries.set(t.id, { ...e }); return true;
}

/* ---------- period + numbers ---------- */
function inPeriod(list){
  if(period === 'all') return list;
  const now = Date.now(), from = period === '1d' ? new Date(new Date().setHours(0, 0, 0, 0)).getTime() : now - (period === '7d' ? 7 : 30) * DAY;
  return list.filter(t => t.timestamp >= from);
}
function bars(list){
  // today: by hour · 7D / 30D: by day · All: by week (last 26)
  const out = [];
  if(period === '1d'){ const d0 = new Date(new Date().setHours(0, 0, 0, 0)).getTime();
    for(let h = 0; h < 24; h++) out.push({ from: d0 + h * 3600000, to: d0 + (h + 1) * 3600000, label: h + 'h' }); }
  else if(period !== 'all'){ const n = period === '7d' ? 7 : 30, today = new Date(new Date().setHours(0, 0, 0, 0)).getTime();
    for(let i = n - 1; i >= 0; i--){ const a = new Date(today - i * DAY); a.setHours(0, 0, 0, 0); const b = new Date(a); b.setDate(b.getDate() + 1);
      out.push({ from: a.getTime(), to: b.getTime(), label: a.toLocaleDateString('en-US', { weekday: n === 7 ? 'short' : undefined, day: 'numeric' }) }); } }
  else { const now = new Date(); now.setHours(0, 0, 0, 0); const end = now.getTime() + DAY, first = list.length ? Math.min(...list.map(t => t.timestamp)) : end - 7 * DAY;
    const weeks = Math.min(26, Math.max(1, Math.ceil((end - first) / (7 * DAY))));
    for(let i = weeks - 1; i >= 0; i--){ const b = end - i * 7 * DAY; out.push({ from: b - 7 * DAY, to: b, label: new Date(b - 7 * DAY).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) }); } }
  for(const b of out){ const s = list.filter(t => t.timestamp >= b.from && t.timestamp < b.to); b.n = s.length; b.v = s.reduce((a, t) => a + t.pnl, 0); }
  return out;
}
function groups(list, buckets, key){
  return buckets.map(([label, a, b]) => { const s = list.filter(t => { const k = key(t); return k >= a && k < b; });
    return { label, n: s.length, wins: s.filter(t => t.pnl > 0).length, v: s.reduce((x, t) => x + t.pnl, 0) }; }).filter(g => g.n);
}
function patterns(list){
  const out = { after: null, tod: [], hold: [], tags: [] };
  if(list.length < 5) return out;
  // opened within 15 min after a losing trade closed
  const losses = list.filter(t => t.pnl < 0).map(t => t.timestamp);
  const after = list.filter(t => { const o = opened(t); return losses.some(c => c <= o && o - c <= 15 * 60000); });
  if(after.length >= 2) out.after = { n: after.length, wins: after.filter(t => t.pnl > 0).length, v: after.reduce((a, t) => a + t.pnl, 0), share: after.length / list.length };
  out.tod = groups(list, [['Night 00–06', 0, 6], ['Morning 06–12', 6, 12], ['Afternoon 12–18', 12, 18], ['Evening 18–24', 18, 24]], t => new Date(opened(t)).getHours());
  out.hold = groups(list, [['Under 1 min', 0, 60], ['1 – 15 min', 60, 900], ['15 min – 1 h', 900, 3600], ['1 h – 1 day', 3600, 86400], ['Over 1 day', 86400, Infinity]], t => t.holdTime || 0);
  const tagged = list.filter(t => has(entries.get(t.id)));
  if(tagged.length >= 3){
    const add = (kind, name, t) => { let g = out.tags.find(x => x.kind === kind && x.label === name); if(!g){ g = { kind, label: name, n: 0, wins: 0, v: 0 }; out.tags.push(g); } g.n++; if(t.pnl > 0) g.wins++; g.v += t.pnl; };
    for(const t of tagged){ const e = entries.get(t.id); e.setups.forEach(s => add('Setup', s, t)); if(e.mood) add('Mood', e.mood, t); e.mistakes.forEach(m => add('Mistake', m, t)); }
    out.tags.sort((a, b) => b.n - a.n || b.v - a.v);
  }
  out.tagged = tagged.length;
  return out;
}

/* ---------- page: dense desk (KPI strip, month calendar of bars, score, compact trade rows, patterns) ---------- */
let calOff = 0;                                                       // months back from the latest trade's month
function barRows(gs){
  const max = Math.max(1, ...gs.map(g => Math.abs(g.v)));
  return gs.map(g => `<div class="jr-g">
      <span class="jr-g-l">${esc(g.label)}</span>
      <span class="jr-g-track" aria-hidden="true"><i class="${g.v >= 0 ? 'up' : 'dn'}" style="width:${Math.max(1.5, Math.abs(g.v) / max * 50).toFixed(1)}%"></i></span>
      <b class="${g.v >= 0 ? 'pos' : 'neg'}">${short(g.v)}</b>
      <span class="jr-g-meta">${g.n} · ${Math.round(100 * g.wins / g.n)}%</span></div>`).join('');
}
function tagChips(e){
  if(!has(e)) return '<span class="jr-add">+ Note</span>';
  const t = [...e.setups, ...(e.mood ? [e.mood] : []), ...(e.plan ? ['Plan: ' + PLANS.find(p => p[0] === e.plan)[1]] : []), ...e.mistakes];
  return t.slice(0, 2).map(x => `<span class="jr-tag">${esc(x)}</span>`).join('') + (t.length > 2 ? `<span class="jr-tag more">+${t.length - 2}</span>` : '') + (!t.length && e.note ? '<span class="jr-tag">Note</span>' : '');
}
const clock = ts => new Date(ts).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
function row(t){
  const win = t.pnl >= 0;
  return `<button type="button" class="jr-row" data-id="${esc(t.id)}" aria-label="Journal ${esc(tk(t.ticker))}, ${money(t.pnl)}">
    <span class="jr-c-coin">${coinImg(t, 26)}<b class="jr-tk">${esc(tk(t.ticker))}</b></span>
    <span class="jr-c-time" data-h="${esc(fmt.hold(t.holdTime))}">${clock(opened(t))} → ${clock(t.timestamp)}</span>
    <span class="jr-c-hold">${fmt.hold(t.holdTime)}</span>
    <span class="jr-c-pnl"><b class="${win ? 'pos' : 'neg'}">${money(t.pnl)}</b><em class="${win ? 'pos' : 'neg'}">${fmt.pct(t.roi)}</em></span>
    <span class="mini jr-mini">${miniChart(t)}</span>
    <span class="jr-tags">${tagChips(entries.get(t.id))}</span>
  </button>`;
}
function score(list){
  // 0-100 from five spokes; discipline only when plans were journaled
  if(list.length < 5) return null;
  const w = list.filter(t => t.pnl > 0), l = list.filter(t => t.pnl < 0), gw = w.reduce((a, t) => a + t.pnl, 0), gl = -l.reduce((a, t) => a + t.pnl, 0);
  const days = new Map(); list.forEach(t => { const k = new Date(t.timestamp).toDateString(); days.set(k, (days.get(k) || 0) + t.pnl); });
  const plans = list.map(t => entries.get(t.id)).filter(e => e && e.plan).map(e => e.plan === 'yes' ? 1 : e.plan === 'partly' ? .5 : 0);
  const pf = gl > 0 ? gw / gl : (gw > 0 ? 3 : 0), size = w.length && l.length ? (gw / w.length) / (gl / l.length) : (w.length ? 2 : 0);
  const sp = [
    ['Win rate', Math.min(100, (w.length / list.length) / .6 * 100), Math.round(100 * w.length / list.length) + '%'],
    ['Profit factor', Math.min(100, pf / 2 * 100), pf >= 10 ? '10+' : pf.toFixed(2)],
    ['Win / loss size', Math.min(100, size / 2 * 100), size.toFixed(2) + '×'],
    ['Green days', 100 * [...days.values()].filter(v => v > 0).length / days.size, [...days.values()].filter(v => v > 0).length + ' / ' + days.size],
  ];
  if(plans.length) sp.push(['Plan followed', 100 * plans.reduce((a, b) => a + b, 0) / plans.length, plans.length + ' journaled']);
  return { v: Math.round(sp.reduce((a, s) => a + s[1], 0) / sp.length), spokes: sp, weak: sp.reduce((a, s) => s[1] < a[1] ? s : a) };
}
function calendar(all){
  if(!all.length) return '';
  const last = new Date(Math.max(...all.map(t => t.timestamp))), m = new Date(last.getFullYear(), last.getMonth() - calOff, 1);
  const y = m.getFullYear(), mo = m.getMonth(), first = (m.getDay() + 6) % 7, nDays = new Date(y, mo + 1, 0).getDate();
  const byDay = new Map(); all.forEach(t => { const d = new Date(t.timestamp); if(d.getFullYear() === y && d.getMonth() === mo){ const k = d.getDate(), c = byDay.get(k) || { v: 0, n: 0, w: 0 }; c.v += t.pnl; c.n++; if(t.pnl > 0) c.w++; byDay.set(k, c); } });
  const max = Math.max(1, ...[...byDay.values()].map(c => Math.abs(c.v)));
  const cells = []; for(let i = 0; i < first; i++) cells.push(null); for(let d = 1; d <= nDays; d++) cells.push(d); while(cells.length % 7) cells.push(null);
  const weeks = []; for(let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  const today = new Date(), isToday = d => d && today.getFullYear() === y && today.getMonth() === mo && today.getDate() === d;
  const monthNet = [...byDay.values()].reduce((a, c) => a + c.v, 0), green = [...byDay.values()].filter(c => c.v > 0).length;
  const oldest = new Date(Math.min(...all.map(t => t.timestamp))), canBack = new Date(oldest.getFullYear(), oldest.getMonth(), 1) < m;
  return `<section class="hm-panel jr-cal" aria-label="Month calendar">
    <div class="jr-cal-h"><div><span class="hm-label">CALENDAR</span><h2>${m.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</h2></div>
      <div class="jr-cal-sum"><b class="${monthNet >= 0 ? 'pos' : 'neg'}">${money(monthNet)}</b><span>${green} green · ${byDay.size - green} red</span></div>
      <div class="jr-cal-nav"><button type="button" class="hbtn" data-cal="1" aria-label="Previous month" ${canBack ? '' : 'disabled'}>‹</button><button type="button" class="hbtn" data-cal="-1" aria-label="Next month" ${calOff ? '' : 'disabled'}>›</button></div></div>
    <div class="jr-cal-g">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun', 'Week'].map(d => `<span class="jr-cal-dn${d === 'Week' ? ' wk' : ''}">${d}</span>`).join('')}
      ${weeks.map((wk, wi) => { const wv = wk.reduce((a, d) => a + (d && byDay.get(d) ? byDay.get(d).v : 0), 0), wn = wk.reduce((a, d) => a + (d && byDay.get(d) ? byDay.get(d).n : 0), 0);
        return wk.map(d => { if(!d) return '<span class="jr-cd out"></span>'; const c = byDay.get(d);
          return `<span class="jr-cd${c ? (c.v >= 0 ? ' up' : ' dn') : ''}${isToday(d) ? ' today' : ''}" title="${c ? `${c.n} trades · ${money(c.v)}` : 'No trade'}"><i class="jr-cd-n">${d}</i>${c ? `<span class="jr-cd-bar"><i style="height:${Math.max(8, Math.abs(c.v) / max * 100).toFixed(0)}%"></i></span><b>${short(c.v)}</b><em>${c.n} tr · ${Math.round(100 * c.w / c.n)}%</em>` : ''}</span>`; }).join('')
          + `<span class="jr-cd wk"><i class="jr-cd-n">W${wi + 1}</i>${wn ? `<b class="${wv >= 0 ? 'pos' : 'neg'}">${short(wv)}</b><em>${wn} tr</em>` : ''}</span>`; }).join('')}</div>
  </section>`;
}
function render(){
  const box = document.getElementById('journalView'); if(!box) return;
  const all = computedTrades().sort((a, b) => b.timestamp - a.timestamp), list = inPeriod(all);
  const net = list.reduce((a, t) => a + t.pnl, 0), w = list.filter(t => t.pnl > 0), l = list.filter(t => t.pnl < 0);
  const gw = w.reduce((a, t) => a + t.pnl, 0), gl = -l.reduce((a, t) => a + t.pnl, 0), pf = gl > 0 ? gw / gl : null;
  const done = list.filter(t => has(entries.get(t.id))).length, pLabel = PERIODS.find(p => p[0] === period)[1];
  const bs = bars(list), bmax = Math.max(1, ...bs.map(b => Math.abs(b.v))), P = patterns(list), S = score(list);
  const best = list.length ? list.reduce((a, t) => t.pnl > a.pnl ? t : a) : null, worst = list.length ? list.reduce((a, t) => t.pnl < a.pnl ? t : a) : null;
  const dayMap = new Map(); list.forEach(t => { const k = new Date(t.timestamp).toDateString(); const d = dayMap.get(k) || { ts: t.timestamp, v: 0, n: 0 }; d.v += t.pnl; d.n++; dayMap.set(k, d); });
  const movers = [...dayMap.values()].sort((a, b) => Math.abs(b.v) - Math.abs(a.v)).slice(0, 5), mmax = Math.max(1, ...movers.map(d => Math.abs(d.v)));
  const shown = list.slice(0, limit), days = [];
  for(const t of shown){ const k = new Date(t.timestamp).toDateString(); let d = days[days.length - 1]; if(!d || d.k !== k){ d = { k, ts: t.timestamp, items: [] }; days.push(d); } d.items.push(t); }
  const today = new Date().toDateString(), yest = new Date(Date.now() - DAY).toDateString();
  const dayName = d => (d.k === today ? 'Today · ' : d.k === yest ? 'Yesterday · ' : '') + new Date(d.ts).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const tagGroups = ['Setup', 'Mood', 'Mistake'].map(k => [k, P.tags.filter(g => g.kind === k)]).filter(x => x[1].length);
  const kpi = (label, val, cls, sub) => `<div class="jr-kpi"><span class="jr-kpi-l">${label}</span><b class="jr-kpi-v ${cls || ''}">${val}</b><span class="jr-kpi-s">${sub}</span></div>`;
  const R = 34, C = 2 * Math.PI * R;
  box.innerHTML = `
    <section class="jr-top">
      <div><div class="hm-kicker">JOURNAL</div><h1 class="jr-title">Trading journal</h1>
        <p class="jr-lead">${all.length ? `<b>${done}</b> / ${list.length} journaled · ${pLabel === 'Today' ? 'today' : pLabel === 'All' ? 'all time' : 'last ' + pLabel.replace('D', ' days')}` : 'Your closed trades show up here.'}</p></div>
      <div class="hm-periods jr-periods" role="tablist" aria-label="Period">${PERIODS.map(([k, lb]) => `<button type="button" role="tab" data-jp="${k}" aria-selected="${k === period}" class="${k === period ? 'on' : ''}">${lb}</button>`).join('')}</div>
    </section>
    <div class="jr-kpis">
      ${kpi('Net P&amp;L', list.length ? money(net) : '$0.00', net >= 0 ? 'pos' : 'neg', `${w.length} W · ${l.length} L`)}
      ${kpi('Win rate', list.length ? Math.round(100 * w.length / list.length) + '%' : '—', '', `${list.length} trades`)}
      ${kpi('Profit factor', pf == null ? (gw > 0 ? '∞' : '—') : pf.toFixed(2), pf != null && pf >= 1 ? 'pos' : pf != null ? 'neg' : '', 'gross win / gross loss')}
      ${kpi('Avg win · loss', w.length || l.length ? `<span class="pos">${w.length ? short(gw / w.length) : '—'}</span> <span class="jr-kpi-sep">/</span> <span class="neg">${l.length ? short(-gl / l.length) : '—'}</span>` : '—', '', w.length && l.length ? `size ratio ${((gw / w.length) / (gl / l.length)).toFixed(2)}×` : 'per trade')}
      ${kpi('Best trade', best ? short(best.pnl) : '—', best && best.pnl >= 0 ? 'pos' : 'neg', best ? `${esc(tk(best.ticker))} · worst <span class="neg">${short(worst.pnl)}</span>` : '')}
      ${kpi('Journaled', `${done}<span class="jr-kpi-sep">/${list.length}</span>`, '', `<span class="jr-kpi-prog"><i style="width:${list.length ? (100 * done / list.length).toFixed(0) : 0}%"></i></span>`)}
    </div>
    <div class="jr-row2">
      ${calendar(all)}
      <div class="jr-rcol">
      <section class="hm-panel jr-score" aria-label="Desk score">
        <span class="hm-label">DESK SCORE</span>
        ${S ? `<div class="jr-score-in"><div class="jr-dial"><svg viewBox="0 0 80 80" width="96" height="96" aria-hidden="true"><circle cx="40" cy="40" r="${R}" fill="none" stroke="rgba(255,255,255,.08)" stroke-width="7"/><circle cx="40" cy="40" r="${R}" fill="none" stroke="var(--purple)" stroke-width="7" stroke-linecap="round" stroke-dasharray="${(C * S.v / 100).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 40 40)"/></svg><b>${S.v}</b></div>
          <div class="jr-spokes">${S.spokes.map(s => `<div class="jr-spoke${s === S.weak ? ' weak' : ''}"><span>${s[0]}</span><i><em style="width:${s[1].toFixed(0)}%"></em></i><b>${s[2]}</b></div>`).join('')}</div></div>
          <p class="jr-weak">Weakest spoke: <b>${S.weak[0]}</b></p>` : '<p class="jr-muted">The score shows from 5 trades in the period.</p>'}
      </section>
      <section class="hm-panel jr-strip">
      <div class="jr-strip-h"><span class="hm-label">P&amp;L PER ${period === '1d' ? 'HOUR' : period === 'all' ? 'WEEK' : 'DAY'}</span><span class="jr-muted">${pLabel === 'Today' ? 'today' : pLabel === 'All' ? 'all time' : 'last ' + pLabel.replace('D', ' days')}</span></div>
      <div class="jr-bars ${bs.length > 14 ? 'dense' : ''}" role="img" aria-label="P&amp;L per ${period === '1d' ? 'hour' : period === 'all' ? 'week' : 'day'}">${bs.map(b => `<div class="jr-bar" title="${esc(b.label)} · ${b.n} trades · ${money(b.v)}"><div class="jr-bar-col">${b.n ? `<i class="${b.v >= 0 ? 'up' : 'dn'}" style="height:${Math.max(5, Math.abs(b.v) / bmax * 50).toFixed(1)}%"></i>` : ''}</div>${bs.length <= 14 ? `<span class="jr-bar-v ${b.v >= 0 ? 'pos' : 'neg'}">${b.n ? short(b.v) : '·'}</span><span class="jr-bar-l">${esc(b.label)}</span>` : ''}</div>`).join('')}</div>
    </section>
      </div>
    </div>
    <div class="jr-grid">
      <section class="hm-panel jr-list" aria-label="Trades">
        <div class="jr-list-h"><span class="hm-label">TRADES</span><span class="jr-muted">Tap a trade to journal it</span></div>
        <div class="jr-thead" aria-hidden="true"><span>Coin</span><span>In → out</span><span>Hold</span><span>P&amp;L</span><span>Chart</span><span>Journal</span></div>
        ${!list.length ? `<div class="jr-empty"><b>No closed trade ${period === '1d' ? 'today' : 'in this period'}.</b><p>Pick a longer period, or connect a wallet so your trades import by themselves.</p></div>` : ''}
        ${days.map(d => { const a = dayMap.get(d.k); return `<div class="jr-day"><h3>${esc(dayName(d))}</h3><span>${a.n} trades · <b class="${a.v >= 0 ? 'pos' : 'neg'}">${money(a.v)}</b></span></div>${d.items.map(row).join('')}`; }).join('')}
        ${list.length > limit ? `<button type="button" class="hm-btn jr-more" id="jrMore">SHOW ${Math.min(PAGE, list.length - limit)} MORE</button>` : ''}
      </section>
      <aside class="jr-side" aria-label="Patterns">
        ${list.length < 5 ? `<section class="hm-panel jr-pat"><p class="jr-muted">Patterns show up from 5 trades in the period.</p></section>` : `
        ${P.after ? `<section class="hm-panel jr-pat jr-after"><span class="jr-k">AFTER A LOSS</span><p>${P.after.n} trades opened ≤ 15 min after a losing trade</p>
          <div class="jr-after-v"><b class="${P.after.v >= 0 ? 'pos' : 'neg'}">${money(P.after.v)}</b><span>${P.after.wins} / ${P.after.n} green</span></div>
          <div class="jr-dots" aria-hidden="true">${Array.from({ length: Math.min(P.after.n, 24) }, (_, i) => `<i class="${i < Math.round(P.after.wins * Math.min(P.after.n, 24) / P.after.n) ? 'up' : 'dn'}"></i>`).join('')}</div></section>` : ''}
        ${movers.length ? `<section class="hm-panel jr-pat"><h3>Days that moved P&amp;L</h3>${movers.map(d => `<div class="jr-g"><span class="jr-g-l">${new Date(d.ts).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</span><span class="jr-g-track" aria-hidden="true"><i class="${d.v >= 0 ? 'up' : 'dn'}" style="width:${Math.max(1.5, Math.abs(d.v) / mmax * 50).toFixed(1)}%"></i></span><b class="${d.v >= 0 ? 'pos' : 'neg'}">${short(d.v)}</b><span class="jr-g-meta">${d.n} tr</span></div>`).join('')}</section>` : ''}
        <section class="hm-panel jr-pat"><h3>By time of day</h3>${barRows(P.tod)}</section>
        <section class="hm-panel jr-pat"><h3>By hold time</h3>${barRows(P.hold)}</section>
        ${tagGroups.length ? tagGroups.map(([k, gs]) => `<section class="hm-panel jr-pat"><h3>By ${k.toLowerCase()}</h3>${barRows(gs.slice(0, 6))}</section>`).join('')
          : `<section class="hm-panel jr-pat jr-todo"><h3>By setup and mood</h3><p class="jr-muted">${P.tagged || 0} of ${list.length} journaled. Journal ${Math.max(1, 3 - (P.tagged || 0))} more to compare setups and moods.</p>
            <div class="jr-prog" role="progressbar" aria-label="Journaled trades" aria-valuemin="0" aria-valuemax="3" aria-valuenow="${Math.min(3, P.tagged || 0)}"><i style="width:${Math.min(100, (P.tagged || 0) / 3 * 100).toFixed(0)}%"></i></div></section>`}`}
      </aside>
    </div>`;
  box.querySelectorAll('[data-jp]').forEach(b => b.addEventListener('click', () => { period = b.dataset.jp; limit = PAGE; try{ localStorage.setItem('dc_journal_p', period); }catch(e){} render(); }));
  box.querySelectorAll('[data-cal]').forEach(b => b.addEventListener('click', () => { calOff = Math.max(0, calOff + Number(b.dataset.cal)); render(); }));
  box.querySelectorAll('.jr-row').forEach(el => { el.addEventListener('click', () => open(el.dataset.id)); if(typeof chartObserver !== 'undefined' && chartObserver) chartObserver.observe(el); });
  const more = document.getElementById('jrMore'); if(more) more.addEventListener('click', () => { limit += PAGE; render(); });
}

/* ---------- editor ---------- */
const ov = () => document.getElementById('journalOverlay');
function chips(list, sel, key, multi){
  return list.map(v => { const val = Array.isArray(v) ? v[0] : v, lb = Array.isArray(v) ? v[1] : v, on = multi ? sel.includes(val) : sel === val;
    return `<button type="button" class="jr-chip${on ? ' on' : ''}" data-k="${key}" data-val="${esc(val)}" ${multi ? `aria-pressed="${on}"` : `role="radio" aria-checked="${on}"`}>${esc(lb)}</button>`; }).join('');
}
function editorHTML(t){
  const win = t.pnl >= 0, mult = t.entryMc > 0 && t.exitMc > 0 ? t.exitMc / t.entryMc : null, st = chartState(t), d = draft;
  return `<article class="jr-ed" aria-labelledby="jrTitle">
    <div class="dt-head">${coinImg(t, 52, 'big')}
      <div class="dt-id"><h2 id="jrTitle">${esc(tk(t.ticker))}</h2><div class="dt-sub">Journal · ${fmt.date(t.timestamp)}</div></div></div>
    <section class="dt-hero ${win ? 'pos' : 'neg'}">
      <div class="dt-pnl">${fmt.usd(t.pnl)}</div>
      <div class="dt-hero-sub"><span class="dt-pill">${fmt.pct(t.roi)}</span>${mult ? `<span class="dt-pill ghost">×${mult.toFixed(mult >= 10 ? 1 : 2)} market cap</span>` : ''}<span class="dt-pill ghost">${fmt.hold(t.holdTime)} hold</span></div>
    </section>
    <div class="dt-chart jr-chart ${st === 'loading' ? 'is-loading' : ''}">${miniChart(t, true)}</div>
    <section class="jr-sec"><div class="jr-sec-h"><h3>Why did you enter?</h3><span>Pick any</span></div><div class="jr-chips">${chips(SETUPS, d.setups, 'setups', true)}</div></section>
    <section class="jr-sec"><div class="jr-sec-h"><h3>How did you feel?</h3></div><div class="jr-chips jr-chips-3" role="radiogroup" aria-label="Mood">${chips(MOODS, d.mood, 'mood', false)}</div></section>
    <section class="jr-sec"><div class="jr-sec-h"><h3>Did you follow your plan?</h3></div><div class="hm-periods jr-seg" role="radiogroup" aria-label="Plan followed">${PLANS.map(([v, lb]) => `<button type="button" role="radio" data-k="plan" data-val="${v}" aria-checked="${d.plan === v}" class="${d.plan === v ? 'on' : ''}">${lb}</button>`).join('')}</div>
      <div class="jr-sec-h jr-sub"><h3>Mistakes</h3><span>Optional</span></div><div class="jr-chips">${chips(MISTAKES, d.mistakes, 'mistakes', true)}</div></section>
    <section class="jr-sec"><label class="jr-sec-h" for="jrNote"><h3>Note</h3><span id="jrCount">${d.note.length} / 2000</span></label>
      <textarea id="jrNote" class="jr-note" rows="4" maxlength="2000" placeholder="What did you see? What would you do differently?">${esc(d.note)}</textarea></section>
    <div class="jr-actions"><button type="button" class="share-btn" id="jrSave">SAVE ENTRY</button><button type="button" class="hbtn" id="jrOpen">TRADE DETAILS</button></div>
  </article>`;
}
function paint(keepScroll){
  const t = trades.find(x => x.id === editing); if(!t) return close();
  const md = ov().querySelector('.modal'), y = md.scrollTop, note = document.getElementById('jrNote');
  if(note) draft.note = note.value.slice(0, 2000);
  document.getElementById('journalBody').innerHTML = editorHTML(t);
  if(keepScroll) md.scrollTop = y;
  document.getElementById('jrNote').addEventListener('input', e => { draft.note = e.target.value.slice(0, 2000); document.getElementById('jrCount').textContent = draft.note.length + ' / 2000'; });
  document.getElementById('jrSave').addEventListener('click', doSave);
  document.getElementById('jrOpen').addEventListener('click', () => { const id = editing; close(); openDetail(id); });
}
function open(id){
  const t = trades.find(x => x.id === id); if(!t) return;
  const e = entries.get(id);
  editing = id; draft = e ? { setups: [...e.setups], mood: e.mood, plan: e.plan, mistakes: [...e.mistakes], note: e.note } : { setups: [], mood: null, plan: null, mistakes: [], note: '' };
  paint(false);
  ov().classList.add('show'); ov().querySelector('.modal').scrollTop = 0;
  if(chartState(t) === 'loading') ensureChart(t);
}
function close(){ ov().classList.remove('show'); editing = null; draft = null; }
async function doSave(){
  if(saving || !editing) return;
  const t = trades.find(x => x.id === editing); if(!t) return;
  const note = document.getElementById('jrNote'); if(note) draft.note = note.value.slice(0, 2000);
  saving = true; const b = document.getElementById('jrSave'); b.disabled = true; b.textContent = 'SAVING…';
  const ok = await save(t, draft);
  saving = false;
  if(!ok){ b.disabled = false; b.textContent = 'SAVE ENTRY'; showToast("Couldn't save the entry, try again"); return; }
  close(); showToast(has(entries.get(t.id)) ? 'Saved to your journal' : 'Journal entry cleared'); render();
  if(detailOverlay.classList.contains('show') && detailOverlay.dataset.id === t.id) openDetail(t.id, true);
}
function init(){
  const o = ov(); if(!o) return;
  o.addEventListener('click', e => {
    if(e.target === o || e.target.closest('[data-close]')) return close();
    const c = e.target.closest('[data-k]'); if(!c || !draft) return;
    const k = c.dataset.k, v = c.dataset.val;
    if(k === 'setups' || k === 'mistakes'){ const a = draft[k]; draft[k] = a.includes(v) ? a.filter(x => x !== v) : [...a, v]; }
    else draft[k] = draft[k] === v ? null : v;
    // update the buttons in place: no re-render, the chart and the note stay as they are
    o.querySelectorAll(`[data-k="${k}"]`).forEach(x => { const on = Array.isArray(draft[k]) ? draft[k].includes(x.dataset.val) : draft[k] === x.dataset.val;
      x.classList.toggle(k === 'plan' ? 'on' : 'on', on); x.setAttribute(x.hasAttribute('aria-pressed') ? 'aria-pressed' : 'aria-checked', String(on)); });
  });
  document.addEventListener('keydown', e => { if(e.key === 'Escape' && o.classList.contains('show')) close(); });
}

/* trade detail: what was journaled, and a button to write it */
function detail(t){
  const box = document.getElementById('dtJournal'); if(!box) return;
  const e = entries.get(t.id), list = e ? [...e.setups, ...(e.mood ? [e.mood] : []), ...(e.plan ? ['Plan: ' + PLANS.find(p => p[0] === e.plan)[1]] : []), ...e.mistakes] : [];
  box.innerHTML = `<h3 class="dt-h">Journal</h3>
    ${has(e) ? `<div class="jr-tags dt-jr-tags">${list.map(x => `<span class="jr-tag">${esc(x)}</span>`).join('')}</div>${e.note ? `<p class="dt-jr-note">${esc(e.note)}</p>` : ''}` : '<p class="jr-muted">Why you took it, how you felt, what you learned.</p>'}
    <button type="button" class="hbtn dt-jr-btn" id="dtJournalBtn">${has(e) ? 'EDIT ENTRY' : 'WRITE IN JOURNAL'}</button>`;
  document.getElementById('dtJournalBtn').addEventListener('click', () => { detailOverlay.classList.remove('show'); open(t.id); });
}
function chartUpdated(ids){ if(editing && ids.includes(editing) && ov().classList.contains('show')) paint(true); }

init();
window.dcJournal = { load, render, open, detail, chartUpdated };
})();
