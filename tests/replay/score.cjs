/* Turns hand-written clip labels into the progress the tracker should save, and compares it with what it saved.
   Scoring reads the browser's saved progress, i.e. what the main page shows, not intermediate OCR text. */
const norm=s=>String(s??'').toUpperCase().replace(/[^A-Z0-9]+/g,' ').trim().replace(/\s+/g,' ');
const canonical=s=>norm(s)==='COMBAT KNIFE'?'FSS CARBON EDGE 1095':norm(s);
const TARGETS={MILITARY:[8],SPECIAL:[3],COMPLETIONIST:[3,4],PRESTIGE:[4]};
const THRESHOLDS={menuRecall:.95,rewardRecall:.90};

function weaponOf(catalog,name){
 const weapon=catalog.weapons.find(w=>canonical(w.name)===canonical(name));
 if(!weapon)throw Error('Label names an unknown weapon: '+name);
 return weapon;
}
function total(category,value){
 const [current,target]=typeof value==='number'?[value,TARGETS[category][0]]:String(value).split('/').map(Number);
 if(!Number.isInteger(current)||!TARGETS[category].includes(target)||current<0||current>target)throw Error(`Invalid ${category} label: ${value}`);
 return {current,target};
}
// Mirrors the app's rules: Military totals unlock their prefix, complete groups unlock the group, partial groups unlock nothing.
function groupKeys(catalog,weapon,category){
 const w=canonical(weapon.name);
 if(category==='MILITARY')return [...Array(8).keys()].map(slot=>w+'|'+slot);
 if(category==='PRESTIGE')return (catalog.extras||[]).filter(c=>canonical(c.weapon)===w&&/prestige/i.test(c.id)).map(c=>c.checkKey.replace(/^[^|]*/,w));
 const tier={SPECIAL:'Special',COMPLETIONIST:'Completionist'}[category];
 return catalog.challenges.filter(c=>canonical(c.weapon)===w&&c.tier===tier).map(c=>w+'|'+c.slot);
}
function expectedFromLabels(labels,catalog){
 const totals={},required=new Set(),menus=[],rewards=[];
 for(const [index,menu] of (labels.menus||[]).entries()){
  const weapon=weaponOf(catalog,menu.weapon),keys=[];
  for(const category of Object.keys(TARGETS)){
   const value=menu[category.toLowerCase()];if(value===undefined)continue;
   const t=total(category,value),key=canonical(weapon.name)+'|'+category;totals[key]=t;keys.push(key);
   const group=groupKeys(catalog,weapon,category);
   if(category==='MILITARY')group.slice(0,t.current).forEach(k=>required.add(k));
   else if(t.current===t.target)group.forEach(k=>required.add(k));
  }
  // Camos the screen shows as unlocked (no padlock) in a partial group.
  for(const name of menu.unlocked||[]){
   const camo=[...catalog.challenges,...(catalog.extras||[])].find(c=>canonical(c.weapon)===canonical(weapon.name)&&norm(c.name)===norm(name));
   if(!camo)throw Error(`Label names an unknown camo for ${weapon.name}: ${name}`);
   required.add(camo.slot>=0?canonical(weapon.name)+'|'+camo.slot:camo.checkKey);
  }
  menus.push({index,weapon:weapon.name,at:menu.at,totals:keys});
 }
 for(const [index,reward] of (labels.rewards||[]).entries()){
  const weapon=weaponOf(catalog,reward.weapon),w=canonical(weapon.name);
  const camo=[...catalog.challenges,...(catalog.extras||[])].find(c=>canonical(c.weapon)===w&&norm(c.name)===norm(reward.camo));
  if(!camo)throw Error(`Label names an unknown camo for ${weapon.name}: ${reward.camo}`);
  const keys=camo.slot>=0&&camo.slot<8?[...Array(camo.slot+1).keys()].map(slot=>w+'|'+slot):[camo.slot>=0?w+'|'+camo.slot:camo.checkKey];
  // The app also records a Military reward as that weapon's Military total (at least slot+1 of 8).
  if(camo.slot>=0&&camo.slot<8){const key=w+'|MILITARY';if(!totals[key]||totals[key].current<camo.slot+1)totals[key]={current:camo.slot+1,target:8};}
  keys.forEach(k=>required.add(k));rewards.push({index,weapon:weapon.name,camo:camo.name,at:reward.at,key:keys.at(-1)});
 }
 return {totals,required,menus,rewards};
}

function score(expected,{report,state,replay},{rate=1}={}){
 const unlocked=new Set(Object.entries(state.checks||{}).filter(([,v])=>v===true).map(([k])=>k));
 const saved=state.categoryTotals||{},lines=[];
 const falseUnlocks=[...unlocked].filter(k=>!expected.required.has(k)),missingUnlocks=[...expected.required].filter(k=>!unlocked.has(k));
 const wrongTotals=[],missingTotals=[],unexpectedTotals=Object.keys(saved).filter(k=>!expected.totals[k]).map(k=>k+' '+saved[k].current+'/'+saved[k].target);
 for(const [key,t] of Object.entries(expected.totals)){
  const s=saved[key];if(!s)missingTotals.push(key+' '+t.current+'/'+t.target);
  else if(s.current!==t.current||s.target!==t.target)wrongTotals.push(`${key} saved ${s.current}/${s.target}, expected ${t.current}/${t.target}`);
 }
 const clipSeconds=iso=>replay.startedAt?Math.round((Date.parse(iso)-replay.startedAt)*rate/100)/10:null;
 const applies=(report.events||[]).filter(e=>e.type==='apply'&&e.result==='saved');
 const menuResults=expected.menus.map(m=>{
  const ok=m.totals.every(k=>saved[k]&&saved[k].current===expected.totals[k].current&&saved[k].target===expected.totals[k].target);
  const first=applies.find(e=>canonical(e.weapon)===canonical(m.weapon)&&e.mode!=='reward');
  return {...m,caught:ok,savedAtClipSecond:first?clipSeconds(first.at):null,latency:first&&m.at?Math.round((clipSeconds(first.at)-m.at[0])*10)/10:null};
 });
 const rewardResults=expected.rewards.map(r=>{
  const first=applies.find(e=>e.mode==='reward'&&canonical(e.weapon)===canonical(r.weapon)&&norm(e.camo)===norm(r.camo));
  return {...r,caught:unlocked.has(r.key),savedAtClipSecond:first?clipSeconds(first.at):null};
 });
 const recall=list=>list.length?list.filter(x=>x.caught).length/list.length:1;
 const menuRecall=recall(menuResults),rewardRecall=recall(rewardResults);
 const timing=report.timing||{},snapshot=report.snapshot||{};
 const resources={ocrReads:snapshot.reads??null,ocrBusyMs:snapshot.ocrBusyMs??null,workerStarts:timing.workerStarts??null,largestScanGapMs:timing.largestScanGapMs??null,deliveredFrames:replay.deliveredFrames,clipSeconds:replay.duration};
 const pass=!falseUnlocks.length&&!wrongTotals.length&&!unexpectedTotals.length&&menuRecall>=THRESHOLDS.menuRecall&&rewardRecall>=THRESHOLDS.rewardRecall;
 const pct=x=>Math.round(x*100)+'%';
 lines.push(`Menus caught: ${menuResults.filter(m=>m.caught).length}/${menuResults.length} (${pct(menuRecall)}, need ${pct(THRESHOLDS.menuRecall)})`);
 for(const m of menuResults)lines.push(`  ${m.caught?'✓':'✗'} ${m.weapon}${m.savedAtClipSecond!=null?' saved at '+m.savedAtClipSecond+'s':''}${m.latency!=null?' ('+m.latency+'s after it appeared)':''}`);
 lines.push(`Reward cards caught: ${rewardResults.filter(r=>r.caught).length}/${rewardResults.length} (${pct(rewardRecall)}, need ${pct(THRESHOLDS.rewardRecall)})`);
 for(const r of rewardResults)lines.push(`  ${r.caught?'✓':'✗'} ${r.weapon} — ${r.camo}${r.savedAtClipSecond!=null?' saved at '+r.savedAtClipSecond+'s':''}`);
 lines.push(`False unlocks: ${falseUnlocks.length}${falseUnlocks.length?' — '+falseUnlocks.join(', '):''} (must be 0)`);
 lines.push(`Wrong or unexpected totals: ${wrongTotals.length+unexpectedTotals.length}${[...wrongTotals,...unexpectedTotals].map(x=>'\n    '+x).join('')} (must be 0)`);
 if(missingTotals.length)lines.push(`Totals never saved: ${missingTotals.join(', ')}`);
 lines.push(`Resources: ${resources.ocrReads??'?'} OCR reads${resources.ocrBusyMs!=null?', OCR busy '+pct(resources.ocrBusyMs/1000/(resources.clipSeconds/rate)):''}, ${resources.workerStarts??'?'} OCR worker starts, largest scan gap ${resources.largestScanGapMs??'?'} ms, ${resources.deliveredFrames} frames delivered`);
 return {pass,replayStartedAt:replay.startedAt,events:(report.events||[]).slice(-200),lastRejected:report.lastRejected,lastReadings:report.lastReadings,menuRecall,rewardRecall,menuResults,rewardResults,falseUnlocks,missingUnlocks,wrongTotals,unexpectedTotals,missingTotals,resources,lines};
}
module.exports={expectedFromLabels,score,canonical};
