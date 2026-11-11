/* ============================================================================
   DEGENCARDS — pull to refresh on Home (installed web app only)
   Pull the page down from the top: a glass dial fills under the header, release past the line and the data
   refreshes in place (wallet sync + trades from the database, no page reload), then the balance rolls to its
   new value digit by digit, like a slot machine, with the change floating up next to it.
   Only in the home-screen web app (display-mode: standalone): a browser tab keeps its own pull / reload.
   window.dcPtr.run() starts a refresh by hand (tests).
   ============================================================================ */
(function(){
const standalone = (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
const reduce = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
const $ = id => document.getElementById(id);
const home = $('homeView'), app = $('app'); if(!home || !app) return;
const PULL = 74, MAX = 130;              // release line and the furthest the page follows the finger (px)
let busy = false;

/* ---------- the dial under the header ---------- */
const dial = document.createElement('div');
dial.className = 'ptr'; dial.setAttribute('aria-hidden', 'true');
dial.innerHTML = '<svg viewBox="0 0 40 40"><circle class="ptr-track" cx="20" cy="20" r="15"/><circle class="ptr-fill" cx="20" cy="20" r="15" pathLength="100"/></svg><i class="ptr-arrow"></i>';
app.appendChild(dial);
const live = document.createElement('div');
live.className = 'sr-only'; live.setAttribute('role', 'status'); live.setAttribute('aria-live', 'polite');
app.appendChild(live);

function homeOpen(){ return home.style.display !== 'none' && app.dataset.theme === 'blue' && !app.hidden; }
function atTop(){ return (document.body.scrollTop || 0) <= 0 && (document.documentElement.scrollTop || 0) <= 0 && (window.scrollY || 0) <= 0; }
function headerBottom(){ const h = document.querySelector('#app > header'); return h ? Math.max(0, h.getBoundingClientRect().bottom) : 0; }
function setPull(px, release){
  const k = Math.min(1, px / PULL);
  home.style.transform = px ? `translate3d(0,${px}px,0)` : '';
  dial.style.setProperty('--k', k.toFixed(3));
  dial.style.transform = `translate3d(-50%, ${(Math.min(px, MAX) * .62 - 52).toFixed(1)}px, 0) scale(${(.6 + k * .4).toFixed(3)})`;
  dial.classList.toggle('ready', !!release);
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
  dial.style.top = headerBottom() + 'px'; dial.classList.add('on'); home.classList.add('ptr-drag'); dial.classList.remove('spin', 'done');
}, { passive: true });
document.addEventListener('touchmove', e => {
  if(!track) return;
  const t = e.touches[0], ry = t.clientY - y0, rx = t.clientX - x0;
  if(!lock){ if(Math.abs(ry) < 6 && Math.abs(rx) < 6) return; lock = Math.abs(ry) > Math.abs(rx) && ry > 0 ? 'y' : 'x'; }
  if(lock !== 'y' || ry <= 0 || !atTop()){ if(dy) end(false); track = false; return; }
  e.preventDefault();                                                    // the page follows the finger instead of the native bounce
  dy = Math.min(MAX, ry * .55 / (1 + ry / 900));                         // rubber band: harder the further you go
  setPull(dy, dy >= PULL);
}, { passive: false });
document.addEventListener('touchend', () => { if(track){ track = false; end(dy >= PULL); } }, { passive: true });
document.addEventListener('touchcancel', () => { if(track){ track = false; end(false); } }, { passive: true });

function end(go){
  home.classList.remove('ptr-drag');
  if(!go){ setPull(0); dial.classList.remove('on', 'ready'); dy = 0; return; }
  run(true);
}

/* ---------- refresh: data only, never the page ---------- */
async function run(fromPull){
  if(busy || typeof reload !== 'function') return;
  busy = true;
  const big = $('hmPnlBig'), before = big ? big.textContent : '', beforeV = parseUsd(before);
  if(!fromPull){ dial.style.top = headerBottom() + 'px'; dial.classList.add('on'); }
  home.style.transform = `translate3d(0,${Math.round(PULL * .78)}px,0)`;           // the page rests open while it loads
  dial.style.setProperty('--k', '1'); dial.style.transform = 'translate3d(-50%, -6px, 0) scale(1)';
  dial.classList.remove('ready'); dial.classList.add('spin');
  if(big) big.classList.add('ptr-loading');
  live.textContent = 'Refreshing';
  const hold = typeof celeb !== 'undefined' && !celeb.busy; if(hold) celeb.busy = true;     // a card drop waits until the balance has landed
  const t0 = performance.now();
  try{
    if(typeof syncNow === 'function' && typeof connectedAccounts !== 'undefined' && connectedAccounts.length) await syncNow(false);
    await reload();
  }catch(e){ if(typeof showToast === 'function') showToast("Couldn't refresh — check your connection"); }
  const wait = 900 - (performance.now() - t0); if(wait > 0) await new Promise(r => setTimeout(r, wait));   // long enough to read as a refresh
  if(big) big.classList.remove('ptr-loading');
  dial.classList.remove('spin'); dial.classList.add('done');
  setTimeout(() => { setPull(0); dial.classList.remove('on', 'done'); }, 260);
  const now = $('hmPnlBig');
  let ms = 0; if(now && !now.hidden){ bump(now, parseUsd(now.textContent) - beforeV); ms = roll(now, before); }
  if(hold) setTimeout(() => { celeb.busy = false; celeb.next(); }, ms + 900);
  live.textContent = now ? 'Balance updated: ' + now.textContent : 'Updated';
  busy = false;
}

/* ---------- the balance rolls to its value, digit by digit ---------- */
function parseUsd(s){ const m = String(s || '').replace(/[^0-9.\-+]/g, ''); const v = parseFloat(m); return Number.isFinite(v) ? (s.trim().startsWith('-') || s.includes('−') ? -Math.abs(v) : v) : NaN; }
function roll(el, from){
  const to = el.textContent; if(!to || reduce()){ el.classList.add('ptr-fade'); setTimeout(() => el.classList.remove('ptr-fade'), 500); return 500; }
  const fromD = String(from || '').replace(/\D/g, ''), toD = to.replace(/\D/g, '');
  let di = 0, n = 0; const total = toD.length;
  const html = [...to].map(ch => {
    if(!/\d/.test(ch)) return `<span class="od-c">${ch === ' ' ? '&nbsp;' : ch.replace(/[&<>]/g, '')}</span>`;
    const d = +ch, k = di++, back = total - k;                          // align old digits from the right
    const start = fromD.length >= back ? +fromD[fromD.length - back] : 0;
    const loops = 2 + Math.round(k * .6);
    const end = loops * 10 + d, steps = end - start;
    let col = ''; for(let i = start; i <= end; i++) col += `<i>${i % 10}</i>`;
    const dur = 900 + k * 110, delay = n++ * 25;
    return `<span class="od"><span class="od-r" style="--steps:${steps};--dur:${dur}ms;--delay:${delay}ms">${col}</span></span>`;
  }).join('');
  el.classList.add('od-on'); el.innerHTML = html; el.setAttribute('aria-label', to);
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('od-go')));
  const longest = 900 + Math.max(0, total - 1) * 110 + total * 25 + 120;
  setTimeout(() => {
    if(!el.classList.contains('od-on')) return;
    el.classList.remove('od-on', 'od-go'); el.removeAttribute('aria-label'); el.textContent = to;
    el.classList.add('ptr-glow'); setTimeout(() => el.classList.remove('ptr-glow'), 900);
  }, longest);
  return longest;
}
function bump(el, delta){
  if(!Number.isFinite(delta) || Math.abs(delta) < .005) return;
  const old = el.parentNode.querySelector('.ptr-delta'); if(old) old.remove();
  const c = document.createElement('span');
  c.className = 'ptr-delta ' + (delta > 0 ? 'pos' : 'neg');
  c.textContent = (delta > 0 ? '+' : '−') + '$' + Math.abs(delta).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  el.insertAdjacentElement('afterend', c);
  const r = document.createRange(); r.selectNodeContents(el);                    // sits just right of the figure, on its first line
  const box = el.offsetParent ? el.offsetParent.getBoundingClientRect() : { left: 0, top: 0, width: innerWidth };
  const tr = r.getClientRects()[0] || el.getBoundingClientRect(), w = c.offsetWidth;
  const left = Math.min(tr.right - box.left + 12, box.width - w - 14);
  const fits = tr.right - box.left + 12 + w <= box.width - 14;
  c.style.left = Math.max(14, fits ? left : tr.right - box.left - w) + 'px'; c.style.top = (tr.top - box.top + (fits ? 8 : -30)) + 'px';
  setTimeout(() => c.remove(), 3200);
}

if(standalone) document.documentElement.classList.add('dc-standalone');
window.dcPtr = { run: () => run(false), standalone };
})();
