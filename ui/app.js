/* ===== SPLASH / INJECTION BOOTSTRAP ===== */
const statusEl=document.getElementById('splashStatus');
const detailEl=document.getElementById('splashDetail');
const progressEl=document.getElementById('splashProgress');
function sleep(ms){ return new Promise(resolve=>setTimeout(resolve,ms)); }
function splashStep(status, detail, progress, kind=''){
  statusEl.textContent=status;
  statusEl.className='splash-status'+(kind?' '+kind:'');
  detailEl.textContent=detail||'';
  progressEl.style.width=Math.max(0,Math.min(100,progress))+'%';
}
function waitForPywebviewBridge(timeoutMs=3500){
  if(window.pywebview && window.pywebview.api) return Promise.resolve(window.pywebview.api);
  return new Promise(resolve=>{
    let done=false;
    const finish=api=>{ if(done) return; done=true; resolve(api||null); };
    window.addEventListener('pywebviewready',()=>finish(window.pywebview?.api||null),{once:true});
    setTimeout(()=>finish(null),timeoutMs);
  });
}
async function runInjectionBootstrap(){
  splashStep('Initializing Warden…','Starting the local injection supervisor',8);
  await sleep(220);
  const api=await waitForPywebviewBridge();
  if(!api || typeof api.prepare_injection!=='function'){
    splashStep('Desktop bridge not detected','Preview mode — injection is only executed by the desktop host',35);
    await sleep(260);
    splashStep('Ready.','Desktop host will run injection before starting the watcher',100,'ok');
    await sleep(420);
    return {ok:true, preview:true};
  }
  try{
    splashStep('Scanning JVM processes…','Checking whether SpawnPK launcher/client files are locked',20);
    const result=await api.prepare_injection();
    const launcher=result?.launcher || {};
    const client=result?.client || {};
    splashStep('Checking game files…',`${launcher.path || 'SpawnPK launcher'} · ${launcher.status || 'verified'}`,50);
    await sleep(120);
    splashStep('Verifying game client…',`${client.path || '.spawnpk-data/client.jar'} · ${client.status || 'verified'}`,72);
    await sleep(120);
    if(result?.ok){
      splashStep('Injection ready',result.message || 'Launcher and client hooks are installed',100,'ok');
      await sleep(380);
      return result;
    }
    splashStep('Injection unavailable',result?.error || 'Close any running SpawnPK JVM and retry setup',100,'error');
    await sleep(900);
    return result;
  }catch(err){
    splashStep('Injection failed',err?.message || 'The local injection supervisor returned an error',100,'error');
    await sleep(900);
    return {ok:false,error:String(err)};
  }
}
runInjectionBootstrap().finally(async ()=>{
  document.getElementById('splash').classList.add('out');
  setTimeout(async ()=>{
    document.getElementById('splash').style.display='none';
    const resumed=await tryResumeSession();
    if(!resumed) document.getElementById('wizard').classList.add('show');
  },600);
});

/* ===== WIZARD LOGIC ===== */
let wizStep=1; const totalSteps=3;
const wizTitles={1:["Welcome to Warden","Your companion tool for SpawnPK — track drops, PK timers, and market sales in real time."],2:["Who's playing?","Warden personalizes alerts and stats around your main account."],3:["Make it yours","Pick an accent and set your alert preferences. You can change these anytime."]};
function renderWizard(){
  document.querySelectorAll('.wiz-step').forEach(s=>s.classList.toggle('active', +s.dataset.step===wizStep));
  document.querySelectorAll('.wiz-steps i').forEach(i=>{ const n=+i.dataset.s; i.classList.toggle('active', n===wizStep); i.classList.toggle('done', n<wizStep); });
  document.getElementById('wizTitle').textContent=wizTitles[wizStep][0];
  document.getElementById('wizSub').textContent=wizTitles[wizStep][1];
  document.getElementById('wizBack').style.visibility = wizStep===1 ? 'hidden':'visible';
  document.getElementById('wizNext').textContent = wizStep===1 ? 'Get Started' : (wizStep===totalSteps ? 'Finish Setup' : 'Continue');
}
renderWizard();
document.getElementById('wizNext').addEventListener('click',()=>{
  if(wizStep===2){ const uname=document.getElementById('wizUsername').value.trim(); if(!uname){ document.getElementById('wizUsername').style.borderColor='var(--blood)'; document.getElementById('wizUsername').focus(); return; } }
  if(wizStep<totalSteps){ wizStep++; renderWizard(); return; }
  finishSetup();
});
document.getElementById('wizBack').addEventListener('click',()=>{ if(wizStep>1){ wizStep--; renderWizard(); } });
document.querySelectorAll('#wizard .swatch').forEach(sw=>{
  sw.addEventListener('click',()=>{
    document.querySelectorAll('#wizard .swatch').forEach(s=>s.classList.remove('selected'));
    sw.classList.add('selected');
    document.documentElement.style.setProperty('--blood', sw.dataset.c);
    document.documentElement.style.setProperty('--blood-glow', sw.dataset.g);
    document.querySelectorAll('#settingsSwatches .swatch').forEach(s2=>s2.classList.toggle('selected', s2.dataset.c===sw.dataset.c));
  });
});
document.querySelector('#wizard .switch').addEventListener('click',function(){ this.classList.toggle('on'); });

let PRIMARY_USER='Player';
function applyUser(name){
  PRIMARY_USER=name || 'Player';
  document.getElementById('userName').textContent=PRIMARY_USER;
  document.getElementById('userAv').textContent=PRIMARY_USER.slice(0,2).toUpperCase();
  document.getElementById('settingsUsername').value=PRIMARY_USER;
}
function showApp(){
  document.getElementById('wizard').classList.remove('show');
  const app=document.getElementById('app'); app.hidden=false;
  requestAnimationFrame(()=>app.classList.add('show'));
  initApp();
}
async function finishSetup(){
  const uname=document.getElementById('wizUsername').value.trim() || 'Player';
  const accentSwatch=document.querySelector('#wizard .swatch.selected');
  const accent=accentSwatch?.dataset.c || getComputedStyle(document.documentElement).getPropertyValue('--blood').trim();
  const glow=accentSwatch?.dataset.g || getComputedStyle(document.documentElement).getPropertyValue('--blood-glow').trim();
  applyUser(uname);
  const api=window.pywebview && window.pywebview.api;
  if(api && typeof api.complete_onboarding==='function'){
    try{ await api.complete_onboarding(uname, accent, glow); }
    catch(err){ console.error('Failed to persist onboarding', err); }
  }
  showApp();
}
/* Skip the wizard on repeat launches if setup was already completed */
async function tryResumeSession(){
  const api=window.pywebview && window.pywebview.api;
  if(!api || typeof api.get_config!=='function') return false;
  try{
    const cfg=await api.get_config();
    if(cfg && cfg.onboarding_complete && cfg.username){
      applyUser(cfg.username);
      if(cfg.theme_accent) document.documentElement.style.setProperty('--blood', cfg.theme_accent);
      if(cfg.theme_glow) document.documentElement.style.setProperty('--blood-glow', cfg.theme_glow);
      showApp();
      return true;
    }
  }catch(err){ console.error('Failed to load config', err); }
  return false;
}

/* ===== PAGE TRANSITION ENGINE ===== */
function triggerLoadbar(){
  const bar=document.getElementById('loadbar');
  bar.style.transition='none'; bar.style.width='0%'; bar.style.opacity='1';
  requestAnimationFrame(()=>{ bar.style.transition='width .35s ease'; bar.style.width='70%'; });
  setTimeout(()=>{ bar.style.width='100%'; setTimeout(()=>{ bar.style.opacity='0'; },200); },320);
}
function staggerChildren(pageEl){
  const kids=Array.from(pageEl.children);
  kids.forEach(k=>{ k.style.transition='none'; k.style.opacity='0'; k.style.transform='translateY(10px)'; });
  requestAnimationFrame(()=>{
    kids.forEach((k,i)=>{
      k.style.transition='opacity .4s ease, transform .4s ease';
      k.style.transitionDelay=(i*0.06)+'s';
      k.style.opacity='1'; k.style.transform='translateY(0)';
    });
  });
}
function goToPage(p){
  const current=document.querySelector('.nav-item.active')?.dataset.page;
  if(current===p) return;
  triggerLoadbar();
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.toggle('active', n.dataset.page===p));
  const mainEl=document.getElementById('main');
  const oldPage=document.querySelector('.page.active');
  const newPage=document.querySelector(`.page[data-page="${p}"]`);
  if(oldPage) oldPage.classList.add('leaving');
  setTimeout(()=>{
    if(oldPage){ oldPage.classList.remove('active','leaving'); }
    newPage.classList.add('active');
    mainEl.scrollTop=0;
    staggerChildren(newPage);
  },150);
}

/* ===== LIVE SERVER SYNC ===== */
/* main.py calls window.wardenOnServerEvent(event) whenever the desktop
   sync client receives a broadcast from the central server, and
   api.get_recent_events() (backed by the local cache, backfilled from
   the central server's GET /events/recent on startup) supplies the
   initial page-load feed. Both paths render through the same
   buildFeedItemNode() so live and backfilled events look identical.

   Event shape coming in: { event_type, raw_text, fields, observed_at,
   confirmations, reporter_username, content_hash }. `event_type` /
   `fields` here are whatever chat_parser.py on the server actually
   classifies chat into -- see server/chat_parser.py EVENT_PATTERNS --
   which right now is: drop, raids_drop, corb_kill, event_boss_spawn
   (anything else lands as chat_unclassified and isn't shown here).
   The extra entries below are forward-compat with the event types
   listed in server/README.md's classification doc, in case the
   patterns grow to emit them later. */
function escapeHtml(s){
  return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
/* Defense-in-depth: the server sanitizes fields on ingest now (see
   server/chat_parser.py sanitize_fields), but events already cached
   locally before that shipped -- or a server not yet upgraded --
   could still carry raw RuneLite formatting (<col=..>, @gre@..@bla@).
   Stripping again here is cheap and idempotent on already-clean text. */
function stripTags(s){
  if(s==null) return '';
  return String(s).replace(/<[^>]+>/g,'').replace(/@[a-zA-Z0-9]+@/g,'').replace(/[\[\]]/g,'').replace(/\s+/g,' ').trim();
}
function fieldText(v){ return escapeHtml(stripTags(v)); }
const EVENT_TYPE_META={
  drop:{label:'Drop',cls:'t-custom'},
  raids_drop:{label:'Raid Drop',cls:'t-rare'},
  corb_kill:{label:'PK Kill',cls:'t-boss'},
  event_boss_spawn:{label:'World Boss',cls:'t-event'},
  // forward-compat with server/README.md's classification list
  enchant:{label:'Enchant',cls:'t-custom'}, spawn:{label:'Spawn',cls:'t-event'},
  world_event:{label:'World Event',cls:'t-event'}, killstreak:{label:'Killstreak',cls:'t-boss'},
  killstreak_ended:{label:'Killstreak Ended',cls:'t-boss'}, pk_kill:{label:'PK Kill',cls:'t-boss'},
  corp_kill:{label:'Corp Kill',cls:'t-boss'}, boss_kill:{label:'Boss Kill',cls:'t-boss'},
  market_sale:{label:'Market Sale',cls:'t-custom'}, level_up:{label:'Level Up',cls:'t-custom'},
};
function describeEvent(type,f){
  switch(type){
    case 'drop': case 'raids_drop': {
      const qty=f.quantity && f.quantity>1 ? ('x'+f.quantity+' ') : '';
      const kc=f.kill_count ? ` (${fieldText(f.kill_count)} KC)` : '';
      return `<b>${fieldText(f.player)||'Unknown'}</b> received <span class="item-name">${qty}${fieldText(f.item)||'item'}</span> from ${fieldText(f.source)||'unknown source'}${kc}`;
    }
    case 'corb_kill':
      return `<b>${fieldText(f.killer)||'Unknown'}</b> defeated <b>${fieldText(f.victim)||'someone'}</b> for <span class="item-name">${fieldText(f.item)||'loot'}</span>`;
    case 'event_boss_spawn':
      return `World boss located at <b>${fieldText(f.location)||'an unknown location'}</b>`;
    default:
      return `<b>${fieldText(f.player||f.sender)||'Unknown'}</b> ${fieldText(f.item||f.message)}`;
  }
}
/* ===== SHARED EVENT CACHE ===== */
/* One fetch (loadAllEvents) backs the live feed, the dashboard's
   Recent Drops panel, the full Drops page, and the Profile page's
   per-player feed/stats -- all read from the same local-cache-backed
   list instead of each re-fetching. */
let ALL_EVENTS=[];
async function loadAllEvents(){
  const api=window.pywebview && window.pywebview.api;
  if(!api || typeof api.get_recent_events!=='function') return false;
  try{
    const events=await api.get_recent_events(null,150);
    if(!events || !events.length) return false;
    ALL_EVENTS=events;
    return true;
  }catch(err){ console.error('Failed to load recent events',err); return false; }
}
function upsertEvent(ev){
  if(!ev) return;
  if(ev.content_hash){
    const idx=ALL_EVENTS.findIndex(e=>e.content_hash===ev.content_hash);
    if(idx!==-1){ ALL_EVENTS[idx]=ev; return; }
  }
  ALL_EVENTS.unshift(ev);
  if(ALL_EVENTS.length>300) ALL_EVENTS.length=300;
}

function buildFeedItemNode(event){
  if(!event || event.event_type==='chat_unclassified') return null;
  const type=event.event_type;
  const f=event.fields||{};
  const meta=EVENT_TYPE_META[type] || {label:type||'Event',cls:'t-custom'};
  const timeSrc=event.observed_at || event.first_seen_at || event.created_at;
  const t=timeSrc ? new Date(timeSrc) : new Date();
  const time=isNaN(t.getTime()) ? new Date().toTimeString().slice(0,8) : t.toTimeString().slice(0,8);
  const confirmations=event.confirmations||0;
  const src=confirmations>1 ? ('&times;'+confirmations+' confirmed') : 'live';
  const div=document.createElement('div');
  div.className='feed-item '+meta.cls;
  div.innerHTML=`<div class="time">${time}</div><div><div class="type">${meta.label}</div><div class="desc">${describeEvent(type,f)}</div></div><div class="src">${src}</div>`;
  return div;
}
function wardenOnServerEvent(event){
  upsertEvent(event);
  const feed=document.getElementById('feed');
  const node=feed ? buildFeedItemNode(event) : null;
  if(feed && node){
    node.classList.add('new');
    feed.insertBefore(node,feed.firstChild);
    document.querySelectorAll('#feed .feed-item.new').forEach((el,idx)=>{ if(idx>0) el.classList.remove('new'); });
    if(feed.children.length>9) feed.removeChild(feed.lastChild);
  }
  stopDemoFeed(); // once real live events are flowing, drop the placeholder generator for good
  renderDashboardDrops();
  if(typeof renderDropsPage==='function'){ populateDropsSourceOptions(); renderDropsPage(); }
  if(typeof renderProfileFeed==='function'){ renderProfileFeed(); renderWatchStats(); }
}
window.wardenOnServerEvent=wardenOnServerEvent;

/* Initial page-load population of #feed (and everything else that
   reads ALL_EVENTS) from real recent events (local cache, backfilled
   from the central server on startup -- see main.py). Falls back to
   the demo generator (below) only when no bridge/data is available,
   e.g. running app.html straight in a browser during frontend dev. */
async function loadInitialFeed(){
  const loaded=await loadAllEvents();
  const feed=document.getElementById('feed');
  if(feed && loaded){
    const nodes=ALL_EVENTS.slice(0,12).map(buildFeedItemNode).filter(Boolean);
    if(nodes.length){ feed.innerHTML=''; nodes.forEach(n=>feed.appendChild(n)); }
  }
  renderDashboardDrops();
  if(typeof populateDropsSourceOptions==='function'){ populateDropsSourceOptions(); renderDropsPage(); }
  if(typeof renderProfileFeed==='function'){ renderProfileFeed(); renderWatchStats(); }
  return loaded && ALL_EVENTS.length>0;
}

/* ===== DROPS (dashboard panel + full Drops page) ===== */
const DROP_TYPES=['drop','raids_drop'];
function isDropEvent(ev){ return !!ev && DROP_TYPES.includes(ev.event_type); }
function dropRowHtml(ev){
  const f=ev.fields||{};
  const timeSrc=ev.observed_at || ev.first_seen_at || ev.created_at;
  const t=timeSrc ? new Date(timeSrc) : null;
  const time=(t && !isNaN(t.getTime())) ? t.toTimeString().slice(0,8) : '—';
  const qty=f.quantity && f.quantity>1 ? ('x'+f.quantity+' ') : '';
  const item=qty+(fieldText(f.item)||'Unknown item');
  const player=fieldText(f.player)||'Unknown';
  const source=fieldText(f.source) || (ev.event_type==='raids_drop' ? 'Raid' : '—');
  // No per-drop valuation data is wired up yet (drops don't carry an
  // item id to join against market sales) -- showing a real number
  // here would mean making one up, so it's an honest "—" for now.
  return `<tr><td>${time}</td><td>${player}</td><td>${item}</td><td style="color:var(--steel-dim);">—</td><td>${source}</td></tr>`;
}
function renderDashboardDrops(){
  const body=document.getElementById('dashDropsBody');
  if(!body) return;
  const rows=ALL_EVENTS.filter(isDropEvent).slice(0,6);
  body.innerHTML = rows.length ? rows.map(dropRowHtml).join('') : '<tr><td colspan="5" style="color:var(--steel-dim);">No drops recorded yet</td></tr>';
}
function populateDropsSourceOptions(){
  const sel=document.getElementById('dropsSourceSelect');
  if(!sel) return;
  const current=sel.value;
  const sources=[...new Set(ALL_EVENTS.filter(isDropEvent).map(e=>fieldText((e.fields||{}).source)).filter(Boolean))].sort();
  sel.innerHTML='<option value="">All Sources</option>'+sources.map(s=>`<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('');
  if(sources.includes(current)) sel.value=current;
}
function renderDropsPage(){
  const body=document.getElementById('dropsPageBody');
  if(!body) return;
  const q=(document.getElementById('dropsSearchInput')?.value||'').trim().toLowerCase();
  const src=document.getElementById('dropsSourceSelect')?.value||'';
  const typ=document.getElementById('dropsTypeSelect')?.value||'';
  let rows=ALL_EVENTS.filter(isDropEvent);
  if(typ) rows=rows.filter(e=>e.event_type===typ);
  if(src) rows=rows.filter(e=>fieldText((e.fields||{}).source)===src);
  if(q) rows=rows.filter(e=>fieldText((e.fields||{}).player).toLowerCase().includes(q));
  rows=rows.slice(0,80);
  body.innerHTML = rows.length ? rows.map(dropRowHtml).join('') : '<tr><td colspan="5" style="color:var(--steel-dim);">No drops match these filters</td></tr>';
}
function initDropsPage(){
  populateDropsSourceOptions();
  renderDropsPage();
  document.getElementById('dropsFilterBtn')?.addEventListener('click',renderDropsPage);
  document.getElementById('dropsSearchInput')?.addEventListener('keydown',e=>{ if(e.key==='Enter') renderDropsPage(); });
  document.getElementById('dropsSourceSelect')?.addEventListener('change',renderDropsPage);
  document.getElementById('dropsTypeSelect')?.addEventListener('change',renderDropsPage);
  document.getElementById('dashDropsViewAll')?.addEventListener('click',()=>goToPage('drops'));
}

function pollSyncStatus(){
  const api=window.pywebview && window.pywebview.api;
  const dot=document.getElementById('apiSyncDot');
  const label=document.getElementById('apiSyncLabel');
  if(!api || typeof api.get_sync_status!=='function') return;
  api.get_sync_status().then(status=>{
    if(!dot||!label) return;
    if(status && status.configured){
      label.textContent='API Synced';
      dot.style.background='var(--toxic)'; dot.style.boxShadow='0 0 8px var(--toxic)';
    }else{
      label.textContent='API Offline';
      dot.style.background='var(--steel-dim)'; dot.style.boxShadow='none';
    }
  }).catch(()=>{});
}

/* ===== WINDOW CHROME (frameless window: custom min/max/close + tray) ===== */
async function initWindowChrome(){
  const api=window.pywebview && window.pywebview.api;
  document.getElementById('winMin')?.addEventListener('click',()=>{ api?.minimize_window?.(); });
  document.getElementById('winMax')?.addEventListener('click',()=>{ api?.toggle_maximize_window?.(); });
  document.getElementById('winClose')?.addEventListener('click',()=>{ api?.request_close?.(); });

  const sw=document.getElementById('closeBehaviorSwitch');
  if(!sw) return;
  if(api && typeof api.get_config==='function'){
    try{
      const cfg=await api.get_config();
      sw.classList.toggle('on', cfg.close_behavior!=='exit');
    }catch(err){ console.error('Failed to load close_behavior',err); }
  }
  sw.addEventListener('click',()=>{
    sw.classList.toggle('on');
    const behavior = sw.classList.contains('on') ? 'background' : 'exit';
    if(api && typeof api.save_config==='function'){
      api.save_config({close_behavior:behavior}).catch(err=>console.error('Failed to save close_behavior',err));
    }
  });
}

/* ===== APP INIT ===== */
function initApp(){
  initWindowChrome();
  pollSyncStatus();
  setInterval(pollSyncStatus,15000);
  document.querySelectorAll('.val[data-count]').forEach(el=>{
    const target=+el.dataset.count; let cur=0; const step=Math.max(1,Math.round(target/30));
    const iv=setInterval(()=>{ cur+=step; if(cur>=target){cur=target;clearInterval(iv);} el.textContent=cur; },30);
  });
  document.querySelectorAll('.spark').forEach(spark=>{ for(let i=0;i<24;i++){ const bar=document.createElement('i'); bar.style.height=(20+Math.random()*80)+'%'; bar.style.animationDelay=(i*0.02)+'s'; spark.appendChild(bar); } });
  function tick(){ document.getElementById('clockTxt').textContent=new Date().toTimeString().slice(0,8); }
  setInterval(tick,1000); tick();

  function makeCountdown(ringId,txtId,totalSec,startSec){
    const ring=document.getElementById(ringId), txt=document.getElementById(txtId); const C=169.6;
    let remaining=startSec;
    function render(){ const frac=remaining/totalSec; ring.style.strokeDashoffset=C*(1-frac); const m=String(Math.floor(remaining/60)).padStart(2,'0'), s=String(remaining%60).padStart(2,'0'); txt.textContent=m+':'+s; }
    render(); setInterval(()=>{ remaining=remaining>0?remaining-1:totalSec; render(); },1000);
  }
  makeCountdown('eventRing','eventRingTxt',372,372);

  /* ===== Half TB / Full TB timers =====
     Start/stop countdowns with per-timer assignable hotkeys, saved to
     localStorage so bindings survive a restart. */
  const TB_TIMERS={
    halftb:{ring:'ring1',txt:'ring1txt',total:150,hkEl:'ring1hk',defaultKey:'Numpad1'},
    fulltb:{ring:'ring2',txt:'ring2txt',total:300,hkEl:'ring2hk',defaultKey:'Numpad2'},
  };
  const tbState={};
  function loadHotkey(id,fallback){ try{ return localStorage.getItem('warden_hotkey_'+id) || fallback; }catch(e){ return fallback; } }
  function saveHotkey(id,key){ try{ localStorage.setItem('warden_hotkey_'+id,key); }catch(e){} }
  Object.keys(TB_TIMERS).forEach(id=>{
    const cfg=TB_TIMERS[id];
    const ring=document.getElementById(cfg.ring), txt=document.getElementById(cfg.txt); const C=169.6;
    const st={remaining:cfg.total,running:false,interval:null,key:loadHotkey(id,cfg.defaultKey)};
    tbState[id]=st;
    document.getElementById(cfg.hkEl).textContent='Hotkey: '+st.key;
    function render(){
      const frac=st.remaining/cfg.total; ring.style.strokeDashoffset=C*(1-frac);
      const m=String(Math.floor(st.remaining/60)).padStart(2,'0'), s=String(st.remaining%60).padStart(2,'0');
      txt.textContent=m+':'+s;
    }
    function tick(){
      if(st.remaining<=0){ stop(); return; }
      st.remaining-=1; render();
      if(st.remaining<=0) stop();
    }
    function start(){ if(st.running) return; st.running=true; st.interval=setInterval(tick,1000); updateBtn(); }
    function stop(){ st.running=false; if(st.interval){ clearInterval(st.interval); st.interval=null; } updateBtn(); }
    function toggle(){ st.running?stop():start(); }
    function reset(){ stop(); st.remaining=cfg.total; render(); }
    st.toggle=toggle; st.reset=reset;
    const card=ring.closest('.timer-card');
    const toggleBtn=card.querySelector('[data-act="toggle"]');
    function updateBtn(){ toggleBtn.textContent=st.running?'❚❚':'▶'; }
    toggleBtn.addEventListener('click',toggle);
    card.querySelector('[data-act="reset"]').addEventListener('click',reset);
    const bindBtn=card.querySelector('[data-act="bind"]');
    bindBtn.addEventListener('click',()=>{
      bindBtn.classList.add('listening'); bindBtn.textContent='Press key…';
      const onKey=(e)=>{
        e.preventDefault();
        const key=e.code || e.key;
        st.key=key; saveHotkey(id,key);
        document.getElementById(cfg.hkEl).textContent='Hotkey: '+key;
        bindBtn.classList.remove('listening'); bindBtn.textContent='Set Key';
        window.removeEventListener('keydown',onKey,true);
      };
      window.addEventListener('keydown',onKey,true);
    });
    render(); updateBtn();
  });
  // Global hotkey listener -- ignores keystrokes while typing in an input/textarea.
  window.addEventListener('keydown',(e)=>{
    const tag=(e.target && e.target.tagName)||'';
    if(tag==='INPUT'||tag==='TEXTAREA') return;
    Object.keys(tbState).forEach(id=>{
      const st=tbState[id];
      if((e.code||e.key)===st.key){ e.preventDefault(); st.toggle(); }
    });
  });

  // Placeholder generator -- only runs when there's no real bridge/data
  // to show (e.g. dev preview in a plain browser, or a fresh install
  // that hasn't received anything yet). Real events (initial backfill
  // + live WS pushes) always take priority; see loadInitialFeed() and
  // wardenOnServerEvent() above.
  const feedData=[
    {type:'rare',player:'Zezima OG',item:'Twisted bow',src:'Corporeal Beast',val:'80M'},
    {type:'custom',player:'Nightshade',item:'Scythe of vitur',src:'Theatre Loot',val:'65M'},
    {type:'boss',player:'Ruthless99',item:'Voidwaker',src:"Vet'ion · Lvl 30",val:'40M'},
  ];
  let fi=0;
  function injectFeed(){
    const d=feedData[fi%feedData.length]; fi++;
    const now=new Date().toTimeString().slice(0,8);
    const labelMap={rare:'Rare Drop',custom:'Custom Item',boss:'Boss Drop'};
    const div=document.createElement('div');
    div.className='feed-item t-'+d.type+' new';
    div.innerHTML=`<div class="time">${now}</div><div><div class="type">${labelMap[d.type]}</div><div class="desc"><b>${d.player}</b> received <span class="item-name">${d.item}</span></div><div class="val">VALUE ${d.val}</div></div><div class="src">${d.src}</div>`;
    const feed=document.getElementById('feed');
    if(feed){ feed.insertBefore(div,feed.firstChild);
      document.querySelectorAll('#feed .feed-item.new').forEach((el,idx)=>{ if(idx>0) el.classList.remove('new'); });
      if(feed.children.length>9) feed.removeChild(feed.lastChild);
    }
  }
  let demoFeedTimer=null;
  function stopDemoFeed(){ if(demoFeedTimer){ clearInterval(demoFeedTimer); demoFeedTimer=null; } }
  window.stopDemoFeed=stopDemoFeed; // wardenOnServerEvent() calls this once live data arrives
  loadInitialFeed().then(loaded=>{ if(!loaded) demoFeedTimer=setInterval(injectFeed,7000); });
  document.getElementById('clearBtn').addEventListener('click',()=>{ document.getElementById('feed').innerHTML=''; });
  document.querySelectorAll('.switch').forEach(sw=>{ if(sw.id==='closeBehaviorSwitch') return; sw.addEventListener('click',()=>sw.classList.toggle('on')); });

  // page routing
  document.querySelectorAll('[data-page]').forEach(el=>{
    if(el.classList.contains('page')) return;
    el.addEventListener('click',()=>goToPage(el.dataset.page));
  });

  // timers
  const timerGridFull=document.getElementById('timerGridFull');
  const timerNames=['Numpad 1 · Teleblock','Numpad 2 · Vengeance','Numpad 3 · Freeze','Numpad 4 · Recoil','Numpad 5 · Spec Regen','Numpad 6 · Antifire'];
  const durations=[150,300,20,180,45,120];
  timerNames.forEach((name,idx)=>{
    const id='fring'+idx, txtId='fringtxt'+idx;
    const card=document.createElement('div'); card.className='timer-card';
    card.innerHTML=`<div class="timer-ring"><svg width="64" height="64" viewBox="0 0 64 64"><circle class="bg" cx="32" cy="32" r="27" fill="none" stroke-width="4"/><circle class="fg" id="${id}" cx="32" cy="32" r="27" fill="none" stroke-width="4" stroke-dasharray="169.6" stroke-dashoffset="0"/></svg><div class="label" id="${txtId}">--:--</div></div><div class="timer-info"><div class="n">${name}</div><div class="btns"><button>▶</button><button>↻</button></div></div>`;
    timerGridFull.appendChild(card);
    makeCountdown(id,txtId,durations[idx],Math.floor(durations[idx]*Math.random()));
  });

  // custom items add/remove
  document.getElementById('addItemBtn').addEventListener('click',()=>{
    const input=document.getElementById('newItemInput'); const val=input.value.trim(); if(!val) return;
    const row=document.createElement('div'); row.className='item-mgr-row'; row.innerHTML=`<span class="nm">${val}</span><span class="del">✕</span>`;
    row.querySelector('.del').addEventListener('click',()=>row.remove());
    document.getElementById('itemMgrList').appendChild(row); input.value='';
  });
  document.querySelectorAll('.item-mgr-row .del').forEach(d=>d.addEventListener('click',(e)=>e.target.closest('.item-mgr-row').remove()));

  document.querySelectorAll('#settingsSwatches .swatch').forEach(sw=>{
    sw.addEventListener('click',()=>{
      document.querySelectorAll('#settingsSwatches .swatch').forEach(s=>s.classList.remove('selected'));
      sw.classList.add('selected');
      document.documentElement.style.setProperty('--blood', sw.dataset.c);
      document.documentElement.style.setProperty('--blood-glow', sw.dataset.g);
    });
  });
  document.getElementById('testConnBtn').addEventListener('click',function(){
    const orig=this.textContent; this.textContent='Testing…';
    setTimeout(()=>{ this.textContent='Connected ✓'; setTimeout(()=>this.textContent=orig,1500); },900);
  });

  initProfile();
  initMarket();
  initDropsPage();
}

/* ===== PROFILE PAGE ===== */
/* Watchlist persists via api.get_watchlist/add_watch/remove_watch
   (local_store.py). Feed + stats are derived from ALL_EVENTS (see
   the SHARED EVENT CACHE block above) filtered to whichever
   player(s) are selected -- reusing buildFeedItemNode() so this
   looks identical to the live feed. */
function seededRand(seedStr){ let h=0; for(let i=0;i<seedStr.length;i++){ h=(h<<5)-h+seedStr.charCodeAt(i); h|=0; } return function(){ h=(h*9301+49297)%233280; return h/233280; }; }
const watchedUsers=[]; // populated on init from the real watchlist
let activeWatch='ALL';
function matchesWatchPlayer(ev,name){
  if(!ev || !name) return false;
  const f=ev.fields||{};
  const target=name.toLowerCase();
  return [f.player,f.killer,f.victim].some(v=>v && stripTags(v).toLowerCase()===target);
}
async function initProfile(){
  document.getElementById('profBigAv').textContent=PRIMARY_USER.slice(0,2).toUpperCase();
  document.getElementById('pnameText').textContent=PRIMARY_USER;
  watchedUsers.length=0;
  watchedUsers.push({name:PRIMARY_USER,you:true});
  const api=window.pywebview && window.pywebview.api;
  if(api && typeof api.get_watchlist==='function'){
    try{
      const names=await api.get_watchlist();
      (names||[]).forEach(n=>{ if(n && n.toLowerCase()!==PRIMARY_USER.toLowerCase()) watchedUsers.push({name:n,you:false}); });
    }catch(err){ console.error('Failed to load watchlist',err); }
  }
  renderWatchChips();
  renderProfileFeed();

  document.getElementById('pnameEditBtn').addEventListener('click',()=>{
    document.getElementById('pnameDisplay').style.display='none';
    document.getElementById('pnameEditRow').classList.add('active');
    document.getElementById('pnameInput').value=PRIMARY_USER;
    document.getElementById('pnameInput').focus();
  });
  document.getElementById('pnameSave').addEventListener('click',()=>{
    const v=document.getElementById('pnameInput').value.trim();
    if(v){ PRIMARY_USER=v; document.getElementById('pnameText').textContent=v; document.getElementById('userName').textContent=v; document.getElementById('userAv').textContent=v.slice(0,2).toUpperCase(); document.getElementById('profBigAv').textContent=v.slice(0,2).toUpperCase(); watchedUsers[0].name=v; if(api && typeof api.save_config==='function'){ api.save_config({username:v}).catch(err=>console.error('Failed to save username',err)); } renderWatchChips(); renderProfileFeed(); }
    document.getElementById('pnameDisplay').style.display='flex';
    document.getElementById('pnameEditRow').classList.remove('active');
  });
  document.getElementById('addWatchBtn').addEventListener('click',async ()=>{
    const input=document.getElementById('newWatchInput'); const v=input.value.trim(); if(!v) return;
    if(api && typeof api.add_watch==='function'){
      try{
        const names=await api.add_watch(v);
        watchedUsers.length=0; watchedUsers.push({name:PRIMARY_USER,you:true});
        (names||[]).forEach(n=>{ if(n && n.toLowerCase()!==PRIMARY_USER.toLowerCase()) watchedUsers.push({name:n,you:false}); });
      }catch(err){ console.error('Failed to add watch',err); watchedUsers.push({name:v,you:false}); }
    }else{
      watchedUsers.push({name:v,you:false});
    }
    renderWatchChips(true); input.value='';
  });
}
function renderWatchChips(animateLast){
  const row=document.getElementById('watchChips'); row.innerHTML='';
  const api=window.pywebview && window.pywebview.api;
  watchedUsers.forEach((u,idx)=>{
    const chip=document.createElement('div');
    chip.className='chip'+(u.you?' you':'')+(activeWatch===u.name?' active':'')+((animateLast&&idx===watchedUsers.length-1)?' chip-enter':'');
    chip.innerHTML=`<span>${escapeHtml(u.name)}${u.you?' (you)':''}</span>`+(u.you?'':'<span class="x">✕</span>');
    chip.addEventListener('click',(e)=>{ if(e.target.classList.contains('x')) return; activeWatch = activeWatch===u.name ? 'ALL' : u.name; renderWatchChips(); renderProfileFeed(); });
    if(!u.you){ chip.querySelector('.x').addEventListener('click',(e)=>{
      e.stopPropagation();
      watchedUsers.splice(idx,1);
      if(activeWatch===u.name) activeWatch='ALL';
      if(api && typeof api.remove_watch==='function'){ api.remove_watch(u.name).catch(err=>console.error('Failed to remove watch',err)); }
      renderWatchChips(); renderProfileFeed();
    }); }
    row.appendChild(chip);
  });
  const allChip=document.createElement('div');
  allChip.className='chip'+(activeWatch==='ALL'?' active':'');
  allChip.style.order=-1;
  allChip.innerHTML='<span>All</span>';
  allChip.addEventListener('click',()=>{ activeWatch='ALL'; renderWatchChips(); renderProfileFeed(); });
  row.prepend(allChip);

  document.getElementById('feedFilterLabel').textContent = activeWatch==='ALL' ? 'All Watched Players' : activeWatch+"'s Feed";
  renderWatchStats();
}
function renderWatchStats(){
  const names = activeWatch==='ALL' ? watchedUsers.map(u=>u.name) : [activeWatch];
  const matched=ALL_EVENTS.filter(ev=>names.some(n=>matchesWatchPlayer(ev,n)));
  // "sales" isn't wired up yet -- market_store.recent_sales only
  // filters by item, not by buyer/seller username, so there's no
  // real per-player number to show here without fabricating one.
  const stats={drops:matched.filter(isDropEvent).length, raids:matched.filter(e=>e.event_type==='raids_drop').length, sales:null};
  document.querySelectorAll('#watchStats .n').forEach(el=>{
    const val=stats[el.dataset.w];
    el.style.opacity='0';
    setTimeout(()=>{ el.textContent=(val===null||val===undefined)?'—':val; el.style.transition='opacity .25s ease'; el.style.opacity='1'; },120);
  });
}
function renderProfileFeed(){
  const feed=document.getElementById('profileFeed');
  if(!feed) return;
  feed.innerHTML='';
  const names = activeWatch==='ALL' ? watchedUsers.map(u=>u.name) : [activeWatch];
  const rows=ALL_EVENTS.filter(ev=>names.some(n=>matchesWatchPlayer(ev,n))).slice(0,30);
  const nodes=rows.map(buildFeedItemNode).filter(Boolean);
  if(!nodes.length){
    feed.innerHTML=`<div style="padding:16px;color:var(--steel-dim);font-size:11px;">No recorded events yet for ${activeWatch==='ALL'?'these players':escapeHtml(activeWatch)}.</div>`;
    return;
  }
  nodes.forEach(n=>feed.appendChild(n));
}

/* ===== MARKET PAGE ===== */
/* Item catalog + sale history come from the central server's
   /market/items and /market/sales (see server/market_poller.py,
   server/items_catalog.py) via api.get_market_items() /
   api.get_market_sales() -- both plain REST passthroughs on the
   desktop side (main.py), no local caching. Falls back to a small
   demo catalog + synthetic series only when there's no bridge/data,
   same pattern as the dashboard feed (loadInitialFeed()). */
const DEMO_MARKET_ITEMS=[
  {name:'Twisted bow',item_id:20997},{name:'Scythe of vitur',item_id:22325},
  {name:'Kodai wand',item_id:21006},{name:'Zaryte bow',item_id:26374},
  {name:'Dragon claws',item_id:13652},{name:'Voidwaker',item_id:27690},
];
let MARKET_CATALOG=[];
let usingDemoMarket=false;
let selectedItem=null, selectedItemId=null, selectedTf='1D';
let currentSales=[]; // sale rows for the selected item, newest-first, as returned by the API
// Item ids bumped to the top of the market item list because a new
// listing event came in for them (see wardenOnMarketListing below).
// Mirrors the server-side scan-priority bump in market_poller.py.
const priorityItemIds=new Set();
let renderMarketList=null; // set inside initMarket, called externally when priority changes
// Listings seen for tracked accounts, grouped by account name, for the
// Profile page's "Current Market Listings" panel.
const accountListings={}; // { accountName: [ {item_name,item_id,price_gp,sale_time}, ... ] }
function itemColor(name){ const rnd=seededRand(name); const hue=Math.floor(rnd()*360); return `hsl(${hue},55%,52%)`; }
function formatGp(v){
  const n=Number(v)||0, a=Math.abs(n);
  if(a>=1e9) return (n/1e9).toFixed(2)+'B';
  if(a>=1e6) return (n/1e6).toFixed(1)+'M';
  if(a>=1e3) return (n/1e3).toFixed(1)+'K';
  return Math.round(n).toString();
}
function parseSaleTime(t){
  if(!t) return new Date();
  const d=new Date(String(t).replace(' ','T'));
  return isNaN(d.getTime()) ? new Date() : d;
}
async function initMarket(){
  const api=window.pywebview && window.pywebview.api;
  if(api && typeof api.get_market_items==='function'){
    try{
      const items=await api.get_market_items();
      if(items && items.length) MARKET_CATALOG=items;
    }catch(err){ console.error('Failed to load market catalog',err); }
  }
  if(!MARKET_CATALOG.length){ MARKET_CATALOG=DEMO_MARKET_ITEMS; usingDemoMarket=true; }

  const list=document.getElementById('itemList');
  function renderList(filter){
    list.innerHTML='';
    const matches=MARKET_CATALOG.filter(it=>it.name.toLowerCase().includes(filter.toLowerCase()));
    // Priority items (fresh listings from a tracked account) sort first
    // so they're immediately visible without the user having to search.
    matches.sort((a,b)=>{
      const pa=priorityItemIds.has(a.item_id)?1:0, pb=priorityItemIds.has(b.item_id)?1:0;
      if(pa!==pb) return pb-pa;
      return 0;
    });
    matches.slice(0,300).forEach(it=>{
      const isPriority=priorityItemIds.has(it.item_id);
      const row=document.createElement('div'); row.className='item-row'+(selectedItemId===it.item_id?' active':'')+(isPriority?' priority':'');
      row.innerHTML=`<div class="icon" style="background:${itemColor(it.name)}">${it.name.slice(0,2).toUpperCase()}</div><div class="info"><div class="nm">${it.name}${isPriority?' <span style="color:var(--blood);font-size:9px;">● NEW LISTING</span>':''}</div><div class="cat">#${it.item_id}</div></div>`;
      row.addEventListener('click',()=>{ selectedItemId=it.item_id; priorityItemIds.delete(it.item_id); renderList(document.getElementById('itemSearch').value); selectItem(it); });
      list.appendChild(row);
    });
  }
  renderMarketList=()=>renderList(document.getElementById('itemSearch').value);
  document.getElementById('itemSearch').addEventListener('input',(e)=>renderList(e.target.value));
  renderList('');
  document.querySelectorAll('.tf-chip').forEach(chip=>{
    chip.addEventListener('click',()=>{ document.querySelectorAll('.tf-chip').forEach(c=>c.classList.remove('active')); chip.classList.add('active'); selectedTf=chip.dataset.tf; renderChart(); renderDetailStats(); });
  });
  if(MARKET_CATALOG.length){ selectedItemId=MARKET_CATALOG[0].item_id; renderList(''); await selectItem(MARKET_CATALOG[0]); }
}
async function selectItem(it){
  selectedItem=it.name; selectedItemId=it.item_id;
  document.getElementById('detIcon').textContent=it.name.slice(0,2).toUpperCase();
  document.getElementById('detIcon').style.background=itemColor(it.name);
  document.getElementById('detName').textContent=it.name;
  document.getElementById('detCat').textContent='#'+it.item_id;

  currentSales=[];
  const api=window.pywebview && window.pywebview.api;
  if(!usingDemoMarket && api && typeof api.get_market_sales==='function'){
    try{ currentSales=await api.get_market_sales(it.item_id, null, 300) || []; }
    catch(err){ console.error('Failed to load market sales',err); }
  }
  renderDetailStats();
  renderChart();
  renderSales();
}
function salesInTimeframe(tf){
  if(tf==='ALL') return currentSales;
  const spanMs = tf==='1D'?86400000 : tf==='7D'?7*86400000 : 30*86400000;
  const cutoff=Date.now()-spanMs;
  return currentSales.filter(s=>parseSaleTime(s.sale_time).getTime()>=cutoff);
}
function renderDetailStats(){
  const priceEl=document.getElementById('detPrice'), deltaEl=document.getElementById('detDelta');
  if(!currentSales.length){
    priceEl.textContent = usingDemoMarket ? '—' : 'No sales yet';
    deltaEl.textContent=''; deltaEl.className='d';
    return;
  }
  const latest=currentSales[0]; // API returns newest-first
  priceEl.textContent=formatGp(latest.price_gp)+' gp';
  const windowSales=salesInTimeframe(selectedTf);
  const oldest=windowSales.length ? windowSales[windowSales.length-1] : currentSales[currentSales.length-1];
  const delta = oldest && oldest.price_gp ? ((latest.price_gp-oldest.price_gp)/oldest.price_gp*100) : 0;
  deltaEl.textContent=(delta>=0?'▲ +':'▼ ')+Math.abs(delta).toFixed(1)+'% ('+selectedTf+')';
  deltaEl.className='d '+(delta>=0?'up':'down');
}
function generateDemoSeries(name,tf){
  const points = tf==='1D'?24: tf==='7D'?7*4: tf==='30D'?30: 60;
  const rnd=seededRand(name+tf);
  let val=40+rnd()*40;
  const arr=[];
  for(let i=0;i<points;i++){ val += (rnd()-0.5)*val*0.06; val=Math.max(4,val); arr.push(val); }
  return arr;
}
function renderChart(){
  const svg=document.getElementById('chartSvg');
  let series;
  if(usingDemoMarket){
    series=generateDemoSeries(selectedItem||'item', selectedTf);
  }else{
    const windowSales=salesInTimeframe(selectedTf).slice().sort((a,b)=>parseSaleTime(a.sale_time)-parseSaleTime(b.sale_time));
    series=windowSales.map(s=>s.price_gp);
  }
  if(series.length<2){
    svg.innerHTML=`<text x="300" y="84" text-anchor="middle" fill="var(--steel-dim)" font-size="11">Not enough sale history yet</text>`;
    return;
  }
  const w=600,h=160,pad=8;
  const min=Math.min(...series), max=Math.max(...series);
  const range=(max-min)||1;
  const stepX=(w-pad*2)/(series.length-1);
  let d='M';
  series.forEach((v,i)=>{ const x=pad+i*stepX; const y=pad+(1-(v-min)/range)*(h-pad*2); d+=(i===0?'':'L')+x.toFixed(1)+','+y.toFixed(1)+' '; });
  let dFill=d+`L${(w-pad).toFixed(1)},${(h-pad).toFixed(1)} L${pad},${(h-pad).toFixed(1)} Z`;
  svg.innerHTML=`
    <g class="chart-grid">
      <line x1="0" y1="${h*0.25}" x2="${w}" y2="${h*0.25}"/>
      <line x1="0" y1="${h*0.5}" x2="${w}" y2="${h*0.5}"/>
      <line x1="0" y1="${h*0.75}" x2="${w}" y2="${h*0.75}"/>
    </g>
    <path class="chart-fill" d="${dFill}" fill="var(--blood)"/>
    <path class="chart-path" d="${d}" stroke-dasharray="1000" stroke-dashoffset="1000"/>
  `;
  const path=svg.querySelector('.chart-path');
  requestAnimationFrame(()=>{ path.style.transition='stroke-dashoffset 1s ease'; path.style.strokeDashoffset='0'; });
}
function renderSales(){
  const body=document.getElementById('salesBody'); body.innerHTML='';
  if(usingDemoMarket){
    const rnd=seededRand((selectedItem||'item')+'sales');
    const names=['Nightshade','Zezima OG','M1llionz','Abra Kadabra','Sosa Savage','Ruthless99'];
    const rows=5+Math.floor(rnd()*3);
    for(let i=0;i<rows;i++){
      const seller=names[Math.floor(rnd()*names.length)];
      let buyer=names[Math.floor(rnd()*names.length)];
      while(buyer===seller) buyer=names[Math.floor(rnd()*names.length)];
      const time=new Date(Date.now()-i*1800000).toTimeString().slice(0,8);
      const tr=document.createElement('tr');
      tr.innerHTML=`<td>${time}</td><td>${seller}</td><td>${buyer}</td><td>1</td><td class="c-amber">${formatGp((10+rnd()*70)*1e6)}</td>`;
      body.appendChild(tr);
    }
    return;
  }
  if(!currentSales.length){
    body.innerHTML='<tr><td colspan="5" style="color:var(--steel-dim);">No sales recorded yet</td></tr>';
    return;
  }
  currentSales.slice(0,25).forEach(s=>{
    const isMine = s.seller===PRIMARY_USER || s.buyer===PRIMARY_USER;
    const tr=document.createElement('tr'); if(isMine) tr.classList.add('mine');
    const t=parseSaleTime(s.sale_time).toTimeString().slice(0,8);
    tr.innerHTML=`<td>${t}</td><td>${s.seller||'—'}</td><td>${s.buyer||'—'}</td><td>${s.amount||1}</td><td class="c-amber">${formatGp(s.price_gp)}</td>`;
    body.appendChild(tr);
  });
}
/* main.py forwards market_sale_new broadcasts here (see sync/client.py
   + market_poller.py on the server) -- merge in new sales for whichever
   item is currently open, ignore everything else. */
function wardenOnMarketSale(event){
  if(usingDemoMarket || !event || event.item_id!==selectedItemId) return;
  const known=new Set(currentSales.map(s=>s.id));
  const fresh=(event.records||[]).filter(r=>!known.has(r.id));
  if(!fresh.length) return;
  currentSales=fresh.concat(currentSales).sort((a,b)=>parseSaleTime(b.sale_time)-parseSaleTime(a.sale_time));
  renderDetailStats(); renderChart(); renderSales();
}
window.wardenOnMarketSale=wardenOnMarketSale;

/* main.py forwards market_listing_new broadcasts here (see
   server/market_poller.py's _flag_tracked_listings +
   server/app.py's POST /market/track) -- fires when one of *our*
   tracked accounts (primary username + watchlist) shows up as the
   seller on a fresh trading-post record. We treat that as "a new
   listing for a user": bump the item to the top of the Market page's
   item list, and file it under that account on the Profile page. */
function wardenOnMarketListing(event){
  if(!event || !event.item_id) return;
  priorityItemIds.add(event.item_id);
  if(typeof renderMarketList==='function') renderMarketList();
  if(selectedItemId===event.item_id){
    // Already looking at this item -- merge the fresh record in too,
    // same as a normal sale update would.
    wardenOnMarketSale({type:'market_sale_new', item_id:event.item_id, records:[event.record]});
  }

  const account=event.account || 'Unknown';
  if(!accountListings[account]) accountListings[account]=[];
  const rec=event.record||{};
  accountListings[account]=accountListings[account].filter(l=>l.item_id!==event.item_id || l.sale_time!==rec.sale_time);
  accountListings[account].unshift({item_id:event.item_id, item_name:event.item_name, price_gp:rec.price_gp, sale_time:rec.sale_time});
  accountListings[account]=accountListings[account].slice(0,20);
  renderProfileListings();
}
window.wardenOnMarketListing=wardenOnMarketListing;

function renderProfileListings(){
  const el=document.getElementById('profileListings');
  if(!el) return;
  const accounts=Object.keys(accountListings).filter(a=>accountListings[a].length);
  if(!accounts.length){
    el.innerHTML='<div style="padding:12px 16px;color:var(--steel-dim);font-size:11px;">No listings seen yet.</div>';
    return;
  }
  el.innerHTML='';
  accounts.forEach(account=>{
    const group=document.createElement('div'); group.className='listing-account-group';
    const head=document.createElement('div'); head.className='listing-account-head'; head.textContent=account;
    group.appendChild(head);
    accountListings[account].forEach(l=>{
      const row=document.createElement('div');
      row.className='listing-row'+(priorityItemIds.has(l.item_id)?' priority':'');
      const t=l.sale_time?parseSaleTime(l.sale_time).toTimeString().slice(0,8):'';
      row.innerHTML=`<span class="li-item">${escapeHtml(l.item_name||('#'+l.item_id))}</span><span class="li-price">${formatGp(l.price_gp)} gp</span><span>${t}</span>`;
      group.appendChild(row);
    });
    el.appendChild(group);
  });
}