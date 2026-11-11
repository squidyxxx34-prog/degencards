/* ============================================================================
   DEGENCARDS — pull to refresh on Home (installed web app only)
   Pull Home down from the top: the standard iOS activity spinner appears in the gap, spoke by spoke; release
   past the line and the data refreshes in place (no page reload). The trades are read from the database first
   and shown at once; the wallet sync runs after, in the background. The balance then rolls to its value.
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
const spokes = [...dial.children];
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
function setPull(px){
  place(px);
  const k = Math.min(1, px / PULL) * N;
  spokes.forEach((s, i) => { s.style.opacity = k > i + .5 ? String(1 - i * .09) : '0'; });   // spokes come in one by one, like iOS
}
function hide(){ place(0); dial.classList.remove('on', 'spin', 'drag'); spokes.forEach(s => { s.style.opacity = ''; }); }

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
  const big = $('hmPnlBig'); settle(big);
  const before = big ? big.textContent : '';
  dial.style.top = headerBottom() + 'px'; dial.classList.add('on', 'spin'); spokes.forEach(s => { s.style.opacity = ''; });
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
    const el = $('hmPnlBig'), shown = el ? (el.getAttribute('aria-label') || el.textContent) : '';
    Promise.resolve(syncNow(false)).then(() => { const e2 = $('hmPnlBig'); if(e2 && !e2.classList.contains('od-on') && e2.textContent !== shown) roll(e2, shown); }).catch(() => {});
  }
}

/* ---------- the balance rolls to its value, digit by digit ---------- */
function settle(el){                                                     // end a roll in progress: the element holds plain text again
  if(!el || !el.classList.contains('od-on')) return;
  const to = el.getAttribute('aria-label') || '';
  el.classList.remove('od-on', 'od-go'); el.removeAttribute('aria-label'); el.textContent = to;
}
function roll(el, from){
  if(!el || el.hidden) return 0;
  settle(el);
  const to = el.textContent; if(!to) return 0;
  if(reduce()){ el.classList.add('ptr-fade'); setTimeout(() => el.classList.remove('ptr-fade'), 400); return 400; }
  const fromD = String(from || '').replace(/\D/g, ''), toD = to.replace(/\D/g, ''), total = toD.length;
  let k = 0;
  el.innerHTML = [...to].map(ch => {
    if(!/\d/.test(ch)) return `<span class="od-c">${ch.replace(/[&<>]/g, '')}</span>`;
    const d = +ch, back = total - k, start = fromD.length >= back ? +fromD[fromD.length - back] : 0;   // old digits aligned from the right
    const end = 10 + d, dur = 420 + k * 45; k++;
    let col = ''; for(let i = start; i <= end; i++) col += `<i>${i % 10}</i>`;
    return `<span class="od"><span class="od-r" style="--steps:${end - start};--dur:${dur}ms">${col}</span></span>`;
  }).join('');
  el.classList.add('od-on'); el.setAttribute('aria-label', to);
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('od-go')));
  const longest = 420 + total * 45 + 80;
  setTimeout(() => { if(el.getAttribute('aria-label') === to) settle(el); else el.removeAttribute('aria-label'); }, longest);
  return longest;
}

if(standalone) document.documentElement.classList.add('dc-standalone');
window.dcPtr = { run, standalone };
})();
