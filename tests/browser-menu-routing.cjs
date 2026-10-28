const {chromium}=require('playwright');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../web'),fixture=process.argv[2];
const overviewMode=true,weapon=overviewMode?'Han 86':'PILA',total=overviewMode?11:6,clearedTotal=overviewMode?3:0;
if(!fixture)throw Error('Usage: node tests/browser-menu-routing.cjs <camo-overview.png>');
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
   window.mockCapture={canvas,options:null,stream:null,showReward:()=>{ctx.drawImage(image,220,90,1500,Math.round(image.height*1500/image.width));ctx.fillStyle='#e5c700';ctx.fillRect(50,70,80,20);}};
   navigator.mediaDevices.getDisplayMedia=async options=>{mockCapture.options=options;mockCapture.stream=canvas.captureStream(1);window.mockFrameTimer=setInterval(()=>{ctx.fillStyle='black';ctx.fillRect(0,0,1,1);mockCapture.stream.getVideoTracks()[0]?.requestFrame();},500);return mockCapture.stream;};
  });
  await page.locator('#automation').click();await page.locator('#browser-start').click();
  try{await page.waitForFunction(()=>document.querySelector('#browser-status').textContent.includes('OCR idle'),null,{timeout:30000});}catch(error){console.log(await page.evaluate(()=>({status:document.querySelector('#browser-status').textContent,options:mockCapture.options,video:[...document.querySelectorAll('video')].map(v=>({ready:v.readyState,width:v.videoWidth,paused:v.paused}))})));throw error;}
  assert.match(await page.locator('#browser-stats').textContent(),/0 OCR reads/,'Normal play should only use the small colour probe');
  await page.waitForFunction(()=>document.querySelector('#browser-stats').textContent.includes('OCR asleep'),null,{timeout:20000});
  assert.match(await page.locator('#browser-stats').textContent(),/0 OCR reads/);
  assert.equal(await page.evaluate(()=>mockCapture.options.audio),false);assert.equal(await page.evaluate(()=>mockCapture.options.video.frameRate.max),1);
  await page.evaluate(()=>mockCapture.showReward());await page.waitForTimeout(1800);
  await page.locator('#browser-diagnostics > summary').click();
  await page.waitForFunction(()=>document.querySelector('#browser-capture-info').textContent.includes('1920'));
  assert(await page.evaluate(()=>{const c=document.querySelector('#browser-preview'),p=c.getContext('2d').getImageData(0,0,c.width,c.height).data;return p.some((v,i)=>i%4!==3&&v>50);}), 'Preview must show actual shared pixels');
  await page.waitForFunction(({weapon,total})=>TrackerTest.count(weapon)===total,{weapon,total},{timeout:30000});
  assert.match(await page.locator('#browser-capture-info').textContent(),/located camo text/);
  assert.match(await page.locator('#browser-recent').textContent(),overviewMode?/Han 86.*Overview/:/PILA.*Military 6/);
  if(overviewMode){assert.equal(await page.evaluate(()=>state.categoryTotals['HAN 86|COMPLETIONIST'].current),1);assert.equal(await page.evaluate(()=>done('Han 86',11)),false,'Partial completionist counts must not guess a Gold unlock');}
  await page.locator('#browser-freeze-reading').click();const frozenText=await page.locator('#browser-last-reading').textContent();
  await page.evaluate(()=>{const ctx=mockCapture.canvas.getContext('2d');ctx.fillStyle='#deded4';ctx.fillRect(321,164,183,28);ctx.fillStyle='#171a17';ctx.font='bold 13px Arial';ctx.fillText('AXION PROGRESSION',330,183);});
  try{await page.waitForFunction(()=>TrackerTest.count('Axion')===11,null,{timeout:20000});}catch(error){console.log(await page.locator('#browser-last-reading').textContent());console.log(await page.locator('#browser-status').textContent());throw error;}
  assert.equal(await page.locator('#browser-last-reading').textContent(),frozenText,'Pause text must hold diagnostics while recognition continues');
  await page.locator('#browser-freeze-reading').click();assert.match(await page.locator('#browser-last-reading').textContent(),/AXION/i);
  assert.equal(await page.evaluate(()=>TrackerTest.count('PILA')),0,'Unseen weapons must stay unchanged');
  await page.evaluate(()=>mockCapture.showReward());
  await page.locator('#info-dialog .close-dialog').click();await page.locator('#search').fill(weapon);
  await page.locator('[data-manual-camo="'+(overviewMode?'HAN86':'PILA')+':0"]').click();assert.equal(await page.evaluate(weapon=>TrackerTest.count(weapon),weapon),clearedTotal);
  await page.locator('#automation').click();
  // Let the same reward remain visible across more than two scheduling turns.
  await page.waitForTimeout(2600);assert.equal(await page.evaluate(weapon=>TrackerTest.count(weapon),weapon),clearedTotal,'Identical reading must preserve a manual correction');
  // Force a storage failure, then retry, without allowing a false saved status.
  await page.evaluate(()=>{TrackerTest.commit(()=>{state.checks={};state.categoryTotals={};state.autoApplied={};});window.originalSetItem=Storage.prototype.setItem;Storage.prototype.setItem=function(){throw new DOMException('Storage full','QuotaExceededError');};});
  await page.locator('#browser-scan').click();await page.waitForFunction(()=>document.querySelector('#browser-status').textContent.includes('could not be saved'),null,{timeout:15000});
  assert.equal(await page.evaluate(()=>TrackerTest.count('Han 86')),0);
  await page.evaluate(()=>Storage.prototype.setItem=originalSetItem);
  await page.locator('#browser-scan').click();await page.waitForFunction(()=>TrackerTest.count('Han 86')===11,null,{timeout:15000});
  await page.locator('#browser-stop').click();
  assert(await page.evaluate(()=>{const c=document.querySelector('#browser-preview');return c.getContext('2d').getImageData(0,0,c.width,c.height).data.every(v=>v===0);}), 'Stop must clear preview pixels');
  assert.equal(await page.evaluate(()=>mockCapture.stream.getTracks().every(t=>t.readyState==='ended')),true);
  const stats=await page.locator('#browser-stats').textContent();await page.waitForTimeout(2200);assert.equal(await page.locator('#browser-stats').textContent(),stats);
  await page.evaluate(()=>navigator.mediaDevices.getDisplayMedia=async()=>{throw new DOMException('cancelled','NotAllowedError');});
  await page.locator('#browser-start').click();await page.waitForFunction(()=>document.querySelector('#browser-status').textContent.includes('cancelled'));
  assert.equal(await page.locator('#browser-start').isEnabled(),true);
  // Stop while the browser sharing picker is still pending, then resolve it late.
  await page.evaluate(()=>{navigator.mediaDevices.getDisplayMedia=()=>new Promise(resolve=>window.resolvePicker=resolve);});
  await page.locator('#browser-start').click();await page.locator('#browser-stop').click();
  await page.evaluate(()=>{const stream=mockCapture.canvas.captureStream(1);window.lateStream=stream;resolvePicker(stream);});
  await page.waitForFunction(()=>lateStream.getTracks().every(t=>t.readyState==='ended'));
  assert.match(await page.locator('#browser-status').textContent(),/stopped/);
  await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  assert.deepEqual(errors,[]);assert(requests.every(r=>r.method()==='GET'&&new URL(r.url()).hostname==='127.0.0.1'));
  console.log('PASS: false results candidate automatically routes to camo overview and populates main page, local preview, storage failures reported honestly, retry succeeds, manual overrides preserved, preview clears and capture stops, cancelled/late picker cleanup, no uploads.');
 }finally{await browser.close();server.closeAllConnections();server.close();}
})().catch(e=>{console.error(e);server.closeAllConnections();server.close();process.exitCode=1;});
