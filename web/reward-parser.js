/* Pure matching for after-match reward cards. Never infers unlocks from levels. */
(function(root){
 'use strict';
 const normal=text=>String(text||'').toUpperCase().replace(/[^A-Z0-9]+/g,' ').trim().replace(/\s+/g,' ');
 const key=text=>normal(text).replace(/ /g,'');
 const weaponKey=text=>key(text).replace(/0/g,'O');
 function parse({header,weapon,reward,confidence=0},catalog){
  if(confidence<70||!key(header).replace(/0/g,'O').includes('TOPPERFORMINGWEAPONS'))return null;
  const lines=String(weapon||'').split(/[\r\n]+/).map(weaponKey).filter(Boolean);
  const weapons=catalog.weapons.filter(w=>lines.includes(weaponKey(w.name)));
  if(weapons.length!==1)return null;
  const w=weapons[0],rewardLines=String(reward||'').split(/[\r\n]+/).map(normal).filter(Boolean);
  const military=rewardLines.map(line=>/^MILITARY CAMO ([1-8])$/.exec(line)).filter(Boolean);
  if(military.length===1){
   const slot=Number(military[0][1])-1;
   const camo=catalog.challenges.find(c=>c.weapon===w.name&&c.slot===slot);
   return camo?{id:camo.id,weapon:w.name,name:camo.name,slot,military:true}:null;
  }
  if(!rewardLines.includes('CAMO'))return null;
  const camos=[...catalog.challenges,...(catalog.extras||[])].filter(c=>c.weapon===w.name&&(c.slot>=8||c.checkKey)&&rewardLines.includes(normal(c.name)));
  if(camos.length!==1)return null;
  const c=camos[0];return {id:c.id,weapon:w.name,name:c.name,slot:c.slot,military:false};
 }
 function parseOverview({header,categories,confidence=0},catalog){
  if(confidence<60||!key(header).includes('CAMOSELECT'))return null;
  const headings=String(header||'').split(/[\r\n]+/).map(line=>{
   const compact=key(line);return compact.endsWith('PROGRESSION')?weaponKey(compact.slice(0,-11)).replace(/1/g,'I'):null;
  }).filter(Boolean);
  const weapons=catalog.weapons.filter(w=>headings.includes(weaponKey(w.name).replace(/1/g,'I')));
  if(weapons.length!==1)return null;
  const entries=[],expected={MILITARY:[8],SPECIAL:[3],COMPLETIONIST:[3,4],PRESTIGE:[4]};
  for(const reading of categories||[]){
   if(reading.confidence<60)continue;
   const text=String(reading.text||'').toUpperCase().replace(/[OØ](?=\s*\/)/g,'0').replace(/\|/g,' ').trim();
   const match=/^(MILITARY|SPECIAL|COMPLETIONIST|PRESTIGE)\s*[\[(]?\s*(\d{1,2})\s*\/\s*(\d{1,2})\s*[\])]?\s*$/.exec(text);
   if(!match)continue;
   const [,category,a,b]=match,current=Number(a),target=Number(b);
   if(current>target||!expected[category].includes(target))continue;
   entries.push({kind:'category',category,weapon:weapons[0].name,current,target,challenge:category+' category unlocks',observedAt:'browser-menu-v1:'+current+'/'+target});
  }
  const unique=entries.filter(entry=>entries.filter(other=>other.category===entry.category).length===1);
  return unique.length?{weapon:weapons[0].name,entries:unique,signature:weapons[0].id+'|'+unique.map(e=>e.category+':'+e.current+'/'+e.target).sort().join('|')}:null;
 }
 const api={parse,parseOverview,normal,key};
 if(typeof module==='object'&&module.exports)module.exports=api;else root.CamoRewardParser=api;
})(typeof window==='object'?window:globalThis);
