/* Closed-vocabulary decoding: OCR noise seen live or typical of game fonts must decode; unrelated text must not. */
const assert=require('node:assert/strict'),V=require('../web/camo-vocab.js'),catalog=require('../web/catalog.json');
const lines=(...texts)=>texts.map(text=>({text,confidence:80}));

// Anchors: the live "CAMN SELELT" corruption is a menu; the breadcrumb and gameplay text are not.
assert.equal(V.anchorIn(lines('CHALLENGES / CAMO CHALLE','CAMN SELELT'))?.screen,'menu');
assert.equal(V.anchorIn(lines('TOP PERFORMING WEAPON SS§'))?.screen,'results');
assert.equal(V.anchorIn(lines('CHALLENGES / CAMO CHALLE')),null);
assert.equal(V.anchorIn(lines('BEST PLAY','REPLAY','REPORT PLAYER','ONLINE (002,')),null);

// Weapon headings: truncation, stray symbols and look-alike digits.
const weapon=(...t)=>V.menuWeapon(lines(...t),catalog)?.weapon.name??null;
assert.equal(weapon('KASTOV 762 PROGRESS'),'Kastov 762');
assert.equal(weapon('HAN B6 PR0GRESSI0N'),'Han 86');
assert.equal(weapon('+ REZI 12'),'Rezi 12');
assert.equal(weapon('PPSH-41 PROGRESSION'),'PPSh-41');
assert.equal(weapon('M4 PROGRESSION'),'M4');
assert.equal(weapon('PILATES'),null,'Short names need a word boundary');
assert.equal(weapon('KASTOV 762 PROGRESSION','HAN 86 PROGRESSION'),null,'Two headings are ambiguous');
assert.equal(weapon('aitecmmenammaaaaaaaiiiiiies:'),null);

// Category totals.
// Totals without the zeroAlt flag (checked separately below).
const total=(text,category)=>{const r=V.counter(text,category);return r&&{current:r.current,target:r.target};};
assert.deepEqual(total('3/8','MILITARY'),{current:3,target:8});
assert.deepEqual(total('318','MILITARY'),{current:3,target:8});
assert.deepEqual(total('O/3','SPECIAL'),{current:0,target:3});
assert.deepEqual(total('(2/4)','PRESTIGE'),{current:2,target:4});
assert.equal(total('9/8','MILITARY'),null);
assert.equal(total('3/7','MILITARY'),null);
assert.equal(total('LVL 45','MILITARY'),null);
const menu=V.decodeMenu(lines('CAMO SELECT','HAN 86 PROGRESSION','MILITARY 8/8','SPECIAL 3/3','COMPLETIONIST O/4','PRESTIGE','0/4','WEAPON LEVEL 45','12,500 XP'),catalog);
assert.equal(menu.weapon,'Han 86');
assert.deepEqual(menu.categories.map(c=>c.category+' '+c.current+'/'+c.target),['MILITARY 8/8','SPECIAL 3/3','COMPLETIONIST 0/4','PRESTIGE 0/4']);
assert.deepEqual(V.decodeMenu(lines('MILITARY 3/8','MILITARY 5/8'),catalog).categories,[],'Conflicting totals are dropped');

// Reward cards.
const reward=(w,r)=>V.decodeReward(lines(...w),lines(...r),catalog).reward;
assert.deepEqual(reward(['REZI 12'],['MILITARY CAMO 4']),{id:catalog.challenges.find(c=>c.weapon==='Rezi 12'&&c.slot===3).id,weapon:'Rezi 12',name:catalog.challenges.find(c=>c.weapon==='Rezi 12'&&c.slot===3).name,slot:3,military:true});
assert.equal(reward(['HAN 86'],['SM0KE','CAMO'])?.name,'Smoke');
assert.equal(reward(['HAN 86'],['SMOKE','ATTACHMENT']),null,'Camo names need the CAMO type label');
assert.equal(reward(['HAN 86'],['MUZZLE BRAKE','ATTACHMENT','+1,250 XP']),null);
assert.equal(reward(['HAN 86'],['WEAPON LEVEL 45']),null,'Weapon levels never unlock camos');
assert.equal(reward(['TOP PERFORMING WEAPONS'],['MILITARY CAMO 4']),null,'Reward needs a weapon');
// Real Patriot XMR menu: bracketed totals, the slashed zero read as 8, wide letter spacing.
assert.deepEqual(total('MILITARY [8/8]','MILITARY'),{current:8,target:8});
assert.deepEqual(total('SPECIAL [2/3]','SPECIAL'),{current:2,target:3});
assert.deepEqual(total('COMPLETIONIST [0/4]','COMPLETIONIST'),{current:0,target:4});
assert.deepEqual(total('PRESTIGE [8/4]','PRESTIGE'),{current:0,target:4},'Slashed zero read as 8 can only be 0 for a /4 group');
assert.deepEqual(total('MILITARY 18/81','MILITARY'),{current:8,target:8},'Brackets read as 1');
assert.equal(V.counter('MILITARY [9/8]','MILITARY'),null);
assert.equal(V.categoryIn('M I L I T A R Y [3/8]')?.category,'MILITARY');
assert.equal(V.categoryIn('MODE MASTERY'),null);
const patriot=V.decodeMenu(lines('PATRIOT XMR PROGRESSION','MODE MASTERY','55','MILITARY [8/8]','SPECIAL [2/3]','COMPLETIONIST [0/4]','PRESTIGE [8/4]','SPECIAL'),catalog);
assert.equal(patriot.weapon,'Patriot XMR');
assert.deepEqual(patriot.categories.map(c=>c.category+' '+c.current+'/'+c.target),['MILITARY 8/8','SPECIAL 2/3','COMPLETIONIST 0/4','PRESTIGE 0/4']);
// Real Warlord after-match cards: the camo card unlocks, attachment cards never do.
assert.equal(reward(['WARLORD','SHOTGUN'],['MILITARY CAMO 7','CAMO'])?.slot,6);
assert.equal(reward(['WARLORD','SHOTGUN'],['SIMPAN-7 GRIP','REAR GRIP']),null);
assert.equal(reward(['WARLORD','SHOTGUN'],['| SZ PRIMA-4 DOT J','OPTIC','| HEGRE']),null);
assert.equal(V.anchorIn(lines('TOP PERFORMING WEAPON'))?.screen,'results');
// Side-by-side cards: an attachment next to a camo, and two Military cards (highest wins).
assert.equal(reward(['SANG 9MM','PISTOL'],['SZ ECHELON HOLO','OPTIC','MILITARY CAMO 3','CAMO'])?.slot,2);
assert.equal(reward(['SANG 9MM'],['MILITARY CAMO 3','CAMO','MILITARY CAMO 4','CAMO'])?.slot,3);
// Real SANG 9mm reads: a label split over two boxes with a stray border character.
assert.equal(reward(['SANG 9MM'],['ill','PMILITARY CA','AMO 4','Qe, 4'])?.slot,3);
assert.equal(weapon('XPILA'),null,'Short names still need a word boundary');
// Real false unlock from the FiNN LMG recording: a half-visible label must not become a camo number.
assert.equal(reward(['FINN LMG'],['MILITARY CAMG']),null,'G must not be read as 6');
assert.equal(reward(['FINN LMG'],['MILITARY CAMO6']),null,'The number must be a separate token');
assert.equal(reward(['FINN LMG'],['J MILITARY CAMO 2 |'])?.slot,1);
assert.equal(reward(['FINN LMG'],['MILITARY CAMO 9']),null);
console.log('camo-vocab: all checks passed');

// The slashed zero read as 6: impossible totals become 0; a possible one is flagged for the padlocks to decide.
assert.deepEqual(total('PRESTIGE [6/4]','PRESTIGE'),{current:0,target:4});
assert.deepEqual(total('COMPLETIONIST (6/4)','COMPLETIONIST'),{current:0,target:4});
assert.equal(V.counter('MILITARY [6/8]','MILITARY').zeroAlt,true);
assert.equal(V.counter('MILITARY [3/8]','MILITARY').zeroAlt,undefined);
// Real .50 GS menu read (live report): the slashed zero read as 8 in the tab and in the totals.
{const m=V.decodeMenu(lines('Wwriiviw','o_o!','Zs 8','-58 GS PROGRESSION','MODE MASTERY','MILITARY [8/8]','SPECIAL [1/3]','COMPLETIONIST [0/4]','PRESTIGE [8/4]'),catalog);
 assert.equal(m.weapon,'.50 GS');assert.deepEqual(m.categories.map(c=>c.category+' '+c.current+'/'+c.target),['MILITARY 8/8','SPECIAL 1/3','COMPLETIONIST 0/4','PRESTIGE 0/4']);}
// Real .50 GS tab: the slashed zero read as 8.
assert.equal(V.menuTab(lines('.58 GS PROGRESSION','MODE MASTERY'),catalog)?.weapon,'.50 GS');
// Real clipped tab from the knife menu.
assert.equal(V.menuTab(lines('‘ARBON EDGE 1895 PROGRESSION'),catalog)?.weapon,'FSS Carbon Edge 1095');
// Real clipped tab from the knife menu.
assert.equal(V.menuTab(lines('‘ARBON EDGE 1895 PROGRESSION'),catalog)?.weapon,'FSS Carbon Edge 1095');

// ---- Sweep over every weapon, so a fix for one gun is checked against all of them. ----
const lookalike=s=>s.replace(/0/g,'O').replace(/1/g,'I');           // digits read as letters
const digitlike=s=>s.replace(/O/g,'0').replace(/B/g,'8');            // letters read as digits
const failures=[];
for(const w of catalog.weapons){
 const name=w.name.toUpperCase(),variants=[name,name.replace(/^\./,''),lookalike(name),digitlike(name),...(name.length>=6?['‘'+name.slice(1)]:[]),...(name.length>=9?[name.slice(2)]:[])];
 for(const v of variants){
  const got=V.menuWeapon(lines(v+' PROGRESSION','MODE MASTERY'),catalog)?.weapon.name;
  if(got!==w.name)failures.push(`menu heading "${v} PROGRESSION" → ${got}`);
  if(V.menuTab(lines('CHALLENGES / CAMO CHALLENGES /',v+' PROGRESSION'),catalog)?.weapon!==w.name)failures.push(`menu tab "${v} PROGRESSION"`);
 }
 // Every possible total, in the game's bracket format and with the slashed zero read as 8.
 for(const [cat,target] of [['MILITARY',8],['SPECIAL',3],['COMPLETIONIST',4],['PRESTIGE',4]])for(let n=0;n<=target;n++){
  for(const shown of [`${cat} [${n}/${target}]`,...(n===0&&target<8?[`${cat} [8/${target}]`]:[])]){
   const m=V.decodeMenu(lines(name+' PROGRESSION',shown),catalog);
   if(m.weapon!==w.name||m.categories[0]?.current!==n||m.categories[0]?.target!==target)failures.push(`${w.name}: "${shown}" → ${m.weapon} ${m.categories.map(c=>c.current+'/'+c.target)}`);
  }
 }
 // After-match cards: each Military number, and each named camo with its type line.
 for(let n=1;n<=8;n++){const r=V.decodeReward(lines(name),lines(`MILITARY CAMO ${n}`,'CAMO'),catalog).reward;if(r?.slot!==n-1||r?.weapon!==w.name)failures.push(`${w.name}: MILITARY CAMO ${n} → ${r?.weapon} ${r?.slot}`);}
 for(const c of catalog.challenges.filter(c=>c.weapon===w.name&&c.slot>=8)){const r=V.decodeReward(lines(name),lines(c.name.toUpperCase(),c.tier.toUpperCase()),catalog).reward;if(r?.id!==c.id)failures.push(`${w.name}: card "${c.name}" → ${r?.name}`);}
 // Things that must never unlock anything on any weapon.
 for(const junk of [['WEAPON LEVEL 45'],['MILITARY CAMG'],['MILITARY CAMO'],['+1,250 XP','ATTACHMENT']])if(V.decodeReward(lines(name),lines(...junk),catalog).reward)failures.push(`${w.name}: "${junk.join(' / ')}" unlocked something`);
}
if(failures.length){console.log(failures.length+' sweep failures:\n'+failures.slice(0,60).join('\n'));process.exitCode=1;}
else console.log('camo-vocab: sweep over all '+catalog.weapons.length+' weapons passed');

// Combat Record: not tied to one layout, and a number that disagrees with the printed K/D is refused.
{
 const L=(text,frame)=>({text,frame,confidence:90}),h=20;
 const grid=(place)=>[['KILLS','12,480'],['DEATHS','9,600'],['K/D RATIO','1.30'],['WINS','900'],['LOSSES','450'],['W/L RATIO','2.00'],['TIME PLAYED','12D 6H 30M'],['BEST STREAK','17'],['SCORE PER MINUTE','412']].flatMap(([label,value],i)=>{const x=100+(i%3)*400,y=200+Math.floor(i/3)*160;return [L(label,[x,y,x+150,y+h]),L(value,place(x,y))];});
 const want={kills:12480,deaths:9600,wins:900,losses:450,bestStreak:17,spm:412,hours:294.5};
 assert.deepEqual(V.decodeRecord(grid((x,y)=>[x+20,y-50,x+120,y-10])).record,want,'numbers above labels');
 assert.deepEqual(V.decodeRecord(grid((x,y)=>[x+20,y+30,x+120,y+70])).record,want,'numbers below labels');
 assert.deepEqual(V.decodeRecord(grid((x,y)=>[x+170,y,x+300,y+h])).record,want,'numbers beside labels');
 assert.deepEqual(V.decodeRecord([L('Kills 12,480',[0,0,200,20]),L('Deaths 9,600',[0,40,200,60]),L('K/D Ratio 1.30',[0,80,200,100])]).record,{kills:12480,deaths:9600,wins:null,losses:null,bestStreak:null,spm:null,hours:null},'label and number in one box');
 // A slashed zero read as 8 in a leading digit no longer divides to the printed K/D, so nothing is saved.
 assert.equal(V.decodeRecord([L('KILLS',[100,100,200,120]),L('12,880',[100,60,200,90]),L('DEATHS',[400,100,500,120]),L('9,600',[400,60,500,90]),L('K/D RATIO',[700,100,800,120]),L('1.30',[700,60,800,90])]).record,null);
 assert.equal(V.decodeRecord([L('SOMETHING ELSE',[0,0,100,20])]).record,null);
 assert.equal(V.anchorIn([L('COMBAT RECORD',[88,52,424,86])]).screen,'record');
 console.log('camo-vocab: Combat Record cases passed');
}

// After Action Report: the two real readings (end-of-match clips), including OCR noise around the result and mode.
{
 const L=(text,frame,confidence=90)=>({text,frame,confidence});
 const stats=[L('4128',[213,540,283,569]),L('SCORE',[220,590,273,608]),L('KILLS',[434,591,479,608]),L('ASSISTS',[632,590,698,608]),L('DEATHS',[843,591,906,608])];
 const win=[L('6 victory',[64,186,400,274],35),L('] TEAM DEATHMATCH |',[174,293,361,309],72),L('SHIPMENT',[380,293,469,309],96),L('so 139',[119,337,363,386],44),...stats];
 assert.equal(V.anchorIn([L('AFTER ACTION REPORT',[88,52,424,86])]).screen,'aar');
 assert.deepEqual(Object.keys(V.statLabels(win)),['SCORE','KILLS','ASSISTS','DEATHS']);
 assert.deepEqual(V.decodeAar(win,{SCORE:'4120',KILLS:'26',ASSISTS:'12',DEATHS:'21'},[L('; TOP. PERFORMER',[1169,330,1293,347],45),L('FINN LMG',[1253,374,1313,388])],catalog).match,
  {result:'Victory',mode:'Team Deathmatch',map:'Shipment',score:4120,kills:26,assists:12,deaths:21,weapon:'FiNN LMG'});
 const loss=V.decodeAar([L('© DEFEAT',[65,189,366,274],56),L('] TEAM DEATHMATCH |',[174,293,361,309],75),L('SHIPMENT',[380,293,469,309],96)],{SCORE:'3260',KILLS:'21',ASSISTS:'9',DEATHS:'21'},[L('SANG 9MM',[1253,374,1322,388],79)],catalog).match;
 assert.equal(loss.result,'Defeat');assert.equal(loss.weapon,'SANG 9mm');assert.equal(loss.assists,9);
 // A missing number, or no result heading, records nothing.
 assert.equal(V.decodeAar(win,{SCORE:'4120',KILLS:'',ASSISTS:'12',DEATHS:'21'},[],catalog).match,null);
 assert.equal(V.decodeAar(win.slice(1),{SCORE:'4120',KILLS:'26',ASSISTS:'12',DEATHS:'21'},[],catalog).match,null);
 console.log('camo-vocab: After Action Report cases passed');
}
