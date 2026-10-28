const assert=require('node:assert/strict');
const {parse}=require('../web/reward-parser.js');
const catalog=require('../web/catalog.json');
const read=(changes={})=>parse({header:'TOP PERFORMING WEAPONS',weapon:'PILA',reward:'MILITARY CAMO 6\nCAMO',confidence:90,...changes},catalog);
assert.equal(read().slot,5);
assert.equal(read({reward:'MILITARY CAMO 6'}).slot,5,'Explicit Military reward name identifies a camo');
for(const changes of [{header:'Kill confirmed'}, {weapon:'PILA\nODEN'}, {weapon:'PILA X'}, {reward:'MILITARY CAMO 9\nCAMO'}, {confidence:69}, {weapon:'ODEN',reward:'SCHLAGER VISIV-5\nLASER'}, {reward:'UNLOCKS 39/64'}, {reward:'LEVEL 30/46'}])assert.equal(read(changes),null,JSON.stringify(changes));
const special=catalog.challenges.find(c=>c.weapon==='Axion'&&c.slot===8);
assert.equal(read({weapon:'AXI0N',reward:special.name+'\nCAMO'}).id,special.id);
assert.equal(read({weapon:'PILA',reward:special.name+'\nCAMO'}),null);
console.log('PASS: Military reward, exact weapon/name matching, attachments and level totals rejected, ambiguity and confidence gates.');
const {parseOverview}=require('../web/reward-parser.js');
const overview=(changes={})=>parseOverview({header:'CAMO SELECT\nHAN 86 PROGRESSION',confidence:90,categories:[{text:'MILITARY [8/8]',confidence:90},{text:'SPECIAL [Ø/3]',confidence:90},{text:'COMPLETIONIST [1/4]',confidence:90}],...changes},catalog);
assert.equal(overview().weapon,'Han 86');assert.equal(overview().entries.length,3);assert.equal(overview().entries[1].current,0);
for(const changes of [{header:'AFTER ACTION\nHAN 86 PROGRESSION'}, {header:'CAMO SELECT\nUNKNOWN PROGRESSION'}, {header:'CAMO SELECT\nHAN 86 PROGRESSION\nM4 PROGRESSION'},{confidence:59},{categories:[{text:'SPECIAL [4/3]',confidence:90}]}])assert.equal(overview(changes),null);
assert.equal(overview({categories:[{text:'MILITARY [2/8]',confidence:90},{text:'MILITARY [3/8]',confidence:90}]}),null);
console.log('PASS: camo overview gate, unique progression heading, valid category totals, OCR slashed zero, ambiguity rejected.');
const {overviewReadingFromLines}=require('../web/reward-parser.js');
const sparse=overviewReadingFromLines([{text:'CAMO SELECT',confidence:94},{text:'HAN 86 PROGRESSION',confidence:93},{text:'MILITARY',confidence:95},{text:'[8/8]',confidence:91},{text:'SPECIAL [3/3] _',confidence:85}]);
assert.equal(parseOverview(sparse,catalog).entries.length,2);
assert.equal(parseOverview(overviewReadingFromLines([{text:'KILL CONFIRMED',confidence:99},{text:'MILITARY [8/8]',confidence:99}]),catalog),null);
console.log('PASS: sparse full-frame reading merges labelled counters, ignores decoration, and still requires the camo menu and known weapon.');

const {overviewIssue}=require('../web/reward-parser.js');
const clearOverview={header:'CAMO SELECT\nHAN 86 PROGRESSION',confidence:90,categories:[{text:'MILITARY [8/8]',confidence:90}]};
assert.equal(overviewIssue(clearOverview,catalog),'');
assert.match(overviewIssue({...clearOverview,header:'HAN 86 PROGRESSION'},catalog),/title/);
assert.match(overviewIssue({...clearOverview,header:'CAMO SELECT\nUNKNOWN PROGRESSION'},catalog),/heading/);
assert.match(overviewIssue({...clearOverview,confidence:42},catalog),/42%/);
assert.match(overviewIssue({...clearOverview,categories:[]},catalog),/category total/);
console.log('PASS: rejected overview explains the missing title, weapon heading, confidence or category total.');

assert.equal(overview({header:'CAM0 SELECT\nHAN 86 PR0GRESSI0N'}).weapon,'Han 86');
assert.equal(parseOverview(overviewReadingFromLines([{text:'CAM0 SELECT',confidence:95},{text:'AXI0N PR0GRESSI0N',confidence:92},{text:'MILITARY [8/8]',confidence:90}]),catalog).weapon,'Axion');
console.log('PASS: common zero/letter-O OCR confusion in menu labels preserves exact known-weapon matching.');

// Exact fixed-label corruption observed in the live report. Weapon and totals still need independent validation.
assert.equal(overview({header:'CHALLENGES / CAMO CHALLE\nCAMN SELELT\nHAN 86 PROGRESSION'})?.weapon,'Han 86');
for(const header of ['CAMO SECRET\nHAN 86 PROGRESSION','CAMN SELELT\nUNKNOWN PROGRESSION','CAMN SELELT\nHAN 86 PROGRESSION\nM4 PROGRESSION'])assert.equal(overview({header}),null);
assert.equal(overview({header:'CAMN SELELT\nHAN 86 PROGRESSION',categories:[]}),null);
console.log('PASS: live-report title corruption is tolerated only with a known unique weapon and valid category totals.');

assert.equal(overview({header:'CAMN SELELT\nHAN 86 PROGRESSION',confidence:59}),null);
assert.equal(parseOverview(overviewReadingFromLines([{text:'CAMN SELELT',confidence:78},{text:'HAN 86 PROGRESSION',confidence:95},{text:'MILITARY [8/8]',confidence:90}]),catalog)?.weapon,'Han 86');
