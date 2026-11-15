// Browser tests (Playwright). Run with: npm run test:ui
const FIX=require('path').join(__dirname,'../fixtures')+'/',PAGE='file://'+require('path').resolve(__dirname,'../../dist-test/index.html');require('fs').mkdirSync(__dirname+'/shots',{recursive:true});process.chdir(__dirname+'/shots');
const {chromium}=require('playwright');
(async()=>{const b=await chromium.launch();const ctx=await b.newContext({viewport:{width:1360,height:900}});const pg=await ctx.newPage();const errs=[];
pg.on('pageerror',e=>errs.push('PAGEERR '+e.message.slice(0,300)));pg.on('console',m=>{if(m.type()==='error')errs.push('CONSOLE '+m.text().slice(0,200))});
await pg.goto(PAGE);await pg.getByText('Look around with a sample plan').click();
const views=['overview','months','review','forecast','accounts','recurring','subs','items','trips','loans','goals','wishes','tools','settings'];
const visit=async tag=>{for(const v of views){await pg.evaluate(v=>App.go(v),v);await pg.waitForTimeout(40);const t=await pg.locator('h1').first().textContent().catch(()=>'NO H1');const bad=await pg.evaluate(()=>document.body.innerText.match(/undefined|NaN|\[object/g));const ov=await pg.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth);if(bad||ov>1)errs.push(`${tag} ${v}: bad=${bad} overflow=${ov}`);if(process.argv[2])await pg.screenshot({path:`sm-${tag}-${v}.png`,fullPage:tag==='d'});}
 for(const st of ['look','plans','backup','activity'])await pg.evaluate(st=>App.go('settings',{stab:st}),st);await pg.evaluate(()=>{UI.mview='days';App.go('months');UI.mview='list';UI.rview='year';App.go('review');UI.rview='month'});};
await visit('d');
// import the real backup
await pg.evaluate(async t=>{const r=await IO.read(t);Store.addPlan({...r.plans[0],id:null})},require('fs').readFileSync(FIX+'real3.json','utf8'));
await visit('r');
await pg.setViewportSize({width:390,height:800});await visit('m');
console.log(errs.length?errs.join('\n'):'SMOKE OK');await b.close()})();
