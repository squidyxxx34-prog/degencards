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
  const story = H / W > 1.5, u = W / 1080;                            // u = unit scale
  ctx.save();
  ctx.clearRect(0,0,W,H);

  // cinematic intro: fade from black + slow push-in
  const intro = easeOut(seg(p, 0, 0.14));
  const zoom = 1.06 - 0.06 * easeOut(seg(p, 0, 0.5));
  ctx.fillStyle = '#050507'; ctx.fillRect(0,0,W,H);
  ctx.translate(W/2, H/2); ctx.scale(zoom, zoom); ctx.translate(-W/2, -H/2);

  // background glows (rarity + result)
  let g = ctx.createRadialGradient(W*0.2, H*0.12, 0, W*0.2, H*0.12, W*1.0);
  g.addColorStop(0, hexA(rar, 0.30)); g.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = g; ctx.fillRect(0,0,W,H);
  g = ctx.createRadialGradient(W*0.85, H*0.62, 0, W*0.85, H*0.62, W*0.95);
  g.addColorStop(0, hexA(main, 0.20)); g.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = g; ctx.fillRect(0,0,W,H);
  // terminal grid
  ctx.strokeStyle = 'rgba(255,255,255,0.035)'; ctx.lineWidth = 1;
  for(let x=0; x<W; x+=60*u){ ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,H); ctx.stroke(); }
  for(let y=0; y<H; y+=60*u){ ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke(); }

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
  const a1 = easeOut(seg(p, 0.06, 0.22));
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

  // ticker
  y += story ? 230*u : 175*u;
  const a2 = easeOut(seg(p, 0.12, 0.3));
  ctx.globalAlpha = a2; ctx.textAlign = 'center';
  const tick = tk(t.ticker);
  fitFont(ctx, tick, 900, SANS, 110*u, cw - 120*u);
  ctx.fillStyle = '#FFFFFF'; ctx.shadowColor = 'rgba(255,255,255,0.25)'; ctx.shadowBlur = 30*u;
  ctx.fillText(tick, midX, y + (1-a2)*30*u); ctx.shadowBlur = 0;

  // PnL (count-up) + ROI
  y += story ? 200*u : 165*u;
  const cnt = easeOut(seg(p, 0.18, 0.55));
  const pnlNow = t.pnl * cnt, roiNow = t.roi * cnt;
  const big = opt.hideUsd ? fmt.pct(roiNow) : fmt.usd(pnlNow);
  ctx.globalAlpha = clamp01(seg(p, 0.16, 0.24));
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
  const chH = story ? 520*u : 330*u, chX = P, chW = R - P;
  const a3 = easeOut(seg(p, 0.26, 0.36));
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
    ctx.fillStyle = lg; ctx.setTransform(1,0,-0.35,1,0,0); ctx.fillRect(sx - 400*u, 0, 800*u, H);
    ctx.restore();
  }

  // grain + vignette + fade
  ctx.setTransform(1,0,0,1,0,0);
  ctx.fillStyle = grainPattern(ctx); ctx.fillRect(0,0,W,H);
  const v = ctx.createRadialGradient(W/2, H/2, W*0.45, W/2, H/2, H*0.75);
  v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.55)'); ctx.fillStyle = v; ctx.fillRect(0,0,W,H);
  if(intro < 1){ ctx.fillStyle = `rgba(0,0,0,${1-intro})`; ctx.fillRect(0,0,W,H); }
  ctx.restore();
}

/* ---------- candles (progressive) + B / S pinned on top with dashed drop lines ---------- */
function drawChart(ctx, t, x, y, w, h, p, u, opt){
  const ch = t.chart && t.chart.v === 2 ? t.chart : null;
  const topZone = 70*u;                                              // markers row lives above the chart area (y - 70u)
  const drawP = easeOut(seg(p, 0.3, 0.72));
  let X, Y, marks;
  if(ch){
    const cs = ch.c, iv = ch.i;
    const x0 = ch.w ? ch.w[0] : cs[0][0], x1 = ch.w ? ch.w[1] : cs[cs.length-1][0] + iv;
    let y0 = Math.min(...cs.map(c=>c[3])), y1 = Math.max(...cs.map(c=>c[2]));
    if(y1 - y0 < 1e-9){ y0 *= 0.95; y1 = y1*1.05 + 1; }
    const pad = (y1-y0)*0.08; y0 -= pad; y1 += pad;
    X = v => x + ((v - x0)/(x1 - x0)) * w; Y = v => y + (1 - (v - y0)/(y1 - y0)) * h;
    const n = Math.ceil(cs.length * drawP), bw = Math.max(2*u, ((iv/(x1-x0)) * w) * 0.66);
    for(let i=0;i<n;i++){
      const [ts,o,hi,lo,c] = cs[i], up = c >= o, col = up ? CANDLE_UP : CANDLE_DN, cxp = X(ts + iv/2);
      ctx.strokeStyle = col; ctx.lineWidth = Math.max(1.5*u, bw*0.14);
      ctx.beginPath(); ctx.moveTo(cxp, Y(hi)); ctx.lineTo(cxp, Y(lo)); ctx.stroke();
      const top = Y(Math.max(o,c)), bot = Y(Math.min(o,c));
      ctx.fillStyle = col; ctx.fillRect(cxp - bw/2, top, bw, Math.max(2*u, bot - top));
    }
    const at = ts => { const c = cs.find(c=>ts < c[0]+iv) || cs[cs.length-1]; return (c[2]+c[3])/2; };
    marks = (ch.m || []).map(m => [m[0], m[1], ch.src === 'pump' && m[2] > 0 ? m[2] : at(m[0])]);
    // MC scale
    ctx.font = `600 ${22*u}px ${MONO}`; ctx.fillStyle = 'rgba(255,255,255,0.4)'; ctx.textAlign = 'left';
    ctx.fillText(mcShort(y1 - pad), x, y + 4*u); ctx.fillText(mcShort(Math.max(0, y0 + pad)), x, y + h);
    ctx.textAlign = 'right'; ctx.fillText((iv >= 60000 ? iv/60000+'m' : iv/1000+'s') + ' candles', x + w, y + h + 34*u);
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
  pos.forEach((m, i) => {
    const k = easeOutBack(seg(p, 0.72 + i*0.05, 0.84 + i*0.05)); if(k <= 0) return;
    const col = m.k === 'b' ? CANDLE_UP : CANDLE_DN;
    // drop line
    ctx.save(); ctx.globalAlpha = clamp01(k);
    ctx.strokeStyle = col; ctx.lineWidth = 3*u; ctx.setLineDash([10*u, 9*u]);
    ctx.beginPath(); ctx.moveTo(m.mx, my + mr); ctx.lineTo(m.mx + (m.x - m.mx)*clamp01(k), my + mr + (m.y - my - mr)*clamp01(k)); ctx.stroke(); ctx.setLineDash([]);
    // fill dot
    if(k >= 1){ ctx.fillStyle = col; ctx.beginPath(); ctx.arc(m.x, m.y, 11*u, 0, Math.PI*2); ctx.fill(); ctx.lineWidth = 4*u; ctx.strokeStyle = '#0E0E14'; ctx.stroke(); }
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
  return ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find(m => { try{ return MediaRecorder.isTypeSupported(m); }catch(e){ return false; } }) || null;
}
function recordVideo(t, meta, fmtKey, opt, onProgress){
  return new Promise((resolve, reject) => {
    const mime = videoMime(); if(!mime) return reject(new Error('unsupported'));
    const F = FORMATS[fmtKey], c = document.createElement('canvas'); c.width = F.w; c.height = F.h;
    const ctx = c.getContext('2d'), stream = c.captureStream(30);
    let rec; try{ rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000 }); }catch(e){ return reject(e); }
    const chunks = []; rec.ondataavailable = e => { if(e.data && e.data.size) chunks.push(e.data); };
    rec.onstop = () => resolve(new Blob(chunks, { type: mime.split(';')[0] }));
    rec.onerror = e => reject(e.error || e);
    const t0 = performance.now(); drawFrame(ctx, F.w, F.h, t, meta, 0, opt); rec.start(250);
    const tick = () => {
      const el = performance.now() - t0, p = Math.min(1, el / (VIDEO_MS - 1200));   // last 1.2 s = hold on the final frame
      drawFrame(ctx, F.w, F.h, t, meta, p, opt); onProgress && onProgress(Math.min(1, el / VIDEO_MS));
      if(el < VIDEO_MS) requestAnimationFrame(tick); else { stream.getTracks().forEach(tr => tr.requestFrame ? tr.requestFrame() : 0); setTimeout(() => rec.stop(), 120); }
    };
    requestAnimationFrame(tick);
  });
}
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
let state = { t:null, meta:null, fmt:'post', hideUsd:false, anim:0, busy:false };
function sheet(){ return document.getElementById('shareOverlay'); }
function preview(){
  const cv = document.getElementById('sharePreview'), F = FORMATS[state.fmt];
  const scale = Math.min(1, 360 / F.w); cv.width = F.w * scale * (window.devicePixelRatio > 1 ? 2 : 1) | 0; cv.height = F.h * (cv.width / F.w) | 0;
  const ctx = cv.getContext('2d'), k = cv.width / F.w;
  cancelAnimationFrame(state.anim);
  const t0 = performance.now(), loop = () => {                    // live animated preview, loops
    const el = (performance.now() - t0) % (VIDEO_MS + 900), p = Math.min(1, el / (VIDEO_MS - 1200));
    ctx.setTransform(k,0,0,k,0,0); drawFrame(ctx, F.w, F.h, state.t, state.meta, p, state);
    if(sheet().classList.contains('show')) state.anim = requestAnimationFrame(loop);
  };
  loop();
}
function syncButtons(){
  document.querySelectorAll('[data-share-fmt]').forEach(b => b.classList.toggle('on', b.dataset.shareFmt === state.fmt));
  document.getElementById('shareHideUsd').checked = state.hideUsd;
  const v = document.getElementById('shareVideo'), mime = videoMime();
  v.hidden = !mime; v.textContent = mime && mime.includes('mp4') ? 'SHARE VIDEO (MP4)' : 'SHARE VIDEO';
}
async function doStill(){
  if(state.busy) return; state.busy = true;
  try{
    await fontsReady();
    const c = renderStill(state.t, state.meta, state.fmt, state);
    const blob = await new Promise(r => c.toBlob(r, 'image/png'));
    if(!blob) throw new Error('png');
    const r = await deliver(blob, `degencards-${safeName()}-${state.fmt}.png`, captionFor(state.t, state));
    if(r === 'downloaded') showToast('Image saved · caption copied');
  }catch(e){ showToast("Couldn't build the image"); }
  finally{ state.busy = false; }
}
async function doVideo(){
  if(state.busy) return; state.busy = true;
  const btn = document.getElementById('shareVideo'), label = btn.textContent;
  try{
    await fontsReady();
    const blob = await recordVideo(state.t, state.meta, state.fmt, state, pr => { btn.textContent = `RENDERING… ${Math.round(pr*100)}%`; });
    btn.textContent = label;
    const ext = blob.type.includes('mp4') ? 'mp4' : 'webm';
    const r = await deliver(blob, `degencards-${safeName()}-${state.fmt}.${ext}`, captionFor(state.t, state));
    if(r === 'downloaded') showToast('Video saved · caption copied');
  }catch(e){ showToast("Video isn't supported here — share the image"); }
  finally{ btn.textContent = label; state.busy = false; }
}
const safeName = () => (String(state.t.ticker).replace(/[^A-Za-z0-9_-]/g,'') || 'card');

window.__dcShareFrame = (canvas, t, meta, fmtKey, opt, p) => { const F = FORMATS[fmtKey]; canvas.width = F.w; canvas.height = F.h; drawFrame(canvas.getContext('2d'), F.w, F.h, t, meta, p, opt); };   // used by the visual tests
window.__dcShareRecord = (t, meta, fmtKey, opt) => recordVideo(t, meta, fmtKey, opt);
window.shareCard = function(t, meta){
  state.t = t; state.meta = meta;
  syncButtons();
  document.getElementById('detailOverlay')?.classList.remove('show');
  sheet().classList.add('show');
  fontsReady().then(preview);
};
let inited = false;
document.addEventListener('DOMContentLoaded', init); if(document.readyState !== 'loading') init();
function init(){
  if(inited || !sheet()) return; inited = true;
  document.querySelectorAll('[data-share-fmt]').forEach(b => b.addEventListener('click', () => { state.fmt = b.dataset.shareFmt; syncButtons(); preview(); }));
  document.getElementById('shareHideUsd').addEventListener('change', e => { state.hideUsd = e.target.checked; });
  document.getElementById('shareImage').addEventListener('click', doStill);
  document.getElementById('shareVideo').addEventListener('click', doVideo);
  document.getElementById('shareCaption').addEventListener('click', async () => {
    try{ await navigator.clipboard.writeText(captionFor(state.t, state)); showToast('Caption copied'); }catch(e){ showToast("Couldn't copy"); }
  });
  sheet().querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => { sheet().classList.remove('show'); cancelAnimationFrame(state.anim); }));
  sheet().addEventListener('click', e => { if(e.target === sheet()){ sheet().classList.remove('show'); cancelAnimationFrame(state.anim); } });
}
})();
