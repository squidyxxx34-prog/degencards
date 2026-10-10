/* ============================================================================
   DEGENCARDS — coin launcher (LAUNCH tab)
   Non-custodial. The `launch` edge function builds the transactions; the user's wallet
   (Phantom, Solflare, Backpack… via the Wallet Standard) signs them; the edge function relays
   and confirms. No Solana library in the browser: transactions travel as bytes.
   Uses app.js globals: sb, session, goToView, showToast, esc.
   ============================================================================ */
(function(){
const $ = id => document.getElementById(id);
const CHAIN = 'solana:mainnet';
const PUMP_VSOL = 30, PUMP_VTOK = 1.073e9, SUPPLY = 1e9;          // pump.fun curve (virtual reserves) for the buy estimate
const ERR = {
  accept:'Tick the box to confirm you are creating this coin yourself.', name:'Give the coin a name (2 to 32 characters).', symbol:'Pick a ticker (2 to 10 letters or digits).',
  reserved:'That name or ticker is reserved (it looks like an existing coin). Pick another one.', image:'Add an image (PNG, JPG, GIF or WEBP).', image_size:'Image too big: keep it under 1 MB.',
  buy:'First buy must be between 0 and the maximum.', liquidity:'Starting liquidity must be between 0.5 and 1000 SOL.', buy_share:'Your first buy can be at most the starting liquidity (half the supply).',
  rate:'5 launches per hour max. Try again a bit later.', lp_off:'The liquidity pool launch is not open yet.', wallet:'Connect your wallet first.', ipfs:'Could not upload the image. Try again.',
  expired:'The transaction expired before it was signed. Launch again.', send_tx:'Unexpected transaction. Launch again.', resume:'Nothing to finish for this launch.',
  resume_restart:'The token was never created. Launch again from the form.', auth:'Sign in again, then retry.', network:'Network error. Check your connection and retry.',
  server:'Something went wrong on our side. Nothing was sent: you can retry.',
};
const st = { mode:'pump', wallets:[], wallet:null, account:null, img:null, busy:false, cfg:{ lp:false, feeSol:0.15, limits:{ pumpBuyMax:20, lpLiqMin:0.5, lpLiqMax:1000, lpBuyMax:100 } }, mine:[], opened:false };

/* ---------- bytes ---------- */
const toB64 = u8 => { let s = ''; for(let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
const fromB64 = b => Uint8Array.from(atob(b), c => c.charCodeAt(0));
const short = a => a ? a.slice(0,4) + '…' + a.slice(-4) : '';
const solFmt = n => (Math.round(n*1000)/1000).toLocaleString('en-US', { maximumFractionDigits:3 });

/* ---------- Wallet Standard ---------- */
function register(...ws){
  for(const w of ws){
    if(!w || st.wallets.includes(w)) continue;
    const f = w.features || {};
    if(!(w.chains || []).some(c => String(c).startsWith('solana:')) || !f['standard:connect'] || !f['solana:signTransaction']) continue;
    st.wallets.push(w);
  }
  renderWallet();
  autoConnect();
}
const api = Object.freeze({ register(...ws){ register(...ws); return () => {}; } });
window.addEventListener('wallet-standard:register-wallet', e => { try{ e.detail(api); }catch(_){} });
try{ window.dispatchEvent(new CustomEvent('wallet-standard:app-ready', { detail: api })); }catch(_){}

const pref = (k, v) => { try{ if(v === undefined) return localStorage.getItem('dc_ln_' + k); if(v === null) localStorage.removeItem('dc_ln_' + k); else localStorage.setItem('dc_ln_' + k, v); }catch(_){ return null; } };
let autoTried = false;
async function autoConnect(){
  if(autoTried || st.account) return;
  const name = pref('wallet'), w = name && st.wallets.find(x => x.name === name);
  if(!w) return; autoTried = true;
  try{ await connect(w, true); }catch(_){}
}
async function connect(w, silent){
  const res = await w.features['standard:connect'].connect(silent ? { silent:true } : undefined);
  const acc = (res && res.accounts && res.accounts[0]) || (w.accounts || [])[0];
  if(!acc) throw new Error('no account');
  st.wallet = w; st.account = acc; pref('wallet', w.name);
  const ev = w.features['standard:events'];
  if(ev && !w.__dcOn){ w.__dcOn = true; ev.on('change', ({ accounts }) => { if(st.wallet === w){ st.account = (accounts || [])[0] || null; renderWallet(); renderSum(); } }); }
  renderWallet(); renderSum();
}
async function disconnect(){
  const w = st.wallet; st.wallet = null; st.account = null; pref('wallet', null);
  try{ await w?.features['standard:disconnect']?.disconnect(); }catch(_){}
  renderWallet(); renderSum();
}
async function signTx(b64){
  const f = st.wallet.features['solana:signTransaction'];
  const out = await f.signTransaction({ account: st.account, transaction: fromB64(b64), chain: CHAIN });
  const signed = (Array.isArray(out) ? out[0] : out)?.signedTransaction;
  if(!signed) throw new Error('not signed');
  return toB64(new Uint8Array(signed));
}

/* ---------- edge function ---------- */
async function call(body){
  const { data, error } = await sb.functions.invoke('launch', { body });
  if(error){
    let j = null; try{ j = await error.context.json(); }catch(_){}
    const e = new Error((j && j.error) || 'network'); e.info = j; throw e;
  }
  return data;
}

/* ---------- image: square, max 512 px, stays under 1 MB (GIF kept as is to keep the animation) ---------- */
function readImage(file){
  return new Promise((res, rej) => {
    if(!file || !/^image\/(png|jpeg|gif|webp)$/.test(file.type)) return rej(new Error('image'));
    if(file.type === 'image/gif'){
      if(file.size > 1_000_000) return rej(new Error('image_size'));
      const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = () => rej(new Error('image')); fr.readAsDataURL(file); return;
    }
    const url = URL.createObjectURL(file), im = new Image();
    im.onload = () => {
      const s = Math.min(im.naturalWidth, im.naturalHeight), out = Math.min(512, s), c = document.createElement('canvas');
      c.width = c.height = out;
      c.getContext('2d').drawImage(im, (im.naturalWidth - s)/2, (im.naturalHeight - s)/2, s, s, 0, 0, out, out);
      URL.revokeObjectURL(url);
      let d = c.toDataURL('image/png');
      if(d.length > 1_300_000) d = c.toDataURL('image/jpeg', 0.9);
      res(d);
    };
    im.onerror = () => { URL.revokeObjectURL(url); rej(new Error('image')); };
    im.src = url;
  });
}

/* ---------- form ---------- */
const val = id => ($(id).value || '').trim();
const num = id => { const n = Number($(id).value); return Number.isFinite(n) ? n : NaN; };
function form(){
  return { name: val('lnName'), symbol: val('lnSymbol').toUpperCase().replace(/[^A-Z0-9]/g, ''), description: val('lnDesc'),
    twitter: val('lnX'), telegram: val('lnTg'), website: val('lnWeb'), devBuy: num('lnBuy') || 0, liquidity: num('lnLiq'), accept: $('lnAccept').checked };
}
function problems(f){
  const L = st.cfg.limits, p = [];
  if(!st.img) p.push('image');
  if(f.name.length < 2) p.push('name');
  if(f.symbol.length < 2) p.push('symbol');
  if(!(f.devBuy >= 0) || f.devBuy > (st.mode === 'lp' ? L.lpBuyMax : L.pumpBuyMax)) p.push('buy');
  if(st.mode === 'lp'){ if(!(f.liquidity >= L.lpLiqMin && f.liquidity <= L.lpLiqMax)) p.push('liquidity'); else if(f.devBuy > f.liquidity) p.push('buy_share'); }
  if(!f.accept) p.push('accept');
  return p;
}
function setMode(m){
  if(m === 'lp' && !st.cfg.lp) return;
  st.mode = m;
  document.querySelectorAll('[data-ln-mode]').forEach(b => { const on = b.dataset.lnMode === m; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); });
  $('lnLiqRow').hidden = m !== 'lp';
  $('lnBuy').max = m === 'lp' ? st.cfg.limits.lpBuyMax : st.cfg.limits.pumpBuyMax;
  renderSum();
}

/* ---------- render ---------- */
function renderPreview(){
  const f = form();
  $('lnPreview').innerHTML = `<div class="ln-card"><div class="ln-card-img">${st.img ? `<img src="${st.img}" alt="">` : '<span>?</span>'}</div>
    <div class="ln-card-t"><b>$${esc(f.symbol || 'TICKER')}</b><span>${esc(f.name || 'Coin name')}</span></div>
    <div class="ln-card-tags">${st.mode === 'lp' ? '<i>LP LOCKED</i><i>MINT REVOKED</i><i>NO FREEZE</i>' : '<i>PUMP.FUN</i><i>BONDING CURVE</i>'}</div></div>`;
}
function renderSum(){
  const f = form(), lp = st.mode === 'lp', buy = Math.max(0, f.devBuy || 0), liq = lp ? Math.max(0, f.liquidity || 0) : 0;
  const share = buy <= 0 ? 0 : lp ? (liq > 0 ? buy * 0.99 / (liq + buy) : 0) : Math.min(1, PUMP_VTOK * buy / (PUMP_VSOL + buy) / SUPPLY);
  const startMc = lp ? liq : PUMP_VSOL / (PUMP_VTOK / SUPPLY);
  const total = buy + (lp ? liq + st.cfg.feeSol + 0.03 : 0.02);
  const rows = [
    ['Starting market cap', `≈ ${startMc >= 10 ? Math.round(startMc) : solFmt(startMc)} SOL`],
    ['Your first buy', buy > 0 ? `${solFmt(buy)} SOL → ~${(share*100).toFixed(1)}% of supply` : 'None'],
    ...(lp ? [['Pool liquidity (locked)', `${solFmt(liq)} SOL + 100% of supply`], ['DEGENCARDS fee', `${solFmt(st.cfg.feeSol)} SOL`]] : [['DEGENCARDS fee', 'Free']]),
    ['Total from your wallet', `≈ ${solFmt(total)} SOL`],
  ];
  $('lnSum').innerHTML = `<div class="hm-label">SUMMARY</div>${rows.map(([l,v]) => `<div class="ln-sum-r"><span>${l}</span><b>${v}</b></div>`).join('')}
    <p class="ln-sum-n">${lp ? 'Network fees and account rent included (approx.).' : 'Plus network fees. PumpPortal, which builds the pump.fun transaction, takes ~0.5% of your first buy.'}</p>`;
  $('lnBuyHint').textContent = share > 0.2 ? `That's ${(share*100).toFixed(0)}% of the supply: holders and scanners (our Radar too) flag big dev bags.` : 'Bought in the same transaction as the launch: nobody can buy before you. Public on-chain.';
  $('lnBuyHint').classList.toggle('warn', share > 0.2);
  const p = problems(f);
  $('lnGo').disabled = st.busy || !st.account || p.length > 0;
  $('lnGo').textContent = !st.account ? 'CONNECT A WALLET TO LAUNCH' : st.busy ? 'LAUNCHING…' : `LAUNCH $${f.symbol || 'COIN'}`;
  renderPreview();
}
function renderWallet(){
  const box = $('lnWallet'); if(!box) return;
  if(st.account){
    box.innerHTML = `<div class="ln-w-on">${st.wallet.icon ? `<img src="${esc(st.wallet.icon)}" alt="">` : ''}<span><b>${esc(st.wallet.name)}</b><small>${short(st.account.address)}</small></span><button type="button" class="hm-btn" data-ln-disc>DISCONNECT</button></div>`;
    return;
  }
  const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  const here = encodeURIComponent(location.origin + '/?v=launch'), ref = encodeURIComponent(location.origin);
  box.innerHTML = st.wallets.length
    ? `<div class="hm-label">CONNECT A WALLET</div><div class="ln-w-list">${st.wallets.map((w,i) => `<button type="button" class="ln-w" data-ln-w="${i}">${w.icon ? `<img src="${esc(w.icon)}" alt="">` : ''}${esc(w.name)}</button>`).join('')}</div>`
    : mobile
      ? `<div class="hm-label">OPEN IN YOUR WALLET APP</div><p class="ln-w-p">On a phone, launches run inside your wallet's browser. You'll sign in to DEGENCARDS there once.</p>
         <div class="ln-w-list"><a class="ln-w" href="https://phantom.app/ul/browse/${here}?ref=${ref}">Phantom</a><a class="ln-w" href="https://solflare.com/ul/v1/browse/${here}?ref=${ref}">Solflare</a></div>`
      : `<div class="hm-label">NO WALLET FOUND</div><p class="ln-w-p">Install a Solana wallet extension (Phantom, Solflare or Backpack), then reload this page.</p>`;
}
const STEP_LABELS = { pump: ['Upload image & build the launch', 'Sign in your wallet', 'Confirm on Solana'],
  lp: ['Upload image & build the token', 'Sign: create token + fee', 'Confirm on Solana', 'Sign: pool + lock + your buy', 'Confirm on Solana'] };
function steps(mode, at, err){
  const box = $('lnSteps'); box.hidden = false;
  box.innerHTML = STEP_LABELS[mode].map((l, i) => `<div class="ln-step ${i < at ? 'done' : i === at ? (err ? 'err' : 'now') : ''}"><i>${i < at ? '✓' : i + 1}</i><span>${l}</span></div>`).join('')
    + (err ? `<p class="ln-err">${esc(err)}</p>` : '');
}
function success(L){
  const lp = L.mode === 'lp';
  const links = lp ? [['DexScreener', `https://dexscreener.com/solana/${L.mint}`], ['Meteora pool', `https://app.meteora.ag/dammv2/${L.pool}`], ['Solscan', `https://solscan.io/token/${L.mint}`]]
    : [['pump.fun', `https://pump.fun/coin/${L.mint}`], ['DexScreener', `https://dexscreener.com/solana/${L.mint}`], ['Solscan', `https://solscan.io/token/${L.mint}`]];
  $('lnSteps').innerHTML = `<div class="ln-done"><b>$${esc(L.symbol)} is live</b><span class="ln-ca">${L.mint}</span>
    <div class="ln-done-a"><button type="button" class="hm-btn primary" data-ln-copy="${L.mint}">COPY CA</button>${links.map(([n,u]) => `<a class="hm-btn" href="${u}" target="_blank" rel="noopener">${n}</a>`).join('')}</div></div>`;
  try{ window.spawnConfetti && spawnConfetti(); }catch(_){}
}
function renderMine(){
  const box = $('lnMine'); if(!box) return;
  if(!st.mine.length){ box.innerHTML = `<div class="hm-panel ln-empty">Your coins will show up here, with their links.</div>`; return; }
  box.innerHTML = st.mine.map(L => {
    const live = L.status === 'live', lp = L.mode === 'lp';
    const url = lp ? `https://dexscreener.com/solana/${L.mint}` : `https://pump.fun/coin/${L.mint}`;
    const state = live ? '<em class="ok">LIVE</em>' : lp && (L.sigs || []).length ? '<em class="warn">POOL MISSING</em>' : '<em>NOT LAUNCHED</em>';
    return `<div class="ln-mine-r hm-panel">${L.image ? `<img src="${esc(L.image)}" alt="">` : '<span class="ln-mine-ph"></span>'}
      <div class="ln-mine-t"><b>$${esc(L.symbol)}</b><span>${esc(L.name)} · ${lp ? 'Liquidity pool' : 'Bonding curve'} · ${new Date(L.created_at).toLocaleDateString('en-US',{ month:'short', day:'numeric' })}</span></div>
      ${state}
      <div class="ln-mine-a">${live ? `<button type="button" class="hm-btn" data-ln-copy="${L.mint}">COPY CA</button><a class="hm-btn" href="${url}" target="_blank" rel="noopener">OPEN</a>`
        : lp && (L.sigs || []).length ? `<button type="button" class="hm-btn primary" data-ln-resume="${L.id}">FINISH POOL</button>` : ''}</div></div>`;
  }).join('');
}
async function loadMine(){
  try{
    const { data } = await sb.from('launches').select('id,mode,mint,pool,name,symbol,image,status,sigs,created_at').order('created_at', { ascending:false }).limit(30);
    st.mine = (data || []).filter(L => L.status === 'live' || (L.sigs || []).length);
  }catch(_){ st.mine = []; }
  renderMine();
}

/* ---------- launch flow ---------- */
const errMsg = e => {
  const m = String(e && e.message || e);
  if(/reject|denied|cancel|declined|user rejected/i.test(m)) return 'Cancelled in your wallet. Nothing was sent.';
  if(m === 'balance'){ const i = e.info || {}; return i.need ? `Not enough SOL: this launch needs about ${i.need} SOL, your wallet has ${i.have}.` : 'Not enough SOL in your wallet.'; }
  return ERR[m] || ERR.server;
};
async function sendSigned(id, b64){
  const r = await call({ action:'send', id, tx: b64 });
  if(!r || !r.ok) throw new Error(r && r.err && /blockhash|expired/i.test(r.err) ? 'expired' : 'Transaction failed on-chain' + (r && r.err ? ': ' + r.err : ''));
  return r;
}
async function runPool(L, at){                                          // lp tx2: pool + permanent lock + creator buy
  steps('lp', at);
  const r = await call({ action:'resume', id: L.id });
  steps('lp', at);
  const signed = await signTx(r.txs[0]);
  steps('lp', at + 1);
  await sendSigned(L.id, signed);
  return { ...L, pool: r.pool };
}
async function launch(){
  const f = form(), p = problems(f);
  if(p.length){ showToast(ERR[p[0]]); return; }
  if(!st.account){ showToast(ERR.wallet); return; }
  st.busy = true; renderSum();
  const mode = st.mode;
  let at = 0, L = null;
  try{
    steps(mode, 0);
    const r = await call({ action:'prepare', mode, wallet: st.account.address, image: st.img, ...f, liquidity: mode === 'lp' ? f.liquidity : undefined });
    L = { id: r.id, mint: r.mint, pool: r.pool, mode, symbol: f.symbol, name: f.name };
    at = 1; steps(mode, at);
    const signed = await signTx(r.txs[0]);
    at = 2; steps(mode, at);
    await sendSigned(r.id, signed);
    if(mode === 'lp'){ at = 3; L = await runPool(L, 3); }
    success(L);
    resetForm();
    loadMine();
  }catch(e){
    steps(mode, at, errMsg(e) + (mode === 'lp' && at >= 3 ? ' Your token exists: finish the pool from "Your launches" below.' : ''));
    if(mode === 'lp' && at >= 3) loadMine();
  }finally{ st.busy = false; renderSum(); }
}
async function resume(id){
  if(st.busy) return;
  if(!st.account){ showToast(ERR.wallet); window.scrollTo({ top:0, behavior:'smooth' }); return; }
  const L = st.mine.find(x => x.id === id); if(!L) return;
  st.busy = true; renderSum(); window.scrollTo({ top:0, behavior:'smooth' });
  try{ const done = await runPool({ ...L }, 3); success(done); loadMine(); }
  catch(e){ steps('lp', 3, errMsg(e)); }
  finally{ st.busy = false; renderSum(); }
}
function resetForm(){
  ['lnName','lnSymbol','lnDesc','lnX','lnTg','lnWeb'].forEach(id => $(id).value = '');
  $('lnBuy').value = '0'; $('lnAccept').checked = false; st.img = null;
  $('lnImgPrev').hidden = true; $('lnImgPh').hidden = false;
  renderSum();
}

/* ---------- wiring ---------- */
function bind(){
  document.querySelectorAll('[data-ln-mode]').forEach(b => b.addEventListener('click', () => setMode(b.dataset.lnMode)));
  $('lnForm').addEventListener('input', renderSum);
  $('lnForm').addEventListener('change', renderSum);
  $('lnForm').addEventListener('submit', e => e.preventDefault());
  $('lnSymbol').addEventListener('input', e => { const v = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10); if(v !== e.target.value) e.target.value = v; });
  document.querySelectorAll('[data-ln-chips]').forEach(g => g.addEventListener('click', e => { const b = e.target.closest('button[data-v]'); if(!b) return; $(g.dataset.lnChips).value = b.dataset.v; renderSum(); }));
  const pick = async file => { try{ st.img = await readImage(file); $('lnImgPrev').src = st.img; $('lnImgPrev').hidden = false; $('lnImgPh').hidden = true; renderSum(); }catch(e){ showToast(ERR[e.message] || ERR.image); } };
  $('lnImg').addEventListener('change', e => { const f = e.target.files && e.target.files[0]; e.target.value = ''; if(f) pick(f); });
  const drop = $('lnImgDrop');
  drop.addEventListener('click', e => { if(e.target !== $('lnImg')) $('lnImg').click(); });
  drop.addEventListener('keydown', e => { if(e.key === 'Enter' || e.key === ' '){ e.preventDefault(); $('lnImg').click(); } });
  drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('drag'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('drag'));
  drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('drag'); const f = e.dataTransfer.files && e.dataTransfer.files[0]; if(f) pick(f); });
  $('lnGo').addEventListener('click', () => { if(!st.account){ $('lnWallet').scrollIntoView({ block:'center', behavior:'smooth' }); return; } launch(); });
  $('launchView').addEventListener('click', async e => {
    const w = e.target.closest('[data-ln-w]'), c = e.target.closest('[data-ln-copy]'), r = e.target.closest('[data-ln-resume]');
    if(w){ try{ await connect(st.wallets[Number(w.dataset.lnW)]); }catch(err){ showToast(/reject|denied|cancel/i.test(String(err && err.message)) ? 'Connection cancelled' : 'Could not connect the wallet'); } }
    else if(e.target.closest('[data-ln-disc]')) disconnect();
    else if(c){ try{ await navigator.clipboard.writeText(c.dataset.lnCopy); showToast('Contract address copied'); }catch(_){ showToast(c.dataset.lnCopy); } }
    else if(r) resume(r.dataset.lnResume);
  });
}
let bound = false;
async function open(){
  if(!bound){ bound = true; bind(); }
  renderWallet(); renderSum(); loadMine();
  if(!st.opened){
    st.opened = true;
    try{ const c = await call({ action:'status' }); if(c) st.cfg = { ...st.cfg, ...c, limits: { ...st.cfg.limits, ...(c.limits || {}) } }; }catch(_){}
    $('lnFee').textContent = st.cfg.lp ? `${solFmt(st.cfg.feeSol)} SOL` : 'SOON';
    const lpBtn = document.querySelector('[data-ln-mode="lp"]'); lpBtn.classList.toggle('soon', !st.cfg.lp); lpBtn.setAttribute('aria-disabled', String(!st.cfg.lp));
    renderSum();
  }
}
window.dcLaunch = { open };
})();
