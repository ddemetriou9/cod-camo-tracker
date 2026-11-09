/* Checks the "Play this next" planner against the real catalogue. */
const assert=require('node:assert/strict'),P=require('../web/planner.js'),catalog=require('../web/catalog.json');
const key=(w,s)=>w+'|'+s;
const doneWith=(...keys)=>{const set=new Set(keys);return (w,s)=>set.has(key(w,s));};
const slots=(w,...list)=>list.map(s=>key(w,s));
const allSlots=(w,to)=>Array.from({length:to},(_,s)=>key(w,s));
const pick=(result,name)=>result.picks.find(p=>p.weapon.name===name);

// Every requirement in the catalogue has a style, in both modes.
for(const c of catalog.challenges)for(const v of c.variants)assert.notEqual(P.classify(v.requirement),'other',`${c.id}: "${v.requirement}" has no style`);
assert.equal(P.classify('3 player eliminations without dying 15 times'),'nodying');
assert.equal(P.classify('15 eliminations in one match'),'matchkills');
assert.equal(P.classify('2 Kills without Reloading 10 times (players)'),'noreload');
assert.equal(P.classify('20 Point Blank Kills (players)'),'pointblank');
assert.equal(P.classify('Weapon level 8'),'level');

assert.equal(P.matchKills('15 eliminations in one match'),15);
assert.equal(P.matchKills('10 player eliminations in a match 5 times'),10);
assert.equal(P.matchKills('20 Point Blank Kills'),null);

// Combining: close and long range clash; levelling goes with everything; destroying vehicles stays apart.
assert.equal(P.compatible('hipfire','pointblank'),true);
assert.equal(P.compatible('longshot','headshot'),true);
assert.equal(P.compatible('longshot','pointblank'),false);
assert.equal(P.compatible('pointblank','longshot'),false);
assert.equal(P.compatible('level','destroy'),true);
assert.equal(P.compatible('destroy','headshot'),false);
assert.deepEqual(P.bestGroup([{tag:'longshot'},{tag:'pointblank'},{tag:'hipfire'}]).map(t=>t.tag),['pointblank','hipfire']);

// Nothing recorded: every weapon is offered, starting from its first Military level and all three Specials.
{
 const r=P.plan({catalog,done:()=>false});
 assert.equal(r.picks.length,catalog.weapons.length);assert.equal(r.recorded,false);assert.equal(r.finished,false);
 const m4=pick(r,'M4');
 assert.equal(m4.phase,'gold');assert.equal(m4.tasks.length,4);assert.equal(m4.tasks[0].name,'Military 1');
 assert.match(m4.headline,/^12 camos from Gold/);
}
// A weapon with only Gold left beats one with lots left, and says so.
{
 const r=P.plan({catalog,done:doneWith(...allSlots('M4',11),'Han 86|0')});
 assert.equal(r.picks[0].weapon.name,'M4');assert.equal(r.recorded,true);
 assert.equal(r.picks[0].headline,'Gold is ready to earn');
 assert.deepEqual(r.picks[0].tasks.map(t=>t.name),['Gold']);
 assert.equal(r.picks[0].levelsLeft,0);
}
// Only the next Military level is listed, levels come from what is proven, and later Specials say when they open.
{
 const m4=pick(P.plan({catalog,done:doneWith(...slots('M4',0,1,2))}),'M4');
 assert.equal(m4.floor,21);
 assert.deepEqual(m4.tasks.filter(t=>t.tier==='Military').map(t=>t.name),['Military 4']);
 const specials=m4.tasks.filter(t=>t.tier==='Special');
 assert.equal(specials.find(t=>t.name==='Myriad').opensAt,26);
 assert.equal(specials.find(t=>t.name==='Myriad').estimated,true);
 assert.equal(m4.levelsLeft,72-21);// Special 3 opens at level 72
}
// A Special opens once the weapon has proven its level, and only open Specials are marked to combine.
{
 const m4=pick(P.plan({catalog,done:doneWith(...allSlots('M4',8))}),'M4');
 assert.equal(m4.tasks.find(t=>t.name==='Myriad').opensAt,null);
 assert.ok(m4.tasks.filter(t=>t.opensAt!=null).every(t=>!t.together));
}
// Platinum waits for the whole class; a class of one opens straight away.
{
 const classmates=catalog.weapons.filter(w=>w.class==='Assault rifles'&&!w.season).map(w=>w.name);
 const one=doneWith(...allSlots(classmates[0],12));
 assert.equal(pick(P.plan({catalog,done:one}),classmates[0]),undefined);
 const all=doneWith(...classmates.flatMap(w=>allSlots(w,12)));
 const open=pick(P.plan({catalog,done:all}),classmates[0]);
 assert.equal(open.phase,'platinum');assert.equal(open.tasks[0].name,'Platinum');
 assert.match(open.headline,/Every assault rifle is Gold/);
 const knife=catalog.weapons.find(w=>w.class==='Melee').name;
 const melee=pick(P.plan({catalog,done:doneWith(...allSlots(knife,12))}),knife);
 assert.equal(melee.phase,'platinum');
 assert.equal(melee.headline,'Platinum is open');
}
// Harmonic Break waits for Platinum everywhere; everything done leaves nothing to suggest.
{
 const every=n=>catalog.weapons.flatMap(w=>allSlots(w.name,n));
 const r=P.plan({catalog,done:doneWith(...every(13))});
 assert.equal(r.picks.length,catalog.weapons.length);assert.ok(r.picks.every(p=>p.phase==='harmonic'));
 const missing=P.plan({catalog,done:doneWith(...every(13).filter(k=>k!=='M4|12'))});
 assert.deepEqual(missing.picks.map(p=>p.weapon.name),['M4']);assert.equal(missing.picks[0].phase,'platinum');
 const finished=P.plan({catalog,done:doneWith(...every(14))});
 assert.equal(finished.finished,true);assert.equal(finished.picks.length,0);
}
// The mode chooses which requirement is shown.
{
 const dmz=pick(P.plan({catalog,done:()=>false,mode:'DMZ'}),'M4');
 assert.match(dmz.tasks.find(t=>t.name==='Myriad').requirement,/DMZ/);
}
// Before you Prestige: weapons in an earlier band come first even if they have more left.
{
 const late=[...catalog.weapons].sort((a,b)=>(b.unlockLevel||0)-(a.unlockLevel||0))[0].name;
 const bandOf=w=>w.name===late?0:1;
 const r=P.plan({catalog,done:doneWith(...allSlots('M4',11)),bandOf});
 assert.equal(r.picks[0].weapon.name,late);
}
// Match stats only speak with enough evidence, and never for DMZ.
{
 const m=(kills,mode,weapon='M4')=>({kills,mode,weapon});
 const goldReady=doneWith(...allSlots('M4',11));
 const few=pick(P.plan({catalog,done:goldReady,matches:[m(20,'Domination'),m(9,'Hardpoint')]}),'M4');
 assert.deepEqual(few.insights,[]);
 const matches=[m(20,'Domination'),m(9,'Hardpoint'),m(16,'Domination'),m(8,'Hardpoint')];
 const some=pick(P.plan({catalog,done:goldReady,matches}),'M4');
 assert.ok(some.insights.includes('You got 15+ kills in 2 of your last 4 recorded matches.'),some.insights.join(' | '));
 assert.ok(some.insights.includes('Your best mode for kills with this weapon is Domination: 18.0 per match over 2 matches.'),some.insights.join(' | '));
 assert.deepEqual(pick(P.plan({catalog,done:goldReady,matches,mode:'DMZ'}),'M4').insights,[]);
 assert.equal(P.plan({catalog,done:goldReady,matches}).overall,'Your best mode for kills is Domination: 18.0 per match over 2 matches.');
 assert.equal(P.plan({catalog,done:goldReady,matches,mode:'DMZ'}).overall,null);
 assert.equal(P.plan({catalog,done:goldReady,matches:matches.slice(0,3)}).overall,null);// Hardpoint has only one match
}
// Modes come from imported or shared data, so object-internal names must not break grouping.
{
 const m=mode=>({kills:10,mode,weapon:'M4'});
 const matches=[m('__proto__'),m('__proto__'),m('constructor'),m('constructor')];
 const r=P.plan({catalog,done:()=>false,matches});
 assert.match(r.overall,/__proto__|constructor/);
 assert.ok(pick(r,'M4').insights.length>0);
}
// Season guns: never the first suggestion until started, and they do not hold back launch-weapon gates.
{
 const fresh=P.plan({catalog,done:()=>false});
 assert.ok(!fresh.picks.slice(0,33).some(p=>p.weapon.season),'an unstarted season gun was suggested before launch guns');
 const started=pick(P.plan({catalog,done:doneWith('CSG-35|0')}),'CSG-35');
 assert.ok(started.effort<1000);
 assert.equal(P.plan({catalog,done:doneWith('CSG-35|0')}).picks.findIndex(p=>p.weapon.name==='CSG-35')<33,true);
 const ars=catalog.weapons.filter(w=>w.class==='Assault rifles'&&!w.season).map(w=>w.name);
 const r=P.plan({catalog,done:doneWith(...ars.flatMap(w=>allSlots(w,12)))});
 assert.equal(pick(r,ars[0]).phase,'platinum');// the Osprey being unstarted does not block Platinum
 assert.equal(pick(r,'Cronen Osprey').classGold.total,ars.length);
 const launchPlat=catalog.weapons.filter(w=>!w.season).flatMap(w=>allSlots(w.name,13));
 assert.equal(pick(P.plan({catalog,done:doneWith(...launchPlat)}),'M4').phase,'harmonic');// Harmonic needs the launch weapons only
 const osprey=pick(P.plan({catalog,done:doneWith(...allSlots('Cronen Osprey',12),...ars.flatMap(w=>allSlots(w,12)))}),'Cronen Osprey');
 assert.equal(osprey.phase,'platinum');assert.match(osprey.tasks[0].issue,/known issue/);
}
console.log('planner: all cases passed');
