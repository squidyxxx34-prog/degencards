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
  out.tod = groups(list, [['Night · 00–06', 0, 6], ['Morning · 06–12', 6, 12], ['Afternoon · 12–18', 12, 18], ['Evening · 18–24', 18, 24]], t => new Date(opened(t)).getHours());
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

/* ---------- page ---------- */
function barRows(gs){
  const max = Math.max(1, ...gs.map(g => Math.abs(g.v)));
  return gs.map(g => `<div class="jr-g">
      <div class="jr-g-top"><span>${esc(g.label)}</span><span class="jr-g-meta">${g.n} ${g.n === 1 ? 'trade' : 'trades'} · ${Math.round(100 * g.wins / g.n)}% win</span></div>
      <div class="jr-g-track" aria-hidden="true"><i class="${g.v >= 0 ? 'up' : 'dn'}" style="width:${Math.max(1.5, Math.abs(g.v) / max * 50).toFixed(1)}%"></i></div>
      <b class="${g.v >= 0 ? 'pos' : 'neg'}">${money(g.v)}</b></div>`).join('');
}
function tagChips(e){
  if(!has(e)) return '<span class="jr-add">+ Add a note</span>';
  const t = [...e.setups, ...(e.mood ? [e.mood] : []), ...(e.plan ? ['Plan: ' + PLANS.find(p => p[0] === e.plan)[1]] : []), ...e.mistakes];
  return t.slice(0, 3).map(x => `<span class="jr-tag">${esc(x)}</span>`).join('') + (t.length > 3 ? `<span class="jr-tag more">+${t.length - 3}</span>` : '') + (!t.length && e.note ? '<span class="jr-tag">Note</span>' : '');
}
function row(t){
  const win = t.pnl >= 0;
  return `<button type="button" class="jr-row" data-id="${esc(t.id)}" aria-label="Journal ${esc(tk(t.ticker))}, ${money(t.pnl)}">
    <span class="jr-row-main">
      <span class="jr-row-top">${coinImg(t, 28)}<b class="jr-tk">${esc(tk(t.ticker))}</b><span class="jr-time">${new Date(t.timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</span></span>
      <span class="jr-row-nums"><b class="${win ? 'pos' : 'neg'}">${money(t.pnl)}</b><span>${fmt.pct(t.roi)} · ${fmt.hold(t.holdTime)}</span></span>
      <span class="jr-tags">${tagChips(entries.get(t.id))}</span>
    </span>
    <span class="mini jr-mini">${miniChart(t)}</span>
  </button>`;
}
function render(){
  const box = document.getElementById('journalView'); if(!box) return;
  const all = computedTrades().sort((a, b) => b.timestamp - a.timestamp), list = inPeriod(all);
  const net = list.reduce((a, t) => a + t.pnl, 0), w = list.filter(t => t.pnl > 0), l = list.filter(t => t.pnl < 0);
  const done = list.filter(t => has(entries.get(t.id))).length, pLabel = PERIODS.find(p => p[0] === period)[1];
  const bs = bars(list), bmax = Math.max(1, ...bs.map(b => Math.abs(b.v))), P = patterns(list);
  // trades grouped by day
  const shown = list.slice(0, limit), days = [];
  for(const t of shown){ const k = new Date(t.timestamp).toDateString(); let d = days[days.length - 1]; if(!d || d.k !== k){ d = { k, ts: t.timestamp, items: [] }; days.push(d); } d.items.push(t); }
  const today = new Date().toDateString(), yest = new Date(Date.now() - DAY).toDateString();
  const dayName = d => (d.k === today ? 'Today · ' : d.k === yest ? 'Yesterday · ' : '') + new Date(d.ts).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const dayAll = d => list.filter(t => new Date(t.timestamp).toDateString() === d.k);
  const tagGroups = ['Setup', 'Mood', 'Mistake'].map(k => [k, P.tags.filter(g => g.kind === k)]).filter(x => x[1].length);
  box.innerHTML = `
    <section class="pg-head">
      <div><div class="hm-kicker">JOURNAL</div><h1 class="pg-title">Your trading journal</h1>
        <p class="hm-summary">${all.length ? `<b>${done}</b> of ${list.length} trades journaled · ${pLabel === 'Today' ? 'today' : pLabel === 'All' ? 'all time' : 'last ' + pLabel.replace('D', ' days')}` : 'Your closed trades show up here. Write why you took them, how you felt, and what you learned.'}</p></div>
      <div class="hm-periods jr-periods" role="tablist" aria-label="Period">${PERIODS.map(([k, lb]) => `<button type="button" role="tab" data-jp="${k}" aria-selected="${k === period}" class="${k === period ? 'on' : ''}">${lb}</button>`).join('')}</div>
    </section>
    <section class="hm-panel jr-hero">
      <div class="jr-hero-top"><span class="hm-label">NET P&amp;L</span><span class="jr-hero-meta">${list.length} trades${list.length ? ` · ${Math.round(100 * w.length / list.length)}% win` : ''}</span></div>
      <div class="jr-net ${net >= 0 ? 'pos' : 'neg'}">${list.length ? money(net) : '$0.00'}</div>
      <div class="jr-hero-sub">${w.length ? `<span>Avg win <b class="pos">${money(w.reduce((a, t) => a + t.pnl, 0) / w.length)}</b></span>` : ''}${l.length ? `<span>Avg loss <b class="neg">${money(l.reduce((a, t) => a + t.pnl, 0) / l.length)}</b></span>` : ''}</div>
      <div class="jr-bars ${bs.length > 14 ? 'dense' : ''}" role="img" aria-label="P&amp;L per ${period === '1d' ? 'hour' : period === 'all' ? 'week' : 'day'}">${bs.map(b => `<div class="jr-bar" title="${esc(b.label)} · ${b.n} trades · ${money(b.v)}"><div class="jr-bar-col">${b.n ? `<i class="${b.v >= 0 ? 'up' : 'dn'}" style="height:${Math.max(5, Math.abs(b.v) / bmax * 50).toFixed(1)}%"></i>` : ''}</div>${bs.length <= 14 ? `<span class="jr-bar-v ${b.v >= 0 ? 'pos' : 'neg'}">${b.n ? short(b.v) : '·'}</span><span class="jr-bar-l">${esc(b.label)}</span>` : ''}</div>`).join('')}</div>
    </section>
    <div class="jr-grid">
      <div class="jr-list">
        ${!list.length ? `<div class="hm-panel jr-empty"><b>No closed trade ${period === '1d' ? 'today' : 'in this period'}.</b><p>Pick a longer period, or connect a wallet so your trades import by themselves.</p></div>` : ''}
        ${days.map(d => { const a = dayAll(d); return `<div class="jr-day"><h2>${esc(dayName(d))}</h2><span>${a.filter(t => has(entries.get(t.id))).length} of ${a.length} journaled · <b class="${a.reduce((x, t) => x + t.pnl, 0) >= 0 ? 'pos' : 'neg'}">${money(a.reduce((x, t) => x + t.pnl, 0))}</b></span></div>${d.items.map(row).join('')}`; }).join('')}
        ${list.length > limit ? `<button type="button" class="hm-btn jr-more" id="jrMore">SHOW ${Math.min(PAGE, list.length - limit)} MORE</button>` : ''}
      </div>
      <aside class="jr-side" aria-label="Patterns">
        <h2 class="jr-side-h">Patterns</h2>
        ${list.length < 5 ? `<div class="hm-panel jr-pat"><p class="jr-muted">Patterns show up from 5 trades in the period.</p></div>` : `
        ${P.after ? `<section class="hm-panel jr-pat jr-after"><span class="jr-k">AFTER A LOSS</span><p>${P.after.n} trades opened within 15 min of a losing trade</p>
          <div class="jr-after-v"><b class="${P.after.v >= 0 ? 'pos' : 'neg'}">${money(P.after.v)}</b><span>${P.after.wins} of ${P.after.n} green</span></div>
          <div class="jr-dots" aria-hidden="true">${Array.from({ length: Math.min(P.after.n, 24) }, (_, i) => `<i class="${i < Math.round(P.after.wins * Math.min(P.after.n, 24) / P.after.n) ? 'up' : 'dn'}"></i>`).join('')}</div></section>` : ''}
        <section class="hm-panel jr-pat"><h3>By time of day</h3>${barRows(P.tod)}</section>
        <section class="hm-panel jr-pat"><h3>By hold time</h3>${barRows(P.hold)}</section>
        ${tagGroups.length ? tagGroups.map(([k, gs]) => `<section class="hm-panel jr-pat"><h3>By ${k.toLowerCase()}</h3>${barRows(gs.slice(0, 6))}</section>`).join('')
          : `<section class="hm-panel jr-pat jr-todo"><h3>By setup and mood</h3><p class="jr-muted">${P.tagged || 0} of ${list.length} trades journaled. Journal ${Math.max(1, 3 - (P.tagged || 0))} more to compare your setups and moods.</p>
            <div class="jr-prog" role="progressbar" aria-label="Journaled trades" aria-valuemin="0" aria-valuemax="3" aria-valuenow="${Math.min(3, P.tagged || 0)}"><i style="width:${Math.min(100, (P.tagged || 0) / 3 * 100).toFixed(0)}%"></i></div></section>`}`}
      </aside>
    </div>`;
  box.querySelectorAll('[data-jp]').forEach(b => b.addEventListener('click', () => { period = b.dataset.jp; limit = PAGE; try{ localStorage.setItem('dc_journal_p', period); }catch(e){} render(); }));
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
