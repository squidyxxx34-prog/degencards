/* ============================================================================
   DEGENCARDS — pull to refresh on Home (installed web app only)
   Pull Home down from the top: an iOS-style activity spinner fades and turns in with the pull; release
   past the line and the data refreshes in place (no page reload). The trades are read from the database first
   and shown at once; the wallet sync runs after, in the background. The balance glides to its new value
   (one continuous count, no steps) while the page eases back.
   Only in the home-screen web app (display-mode: standalone): a browser tab keeps its own pull / reload.
   window.dcPtr.run() starts a refresh by hand (tests).
   ============================================================================ */
(function(){
const standalone = (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
const reduce = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
const $ = id => document.getElementById(id);
const home = $('homeView'), app = $('app'); if(!home || !app) return;
const PULL = 64, MAX = 120, REST = 52, N = 8;      // release line, furthest pull, resting gap while loading (px), spokes
let busy = false;

/* ---------- the spinner ---------- */
const dial = document.createElement('div');
dial.className = 'ptr'; dial.setAttribute('aria-hidden', 'true');
dial.innerHTML = Array.from({ length: N }, (_, i) => `<i style="--i:${i}"></i>`).join('');
app.appendChild(dial);
const live = document.createElement('div');
live.className = 'sr-only'; live.setAttribute('role', 'status'); live.setAttribute('aria-live', 'polite');
app.appendChild(live);

function homeOpen(){ return home.style.display !== 'none' && app.dataset.theme === 'blue' && !app.hidden; }
function atTop(){ return (document.body.scrollTop || 0) <= 0 && (document.documentElement.scrollTop || 0) <= 0 && (window.scrollY || 0) <= 0; }
function headerBottom(){ const h = document.querySelector('#app > header'); return h ? Math.max(0, h.getBoundingClientRect().bottom) : 0; }
function place(px){                                                       // page follows the finger, spinner centred in the gap
  home.style.transform = px ? `translate3d(0,${px.toFixed(1)}px,0)` : '';
  dial.style.transform = `translate3d(0,${Math.max(4, px / 2 - 14).toFixed(1)}px,0)`;
}
function setPull(px){                                                     // one continuous move: fades, grows and turns with the finger
  place(px);
  const k = Math.min(1, px / PULL);
  dial.style.opacity = k.toFixed(3); dial.style.scale = (.55 + .45 * k).toFixed(3); dial.style.rotate = (px * 2.4).toFixed(1) + 'deg';
}
let hideT = 0;
function hide(){
  place(0); dial.classList.remove('on', 'drag'); dial.style.opacity = ''; dial.style.scale = '';
  clearTimeout(hideT); hideT = setTimeout(() => { if(!dial.classList.contains('on')){ dial.classList.remove('spin'); dial.style.rotate = ''; } }, 320);   // keeps turning while it fades
}

/* ---------- gesture ---------- */
let y0 = 0, x0 = 0, dy = 0, track = false, lock = '';
function ok(e){
  if(!standalone || busy || !homeOpen() || !atTop() || e.touches.length !== 1) return false;
  const t = e.target;
  return !(t.closest && t.closest('.lq-panel, .overlay, [role="dialog"], #guide, input, textarea, select, .hm-periods, #nav'));
}
document.addEventListener('touchstart', e => {
  track = ok(e); if(!track) return;
  y0 = e.touches[0].clientY; x0 = e.touches[0].clientX; dy = 0; lock = '';
}, { passive: true });
document.addEventListener('touchmove', e => {
  if(!track) return;
  const t = e.touches[0], ry = t.clientY - y0, rx = t.clientX - x0;
  if(!lock){
    if(Math.abs(ry) < 6 && Math.abs(rx) < 6) return;
    lock = Math.abs(ry) > Math.abs(rx) && ry > 0 ? 'y' : 'x';
    if(lock === 'y'){ dial.style.top = headerBottom() + 'px'; dial.classList.add('on', 'drag'); home.classList.add('ptr-drag'); }
  }
  if(lock !== 'y' || ry <= 0 || !atTop()){ track = false; end(false); return; }
  e.preventDefault();
  dy = Math.min(MAX, ry * .5);
  setPull(dy);
}, { passive: false });
document.addEventListener('touchend', () => { if(track){ track = false; end(dy >= PULL); } }, { passive: true });
document.addEventListener('touchcancel', () => { if(track){ track = false; end(false); } }, { passive: true });
function end(go){
  home.classList.remove('ptr-drag'); dial.classList.remove('drag'); dy = 0;
  if(go) run(); else hide();
}

/* ---------- refresh: data only, never the page ---------- */
async function run(){
  if(busy || typeof reload !== 'function') return;
  busy = true;
  const big = $('hmPnlBig');
  const before = big ? big.textContent : '';
  stop(big);                                                             // a count still running: put its final value back first (the app only rewrites the figure when it changes)
  dial.style.top = headerBottom() + 'px'; clearTimeout(hideT); dial.classList.add('on', 'spin'); dial.style.opacity = ''; dial.style.scale = ''; dial.style.rotate = '';
  place(REST);
  live.textContent = 'Refreshing';
  const hold = typeof celeb !== 'undefined' && !celeb.busy; if(hold) celeb.busy = true;     // a card drop waits until the balance has landed
  const t0 = performance.now();
  try{ await reload(); }                                                 // database read first: this is what the user is waiting for
  catch(e){ if(typeof showToast === 'function') showToast("Couldn't refresh — check your connection"); }
  const wait = 300 - (performance.now() - t0); if(wait > 0) await new Promise(r => setTimeout(r, wait));
  hide();
  const ms = roll($('hmPnlBig'), before);
  if(hold) setTimeout(() => { celeb.busy = false; celeb.next(); }, ms + 500);
  live.textContent = 'Updated';
  busy = false;
  // then ask the server to check the wallets; if it finds new trades the app reloads them itself and the balance rolls again
  if(typeof syncNow === 'function' && typeof connectedAccounts !== 'undefined' && connectedAccounts.length){
    const el = $('hmPnlBig'), shown = el ? (el._to || el.textContent) : '';
    Promise.resolve(syncNow(false)).then(() => { const e2 = $('hmPnlBig'); if(e2 && e2.textContent !== shown && e2.textContent !== e2._to) roll(e2, shown); }).catch(() => {});
  }
}

/* ---------- the balance glides to its value: one eased count, every digit moving together ---------- */
function parseUsd(t){ const v = parseFloat(String(t || '').replace(/[^0-9.]/g, '')); return Number.isFinite(v) ? (/^\s*[-−]/.test(t) ? -v : v) : NaN; }
function stop(el){ if(el && el._to != null){ if(el.textContent === el._last) el.textContent = el._to; el._to = null; el._tw = 0; } }
function roll(el, from){
  if(!el || el.hidden) return 0;
  const to = el.textContent, a = parseUsd(from), b = parseUsd(to), DUR = 750;
  if(!to) return 0;
  el.classList.remove('ptr-soft'); void el.offsetWidth; el.classList.add('ptr-soft');          // soft breath on the figure, even when the value is the same
  setTimeout(() => el.classList.remove('ptr-soft'), DUR + 50);
  if(reduce() || !Number.isFinite(a) || !Number.isFinite(b) || Math.abs(a - b) < .005) return DUR;
  const minus = (to.match(/[-−]/) || String(from).match(/[-−]/) || ['-'])[0], plus = /\+/.test(to + from) ? '+' : '';
  const fmt = v => (v < 0 ? minus : plus) + '$' + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  stop(el);
  const t0 = performance.now(), id = (roll.n = (roll.n || 0) + 1);
  el._tw = id; el._to = to; el._last = el.textContent = fmt(a);
  (function step(now){
    if(el._tw !== id) return;                                             // stopped or replaced
    if(el.textContent !== el._last){ el._to = null; return; }             // the app wrote a newer value meanwhile: leave it
    const p = Math.min(1, (now - t0) / DUR), e = 1 - Math.pow(1 - p, 4);  // ease-out: fast start, long soft landing
    el._last = el.textContent = p < 1 ? fmt(a + (b - a) * e) : to;
    if(p < 1) requestAnimationFrame(step); else el._to = null;
  })(t0);
  return DUR;
}

if(standalone) document.documentElement.classList.add('dc-standalone');
window.dcPtr = { run, standalone };
})();
