/* One low-rate display stream, one OCR worker, no uploads or saved frames. */
(function(root){
 'use strict';
 const REGIONS={header:[.015,.052,.25,.052],weapon:[.018,.110,.30,.060],reward:[.37,.642,.27,.030],type:[.44,.682,.12,.023]};
 const MENU_REGIONS={title:[.068,.025,.12,.05],weapon:[.068,.089,.12,.034],military:[.065,.14,.13,.035],special:[.065,.39,.08,.032],completionist:[.065,.565,.11,.034],prestige:[.065,.70,.09,.028]};
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
 function menuCandidate(source,layout=MENU_REGIONS){
  function whiteFraction(region,width,threshold=145){const canvas=crop(source,region,width),p=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;let white=0;for(let i=0;i<p.length;i+=4)if(p[i]>threshold&&p[i+1]>threshold&&p[i+2]>threshold&&Math.max(p[i],p[i+1],p[i+2])-Math.min(p[i],p[i+1],p[i+2])<75)white++;return white/(p.length/4);}
  return whiteFraction(layout===MENU_REGIONS?[.075,.095,.105,.02]:layout.weapon,100)>(layout===MENU_REGIONS ? 0.48 : 0.25)&&whiteFraction(layout.title,100,110)>.03;
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
 function frameCrops(source){return {header:prepare(crop(source,REGIONS.header,700),true),weapon:prepare(crop(source,REGIONS.weapon,650),true),reward:prepare(crop(source,REGIONS.reward,800),false),type:prepare(crop(source,REGIONS.type,500),true),scout:prepare(crop(source,[.015,.005,.42,.17],900),true)};}
 function overviewCrops(source,layout=MENU_REGIONS){return Object.fromEntries(Object.entries(layout).map(([name,region])=>[name,prepare(crop(source,region,600),name!=='weapon')]));}
 async function readOverviewCrops(crops,worker){
  const title=(await worker.recognize(crops.title)).data;
  if(!root.CamoRewardParser.key(title.text).replace(/0/g,'O').includes('CAMOSELECT'))return {header:title.text,categories:[],confidence:title.confidence||0};
  const weapon=(await worker.recognize(crops.weapon)).data,categories=[];
  for(const name of ['military','special','completionist','prestige']){if(!crops[name])continue;const {data}=await worker.recognize(crops[name]);categories.push({text:data.text,confidence:data.confidence||0});}
  return {header:title.text+'\n'+weapon.text,categories,confidence:Math.min(title.confidence||0,weapon.confidence||0)};
 }
 async function readWideOverview(canvas,worker){
  await worker.setParameters({tessedit_pageseg_mode:'11'});
  try{
   const {data}=await worker.recognize(canvas,{}, {text:true,blocks:true});
   const rawLines=(data.blocks||[]).flatMap(block=>(block.paragraphs||[]).flatMap(paragraph=>paragraph.lines||[]));
   const lines=rawLines.map(line=>({text:line.text,confidence:line.confidence??data.confidence}));
   const title=rawLines.find(line=>root.CamoRewardParser.key(line.text).replace(/0/g,'O').includes('CAMOSELECT'));
   let layout;
   function regionFor(box,pad=4){const x=Math.max(0,box.x0-pad),y=Math.max(0,box.y0-pad);return [x/canvas.width,y/canvas.height,(Math.min(canvas.width,box.x1+pad)-x)/canvas.width,(Math.min(canvas.height,box.y1+pad)-y)/canvas.height];}
   function union(boxes){return {x0:Math.min(...boxes.map(b=>b.x0)),y0:Math.min(...boxes.map(b=>b.y0)),x1:Math.max(...boxes.map(b=>b.x1)),y1:Math.max(...boxes.map(b=>b.y1))};}
   if(title){
    const words=(title.words||[]).filter(word=>['CAMO','SELECT'].includes(root.CamoRewardParser.normal(word.text).replace(/0/g,'O'))),boxes=words.length?words.map(word=>word.bbox):[title.bbox];
    const box=union(boxes),tw=box.x1-box.x0,th=box.y1-box.y0;
    const region=[Math.max(0,box.x0-tw*.08)/canvas.width,(box.y0+th*1.55)/canvas.height,Math.min(tw*1.3,canvas.width-box.x0)/canvas.width,th*1.3/canvas.height];
    layout={title:regionFor(box,6),weapon:region};
    for(const line of rawLines){const category=/^\s*(MILITARY|SPECIAL|COMPLETIONIST|PRESTIGE)\b/i.exec(line.text)?.[1].toLowerCase();if(!category||!/[0-9OØ]\s*\/\s*\d/i.test(line.text))continue;const useful=(line.words||[]).filter(word=>root.CamoRewardParser.normal(word.text)===category.toUpperCase()||/[0-9OØ]\s*\/\s*\d/i.test(word.text));layout[category]=regionFor(useful.length?union(useful.map(word=>word.bbox)):line.bbox);}
    if(!lines.some(line=>root.CamoRewardParser.key(line.text).replace(/0/g,'O').endsWith('PROGRESSION'))){
    await worker.setParameters({tessedit_pageseg_mode:'7'});
    const focused=(await worker.recognize(prepare(crop(canvas,region,750),false))).data;
    lines.push({text:focused.text,confidence:focused.confidence,role:'weapon'});
    }
   }
   return {...root.CamoRewardParser.overviewReadingFromLines(lines.length?lines:data.text.split(/[\r\n]+/).filter(Boolean).map(text=>({text,confidence:data.confidence}))),layout,rawText:String(data.text||'').slice(0,4500)};
  }finally{await worker.setParameters({tessedit_pageseg_mode:'6'});}
 }
 async function readCrops(crops,worker){
  const texts={},confidences=[];
  for(const name of ['header','weapon','reward']){
   const {data}=await worker.recognize(crops[name]);texts[name]=data.text;confidences.push(data.confidence||0);
   if(name==='header'&&!root.CamoRewardParser.key(data.text).replace(/0/g,'O').includes('TOPPERFORMINGWEAPONS')){
    let scout=data;
    if(crops.scout){await worker.setParameters({tessedit_pageseg_mode:'11'});try{scout=(await worker.recognize(crops.scout)).data;}finally{await worker.setParameters({tessedit_pageseg_mode:'6'});}}
    const menuHint=scout.confidence>=60&&root.CamoRewardParser.key(scout.text).replace(/0/g,'O').includes('CAMOSELECT');
    return {header:scout.text||data.text,weapon:'',reward:'',confidence:scout.confidence||0,menuHint};
   }
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
 function create({catalog,onReward,onOverview=()=>{},onStatus}){
  let generation=0,stream=null,video=null,worker=null,timer=null,pending=null,cache=null,blockedUntil=0,resultsSeenAt=0,burstUntil=0,burstDeadline=0,requestedRate=1,rateAttempt=0,rateAttemptAt=0,busyRun=0,forceScans=0,forceBudget=0;
  let pendingCategories=new Map(),menuLayout=null,autoLocateAt=0;
  const status={build:'2026-10-29-scan-3',phase:'stopped',message:'Ready when you are.',running:false,checks:0,reads:0,lastReadMs:0,source:'',ocrLoaded:false,captureFPS:1,width:0,height:0,frames:0,lastReading:'No OCR reading yet.',lastScreenScan:'No screen scan yet.',lastFailure:'',layout:'default',confirmed:0,saved:0};
  function report(phase,message){Object.assign(status,{phase,message});onStatus({...status});}
  function release(){
   clearTimeout(timer);timer=null;
   if(stream){for(const track of stream.getTracks()){track.onended=null;track.stop();}stream=null;}
   if(video){video.pause();video.srcObject=null;video.remove();video=null;}
   if(worker){worker.terminate().catch(()=>{});worker=null;}
   cache=null;pending=null;pendingCategories.clear();forceScans=0;forceBudget=0;blockedUntil=0;burstUntil=0;burstDeadline=0;requestedRate=1;rateAttempt=0;rateAttemptAt=0;status.captureFPS=1;status.ocrLoaded=false;
   menuLayout=null;autoLocateAt=0;status.layout='default';
  }
  async function setCaptureRate(fps,run){
   if(requestedRate===fps)return;
   const track=stream?.getVideoTracks()[0];if(!track)return;
   if(rateAttempt===fps&&performance.now()-rateAttemptAt<5000)return;
   rateAttempt=fps;rateAttemptAt=performance.now();
   try{
    await track.applyConstraints({...track.getConstraints(),frameRate:{ideal:fps,max:fps},width:{ideal:1920,max:1920}});
    if(run===generation){requestedRate=fps;status.captureFPS=Math.round((track.getSettings().frameRate||fps)*10)/10;}
   }catch(error){/* Keep the available rate if this capture source cannot change it. */}
  }
  function stop(message='Screen sharing and recognition stopped.'){
   generation++;release();status.running=false;report('stopped',message);
  }
  function confirm(reading,frameHash){
   const reward=root.CamoRewardParser.parse(reading,catalog);
   if(!reward){pending=null;return null;}
   if(pending?.id===reward.id){if(performance.now()-pending.at>=200){pending=null;status.confirmed++;const result=onReward(reward);if(result==='saved')status.saved++;return {...reward,applyResult:result};}return null;}
   pending={id:reward.id,at:performance.now(),frameHash};return null;
  }
  async function scan(run){
   if(run!==generation||!status.running||busyRun===run)return;
   busyRun=run;
   let delay=1000;
   try{
    if(!video||video.readyState<2||!video.videoWidth){pending=null;report('waiting','Waiting for a visible game window.');return;}
    status.checks++;
    if(status.width&&(status.width!==video.videoWidth||status.height!==video.videoHeight)){menuLayout=null;status.layout='default';}
    status.width=video.videoWidth;status.height=video.videoHeight;status.frames=video.getVideoPlaybackQuality?.().totalVideoFrames||0;
    const mode=forceScans>0&&forceBudget>0?'wide':menuCandidate(video,menuLayout||MENU_REGIONS)?'menu':bannerCandidate(video)?'reward':null;
    if(!mode){
     pending=null;pendingCategories.clear();cache=null;
     if(performance.now()<burstUntil){delay=250;report('watching','Results are transitioning. Watching for the next weapon card…');return;}
     burstDeadline=0;await setCaptureRate(1,run);if(run!==generation)return;
     report('watching',status.lastFailure?'Waiting. Last check: '+status.lastFailure+' See Capture preview & last reading.':'Waiting for a camo overview or after-match rewards. Small checks every second; OCR idle.');return;
    }
    if(mode!=='wide'&&performance.now()<blockedUntil&&cache?.mode===mode)return;
    delay=mode==='reward'?250:1000;
    const crops=mode==='wide'?{screen:crop(video,[0,0,1,1],Math.min(1920,Math.round(Math.sqrt(2200000*video.videoWidth/video.videoHeight))))}:mode==='menu'?overviewCrops(video,menuLayout||MENU_REGIONS):frameCrops(video),frameHash=mode+Object.values(crops).map(hash).join(':');
    if(mode==='reward'){
     if(!burstDeadline)burstDeadline=performance.now()+90000;
     burstUntil=Math.min(burstDeadline,performance.now()+4000);
     await setCaptureRate(performance.now()<burstUntil?4:1,run);
     if(performance.now()>=burstDeadline)delay=1000;
    }else{burstUntil=0;burstDeadline=0;await setCaptureRate(1,run);}
    if(run!==generation)return;
    if(!worker){
     report('loading','Possible menu/results screen. Waking the local recogniser…');
     const created=await createOCR();if(run!==generation){await created.terminate();return;}
     worker=created;status.ocrLoaded=true;
    }
    let reading;
    if(cache?.hash===frameHash)reading=cache.reading;
    else{
     report('reading',mode==='wide'?'Locating camo text on the visible screen…':mode==='menu'?'Camo overview found. Reading the weapon and category totals…':'Checking the header of a possible menu/results screen…');
     const start=performance.now();reading=mode==='wide'?await readWideOverview(crops.screen,worker):mode==='menu'?await readOverviewCrops(crops,worker):await readCrops(crops,worker);
     if(run!==generation)return;
     status.reads++;status.lastReadMs=Math.round(performance.now()-start);cache={hash:frameHash,reading,mode};
     status.lastReading=(mode==='reward'?['Header: '+reading.header,'Weapon: '+reading.weapon,'Reward: '+reading.reward,'Confidence: '+reading.confidence].join('\n'):[reading.header,...reading.categories.map(r=>r.text+' ('+Math.round(r.confidence)+'%)'),'Header confidence: '+Math.round(reading.confidence)+'%'].join('\n')).slice(0,1600);
    }
    if(mode==='reward'&&reading.menuHint){
     burstUntil=0;burstDeadline=0;await setCaptureRate(1,run);if(run!==generation)return;
     if(performance.now()>=autoLocateAt){autoLocateAt=performance.now()+60000;forceScans=2;forceBudget=3;blockedUntil=0;cache=null;pendingCategories.clear();status.lastFailure='';report('reading','Camo menu recognised instead of results. Locating its weapon and category text automatically…');}
     else{blockedUntil=performance.now()+8000;report('watching','Camo menu recognised, but its text position is still unresolved. Use Scan visible camo screen now or check the last reading.');}
     return;
    }
    if(mode==='menu'||mode==='wide'){
     if(mode==='wide'){forceScans--;forceBudget--;}
     const overview=root.CamoRewardParser.parseOverview(reading,catalog);
     if(mode==='wide')status.lastScreenScan=(overview?'Read '+overview.weapon+' category totals. Confirming before saving.':root.CamoRewardParser.overviewIssue(reading,catalog))+'\n\n'+status.lastReading+(reading.rawText?'\n\nFull screen OCR text:\n'+reading.rawText:'');
     if(!overview){
      pending=null;pendingCategories.clear();blockedUntil=performance.now()+8000;status.lastFailure=root.CamoRewardParser.overviewIssue(reading,catalog);
      if(mode==='wide')forceScans=0;
      else if(performance.now()>=autoLocateAt){autoLocateAt=performance.now()+60000;forceScans=2;forceBudget=3;blockedUntil=0;cache=null;report('reading',status.lastFailure+' Trying a bounded screen scan to locate the text…');return;}
      report('watching',status.lastFailure+' See Last screen scan below.');return;
     }
     if(mode==='wide'&&reading.layout){menuLayout=reading.layout;status.layout='located camo text';}
     status.lastFailure='';
     resultsSeenAt=performance.now();
     const now=performance.now(),confirmed=[],next=new Map();
     for(const entry of overview.entries){const key=entry.weapon+'|'+entry.category+'|'+entry.current+'/'+entry.target,previous=pendingCategories.get(key);if(previous&&now-previous.at>=500)confirmed.push(entry);next.set(key,previous||{at:now});}
     pendingCategories=next;
     if(mode==='wide'&&confirmed.length<overview.entries.length&&forceBudget>0)forceScans=Math.max(forceScans,1);
     if(confirmed.length){status.confirmed++;const result=onOverview({...overview,entries:confirmed});if(result==='saved')status.saved++;const message=overview.weapon+' overview '+(result==='failed'?'could not be saved':result==='already-recorded'?'already recorded; manual corrections preserved':'saved')+': '+confirmed.map(e=>e.category.toLowerCase()+' '+e.current+'/'+e.target).join(' · ')+'.';if(mode==='wide')status.lastScreenScan=message+'\n\n'+status.lastReading;report('watching',message);}
     else{report('confirming',overview.weapon+' camo totals detected. Keep this screen visible for one more check…');}
     return;
    }
    if(!root.CamoRewardParser.key(reading.header).replace(/0/g,'O').includes('TOPPERFORMINGWEAPONS')){
     blockedUntil=performance.now()+8000;pending=null;burstUntil=0;burstDeadline=0;status.lastFailure='No recognised camo/results header.';await setCaptureRate(1,run);if(run!==generation)return;report('watching','No results or camo header confirmed. OCR resting; the failed text remains in Last recognised text.');return;
    }
    resultsSeenAt=performance.now();
    status.lastFailure='';
    const reward=confirm(reading,frameHash);
    if(reward)report('watching',reward.weapon+' — '+reward.name+(reward.applyResult==='failed'?' could not be saved. Check browser storage.':reward.applyResult==='already-recorded'?' was already recorded; manual corrections preserved.':' recognised. Progress saved automatically.'));
    else if(pending)report('confirming','Camo reward detected. Checking that the card is stable…');
    else report('watching','Results visible. Waiting for a readable camo reward; attachment and level totals are ignored.');
   }catch(error){if(run===generation){stop();report('error','Recognition stopped: '+error.message+' Try Start tracking again.');}}
   finally{
    if(run===generation&&status.running&&worker&&performance.now()-resultsSeenAt>15000){
     const retiring=worker;worker=null;status.ocrLoaded=false;cache=null;await retiring.terminate().catch(()=>{});
     if(run===generation)report('watching',(status.lastFailure?'Last check: '+status.lastFailure+' ':'Waiting for camo menus or after-match rewards. ')+'OCR unloaded to save memory; small banner checks continue.');
    }
    if(busyRun===run)busyRun=0;
    if(run===generation&&status.running)timer=setTimeout(()=>scan(run),delay);
   }
  }
  async function start(){
   if(status.running)return;
   const run=++generation;release();status.running=true;status.checks=0;status.reads=0;status.lastReadMs=0;status.confirmed=0;status.saved=0;status.lastReading='No OCR reading yet.';
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
    status.captureFPS=track.getSettings().frameRate||1;
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
  function checkNow(){if(!status.running||['starting','loading'].includes(status.phase))return;forceScans=2;forceBudget=3;blockedUntil=0;cache=null;pendingCategories.clear();if(busyRun!==generation){clearTimeout(timer);scan(generation);}}
  function drawPreview(canvas){if(!video||video.readyState<2)return false;canvas.width=480;canvas.height=Math.max(1,Math.round(480*video.videoHeight/video.videoWidth));canvas.getContext('2d').drawImage(video,0,0,canvas.width,canvas.height);return true;}
  return {start,stop,checkNow,drawPreview,getStatus:()=>({...status})};
 }
 root.BrowserCamoCapture={create,createOCR,crop,bannerCandidate,menuCandidate,frameCrops,readCrops,overviewCrops,readOverviewCrops,readWideOverview,REGIONS,MENU_REGIONS};
})(window);
