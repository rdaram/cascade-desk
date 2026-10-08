(function(){
"use strict";
/* Swing Desk app. Paper trading only. Live prices are informational; the official ledger is data.json. */
const APP_VERSION='465d59dd9e';
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
  if(t.status==='OPEN')return t.t2_hit?['T2 hit','t1']:t.t1_hit?['T1 hit','t1']:['Open','live'];
  return['Pending','pend'];
}
function conf(t){const c=((t.reasoning||{}).confidence||{}).rating;return c?[c+' confidence',c==='High'?'hi':c==='Medium'?'md':'lo']:null}
function pnlOf(t){if(t.status==='CLOSED')return t.realized_pnl;if(t.status==='OPEN')return (t.unrealized_pnl||0)+(t.realized_partial||0);return null}
function ledgerSpot(t){return t.last_spot||((TECH[t.ticker]||{}).close)||((t.indicative_latest||{}).spot)||((t.indicative||{}).spot)}
function spotOf(t){const q=Live.quote(t.ticker);return q&&q.p!=null?q.p:ledgerSpot(t)}
const SETUPN={breakout:'Breakout',pullback:'Pullback',drift:'Post-catalyst drift',reversal:'Oversold reversal'};
function entryRef(t){const f=(t.fills||[]).find(x=>x.kind==='entry'||x.side==='buy');const lv=(t.reasoning||{}).levels||{};return f&&f.fill_price!=null?f.fill_price:(t.plan||{}).entry??lv.entry??(t.user_levels||{}).entry??((t.indicative||{}).spot)}
function orderText(t,short){const o=t.entry_order||{};
  if(o.kind==='buy_stop')return (short?'Buy-stop ':'Buy-stop ')+n(o.trigger);
  if(o.kind==='limit_zone')return 'Limit zone '+n(o.zone[0])+'-'+n(o.zone[1]);
  return o.type==='market'?'Market, next 9:45 ET bar':'Trigger '+n(o.trigger)}
function setupName(t){
  const sh=t.contracts_open??t.contracts;
  if(t.setup_type&&SETUPN[t.setup_type])return `${SETUPN[t.setup_type]} · ${n(sh,0)} shares`;
  return `${t.direction==='short'?'Short':'Long'} ${n(sh,0)} shares${t.book==='mambo'?' · your pick':''}`;
}
const rrTxt=x=>x==null?'n/a':String(Math.round(x*100)/100);
function earnTxt(t){const e=t.earnings||{};if(!e.date)return 'n/a';const est=(e.note||'').startsWith('ESTIMATE');return `${dshort(e.date)}${est?' est.':''}`}

/* ---------- charts ---------- */
function candleChart(t){
  const tc=TECH[t.ticker];const lv=(t.reasoning||{}).levels||{};
  if(!tc||!tc.candles||!tc.candles.length)return `<div class="empty">Chart data unavailable</div>`;
  const C=tc.candles.slice(-(innerWidth<480?46:innerWidth<900?60:72)),W=640,H=230,PR=78,PT=12,PB=22;
  const ref=entryRef(t),zone=(t.entry_order||{}).kind==='limit_zone'&&t.status==='PENDING'?t.entry_order.zone:null;
  const lv2=[lv.stop,lv.t1,lv.t2,ref,...(zone||[])].filter(x=>x!=null);
  let lo=Math.min(...C.map(c=>c[3]),...lv2),hi=Math.max(...C.map(c=>c[2]),...lv2);const padv=(hi-lo)*.06;lo-=padv;hi+=padv;
  const y=v=>PT+(hi-v)/(hi-lo)*(H-PT-PB), step=(W-PR)/C.length, bw=Math.max(2,step*.62);
  let g='';for(let i=0;i<4;i++){const yy=PT+i*(H-PT-PB)/3;g+=`<line class="grid-l" x1="0" x2="${W-PR}" y1="${yy}" y2="${yy}"/>`}
  let cs='';C.forEach((c,i)=>{const x=i*step+step/2,up=c[4]>=c[1],col=up?'#3ddc97':'#ff6b6b';
    cs+=`<line x1="${x}" x2="${x}" y1="${y(c[2])}" y2="${y(c[3])}" stroke="${col}" stroke-opacity=".55" stroke-width="1"/>`+
        `<rect x="${x-bw/2}" y="${y(Math.max(c[1],c[4]))}" width="${bw}" height="${Math.max(1,Math.abs(y(c[1])-y(c[4])))}" rx="1" fill="${col}" fill-opacity="${up?.85:.75}"/>`});
  const short=t.direction==='short';let zones='',lines='',labels='';
  if(ref!=null&&lv.stop!=null)zones+=`<rect x="0" width="${W-PR}" y="${Math.min(y(ref),y(lv.stop))}" height="${Math.abs(y(ref)-y(lv.stop))}" fill="#ff6b6b" fill-opacity=".06"/>`;
  if(zone)zones+=`<rect x="0" width="${W-PR}" y="${y(zone[1])}" height="${Math.max(2,y(zone[0])-y(zone[1]))}" fill="#c9ced6" fill-opacity=".10"/>`;
  if(ref!=null&&lv.t2!=null)zones+=`<rect x="0" width="${W-PR}" y="${Math.min(y(ref),y(lv.t2))}" height="${Math.abs(y(ref)-y(lv.t2))}" fill="#3ddc97" fill-opacity=".05"/>`;
  const L=[['Stop',lv.stop,'#ff6b6b','5 4'],[t.status==='PENDING'?((t.entry_order||{}).kind==='buy_stop'?'Buy':'Limit'):'Entry',ref,'#c9ced6','2 4'],['T1',lv.t1,'#5eead4','5 4'],['T2',lv.t2,'#3ddc97','']];
  const used=[];L.forEach(([nm,v,col,da])=>{if(v==null)return;let yy=y(v);lines+=`<line x1="0" x2="${W-PR}" y1="${yy}" y2="${yy}" stroke="${col}" stroke-width="1.2" stroke-dasharray="${da}" stroke-opacity=".9"/>`;
    let ly=yy;used.forEach(u=>{if(Math.abs(u-ly)<15)ly=u+(ly>=u?15:-15)});used.push(ly);
    labels+=`<rect x="${W-PR+6}" y="${ly-9}" width="${PR-8}" height="18" rx="5" fill="${col}" fill-opacity=".14"/><text x="${W-PR+12}" y="${ly+4}" style="fill:${col}">${nm} ${n(v,v>=100?0:2)}</text>`});
  const last=C[C.length-1],cx=(C.length-1)*step+step/2,cy=y(spotOf(t)||last[4]);
  const mk=`<line x1="${cx}" x2="${W-PR}" y1="${cy}" y2="${cy}" stroke="#fff" stroke-opacity=".35" stroke-dasharray="1 3"/><circle cx="${cx}" cy="${cy}" r="4.5" fill="#fff"/><circle cx="${cx}" cy="${cy}" r="9" fill="#fff" fill-opacity=".15"/>`;
  const axis=`<text x="2" y="${H-6}">${dshort(C[0][0])}</text><text x="${W-PR-4}" y="${H-6}" text-anchor="end">${dshort(last[0])}</text>`;
  return `<div class="chart-wrap" data-tk="${esc(t.ticker)}" data-n="${C.length}" data-step="${step}" data-w="${W}" data-pr="${PR}" data-lo="${lo}" data-hi="${hi}" data-pt="${PT}" data-pb="${PB}" data-h="${H}"><svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${esc(t.ticker)} daily candles with stop, entry and targets. Drag or hover for prices.">${g}${zones}<g class="draw">${cs}</g>${lines}${mk}${labels}${axis}<line class="xh" x1="0" x2="0" y1="${PT}" y2="${H-PB}"/><line class="yh" x1="0" x2="${W-PR}" y1="0" y2="0"/></svg><div class="tip" role="status" aria-live="off"></div></div>`;
}
function progress(t){
  const lv=(t.reasoning||{}).levels||{};if(lv.stop==null||lv.t2==null)return'';
  const ref=entryRef(t),cur=spotOf(t);
  const p=v=>Math.max(0,Math.min(100,(v-lv.stop)/(lv.t2-lv.stop)*100));
  const lg=[['Stop',lv.stop,'neg'],[t.status==='PENDING'?'Entry':'Filled',ref,''],['T1',lv.t1,'t1c'],['T2',lv.t2,'pos']].filter(x=>x[1]!=null);
  return `<div class="prog"><div class="track" aria-label="price between stop and T2">
    <div class="tick l" style="left:0"></div>
    ${ref!=null?`<div class="tick ent" style="left:${p(ref)}%"></div>`:''}
    ${lv.t1!=null?`<div class="tick t1t" style="left:${p(lv.t1)}%"></div>`:''}
    <div class="tick r" style="left:100%"></div>
    ${cur!=null?`<div class="cur" data-trade="${t.id}" data-stop="${lv.stop}" data-t2="${lv.t2}" style="left:${STATIC?p(cur):0}%" data-left="${p(cur)}"><span>${n(cur)}</span></div>`:''}
  </div><div class="legend num">${lg.map(([k,v,c])=>`<span><i class="${c}">${k}</i> ${n(v)}</span>`).join('')}</div></div>`;
}
function lineChart(series,{h=220,colors=['#8fa2ff','#9aa1ad'],labels=[]}={}){
  const pts=series[0].filter(v=>v!=null);if(pts.length<2)return null;
  const W=900,H=h,P=8,all=series.flat().filter(v=>v!=null);let lo=Math.min(...all),hi=Math.max(...all);if(hi-lo<1){hi+=500;lo-=500}
  const y=v=>P+(hi-v)/(hi-lo)*(H-2*P);
  let out=`<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block"><defs><linearGradient id="ga" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${colors[0]}" stop-opacity=".28"/><stop offset="1" stop-color="${colors[0]}" stop-opacity="0"/></linearGradient></defs>`;
  for(let i=0;i<4;i++)out+=`<line x1="0" x2="${W}" y1="${P+i*(H-2*P)/3}" y2="${P+i*(H-2*P)/3}" stroke="rgba(255,255,255,.05)"/>`;
  series.forEach((s,si)=>{const m=s.length;const xy=s.map((v,i)=>v==null?null:[i/(m-1)*W,y(v)]).filter(Boolean);if(xy.length<2)return;
    const d='M'+xy.map(p=>p.map(v=>v.toFixed(1)).join(',')).join('L');
    if(si===0)out+=`<path d="${d}L${xy[xy.length-1][0]},${H}L${xy[0][0]},${H}Z" fill="url(#ga)"/>`;
    out+=`<path class="${STATIC?'':'drawline'}" d="${d}" fill="none" stroke="${colors[si]}" stroke-width="${si?1.4:2.2}" stroke-dasharray="${si?'4 4':''}" stroke-linejoin="round"/>`});
  out+=`</svg><div class="num dim" style="display:flex;justify-content:space-between;font-size:11.5px;margin-top:6px"><span>${esc(labels[0]||'')}</span><span>${esc(labels[1]||'')}</span></div>`;
  return out;
}

/* ---------- sections ---------- */
function hero(){
  const m=D.books.main,s=D.books.shadow,mb=D.books.mambo||{equity:100000,pnl_pct:0};
  const live=T.filter(t=>t.status==='OPEN'),pend=T.filter(t=>t.status==='PENDING');
  const liveM=live.filter(t=>t.book==='main'),pendM=pend.filter(t=>t.book==='main');
  const whole=Math.floor(m.equity),cents=(m.equity-whole).toFixed(2).slice(1);
  const tickers=a=>a.map(t=>t.ticker).join(', ');
  let sentence=liveM.length?`<b>${liveM.length} trade${liveM.length>1?'s are':' is'} open</b> (${tickers(liveM)}).`:`<b>No open trades yet.</b>`;
  if(pendM.length){const vu=(pendM[0].entry_order||{}).valid_until;sentence+=` ${pendM.length} Main swing entry order${pendM.length>1?'s are':' is'} resting (${tickers(pendM)})${vu?', valid through '+dshort(vu):''}: buy-stops for breakouts, limit zones for pullbacks. ${pend.length-pendM.length} next-best setups are tracked in Shadow.`}
  const nx=((D.next||[]).filter(x=>x.book==='main'))[0];if(nx)sentence+=` Next on the calendar: <b>${esc(nx.label)}</b> on ${dshort(nx.date)}.`;
  const chip=m.pnl>0?'up':m.pnl<0?'down':'flat';
  const liveList=(liveM.length?liveM:pendM).slice(0,5).map(t=>{const[st,sc]=status(t),p=pnlOf(t);
    return `<a class="li" href="#tc-${t.id}" data-tk-row="${t.ticker}"><span class="pill ${sc}" style="min-width:70px;justify-content:center">${st}</span><span class="what"><b>${t.ticker}</b> <span class="mute">${esc(setupName(t))}</span><div class="num dim" style="font-size:12px;margin-top:2px">${esc(orderText(t,1))}${p==null&&(t.entry_order||{}).valid_until?' · to '+dshort(t.entry_order.valid_until):''}</div></span><span class="num ${cls(p)}" style="text-align:right;white-space:nowrap">${p==null?`<span class="mute">${usd(t.max_risk_usd)} risk</span>`:susd(p)}</span></a>`}).join('');
  const NX=(D.next||[]).filter(x=>x.book==='main');const nextList=(NX.length?NX:(D.next||[])).slice(0,5).map(x=>`<div class="li"><span class="kind ${x.kind}"></span><span class="when num">${dshort(x.date)}</span><span class="what">${esc(x.label)} <span class="dim">· ${daysTo(x.date)}d</span></span></div>`).join('');
  return `<section class="hero" id="overview"><div class="hero-grid">
   <div class="card pad reveal" style="padding:30px">
     <div class="eyebrow">Main paper account · Swing v${esc(D.method.version)}</div>
     <div class="big num" id="hero-eq"><span data-count="${whole}" data-fmt="usd0">$${n(whole,0)}</span><span class="cents">${cents}</span></div><div class="live-note" id="hero-live"></div>
     <div style="display:flex;gap:10px;align-items:center;margin-top:14px;flex-wrap:wrap"><span class="chip ${chip} num">${susd(m.pnl,2)} · ${pct(m.pnl_pct)}</span><span class="mute" style="font-size:13.5px">since ${dshort((D.accounts||{}).inception||'2026-10-07')} · SPY ${pct((ACC.main||{}).spy_return_pct)}</span></div>
     <p class="lede">${sentence}</p>
     <div class="mini">${['main','shadow','mambo'].map(b=>{const k=D.books[b]||{equity:100000,pnl_pct:0};return `<div class="m" data-goacct="${b}"><div class="k">${BOOKN[b]} account</div><div class="v num" id="mini-eq-${b}">${usd(k.equity)}</div><div class="num ${cls(k.pnl_pct)}" style="font-size:12px" id="mini-pct-${b}">${pct(k.pnl_pct)}</div></div>`}).join('')}</div>
   </div>
   <div class="grid" style="gap:16px">
     <div class="card pad reveal" style="--d:.08s"><div class="head" style="margin:0 0 6px"><h3>${liveM.length?'Open positions':'What is queued'}</h3><span class="pill ${liveM.length?'live':'pend'}">${liveM.length?liveM.length+' open':pendM.length+' pending'}</span></div><div class="list">${liveList||'<div class="empty">No Main positions.</div>'}</div></div>
     <div class="card pad reveal" style="--d:.16s"><div class="head" style="margin:0 0 6px"><h3>What's next</h3><span class="dim" style="font-size:12px">earnings · order expiry · time stops</span></div><div class="list">${nextList||'<div class="empty">Nothing scheduled.</div>'}</div></div>
   </div></div></section>`;
}
function accountSec(){
  return `<section id="account"><div class="head"><div><div class="eyebrow">Paper account</div><h2>Simulated brokerage, fully traceable</h2>
   <p class="sub">Every recommendation is logged unchanged in the recommendations log, and its paper trade opens and closes at the exact moment and price its rules trigger. Each fill cites the bar or quote used.</p></div>
   <div class="seg" id="acct-seg">${['main','shadow','mambo'].map(b=>`<button data-acct="${b}" class="${b===state.acct?'on':''}">${BOOKN[b]}</button>`).join('')}</div></div>
   <div id="acct-body"></div></section>`;
}
function renderAccount(){
  const b=state.acct,a=ACC[b]||{},k=D.books[b]||{};
  const key=b==='main'?'equity':b+'_equity',H=D.equity_history||[],spy0=(D.accounts||{}).spy_inception_close;
  const eq=H.map(h=>h[key]).filter(v=>v!=null),spy=H.filter(h=>h[key]!=null).map(h=>h.spy&&spy0?h.spy/spy0*(a.start_cash||100000):null);
  const ch=lineChart([eq,spy],{labels:[dshort((H.find(h=>h[key]!=null)||{}).t),dshort((H[H.length-1]||{}).t)]});
  const tiles=[['Account value',`<span id="acct-eq">${usd(a.equity,2)}</span>`,`<span id="acct-eq-s">${pct(a.return_pct)} total</span>`],['Cash',usd(a.cash,2),'start '+usd(a.start_cash)],['Positions',`<span id="acct-mv">${usd(a.market_value,2)}</span>`,(a.open||0)+' open · '+(a.pending||0)+' pending'],
   ['vs SPY',a.vs_spy_pct==null?'n/a':pct(a.vs_spy_pct),'SPY '+pct(a.spy_return_pct)],['Realized',susd(a.realized,2),(a.closed||0)+' closed'],['Unrealized',`<span id="acct-ur">${susd(a.unrealized,2)}</span>`,`<span id="acct-ur-s">ledger mark</span>`],
   ['Win rate',a.win_rate==null?'n/a':n(a.win_rate,0)+'%','avg win '+usd(a.avg_win)+' · loss '+usd(a.avg_loss)],['Expectancy',a.expectancy_R==null?'n/a':(a.expectancy_R>0?'+':'')+n(a.expectancy_R,2)+'R','profit factor '+(a.profit_factor??'n/a')],
   ['Max drawdown',a.max_drawdown_pct==null?'n/a':n(a.max_drawdown_pct,2)+'%','from equity peak'],['T1 hit rate',a.t1_hit_rate==null?'n/a':n(a.t1_hit_rate,0)+'%','of filled trades'],['T2 hit rate',a.t2_hit_rate==null?'n/a':n(a.t2_hit_rate,0)+'%','of filled trades'],['Cancelled',String(a.cancelled||0),b==='mambo'?'not triggered':'incl. retired v1 orders']];
  const pos=(a.positions||[]).map(p=>`<tr><td><b>${p.ticker}</b><div class="dim num" style="font-size:11.5px;white-space:nowrap">${p.trade_id}<br>${p.rec_id||''}</div></td><td class="num">${p.qty}</td><td class="num">${n(p.avg_entry)}</td><td class="num" data-pos-last="${p.trade_id}">${n(p.last_value)}</td><td class="num" data-pos-mv="${p.trade_id}">${usd(p.market_value)}</td><td class="num ${cls(p.unrealized)}" data-pos-pl="${p.trade_id}">${susd(p.unrealized)}</td><td class="num">${p.stop??''}${p.t1_hit?' <span class="pill t1">T1</span>':''}</td></tr>`).join('');
  const pend=T.filter(t=>t.book===b&&t.status==='PENDING').map(t=>`<tr><td><b>${t.ticker}</b><div class="dim num" style="font-size:11.5px;white-space:nowrap">${t.id}<br>${t.rec_id||''}</div></td><td class="num">${n(t.contracts,0)}</td><td colspan="4" class="mute" style="font-size:13px">${esc(orderText(t))}${(t.entry_order||{}).valid_until?' · valid through '+dshort(t.entry_order.valid_until):''} · ${usd(t.position_usd||t.max_risk_usd)} · risk ${usd(t.max_risk_usd)}</td><td class="num">${(t.plan||{}).stop??((t.reasoning||{}).levels||{}).stop??''}</td></tr>`).join('');
  const fl=FILLS.filter(f=>f.account===b).slice().reverse();
  const fills=fl.map(f=>`<tr id="fill-${f.fill_id}"><td class="num" style="white-space:nowrap">${dshort(f.filled_at)}</td><td><b>${f.ticker}</b> <span class="mute">${esc(f.kind.replace('_',' '))}</span><div class="dim num" style="font-size:11.5px">${f.fill_id} · ${f.rec_id||''}</div></td><td>${esc(f.side.replace(/_/g,' '))}</td><td class="num">${f.kind==='cancel'?'0':f.qty+' '+esc(f.unit||'')}</td><td class="num">${f.fill_price==null?'':n(f.fill_price)}${f.trigger_price!=null?`<div class="dim" style="font-size:11.5px">trigger ${n(f.trigger_price)}</div>`:''}</td><td class="mute" style="font-size:12.5px;min-width:260px">${esc(f.order_type)}<div class="dim">${esc(f.price_source)} · fees ${usd(f.fees,2)}</div></td></tr>`).join('');
  $('#acct-body').innerHTML=`
   <div class="grid g4" style="margin-bottom:16px">${tiles.map((x,i)=>`<div class="card tile reveal in" style="--d:${i*.03}s"><div class="k">${x[0]}</div><div class="v num">${x[1]}</div><div class="s num">${x[2]}</div></div>`).join('')}</div>
   <div class="card pad" style="margin-bottom:16px"><div class="head" style="margin-bottom:12px"><h3>Equity vs SPY</h3><span class="dim" style="font-size:12.5px"><span style="color:var(--acc)">━</span> ${BOOKN[b]} account &nbsp; <span class="mute">┅</span> SPY, same start</span></div>
     ${ch||`<div class="empty">The curve starts with the first marks. ${a.pending?a.pending+' entry orders are resting; they fill only if the trigger trades in the next 5 sessions.':''}</div>`}</div>
   <div class="grid g2">
     <div class="card"><div class="pad" style="padding-bottom:6px"><h3>Positions & working orders</h3></div><div class="tbl-wrap"><table class="stack"><thead><tr><th>Ticker</th><th>Qty</th><th>Entry</th><th>Last</th><th>Value</th><th>P&L</th><th>Stop</th></tr></thead><tbody>${pos+pend||'<tr><td colspan="7" class="empty">No positions.</td></tr>'}</tbody></table></div></div>
     <div class="card" id="fills"><div class="pad" style="padding-bottom:6px"><h3>Fills ledger</h3><div class="dim" style="font-size:12.5px">Append-only (fills.jsonl). Every fill cites its rec id and price source.</div></div><div class="tbl-wrap" style="max-height:440px;overflow:auto"><table class="stack"><thead><tr><th>Time ET</th><th>Trade</th><th>Side</th><th>Qty</th><th>Price</th><th>Order / source</th></tr></thead><tbody>${fills||`<tr><td colspan="6" class="empty">No fills yet in this account.${(a.pending||0)?' '+a.pending+' orders are working.':''}</td></tr>`}</tbody></table></div></div>
   </div>`;
  $$('#acct-seg button').forEach(x=>x.classList.toggle('on',x.dataset.acct===b));
  animateLines($('#acct-body'));
}
function tradeCard(t,i){
  const[st,sc]=status(t),cf=conf(t),r=t.reasoning||{},lv=r.levels||{},wl=r.why_levels||{},p=pnlOf(t),pl=t.plan||{};
  const o=t.entry_order||{},ent=entryRef(t),sp=spotOf(t);
  const f0=(t.fills||[]).find(x=>x.kind!=='cancel'),fl=(t.fills||[]).slice(-1)[0];
  const ed=(t.earnings||{}).date,edays=daysTo(ed);
  let strip;
  if(t.status==='PENDING'){const dist=o.kind==='limit_zone'?(sp/o.zone[1]-1)*100:o.trigger?(o.trigger/sp-1)*100:null;
    strip=`<span><span class="pill pend">Order resting</span> <span class="mute">${esc(orderText(t))}${o.valid_until?' · valid through '+dshort(o.valid_until):''}${dist!=null&&sp?` · last ${n(sp)} (${o.kind==='limit_zone'?(dist<=0?'inside the zone':pct(dist,1)+' above the zone'):pct(dist,1)+' to trigger'})`:''}</span></span><span class="num mute">${t.id}</span>`}
  else if(t.status==='CANCELLED')strip=`<span class="mute">Cancelled: ${esc(t.cancel_reason||'')}</span><span class="num mute">${t.id}</span>`;
  else strip=`<span>Filled <b class="num">${n(f0?f0.fill_price:ent)}</b> <span class="mute num">${dshort(f0?f0.filled_at:t.opened_at)}</span> · <b class="num ${cls(p)}">${susd(p)}</b> ${t.status==='CLOSED'?'final':'open'}</span><a href="#fill-${(fl||f0||{}).fill_id||''}" data-fill="${(fl||f0||{}).fill_id||''}" data-acct="${t.book}" class="num">${t.id} ↗</a>`;
  const risks=(r.risks||[]).map(x=>`<li>${esc(x)}</li>`).join('');
  const exitRules=pl.entry?`Stop ${n(lv.stop)} first (every 5-minute bar; a gap below fills at the open). T1 ${n(lv.t1)}: sell half, stop to breakeven. T2 ${n(lv.t2)}: sell the rest. Time stop ${t.time_stop_weeks||pl.time_stop_weeks} weeks after the fill${t.status==='OPEN'&&t.time_stop?' ('+dshort(t.time_stop)+')':''}. Earnings rule at the close before the report.`:esc((t.kill_switch||{}).text||'');
  const rs=r.error?`<p class="mute">Reasoning unavailable: ${esc(r.error)}</p>`:`
     ${r.summary?`<p class="sum">${esc(r.summary)}</p>`:''}
     <h4>Why this stock</h4><p>${esc(r.why_stock)}</p>
     <h4>Why now</h4><p>${esc(r.why_now)}</p>
     <h4>Why these levels</h4><p>${esc(wl.entry)}</p><p style="margin-top:8px">${esc(wl.stop)}</p><p style="margin-top:8px">${esc(wl.t1)} ${esc(wl.t2)}</p><p style="margin-top:8px">${esc(wl.realism)}</p>
     <h4>What could go wrong</h4><ul>${risks}</ul>
     <h4>Confidence</h4><p>${esc((r.confidence||{}).why)}</p>
     ${t.book!=='main'&&t.why_not_main_detail?`<h4>Why it is not in the Main account</h4><p>${esc(t.why_not_main_detail)}</p>`:''}
     ${t.postmortem?`<h4>${t.realized_pnl>0?'Why it worked':'Why it failed'}</h4><p>${esc(t.postmortem.why||t.postmortem.one_liner)}</p>`:''}
     <h4>Exit rules</h4><p>${exitRules}</p>`;
  const sz=t.sizing||{};
  const kv=[
    ['Entry',`${o.kind==='buy_stop'?'Buy-stop ':o.kind==='limit_zone'?'Limit ':''}${n(ent)}`,''],
    ['Stop',lv.stop!=null?n(lv.stop):'n/a',`neg" title="${pl.stop_pct!=null?n(pl.stop_pct*100,1)+'% below entry':''}`],
    ['T1 / T2',`${lv.t1!=null?n(lv.t1,lv.t1>=100?0:2):'n/a'} / ${lv.t2!=null?n(lv.t2,lv.t2>=100?0:2):'n/a'}`,'pos'],
    ['Time stop',t.status==='OPEN'&&t.time_stop?`${dshort(t.time_stop)} <span class="dim">${daysTo(t.time_stop)}d</span>`:`${t.time_stop_weeks||pl.time_stop_weeks||'n/a'} wks`,''],
    ['Shares',`${n(t.contracts_open??t.contracts,0)} <span class="dim">${usd(t.position_usd||sz.position_usd)}</span>`,''],
    ['Risk',`${usd(t.max_risk_usd)}${t.risk_pct_of_equity!=null?` <span class="dim">${n(t.risk_pct_of_equity,2)}%</span>`:''}`,''],
    ['R:R',rrTxt(t.rr??pl.rr),''],
    [t.status==='OPEN'||t.status==='CLOSED'?'P&L':'Earnings',t.status==='OPEN'||t.status==='CLOSED'?(p==null?'n/a':susd(p)):`${earnTxt(t)}${edays!=null&&edays>=0?` <span class="dim">${edays}d</span>`:''}`,t.status==='OPEN'||t.status==='CLOSED'?cls(p):(t.earnings||{}).trading_days_away!=null&&(t.earnings||{}).trading_days_away<=10?'warn':'']];
  return `<article class="card hov tc reveal" id="tc-${t.id}" style="--d:${Math.min(i,8)*.05}s">
   <div class="tc-h"><div><div class="tk">${t.ticker}</div><div class="setup">${esc(setupName(t))}${t.sector?` <span class="dim">· ${esc(t.sector)}</span>`:''}</div></div>
     <div class="pills"><span class="pill ${sc}">${st}</span>${cf?`<span class="pill ${cf[1]}">${cf[0]}</span>`:''}${t.book!=='main'?`<span class="pill acc">${BOOKN[t.book]}</span>`:''}${(t.scores||{}).total!=null?`<span class="pill num">${n(t.scores.total,0)}/100</span>`:''}</div></div>
   ${candleChart(t)}
   ${progress(t)}
   ${t.status==='OPEN'||t.status==='PENDING'?`<div class="liverow" data-trade="${t.id}"></div>`:''}
   <div class="kv">${kv.map(([k,v,c])=>`<div><div class="k">${k}</div><div class="v num ${c}"${k==='P&L'?` data-pnl="${t.id}"`:''}>${v}</div></div>`).join('')}</div>
   <div class="strip">${strip}</div>
   <button class="drawer-btn" aria-expanded="false"><span>Why this trade${(r.confidence||{}).rating?` <span class="mute" style="font-weight:400">· ${esc(r.confidence.rating)} confidence</span>`:''}</span><svg class="chev" width="16" height="16" viewBox="0 0 16 16"><path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round"/></svg></button>
   <div class="drawer"><div><div class="rs">${rs}</div></div></div>
   <div class="foot"><span>${t.id} · rec ${t.rec_id||'n/a'}</span><span>method v${t.method_version} · issued ${dshort(t.created_at)} ET</span></div>
  </article>`;
}
function tradesSec(){
  const cnt=b=>T.filter(t=>(b==='all'||t.book===b)&&t.status!=='CANCELLED').length;
  return `<section id="trades"><div class="head"><div><div class="eyebrow">Swing setups</div><h2>Every setup, with its reasoning and its paper trade</h2>
   <p class="sub">Main = the best setups the rules allow (max 5, max 2 per sector, sized to the cash on hand). Shadow = the next-best setups that one rule kept out, tracked the same way so we learn which rules help. Mambo = your own picks (<span class="num">run.py add-rec</span>).</p></div>
   <div class="seg" id="rec-seg">${['main','shadow','mambo','all'].map(b=>`<button data-recs="${b}" class="${b===state.recs?'on':''}">${b==='all'?'All':BOOKN[b]} <span class="dim num">${cnt(b)}</span></button>`).join('')}</div></div>
   <div class="cards" id="cards"></div></section>`;
}
function renderCards(){
  const b=state.recs,order={OPEN:0,PENDING:1,CLOSED:2,CANCELLED:3};
  const ts=T.filter(t=>b==='all'||t.book===b).sort((x,y)=>order[x.status]-order[y.status]||(x.book==='main'?0:1)-(y.book==='main'?0:1)||((y.scores||{}).total||0)-((x.scores||{}).total||0));
  $('#cards').innerHTML=ts.map(tradeCard).join('')||`<div class="card empty" style="grid-column:1/-1">No recommendations in this account yet.${b==='mambo'?' Log one with: python run.py add-rec TICKER --entry 52.40 --stop 48.80 --reason "..." (T1 +10% and T2 +20% by default)':''}</div>`;
  $$('#rec-seg button').forEach(x=>x.classList.toggle('on',x.dataset.recs===b));
  observe($('#cards'));
}
function activitySec(){
  const ev=(D.alerts||[]).slice(0,16).map(a=>`<div class="ev ${a.type}"><div class="t">${dshort(a.t)} ET · ${esc(a.type.replace('_',' '))}${a.book?' · '+esc(BOOKN[a.book]||a.book):''}</div><div class="x">${esc(a.text.length>320?a.text.slice(0,320)+'…':a.text)}</div></div>`).join('');
  const pm=(D.postmortems||[]).slice(0,6).map(p=>`<div class="li"><span class="pill ${p.outcome==='win'?'live':p.outcome==='loss'?'lo':'closed'}">${esc(p.outcome)}</span><span class="what">${esc(p.why||p.one_liner)}<div class="dim num" style="font-size:11.5px">${p.trade_id} · ${p.r_multiple!=null?(p.r_multiple>0?'+':'')+n(p.r_multiple,2)+'R':''}</div></span></div>`).join('');
  return `<section id="activity"><div class="head"><div><div class="eyebrow">Activity</div><h2>Alerts and post-mortems</h2><p class="sub">The same alerts are written to out/alerts_full.md on every scan and mark, ready to send as is.</p></div></div>
   <div class="grid g2 top"><div class="card pad reveal"><h3 style="margin-bottom:16px">Latest alerts</h3><div class="tl scrolly">${ev||'<div class="empty">No alerts yet.</div>'}</div></div>
   <div class="card pad reveal" style="--d:.08s"><h3 style="margin-bottom:6px">Post-mortems</h3><p class="mute" style="font-size:13.5px;margin:0 0 6px">Written automatically when a trade closes: exit type (stop, breakeven stop, T2, time stop, earnings exit), entry slippage vs the trigger, best and worst excursion (MFE/MAE in R), what it gave back, and the lesson.</p><div class="list">${pm||'<div class="empty">None yet. The first one is written when a trade closes.</div>'}</div></div></div></section>`;
}
function learningSec(){
  const rv=D.review||{},gates=rv.gates||[],cal=rv.calibration||{},props=rv.proposals||[];
  const vers=(D.versions||[]).map(v=>`<div class="vstep"><div style="display:flex;gap:8px;align-items:center"><span class="pill ${v.status==='active'?'live':'closed'}">v${esc(v.version)}</span><span class="dim num" style="font-size:12px">${dshort(v.date)}</span></div><p class="mute" style="font-size:13px;margin:10px 0 0">${esc((v.changes||[]).join(' '))}</p></div>`).join('');
  const CH=(D.challengers||[]),retired=CH.filter(c=>c.status==='retired').length;
  const ch=CH.filter(c=>c.status!=='retired').map(c=>{const g=gates.find(x=>x.challenger===c.id)||{};
    return `<tr><td><b class="num">${esc(c.id)}</b><div class="dim" style="font-size:12px">${esc(c.tag||c.bucket||'')}</div></td><td style="min-width:260px;font-size:13px" class="mute">${esc(c.hypothesis)}</td><td><span class="pill ${c.status==='active'?'acc':c.status==='promoted'?'live':'closed'}">${esc(c.status)}</span></td><td class="num">${g.n_closed??0} / ${g.n_open??0}</td><td class="num">${g.avg_R==null?'n/a':n(g.avg_R,2)+'R'}</td><td style="font-size:12.5px;min-width:220px" class="mute">${esc(g.verdict||'')}</td></tr>`}).join('');
  const rules=(rv.rules||[]).map(x=>`<li>${esc(x)}</li>`).join('');
  const ds=rv.risk_state||{};
  return `<section id="learning"><div class="head"><div><div class="eyebrow">How the method is learning</div><h2>Champion vs challengers, with guard rails</h2>
   <p class="sub">The Main rules are the champion. Each swing filter (rank, sector cap, earnings window, stop width, reward:risk, score, liquidity, regime) has a challenger running in the Shadow account. Changes ship only on strong evidence, one at a time, with a changelog and rollback.</p></div>
   <span class="pill ${D.method.risk_mode==='NORMAL'?'live':'lo'}">Risk mode ${esc(D.method.risk_mode)}</span></div>
   <div class="grid g4" style="margin-bottom:16px">
     <div class="card tile reveal"><div class="k">Method version</div><div class="v num">v${esc(D.method.version)}</div><div class="s">${(D.versions||[]).length} version(s) logged</div></div>
     <div class="card tile reveal" style="--d:.04s"><div class="k">Main drawdown</div><div class="v num">${n(ds.main_drawdown_pct,1)}%</div><div class="s">DEFENSIVE at 5%</div></div>
     <div class="card tile reveal" style="--d:.08s"><div class="k">Loss streak</div><div class="v num">${ds.main_loss_streak??0}</div><div class="s">DEFENSIVE at 3</div></div>
     <div class="card tile reveal" style="--d:.12s"><div class="k">Proposed changes</div><div class="v num">${props.length}</div><div class="s">${esc((D.method.last_review||{}).t||'')}</div></div></div>
   <div class="card reveal" style="margin-bottom:16px"><div class="pad" style="padding-bottom:4px"><h3>Version timeline</h3></div><div class="vt">${vers}</div></div>
   <div class="card reveal" style="margin-bottom:16px"><div class="pad" style="padding-bottom:4px"><h3>Challengers and gate effectiveness</h3><div class="dim" style="font-size:12.5px">Shadow setups kept out by each rule vs the Main account, by average R. Closed / open counts.${retired?` ${retired} v1 options/cascade challengers were retired with the strategy change.`:''}</div></div>
     <div class="tbl-wrap"><table class="stack"><thead><tr><th>Challenger</th><th>Hypothesis</th><th>Status</th><th>Trades</th><th>Avg R</th><th>Verdict</th></tr></thead><tbody>${ch}</tbody></table></div></div>
   <div class="grid g2">
     <div class="card pad reveal"><h3>Calibration</h3><p class="mute" style="font-size:14px">${esc(cal.verdict||'')}</p>${props.length?'<h3 style="margin-top:16px">Proposals</h3><ul class="mute">'+props.map(p=>`<li>[${esc(p.strength)}] ${esc(p.change)}</li>`).join('')+'</ul>':'<p class="dim" style="font-size:13.5px">No proposals: no bucket has enough closed trades. That is the overfitting guard working.</p>'}</div>
     <div class="card pad reveal" style="--d:.06s"><h3>Rules in force</h3><ul class="mute" style="font-size:13.5px;padding-left:18px">${rules}</ul></div></div>
   <details class="card acc reveal" style="margin-top:16px;border-top:1px solid var(--line)"><summary><h3>Changelog</h3><svg class="chev" width="16" height="16" viewBox="0 0 16 16"><path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="1.6" fill="none"/></svg></summary><pre style="white-space:pre-wrap;padding:0 20px 20px;margin:0;font:12.5px/1.6 var(--mono);color:var(--mute)">${esc(D.changelog||'')}</pre></details>
  </section>`;
}
function scanSec(){
  const S=D.scan||{};if(!S.funnel)return '';
  const g=S.regime||{},F=S.funnel,SC=S.setup_counts||{},tot=Object.values(SC).reduce((a,b)=>a+b,0)||1;
  const fun=[['Universe',F.universe,'S&P 500 + 400 + Nasdaq-100 + catalyst names'],['With data',F.with_data,'daily bars on '+dshort(S.bar_date)],['Liquid',F.liquid,'price > $5, $20M+/day'],['Setups found',F.uptrend_or_setup,'passed a setup detector'],['Main',S.n_main,'orders resting'],['Shadow',S.n_shadow,'tracked']];
  const setups=Object.entries(SC).map(([k,v])=>`<div class="srow"><span>${esc(SETUPN[k]||k)}</span><div class="bar"><i style="--w:${v/tot*100}%"></i></div><span class="num">${v}</span></div>`).join('');
  const rows=(S.candidates||[]).slice(0,25).map((c,i)=>{const fl=(c.flags||[]).map(f=>`<span class="pill lo" style="font-size:11px">${esc(f.replace('_',' '))}</span>`).join(' ');
    const bk=c.booked?`<span class="pill ${c.booked==='main'?'live':'acc'}">${BOOKN[c.booked]}</span>`:'';
    return `<tr${c.booked?` data-goto="${esc(c.ticker)}"`:''}><td class="num dim">${i+1}</td><td><b>${esc(c.ticker)}</b><div class="dim" style="font-size:12px;max-width:170px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(c.name||'')}</div></td><td>${esc(SETUPN[c.setup]||c.setup)}</td><td><div style="display:flex;gap:8px;align-items:center"><div class="bar" style="width:70px;min-width:70px"><i style="--w:${c.score}%"></i></div><span class="num">${n(c.score,0)}</span></div></td><td class="num">${c.rs_rating}</td><td class="num">${n(c.close)}</td><td class="num">${c.order_kind==='buy_stop'?'stop ':'limit '}${n(c.entry)}<div class="dim" style="font-size:11.5px">${pct(c.distance_to_entry*100,1)}</div></td><td class="num neg">-${n(c.stop_pct*100,1)}%</td><td class="num">${rrTxt(c.rr)}</td><td class="num" style="white-space:nowrap">${c.earnings_date?dshort(c.earnings_date)+((c.earnings_note||'').startsWith('ESTIMATE')?' est.':''):'n/a'}${c.earnings_in_tdays!=null?`<div class="dim" style="font-size:11.5px">${c.earnings_in_tdays} tdays</div>`:''}</td><td style="min-width:120px">${bk} ${fl}${!bk&&!fl?'<span class="dim" style="font-size:12px">not tracked (rank)</span>':''}</td></tr>`}).join('');
  return `<section id="scan"><div class="head"><div><div class="eyebrow">Swing scan · ${dshort(S.bar_date)} close</div><h2>From ${n(F.universe,0)} stocks to ${S.n_main} orders</h2>
   <p class="sub">Daily bars for the whole liquid US universe, four setup detectors, then a 0-100 score (relative strength, trend, setup quality, reward:risk, distance to entry, sector, catalyst, earnings timing). Earnings dates and market caps are checked for the top 70.</p></div>
   <span class="pill ${g.state==='risk-off'?'lo':'live'}">Market ${esc(g.state||'')}</span></div>
   <div class="grid g6 funnel" style="margin-bottom:16px">${fun.map((x,i)=>`<div class="card tile reveal" style="--d:${i*.04}s"><div class="k">${x[0]}</div><div class="v num">${x[1]??'n/a'}</div><div class="s">${x[2]}</div></div>`).join('')}</div>
   <div class="grid g2" style="margin-bottom:16px;grid-template-columns:1fr 1.4fr">
     <div class="card pad reveal"><h3 style="margin-bottom:12px">Market regime</h3><p class="mute" style="font-size:14px;margin:0">SPY closed <b class="num" style="color:var(--text)">${n(g.spy_close)}</b>: ${pct((g.spy_close/g.spy_sma50-1)*100,1)} vs its 50-day (${n(g.spy_sma50)}) and ${pct((g.spy_close/g.spy_sma200-1)*100,1)} vs its 200-day (${n(g.spy_sma200)}); ${pct(g.spy_r63*100,1)} over 3 months. ${g.state==='risk-off'?'Below the 200-day: new Main entries are blocked (regime flag).':'Above the 200-day, so new long entries are allowed.'}</p></div>
     <div class="card pad reveal" style="--d:.06s"><h3 style="margin-bottom:12px">Setups found</h3>${setups}</div></div>
   <div class="card reveal"><div class="pad" style="padding-bottom:6px"><h3>Top candidates</h3><div class="dim" style="font-size:12.5px">Ranked by score. Red tags are the rules that keep a setup out of Main. Tap a booked row to jump to its card.</div></div>
   <div class="cand-m">${(S.candidates||[]).slice(0,25).map((c,i)=>`<div class="cm"${c.booked?` data-goto="${esc(c.ticker)}"`:''}><div class="cm-h"><span class="num dim">${i+1}</span><b>${esc(c.ticker)}</b><span class="mute">${esc(SETUPN[c.setup]||c.setup)}</span><span class="num sc">${n(c.score,0)}</span></div><div class="cm-b num">RS ${c.rs_rating} · ${c.order_kind==='buy_stop'?'stop':'limit'} ${n(c.entry)} (${pct(c.distance_to_entry*100,1)}) · stop -${n(c.stop_pct*100,1)}% · R:R ${rrTxt(c.rr)} · earn ${c.earnings_date?dshort(c.earnings_date)+((c.earnings_note||'').startsWith('ESTIMATE')?' est.':''):'n/a'}</div><div class="cm-t">${c.booked?`<span class="pill ${c.booked==='main'?'live':'acc'}">${BOOKN[c.booked]}</span> `:''}${(c.flags||[]).map(f=>`<span class="pill lo" style="font-size:11px">${esc(f.replace('_',' '))}</span>`).join(' ')}${!c.booked&&!(c.flags||[]).length?'<span class="dim" style="font-size:12px">not tracked (rank)</span>':''}</div></div>`).join('')}</div>
   <div class="tbl-wrap cand-t"><table><thead><tr><th>#</th><th>Ticker</th><th>Setup</th><th>Score</th><th>RS</th><th>Close</th><th>Entry</th><th>Stop</th><th>R:R</th><th>Earnings</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table></div></div></section>`;
}
function recordSec(){
  const rows=RECS.slice().reverse().map(r=>`<tr><td class="num"><b>${r.rec_id}</b>${r.supersedes?`<div class="dim" style="font-size:11.5px">revises ${r.supersedes}</div>`:''}${r.superseded_by?`<div class="warn" style="font-size:11.5px">revised by ${r.superseded_by}</div>`:''}</td><td class="num dim" style="white-space:nowrap">${dshort(r.issued_at)}</td><td><span class="pill ${r.account==='main'?'acc':''}">${BOOKN[r.account]||r.account}</span><div class="dim" style="font-size:11.5px">${esc(r.source)}</div></td><td><b>${esc(r.ticker)}</b> <span class="mute">${esc((r.setup_type||'').replace(/_/g,' '))}</span>${r.record_type==='cancellation'?' <span class="pill cxl" style="font-size:11px">cancellation</span>':''}<div class="dim num" style="font-size:11.5px">v${esc(r.method_version||'1.0')}</div></td><td class="num">${r.stop==null?'<span class="dim">n/a</span>':`${r.stop} / ${r.t1??''} / ${r.t2??''}`}</td><td class="num"><a href="#tc-${r.trade_id}" style="color:var(--acc)">${r.trade_id||''}</a></td><td class="mute" style="font-size:13px;min-width:200px">${esc(r.paper_outcome)}</td></tr>`).join('');
  return `<section id="record"><div class="head"><div><div class="eyebrow">Track record</div><h2>Recommendations log → paper outcome</h2><p class="sub">recs.jsonl is append-only and hash-chained (python run.py verify-recs). A revision or cancellation is a new linked record; the original is never edited. The 14 v1 options/cascade recommendations were cancelled this way when the strategy changed to swing trades.</p></div></div>
   <div class="card reveal"><div class="tbl-wrap" style="max-height:620px;overflow:auto"><table class="stack"><thead><tr><th>Rec</th><th>Issued ET</th><th>Account</th><th>Setup</th><th>Stop / T1 / T2</th><th>Paper trade</th><th>Outcome</th></tr></thead><tbody>${rows||'<tr><td colspan="7" class="empty">No recommendations logged.</td></tr>'}</tbody></table></div></div></section>`;
}
function glossarySec(){
  return `<section id="glossary"><div class="head"><div><div class="eyebrow">Glossary</div><h2>Plain-English terms</h2></div></div><div class="gl reveal">${Object.entries(D.glossary||{}).map(([k,v])=>`<div><b>${esc(k)}</b><span>${esc(v)}</span></div>`).join('')}</div></section>`;
}
function footer(){return `<footer><div style="display:flex;justify-content:space-between;gap:20px;flex-wrap:wrap"><div>Paper trading only. Not financial advice. <b style="color:var(--mute);font-weight:500">Official paper fills are booked only by the scheduled checks on 5-minute bar data</b>; live prices in this app are informational and never create a fill. ${esc(D.fill_policy)}</div><div class="num">Ledger ${esc(D.generated_at||D.built_at)} · app ${esc(APP_VERSION)}</div></div></footer>`}

/* ---------- motion ---------- */
let io;
function observe(root){
  const els=$$('.reveal:not(.in)',root||document);
  if(STATIC||!('IntersectionObserver' in window)){els.forEach(e=>e.classList.add('in'));$$('.cur',root||document).forEach(c=>c.style.left=c.dataset.left+'%');return}
  io=io||new IntersectionObserver(es=>es.forEach(e=>{if(e.isIntersecting){const el=e.target;el.classList.add('in');$$('.cur',el).forEach(c=>setTimeout(()=>c.style.left=c.dataset.left+'%',350));io.unobserve(el)}}),{threshold:.08,rootMargin:'0px 0px -40px 0px'});
  els.forEach(e=>io.observe(e));
}
function counters(){
  $$('[data-count]').forEach(el=>{const to=+el.dataset.count;if(STATIC){return}
    const from=to*0.985,t0=performance.now(),dur=1300;const step=now=>{const k=Math.min(1,(now-t0)/dur),e=1-Math.pow(1-k,3);el.textContent='$'+n(from+(to-from)*e,0);if(k<1)requestAnimationFrame(step)};requestAnimationFrame(step)});
}
function animateLines(root){
  if(STATIC)return;$$('path.drawline',root).forEach(p=>{const L=p.getTotalLength();p.style.strokeDasharray=p.getAttribute('stroke-dasharray')||L;if(!p.getAttribute('stroke-dasharray')){p.style.strokeDasharray=L;p.style.strokeDashoffset=L;p.getBoundingClientRect();p.style.transition='stroke-dashoffset 1.6s cubic-bezier(.2,.7,.2,1)';p.style.strokeDashoffset=0}});
}


/* ---------- live prices (Finnhub, user's own key, this device only) ---------- */
const KEY_LS='sd.finnhub.key';
const Live={
  px:{},          // ticker -> {p, t (epoch ms), src: 'ws'|'rest'|'ledger', pc (previous close), via}
  ws:null, state:'nokey', err:'', lastTick:0, retry:0, timer:null, manualClose:false, subs:[], pollT:null,
  key(){try{return localStorage.getItem(KEY_LS)||''}catch(e){return ''}},
  setKey(k){try{k?localStorage.setItem(KEY_LS,k):localStorage.removeItem(KEY_LS)}catch(e){}},
  symbols(){const s=['SPY'];for(const b of ['main','shadow','mambo'])for(const t of T)if(t.book===b&&(t.status==='OPEN'||t.status==='PENDING')&&!s.includes(t.ticker))s.push(t.ticker);return s.slice(0,50)},
  quote(tk){return this.px[tk]||null},
  seed(){/* ledger prices from data.json: never overwrite a fresher live/rest price */
    for(const[tk,q]of Object.entries((D&&D.quotes)||{})){const t=parseET(q.as_of)||Date.parse(q.as_of)||0,cur=this.px[tk];
      if(!cur||(cur.src==='ledger'&&t>=cur.t)||t>cur.t)this.px[tk]={p:q.price,t,src:'ledger',pc:q.prev_close,via:q.source,close_date:q.close_date}}},
  /* how a price should be labelled right now */
  badge(tk){const q=this.px[tk],now=Date.now(),mk=Market.status(now);
    if(!q||q.p==null)return{c:'none',short:'n/a',long:'No price'};
    const age=now-q.t,tm=etParts(q.t).hms;
    if(!mk.open){const lc=Market.lastClose(now);
      if(lc&&q.t>=lc-5*6e4)return{c:'closed',short:'close',long:`Last close ${dshort(etParts(q.t).date)}`+(q.src==='ledger'?' · ledger':' · Finnhub')};
      return{c:'closed',short:dshort(etParts(q.t).date),long:`Last seen ${dshort(etParts(q.t).date)} ${tm.slice(0,5)} ET`+(q.src==='ledger'?' · ledger':' · Finnhub')}}
    if(q.src==='ws'&&age<120e3&&this.state==='live')return{c:'live',short:tm,long:`LIVE ${tm} ET · Finnhub`};
    if(q.src==='rest'&&age<90e3)return{c:'fresh',short:tm,long:`Quote ${tm} ET · Finnhub`};
    return{c:'delayed',short:'Delayed '+fmtAge(age).split(' ')[0],long:`Delayed ${fmtAge(age)} · ${q.src==='ledger'?'ledger price from '+tm.slice(0,5)+' ET':'Finnhub '+tm+' ET'}`}},
  refClose(tk){/* reference close for the day change */const q=this.px[tk];if(!q)return null;
    if(q.pc!=null&&q.src!=='ledger')return q.pc;const L=((D&&D.quotes)||{})[tk];if(!L)return null;
    const today=etParts().date;return L.close_date&&L.close_date<today?L.close:L.prev_close},
  async rest(sym){const r=await fetch(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(sym)}&token=${encodeURIComponent(this.key())}`,{cache:'no-store'});
    if(r.status===401||r.status===403)throw Object.assign(new Error('Finnhub rejected the key ('+r.status+')'),{auth:true});
    if(r.status===429)throw Object.assign(new Error('Finnhub rate limit reached (429): wait a minute'),{rate:true});
    if(!r.ok)throw new Error('Finnhub HTTP '+r.status);
    const j=await r.json();if(j.error)throw Object.assign(new Error(j.error),{auth:/key/i.test(j.error)});return j},
  async test(k){const old=this.key();this.setKey(k);try{const j=await this.rest('SPY');
      if(!j||!j.c)return{ok:false,msg:'Key accepted, but no SPY price returned (symbol not covered on this plan?)'};
      return{ok:true,msg:`Connected. SPY ${n(j.c)} at ${etParts(j.t*1000).hms} ET (Finnhub quote).`}}
    catch(e){return{ok:false,msg:e.message||'Network error reaching finnhub.io'}}finally{this.setKey(old)}},
  async snapshot(){const syms=this.symbols();for(const s of syms){try{const j=await this.rest(s);
        if(j&&j.c){const cur=this.px[s],t=j.t?j.t*1000:Date.now();if(!cur||cur.src!=='ws'||t>cur.t)this.px[s]={p:j.c,t,src:'rest',pc:j.pc,via:'Finnhub quote'}}}
      catch(e){if(e.auth){this.fail(e.message);return false}if(e.rate){this.err=e.message;break}}
      await new Promise(r=>setTimeout(r,120))}
    UI.applyLive();return true},
  fail(msg){this.state='error';this.err=msg;this.stop(true);UI.applyLive()},
  async start(){if(this.starting)return;this.stop(true);this.err='';if(!this.key()){this.state='nokey';UI.applyLive();return}
    this.state='connecting';UI.applyLive();
    this.starting=true;let ok;try{ok=await this.snapshot()}finally{this.starting=false}if(!ok)return;
    if(Market.isOpen())this.connect();else{this.state='closed';UI.applyLive()}},
  connect(){this.manualClose=false;let ws;try{ws=new WebSocket('wss://ws.finnhub.io?token='+encodeURIComponent(this.key()))}catch(e){this.fail('WebSocket blocked: '+e.message);return}
    this.ws=ws;this.state='connecting';
    ws.onopen=()=>{this.retry=0;this.subs=this.symbols();for(const s of this.subs)ws.send(JSON.stringify({type:'subscribe',symbol:s}));this.state='live';this.err='';UI.applyLive()};
    ws.onmessage=ev=>{let m;try{m=JSON.parse(ev.data)}catch(e){return}
      if(m.type==='trade'&&Array.isArray(m.data)){for(const x of m.data){const cur=this.px[x.s];if(cur&&cur.src!=='ledger'&&x.t<cur.t)continue;
          const prev=cur?cur.p:null;this.px[x.s]={p:x.p,t:x.t,src:'ws',pc:cur?cur.pc:null,via:'Finnhub trade'};this.lastTick=Date.now();if(prev!=null&&x.p!==prev)UI.flash(x.s,x.p>prev?1:-1)}
        UI.scheduleLive()}
      else if(m.type==='error'){this.err=m.msg||'Finnhub error';UI.applyLive()}};
    ws.onerror=()=>{this.err='Stream error';};
    ws.onclose=ev=>{this.ws=null;if(this.manualClose)return;
      if(!Market.isOpen()){this.state='closed';UI.applyLive();return}
      this.state='reconnecting';this.retry=Math.min(this.retry+1,6);const wait=Math.min(60,2**this.retry)*1000;
      this.err=`Stream closed (${ev.code||'network'}). Retrying in ${wait/1000}s.`+(this.retry>=4?' Polling quotes meanwhile.':'');
      if(this.retry>=4)this.poll();UI.applyLive();clearTimeout(this.timer);this.timer=setTimeout(()=>{if(this.key()&&Market.isOpen())this.connect()},wait)}},
  poll(){clearTimeout(this.pollT);this.pollT=setTimeout(async()=>{if(this.state==='reconnecting'){await this.snapshot();this.poll()}},60e3)},
  resubscribe(){if(!this.ws||this.ws.readyState!==1)return;const want=this.symbols();
    for(const s of this.subs)if(!want.includes(s))this.ws.send(JSON.stringify({type:'unsubscribe',symbol:s}));
    for(const s of want)if(!this.subs.includes(s))this.ws.send(JSON.stringify({type:'subscribe',symbol:s}));this.subs=want},
  stop(manual){this.manualClose=!!manual;clearTimeout(this.timer);clearTimeout(this.pollT);if(this.ws){try{this.ws.close()}catch(e){}}this.ws=null},
  tick(){/* every 15s: keep labels honest, open/close the stream at the bell */
    const open=Market.isOpen();if(this.key()&&this.state!=='error'){if(open&&!this.ws&&this.state!=='reconnecting'&&this.state!=='connecting')this.start();
      if(!open&&this.ws){this.stop(true);this.state='closed'}}UI.applyLive()}
};

/* ---------- live UI: ticker strip, badges, live P&L, crossings ---------- */
const UI={
  pending:false,
  scheduleLive(){if(this.pending)return;this.pending=true;setTimeout(()=>{this.pending=false;this.applyLive()},STATIC?0:250)},
  flash(tk,dir){if(STATIC)return;for(const el of $$(`[data-px="${tk}"]`)){el.classList.remove('up','down');void el.offsetWidth;el.classList.add(dir>0?'up':'down')}},
  badgeHTML(tk,long){const b=Live.badge(tk);return `<span class="lb ${b.c}" title="${esc(b.long)}"><i></i>${esc(long?b.long:b.short)}</span>`},
  feedStatus(){const k=Live.key(),mk=Market.status();
    if(!k){const ts=Object.values((D&&D.quotes)||{}).map(q=>parseET(q.as_of)||0),mx=ts.length?Math.max(...ts):0;
      return{c:'off',t:'No live feed',d:`Prices are the ledger's last recorded prices${mx?` (newest ${dshort(etParts(mx).date)} ${etParts(mx).hm} ET)`:''}, not live. Add a free Finnhub key in Settings to stream live prices on this device.`}}
    if(Live.state==='error')return{c:'err',t:'Live feed error',d:Live.err.replace(/\.?$/,'.')+' Showing ledger prices. Check the key in Settings.'};
    if(!mk.open)return{c:'closed',t:Market.label(),d:'Prices are the last close. The live stream resumes at the open.'};
    if(Live.state==='live')return{c:'live',t:'LIVE · Finnhub',d:Live.lastTick?`Last tick ${etParts(Live.lastTick).hms} ET`:'Connected, waiting for trades'};
    if(Live.state==='reconnecting')return{c:'warn',t:'Reconnecting',d:Live.err};
    return{c:'warn',t:'Connecting',d:'Opening the Finnhub stream'}},
  strip(){const el=$('#ticker');if(!el||!D)return;const fs=this.feedStatus();
    const chips=Live.symbols().map(tk=>{const q=Live.quote(tk),rc=Live.refClose(tk),ch=q&&rc?(q.p/rc-1)*100:null,b=Live.badge(tk);
      const t=T.find(x=>x.ticker===tk&&(x.status==='OPEN'||x.status==='PENDING'));
      return `<a class="tq" ${t?`href="#tc-${t.id}"`:''} data-tk="${tk}"><b>${tk}</b><span class="p num" data-px="${tk}">${q?n(q.p):'n/a'}</span><span class="c num ${cls(ch)}">${ch==null?'':pct(ch,1)}</span><span class="lb ${b.c}" title="${esc(b.long)}"><i></i>${esc(b.short)}</span></a>`}).join('');
    el.innerHTML=`<button class="tq feed ${fs.c}" data-open="settings" title="${esc(fs.d)}"><span class="lb ${fs.c==='live'?'live':fs.c==='closed'?'closed':fs.c==='off'?'none':'delayed'}"><i></i>${esc(fs.t)}</span></button>${chips}`;
    const n0=$('#feed-note');if(n0){n0.className='feed-note '+fs.c;n0.innerHTML=`<b>${esc(fs.t)}.</b> ${esc(fs.d)} ${!Live.key()||Live.state==='error'?'<button class="lnk" data-open="settings">Settings</button>':''}`}},
  /* the ledger values a position at its exit value (last price less the paper sell slippage): apply the same ratio to live prices */
  markF(tk){for(const b of ['main','shadow','mambo'])for(const p of (ACC[b]||{}).positions||[])if(p.ticker===tk&&p.spot>0&&p.last_value>0)return p.last_value/p.spot;return 1},
  livePos(b){/* live delta vs the ledger mark, per account */let d=0,any=false;const a=ACC[b]||{};
    for(const p of a.positions||[]){const q=Live.quote(p.ticker);if(!q||q.src==='ledger'||p.last_value==null)continue;const qty=+p.qty||0;d+=qty*(q.p*this.markF(p.ticker)-p.last_value);any=true}
    return{d,any}},
  applyLive(){if(!D)return;this.strip();
    const now=Date.now();
    /* cards */
    for(const row of $$('.liverow')){const t=T.find(x=>x.id===row.dataset.trade);if(!t)continue;const q=Live.quote(t.ticker);
      const lv=(t.reasoning||{}).levels||{},o=t.entry_order||{},stop=t.stop_moved||lv.stop;
      if(!q){row.innerHTML='';continue}
      const d=v=>v==null?'n/a':pct((v/q.p-1)*100,1),items=[];
      if(t.status==='PENDING'){const trig=o.kind==='limit_zone'?o.zone[1]:o.trigger;if(trig!=null)items.push([o.kind==='limit_zone'?'to zone':'to trigger',d(trig)])}
      items.push(['to stop',d(stop)]);if(!t.t1_hit)items.push(['to T1',d(lv.t1)]);items.push(['to T2',d(lv.t2)]);
      row.innerHTML=`<div class="lr-p"><span class="num big2" data-px="${t.ticker}">${n(q.p)}</span>${this.badgeHTML(t.ticker,true)}</div><div class="lr-d num">${items.map(([k,v])=>`<span><i>${k}</i> ${v}</span>`).join('')}</div>`;
      const cur=$(`.cur[data-trade="${t.id}"]`);if(cur){const s=+cur.dataset.stop,t2=+cur.dataset.t2,p=Math.max(0,Math.min(100,(q.p-s)/(t2-s)*100));cur.style.left=p+'%';cur.dataset.left=p;const sp=$('span',cur);if(sp)sp.textContent=n(q.p)}
      if(t.status==='OPEN'){const el=$(`[data-pnl="${t.id}"]`);if(el&&q.src!=='ledger'){const qty=t.contracts_open??t.contracts,ent=entryRef(t),pl=(t.realized_partial||0)+(t.direction==='short'?-1:1)*qty*(q.p*this.markF(t.ticker)-ent);
          el.innerHTML=`${susd(pl)} <span class="dim" style="font-size:11px">${Market.isOpen()?'live est.':'est. at last close'}</span>`;el.className='v num '+cls(pl)}}}
    /* hero + minis + account tiles */
    const hl=$('#hero-live');
    for(const b of ['main','shadow','mambo']){const k=D.books[b],{d,any}=this.livePos(b);if(!k)continue;const eq=k.equity+d;
      const me=$('#mini-eq-'+b);if(me)me.textContent=usd(eq);const mp=$('#mini-pct-'+b);if(mp&&any){mp.textContent=pct((eq/k.start-1)*100)+(Market.isOpen()?' live':' est.');mp.className='num '+cls(eq-k.start)}
      if(b==='main'){const he=$('#hero-eq');if(he&&any){const w=Math.floor(eq);he.innerHTML=`<span>$${n(w,0)}</span><span class="cents">${(eq-w).toFixed(2).slice(1)}</span>`}
        if(hl)hl.innerHTML=any?`${Market.isOpen()?'<span class="lb live"><i></i>Live estimate</span>':'<span class="lb closed"><i></i>Estimate at last close</span>'} ${susd(d,2)} vs the ledger mark of ${usd(k.equity,2)}. The official equity updates at the next check.`:
          `<span class="lb ${Market.isOpen()?'delayed':'closed'}"><i></i>Ledger value</span> marked ${esc(String(D.as_of||D.generated_at||'').slice(0,16))} ET`}
      if(b===state.acct){const a=ACC[b]||{};const ae=$('#acct-eq');if(ae&&any){ae.textContent=usd((a.equity||0)+d,2);$('#acct-eq-s').textContent=Market.isOpen()?'live estimate':'estimate at last close';
          $('#acct-mv').textContent=usd((a.market_value||0)+d,2);const ur=$('#acct-ur');ur.textContent=susd((a.unrealized||0)+d,2);$('#acct-ur-s').textContent=Market.isOpen()?'live estimate':'estimate at last close'}
        for(const p of a.positions||[]){const q=Live.quote(p.ticker);if(!q||q.src==='ledger')continue;const qty=+p.qty||0,dd=qty*(q.p*this.markF(p.ticker)-p.last_value);
          const L=$(`[data-pos-last="${p.trade_id}"]`);if(L)L.innerHTML=`<span data-px="${p.ticker}">${n(q.p)}</span><div>${this.badgeHTML(p.ticker)}</div>`;
          const M=$(`[data-pos-mv="${p.trade_id}"]`);if(M)M.textContent=usd(p.market_value+dd);
          const P=$(`[data-pos-pl="${p.trade_id}"]`);if(P){P.textContent=susd(p.unrealized+dd);P.className='num '+cls(p.unrealized+dd)}}}}
    /* hero list rows: live price */
    for(const r of $$('[data-tk-row]')){const tk=r.dataset.tkRow,q=Live.quote(tk);let s=$('.rowpx',r);if(!q)continue;if(!s){s=document.createElement('div');s.className='rowpx num';$('.what',r).appendChild(s)}
      s.innerHTML=`<span data-px="${tk}">${n(q.p)}</span> ${this.badgeHTML(tk)}`}
    this.crossings();this.stamp()},
  /* live crossing banners: informational only */
  crossings(){const box=$('#banners');if(!box)return;const day=etParts().date;let seen={};try{seen=JSON.parse(sessionStorage.getItem('sd.x.'+day)||'{}')}catch(e){}
    const out=[];
    for(const t of T){if(t.status!=='OPEN'&&t.status!=='PENDING')continue;const q=Live.quote(t.ticker);if(!q||q.src==='ledger'||!Market.isOpen()||Date.now()-q.t>5*6e4)continue;
      const lv=(t.reasoning||{}).levels||{},o=t.entry_order||{},stop=t.stop_moved||lv.stop,x=[];
      if(t.status==='PENDING'){if(o.kind==='buy_stop'&&q.p>=o.trigger)x.push(['trig',`traded through its buy-stop ${n(o.trigger)}`,'pos']);
        if(o.kind==='limit_zone'&&q.p<=o.zone[1])x.push(['zone',`is inside its buy zone ${n(o.zone[0])}-${n(o.zone[1])}`,'pos']);
        if(stop!=null&&q.p<=stop)x.push(['pstop',`traded at or below its stop ${n(stop)} before filling (the order will be cancelled)`,'neg'])}
      else{if(stop!=null&&q.p<=stop)x.push(['stop',`crossed its stop ${n(stop)}`,'neg']);if(!t.t1_hit&&lv.t1!=null&&q.p>=lv.t1)x.push(['t1',`crossed T1 ${n(lv.t1)}`,'pos']);
        if(!t.t2_hit&&lv.t2!=null&&q.p>=lv.t2)x.push(['t2',`crossed T2 ${n(lv.t2)}`,'pos'])}
      for(const[k,txt,c]of x){const id=t.id+':'+k;if(seen[id]==='x')continue;
        out.push(`<div class="xb ${c}" data-x="${id}"><div><b>${t.ticker}</b> ${txt} live at ${n(q.p)} (${etParts(q.t).hms} ET, ${BOOKN[t.book]} ${t.id}) - the official ledger books it at the next check, from 5-minute bar data.</div><button class="xclose" aria-label="Dismiss" data-dismiss="${id}">×</button></div>`)}}
    box.innerHTML=out.slice(0,4).join('')},
  dismiss(id){const day=etParts().date;let seen={};try{seen=JSON.parse(sessionStorage.getItem('sd.x.'+day)||'{}')}catch(e){}seen[id]='x';try{sessionStorage.setItem('sd.x.'+day,JSON.stringify(seen))}catch(e){}this.crossings()},
  stamp(){const el=$('#ledger-stamp');if(!el||!D)return;const g=String(D.as_of||D.generated_at||'');el.title='Last ledger mark '+g+'. Data file written '+String(D.generated_at||'')+'.';const age=Date.now()-(parseET(g)||Date.now());
    el.innerHTML=`<span class="lb ${Live.state==='live'&&Market.isOpen()?'live':Market.isOpen()?'delayed':'closed'}"><i></i></span><span class="txt">Ledger updated ${esc(g.slice(11,16))} ET</span>`;if(age>6e4)el.title+=' ('+fmtAge(age)+' ago)'},
  toast(msg,action,cb,ms){const t=$('#toast');t.innerHTML=`<span>${msg}</span>${action?`<button class="btn sm">${action}</button>`:''}<button class="xclose" aria-label="Close">×</button>`;t.hidden=false;
    if(action)$('.btn',t).onclick=cb;$('.xclose',t).onclick=()=>{t.hidden=true};if(ms)setTimeout(()=>{t.hidden=true},ms)}
};

/* ---------- chart crosshair (mouse + touch) ---------- */
function chartPoint(wrap,clientX,clientY){const svg=$('svg',wrap),r=svg.getBoundingClientRect(),W=+wrap.dataset.w,PR=+wrap.dataset.pr,step=+wrap.dataset.step,N=+wrap.dataset.n;
  const sx=(clientX-r.left)/r.width*W;if(sx<0||sx>W-PR)return null;const i=Math.max(0,Math.min(N-1,Math.floor(sx/step)));
  const tc=TECH[wrap.dataset.tk];if(!tc)return null;const C=tc.candles.slice(-N),c=C[i];const lo=+wrap.dataset.lo,hi=+wrap.dataset.hi,PT=+wrap.dataset.pt,PB=+wrap.dataset.pb,H=+wrap.dataset.h;
  const sy=(clientY-r.top)/r.height*H,price=hi-(sy-PT)/(H-PT-PB)*(hi-lo);return{i,c,x:i*step+step/2,sy,price,r,W}}
function showTip(wrap,ev){const p=chartPoint(wrap,ev.clientX,ev.clientY);const tip=$('.tip',wrap);if(!p){hideTip(wrap);return}
  wrap.classList.add('xon');const xh=$('.xh',wrap),yh=$('.yh',wrap);xh.setAttribute('x1',p.x);xh.setAttribute('x2',p.x);yh.setAttribute('y1',p.sy);yh.setAttribute('y2',p.sy);
  const[d,o,h,l,c]=p.c;const ch=(c/o-1)*100;
  tip.innerHTML=`<b>${dshort(d)}</b> <span class="${cls(ch)}">${pct(ch,1)}</span><br><span class="num">O ${n(o)} H ${n(h)}<br>L ${n(l)} C ${n(c)}</span><br><span class="dim num">cursor ${n(p.price)}</span>`;
  const px=p.x/p.W*p.r.width;tip.style.left=(px>p.r.width/2?Math.max(0,px-tip.offsetWidth-10):px+10)+'px'}
function hideTip(wrap){wrap.classList.remove('xon')}
document.addEventListener('pointermove',e=>{const w=e.target.closest&&e.target.closest('.chart-wrap');if(w)showTip(w,e)},{passive:true});
document.addEventListener('pointerdown',e=>{const w=e.target.closest&&e.target.closest('.chart-wrap');$$('.chart-wrap.xon').forEach(x=>{if(x!==w)hideTip(x)});if(w)showTip(w,e)},{passive:true});
document.addEventListener('pointerout',e=>{const w=e.target.closest&&e.target.closest('.chart-wrap');if(w&&e.pointerType==='mouse'&&!w.contains(e.relatedTarget))hideTip(w)},{passive:true});

/* ---------- sheets: settings, more, iOS install ---------- */
const Sheet={open(id){$$('.sheet').forEach(s=>s.hidden=s.id!=='sheet-'+id);$('#scrim').hidden=false;document.body.classList.add('noscroll');if(id==='settings')Settings.render();const f=$('#sheet-'+id+' [autofocus]');if(f&&innerWidth>700)f.focus()},
  close(){$$('.sheet').forEach(s=>s.hidden=true);$('#scrim').hidden=true;document.body.classList.remove('noscroll')}};
const Settings={
  render(){const k=Live.key(),fs=UI.feedStatus();$('#key-in').value=k;$('#key-state').innerHTML=`<span class="lb ${fs.c==='live'?'live':fs.c==='closed'?'closed':fs.c==='off'?'none':'delayed'}"><i></i>${esc(fs.t)}</span> <span class="mute">${esc(fs.d)}</span>`;
    $('#key-remove').hidden=!k;$('#app-ver').textContent=APP_VERSION;$('#sym-count').textContent=`${Live.symbols().length} symbols (free plan limit 50)`;Install.renderButtons()},
  async test(){const k=$('#key-in').value.trim(),out=$('#key-test');if(!k){out.className='test-out err';out.textContent='Paste a key first.';return}
    out.className='test-out';out.textContent='Testing...';const r=await Live.test(k);out.className='test-out '+(r.ok?'ok':'err');out.textContent=r.msg;return r},
  async save(){const k=$('#key-in').value.trim();if(!k){Live.setKey('');Live.stop(true);Live.state='nokey';UI.applyLive();this.render();return}
    const r=await this.test();if(!r||!r.ok)return;Live.setKey(k);Live.state='connecting';await Live.start();this.render()},
  remove(){Live.setKey('');Live.stop(true);Live.state='nokey';Live.err='';for(const k in Live.px)if(Live.px[k].src!=='ledger')delete Live.px[k];Live.seed();$('#key-in').value='';$('#key-test').textContent='Key removed from this device.';UI.applyLive();this.render()}
};

/* ---------- install (Android/Chrome prompt, iOS instructions) ---------- */
const Install={evt:null,
  standalone(){return matchMedia('(display-mode: standalone)').matches||navigator.standalone===true},
  ios(){return /iphone|ipad|ipod/i.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1)},
  available(){return !this.standalone()&&(!!this.evt||this.ios())},
  async go(){if(this.evt){this.evt.prompt();const r=await this.evt.userChoice;this.evt=null;this.renderButtons();if(r&&r.outcome==='accepted')UI.toast('Installing Swing Desk',null,null,3000)}
    else if(this.ios())Sheet.open('ios')},
  renderButtons(){for(const b of $$('[data-install]'))b.hidden=!this.available();const s=$('#install-state');if(s)s.textContent=this.standalone()?'Installed: running as an app.':this.evt?'Ready to install.':this.ios()?'On iPhone/iPad: Share > Add to Home Screen.':'Your browser offers install from its menu when supported (Chrome, Edge, Samsung Internet).'}
};
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();Install.evt=e;Install.renderButtons()});
window.addEventListener('appinstalled',()=>{Install.evt=null;Install.renderButtons()});

/* ---------- service worker + update prompt ---------- */
const SW={reg:null,
  async init(){if(!('serviceWorker' in navigator)||location.protocol==='file:')return;
    try{this.reg=await navigator.serviceWorker.register('sw.js',{scope:'./'})}catch(e){console.warn('SW registration failed',e);return}
    const r=this.reg;const prompt=w=>UI.toast('Update available',`Reload`,()=>{SW.wantReload=true;w.postMessage({type:'SKIP_WAITING'})});
    if(r.waiting&&navigator.serviceWorker.controller)prompt(r.waiting);
    r.addEventListener('updatefound',()=>{const w=r.installing;if(!w)return;w.addEventListener('statechange',()=>{if(w.state==='installed'&&navigator.serviceWorker.controller)prompt(w)})});
    let reloading=false;navigator.serviceWorker.addEventListener('controllerchange',()=>{if(reloading||!SW.wantReload)return;reloading=true;location.reload()})},
  check(){if(this.reg)this.reg.update().catch(()=>{})}
};

/* ---------- render + data loading ---------- */
let rendered=false,navio=null;
function stackTables(root){for(const tb of $$('table.stack',root||document)){const hs=$$('thead th',tb).map(h=>h.textContent.trim());
  for(const tr of $$('tbody tr',tb)){let i=0;for(const td of tr.children){td.dataset.label=hs[i]||'';i+=+(td.getAttribute('colspan')||1)}}}}
function afterPartial(root){stackTables(root);observe(root);UI.applyLive()}
function render(){
  const y=scrollY,open=$$('.tc.open').map(c=>c.id);
  $('#app').innerHTML=hero()+accountSec()+tradesSec()+scanSec()+activitySec()+learningSec()+recordSec()+glossarySec()+footer();
  renderAccount();renderCards();stackTables();observe();if(!rendered)counters();
  for(const id of open){const c=document.getElementById(id);if(c){c.classList.add('open');const b=$('.drawer-btn',c);if(b)b.setAttribute('aria-expanded','true')}}
  if(qs.has('open'))$$('.tc').slice(0,+qs.get('open')||1).forEach(c=>c.classList.add('open'));
  if(qs.has('shift'))$('#app').style.marginTop=(-(+qs.get('shift')))+'px';
  if(rendered)scrollTo(0,y);
  if(navio)navio.disconnect();
  if('IntersectionObserver' in window){navio=new IntersectionObserver(es=>es.forEach(e=>{if(e.isIntersecting){$$('#links a,#tabs a').forEach(a=>a.classList.toggle('on',a.getAttribute('href')==='#'+e.target.id))}}),{rootMargin:'-45% 0px -50% 0px'});$$('main section').forEach(s=>navio.observe(s))}
  {const _l=Market.label();$('#mkt-txt').textContent=_l;$('.stat-pill').title=_l;}$('#mkt-dot').classList.toggle('live',Market.isOpen());
  Live.seed();UI.applyLive();rendered=true;
}
const Net={ok:true,checked:0};
async function loadData(){
  if(location.protocol==='file:'){UI.stamp();return}
  try{const r=await fetch('data.json?t='+Date.now(),{cache:'no-store'});if(!r.ok)throw new Error('HTTP '+r.status);const d=await r.json();
    Net.ok=r.headers.get('X-SD-Offline')!=='1';Net.checked=Date.now();const first=!D,changed=first||d.generated_at!==D.generated_at;
    if(changed){setData(d);render();if(!first&&rendered)UI.toast(`New ledger data (written ${esc(String(d.generated_at).slice(11,16))} ET)`,null,null,6000);
      if(first&&Live.key())Live.start();else Live.resubscribe()}
  }catch(e){Net.ok=false;if(!D)$('#app').innerHTML=`<div class="card empty" style="margin-top:40px">Could not load the ledger (data.json): ${esc(e.message)}. ${navigator.onLine?'Retrying every minute.':'You are offline.'}</div>`}
  UI.stamp();const off=$('#offline');if(off)off.hidden=Net.ok&&navigator.onLine;
}

/* ---------- boot ---------- */
if(window.__SD_DATA__){setData(window.__SD_DATA__);render();if(Live.key())Live.start()}
else $('#app').innerHTML='<div class="skel"><div class="card"></div><div class="card"></div><div class="card"></div></div>';
loadData();
setInterval(loadData,60e3);
setInterval(()=>{Live.tick();{const _l=Market.label();$('#mkt-txt').textContent=_l;$('.stat-pill').title=_l;}$('#mkt-dot').classList.toggle('live',Market.isOpen())},15e3);
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'){loadData();SW.check();Live.tick()}});
addEventListener('online',loadData);addEventListener('offline',()=>{const o=$('#offline');if(o)o.hidden=false});
let rz;addEventListener('resize',()=>{clearTimeout(rz);rz=setTimeout(()=>{if(!D)return;const w=innerWidth;if(Math.abs(w-(window.__lw||w))>80){window.__lw=w;render()}},300)});window.__lw=innerWidth;
SW.init();Install.renderButtons();
document.addEventListener('click',e=>{
  const op=e.target.closest('[data-open]');if(op){e.preventDefault();Sheet.open(op.dataset.open);return}
  if(e.target.closest('[data-close]')||e.target.id==='scrim'){Sheet.close();return}
  const ds=e.target.closest('[data-dismiss]');if(ds){UI.dismiss(ds.dataset.dismiss);return}
  if(e.target.closest('[data-install]')){Install.go();return}
  const tab=e.target.closest('#tabs a,#more-links a');if(tab){Sheet.close()}
  const a=e.target.closest('[data-acct]');if(a&&a.closest('#acct-seg')){state.acct=a.dataset.acct;renderAccount();afterPartial($('#acct-body'));return}
  const r=e.target.closest('[data-recs]');if(r){state.recs=r.dataset.recs;renderCards();afterPartial($('#cards'));return}
  const g=e.target.closest('[data-goacct]');if(g){state.acct=g.dataset.goacct;state.recs=g.dataset.goacct;renderAccount();renderCards();afterPartial();$('#account').scrollIntoView();return}
  const f=e.target.closest('[data-fill]');if(f&&f.dataset.fill){e.preventDefault();state.acct=f.dataset.acct;renderAccount();afterPartial($('#acct-body'));const row=document.getElementById('fill-'+f.dataset.fill);if(row){row.scrollIntoView({block:'center'});row.classList.add('flash')}return}
  const gt=e.target.closest('[data-goto]');if(gt){const t=T.find(x=>x.ticker===gt.dataset.goto&&x.status!=='CANCELLED');if(t){state.recs=t.book;renderCards();afterPartial($('#cards'));const c=document.getElementById('tc-'+t.id);if(c)c.scrollIntoView({block:'start'})}return}
  const tq=e.target.closest('a.tq[href^="#tc-"]');if(tq){const t=T.find(x=>'#tc-'+x.id===tq.getAttribute('href'));if(t&&state.recs!==t.book&&state.recs!=='all'){e.preventDefault();state.recs=t.book;renderCards();afterPartial($('#cards'));const c=document.getElementById('tc-'+t.id);if(c)c.scrollIntoView({block:'start'})}return}
  const b=e.target.closest('.drawer-btn');if(b){const c=b.closest('.tc');c.classList.toggle('open');b.setAttribute('aria-expanded',c.classList.contains('open'))}
});
document.addEventListener('keydown',e=>{if(e.key==='Escape')Sheet.close()});
$('#key-test-btn').addEventListener('click',()=>Settings.test());
$('#key-save').addEventListener('click',()=>Settings.save());
$('#key-remove').addEventListener('click',()=>Settings.remove());
$('#key-show').addEventListener('click',()=>{const i=$('#key-in');i.type=i.type==='password'?'text':'password';$('#key-show').textContent=i.type==='password'?'Show':'Hide'});
$('#sw-check').addEventListener('click',()=>{SW.check();UI.toast('Checking for an update...',null,null,2500)});
if(qs.has('sheet'))Sheet.open(qs.get('sheet'));
window.__ok=true;

})();
