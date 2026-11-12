/* ============================================================================
   DEGENCARDS — pull to refresh on Home (installed web app only), after takuoka/PullToBounce (MIT)
   https://github.com/takuoka/PullToBounce — same phases and values, ported from Swift to the web:
   1. Pull: Home slides down and fades out; a glass sheet follows it, its top edge flat.
   2. Past the pull distance (96 px) the edge bends down like a membrane, up to 40 px.
   3. At pull + bend (136 px) it locks: the edge is let go and wobbles back (damped keyframes 1, -.7, .4, -.3, .15, 0
      over 0.8 s, ease-in); 0.2 s later a ball rises out of the surface (0.25 s, overshoot curve .49,.13,.29,1.61)
      and a ring draws itself around it while turning (1 s per turn, stroke drawn then erased, 0.8 s each, ease-out).
   4. Data in: the ring goes, the ball sinks back (0.25 s), the page comes back up and fades in, the balance glides.
   Only in the home-screen web app (display-mode: standalone): a browser tab keeps its own pull / reload.
   window.dcPtr.run() starts a refresh by hand (tests).
   ============================================================================ */
(function(){
const standalone = (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
const reduce = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
const $ = id => document.getElementById(id);
const home = $('homeView'), app = $('app'); if(!home || !app) return;
const PULL = 96, BEND = 40, STOP = PULL + BEND, BALL = 36, UP = PULL / 2 + BALL / 2;   // PullToBounce defaults
const BOUNCE_MS = 800, UP_MS = 250, MIN_MS = 1400;
let busy = false;

/* ---------- elements: the sheet (bendable top edge), the ball and its ring ---------- */
const sheet = document.createElement('div'); sheet.className = 'ptb-sheet'; sheet.setAttribute('aria-hidden', 'true');
const ball = document.createElement('div'); ball.className = 'ptb-ball'; ball.setAttribute('aria-hidden', 'true');
const R = BALL / 2 * 1.2, C = R + 3, a0 = -Math.PI / 2, a1 = Math.PI * 1.5 + Math.PI / 8;    // ring: radius ball/2 x 1.2, one turn + 1/16
const pt = a => `${(C + R * Math.cos(a)).toFixed(2)} ${(C + R * Math.sin(a)).toFixed(2)}`;
ball.innerHTML = `<i></i><svg viewBox="0 0 ${C * 2} ${C * 2}" width="${C * 2}" height="${C * 2}"><path pathLength="1" d="M${pt(a0)} A${R} ${R} 0 1 1 ${pt(a0 + Math.PI)} A${R} ${R} 0 0 1 ${pt(a0 + Math.PI * 2)} A${R} ${R} 0 0 1 ${pt(a1)}"/></svg>`;
app.appendChild(ball); app.appendChild(sheet);
const live = document.createElement('div'); live.className = 'sr-only'; live.setAttribute('role', 'status'); live.setAttribute('aria-live', 'polite');
app.appendChild(live);

function homeOpen(){ return home.style.display !== 'none' && app.dataset.theme === 'blue' && !app.hidden; }
function atTop(){ return (document.body.scrollTop || 0) <= 0 && (document.documentElement.scrollTop || 0) <= 0 && (window.scrollY || 0) <= 0; }
function headerBottom(){ const h = document.querySelector('#app > header'); return h ? Math.max(0, h.getBoundingClientRect().bottom) : 0; }

/* ---------- drawing: page offset x, edge bend b ---------- */
const LIP = 60;                                  // the sheet box starts above its edge so the edge can bulge up while it wobbles
let x = 0, bend = 0, hb = 0, wobble = null;
function draw(){
  home.style.transform = x > .05 ? `translate3d(0,${x.toFixed(2)}px,0)` : '';
  home.style.opacity = x > .05 ? Math.max(0, (PULL - x) / PULL).toFixed(3) : '';                    // Home fades out over the pull distance
  const on = x > .05 || busy;
  app.classList.toggle('ptb-on', on);
  if(!on){ sheet.style.display = 'none'; return; }
  const w = innerWidth, edge = hb + Math.min(x, PULL), b = wobble ? wobble.b : bend, H = innerHeight + LIP;
  sheet.style.display = 'block';
  sheet.style.transform = `translate3d(0,${(edge - LIP).toFixed(2)}px,0)`;
  sheet.style.clipPath = `path('M0 ${H} L0 ${LIP} Q${w / 2} ${(LIP + b * 2).toFixed(2)} ${w} ${LIP} L${w} ${H} Z')`;   // quad control at 2b: the edge dips by b
  ball.style.top = (hb + PULL) + 'px';
}
function setBend(px){ x = px; bend = Math.max(0, Math.min(BEND, px - PULL)); draw(); }

/* the release wobble: CAKeyframeAnimation on the path, values b x [1, -.7, .4, -.3, .15, 0], 0.8 s, ease-in, linear between keys */
const KEYS = [1, -.7, .4, -.3, .15, 0];
const easeIn = t => { let lo = 0, hi = 1, u = t; for(let i = 0; i < 18; i++){ u = (lo + hi) / 2; const xx = 3 * u * (1 - u) * (1 - u) * .42 + 3 * u * u * (1 - u) + u * u * u; if(xx < t) lo = u; else hi = u; } return 3 * u * u * (1 - u) + u * u * u; };   // cubic-bezier(.42,0,1,1)
function wobbleFrom(b){
  const t0 = performance.now(); wobble = { b };
  (function step(now){
    if(!wobble) return;
    const p = Math.min(1, (now - t0) / BOUNCE_MS), e = easeIn(p) * (KEYS.length - 1), i = Math.min(KEYS.length - 2, Math.floor(e)), f = e - i;
    wobble.b = b * (KEYS[i] + (KEYS[i + 1] - KEYS[i]) * f); draw();
    if(p < 1) requestAnimationFrame(step); else { wobble = null; bend = 0; draw(); }
  })(t0);
}

/* page spring for the way back (and a release before the lock) */
let v = 0, raf = 0, last = 0;
let flat = false;
function springHome(omega, keepFlat){
  flat = !!keepFlat;
  cancelAnimationFrame(raf); last = performance.now();
  raf = requestAnimationFrame(function tick(now){
    const dt = Math.min(.034, (now - last) / 1000); last = now;
    for(let i = 0; i < 4; i++){ const h = dt / 4, a = -omega * omega * x - 2 * omega * v; v += a * h; x += v * h; }
    if(Math.abs(x) < .15 && Math.abs(v) < 4){ x = 0; v = 0; raf = 0; }
    bend = flat ? 0 : Math.max(0, Math.min(BEND, x - PULL)); draw();       // after a refresh the edge stays flat on the way back (no second dip)
    if(raf) raf = requestAnimationFrame(tick); else done();
  });
}
function done(){ if(busy) return; app.classList.remove('ptb-on'); sheet.style.display = 'none'; home.style.opacity = ''; home.style.transform = ''; if(pendingRoll) { pendingRoll(); pendingRoll = null; } }

/* ---------- gesture ---------- */
let y0 = 0, x0 = 0, track = false, lock = '', dragging = false, lastX = 0, lastT = 0;
function ok(e){
  if(!standalone || !homeOpen() || !atTop() || e.touches.length !== 1) return false;
  const t = e.target;
  return !(t.closest && t.closest('.lq-panel, .overlay, [role="dialog"], #guide, input, textarea, select, .hm-periods, #nav'));
}
document.addEventListener('touchstart', e => {
  track = ok(e); if(!track) return;
  y0 = e.touches[0].clientY; x0 = e.touches[0].clientX; lock = '';
}, { passive: true });
document.addEventListener('touchmove', e => {
  if(!track) return;
  const t = e.touches[0], ry = t.clientY - y0, rx = t.clientX - x0;
  if(busy){ e.preventDefault(); return; }                                  // locked while it loads (scroll disabled, like the original)
  if(!lock){
    if(Math.abs(ry) < 6 && Math.abs(rx) < 6) return;
    lock = Math.abs(ry) > Math.abs(rx) && ry > 0 ? 'y' : 'x';
    if(lock === 'y'){ y0 = t.clientY; dragging = true; cancelAnimationFrame(raf); raf = 0; hb = headerBottom(); lastT = 0; }
  }
  if(lock !== 'y' || !atTop()){ track = false; release(); return; }
  e.preventDefault();
  const px = Math.max(0, t.clientY - y0) * .62;                           // scroll-view-like resistance
  const now = performance.now(); if(lastT) v = (px - lastX) / Math.max(.008, (now - lastT) / 1000); lastX = px; lastT = now;
  if(px >= STOP){ setBend(STOP); dragging = false; run(true); return; }   // reached pull + bend: lock and refresh
  setBend(px);
}, { passive: false });
document.addEventListener('touchend', () => { if(track){ track = false; release(); } }, { passive: true });
document.addEventListener('touchcancel', () => { if(track){ track = false; release(); } }, { passive: true });
function release(){ if(!dragging) return; dragging = false; if(!busy){ if(v < 0) v *= .5; springHome(12); } }

/* ---------- refresh: data only, never the page ---------- */
let pendingRoll = null;
async function run(fromPull){
  if(busy || typeof reload !== 'function') return;
  busy = true;
  const big = $('hmPnlBig'), before = big ? big.textContent : '';
  stop(big);
  hb = headerBottom();
  if(!fromPull){ x = STOP; bend = BEND; }
  x = STOP; draw();
  live.textContent = 'Refreshing';
  const hold = typeof celeb !== 'undefined' && !celeb.busy; if(hold) celeb.busy = true;     // a card drop waits until the balance has landed
  const t0 = performance.now();
  wobbleFrom(BEND);                                                       // the edge is let go
  setTimeout(() => { if(busy) ball.classList.add('up'); }, 200);          // 0.2 s later the ball rises out of the surface
  setTimeout(() => { if(busy) ball.classList.add('spin'); }, 200 + UP_MS); // then the ring
  try{ await reload(); }
  catch(e){ if(typeof showToast === 'function') showToast("Couldn't refresh — check your connection"); }
  await new Promise(r => setTimeout(r, Math.max(0, MIN_MS - (performance.now() - t0))));
  // ending: ring off, ball sinks back, then the page comes up and fades in
  ball.classList.remove('spin'); ball.classList.remove('up');
  await new Promise(r => setTimeout(r, UP_MS));
  busy = false; live.textContent = 'Updated';
  pendingRoll = () => { const ms = roll($('hmPnlBig'), before); if(hold) setTimeout(() => { celeb.busy = false; celeb.next(); }, ms + 400); };
  v = 0; springHome(11, true);
  // then the wallet check in the background; if it brings new trades the balance glides again
  if(typeof syncNow === 'function' && typeof connectedAccounts !== 'undefined' && connectedAccounts.length){
    Promise.resolve(syncNow(false)).then(() => { const e2 = $('hmPnlBig'); if(e2 && e2._to == null && !pendingRoll) { const was = e2._shown; if(was && e2.textContent !== was) roll(e2, was); } }).catch(() => {});
  }
}

/* ---------- the balance glides to its value: one eased count, every digit moving together ---------- */
function parseUsd(t){ const v = parseFloat(String(t || '').replace(/[^0-9.]/g, '')); return Number.isFinite(v) ? (/^\s*[-−]/.test(t) ? -v : v) : NaN; }
function stop(el){ if(el && el._to != null){ if(el.textContent === el._last) el.textContent = el._to; el._to = null; el._tw = 0; } }
function roll(el, from){
  if(!el || el.hidden) return 0;
  const to = el.textContent, a = parseUsd(from), b = parseUsd(to), DUR = 750;
  el._shown = to;
  if(!to) return 0;
  el.classList.remove('ptr-soft'); void el.offsetWidth; el.classList.add('ptr-soft');
  setTimeout(() => el.classList.remove('ptr-soft'), DUR + 50);
  if(reduce() || !Number.isFinite(a) || !Number.isFinite(b) || Math.abs(a - b) < .005) return DUR;
  const minus = (to.match(/[-−]/) || String(from).match(/[-−]/) || ['-'])[0], plus = /\+/.test(to + from) ? '+' : '';
  const fmt = v => (v < 0 ? minus : plus) + '$' + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  stop(el);
  const t0 = performance.now(), id = (roll.n = (roll.n || 0) + 1);
  el._tw = id; el._to = to; el._last = el.textContent = fmt(a);
  (function step(now){
    if(el._tw !== id) return;
    if(el.textContent !== el._last){ el._to = null; return; }
    const p = Math.min(1, (now - t0) / DUR), e = p >= 1 ? 1 : 1 - Math.pow(2, -10 * p);  // exponential ease-out
    el._last = el.textContent = p < 1 ? fmt(a + (b - a) * e) : to;
    if(p < 1) requestAnimationFrame(step); else el._to = null;
  })(t0);
  return DUR;
}

if(standalone) document.documentElement.classList.add('dc-standalone');
window.dcPtr = { run: () => run(false), standalone };
})();
