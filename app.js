(function(){
"use strict";
/* Swing Desk app. Paper trading only. Live prices are informational; the official ledger is data.json. */
const APP_VERSION='7badcb8704';
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
const BOOKN={main:'Main',shadow:'Practice',mambo:'Mine'};
const BOOKLINE={main:"The system's main paper account",shadow:'Practice trades the system tests before using them for real.',mambo:'Your own picks, separate from the system.'};
let D=null,T=[],TECH={},ACC={},FILLS=[],RECS=[];
const state={acct:qs.get('acct')||'main',recs:qs.get('recs')||'main'};
function setData(d){D=d;T=D.trades||[];TECH=D.technicals||{};ACC=(D.accounts||{}).accounts||{};FILLS=(D.accounts||{}).fills||[];RECS=(D.accounts||{}).recs||[]; if(window.__bustTabs) window.__bustTabs() }

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
function sessionPrev(tk){
  const q=Prices.get(tk);
  /* A live Finnhub quote carries pc for the previous completed session. */
  if(q&&q.src!=='ledger'&&q.pc) return q.pc;
  const candles=(TECH[tk]||{}).candles||[];
  const priceDate=q&&q.t?etParts(q.t).date:null;
  if(priceDate&&candles.length){
    const prior=candles.filter(c=>String(c[0])<priceDate);
    if(prior.length) return +prior[prior.length-1][4];
  }
  return q&&q.pc?+q.pc:null;
}
function dayMove(tk){
  const q=Prices.get(tk), pc=sessionPrev(tk);
  if(!q||pc==null||!pc) return {d:null,pct:null,pc};
  const d=q.p-pc;
  return {d, pct:d/pc*100, pc};
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
  const up=s[s.length-1]>s[0], dn=s[s.length-1]<s[0];
  const col=up?'var(--up)':dn?'var(--down)':'var(--label3)';
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="${col}" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
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

function candleChart(t, plain){
  const tc=TECH[t.ticker];const lv=(t.reasoning||{}).levels||{};
  if(!tc||!tc.candles||!tc.candles.length)return '<div class="empty">Chart unavailable</div>';
  const C=tc.candles.slice(-(innerWidth<480?46:60)),W=640,H=plain?300:220,PR=plain?12:86,PT=plain?20:14,PB=22;
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
  const pairs=plain?[['Target 2',lv.t2,'var(--up)'],['Target 1',lv.t1,'var(--tint)'],['Entry',ref,'var(--label2)'],['Safety exit',lv.stop,'var(--down)']]:[['Stop',lv.stop,'var(--down)'],['Entry',ref,'var(--label2)'],['T1',lv.t1,'var(--tint)'],['T2',lv.t2,'var(--up)']];
  const tags=[];
  pairs.forEach(([nm,v,col])=>{
    if(v==null)return; let yy=y(v); lines+=`<line x1="0" x2="${W-PR}" y1="${yy}" y2="${yy}" stroke="${col}" stroke-dasharray="3 4" stroke-width="1" stroke-opacity=".85"/>`;
    if(plain){ tags.push({nm,v,col,y:yy}); return; }
    let ly=yy; used.forEach(u=>{if(Math.abs(u-ly)<13)ly=u+13}); used.push(ly);
    labels+=`<text x="${W-PR+8}" y="${ly+4}" fill="${col}">${nm} ${n(v)}</text>`});
  if(plain&&tags.length){
    const FS=19, PH=28, GAP=4, top=PT+PH/2, bot=H-PB-PH/2;
    tags.sort((a,b)=>a.y-b.y);
    tags.forEach(t=>{ t.ly=Math.min(bot, Math.max(top, t.y)); });
    for(let i=1;i<tags.length;i++) if(tags[i].ly<tags[i-1].ly+PH+GAP) tags[i].ly=tags[i-1].ly+PH+GAP;
    if(tags[tags.length-1].ly>bot){ tags[tags.length-1].ly=bot; for(let i=tags.length-2;i>=0;i--) if(tags[i].ly>tags[i+1].ly-PH-GAP) tags[i].ly=tags[i+1].ly-PH-GAP; }
    tags.forEach(t=>{
      const text=`${t.nm} $${n(t.v)}`, tw=text.length*FS*0.56+18, x1=W-4-tw;
      labels+=`<g class="lvtag"><rect x="${x1.toFixed(1)}" y="${(t.ly-PH/2).toFixed(1)}" width="${tw.toFixed(1)}" height="${PH}" rx="${PH/2}" fill="var(--group)" fill-opacity=".9" stroke="${t.col}" stroke-opacity=".45"/><text x="${(W-4-9).toFixed(1)}" y="${(t.ly+FS*0.35).toFixed(1)}" text-anchor="end" fill="${t.col}" style="font-size:${FS}px;font-weight:600;font-variant-numeric:tabular-nums">${esc(text)}</text></g>`;
    });
  }
  const legend='';
  const cur=spotOf(t)||C[C.length-1][4], cx=(C.length-1)*step+step/2, cy=y(cur);
  const mk=`<line x1="${cx}" x2="${W-PR}" y1="${cy}" y2="${cy}" stroke="currentColor" stroke-opacity=".25" stroke-dasharray="1 3"/><circle class="now" data-chart-px="${esc(t.ticker)}" cx="${cx}" cy="${cy}" r="4.5" fill="var(--label)"/>`;
  return legend+`<div class="chart-wrap" data-tk="${esc(t.ticker)}" data-n="${C.length}" data-step="${step}" data-w="${W}" data-pr="${PR}" data-lo="${lo}" data-hi="${hi}" data-pt="${PT}" data-pb="${PB}" data-h="${H}"><svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(t.ticker)} chart">${g}${cs}${lines}${mk}${labels}<line class="xh" y1="${PT}" y2="${H-PB}"/><line class="yh" x2="${W-PR}"/></svg><div class="tip" hidden></div></div>`;
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
  const since=dshort(rows[0].t).split(',')[0];
  const label=`Since ${since}`;
  return `<div class="eq-scrub" data-pts="${esc(JSON.stringify(meta))}" data-w="${W}" data-h="${H}">
    <svg class="eq" viewBox="0 0 ${W} ${H}" role="img" aria-label="Equity, ${esc(label)}">
      <defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--tint)" stop-opacity=".28"/><stop offset="1" stop-color="var(--tint)" stop-opacity="0"/></linearGradient></defs>
      <line x1="${P}" x2="${W-P}" y1="${xy[0][1].toFixed(1)}" y2="${xy[0][1].toFixed(1)}" stroke="currentColor" stroke-opacity=".28" stroke-dasharray="2 4"/>
      <path d="${area}" fill="url(#${gid})"/><path d="M${line}" fill="none" stroke="var(--tint)" stroke-width="2.25" stroke-linejoin="round"/>${spy}
      <circle class="eq-dot" r="4.5" fill="var(--label)" cx="${xy[xy.length-1][0]}" cy="${xy[xy.length-1][1]}"/>
    </svg>
    <div class="eq-tip" hidden></div>
  </div>`;
}

function dayChange(b){
  const key=b==='main'?'equity':b+'_equity', H=(D.equity_history||[]).filter(h=>h[key]!=null);
  const be=bookEq(b);
  const session=(Prices.get('SPY')&&Prices.get('SPY').t)?etParts(Prices.get('SPY').t).date:etParts().date;
  const prior=H.filter(h=>String(h.t).slice(0,10)<session);
  const base=prior.length?prior[prior.length-1][key]:(H[0]?H[0][key]:be.k.start);
  const d=be.eq-base;
  const sm=dayMove('SPY');
  return {d, pct:base?d/base*100:null, spy:sm.pct, spyD:sm.d, label:'Today', base};
}
function usefulRanges(book){
  const all=histRows(book);
  const out=[];
  for(const r of ['1W','1M']){
    const n=all.filter(row=>{
      const last=parseET(all[all.length-1].t)||0;
      const days=r==='1W'?7:30;
      return (parseET(row.t)||0)>=last-days*864e5;
    }).length;
    if(n>=2 && n<all.length) out.push(r);
  }
  return out.length?out.concat(['ALL']):[];
}

function rowSub(t, withBook){
  const name=[t.name, SETUPN[t.setup_type]].filter(Boolean).join(' · ');
  const bits=[];
  if(withBook) bits.push(BOOKN[t.book]||'');
  if(t.status!=='OPEN') bits.push(status(t)[0]);
  if(name) bits.push(name);
  return bits.filter(Boolean).join(' · ');
}
function legendDots(){ return ''; }
function posCard(t, withBook){
  const pl=pnlPair(t), dm=dayMove(t.ticker);
  const cap=(dm.d!=null&&dm.pct!=null)?`<span class="cap ${cls(dm.d)}" data-cap data-chg data-day="${esc(t.ticker)}">${moneyPct(dm.d, dm.pct)}</span>`:'';
  const pln=(pl.d!=null&&pl.pct!=null)?`<span class="pl ${cls(pl.d)}" data-chg data-pl="${t.id}">${moneyPct(pl.d, pl.pct)}</span>`:(pl.d==null?'':`<span class="pl ${cls(pl.d)}" data-pl="${t.id}">${susd(pl.d,2)}</span>`);
  const todo=(t.status==='OPEN'||t.status==='PENDING')?`<button type="button" class="todo" data-todo="${t.id}">What to do</button>`:'';
  return `<div class="prow">
    <div class="hit" data-trade="${t.id}" role="button" tabindex="0">
      <div class="pos-r">
        <div class="pos-id"><b class="tk">${esc(t.ticker)} ${News.dot(t.ticker)} ${alertChip(t)}</b><span class="co">${esc(rowSub(t, withBook))}</span></div>
        ${spark(t.ticker)}
        <div class="pos-px"><b class="num px" data-px="${esc(t.ticker)}">${spotOf(t)==null?'n/a':n(spotOf(t))}</b>${cap}${pln}</div>
      </div>
      ${(t.status==='OPEN'||t.status==='PENDING')?track(t):''}
    </div>
    ${todo}
  </div>`;
}


function trigKind(t){
  const o=t.entry_order||{};
  if(o.kind==='buy_stop') return 'Buy-stop';
  if(o.kind==='limit_zone') return 'Limit zone';
  return 'Entry';
}
function trigPx(t){
  const o=t.entry_order||{};
  if(o.kind==='limit_zone'&&o.zone) return o.zone[1];
  return o.trigger;
}
function awayPair(t){
  const px=Val.last(t.ticker), ent=trigPx(t);
  if(px==null||ent==null||!px) return null;
  return {d:ent-px, pct:(ent/px-1)*100};
}
function entryState(t){
  const px=Val.last(t.ticker), o=t.entry_order||{}, ent=trigPx(t);
  let hit=false;
  if(px!=null&&ent!=null){
    if(o.kind==='buy_stop') hit=px>=o.trigger;
    else if(o.kind==='limit_zone'&&o.zone) hit=px<=o.zone[1];
  }
  return hit?'Triggered':'Watching';
}
function entryCard(t){
  const lv=(t.reasoning||{}).levels||{};
  const ent=trigPx(t), aw=awayPair(t);
  const who=t.book&&t.book!=='main'?BOOKN[t.book]:'';
  return `<div class="ecard">
    <div class="hit" data-trade="${t.id}" role="button" tabindex="0">
      <div class="ec-top"><b>${esc(t.ticker)}</b><span class="echip">${esc(trigKind(t))}</span></div>
      <p class="fine">${esc(SETUPN[t.setup_type]||'')}${who?' · '+esc(who):''}</p>
      <div class="ec-3">
        <div><span>Entry</span><b class="num">$${n(ent)}</b></div>
        <div><span>Stop</span><b class="num neg">$${n(lv.stop)}</b></div>
        <div><span>Target</span><b class="num upv">$${n(lv.t1)}</b><span class="t2">Final $${n(lv.t2)}</span></div>
      </div>
      <div class="ec-bot">${aw?`<span class="cap ${cls(aw.d)}" data-chg data-away="${t.id}">${moneyPct(aw.d, aw.pct)} away</span>`:''}<span class="echip">${entryState(t)}</span><span class="fine">${(t.entry_order||{}).valid_until?'Expires '+dshort(t.entry_order.valid_until):''}</span></div>
    </div>
    <button type="button" class="todo" data-todo="${t.id}">What to do</button>
  </div>`;
}
function pickCard(c){
  const bits=[];
  if(c.score!=null) bits.push('Score '+n(c.score,0));
  if(c.rs_rating!=null) bits.push('RS '+c.rs_rating);
  if(c.regime) bits.push(String(c.regime));
  return `<button class="ecard" data-pick="${esc(c.ticker)}">
    <div class="ec-top"><b>${esc(c.ticker)}</b><span class="echip">${esc(c.order_kind==='buy_stop'?'Buy-stop':'Limit zone')}</span><span class="echip quiet">${esc(SETUPN[c.setup]||c.setup||'')}</span></div>
    <div class="ec-3">
      <div><span>Entry</span><b class="num">${c.entry!=null?'$'+n(c.entry):'n/a'}</b></div>
      <div><span>Stop</span><b class="num">${c.stop!=null?'$'+n(c.stop):''}</b></div>
      <div><span>Target</span><b class="num">${c.t2_pct!=null?n(c.t2_pct,0)+'% to T2':''}</b></div>
    </div>
    <div class="ec-bot"><span class="echip">Watching</span>${bits.length?`<span class="fine">${esc(bits.join(' · '))}</span>`:''}</div>
  </button>`;
}
function rules(){ return D.alert_rules||{near_level_pct:0.02, earnings_trading_days:10}; }
function rowAlert(t){
  if(!t||(t.status!=='OPEN'&&t.status!=='PENDING')) return '';
  const px=Val.last(t.ticker), lv=(t.reasoning||{}).levels||{}, near=rules().near_level_pct||0.02;
  if(t.status==='OPEN'&&t.t1_hit) return 'T1 hit';
  const close=(level)=>px!=null&&level!=null&&px&&Math.abs(px-level)/px<=near;
  if(t.status==='OPEN'&&close(lv.stop)&&px<=lv.stop*(1+near)) return 'Near stop';
  if(t.status==='OPEN'&&close(lv.t1)) return 'Near T1';
  const e=t.earnings||{};
  const days=e.trading_days_away!=null?e.trading_days_away:daysTo(e.date);
  if(e.date&&days!=null&&days>=0&&days<=(rules().earnings_trading_days||10)) return 'Earnings '+dshort(e.date);
  return '';
}
function alertChip(t){ const a=rowAlert(t); return a?`<span class="achip">${esc(a)}</span>`:''; }
const News={items:[], loaded:false,
  set(list){ this.items=Array.isArray(list)?list:[]; },
  forTicker(tk){ const cut=(Date.now()/1000)-48*3600; return this.items.filter(n=>n.ticker===tk&&(n.t||0)>=cut).sort((a,b)=>(b.big-a.big)||((b.t||0)-(a.t||0))); },
  dot(tk){ return this.forTicker(tk).length?'<i class="ndot" title="Headline in the last 48 hours"></i>':''; }
};
function ago(sec){ if(!sec) return ''; const m=Math.max(0,Math.round(Date.now()/1000-sec)); if(m<3600) return Math.max(1,Math.round(m/60))+'m'; if(m<86400) return Math.round(m/3600)+'h'; return Math.round(m/86400)+'d'; }
function newsBlock(t){
  const rows=News.forTicker(t.ticker).slice(0,3);
  if(!rows.length) return '';
  return `<h2 class="group-h">News</h2><div class="inset">${rows.map(n=>`<a class="inset-row news" href="${esc(n.url)}" target="_blank" rel="noopener"><span><b>${esc(n.headline)}</b><span class="sub2">${esc(n.source||'')} · ${ago(n.t)}${n.big?' · Notable':''}</span></span></a>`).join('')}</div>`;
}

function watchlistHTML(){
  const live=String((D.method||{}).version||'');
  const rows=((D.scan||{}).candidates||[]).filter(c=>!c.booked && String(c.method_version||'')===live && !T.some(t=>t.ticker===c.ticker&&(t.status==='OPEN'||t.status==='PENDING'))).slice(0,4);
  if(!rows.length) return '';
  return `<h2 class="group-h">Watchlist</h2><p class="fine">Not orders.</p><div class="group">${rows.map(c=>`<button type="button" class="cell" data-pick="${esc(c.ticker)}"><div class="c1"><b>${esc(c.ticker)}</b><span class="sub2">${esc(SETUPN[c.setup]||c.setup||'')} · not an order</span></div><div class="c3 num">${c.score==null?'':n(c.score,0)}</div></button>`).join('')}</div>`;
}
function clipWords(s, max){
  return String(s||'').replace(/[()[\]]/g,' ').replace(/\s+/g,' ').trim().split(' ').filter(Boolean).slice(0,max).join(' ');
}
function reasonBlock(t){
  const r=t.reasoning||{}, lv=r.levels||{}, o=t.entry_order||{};
  const why=clipWords((r.summary||'').split(':')[0]||setupName(t), 10);
  let timing='';
  if(t.status==='OPEN') timing=clipWords('Filled at '+n(entryRef(t)), 10);
  else if(o.kind==='buy_stop') timing=clipWords('Buy-stop '+n(o.trigger)+(o.valid_until?' through '+dshort(o.valid_until):''), 10);
  else if(o.kind==='limit_zone') timing=clipWords('Limit through '+(o.valid_until?dshort(o.valid_until):'this week'), 10);
  else timing=clipWords(r.why_now||'', 10);
  const levels=clipWords('Stop '+n(lv.stop)+' first target '+n(lv.t1)+' final '+n(lv.t2), 10);
  const risk=clipWords(String((r.risks||[])[0]||'').split('.')[0], 10);
  const conf=clipWords((((r.confidence||{}).rating)||'')+' '+(((r.confidence||{}).plus||[])[0]||''), 10);
  const rows=[['Why',why,r.why_stock||r.summary||''],['Timing',timing,r.why_now||''],['Levels',levels,levelSentence(t)+' '+(rebaseNote(t)||'')],['Risk',risk,(r.risks||[]).join(' ')],['Confidence',conf,(r.confidence||{}).why||'']];
  return `<div class="reasons">${rows.filter(x=>x[1]).map(([k,h,body])=>`<details><summary><b>${k}</b><span>${esc(h)}</span></summary>${body?`<p>${esc(body)}</p>`:''}</details>`).join('')}</div>`;
}
function sizeView(obj){
  const raw=obj&&obj.size_small;
  if(!raw||(raw.shares==null&&raw.dollars==null&&raw.risk_usd==null&&raw.amount==null&&raw.risk==null)) return null;
  const base=+raw.equity||+raw.account||150;
  const mine=+localStorage.getItem('sd.acct.size')||150;
  const k=base?mine/base:1;
  const sh=raw.shares==null?null:raw.shares*k;
  const amt=(raw.dollars!=null?raw.dollars:raw.amount);
  const dollars=amt==null?null:amt*k;
  const riskRaw=raw.risk_usd!=null?raw.risk_usd:raw.risk;
  const t1Raw=raw.t1_usd!=null?raw.t1_usd:raw.t1;
  const t2Raw=raw.t2_usd!=null?raw.t2_usd:raw.t2;
  const text=(sh!=null||dollars!=null)?`For ${usd(mine,0)}: ${sh!=null?n(sh,4)+' sh':''}${dollars!=null?' · '+usd(dollars,0):''}`:'';
  return {text, line:text?`<p class="size150">${text}</p>`:'', risk:riskRaw==null?null:riskRaw*k, t1:t1Raw==null?null:t1Raw*k, t2:t2Raw==null?null:t2Raw*k, mine, shares:sh, amount:dollars};
}
function guideSteps(t){
  const lv=(t.reasoning||{}).levels||{};
  const o=t.entry_order||{};
  const open=t.status==='OPEN';
  const ent=open?entryRef(t):trigPx(t);
  const stop=lv.stop, t1=lv.t1, t2=lv.t2;
  const px=Val.last(t.ticker);
  const now=px==null?'':` (it's ${usd(px,2)} now)`;
  const exp=o.valid_until?dshort(o.valid_until):'';
  const sz=sizeView(t);
  const qty=t.contracts_open??t.contracts;
  const loss=sz&&sz.risk!=null?sz.risk:(qty!=null&&ent!=null&&stop!=null?Math.abs(ent-stop)*qty:null);
  const lossTxt=loss==null?'':` That caps the loss at about ${usd(Math.abs(loss),0)}.`;
  const pctOf=(a,b)=>(a!=null&&b)?Math.round((a/b-1)*100):null;
  const steps=[];
  if(!open){
    let buy=o.kind==='limit_zone'
      ?`Buy only if the price falls to ${usd(ent,2)}${now}.`
      :`Buy only if the price rises to ${usd(ent,2)}${now}.`;
    if(t.watch&&t.wait==='weak') buy='The system is not buying yet. The market is too weak. '+buy;
    if(exp) buy+=` Order expires ${exp}.`;
    if(sz&&sz.shares!=null) buy+=` With ${usd(sz.mine,0)}: buy ${n(sz.shares, 4)} shares (about ${usd(sz.amount,0)}).`;
    steps.push(buy);
  }else{
    let own=`You own it at ${usd(ent,2)}.`;
    const half=t.contracts_initial!=null&&t.contracts_open!=null&&t.contracts_open<t.contracts_initial*0.75;
    if(half) own+=' You already sold half.';
    else if(px!=null&&t2!=null&&px>=t2) own+=' The final target is reached.';
    else if(px!=null&&t1!=null&&px>=t1) own+=' The first target is reached.';
    else own+=' Not at the first target yet.';
    if(px!=null) own+=` It's ${usd(px,2)} now.`;
    if(sz&&sz.shares!=null) own+=` With ${usd(sz.mine,0)}: ${n(sz.shares, 4)} shares (about ${usd(sz.amount,0)}).`;
    steps.push(own);
  }
  if(stop!=null) steps.push(`${open?'Keep a sell order':'Right after buying, set a sell order'} at ${usd(stop,2)}. If it falls there, sell everything.${lossTxt}`);
  if(t1!=null) steps.push(`When it reaches ${usd(t1,2)}${pctOf(t1,ent)!=null?' (+'+pctOf(t1,ent)+'%)':''}, sell half.`);
  steps.push('Then move your safety exit up to your buy price, so the rest cannot lose.');
  const when=t.time_stop?dshort(t.time_stop):'';
  if(t2!=null) steps.push(`Sell the rest at ${usd(t2,2)}${pctOf(t2,ent)!=null?' (+'+pctOf(t2,ent)+'%)':''}${when?', or on '+when+' if neither happened':''}.`);
  const ed=(t.earnings||{}).date;
  if(ed) steps.push(`The day before earnings on ${dshort(ed)}: if you already sold half, keep the rest and leave the safety exit at your buy price. If you are up 5% or more, sell half and move the safety exit to your buy price. Otherwise sell everything.`);
  if(sz&&sz.shares!=null&&Math.abs(sz.shares-Math.round(sz.shares))>1e-4) steps.push("If your broker won't let you set a sell order on part shares, watch for the app's alert and sell by hand.");
  return steps;
}
function guideText(t){ return guideSteps(t).map((s,i)=>`${i+1}. ${s}`).join('\n'); }
function homeView(){
  const b=state.acct||'main', be=bookEq(b), ch=dayChange(b);
  const open=T.filter(t=>t.book===b&&t.status==='OPEN');
  const pend=T.filter(t=>t.book===b&&t.status==='PENDING');
  const nx=(D.next||[]).filter(x=>x.book===b).slice(0,4);
  const ranges=usefulRanges(b);
  if(state.range!=='ALL' && !ranges.includes(state.range)) state.range='ALL';
  const chips=ranges.map(r=>`<button data-range="${r}" class="${(state.range||'ALL')===r?'on':''}">${r}</button>`).join('');
  const sm=dayMove('SPY');
  const spy=(sm.d!=null&&sm.pct!=null)?`<p class="vs" id="hero-spy">vs S&amp;P 500 <b class="num ${cls(sm.d)}" data-chg data-day="SPY">${moneyPct(sm.d, sm.pct)}</b></p>`:'<p class="vs" id="hero-spy"></p>';
  const cards=pend.map(entryCard).join('');
  return `<section id="overview" data-screen="home">
    <p class="hero-eq num" id="hero-eq" data-eq="${b}">${usd(be.eq,2)}</p>
    <p class="hero-row"><span class="capsule num ${cls(ch.d)}" id="hero-day" data-chg>${ch.d==null||ch.pct==null?susd(ch.d,2):moneyPct(ch.d, ch.pct)}</span> <span class="hero-when" id="hero-when">${esc(ch.label)}</span></p>
    ${cards?`<h2 class="group-h">Next entries</h2><div class="erow">${cards}</div>`:''}
    ${areaChart(b,false)}
    ${chips?`<div class="ranges" role="tablist">${chips}</div>`:''}
    ${spy}
    <p class="fine" id="ledger-stamp"></p>
    <p class="fine" id="hero-live"></p>
    <h2 class="group-h">Open</h2>
    <div class="group">${open.length?open.map(t=>posCard(t,false)).join(''):'<div class="empty"><span class="empty-i" aria-hidden="true"></span>No open positions</div>'}</div>
    ${b==='main'?watchlistHTML():''}
    ${nx.length?`<h2 class="group-h">Attention</h2><div class="group">${nx.map(x=>`<div class="cell static"><div class="c1"><b>${dshort(x.date)}</b><span class="sub2">${esc(x.label)}</span></div><div class="c3 sub2">${daysTo(x.date)}d</div></div>`).join('')}</div>`:''}
  </section>`;
}

function positionsView(){
  const b=state.recs||'main';
  const order={OPEN:0,PENDING:1,CLOSED:2,CANCELLED:3};
  const ts=T.filter(t=>b==='all'||t.book===b).sort((x,y)=>(order[x.status]-order[y.status])||((y.scores||{}).total||0)-((x.scores||{}).total||0));
  return `<section data-screen="positions">
    <div class="group">${ts.map(t=>posCard(t, b==='all')).join('')||'<div class="empty"><span class="empty-i" aria-hidden="true"></span>Nothing in this book</div>'}</div>
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
function distPhrase(t, label, val){
  const pair=distPair(t, val);
  if(pair.d==null||pair.pct==null) return '';
  if(label==='Entry'){
    const above=-pair.d, pc=-pair.pct;
    return 'you\'re '+moneyPct(above, pc)+' '+(above>0?'above':above<0?'below':'at entry');
  }
  if(label==='Stop') return moneyPct(pair.d, pair.pct)+' if hit';
  return moneyPct(pair.d, pair.pct)+' to go';
}
function levelRow(t, label, val, tone){
  if(val==null) return '';
  const phrase=distPhrase(t, label, val);
  const dist=phrase?`<span class="dist ${cls(label==='Entry'?-(distPair(t,val).d):distPair(t,val).d)}" data-chg data-dist="${t.id}|${val}|${label}">${esc(phrase)}</span>`:'';
  return `<div class="inset-row lvl"><span class="lv-k">${label}</span><span class="inset-v"><b class="num ${tone||''}">${n(val)}</b>${dist}</span></div>`;
}
function detailHTML(t){
  const r=t.reasoning||{}, lv=r.levels||{}, wl=r.why_levels||{};
  const [st]=status(t), pair=pnlPair(t), cf=conf(t);
  const risks=(r.risks||[]).map(x=>`<li>${esc(x)}</li>`).join('');
  const fills=(t.fills||[]).map(f=>`<div class="inset-row"><span>${esc(f.kind)}<span class="sub2">${dshort(f.filled_at)} · ${esc(f.price_source||'')}</span></span><b class="num">${f.fill_price==null?'':n(f.fill_price)}</b></div>`).join('');
  const pln=(pair.d!=null&&pair.pct!=null)?`<p class="plline"><span class="capsule ${cls(pair.d)}"><span data-chg data-pl="${t.id}">${moneyPct(pair.d, pair.pct)}</span><span class="paper">paper</span></span></p>`:(pair.d==null?'':`<p class="plline"><span class="capsule ${cls(pair.d)}"><span data-pl="${t.id}">${susd(pair.d,2)}</span><span class="paper">paper</span></span></p>`);
  return `<div class="sheet-h"><button class="x" data-close aria-label="Close">Close</button><div class="grab"></div></div>
    <div class="sheet-body" id="sheet-body">
      <p class="eyebrow">${esc(BOOKN[t.book]||'')} · ${esc(st)}${cf?' · '+esc(cf[0])+' confidence':''}</p>
      <h2 class="sheet-title">${esc(t.ticker)} <span class="num livepx" data-px="${esc(t.ticker)}">${n(spotOf(t))}</span></h2>
      <p class="co">${esc(t.name||'')} · ${esc(setupName(t))}</p>
      ${pln}
      ${t.book==='aira'?panelHTML(t.panel):''}
      ${candleChart(t)}
      ${legendDots()}
      ${track(t)}
      ${sizeView(t)?sizeView(t).line:''}
      <div class="inset">
        ${levelRow(t,'Entry',entryRef(t),'')}
        ${levelRow(t,'Stop',lv.stop,'neg')}
        ${sizeView(t)&&sizeView(t).risk!=null?`<div class="inset-row"><span>Risk</span><b class="num">${usd(sizeView(t).risk,0)}</b></div>`:''}
        ${levelRow(t,'T1',lv.t1,'')}
        ${sizeView(t)&&sizeView(t).t1!=null?`<div class="inset-row"><span>At first target</span><b class="num">${usd(sizeView(t).t1,0)}</b></div>`:''}
        ${levelRow(t,'T2',lv.t2,'upv')}
        ${sizeView(t)&&sizeView(t).t2!=null?`<div class="inset-row"><span>At final target</span><b class="num">${usd(sizeView(t).t2,0)}</b></div>`:''}
        <div class="inset-row"><span>Shares</span><b class="num">${n(t.contracts_open??t.contracts,0)}</b></div>
        <div class="inset-row"><span>Paper risk</span><b class="num">${usd(t.max_risk_usd)}</b></div>
        <div class="inset-row"><span>R:R</span><b class="num">${rrTxt(t.rr)}</b></div>
        <div class="inset-row"><span>Time stop</span><b>${t.time_stop?dshort(t.time_stop):((t.time_stop_weeks||'n/a')+' wks')}</b></div>
        <div class="inset-row"><span>Earnings</span><b>${earnTxt(t)}</b></div>
        <div class="inset-row"><span>Order</span><b>${esc(orderText(t))}</b></div>
      </div>
      ${reasonBlock(t)}
      <button type="button" class="todo" data-todo="${t.id}">What to do</button>
      ${t.postmortem?`<p class="fine">${esc(t.postmortem.one_liner||t.postmortem.why||'')}</p>`:''}
      <p class="fine">${esc(t.id)} · rec ${esc(t.rec_id||'n/a')} · method v${esc(t.method_version||'')} · issued ${dshort(t.created_at)} ET</p>
      ${newsBlock(t)}${fills?`<h2 class="group-h">Fills</h2><div class="inset">${fills}</div>`:''}
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
    const pend=T.filter(t=>t.status==='PENDING');
    const cards=pend.length?`<h2 class="group-h">Next entries</h2><div class="erow">${pend.map(entryCard).join('')}</div>`:'';
    const fl=FILLS.slice().reverse();
    body=cards+`<div class="group">${fl.map(f=>{
      const bought=f.kind==='entry'||f.side==='buy';
      const k=f.kind==='cancel'?'exit':(f.side==='sell'?'exit':'fill');
      const who=BOOKN[f.account]||f.account||'';
      const title=bought?`${esc(f.ticker)} Bought`:`${esc(f.ticker)} ${esc((f.kind||'').replace('_',' '))}`;
      return `<div class="tl-item" id="fill-${f.fill_id}">${ico(k)}<div><b>${title}</b><span class="sub2">${dshort(f.filled_at)} · ${who}</span></div><b class="num">${f.fill_price==null?'':(bought?'$'+n(f.fill_price):n(f.fill_price))}</b></div>`;
    }).join('')||'<div class="empty"><span class="empty-i" aria-hidden="true"></span>No fills yet</div>'}</div>`;
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
    <p class="hero-eq num">${usd(be.eq,2)}</p>
    <p class="capsule ${cls(ch.d)}" data-chg>${moneyPct(ch.d, ch.pct)}</p>
    <div class="card">${areaChart(b,true)}</div>
    ${usefulRanges(b).length?`<div class="ranges">${usefulRanges(b).map(r=>`<button data-range="${r}" class="${(state.range||'ALL')===r?'on':''}">${r}</button>`).join('')}</div>`:''}
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
    <h2 class="group-h">Account</h2>
    <div class="group padg">
      <label class="lbl" for="acct-size">My account size</label>
      <div class="keyrow"><input id="acct-size" inputmode="decimal" value="${esc(localStorage.getItem('sd.acct.size')||'150')}"><span class="fine">Dollars. Rescales a pick's $150 plan on this device. Default 150.</span></div>
    </div>
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
        <h2 class="group-h">About</h2>
    <div class="inset">
      <div class="inset-row"><span>Paper only, not advice. Exit value is the last price minus 0.2% slippage. Official fills come from the 5-minute checks. The chart's dashed line is the account's start. Today versus the S&amp;P is on Home. Since-start versus the S&amp;P is here.</span></div>
      ${Object.entries(D.glossary||{}).map(([k,v])=>`<div class="inset-row"><span><b>${esc(k)}</b><span class="sub2">${esc(v)}</span></span></div>`).join('')}
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


const LEGACY_IDS=new Set(['C20261007-003','C20261007-004','C20261007-005','C20261007-006']);
function onFeed(t){
  if(!t||(t.book!=='main')) return false;
  if(t.status!=='OPEN'&&t.status!=='PENDING') return false;
  if(t.legacy_pre_autonomy||t.selected_by==='legacy_pre_autonomy'||t.book==='legacy_main') return false;
  const ids=new Set(LEGACY_IDS);
  (((D.compare||{}).legacy_main||{}).trade_ids||[]).forEach(id=>ids.add(id));
  if(ids.has(t.id)) return false;
  return true;
}
function actionDist(t){
  const px=Val.last(t.ticker), lv=(t.reasoning||{}).levels||{};
  const levels=[lv.stop,lv.t1,lv.t2].filter(v=>v!=null);
  if(px==null||!px||!levels.length) return 9;
  return Math.min(...levels.map(v=>Math.abs(v/px-1)));
}
function miniPnl(t){
  const sz=sizeView(t), ent=entryRef(t), px=Val.exit(t.ticker);
  if(!sz||sz.shares==null||!sz.shares||ent==null||px==null) return null;
  const d=sz.shares*(px-ent), base=sz.shares*ent;
  const pc=base?d/base*100:null;
  return {text:moneyPct(d, pc), cls:cls(d)};
}
function potentialLine(t){
  const sz=sizeView(t), lv=(t.reasoning||{}).levels||{}, ent=trigPx(t);
  if(ent==null) return '';
  const t1=lv.t1, stop=lv.stop;
  const gPct=t1!=null?(t1/ent-1)*100:null;
  const rPct=stop!=null?(stop/ent-1)*100:null;
  const gain=sz&&sz.t1!=null?sz.t1:null;
  const risk=sz&&sz.risk!=null?sz.risk:null;
  const g=gain!=null?susd(gain,0):'';
  const r=risk!=null?susd(-Math.abs(risk),0):'';
  if(!g&&gPct==null) return '';
  return `Potential: ${g} (${gPct==null?'':pct(gPct)}) / risk ${r} (${rPct==null?'':pct(rPct)})`;
}
function icoLine(kind){
  const d={
    enter:'M12 19V5M6 11l6-6 6 6',
    profit:'M4 16l5-5 3 3 8-8M14 6h6v6',
    stop:'M12 3l8 4v6c0 5-3.5 7.5-8 9-4.5-1.5-8-4-8-9V7z',
    time:'M12 8v5l3 2M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16z'
  }[kind];
  return `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`;
}
function odo(text, cls){
  const bits=[...String(text||'')].map(ch=>`<span class="odig"><span>${esc(ch)===' '?'&nbsp;':esc(ch)}</span></span>`).join('');
  return `<span class="odo ${cls||''}">${bits}</span>`;
}
function fromWatch(w){
  const lv=w.levels||{}, o=w.order||{};
  return {id:'w-'+w.ticker, ticker:w.ticker, name:w.name, status:'PENDING', watch:true, wait:w.wait, book:'main', levels_label:w.levels_label,
    size_small:w.size_small, reasoning:{levels:lv},
    entry_order:{kind:o.kind, trigger:o.trigger||lv.entry, zone:o.zone},
    earnings:w.earnings_date?{date:w.earnings_date}:{}, time_stop_weeks:w.hold_weeks};
}
function feedCard(t, i){
  const lv=(t.reasoning||{}).levels||{};
  const open=t.status==='OPEN';
  const sz=sizeView(t);
  const sh=sz&&sz.shares!=null?n(sz.shares,4)+' shares at ':'';
  const ent=open?entryRef(t):trigPx(t);
  const when=t.opened_at||t.created_at;
  const enter=open ? `Bought ${sh}${usd(ent,2)} · ${dshort(when)}` : `Buy ${sh}${usd(ent,2)}`;
  let waitLine='';
  if(t.watch) waitLine=t.wait==='weak' ? 'Waiting · market too weak to buy' : `Waiting for ${usd(ent,2)}`;
  else if(!open){
    const aw=awayPair(t), until=(t.entry_order||{}).valid_until;
    if(aw) waitLine=`Waiting · ${susd(aw.d,2)} (${n(Math.abs(aw.pct),1)}%) away${until?' · until '+dshort(until):''}`;
  }
  const exit1=`Take half at ${usd(lv.t1,2)} · rest at ${usd(lv.t2,2)}`;
  const bye=t.time_stop?`or by ${dshort(t.time_stop)}`:(t.time_stop_weeks?`Within ${t.time_stop_weeks} weeks`:'');
  const exit2=`Sell all if it drops to ${usd(lv.stop,2)}`;
  const line=open?miniPnl(t):null;
  const profit=open
    ? (line?`<p class="tprofit" data-mini="${t.id}">${odo(line.text, line.cls)}</p>`:'')
    : `<p class="tprofit quiet">${esc(potentialLine(t))}</p>`;
  const steps=guideSteps(t).map(x=>`<li>${esc(x)}</li>`).join('');
  const on=state.feedOpen===t.id?' on':'';
  const tone=open?(line&&line.cls==='neg'?'neg':'pos'):'wait';
  return `<article class="tcard ${tone}" style="--i:${i||0}">
    <button type="button" class="hit" data-card="${t.id}">
      <b class="tk">${esc(t.ticker)}</b>
      <span class="co">${esc(t.name||'')}${t.levels_label?` · <span class="plan-i">${esc(planShort(t.levels_label))}</span>`:''}</span>
      <p class="trow">${icoLine('enter')}<span><em>Enter</em>${esc(enter)}</span></p>
      ${waitLine?`<p class="tstate">${esc(waitLine)}</p>`:''}
      <p class="trow">${icoLine('profit')}<span><em>Take profit</em>${esc(exit1)}</span></p>
      <p class="trow">${icoLine('stop')}<span><em>Safety exit</em>${esc(exit2)}</span></p>
      ${bye?`<p class="trow">${icoLine('time')}<span><em>Time</em>${esc(bye)}</span></p>`:''}
      ${profit}
    </button>
    <div class="steps${on}"><div class="steps-in">
      <ol class="guide">${steps}</ol>
      <button type="button" class="todo" data-copy="${t.id}"><svg class="ck" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 13l4 4L19 7"/></svg><span>Copy</span></button>
    </div></div>
  </article>`;
}
function missionHTML(){
  const m=D.mission||{};
  const goal=m.goal!=null?m.goal:100000;
  let prog=m.progress_pct!=null?+m.progress_pct:(m.progress!=null?+m.progress:0);
  if(prog>0&&prog<=1) prog*=100;
  prog=Math.max(0, Math.min(100, prog||0));
  const eqv=m.current_equity!=null?m.current_equity:m.equity;
  const eq=eqv!=null?usd(eqv,2):usd(m.start!=null?m.start:150,2);
  return `<button type="button" id="mission" class="mission"><b class="hero-eq num">${eq}</b><span class="goal">Goal ${usd(goal,0)}</span><span class="mbar" style="--p:${prog.toFixed(2)}%" aria-hidden="true"><i></i></span></button>`;
}
function streamSymbols(){
  const seen=new Set(), out=[];
  for(const tk of screenSymbols().concat((D&&D.price_symbols)||[])){ if(tk&&!seen.has(tk)){ seen.add(tk); out.push(tk); } }
  return out.slice(0,50);
}
function screenSymbols(){
  const seen=new Set(), out=[];
  const add=tk=>{ if(!tk||seen.has(tk)) return; seen.add(tk); out.push(tk); };
  (D.watch||[]).forEach(w=>add(w.ticker));
  (((D.v3||{}).daily_picks)||[]).slice(0,5).forEach(p=>add(p.ticker));
  T.filter(t=>onFeed(t)&&(t.status==='OPEN'||t.status==='PENDING')).forEach(t=>add(t.ticker));
  add('SPY');
  return out;
}
function nameOf(tk){
  const w=(D.watch||[]).find(x=>x.ticker===tk);
  if(w&&w.name) return w.name;
  const t=T.find(x=>x.ticker===tk&&x.name);
  if(t) return t.name;
  const pk=(((D.v3||{}).daily_picks)||[]).find(p=>p.ticker===tk&&p.name);
  if(pk) return pk.name;
  return tk==='SPY'?'S&P 500':'';
}
function folds(){ try{return JSON.parse(localStorage.getItem('sd.folds')||'{}')}catch(e){return {}} }
function foldOpen(id){ const f=folds(); if(Object.prototype.hasOwnProperty.call(f,id)) return !!f[id]; return id==='prices'||id==='chart'||id==='picks'; }
function panelIcon(kind){
  const d={
    prices:'M4 19V9M10 19V5M16 19v-7M22 19V8',
    chart:'M4 16l5-5 3 3 8-8M14 6h6v6',
    queue:'M8 7h12M8 12h12M8 17h8',
    history:'M12 8v5l3 2M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16z',
    picks:'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z',
    ripple:'M3 12h4l3-7 4 14 3-7h4'
  }[kind];
  return `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`;
}
function panel(id, kind, title, extra, body, i){
  const on=foldOpen(id);
  return `<section class="panel" style="--i:${i}"><button type="button" class="panel-h${on?' on':''}" data-fold="${id}">${panelIcon(kind)}<span class="pt">${esc(title)}</span>${extra||''}<svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg></button><div class="panel-body${on?' on':''}"><div class="panel-in">${body}</div></div></section>`;
}
function priceRows(){
  return screenSymbols().map(tk=>{
    const q=Prices.get(tk), mv=dayMove(tk);
    const px=q?usd(q.p,2):'—';
    const cap=mv.d==null?'':`<span class="cap num ${cls(mv.d)}" data-day="${esc(tk)}">${moneyPct(mv.d, mv.pct)}</span>`;
    return `<div class="quote"><div><b>${esc(tk)}</b><span class="nm">${esc(nameOf(tk))}</span></div><div class="qright"><span class="qpx num" data-odo="${esc(tk)}">${odo(px)}</span>${cap}</div><span class="spk">${spark(tk)}</span></div>`;
  }).join('');
}
function pricesPanel(i){
  const nav=UI.navState();
  const label=nav.c==='live'?'LIVE':nav.label;
  return panel('prices','prices','Prices',`<span class="panel-state ${nav.c}" id="px-state">${esc(label)}</span>`, priceRows(), i);
}
function flatAccount(){
  return `<div class="eq-flat"><svg class="eq" viewBox="0 0 640 168" role="img" aria-label="Account starts flat"><line x1="16" x2="624" y1="84" y2="84" stroke="var(--tint)" stroke-width="2.25" stroke-linecap="round"/><circle cx="624" cy="84" r="4.5" fill="var(--label)"/></svg><p class="chart-note">Starts Oct 9</p></div>`;
}
function missionArea(withSpy){
  const rows=(D.mission_curve||[]).map(h=>({t:h.t, eq:+h.eq, spy:h.spy==null?null:+h.spy}));
  if(rows.length<2) return flatAccount();
  const W=640,H=168,P=8, vals=rows.map(r=>r.eq);
  let lo=Math.min(...vals), hi=Math.max(...vals);
  if(hi===lo){hi+=1;lo-=1}
  const pad=(hi-lo)*0.12; lo-=pad; hi+=pad;
  const X=i=>P+(i/(rows.length-1))*(W-2*P);
  const Y=v=>P+(hi-v)/(hi-lo)*(H-2*P);
  const xy=rows.map((r,i)=>[X(i),Y(r.eq)]);
  const line=xy.map(p=>p.map(v=>v.toFixed(1)).join(',')).join('L');
  const area=`M${xy[0].map(v=>v.toFixed(1)).join(',')}L${line.slice(line.indexOf('L')+1)}L${xy[xy.length-1][0].toFixed(1)},${(H-P).toFixed(1)}L${xy[0][0].toFixed(1)},${(H-P).toFixed(1)}Z`;
  let spy='';
  if(withSpy){
    const both=rows.filter(r=>r.spy!=null);
    if(both.length>=2){
      const s0=both[0].spy, e0=both[0].eq;
      const pts=both.map((r,i)=>`${X(rows.indexOf(r)).toFixed(1)},${Y(e0*(r.spy/s0)).toFixed(1)}`).join('L');
      spy=`<path d="M${pts}" fill="none" stroke="var(--label3)" stroke-width="1.25" stroke-dasharray="4 3"/>`;
    }
  }
  const meta=rows.map((r,i)=>{ const prev=i?rows[i-1]:null; const d=prev?r.eq-prev.eq:0; const pc=prev&&prev.eq?d/prev.eq*100:0; return {t:r.t, eq:r.eq, d, pct:pc, x:X(i)}; });
  return `<div class="eq-scrub" data-pts="${esc(JSON.stringify(meta))}" data-w="${W}" data-h="${H}"><svg class="eq" viewBox="0 0 ${W} ${H}" role="img" aria-label="Account"><defs><linearGradient id="eqmain" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--tint)" stop-opacity=".28"/><stop offset="1" stop-color="var(--tint)" stop-opacity="0"/></linearGradient></defs><path d="${area}" fill="url(#eqmain)"/><path d="M${line}" fill="none" stroke="var(--tint)" stroke-width="2.25" stroke-linejoin="round"/>${spy}<circle class="eq-dot" r="4.5" fill="var(--label)" cx="${xy[xy.length-1][0]}" cy="${xy[xy.length-1][1]}"/></svg><div class="eq-tip" hidden></div></div>`;
}
function chartSymbols(){
  const seen=new Set(), out=[];
  const add=tk=>{ if(!tk||seen.has(tk)||tk==='SPY') return; seen.add(tk); out.push(tk); };
  (D.watch||[]).forEach(w=>add(w.ticker));
  T.filter(t=>onFeed(t)&&(t.status==='OPEN'||t.status==='PENDING')).forEach(t=>add(t.ticker));
  (((D.v3||{}).daily_picks)||[]).slice(0,5).forEach(p=>add(p.ticker));
  return out;
}
function chartInner(){
  const which=state.chart||'account';
  if(which==='account') return missionArea(!!state.spy);
  const wl=(D.watch||[]).find(t=>t.ticker===which);
  const pk=(((D.v3||{}).daily_picks)||[]).find(p=>p.ticker===which);
  const w=(wl&&fromWatch(wl)) || T.find(t=>t.ticker===which&&onFeed(t)) || (pk&&fromPick(pk));
  if(!w||!(TECH[which]||{}).candles) return '<p class="chart-note">No daily bars yet</p>';
  const lbl=wl?planShort(wl.levels_label,'v2.2'):(pk&&!T.find(t=>t.ticker===which&&onFeed(t)))?planShort(pk.levels_label,'v3'):'Main plan';
  const more=levelSets(which).length>1?' · other plans in the sheet':'';
  return `<p class="plan chart-plan">${esc(lbl+more)}</p>`+candleChart(w, true);
}
function chartPanel(i){
  const which=state.chart||'account';
  const chips=['account',...chartSymbols()].map(k=>`<button type="button" data-chart="${esc(k)}" class="${which===k?'on':''}">${k==='account'?'Account':esc(k)}</button>`).join('');
  const spy=which==='account'?`<button type="button" class="spy-tog${state.spy?' on':''}" data-spy>S&P</button>`:'';
  return panel('chart','chart','Chart', '', `<div class="switch">${chips}${spy}</div><div id="chart-body">${chartInner()}</div>`, i);
}
function upcomingPanel(i){
  const rows=T.filter(t=>onFeed(t)&&t.status==='PENDING');
  const body=rows.length?rows.map(t=>{
    const ent=trigPx(t), aw=awayPair(t), until=(t.entry_order||{}).valid_until;
    const away=aw?`${susd(aw.d,2)} · ${n(Math.abs(aw.pct),1)}% away`:'';
    return `<div class="qrow"><b>${esc(t.ticker)}</b><span>Buy at ${usd(ent,2)}</span><span class="nm">${until?'until '+esc(dshort(until)):''}</span><span class="num">${esc(away)}</span></div>`;
  }).join(''):`<div class="empty-row"><span class="empty-mark sm" aria-hidden="true"></span><p>Nothing queued · next scan 8:46 AM</p></div>`;
  return panel('upcoming','queue','Upcoming','',body,i);
}
function historyPanel(i){
  const rows=T.filter(t=>onFeed(t)&&t.status==='CLOSED');
  const wins=rows.filter(t=>shownPnl(t)>0).length;
  const chip=rows.length?`<span class="chip">${Math.round(wins/rows.length*100)}% · ${rows.length}</span>`:`<span class="chip">No closed trades yet</span>`;
  const body=rows.length?rows.map(t=>{
    const d=shownPnl(t), pair=pnlPair(t);
    const why=(t.postmortem&&(t.postmortem.why||t.postmortem.one_liner))||'';
    const buy=entryRef(t), sell=(t.exit||{}).spot;
    return `<div class="hrow ${cls(d)}"><div><b>${esc(t.ticker)}</b><span class="nm">${esc(dshort(t.opened_at||t.created_at))}${t.closed_at?' – '+esc(dshort(t.closed_at)):''}</span></div><span class="num">${usd(buy,2)} → ${sell==null?'—':usd(sell,2)}</span><span class="cap num ${cls(d)}">${d==null?'':moneyPct(d, pair.pct)}</span>${why?`<p class="why">${esc(why)}</p>`:''}</div>`;
  }).join(''):`<div class="empty-row"><span class="empty-mark sm" aria-hidden="true"></span><p>No closed trades yet</p></div>`;
  return panel('history','history','History',chip,body,i);
}
function paintChart(){
  const box=$('#chart-body'); if(!box) return;
  const which=state.chart||'account';
  $$('[data-chart]').forEach(b=>b.classList.toggle('on', b.dataset.chart===which));
  const tog=document.querySelector('[data-spy]'); if(tog){ tog.hidden=which!=='account'; tog.classList.toggle('on', !!state.spy); }
  box.innerHTML=chartInner();
  bindChart(box);
}
function feedView(){
  const rows=T.filter(onFeed);
  const open=rows.filter(t=>t.status==='OPEN').sort((a,b)=>actionDist(a)-actionDist(b));
  const pend=rows.filter(t=>t.status==='PENDING').sort((a,b)=>{
    const da=awayPair(a), db=awayPair(b);
    return Math.abs((da&&da.pct)||99)-Math.abs((db&&db.pct)||99);
  });
  const watch=(D.watch||[]).map(fromWatch);
  const mine=+localStorage.getItem('sd.acct.size')||150;
  let i=0;
  const cards=open.map(t=>feedCard(t, i++)).join('')+pend.map(t=>feedCard(t, i++)).join('');
  const next=watch.length?`<p class="nextlab">Next up</p>`+watch.map(t=>feedCard(t, i++)).join(''):'';
  const any=rows.length||watch.length;
  const top=any
    ? cards+next+`<p class="for150">For ${usd(mine,0)}</p>`
    : `<div class="empty-hero"><span class="empty-mark" aria-hidden="true"></span><p>No trade yet</p><p>Next scan 8:46 AM</p></div>`;
  const panels=scoreboardHTML()+picksPanel(i)+pricesPanel(i+1)+chartPanel(i+2)+upcomingPanel(i+3)+historyPanel(i+4)+ripplePanel(i+5);
  return `<section data-screen="feed">${missionHTML()}${top}${panels}</section>`;
}
function screen(){ return feedView(); }
const TITLES={home:'Home',positions:'Positions',activity:'Activity',insights:'Insights',settings:'Settings'};

/* Engine v3.0 surfaces: regime chip, scoreboard, today's picks, ripple effects, Aira panel.
   Reads D.v3, D.books and trades only. Renders nothing when the v3 block is absent. */
const V3 = () => (D && D.v3) || {};
const STRAT = {pullback:'Pullback', momentum:'Momentum', breakout:'Breakout', gap_hold:'Gap hold', gap_go:'Gap and go', mean_rev:'Bounce', nr7:'Tight range'};
function stratTag(p){ return STRAT[p.strategy] || (p.strategy_label||'').split(' ')[0] || 'Setup'; }
function regimeWord(){
  const r = V3().regime || ((D && D.scan) || {}).regime || {};
  const s = r.state;
  if(s==='risk-off') return {w:'weak', c:'neg'};
  if(s==='caution') return {w:'mixed', c:'mid'};
  if(s==='risk-on') return {w:'strong', c:'pos'};
  return null;
}
function paintRegime(){
  const el = $('#regime'); if(!el) return;
  const r = regimeWord();
  el.hidden = !r;
  if(r){ el.textContent = 'Market: ' + r.w; el.className = 'regime-chip ' + r.c; }
}
function bookOf(key){ return ((D && D.books) || {})[key] || null; }
function scoreboardHTML(){
  const cols = [['main','System'],['aira','Aira'],['practice_v3','New engine']].map(([k,label])=>[k,label,bookOf(k)]).filter(x=>x[2]);
  if(cols.length<2) return '';
  const cells = cols.map(([k,label,b])=>{
    const eq = +b.equity, start = +b.start || 150, d = eq-start, pc = start ? d/start*100 : 0;
    const n0 = +b.closed || 0;
    const wr = b.win_rate==null ? '—' : Math.round(b.win_rate*(b.win_rate<=1?100:1))+'%';
    return `<div class="sb-c"><span class="sb-l">${esc(label)}</span><b class="num">${usd(eq,2)}</b><span class="num sb-d ${cls(d)}">${moneyPct(d, pc)}</span><span class="sb-w">${n0?'Win '+wr+' · '+n0:'No trades'}</span></div>`;
  }).join('');
  return `<div class="scoreboard" style="--i:0">${cells}</div>`;
}
function v3TradeFor(tk){ return T.find(t=>t.ticker===tk && (t.book==='practice_v3' || t.engine==='v3') && (t.status==='OPEN'||t.status==='PENDING')); }
const WHY_SHORT = [
  [/quota/i,'strategy slots full'], [/OOS|forward-watch/i,'forward-watch only'], [/circuit|loss limit/i,'loss limit hit'],
  [/already/i,'already working'], [/max positions/i,'positions are full'], [/settled cash/i,'no settled cash'],
  [/earnings/i,'earnings too close'], [/avoid/i,'on avoid list']
];
function pickState(p){
  const t = v3TradeFor(p.ticker);
  if(t && t.status==='OPEN') return {txt:'Entered', c:'in'};
  if(t) return {txt:'Waiting · order is placed', c:'wait'};
  const why = (p.not_entered_because||[])[0];
  if(why){ const m = WHY_SHORT.find(([re])=>re.test(why)); return {txt:'Waiting · '+(m?m[1]:why.split(/\s+/).slice(0,3).join(' ')), c:'wait'}; }
  return {txt:'Waiting · not booked yet', c:'wait'};
}
function lvCell(label, v, base){
  const pc = (v!=null && base) ? (v/base-1)*100 : null;
  return `<span class="pk-v"><em>${label}</em><b class="num">${usd(v,2)}</b>${pc==null?'':`<i class="num ${cls(pc)}">${pc>0?'+':''}${n(pc,1)}%</i>`}</span>`;
}
function picksPanel(i){
  const ps = (V3().daily_picks||[]).slice(0,5);
  if(!ps.length) return '';
  const rows = ps.map(p=>{
    const st = pickState(p);
    return `<button type="button" class="pick" data-v3pick="${esc(p.ticker)}"><span class="pk-top"><b>${esc(p.ticker)}</b><span class="tag">${esc(stratTag(p))}</span><span class="state ${st.c}">${esc(st.txt)}</span></span><span class="plan">${esc(planShort(p.levels_label,'v3'))}${levelSets(p.ticker).length>1?' · differs from Main plan':''}</span><span class="pk-lv">${lvCell('Entry',p.entry,null)}${lvCell('Target 1',p.t1,p.entry)}${lvCell('Target 2',p.t2,p.entry)}</span></button>`;
  }).join('');
  return panel('picks','picks',"Today's picks",`<span class="chip">${ps.length}</span>`,rows,i);
}
function rippleChain(idea){
  const steps = (idea.chain||[]).map(s=>typeof s==='string'?s:(s.label||s.step||s.name||'')).filter(Boolean);
  return steps.map((s,k)=>`${k?'<span class="arr" aria-hidden="true">→</span>':''}<span class="step">${esc(s)}</span>`).join('');
}
function ripplePanel(i){
  const all = ((V3().cascade)||{}).ideas||[];
  const ideas = all.filter(x=>x.status==='qualified').concat(all.filter(x=>x.status==='news_unconfirmed').slice(0,4));
  if(!ideas.length) return '';
  const live = ideas.filter(x=>x.status==='qualified').length;
  const rows = ideas.map(x=>{
    const watch = x.status!=='qualified';
    const longs = (x.long||[]).slice(0,4).join(' '), avoid = (x.avoid||[]).slice(0,4).join(' ');
    const tags = (longs?`<span class="rt bull">${watch?'Watch':'Bull'} <b>${esc(longs)}</b></span>`:'') + (avoid?`<span class="rt avoid">Avoid <b>${esc(avoid)}</b></span>`:'');
    return `<div class="ripple${watch?' dim':''}"><div class="chain">${rippleChain(x)}</div><div class="rtags">${tags}</div></div>`;
  }).join('');
  return panel('ripple','ripple','Ripple effects',`<span class="chip">${live} live</span>`,rows,i);
}
const SEATS = [['macroeconomist','Macro'],['industry_analyst','Industry'],['investment_banker','Banker'],['wall_street_pm','Pro'],['retail_trader','Retail'],['public_consumer','Public']];
function panelHTML(pn){
  if(!pn || !pn.seats) return '';
  const dots = SEATS.map(([k,l])=>{
    const s = pn.seats[k] || {};
    const st = s.stance==='bull'?'bull':s.stance==='bear'?'bear':'neutral';
    return `<button type="button" class="seat ${st}" data-seat="${esc(l)}" data-line="${esc(s.line||'')}" aria-label="${esc(l)}: ${st}"><i></i><span>${esc(l)}</span></button>`;
  }).join('');
  const bl = pn.blended || {};
  const v = pn.verdict || bl.verdict || 'neutral';
  const sc = bl.score==null ? '' : ` ${bl.score>0?'+':''}${n(bl.score,2)}`;
  const ov = pn.override_reason ? `<p class="seat-line">Override: ${esc(pn.override_reason)}</p>` : '';
  return `<div class="panelx"><p class="eyebrow">Panel</p><div class="seats">${dots}<span class="verdict ${v==='bull'?'bull':v==='bear'?'bear':'neutral'}">${esc(v[0].toUpperCase()+v.slice(1))}${esc(sc)}</span></div><p class="seat-line" id="seat-line">Tap a dot to read that view.</p>${ov}</div>`;
}
function airaPanelFor(tk){ const t = T.find(x=>x.ticker===tk && x.book==='aira' && x.panel); return t ? t.panel : null; }
function pickSheet(tk){
  const daily = V3().daily_picks||[];
  const p = daily.concat(V3().candidates||[]).find(x=>x.ticker===tk);
  if(!p) return;
  const pos = daily.indexOf(p)+1;
  const st = pickState(p), sz = p.size || {};
  const pc = v => (v!=null && p.entry) ? ` <span class="num ${cls(v-p.entry)}">${(v>p.entry?'+':'')}${n((v/p.entry-1)*100,1)}%</span>` : '';
  const kind = ((p.order||{}).kind==='buy_stop'?'Buy if it rises to':(p.order||{}).kind==='moo'?'Buy at the open near':'Buy at or below');
  const row = (l,v,extra)=>`<div class="inset-row"><span>${l}</span><b class="num">${v}${extra||''}</b></div>`;
  const why = (p.not_entered_because||[]).length ? `<p class="fine">Not entered: ${esc((p.not_entered_because||[]).join('; '))}</p>` : '';
  const facts = (p.facts||[]).slice(0,3).map(f=>`<li>${esc(typeof f==='string'?f:(f.text||''))}</li>`).join('');
  Sheet.open(`<div class="sheet-h"><button class="x" data-close>Close</button><div class="grab"></div></div><div class="sheet-body"><p class="eyebrow">${pos?"Today's pick #"+pos:'Candidate'} · New engine</p><h2 class="sheet-title">${esc(p.ticker)}</h2><p class="co">${esc(p.name||'')} · ${esc(p.strategy_label||stratTag(p))}</p><p class="pk-state"><span class="state ${st.c}">${esc(st.txt)}</span></p>${levelSetsHTML(p.ticker)}${levelSets(p.ticker).length>1?`<p class="eyebrow plan-h">${esc(planShort(p.levels_label,'v3'))} · order and size</p>`:`<p class="eyebrow plan-h">${esc(planShort(p.levels_label,'v3'))}</p>`}<div class="inset">${row(esc(kind), usd(p.entry,2))}${levelSets(p.ticker).length>1?'':row('Target 1', usd(p.t1,2), pc(p.t1))+row('Target 2', usd(p.t2,2), pc(p.t2))+row('Safety exit', usd(p.stop,2), pc(p.stop))}${p.max_hold?row('Sell by', p.max_hold+' trading days'):''}${sz.shares!=null?row('For $'+n(sz.equity||150,0), n(sz.shares,4)+' sh · '+usd(sz.dollars,0)):''}${sz.risk_usd!=null?row('Risk', usd(sz.risk_usd,2)):''}</div>${panelHTML(airaPanelFor(p.ticker))}<div class="prose"><p>${esc(p.reason||'')}</p>${facts?`<ul>${facts}</ul>`:''}</div>${why}</div>`);
}

/* Plan labels: the same ticker can carry levels from more than one engine. Always say whose plan a level set is. */
function planShort(lbl, engine){
  const l=String(lbl||'');
  if(/^main/i.test(l)||engine==='v2.2') return 'Main plan';
  if(/new engine|v3/i.test(l)||engine==='v3') return 'New engine plan';
  if(/aira/i.test(l)) return 'Aira plan';
  return l ? l.split(/[\s(·]+/).slice(0,2).join(' ')+' plan' : '';
}
function levelSets(tk){ return ((D && D.levels_by_ticker)||{})[tk] || []; }
function fromPick(p){
  return {id:'p-'+p.ticker, ticker:p.ticker, name:p.name, status:'PENDING', pick:true, book:'practice_v3', levels_label:p.levels_label,
    size_small:p.size?{equity:p.size.equity, shares:p.size.shares, dollars:p.size.dollars, risk_usd:p.size.risk_usd}:null,
    reasoning:{levels:{entry:p.entry, stop:p.stop, t1:p.t1, t2:p.t2}}, entry_order:{kind:(p.order||{}).kind, trigger:p.entry}};
}
function levelSetsHTML(tk){
  const sets=levelSets(tk);
  if(sets.length<2) return '';
  const pc=(v,e)=>(v!=null&&e)?` <span class="num ${cls(v-e)}">${v>e?'+':''}${n((v/e-1)*100,1)}%</span>`:'';
  const row=(l,v,e)=>`<div class="inset-row"><span>${l}</span><b class="num">${usd(v,2)}${e==null?'':pc(v,e)}</b></div>`;
  return sets.map(x=>`<p class="eyebrow plan-h">${esc(planShort(x.label,x.engine))}</p><div class="inset plan-set">${row('Entry',x.entry,null)}${row('Target 1',x.t1,x.entry)}${row('Target 2',x.t2,x.entry)}${row('Safety exit',x.stop,x.entry)}</div>`).join('');
}

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
    const s=new Set(typeof streamSymbols==='function'?streamSymbols():['SPY']);
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
    if(mt) mt.textContent=nav.label;
  },
  applyLive(){
    if(!D)return;
    this.strip();
    $$('[data-px]').forEach(el=>{ const q=Prices.get(el.dataset.px); if(q){ el.textContent=n(q.p); el.dataset.src=q.src } });
    $$('[data-odo]').forEach(el=>{ const q=Prices.get(el.dataset.odo); if(!q) return; const text=usd(q.p,2); if(el.dataset.v===text) return; el.dataset.v=text; el.innerHTML=odo(text); });
    const ps=$('#px-state'); if(ps){ const n=this.navState(); ps.textContent=n.c==='live'?'LIVE':n.label; ps.className='panel-state '+(n.c||''); }
    $$('[data-pl]').forEach(el=>{ const t=T.find(x=>x.id===el.dataset.pl); if(!t)return; const pair=pnlPair(t);
      if(pair.d==null){el.textContent='';return} el.textContent=pair.pct==null?susd(pair.d,2):moneyPct(pair.d, pair.pct);
      el.classList.remove('pos','neg','mute'); el.classList.add(cls(pair.d)); });
    $$('[data-day]').forEach(el=>{ const mv=dayMove(el.dataset.day); if(mv.d==null||mv.pct==null)return; el.textContent=moneyPct(mv.d, mv.pct); el.classList.remove('pos','neg','mute'); el.classList.add(cls(mv.d)) });
    $$('[data-dist]').forEach(el=>{ const parts=el.dataset.dist.split('|'); const t=T.find(x=>x.id===parts[0]); if(!t)return; const phrase=distPhrase(t, parts[2]||'', +parts[1]); if(!phrase)return; el.textContent=phrase; const pair=distPair(t,+parts[1]); const signed=parts[2]==='Entry'?-pair.d:pair.d; el.classList.remove('pos','neg','mute'); el.classList.add(cls(signed)) });
    $$('[data-away]').forEach(el=>{ const t=T.find(x=>x.id===el.dataset.away); if(!t)return; const aw=awayPair(t); if(!aw)return; el.textContent=moneyPct(aw.d, aw.pct)+' away'; el.classList.remove('pos','neg','mute'); el.classList.add(cls(aw.d)) });
    $$('[data-wait]').forEach(el=>{ const t=T.find(x=>x.id===el.dataset.wait); if(!t)return; const aw=awayPair(t); if(!aw)return; const until=(t.entry_order||{}).valid_until; el.textContent='Waiting · '+susd(aw.d,2)+' ('+n(Math.abs(aw.pct),1)+'%) away'+(until?' · until '+dshort(until):''); });
    $$('[data-mini]').forEach(el=>{ const t=T.find(x=>x.id===el.dataset.mini); if(!t||t.status!=='OPEN')return; const line=miniPnl(t); if(!line||el.dataset.v===line.text)return; el.dataset.v=line.text; el.innerHTML=odo(line.text,line.cls); });
    const bn=$('#bell-n'); if(bn){ const n=T.filter(t=>rowAlert(t)).length; bn.hidden=!n; bn.textContent=String(n); }
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
      const prev=i?tc.candles.slice(-nC)[i-1][4]:c[1]; const dlt=c[4]-prev, pc=prev?dlt/prev*100:0;
      tip.textContent=`${dshort(c[0])}  ${usd(c[4],2)}  ${moneyPct(dlt, pc)}`;
    };
    w.addEventListener('pointermove',move); w.addEventListener('pointerdown',move);
    w.addEventListener('pointerleave',()=>{xh.style.opacity=yh.style.opacity=0;tip.hidden=true});
  });
}
const Sheet={
  fromPop:false,
  place(s, y){
    const desk=matchMedia('(min-width:900px)').matches;
    s.style.transform=desk?`translate3d(-50%,${y}px,0)`:`translate3d(0,${y}px,0)`;
  },
  open(html){
    const s=$('#sheet'), sc=$('#scrim');
    s.innerHTML=html; s.hidden=false; sc.hidden=false; sc.style.opacity='';
    document.body.classList.add('sheet-open');
    s.style.transition='none'; this.place(s, 40);
    UI.haptic(12); bindChart(s); this.wire(s);
    if(!STATIC){ s.style.willChange='transform'; requestAnimationFrame(()=>{ s.style.transition=''; s.classList.add('on'); this.place(s, 0); const done=()=>{ s.style.willChange=''; s.removeEventListener('transitionend', done); }; s.addEventListener('transitionend', done); }); }
    else { s.classList.add('on'); this.place(s, 0); }
    if(!history.state||!history.state.sdSheet) history.pushState({sdSheet:1}, '');
  },
  wire(s){
    const body=s.querySelector('.sheet-body');
    const head=s.querySelector('.sheet-h');
    const sc=$('#scrim');
    let active=false, y0=0, dy=0, lastY=0, lastT=0, fromBody=false;
    const height=()=>s.getBoundingClientRect().height||640;
    const apply=y=>{
      let yy=y;
      if(yy<0) yy=yy*0.35;
      s.style.transition='none';
      this.place(s, Math.max(-80, yy));
      if(sc) sc.style.opacity=String(Math.max(0.15, 1-Math.max(0,yy)/height()));
    };
    const finish=()=>{
      if(!active) return;
      active=false; s.style.willChange='';
      const dt=Math.max(1, lastT-(lastT-dy&&0));
      const vy=(lastY-y0)/Math.max(16, performance.now()- (lastT- (lastY===y0?0:1)*0) || 1);
      const speed=(lastY-y0)/Math.max(1, performance.now()-startT);
      s.style.transition='';
      if(dy>height()*0.25 || speed>0.5) this.close();
      else { this.place(s, 0); if(sc) sc.style.opacity=''; s.classList.add('on'); }
      dy=0;
    };
    let startT=0;
    const down=(y, bodyDrag)=>{
      if(bodyDrag && body && body.scrollTop>0) return;
      active=true; fromBody=!!bodyDrag; y0=lastY=y; dy=0; startT=lastT=performance.now();
      s.style.willChange='transform';
    };
    const move=(y, e)=>{
      if(!active) return;
      dy=y-y0; lastY=y; lastT=performance.now();
      if(fromBody && body && body.scrollTop>0 && dy>0){ active=false; s.style.willChange=''; return; }
      if(e.cancelable) e.preventDefault();
      apply(dy);
    };
    const up=()=>{
      if(!active) return;
      const speed=(lastY-y0)/Math.max(1, performance.now()-startT);
      active=false; s.style.willChange=''; s.style.transition='';
      if(dy>height()*0.25 || speed>0.5) this.close();
      else { this.place(s, 0); if(sc){ sc.style.opacity=''; } }
      dy=0;
    };
    if(head){
      head.addEventListener('touchstart', e=>{ down(e.touches[0].clientY, false); }, {passive:true});
      head.addEventListener('touchmove', e=>{ move(e.touches[0].clientY, e); }, {passive:false});
      head.addEventListener('touchend', up);
      head.addEventListener('touchcancel', up);
    }
    if(body){
      body.addEventListener('touchstart', e=>{ down(e.touches[0].clientY, true); }, {passive:true});
      body.addEventListener('touchmove', e=>{
        if(!active) return;
        const y=e.touches[0].clientY;
        if(body.scrollTop>0){ active=false; s.style.willChange=''; return; }
        if(y-y0>0 || y-y0<0) move(y, e);
      }, {passive:false});
      body.addEventListener('touchend', up);
      body.addEventListener('touchcancel', up);
    }
  },
  close(fromPop){
    const s=$('#sheet'), sc=$('#scrim');
    s.classList.remove('on','set'); s.style.transition='';
    const desk=matchMedia('(min-width:900px)').matches;
    s.style.transform=desk?'translate3d(-50%,110%,0)':'translate3d(0,110%,0)';
    if(sc) sc.style.opacity='0';
    document.body.classList.remove('sheet-open');
    setTimeout(()=>{ s.hidden=true; if(sc){ sc.hidden=true; sc.style.opacity=''; } s.style.transform=''; }, 320);
    if(!fromPop && history.state && history.state.sdSheet){ this.fromPop=true; history.back(); }
  },
  trade(id){ const t=T.find(x=>x.id===id); if(!t)return; this.open(detailHTML(t)) },
  alerts(){
    const live=T.filter(t=>rowAlert(t)).map(t=>({t:'', tk:t.ticker, text:rowAlert(t), book:t.book}));
    const hist=(D.alerts||[]).map(a=>({t:a.t, tk:a.ticker||'', text:(a.type||'').replace('_',' ')+(a.text?': '+a.text:''), book:a.book}));
    const rows=live.concat(hist);
    const html=`<div class="sheet-h"><button class="x" data-close>Close</button><div class="grab"></div></div><div class="sheet-body"><h2 class="sheet-title">Alerts</h2><div class="inset">${rows.map(r=>`<div class="inset-row"><span><b>${esc(r.tk)} ${esc(r.text)}</b><span class="sub2">${r.t?dshort(r.t)+' ET':''}${r.book?' · '+esc(BOOKN[r.book]||r.book):''}</span></span></div>`).join('')||'<div class="empty">Nothing near a level.</div>'}</div></div>`;
    this.open(html);
  }
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

state.tab=qs.get('tab')||'home'; state.ins='perf'; state.act='fills'; state.emph=localStorage.getItem('sd.emph')||'usd'; state.range=localStorage.getItem('sd.range')||'ALL'; state.chart=localStorage.getItem('sd.chart')||'account'; state.spy=localStorage.getItem('sd.spy')==='1';
const scrollMem={};
const tabPanels=new Map();
let tabGen=0;
function bustTabs(){ tabGen++; tabPanels.clear(); }
window.__bustTabs=bustTabs;

function tradeById(id){ return T.find(x=>x.id===id) || (D.watch||[]).map(fromWatch).find(x=>x.id===id); }
function openGear(){
  const th=localStorage.getItem('sd.theme')||'system';
  const themes=[['system','System'],['light','Light'],['dark','Dark']].map(([k,l])=>`<button type="button" class="setrow ${th===k?'on':''}" data-theme-set="${k}">${l}</button>`).join('');
  Sheet.open(`<div class="sheet-h"><button class="x" data-close>Close</button><div class="grab"></div></div><div class="sheet-body"><h2 class="sheet-title">Settings</h2><div class="setgroup"><label class="setrow" for="acct-size">Account size<input id="acct-size" inputmode="decimal" value="${esc(localStorage.getItem('sd.acct.size')||'150')}"></label>${themes}<label class="setrow" for="key-in">Price key<input id="key-in" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Finnhub key"></label><div class="setrow">Key <span><button type="button" id="key-show" class="go">Show</button><button type="button" id="key-test-btn" class="go">Test</button></span></div><button type="button" class="setrow" id="sw-check">Check for update</button><button type="button" id="key-remove" class="setrow danger-row">Remove key</button></div><button type="button" id="key-save" class="save">Save</button><p id="key-test" class="fine" role="status"></p><p id="key-state" class="fine"></p></div>`);
  const sh=$('#sheet'); if(sh) sh.classList.add('set');
  wireSettings();
}
let gearTimer=0, gearHeld=false, gearTaps=[];
function paintAcct(){
  const tab=state.tab||'home';
  const el=$('#acct-switch'), line=$('#bookline'), book=$('#title-book');
  const show=tab==='home'||tab==='positions'||tab==='insights';
  if(el){
    el.hidden=!show;
    if(show){
      const opts=tab==='positions'?[['main','Main'],['shadow','Practice'],['mambo','Mine'],['all','All']]:[['main','Main'],['shadow','Practice'],['mambo','Mine']];
      const cur=tab==='positions'?(state.recs||'main'):(state.acct||'main');
      el.innerHTML=opts.map(([k,l])=>`<button type="button" data-book="${k}" class="${cur===k?'on':''}" role="tab">${l}</button>`).join('');
    }
  }
  const key=tab==='positions'?(state.recs||'main'):(state.acct||'main');
  if(line){ line.hidden=!show||!BOOKLINE[key]; line.textContent=BOOKLINE[key]||''; }
  if(book) book.textContent=BOOKN[key]||'';
  const tk=$('#ticker'); if(tk) tk.hidden=tab!=='positions';
}
function render(bust){
  const tab=state.tab||'home';
  document.body.dataset.tab=tab;
  if(bust){ const old=tabPanels.get(tab); if(old) old.remove(); tabPanels.delete(tab); }
  let node=tabPanels.get(tab);
  if(!node || node.dataset.gen!==String(tabGen)){
    node=document.createElement('div');
    node.className='tabpanel';
    node.dataset.gen=String(tabGen);
    node.innerHTML=screen();
    tabPanels.set(tab, node);
    bindChart(node);
  }
  const app=$('#app');
  if(app.firstElementChild!==node) app.replaceChildren(node);
  const name=TITLES[tab]||'Home';
  const title=$('#title'); if(title) title.textContent=name;
  $$('#tabs [data-tab]').forEach(b=>b.classList.toggle('on', b.dataset.tab===tab && !b.classList.contains('feed')));
  paintAcct();
  paintRegime();
  paintKeyState();
  UI.applyLive();
  if(tab==='settings') wireSettings();
}
function gotoTab(tab){
  if(!TITLES[tab]) return;
  if(tab===state.tab){ scrollTo({top:0, behavior: STATIC?'auto':'smooth'}); return }
  scrollMem[state.tab]=scrollY; state.tab=tab; render(false); scrollTo(0, scrollMem[tab]||0); UI.haptic(8);
  if(!STATIC){ const app=$('#app'); app.style.willChange='transform, opacity';
    const anim=app.animate([{opacity:0,transform:'translate3d(0,8px,0)'},{opacity:1,transform:'translate3d(0,0,0)'}],{duration:220,easing:'cubic-bezier(.2,.8,.2,1)'});
    anim.finished.then(()=>{ app.style.willChange='auto'; }).catch(()=>{}); }
}
function wireSettings(){
  const inp=$('#key-in'); if(!inp||inp.dataset.wired) return; inp.dataset.wired='1';
  $('#key-show').onclick=()=>{ inp.type = inp.type==='password'?'text':'password'; $('#key-show').textContent=inp.type==='password'?'Show':'Hide' };
  $('#key-test-btn').onclick=async()=>{ const k=inp.value.trim(); const o=$('#key-test'); if(!k){o.textContent='Paste a key first.';return} o.textContent='Testing…'; const r=await Live.test(k); o.textContent=r.ok?'Connected. SPY '+n(r.px)+'.':' '+r.err };
  $('#key-save').onclick=async()=>{ const k=inp.value.trim(); const o=$('#key-test'); if(!k){o.textContent='Paste a key first.';return} o.textContent='Testing…'; const r=await Live.test(k); if(!r.ok){o.textContent=r.err+' Not saved.';return} Live.setKey(k); inp.value=''; await Live.start(); paintKeyState(); UI.applyLive(); o.textContent='Saved on this device. SPY '+n(r.px)+'.' };
  $('#key-remove').onclick=()=>{ Live.setKey(''); Live.stop(true); Live.state='nokey'; Live.err=''; Prices.seed(D); paintKeyState(); UI.applyLive(); $('#key-test').textContent='Key removed from this device.' };
  const sw=$('#sw-check'); if(sw) sw.onclick=()=>{ SW.check(); UI.toast('Checking for an update') };
  const az=$('#acct-size'); if(az) az.onchange=()=>{ const v=Math.max(1, +az.value||150); localStorage.setItem('sd.acct.size', String(v)); az.value=String(v); bustTabs(); render(true); };
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
    if(changed){ setData(d); News.set(d.news||[]); Live.seed(); render(); if(!first) UI.toast('Ledger updated '+String(d.as_of||d.generated_at).slice(11,16)+' ET'); if(first&&Live.key()) Live.start(); else Live.resubscribe() }
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
  if(e.target.closest('#mission')){
    if(gearHeld){ gearHeld=false; return }
    const now=Date.now(); gearTaps=gearTaps.filter(t=>now-t<1800); gearTaps.push(now);
    if(gearTaps.length>=5){ gearTaps=[]; openGear(); }
    return;
  }
  const vp=e.target.closest('[data-v3pick]'); if(vp){ pickSheet(vp.dataset.v3pick); return }
  const seat=e.target.closest('[data-seat]'); if(seat){ const ln=$('#seat-line'); $$('.seat').forEach(x=>x.classList.toggle('on', x===seat)); if(ln) ln.textContent=seat.dataset.seat+': '+(seat.dataset.line||'No note.'); return }
  const fold=e.target.closest('[data-fold]');
  if(fold){
    const body=fold.parentElement.querySelector('.panel-body');
    if(body){ body.classList.toggle('on'); const open=body.classList.contains('on'); fold.classList.toggle('on', open); const f=folds(); f[fold.dataset.fold]=open; localStorage.setItem('sd.folds', JSON.stringify(f)); }
    return;
  }
  const ch=e.target.closest('[data-chart]');
  if(ch){ state.chart=ch.dataset.chart; localStorage.setItem('sd.chart', state.chart); paintChart(); return }
  if(e.target.closest('[data-spy]')){ state.spy=!state.spy; localStorage.setItem('sd.spy', state.spy?'1':'0'); paintChart(); return }
  const cp=e.target.closest('[data-copy]'); if(cp){ const t=tradeById(cp.dataset.copy); if(!t) return; const text=guideText(t); const done=()=>{ cp.classList.add('done'); const s=cp.querySelector('span'); if(s) s.textContent='Copied'; }; if(navigator.clipboard) navigator.clipboard.writeText(text).then(done).catch(done); else done(); return }
  const card=e.target.closest('[data-card]'); if(card){ const box=card.closest('.tcard').querySelector('.steps'); if(box){ box.classList.toggle('on'); state.feedOpen=box.classList.contains('on')?card.dataset.card:null; } return }
  if(e.target.closest('#feed-dismiss')){ localStorage.setItem('sd.feed.dismissed','1'); UI.applyLive(); return }
  const cap=e.target.closest('[data-cap]'); if(cap){ state.emph=state.emph==='pct'?'usd':'pct'; localStorage.setItem('sd.emph', state.emph); render(true); return }
  const rg=e.target.closest('[data-range]'); if(rg){ state.range=rg.dataset.range; localStorage.setItem('sd.range', state.range); render(true); return }
  if(e.target.closest('#bell')){ Sheet.alerts(); return }
  const pk=e.target.closest('[data-pick]'); if(pk){ const c=((D.scan||{}).candidates||[]).find(x=>x.ticker===pk.dataset.pick); if(!c) return;
    const sz=sizeView(c);
    Sheet.open(`<div class="sheet-h"><button class="x" data-close>Close</button><div class="grab"></div></div><div class="sheet-body"><p class="eyebrow">Watchlist · not an order</p><h2 class="sheet-title">${esc(c.ticker)}</h2><p class="co">${esc(c.name||'')} · ${esc(SETUPN[c.setup]||'')}</p>${sz?sz.line:''}<div class="inset"><div class="inset-row"><span>Entry</span><b class="num">${c.entry!=null?'$'+n(c.entry):'n/a'}</b></div>${c.stop!=null?`<div class="inset-row"><span>Stop</span><b class="num">$${n(c.stop)}</b></div>`:''}${sz&&sz.risk!=null?`<div class="inset-row"><span>Risk at your size</span><b class="num">${usd(sz.risk,0)}</b></div>`:''}</div><div class="prose">${c.pattern?`<p>${esc(c.pattern)}</p>`:''}</div></div>`); return }
  const tab=e.target.closest('#tabs [data-tab]'); if(tab){ gotoTab(tab.dataset.tab); return }
  const th=e.target.closest('[data-theme-set]'); if(th){ localStorage.setItem('sd.theme', th.dataset.themeSet); Theme.apply(); render(true); return }
  const bk=e.target.closest('[data-book]'); if(bk){ const k=bk.dataset.book; if(state.tab==='positions') state.recs=k; if(k!=='all') state.acct=k; bustTabs(); render(false); return }
  const act=e.target.closest('[data-act]'); if(act){ state.act=act.dataset.act; render(true); return }
  const ins=e.target.closest('[data-ins]'); if(ins){ state.ins=ins.dataset.ins; render(true); return }
  const todo=e.target.closest('[data-todo]'); if(todo){ const t=T.find(x=>x.id===todo.dataset.todo); if(!t) return; const text=guideText(t); Sheet.open(`<div class="sheet-h"><button class="x" data-close>Close</button><div class="grab"></div></div><div class="sheet-body"><p class="eyebrow">${esc(t.ticker)}</p><h2 class="sheet-title">What to do</h2><ol class="guide">${guideSteps(t).map(step=>`<li>${esc(step)}</li>`).join('')}</ol><button type="button" class="btn primary" id="copy-guide">Copy</button></div>`); const btn=$('#copy-guide'); if(btn) btn.onclick=()=>{ const done=()=>UI.toast('Copied'); if(navigator.clipboard) navigator.clipboard.writeText(text).then(done).catch(done); else done(); }; return }
  const tr=e.target.closest('[data-trade]'); if(tr){ if(held){held=false;return} Sheet.trade(tr.dataset.trade); return }
  const jp=e.target.closest('[data-jump]'); if(jp){ const t=T.find(x=>(x.status==='OPEN'||x.status==='PENDING')&&x.ticker===jp.dataset.jump); if(t) Sheet.trade(t.id); return }
  if(e.target.closest('[data-install]')){ Install.go(); return }
  if(e.target.closest('[data-close]')||e.target.id==='scrim'){ Sheet.close(); $('#sheet-ios').hidden=true; $('#scrim').hidden=true; return }
  const dis=e.target.closest('[data-dismiss]'); if(dis){ const seen=JSON.parse(sessionStorage.getItem('sd.x')||'{}'); seen[dis.dataset.dismiss]=1; sessionStorage.setItem('sd.x', JSON.stringify(seen)); UI.applyLive() }
});
let hold, held=false;
document.addEventListener('pointerdown', e=>{
  if(e.target.closest('#mission')){ gearHeld=false; clearTimeout(gearTimer); gearTimer=setTimeout(()=>{ gearHeld=true; openGear(); }, 550); }
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
addEventListener('popstate', ()=>{ const s=$('#sheet'); if(s&&!s.hidden) Sheet.close(true); });
addEventListener('keydown', e=>{ if(e.key==='Escape'){ const s=$('#sheet'); if(s&&!s.hidden) Sheet.close(); } });
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

window.openGear=openGear;

})();
