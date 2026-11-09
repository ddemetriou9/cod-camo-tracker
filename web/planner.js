/* "Play this next": turns recorded progress into a short list of weapons to use and what to do with them.
   Only uses what is known: recorded camos, catalogue requirements and recorded matches. Kills towards a challenge are
   not visible to the tracker, so "closest" means fewest camos and weapon levels left, never a guess at a count. */
(function(root){
 'use strict';
 // Ordered: the first pattern that matches a requirement decides its style.
 const STYLES=[
  ['destroy',/destroy .*killstreak/i,'Bring a launcher or something that hurts vehicles.'],
  ['launcher',/grenade launcher/i,'Use the named launcher for these.'],
  ['finisher',/melee finisher/i,'Get behind someone and hold melee.'],
  ['matchkills',/eliminations? in (one|a) (match|dmz deployment)/i,'Pick a fast mode and small map. Every kill counts towards this.'],
  ['burst',/without releasing the trigger/i,'Keep firing through groups of enemies. One long burst only.'],
  ['noreload',/without reloading/i,'Use a big magazine and chain kills before reloading.'],
  ['nodamage',/without taking damage/i,'Take flanks and fights you can win before they shoot back.'],
  ['nodying',/without dying/i,'Play a little safer and build a streak each life.'],
  ['quick',/(within|in) \d+ seconds/i,'Push where enemies are grouped so kills come quickly.'],
  ['double',/double kills?/i,'Fight near objectives, where enemies arrive together.'],
  ['longshot',/longshot/i,'Hold long sightlines. Distance is what counts.'],
  ['pointblank',/point blank/i,'Get right on top of enemies. Corners and rooms work best.'],
  ['hipfire',/hipfire/i,'Do not aim. Close range and laser sights help.'],
  ['quickscope',/quickscope/i,'Aim and fire in one quick motion.'],
  ['directshot',/direct shot/i,'Hit the enemy with the projectile itself, not the blast.'],
  ['oneshot',/one shot/i,'Aim for the spot this weapon kills in one hit.'],
  ['headshot',/headshot/i,'Keep your aim at head height and take your time.'],
  ['mounted',/mounted/i,'Mount on cover and let enemies come to you.'],
  ['prone',/prone/i,'Drop down before you shoot. Hold a lane from cover.'],
  ['behind',/from behind/i,'Flank and rotate behind the fight.'],
  ['ads',/aiming down sight|while ads/i,'Aim before every shot.'],
  ['jumping',/jumping/i,'Jump around corners and shoot in the air.'],
  ['moving',/while moving/i,'Keep strafing. Do not stand still to shoot.'],
  ['silencer',/silencer/i,'Put a silencer on before you start.'],
  ['crouched',/crouched/i,'Crouch before you shoot.'],
  ['focused',/focused/i,'Use Focus while you aim.'],
  ['akimbo',/akimbo/i,'Equip the Akimbo attachment.'],
  ['ledge',/ledge/i,'Hang from a ledge and shoot from there.'],
  ['level',/weapon level/i,'Any kills and match time earn weapon XP.'],
 ];
 const TIP=Object.fromEntries(STYLES.map(([tag,,tip])=>[tag,tip]));
 function classify(requirement){return (STYLES.find(([,pattern])=>pattern.test(requirement))||['other'])[0];}
 // "15 eliminations in one match" or "20 eliminations in a match 10 times": the kills needed in a single match.
 function matchKills(requirement){const hit=/(\d+)\s+\w*\s*eliminations? in (?:one|a) match/i.exec(requirement);return hit?Number(hit[1]):null;}

 /* Whether one kill can plausibly count for both challenges, judged from their wording rather than tested in game.
    Anything not listed goes together. These need their own weapon or target, so they stay apart from everything. */
 const ALONE=new Set(['destroy','launcher','finisher']);
 const CLASH={longshot:['pointblank','hipfire','jumping','ledge','akimbo'],hipfire:['ads','quickscope','mounted','akimbo'],prone:['jumping','moving','crouched','ledge','mounted'],mounted:['moving','jumping','crouched','ledge','pointblank'],jumping:['crouched','ledge'],moving:['ledge'],pointblank:['quickscope']};
 function compatible(a,b){
  if(a==='level'||b==='level')return true;
  if(a===b)return !ALONE.has(a);
  if(ALONE.has(a)||ALONE.has(b))return false;
  return !CLASH[a]?.includes(b)&&!CLASH[b]?.includes(a);
 }
 // The largest set that can run at once; there are at most three Specials, so trying every subset is cheap.
 function bestGroup(tasks){
  let best=[];
  for(let mask=1;mask<1<<tasks.length;mask++){
   const set=tasks.filter((_,i)=>mask&1<<i);
   if(set.length>best.length&&set.every((a,i)=>set.slice(i+1).every(b=>compatible(a.tag,b.tag))))best=set;
  }
  return best;
 }

 const plural=(n,word)=>n+' '+word+(n===1?'':'s');
 function insights(weapon,tasks,matches,mode){
  if(mode==='DMZ'||matches.length<2)return [];
  const out=[],recent=matches.slice(0,20);
  const needed=tasks.map(t=>matchKills(t.requirement)).find(n=>n!=null);
  if(needed&&recent.length>=3)out.push(`You got ${needed}+ kills in ${recent.filter(m=>m.kills>=needed).length} of your last ${recent.length} recorded matches.`);
  const own=bestMode(matches.filter(m=>m.weapon===weapon.name));
  if(own)out.push(`Your best mode for kills with this weapon is ${own.name}: ${own.avg.toFixed(1)} per match over ${own.n} matches.`);
  return out;
 }
 // Needs at least two modes with two matches each, so one good game does not decide it.
 function bestMode(list){
  // A Map because modes come from imported or shared data, where "__proto__" is a possible name.
  const groups=new Map();for(const m of list)if(m.mode)groups.set(m.mode,[...(groups.get(m.mode)||[]),m]);
  const ranked=[...groups].filter(([,ms])=>ms.length>=2).map(([name,ms])=>({name,n:ms.length,avg:ms.reduce((t,m)=>t+m.kills,0)/ms.length})).sort((a,b)=>b.avg-a.avg);
  return ranked.length>=2?ranked[0]:null;
 }

 function taskFor(camo,mode,floor){
  const v=camo.variants.find(x=>x.mode===mode)||camo.variants[0];
  const opensAt=camo.tier==='Special'&&camo.unlockLevel>floor?camo.unlockLevel:null;
  return {id:camo.id,name:camo.name,tier:camo.tier,requirement:v.requirement,target:v.target,unit:v.unit,confidence:v.confidence,issue:v.issue||null,tag:classify(v.requirement),opensAt,estimated:opensAt!=null&&camo.unlockConfidence==='community-estimate',together:false};
 }
 function planWeapon(weapon,{byWeapon,done,mode,matches,classGold,platinumAll}){
  const camos=byWeapon.get(weapon.name)||[],bySlot=slot=>camos.find(c=>c.slot===slot);
  const military=camos.filter(c=>c.slot>=0&&c.slot<8),specials=camos.filter(c=>c.slot>=8&&c.slot<11);
  const levelOf=c=>c.unlockLevel||0;
  // The menu never shows a weapon's level, but a recorded camo proves it reached at least that level.
  const proven=[...military.filter(c=>done(weapon.name,c.slot)),...specials.filter(c=>done(weapon.name,c.slot)&&c.unlockConfidence!=='community-estimate')];
  const floor=Math.max(0,...proven.map(levelOf));
  const milLeft=military.filter(c=>!done(weapon.name,c.slot)),specLeft=specials.filter(c=>!done(weapon.name,c.slot));
  const klass=classGold.get(weapon.class),make=c=>taskFor(c,mode,floor);
  let phase,tasks,effort,levelsLeft=0,headline;
  if(milLeft.length||specLeft.length||!done(weapon.name,11)){
   phase='gold';
   levelsLeft=Math.max(0,...[...milLeft,...specLeft].map(c=>levelOf(c)-floor));
   const left=milLeft.length+specLeft.length;
   tasks=left?[...(milLeft.length?[make(milLeft[0])]:[]),...specLeft.map(make)]:[make(bySlot(11))];
   // Season guns must be earned first, so one not started yet is never the first suggestion.
   effort=levelsLeft+specLeft.length*12+6+(weapon.season&&!camos.some(c=>done(weapon.name,c.slot))?1000:0);
   headline=left?`${plural(left+1,'camo')} from Gold`+(levelsLeft?` · at most ${plural(levelsLeft,'weapon level')} to go`:''):'Gold is ready to earn';
  }else if(!done(weapon.name,12)){
   if(klass.done<klass.total)return null;// the rest of the class comes first
   phase='platinum';tasks=[make(bySlot(12))];effort=24;headline=klass.total>1?`Every ${weapon.class.toLowerCase().replace(/s$/,'')} is Gold, so Platinum is open`:'Platinum is open';
  }else if(!done(weapon.name,13)){
   if(!platinumAll)return null;
   phase='harmonic';tasks=[make(bySlot(13))];effort=36;headline='Every weapon is Platinum, so Harmonic Break is open';
  }else return null;
  const group=bestGroup(tasks.filter(t=>t.tag!=='level'&&t.opensAt==null));
  if(group.length>1)for(const t of group)t.together=true;
  return {weapon,phase,tasks,effort,levelsLeft,floor,headline,classGold:klass,insights:insights(weapon,tasks,matches,mode)};
 }
 /* Weapons ranked by how little is left. bandOf (the "Before you Prestige" focus) ranks weapons that stay locked
    longest first, then by how little is left. */
 function plan({catalog,done,mode='Multiplayer',matches=[],bandOf=null}){
  const byWeapon=new Map();for(const c of catalog.challenges)(byWeapon.get(c.weapon)||byWeapon.set(c.weapon,[]).get(c.weapon)).push(c);
  const classGold=new Map();
  // Platinum and Harmonic Break are reported as gated on the launch weapons, so season guns do not hold them back.
  const launch=catalog.weapons.filter(w=>!w.season);
  for(const w of catalog.weapons){if(!classGold.has(w.class))classGold.set(w.class,{done:0,total:0});}
  for(const w of launch){const k=classGold.get(w.class);k.total++;if(done(w.name,11))k.done++;}
  const platinumAll=launch.every(w=>done(w.name,12));
  const ctx={byWeapon,done,mode,matches,classGold,platinumAll};
  const picks=catalog.weapons.map(w=>planWeapon(w,ctx)).filter(Boolean);
  const left=p=>p.classGold.total-p.classGold.done;
  picks.sort((a,b)=>(bandOf?bandOf(a.weapon)-bandOf(b.weapon):0)||a.effort-b.effort||left(a)-left(b)||(a.weapon.unlockLevel||0)-(b.weapon.unlockLevel||0)||a.weapon.name.localeCompare(b.weapon.name));
  const overall=mode==='DMZ'?null:bestMode(matches);
  return {picks,overall:overall&&`Your best mode for kills is ${overall.name}: ${overall.avg.toFixed(1)} per match over ${overall.n} matches.`,recorded:catalog.weapons.some(w=>Array.from({length:14},(_,s)=>done(w.name,s)).some(Boolean)),finished:!picks.length};
 }
 const api={plan,classify,matchKills,compatible,bestGroup,TIP};
 if(typeof module==='object'&&module.exports)module.exports=api;else root.CamoPlanner=api;
})(typeof window==='object'?window:globalThis);
