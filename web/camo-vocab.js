/* Closed-vocabulary decoding for the v2 tracker. OCR text is matched against the only things these
   screens can say (33 weapons, 4 category labels, valid totals, catalogue camo names) instead of exact
   string gates. A match must be close AND clearly better than the runner-up. Never infers from levels. */
(function(root){
 'use strict';
 const clean=text=>String(text||'').toUpperCase().replace(/[^A-Z0-9]+/g,' ').trim().replace(/\s+/g,' ');
 // Glyph pairs OCR commonly swaps on game fonts cost less than an unrelated substitution.
 const CONFUSABLE=new Set(['O0','D0','Q0','I1','L1','IL','S5','B8','Z2','G6','T7','A4','UV','NM','CG','EF','HN','RP'].flatMap(p=>[p,p[1]+p[0]]));
 const sub=(a,b)=>a===b?0:a===' '||b===' '?.6:CONFUSABLE.has(a+b)?.35:1;
 const gap=c=>c===' '?.3:1;
 /* Cost of matching the whole pattern somewhere inside text (free leading/trailing text), with the
    matched span. Spans must start on a word boundary so "PILA" cannot hide inside "PILATES". */
 function locate(text,pattern){
  const t=' '+clean(text),p=clean(pattern),n=t.length,m=p.length;if(!m)return null;
  let prev=new Array(n+1).fill(0),start=[...Array(n+1).keys()];
  for(let i=1;i<=m;i++){
   const cur=new Array(n+1),cs=new Array(n+1);cur[0]=prev[0]+gap(p[i-1]);cs[0]=0;
   for(let j=1;j<=n;j++){
    const diag=prev[j-1]+sub(p[i-1],t[j-1]),up=prev[j]+gap(p[i-1]),left=cur[j-1]+gap(t[j-1]);
    if(diag<=up&&diag<=left){cur[j]=diag;cs[j]=i===1?j-1:start[j-1];}else if(up<=left){cur[j]=up;cs[j]=i===1?j:start[j];}else{cur[j]=left;cs[j]=cs[j-1];}
   }
   prev=cur;start=cs;
  }
  let best=null;
  for(let j=1;j<=n;j++){
   const s=start[j],boundary=s===0||t[s-1]===' '||t[s]===' ';
   if(!boundary)continue;
   const endBoundary=j===n||t[j]===' ';
   const cost=prev[j]+(endBoundary||m>4?0:1);
   if(!best||cost<best.cost)best={cost,start:Math.max(0,s-1),end:j-1};
  }
  return best;
 }
 const allowance=pattern=>{const len=clean(pattern).replace(/ /g,'').length;return len<=3?.35:len<=5?.75:Math.max(1,len*.2);};
 /* Picks the single best candidate. Returns null when nothing is close enough or two candidates are similarly close. */
 function best(text,candidates,{label=c=>c,margin=1}={}){
  const scored=candidates.map(c=>({candidate:c,...(locate(text,label(c))||{cost:Infinity})})).sort((a,b)=>a.cost-b.cost);
  const [first,second]=scored;
  if(!first||first.cost>allowance(label(first.candidate)))return null;
  if(second&&second.cost<first.cost+margin&&label(second.candidate)!==label(first.candidate))return null;
  return first;
 }
 const ANCHORS={menu:'CAMO SELECT',results:'TOP PERFORMING WEAPONS'};
 function anchorIn(lines){
  for(const line of lines)for(const [screen,text] of Object.entries(ANCHORS)){const hit=locate(line.text,text);if(hit&&hit.cost<=allowance(text))return {screen,line,cost:hit.cost};}
  return null;
 }
 const TARGETS={MILITARY:[8],SPECIAL:[3],COMPLETIONIST:[3,4],PRESTIGE:[4]};
 const DIGIT={O:'0',D:'0',Q:'0',I:'1',L:'1',Z:'2',S:'5',B:'8',G:'6',T:'7'};
 const STRICT=/^([0-9ODQILZSBGT]{1,2})[/\\|]([0-9ODQILZSBGT])$/,PACKED=/^([0-9ODQILZSBGT])[1IL]([348])$/;
 /* Reads "3/8" or "[3/8]" totals at the end of a category line. Brackets often OCR as I, L, 1 or |, and a
    label's last letter can run into the digits, so up to two characters are trimmed from either end; the first
    reading that is a valid total for the category wins (up to four leading characters, for label letters such as "...IST"). The game's slashed zero can read as 8: for groups whose
    target is below 8 that is the only valid interpretation. (Totals are also cross-checked against padlock tiles.) */
 function counter(text,category){
  const raw=String(text||'').toUpperCase().replace(/[^0-9A-Z/\\|]/g,'');
  const tail=(/[0-9ODQILZSBGTJ/\\|]+$/.exec(raw)||[''])[0];
  const options=[];for(let a=0;a<=4;a++)for(let b=0;b<=2;b++)if(tail.length-a-b>=2)options.push([a+b,tail.slice(a,tail.length-b)]);
  options.sort((x,y)=>x[0]-y[0]);
  for(const [,s] of options){
   const m=STRICT.exec(s)||PACKED.exec(s);if(!m)continue;
   let current=Number(m[1].replace(/./g,c=>DIGIT[c]||c));const target=Number(m[2].replace(/./g,c=>DIGIT[c]||c));
   if(!TARGETS[category].includes(target))continue;
   if(current>target&&target<8&&/^[8B]$/.test(m[1]))current=0;
   if(current<=target)return {current,target};
  }
  return null;
 }
 function categoryIn(text){
  // Wide letter spacing can OCR as "M I L I T A R Y", so the label is matched at the start of the line without spaces.
  const compact=clean(text).replace(/ /g,'');if(compact.length<5)return null;
  const found=best(compact.slice(0,15),Object.keys(TARGETS),{margin:2});
  return found&&found.start===0?{category:found.candidate,rest:compact.slice(found.end)}:null;
 }
 const progressionCut=text=>{const words=clean(text).split(' ');const at=words.findIndex((w,i)=>i>0&&w.length>=5&&locate(w,'PROGRESSION'.slice(0,Math.min(11,w.length)))?.cost<=1);return at>0?{text:words.slice(0,at).join(' '),labelled:true}:{text:clean(text),labelled:false};};
 /* Weapon from a camo-menu heading such as "KASTOV 762 PROGRESS" (often truncated or with stray symbols). */
 function menuWeapon(lines,catalog){
  const hits=[];
  for(const line of lines){const cut=progressionCut(line.text);const found=best(cut.text,catalog.weapons,{label:w=>w.name});if(found)hits.push({weapon:found.candidate,line,labelled:cut.labelled,cost:found.cost});}
  const pool=hits.some(h=>h.labelled)?hits.filter(h=>h.labelled):hits;
  const names=[...new Set(pool.map(h=>h.weapon.name))];
  return names.length===1?pool.sort((a,b)=>a.cost-b.cost)[0]:null;
 }
 function decodeMenu(lines,catalog){
  const weapon=menuWeapon(lines,catalog),totals={},issues=[];
  for(let i=0;i<lines.length;i++){
   const found=categoryIn(lines[i].text);if(!found)continue;
   let value=counter(found.rest,found.category)||counter(lines[i].text,found.category),parts=[lines[i]];
   if(!value&&clean(found.rest).replace(/[A-Z]/g,'')===''&&lines[i+1]){value=counter(lines[i+1].text,found.category);parts=[lines[i],lines[i+1]];}
   if(!value){issues.push(found.category+' total unreadable: '+String(lines[i].text).trim().slice(0,40));continue;}
   if(totals[found.category]&&(totals[found.category].current!==value.current||totals[found.category].target!==value.target)){totals[found.category]=null;issues.push(found.category+' read twice with different totals');continue;}
   if(totals[found.category]!==null)totals[found.category]={...value,parts};
  }
  if(!weapon)issues.unshift('No single weapon heading matched.');
  const categories=Object.entries(totals).filter(([,v])=>v).map(([category,v])=>({category,current:v.current,target:v.target,line:v.parts[0],parts:v.parts}));
  return {weapon:weapon?.weapon.name||null,weaponLine:weapon?.line||null,categories,issues};
 }
 function rewardWeapon(lines,catalog){
  const hits=lines.map(line=>({line,found:best(line.text,catalog.weapons,{label:w=>w.name})})).filter(h=>h.found);
  const names=[...new Set(hits.map(h=>h.found.candidate.name))];
  return names.length===1?{weapon:hits[0].found.candidate,line:hits[0].line}:null;
 }
 /* After-match reward card: either "MILITARY CAMO n", or a catalogue camo name for that weapon plus a "CAMO" type label.
    Attachments, XP and weapon levels never match this vocabulary and are ignored. */
 function decodeReward(weaponLines,rewardLines,catalog){
  const weapon=rewardWeapon(weaponLines,catalog);
  if(!weapon)return {reward:null,issue:'No single weapon name matched.'};
  const w=weapon.weapon.name,lines=rewardLines.map(l=>clean(l.text)).filter(Boolean);
  for(const line of lines){
   const hit=locate(line,'MILITARY CAMO');
   if(hit&&hit.cost<=1.5){
    const digit=line.slice(hit.end).replace(/ /g,'').slice(0,1).replace(/./,c=>DIGIT[c]||c);
    const slot=Number(digit)-1;
    if(!(slot>=0&&slot<8))return {reward:null,weapon:w,issue:'Military camo number unreadable.'};
    const camo=catalog.challenges.find(c=>c.weapon===w&&c.slot===slot);
    return camo?{reward:{id:camo.id,weapon:w,name:camo.name,slot,military:true},weaponLine:weapon.line}:{reward:null,weapon:w,issue:'Military slot missing from catalogue.'};
  }}
  const typed=lines.some(line=>line.split(' ').some(word=>locate(word,'CAMO')?.cost<=.35&&word.length<=5));
  if(!typed)return {reward:null,weapon:w,issue:'No CAMO type label on the card.'};
  const named=[...catalog.challenges,...(catalog.extras||[])].filter(c=>c.weapon===w&&(c.slot>=8||c.checkKey));
  const hits=lines.map(line=>best(line,named,{label:c=>c.name,margin:1.5})).filter(Boolean);
  const ids=[...new Set(hits.map(h=>h.candidate.id))];
  if(ids.length!==1)return {reward:null,weapon:w,issue:ids.length?'More than one camo name matched.':'No camo name for '+w+' matched.'};
  const c=hits[0].candidate;
  return {reward:{id:c.id,weapon:w,name:c.name,slot:c.slot,military:false},weaponLine:weapon.line};
 }
 const api={clean,locate,best,anchorIn,counter,categoryIn,decodeMenu,decodeReward,menuWeapon,ANCHORS,TARGETS};
 if(typeof module==='object'&&module.exports)module.exports=api;else root.CamoVocab=api;
})(typeof window==='object'?window:globalThis);
