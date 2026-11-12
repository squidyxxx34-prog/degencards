/* ============================================================================
   DEGENCARDS — pull to refresh on Home (installed web app only)
   Pull Home down from the top: the iOS activity indicator builds up spoke by spoke under the header; past the
   line it pops and the data refreshes in place (no page reload). On release the page eases to a small gap where the
   spinner keeps turning (0.65 s at least), then glides back. The trades are read from the database first
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
const PULL = 76, REST = 76, MIN_SPIN = 650;        // release line, gap the page rests at while it spins (px), shortest spin (ms)
let busy = false;

/* ---------- the spinner: iOS activity indicator (UIRefreshControl) ----------
   8 spokes. Pulling: they appear one by one, clockwise from the top, one per 1/8 of the pull.
   At the line: a short elastic pop and the refresh starts right away, finger still down (like iOS).
   Refreshing: each spoke pulses 0.9 -> 0.25 opacity over 1 s, linear, 125 ms apart clockwise (Apple's WebKit values).
   Done: it shrinks and fades out in 300 ms. It never moves: only the page does. */
const N = 8;
const dial = document.createElement('div');
dial.className = 'ptr'; dial.setAttribute('aria-hidden', 'true');
dial.innerHTML = Array.from({ length: N }, (_, i) => `<i style="--i:${i}"></i>`).join('');
app.appendChild(dial);
const spokes = [...dial.children];
const live = document.createElement('div');
live.className = 'sr-only'; live.setAttribute('role', 'status'); live.setAttribute('aria-live', 'polite');
app.appendChild(live);

function homeOpen(){ return home.style.display !== 'none' && app.dataset.theme === 'blue' && !app.hidden; }
function atTop(){ return (document.body.scrollTop || 0) <= 0 && (document.documentElement.scrollTop || 0) <= 0 && (window.scrollY || 0) <= 0; }
function headerBottom(){ const h = document.querySelector('#app > header'); return h ? Math.max(0, h.getBoundingClientRect().bottom) : 0; }
function place(px){ home.style.transform = px > .05 ? `translate3d(0,${px.toFixed(2)}px,0)` : ''; }

/* ---------- motion: one spring, no breaks ----------
   After the finger lifts, the page is driven by a critically damped spring that starts with the finger's own speed.
   Its target is the resting gap while loading, then 0: changing the target never restarts the motion, the page just
   bends towards the new goal, so release -> rest -> return reads as one continuous gesture. The spinner fades and
   shrinks with the gap itself, so it is gone exactly when the page has closed over it. */
let x = 0, v = 0, goal = 0, w = 12, raf = 0, last = 0;
function springTo(g, omega){ goal = g; w = omega; if(!raf){ last = performance.now(); raf = requestAnimationFrame(tick); } }
function stopSpring(){ if(raf) cancelAnimationFrame(raf); raf = 0; }
function tick(now){
  const dt = Math.min(.034, (now - last) / 1000); last = now;
  for(let i = 0; i < 4; i++){ const h = dt / 4, a = -w * w * (x - goal) - 2 * w * v; v += a * h; x += v * h; }   // sub-steps: stable at any frame rate
  if(Math.abs(x - goal) < .15 && Math.abs(v) < 4){ x = goal; v = 0; raf = 0; }
  render();
  if(raf) raf = requestAnimationFrame(tick);
  else if(goal === 0) settle();
}
function render(){
  place(x);
  if(!dragging && dial.classList.contains('on')){                         // spinner follows the gap: full while open, fading as it closes
    const k = Math.max(0, Math.min(1, x / (REST * .85)));
    dial.style.opacity = k.toFixed(3); dial.style.scale = (.6 + .4 * k).toFixed(3);
  }
}
function settle(){ if(busy) return; dial.classList.remove('on', 'out', 'spin', 'pop'); dial.style.opacity = ''; dial.style.scale = ''; spokes.forEach(s => s.classList.remove('in')); }
function show(){ clearTimeout(hideT); dial.style.top = headerBottom() + 'px'; dial.classList.remove('out', 'spin', 'pop'); dial.classList.add('on'); }
let lastY = 0, lastYt = 0;
function setPull(px){
  const now = performance.now(); if(lastYt) v = v * .4 + .6 * (px - lastY) / Math.max(.008, (now - lastYt) / 1000); lastY = px; lastYt = now;   // finger speed, smoothed
  x = px; place(px);
  if(dial.classList.contains('spin')) return;                            // already refreshing: spokes keep pulsing
  const n = Math.min(N, Math.floor(px / PULL * N + 1e-6));
  spokes.forEach((s, i) => s.classList.toggle('in', i < n));
}
let hideT = 0;
function hide(){                                                          // shrink + fade, 350 ms
  dial.classList.add('out');
  clearTimeout(hideT); hideT = setTimeout(() => { dial.classList.remove('on', 'out', 'spin', 'pop'); spokes.forEach(s => s.classList.remove('in')); }, 350);
}

/* ---------- gesture ---------- */
let y0 = 0, x0 = 0, x0f = 0, dy = 0, track = false, lock = '', fired = false, dragging = false;
function ok(e){
  if(!standalone || !homeOpen() || !atTop() || e.touches.length !== 1) return false;
  const t = e.target;
  return !(t.closest && t.closest('.lq-panel, .overlay, [role="dialog"], #guide, input, textarea, select, .hm-periods, #nav'));
}
document.addEventListener('touchstart', e => {
  track = ok(e); if(!track) return;
  y0 = e.touches[0].clientY; x0 = e.touches[0].clientX; dy = 0; lock = ''; fired = busy;
}, { passive: true });
document.addEventListener('touchmove', e => {
  if(!track) return;
  const t = e.touches[0], ry = t.clientY - y0, rx = t.clientX - x0;
  if(!lock){
    if(Math.abs(ry) < 6 && Math.abs(rx) < 6) return;
    lock = Math.abs(ry) > Math.abs(rx) && ry > 0 ? 'y' : 'x';
    if(lock === 'y'){ y0 = t.clientY; x0f = x; dragging = true; stopSpring(); lastYt = 0; v = 0; dial.style.opacity = ''; dial.style.scale = ''; if(!busy) show(); }
  }
  if(lock !== 'y' || !atTop()){ track = false; release(); return; }
  e.preventDefault();
  dy = x0f + 240 * (1 - Math.exp(-Math.max(0, t.clientY - y0) / 430));   // elastic, no hard stop (starts from where the page already is)
  setPull(dy);
  if(!fired && dy >= PULL){ fired = true; run(); }                        // iOS starts refreshing at the line, not on release
}, { passive: false });
document.addEventListener('touchend', () => { if(track){ track = false; release(); } }, { passive: true });
document.addEventListener('touchcancel', () => { if(track){ track = false; release(); } }, { passive: true });
function release(){
  const was = dragging; dragging = false; dy = 0;
  if(!was) return;
  if(v < 0) v *= .5;                                                      // a flick upwards keeps some of its speed, never a jolt
  springTo(busy ? REST : 0, busy ? 13 : 10);                              // loading: settles into the gap; otherwise straight home
}
function back(){ springTo(0, 10); }                                       // the return: slower spring, soft landing

/* ---------- refresh: data only, never the page ---------- */
async function run(){
  if(busy || typeof reload !== 'function') return;
  busy = true;
  const big = $('hmPnlBig');
  const before = big ? big.textContent : '';
  stop(big);                                                             // a count still running: put its final value back first
  if(!dial.classList.contains('on')) show();
  if(!dragging) springTo(REST, 13);
  spokes.forEach(s => s.classList.add('in'));
  dial.classList.add('spin');                                            // the pulse starts, no jolt
  live.textContent = 'Refreshing';
  const hold = typeof celeb !== 'undefined' && !celeb.busy; if(hold) celeb.busy = true;     // a card drop waits until the balance has landed
  const t0 = performance.now();
  try{ await reload(); }                                                 // database read first: this is what the user is waiting for
  catch(e){ if(typeof showToast === 'function') showToast("Couldn't refresh — check your connection"); }
  const ms = roll($('hmPnlBig'), before);                                 // the balance glides as soon as the data is in, while the spinner still turns
  await new Promise(r => setTimeout(r, Math.max(0, MIN_SPIN - (performance.now() - t0))));   // the spinner gets its full turn at the top
  busy = false;
  if(!dragging) back();                                                  // finger still down: the return happens on release
  if(hold) setTimeout(() => { celeb.busy = false; celeb.next(); }, ms + 500);
  live.textContent = 'Updated';
  // then ask the server to check the wallets; if it finds new trades the app reloads them itself and the balance glides again
  if(typeof syncNow === 'function' && typeof connectedAccounts !== 'undefined' && connectedAccounts.length){
    const el = $('hmPnlBig'), shown = el ? (el._to || el.textContent) : '';
    Promise.resolve(syncNow(false)).then(() => { const e2 = $('hmPnlBig'); if(e2 && e2._to == null && e2.textContent !== shown) roll(e2, shown); }).catch(() => {});   // only when the app itself wrote a new figure
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
    const p = Math.min(1, (now - t0) / DUR), e = p >= 1 ? 1 : 1 - Math.pow(2, -10 * p);  // exponential ease-out, same curve as the page
    el._last = el.textContent = p < 1 ? fmt(a + (b - a) * e) : to;
    if(p < 1) requestAnimationFrame(step); else el._to = null;
  })(t0);
  return DUR;
}

if(standalone) document.documentElement.classList.add('dc-standalone');
window.dcPtr = { run, standalone };
})();
