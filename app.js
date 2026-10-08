(function(){
"use strict";
/* Swing Desk app. Paper trading only. Live prices are informational; the official ledger is data.json. */
const APP_VERSION='e378850c7d';
const CAL={"holidays": ["2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25", "2026-06-19", "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25", "2027-01-01", "2027-01-18", "2027-02-15", "2027-03-26", "2027-05-31", "2027-06-18", "2027-07-05", "2027-09-06", "2027-11-25", "2027-12-24", "2028-01-17", "2028-02-21", "2028-04-14", "2028-05-29", "2028-06-19", "2028-07-04", "2028-09-04", "2028-11-23", "2028-12-25"], "early_close": {"2026-11-27": "13:00", "2026-12-24": "13:00", "2027-11-26": "13:00", "2028-07-03": "13:00", "2028-11-24": "13:00"}, "session": {"open": "09:30", "close": "16:00", "tz": "America/New_York"}, "source": "NYSE Group holiday and early closings calendar 2026-2028 (nyse.com/trade/hours-calendars)"};
const qs=new URLSearchParams(location.search);
const STATIC=qs.has('static')||matchMedia('(prefers-reduced-motion: reduce)').matches;
if(STATIC)document.body.classList.add('static');
const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>[...r.querySelectorAll(s)];
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const n=(x,dp=2)=>x==null||isNaN(x)?'n/a':Number(x).toLocaleString('en-US',{minimumFractionDigits:dp,maximumFractionDigits:dp});
const usd=(x,dp=0)=>x==null?'n/a':(x<0?'-':'')+'$'+n(Math.abs(x),dp);
const susd=(x,dp=0)=>x==null?'n/a':(x>0?'+':x<0?'-':'')+'$'+n(Math.abs(x),dp);
const pct=(x,dp=2)=>{if(x==null||isNaN(x))return 'n/a';const r=Math.round(x*10**dp)/10**dp;return (r>0?'+':'')+n(r===0?0:r,dp)+'%'};
const cls=x=>x>0?'pos':x<0?'neg':'mute';
const MON=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const dshort=s=>{if(!s)return'';const m=String(s).match(/(\d{4})-(\d\d)-(\d\d)(?:[ T](\d\d:\d\d))?/);return m?`${MON[+m[2]-1]} ${+m[3]}${m[4]?', '+m[4]:''}`:s};
const daysTo=s=>{if(!s)return null;const t=new Date(s.slice(0,10)+'T12:00:00');return Math.round((t-new Date())/864e5)};
const BOOKN={main:'Main',shadow:'Shadow',mambo:'Mambo'};
let D=null,T=[],TECH={},ACC={},FILLS=[],RECS=[];
const state={acct:qs.get('acct')||'main',recs:qs.get('recs')||'main'};
function setData(d){D=d;T=D.trades||[];TECH=D.technicals||{};ACC=(D.accounts||{}).accounts||{};FILLS=(D.accounts||{}).fills||[];RECS=(D.accounts||{}).recs||[]}

/* ---------- US market clock (ET), NYSE holidays + early closes ---------- */
const ETF=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',hourCycle:'h23',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',weekday:'short'});
function etParts(ms){const o={};for(const p of ETF.formatToParts(new Date(ms??Date.now())))o[p.type]=p.value;
  return {date:`${o.year}-${o.month}-${o.day}`,hm:`${o.hour}:${o.minute}`,hms:`${o.hour}:${o.minute}:${o.second}`,wd:o.weekday,min:(+o.hour)*60+(+o.minute)}}
const hm2m=s=>{const[a,b]=s.split(':');return +a*60+ +b};
function isTradingDay(date,wd){return wd!=='Sat'&&wd!=='Sun'&&!CAL.holidays.includes(date)}
const Market={
  status(ms){const e=etParts(ms),open=hm2m(CAL.session.open),close=hm2m(CAL.early_close[e.date]||CAL.session.close);
    if(!isTradingDay(e.date,e.wd))return{open:false,phase:CAL.holidays.includes(e.date)?'holiday':'weekend',e};
    if(e.min<open)return{open:false,phase:'pre',e,opensAt:CAL.session.open};
    if(e.min>=close)return{open:false,phase:'after',e,closedAt:CAL.early_close[e.date]||CAL.session.close};
    return{open:true,phase:'open',e,closesAt:CAL.early_close[e.date]||CAL.session.close}},
  isOpen(ms){return this.status(ms).open},
  /* epoch ms of the most recent regular-session close */
  lastClose(ms){let t=ms??Date.now();for(let i=0;i<10;i++){const e=etParts(t),c=CAL.early_close[e.date]||CAL.session.close;
      if(isTradingDay(e.date,e.wd)&&e.min>=hm2m(c))return t-(e.min-hm2m(c))*6e4-(+e.hms.slice(6))*1e3;
      t=t-(e.min+1)*6e4;} return null},
  /* "09:30 ET" today if before the open, else e.g. "Mon Oct 12, 09:30 ET" */
  nextOpen(ms){const s=this.status(ms);if(s.phase==='pre')return CAL.session.open+' ET';
    let t=(ms??Date.now());for(let i=0;i<12;i++){t+=864e5;const e=etParts(t);if(isTradingDay(e.date,e.wd))return `${e.wd} ${dshort(e.date)}, ${CAL.session.open} ET`}return ''},
  label(){const s=this.status();if(s.open)return `Market open · closes ${s.closesAt} ET`;
    if(s.phase==='pre')return `Pre-market · opens ${CAL.session.open} ET`;return `${s.phase==='holiday'?'Market holiday':'Market closed'} · opens ${this.nextOpen().replace(/, /,' ')}`}
};
const fmtAge=ms=>{const m=Math.floor(ms/6e4);if(m<1)return '<1m';if(m<60)return m+'m';const h=Math.floor(m/60);if(h<24)return h+'h '+(m%60)+'m';return Math.floor(h/24)+'d'};
const parseET=s=>{/* "2026-10-08 10:03 EDT" -> epoch ms */ if(!s)return null;const m=String(s).match(/(\d{4})-(\d\d)-(\d\d)[ T](\d\d):(\d\d)(?::(\d\d))?\s*(EDT|EST)?/);if(!m)return null;
  const off=m[7]==='EST'?5:4;return Date.UTC(+m[1],+m[2]-1,+m[3],+m[4]+off,+m[5],+(m[6]||0))};

function status(t){
  if(t.status==='CANCELLED')return['Cancelled','cxl'];
  if(t.status==='CLOSED')return['Closed','closed'];
  if(t.status==='OPEN')return t.t2_hit?['T2 hit','t1']:t.t1_hit?['T1 hit','t1']:['Open','open'];
  return['Pending','pend'];
}
function conf(t){const c=((t.reasoning||{}).confidence||{}).rating;return c?[c,c==='High'?'hi':c==='Medium'?'md':'lo']:null}
function pnlOf(t){if(t.status==='CLOSED')return t.realized_pnl;if(t.status==='OPEN')return (t.unrealized_pnl||0)+(t.realized_partial||0);return null}
function shownPnl(t){
  if(t.status!=='OPEN'||!Val.live(t.ticker))return pnlOf(t);
  const ent=entryRef(t),qty=t.contracts_open??t.contracts;
  if(ent==null||qty==null)return pnlOf(t);
  return (t.realized_partial||0)+qty*(Val.exit(t.ticker)-ent);
}
function ledgerSpot(t){const q=Prices.get(t.ticker);return q?q.p:null}
function spotOf(t){return Val.last(t.ticker)}
const SETUPN={breakout:'Breakout',pullback:'Pullback',drift:'Post-catalyst drift',reversal:'Oversold reversal'};
function entryRef(t){const f=(t.fills||[]).find(x=>x.kind==='entry'||x.side==='buy');const lv=(t.reasoning||{}).levels||{};return f&&f.fill_price!=null?f.fill_price:(t.plan||{}).entry??lv.entry??(t.user_levels||{}).entry??((t.indicative||{}).spot)}
function orderText(t){const o=t.entry_order||{};
  if(o.kind==='buy_stop')return 'Buy-stop '+n(o.trigger);
  if(o.kind==='limit_zone')return 'Limit '+n(o.zone[0])+'-'+n(o.zone[1]);
  return o.type==='market'?'Market':'Trigger '+n(o.trigger)}
function setupName(t){const sh=t.contracts_open??t.contracts;return t.setup_type&&SETUPN[t.setup_type]?SETUPN[t.setup_type]+' · '+n(sh,0)+' shares':(t.direction==='short'?'Short ':'Long ')+n(sh,0)+' shares'}
const rrTxt=x=>x==null?'n/a':String(Math.round(x*100)/100);
function earnTxt(t){const e=t.earnings||{};if(!e.date)return 'n/a';return dshort(e.date)+((e.note||'').startsWith('ESTIMATE')?' est.':'')}
function bookEq(b){
  const k=D.books[b]||{equity:0,pnl:0,pnl_pct:0,start:100000};
  let d=0,any=false;
  for(const p of (ACC[b]||{}).positions||[]){ if(!Val.live(p.ticker))continue; d+=Val.deltaPos(p); any=true }
  return {eq:k.equity+d,d,any,base:k.equity,k};
}
function slimBar(t){
  const lv=(t.reasoning||{}).levels||{}; if(lv.stop==null||lv.t2==null)return '';
  const cur=spotOf(t); if(cur==null)return '';
  const p=Math.max(0,Math.min(100,(cur-lv.stop)/(lv.t2-lv.stop)*100));
  return `<div class="slim" data-slim="${t.id}" data-stop="${lv.stop}" data-t2="${lv.t2}"><i style="width:${p}%"></i></div>`;
}
function pxSpan(tk){const q=Prices.get(tk);return `<span data-px="${esc(tk)}">${q?n(q.p):'n/a'}</span>`}
function badgeHTML(tk){const b=Live.badge(tk);return `<span class="lb ${b.c}" title="${esc(b.title)}"><i></i>${esc(b.short)}</span>`}

function candleChart(t){
  const tc=TECH[t.ticker];const lv=(t.reasoning||{}).levels||{};
  if(!tc||!tc.candles||!tc.candles.length)return '<div class="empty">Chart unavailable</div>';
  const C=tc.candles.slice(-(innerWidth<480?46:60)),W=640,H=220,PR=72,PT=12,PB=22;
  const ref=entryRef(t),zone=(t.entry_order||{}).kind==='limit_zone'&&t.status==='PENDING'?t.entry_order.zone:null;
  const lv2=[lv.stop,lv.t1,lv.t2,ref,...(zone||[])].filter(x=>x!=null);
  let lo=Math.min(...C.map(c=>c[3]),...lv2),hi=Math.max(...C.map(c=>c[2]),...lv2);const pad=(hi-lo)*.06||1;lo-=pad;hi+=pad;
  const y=v=>PT+(hi-v)/(hi-lo)*(H-PT-PB), step=(W-PR)/C.length, bw=Math.max(2,step*.62);
  let g='',cs='';
  for(let i=0;i<4;i++){const yy=PT+i*(H-PT-PB)/3;g+=`<line class="grid-l" x1="0" x2="${W-PR}" y1="${yy}" y2="${yy}"/>`}
  C.forEach((c,i)=>{const x=i*step+step/2,up=c[4]>=c[1],col=up?'var(--up)':'var(--down)';
    cs+=`<line x1="${x}" x2="${x}" y1="${y(c[2])}" y2="${y(c[3])}" stroke="${col}" stroke-width="1"/>`+
        `<rect x="${x-bw/2}" y="${y(Math.max(c[1],c[4]))}" width="${bw}" height="${Math.max(1,Math.abs(y(c[1])-y(c[4])))}" rx="1" fill="${col}"/>`});
  let lines='',labels='',used=[];
  [['Stop',lv.stop,'var(--down)'],['Entry',ref,'var(--label2)'],['T1',lv.t1,'var(--teal)'],['T2',lv.t2,'var(--up)']].forEach(([nm,v,col])=>{
    if(v==null)return; let yy=y(v); lines+=`<line x1="0" x2="${W-PR}" y1="${yy}" y2="${yy}" stroke="${col}" stroke-dasharray="4 4" stroke-width="1"/>`;
    let ly=yy; used.forEach(u=>{if(Math.abs(u-ly)<14)ly=u+14}); used.push(ly);
    labels+=`<text x="${W-PR+6}" y="${ly+4}" fill="${col}">${nm} ${n(v,v>=100?0:2)}</text>`});
  const cur=spotOf(t)||C[C.length-1][4], cx=(C.length-1)*step+step/2, cy=y(cur);
  const mk=`<line x1="${cx}" x2="${W-PR}" y1="${cy}" y2="${cy}" stroke="currentColor" stroke-opacity=".35" stroke-dasharray="1 3"/><circle class="now" data-chart-px="${esc(t.ticker)}" cx="${cx}" cy="${cy}" r="4" fill="var(--label)"/>`;
  return `<div class="chart-wrap" data-tk="${esc(t.ticker)}" data-n="${C.length}" data-step="${step}" data-w="${W}" data-pr="${PR}" data-lo="${lo}" data-hi="${hi}" data-pt="${PT}" data-pb="${PB}" data-h="${H}"><svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(t.ticker)} chart">${g}${cs}${lines}${mk}${labels}<line class="xh" y1="${PT}" y2="${H-PB}"/><line class="yh" x2="${W-PR}"/></svg><div class="tip"></div></div>`;
}
function lineChart(series,labels){
  const pts=(series[0]||[]).filter(v=>v!=null); if(pts.length<2)return '';
  const W=640,H=180,P=8,all=series.flat().filter(v=>v!=null); let lo=Math.min(...all),hi=Math.max(...all); if(hi===lo){hi+=1;lo-=1}
  const y=v=>P+(hi-v)/(hi-lo)*(H-2*P);
  let out=`<svg class="eq" viewBox="0 0 ${W} ${H}">`;
  series.forEach((s,si)=>{const xy=s.map((v,i)=>v==null?null:[i/(s.length-1)*W,y(v)]).filter(Boolean); if(xy.length<2)return;
    out+=`<path d="M${xy.map(p=>p.map(v=>v.toFixed(1)).join(',')).join('L')}" fill="none" stroke="${si?'var(--label3)':'var(--tint)'}" stroke-width="${si?1.25:2}" stroke-dasharray="${si?'4 3':''}"/>`});
  out+=`</svg><div class="legend"><span>${esc(labels[0]||'')}</span><span>${esc(labels[1]||'')}</span></div>`;
  return out;
}

function dayChange(b){
  const key=b==='main'?'equity':b+'_equity', H=(D.equity_history||[]).filter(h=>h[key]!=null);
  const a=H[H.length-1], prev=H[H.length-2];
  const be=bookEq(b);
  if(!a||!prev) return {d:be.k.pnl, pct:be.k.pnl_pct, spy:null, label:'since inception'};
  const d=(be.eq)-(prev[key]);
  const spy=a.spy&&prev.spy?(a.spy/prev.spy-1)*100:null;
  const same=String(a.t).slice(0,10)===String(prev.t).slice(0,10);
  return {d, pct:prev[key]?d/prev[key]*100:null, spy, label:same?'today':'since last check'};
}

function homeView(){
  const b=state.acct||'main', be=bookEq(b), ch=dayChange(b);
  const open=T.filter(t=>t.book===b&&t.status==='OPEN');
  const pend=T.filter(t=>t.book===b&&t.status==='PENDING');
  const nx=(D.next||[]).filter(x=>x.book===b).slice(0,4);
  const row=t=>{
    const pl=shownPnl(t);
    return `<button class="cell" data-trade="${t.id}">
      <div class="c1"><b>${esc(t.ticker)}</b><span class="sub2">${esc(setupName(t))}</span></div>
      <div class="c2"><b class="num" data-px="${esc(t.ticker)}">${n(spotOf(t))}</b>${badgeHTML(t.ticker)}</div>
      <div class="c3 num ${cls(pl)}" data-pl="${t.id}">${pl==null?'':susd(pl,0)}</div>
      ${slimBar(t)}
    </button>`;
  };
  return `<section id="overview" data-screen="home">
    <div class="acctseg seg" role="tablist">${['main','shadow','mambo'].map(x=>`<button data-acct="${x}" class="${x===b?'on':''}" role="tab">${BOOKN[x]}</button>`).join('')}</div>
    <p class="eyebrow">${BOOKN[b]} paper account</p>
    <p class="value num" id="hero-eq" data-eq="${b}">${usd(be.eq,2)}</p>
    <p class="delta num ${cls(ch.d)}" id="hero-day">${ch.d==null?'':susd(ch.d,2)} ${ch.pct==null?'':pct(ch.pct)} <span class="sub2">${ch.label}${ch.spy==null?'':` · S&P 500 ${pct(ch.spy)}`}</span></p>
    <p class="hair" id="hero-live"></p>
    ${open.length?`<h2 class="group-h">Open</h2><div class="group">${open.map(row).join('')}</div>`:`<div class="group"><div class="empty">No open positions.</div></div>`}
    ${pend.length?`<h2 class="group-h">Pending</h2><div class="group">${pend.map(t=>`<button class="cell" data-trade="${t.id}"><div class="c1"><b>${esc(t.ticker)}</b><span class="sub2">${esc(orderText(t))}${(t.entry_order||{}).valid_until?' · through '+dshort(t.entry_order.valid_until):''}</span></div><div class="c2"><b class="num" data-px="${esc(t.ticker)}">${n(spotOf(t))}</b>${badgeHTML(t.ticker)}</div></button>`).join('')}</div>`:''}
    ${nx.length?`<h2 class="group-h">Attention</h2><div class="group">${nx.map(x=>`<div class="cell static"><div class="c1"><b>${dshort(x.date)}</b><span class="sub2">${esc(x.label)}</span></div><div class="c3 sub2">${daysTo(x.date)}d</div></div>`).join('')}</div>`:''}
    <p class="fine">P&amp;L uses the exit value, last price minus 0.2% paper slippage. The price on each row is the last trade, the same number everywhere. Official fills come only from the scheduled 5-minute bar checks.</p>
  </section>`;
}

function positionsView(){
  const b=state.recs||'main';
  const order={OPEN:0,PENDING:1,CLOSED:2,CANCELLED:3};
  const ts=T.filter(t=>b==='all'||t.book===b).sort((x,y)=>(order[x.status]-order[y.status])||((y.scores||{}).total||0)-((x.scores||{}).total||0));
  const row=t=>{const [st,sc]=status(t), pl=shownPnl(t);
    return `<button class="cell" data-trade="${t.id}">
      <div class="c1"><b>${esc(t.ticker)}</b><span class="sub2">${esc(BOOKN[t.book]||'')} · ${esc(setupName(t))}</span></div>
      <div class="c2"><span class="pill ${sc}">${st}</span></div>
      <div class="c3"><b class="num" data-px="${esc(t.ticker)}">${spotOf(t)==null?'':n(spotOf(t))}</b><span class="num ${cls(pl)}">${pl==null?'':susd(pl,0)}</span></div>
    </button>`};
  return `<section data-screen="positions">
    <div class="seg">${['main','shadow','mambo','all'].map(x=>`<button data-recs="${x}" class="${x===b?'on':''}">${x==='all'?'All':BOOKN[x]}</button>`).join('')}</div>
    <div class="group">${ts.map(row).join('')||'<div class="empty">Nothing in this book.</div>'}</div>
  </section>`;
}

function near(a,b){return a!=null&&b!=null&&Math.abs(+a-+b)<0.015}
function levelBits(src){
  const o=src||{};
  return {entry:o.entry, stop:o.stop, t1:o.t1, t2:o.t2};
}
/* Tiles and this sentence both read reasoning.levels (rebased to the fill). plan is the original. */
function levelSentence(t){
  const lv=(t.reasoning||{}).levels||{};
  const o=t.entry_order||{};
  const kind=o.kind==='buy_stop'?'buy-stop':o.kind==='limit_zone'?'limit':'entry';
  const ent=lv.entry!=null?lv.entry:entryRef(t);
  const name=(SETUPN[t.setup_type]||(t.direction==='short'?'Short':'Long'));
  return `${name}: ${kind} ${n(ent)}, stop ${n(lv.stop)}, T1 ${n(lv.t1)}, T2 ${n(lv.t2)}.`;
}
function rebaseNote(t){
  const lv=(t.reasoning||{}).levels||{}, pl=t.plan||{};
  if(!pl.entry&&pl.t1==null) return '';
  const moved=!near(pl.entry,lv.entry)||!near(pl.t1,lv.t1)||!near(pl.t2,lv.t2)||!near(pl.stop,lv.stop);
  if(!moved) return '';
  const fill=entryRef(t);
  return `Targets re-based to the ${n(fill)} fill. Original plan: ${n(pl.entry)}, stop ${n(pl.stop)}, T1 ${n(pl.t1)}, T2 ${n(pl.t2)}.`;
}
function detailHTML(t){
  const r=t.reasoning||{}, lv=r.levels||{}, wl=r.why_levels||{}, pl=t.plan||{};
  const [st,sc]=status(t), p=shownPnl(t), cf=conf(t);
  const risks=(r.risks||[]).map(x=>`<li>${esc(x)}</li>`).join('');
  const fills=(t.fills||[]).map(f=>`<div class="cell static"><div class="c1"><b>${esc(f.kind)}</b><span class="sub2">${dshort(f.filled_at)} · ${esc(f.price_source||'')}</span></div><div class="c3 num">${f.fill_price==null?'':n(f.fill_price)}</div></div>`).join('');
  return `<div class="sheet-h"><button class="x" data-close aria-label="Close">Close</button><div class="grab"></div></div>
    <div class="sheet-body" id="sheet-body">
      <p class="eyebrow">${esc(BOOKN[t.book]||'')} · ${esc(st)}</p>
      <h2 class="sheet-title">${esc(t.ticker)} <span class="num livepx" data-px="${esc(t.ticker)}">${n(spotOf(t))}</span></h2>
      <p class="sub2">${badgeHTML(t.ticker)} ${esc(setupName(t))}${cf?' · '+esc(cf[0])+' confidence':''}</p>
      <p class="delta num ${cls(p)}">${p==null?'':susd(p,2)+' paper'}</p>
      ${candleChart(t)}
      ${slimBar(t)}
      <div class="kv">
        <div><span>Entry</span><b class="num">${n(entryRef(t))}</b></div>
        <div><span>Stop</span><b class="num down">${lv.stop!=null?n(lv.stop):'n/a'}</b></div>
        <div><span>T1</span><b class="num">${lv.t1!=null?n(lv.t1):'n/a'}</b></div>
        <div><span>T2</span><b class="num up">${lv.t2!=null?n(lv.t2):'n/a'}</b></div>
        <div><span>Shares</span><b class="num">${n(t.contracts_open??t.contracts,0)}</b></div>
        <div><span>Risk</span><b class="num">${usd(t.max_risk_usd)}</b></div>
        <div><span>R:R</span><b class="num">${rrTxt(t.rr??pl.rr)}</b></div>
        <div><span>Time stop</span><b>${t.time_stop?dshort(t.time_stop):((t.time_stop_weeks||pl.time_stop_weeks||'n/a')+' wks')}</b></div>
        <div><span>Earnings</span><b>${earnTxt(t)}</b></div>
        <div><span>Order</span><b>${esc(orderText(t))}</b></div>
      </div>
      <div class="prose">
        <p class="levels-now">${esc(levelSentence(t))}</p>
        ${rebaseNote(t)?`<p class="fine rebase">${esc(rebaseNote(t))}</p>`:''}
        ${r.why_stock?`<h3>Why this stock</h3><p>${esc(r.why_stock)}</p>`:''}
        ${r.why_now?`<h3>Why now</h3><p>${esc(r.why_now)}</p>`:''}
        <h3>Why these levels</h3>
        <p>Stop ${n(lv.stop)}, T1 ${n(lv.t1)}, T2 ${n(lv.t2)}, from the same levels as the tiles above${rebaseNote(t)?', after the fill':''}.</p>
        ${wl.entry?`<p class="fine">As issued: ${esc(wl.entry)} ${esc(wl.stop||'')} ${esc(wl.t1||'')} ${esc(wl.t2||'')}</p>`:''}
        ${risks?`<h3>What could go wrong</h3><ul>${risks}</ul>`:''}
        ${(r.confidence||{}).why?`<h3>Confidence</h3><p>${esc(r.confidence.why)}</p>`:''}
        ${t.why_not_main_detail?`<h3>Why it is not in Main</h3><p>${esc(t.why_not_main_detail)}</p>`:''}
        ${t.postmortem?`<h3>After the close</h3><p>${esc(t.postmortem.why||t.postmortem.one_liner||'')}</p>`:''}
      </div>
      <p class="fine">${esc(t.id)} · rec ${esc(t.rec_id||'n/a')} · method v${esc(t.method_version||'')} · issued ${dshort(t.created_at)} ET</p>
      ${fills?`<h2 class="group-h">Fills</h2><div class="group">${fills}</div>`:''}
    </div>`;
}

function activityView(){
  const mode=state.act||'fills';
  const seg=`<div class="seg">${[['fills','Fills'],['alerts','Alerts'],['post','Post-mortems']].map(([k,l])=>`<button data-act="${k}" class="${mode===k?'on':''}">${l}</button>`).join('')}</div>`;
  let body='';
  if(mode==='fills'){
    const fl=FILLS.slice().reverse();
    body=`<div class="group">${fl.map(f=>`<div class="cell static" id="fill-${f.fill_id}"><div class="c1"><b>${esc(f.ticker)} ${esc((f.kind||'').replace('_',' '))}</b><span class="sub2">${dshort(f.filled_at)} · ${esc(BOOKN[f.account]||f.account||'')} · ${esc(f.rec_id||'')}</span><span class="sub2">${esc(f.order_type||'')} · ${esc(f.price_source||'')}</span></div><div class="c3 num">${f.fill_price==null?'':n(f.fill_price)}</div></div>`).join('')||'<div class="empty">No fills yet.</div>'}</div>`;
  } else if(mode==='alerts'){
    body=`<div class="group">${(D.alerts||[]).slice(0,40).map(a=>`<div class="cell static"><div class="c1"><b>${esc((a.type||'').replace('_',' '))}</b><span class="sub2">${dshort(a.t)} ET${a.book?' · '+esc(BOOKN[a.book]||a.book):''}</span><span class="sub2">${esc(a.text)}</span></div></div>`).join('')||'<div class="empty">No alerts.</div>'}</div>`;
  } else {
    body=`<div class="group">${(D.postmortems||[]).map(p=>`<div class="cell static"><div class="c1"><b>${esc(p.outcome||'')}</b><span class="sub2">${esc(p.why||p.one_liner||'')}</span><span class="sub2 num">${p.trade_id||''} ${p.r_multiple!=null?n(p.r_multiple,2)+'R':''}</span></div></div>`).join('')||'<div class="empty">None yet. Written when a trade closes.</div>'}</div>`;
  }
  return `<section data-screen="activity">${seg}${body}<p class="fine">fills.jsonl is append-only. Every fill cites its recommendation and the bar used.</p></section>`;
}

function insightsView(){
  const mode=state.ins||'perf';
  const seg=`<div class="seg wrapseg">${[['perf','Performance'],['learn','Learning'],['scan','Scan'],['recs','Record'],['gloss','Glossary']].map(([k,l])=>`<button data-ins="${k}" class="${mode===k?'on':''}">${l}</button>`).join('')}</div>`;
  if(mode==='perf') return seg+perfPanel();
  if(mode==='learn') return seg+learnPanel();
  if(mode==='scan') return seg+scanPanel();
  if(mode==='recs') return seg+recsPanel();
  return seg+glossPanel();
}
function perfPanel(){
  const b=state.acct||'main', a=ACC[b]||{}, be=bookEq(b);
  const key=b==='main'?'equity':b+'_equity', H=D.equity_history||[], spy0=(D.accounts||{}).spy_inception_close;
  const rows=H.filter(h=>h[key]!=null);
  const eq=rows.map(h=>h[key]), spy=rows.map(h=>h.spy&&spy0?h.spy/spy0*(a.start_cash||100000):null);
  const tiles=[['Value',usd(be.eq,2)],['Cash',usd(a.cash,2)],['vs S&P 500',a.vs_spy_pct==null?'n/a':pct(a.vs_spy_pct)],['Realized',susd(a.realized,2)],['Unrealized',susd((a.unrealized||0)+be.d,2)],['Win rate',a.win_rate==null?'n/a':n(a.win_rate,0)+'%'],['Expectancy',a.expectancy_R==null?'n/a':n(a.expectancy_R,2)+'R'],['Max drawdown',a.max_drawdown_pct==null?'n/a':n(a.max_drawdown_pct,2)+'%'],['T1 hit',a.t1_hit_rate==null?'n/a':n(a.t1_hit_rate,0)+'%'],['Cancelled',String(a.cancelled||0)]];
  return `<section><div class="seg">${['main','shadow','mambo'].map(x=>`<button data-acct="${x}" class="${x===b?'on':''}">${BOOKN[x]}</button>`).join('')}</div>
    <div class="card">${lineChart([eq,spy],[dshort((rows[0]||{}).t), dshort((rows[rows.length-1]||{}).t)])||'<div class="empty">Curve starts with the first marks.</div>'}<p class="fine">Solid line is the paper account. Dashed is the S&amp;P 500 from the same start.</p></div>
    <div class="stats">${tiles.map(([k,v])=>`<div class="stat"><span>${k}</span><b class="num">${v}</b></div>`).join('')}</div>
    <p class="fine" id="slip-note">Unrealized P&amp;L uses the exit value (last price minus 0.2% paper slippage). Prices elsewhere are the last trade.</p>
  </section>`;
}
function learnPanel(){
  const rv=D.review||{}, gates=rv.gates||[], ds=rv.risk_state||{};
  const vers=(D.versions||[]).map(v=>`<div class="cell static"><div class="c1"><b>v${esc(v.version)}</b><span class="sub2">${dshort(v.date)} · ${esc(v.status||'')}</span><span class="sub2">${esc((v.changes||[]).join(' '))}</span></div></div>`).join('');
  const ch=(D.challengers||[]).filter(c=>c.status!=='retired').map(c=>{const g=gates.find(x=>x.challenger===c.id)||{};
    return `<div class="cell static"><div class="c1"><b>${esc(c.id)}</b><span class="sub2">${esc(c.hypothesis||'')}</span><span class="sub2">${esc(c.status)} · ${g.n_closed??0} closed · avg ${g.avg_R==null?'n/a':n(g.avg_R,2)+'R'} · ${esc(g.verdict||'')}</span></div></div>`}).join('');
  return `<section>
    <div class="stats"><div class="stat"><span>Version</span><b>v${esc((D.method||{}).version||'')}</b></div><div class="stat"><span>Risk mode</span><b>${esc((D.method||{}).risk_mode||'')}</b></div><div class="stat"><span>Drawdown</span><b class="num">${n(ds.main_drawdown_pct,1)}%</b></div><div class="stat"><span>Loss streak</span><b class="num">${ds.main_loss_streak??0}</b></div></div>
    <h2 class="group-h">Versions</h2><div class="group">${vers||'<div class="empty">None.</div>'}</div>
    <h2 class="group-h">Challengers</h2><div class="group">${ch||'<div class="empty">None active.</div>'}</div>
    <h2 class="group-h">Rules</h2><div class="group">${(rv.rules||[]).map(x=>`<div class="cell static"><div class="c1"><span class="sub2">${esc(x)}</span></div></div>`).join('')}</div>
    ${(D.changelog)?`<h2 class="group-h">Changelog</h2><pre class="log">${esc(D.changelog)}</pre>`:''}
  </section>`;
}
function scanPanel(){
  const S=D.scan||{}; if(!S.funnel) return '<section><div class="empty">No scan yet.</div></section>';
  const g=S.regime||{}, F=S.funnel, SC=S.setup_counts||{};
  const cands=(S.candidates||[]).slice(0,25).map((c,i)=>`<div class="cell static"><div class="c1"><b>${i+1} ${esc(c.ticker)}</b><span class="sub2">${esc(SETUPN[c.setup]||c.setup)} · score ${n(c.score,0)} · RS ${c.rs_rating} · ${c.order_kind==='buy_stop'?'stop':'limit'} ${n(c.entry)} · R:R ${rrTxt(c.rr)}</span><span class="sub2">${c.booked?BOOKN[c.booked]+' · ':''}${(c.flags||[]).join(', ')||'unflagged'}</span></div></div>`).join('');
  return `<section><p class="fine">Scan of the ${dshort(S.bar_date)} close. Universe ${n(F.universe,0)} → liquid ${n(F.liquid,0)} → setups ${n(F.uptrend_or_setup,0)} → Main ${S.n_main}, Shadow ${S.n_shadow}. SPY ${n(g.spy_close)} vs 200-day ${n(g.spy_sma200)} (${esc(g.state||'')}).</p>
    <div class="group">${Object.entries(SC).map(([k,v])=>`<div class="cell static"><div class="c1"><b>${esc(SETUPN[k]||k)}</b></div><div class="c3 num">${v}</div></div>`).join('')}</div>
    <h2 class="group-h">Top candidates</h2><div class="group">${cands}</div></section>`;
}
function recsPanel(){
  const rows=RECS.slice().reverse().map(r=>`<div class="cell static"><div class="c1"><b>${esc(r.rec_id)} ${esc(r.ticker)}</b><span class="sub2">${dshort(r.issued_at)} · ${esc(BOOKN[r.account]||r.account)} · v${esc(r.method_version||'')}</span><span class="sub2">${esc(r.paper_outcome||'')}</span></div></div>`).join('');
  return `<section><p class="fine">recs.jsonl is append-only and hash-chained. Revisions are new records.</p><div class="group">${rows||'<div class="empty">No recommendations.</div>'}</div></section>`;
}
function glossPanel(){
  return `<section><div class="group">${Object.entries(D.glossary||{}).map(([k,v])=>`<div class="cell static"><div class="c1"><b>${esc(k)}</b><span class="sub2">${esc(v)}</span></div></div>`).join('')}</div></section>`;
}

function settingsView(){
  const th=localStorage.getItem('sd.theme')||'system';
  const d=Live.diag();
  const hm=ms=>ms?etParts(ms).hms:'never';
  return `<section data-screen="settings">
    <h2 class="group-h">Appearance</h2>
    <div class="seg" id="theme-seg">${[['system','System'],['light','Light'],['dark','Dark']].map(([k,l])=>`<button data-theme-set="${k}" class="${th===k?'on':''}">${l}</button>`).join('')}</div>
    <h2 class="group-h">Live prices</h2>
    <div class="group padg" id="key-block">
      <p id="key-state" class="sub2"></p>
      <p class="fine">Prices stream from <a href="https://finnhub.io/register">Finnhub</a> to this device only. The key stays in this app's storage and is never uploaded. Free plan: 50 symbols, one stream, 60 quotes a minute. On iPhone, the installed app keeps its own storage, so paste the key again after Add to Home Screen.</p>
      <ol class="fine"><li>Create a free account at <a href="https://finnhub.io/register">finnhub.io/register</a>.</li><li>Copy the key from <a href="https://finnhub.io/dashboard">finnhub.io/dashboard</a>.</li><li>Paste it here, then Test and Save.</li></ol>
      <label class="lbl" for="key-in">Finnhub API key</label>
      <div class="keyrow"><input id="key-in" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Paste key"><button type="button" id="key-show" class="btn">Show</button></div>
      <div class="keyrow"><button type="button" id="key-test-btn" class="btn">Test connection</button><button type="button" id="key-save" class="btn primary">Save and connect</button></div>
      <button type="button" id="key-remove" class="btn danger">Remove key</button>
      <p id="key-test" class="fine" role="status"></p>
    </div>
    <h2 class="group-h">Diagnostics</h2>
    <div class="group" id="diag">
      ${[['Feed',d.state],['Socket',d.socket],['Symbols',d.symbols+' (subscribed '+d.subs+')'],['Messages',String(d.msgs)],['Last message',hm(d.lastMsg)],['Last trade',hm(d.lastTrade)],['Last quote poll',hm(d.lastPoll)],['Last error',d.err||'none']].map(([k,v])=>`<div class="cell static"><div class="c1">${k}</div><div class="c3 num">${esc(v)}</div></div>`).join('')}
    </div>
    <h2 class="group-h">App</h2>
    <div class="group padg">
      <p id="install-state" class="fine"></p>
      <button type="button" class="btn" data-install>Install app</button>
      <button type="button" class="btn" id="sw-check">Check for update</button>
      <p class="fine" id="app-ver">Version ${esc(APP_VERSION)}. Paper trading only, not financial advice. Live prices are informational. Official paper fills are booked by the scheduled checks on 5-minute bars.</p>
    </div>
  </section>`;
}

function screen(){
  const tab=state.tab||'home';
  if(tab==='home') return homeView();
  if(tab==='positions') return positionsView();
  if(tab==='activity') return activityView();
  if(tab==='insights') return insightsView();
  return settingsView();
}
const TITLES={home:'Swing Desk',positions:'Positions',activity:'Activity',insights:'Insights',settings:'Settings'};

/* One price store. Every surface reads Prices.get(symbol). Nothing else may
   read data.json quotes or invent a price. src is trade | quote | ledger. */
const SLIP = 0.002; /* paper exit haircut, same as the ledger. Never shown as the price. */
const Prices = {
  map: {},
  put(sym, rec){
    if(!sym || rec.p==null || isNaN(rec.p)) return;
    const t = rec.t>1e12 ? rec.t : (rec.t||0)*1000;
    const cur = this.map[sym];
    /* ledger as_of is when the file was written, not when the trade printed, so a quote always replaces it */
    if(cur && rec.src==='ledger' && cur.src!=='ledger') return;
    if(cur && cur.src!=='ledger' && rec.src!=='ledger' && t && cur.t && t<cur.t) return;
    this.map[sym] = {p:+rec.p, t:t||Date.now(), src:rec.src, via:rec.via||rec.src, pc:rec.pc!=null?+rec.pc:(cur?cur.pc:null)};
  },
  get(sym){ return this.map[sym]||null },
  seed(d){
    const q=(d&&d.quotes)||{};
    for(const [s,v] of Object.entries(q)){
      if(v&&v.price!=null) this.put(s,{p:v.price, t:parseET(v.as_of)||0, src:'ledger', via:v.source||'ledger', pc:v.prev_close});
    }
  }
};
const Val = {
  last(tk){ const q=Prices.get(tk); return q?q.p:null },
  /* exit value used ONLY for P&L / equity, labeled once in the UI */
  exit(tk){ const p=this.last(tk); return p==null?null:p*(1-SLIP) },
  live(tk){ const q=Prices.get(tk); return !!(q&&q.src!=='ledger') },
  deltaPos(p){ if(!this.live(p.ticker)||p.last_value==null) return 0; return (+p.qty||0)*(this.exit(p.ticker)-p.last_value) }
};
const Live = {
  px: Prices.map,
  state:'nokey', err:'', ws:null, subs:[], retry:0, manualClose:false, timer:null, pollI:null,
  msgs:0, lastMsg:0, lastPoll:0, lastTrade:0, starting:false,
  key(){ try{return localStorage.getItem('sd.finnhub.key')||''}catch(e){return ''} },
  setKey(k){ if(k) localStorage.setItem('sd.finnhub.key',k); else localStorage.removeItem('sd.finnhub.key') },
  symbols(){
    const s=new Set(['SPY']);
    for(const t of (T||[])) if(t.status==='OPEN'||t.status==='PENDING') s.add(t.ticker);
    return [...s].slice(0,50);
  },
  quote(tk){ return Prices.get(tk) },
  refClose(tk){ const q=Prices.get(tk); return q&&q.pc?q.pc:null },
  seed(){ Prices.seed(D) },
  badge(tk){
    const q=Prices.get(tk), st=Market.status();
    if(!q) return {c:'none', short:'n/a', title:'No price'};
    const hm=etParts(q.t).hms, age=Date.now()-q.t;
    const when = q.src==='ledger' ? 'Ledger '+etParts(q.t).hm : 'Last trade '+hm;
    if(q.src==='ledger'){
      if(!st.open) return {c:'closed', short: st.phase==='after'||st.phase==='pre' ? 'Closed' : 'Last close', title: when+' ET · '+q.via};
      return {c:'delayed', short:'Delayed '+fmtAge(age).split(' ')[0], title: when+' ET · '+q.via};
    }
    if(st.phase==='after'||st.phase==='pre') return {c:'closed', short:'After hours', title: when+' ET · '+q.via};
    if(!st.open) return {c:'closed', short:'Closed', title: when+' ET · '+q.via};
    if(q.src==='trade' && age<120000) return {c:'live', short:'LIVE '+hm, title:'Streaming trade '+hm+' ET · '+q.via};
    if(age<90000) return {c:'fresh', short:'Quote '+hm, title:'REST quote '+hm+' ET · '+q.via};
    return {c:'delayed', short:'Delayed '+fmtAge(age).split(' ')[0], title: when+' ET · '+q.via};
  },
  async rest(sym){
    const r = await fetch('https://finnhub.io/api/v1/quote?symbol='+encodeURIComponent(sym)+'&token='+encodeURIComponent(this.key()));
    if(r.status===401||r.status===403) throw Object.assign(new Error('Finnhub rejected the key ('+r.status+')'),{auth:true});
    if(r.status===429) throw Object.assign(new Error('Finnhub rate limit'),{rate:true});
    const j = await r.json();
    if(j.error) throw Object.assign(new Error(j.error),{auth:/key/i.test(j.error)});
    if(j.c){ Prices.put(sym,{p:j.c, t:(j.t||0)*1000, src:'quote', via:'Finnhub quote', pc:j.pc}); this.lastPoll=Date.now(); }
    return j;
  },
  async test(k){
    const r = await fetch('https://finnhub.io/api/v1/quote?symbol=SPY&token='+encodeURIComponent(k));
    if(r.status===401||r.status===403) return {ok:false, err:'Finnhub rejected the key ('+r.status+')'};
    const j = await r.json().catch(()=>({}));
    if(j.error) return {ok:false, err:j.error};
    if(!j.c) return {ok:false, err:'No quote returned'};
    return {ok:true, px:j.c};
  },
  fail(msg){ this.state='error'; this.err=msg; this.lastErr=msg; this.stop(true); UI.applyLive() },
  armPoll(){
    clearInterval(this.pollI); let i=0;
    this.pollI = setInterval(async()=>{
      if(!this.key()||this.state==='error'||document.hidden) return;
      const s=this.symbols(); if(!s.length) return;
      const tk=s[i++%s.length];
      const q=Prices.get(tk);
      if(q&&q.src==='trade'&&Date.now()-q.t<20000){ this.lastPoll=Date.now(); return }
      try{ await this.rest(tk); this.lastErr='' }
      catch(e){ if(e.auth){ this.fail(e.message); return } this.lastErr=e.message||'quote failed' }
      UI.applyLive();
    }, 1200);
  },
  wantsStream(){ const p=Market.status().phase; return p==='open'||p==='pre'||p==='after' },
  async start(){
    if(this.starting) return;
    this.err=''; this.lastErr='';
    if(!this.key()){ this.state='nokey'; this.stop(true); UI.applyLive(); return }
    this.starting=true;
    try{
      this.state='connecting'; UI.applyLive();
      try{ await this.rest('SPY') }catch(e){ if(e.auth){ this.fail(e.message); return } this.lastErr=e.message||'' }
      this.armPoll();
      if(this.wantsStream()) this.connect();
      else { this.stopSocket(); this.state='polling'; UI.applyLive() }
    } finally { this.starting=false }
  },
  connect(){
    if(!this.key()) return;
    this.manualClose=false;
    if(this.ws && this.ws.readyState<=1) return;
    let ws; try{ ws=new WebSocket('wss://ws.finnhub.io?token='+encodeURIComponent(this.key())) }
    catch(e){ this.lastErr='WebSocket blocked'; this.state='polling'; UI.applyLive(); return }
    this.ws=ws; this.state='connecting';
    ws.onopen=()=>{ this.retry=0; this.subs=this.symbols();
      for(const s of this.subs) ws.send(JSON.stringify({type:'subscribe',symbol:s}));
      this.state='live'; this.err=''; UI.applyLive() };
    ws.onmessage=ev=>{
      this.msgs++; this.lastMsg=Date.now();
      let m; try{ m=JSON.parse(ev.data) }catch(e){ return }
      if(m.type==='ping'){ try{ ws.send(JSON.stringify({type:'pong'})) }catch(e){} return }
      if(m.type==='trade'&&Array.isArray(m.data)){
        for(const x of m.data){
          const cur=Prices.get(x.s), prev=cur?cur.p:null;
          Prices.put(x.s,{p:x.p, t:x.t, src:'trade', via:'Finnhub trade', pc:cur?cur.pc:null});
          this.lastTrade=Date.now();
          if(prev!=null&&x.p!==prev) UI.flash(x.s, x.p>prev?1:-1);
        }
        UI.scheduleLive();
      }
    };
    ws.onerror=()=>{ this.lastErr='Stream error' };
    ws.onclose=ev=>{
      this.ws=null; if(this.manualClose) return;
      if(!this.wantsStream()){ this.state='polling'; UI.applyLive(); return }
      this.state='reconnecting'; this.retry=Math.min(this.retry+1,6);
      const wait=Math.min(60,2**this.retry)*1000;
      this.lastErr='Stream closed ('+(ev.code||'network')+'). Retrying.';
      UI.applyLive(); clearTimeout(this.timer);
      this.timer=setTimeout(()=>{ if(this.key()&&this.wantsStream()) this.connect() }, wait);
    };
  },
  resubscribe(){
    if(!this.ws||this.ws.readyState!==1) return;
    const want=this.symbols();
    for(const s of this.subs) if(!want.includes(s)) this.ws.send(JSON.stringify({type:'unsubscribe',symbol:s}));
    for(const s of want) if(!this.subs.includes(s)) this.ws.send(JSON.stringify({type:'subscribe',symbol:s}));
    this.subs=want;
  },
  stopSocket(){ this.manualClose=true; clearTimeout(this.timer); if(this.ws){ try{this.ws.close()}catch(e){} } this.ws=null },
  stop(manual){ this.stopSocket(); if(manual) clearInterval(this.pollI) },
  wake(){ /* iOS kills sockets in the background and does not always fire onclose */
    if(!this.key()||this.state==='error') return;
    if(!this.pollI) this.armPoll();
    if(this.wantsStream() && (!this.ws || this.ws.readyState!==1)){ this.stopSocket(); this.connect() }
    UI.applyLive();
  },
  tick(){
    const want=this.wantsStream();
    if(this.key()&&this.state!=='error'){
      if(want && (!this.ws||this.ws.readyState>1) && this.state!=='connecting' && this.state!=='reconnecting') this.connect();
      if(!want && this.ws){ this.stopSocket(); this.state='polling' }
      if(!this.pollI) this.armPoll();
    }
    UI.applyLive();
  },
  diag(){
    const rs=this.ws?['connecting','open','closing','closed'][this.ws.readyState]:'none';
    return {state:this.state, socket:rs, subs:this.subs.length, symbols:this.symbols().length,
      lastMsg:this.lastMsg, msgs:this.msgs, lastPoll:this.lastPoll, lastTrade:this.lastTrade, err:this.lastErr||this.err||''};
  }
};

const UI = {
  t:null,
  scheduleLive(){ clearTimeout(this.t); this.t=setTimeout(()=>this.applyLive(),80) },
  flash(tk,dir){ $$(`[data-px="${tk}"]`).forEach(el=>{ el.classList.remove('up','down'); void el.offsetWidth; el.classList.add(dir>0?'up':'down') }) },
  feedStatus(){
    const k=Live.key(), st=Market.status();
    if(!k) return {c:'off', t:'No live feed', d:'Prices are the ledger last close. Add a free Finnhub key in Settings to stream on this device.'};
    if(Live.state==='error') return {c:'err', t:'Live feed error', d:(Live.err||'Finnhub rejected the key.')+' Showing ledger prices.'};
    if(st.phase==='after'||st.phase==='pre') return {c:'closed', t:'After hours', d:'Latest quote, not the regular-session print. The stream resumes at the next open.'};
    if(!st.open) return {c:'closed', t:Market.label(), d:'Prices are the last close. Quotes refresh about every 20 seconds.'};
    if(Live.state==='live') return {c:'live', t:'LIVE', d:'Finnhub trades. Quiet names fall back to a quote.'};
    if(Live.state==='polling'||Live.state==='reconnecting'||Live.state==='connecting') return {c:'fresh', t:'Quotes', d:Live.lastErr||'Connecting to Finnhub.'};
    return {c:'off', t:'No live feed', d:''};
  },
  strip(){
    const fs=this.feedStatus();
    const el=$('#ticker'); if(!el)return;
    const chips=Live.symbols().map(tk=>{
      const q=Prices.get(tk), rc=Live.refClose(tk), ch=q&&rc?(q.p/rc-1)*100:null, b=Live.badge(tk);
      return `<button class="tq" data-jump="${esc(tk)}"><b>${esc(tk)}</b> <span class="num" data-px="${esc(tk)}">${q?n(q.p):''}</span> ${ch==null?'':`<span class="num ${cls(ch)}">${pct(ch,1)}</span>`} <span class="lb ${b.c}" title="${esc(b.title)}"><i></i>${esc(b.short)}</span></button>`;
    }).join('');
    el.innerHTML=`<button class="tq feed ${fs.c}" data-tab="settings"><i class="dot"></i>${esc(fs.t)}</button>`+chips;
    const n0=$('#feed-note');
    if(n0){ const show=fs.c==='off'||fs.c==='err'; n0.hidden=!show; n0.className='feed-note '+fs.c; n0.innerHTML=show?`<b>${esc(fs.t)}.</b> ${esc(fs.d)} <button class="lnk" data-tab="settings">Settings</button>`:'' }
    const m=$('#mkt'); if(m){ m.textContent=Market.label(); m.classList.toggle('live',Market.isOpen()) }
  },
  applyLive(){
    if(!D)return;
    this.strip();
    $$('[data-px]').forEach(el=>{ const q=Prices.get(el.dataset.px); if(q){ el.textContent=n(q.p); el.dataset.src=q.src } });
    $$('[data-pl]').forEach(el=>{ const t=T.find(x=>x.id===el.dataset.pl); if(!t)return; const p=shownPnl(t); el.textContent=p==null?'':susd(p,0); el.className='c3 num '+cls(p) });
    $$('[data-slim]').forEach(el=>{ const cur=Val.last(el.closest('[data-trade]')? (T.find(x=>x.id===el.dataset.slim)||{}).ticker : ''); 
      const t=T.find(x=>x.id===el.dataset.slim); if(!t)return; const px=Val.last(t.ticker); if(px==null)return;
      const s=+el.dataset.stop,t2=+el.dataset.t2; const p=Math.max(0,Math.min(100,(px-s)/(t2-s)*100)); const i=$('i',el); if(i)i.style.width=p+'%' });
    $$('[data-chart-px]').forEach(c=>{ const px=Val.last(c.dataset.chartPx); const wrap=c.closest('.chart-wrap'); if(px==null||!wrap)return;
      const lo=+wrap.dataset.lo,hi=+wrap.dataset.hi,pt=+wrap.dataset.pt,pb=+wrap.dataset.pb,H=+wrap.dataset.h;
      const y=pt+(hi-px)/(hi-lo)*(H-pt-pb); c.setAttribute('cy',y); const line=c.previousElementSibling; if(line){line.setAttribute('y1',y);line.setAttribute('y2',y)} });
    for(const b of ['main','shadow','mambo']){
      const be=bookEq(b), he=$('#hero-eq');
      if(he && he.dataset.eq===b) he.textContent=usd(be.eq,2);
    }
    const hl=$('#hero-live'), b=state.acct||'main', be=bookEq(b), ch=dayChange(b);
    const hd=$('#hero-day');
    if(hd) hd.innerHTML=`${ch.d==null?'':susd(ch.d,2)} ${ch.pct==null?'':pct(ch.pct)} <span class="sub2">${ch.label}${ch.spy==null?'':` · S&P 500 ${pct(ch.spy)}`}</span>`;
    if(hl) hl.textContent = be.any ? (Market.isOpen()?'Live estimate ':'Estimate ')+susd(be.d,2)+' vs the ledger mark of '+usd(be.base,2)+'. The official equity updates at the next check.' : 'Ledger value marked '+String(D.as_of||D.generated_at||'').slice(0,16)+' ET';
    this.crossings(); this.stamp(); this.diag();
  },
  crossings(){
    const box=$('#banners'); if(!box||!Market.isOpen()){ if(box&&!Market.isOpen())box.innerHTML=''; return }
    const day=etParts().date, seen=JSON.parse(sessionStorage.getItem('sd.x')||'{}');
    const out=[];
    for(const t of T){
      if(t.status!=='OPEN'&&t.status!=='PENDING') continue;
      const q=Prices.get(t.ticker); if(!q||q.src==='ledger') continue;
      const lv=(t.reasoning||{}).levels||{}, o=t.entry_order||{};
      const hits=[];
      if(t.status==='PENDING'&&o.kind==='buy_stop'&&q.p>=o.trigger) hits.push(['buy',`${t.ticker} crossed its buy-stop ${n(o.trigger)} live at ${n(q.p)}`]);
      if(t.status==='PENDING'&&o.kind==='limit_zone'&&q.p<=o.zone[1]) hits.push(['zone',`${t.ticker} is inside its limit zone live at ${n(q.p)}`]);
      if(t.status==='OPEN'&&lv.stop!=null&&q.p<=lv.stop) hits.push(['stop',`${t.ticker} crossed its stop ${n(lv.stop)} live at ${n(q.p)}`]);
      if(t.status==='OPEN'&&lv.t1!=null&&q.p>=lv.t1) hits.push(['t1',`${t.ticker} crossed T1 ${n(lv.t1)} live at ${n(q.p)}`]);
      if(t.status==='OPEN'&&lv.t2!=null&&q.p>=lv.t2) hits.push(['t2',`${t.ticker} crossed T2 ${n(lv.t2)} live at ${n(q.p)}`]);
      for(const [k,txt] of hits){ const id=t.id+k+day; if(seen[id])continue; out.push(`<div class="xb ${k==='stop'?'bad':'good'}" data-xid="${id}"><span>${esc(txt)} (${etParts(q.t).hms} ET, ${esc(BOOKN[t.book]||'')} ${esc(t.id)}) - the official ledger books it at the next check, from 5-minute bar data.</span><button data-dismiss="${id}" aria-label="Dismiss">×</button></div>`) }
    }
    box.innerHTML=out.join('');
  },
  stamp(){ const el=$('#ledger-stamp'); if(!el||!D)return; const g=String(D.as_of||D.generated_at||''); el.textContent='Ledger '+g.slice(11,16)+' ET' },
  diag(){ const box=$('#diag'); if(!box)return; const d=Live.diag(); const hm=ms=>ms?etParts(ms).hms:'never';
    const rows=[['Feed',d.state],['Socket',d.socket],['Symbols',d.symbols+' (subscribed '+d.subs+')'],['Messages',String(d.msgs)],['Last message',hm(d.lastMsg)],['Last trade',hm(d.lastTrade)],['Last quote poll',hm(d.lastPoll)],['Last error',d.err||'none']];
    box.innerHTML=rows.map(([k,v])=>`<div class="cell static"><div class="c1">${k}</div><div class="c3 num">${esc(v)}</div></div>`).join('') },
  toast(msg,action,cb){ const t=$('#toast'); t.innerHTML=`<span>${msg}</span>${action?`<button class="btn sm">${action}</button>`:''}<button class="x" aria-label="Close">×</button>`; t.hidden=false;
    if(action) $('.btn',t).onclick=cb; $('.x',t).onclick=()=>{t.hidden=true} },
  haptic(ms){ try{ if(navigator.vibrate) navigator.vibrate(ms||10) }catch(e){} }
};
function bindChart(root){
  $$('.chart-wrap',root||document).forEach(w=>{
    const tip=$('.tip',w), xh=$('.xh',w), yh=$('.yh',w);
    const move=ev=>{
      const r=w.getBoundingClientRect(), svg=w.querySelector('svg'); const pt=svg.createSVGPoint();
      const src=ev.touches?ev.touches[0]:ev; pt.x=(src.clientX-r.left)/r.width*(+w.dataset.w); pt.y=(src.clientY-r.top)/r.height*(+w.dataset.h);
      const nC=+w.dataset.n, step=+w.dataset.step, i=Math.max(0,Math.min(nC-1,Math.floor(pt.x/step)));
      const tc=TECH[w.dataset.tk]; if(!tc)return; const c=tc.candles.slice(-nC)[i]; if(!c)return;
      xh.setAttribute('x1',(i+.5)*step); xh.setAttribute('x2',(i+.5)*step); yh.setAttribute('y1',pt.y); yh.setAttribute('y2',pt.y);
      xh.style.opacity=yh.style.opacity=1; tip.hidden=false; tip.style.left=Math.min(r.width-140, Math.max(8,(i+.5)*step/ (+w.dataset.w)*r.width))+'px';
      tip.textContent=`${dshort(c[0])}  O ${n(c[1])} H ${n(c[2])} L ${n(c[3])} C ${n(c[4])}`;
    };
    w.addEventListener('pointermove',move); w.addEventListener('pointerdown',move);
    w.addEventListener('pointerleave',()=>{xh.style.opacity=yh.style.opacity=0;tip.hidden=true});
  });
}
const Sheet={
  open(html){ const s=$('#sheet'), sc=$('#scrim'); s.innerHTML=html; s.hidden=false; sc.hidden=false; document.body.classList.add('sheet-open'); requestAnimationFrame(()=>s.classList.add('on')); UI.haptic(12); bindChart(s);
    const body=$('#sheet-body',s)||s; let y0=null, dy=0;
    s.querySelector('.grab').onpointerdown=e=>{ y0=e.clientY; s.setPointerCapture(e.pointerId) };
    s.onpointermove=e=>{ if(y0==null)return; dy=Math.max(0,e.clientY-y0); s.style.transform=`translateY(${dy}px)` };
    s.onpointerup=()=>{ if(dy>90) this.close(); else s.style.transform=''; y0=null; dy=0 };
  },
  close(){ const s=$('#sheet'); s.classList.remove('on'); s.style.transform=''; document.body.classList.remove('sheet-open'); setTimeout(()=>{s.hidden=true;$('#scrim').hidden=true},280) },
  trade(id){ const t=T.find(x=>x.id===id); if(!t)return; this.open(detailHTML(t)) }
};
const Theme={
  get(){ return localStorage.getItem('sd.theme')||'system' },
  apply(){
    const m=this.get();
    const dark = m==='dark' || (m!=='light' && matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.theme=dark?'dark':'light';
    const meta=document.querySelector('meta[name=theme-color]');
    if(meta) meta.content = dark ? '#000000' : '#f2f2f7';
  }
};
matchMedia('(prefers-color-scheme: dark)').addEventListener('change',()=>{ if(Theme.get()==='system') Theme.apply() });
const Install={
  deferred:null,
  init(){
    addEventListener('beforeinstallprompt',e=>{ e.preventDefault(); this.deferred=e; this.paint() });
    addEventListener('appinstalled',()=>{ this.deferred=null; this.paint() });
    this.paint();
  },
  ios(){ return /iphone|ipad|ipod/i.test(navigator.userAgent) && !matchMedia('(display-mode: standalone)').matches },
  paint(){
    const standalone=matchMedia('(display-mode: standalone)').matches || navigator.standalone;
    $$('[data-install]').forEach(b=>{ b.hidden = standalone && !this.ios() });
    const s=$('#install-state'); if(!s)return;
    if(standalone) s.textContent='Installed on this device.';
    else if(this.deferred) s.textContent='Ready to install.';
    else if(this.ios()) s.textContent='On iPhone or iPad: Share, then Add to Home Screen.';
    else s.textContent='Install from the browser menu if the button is not offered.';
  },
  async go(){
    UI.haptic(10);
    if(this.deferred){ this.deferred.prompt(); await this.deferred.userChoice; this.deferred=null; this.paint(); return }
    if(this.ios()){ $('#sheet-ios').hidden=false; $('#scrim').hidden=false; return }
    UI.toast('Use the browser menu to install');
  }
};
const SW={reg:null, wantReload:false,
  async init(){ if(!('serviceWorker' in navigator)||location.protocol==='file:')return;
    try{ this.reg=await navigator.serviceWorker.register('sw.js',{scope:'./'}) }catch(e){ return }
    const prompt=w=>UI.toast('Update available','Reload',()=>{ SW.wantReload=true; w.postMessage({type:'SKIP_WAITING'}) });
    if(this.reg.waiting&&navigator.serviceWorker.controller) prompt(this.reg.waiting);
    this.reg.addEventListener('updatefound',()=>{ const nw=this.reg.installing; if(!nw)return; nw.addEventListener('statechange',()=>{ if(nw.state==='installed'&&navigator.serviceWorker.controller) prompt(nw) }) });
    let reloading=false;
    navigator.serviceWorker.addEventListener('controllerchange',()=>{ if(reloading||!SW.wantReload)return; reloading=true; location.reload() });
  },
  check(){ if(this.reg) this.reg.update().catch(()=>{}) }
};
function paintKeyState(){
  const s=$('#key-state'); if(!s)return;
  s.textContent = Live.key()? 'A key is saved on this device.' : 'No key on this device.';
}

state.tab=qs.get('tab')||'home'; state.ins='perf'; state.act='fills';
const scrollMem={};
function render(){
  $('#app').innerHTML=screen();
  const name=TITLES[state.tab]||'Swing Desk';
  const title=$('#title'); if(title) title.textContent=name;
  const c=$('#title-compact'); if(c) c.textContent=name;
  $$('#tabs [data-tab]').forEach(b=>b.classList.toggle('on', b.dataset.tab===state.tab && !b.classList.contains('feed')));
  paintKeyState();
  bindChart($('#app'));
  UI.applyLive();
  if(state.tab==='settings') wireSettings();
}
function gotoTab(tab){
  if(!TITLES[tab]) return;
  if(tab===state.tab){ scrollTo({top:0, behavior: STATIC?'auto':'smooth'}); return }
  scrollMem[state.tab]=scrollY; state.tab=tab; render(); scrollTo(0, scrollMem[tab]||0); UI.haptic(8);
}
function wireSettings(){
  const inp=$('#key-in'); if(!inp||inp.dataset.wired) return; inp.dataset.wired='1';
  $('#key-show').onclick=()=>{ inp.type = inp.type==='password'?'text':'password'; $('#key-show').textContent=inp.type==='password'?'Show':'Hide' };
  $('#key-test-btn').onclick=async()=>{ const k=inp.value.trim(); const o=$('#key-test'); if(!k){o.textContent='Paste a key first.';return} o.textContent='Testing…'; const r=await Live.test(k); o.textContent=r.ok?'Connected. SPY '+n(r.px)+'.':' '+r.err };
  $('#key-save').onclick=async()=>{ const k=inp.value.trim(); const o=$('#key-test'); if(!k){o.textContent='Paste a key first.';return} o.textContent='Testing…'; const r=await Live.test(k); if(!r.ok){o.textContent=r.err+' Not saved.';return} Live.setKey(k); inp.value=''; await Live.start(); paintKeyState(); UI.applyLive(); o.textContent='Saved on this device. SPY '+n(r.px)+'.' };
  $('#key-remove').onclick=()=>{ Live.setKey(''); Live.stop(true); Live.state='nokey'; Live.err=''; Prices.seed(D); paintKeyState(); UI.applyLive(); $('#key-test').textContent='Key removed from this device.' };
  const sw=$('#sw-check'); if(sw) sw.onclick=()=>{ SW.check(); UI.toast('Checking for an update') };
}
const Net={ok:true};
async function loadData(){
  if(location.protocol==='file:'){ UI.stamp(); return }
  try{
    const firstFetch=!D; const r=await fetch(firstFetch?'data.json':'data.json?t='+Date.now(), firstFetch?{}:{cache:'no-store'});
    if(!r.ok) throw new Error('HTTP '+r.status);
    const d=await r.json();
    Net.ok=r.headers.get('X-SD-Offline')!=='1';
    const first=!D, changed=first||d.generated_at!==D.generated_at;
    if(changed){ setData(d); Live.seed(); render(); if(!first) UI.toast('Ledger updated '+String(d.as_of||d.generated_at).slice(11,16)+' ET'); if(first&&Live.key()) Live.start(); else Live.resubscribe() }
  }catch(e){
    Net.ok=false;
    if(!D) $('#app').innerHTML='<div class="empty">Could not load the ledger. '+(navigator.onLine?'Retrying.':'You are offline.')+'</div>';
  }
  UI.stamp();
  const off=$('#offline'); if(off) off.hidden=Net.ok&&navigator.onLine;
  const p=$('#pull span'); if(p) p.textContent='Pull to refresh';
}
function wake(){ if(document.visibilityState==='hidden') return; loadData(); Live.wake(); SW.check() }
if(window.__SD_DATA__){ setData(window.__SD_DATA__); Live.seed(); render(); if(Live.key()) Live.start() }
else $('#app').innerHTML='<div class="skel"></div>';
loadData();
setInterval(loadData, 60e3);
setInterval(()=>Live.tick(), 15e3);
document.addEventListener('visibilitychange', wake);
addEventListener('pageshow', e=>{ Live.wake(); if(e.persisted) loadData() });
addEventListener('online', loadData);
addEventListener('offline', ()=>{ const o=$('#offline'); if(o) o.hidden=false });
let py=0;
addEventListener('touchstart', e=>{ py=e.touches[0].clientY }, {passive:true});
addEventListener('touchmove', e=>{
  if(scrollY>2) return;
  const dy=e.touches[0].clientY-py; const p=$('#pull');
  if(dy>24){ p.classList.add('show'); p.style.height=Math.min(56, dy*0.35)+'px' }
}, {passive:true});
addEventListener('touchend', ()=>{
  const p=$('#pull');
  if(p.classList.contains('show') && parseFloat(p.style.height)>32){ const s=$('#pull span'); if(s)s.textContent='Refreshing'; loadData(); UI.haptic(8) }
  p.classList.remove('show'); p.style.height='0px';
});
addEventListener('scroll', ()=>{ document.body.classList.toggle('scrolled', scrollY>12) }, {passive:true});
document.addEventListener('click', e=>{
  const tab=e.target.closest('[data-tab]'); if(tab){ gotoTab(tab.dataset.tab); return }
  const th=e.target.closest('[data-theme-set]'); if(th){ localStorage.setItem('sd.theme', th.dataset.themeSet); Theme.apply(); render(); return }
  const ac=e.target.closest('[data-acct]'); if(ac){ state.acct=ac.dataset.acct; render(); return }
  const rc=e.target.closest('[data-recs]'); if(rc){ state.recs=rc.dataset.recs; render(); return }
  const act=e.target.closest('[data-act]'); if(act){ state.act=act.dataset.act; render(); return }
  const ins=e.target.closest('[data-ins]'); if(ins){ state.ins=ins.dataset.ins; render(); return }
  const tr=e.target.closest('[data-trade]'); if(tr){ if(held){held=false;return} Sheet.trade(tr.dataset.trade); return }
  const jp=e.target.closest('[data-jump]'); if(jp){ const t=T.find(x=>(x.status==='OPEN'||x.status==='PENDING')&&x.ticker===jp.dataset.jump); if(t) Sheet.trade(t.id); return }
  if(e.target.closest('[data-install]')){ Install.go(); return }
  if(e.target.closest('[data-close]')||e.target.id==='scrim'){ Sheet.close(); $('#sheet-ios').hidden=true; $('#scrim').hidden=true; return }
  const dis=e.target.closest('[data-dismiss]'); if(dis){ const seen=JSON.parse(sessionStorage.getItem('sd.x')||'{}'); seen[dis.dataset.dismiss]=1; sessionStorage.setItem('sd.x', JSON.stringify(seen)); UI.applyLive() }
});
let hold, held=false;
document.addEventListener('pointerdown', e=>{
  const tr=e.target.closest('[data-trade]'); if(!tr) return;
  hold=setTimeout(()=>{ held=true; UI.haptic(18); const t=T.find(x=>x.id===tr.dataset.trade); if(!t)return;
    Sheet.open(`<div class="sheet-h"><div class="grab"></div><button class="x" data-close>Close</button></div><div class="sheet-body"><h2>${esc(t.ticker)}</h2><button class="btn" id="act-open">View position</button><button class="btn" id="act-copy">Copy ticker</button></div>`);
    $('#act-open').onclick=()=>Sheet.trade(t.id);
    $('#act-copy').onclick=()=>{ navigator.clipboard&&navigator.clipboard.writeText(t.ticker); UI.toast('Copied '+t.ticker); Sheet.close() };
  }, 520);
});
document.addEventListener('pointerup', ()=>clearTimeout(hold));
document.addEventListener('pointermove', ()=>clearTimeout(hold));
document.getElementById('install-dismiss').onclick=()=>{ localStorage.setItem('sd.install.dismissed','1'); const b=document.getElementById('install-banner'); if(b) b.hidden=true };
function paintBanner(){
  const b=document.getElementById('install-banner'); if(!b) return;
  const standalone=matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  b.hidden = standalone || localStorage.getItem('sd.install.dismissed')==='1';
}
paintBanner();
addEventListener('appinstalled', paintBanner);
Theme.apply(); Install.init(); SW.init();
window.__ok=true;

})();
