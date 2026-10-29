/* v2 browser tracker. One low-rate display stream, one OCR worker, no uploads or saved frames.
   - OCR runs only when a screen area settles to new content, so moving gameplay costs only tiny pixel checks.
   - Screens are recognised by reading their heading text, not colour probes; the heading's position and size
     place the reading areas, so other resolutions and interface scales do not need hand-tuned crops.
   - OCR text is decoded against the known vocabulary (CamoVocab). A full read plus an independent tight
     re-read of the same lines must agree before anything is saved. Automatic tracking only ever adds progress. */
(function(root){
 'use strict';
 const V=root.CamoVocab;
 const BUILD='2026-10-29-v2-10';
 const STRIP=[0,0,.5,.2];// where both screen headings live, with room for other UI scales and ultrawide pillarboxing
 const REWARD_BAND=[.08,.6,.84,.15];// strip holding the card labels and type lines (fraction of frame), wide enough for side-by-side cards; kept short because every read scans it
 const STILL=.006,FRESH=.01,CALM=.05,PIXEL=32,RESULTS_LIMITS={still:.04,fresh:.02},RESULTS_READ_MS=150,RESULTS_CONFIRM_MS=3000,RESULTS_CHANGE=.2;// a new card or weapon changes far more than particles// live menus animate (glowing selected tile), so 'still' tolerates a little motion
 const SAMPLE_MS={none:500,menu:500,results:150};
 const FORCE_MS=4000,STRIP_LIMITS={still:.03,fresh:.02};// read anyway if an area keeps moving slightly (animated backgrounds) for this long
 const MENU_WHITELIST='ACDEILMNOPRSTY0123456789/ ',DIGITS=/\d/;

 /* ---- pixels ---- */
 const size=source=>[source.videoWidth||source.naturalWidth||source.width,source.videoHeight||source.naturalHeight||source.height];
 const clampRegion=([x,y,w,h],W,H)=>{const x0=Math.max(0,Math.round(x)),y0=Math.max(0,Math.round(y));return [x0,y0,Math.max(1,Math.min(W,Math.round(x+w))-x0),Math.max(1,Math.min(H,Math.round(y+h))-y0)];};
 const fraction=([x,y,w,h],W,H)=>[x*W,y*H,w*W,h*H];
 function draw(source,region,w,h){const c=document.createElement('canvas');c.width=w;c.height=h;c.getContext('2d',{willReadFrequently:true}).drawImage(source,region[0],region[1],region[2],region[3],0,0,w,h);return c;}
 /* Small greyscale copy used only to decide whether an area is moving; never kept beyond the current comparison. */
 function thumb(source,region){
  const w=Math.max(8,Math.min(200,Math.round(region[2]/2.5))),h=Math.max(8,Math.min(400,Math.round(region[3]/2.5)));
  const p=draw(source,region,w,h).getContext('2d').getImageData(0,0,w,h).data,g=new Uint8Array(w*h);
  for(let i=0,j=0;j<g.length;i+=4,j++)g[j]=(p[i]*77+p[i+1]*150+p[i+2]*29)>>8;
  return g;
 }
 const join=(a,b)=>{const c=new Uint8Array(a.length+b.length);c.set(a);c.set(b,a.length);return c;};
 function changed(a,b){if(!a||!b||a.length!==b.length)return 1;let n=0;for(let i=0;i<a.length;i++)if(Math.abs(a[i]-b[i])>PIXEL)n++;return n/a.length;}
 /* Greyscale with the contrast stretched, scaled so text is a comfortable size for OCR, padded in the
    background colour. invert=true serves dark-on-light text (the weapon tab) when a plain pass did not find it. */
 function normalize(source,region,scale,invert=false){
  const pad=10,w=Math.max(1,Math.round(region[2]*scale)),h=Math.max(1,Math.round(region[3]*scale));
  const src=draw(source,region,w,h).getContext('2d').getImageData(0,0,w,h).data,g=new Uint8Array(w*h),hist=new Uint32Array(256);
  for(let i=0,j=0;j<g.length;i+=4,j++){g[j]=(src[i]*77+src[i+1]*150+src[i+2]*29)>>8;hist[g[j]]++;}
  let lo=0,hi=255,acc=0;for(;lo<255&&(acc+=hist[lo])<g.length*.01;lo++);acc=0;for(;hi>0&&(acc+=hist[hi])<g.length*.01;hi--);
  const span=Math.max(1,hi-lo),out=document.createElement('canvas');out.width=w+pad*2;out.height=h+pad*2;
  const ctx=out.getContext('2d'),image=ctx.createImageData(out.width,out.height),o=image.data;
  let border=0;for(let x=0;x<w;x++)border+=g[x]+g[(h-1)*w+x];border=Math.round(border/(2*w));
  const map=v=>{const s=Math.max(0,Math.min(255,Math.round((v-lo)*255/span)));return invert?255-s:s;},fill=map(border);
  for(let k=0;k<o.length;k+=4){o[k]=o[k+1]=o[k+2]=fill;o[k+3]=255;}
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const v=map(g[y*w+x]),k=((y+pad)*out.width+x+pad)*4;o[k]=o[k+1]=o[k+2]=v;}
  ctx.putImageData(image,0,0);
  return {canvas:out,toFrame:([bx0,by0,bx1,by1])=>[region[0]+(bx0-pad)/scale,region[1]+(by0-pad)/scale,region[0]+(bx1-pad)/scale,region[1]+(by1-pad)/scale]};
 }
 /* Text-line boxes (frame coordinates) from horizontal contrast edges: rows with many edges form bands, and
    runs of edge columns within a band form lines. Bands far taller than text (pictures, tiles) are skipped. */
 function segment(source,region){
  const scale=Math.min(1,1200/region[2]),w=Math.max(8,Math.round(region[2]*scale)),h=Math.max(8,Math.round(region[3]*scale));
  const p=draw(source,region,w,h).getContext('2d').getImageData(0,0,w,h).data,g=new Uint8Array(w*h);
  for(let i=0,j=0;j<g.length;i+=4,j++)g[j]=(p[i]*77+p[i+1]*150+p[i+2]*29)>>8;
  const edge=new Uint8Array(w*h);
  for(let y=0;y<h;y++)for(let x=0;x<w-1;x++){const i=y*w+x;if(Math.abs(g[i+1]-g[i])>48)edge[i]=1;}
  const boxes=[];
  /* Bands of edge-rich rows within [xa,xb), then runs of edge columns within each band. The first pass uses the
     whole width; each run is then re-measured on its own columns, so a sidebar icon on the same rows cannot
     stretch a line's height (and a tall merged band is not thrown away). */
  function window(xa,xb,ya,yb,depth){
   const ww=xb-xa,rows=new Uint16Array(yb-ya),minRow=depth?Math.max(3,ww*.02):Math.max(3,ww*.004),bands=[];
   for(let y=ya;y<yb;y++){let n=0;for(let x=xa;x<xb;x++)n+=edge[y*w+x];rows[y-ya]=n;}
   for(let y=0;y<rows.length;){if(rows[y]<minRow){y++;continue;}let y1=y;while(y1<rows.length&&(rows[y1]>=minRow||(y1+1<rows.length&&rows[y1+1]>=minRow)))y1++;bands.push([ya+y,ya+y1]);y=y1+1;}
   for(const [y0,y1] of bands){
    const bh=y1-y0;if(bh<6||(depth&&bh>90))continue;
    const cols=new Uint16Array(ww);for(let y=y0;y<y1;y++)for(let x=xa;x<xb;x++)cols[x-xa]+=edge[y*w+x];
    // The first pass must not bridge the gap between the left sidebar and the menu (tall merged bands would make it huge).
    const joinGap=Math.max(4,Math.min(bh,depth?60:24)*1.2);let x=0;
    while(x<ww){
     if(!cols[x]){x++;continue;}
     let x1=x,last=x,count=0;while(x1<ww&&x1-last<=joinGap){if(cols[x1]){last=x1;count+=cols[x1];}x1++;}
     const width=last-x+1;
     if(width>=Math.min(bh,60)*.8&&count/(width*bh)>=.04){
      if(!depth)window(xa+x,xa+last+1,y0,y1,1);
      else for(const [a,b] of polaritySplit(g,w,h,xa+x,xa+last+1,y0,y1))boxes.push([region[0]+a/scale,region[1]+y0/scale,region[0]+b/scale,region[1]+y1/scale]);
     }
     x=last+1;
    }
   }
  }
  window(0,w,0,h,0);
  return boxes;
 }
 /* Splits a text run where its background flips between light and dark (e.g. a white weapon tab directly
    beside a dark "MODE MASTERY" tab), so each piece is read with a single text colour. The background is the
    median of a margin above and below the text, which is mostly tab or menu colour rather than letters. */
 function polaritySplit(g,w,h,xa,xb,y0,y1){
  const bh=y1-y0,n=xb-xa,m=Math.max(2,Math.round(bh*.4)),back=new Float32Array(n);
  const rows=[...Array(m).keys()].map(i=>y0-1-i).concat([...Array(m).keys()].map(i=>y1+i)).filter(y=>y>=0&&y<h);
  for(let x=xa;x<xb;x++){const col=rows.map(y=>g[y*w+x]).sort((p,q)=>p-q);back[x-xa]=col.length?col[col.length>>1]:0;}
  const runs=[];for(let i=0;i<n;){const b=back[i]>128;let j=i;while(j<n&&(back[j]>128)===b)j++;runs.push([i,j]);i=j;}
  const kept=[];for(const r of runs){if(kept.length&&(r[1]-r[0]<bh*1.5||kept.at(-1)[1]-kept.at(-1)[0]<bh*1.5))kept.at(-1)[1]=r[1];else kept.push([...r]);}
  return kept.map(([a,b])=>[xa+a,xa+b]);
 }
 /* Camo tiles directly under a category label, found from texture/contrast. Used for Military, whose tiles are
    always textured; returns null unless exactly the expected rows×columns are found. */
 function detectTiles(source,label,bottom,cols,rows,W,H){
  const h=Math.max(6,label[3]-label[1]),region=clampRegion([label[0]-h*.6,label[3]+h*.2,h*31,bottom-label[3]-h*.3],W,H);
  const [rx,ry,w,ht]=region;if(ht<h*2.5)return null;
  const p=draw(source,region,w,ht).getContext('2d').getImageData(0,0,w,ht).data,g=new Uint8Array(w*ht);
  for(let i=0,j=0;j<g.length;i+=4,j++)g[j]=(p[i]*77+p[i+1]*150+p[i+2]*29)>>8;
  const sorted=Uint8Array.from(g).sort(),background=sorted[Math.floor(g.length*.2)],on=new Uint8Array(w*ht);
  for(let y=1;y<ht;y++)for(let x=1;x<w;x++){const i=y*w+x;on[i]=Math.abs(g[i]-g[i-1])>20||Math.abs(g[i]-g[i-w])>20||Math.abs(g[i]-background)>22?1:0;}
  const runsOf=(count,len,min)=>{const d=Array.from({length:len},(_,i)=>count(i)),top=[...d].sort((a,b)=>b-a)[Math.floor(len*.1)]||0,thr=Math.max(.15,top*.5),out=[];
   for(let i=0;i<len;){if(d[i]<thr){i++;continue;}let j=i;while(j<len&&d[j]>=thr)j++;if(j-i>=min)out.push([i,j]);i=j;}return out;};
  const xs=runsOf(x=>{let s=0;for(let y=0;y<ht;y++)s+=on[y*w+x];return s/ht;},w,h*2.5);
  if(xs.length<2)return null;
  const ys=runsOf(y=>{let s=0;for(let x=xs[0][0];x<xs[1][1];x++)s+=on[y*w+x];return s/(xs[1][1]-xs[0][0]);},ht,h*2.5);
  if(ys.length!==rows)return null;
  // Tiles are equal squares: size from the row height, spacing from the first two columns (later columns can
  // merge with neighbouring artwork), then the grid is laid out from the first tile.
  const size=ys.map(([a,b])=>b-a).sort((a,b)=>a-b)[ys.length>>1],gap=xs[1][0]-xs[0][0]-size;
  if(Math.abs(xs[0][1]-xs[0][0]-size)>size*.2||gap<0||gap>size*.5||rx+xs[0][0]+cols*size+(cols-1)*gap>W)return null;
  return ys.flatMap(([ya])=>[...Array(cols).keys()].map(i=>{const x=rx+xs[0][0]+i*(size+gap);return [x,ry+ya,x+size,ry+ya+size];}));
 }
 /* Every camo group spans the same row width with the same gap between tiles (measured on Military), so the
    tiles of the other groups follow from their column count, even when a tile is too dark to detect. */
 function gridModel(militaryTiles,militaryLabel){
  const row=militaryTiles.slice(0,4),x0=row[0][0],x1=row[3][2],gap=(row[3][0]-row[0][2]-(row[1][2]-row[1][0])-(row[2][2]-row[2][0]))/3;
  return {x0,x1,gap,offset:row[0][1]-militaryLabel[3]};
 }
 function modelTiles(model,label,cols){
  const s=(model.x1-model.x0-(cols-1)*model.gap)/cols,y=label[3]+model.offset;
  return [...Array(cols).keys()].map(i=>{const x=model.x0+i*(s+model.gap);return [x,y,x+s,y+s];});
 }
 /* A padlock is a compact near-white blob, about a sixth of the tile wide, in the tile's top-left corner. */
 function locked(source,frame,W,H){
  const s=Math.min(frame[2]-frame[0],frame[3]-frame[1]),zone=clampRegion([frame[0]-s*.06,frame[1]-s*.06,s*.36,s*.36],W,H),[,,zw,zh]=zone;
  const p=draw(source,zone,zw,zh).getContext('2d').getImageData(0,0,zw,zh).data,seen=new Uint8Array(zw*zh);
  // The padlock is whiter than its tile: on a light (silver) tile a fixed threshold would merge it with the tile.
  const lum=[];for(let i=0;i<zw*zh;i++)lum.push(Math.min(p[i*4],p[i*4+1],p[i*4+2]));lum.sort((a,b)=>a-b);
  const level=Math.min(215,Math.max(150,lum[Math.floor(lum.length*.75)]+30));
  const white=i=>{const r=p[i*4],g=p[i*4+1],b=p[i*4+2];return Math.min(r,g,b)>level&&Math.max(r,g,b)-Math.min(r,g,b)<75;};
  let best=null;
  for(let start=0;start<zw*zh;start++){
   if(seen[start]||!white(start))continue;
   let n=0,minX=zw,maxX=0,minY=zh,maxY=0;const stack=[start];seen[start]=1;
   while(stack.length){const i=stack.pop(),x=i%zw,y=(i-x)/zw;n++;minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);
    for(const j of [x+1<zw?i+1:-1,x>0?i-1:-1,i+zw<zw*zh?i+zw:-1,i-zw]){if(j<0||seen[j]||!white(j))continue;seen[j]=1;stack.push(j);}}
   if(!best||n>best.n)best={n,w:maxX-minX+1,h:maxY-minY+1};
  }
  return !!best&&best.w>=s*.07&&best.w<=s*.28&&best.h>=s*.08&&best.h<=s*.3&&best.n/(best.w*best.h)>=.3;
 }
 const GROUP_COLUMNS={MILITARY:4,SPECIAL:3,COMPLETIONIST:4,PRESTIGE:4};
 /* Padlock state of every tile in each category read from the menu, e.g. {SPECIAL:[false,false,true]} (true = locked).
    Empty when the Military grid cannot be measured; totals are then used without the tile cross-check. */
 function groupTiles(source,categories,W,H){
  const byY=[...categories].sort((a,b)=>a.line.frame[1]-b.line.frame[1]),military=byY.find(c=>c.category==='MILITARY');
  if(!military)return {};
  const next=byY[byY.indexOf(military)+1],label=military.line.frame,h=label[3]-label[1];
  const tiles=detectTiles(source,label,next?next.line.frame[1]:label[3]+h*14,4,2,W,H);
  if(!tiles)return {};
  const model=gridModel(tiles,label),out={MILITARY:tiles.map(f=>locked(source,f,W,H))};
  for(const c of byY)if(c.category!=='MILITARY')out[c.category]=modelTiles(model,c.line.frame,GROUP_COLUMNS[c.category]).map(f=>locked(source,f,W,H));
  return out;
 }
 /* Median brightness of a line crop: light for text on a light tab, dark for text on the dark menu. */
 function backgroundBrightness(source,region){
  const w=Math.max(4,Math.min(96,Math.round(region[2]/3))),h=Math.max(4,Math.min(24,Math.round(region[3]/3)));
  const p=draw(source,region,w,h).getContext('2d').getImageData(0,0,w,h).data,v=[];
  for(let i=0;i<p.length;i+=4)v.push((p[i]*77+p[i+1]*150+p[i+2]*29)>>8);
  v.sort((a,b)=>a-b);return v[v.length>>1];
 }

 /* ---- OCR ---- */
 let libraryPromise;
 function loadLibrary(){
  if(root.Tesseract)return Promise.resolve();
  if(!libraryPromise)libraryPromise=new Promise((resolve,reject)=>{const s=document.createElement('script');s.src=new URL('vendor/ocr/tesseract.min.js',document.baseURI).href;s.onload=resolve;s.onerror=()=>{s.remove();libraryPromise=null;reject(Error('Could not load local OCR files. Check your connection and try again.'));};document.head.append(s);});
  return libraryPromise;
 }
 async function createOCR(onProgress=()=>{}){
  await loadLibrary();const base=new URL('vendor/ocr/',document.baseURI).href;
  const worker=await root.Tesseract.createWorker('eng',1,{workerPath:base+'worker.min.js',corePath:base+'core',langPath:base+'lang',workerBlobURL:false,logger:m=>{if(m.status!=='recognizing text')onProgress(m.status,m.progress);}},{load_system_dawg:'0',load_freq_dawg:'0'});
  await worker.setParameters({user_defined_dpi:'150',preserve_interword_spaces:'1'});
  let params='';
  return {
   async read(canvas,{psm,whitelist=''}){
    const next=psm+'|'+whitelist;if(next!==params){await worker.setParameters({tessedit_pageseg_mode:String(psm),tessedit_char_whitelist:whitelist});params=next;}
    const {data}=await worker.recognize(canvas,{},{text:true,blocks:true});
    const lines=(data.blocks||[]).flatMap(b=>(b.paragraphs||[]).flatMap(p=>p.lines||[])).map(l=>({text:String(l.text||'').trim(),confidence:l.confidence??data.confidence??0,bbox:[l.bbox.x0,l.bbox.y0,l.bbox.x1,l.bbox.y1]})).filter(l=>l.text);
    return {lines,text:String(data.text||''),confidence:data.confidence||0};
   },
   terminate:()=>worker.terminate()
  };
 }

 /* Timer in a dedicated worker: page timers in hidden tabs are batched/clamped by browsers; worker timers usually are not. */
 function makeTicker(){
  try{
   const url=URL.createObjectURL(new Blob(['let t;onmessage=e=>{clearTimeout(t);if(e.data>=0)t=setTimeout(()=>postMessage(0),e.data)}'],{type:'text/javascript'}));
   const w=new Worker(url);URL.revokeObjectURL(url);let fn=null;w.onmessage=()=>fn?.();
   return {kind:'worker',after(ms,f){fn=f;w.postMessage(ms);},stop(){fn=null;w.postMessage(-1);w.terminate();}};
  }catch{let t;return {kind:'page',after(ms,f){clearTimeout(t);t=setTimeout(f,ms);},stop(){clearTimeout(t);}};}
 }

 function create({catalog,onReward,onOverview=()=>{},onStatus}){
  let generation=0,stream=null,video=null,ocr=null,ocrStarting=null,ticker=null,busy=false;
  let screen=null,strip=null,area=null,pending=null,manual=false,resultsUntil=0;
  const status={build:BUILD,engine:'v2',phase:'stopped',message:'Ready when you are.',running:false,checks:0,reads:0,lastReadMs:0,ocrBusyMs:0,prepMs:0,segmentMs:0,tickMs:0,source:'',ocrLoaded:false,captureFPS:4,width:0,height:0,frames:0,lastReading:'No OCR reading yet.',lastScreenScan:'No screen scan yet.',layout:'searching',confirmed:0,saved:0};
  const events=[],lastReadings={},lastRejected={},longGaps=[];
  let lastLoopAt=0,largestGapMs=0,workerStarts=0,previousStatus='',tickerKind='';
  const now=()=>performance.now();
  function note(type,detail={}){events.push({at:new Date().toISOString(),type,...detail});if(events.length>200)events.shift();}
  function report(phase,message){Object.assign(status,{phase,message});const key=phase+'|'+message;if(key!==previousStatus){previousStatus=key;note('status',{phase,message:String(message).slice(0,500)});}onStatus({...status});}
  function reject(mode,reason,lines){lastRejected[mode]={at:new Date().toISOString(),reason,lines:(lines||[]).slice(0,30).map(l=>({text:l.text.slice(0,120),confidence:Math.round(l.confidence)}))};if(events.at(-1)?.reason!==reason)note('parser-rejected',{mode,reason});}
  const watch=()=>({prev:null,read:null,calmSince:0,readAt:0});
  /* Settled: unchanged since the previous sample. Fresh: different from what was last read. */
  function observe(w,t,limits={still:STILL,fresh:FRESH}){
   const delta=changed(t,w.prev);w.prev=t;
   const fresh=changed(t,w.read)>limits.fresh,settled=delta<=limits.still,calm=delta<=CALM;
   if(!calm)w.calmSince=0;else if(!w.calmSince)w.calmSince=now();
   const forced=calm&&fresh&&w.calmSince&&now()-w.calmSince>=FORCE_MS&&now()-w.readAt>=FORCE_MS;
   return {settled,fresh,forced,delta};
  }

  async function ensureOCR(run){
   if(ocr)return ocr;
   if(!ocrStarting){workerStarts++;note('worker',{action:'start',starts:workerStarts});ocrStarting=createOCR((name,progress)=>{if(run===generation&&status.phase==='loading')report('loading','Preparing local OCR: '+name+(Number.isFinite(progress)?' '+Math.round(progress*100)+'%':'')+'.');}).finally(()=>{ocrStarting=null;});}
   const created=await ocrStarting;if(run!==generation){await created.terminate().catch(()=>{});return null;}
   ocr=created;status.ocrLoaded=true;return ocr;
  }
  async function read(run,mode,source,region,{psm=11,whitelist='',textHeight,scale,invert=false}){
   const engine=await ensureOCR(run);if(!engine)return null;
   const s=scale??(textHeight>=18&&textHeight<=40?1:Math.max(.5,Math.min(3,24/textHeight)));
   const prep=now(),{canvas,toFrame}=normalize(source,region,s,invert);status.prepMs+=now()-prep;
   const start=now(),result=await engine.read(canvas,{psm,whitelist});if(run!==generation)return null;
   const ms=now()-start;status.reads++;status.lastReadMs=Math.round(ms);status.ocrBusyMs+=ms;
   const lines=result.lines.map(l=>({...l,frame:toFrame(l.bbox),inverted:invert}));
   note('ocr',{mode,psm,elapsedMs:Math.round(ms),lines:lines.length});
   lastReadings[mode]={at:new Date().toISOString(),psm,lines:lines.slice(0,30).map(l=>({text:l.text.slice(0,120),confidence:Math.round(l.confidence)}))};
   return lines;
  }
  /* Reads an area line by line. Lines are found from horizontal contrast edges, which works for either text
     colour and for text inside solid tabs (where whole-page OCR layout analysis fails). Each line is then read
     as a tight single-line crop, with dark backgrounds inverted so the OCR always sees dark text on light.
     stop(lines) may end early once the needed text is found. */
  async function readArea(run,mode,region,{order='top',limit=14,stop=()=>false,minAspect=0}={}){
   const seg=now(),found=segment(video,region);status.segmentMs+=now()-seg;
   const boxes=found.filter(b=>b[2]-b[0]>=(b[3]-b[1])*minAspect);
   if(order==='large')boxes.sort((a,b)=>(b[3]-b[1])-(a[3]-a[1]));
   // Card labels are wide, short boxes; particle specks are tiny, so read the widest text-height boxes first.
   if(order==='wide')boxes.sort((a,b)=>(b[2]-b[0])*((b[3]-b[1])<=60)-(a[2]-a[0])*((a[3]-a[1])<=60));
   const lines=[];note('segment',{mode,boxes:boxes.length});
   for(const box of boxes.slice(0,limit)){
    const got=await readLine(run,mode,box);if(!got)return null;
    if(got.text)lines.push(got);
    if(stop(lines))break;
   }
   return lines.sort((a,b)=>a.frame[1]-b.frame[1]||a.frame[0]-b.frame[0]);
  }
  async function readLine(run,mode,frame,whitelist='',psm=7){
   const h=frame[3]-frame[1],region=clampRegion([frame[0]-h*.3,frame[1]-h*.2,frame[2]-frame[0]+h*.6,h*1.4],...size(video));
   const invert=backgroundBrightness(video,region)<110;
   const got=await read(run,mode,video,region,{psm,whitelist,textHeight:h,scale:Math.max(.6,Math.min(3,28/h)),invert});if(!got)return null;
   return {text:got.map(l=>l.text).join(' ').trim(),confidence:got.length?Math.min(100,...got.map(l=>l.confidence)):0,frame,inverted:invert};
  }

  /* ---- screen detection ---- */
  async function findScreen(run,W,H,why){
   const region=clampRegion(fraction(STRIP,W,H),W,H);
   report('reading',why==='manual'?'Looking for a camo menu or results heading…':'A menu settled. Reading its heading…');
   const lines=await readArea(run,'heading',region,{order:'large',limit:8,stop:l=>!!V.anchorIn(l)});if(!lines)return;
   strip.read=strip.prev;strip.readAt=now();
   const anchor=V.anchorIn(lines);
   if(!anchor){reject('heading','No camo menu or results heading in the top-left of the screen.',lines);status.lastScreenScan='No Camo Select or Top Performing Weapons heading found.\n'+lines.map(l=>l.text).join('\n');report('watching','Watching. Small checks only while the game is moving.');return;}
   const [x0,y0,x1,y1]=anchor.line.frame,u=Math.max(8,y1-y0);
   const headingRegion=clampRegion([x0,y0,x1-x0,y1-y0],W,H);
   screen={kind:anchor.screen,u,box:[x0,y0,x1,y1],headingRegion,heading:thumb(video,headingRegion),missing:0,attempts:0,since:now()};
   if(anchor.screen==='menu'){
    // Weapon heading and category totals sit in a column under the title.
    screen.regions={column:clampRegion([x0-u*2,y0+u*.8,Math.max(u*16,W*.2),H*.85-y0],W,H)};
   }else{
    // The weapon name is about three header-heights tall and starts a little below the header.
    // A heading measured mid-animation can be mis-sized, so the band also has a floor from the screen size.
    screen.regions={weapon:clampRegion([Math.max(0,x0-u*2),y0,Math.max(u*20,W*.32),Math.max(y1-y0+u*8,H*.16)],W,H),reward:clampRegion(fraction(REWARD_BAND,W,H),W,H)};
   }
   area=watch();pending=null;
   status.layout=anchor.screen+' heading at '+Math.round(x0)+','+Math.round(y0)+' (text '+Math.round(u)+' px)';
   note('screen',{action:'enter',kind:anchor.screen,heading:anchor.line.text.slice(0,60),x:Math.round(x0),y:Math.round(y0),u:Math.round(u)});
   report('reading',anchor.screen==='menu'?'Camo menu found. Reading the weapon and category totals…':'After-match results found. Reading each weapon card…');
  }
  function stillOnScreen(){
   const delta=changed(thumb(video,screen.headingRegion),screen.heading);
   screen.missing=delta>.3?screen.missing+1:0;// only a real screen change replaces most of the heading
   // White flashes between results cards hide the heading for a moment; only a lasting absence closes the screen.
   if(screen.missing<(screen.kind==='results'?10:3))return true;
   note('screen',{action:'leave',kind:screen.kind,seconds:Math.round((now()-screen.since)/1000)});
   // Card transitions can briefly replace the heading; look again quickly so the next card is not missed.
   if(screen.kind==='results')resultsUntil=now()+10000;
   screen=null;area=null;pending=null;strip=watch();status.layout='searching';return false;
  }

  /* ---- camo menu ---- */
  function groupCamos(weapon,category){
   if(category==='PRESTIGE')return (catalog.extras||[]).filter(c=>c.weapon===weapon&&/prestige/i.test(c.id)).sort((a,b)=>Number(a.id.split(':').pop())-Number(b.id.split(':').pop()));
   const tier={SPECIAL:'Special',COMPLETIONIST:'Completionist'}[category];
   return catalog.challenges.filter(c=>c.weapon===weapon&&c.tier===tier).sort((a,b)=>a.slot-b.slot);
  }
  function menuEntries(decoded){return decoded.categories.map(c=>({kind:'category',category:c.category,weapon:decoded.weapon,current:c.current,target:c.target,challenge:c.category+' category unlocks',
   // Same receipt prefix as v1, so an unchanged reading never undoes a manual correction made after a v1 save.
   observedAt:'browser-menu-v1:'+c.current+'/'+c.target}));}
  async function readMenu(run,W,H){
   const u=screen.u;
   if(pending&&pending.kind==='menu'){
    // Independent confirmation: tight single-line reads of the lines the full read found.
    const lines=[];
    for(const parts of [[pending.weaponLine],...pending.categoryLines]){
     // A label and its total split over two lines are re-read together as a small block.
     const f=parts.map(p=>p.frame),frame=[Math.min(...f.map(b=>b[0])),Math.min(...f.map(b=>b[1])),Math.max(...f.map(b=>b[2])),Math.max(...f.map(b=>b[3]))];
     // Same unrestricted character set as the first read: a whitelist without brackets mangled "[3/3]" totals.
     const got=await readLine(run,'menu-confirm',frame,'',parts.length>1?6:7);if(!got)return;
     lines.push(got);
    }
    const second=V.decodeMenu(lines,catalog),first=pending.decoded,tiles=pending.tiles;pending=null;
    const tilesNow=groupTiles(video,first.categories,W,H);
    note('menu-reads',{first:first.categories.map(c=>c.category+' '+c.current+'/'+c.target).join(', '),second:second.categories.map(c=>c.category+' '+c.current+'/'+c.target).join(', '),confirmText:lines.map(l=>l.text).join(' | ').slice(0,200)});
    let agreed=first.weapon===second.weapon?first.categories.filter(a=>second.categories.some(b=>b.category===a.category&&b.current===a.current&&b.target===a.target)):[];
    // Cross-check each total against the padlocked tiles (both reads). This also catches a slashed zero read as 8.
    agreed=agreed.filter(c=>{
     const t=tiles[c.category];if(!t)return true;
     const ok=JSON.stringify(t)===JSON.stringify(tilesNow[c.category])&&t.filter(x=>!x).length===c.current;
     if(!ok)note('tile-mismatch',{category:c.category,total:c.current+'/'+c.target,tiles:t.map(x=>x?'L':'u').join(''),again:(tilesNow[c.category]||[]).map(x=>x?'L':'u').join('')});
     c.tiles=ok?t:null;return ok;
    });
    if(!agreed.length){reject('menu','Confirmation read disagreed: '+(second.weapon||'no weapon')+' '+second.categories.map(c=>c.category+' '+c.current+'/'+c.target).join(', '),lines);screen.retry=true;report('confirming',(first.weapon||'Weapon')+' totals did not match on the second read. Reading again…');return;}
    screen.retry=false;status.confirmed++;
    // Each visit to a weapon's camo menu re-applies what the game shows (once per visit), so a manual reset is
    // corrected the next time the menu is opened. Automatic tracking only ever adds unlocks.
    const reapply=manual||!(screen.reapplied??=new Set()).has(first.weapon);screen.reapplied.add(first.weapon);
    let result=onOverview({weapon:first.weapon,entries:menuEntries({...first,categories:agreed}),reapply});manual=false;
    if(result==='saved')status.saved++;
    // A partial group's unlocked camos are exactly its tiles without a padlock (tile order = catalogue order).
    const named=[];
    for(const c of agreed){
     if(!c.tiles||c.category==='MILITARY'||c.current===0||c.current===c.target)continue;
     // Tiles appear in catalogue order. The game shows a fourth Completionist tile the catalogue does not name yet;
     // the known camos map to the first tiles and an unlocked unknown tile is left alone rather than guessed.
     const camos=groupCamos(first.weapon,c.category);if(!camos.length||camos.length>c.tiles.length){note('tiles-unmapped',{category:c.category,tiles:c.tiles.length,camos:camos.length});continue;}
     if(camos.length<c.tiles.length)note('tiles-unnamed',{category:c.category,unnamed:c.tiles.length-camos.length,unlocked:c.tiles.slice(camos.length).filter(x=>!x).length});
     for(const [i,camo] of camos.entries())if(!c.tiles[i]){const r=onReward({id:camo.id,weapon:first.weapon,name:camo.name,slot:camo.slot,military:false,reapply});named.push(camo.name);if(r==='saved'){status.saved++;result='saved';}note('apply',{mode:'menu-tile',weapon:first.weapon,camo:camo.name,result:r});}
    }
    note('apply',{mode:'menu',weapon:first.weapon,totals:agreed.map(c=>c.category+' '+c.current+'/'+c.target),result});
    const summary=agreed.map(c=>c.category.toLowerCase()+' '+c.current+'/'+c.target).join(' · ')+(named.length?' ('+named.join(', ')+')':'');
    status.lastScreenScan=first.weapon+': '+summary+' ('+result+')';
    report('watching',first.weapon+' '+(result==='failed'?'could not be saved':result==='already-recorded'?'already recorded; manual corrections preserved':'saved')+': '+summary+'.'+(agreed.some(c=>c.category==='MILITARY')?'':' Military total was not read.'));
    return;
   }
   // Menu text lines are wide; sidebar icons and the level number are narrow and would use up the read budget.
   const lines=await readArea(run,'menu',screen.regions.column,{limit:20,minAspect:3});if(!lines)return;
   area.read=area.prev;area.readAt=now();screen.attempts++;
   const decoded=V.decodeMenu(lines,catalog);
   status.lastReading=lines.map(l=>l.text+' ('+Math.round(l.confidence)+'%)').join('\n').slice(0,1600);
   if(!decoded.weapon||!decoded.categories.length){reject('menu',decoded.issues.join(' ')||'No category totals read.',lines);screen.retry=true;report('watching',(decoded.weapon?decoded.weapon+': ':'')+(decoded.issues[0]||'No category totals read.')+' Will read again when the menu changes.');return;}
   pending={kind:'menu',decoded,weaponLine:decoded.weaponLine,categoryLines:decoded.categories.map(c=>c.parts),tiles:groupTiles(video,decoded.categories,W,H),at:now(),view:area.prev};
   report('confirming',decoded.weapon+' camo totals read. Confirming with a second read…');
  }

  /* ---- after-match results ---- */
  /* Results cards zoom and flash between reads, so a reward is confirmed by two separate reads (different
     frames, at most RESULTS_CONFIRM_MS apart) that decode to the same camo for the same weapon. */
  async function readResults(run,W,H){
   // The weapon name changes less often than the cards; re-read it only when its area changed.
   const nameView=area.prev;
   // A read taken mid-flash can come back unreadable: it never replaces the last good read, and that good read is
   // reused only while the name area still looks the same (so a camo is never credited to the previous weapon).
   let weaponLines=screen.weaponLines;
   if(!weaponLines||changed(nameView,screen.weaponView)>FRESH){
    const got=await readArea(run,'reward-weapon',screen.regions.weapon,{limit:4});if(!got)return;
    if(V.decodeReward(got,[],catalog).issue!=='No single weapon name matched.'){screen.weaponLines=weaponLines=got;screen.weaponView=nameView;}
    else weaponLines=screen.weaponLines&&changed(nameView,screen.weaponView)<=.05?screen.weaponLines:got;
   }
   const rewardLines=await readArea(run,'reward',screen.regions.reward,{order:'wide',limit:4,minAspect:2.5,stop:l=>!!V.decodeReward(weaponLines,l,catalog).reward});if(!rewardLines)return;
   area.read=area.prev;area.readAt=now();if(area.card){area.card.read=area.card.prev;area.card.readAt=now();}screen.attempts++;manual=false;
   const decoded=V.decodeReward(weaponLines,rewardLines,catalog);
   status.lastReading=['Weapon: '+weaponLines.map(l=>l.text).join(' / '),'Reward: '+rewardLines.map(l=>l.text).join(' / ')].join('\n').slice(0,1600);
   // Most results cards are XP or attachments; only retry when a weapon was readable but its reward was not.
   note('card',{weapon:decoded.weapon||decoded.reward?.weapon||null,reward:decoded.reward?.name||null,issue:decoded.issue||null,text:rewardLines.map(l=>l.text).join(' / ').slice(0,80)});
   if(!decoded.reward){reject('reward',decoded.issue,[...weaponLines,...rewardLines]);screen.retry=!!decoded.weapon&&decoded.issue!=='No camo type label on the card.';report('watching','Results visible'+(decoded.weapon?' for '+decoded.weapon:'')+'. Waiting for a camo reward card; attachments, XP and levels are ignored.');return;}
   const r=decoded.reward,seen=screen.rewardSeen;
   if(!seen||seen.id!==r.id||now()-seen.at>RESULTS_CONFIRM_MS){screen.rewardSeen={id:r.id,at:now()};screen.retry=true;report('confirming',r.weapon+' — '+r.name+' read. Confirming…');return;}
   screen.rewardSeen=null;screen.retry=false;
   if(screen.applied?.has(r.id))return;(screen.applied??=new Set()).add(r.id);
   status.confirmed++;const result=onReward(r);if(result==='saved')status.saved++;
   note('apply',{mode:'reward',weapon:r.weapon,camo:r.name,result});
   report('watching',r.weapon+' — '+r.name+(result==='failed'?' could not be saved. Check browser storage.':result==='already-recorded'?' was already recorded; manual corrections preserved.':' recognised. Progress saved automatically.'));
  }


  /* ---- loop ---- */
  async function tick(run){
   if(run!==generation||!status.running)return;
   let delay=SAMPLE_MS.none;
   if(busy){ticker.after(100,()=>tick(run));return;}
   busy=true;const tickStart=now();
   try{
    if(!video||video.readyState<2||!video.videoWidth){report('waiting','Waiting for a visible game window.');return;}
    const t=now(),gap=lastLoopAt?t-lastLoopAt:0;lastLoopAt=t;largestGapMs=Math.max(largestGapMs,gap);if(gap>3000){longGaps.push({at:new Date().toISOString(),gapMs:Math.round(gap),visibility:document.visibilityState});if(longGaps.length>8)longGaps.shift();}
    const [W,H]=size(video);
    if(status.width!==W||status.height!==H){status.width=W;status.height=H;screen=null;area=null;pending=null;strip=watch();}
    status.checks++;status.frames=video.getVideoPlaybackQuality?.().totalVideoFrames||0;
    if(!screen){
     // Menus and results animate (glows, particles, flashes), so the heading strip only has to be nearly still;
     // gameplay (minimap, HUD) changes far more than this.
     const o=observe(strip,thumb(video,clampRegion(fraction(STRIP,W,H),W,H)),STRIP_LIMITS);
     if((o.settled&&o.fresh)||o.forced||manual){await findScreen(run,W,H,manual?'manual':o.forced?'forced':'settled');if(manual&&!screen)manual=false;}
     else if(status.phase!=='watching')report('watching','Watching. Small checks only while the game is moving; OCR waits for a menu or results screen.');
     delay=screen?SAMPLE_MS[screen.kind]:now()<resultsUntil?SAMPLE_MS.results:SAMPLE_MS.none;return;
    }
    if(!stillOnScreen()){report('watching','Screen closed. Watching for the next camo menu or results.');return;}
    delay=SAMPLE_MS[screen.kind];
    let view,o,limits={still:STILL,fresh:FRESH};
    if(screen.kind==='menu'){view=thumb(video,screen.regions.column);o=observe(area,view,limits);}
    else{
     /* Results cards last about two seconds and zoom, flash white and sit in moving particles, so they
        never truly settle. Read every RESULTS_READ_MS while the card differs from the last read, skipping
        white flash frames. This only runs during the short results screen, never in gameplay. */
     const name=thumb(video,screen.regions.weapon),card=thumb(video,screen.regions.reward);
     area.card??=watch();observe(area,name);const b=observe(area.card,card,RESULTS_LIMITS);
     view=join(name,card);limits={still:1,fresh:RESULTS_CHANGE};
     const flash=card.reduce((sum,v)=>sum+v,0)/card.length>185;
     const due=now()-(area.readAt||0)>=RESULTS_READ_MS;
     o={settled:!flash&&due,fresh:b.fresh||screen.retry,forced:false};
     if(b.fresh)screen.retry=false;// a new card gets a fresh start
    }
    if(o.settled&&o.fresh&&screen.kind==='menu'){screen.attempts=0;screen.retry=false;}
    if(pending){
     if(changed(view,pending.view)>limits.fresh){note('pending-dropped',{kind:pending.kind});pending=null;return;}// moved on before confirmation
     if(now()-(pending.at||0)<(screen.kind==='menu'?400:150))return;
    }else if(!(manual||o.forced||(o.settled&&(o.fresh||(screen.retry&&screen.attempts<3)))))return;
    if(screen.kind==='menu')await readMenu(run,W,H);else await readResults(run,W,H);
    if(pending&&!pending.at)pending.at=now();
   }catch(error){if(run===generation){stop();report('error','Recognition stopped: '+error.message+' Try Start tracking again.');}}
   finally{busy=false;status.tickMs+=now()-tickStart;if(run===generation&&status.running)ticker.after(delay,()=>tick(run));}
  }

  function release(){
   ticker?.stop();ticker=null;
   if(stream){for(const track of stream.getTracks()){track.onended=null;track.stop();}stream=null;}
   if(video){video.pause();video.srcObject=null;video.remove();video=null;}
   if(ocr){ocr.terminate().catch(()=>{});ocr=null;}
   screen=null;area=null;pending=null;manual=false;status.ocrLoaded=false;status.layout='searching';
  }
  function stop(message='Screen sharing and recognition stopped.'){generation++;release();status.running=false;report('stopped',message);}
  async function start(){
   if(status.running)return;
   const run=++generation;release();
   events.length=0;longGaps.length=0;for(const o of [lastReadings,lastRejected])for(const k of Object.keys(o))delete o[k];
   Object.assign(status,{running:true,checks:0,reads:0,lastReadMs:0,ocrBusyMs:0,prepMs:0,segmentMs:0,tickMs:0,confirmed:0,saved:0,width:0,height:0,frames:0,source:'',lastReading:'No OCR reading yet.',lastScreenScan:'No screen scan yet.'});
   lastLoopAt=0;largestGapMs=0;workerStarts=0;previousStatus='';strip=watch();
   report('starting','Choose the Call of Duty game window in the browser sharing dialog.');
   try{
    if(location.protocol==='file:'||!isSecureContext||!navigator.mediaDevices?.getDisplayMedia)throw Error('Open the hosted HTTPS tracker in a desktop browser for screen sharing. Manual tracking still works.');
    // Permission is requested directly from the user's click, before any other await.
    const selected=await navigator.mediaDevices.getDisplayMedia({video:{displaySurface:'window',frameRate:{ideal:4,max:4},width:{ideal:1920,max:1920}},audio:false,selfBrowserSurface:'exclude',systemAudio:'exclude'});
    if(run!==generation){selected.getTracks().forEach(t=>t.stop());return;}
    stream=selected;const track=stream.getVideoTracks()[0];if(!track)throw Error('No shared video track was returned.');
    track.onended=()=>stop('Sharing ended. Click Start tracking to share the game window again.');
    const settings=track.getSettings();status.source=settings.displaySurface||'selected surface';status.captureFPS=settings.frameRate||4;
    note('capture-connected',{source:status.source,frameRate:status.captureFPS,width:settings.width,height:settings.height});
    video=document.createElement('video');video.muted=true;video.playsInline=true;video.setAttribute('aria-hidden','true');video.dataset.browserCapture='true';
    video.style.cssText='position:fixed;width:1px;height:1px;bottom:0;right:0;opacity:.01;pointer-events:none';document.body.append(video);video.srcObject=stream;
    let timeout;try{await Promise.race([video.play(),new Promise((_,reject)=>{timeout=setTimeout(()=>reject(Error('No video frame arrived. Try sharing the game in borderless/windowed mode.')),15000);})]);}finally{clearTimeout(timeout);}
    if(run!==generation)return;
    report('loading','Preparing local OCR. The first start downloads recognition files; later starts use the browser cache.');
    if(!await ensureOCR(run))return;
    ticker=makeTicker();tickerKind=ticker.kind;note('ticker',{kind:tickerKind});
    report('watching','Tracking started. Open a weapon’s camo menu, or leave the after-match results visible.');
    ticker.after(300,()=>tick(run));
   }catch(error){
    if(run!==generation)return;release();status.running=false;
    report('error',error.name==='NotAllowedError'?'Screen sharing was cancelled or blocked. Click Start tracking to try again.':error.message);
   }
  }
  function checkNow(){if(!status.running||['starting','loading'].includes(status.phase))return;manual=true;pending=null;if(area){area.read=null;}if(screen)screen.attempts=0;}
  function drawPreview(canvas){if(!video||video.readyState<2)return false;canvas.width=480;canvas.height=Math.max(1,Math.round(480*video.videoHeight/video.videoWidth));const ctx=canvas.getContext('2d');ctx.drawImage(video,0,0,canvas.width,canvas.height);
   if(screen){const k=canvas.width/video.videoWidth;ctx.strokeStyle='#c6ff3d';ctx.lineWidth=2;for(const r of [screen.headingRegion,...Object.values(screen.regions)])ctx.strokeRect(r[0]*k,r[1]*k,r[2]*k,r[3]*k);}
   return true;}
  function getDiagnosticReport(){
   const track=stream?.getVideoTracks()[0],settings=track?.getSettings()||{};
   return JSON.stringify({format:'cod-camo-tracker-diagnostics-v2',capturedAt:new Date().toISOString(),snapshot:{...status},
    environment:{browser:navigator.userAgent,visibility:document.visibilityState,ticker:tickerKind,track:{readyState:track?.readyState||'none',muted:track?.muted??null,width:settings.width||null,height:settings.height||null,frameRate:settings.frameRate||null,displaySurface:settings.displaySurface||'unknown'},video:{readyState:video?.readyState||0,paused:video?.paused??null,currentTime:video?.currentTime||0}},
    timing:{largestScanGapMs:Math.round(largestGapMs),longGaps,workerStarts},screen:screen?{kind:screen.kind,u:Math.round(screen.u),regions:screen.regions}:null,lastReadings,lastRejected,events},null,2);
  }
  return {start,stop,checkNow,drawPreview,getDiagnosticReport,getStatus:()=>({...status})};
 }
 root.BrowserCamoCaptureV2={create,createOCR,normalize,segment,groupTiles,detectTiles,gridModel,modelTiles,locked,thumb,changed,BUILD};
})(window);
