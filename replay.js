/* ============================================================================
   DEGENCARDS - Trade Replay video (9:16, 1080x1920)
   Your real candles replayed like a highlight: coin intro -> warp -> candles
   drawn live with the camera following the price, BUY reticle, live PnL,
   SELL reticle + $ burst, then a recap screen. Buy / sell only (no callouts).
   Pure canvas, deterministic: frame = f(time), so preview and export match.
   ============================================================================ */
(function(){
const W0 = 1080, H0 = 1920;
const T_INTRO = 1700, T_WARP = 850, T_REPLAY = 12500, T_OUTRO = 3200, T_BRAND = 2700;
const DURATION = T_INTRO + T_WARP + T_REPLAY + T_OUTRO + T_BRAND;     // about 21 s
const O_WARP = T_INTRO, O_REPLAY = O_WARP + T_WARP, O_OUTRO = O_REPLAY + T_REPLAY, O_BRAND = O_OUTRO + T_OUTRO;
const GEM = 'M12 2l1.8 5.2L19 9l-5.2 1.8L12 16l-1.8-5.2L5 9l5.2-1.8L12 2z';   // the DEGENCARDS jewel (same path as the site logo)
const GREEN = '#3DFFA0', UP = '#18C964', DN = '#FF3B4E', RED = '#FF5C6C';
const SANS = "'Outfit', system-ui, sans-serif", MONO = "'JetBrains Mono', ui-monospace, monospace";
const K = 22;                                                          // candles visible at once

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
  const ch = t.chart, cs = ch.c, iv = ch.i;
  const marks = (ch.m || []).slice().sort((a,b)=>a[0]-b[0]);
  const idxOf = ts => { let k = cs.findIndex(c => ts < c[0] + iv); return k < 0 ? cs.length - 1 : k; };
  const buys = marks.filter(m=>m[1]==='b'), sells = marks.filter(m=>m[1]==='s');
  const at = ts => { const c = cs[idxOf(ts)]; return (c[2]+c[3])/2; };
  const mcOf = m => (ch.src === 'pump' && m[2] > 0) ? m[2] : at(m[0]);
  const bm = buys[0] || [t.timestamp - t.holdTime*1000, 'b', t.entryMc];
  const sm = sells[sells.length-1] || [t.timestamp, 's', t.exitMc];
  const ib = idxOf(bm[0]), is = Math.max(ib, idxOf(sm[0]));
  const buyMc = mcOf(bm) || t.entryMc || 1, sellMc = mcOf(sm) || t.exitMc || buyMc;
  const size = t.roi ? Math.abs(t.pnl / (t.roi / 100)) : 0;
  // timeline: normal pace before / after, slower during the trade, a pause on BUY and on SELL
  const w = cs.map((_, i) => (i >= ib - 1 && i <= is + 1) ? 2.2 : 1);
  w[ib] += 4; w[is] += 4;
  const cum = [0]; w.forEach(x => cum.push(cum[cum.length-1] + x));
  const total = cum[cum.length-1];
  const p = { cs, iv, marks, ib, is, bm, sm, buyMc, sellMc, size, cum, total, n: cs.length };
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
  v += range * 0.12 * (Math.sin(f * 37 + ph1) * 0.6 + Math.sin(f * 83 + ph2) * 0.4) * Math.sin(Math.PI * f);   // fades to 0 at open and close
  return Math.min(hi, Math.max(lo, v));
}

/* ---------- scenes ---------- */
function bg(ctx, W, H, u, glow){
  ctx.fillStyle = '#05070A'; ctx.fillRect(0,0,W,H);
  const g = ctx.createRadialGradient(W/2, H*0.42, 0, W/2, H*0.42, H*0.7);
  g.addColorStop(0, hexA(glow, 0.10)); g.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = g; ctx.fillRect(0,0,W,H);
  ctx.fillStyle = 'rgba(255,255,255,0.07)';                            // dotted grid
  for(let y = 40*u; y < H; y += 48*u) for(let x = 24*u; x < W; x += 48*u) ctx.fillRect(x, y, 2.4*u, 2.4*u);
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
  ctx.fillStyle = '#fff'; ctx.fillText('DEGEN', 56*u, H - 70*u); const dw = ctx.measureText('DEGEN').width;
  ctx.fillStyle = '#C09EFF'; ctx.fillText('CARDS', 56*u + dw, H - 70*u);
  ctx.textAlign = 'right'; ctx.font = `700 ${26*u}px ${MONO}`; ctx.fillStyle = 'rgba(255,255,255,0.75)'; ctx.fillText('degencards.vercel.app', W - 56*u, H - 72*u);
  ctx.restore();
}

/* hook: the result slams in first (what people stop scrolling for), glitch + shake, then the words pop on the beat */
function glitchText(ctx, txt, x, y, u, col, amt){
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  if(amt > 0){ ctx.fillStyle = 'rgba(255,40,90,0.75)'; ctx.fillText(txt, x - amt*u, y); ctx.fillStyle = 'rgba(40,220,255,0.75)'; ctx.fillText(txt, x + amt*u, y); }
  ctx.restore(); ctx.fillStyle = col; ctx.fillText(txt, x, y);
}
function intro(ctx, W, H, u, t, img, ms, opt, seed){
  const win = t.pnl >= 0, col = win ? GREEN : RED, k = ms / T_INTRO, R = rng(seed + 3);
  bg(ctx, W, H, u, col);
  // beat flashes (every 400 ms, matching the kick)
  const beat = (ms % 400) / 400, flash = Math.max(0, 1 - beat * 5) * (ms < 1300 ? 1 : 0);
  // camera shake on the slam
  const shake = Math.max(0, 1 - seg(ms, 90, 520)) * 26 * u;
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
  const g = (ms < 700 && (Math.floor(ms / 70) % 3 === 0)) ? 10 : 3;  // glitch jitter while it lands
  glitchText(ctx, res, 0, 0, u, col, g); ctx.shadowBlur = 0; ctx.restore();
  // words pop one by one
  const words = [ (opt.hideUsd ? '' : pctS(t.roi) + ' ') + 'IN ' + holdS(t.holdTime).toUpperCase(), 'ON ' + tk(t.ticker), win ? 'WATCH THE TRADE' : 'WATCH IT PLAY OUT' ];
  words.forEach((w, i) => {
    const wk = easeOutBack(seg(ms, 420 + i*300, 640 + i*300)); if(wk <= 0) return;
    ctx.save(); ctx.globalAlpha = clamp01(wk); ctx.translate(W/2, H*0.55 + i*96*u); ctx.scale(wk, wk);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `900 ${(i === 2 ? 44 : 66) * u}px ${SANS}`;
    const tw = ctx.measureText(w).width + 56*u;
    if(i === 2){ rrect(ctx, -tw/2, -38*u, tw, 76*u, 38*u); ctx.fillStyle = col; ctx.fill(); ctx.fillStyle = '#05070A'; ctx.fillText(w, 0, 3*u); }
    else { ctx.fillStyle = i === 0 ? '#fff' : 'rgba(255,255,255,0.85)'; ctx.fillText(w, 0, 0); }
    ctx.restore();
  });
  ctx.restore();
  // scanlines + beat flash
  ctx.fillStyle = 'rgba(0,0,0,0.18)'; for(let y = 0; y < H; y += 6*u) ctx.fillRect(0, y, W, 2*u);
  if(flash > 0){ ctx.fillStyle = hexA(col, 0.18 * flash); ctx.fillRect(0,0,W,H); }
  if(ms < 90){ ctx.fillStyle = '#fff'; ctx.fillRect(0,0,W,H); }
}
function warp(ctx, W, H, u, t, img, ms, seed){
  const k = ms / T_WARP, R = rng(seed);
  bg(ctx, W, H, u, t.pnl >= 0 ? GREEN : RED);
  const cx = W/2, cy = H*0.45;
  ctx.save(); ctx.lineCap = 'round';
  for(let i = 0; i < 140; i++){                                       // speed lines rushing out of the center
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
  ctx.shadowBlur = 0; ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x, y, 10*u, 0, Math.PI*2); ctx.fill();
  ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y, 5*u, 0, Math.PI*2); ctx.fill();
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
  bg(ctx, W, H, u, col);
  // plot area
  const top = 330*u, bottom = H - 300*u, left = 40*u, right = W - 150*u, pw = right - left, ph = bottom - top;
  // visible window: the last K candles, the camera slides smoothly
  const head = Math.max(1, r), start = Math.max(0, head - K);
  const slot = pw / K;
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
  let lo = Infinity, hi = -Infinity;
  vis.forEach(i => { const c = cur(i); lo = Math.min(lo, c[3]); hi = Math.max(hi, c[2]); });
  if(r > P.ib){ lo = Math.min(lo, P.buyMc); hi = Math.max(hi, P.buyMc); }
  if(!isFinite(lo)){ lo = P.cs[0][3]; hi = P.cs[0][2]; }
  if(hi - lo < hi * 0.02){ hi *= 1.01; lo *= 0.99; }
  const pad = (hi - lo) * 0.18; lo -= pad; hi += pad;
  const X = i => left + (i - start) * slot + slot/2, Y = v => top + (1 - (v - lo)/(hi - lo)) * ph;
  // speed lines at the start of the replay
  const sl = 1 - seg(ms, 0, 1400);
  if(sl > 0){ const R = rng(seed + 7); ctx.save(); ctx.globalAlpha = sl * 0.5; ctx.strokeStyle = hexA(col, 0.5); ctx.lineWidth = 2*u;
    for(let i = 0; i < 40; i++){ const a = R()*Math.PI*2, d = (0.2 + R()*0.8) * H * 0.6; ctx.beginPath(); ctx.moveTo(W/2, H*0.5); ctx.lineTo(W/2 + Math.cos(a)*d, H*0.5 + Math.sin(a)*d); ctx.stroke(); } ctx.restore(); }
  // buy price guide
  if(r > P.ib + 0.3){ ctx.save(); ctx.setLineDash([10*u, 10*u]); ctx.strokeStyle = hexA(UP, 0.45); ctx.lineWidth = 2*u;
    ctx.beginPath(); ctx.moveTo(left, Y(P.buyMc)); ctx.lineTo(right, Y(P.buyMc)); ctx.stroke(); ctx.restore(); }
  // candles
  const bw = Math.max(8*u, slot * 0.62);
  ctx.save(); ctx.beginPath(); ctx.rect(left - bw, top - 40*u, pw + bw*2, ph + 80*u); ctx.clip();
  vis.forEach(i => {
    const c = cur(i), x = X(i), upc = c[4] >= c[1], cc = upc ? UP : DN;
    ctx.strokeStyle = cc; ctx.lineWidth = Math.max(3*u, bw * 0.12);
    ctx.beginPath(); ctx.moveTo(x, Y(c[2])); ctx.lineTo(x, Y(c[3])); ctx.stroke();
    const y1 = Y(Math.max(c[1], c[4])), y2 = Y(Math.min(c[1], c[4]));
    ctx.fillStyle = cc; if(i === full){ ctx.shadowColor = cc; ctx.shadowBlur = 22*u; }
    ctx.fillRect(x - bw/2, y1, bw, Math.max(3*u, y2 - y1)); ctx.shadowBlur = 0;
  });
  // fills that already happened: small ringed dots
  P.marks.forEach(m => {
    const i = P.cs.findIndex(c => m[0] < c[0] + P.iv); const ii = i < 0 ? P.n - 1 : i;
    if(r < ii + 0.99) return;
    const mc = (t.chart.src === 'pump' && m[2] > 0) ? m[2] : (P.cs[ii][2] + P.cs[ii][3]) / 2;
    const x = X(ii), y = Y(mc), cc = m[1] === 'b' ? UP : DN;
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x, y, 11*u, 0, Math.PI*2); ctx.fill();
    ctx.lineWidth = 5*u; ctx.strokeStyle = cc; ctx.stroke();
  });
  ctx.restore();
  // live price line + multiplier vs buy
  const last = cur(Math.min(P.n - 1, full)), nowMc = last[4];
  if(r > P.ib + 0.5){
    const y = Y(nowMc), mult = nowMc / P.buyMc;
    ctx.save(); ctx.setLineDash([6*u, 8*u]); ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 2*u;
    ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(right + 10*u, y); ctx.stroke(); ctx.restore();
    ctx.font = `800 ${30*u}px ${MONO}`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillStyle = mult >= 1 ? GREEN : RED; ctx.fillText(mult.toFixed(2)+'x', right + 18*u, y); ctx.textBaseline = 'alphabetic';
  }
  // header: coin + ticker (left), LIVE PNL + INVESTED (right)
  coinBadge(ctx, img, 56*u, 90*u, 84*u, u);
  ctx.textAlign = 'left'; ctx.font = `900 ${44*u}px ${SANS}`; ctx.fillStyle = '#fff'; ctx.fillText(tk(t.ticker), 160*u, 146*u);
  const holding = r > P.ib + 0.5 && r < P.is + 0.99;
  const closed = r >= P.is + 0.99;
  let live = 0;
  if(holding) live = P.size * (nowMc / P.buyMc - 1);
  if(closed) live = t.pnl;
  if(r > P.ib + 0.5){
    ctx.textAlign = 'right'; ctx.font = `700 ${24*u}px ${MONO}`; ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fillText(closed ? 'PNL' : 'LIVE PNL', W - 56*u, 108*u);
    ctx.font = `900 ${64*u}px ${MONO}`; ctx.fillStyle = live >= 0 ? GREEN : RED; ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = 20*u;
    ctx.fillText(opt.hideUsd ? pctS(P.size ? live / P.size * 100 : 0) : money(live), W - 56*u, 170*u); ctx.shadowBlur = 0;
    if(!opt.hideUsd){ ctx.font = `700 ${24*u}px ${MONO}`; ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.fillText('INVESTED', W - 56*u, 214*u);
      ctx.font = `800 ${34*u}px ${MONO}`; ctx.fillStyle = '#fff'; ctx.fillText(plain(P.size), W - 56*u, 254*u); }
  }
  // elapsed since the buy
  if(r > P.ib + 0.5){
    const lastTs = P.cs[Math.min(P.n-1, full)][0] + P.iv * frac;
    const el = Math.max(0, Math.round((Math.min(lastTs, closed ? P.sm[0] : lastTs) - P.bm[0]) / 1000));
    ctx.textAlign = 'center'; ctx.font = `700 ${30*u}px ${MONO}`; ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fillText((closed ? 'held ' : '+') + holdS(closed ? t.holdTime : el), W/2, bottom + 80*u);
  }
  // BUY / SELL reticles
  const tb = revealTimeOf(P, P.ib), ts = revealTimeOf(P, P.is);
  const kb = seg(ms, tb - 250, tb + 900);
  if(kb > 0 && kb < 1){ const x = X(P.ib), y = Y(P.buyMc); reticle(ctx, x, y, u, UP, kb, 'BUY', opt.hideUsd ? '' : plain(P.size)); }
  const ks = seg(ms, ts - 250, ts + 900);
  if(ks > 0 && ks < 1){ const x = X(P.is), y = Y(P.sellMc); reticle(ctx, x, y, u, win ? UP : DN, ks, 'SELL', ''); }
  // SELL burst: $ particles + big result
  const kx = seg(ms, ts + 500, ts + 2300);
  if(kx > 0 && kx < 1){
    const R = rng(seed + 11), cx = W/2, cy = H*0.47;
    ctx.save(); ctx.fillStyle = `rgba(0,0,0,${0.45 * Math.sin(kx * Math.PI)})`; ctx.fillRect(0,0,W,H);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for(let i = 0; i < 90; i++){
      const a = R() * Math.PI*2, sp = 0.35 + R()*0.9, d = easeOut(kx) * sp * H * 0.55, sz = (28 + R()*44) * u;
      ctx.globalAlpha = (1 - kx) * (0.6 + R()*0.4);
      ctx.font = `900 ${sz}px ${MONO}`; ctx.fillStyle = win ? (R() < 0.8 ? GREEN : '#fff') : (R() < 0.8 ? RED : '#fff');
      ctx.fillText(win ? '$' : '\u00D7', cx + Math.cos(a)*d, cy + Math.sin(a)*d);
    }
    ctx.globalAlpha = Math.min(1, kx * 6) * (1 - seg(kx, 0.8, 1));
    const sc = 0.7 + 0.3 * easeOutBack(seg(kx, 0, 0.3));
    ctx.translate(cx, cy); ctx.scale(sc, sc);
    ctx.font = `900 ${150*u}px ${MONO}`; ctx.fillStyle = win ? GREEN : RED; ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = 50*u;
    ctx.fillText(opt.hideUsd ? pctS(t.roi) : money(t.pnl), 0, 0);
    if(!opt.hideUsd){ ctx.font = `900 ${64*u}px ${MONO}`; ctx.fillText(pctS(t.roi), 0, 120*u); }
    ctx.restore(); ctx.textBaseline = 'alphabetic';
  }
  footer(ctx, W, H, u, 1);
}

function outro(ctx, W, H, u, t, img, ms, opt){
  const P = prep(t), win = t.pnl >= 0, col = win ? GREEN : RED, k = ms / T_OUTRO;
  bg(ctx, W, H, u, col);
  const a = easeOut(seg(k, 0, 0.2));
  ctx.save(); ctx.globalAlpha = a; ctx.textAlign = 'left';
  ctx.font = `900 ${76*u}px ${SANS}`; ctx.fillStyle = '#fff'; ctx.fillText(win ? 'BAG SECURED' : 'TRADE CLOSED', 56*u, 170*u);
  coinBadge(ctx, img, 56*u, 220*u, 96*u, u);
  ctx.font = `900 ${46*u}px ${SANS}`; ctx.fillText(tk(t.ticker), 176*u, 268*u);
  ctx.font = `700 ${26*u}px ${MONO}`; ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.fillText('held ' + holdS(t.holdTime), 176*u, 306*u);
  ctx.font = `700 ${26*u}px ${MONO}`; ctx.fillText(win ? 'PROFIT' : 'RESULT', 56*u, 420*u);
  const kb = easeOutBack(seg(k, 0.08, 0.3));
  ctx.save(); ctx.translate(56*u, 520*u); ctx.scale(kb, kb);
  ctx.font = `900 ${118*u}px ${MONO}`; ctx.fillStyle = col; ctx.shadowColor = col; ctx.shadowBlur = 40*u;
  const big = opt.hideUsd ? pctS(t.roi) : money(t.pnl); ctx.fillText(big, 0, 0); const bwid = ctx.measureText(big).width; ctx.shadowBlur = 0;
  if(!opt.hideUsd){ ctx.font = `800 ${38*u}px ${MONO}`; const rt = (t.roi >= 0 ? '\u25B2 ' : '\u25BC ') + pctS(t.roi).replace('+',''), rw = ctx.measureText(rt).width + 40*u;
    rrect(ctx, bwid + 26*u, -58*u, rw, 64*u, 32*u); ctx.fillStyle = hexA(col, 0.16); ctx.fill(); ctx.fillStyle = col; ctx.fillText(rt, bwid + 46*u, -14*u); }
  ctx.restore(); ctx.restore();
  // price line of the whole window with BUY / SELL
  const top = 680*u, bottom = 1360*u, left = 56*u, right = W - 56*u;
  const closes = P.cs.map(c => c[4]); let lo = Math.min(...P.cs.map(c=>c[3])), hi = Math.max(...P.cs.map(c=>c[2])); const pd = (hi-lo)*0.15 || hi*0.05; lo -= pd; hi += pd;
  const X = i => left + (i / Math.max(1, P.n - 1)) * (right - left), Y = v => top + (1 - (v - lo)/(hi - lo)) * (bottom - top);
  const draw = easeInOut(seg(k, 0.12, 0.6)), upto = Math.max(1, Math.floor(draw * (P.n - 1)));
  ctx.save();
  const grad = ctx.createLinearGradient(0, top, 0, bottom); grad.addColorStop(0, hexA(col, 0.28)); grad.addColorStop(1, hexA(col, 0));
  ctx.beginPath(); ctx.moveTo(X(0), Y(closes[0])); for(let i = 1; i <= upto; i++) ctx.lineTo(X(i), Y(closes[i]));
  ctx.lineTo(X(upto), bottom); ctx.lineTo(X(0), bottom); ctx.closePath(); ctx.fillStyle = grad; ctx.fill();
  ctx.beginPath(); ctx.moveTo(X(0), Y(closes[0])); for(let i = 1; i <= upto; i++) ctx.lineTo(X(i), Y(closes[i]));
  ctx.strokeStyle = col; ctx.lineWidth = 6*u; ctx.lineJoin = 'round'; ctx.shadowColor = col; ctx.shadowBlur = 24*u; ctx.stroke(); ctx.shadowBlur = 0;
  [[P.ib, P.buyMc, 'BUY', UP], [P.is, P.sellMc, 'SELL', win ? UP : DN]].forEach(([i, mc, lab, cc]) => {
    if(i > upto) return;
    const x = X(i), y = Y(mc);
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x, y, 12*u, 0, Math.PI*2); ctx.fill(); ctx.lineWidth = 6*u; ctx.strokeStyle = cc; ctx.stroke();
    ctx.font = `800 ${26*u}px ${MONO}`; const lw = ctx.measureText(lab).width + 28*u, ly = lab === 'BUY' ? y + 50*u : y - 50*u;
    rrect(ctx, x - lw/2, ly - 22*u, lw, 44*u, 22*u); ctx.fillStyle = 'rgba(5,7,10,0.9)'; ctx.fill(); ctx.lineWidth = 2*u; ctx.strokeStyle = hexA(cc, 0.8); ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(lab, x, ly + 1*u); ctx.textBaseline = 'alphabetic';
  });
  ctx.restore();
  // stats
  const sa = easeOut(seg(k, 0.45, 0.65));
  ctx.save(); ctx.globalAlpha = sa; ctx.textAlign = 'left';
  const stats = [[opt.hideUsd ? '\u2014' : plain(P.size), 'Invested'], [mcS(P.buyMc), 'Entry MC'], [mcS(P.sellMc), 'Exit MC']];
  stats.forEach(([v, l], i) => { const x = 56*u + i * 330*u;
    ctx.font = `900 ${50*u}px ${MONO}`; ctx.fillStyle = '#fff'; ctx.fillText(v, x, 1500*u);
    ctx.font = `600 ${26*u}px ${SANS}`; ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.fillText(l, x, 1545*u); });
  ctx.restore();
  footer(ctx, W, H, u, a);
}

function brand(ctx, W, H, u, ms, seed){
  const k = ms / T_BRAND, cx = W/2, cy = H*0.42, R = rng(seed + 21);
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
  const word = 'DEGENCARDS'; ctx.font = `900 ${118*u}px ${SANS}`; ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
  const total = ctx.measureText(word).width; let x = cx - total/2; const by = cy + 360*u;
  [...word].forEach((ch, i) => { const lk = easeOutBack(seg(ms, 900 + i*55, 1200 + i*55)), cw = ctx.measureText(ch).width;
    ctx.save(); ctx.globalAlpha = clamp01(lk); ctx.translate(x + cw/2, by + (1 - lk) * 60*u); ctx.fillStyle = i < 5 ? '#FFFFFF' : '#C09EFF'; ctx.textAlign = 'center'; ctx.fillText(ch, 0, 0); ctx.restore(); x += cw; });
  const ta = easeOut(seg(ms, 1600, 2000));
  ctx.save(); ctx.globalAlpha = ta; ctx.textAlign = 'center';
  ctx.font = `700 ${40*u}px ${SANS}`; ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.fillText('Your trades. Turned into cards.', cx, by + 90*u);
  ctx.font = `800 ${32*u}px ${MONO}`; const url = 'degencards.vercel.app', uw = ctx.measureText(url).width + 60*u;
  rrect(ctx, cx - uw/2, by + 150*u, uw, 70*u, 35*u); ctx.fillStyle = 'rgba(192,158,255,0.16)'; ctx.fill(); ctx.lineWidth = 2*u; ctx.strokeStyle = 'rgba(192,158,255,0.6)'; ctx.stroke();
  ctx.fillStyle = '#fff'; ctx.textBaseline = 'middle'; ctx.fillText(url, cx, by + 186*u); ctx.restore(); ctx.textBaseline = 'alphabetic';
  if(k < 0.04){ ctx.fillStyle = `rgba(0,0,0,${1 - k/0.04})`; ctx.fillRect(0,0,W,H); }
}

/* ---------- sound: synthesized, scheduled on the same timeline as the frames ---------- */
function soundtrack(ac, out, t0, t, opt){
  if(!available(t)) return;
  const P = prep(t), win = t.pnl >= 0, S = ms => t0 + ms / 1000;
  const master = ac.createGain(); master.gain.value = 0.9;
  const comp = ac.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 6;
  master.connect(comp); comp.connect(out);
  const noiseBuf = (() => { const b = ac.createBuffer(1, ac.sampleRate, ac.sampleRate), d = b.getChannelData(0), R = rng(99); for(let i = 0; i < d.length; i++) d[i] = R()*2 - 1; return b; })();
  const env = (g, at, a, d, peak) => { g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(peak, at + a); g.gain.exponentialRampToValueAtTime(0.0001, at + a + d); };
  const tone = (at, f0, f1, dur, type, vol) => { const o = ac.createOscillator(), g = ac.createGain(); o.type = type; o.frequency.setValueAtTime(f0, at); if(f1) o.frequency.exponentialRampToValueAtTime(f1, at + dur); env(g, at, 0.004, dur, vol); o.connect(g); g.connect(master); o.start(at); o.stop(at + dur + 0.05); };
  const noise = (at, dur, fA, fB, vol, q = 1) => { const n = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain(); n.buffer = noiseBuf; n.loop = true; f.type = 'bandpass'; f.Q.value = q;
    f.frequency.setValueAtTime(fA, at); f.frequency.exponentialRampToValueAtTime(fB, at + dur); env(g, at, dur * 0.8, dur * 0.2 + 0.05, vol); n.connect(f); f.connect(g); g.connect(master); n.start(at); n.stop(at + dur + 0.1); };
  const kick = (at, vol) => tone(at, 150, 42, 0.28, 'sine', vol);
  const impact = (at, vol) => { tone(at, 110, 30, 0.7, 'sine', vol); noise(at, 0.25, 3000, 400, vol * 0.5, 0.6); };
  // intro: white hit + slam, word blips, kick on the beat
  impact(S(90), 0.9);
  [420, 720, 1020].forEach((m, i) => tone(S(m), 660 + i*220, 0, 0.09, 'square', 0.08));
  for(let m = 0; m < O_WARP; m += 400) kick(S(m), 0.55);
  // warp: riser + impact on the flash
  noise(S(O_WARP - 250), 1.0, 300, 7000, 0.35, 0.8); impact(S(O_WARP + T_WARP * 0.82), 0.8);
  // replay: soft pulse + one tick per finished candle (higher when it closes up, lower when down)
  for(let m = O_REPLAY; m < O_OUTRO; m += 500) kick(S(m), 0.22);
  let last = -1;
  for(let i = 0; i < P.n; i++){ const m = O_REPLAY + revealTimeOf(P, i); if(m - last < 70) continue; last = m;
    const upc = P.cs[i][4] >= P.cs[i][1]; tone(S(m), upc ? 1320 : 740, upc ? 1500 : 620, 0.05, 'triangle', 0.07); }
  // BUY: lock-on beeps + bass
  const tb = O_REPLAY + revealTimeOf(P, P.ib), ts = O_REPLAY + revealTimeOf(P, P.is);
  [0, 110, 220].forEach((d, i) => tone(S(tb - 200 + d), 880 + i*220, 0, 0.07, 'square', 0.09)); impact(S(tb + 80), 0.6); tone(S(tb + 80), 220, 440, 0.35, 'sawtooth', 0.05);
  // SELL: lock-on, then cash chime (win) or down-sweep (loss) + boom
  [0, 110, 220].forEach((d, i) => tone(S(ts - 200 + d), 1100 + i*220, 0, 0.07, 'square', 0.09));
  const burst = ts + 500;
  impact(S(burst), 0.9);
  if(win){ [1318, 1760, 2637, 3520].forEach((f, i) => tone(S(burst + 40 + i*60), f, 0, 0.6, 'sine', 0.12)); noise(S(burst), 0.6, 6000, 9000, 0.12, 2); }
  else tone(S(burst), 600, 90, 0.9, 'sawtooth', 0.08);
  // recap: kick back in; brand: shimmer arpeggio on the jewel + soft hit on the wordmark
  for(let m = O_OUTRO; m < O_BRAND; m += 400) kick(S(m), 0.4);
  [880, 1108, 1318, 1760, 2217].forEach((f, i) => tone(S(O_BRAND + 650 + i*70), f, 0, 0.9, 'sine', 0.07));
  impact(S(O_BRAND + 900), 0.45);
}

/* ---------- public ---------- */
function available(t){ return !!(t && t.chart && t.chart.v === 2 && Array.isArray(t.chart.c) && t.chart.c.length >= 3); }
function draw(ctx, W, H, t, meta, ms, opt){
  const u = W / W0, img = t.image && window.__dcImgCache ? window.__dcImgCache.get(t.image) : null, seed = (t.tradeId || 1) * 9973;
  ctx.save(); ctx.clearRect(0,0,W,H); ctx.textBaseline = 'alphabetic';
  if(ms < O_WARP) intro(ctx, W, H, u, t, img, ms, opt, seed);
  else if(ms < O_REPLAY) warp(ctx, W, H, u, t, img, ms - O_WARP, seed);
  else if(ms < O_OUTRO) replay(ctx, W, H, u, t, img, ms - O_REPLAY, opt, seed);
  else if(ms < O_BRAND) outro(ctx, W, H, u, t, img, ms - O_OUTRO, opt);
  else brand(ctx, W, H, u, Math.min(T_BRAND, ms - O_BRAND), seed);
  // soft vignette on every frame
  const v = ctx.createRadialGradient(W/2, H/2, W*0.5, W/2, H/2, H*0.78); v.addColorStop(0,'rgba(0,0,0,0)'); v.addColorStop(1,'rgba(0,0,0,0.5)');
  ctx.fillStyle = v; ctx.fillRect(0,0,W,H);
  ctx.restore();
}
window.dcReplay = { draw, available, soundtrack, DURATION, W: W0, H: H0 };
})();
