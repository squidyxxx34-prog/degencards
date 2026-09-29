/* ============================================================================
   DEGENCARDS — getting-started guide
   Accessible coach marks: real dialog (role/aria), focus trap, keyboard
   (Esc = skip, ← / → = back / next), screen-reader announcements, the rest of
   the page made inert, respects reduced motion, bottom sheet on phones.
   Skip is available on every step. Replay: Account > Getting started, or the
   "?" button in the header.
   ============================================================================ */
(function(){
const STEPS = [
  { view:'home', target:null, title:'Welcome to DEGENCARDS',
    body:'Every trade you close becomes a collectible card, with its real chart, a rarity and a grade. This tour takes about a minute. You can skip it at any time.' },
  { view:'account', target:'#providerList', title:'Connect your trading wallet',
    body:'Tap CONNECT next to Pump.fun, Fomo or another Solana wallet, then paste its public address. Never your seed phrase or private key. Your trades then import by themselves, every 10 minutes.',
    extra:'Pump.fun: your profile, copy the address. Fomo: Wallet, Deposit, copy the Solana address.' },
  { view:'home', target:'#homeGrid .card', fallback:'#homeGrid', title:'Your cards',
    body:'Each card shows the coin, your profit or loss, and the real price candles. The green B is when you bought, the red S when you sold. Rarity goes from common to mythic, grade from D to S.' },
  { view:'home', target:'#homeGrid .card', fallback:'#homeGrid', title:'Open a card, share it',
    body:'Tap a card to see its details: entry and exit market cap, hold time, fees and your real net profit. SHARE CARD turns it into a post or story, as an image or a short video.' },
  { view:'home', target:'#btnNew', title:'Add a trade by hand',
    body:'No wallet to connect? Use + NEW TRADE to log a trade yourself.' },
  { view:'home', target:'#levelBar', title:'Level up',
    body:'Your trades earn XP: quality, grades, badges, trading days and win streaks count. Tap the bar to see where your XP comes from.' },
  { view:'history', target:'#historyView table', fallback:'#historyView', title:'History',
    body:'All your trades in one table. SELECT lets you delete several, CLEAR HISTORY wipes everything. Nothing is lost for 30 days: Account, Recover trades.' },
  { view:'achievements', target:'#achSummary', title:'Achievements',
    body:'Badges from bronze to legend. Locked ones show how close you are. Tap a badge to see the cards that earned it.' },
  { view:'stats', target:'#statsView .goal-card', title:'Stats and monthly goal',
    body:'Win rate, total profit, best trade… and a monthly profit goal you can set.' },
  { view:'home', target:null, title:"You're all set",
    body:'You can replay this guide anytime with the ? button at the top, or from Account.', last:true },
];
const KEY = () => 'dc_guide_done_' + (window.__dcUserId || 'anon');
const reduce = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
let i = 0, open = false, lastFocus = null, ui = null;

function build(){
  if(ui) return ui;
  const root = document.createElement('div');
  root.id = 'guide'; root.hidden = true;
  root.innerHTML = `
    <div class="guide-scrim" aria-hidden="true"></div>
    <div class="guide-hole" aria-hidden="true"></div>
    <div class="guide-panel" role="dialog" aria-modal="true" aria-labelledby="guideTitle" aria-describedby="guideBody">
      <div class="guide-top">
        <span class="guide-step" id="guideStep"></span>
        <button type="button" class="guide-skip" id="guideSkip">Skip guide</button>
      </div>
      <div class="guide-progress" aria-hidden="true"><i id="guideBar"></i></div>
      <h2 class="guide-title" id="guideTitle" tabindex="-1"></h2>
      <p class="guide-body" id="guideBody"></p>
      <p class="guide-extra" id="guideExtra"></p>
      <div class="guide-actions">
        <button type="button" class="guide-btn ghost" id="guideBack">Back</button>
        <button type="button" class="guide-btn primary" id="guideNext">Next</button>
      </div>
      <button type="button" class="guide-btn link" id="guideCta" hidden>Connect my wallet now</button>
      <p class="guide-keys" aria-hidden="true">Esc to skip · ← → to move</p>
    </div>
    <div class="sr-only" aria-live="polite" id="guideLive"></div>`;
  document.body.appendChild(root);
  ui = {
    root, hole: root.querySelector('.guide-hole'), panel: root.querySelector('.guide-panel'),
    step: root.querySelector('#guideStep'), bar: root.querySelector('#guideBar'), title: root.querySelector('#guideTitle'),
    body: root.querySelector('#guideBody'), extra: root.querySelector('#guideExtra'),
    back: root.querySelector('#guideBack'), next: root.querySelector('#guideNext'), skip: root.querySelector('#guideSkip'),
    cta: root.querySelector('#guideCta'), live: root.querySelector('#guideLive'),
  };
  ui.next.addEventListener('click', () => go(i + 1));
  ui.back.addEventListener('click', () => go(i - 1));
  ui.skip.addEventListener('click', () => finish(true));
  ui.cta.addEventListener('click', () => { finish(false); try{ goToView('account'); document.getElementById('providerList')?.scrollIntoView({ block:'center' }); }catch(e){} });
  root.querySelector('.guide-scrim').addEventListener('click', () => ui.next.focus());
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('resize', place); document.addEventListener('scroll', place, { passive:true, capture:true });
  return ui;
}
function onKey(e){
  if(!open) return;
  if(e.key === 'Escape'){ e.preventDefault(); finish(true); return; }
  if(e.key === 'ArrowRight' && !isField(e.target)){ e.preventDefault(); go(i + 1); return; }
  if(e.key === 'ArrowLeft' && !isField(e.target)){ e.preventDefault(); go(i - 1); return; }
  if(e.key === 'Tab'){                                             // focus trap inside the dialog
    const f = [...ui.panel.querySelectorAll('button:not([hidden]):not([disabled]), [tabindex="0"]')].filter(el => el.offsetParent !== null);
    if(!f.length) return;
    const first = f[0], lastEl = f[f.length-1];
    if(e.shiftKey && (document.activeElement === first || document.activeElement === ui.title)){ e.preventDefault(); lastEl.focus(); }
    else if(!e.shiftKey && document.activeElement === lastEl){ e.preventDefault(); first.focus(); }
  }
}
const isField = el => el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');
function setInert(on){
  ['app','btnNew'].forEach(id => { const el = document.getElementById(id); if(!el) return; if(on){ el.setAttribute('inert',''); el.setAttribute('aria-hidden','true'); } else { el.removeAttribute('inert'); el.removeAttribute('aria-hidden'); } });
  document.querySelector('header')?.toggleAttribute('inert', on);
}
function targetEl(s){
  const pick = sel => { const el = sel && document.querySelector(sel); if(!el) return null; const r = el.getBoundingClientRect(); return (r.width > 0 && r.height > 0) ? el : null; };
  return pick(s.target) || pick(s.fallback);
}
function go(n){
  if(n < 0) return;
  if(n >= STEPS.length){ finish(false); return; }
  i = n; const s = STEPS[i];
  try{ if(s.view && typeof goToView === 'function') goToView(s.view); }catch(e){}
  ui.step.textContent = `Step ${i + 1} of ${STEPS.length}`;
  ui.bar.style.width = `${((i + 1) / STEPS.length) * 100}%`;
  ui.title.textContent = s.title;
  ui.body.textContent = s.body;
  ui.extra.textContent = s.extra || ''; ui.extra.hidden = !s.extra;
  ui.back.disabled = i === 0; ui.back.style.visibility = i === 0 ? 'hidden' : 'visible';
  ui.next.textContent = s.last ? "Let's go" : (i === 0 ? 'Start the tour' : 'Next');
  ui.cta.hidden = !(s.last || i === 1);
  ui.cta.textContent = i === 1 ? 'Connect my wallet now' : 'Connect my wallet';
  ui.skip.hidden = !!s.last;
  ui.live.textContent = `Step ${i + 1} of ${STEPS.length}. ${s.title}.`;
  const el = targetEl(s);
  ui.hole.style.display = 'none';
  requestAnimationFrame(() => {
    const el2 = targetEl(s);
    if(el2){
      const r = el2.getBoundingClientRect(), phone = innerWidth < 700;
      // phones: the guide is a bottom sheet, so bring the target into the top part of the screen
      const want = phone ? Math.max(12, innerHeight * 0.12) : Math.max(16, (innerHeight - r.height) / 2 - 80);
      const sc = scroller(el2); sc.scrollTop = Math.max(0, sc.scrollTop + r.top - want);
    } else { const sc = scroller(document.getElementById('app')); sc.scrollTop = 0; }
    requestAnimationFrame(() => { place(); setTimeout(place, 120); });
  });
  setTimeout(() => ui.title.focus({ preventScroll:true }), 30);
}
function scroller(el){                                           // the element that really scrolls (body here, window elsewhere)
  for(let n = el && el.parentElement; n; n = n.parentElement){
    const oy = getComputedStyle(n).overflowY;
    if((oy === 'auto' || oy === 'scroll') && n.scrollHeight > n.clientHeight + 1) return n;
  }
  return document.scrollingElement || document.documentElement;
}
function place(){
  if(!open) return;
  const s = STEPS[i], el = targetEl(s), vw = innerWidth, vh = innerHeight, phone = vw < 700;
  ui.root.classList.toggle('is-phone', phone);
  if(!el){ ui.hole.style.display = 'none'; ui.root.classList.add('no-target'); ui.panel.removeAttribute('style'); return; }
  ui.root.classList.remove('no-target');
  const r = el.getBoundingClientRect(), pad = 8;
  const top = Math.max(6, r.top - pad), left = Math.max(6, r.left - pad);
  const sheetTop = phone ? vh - (ui.panel.offsetHeight || vh * 0.45) - 8 : vh - 6;
  const w = Math.min(vw - left - 6, r.width + pad*2), h = Math.max(24, Math.min(sheetTop - top, r.height + pad*2));
  Object.assign(ui.hole.style, { display:'block', top: top+'px', left: left+'px', width: w+'px', height: h+'px' });
  if(phone){ ui.panel.removeAttribute('style'); return; }            // bottom sheet on phones (CSS)
  const pw = Math.min(420, vw - 32), ph = ui.panel.offsetHeight || 260;
  let py = r.bottom + 16; if(py + ph > vh - 16) py = r.top - ph - 16; if(py < 16) py = Math.max(16, vh - ph - 16);
  let px = Math.min(Math.max(16, r.left + r.width/2 - pw/2), vw - pw - 16);
  Object.assign(ui.panel.style, { top: py+'px', left: px+'px', width: pw+'px' });
}
function start(){
  build();
  if(open) return;
  open = true; lastFocus = document.activeElement;
  document.querySelectorAll('.overlay.show').forEach(o => o.classList.remove('show'));
  ui.root.hidden = false; ui.root.classList.toggle('reduce', reduce());
  setInert(true); document.documentElement.classList.add('guide-open');
  go(0);
}
function finish(skipped){
  if(!open) return;
  open = false;
  try{ localStorage.setItem(KEY(), skipped ? 'skipped' : 'done'); }catch(e){}
  ui.root.hidden = true; setInert(false); document.documentElement.classList.remove('guide-open');
  try{ if(typeof goToView === 'function' && STEPS[i].view !== 'home' && !skipped) goToView('home'); }catch(e){}
  if(skipped){ try{ goToView('home'); }catch(e){} }
  try{ showToast(skipped ? 'Guide skipped — replay it anytime with ?' : 'Enjoy DEGENCARDS'); }catch(e){}
  (document.getElementById('guideHelp') || lastFocus)?.focus?.();
}
let asked = false;
function maybeStart(userId){
  if(asked) return; asked = true;
  window.__dcUserId = userId || 'anon';
  let seen = null; try{ seen = localStorage.getItem(KEY()); }catch(e){}
  if(!seen) setTimeout(start, 900);
}
window.dcGuide = { start, maybeStart };
if(window.__dcGuideUser) maybeStart(window.__dcGuideUser);   // app was already shown before this file loaded
document.addEventListener('click', e => { if(e.target.closest('[data-guide-start]')){ e.preventDefault(); start(); } });
})();
