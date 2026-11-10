/* ============================================================================
   DEGENCARDS — design panel for the liquid theme of Home and Journal
   Colour (8 presets + any hue), moving backdrop (Flow / Calm / Still), glass (Clear / Frosted / Deep).
   Saved on the device (localStorage dc_design); applied as CSS variables / data attributes on #app.
   ============================================================================ */
(function(){
const app = document.getElementById('app'); if(!app) return;
const KEY = 'dc_design', DEF = { h: 232, s: 1, motion: 'flow', glass: 'frosted' };
const PRESETS = [['Ocean', 232, 1], ['Violet', 264, 1], ['Rose', 322, 1], ['Ember', 12, 1], ['Amber', 36, 1], ['Emerald', 160, .8], ['Cyan', 194, 1], ['Graphite', 232, .1]];
const MOTION = [['flow', 'Flow'], ['calm', 'Calm'], ['still', 'Still']], GLASS = [['clear', 'Clear'], ['frosted', 'Frosted'], ['deep', 'Deep']];
function load(){
  let o = {}; try{ o = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; }catch(e){}
  const h = Number(o.h), s = Number(o.s);
  return { h: Number.isFinite(h) && h >= 0 && h <= 360 ? Math.round(h) : DEF.h, s: Number.isFinite(s) && s >= 0 && s <= 1 ? s : DEF.s,
    motion: MOTION.some(m => m[0] === o.motion) ? o.motion : DEF.motion, glass: GLASS.some(g => g[0] === o.glass) ? o.glass : DEF.glass };
}
let st = load(), panel = null, opener = null;
function apply(){
  app.style.setProperty('--lq-h', String(st.h)); app.style.setProperty('--lq-s', String(st.s));
  app.dataset.lqMotion = st.motion; app.dataset.lqGlass = st.glass;
}
function save(){ try{ localStorage.setItem(KEY, JSON.stringify(st)); }catch(e){} }
function sync(){
  if(!panel) return;
  panel.querySelectorAll('[data-lq-h]').forEach(b => b.setAttribute('aria-checked', String(+b.dataset.lqH === st.h && +b.dataset.lqS === st.s)));
  panel.querySelectorAll('[data-lq-m]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.lqM === st.motion)));
  panel.querySelectorAll('[data-lq-g]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.lqG === st.glass)));
  const r = panel.querySelector('.lq-hue'); if(r && document.activeElement !== r) r.value = String(st.h);
}
function set(patch){ st = Object.assign({}, st, patch); apply(); save(); sync(); }
function build(){
  panel = document.createElement('div'); panel.className = 'lq-panel'; panel.id = 'lqPanel';
  panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'Design');
  const seg = (list, attr, label) => `<div class="lq-seg" role="radiogroup" aria-label="${label}">${list.map(([k, lb]) => `<button type="button" role="radio" data-lq-${attr}="${k}">${lb}</button>`).join('')}</div>`;
  panel.innerHTML = `<div class="lq-panel-h"><b>Design</b><button type="button" class="lq-x" data-lq-close aria-label="Close">×</button></div>
    <div class="lq-sec"><span>Colour</span>
      <div class="lq-sw" role="radiogroup" aria-label="Colour">${PRESETS.map(([n, h, s]) => `<button type="button" role="radio" data-lq-h="${h}" data-lq-s="${s}" style="--sh:${h};--ss:${s}"><i aria-hidden="true"></i>${n}</button>`).join('')}</div>
      <input class="lq-hue" type="range" min="0" max="360" step="1" aria-label="Custom colour"></div>
    <div class="lq-sec"><span>Background</span>${seg(MOTION, 'm', 'Background motion')}</div>
    <div class="lq-sec"><span>Glass</span>${seg(GLASS, 'g', 'Glass')}</div>
    <button type="button" class="lq-reset" data-lq-reset>RESET TO DEFAULT</button>
    <p class="lq-note">Home and Journal · saved on this device</p>`;
  app.appendChild(panel);
  panel.addEventListener('click', e => {
    const b = e.target.closest('button'); if(!b) return;
    if(b.dataset.lqH != null) set({ h: +b.dataset.lqH, s: +b.dataset.lqS });
    else if(b.dataset.lqM) set({ motion: b.dataset.lqM });
    else if(b.dataset.lqG) set({ glass: b.dataset.lqG });
    else if('lqReset' in b.dataset) set(DEF);
    else if('lqClose' in b.dataset) close(true);
  });
  panel.querySelector('.lq-hue').addEventListener('input', e => set({ h: Math.round(+e.target.value), s: 1 }));
}
function open(from){
  if(!panel) build();
  opener = from || null; sync(); panel.classList.add('show');
  document.querySelectorAll('[data-lq-open]').forEach(b => b.setAttribute('aria-expanded', 'true'));
  const x = panel.querySelector('.lq-x'); if(x) x.focus({ preventScroll: true });
}
function close(refocus){
  if(!panel || !panel.classList.contains('show')) return;
  panel.classList.remove('show');
  document.querySelectorAll('[data-lq-open]').forEach(b => b.setAttribute('aria-expanded', 'false'));
  if(refocus && opener && document.contains(opener)) opener.focus({ preventScroll: true });
}
document.addEventListener('click', e => {
  const b = e.target.closest && e.target.closest('[data-lq-open]');
  if(b){ panel && panel.classList.contains('show') ? close(false) : open(b); return; }
  if(panel && panel.classList.contains('show') && !e.target.closest('#lqPanel')) close(false);        // a tap outside closes
});
document.addEventListener('keydown', e => { if(e.key === 'Escape' && panel && panel.classList.contains('show')){ e.stopPropagation(); close(true); } });
// leaving Home / Journal closes the panel
new MutationObserver(() => { if(app.dataset.theme !== 'blue') close(false); }).observe(app, { attributes: true, attributeFilter: ['data-theme'] });
apply();
window.dcDesign = { get: () => Object.assign({}, st), set };
})();
