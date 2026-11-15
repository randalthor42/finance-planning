const {chromium}=require('playwright');const {spawn}=require('child_process');
(async()=>{const b=await chromium.launch();const errs=[];
let pg=await b.newPage();pg.on('pageerror',e=>errs.push('prod '+e.message));pg.on('console',m=>{if(m.type()==='error')errs.push('prod console '+m.text())});
await pg.goto('file:///home/claude/runway/dist/runway-money-planner.html');await pg.getByText('Look around with a sample plan').click();
console.log('prod: nav items',await pg.locator('.nav button').count(),'globals leaked:',await pg.evaluate(()=>typeof Store),'keys',await pg.evaluate(()=>document.documentElement.outerHTML.length));
for(const t of ['Month planner','Trips and events','Accounts','Settings'])await pg.locator(`.nav button[title="${t}"]`).click();
const dev=spawn('npx',['vite','--port','5199','--strictPort'],{cwd:'/home/claude/runway'});await new Promise(r=>setTimeout(r,2500));
pg=await b.newPage();pg.on('pageerror',e=>errs.push('dev '+e.message));await pg.goto('http://localhost:5199/');await pg.getByText('Look around with a sample plan').click();await pg.locator('.nav button[title="Month planner"]').click();
console.log('dev: cards',await pg.locator('.card').count());dev.kill();console.log(errs.length?errs:'no errors');await b.close()})();
