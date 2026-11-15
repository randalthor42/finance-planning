// Engine tests (plain Node, no browser). Run with: npm test
import fs from 'node:fs';
import assert from 'node:assert';
import { fileURLToPath } from 'node:url';
import { normPlan } from '../../src/models/plan.js';
import { project, recurs } from '../../src/logic/projection.js';
import { loanCalc, payoffPlan } from '../../src/logic/loans.js';
import { wishCalc } from '../../src/logic/wishes.js';
import { firstFit, roomSeries, budgetTrend } from '../../src/logic/advice.js';
import { tripParts, tripSpan } from '../../src/logic/trips.js';
import { M, D, Period } from '../../src/core/dates.js';
import { parseMoney } from '../../src/core/format.js';
const FIX = fileURLToPath(new URL('../fixtures/', import.meta.url));
// --- alpha reference
const al=fs.readFileSync(FIX+'alpha-reference.html','utf8').split('\n');
const ref=new Function(al.slice(65,74).join('\n').replace('<script>','')+';let S=D();'+al.slice(76,89).join('\n')+';return calc()')();
const plan=normPlan(JSON.parse(fs.readFileSync(FIX+'alpha-plan.json')).plans[0]);
const P=project(plan);
let maxd=0;ref.rows.forEach((r,i)=>{maxd=Math.max(maxd,Math.abs(r.bal-P.months[i].close))});
console.log('alpha vs new: max balance diff',maxd.toFixed(3),'| alpha end',ref.bal.toFixed(2),'new end',P.summary.end);
assert(maxd<0.5); assert.strictEqual(ref.rows.length,P.months.length);
const lc=P.loans.loan0001; assert(Math.abs(lc.pay-ref.pay)<1e-6&&Math.abs(lc.P-ref.P)<1e-6&&Math.abs(lc.int-ref.int)<1e-6);
// --- idempotent normalisation
assert.strictEqual(JSON.stringify(normPlan(plan)),JSON.stringify(plan));
// --- hostile input
const bad=normPlan({name:'<img src=x onerror=alert(1)>'.repeat(9),settings:{horizon:1e9,opening:'abc',startMonth:'2026-13',currency:'eur'},incomes:'x',bills:[null,5,{amount:-5,every:7,from:'2027-05',to:'2027-01',untilLoan:'nope'},{id:'same',amount:NaN},{id:'same',amount:Infinity}],items:[{amount:'12.345',kind:'zzz',month:'bad'}],overrides:{'__proto__':{x:1},'2027-01':{'__proto__':5,'constructor':1,'bill:abcd':-4,'bill:same':'7'}},paid:{'2027-01':{'bill:same':'yes','inc:aaaa':true}},loans:[{amount:1000,rate:999,term:0,extras:{'2027-02':-5,'x':3}}],trips:[{items:[{pay:'never',amount:1e99}]}],actuals:{'2027-02':'NaN'},notes:{'2027-01':5}});
assert.strictEqual(bad.name.length,40);assert.strictEqual(bad.settings.horizon,120);assert.strictEqual(bad.settings.opening,0);assert.strictEqual(bad.settings.currency,'EUR');
assert.strictEqual(bad.bills.length,3);assert.strictEqual(bad.bills[0].amount,0);assert.strictEqual(bad.bills[0].every,1);assert.strictEqual(bad.bills[0].to,'2027-05');assert.strictEqual(bad.bills[0].untilLoan,null);
assert.notStrictEqual(bad.bills[1].id,bad.bills[2].id);assert.strictEqual(bad.bills[2].amount,0);
assert.strictEqual(bad.items[0].amount,12.35);assert.strictEqual(bad.items[0].kind,'out');
assert.deepStrictEqual(bad.overrides,{'2027-01':{'bill:abcd':0,'bill:same':7}});assert.deepStrictEqual(bad.paid,{'2027-01':{'inc:aaaa':true}});
assert.strictEqual(({}).x,undefined);assert.strictEqual(bad.loans[0].term,1);assert.deepStrictEqual(bad.loans[0].extras,{'2027-02':0});
assert.strictEqual(bad.trips[0].items[0].amount,1e9);assert.deepStrictEqual(bad.fixes,{});assert.deepStrictEqual(bad.notes,{});
const pb=project(bad);assert(pb.months.every(m=>isFinite(m.close)&&isFinite(m.debt)));
// --- conservation: closing = opening + sum of every ledger entry
const rich=normPlan({settings:{startMonth:'2027-01',horizon:36,opening:500,cushion:300},incomes:[{id:'sal1',amount:2000},{amount:300,every:3,from:'2027-02'}],bills:[{id:'rent',amount:700},{id:'card',amount:90,untilLoan:'ln01'},{amount:420,every:12,from:'2027-03'}],
 items:[{month:'2027-02',amount:250},{month:'2027-04',amount:100,kind:'in'},{month:'2031-01',amount:9999}],
 trips:[{id:'trp1',name:'Rome',month:'2027-06',items:[{id:'fl01',name:'Flights',amount:180,pay:'2027-03'},{id:'st01',name:'Stay',amount:300}]},{name:'Off',on:false,month:'2027-06',items:[{amount:5000}]}],
 loans:[{id:'ln01',amount:5000,rate:7,term:24,first:'2027-04',payout:'cash',feePct:2,feeMin:50,extra:50,extras:{'2027-06':500},early1:1,early2:.5},{amount:3000,rate:5,term:12,first:'2026-10'},{on:false,amount:1e6,rate:9,term:120,first:'2027-02'}],
 goals:[{id:'gl01',target:1200,saved:200,monthly:150,release:'2028-01'},{monthly:50,from:'2027-06',to:'2027-08'}],
 overrides:{'2027-02':{'bill:rent':650},'2027-03':{'inc:sal1':0}},actuals:{'2027-05':1234.5}});
const R=project(rich);let bal=500;
for(const m of R.months){const s=m.entries.reduce((a,e)=>a+e.amount,0);bal=Math.round((bal+s)*100)/100;assert(Math.abs(bal-m.close)<0.011,'conservation '+m.key+' '+bal+' vs '+m.close);bal=m.close}
const mo=k=>R.months[M.parse(k)-M.parse('2027-01')],ent=(k,key)=>mo(k).entries.find(e=>e.key===key);
assert.strictEqual(ent('2027-03','trip:trp1:fl01').amount,-180);assert.strictEqual(ent('2027-06','trip:trp1:st01').amount,-300);assert(!ent('2027-06','trip:trp1:fl01'));
assert.strictEqual(ent('2027-02','bill:rent').amount,-650);assert.strictEqual(ent('2027-03','inc:sal1').skipped,true);assert.strictEqual(mo('2027-03').inc,5000);
assert.strictEqual(ent('2027-03','loan:ln01:in').amount,5000);assert.strictEqual(ent('2027-03','loan:ln01:fee').amount,-100);
assert(ent('2027-03','bill:card'));assert(!ent('2027-04','bill:card'));               // card stops when loan starts
assert.strictEqual(ent('2027-06','loan:ln01:x').amount,-505);assert.strictEqual(ent('2027-05','loan:ln01:x').amount,-50.5);
assert.strictEqual(mo('2027-05').close,1234.5);assert(ent('2027-05','adjust'));
assert.strictEqual(R.goals.gl01.reached,M.parse('2027-07'));assert.strictEqual(ent('2027-07','goal:gl01').amount,-100);assert(!ent('2027-08','goal:gl01'));
assert.strictEqual(ent('2028-01','goal:gl01:out').amount,1200);assert.strictEqual(mo('2028-02').savings,150);
assert(ent('2027-03','bill:'+rich.bills[2].id)&&!ent('2027-04','bill:'+rich.bills[2].id)&&ent('2028-03','bill:'+rich.bills[2].id));
assert(ent('2027-02','inc:'+rich.incomes[1].id)&&!ent('2027-03','inc:'+rich.incomes[1].id)&&ent('2027-05','inc:'+rich.incomes[1].id));
assert(mo('2027-01').debt>0&&mo('2027-01').debt<3000);                                // existing loan started before plan
const l1=R.loans.ln01;assert(l1.sch[l1.sch.length-1].b<0.01);assert(l1.saved>0);
assert(Math.abs(l1.sch.reduce((a,r)=>a+r.p+r.x,0)-l1.P)<0.01,'principal fully repaid');
// what-if does not mutate
const before=JSON.stringify(rich);const W=project(rich,{extra:[{k:M.parse('2027-02'),amount:400}]});assert.strictEqual(JSON.stringify(rich),before);assert(Math.abs(W.months[1].close-(R.months[1].close-400))<1e-6);
// zero-rate loan, money parsing, month helpers
assert.strictEqual(loanCalc(normPlan({loans:[{amount:1200,rate:0,term:12}]}).loans[0]).pay,100);
[['1.234,56',1234.56],['1,234.56',1234.56],['12,5',12.5],['1,234',1234],['120+35+5',160],['€ 99',99],['abc',0],['-50',50],['1.2.3',123]].forEach(([a,b])=>assert.strictEqual(parseMoney(a),b,a));
assert.strictEqual(M.key(M.parse('2026-12')+1),'2027-01');assert.strictEqual(M.parse('2026-00'),null);assert.strictEqual(M.parse('__proto__'),null);

// ---- v2: pay cycles, dates, budgets
const S26={payDay:26,payShift:'next'},kN=M.parse('2026-11'),kD=M.parse('2026-12');
assert.strictEqual(D.key(Period.start(S26,kN)),'2026-11-26');assert.strictEqual(D.key(Period.start(S26,kD)),'2026-12-28'); // 26 Dec 2026 is a Saturday
assert.strictEqual(D.key(Period.end(S26,kN)),'2026-12-27');
assert.strictEqual(Period.of(S26,D.parse('2026-12-26')),kN);assert.strictEqual(Period.of(S26,D.parse('2026-12-28')),kD);assert.strictEqual(Period.of(S26,D.parse('2026-11-25')),kN-1);
assert.strictEqual(Period.of({payDay:0},D.parse('2026-12-31')),kD);
assert.strictEqual(D.key(Period.dayIn(S26,kN,28,'none')),'2026-11-28');assert.strictEqual(D.key(Period.dayIn(S26,kN,5,'none')),'2026-12-05');assert.strictEqual(D.key(Period.dayIn(S26,kN,5,'next')),'2026-12-07');
assert.strictEqual(Period.dayIn(S26,kN,0,'none'),null);assert.strictEqual(D.parse('2026-02-30'),null);assert.strictEqual(D.key(D.inMonth(M.parse('2027-02'),31,'none')),'2027-02-28');
for(let k=kN-30;k<kN+60;k++){for(const sh of ['none','next','prev'])for(const pf of ['same','next'])for(const pd of [0,1,15,26,31]){const s={payDay:pd,payShift:sh,payFor:pf};assert(Period.start(s,k+1)>Period.start(s,k));assert.strictEqual(Period.of(s,Period.start(s,k)),k);assert.strictEqual(Period.of(s,Period.end(s,k)),k);}}
const bp=normPlan({settings:{startMonth:'2026-11',horizon:6,opening:1000,payDay:26,payShift:'next',payFor:'same'},incomes:[{id:'sal1',amount:2000}],
 bills:[{id:'groc',name:'Groceries',amount:480,budget:true},{id:'rent',amount:500,day:28},{id:'phon',amount:20,day:5,shift:'next'}],
 items:[{id:'sp01',name:'Lidl',amount:100,date:'2026-12-03',budget:'groc',month:'2030-01'},{id:'sp02',amount:60,date:'2026-12-10',budget:'groc'},{id:'sp03',amount:9,budget:'rent'},{id:'sp04',amount:700,date:'2027-01-05',budget:'groc'},{id:'it05',amount:50,date:'2026-12-28'}],
 trips:[{id:'trp1',month:'2027-01',budget:400,items:[{id:'fl01',amount:150,pay:'2026-11'},{id:'st01',amount:100}]},{id:'trp2',month:'2027-01',budget:400,reserve:false,items:[{id:'fl02',amount:10}]}],
 goals:[{id:'gl01',saved:1200,monthly:0,rate:12}]});
assert.strictEqual(bp.items[0].month,'2026-11');assert.strictEqual(bp.items[2].budget,null);assert.strictEqual(bp.items[4].month,'2026-12');
const tdy=D.parse('2026-12-12'),B=project(bp,{today:tdy}),e2=(i,key)=>B.months[i].entries.find(e=>e.key===key);
assert.deepStrictEqual(e2(0,'bill:groc').budget,{planned:480,spent:160,left:320,closed:false,done:false});assert.strictEqual(e2(0,'bill:groc').amount,-320);
assert.strictEqual(e2(0,'item:sp01').amount,-100);assert.strictEqual(D.key(e2(0,'item:sp01').date),'2026-12-03');assert.strictEqual(B.months[0].g.bill,-(480+500+20));
assert.strictEqual(D.key(e2(0,'bill:rent').date),'2026-11-28');assert.strictEqual(D.key(e2(0,'bill:phon').date),'2026-12-07');assert.strictEqual(D.key(e2(0,'inc:sal1').date),'2026-11-26');
assert.strictEqual(e2(1,'bill:groc').amount,0);assert.strictEqual(e2(1,'bill:groc').budget.left,-220);assert.strictEqual(B.months[1].g.bill,-(700+500+20)); // overspent: real spend counts
const B2=project(bp,{today:D.parse('2027-03-01')});assert.strictEqual(B2.months[0].entries.find(e=>e.key==='bill:groc').amount,0);assert.strictEqual(B2.months[0].g.bill,-(160+500+20)); // period over: leftover released
assert.strictEqual(B2.months[0].close-B.months[0].close,320);assert.strictEqual(B2.months[2].g.bill,-(480+500+20)); // nothing logged: assume the budget was used
assert.strictEqual(e2(2,'trip:trp1:r').amount,-150);assert(!e2(2,'trip:trp2:r'));assert.strictEqual(e2(0,'trip:trp1:fl01').amount,-150);
assert.strictEqual(B.goals.gl01.series[0],1212);assert.strictEqual(B.months[0].savings,1212);assert(B.months[0].net===B.months[0].inc-B.months[0].out);
for(const PR of [B,B2]){let b=1000;for(const m of PR.months){b=Math.round((b+m.entries.reduce((a,e)=>a+e.amount,0))*100)/100;assert(Math.abs(b-m.close)<0.011);}}
assert.strictEqual(JSON.stringify(normPlan(bp)),JSON.stringify(bp));
const mig=normPlan({settings:{locale:'en-US'},bills:[{amount:5}]});assert.strictEqual(mig.settings.numFmt,'us');assert.strictEqual(mig.settings.dateFmt,'mdy');assert.strictEqual(mig.settings.payDay,0);assert.strictEqual(mig.bills[0].budget,false);
assert.strictEqual(normPlan({settings:{locale:'de-DE'}}).settings.numFmt,'eu');

// ---- v3: salary pays for the following month, wishlist, payoff, real data
const SN={payDay:26,payShift:'next',payFor:'next'};
assert.strictEqual(D.key(Period.start(SN,kN)),'2026-10-26');assert.strictEqual(D.key(Period.end(SN,kN)),'2026-11-25');assert.strictEqual(Period.of(SN,D.parse('2026-11-14')),kN);assert.strictEqual(Period.of(SN,D.parse('2026-11-26')),kD);
assert.strictEqual(D.key(Period.dayIn(SN,kN,28,'none')),'2026-10-28');assert.strictEqual(D.key(Period.dayIn(SN,kN,5,'none')),'2026-11-05');
assert.strictEqual(normPlan({settings:{payDay:26}}).settings.payFor,'next');assert.strictEqual(normPlan({settings:{payDay:5}}).settings.payFor,'same');
const real=normPlan(JSON.parse(fs.readFileSync(FIX+'real.json')).plans[0]),RP=project(real,{today:D.parse('2026-11-14')});
assert.strictEqual(real.trips.length,2);assert.strictEqual(RP.months[0].inc,2250);assert.strictEqual(RP.months[0].out,1121+330+400);assert.strictEqual(RP.months[0].close,60+2250-1851);
assert.strictEqual(RP.months[1].close,459+2250-1121-200-570);assert.strictEqual(RP.months[2].net,1129);
const paidAll=JSON.parse(JSON.stringify(real));paidAll.paid={'2026-11':{}};RP.months[0].entries.forEach(e=>{paidAll.paid['2026-11'][e.key]=true});
assert.strictEqual(project(normPlan(paidAll),{today:D.parse('2026-11-14')}).summary.end,RP.summary.end,'ticking things as paid never changes the maths');
const wp=p=>normPlan({settings:{startMonth:'2027-01',horizon:24,opening:5000},incomes:[{amount:1000}],wishes:[Object.assign({id:'wsh1',name:'Camera',price:1200,month:'2027-07',months:6,on:true},p)]});
const wc=project(wp({how:'cash'})),wf=project(wp({how:'finance',apr:0})),ws=project(wp({how:'save'})),wo=project(wp({on:false})),wi=project(wp({how:'finance',apr:12}));
assert.strictEqual(wo.summary.end-wc.summary.end,1200);assert.strictEqual(wo.summary.end-wf.summary.end,1200);assert.strictEqual(wo.summary.end-ws.summary.end,1200);assert(wo.summary.end-wi.summary.end>1240);
assert.strictEqual(wc.months[6].g.wish,-1200);assert.strictEqual(wf.months[6].g.wish,-200);assert.strictEqual(wf.months[11].g.wish,-200);assert.strictEqual(wf.months[12].g.wish,0);assert.strictEqual(wf.months[6].debt,1000);assert.strictEqual(wf.months[11].debt,0);
assert.strictEqual(ws.months[0].g.wish,-200);assert.strictEqual(ws.months[5].g.wish,-200);assert.strictEqual(ws.months[6].g.wish,0);assert.strictEqual(ws.months[5].savings,1200);assert.strictEqual(ws.months[6].savings,0);
assert.strictEqual(project(wp({how:'save',month:'2027-02',months:6})).months[0].g.wish,-1200); // only one month left to save
const two=normPlan({settings:{startMonth:'2027-01'},loans:[{name:'A',amount:5000,rate:5,term:48,first:'2027-01'},{name:'B',amount:2000,rate:15,term:36,first:'2027-01'}]}),k0=M.parse('2027-01');
const p0=payoffPlan(two,k0,0,null),pa=payoffPlan(two,k0,100,'avalanche'),ps=payoffPlan(two,k0,100,'snowball');
assert.strictEqual(p0.endK,k0+47);assert(Math.abs(p0.interest-(loanCalc(two.loans[0]).int+loanCalc(two.loans[1]).int))<0.05);assert(pa.endK<p0.endK&&pa.interest<p0.interest);assert.strictEqual(pa.order[0],'B');assert(ps.interest>=pa.interest-0.01);

// ---- v4: real-balance snapshots, tickable budgets, first fit, trends, new fields
const r2=JSON.parse(fs.readFileSync(FIX+'real2.json')).plans[0],T=D.parse('2026-11-14');
const rA=normPlan(r2),PA=project(rA,{today:T});assert.strictEqual(JSON.stringify(normPlan(rA)),JSON.stringify(rA));
assert.strictEqual(PA.months[0].out,1444+330+400);assert.strictEqual(PA.months[0].close,60+2250-2174);
// ticked budget without spends counts as fully used; with spends the rest is released
const bq=x=>project(normPlan({settings:{startMonth:'2027-01',opening:1000},bills:[{id:'bud1',amount:300,budget:true}],items:x.items||[],paid:x.paid||{}}),{today:D.parse('2027-01-10')}).months[0];
assert.strictEqual(bq({}).close,700);assert.strictEqual(bq({paid:{'2027-01':{'bill:bud1':true}}}).close,700);assert.strictEqual(bq({paid:{'2027-01':{'bill:bud1':true}}}).paidOut,300);
assert.strictEqual(bq({items:[{amount:120,budget:'bud1',month:'2027-01'}]}).close,700);assert.strictEqual(bq({items:[{amount:120,budget:'bud1',month:'2027-01'}],paid:{'2027-01':{'bill:bud1':true}}}).close,880);
// first month a cost fits
const ff=project(normPlan({settings:{startMonth:'2027-01',horizon:12,opening:0,cushion:100},incomes:[{amount:200}],items:[{month:'2027-06',amount:900}]}),{today:T});
assert.deepStrictEqual(roomSeries(ff,100).slice(0,7),[100,200,200,200,200,200,400]);assert.strictEqual(firstFit(ff,100,150,M.parse('2027-01')),M.parse('2027-02'));assert.strictEqual(firstFit(ff,100,300,M.parse('2027-01')),M.parse('2027-07'));assert.strictEqual(firstFit(ff,100,99999,M.parse('2027-01')),null);
const bt=budgetTrend(normPlan({bills:[{id:'cig1',name:'Cigars',amount:150,budget:true},{id:'ok01',amount:100,budget:true}],items:[{amount:180,budget:'cig1',month:'2026-09'},{amount:190,budget:'cig1',month:'2026-10'},{amount:100,budget:'ok01',month:'2026-09'},{amount:104,budget:'ok01',month:'2026-10'}]}),M.parse('2026-11'));
assert.strictEqual(bt.length,1);assert.strictEqual(bt[0].avg,185);
const nf=normPlan({accounts:[{name:'Debit',balance:25},{type:'credit',balance:127,owed:300},{type:'zzz',balance:'x'}],bills:[{amount:5,vary:true,budget:true,note:'a\u0000b',account:'nope'}],trips:[{kind:'idea',on:true,from:'2026-12-18',to:'2026-12-01',items:[{note:'see https://x.y'}]},{from:'2026-12-18',to:'2027-01-06'}],wishes:[{price:5,flex:true,on:true,link:'javascript:alert(1)'},{link:'https://example.com/a?b=1'}]});
assert.strictEqual(nf.accounts.length,3);assert.strictEqual(nf.accounts[1].limit,300);assert.strictEqual(nf.accounts[1].owed,173);assert.strictEqual(nf.accounts[0].main,true);assert.strictEqual(nf.accounts[2].main,false);assert.strictEqual(nf.accounts[2].type,'debit');assert.strictEqual(nf.bills[0].vary,false);assert.strictEqual(nf.bills[0].note,'a b');assert.strictEqual(nf.bills[0].account,null);
assert.strictEqual(nf.trips[0].on,false);assert.strictEqual(nf.trips[0].to,null);assert.strictEqual(nf.trips[1].to,'2027-01-06');assert.strictEqual(nf.wishes[0].on,false);assert.strictEqual(nf.wishes[0].link,'');assert.strictEqual(nf.wishes[1].link,'https://example.com/a?b=1');

// ---- v5: ticks with a date, proration of budgets, credit cards, the real numbers
const r3=JSON.parse(fs.readFileSync(FIX+'real3.json')).plans[0],rN=normPlan(r3),PN=project(rN,{today:T}),n0=PN.months[0];
assert.strictEqual(JSON.stringify(normPlan(rN)),JSON.stringify(rN));assert.strictEqual(rN.accounts.find(a=>a.type==='credit').limit,1400);assert.strictEqual(rN.accounts.find(a=>a.type==='credit').owed,1273);
{let b=rN.settings.opening;for(const m of PN.months){b=Math.round((b+m.entries.reduce((a,e)=>a+e.amount,0))*100)/100;assert(Math.abs(b-m.close)<0.011,'conservation v5 '+m.key);}}
// credit card: 1400 owed; the monthly payment bill pays it down; the loan that replaces the bill clears it
const rC2=JSON.parse(JSON.stringify(r3));rC2.bills.find(b=>b.name==='Credit card payment').payTo='2c0y3s149r';rC2.bills.find(b=>b.name==='Credit card payment').untilLoan='loan0001';rC2.paid={};
const PCd=project(normPlan(rC2),{today:T});assert.strictEqual(PCd.months[0].cardDebt,1163);assert.strictEqual(PCd.months[1].cardDebt,1053);assert.strictEqual(PCd.months[2].cardDebt,943);assert.strictEqual(PCd.months[3].cardDebt,0);assert.strictEqual(PCd.months[0].credit,237);assert(PCd.months[0].debt>=1163);
// something paid with the card takes no cash and adds to the card
const cc=x=>project(normPlan({settings:{startMonth:'2026-11',opening:1000},accounts:[{id:'card1',type:'credit',limit:1000,owed:100,apr:12},{id:'main1',balance:1000}],items:[Object.assign({id:'itm1',amount:200,month:'2026-11'},x)]}),{today:T});
assert.strictEqual(cc({}).months[0].close,800);assert.strictEqual(cc({}).months[0].cardDebt,100);
assert.strictEqual(cc({account:'card1'}).months[0].close,1000);assert.strictEqual(cc({account:'card1'}).months[0].cardDebt,300);assert.strictEqual(cc({account:'card1'}).months[1].cardDebt,303);assert.strictEqual(cc({account:'card1'}).months[0].credit,700);
const hp=normPlan({accounts:[{id:'acc1'}],paid:{'2026-11':{'bill:abcd':{d:'nope',a:'zzz',v:'x',t:'acc1'},'bill:efgh':true,'bill:ijkl':5}}});assert.deepStrictEqual(hp.paid['2026-11'],{'bill:abcd':{d:null,a:null,v:0,t:null},'bill:efgh':true});

// ---- everyday spending worked out from a real balance
// ---- v6: "have now" from the paid lines, "still to come" from the rest, and corrections from real money
const q=x=>{const p=normPlan(Object.assign({settings:{startMonth:'2026-11',opening:100},incomes:[{id:'sal00001',amount:1000}],bills:[{id:'rent0001',amount:400},{id:'food0001',amount:300,budget:true}],items:[{id:'shoe0001',amount:50,month:'2026-11'}]},x));const P=project(p,{today:T});return {p,P,m:P.months[0]}};
{let m=q({}).m;assert.strictEqual(m.now,100);assert.strictEqual(m.todo,250);assert.strictEqual(m.close,350);assert.strictEqual(m.fix,null);
 const tk={paid:{'2026-11':{'inc:sal00001':true,'bill:rent0001':true}}};m=q(tk).m;assert.strictEqual(m.now,700);assert.strictEqual(m.todo,-350);assert.strictEqual(m.close,350);
 m=q(Object.assign({},tk,{items:[{id:'shoe0001',amount:50,month:'2026-11'},{id:'spend001',amount:120,budget:'food0001',month:'2026-11'}]})).m;assert.strictEqual(m.now,580);assert.strictEqual(m.todo,-230);assert.strictEqual(m.close,350);
 const f=q(Object.assign({},tk,{fixes:{'2026-11':{d:'2026-11-14',a:-80},'bad':{a:1},'2026-12':{a:'x'}}}));m=f.m;assert.deepStrictEqual(Object.keys(f.p.fixes),['2026-11']);assert.strictEqual(m.now,620);assert.strictEqual(m.close,270);assert.strictEqual(f.P.months[1].open,270);assert.strictEqual(f.P.months[1].fix,null);
 const adj=m.entries.find(e=>e.key==='adjust');assert(adj.paid&&adj.fix&&adj.amount===-80&&adj.still===0);
 {let b=100;for(const mm of f.P.months){b=Math.round((b+mm.entries.reduce((a,e)=>a+e.amount,0))*100)/100;assert(Math.abs(b-mm.close)<0.011,'every month is the sum of its lines '+mm.key);assert(Math.abs(mm.now+mm.todo-mm.close)<0.011,'now + to come = end '+mm.key);}}
 // old data: a real balance on a day and a month-end check-in both become one correction, once
 const mg=q(Object.assign({},tk,{snaps:{'2026-11-02':999,'2026-11-14':500,'bad':5}}));assert.deepStrictEqual(mg.p.fixes,{'2026-11':{d:'2026-11-14',a:-200}});assert.strictEqual(mg.p.snaps,undefined);assert.strictEqual(mg.p.actuals,undefined);assert.strictEqual(mg.m.now,500);assert.strictEqual(JSON.stringify(normPlan(mg.p)),JSON.stringify(mg.p));
 const ma=q({actuals:{'2026-11':300,'2026-12':10}});assert.strictEqual(ma.m.close,300);assert.strictEqual(ma.P.months[1].close,10);assert.strictEqual(ma.P.months[2].open,10);}
const r5=JSON.parse(fs.readFileSync(FIX+'real5.json')).plans[0],p5=normPlan(r5),P5=project(p5,{today:T});
assert.strictEqual(P5.months[0].now,425);assert.strictEqual(JSON.stringify(normPlan(p5)),JSON.stringify(p5));console.log('real5',JSON.stringify(p5.fixes),'ends',P5.months[0].close,'to come',P5.months[0].todo);
// ---- covering a short month from a credit card: cash comes in, the card owes more, the payment bill pays it down
{const cv=x=>{const p=normPlan({settings:{startMonth:'2026-11',opening:0},accounts:[{id:'card0001',type:'credit',limit:1000,owed:200},{id:'save0001',type:'savings',balance:500}],bills:[{id:'big00001',amount:300},{id:'cardpay1',amount:50,payTo:'card0001'}],items:x||[]});return {p,P:project(p,{today:T})}};
 const c0=cv(),c1=cv([{id:'cover001',amount:350,kind:'in',month:'2026-11',cover:'card0001'}]);
 assert.strictEqual(c0.P.months[0].close,-350);assert.strictEqual(c0.P.months[0].cardDebt,150);assert.strictEqual(c1.P.months[0].close,0);assert.strictEqual(c1.P.months[0].cardDebt,500);assert.strictEqual(c1.P.months[1].cardDebt,450);
 assert.strictEqual(c1.p.items[0].cover,'card0001');assert.strictEqual(normPlan({items:[{amount:5,kind:'out',cover:'x'}]}).items[0].cover,null);
 const c2=cv([{id:'cover002',amount:350,kind:'in',month:'2026-11',cover:'save0001'}]);assert.strictEqual(c2.P.months[0].close,0);assert.strictEqual(c2.P.months[0].cardDebt,150);}

// ---- a trip that crosses a payday is shared between the two salary months by days
const r6=JSON.parse(fs.readFileSync(FIX+'real6.json')).plans[0],p6=normPlan(r6),t6=p6.trips.find(x=>x.name==='Nis + Novi Sad'),sp6=tripSpan(p6.settings,t6),parts6=tripParts(p6.settings,t6);
console.log('span',JSON.stringify(sp6.map(([k,d])=>[M.key(k),d])));
assert.strictEqual(sp6.length,2);assert.strictEqual(sp6[0][1]+sp6[1][1],19);
const sum6=k=>Math.round(parts6.filter(x=>x.k===k).reduce((a,x)=>a+x.amount,0)*100)/100;console.log('split',sum6(sp6[0][0]),sum6(sp6[1][0]));
assert.strictEqual(Math.round((sum6(sp6[0][0])+sum6(sp6[1][0]))*100)/100,1100);
for(const it of t6.items)assert.strictEqual(Math.round(parts6.filter(x=>x.id===it.id).reduce((a,x)=>a+x.amount,0)*100),it.amount*100);
const P6=project(p6,{today:T}),tr6=i=>-P6.months[i].entries.filter(e=>e.group==='trip'&&e.id===t6.id).reduce((a,e)=>a+e.amount,0);
assert.strictEqual(Math.round(tr6(1)*100)/100,sum6(sp6[0][0]));assert.strictEqual(Math.round(tr6(2)*100)/100,sum6(sp6[1][0]));
const one6=JSON.parse(JSON.stringify(r6));one6.trips.find(x=>x.name==='Nis + Novi Sad').items[0].pay='2026-12';const pp6=tripParts(normPlan(one6).settings,normPlan(one6).trips.find(x=>x.name==='Nis + Novi Sad'));assert.strictEqual(pp6.filter(x=>x.id===t6.items[0].id).length,1);assert.strictEqual(pp6[0].amount,30);
assert.strictEqual(tripSpan(p6.settings,p6.trips.find(x=>x.name==='Clair Obscur Concert')).length,0);assert.strictEqual(tripParts(p6.settings,p6.trips[0]).length,4);
console.log('months',P6.months.slice(0,4).map(m=>M.label(m.k)+' '+m.close).join(', '));
console.log('all engine tests passed');
// ---- a tick never changes where a month ends, whatever the line is (also a purchase planned on a credit card)
{const r=JSON.parse(fs.readFileSync(FIX+'real6.json')).plans[0],p0=normPlan(r),P0=project(p0,{today:T}),main=p0.accounts.find(a=>a.main).id;
 for(const e of P0.months[0].entries.filter(e=>e.key!=='adjust'&&!e.of)){const q=JSON.parse(JSON.stringify(p0));q.paid['2026-11']=q.paid['2026-11']||{};
  if(q.paid['2026-11'][e.key])delete q.paid['2026-11'][e.key];else q.paid['2026-11'][e.key]={d:'2026-11-14',a:e.account||main,v:0,t:null};
  const P1=project(normPlan(q),{today:T});if(!e.budget)assert.strictEqual(P1.months[0].close,P0.months[0].close,'tick changed the month end: '+e.label);}
 const mom=P0.months[0].entries.find(e=>e.label.startsWith('Mom'));assert(mom.onCard&&mom.account&&mom.amount===0);console.log('tick invariance ok');}

