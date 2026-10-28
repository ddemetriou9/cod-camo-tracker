const {chromium}=require('playwright');
const http=require('http'),fs=require('fs'),path=require('path'),assert=require('assert');
const root=path.resolve(__dirname,'../web');
const server=http.createServer((req,res)=>{
 const relative=decodeURIComponent(new URL(req.url,'http://localhost').pathname).replace(/^\/cod-camo-tracker\/?/,'');
 const file=path.resolve(root,relative||'index.html');
 if(!file.startsWith(root+path.sep)&&file!==root){res.writeHead(403).end();return;}
 fs.readFile(file,(err,data)=>{if(err){res.writeHead(404).end();return;}res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.webp':'image/webp'})[path.extname(file)]||'application/octet-stream');res.end(data);});
});
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXE?{executablePath:process.env.BROWSER_EXE}:{})});
 try{
  const page=await browser.newPage(),errors=[],apiCalls=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.url().includes('/api/'))apiCalls.push(r.url());});
  await page.goto(`http://127.0.0.1:${server.address().port}/cod-camo-tracker/`);await page.waitForLoadState('networkidle');
  assert.equal(await page.locator('.weapon-card').count(),33);
  assert.equal(await page.evaluate(()=>window.NATIVE_MIGRATION),null);
  assert.equal(await page.evaluate(()=>Object.keys(TrackerTest.state.checks).length),0);
  await page.locator('#search').fill('Axion');
  await page.locator('[data-manual-camo="AXION:7"]').click();
  assert.equal(await page.evaluate(()=>TrackerTest.count('Axion')),8);
  await page.reload();assert.equal(await page.evaluate(()=>TrackerTest.count('Axion')),8);
  await page.locator('#search').fill('Axion');await page.locator('[data-camo-preview="AXION:8"]').hover();
  await page.locator('#camo-preview .preview-track').waitFor({state:'visible'});
  await page.locator('#camo-preview .preview-track').click();
  assert.equal(await page.evaluate(()=>TrackerTest.state.goals.filter(g=>g.tracked).length),1);
  const images=await page.evaluate(async()=>{const paths=[...new Set(window.CAMO_CATALOG.images.map(i=>i.path))];return Promise.all(paths.map(src=>new Promise(resolve=>{const i=new Image();i.onload=()=>resolve(true);i.onerror=()=>resolve(false);i.src=src;})));});
  assert(images.every(Boolean),'All reference graphics must resolve under the Pages subpath');
  await page.locator('#automation').click();assert.match(await page.locator('#info-body').textContent(),/Start tracking/);
  if(process.env.SCREENSHOT_PATH)await page.screenshot({path:process.env.SCREENSHOT_PATH});
  assert.deepEqual(apiCalls,[]);assert.deepEqual(errors,[]);
  await page.setViewportSize({width:390,height:844});await page.locator('#info-dialog .close-dialog').click();
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Mobile page must fit');
  console.log(JSON.stringify({weapons:33,militarySequentialAndPersistent:true,tooltipTracking:true,graphics:images.length,personalMigration:false,apiCalls:apiCalls.length,consoleErrors:errors,mobileFits:true}));
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});

