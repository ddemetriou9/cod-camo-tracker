/* Real OCR on short cards; input screenshots stay outside the repository. */
const {chromium}=require('playwright');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../web'),fixtures=process.argv.slice(2);
if(fixtures.length!==2)throw Error('Usage: node tests/browser-carousel.cjs <PILA-reward.png> <ODEN-attachment.png>');
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
  const page=await browser.newPage(),errors=[],requests=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);await page.waitForLoadState('networkidle');
  await page.evaluate(async()=>{
   const images=await Promise.all([0,1].map(async i=>{const image=new Image();image.src='/fixture'+i;await image.decode();return image;}));
   const canvas=document.createElement('canvas');canvas.width=1920;canvas.height=Math.round(images[0].height*1920/images[0].width);const ctx=canvas.getContext('2d');
   function draw(name){ctx.fillStyle='black';ctx.fillRect(0,0,canvas.width,canvas.height);if(name==='blank')return;ctx.drawImage(images[name==='ODEN'?1:0],0,0,canvas.width,canvas.height);if(name==='M4'){ctx.fillStyle='#111911';ctx.fillRect(canvas.width*.01,canvas.height*.105,canvas.width*.32,canvas.height*.07);ctx.fillStyle='white';ctx.font='bold 44px Arial';ctx.fillText('M4',canvas.width*.025,canvas.height*.153);}}
   draw('blank');window.carousel={draw,rates:[1],stream:null};
   navigator.mediaDevices.getDisplayMedia=async options=>{
    carousel.options=options;const stream=canvas.captureStream(4),track=stream.getVideoTracks()[0],settings=track.getSettings.bind(track);let rate=1;
    track.getSettings=()=>({...settings(),frameRate:rate});track.getConstraints=()=>({frameRate:{ideal:rate,max:rate}});
    track.applyConstraints=async constraints=>{rate=constraints.frameRate.max;carousel.rates.push(rate);};
    carousel.stream=stream;setInterval(()=>{ctx.fillStyle='black';ctx.fillRect(0,0,1,1);track.requestFrame();},250);return stream;
   };
  });
  await page.locator('#automation').click();await page.locator('#browser-start').click();
  await page.waitForFunction(()=>document.querySelector('#browser-status').textContent.includes('OCR idle'),null,{timeout:30000});
  assert.deepEqual(await page.evaluate(()=>carousel.rates),[1]);assert.match(await page.locator('#browser-stats').textContent(),/0 OCR reads/);
  await page.evaluate(()=>carousel.draw('ODEN'));
  await page.waitForFunction(()=>document.querySelector('#browser-status').textContent.includes('Results visible'),null,{timeout:12000});
  assert((await page.evaluate(()=>carousel.rates)).includes(4));
  await page.evaluate(()=>carousel.draw('PILA'));await page.waitForTimeout(1200);
  await page.evaluate(()=>carousel.draw('ODEN'));await page.waitForTimeout(650);
  await page.evaluate(()=>carousel.draw('M4'));await page.waitForTimeout(1200);
  await page.evaluate(()=>carousel.draw('blank'));
  const counts=await page.evaluate(()=>({PILA:TrackerTest.count('PILA'),M4:TrackerTest.count('M4'),Oden:TrackerTest.count('Oden')}));
  console.log(JSON.stringify({counts,status:await page.locator('#browser-status').textContent(),rates:await page.evaluate(()=>carousel.rates)}));
  assert.deepEqual(counts,{PILA:6,M4:6,Oden:0});
  await page.waitForFunction(()=>carousel.rates.at(-1)===1,null,{timeout:7000});
  const reads=await page.locator('#browser-stats').textContent();await page.waitForTimeout(1200);assert.equal((await page.locator('#browser-stats').textContent()).match(/\d+ OCR reads/)[0],reads.match(/\d+ OCR reads/)[0]);
  await page.locator('#browser-stop').click();assert(await page.evaluate(()=>carousel.stream.getTracks().every(t=>t.readyState==='ended')));
  assert.deepEqual(errors,[]);assert(requests.every(r=>r.method()==='GET'&&new URL(r.url()).hostname==='127.0.0.1'));
  console.log('PASS: two 1.2-second weapon cards recognised without cross-assignment, short attachment card ignored, results-only 4 FPS burst, automatic return to 1 FPS and idle OCR, clean Stop, no uploads.');
 }finally{await browser.close();server.closeAllConnections();server.close();}
})().catch(e=>{console.error(e);server.closeAllConnections();server.close();process.exitCode=1;});
