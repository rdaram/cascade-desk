(function(){
"use strict";
/* Swing Desk app. Paper trading only. Live prices are informational; the official ledger is data.json. */
const APP_VERSION='d93fb211b1';
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
/* Dollar and percent together. Order follows the tap preference; neither is dropped. */
function moneyPct(d,p,dp){
  dp=dp==null?2:dp;
  const ds=(d==null||isNaN(d))?null:susd(d,dp);
  const ps=(p==null||isNaN(p))?null:pct(p);
  if(ds&&ps) return (state.emph==='pct') ? ps+' ('+ds+')' : ds+' ('+ps+')';
  return ds||ps||'n/a';
}
function dayMove(tk){
  const q=Prices.get(tk);
  if(!q||q.pc==null||!q.pc) return {d:null,pct:null};
  const d=q.p-q.pc;
  return {d, pct:d/q.pc*100};
}
function pnlPair(t){
  const d=shownPnl(t);
  const ent=entryRef(t), qty=t.contracts_open??t.contracts;
  if(d==null||ent==null||!qty) return {d, pct:null};
  const cost=ent*Math.abs(qty);
  return {d, pct:cost? d/cost*100 : null};
}
function distPair(t, level){
  const px=Val.last(t.ticker), qty=t.contracts_open??t.contracts;
  if(px==null||level==null||!px) return {d:null,pct:null};
  const per=level-px;
  return {d: qty? per*qty : per, pct: per/px*100};
}
function spark(tk){
  const c=(TECH[tk]||{}).candles; if(!c||c.length<2) return '';
  const s=c.slice(-28).map(x=>x[4]);
  const lo=Math.min(...s), hi=Math.max(...s), w=72, h=28;
  const pts=s.map((v,i)=>`${(i/(s.length-1)*w).toFixed(1)},${(hi===lo?h/2:(1-(v-lo)/(hi-lo))*(h-4)+2).toFixed(1)}`).join(' ');
  const dm=dayMove(tk), up=dm.d!=null?dm.d>=0:s[s.length-1]>=s[0];
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="${up?'var(--up)':'var(--down)'}" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
}
function track(t){
  const lv=(t.reasoning||{}).levels||{}, stop=lv.stop, t2=lv.t2, ent=entryRef(t);
  if(stop==null||t2==null||t2===stop) return '';
  const x=v=>Math.max(0,Math.min(100,(v-stop)/(t2-stop)*100));
  const cur=spotOf(t);
  return `<div class="track" data-track="${t.id}" data-stop="${stop}" data-t2="${t2}" aria-hidden="true">
    <i class="mk s" style="left:0%"></i>
    ${ent!=null?`<i class="mk e" style="left:${x(ent)}%"></i>`:''}
    ${lv.t1!=null?`<i class="mk a" style="left:${x(lv.t1)}%"></i>`:''}
    <i class="mk b" style="left:100%"></i>
    ${cur==null?'':`<i class="pxdot" data-dot="${t.id}" style="left:${x(cur)}%"></i>`}
  </div>`;
}
function chgSpan(d,p,attrs,dp){
  if(d==null||p==null||isNaN(d)||isNaN(p)) return '';
  return `<span class="num ${cls(d)}" data-chg ${attrs}>${moneyPct(d,p,dp)}</span>`;
}

function candleChart(t){
  const tc=TECH[t.ticker];const lv=(t.reasoning||{}).levels||{};
  if(!tc||!tc.candles||!tc.candles.length)return '<div class="empty">Chart unavailable</div>';
  const C=tc.candles.slice(-(innerWidth<480?46:60)),W=640,H=220,PR=86,PT=14,PB=22;
  const ref=entryRef(t),zone=(t.entry_order||{}).kind==='limit_zone'&&t.status==='PENDING'?t.entry_order.zone:null;
  const lv2=[lv.stop,lv.t1,lv.t2,ref,...(zone||[])].filter(x=>x!=null);
  let lo=Math.min(...C.map(c=>c[3]),...lv2),hi=Math.max(...C.map(c=>c[2]),...lv2);const pad=(hi-lo)*.08||1;lo-=pad;hi+=pad;
  const y=v=>PT+(hi-v)/(hi-lo)*(H-PT-PB), step=(W-PR)/C.length, bw=Math.max(2,step*.62);
  let g='',cs='';
  for(let i=0;i<4;i++){const yy=PT+i*(H-PT-PB)/3;g+=`<line class="grid-l" x1="0" x2="${W-PR}" y1="${yy}" y2="${yy}" stroke="currentColor" stroke-opacity=".08"/>`}
  C.forEach((c,i)=>{const x=i*step+step/2,up=c[4]>=c[1],col=up?'var(--up)':'var(--down)';
    cs+=`<line x1="${x}" x2="${x}" y1="${y(c[2])}" y2="${y(c[3])}" stroke="${col}" stroke-width="1"/>`+
        `<rect x="${x-bw/2}" y="${y(Math.max(c[1],c[4]))}" width="${bw}" height="${Math.max(1,Math.abs(y(c[1])-y(c[4])))}" rx="1" fill="${col}"/>`});
  let lines='',labels='',used=[];
  [['Stop',lv.stop,'var(--down)'],['Entry',ref,'var(--label2)'],['T1',lv.t1,'var(--tint)'],['T2',lv.t2,'var(--up)']].forEach(([nm,v,col])=>{
    if(v==null)return; let yy=y(v); lines+=`<line x1="0" x2="${W-PR}" y1="${yy}" y2="${yy}" stroke="${col}" stroke-dasharray="3 4" stroke-width="1" stroke-opacity=".85"/>`;
    let ly=yy; used.forEach(u=>{if(Math.abs(u-ly)<13)ly=u+13}); used.push(ly);
    labels+=`<text x="${W-PR+8}" y="${ly+4}" fill="${col}">${nm} ${n(v)}</text>`});
  const cur=spotOf(t)||C[C.length-1][4], cx=(C.length-1)*step+step/2, cy=y(cur);
  const mk=`<line x1="${cx}" x2="${W-PR}" y1="${cy}" y2="${cy}" stroke="currentColor" stroke-opacity=".25" stroke-dasharray="1 3"/><circle class="now" data-chart-px="${esc(t.ticker)}" cx="${cx}" cy="${cy}" r="4.5" fill="var(--label)"/>`;
  return `<div class="chart-wrap" data-tk="${esc(t.ticker)}" data-n="${C.length}" data-step="${step}" data-w="${W}" data-pr="${PR}" data-lo="${lo}" data-hi="${hi}" data-pt="${PT}" data-pb="${PB}" data-h="${H}"><svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(t.ticker)} chart">${g}${cs}${lines}${mk}${labels}<line class="xh" y1="${PT}" y2="${H-PB}"/><line class="yh" x2="${W-PR}"/></svg><div class="tip" hidden></div></div>`;
}

function histRows(book){
  const key=book==='main'?'equity':book+'_equity';
  return (D.equity_history||[]).filter(h=>h[key]!=null).map(h=>({t:h.t, eq:+h[key], spy:h.spy==null?null:+h.spy}));
}
function filterRange(rows){
  const range=state.range||'1M';
  if(!rows.length||range==='ALL') return {rows, range, trimmed:false};
  const last=parseET(rows[rows.length-1].t)||Date.now();
  const days=range==='1W'?7:30;
  const cut=last-days*864e5;
  const f=rows.filter(r=>(parseET(r.t)||0)>=cut);
  if(f.length<2) return {rows, range, trimmed:false, short:true};
  return {rows:f, range, trimmed:f.length!==rows.length};
}
function areaChart(book, withSpy){
  const all=histRows(book);
  const {rows, range, short}=filterRange(all);
  if(rows.length<2) return `<p class="fine">${rows.length} ledger mark${rows.length===1?'':'s'}. A line needs two.</p>`;
  const W=640,H=168,P=8;
  const vals=rows.map(r=>r.eq);
  let lo=Math.min(...vals), hi=Math.max(...vals);
  if(hi===lo){hi+=1;lo-=1}
  const pad=(hi-lo)*0.12; lo-=pad; hi+=pad;
  const X=i=>P+(i/(rows.length-1))*(W-2*P);
  const Y=v=>P+(hi-v)/(hi-lo)*(H-2*P);
  const xy=rows.map((r,i)=>[X(i),Y(r.eq)]);
  const line=xy.map(p=>p.map(v=>v.toFixed(1)).join(',')).join('L');
  const area=`M${xy[0].map(v=>v.toFixed(1)).join(',')}L${line.slice(line.indexOf('L')+1)}L${xy[xy.length-1][0].toFixed(1)},${(H-P).toFixed(1)}L${xy[0][0].toFixed(1)},${(H-P).toFixed(1)}Z`;
  const gid='eqf'+book+(withSpy?'s':'');
  let spy='';
  if(withSpy){
    const both=rows.filter(r=>r.spy!=null);
    if(both.length>=2){
      const s0=both[0].spy, e0=both[0].eq;
      const sy=both.map(r=>e0*(r.spy/s0));
      const pts=sy.map((v,i)=>{
        const idx=rows.indexOf(both[i]);
        return `${X(idx).toFixed(1)},${Y(v).toFixed(1)}`;
      }).join('L');
      spy=`<path d="M${pts}" fill="none" stroke="var(--label3)" stroke-width="1.25" stroke-dasharray="4 3"/>`;
    }
  }
  const meta=rows.map((r,i)=>{
    const prev=i?rows[i-1]:null;
    const d=prev?r.eq-prev.eq:0;
    const pc=prev&&prev.eq?d/prev.eq*100:0;
    return {t:r.t, eq:r.eq, d, pct:pc, x:X(i)};
  });
  const label=`${rows.length} marks since ${dshort(rows[0].t).split(',')[0]}. Nothing drawn between them.`;
  return `<div class="eq-scrub" data-pts="${esc(JSON.stringify(meta))}" data-w="${W}" data-h="${H}">
    <svg class="eq" viewBox="0 0 ${W} ${H}" role="img" aria-label="Equity, ${esc(label)}">
      <defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--tint)" stop-opacity=".28"/><stop offset="1" stop-color="var(--tint)" stop-opacity="0"/></linearGradient></defs>
      <path d="${area}" fill="url(#${gid})"/><path d="M${line}" fill="none" stroke="var(--tint)" stroke-width="2" stroke-linejoin="round"/>${spy}
      <circle class="eq-dot" r="4.5" fill="var(--label)" cx="${xy[xy.length-1][0]}" cy="${xy[xy.length-1][1]}"/>
    </svg>
    <div class="eq-tip" hidden></div>
    <p class="fine">${esc(label)}${withSpy?' Dashed line is the S&amp;P 500 scaled to the same start, only where both were recorded.':''}</p>
  </div>`;
}

function dayChange(b){
  const key=b==='main'?'equity':b+'_equity', H=(D.equity_history||[]).filter(h=>h[key]!=null);
  const a=H[H.length-1], prev=H[H.length-2];
  const be=bookEq(b);
  const spyQ=Prices.get('SPY');
  let spy=null;
  if(a&&prev&&prev.spy&&spyQ) spy=(spyQ.p/prev.spy-1)*100;
  else if(spyQ&&spyQ.pc) spy=(spyQ.p/spyQ.pc-1)*100;
  else if(a&&prev&&a.spy&&prev.spy) spy=(a.spy/prev.spy-1)*100;
  if(!a||!prev){
    const base=be.k.start;
    const spyD=spy!=null&&base?base*spy/100:null;
    return {d:be.k.pnl, pct:be.k.pnl_pct, spy, spyD, label:'since inception', base};
  }
  const d=(be.eq)-(prev[key]);
  if(spy==null && a.spy&&prev.spy) spy=(a.spy/prev.spy-1)*100;
  const spyD=spy!=null?prev[key]*spy/100:null;
  const same=String(a.t).slice(0,10)===String(prev.t).slice(0,10);
  return {d, pct:prev[key]?d/prev[key]*100:null, spy, spyD, label:same?'today':'since last check', base:prev[key]};
}

function posCard(t){
  const pl=pnlPair(t), dm=dayMove(t.ticker);
  const cap=(dm.d!=null&&dm.pct!=null)?`<span class="cap ${cls(dm.d)}" data-cap data-chg data-day="${esc(t.ticker)}">${moneyPct(dm.d, dm.pct)}</span>`:'';
  const pln=(pl.d!=null&&pl.pct!=null)?`<div class="pl ${cls(pl.d)}" data-chg data-pl="${t.id}">${moneyPct(pl.d, pl.pct)}</div>`:(pl.d==null?'':`<div class="pl ${cls(pl.d)}" data-pl="${t.id}">${susd(pl.d,2)}</div>`);
  return `<button class="pos" data-trade="${t.id}">
    <div class="pos-r">
      <div class="pos-id"><b class="tk">${esc(t.ticker)}</b><span class="co">${esc(t.name||SETUPN[t.setup_type]||'')}${t.name&&SETUPN[t.setup_type]?' · '+esc(SETUPN[t.setup_type]):''}</span></div>
      ${spark(t.ticker)}
      <div class="pos-px"><b class="num px" data-px="${esc(t.ticker)}">${spotOf(t)==null?'n/a':n(spotOf(t))}</b>${cap}</div>
    </div>
    ${pln}
    ${track(t)}
  </button>`;
}

function homeView(){
  const b=state.acct||'main', be=bookEq(b), ch=dayChange(b);
  const open=T.filter(t=>t.book===b&&t.status==='OPEN');
  const pend=T.filter(t=>t.book===b&&t.status==='PENDING');
  const nx=(D.next||[]).filter(x=>x.book===b).slice(0,4);
  const chips=['1W','1M','ALL'].map(r=>`<button data-range="${r}" class="${(state.range||'1M')===r?'on':''}">${r}</button>`).join('');
  const spy=(ch.spy!=null&&ch.spyD!=null)?`<p class="vs" id="hero-spy">vs S&amp;P 500 <b class="num ${cls(ch.spy)}" data-chg data-spy="1">${moneyPct(ch.spyD, ch.spy)}</b> since the last mark</p>`:'<p class="vs" id="hero-spy"></p>';
  return `<section id="overview" data-screen="home">
    <div class="acctseg seg" role="tablist">${['main','shadow','mambo'].map(x=>`<button data-acct="${x}" class="${x===b?'on':''}" role="tab">${BOOKN[x]}</button>`).join('')}</div>
    <p class="eyebrow">${BOOKN[b]} paper</p>
    <p class="hero-eq num" id="hero-eq" data-eq="${b}">${usd(be.eq,2)}</p>
    <p class="hero-row"><span class="capsule num ${cls(ch.d)}" id="hero-day" data-chg>${ch.d==null||ch.pct==null?susd(ch.d,2):moneyPct(ch.d, ch.pct)}</span> <span class="hero-when" id="hero-when">${esc(ch.label)}</span></p>
    ${areaChart(b,false)}
    <div class="ranges" role="tablist">${chips}</div>
    ${spy}
    <p class="fine" id="ledger-stamp"></p>
    <p class="fine" id="hero-live"></p>
    <h2 class="group-h">Open</h2>
    <div class="group">${open.length?open.map(posCard).join(''):'<div class="empty">No open positions.</div>'}</div>
    ${pend.length?`<h2 class="group-h">Pending</h2><div class="group">${pend.map(posCard).join('')}</div>`:''}
    ${nx.length?`<h2 class="group-h">Attention</h2><div class="group">${nx.map(x=>`<div class="cell static"><div class="c1"><b>${dshort(x.date)}</b><span class="sub2">${esc(x.label)}</span></div><div class="c3 sub2">${daysTo(x.date)}d</div></div>`).join('')}</div>`:''}
    <p class="fine">P&amp;L is the exit value, last price minus 0.2% paper slippage. The price is the last trade, the same number everywhere. Tap a change to swap which figure leads. Official fills come only from the scheduled 5-minute bar checks.</p>
  </section>`;
}

function positionsView(){
  const b=state.recs||'main';
  const order={OPEN:0,PENDING:1,CLOSED:2,CANCELLED:3};
  const ts=T.filter(t=>b==='all'||t.book===b).sort((x,y)=>(order[x.status]-order[y.status])||((y.scores||{}).total||0)-((x.scores||{}).total||0));
  const row=t=>{
    const [st]=status(t), pl=pnlPair(t), dm=dayMove(t.ticker);
    const cap=(dm.d!=null&&dm.pct!=null)?`<span class="cap ${cls(dm.d)}" data-cap data-chg data-day="${esc(t.ticker)}">${moneyPct(dm.d, dm.pct)}</span>`:'';
    const pln=(pl.d!=null&&pl.pct!=null)?`<div class="pl ${cls(pl.d)}" data-chg data-pl="${t.id}">${moneyPct(pl.d, pl.pct)}</div>`:'';
    return `<button class="pos" data-trade="${t.id}">
      <div class="pos-r">
        <div class="pos-id"><b class="tk">${esc(t.ticker)}</b><span class="co">${esc(BOOKN[t.book]||'')} · ${esc(st)} · ${esc(t.name||setupName(t))}</span></div>
        ${spark(t.ticker)}
        <div class="pos-px"><b class="num px" data-px="${esc(t.ticker)}">${spotOf(t)==null?'':n(spotOf(t))}</b>${cap}</div>
      </div>
      ${pln}${t.status==='OPEN'||t.status==='PENDING'?track(t):''}
    </button>`;
  };
  return `<section data-screen="positions">
    <div class="seg">${['main','shadow','mambo','all'].map(x=>`<button data-recs="${x}" class="${x===b?'on':''}">${x==='all'?'All':BOOKN[x]}</button>`).join('')}</div>
    <div class="group">${ts.map(row).join('')||'<div class="empty">Nothing in this book.</div>'}</div>
  </section>`;
}

function near(a,b){return a!=null&&b!=null&&Math.abs(+a-+b)<0.015}
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
function levelRow(t, label, val, tone){
  if(val==null) return '';
  const pair=distPair(t, val);
  const dist=(pair.d!=null&&pair.pct!=null)?`<span class="dist ${cls(pair.d)}" data-chg data-dist="${t.id}|${val}">${moneyPct(pair.d, pair.pct)}</span>`:'';
  return `<div class="inset-row"><span>${label}</span><span class="inset-v"><b class="num ${tone||''}">${n(val)}</b>${dist}</span></div>`;
}
function detailHTML(t){
  const r=t.reasoning||{}, lv=r.levels||{}, wl=r.why_levels||{};
  const [st]=status(t), pair=pnlPair(t), cf=conf(t);
  const risks=(r.risks||[]).map(x=>`<li>${esc(x)}</li>`).join('');
  const fills=(t.fills||[]).map(f=>`<div class="inset-row"><span>${esc(f.kind)}<span class="sub2">${dshort(f.filled_at)} · ${esc(f.price_source||'')}</span></span><b class="num">${f.fill_price==null?'':n(f.fill_price)}</b></div>`).join('');
  const pln=(pair.d!=null&&pair.pct!=null)?`<p class="plline"><span class="capsule ${cls(pair.d)}" data-chg data-pl="${t.id}">${moneyPct(pair.d, pair.pct)}</span> <span class="fine">paper</span></p>`:(pair.d==null?'':`<p class="plline"><span class="capsule ${cls(pair.d)}" data-pl="${t.id}">${susd(pair.d,2)}</span> <span class="fine">paper</span></p>`);
  return `<div class="sheet-h"><button class="x" data-close aria-label="Close">Close</button><div class="grab"></div></div>
    <div class="sheet-body" id="sheet-body">
      <p class="eyebrow">${esc(BOOKN[t.book]||'')} · ${esc(st)}${cf?' · '+esc(cf[0])+' confidence':''}</p>
      <h2 class="sheet-title">${esc(t.ticker)} <span class="num livepx" data-px="${esc(t.ticker)}">${n(spotOf(t))}</span></h2>
      <p class="co">${esc(t.name||'')} · ${esc(setupName(t))}</p>
      ${pln}
      ${candleChart(t)}
      ${track(t)}
      <div class="inset">
        ${levelRow(t,'Entry',entryRef(t),'')}
        ${levelRow(t,'Stop',lv.stop,'neg')}
        ${levelRow(t,'T1',lv.t1,'')}
        ${levelRow(t,'T2',lv.t2,'pos')}
        <div class="inset-row"><span>Shares</span><b class="num">${n(t.contracts_open??t.contracts,0)}</b></div>
        <div class="inset-row"><span>Risk</span><b class="num">${usd(t.max_risk_usd)}</b></div>
        <div class="inset-row"><span>R:R</span><b class="num">${rrTxt(t.rr)}</b></div>
        <div class="inset-row"><span>Time stop</span><b>${t.time_stop?dshort(t.time_stop):((t.time_stop_weeks||'n/a')+' wks')}</b></div>
        <div class="inset-row"><span>Earnings</span><b>${earnTxt(t)}</b></div>
        <div class="inset-row"><span>Order</span><b>${esc(orderText(t))}</b></div>
      </div>
      <div class="prose">
        <h3>Levels</h3>
        <p class="levels-now">${esc(levelSentence(t))}</p>
        ${rebaseNote(t)?`<p class="fine rebase">${esc(rebaseNote(t))}</p>`:''}
        <p class="fine">Distances are from the last price to that level, in position dollars and percent of price. They use the same levels as the list above.</p>
        ${r.why_stock?`<h3>Why this stock</h3><p>${esc(r.why_stock)}</p>`:''}
        ${r.why_now?`<h3>Why now</h3><p>${esc(r.why_now)}</p>`:''}
        ${wl.entry?`<h3>As issued</h3><p class="fine">${esc(wl.entry)} ${esc(wl.stop||'')} ${esc(wl.t1||'')} ${esc(wl.t2||'')}</p>`:''}
        ${risks?`<h3>Risks</h3><ul>${risks}</ul>`:''}
        ${(r.confidence||{}).why?`<h3>Confidence</h3><p>${esc(r.confidence.why)}</p>`:''}
        ${t.why_not_main_detail?`<h3>Why it is not in Main</h3><p>${esc(t.why_not_main_detail)}</p>`:''}
        ${t.postmortem?`<h3>After the close</h3><p>${esc(t.postmortem.why||t.postmortem.one_liner||'')}</p>`:''}
      </div>
      <p class="fine">${esc(t.id)} · rec ${esc(t.rec_id||'n/a')} · method v${esc(t.method_version||'')} · issued ${dshort(t.created_at)} ET</p>
      ${fills?`<h2 class="group-h">Fills</h2><div class="inset">${fills}</div>`:''}
    </div>`;
}

function ico(kind){
  const d=kind==='alert'?'M12 4v8M12 16h.01':kind==='exit'?'M5 12h14M13 6l6 6-6 6':'M12 5v14M5 12h14';
  return `<i class="ico" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="${d}"/></svg></i>`;
}
function activityView(){
  const mode=state.act||'fills';
  const seg=`<div class="seg">${[['fills','Fills'],['alerts','Alerts'],['post','Post-mortems']].map(([k,l])=>`<button data-act="${k}" class="${mode===k?'on':''}">${l}</button>`).join('')}</div>`;
  let body='';
  if(mode==='fills'){
    const fl=FILLS.slice().reverse();
    body=`<div class="group">${fl.map(f=>{
      const k=f.kind==='cancel'?'exit':(f.side==='sell'?'exit':'fill');
      return `<div class="tl-item" id="fill-${f.fill_id}">${ico(k)}<div><b>${esc(f.ticker)} ${esc((f.kind||'').replace('_',' '))}</b><span class="sub2">${dshort(f.filled_at)} · ${esc(BOOKN[f.account]||f.account||'')} · ${esc(f.rec_id||'')}</span><span class="sub2">${esc(f.order_type||'')} · ${esc(f.price_source||'')}</span></div><b class="num">${f.fill_price==null?'':n(f.fill_price)}</b></div>`;
    }).join('')||'<div class="empty">No fills yet.</div>'}</div>`;
  } else if(mode==='alerts'){
    body=`<div class="group">${(D.alerts||[]).slice(0,40).map(a=>{
      const m=String(a.text||'').match(/P&L\s+(-?\d+)\s*->\s*([+-]?\d+)/);
      let extra='';
      if(m){
        const from=+m[1], to=+m[2], delta=to-from;
        const tr=T.find(x=>x.id===a.id);
        const qty=tr?(tr.contracts_open!=null?tr.contracts_open:tr.contracts):0; const cost=tr?(entryRef(tr)||0)*Math.abs(qty||0):0;
        const pc=cost? delta/cost*100 : null;
        if(pc!=null) extra=`<span class="cap ${cls(delta)}" data-chg>${moneyPct(delta, pc, 0)}</span>`;
      }
      return `<div class="tl-item">${ico('alert')}<div><b>${esc((a.type||'').replace('_',' '))}</b><span class="sub2">${dshort(a.t)} ET${a.book?' · '+esc(BOOKN[a.book]||a.book):''}</span><span class="sub2">${esc(a.text)}</span></div>${extra}</div>`;
    }).join('')||'<div class="empty">No alerts.</div>'}</div>`;
  } else {
    body=`<div class="group">${(D.postmortems||[]).map(p=>{
      const d=p.pnl, pc=p.return_pct;
      const ch=(d!=null&&pc!=null)?`<span class="cap ${cls(d)}" data-chg>${moneyPct(d, pc)}</span>`:(p.r_multiple!=null?`<span class="num">${n(p.r_multiple,2)}R</span>`:'');
      return `<div class="tl-item">${ico('exit')}<div><b>${esc(p.outcome||'')}</b><span class="sub2">${esc(p.why||p.one_liner||'')}</span></div>${ch}</div>`;
    }).join('')||'<div class="empty">None yet. Written when a trade closes.</div>'}</div>`;
  }
  return `<section data-screen="activity">${seg}${body}<p class="fine">fills.jsonl is append-only. Every fill cites its recommendation and the bar used. Alert sentences are the ledger text. Where a move can be measured, the capsule adds dollars and percent.</p></section>`;
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
  const b=state.acct||'main', a=ACC[b]||{}, be=bookEq(b), ch=dayChange(b);
  const unreal=(a.unrealized||0)+be.d;
  const unrealPct=be.base? unreal/be.base*100 : null;
  const realPct=a.start_cash? (a.realized||0)/a.start_cash*100 : null;
  const rows=(a.per_rec||[]).filter(r=>r.r!=null);
  const max=Math.max(0.01,...rows.map(r=>Math.abs(r.r)));
  const bars=rows.length?`<div class="card"><p class="eyebrow">Open R, not closed trades</p><div class="bars">${rows.map(r=>`<div class="bar-row"><b>${esc(r.ticker)}</b><i style="width:${Math.abs(r.r)/max*100}%;background:${r.r>=0?'var(--up)':'var(--down)'}"></i><span class="num ${cls(r.r)}">${r.pnl==null?'':moneyPct(r.pnl, r.return_on_risk_pct, 0)} · ${n(r.r,2)}R</span></div>`).join('')}</div></div>`:'<div class="empty">No open R yet.</div>';
  const wr=a.closed? (a.win_rate==null?'n/a':n(a.win_rate,0)+'%') : null;
  return `<section>
    <div class="seg">${['main','shadow','mambo'].map(x=>`<button data-acct="${x}" class="${x===b?'on':''}">${BOOKN[x]}</button>`).join('')}</div>
    <p class="hero-eq num">${usd(be.eq,2)}</p>
    <p class="capsule ${cls(ch.d)}" data-chg>${moneyPct(ch.d, ch.pct)}</p>
    <div class="card">${areaChart(b,true)}</div>
    <div class="ranges">${['1W','1M','ALL'].map(r=>`<button data-range="${r}" class="${(state.range||'1M')===r?'on':''}">${r}</button>`).join('')}</div>
    <div class="inset">
      <div class="inset-row"><span>Cash</span><b class="num">${usd(a.cash,2)}</b></div>
      <div class="inset-row"><span>vs S&amp;P 500, since start</span><b class="num ${cls(a.vs_spy_pct)}" ${a.vs_spy_pct==null?'':'data-chg'}>${a.vs_spy_pct==null?'n/a':moneyPct((a.start_cash||100000)*a.vs_spy_pct/100, a.vs_spy_pct)}</b></div>
      <div class="inset-row"><span>Realized</span><b class="num ${cls(a.realized)}" ${realPct!=null?'data-chg':''}>${realPct==null?susd(a.realized,2):moneyPct(a.realized, realPct)}</b></div>
      <div class="inset-row"><span>Unrealized</span><b class="num ${cls(unreal)}" data-chg>${moneyPct(unreal, unrealPct)}</b></div>
      <div class="inset-row"><span>Win rate</span><b>${wr==null?'No closed trades':wr}</b></div>
      <div class="inset-row"><span>Expectancy</span><b class="num">${a.expectancy_R==null?'n/a':n(a.expectancy_R,2)+'R'}</b></div>
      <div class="inset-row"><span>Max drawdown</span><b class="num">${a.max_drawdown_pct==null?'n/a':n(a.max_drawdown_pct,2)+'%'}</b></div>
    </div>
    ${bars}
    <p class="fine" id="slip-note">Unrealized P&amp;L uses the exit value (last price minus 0.2% paper slippage). Since-start versus the S&amp;P is the ledger percent only. Today versus the S&amp;P, in dollars and percent, is on Home.</p>
  </section>`;
}
function learnPanel(){
  const rv=D.review||{}, gates=rv.gates||[], ds=rv.risk_state||{};
  const vers=(D.versions||[]).map(v=>`<div class="inset-row"><span><b>v${esc(v.version)}</b><span class="sub2">${dshort(v.date)} · ${esc(v.status||'')}</span><span class="sub2">${esc((v.changes||[]).join(' '))}</span></span></div>`).join('');
  const ch=(D.challengers||[]).filter(c=>c.status!=='retired').map(c=>{const g=gates.find(x=>x.challenger===c.id)||{};
    return `<div class="inset-row"><span><b>${esc(c.id)}</b><span class="sub2">${esc(c.hypothesis||'')}</span><span class="sub2">${esc(c.status)} · ${g.n_closed??0} closed · avg ${g.avg_R==null?'n/a':n(g.avg_R,2)+'R'} · ${esc(g.verdict||'')}</span></span></div>`}).join('');
  return `<section>
    <div class="inset">
      <div class="inset-row"><span>Version</span><b>v${esc((D.method||{}).version||'')}</b></div>
      <div class="inset-row"><span>Risk mode</span><b>${esc((D.method||{}).risk_mode||'')}</b></div>
      <div class="inset-row"><span>Drawdown</span><b class="num">${n(ds.main_drawdown_pct,1)}%</b></div>
      <div class="inset-row"><span>Loss streak</span><b class="num">${ds.main_loss_streak??0}</b></div>
    </div>
    <h2 class="group-h">Versions</h2><div class="inset">${vers||'<div class="empty">None.</div>'}</div>
    <h2 class="group-h">Challengers</h2><div class="inset">${ch||'<div class="empty">None active.</div>'}</div>
    <h2 class="group-h">Rules</h2><div class="inset">${(rv.rules||[]).map(x=>`<div class="inset-row"><span>${esc(x)}</span></div>`).join('')}</div>
    ${(D.changelog)?`<h2 class="group-h">Changelog</h2><pre class="log">${esc(D.changelog)}</pre>`:''}
  </section>`;
}
function scanPanel(){
  const S=D.scan||{}; if(!S.funnel) return '<section><div class="empty">No scan yet.</div></section>';
  const g=S.regime||{}, F=S.funnel, SC=S.setup_counts||{};
  const cands=(S.candidates||[]).slice(0,25).map((c,i)=>`<div class="inset-row"><span><b>${i+1} ${esc(c.ticker)}</b><span class="sub2">${esc(SETUPN[c.setup]||c.setup)} · score ${n(c.score,0)} · RS ${c.rs_rating} · ${c.order_kind==='buy_stop'?'stop':'limit'} ${n(c.entry)} · R:R ${rrTxt(c.rr)}</span><span class="sub2">${c.booked?BOOKN[c.booked]+' · ':''}${(c.flags||[]).join(', ')||'unflagged'}</span></span></div>`).join('');
  return `<section><p class="fine">Scan of the ${dshort(S.bar_date)} close. Universe ${n(F.universe,0)} to liquid ${n(F.liquid,0)} to setups ${n(F.uptrend_or_setup,0)}. Main ${S.n_main}, Shadow ${S.n_shadow}. SPY ${n(g.spy_close)} vs 200-day ${n(g.spy_sma200)} (${esc(g.state||'')}).</p>
    <div class="inset">${Object.entries(SC).map(([k,v])=>`<div class="inset-row"><span>${esc(SETUPN[k]||k)}</span><b class="num">${v}</b></div>`).join('')}</div>
    <h2 class="group-h">Top candidates</h2><div class="inset">${cands}</div></section>`;
}
function recsPanel(){
  const rows=RECS.slice().reverse().map(r=>`<div class="inset-row"><span><b>${esc(r.rec_id)} ${esc(r.ticker)}</b><span class="sub2">${dshort(r.issued_at)} · ${esc(BOOKN[r.account]||r.account)} · v${esc(r.method_version||'')}</span><span class="sub2">${esc(r.paper_outcome||'')}</span></span></div>`).join('');
  return `<section><p class="fine">recs.jsonl is append-only and hash-chained. Revisions are new records.</p><div class="inset">${rows||'<div class="empty">No recommendations.</div>'}</div></section>`;
}
function glossPanel(){
  return `<section><div class="inset">${Object.entries(D.glossary||{}).map(([k,v])=>`<div class="inset-row"><span><b>${esc(k)}</b><span class="sub2">${esc(v)}</span></span></div>`).join('')}</div></section>`;
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
    <div class="inset" id="diag">
      ${[['Feed',d.state],['Socket',d.socket],['Symbols',d.symbols+' (subscribed '+d.subs+')'],['Messages',String(d.msgs)],['Last message',hm(d.lastMsg)],['Last trade',hm(d.lastTrade)],['Last quote poll',hm(d.lastPoll)],['Last error',d.err||'none']].map(([k,v])=>`<div class="inset-row"><span>${k}</span><b class="num">${esc(v)}</b></div>`).join('')}
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
  flash(tk,dir){ $$(`[data-px="${tk}"]`).forEach(el=>{ el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash') }) },
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
  navState(){
    const st=Market.status(), q=Prices.get('SPY')||Prices.get(Live.symbols()[0]||'');
    const hm=q?etParts(q.t).hm:'';
    let label, c;
    if(st.open && Live.state==='live'){ label='Live'; c='live' }
    else if(st.phase==='after'||st.phase==='pre'){ label='After hours'; c='ah' }
    else { label='Closed'; c='closed' }
    const src=q?(q.via||q.src):'';
    return {label, c, hm, title: (q? (src+' · '+etParts(q.t).hms+' ET') : Market.label())};
  },
  strip(){
    const fs=this.feedStatus();
    const el=$('#ticker'); if(!el)return;
    const chips=Live.symbols().map(tk=>{
      const q=Prices.get(tk), mv=dayMove(tk);
      const both=(mv.d!=null&&mv.pct!=null)?`<span class="dim num ${cls(mv.d)}" data-chg data-day="${esc(tk)}">${moneyPct(mv.d, mv.pct)}</span>`:'';
      return `<button class="tq" data-jump="${esc(tk)}"><b>${esc(tk)}</b> <span class="num" data-px="${esc(tk)}">${q?n(q.p):''}</span> ${both}</button>`;
    }).join('');
    el.innerHTML=chips;
    const n0=$('#feed-note');
    if(n0){
      const dismissed=localStorage.getItem('sd.feed.dismissed')==='1';
      const show=fs.c==='err' || (fs.c==='off' && !dismissed);
      n0.hidden=!show;
      n0.innerHTML=show?`<span>${esc(fs.t)}. ${esc(fs.d)}</span><button type="button" data-tab="settings">Add key</button>${fs.c==='off'?'<button type="button" id="feed-dismiss" aria-label="Dismiss">×</button>':''}`:'';
    }
    const nav=this.navState(), m=$('#mkt'), mt=$('#mkt-t');
    if(m){ m.classList.remove('live','ah','closed'); m.classList.add(nav.c); m.title=nav.title }
    if(mt) mt.textContent=nav.label+(nav.hm?' '+nav.hm:'');
  },
  applyLive(){
    if(!D)return;
    this.strip();
    $$('[data-px]').forEach(el=>{ const q=Prices.get(el.dataset.px); if(q){ el.textContent=n(q.p); el.dataset.src=q.src } });
    $$('[data-pl]').forEach(el=>{ const t=T.find(x=>x.id===el.dataset.pl); if(!t)return; const pair=pnlPair(t);
      if(pair.d==null){el.textContent='';return} el.textContent=pair.pct==null?susd(pair.d,2):moneyPct(pair.d, pair.pct);
      el.classList.remove('pos','neg','mute'); el.classList.add(cls(pair.d)); });
    $$('[data-day]').forEach(el=>{ const mv=dayMove(el.dataset.day); if(mv.d==null||mv.pct==null)return; el.textContent=moneyPct(mv.d, mv.pct); el.classList.remove('pos','neg','mute'); el.classList.add(cls(mv.d)) });
    $$('[data-dist]').forEach(el=>{ const [id,lv]=el.dataset.dist.split('|'); const t=T.find(x=>x.id===id); if(!t)return; const pair=distPair(t,+lv); if(pair.d==null)return; el.textContent=moneyPct(pair.d, pair.pct); el.classList.remove('pos','neg','mute'); el.classList.add(cls(pair.d)) });
    $$('[data-dot]').forEach(el=>{ const t=T.find(x=>x.id===el.dataset.dot); const tr=el.closest('[data-track]'); if(!t||!tr)return; const px=Val.last(t.ticker); if(px==null)return;
      const s=+tr.dataset.stop, t2=+tr.dataset.t2; if(t2===s)return; el.style.left=Math.max(0,Math.min(100,(px-s)/(t2-s)*100))+'%' });
    $$('[data-chart-px]').forEach(c=>{ const px=Val.last(c.dataset.chartPx); const wrap=c.closest('.chart-wrap'); if(px==null||!wrap)return;
      const lo=+wrap.dataset.lo,hi=+wrap.dataset.hi,pt=+wrap.dataset.pt,pb=+wrap.dataset.pb,H=+wrap.dataset.h;
      const y=pt+(hi-px)/(hi-lo)*(H-pt-pb); c.setAttribute('cy',y); const line=c.previousElementSibling; if(line){line.setAttribute('y1',y);line.setAttribute('y2',y)} });
    for(const b of ['main','shadow','mambo']){
      const be=bookEq(b), he=$('#hero-eq');
      if(he && he.dataset.eq===b) he.textContent=usd(be.eq,2);
    }
    const hl=$('#hero-live'), b=state.acct||'main', be=bookEq(b), ch=dayChange(b);
    const hd=$('#hero-day');
    if(hd && ch.d!=null && ch.pct!=null){ hd.textContent=moneyPct(ch.d, ch.pct); hd.classList.remove('pos','neg','mute'); hd.classList.add(cls(ch.d)) }
    const hw=$('#hero-when'); if(hw) hw.textContent=ch.label;
    const sp=$('#hero-spy');
    if(sp && ch.spy!=null && ch.spyD!=null) sp.innerHTML='vs S&amp;P 500 <b class="num '+cls(ch.spy)+'" data-chg data-spy="1">'+moneyPct(ch.spyD, ch.spy)+'</b> since the last mark';
    if(hl) hl.textContent = be.any ? 'Live estimate '+moneyPct(be.d, be.base?be.d/be.base*100:null)+' versus the ledger mark of '+usd(be.base,2)+'. The official equity updates at the next check.' : '';
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
      if(t.status==='OPEN'&&lv.stop!=null&&q.p<=lv.stop) hits.push(['stop',`${t.ticker} crossed its stop ${n(lv.stop)} live at ${n(q.p)}, ${moneyPct((q.p-lv.stop)*(t.contracts_open||t.contracts||0), (q.p/lv.stop-1)*100)}`]);
      if(t.status==='OPEN'&&lv.t1!=null&&q.p>=lv.t1) hits.push(['t1',`${t.ticker} crossed T1 ${n(lv.t1)} live at ${n(q.p)}, ${moneyPct((q.p-lv.t1)*(t.contracts_open||t.contracts||0), (q.p/lv.t1-1)*100)}`]);
      if(t.status==='OPEN'&&lv.t2!=null&&q.p>=lv.t2) hits.push(['t2',`${t.ticker} crossed T2 ${n(lv.t2)} live at ${n(q.p)}, ${moneyPct((q.p-lv.t2)*(t.contracts_open||t.contracts||0), (q.p/lv.t2-1)*100)}`]);
      for(const [k,txt] of hits){ const id=t.id+k+day; if(seen[id])continue; out.push(`<div class="xb ${k==='stop'?'bad':'good'}" data-xid="${id}"><span>${esc(txt)} (${etParts(q.t).hms} ET, ${esc(BOOKN[t.book]||'')} ${esc(t.id)}) - the official ledger books it at the next check, from 5-minute bar data.</span><button data-dismiss="${id}" aria-label="Dismiss">×</button></div>`) }
    }
    box.innerHTML=out.join('');
  },
  stamp(){ const el=$('#ledger-stamp'); if(!el||!D)return; const g=String(D.as_of||D.generated_at||''); el.textContent='Ledger '+g.slice(0,16)+' ET' },
  diag(){ const box=$('#diag'); if(!box)return; const d=Live.diag(); const hm=ms=>ms?etParts(ms).hms:'never';
    const rows=[['Feed',d.state],['Socket',d.socket],['Symbols',d.symbols+' (subscribed '+d.subs+')'],['Messages',String(d.msgs)],['Last message',hm(d.lastMsg)],['Last trade',hm(d.lastTrade)],['Last quote poll',hm(d.lastPoll)],['Last error',d.err||'none']];
    box.innerHTML=rows.map(([k,v])=>`<div class="inset-row"><span>${k}</span><b class="num">${esc(v)}</b></div>`).join('') },
  toast(msg,action,cb){ const t=$('#toast'); t.innerHTML=`<span>${msg}</span>${action?`<button class="btn sm">${action}</button>`:''}<button class="x" aria-label="Close">×</button>`; t.hidden=false;
    if(action) $('.btn',t).onclick=cb; $('.x',t).onclick=()=>{t.hidden=true} },
  haptic(ms){ try{ if(navigator.vibrate) navigator.vibrate(ms||10) }catch(e){} }
};
function bindEq(root){
  $$('.eq-scrub', root||document).forEach(w=>{
    if(w.dataset.bound) return; w.dataset.bound='1';
    let pts=[]; try{ pts=JSON.parse(w.dataset.pts) }catch(e){ return }
    const tip=$('.eq-tip', w), svg=$('svg', w);
    const move=ev=>{
      const src=ev.touches?ev.touches[0]:ev;
      const r=svg.getBoundingClientRect();
      const x=(src.clientX-r.left)/r.width*(+w.dataset.w);
      let best=pts[0], bd=1e9;
      for(const p of pts){ const dd=Math.abs(p.x-x); if(dd<bd){bd=dd; best=p} }
      const dot=$('.eq-dot', w); if(dot){ dot.setAttribute('cx', best.x) }
      tip.hidden=false;
      const i=pts.indexOf(best);
      const ch=i===0?'First mark': moneyPct(best.d, best.pct);
      tip.innerHTML='<b class="num">'+usd(best.eq,2)+'</b><br>'+esc(dshort(best.t))+'<br><span class="num">'+esc(ch)+'</span> vs prior mark';
      tip.style.left=Math.max(48, Math.min(r.width-48, (best.x/(+w.dataset.w))*r.width))+'px';
    };
    w.addEventListener('pointerdown', move);
    w.addEventListener('pointermove', ev=>{ if(ev.buttons||ev.pointerType==='touch') move(ev) });
  });
}
function bindChart(root){
  bindEq(root);
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

state.tab=qs.get('tab')||'home'; state.ins='perf'; state.act='fills'; state.emph=localStorage.getItem('sd.emph')||'usd'; state.range=localStorage.getItem('sd.range')||'1M';
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
  if(e.target.closest('#feed-dismiss')){ localStorage.setItem('sd.feed.dismissed','1'); UI.applyLive(); return }
  const cap=e.target.closest('[data-cap]'); if(cap){ state.emph=state.emph==='pct'?'usd':'pct'; localStorage.setItem('sd.emph', state.emph); render(); return }
  const rg=e.target.closest('[data-range]'); if(rg){ state.range=rg.dataset.range; localStorage.setItem('sd.range', state.range); render(); return }
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
window.__chgAudit=function(){
  const bad=[];
  document.querySelectorAll('[data-chg]').forEach(el=>{
    const t=el.textContent||'';
    if(!/\$/.test(t)||!/%/.test(t)) bad.push(t.slice(0,80));
  });
  const bag=(sel,key)=>{ const o={}; document.querySelectorAll(sel).forEach(el=>{ const k=el.dataset[key]; (o[k]=o[k]||{}); o[k][el.textContent.trim()]=1 }); const bad={}; for(const [k,v] of Object.entries(o)){ const ks=Object.keys(v); if(ks.length>1) bad[k]=ks } return bad };
  return {bad, px:bag('[data-px]','px'), day:bag('[data-day]','day'), pl:bag('[data-pl]','pl')};
};
window.__ok=true;

})();
