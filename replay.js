/* ============================================================================
   DEGENCARDS - Trade Replay video (9:16, 1080x1920)
   Your real candles replayed like a highlight: coin intro -> warp -> candles
   drawn live with the camera following the price, BUY reticle, live PnL,
   SELL reticle + $ burst, then a recap screen. Buy / sell only (no callouts).
   Pure canvas, deterministic: frame = f(time), so preview and export match.
   ============================================================================ */
(function(){
const W0 = 1080, H0 = 1920;
const GEM = 'M12 2l1.8 5.2L19 9l-5.2 1.8L12 16l-1.8-5.2L5 9l5.2-1.8L12 2z';   // the DEGENCARDS jewel (same path as the site logo)
/* ---------- options (all predefined choices) ---------- */
const THEMES = {
  neon:   { name:'Neon',   win:'#3DFFA0', loss:'#FF5C6C', up:'#18C964', dn:'#FF3B4E' },
};
/* PRO replay studio: extra themes, backgrounds, sell effects, intros and hook texts are NOT in this public file; they arrive
   from the `pro` edge function only for a verified subscriber (see app.js loadStudio) and register here. Without them,
   every option falls back to the default look. */
const EXT = { unlocked:false, themes:{}, bgs:{}, bursts:{}, intros:{}, hooks:{ en:{}, fr:{} } };
const DEFAULTS = { theme:'neon', intro:'hook', hook:'auto', chart:'candles', speed:'normal', bg:'grid', camera:'follow', fx:'max',
  burst:'dollars', sound:'hype', lang:'en', outro:'full', showMiles:true, showBuy:true, showInvested:true, showMult:true, showTime:true, hideUsd:false };
const STR = {
  en:{ replay:'TRADE REPLAY', watch:'WATCH THE TRADE', watchLoss:'WATCH IT PLAY OUT', in:'IN', on:'ON', live:'LIVE PNL', pnl:'PNL', invested:'INVESTED',
       held:'held', secured:'BAG SECURED', closed:'TRADE CLOSED', profit:'PROFIT', result:'RESULT', inv:'Invested', entry:'Entry MC', exit:'Exit MC', tag:'Your trades. Turned into cards.',
       buyWin:'YOUR PROFIT =', buyLoss:'YOU LOST =',
     },
  fr:{ replay:'REPLAY DU TRADE', watch:'REGARDE LE TRADE', watchLoss:'REGARDE COMMENT \u00C7A TOURNE', in:'EN', on:'SUR', live:'PNL LIVE', pnl:'PNL', invested:'INVESTI',
       held:'tenu', secured:'SAC S\u00C9CURIS\u00C9', closed:'TRADE CL\u00D4TUR\u00C9', profit:'PROFIT', result:'R\u00C9SULTAT', inv:'Investi', entry:'MC entr\u00E9e', exit:'MC sortie', tag:'Tes trades. En cartes.',
       buyWin:'TON PROFIT =', buyLoss:'T\u2019AS PERDU =',
     },
};
let GREEN, UP, DN, RED, L, O, K, FX; const DOT_R = 30;                // fill rounds: one fixed, readable size
let T_INTRO, T_WARP, T_REPLAY, T_OUTRO, T_BRAND, DURATION, O_WARP, O_REPLAY, O_OUTRO, O_BRAND;
function configure(opt){
  O = EXT.unlocked ? { ...DEFAULTS, ...(opt || {}) } : { ...DEFAULTS, hideUsd: !!(opt && opt.hideUsd) };
  if(!THEMES[O.theme] && !EXT.themes[O.theme]) O.theme = DEFAULTS.theme;
  if(O.bg !== DEFAULTS.bg && !EXT.bgs[O.bg]) O.bg = DEFAULTS.bg;
  if(!['dollars','none'].includes(O.burst) && !EXT.bursts[O.burst]) O.burst = DEFAULTS.burst;
  if(!['hook','none'].includes(O.intro) && !EXT.intros[O.intro]) O.intro = DEFAULTS.intro;
  if(O.hook !== 'auto' && !(EXT.hooks.en[O.hook])) O.hook = 'auto';
  const th = THEMES[O.theme] || EXT.themes[O.theme] || THEMES.neon; GREEN = th.win; RED = th.loss; UP = th.up; DN = th.dn;
  L = STR[O.lang] || STR.en;
  FX = O.fx === 'off' ? 0 : O.fx === 'soft' ? 0.45 : 1;
  K = O.camera === 'zoom' ? 12 : O.camera === 'full' ? 1e9 : 22;
  T_INTRO = O.intro === 'none' ? 0 : EXT.intros[O.intro] ? EXT.intros[O.intro].ms : 1700;
  T_WARP  = O.intro === 'none' || FX === 0 ? 0 : 850;
  T_REPLAY = O.speed === 'slow' ? 17500 : O.speed === 'fast' ? 8000 : 12500;
  T_OUTRO = O.outro === 'quick' ? 0 : 3200;
  T_BRAND = O.outro === 'full' ? 2700 : 1500;
  O_WARP = T_INTRO; O_REPLAY = O_WARP + T_WARP; O_OUTRO = O_REPLAY + T_REPLAY; O_BRAND = O_OUTRO + T_OUTRO;
  DURATION = O_BRAND + T_BRAND;
}
configure({});
/* what the PnL buys (option showBuy): the most expensive item it covers, times how many (rough US retail prices) */
const BUYS = [
  [5, '\u2615', 'Starbucks latte', 'Latte Starbucks'], [13, '\u{1F354}', 'Big Mac meal', 'Menu Big Mac'], [40, '\u{1F355}', 'Pizza night', 'Soir\u00E9e pizza'],
  [70, '\u{1F3AE}', 'New video game', 'Jeu vid\u00E9o'], [130, '\u{1F45F}', 'Nike Dunks', 'Nike Dunk'], [250, '\u{1F3A7}', 'AirPods Pro', 'AirPods Pro'],
  [700, '\u{1F579}\uFE0F', 'PS5 Pro', 'PS5 Pro'], [1200, '\u{1F4F1}', 'iPhone Pro Max', 'iPhone Pro Max'], [2500, '\u{1F4BB}', 'MacBook Pro', 'MacBook Pro'],
  [5000, '\u2708\uFE0F', 'Week in Dubai', 'Semaine \u00E0 Duba\u00EF'], [10000, '\u231A', 'Rolex Submariner', 'Rolex Submariner'], [30000, '\u{1F45C}', 'Herm\u00E8s Birkin', 'Herm\u00E8s Birkin'],
  [45000, '\u{1F697}', 'Tesla Model Y', 'Tesla Model Y'], [150000, '\u231A', 'Patek Nautilus', 'Patek Nautilus'], [250000, '\u{1F3CE}\uFE0F', 'Porsche 911 GT3 RS', 'Porsche 911 GT3 RS'],
  [520000, '\u{1F3CE}\uFE0F', 'Lamborghini SVJ', 'Lamborghini SVJ'], [1000000, '\u{1F3D9}\uFE0F', 'Miami penthouse', 'Penthouse \u00E0 Miami'], [3500000, '\u{1F3CE}\uFE0F', 'Bugatti Chiron', 'Bugatti Chiron'],
  [15000000, '\u{1F6E5}\uFE0F', 'Superyacht', 'Superyacht'], [65000000, '\u{1F6E9}\uFE0F', 'Gulfstream G650', 'Gulfstream G650'],
];
function buyOf(t){
  const a = Math.abs(t.pnl || 0); if(!O.showBuy || O.hideUsd || a < 5) return null;
  let b = BUYS[0]; BUYS.forEach(x => { if(x[0] <= a) b = x; });
  const n = Math.floor(a / b[0]);
  return { emo: b[1], name: (n > 1 ? n + '\u00D7 ' : '') + (O.lang === 'fr' ? b[3] : b[2]), lab: t.pnl >= 0 ? L.buyWin : L.buyLoss };
}
/* the item as a pill: emoji in a round + label + name, centered on (x, y) or left-aligned at x */
function buyPill(ctx, it, x, y, u, col, center){
  ctx.save(); ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  ctx.font = `700 ${22*u}px ${MONO}`; const lw = ctx.measureText(it.lab).width;
  ctx.font = `900 ${38*u}px ${SANS}`; const nw = ctx.measureText(it.name).width;
  const h = 96*u, w = h + 18*u + Math.max(lw, nw) + 34*u, x0 = center ? x - w/2 : x;
  rrect(ctx, x0, y - h/2, w, h, h/2); ctx.fillStyle = 'rgba(5,7,10,0.72)'; ctx.fill(); ctx.lineWidth = 3*u; ctx.strokeStyle = hexA(col, 0.7); ctx.stroke();
  ctx.beginPath(); ctx.arc(x0 + h/2, y, h/2 - 8*u, 0, Math.PI*2); ctx.fillStyle = hexA(col, 0.18); ctx.fill();
  ctx.font = `${50*u}px ${SANS}`; fillCentered(ctx, it.emo, x0 + h/2, y);
  ctx.font = `700 ${22*u}px ${MONO}`; ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.fillText(it.lab, x0 + h + 18*u, y - 20*u);
  ctx.font = `900 ${38*u}px ${SANS}`; ctx.fillStyle = '#fff'; ctx.fillText(it.name, x0 + h + 18*u, y + 18*u);
  ctx.restore();
}
const SANS = "'Outfit', system-ui, sans-serif", MONO = "'JetBrains Mono', ui-monospace, monospace";
// TikTok / Reels / Shorts cover the top (search), the right column (like, comment…) and the bottom (caption)
const SAFE_T = 250, SAFE_B = 480, SAFE_R = 170;

const clamp01 = v => Math.max(0, Math.min(1, v));
const seg = (x, a, b) => clamp01((x - a) / (b - a));
const easeOut = x => 1 - Math.pow(1 - x, 3);
const easeInOut = x => x < .5 ? 4*x*x*x : 1 - Math.pow(-2*x + 2, 3) / 2;
const easeOutBack = x => { const c = 1.7; return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2); };
const hexA = (hex, a) => { const n = parseInt(hex.slice(1),16); return `rgba(${n>>16&255},${n>>8&255},${n&255},${a})`; };
const money = v => { const a = Math.abs(v); const s = a >= 1e6 ? (a/1e6).toFixed(2)+'M' : a >= 1e3 ? (a/1e3).toFixed(2)+'K' : a.toFixed(2); return (v < 0 ? '-$' : '+$') + s; };
const plain = v => { const a = Math.abs(v); return '$' + (a >= 1e6 ? (a/1e6).toFixed(2)+'M' : a >= 1e3 ? (a/1e3).toFixed(1)+'K' : a.toFixed(2)); };
const mcS = v => v >= 1e9 ? '$'+(v/1e9).toFixed(2)+'B' : v >= 1e6 ? '$'+(v/1e6).toFixed(2)+'M' : v >= 1e3 ? '$'+(v/1e3).toFixed(1)+'K' : '$'+Math.round(v||0);
const pctS = v => (v >= 0 ? '+' : '') + v.toFixed(1) + '%';
const holdS = s => s < 60 ? s+'s' : s < 3600 ? Math.floor(s/60)+'m '+(s%60)+'s' : Math.floor(s/3600)+'h '+Math.floor(s%3600/60)+'m';
function rrect(ctx, x, y, w, h, r){ ctx.beginPath(); ctx.moveTo(x+r,y); ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r); ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r); ctx.closePath(); }
function rng(seed){ let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

/* ---------- prepared data (cached per trade) ---------- */
const prepCache = new WeakMap();
function prep(t){
  if(prepCache.has(t)) return prepCache.get(t);
  const ch = t.chart;
  // sparse data: one candle per move between two consecutive REAL prices (open = previous real price, close = this one)
  let cs = ch.c, iv = ch.i;
  if(false){
    const p = ch.pts; iv = Math.max(1000, (p[p.length-1][0] - p[0][0]) / Math.max(1, p.length - 1));
    cs = p.slice(1).map((q,i)=>[p[i][0], p[i][1], Math.max(p[i][1], q[1]), Math.min(p[i][1], q[1]), q[1]]);
  }
  const marks = (ch.m || []).slice().sort((a,b)=>a[0]-b[0]);
  const idxOf = ts => { let k = cs.findIndex(c => ts < c[0] + iv); return k < 0 ? cs.length - 1 : k; };
  const buys = marks.filter(m=>m[1]==='b'), sells = marks.filter(m=>m[1]==='s');
  const at = ts => { const c = cs[idxOf(ts)]; return (c[2]+c[3])/2; };
  const mcOf = m => m[2] > 0 ? m[2] : at(m[0]);
  const bm = buys[0] || [t.timestamp - t.holdTime*1000, 'b', t.entryMc];
  const sm = sells[sells.length-1] || [t.timestamp, 's', t.exitMc];
  // several fills: the replay shows only the first BUY and the last SELL
  const ib = idxOf(bm[0]), is = Math.max(ib, idxOf(sm[0]));
  const buyMc = mcOf(bm) || t.entryMc || 1, sellMc = mcOf(sm) || t.exitMc || buyMc;
  const size = t.roi ? Math.abs(t.pnl / (t.roi / 100)) : 0;
  // timeline: normal pace before / after, slower during the trade, a pause on BUY and on SELL
  const w = cs.map((_, i) => (i >= ib - 1 && i <= is + 1) ? 2.2 : 1);
  w[ib] += 4; w[is] += 4;
  const cum = [0]; w.forEach(x => cum.push(cum[cum.length-1] + x));
  const total = cum[cum.length-1];
  // milestones while holding: first candle that CLOSES at 2x, 3x, 5x... (or -25 %, -50 %, -75 %) -> stamp + camera kick + sound
  // (closes, not wicks: a stamp never claims a level the live multiplier on screen didn't show)
  const ups = [1.5, 2, 3, 4, 5, 7, 10, 15, 20, 30, 50, 75, 100, 200, 500, 1000], dns = [0.9, 0.75, 0.5, 0.25, 0.1], hit = new Set(), mls = [];
  const upEmo = th => th >= 100 ? '\u{1F315}' : th >= 30 ? '\u{1F451}' : th >= 10 ? '\u{1F48E}' : th >= 4 ? '\u{1F525}' : th >= 2 ? '\u{1F680}' : '\u{1F4C8}';
  const dnEmo = th => th <= 0.1 ? '\u2620\uFE0F' : th <= 0.25 ? '\u{1FAA6}' : th <= 0.5 ? '\u{1F480}' : th <= 0.75 ? '\u{1F62C}' : '\u{1F610}';
  for(let i = ib + 1; i < is; i++){
    const c = cs[i];
    ups.forEach(th => { if(!hit.has(th) && c[4] / buyMc >= th){ hit.add(th); mls.push({ i, up: true, txt: th + 'X', emo: upEmo(th) }); } });
    dns.forEach(th => { if(!hit.has(th) && c[4] / buyMc <= th){ hit.add(th); mls.push({ i, up: false, txt: '-' + Math.round((1 - th) * 100) + '%', emo: dnEmo(th) }); } });
  }
  const miles = mls.filter((m, k) => !mls[k+1] || mls[k+1].i !== m.i);   // same candle: only the biggest (spacing in time: milesOf)
  const p = { cs, iv, marks: [bm, sm], miles, ib, is, bm, sm, buyMc, sellMc, size, cum, total, n: cs.length };
  prepCache.set(t, p); return p;
}
/* replay time (0..T_REPLAY) -> revealed candles (float 0..n) */
function revealAt(P, ms){
  const target = clamp01(ms / (T_REPLAY * 0.9)) * P.total;              // last 10 %: settle on the final state
  let i = 0; while(i < P.n && P.cum[i+1] <= target) i++;
  if(i >= P.n) return P.n;
  const w = P.cum[i+1] - P.cum[i];
  // candles that carry a pause (BUY / SELL) fill up in the first part of their slot, then hold
  const f = (target - P.cum[i]) / w;
  const pause = (i === P.ib || i === P.is) ? Math.min(1, f * (w / Math.max(1, w - 4))) : f;
  return i + clamp01(pause);
}
/* X cards shown (option showMiles): one every 0.8 s at most (no stacked stamps), the biggest level always shown, 8 max */
function milesOf(P){
  if(!O.showMiles || !P.miles.length) return [];
  const all = P.miles.map(m => ({ ...m, at: revealTimeOf(P, m.i) })), out = [];
  all.forEach(m => { const prev = out[out.length-1]; if(!prev || m.at - prev.at >= 800) out.push(m); });
  const top = all[all.length-1];
  if(out[out.length-1] !== top){ if(top.at - out[out.length-1].at < 800) out.pop(); out.push(top); }
  return out.slice(-8);
}
function revealTimeOf(P, idx){                                         // replay ms at which candle idx is fully drawn
  const w = P.cum[idx+1] - P.cum[idx], extra = (idx === P.ib || idx === P.is) ? 4 : 0;
  return ((P.cum[idx] + (w - extra)) / P.total) * T_REPLAY * 0.9;
}

/* ---------- coherent live noise ---------- */
function livePrice(c, f, sd){
  const [ , o, hi, lo, cl] = c, up = cl >= o;
  const a = up ? lo : hi, b = up ? hi : lo;                          // visit the far extreme first, then the other, then close
  const pts = [[0, o], [0.3, o + (a - o) * 0.85], [0.72, b], [1, cl]];
  let k = 0; while(k < pts.length - 2 && f > pts[k+1][0]) k++;
  const [f0, v0] = pts[k], [f1, v1] = pts[k+1], x = clamp01((f - f0) / (f1 - f0));
  let v = v0 + (v1 - v0) * easeInOut(x);
  const range = Math.max(1e-9, hi - lo), R = rng(sd); const ph1 = R()*6.28, ph2 = R()*6.28;
  v += range * 0.12 * (Math.sin(f * 19 + ph1) * 0.65 + Math.sin(f * 43 + ph2) * 0.35) * Math.sin(Math.PI * f);   // fades to 0 at open and close; slow enough to read as price action, not jitter
  return Math.min(hi, Math.max(lo, v));
}

/* ---------- scenes ---------- */
function bg(ctx, W, H, u, glow, ms = 0){
  if(EXT.bgs[O.bg]) return EXT.bgs[O.bg](ctx, W, H, u, glow, ms);
  ctx.fillStyle = '#05070A'; ctx.fillRect(0,0,W,H);
  const g = ctx.createRadialGradient(W/2, H*0.42, 0, W/2, H*0.42, H*0.7);
  g.addColorStop(0, hexA(glow, 0.10)); g.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = g; ctx.fillRect(0,0,W,H);
  if(O.bg === 'grid'){ ctx.fillStyle = 'rgba(255,255,255,0.07)';        // dotted grid
    for(let y = 40*u; y < H; y += 48*u) for(let x = 24*u; x < W; x += 48*u) ctx.fillRect(x, y, 2.4*u, 2.4*u); }
}
function coinBadge(ctx, img, x, y, s, u){
  rrect(ctx, x, y, s, s, s*0.26); ctx.fillStyle = '#0B0B10'; ctx.fill();
  if(img && img.complete && img.naturalWidth){
    ctx.save(); rrect(ctx, x, y, s, s, s*0.26); ctx.clip();
    const r = Math.min(s / img.naturalWidth, s / img.naturalHeight), dw = img.naturalWidth*r, dh = img.naturalHeight*r;
    ctx.drawImage(img, x + (s-dw)/2, y + (s-dh)/2, dw, dh); ctx.restore();
  }
  rrect(ctx, x, y, s, s, s*0.26); ctx.lineWidth = 2*u; ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.stroke();
}
function footer(ctx, W, H, u, a){
  ctx.save(); ctx.globalAlpha = a;
  ctx.font = `900 ${34*u}px ${SANS}`; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#fff'; ctx.fillText('DEGEN', 64*u, H - SAFE_B*u); const dw = ctx.measureText('DEGEN').width;
  ctx.fillStyle = '#C09EFF'; ctx.fillText('CARDS', 64*u + dw, H - SAFE_B*u);
  ctx.textAlign = 'right'; ctx.font = `700 ${26*u}px ${MONO}`; ctx.fillStyle = 'rgba(255,255,255,0.75)'; ctx.fillText('degencards.vercel.app', W - SAFE_R*u, H - SAFE_B*u);
  ctx.restore();
}

/* hook: the result slams in first (what people stop scrolling for), glitch + shake, then the words pop on the beat */
/* centers on the glyphs actually drawn (not the font's em box): digits and signs sit dead center */
function fillCentered(ctx, txt, x, y){
  const ta = ctx.textAlign, tb = ctx.textBaseline; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  const m = ctx.measureText(txt), w = m.actualBoundingBoxLeft + m.actualBoundingBoxRight, h = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent;
  ctx.fillText(txt, x - w/2 + m.actualBoundingBoxLeft, y + h/2 - m.actualBoundingBoxDescent);
  ctx.textAlign = ta; ctx.textBaseline = tb;
}
function glitchText(ctx, txt, x, y, u, col, amt){
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  if(amt > 0){ ctx.fillStyle = 'rgba(255,40,90,0.75)'; fillCentered(ctx, txt, x - amt*u, y); ctx.fillStyle = 'rgba(40,220,255,0.75)'; fillCentered(ctx, txt, x + amt*u, y); }
  ctx.restore(); ctx.fillStyle = col; fillCentered(ctx, txt, x, y);
}
function intro(ctx, W, H, u, t, img, ms, opt, seed){
  const win = t.pnl >= 0, col = win ? GREEN : RED, k = ms / T_INTRO, R = rng(seed + 3);
  bg(ctx, W, H, u, col);
  // beat flashes (every 400 ms, matching the kick)
  const beat = (ms % 400) / 400, flash = Math.max(0, 1 - beat * 5) * (ms < 1300 ? 1 : 0) * FX;
  // camera shake on the slam
  const shake = Math.max(0, 1 - seg(ms, 90, 520)) * 26 * u * (FX === 1 ? 1 : 0);
  ctx.save(); ctx.translate((R()-.5)*shake, (R()-.5)*shake);
  // blurred coin behind
  const s = 760*u*(1 + 0.08*k);
  ctx.save(); ctx.globalAlpha = 0.28 * easeOut(seg(ms, 0, 300)); ctx.filter = `blur(${24*u}px)`;
  coinBadge(ctx, img, W/2 - s/2, H*0.43 - s/2, s, u); ctx.restore();
  // result slam: scale 2.6 -> 1
  const res = opt.hideUsd ? pctS(t.roi) : money(t.pnl);
  const sk = easeOutBack(seg(ms, 90, 380)), sc = 2.6 - 1.6 * sk;
  ctx.save(); ctx.translate(W/2, H*0.40); ctx.scale(sc, sc); ctx.globalAlpha = clamp01(seg(ms, 90, 200));
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = `900 ${190*u}px ${MONO}`;
  ctx.shadowColor = col; ctx.shadowBlur = 60*u;
  const g = FX === 1 ? ((ms < 700 && (Math.floor(ms / 70) % 3 === 0)) ? 10 : 3) : 0;  // glitch jitter while it lands
  glitchText(ctx, res, 0, 0, u, col, g); ctx.shadowBlur = 0; ctx.restore();
  // words pop one by one
  const words = [ (opt.hideUsd ? '' : pctS(t.roi) + ' ') + L.in + ' ' + holdS(t.holdTime).toUpperCase(), L.on + ' ' + tk(t.ticker), hookText(win) ];
  words.forEach((w, i) => {
    const wk = easeOutBack(seg(ms, 420 + i*300, 640 + i*300)); if(wk <= 0) return;
    ctx.save(); ctx.globalAlpha = clamp01(wk); ctx.translate(W/2, H*0.55 + i*96*u); ctx.scale(wk, wk);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `900 ${(i === 2 ? 44 : 66) * u}px ${SANS}`;
    const tw = ctx.measureText(w).width + 56*u;
    if(i === 2){ rrect(ctx, -tw/2, -38*u, tw, 76*u, 38*u); ctx.fillStyle = col; ctx.fill(); ctx.fillStyle = '#05070A'; fillCentered(ctx, w, 0, 0); }
    else { ctx.fillStyle = i === 0 ? '#fff' : 'rgba(255,255,255,0.85)'; fillCentered(ctx, w, 0, 0); }
    ctx.restore();
  });
  ctx.restore();
  // scanlines + beat flash
  if(flash > 0){ ctx.fillStyle = hexA(col, 0.18 * flash); ctx.fillRect(0,0,W,H); }
  if(ms < 90 && FX > 0){ ctx.fillStyle = '#fff'; ctx.fillRect(0,0,W,H); }
}
function hookText(win){ const hk = EXT.hooks[O.lang] || EXT.hooks.en; return O.hook === 'auto' ? (win ? L.watch : L.watchLoss) : (hk[O.hook] || L.watch); }
function warp(ctx, W, H, u, t, img, ms, seed){
  const k = ms / T_WARP, R = rng(seed);
  bg(ctx, W, H, u, t.pnl >= 0 ? GREEN : RED, ms);
  const cx = W/2, cy = H*0.45;
  ctx.save(); ctx.lineCap = 'round';
  for(let i = 0; i < Math.round(140 * FX); i++){                      // speed lines rushing out of the center
    const ang = R() * Math.PI * 2, sp = 0.4 + R() * 0.9, len = (0.12 + R()*0.35) * H;
    const d0 = ((k * sp * 1.6 + R()) % 1) * H * 0.9, d1 = d0 + len * easeOut(k);
    ctx.strokeStyle = R() < 0.7 ? `rgba(255,255,255,${0.25 + 0.5*R()})` : hexA(GREEN, 0.6);
    ctx.lineWidth = (1.5 + R()*3.5) * u;
    ctx.beginPath(); ctx.moveTo(cx + Math.cos(ang)*d0, cy + Math.sin(ang)*d0); ctx.lineTo(cx + Math.cos(ang)*d1, cy + Math.sin(ang)*d1); ctx.stroke();
  }
  ctx.restore();
  const s = 560*u * (1 + 3 * Math.pow(k, 2));                         // the logo flies into the camera
  ctx.save(); ctx.globalAlpha = 1 - seg(k, 0.35, 0.8);
  coinBadge(ctx, img, cx - s/2, cy - s/2, s, u); ctx.restore();
  const flash = Math.max(0, 1 - Math.abs(k - 0.82) / 0.12);          // white flash into the replay
  if(flash > 0){ ctx.fillStyle = `rgba(255,255,255,${0.85*flash})`; ctx.fillRect(0,0,W,H); }
}

/* place fill rounds without overlap: pairwise push apart vertically (buy down, sell up), then draw leader + round */
function drawFills(ctx, list, u, R){
  const pts = list.map(p => ({ ...p, x: p.ax, y: p.ay })), minD = 2 * R * u + 6 * u;
  for(let pass = 0; pass < 8; pass++){
    let moved = false;
    for(let a = 0; a < pts.length; a++) for(let b = a + 1; b < pts.length; b++){
      const p = pts[a], q = pts[b], dx = q.x - p.x, dy = q.y - p.y, d = Math.hypot(dx, dy);
      if(d >= minD) continue;
      const need = (minD - d) / 2 + 0.5;
      const upFirst = p.kind === 's' && q.kind !== 's' ? p : q.kind === 's' && p.kind !== 's' ? q : (p.ay <= q.ay ? p : q);
      const other = upFirst === p ? q : p;
      upFirst.y -= need; other.y += need; moved = true;
    }
    if(!moved) break;
  }
  pts.forEach(p => {
    if(Math.hypot(p.x - p.ax, p.y - p.ay) > 3 * u){                  // displaced: leader line + small anchor on the exact fill
      const col = p.kind === 'b' ? DOT_B : DOT_S;
      ctx.save(); ctx.strokeStyle = col; ctx.lineWidth = 3 * u; ctx.beginPath(); ctx.moveTo(p.ax, p.ay); ctx.lineTo(p.x, p.y); ctx.stroke();
      ctx.fillStyle = col; ctx.beginPath(); ctx.arc(p.ax, p.ay, 7 * u, 0, Math.PI * 2); ctx.fill();
      ctx.lineWidth = 2 * u; ctx.strokeStyle = 'rgba(5,7,10,0.85)'; ctx.stroke(); ctx.restore();
    }
  });
  pts.forEach(p => tradeDot(ctx, p.x, p.y, u, p.kind, R));
}
/* a fill on the chart: small filled round, green B = buy, red S = sell */
const DOT_B = '#18C964', DOT_S = '#FF3B4E';                          // buy / sell stay green / red whatever the theme
function tradeDot(ctx, x, y, u, kind, r = 30){                     // r in 1080-units
  const col = kind === 'b' ? DOT_B : DOT_S;
  ctx.save(); ctx.shadowBlur = 0;
  ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y, r*u, 0, Math.PI*2); ctx.fill();
  ctx.lineWidth = 3*u; ctx.strokeStyle = 'rgba(5,7,10,0.85)'; ctx.stroke();
  ctx.fillStyle = '#fff'; ctx.font = `900 ${r*1.15*u}px ${MONO}`; fillCentered(ctx, kind === 'b' ? 'B' : 'S', x, y);
  ctx.restore();
}
function reticle(ctx, x, y, u, col, k, label, amount){
  const r = (230 - 150 * easeOut(k)) * u, a = clamp01(k * 3);
  ctx.save(); ctx.globalAlpha = a;
  ctx.strokeStyle = col; ctx.lineWidth = 6*u; ctx.shadowColor = col; ctx.shadowBlur = 30*u;
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI*2); ctx.stroke();
  ctx.lineWidth = 5*u;
  for(let i = 0; i < 4; i++){                                         // crosshair ticks
    const ang = Math.PI/4 + i * Math.PI/2, r0 = r * 0.55, r1 = r * 0.85;
    ctx.beginPath(); ctx.moveTo(x + Math.cos(ang)*r0, y + Math.sin(ang)*r0); ctx.lineTo(x + Math.cos(ang)*r1, y + Math.sin(ang)*r1); ctx.stroke();
  }
  ctx.shadowBlur = 0; tradeDot(ctx, x, y, u, label === 'BUY' ? 'b' : 's', DOT_R);
  // label pill under, amount above
  const pk = easeOutBack(seg(k, 0.25, 0.7));
  ctx.globalAlpha = clamp01(pk);
  ctx.font = `900 ${44*u}px ${MONO}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const lw = ctx.measureText(label).width + 70*u, ly = y + r + 64*u;
  rrect(ctx, x - lw/2, ly - 38*u, lw, 76*u, 38*u); ctx.fillStyle = 'rgba(5,7,10,0.85)'; ctx.fill();
  ctx.lineWidth = 3*u; ctx.strokeStyle = hexA(col, 0.8); ctx.stroke();
  ctx.fillStyle = '#fff'; ctx.fillText(label, x, ly + 2*u);
  if(amount){ ctx.font = `900 ${54*u}px ${MONO}`; ctx.fillStyle = col; ctx.shadowColor = col; ctx.shadowBlur = 24*u; ctx.fillText(amount, x, y - r - 50*u); }
  ctx.restore(); ctx.textBaseline = 'alphabetic';
}

function replay(ctx, W, H, u, t, img, ms, opt, seed){
  const P = prep(t), win = t.pnl >= 0, col = win ? GREEN : RED;
  const r = revealAt(P, ms), full = Math.floor(r), frac = r - full;
  bg(ctx, W, H, u, col, ms);
  // camera kick on BUY, SELL and every milestone: punch-in zoom + short shake
  const ML = milesOf(P), tb0 = revealTimeOf(P, P.ib), ts0 = revealTimeOf(P, P.is), mt = ML.map(m => m.at);
  const kick = Math.max(0, ...[tb0, ts0 + 500, ...mt].map(e => ms >= e ? 1 - seg(ms, e, e + 380) : 0)) * FX;
  const pop = Math.max(0, ...mt.map(e => ms >= e ? 1 - seg(ms, e, e + 450) : 0));
  ctx.save();
  if(kick > 0){ const Rk = rng(seed + Math.floor(ms / 33)), z = 1 + 0.045 * kick, sh = 22 * u * kick * kick;
    ctx.translate(W/2 + (Rk()-.5)*sh, H/2 + (Rk()-.5)*sh); ctx.scale(z, z); ctx.translate(-W/2, -H/2); }
  // plot area
  const top = (SAFE_T + 230)*u, bottom = H - (SAFE_B + 120)*u, left = 64*u, right = W - (SAFE_R + 70)*u, pw = right - left, ph = bottom - top;
  // visible window: the last K candles, the camera slides smoothly
  const KK = Math.min(K, P.n);                                        // 'full' camera: the whole chart, drawn in place
  const head = Math.max(1, r), start = O.camera === 'full' ? 0 : Math.max(0, head - KK);
  const slot = pw / KK;
  const vis = []; for(let i = Math.max(0, Math.floor(start) - 1); i < Math.min(P.n, Math.ceil(head)); i++) vis.push(i);
  // y range over the visible candles (current one partially formed), padded
  const cur = (i) => {                                                 // candle i as drawn at this instant
    const c = P.cs[i]; if(i < full) return c;
    // live ticks: the price wanders O -> first extreme -> second extreme -> C with seeded noise,
    // always clamped to the candle's real low/high, so wicks grow like a real live candle
    const px = livePrice(c, frac, seed + i * 131);
    let h = c[1], l = c[1]; for(let q = 0; q <= 12; q++){ const v = livePrice(c, frac * q / 12, seed + i * 131); h = Math.max(h, v); l = Math.min(l, v); }
    return [c[0], c[1], h, l, px];
  };
  // vertical scale: range averaged over ±0.3 s (the replay is precomputed, so it anticipates new highs / lows) -> eases instead of jumping
  const rangeAt = (m) => {
    const rr = revealAt(P, Math.max(0, m)), ff = Math.floor(rr), fr = rr - ff, hd = Math.max(1, rr);
    const st = O.camera === 'full' ? 0 : Math.max(0, hd - KK);
    let a = Infinity, b = -Infinity;
    for(let i = Math.max(0, Math.floor(st)); i < Math.min(P.n, Math.ceil(hd)); i++){
      const c = P.cs[i];
      if(i < ff){ a = Math.min(a, c[3]); b = Math.max(b, c[2]); }
      else { const sd = seed + i * 131; for(let q = 0; q <= 8; q++){ const v = livePrice(c, fr * q / 8, sd); a = Math.min(a, v); b = Math.max(b, v); } }
    }
    if(rr > P.ib){ a = Math.min(a, P.buyMc); b = Math.max(b, P.buyMc); }
    if(!isFinite(a)){ a = P.cs[0][3]; b = P.cs[0][2]; }
    if(b - a < b * 0.02){ b *= 1.01; a *= 0.99; }
    return [a, b];
  };
  let lo = 0, hi = 0, wsum = 0;
  for(let k = -5; k <= 5; k++){ const w = 6 - Math.abs(k), [a, b] = rangeAt(ms + k * 60); lo += a * w; hi += b * w; wsum += w; }   // centered window: it also sees what's coming
  lo /= wsum; hi /= wsum;
  vis.forEach(i => { const c = cur(i); lo = Math.min(lo, c[3]); hi = Math.max(hi, c[2]); });   // never clip what is on screen
  const pad = (hi - lo) * 0.18; lo -= pad; hi += pad;
  const X = i => left + (i - start) * slot + slot/2, Y = v => top + (1 - (v - lo)/(hi - lo)) * ph;
  // speed lines at the start of the replay
  const sl = (1 - seg(ms, 0, 1400)) * FX;
  if(sl > 0){ const R = rng(seed + 7); ctx.save(); ctx.globalAlpha = sl * 0.5; ctx.strokeStyle = hexA(col, 0.5); ctx.lineWidth = 2*u;
    for(let i = 0; i < 40; i++){ const a = R()*Math.PI*2, d = (0.2 + R()*0.8) * H * 0.6; ctx.beginPath(); ctx.moveTo(W/2, H*0.5); ctx.lineTo(W/2 + Math.cos(a)*d, H*0.5 + Math.sin(a)*d); ctx.stroke(); } ctx.restore(); }
  // buy price guide
  if(r > P.ib + 0.3){ ctx.save(); ctx.setLineDash([10*u, 10*u]); ctx.strokeStyle = hexA(UP, 0.45); ctx.lineWidth = 2*u;
    ctx.beginPath(); ctx.moveTo(left, Y(P.buyMc)); ctx.lineTo(right, Y(P.buyMc)); ctx.stroke(); ctx.restore(); }
  // candles
  const bw = Math.max(8*u, slot * 0.62);
  ctx.save(); ctx.beginPath(); ctx.rect(left - bw, top - 40*u, pw + bw*2, ph + 80*u); ctx.clip();
  if(O.chart === 'candles'){
    vis.forEach(i => {
      const c = cur(i), x = X(i), upc = c[4] >= c[1], cc = upc ? UP : DN;
      ctx.strokeStyle = cc; ctx.lineWidth = Math.max(3*u, bw * 0.12);
      ctx.beginPath(); ctx.moveTo(x, Y(c[2])); ctx.lineTo(x, Y(c[3])); ctx.stroke();
      const y1 = Y(Math.max(c[1], c[4])), y2 = Y(Math.min(c[1], c[4]));
      ctx.fillStyle = cc; if(i === full){ ctx.shadowColor = cc; ctx.shadowBlur = 22*u*FX; }
      ctx.fillRect(x - bw/2, y1, bw, Math.max(3*u, y2 - y1)); ctx.shadowBlur = 0;
    });
  } else {                                                              // line / area: through the closes (live price for the one forming)
    const pts = vis.map(i => [X(i), Y(cur(i)[4])]);
    if(pts.length){
      if(O.chart === 'area'){ const gr = ctx.createLinearGradient(0, top, 0, bottom); gr.addColorStop(0, hexA(col, 0.32)); gr.addColorStop(1, hexA(col, 0));
        ctx.beginPath(); ctx.moveTo(pts[0][0], bottom); pts.forEach(p => ctx.lineTo(p[0], p[1])); ctx.lineTo(pts[pts.length-1][0], bottom); ctx.closePath(); ctx.fillStyle = gr; ctx.fill(); }
      ctx.beginPath(); pts.forEach((p, k) => k ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]));
      ctx.strokeStyle = col; ctx.lineWidth = 7*u; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.shadowColor = col; ctx.shadowBlur = 24*u*FX; ctx.stroke(); ctx.shadowBlur = 0;
      const lp = pts[pts.length-1]; ctx.fillStyle = col; ctx.beginPath(); ctx.arc(lp[0], lp[1], 8*u, 0, Math.PI*2); ctx.fill();   // live price (not a fill)
    }
  }
  // fills that already happened: fixed-size rounds; when two would overlap they are pushed apart
  // (buys down, sells up) and a short leader keeps pointing at the exact fill
  const shown = [];
  P.marks.forEach(m => {
    const i = P.cs.findIndex(c => m[0] < c[0] + P.iv); const ii = i < 0 ? P.n - 1 : i;
    if(r < ii + 0.99) return;
    const mc = m[2] > 0 ? m[2] : (P.cs[ii][2] + P.cs[ii][3]) / 2;
    shown.push({ kind: m[1], ax: X(ii), ay: Y(mc) });
  });
  drawFills(ctx, shown, u, DOT_R);
  ctx.restore();
  // live price line + multiplier vs buy
  const last = cur(Math.min(P.n - 1, full)), nowMc = last[4];
  if(r > P.ib + 0.5 && O.showMult){
    const y = Y(nowMc), mult = nowMc / P.buyMc;
    ctx.save(); ctx.setLineDash([6*u, 8*u]); ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 2*u;
    ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(right + 10*u, y); ctx.stroke(); ctx.restore();
    ctx.font = `800 ${30*u}px ${MONO}`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillStyle = mult >= 1 ? GREEN : RED; ctx.fillText(mult.toFixed(2)+'x', right + 18*u, y); ctx.textBaseline = 'alphabetic';
  }
  // header: coin + ticker (left), LIVE PNL + INVESTED (right)
  coinBadge(ctx, img, 64*u, SAFE_T*u, 84*u, u);
  ctx.textAlign = 'left'; ctx.font = `900 ${44*u}px ${SANS}`; ctx.fillStyle = '#fff'; ctx.fillText(tk(t.ticker), 168*u, (SAFE_T + 56)*u);
  const holding = r > P.ib + 0.5 && r < P.is + 0.99;
  const closed = r >= P.is + 0.99;
  let live = 0;
  if(holding) live = P.size * (nowMc / P.buyMc - 1);
  if(closed) live = t.pnl;
  if(r > P.ib + 0.5){
    ctx.textAlign = 'right'; ctx.font = `700 ${24*u}px ${MONO}`; ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fillText(closed ? L.pnl : L.live, W - 64*u, (SAFE_T + 18)*u);
    ctx.font = `900 ${64*u}px ${MONO}`; ctx.fillStyle = live >= 0 ? GREEN : RED; ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = 20*u*FX;
    ctx.save(); ctx.translate(W - 64*u, (SAFE_T + 80)*u); ctx.scale(1 + 0.22 * pop, 1 + 0.22 * pop);
    ctx.fillText(opt.hideUsd ? pctS(P.size ? live / P.size * 100 : 0) : money(live), 0, 0); ctx.restore(); ctx.shadowBlur = 0;
    if(!opt.hideUsd && O.showInvested){ ctx.font = `700 ${24*u}px ${MONO}`; ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.fillText(L.invested, W - 64*u, (SAFE_T + 124)*u);
      ctx.font = `800 ${34*u}px ${MONO}`; ctx.fillStyle = '#fff'; ctx.fillText(plain(P.size), W - 64*u, (SAFE_T + 164)*u); }
  }
  // elapsed since the buy
  if(r > P.ib + 0.5 && O.showTime){
    const lastTs = P.cs[Math.min(P.n-1, full)][0] + P.iv * frac;
    const el = Math.max(0, Math.round((Math.min(lastTs, closed ? P.sm[0] : lastTs) - P.bm[0]) / 1000));
    ctx.textAlign = 'center'; ctx.font = `700 ${30*u}px ${MONO}`; ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fillText((closed ? L.held + ' ' : '+') + holdS(closed ? t.holdTime : el), (left + right)/2, bottom + 70*u);
  }
  // BUY / SELL reticles
  const tb = revealTimeOf(P, P.ib), ts = revealTimeOf(P, P.is);
  const kb = seg(ms, tb - 250, tb + 900);
  if(kb > 0 && kb < 1){ const x = X(P.ib), y = Y(P.buyMc); reticle(ctx, x, y, u, UP, kb, 'BUY', opt.hideUsd || !O.showInvested ? '' : plain(P.size)); }
  const ks = seg(ms, ts - 250, ts + 900);
  if(ks > 0 && ks < 1){ const x = X(P.is), y = Y(P.sellMc); reticle(ctx, x, y, u, DN, ks, 'SELL', ''); }
  // SELL burst: $ particles + big result
  const kx = seg(ms, ts + 500, ts + 2300);
  if(kx > 0 && kx < 1){
    const R = rng(seed + 11), cx = W/2, cy = H*0.45;
    ctx.save(); ctx.fillStyle = `rgba(0,0,0,${0.45 * Math.sin(kx * Math.PI)})`; ctx.fillRect(0,0,W,H);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const xb = EXT.bursts[O.burst], glyph = xb && xb.glyph ? xb.glyph : (win ? '$' : '\u00D7');
    for(let i = 0; i < (O.burst === 'none' ? 0 : Math.round(90 * Math.max(0.35, FX))); i++){
      const a = R() * Math.PI*2, sp = 0.35 + R()*0.9, d = easeOut(kx) * sp * H * 0.55, sz = (28 + R()*44) * u, spin = (R() - 0.5) * 8 * kx;
      const px = cx + Math.cos(a)*d, py = cy + Math.sin(a)*d + (xb && xb.fall ? kx * kx * xb.fall * u : 0);
      ctx.globalAlpha = (1 - kx) * (0.6 + R()*0.4);
      if(xb && xb.draw){ xb.draw(ctx, px, py, sz, spin, R); continue; }
      ctx.font = `900 ${sz}px ${MONO}`; ctx.fillStyle = win ? (R() < 0.8 ? GREEN : '#fff') : (R() < 0.8 ? RED : '#fff');
      ctx.fillText(glyph, px, py);
    }
    ctx.globalAlpha = Math.min(1, kx * 6) * (1 - seg(kx, 0.8, 1));
    const sc = 0.7 + 0.3 * easeOutBack(seg(kx, 0, 0.3));
    ctx.translate(cx, cy); ctx.scale(sc, sc);
    ctx.font = `900 ${150*u}px ${MONO}`; ctx.fillStyle = win ? GREEN : RED; ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = 50*u*FX;
    fillCentered(ctx, opt.hideUsd ? pctS(t.roi) : money(t.pnl), 0, 0);
    if(!opt.hideUsd){ ctx.font = `900 ${64*u}px ${MONO}`; fillCentered(ctx, pctS(t.roi), 0, 125*u); }
    const it = buyOf(t), kp = easeOutBack(seg(kx, 0.18, 0.4));
    if(it && kp > 0){ ctx.shadowBlur = 0; ctx.save(); ctx.translate(0, 260*u); ctx.scale(kp, kp); buyPill(ctx, it, 0, 0, u, win ? GREEN : RED, true); ctx.restore(); }
    ctx.restore(); ctx.textBaseline = 'alphabetic';
  }
  // milestone stamps: 2X / 5X / -50 % slam in tilted, glitch while landing, then fly off
  ML.forEach((m, k) => {
    const e = mt[k], f = seg(ms, e, e + 1000); if(f <= 0 || f >= 1) return;
    const c2 = m.up ? GREEN : RED, land = easeOutBack(seg(f, 0, 0.22)), sc = 2.4 - 1.4 * land, out = seg(f, 0.8, 1);
    ctx.save(); ctx.translate(W*0.4, top + ph * 0.3 - out * 160*u); ctx.rotate((m.up ? -8 : 8) * Math.PI / 180); ctx.scale(sc, sc);
    ctx.globalAlpha = clamp01(f * 10) * (1 - out); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `900 ${200*u}px ${MONO}`; const tw = ctx.measureText(m.txt).width;
    rrect(ctx, -tw/2 - 50*u, -125*u, tw + 100*u, 250*u, 40*u); ctx.fillStyle = 'rgba(5,7,10,0.72)'; ctx.fill();
    ctx.lineWidth = 8*u; ctx.strokeStyle = c2; ctx.stroke();
    ctx.shadowColor = c2; ctx.shadowBlur = 40*u*FX;
    glitchText(ctx, m.txt, 0, 0, u, c2, FX === 1 && f < 0.3 && Math.floor(ms / 60) % 2 ? 9 : 0); ctx.shadowBlur = 0;
    ctx.font = `${110*u}px ${SANS}`; fillCentered(ctx, m.emo, tw/2 + 60*u, -110*u);
    ctx.restore();
    if(f < 0.08 && FX > 0){ ctx.fillStyle = hexA(c2, 0.28 * (1 - f / 0.08)); ctx.fillRect(0,0,W,H); }
  });
  ctx.restore();
  // heartbeat on the edges while holding: beats with the kick, stronger the further the PnL moves
  if(holding && FX > 0){
    const beat = Math.max(0, 1 - ((ms % 500) / 500) * 3.5), amp = Math.min(1, Math.abs(P.size ? live / P.size : 0)) * 0.6 + 0.15;
    const hb = ctx.createRadialGradient(W/2, H/2, W*0.45, W/2, H/2, H*0.72);
    hb.addColorStop(0, 'rgba(0,0,0,0)'); hb.addColorStop(1, hexA(live >= 0 ? GREEN : RED, 0.45 * beat * amp * FX));
    ctx.fillStyle = hb; ctx.fillRect(0,0,W,H);
  }
  footer(ctx, W, H, u, 1);
}

function outro(ctx, W, H, u, t, img, ms, opt){
  const P = prep(t), win = t.pnl >= 0, col = win ? GREEN : RED, k = ms / T_OUTRO;
  bg(ctx, W, H, u, col, ms);
  const a = easeOut(seg(k, 0, 0.2));
  ctx.save(); ctx.globalAlpha = a; ctx.textAlign = 'left';
  ctx.font = `900 ${76*u}px ${SANS}`; ctx.fillStyle = '#fff'; ctx.fillText(win ? L.secured : L.closed, 56*u, (SAFE_T + 60)*u);
  coinBadge(ctx, img, 56*u, (SAFE_T + 100)*u, 96*u, u);
  ctx.font = `900 ${46*u}px ${SANS}`; ctx.fillText(tk(t.ticker), 176*u, (SAFE_T + 148)*u);
  ctx.font = `700 ${26*u}px ${MONO}`; ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.fillText(L.held + ' ' + holdS(t.holdTime), 176*u, (SAFE_T + 186)*u);
  ctx.font = `700 ${26*u}px ${MONO}`; ctx.fillText(win ? L.profit : L.result, 56*u, (SAFE_T + 290)*u);
  const kb = easeOutBack(seg(k, 0.08, 0.3));
  ctx.save(); ctx.translate(56*u, (SAFE_T + 390)*u); ctx.scale(kb, kb);
  ctx.font = `900 ${118*u}px ${MONO}`; ctx.fillStyle = col; ctx.shadowColor = col; ctx.shadowBlur = 40*u;
  const big = opt.hideUsd ? pctS(t.roi) : money(t.pnl); ctx.fillText(big, 0, 0); const bwid = ctx.measureText(big).width; ctx.shadowBlur = 0;
  if(!opt.hideUsd){ ctx.font = `800 ${38*u}px ${MONO}`; const rt = (t.roi >= 0 ? '\u25B2 ' : '\u25BC ') + pctS(t.roi).replace('+',''), rw = ctx.measureText(rt).width + 40*u;
    rrect(ctx, bwid + 26*u, -58*u, rw, 64*u, 32*u); ctx.fillStyle = hexA(col, 0.16); ctx.fill(); ctx.fillStyle = col; ctx.fillText(rt, bwid + 46*u, -14*u); }
  ctx.restore(); ctx.restore();
  const it = buyOf(t), kp = easeOutBack(seg(k, 0.28, 0.42));
  if(it && kp > 0){ ctx.save(); ctx.translate(56*u, (SAFE_T + 500)*u); ctx.scale(kp, kp); buyPill(ctx, it, 0, 0, u, col, false); ctx.restore(); }
  // price line of the whole window with BUY / SELL
  const top = (SAFE_T + (it ? 600 : 500))*u, bottom = H - (SAFE_B + 250)*u, left = 56*u, right = W - (SAFE_R + 20)*u;
  const closes = P.cs.map(c => c[4]); let lo = Math.min(...P.cs.map(c=>c[3])), hi = Math.max(...P.cs.map(c=>c[2])); const pd = (hi-lo)*0.15 || hi*0.05; lo -= pd; hi += pd;
  const X = i => left + (i / Math.max(1, P.n - 1)) * (right - left), Y = v => top + (1 - (v - lo)/(hi - lo)) * (bottom - top);
  const draw = easeInOut(seg(k, 0.12, 0.6)), upto = Math.max(1, Math.floor(draw * (P.n - 1)));
  ctx.save();
  const grad = ctx.createLinearGradient(0, top, 0, bottom); grad.addColorStop(0, hexA(col, 0.28)); grad.addColorStop(1, hexA(col, 0));
  ctx.beginPath(); ctx.moveTo(X(0), Y(closes[0])); for(let i = 1; i <= upto; i++) ctx.lineTo(X(i), Y(closes[i]));
  ctx.lineTo(X(upto), bottom); ctx.lineTo(X(0), bottom); ctx.closePath(); ctx.fillStyle = grad; ctx.fill();
  ctx.beginPath(); ctx.moveTo(X(0), Y(closes[0])); for(let i = 1; i <= upto; i++) ctx.lineTo(X(i), Y(closes[i]));
  ctx.strokeStyle = col; ctx.lineWidth = 6*u; ctx.lineJoin = 'round'; ctx.shadowColor = col; ctx.shadowBlur = 24*u; ctx.stroke(); ctx.shadowBlur = 0;
  drawFills(ctx, [[P.ib, P.buyMc, 'b'], [P.is, P.sellMc, 's']].filter(([i]) => i <= upto).map(([i, mc, kind]) => ({ kind, ax: X(i), ay: Y(mc) })), u, DOT_R);
  ctx.restore();
  // stats
  const sa = easeOut(seg(k, 0.45, 0.65));
  ctx.save(); ctx.globalAlpha = sa; ctx.textAlign = 'left';
  const stats = [[opt.hideUsd || !O.showInvested ? '\u2014' : plain(P.size), L.inv], [mcS(P.buyMc), L.entry], [mcS(P.sellMc), L.exit]];
  stats.forEach(([v, l], i) => { const x = 56*u + i * 290*u;
    ctx.font = `900 ${50*u}px ${MONO}`; ctx.fillStyle = '#fff'; ctx.fillText(v, x, H - (SAFE_B + 125)*u);
    ctx.font = `600 ${26*u}px ${SANS}`; ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.fillText(l, x, H - (SAFE_B + 82)*u); });
  ctx.restore();
  footer(ctx, W, H, u, a);
}

function brand(ctx, W, H, u, ms, seed){
  ms = ms * (2700 / T_BRAND);                                         // short outro = the same animation, faster
  const k = ms / 2700, cx = W/2, cy = H*0.42, R = rng(seed + 21);
  ctx.fillStyle = '#05050A'; ctx.fillRect(0,0,W,H);
  const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, W*0.7);
  halo.addColorStop(0, `rgba(192,158,255,${0.28*easeOut(seg(ms, 400, 1100))})`); halo.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = halo; ctx.fillRect(0,0,W,H);
  const gem = new Path2D(GEM), S = 26*u;                           // path is 24 units wide
  const draw = easeInOut(seg(ms, 80, 800)), fill = easeOut(seg(ms, 650, 1050)), pop = easeOutBack(seg(ms, 650, 1050));
  const rot = (1 - easeOutBack(seg(ms, 0, 1100))) * -0.9 + Math.sin(ms / 520) * 0.04;
  ctx.save(); ctx.translate(cx, cy); ctx.rotate(rot); ctx.scale(S * (0.85 + 0.15 * pop), S * (0.85 + 0.15 * pop)); ctx.translate(-12, -9);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  // stroke draws itself
  ctx.setLineDash([70, 70]); ctx.lineDashOffset = 70 * (1 - draw);
  ctx.strokeStyle = '#C09EFF'; ctx.lineWidth = 1.2; ctx.shadowColor = '#C09EFF'; ctx.shadowBlur = 30*u; ctx.stroke(gem);
  ctx.setLineDash([]);
  // then fills with the purple -> gold gradient
  if(fill > 0){ const g = ctx.createLinearGradient(5, 2, 19, 16); g.addColorStop(0, '#C09EFF'); g.addColorStop(1, '#FFD35C');
    ctx.globalAlpha = fill; ctx.fillStyle = g; ctx.shadowColor = '#FFD35C'; ctx.shadowBlur = 50*u; ctx.fill(gem); }
  ctx.restore();
  // shine sweeping across the jewel
  const sh = seg(ms, 1100, 1700);
  if(sh > 0 && sh < 1){ ctx.save(); ctx.translate(cx, cy); ctx.rotate(rot); ctx.scale(S, S); ctx.translate(-12, -9); ctx.clip(gem);
    const x = -4 + 32 * sh, lg = ctx.createLinearGradient(x - 3, 0, x + 3, 0); lg.addColorStop(0, 'rgba(255,255,255,0)'); lg.addColorStop(0.5, 'rgba(255,255,255,0.9)'); lg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = lg; ctx.fillRect(-2, -2, 30, 22); ctx.restore(); }
  // sparkles bursting out of the jewel
  const sp = seg(ms, 700, 1900);
  if(sp > 0 && sp < 1){ for(let i = 0; i < 26; i++){ const a = R()*Math.PI*2, d = (140 + R()*360) * u * easeOut(sp), s2 = (6 + R()*14) * u * (1 - sp);
    ctx.save(); ctx.translate(cx + Math.cos(a)*d, cy + Math.sin(a)*d); ctx.rotate(a); ctx.fillStyle = R() < 0.5 ? '#FFD35C' : '#C09EFF'; ctx.globalAlpha = 1 - sp;
    ctx.beginPath(); ctx.moveTo(0, -s2); ctx.lineTo(s2*0.3, 0); ctx.lineTo(0, s2); ctx.lineTo(-s2*0.3, 0); ctx.closePath(); ctx.fill(); ctx.restore(); } }
  // wordmark: letters drop in one by one
  const word = 'DEGENCARDS'; ctx.font = `900 ${100*u}px ${SANS}`; ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
  const total = ctx.measureText(word).width; let x = cx - total/2; const by = cy + 360*u;
  [...word].forEach((ch, i) => { const lk = easeOutBack(seg(ms, 900 + i*55, 1200 + i*55)), cw = ctx.measureText(ch).width;
    ctx.save(); ctx.globalAlpha = clamp01(lk); ctx.translate(x + cw/2, by + (1 - lk) * 60*u); ctx.fillStyle = i < 5 ? '#FFFFFF' : '#C09EFF'; ctx.textAlign = 'center'; ctx.fillText(ch, 0, 0); ctx.restore(); x += cw; });
  const ta = easeOut(seg(ms, 1600, 2000));
  ctx.save(); ctx.globalAlpha = ta; ctx.textAlign = 'center';
  ctx.font = `700 ${40*u}px ${SANS}`; ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.fillText(L.tag, cx, by + 90*u);
  ctx.font = `800 ${32*u}px ${MONO}`; const url = 'degencards.vercel.app', uw = ctx.measureText(url).width + 60*u;
  rrect(ctx, cx - uw/2, by + 150*u, uw, 70*u, 35*u); ctx.fillStyle = 'rgba(192,158,255,0.16)'; ctx.fill(); ctx.lineWidth = 2*u; ctx.strokeStyle = 'rgba(192,158,255,0.6)'; ctx.stroke();
  ctx.fillStyle = '#fff'; ctx.textBaseline = 'middle'; ctx.fillText(url, cx, by + 186*u); ctx.restore(); ctx.textBaseline = 'alphabetic';
  if(k < 0.04){ ctx.fillStyle = `rgba(0,0,0,${1 - k/0.04})`; ctx.fillRect(0,0,W,H); }
}

/* ---------- sound: synthesized, scheduled on the same timeline as the frames ---------- */
function soundtrack(ac, out, t0, t, opt){
  configure(opt);
  if(!available(t) || O.sound === 'off') return;
  const hype = O.sound === 'hype', chill = O.sound === 'chill', minimal = O.sound === 'minimal';
  const KV = hype ? 1 : chill ? 0 : 0, IV = hype ? 1 : chill ? 0.35 : 0;   // kick / impact levels per sound style
  const P = prep(t), win = t.pnl >= 0, S = ms => t0 + ms / 1000;
  const master = ac.createGain(); master.gain.value = 0.9;
  const comp = ac.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 6;
  master.connect(comp); comp.connect(out);
  const noiseBuf = (() => { const b = ac.createBuffer(1, ac.sampleRate, ac.sampleRate), d = b.getChannelData(0), R = rng(99); for(let i = 0; i < d.length; i++) d[i] = R()*2 - 1; return b; })();
  const env = (g, at, a, d, peak) => { g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(peak, at + a); g.gain.exponentialRampToValueAtTime(0.0001, at + a + d); };
  const tone = (at, f0, f1, dur, type, vol) => { const o = ac.createOscillator(), g = ac.createGain(); o.type = type; o.frequency.setValueAtTime(f0, at); if(f1) o.frequency.exponentialRampToValueAtTime(f1, at + dur); env(g, at, 0.004, dur, vol); o.connect(g); g.connect(master); o.start(at); o.stop(at + dur + 0.05); };
  const noise = (at, dur, fA, fB, vol, q = 1) => { const n = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain(); n.buffer = noiseBuf; n.loop = true; f.type = 'bandpass'; f.Q.value = q;
    f.frequency.setValueAtTime(fA, at); f.frequency.exponentialRampToValueAtTime(fB, at + dur); env(g, at, dur * 0.8, dur * 0.2 + 0.05, vol); n.connect(f); f.connect(g); g.connect(master); n.start(at); n.stop(at + dur + 0.1); };
  const kick = (at, vol) => { if(KV * vol > 0.001) tone(at, 150, 42, 0.28, 'sine', vol * KV); };
  const impact = (at, vol) => { if(IV * vol < 0.001) return; tone(at, 110, 30, 0.7, 'sine', vol * IV); noise(at, 0.25, 3000, 400, vol * IV * 0.5, 0.6); };
  const pad = (at, dur, f, vol) => { [f, f * 1.5, f * 2].forEach(x => tone(at, x, 0, dur, 'sine', vol)); };   // soft chord for the chill style
  // intro: white hit + slam, word blips, kick on the beat
  if(O.intro === 'hook'){ impact(S(90), 0.9); if(!minimal) [420, 720, 1020].forEach((m, i) => tone(S(m), 660 + i*220, 0, 0.09, 'square', chill ? 0.04 : 0.08)); }
  if(EXT.intros[O.intro] && EXT.intros[O.intro].sound) EXT.intros[O.intro].sound({ S, tone, impact, pad, minimal, chill });
  for(let m = 0; m < O_WARP; m += 400) kick(S(m), 0.55);
  if(chill && T_INTRO > 0) pad(S(0), T_INTRO / 1000, 262, 0.04);
  // warp: riser + impact on the flash
  if(T_WARP > 0 && !minimal){ noise(S(O_WARP - 250), 1.0, 300, 7000, chill ? 0.12 : 0.35, 0.8); impact(S(O_WARP + T_WARP * 0.82), 0.8); }
  // replay: soft pulse + one tick per finished candle (higher when it closes up, lower when down)
  for(let m = O_REPLAY; m < O_OUTRO; m += 500) kick(S(m), 0.22);
  if(chill) for(let m = O_REPLAY; m < O_OUTRO; m += 2000) pad(S(m), 1.9, [220, 247, 196, 262][(m / 2000 | 0) % 4], 0.025);
  let last = -1;
  for(let i = 0; i < P.n; i++){ const m = O_REPLAY + revealTimeOf(P, i); if(m - last < 70) continue; last = m;
    const upc = P.cs[i][4] >= P.cs[i][1]; tone(S(m), upc ? 1320 : 740, upc ? 1500 : 620, 0.05, 'triangle', 0.07); }
  // BUY: lock-on beeps + bass
  const tb = O_REPLAY + revealTimeOf(P, P.ib), ts = O_REPLAY + revealTimeOf(P, P.is);
  const bv = chill ? 0.05 : 0.09;
  [0, 110, 220].forEach((d, i) => tone(S(tb - 200 + d), 880 + i*220, 0, 0.07, chill ? 'sine' : 'square', bv)); impact(S(tb + 80), 0.6); if(hype) tone(S(tb + 80), 220, 440, 0.35, 'sawtooth', 0.05);
  // milestones: short riser into a hit + a rising stab (higher for each new level, down-sweep for losses)
  milesOf(P).forEach((m, k) => { const at = O_REPLAY + m.at;
    if(!minimal) noise(S(at - 280), 0.3, 800, 6000, chill ? 0.06 : 0.16, 0.9);
    impact(S(at), 0.7);
    if(m.up) [0, 70, 140].forEach((d, j) => tone(S(at + d), 523 * Math.pow(1.26, k + j), 0, 0.18, chill ? 'sine' : 'square', chill ? 0.05 : 0.08));
    else tone(S(at), 520, 130, 0.5, 'sawtooth', 0.07); });
  // SELL: lock-on, then cash chime (win) or down-sweep (loss) + boom
  [0, 110, 220].forEach((d, i) => tone(S(ts - 200 + d), 1100 + i*220, 0, 0.07, chill ? 'sine' : 'square', bv));
  const burst = ts + 500;
  impact(S(burst), 0.9);
  if(win){ [1318, 1760, 2637, 3520].forEach((f, i) => tone(S(burst + 40 + i*60), f, 0, 0.6, 'sine', 0.12)); noise(S(burst), 0.6, 6000, 9000, 0.12, 2); }
  else tone(S(burst), 600, 90, 0.9, 'sawtooth', 0.08);
  // what the PnL buys: cha-ching on the pill (sell burst, and recap)
  if(buyOf(t) && !minimal){ const ching = at => { tone(at, 2093, 0, 0.12, 'square', 0.05); tone(at + 0.08, 2637, 0, 0.5, 'sine', 0.1); noise(at, 0.15, 7000, 9000, 0.08, 3); };
    ching(S(burst + 330)); if(T_OUTRO > 0) ching(S(O_OUTRO + T_OUTRO * 0.3)); }
  // recap: kick back in; brand: shimmer arpeggio on the jewel + soft hit on the wordmark
  for(let m = O_OUTRO; m < O_BRAND; m += 400) kick(S(m), 0.4);
  const bk = T_BRAND / 2700;                                            // the short outro plays the same cues, faster
  [880, 1108, 1318, 1760, 2217].forEach((f, i) => tone(S(O_BRAND + (650 + i*70) * bk), f, 0, 0.9, 'sine', 0.07));
  impact(S(O_BRAND + 900 * bk), 0.45);
}

/* ---------- public ---------- */
function available(t){ return !!(t && t.chart && t.chart.v === 2 && Array.isArray(t.chart.c) && t.chart.c.length >= 3); }
function draw(ctx, W, H, t, meta, ms, opt){
  configure(opt);
  const u = W / W0, img = t.image && window.__dcImgCache ? window.__dcImgCache.get(t.image) : null, seed = (t.tradeId || 1) * 9973;
  ctx.save(); ctx.clearRect(0,0,W,H); ctx.textBaseline = 'alphabetic';
  if(ms < O_WARP){
    if(EXT.intros[O.intro]) EXT.intros[O.intro].draw(ctx, W, H, u, t, img, ms, O);
    else intro(ctx, W, H, u, t, img, ms, O, seed);
  }
  else if(ms < O_REPLAY) warp(ctx, W, H, u, t, img, ms - O_WARP, seed);
  else if(ms < O_OUTRO) replay(ctx, W, H, u, t, img, ms - O_REPLAY, O, seed);
  else if(ms < O_BRAND) outro(ctx, W, H, u, t, img, ms - O_OUTRO, O);
  else brand(ctx, W, H, u, Math.min(T_BRAND, ms - O_BRAND), seed);
  // soft vignette on every frame
  const v = ctx.createRadialGradient(W/2, H/2, W*0.5, W/2, H/2, H*0.78); v.addColorStop(0,'rgba(0,0,0,0)'); v.addColorStop(1,'rgba(0,0,0,0.5)');
  ctx.fillStyle = v; ctx.fillRect(0,0,W,H);
  ctx.restore();
}
function duration(opt){ configure(opt); return DURATION; }
function extend(fn){
  fn({ EXT, THEMES, bg: (...a) => bg(...a), coinBadge, fillCentered, glitchText, rrect, rng, seg, easeOut, easeOutBack, clamp01, hexA, money, pctS, holdS, SANS, MONO,
       get GREEN(){ return GREEN; }, get RED(){ return RED; }, get L(){ return L; }, get FX(){ return FX; }, get T_INTRO(){ return T_INTRO; } });
}
window.dcReplay = { draw, available, soundtrack, duration, extend, DEFAULTS, THEMES, W: W0, H: H0, get pro(){ return EXT.unlocked; }, get DURATION(){ return DURATION; } };
})();
