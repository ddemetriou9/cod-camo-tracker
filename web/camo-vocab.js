/* Closed-vocabulary decoding for the v2 tracker. OCR text is matched against the only things these
   screens can say (33 weapons, 4 category labels, valid totals, catalogue camo names) instead of exact
   string gates. A match must be close AND clearly better than the runner-up. Never infers from levels. */
(function(root){
 'use strict';
 const clean=text=>String(text||'').toUpperCase().replace(/[^A-Z0-9]+/g,' ').trim().replace(/\s+/g,' ');
 // Glyph pairs OCR commonly swaps on game fonts cost less than an unrelated substitution. The game's slashed zero
 // reads as 8 or 6 (".50 GS" → ".58 GS", "1095" → "1895").
 const CONFUSABLE=new Set(['O0','D0','Q0','80','60','I1','L1','IL','S5','B8','Z2','G6','T7','A4','UV','NM','CG','EF','HN','RP'].flatMap(p=>[p,p[1]+p[0]]));
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
   // Short patterns must start on a word boundary (so "PILA" cannot hide in "PILATES"); long phrases may
   // carry one stray glued character from a label border, at a small cost.
   if(!boundary&&m<8)continue;
   const endBoundary=j===n||t[j]===' ';
   const cost=prev[j]+(endBoundary||m>4?0:1)+(boundary?0:.5);
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
 const ANCHORS={menu:'CAMO SELECT',results:'TOP PERFORMING WEAPONS',aar:'AFTER ACTION REPORT',record:'COMBAT RECORD'};
 function anchorIn(lines){
  for(const line of lines)for(const [screen,text] of Object.entries(ANCHORS)){const hit=locate(line.text,text);if(hit&&hit.cost<=allowance(text))return {screen,line,cost:hit.cost};}
  return null;
 }
 const TARGETS={MILITARY:[8],SPECIAL:[3],COMPLETIONIST:[3,4],PRESTIGE:[4]};
 const DIGIT={O:'0',D:'0',Q:'0',I:'1',L:'1',Z:'2',S:'5',B:'8',G:'6',T:'7'};
 const STRICT=/^([0-9ODQILZSBGT]{1,2})[/\\|]([0-9ODQILZSBGT])$/,PACKED=/^([0-9ODQILZSBGT])[1IL]([348])$/;
 /* Reads "3/8" or "[3/8]" totals at the end of a category line. Brackets often OCR as I, L, 1 or |, and a
    label's last letter can run into the digits, so up to two characters are trimmed from either end; the first
    reading that is a valid total for the category wins (up to four leading characters, for label letters such as "...IST"). The game's slashed zero can read as 8 or 6: for
    groups whose target is below 8 that is the only valid interpretation. Otherwise the total is flagged (zeroAlt) so
    the padlock tiles can decide between it and 0. */
 function counter(text,category){
  const raw=String(text||'').toUpperCase().replace(/[^0-9A-Z/\\|]/g,'');
  const tail=(/[0-9ODQILZSBGTJ/\\|]+$/.exec(raw)||[''])[0];
  const options=[];for(let a=0;a<=4;a++)for(let b=0;b<=2;b++)if(tail.length-a-b>=2)options.push([a+b,tail.slice(a,tail.length-b)]);
  options.sort((x,y)=>x[0]-y[0]);
  for(const [,s] of options){
   const m=STRICT.exec(s)||PACKED.exec(s);if(!m)continue;
   let current=Number(m[1].replace(/./g,c=>DIGIT[c]||c));const target=Number(m[2].replace(/./g,c=>DIGIT[c]||c));
   if(!TARGETS[category].includes(target))continue;
   if(current>target&&target<8&&/^[86B]$/.test(m[1]))current=0;
   if(current<=target)return /^[86B]$/.test(m[1])&&current>0?{current,target,zeroAlt:true}:{current,target};
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
 /* With the PROGRESSION word present, the weapon name is all of the text before it, so unmatched text counts
    against a candidate (a short name like "M4" cannot hide inside "KRAIT P68"). The tab's left edge often clips
    the first letters ("‘ARBON EDGE"), so up to three leading characters may be missing at a small cost. */
 function tabWeapon(text,catalog){
  const n=clean(text).replace(/ /g,'').length;
  const scored=catalog.weapons.map(w=>{const name=clean(w.name);let cost=Infinity;
   for(let k=0;k<=Math.min(3,Math.floor(name.replace(/ /g,'').length*.3));k++){
    let rest=name,dropped=0;while(dropped<k&&rest){if(rest[0]!==' ')dropped++;rest=rest.slice(1);}rest=rest.trim();if(!rest)break;
    const hit=locate(text,rest);if(!hit||(k&&hit.start>0))continue;
    const unmatched=Math.max(0,n-clean(text).slice(hit.start,hit.end+1).replace(/ /g,'').length);
    cost=Math.min(cost,hit.cost+.4*k+.5*unmatched);
   }
   return {w,cost};}).sort((a,b)=>a.cost-b.cost);
  const [first,second]=scored;
  return first.cost<=allowance(first.w.name)&&(!second||second.cost>=first.cost+1)?{candidate:first.w,cost:first.cost}:null;
 }
 function menuWeapon(lines,catalog){
  const hits=[];
  for(const line of lines){const cut=progressionCut(line.text);const found=cut.labelled?tabWeapon(cut.text,catalog):best(cut.text,catalog.weapons,{label:w=>w.name});if(found)hits.push({weapon:found.candidate,line,labelled:cut.labelled,cost:found.cost});}
  const pool=hits.some(h=>h.labelled)?hits.filter(h=>h.labelled):hits;
  const names=[...new Set(pool.map(h=>h.weapon.name))];
  return names.length===1?pool.sort((a,b)=>a.cost-b.cost)[0]:null;
 }
 /* The "<WEAPON> PROGRESSION" tab appears only on a weapon's Camo Select menu, so it identifies the menu when the
    "CAMO SELECT" title is unreadable (it often merges with the stylised text beside it). Needs the PROGRESSION word. */
 function menuTab(lines,catalog){const found=menuWeapon(lines,catalog);return found&&found.labelled?{weapon:found.weapon.name,line:found.line}:null;}
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
  const categories=Object.entries(totals).filter(([,v])=>v).map(([category,v])=>({category,current:v.current,target:v.target,...(v.zeroAlt?{zeroAlt:true}:{}),line:v.parts[0],parts:v.parts}));
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
  const w=weapon.weapon.name,single=rewardLines.map(l=>clean(l.text)).filter(Boolean);
  // A label can come back split across two neighbouring boxes ("MILITARY CA" / "AMO 4"), so also try each pair joined.
  // OCR often repeats the letter at the split ("CA" + "AMO"), so a repeated seam character is also removed.
  const seam=(a,b)=>{for(let k=Math.min(2,a.length,b.length);k>0;k--)if(a.slice(-k)===b.slice(0,k))return a+b.slice(k);return a+b;};
  const lines=[...single,...single.slice(1).flatMap((l,i)=>[single[i]+' '+l,seam(single[i],l)])];
  // Several cards can sit side by side; the highest Military number covers the earlier ones (sequential unlocks).
  let military=null,unreadable=false;
  for(const line of lines){
   const hit=locate(line,'MILITARY CAMO');
   if(!hit||hit.cost>1.5)continue;
   // The number must be its own token and a real digit: "MILITARY CAMG" must never become Military 6 via G→6.
   const next=line.slice(hit.end).trim().split(' ')[0]||'',rest=line.slice(hit.end);
   const slot=/^\s/.test(rest)&&/^[1-8]$/.test(next)?Number(next)-1:-1;
   if(slot>=0&&slot<8)military=Math.max(military??-1,slot);else unreadable=true;
  }
  if(military!==null){
   const camo=catalog.challenges.find(c=>c.weapon===w&&c.slot===military);
   return camo?{reward:{id:camo.id,weapon:w,name:camo.name,slot:military,military:true},weaponLine:weapon.line}:{reward:null,weapon:w,issue:'Military slot missing from catalogue.'};
  }
  if(unreadable)return {reward:null,weapon:w,issue:'Military camo number unreadable.'};
  // The type line under the name may say CAMO or the camo's group (the menu tooltip shows e.g. "SPECIAL").
  const typed=lines.some(line=>line.split(' ').some(word=>(locate(word,'CAMO')?.cost<=.35&&word.length<=5)||['SPECIAL','PRESTIGE','COMPLETIONIST','MASTERY'].some(t=>word.length>=t.length-1&&locate(word,t)?.cost<=1)));
  if(!typed)return {reward:null,weapon:w,issue:'No camo type label on the card.'};
  const named=[...catalog.challenges,...(catalog.extras||[])].filter(c=>c.weapon===w&&(c.slot>=8||c.checkKey));
  const hits=lines.map(line=>best(line,named,{label:c=>c.name,margin:1.5})).filter(Boolean);
  const ids=[...new Set(hits.map(h=>h.candidate.id))];
  if(ids.length!==1)return {reward:null,weapon:w,issue:ids.length?'More than one camo name matched.':'No camo name for '+w+' matched.'};
  const c=hits[0].candidate;
  return {reward:{id:c.id,weapon:w,name:c.name,slot:c.slot,military:false},weaponLine:weapon.line};
 }

 /* ---- After Action Report (match stats) ---- */
 const STAT_LABELS=['SCORE','KILLS','ASSISTS','DEATHS'];
 const MODES=['TEAM DEATHMATCH','DOMINATION','HARDPOINT','KILL CONFIRMED','SEARCH AND DESTROY','FREE FOR ALL','HEADQUARTERS','CONTROL','GUNFIGHT','CYBER ATTACK','KILL ORDER','GRIND','INFECTED','GUN GAME','ALL OR NOTHING','ONE IN THE CHAMBER','SHARPSHOOTER','PROP HUNT','GROUND WAR','INVASION','WAR','RANKED PLAY'];
 const title=text=>clean(text).toLowerCase().replace(/(^| )[a-z]/g,c=>c.toUpperCase());
 // The four stat labels under the numbers; each number is read separately from just above its label.
 function statLabels(lines){
  const found={};
  for(const line of lines)for(const word of STAT_LABELS){const hit=locate(line.text,word);if(hit&&hit.cost<=allowance(word)&&clean(line.text).length<=word.length+3&&!found[word])found[word]=line;}
  return found;
 }
 /* Summary tab of the After Action Report: VICTORY/DEFEAT/DRAW, the mode box with the map beside it, the four
    stats and the top-performing weapon. Returns a match only when the result and all four numbers are readable. */
 function decodeAar(lines,numbers,weaponLines,catalog){
  const result=lines.map(l=>({line:l,hit:best(l.text,['VICTORY','DEFEAT','DRAW'])})).find(r=>r.hit);
  if(!result)return {match:null,issue:'No Victory, Defeat or Draw heading.'};
  const stats={};
  for(const word of STAT_LABELS){const t=String(numbers[word]??'').replace(/\s/g,'');if(!/^\d{1,6}$/.test(t))return {match:null,issue:word[0]+word.slice(1).toLowerCase()+' unreadable.'};stats[word.toLowerCase()]=Number(t);}
  if(stats.kills>999||stats.deaths>999||stats.assists>999)return {match:null,issue:'Stat out of range.'};
  // The mode sits in a white box under the result; the map name is the text to its right on the same row.
  const below=lines.filter(l=>l.frame[1]>result.line.frame[1]&&l!==result.line);
  const modeHit=below.map(l=>({line:l,hit:best(l.text,MODES,{margin:.5})})).find(m=>m.hit);
  const modeLine=modeHit?.line||below.find(l=>/[A-Z]{4}/.test(clean(l.text))&&!statLabels([l])[clean(l.text)]);
  let mode=modeHit?title(modeHit.hit.candidate):null,map=null;
  if(modeLine){
   const h=modeLine.frame[3]-modeLine.frame[1];
   const side=below.find(l=>l!==modeLine&&l.frame[0]>=modeLine.frame[2]-h&&Math.abs(l.frame[1]-modeLine.frame[1])<h*.6&&l.confidence>=60);
   const words=clean(side?.text||'').replace(/[0-9]/g,'').trim();
   if(words.length>=3)map=title(words);
  }
  const weapon=weaponLines.length?rewardWeapon(weaponLines,catalog)?.weapon.name||null:null;
  return {match:{result:title(result.hit.candidate),mode,map,...stats,weapon}};
 }

 /* ---- Combat Record (lifetime stats) ---- */
 const RECORD_FIELDS={kills:['KILLS'],deaths:['DEATHS'],kd:['K/D RATIO','KD RATIO','K/D','KD'],wins:['WINS'],losses:['LOSSES'],wl:['W/L RATIO','WL RATIO','W/L','WL'],spm:['SCORE PER MINUTE','SCORE/MIN','SPM'],time:['TIME PLAYED'],streak:['BEST STREAK','BEST KILLSTREAK','LONGEST STREAK','HIGHEST STREAK']};
 const compact=text=>clean(text).replace(/ /g,'');
 function recordField(text){
  const c=compact(text);if(!c)return null;
  for(const [field,names] of Object.entries(RECORD_FIELDS))for(const name of names){
   const p=compact(name);
   if(c===p||(p.length>=5&&c.length<=p.length+3&&locate(c,p)?.cost<=allowance(p)))return field;
  }
  return null;
 }
 const VALUE=/^\d[\d,.:]*(\s*\d*\s*[DHMS]?)*$/i;
 const isValue=text=>VALUE.test(String(text||'').trim());
 function hoursOf(text){
  const t=String(text).toUpperCase(),clock=/^(\d+):(\d{2})(?::\d{2})?$/.exec(t.trim());
  if(clock)return Number(clock[1])+Number(clock[2])/60;
  const part=u=>Number((new RegExp('(\\d+)\\s*'+u)).exec(t)?.[1]||0),has=/\d\s*[DHM]/.test(t);
  return has?part('D')*24+part('H')+part('M')/60:null;
 }
 const whole=text=>{const t=String(text).replace(/[,.\s]/g,'');return /^\d{1,10}$/.test(t)?Number(t):null;};
 const decimal=text=>{const t=String(text).replace(/,/g,'.').trim();return /^\d+(\.\d+)?$/.test(t)?Number(t):null;};
 // The screen's layout is not assumed: each direction is tried, and only one whose numbers agree with each other counts.
 function pairUp(labels,values,direction){
  const used=new Set(),out={};
  for(const {field,line} of labels){
   const [x0,y0,x1,y1]=line.frame,h=y1-y0,cx=(x0+x1)/2;let best=null,bestGap=Infinity;
   for(const v of values){
    if(used.has(v))continue;const [a,b,c,d]=v.frame,mid=(a+c)/2,same=Math.abs(mid-cx)<=Math.max(c-a,x1-x0)*.7+h;let gap=null;
    if(direction==='above'&&same&&d<=y0+h*.3&&y0-d<=h*3.5)gap=y0-d;
    if(direction==='below'&&same&&b>=y1-h*.3&&b-y1<=h*3.5)gap=b-y1;
    if(direction==='right'&&Math.abs((b+d)/2-(y0+y1)/2)<=h&&a>=x1-h&&a-x1<=h*25)gap=a-x1;
    if(gap!=null&&gap<bestGap){best=v;bestGap=gap;}
   }
   if(best){used.add(best);out[field]=best.text;}
  }
  return out;
 }
 function recordFrom(raw){
  const record={kills:whole(raw.kills),deaths:whole(raw.deaths),wins:whole(raw.wins),losses:whole(raw.losses),bestStreak:whole(raw.streak),spm:decimal(raw.spm),hours:raw.time?hoursOf(raw.time):null};
  const kd=decimal(raw.kd),wl=decimal(raw.wl);
  if(record.kills==null||record.deaths==null||kd==null)return null;
  // The game prints two decimals, so a correct read lands within half a hundredth.
  if(Math.abs((record.deaths?record.kills/record.deaths:record.kills)-kd)>.0055)return null;
  if(record.wins!=null&&record.losses!=null&&wl!=null&&Math.abs((record.losses?record.wins/record.losses:record.wins)-wl)>.0055)return null;
  return record;
 }
 /* Lifetime stats are saved only when kills, deaths and the K/D printed beside them agree, so a misread that moves the
    ratio (a wrong leading digit, a digit lost to the background) is refused. A wrong last digit barely moves it, so the
    slashed-zero shape check in the engine has to catch those. */
 function decodeRecord(lines){
  const labels=[],values=[],inline={};
  for(const line of lines){
   const text=String(line.text||'').trim(),split=/^([A-Za-z/ ]+?)[\s:]+(\d[\d,.:]*(?:\s*\d*\s*[DHMS])*)$/.exec(text);
   const field=recordField(text);
   if(split&&recordField(split[1]))inline[recordField(split[1])]=split[2];
   else if(field)labels.push({field,line});
   else if(isValue(text))values.push(line);
  }
  if(!labels.length&&!Object.keys(inline).length)return {record:null,issue:'No stat labels found.'};
  let found=null;
  const size=r=>Object.values(r).filter(v=>v!=null).length;
  for(const direction of ['above','below','right']){
   const record=recordFrom({...pairUp(labels,values,direction),...inline});
   if(record&&(!found||size(record)>size(found)))found=record;
  }
  return found?{record:found}:{record:null,issue:'Kills, deaths and K/D did not agree.'};
 }
 const api={clean,locate,best,anchorIn,counter,categoryIn,decodeMenu,decodeReward,menuWeapon,menuTab,statLabels,decodeAar,decodeRecord,isValue,ANCHORS,TARGETS,MODES};
 if(typeof module==='object'&&module.exports)module.exports=api;else root.CamoVocab=api;
})(typeof window==='object'?window:globalThis);
