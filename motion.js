/* ============================================================================
   DEGENCARDS — Liquid motion
   - the current tab is a glass lens that slides and stretches between tabs
   - glass surfaces catch a soft light that follows the pointer; trade cards tilt toward it
   - a page that opens rises in, piece by piece (CSS: .lg-enter)
   Nothing runs with prefers-reduced-motion; pointer effects only on devices with a real hover.
   ============================================================================ */
(function(){
const still = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const hover = () => window.matchMedia('(hover: hover) and (pointer: fine)').matches;

/* ---------- sliding tab lens ---------- */
function navPill(){
  const nav = document.getElementById('nav'); if(!nav) return;
  const pill = document.createElement('span'); pill.className = 'nav-pill'; pill.setAttribute('aria-hidden', 'true');
  nav.prepend(pill); nav.classList.add('has-pill');
  let last = null;
  const place = (instant) => {
    const b = nav.querySelector('button.active');
    if(!b){ pill.style.opacity = '0'; return; }
    const x = b.offsetLeft, w = b.offsetWidth;
    if(instant || still()) pill.classList.add('no-anim');
    // liquid: stretch toward the new tab first, then settle
    if(last && !instant && !still() && Math.abs(last.x - x) > 4){
      const l = Math.min(last.x, x), r = Math.max(last.x + last.w, x + w);
      pill.style.transform = `translateX(${l}px)`; pill.style.width = (r - l) + 'px';
      clearTimeout(place.t); place.t = setTimeout(() => { pill.style.transform = `translateX(${x}px)`; pill.style.width = w + 'px'; }, 140);
    } else { pill.style.transform = `translateX(${x}px)`; pill.style.width = w + 'px'; }
    pill.style.height = b.offsetHeight + 'px'; pill.style.top = b.offsetTop + 'px'; pill.style.opacity = '1';
    last = { x, w };
    if(instant || still()) requestAnimationFrame(() => requestAnimationFrame(() => pill.classList.remove('no-anim')));
  };
  // the lens is a child of the rail: its own class changes must never re-run place() (with reduced motion that looped until the tab froze)
  new MutationObserver(ms => { if(ms.some(m => m.target !== pill)) place(false); }).observe(nav, { subtree: true, attributes: true, attributeFilter: ['class'] });
  window.addEventListener('resize', () => place(true));
  if(document.fonts && document.fonts.ready) document.fonts.ready.then(() => place(true));
  const app = document.getElementById('app');
  if(app) new MutationObserver(() => { if(!app.hidden) place(true); }).observe(app, { attributes: true, attributeFilter: ['hidden'] });
  place(true);
}

/* ---------- pages rise in when they open ---------- */
function viewEnter(){
  const views = ['home', 'collection', 'history', 'journal', 'achievements', 'stats', 'ranks', 'account'].map(v => document.getElementById(v + 'View')).filter(Boolean);
  const on = el => { if(still()) return; el.classList.remove('lg-enter'); void el.offsetWidth; el.classList.add('lg-enter'); clearTimeout(el._lgT); el._lgT = setTimeout(() => el.classList.remove('lg-enter'), 1400); };
  views.forEach(v => { let shown = v.style.display !== 'none';
    new MutationObserver(() => { const now = v.style.display !== 'none'; if(now && !shown) on(v); shown = now; }).observe(v, { attributes: true, attributeFilter: ['style'] }); });
  const app = document.getElementById('app');
  if(app) new MutationObserver(() => { if(!app.hidden){ const v = views.find(x => x.style.display !== 'none'); if(v) on(v); } }).observe(app, { attributes: true, attributeFilter: ['hidden'] });
}

/* ---------- light that follows the pointer, cards that tilt ---------- */
const GLASS = '.card,.hm-panel,.acc-block,.st-tile,.jr-kpi,.sg,.levelbar,.goal-card,.hm-sync,.aw-next,.jr-row,.authbox,#landing .lp-feat > div,#landing .lp-steps li,#landing figure';
function pointerLight(){
  let el = null, ev = null, raf = 0;
  const frame = () => { raf = 0; if(!el || !ev) return;
    const r = el.getBoundingClientRect(), x = (ev.clientX - r.left) / r.width, y = (ev.clientY - r.top) / r.height;
    el.style.setProperty('--mx', (x * 100).toFixed(1) + '%'); el.style.setProperty('--my', (y * 100).toFixed(1) + '%');
    if(el.classList.contains('card') && !el.closest('.demo-cardstack,.hm-best')){ el.style.setProperty('--ry', ((x - .5) * 10).toFixed(2) + 'deg'); el.style.setProperty('--rx', ((.5 - y) * 8).toFixed(2) + 'deg'); }
  };
  const leave = t => { if(!t) return; t.classList.remove('lg-lit'); t.style.removeProperty('--rx'); t.style.removeProperty('--ry'); };
  document.addEventListener('pointermove', e => {
    if(e.pointerType !== 'mouse' || still() || !hover()) return;
    const t = e.target.closest && e.target.closest(GLASS);
    if(t !== el){ leave(el); el = t; if(el) el.classList.add('lg-lit'); }
    ev = e; if(el && !raf) raf = requestAnimationFrame(frame);
  }, { passive: true });
  document.addEventListener('pointerleave', () => { leave(el); el = null; });
  window.addEventListener('blur', () => { leave(el); el = null; });
}

function init(){ navPill(); viewEnter(); pointerLight(); }
if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
