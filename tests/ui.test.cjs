// Browser tests (Playwright). Run with: npm run test:ui
const FIX=require('path').join(__dirname,'fixtures')+'/',PAGE='file://'+require('path').resolve(__dirname,'../dist-test/index.html');require('fs').mkdirSync(__dirname+'/shots',{recursive:true});process.chdir(__dirname+'/shots');
const {chromium}=require('playwright');const fs=require('fs');
const FILE=PAGE;
(async()=>{
 const b=await chromium.launch();const ctx=await b.newContext({viewport:{width:1360,height:900},acceptDownloads:true});const pg=await ctx.newPage();
 const errs=[];pg.on('pageerror',e=>errs.push('PAGEERR '+e.message));pg.on('console',m=>{if(m.type()==='error')errs.push('CONSOLE '+m.text())});
 const ok=(c,m)=>{if(!c){errs.push('FAIL '+m)}else console.log('ok',m)};
 await pg.goto(FILE);
 ok(await pg.locator('.welcome').count()===1,'welcome shown');
 await pg.screenshot({path:'s0-welcome.png'});
 await pg.getByText('Look around with a sample plan').click();
 ok(await pg.locator('.kpi').count()>=4,'kpis');
 await pg.screenshot({path:'s1-overview.png',fullPage:true});
 // chart hover
 const svg=pg.locator('.chart svg').first();const bb=await svg.boundingBox();await pg.mouse.move(bb.x+bb.width*0.4,bb.y+bb.height/2);
 ok(await pg.locator('.tip').first().isVisible(),'chart tooltip');
 // afford
 await pg.getByPlaceholder('Cost, e.g. 500').fill('5000');ok(await pg.locator('.note.bad').count()>=1,'afford verdict bad');
 // every view
 for(const v of ['Month planner','Income and bills','Purchase log','Trips and events','Loans','Savings goals','Forecast','Settings']){await pg.locator('.nav button[title="'+v+'"]').click();await pg.waitForTimeout(80);await pg.screenshot({path:'s-'+v.replace(/\W+/g,'_')+'.png',fullPage:true});}
 // add a bill -> forecast and month change
 const st=()=>pg.evaluate(()=>({end:Store.proj.summary.end,n:Store.plan.bills.length}));
 const a=await st();
 await pg.locator('.nav button[title="Income and bills"]').click();
 await pg.getByRole('button',{name:'Add a bill'}).first().click();
 await pg.getByPlaceholder('Rent, groceries, phone…').fill('<b>Test</b> "bill"');
 await pg.locator('dialog input[inputmode=decimal]').first().pressSequentially('100+20,50');
 await pg.screenshot({path:'s2-modal.png'});
 await pg.getByRole('button',{name:'Save'}).click();
 const a2=await st();ok(a2.n===a.n+1&&Math.abs(a.end-a2.end-120.5*24)<0.01,'bill flows into forecast: '+(a.end-a2.end));
 ok(await pg.locator('.row .t',{hasText:'<b>Test</b> "bill"'}).count()===1&&await pg.locator('main b',{hasText:/^Test$/}).count()===0,'html is text, not markup');
 // undo / redo
 await pg.locator('.side-foot').getByRole('button',{name:'Undo'}).click();ok((await st()).n===a.n,'undo');ok(await pg.locator('.toast.undo',{hasText:'Undone: Added bill'}).count()===1,'undo notification');await pg.locator('.side-foot').getByRole('button',{name:'Redo'}).click();ok((await st()).n===a.n+1,'redo');
 // trip with early payment appears in month planner
 await pg.locator('.nav button[title="Trips and events"]').click();await pg.getByRole('button',{name:'Plan a trip'}).first().click();
 await pg.getByPlaceholder('Weekend in Lisbon, concert in Barcelona…').fill('Rome');
 await pg.locator('dialog .titem').first().locator('input').nth(1).fill('222');
 await pg.locator('dialog .titem').first().locator('.mbtn').click();
 ok(await pg.locator('.mpop').isVisible(),'month picker opens in dialog');const ws=await pg.locator('.mpop-g button').evaluateAll(b=>b.map(x=>Math.round(x.getBoundingClientRect().width)));ok(Math.max(...ws)-Math.min(...ws)<=1&&ws.length===12,'month picker grid is even: '+ws.join(','));await pg.screenshot({path:'s3-picker.png'});
 await pg.locator('.mpop-h button').last().click();await pg.locator('.mpop-g button').nth(1).click(); // Feb next year
 ok(await pg.locator('.mpop').count()===0,'picker closes');
 await pg.locator('dialog').getByRole('button',{name:'Save'}).click();
 const tr=await pg.evaluate(()=>{const t=Store.plan.trips.find(x=>x.name==='Rome');const it=t.items[0];const m=Store.proj.months.find(m=>m.key===it.pay);return{pay:it.pay,month:t.month,found:m&&m.entries.some(e=>e.key==='trip:'+t.id+':'+it.id&&e.amount===-222),n:t.items.length}});
 console.log(JSON.stringify(tr));ok(tr.found&&tr.pay!==tr.month&&tr.n===6,'trip cost lands in pay month '+JSON.stringify(tr));
 // month planner: open that month, override a bill, mark paid, actual
 await pg.evaluate(k=>App.go('months',{month:M.parse(k)}),tr.pay);
 ok(await pg.locator('.row .t',{hasText:'Getting there'}).count()===1,'trip row in month planner');
 await pg.locator('.row.click',{hasText:'Rent'}).first().click();await pg.locator('dialog input').first().fill('0');await pg.locator('dialog').getByRole('button',{name:'Save'}).click();
 ok(await pg.locator('.chip',{hasText:'skipped this month'}).count()===1,'override skip');
 await pg.locator('.check').nth(1).check();ok(await pg.evaluate(()=>Object.keys(Store.plan.paid).length===1),'paid saved');
 await pg.evaluate(k=>Actions.setEnd(k,1234),tr.pay);
 ok(await pg.evaluate(k=>Store.proj.months.find(m=>m.key===k).close===1234,tr.pay),'check-in applied');
 await pg.screenshot({path:'s4-month.png',fullPage:true});
 // loans: schedule extra
 await pg.locator('.nav button[title="Loans"]').click();await pg.getByText('Payment schedule and extra payments').click();
 const before=await pg.evaluate(()=>Object.values(Store.proj.loans)[0].sch.length);
 const inp=pg.locator('details table input').nth(12);await inp.fill('1000');await inp.press('Tab');
 ok(await pg.evaluate(()=>Object.values(Store.proj.loans)[0].sch.length)<before,'extra payment shortens loan');
 ok(await pg.locator('details[open]').count()===1,'details stays open after edit');
 await pg.screenshot({path:'s5-loans.png',fullPage:true});

 // ---- v2 features
 await pg.evaluate(()=>App.go('months',{month:null}));
 await pg.locator('#main').getByRole('button',{name:'Log a spend'}).first().click();
 await pg.getByPlaceholder('Water, trousers, concert tickets…').fill('Lidl');await pg.locator('dialog input[inputmode=decimal]').first().pressSequentially('40');
 await pg.locator('dialog').getByRole('button',{name:'Save'}).click();
 const bg=await pg.evaluate(()=>{const m=Store.proj.months[0],e=m.entries.find(e=>e.budget);const it=Store.plan.items.find(i=>i.name==='Lidl');return{b:e.budget,amt:e.amount,date:it.date,bud:it.budget,today:D.key(D.today())}});
 console.log(JSON.stringify(bg));ok(bg.b.spent===64+23+40&&bg.b.left===360-127&&bg.amt===-(360-127)&&bg.date===bg.today&&!!bg.bud,'spend logged against budget');
 await pg.screenshot({path:'v2-month-list.png',fullPage:true});
 await pg.getByRole('button',{name:'Day by day'}).click();
 ok(await pg.locator('.day').count()>=28&&await pg.locator('.day.today').count()===1,'day by day view');
 ok(await pg.locator('.day.today .row .t',{hasText:'Lidl'}).count()===1,'spend shows on its day');
 await pg.locator('.day.nil').first().locator('button').click();
 ok(await pg.locator('dialog .mbtn:not(.unset)').count()>=1,'day preset in modal');
 await pg.getByPlaceholder('Water, trousers, concert tickets…').fill('Haircut');await pg.locator('dialog input[inputmode=decimal]').first().pressSequentially('25');await pg.locator('dialog').getByRole('button',{name:'Save'}).click();
 ok(await pg.evaluate(()=>{const it=Store.plan.items.find(i=>i.name==='Haircut');return !!it.date&&it.month===Store.plan.settings.startMonth&&Store.proj.months[0].entries.some(e=>e.key==='item:'+it.id&&e.date===D.parse(it.date))}),'dated one-off lands on its day');
 await pg.screenshot({path:'v2-month-days.png',fullPage:true});
 // day picker
 await pg.locator('.row.click',{hasText:'Haircut'}).first().click();await pg.locator('dialog .mbtn').first().click();ok(await pg.locator('.dpop-g button').count()>=28,'day picker');await pg.screenshot({path:'v2-daypicker.png'});
 await pg.keyboard.press('Escape');await pg.keyboard.press('Escape');
 // add month
 const h0=await pg.evaluate(()=>Store.plan.settings.horizon);await pg.getByText('+ Add month').click();ok(await pg.evaluate(()=>Store.plan.settings.horizon)===h0+1,'add month');
 // number mask (EU) and settings
 await pg.evaluate(()=>App.go('settings',{stab:'general'}));await pg.locator('#main').getByRole('button',{name:'Edit',exact:true}).click();
 await pg.locator('dialog .seg button',{hasText:'1.234,56'}).click();
 await pg.locator('dialog').getByRole('button',{name:'Save'}).click();
 await pg.evaluate(()=>App.go('settings',{stab:'look'}));await pg.locator('.row.opt',{hasText:'Autosave'}).locator('label.switch').click();await pg.locator('.row.opt',{hasText:'Notifications'}).getByRole('button',{name:'Bottom left'}).click();
 ok(await pg.evaluate(()=>Store.plan.settings.numFmt==='eu'&&Store.db.autosave===true&&Store.db.toastPos==='bl'&&document.querySelector('#toasts').className==='pos-bl'),'settings saved, notification position changes');await pg.evaluate(()=>Store.setPref('toastPos','tr'));
 await pg.locator('.nav button[title="Income and bills"]').click();await pg.getByRole('button',{name:'Add a bill'}).first().click();
 const mi=pg.locator('dialog input[inputmode=decimal]').first();await mi.pressSequentially('1234567.5');
 ok(await mi.inputValue()==='1.234.567,5','EU mask while typing: '+await mi.inputValue());
 await mi.fill('');await mi.pressSequentially('12,5');await pg.getByPlaceholder('Rent, groceries, phone…').fill('Auto bill');
 await pg.waitForTimeout(800);
 ok(await pg.evaluate(()=>{const b=Store.plan.bills.find(b=>b.name==='Auto bill');return b&&b.amount===12.5})&&await pg.locator('dialog[open]').count()===1,'autosave while modal open');
 await pg.getByPlaceholder('Rent, groceries, phone…').fill('Auto bill 2');await pg.waitForTimeout(700);await pg.locator('dialog').getByRole('button',{name:'Done'}).click();
 ok(await pg.evaluate(()=>Store.plan.bills.some(b=>b.name==='Auto bill 2')),'autosave second edit');
 await pg.locator('body').press('Control+z');ok(await pg.evaluate(()=>!Store.plan.bills.some(b=>b.name.startsWith('Auto bill'))),'one undo reverts the whole autosaved modal');
 await pg.locator('body').press('Control+y');ok(await pg.evaluate(()=>Store.plan.bills.some(b=>b.name==='Auto bill 2')),'ctrl+y redo');
 // reorder with keyboard, then with the mouse
 const ord=()=>pg.evaluate(()=>Store.plan.bills.map(b=>b.name).join('|'));const o0=await ord();
 await pg.locator('[data-sort=bills] .grip').first().focus();await pg.keyboard.press('ArrowDown');const o1=await ord();ok(o0!==o1&&o1.split('|')[1]===o0.split('|')[0],'keyboard reorder');
 const g0=await pg.locator('[data-sort=bills] .grip').nth(0).boundingBox(),g3=await pg.locator('[data-sort=bills] .srow').nth(3).boundingBox();
 await pg.mouse.move(g0.x+5,g0.y+5);await pg.mouse.down();await pg.mouse.move(g0.x+5,g3.y+g3.height*0.8,{steps:6});await pg.mouse.up();
 const o2=await ord();ok(o2.split('|')[3]===o1.split('|')[0],'drag reorder: '+o2.slice(0,60));
 await pg.screenshot({path:'v2-bills.png',fullPage:true});
 await pg.evaluate(()=>{Store.db.autosave=false;Store.save()});
 // goal: linked fields
 await pg.locator('.nav button[title="Savings goals"]').click();await pg.getByRole('button',{name:'Add a goal'}).first().click();
 await pg.getByPlaceholder('Emergency fund, new laptop, mortgage deposit…').fill('Deposit');
 const gi=pg.locator('dialog input[inputmode=decimal]');await gi.nth(0).pressSequentially('12000');await gi.nth(2).pressSequentially('500');
 ok(await pg.locator('dialog .mbtn:not(.unset)').count()===1,'target month filled from monthly amount');
 await pg.screenshot({path:'v2-goal.png'});await pg.locator('dialog').getByRole('button',{name:'Save',exact:true}).click();
 ok(await pg.evaluate(()=>{const g=Store.plan.goals.find(g=>g.name==='Deposit');return g.monthly===500&&M.parse(g.by)===Period.now(Store.plan.settings)+23}),'goal saved with date');
 await pg.screenshot({path:'v2-goals.png',fullPage:true});
 await pg.locator('.nav button[title="Trips and events"]').click();await pg.screenshot({path:'v2-trips.png',fullPage:true});
 await pg.locator('.nav button[title="Forecast"]').click();await pg.getByRole('button',{name:'By year'}).click();ok(await pg.locator('tbody tr').count()<=4,'yearly forecast');
 await pg.locator('.nav button[title="Overview"]').click();await pg.screenshot({path:'v2-overview.png',fullPage:true});
 // ---- v3 features
 await pg.evaluate(()=>{Store.db.autosave=false;Store.save()});
 // unsaved-changes guard: a click outside must not lose the work
 await pg.locator('.nav button[title="Trips and events"]').click();await pg.getByRole('button',{name:'Plan a trip'}).first().click();await pg.getByPlaceholder('Weekend in Lisbon, concert in Barcelona…').fill('Guarded');
 await pg.mouse.click(8,400);ok(await pg.locator('dialog[open]').count()===2&&await pg.locator('dialog.narrow h2',{hasText:'Discard your changes?'}).count()===1,'click outside a dirty modal asks first');await pg.getByRole('button',{name:'Keep editing'}).click();ok(await pg.locator('dialog[open]').count()===1&&await pg.getByPlaceholder('Weekend in Lisbon, concert in Barcelona…').inputValue()==='Guarded','keep editing keeps the work');
 await pg.waitForTimeout(200);await pg.keyboard.press('Escape');await pg.waitForTimeout(100);ok(await pg.locator('dialog.narrow').count()===1,'Esc on a dirty modal asks first');await pg.getByRole('button',{name:'Keep editing'}).click();
 await pg.locator('dialog').getByRole('button',{name:'Cancel'}).click();ok(await pg.locator('dialog[open]').count()===0&&await pg.evaluate(()=>!Store.plan.trips.some(t=>t.name==='Guarded')),'Cancel discards');
 await pg.getByRole('button',{name:'Plan a trip'}).first().click();await pg.mouse.click(8,400);ok(await pg.locator('dialog[open]').count()===0,'untouched modal still closes on outside click');
 // trip that is too expensive is flagged
 await pg.evaluate(()=>Actions.save('trips',{id:'bigtrip001',name:'World tour',month:M.key(curK()+2),on:true,budget:5000,reserve:true,items:[{id:'bigitem001',name:'Everything',amount:9000,pay:null}]}));
 ok(await pg.locator('.card',{hasText:'World tour'}).locator('.chip',{hasText:/too expensive|month already short/}).count()===1&&await pg.locator('.card',{hasText:'World tour'}).locator('.bar.over').count()===1,'expensive trip flagged');
 ok(await pg.locator('.toast',{hasText:'Added trip “World tour”'}).count()===1,'notification on add');
 await pg.screenshot({path:'v3-trips.png',fullPage:true});
 await pg.locator('.card',{hasText:'World tour'}).getByRole('button',{name:'Delete'}).click();ok(await pg.evaluate(()=>!Store.plan.trips.some(t=>t.id==='bigtrip001'))&&await pg.locator('.toast',{hasText:'Deleted trip'}).getByRole('button',{name:'Undo'}).count()===1,'card delete with undo toast');
 // row delete button and right-click menu
 await pg.locator('.nav button[title="Income and bills"]').click();const nb=await pg.evaluate(()=>Store.plan.bills.length);
 await pg.locator('[data-sort=bills] .srow',{hasText:'Gym'}).locator('.rowdel').click();ok(await pg.evaluate(()=>Store.plan.bills.length)===nb-1,'row delete button');
 await pg.locator('.toast',{hasText:'Deleted bill “Gym”'}).getByRole('button',{name:'Undo'}).click();ok(await pg.evaluate(()=>Store.plan.bills.length)===nb,'undo from toast');
 await pg.locator('[data-sort=bills] .srow',{hasText:'Gym'}).click({button:'right'});ok(await pg.locator('.mpop.menu button').count()===4,'context menu');await pg.screenshot({path:'v3-menu.png'});
 await pg.locator('.mpop.menu button',{hasText:'Amount changes from'}).click();await pg.locator('dialog input[inputmode=decimal]').fill('');await pg.locator('dialog input[inputmode=decimal]').pressSequentially('40');await pg.locator('dialog').getByRole('button',{name:'Apply'}).click();
 ok(await pg.evaluate(()=>{const g=Store.plan.bills.filter(b=>b.name==='Gym');const k=curK();return g.length===2&&g[0].to===M.key(k)&&g[1].from===M.key(k+1)&&g[1].amount===40&&monthAt(k).entries.find(e=>e.label==='Gym').amount===-32&&monthAt(k+1).entries.find(e=>e.label==='Gym').amount===-40}),'amount change from next month splits the line');
 // live drag: the row itself moves
 const gr=await pg.locator('[data-sort=bills] .grip').nth(0).boundingBox();await pg.mouse.move(gr.x+5,gr.y+5);await pg.mouse.down();await pg.mouse.move(gr.x+5,gr.y+90,{steps:5});
 ok(await pg.evaluate(()=>{const r=document.querySelector('.srow.drag');return !!r&&r.style.transform.includes('translateY')&&[...r.parentNode.children].indexOf(r)>0}),'dragged row moves live');await pg.screenshot({path:'v3-drag.png'});await pg.mouse.up();
 // subscriptions, wishlist, review, payoff, activity
 await pg.locator('.nav button[title="Subscriptions"]').click();ok(await pg.locator('.row .t',{hasText:'Streaming'}).count()===1,'subscriptions page lists subscription bills');await pg.screenshot({path:'v3-subs.png',fullPage:true});
 await pg.locator('.nav button[title="Wishlist"]').click();const e0=await pg.evaluate(()=>Store.proj.summary.end);
 ok(await pg.locator('.card',{hasText:'Camera'}).locator('.rows .row').count()===3,'wishlist compares three ways to pay');
 await pg.locator('.card',{hasText:'Camera'}).locator('label.switch').click();ok(await pg.evaluate(()=>Math.abs(Store.proj.months.reduce((a,m)=>a+m.g.wish,0)+800)<0.001&&Store.plan.wishes[0].on),'switching a wish on takes its price out of the plan');
 await pg.locator('.card',{hasText:'Camera'}).locator('.row',{hasText:'Finance it'}).getByRole('button',{name:'Choose'}).click();ok(await pg.evaluate(()=>Store.plan.wishes[0].how==='finance'&&Store.proj.months.some(m=>m.g.wish<0&&m.debt>0)),'financing a wish adds instalments and debt');
 await pg.screenshot({path:'v3-wishlist.png',fullPage:true});
 await pg.locator('.nav button[title="Review"]').click();ok(await pg.locator('.kpi').count()===4,'month review');await pg.screenshot({path:'v3-review.png',fullPage:true});await pg.getByRole('button',{name:'Year',exact:true}).click();ok(await pg.locator('h1',{hasText:'Review of 20'}).count()===1,'year review');await pg.screenshot({path:'v3-review-year.png',fullPage:true});
 await pg.locator('.nav button[title="Loans"]').click();ok(await pg.locator('.card',{hasText:'Debt payoff planner'}).locator('tbody tr').count()===2,'payoff planner');await pg.screenshot({path:'v3-loans.png',fullPage:true});
 await pg.evaluate(()=>App.go('settings',{stab:'activity'}));ok(await pg.locator('.card',{hasText:'Activity'}).locator('.row').count()>=8&&await pg.locator('.nav .subitems button').count()===6,'activity log is its own settings section');await pg.screenshot({path:'v3-settings.png',fullPage:true});
 ok(await pg.evaluate(()=>typeof PlanStore==='function'&&Store instanceof PlanStore&&typeof Actions.save==='function'),'data layer is separate from the page');
 // ---- v4 features
 await pg.evaluate(()=>{Store.db.autosave=false;Store.save();App.go('months',{month:null,mview:'list'})});
 // ticking a box must never open the row
 const rentCk=pg.locator('.row',{hasText:'Rent'}).first().locator('.ck');const cb=await rentCk.boundingBox();await pg.mouse.click(cb.x+2,cb.y+2);
 ok(await pg.locator('dialog[open]').count()===0&&await pg.evaluate(()=>Object.values(Store.plan.paid[M.key(curK())]||{}).length>=1),'clicking near a tick box ticks it and opens nothing');
 const end0=await pg.evaluate(()=>Store.proj.summary.end);await pg.getByRole('button',{name:'Tick all as paid'}).click();
 ok(await pg.evaluate(()=>monthAt(curK()).entries.filter(e=>e.group!=='adjust').every(e=>e.paid))&&await pg.getByRole('button',{name:'Untick all'}).count()===1,'tick all');
 ok(await pg.evaluate(()=>monthAt(curK()).entries.filter(e=>e.budget).every(e=>e.budget.done)),'budgets can be ticked as done');
 await pg.getByRole('button',{name:'Untick all'}).click();ok(Math.abs(await pg.evaluate(()=>Store.proj.summary.end)-end0)<0.01,'ticks alone never change the totals');
 // what I have today: balances, what is already paid, what is left in budgets
 await pg.getByRole('button',{name:'Enter what I really have'}).click();const bi=pg.locator('dialog label.fld',{hasText:'Main account'}).locator('input');await bi.fill('');await bi.pressSequentially('500');
 const nLines=await pg.locator('dialog .recon .row').count();ok(nLines>=1&&await pg.locator('dialog label.fld',{hasText:'Groceries'}).count()===1,'reconcile lists unpaid lines and budgets: '+nLines);
 await pg.locator('dialog .recon .row',{hasText:'Streaming'}).locator('input').check();const gl=pg.locator('dialog label.fld',{hasText:'Groceries'}).locator('input');await gl.fill('');await gl.pressSequentially('50');
 await pg.screenshot({path:'v5-reconcile.png'});await pg.locator('dialog').getByRole('button',{name:'Save'}).click();
 ok(await pg.evaluate(()=>{const m=monthAt(curK()),rent=m.entries.find(e=>e.label==='Streaming'),g=m.entries.find(e=>e.label==='Groceries');return m.fix&&m.now===540&&rent.paid&&rent.still===0&&g.budget.left===50&&g.still===-50&&Math.abs(m.now+m.todo-m.close)<0.01&&Store.plan.accounts[0].balance===500&&monthAt(curK()+1).open===m.close}),'check against reality: have-now is the real money, paid lines are ticked, budget money that is gone is logged');
 ok(await pg.locator('.note',{hasText:'Checked on'}).count()>=1&&await pg.locator('.flow',{hasText:'You have now'}).count()===1,'check explained in words');await pg.screenshot({path:'v5-month.png',fullPage:true});
 // pay something with the credit card: no cash leaves, the card owes more
 await pg.evaluate(()=>App.go('months',{month:curK()+1}));const c0=await pg.evaluate(()=>({close:monthAt(curK()+1).close,debt:monthAt(curK()+1).cardDebt}));await pg.locator('.row.click',{hasText:'Internet'}).first().click();await pg.locator('dialog select').first().selectOption({label:'Yes, from Credit card'});await pg.locator('dialog').getByRole('button',{name:'Save'}).click();
 ok(await pg.evaluate(c0=>{const m=monthAt(curK()+1),e=m.entries.find(e=>e.label==='Internet');return e.onCard&&e.amount===0&&e.charged===35&&Math.abs(m.close-(c0.close+35))<0.01&&m.cardDebt===c0.debt+35},c0)&&await pg.locator('.row',{hasText:'Internet'}).locator('.chip',{hasText:'on Credit card'}).count()===1,'paid with the credit card: cash stays, card debt grows');
 await pg.evaluate(()=>App.go('months',{month:null}));
 await pg.locator('.nav button[title="Accounts"]').click();ok(await pg.locator('.kpi').count()===3&&await pg.locator('.srow').count()===3,'accounts page');await pg.screenshot({path:'v4-accounts.png',fullPage:true});
 // validation
 await pg.locator('.nav button[title="Purchase log"]').click();await pg.getByRole('button',{name:'Add to the log'}).first().click();await pg.getByPlaceholder('Water, trousers, concert tickets…').fill('No amount');await pg.locator('dialog').getByRole('button',{name:'Save'}).click();
 ok(await pg.locator('dialog[open] .form-err',{hasText:'Enter an amount above zero'}).count()===1&&await pg.evaluate(()=>!Store.plan.items.some(i=>i.name==='No amount')),'a purchase without an amount is refused');await pg.screenshot({path:'v4-validation.png'});
 await pg.locator('dialog textarea').fill('<img src=x onerror=alert(1)> see https://example.com/x');await pg.locator('dialog input[inputmode=decimal]').first().pressSequentially('9');await pg.locator('dialog').getByRole('button',{name:'Save'}).click();
 ok(await pg.evaluate(()=>Store.plan.items.some(i=>i.name==='No amount'&&i.note.includes('<img'))&&!document.querySelector('main img')),'notes are stored as text and never run');
 // bill types and a note with info icon
 await pg.locator('.nav button[title="Income and bills"]').click();await pg.getByRole('button',{name:'Add a bill'}).first().click();await pg.getByPlaceholder('Rent, groceries, phone…').fill('Cigars');await pg.locator('dialog .seg button',{hasText:'Up to'}).click();await pg.locator('dialog input[inputmode=decimal]').first().pressSequentially('150');await pg.locator('dialog textarea').fill('Mum buys these, about 5 a pack');await pg.screenshot({path:'v4-bill.png'});await pg.locator('dialog').getByRole('button',{name:'Save'}).click();
 ok(await pg.evaluate(()=>{const b=Store.plan.bills.find(b=>b.name==='Cigars');return b.budget&&b.note.startsWith('Mum')&&monthAt(curK()).entries.some(e=>e.budget&&e.label==='Cigars')}),'any bill can be a budget, with a note');
 await pg.locator('.srow',{hasText:'Cigars'}).locator('.tipbtn').click();ok(await pg.locator('.tipbox',{hasText:'Mum buys these'}).count()===1,'info pop-up');await pg.keyboard.press('Escape');
 // trips: dates, someday idea with advice, equal cards
 await pg.locator('.nav button[title="Trips and events"]').click();
 ok(await pg.locator('.tcard',{hasText:'Iceland'}).locator('.chip',{hasText:'idea'}).count()===1,'someday idea shown');
 const hs=await pg.locator('.tgrid .tcard').evaluateAll(c=>{const top=c[0].getBoundingClientRect().top;return c.filter(x=>x.getBoundingClientRect().top===top).map(x=>Math.round(x.getBoundingClientRect().height))});ok(hs.length>=2&&Math.max(...hs)-Math.min(...hs)<=1,'trip cards in a row have the same height: '+hs.join(','));
 await pg.evaluate(()=>{Object.keys(Store.plan.fixes).forEach(k=>Actions.clearFix(k));Actions.settings(Store.plan.name,{opening:60000})});
 await pg.evaluate(()=>Actions.save('trips',{id:'cheapidea1',name:'Picnic',kind:'idea',month:M.key(curK()),items:[{id:'cheapitem1',name:'Food',amount:20}]}));
 await pg.locator('.tcard',{hasText:'Picnic'}).getByRole('button',{name:/Plan it for/}).click();ok(await pg.evaluate(()=>{const t=Store.plan.trips.find(t=>t.id==='cheapidea1');return t.kind==='trip'&&t.on}),'an idea can be planned for the suggested month');
 await pg.locator('.tcard',{hasText:'Picnic'}).getByRole('button',{name:'Edit'}).click();await pg.locator('dialog .fld',{hasText:'First day'}).locator('.mbtn').click();await pg.locator('.dpop-g button').nth(9).click();await pg.locator('dialog .fld',{hasText:'Last day'}).locator('.mbtn').click();await pg.locator('.dpop-g button').nth(12).click();
 await pg.locator('dialog .titem').first().getByRole('button',{name:'Details and links'}).click();await pg.locator('dialog .tnote').first().fill('Karting 15 min https://example.com/kart');await pg.screenshot({path:'v4-tripmodal.png'});await pg.locator('dialog').getByRole('button',{name:'Save'}).click();
 ok(await pg.evaluate(()=>{const t=Store.plan.trips.find(t=>t.id==='cheapidea1');return !!t.from&&!!t.to&&t.items[0].note.includes('Karting')&&t.month===M.key(Period.of(Store.plan.settings,D.parse(t.from)))}),'trip dates, and details with a link on a cost');
 await pg.locator('.tcard',{hasText:'Picnic'}).locator('summary').click();await pg.waitForTimeout(150);ok(await pg.locator('.tcard',{hasText:'Picnic'}).locator('a[href="https://example.com/kart"][rel~=noopener]').count()===1&&await pg.locator('.tcard',{hasText:'Picnic'}).locator('p',{hasText:/4 days/}).count()===1,'link is clickable and safe, dates shown');
 await pg.screenshot({path:'v4-trips.png',fullPage:true});await pg.getByRole('button',{name:'List',exact:true}).click();ok(await pg.locator('main table tbody tr').count()>=3,'trip list view');await pg.screenshot({path:'v4-trips-list.png'});await pg.getByRole('button',{name:'Cards',exact:true}).click();
 // wishlist with no date
 await pg.locator('.nav button[title="Wishlist"]').click();ok(await pg.locator('.card',{hasText:'Watch'}).locator('.chip',{hasText:'no date yet'}).count()===1&&await pg.locator('.card',{hasText:'Watch'}).locator('.rows .row').count()===3,'wish without a date gets advice');await pg.screenshot({path:'v4-wishlist.png',fullPage:true});
 await pg.locator('.card',{hasText:'Watch'}).locator('.row',{hasText:'Pay in one go'}).getByRole('button',{name:'Plan it'}).click();ok(await pg.evaluate(()=>{const w=Store.plan.wishes.find(w=>w.name==='Watch');return !w.flex&&w.on&&Store.proj.summary.negN===0|| !w.flex&&w.on}),'plan it sets the month and switches it on');
 await pg.evaluate(()=>{const r=normPlan({wishes:[{name:'x',price:1,link:'javascript:alert(1)'}]});if(r.wishes[0].link!=='')throw new Error('unsafe link kept')});
 // tools and review picker
 await pg.locator('.nav button[title="Tools"]').click();ok(await pg.locator('.nav .subitems button').count()===7,'tools are sub-sections of the menu');await pg.locator('label.fld',{hasText:'Price'}).locator('input').pressSequentially('150');ok(await pg.locator('.preview',{hasText:/costs you \d+ h \d+ min of work/}).count()===1,'hours of work tool');
 await pg.locator('.subnav button',{hasText:'When can I afford it?'}).click();await pg.locator('label.fld',{hasText:'Amount'}).locator('input').pressSequentially('50');ok(await pg.locator('.card',{hasText:'When can I afford it?'}).locator('.note').count()===1,'when can I afford it tool');await pg.locator('.subnav button',{hasText:'Savings growth'}).click();await pg.locator('label.fld',{hasText:'Add each month'}).locator('input').pressSequentially('100');await pg.locator('label.fld',{hasText:'Years'}).locator('input').pressSequentially('2');ok(await pg.locator('.preview',{hasText:/you would have/}).count()===1,'savings growth tool');await pg.screenshot({path:'v4-tools.png',fullPage:true});
 await pg.locator('.nav button[title="Review"]').click();ok(await pg.locator('.head select').count()===1,'review any year you pick');await pg.getByRole('button',{name:'Month',exact:true}).click();await pg.locator('.head .mbtn').click();await pg.locator('.mpop-h button').last().click();await pg.locator('.mpop-g button').nth(2).click();ok(await pg.locator('h1',{hasText:/Review of March/}).count()===1,'review any month you pick');
 // persistence across reload
 const snap=await pg.evaluate(()=>JSON.stringify(Store.plan));await pg.reload();
 ok(await pg.evaluate(()=>JSON.stringify(Store.plan))===snap,'state survives reload');
 // export encrypted -> wipe -> import
 await pg.evaluate(()=>App.go('settings',{stab:'backup'}));await pg.getByRole('button',{name:'Export backup'}).click();
 await pg.locator('dialog input[type=password]').first().fill('correct horse');await pg.locator('dialog input[type=password]').nth(1).fill('correct horse');
 const [dl]=await Promise.all([pg.waitForEvent('download'),pg.getByRole('button',{name:'Download'}).click()]);await dl.saveAs(FIX+'enc.json');
 const enc=fs.readFileSync(FIX+'enc.json','utf8');ok(enc.includes('"encrypted"')&&!enc.includes('Rome')&&!enc.includes('Rent'),'encrypted export hides data');
 for(const [file,pw,label] of [[FIX+'enc.json','correct horse','encrypted import'],[FIX+'real3.json',null,'real backup import']]){
  const n0=await pg.evaluate(()=>Object.keys(Store.db.plans).length);
  const [fc]=await Promise.all([pg.waitForEvent('filechooser'),pg.getByRole('button',{name:'Import backup'}).click()]);await fc.setFiles(file);
  if(pw){await pg.locator('dialog input[type=password]').fill('wrong pass');await pg.getByRole('button',{name:'Open',exact:true}).click();await pg.waitForTimeout(900);
   ok(await pg.evaluate(()=>Object.keys(Store.db.plans).length)===n0,'wrong password rejected');
   const [fc2]=await Promise.all([pg.waitForEvent('filechooser'),pg.getByRole('button',{name:'Import backup'}).click()]);await fc2.setFiles(file);
   await pg.locator('dialog input[type=password]').fill(pw);await pg.getByRole('button',{name:'Open',exact:true}).click();}
  await pg.waitForFunction(n=>Object.keys(Store.db.plans).length===n+1,n0,{timeout:8000});ok(true,label);}
 ok(await pg.evaluate(()=>Store.plan.trips.length===6&&Store.proj.months[0].close===-1085&&Store.plan.name==='My plan'&&Store.plan.accounts.find(a=>a.type==='credit').limit===1400&&Store.plan.accounts.find(a=>a.type==='credit').owed===1273),'real backup numbers are right after import');
 await pg.locator('.nav button[title="Overview"]').click();await pg.waitForTimeout(3500);await pg.screenshot({path:'s6-alpha-overview.png',fullPage:true});
 ok(await pg.evaluate(()=>{const m=Store.proj.months[0];return Store.plan.settings.payFor==='next'&&D.key(m.start)==='2026-10-26'&&D.key(m.end)==='2026-11-25'&&curK()===M.parse('2026-11')}),'November runs 26 Oct to 25 Nov and is the current month');
 await pg.locator('.nav button[title="Trips and events"]').click();await pg.screenshot({path:'v3-real-trips.png',fullPage:true});await pg.locator('.nav button[title="Overview"]').click();await pg.screenshot({path:'v3-real-overview.png',fullPage:true});
 await pg.evaluate(()=>App.go('months',{month:null,mview:'days'}));await pg.screenshot({path:'v2-alpha-days.png',fullPage:true});await pg.evaluate(()=>{UI.mview='list'});
 // bad import
 fs.writeFileSync(FIX+'bad.json','{"app":"other"}');await pg.evaluate(()=>App.go('settings',{stab:'backup'}));
 const [fc3]=await Promise.all([pg.waitForEvent('filechooser'),pg.getByRole('button',{name:'Import backup'}).click()]);await fc3.setFiles(FIX+'bad.json');
 await pg.waitForTimeout(200);ok(await pg.locator('.toast',{hasText:'not made by'}).count()===1,'foreign file rejected');
 // corrupted storage recovers
 await pg.evaluate(()=>localStorage.setItem('runway.db.v1','{"plans":{"x":{"bills":"<script>","settings":{"horizon":"NaN"}}},"active":"zzz"}'));await pg.reload();
 ok(await pg.locator('.kpi').count()>=3,'corrupted storage still loads');
 await pg.evaluate(()=>localStorage.setItem('runway.db.v1','not json'));await pg.reload();ok(await pg.locator('.welcome').count()===1,'garbage storage -> welcome');
 await pg.evaluate(()=>localStorage.setItem('runway.db.v1',JSON.stringify({v:1,active:'oldplan1',theme:'light',plans:{oldplan1:{id:'oldplan1',name:'Old',settings:{currency:'EUR',locale:'en-GB',startMonth:'2026-11',horizon:12,opening:100,cushion:0,cents:false},incomes:[{id:'inc00001',name:'Salary',amount:1000,cat:'salary',every:1,from:null,to:null}],bills:[{id:'bil00001',name:'Rent',amount:400,cat:'housing',every:1,from:null,to:null,untilLoan:null}],items:[{id:'itm00001',name:'X',amount:50,kind:'out',month:'2026-12',cat:'other'}],trips:[{id:'trp00001',name:'T',month:'2027-01',on:true,items:[{id:'tit00001',name:'F',amount:100,pay:'2026-12'}]}],loans:[],goals:[],overrides:{},paid:{},actuals:{},notes:{}}}})));await pg.reload();
 ok(await pg.evaluate(()=>Store.plan.name==='Old'&&Store.proj.summary.end===100+12*600-50-100&&Store.plan.settings.numFmt==='us'&&Store.plan.settings.payDay===0),'version 1 data still loads with the same numbers');
 await pg.evaluate(()=>{localStorage.clear()});await pg.reload();
 // ---- v5: languages, main account, date range, grouped menu
 await pg.getByText('Look around with a sample plan').click();
 ok(await pg.locator('.navh').count()===3&&await pg.locator('.nav .navi').count()===14,'menu is grouped');
 await pg.evaluate(()=>App.go('settings',{stab:'language'}));
 const [ld]=await Promise.all([pg.waitForEvent('download'),pg.locator('.row',{hasText:'English'}).getByRole('button',{name:'Export'}).click()]);await ld.saveAs(FIX+'lang-en.json');
 const en=JSON.parse(fs.readFileSync(FIX+'lang-en.json','utf8'));ok(en.kind==='language'&&Object.keys(en.strings).length>1000&&en.strings['Overview']==='Overview'&&en.strings['#month:other']==='months','English language file has every text: '+Object.keys(en.strings).length);
 en.code='es';en.name='Español';en.flag='es';en.strings['Overview']='Resumen';en.strings['Month planner']='Planificador mensual';en.strings['#month:one']='mes';en.strings['#month:other']='meses';en.strings['average over {0} months']='media de {0} meses';en.strings['Settings']='<b>Ajustes</b>';fs.writeFileSync(FIX+'lang-es.json',JSON.stringify(en));
 const [lf]=await Promise.all([pg.waitForEvent('filechooser'),pg.getByRole('button',{name:'Import a language file'}).click()]);await lf.setFiles(FIX+'lang-es.json');
 await pg.locator('.row',{hasText:'Español'}).getByRole('button',{name:'Use'}).click();await pg.waitForLoadState('load');await pg.waitForSelector('.nav .navi');
 ok(await pg.locator('.nav .navi',{hasText:'Resumen'}).count()===1&&await pg.locator('h1',{hasText:'Resumen'}).count()===1&&await pg.locator('.kpi .s',{hasText:/media de \d+ meses/}).count()===1,'imported language is used, with values in place');
 ok(await pg.locator('.nav .navi',{hasText:'<b>Ajustes</b>'}).count()===1&&await pg.locator('.nav b').count()===0,'translations are shown as text, never as markup');
 ok(await pg.locator('.kpi .l',{hasText:/nov\.? 2026|nov/i}).count()>=1,'dates follow the language');
 ok(await pg.locator('.langbtn').count()===1,'language picker appears in the menu');await pg.screenshot({path:'v5-spanish.png'});
 await pg.locator('.langbtn').click();await pg.screenshot({path:'v5-langpicker.png'});await pg.locator('.mpop.menu button',{hasText:'English'}).click();await pg.waitForLoadState('load');await pg.waitForSelector('.nav .navi');
 ok(await pg.locator('.nav .navi',{hasText:'Overview'}).count()===1,'back to English');
 fs.writeFileSync(FIX+'lang-bad.json',JSON.stringify({app:'runway',kind:'language',code:'en',strings:{}}));await pg.evaluate(()=>App.go('settings',{stab:'language'}));
 const [lb]=await Promise.all([pg.waitForEvent('filechooser'),pg.getByRole('button',{name:'Import a language file'}).click()]);await lb.setFiles(FIX+'lang-bad.json');await pg.waitForTimeout(200);ok(await pg.locator('.toast.bad').count()>=1,'a file that claims to be English is refused');
 // credit card: enter the limit and what is still available; what is owed is worked out
 await pg.locator('.nav .navi[title="Accounts"]').click();await pg.locator('.srow',{hasText:'Credit card'}).click();const lim=pg.locator('dialog label.fld',{hasText:'Card limit'}).locator('input'),av=pg.locator('dialog label.fld',{hasText:'Still available'}).locator('input');
 await lim.fill('');await lim.pressSequentially('1400');await av.fill('');await av.pressSequentially('127');ok(await pg.locator('dialog .preview',{hasText:'You owe €1,273'}).count()===1&&await pg.locator('dialog label.fld',{hasText:'Owed'}).count()===0,'what you owe is shown, not asked');await pg.screenshot({path:'v5-card.png'});
 await pg.locator('dialog').getByRole('button',{name:'Save'}).click();ok(await pg.evaluate(()=>{const c=Store.plan.accounts.find(a=>a.type==='credit');return c.limit===1400&&c.owed===1273}),'card saved as limit and available');
 // main account, and the last-day picker starting at the first day
 await pg.locator('.nav .navi[title="Accounts"]').click();await pg.locator('.srow',{hasText:'Wallet'}).click({button:'right'});await pg.locator('.mpop.menu button',{hasText:'Make it the main account'}).click();
 ok(await pg.evaluate(()=>Store.plan.accounts.find(a=>a.main).name==='Wallet'&&Store.plan.accounts.filter(a=>a.main).length===1),'main account can be changed');
 await pg.locator('.nav .navi[title="Income and bills"]').click();await pg.getByRole('button',{name:'Add a bill'}).first().click();ok(await pg.locator('dialog label.fld',{hasText:'Paid from'}).locator('select').evaluate(e=>e.selectedOptions[0].textContent)==='Wallet'&&await pg.locator('dialog label.fld',{hasText:'Paid off by a loan?'}).count()===0,'new bills use the main account; the loan question only shows for debts');await pg.keyboard.press('Escape');
 await pg.locator('.nav .navi[title="Trips and events"]').click();await pg.getByRole('button',{name:'Plan a trip'}).first().click();await pg.locator('dialog .fld',{hasText:'First day'}).locator('.mbtn').click();for(let i=0;i<4;i++)await pg.locator('.mpop-h button').last().click();await pg.locator('.dpop-g button').nth(22).click();
 await pg.locator('dialog .fld',{hasText:'Last day'}).locator('.mbtn').click();const head=await pg.locator('.mpop-h span').textContent();ok(/March 2027/.test(head)&&await pg.locator('.dpop-g button').nth(10).isDisabled()&&!(await pg.locator('.dpop-g button').nth(24).isDisabled()),'last-day picker opens on the first day’s month and blocks earlier days: '+head);await pg.screenshot({path:'v5-daterange.png'});
 await pg.keyboard.press('Escape');await pg.locator('dialog').getByRole('button',{name:'Cancel'}).click();
 await pg.locator('.nav .navi[title="Overview"]').click();await pg.screenshot({path:'v5-menu.png'});
 await pg.evaluate(()=>{localStorage.clear()});await pg.reload();
 // dark + mobile
 await pg.getByText('Look around with a sample plan').click();await pg.evaluate(()=>{Store.db.theme='dark';App.render()});await pg.screenshot({path:'s7-dark.png',fullPage:true});
 await pg.setViewportSize({width:390,height:800});await pg.screenshot({path:'s8-mobile.png'});
 await pg.waitForTimeout(350);ok(await pg.locator('.side').evaluate(e=>e.getBoundingClientRect().right<=0),'menu is hidden on a phone');await pg.getByRole('button',{name:'Open menu'}).click();await pg.waitForTimeout(300);ok(await pg.locator('.side').evaluate(e=>e.getBoundingClientRect().left===0),'hamburger opens the menu');await pg.screenshot({path:'v4-mobile-menu.png'});await pg.locator('.nav button[title="Month planner"]').click();await pg.waitForTimeout(300);ok(await pg.evaluate(()=>!document.body.classList.contains('nav-open')&&UI.view==='months'),'choosing a page closes the menu');await pg.screenshot({path:'s9-mobile-month.png'});
 const sl=await pg.locator('.strip').evaluate(e=>{e.scrollLeft=200;return e.scrollLeft});ok(sl>0,'month strip scrolls sideways');
 ok(await pg.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),'no horizontal overflow on mobile');
 console.log(errs.length?errs.join('\n'):'NO ERRORS');await b.close();process.exit(errs.length?1:0);
})().catch(e=>{console.error('CRASH',e);process.exit(2)});
