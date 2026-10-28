/* Lifecycle regression: a rejected candidate after a long idle must not restart OCR every scan. */
const {chromium}=require('playwright');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../web');
const server=http.createServer((req,res)=>{const name=new URL(req.url,'http://localhost').pathname,file=path.resolve(root,'.'+(name==='/'?'/index.html':name));if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}fs.readFile(file,(e,data)=>{if(e){res.writeHead(404).end();return;}res.setHeader('Content-Type',({'.js':'text/javascript','.html':'text/html','.css':'text/css'})[path.extname(file)]||'application/octet-stream');res.end(data);});});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXE?{executablePath:process.env.BROWSER_EXE}:{})});
 try{
  const page=await browser.newPage(),errors=[],requests=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);await page.waitForLoadState('networkidle');
  await page.evaluate(()=>{
   const canvas=document.createElement('canvas');canvas.width=1920;canvas.height=1080;const ctx=canvas.getContext('2d');ctx.fillStyle='black';ctx.fillRect(0,0,1920,1080);
   window.testClock=1;Object.defineProperty(performance,'now',{configurable:true,value:()=>testClock});
   window.showCandidate=()=>{ctx.fillStyle='#ddd';ctx.fillRect(140,35,210,40);ctx.fillRect(144,103,202,22);};window.clearCandidate=()=>{ctx.fillStyle='black';ctx.fillRect(0,0,1920,1080);};
   navigator.mediaDevices.getDisplayMedia=async()=>{const stream=canvas.captureStream(1);window.testStream=stream;setInterval(()=>{ctx.fillStyle='#010101';ctx.fillRect(0,0,1,1);stream.getVideoTracks()[0]?.requestFrame();},500);return stream;};
   window.workersCreated=0;window.workersTerminated=0;
   window.Tesseract={createWorker:async()=>{workersCreated++;return {setParameters:async()=>{},recognize:async()=>({data:{text:'CAMN SELELT',confidence:78,blocks:[]}}),terminate:async()=>{workersTerminated++;}};}};
   window.testEngine=BrowserCamoCapture.create({catalog,onReward:()=>{throw Error('Unexpected reward');},onOverview:()=>{throw Error('Unexpected overview');},onStatus:s=>window.latestStatus=s});
  });
  await page.evaluate(()=>testEngine.start());try{await page.waitForFunction(()=>latestStatus.checks>0);}catch(e){console.log(await page.evaluate(()=>latestStatus));throw e;}
  await page.evaluate(()=>testClock+=20000);await page.waitForFunction(()=>!latestStatus.ocrLoaded);
  assert.equal(await page.evaluate(()=>workersCreated),1,'Gameplay idle should release the first worker');
  await page.evaluate(()=>{testClock++;showCandidate();});await page.waitForFunction(()=>latestStatus.reads>0);
  await page.waitForTimeout(3200);
  const active=await page.evaluate(()=>JSON.parse(testEngine.getDiagnosticReport()));
  assert.equal(active.timing.workerStarts,2,'A newly woken worker must survive rejected reads instead of restarting every scan');
  assert.equal(active.snapshot.ocrLoaded,true);assert.equal(active.snapshot.saved,0);assert.equal(active.snapshot.confirmed,0);
  await page.evaluate(()=>{clearCandidate();testClock+=20000;});await page.waitForFunction(()=>!latestStatus.ocrLoaded);
  assert.equal(await page.evaluate(()=>workersTerminated),2,'The retained worker still unloads after genuine inactivity');
  await page.evaluate(()=>testEngine.stop());assert(await page.evaluate(()=>testStream.getTracks().every(t=>t.readyState==='ended')));
  assert.deepEqual(errors,[]);assert(!requests.some(url=>url.includes('/vendor/')));
  console.log('PASS: aged idle unload, rejected-candidate worker reuse, no false unlocks, genuine idle unload, Stop cleanup. Virtual age; OCR is stubbed only for lifecycle isolation.');
 }finally{await browser.close();server.closeAllConnections();server.close();}
})().catch(e=>{console.error(e);server.closeAllConnections();server.close();process.exitCode=1;});
