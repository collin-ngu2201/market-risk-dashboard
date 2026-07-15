"use strict";
/* ============ Dip Radar — shared engine ============
   Universe config, data layer (Netlify function batch proxy with public
   CORS-proxy fallback), dip/snapback math, and page renderers.
   All thresholds are volatility-normalized: dip depth is measured in units
   of each ticker's own 20-day daily volatility, so a 3% dip in a sleepy
   utility ETF can outrank an 8% dip in a leveraged fund. */

/* ---------------- universe ---------------- */
// Sector radar cards (shown on the dashboard) — ETF proxies per theme.
const RADAR = [
  ["NASA","Space Innovators","Space tech, satellites & launch companies"],
  ["UFO","Space (Satellites)","Satellite operators, launch providers & exploration"],
  ["USO","Crude Oil","US oil fund — WTI futures exposure"],
  ["XLV","Healthcare","Pharma, biotech, devices & hospital groups"],
  ["ARKK","Innovation/ARK","High-growth disruptive tech"],
  ["ITB","Homebuilders","US home construction & suppliers"],
  ["JETS","Airlines","US & global airline operators"],
  ["XOP","Oil & Gas Explor.","Exploration & production names"],
  ["QQQ","Nasdaq 100","Top 100 non-financial tech & growth stocks"],
  ["KRE","Regional Banks","US regional banking sector"],
  ["XLC","Comm. Services","Social media, telecom, gaming & streaming"],
  ["SPY","S&P 500","500 largest U.S. companies — the market benchmark"],
];
// Full scan universe: [ticker, display name]
const STOCKS = [
  ["AAPL","Apple"],["AMD","AMD"],["AMZN","Amazon"],["ARM","Arm Holdings"],
  ["ASTS","AST SpaceMobile"],["AVGO","Broadcom"],["BAC","Bank of America"],["CAT","Caterpillar"],
  ["COST","Costco"],["CSCO","Cisco"],["F","Ford"],["GE","GE Aerospace"],
  ["GM","General Motors"],["GS","Goldman Sachs"],["HOOD","Robinhood"],["INTC","Intel"],
  ["IONQ","IonQ"],["JPM","JPMorgan Chase"],["KO","Coca-Cola"],["KTOS","Kratos Defense"],
  ["LUNR","Intuitive Machines"],["MCD","McDonald's"],["META","Meta Platforms"],["MU","Micron"],
  ["NVDA","Nvidia"],["ORCL","Oracle"],["PFE","Pfizer"],["PGR","Progressive"],
  ["RBLX","Roblox"],["RDW","Redwire"],["RKLB","Rocket Lab"],["RTX","RTX Corp"],
  ["SHOP","Shopify"],["SOFI","SoFi"],["TSLA","Tesla"],["UBER","Uber"],
  ["V","Visa"],["WFC","Wells Fargo"],["WMT","Walmart"],["ZM","Zoom"],
];
const ETFS = [
  ["IWM","Russell 2000"],["GLD","SPDR Gold Shares"],["SLV","iShares Silver"],["GDX","Gold Miners"],
  ["XLE","Energy Select"],["XLF","Financial Select"],["XLU","Utilities Select"],["XLB","Materials Select"],
  ["XLI","Industrial Select"],["XLK","Technology Select"],
];
const LEVERAGED = [
  ["SOXL","Semis Bull 3X"],["SPXL","S&P 500 Bull 3X"],["TSLL","TSLA Bull 2X"],["GGLL","GOOGL Bull 2X"],
];
const NAMES = Object.fromEntries(
  [...RADAR.map(r=>[r[0],r[1]]), ...STOCKS, ...ETFS, ...LEVERAGED]);
const UNIVERSE = [...new Set([...RADAR.map(r=>r[0]), ...STOCKS.map(s=>s[0]),
  ...ETFS.map(s=>s[0]), ...LEVERAGED.map(s=>s[0])])];

/* ---------------- utilities ---------------- */
const $  = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const clamp=(v,a=0,b=100)=>Math.max(a,Math.min(b,v));
const fmtN=(v,d=2)=>v==null||isNaN(v)?'—':v.toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d});
const fmtPct=v=>v==null||isNaN(v)?'—':(v>=0?'+':'')+v.toFixed(v>=100||v<=-100?0:1)+'%';
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

/* ---------------- fetch layer ---------------- */
const PROXIES=[
  u=>'https://corsproxy.io/?url='+encodeURIComponent(u),
  u=>'https://api.allorigins.win/raw?url='+encodeURIComponent(u),
  u=>'https://api.codetabs.com/v1/proxy?quest='+encodeURIComponent(u),
];
let preferredProxy=+(localStorage.getItem('bdt.proxy')||0);
async function getText(url,{proxy=false,timeout=15000}={}){
  const attempts=proxy
    ?[...PROXIES.keys()].sort((a,b)=>(a===preferredProxy?-1:b===preferredProxy?1:a-b)).map(i=>({i,u:PROXIES[i](url)}))
    :[{i:-1,u:url}];
  let lastErr;
  for(const a of attempts){
    try{
      const res=await fetch(a.u,{signal:AbortSignal.timeout(timeout),cache:'no-store'});
      if(!res.ok) throw new Error('HTTP '+res.status);
      const txt=await res.text();
      if(!txt||txt.length<20) throw new Error('empty body');
      if(a.i>=0){preferredProxy=a.i;localStorage.setItem('bdt.proxy',a.i);}
      return txt;
    }catch(e){lastErr=e;}
  }
  throw lastErr||new Error('fetch failed');
}

let FN_MODE=false;
async function detectFunctions(){
  try{
    const r=await fetch('/api/health',{signal:AbortSignal.timeout(6000),cache:'no-store'});
    if(r.ok){const j=await r.json(); FN_MODE=!!(j&&j.ok);}
  }catch(e){}
}

const chunk=(arr,n)=>{const o=[];for(let i=0;i<arr.length;i+=n)o.push(arr.slice(i,i+n));return o;};

// Serverless path: /api/bdt fans out to Yahoo server-side, 17 symbols per call.
async function loadBatchFn(symbols){
  const out={};
  await Promise.all(chunk(symbols,17).map(async batch=>{
    const j=JSON.parse(await getText(`/api/bdt?symbols=${batch.join(',')}&range=6mo&interval=1d`));
    Object.assign(out,j);
  }));
  return out;
}
// Browser fallback: Yahoo spark batch endpoint via public CORS proxies (closes only).
async function loadBatchSpark(symbols){
  const out={};
  await Promise.all(chunk(symbols,17).map(async batch=>{
    const url=`https://query1.finance.yahoo.com/v8/finance/spark?symbols=${batch.join(',')}&range=6mo&interval=1d`;
    let j; try{ j=JSON.parse(await getText(url,{proxy:true})); }catch(e){ return; }
    const results=Array.isArray(j)?j:(j?.spark?.result||[]);
    for(const r of results){
      const sym=r.symbol, resp=(r.response&&r.response[0])||r;
      const ts=resp?.timestamp||[], cl=resp?.indicators?.quote?.[0]?.close||[];
      const meta=resp?.meta||{};
      const t=[],c=[];
      for(let i=0;i<ts.length;i++) if(cl[i]!=null){t.push(ts[i]);c.push(cl[i]);}
      if(c.length) out[sym]={t,c,h:null,l:null,price:meta.regularMarketPrice??c[c.length-1],
        prevClose:meta.chartPreviousClose??null,hi52:null,lo52:null,name:null};
    }
  }));
  return out;
}

const CKEY='bdt.cache.v1';
const cache=(()=>{try{return JSON.parse(localStorage.getItem(CKEY)||'{}');}catch(e){return{};}})();
function cachePut(k,data){cache[k]={t:Date.now(),data};try{localStorage.setItem(CKEY,JSON.stringify(cache));}catch(e){}}
function cacheGet(k,maxAgeMs=24*3600e3){const e=cache[k];return e&&(Date.now()-e.t)<maxAgeMs?e:null;}

/* ---------------- signal engine client ----------------
   /api/scan runs the throttled server-side scan (fire-and-forget kick);
   /api/signals returns its state: open trades, closed log, alerts feed.
   Tiers are earned per ticker from the completed record, matching the
   "tiers are earned, not assigned" rule: T5 APEX >=85% win rate,
   T4 PRIME 75-84, T3 LOCK 65-74, T2 SNAP 50-64, T1 COILED under 50%
   or fewer than 5 completed trades. */
const sig={configured:null,lastScan:0,open:{},closed:[],alerts:[]};
async function loadSignals(){
  if(!FN_MODE){sig.configured=false;return;}
  try{
    const r=await fetch('/api/signals',{signal:AbortSignal.timeout(10000),cache:'no-store'});
    const j=await r.json();
    sig.configured=!!j.configured;
    if(j.configured){sig.lastScan=j.lastScan||0;sig.open=j.open||{};sig.closed=j.closed||[];sig.alerts=j.alerts||[];}
  }catch(e){if(sig.configured==null)sig.configured=false;}
}
let lastKick=0;
function kickScan(){
  if(!FN_MODE||Date.now()-lastKick<5*60*1000)return;
  lastKick=Date.now();
  fetch('/api/scan',{cache:'no-store'}).catch(()=>{});
}
function tierFor(sym){
  const done=sig.closed.filter(c=>c.sym===sym);
  const wins=done.filter(c=>c.result==='win').length,n=done.length;
  const rate=n?wins/n*100:null;
  let t='T1 · COILED';
  if(n>=5&&rate>=85)t='T5 · APEX';
  else if(n>=5&&rate>=75)t='T4 · PRIME';
  else if(n>=5&&rate>=65)t='T3 · LOCK';
  else if(n>=5&&rate>=50)t='T2 · SNAP';
  return {tier:t,n,wins,losses:n-wins,rate};
}
const etTime=ts=>new Date(ts).toLocaleString('en-US',{timeZone:'America/New_York',
  month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
const etDayStr=ts=>new Date(ts).toLocaleDateString('en-CA',{timeZone:'America/New_York'});
function progressPct(tr){const cur=tr.cur??tr.entry;return clamp((cur-tr.entry)/(tr.tp-tr.entry)*100,0,100);}
function nearStop(tr){const cur=tr.cur??tr.entry;return cur<tr.entry&&(tr.entry-cur)/(tr.entry-tr.sl)>0.5;}
const gainPct=tr=>((tr.cur??tr.entry)/tr.entry-1)*100;
const ENGINE_NOTE='Signal engine storage is not connected yet — in the Vercel dashboard open the '
 +'dip-radar project → Storage → Create Database → Blob, connect it, then redeploy. Scans start automatically after that.';

/* ---------------- dip / snapback math ----------------
   d = depth of the current pullback below the 20-day closing high,
       measured in units of the ticker's own 20-day daily volatility.
   Dip state ladder (word always printed; meter fill = state index):
     d < 0.75            NO DIP
     0.75-1.75 falling   DIPPING     (pulling back)
     0.75-1.75 rising    EASING      (bouncing out of the dip)
     1.75-3.25           DIP ZONE    (buy-signal territory)
     >= 3.25             DEEP DIP
   Sector radar status ladder:
     DIP ZONE d>=1.75 · PRIMED 1.1-1.75 · WATCH 0.5-1.1 · EXTENDED <0.5
   Snapback readiness (0-100) blends depth, RSI oversold and recent pullback. */
function stdev(a){if(a.length<2)return null;const m=a.reduce((x,y)=>x+y,0)/a.length;
  return Math.sqrt(a.reduce((s,v)=>s+(v-m)*(v-m),0)/(a.length-1));}
function rsi14(closes){
  if(closes.length<15)return null;
  const c=closes.slice(-60);let g=0,l=0;
  for(let i=1;i<=14;i++){const d=c[i]-c[i-1];if(d>0)g+=d;else l-=d;}
  let ag=g/14,al=l/14;
  for(let i=15;i<c.length;i++){const d=c[i]-c[i-1];
    ag=(ag*13+(d>0?d:0))/14; al=(al*13+(d<0?-d:0))/14;}
  return al===0?100:100-100/(1+ag/al);
}
function analyze(q){
  if(!q||q.error||!q.c||q.c.length<25) return null;
  const c=q.c, n=c.length;
  const last=q.price??c[n-1];
  // if the meta price equals today's bar close, previous close is the bar before
  const prev=(q.prevClose!=null&&Math.abs(q.prevClose-last)/last>1e-6)?q.prevClose:c[n-2];
  const dayChg=prev?(last/prev-1)*100:null;
  const high20=Math.max(...c.slice(-20),last);
  const rets=[];for(let i=Math.max(1,n-20);i<n;i++)rets.push((c[i]/c[i-1]-1)*100);
  const vol20=Math.max(stdev(rets)??1,0.35);
  const offHigh=(last/high20-1)*100;          // ≤ 0
  const d=-offHigh/vol20;                     // sigma units below 20d high
  const rising=last>c[n-2];
  const chg5=n>=6?(last/c[n-6]-1)*100:null;
  const rsi=rsi14(c);
  let state;
  if(d<0.75) state='NO_DIP';
  else if(d>=3.25) state='DEEP_DIP';
  else if(d>=1.75) state='DIP_ZONE';
  else state=rising?'EASING':'DIPPING';
  const status=d>=1.75?'dipzone':d>=1.1?'primed':d>=0.5?'watch':'extended';
  const readiness=Math.round(clamp(
    55*Math.min(d/2.5,1)
   +30*clamp((55-(rsi??50))/30,0,1)
   +15*(chg5!=null&&chg5<0?Math.min(-chg5/(vol20*2.2),1):0)));
  return {last,dayChg,offHigh,d,state,status,readiness,rsi,chg5,rising,
    watching:d>=1.1,name:q.name};
}
const STATE_WORD={NO_DIP:'NO DIP',EASING:'EASING',DIPPING:'DIPPING',DIP_ZONE:'DIP ZONE',DEEP_DIP:'DEEP DIP'};
const STATE_SEGS={NO_DIP:0,EASING:2,DIPPING:3,DIP_ZONE:4,DEEP_DIP:5};
const STATUS_WORD={dipzone:'DIP ZONE',primed:'PRIMED',watch:'WATCH',extended:'EXTENDED'};
const readyColor=r=>r>=70?'var(--green)':r>=45?'var(--lime)':r>=25?'var(--yellow)':'var(--dim)';

/* ---------------- shared render helpers ---------------- */
function meterHTML(state){
  const on=STATE_SEGS[state]||0;
  let h='<div class="meter">';
  for(let i=1;i<=5;i++)h+=`<i class="${i<=on?'on s'+on:''}"></i>`;
  return h+'</div>';
}
function chgHTML(v){
  return `<span class="chg ${v==null?'flat':v>0.001?'up':v<-0.001?'down':'flat'}">${fmtPct(v)}</span>`;
}
function avatarHTML(sym){
  let hue=0;for(const ch of sym)hue=(hue*31+ch.charCodeAt(0))%360;
  return `<span class="avatar" style="background:hsl(${hue} 45% 18%);border-color:hsl(${hue} 45% 32%)">${esc(sym.slice(0,4))}</span>`;
}
function starfield(){
  const cv=$('#stars');if(!cv)return;
  const ctx=cv.getContext('2d');
  const draw=()=>{
    const w=cv.width=innerWidth,h=cv.height=innerHeight;
    ctx.clearRect(0,0,w,h);
    let seed=42;const rnd=()=>(seed=(seed*16807)%2147483647)/2147483647;
    const pts=[];
    for(let i=0;i<140;i++){
      const x=rnd()*w,y=rnd()*h,r=rnd()*1.3+.2;
      ctx.globalAlpha=.25+rnd()*.5;ctx.fillStyle='#cfe3ff';
      ctx.beginPath();ctx.arc(x,y,r,0,7);ctx.fill();
      if(i%14===0)pts.push([x,y]);
    }
    ctx.globalAlpha=.14;ctx.strokeStyle='#7fb4e8';ctx.lineWidth=1;
    ctx.beginPath();
    pts.slice(0,7).forEach((p,i)=>i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1]));
    ctx.stroke();ctx.globalAlpha=1;
  };
  draw();addEventListener('resize',draw);
}

/* ---------------- data orchestration ---------------- */
const state={quotes:null,analysis:{},lastScan:null};
async function loadUniverse(){
  let quotes=null,mode='live';
  try{
    quotes=FN_MODE?await loadBatchFn(UNIVERSE):await loadBatchSpark(UNIVERSE);
    if(!quotes||!Object.keys(quotes).length)throw new Error('no data');
    cachePut('universe',quotes);
  }catch(e){
    const c=cacheGet('universe');
    if(c){quotes=c.data;mode='stale';}
    else mode='err';
  }
  state.quotes=quotes||{};
  state.analysis={};
  let ok=0;
  for(const sym of UNIVERSE){
    const a=analyze(state.quotes[sym]);
    if(a){state.analysis[sym]=a;ok++;}
  }
  state.lastScan=new Date();
  return {mode,ok};
}

/* ---------------- sys box / clock ---------------- */
const REFRESH_MS=60000;
let nextRefresh=Date.now()+REFRESH_MS;
function tickSys(){
  const et=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',
    weekday:'short',hour:'numeric',minute:'numeric',hour12:false}).formatToParts(new Date()).map(x=>[x.type,x.value]));
  const mins=(+et.hour)*60+(+et.minute);
  const open=!['Sat','Sun'].includes(et.weekday)&&mins>=570&&mins<960;
  const el=$('#sysMkt');
  if(el){el.textContent=open?'MARKET OPEN':'MARKET CLOSED';el.className=open?'ok':'';}
  const ls=$('#sysLast');
  if(ls&&state.lastScan)ls.textContent=state.lastScan.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
  const ns=$('#sysNext');
  if(ns)ns.textContent=Math.max(0,Math.ceil((nextRefresh-Date.now())/1000))+'s';
}

/* ---------------- page: dashboard ---------------- */
function renderDashboard(){
  if(!$('#radarGrid'))return;
  const A=state.analysis;
  const inZone=UNIVERSE.filter(s=>A[s]&&(A[s].state==='DIP_ZONE'||A[s].state==='DEEP_DIP'));
  const openTr=Object.values(sig.open);
  const today=etDayStr(Date.now());
  const firedToday=sig.alerts.filter(a=>a.type==='entry'&&etDayStr(a.ts)===today).length;
  $('#tZone').textContent=inZone.length;
  if($('#tActive'))$('#tActive').textContent=sig.configured?openTr.length:'—';
  if($('#tToday'))$('#tToday').textContent=sig.configured?firedToday:'—';
  if($('#tDone'))$('#tDone').textContent=sig.configured?sig.closed.length:'—';

  // recent signals: live open trades, newest first
  const rs=$('#recentSigs');
  if(rs){
    if(sig.configured===false)rs.innerHTML=`<div class="note">${esc(ENGINE_NOTE)}</div>`;
    else if(!openTr.length)rs.innerHTML='<div class="note">No live signals — the engine scans every ~30 minutes during market hours.</div>';
    else rs.innerHTML=openTr.sort((a,b)=>b.firedAt-a.firedAt).slice(0,5).map(tr=>{
      const g=gainPct(tr),p=progressPct(tr);
      return `<div class="cand">${avatarHTML(tr.sym)}
        <div style="min-width:130px"><span class="tick">${tr.sym}</span> <span class="badge tier">${tierFor(tr.sym).tier}</span>
          <div class="nm">Entry $${fmtN(tr.entry,2)} → TP $${fmtN(tr.tp,2)} · SL $${fmtN(tr.sl,2)}</div></div>
        <div class="mid"><div class="rl" style="display:flex;justify-content:space-between;font-size:9.5px;letter-spacing:1.5px;color:var(--dim);text-transform:uppercase;margin-bottom:4px"><span>${Math.round(p)}% to target</span><b style="color:var(--muted)">${etTime(tr.firedAt)}</b></div>
          <div class="rbar"><i style="width:${p}%;background:var(--cyan)"></i></div></div>
        <div class="rt"><div class="px">${chgHTML(g)}</div><div class="sub">$${fmtN(tr.cur??tr.entry,2)} now</div></div>
      </div>`;}).join('');
  }

  // sector radar
  $('#radarGrid').innerHTML=RADAR.map(([sym,name,desc])=>{
    const a=A[sym];
    if(!a)return `<div class="sector"><div class="top">${avatarHTML(sym)}
      <div><div class="tick">${sym}</div><div class="nm">${esc(name)}</div>
      <div class="desc">${esc(desc)}</div></div>
      <span class="badge extended">NO DATA</span></div></div>`;
    return `<div class="sector st-${a.status}">
      <div class="top">${avatarHTML(sym)}
        <div><div class="tick">${sym}</div><div class="nm">${esc(name)}</div>
        <div class="desc">${esc(desc)}</div></div>
        <span class="badge ${a.status}">${STATUS_WORD[a.status]}</span></div>
      <div class="diprow">
        <span><span class="k">The Dip</span><span class="dipword dip-${a.state}">${STATE_WORD[a.state]}</span></span>
        ${chgHTML(a.dayChg)}
      </div>
      ${meterHTML(a.state)}
      <div class="offhi">${a.offHigh<=-0.05?fmtPct(a.offHigh)+' off recent high':'at recent high'}</div>
      <div class="ready"><div class="rl"><span>Snapback readiness</span><b>${a.readiness}%</b></div>
        <div class="rbar"><i style="width:${a.readiness}%;background:${readyColor(a.readiness)}"></i></div></div>
    </div>`;
  }).join('');

  const zoneSectors=RADAR.filter(([s])=>A[s]&&(A[s].state==='DIP_ZONE'||A[s].state==='DEEP_DIP')).map(([s])=>s);
  $('#radarCallout').innerHTML=zoneSectors.length
    ?`<b>${zoneSectors.join(', ')}</b> in the dip zone — these sectors are showing snapback territory right now.`
    :`No sector ETFs in the dip zone right now — the radar refreshes with each scan.`;
  $('#radarActive').textContent=RADAR.filter(([s])=>A[s]&&A[s].status!=='extended').length+' sectors active';

  // snapback candidates: deepest-readiness names at/near the dip zone
  const cands=UNIVERSE.filter(s=>A[s]&&A[s].d>=1.1)
    .sort((a,b)=>B(b)-B(a)).slice(0,6);
  function B(s){return A[s].readiness;}
  $('#candList').innerHTML=cands.length?cands.map(sym=>{
    const a=A[sym];
    return `<div class="cand">${avatarHTML(sym)}
      <div><div class="tick">${sym}</div><div class="nm">${esc(NAMES[sym]||a.name||'')}</div></div>
      <div class="mid"><div class="rl" style="display:flex;justify-content:space-between;font-size:9.5px;letter-spacing:1.5px;color:var(--dim);text-transform:uppercase;margin-bottom:4px"><span>Readiness</span><b style="color:var(--muted)">${a.readiness}%</b></div>
        <div class="rbar"><i style="width:${a.readiness}%;background:${readyColor(a.readiness)}"></i></div></div>
      <div class="rt"><div class="px">$${fmtN(a.last,2)}</div>
        <div class="sub"><span class="dipword dip-${a.state}" style="font-size:10px">${STATE_WORD[a.state]}</span> · ${fmtPct(a.offHigh)} off high</div></div>
    </div>`;
  }).join(''):'<div class="note">Nothing at or near the dip zone right now.</div>';
}

/* ---------------- page: watchlist ---------------- */
let wlFilter=localStorage.getItem('bdt.wl.filter')||'all', wlQuery='';
function renderWatchlist(){
  if(!$('#wlGrid'))return;
  const A=state.analysis;
  const rows=UNIVERSE.filter(s=>A[s]).sort((x,y)=>A[y].readiness-A[x].readiness);
  const zone=rows.filter(s=>A[s].state==='DIP_ZONE'||A[s].state==='DEEP_DIP');
  const watch=rows.filter(s=>A[s].watching);
  $('#nZone').textContent=zone.length;
  $('#nWatch').textContent=watch.length;
  $('#wlCount').textContent=rows.length+' MONITORED TARGETS · SORTED BY SNAPBACK READINESS';
  let list=wlFilter==='zone'?zone:wlFilter==='watch'?watch:rows;
  if(wlQuery)list=list.filter(s=>s.includes(wlQuery)||(NAMES[s]||'').toUpperCase().includes(wlQuery));
  $$('.wl-tabs button').forEach(b=>b.classList.toggle('active',b.dataset.f===wlFilter));
  $('#wlGrid').innerHTML=list.length?list.map(sym=>{
    const a=A[sym];
    const t=tierFor(sym);
    const active=!!sig.open[sym];
    const cls=active?'dipzone':a.state==='DIP_ZONE'||a.state==='DEEP_DIP'?'dipzone':a.watching?'watching':'';
    const statusBadge=active?'<span class="badge dipzone">● ACTIVE</span>'
      :`<span class="badge ${a.watching?'watching':'none'}">${a.watching?'● WATCHING':'○ NONE'}</span>`;
    return `<div class="wcard ${cls}">
      <div class="top">${avatarHTML(sym)}
        <div><span class="tick">${sym}</span> <span class="badge tier" title="Tiers are earned from the ticker's completed trade record (needs 5 finished trades to rank above Coiled)">${t.tier}</span>
          <div class="nm">${esc(NAMES[sym]||a.name||'')}</div></div>
        ${statusBadge}</div>
      <div class="cols">
        <div><span class="k">Price</span><span class="px">$${fmtN(a.last,2)}</span><br>${chgHTML(a.dayChg)}</div>
        <div><span class="k">The Dip</span><span class="dipword dip-${a.state}">${STATE_WORD[a.state]}</span>
          ${meterHTML(a.state)}
          <span class="note" style="font-size:9.5px">${fmtPct(a.offHigh)} off 20d high · RSI ${a.rsi==null?'—':Math.round(a.rsi)}</span></div>
        <div class="rt">${a.readiness}%<span class="sub">readiness</span>
          <span class="sub" style="margin-top:4px">${t.n?`win rate ${Math.round(t.rate)}%<br>${t.wins}W ${t.losses}L`:'win rate —<br>no trades yet'}</span></div>
      </div>
    </div>`;
  }).join(''):'<div class="note">No tickers match.</div>';
}
function wireWatchlist(){
  if(!$('#wlGrid'))return;
  $$('.wl-tabs button').forEach(b=>b.addEventListener('click',()=>{
    wlFilter=b.dataset.f;localStorage.setItem('bdt.wl.filter',wlFilter);renderWatchlist();
  }));
  $('#wlSearch').addEventListener('input',e=>{wlQuery=e.target.value.trim().toUpperCase();renderWatchlist();});
}

/* ---------------- page: setups ---------------- */
let suFilter=localStorage.getItem('bdt.su.filter')||'best';
function tradeCardHTML(tr,closed){
  const t=tierFor(tr.sym);
  const g=closed?tr.pct:gainPct(tr);
  const p=closed?(tr.result==='win'?100:0):progressPct(tr);
  const cur=closed?tr.exit:(tr.cur??tr.entry);
  const resBadge=closed
    ?`<span class="badge ${tr.result==='win'?'dipzone':'stopped'}">${tr.result==='win'?'✓ TARGET HIT':'✕ STOPPED OUT'}</span>`
    :'<span class="badge live">⚡ LIVE</span>';
  return `<div class="trade ${closed?tr.result:'active'}">
    <div class="thead">
      <div><span class="badge buy">BUY</span> <span class="badge tier">${t.tier}</span> <span class="badge shares">SHARES</span>
        <div class="tsym">${avatarHTML(tr.sym)} <b>${tr.sym}</b> <span class="nm">${esc(NAMES[tr.sym]||'')}</span></div></div>
      <div class="tgain">${resBadge}<div class="big ${g>=0?'chg up':'chg down'}" style="background:none">${fmtPct(g)}</div>
        <div class="sub">${closed?'closed '+etTime(tr.closedAt):'stock gain'}</div></div>
    </div>
    <div class="pxgrid">
      <div><span class="k">Entry price</span><b>$${fmtN(tr.entry,2)}</b><span class="sub">${etTime(tr.firedAt)}</span></div>
      <div><span class="k">${closed?'Exit price':'Current price'}</span><b>$${fmtN(cur,2)}</b></div>
      <div class="slbox"><span class="k">Stop loss</span><b>$${fmtN(tr.sl,2)}</b></div>
      <div class="tpbox"><span class="k">Target</span><b>$${fmtN(tr.tp,2)}</b></div>
    </div>
    <div class="prog"><div class="pl">${Math.round(p)}% of the way to target</div>
      <div class="rbar" style="height:9px"><i style="width:${p}%;background:${closed&&tr.result==='loss'?'var(--red)':'var(--cyan)'}"></i></div></div>
  </div>`;
}
function renderSetups(){
  if(!$('#suList'))return;
  if(sig.configured===false){$('#suList').innerHTML=`<div class="note">${esc(ENGINE_NOTE)}</div>`;$('#suCount').textContent='ENGINE NOT CONFIGURED';return;}
  const open=Object.values(sig.open).sort((a,b)=>progressPct(b)-progressPct(a));
  const won=sig.closed.filter(c=>c.result==='win');
  const lost=sig.closed.filter(c=>c.result==='loss');
  $('#nActive').textContent=open.length;$('#nWon').textContent=won.length;$('#nLost').textContent=lost.length;
  $('#suCount').textContent=(open.length+sig.closed.length)+' TOTAL · '+won.length+'W '+lost.length+'L';
  $$('.wl-tabs button').forEach(b=>b.classList.toggle('active',b.dataset.f===suFilter));
  const note=$('#suNote');
  if(note)note.style.display=suFilter==='best'?'block':'none';
  let html='';
  if(suFilter==='best')html=open.filter(tr=>!nearStop(tr)).slice(0,5).map(tr=>tradeCardHTML(tr,false)).join('');
  else if(suFilter==='active')html=open.map(tr=>tradeCardHTML(tr,false)).join('');
  else if(suFilter==='won')html=won.map(tr=>tradeCardHTML(tr,true)).join('');
  else if(suFilter==='lost')html=lost.map(tr=>tradeCardHTML(tr,true)).join('');
  else html=[...open.map(tr=>tradeCardHTML(tr,false)),...sig.closed.map(tr=>tradeCardHTML(tr,true))].join('');
  $('#suList').innerHTML=html||'<div class="note">Nothing here yet — signals appear when the engine confirms all 4 conditions during market hours.</div>';
}
function wireSetups(){
  if(!$('#suList'))return;
  $$('.wl-tabs button').forEach(b=>b.addEventListener('click',()=>{
    suFilter=b.dataset.f;localStorage.setItem('bdt.su.filter',suFilter);renderSetups();
  }));
}

/* ---------------- page: alerts ---------------- */
function renderAlertsPage(){
  if(!$('#alList'))return;
  if(sig.configured===false){$('#alList').innerHTML=`<div class="note">${esc(ENGINE_NOTE)}</div>`;return;}
  if(!sig.alerts.length){$('#alList').innerHTML='<div class="note">No alerts yet — new setups, target hits and stop-outs land here as they happen.</div>';return;}
  const BADGE={entry:['live','⚡ NEW SETUP'],win:['dipzone','◎ HIT TARGET'],loss:['stopped','✕ STOPPED OUT']};
  $('#alList').innerHTML=sig.alerts.map(a=>{
    const [cls,word]=BADGE[a.type]||['none',a.type.toUpperCase()];
    return `<div class="alrow ${a.type}">${avatarHTML(a.sym)}
      <div class="amain"><div><b class="tick">${a.sym}</b> <span class="badge ${cls}">${word}</span></div>
        <div class="sub">$${fmtN(a.price,2)} · ${etTime(a.ts)}</div>
        <div class="amsg">${esc(a.msg||'')}</div></div>
      ${a.pct!=null?`<div class="rt">${chgHTML(a.pct)}</div>`:''}
    </div>`;
  }).join('');
}

/* ---------------- page: performance ----------------
   Aggregates every completed trade (backtested + live) into headline stats,
   an equity curve, monthly bars and a per-ticker table. Backtest trades are
   tagged bt:1; a first visit with an empty log kicks /api/backtest to seed. */
function tradeStats(list){
  const n=list.length, wins=list.filter(t=>t.result==='win'), losses=list.filter(t=>t.result==='loss');
  const sum=a=>a.reduce((s,t)=>s+(t.pct||0),0);
  const grossWin=sum(wins), grossLoss=Math.abs(sum(losses));
  return {n,w:wins.length,l:losses.length,
    winRate:n?wins.length/n*100:null,
    expectancy:n?sum(list)/n:null,
    avgWin:wins.length?grossWin/wins.length:null,
    avgLoss:losses.length?-grossLoss/losses.length:null,
    profitFactor:grossLoss>0?grossWin/grossLoss:(grossWin>0?Infinity:null),
    net:sum(list)};
}
let btKicked=false;
function kickBacktest(){
  if(!FN_MODE||btKicked)return;btKicked=true;
  fetch('/api/backtest',{cache:'no-store'}).then(r=>r.json()).then(()=>{
    setTimeout(()=>loadSignals().then(()=>{renderPerformance();renderWatchlist();renderSetups();renderDashboard();}),1200);
  }).catch(()=>{});
}
function renderPerformance(){
  if(!$('#perfBody'))return;
  if(sig.configured===false){$('#perfBody').innerHTML=`<div class="note">${esc(ENGINE_NOTE)}</div>`;return;}
  const closed=sig.closed||[];
  if(!closed.length){
    $('#perfBody').innerHTML='<div class="note">No completed trades yet — seeding the historical backtest now, this can take a few seconds. '
      +'<button id="btRun" style="margin-left:8px">Run backtest</button></div>';
    const b=$('#btRun');if(b)b.addEventListener('click',()=>{btKicked=false;kickBacktest();});
    kickBacktest();
    return;
  }
  const S=tradeStats(closed);
  const btN=closed.filter(t=>t.bt).length, liveN=closed.length-btN;
  const pf=S.profitFactor==null?'—':S.profitFactor===Infinity?'∞':S.profitFactor.toFixed(2);
  const tiles=[
    ['Win Rate',S.winRate==null?'—':Math.round(S.winRate)+'%',`${S.w}W · ${S.l}L`,S.winRate>=55?'green':S.winRate>=45?'yellow':'cyan'],
    ['Expectancy',S.expectancy==null?'—':(S.expectancy>=0?'+':'')+S.expectancy.toFixed(2)+'%','avg per trade',S.expectancy>=0?'green':'cyan'],
    ['Profit Factor',pf,'gross win ÷ loss','cyan'],
    ['Total Trades',String(S.n),`${btN} backtested · ${liveN} live`,'yellow'],
  ];
  // equity curve (cumulative % over chronological trades)
  const chrono=[...closed].sort((a,b)=>a.closedAt-b.closedAt);
  let cum=0;const eq=chrono.map(t=>(cum+=t.pct||0));
  // monthly net %
  const months={};
  for(const t of chrono){const d=new Date(t.closedAt),k=d.toLocaleString('en-US',{timeZone:'America/New_York',month:'short',year:'2-digit'});
    (months[k]=months[k]||{net:0,w:0,n:0}); months[k].net+=t.pct||0; months[k].n++; if(t.result==='win')months[k].w++;}
  const mk=Object.keys(months);
  // per-ticker
  const bySym={};
  for(const t of closed){(bySym[t.sym]=bySym[t.sym]||[]).push(t);}
  const rows=Object.entries(bySym).map(([sym,l])=>({sym,...tradeStats(l),tier:tierFor(sym).tier}))
    .sort((a,b)=>(b.winRate-a.winRate)||(b.n-a.n));

  $('#perfBody').innerHTML=`
    <section class="tiles">${tiles.map(([l,v,c,cl])=>`
      <div class="tile ${cl}"><div class="lbl">${l}</div><div class="val">${v}</div><div class="cap">${c}</div></div>`).join('')}</section>
    <section class="card" style="margin-bottom:16px"><h3>Equity Curve <span class="sub">· cumulative % across ${chrono.length} trades (1 unit per trade)</span></h3>
      ${equitySVG(eq)}</section>
    <section class="card" style="margin-bottom:16px"><h3>Monthly Net <span class="sub">· sum of trade returns by close month</span></h3>
      ${monthlySVG(mk.map(k=>({k,...months[k]})))}</section>
    <section class="card"><h3>By Ticker <span class="sub">· win rate across completed trades · tier is earned from this record</span></h3>
      <div class="perf-grid">
        <div class="ph">Ticker</div><div class="ph">Tier</div><div class="ph">Trades</div><div class="ph">Win rate</div><div class="ph">Avg / trade</div><div class="ph">Net</div>
        ${rows.map(r=>`
          <div class="pc"><b>${r.sym}</b> <span class="sub">${esc(NAMES[r.sym]||'')}</span></div>
          <div class="pc"><span class="badge tier">${r.tier}</span></div>
          <div class="pc">${r.w}W ${r.l}L</div>
          <div class="pc"><div class="wbar"><i style="width:${Math.round(r.winRate)}%;background:${r.winRate>=55?'var(--green)':r.winRate>=45?'var(--yellow)':'var(--orange)'}"></i></div><span class="wpct">${Math.round(r.winRate)}%</span></div>
          <div class="pc ${r.expectancy>=0?'up':'down'}" style="font-weight:700">${(r.expectancy>=0?'+':'')+r.expectancy.toFixed(2)}%</div>
          <div class="pc ${r.net>=0?'up':'down'}" style="font-weight:700">${(r.net>=0?'+':'')+r.net.toFixed(1)}%</div>`).join('')}
      </div></section>`;
}
function equitySVG(eq){
  if(eq.length<2)return '<div class="note">Not enough trades for a curve yet.</div>';
  const W=900,H=180,P=8,min=Math.min(0,...eq),max=Math.max(0,...eq),span=(max-min)||1;
  const X=i=>P+i/(eq.length-1)*(W-2*P),Y=v=>H-P-((v-min)/span)*(H-2*P);
  const d=eq.map((v,i)=>(i?'L':'M')+X(i).toFixed(1)+' '+Y(v).toFixed(1)).join(' ');
  const up=eq[eq.length-1]>=0;const col=up?'var(--green)':'var(--red)';
  const zeroY=Y(0);
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="none" style="max-height:180px">
    <line x1="${P}" y1="${zeroY}" x2="${W-P}" y2="${zeroY}" stroke="var(--border2)" stroke-dasharray="4 4"/>
    <path d="${d} L ${X(eq.length-1)} ${zeroY} L ${X(0)} ${zeroY} Z" fill="${col}" opacity=".10"/>
    <path d="${d}" fill="none" stroke="${col}" stroke-width="2"/></svg>
    <div class="kv sub" style="display:flex;justify-content:space-between"><span>start</span><span>net ${up?'+':''}${eq[eq.length-1].toFixed(1)}%</span></div>`;
}
function monthlySVG(rows){
  if(!rows.length)return '<div class="note">No monthly data yet.</div>';
  const max=Math.max(1,...rows.map(r=>Math.abs(r.net)));
  return `<div class="mrow">${rows.map(r=>{
    const h=Math.max(2,Math.abs(r.net)/max*70),pos=r.net>=0;
    return `<div class="mbar" title="${r.k}: ${pos?'+':''}${r.net.toFixed(1)}% · ${r.w}/${r.n} wins">
      <div class="mb-top">${pos?`<i class="up" style="height:${h}px"></i>`:''}</div>
      <div class="mb-bot">${!pos?`<i class="down" style="height:${h}px"></i>`:''}</div>
      <span class="ml">${r.k}</span></div>`;}).join('')}</div>`;
}

/* ---------------- boot ---------------- */
let refreshing=false;
async function refreshAll(){
  if(refreshing)return;refreshing=true;
  const btn=$('#btnRefresh');if(btn){btn.disabled=true;btn.textContent='SCANNING…';}
  kickScan();
  const [{mode,ok}]=await Promise.all([loadUniverse(),loadSignals()]);
  const dot=$('#scanDot');
  if(dot)dot.className='dot '+(mode==='live'?'live':mode==='stale'?'stale':'err');
  const en=$('#errNote');
  if(en){
    if(mode==='err'){en.style.display='block';en.textContent='⚠ Data sources unreachable this cycle and no cache available yet. Deployed (Vercel/Netlify) this uses the site’s own /api/bdt function; as a local file it falls back to public CORS proxies.';}
    else if(ok<UNIVERSE.length&&mode==='live'){en.style.display='block';en.textContent=`⚠ ${UNIVERSE.length-ok} of ${UNIVERSE.length} tickers failed to load this cycle.`;}
    else en.style.display='none';
  }
  renderDashboard();renderWatchlist();renderSetups();renderAlertsPage();renderPerformance();
  if(btn){btn.disabled=false;btn.textContent='⟳ RESCAN';}
  nextRefresh=Date.now()+REFRESH_MS;
  refreshing=false;
}
document.addEventListener('DOMContentLoaded',async()=>{
  starfield();
  wireWatchlist();wireSetups();
  const btn=$('#btnRefresh');if(btn)btn.addEventListener('click',refreshAll);
  setInterval(()=>{tickSys();if(Date.now()>=nextRefresh&&!document.hidden)refreshAll();},1000);
  tickSys();
  await detectFunctions();
  refreshAll();
});
