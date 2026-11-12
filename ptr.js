/* ============================================================================
   DEGENCARDS — pull to refresh on Home (installed web app only), after takuoka/PullToBounce (MIT)
   https://github.com/takuoka/PullToBounce — same phases and values, ported from Swift to the web:
   1. Pull: Home slides down (it stays visible: the balance is always readable); a thin light bar rides on top of it.
   2. Past the pull distance (96 px) the bar bends (upwards, away from the info) like a membrane, up to 40 px. Bar and ball
      always follow the content and the bar never touches it (16 px gap).
   3. At pull + bend (136 px) the refresh starts (the page keeps following the finger, softer, never locked): the edge is let go and wobbles back (damped keyframes 1, -.7, .4, -.3, .15, 0
      over 0.8 s, ease-in); 0.2 s later a ball rises out of the surface (0.25 s, overshoot curve .49,.13,.29,1.61)
      and a ring draws itself around it while turning (1 s per turn, stroke drawn then erased, 0.8 s each, ease-out).
   4. Data in: the balance rolls to its new value digit by digit right away; then the ring goes, the ball sinks back
      (0.25 s) and the page comes back up.
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
const sheet = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); sheet.setAttribute('class', 'ptb-sheet'); sheet.setAttribute('aria-hidden', 'true');
const edgePath = document.createElementNS('http://www.w3.org/2000/svg', 'path'); sheet.appendChild(edgePath);   // only the edge is drawn: nothing tints the page behind
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
let x = 0, bend = 0, hb = 0, co = 0, wobble = null;
const GAP = 16;                                  // bar-to-info distance
function measure(){ hb = headerBottom(); const k = home.querySelector('.hm-kicker, .hm-head, h1') || home.firstElementChild; co = k ? Math.max(0, k.getBoundingClientRect().top - home.getBoundingClientRect().top) : 0; }
function draw(){
  home.style.transform = x > .05 ? `translate3d(0,${x.toFixed(2)}px,0)` : '';
  const on = x > .05 || busy;
  app.classList.toggle('ptb-on', on);
  if(!on){ sheet.style.display = 'none'; return; }
  const w = innerWidth, edge = hb + x + co - GAP;                        // the bar rides with the content, always GAP px above the first line of info
  const raw = wobble ? wobble.b : -bend, b = Math.max(-BEND, Math.min(GAP - 6, raw));   // it bends up, away from the info; any dip stays inside the gap
  sheet.style.opacity = Math.max(0, Math.min(1, (x + co - GAP - 4) / 24)).toFixed(3);   // only once there is room for it under the header
  sheet.style.display = 'block'; sheet.setAttribute('viewBox', `0 0 ${w} ${LIP * 3}`); sheet.style.width = w + 'px'; sheet.style.height = (LIP * 3) + 'px';
  sheet.style.transform = `translate3d(0,${(edge - LIP).toFixed(2)}px,0)`;
  edgePath.setAttribute('d', `M0 ${LIP} Q${w / 2} ${(LIP + b * 2).toFixed(2)} ${w} ${LIP}`);   // quad control at 2b: the edge dips by b
  ball.style.top = edge + 'px';                                         // the ball rides with the bar (it rises 66 px above it)
}
function setBend(px){ x = px; bend = busy ? 0 : Math.max(0, Math.min(BEND, px - PULL)); draw(); }

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
function springHome(omega, keepFlat){ springTo(0, omega, keepFlat); }
function springTo(goal, omega, keepFlat){
  flat = !!keepFlat || busy;
  cancelAnimationFrame(raf); last = performance.now();
  raf = requestAnimationFrame(function tick(now){
    const dt = Math.min(.034, (now - last) / 1000); last = now;
    for(let i = 0; i < 4; i++){ const h = dt / 4, a = -omega * omega * (x - goal) - 2 * omega * v; v += a * h; x += v * h; }
    if(Math.abs(x - goal) < .15 && Math.abs(v) < 4){ x = goal; v = 0; raf = 0; }
    bend = flat ? 0 : Math.max(0, Math.min(BEND, x - PULL)); draw();       // while / after a refresh the edge stays flat (only the wobble moves it)
    if(raf) raf = requestAnimationFrame(tick); else if(goal === 0) done();
  });
}
function done(){ if(busy) return; app.classList.remove('ptb-on'); sheet.style.display = 'none'; home.style.transform = ''; }

/* ---------- gesture ---------- */
let y0 = 0, x0 = 0, xStart = 0, track = false, lock = '', dragging = false, lastX = 0, lastT = 0;
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
  if(!lock){
    if(Math.abs(ry) < 6 && Math.abs(rx) < 6) return;
    lock = Math.abs(ry) > Math.abs(rx) && ry > 0 ? 'y' : 'x';
    if(lock === 'y'){ y0 = t.clientY; xStart = x; dragging = true; cancelAnimationFrame(raf); raf = 0; if(!busy) measure(); lastT = 0; }
  }
  if(lock !== 'y' || !atTop()){ track = false; release(); return; }
  e.preventDefault();
  const raw = xStart + Math.max(0, t.clientY - y0) * .62;                 // scroll-view-like resistance
  const px = raw <= STOP ? raw : STOP + 150 * (1 - Math.exp(-(raw - STOP) / 260));   // past the line it keeps following, softer and softer: never a wall
  const now = performance.now(); if(lastT) v = (px - lastX) / Math.max(.008, (now - lastT) / 1000); lastX = px; lastT = now;
  if(busy){ x = px; draw(); return; }                                     // refreshing: the page still follows the finger
  setBend(px);
  if(px >= STOP) run(true);                                               // reached pull + bend: refresh, finger still free
}, { passive: false });
document.addEventListener('touchend', () => { if(track){ track = false; release(); } }, { passive: true });
document.addEventListener('touchcancel', () => { if(track){ track = false; release(); } }, { passive: true });
function release(){ if(!dragging) return; dragging = false; if(v < 0) v *= .5; if(busy) springTo(STOP, 13); else springHome(12); }

/* ---------- refresh: data only, never the page ---------- */
async function run(fromPull){
  if(busy || typeof reload !== 'function') return;
  busy = true;
  const big = $('hmPnlBig'), before = big ? big.textContent : '';
  stop(big);
  measure();
  if(!fromPull){ x = STOP; bend = BEND; } draw();
  live.textContent = 'Refreshing';
  const hold = typeof celeb !== 'undefined' && !celeb.busy; if(hold) celeb.busy = true;     // a card drop waits until the balance has landed
  const t0 = performance.now();
  wobbleFrom(-BEND);                                                      // the bar is let go (it was bent up) and wobbles back
  setTimeout(() => { if(busy) ball.classList.add('up'); }, 200);          // 0.2 s later the ball rises out of the surface
  setTimeout(() => { if(busy) ball.classList.add('spin'); }, 200 + UP_MS); // then the ring
  try{ await reload(); }
  catch(e){ if(typeof showToast === 'function') showToast("Couldn't refresh — check your connection"); }
  const ms = roll($('hmPnlBig'), before);                                 // visible the whole time: the balance rolls as soon as the data is in
  await new Promise(r => setTimeout(r, Math.max(0, MIN_MS - (performance.now() - t0))));
  // ending: ring off, ball sinks back, then the page comes up and fades in
  ball.classList.remove('spin'); ball.classList.remove('up');
  await new Promise(r => setTimeout(r, UP_MS));
  busy = false; live.textContent = 'Updated';
  if(hold) setTimeout(() => { celeb.busy = false; celeb.next(); }, Math.max(0, ms - (performance.now() - t0)) + 600);
  if(!dragging){ v = 0; springHome(11, true); }                            // finger still down: the page goes home on release
  // then the wallet check in the background; if it brings new trades the balance glides again
  if(typeof syncNow === 'function' && typeof connectedAccounts !== 'undefined' && connectedAccounts.length){
    Promise.resolve(syncNow(false)).then(() => { const e2 = $('hmPnlBig'); if(e2 && e2._to == null) { const was = e2._shown; if(was && e2.textContent !== was) roll(e2, was); } }).catch(() => {});
  }
}

/* ---------- the balance rolls to its value digit by digit (each column spins, all together, exponential ease-out) ---------- */
function stop(el){                                                       // finish a roll in progress: plain text again
  if(!el || el._to == null) return;
  el.classList.remove('od-on', 'od-go'); el.textContent = el._to; el.removeAttribute('aria-label'); el._to = null; clearTimeout(el._odT);
}
function roll(el, from){
  if(!el || el.hidden) return 0;
  stop(el);
  const to = el.textContent; el._shown = to;
  if(!to) return 0;
  if(reduce()){ el.classList.remove('ptr-soft'); void el.offsetWidth; el.classList.add('ptr-soft'); return 400; }
  const fromD = String(from || '').replace(/\D/g, ''), toD = to.replace(/\D/g, ''), total = toD.length;
  let k = 0;
  el.innerHTML = [...to].map(ch => {
    if(!/\d/.test(ch)) return `<span class="od-c">${ch.replace(/[&<>]/g, '')}</span>`;
    const d = +ch, back = total - k, start = fromD.length >= back ? +fromD[fromD.length - back] : 0;   // old digits aligned from the right
    const end = 10 + d, dur = 900 + (total - 1 - k) * 70; k++;                                          // the cents spin a little longer than the dollars
    let col = ''; for(let i = start; i <= end; i++) col += `<i>${i % 10}</i>`;
    return `<span class="od"><span class="od-r" style="--steps:${end - start};--dur:${dur}ms">${col}</span></span>`;
  }).join('');
  el._to = to; el.setAttribute('aria-label', to); el.classList.add('od-on');
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('od-go')));
  const longest = 900 + Math.max(0, total - 1) * 70 + 60;
  el._odT = setTimeout(() => stop(el), longest);
  return longest;
}

if(standalone) document.documentElement.classList.add('dc-standalone');
window.dcPtr = { run: () => run(false), standalone };
})();
