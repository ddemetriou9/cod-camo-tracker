/* Replays a local game recording through the real tracker as if it were a live window share.
   The clip and its labels stay outside Git (validation/ is ignored); nothing is uploaded or saved except a text score. */
const {firefox,chromium}=require('playwright');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const {expectedFromLabels,score}=require('./score.cjs');

const args=process.argv.slice(2),flag=(name,fallback)=>{const i=args.indexOf('--'+name);return i<0?fallback:args[i+1];},has=name=>args.includes('--'+name);
const clip=args[0]?.startsWith('--')?undefined:args[0];
if(!clip||!fs.existsSync(clip))throw Error('Usage: node tests/replay/replay.cjs <clip.mp4> [--labels clip.json] [--browser firefox|msedge|both] [--rate 1] [--query engine=v2] [--headed] [--out file.json]');
const labelsFile=flag('labels',clip.replace(/\.[^.]+$/,'.json'));
const labels=JSON.parse(fs.readFileSync(labelsFile,'utf8'));
const rate=Number(flag('rate','1')),query=flag('query',''),browsers=flag('browser','both')==='both'?['firefox','msedge']:[flag('browser')];
const root=path.resolve(__dirname,'../../web'),clipPath=path.resolve(clip);
const out=flag('out',path.resolve(__dirname,'../../validation/replay-results',path.basename(clip).replace(/\.[^.]+$/,'')+'-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json'));
const types={'.js':'text/javascript','.wasm':'application/wasm','.html':'text/html','.css':'text/css','.json':'application/json','.webp':'image/webp','.png':'image/png','.traineddata':'application/octet-stream','.gz':'application/gzip'};

// Serves only web/ and the one clip (with Range support, which media elements use for seeking and buffering).
const server=http.createServer((req,res)=>{
 const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
 if(name==='/__clip'){
  const size=fs.statSync(clipPath).size,range=/bytes=(\d*)-(\d*)/.exec(req.headers.range||'');
  const type=clipPath.endsWith('.webm')?'video/webm':'video/mp4';
  if(!range){res.writeHead(200,{'Content-Type':type,'Content-Length':size,'Accept-Ranges':'bytes'});fs.createReadStream(clipPath).pipe(res);return;}
  const start=range[1]?Number(range[1]):0,end=range[2]?Math.min(Number(range[2]),size-1):size-1;
  res.writeHead(206,{'Content-Type':type,'Content-Length':end-start+1,'Content-Range':`bytes ${start}-${end}/${size}`,'Accept-Ranges':'bytes'});fs.createReadStream(clipPath,{start,end}).pipe(res);return;
 }
 const file=path.resolve(root,'.'+(name==='/'?'/index.html':name));
 if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
 fs.readFile(file,(e,data)=>{if(e){res.writeHead(404).end();return;}res.setHeader('Content-Type',types[path.extname(file)]||'application/octet-stream');res.end(data);});
});

/* Runs in the page before the app. Emulates getDisplayMedia: the clip is decoded in a hidden video,
   redrawn at the frame rate and maximum width the tracker requested, and delivered as a canvas track.
   applyConstraints changes the delivered rate, like a real window share. */
function emulateCapture(rate){
 const replay=window.__replay={ended:false,startedAt:0,duration:0,deliveredFrames:0,error:''};
 navigator.mediaDevices.getDisplayMedia=async options=>{
  const video=document.createElement('video');video.muted=true;video.playsInline=true;video.preload='auto';video.src='/__clip';
  video.style.cssText='position:fixed;left:-10000px;top:0;width:320px;height:180px';document.documentElement.append(video);
  await new Promise((resolve,reject)=>{video.onloadedmetadata=resolve;video.onerror=()=>reject(Error('Clip could not be decoded: media error '+(video.error?.code||'?')));});
  const wanted=options?.video||{};let fps=wanted.frameRate?.max||wanted.frameRate?.ideal||30,maxWidth=wanted.width?.max||wanted.width?.ideal||video.videoWidth;
  const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');
  const resize=()=>{const scale=Math.min(1,maxWidth/video.videoWidth);canvas.width=Math.round(video.videoWidth*scale);canvas.height=Math.round(video.videoHeight*scale);};resize();
  // No frame-rate argument: a frame is delivered whenever the canvas is redrawn (requestFrame stalls in Firefox).
  const stream=canvas.captureStream(),track=stream.getVideoTracks()[0];
  track.applyConstraints=async constraints=>{const r=constraints?.frameRate;if(r)fps=r.max||r.ideal||fps;const w=constraints?.width;if(w){maxWidth=w.max||w.ideal||maxWidth;resize();}};
  track.getSettings=()=>({width:canvas.width,height:canvas.height,frameRate:fps,displaySurface:'window'});
  track.getConstraints=()=>({});
  video.playbackRate=rate;video.onended=()=>{replay.ended=true;};replay.duration=video.duration;
  await video.play();replay.startedAt=Date.now();
  (function pump(){if(replay.ended)return;ctx.drawImage(video,0,0,canvas.width,canvas.height);replay.deliveredFrames++;setTimeout(pump,1000/fps);})();
  return stream;
 };
}

async function run(name){
 const browser=name==='firefox'?await firefox.launch({headless:!has('headed')}):await chromium.launch({channel:'msedge',headless:!has('headed')});
 try{
  const context=await browser.newContext({viewport:{width:1400,height:900}}),page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await context.addInitScript(emulateCapture,rate);
  await page.goto(`http://127.0.0.1:${server.address().port}/${query?'?'+query:''}`);await page.waitForLoadState('networkidle');
  await page.locator('#automation').click();await page.locator('#browser-start').click();
  await page.waitForFunction(()=>window.__replay.startedAt>0,null,{timeout:60000});
  const duration=await page.evaluate(()=>window.__replay.duration);
  process.stdout.write(`${name}: replaying ${duration.toFixed(1)} s at ${rate}x…\n`);
  await page.waitForFunction(()=>window.__replay.ended,null,{timeout:(duration/rate+90)*1000,polling:500});
  await page.waitForTimeout(5000);// let the last confirmation finish
  await page.locator('#browser-copy-report').click();
  const report=JSON.parse(await page.locator('#browser-report-text').inputValue());
  const result=await page.evaluate(()=>({state:JSON.parse(localStorage.getItem('mw4.fieldnotes.v1')||'{}'),replay:window.__replay}));
  return {browser:name,errors,report,state:result.state,replay:result.replay};
 }finally{await browser.close();}
}

(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const catalog=JSON.parse(fs.readFileSync(path.join(root,'catalog.json'),'utf8')),expected=expectedFromLabels(labels,catalog);
 const results=[];let failed=false;
 try{
  for(const name of browsers){
   const raw=await run(name),scored=score(expected,raw,{rate});results.push({...scored,browser:name,pageErrors:raw.errors});
   failed||=!scored.pass;
   console.log(`\n${name}: ${scored.pass?'PASS':'FAIL'}`);for(const line of scored.lines)console.log('  '+line);
  }
 }finally{server.close();}
 fs.mkdirSync(path.dirname(out),{recursive:true});
 fs.writeFileSync(out,JSON.stringify({clip:path.basename(clip),labels:path.basename(labelsFile),rate,query,at:new Date().toISOString(),results},null,2));
 console.log('\nScore written to '+out);
 process.exitCode=failed?1:0;
})().catch(e=>{console.error(e);process.exit(2);});
