/* ============================================================================
   DEGENCARDS PRO studio - served ONLY by the `pro` edge function to a verified
   subscriber (one-time ticket). Never deploy this file as a static asset.
   Registers the PRO replay looks into replay.js and the full stats into the app.
   ============================================================================ */
(function(){
if(!window.dcReplay || !window.dcReplay.extend) return;
window.dcReplay.extend(A => {
  const X = A.EXT;
  Object.assign(X.themes, {
    purple: { name:'Purple', win:'#C09EFF', loss:'#FF5C9D', up:'#A87BFF', dn:'#FF4D8D' },
    gold:   { name:'Gold',   win:'#FFD35C', loss:'#FF6B5C', up:'#F5C542', dn:'#FF5A4E' },
    ice:    { name:'Ice',    win:'#6EC0FF', loss:'#FF6B8B', up:'#4FB0FF', dn:'#FF5C7A' },
    mono:   { name:'Mono',   win:'#FFFFFF', loss:'#9A9AA6', up:'#F2F2F2', dn:'#6B6B78' },
  });
  const base = (ctx, W, H, glow, strong) => {
    ctx.fillStyle = '#05070A'; ctx.fillRect(0,0,W,H);
    const g = ctx.createRadialGradient(W/2, H*0.42, 0, W/2, H*0.42, H*(strong ? 0.85 : 0.7));
    g.addColorStop(0, A.hexA(glow, strong ? 0.26 : 0.10)); g.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = g; ctx.fillRect(0,0,W,H);
  };
  Object.assign(X.bgs, {
    clean: (ctx, W, H, u, glow) => base(ctx, W, H, glow, false),
    glow:  (ctx, W, H, u, glow) => { base(ctx, W, H, glow, true);
      const g2 = ctx.createRadialGradient(W*0.1, H*0.9, 0, W*0.1, H*0.9, H*0.6); g2.addColorStop(0, 'rgba(192,158,255,0.16)'); g2.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = g2; ctx.fillRect(0,0,W,H); },
    stars: (ctx, W, H, u, glow, ms) => { base(ctx, W, H, glow, false); const R = A.rng(4242);
      for(let i = 0; i < 140; i++){ const x = R()*W, y = (R()*H + ms * 0.012 * (0.3 + R())) % H, r = (0.8 + R()*2.2) * u;
        ctx.fillStyle = `rgba(255,255,255,${0.15 + R()*0.5})`; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI*2); ctx.fill(); } },
  });
  const CONF = ['#3DFFA0', '#FFD35C', '#C09EFF', '#6EC0FF', '#FF5ADC', '#FFFFFF'];
  Object.assign(X.bursts, {
    confetti: { fall: 260, draw: (ctx, px, py, sz, spin, R) => { ctx.save(); ctx.translate(px, py); ctx.rotate(spin); ctx.fillStyle = CONF[Math.floor(R()*CONF.length)]; ctx.fillRect(-sz*0.18, -sz*0.32, sz*0.36, sz*0.64); ctx.restore(); } },
    fire:     { glyph: '\u{1F525}' },
    diamonds: { glyph: '\u{1F48E}' },
    rockets:  { glyph: '\u{1F680}' },
  });
  Object.assign(X.hooks.en, { printed:'HOW I PRINTED', scalp:'SCALP OF THE DAY', copy:'WOULD YOU COPY THIS?', sniped:'SNIPED IT', lesson:'LESSON LEARNED', go:'LET\u2019S GO' });
  Object.assign(X.hooks.fr, { printed:'COMMENT J\u2019AI PRINT', scalp:'SCALP DU JOUR', copy:'TU L\u2019AURAIS PRIS ?', sniped:'SNIP\u00C9', lesson:'LE\u00C7ON APPRISE', go:'C\u2019EST PARTI' });
  X.intros.logo = { ms: 1300,
    sound: a => { if(!a.minimal) a.pad(a.S(100), 1.1, 330, 0.05); },
    draw: (ctx, W, H, u, t, img, ms) => {
      const k = ms / A.T_INTRO, col = t.pnl >= 0 ? A.GREEN : A.RED;
      A.bg(ctx, W, H, u, col, ms);
      const s = (420 + 140 * A.easeOut(k)) * u;
      ctx.save(); ctx.globalAlpha = A.easeOut(A.seg(k, 0, 0.3));
      ctx.shadowColor = A.hexA(col, 0.55); ctx.shadowBlur = 80*u*A.FX;
      A.coinBadge(ctx, img, W/2 - s/2, H*0.42 - s/2, s, u); ctx.shadowBlur = 0;
      ctx.textAlign = 'center'; ctx.font = `900 ${96*u}px ${A.SANS}`; ctx.fillStyle = '#fff';
      ctx.fillText(tk(t.ticker), W/2, H*0.42 + s/2 + 130*u);
      ctx.font = `700 ${30*u}px ${A.MONO}`; ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.fillText(A.L.replay, W/2, H*0.42 + s/2 + 190*u);
      ctx.restore(); } };
  X.intros.countdown = { ms: 2100,
    sound: a => { [0, 500, 1000].forEach(m => a.tone(a.S(m), 880, 0, 0.12, 'square', 0.1)); a.tone(a.S(1500), 1760, 0, 0.3, 'square', 0.1); a.impact(a.S(1500), 0.9); },
    draw: (ctx, W, H, u, t, img, ms, opt) => {
      const col = t.pnl >= 0 ? A.GREEN : A.RED;
      A.bg(ctx, W, H, u, col, ms);
      const CY = H*0.42, s = 640*u; ctx.save(); ctx.globalAlpha = 0.22; ctx.filter = `blur(${22*u}px)`; A.coinBadge(ctx, img, W/2 - s/2, CY - s/2, s, u); ctx.restore();
      const step = Math.floor(ms / 500), f = (ms % 500) / 500;
      const txt = step < 3 ? String(3 - step) : (opt.hideUsd ? A.pctS(t.roi) : A.money(t.pnl));
      const sc = step < 3 ? 1.6 - 0.6 * A.easeOut(f) : 0.8 + 0.2 * A.easeOutBack(A.clamp01(f * 2));
      ctx.save(); ctx.translate(W/2, CY); ctx.scale(sc, sc); ctx.globalAlpha = step < 3 ? 1 - f * 0.6 : 1;
      ctx.font = `900 ${(step < 3 ? 380 : 170) * u}px ${A.MONO}`;
      ctx.fillStyle = step < 3 ? '#fff' : col; ctx.shadowColor = col; ctx.shadowBlur = 50*u*A.FX; A.fillCentered(ctx, txt, 0, 0); ctx.restore();
      ctx.save(); ctx.strokeStyle = A.hexA(col, (1 - f) * 0.7 * (A.FX || 0.4)); ctx.lineWidth = 8*u; ctx.beginPath(); ctx.arc(W/2, CY, (260 + 220*f) * u, 0, Math.PI*2); ctx.stroke(); ctx.restore();
      if(step >= 3){ ctx.textAlign = 'center'; ctx.font = `900 ${50*u}px ${A.SANS}`; ctx.fillStyle = '#fff'; ctx.globalAlpha = A.clamp01(f * 3);
        A.fillCentered(ctx, A.L.on + ' ' + tk(t.ticker), W/2, CY + 330*u); ctx.globalAlpha = 1; } } };
  X.unlocked = true;
});

/* ---------- full stats ---------- */
window.dcProStats = function(){
  const ts = trades.slice().sort((a,b)=>a.timestamp-b.timestamp);
  const wins = ts.filter(t=>t.pnl>=0), losses = ts.filter(t=>t.pnl<0);
  const sum = a => a.reduce((s,t)=>s+t.pnl,0), avg = (a,f) => a.length ? a.reduce((s,t)=>s+f(t),0)/a.length : 0;
  const gw = sum(wins), gl = -sum(losses);
  let cur = 0, bestW = 0, curL = 0, worstL = 0;
  ts.forEach(t=>{ if(t.pnl>=0){ cur++; curL = 0; } else { curL++; cur = 0; } bestW = Math.max(bestW, cur); worstL = Math.max(worstL, curL); });
  let peak = 0, eq = 0, dd = 0; ts.forEach(t=>{ eq += t.pnl; peak = Math.max(peak, eq); dd = Math.min(dd, eq - peak); });
  const hours = Array(24).fill(0); ts.forEach(t=>{ hours[new Date(t.timestamp).getHours()] += t.pnl; });
  const bh = hours.indexOf(Math.max(...hours));
  const by = {}; ts.forEach(t=>{ const k = t.source || 'manual'; by[k] = (by[k] || 0) + t.pnl; });
  const topSrc = Object.entries(by).sort((a,b)=>b[1]-a[1])[0];
  const coins = {}; ts.forEach(t=>{ coins[t.ticker] = (coins[t.ticker] || 0) + t.pnl; });
  const topCoin = Object.entries(coins).sort((a,b)=>b[1]-a[1])[0];
  const legendary = computedTrades().filter(t=>['legendary','mythic'].includes(t.meta.rarity)).length;
  const ach = new Set(); computedTrades().forEach(t=>t.meta.achievements.forEach(a=>ach.add(a.key)));
  return [
    {i:"x", l:"Losses", v:losses.length},
    {i:"rocket", l:"Best ROI", v: ts.length ? fmt.pct(Math.max(...ts.map(t=>t.roi))) : '—'},
    {i:"skull", l:"Biggest loss", v: ts.length ? fmt.usd(Math.min(...ts.map(t=>t.pnl))) : '—'},
    {i:"coin", l:"Avg win", v: fmt.usd(avg(wins, t=>t.pnl))},
    {i:"coin", l:"Avg loss", v: fmt.usd(avg(losses, t=>t.pnl))},
    {i:"target", l:"Profit factor", v: gl > 0 ? (gw/gl).toFixed(2) : (gw > 0 ? '\u221E' : '—')},
    {i:"check", l:"Best win streak", v: bestW},
    {i:"x", l:"Worst loss streak", v: worstL},
    {i:"skull", l:"Max drawdown", v: fmt.usd(dd)},
    {i:"layers", l:"Avg hold", v: ts.length ? fmt.hold(Math.round(avg(ts, t=>t.holdTime))) : '—'},
    {i:"rocket", l:"Best hour", v: ts.length ? String(bh).padStart(2,'0') + 'h' : '—'},
    {i:"crown", l:"Top coin", v: topCoin ? esc(tk(topCoin[0])) : '—'},
    {i:"coin", l:"Top source", v: topSrc ? esc(topSrc[0]) : '—'},
    {i:"crown", l:"Legendary+ cards", v: legendary},
    {i:"trophy", l:"Achievements", v: ach.size + " / " + ACH_CATALOG.length},
  ];
};
window.dispatchEvent(new Event('dc-studio'));
})();
