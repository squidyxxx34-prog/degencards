/* ---------- supabase ---------- */
const SUPABASE_URL = "https://wlxyepkewatmwlziybfb.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndseHllcGtld2F0bXdseml5YmZiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAyNDA0NjMsImV4cCI6MjEwNTgxNjQ2M30.4PK7xHPyLhcCBbBv5GcoMJN-X1AltAI4o50ZvqSH1II";
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { flowType: 'pkce', detectSessionInUrl: true, persistSession: true, autoRefreshToken: true }
});
/* ---------- input hardening ---------- */
const SOURCES = ['manual','pumpfun','fomo','wallet'];
const B58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;                 // Solana address shape
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/* coin images live in our own public bucket (copied there by the sync server); anything else is ignored */
const IMG_PREFIX = 'https://wlxyepkewatmwlziybfb.supabase.co/storage/v1/object/public/coin-images/';
function safeImg(u){ return (typeof u === 'string' && u.startsWith(IMG_PREFIX) && /^[A-Za-z0-9._\/-]+$/.test(u.slice(IMG_PREFIX.length))) ? u : null; }
function coinImg(t, size, cls=''){
  const letter = esc((String(t.ticker||'?').replace(/^\$/,'')[0]||'?').toUpperCase());
  return t.image
    ? `<span class="coin-img ${cls}" style="width:${size}px;height:${size}px"><img src="${t.image}" alt="${esc(tk(t.ticker))} logo" loading="lazy" decoding="async" width="${size}" height="${size}"></span>`
    : `<span class="coin-img ph ${cls}" style="width:${size}px;height:${size}px;font-size:${Math.round(size*0.42)}px" aria-hidden="true">${letter}</span>`;
}
/* display form of a ticker: always "$TICKER" (never "$$"), except placeholders */
function tk(s){ s = String(s||''); return (!s || s.startsWith('$') || s.includes('…') || s==='UNKNOWN') ? s : '$'+s; }
function cleanTicker(s){ return String(s||'').replace(/[\u0000-\u001f\u007f<>&"'`\\]/g,'').trim().slice(0,24); }
function num(v, min, max, dflt){ v = Number(v); if(!Number.isFinite(v)) return dflt||0; return Math.min(max, Math.max(min, v)); }
const REDIRECT_URL = location.origin + location.pathname;      // never echo query/hash back to the auth server
let idCounter = 0;
/* strip any auth code/token leftovers from the visible URL once handled */
function scrubUrl(){
  if(location.search || location.hash){
    history.replaceState(null, '', location.pathname);
  }
}
/* escape all user-supplied free text before it ever hits innerHTML */
function esc(s){
  return String(s ?? '').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

let session = null;
let trades = [];
let connectedAccounts = [];
let deletedTrades = [];
let histSelect = false;           // History: select mode
const histSel = new Set();        // History: selected ids
const binSel = new Set();         // Recover: selected ids
let goalTarget = 0;
let view = "home";
let activeFilter = "all";
let sortMode = "newest";

const RARITY_ORDER=["common","uncommon","rare","epic","legendary","mythic"];
const ACH_CATALOG = [
  {key:"first_blood",icon:"flame",name:"FIRST BLOOD",desc:"First profitable trade."},
  {key:"moonshot",icon:"rocket",name:"MOONSHOT",desc:"Trade with +100% ROI."},
  {key:"to_the_moon",icon:"rocket",name:"TO THE MOON",desc:"Trade with +500% ROI."},
  {key:"speedrun",icon:"bolt",name:"SPEEDRUN",desc:"Profitable trade closed under 30 seconds."},
  {key:"paper_hands",icon:"doc",name:"PAPER HANDS",desc:"Exited a position in under 10 seconds."},
  {key:"diamond_hands",icon:"gem",name:"DIAMOND HANDS",desc:"Held 24h+ and still closed in profit."},
  {key:"new_record",icon:"trophy",name:"NEW RECORD",desc:"Best trade ever."},
  {key:"run_it_back",icon:"chartUp",name:"RUN IT BACK",desc:"3 winning trades in a row."},
  {key:"on_fire",icon:"flame",name:"ON FIRE",desc:"5 consecutive profitable trades."},
  {key:"unstoppable",icon:"bolt",name:"UNSTOPPABLE",desc:"10 consecutive profitable trades."},
  {key:"king_of_day",icon:"crown",name:"KING OF THE DAY",desc:"Best trade of the day."},
  {key:"worst_of_day",icon:"trash",name:"ROUGH DAY",desc:"Worst trade of the day."},
  {key:"comeback_kid",icon:"arrowUpCircle",name:"COMEBACK KID",desc:"Won right after 2+ losses in a row."},
  {key:"iron_stomach",icon:"shield",name:"IRON STOMACH",desc:"3 losses in a row and still here."},
  {key:"rugged",icon:"alertTriangle",name:"RUGGED",desc:"Lost 50%+ on a position."},
  {key:"rekt",icon:"skull",name:"REKT",desc:"Lost 80%+ on a position."},
  {key:"whale",icon:"chartUp",name:"WHALE",desc:"Trade with $500+ profit."},
  {key:"micro_win",icon:"sprout",name:"FIRST STEPS",desc:"A small but real profit, under $1."},
  {key:"night_owl",icon:"moon",name:"NIGHT OWL",desc:"Traded between midnight and 5am."},
  {key:"weekend_warrior",icon:"calendar",name:"WEEKEND WARRIOR",desc:"Traded on a weekend."},
  {key:"first_trade",icon:"flag",name:"DAY ONE",desc:"Your very first logged trade."},
  {key:"ten_trades",icon:"hash",name:"GETTING SERIOUS",desc:"10 trades logged."},
  {key:"fifty_trades",icon:"hash",name:"VETERAN",desc:"50 trades logged."},
  {key:"century_club",icon:"hash",name:"CENTURY CLUB",desc:"100 trades logged."},
  {key:"on_chain",icon:"link",name:"PROOF OF DEGEN",desc:"First trade imported straight from your wallet."},
  {key:"goal_first_milestone",icon:"trophy",name:"FIRST MILESTONE",desc:"Reached your first profit goal."},
  {key:"goal_crusher",icon:"trophy",name:"GOAL CRUSHER",desc:"Reached a $100-$499 profit goal."},
  {key:"goal_smasher",icon:"trophy",name:"TARGET SMASHED",desc:"Reached a $500-$1999 profit goal."},
  {key:"goal_legend",icon:"trophy",name:"LEGENDARY TARGET",desc:"Reached a $2000+ profit goal."},
];
const ACH_MAP = Object.fromEntries(ACH_CATALOG.map(a=>[a.key,a]));

/* ---------- icon set (custom minimal line icons — no emoji anywhere) ---------- */
const ICON_PATHS = {
  lock:"M6 11h12v10H6z M8 11V7a4 4 0 0 1 8 0v4",
  sparkle:"M12 2l1.8 5.2L19 9l-5.2 1.8L12 16l-1.8-5.2L5 9l5.2-1.8L12 2z",
  flame:"M12 3c1 3-3 4-3 8a3 3 0 006 0c0-1.5-1-2-1-3.5 2 1 3 3 3 5.5a5 5 0 01-10 0c0-4 3-5 5-10z",
  rocket:"M12 2c3 1 5 4 5 8 0 2-1 4-2 5l-3 3-3-3c-1-1-2-3-2-5 0-4 2-7 5-8z M9 15l-2 5 M15 15l2 5 M10 9a2 2 0 104 0 2 2 0 00-4 0z",
  bolt:"M13 2L4 14h6l-1 8 9-12h-6l1-8z",
  doc:"M6 2h8l4 4v16H6V2z M14 2v4h4",
  gem:"M6 3h12l3 5-9 13L3 8l3-5z M3 8h18 M9 3l3 5 3-5 M9 8l3 13 3-13",
  trophy:"M7 4h10v3a5 5 0 01-10 0V4z M7 5H4a3 3 0 003 3 M17 5h3a3 3 0 01-3 3 M10 14v3h4v-3 M8 21h8 M9 17h6v4H9z",
  chartUp:"M3 17l5-5 4 4 8-9 M15 7h5v5",
  crown:"M3 8l4 3 5-6 5 6 4-3-2 10H5L3 8z",
  trash:"M4 7h16 M9 7V4h6v3 M6 7l1 13h10l1-13 M10 11v6 M14 11v6",
  arrowUpCircle:"M12 21a9 9 0 100-18 9 9 0 000 18z M12 16V8 M8 12l4-4 4 4",
  shield:"M12 2l8 4v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6l8-4z",
  alertTriangle:"M12 3l10 18H2L12 3z M12 10v5 M12 18h.01",
  skull:"M12 3a7 7 0 00-7 7v3l2 2v3h4v-2h2v2h4v-3l2-2v-3a7 7 0 00-7-7z M9 11a1.5 1.5 0 103 0 1.5 1.5 0 00-3 0z M12 11a1.5 1.5 0 103 0 1.5 1.5 0 00-3 0z",
  sprout:"M12 22v-9 M12 13c-5 0-8-3-8-8 5 0 8 3 8 8z M12 13c5 0 8-4 8-9-5 0-8 3-8 9z",
  moon:"M20 14.5A8.5 8.5 0 1110.5 4a7 7 0 009.5 10.5z",
  calendar:"M4 5h16v16H4V5z M4 9h16 M8 3v4 M16 3v4",
  flag:"M5 3v18 M5 4h13l-3 4 3 4H5",
  hash:"M6 4l-1 16 M15 4l-1 16 M3 9h17 M2 15h17",
  link:"M9 12a4 4 0 004 4h3a4 4 0 000-8h-1 M15 12a4 4 0 00-4-4H8a4 4 0 000 8h1",
  layers:"M12 3l9 5-9 5-9-5 9-5z M3 13l9 5 9-5 M3 9l9 5 9-5",
  check:"M4 12l5 5 11-11",
  x:"M5 5l14 14 M19 5L5 19",
  target:"M12 21a9 9 0 100-18 9 9 0 000 18z M12 16a4 4 0 100-8 4 4 0 000 8z M12 13a1 1 0 100-2 1 1 0 000 2z",
  coin:"M12 21a9 9 0 100-18 9 9 0 000 18z M12 7v10 M9 9.5c0-1 1-2 3-2s3 .8 3 1.8-1 1.5-3 1.7-3 .8-3 1.8 1 1.8 3 1.8 3-.8 3-1.8"
};
function icon(name, size, color){
  const d = ICON_PATHS[name] || ICON_PATHS.sparkle;
  const c = color || 'currentColor';
  return `<svg width="${size||18}" height="${size||18}" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-4px;flex-shrink:0;"><path d="${d}"/></svg>`;
}
const PROVIDERS = [
  {key:"pumpfun", name:"Pump.fun", sub:"Paste your Pump.fun wallet address"},
  {key:"fomo", name:"Fomo", sub:"Paste your Fomo wallet address"},
  {key:"wallet", name:"Other Solana wallet", sub:"Phantom, Solflare, Backpack..."},
];

/* ---------- data layer (Supabase) ---------- */
const store = {
  async getTrades(){
    const {data,error} = await sb.from('trades').select('*').is('deleted_at', null).order('timestamp_ms',{ascending:false}).limit(2000);
    if(error){ console.error('trades load failed'); return []; }
    return data.filter(r=>UUID_RE.test(String(r.id))).map(r=>({ id:String(r.id), tradeId:num(r.trade_id,0,1e9), ticker:cleanTicker(r.ticker)||'UNKNOWN', pnl:num(r.pnl,-1e12,1e12), roi:num(r.roi,-100,1e7), entryMc:num(r.entry_mc,0,1e15), exitMc:num(r.exit_mc,0,1e15), holdTime:num(r.hold_time,0,31536000), timestamp:num(r.timestamp_ms,0,4102444800000), source: SOURCES.includes(r.source)?r.source:'manual', chart: parseChart(r.chart),
      mint: typeof r.mint==='string' && B58.test(r.mint) ? r.mint : null, chartTries: Number(r.chart_tries)||0, image: safeImg(r.image),
      fees: r.fees_usd==null ? null : num(r.fees_usd,-1e10,1e10), pnlNet: r.pnl_net==null ? null : num(r.pnl_net,-1e10,1e10), cashback: r.cashback_usd==null ? 0 : num(r.cashback_usd,0,1e9), legs: Array.isArray(r.legs) ? r.legs.slice(0,20) : null }));
  },
  async getDeleted(){
    const {data,error} = await sb.from('trades').select('id,ticker,pnl,roi,timestamp_ms,source,deleted_at')
      .not('deleted_at','is',null).order('deleted_at',{ascending:false}).limit(2000);
    if(error) return [];
    return data.filter(r=>UUID_RE.test(String(r.id))).map(r=>({ id:String(r.id), ticker:cleanTicker(r.ticker)||'UNKNOWN',
      pnl:num(r.pnl,-1e12,1e12), roi:num(r.roi,-100,1e7), timestamp:num(r.timestamp_ms,0,4102444800000),
      source: SOURCES.includes(r.source)?r.source:'manual', deletedAt: Date.parse(r.deleted_at)||Date.now() }));
  },
  /* ids = array of uuids, or 'all'. Chunked so the URL stays short. */
  async _bulk(ids, apply){
    if(ids === 'all') return !(await apply(null)).error;
    const clean = ids.filter(id=>UUID_RE.test(id));
    for(let i=0;i<clean.length;i+=100){ const {error} = await apply(clean.slice(i,i+100)); if(error) return false; }
    return true;
  },
  softDelete(ids){ return this._bulk(ids, chunk=>{
    let q = sb.from('trades').update({deleted_at:new Date().toISOString()}).eq('user_id', session.user.id).is('deleted_at', null);
    return chunk ? q.in('id', chunk) : q; }); },
  restore(ids){ return this._bulk(ids, chunk=>{
    let q = sb.from('trades').update({deleted_at:null}).eq('user_id', session.user.id).not('deleted_at','is',null);
    return chunk ? q.in('id', chunk) : q; }); },
  purge(ids){ return this._bulk(ids, chunk=>{
    let q = sb.from('trades').delete().eq('user_id', session.user.id).not('deleted_at','is',null);
    return chunk ? q.in('id', chunk) : q; }); },
  nextTradeId(){
    const base = trades.length ? Math.max(...trades.map(x=>x.tradeId)) : 0;
    idCounter = Math.max(idCounter, base) + 1;   // running counter: no more duplicate #numbers during multi-inserts
    return idCounter;                            // (the DB trigger, when installed, overrides this anyway)
  },
  async saveTrade(t){
    const row = {                                   // trade_id / created_at are assigned by the DB trigger
      user_id: session.user.id,
      ticker: cleanTicker(t.ticker) || 'UNKNOWN',
      pnl: Math.round(num(t.pnl,-1e10,1e10)*100)/100, roi: Math.round(num(t.roi,-100,1e7)*10)/10,
      entry_mc: Math.round(num(t.entryMc,0,1e13)), exit_mc: Math.round(num(t.exitMc,0,1e13)),
      hold_time: Math.round(num(t.holdTime,0,31536000)),
      timestamp_ms: Math.round(num(t.timestamp || Date.now(), 1230768000000, 4102444800000)),
      source: t.source === 'wallet' ? 'wallet' : 'manual'
    };
    const {error} = await sb.from('trades').insert(row);
    if(error){
      const m = String(error.message||'');
      if(m.includes('rate limit')) showToast('Slow down — too many trades in a minute');
      else if(m.includes('trade limit')) showToast('Trade limit reached');
      console.error('trade save failed'); return false;
    }
    return true;
  },
  async getAccounts(){
    const {data,error} = await sb.from('connected_accounts').select('provider,handle,last_synced_at,sync_error,sync_pending,sync_imported');
    if(error){ console.error('accounts load failed'); return []; }
    return data.filter(a=>['pumpfun','fomo','wallet'].includes(a.provider)).map(a=>({
      provider:a.provider, handle:String(a.handle).slice(0,120),
      syncedAt: a.last_synced_at ? Date.parse(a.last_synced_at) : 0, error: a.sync_error ? String(a.sync_error).slice(0,200) : '',
      pending: Number(a.sync_pending)||0, imported: Number(a.sync_imported)||0
    }));
  },
  async connectAccount(provider, handle){
    const {error} = await sb.from('connected_accounts').upsert({user_id:session.user.id, provider, handle:String(handle).slice(0,120)}, {onConflict:'user_id,provider'});
    if(error){ console.error('account link failed'); return false; }
    return true;
  },
  async disconnectAccount(provider){
    const {error} = await sb.from('connected_accounts').delete().eq('provider', provider);
    return !error;
  },

  async getGoal(){
    const {data} = await sb.from('goals').select('target_pnl').eq('user_id', session.user.id).maybeSingle();
    return data ? num(data.target_pnl,0,1e9) : 0;
  },
  async setGoal(amount){
    const {error} = await sb.from('goals').upsert({user_id:session.user.id, target_pnl:num(amount,0,1e9), updated_at:new Date().toISOString()});
    if(error) console.error('goal save failed');
  }
};

/* ---------- rarity / achievements / grade ---------- */
function computeRarity(t, ctx){
  let score = 0;
  score += Math.max(0, t.roi);
  if(t.holdTime>0 && t.holdTime<30 && t.pnl>0) score += 40;
  if(ctx.isPersonalBest) score += 80;
  if(ctx.streak>=5) score += 30;
  if(t.roi>=250) return "mythic";
  if(t.roi>=100 || score>=180) return "legendary";
  if(t.roi>=50 || score>=100) return "epic";
  if(t.roi>=20 || score>=50) return "rare";
  if(t.roi>0) return "uncommon";
  return "common";
}
function computeGrade(t, rarity){
  const order=["common","uncommon","rare","epic","legendary","mythic"];
  const i = order.indexOf(rarity);
  if(i>=4) return "S"; if(i===3) return "A"; if(i===2) return "B"; if(t.pnl>0) return "C"; return "D";
}
function computeAchievements(t, ctx){
  const list=[];
  if(ctx.isFirstWin) list.push(ACH_MAP.first_blood);
  if(t.roi>=500) list.push(ACH_MAP.to_the_moon);
  else if(t.roi>=100) list.push(ACH_MAP.moonshot);
  if(t.holdTime<=10) list.push(ACH_MAP.paper_hands);
  else if(t.holdTime<=30 && t.pnl>0) list.push(ACH_MAP.speedrun);
  if(t.holdTime>=86400 && t.pnl>0) list.push(ACH_MAP.diamond_hands);
  if(ctx.isPersonalBest) list.push(ACH_MAP.new_record);
  if(ctx.streak>=10) list.push(ACH_MAP.unstoppable);
  else if(ctx.streak>=5) list.push(ACH_MAP.on_fire);
  else if(ctx.streak===3) list.push(ACH_MAP.run_it_back);
  if(ctx.isBestOfDay) list.push(ACH_MAP.king_of_day);
  if(ctx.isWorstOfDay && t.pnl<0) list.push(ACH_MAP.worst_of_day);
  if(ctx.comeback) list.push(ACH_MAP.comeback_kid);
  if(ctx.lossStreak>=3) list.push(ACH_MAP.iron_stomach);
  if(t.roi<=-80) list.push(ACH_MAP.rekt);
  else if(t.roi<=-50) list.push(ACH_MAP.rugged);
  if(t.pnl>=500) list.push(ACH_MAP.whale);
  else if(t.pnl>0 && t.pnl<1) list.push(ACH_MAP.micro_win);
  if(ctx.hour>=0 && ctx.hour<5) list.push(ACH_MAP.night_owl);
  if(ctx.day===0 || ctx.day===6) list.push(ACH_MAP.weekend_warrior);
  if(ctx.tradeNumber===1) list.push(ACH_MAP.first_trade);
  else if(ctx.tradeNumber===100) list.push(ACH_MAP.century_club);
  else if(ctx.tradeNumber===50) list.push(ACH_MAP.fifty_trades);
  else if(ctx.tradeNumber===10) list.push(ACH_MAP.ten_trades);
  if(ctx.isFirstWalletImport) list.push(ACH_MAP.on_chain);
  return list;
}
function vibeFor(t){
  if(t.holdTime<=30 && t.pnl>0) return {icon:"bolt", label:"SNIPER"};
  if(t.roi>=100) return {icon:"rocket", label:"MOONSHOT"};
  if(t.roi<0 && t.holdTime>3600) return {icon:"gem", label:"DIAMOND HANDS"};
  if(t.pnl<0) return {icon:"skull", label:"RUG SURVIVOR"};
  return {icon:"flame", label:"DEGEN"};
}
/* card color driven by PnL magnitude, independent of rarity */
function pnlColor(t){
  const win = t.pnl>=0;
  const mag = Math.min(Math.abs(t.roi)/150, 1);
  return win
    ? { border:`rgba(57,255,154,${(0.22+mag*0.55).toFixed(2)})`, glow:`rgba(57,255,154,${(0.08+mag*0.2).toFixed(2)})` }
    : { border:`rgba(255,75,92,${(0.22+mag*0.55).toFixed(2)})`,  glow:`rgba(255,75,92,${(0.08+mag*0.2).toFixed(2)})` };
}

const fmt = {
  usd(n){ const s=n<0?"-":"+"; return s+"$"+Math.abs(n).toFixed(2); },
  pct(n){ const s=n<0?"":"+"; return s+n.toFixed(1)+"%"; },
  mc(n){ n = Number(n)||0; if(n>=1e9) return "$"+(n/1e9).toFixed(2)+"B"; if(n>=1e6) return "$"+(n/1e6).toFixed(2)+"M"; if(n>=1e3) return "$"+(n/1e3).toFixed(1)+"K"; return "$"+Math.round(n); },
  hold(s){ if(s<60) return s+"s"; const m=Math.floor(s/60), r=s%60; if(m<60) return m+"m "+r+"s"; return Math.floor(m/60)+"h "+(m%60)+"m"; },
  date(ts){ return new Date(ts).toLocaleDateString('en-US',{month:'short',day:'numeric'}) + " · " + new Date(ts).toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'}); }
};

function generateTradeCard(trade, allTrades){
  const wins = allTrades.filter(x=>x.pnl>0);
  const isFirstWin = trade.pnl>0 && wins.filter(x=>x.timestamp<=trade.timestamp).length===1;
  const bestPnlBefore = Math.max(0,...allTrades.filter(x=>x.timestamp<trade.timestamp).map(x=>x.pnl));
  const isPersonalBest = trade.pnl>bestPnlBefore;
  const sorted=[...allTrades].sort((a,b)=>a.timestamp-b.timestamp);
  let priorWinStreak=0, priorLossStreak=0;
  for(const t of sorted){ if(t.timestamp>=trade.timestamp) break; if(t.pnl>0){priorWinStreak++; priorLossStreak=0;} else {priorLossStreak++; priorWinStreak=0;} }
  const streak = trade.pnl>0 ? priorWinStreak+1 : 0;
  const lossStreak = trade.pnl<=0 ? priorLossStreak+1 : 0;
  const comeback = trade.pnl>0 && priorLossStreak>=2;
  const tradeNumber = sorted.filter(x=>x.timestamp<=trade.timestamp).length;
  const sameDay = allTrades.filter(x=>new Date(x.timestamp).toDateString()===new Date(trade.timestamp).toDateString());
  const isBestOfDay = trade.pnl===Math.max(...sameDay.map(x=>x.pnl));
  const isWorstOfDay = trade.pnl===Math.min(...sameDay.map(x=>x.pnl));
  const hour = new Date(trade.timestamp).getHours();
  const day = new Date(trade.timestamp).getDay();
  const walletTrades = sorted.filter(x=>x.source==='wallet');
  const isFirstWalletImport = trade.source==='wallet' && walletTrades.length && walletTrades.filter(x=>x.timestamp<=trade.timestamp).length===1;
  const ctx={isFirstWin,isPersonalBest,streak,lossStreak,comeback,isBestOfDay,isWorstOfDay,tradeNumber,hour,day,isFirstWalletImport};
  const rarity = computeRarity(trade, ctx);
  return { rarity, grade:computeGrade(trade,rarity), achievements:computeAchievements(trade,ctx), vibe:vibeFor(trade), color:pnlColor(trade) };
}
/* real price extract: market cap from 2 min before the first fill to 2 min after the last one.
   Points come from the server (GeckoTerminal minute candles); B / S markers sit on the curve at each fill. */
/* every chart goes through here, so cards, detail, CARD video and Trade Replay always draw the same clean candles:
   - one candle per interval on a regular grid (duplicates merged, empty slots = flat candle at the previous close)
   - absurd prices (a dust swap read as 1e10 x, a wick to ~0) pulled back to the local level; real moves are kept */
function cleanCandles(raw, iv, marks){
  const srt = [...raw].sort((a,b)=>a[0]-b[0]);
  if(srt.length) for(const m of (marks||[])){                       // a fill outside the candles (data started late / ended early):
    if(!(m[2] > 0)) continue;                                        // its exact market cap is a real price, so the chart reaches it
    if(m[0] < srt[0][0] - iv/2) srt.unshift([m[0], m[2], m[2], m[2], m[2]]);
    else if(m[0] >= srt[srt.length-1][0] + iv) srt.push([m[0], m[2], m[2], m[2], m[2]]);
  }
  const byT = new Map(), t0 = srt.length ? srt[0][0] : 0;
  for(const [ts,o,h,l,c] of srt){
    const k = t0 + Math.round((ts-t0)/iv)*iv, p = byT.get(k);
    byT.set(k, p ? [k, p[1], Math.max(p[2],h), Math.min(p[3],l), c] : [k,o,h,l,c]);
  }
  const keys = [...byT.keys()].sort((a,b)=>a-b);
  if(!keys.length) return [];
  const out = []; let prev = null;
  for(let k = keys[0]; k <= keys[keys.length-1] && out.length < 400; k += iv){
    const r = byT.get(k);
    if(r){ out.push(r.slice()); prev = r[4]; } else if(prev !== null) out.push([k, prev, prev, prev, prev, 1]);   // 6th field: filler
  }
  const pos = v => Number.isFinite(v) && v > 0;
  const lg = v => Math.log(v);
  const mids = out.map(x => pos(x[1]) && pos(x[4]) ? (lg(x[1])+lg(x[4]))/2 : pos(x[4]) ? lg(x[4]) : pos(x[1]) ? lg(x[1]) : NaN);
  const fills = (marks||[]).filter(m=>m[2]>0).map(m=>m[2]);
  const med = a => { const b = a.filter(Number.isFinite).sort((x,y)=>x-y); return b.length ? b[b.length>>1] : NaN; };
  const gmed = med(mids.concat(fills.map(lg)));
  const W = 5, BODY = Math.log(4);
  const ref = mids.map((_,i)=>{ const r = med(mids.slice(Math.max(0,i-W), i+W+1)); return Number.isFinite(r) ? r : gmed; });
  // bodies: a price more than 4x away from its neighbourhood is a bad read
  // ...unless the market really went there: the price chains with the next / previous candle (close = next open), or
  // the wallet's own fills (exact) sit at that level — a launch pump or a rug is real, it must stay on the chart
  const near = (u, v) => pos(u) && pos(v) && Math.abs(lg(u) - lg(v)) < 0.03;
  const fillAt = (i, v) => (marks||[]).some(m=>m[2] > 0 && m[0] >= out[i][0] - iv && m[0] < out[i][0] + 2*iv && Math.abs(lg(m[2]) - lg(v)) < Math.log(1.6));
  const isReal = (i, j) => { const v = out[i][j];
    return (j === 4 && out[i+1] && !out[i+1][5] && near(v, out[i+1][1])) || (j === 1 && out[i-1] && !out[i-1][5] && near(v, out[i-1][4])) || fillAt(i, v); };
  const keep = out.map((_,i)=>[1,4].map(j=>pos(out[i][j]) && isReal(i, j)));
  for(let i=0;i<out.length;i++){
    const r = Math.exp(ref[i]);
    [1,4].forEach((j,n)=>{ if(!pos(out[i][j]) || (!keep[i][n] && Math.abs(lg(out[i][j]) - ref[i]) > BODY)) out[i][j] = r; });
  }
  for(let i=1;i<out.length;i++) if(out[i][5]) out[i][1] = out[i][2] = out[i][3] = out[i][4] = out[i-1][4];  // fillers follow cleaned closes
  // wicks: never further than the nearby bodies allow (plus the user's own fills, which are exact)
  for(let i=0;i<out.length;i++){
    const x = out[i], bt = Math.max(x[1],x[4]), bb = Math.min(x[1],x[4]);
    let nt = bt, nb = bb;
    for(let j=Math.max(0,i-3); j<=Math.min(out.length-1,i+3); j++){ nt = Math.max(nt, out[j][1], out[j][4]); nb = Math.min(nb, out[j][1], out[j][4]); }
    const tsA = x[0], tsB = x[0]+iv;
    const fHere = (marks||[]).filter(m=>m[2]>0 && m[0]>=tsA && m[0]<tsB).map(m=>m[2]);
    const hiCap = Math.max(bt*1.5, nt*1.1, ...fHere), loCap = Math.min(bb/1.5, nb/1.1, ...fHere);
    x[2] = pos(x[2]) ? Math.min(Math.max(x[2], bt), hiCap) : bt;
    x[3] = pos(x[3]) ? Math.max(Math.min(x[3], bb), loCap) : bb;
    const near = fHere.filter(f=>f <= bt*1.15 && f >= bb/1.15);      // the wallet's own fill sits on its candle (a fill far off is
    if(near.length){ x[2] = Math.max(x[2], ...near); x[3] = Math.min(x[3], ...near); }   // its own slippage: not drawn as a market move)
  }
  // real price points (candles where swaps were read + the wallet's own fills): used when data is sparse
  const empty = x => x[5] || x[2] === x[3];                           // no swap read in this slot (gap, or a flat candle from the server)
  // each candle that saw swaps gives its 4 real prices in trading order (green: open, low, high, close / red: open, high, low, close)
  const real = out.filter(x=>!empty(x)).flatMap(x=>{ const up = x[4] >= x[1];
    return [[x[0], x[1]], [x[0] + iv*0.33, up ? x[3] : x[2]], [x[0] + iv*0.66, up ? x[2] : x[3]], [x[0] + iv*0.99, x[4]]]; }).concat((marks||[]).filter(m=>m[2]>0).map(m=>[m[0], m[2]])).sort((a,b)=>a[0]-b[0]);
  const res = out.map(x=>x.slice(0,5)); res.fillers = out.filter(empty).length; res.real = real;
  return res;
}
/* livelier charts: each real candle is split into a few sub-candles whose path goes from its real open to its real
   close through its real high and low (seeded, so cards, detail and videos are identical). Every real OHLC is kept
   exactly: no new high, no new low, same direction. Flat stretches (nobody traded) stay flat. */
function densify(cs, iv){
  const k = Math.max(1, Math.min(4, Math.round(80 / Math.max(1, cs.length))));
  if(k === 1) return { c: cs, i: iv };
  const out = [], sub = iv / k;
  for(const [ts,o,h,l,c] of cs){
    if(h === l){ for(let j=0;j<k;j++) out.push([ts + j*sub, o, h, l, c]); continue; }
    let seed = (Math.floor(ts/1000) * 2654435761) >>> 0;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    // path of k+1 points: open, ..., close; the real high and low are each hit once (low first on a green candle)
    const pts = [o]; for(let j=1;j<k;j++) pts.push(l + (h-l) * (0.2 + 0.6*rnd())); pts.push(c);
    const iH = 1 + Math.floor(rnd() * Math.max(1, k-1)), iL = k > 2 ? 1 + ((iH + Math.floor(rnd()*(k-2))) % (k-1)) : iH;
    const up = c >= o;
    if(k > 2 && iL !== iH){ pts[up ? Math.min(iL,iH) : Math.max(iL,iH)] = l; pts[up ? Math.max(iL,iH) : Math.min(iL,iH)] = h; }
    const hiAt = k > 2 && iL !== iH ? -1 : Math.floor(rnd()*k), loAt = k > 2 && iL !== iH ? -1 : (hiAt + 1 + Math.floor(rnd()*(k-1))) % k;
    for(let j=0;j<k;j++){
      const a = pts[j], b = pts[j+1], top = Math.max(a,b), bot = Math.min(a,b), span = (h-l) * 0.08;
      let hh = Math.min(h, top + span*rnd()), ll = Math.max(l, bot - span*rnd());
      if(j === hiAt) hh = h; if(j === loAt) ll = l;                 // k = 2: the real wicks land on a sub-candle
      out.push([ts + j*sub, a, hh, ll, b]);
    }
  }
  return { c: out, i: sub };
}
/* time per candle picked from the data: candles are merged 2, 3, 4… at a time (real OHLC: first open, highest high,
   lowest low, last close) until almost none is flat, keeping at least ~16 candles */
function regroup(cs, iv){
  const merge = g => { const out = []; for(let i=0;i<cs.length;i+=g){ const b = cs.slice(i, i+g);
    out.push([b[0][0], b[0][1], Math.max(...b.map(x=>x[2])), Math.min(...b.map(x=>x[3])), b[b.length-1][4]]); } return out; };
  const flat = a => a.filter(x=>x[2] === x[3]).length / Math.max(1, a.length);
  let best = { c: cs, i: iv, f: flat(cs) };
  for(const g of [2,3,4,5,6,8,10,12,15,20]){
    if(cs.length / g < 36) break;                                    // keep the detail: never fewer than ~36 candles
    const m = merge(g), f = flat(m);
    if(f < best.f - 0.02) best = { c: m, i: iv*g, f };
    if(f <= 0.2) break;
  }
  return best;
}
/* every chart, every coin: about as many candles as a lively one (~32), never a flat candle.
   Minutes where nobody traded are dropped, the rest merged into ~32 candles drawn side by side (quiet stretches don't
   take room), and B / S placed at their exact moment inside the candle they fall in. */
const EVEN_N = 56;                                               // detail: 56 candles; small cards merge them to 28
function evenCandles(ch){
  const src = ch.c, iv = ch.i;
  if(!src || src.length < 2) return ch;
  const H = Math.max(...src.map(x=>x[2])), L = Math.min(...src.map(x=>x[3])), R = H - L || 1;
  const flat = x => (x[2] - x[3]) / R < 0.012;                      // under ~1% of the chart's height: reads as a flat line
  let cs = src.filter(x=>!flat(x));
  if(cs.length < 2) cs = src.slice();
  if(cs.length > EVEN_N + 8){                                       // merge consecutive candles into ~32
    const out = [], k = cs.length / EVEN_N;
    for(let g = 0; g < EVEN_N; g++){
      const b = cs.slice(Math.round(g*k), Math.round((g+1)*k)); if(!b.length) continue;
      out.push([b[0][0], b[0][1], Math.max(...b.map(x=>x[2])), Math.min(...b.map(x=>x[3])), b[b.length-1][4], b[b.length-1][0] + iv]);
    }
    cs = out;
  } else cs = cs.map((x,j)=>[x[0], x[1], x[2], x[3], x[4], ch.fine && cs[j+1] ? cs[j+1][0] : x[0] + iv]);
  for(let j = 1; j < cs.length; j++){ cs[j][1] = cs[j-1][4]; cs[j][2] = Math.max(cs[j][2], cs[j][1]); cs[j][3] = Math.min(cs[j][3], cs[j][1]); }   // no gaps between candles
  const T = 1000, pos = ts => {                                      // real time -> slot on the even axis
    if(ts <= cs[0][0]) return 0;
    for(let j = 0; j < cs.length; j++){ const a = cs[j][0], b = cs[j][5];
      if(ts < b || j === cs.length-1 || ts < cs[j+1][0]) return (j + Math.min(1, Math.max(0, (ts - a) / Math.max(1, b - a)))) * T; }
    return cs.length * T;
  };
  return { ...ch, c: cs.map((x,j)=>[j*T, x[1], x[2], x[3], x[4]]), m: (ch.tick ? ch.m : (ch.m0 || ch.m)).map(x=>[pos(x[0]), x[1], x[2]]), w: [0, cs.length*T], i: T, iv0: T, even: true };
}
function parseChart(c){
  if(!c || typeof c!=='object') return null;
  const okN = v => Number.isFinite(v) && v >= 0 && v < 1e15;
  const m = Array.isArray(c.m) ? c.m.filter(x=>Array.isArray(x) && okN(+x[0]) && (x[1]==='b'||x[1]==='s')).map(x=>[+x[0], x[1], okN(+x[2]) ? +x[2] : 0]).slice(0,20) : [];
  const w = Array.isArray(c.w) && okN(+c.w[0]) && okN(+c.w[1]) && +c.w[1] > +c.w[0] ? [+c.w[0], +c.w[1]] : null;
  if(c.v === 2){
    const cs = Array.isArray(c.c) ? c.c.filter(x=>Array.isArray(x) && x.length>=5 && x.slice(0,5).every(v=>okN(+v))).map(x=>x.slice(0,5).map(Number)).slice(0,400) : [];
    const iv0 = okN(+c.i) && +c.i>0 ? +c.i : 60000;
    if(c.fine && cs.length >= 2){                                    // candles of real consecutive swaps: drawn as they are
      const fc = cs.slice().sort((a,b)=>a[0]-b[0]);
      return evenCandles({ v:2, c:fc, m, m0:m, w, iv0, i: iv0, src: c.src==='pump' ? 'pump' : 'chain', q: 2, fine: true, coarse: false, redo: !!c.redo, n: fc.length });
    }
    if(c.src === 'gt' && cs.length && m.some(x=>x[2] > 0)){             // GeckoTerminal prices in its own supply (fdv/price): when every fill
      const r = m.filter(x=>x[2] > 0).map(x=>{ const k = cs.find(y=>x[0] < y[0] + iv0) || cs[cs.length-1]; return x[2] / ((k[2]+k[3])/2); }).sort((p,q)=>p-q);
      const med = r[r.length>>1];                                      // sits off the candles the same way, rescale them to the on-chain market cap
      if(r.every(v=>v < 0.77) || r.every(v=>v > 1.3)) cs.forEach(y=>{ for(let j=1;j<5;j++) y[j] *= med; });
    }
    const cl = cleanCandles(cs, iv0, m), dn = regroup(cl, iv0);
    // the candles miss the wallet's own fills (data started late / wrong pool) or are mostly empty: drawn as a price line through
    // the real points (swaps read + exact fills) instead of a flat row of candles
    const hi = Math.max(...cs.map(x=>x[2])), lo = Math.min(...cs.map(x=>x[3]));
    const miss = m.some(x=>x[2] > 0 && (x[2] > hi*1.3 || x[2] < lo/1.3));
    const sparse = cl.length > 0 && cl.real.length >= 2 && (miss || (cl.length > 6 && cl.fillers / cl.length > 0.35));
    if(sparse){                                                       // tick candles: one candle per move between two consecutive REAL
      const p = cl.real.filter((q,i,arr)=>!i || Math.abs(q[1] - arr[i-1][1]) > q[1]*0.002), T = 1000;   // prices, evenly spaced (no
      if(p.length >= 2){                                               // gap, no flat stretch); fills mapped onto the same axis
        const tc = p.slice(1).map((q,i)=>[i*T, p[i][1], Math.max(p[i][1], q[1]), Math.min(p[i][1], q[1]), q[1]]);
        const map = ts => { if(ts <= p[0][0]) return 0; for(let k=1;k<p.length;k++) if(ts <= p[k][0]){ const a = p[k-1][0], b = p[k][0]; return ((k-1) + (b>a ? (ts-a)/(b-a) : 1)) * T; } return (p.length-1)*T; };
        const tm = m.map(x=>[map(x[0]), x[1], x[2]]), td = { c: tc, i: T };
        return evenCandles({ v:2, c:td.c, m:tm, m0:m, w:[0, (p.length-1)*T], iv0:T, i:td.i, sparse:true, tick:true, src: c.src==='pump' ? 'pump' : c.src==='chain' ? 'chain' : 'gt', q: c.q === 3 ? 3 : c.q === 2 ? 2 : c.q === 1 ? 1 : 0, coarse: !!c.coarse, fine: !!c.fine, redo: !!c.redo, n: tc.length });
      }
    }
    return cl.length ? evenCandles({ v:2, c:dn.c, m, m0:m, w, iv0, i: dn.i, sparse, pts: cl.real, src: c.src==='pump' ? 'pump' : c.src==='chain' ? 'chain' : 'gt', q: c.q === 3 ? 3 : c.q === 2 ? 2 : c.q === 1 ? 1 : 0, coarse: !!c.coarse, fine: !!c.fine, redo: !!c.redo, n: cl.length }) : null;
  }
  const p = Array.isArray(c.p) ? c.p.filter(x=>Array.isArray(x) && okN(+x[0]) && okN(+x[1])).map(x=>[+x[0], +x[1]]).slice(0,400) : [];
  return (p.length || m.length) ? { p, m, w } : null;
}
const fmtMcShort = v => v>=1e9 ? (v/1e9).toFixed(1)+'B' : v>=1e6 ? (v/1e6).toFixed(1)+'M' : v>=1e3 ? (v/1e3).toFixed(1)+'K' : String(Math.round(v));
/* B / S pinned at the top of the chart, a dashed drop line down to the exact fill point on the candles */
const CH_TOP = 24;   // % of the chart height reserved for the markers
function markersHtml(marks, X, Y, big){
  const pos = marks.map(([mt,kind,v])=>({ kind, x: Math.min(100,Math.max(0,X(mt))), y: Math.min(100,Math.max(0,Y(v))) })).sort((p,q)=>p.x-q.x);
  const W = big ? 330 : 140, H = big ? 170 : 66, mkPx = big ? 20 : 16;  // typical chart size on a phone, in px
  const pct = px => px / W * 100;
  // fills of the same side close together in time: one marker with a count (S x9), one round, one straight drop line
  const gap = pct(mkPx * 1.6);
  const groups = [];
  pos.forEach(m=>{ const g = groups[groups.length-1];
    if(g && g.kind === m.kind && m.x - g.items[g.items.length-1].x < gap) g.items.push(m); else groups.push({ kind: m.kind, items: [m] }); });
  groups.forEach(g=>{ g.n = g.items.length;
    const best = g.kind === 's' ? g.items.reduce((a,m)=>m.y < a.y ? m : a) : g.items.reduce((a,m)=>m.y > a.y ? m : a);   // best fill of the group
    g.x = best.x; g.y = best.y; g.best = best; g.w = pct(g.n > 1 ? mkPx + 22 : mkPx) + pct(4); });
  // top labels on ONE row: overlapping labels form a block centred on their real times (smallest total shift, both
  // directions), blocks kept inside the chart; the drop line leans a little instead of a label jumping to a 2nd row
  const pad = pct(3), blocks = [];
  const layout = bl => { let off = 0; const o = bl.items.map(g=>{ const v = off + g.w/2; off += g.w + pad; return v; }); bl.tw = off - pad;
    bl.s = bl.items.reduce((a,g,i)=>a + g.x - o[i], 0) / bl.items.length; bl.s = Math.min(100 - bl.tw, Math.max(0, bl.s)); bl.o = o; };
  groups.forEach(g=>{ g.row = 0; let bl = { items:[g] }; layout(bl);
    while(blocks.length){ const p = blocks[blocks.length-1]; if(p.s + p.tw + pad <= bl.s) break; blocks.pop(); bl = { items: p.items.concat(bl.items) }; layout(bl); }
    blocks.push(bl); });
  blocks.forEach(bl => bl.items.forEach((g,i)=>{ g.mx = bl.s + bl.o[i]; }));
  const rowTop = r => r * (mkPx + 3);                                 // px from the top
  const col = k => k==='b' ? '#18c964' : '#ff3b4e';
  // a group's fills joined in time order by a thin line: reads as one position built in several fills
  const brackets = groups.filter(g=>g.n > 1).map(g=>`<polyline points="${g.items.map(m=>m.x.toFixed(2)+','+m.y.toFixed(2)).join(' ')}" fill="none" stroke="${col(g.kind)}" stroke-opacity=".55" stroke-width="1.5" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>`).join('');
  const lines = groups.map(g=>{ const y0 = (rowTop(g.row) + mkPx) / H * 100;
    return `<line x1="${g.mx.toFixed(2)}" y1="${y0.toFixed(2)}" x2="${g.x.toFixed(2)}" y2="${g.y.toFixed(2)}" stroke="${col(g.kind)}" stroke-width="1.5" stroke-dasharray="3 3" vector-effect="non-scaling-stroke"/>`; }).join('');
  return `<svg class="mk-lines" viewBox="0 0 100 100" preserveAspectRatio="none">${brackets}${lines}</svg>` +
    groups.flatMap(g=>g.items.filter(m=>m !== g.best)).map(m=>`<span class="mk-anchor mk-${m.kind}" style="left:${m.x.toFixed(2)}%;top:${m.y.toFixed(2)}%" aria-hidden="true"></span>`).join('') +
    groups.map(g=>`<span class="mk-dot mk-${g.kind}" style="left:${g.x.toFixed(2)}%;top:${g.y.toFixed(2)}%" aria-hidden="true"></span>`).join('') +
    groups.map(g=>`<span class="mk mk-top mk-${g.kind}${g.n>1?' mk-n':''}" style="left:${g.mx.toFixed(2)}%;top:${rowTop(g.row)}px">${g.kind==='b'?'B':'S'}${g.n>1?`<small>\u00d7${g.n}</small>`:''}</span>`).join('');
}
/* real candles: market cap, first fill - 2 min to last fill + 2 min (clipped to the coin's first trade).
   pump.fun coins: second-level candles + exact fills; others: minute candles. */
function mergeCandles(cs, iv, max){
  if(cs.length <= max) return [cs, iv];
  const k = Math.ceil(cs.length / max), out = [];
  for(let i = 0; i < cs.length; i += k){
    const g = cs.slice(i, i+k);
    out.push([g[0][0], g[0][1], Math.max(...g.map(c=>c[2])), Math.min(...g.map(c=>c[3])), g[g.length-1][4]]);
  }
  return [out, iv*k];
}
/* entry -> exit band over the hold (first BUY to last SELL): fill + dashed entry / exit levels;
   big chart: price tags on the right edge, the ROI in the band, and the peak reached while holding when it was well above the exit */
function tradeZone(t, cs, iv, marks, X, Y, big){
  const bs = marks.filter(m=>m[1]==='b'), ss = marks.filter(m=>m[1]==='s');
  if(!bs.length || !ss.length) return { svg:'', html:'' };
  const tb = Math.min(...bs.map(m=>m[0])), te = Math.max(...ss.map(m=>m[0]));
  const en = t.entryMc > 0 ? t.entryMc : bs[0][2], ex = t.exitMc > 0 ? t.exitMc : ss[ss.length-1][2];
  if(!(en > 0) || !(ex > 0) || te <= tb) return { svg:'', html:'' };
  const win = ex >= en, col = win ? '#18c964' : '#ff3b4e';
  const clampP = v => Math.min(100, Math.max(0, v));
  const xb = clampP(X(tb)), xe = clampP(X(te)), ye = clampP(Y(en)), yx = clampP(Y(ex)), y0 = Math.min(ye, yx), h = Math.max(0.6, Math.abs(ye - yx));
  const lv = (y, op) => `<line x1="${xb.toFixed(2)}" x2="${xe.toFixed(2)}" y1="${y.toFixed(2)}" y2="${y.toFixed(2)}" stroke="${col}" stroke-opacity="${op}" stroke-width="1" stroke-dasharray="4 3" vector-effect="non-scaling-stroke"/>`;
  const svg = `<rect x="${xb.toFixed(2)}" y="${y0.toFixed(2)}" width="${(xe-xb).toFixed(2)}" height="${h.toFixed(2)}" fill="${col}" fill-opacity="${big ? .13 : .1}"/>` + lv(ye, .55) + lv(yx, .9);
  return { svg, html:'' };                                         // no text on the chart: the figures are right above it
}
/* window of a small card chart: the whole context is kept; only the extra on the longer side is trimmed so the trade
   stays near the middle: each side keeps at least the shorter side's context and at least the hold's own length. */
function centredWindow(ch){
  const bs = ch.m.filter(m=>m[1]==='b').map(m=>m[0]), ss = ch.m.filter(m=>m[1]==='s').map(m=>m[0]);
  if(!bs.length || !ss.length || !ch.c.length) return null;
  const tb = Math.min(...bs), te = Math.max(...ss); if(te < tb) return null;
  const d0 = ch.c[0][0], d1 = ch.c[ch.c.length-1][0] + ch.i;
  const L = tb - d0, R = d1 - te, keep = Math.max(te - tb, ch.i * 6);
  const pl = Math.min(L, Math.max(R, keep)), pr = Math.min(R, Math.max(L, keep));
  return (pl < L || pr < R) ? [tb - pl, te + pr] : null;
}
function miniChart(t, big){
  const h = big ? 170 : 66;
  const ch = t.chart;
  if(ch && ch.v === 2 && !pendingFine(t)){
    const win = big ? null : centredWindow(ch);                        // small cards: BUY and SELL framed around the middle
    const raw = win ? ch.c.filter(c => c[0] + ch.i > win[0] && c[0] < win[1]) : ch.c;
    const [cs, iv] = mergeCandles(raw.length >= 4 ? raw : ch.c, ch.i, big ? 140 : 48);
    let x0 = Math.min(ch.w ? ch.w[0] : Infinity, cs[0][0]), x1 = Math.max(ch.w ? ch.w[1] : 0, cs[cs.length-1][0] + iv);
    if(win && raw.length >= 4){ x0 = Math.max(win[0], cs[0][0]); x1 = Math.min(win[1], cs[cs.length-1][0] + iv); }
    if(x1 <= x0) x1 = x0 + iv;
    const ys =  [...cs.flatMap(c=>[c[2],c[3]]), ...ch.m.map(m=>m[2]).filter(v=>v>0)];
    let y0 = Math.min(...ys), y1 = Math.max(...ys);
    if(y1 - y0 < 1e-9){ y0 *= 0.95; y1 = y1*1.05 + 1; }
    const pad = (y1-y0)*0.14; y0 -= pad; y1 += pad;
    const X = v => ((v-x0)/(x1-x0))*100, Y = v => CH_TOP + (1-(v-y0)/(y1-y0))*(100-CH_TOP);
    const bw = Math.max(0.5, (iv/(x1-x0))*100*0.9);                   // candles side by side, like a trading chart
    const minB = big ? 2.6 : 4;                                       // a candle always reads as a candle, never as a flat line
    const body = cs.map(([ts,o,hi,lo,c])=>{
      const up = c >= o, col = up ? '#18c964' : '#ff3b4e', cx = X(ts + iv/2);
      const top = Y(Math.max(o,c)), bot = Y(Math.min(o,c));
      return `<line x1="${cx.toFixed(2)}" x2="${cx.toFixed(2)}" y1="${Y(hi).toFixed(2)}" y2="${Y(lo).toFixed(2)}" stroke="${col}" stroke-width="1" vector-effect="non-scaling-stroke"/>`+
             `<rect x="${(cx-bw/2).toFixed(2)}" y="${(Math.min(top, (top+bot)/2 - minB/2)).toFixed(2)}" width="${bw.toFixed(2)}" height="${Math.max(minB, bot-top).toFixed(2)}" fill="${col}"/>`;
    }).join('');
    const at = ts => { const c = cs.find(c=>ts < c[0]+iv) || cs[cs.length-1]; return (c[2]+c[3])/2; };
    const marks = ch.m.map(m=>[m[0], m[1], m[2] > 0 ? m[2] : at(m[0])]);   // the wallet's own fill: exact market cap
    // the trade itself: a band from entry to exit level over the hold, so a x2 reads as a x2 even when a wick squashes the scale
    const zone = tradeZone(t, cs, iv, marks, X, Y, big);
    const labels = big ? `<span class="ch-lbl top" style="top:${CH_TOP}%">${fmtMcShort(y1-pad)}</span><span class="ch-lbl bot">${fmtMcShort(Math.max(0,y0+pad))}</span>` : '';
    // modern look: faint grid, a glowing area under the price, last-price line
    const up = cs[cs.length-1][4] >= cs[0][1], tone = up ? '#18c964' : '#ff3b4e', gid = 'g' + Math.random().toString(36).slice(2,8);
    const lp = cs.map(c=>[c[0]+iv/2, c[4]]);
    const line = lp.map(p=>`${X(p[0]).toFixed(2)},${Y(p[1]).toFixed(2)}`).join(' ');
    const area = `<polygon points="${X(lp[0][0]).toFixed(2)},100 ${line} ${X(lp[lp.length-1][0]).toFixed(2)},100" fill="url(#${gid})"/>`;
    const grid = [0.25,0.5,0.75].map(f=>{ const y = (CH_TOP + f*(100-CH_TOP)).toFixed(2); return `<line x1="0" x2="100" y1="${y}" y2="${y}" stroke="rgba(255,255,255,.05)" stroke-width="1" vector-effect="non-scaling-stroke"/>`; }).join('');
    const lastY = Y(lp[lp.length-1][1]).toFixed(2);
    const deco = `<defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${tone}" stop-opacity=".22"/><stop offset="1" stop-color="${tone}" stop-opacity="0"/></linearGradient></defs>${grid}${area}${zone.svg}
      <polyline points="${line}" fill="none" stroke="${tone}" stroke-opacity=".35" stroke-width="1" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
      <line x1="0" x2="100" y1="${lastY}" y2="${lastY}" stroke="${tone}" stroke-opacity=".45" stroke-width="1" stroke-dasharray="2 3" vector-effect="non-scaling-stroke"/>`;
    return `<div class="chartbox modern ${big?'big':''}" style="height:${h}px">
      <svg class="cs" viewBox="0 0 100 100" preserveAspectRatio="none">${deco}${body}</svg>${markersHtml(marks, X, Y, big)}${labels}${zone.html}</div>`;
  }
  if(t.mint && chartState(t) === 'loading'){                        // loading: animated skeleton candles, not a fake line
    const n = big ? 26 : 16, bars = Array.from({length:n}, (_,i)=>{ const h = 18 + 30*Math.abs(Math.sin(i*1.7 + t.tradeId)); return `<i style="height:${h.toFixed(0)}%;animation-delay:${(i*60)}ms"></i>`; }).join('');
    return `<div class="chartbox skel ${big?'big':''}" style="height:${h}px" aria-label="Loading chart">${bars}</div>`;
  }
  // no candles (manual trade / no market data): dashed entry -> exit
  const end = t.timestamp, start = end - (t.holdTime||0)*1000;
  const p = [[start, t.entryMc||0], [end, t.exitMc||0]];
  let x0 = start, x1 = end; const padX = Math.max(1000,(x1-x0)*0.12); x0 -= padX; x1 += padX;
  let y0 = Math.min(p[0][1],p[1][1]), y1 = Math.max(p[0][1],p[1][1]);
  if(y1 - y0 < 1e-9){ y0 = y0*0.9 - 1; y1 = y1*1.1 + 1; }
  const pad = (y1-y0)*0.25; y0 -= pad; y1 += pad;
  const X = v => ((v-x0)/(x1-x0))*100, Y = v => CH_TOP + (1-(v-y0)/(y1-y0))*(100-CH_TOP);
  const c = t.pnl>=0 ? 'var(--green)' : 'var(--red)';
  return `<div class="chartbox ${big?'big':''}" style="height:${h}px">
    <svg viewBox="0 0 100 100" preserveAspectRatio="none"><path d="M${X(p[0][0]).toFixed(2)},${Y(p[0][1]).toFixed(2)} L${X(p[1][0]).toFixed(2)},${Y(p[1][1]).toFixed(2)}" fill="none" stroke="${c}" stroke-width="2" vector-effect="non-scaling-stroke" stroke-dasharray="4 4" opacity=".5"/></svg>
    ${markersHtml([[start,'b',p[0][1]],[end,'s',p[1][1]]], X, Y, big)}</div>`;
}

function computedTrades(){ return trades.map(t=>({...t, meta: generateTradeCard(t, trades)})); }

function renderCardHTML(t, meta){
  const win = t.pnl>=0;
  const badges = meta.achievements.slice(0,3).map(a=>`<span>${icon(a.icon,13,'var(--tx)')} ${a.name}</span>`).join(' ');
  return `
    <div class="top">
      <div class="top-left"><span>#${String(t.tradeId).padStart(4,'0')}</span>${t.source && t.source!=='manual' ? `<span class="src">${esc(t.source)}</span>` : ''}</div>
      <div class="top-right"><span class="rarity-tag">${meta.rarity}</span><div class="grade">${meta.grade}</div></div>
    </div>
    <div class="card-coin">${coinImg(t, 46)}</div>
    <div class="ticker">${esc(tk(t.ticker))}</div>
    <div class="pnl ${win?'pos':'neg'}">${fmt.usd(t.pnl)}</div>
    <div class="roi ${win?'pos':'neg'}">${fmt.pct(t.roi)}</div>
    <div class="mini">${miniChart(t)}</div>
    ${meta.achievements.length? `<div class="badge">${badges}</div>`:''}
    <div class="bottom"><span>${fmt.hold(t.holdTime)}</span><span>${icon(meta.vibe.icon,13,'var(--tx)')} ${meta.vibe.label}</span></div>
  `;
}
function cardStyle(meta){ return `--glow:${meta.color.glow}; border-color:${meta.color.border};`; }

const GRID_STEP = 24;
let gridLimit = GRID_STEP, gridList = [];
const cardHTML = t => `<div class="card" data-r="${t.meta.rarity}" data-id="${t.id}" style="${cardStyle(t.meta)}">${renderCardHTML(t,t.meta)}</div>`;
function bindCards(root){ root.querySelectorAll('.card:not([data-b])').forEach(el=>{ el.dataset.b = 1; el.addEventListener('click',()=>openDetail(el.dataset.id)); if(chartObserver) chartObserver.observe(el); }); }
const gridMore = 'IntersectionObserver' in window ? new IntersectionObserver(es=>{ if(es.some(e=>e.isIntersecting)) growGrid(); }, { rootMargin:'900px 0px' }) : null;
function growGrid(){
  const grid = document.getElementById('grid'), more = document.getElementById('gridMore');
  if(!more || gridLimit >= gridList.length) return;
  const next = gridList.slice(gridLimit, gridLimit + GRID_STEP); gridLimit += next.length;
  more.insertAdjacentHTML('beforebegin', next.map(cardHTML).join(''));
  bindCards(grid);
  if(gridLimit >= gridList.length){ gridMore?.unobserve(more); more.remove(); }
}
function renderGrid(reset){
  if(reset) gridLimit = GRID_STEP;
  const all = computedTrades();
  let filtered = all;
  if(activeFilter==="win") filtered=all.filter(t=>t.pnl>=0);
  else if(activeFilter==="loss") filtered=all.filter(t=>t.pnl<0);
  else if(["rare","epic","legendary"].includes(activeFilter)) filtered=all.filter(t=>t.meta.rarity===activeFilter);

  filtered = [...filtered].sort((a,b)=>{
    if(sortMode==="newest") return b.timestamp-a.timestamp;
    if(sortMode==="oldest") return a.timestamp-b.timestamp;
    if(sortMode==="roi") return b.roi-a.roi;
    if(sortMode==="pnl") return b.pnl-a.pnl;
  });

  const grid = document.getElementById('grid');
  document.getElementById('countLabel').textContent = all.length;
  if(filtered.length===0){
    const msgs = {all:"YOUR COLLECTION IS EMPTY.", win:"No wins yet.", loss:"No losses. Clean sheet.", rare:"No rare cards yet.", epic:"No epic trades yet.", legendary:"No legendary cards yet."};
    grid.innerHTML = `<div class="empty"><b>${msgs[activeFilter]||"Nothing here."}</b>Make your first trade card.<br><button id="emptyCreate">CREATE YOUR FIRST CARD</button></div>`;
    document.getElementById('emptyCreate')?.addEventListener('click', openNewModal);
    return;
  }
  gridList = filtered; gridLimit = Math.min(Math.max(gridLimit, GRID_STEP), filtered.length);
  grid.innerHTML = filtered.slice(0, gridLimit).map(cardHTML).join('') + (gridLimit < filtered.length ? '<div id="gridMore" class="grid-more" aria-hidden="true"></div>' : '');
  bindCards(grid);
  const more = document.getElementById('gridMore');
  if(more){ if(gridMore) gridMore.observe(more); else { gridLimit = filtered.length; renderGrid(); } }
}

function renderStatsRow(){
  const wins = trades.filter(t=>t.pnl>=0);
  const totalPnl = trades.reduce((s,t)=>s+t.pnl,0);
  const winRate = trades.length? Math.round(wins.length/trades.length*100):0;
  const best = trades.length? Math.max(...trades.map(t=>t.roi)) : 0;
  const rows = [
    {l:"TOTAL P&L", v:trades.length?fmt.usd(totalPnl):"—", cls:totalPnl>=0?'pos':'neg'},
    {l:"TRADES", v:trades.length, cls:''},
    {l:"WIN RATE", v:trades.length? winRate+"%":"—", cls:''},
    {l:"BEST TRADE", v:trades.length? fmt.pct(best):"—", cls:'pos'},
    {l:"CARDS", v:trades.length, cls:''},
  ];
  document.getElementById('statsRow').innerHTML = rows.map(r=>`<div class="stat"><div class="l">${r.l}</div><div class="v ${r.cls}">${r.v}</div></div>`).join('');
}
/* ---------- levels ----------
   XP rewards quality and consistency, not spam:
   - base per trade (on-chain imports are worth more than manual entries), max 25 trades/day counted
   - grade + rarity bonus, unique achievements (once each), trading days, best win streak, trade-count milestones
   Curve: XP for LVL n -> n+1 = 100 * n^1.6 (lvl 10 ~ 13k XP total, lvl 20 ~ 87k, lvl 50 ~ 1M, cap 100). */
const LVL_MAX = 100;
const LVL_TITLES = [
  [1,'PAPER HANDS'],[3,'FRESH APE'],[6,'DEGEN'],[10,'CHART READER'],[15,'SNIPER'],[20,'BAG HUNTER'],
  [30,'WHALE WATCHER'],[40,'MARKET MAKER'],[50,'ALPHA'],[65,'LEGEND'],[80,'MYTHIC'],[100,'GOAT'],
];
const XP_GRADE = { S:40, A:25, B:12, C:5, D:1 };
const XP_RARITY = { legendary:60, mythic:150 };
const XP_MILESTONES = [[10,100],[50,300],[100,600],[250,1200],[500,2500],[1000,5000]];
const xpForNext = n => Math.round(100 * Math.pow(n, 1.6));
function levelTitle(l){ let t = LVL_TITLES[0][1]; for(const [min,name] of LVL_TITLES) if(l>=min) t = name; return t; }
function nextTitle(l){ return LVL_TITLES.find(([min])=>min>l) || null; }
function unlockedAchievementKeys(){
  const set = new Set();
  computedTrades().forEach(t=>t.meta.achievements.forEach(a=>set.add(a.key)));
  ["goal_first_milestone","goal_crusher","goal_smasher","goal_legend"].forEach(k=>{ try{ if(localStorage.getItem(goalFlagKey(k))==='1') set.add(k); }catch(e){} });
  return set;
}
function computeXP(){
  const all = computedTrades().slice().sort((a,b)=>a.timestamp-b.timestamp);
  const perDay = {}; let trades_ = 0, quality = 0;
  const days = new Set();
  let streak = 0, best = 0;
  for(const t of all){
    const day = new Date(t.timestamp).toISOString().slice(0,10);
    days.add(day);
    perDay[day] = (perDay[day]||0) + 1;
    if(perDay[day] <= 25){
      trades_ += t.source==='wallet' ? 15 : 6;
      quality += (XP_GRADE[t.meta.grade]||0) + (XP_RARITY[t.meta.rarity]||0);
    }
    if(t.pnl > 0){ streak++; best = Math.max(best, streak); } else streak = 0;
  }
  const ach = unlockedAchievementKeys().size * 120;
  const activity = days.size * 8;
  const streakXp = best * 10;
  const milestones = XP_MILESTONES.filter(([n])=>all.length>=n).reduce((s,[,x])=>s+x,0);
  const total = trades_ + quality + ach + activity + streakXp + milestones;
  return { total, parts:[
    ['Trades logged', trades_], ['Grades & rarity', quality], ['Achievements', ach],
    ['Trading days', activity], ['Best win streak', streakXp], ['Milestones', milestones],
  ]};
}
function levelFromXP(xp){
  let lvl = 1, left = xp;
  while(lvl < LVL_MAX && left >= xpForNext(lvl)){ left -= xpForNext(lvl); lvl++; }
  return { lvl, cur: left, need: lvl>=LVL_MAX ? 0 : xpForNext(lvl) };
}
function renderLevel(){
  const { total, parts } = computeXP();
  const { lvl, cur, need } = levelFromXP(total);
  const title = levelTitle(lvl), nt = nextTitle(lvl);
  const pct = need ? Math.min(100, cur/need*100) : 100;
  document.getElementById('lvlLabel').textContent = "LVL "+lvl;
  document.getElementById('lvlTitle').textContent = title;
  document.getElementById('chipLvl').textContent = lvl;
  document.getElementById('xpFill').style.width = pct.toFixed(1)+"%";
  document.getElementById('xpLabel').textContent = need ? `${cur.toLocaleString('en-US')} / ${need.toLocaleString('en-US')} XP` : 'MAX LEVEL';
  document.getElementById('lvlDetail').innerHTML = `
    <div class="lvl-rows">${parts.map(([l,v])=>`<div><span>${l}</span><b>+${v.toLocaleString('en-US')}</b></div>`).join('')}
      <div class="lvl-total"><span>Total</span><b>${total.toLocaleString('en-US')} XP</b></div></div>
    <div class="lvl-hint">${nt ? `Next title: <b>${nt[1]}</b> at LVL ${nt[0]}` : 'Top title reached.'}
      <br>On-chain imports earn more XP than manual entries. Only 25 trades per day count.</div>`;
  // level-up toast (per account)
  try{
    const k = 'dc_lvl_'+(session?.user?.id||'anon'), prev = Number(localStorage.getItem(k)||0);
    if(prev && lvl > prev) showToast(`LEVEL UP — LVL ${lvl} · ${title}`);
    if(lvl !== prev) localStorage.setItem(k, String(lvl));
  }catch(e){}
}
/* ---------- achievements screen: summary + categories + medal tiles (responsive: 2 cols phone -> 4-5 cols iPad) ---------- */
const ACH_GROUPS = [
  { id:'milestones', name:'Milestones', keys:['first_trade','ten_trades','fifty_trades','century_club','on_chain'] },
  { id:'profit',     name:'Profit',     keys:['first_blood','micro_win','moonshot','to_the_moon','whale','new_record'] },
  { id:'streaks',    name:'Streaks',    keys:['run_it_back','on_fire','unstoppable','comeback_kid','iron_stomach'] },
  { id:'style',      name:'Style',      keys:['speedrun','paper_hands','diamond_hands','night_owl','weekend_warrior'] },
  { id:'daily',      name:'Daily',      keys:['king_of_day','worst_of_day'] },
  { id:'pain',       name:'Pain',       keys:['rugged','rekt'] },
  { id:'goals',      name:'Goals',      keys:['goal_first_milestone','goal_crusher','goal_smasher','goal_legend'] },
];
const ACH_TIER = { first_trade:'bronze', ten_trades:'bronze', fifty_trades:'silver', century_club:'gold', on_chain:'silver',
  first_blood:'bronze', micro_win:'bronze', moonshot:'silver', to_the_moon:'gold', whale:'legend', new_record:'silver',
  run_it_back:'bronze', on_fire:'silver', unstoppable:'legend', comeback_kid:'silver', iron_stomach:'bronze',
  speedrun:'silver', paper_hands:'bronze', diamond_hands:'gold', night_owl:'bronze', weekend_warrior:'bronze',
  king_of_day:'silver', worst_of_day:'bronze', rugged:'bronze', rekt:'silver',
  goal_first_milestone:'bronze', goal_crusher:'silver', goal_smasher:'gold', goal_legend:'legend' };
const TIER_LABEL = { bronze:'BRONZE', silver:'SILVER', gold:'GOLD', legend:'LEGEND' };
let achFilter = 'all';
function achProgress(key, all){
  // [current, target, label] for locked achievements when it can be measured
  const byTime = [...all].sort((a,b)=>a.timestamp-b.timestamp);
  let ws=0, bw=0, ls=0, bl=0; byTime.forEach(t=>{ if(t.pnl>0){ ws++; bw=Math.max(bw,ws); ls=0; } else { ls++; bl=Math.max(bl,ls); ws=0; } });
  const bestRoi = all.length ? Math.max(...all.map(t=>t.roi)) : 0, bestPnl = all.length ? Math.max(...all.map(t=>t.pnl)) : 0;
  const worstRoi = all.length ? Math.min(...all.map(t=>t.roi)) : 0;
  const longWin = Math.max(0, ...all.filter(t=>t.pnl>0).map(t=>t.holdTime));
  const n = all.length;
  switch(key){
    case 'first_trade': return [n, 1, `${n}/1 trade`];
    case 'ten_trades': return [n, 10, `${n}/10 trades`];
    case 'fifty_trades': return [n, 50, `${n}/50 trades`];
    case 'century_club': return [n, 100, `${n}/100 trades`];
    case 'run_it_back': return [bw, 3, `Best streak ${bw}/3`];
    case 'on_fire': return [bw, 5, `Best streak ${bw}/5`];
    case 'unstoppable': return [bw, 10, `Best streak ${bw}/10`];
    case 'iron_stomach': return [bl, 3, `Worst streak ${bl}/3`];
    case 'moonshot': return [Math.max(0,bestRoi), 100, `Best ROI ${fmt.pct(bestRoi)} / +100%`];
    case 'to_the_moon': return [Math.max(0,bestRoi), 500, `Best ROI ${fmt.pct(bestRoi)} / +500%`];
    case 'whale': return [Math.max(0,bestPnl), 500, `Best trade ${fmt.usd(bestPnl)} / $500`];
    case 'diamond_hands': return [longWin, 86400, `Longest win ${fmt.hold(longWin)} / 24h`];
    case 'rugged': return [Math.max(0,-worstRoi), 50, `Worst ${fmt.pct(worstRoi)} / -50%`];
    case 'rekt': return [Math.max(0,-worstRoi), 80, `Worst ${fmt.pct(worstRoi)} / -80%`];
    default: return null;
  }
}
function renderAchievements(){
  const all = computedTrades();
  const unlocked = unlockedAchievementKeys();
  const earned = {};                                           // key -> trades that earned it (newest first)
  all.forEach(t=>t.meta.achievements.forEach(a=>{ (earned[a.key] = earned[a.key] || []).push(t); }));
  Object.values(earned).forEach(l=>l.sort((a,b)=>b.timestamp-a.timestamp));
  const total = ACH_CATALOG.length, got = unlocked.size, pct = total ? Math.round(got/total*100) : 0;
  document.getElementById('achCount').textContent = got;
  document.getElementById('achTotal').textContent = total;

  // summary
  const tierCount = { bronze:0, silver:0, gold:0, legend:0 };
  unlocked.forEach(k=>{ const tr = ACH_TIER[k]; if(tr) tierCount[tr]++; });
  const rarest = [...unlocked].map(k=>ACH_MAP[k]).filter(Boolean).sort((a,b)=>(earned[a.key]?.length||1)-(earned[b.key]?.length||1))[0];
  const latest = Object.entries(earned).map(([k,l])=>[k,l[0].timestamp]).sort((a,b)=>b[1]-a[1])[0];
  const C = 2*Math.PI*52;
  document.getElementById('achSummary').innerHTML = `
    <div class="ach-ring">
      <svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="52" class="ring-bg"/><circle cx="60" cy="60" r="52" class="ring-fg" style="stroke-dasharray:${C.toFixed(1)};stroke-dashoffset:${(C*(1-got/Math.max(1,total))).toFixed(1)}"/></svg>
      <div class="ach-ring-txt"><b>${pct}%</b><span>${got} / ${total}</span></div>
    </div>
    <div class="ach-sum-body">
      <div class="ach-tiers">${Object.keys(tierCount).map(tr=>`<div class="ach-tier t-${tr}"><i></i><b>${tierCount[tr]}</b><span>${TIER_LABEL[tr]}</span></div>`).join('')}</div>
      <div class="ach-facts">
        ${latest ? `<div><span>Latest</span><b>${esc(ACH_MAP[latest[0]]?.name||'')}</b><em>${fmt.date(latest[1])}</em></div>` : ''}
        ${rarest ? `<div><span>Rarest</span><b>${esc(rarest.name)}</b><em>earned ${earned[rarest.key]?.length||1}×</em></div>` : ''}
        <div><span>XP from badges</span><b>+${(got*120).toLocaleString('en-US')}</b><em>120 XP each</em></div>
      </div>
    </div>`;

  // filters
  document.getElementById('achFilters').innerHTML = [['all','All'],['unlocked','Unlocked'],['locked','Locked']]
    .map(([k,l])=>`<button data-achf="${k}" class="${achFilter===k?'on':''}">${l}</button>`).join('');
  document.querySelectorAll('[data-achf]').forEach(b=>b.addEventListener('click', ()=>{ achFilter = b.dataset.achf; renderAchievements(); }));

  // groups
  document.getElementById('achAll').innerHTML = ACH_GROUPS.map(g=>{
    const items = g.keys.map(k=>ACH_MAP[k]).filter(Boolean).filter(a=> achFilter==='all' || (achFilter==='unlocked') === unlocked.has(a.key));
    if(!items.length) return '';
    const gGot = g.keys.filter(k=>unlocked.has(k)).length;
    return `<section class="ach-group">
      <div class="ach-group-head"><h3>${g.name}</h3><span>${gGot}/${g.keys.length}</span></div>
      <div class="ach-grid">${items.map(a=>{
        const has = unlocked.has(a.key), tier = ACH_TIER[a.key] || 'bronze', list = earned[a.key] || [];
        const pr = has ? null : achProgress(a.key, all);
        const prPct = pr ? Math.min(100, pr[0]/pr[1]*100) : 0;
        return `<button class="ach-tile ${has?'has':'locked'} t-${tier}" data-ach="${a.key}">
          <div class="ach-medal">${icon(has ? a.icon : 'lock', 26)}</div>
          <div class="ach-tier-tag">${TIER_LABEL[tier]}</div>
          <div class="ach-name">${a.name}</div>
          <div class="ach-desc">${a.desc}</div>
          ${has ? `<div class="ach-meta">${list.length ? `<b>×${list.length}</b> · last ${fmt.date(list[0].timestamp).split(' · ')[0]}` : '<b>Unlocked</b>'}</div>`
                : pr ? `<div class="ach-prog"><i style="width:${prPct.toFixed(0)}%"></i></div><div class="ach-meta">${esc(pr[2])}</div>` : `<div class="ach-meta">Locked</div>`}
        </button>`;
      }).join('')}</div></section>`;
  }).join('') || `<div class="authnote">Nothing here yet.</div>`;

  document.querySelectorAll('[data-ach]').forEach(b=>b.addEventListener('click', ()=>openAchievement(b.dataset.ach, earned[b.dataset.ach]||[], unlocked.has(b.dataset.ach))));
}
function openAchievement(key, list, has){
  const a = ACH_MAP[key]; if(!a) return;
  const tier = ACH_TIER[key] || 'bronze', pr = has ? null : achProgress(key, computedTrades());
  document.getElementById('detailBody').innerHTML = `
    <div class="ach-detail t-${tier} ${has?'has':'locked'}">
      <div class="ach-medal big">${icon(has ? a.icon : 'lock', 40)}</div>
      <div class="ach-tier-tag">${TIER_LABEL[tier]}</div>
      <h3>${a.name}</h3><p>${a.desc}</p>
      ${has ? `<div class="ach-detail-count">Earned <b>${list.length || 1}×</b></div>` : pr ? `<div class="ach-prog big"><i style="width:${Math.min(100,pr[0]/pr[1]*100).toFixed(0)}%"></i></div><div class="ach-meta">${esc(pr[2])}</div>` : '<div class="ach-meta">Not unlocked yet</div>'}
      ${list.length ? `<div class="ach-cards">${list.slice(0,12).map(t=>`<button class="ach-card-row" data-open="${t.id}"><b>${esc(tk(t.ticker))}</b><span>${fmt.date(t.timestamp)}</span><em class="${t.pnl>=0?'pos':'neg'}">${fmt.usd(t.pnl)}</em></button>`).join('')}</div>` : ''}
    </div>`;
  document.querySelectorAll('#detailBody [data-open]').forEach(b=>b.addEventListener('click', ()=>openDetail(b.dataset.open)));
  detailOverlay.classList.add('show');
}
function renderStatsView(){
  const wins = trades.filter(t=>t.pnl>=0), losses=trades.filter(t=>t.pnl<0);
  const totalPnl = trades.reduce((s,t)=>s+t.pnl,0);
  const best = trades.length? Math.max(...trades.map(t=>t.roi)):0;
  const worst = trades.length? Math.min(...trades.map(t=>t.pnl)):0;
  const legendary = computedTrades().filter(t=>['legendary','mythic'].includes(t.meta.rarity)).length;
  const achUnlocked = new Set(); computedTrades().forEach(t=>t.meta.achievements.forEach(a=>achUnlocked.add(a.key)));
  const rows=[
    {i:"layers", l:"Cards collected", v:trades.length},{i:"check", l:"Wins", v:wins.length},{i:"x", l:"Losses", v:losses.length},
    {i:"target", l:"Win rate", v: trades.length? Math.round(wins.length/trades.length*100)+"%":"—"},
    {i:"coin", l:"Total P&L", v: fmt.usd(totalPnl)},{i:"rocket", l:"Best ROI", v: fmt.pct(best)},
    {i:"skull", l:"Biggest loss", v: fmt.usd(worst)},{i:"crown", l:"Legendary+ cards", v: legendary},
    {i:"trophy", l:"Achievements", v: achUnlocked.size+" / "+ACH_CATALOG.length},
  ];
  document.getElementById('statsGrid').innerHTML = rows.map(r=>`<div style="padding:14px 12px;"><div style="margin-bottom:6px;color:var(--purple);">${icon(r.i,20)}</div><div class="l">${r.l}</div><div class="v">${r.v}</div></div>`).join('');
  renderGoal(totalPnl);
}
function renderGoal(totalPnl){
  const circumference = 213.6;
  const pct = goalTarget>0 ? Math.max(0, Math.min(1, totalPnl/goalTarget)) : 0;
  const offset = circumference*(1-pct);
  document.getElementById('goalCurrent').textContent = fmt.usd(totalPnl);
  document.getElementById('goalTarget').textContent = goalTarget>0 ? 'of $'+goalTarget : 'no goal set';
  document.getElementById('goalPct').textContent = Math.round(pct*100)+'%';
  document.getElementById('goalRing').style.strokeDashoffset = offset;
  document.getElementById('goalInput').value = goalTarget>0 ? goalTarget : '';
  document.getElementById('goalCurrentHome').textContent = fmt.usd(totalPnl);
  document.getElementById('goalTargetHome').textContent = goalTarget>0 ? 'of $'+goalTarget : 'no goal set';
  document.getElementById('goalPctHome').textContent = Math.round(pct*100)+'%';
  document.getElementById('goalRingHome').style.strokeDashoffset = offset;
  if(goalTarget>0 && totalPnl>=goalTarget){
    const key = goalFlagKey(goalAchievementKey(goalTarget));
    if(localStorage.getItem(key) !== '1'){
      localStorage.setItem(key, '1');
      celebrateGoal(goalTarget, totalPnl);
    }
  }
}
function goalFlagKey(k){ return 'dc_goal_ach_'+(session?.user?.id||'anon')+'_'+k; }
function goalAchievementKey(target){
  if(target<100) return "goal_first_milestone";
  if(target<500) return "goal_crusher";
  if(target<2000) return "goal_smasher";
  return "goal_legend";
}
function celebrateGoal(target, totalPnl){
  setTimeout(spawnConfetti, 200);
  const ach = ACH_MAP[goalAchievementKey(target)];
  const overlay = document.createElement('div');
  overlay.className = 'overlay goal-overlay';
  overlay.innerHTML = `<div class="modal goal-modal">
    <div class="goal-trophy-ring">${icon('trophy',40,'var(--gold)')}</div>
    <h3 style="font-size:22px;">GOAL REACHED!</h3>
    <div class="goal-unlock-label">Achievement unlocked</div>
    <div class="achitem" style="justify-content:center; margin:0 0 18px; background:rgba(255,255,255,.04);">
      <span style="color:var(--purple)">${icon('trophy',20)}</span>
      <div><b>${ach.name}</b><br><span>$${target} target hit — you're at ${fmt.usd(totalPnl)}</span></div>
    </div>
    <button class="btn-neutral" style="width:100%; padding:13px;" id="btnCloseGoalCelebrate">KEEP GOING</button>
  </div>`;
  document.body.appendChild(overlay);
  requestAnimationFrame(()=> requestAnimationFrame(()=> overlay.classList.add('show')));
  const close = ()=>{ overlay.classList.remove('show'); setTimeout(()=>overlay.remove(), 400); };
  overlay.addEventListener('click', e=>{ if(e.target===overlay) close(); });
  overlay.querySelector('#btnCloseGoalCelebrate').addEventListener('click', close);
}
function spawnConfetti(){
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:fixed; inset:0; z-index:200; pointer-events:none;';
  canvas.width = innerWidth; canvas.height = innerHeight;
  document.body.appendChild(canvas);
  const ctx2 = canvas.getContext('2d');
  const colors = ['#C09EFF','#FFD35C','#3DFFA0','#6EC0FF','#FF5C6C'];
  const pieces = Array.from({length:140}, ()=>({
    x: Math.random()*canvas.width, y: -20-Math.random()*canvas.height*0.3,
    vx: (Math.random()-0.5)*3, vy: 2+Math.random()*3,
    size: 5+Math.random()*5, color: colors[Math.floor(Math.random()*colors.length)],
    rot: Math.random()*360, vrot: (Math.random()-0.5)*10
  }));
  const start = performance.now();
  function frame(now){
    const t = now-start;
    ctx2.clearRect(0,0,canvas.width,canvas.height);
    pieces.forEach(p=>{
      p.x += p.vx; p.y += p.vy; p.vy += 0.03; p.rot += p.vrot;
      ctx2.save(); ctx2.translate(p.x,p.y); ctx2.rotate(p.rot*Math.PI/180);
      ctx2.fillStyle = p.color; ctx2.fillRect(-p.size/2,-p.size/2,p.size,p.size*0.6);
      ctx2.restore();
    });
    if(t < 3200) requestAnimationFrame(frame); else canvas.remove();
  }
  requestAnimationFrame(frame);
}
document.getElementById('btnSaveGoal').addEventListener('click', async ()=>{
  const v = Math.round(num(parseFloat(document.getElementById('goalInput').value),0,1e9)*100)/100;
  goalTarget = v;
  await store.setGoal(v);
  renderGoal(trades.reduce((s,t)=>s+t.pnl,0));
  showToast(v>0 ? 'Goal set to $'+v : 'Goal cleared');
});
/* ---------- account: set / change password (Google users can add one) ---------- */
function hasPassword(){
  const p = session?.user?.app_metadata?.providers || [];
  return p.includes('email') || (session?.user?.identities||[]).some(i=>i.provider==='email');
}
function renderPasswordBlock(){
  const u = session?.user;
  const block = document.getElementById('pwBlock');
  if(!u || !u.email || u.is_anonymous){ block.style.display = 'none'; return; }   // watch-only wallets have no email
  block.style.display = '';
  const has = hasPassword();
  document.getElementById('pwTitle').textContent = has ? 'CHANGE PASSWORD' : 'ADD A PASSWORD';
  const note = document.getElementById('accPwNote');
  if(!note.textContent) setNote(note, has ? '' : `Sign in with ${u.email} + password too, not only Google.`, 'info');
}
let pwBusy = false;
document.getElementById('btnAccPassword').addEventListener('click', async ()=>{
  if(pwBusy) return;
  const note = document.getElementById('accPwNote');
  const p1 = document.getElementById('accPassword').value, p2 = document.getElementById('accPassword2').value;
  const nonceEl = document.getElementById('accNonce'), nonce = nonceEl.value.trim();
  if(p1.length < 8 || p1.length > 72){ setNote(note, 'Password must be 8 to 72 characters.', 'error'); return; }
  if(p1 !== p2){ setNote(note, "Passwords don't match.", 'error'); return; }
  if(nonceEl.style.display !== 'none' && !/^[0-9A-Za-z]{4,10}$/.test(nonce)){ setNote(note, 'Enter the code from the email.', 'error'); return; }
  pwBusy = true; setNote(note, 'Saving...', 'info');
  try{
    const { error } = await sb.auth.updateUser(nonce ? { password: p1, nonce } : { password: p1 });
    if(error){
      const m = String(error.message||'').toLowerCase(), code = String(error.code||'');
      if(code === 'reauthentication_needed' || m.includes('reauthentication')){
        const r = await sb.auth.reauthenticate();
        nonceEl.style.display = '';
        setNote(note, r.error ? 'Could not send the confirmation code — try again later.' : 'For security, we emailed you a code. Enter it and save again.', r.error ? 'error' : 'info');
      }else if(code === 'same_password' || m.includes('different from the old')){
        setNote(note, 'New password must be different from the current one.', 'error');
      }else if(code === 'weak_password' || m.includes('weak') || m.includes('password should')){
        setNote(note, 'Password too weak — use a longer, less common one.', 'error');
      }else if(m.includes('nonce') || code === 'reauthentication_not_valid'){
        setNote(note, 'Wrong or expired code.', 'error');
      }else setNote(note, 'Could not save the password — try again.', 'error');
      return;
    }
    ['accPassword','accPassword2','accNonce'].forEach(id=>document.getElementById(id).value='');
    nonceEl.style.display = 'none';
    const { data } = await sb.auth.refreshSession(); if(data?.session) session = data.session;
    setNote(note, 'Password saved. You can now sign in with email + password.', 'ok');
    renderPasswordBlock();
  }catch(e){ setNote(note, 'Could not save the password — try again.', 'error'); }
  finally{ pwBusy = false; }
});

function renderAccount(){
  const walletAcc = connectedAccounts.find(a=>a.provider==='wallet');
  const idLabel = session?.user?.email || (walletAcc ? walletAcc.handle.slice(0,4)+'...'+walletAcc.handle.slice(-4) : 'Anonymous wallet');
  document.getElementById('accEmail').textContent = idLabel;
  renderPasswordBlock();
  document.getElementById('avInitial').textContent = idLabel[0].toUpperCase();
  document.getElementById('providerList').innerHTML = PROVIDERS.map(p=>{
    const acc = connectedAccounts.find(a=>a.provider===p.key);
    let status = esc(p.sub);
    if(acc){
      const addr = acc.handle.length>20 ? acc.handle.slice(0,6)+'…'+acc.handle.slice(-4) : acc.handle;
      const st = acc.error ? `<span class="sync-err">${esc(friendlySyncError(acc.error))}</span>`
        : !acc.syncedAt ? 'first import in progress…'
        : acc.pending > 0 ? `catching up · ${acc.pending} transactions left`
        : `synced ${ago(acc.syncedAt)}${acc.imported ? ` · ${acc.imported} cards imported` : ''}`;
      status = `${esc(addr)} · ${st}`;
    }
    return `<div class="provider-row">
      <div class="prov-main"><div class="provider-name">${p.name}
        <button type="button" class="prov-help" data-help="${p.key}" aria-label="How to connect ${p.name}">?</button></div>
        <div class="provider-sub">${status}</div></div>
      ${acc ? `<button class="btn-connect connected" data-sync="${p.key}">SYNC</button><button class="btn-unlink" data-unlink="${p.key}" aria-label="Disconnect ${p.name}">${icon('x',14)}</button>`
            : `<button class="btn-connect" data-p="${p.key}">CONNECT</button>`}
    </div>`;
  }).join('');
  const list = document.getElementById('providerList');
  list.querySelectorAll('[data-p]').forEach(b=>b.addEventListener('click', ()=>connectProvider(b.dataset.p)));
  list.querySelectorAll('[data-sync]').forEach(b=>b.addEventListener('click', ()=>syncNow(true)));
  list.querySelectorAll('[data-help]').forEach(b=>b.addEventListener('click', ()=>openProviderHelp(b.dataset.help)));
  list.querySelectorAll('[data-unlink]').forEach(b=>b.addEventListener('click', async ()=>{
    if(!confirm('Disconnect this wallet? Imported cards stay.')) return;
    await store.disconnectAccount(b.dataset.unlink); await reload();
  }));
}
function renderHome(){
  const all = computedTrades().sort((a,b)=>b.timestamp-a.timestamp).slice(0,4);
  const grid = document.getElementById('homeGrid');
  if(all.length===0){
    grid.innerHTML = `<div class="empty"><b>NO CARDS YET.</b>Log your first trade.<br><button id="homeEmptyCreate">CREATE YOUR FIRST CARD</button></div>`;
    document.getElementById('homeEmptyCreate')?.addEventListener('click', openNewModal);
    return;
  }
  grid.innerHTML = all.map(cardHTML).join('');
  bindCards(grid);
}
function goToView(v){
  view = v;
  document.querySelectorAll('#nav button').forEach(x=>x.classList.toggle('active', x.dataset.v===v));
  ['home','collection','history','achievements','stats','account'].forEach(k=>{
    document.getElementById(k+'View').style.display = (k===v)?'block':'none';
  });
}
function renderHistory(){
  const all = computedTrades().sort((a,b)=>b.timestamp-a.timestamp);
  const ids = new Set(all.map(t=>t.id));
  for(const id of [...histSel]) if(!ids.has(id)) histSel.delete(id);
  document.getElementById('histCount').textContent = all.length;
  const view = document.getElementById('historyView');
  view.classList.toggle('selecting', histSelect);
  const bar = document.getElementById('histBar');
  bar.innerHTML = !all.length ? '' : histSelect
    ? `<span class="hist-selcount">${histSel.size} selected</span>
       <button class="hbtn danger" id="histDelSel" ${histSel.size?'':'disabled'}>DELETE SELECTED</button>
       <button class="hbtn" id="histCancel">CANCEL</button>`
    : `<button class="hbtn" id="histSelect">SELECT</button>
       <button class="hbtn danger" id="histClear">CLEAR HISTORY</button>`;
  const head = document.getElementById('histHeadSel');
  head.innerHTML = histSelect ? `<input type="checkbox" id="histAll" aria-label="Select all" ${all.length && histSel.size===all.length?'checked':''}>` : '';
  document.getElementById('historyBody').innerHTML = all.map(t=>{
    const win = t.pnl>=0;
    return `<tr style="border-top:1px solid var(--border);" data-id="${t.id}" class="${histSel.has(t.id)?'is-sel':''}">
      <td class="sel-cell">${histSelect?`<input type="checkbox" class="hist-chk" data-id="${t.id}" ${histSel.has(t.id)?'checked':''} aria-label="Select trade">`:''}</td>
      <td style="padding:9px 12px; color:var(--tx2);">${fmt.date(t.timestamp)}</td>
      <td style="padding:9px 12px; font-weight:700;"><span class="hist-tk">${coinImg(t, 22)}${esc(tk(t.ticker))}</span></td>
      <td style="padding:9px 12px; color:var(--tx2);">${fmt.mc(t.entryMc)}</td>
      <td style="padding:9px 12px; color:var(--tx2);">${fmt.mc(t.exitMc)}</td>
      <td style="padding:9px 12px; color:var(--tx2);">${fmt.hold(t.holdTime)}</td>
      <td style="padding:9px 12px;" class="${win?'pos':'neg'}">${fmt.usd(t.pnl)}</td>
      <td style="padding:9px 12px;" class="${win?'pos':'neg'}">${fmt.pct(t.roi)}</td>
      <td style="padding:9px 12px; color:var(--tx2); text-transform:uppercase;">${t.meta.rarity}</td>
      <td style="padding:9px 12px; color:var(--tx2); text-transform:uppercase;">${esc(t.source||'manual')}</td>
      <td style="padding:9px 12px;">${histSelect?'':`<button class="hist-del" data-id="${t.id}" aria-label="Delete trade" style="color:var(--red);">${icon('x',16,'var(--red)')}</button>`}</td>
    </tr>`;
  }).join('') || `<tr><td colspan="11" style="padding:24px; text-align:center; color:var(--tx2);">No trades yet.</td></tr>`;

  const body = document.getElementById('historyBody');
  body.querySelectorAll('.hist-del').forEach(b=>b.addEventListener('click', async ()=>{
    if(!confirm('Delete this trade? You can recover it from Account for 30 days.')) return;
    if(await store.softDelete([b.dataset.id])){ await reload(); showToast('Trade deleted — recoverable in Account'); }
    else showToast('Could not delete — try again');
  }));
  body.querySelectorAll('.hist-chk').forEach(c=>c.addEventListener('change', ()=>{
    c.checked ? histSel.add(c.dataset.id) : histSel.delete(c.dataset.id); renderHistory();
  }));
  if(histSelect) body.querySelectorAll('tr[data-id]').forEach(tr=>tr.addEventListener('click', e=>{
    if(e.target.closest('input,button')) return;
    const id = tr.dataset.id; histSel.has(id) ? histSel.delete(id) : histSel.add(id); renderHistory();
  }));
  document.getElementById('histAll')?.addEventListener('change', e=>{
    histSel.clear(); if(e.target.checked) all.forEach(t=>histSel.add(t.id)); renderHistory();
  });
  document.getElementById('histSelect')?.addEventListener('click', ()=>{ histSelect = true; histSel.clear(); renderHistory(); });
  document.getElementById('histCancel')?.addEventListener('click', ()=>{ histSelect = false; histSel.clear(); renderHistory(); });
  document.getElementById('histDelSel')?.addEventListener('click', async ()=>{
    const n = histSel.size; if(!n) return;
    if(!confirm(`Delete ${n} trade${n>1?'s':''}? You can recover them from Account for 30 days.`)) return;
    if(await store.softDelete([...histSel])){ histSelect = false; histSel.clear(); await reload(); showToast(`${n} trade${n>1?'s':''} deleted — recoverable in Account`); }
    else showToast('Could not delete — try again');
  });
  document.getElementById('histClear')?.addEventListener('click', async ()=>{
    if(!confirm(`Clear your whole history (${all.length} trades)? You can recover them from Account for 30 days.`)) return;
    if(await store.softDelete('all')){ histSel.clear(); await reload(); showToast('History cleared — recoverable in Account'); }
    else showToast('Could not clear — try again');
  });
}

/* ---------- Account: recover deleted trades ---------- */
function renderRecover(){
  const ids = new Set(deletedTrades.map(t=>t.id));
  for(const id of [...binSel]) if(!ids.has(id)) binSel.delete(id);
  const box = document.getElementById('recoverBlock');
  document.getElementById('recoverCount').textContent = deletedTrades.length ? `(${deletedTrades.length})` : '';
  if(!deletedTrades.length){ box.innerHTML = `<div class="authnote" style="text-align:left;">No deleted trades. Deleted trades stay here 30 days.</div>`; return; }
  box.innerHTML = `
    <div class="bin-bar">
      <label class="bin-all"><input type="checkbox" id="binAll" ${binSel.size===deletedTrades.length?'checked':''}> Select all</label>
      <span class="hist-selcount">${binSel.size} selected</span>
    </div>
    <div class="bin-list">${deletedTrades.map(t=>`
      <label class="bin-row ${binSel.has(t.id)?'is-sel':''}">
        <input type="checkbox" class="bin-chk" data-id="${t.id}" ${binSel.has(t.id)?'checked':''}>
        <span class="bin-tk">${esc(tk(t.ticker))}</span>
        <span class="bin-date">${fmt.date(t.timestamp)}</span>
        <span class="${t.pnl>=0?'pos':'neg'}">${fmt.usd(t.pnl)}</span>
      </label>`).join('')}
    </div>
    <div class="bin-actions">
      <button class="hbtn" id="binRestoreSel" ${binSel.size?'':'disabled'}>RECOVER SELECTED</button>
      <button class="hbtn good" id="binRestoreAll">RECOVER ALL</button>
      <button class="hbtn danger" id="binPurgeSel" ${binSel.size?'':'disabled'}>DELETE FOREVER</button>
    </div>
    <div class="authnote" style="text-align:left;">Deleted trades are kept 30 days, then removed for good.</div>`;
  box.querySelectorAll('.bin-chk').forEach(c=>c.addEventListener('change', ()=>{ c.checked ? binSel.add(c.dataset.id) : binSel.delete(c.dataset.id); renderRecover(); }));
  document.getElementById('binAll').addEventListener('change', e=>{ binSel.clear(); if(e.target.checked) deletedTrades.forEach(t=>binSel.add(t.id)); renderRecover(); });
  const act = async (fn, ids, okMsg)=>{ if(await fn(ids)){ binSel.clear(); await reload(); showToast(okMsg); } else showToast('Something went wrong — try again'); };
  document.getElementById('binRestoreSel').addEventListener('click', ()=>{ const n = binSel.size; if(n) act(store.restore.bind(store), [...binSel], `${n} trade${n>1?'s':''} recovered`); });
  document.getElementById('binRestoreAll').addEventListener('click', ()=>act(store.restore.bind(store), 'all', 'All trades recovered'));
  document.getElementById('binPurgeSel').addEventListener('click', ()=>{
    const n = binSel.size; if(!n) return;
    if(!confirm(`Permanently delete ${n} trade${n>1?'s':''}? This can't be undone.`)) return;
    act(store.purge.bind(store), [...binSel], `${n} trade${n>1?'s':''} permanently deleted`);
  });
}
function renderAll(){ renderStatsRow(); renderLevel(); renderGrid(); renderHome(); renderHistory(); renderAchievements(); renderStatsView(); renderAccount(); renderRecover(); }

/* ---------- auto-import (server side) ----------
   The Supabase Edge Function `sync-trades` reads each connected wallet's on-chain
   history, rebuilds positions and turns every fully closed one into a card.
   It runs every 10 minutes by itself (pg_cron); the app also nudges it on open
   and when the user taps SYNC. Nothing is fabricated: open positions are skipped. */
function ago(ts){
  const s = Math.max(0, Math.round((Date.now()-ts)/1000));
  if(s < 60) return 'just now'; if(s < 3600) return Math.round(s/60)+' min ago';
  if(s < 86400) return Math.round(s/3600)+' h ago'; return Math.round(s/86400)+' d ago';
}
let syncing = false;
async function syncNow(manual){
  if(syncing || !session || !connectedAccounts.length) return;
  syncing = true;
  if(manual) showToast('Syncing your wallets...');
  try{
    const { data, error } = await sb.functions.invoke('sync-trades', { body:{} });
    if(error) throw error;
    const before = trades.length;
    await reload();
    const n = Number(data?.imported)||0;
    if(n){ showToast(`${n} new trade card${n>1?'s':''} imported`); setTimeout(buildChartsInBrowser, 200000); }
    else if(manual) showToast(data?.pending ? 'Still catching up on history — more cards soon' : (data?.synced ? 'Up to date' : 'Synced less than a minute ago'));
    if(data?.pending && before !== trades.length) setTimeout(()=>syncNow(false), 15000);
  }catch(e){ if(manual) showToast('Sync failed — it will retry automatically'); }
  finally{ syncing = false; }
}
function maybeAutoSync(){
  const stale = connectedAccounts.some(a=>!a.syncedAt || Date.now()-a.syncedAt > 10*60*1000);
  if(stale) syncNow(false);
}


/* ---------- connect a wallet + provider guides ---------- */
const PROVIDER_GUIDE = {
  pumpfun: { title:'Connect Pump.fun', steps:[
      'Open <b>pump.fun</b> and log in.',
      'Tap your <b>profile picture</b> (top right), then <b>Profile</b>.',
      'Under your username, tap the <b>copy icon</b> next to your short wallet address (like <code>CDJp…Sfah</code>).',
      'Come back here and paste it.' ],
    tips:[ 'Logged in with email or Google? pump.fun made a wallet for you: it\u2019s still the address on your profile.',
      'Never paste a coin address: those often end with <code>pump</code>.' ] },
  fomo: { title:'Connect Fomo', steps:[
      'Open the <b>Fomo</b> app.',
      'Go to <b>Wallet</b>, then <b>Deposit</b>.',
      'Pick <b>Solana</b> (not Base or Ethereum: those start with <code>0x</code>).',
      'Copy the address and paste it here.' ],
    tips:[ 'Trades paid in USDC or SOL are both imported.', 'Only Solana trades are supported for now.' ] },
  wallet: { title:'Connect another Solana wallet', steps:[
      '<b>Phantom</b>: tap your account name at the top \u2192 copy the <b>Solana</b> address.',
      '<b>Solflare</b>: tap the address under your balance to copy it.',
      '<b>Backpack</b>: <b>Receive</b> \u2192 <b>Solana</b> \u2192 copy.',
      '<b>Axiom, Photon, BullX, GMGN\u2026</b>: open their <b>Deposit</b> page and copy the Solana address of the wallet you trade with.' ],
    tips:[ 'Use the wallet that actually makes the trades.' ] },
};
const IMPORT_FACTS = [
  'Read-only: we only read public on-chain data. Nobody can move your funds with an address.',
  'First import: your last 30 days. After that, new trades arrive by themselves every 10 minutes (or tap SYNC).',
  'A card appears once a position is closed (sold, or only dust left). Open positions wait.',
  'A sell of a bag bought before the import window, or tokens you received by transfer, can\u2019t be priced, so they\u2019re skipped.',
];
function friendlySyncError(e){
  const m = String(e||'');
  if(/coin \(token\) address|program address|No activity|Solana address/i.test(m)) return m;
  if(/rate|429|limit/i.test(m)) return 'Solana is busy \u2014 retrying automatically';
  if(/price/i.test(m)) return 'Price data unavailable \u2014 retrying automatically';
  return 'Temporary problem \u2014 retrying automatically';
}
function checkAddress(raw){
  const a = String(raw||'').replace(/\s+/g,'');
  if(!a) return { ok:false, msg:'' };
  if(/^0x[0-9a-fA-F]{6,}/.test(a)) return { ok:false, msg:'That\u2019s an EVM address (Base / Ethereum). In your app, pick Solana and copy that address.' };
  if(/(pump|bonk)$/i.test(a) && B58.test(a)) return { ok:false, msg:'This looks like a coin address (it ends with \u201c' + a.slice(-4) + '\u201d). Paste your wallet\u2019s address instead.' };
  if(/[0OIl]/.test(a) && /^[A-Za-z0-9]{32,44}$/.test(a)) return { ok:false, msg:'This contains 0, O, I or l, which a Solana address never has. Copy it again with the copy button.' };
  if(!B58.test(a)) return { ok:false, msg: a.length < 32 ? 'Too short: a Solana address is 32 to 44 characters.' : a.length > 44 ? 'Too long: a Solana address is 32 to 44 characters.' : 'Not a Solana address.' };
  if(connectedAccounts.some(x=>x.handle===a)) return { ok:true, msg:'Already connected on another line: it will only be read once.', warn:true };
  return { ok:true, msg:'Looks good.' };
}
function guideHTML(key){
  const g = PROVIDER_GUIDE[key];
  return `<ol class="pg-steps">${g.steps.map(x=>`<li>${x}</li>`).join('')}</ol>
    ${g.tips.length ? `<ul class="pg-tips">${g.tips.map(x=>`<li>${x}</li>`).join('')}</ul>` : ''}`;
}
function openProviderHelp(key){
  const p = PROVIDERS.find(x=>x.key===key), acc = connectedAccounts.find(a=>a.provider===key);
  document.getElementById('provBody').innerHTML = `
    <h3 id="provTitle">${PROVIDER_GUIDE[key].title}</h3>
    ${guideHTML(key)}
    <h4 class="pg-h">How the import works</h4>
    <ul class="pg-facts">${IMPORT_FACTS.map(x=>`<li>${x}</li>`).join('')}</ul>
    <h4 class="pg-h">Nothing showing up?</h4>
    <ul class="pg-facts"><li>Check the address: open the steps above again and compare the first and last 4 characters.</li>
      <li>Tap <b>SYNC</b>: the first import can take a few minutes on busy days.</li>
      ${acc ? '<li>Still missing trades? Re-read this wallet from the start. Cards you already have are kept, never duplicated.</li>' : ''}</ul>
    <div class="pg-actions">
      ${acc ? `<button type="button" class="hbtn" id="provResync">RE-READ FROM START</button>` : `<button type="button" class="share-btn" id="provConnect">CONNECT ${esc(p.name.toUpperCase())}</button>`}
    </div>`;
  document.getElementById('provConnect')?.addEventListener('click', ()=>openConnect(key));
  document.getElementById('provResync')?.addEventListener('click', async ()=>{
    if(!confirm('Re-read this wallet from the start? Your cards stay.')) return;
    closeProv(); showToast('Re-reading your wallet\u2026');
    try{ await sb.functions.invoke('sync-trades', { body:{ task:'resync', provider:key } }); }catch(e){}
    await reload(); showToast('Done \u2014 new cards (if any) are in your collection');
  });
  showProv();
}
function openConnect(key){
  const p = PROVIDERS.find(x=>x.key===key);
  document.getElementById('provBody').innerHTML = `
    <h3 id="provTitle">${PROVIDER_GUIDE[key].title}</h3>
    <details class="pg-how"><summary>Where do I find my address?</summary>${guideHTML(key)}</details>
    <label class="pg-label" for="provAddr">Public wallet address (Solana)</label>
    <div class="pg-input"><input id="provAddr" autocomplete="off" autocapitalize="off" spellcheck="false" inputmode="text" placeholder="e.g. CDJp\u2026Sfah (32\u201344 characters)" aria-describedby="provMsg">
      <button type="button" class="hbtn" id="provPaste">PASTE</button></div>
    <p class="pg-msg" id="provMsg" role="status" aria-live="polite"></p>
    <p class="pg-safe">\ud83d\udd12 Only your <b>public</b> address. Never your seed phrase or private key \u2014 no one should ever ask you for them.</p>
    <div class="pg-actions"><button type="button" class="share-btn" id="provGo" disabled>CONNECT</button></div>`;
  const inp = document.getElementById('provAddr'), msg = document.getElementById('provMsg'), go = document.getElementById('provGo');
  const upd = () => { const r = checkAddress(inp.value); msg.textContent = r.msg; msg.className = 'pg-msg ' + (r.ok ? (r.warn ? 'warn' : 'ok') : r.msg ? 'bad' : ''); go.disabled = !r.ok; };
  inp.addEventListener('input', upd);
  document.getElementById('provPaste').addEventListener('click', async ()=>{ try{ inp.value = (await navigator.clipboard.readText()).trim(); upd(); }catch(e){ inp.focus(); showToast('Long-press the field and choose Paste'); } });
  go.addEventListener('click', async ()=>{
    const r = checkAddress(inp.value); if(!r.ok || importing) return;
    const handle = inp.value.replace(/\s+/g,'');
    importing = true; go.disabled = true; go.textContent = 'CONNECTING\u2026';
    try{
      if(!await store.connectAccount(key, handle)){ msg.textContent = 'Could not connect \u2014 try again.'; msg.className = 'pg-msg bad'; return; }
      closeProv(); await reload();
      showToast('Connected \u2014 importing your last 30 days\u2026');
      await syncNow(false);
    } finally { importing = false; go.textContent = 'CONNECT'; go.disabled = false; }
  });
  showProv(); setTimeout(()=>inp.focus(), 50);
}
function showProv(){ const o = document.getElementById('provOverlay'); o.classList.add('show'); o.querySelector('.modal').scrollTop = 0; }
function closeProv(){ document.getElementById('provOverlay').classList.remove('show'); }
document.getElementById('provOverlay').addEventListener('click', e=>{ if(e.target.id === 'provOverlay' || e.target.closest('[data-close]')) closeProv(); });
document.addEventListener('keydown', e=>{ if(e.key === 'Escape' && document.getElementById('provOverlay').classList.contains('show')) closeProv(); });
let importing = false;
function connectProvider(key){ openConnect(key); }

document.getElementById('levelBar').addEventListener('click', ()=>{
  const d = document.getElementById('lvlDetail'), open = d.hidden;
  d.hidden = !open; document.getElementById('levelBar').setAttribute('aria-expanded', String(open));
});


/* ---------- build real charts in the browser (GeckoTerminal, free, CORS *) and cache them in the DB ----------
   Runs in the background, one request every 2.2 s (free tier: 30/min), newest trades first. */
const GT = 'https://api.geckoterminal.com/api/v2/networks/solana';
let chartQueueRunning = false, gtLast = 0;
let gtChain = Promise.resolve();
function gtGet(path){                                                   // one request every 2.2 s, strictly serialized
  const run = async () => {
    const wait = gtLast + 2200 - Date.now(); if(wait > 0) await new Promise(r=>setTimeout(r, wait));
    gtLast = Date.now();
    const r = await fetch(GT + path, { headers:{ Accept:'application/json' } });
    if(r.status === 429){ gtLast = Date.now() + 20000; throw new Error('429'); }
    return r.ok ? r.json() : null;
  };
  const p = gtChain.then(run, run); gtChain = p.catch(()=>{}); return p;
}
/* failed chart attempts per trade, per device: they expire after 6 h (a source can be down or rate-limited for a while,
   the chart must still come back later instead of being given up for good) */
function chartTries(id){ try{ const v = JSON.parse(localStorage.getItem('dc_ct4_'+id)||'null'); return v && Date.now() - v.at < 6*3600e3 ? v.n : 0; }catch(e){ return 0; } }
function bumpTries(id){ try{ localStorage.setItem('dc_ct4_'+id, JSON.stringify({ n: chartTries(id)+1, at: Date.now() })); }catch(e){} }
const gtPools = new Map();
async function buildOneInBrowser(t){
  const end = t.timestamp, start = end - (t.holdTime||0)*1000;
  const marks = (t.legs && t.legs.length ? t.legs : [[start,'b',t.entryMc],[end,'s',t.exitMc]])
    .filter(m=>Array.isArray(m) && Number.isFinite(+m[0]) && (m[1]==='b'||m[1]==='s')).map(m=>[+m[0], m[1], +m[2]||0]);
  const ts = marks.map(m=>m[0]);
  const t0 = Math.min(...ts) - 120000, t1 = Math.max(...ts) + 120000;
  if(!gtPools.has(t.mint)){
    try{ const c = JSON.parse(localStorage.getItem('dc_gtp_'+t.mint)||'null'); if(c && c.p && c.p.length && Date.now()-c.at < 7*864e5) gtPools.set(t.mint, c.p); }catch(e){}
  }
  if(!gtPools.has(t.mint)){
    const j = await gtGet(`/tokens/${t.mint}/pools?page=1`);
    gtPools.set(t.mint, (j?.data||[]).map(p=>{
      const a = p.attributes||{}, price = +a.base_token_price_usd, fdv = +a.fdv_usd;
      const baseIsMint = String(p.relationships?.base_token?.data?.id||'').endsWith(t.mint);
      return { addr:a.address, created: Date.parse(a.pool_created_at||'')||0, supply: baseIsMint && price>0 && fdv>0 ? fdv/price : 0 };
    }));
    if(gtPools.get(t.mint).length){ try{ localStorage.setItem('dc_gtp_'+t.mint, JSON.stringify({ at:Date.now(), p:gtPools.get(t.mint) })); }catch(e){} }
    else gtPools.delete(t.mint);                                        // not indexed yet: ask again next time, never cache "no pool"
  }
  const pools = gtPools.get(t.mint) || [];
  if(!pools.length){ bumpTries(t.id); return false; }
  const list = pools.filter(p=>!p.created || p.created <= t1).slice(0,3);
  const supply = (pools.find(p=>p.supply>0)||{}).supply || 0;
  // 1) recent trade: rebuild second-level candles from the pool's real trades (GeckoTerminal keeps the last 300)
  if(false){                                                          // one style for every chart: minute candles below
    for(const p of list){
      const j = await gtGet(`/pools/${p.addr}/trades`);
      const tr = (j?.data||[]).map(x=>{ const a = x.attributes||{}, buy = String(a.to_token_address) === t.mint;
          return { ts: Date.parse(a.block_timestamp), px: +(buy ? a.price_to_in_usd : a.price_from_in_usd) }; })
        .filter(x=>x.ts && x.px > 0).sort((a,b)=>a.ts-b.ts);
      if(!tr.length || tr[0].ts > t0 + 60000) continue;               // feed doesn't reach back far enough: minute candles below
      const win = tr.filter(x=>x.ts >= t0 && x.ts <= t1);
      if(win.length < 4) continue;
      const a0 = win[0].ts, b0 = Math.max(win[win.length-1].ts, t1 - 60000), span = Math.max(1, (b0 - a0)/1000);
      const bucket = [1,2,3,5,10,15,30,60].find(x=>span/x <= 60) || 60, bms = bucket*1000;
      const cs = []; let prev = null;
      for(let k = a0; k <= b0; k += bms){                             // every bucket gets a candle (flat when nobody traded)
        const inB = win.filter(x=>x.ts >= k && x.ts < k + bms);
        const o = prev ?? (inB[0] ? inB[0].px : win[0].px);
        if(inB.length){ const ps = inB.map(x=>x.px); cs.push([k, o, Math.max(o, ...ps), Math.min(o, ...ps), ps[ps.length-1]]); prev = ps[ps.length-1]; }
        else cs.push([k, o, o, o, o]);
        if(cs.length > 400) break;
      }
      const r2 = n => Math.round(n*supply*100)/100;
      const chart = { v:2, src:'gt', q:2, i:bms, w:[a0, b0 + bms], c:cs.map(c=>[c[0], r2(c[1]), r2(c[2]), r2(c[3]), r2(c[4])]), m:marks.slice(0,20) };
      if(t.chart && t.chart.v === 2 && !t.chart.sparse && parseChart(chart)?.sparse) continue;   // never replace a fuller chart
      const { error } = await sb.from('trades').update({ chart }).eq('id', t.id).eq('user_id', session.user.id);
      if(!error){ t.chart = parseChart(chart); return true; }
    }
  }
  // 2) older trade: minute candles over a wider window (±15 min) with empty minutes filled, so the chart stays regular
  const pad = Math.max(900000, (t1 - t0));
  const w0 = Math.min(...ts) - pad, w1 = Math.max(...ts) + pad;
  const spanMin = (w1-w0)/60000;
  const [tf, agg, step] = spanMin <= 900 ? ['minute',1,60000] : spanMin <= 15000 ? ['minute',15,900000] : ['hour',4,14400000];
  const limit = Math.min(1000, Math.ceil((w1-w0)/step) + 2);
  // every pool of the coin (launch pool + the one it migrated to): candles merged by time, so the chart runs through a migration
  const byTs = new Map(); const perPool = [];
  for(const p of list){
    if(!supply) break;
    const j = await gtGet(`/pools/${p.addr}/ohlcv/${tf}?aggregate=${agg}&before_timestamp=${Math.ceil(w1/1000)+60}&limit=${limit}&currency=usd&token=${t.mint}`);
    const c = (j?.data?.attributes?.ohlcv_list||[]).map(x=>x.map(Number)).filter(x=>x[0]*1000 >= w0-step && x[0]*1000 <= w1);
    perPool.push(c);
  }
  perPool.sort((a,b)=>b.length-a.length);                             // the busiest pool wins when both have the same minute
  for(const c of perPool) for(const x of c) if(!byTs.has(x[0])) byTs.set(x[0], x);
  const best = [...byTs.values()].sort((a,b)=>a[0]-b[0]);
  if(!best.length){ bumpTries(t.id); return false; }
  const r2 = n => Math.round(n*supply*100)/100;
  const filled = [];                                                  // missing minutes (no trade) become flat candles
  for(const c of best){
    const last = filled[filled.length-1];
    if(last) for(let k = last[0] + step/1000; k < c[0] && filled.length < 400; k += step/1000) filled.push([k, last[4], last[4], last[4], last[4]]);
    filled.push(c);
  }
  if(false){                                                          // (server fallback handled by ensureChart)
    try{
      const { data } = await sb.functions.invoke('sync-trades', { body:{ task:'chart', ids:[t.id] } });
      if(data?.charts){ const { data: row } = await sb.from('trades').select('chart').eq('id', t.id).maybeSingle(); const c = parseChart(row?.chart); if(c){ t.chart = c; return true; } }
    }catch(e){ /* keep the minute candles */ }
  }
  const cs = filled.slice(-400).map(c=>[c[0]*1000, r2(c[1]), r2(c[2]), r2(c[3]), r2(c[4])]);
  const reach = cs[0][0] <= Math.min(...ts) + step && cs[cs.length-1][0] + 2*step >= Math.max(...ts);   // candles span buy -> sell
  const chart = { v:2, src:'gt', q: cs.length >= 12 && reach ? 3 : 1, i:step, w:[cs[0][0], cs[cs.length-1][0]+step], c:cs, m:marks.slice(0,20) };
  if(t.chart && t.chart.v === 2 && !t.chart.sparse && parseChart(chart)?.sparse) return false;   // never replace a fuller chart
  const { error } = await sb.from('trades').update({ chart }).eq('id', t.id).eq('user_id', session.user.id);
  if(error){ bumpTries(t.id); return false; }
  t.chart = parseChart(chart); return true;
}
async function buildChartsInBrowser(){
  if(chartQueueRunning || !session) return;
  chartQueueRunning = true;
  try{
    // the server upgrades every chart to the reference style in its cron passes: pick up what it built
    const pend = trades.filter(t=>!styled(t.chart) && t.mint).slice(0, 100).map(t=>t.id);
    if(pend.length){ try{
      const { data: rows } = await sb.from('trades').select('id,chart').in('id', pend).not('chart','is',null);
      (rows||[]).forEach(r=>{ const t = trades.find(x=>x.id===r.id); const c = parseChart(r.chart); if(t && c && (!t.chart || styled(c))) t.chart = c; });
    }catch(e){} }
    // the browser only builds charts for cards on screen (GeckoTerminal limits requests per device)
    const todo = trades.filter(t=>!styled(t.chart) && t.mint && onScreen.has(t.id) && t.timestamp < Date.now()-180000 && chartTries(t.id) < 3)
      .sort((a,b)=>b.timestamp-a.timestamp).slice(0, 4);
    let dirty = 0;
    while(todo.length){
      if(!session) break;
      while(detailOverlay.classList.contains('show') && chartInFlight.size) await new Promise(r=>setTimeout(r, 1500));   // the open card goes first
      const k = Math.max(0, todo.findIndex(x=>onScreen.has(x.id)));   // cards on screen first
      const t = todo.splice(k, 1)[0];
      if(styled(t.chart)) continue;                                   // built meanwhile (card opened)
      try{ if(await buildOneInBrowser(t)){ dirty++; refreshCharts([t.id]); } if(!styled(t.chart)) bumpTries(t.id); }
      catch(e){ if(String(e.message)==='429') break; bumpTries(t.id); }
    }
  } finally { chartQueueRunning = false; }
}
/* ultra-fast charts: everything missing is requested as soon as the app opens, cards on screen first.
   pump.fun coins -> the server builds them in batches of 10 (second candles); other coins -> the browser queue. */
function refreshCharts(ids){
  ids.forEach(id=>{ const t = trades.find(x=>x.id===id); if(!t) return;
    document.querySelectorAll(`.card[data-id="${id}"] .mini`).forEach(el=>{ el.innerHTML = miniChart(t); }); });
}
const onScreen = new Set();
const chartObserver = 'IntersectionObserver' in window ? new IntersectionObserver(entries=>{
  let add = false;
  entries.forEach(e=>{ const id = e.target.dataset.id; if(!id) return; if(e.isIntersecting){ onScreen.add(id); add = true; } else onScreen.delete(id); });
  if(add) scheduleWarm();
}, { rootMargin:'300px 0px' }) : null;
function observeCards(){ if(!chartObserver) return; document.querySelectorAll('.card[data-id]').forEach(el=>chartObserver.observe(el)); }
let warmTimer = null, warmBusy = false;
function scheduleWarm(){ clearTimeout(warmTimer); warmTimer = setTimeout(warmCharts, 120); }
const pumpAsked = new Set();
async function warmCharts(){
  if(!session) return;
  buildChartsInBrowser();                                            // non-pump coins (and pump fallbacks) in the browser
  if(warmBusy) return; warmBusy = true;
  try{
    for(let round = 0; round < 6; round++){
      const missing = trades.filter(t=>t.mint && t.mint.endsWith('pump') && !(t.chart && t.chart.v===2) && (t.chartTries||0) < 3
        && t.timestamp < Date.now()-150000 && !pumpAsked.has(t.id) && !chartInFlight.has(t.id));
      if(!missing.length) break;
      missing.sort((a,b)=>(onScreen.has(b.id)-onScreen.has(a.id)) || (b.timestamp-a.timestamp));
      const batch = missing.slice(0, 10); batch.forEach(t=>{ pumpAsked.add(t.id); chartInFlight.add(t.id); });
      try{
        const { data } = await sb.functions.invoke('sync-trades', { body:{ task:'chart', ids: batch.map(t=>t.id) } });
        const { data: rows } = await sb.from('trades').select('id,chart,chart_tries').in('id', batch.map(t=>t.id));
        let changed = 0; const upd = [];
        (rows||[]).forEach(r=>{ const t = trades.find(x=>x.id===r.id); if(!t) return; t.chartTries = Number(r.chart_tries)||0; const c = parseChart(r.chart); if(c){ t.chart = c; changed++; upd.push(t.id); } });
        batch.forEach(t=>chartInFlight.delete(t.id));
        if(changed) refreshCharts(upd);
        if(!data?.charts && !changed) break;                           // pump.fun is throttling: the browser fallback / cron will finish
      }catch(e){ batch.forEach(t=>chartInFlight.delete(t.id)); break; }
    }
    await fineCharts();
  } finally { warmBusy = false; }
  buildChartsInBrowser();
}
/* a chart with too few candles that move (empty minutes around the trade): rebuilt from the pool's real swaps */
const fineAsked = new Set();
async function fineCharts(only){
  for(let round = 0; round < 40; round++){
    const todo = trades.filter(t=>(!only || only.includes(t.id)) && t.mint && t.chart && ((t.chart.coarse && !t.chart.fine) || (only && t.chart.redo)) && (t.chartTries||0) < 8 && !fineAsked.has(t.id));
    if(!todo.length) return;
    todo.sort((a,b)=>(onScreen.has(b.id)-onScreen.has(a.id)) || (b.timestamp-a.timestamp));
    const batch = todo.slice(0, 3); batch.forEach(t=>fineAsked.add(t.id));
    try{
      const { data } = await sb.functions.invoke('fine-chart', { body:{ ids: batch.map(t=>t.id) } });
      const { data: rows } = await sb.from('trades').select('id,chart,chart_tries').in('id', batch.map(t=>t.id));
      const upd = [];
      (rows||[]).forEach(r=>{ const t = trades.find(x=>x.id===r.id); if(!t) return; t.chartTries = Number(r.chart_tries)||0; const c = parseChart(r.chart); if(c && c.fine && !c.redo) t.chart = c; upd.push(t.id); });   // not rebuilt yet: the server cron keeps going, picked up below   // fine chart, or the minute one once it gave up
      if(upd.length){ refreshCharts(upd); const d = detailOverlay.dataset.id; if(detailOverlay.classList.contains('show') && upd.includes(d)) openDetail(d, true); }
    }catch(e){ return; }
  }
}
/* the server rebuilds the rest on its own (cron): pick up what it finished, every minute while the app is open */
setInterval(async ()=>{
  if(document.hidden || !session) return;
  const ids = trades.filter(t=>pendingFine(t) || (t.chart && t.chart.redo)).map(t=>t.id).slice(0, 150); if(!ids.length) return;   // waiting, or being upgraded to more candles
  try{
    const { data: rows } = await sb.from('trades').select('id,chart,chart_tries').in('id', ids);
    const upd = [];
    (rows||[]).forEach(r=>{ const t = trades.find(x=>x.id===r.id); if(!t) return; const was = pendingFine(t); t.chartTries = Number(r.chart_tries)||0;
      const c = parseChart(r.chart); const changed = c && JSON.stringify(c.c) !== JSON.stringify(t.chart && t.chart.c); if(c) t.chart = c; if(was !== pendingFine(t) || changed) upd.push(t.id); });
    if(upd.length){ refreshCharts(upd); const d = detailOverlay.dataset.id; if(detailOverlay.classList.contains('show') && upd.includes(d)) openDetail(d, true); }
  }catch(e){}
}, 60000);

/* opening a card whose candles are missing builds them right now, instead of waiting for the queue */
const chartInFlight = new Set();
async function ensureChart(t){
  if(!t.mint || (t.chart && t.chart.v === 2 && (!thinChart(t) || chartTries(t.id) >= 3)) || chartInFlight.has(t.id)) return;
  chartInFlight.add(t.id);
  let ok = false;
  try{
    try{                                                               // server: GeckoTerminal minute candles, else pump.fun feed / chain
      const { data } = await sb.functions.invoke('sync-trades', { body:{ task:'chart', id:t.id } });
      if(data?.charts){
        const { data: row } = await sb.from('trades').select('chart').eq('id', t.id).maybeSingle();
        const c = parseChart(row?.chart); if(c){ t.chart = c; ok = true; }
      }
    }catch(e){ /* browser below */ }
    if(!styled(t.chart)){                                              // fallback: the same candles fetched by the browser
      try{ ok = (await buildOneInBrowser(t)) || ok; }
      catch(e){ if(String(e.message) !== '429') throw e; await new Promise(r=>setTimeout(r, 21000)); ok = (await buildOneInBrowser(t)) || ok; }
    }
  }catch(e){ /* keep the entry -> exit line */ }
  finally{ chartInFlight.delete(t.id); }
  if(thinChart(t)) bumpTries(t.id);
  if(ok){
    refreshCharts([t.id]);
    if(detailOverlay.classList.contains('show') && detailOverlay.dataset.id === t.id) openDetail(t.id, true);
  } else if(detailOverlay.classList.contains('show') && detailOverlay.dataset.id === t.id){ bumpTries(t.id); openDetail(t.id, true); }
}

/* ---------- nav ---------- */
document.getElementById('nav').addEventListener('click', e=>{
  const b = e.target.closest('button'); if(!b) return;
  goToView(b.dataset.v);
});
document.getElementById('hamburger').addEventListener('click', ()=>{
  document.querySelectorAll('#navMenu button').forEach(x=>x.classList.toggle('active', x.dataset.v===view));
  document.getElementById('navOverlay').classList.add('show');
});
document.getElementById('navMenu').addEventListener('click', e=>{
  const b = e.target.closest('button'); if(!b) return;
  goToView(b.dataset.v);
  document.getElementById('navOverlay').classList.remove('show');
});
document.getElementById('navOverlay').querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click',()=>document.getElementById('navOverlay').classList.remove('show')));
document.getElementById('navOverlay').addEventListener('click', e=>{ if(e.target.id==='navOverlay') e.currentTarget.classList.remove('show'); });
document.getElementById('homeSeeAll').addEventListener('click', ()=>goToView('collection'));
document.getElementById('filterRow').addEventListener('click', e=>{
  const b=e.target.closest('button'); if(!b) return;
  document.querySelectorAll('#filterRow .chip').forEach(x=>x.classList.remove('active'));
  b.classList.add('active'); activeFilter=b.dataset.f; renderGrid(true);
});
document.getElementById('sortSel').addEventListener('change', e=>{ sortMode=e.target.value; renderGrid(true); });
document.getElementById('profileChip').addEventListener('click', ()=>goToView('account'));
document.getElementById('btnLogout').addEventListener('click', async ()=>{ await sb.auth.signOut(); location.reload(); });
/* RGPD erasure: deletes the auth user server-side (delete_my_account), trades / wallets / goal cascade */
document.getElementById('btnDeleteAccount').addEventListener('click', async ()=>{
  const typed = window.prompt('This permanently deletes your account, all your trades, connected wallets and goal.\nType DELETE to confirm.');
  if(typed === null) return;
  if(typed.trim().toUpperCase() !== 'DELETE'){ showToast('Not deleted — type DELETE to confirm'); return; }
  const { error } = await sb.rpc('delete_my_account');
  if(error){ showToast('Could not delete the account — try again or contact us'); return; }
  try{ Object.keys(localStorage).filter(k => k.startsWith('dc_')).forEach(k => localStorage.removeItem(k)); }catch(e){}
  await sb.auth.signOut(); location.reload();
});

/* ---------- new trade modal ---------- */
const newOverlay = document.getElementById('newOverlay');
function openNewModal(){
  ['fTicker','fEntry','fExit','fInvested'].forEach(id=>document.getElementById(id).value='');
  holdSeconds = 3600;
  document.querySelectorAll('#holdChips .chip').forEach(x=>x.classList.toggle('active', x.dataset.s==='3600'));
  updatePreview(); newOverlay.classList.add('show');
}
document.getElementById('btnNew').addEventListener('click', openNewModal);
newOverlay.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click',()=>newOverlay.classList.remove('show')));
let holdSeconds = 3600;
document.getElementById('holdChips').addEventListener('click', e=>{
  const b=e.target.closest('button'); if(!b) return;
  document.querySelectorAll('#holdChips .chip').forEach(x=>x.classList.remove('active'));
  b.classList.add('active'); holdSeconds = +b.dataset.s; updatePreview();
});
function readForm(){
  const entry = num(document.getElementById('fEntry').value,0,1e15);
  const exit = num(document.getElementById('fExit').value,0,1e15);
  const invested = num(document.getElementById('fInvested').value,0,1e9);
  const roi = entry>0 ? ((exit-entry)/entry)*100 : 0;
  const pnl = invested>0 ? invested*(roi/100) : (exit-entry)/1000; // fallback rough $ if no invested amount given
  return {
    ticker: cleanTicker(document.getElementById('fTicker').value) || '$TICKER',
    pnl: Math.round(pnl*100)/100,
    roi: Math.round(roi*10)/10,
    entryMc: entry, exitMc: exit,
    holdTime: holdSeconds,
  };
}
function updatePreview(){
  const f = readForm();
  const fake = {...f, id:'preview', tradeId: trades.length+1, timestamp: Date.now()};
  const meta = generateTradeCard(fake, trades);
  document.getElementById('previewSlot').outerHTML = `<div class="card" id="previewSlot" data-r="${meta.rarity}" style="${cardStyle(meta)}">${renderCardHTML(fake, meta)}</div>`;
}
['fTicker','fEntry','fExit','fInvested'].forEach(id=>document.getElementById(id).addEventListener('input', updatePreview));
let saving = false;
document.getElementById('btnCreate').addEventListener('click', async ()=>{
  if(saving) return;                                   // no double-tap duplicates
  const f = readForm();
  if(!(f.entryMc>0)){ showToast("Enter an entry market cap"); return; }
  saving = true;
  try{
    const ok = await store.saveTrade({...f, source:'manual'});
    newOverlay.classList.remove('show');
    await reload();
    showToast(ok ? "Card added" : "Couldn't save — try again");
  } finally { saving = false; }
});

/* ---------- detail modal ---------- */
const detailOverlay = document.getElementById('detailOverlay');
/* ---------- trade detail ---------- */
const coversFills = ch => { const ts = (ch.m||[]).map(m=>m[0]); if(!ts.length || !ch.c.length) return true;      // candles must span the whole trade
  const iv = ch.iv0 || ch.i; return ch.c[0][0] <= Math.min(...ts) + iv && ch.c[ch.c.length-1][0] + iv >= Math.max(...ts) - iv; };
const styled = ch => !!(ch && ch.v === 2 && ((ch.src === 'gt' && ch.q === 3) || ch.fine));
const thinChart = t => !!(t.chart && t.chart.v === 2 && t.mint && (!styled(t.chart) || !coversFills(t.chart)));
const pendingFine = t => !!(t.chart && t.chart.coarse && !t.chart.fine && t.mint && (t.chartTries||0) < 8);   // being rebuilt from real swaps
function chartState(t){
  if(pendingFine(t)) return 'loading';
  if(t.chart && t.chart.v === 2) return 'ready';                     // a thin chart still shows; its upgrade runs in the background
  if(!t.mint) return 'manual';
  if(chartInFlight.has(t.id)) return 'loading';
  return chartTries(t.id) < 3 ? 'loading' : 'none';
}
const fmtClock = ts => new Date(ts).toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
const fmtDelta = ms => { const s = Math.round(ms/1000); return s < 60 ? `+${s}s` : `+${Math.floor(s/60)}m ${s%60}s`; };
function openDetail(id, refresh){
  const t = trades.find(x=>x.id===id); if(!t) return;
  if(!refresh && t.chart && (t.chart.coarse || t.chart.redo)) fineCharts([t.id]);       // opened: its second-level candles first
  const keepScroll = refresh ? detailOverlay.querySelector('.modal').scrollTop : 0;
  const meta = generateTradeCard(t, trades);
  const win = t.pnl >= 0, cls = win ? 'pos' : 'neg';
  const all = computedTrades();
  // size in / out (trade price) from pnl and roi
  const size = t.roi ? Math.abs(t.pnl / (t.roi/100)) : null, out = size != null ? size + t.pnl : null;
  const mult = t.entryMc > 0 && t.exitMc > 0 ? t.exitMc / t.entryMc : null;
  const opened = t.timestamp - (t.holdTime||0)*1000;
  // context
  const byPnl = [...all].sort((a,b)=>b.pnl-a.pnl), rank = byPnl.findIndex(x=>x.id===t.id) + 1;
  const beat = all.length > 1 ? Math.round((all.filter(x=>x.pnl < t.pnl).length / (all.length-1)) * 100) : null;
  const same = all.filter(x=> t.mint ? x.mint === t.mint : x.ticker === t.ticker);
  const sameTotal = same.reduce((s,x)=>s+x.pnl, 0);
  // fills: exact ones from the chart when available
  const fills = (t.chart?.src === 'pump' && t.chart.m0?.length ? t.chart.m0.map(m=>[m[0], m[1], m[2]])
               : t.legs?.length ? t.legs.map(l=>[+l[0], l[1], +l[2]])
               : [[opened,'b',t.entryMc],[t.timestamp,'s',t.exitMc]]).sort((a,b)=>a[0]-b[0]);
  const f0 = fills.length ? fills[0][0] : opened;
  const st = chartState(t);
  const note = st === 'ready' ? `Market cap · ${t.chart.src==='pump'?'pump.fun trades':t.chart.src==='chain'?'on-chain swaps':'GeckoTerminal'}`
    : st === 'loading' ? 'Loading the real candles…'
    : st === 'manual' ? 'Manual trade: entry and exit only, no market data.'
    : 'No market data found for this coin. Showing entry and exit only.';
  const links = t.mint ? [
    t.mint.endsWith('pump') ? ['pump.fun', `https://pump.fun/coin/${t.mint}`] : null,
    ['DexScreener', `https://dexscreener.com/solana/${t.mint}`],
    ['Solscan', `https://solscan.io/token/${t.mint}`],
  ].filter(Boolean) : [];
  const row = (l, v, c='') => `<div class="dt-row"><span>${l}</span><b class="${c}">${v}</b></div>`;
  document.getElementById('detailBody').innerHTML = `
  <article class="dt" aria-labelledby="dtTitle">
    <div class="dt-head">
      ${coinImg(t, 64, 'big')}
      <div class="dt-id">
        <h2 id="dtTitle">${esc(tk(t.ticker))}</h2>
        <div class="dt-sub">#${String(t.tradeId).padStart(4,'0')} · ${t.source==='wallet'?'On-chain':'Manual'} · ${fmt.date(t.timestamp)}</div>
      </div>
      <div class="dt-badges"><span class="dt-rar r-${meta.rarity}">${meta.rarity.toUpperCase()}</span><span class="dt-grade r-${meta.rarity}" title="Grade">${meta.grade}</span></div>
    </div>

    <section class="dt-hero ${cls}">
      <div class="dt-pnl">${fmt.usd(t.pnl)}</div>
      <div class="dt-hero-sub">
        <span class="dt-pill">${fmt.pct(t.roi)}</span>
        ${mult ? `<span class="dt-pill ghost">×${mult.toFixed(mult>=10?1:2)} market cap</span>` : ''}
        <span class="dt-pill ghost">${fmt.hold(t.holdTime)} hold</span>
      </div>
      ${t.pnlNet!=null ? `<div class="dt-net">After fees: <b class="${t.pnlNet>=0?'pos':'neg'}">${fmt.usd(t.pnlNet)}</b> in your wallet · fees $${Math.abs(t.fees||0).toFixed(2)}</div>` : ''}
    </section>

    <div class="dt-grid">
      <section class="dt-main" aria-label="Price chart and fills">
        <div class="dt-chart ${st==='loading'?'is-loading':''}">${miniChart(t, true)}</div>
        <p class="chart-note">${note}</p>
        <h3 class="dt-h">Fills</h3>
        <ol class="dt-fills">${fills.map(([ts,k,mc])=>`
          <li><span class="mk-chip mk-${k}">${k==='b'?'B':'S'}</span>
            <span class="dt-f-what">${k==='b'?'Buy':'Sell'}</span>
            <span class="dt-f-time">${fmtClock(ts)} <em>${ts===f0?'start':fmtDelta(ts-f0)}</em></span>
            <span class="dt-f-mc">${mc>0?fmt.mc(mc)+' MC':'—'}</span></li>`).join('')}</ol>
      </section>

      <section class="dt-side">
        <h3 class="dt-h">Trade</h3>
        <div class="dt-rows">
          ${size!=null ? row('Size in', '$'+size.toFixed(2)) : ''}
          ${out!=null ? row('Got back', '$'+out.toFixed(2), cls) : ''}
          ${row('Entry MC', fmt.mc(t.entryMc))}
          ${row('Exit MC', fmt.mc(t.exitMc), t.exitMc>=t.entryMc?'pos':'neg')}
          ${row('Opened', fmtClock(opened))}
          ${row('Closed', fmtClock(t.timestamp))}
          ${t.pnlNet!=null ? row('Fees', fmt.usd(-Math.abs(t.fees||0)), 'neg') + (t.cashback > 0 ? row('Cashback (pump.fun)', '+$' + t.cashback.toFixed(t.cashback < 0.01 ? 4 : 2), 'pos') : '') + row('Net PnL (wallet)', fmt.usd(t.pnlNet), t.pnlNet>=0?'pos':'neg') : ''}
        </div>

        <h3 class="dt-h">Context</h3>
        <div class="dt-rows">
          ${row('Rank', `#${rank} of ${all.length}`)}
          ${beat!=null ? row('Better than', `${beat}% of your trades`) : ''}
          ${row(`Your ${esc(tk(t.ticker))} trades`, `${same.length} · ${fmt.usd(sameTotal)}`, sameTotal>=0?'pos':'neg')}
        </div>

        ${meta.achievements.length ? `<h3 class="dt-h">Badges</h3><div class="dt-badgelist">${meta.achievements.map(a=>`<span class="dt-badge" title="${esc(a.desc)}">${icon(a.icon,14)} ${a.name}</span>`).join('')}</div>` : ''}

        ${t.mint ? `<h3 class="dt-h">Coin</h3>
          <div class="dt-mint"><code>${t.mint.slice(0,6)}…${t.mint.slice(-6)}</code><button type="button" class="hbtn" id="dtCopy" aria-label="Copy the coin address">COPY</button></div>
          <div class="dt-links">${links.map(([l,u])=>`<a href="${u}" target="_blank" rel="noopener noreferrer">${l} ↗</a>`).join('')}</div>` : ''}
      </section>
    </div>

    <div class="dt-actions">
      <button class="share-btn" id="btnShare">SHARE CARD</button>
      <button type="button" class="hbtn danger" id="dtDelete">DELETE</button>
    </div>
  </article>`;
  document.getElementById('btnShare').addEventListener('click', ()=>shareCard(t, meta));
  document.getElementById('dtCopy')?.addEventListener('click', async ()=>{ try{ await navigator.clipboard.writeText(t.mint); showToast('Address copied'); }catch(e){ showToast("Couldn't copy"); } });
  document.getElementById('dtDelete').addEventListener('click', async ()=>{
    if(!confirm('Delete this trade? You can recover it from Account for 30 days.')) return;
    if(await store.softDelete([t.id])){ detailOverlay.classList.remove('show'); await reload(); showToast('Trade deleted — recoverable in Account'); }
    else showToast('Could not delete — try again');
  });
  detailOverlay.dataset.id = t.id;
  detailOverlay.classList.add('show');
  detailOverlay.querySelector('.modal').scrollTop = keepScroll;
  if(st === 'loading') ensureChart(t);
}

/* ---------- share: see share.js (cinematic post / story, image or video) ---------- */
detailOverlay.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click',()=>detailOverlay.classList.remove('show')));
[newOverlay,detailOverlay].forEach(ov=>ov.addEventListener('click', e=>{ if(e.target===ov) ov.classList.remove('show'); }));

function showToast(msg){
  const el = document.getElementById('toast'); el.textContent = msg; el.classList.add('show');
  setTimeout(()=>el.classList.remove('show'), 2400);
}

/* ---------- auth notes: red for errors, green for success, grey for info ---------- */
function setNote(el, msg, kind='info'){ el.textContent = msg; el.classList.remove('is-error','is-ok'); if(kind==='error') el.classList.add('is-error'); if(kind==='ok') el.classList.add('is-ok'); }

/* ---------- hCaptcha (visible, required by Supabase Auth) ---------- */
const HCAPTCHA_SITEKEY = 'e5784d60-9d86-44f4-80b2-c7dcc64e3258';
let hcWidget = null;
async function renderCaptcha(){
  if(hcWidget !== null) return;
  for(let i=0; i<100 && !window.hcaptcha?.render; i++) await new Promise(r=>setTimeout(r,100));
  if(!window.hcaptcha?.render || hcWidget !== null) return;
  hcWidget = window.hcaptcha.render('hcaptchaBox', { sitekey: HCAPTCHA_SITEKEY, theme: 'dark' });
}
function takeCaptcha(note){
  const token = hcWidget !== null ? window.hcaptcha.getResponse(hcWidget) : '';
  if(!token){ setNote(note, hcWidget === null ? 'Captcha is loading — try again in a second.' : 'Complete the captcha first.', 'error'); return null; }
  return token;
}
function captchaMsg(m){
  return (m.includes('secret') || m.includes('sitekey')) ? 'Captcha is misconfigured on our side — try Google for now.' : 'Captcha failed — solve it again.';
}
function resetCaptcha(){ try{ if(hcWidget !== null) window.hcaptcha.reset(hcWidget); }catch(e){} }  // tokens are single-use
renderCaptcha();

/* ---------- auth: email + password ---------- */
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
const authNote = document.getElementById('authNote');
/* creating an account (email, Google, public key) needs the 18+ / Terms / Privacy box ticked; signing in to an existing one does not */
function consentOk(){
  const box = document.getElementById('authConsent'), lab = box && box.closest('.consent');
  if(!box || box.checked){ if(lab) lab.classList.remove('need'); return true; }
  if(lab) lab.classList.add('need');
  setNote(authNote, 'Tick the box to confirm you are 18+ and accept the Terms and Privacy Policy.', 'error'); box.focus(); return false;
}
let authBusy = false;
function readCreds(needPassword){
  const email = document.getElementById('authEmail').value.trim();
  const password = document.getElementById('authPassword').value;
  if(!EMAIL_RE.test(email) || email.length > 254){ setNote(authNote, 'Enter a valid email.', 'error'); return null; }
  if(needPassword && (password.length < 8 || password.length > 72)){ setNote(authNote, 'Password must be 8 to 72 characters.', 'error'); return null; }
  return { email, password };
}
async function authAction(needPassword, run){
  if(authBusy) return;
  const creds = readCreds(needPassword); if(!creds) return;
  const captchaToken = takeCaptcha(authNote); if(!captchaToken) return;
  authBusy = true; setNote(authNote, 'Please wait...', 'info');
  try{ await run(creds, captchaToken); }
  catch(e){ setNote(authNote, 'Something went wrong — try again.', 'error'); }
  finally{ authBusy = false; resetCaptcha(); }
}
document.getElementById('btnSignIn').addEventListener('click', ()=>authAction(true, async ({email,password}, captchaToken)=>{
  const { error } = await sb.auth.signInWithPassword({ email, password, options:{ captchaToken } });
  if(!error){ setNote(authNote, '', 'info'); return; }
  const m = String(error.message||'').toLowerCase();
  setNote(authNote, m.includes('not confirmed') ? 'Confirm your email first (check your inbox).'
    : m.includes('captcha') ? captchaMsg(m) : 'Wrong email or password.', 'error');   // no account enumeration
}));
document.getElementById('btnSignUp').addEventListener('click', ()=>consentOk() && authAction(true, async ({email,password}, captchaToken)=>{
  const { data, error } = await sb.auth.signUp({ email, password, options:{ captchaToken, emailRedirectTo: REDIRECT_URL } });
  if(error){
    const m = String(error.message||'').toLowerCase();
    setNote(authNote, m.includes('captcha') ? captchaMsg(m)
      : m.includes('password') ? 'Password too weak — use a longer, less common one.'
      : m.includes('rate limit') || m.includes('too many') ? 'Too many attempts — wait a minute.'
      : m.includes('already') ? 'Could not create the account — try signing in.' : 'Could not create the account — try again.', 'error');
    return;
  }
  setNote(authNote, data.session ? '' : 'Check your inbox to confirm your email.', 'ok');
}));
document.getElementById('btnForgot').addEventListener('click', ()=>authAction(false, async ({email}, captchaToken)=>{
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: REDIRECT_URL, captchaToken });
  if(error && String(error.message||'').toLowerCase().includes('captcha')){ setNote(authNote, captchaMsg(String(error.message).toLowerCase()), 'error'); return; }
  setNote(authNote, 'If an account exists, a reset link is on its way.', 'ok');
}));
document.getElementById('btnGoogle').addEventListener('click', async ()=>{
  if(!consentOk()) return;
  await sb.auth.signInWithOAuth({ provider:'google', options:{ redirectTo: REDIRECT_URL } });
});

/* password recovery: the reset link lands here with a PASSWORD_RECOVERY event */
const pwOverlay = document.getElementById('pwOverlay');
document.getElementById('btnSetPassword').addEventListener('click', async ()=>{
  const note = document.getElementById('pwNote');
  const password = document.getElementById('newPassword').value;
  if(password.length < 8 || password.length > 72){ setNote(note, 'Password must be 8 to 72 characters.', 'error'); return; }
  setNote(note, 'Saving...', 'info');
  const { error } = await sb.auth.updateUser({ password });
  if(error){ setNote(note, 'Could not save — use a stronger password.', 'error'); return; }
  document.getElementById('newPassword').value = '';
  pwOverlay.classList.remove('show'); showToast('Password updated');
});

/* ---------- auth: watch-only wallet (public key) ---------- */
async function loginWithPubkey(pubkey, note){
  const captchaToken = takeCaptcha(note); if(!captchaToken) return;
  setNote(note, 'Connecting...', 'info');
  const { data, error } = await sb.auth.signInAnonymously({ options:{ captchaToken } });
  resetCaptcha();
  if(error){ const m = String(error.message||'').toLowerCase(); setNote(note, m.includes('captcha') ? captchaMsg(m) : 'Auth error — try again.', 'error'); return; }
  await sb.auth.updateUser({ data: { wallet_address: pubkey } });
  await sb.from('connected_accounts').upsert({ user_id: data.user.id, provider:'wallet', handle: pubkey }, { onConflict:'user_id,provider' });
  setNote(note, 'Wallet connected.', 'ok');
  await reload();
  syncNow(false);
}
document.getElementById('btnPubkey').addEventListener('click', async ()=>{
  const pk = document.getElementById('authPubkey').value.trim();
  if(!B58.test(pk)){ setNote(authNote, "That doesn't look like a valid Solana address.", 'error'); return; }
  if(!consentOk()) return;
  await loginWithPubkey(pk, authNote);
});

async function reload(){
  idCounter = 0;
  [trades, deletedTrades] = await Promise.all([store.getTrades(), store.getDeleted()]);
  connectedAccounts = await store.getAccounts();
  goalTarget = await store.getGoal();
  renderAll();
}

/* first load: quiet skeletons in place of the stats and cards, so the empty Home never looks broken */
let firstLoadDone = false;
function showLoading(){
  const bar = w => `<i class="sk" style="width:${w}%"></i>`;
  document.getElementById('statsRow').innerHTML = Array.from({length:5}, ()=>`<div class="stat">${bar(55)}${bar(80)}</div>`).join('');
  document.getElementById('homeGrid').innerHTML = Array.from({length:4}, ()=>`<div class="card sk-card" aria-hidden="true">
    <div class="sk-row">${bar(30)}${bar(18)}</div><i class="sk sk-coin"></i>${bar(40)}${bar(70)}${bar(30)}
    <div class="chartbox skel" style="height:66px">${Array.from({length:16}, (_,k)=>`<i style="height:${(18 + 30*Math.abs(Math.sin(k*1.7))).toFixed(0)}%;animation-delay:${k*60}ms"></i>`).join('')}</div>${bar(100)}</div>`).join('');
  document.getElementById('xpLabel').textContent = 'Loading…';
  document.getElementById('homeLoading').hidden = false;
}
async function showApp(){
  scrubUrl();
  document.getElementById('landing').hidden = true;
  document.getElementById('app').hidden = false;
  if(!firstLoadDone) showLoading();
  try{ await reload(); }
  finally{ firstLoadDone = true; document.getElementById('homeLoading').hidden = true; }
  maybeAutoSync();
  warmCharts();                                                        // charts: no delay
  window.__dcGuideUser = session?.user?.id || 'anon';      // guide.js may load after this: it picks the id up itself
  window.dcGuide?.maybeStart(window.__dcGuideUser);
  setInterval(()=>{ if(!document.hidden) maybeAutoSync(); }, 5*60*1000);
}
function showLanding(){
  document.getElementById('landing').hidden = false;
  document.getElementById('app').hidden = true;
}

let appShown = false;
function onSession(sess){
  session = sess;
  if(session){ if(!appShown){ appShown = true; showApp(); } proOnSession(); }
  else { appShown = false; showLanding(); }
}
/* ---------- PRO (Whop) ----------
   PRO_LIVE stays false until the Whop plans exist and WHOP_API_KEY / WHOP_PLAN_* are set on the `whop` edge function:
   until then nothing is locked and the PRO block is hidden. The PRO state comes only from public.subscriptions (server-written). */
const PRO_LIVE = false;
const PRO_OK = new Set(['active','trialing','completed','canceling','past_due']);
window.dcPro = { enabled: PRO_LIVE, active: false, sub: null, open: () => openPro() };
function renderPro(){
  const blk = document.getElementById('proBlock'); if(!blk) return;
  blk.style.display = PRO_LIVE ? '' : 'none'; if(!PRO_LIVE) return;
  const p = window.dcPro, s = p.sub, st = document.getElementById('proState'), sub = document.getElementById('proSub'), btn = document.getElementById('btnPro');
  const when = s && s.renews_at ? new Date(s.renews_at).toLocaleDateString(undefined, { day:'numeric', month:'short', year:'numeric' }) : '';
  if(p.active){
    st.innerHTML = 'PRO <span class="pro-tag">ACTIVE</span>';
    sub.textContent = s.status === 'canceling' ? (when ? `Cancelled — PRO until ${when}` : 'Cancelled — PRO until the end of the period')
      : s.status === 'past_due' ? 'Payment failed — update your card on Whop to keep PRO' : (when ? `Renews ${when}` : 'Renews automatically');
    btn.textContent = 'MANAGE'; btn.classList.remove('pro-btn');
  } else {
    st.textContent = 'Free plan';
    sub.textContent = 'Every replay theme, background, sell effect, intro, hook and the short-logo ending.';
    btn.textContent = 'GO PRO'; btn.classList.add('pro-btn');
  }
}
async function loadPro(force){
  if(!PRO_LIVE || !session) return;
  const { data } = await sb.from('subscriptions').select('*').maybeSingle();
  window.dcPro.sub = data || null; window.dcPro.active = !!(data && PRO_OK.has(data.status) && (!data.renews_at || new Date(data.renews_at) > new Date(Date.now() - 3*864e5)));
  renderPro(); window.dispatchEvent(new Event('dc-pro'));
  // back from checkout, or an existing row: read the membership back from Whop (renewals, cancellations)
  if(force || data){
    try{
      const { data: r } = await sb.functions.invoke('whop', { body:{ action:'sync' } });
      if(r && 'pro' in r){
        const was = window.dcPro.active; window.dcPro.active = !!r.pro; window.dcPro.sub = r.sub || window.dcPro.sub;
        renderPro(); window.dispatchEvent(new Event('dc-pro'));
        if(force && r.pro && !was) showToast('Welcome to PRO — every replay style is unlocked');
        else if(force && !r.pro) showToast('Payment not found yet — it can take a minute, reopen the app');
      }
    }catch(e){}
  }
}
function openPro(){ if(!PRO_LIVE) return; document.getElementById('proNote').textContent = ''; document.getElementById('proOverlay').classList.add('show'); }
document.getElementById('btnPro').addEventListener('click', ()=>{
  const s = window.dcPro.sub;
  if(window.dcPro.active) window.open((s && s.manage_url) || 'https://whop.com/@me/settings/memberships/', '_blank', 'noopener');
  else openPro();
});
document.querySelectorAll('.pro-plan').forEach(b => b.addEventListener('click', async ()=>{
  const note = document.getElementById('proNote'), all = document.querySelectorAll('.pro-plan');
  all.forEach(x => x.disabled = true); note.textContent = 'Opening secure checkout…';
  try{
    const { data, error } = await sb.functions.invoke('whop', { body:{ action:'checkout', plan: b.dataset.plan } });
    if(error || !data || !data.url) throw error || new Error('no url');
    location.href = data.url;
  }catch(e){ note.textContent = 'Checkout unavailable right now — try again in a minute.'; all.forEach(x => x.disabled = false); }
}));
let proChecked = false;
function proOnSession(){
  if(proChecked || !session) return; proChecked = true;
  const back = new URLSearchParams(location.search).get('pro') === '1';
  if(back) history.replaceState(null, '', location.pathname + location.hash);
  loadPro(back);
}
sb.auth.onAuthStateChange((event, sess)=>{
  if(event==='TOKEN_REFRESHED' || event==='USER_UPDATED'){ session = sess; return; }
  if(event==='PASSWORD_RECOVERY') setTimeout(()=>pwOverlay.classList.add('show'), 0);
  setTimeout(()=>onSession(sess), 0);   // never call supabase inside this callback (known deadlock)
});
sb.auth.getSession().then(({data})=>onSession(data.session));
