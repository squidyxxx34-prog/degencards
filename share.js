/* ============================================================================
   DEGENCARDS — cinematic share
   Post (4:5, 1080×1350) or Story (9:16, 1080×1920), still PNG or 6 s animated
   video (count-up PnL, candles drawn live, B / S drop, light sweep).
   Everything is drawn on a <canvas>: no external request, works offline.
   ============================================================================ */
(function(){
const FORMATS = { post:{ w:1080, h:1350, label:'POST 4:5' }, story:{ w:1080, h:1920, label:'STORY 9:16' } };
const RARITY_HEX = { common:'#ADADB8', uncommon:'#3DFFA0', rare:'#6EC0FF', epic:'#C09EFF', legendary:'#FFD35C', mythic:'#FF5ADC' };
const GREEN = '#3DFFA0', RED = '#FF5C6C', CANDLE_UP = '#18C964', CANDLE_DN = '#FF3B4E';
const SANS = "'Outfit', system-ui, sans-serif", MONO = "'JetBrains Mono', ui-monospace, monospace";
const VIDEO_MS = 6200;

const clamp01 = v => Math.max(0, Math.min(1, v));
const seg = (p, a, b) => clamp01((p - a) / (b - a));                 // progress of p inside [a,b]
const easeOut = x => 1 - Math.pow(1 - x, 3);
const easeOutBack = x => { const c = 1.7; return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2); };
const mcShort = v => v >= 1e9 ? '$'+(v/1e9).toFixed(2)+'B' : v >= 1e6 ? '$'+(v/1e6).toFixed(2)+'M' : v >= 1e3 ? '$'+(v/1e3).toFixed(1)+'K' : '$'+Math.round(v||0);
const hexA = (hex, a) => { const n = parseInt(hex.slice(1),16); return `rgba(${n>>16&255},${n>>8&255},${n&255},${a})`; };

const IMG_CACHE = new Map();
function loadCoinImage(url){                                         // CORS-clean (our bucket sends ACAO *), so the canvas can still be exported
  if(!url) return Promise.resolve(null);
  if(IMG_CACHE.has(url)){ const im = IMG_CACHE.get(url); return im.complete ? Promise.resolve(im) : new Promise(r => { im.addEventListener('load', () => r(im)); im.addEventListener('error', () => r(null)); }); }
  const im = new Image(); im.crossOrigin = 'anonymous'; im.decoding = 'async'; IMG_CACHE.set(url, im);
  return new Promise(r => { im.onload = () => r(im); im.onerror = () => { IMG_CACHE.delete(url); r(null); }; im.src = url; });
}
let grain = null;
function grainPattern(ctx){
  if(grain) return ctx.createPattern(grain, 'repeat');
  grain = document.createElement('canvas'); grain.width = grain.height = 160;
  const g = grain.getContext('2d'), img = g.createImageData(160,160);
  for(let i=0;i<img.data.length;i+=4){ const v = Math.random()*255|0; img.data[i]=img.data[i+1]=img.data[i+2]=v; img.data[i+3]=14; }
  g.putImageData(img,0,0);
  return ctx.createPattern(grain, 'repeat');
}
function rrect(ctx, x, y, w, h, r){ ctx.beginPath(); ctx.moveTo(x+r,y); ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r); ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r); ctx.closePath(); }
function fitFont(ctx, text, weight, family, maxSize, maxW){ let s = maxSize; do { ctx.font = `${weight} ${s}px ${family}`; s -= 4; } while(ctx.measureText(text).width > maxW && s > 20); return s + 4; }

/* ---------- one frame; p = animation progress 0..1 (1 = final still) ---------- */
function drawFrame(ctx, W, H, t, meta, p, opt){
  const win = t.pnl >= 0, main = win ? GREEN : RED, rar = RARITY_HEX[meta.rarity] || '#ADADB8';
  const story = H / W > 1.5, u = W / 1080, inner = !!opt.inner;      // u = unit scale; 9:16 = full-size card, as before
  ctx.save();
  if(!inner) ctx.clearRect(0,0,W,H);

  // cinematic intro: fade from black + slow push-in
  const intro = easeOut(seg(p, 0, 0.05));
  const zoom = 1.06 - 0.06 * easeOut(seg(p, 0, 0.5));
  if(!inner){ ctx.fillStyle = '#050507'; ctx.fillRect(0,0,W,H); }
  ctx.translate(W/2, H/2); ctx.scale(zoom, zoom); ctx.translate(-W/2, -H/2);

  // background glows (rarity + result)
  if(!inner){
  let g = ctx.createRadialGradient(W*0.2, H*0.12, 0, W*0.2, H*0.12, W*1.0);
  g.addColorStop(0, hexA(rar, 0.30)); g.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = g; ctx.fillRect(0,0,W,H);
  g = ctx.createRadialGradient(W*0.85, H*0.62, 0, W*0.85, H*0.62, W*0.95);
  g.addColorStop(0, hexA(main, 0.20)); g.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = g; ctx.fillRect(0,0,W,H);
  // terminal grid
  ctx.strokeStyle = 'rgba(255,255,255,0.035)'; ctx.lineWidth = 1;
  for(let x=0; x<W; x+=60*u){ ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,H); ctx.stroke(); }
  for(let y=0; y<H; y+=60*u){ ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke(); }
  }

  // card frame
  const M = 56*u, cx = M, cy = story ? 150*u : M, cw = W - 2*M, chh = H - cy - (story ? 190*u : M);
  ctx.save();
  rrect(ctx, cx, cy, cw, chh, 44*u);
  ctx.fillStyle = 'rgba(14,14,20,0.82)'; ctx.fill();
  ctx.lineWidth = 4*u; ctx.strokeStyle = hexA(main, 0.55); ctx.shadowColor = hexA(main, 0.6); ctx.shadowBlur = 40*u; ctx.stroke();
  ctx.restore();

  const P = cx + 60*u, R = cx + cw - 60*u, midX = W/2;
  let y = cy + 96*u;

  // header: brand + rarity / grade
  const a1 = easeOut(seg(p, 0.02, 0.1));
  ctx.globalAlpha = a1;
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  ctx.font = `900 ${40*u}px ${SANS}`; ctx.fillStyle = '#FFFFFF'; ctx.fillText('DEGEN', P, y);
  const dw = ctx.measureText('DEGEN').width; ctx.fillStyle = '#C09EFF'; ctx.fillText('CARDS', P + dw, y);
  ctx.font = `600 ${26*u}px ${MONO}`; ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.fillText('#' + String(t.tradeId).padStart(4,'0') + (t.source==='wallet' ? '  ·  ON-CHAIN' : ''), P, y + 44*u);
  // grade box
  const gs = 92*u, gx = R - gs, gy = y - 66*u;
  rrect(ctx, gx, gy, gs, gs, 22*u); ctx.fillStyle = hexA(rar, 0.14); ctx.fill(); ctx.lineWidth = 3*u; ctx.strokeStyle = rar; ctx.stroke();
  ctx.textAlign = 'center'; ctx.fillStyle = rar; ctx.font = `900 ${56*u}px ${SANS}`; ctx.fillText(meta.grade, gx + gs/2, gy + gs/2 + 20*u);
  // rarity pill
  ctx.font = `800 ${24*u}px ${SANS}`; const rt = meta.rarity.toUpperCase(), rw = ctx.measureText(rt).width + 40*u;
  rrect(ctx, gx - rw - 18*u, gy + gs/2 - 24*u, rw, 48*u, 24*u); ctx.fillStyle = hexA(rar, 0.16); ctx.fill();
  ctx.fillStyle = rar; ctx.fillText(rt, gx - rw/2 - 18*u, gy + gs/2 + 9*u);
  ctx.globalAlpha = 1;

  // coin image (as-is, rounded square) + ticker; the space it takes is given back by the chart below
  const img = t.image ? IMG_CACHE.get(t.image) : null;
  const hasImg = !!(img && img.complete && img.naturalWidth);
  let extra = 0;
  if(hasImg){
    const s = (story ? 170 : 128)*u, ix = midX - s/2, iy = y + 28*u;
    const k = easeOutBack(seg(p, 0.02, 0.14));
    ctx.save(); ctx.globalAlpha = clamp01(k);
    ctx.translate(midX, iy + s/2); ctx.scale(k, k); ctx.translate(-midX, -(iy + s/2));
    ctx.shadowColor = hexA(main, 0.5); ctx.shadowBlur = 40*u;
    rrect(ctx, ix, iy, s, s, s*0.26); ctx.fillStyle = '#0B0B10'; ctx.fill(); ctx.shadowBlur = 0;
    ctx.save(); rrect(ctx, ix, iy, s, s, s*0.26); ctx.clip();
    const r = Math.min(s / img.naturalWidth, s / img.naturalHeight), dw = img.naturalWidth*r, dh = img.naturalHeight*r;   // contain: never cropped
    ctx.drawImage(img, ix + (s-dw)/2, iy + (s-dh)/2, dw, dh);
    ctx.restore();
    rrect(ctx, ix, iy, s, s, s*0.26); ctx.lineWidth = 3*u; ctx.strokeStyle = 'rgba(255,255,255,0.2)'; ctx.stroke();
    ctx.restore();
    const tickerY = iy + s + 104*u;
    extra = tickerY - (y + (story ? 230 : 175)*u);
    y = tickerY;
  } else y += story ? 230*u : 175*u;
  const a2 = easeOut(seg(p, 0.03, 0.13));
  ctx.globalAlpha = a2; ctx.textAlign = 'center';
  const tick = tk(t.ticker);
  fitFont(ctx, tick, 900, SANS, 110*u, cw - 120*u);
  ctx.fillStyle = '#FFFFFF'; ctx.shadowColor = 'rgba(255,255,255,0.25)'; ctx.shadowBlur = 30*u;
  ctx.fillText(tick, midX, y + (1-a2)*30*u); ctx.shadowBlur = 0;

  // PnL (count-up) + ROI
  y += story ? 200*u : 165*u;
  const cnt = easeOut(seg(p, 0.06, 0.5));
  const pnlNow = t.pnl * cnt, roiNow = t.roi * cnt;
  const big = opt.hideUsd ? fmt.pct(roiNow) : fmt.usd(pnlNow);
  ctx.globalAlpha = clamp01(seg(p, 0.05, 0.1));
  fitFont(ctx, opt.hideUsd ? fmt.pct(t.roi) : fmt.usd(t.pnl), 800, MONO, (story ? 190 : 170)*u, cw - 120*u);
  ctx.fillStyle = main; ctx.shadowColor = hexA(main, 0.75); ctx.shadowBlur = 60*u;
  ctx.fillText(big, midX, y); ctx.shadowBlur = 0;
  if(!opt.hideUsd){
    y += 88*u;
    ctx.font = `800 ${50*u}px ${MONO}`; const rtx = fmt.pct(roiNow), rwid = ctx.measureText(fmt.pct(t.roi)).width + 56*u;
    rrect(ctx, midX - rwid/2, y - 48*u, rwid, 68*u, 34*u); ctx.fillStyle = hexA(main, 0.14); ctx.fill();
    ctx.fillStyle = main; ctx.fillText(rtx, midX, y + 3*u);
  }
  ctx.globalAlpha = 1;

  // chart panel
  y += story ? 110*u : 70*u;
  const chH = (story ? 520*u : 330*u) - extra, chX = P, chW = R - P;
  const a3 = easeOut(seg(p, 0.12, 0.24));
  ctx.globalAlpha = a3;
  rrect(ctx, chX, y, chW, chH, 26*u); ctx.fillStyle = 'rgba(255,255,255,0.03)'; ctx.fill();
  ctx.lineWidth = 2*u; ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.stroke();
  drawChart(ctx, t, chX + 26*u, y + 70*u, chW - 52*u, chH - 100*u, p, u, opt);
  ctx.globalAlpha = 1;
  y += chH;

  // stats
  y += story ? 120*u : 92*u;
  const a4 = easeOut(seg(p, 0.5, 0.64));
  ctx.globalAlpha = a4;
  const stats = [['ENTRY', mcShort(t.entryMc)], ['EXIT', mcShort(t.exitMc)], ['HOLD', fmt.hold(t.holdTime)]];
  const colW = chW / 3;
  stats.forEach(([l, v], i) => {
    const x = P + colW*i + colW/2;
    ctx.textAlign = 'center';
    ctx.font = `700 ${24*u}px ${SANS}`; ctx.fillStyle = 'rgba(255,255,255,0.45)'; ctx.fillText(l, x, y - 44*u + (1-a4)*20*u);
    ctx.font = `800 ${46*u}px ${MONO}`; ctx.fillStyle = '#FFFFFF'; ctx.fillText(v, x, y + 8*u + (1-a4)*20*u);
  });
  // achievements
  const ach = meta.achievements.slice(0, story ? 3 : 2).map(a => a.name);
  if(ach.length){
    y += story ? 110*u : 88*u;
    ctx.font = `800 ${26*u}px ${SANS}`;
    const pads = ach.map(n => ctx.measureText(n).width + 44*u), tot = pads.reduce((s,w)=>s+w,0) + 16*u*(ach.length-1);
    let x = midX - tot/2;
    ach.forEach((n, i) => {
      const k = easeOutBack(seg(p, 0.6 + i*0.04, 0.72 + i*0.04));
      ctx.save(); ctx.globalAlpha = clamp01(k);
      ctx.translate(x + pads[i]/2, y); ctx.scale(k, k);
      rrect(ctx, -pads[i]/2, -34*u, pads[i], 52*u, 26*u); ctx.fillStyle = 'rgba(255,211,92,0.12)'; ctx.fill();
      ctx.lineWidth = 2*u; ctx.strokeStyle = 'rgba(255,211,92,0.5)'; ctx.stroke();
      ctx.fillStyle = '#FFD35C'; ctx.textAlign = 'center'; ctx.fillText(n, 0, 1*u);
      ctx.restore();
      x += pads[i] + 16*u;
    });
  }
  ctx.globalAlpha = 1;

  // footer (inside card)
  const a5 = easeOut(seg(p, 0.68, 0.8));
  ctx.globalAlpha = a5; ctx.textAlign = 'left';
  ctx.font = `600 ${24*u}px ${MONO}`; ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.fillText(fmt.date(t.timestamp).toUpperCase(), P, cy + chh - 48*u);
  ctx.textAlign = 'right'; ctx.fillStyle = 'rgba(255,255,255,0.75)'; ctx.font = `700 ${24*u}px ${SANS}`;
  ctx.fillText('degencards.vercel.app', R, cy + chh - 48*u);
  ctx.globalAlpha = 1;

  // story extras: big CTA under the card
  if(story){
    ctx.globalAlpha = a5; ctx.textAlign = 'center';
    ctx.font = `800 ${38*u}px ${SANS}`; ctx.fillStyle = '#FFFFFF'; ctx.fillText('Turn your trades into cards', midX, H - 100*u);
    ctx.font = `600 ${28*u}px ${MONO}`; ctx.fillStyle = '#C09EFF'; ctx.fillText('DEGENCARDS', midX, H - 56*u);
    ctx.globalAlpha = 1;
  }

  // light sweep across the card at the end
  const sw = seg(p, 0.84, 0.97);
  if(sw > 0 && sw < 1){
    ctx.save(); rrect(ctx, cx, cy, cw, chh, 44*u); ctx.clip();
    const sx = cx - cw*0.5 + (cw*2) * easeOut(sw);
    const lg = ctx.createLinearGradient(sx - 160*u, 0, sx + 160*u, 0);
    lg.addColorStop(0, 'rgba(255,255,255,0)'); lg.addColorStop(0.5, 'rgba(255,255,255,0.12)'); lg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = lg; ctx.transform(1,0,-0.35,1,0,0); ctx.fillRect(sx - 400*u, 0, 800*u, H);
    ctx.restore();
  }

  // grain + vignette + fade
  if(inner){ ctx.restore(); return; }
  ctx.setTransform(1,0,0,1,0,0);
  if(!opt.video){ ctx.fillStyle = grainPattern(ctx); ctx.fillRect(0,0,W,H); }
  const v = ctx.createRadialGradient(W/2, H/2, W*0.45, W/2, H/2, H*0.75);
  v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.55)'); ctx.fillStyle = v; ctx.fillRect(0,0,W,H);
  if(intro < 1){ ctx.fillStyle = `rgba(0,0,0,${1-intro})`; ctx.fillRect(0,0,W,H); }
  ctx.restore();
}

/* ---------- candles (progressive) + B / S pinned on top with dashed drop lines ---------- */
function drawChart(ctx, t, x, y, w, h, p, u, opt){
  const ch = t.chart && t.chart.v === 2 ? t.chart : null;
  const topZone = 70*u;
  const dotR = 22*u;                                                   // fill rounds: one fixed, readable size                                              // markers row lives above the chart area (y - 70u)
  const drawP = easeOut(seg(p, 0.16, 0.66));
  let X, Y, marks;
  if(ch){
    const cs = ch.c, iv = ch.i;
    const x0 = ch.w ? ch.w[0] : cs[0][0], x1 = ch.w ? ch.w[1] : cs[cs.length-1][0] + iv;
    const ys = false ? [...ch.pts.map(q=>q[1]), ...(ch.m||[]).map(m=>m[2]).filter(v=>v>0)] : [...cs.map(c=>c[3]), ...cs.map(c=>c[2])];
    let y0 = Math.min(...ys), y1 = Math.max(...ys);
    if(y1 - y0 < 1e-9){ y0 *= 0.95; y1 = y1*1.05 + 1; }
    const pad = (y1-y0)*0.08; y0 -= pad; y1 += pad;
    X = v => x + ((v - x0)/(x1 - x0)) * w; Y = v => y + (1 - (v - y0)/(y1 - y0)) * h;
    const n =  Math.ceil(cs.length * drawP), bw = Math.max(2*u, ((iv/(x1-x0)) * w) * 0.9);
    if(false){                                   // sparse data: a price line through the real points, drawn progressively
      const k = Math.max(1, Math.ceil(ch.pts.length * drawP));
      ctx.strokeStyle = ch.pts[ch.pts.length-1][1] >= ch.pts[0][1] ? CANDLE_UP : CANDLE_DN; ctx.lineWidth = 5*u; ctx.lineJoin = 'round';
      ctx.beginPath(); ch.pts.slice(0, k).forEach((q,i)=>{ i ? ctx.lineTo(X(q[0]), Y(q[1])) : ctx.moveTo(X(q[0]), Y(q[1])); }); ctx.stroke();
    }
    for(let i=0;i<n;i++){
      const [ts,o,hi,lo,c] = cs[i], up = c >= o, col = up ? CANDLE_UP : CANDLE_DN, cxp = X(ts + iv/2);
      ctx.strokeStyle = col; ctx.lineWidth = Math.max(1.5*u, bw*0.14);
      ctx.beginPath(); ctx.moveTo(cxp, Y(hi)); ctx.lineTo(cxp, Y(lo)); ctx.stroke();
      const top = Y(Math.max(o,c)), bot = Y(Math.min(o,c));
      ctx.fillStyle = col; ctx.fillRect(cxp - bw/2, top, bw, Math.max(2*u, bot - top));
    }
    const at = ts => { const c = cs.find(c=>ts < c[0]+iv) || cs[cs.length-1]; return (c[2]+c[3])/2; };
    marks = (ch.m || []).map(m => [m[0], m[1], m[2] > 0 ? m[2] : at(m[0])]);
    // MC scale
    ctx.font = `600 ${22*u}px ${MONO}`; ctx.fillStyle = 'rgba(255,255,255,0.4)'; ctx.textAlign = 'left';
    ctx.fillText(mcShort(y1 - pad), x, y + 4*u); ctx.fillText(mcShort(Math.max(0, y0 + pad)), x, y + h);
  } else {
    const end = t.timestamp, start = end - (t.holdTime||0)*1000, spanT = Math.max(1000, end - start);
    const x0 = start - spanT*0.15, x1 = end + spanT*0.15;
    let y0 = Math.min(t.entryMc, t.exitMc), y1 = Math.max(t.entryMc, t.exitMc); if(y1 - y0 < 1e-9){ y0 = y0*0.9 - 1; y1 = y1*1.1 + 1; }
    const pad = (y1-y0)*0.25; y0 -= pad; y1 += pad;
    X = v => x + ((v - x0)/(x1 - x0)) * w; Y = v => y + (1 - (v - y0)/(y1 - y0)) * h;
    ctx.strokeStyle = t.pnl >= 0 ? GREEN : RED; ctx.lineWidth = 5*u; ctx.setLineDash([14*u, 12*u]);
    ctx.beginPath(); ctx.moveTo(X(start), Y(t.entryMc)); ctx.lineTo(X(start) + (X(end)-X(start))*drawP, Y(t.entryMc) + (Y(t.exitMc)-Y(t.entryMc))*drawP); ctx.stroke(); ctx.setLineDash([]);
    marks = [[start,'b',t.entryMc],[end,'s',t.exitMc]];
  }
  // markers: top row, spread when close; dashed drop to the exact fill
  const pos = marks.map(([mt,k,v]) => ({ k, x: Math.min(x+w, Math.max(x, X(mt))), y: Math.min(y+h, Math.max(y, Y(v))), mx: 0 }))
    .sort((a,b)=>a.x-b.x || (a.k==='b'?-1:1));
  const gap = 64*u; pos.forEach((m,i)=>{ m.mx = m.x; if(i && m.mx - pos[i-1].mx < gap) m.mx = pos[i-1].mx + gap; });
  const over = Math.max(0, (pos.length ? pos[pos.length-1].mx : 0) - (x + w)); pos.forEach(m => m.mx -= over);
  const mr = 28*u, my = y - topZone + mr - 30*u;
  // fill rounds that would overlap are pushed apart (buy down, sell up); a leader keeps pointing at the exact fill
  pos.forEach(m => { m.dx = m.x; m.dy = m.y; });
  const minD = 2*dotR + 6*u;
  for(let pass = 0; pass < 8; pass++){ let mv = false;
    for(let a = 0; a < pos.length; a++) for(let b = a+1; b < pos.length; b++){
      const P1 = pos[a], Q = pos[b], d = Math.hypot(Q.dx-P1.dx, Q.dy-P1.dy); if(d >= minD) continue;
      const need = (minD - d)/2 + 0.5, upM = P1.k==='s' && Q.k!=='s' ? P1 : Q.k==='s' && P1.k!=='s' ? Q : (P1.y <= Q.y ? P1 : Q), dnM = upM === P1 ? Q : P1;
      upM.dy -= need; dnM.dy += need; mv = true; }
    if(!mv) break; }
  pos.forEach((m, i) => {
    const k = easeOutBack(seg(p, 0.72 + i*0.05, 0.84 + i*0.05)); if(k <= 0) return;
    const col = m.k === 'b' ? CANDLE_UP : CANDLE_DN;
    // drop line
    ctx.save(); ctx.globalAlpha = clamp01(k);
    ctx.strokeStyle = col; ctx.lineWidth = 3*u; ctx.setLineDash([10*u, 9*u]);
    ctx.beginPath(); ctx.moveTo(m.mx, my + mr); ctx.lineTo(m.mx + (m.x - m.mx)*clamp01(k), my + mr + (m.y - my - mr)*clamp01(k)); ctx.stroke(); ctx.setLineDash([]);
    // fill dot
    if(k >= 1){ const dr = dotR, fc = m.k === 'b' ? '#18C964' : '#FF3B4E';
      if(Math.hypot(m.dx - m.x, m.dy - m.y) > 3*u){ ctx.strokeStyle = fc; ctx.lineWidth = 3*u; ctx.beginPath(); ctx.moveTo(m.x, m.y); ctx.lineTo(m.dx, m.dy); ctx.stroke();
        ctx.fillStyle = fc; ctx.beginPath(); ctx.arc(m.x, m.y, 6*u, 0, Math.PI*2); ctx.fill(); }
      ctx.fillStyle = fc; ctx.beginPath(); ctx.arc(m.dx, m.dy, dr, 0, Math.PI*2); ctx.fill(); ctx.lineWidth = 3*u; ctx.strokeStyle = '#0E0E14'; ctx.stroke();
      ctx.fillStyle = '#FFFFFF'; ctx.font = `900 ${dr * 1.1}px ${MONO}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(m.k === 'b' ? 'B' : 'S', m.dx, m.dy + 1*u); ctx.textBaseline = 'alphabetic'; }
    // marker
    ctx.translate(m.mx, my); ctx.scale(k, k);
    ctx.shadowColor = hexA(col === CANDLE_UP ? '#18C964' : '#FF3B4E', 0.8); ctx.shadowBlur = 24*u;
    ctx.fillStyle = col; ctx.beginPath(); ctx.arc(0, 0, mr, 0, Math.PI*2); ctx.fill(); ctx.shadowBlur = 0;
    ctx.fillStyle = '#FFFFFF'; ctx.font = `900 ${30*u}px ${MONO}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(m.k === 'b' ? 'B' : 'S', 0, 2*u);
    ctx.restore(); ctx.textBaseline = 'alphabetic';
  });
}

/* ---------- export ---------- */
async function fontsReady(){
  try{ await Promise.all([document.fonts.load(`900 40px Outfit`), document.fonts.load(`800 40px 'JetBrains Mono'`), document.fonts.load(`600 20px 'JetBrains Mono'`)]); }catch(e){}
}
function renderStill(t, meta, fmtKey, opt){
  const F = FORMATS[fmtKey], c = document.createElement('canvas'); c.width = F.w; c.height = F.h;
  drawFrame(c.getContext('2d'), F.w, F.h, t, meta, 1, opt);
  return c;
}
function videoMime(){
  if(typeof MediaRecorder === 'undefined' || !HTMLCanvasElement.prototype.captureStream) return null;
  // H.264 + AAC first: what TikTok / Instagram / X re-encode best
  return ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4;codecs=avc1.4d002a,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find(m => { try{ return MediaRecorder.isTypeSupported(m); }catch(e){ return false; } }) || null;
}
/* ---------- frame-exact export (WebCodecs + MP4 muxer) ----------
   Every frame is rendered at its exact timestamp and encoded to H.264, the soundtrack is rendered offline to AAC:
   perfect constant 30 fps whatever the phone's speed, and a file TikTok / Reels / X re-encode cleanly.
   Falls back to the real-time MediaRecorder path when WebCodecs isn't available. */
const MUXER_SRC = '/vendor/mp4-muxer.js', MUXER_SRI = 'sha384-wr0AQH9RBAKio/g7bHM5245MBCU5B/b0Y9u42cTxRYQQJXKEijZvWEJKL9JG26hs';
let muxerLoading = null;
function loadMuxer(){
  if(window.Mp4Muxer) return Promise.resolve(true);
  if(!('VideoEncoder' in window)) return Promise.resolve(false);
  return muxerLoading || (muxerLoading = new Promise(res => {
    const sc = document.createElement('script'); sc.src = MUXER_SRC; sc.integrity = MUXER_SRI; sc.async = true;
    sc.onload = () => res(!!window.Mp4Muxer); sc.onerror = () => { muxerLoading = null; res(false); };
    document.head.appendChild(sc);
  }));
}
/* codec candidates per output: the H.264 / HEVC level must match size x frame rate, or the encoder refuses (or makes a file players stutter on) */
function codecCandidates(W, H, fps){
  const px = W * H * fps, big = px > 1920 * 1080 * 60 * 1.01, mid = px > 1920 * 1080 * 30 * 1.01;
  return [
    [big ? 'avc1.640034' : mid ? 'avc1.64002a' : 'avc1.640028', 'avc'],    // H.264 High 5.2 / 4.2 / 4.0
    [big ? 'avc1.4d0034' : mid ? 'avc1.4d002a' : 'avc1.4d0028', 'avc'],    // H.264 Main
    [big ? 'hvc1.1.6.L156.B0' : 'hvc1.1.6.L123.B0', 'hevc'],               // HEVC (iPhone hardware encoder)
    [big ? 'vp09.00.51.08' : 'vp09.00.41.08', 'vp9'],                     // VP9 when the browser has neither
  ];
}
function bitrateFor(W, H, fps, mux){ const base = W * H * fps; return Math.round(Math.min(60e6, base * (mux === 'hevc' ? 0.07 : 0.1))); }   // 4K60 H.264 ~50 Mb/s, 1080p60 ~12 Mb/s
async function pickVideoConfig(baseW, baseH, quality){
  const tries = quality === '1080' ? [[1, 60], [1, 30]] : [[2, 60], [1, 60], [1, 30]];   // 4K60 first, then graceful fallbacks
  for(const [k, fps] of tries){
    const W = baseW * k, H = baseH * k;
    for(const [codec, mux] of codecCandidates(W, H, fps)){
      const cfg = { codec, width:W, height:H, bitrate: bitrateFor(W, H, fps, mux), framerate:fps, bitrateMode:'constant',
        ...(mux === 'avc' ? { avc:{ format:'avc' } } : mux === 'hevc' ? { hevc:{ format:'hevc' } } : {}) };
      try{ if((await VideoEncoder.isConfigSupported(cfg)).supported) return { cfg, mux, W, H, fps, k }; }catch(e){}
      try{ const c2 = { ...cfg }; delete c2.bitrateMode; if((await VideoEncoder.isConfigSupported(c2)).supported) return { cfg:c2, mux, W, H, fps, k }; }catch(e){}
    }
  }
  return null;
}
async function encodeOffline(baseW, baseH, total, frameAt, onProgress, audioFn){
  if(!('VideoEncoder' in window) || !('VideoFrame' in window) || !(await loadMuxer())) return null;
  const pick = await pickVideoConfig(baseW, baseH, state.quality);
  if(!pick) return null;
  const { cfg: vcfg, mux: vmux, W, H, fps: FPS } = pick, n = Math.round(total / 1000 * FPS) + 1;
  // soundtrack rendered offline, sample-exact with the frames
  let abuf = null, acfg = null;
  if(audioFn && 'AudioEncoder' in window && 'AudioData' in window && window.OfflineAudioContext){
    try{
      const sr = 48000, oac = new OfflineAudioContext(2, Math.ceil(sr * total / 1000), sr);
      audioFn(oac, oac.destination, 0); abuf = await oac.startRendering();
      acfg = null;
      for(const [codec, mux] of [['mp4a.40.2', 'aac'], ['opus', 'opus']]){
        const cfg = { codec, sampleRate:sr, numberOfChannels:2, bitrate:192_000 };
        try{ if((await AudioEncoder.isConfigSupported(cfg)).supported){ acfg = { ...cfg, mux }; break; } }catch(e){}
      }
      if(!acfg) abuf = null;
    }catch(e){ acfg = null; abuf = null; }
  }
  const M = window.Mp4Muxer;
  const muxer = new M.Muxer({ target: new M.ArrayBufferTarget(), fastStart:'in-memory', firstTimestampBehavior:'offset',
    video:{ codec:vmux, width:W, height:H, frameRate:FPS }, ...(acfg ? { audio:{ codec:acfg.mux, sampleRate:acfg.sampleRate, numberOfChannels:2 } } : {}) });
  let failed = null;
  const venc = new VideoEncoder({ output:(chunk, meta) => muxer.addVideoChunk(chunk, meta), error:e => { failed = e; } });
  venc.configure(vcfg);
  const c = document.createElement('canvas'); c.width = W; c.height = H; const ctx = c.getContext('2d');
  for(let i = 0; i < n; i++){
    if(failed) throw failed;
    frameAt(ctx, W, H, Math.min(i * 1000 / FPS, total));
    const vf = new VideoFrame(c, { timestamp: Math.round(i * 1e6 / FPS), duration: Math.round(1e6 / FPS) });
    venc.encode(vf, { keyFrame: i % FPS === 0 }); vf.close();                      // a keyframe every second: clean seeking & re-encode
    while(venc.encodeQueueSize > 4) await new Promise(r => setTimeout(r, 1));
    if(i % 4 === 0){ onProgress && onProgress(i / n * (abuf ? 0.95 : 1)); await new Promise(r => setTimeout(r, 0)); }
  }
  await venc.flush(); venc.close();
  if(abuf && acfg){
    const aenc = new AudioEncoder({ output:(chunk, meta) => muxer.addAudioChunk(chunk, meta), error:e => { failed = e; } });
    const { mux: _m, ...aconf } = acfg; aenc.configure(aconf);
    const L = abuf.getChannelData(0), Rr = abuf.getChannelData(1), BLOCK = 4096;
    for(let off = 0; off < abuf.length; off += BLOCK){
      const len = Math.min(BLOCK, abuf.length - off), data = new Float32Array(len * 2);
      data.set(L.subarray(off, off + len), 0); data.set(Rr.subarray(off, off + len), len);
      const ad = new AudioData({ format:'f32-planar', sampleRate:acfg.sampleRate, numberOfFrames:len, numberOfChannels:2, timestamp: Math.round(off / acfg.sampleRate * 1e6), data });
      aenc.encode(ad); ad.close();
    }
    await aenc.flush(); aenc.close();
  }
  if(failed) throw failed;
  muxer.finalize(); onProgress && onProgress(1);
  lastExport = `${pick.k === 2 ? '4K' : '1080p'} \u00B7 ${FPS} fps`;
  return new Blob([muxer.target.buffer], { type:'video/mp4' });
}

/* real-time fallback: records any animation: frameAt(ctx, W, H, ms) drawn for `total` ms at 30 fps */
function recordAnim(W, H, total, frameAt, onProgress, audio){
  return new Promise((resolve, reject) => {
    const mime = videoMime(); if(!mime) return reject(new Error('unsupported'));
    const FPS = 60, c = document.createElement('canvas'); c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    // constant frame rate: we push exactly one frame every 1/30 s (a variable rate gets mangled by TikTok's re-encode)
    let vstream = c.captureStream(0), track = vstream.getVideoTracks()[0];
    const manual = !!(track && typeof track.requestFrame === 'function');
    if(!manual){ vstream = c.captureStream(FPS); track = vstream.getVideoTracks()[0]; }
    let stream = vstream, dest = null;
    if(audio && audio.ac && audio.ac.state !== 'running'){ try{ audio.ac.close(); }catch(e){} audio = null; }   // blocked audio would break the file's timeline: export silent instead
    if(audio && audio.ac){                                              // mix the synthesized soundtrack into the file
      try{ dest = audio.ac.createMediaStreamDestination(); stream = new MediaStream([...vstream.getVideoTracks(), ...dest.stream.getAudioTracks()]); }catch(e){ dest = null; stream = vstream; }
    }
    let rec; try{ rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 14_000_000, audioBitsPerSecond: 192_000 }); }catch(e){ return reject(e); }
    const chunks = []; rec.ondataavailable = e => { if(e.data && e.data.size) chunks.push(e.data); };
    rec.onstop = () => resolve(new Blob(chunks, { type: mime.split(';')[0] }));
    rec.onerror = e => reject(e.error || e);
    frameAt(ctx, W, H, 0); rec.start(250); if(manual) track.requestFrame();
    if(dest){ try{ audio.schedule(audio.ac, dest, audio.ac.currentTime + 0.02); }catch(e){} }
    const t0 = performance.now(), step = 1000 / FPS; let next = step;
    const tick = () => {
      const el = performance.now() - t0;
      if(manual){ if(el >= next){ frameAt(ctx, W, H, Math.min(el, total)); track.requestFrame(); next = (Math.floor(el / step) + 1) * step; } }   // one frame per 1/30 s slot, never a burst
      else frameAt(ctx, W, H, Math.min(el, total));
      onProgress && onProgress(Math.min(1, el / total));
      if(el < total + 60) requestAnimationFrame(tick);
      else setTimeout(() => { rec.stop(); if(audio && audio.ac) setTimeout(() => audio.ac.close().catch(()=>{}), 300); }, 150);
    };
    requestAnimationFrame(tick);
  });
}
async function recordVideo(t, meta, fmtKey, opt, onProgress){
  const F = FORMATS[fmtKey], frame = (ctx, W, H, el) => drawFrame(ctx, W, H, t, meta, Math.min(1, el / (VIDEO_MS - 1200)), { ...opt, video:true });   // last 1.2 s = hold
  try{ const b = await encodeOffline(F.w, F.h, VIDEO_MS, frame, onProgress, null); if(b) return b; }catch(e){ console.warn('webcodecs export failed, real-time fallback', e); }
  return recordAnim(F.w, F.h, VIDEO_MS, frame, onProgress);
}
async function recordReplay(t, meta, opt, onProgress, ac){
  const R = window.dcReplay; opt = { ...replayOpts(), ...opt };
  if(ac && ac.state !== 'running'){ try{ await Promise.race([ac.resume(), new Promise(r => setTimeout(r, 400))]); }catch(e){} }
  const frame = (ctx, W, H, el) => R.draw(ctx, W, H, t, meta, el, opt);
  try{
    const b = await encodeOffline(R.W, R.H, R.duration(opt), frame, onProgress, opt.sound === 'off' ? null : (a, dest, t0) => R.soundtrack(a, dest, t0, t, opt));
    if(b){ if(ac) ac.close().catch(()=>{}); return b; }
  }catch(e){ console.warn('webcodecs export failed, real-time fallback', e); }
  const audio = ac && opt.sound !== 'off' ? { ac, schedule: (a, dest, t0) => R.soundtrack(a, dest, t0, t, opt) } : null;
  return recordAnim(R.W, R.H, R.duration(opt), frame, onProgress, audio);
}
const newAudio = () => { try{ const A = window.AudioContext || window.webkitAudioContext; if(!A) return null; const ac = new A(); ac.resume && ac.resume(); return ac; }catch(e){ return null; } };
/* ---------- Trade Replay customization: every option is a predefined choice, saved on this device ---------- */
const RO_KEY = 'dc_replay_opts';
const RO_GROUPS = [
  ['theme',  'Colors',      [['neon','Neon'],['purple','Purple'],['gold','Gold'],['ice','Ice'],['mono','Mono']]],
  ['intro',  'Intro',       [['hook','Hook'],['countdown','3-2-1'],['logo','Logo'],['none','None']]],
  ['hook',   'Hook text',   [['auto','Auto'],['printed','How I printed'],['scalp','Scalp of the day'],['copy','Would you copy?'],['sniped','Sniped it'],['lesson','Lesson learned'],['go','Let\u2019s go']]],
  ['chart',  'Chart',       [['candles','Candles'],['line','Line'],['area','Area']]],
  ['camera', 'Camera',      [['follow','Follow'],['zoom','Close-up'],['full','Full chart']]],
  ['speed',  'Speed',       [['slow','Slow'],['normal','Normal'],['fast','Fast']]],
  ['bg',     'Background',  [['grid','Grid'],['clean','Clean'],['glow','Glow'],['stars','Stars']]],
  ['fx',     'Effects',     [['max','Max'],['soft','Soft'],['off','Off']]],
  ['burst',  'Sell effect', [['dollars','$ burst'],['confetti','Confetti'],['fire','\u{1F525} Fire'],['diamonds','\u{1F48E} Diamonds'],['rockets','\u{1F680} Rockets'],['none','None']]],
  ['sound',  'Sound',       [['hype','Hype'],['chill','Chill'],['minimal','Minimal'],['off','Off']]],
  ['outro',  'Ending',      [['full','Recap + logo'],['recap','Recap + short logo'],['quick','Short logo only']]],
  ['lang',   'Language',    [['en','English'],['fr','Fran\u00E7ais']]],
];
const RO_SHOW = [['showMiles','X cards'],['showBuy','What it buys'],['showInvested','Invested'],['showMult','Multiplier'],['showTime','Timer']];
const RO_PRESETS = {
  hype:  { name:'\u{1F525} Hype',  o:{ theme:'neon', intro:'hook', hook:'auto', chart:'candles', camera:'follow', speed:'normal', bg:'grid', fx:'max', burst:'dollars', sound:'hype', outro:'full' } },
  clean: { name:'\u2728 Clean',    o:{ theme:'purple', intro:'logo', hook:'auto', chart:'candles', camera:'follow', speed:'normal', bg:'clean', fx:'soft', burst:'none', sound:'minimal', outro:'recap' } },
  chill: { name:'\u{1F30A} Chill', o:{ theme:'ice', intro:'logo', hook:'auto', chart:'area', camera:'full', speed:'slow', bg:'stars', fx:'soft', burst:'confetti', sound:'chill', outro:'full' } },
  degen: { name:'\u{1F680} Degen', o:{ theme:'gold', intro:'countdown', hook:'go', chart:'candles', camera:'zoom', speed:'fast', bg:'glow', fx:'max', burst:'rockets', sound:'hype', outro:'quick' } },
};
/* PRO replay styles: free = the first, default look of each group; the rest needs PRO (only once PRO is live) */
const RO_PRO = { theme:['purple','gold','ice','mono'], bg:['clean','glow','stars'], burst:['confetti','fire','diamonds','rockets'],
  hook:['printed','scalp','copy','sniped','lesson','go'], intro:['countdown','logo'], outro:['recap','quick'] };
const proLocked = () => !!(window.dcPro && window.dcPro.enabled && !window.dcPro.active);
const isProVal = (k, v) => !!(RO_PRO[k] && RO_PRO[k].includes(v));
function replayOpts(){
  const d = (window.dcReplay && window.dcReplay.DEFAULTS) || {};
  let saved = {}; try{ saved = JSON.parse(localStorage.getItem(RO_KEY) || '{}') || {}; }catch(e){}
  const o = { ...d };
  for(const [k, , opts] of RO_GROUPS) if(opts.some(x => x[0] === saved[k])) o[k] = saved[k];   // only known values: a stale / edited entry can't break a render
  for(const [k] of RO_SHOW) if(typeof saved[k] === 'boolean') o[k] = saved[k];
  delete o.hideUsd;
  if(proLocked()) for(const k in RO_PRO) if(isProVal(k, o[k])) o[k] = d[k];   // a lapsed PRO falls back to the free look
  return o;
}
function saveReplayOpts(o){ try{ localStorage.setItem(RO_KEY, JSON.stringify(o)); }catch(e){} }
function renderCustomize(){
  const box = document.getElementById('shareCustom'); if(!box) return;
  const o = replayOpts(), R = window.dcReplay;
  const secs = R ? Math.round(R.duration({ ...o }) / 1000) : 0;
  const preset = Object.entries(RO_PRESETS).find(([, p]) => Object.entries(p.o).every(([k, v]) => o[k] === v));
  box.innerHTML = `
    <div class="rc-head"><span>Customize</span><em>\u2248 ${secs} s</em></div>
    <div class="rc-row" role="group" aria-label="Presets">${Object.entries(RO_PRESETS).map(([k, p]) => `<button type="button" class="rc-chip preset ${preset && preset[0] === k ? 'on' : ''}${proLocked() && Object.entries(p.o).some(([pk, pv]) => isProVal(pk, pv)) ? ' locked' : ''}" data-rp="${k}" aria-pressed="${preset && preset[0] === k}">${p.name}</button>`).join('')}</div>
    ${RO_GROUPS.map(([k, label, opts]) => `
      <div class="rc-group"><div class="rc-label" id="rcl-${k}">${label}</div>
        <div class="rc-row" role="radiogroup" aria-labelledby="rcl-${k}">${opts.map(([v, l]) => `<button type="button" class="rc-chip ${o[k] === v ? 'on' : ''}${k === 'theme' ? ' sw sw-' + v : ''}${proLocked() && isProVal(k, v) ? ' locked' : ''}" role="radio" aria-checked="${o[k] === v}" data-rk="${k}" data-rv="${v}"${proLocked() && isProVal(k, v) ? ' data-pro="1"' : ''}>${l}</button>`).join('')}</div></div>`).join('')}
    <div class="rc-group"><div class="rc-label">Show</div>
      <div class="rc-row">${RO_SHOW.map(([k, l]) => `<button type="button" class="rc-chip ${o[k] ? 'on' : ''}" role="switch" aria-checked="${!!o[k]}" data-rs="${k}">${o[k] ? '\u2713 ' : ''}${l}</button>`).join('')}</div></div>
    <button type="button" class="hbtn rc-reset" id="rcReset">RESET TO DEFAULT</button>`;
  const changed = next => { saveReplayOpts(next); renderCustomize(); syncButtons(); preview(); };
  box.querySelectorAll('[data-rk]').forEach(b => b.addEventListener('click', () => b.dataset.pro ? window.dcPro.open() : changed({ ...replayOpts(), [b.dataset.rk]: b.dataset.rv })));
  box.querySelectorAll('[data-rs]').forEach(b => b.addEventListener('click', () => { const c = replayOpts(); changed({ ...c, [b.dataset.rs]: !c[b.dataset.rs] }); }));
  box.querySelectorAll('[data-rp]').forEach(b => b.addEventListener('click', () => { const po = RO_PRESETS[b.dataset.rp].o;
    if(proLocked() && Object.entries(po).some(([k, v]) => isProVal(k, v))) return window.dcPro.open();
    changed({ ...replayOpts(), ...po }); }));
  document.getElementById('rcReset').addEventListener('click', () => { try{ localStorage.removeItem(RO_KEY); }catch(e){} renderCustomize(); syncButtons(); preview(); });
}
const isReplay = () => state.style === 'replay' && window.dcReplay && window.dcReplay.available(state.t);
function captionFor(t, opt){
  const res = opt.hideUsd ? fmt.pct(t.roi) : `${fmt.usd(t.pnl)} (${fmt.pct(t.roi)})`;
  return `${tk(t.ticker)} ${res} in ${fmt.hold(t.holdTime)} ${t.pnl >= 0 ? '🟢' : '🔴'}\nMy trades, as collectible cards → degencards.vercel.app #DEGENCARDS`;
}
async function deliver(blob, name, caption){
  const file = new File([blob], name, { type: blob.type });
  if(navigator.share && navigator.canShare && navigator.canShare({ files:[file] })){
    try{ await navigator.share({ files:[file], text: caption }); return 'shared'; }
    catch(e){ if(e && e.name === 'AbortError') return 'cancel'; }
  }
  try{ await navigator.clipboard.writeText(caption); }catch(e){}
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = name; a.rel = 'noopener'; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 8000);
  return 'downloaded';
}

/* ---------- share sheet ---------- */
let state = { t:null, meta:null, fmt:'post', style:'card', hideUsd:false, anim:0, busy:false, sound:false, pac:null, quality: (()=>{ try{ return localStorage.getItem('dc_video_q') || '4k'; }catch(e){ return '4k'; } })() };
let lastExport = '';
function sheet(){ return document.getElementById('shareOverlay'); }
function preview(){
  const cv = document.getElementById('sharePreview'), R = window.dcReplay;
  const F = isReplay() ? { w:R.W, h:R.H } : FORMATS[state.fmt];
  const scale = Math.min(1, 360 / F.w); cv.width = F.w * scale * (window.devicePixelRatio > 1 ? 2 : 1) | 0; cv.height = F.h * (cv.width / F.w) | 0;
  const ctx = cv.getContext('2d'), k = cv.width / F.w;
  cancelAnimationFrame(state.anim);
  stopPreviewSound();
  let cycle = -1;
  const t0 = performance.now(), loop = () => {                    // live animated preview, loops
    ctx.setTransform(k,0,0,k,0,0);
    if(isReplay()){
      const ro = { ...replayOpts(), hideUsd: state.hideUsd }, D = R.duration(ro), tot = D + 900, raw = performance.now() - t0, el = raw % tot, c = Math.floor(raw / tot);
      if(c !== cycle){ cycle = c; if(state.sound) playPreviewSound(); }       // soundtrack restarts with each loop
      R.draw(ctx, F.w, F.h, state.t, state.meta, Math.min(el, D), ro);
    }
    else { const el = (performance.now() - t0) % (VIDEO_MS + 900), p = Math.min(1, el / (VIDEO_MS - 1200)); drawFrame(ctx, F.w, F.h, state.t, state.meta, p, state); }
    if(sheet().classList.contains('show')) state.anim = requestAnimationFrame(loop);
  };
  loop();
}
function stopPreviewSound(){ if(state.pac){ try{ state.pac.close(); }catch(e){} state.pac = null; } }
function playPreviewSound(){
  stopPreviewSound(); const ac = newAudio(); if(!ac || !window.dcReplay) return; state.pac = ac;
  try{ window.dcReplay.soundtrack(ac, ac.destination, ac.currentTime + 0.02, state.t, { ...replayOpts(), hideUsd: state.hideUsd }); }catch(e){}
}
function syncButtons(){
  const canReplay = !!(window.dcReplay && window.dcReplay.available(state.t));
  if(!canReplay && state.style === 'replay') state.style = 'card';
  document.querySelectorAll('[data-share-style]').forEach(b => { b.classList.toggle('on', b.dataset.shareStyle === state.style); if(b.dataset.shareStyle === 'replay'){ b.disabled = !canReplay; b.title = canReplay ? '' : 'Needs the real candles of this trade'; } });
  document.getElementById('shareFmts').hidden = state.style === 'replay';
  document.getElementById('shareReplayNote').hidden = canReplay;
  const cb = document.getElementById('shareCustom'); if(cb){ cb.hidden = state.style !== 'replay' || !canReplay; if(!cb.hidden && !cb.childElementCount) renderCustomize(); }
  const sb = document.getElementById('shareSound'); sb.hidden = state.style !== 'replay'; sb.textContent = state.sound ? '\u{1F50A} Sound on' : '\u{1F507} Sound off'; sb.setAttribute('aria-pressed', String(state.sound));
  document.querySelectorAll('[data-share-fmt]').forEach(b => b.classList.toggle('on', b.dataset.shareFmt === state.fmt));
  document.getElementById('shareHideUsd').checked = state.hideUsd;
  document.querySelectorAll('[data-share-q]').forEach(b => { const on = b.dataset.shareQ === state.quality; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); });
  const v = document.getElementById('shareVideo'), mime = videoMime() || (('VideoEncoder' in window) ? 'video/mp4' : null);
  v.hidden = !mime; v.textContent = (state.style === 'replay' ? 'SHARE REPLAY VIDEO' : 'SHARE VIDEO') + (mime && mime.includes('mp4') ? ' (MP4)' : '');
}
async function doStill(){
  if(state.busy) return; state.busy = true;
  try{
    await fontsReady(); await loadCoinImage(state.t.image);
    let c;
    if(isReplay()){ const R = window.dcReplay; c = document.createElement('canvas'); c.width = R.W; c.height = R.H; const ro = { ...replayOpts(), hideUsd: state.hideUsd }; R.draw(c.getContext('2d'), R.W, R.H, state.t, state.meta, R.duration(ro), ro); }
    else c = renderStill(state.t, state.meta, state.fmt, state);
    const blob = await new Promise(r => c.toBlob(r, 'image/png'));
    if(!blob) throw new Error('png');
    const r = await deliver(blob, `degencards-${safeName()}-${isReplay() ? 'replay' : state.fmt}.png`, captionFor(state.t, state));
    if(r === 'downloaded') showToast('Image saved · caption copied');
  }catch(e){ showToast("Couldn't build the image"); }
  finally{ state.busy = false; }
}
async function doVideo(){
  if(state.busy) return; state.busy = true;
  const ac = isReplay() ? newAudio() : null;                         // created synchronously in the tap, before any await
  const btn = document.getElementById('shareVideo'), label = btn.textContent;
  try{
    await fontsReady(); await loadCoinImage(state.t.image);
    lastExport = '';
    const tStart = performance.now();
    const prog = pr => { const el = (performance.now() - tStart) / 1000, eta = pr > 0.04 ? Math.max(0, Math.round(el / pr - el)) : null; btn.textContent = `RENDERING\u2026 ${Math.round(pr*100)}%` + (eta != null ? ` \u00B7 ~${eta}s` : ''); };
    const blob = isReplay() ? await recordReplay(state.t, state.meta, state, prog, ac) : await recordVideo(state.t, state.meta, state.fmt, state, prog);
    btn.textContent = label;
    const ext = blob.type.includes('mp4') ? 'mp4' : 'webm';
    const r = await deliver(blob, `degencards-${safeName()}-${isReplay() ? 'replay' : state.fmt}.${ext}`, captionFor(state.t, state));
    showToast((r === 'downloaded' ? 'Video saved \u00B7 caption copied' : 'Video ready') + (lastExport ? ` \u00B7 ${lastExport}` : ''));
  }catch(e){ showToast("Video isn't supported here — share the image"); }
  finally{ btn.textContent = label; state.busy = false; }
}
const safeName = () => (String(state.t.ticker).replace(/[^A-Za-z0-9_-]/g,'') || 'card');

window.__dcLoadImg = loadCoinImage;
window.__dcImgCache = IMG_CACHE;
window.__dcShareReplay = (t, meta, opt, withSound) => recordReplay(t, meta, opt, null, withSound ? newAudio() : null);
window.__dcShareFrame = (canvas, t, meta, fmtKey, opt, p) => { const F = FORMATS[fmtKey]; canvas.width = F.w; canvas.height = F.h; drawFrame(canvas.getContext('2d'), F.w, F.h, t, meta, p, opt); };   // used by the visual tests
window.__dcShareRecord = (t, meta, fmtKey, opt) => recordVideo(t, meta, fmtKey, opt);
window.shareCard = function(t, meta){
  state.t = t; state.meta = meta;
  syncButtons();
  document.getElementById('detailOverlay')?.classList.remove('show');
  sheet().classList.add('show');
  Promise.all([fontsReady(), loadCoinImage(t.image)]).then(preview);
  loadMuxer();
};
let inited = false;
document.addEventListener('DOMContentLoaded', init); if(document.readyState !== 'loading') init();
function init(){
  if(inited || !sheet()) return; inited = true;
  document.querySelectorAll('[data-share-fmt]').forEach(b => b.addEventListener('click', () => { state.fmt = b.dataset.shareFmt; syncButtons(); preview(); }));
  document.querySelectorAll('[data-share-style]').forEach(b => b.addEventListener('click', () => { if(b.disabled) return; state.style = b.dataset.shareStyle; syncButtons(); if(state.style === 'replay') renderCustomize(); preview(); }));
  document.getElementById('shareSound').addEventListener('click', () => { state.sound = !state.sound; syncButtons(); if(state.sound) preview(); else stopPreviewSound(); });
  document.getElementById('shareHideUsd').addEventListener('change', e => { state.hideUsd = e.target.checked; });
  document.querySelectorAll('[data-share-q]').forEach(b => b.addEventListener('click', () => { state.quality = b.dataset.shareQ; try{ localStorage.setItem('dc_video_q', state.quality); }catch(e){} syncButtons(); }));
  document.getElementById('shareImage').addEventListener('click', doStill);
  document.getElementById('shareVideo').addEventListener('click', doVideo);
  document.getElementById('shareCaption').addEventListener('click', async () => {
    try{ await navigator.clipboard.writeText(captionFor(state.t, state)); showToast('Caption copied'); }catch(e){ showToast("Couldn't copy"); }
  });
  sheet().querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => { sheet().classList.remove('show'); cancelAnimationFrame(state.anim); stopPreviewSound(); }));
  sheet().addEventListener('click', e => { if(e.target === sheet()){ sheet().classList.remove('show'); cancelAnimationFrame(state.anim); stopPreviewSound(); } });
}
})();

window.addEventListener('dc-pro', () => { try{ if(document.getElementById('shareCustom')) renderCustomize(); }catch(e){} });
