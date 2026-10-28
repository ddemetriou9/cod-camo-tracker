/* Pass two local screenshots as arguments. They are never copied to this repo. */
const {chromium}=require('playwright');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../web');
const fixtures=process.argv.slice(2);
if(fixtures.length!==2)throw Error('Usage: node tests/browser-ocr.cjs <military-reward.png> <attachment-reward.png>');
const server=http.createServer((req,res)=>{
 const name=new URL(req.url,'http://localhost').pathname;
 const file=/^\/fixture[01]$/.test(name)?fixtures[Number(name.slice(-1))]:path.resolve(root,'.'+(name==='/'?'/index.html':name));
 if(!fixtures.includes(file)&&!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
 fs.readFile(file,(e,data)=>{if(e){res.writeHead(404).end();return;}res.setHeader('Content-Type',({'.js':'text/javascript','.wasm':'application/wasm','.html':'text/html','.css':'text/css','.png':'image/png'})[path.extname(file)]||'application/octet-stream');res.end(data);});
});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXE?{executablePath:process.env.BROWSER_EXE}:{})});
 try{
  const page=await browser.newPage(),errors=[],requests=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push({url:r.url(),method:r.method()}));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);await page.waitForLoadState('networkidle');
  assert(!requests.some(r=>r.url.includes('/vendor/')),'Manual browsing must not load OCR assets');
  const output=await page.evaluate(async()=>{
   const worker=await BrowserCamoCapture.createOCR(),results=[];
   try{for(let i=0;i<2;i++){
    const image=new Image();image.src='/fixture'+i;await image.decode();const start=performance.now();
    const candidate=BrowserCamoCapture.bannerCandidate(image);
    const reading=await BrowserCamoCapture.readCrops(BrowserCamoCapture.frameCrops(image),worker);
    let fallback;
    if(i===0){const recognize=worker.recognize.bind(worker);let first=true;worker.recognize=async(...args)=>{if(first){first=false;return {data:{text:'Unreadable tight header',confidence:10}};}return recognize(...args);};try{const recovered=await BrowserCamoCapture.readCrops(BrowserCamoCapture.frameCrops(image),worker);fallback={reading:recovered,reward:CamoRewardParser.parse(recovered,catalog)};}finally{worker.recognize=recognize;}}
    results.push({candidate,reading,fallback,reward:CamoRewardParser.parse(reading,catalog),milliseconds:Math.round(performance.now()-start)});
   }}finally{await worker.terminate();}return results;
  });
  console.log(JSON.stringify(output,null,2));
  assert.equal(output[0].candidate,true);assert.equal(output[0].reward?.weapon,'PILA');assert.equal(output[0].reward?.slot,5);
  assert.equal(output[0].fallback?.reward?.weapon,'PILA','Broad header fallback must continue reading the weapon and reward');
  assert.equal(output[1].candidate,true);assert.equal(output[1].reward,null);
  assert(requests.every(r=>r.method==='GET'&&new URL(r.url).hostname==='127.0.0.1'),'No uploads or third-party requests');
  assert.deepEqual(errors,[]);
  console.log('PASS: real browser WASM OCR recognises PILA Military Camo 6 and rejects ODEN attachment/39-of-64 count.');
 }finally{await browser.close();server.closeAllConnections();server.close();}
})().catch(e=>{console.error(e);server.closeAllConnections();server.close();process.exitCode=1;});
