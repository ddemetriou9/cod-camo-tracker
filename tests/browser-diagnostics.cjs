const {chromium}=require('playwright');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../web'),fixture=process.argv[2];
const overviewMode=true,weapon=overviewMode?'Han 86':'PILA',total=overviewMode?11:6,clearedTotal=overviewMode?3:0;
if(!fixture)throw Error('Usage: node tests/browser-lifecycle.cjs <military-reward.png>');
const server=http.createServer((req,res)=>{
 const name=new URL(req.url,'http://localhost').pathname;
 const file=name==='/fixture'?fixture:path.resolve(root,'.'+(name==='/'?'/index.html':name));
 if(file!==fixture&&!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
 fs.readFile(file,(e,data)=>{if(e){res.writeHead(404).end();return;}res.setHeader('Content-Type',({'.js':'text/javascript','.wasm':'application/wasm','.html':'text/html','.css':'text/css','.png':'image/png'})[path.extname(file)]||'application/octet-stream');res.end(data);});
});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXE?{executablePath:process.env.BROWSER_EXE}:{})});
 try{
  const context=await browser.newContext(),page=await context.newPage(),errors=[],requests=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);await page.waitForLoadState('networkidle');
  await page.evaluate(async()=>{
   const image=new Image();image.src='/fixture';await image.decode();
   const canvas=document.createElement('canvas');canvas.width=1920;canvas.height=Math.round(image.height*1920/image.width);
   const ctx=canvas.getContext('2d');ctx.fillStyle='black';ctx.fillRect(0,0,canvas.width,canvas.height);
   window.mockCapture={canvas,options:null,stream:null,showReward:()=>ctx.drawImage(image,220,90,1500,Math.round(image.height*1500/image.width))};
   navigator.mediaDevices.getDisplayMedia=async options=>{mockCapture.options=options;mockCapture.stream=canvas.captureStream(1);window.mockFrameTimer=setInterval(()=>{ctx.fillStyle='black';ctx.fillRect(0,0,1,1);mockCapture.stream.getVideoTracks()[0]?.requestFrame();},500);return mockCapture.stream;};
  });
  await page.locator('#automation').click();
  assert.equal(await page.locator('#browser-copy-report').count(),1,'Diagnostic report must be available without chasing live text');
  await page.locator('#browser-start').click();
  try{await page.waitForFunction(()=>document.querySelector('#browser-status').textContent.includes('OCR idle'),null,{timeout:30000});}catch(error){console.log(await page.evaluate(()=>({status:document.querySelector('#browser-status').textContent,options:mockCapture.options,video:[...document.querySelectorAll('video')].map(v=>({ready:v.readyState,width:v.videoWidth,paused:v.paused}))})));throw error;}
  assert.match(await page.locator('#browser-stats').textContent(),/0 OCR reads/,'Normal play should only use the small colour probe');
  await page.waitForFunction(()=>document.querySelector('#browser-stats').textContent.includes('OCR asleep'),null,{timeout:20000});
  assert.match(await page.locator('#browser-stats').textContent(),/0 OCR reads/);
  assert.equal(await page.evaluate(()=>mockCapture.options.audio),false);assert.equal(await page.evaluate(()=>mockCapture.options.video.frameRate.max),1);
  await page.locator('#browser-scan').click();
  await page.waitForFunction(()=>document.querySelector('#browser-screen-scan').textContent.includes('Could not read the Camo Select title.'),null,{timeout:20000});
  await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.copiedReport=text;}}}));
  await page.locator('#browser-copy-report').click();
  await page.waitForFunction(()=>window.copiedReport);
  const copied=await page.evaluate(()=>JSON.parse(copiedReport));
  assert(copied.timing.largestScanGapMs>=copied.timing.lastScanGapMs);assert(copied.timing.longGaps.length<=8);
  assert.match(copied.lastRejected.wide.reason,/Camo Select title/);
  assert.equal(copied.snapshot.width,1920);assert.equal(copied.environment.audioTracks,0);
  assert.equal(copied.environment.video.readyState>=2,true);assert.equal(copied.events.some(e=>e.type==='probe'),true);
  const frozenReport=await page.locator('#browser-report-text').inputValue();
  const failedScan=await page.locator('#browser-screen-scan').textContent();
  await page.waitForTimeout(2200);
  assert.equal(await page.locator('#browser-screen-scan').textContent(),failedScan,'Routine checks must preserve the failed screen scan');
  assert.equal(await page.locator('#browser-report-text').inputValue(),frozenReport,'Report snapshot must stay frozen while tracking continues');
  assert.equal(await page.evaluate(()=>TrackerTest.count('Han 86')),0);
  await page.evaluate(()=>mockCapture.showReward());await page.waitForTimeout(1800);
  assert.equal(await page.evaluate(()=>TrackerTest.count('Han 86')),0,'The offset fixture deliberately misses the normal layout gate');
  assert.equal(await page.locator('#browser-diagnostics').evaluate(el=>el.open),true,'Scan must reveal its diagnostic report automatically');
  await page.waitForFunction(()=>document.querySelector('#browser-capture-info').textContent.includes('1920'));
  assert(await page.evaluate(()=>{const c=document.querySelector('#browser-preview'),p=c.getContext('2d').getImageData(0,0,c.width,c.height).data;return p.some((v,i)=>i%4!==3&&v>50);}), 'Preview must show actual shared pixels');
  await page.locator('#browser-scan').click();
  await page.waitForFunction(({weapon,total})=>TrackerTest.count(weapon)===total,{weapon,total},{timeout:20000});
  assert.match(await page.locator('#browser-screen-scan').textContent(),/Han 86 overview saved/);
  assert.match(await page.locator('#browser-recent').textContent(),overviewMode?/Han 86.*Overview/:/PILA.*Military 6/);
  if(overviewMode){assert.equal(await page.evaluate(()=>state.categoryTotals['HAN 86|COMPLETIONIST'].current),1);assert.equal(await page.evaluate(()=>done('Han 86',11)),false,'Partial completionist counts must not guess a Gold unlock');}
  await page.locator('#info-dialog .close-dialog').click();await page.locator('#search').fill(weapon);
  await page.locator('[data-manual-camo="'+(overviewMode?'HAN86':'PILA')+':0"]').click();assert.equal(await page.evaluate(weapon=>TrackerTest.count(weapon),weapon),clearedTotal);
  await page.locator('#automation').click();
  // Let the same reward remain visible across more than two scheduling turns.
  await page.waitForTimeout(2600);assert.equal(await page.evaluate(weapon=>TrackerTest.count(weapon),weapon),clearedTotal,'Identical reading must preserve a manual correction');
  await page.evaluate(()=>{window.restoreReceiptStorage=Storage.prototype.setItem;Storage.prototype.setItem=function(){throw new DOMException('Storage full','QuotaExceededError');};});
  await page.locator('#browser-scan').click();await page.waitForFunction(()=>document.querySelector('#browser-status').textContent.includes('could not be saved'),null,{timeout:15000});
  assert.equal(await page.evaluate(()=>TrackerTest.count('Han 86')),3,'A failed rescan must not claim success using the old applied receipt');
  await page.evaluate(()=>Storage.prototype.setItem=restoreReceiptStorage);
  await page.locator('#browser-scan').click();
  await page.waitForFunction(()=>TrackerTest.count('Han 86')===11,null,{timeout:15000});
  assert.equal(await page.evaluate(()=>TrackerTest.count('Han 86')),11,'Explicit rescan must reapply visible Military unlocks despite an old receipt');
  // Force a storage failure, then retry, without allowing a false saved status.
  await page.evaluate(()=>{TrackerTest.commit(()=>{state.checks={};state.categoryTotals={};state.autoApplied={};});window.originalSetItem=Storage.prototype.setItem;Storage.prototype.setItem=function(){throw new DOMException('Storage full','QuotaExceededError');};});
  await page.locator('#browser-scan').click();await page.waitForFunction(()=>document.querySelector('#browser-status').textContent.includes('could not be saved'),null,{timeout:15000});
  assert.equal(await page.evaluate(()=>TrackerTest.count('Han 86')),0);
  await page.evaluate(()=>Storage.prototype.setItem=originalSetItem);
  await page.locator('#browser-scan').click();await page.waitForFunction(()=>TrackerTest.count('Han 86')===11,null,{timeout:15000});
  await page.locator('#browser-stop').click();
  await page.evaluate(()=>navigator.clipboard.writeText=async()=>{throw new DOMException('Blocked','NotAllowedError');});
  await page.locator('#browser-copy-report').click();
  await page.waitForFunction(()=>document.querySelector('#browser-report-message').textContent.includes('Ctrl+C'));
  assert.equal(await page.locator('#browser-report-text').evaluate(el=>el.selectionEnd-el.selectionStart), (await page.locator('#browser-report-text').inputValue()).length);
  const stoppedReport=JSON.parse(await page.locator('#browser-report-text').inputValue());assert.equal(stoppedReport.snapshot.running,false);assert.equal(stoppedReport.lastFrameSample.width,1920);assert.match(stoppedReport.lastRejected.wide.reason,/Camo Select title/);
  assert.equal(stoppedReport.events.some(e=>e.type==='apply'),true);assert(!JSON.stringify(stoppedReport).includes('data:image'));
  const bounded=await page.evaluate(()=>{const engine=BrowserCamoCapture.create({catalog,onReward:()=>{},onStatus:()=>{}});for(let i=0;i<150;i++)engine.stop('bounded '+i);return JSON.parse(engine.getDiagnosticReport());});
  assert.equal(bounded.events.length,80);assert(!Object.hasOwn(bounded,'checks'));
  assert(await page.evaluate(()=>{const c=document.querySelector('#browser-preview');return c.getContext('2d').getImageData(0,0,c.width,c.height).data.every(v=>v===0);}), 'Stop must clear preview pixels');
  assert.equal(await page.evaluate(()=>mockCapture.stream.getTracks().every(t=>t.readyState==='ended')),true);
  const stats=await page.locator('#browser-stats').textContent();await page.waitForTimeout(2200);assert.equal(await page.locator('#browser-stats').textContent(),stats);
  await page.evaluate(()=>navigator.mediaDevices.getDisplayMedia=async()=>{throw new DOMException('cancelled','NotAllowedError');});
  await page.locator('#browser-start').click();await page.waitForFunction(()=>document.querySelector('#browser-status').textContent.includes('cancelled'));
  assert.equal(await page.locator('#browser-start').isEnabled(),true);
  await page.locator('#browser-copy-report').click();const freshReport=JSON.parse(await page.locator('#browser-report-text').inputValue());assert.deepEqual(freshReport.lastRejected,{});assert.equal(freshReport.lastFrameSample,null,'New session clears old capture evidence');
  // Stop while the browser sharing picker is still pending, then resolve it late.
  await page.evaluate(()=>{navigator.mediaDevices.getDisplayMedia=()=>new Promise(resolve=>window.resolvePicker=resolve);});
  await page.locator('#browser-start').click();await page.locator('#browser-stop').click();
  await page.evaluate(()=>{const stream=mockCapture.canvas.captureStream(1);window.lateStream=stream;resolvePicker(stream);});
  await page.waitForFunction(()=>lateStream.getTracks().every(t=>t.readyState==='ended'));
  assert.match(await page.locator('#browser-status').textContent(),/stopped/);
  await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  assert.deepEqual(errors,[]);assert(requests.every(r=>r.method()==='GET'&&new URL(r.url()).hostname==='127.0.0.1'));
  console.log('PASS: frozen one-click reports, clipboard denial fallback, bounded history, rejection/capture retention after Stop, clean new session; offset menu scan populates main page, local preview, storage failures reported honestly, retry succeeds, manual overrides preserved, preview clears and capture stops, cancelled/late picker cleanup, no uploads.');
 }finally{await browser.close();server.closeAllConnections();server.close();}
})().catch(e=>{console.error(e);server.closeAllConnections();server.close();process.exitCode=1;});
