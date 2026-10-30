/* Padlock check against every camo: each camo swatch is drawn as a menu tile, with and without the game's padlock
   at 720p/1080p/1440p tile sizes. The padlock is cut from a real menu screenshot (the Gold tile of
   validation/real/knife-menu.webp) and blended like the game's semi-transparent padlock: opaque on the focused
   group, about 55% elsewhere; and outside the tile's left edge as on the hovered (cursor) tile. A locked tile must read
   locked and a clean tile unlocked. Swatches are local test data (validation/real/camos, not in Git; the CODMunity
   icons at assets.codmunity.gg/optimized/<name>_mw4_camo_icon.webp).
   Usage: node tests/lock/padlock-sweep.cjs [--browser firefox|msedge] [--stats] */
const {firefox,chromium}=require('playwright');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../../web'),camoDir=path.resolve(__dirname,'../../validation/real/camos');
const args=process.argv.slice(2),browserName=args[args.indexOf('--browser')+1]||'msedge';
const files=fs.existsSync(camoDir)?fs.readdirSync(camoDir).filter(f=>f.endsWith('.webp')):[];
if(!files.length){console.log('No camo swatches in validation/real/camos; skipping.');process.exit(0);}
const server=http.createServer((req,res)=>{const name=decodeURIComponent(new URL(req.url,'http://x').pathname);
 const file=name==='/__knife'?path.resolve(camoDir,'../knife-menu.webp'):name.startsWith('/__camo/')?path.join(camoDir,path.basename(name)):path.resolve(root,'.'+(name==='/'?'/index.html':name));
 fs.readFile(file,(e,d)=>{if(e){res.writeHead(404).end();return;}res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.webp')?'image/webp':file.endsWith('.html')?'text/html':file.endsWith('.wasm')?'application/wasm':'application/octet-stream');res.end(d);});});
server.listen(0,'127.0.0.1',async()=>{
 const browser=browserName==='firefox'?await firefox.launch():await chromium.launch({channel:'msedge'});
 try{
  const page=await browser.newPage();await page.goto(`http://127.0.0.1:${server.address().port}/`);
  if(args.includes('--stats'))await page.evaluate(()=>{window.__stats={};});
  const result=await page.evaluate(async files=>{
   const B=window.BrowserCamoCaptureV2,fails=[];let cases=0;
   // Real padlock mask: the 1080p Gold tile (padlock at 144,643) is a smooth background, so mask = how much whiter than it.
   const knife=new Image();knife.src='/__knife';await knife.decode();
   const kc=document.createElement('canvas');kc.width=1920;kc.height=1080;const kx=kc.getContext('2d');kx.drawImage(knife,0,0,1920,1080);
   const mw=24,mh=30,md=kx.getImageData(140,638,mw,mh).data,mask=document.createElement('canvas');mask.width=mw;mask.height=mh;
   const mi=mask.getContext('2d').createImageData(mw,mh),bg=120;
   for(let i=0;i<mw*mh;i++){const v=Math.min(md[i*4],md[i*4+1],md[i*4+2]);mi.data[i*4]=mi.data[i*4+1]=mi.data[i*4+2]=255;mi.data[i*4+3]=Math.max(0,Math.min(255,Math.round((v-bg)/(250-bg)*255)));}
   mask.getContext('2d').putImageData(mi,0,0);
   const drawLock=(ctx,ox,oy,k,alpha)=>{ctx.globalAlpha=alpha;ctx.drawImage(mask,ox,oy,mw*k,mh*k);ctx.globalAlpha=1;};
   for(const f of files){
    const im=new Image();im.src='/__camo/'+f;await im.decode();
    // Crop the swatch's border so the source site's corner watermarks are not mistaken for padlocks.
    const cut=f.startsWith('finish-')?[im.width*.3,im.height*.1,im.height*.8,im.height*.8]:[im.width*.2,im.height*.2,im.width*.6,im.height*.6];
    for(const scale of [2/3,1,4/3])for(const s0 of f.startsWith('finish-')||f.startsWith('military')?[93]:[130]){
     const s=Math.round(s0*scale),pad=Math.round(30*scale),c=document.createElement('canvas');c.width=c.height=s+pad*2;const ctx=c.getContext('2d');
     for(const variant of ['clean','bright','dim','dim-tile','hovered']){
      ctx.fillStyle='rgb(20,24,22)';ctx.fillRect(0,0,c.width,c.height);
      ctx.filter=variant==='dim-tile'?'brightness(0.7)':'none';ctx.drawImage(im,...cut,pad,pad,s,s);ctx.filter='none';
      if(variant!=='clean')drawLock(ctx,pad+(variant==='hovered'?-11:4)*scale,pad+(variant==='hovered'?8:4)*scale,scale,variant==='bright'||variant==='hovered'?1:.55);
      const got=B.locked(c,[pad,pad,pad+s,pad+s],c.width,c.height,scale),want=variant!=='clean';cases++;
      if(window.__stats){const m=B.lockMatch(c,[pad,pad,pad+s,pad+s],c.width,c.height,scale);(window.__stats[variant+' '+Math.round(scale*1080)]??=[]).push([+m.score.toFixed(2),Math.round(m.contrast)]);(window.__all??=[]).push([m.score,m.contrast,want,f]);}
      if(got!==want)fails.push(`${f} ${Math.round(scale*1080)}p ${variant}: read ${got?'locked':'unlocked'}`);
     }
    }
   }
   return {cases,fails,stats:window.__stats,all:window.__all};
  },files);
  console.log(`padlock sweep (${browserName}): ${result.cases-result.fails.length}/${result.cases} tiles correct across ${files.length} camos`);
  if(result.stats)for(const [k,v] of Object.entries(result.stats)){const sc=v.map(x=>x[0]).sort((a,b)=>a-b),ct=v.map(x=>x[1]).sort((a,b)=>a-b),q=(a,p)=>a[Math.floor((a.length-1)*p)];console.log(k.padEnd(14),'score min/10%/50%/90%/max',[0,.1,.5,.9,1].map(p=>q(sc,p)).join(' '),' contrast',[0,.1,.5,.9,1].map(p=>q(ct,p)).join(' '));}
  if(result.all){let best=null;for(let m=.5;m<=.75;m+=.01)for(let c=0;c<=60;c+=2){const wrong=result.all.filter(([s,ct,want,f])=>(s>=m&&ct>=c)!==want&&!/stonebits|divergence/.test(f));const fl=wrong.filter(x=>!x[2]).length;if(!best||wrong.length<best.n||(wrong.length===best.n&&fl<best.fl))best={m:+m.toFixed(2),c,n:wrong.length,fl};}console.log('best thresholds (excluding watermarked/unrepresentative swatches):',JSON.stringify(best));}
  if(result.fails.length&&!args.includes('--stats')){console.log(result.fails.slice(0,80).join('\n'));process.exitCode=1;}
 }finally{await browser.close();server.close();}
});
