/* Optional cross-device sync. Off until the player turns it on; nothing leaves the browser before then. */
'use strict';
(()=>{
const app=window.TrackerSync;if(!app)return;
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let API='https://mw4-sync.cod-camo-tracker.workers.dev';
// Lets a local test point at `wrangler dev`; storage can be unavailable.
try{API=localStorage.getItem('mw4.sync.api')||API;}catch{}
const KEY='mw4.sync';
let sync=null,pushTimer=null,busy=false,pending=false,lastError='';
try{sync=JSON.parse(localStorage.getItem(KEY)||'null');}catch{}
const save=()=>{try{sync?localStorage.setItem(KEY,JSON.stringify(sync)):localStorage.removeItem(KEY);}catch{}};
const status=text=>{$('#save-status').textContent=text;};
const snapshot=()=>JSON.parse(JSON.stringify(app.state));
const shareUrl=id=>location.origin+location.pathname+'#view/'+id;

async function call(path,{method='GET',code,body}={}){
  const response=await fetch(API+path,{method,cache:'no-store',headers:{...(code?{Authorization:'Bearer '+code}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
  const result=await response.json().catch(()=>({}));
  if(response.status===409)return {conflict:true,...result};
  if(!response.ok)throw Error(result.error||'Sync is unavailable right now.');
  return result;
}

// Three-way merge: whatever this device changed since the last sync wins, everything else comes from the other devices.
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
function mergeMap(base={},mine={},theirs={}){
  const out={};
  for(const k of new Set([...Object.keys(base),...Object.keys(mine),...Object.keys(theirs)])){
    const v=same(mine[k],base[k])?theirs[k]:mine[k];
    if(v!==undefined)out[k]=v;
  }
  return out;
}
const byId=goals=>Object.fromEntries((goals||[]).map(g=>[g.id,g]));
function merge(base,mine,theirs){
  const goals=Object.values(mergeMap(byId(base.goals),byId(mine.goals),byId(theirs.goals))).sort((a,b)=>a.order-b.order);
  // Two devices can each queue goals; keep the six-goal limit by untracking the extras.
  let tracked=0;for(const g of goals)if(g.tracked&&++tracked>6)g.tracked=false;
  return {version:3,checks:mergeMap(base.checks,mine.checks,theirs.checks),goals,
    autoApplied:mergeMap(base.autoApplied,mine.autoApplied,theirs.autoApplied),
    categoryTotals:mergeMap(base.categoryTotals,mine.categoryTotals,theirs.categoryTotals),
    matches:Object.values(mergeMap(byId(base.matches),byId(mine.matches),byId(theirs.matches))).sort((a,b)=>b.at.localeCompare(a.at)),
    mode:same(mine.mode,base.mode)?theirs.mode:mine.mode};
}

// base is the server copy this device last saw; anything that differs from it is a local change still to upload.
const tidy=data=>JSON.parse(JSON.stringify(app.validate(data)));
function adopt(data,rev){
  const mine=snapshot(),base=sync.base||mine,theirs=tidy(data);
  app.setState(same(mine,base)?theirs:merge(base,mine,theirs));
  sync.rev=rev;sync.base=theirs;save();
}
async function run(){
  if(!sync||busy){pending=true;return;}
  busy=true;pending=false;status('Syncing…');
  try{
    for(let attempt=0;attempt<3;attempt++){
      const remote=await call('/v1/doc?rev='+sync.rev,{code:sync.code});
      sync.viewId=remote.viewId;
      if(remote.data)adopt(remote.data,remote.rev);
      if(same(snapshot(),sync.base))break;
      const put=await call('/v1/doc',{method:'PUT',code:sync.code,body:{baseRev:sync.rev,data:snapshot()}});
      if(put.conflict)continue;
      sync.rev=put.rev;sync.base=snapshot();save();break;
    }
    lastError='';status('Synced across your devices');
  }catch(e){lastError=e.message;status(navigator.onLine===false?'Offline · will sync when back online':'Saved here · sync failed');}
  finally{busy=false;save();if(pending)schedule(500);}
}
function schedule(delay=1500){clearTimeout(pushTimer);pushTimer=setTimeout(run,delay);}

const formatCode=code=>{const c=String(code||'').toUpperCase().replace(/[^A-Z0-9]/g,'').replace(/^MW4/,'');if(c.length!==16)throw Error('A sync code has 16 letters and numbers after MW4.');return 'MW4-'+c.match(/.{4}/g).join('-');};
async function start(code){
  if(code){
    code=formatCode(code);
    const remote=await call('/v1/doc',{code});
    // Joining an existing code: combine this browser's progress with it instead of wiping either.
    sync={code,viewId:remote.viewId,rev:remote.rev,base:{version:3,checks:{},goals:[],autoApplied:{},categoryTotals:{},mode:'Multiplayer'}};
    adopt(remote.data,remote.rev);await run();
  }else{
    const made=await call('/v1/create',{method:'POST',body:{data:snapshot()}});
    sync={code:made.code,viewId:made.viewId,rev:made.rev,base:snapshot()};save();status('Synced across your devices');
  }
}

function copyButton(label,text){return `<button type="button" class="sync-copy" data-copy="${esc(text)}">${label}</button>`;}
function panel(){
  const body=sync?`
    <p>Sync is <b>on</b> for this browser. Changes reach your other devices within a few seconds.</p>
    <h3>Your sync code</h3><p class="sync-code">${esc(sync.code)}</p>${copyButton('Copy sync code',sync.code)}
    <p class="sync-note">Enter this code on your phone or another browser. Anyone with it can <b>change</b> your progress, so keep it to your own devices.</p>
    <h3>Share link for friends</h3><p class="sync-link">${esc(shareUrl(sync.viewId))}</p>${copyButton('Copy share link',shareUrl(sync.viewId))} <button type="button" id="sync-rotate">Make a new link</button>
    <p class="sync-note">Friends see your camo progress and match stats live, read-only. Your queue and notes stay private. A new link stops the old one working.</p>
    ${lastError?`<p class="error">Last sync failed: ${esc(lastError)}</p>`:''}
    <p><button type="button" id="sync-now">Sync now</button> <button type="button" id="sync-off">Turn off on this browser</button></p>`
  :`<p>Keep your progress the same on your PC, phone and any other browser. No account needed: you get a sync code to enter on each device.</p>
    <p class="sync-note">Turning this on stores a copy of your progress on the tracker's sync server so your devices can share it. Until then everything stays in this browser.</p>
    <p><button type="button" class="primary" id="sync-create">Turn on sync</button></p>
    <h3>Already have a sync code?</h3>
    <form id="sync-join"><input id="sync-code" placeholder="MW4-XXXX-XXXX-XXXX-XXXX" autocomplete="off" spellcheck="false" maxlength="40"> <button class="primary">Use this code</button></form>
    <p class="sync-note">Progress already in this browser is combined with the synced progress, not replaced.</p>`;
  app.info('Sync devices',body);
  const busyOn=async(fn,done)=>{try{await fn();app.toast(done);}catch(e){app.toast(e.message);}panel();};
  $('#sync-create')?.addEventListener('click',()=>busyOn(()=>start(),'Sync is on. Enter the code on your other devices.'));
  $('#sync-join')?.addEventListener('submit',e=>{e.preventDefault();busyOn(()=>start($('#sync-code').value),'This browser is now synced.');});
  $('#sync-now')?.addEventListener('click',()=>busyOn(run,lastError?'Sync failed: '+lastError:'Synced.'));
  $('#sync-rotate')?.addEventListener('click',()=>{if(confirm('Make a new share link? The old link will stop working.'))busyOn(async()=>{sync.viewId=(await call('/v1/view/rotate',{method:'POST',code:sync.code})).viewId;save();},'New share link made.');});
  $('#sync-off')?.addEventListener('click',()=>{if(!confirm('Stop syncing this browser? Its progress stays here, and your other devices keep the synced copy.'))return;sync=null;save();status('Saved on this device');panel();});
  for(const b of document.querySelectorAll('.sync-copy'))b.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(b.dataset.copy);app.toast('Copied.');}catch{app.toast('Copy failed. Select the text and copy it instead.');}});
}

async function viewOnly(id){
  app.setReadOnly(true);document.body.classList.add('shared-view');
  const banner=document.createElement('div');banner.className='shared-banner';banner.setAttribute('role','status');
  banner.innerHTML='Viewing shared progress (read-only). <a href="'+esc(location.pathname)+'">Open your own tracker</a>';
  document.querySelector('header').after(banner);
  const load=async()=>{try{const r=await call('/v1/view/'+id);app.setState(r.data,false);status('Shared progress · updated '+new Date(r.updated).toLocaleString());}catch(e){status(e.message);}};
  await load();setInterval(()=>{if(!document.hidden)load();},30000);
  addEventListener('hashchange',()=>location.reload());
}

const view=location.hash.match(/^#view\/([A-Z0-9]{10})$/);
if(view){viewOnly(view[1]);return;}
const button=document.createElement('button');button.id='sync';button.textContent='Sync devices';button.onclick=panel;
$('#export').before(button);
app.onSave(()=>{if(sync)schedule();});
if(sync){status('Syncing…');run();}
// Pick up changes from other devices when you come back to this tab, and every 30 s while it is open.
document.addEventListener('visibilitychange',()=>{if(sync&&!document.hidden)schedule(200);});
addEventListener('online',()=>{if(sync)schedule(200);});
setInterval(()=>{if(sync&&!document.hidden)schedule(0);},30000);
})();
