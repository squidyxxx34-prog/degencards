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
    return data.filter(r=>UUID_RE.test(String(r.id))).map(r=>({ id:String(r.id), tradeId:num(r.trade_id,0,1e9), ticker:cleanTicker(r.ticker)||'UNKNOWN', pnl:num(r.pnl,-1e12,1e12), roi:num(r.roi,-100,1e7), entryMc:num(r.entry_mc,0,1e15), exitMc:num(r.exit_mc,0,1e15), holdTime:num(r.hold_time,0,31536000), timestamp:num(r.timestamp_ms,0,4102444800000), source: SOURCES.includes(r.source)?r.source:'manual' }));
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
    const {data,error} = await sb.from('connected_accounts').select('provider,handle,last_synced_at,sync_error');
    if(error){ console.error('accounts load failed'); return []; }
    return data.filter(a=>['pumpfun','fomo','wallet'].includes(a.provider)).map(a=>({
      provider:a.provider, handle:String(a.handle).slice(0,120),
      syncedAt: a.last_synced_at ? Date.parse(a.last_synced_at) : 0, error: a.sync_error ? String(a.sync_error).slice(0,120) : ''
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
  mc(n){ if(n>=1000) return "$"+(n/1000).toFixed(1)+"K"; return "$"+n; },
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
function miniChart(pnl){
  const up = pnl>=0;
  const pts = up ? [40,32,34,20,24,8] : [10,16,12,26,22,34];
  const path = pts.map((y,i)=>`${i===0?'M':'L'}${i*40},${y}`).join(' ');
  const c = up ? 'var(--green)' : 'var(--red)';
  return `<svg width="100%" height="42" viewBox="0 0 200 42" preserveAspectRatio="none"><path d="${path}" fill="none" stroke="${c}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" opacity=".85"/></svg>`;
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
    <div class="ticker">${esc(t.ticker)}</div>
    <div class="pnl ${win?'pos':'neg'}">${fmt.usd(t.pnl)}</div>
    <div class="roi ${win?'pos':'neg'}">${fmt.pct(t.roi)}</div>
    <div class="mini">${miniChart(t.pnl)}</div>
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
function renderAchievements(){
  const unlocked = unlockedAchievementKeys();
  document.getElementById('achCount').textContent = unlocked.size;
  document.getElementById('achTotal').textContent = ACH_CATALOG.length;
  document.getElementById('achAll').innerHTML = ACH_CATALOG.map(a=>{
    const has = unlocked.has(a.key);
    return `<div class="achitem" style="opacity:${has?1:.4}"><span style="color:var(--purple)">${icon(a.icon,18)}</span><div><b>${a.name}</b><br><span>${a.desc}</span></div></div>`;
  }).join('');
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
    let status = p.sub;
    if(acc){
      const addr = acc.handle.length>20 ? acc.handle.slice(0,6)+'…'+acc.handle.slice(-4) : acc.handle;
      const st = acc.error ? `<span class="sync-err">Sync issue — retrying</span>`
        : acc.syncedAt ? `synced ${ago(acc.syncedAt)}` : 'first sync in progress…';
      status = `${esc(addr)} · ${st}`;
    }
    return `<div class="provider-row">
      <div><div class="provider-name">${p.name}</div><div class="provider-sub">${status}</div></div>
      ${acc ? `<button class="btn-connect connected" data-sync="${p.key}">SYNC</button><button class="btn-unlink" data-unlink="${p.key}" aria-label="Disconnect">${icon('x',14)}</button>`
            : `<button class="btn-connect" data-p="${p.key}">CONNECT</button>`}
    </div>`;
  }).join('');
  const list = document.getElementById('providerList');
  list.querySelectorAll('[data-p]').forEach(b=>b.addEventListener('click', ()=>connectProvider(b.dataset.p)));
  list.querySelectorAll('[data-sync]').forEach(b=>b.addEventListener('click', ()=>syncNow(true)));
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
      <td style="padding:9px 12px; font-weight:700;">${esc(t.ticker)}</td>
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
        <span class="bin-tk">${esc(t.ticker)}</span>
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
    if(n) showToast(`${n} new trade card${n>1?'s':''} imported`);
    else if(manual) showToast(data?.pending ? 'Still catching up on history — more cards soon' : (data?.synced ? 'Up to date' : 'Synced less than a minute ago'));
    if(data?.pending && before !== trades.length) setTimeout(()=>syncNow(false), 15000);
  }catch(e){ if(manual) showToast('Sync failed — it will retry automatically'); }
  finally{ syncing = false; }
}
function maybeAutoSync(){
  const stale = connectedAccounts.some(a=>!a.syncedAt || Date.now()-a.syncedAt > 10*60*1000);
  if(stale) syncNow(false);
}

let importing = false;
async function connectProvider(key){
  if(importing) return;
  const p = PROVIDERS.find(x=>x.key===key);
  const raw = prompt(`${p.name} — paste the PUBLIC address of your ${key==='wallet'?'Solana wallet':p.name+' wallet'}.\nNever your seed phrase or private key.`);
  if(!raw) return;
  const handle = raw.trim();
  if(!B58.test(handle)){ showToast("That doesn't look like a Solana address"); return; }
  importing = true;
  try{
    if(!await store.connectAccount(key, handle)){ showToast('Could not connect — try again'); return; }
    await reload();
    showToast('Connected — importing the last 30 days...');
    await syncNow(false);
  } finally { importing = false; }
}

document.getElementById('levelBar').addEventListener('click', ()=>{
  const d = document.getElementById('lvlDetail'), open = d.hidden;
  d.hidden = !open; document.getElementById('levelBar').setAttribute('aria-expanded', String(open));
});

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
function openDetail(id){
  const t = trades.find(x=>x.id===id); if(!t) return;
  const meta = generateTradeCard(t, trades);
  const win = t.pnl>=0;
  document.getElementById('detailBody').innerHTML = `
    <div style="font-family:var(--mono);font-size:11px;color:var(--tx2)">TRADE #${String(t.tradeId).padStart(4,'0')} · ${meta.rarity.toUpperCase()}</div>
    <div style="font-weight:800;font-size:22px;margin-top:6px">${esc(t.ticker)}</div>
    <div class="${win?'pos':'neg'}" style="font-size:30px;font-weight:900;font-family:var(--mono);margin-top:4px">${fmt.usd(t.pnl)}</div>
    <div class="${win?'pos':'neg'}" style="font-weight:700;font-family:var(--mono)">${fmt.pct(t.roi)}</div>
    ${miniChart(t.pnl)}
    <div class="detail-stats">
      <div><div class="l">Entry MC</div><div class="v">${fmt.mc(t.entryMc)}</div></div>
      <div><div class="l">Exit MC</div><div class="v">${fmt.mc(t.exitMc)}</div></div>
      <div><div class="l">Hold time</div><div class="v">${fmt.hold(t.holdTime)}</div></div>
      <div><div class="l">Date</div><div class="v" style="font-size:11px">${fmt.date(t.timestamp)}</div></div>
    </div>
    ${meta.achievements.length?`<div class="preview-label">ACHIEVEMENTS</div><div class="achlist">${meta.achievements.map(a=>`<div class="achitem"><span style="color:var(--purple)">${icon(a.icon,18)}</span><div><b>${a.name}</b><br><span>${a.desc}</span></div></div>`).join('')}</div>`:''}
    <button class="share-btn" id="btnShare">SHARE CARD</button>
  `;
  document.getElementById('btnShare').addEventListener('click', ()=>shareCard(t, meta));
  detailOverlay.classList.add('show');
}

/* ---------- share ---------- */
function drawCardCanvas(t, meta){
  const c = document.createElement('canvas'); c.width=600; c.height=840;
  const ctx = c.getContext('2d');
  const win = t.pnl>=0;
  const rarityHex = {common:'#ADADB8',uncommon:'#3DFFA0',rare:'#6EC0FF',epic:'#C09EFF',legendary:'#FFD35C',mythic:'#ff5adc'}[meta.rarity];
  ctx.fillStyle = '#07070A'; ctx.fillRect(0,0,600,840);
  const grad = ctx.createRadialGradient(180,80,20,180,80,500);
  grad.addColorStop(0, meta.color.glow); grad.addColorStop(1,'rgba(0,0,0,0)');
  ctx.fillStyle = grad; ctx.fillRect(0,0,600,840);
  ctx.strokeStyle = meta.color.border; ctx.lineWidth=4; ctx.strokeRect(10,10,580,820);
  ctx.fillStyle = rarityHex; ctx.font='700 20px sans-serif'; ctx.textAlign='right';
  ctx.fillText(meta.rarity.toUpperCase(), 560, 60);
  ctx.textAlign='left'; ctx.fillStyle='#ADADB8'; ctx.font='600 20px monospace';
  ctx.fillText('#'+String(t.tradeId).padStart(4,'0'), 40, 60);
  ctx.textAlign='center'; ctx.fillStyle='#ADADB8'; ctx.font='700 32px sans-serif';
  ctx.fillText(t.ticker, 300, 160);
  ctx.fillStyle = win?'#3DFFA0':'#FF5C6C'; ctx.font='900 84px monospace';
  ctx.fillText(fmt.usd(t.pnl), 300, 280);
  ctx.font='700 40px monospace';
  ctx.fillText(fmt.pct(t.roi), 300, 335);
  ctx.fillStyle='#ADADB8'; ctx.font='600 24px monospace';
  ctx.fillText(fmt.hold(t.holdTime)+'  ·  Grade '+meta.grade, 300, 400);
  if(meta.achievements.length){
    ctx.font='600 22px sans-serif'; ctx.fillStyle='#FFFFFF';
    ctx.fillText(meta.achievements.slice(0,3).map(a=>a.name).join('   ·   '), 300, 460);
  }
  ctx.fillStyle='#C09EFF'; ctx.font='900 34px sans-serif';
  ctx.fillText('DEGENCARDS', 300, 780);
  return c;
}
async function shareCard(t, meta){
  const caption = `Look at my trade! ${t.ticker} ${fmt.pct(t.roi)} (${fmt.usd(t.pnl)}) — Collect yours on DEGENCARDS`;
  const canvas = drawCardCanvas(t, meta);
  canvas.toBlob(async (blob)=>{
    if(!blob){ showToast("Couldn't build the image"); return; }
    const safeName = (t.ticker.replace(/[^A-Za-z0-9_-]/g,'') || 'card');
    const file = new File([blob], `degencards-${safeName}.png`, {type:'image/png'});
    if(navigator.share && navigator.canShare && navigator.canShare({files:[file]})){
      try{ await navigator.share({files:[file], text:caption}); return; }
      catch(e){ if(e && e.name==='AbortError') return; }   // user closed the share sheet: do nothing
    }
    try{ await navigator.clipboard.writeText(caption); }catch(e){}
    // desktop fallback: download the PNG
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = file.name; a.rel = 'noopener';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(()=>URL.revokeObjectURL(url), 4000);
    showToast('Caption copied · image downloaded');
  }, 'image/png');
}
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
