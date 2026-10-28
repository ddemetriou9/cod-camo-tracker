/* One low-rate display stream, one OCR worker, no uploads or saved frames. */
(function(root){
 'use strict';
 const REGIONS={header:[.015,.052,.25,.052],weapon:[.018,.110,.30,.060],reward:[.37,.642,.27,.030],type:[.44,.682,.12,.023]};
 const size=source=>[source.videoWidth||source.naturalWidth||source.width,source.videoHeight||source.naturalHeight||source.height];
 function crop(source,region,width){
  const [w,h]=size(source),[x,y,rw,rh]=region;
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=Math.max(1,Math.round(width*rh*h/(rw*w)));
  canvas.getContext('2d',{willReadFrequently:true}).drawImage(source,x*w,y*h,rw*w,rh*h,0,0,canvas.width,canvas.height);
  return canvas;
 }
 function bannerCandidate(source){
  const canvas=crop(source,REGIONS.header,160),ctx=canvas.getContext('2d'),pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data;
  let gold=0;for(let i=0;i<pixels.length;i+=4){const [r,g,b]=[pixels[i],pixels[i+1],pixels[i+2]];if(r>135&&g>110&&b<g*.70&&r>g*.82&&r<g*1.65)gold++;}
  return gold/(pixels.length/4)>.012;
 }
 function hash(canvas){
  const data=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
  let value=2166136261;for(let i=0;i<data.length;i+=16){value^=data[i];value=Math.imul(value,16777619);value^=data[i+1];value=Math.imul(value,16777619);}
  return (value>>>0).toString(16);
 }
 function prepare(canvas,invert){
  const ctx=canvas.getContext('2d'),image=ctx.getImageData(0,0,canvas.width,canvas.height),p=image.data;
  for(let i=0;i<p.length;i+=4){let v=Math.round(p[i]*.299+p[i+1]*.587+p[i+2]*.114);if(invert)v=255-v;p[i]=p[i+1]=p[i+2]=v;}
  ctx.putImageData(image,0,0);return canvas;
 }
 function frameCrops(source){return {header:prepare(crop(source,REGIONS.header,700),true),weapon:prepare(crop(source,REGIONS.weapon,650),true),reward:prepare(crop(source,REGIONS.reward,800),false),type:prepare(crop(source,REGIONS.type,500),true)};}
 async function readCrops(crops,worker){
  const texts={},confidences=[];
  for(const name of ['header','weapon','reward']){
   const {data}=await worker.recognize(crops[name]);texts[name]=data.text;confidences.push(data.confidence||0);
   if(name==='header'&&!root.CamoRewardParser.key(data.text).replace(/0/g,'O').includes('TOPPERFORMINGWEAPONS'))return {header:data.text,weapon:'',reward:'',confidence:data.confidence||0};
  }
  if(!/MILITARY\s+CAMO\s+[1-8]/i.test(texts.reward)){
   await worker.setParameters({tessedit_pageseg_mode:'7'});
   try{const {data}=await worker.recognize(crops.type);if(data.confidence>=40&&/\bCAMO\b/i.test(data.text))texts.reward+='\nCAMO';}
   finally{await worker.setParameters({tessedit_pageseg_mode:'6'});}
  }
  return {...texts,confidence:Math.min(...confidences)};
 }
 let libraryPromise;
 function loadLibrary(){
  if(root.Tesseract)return Promise.resolve();
  if(!libraryPromise)libraryPromise=new Promise((resolve,reject)=>{const script=document.createElement('script');script.src=new URL('vendor/ocr/tesseract.min.js',document.baseURI).href;script.onload=resolve;script.onerror=()=>{script.remove();libraryPromise=null;reject(Error('Could not load local OCR files. Check your connection and try again.'));};document.head.append(script);});
  return libraryPromise;
 }
 async function createOCR(onProgress=()=>{}){
  await loadLibrary();const base=new URL('vendor/ocr/',document.baseURI).href;
  const worker=await root.Tesseract.createWorker('eng',1,{workerPath:base+'worker.min.js',corePath:base+'core',langPath:base+'lang',workerBlobURL:false,logger:m=>{if(m.status!=='recognizing text')onProgress(m.status,m.progress);}}, {load_system_dawg:'0',load_freq_dawg:'0'});
  await worker.setParameters({tessedit_pageseg_mode:'6',user_defined_dpi:'150'});return worker;
 }
 function create({catalog,onReward,onStatus}){
  let generation=0,stream=null,video=null,worker=null,timer=null,pending=null,cache=null,blockedUntil=0,resultsSeenAt=0;
  const status={phase:'stopped',message:'Ready when you are.',running:false,checks:0,reads:0,lastReadMs:0,source:'',ocrLoaded:false};
  function report(phase,message){Object.assign(status,{phase,message});onStatus({...status});}
  function release(){
   clearTimeout(timer);timer=null;
   if(stream){for(const track of stream.getTracks()){track.onended=null;track.stop();}stream=null;}
   if(video){video.pause();video.srcObject=null;video.remove();video=null;}
   if(worker){worker.terminate().catch(()=>{});worker=null;}
   cache=null;pending=null;blockedUntil=0;status.ocrLoaded=false;
  }
  function stop(message='Screen sharing and recognition stopped.'){
   generation++;release();status.running=false;report('stopped',message);
  }
  function confirm(reading,frameHash){
   const reward=root.CamoRewardParser.parse(reading,catalog);
   if(!reward){pending=null;return null;}
   if(pending?.id===reward.id&&performance.now()-pending.at>=500){pending=null;onReward(reward);return reward;}
   pending={id:reward.id,at:performance.now(),frameHash};return null;
  }
  async function scan(run){
   if(run!==generation||!status.running)return;
   let delay=2000;
   try{
    if(!video||video.readyState<2||!video.videoWidth){pending=null;report('waiting','Waiting for a visible game window.');return;}
    status.checks++;
    if(!bannerCandidate(video)){
     pending=null;cache=null;report('watching','Waiting for after-match rewards. Small banner check every 2 seconds; OCR idle.');return;
    }
    if(performance.now()<blockedUntil)return;
    delay=1000;
    const crops=frameCrops(video),frameHash=hash(crops.header)+hash(crops.weapon)+hash(crops.reward);
    if(!worker){
     report('loading','Results candidate found. Waking the local recogniser…');
     const created=await createOCR();if(run!==generation){await created.terminate();return;}
     worker=created;status.ocrLoaded=true;
    }
    let reading;
    if(cache?.hash===frameHash)reading=cache.reading;
    else{
     report('reading','Results candidate found. Reading the weapon and centre reward card…');
     const start=performance.now();reading=await readCrops(crops,worker);
     if(run!==generation)return;
     status.reads++;status.lastReadMs=Math.round(performance.now()-start);cache={hash:frameHash,reading};
    }
    if(!root.CamoRewardParser.key(reading.header).replace(/0/g,'O').includes('TOPPERFORMINGWEAPONS')){
     blockedUntil=performance.now()+8000;pending=null;report('watching','No results banner confirmed. OCR resting; small checks continue.');return;
    }
    resultsSeenAt=performance.now();
    const reward=confirm(reading,frameHash);
    if(reward)report('watching',reward.weapon+' — '+reward.name+' recognised. Progress saved automatically.');
    else if(pending)report('confirming','Camo reward detected. Checking that the card is stable…');
    else report('watching','Results visible. Waiting for a readable camo reward; attachment and level totals are ignored.');
   }catch(error){if(run===generation){stop();report('error','Recognition stopped: '+error.message+' Try Start tracking again.');}}
   finally{
    if(run===generation&&status.running&&worker&&performance.now()-resultsSeenAt>15000){
     const retiring=worker;worker=null;status.ocrLoaded=false;cache=null;await retiring.terminate().catch(()=>{});
     if(run===generation)report('watching','Waiting for after-match rewards. OCR unloaded to save memory; small banner checks continue.');
    }
    if(run===generation&&status.running)timer=setTimeout(()=>scan(run),delay);
   }
  }
  async function start(){
   if(status.running)return;
   const run=++generation;release();status.running=true;status.checks=0;status.reads=0;status.lastReadMs=0;
   report('starting','Choose the Call of Duty game window in the browser sharing dialog.');
   try{
    if(location.protocol==='file:'||!isSecureContext||!navigator.mediaDevices?.getDisplayMedia)throw Error('Open the hosted HTTPS tracker in desktop Edge or Chrome for screen sharing. Manual tracking still works.');
    // Permission is requested directly from the user's click, before any await.
    const selected=await navigator.mediaDevices.getDisplayMedia({video:{displaySurface:'window',frameRate:{ideal:1,max:1},width:{ideal:1920,max:1920}},audio:false,selfBrowserSurface:'exclude',systemAudio:'exclude'});
    if(run!==generation){selected.getTracks().forEach(t=>t.stop());return;}
    stream=selected;const track=stream.getVideoTracks()[0];
    if(!track)throw Error('No shared video track was returned.');
    track.onended=()=>stop('Sharing ended. Click Start tracking to share the game window again.');
    status.source=track.getSettings().displaySurface||'selected surface';
    report('starting','Game sharing connected. Waiting for the first video frame…');
    video=document.createElement('video');video.muted=true;video.playsInline=true;video.setAttribute('aria-hidden','true');video.dataset.browserCapture='true';
    video.style.cssText='position:fixed;width:1px;height:1px;bottom:0;right:0;opacity:.01;pointer-events:none';document.body.append(video);video.srcObject=stream;
    let playbackTimeout;
    try{await Promise.race([video.play(),new Promise((_,reject)=>{playbackTimeout=setTimeout(()=>reject(Error('No video frame arrived. Try sharing the game in borderless/windowed mode.')),15000);})]);}
    finally{clearTimeout(playbackTimeout);}
    if(run!==generation)return;
    report('loading','Preparing local OCR. The first start downloads recognition files; future starts use the browser cache.');
    const created=await createOCR((name,progress)=>{if(run===generation)report('loading','Preparing local OCR: '+name+(Number.isFinite(progress)?' '+Math.round(progress*100)+'%':'')+'.');});
    if(run!==generation){await created.terminate();return;}
    worker=created;status.ocrLoaded=true;resultsSeenAt=performance.now();report('watching','Tracking started. Play normally and leave the results cards visible after the match.');
    timer=setTimeout(()=>scan(run),500);
   }catch(error){
    if(run!==generation)return;
    release();status.running=false;
    report('error',error.name==='NotAllowedError'?'Screen sharing was cancelled or blocked. Click Start tracking to try again.':error.message);
   }
  }
  return {start,stop,getStatus:()=>({...status})};
 }
 root.BrowserCamoCapture={create,createOCR,crop,bannerCandidate,frameCrops,readCrops,REGIONS};
})(window);
