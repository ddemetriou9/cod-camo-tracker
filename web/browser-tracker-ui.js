/* Presentation/storage integration for the optional browser capture engine. */
(()=>{
 'use strict';
 if(companion)return;
 let current={phase:'stopped',message:'Choose Start tracking to share your game window.',running:false,checks:0,reads:0,lastReadMs:0},recent=[],previewAt=0;
 function applyReward(reward){
  const camo=findCamo(reward.id);if(!camo)return 'failed';
  const receipt='browser-reward:'+reward.id;
  if(state.autoApplied?.[receipt]==='unlocked')return 'already-recorded';
  if(commit(()=>{
   setCamoUnlocked(camo,true);
   if(reward.military){state.categoryTotals??={};const key=canonical(camo.weapon)+'|MILITARY';state.categoryTotals[key]={current:Math.max(state.categoryTotals[key]?.current||0,camo.slot+1),target:8,observedAt:new Date().toISOString()};}
   for(const goal of state.goals){if(canonical(goal.weapon)===canonical(camo.weapon)&&(goal.camoId===camo.id||(reward.military&&goal.slot>=0&&goal.slot<=camo.slot)))goal.current=goal.target;}
   state.autoApplied??={};state.autoApplied[receipt]='unlocked';
  })){
   recent.unshift({weapon:reward.weapon,name:reward.name,time:new Date().toLocaleTimeString()});recent=recent.slice(0,8);
   toast(reward.weapon+' — '+reward.name+' saved.');renderRecent();return 'saved';
  }
  return 'failed';
 }
 function renderRecent(){const list=$('#browser-recent');if(list)list.innerHTML=recent.length?recent.map(r=>'<li><b>'+esc(r.weapon)+' — '+esc(r.name)+'</b><small>'+esc(r.time)+'</small></li>').join(''):'<li>No camo updates recognised this session yet.</li>';}
 function update(status){
  current=status;
  const strip=$('#watcher-status');strip.hidden=false;strip.dataset.state=status.phase==='error'?'error':status.running?'running':'stopped';
  strip.innerHTML='<strong>'+esc(status.running?'Browser tracker running':status.phase==='error'?'Browser tracker needs attention':'Browser tracker stopped')+'</strong><span>'+esc(status.message)+'</span>';
  $('#connection-dot').style.background=status.running?'var(--lime)':'var(--muted)';
  const text=$('#browser-status');if(text)text.textContent=status.message;
  const start=$('#browser-start'),stop=$('#browser-stop');if(start)start.disabled=status.running;if(stop)stop.disabled=!status.running;
  const scan=$('#browser-scan');if(scan)scan.disabled=!status.running||['starting','loading','reading'].includes(status.phase);
  const stats=$('#browser-stats');if(stats)stats.textContent=status.checks+' small checks · '+status.reads+' OCR reads · '+(status.running?(status.captureFPS||1)+' FPS':'capture off')+' · OCR '+(status.ocrLoaded?'loaded':'asleep')+(status.lastReadMs?' · last read '+(status.lastReadMs/1000).toFixed(1)+'s':'');
  renderDiagnostics(status);
 }
 function renderDiagnostics(status){
  const details=$('#browser-diagnostics');if(!details||!details.open||!$('#info-dialog').open)return;
  $('#browser-capture-info').textContent='Shared source: '+(status.source||'none')+' · '+(status.width||0)+' × '+(status.height||0)+' · '+(status.frames||0)+' frames delivered · '+(status.confirmed||0)+' confirmations · '+(status.saved||0)+' saved updates · '+(status.layout||'default')+' · build '+(status.build||'not started');
  if($('#browser-freeze-reading')?.getAttribute('aria-pressed')!=='true')$('#browser-last-reading').textContent=status.lastReading||'No OCR reading yet. If OCR reads stays at zero on a camo overview, use Scan visible camo screen now.';
  const canvas=$('#browser-preview');if(!status.running){canvas.getContext('2d').clearRect(0,0,canvas.width,canvas.height);return;}
  if(performance.now()-previewAt>900){previewAt=performance.now();tracker.drawPreview(canvas);}
 }
 function applyOverview(overview){
  const changes=applyAutomaticReadings(overview.entries);if(!changes)return overview.entries.every(r=>automaticReceipt(state.categoryTotals?.[canonical(r.weapon)+'|'+r.category]||{})===automaticReceipt(r))?'already-recorded':'failed';
  recent.unshift({weapon:overview.weapon,name:'Overview — '+overview.entries.map(e=>e.category.toLowerCase()+' '+e.current+'/'+e.target).join(' · '),time:new Date().toLocaleTimeString()});recent=recent.slice(0,8);renderRecent();toast(overview.weapon+' camo overview saved.');return 'saved';
 }
 const tracker=BrowserCamoCapture.create({catalog,onReward:applyReward,onOverview:applyOverview,onStatus:update});
 function panel(){
  info('Automatic tracker',`<div class="browser-tracker"><p class="eyebrow">BROWSER ONLY · CAMO MENUS & REWARDS</p><p>Share the <b>Call of Duty game window</b> once for this session. Open each weapon’s camo overview to catch up, or play normally and leave the after-match reward cards visible.</p><div class="browser-status-box"><strong>Tracker status</strong><p id="browser-status" role="status"></p></div><div class="browser-tracker-actions"><button id="browser-start" class="primary">Start tracking</button><button id="browser-stop">Stop tracking</button><button id="browser-scan">Scan visible camo screen now</button></div><p class="browser-resource-note">Low impact during play: requests 1 FPS with small checks each second. Results temporarily use up to 4 FPS to catch cycling cards, then return to 1 FPS. One local OCR worker reads cropped text. No audio, uploads or saved screenshots.</p><div class="browser-sync-note"><b>Catch up your existing camos</b><p>Open a weapon’s <b>Camo Select / Progression</b> screen in the game and keep it visible for about 5–10 seconds. The tracker saves its visible totals automatically. Repeat for each weapon.</p></div><small id="browser-stats"></small><details class="browser-help"><summary>What it can detect & how to test</summary><p>Recognises Military camo rewards and named camo rewards that match the selected weapon in the catalogue. Military rewards mark earlier Military camos too. Attachment rewards, XP and level/unlock totals are ignored.</p><p>Start tracking before a match. Select the game window rather than this tracker tab. Keep this tab open; leave the game's results screen visible long enough for two checks. Borderless/windowed mode can help if the shared image is blank. Browser background throttling and fast reward animations can cause missed cards.</p><p>Camo overviews also record existing Military progress and completed Special/Prestige groups. Partial Special/Prestige totals and completionist totals are displayed without guessing individual unlocks. Those squares can be marked manually. Screen sharing and OCR use some resources; Stop tracking releases the stream and OCR worker.</p><p>Recognition files download on first start and are cached. Frames are processed on your device. Your browser asks for sharing permission each session.</p></details><details id="browser-diagnostics" class="browser-help"><summary>Capture preview & last reading</summary><p>Check that this shows the game, rather than your desktop or a black image. The preview stays on this device and runs only while this section is open.</p><p id="browser-capture-info"></p><canvas id="browser-preview" width="480" height="270" aria-label="Local preview of the shared game window"></canvas><h4>Last recognised text</h4><button id="browser-freeze-reading" aria-pressed="false">Pause text</button><pre id="browser-last-reading"></pre><p>If the automatic detector stays idle, open the weapon’s camo overview in the game and use <b>Scan visible camo screen now</b>. This runs a few one-off scans that do not depend on the normal crop positions.</p></details><h3>Updates saved this session</h3><ul id="browser-recent" class="browser-recent"></ul></div>`);
  $('#browser-freeze-reading').onclick=event=>{const button=event.currentTarget,frozen=button.getAttribute('aria-pressed')!=='true';button.setAttribute('aria-pressed',String(frozen));button.textContent=frozen?'Resume text':'Pause text';if(!frozen)renderDiagnostics(current);};
  $('#browser-start').onclick=()=>tracker.start();$('#browser-scan').onclick=()=>tracker.checkNow();$('#browser-diagnostics').ontoggle=()=>{previewAt=0;renderDiagnostics(current);};$('#browser-stop').onclick=()=>tracker.stop();renderRecent();update(current);
 }
 $('#automation').onclick=panel;
 window.addEventListener('pagehide',()=>tracker.stop());
})();
