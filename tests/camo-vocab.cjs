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
