/* ============================================================================
   DEGENCARDS — cinematic share
   Post (4:5, 1080×1350), Square (1:1, 1080×1080) or Story (9:16, 1080×1920), still PNG or 6 s animated
   video (count-up PnL, candles drawn live, B / S drop, light sweep).
   Everything is drawn on a <canvas>: no external request, works offline.
   ============================================================================ */
(function(){
const FORMATS = { post:{ w:1080, h:1350, label:'POST 4:5' }, square:{ w:1080, h:1080, label:'SQUARE 1:1' }, story:{ w:1080, h:1920, label:'STORY 9:16' }, wide:{ w:1600, h:900, label:'WIDE 16:9' } };
const RARITY_HEX = { common:'#ADADB8', uncommon:'#3DFFA0', rare:'#6EC0FF', epic:'#C09EFF', legendary:'#FFD35C', mythic:'#FF5ADC' };
const GREEN = '#3DFFA0', RED = '#FF5C6C', CANDLE_UP = '#18C964', CANDLE_DN = '#FF3B4E';
const SANS = "'Outfit', system-ui, sans-serif", MONO = "'JetBrains Mono', ui-monospace, monospace";
/* the user's @username on shared images / videos (set by app.js once the profile is loaded; can be turned off in the share sheet) */
let SHOW_NAME = (() => { try{ return localStorage.getItem('dc_share_name') !== '0'; }catch(e){ return true; } })();
const handle = () => { const n = window.dcUser && window.dcUser.username; return SHOW_NAME && typeof n === 'string' && /^[a-z0-9_]{3,20}$/.test(n) ? '@' + n : ''; };
window.dcHandle = handle;

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

/* ---------- custom background: the user's own photo or video, kept on this device only (IndexedDB), never uploaded ---------- */
const BG = { kind:null, el:null, url:null, dim:0.45, dur:0, pos:0.5, blur:false };
const BG_MAX_IMG = 25e6, BG_MAX_VID = 200e6, BG_DB = 'dc_share', BG_STORE = 'bg';
function bgDb(){ return new Promise((res, rej) => { try{ const r = indexedDB.open(BG_DB, 1); r.onupgradeneeded = () => r.result.createObjectStore(BG_STORE); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }catch(e){ rej(e); } }); }
async function bgSave(v){ try{ const db = await bgDb(); await new Promise(r => { const tx = db.transaction(BG_STORE, 'readwrite'); v ? tx.objectStore(BG_STORE).put(v, 'cur') : tx.objectStore(BG_STORE).delete('cur'); tx.oncomplete = tx.onerror = tx.onabort = () => r(); }); db.close(); }catch(e){} }
async function bgLoadSaved(){ try{ const db = await bgDb(); const v = await new Promise(r => { const q = db.transaction(BG_STORE).objectStore(BG_STORE).get('cur'); q.onsuccess = () => r(q.result); q.onerror = () => r(null); }); db.close(); return v || null; }catch(e){ return null; } }
function bgRelease(){
  if(BG.el && BG.kind === 'video'){ try{ BG.el.pause(); BG.el.removeAttribute('src'); BG.el.load(); BG.el.remove(); }catch(e){} }
  if(BG.url) URL.revokeObjectURL(BG.url);
  BG.kind = null; BG.el = null; BG.url = null; BG.dur = 0;
}
/* blob -> ready <img> / <video>; resolves false if the browser can't decode it */
function bgUse(blob){
  const isVid = /^video\//.test(blob.type), url = URL.createObjectURL(blob);
  return new Promise(res => {
    const fail = () => { URL.revokeObjectURL(url); res(false); };
    if(isVid){
      const v = document.createElement('video');
      v.muted = true; v.defaultMuted = true; v.loop = true; v.playsInline = true; v.setAttribute('playsinline', ''); v.setAttribute('muted', ''); v.preload = 'auto';
      v.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0;pointer-events:none;z-index:-1';
      const to = setTimeout(fail, 15000);
      v.addEventListener('loadeddata', () => { clearTimeout(to); if(!v.videoWidth){ v.remove(); return fail(); }
        bgRelease(); BG.kind = 'video'; BG.el = v; BG.url = url; BG.dur = isFinite(v.duration) ? v.duration : 0; v.play().catch(()=>{}); res(true); }, { once:true });
      v.addEventListener('error', () => { clearTimeout(to); v.remove(); fail(); }, { once:true });
      document.body.appendChild(v); v.src = url;
    } else {
      const im = new Image(); im.decoding = 'async';
      im.onload = () => { if(!im.naturalWidth) return fail(); bgRelease(); BG.kind = 'image'; BG.el = im; BG.url = url; res(true); };
      im.onerror = fail; im.src = url;
    }
  });
}
const bgReady = () => !proLocked() && !!(BG.el && (BG.kind === 'image' ? BG.el.naturalWidth : BG.el.readyState >= 2 && BG.el.videoWidth));
/* frame-exact seek for exports: the video frame at ms (looped) */
function bgSeek(ms){
  const v = BG.el; if(BG.kind !== 'video' || !v || !BG.dur) return Promise.resolve();
  const want = (ms / 1000) % BG.dur;
  if(Math.abs(v.currentTime - want) < 0.004) return Promise.resolve();
  return new Promise(r => { const to = setTimeout(done, 1500); function done(){ clearTimeout(to); v.removeEventListener('seeked', done); r(); } v.addEventListener('seeked', done); v.currentTime = want; });
}
/* soft blur that works everywhere (canvas filter isn't on every Safari): downscale, then upscale smoothly */
const BLUR_C = document.createElement('canvas');
function softBlur(src, sw, sh, k){
  const w = Math.max(2, Math.round(sw / k)), h = Math.max(2, Math.round(sh / k));
  if(BLUR_C.width !== w || BLUR_C.height !== h){ BLUR_C.width = w; BLUR_C.height = h; }
  const b = BLUR_C.getContext('2d'); b.imageSmoothingEnabled = true; b.imageSmoothingQuality = 'high';
  try{ b.drawImage(src, 0, 0, w, h); }catch(e){}
  return BLUR_C;
}
/* cover-draw any source; pos 0..1 slides along the cropped axis; zoom >= 1 */
function coverDraw(ctx, el, iw, ih, W, H, pos, zoom, blur){
  const r = Math.max(W / iw, H / ih) * (zoom || 1), dw = iw * r, dh = ih * r;
  const x = dw > W ? -(dw - W) * pos : (W - dw) / 2, y = dh > H ? -(dh - H) * (dw > W + 1 ? 0.5 : pos) : (H - dh) / 2;
  ctx.save(); ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  try{ ctx.drawImage(blur ? softBlur(el, iw, ih, Math.max(iw, ih) / 64) : el, x, y, dw, dh); }catch(e){}
  ctx.restore();
}
function drawBg(ctx, W, H, zoom){
  const el = BG.el, iw = BG.kind === 'video' ? el.videoWidth : el.naturalWidth, ih = BG.kind === 'video' ? el.videoHeight : el.naturalHeight;
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
  coverDraw(ctx, el, iw, ih, W, H, BG.pos, zoom, BG.blur);
  if(BG.dim > 0){ ctx.fillStyle = `rgba(0,0,0,${BG.dim})`; ctx.fillRect(0, 0, W, H); }
}

/* ---------- SIMPLE card: clean PnL card (terminal style). No chart. ---------- */
const SIMPLE_MS = 5200;
const SO_KEY = 'dc_simple_opts';
const SO_DEF = { layout:'full', big:'roi', accent:'auto', bg:'dark', coin:true, sub:true, stats:true, date:true, rarity:true, tradeNo:true };
const SO_GROUPS = [
  ['layout', 'Style',      [['full','Full'],['minimal','Minimal']]],
  ['big',    'Big number', [['roi','ROI %'],['pnl','PnL $']]],
  ['accent', 'Color',      [['auto','Auto'],['purple','Purple'],['gold','Gold'],['ice','Ice'],['mono','Mono']]],
  ['bg',     'Background', [['dark','Dark'],['aurora','Aurora'],['sunset','Sunset'],['matrix','Matrix'],['coin','Coin']]],
];
const SO_SHOW = [['coin','Coin logo'],['sub','2nd number'],['stats','Stats'],['date','Date'],['rarity','Rarity'],['tradeNo','Trade #']];
/* Minimal = Axiom-like: flat background, no glow, 2 stat rows, fewer details (the toggles stay editable after) */
const SO_LAYOUTS = { full:{ sub:true, date:true, rarity:true, tradeNo:true }, minimal:{ sub:false, date:false, rarity:false, tradeNo:false } };
const SO_PRO = { accent:['purple','gold','ice','mono'], bg:['aurora','sunset','matrix','coin'] };
const ACCENT = { purple:'#C09EFF', gold:'#FFD35C', ice:'#6EC0FF', mono:'#FFFFFF' };
let SO_SAVED = (() => { let v = {}; try{ v = JSON.parse(localStorage.getItem(SO_KEY) || '{}') || {}; }catch(e){} const o = { ...SO_DEF };
  for(const [k, , opts] of SO_GROUPS) if(opts.some(x => x[0] === v[k])) o[k] = v[k];
  for(const [k] of SO_SHOW) if(typeof v[k] === 'boolean') o[k] = v[k];
  return o; })();
function simpleOpts(){                                               // free: PRO-only choices fall back to the default
  const o = { ...SO_SAVED };
  if(proLocked()) for(const k in SO_PRO) if(SO_PRO[k].includes(o[k])) o[k] = SO_DEF[k];
  return o;
}
function presetBg(ctx, W, H, kind, main, t, p, u, flat){
  const M = Math.max(W, H), drift = p * 0.04;
  const blob = (x, y, r, col, a) => { const g = ctx.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, hexA(col, a)); g.addColorStop(1, hexA(col, 0)); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); };
  if(kind === 'coin'){
    const img = t.image ? IMG_CACHE.get(t.image) : null;
    if(img && img.complete && img.naturalWidth){
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
      coverDraw(ctx, img, img.naturalWidth, img.naturalHeight, W, H, 0.5, 1.6 - drift, true);
      ctx.fillStyle = 'rgba(0,0,0,0.62)'; ctx.fillRect(0, 0, W, H);
      return;
    }
    kind = 'dark';
  }
  if(kind === 'aurora'){
    ctx.fillStyle = '#050816'; ctx.fillRect(0, 0, W, H);
    blob(W * (0.15 + drift), H * 0.15, M * 0.75, '#3DFFA0', 0.20);
    blob(W * (0.85 - drift), H * 0.35, M * 0.7, '#7C5CFF', 0.30);
    blob(W * 0.6, H * (1.0 - drift), M * 0.7, '#00C2FF', 0.18);
  } else if(kind === 'sunset'){
    const g = ctx.createLinearGradient(0, 0, W * 0.4, H); g.addColorStop(0, '#12061F'); g.addColorStop(0.55, '#3A0F3A'); g.addColorStop(1, '#6B2A12');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    blob(W * (0.9 - drift), H * 0.95, M * 0.8, '#FF7A2F', 0.35);
    blob(W * 0.1, H * 0.05, M * 0.6, '#FF3DBB', 0.18);
  } else if(kind === 'matrix'){
    ctx.fillStyle = '#020604'; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(61,255,160,0.06)'; ctx.lineWidth = 1.5 * u; const st = 54 * u, off = (p * st * 2) % st;
    for(let x = 0; x < W; x += st){ ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
    for(let y = -st + off; y < H; y += st){ ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
    blob(W * 0.8, H * 0.8, M * 0.8, '#3DFFA0', 0.16);
  } else if(flat){
    ctx.fillStyle = '#0A0B0F'; ctx.fillRect(0, 0, W, H);
    blob(W * 0.95, H * 1.05, M * 0.9, main, 0.10);
  } else {
    ctx.fillStyle = '#07080B'; ctx.fillRect(0, 0, W, H);
    blob(W * (0.92 - drift), H * 0.95, M * 0.85, main, 0.22);
    blob(W * 0.05, 0, M * 0.6, '#C09EFF', 0.14);
    ctx.strokeStyle = 'rgba(255,255,255,0.03)'; ctx.lineWidth = 2 * u;
    for(let x = -H; x < W; x += 46 * u){ ctx.beginPath(); ctx.moveTo(x, H); ctx.lineTo(x + H, 0); ctx.stroke(); }
  }
}
/* STORY and POST: the SIMPLE card stays a card (rounded, floating) on a darker, blurred backdrop + CTA, not a full-screen video frame.
   The card's height follows its content (no empty band inside), and card + CTA (+ the coin, in Story) are centered as one group. */
const STORY_CARD = document.createElement('canvas');
function drawSimpleStory(ctx, W, H, t, meta, p, opt){
  const so = { ...simpleOpts(), ...(opt.so || {}) }, u = W / 1080, win = t.pnl >= 0, story = H / W > 1.5;
  const main = so.accent === 'auto' || !ACCENT[so.accent] ? (win ? GREEN : RED) : ACCENT[so.accent];
  const img = t.image ? IMG_CACHE.get(t.image) : null, hero = story && so.coin && !!(img && img.complete && img.naturalWidth);
  ctx.save();
  // backdrop: same background as the card, blurred and darker, so the card reads as an object on top of it
  if(bgReady()){ const b = BG.blur; BG.blur = true; drawBg(ctx, W, H, 1.12); BG.blur = b; }
  else presetBg(ctx, W, H, so.bg, main, t, p, u, so.layout === 'minimal');
  ctx.fillStyle = 'rgba(0,0,0,0.42)'; ctx.fillRect(0, 0, W, H);
  const v = ctx.createRadialGradient(W / 2, H * 0.5, W * 0.3, W / 2, H * 0.5, H * 0.75);
  v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.6)'); ctx.fillStyle = v; ctx.fillRect(0, 0, W, H);
  // the card: width fixed, height = what its content needs
  const io = { ...opt, inner:true, so:{ ...(opt.so || {}), ...(hero ? { coin:false } : {}) } };
  const cw = Math.round(W - 2 * (story ? 64 : 84) * u), r = (story ? 46 : 40) * u;
  const heroS = hero ? 250 * u : 0, heroGap = hero ? 44 * u : 0;
  const ctaGap = (story ? 64 : 42) * u, ctaBlock = (story ? 92 : 74) * u, margin = (story ? 90 : 48) * u;
  const need = drawSimple(ctx, cw, cw, t, meta, p, { ...io, measure:true });
  const maxCh = H - 2 * margin - heroS - heroGap - ctaGap - ctaBlock;
  const ch = Math.round(Math.max(Math.min(cw * 0.62, maxCh), Math.min(need, cw * 1.3, maxCh)));
  if(STORY_CARD.width !== cw || STORY_CARD.height !== ch){ STORY_CARD.width = cw; STORY_CARD.height = ch; }
  const cc = STORY_CARD.getContext('2d'); cc.setTransform(1, 0, 0, 1, 0, 0); cc.clearRect(0, 0, cw, ch);
  drawSimple(cc, cw, ch, t, meta, p, io);
  const total = heroS + heroGap + ch + ctaGap + ctaBlock, top = Math.max(margin, (H - total) / 2);
  const cardTop = top + heroS + heroGap, cx = W / 2, cy = cardTop + ch / 2;
  const k = easeOutBack(seg(p, 0, 0.2)), e = easeOut(seg(p, 0, 0.2));
  ctx.save();
  ctx.translate(cx, cy + (1 - e) * 90 * u); ctx.rotate((1 - e) * -0.05); ctx.scale(0.9 + 0.1 * k, 0.9 + 0.1 * k);
  ctx.globalAlpha = clamp01(e * 1.4);
  ctx.shadowColor = 'rgba(0,0,0,0.7)'; ctx.shadowBlur = 90 * u; ctx.shadowOffsetY = 34 * u;
  rrect(ctx, -cw / 2, -ch / 2, cw, ch, r); ctx.fillStyle = '#07080B'; ctx.fill();
  if(so.layout !== 'minimal'){ ctx.shadowColor = hexA(main, 0.35); ctx.shadowBlur = 70 * u; ctx.shadowOffsetY = 0; ctx.fill(); }
  ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0;
  ctx.save(); rrect(ctx, -cw / 2, -ch / 2, cw, ch, r); ctx.clip(); ctx.drawImage(STORY_CARD, -cw / 2, -ch / 2); ctx.restore();
  rrect(ctx, -cw / 2, -ch / 2, cw, ch, r); ctx.lineWidth = 3 * u; ctx.strokeStyle = 'rgba(255,255,255,0.16)'; ctx.stroke();
  if(so.layout !== 'minimal'){ rrect(ctx, -cw / 2 + 3 * u, -ch / 2 + 3 * u, cw - 6 * u, ch - 6 * u, r - 3 * u); ctx.lineWidth = 2 * u; ctx.strokeStyle = hexA(main, 0.22); ctx.stroke(); }
  ctx.restore();
  // Story: the coin, big, above the card
  if(hero){
    const hk = easeOutBack(seg(p, 0.1, 0.3)), hy = top + heroS / 2 + Math.sin(p * Math.PI) * 6 * u, s0 = heroS;
    ctx.save(); ctx.globalAlpha = clamp01(hk);
    for(let i = 0; i < 2; i++){ ctx.strokeStyle = hexA(main, 0.12 - i * 0.05); ctx.lineWidth = 2 * u; ctx.beginPath(); ctx.arc(cx, hy, s0 * (0.78 + i * 0.22), 0, Math.PI * 2); ctx.stroke(); }
    ctx.translate(cx, hy); ctx.scale(hk, hk); ctx.rotate(-0.08 * (1 - p));
    ctx.shadowColor = so.layout === 'minimal' ? 'rgba(0,0,0,0.6)' : hexA(main, 0.5); ctx.shadowBlur = 70 * u;
    rrect(ctx, -s0 / 2, -s0 / 2, s0, s0, s0 * 0.26); ctx.fillStyle = '#0B0B10'; ctx.fill(); ctx.shadowBlur = 0;
    ctx.save(); rrect(ctx, -s0 / 2, -s0 / 2, s0, s0, s0 * 0.26); ctx.clip();
    const rr = Math.min(s0 / img.naturalWidth, s0 / img.naturalHeight), iw = img.naturalWidth * rr, ih = img.naturalHeight * rr;
    ctx.drawImage(img, -iw / 2, -ih / 2, iw, ih); ctx.restore();
    rrect(ctx, -s0 / 2, -s0 / 2, s0, s0, s0 * 0.26); ctx.lineWidth = 3 * u; ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.stroke();
    ctx.restore();
  }
  // CTA right under the card
  const a = easeOut(seg(p, 0.55, 0.7)), cY = cardTop + ch + ctaGap; ctx.globalAlpha = a; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 16 * u;
  ctx.font = `800 ${(story ? 40 : 32) * u}px ${SANS}`; ctx.fillStyle = '#FFFFFF'; ctx.fillText('Turn your trades into cards', cx, cY + (story ? 36 : 28) * u + (1 - a) * 16 * u);
  ctx.font = `700 ${(story ? 30 : 24) * u}px ${MONO}`; ctx.fillStyle = '#C09EFF'; ctx.fillText('DEGENCARDS', cx, cY + (story ? 84 : 66) * u + (1 - a) * 16 * u);
  ctx.shadowBlur = 0; ctx.globalAlpha = 1;
  const intro = easeOut(seg(p, 0, 0.04)); if(intro < 1){ ctx.fillStyle = `rgba(0,0,0,${1 - intro})`; ctx.fillRect(0, 0, W, H); }
  ctx.restore();
}
function drawSimple(ctx, W, H, t, meta, p, opt){
  if(!opt.inner && W <= H * 1.2) return drawSimpleStory(ctx, W, H, t, meta, p, opt);      // post + story = floating card; wide stays full-bleed
  const so = { ...simpleOpts(), ...(opt.so || {}) }, flat = so.layout === 'minimal';
  const win = t.pnl >= 0, own = bgReady();
  const main = so.accent === 'auto' || !ACCENT[so.accent] ? (win ? GREEN : RED) : ACCENT[so.accent];
  const inner = !!opt.inner, wide = !inner && W > H * 1.2, story = !inner && H / W > 1.5, u = inner ? W / 980 : Math.min(W, H) / 1080;
  const S = inner ? { coin:92, tick:74, big:230, pnl:68, lab:30, val:38, rowH:68, gap:52 } : story ? { coin:118, tick:84, big:250, pnl:74, lab:30, val:40, rowH:78, gap:56 } : wide ? { coin:78, tick:62, big:186, pnl:58, lab:24, val:32, rowH:56, gap:44 } : { coin:86, tick:68, big:212, pnl:62, lab:26, val:34, rowH:60, gap:48 };
  for(const k in S) S[k] *= u;
  const fa = (a, b) => easeOut(seg(p, a, b));
  const pad = (wide ? 84 : story ? 84 : inner ? 64 : 72) * u, L = pad, Rr = W - pad, maxW = wide ? W * 0.56 : W - 2 * pad;
  const img = t.image ? IMG_CACHE.get(t.image) : null, hasImg = so.coin && !!(img && img.complete && img.naturalWidth);
  const bigIsPnl = so.big === 'pnl' && !opt.hideUsd;
  const bigTxt = v => bigIsPnl ? fmt.usd(t.pnl * v) : fmt.pct(t.roi * v);
  const subTxt = v => bigIsPnl ? fmt.pct(t.roi * v) : fmt.usd(t.pnl * v);
  const showSub = !opt.hideUsd && so.sub;
  const bigSize = fitFont(ctx, bigTxt(1), 900, MONO, S.big, maxW);
  const inv = t.roi ? t.pnl / (t.roi / 100) : 0, money = !opt.hideUsd && inv > 0 && isFinite(inv);
  const rows = !so.stats ? [] : flat ? (money ? [['INVESTED', '$' + inv.toFixed(2)], ['SOLD', '$' + Math.max(0, inv + t.pnl).toFixed(2)]] : [['ENTRY MC', mcShort(t.entryMc)], ['EXIT MC', mcShort(t.exitMc)]]) : money
    ? [['INVESTED', '$' + inv.toFixed(2)], ['SOLD', '$' + Math.max(0, inv + t.pnl).toFixed(2)], ['MC', mcShort(t.entryMc) + ' → ' + mcShort(t.exitMc)], ['HOLD', fmt.hold(t.holdTime)]]
    : [['ENTRY MC', mcShort(t.entryMc)], ['EXIT MC', mcShort(t.exitMc)], ['HOLD', fmt.hold(t.holdTime)]];
  const headH = Math.max(hasImg && !(wide && !bgReady()) ? S.coin : 0, S.tick) + 28 * u;
  const blockH = headH + bigSize * 0.95 + (showSub ? S.pnl + 24 * u : 0) + (rows.length ? S.gap + rows.length * S.rowH : 0);
  if(opt.measure) return Math.ceil(pad + 70 * u + 52 * u + blockH + 52 * u + 60 * u + pad);      // floating card: the height its content needs
  ctx.save();
  // background: own photo / video (slow push-in), else a preset
  if(own){
    drawBg(ctx, W, H, 1.06 - 0.06 * easeOut(seg(p, 0, 1)));
    const g = wide ? ctx.createLinearGradient(0, 0, W * 0.75, 0) : ctx.createLinearGradient(0, H, 0, H * 0.1);
    g.addColorStop(0, 'rgba(0,0,0,0.72)'); g.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  } else presetBg(ctx, W, H, so.bg, main, t, p, u, flat);
  const lift = own || so.bg === 'coin';                                  // text sits on an image: add a soft shadow
  const sh = on => { if(on && lift){ ctx.shadowColor = 'rgba(0,0,0,0.55)'; ctx.shadowBlur = 18 * u; ctx.shadowOffsetY = 2 * u; } else { ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0; } };
  // wide hero: the coin, big, on the right (only when the right side is ours)
  if(wide && !own && (hasImg || !flat)){
    const k = easeOutBack(seg(p, 0.06, 0.3)), s = H * 0.5, cx = W * 0.79, cy = H * 0.5 + Math.sin(p * Math.PI) * 6 * u;
    ctx.save(); ctx.globalAlpha = clamp01(k);
    for(let i = 0; i < 3; i++){ ctx.strokeStyle = hexA(main, 0.10 - i * 0.025); ctx.lineWidth = 2 * u; ctx.beginPath(); ctx.arc(cx, cy, s * (0.78 + i * 0.2) * (0.9 + 0.1 * k), 0, Math.PI * 2); ctx.stroke(); }
    ctx.translate(cx, cy); ctx.scale(k, k); ctx.rotate(-0.06 * (1 - p));
    if(hasImg){
      ctx.shadowColor = hexA(main, 0.55); ctx.shadowBlur = 90 * u;
      rrect(ctx, -s / 2, -s / 2, s, s, s * 0.26); ctx.fillStyle = '#0B0B10'; ctx.fill(); ctx.shadowBlur = 0;
      ctx.save(); rrect(ctx, -s / 2, -s / 2, s, s, s * 0.26); ctx.clip();
      const r = Math.min(s / img.naturalWidth, s / img.naturalHeight), iw = img.naturalWidth * r, ih = img.naturalHeight * r;
      ctx.drawImage(img, -iw / 2, -ih / 2, iw, ih); ctx.restore();
      rrect(ctx, -s / 2, -s / 2, s, s, s * 0.26); ctx.lineWidth = 3 * u; ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.stroke();
    } else {
      const tick0 = tk(t.ticker); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      fitFont(ctx, tick0, 900, SANS, s * 0.7, s * 1.3); ctx.fillStyle = hexA(main, 0.16); ctx.fillText(tick0, 0, 0); ctx.textBaseline = 'alphabetic';
    }
    ctx.restore();
  }
  // story hero: the coin, big, above the numbers
  const heroS = story && !own && hasImg ? 330 * u : 0;
  if(heroS){
    const k = easeOutBack(seg(p, 0.06, 0.3)), s0 = heroS, cx = L + s0 / 2, cy = pad + 150 * u + s0 / 2 + Math.sin(p * Math.PI) * 6 * u;
    ctx.save(); ctx.globalAlpha = clamp01(k);
    for(let i = 0; i < 3; i++){ ctx.strokeStyle = hexA(main, 0.10 - i * 0.025); ctx.lineWidth = 2 * u; ctx.beginPath(); ctx.arc(cx, cy, s0 * (0.8 + i * 0.22), 0, Math.PI * 2); ctx.stroke(); }
    ctx.translate(cx, cy); ctx.scale(k, k); ctx.rotate(-0.06 * (1 - p));
    ctx.shadowColor = hexA(main, 0.55); ctx.shadowBlur = 90 * u;
    rrect(ctx, -s0 / 2, -s0 / 2, s0, s0, s0 * 0.26); ctx.fillStyle = '#0B0B10'; ctx.fill(); ctx.shadowBlur = 0;
    ctx.save(); rrect(ctx, -s0 / 2, -s0 / 2, s0, s0, s0 * 0.26); ctx.clip();
    const r = Math.min(s0 / img.naturalWidth, s0 / img.naturalHeight), iw = img.naturalWidth * r, ih = img.naturalHeight * r;
    ctx.drawImage(img, -iw / 2, -ih / 2, iw, ih); ctx.restore();
    rrect(ctx, -s0 / 2, -s0 / 2, s0, s0, s0 * 0.26); ctx.lineWidth = 3 * u; ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.stroke();
    ctx.restore();
  }
  ctx.textBaseline = 'alphabetic';
  // header: logo + date
  ctx.globalAlpha = fa(0, 0.12); sh(true);
  ctx.textAlign = 'left'; ctx.font = `900 ${(story ? 50 : 44) * u}px ${SANS}`; ctx.fillStyle = '#FFFFFF'; ctx.fillText('DEGEN', L, pad + 36 * u);
  const dw = ctx.measureText('DEGEN').width; ctx.fillStyle = '#C09EFF'; ctx.fillText('CARDS', L + dw, pad + 36 * u);
  if(so.date){ ctx.textAlign = 'right'; ctx.font = `600 ${(story ? 28 : 25) * u}px ${MONO}`; ctx.fillStyle = 'rgba(255,255,255,0.66)'; ctx.fillText(fmt.date(t.timestamp).toUpperCase(), Rr, pad + 32 * u); }
  // body content
  const areaT = heroS ? pad + 150 * u + heroS + 90 * u : pad + 70 * u, areaB = H - pad - 60 * u;
  let y = Math.max(areaT, areaT + (areaB - areaT - blockH) * (story ? 0.56 : 0.5));
  // coin + ticker + rarity pill
  const a1 = fa(0.03, 0.16); ctx.globalAlpha = a1; const dy = (1 - a1) * 24 * u;
  let tx = L; const s = S.coin;
  if(hasImg && !(wide && !own) && !heroS){
    sh(false);
    ctx.save(); rrect(ctx, L, y + dy, s, s, s * 0.28); ctx.fillStyle = '#0B0B10'; ctx.fill(); ctx.clip();
    const r = Math.min(s / img.naturalWidth, s / img.naturalHeight), iw = img.naturalWidth * r, ih = img.naturalHeight * r;
    ctx.drawImage(img, L + (s - iw) / 2, y + dy + (s - ih) / 2, iw, ih); ctx.restore();
    rrect(ctx, L, y + dy, s, s, s * 0.28); ctx.lineWidth = 2 * u; ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.stroke();
    tx = L + s + 24 * u;
  }
  const midY = y + dy + Math.max(s, S.tick) / 2;
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; sh(true);
  const tick = tk(t.ticker), pillW = so.rarity && meta && meta.rarity ? 200 * u : 0;
  fitFont(ctx, tick, 900, SANS, S.tick, maxW - (tx - L) - pillW); ctx.fillStyle = '#FFFFFF'; ctx.fillText(tick, tx, midY + 2 * u);
  if(pillW){
    const tw = ctx.measureText(tick).width, rar = RARITY_HEX[meta.rarity] || '#ADADB8', rt = meta.rarity.toUpperCase();
    ctx.font = `800 ${(story ? 26 : 22) * u}px ${MONO}`; const pw = ctx.measureText(rt).width + 30 * u, ph = (story ? 46 : 40) * u, px = tx + tw + 20 * u;
    sh(false); rrect(ctx, px, midY - ph / 2, pw, ph, ph / 2); ctx.fillStyle = hexA(rar, 0.16); ctx.fill(); ctx.lineWidth = 2 * u; ctx.strokeStyle = hexA(rar, 0.6); ctx.stroke();
    ctx.fillStyle = rar; ctx.fillText(rt, px + 15 * u, midY + 2 * u);
  }
  ctx.textBaseline = 'alphabetic';
  y += headH;
  // big number (count-up) + light sweep across the glyphs at the end
  const cnt = easeOut(seg(p, 0.06, 0.55));
  ctx.globalAlpha = fa(0.05, 0.14);
  ctx.font = `900 ${bigSize}px ${MONO}`; y += bigSize * 0.8;
  const pulse = seg(p, 0.55, 0.62), glow = flat ? (lift ? 24 : 0) : 50 + 40 * Math.sin(pulse * Math.PI);
  ctx.fillStyle = main; ctx.shadowColor = hexA(main, lift ? 0.7 : 0.55); ctx.shadowBlur = glow * u; ctx.shadowOffsetY = 0;
  ctx.fillText(bigTxt(cnt), L - 4 * u, y); ctx.shadowBlur = 0;
  const sw = flat ? 0 : seg(p, 0.82, 0.97);
  if(sw > 0 && sw < 1){
    const bw = ctx.measureText(bigTxt(1)).width, sx = L - bw * 0.3 + bw * 1.6 * easeOut(sw);
    const lg = ctx.createLinearGradient(sx - 120 * u, 0, sx + 120 * u, 0);
    lg.addColorStop(0, 'rgba(255,255,255,0)'); lg.addColorStop(0.5, 'rgba(255,255,255,0.75)'); lg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = lg; ctx.fillText(bigTxt(1), L - 4 * u, y);
  }
  y += bigSize * 0.15;
  if(showSub){
    ctx.globalAlpha = fa(0.12, 0.24); sh(true);
    y += S.pnl; ctx.font = `800 ${S.pnl}px ${MONO}`; ctx.fillStyle = main; ctx.fillText(subTxt(cnt), L, y);
    y += 24 * u;
  }
  // rows
  if(rows.length){
    y += S.gap;
    const rw = wide ? Math.min(maxW, 620 * u) : maxW;                // rows run the full width of the card
    rows.forEach(([l, v], i) => {
      const a = fa(0.3 + i * 0.06, 0.45 + i * 0.06); ctx.globalAlpha = a; const dx = (1 - a) * -30 * u;
      sh(false); ctx.strokeStyle = 'rgba(255,255,255,0.14)'; ctx.lineWidth = 2 * u; ctx.beginPath(); ctx.moveTo(L + dx, y); ctx.lineTo(L + rw + dx, y); ctx.stroke();
      sh(true);
      ctx.textAlign = 'left'; ctx.font = `700 ${S.lab}px ${SANS}`; ctx.fillStyle = 'rgba(255,255,255,0.62)'; ctx.fillText(l, L + dx, y + S.rowH * 0.68);
      ctx.textAlign = 'right'; ctx.font = `800 ${S.val}px ${MONO}`; ctx.fillStyle = '#FFFFFF'; ctx.fillText(v, L + rw + dx, y + S.rowH * 0.7);
      y += S.rowH;
    });
  }
  // footer
  ctx.globalAlpha = fa(0.5, 0.65); sh(true);
  const fy = H - pad + 6 * u, hn = handle(), tno = so.tradeNo ? '#' + String(t.tradeId).padStart(4, '0') + (t.source === 'wallet' ? '  ·  ON-CHAIN' : '') : '';
  ctx.font = `600 ${(story ? 27 : 24) * u}px ${MONO}`; const tnoW = tno ? ctx.measureText(tno).width + 28 * u : 0;
  ctx.textAlign = 'left'; ctx.font = `700 ${(story ? 30 : 26) * u}px ${SANS}`;
  if(hn){
    ctx.fillStyle = '#FFFFFF'; ctx.fillText(hn, L, fy); const hw = ctx.measureText(hn).width;
    ctx.font = `600 ${(story ? 26 : 22) * u}px ${SANS}`; const url = '  ·  degencards.vercel.app';
    if(L + hw + ctx.measureText(url).width <= Rr - tnoW){ ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.fillText(url, L + hw, fy); }
  } else { ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.fillText('degencards.vercel.app', L, fy); }
  ctx.textAlign = 'right'; ctx.font = `600 ${(story ? 27 : 24) * u}px ${MONO}`; ctx.fillStyle = 'rgba(255,255,255,0.5)';
  if(tno) ctx.fillText(tno, Rr, fy);
  sh(false); ctx.globalAlpha = 1;
  if(!opt.video && !own && so.bg !== 'coin' && !flat){ ctx.fillStyle = grainPattern(ctx); ctx.fillRect(0, 0, W, H); }
  const intro = fa(0, 0.04); if(intro < 1){ ctx.fillStyle = `rgba(0,0,0,${1 - intro})`; ctx.fillRect(0, 0, W, H); }
  ctx.restore();
}

/* ---------- ART card: the trade laid over a real masterpiece (no nudity: works showing it were removed) ----------
   Paintings, sculptures and engravings in the public domain: The Metropolitan Museum of Art and The Cleveland Museum of Art,
   Open Access (CC0). Cropped (sculptures re-lit darker) and served from /art (same origin, CSP-safe).
   White monochrome candles, Entry / Exit tags, big result, quiet stats: the artwork does the talking. */
const ART_MS = 6200;
const ART_KINDS = [['all','All'],['paint','Paintings'],['sculpt','Sculpture'],['print','Engravings']];
const ART = [
  { id:'victory',   kind:'sculpt', name:'Victory',     title:'Victory with Cornucopia',                  by:'Roman',                   year:'c. 50 CE', fx:.50, fy:.30, dim:.04, mood:'win', free:true },
  { id:'horsemen',  kind:'print',  name:'Horsemen',    title:'The Four Horsemen of the Apocalypse',      by:'Albrecht Dürer',          year:'1498',    fx:.50, fy:.42, dim:.42, mood:'loss', free:true },
  { id:'lions',     kind:'paint',  name:'Lions',       title:'Lions in a Mountainous Landscape',         by:'Théodore Géricault',      year:'c. 1819', fx:.36, fy:.45, dim:.12, mood:'win', free:true },
  { id:'tempest',   kind:'paint',  name:'Tempest',     title:'Christ Asleep during the Tempest',         by:'Eugène Delacroix',        year:'c. 1853', fx:.45, fy:.45, dim:.16, mood:'loss', free:true },
  { id:'summit',    kind:'paint',  name:'Summit',      title:"The Rocky Mountains, Lander's Peak",       by:'Albert Bierstadt',        year:'1863',    fx:.50, fy:.30, dim:.36, mood:'win', free:true },
  { id:'angel',     kind:'sculpt', name:'Angel',       title:'Kneeling Angel',                           by:'Ignaz Günther',           year:'c. 1760', fx:.55, fy:.30, dim:.04, mood:'win', free:true },
  { id:'medusa',    kind:'sculpt', name:'Medusa',      title:'Head of Medusa',                           by:'Antonio Canova',          year:'1807',    fx:.50, fy:.48, dim:.06, mood:'loss' },
  { id:'archangel', kind:'print',  name:'Archangel',   title:'Saint Michael Fighting the Dragon',        by:'Albrecht Dürer',          year:'1498',    fx:.50, fy:.32, dim:.42, mood:'win' },
  { id:'abyss',     kind:'print',  name:'Abyss',       title:'And I Saw an Angel Coming Down from Heaven', by:'Odilon Redon',          year:'1899',    fx:.45, fy:.45, dim:.08, mood:'loss' },
  { id:'tombangel', kind:'sculpt', name:'Tomb Angel',  title:'Angel from a Tomb',                        by:'Tino di Camaino',         year:'c. 1335', fx:.55, fy:.32, dim:.06, mood:'loss' },
  { id:'northcape', kind:'paint',  name:'North Cape',  title:'The North Cape by Moonlight',              by:'Peder Balke',             year:'1848',    fx:.50, fy:.45, dim:.04, mood:'win' },
  { id:'michael',   kind:'print',  name:'Michael',     title:'The Archangel Michael Piercing the Dragon', by:'Martin Schongauer',      year:'c. 1475', fx:.50, fy:.32, dim:.42, mood:'win' },
  { id:'vestal',    kind:'sculpt', name:'Vestal',      title:'The Vestal',                               by:'Antonio Canova',          year:'c. 1821', fx:.50, fy:.34, dim:.08, mood:'loss', free:true },
  { id:'prisons',   kind:'print',  name:'Prisons',     title:'Prisoners on a Projecting Platform',       by:'Giovanni Battista Piranesi', year:'1750', fx:.50, fy:.45, dim:.40, mood:'loss' },
  { id:'colosseum', kind:'print',  name:'Colosseum',   title:'The Colosseum',                            by:'Giovanni Battista Piranesi', year:'1776', fx:.50, fy:.50, dim:.40, mood:'win' },
  { id:'mountainstorm', kind:'paint', name:'Mountain Storm', title:'Storm in the Mountains',             by:'Frederic Edwin Church',   year:'1847',    fx:.45, fy:.45, dim:.14, mood:'loss' },
  { id:'catskill',  kind:'paint',  name:'Catskill',    title:'The Clove, a Storm Scene',                 by:'Jasper F. Cropsey',       year:'1851',    fx:.60, fy:.45, dim:.10, mood:'loss' },
  { id:'afterstorm',kind:'paint',  name:'After the Storm', title:'Early Morning After a Storm at Sea',    by:'Winslow Homer',           year:'1903',    fx:.50, fy:.50, dim:.24, mood:'loss' },
  { id:'crossing',  kind:'paint',  name:'Crossing',    title:'Washington Crossing the Delaware',         by:'Emanuel Leutze',          year:'1851',    fx:.40, fy:.40, dim:.24, mood:'win' },
  { id:'hunt',      kind:'paint',  name:'The Hunt',    title:'Wolf and Fox Hunt',                        by:'Peter Paul Rubens',       year:'c. 1616', fx:.52, fy:.45, dim:.24, mood:'win' },
  { id:'tiger',     kind:'paint',  name:'Tiger',       title:'Tiger and Cubs',                           by:'Jean-Léon Gérôme',        year:'c. 1884', fx:.60, fy:.55, dim:.08, mood:'win' },
  { id:'horsefair', kind:'paint',  name:'Horse Fair',  title:'The Horse Fair',                           by:'Rosa Bonheur',            year:'1855',    fx:.50, fy:.50, dim:.24, mood:'win' },
  { id:'fleet',     kind:'paint',  name:'Fleet',       title:'The Trojan Women Setting Fire to Their Fleet', by:'Claude Lorrain',      year:'c. 1643', fx:.56, fy:.40, dim:.28, mood:'win' },
  { id:'champigny', kind:'paint',  name:'Last Stand',  title:'The Defense of Champigny',                 by:'Édouard Detaille',        year:'1879',    fx:.62, fy:.55, dim:.30, mood:'win' },
  { id:'andes',     kind:'paint',  name:'Andes',       title:'Heart of the Andes',                       by:'Frederic Edwin Church',   year:'1859',    fx:.56, fy:.40, dim:.34, mood:'win' },
  { id:'toledo',    kind:'paint',  name:'Toledo',      title:'View of Toledo',                           by:'El Greco',                year:'c. 1600', fx:.55, fy:.35, dim:.18, mood:'loss' },
  { id:'shipwreck', kind:'paint',  name:'Shipwreck',   title:'A Shipwreck in a Storm',                   by:'Jean Pillement',          year:'1782',    fx:.44, fy:.45, dim:.18, mood:'loss' },
  { id:'sodom',     kind:'paint',  name:'Sodom',       title:'The Burning of Sodom',                     by:'Camille Corot',           year:'1857',    fx:.34, fy:.45, dim:.08, mood:'loss' },
];
const AO_KEY = 'dc_art_opts2', AO_KEY_OLD = 'dc_art_opts';      // v2: the card is classic by default, extras are opt-in
const AO_DEF = { pick:'auto', big:'pnl', tone:'natural', ink:'white', chart:true, stats:false, coin:true, date:false, credit:false };
const AO_GROUPS = [
  ['big',  'Big number', [['pnl','PnL $'],['roi','ROI %']]],
  ['tone', 'Tone',       [['natural','Natural'],['noir','Noir'],['marble','Marble'],['gold','Gold'],['dark','Dark']]],
  ['ink',  'Number',     [['white','White'],['result','Green / red']]],
];
const AO_SHOW = [['chart','Chart'],['coin','Coin logo'],['stats','Trade details'],['date','Date'],['credit','Artwork credit']];
const AO_PRO = { tone:['marble','gold','dark'] };
const artById = id => ART.find(a => a.id === id);
const artLocked = a => proLocked() && !a.free;
let AO_SAVED = (() => { let v = {}, old = false; try{ const raw = localStorage.getItem(AO_KEY); old = raw == null; v = JSON.parse(raw || localStorage.getItem(AO_KEY_OLD) || '{}') || {}; }catch(e){} const o = { ...AO_DEF };
  if(v.pick === 'auto' || artById(v.pick)) o.pick = v.pick;
  for(const [k, , opts] of AO_GROUPS) if(opts.some(x => x[0] === v[k])) o[k] = v[k];
  if(!old) for(const [k] of AO_SHOW) if(typeof v[k] === 'boolean') o[k] = v[k];       // the old show switches are not carried over: classic first
  return o; })();
function artOpts(){                                                   // free: PRO-only choices fall back to the default
  const o = { ...AO_SAVED };
  if(proLocked()){ for(const k in AO_PRO) if(AO_PRO[k].includes(o[k])) o[k] = AO_DEF[k]; const a = artById(o.pick); if(a && !a.free) o.pick = 'auto'; }
  return o;
}
const hashId = s => { s = String(s == null ? '' : s); let h = 2166136261; for(let i = 0; i < s.length; i++){ h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
/* Auto = the painting follows the trade: triumph for a win, drama for a loss; stable for a given trade */
function artPick(t, o){
  const a = o.pick !== 'auto' && artById(o.pick); if(a && !artLocked(a)) return a;
  const mood = t && t.pnl < 0 ? 'loss' : 'win';
  let pool = ART.filter(x => x.mood === mood && !artLocked(x)); if(!pool.length) pool = ART.filter(x => !artLocked(x));
  return pool[hashId((t && (t.id || t.tradeId)) + ':' + mood) % pool.length];
}
const ART_IMG = new Map();
let artOnLoad = null;                                                 // the sheet re-renders its thumbnails once a painting lands
function artImg(a){
  if(!a) return null;
  let im = ART_IMG.get(a.id);
  if(!im){ im = new Image(); im.decoding = 'async'; ART_IMG.set(a.id, im); im.onload = () => { if(artOnLoad) artOnLoad(a); }; im.onerror = () => ART_IMG.delete(a.id); im.src = '/art/' + a.id + '.webp'; }
  return im;
}
function artReady(t, ao){
  const a = artPick(t, { ...artOpts(), ...(ao || {}) }), im = artImg(a);
  if(im.complete && im.naturalWidth) return Promise.resolve(im);
  return new Promise(r => { const to = setTimeout(() => r(null), 8000); im.addEventListener('load', () => { clearTimeout(to); r(im); }, { once:true }); im.addEventListener('error', () => { clearTimeout(to); r(null); }, { once:true }); });
}
/* tones, computed once per artwork and tone (no ctx.filter: it isn't on every Safari)
   noir = black & white, deep contrast · marble = soft silver black & white · gold = warm duotone */
const ART_GRADE = new Map();
const GOLD_RAMP = (() => { const st = [[0,[10,7,4]],[0.38,[88,58,26]],[0.72,[201,160,98]],[1,[255,244,220]]], r = new Uint8ClampedArray(256*3);
  for(let v = 0; v < 256; v++){ const x = v/255; let k = 0; while(k < st.length - 2 && x > st[k+1][0]) k++;
    const [a, ca] = st[k], [b, cb] = st[k+1], f = Math.max(0, Math.min(1, (x - a) / (b - a)));
    for(let c = 0; c < 3; c++) r[v*3+c] = ca[c] + (cb[c] - ca[c]) * f; }
  return r; })();
function artGrade(a, im, tone){
  if(tone !== 'noir' && tone !== 'marble' && tone !== 'gold') return im;
  const key = a.id + ':' + tone; let c = ART_GRADE.get(key); if(c) return c;
  c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight;
  const g = c.getContext('2d'); g.drawImage(im, 0, 0);
  try{ const d = g.getImageData(0, 0, c.width, c.height), px = d.data;
    for(let i = 0; i < px.length; i += 4){
      let v = px[i] * 0.3 + px[i+1] * 0.59 + px[i+2] * 0.11;
      if(tone === 'noir'){ v = (v - 128) * 1.22 + 120; v = v < 0 ? 0 : v > 255 ? 255 : v; px[i] = v * 1.02; px[i+1] = v; px[i+2] = v * 0.96; }
      else if(tone === 'marble'){ v = 26 + v * 0.84; v = (v - 128) * 0.96 + 134; v = v < 0 ? 0 : v > 255 ? 255 : v; px[i] = v * 0.96; px[i+1] = v * 0.985; px[i+2] = Math.min(255, v * 1.04); }
      else { v = (v - 128) * 1.1 + 126; v = v < 0 ? 0 : v > 255 ? 255 : v | 0; px[i] = GOLD_RAMP[v*3]; px[i+1] = GOLD_RAMP[v*3+1]; px[i+2] = GOLD_RAMP[v*3+2]; }
    }
    g.putImageData(d, 0, 0); }catch(e){}
  ART_GRADE.set(key, c); return c;
}
/* cover-draw around a focal point (fx, fy), slow push-in with zoom > 1 */
function focalDraw(ctx, src, iw, ih, W, H, fx, fy, zoom){
  const r = Math.max(W / iw, H / ih) * (zoom || 1), dw = iw * r, dh = ih * r;
  const x = Math.min(0, Math.max(W - dw, W / 2 - fx * dw)), y = Math.min(0, Math.max(H - dh, H / 2 - fy * dh));
  ctx.save(); ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  try{ ctx.drawImage(src, x, y, dw, dh); }catch(e){}
  ctx.restore();
}
/* sculptures are cut out (transparent background) and placed whole on one flat backdrop: the colour behind the statue is
   exactly the colour around it, in every format. The backdrop follows the tone (noir / marble / gold). */
const SCULPT_BG = [14, 13, 12];
function gradePx(rgb, tone){
  let [r, g, b] = rgb, v = r * 0.3 + g * 0.59 + b * 0.11;
  if(tone === 'noir'){ v = Math.max(0, Math.min(255, (v - 128) * 1.22 + 120)); return [v * 1.02, v, v * 0.96]; }
  if(tone === 'marble'){ v = 26 + v * 0.84; v = Math.max(0, Math.min(255, (v - 128) * 0.96 + 134)); return [v * 0.96, v * 0.985, Math.min(255, v * 1.04)]; }
  if(tone === 'gold'){ v = Math.max(0, Math.min(255, (v - 128) * 1.1 + 126)) | 0; return [GOLD_RAMP[v*3], GOLD_RAMP[v*3+1], GOLD_RAMP[v*3+2]]; }
  return [r, g, b];
}
function fitWhole(ctx, src, iw, ih, W, H, a, zoom, tone){
  const [r0, g0, b0] = gradePx(SCULPT_BG, tone);
  ctx.save(); ctx.fillStyle = `rgb(${r0|0},${g0|0},${b0|0})`; ctx.fillRect(0, 0, W, H);
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  const z = 1 + (zoom - 1) * 0.5, r = Math.min(W / iw, H / ih) * 0.95 * z, dw = iw * r, dh = ih * r;
  try{ ctx.drawImage(src, (W - dw) / 2, (H - dh) / 2, dw, dh); }catch(e){}
  ctx.restore();
}
function artBackdrop(ctx, W, H, t, ao, p, blur){
  const zoom = blur ? 1.15 : 1.1 - 0.1 * easeOut(seg(p, 0, 1));
  ctx.fillStyle = '#0B0A09'; ctx.fillRect(0, 0, W, H);
  if(bgReady()){ const b = BG.blur; if(blur) BG.blur = true; drawBg(ctx, W, H, zoom); BG.blur = b; return; }
  const a = artPick(t, ao), im = artImg(a);
  if(!(im && im.complete && im.naturalWidth)) return;
  const src = artGrade(a, im, ao.tone), iw = im.naturalWidth, ih = im.naturalHeight;
  if(a.kind === 'sculpt' && !blur) fitWhole(ctx, src, iw, ih, W, H, a, zoom, ao.tone);
  else focalDraw(ctx, blur ? softBlur(src, iw, ih, Math.max(iw, ih) / 48) : src, iw, ih, W, H, a.fx, a.fy, zoom);
  const dim = a.dim + (ao.tone === 'dark' ? 0.24 : 0);
  if(dim > 0){ ctx.fillStyle = `rgba(0,0,0,${dim})`; ctx.fillRect(0, 0, W, H); }
}
/* the chart: white candles (down = hollow / faint), Entry and Exit tags. Drawn on a layer, then shadowed once. */
const ART_LAYER = document.createElement('canvas');
function artChart(ctx, t, x, y, w, h, p, u, mini){
  const ch = t.chart && t.chart.v === 2 && t.chart.c && t.chart.c.length ? t.chart : null; if(!ch) return;
  let cs = ch.c, iv = ch.i;
  // wide candles on the artwork: consecutive candles merged (real OHLC) until each one gets ~30 units of width
  const target = Math.max(22, Math.floor(w / (30 * u)));
  if(cs.length > target){ const gN = Math.ceil(cs.length / target), mg = [];
    for(let i = 0; i < cs.length; i += gN){ const b = cs.slice(i, i + gN); let hi = -Infinity, lo = Infinity; for(const c of b){ if(c[2] > hi) hi = c[2]; if(c[3] < lo) lo = c[3]; }
      mg.push([b[0][0], b[0][1], hi, lo, b[b.length - 1][4]]); }
    cs = mg; iv = iv * gN; }
  // short wicks: a wick never runs longer than ~0.6 of its body (at least 2.5% of the range); a fill on a candle stays inside it
  { let bh = -Infinity, bl = Infinity; for(const c of cs){ bh = Math.max(bh, c[1], c[4]); bl = Math.min(bl, c[1], c[4]); }
    const R0 = Math.max(1e-12, bh - bl), fl = (ch.m || []).filter(m => m[2] > 0);
    cs = cs.map(c => { const top = Math.max(c[1], c[4]), bot = Math.min(c[1], c[4]), cap = Math.max((top - bot) * 0.6, R0 * 0.025);
      let hi = Math.min(c[2], top + cap), lo = Math.max(c[3], bot - cap);
      for(const m of fl) if(m[0] >= c[0] && m[0] < c[0] + iv){ hi = Math.max(hi, Math.min(c[2], m[2])); lo = Math.min(lo, Math.max(c[3], m[2])); }
      return [c[0], c[1], hi, lo, c[4]]; }); }
  const x0 = ch.w ? ch.w[0] : cs[0][0], x1 = ch.w ? ch.w[1] : cs[cs.length-1][0] + iv;
  let y0 = Infinity, y1 = -Infinity; for(const c of cs){ if(c[3] < y0) y0 = c[3]; if(c[2] > y1) y1 = c[2]; }
  if(!(y1 - y0 > 1e-12)){ y0 *= 0.95; y1 = y1 * 1.05 + 1e-9; }
  const pad = (y1 - y0) * 0.06; y0 -= pad; y1 += pad;
  const lw = Math.ceil(w), lh = Math.ceil(h);
  if(ART_LAYER.width !== lw || ART_LAYER.height !== lh){ ART_LAYER.width = lw; ART_LAYER.height = lh; }
  const g = ART_LAYER.getContext('2d'); g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, lw, lh);
  const X = v => ((v - x0) / (x1 - x0)) * w, Y = v => (1 - (v - y0) / (y1 - y0)) * h;
  const drawP = easeOut(seg(p, 0.12, 0.62)), n = Math.ceil(cs.length * drawP);
  const slot = (iv / (x1 - x0)) * w, bw = Math.max(3 * u, Math.min(slot - 5 * u, slot * 0.66)), hollow = bw >= 5 * u;
  for(let i = 0; i < n; i++){
    const [ts, o, hi, lo, c] = cs[i], up = c >= o, cx = X(ts + iv / 2), top = Y(Math.max(o, c)), bot = Y(Math.min(o, c)), bh = Math.max(1.6 * u, bot - top);
    g.strokeStyle = up ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.85)'; g.lineWidth = Math.max(1.6 * u, Math.min(3 * u, bw * 0.14));
    g.beginPath(); g.moveTo(cx, Y(hi)); g.lineTo(cx, top); g.moveTo(cx, top + bh); g.lineTo(cx, Y(lo)); g.stroke();
    if(up){ g.fillStyle = '#FFFFFF'; g.fillRect(cx - bw / 2, top, bw, bh); }
    else if(hollow){ g.fillStyle = 'rgba(10,10,14,0.55)'; g.fillRect(cx - bw / 2, top, bw, bh); g.lineWidth = Math.max(1.6 * u, Math.min(2.8 * u, bw * 0.12)); g.strokeStyle = 'rgba(255,255,255,0.95)'; const lw2 = g.lineWidth / 2; g.strokeRect(cx - bw / 2 + lw2, top + lw2, bw - 2 * lw2, Math.max(0.5, bh - 2 * lw2)); }
    else { g.fillStyle = 'rgba(255,255,255,0.5)'; g.fillRect(cx - bw / 2, top, bw, bh); }
  }
  // fills: first buy = Entry, last sell = Exit, the others as small dots
  const at = ts => { const c = cs.find(c => ts < c[0] + iv) || cs[cs.length-1]; return (c[2] + c[3]) / 2; };
  const fills = (ch.m || []).map(m => ({ ts:m[0], k:m[1], v:m[2] > 0 ? m[2] : at(m[0]) })).sort((a, b) => a.ts - b.ts);
  const buys = fills.filter(f => f.k === 'b'), sells = fills.filter(f => f.k === 's');
  const entry = buys[0], exit = sells[sells.length - 1];
  const px = f => x + Math.min(w, Math.max(0, X(f.ts))), py = f => y + Math.min(h, Math.max(0, Y(f.v)));
  const kd = easeOut(seg(p, 0.6, 0.7));
  ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.55)'; ctx.shadowBlur = 14 * u; ctx.shadowOffsetY = 3 * u;
  ctx.drawImage(ART_LAYER, x, y); ctx.restore();
  if(kd > 0){ ctx.save(); ctx.globalAlpha *= kd; ctx.fillStyle = 'rgba(255,255,255,0.85)';
    for(const f of fills) if(f !== entry && f !== exit){ ctx.beginPath(); ctx.arc(px(f), py(f), 4 * u, 0, Math.PI * 2); ctx.fill(); }
    ctx.restore(); }
  if(mini){                                                          // speech bubbles, never over the candles: the tail points at the fill
    const k = easeOutBack(seg(p, 0.62, 0.76)); if(k <= 0) return;
    const tags = []; if(entry) tags.push({ f:entry, label:'BUY', light:true }); if(exit) tags.push({ f:exit, label:'SELL', light:false });
    const th = 48 * u, r = 12 * u, tw = 22 * u, tl = 12 * u, off = 4 * u, gap = 8 * u;
    const cand = cs.map(c => ({ xc: x + X(c[0] + iv / 2), t: y + Y(c[2]), b: y + Y(c[3]) })), halfC = bw / 2 + 3 * u;
    const topOf = (a, b) => { let m = Infinity; for(const c of cand) if(c.xc + halfC >= a && c.xc - halfC <= b) m = Math.min(m, c.t); return m; };
    const botOf = (a, b) => { let m = -Infinity; for(const c of cand) if(c.xc + halfC >= a && c.xc - halfC <= b) m = Math.max(m, c.b); return m; };
    const minY = y - th - tl - 40 * u, maxY = y + h + 44 * u;          // room above / below the chart
    ctx.save(); ctx.globalAlpha *= clamp01(k);
    ctx.font = `800 ${24 * u}px ${SANS}`; try{ ctx.letterSpacing = (1.5 * u) + "px"; }catch(e){}
    tags.forEach(T => { T.w = ctx.measureText(T.label).width + 40 * u; T.fx = px(T.f); T.fy = py(T.f); T.bx = Math.min(x + w - T.w, Math.max(x, T.fx - T.w / 2)); });
    const place = (T, above) => {                                     // bubble clear of every candle under it, as close to the fill as possible
      const a = T.bx - 4 * u, b = T.bx + T.w + 4 * u;
      if(above){ const bottom = Math.min(T.fy - off - tl, topOf(a, b) - gap); return { above, by: bottom - th, tip: bottom + tl, over: Math.max(0, minY - (bottom - th)) }; }
      const top = Math.max(T.fy + off + tl, botOf(a, b) + gap); return { above, by: top, tip: top - tl, over: Math.max(0, top + th - maxY) };
    };
    // each bubble takes the side where it sits closest to its fill (both may end up on the same side); out of room costs a lot
    const cost = (T, P) => P.over * 10 + Math.abs(P.tip - T.fy);
    const opts = tags.map((T, i) => { const pref = tags.length === 2 ? (T.f.v >= tags[1 - i].f.v) : true; const A = place(T, pref), B = place(T, !pref);
      return cost(T, A) <= cost(T, B) + 6 * u ? [A, B] : [B, A]; });
    const boxOf = (T, P) => ({ l: T.bx, r: T.bx + T.w, t: P.by, b: P.by + th });
    const hit = (a, b) => a.l < b.r + 10 * u && b.l < a.r + 10 * u && a.t < b.b + 8 * u && b.t < a.b + 8 * u;
    let best = null;                                                    // two bubbles: best combination that doesn't overlap
    if(tags.length === 2){ for(const a of [0, 1]) for(const b of [0, 1]){ const A = opts[0][a], B = opts[1][b];
        const c = cost(tags[0], A) + cost(tags[1], B) + (hit(boxOf(tags[0], A), boxOf(tags[1], B)) ? 1e6 : 0);
        if(!best || c < best.c) best = { c, A, B }; }
      Object.assign(tags[0], best.A); Object.assign(tags[1], best.B); }
    else tags.forEach((T, i) => Object.assign(T, opts[i][0]));
    tags.forEach(T => { if(T.over > 0){ if(T.above){ T.by += T.over; } else { T.by -= T.over; } T.tip = T.above ? T.by + th + tl : T.by - tl; } });
    if(tags.length === 2 && tags[0].above === tags[1].above){          // same side and touching: side by side
      const [A, B] = tags, l = A.bx <= B.bx ? A : B, rr = l === A ? B : A;
      if(l.bx + l.w + 12 * u > rr.bx && Math.abs(l.by - rr.by) < th + 8 * u){ rr.bx = Math.min(x + w - rr.w, l.bx + l.w + 12 * u); if(rr.bx < l.bx + l.w + 12 * u) l.bx = Math.max(x, rr.bx - l.w - 12 * u); } }
    tags.forEach(T => {
      const { fx, fy, bx, by, above } = T, Wb = T.w, tipY = T.tip, near = above ? tipY >= fy - off - 1 : tipY <= fy + off + 1;
      const tx = Math.min(bx + Wb - r - tw / 2, Math.max(bx + r + tw / 2, fx)), tipX = Math.min(bx + Wb - r, Math.max(bx + r, fx));
      ctx.save(); ctx.translate(tipX, tipY); ctx.scale(k, k); ctx.translate(-tipX, -tipY);
      if(!near){                                                      // candles in the way: a thin stem down to a dot on the fill
        ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 6 * u;
        ctx.strokeStyle = '#FFFFFF'; ctx.lineWidth = 2 * u; ctx.beginPath(); ctx.moveTo(tipX, tipY); ctx.lineTo(fx, fy + (above ? -7 : 7) * u); ctx.stroke();
        ctx.beginPath(); ctx.arc(fx, fy, 7 * u, 0, Math.PI * 2); ctx.fillStyle = '#FFFFFF'; ctx.fill(); ctx.restore();
        ctx.beginPath(); ctx.arc(fx, fy, 3.2 * u, 0, Math.PI * 2); ctx.fillStyle = '#0B0B0E'; ctx.fill();
      }
      ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = 16 * u; ctx.shadowOffsetY = 3 * u;
      ctx.beginPath();                                                  // bubble + tail as one shape
      if(above){
        ctx.moveTo(bx + r, by); ctx.lineTo(bx + Wb - r, by); ctx.arcTo(bx + Wb, by, bx + Wb, by + r, r); ctx.lineTo(bx + Wb, by + th - r); ctx.arcTo(bx + Wb, by + th, bx + Wb - r, by + th, r);
        ctx.lineTo(tx + tw / 2, by + th); ctx.lineTo(near ? fx : tipX, near ? fy - off : tipY); ctx.lineTo(tx - tw / 2, by + th);
        ctx.lineTo(bx + r, by + th); ctx.arcTo(bx, by + th, bx, by + th - r, r); ctx.lineTo(bx, by + r); ctx.arcTo(bx, by, bx + r, by, r);
      } else {
        ctx.moveTo(bx + r, by); ctx.lineTo(tx - tw / 2, by); ctx.lineTo(near ? fx : tipX, near ? fy + off : tipY); ctx.lineTo(tx + tw / 2, by);
        ctx.lineTo(bx + Wb - r, by); ctx.arcTo(bx + Wb, by, bx + Wb, by + r, r); ctx.lineTo(bx + Wb, by + th - r); ctx.arcTo(bx + Wb, by + th, bx + Wb - r, by + th, r);
        ctx.lineTo(bx + r, by + th); ctx.arcTo(bx, by + th, bx, by + th - r, r); ctx.lineTo(bx, by + r); ctx.arcTo(bx, by, bx + r, by, r);
      }
      ctx.closePath(); ctx.fillStyle = T.light ? 'rgba(250,250,247,0.97)' : 'rgba(64,64,70,0.94)'; ctx.fill();
      ctx.shadowColor = 'transparent';
      ctx.fillStyle = T.light ? '#0B0B0E' : '#FFFFFF'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(T.label, bx + Wb / 2, by + th / 2 + 1.5 * u);
      ctx.restore();
    });
    try{ ctx.letterSpacing = '0px'; }catch(e){} ctx.textBaseline = 'alphabetic';
    ctx.restore(); return;
  }
  ctx.font = `700 ${22 * u}px ${SANS}`;
  const th = 36 * u, mk = (f, label) => { const fx = px(f), fy = py(f), tw = ctx.measureText(label).width + 26 * u, tx = Math.min(x + w - tw, Math.max(x, fx - tw / 2));
    const roomUp = fy - th - 30 * u > y - 64 * u; return { f, label, fx, fy, tw, tx, above: roomUp }; };
  const place = T => { T.ty = T.above ? T.fy - 22 * u - th : T.fy + 22 * u; return T; };
  let T = [];
  if(entry && exit && Math.abs(px(entry) - px(exit)) < 70 * u && Math.abs(py(entry) - py(exit)) < 48 * u){
    T = [place(mk(exit, 'BUY  ·  SELL'))]; T[0].both = entry;                       // in and out on the same spot: one tag
  } else {
    if(entry) T.push(place(mk(entry, 'BUY'))); if(exit) T.push(place(mk(exit, 'SELL')));
    if(T.length === 2){ const [A, B] = T, hit = !(A.tx + A.tw + 8 * u < B.tx || B.tx + B.tw + 8 * u < A.tx) && Math.abs(A.ty - B.ty) < th + 8 * u;
      if(hit){ const hi = A.fy <= B.fy ? A : B, lo = hi === A ? B : A; hi.above = true; lo.above = false; place(hi); place(lo);
        if(lo.ty + th > y + h + 40 * u){ lo.above = true; place(lo); lo.ty = Math.min(lo.ty, hi.ty - th - 10 * u); } } }
  }
  T.forEach((G, i) => {
    const k = easeOutBack(seg(p, 0.64 + i * 0.06, 0.76 + i * 0.06)); if(k <= 0) return;
    const { fx, fy, tw, tx, ty, above } = G;
    ctx.save(); ctx.globalAlpha *= clamp01(k);
    ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 2 * u; ctx.beginPath(); ctx.moveTo(fx, fy + (above ? -9 : 9) * u); ctx.lineTo(fx, above ? ty + th : ty); ctx.stroke();
    ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = 16 * u; ctx.shadowOffsetY = 3 * u;
    ctx.translate(tx + tw / 2, ty + th / 2); ctx.scale(k, k);
    rrect(ctx, -tw / 2, -th / 2, tw, th, 9 * u); ctx.fillStyle = '#FFFFFF'; ctx.fill(); ctx.shadowColor = 'transparent';
    ctx.font = `700 ${22 * u}px ${SANS}`; ctx.fillStyle = '#0B0B0E'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(G.label, 0, 1.5 * u);
    ctx.restore();
    ctx.save(); ctx.globalAlpha *= clamp01(k);
    const dot = (X, Y) => { ctx.beginPath(); ctx.arc(X, Y, 7 * u, 0, Math.PI * 2); ctx.fillStyle = '#FFFFFF'; ctx.fill(); ctx.lineWidth = 3 * u; ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.stroke(); };
    if(G.both) dot(px(G.both), py(G.both)); dot(fx, fy);
    ctx.restore(); ctx.textBaseline = 'alphabetic';
  });
}
const hasArtChart = t => !!(t.chart && t.chart.v === 2 && t.chart.c && t.chart.c.length);
/* ART, post / square / story: one layout. Everything sits on the same left margin, white only, no frame and no rules:
   brand and date on top, the chart with BUY / SELL, then the ticker, the big number, every figure of the trade, the
   handle and the artwork's credit. Each option of the panel (big number, number colour, chart, stats, coin, credit, tone)
   applies here as in the wide format. */
function drawArtPoster(ctx, W, H, t, meta, p, opt){
  const ao = { ...artOpts(), ...(opt.ao || {}) }, story = H / W > 1.5, win = t.pnl >= 0;
  const k = W / 1080, u = k * (story ? 1.02 : 0.8);
  const fa = (a, b) => easeOut(seg(p, a, b));
  const shadow = (b, a) => { ctx.shadowColor = `rgba(0,0,0,${a == null ? 0.5 : a})`; ctx.shadowBlur = b * u; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = Math.max(1, b * 0.1) * u; };
  const noShadow = () => { ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0; };
  const ls = v => { try{ ctx.letterSpacing = v + 'px'; }catch(e){} };
  const inv = t.roi ? t.pnl / (t.roi / 100) : 0, money = !opt.hideUsd && inv > 0 && isFinite(inv);
  const bigRoi = ao.big === 'roi' || opt.hideUsd, mult = t.entryMc > 0 && t.exitMc > 0 ? t.exitMc / t.entryMc : 0;
  // every figure of the trade (the one already shown big is left out)
  const figs = !ao.stats ? [] : [
    ['ENTRY', mcShort(t.entryMc) + ' MC'], ['EXIT', mcShort(t.exitMc) + ' MC'], ['HOLD', fmt.hold(t.holdTime || 0)],
    ...(money ? [['SIZE', '$' + inv.toFixed(2)]] : []),
    ...(bigRoi ? (money ? [['PNL', fmt.usd(t.pnl)]] : []) : [['RETURN', fmt.pct(t.roi)]]),
    ['MULTIPLE', mult ? '×' + (mult >= 10 ? mult.toFixed(1) : mult.toFixed(2)) : '—'],
  ];
  const ncol = figs.length <= 4 ? figs.length : 3, nrow = figs.length ? Math.ceil(figs.length / ncol) : 0;
  const bigTxt = v => bigRoi ? fmt.pct(t.roi * v) : fmt.usd(t.pnl * v);
  const chartOn = ao.chart && hasArtChart(t);
  const L = 80 * k, R = W - 80 * k, cw = R - L;
  const topY = (story ? 210 : 74) * k, botY = H - (story ? 240 : 60) * k;
  // from the bottom up
  const figRowH = 66 * u, figGap = 20 * u, figsH = nrow ? nrow * figRowH + (nrow - 1) * figGap : 0;
  const bigSize = fitFont(ctx, bigTxt(1), 800, SANS, (story ? 170 : 150) * u * (figs.length ? 1 : 1.15), cw);
  const footY = botY;
  const figsTop = footY - 52 * u - figsH;
  const bigBase = (nrow ? figsTop - 40 * u : footY - 64 * u);
  const tickY = bigBase - bigSize * 0.76 - 36 * u;
  const plateTop = tickY - 30 * u;
  const headY = topY;
  const chartTop = headY + 150 * u, chartBot = plateTop - 56 * u;

  ctx.save();
  artBackdrop(ctx, W, H, t, ao, p, false);
  let g = ctx.createLinearGradient(0, 0, 0, headY + 200 * u); g.addColorStop(0, 'rgba(0,0,0,0.55)'); g.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  g = ctx.createLinearGradient(0, plateTop - 260 * u, 0, H); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.35, 'rgba(0,0,0,0.5)'); g.addColorStop(1, 'rgba(0,0,0,0.86)'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  g = ctx.createRadialGradient(W / 2, H * 0.42, Math.min(W, H) * 0.4, W / 2, H * 0.45, Math.max(W, H) * 0.75); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.4)'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  if(!opt.video){ ctx.save(); ctx.globalAlpha = 0.5; ctx.fillStyle = grainPattern(ctx); ctx.fillRect(0, 0, W, H); ctx.restore(); }

  // header: brand left (two whites), date right
  ctx.globalAlpha = fa(0.02, 0.12); ctx.textBaseline = 'alphabetic'; shadow(10, 0.6);
  ctx.textAlign = 'left'; ctx.font = `800 ${22 * u}px ${SANS}`; ls(5 * u); ctx.fillStyle = '#FFFFFF'; ctx.fillText('DEGEN', L, headY);
  const dW = ctx.measureText('DEGEN').width; ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.fillText('CARDS', L + dW, headY);
  if(ao.date){ ctx.textAlign = 'right'; ctx.font = `600 ${18 * u}px ${MONO}`; ls(3 * u); ctx.fillStyle = 'rgba(255,255,255,0.78)';
    ctx.fillText(new Date(t.timestamp).toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' }).toUpperCase(), R, headY); }
  ls(0); noShadow();

  if(chartOn && chartBot - chartTop > 120 * u) artChart(ctx, t, L, chartTop, cw, chartBot - chartTop, p, u, true);

  // ticker (+ coin)
  const img = t.image ? IMG_CACHE.get(t.image) : null, hasImg = ao.coin && !!(img && img.complete && img.naturalWidth);
  ctx.globalAlpha = fa(0.04, 0.14); ctx.textBaseline = 'middle';
  let x = L; const cs = 48 * u;
  if(hasImg){
    ctx.save(); shadow(12, 0.5); ctx.beginPath(); ctx.arc(x + cs / 2, tickY, cs / 2, 0, Math.PI * 2); ctx.fillStyle = '#0B0B10'; ctx.fill(); noShadow(); ctx.clip();
    const r = Math.max(cs / img.naturalWidth, cs / img.naturalHeight), iw = img.naturalWidth * r, ih = img.naturalHeight * r;
    ctx.drawImage(img, x + (cs - iw) / 2, tickY - ih / 2, iw, ih); ctx.restore();
    ctx.beginPath(); ctx.arc(x + cs / 2, tickY, cs / 2, 0, Math.PI * 2); ctx.lineWidth = 1.6 * u; ctx.strokeStyle = 'rgba(255,255,255,0.45)'; ctx.stroke();
    x += cs + 16 * u;
  }
  shadow(12, 0.6); ctx.textAlign = 'left';
  const tick = tk(t.ticker); fitFont(ctx, tick, 800, SANS, 40 * u, cw * 0.8); ctx.fillStyle = '#FFFFFF'; ctx.fillText(tick, x, tickY + 2 * u);
  noShadow(); ctx.textBaseline = 'alphabetic';

  // the big number (white, or green / red when that option is picked), count-up and a light sweep
  const cnt = easeOut(seg(p, 0.06, 0.55)), main = ao.ink === 'result' ? (win ? GREEN : RED) : '#FFFFFF';
  ctx.globalAlpha = fa(0.05, 0.14); ctx.textAlign = 'left'; ctx.font = `800 ${bigSize}px ${SANS}`; ls(-0.025 * bigSize);
  shadow(36, 0.55); ctx.fillStyle = main; ctx.fillText(bigTxt(cnt), L - bigSize * 0.03, bigBase); noShadow();
  const sw = seg(p, 0.84, 0.97);
  if(sw > 0 && sw < 1){ const bw = ctx.measureText(bigTxt(1)).width, sx = L - bw * 0.3 + bw * 1.6 * easeOut(sw);
    const lg = ctx.createLinearGradient(sx - 110 * u, 0, sx + 110 * u, 0); lg.addColorStop(0, 'rgba(255,255,255,0)'); lg.addColorStop(0.5, 'rgba(255,255,255,0.7)'); lg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = lg; ctx.fillText(bigTxt(1), L - bigSize * 0.03, bigBase); }
  ls(0); ctx.globalAlpha = 1;

  // every figure: small caps label over the value, aligned on the left margin, no rules
  if(figs.length){
    const colW = cw / ncol;
    figs.forEach(([l, v], i) => {
      const a = fa(0.42 + i * 0.04, 0.56 + i * 0.04); ctx.globalAlpha = a;
      const c = i % ncol, r = Math.floor(i / ncol), x0 = L + c * colW, y0 = figsTop + r * (figRowH + figGap) + (1 - a) * 12 * u;
      shadow(10, 0.6); ctx.textAlign = 'left';
      ctx.font = `700 ${15 * u}px ${MONO}`; ls(3 * u); ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.fillText(l, x0, y0 + 20 * u); ls(0);
      fitFont(ctx, v, 700, MONO, 28 * u, colW - 24 * u); ctx.fillStyle = '#FFFFFF'; ctx.fillText(v, x0, y0 + 58 * u); noShadow();
    });
  }

  // footer: handle + url left, the artwork's credit right
  ctx.globalAlpha = fa(0.6, 0.74); shadow(10, 0.6);
  const hn = handle(), art = artPick(t, ao);
  ctx.textAlign = 'left'; ctx.font = `600 ${18 * u}px ${MONO}`; ls(1.5 * u); ctx.fillStyle = 'rgba(255,255,255,0.82)';
  const foot = (hn ? hn + '  ·  ' : '') + 'degencards.vercel.app'; ctx.fillText(foot, L, footY); const footW = ctx.measureText(foot).width; ls(0);
  if(ao.credit && !bgReady() && art){ ctx.textAlign = 'right'; ctx.font = `italic 500 ${17 * u}px ${SANS}`; ctx.fillStyle = 'rgba(255,255,255,0.6)';
    const maxW = cw - footW - 40 * u; let cr = art.title + ', ' + art.by + ', ' + art.year;
    if(ctx.measureText(cr).width > maxW) cr = art.by + ', ' + art.year;
    if(ctx.measureText(cr).width <= maxW) ctx.fillText(cr, R, footY);
    else ctx.fillText(cr, R, footY + 30 * u); }
  noShadow(); ctx.globalAlpha = 1;
  const intro = fa(0, 0.04); if(!opt.inner && intro < 1){ ctx.fillStyle = `rgba(0,0,0,${1 - intro})`; ctx.fillRect(0, 0, W, H); }
  ctx.restore();
}
function drawArt(ctx, W, H, t, meta, p, opt){
  if(W <= H * 1.2) return drawArtPoster(ctx, W, H, t, meta, p, opt);   // post, square, story: the editorial grid
  const ao = { ...artOpts(), ...(opt.ao || {}) }, wide = W > H * 1.2, story = H / W > 1.5, win = t.pnl >= 0;
  const u = Math.min(W, H) / 1350, k = W / 1080;
  const fa = (a, b) => easeOut(seg(p, a, b));
  const shadow = (b, a) => { ctx.shadowColor = `rgba(0,0,0,${a == null ? 0.55 : a})`; ctx.shadowBlur = b * u; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = Math.max(1, b * 0.12) * u; };
  const noShadow = () => { ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0; };
  // what goes on the card
  const inv = t.roi ? t.pnl / (t.roi / 100) : 0, money = !opt.hideUsd && inv > 0 && isFinite(inv);
  const bigRoi = ao.big === 'roi' || opt.hideUsd, mult = t.entryMc > 0 && t.exitMc > 0 ? t.exitMc / t.entryMc : 0;
  const rows = !ao.stats ? [] : [
    ['Entry', mcShort(t.entryMc) + ' MC'],
    ['Exit', mcShort(t.exitMc) + ' MC'],
    money ? ['Size', '$' + inv.toFixed(2)] : ['Hold', fmt.hold(t.holdTime || 0)],
    !bigRoi ? ['Return', fmt.pct(t.roi)] : money ? ['PnL', fmt.usd(t.pnl)] : ['Multiple', mult ? '×' + (mult >= 10 ? mult.toFixed(1) : mult.toFixed(2)) : '—'],
  ];
  const bigTxt = v => bigRoi ? fmt.pct(t.roi * v) : fmt.usd(t.pnl * v);
  const chartOn = ao.chart && hasArtChart(t), rowH = 46 * u, statsH = rows.length * rowH, cx = W / 2;
  // layout. Wide: header on top, chart in the upper middle, numbers below (the look everything else follows).
  // Post / story: the same small, cinematic scale, but as a poster: the artwork owns the top, the trade sits in the lower part.
  let hy, colW, bigSize, bigBase, statsTop, chartTop, chartBot, fy, creditY;
  if(wide){
    hy = 82 * u; colW = Math.min(W - 2 * 92 * u, 1180 * u);
    const footTop = H - 132 * u; statsTop = footTop - 26 * u - statsH;
    bigSize = fitFont(ctx, bigTxt(1), 800, SANS, 184 * u, Math.min(colW, 940 * u));
    bigBase = statsTop - (rows.length ? 40 : 0) * u;
    chartTop = hy + 104 * u; chartBot = bigBase - bigSize * 0.78 - 56 * u;
    if(!chartOn){ const blockH = bigSize * 0.78 + (rows.length ? 40 * u + statsH : 0), f0 = hy + 60 * u, f1 = footTop - 26 * u;
      bigBase = f0 + Math.max(0, (f1 - f0 - blockH) * 0.6) + bigSize * 0.78; statsTop = bigBase + 40 * u; }
    fy = H - 74 * u; creditY = H - 22 * u;
  } else {
    const topSafe = (story ? 196 : 58) * k, botSafe = (story ? 250 : 52) * k;      // story: clear of the app's own header and caption
    hy = topSafe + 26 * u; colW = W * (story ? 0.84 : 0.8);
    fy = H - botSafe - 34 * u;
    statsTop = fy - 64 * u - statsH;
    bigSize = fitFont(ctx, bigTxt(1), 800, SANS, (story ? 200 : 178) * u, W * 0.84);
    bigBase = statsTop - (rows.length ? 34 : 0) * u;
    chartBot = bigBase - bigSize * 0.78 - 50 * u;
    chartTop = Math.max(hy + 100 * u, chartBot - H * (story ? 0.24 : 0.27));
    creditY = story ? fy + 70 * u : H - 22 * u;
  }
  ctx.save();
  artBackdrop(ctx, W, H, t, ao, p, false);
  // grade
  let g;
  if(wide){
    g = ctx.createLinearGradient(0, 0, 0, H * 0.4); g.addColorStop(0, 'rgba(0,0,0,0.42)'); g.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    g = ctx.createLinearGradient(0, H * 0.48, 0, H); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.6, 'rgba(0,0,0,0.3)'); g.addColorStop(1, 'rgba(0,0,0,0.66)'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.4, W / 2, H / 2, Math.max(W, H) * 0.8); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.38)'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  } else {
    g = ctx.createLinearGradient(0, 0, 0, hy + 160 * u); g.addColorStop(0, 'rgba(0,0,0,0.5)'); g.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    const g0 = (chartOn ? chartTop : bigBase - bigSize) - H * 0.12;
    g = ctx.createLinearGradient(0, g0, 0, H); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.3, 'rgba(0,0,0,0.26)'); g.addColorStop(0.65, 'rgba(0,0,0,0.52)'); g.addColorStop(1, 'rgba(0,0,0,0.78)'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    g = ctx.createRadialGradient(W / 2, H * 0.4, Math.min(W, H) * 0.42, W / 2, H * 0.45, Math.max(W, H) * 0.72); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.42)'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }
  if(!opt.video){ ctx.save(); ctx.globalAlpha = 0.55; ctx.fillStyle = grainPattern(ctx); ctx.fillRect(0, 0, W, H); ctx.restore(); }   // a touch of film grain on stills

  // header: coin + ticker + date · hold, centered as one group
  const img = t.image ? IMG_CACHE.get(t.image) : null, hasImg = ao.coin && !!(img && img.complete && img.naturalWidth);
  const tick = tk(t.ticker), sub = ao.date ? new Date(t.timestamp).toLocaleDateString('en-US', { month:'short', day:'numeric' }).toUpperCase() + '  ·  ' + fmt.hold(t.holdTime || 0).toUpperCase() : '';
  ctx.globalAlpha = fa(0.02, 0.12); ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  const cs = 50 * u, gap1 = 16 * u, gap2 = 20 * u;
  fitFont(ctx, tick, 800, SANS, 40 * u, W * 0.5); const tF = ctx.font, tW = ctx.measureText(tick).width;
  ctx.font = `600 ${21 * u}px ${MONO}`; const sW = ctx.measureText(sub).width;
  const gw = (hasImg ? cs + gap1 : 0) + tW + (sub ? gap2 + sW : 0); let hx = cx - gw / 2;
  if(hasImg){
    ctx.save(); shadow(14, 0.5); ctx.beginPath(); ctx.arc(hx + cs / 2, hy, cs / 2, 0, Math.PI * 2); ctx.fillStyle = '#0B0B10'; ctx.fill(); noShadow(); ctx.clip();
    const r = Math.max(cs / img.naturalWidth, cs / img.naturalHeight), iw = img.naturalWidth * r, ih = img.naturalHeight * r;
    ctx.drawImage(img, hx + (cs - iw) / 2, hy - ih / 2, iw, ih); ctx.restore();
    ctx.beginPath(); ctx.arc(hx + cs / 2, hy, cs / 2, 0, Math.PI * 2); ctx.lineWidth = 2 * u; ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.stroke();
    hx += cs + gap1;
  }
  shadow(16); ctx.font = tF; ctx.fillStyle = '#FFFFFF'; ctx.fillText(tick, hx, hy + 2 * u); hx += tW + gap2;
  ctx.font = `600 ${21 * u}px ${MONO}`; ctx.fillStyle = 'rgba(255,255,255,0.72)'; ctx.fillText(sub, hx, hy + 2 * u);
  noShadow(); ctx.textBaseline = 'alphabetic'; ctx.globalAlpha = 1;

  if(chartOn && chartBot - chartTop > 120 * u) artChart(ctx, t, cx - colW / 2, chartTop, colW, chartBot - chartTop, p, u, true);

  // big result, count-up, light sweep at the end
  const cnt = easeOut(seg(p, 0.06, 0.55)), main = ao.ink === 'result' ? (win ? GREEN : RED) : '#FFFFFF';
  ctx.globalAlpha = fa(0.04, 0.12); ctx.textAlign = 'center';
  ctx.font = `800 ${bigSize}px ${SANS}`; try{ ctx.letterSpacing = (-0.02 * bigSize) + 'px'; }catch(e){}
  shadow(40, 0.6); ctx.fillStyle = main; ctx.fillText(bigTxt(cnt), cx, bigBase); noShadow();
  const sw = seg(p, 0.84, 0.97);
  if(sw > 0 && sw < 1){
    const bw = ctx.measureText(bigTxt(1)).width, sx = cx - bw * 0.8 + bw * 1.6 * easeOut(sw);
    const lg = ctx.createLinearGradient(sx - 110 * u, 0, sx + 110 * u, 0);
    lg.addColorStop(0, 'rgba(255,255,255,0)'); lg.addColorStop(0.5, 'rgba(255,255,255,0.7)'); lg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = lg; ctx.fillText(bigTxt(1), cx, bigBase);
  }
  try{ ctx.letterSpacing = '0px'; }catch(e){}
  ctx.globalAlpha = 1;

  // stats: two columns, labels then values, the block centered under the number
  if(rows.length){
    ctx.font = `600 ${27 * u}px ${SANS}`; const lw = Math.max(...rows.map(r => ctx.measureText(r[0]).width));
    ctx.font = `700 ${27 * u}px ${MONO}`; const vw = Math.max(...rows.map(r => ctx.measureText(r[1]).width));
    const colGap = 52 * u, bx = cx - (lw + colGap + vw) / 2;
    rows.forEach(([l, val], i) => {
      const a = fa(0.42 + i * 0.05, 0.56 + i * 0.05); ctx.globalAlpha = a; const yy = statsTop + rowH * (i + 0.7) + (1 - a) * 14 * u;
      shadow(14, 0.6); ctx.textAlign = 'left';
      ctx.font = `600 ${27 * u}px ${SANS}`; ctx.fillStyle = 'rgba(255,255,255,0.72)'; ctx.fillText(l, bx, yy);
      ctx.font = `700 ${27 * u}px ${MONO}`; ctx.fillStyle = '#FFFFFF'; ctx.fillText(val, bx + lw + colGap, yy);
    });
    noShadow(); ctx.globalAlpha = 1;
  }

  // footer: brand · @handle, url; the artwork's credit in the corner
  ctx.globalAlpha = fa(0.6, 0.74); ctx.textAlign = 'left'; shadow(12, 0.6);
  const hn = handle();
  ctx.font = `900 ${25 * u}px ${SANS}`; try{ ctx.letterSpacing = (2 * u) + 'px'; }catch(e){} const bW = ctx.measureText('DEGENCARDS').width; try{ ctx.letterSpacing = '0px'; }catch(e){}
  ctx.font = `600 ${24 * u}px ${SANS}`; const hW = hn ? ctx.measureText('  ·  ' + hn).width : 0;
  const fx0 = cx - (bW + hW) / 2;
  ctx.font = `900 ${25 * u}px ${SANS}`; try{ ctx.letterSpacing = (2 * u) + 'px'; }catch(e){} ctx.fillStyle = '#FFFFFF'; ctx.fillText('DEGENCARDS', fx0, fy); try{ ctx.letterSpacing = '0px'; }catch(e){}
  if(hn){ ctx.font = `600 ${24 * u}px ${SANS}`; ctx.fillStyle = 'rgba(255,255,255,0.82)'; ctx.fillText('  ·  ' + hn, fx0 + bW, fy); }
  ctx.textAlign = 'center'; ctx.font = `500 ${18 * u}px ${MONO}`; ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.fillText('degencards.vercel.app', cx, fy + 32 * u);
  if(ao.credit && !bgReady()){ const a = artPick(t, ao); ctx.font = `italic 500 ${15 * u}px ${SANS}`; ctx.fillStyle = 'rgba(255,255,255,0.5)';
    if(story){ ctx.textAlign = 'center'; ctx.fillText(a.by + ', ' + a.year, cx, creditY); } else { ctx.textAlign = 'right'; ctx.fillText(a.by + ', ' + a.year, W - 26 * u, creditY); } }
  noShadow(); ctx.globalAlpha = 1;
  const intro = fa(0, 0.04); if(!opt.inner && intro < 1){ ctx.fillStyle = `rgba(0,0,0,${1 - intro})`; ctx.fillRect(0, 0, W, H); }
  ctx.restore();
}
/* static cards: no animation at all (image and video show the finished card) */
let STATIC = (() => { try{ return localStorage.getItem('dc_share_static') === '1'; }catch(e){ return false; } })();

/* ---------- export ---------- */
async function fontsReady(){
  try{ await Promise.all([document.fonts.load(`900 40px Outfit`), document.fonts.load(`800 40px 'JetBrains Mono'`), document.fonts.load(`600 20px 'JetBrains Mono'`)]); }catch(e){}
}
const drawFor = style => style === 'simple' ? drawSimple : drawArt;
function renderStill(t, meta, fmtKey, opt){
  const F = FORMATS[fmtKey], c = document.createElement('canvas'); c.width = F.w; c.height = F.h;
  drawFor(opt.style)(c.getContext('2d'), F.w, F.h, t, meta, 1, opt);
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
async function encodeOffline(baseW, baseH, total, frameAt, onProgress, audioFn, prep){
  if(!('VideoEncoder' in window) || !('VideoFrame' in window) || !(await loadMuxer())) return null;
  const pick = await pickVideoConfig(baseW, baseH, proLocked() ? '1080' : state.quality);
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
    if(prep) await prep(Math.min(i * 1000 / FPS, total));
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
const animMs = opt => STATIC ? 3000 : opt.style === 'simple' ? SIMPLE_MS : ART_MS;
/* total length: with a background video, at least one full loop of it (max 15 s) */
const videoTotal = opt => { const a = animMs(opt); return BG.kind === 'video' && bgReady() && BG.dur ? Math.max(a, Math.min(15000, Math.round(BG.dur * 1000))) : a; };
async function recordVideo(t, meta, fmtKey, opt, onProgress){
  const F = FORMATS[fmtKey], A = animMs(opt), total = videoTotal(opt);
  const frame = (ctx, W, H, el) => drawFor(opt.style)(ctx, W, H, t, meta, STATIC ? 1 : Math.min(1, el / (A - 1200)), { ...opt, video:true });   // last 1.2 s of the animation = hold
  const vid = BG.kind === 'video' && bgReady();
  if(vid) BG.el.pause();
  try{ const b = await encodeOffline(F.w, F.h, total, frame, onProgress, null, vid ? bgSeek : null); if(b){ if(vid) BG.el.play().catch(()=>{}); return b; } }catch(e){ console.warn('webcodecs export failed, real-time fallback', e); }
  if(vid){ try{ BG.el.currentTime = 0; }catch(e){} BG.el.play().catch(()=>{}); }
  return recordAnim(F.w, F.h, total, frame, onProgress);
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
/* PRO replay studio: free = the default look; every other choice (any group, any toggle, any preset) needs PRO.
   Free users still SEE every option (locked chips open the paywall); the PRO rendering code itself is only served to subscribers. */
const proLocked = () => !!(window.dcPro && window.dcPro.enabled && !window.dcPro.active);
const isProVal = (k, v) => { const d = (window.dcReplay && window.dcReplay.DEFAULTS) || {}; return k in d && v !== d[k]; };
function replayOpts(){
  const d = (window.dcReplay && window.dcReplay.DEFAULTS) || {};
  let saved = {}; try{ saved = JSON.parse(localStorage.getItem(RO_KEY) || '{}') || {}; }catch(e){}
  const o = { ...d };
  for(const [k, , opts] of RO_GROUPS) if(opts.some(x => x[0] === saved[k])) o[k] = saved[k];   // only known values: a stale / edited entry can't break a render
  for(const [k] of RO_SHOW) if(typeof saved[k] === 'boolean') o[k] = saved[k];
  delete o.hideUsd;
  if(proLocked()) return { ...d };                                    // free: the default replay, no customization
  return o;
}
function saveReplayOpts(o){ try{ localStorage.setItem(RO_KEY, JSON.stringify(o)); }catch(e){} }
function renderCustomize(){
  const box = document.getElementById('shareCustom'); if(!box) return;
  if(!proLocked() && window.dcPro && window.dcPro.active && !(window.dcReplay && window.dcReplay.pro)){
    box.innerHTML = `<div class="rc-lock"><b><span class="pro-tag">PRO</span> Customize your replay</b>Loading your PRO studio\u2026</div>`;
    return;
  }
  const free = proLocked(), o = replayOpts(), R = window.dcReplay;
  const lockV = (k, v) => free && isProVal(k, v);
  const secs = R ? Math.round(R.duration({ ...o }) / 1000) : 0;
  const preset = Object.entries(RO_PRESETS).find(([, p]) => Object.entries(p.o).every(([k, v]) => o[k] === v));
  const presetLocked = p => free && Object.entries(p.o).some(([pk, pv]) => isProVal(pk, pv));
  box.innerHTML = `
    <div class="rc-head"><span>Customize${free ? ' <span class="pro-tag">PRO</span>' : ''}</span><em>\u2248 ${secs} s</em></div>
    ${free ? `<div class="rc-upsell"><span>Every style below unlocks with PRO. Free replays use the default look.</span><button type="button" class="hbtn pro-btn" id="rcPro">GO PRO</button></div>` : ''}
    <div class="rc-row" role="group" aria-label="Presets">${Object.entries(RO_PRESETS).map(([k, p]) => `<button type="button" class="rc-chip preset ${preset && preset[0] === k ? 'on' : ''}${presetLocked(p) ? ' locked' : ''}" data-rp="${k}" aria-pressed="${!!preset && preset[0] === k}"${presetLocked(p) ? ' data-pro="1"' : ''}>${p.name}</button>`).join('')}</div>
    ${RO_GROUPS.map(([k, label, opts]) => `
      <div class="rc-group"><div class="rc-label" id="rcl-${k}">${label}</div>
        <div class="rc-row" role="radiogroup" aria-labelledby="rcl-${k}">${opts.map(([v, l]) => `<button type="button" class="rc-chip ${o[k] === v ? 'on' : ''}${k === 'theme' ? ' sw sw-' + v : ''}${lockV(k, v) ? ' locked' : ''}" role="radio" aria-checked="${o[k] === v}" data-rk="${k}" data-rv="${v}"${lockV(k, v) ? ' data-pro="1"' : ''}>${l}</button>`).join('')}</div></div>`).join('')}
    <div class="rc-group"><div class="rc-label">Show</div>
      <div class="rc-row">${RO_SHOW.map(([k, l]) => `<button type="button" class="rc-chip ${o[k] ? 'on' : ''}${free ? ' locked' : ''}" role="switch" aria-checked="${!!o[k]}" data-rs="${k}"${free ? ' data-pro="1"' : ''}>${o[k] ? '\u2713 ' : ''}${l}</button>`).join('')}</div></div>
    ${free ? '' : '<button type="button" class="hbtn rc-reset" id="rcReset">RESET TO DEFAULT</button>'}`;
  const gp = document.getElementById('rcPro'); if(gp) gp.addEventListener('click', () => window.dcPro.open());
  const changed = next => { saveReplayOpts(next); renderCustomize(); syncButtons(); preview(); };
  box.querySelectorAll('[data-rk]').forEach(b => b.addEventListener('click', () => b.dataset.pro ? window.dcPro.open() : changed({ ...replayOpts(), [b.dataset.rk]: b.dataset.rv })));
  box.querySelectorAll('[data-rs]').forEach(b => b.addEventListener('click', () => { if(b.dataset.pro) return window.dcPro.open(); const c = replayOpts(); changed({ ...c, [b.dataset.rs]: !c[b.dataset.rs] }); }));
  box.querySelectorAll('[data-rp]').forEach(b => b.addEventListener('click', () => { const po = RO_PRESETS[b.dataset.rp].o;
    if(b.dataset.pro || (proLocked() && Object.entries(po).some(([k, v]) => isProVal(k, v)))) return window.dcPro.open();
    changed({ ...replayOpts(), ...po }); }));
  const rr = document.getElementById('rcReset'); if(rr) rr.addEventListener('click', () => { try{ localStorage.removeItem(RO_KEY); }catch(e){} renderCustomize(); syncButtons(); preview(); });
}
const isReplay = () => state.style === 'replay' && window.dcReplay && window.dcReplay.available(state.t);
const WIDE_OK = s => s === 'simple' || s === 'art';
const curFmt = () => state.fmt === 'wide' && WIDE_OK(state.style) ? 'wide' : 'square';   // square first and by default; 4:5 and 9:16 retired
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
let state = { t:null, meta:null, fmt:'square', style:(()=>{ try{ const v = localStorage.getItem('dc_share_style'); return ['art','simple','replay'].includes(v) ? v : 'art'; }catch(e){ return 'art'; } })(), hideUsd:false, anim:0, busy:false, sound:false, pac:null, quality: (()=>{ try{ return localStorage.getItem('dc_video_q') || '4k'; }catch(e){ return '4k'; } })() };
let lastExport = '';
function sheet(){ return document.getElementById('shareOverlay'); }
function preview(){
  const cv = document.getElementById('sharePreview'), R = window.dcReplay;
  const F = isReplay() ? { w:R.W, h:R.H } : FORMATS[curFmt()];
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
    else { const A = animMs(state), el = (performance.now() - t0) % (A + 900), p = STATIC ? 1 : Math.min(1, el / (A - 1200)); drawFor(state.style)(ctx, F.w, F.h, state.t, state.meta, p, state); }
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
  if(!canReplay && state.style === 'replay') state.style = 'art';
  document.querySelectorAll('[data-share-style]').forEach(b => { b.classList.toggle('on', b.dataset.shareStyle === state.style); b.setAttribute('aria-checked', String(b.dataset.shareStyle === state.style)); if(b.dataset.shareStyle === 'replay'){ b.disabled = !canReplay; b.title = canReplay ? '' : 'Needs the real candles of this trade'; } });
  document.getElementById('shareFmts').hidden = state.style === 'replay';
  document.getElementById('shareReplayNote').hidden = canReplay;
  const cb = document.getElementById('shareCustom'); if(cb){ cb.hidden = state.style !== 'replay' || !canReplay; if(!cb.hidden && !cb.childElementCount) renderCustomize(); }
  const sb = document.getElementById('shareSound'); sb.hidden = state.style !== 'replay'; sb.textContent = state.sound ? '\u{1F50A} Sound on' : '\u{1F507} Sound off'; sb.setAttribute('aria-pressed', String(state.sound));
  document.querySelectorAll('[data-share-fmt]').forEach(b => { if(b.dataset.shareFmt === 'wide') b.hidden = !WIDE_OK(state.style); b.classList.toggle('on', b.dataset.shareFmt === curFmt()); });
  syncBg();
  const sbx = document.getElementById('shareSimple'); if(sbx){ sbx.hidden = state.style !== 'simple'; if(!sbx.hidden) renderSimple(); }
  const abx = document.getElementById('shareArt'); if(abx){ abx.hidden = state.style !== 'art'; if(!abx.hidden) renderArtOpts(); }
  const mo = document.getElementById('shareMotion'); if(mo){ mo.hidden = state.style === 'replay';
    mo.querySelectorAll('[data-share-motion]').forEach(b => { const on = (b.dataset.shareMotion === 'static') === STATIC; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); }); }
  document.getElementById('shareHideUsd').checked = state.hideUsd;
  { const nr = document.getElementById('shareNameRow'); if(nr){ const n = window.dcUser && window.dcUser.username; nr.hidden = !n; if(n){ document.getElementById('shareNameTxt').textContent = 'Show @' + n; document.getElementById('shareName').checked = SHOW_NAME; } } }
  document.querySelectorAll('[data-share-q]').forEach(b => { const on = b.dataset.shareQ === (proLocked() ? '1080' : state.quality); b.classList.toggle('locked', b.dataset.shareQ !== '1080' && proLocked()); b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); });
  const v = document.getElementById('shareVideo'), mime = videoMime() || (('VideoEncoder' in window) ? 'video/mp4' : null);
  v.hidden = !mime; v.textContent = (state.style === 'replay' ? 'SHARE REPLAY VIDEO' : 'SHARE VIDEO') + (mime && mime.includes('mp4') ? ' (MP4)' : '');
}
async function doStill(){
  if(state.busy) return; state.busy = true;
  try{
    await fontsReady(); await loadCoinImage(state.t.image); if(state.style === 'art') await artReady(state.t);
    let c;
    if(isReplay()){ const R = window.dcReplay; c = document.createElement('canvas'); c.width = R.W; c.height = R.H; const ro = { ...replayOpts(), hideUsd: state.hideUsd }; R.draw(c.getContext('2d'), R.W, R.H, state.t, state.meta, R.duration(ro), ro); }
    else c = renderStill(state.t, state.meta, curFmt(), state);
    const blob = await new Promise(r => c.toBlob(r, 'image/png'));
    if(!blob) throw new Error('png');
    const r = await deliver(blob, `degencards-${safeName()}-${isReplay() ? 'replay' : (state.style === 'simple' || state.style === 'art' ? state.style + '-' : '') + curFmt()}.png`, captionFor(state.t, state));
    if(r === 'downloaded') showToast('Image saved · caption copied');
  }catch(e){ showToast("Couldn't build the image"); }
  finally{ state.busy = false; }
}
async function doVideo(){
  if(state.busy) return; state.busy = true;
  const ac = isReplay() ? newAudio() : null;                         // created synchronously in the tap, before any await
  const btn = document.getElementById('shareVideo'), label = btn.textContent;
  try{
    await fontsReady(); await loadCoinImage(state.t.image); if(state.style === 'art') await artReady(state.t);
    lastExport = '';
    const tStart = performance.now();
    const prog = pr => { const el = (performance.now() - tStart) / 1000, eta = pr > 0.04 ? Math.max(0, Math.round(el / pr - el)) : null; btn.textContent = `RENDERING\u2026 ${Math.round(pr*100)}%` + (eta != null ? ` \u00B7 ~${eta}s` : ''); };
    const blob = isReplay() ? await recordReplay(state.t, state.meta, state, prog, ac) : await recordVideo(state.t, state.meta, curFmt(), state, prog);
    btn.textContent = label;
    const ext = blob.type.includes('mp4') ? 'mp4' : 'webm';
    const r = await deliver(blob, `degencards-${safeName()}-${isReplay() ? 'replay' : (state.style === 'simple' || state.style === 'art' ? state.style + '-' : '') + curFmt()}.${ext}`, captionFor(state.t, state));
    showToast((r === 'downloaded' ? 'Video saved \u00B7 caption copied' : 'Video ready') + (lastExport ? ` \u00B7 ${lastExport}` : ''));
  }catch(e){ showToast("Video isn't supported here — share the image"); }
  finally{ btn.textContent = label; state.busy = false; }
}
/* background controls: PRO when PRO is live; the file stays on the device */
function syncBg(){
  const box = document.getElementById('shareBg'); if(!box) return;
  box.hidden = state.style === 'replay';
  const has = !!BG.kind, add = document.getElementById('shareBgAdd');
  add.textContent = has ? (BG.kind === 'video' ? 'CHANGE VIDEO / PHOTO' : 'CHANGE PHOTO / VIDEO') : 'ADD PHOTO / VIDEO';
  add.classList.toggle('locked', proLocked());
  document.getElementById('shareBgClear').hidden = !has;
  document.getElementById('shareBgTools').hidden = !has || proLocked();
  const pct = Math.round(BG.dim * 100); document.getElementById('shareBgDim').value = pct; document.getElementById('shareBgDimVal').textContent = pct + '%';
  const pp = Math.round(BG.pos * 100); document.getElementById('shareBgPos').value = pp; document.getElementById('shareBgPosVal').textContent = pp + '%';
  const bl = document.getElementById('shareBgBlur'); bl.classList.toggle('on', BG.blur); bl.setAttribute('aria-checked', String(BG.blur)); bl.textContent = (BG.blur ? '\u2713 ' : '') + 'Blur';
}
const bgPersist = async () => { const v = await bgLoadSaved(); if(v) bgSave({ ...v, dim:BG.dim, pos:BG.pos, blur:BG.blur }); };
/* SIMPLE customization (same chips as the replay studio) */
function renderSimple(){
  const box = document.getElementById('shareSimple'); if(!box) return;
  const o = simpleOpts(), lk = (k, v) => proLocked() && SO_PRO[k] && SO_PRO[k].includes(v);
  box.innerHTML = `<div class="rc-head"><span>Customize</span></div>
    ${SO_GROUPS.map(([k, label, opts]) => `<div class="rc-group"><div class="rc-label" id="scl-${k}">${label}</div>
      <div class="rc-row" role="radiogroup" aria-labelledby="scl-${k}">${opts.map(([v, l]) => `<button type="button" class="rc-chip ${o[k] === v ? 'on' : ''}${k === 'accent' && v !== 'auto' ? ' sw sw-' + v : ''}${lk(k, v) ? ' locked' : ''}" role="radio" aria-checked="${o[k] === v}" data-sk="${k}" data-sv="${v}"${lk(k, v) ? ' data-pro="1"' : ''}>${l}</button>`).join('')}</div></div>`).join('')}
    <div class="rc-group"><div class="rc-label">Show</div><div class="rc-row">${SO_SHOW.map(([k, l]) => `<button type="button" class="rc-chip ${o[k] ? 'on' : ''}" role="switch" aria-checked="${!!o[k]}" data-ss="${k}">${o[k] ? '\u2713 ' : ''}${l}</button>`).join('')}</div></div>
    ${BG.kind ? '<p class="share-note" style="margin:8px 0 0">Your own background is on: it replaces the background preset.</p>' : ''}`;
  const save = () => { try{ localStorage.setItem(SO_KEY, JSON.stringify(SO_SAVED)); }catch(e){} renderSimple(); };
  box.querySelectorAll('[data-sk]').forEach(b => b.addEventListener('click', () => { if(b.dataset.pro) return window.dcPro.open(); SO_SAVED = { ...SO_SAVED, [b.dataset.sk]: b.dataset.sv, ...(b.dataset.sk === 'layout' ? SO_LAYOUTS[b.dataset.sv] : {}) }; save(); }));
  box.querySelectorAll('[data-ss]').forEach(b => b.addEventListener('click', () => { SO_SAVED = { ...SO_SAVED, [b.dataset.ss]: !SO_SAVED[b.dataset.ss] }; save(); }));
}
/* style picker: each style shows a live mini render of THIS trade, so the choice is visual */
function styleThumbs(){
  if(!state.t) return;
  document.querySelectorAll('[data-share-style]').forEach(b => {
    const cv = b.querySelector('canvas'); if(!cv) return;
    const st = b.dataset.shareStyle, TW = 120, TH = 150;
    if(cv.width !== TW || cv.height !== TH){ cv.width = TW; cv.height = TH; }
    const ctx = cv.getContext('2d'); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = '#050507'; ctx.fillRect(0, 0, TW, TH);
    try{
      if(st === 'replay'){
        const R = window.dcReplay; if(!R || !R.available(state.t)) return;
        const ro = { ...replayOpts(), hideUsd: state.hideUsd }, k = Math.max(TW / R.W, TH / R.H);
        ctx.setTransform(k, 0, 0, k, (TW - R.W * k) / 2, (TH - R.H * k) / 2); R.draw(ctx, R.W, R.H, state.t, state.meta, R.duration(ro), ro);
      } else { const k = TW / 1080; ctx.setTransform(k, 0, 0, k, 0, 0); drawFor(st)(ctx, 1080, 1350, state.t, state.meta, 1, { ...state, style:st }); }
    }catch(e){}
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  });
}
/* ART customization: the painting (thumbnails), tone, number, what to show */
let artKind = 'all';
function renderArtOpts(){
  const box = document.getElementById('shareArt'); if(!box || !state.t) return;
  const prevRow = box.querySelector('.art-row'), keepX = prevRow ? prevRow.scrollLeft : null;
  const o = artOpts(), cur = artPick(state.t, o), free = proLocked(), lk = (k, v) => free && AO_PRO[k] && AO_PRO[k].includes(v), own = bgReady();
  const shown = ART.filter(a => artKind === 'all' || a.kind === artKind);
  box.innerHTML = `<div class="rc-head art-head"><span>Artwork</span><button type="button" class="rc-chip art-shuffle" id="artShuffle">Shuffle</button></div>
    <div class="rc-row art-kinds" role="radiogroup" aria-label="Kind of artwork">${ART_KINDS.map(([k, l]) => `<button type="button" class="rc-chip${artKind === k ? ' on' : ''}" role="radio" aria-checked="${artKind === k}" data-akind="${k}">${l}</button>`).join('')}</div>
    <div class="art-row" role="radiogroup" aria-label="Artwork">
      <button type="button" class="art-tile ${o.pick === 'auto' ? 'on' : ''}" role="radio" aria-checked="${o.pick === 'auto'}" data-ap="auto"><span class="art-auto">AUTO</span><em>By result</em></button>
      ${shown.map(a => `<button type="button" class="art-tile ${o.pick === a.id ? 'on' : ''}${artLocked(a) ? ' locked' : ''}" role="radio" aria-checked="${o.pick === a.id}" aria-label="${a.name}${artLocked(a) ? ' (PRO)' : ''}" data-ap="${a.id}"${artLocked(a) ? ' data-pro="1"' : ''}><img src="/art/t/${a.id}.webp" alt="" width="66" height="82" loading="lazy" decoding="async"><em>${a.name}</em></button>`).join('')}
    </div>
    <p class="art-cap">${own ? 'Your own background is on: it replaces the artwork.' : `<i>${cur.title}</i> · ${cur.by}, ${cur.year}${o.pick === 'auto' ? ' · picked for this ' + (state.t.pnl < 0 ? 'loss' : 'win') : ''}`}</p>
    ${AO_GROUPS.map(([k, label, opts]) => `<div class="rc-group"><div class="rc-label" id="acl-${k}">${label}</div>
      <div class="rc-row" role="radiogroup" aria-labelledby="acl-${k}">${opts.map(([v, l]) => `<button type="button" class="rc-chip ${o[k] === v ? 'on' : ''}${lk(k, v) ? ' locked' : ''}" role="radio" aria-checked="${o[k] === v}" data-ak="${k}" data-av="${v}"${lk(k, v) ? ' data-pro="1"' : ''}>${l}</button>`).join('')}</div></div>`).join('')}
    <div class="rc-group"><div class="rc-label">Show</div><div class="rc-row">${AO_SHOW.map(([k, l]) => `<button type="button" class="rc-chip ${o[k] ? 'on' : ''}" role="switch" aria-checked="${!!o[k]}" data-as="${k}">${o[k] ? '✓ ' : ''}${l}</button>`).join('')}</div></div>`;
  const row = box.querySelector('.art-row');
  if(keepX != null) row.scrollLeft = keepX;
  else { const on = row.querySelector('.on'); if(on) row.scrollLeft = Math.max(0, on.offsetLeft - row.clientWidth / 2 + on.offsetWidth / 2); }
  const save = () => { try{ localStorage.setItem(AO_KEY, JSON.stringify(AO_SAVED)); }catch(e){} renderArtOpts(); styleThumbs(); artReady(state.t).then(() => styleThumbs()); };
  box.querySelectorAll('[data-akind]').forEach(b => b.addEventListener('click', () => { artKind = b.dataset.akind; const r = box.querySelector('.art-row'); if(r) r.scrollLeft = 0; renderArtOpts(); const r2 = box.querySelector('.art-row'); if(r2) r2.scrollLeft = 0; }));
  box.querySelectorAll('[data-ap]').forEach(b => b.addEventListener('click', () => { if(b.dataset.pro) return window.dcPro.open(); AO_SAVED = { ...AO_SAVED, pick:b.dataset.ap }; save(); }));
  box.querySelectorAll('[data-ak]').forEach(b => b.addEventListener('click', () => { if(b.dataset.pro) return window.dcPro.open(); AO_SAVED = { ...AO_SAVED, [b.dataset.ak]: b.dataset.av }; save(); }));
  box.querySelectorAll('[data-as]').forEach(b => b.addEventListener('click', () => { AO_SAVED = { ...AO_SAVED, [b.dataset.as]: !AO_SAVED[b.dataset.as] }; save(); }));
  document.getElementById('artShuffle').addEventListener('click', () => {
    const pool = ART.filter(a => !artLocked(a) && a.id !== cur.id && (artKind === 'all' || a.kind === artKind)); if(!pool.length) return;
    AO_SAVED = { ...AO_SAVED, pick: pool[Math.floor(Math.random() * pool.length)].id }; save();
    const on = box.querySelector('.art-row .on'); if(on) on.scrollIntoView({ block:'nearest', inline:'center', behavior:'smooth' });
  });
}
async function pickBg(file){
  if(!file) return;
  const vid = /^video\//.test(file.type), img = /^image\//.test(file.type);
  if(!vid && !img) return showToast('Pick a photo or a video');
  if(file.size > (vid ? BG_MAX_VID : BG_MAX_IMG)) return showToast(vid ? 'Video too big (max 200 MB)' : 'Photo too big (max 25 MB)');
  showToast(vid ? 'Loading video…' : 'Loading photo…');
  const ok = await bgUse(file);
  if(!ok) return showToast("This file can't be read here — try a JPG / PNG or an MP4");
  BG.pos = 0.5; syncButtons(); preview();
  bgSave({ blob:file, dim:BG.dim, pos:BG.pos, blur:BG.blur });
  if(BG.kind === 'video' && BG.dur > 15) showToast('Video background: the first 15 s are used');
}

const safeName = () => (String(state.t.ticker).replace(/[^A-Za-z0-9_-]/g,'') || 'card');

window.__dcLoadImg = loadCoinImage;
window.__dcImgCache = IMG_CACHE;
window.__dcShareReplay = (t, meta, opt, withSound) => recordReplay(t, meta, opt, null, withSound ? newAudio() : null);
window.__dcShareFrame = (canvas, t, meta, fmtKey, opt, p) => { const F = FORMATS[fmtKey]; canvas.width = F.w; canvas.height = F.h; drawFor(opt && opt.style)(canvas.getContext('2d'), F.w, F.h, t, meta, p, opt || {}); };
window.__dcArtReady = (t, ao) => artReady(t, ao);
window.__dcShareBg = BG; window.__dcShareBgUse = bgUse;   // used by the visual tests
window.__dcShareRecord = (t, meta, fmtKey, opt) => recordVideo(t, meta, fmtKey, opt);
window.shareCard = function(t, meta){
  state.t = t; state.meta = meta;
  artImg(artPick(t, artOpts()));
  if(BG.kind === 'video' && BG.el) BG.el.play().catch(()=>{});
  syncButtons();
  document.getElementById('detailOverlay')?.classList.remove('show');
  sheet().classList.add('show');
  Promise.all([fontsReady(), loadCoinImage(t.image)]).then(() => { preview(); styleThumbs(); artReady(t).then(() => styleThumbs()); });
  loadMuxer();
};
window.addEventListener('dc-pro', () => { try{ if(document.getElementById('shareCustom')) renderCustomize(); if(state.t) syncButtons(); }catch(e){} });
let inited = false;
document.addEventListener('DOMContentLoaded', init); if(document.readyState !== 'loading') init();
function init(){
  if(inited || !sheet()) return; inited = true;
  artOnLoad = () => { if(sheet().classList.contains('show')) styleThumbs(); };
  document.querySelectorAll('[data-share-fmt]').forEach(b => b.addEventListener('click', () => { state.fmt = b.dataset.shareFmt; syncButtons(); preview(); }));
  document.querySelectorAll('[data-share-style]').forEach(b => b.addEventListener('click', () => { if(b.disabled) return; state.style = b.dataset.shareStyle; try{ localStorage.setItem('dc_share_style', state.style); }catch(e){} syncButtons(); if(state.style === 'replay') renderCustomize(); preview(); }));
  document.getElementById('shareSound').addEventListener('click', () => { state.sound = !state.sound; syncButtons(); if(state.sound) preview(); else stopPreviewSound(); });
  document.getElementById('shareHideUsd').addEventListener('change', e => { state.hideUsd = e.target.checked; styleThumbs(); });
  document.getElementById('shareName').addEventListener('change', e => { SHOW_NAME = e.target.checked; try{ localStorage.setItem('dc_share_name', SHOW_NAME ? '1' : '0'); }catch(_){} preview(); });
  document.querySelectorAll('[data-share-motion]').forEach(b => b.addEventListener('click', () => { STATIC = b.dataset.shareMotion === 'static'; try{ localStorage.setItem('dc_share_static', STATIC ? '1' : '0'); }catch(e){} syncButtons(); preview(); }));
  document.querySelectorAll('[data-share-q]').forEach(b => b.addEventListener('click', () => { if(b.dataset.shareQ !== '1080' && proLocked()) return window.dcPro.open(); state.quality = b.dataset.shareQ; try{ localStorage.setItem('dc_video_q', state.quality); }catch(e){} syncButtons(); }));
  document.getElementById('shareBgAdd').addEventListener('click', () => { if(proLocked()) return window.dcPro.open(); document.getElementById('shareBgFile').click(); });
  document.getElementById('shareBgFile').addEventListener('change', e => { const f = e.target.files && e.target.files[0]; e.target.value = ''; pickBg(f); });
  document.getElementById('shareBgClear').addEventListener('click', () => { bgRelease(); bgSave(null); syncButtons(); preview(); });
  document.getElementById('shareBgDim').addEventListener('input', e => { BG.dim = Math.max(0, Math.min(0.85, Number(e.target.value) / 100)); document.getElementById('shareBgDimVal').textContent = Math.round(BG.dim * 100) + '%'; });
  document.getElementById('shareBgDim').addEventListener('change', bgPersist);
  document.getElementById('shareBgPos').addEventListener('input', e => { BG.pos = Math.max(0, Math.min(1, Number(e.target.value) / 100)); document.getElementById('shareBgPosVal').textContent = Math.round(BG.pos * 100) + '%'; });
  document.getElementById('shareBgPos').addEventListener('change', bgPersist);
  document.getElementById('shareBgBlur').addEventListener('click', () => { BG.blur = !BG.blur; syncBg(); bgPersist(); });
  bgLoadSaved().then(async v => { if(!v || !v.blob || BG.kind) return; if(typeof v.dim === 'number') BG.dim = Math.max(0, Math.min(0.85, v.dim)); if(typeof v.pos === 'number') BG.pos = Math.max(0, Math.min(1, v.pos)); BG.blur = v.blur === true; if(await bgUse(v.blob)){ if(BG.kind === 'video') BG.el.pause(); syncBg(); } });
  document.getElementById('shareImage').addEventListener('click', doStill);
  document.getElementById('shareVideo').addEventListener('click', doVideo);
  document.getElementById('shareCaption').addEventListener('click', async () => {
    try{ await navigator.clipboard.writeText(captionFor(state.t, state)); showToast('Caption copied'); }catch(e){ showToast("Couldn't copy"); }
  });
  const closeSheet = () => { sheet().classList.remove('show'); cancelAnimationFrame(state.anim); stopPreviewSound(); if(BG.kind === 'video' && BG.el) BG.el.pause(); };
  sheet().querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', closeSheet));
  sheet().addEventListener('click', e => { if(e.target === sheet()) closeSheet(); });
}
})();


