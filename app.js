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
      fees: r.fees_usd==null ? null : num(r.fees_usd,-1e10,1e10), pnlNet: r.pnl_net==null ? null : num(r.pnl_net,-1e10,1e10), legs: Array.isArray(r.legs) ? r.legs.slice(0,20) : null }));
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
function parseChart(c){
  if(!c || typeof c!=='object') return null;
  const okN = v => Number.isFinite(v) && v >= 0 && v < 1e15;
  const m = Array.isArray(c.m) ? c.m.filter(x=>Array.isArray(x) && okN(+x[0]) && (x[1]==='b'||x[1]==='s')).map(x=>[+x[0], x[1], okN(+x[2]) ? +x[2] : 0]).slice(0,20) : [];
  const w = Array.isArray(c.w) && okN(+c.w[0]) && okN(+c.w[1]) && +c.w[1] > +c.w[0] ? [+c.w[0], +c.w[1]] : null;
  if(c.v === 2){
    const cs = Array.isArray(c.c) ? c.c.filter(x=>Array.isArray(x) && x.length>=5 && x.slice(0,5).every(v=>okN(+v))).map(x=>x.slice(0,5).map(Number)).slice(0,400) : [];
    return cs.length ? { v:2, c:cs, m, w, i: okN(+c.i) && +c.i>0 ? +c.i : 60000, src: c.src==='pump' ? 'pump' : 'gt' } : null;
  }
  const p = Array.isArray(c.p) ? c.p.filter(x=>Array.isArray(x) && okN(+x[0]) && okN(+x[1])).map(x=>[+x[0], +x[1]]).slice(0,400) : [];
  return (p.length || m.length) ? { p, m, w } : null;
}
const fmtMcShort = v => v>=1e9 ? (v/1e9).toFixed(1)+'B' : v>=1e6 ? (v/1e6).toFixed(1)+'M' : v>=1e3 ? (v/1e3).toFixed(1)+'K' : String(Math.round(v));
/* B / S pinned at the top of the chart, a dashed drop line down to the exact fill point on the candles */
const CH_TOP = 24;   // % of the chart height reserved for the markers
function markersHtml(marks, X, Y, big){
  const pos = marks.map(([mt,kind,v])=>({ kind, x: Math.min(100,Math.max(0,X(mt))), y: Math.min(100,Math.max(0,Y(v))) }));
  // markers that would touch at the top: spread them sideways (B left, S right), the drop line stays on the real time
  const gap = big ? 4.5 : 8;
  const sorted = [...pos].sort((p,q)=>p.x-q.x || (p.kind==='b'?-1:1));
  sorted.forEach((m,i)=>{ m.mx = m.x; if(i && m.mx - sorted[i-1].mx < gap) m.mx = sorted[i-1].mx + gap; });
  const over = Math.max(0, sorted.length ? sorted[sorted.length-1].mx - 100 : 0);
  sorted.forEach(m=>{ m.mx = Math.max(0, m.mx - over); });
  const mkPx = big ? 20 : 16, hPx = big ? 170 : 66, mb = (mkPx / hPx) * 100;          // marker bottom, in % of height
  // fill rounds: one fixed size; if two would overlap, push them apart (buy down, sell up) in real pixels,
  // a short leader + small anchor keep pointing at the exact fill
  const bw = big ? 520 : 170, bh = hPx, D = big ? 22 : 16, minD = D + 3;
  const pts = pos.map(m=>({ m, ax: m.x/100*bw, ay: m.y/100*bh, x: m.x/100*bw, y: m.y/100*bh }));
  for(let pass = 0; pass < 8; pass++){
    let moved = false;
    for(let i = 0; i < pts.length; i++) for(let j = i+1; j < pts.length; j++){
      const p = pts[i], q = pts[j], d = Math.hypot(q.x-p.x, q.y-p.y); if(d >= minD) continue;
      const need = (minD - d)/2 + 0.3;
      const up = p.m.kind==='s' && q.m.kind!=='s' ? p : q.m.kind==='s' && p.m.kind!=='s' ? q : (p.ay <= q.ay ? p : q), dn = up === p ? q : p;
      up.y -= need; dn.y += need; moved = true;
    }
    if(!moved) break;
  }
  pts.forEach(p=>{ p.dx = p.x/bw*100; p.dy = Math.max(-20, Math.min(120, p.y/bh*100)); p.off = Math.hypot(p.x-p.ax, p.y-p.ay) > 2; });
  const lines = pos.map(m=>`<line x1="${m.mx.toFixed(2)}" y1="${mb.toFixed(2)}" x2="${m.x.toFixed(2)}" y2="${m.y.toFixed(2)}" stroke="${m.kind==='b'?'#18c964':'#ff3b4e'}" stroke-width="1.5" stroke-dasharray="3 3" vector-effect="non-scaling-stroke"/>`).join('')
    + pts.filter(p=>p.off).map(p=>`<line x1="${p.m.x.toFixed(2)}" y1="${p.m.y.toFixed(2)}" x2="${p.dx.toFixed(2)}" y2="${p.dy.toFixed(2)}" stroke="${p.m.kind==='b'?'#18c964':'#ff3b4e'}" stroke-width="2" vector-effect="non-scaling-stroke"/>`).join('');
  return `<svg class="mk-lines" viewBox="0 0 100 100" preserveAspectRatio="none">${lines}</svg>` + pts.map(p=>`
    ${p.off ? `<span class="mk-anchor mk-${p.m.kind}" style="left:${p.m.x.toFixed(2)}%;top:${p.m.y.toFixed(2)}%"></span>` : ''}
    <span class="mk-dot mk-${p.m.kind}" style="left:${p.dx.toFixed(2)}%;top:${p.dy.toFixed(2)}%" aria-hidden="true">${p.m.kind==='b'?'B':'S'}</span>
    <span class="mk mk-top mk-${p.m.kind}" style="left:${p.m.mx.toFixed(2)}%">${p.m.kind==='b'?'B':'S'}</span>`).join('');
}
/* real candles: market cap, first fill - 2 min to last fill + 2 min (clipped to the coin's first trade).
   pump.fun coins: second-level candles + exact fills; others: minute candles. */
function miniChart(t, big){
  const h = big ? 170 : 66;
  const ch = t.chart;
  if(ch && ch.v === 2){
    const cs = ch.c, iv = ch.i;
    let x0 = Math.min(ch.w ? ch.w[0] : Infinity, cs[0][0]), x1 = Math.max(ch.w ? ch.w[1] : 0, cs[cs.length-1][0] + iv);
    if(x1 <= x0) x1 = x0 + iv;
    const ys = [...cs.flatMap(c=>[c[2],c[3]]), ...ch.m.map(m=>m[2]).filter(v=>v>0)];
    let y0 = Math.min(...ys), y1 = Math.max(...ys);
    if(y1 - y0 < 1e-9){ y0 *= 0.95; y1 = y1*1.05 + 1; }
    const pad = (y1-y0)*0.14; y0 -= pad; y1 += pad;
    const X = v => ((v-x0)/(x1-x0))*100, Y = v => CH_TOP + (1-(v-y0)/(y1-y0))*(100-CH_TOP);
    const bw = Math.max(0.35, Math.min((iv/(x1-x0))*100*0.7, big ? 3.2 : 4.5));   // few candles: thin bodies, not blocks
    const body = cs.map(([ts,o,hi,lo,c])=>{
      const up = c >= o, col = up ? '#18c964' : '#ff3b4e', cx = X(ts + iv/2);
      const top = Y(Math.max(o,c)), bot = Y(Math.min(o,c));
      return `<line x1="${cx.toFixed(2)}" x2="${cx.toFixed(2)}" y1="${Y(hi).toFixed(2)}" y2="${Y(lo).toFixed(2)}" stroke="${col}" stroke-width="1" vector-effect="non-scaling-stroke"/>`+
             `<rect x="${(cx-bw/2).toFixed(2)}" y="${top.toFixed(2)}" width="${bw.toFixed(2)}" height="${Math.max(0.8, bot-top).toFixed(2)}" fill="${col}"/>`;
    }).join('');
    const at = ts => { const c = cs.find(c=>ts < c[0]+iv) || cs[cs.length-1]; return (c[2]+c[3])/2; };
    const marks = ch.m.map(m=>[m[0], m[1], ch.src==='pump' && m[2] > 0 ? m[2] : at(m[0])]);   // pump: exact fill price
    const labels = big ? `<span class="ch-lbl top" style="top:${CH_TOP}%">${fmtMcShort(y1-pad)}</span><span class="ch-lbl bot">${fmtMcShort(Math.max(0,y0+pad))}</span>` : '';
    return `<div class="chartbox ${big?'big':''}" style="height:${h}px">
      <svg class="cs" viewBox="0 0 100 100" preserveAspectRatio="none">${body}</svg>${markersHtml(marks, X, Y, big)}${labels}</div>`;
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

function renderGrid(){
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
  grid.innerHTML = filtered.map(t=>`<div class="card" data-r="${t.meta.rarity}" data-id="${t.id}" style="${cardStyle(t.meta)}">${renderCardHTML(t,t.meta)}</div>`).join('');
  grid.querySelectorAll('.card').forEach(el=>el.addEventListener('click',()=>openDetail(el.dataset.id)));
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
  grid.innerHTML = all.map(t=>`<div class="card" data-r="${t.meta.rarity}" data-id="${t.id}" style="${cardStyle(t.meta)}">${renderCardHTML(t,t.meta)}</div>`).join('');
  grid.querySelectorAll('.card').forEach(el=>el.addEventListener('click',()=>openDetail(el.dataset.id)));
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
function renderAll(){ renderStatsRow(); renderLevel(); renderGrid(); renderHome(); renderHistory(); renderAchievements(); renderStatsView(); renderAccount(); renderRecover(); observeCards(); }

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
function chartTries(id){ try{ return Number(localStorage.getItem('dc_ct_'+id)||0); }catch(e){ return 0; } }
function bumpTries(id){ try{ localStorage.setItem('dc_ct_'+id, String(chartTries(id)+1)); }catch(e){} }
const gtPools = new Map();
async function buildOneInBrowser(t){
  const end = t.timestamp, start = end - (t.holdTime||0)*1000;
  const marks = (t.legs && t.legs.length ? t.legs : [[start,'b',t.entryMc],[end,'s',t.exitMc]])
    .filter(m=>Array.isArray(m) && Number.isFinite(+m[0]) && (m[1]==='b'||m[1]==='s')).map(m=>[+m[0], m[1], +m[2]||0]);
  const ts = marks.map(m=>m[0]);
  const t0 = Math.min(...ts) - 120000, t1 = Math.max(...ts) + 120000;
  if(!gtPools.has(t.mint)){
    try{ const c = JSON.parse(localStorage.getItem('dc_gtp_'+t.mint)||'null'); if(c && Date.now()-c.at < 7*864e5) gtPools.set(t.mint, c.p); }catch(e){}
  }
  if(!gtPools.has(t.mint)){
    const j = await gtGet(`/tokens/${t.mint}/pools?page=1`);
    gtPools.set(t.mint, (j?.data||[]).map(p=>{
      const a = p.attributes||{}, price = +a.base_token_price_usd, fdv = +a.fdv_usd;
      const baseIsMint = String(p.relationships?.base_token?.data?.id||'').endsWith(t.mint);
      return { addr:a.address, created: Date.parse(a.pool_created_at||'')||0, supply: baseIsMint && price>0 && fdv>0 ? fdv/price : 0 };
    }));
    try{ localStorage.setItem('dc_gtp_'+t.mint, JSON.stringify({ at:Date.now(), p:gtPools.get(t.mint) })); }catch(e){}
  }
  const list = gtPools.get(t.mint).filter(p=>!p.created || p.created <= t1).slice(0,3);
  const supply = (gtPools.get(t.mint).find(p=>p.supply>0)||{}).supply || 0;
  const spanMin = (t1-t0)/60000;
  const [tf, agg, step] = spanMin <= 900 ? ['minute',1,60000] : spanMin <= 15000 ? ['minute',15,900000] : ['hour',4,14400000];
  const limit = Math.min(1000, Math.ceil((t1-t0)/step) + 2);
  let best = [];
  for(const p of list){
    if(!supply) break;
    const j = await gtGet(`/pools/${p.addr}/ohlcv/${tf}?aggregate=${agg}&before_timestamp=${Math.ceil(t1/1000)+60}&limit=${limit}&currency=usd&token=${t.mint}`);
    const c = (j?.data?.attributes?.ohlcv_list||[]).map(x=>x.map(Number))
      .filter(x=>x[0]*1000 >= t0-step && x[0]*1000 <= t1).sort((a,b)=>a[0]-b[0]);
    if(c.length > best.length) best = c;
    if(best.length >= 3) break;
  }
  if(!best.length){ bumpTries(t.id); return false; }
  const r2 = n => Math.round(n*supply*100)/100;
  const cs = best.slice(-400).map(c=>[c[0]*1000, r2(c[1]), r2(c[2]), r2(c[3]), r2(c[4])]);
  const chart = { v:2, src:'gt', i:step, w:[Math.min(t0, cs[0][0]), Math.max(t1, cs[cs.length-1][0]+step)], c:cs, m:marks.slice(0,20) };
  const { error } = await sb.from('trades').update({ chart }).eq('id', t.id).eq('user_id', session.user.id);
  if(error){ bumpTries(t.id); return false; }
  t.chart = parseChart(chart); return true;
}
async function buildChartsInBrowser(){
  if(chartQueueRunning || !session) return;
  chartQueueRunning = true;
  try{
    const todo = trades.filter(t=>(!t.chart || t.chart.v!==2) && t.mint && (!t.mint.endsWith('pump') || t.chartTries>=3) && t.timestamp < Date.now()-180000 && chartTries(t.id) < 3)
      .sort((a,b)=>b.timestamp-a.timestamp).slice(0, 40);
    let dirty = 0;
    while(todo.length){
      if(!session) break;
      const k = Math.max(0, todo.findIndex(x=>onScreen.has(x.id)));   // cards on screen first
      const t = todo.splice(k, 1)[0];
      if(t.chart && t.chart.v === 2) continue;                        // built meanwhile (card opened)
      try{ if(await buildOneInBrowser(t)){ dirty++; if(dirty % 4 === 0) renderAll(); } }
      catch(e){ bumpTries(t.id); if(String(e.message)==='429') break; }
    }
    if(dirty) renderAll();
  } finally { chartQueueRunning = false; }
}
/* ultra-fast charts: everything missing is requested as soon as the app opens, cards on screen first.
   pump.fun coins -> the server builds them in batches of 10 (second candles); other coins -> the browser queue. */
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
        let changed = 0;
        (rows||[]).forEach(r=>{ const t = trades.find(x=>x.id===r.id); if(!t) return; t.chartTries = Number(r.chart_tries)||0; const c = parseChart(r.chart); if(c){ t.chart = c; changed++; } });
        batch.forEach(t=>chartInFlight.delete(t.id));
        if(changed) renderAll();
        if(!data?.charts && !changed) break;                           // pump.fun is throttling: the browser fallback / cron will finish
      }catch(e){ batch.forEach(t=>chartInFlight.delete(t.id)); break; }
    }
  } finally { warmBusy = false; }
  buildChartsInBrowser();
}

/* opening a card whose candles are missing builds them right now, instead of waiting for the queue */
const chartInFlight = new Set();
async function ensureChart(t){
  if(!t.mint || (t.chart && t.chart.v === 2) || chartInFlight.has(t.id)) return;
  chartInFlight.add(t.id);
  let ok = false;
  try{
    if(t.mint.endsWith('pump')){                                       // second-level candles: the server reads pump.fun for this one trade
      const { data } = await sb.functions.invoke('sync-trades', { body:{ task:'chart', id:t.id } });
      if(data?.charts){
        const { data: row } = await sb.from('trades').select('chart').eq('id', t.id).maybeSingle();
        const c = parseChart(row?.chart); if(c){ t.chart = c; ok = true; }
      }
    }
    if(!ok) ok = await buildOneInBrowser(t);                           // any coin: minute candles from GeckoTerminal
  }catch(e){ /* keep the entry -> exit line */ }
  finally{ chartInFlight.delete(t.id); }
  if(ok){
    renderAll();
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
  b.classList.add('active'); activeFilter=b.dataset.f; renderGrid();
});
document.getElementById('sortSel').addEventListener('change', e=>{ sortMode=e.target.value; renderGrid(); });
document.getElementById('profileChip').addEventListener('click', ()=>goToView('account'));
document.getElementById('btnLogout').addEventListener('click', async ()=>{ await sb.auth.signOut(); location.reload(); });

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
function chartState(t){
  if(t.chart && t.chart.v === 2) return 'ready';
  if(!t.mint) return 'manual';
  if(chartInFlight.has(t.id)) return 'loading';
  return chartTries(t.id) < 3 ? 'loading' : 'none';
}
const fmtClock = ts => new Date(ts).toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
const fmtDelta = ms => { const s = Math.round(ms/1000); return s < 60 ? `+${s}s` : `+${Math.floor(s/60)}m ${s%60}s`; };
function openDetail(id, refresh){
  const t = trades.find(x=>x.id===id); if(!t) return;
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
  const fills = (t.chart?.src === 'pump' && t.chart.m?.length ? t.chart.m.map(m=>[m[0], m[1], m[2]])
               : t.legs?.length ? t.legs.map(l=>[+l[0], l[1], +l[2]])
               : [[opened,'b',t.entryMc],[t.timestamp,'s',t.exitMc]]).sort((a,b)=>a[0]-b[0]);
  const f0 = fills.length ? fills[0][0] : opened;
  const st = chartState(t);
  const note = st === 'ready' ? `Market cap · ${t.chart.i>=60000 ? (t.chart.i/60000)+' min' : (t.chart.i/1000)+' s'} candles · ${t.chart.src==='pump'?'every trade from pump.fun':'GeckoTerminal'}`
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
          ${t.pnlNet!=null ? row('Fees & costs', fmt.usd(-Math.abs(t.fees||0)), 'neg') + row('Net PnL (wallet)', fmt.usd(t.pnlNet), t.pnlNet>=0?'pos':'neg') : ''}
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
document.getElementById('btnSignUp').addEventListener('click', ()=>authAction(true, async ({email,password}, captchaToken)=>{
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
  await loginWithPubkey(pk, authNote);
});

async function reload(){
  idCounter = 0;
  [trades, deletedTrades] = await Promise.all([store.getTrades(), store.getDeleted()]);
  connectedAccounts = await store.getAccounts();
  goalTarget = await store.getGoal();
  renderAll();
}

async function showApp(){
  scrubUrl();
  document.getElementById('landing').hidden = true;
  document.getElementById('app').hidden = false;
  await reload();
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
  if(session){ if(!appShown){ appShown = true; showApp(); } }
  else { appShown = false; showLanding(); }
}
sb.auth.onAuthStateChange((event, sess)=>{
  if(event==='TOKEN_REFRESHED' || event==='USER_UPDATED'){ session = sess; return; }
  if(event==='PASSWORD_RECOVERY') setTimeout(()=>pwOverlay.classList.add('show'), 0);
  setTimeout(()=>onSession(sess), 0);   // never call supabase inside this callback (known deadlock)
});
sb.auth.getSession().then(({data})=>onSession(data.session));
