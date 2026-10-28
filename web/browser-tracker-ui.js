/* Presentation/storage integration for the optional browser capture engine. */
(()=>{
 'use strict';
 if(companion)return;
 let current={phase:'stopped',message:'Choose Start tracking to share your game window.',running:false,checks:0,reads:0,lastReadMs:0},recent=[];
 function applyReward(reward){
  const camo=findCamo(reward.id);if(!camo)return;
  const receipt='browser-reward:'+reward.id;
  if(state.autoApplied?.[receipt]==='unlocked')return;
  if(commit(()=>{
   setCamoUnlocked(camo,true);
   if(reward.military){state.categoryTotals??={};const key=canonical(camo.weapon)+'|MILITARY';state.categoryTotals[key]={current:Math.max(state.categoryTotals[key]?.current||0,camo.slot+1),target:8,observedAt:new Date().toISOString()};}
   for(const goal of state.goals){if(canonical(goal.weapon)===canonical(camo.weapon)&&(goal.camoId===camo.id||(reward.military&&goal.slot>=0&&goal.slot<=camo.slot)))goal.current=goal.target;}
   state.autoApplied??={};state.autoApplied[receipt]='unlocked';
  })){
   recent.unshift({weapon:reward.weapon,name:reward.name,time:new Date().toLocaleTimeString()});recent=recent.slice(0,8);
   toast(reward.weapon+' — '+reward.name+' saved.');renderRecent();
  }
 }
 function renderRecent(){const list=$('#browser-recent');if(list)list.innerHTML=recent.length?recent.map(r=>'<li><b>'+esc(r.weapon)+' — '+esc(r.name)+'</b><small>'+esc(r.time)+'</small></li>').join(''):'<li>No new camo rewards recognised this session.</li>';}
 function update(status){
  current=status;
  const strip=$('#watcher-status');strip.hidden=false;strip.dataset.state=status.phase==='error'?'error':status.running?'running':'stopped';
  strip.innerHTML='<strong>'+esc(status.running?'Browser tracker running':status.phase==='error'?'Browser tracker needs attention':'Browser tracker stopped')+'</strong><span>'+esc(status.message)+'</span>';
  $('#connection-dot').style.background=status.running?'var(--lime)':'var(--muted)';
  const text=$('#browser-status');if(text)text.textContent=status.message;
  const start=$('#browser-start'),stop=$('#browser-stop');if(start)start.disabled=status.running;if(stop)stop.disabled=!status.running;
  const stats=$('#browser-stats');if(stats)stats.textContent=status.checks+' small checks · '+status.reads+' OCR reads · OCR '+(status.ocrLoaded?'loaded':'asleep')+(status.lastReadMs?' · last read '+(status.lastReadMs/1000).toFixed(1)+'s':'');
 }
 const tracker=BrowserCamoCapture.create({catalog,onReward:applyReward,onStatus:update});
 function panel(){
  info('Automatic tracker',`<div class="browser-tracker"><p class="eyebrow">BROWSER ONLY · AFTER-MATCH REWARDS</p><p>Share the <b>Call of Duty game window</b> once for this session. Play normally, then leave the weapon reward cards visible after the match.</p><div class="browser-status-box"><strong>Tracker status</strong><p id="browser-status" role="status"></p></div><div class="browser-tracker-actions"><button id="browser-start" class="primary">Start tracking</button><button id="browser-stop">Stop tracking</button></div><p class="browser-resource-note">Low impact: requests 1 frame per second and checks a small banner area every 2 seconds. One local OCR worker reads only results text regions. No audio, uploads or saved screenshots.</p><small id="browser-stats"></small><details class="browser-help"><summary>What it can detect & how to test</summary><p>Recognises Military camo rewards and named camo rewards that match the selected weapon in the catalogue. Military rewards mark earlier Military camos too. Attachment rewards, XP and level/unlock totals are ignored.</p><p>Start tracking before a match. Select the game window rather than this tracker tab. Keep this tab open; leave the game's results screen visible long enough for two checks. Borderless/windowed mode can help if the shared image is blank. Browser background throttling and fast reward animations can cause missed cards.</p><p>This tracks new rewards shown while sharing. Existing unlocks and missed rewards can still be marked manually. Screen sharing and OCR use some resources; Stop tracking releases the stream and OCR worker.</p><p>Recognition files download on first start and are cached. Frames are processed on your device. Your browser asks for sharing permission each session.</p></details><h3>Rewards saved this session</h3><ul id="browser-recent" class="browser-recent"></ul></div>`);
  $('#browser-start').onclick=()=>tracker.start();$('#browser-stop').onclick=()=>tracker.stop();renderRecent();update(current);
 }
 $('#automation').onclick=panel;
 window.addEventListener('pagehide',()=>tracker.stop());
})();
