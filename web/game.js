'use strict';
// ── State ──────────────────────────────────────────────────────────────
const G = {
  playerName:'', devMode:false, ttsEnabled:true, gameRunning:false,
  players:{}, myName:'', myRole:'', rolesMap:{}, humanMode:true,
  currentPhase:'', humanTimerInterval:null, floatTimerInterval:null,
  eventSource:null, stopRequested:false, paused:false,
  // Display queue: messages wait here until TTS finishes previous
  displayQueue:[], displayBusy:false,
  // TTS
  ttsQueue:[], ttsSpeaking:false, voices:[], voiceMap:{},
  currentSpeakBar:null, speakBarInterval:null,
  // STT
  recognition:null, micActive:false,
  // Theme: 'system'|'dark'|'light'
  theme: localStorage.getItem('mafia_theme') || 'system',
};

// ── Theme ───────────────────────────────────────────────────────────────
const THEMES = ['system','dark','light'];
const THEME_ICONS = {system:'#icon-monitor', dark:'#icon-moon', light:'#icon-sun'};
function applyTheme() {
  const sys = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  const actual = G.theme === 'system' ? sys : G.theme;
  document.documentElement.setAttribute('data-theme', actual);
  const el = document.getElementById('themeIcon');
  if (el) el.setAttribute('href', THEME_ICONS[G.theme]);
}
function cycleTheme() {
  G.theme = THEMES[(THEMES.indexOf(G.theme)+1)%THEMES.length];
  localStorage.setItem('mafia_theme', G.theme);
  applyTheme();
}
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);

// ── Voice / TTS ─────────────────────────────────────────────────────────
const FEMALE_NAMES = new Set(['alice','diana','fiona','hannah','emma','sarah','lily','zoe','claire','nina','sophie','rose','eva','mia','anna']);
function isFemale(name) { return FEMALE_NAMES.has((name||'').toLowerCase()); }

function initVoices() {
  const load = () => {
    const all = window.speechSynthesis.getVoices();
    G.voices = all.filter(v => v.lang.startsWith('en'));
    if (!G.voices.length) G.voices = all;
  };
  load();
  window.speechSynthesis.onvoiceschanged = load;
}

function assignVoices(playerList) {
  // separate female/male/neutral pools
  const fem = G.voices.filter(v => /female|woman|girl|zira|samantha|victoria|karen|moira|fiona|veena|tessa/i.test(v.name));
  const mal = G.voices.filter(v => /male|man|guy|david|daniel|alex|tom|fred|jorge|lee/i.test(v.name));
  const neu = G.voices.filter(v => !fem.includes(v) && !mal.includes(v));
  let fi=0, mi=0, ni=0;
  playerList.forEach(p => {
    if (G.voiceMap[p.name] !== undefined) return;
    if (p.name === 'system') { G.voiceMap['system'] = neu.length ? G.voices.indexOf(neu[0]) : 0; return; }
    const pool = isFemale(p.name) ? (fem.length?fem:G.voices) : (mal.length?mal:G.voices);
    const fallPool = neu.length ? neu : G.voices;
    if (isFemale(p.name) && fem.length) { G.voiceMap[p.name] = G.voices.indexOf(fem[fi++ % fem.length]); }
    else if (!isFemale(p.name) && mal.length) { G.voiceMap[p.name] = G.voices.indexOf(mal[mi++ % mal.length]); }
    else { G.voiceMap[p.name] = G.voices.indexOf(fallPool[ni++ % fallPool.length]); }
  });
}

const SILENT_PATTERNS = /remained silent|nothing to say|no response|chose not to speak/i;

function enqueueTTS(name, text, onDone) {
  if (!text || SILENT_PATTERNS.test(text)) { if(onDone) onDone(); return; }
  G.ttsQueue.push({ name, text, onDone });
  if (!G.ttsSpeaking) speakNext();
}

function speakNext() {
  if (G.ttsSpeaking || !G.ttsQueue.length) return;
  const { name, text, onDone } = G.ttsQueue.shift();
  if (!G.ttsEnabled) { if(onDone) onDone(); speakNext(); return; }
  G.ttsSpeaking = true;
  const utt = new SpeechSynthesisUtterance(text);
  utt.rate = 1.05; utt.pitch = 1; utt.volume = 1;
  const speakerName = name;
  const isSystem = speakerName === 'system';
  let isFemale = false;
  if (!isSystem && AVATAR_MAP[speakerName] && AVATAR_MAP[speakerName].includes('female')) {
      isFemale = true;
  }
  let voice = null;
  const voices = window.speechSynthesis.getVoices();
  if (isSystem) {
      voice = voices.find(v => v.name.includes('Google UK English Male')) || voices[0];
  } else if (isFemale) {
      voice = voices.find(v => v.name.includes('Female') || v.name.includes('Samantha') || v.name.includes('Zira') || v.name.includes('Google UK English Female')) || voices[1] || voices[0];
  } else {
      voice = voices.find(v => v.name.includes('Male') || v.name.includes('Alex') || v.name.includes('David') || v.name.includes('Google UK English Male')) || voices[0];
  }
  if(voice) utt.voice=voice;
  utt.onend = utt.onerror = () => {
    G.ttsSpeaking = false;
    stopSpeakBar();
    if (onDone) onDone();
    setTimeout(speakNext, 150);
  };
  window.speechSynthesis.speak(utt);
}

function clearTTS() {
  G.ttsQueue = []; G.ttsSpeaking = false;
  window.speechSynthesis.cancel();
  stopSpeakBar();
}

// ── Speaking progress bar ────────────────────────────────────────────────
function startSpeakBar(barEl, durationSec) {
  stopSpeakBar();
  if (!barEl) return;
  barEl.style.width = '100%';
  let elapsed = 0;
  G.speakBarInterval = setInterval(() => {
    if (G.paused) return;
    elapsed++;
    barEl.style.width = Math.max(0, 100 - (elapsed/durationSec)*100) + '%';
    if (elapsed >= durationSec) stopSpeakBar();
  }, 1000);
}
function stopSpeakBar() {
  if (G.speakBarInterval) { clearInterval(G.speakBarInterval); G.speakBarInterval = null; }
  if (G.currentSpeakBar) { G.currentSpeakBar.style.width='0'; G.currentSpeakBar = null; }
}

// ── Helpers ──────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const now = () => new Date().toLocaleTimeString('en',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
function roleColor(r){return{mafia:'var(--mafia)',detective:'var(--detective)',doctor:'var(--doctor)',villager:'var(--villager)'}[r]||'var(--muted)'}
function roleLabel(r){return{mafia:'MAFIA',detective:'DETECTIVE',doctor:'DOCTOR',villager:'VILLAGER'}[r]||'???'}
function roleLabelHtml(r){
  const lbl = {mafia:'MAFIA',detective:'DETECTIVE',doctor:'DOCTOR',villager:'VILLAGER'}[r];
  if(lbl) return lbl;
  return '<svg style="width:14px;height:14px;display:inline-block;vertical-align:middle;opacity:0.6"><use href="#icon-eye-off"/></svg>';
}
const AVATAR_MAP = {
  'Diya': 'avatar_female_1_diya.png',
  'Dadi': 'avatar_female_2_dadi_ji.png',
  'Sneha': 'avatar_female_3_sneha.png',
  'Neha': 'avatar_female_4_neha.png',
  'Arav': 'avatar_male_1_arav.png',
  'Bhupender': 'avatar_male_2_bhupender.png',
  'Rohan': 'avatar_male_3_rohan.png',
  'Rajesh': 'avatar_male_4_rajesh.png'
};
function playerAvatar(name, isHuman) {
  if (isHuman) return '👤';
  if (name === 'SKIP') return '<svg style="width:40px;height:40px;fill:var(--gold)"><use href="#icon-skip"/></svg>';
  const file = AVATAR_MAP[name] || 'avatar_male_1_arav.png';
  return `<img src="/web/assets/avatars/${file}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;
}
function estimateSpeakDuration(text) { return Math.max(2, Math.ceil(text.split(' ').length / 2.5)); }

// ── Display Queue ────────────────────────────────────────────────────────
// Messages queue here; each is shown+spoken before the next appears
function enqueueDisplay(renderFn) {
  G.displayQueue.push(renderFn);
  if (!G.displayBusy) processDisplayQueue();
}
function processDisplayQueue() {
  if (!G.displayQueue.length) { G.displayBusy = false; checkHumanPanelReady(); return; }
  G.displayBusy = true;
  const fn = G.displayQueue.shift();
  fn(() => {
    // Let the call stack unwind before next item
    setTimeout(processDisplayQueue, 50);
  });
}
function checkHumanPanelReady() {
  if (G._pendingHumanPanel) {
    const p = G._pendingHumanPanel;
    G._pendingHumanPanel = null;
    _showHumanPanelNow(p);
  }
}

// ── Player Cards ────────────────────────────────────────────────────────
function buildPlayerCards() {
  const grid = $('playersGrid'); grid.innerHTML = '';
  Object.values(G.players).forEach(p => {
    const known = G.devMode || p.name === G.myName || (G.myRole === 'mafia' && G.rolesMap[p.name] === 'mafia');
    const role = known ? (G.rolesMap[p.name]||p.role||'villager') : 'unknown';
    const bc = known ? `badge-${role}` : 'badge-unknown';
    const card = document.createElement('div');
    card.className = `player-card${known&&role!=='unknown'?' role-'+role:''} ${p.alive?'':'dead'} ${p.imprisoned?'imprisoned':''} ${p.is_human?'human-card':''}`;
    card.id = `card-${p.name}`;
    if (known) card.style.setProperty('--role-glow', roleColor(role)+'18');
    card.innerHTML = `
      <div class="player-avatar" style="border-color:${known?roleColor(role):'var(--border2)'}">
        ${playerAvatar(p.name, p.is_human)}
      </div>
      <div class="player-name">${p.name}${p.is_human?` <span style="color:var(--gold);font-size:.65rem">YOU</span>`:''}</div>
      <span class="player-role-badge ${bc}">${known?roleLabelHtml(role):roleLabelHtml('unknown')}</span>
      <div class="player-model">${p.model||''}</div>
      <div class="speaking-bar"><div class="speaking-bar-fill" style="width:100%"></div></div>
    `;
    grid.appendChild(card);
  });
}
function updateCard(name) {
  const p = G.players[name]; if(!p) return;
  const card = $(`card-${name}`); if(!card){buildPlayerCards();return;}
  card.classList.toggle('dead',!p.alive);
  card.classList.toggle('imprisoned',!!p.imprisoned);
  const known = G.devMode || p.name === G.myName || (G.myRole === 'mafia' && G.rolesMap[name] === 'mafia');
  const role = known ? (G.rolesMap[p.name]||p.role||'villager') : 'unknown';
  const badge = card.querySelector('.player-role-badge');
  if (badge) { badge.className=`player-role-badge ${known?'badge-'+role:'badge-unknown'}`; badge.innerHTML=known?roleLabelHtml(role):roleLabelHtml('unknown'); }
}
function setSpeaking(name, on) {
  document.querySelectorAll('.player-card').forEach(c=>c.classList.remove('speaking'));
  if(on && name){ const c=$(`card-${name}`); if(c) c.classList.add('speaking'); }
}
function startCardSpeakBar(name, durationSec) {
  const card = $(`card-${name}`); if(!card) return;
  const bar = card.querySelector('.speaking-bar'); const fill = card.querySelector('.speaking-bar-fill');
  if(bar) bar.classList.add('active');
  if(fill){ fill.style.width='100%'; G.currentSpeakBar=fill; startSpeakBar(fill, durationSec); }
}
function stopCardSpeakBar(name) {
  const card = $(`card-${name}`); if(!card) return;
  const bar = card.querySelector('.speaking-bar'); if(bar) bar.classList.remove('active');
}

// ── Feed ─────────────────────────────────────────────────────────────────
function addFeedEntry(html, cls='fe-system', withSpeakBar=false, durationSec=0) {
  const feed = $('eventFeed');
  const div = document.createElement('div');
  div.className=`feed-entry ${cls}`;
  const speakBarHtml = withSpeakBar ? `<div class="feed-speak-bar"><div class="feed-speak-bar-fill" style="width:100%"></div></div>` : '';
  div.innerHTML = html + speakBarHtml + `<div class="fe-time">${now()}</div>`;
  feed.appendChild(div);
  feed.scrollTop = feed.scrollHeight;
  if (withSpeakBar) {
    const fill = div.querySelector('.feed-speak-bar-fill');
    if (fill) { G.currentSpeakBar = fill; startSpeakBar(fill, durationSec); }
  }
  return div;
}

// ── Phase Overlay ─────────────────────────────────────────────────────────
function showPhaseOverlay(phase, round) {
  const ov=$('phaseOverlay'), isNight=phase==='NIGHT';
  const icon=isNight?'🌙':'☀️', col=isNight?'#b8a9f0':'#fbbf24';
  ov.className=`phase-overlay ${isNight?'night-bg':'day-bg'}`;
  $('phaseOverlayIcon').textContent=icon;
  $('phaseOverlayText').textContent=phase; $('phaseOverlayText').style.color=col;
  $('phaseOverlayRound').textContent=`Round ${round}`;
  ov.classList.remove('hidden');
  setTimeout(()=>ov.classList.add('hidden'), 2400);
  $('phaseIcon').textContent=icon;
  $('phaseLabel').textContent=`${phase.charAt(0)+phase.slice(1).toLowerCase()} ${round}`;
  document.body.classList.remove('phase-night','phase-day');
  document.body.classList.add(isNight?'phase-night':'phase-day');
}

// ── KO Overlay ────────────────────────────────────────────────────────────
function showKO(iconHref, name, label, cls) {
  const ov=$('koOverlay');
  $('koIconUse').setAttribute('href', iconHref);
  $('koName').textContent=name.toUpperCase(); $('koLabel').textContent=label;
  ov.className=`ko-overlay ${cls}`;
  if(navigator.vibrate) navigator.vibrate([100,50,200]);
  setTimeout(()=>ov.classList.add('hidden'), 3000);
}

// ── Floating Selection Screen ─────────────────────────────────────────────
function showFloatSelect(title, candidates, onSelect, timeoutSec=45, defaultVal='') {
  const ov=$('floatSelect'), cards=$('floatSelectCards');
  $('floatSelectTitle').textContent=title;
  cards.innerHTML='';
  candidates.forEach(name=>{
    const p=G.players[name]||{name,role:'',alive:true,is_human:false};
    const known=G.devMode||name===G.myName||(G.myRole==='mafia'&&G.rolesMap[name]==='mafia');
    const role=known?(G.rolesMap[name]||p.role||''):'';
    const card=document.createElement('div');
    card.className='float-card';
    if (name === 'SKIP') {
      card.innerHTML=`<div class="float-card-avatar" style="font-size:2rem;color:var(--gold)">${playerAvatar(name, false)}</div>
        <div class="float-card-name" style="color:var(--gold)">SKIP</div>`;
    } else {
      card.innerHTML=`<div class="float-card-avatar">${playerAvatar(name,p.is_human)}</div>
        <div class="float-card-name">${name}</div>`;
    }
    card.onclick=()=>{ clearFloatTimer(); ov.classList.add('hidden'); onSelect(name); };
    cards.appendChild(card);
    // Also make player grid card clickable
    const gc=$(`card-${name}`);
    if(gc){ gc.classList.add('clickable-target'); gc.onclick=()=>{ clearFloatTimer(); ov.classList.add('hidden'); onSelect(name); }; }
  });
  ov.classList.remove('hidden');
  // Timer
  let rem=timeoutSec;
  const fill=$('floatTimerFill'); fill.style.width='100%';
  G.floatTimerInterval=setInterval(()=>{ 
    if(G.paused) return;
    rem--; fill.style.width=`${(rem/timeoutSec)*100}%`; 
    if(rem<=0){ clearFloatTimer(); ov.classList.add('hidden'); onSelect(defaultVal); }
  },1000);
}
function clearFloatTimer(){ if(G.floatTimerInterval){clearInterval(G.floatTimerInterval);G.floatTimerInterval=null;} }
function hideFloatSelect(){
  $('floatSelect').classList.add('hidden'); clearFloatTimer();
  document.querySelectorAll('.player-card.clickable-target').forEach(c=>{c.classList.remove('clickable-target');c.onclick=null;});
}

// ── SSE Event Handlers ────────────────────────────────────────────────────
function handleEvent(ev) {
  switch(ev.type) {
    case 'CONNECTED': $('feedStatus').style.color='var(--green)'; break;

    case 'GAME_START': {
      G.gameRunning=true; G.players={}; G.rolesMap={}; G.myRole='';
      ev.players.forEach(p=>{ 
        G.players[p.name]=p; 
        if(p.name === G.myName) G.myRole = p.role;
      });
      if(!G.humanMode) { G.devMode=true; document.body.classList.add('dev-mode'); $('devToggle').classList.add('active'); $('devBanner').classList.remove('hidden'); $('devToggle').querySelector('use').setAttribute('href','#icon-eye'); }
      assignVoices(ev.players);
      buildPlayerCards();
      addFeedEntry(`<div class="fe-actor">⚔ GAME STARTED</div><div class="fe-msg">Players: ${Object.keys(G.players).join(', ')}</div>`,'fe-system');
      enqueueTTS('system',`Town vs Mafia has begun. ${ev.players.length} players enter the game.`);
      break;
    }

    case 'ROLES_REVEALED': {
      G.rolesMap = ev.roles; 
      if (G.rolesMap[G.myName]) G.myRole = G.rolesMap[G.myName];
      buildPlayerCards();
      const rc=roleColor(G.myRole);
      addFeedEntry(`<div class="fe-actor">🔐 ROLES ASSIGNED</div><div class="fe-msg">Your role: <strong style="color:${rc}">${(G.myRole||'').toUpperCase()}</strong></div>`,'fe-detect');
      if(G.myRole) enqueueTTS('system',`Your secret role is ${G.myRole}.`);
      break;
    }

    case 'PHASE_CHANGE': {
      enqueueDisplay(done => {
        let animDone = false, ttsDone = false;
        const checkDone = () => { if (animDone && ttsDone) done(); };
        setTimeout(() => { animDone = true; checkDone(); }, 2400);

        showPhaseOverlay(ev.phase, ev.round);
        if(ev.players) ev.players.forEach(p=>{G.players[p.name]={...G.players[p.name],...p};});
        buildPlayerCards();
        const isN=ev.phase==='NIGHT';
        addFeedEntry(`<div class="fe-actor">${isN?'🌙 NIGHT':'☀️ DAY'} ${ev.round}</div>`,'fe-phase');
        enqueueTTS('system',`${ev.phase.toLowerCase()} ${ev.round}.`, () => { ttsDone = true; checkDone(); });
      });
      break;
    }

    case 'PLAYER_MESSAGE': {
      const msg = ev.message.replace(/^["']+|["']+$/g,'').trim();
      if(!msg || SILENT_PATTERNS.test(msg)) break;
      const known=G.devMode; const rc=known?roleColor(ev.role):'var(--teal)';
      const cls=G.devMode?`fe-${ev.role==='mafia'?'mafia':ev.role==='detective'?'detect':ev.role==='doctor'?'doctor':'message'}`:'fe-message';
      const dur=estimateSpeakDuration(msg);
      // Queue display+TTS together
      enqueueDisplay(done=>{
        setSpeaking(ev.actor, true);
        startCardSpeakBar(ev.actor, dur);
        const entry=addFeedEntry(`<div class="fe-actor" style="color:${rc}">${ev.actor}</div><div class="fe-msg">${msg}</div>`,cls,!ev.is_human,dur);
        if(!ev.is_human){
          enqueueTTS(ev.actor, `${ev.actor}: ${msg}`, ()=>{ setSpeaking(ev.actor,false); stopCardSpeakBar(ev.actor); done(); });
        } else { setTimeout(()=>{ setSpeaking(ev.actor,false); stopCardSpeakBar(ev.actor); done(); }, Math.max(1500, dur*1000)); }
      });
      break;
    }

    case 'MAFIA_CHAT': {
      if(!G.devMode && G.myRole!=='mafia') break;
      const msg=ev.message.replace(/^["']+|["']+$/g,'').trim();
      const dur=estimateSpeakDuration(msg);
      enqueueDisplay(done=>{
        setSpeaking(ev.actor,true); startCardSpeakBar(ev.actor,dur);
        addFeedEntry(`<div class="fe-actor" style="color:var(--mafia)">🔪 ${ev.actor} [MAFIA CHAT]</div><div class="fe-msg">${msg}</div>`,'fe-mafia-chat',true,dur);
        enqueueTTS(ev.actor,`${ev.actor}: ${msg}`,()=>{ setSpeaking(ev.actor,false); stopCardSpeakBar(ev.actor); done(); });
      });
      break;
    }

    case 'MAFIA_VOTE':
      enqueueDisplay(done => {
        if(G.devMode||G.myRole==='mafia')
          addFeedEntry(`<div class="fe-actor" style="color:var(--mafia)">${ev.actor} <span style="color:var(--muted);margin:0 4px">➔</span> <strong>${ev.target}</strong></div>`,'fe-mafia-chat');
        done();
      });
      break;

    case 'MAFIA_KILL_DECIDED':
      enqueueDisplay(done => {
        if(G.devMode||G.myRole==='mafia')
          addFeedEntry(`<div class="fe-actor" style="color:var(--mafia)">🎯 MAFIA DECIDED</div><div class="fe-msg">Target: ${ev.target}</div>`,'fe-mafia');
        done();
      });
      break;

    case 'PLAYER_KILLED': {
      enqueueDisplay(done => {
        let animDone = false, ttsDone = false;
        const checkDone = () => { if (animDone && ttsDone) done(); };
        setTimeout(() => { animDone = true; checkDone(); }, 3000);

        const p=G.players[ev.target]; if(p){p.alive=false;updateCard(ev.target);}
        showKO('#icon-skull',ev.target,'ELIMINATED','ko-kill');
        addFeedEntry(`<div class="fe-actor" style="color:var(--mafia)">ELIMINATED</div><div class="fe-msg">${ev.target} was found dead${G.devMode&&ev.role?` — was ${ev.role.toUpperCase()}`:''}</div>`,'fe-mafia');
        enqueueTTS('system',`${ev.target} was found dead.`, () => { ttsDone = true; checkDone(); });
      });
      break;
    }

    case 'DOCTOR_SAVE': {
      enqueueDisplay(done => {
        let animDone = false, ttsDone = false;
        const checkDone = () => { if (animDone && ttsDone) done(); };
        setTimeout(() => { animDone = true; checkDone(); }, 3000);

        showKO('#icon-shield',ev.target,'PROTECTED','ko-save');
        addFeedEntry(`<div class="fe-actor" style="color:var(--doctor)">PROTECTED</div><div class="fe-msg">The doctor saved ${ev.target}</div>`,'fe-doctor');
        enqueueTTS('system',`The doctor saved ${ev.target} last night.`, () => { ttsDone = true; checkDone(); });
      });
      break;
    }

    case 'NIGHT_NO_KILL':
      enqueueDisplay(done => {
        addFeedEntry(`<div class="fe-actor">🌙 QUIET NIGHT</div><div class="fe-msg">No one was killed</div>`,'fe-system');
        enqueueTTS('system', 'No one was killed last night.', done);
      });
      break;

    case 'DETECTIVE_INVESTIGATE':
      enqueueDisplay(done => {
        if(G.devMode||ev.actor===G.myName)
          addFeedEntry(`<div class="fe-actor" style="color:var(--detective)">INVESTIGATION</div><div class="fe-msg">${ev.actor} <span style="color:var(--muted);margin:0 4px">➔</span> ${ev.target}: <strong style="color:${roleColor(ev.result)}">${ev.result.toUpperCase()}</strong></div>`,'fe-detect');
        done();
      });
      break;

    case 'DISCUSSION_ROUND':
      enqueueDisplay(done => {
        addFeedEntry(`<div class="fe-actor">💬 DISCUSSION ${ev.round}/${ev.total_rounds}</div>`,'fe-phase');
        done();
      });
      break;

    case 'VOTING_START':
      enqueueDisplay(done => {
        addFeedEntry(`<div class="fe-actor" style="color:#a78bfa">VOTING BEGINS</div><div class="fe-msg">${(ev.players||[]).join(', ')}</div>`,'fe-vote');
        enqueueTTS('system','Voting begins. Who will be arrested?', done);
      });
      break;

    case 'PLAYER_VOTE':
      enqueueDisplay(done => {
        addFeedEntry(`<div class="fe-actor">${ev.actor} <span style="color:var(--muted);margin:0 4px">➔</span> <strong style="color:var(--accent)">${ev.target}</strong></div>`,'fe-vote');
        done();
      });
      break;

    case 'PLAYER_ARRESTED': {
      if (!ev.target) {
        enqueueDisplay(done => {
           addFeedEntry(`<div class="fe-actor" style="color:var(--muted)">ARREST SKIPPED</div><div class="fe-msg">The town voted to skip the arrest.</div>`,'fe-system');
           enqueueTTS('system','The town voted to skip the arrest.', done);
        });
        break;
      }
      enqueueDisplay(done => {
        let animDone = false, ttsDone = false;
        const checkDone = () => { if (animDone && ttsDone) done(); };
        setTimeout(() => { animDone = true; checkDone(); }, 3000);

        const p=G.players[ev.target]; if(p){p.imprisoned=true;updateCard(ev.target);}
        showKO('#icon-gavel',ev.target,'ARRESTED','ko-arrest');
        addFeedEntry(`<div class="fe-actor" style="color:#f97316">ARRESTED</div><div class="fe-msg">${ev.target} has been arrested${G.devMode&&ev.role?` — ${ev.role.toUpperCase()}`:''}${ev.tiebreak?' (tiebreak)':''}</div>`,'fe-arrest');
        enqueueTTS('system',`${ev.target} has been arrested.`, () => { ttsDone = true; checkDone(); });
      });
      break;
    }

    case 'STATUS_UPDATE':
      if(ev.players){ev.players.forEach(p=>{G.players[p.name]={...G.players[p.name],...p};});buildPlayerCards();}
      break;

    case 'GAME_OVER': enqueueDisplay(done => { handleGameOver(ev); done(); }); break;
    case 'GAME_STOPPED':
      addFeedEntry(`<div class="fe-actor">GAME STOPPED</div>`,'fe-system');
      G.gameRunning=false; break;

    case 'HUMAN_PROMPT':
      // Delay human panel until display queue drains
      G._pendingHumanPanel=ev;
      if(!G.displayBusy) checkHumanPanelReady();
      break;

    case 'ERROR':
      addFeedEntry(`<div class="fe-actor" style="color:var(--mafia)">⚠ ERROR</div><div class="fe-msg">${ev.message}</div>`,'fe-system');
      G.gameRunning=false; break;
  }
}

// ── Game Over ──────────────────────────────────────────────────────────────
function handleGameOver(ev) {
  G.gameRunning=false; clearTTS(); hideHumanPanel(); hideFloatSelect();
  if (G.devMode) {
    G.devMode = false;
    document.body.classList.remove('dev-mode');
    const dt = $('devToggle');
    if (dt) {
        dt.classList.remove('active');
        dt.querySelector('use').setAttribute('href','#icon-eye-off');
    }
    const db = $('devBanner');
    if (db) db.classList.add('hidden');
  }
  const title=$('victoryTitle'), icon=$('victoryIconSvg'), msg=$('victoryMsg'), final=$('finalRoles');
  if(ev.winner==='TOWN'){title.textContent='TOWN WINS';title.className='victory-title town-wins';icon.textContent='🏆';}
  else if(ev.winner==='MAFIA'){title.textContent='MAFIA WINS';title.className='victory-title mafia-wins';icon.textContent='🔪';}
  else{title.textContent='GAME OVER';title.className='victory-title';icon.textContent='⏱';}
  msg.textContent=ev.message||'';
  const groups = { mafia: [], town: [], other: [] };
  (ev.players||[]).forEach(p => {
    if (p.role === 'mafia') groups.mafia.push(p);
    else if (['villager', 'doctor', 'detective'].includes(p.role)) groups.town.push(p);
    else groups.other.push(p);
  });
  
  const buildCol = (title, list) => {
    if (!list.length) return '';
    const items = list.map(p => {
      const icon = !p.alive ? '💀' : p.imprisoned ? '⛓' : '✅';
      return `<div class="final-role-chip" style="border-color:${roleColor(p.role)}; color:${roleColor(p.role)}">${icon} ${p.name} — ${(p.role||'').toUpperCase()}</div>`;
    }).join('');
    return `<div style="flex:1;min-width:140px"><div style="font-size:0.8rem;letter-spacing:0.1em;color:var(--muted);margin-bottom:0.5rem">${title}</div>${items}</div>`;
  };
  
  final.innerHTML = `
    <div style="display:flex;gap:1.5rem;justify-content:center;flex-wrap:wrap">
      ${buildCol('MAFIA', groups.mafia)}
      ${buildCol('TOWN', groups.town)}
      ${buildCol('OTHER', groups.other)}
    </div>
  `;
  $('victoryScreen').classList.remove('hidden');
  enqueueTTS('system',ev.winner==='TOWN'?'Town wins. The mafia has been defeated.':ev.winner==='MAFIA'?'Mafia wins. The town has fallen.':'The game is over.');
}

// ── Human Panel ────────────────────────────────────────────────────────────
function _showHumanPanelNow(prompt) {
  const panel=$('humanPanel'), label=$('humanPromptLabel'), cands=$('humanCandidates'), textRow=$('humanTextRow');
  cands.innerHTML=''; textRow.classList.add('hidden'); panel.classList.remove('hidden');
  clearHumanTimer();
  const submit=val=>{ hideHumanPanel(); hideFloatSelect(); fetch('/api/action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({value:val})}); };

  if(prompt.action==='discuss'){
    label.textContent='💬 YOUR TURN — Type your message';
    textRow.classList.remove('hidden'); $('humanTextInput').value=''; $('humanTextInput').focus();
    $('humanSendBtn').onclick=()=>submit($('humanTextInput').value.trim()||'...');
    $('humanTextInput').onkeydown=e=>{if(e.key==='Enter')$('humanSendBtn').click();};
    startHumanTimer(60, () => submit('...'));
  } else {
    const labels={vote:'🗳 VOTE — Choose who to arrest',kill:'🔪 NIGHT — Choose your kill target',mafia_tiebreak:'🔪 TIE — You decide the kill target',investigate:'🔍 INVESTIGATE — Choose a player',save:'💊 PROTECT — Choose a player to save',mafia_chat:'🔪 MAFIA CHAT — Your message'};
    label.textContent=labels[prompt.action]||'Your turn';
    const clist=prompt.candidates||[];
    const isVoteAction = ['vote', 'kill', 'mafia_tiebreak'].includes(prompt.action);
    const defaultVal = prompt.action === 'mafia_chat' ? 'I agree.' : (isVoteAction ? 'SKIP' : '');

    if(prompt.action==='mafia_chat'){
      textRow.classList.remove('hidden'); $('humanTextInput').value=''; $('humanTextInput').focus();
      $('humanSendBtn').onclick=()=>submit($('humanTextInput').value.trim()||'...');
      $('humanTextInput').onkeydown=e=>{if(e.key==='Enter')$('humanSendBtn').click();};
      startHumanTimer(45, () => submit(defaultVal));
    } else {
      // Show floating selection
      hideHumanPanel();
      const titleMap={vote:'VOTE TO ARREST',kill:'CHOOSE YOUR TARGET',mafia_tiebreak:'BREAK THE TIE',investigate:'INVESTIGATE',save:'PROTECT A PLAYER'};
      showFloatSelect(titleMap[prompt.action]||'CHOOSE',clist,val=>submit(val),45,defaultVal);
    }
  }
}
function showHumanPanel(prompt){ G._pendingHumanPanel=prompt; checkHumanPanelReady(); }
function hideHumanPanel(){ $('humanPanel').classList.add('hidden'); clearHumanTimer(); }
function startHumanTimer(sec,onTimeout){
  let rem = sec;
  const fill = $('humanTimerFill'); fill.style.width='100%';
  G.humanTimerInterval = setInterval(() => {
    if(G.paused) return;
    rem--; fill.style.width=`${(rem/sec)*100}%`;
    if(rem<=0) { clearHumanTimer(); onTimeout(); }
  }, 1000);
}
function clearHumanTimer(){ if(G.humanTimerInterval){clearInterval(G.humanTimerInterval);G.humanTimerInterval=null;} }

// ── Voice-to-Text ──────────────────────────────────────────────────────────
function initSTT() {
  const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(!SR){ $('humanMicBtn').style.display='none'; return; }
  G.recognition=new SR(); G.recognition.continuous=false; G.recognition.interimResults=false; G.recognition.lang='en-US';
  G.recognition.onresult=e=>{ 
    const t = e.results[0][0].transcript; 
    let curr = $('humanTextInput').value.trim();
    $('humanTextInput').value = curr ? curr + ' ' + t : t;
    stopMic(); 
  };
  G.recognition.onend=()=>stopMic();
  G.recognition.onerror=()=>stopMic();
  $('humanMicBtn').onclick=()=>{ if(G.micActive) stopMic(); else startMic(); };
}
function startMic(){ if(!G.recognition) return; G.micActive=true; $('humanMicBtn').classList.add('recording'); $('micIcon').setAttribute('href','#icon-mic'); G.recognition.start(); }
function stopMic(){ G.micActive=false; $('humanMicBtn').classList.remove('recording'); try{G.recognition&&G.recognition.stop();}catch{} }

// ── SSE ────────────────────────────────────────────────────────────────────
function connectSSE() {
  if(G.eventSource) G.eventSource.close();
  G.eventSource=new EventSource('/api/events');
  G.eventSource.onmessage=e=>{ try{handleEvent(JSON.parse(e.data));}catch{} };
  G.eventSource.onerror=()=>{ $('feedStatus').style.color='var(--mafia)'; };
}
function disconnectSSE(){ if(G.eventSource){G.eventSource.close();G.eventSource=null;} }

// ── Game setup helpers ─────────────────────────────────────────────────────
function getConfig(){
  return{
    player_name:G.playerName,
    num_players:parseInt(document.querySelector('#playerCountGroup .toggle-btn.active')?.dataset.val||'5'),
    discussion_rounds:parseInt(document.querySelector('#discussionGroup .toggle-btn.active')?.dataset.val||'2'),
    ai_provider:$('aiProvider').value,
    ai_model:$('aiModel').value,
    human_player:document.querySelector('#modeGroup .toggle-btn.active')?.dataset.val==='play',
    human_role:'random'
  };
}
function bindToggleGroup(id){ const g=$(id); if(!g)return; g.querySelectorAll('.toggle-btn').forEach(b=>{ b.onclick=()=>{ g.querySelectorAll('.toggle-btn').forEach(x=>x.classList.remove('active')); b.classList.add('active'); }; }); }

function startGame(){
  const cfg=getConfig(); G.humanMode=cfg.human_player; G.myName=cfg.player_name;
  $('setupScreen').classList.add('hidden'); $('gameScreen').classList.remove('hidden');
  $('eventFeed').innerHTML=''; $('playersGrid').innerHTML='';
  $('victoryScreen').classList.add('hidden'); G.displayQueue=[]; G.displayBusy=false; G._pendingHumanPanel=null;
  clearTTS(); connectSSE();
  fetch('/api/start',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(cfg)});
}

function doExit() {
  try {
    G.stopRequested=true; G.gameRunning=false; G.paused=false;
    if(window.speechSynthesis) { window.speechSynthesis.pause(); window.speechSynthesis.cancel(); }
    G.displayQueue=[]; G.displayBusy=false;
    fetch('/api/stop',{method:'POST'}).catch(()=>{});
    hideHumanPanel(); hideFloatSelect();
    if(G.eventSource){G.eventSource.close();G.eventSource=null;}
    $('victoryScreen').classList.add('hidden');
    $('gameScreen').classList.add('hidden');
    $('pauseOverlay').classList.add('hidden');
    $('setupScreen').classList.remove('hidden');
    // Auto reset dev mode
    if(G.devMode) { G.devMode=false; document.body.classList.remove('dev-mode'); $('devToggle').classList.remove('active'); $('devToggle').querySelector('use').setAttribute('href','#icon-eye-off'); $('devBanner').classList.add('hidden'); }
    G.stopRequested=false; G._pendingHumanPanel=null;
  } catch(e) {
    console.error("Exit error", e);
    window.location.reload();
  }
}

// ── Init ────────────────────────────────────────────────────────────────────
function init(){
  applyTheme(); initVoices(); initSTT();

  // Refresh guard
  window.addEventListener('beforeunload',e=>{ if(G.gameRunning){e.preventDefault();e.returnValue='A game is in progress. Are you sure you want to leave?';} });
  window.addEventListener('unload', () => { if(G.gameRunning) navigator.sendBeacon('/api/stop'); });

  // Name modal
  const saved=localStorage.getItem('mafia_player_name');
  if(saved&&saved.trim()){ G.playerName=saved.trim(); showSetup(); } else { $('nameModal').classList.remove('hidden'); }
  $('nameSubmit').onclick=()=>{ const v=$('nameInput').value.trim(); if(!v)return; G.playerName=v; localStorage.setItem('mafia_player_name',v); showSetup(); };
  $('nameInput').onkeydown=e=>{ if(e.key==='Enter')$('nameSubmit').click(); };
  $('renameBtn').onclick=()=>{ $('nameInput').value=G.playerName; $('setupScreen').classList.add('hidden'); $('nameModal').classList.remove('hidden'); };

  function showSetup(){ $('nameModal').classList.add('hidden'); $('setupScreen').classList.remove('hidden'); $('setupPlayerName').textContent=G.playerName; }

  bindToggleGroup('playerCountGroup'); bindToggleGroup('discussionGroup'); bindToggleGroup('modeGroup');
  $('startGameBtn').onclick=startGame;

  // TTS toggle
  $('ttsToggle').onclick=()=>{
    G.ttsEnabled=!G.ttsEnabled;
    $('ttsToggle').classList.toggle('active',G.ttsEnabled);
    $('ttsIcon').setAttribute('href',G.ttsEnabled?'#icon-sound-on':'#icon-sound-off');
    if(!G.ttsEnabled) clearTTS();
  };

  // Theme cycle
  const doThemeCycle = () => {
    cycleTheme();
    const icon = G.theme === 'system' ? '#icon-monitor' : G.theme === 'dark' ? '#icon-moon' : '#icon-sun';
    const stIcon = $('setupThemeIcon');
    if (stIcon) stIcon.setAttribute('href', icon);
    const thIcon = $('themeIcon');
    if (thIcon) thIcon.setAttribute('href', icon);
  };
  $('themeToggle').onclick=doThemeCycle;
  if ($('setupThemeToggle')) $('setupThemeToggle').onclick=doThemeCycle;
  // Initialize setup icon
  const stIcon = $('setupThemeIcon');
  if (stIcon) stIcon.setAttribute('href', THEME_ICONS[G.theme]);

  // Dev toggle (leftmost)
  $('devToggle').onclick=()=>{
    G.devMode=!G.devMode;
    document.body.classList.toggle('dev-mode',G.devMode);
    $('devToggle').classList.toggle('active',G.devMode);
    $('devToggle').querySelector('use').setAttribute('href',G.devMode?'#icon-eye':'#icon-eye-off');
    $('devBanner').classList.toggle('hidden',!G.devMode);
    buildPlayerCards();
    addFeedEntry(`<div class="fe-actor">OBSERVATION MODE ${G.devMode?'ON':'OFF'}</div>`,'fe-system');
  };

  // Pause button
  const pBtn = $('pauseBtn');
  if (pBtn) {
    pBtn.onclick=()=>{
      if(!G.gameRunning || G.paused) return;
      G.paused = true;
      pBtn.classList.add('active');
      $('pauseIconUse').setAttribute('href', '#icon-play');
      fetch('/api/pause', {method:'POST'});
      if (window.speechSynthesis) window.speechSynthesis.pause();
      $('pauseOverlay').classList.remove('hidden');
      addFeedEntry(`<div class="fe-actor">GAME PAUSED</div>`, 'fe-system');
    };
  }

  const rBtn = $('resumeOverlayBtn');
  if (rBtn) {
    rBtn.onclick=()=>{
      if (!G.paused) return;
      G.paused = false;
      pBtn.classList.remove('active');
      $('pauseIconUse').setAttribute('href', '#icon-pause');
      fetch('/api/resume', {method:'POST'});
      if (window.speechSynthesis) window.speechSynthesis.resume();
      $('pauseOverlay').classList.add('hidden');
      addFeedEntry(`<div class="fe-actor">GAME RESUMED</div>`, 'fe-system');
    };
  }

  // Exit — force stops game
  $('exitBtn').onclick=()=>{ doExit(); };

  // Play again
  $('playAgainBtn').onclick=()=>{ disconnectSSE(); fetch('/api/stop',{method:'POST'}); $('victoryScreen').classList.add('hidden'); $('gameScreen').classList.add('hidden'); $('setupScreen').classList.remove('hidden'); };

  // AI provider → model hint
  $('aiProvider').onchange=()=>{
    const m={groq:'llama-3.1-8b-instant',openai:'gpt-4o-mini',anthropic:'claude-3-haiku-20240307',google:'gemini-2.5-flash-lite',xai:'grok-3-mini',deepseek:'deepseek-chat'};
    $('aiModel').value=m[$('aiProvider').value]||'';
  };
}

document.addEventListener('DOMContentLoaded',init);
