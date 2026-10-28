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
 const api={parse,normal,key};
 if(typeof module==='object'&&module.exports)module.exports=api;else root.CamoRewardParser=api;
})(typeof window==='object'?window:globalThis);
