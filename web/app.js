/* Buildless, offline-first UI. No third-party code or external requests. */
'use strict';
const catalog=window.CAMO_CATALOG;
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const norm=s=>String(s??'').toUpperCase().replace(/[^A-Z0-9]+/g,' ').trim().replace(/\s+/g,' ');
const canonical=s=>norm(s)==='COMBAT KNIFE'?'FSS CARBON EDGE 1095':norm(s);
const slotKey=(w,s)=>canonical(w)+'|'+s;
const KEY='mw4.fieldnotes.v1';
let state={version:3,checks:{},goals:[],mode:'Multiplayer'},view='arsenal',classFilter='All',selected=catalog.weapons.find(w=>w.name==='M4')||catalog.weapons[0],detailTab='camos',mediaFilter='all',userMedia=[],toastTimer;
// The chosen Arsenal order is a per-browser convenience; storage can be unavailable.
let arsenalOrder='class';try{if(localStorage.getItem('mw4.arsenalOrder')==='prestige')arsenalOrder='prestige';}catch{}
let auto={connected:false,running:false,message:'Capture is stopped.',entries:[],interval:4};
let checkedNativeMigration=false;
const token=new URLSearchParams(location.hash.slice(1)).get('token');
const companion=location.protocol==='http:'&&location.hostname==='127.0.0.1'&&!!token;
function toast(message){$('#toast').textContent=message;$('#toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').classList.remove('show'),4500);}
function validate(input){
  if(!input||typeof input!=='object')throw Error('Not a tracker plan.');
  if(input.schemaVersion===1||input.schemaVersion===2){
    input={version:3,checks:input.checks||{},mode:'Multiplayer',goals:(input.goals||[]).map(g=>({id:g.Id,weapon:g.Weapon,slot:g.Slot,label:g.Label,requirement:g.Requirement,current:g.Current,target:g.Target,notes:g.Notes,tracked:g.Tracked,order:g.Order,mode:'Multiplayer',source:'Manual import',confidence:'manual'}))};
  }
  if(input.version!==3||!Array.isArray(input.goals)||input.goals.length>2000||!input.checks||Array.isArray(input.checks)||typeof input.checks!=='object')throw Error('Unsupported plan format.');
  const ids=new Set();
  const goals=input.goals.map((g,i)=>{
    if(!g||typeof g.id!=='string'||g.id.length>100||ids.has(g.id))throw Error('A goal has an invalid or duplicate ID.');ids.add(g.id);
    const weapon=g.weapon==='Any weapon'?'Any weapon':catalog.weapons.find(w=>canonical(w.name)===canonical(g.weapon))?.name;
    if(!weapon)throw Error('A goal contains an unknown weapon.');
    if(typeof g.label!=='string'||!g.label.trim()||g.label.length>80)throw Error('Goal names must use 1–80 characters.');
    for(const field of ['requirement','notes'])if(typeof g[field]!=='string'||g[field].length>(field==='notes'?1000:500))throw Error('A goal has invalid text.');
    if(!Number.isInteger(g.current)||!Number.isInteger(g.target)||g.current<0||g.target<1||g.target>1000000||g.current>g.target)throw Error('Counters must run from zero to a target of 1–1,000,000.');
    const slot=g.slot??-1;if(!Number.isInteger(slot)||slot< -1||slot>13||slot>=0&&weapon==='Any weapon')throw Error('Invalid camo slot.');
    return {...g,weapon,slot,tracked:!!g.tracked,order:Number.isFinite(g.order)?g.order:i,mode:g.mode==='DMZ'?'DMZ':'Multiplayer'};
  });
  if(goals.filter(g=>g.tracked).length>6)throw Error('Pin up to six goals. Untrack one first.');
  const checks={};for(const [key,value] of Object.entries(input.checks)){if(key.length>500||typeof value!=='boolean')throw Error('Invalid camo record.');checks[key]=value;}
  const categoryTotals={};if(input.categoryTotals&&typeof input.categoryTotals==='object'&&!Array.isArray(input.categoryTotals)){const totals=Object.entries(input.categoryTotals);if(totals.length>1000)throw Error('Too many category totals.');for(const [key,v] of totals){if(key.length>160||!v||!Number.isInteger(v.current)||!Number.isInteger(v.target)||v.current<0||v.current>v.target||v.target<1||v.target>8||typeof v.observedAt!=='string'||v.observedAt.length>80)throw Error('Invalid category total.');Object.defineProperty(categoryTotals,key,{value:{current:v.current,target:v.target,observedAt:v.observedAt},enumerable:true,writable:true,configurable:true});}}const autoApplied={};if(input.autoApplied&&typeof input.autoApplied==='object'&&!Array.isArray(input.autoApplied)){const receipts=Object.entries(input.autoApplied);if(receipts.length>5000)throw Error('Too many automatic records.');for(const [key,value] of receipts){if(key.length>200||typeof value!=='string'||value.length>150)throw Error('Invalid automatic record.');Object.defineProperty(autoApplied,key,{value,enumerable:true,writable:true,configurable:true});}}return {version:3,checks,goals,autoApplied,categoryTotals,mode:input.mode==='DMZ'?'DMZ':'Multiplayer'};
}
try{const saved=localStorage.getItem(KEY);if(saved)state=validate(JSON.parse(saved));else if(window.NATIVE_MIGRATION){state=validate(window.NATIVE_MIGRATION);localStorage.setItem(KEY,JSON.stringify(state));}}
catch(e){$('#save-status').textContent='Storage needs attention';setTimeout(()=>toast(e.message+' Export your plan before closing.'),200);}
function commit(change){const before=JSON.stringify(state);try{change();state=validate(state);localStorage.setItem(KEY,JSON.stringify(state));$('#save-status').textContent='Saved on this device';render();return true;}catch(e){state=JSON.parse(before);toast(e.message);return false;}}
function setCamoUnlocked(c,unlocked){
 if(c.slot>=0&&c.slot<8){for(let slot=unlocked?0:c.slot;slot<(unlocked?c.slot+1:8);slot++)state.checks[slotKey(c.weapon,slot)]=unlocked;}
 else state.checks[c.slot>=0?slotKey(c.weapon,c.slot):c.checkKey]=unlocked;
}
function done(w,slot){const key=slotKey(w,slot);if(Object.hasOwn(state.checks,key))return state.checks[key];return state.goals.some(g=>canonical(g.weapon)===canonical(w)&&g.slot===slot&&g.current===g.target);}
function count(w){return Array.from({length:14},(_,s)=>done(w,s)).filter(Boolean).length;}
function weaponGoal(w){return state.goals.filter(g=>canonical(g.weapon)===canonical(w)).sort((a,b)=>Number(b.tracked)-Number(a.tracked)||a.order-b.order)[0];}
function variant(c){return c.variants.find(v=>v.mode===state.mode)||c.variants[0];}
function goalFor(c){return state.goals.find(g=>canonical(g.weapon)===canonical(c.weapon)&&g.slot===c.slot);}
function extraGoal(c){return state.goals.find(g=>g.camoId===c.id);}
function findCamo(id){return catalog.challenges.find(c=>c.id===id)||(catalog.extras||[]).find(c=>c.id===id);}
function sourceLabel(v){return {official:'Official',community:'Community report',unknown:'Unconfirmed',conflicting:'Sources differ',uncertain:'Needs checking',manual:'Manual'}[v.confidence]||'Community report';}
function badge(v){return `<span class="badge ${esc(v.confidence)}">${esc(sourceLabel(v))}</span>`;}
function trackCamo(id){const c=findCamo(id);if(!c)return;const existing=c.slot>=0?goalFor(c):extraGoal(c);if(existing?.tracked){commit(()=>existing.tracked=false);return;}if(existing&&existing.mode!==(variant(c).mode==='Shared'?state.mode:variant(c).mode)){editGoal(existing,c);$('#goal-tracked').checked=true;toast('This goal has a different mode. Choose a mode before saving.');return;}const v=variant(c);if(v.target==null&&!confirm('The exact target is not confirmed. Track this as one unlock to check off when earned?'))return;
  commit(()=>{if(existing){existing.tracked=true;return;}state.goals.push({id:crypto.randomUUID(),weapon:c.weapon,slot:c.slot,camoId:c.id,checkKey:c.checkKey,label:c.name,requirement:v.requirement+(c.gate?' Prerequisite: '+c.gate:''),current:(c.slot>=0?done(c.weapon,c.slot):state.checks[c.checkKey])?(v.target||1):0,target:v.target||1,unit:v.unit,notes:v.note||'',mode:v.mode==='Shared'?state.mode:v.mode,source:v.source,confidence:v.confidence,tracked:true,order:state.goals.length});});}
function setCounter(id,amount){commit(()=>{const g=state.goals.find(g=>g.id===id);g.current=Math.max(0,Math.min(g.target,g.current+amount));if(g.slot>=0)state.checks[slotKey(g.weapon,g.slot)]=g.current===g.target;else if(g.checkKey)state.checks[g.checkKey]=g.current===g.target;});}
function render(){
 hideCamoPreview();
  document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===view));
  document.querySelectorAll('[data-class]').forEach(b=>b.classList.toggle('active',b.dataset.class===classFilter));
  const pinned=state.goals.filter(g=>g.tracked).length,total=catalog.weapons.reduce((n,w)=>n+count(w.name),0);
  $('#pin-count').textContent=pinned;$('#overall').innerHTML=`${total}<span> / 462</span>`;$('#overall-bar').style.width=100*total/462+'%';$('#mode').value=state.mode;
  $('.workspace').classList.toggle('full-width',view!=='arsenal');$('#mode-label').hidden=view==='library';$('#order-label').hidden=view!=='arsenal';$('#order').value=arsenalOrder;$('#add-image').hidden=view!=='library';
  const headings={arsenal:['YOUR CAMO CHECKLIST','See what’s next.<br><span>For every weapon.</span>','See each weapon’s progress, open its requirements, and choose your next-match goals.'],plan:['YOUR NEXT DEPLOYMENT','Less scrolling.<br><span>More progress.</span>',`${pinned} of 6 goals pinned. Counts and notes are editable. Screenshots are optional.`],library:['THE REFERENCE SHELF','Know your gear.<br><span>Find your finish.</span>','Official weapon and camo reference sheets, plus images you choose to keep.']};
  $('#view-kicker').textContent=headings[view][0];$('#view-title').innerHTML=headings[view][1];$('#view-description').textContent=headings[view][2];
  if(view==='arsenal')renderArsenal();if(view==='plan')renderPlan();if(view==='library')renderLibrary();
}

// Interactive previews use a dialog popover so their Track button is accessible.
let previewRestoringFocus=false,previewBox=null,previewAnchor=null,previewOpenTimer=null,previewCloseTimer=null;
function previewTrigger(c,label){const complete=c.slot>=0?done(c.weapon,c.slot):state.checks[c.checkKey];return `<button class="camo-preview-trigger ${complete?'is-done':''}" data-camo-preview="${c.id}" data-manual-camo="${c.id}" aria-pressed="${!!complete}" aria-label="${esc((complete?'Clear unlocked mark: ':'Mark unlocked: ')+c.weapon+' — '+c.name)}" aria-haspopup="dialog" aria-controls="camo-preview" aria-expanded="false">${esc(label)}</button>`;}
function hideCamoPreview(){clearTimeout(previewOpenTimer);clearTimeout(previewCloseTimer);if(previewAnchor)previewAnchor.setAttribute('aria-expanded','false');if(previewBox?.matches(':popover-open'))previewBox.hidePopover();previewAnchor=null;}
function closePreviewSoon(){clearTimeout(previewOpenTimer);clearTimeout(previewCloseTimer);previewCloseTimer=setTimeout(()=>{if(!previewBox?.matches(':hover')&&!previewBox?.contains(document.activeElement)&&!previewAnchor?.matches(':hover')&&document.activeElement!==previewAnchor)hideCamoPreview();},220);}
function showCamoPreview(anchor){
 clearTimeout(previewOpenTimer);clearTimeout(previewCloseTimer);
 if(previewAnchor===anchor&&previewBox?.matches(':popover-open'))return;
 hideCamoPreview();const c=findCamo(anchor.dataset.camoPreview);if(!c||!anchor.isConnected)return;
 const v=variant(c),g=c.slot>=0?goalFor(c):extraGoal(c);
 if(!previewBox){previewBox=document.createElement('div');previewBox.id='camo-preview';previewBox.className='camo-preview';previewBox.setAttribute('popover','manual');previewBox.setAttribute('role','dialog');previewBox.setAttribute('aria-labelledby','preview-name');previewBox.addEventListener('pointerenter',()=>clearTimeout(previewCloseTimer));previewBox.addEventListener('pointerleave',closePreviewSoon);previewBox.addEventListener('focusout',closePreviewSoon);}
 const owner=anchor.closest('dialog')||document.body;owner.append(previewBox);previewAnchor=anchor;anchor.setAttribute('aria-expanded','true');
 previewBox.innerHTML=`<div class="preview-top"><span>${esc(c.weapon)} · ${esc(v.mode==='Shared'?state.mode:v.mode)}</span><button class="preview-close" aria-label="Close camo preview">×</button></div><h3 id="preview-name">${esc(c.name)}</h3><p class="preview-requirement">${esc(v.requirement)}</p>${v.unit==='sets'?`<p>Count ${v.target} completed sets.</p>`:''}${c.gate?`<p><b>First:</b> ${esc(c.gate)}</p>`:''}${g?`<p>${g.current} / ${g.target} recorded · ${esc(g.mode)}</p>`:''}<div class="preview-bottom">${badge(v)}<button class="primary preview-track" ${v.mode==='Warzone'?'disabled':''}>${v.mode==='Warzone'?'Season 1':g?.tracked?'Untrack':'Track for next match'}</button></div>`;
 previewBox.querySelector('.preview-close').onclick=()=>{const target=previewAnchor;hideCamoPreview();previewRestoringFocus=true;target?.focus({preventScroll:true});previewRestoringFocus=false;};
 previewBox.querySelector('.preview-track').onclick=()=>{const id=c.id;hideCamoPreview();trackCamo(id);};
 previewBox.showPopover();positionCamoPreview();
}
function positionCamoPreview(){
 if(!previewAnchor||!previewBox?.matches(':popover-open'))return;const rect=previewAnchor.getBoundingClientRect(),box=previewBox.getBoundingClientRect(),gap=8,edge=12;
 if(rect.bottom<0||rect.top>innerHeight){hideCamoPreview();return;}
 const left=Math.min(Math.max(edge,rect.left+rect.width/2-box.width/2),innerWidth-box.width-edge);
 const below=rect.bottom+gap;const top=below+box.height<=innerHeight-edge?below:Math.max(edge,rect.top-box.height-gap);
 previewBox.style.left=left+'px';previewBox.style.top=top+'px';
}
document.addEventListener('pointerover',event=>{const anchor=event.target.closest('[data-camo-preview]');if(!anchor)return;clearTimeout(previewCloseTimer);if(previewAnchor===anchor&&previewBox?.matches(':popover-open'))return;clearTimeout(previewOpenTimer);previewOpenTimer=setTimeout(()=>showCamoPreview(anchor),160);});
document.addEventListener('pointerout',event=>{const anchor=event.target.closest('[data-camo-preview]');if(anchor&&!anchor.contains(event.relatedTarget))closePreviewSoon();});
document.addEventListener('focusin',event=>{if(previewRestoringFocus)return;const anchor=event.target.closest('[data-camo-preview]');if(anchor)showCamoPreview(anchor);else if(previewBox&&!previewBox.contains(event.target))hideCamoPreview();});
document.addEventListener('focusout',event=>{if(event.target.closest('[data-camo-preview]'))closePreviewSoon();});
document.addEventListener('click',event=>{
 const anchor=event.target.closest('[data-camo-preview]');if(!anchor)return;
 if(anchor.dataset.manualCamo){
  const c=findCamo(anchor.dataset.manualCamo);if(!c)return;
  const key=c.slot>=0?slotKey(c.weapon,c.slot):c.checkKey,unlocked=!(c.slot>=0?done(c.weapon,c.slot):state.checks[key]);
  hideCamoPreview();
  if(commit(()=>setCamoUnlocked(c,unlocked))){
   if(event.detail===0){const replacement=document.querySelector('[data-manual-camo="'+CSS.escape(c.id)+'"]');previewRestoringFocus=true;replacement?.focus({preventScroll:true});previewRestoringFocus=false;}
   toast(c.weapon+' — '+c.name+(unlocked?' marked unlocked.':' unlocked mark cleared.'));
  }
  return;
 }
 showCamoPreview(anchor);
});
document.addEventListener('pointerdown',event=>{if(previewAnchor&&!previewAnchor.contains(event.target)&&!previewBox.contains(event.target))hideCamoPreview();});
document.addEventListener('keydown',event=>{if(event.key==='ArrowDown'&&event.target.closest('[data-camo-preview]')){showCamoPreview(event.target.closest('[data-camo-preview]'));previewBox?.querySelector('.preview-track')?.focus();event.preventDefault();return;}if(event.key==='Escape'&&previewBox?.matches(':popover-open')){const target=previewAnchor,restore=previewBox.contains(document.activeElement);hideCamoPreview();if(restore){previewRestoringFocus=true;target?.focus({preventScroll:true});previewRestoringFocus=false;}event.preventDefault();event.stopPropagation();}},true);
document.addEventListener('close',hideCamoPreview,true);window.addEventListener('resize',positionCamoPreview);document.addEventListener('scroll',event=>{if(!previewBox?.contains(event.target))positionCamoPreview();},true);
function weaponCamos(w){return catalog.challenges.filter(c=>c.weapon===w);}
function weaponProgressGoals(w){return state.goals.filter(g=>canonical(g.weapon)===canonical(w)&&g.current>0&&g.current<g.target&&(g.tracked||g.slot<0||!done(w,g.slot))).sort((a,b)=>Number(b.tracked)-Number(a.tracked)||a.order-b.order);}
function nextCamo(w){const active=weaponProgressGoals(w).find(g=>g.camoId&&findCamo(g.camoId)?.slot>=0);return active?findCamo(active.camoId):weaponCamos(w).find(c=>!done(w,c.slot));}
function weaponRowProgress(w){const goals=weaponProgressGoals(w),totals=['MILITARY','SPECIAL','COMPLETIONIST','PRESTIGE'].map(category=>({category,...state.categoryTotals?.[canonical(w)+'|'+category]})).filter(t=>Number.isInteger(t.current));return `${goals.length?`<div class="row-counter-summary"><span>Challenge progress</span>${goals.slice(0,3).map(g=>`<button ${g.camoId?`data-camo-preview="${esc(g.camoId)}" aria-haspopup="dialog"`:''} class="counter-chip"><b>${esc(g.label)}</b> ${g.current} / ${g.target}<i style="--counter-progress:${100*g.current/g.target}%"></i></button>`).join('')}${goals.length>3?`<small>+${goals.length-3} more</small>`:''}</div>`:''}${totals.length?`<div class="row-observed-summary"><span>Observed in game</span>${totals.map(t=>`<span>${esc(t.category.toLowerCase())} <b>${t.current}/${t.target}</b></span>`).join('')}</div>`:''}`;}
function stageCount(w,from,to){return Array.from({length:to-from},(_,i)=>done(w,from+i)).filter(Boolean).length;}
function renderArsenal(){
 const query=$('#search').value.trim().toLowerCase();
 const weapons=catalog.weapons.filter(w=>(classFilter==='All'||w.class===classFilter)&&(!query||(w.name+' '+w.class).toLowerCase().includes(query)||weaponCamos(w.name).some(c=>(c.name+' '+c.variants.map(v=>v.requirement).join(' ')).toLowerCase().includes(query))));
 const allMilitary=catalog.weapons.reduce((n,w)=>n+stageCount(w.name,0,8),0),allSpecial=catalog.weapons.reduce((n,w)=>n+stageCount(w.name,8,11),0),allGold=catalog.weapons.filter(w=>done(w.name,11)).length;
 $('#content').innerHTML=`<div class="arsenal-totals"><div><strong>${allMilitary}<small> / 264</small></strong><span>Military · weapon levels</span></div><div><strong>${allSpecial}<small> / 99</small></strong><span>Special · 3 per weapon</span></div><div><strong>${allGold}<small> / 33</small></strong><span>Gold · finish each weapon</span></div><div><strong>${state.goals.filter(g=>g.tracked).length}<small> / 6</small></strong><span>Goals for your next match</span></div></div><p class="arsenal-help">Click a Military square to complete it and earlier levels; clear one to clear it and later levels. Other camo squares toggle individually. Hover for requirements and tracking. Choose a weapon for its full checklist. <b>Next unrecorded</b> highlights a challenge in progress, or your next unrecorded camo.<br><span class="overview-legend">Military numbers = weapon levels · G = Gold · P = Platinum · H = Harmonic Break</span></p>`+prestigeHelp()+(weapons.length?arsenalSections(weapons).map(([title,note,list])=>`<section class="weapon-class"><h2>${esc(title)} <span>${esc(note)}</span></h2><div class="weapon-list">${list.map(w=>{
 const next=nextCamo(w.name),v=next&&variant(next),n=count(w.name);
 return `<article class="weapon-card ${w.id===selected.id?'selected':''}"><div class="row-identity"><button class="weapon-open" data-weapon="${w.id}" aria-label="View ${esc(w.name)} challenges"><span class="row-art">${w.image?`<img src="${esc(w.image)}" alt="" loading="lazy">`:`<span>${esc(w.name.slice(0,2))}</span>`}</span><span class="row-name"><strong>${esc(w.name)}</strong><span>${n} of 14 camos recorded</span>${w.unlockLevel?`<span class="row-unlock">Unlocks at player level ${w.unlockLevel}</span>`:''}</span></button>${loadoutLink(w)}</div><div class="row-stages"><div class="row-military"><span>Military <b>${stageCount(w.name,0,8)}/8</b></span><div class="level-strip">${weaponCamos(w.name).slice(0,8).map(c=>previewTrigger(c,done(w.name,c.slot)?'✓':variant(c).target??'?')).join('')}</div></div><div class="row-special"><span>Special <b>${stageCount(w.name,8,11)}/3</b></span><div class="stage-blocks">${[8,9,10].map(slot=>previewTrigger(weaponCamos(w.name).find(c=>c.slot===slot),done(w.name,slot)?'✓':slot-7)).join('')}</div></div><div class="row-finish"><span>Finishes <b>${stageCount(w.name,11,14)}/3</b></span><div class="finish-strip">${['G','P','H'].map((label,i)=>previewTrigger(weaponCamos(w.name).find(c=>c.slot===11+i),done(w.name,11+i)?'✓':label)).join('')}</div></div></div><button class="row-next" data-weapon="${w.id}"><span>${next?'Next unrecorded · '+esc(next.name):'All base camos recorded'}</span><strong>${next?esc(v.requirement):'Review your weapon checklist'}</strong><small>View challenges →</small></button>${weaponRowProgress(w.name)}</article>`;
 }).join('')}</div></section>`).join(''):'<div class="empty"><h2>No matching weapons.</h2>Try another name, objective, or class.</div>');
 renderDetails();
}
function loadoutLink(w){return w.loadout?`<a class="row-loadout" href="${esc(w.loadout)}" target="_blank" rel="noopener noreferrer" aria-label="Best ${esc(w.name)} loadouts on wzstats.gg (opens a new tab)">Best loadouts ↗</a>`:'';}
const PRESTIGE_BANDS=[[50,'Player levels 50–55','Locked longest after Classic Prestige — finish these first'],[30,'Player levels 30–48','A long wait after Classic Prestige'],[10,'Player levels 11–27','Back within the first few hours'],[0,'Player levels 4–9','Back almost straight away']];
function arsenalSections(weapons){
 if(arsenalOrder!=='prestige')return [...new Set(weapons.map(w=>w.class))].map(cls=>{const list=weapons.filter(w=>w.class===cls);return [cls,list.length+' weapons',list];});
 const sorted=[...weapons].sort((a,b)=>(b.unlockLevel||0)-(a.unlockLevel||0)||count(a.name)-count(b.name));
 return PRESTIGE_BANDS.map(([from,title,note],i)=>[title,note,sorted.filter(w=>(w.unlockLevel||0)>=from&&(i===0||(w.unlockLevel||0)<PRESTIGE_BANDS[i-1][0]))]).filter(([,,list])=>list.length);
}
function prestigeHelp(){return arsenalOrder==='prestige'?`<div class="prestige-help"><strong>Choosing a Prestige at level 55</strong><p><b>Classic Prestige</b> locks your guns and other level unlocks again until you reach their level, so camo work on late guns has to wait. Guns are listed from the latest unlock to the earliest, with the fewest camos recorded first. <b>Regular Prestige</b> keeps everything unlocked, so the order doesn't matter.</p><p class="prestige-caveat">Unlock levels come from community guides. Check the game's own warning before you confirm a Prestige: it isn't confirmed whether weapon levels and camo progress are kept.</p></div>`:'';}
function camoCard(c){
 const v=variant(c),g=c.slot>=0?goalFor(c):extraGoal(c),complete=c.slot>=0?done(c.weapon,c.slot):state.checks[c.checkKey];
 return `<article class="camo ${complete?'camo-complete':''}"><div class="tier">${esc(c.tier)}${c.unlockLevel?` · weapon level ${c.unlockLevel}${c.unlockConfidence==='community-estimate'?' (estimated)':''}`:''}${c.slot<0?' · '+esc(v.mode):''}</div><div class="camo-heading"><h3><button class="camo-name" data-camo-preview="${c.id}" aria-haspopup="dialog" aria-controls="camo-preview" aria-expanded="false">${esc(c.name)}</button></h3>${complete?'<span class="unlocked-label">✓ Recorded</span>':''}</div><p class="requirement">${esc(v.requirement)}</p>${v.unit==='sets'?`<p class="count-hint">One completed set = 1 progress. Target: ${v.target} sets.</p>`:''}${c.gate?`<p class="prerequisite"><b>First:</b> ${esc(c.gate)}</p>`:''}${g?`<div class="progress"><i style="width:${100*g.current/g.target}%"></i></div><p class="recorded-counter"><b>${g.current} / ${g.target}</b> recorded · ${esc(g.mode)}${g.mode===(v.mode==='Shared'?state.mode:v.mode)?'':' (different mode)'}</p>`:''}<div class="camo-actions"><label class="checkbox"><input type="checkbox" data-check="${c.id}" ${complete?'checked':''}> Unlocked</label><button data-edit-camo="${c.id}">Edit</button><button class="track" data-track="${c.id}" ${v.mode==='Warzone'?'disabled':''}>${v.mode==='Warzone'?'Season 1':g?.tracked?'Untrack':'Track +'}</button></div><details class="camo-source"><summary>${badge(v)} <span>Source & notes</span></summary>${v.note?`<p>${esc(v.note)}</p>`:''}<a class="source-link" href="${esc(v.source)}" target="_blank" rel="noopener noreferrer">Read source ↗</a></details></article>`;
}
function renderDetails(){
 hideCamoPreview();
 const list=weaponCamos(selected.name),next=nextCamo(selected.name),stages=[['Military','1','Level up the weapon','Earn the eight weapon-level milestones.'],['Special','2','Complete 3 challenges','Each camo has its own objective below.'],['Completionist','3','Finish the collection','Gold → Platinum → Harmonic Break.']];
 const extras=(catalog.extras||[]).filter(c=>c.weapon===selected.name||c.weapon==='Any weapon');
 $('#details').innerHTML=`<div class="weapon-detail-heading"><div><p class="eyebrow">${esc(selected.class)} · ${esc(state.mode)}</p><h2 id="weapon-title">${esc(selected.name)}</h2><p>${count(selected.name)} of 14 base camos recorded${selected.unlockLevel?' · unlocks at player level '+selected.unlockLevel:''}</p>${loadoutLink(selected)}</div><button class="close-dialog" aria-label="Close weapon challenges">Close ×</button></div><label class="weapon-mode-label">Show requirements for <select id="weapon-mode"><option ${state.mode==='Multiplayer'?'selected':''}>Multiplayer</option><option ${state.mode==='DMZ'?'selected':''}>DMZ</option></select></label><div class="weapon-explainer"><strong>How to unlock this weapon's camos</strong><p>Reach the Military levels and complete the three Special objectives. Then work through Gold, Platinum and Harmonic Break. Multiplayer and DMZ offer different objectives for the same unlocks.</p></div><div class="detail-tabs" role="group" aria-label="Weapon information"><button data-detail="camos" class="${detailTab==='camos'?'active':''}">Camo requirements</button><button data-detail="mastery" class="${detailTab==='mastery'?'active':''}">Prestige & mastery</button><button data-detail="goals" class="${detailTab==='goals'?'active':''}">My goals</button></div>${detailTab==='camos'?`<div class="jump-links" aria-label="Jump to camo section"><span>Jump to</span><button data-jump-group="Military">Military levels</button><button data-jump-group="Special">Special objectives</button><button data-jump-group="Completionist">Gold & beyond</button></div>${next?`<div class="next-callout"><div><span>NEXT UNRECORDED · ${esc(next.name)}</span><strong>${esc(variant(next).requirement)}</strong></div><button class="primary" data-jump-camo="${next.id}">Show challenge ↓</button></div>`:''}${stages.map(([tier,step,title,explanation])=>{const entries=list.filter(c=>c.tier===tier),recorded=entries.filter(c=>done(c.weapon,c.slot)).length;return `<section class="challenge-group" id="group-${tier}"><div class="group-heading" tabindex="-1"><span class="step-number">${step}</span><div><h3>${title}</h3><p>${explanation}</p></div><b>${recorded} / ${entries.length}</b></div><div class="challenge-grid ${tier==='Military'?'military-grid':''}">${entries.map(c=>`<div id="challenge-${c.id.replaceAll(':','-')}">${camoCard(c)}</div>`).join('')}</div></section>`;}).join('')}`:detailTab==='mastery'?`<p class="detail-intro">Extra goals beyond the 14 base camos. Requirements show their own game mode.</p><div class="challenge-grid">${extras.map(camoCard).join('')}</div>`:renderWeaponGoals()}`;
}
function renderWeaponGoals(){const goals=state.goals.filter(g=>g.weapon===selected.name||g.weapon==='Any weapon');return `<button data-new-goal="true">+ Custom goal</button>`+(goals.length?goals.map(goalCard).join(''):'<p class="detail-intro">No goals for this weapon yet. Track a camo or add your own.</p>');}
function goalCard(g){return `<article class="goal-card"><p class="eyebrow">${esc(g.weapon)} / ${esc(g.mode)}</p><h3>${esc(g.label)}</h3><p>${esc(g.requirement)}</p>${g.notes?`<p class="notes">${esc(g.notes)}</p>`:''}<div class="goal-count">${g.current}<span> / ${g.target} ${g.unit==='sets'?'sets':''}</span></div><div class="progress"><i style="width:${100*g.current/g.target}%"></i></div><p>${g.current===g.target?'Complete — untrack when ready.':`${g.target-g.current} remaining`}</p><div class="goal-actions"><button data-increment="${esc(g.id)}" ${g.current===g.target?'disabled':''}>+1</button><button data-edit-goal="${esc(g.id)}">Edit</button><button data-pin-goal="${esc(g.id)}">${g.tracked?'Untrack':'Track'}</button><button data-delete-goal="${esc(g.id)}" aria-label="Remove ${esc(g.label)}">Remove</button></div></article>`;}
function renderPlan(){const q=$('#search').value.toLowerCase();const goals=state.goals.filter(g=>g.tracked&&(g.label+' '+g.weapon+' '+g.requirement).toLowerCase().includes(q)).sort((a,b)=>a.order-b.order);$('#content').innerHTML=goals.length?`<div class="goal-grid">${goals.map(goalCard).join('')}</div>`:`<div class="empty"><p class="eyebrow">A LITTLE FOCUS GOES A LONG WAY</p><h2>What are you working on next?</h2><p>Choose up to six camos in the Arsenal, or add a custom objective. Your plan works without screenshots.</p><button class="primary" data-open-arsenal="true">Choose camos</button> <button data-new-goal="true">Add a custom goal</button></div>`;}
function renderLibrary(){const q=$('#search').value.toLowerCase();let images=[...catalog.images,...userMedia].filter(i=>(mediaFilter==='all'||i.kind===mediaFilter)&&i.caption.toLowerCase().includes(q));$('#content').innerHTML=`<p class="library-note">Reference sheets show the game’s actual artwork. A sheet can contain several camos; it is not an exact preview for every catalogue entry. Added images are stored deliberately in this browser, never captured automatically.</p><div class="goal-actions" style="margin:0 0 20px">${[['all','All references'],['weapons','Weapons'],['progression','Camos'],['personal','My images']].map(([k,n])=>`<button data-media-filter="${k}" class="${mediaFilter===k?'primary':''}">${n}</button>`).join('')}</div>${images.length?`<div class="gallery">${images.map(i=>`<button class="image-card" data-image="${esc(i.id)}"><img src="${esc(i.objectUrl||i.path)}" alt="${esc(i.caption)}" loading="lazy"><p>${esc(i.caption)}</p><small>${i.kind==='personal'?'Added by you':'Official Activision reference'}</small></button>`).join('')}</div>`:'<div class="empty">No matching reference images. Add one or change the filter.</div>'}`;}
let editingCamo=null;
function editGoal(goal,camo=null){editingCamo=camo||findCamo(goal?.camoId)||null;const v=camo?variant(camo):null;const g=goal||{id:crypto.randomUUID(),weapon:camo?.weapon||selected.name,label:camo?.name||'Next match goal',requirement:v?.requirement||'',current:0,target:v?.target||1,notes:v?.note||'',tracked:false};$('#goal-id').value=g.id;$('#goal-mode').value=g.mode||(v&&['Multiplayer','DMZ'].includes(v.mode)?v.mode:state.mode);$('#goal-mode').disabled=!!(editingCamo&&editingCamo.variants.length===1&&editingCamo.variants[0].mode!=='Shared');$('#goal-mode').dataset.previous=$('#goal-mode').value;$('#goal-weapon').innerHTML=['Any weapon',...catalog.weapons.map(w=>w.name)].map(w=>`<option ${w===g.weapon?'selected':''}>${esc(w)}</option>`).join('');for(const [input,field] of [['name','label'],['requirement','requirement'],['current','current'],['target','target'],['notes','notes']])$('#goal-'+input).value=g[field];$('#goal-tracked').checked=g.tracked;$('#goal-error').textContent='';$('#goal-dialog').showModal();}
$('#goal-mode').onchange=()=>{if(editingCamo){if(Number($('#goal-current').value)>0&&!confirm('Changing game mode uses a different requirement and resets this goal counter to zero. Continue?')){$('#goal-mode').value=$('#goal-mode').dataset.previous;return;}const v=editingCamo.variants.find(v=>v.mode===$('#goal-mode').value)||editingCamo.variants[0];$('#goal-requirement').value=v.requirement;$('#goal-target').value=v.target||1;$('#goal-current').value=0;}$('#goal-mode').dataset.previous=$('#goal-mode').value;};
$('#goal-form').addEventListener('submit',event=>{event.preventDefault();const old=state.goals.find(g=>g.id===$('#goal-id').value);let c=editingCamo;if(c&&c.weapon!==$('#goal-weapon').value)c=null;const g={...old,id:$('#goal-id').value,weapon:$('#goal-weapon').value,slot:c?.slot??old?.slot??-1,camoId:c?.id??old?.camoId,checkKey:c?.checkKey??old?.checkKey,label:$('#goal-name').value.trim(),requirement:$('#goal-requirement').value.trim(),current:Number($('#goal-current').value),target:Number($('#goal-target').value),notes:$('#goal-notes').value.trim(),tracked:$('#goal-tracked').checked,mode:old?.mode||state.mode,confidence:old?.confidence||'manual',order:old?.order??state.goals.length};if(old&&old.weapon!==g.weapon){g.slot=-1;delete g.camoId;delete g.checkKey;}
 g.mode=$('#goal-mode').value;const candidate={...state,goals:[...state.goals.filter(x=>x.id!==g.id),g]};try{validate(candidate);}catch(e){$('#goal-error').textContent=e.message;return;}if(commit(()=>{state.goals=candidate.goals;if(g.slot>=0)state.checks[slotKey(g.weapon,g.slot)]=g.current===g.target;else if(g.checkKey)state.checks[g.checkKey]=g.current===g.target;}))$('#goal-dialog').close();});
document.addEventListener('click',event=>{const b=event.target.closest('button');if(!b)return;const d=b.dataset;
 if(b.classList.contains('close-dialog')){b.closest('dialog').close();return;}
 if(d.view){view=d.view;$('#search').value='';render();}
 if(d.class){classFilter=d.class;view='arsenal';render();}
 if(d.weapon){selected=catalog.weapons.find(w=>w.id===d.weapon);detailTab='camos';renderDetails();if(!$('#weapon-dialog').open)$('#weapon-dialog').showModal();}
 if(d.detail){detailTab=d.detail;renderDetails();} if(d.jumpGroup){const group=document.getElementById('group-'+d.jumpGroup);group?.scrollIntoView({block:'start',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});group?.querySelector('.group-heading')?.focus({preventScroll:true});} if(d.jumpCamo){const target=document.getElementById('challenge-'+d.jumpCamo.replaceAll(':','-'));target?.scrollIntoView({block:'center',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});target?.querySelector('[data-track]')?.focus({preventScroll:true});}
 if(d.track)trackCamo(d.track);
 if(d.editCamo){const c=findCamo(d.editCamo);editGoal(c.slot>=0?goalFor(c):extraGoal(c),c);}
 if(d.editGoal)editGoal(state.goals.find(g=>g.id===d.editGoal));
 if(d.increment)setCounter(d.increment,1);
 if(d.pinGoal)commit(()=>{const g=state.goals.find(g=>g.id===d.pinGoal);g.tracked=!g.tracked;});
 if(d.deleteGoal&&confirm('Remove this goal? Existing camo unlock marks will stay recorded.'))commit(()=>state.goals=state.goals.filter(g=>g.id!==d.deleteGoal));
 if(d.newGoal)editGoal(null);
 if(d.openArsenal){view='arsenal';render();}
 if(d.mediaFilter){mediaFilter=d.mediaFilter;renderLibrary();}
 if(d.image){const i=[...catalog.images,...userMedia].find(i=>i.id===d.image);$('#large-image').src=i.objectUrl||i.path;$('#large-image').alt=i.caption;$('#image-title').textContent=i.caption;$('#image-caption').textContent=i.kind==='personal'?'Your local reference image.':'Official game artwork © Activision. Reference sheet; no endorsement implied.';$('#image-dialog').showModal();}
 if(d.autoAction)automationAction(d.autoAction);
});
document.addEventListener('change',event=>{if(event.target.id==='weapon-mode'){commit(()=>state.mode=event.target.value);return;}const id=event.target.dataset.check;if(id){const c=findCamo(id);commit(()=>setCamoUnlocked(c,event.target.checked));}});
$('#search').addEventListener('input',render);$('#order').addEventListener('change',()=>{arsenalOrder=$('#order').value==='prestige'?'prestige':'class';try{localStorage.setItem('mw4.arsenalOrder',arsenalOrder);}catch{}render();});$('#mode').addEventListener('change',()=>commit(()=>state.mode=$('#mode').value));$('#add-goal').onclick=()=>editGoal(null);$('#add-image').onclick=()=>$('#image-file').click();
function download(name,text,type='application/json'){const url=URL.createObjectURL(new Blob([text],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);}
$('#export').onclick=()=>download('MW4-plan.json',JSON.stringify({...state,format:'mw4-html-plan',exportedAt:new Date().toISOString()},null,2));$('#import').onclick=()=>$('#import-file').click();
$('#import-file').onchange=async()=>{const file=$('#import-file').files[0];if(!file)return;try{if(file.size>5e6)throw Error('Plans must be smaller than 5 MB.');const next=validate(JSON.parse(await file.text()));if(!confirm('Replace this browser’s manual progress and goals? A local backup will be retained.'))return;localStorage.setItem(KEY+'.before-import',JSON.stringify(state));const before=state;try{localStorage.setItem(KEY,JSON.stringify(next));state=next;}catch(e){state=before;throw e;}render();toast('Plan imported. Automatic capture has not been started.');}catch(e){toast('Import failed: '+e.message);}finally{$('#import-file').value='';}};
function info(title,html){$('#info-title').textContent=title;$('#info-body').innerHTML=html;$('#info-dialog').showModal();}
$('#credits').onclick=()=>info('Catalogue & sources',`<p>Checked ${esc(catalog.checkedAt)}. ${catalog.weapons.length} weapons, ${catalog.challenges.length} camo slots and 99 named Special camos.</p><p>Military entries retain numbered names where individual names have not been independently verified. Community requirements and estimated unlock levels can change; compare them with the current game. Conflicting and glitched entries are flagged rather than presented as verified.</p><ul>${catalog.sources.map(s=>`<li><a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.name)}</a></li>`).join('')}</ul><p>Game names and artwork belong to Activision. This is an independent local tool. MW4.GG database/code was not copied.</p><p>Share the clean MW4-HTML-Tracker.zip to let a friend start fresh. Share an exported plan separately if you want them to have your goals or progress. Personal reference images stay in this browser and are not included in plan exports.</p>`);
function mediaDB(){return new Promise((resolve,reject)=>{const r=indexedDB.open('mw4.fieldnotes.images',1);r.onupgradeneeded=()=>r.result.createObjectStore('images',{keyPath:'id'});r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
async function loadMedia(){const db=await mediaDB();const items=await new Promise((resolve,reject)=>{const r=db.transaction('images').objectStore('images').getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});db.close();userMedia.forEach(i=>URL.revokeObjectURL(i.objectUrl));userMedia=items.map(i=>({...i,objectUrl:URL.createObjectURL(i.blob)}));if(view==='library')renderLibrary();}
$('#image-file').onchange=async()=>{const file=$('#image-file').files[0];if(!file)return;try{if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>10e6)throw Error('Choose a PNG, JPEG or WebP smaller than 10 MB.');const decoded=await createImageBitmap(file);decoded.close();const db=await mediaDB();await new Promise((resolve,reject)=>{const tx=db.transaction('images','readwrite');tx.objectStore('images').put({id:crypto.randomUUID(),kind:'personal',caption:file.name.slice(0,100),blob:file});tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});db.close();await loadMedia();toast('Reference image saved in this browser.');}catch(e){toast('Could not add image: '+e.message);}finally{$('#image-file').value='';}};
async function api(path,method='GET',body){const response=await fetch('/api/'+path,{method,headers:{'X-Tracker-Token':token,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,cache:'no-store'});const result=await response.json();if(!response.ok)throw Error(result.error||'Companion request failed.');return result;}
function challengeSignature(text){
 return norm(text).replace(/\b(?:ELIMINATIONS?|KILLS?)\b/g,'KILL').replace(/\bPLAYERS\b/g,'PLAYER').replace(/\bENEMIES\b/g,'ENEMY').replace(/\bHEADSHOTS\b/g,'HEADSHOT').split(' ').filter(t=>t&&!['GET','REACH','THE','AGAINST','WHILE','USING','WITH','ON','TO','UNLOCK'].includes(t)).sort().join(' ');
}
function resolveAutomaticReading(r){
 if(!Number.isInteger(r.current)||!Number.isInteger(r.target)||r.current<0||r.target<1||r.target>1000000||r.current>r.target)return null;
 if(r.kind==='category'){
  const camos=completedCategoryCamos(r);return camos.length?{id:'category:'+canonical(r.weapon)+':'+r.category,camos}:null;
 }
 const signature=challengeSignature(r.challenge),matches=[];
 for(const c of [...catalog.challenges,...(catalog.extras||[])]){
  if(canonical(c.weapon)!==canonical(r.weapon))continue;
  for(const v of c.variants)if(v.target===r.target&&challengeSignature(v.requirement)===signature)matches.push({c,v});
 }
 const unique=[...new Set(matches.map(m=>m.c.id))];
 if(unique.length===1){
  const chosen=matches.find(m=>m.v.mode===state.mode)||matches[0],g=chosen.c.slot>=0?goalFor(chosen.c):extraGoal(chosen.c);
  const mode=chosen.v.mode==='Shared'?(g?.mode||state.mode):chosen.v.mode;
  const compatible=!g||(g.mode===mode&&g.target===r.target&&challengeSignature(g.requirement.split(/Prerequisite:/i)[0])===signature);
  if(!compatible&&r.current!==r.target)return null;
  return {id:'counter:'+chosen.c.id+':'+mode,camo:chosen.c,mode,goal:g,updateGoal:compatible};
 }
 if(unique.length>1)return null;
 const goals=state.goals.filter(g=>canonical(g.weapon)===canonical(r.weapon)&&g.target===r.target&&challengeSignature(g.requirement)===signature);
 return goals.length===1?{id:'goal:'+goals[0].id,goal:goals[0],mode:goals[0].mode,updateGoal:true}:null;
}
function automaticReceipt(r){return String(r.observedAt||'')+'|'+r.current+'/'+r.target;}
function automaticReadingStatus(r){
 const match=resolveAutomaticReading(r);
 if(match&&state.autoApplied?.[match.id]===automaticReceipt(r))return 'Applied automatically';
 if(r.kind==='category')return 'Category total only — individual unlocks are not identified';
 return 'Not matched to a specific camo or saved goal yet';
}
function applyAutomaticReadings(entries,{reapply=false}={}){
 const actions=entries.map(r=>({r,match:resolveAutomaticReading(r)})).filter(({r,match})=>match&&(reapply||state.autoApplied?.[match.id]!==automaticReceipt(r)));
 const summaries=entries.filter(r=>r.kind==='category'&&['MILITARY','SPECIAL','COMPLETIONIST','PRESTIGE'].includes(r.category)&&Number.isInteger(r.current)&&Number.isInteger(r.target)&&r.current>=0&&r.current<=r.target&&r.target>=1&&r.target<=8&&catalog.weapons.some(w=>canonical(w.name)===canonical(r.weapon))&&automaticReceipt(state.categoryTotals?.[canonical(r.weapon)+'|'+r.category]||{})!==automaticReceipt(r));
 if(!actions.length&&!summaries.length)return 0;
 const saved=commit(()=>{
  state.categoryTotals=state.categoryTotals||{};for(const r of summaries)state.categoryTotals[canonical(r.weapon)+'|'+r.category]={current:r.current,target:r.target,observedAt:String(r.observedAt||'')};
  state.autoApplied=state.autoApplied||{};
  for(const {r,match} of actions){
   if(match.camos){for(const c of match.camos)state.checks[c.slot>=0?slotKey(c.weapon,c.slot):c.checkKey]=true;}
   else{
    let g=match.goal;const c=match.camo;
    if(match.updateGoal){
     if(!g){g={id:crypto.randomUUID(),weapon:c.weapon,slot:c.slot,camoId:c.id,checkKey:c.checkKey,label:c.name,requirement:r.challenge,current:r.current,target:r.target,notes:'Automatically captured from the game',mode:match.mode,tracked:false,order:state.goals.length};state.goals.push(g);}
     else{g.current=r.current;g.target=r.target;}
    }
    if(r.current===r.target){const key=c?(c.slot>=0?slotKey(c.weapon,c.slot):c.checkKey):g.slot>=0?slotKey(g.weapon,g.slot):g.checkKey;if(c)setCamoUnlocked(c,true);else if(key)state.checks[key]=true;}
   }
   state.autoApplied[match.id]=automaticReceipt(r);
  }
 });
 return saved?actions.length+summaries.length:-1;
}
async function refreshAuto(){if(!companion)return;renderWatcherStatus();try{const status=await api('status');auto={...auto,...status,connected:true};$('#connection-dot').style.background=auto.running?'var(--lime)':'var(--muted)';if(!checkedNativeMigration){checkedNativeMigration=true;if(!localStorage.getItem(KEY)){const legacy=validate(await api('manual'));if(Object.keys(legacy.checks).length||legacy.goals.length){state=legacy;localStorage.setItem(KEY,JSON.stringify(state));render();toast('Your Windows tracker records were brought across.');}}}applyAutomaticReadings(auto.entries);if($('#info-dialog').open&&$('#info-title').textContent==='Automatic tracker')renderAutomation();}catch(e){auto.connected=false;auto.message=e.message;}renderWatcherStatus();}
function renderWatcherStatus(){
 const el=$('#watcher-status');if(!el)return;el.hidden=false;
 const stopped=auto.message==='Companion stopped.',label=stopped?'Watcher stopped':!auto.connected?(auto.message==='Capture is stopped.'?'Connecting to tracker':'Tracker connection lost'):auto.running?'Watcher running':'Watcher stopped';
 const level=stopped?'stopped':!auto.connected?'error':!auto.running?'stopped':/Paused:|Waiting:/.test(auto.message)?'paused':'running';
 const signature=label+'|'+auto.message;if(el.dataset.signature===signature)return;el.dataset.signature=signature;el.dataset.state=level;el.innerHTML='<strong>'+esc(label)+'</strong><span>'+esc(auto.message)+'</span>';
}
function completedCategoryCamos(r){
 if(r.kind!=='category'||!Number.isInteger(r.current)||!Number.isInteger(r.target)||r.current<0||r.current>r.target)return [];
 const w=catalog.weapons.find(w=>canonical(w.name)===canonical(r.weapon));if(!w)return [];
 if(r.category==='MILITARY'&&r.target===8)return weaponCamos(w.name).filter(c=>c.slot<r.current);
 if(r.current!==r.target)return [];
 if(r.category==='SPECIAL'&&r.target===3)return weaponCamos(w.name).filter(c=>c.slot>=8&&c.slot<11);
 if(r.category==='PRESTIGE'&&r.target===4)return (catalog.extras||[]).filter(c=>c.weapon===w.name&&c.tier==='Weapon Prestige');
 return [];
}
function renderReading(r){
 const status=automaticReadingStatus(r);
 if(r.kind==='category')return `<div class="mini-reading category-reading"><b>${esc(r.weapon)} — ${esc(String(r.category||'Category').toLowerCase())}: ${r.current} / ${r.target} unlocked</b><p>${esc(status)}</p>${r.category==='COMPLETIONIST'?'<p>Completionist totals do not identify which camo is unlocked.</p>':''}</div>`;
 return `<div class="mini-reading"><b>${esc(r.weapon)} — ${r.current} / ${r.target}</b><p>${esc(r.challenge)}</p><p>${esc(status)}</p></div>`;
}
function renderAutomation(){if(!companion){$('#info-body').innerHTML='<p>This HTML file works on its own for manual tracking. To enable automatic screenshots, close this tab and double-click <b>Open-Automatic-Tracker.cmd</b> in the app folder. It opens this same interface through the local Windows companion.</p><p>No game login is needed. Nothing starts capturing until you click Start tracker. Desktop captures are processed in memory and discarded.</p>';return;}
 $('#info-body').innerHTML=`<p class="capture-status"><b>${auto.running?'Watcher running':'Capture stopped'}</b><br>${esc(auto.message)}</p><button class="primary" data-auto-action="start" ${auto.running?'disabled':''}>Start tracker</button><button data-auto-action="stop" ${!auto.running?'disabled':''}>Stop tracker</button><label>Seconds between menu scans <select id="auto-interval">${[2,4,6,10,15,30].map(n=>`<option ${n===auto.interval?'selected':''}>${n}</option>`).join('')}</select></label><p>Low-resource tracking: a small menu-header check every ${Math.max(10,auto.interval)} seconds during play. Full-screen OCR runs only on a detected camo menu. Keep that menu visible for two scans. No screenshot files are saved.</p><hr><h3>Automatic updates</h3><p>Confirmed matching readings apply automatically. No review step is needed. Unmatched readings stay informational.</p>${auto.entries.length?auto.entries.map(renderReading).join(''):'<p>No saved challenge readings yet.</p>'}<hr><button data-auto-action="shutdown">Stop companion and close connection</button>`;
}
$('#automation').onclick=()=>{info('Automatic tracker','<p>Checking local tracker…</p>');renderAutomation();refreshAuto();};
async function automationAction(action){try{const interval=Number($('#auto-interval')?.value||4);await api(action,'POST',{interval});if(action==='shutdown'){auto.connected=false;auto.running=false;auto.message='Companion stopped.';renderWatcherStatus();$('#info-body').innerHTML='<p>The companion has stopped. Reopen index.html to continue in manual mode.</p>';return;}await refreshAuto();renderAutomation();}catch(e){toast(e.message);}}
$('#class-list').innerHTML=[...new Set(catalog.weapons.map(w=>w.class))].map(c=>`<button class="class-filter" data-class="${esc(c)}">${esc(c)}<span>${catalog.weapons.filter(w=>w.class===c).length}</span></button>`).join('');
window.addEventListener('storage',event=>{if(event.key===KEY&&event.newValue){try{state=validate(JSON.parse(event.newValue));render();if($('#info-dialog').open&&$('#info-title').textContent==='Automatic tracker')renderAutomation();}catch(e){toast('Could not sync another tab: '+e.message);}}});
render();loadMedia().catch(()=>{});if(companion){refreshAuto();setInterval(refreshAuto,4000);}
window.TrackerTest={get state(){return state;},validate,trackCamo,count,commit};

