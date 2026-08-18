/* ===== SPLASH / INJECTION BOOTSTRAP ===== */
const statusEl = document.getElementById('splashStatus');
const detailEl = document.getElementById('splashDetail');
const progressEl = document.getElementById('splashProgress');

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function splashStep(status, detail, progress, kind = '') {
    statusEl.textContent = status;
    statusEl.className = 'splash-status' + (kind ? ' ' + kind : '');
    detailEl.textContent = detail || '';
    progressEl.style.width = Math.max(0, Math.min(100, progress)) + '%';
}

function waitForPywebviewBridge(timeoutMs = 3500) {
    if (window.pywebview && window.pywebview.api) return Promise.resolve(window.pywebview.api);
    return new Promise(resolve => {
        let done = false;
        const finish = api => {
            if (done) return;
            done = true;
            resolve(api || null);
        };
        window.addEventListener('pywebviewready', () => finish(window.pywebview?.api || null), {
            once: true
        });
        setTimeout(() => finish(null), timeoutMs);
    });
}
async function runInjectionBootstrap() {
    splashStep('Initializing Warden…', 'Starting the local injection supervisor', 8);
    await sleep(220);
    const api = await waitForPywebviewBridge();
    if (!api || typeof api.prepare_injection !== 'function') {
        splashStep('Desktop bridge not detected', 'Preview mode — injection is only executed by the desktop host', 35);
        await sleep(260);
        splashStep('Ready.', 'Desktop host will run injection before starting the watcher', 100, 'ok');
        await sleep(420);
        return {
            ok: true,
            preview: true
        };
    }
    try {
        splashStep('Scanning JVM processes…', 'Checking whether SpawnPK launcher/client files are locked', 20);
        const result = await api.prepare_injection();
        const launcher = result?.launcher || {};
        const client = result?.client || {};
        splashStep('Checking game files…', `${launcher.path || 'SpawnPK launcher'} · ${launcher.status || 'verified'}`, 50);
        await sleep(120);
        splashStep('Verifying game client…', `${client.path || '.spawnpk-data/client.jar'} · ${client.status || 'verified'}`, 72);
        await sleep(120);
        if (result?.ok) {
            splashStep('Injection ready', result.message || 'Launcher and client hooks are installed', 100, 'ok');
            await sleep(380);
            return result;
        }
        splashStep('Injection unavailable', result?.error || 'Close any running SpawnPK JVM and retry setup', 100, 'error');
        await sleep(900);
        return result;
    } catch (err) {
        splashStep('Injection failed', err?.message || 'The local injection supervisor returned an error', 100, 'error');
        await sleep(900);
        return {
            ok: false,
            error: String(err)
        };
    }
}
runInjectionBootstrap().finally(async () => {
    document.getElementById('splash').classList.add('out');
    setTimeout(async () => {
        document.getElementById('splash').style.display = 'none';
        const resumed = await tryResumeSession();
        if (!resumed) document.getElementById('wizard').classList.add('show');
    }, 600);
});

/* ===== WIZARD LOGIC ===== */
let wizStep = 1;
const totalSteps = 3;
const wizTitles = {
    1: ["Welcome to Warden", "Your companion tool for SpawnPK — track drops, PK timers, and market sales in real time."],
    2: ["Who's playing?", "Warden personalizes alerts and stats around your main account."],
    3: ["Make it yours", "Pick an accent and set your alert preferences. You can change these anytime."]
};

function renderWizard() {
    document.querySelectorAll('.wiz-step').forEach(s => s.classList.toggle('active', +s.dataset.step === wizStep));
    document.querySelectorAll('.wiz-steps i').forEach(i => {
        const n = +i.dataset.s;
        i.classList.toggle('active', n === wizStep);
        i.classList.toggle('done', n < wizStep);
    });
    document.getElementById('wizTitle').textContent = wizTitles[wizStep][0];
    document.getElementById('wizSub').textContent = wizTitles[wizStep][1];
    document.getElementById('wizBack').style.visibility = wizStep === 1 ? 'hidden' : 'visible';
    document.getElementById('wizNext').textContent = wizStep === 1 ? 'Get Started' : (wizStep === totalSteps ? 'Finish Setup' : 'Continue');
}
renderWizard();
document.getElementById('wizNext').addEventListener('click', () => {
    if (wizStep === 2) {
        const uname = document.getElementById('wizUsername').value.trim();
        if (!uname) {
            document.getElementById('wizUsername').style.borderColor = 'var(--blood)';
            document.getElementById('wizUsername').focus();
            return;
        }
    }
    if (wizStep < totalSteps) {
        wizStep++;
        renderWizard();
        return;
    }
    finishSetup();
});
document.getElementById('wizBack').addEventListener('click', () => {
    if (wizStep > 1) {
        wizStep--;
        renderWizard();
    }
});
document.querySelectorAll('#wizard .swatch').forEach(sw => {
    sw.addEventListener('click', () => {
        document.querySelectorAll('#wizard .swatch').forEach(s => s.classList.remove('selected'));
        sw.classList.add('selected');
        document.documentElement.style.setProperty('--blood', sw.dataset.c);
        document.documentElement.style.setProperty('--blood-glow', sw.dataset.g);
        document.querySelectorAll('#settingsSwatches .swatch').forEach(s2 => s2.classList.toggle('selected', s2.dataset.c === sw.dataset.c));
    });
});
document.querySelector('#wizard .switch').addEventListener('click', function() {
    this.classList.toggle('on');
});

let PRIMARY_USER = 'Player';

function applyUser(name) {
    PRIMARY_USER = name || 'Player';
    document.getElementById('userName').textContent = PRIMARY_USER;
    document.getElementById('userAv').textContent = PRIMARY_USER.slice(0, 2).toUpperCase();
    document.getElementById('settingsUsername').value = PRIMARY_USER;
}

function showApp() {
    document.getElementById('wizard').classList.remove('show');
    const app = document.getElementById('app');
    app.hidden = false;
    requestAnimationFrame(() => app.classList.add('show'));
    initApp();
}
async function finishSetup() {
    const uname = document.getElementById('wizUsername').value.trim() || 'Player';
    const accentSwatch = document.querySelector('#wizard .swatch.selected');
    const accent = accentSwatch?.dataset.c || getComputedStyle(document.documentElement).getPropertyValue('--blood').trim();
    const glow = accentSwatch?.dataset.g || getComputedStyle(document.documentElement).getPropertyValue('--blood-glow').trim();
    applyUser(uname);
    const api = window.pywebview && window.pywebview.api;
    if (api && typeof api.complete_onboarding === 'function') {
        try {
            await api.complete_onboarding(uname, accent, glow);
        } catch (err) {
            console.error('Failed to persist onboarding', err);
        }
    }
    showApp();
}
/* Skip the wizard on repeat launches if setup was already completed */
async function tryResumeSession() {
    const api = window.pywebview && window.pywebview.api;
    if (!api || typeof api.get_config !== 'function') return false;
    try {
        const cfg = await api.get_config();
        if (cfg && cfg.onboarding_complete && cfg.username) {
            applyUser(cfg.username);
            if (cfg.theme_accent) document.documentElement.style.setProperty('--blood', cfg.theme_accent);
            if (cfg.theme_glow) document.documentElement.style.setProperty('--blood-glow', cfg.theme_glow);
            showApp();
            return true;
        }
    } catch (err) {
        console.error('Failed to load config', err);
    }
    return false;
}

/* ===== PAGE TRANSITION ENGINE ===== */
function triggerLoadbar() {
    const bar = document.getElementById('loadbar');
    bar.style.transition = 'none';
    bar.style.width = '0%';
    bar.style.opacity = '1';
    requestAnimationFrame(() => {
        bar.style.transition = 'width .35s ease';
        bar.style.width = '70%';
    });
    setTimeout(() => {
        bar.style.width = '100%';
        setTimeout(() => {
            bar.style.opacity = '0';
        }, 200);
    }, 320);
}

function staggerChildren(pageEl) {
    const kids = Array.from(pageEl.children);
    kids.forEach(k => {
        k.style.transition = 'none';
        k.style.opacity = '0';
        k.style.transform = 'translateY(10px)';
    });
    requestAnimationFrame(() => {
        kids.forEach((k, i) => {
            k.style.transition = 'opacity .4s ease, transform .4s ease';
            k.style.transitionDelay = (i * 0.06) + 's';
            k.style.opacity = '1';
            k.style.transform = 'translateY(0)';
        });
    });
}

function goToPage(p) {
    const current = document.querySelector('.nav-item.active')?.dataset.page;
    if (current === p) return;
    triggerLoadbar();
    document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.page === p));
    const mainEl = document.getElementById('main');
    const oldPage = document.querySelector('.page.active');
    const newPage = document.querySelector(`.page[data-page="${p}"]`);
    if (oldPage) oldPage.classList.add('leaving');
    setTimeout(() => {
        if (oldPage) {
            oldPage.classList.remove('active', 'leaving');
        }
        newPage.classList.add('active');
        mainEl.scrollTop = 0;
        staggerChildren(newPage);
    }, 150);
    if (p === 'settings') {
        pollApiStats();
        pollSpawnpkStatus();
    }
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
function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    } [c]));
}
/* Defense-in-depth: the server sanitizes fields on ingest now (see
   server/chat_parser.py sanitize_fields), but events already cached
   locally before that shipped -- or a server not yet upgraded --
   could still carry raw RuneLite formatting (<col=..>, @gre@..@bla@).
   Stripping again here is cheap and idempotent on already-clean text. */
function stripTags(s) {
    if (s == null) return '';
    return String(s).replace(/<[^>]+>/g, '').replace(/@[a-zA-Z0-9]+@/g, '').replace(/[\[\]]/g, '').replace(/\s+/g, ' ').trim();
}

function fieldText(v) {
    return escapeHtml(stripTags(v));
}
const EVENT_TYPE_META = {
    drop: {
        label: 'Drop',
        cls: 't-custom'
    },
    raids_drop: {
        label: 'Raid Drop',
        cls: 't-rare'
    },
    corb_kill: {
        label: 'PK Kill',
        cls: 't-boss'
    },
    event_boss_spawn: {
        label: 'World Boss',
        cls: 't-event'
    },
    // forward-compat with server/README.md's classification list
    enchant: {
        label: 'Enchant',
        cls: 't-custom'
    },
    spawn: {
        label: 'Spawn',
        cls: 't-event'
    },
    world_event: {
        label: 'World Event',
        cls: 't-event'
    },
    killstreak: {
        label: 'Killstreak',
        cls: 't-boss'
    },
    killstreak_ended: {
        label: 'Killstreak Ended',
        cls: 't-boss'
    },
    pk_kill: {
        label: 'PK Kill',
        cls: 't-boss'
    },
    corp_kill: {
        label: 'Corp Kill',
        cls: 't-boss'
    },
    boss_kill: {
        label: 'Boss Kill',
        cls: 't-boss'
    },
    market_sale: {
        label: 'Market Sale',
        cls: 't-custom'
    },
    level_up: {
        label: 'Level Up',
        cls: 't-custom'
    },
};

function describeEvent(type, f) {
    switch (type) {
        case 'drop':
        case 'raids_drop': {
            const qty = f.quantity && f.quantity > 1 ? ('x' + f.quantity + ' ') : '';
            const kc = f.kill_count ? ` (${fieldText(f.kill_count)} KC)` : '';
            const itemName = fieldText(f.item) || 'item';
            return `<b>${fieldText(f.player)||'Unknown'}</b> received ${ItemImages.icon(itemName, 18)} <span class="item-name">${qty}${itemName}</span> from ${fieldText(f.source)||'unknown source'}${kc}`;
        }
        case 'corb_kill': {
            const itemName = fieldText(f.item) || 'loot';
            return `<b>${fieldText(f.killer)||'Unknown'}</b> defeated <b>${fieldText(f.victim)||'someone'}</b> for ${ItemImages.icon(itemName, 18)} <span class="item-name">${itemName}</span>`;
        }
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
let ALL_EVENTS = [];
async function loadAllEvents() {
    const api = window.pywebview && window.pywebview.api;
    if (!api || typeof api.get_recent_events !== 'function') return false;
    try {
        const events = await api.get_recent_events(null, 150);
        if (!events || !events.length) return false;
        ALL_EVENTS = events;
        return true;
    } catch (err) {
        console.error('Failed to load recent events', err);
        return false;
    }
}

function upsertEvent(ev) {
    if (!ev) return;
    if (ev.content_hash) {
        const idx = ALL_EVENTS.findIndex(e => e.content_hash === ev.content_hash);
        if (idx !== -1) {
            ALL_EVENTS[idx] = ev;
            return;
        }
    }
    ALL_EVENTS.unshift(ev);
    if (ALL_EVENTS.length > 300) ALL_EVENTS.length = 300;
}

function buildFeedItemNode(event) {
    if (!event || event.event_type === 'chat_unclassified') return null;
    const type = event.event_type;
    const f = event.fields || {};
    const meta = EVENT_TYPE_META[type] || {
        label: type || 'Event',
        cls: 't-custom'
    };
    const timeSrc = event.observed_at || event.first_seen_at || event.created_at;
    const t = timeSrc ? new Date(timeSrc) : new Date();
    const time = isNaN(t.getTime()) ? new Date().toTimeString().slice(0, 8) : t.toTimeString().slice(0, 8);
    const confirmations = event.confirmations || 0;
    const src = confirmations > 1 ? ('&times;' + confirmations + ' confirmed') : 'live';
    const div = document.createElement('div');
    div.className = 'feed-item ' + meta.cls;
    div.innerHTML = `<div class="time">${time}</div><div><div class="type">${meta.label}</div><div class="desc">${describeEvent(type,f)}</div></div><div class="src">${src}</div>`;
    return div;
}

function renderKpis() {
    const drops = document.getElementById('kpiDrops'),
        alerts = document.getElementById('kpiAlerts'),
        rare = document.getElementById('kpiRare'),
        sales = document.getElementById('kpiSales');
    if (!drops) return;
    let dropsN = 0,
        alertsN = 0,
        rareN = 0,
        salesN = 0;
    ALL_EVENTS.forEach(ev => {
        const type = ev.event_type;
        if (type === 'drop' || type === 'raids_drop') dropsN++;
        if (type === 'market_sale') salesN++;
        const meta = EVENT_TYPE_META[type];
        if (meta && (meta.cls === 't-rare')) {
            rareN++;
            alertsN++;
        } else if (meta && meta.cls === 't-boss') {
            alertsN++;
        }
    });
    drops.textContent = dropsN;
    alerts.textContent = alertsN;
    rare.textContent = rareN;
    sales.textContent = salesN;
}

function wardenOnServerEvent(event) {
    upsertEvent(event);
    debugLog('MATCH', (event.event_type || 'event') + ' classified from chat');
    const feed = document.getElementById('feed');
    const node = feed ? buildFeedItemNode(event) : null;
    if (feed && node) {
        node.classList.add('new');
        feed.insertBefore(node, feed.firstChild);
        document.querySelectorAll('#feed .feed-item.new').forEach((el, idx) => {
            if (idx > 0) el.classList.remove('new');
        });
        if (feed.children.length > 9) feed.removeChild(feed.lastChild);
    }
    renderKpis();
    renderDashboardDrops();
    if (typeof renderDropsPage === 'function') {
        populateDropsSourceOptions();
        renderDropsPage();
    }
    if (typeof renderProfileFeed === 'function') {
        renderProfileFeed();
        renderWatchStats();
    }
}
window.wardenOnServerEvent = wardenOnServerEvent;

/* Initial page-load population of #feed (and everything else that
   reads ALL_EVENTS) from real recent events (local cache, backfilled
   from the central server on startup -- see main.py). If the API
   isn't available, the offline overlay (wardenSetApiStatus) blocks
   the app before this data emptiness would ever be visible -- no
   demo/mock fallback is used here. */
async function loadInitialFeed() {
    const loaded = await loadAllEvents();
    const feed = document.getElementById('feed');
    if (feed && loaded) {
        const nodes = ALL_EVENTS.slice(0, 12).map(buildFeedItemNode).filter(Boolean);
        if (nodes.length) {
            feed.innerHTML = '';
            nodes.forEach(n => feed.appendChild(n));
        }
    }
    renderKpis();
    renderDashboardDrops();
    if (typeof populateDropsSourceOptions === 'function') {
        populateDropsSourceOptions();
        renderDropsPage();
    }
    if (typeof renderProfileFeed === 'function') {
        renderProfileFeed();
        renderWatchStats();
    }
    return loaded && ALL_EVENTS.length > 0;
}

/* ===== DROPS (dashboard panel + full Drops page) ===== */
const DROP_TYPES = ['drop', 'raids_drop'];

function isDropEvent(ev) {
    return !!ev && DROP_TYPES.includes(ev.event_type);
}

function dropRowHtml(ev) {
    const f = ev.fields || {};
    const timeSrc = ev.observed_at || ev.first_seen_at || ev.created_at;
    const t = timeSrc ? new Date(timeSrc) : null;
    const time = (t && !isNaN(t.getTime())) ? t.toTimeString().slice(0, 8) : '—';
    const qty = f.quantity && f.quantity > 1 ? ('x' + f.quantity + ' ') : '';
    const itemName = fieldText(f.item) || 'Unknown item';
    const item = ItemImages.icon(itemName, 22) + ` <span>${qty}${itemName}</span>`;
    const player = fieldText(f.player) || 'Unknown';
    const source = fieldText(f.source) || (ev.event_type === 'raids_drop' ? 'Raid' : '—');
    // No per-drop valuation data is wired up yet (drops don't carry an
    // item id to join against market sales) -- showing a real number
    // here would mean making one up, so it's an honest "—" for now.
    return `<tr><td>${time}</td><td>${player}</td><td style="display:flex;align-items:center;gap:8px;">${item}</td><td style="color:var(--steel-dim);">—</td><td>${source}</td></tr>`;
}

function renderDashboardDrops() {
    const body = document.getElementById('dashDropsBody');
    if (!body) return;
    const rows = ALL_EVENTS.filter(isDropEvent).slice(0, 6);
    body.innerHTML = rows.length ? rows.map(dropRowHtml).join('') : '<tr><td colspan="5" style="color:var(--steel-dim);">No drops recorded yet</td></tr>';
}

function populateDropsSourceOptions() {
    const sel = document.getElementById('dropsSourceSelect');
    if (!sel) return;
    const current = sel.value;
    const sources = [...new Set(ALL_EVENTS.filter(isDropEvent).map(e => fieldText((e.fields || {}).source)).filter(Boolean))].sort();
    sel.innerHTML = '<option value="">All Sources</option>' + sources.map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('');
    if (sources.includes(current)) sel.value = current;
}

function renderDropsPage() {
    const body = document.getElementById('dropsPageBody');
    if (!body) return;
    const q = (document.getElementById('dropsSearchInput')?.value || '').trim().toLowerCase();
    const src = document.getElementById('dropsSourceSelect')?.value || '';
    const typ = document.getElementById('dropsTypeSelect')?.value || '';
    let rows = ALL_EVENTS.filter(isDropEvent);
    if (typ) rows = rows.filter(e => e.event_type === typ);
    if (src) rows = rows.filter(e => fieldText((e.fields || {}).source) === src);
    if (q) rows = rows.filter(e => fieldText((e.fields || {}).player).toLowerCase().includes(q));
    rows = rows.slice(0, 80);
    body.innerHTML = rows.length ? rows.map(dropRowHtml).join('') : '<tr><td colspan="5" style="color:var(--steel-dim);">No drops match these filters</td></tr>';
}

function initDropsPage() {
    populateDropsSourceOptions();
    renderDropsPage();
    document.getElementById('dropsFilterBtn')?.addEventListener('click', renderDropsPage);
    document.getElementById('dropsSearchInput')?.addEventListener('keydown', e => {
        if (e.key === 'Enter') renderDropsPage();
    });
    document.getElementById('dropsSourceSelect')?.addEventListener('change', renderDropsPage);
    document.getElementById('dropsTypeSelect')?.addEventListener('change', renderDropsPage);
    document.getElementById('dashDropsViewAll')?.addEventListener('click', () => goToPage('drops'));
}

function pollSyncStatus() {
    const api = window.pywebview && window.pywebview.api;
    const dot = document.getElementById('apiSyncDot');
    const label = document.getElementById('apiSyncLabel');
    if (!api || typeof api.get_sync_status !== 'function') return;
    api.get_sync_status().then(status => {
        applySyncStatus(status);
    }).catch(() => {});
}

function applySyncStatus(status) {
    const dot = document.getElementById('apiSyncDot');
    const label = document.getElementById('apiSyncLabel');
    const connected = !!(status && status.connected);
    if (typeof applySyncStatus._last !== 'undefined' && applySyncStatus._last !== connected) {
        debugLog(connected ? 'OK' : 'WARN', connected ? 'Central API connected' : 'Central API connection lost');
    }
    applySyncStatus._last = connected;
    if (dot && label) {
        if (connected) {
            label.textContent = 'API Synced';
            dot.style.background = 'var(--toxic)';
            dot.style.boxShadow = '0 0 8px var(--toxic)';
        } else {
            label.textContent = 'API Offline';
            dot.style.background = 'var(--steel-dim)';
            dot.style.boxShadow = 'none';
        }
    }
    setApiOfflineOverlay(!connected, status);
    updateDebugStatusCards(status);
}

/* ===== API OFFLINE OVERLAY =====
   Blocks the app with a splash-style screen whenever the WS connection
   to the central server isn't live -- no mock/demo data is shown as a
   substitute. Driven by: (1) main.py pushing wardenSetApiStatus(bool)
   the instant ServerSyncClient's connection state flips, and (2) the
   pollSyncStatus() fallback poll every 15s in case that push is missed. */
let apiEverConnected = false;

function setApiOfflineOverlay(offline, status) {
    const overlay = document.getElementById('apiOfflineOverlay');
    if (!overlay) return;
    if (!offline) {
        apiEverConnected = true;
    }
    overlay.classList.toggle('hidden', !offline);
    const detail = document.getElementById('offlineDetail');
    if (detail) {
        if (status && status.configured === false) {
            detail.textContent = 'No Central API endpoint is configured yet. Set one in Settings.';
        } else {
            detail.textContent = 'Retrying automatically. Check your Central API settings if this persists.';
        }
    }
}
window.wardenSetApiStatus = function(connected) {
    applySyncStatus({
        connected
    });
    // Also refresh the underlying get_sync_status() shape (configured/
    // endpoint) so the overlay's messaging stays accurate.
    pollSyncStatus();
};

function initApiStatusOverlay() {
    document.getElementById('offlineRetryBtn')?.addEventListener('click', () => pollSyncStatus());
    document.getElementById('offlineSettingsBtn')?.addEventListener('click', () => {
        setApiOfflineOverlay(false);
        goToPage('settings');
    });
    pollSyncStatus();
}

/* ===== SETTINGS PAGE: Central API live stats =====
   Replaces the raw endpoint URL as the main thing shown on the
   Central API card -- the URL fields still exist (behind "Configure
   Endpoint") but the panel itself now surfaces what actually matters
   day to day: is the server healthy, how long has it been up, how
   fast does it respond, how many clients/events is it carrying.
   Backed by Api.get_server_stats() -> GET /health, which the server
   itself caches for a few seconds. On top of that we only poll here
   while the Settings page is actually open, and no more than once
   per API_STATS_POLL_MS, so this never turns into a tight loop. */
const API_STATS_POLL_MS = 20000;
let _apiStatsTimer = null;

function formatUptime(seconds) {
    if (seconds == null || isNaN(seconds)) return '—';
    seconds = Math.floor(seconds);
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (d > 0) return `${d}d ${h}h`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
}

function renderApiStats(stats) {
    const healthEl = document.getElementById('apiStatHealth');
    const uptimeEl = document.getElementById('apiStatUptime');
    const pingEl = document.getElementById('apiStatPing');
    const clientsEl = document.getElementById('apiStatClients');
    const eventsEl = document.getElementById('apiStatEvents');
    const marketEl = document.getElementById('apiStatMarket');
    const updatedEl = document.getElementById('apiStatsUpdated');
    if (!healthEl) return;

    const ok = !!(stats && stats.ok);
    healthEl.textContent = ok ? 'Healthy' : (stats && stats.configured === false ? 'Not configured' : 'Unreachable');
    healthEl.classList.toggle('ok', ok);
    healthEl.classList.toggle('bad', !ok);

    uptimeEl.textContent = ok ? formatUptime(stats.uptime_seconds) : '—';
    pingEl.textContent = ok && stats.ping_ms != null ? `${stats.ping_ms} ms` : '—';
    clientsEl.textContent = ok && stats.connected_clients != null ? stats.connected_clients : '—';
    eventsEl.textContent = ok && stats.total_stored_events != null ? stats.total_stored_events.toLocaleString() : '—';
    const marketSales = ok && stats.market ? stats.market.total_sales : null;
    marketEl.textContent = marketSales != null ? marketSales.toLocaleString() : '—';

    if (updatedEl) {
        updatedEl.textContent = ok
            ? `Updated ${new Date().toLocaleTimeString()}`
            : (stats && stats.error ? `Last check failed: ${stats.error}` : 'No API endpoint configured');
    }
}

function pollApiStats() {
    const api = window.pywebview && window.pywebview.api;
    if (!api || typeof api.get_server_stats !== 'function') return;
    api.get_server_stats().then(renderApiStats).catch(() => {});
}

function startApiStatsPolling() {
    if (_apiStatsTimer) return;
    pollApiStats();
    pollSpawnpkStatus();
    _apiStatsTimer = setInterval(() => {
        // Only bother hitting the server while the Settings page is
        // actually the one on screen.
        const active = document.querySelector('.page.active')?.dataset.page;
        if (active === 'settings') {
            pollApiStats();
            pollSpawnpkStatus();
        }
    }, API_STATS_POLL_MS);
}

/* ===== SETTINGS PAGE: SpawnPK game server status =====
   Plain TCP reachability + ping against the SpawnPK game port itself
   (43594) -- not something the browser side can do, so this is a
   thin renderer over Api.get_spawnpk_status(), which does the actual
   socket connect on the Python side and throttles itself. */
function renderSpawnpkStatus(status) {
    const servers = (status && status.servers) || [];
    servers.forEach(s => {
        const suffix = s.id === 'live' ? 'Live' : 'Dev';
        const dot = document.getElementById('spawnpkDot' + suffix);
        const state = document.getElementById('spawnpkState' + suffix);
        const ping = document.getElementById('spawnpkPing' + suffix);
        if (!dot) return;
        dot.classList.toggle('online', !!s.online);
        dot.classList.toggle('offline', !s.online);
        if (state) state.textContent = s.online ? 'Online' : 'Offline';
        if (ping) ping.textContent = s.online && s.ping_ms != null ? `${s.ping_ms} ms` : '—';
    });
}

function pollSpawnpkStatus() {
    const api = window.pywebview && window.pywebview.api;
    if (!api || typeof api.get_spawnpk_status !== 'function') return;
    api.get_spawnpk_status().then(renderSpawnpkStatus).catch(() => {});
}

/* ===== LOADOUTS PAGE =====
   Frontend only for now -- lays out the equip-slot + inventory-grid
   editor and a local "Saved Loadouts" list so the interaction model
   is proven out ahead of the real loadout system (share codes,
   server-side storage, in-game import). Swap the marked TODOs for
   real Api calls once that backend exists; the DOM/state shape here
   (EQUIP_SLOTS keys, loadoutState.equipment/inventory) is what a
   save/share payload should mirror. */
const EQUIP_SLOT_IDS = ['head', 'cape', 'neck', 'ammo', 'weapon', 'body', 'shield', 'legs', 'hands', 'feet', 'ring'];
const INVENTORY_SIZE = 28;

const loadoutState = {
    equipment: {},   // slotId -> itemName
    inventory: new Array(INVENTORY_SIZE).fill(null), // itemName | null
};

/* Shared searchable item picker -- backed by MARKET_CATALOG, the same
   item list the Market page searches (server /market/items), so a
   loadout can only reference items that are actually real, tradeable
   items rather than arbitrary free text. Opens as a small popover
   anchored under the clicked slot. */
let _itemPickerEl = null;
function closeItemPicker() {
    if (_itemPickerEl) {
        document.removeEventListener('mousedown', _itemPickerOutsideHandler, true);
        _itemPickerEl.remove();
        _itemPickerEl = null;
    }
}
function _itemPickerOutsideHandler(e) {
    if (_itemPickerEl && !_itemPickerEl.contains(e.target)) closeItemPicker();
}
function openItemPicker(anchorEl, currentValue, onSelect) {
    closeItemPicker();
    const pop = document.createElement('div');
    pop.className = 'item-picker-pop';
    pop.innerHTML = `<input type="text" class="item-picker-input" list="loadoutItemDatalist" placeholder="Search item…" autocomplete="off">`;
    document.body.appendChild(pop);

    const rect = anchorEl.getBoundingClientRect();
    const popWidth = 232;
    let left = rect.left;
    if (left + popWidth > window.innerWidth - 8) left = window.innerWidth - popWidth - 8;
    pop.style.left = Math.max(8, left) + 'px';
    pop.style.top = (rect.bottom + 6) + 'px';
    _itemPickerEl = pop;

    const input = pop.querySelector('input');
    input.value = currentValue || '';
    input.focus();
    input.select();

    let committed = false;
    function commit() {
        if (committed) return;
        committed = true;
        const val = input.value.trim();
        closeItemPicker();
        if (val) onSelect(val);
    }
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') commit();
        else if (e.key === 'Escape') { committed = true; closeItemPicker(); }
    });
    input.addEventListener('blur', () => setTimeout(commit, 120));
    setTimeout(() => document.addEventListener('mousedown', _itemPickerOutsideHandler, true), 0);
}

function renderEquipSlot(slotId) {
    const el = document.querySelector(`.eq-slot[data-slot="${slotId}"] .eq-slot-inner`);
    if (!el) return;
    const itemName = loadoutState.equipment[slotId];
    if (!itemName) {
        el.classList.remove('filled');
        el.innerHTML = '';
        return;
    }
    el.classList.add('filled');
    el.innerHTML = ItemImages.icon(itemName, 42) + '<span class="eq-remove">✕</span>';
}

function renderInvSlot(idx) {
    const el = document.querySelector(`.inv-slot[data-idx="${idx}"]`);
    if (!el) return;
    const itemName = loadoutState.inventory[idx];
    if (!itemName) {
        el.innerHTML = '';
        return;
    }
    el.innerHTML = ItemImages.icon(itemName, 32) + '<span class="inv-remove">✕</span>';
    updateLoadoutInvCount();
}

function updateLoadoutInvCount() {
    const filled = loadoutState.inventory.filter(Boolean).length;
    const countEl = document.getElementById('loadoutInvCount');
    if (countEl) countEl.textContent = `${filled} / ${INVENTORY_SIZE}`;
}

function initLoadoutsPage() {
    const invGrid = document.getElementById('loadoutInvGrid');
    if (!invGrid) return; // page not present in this build

    for (let i = 0; i < INVENTORY_SIZE; i++) {
        const slot = document.createElement('div');
        slot.className = 'inv-slot';
        slot.dataset.idx = String(i);
        slot.addEventListener('click', (e) => {
            if (e.target.closest('.inv-remove')) {
                loadoutState.inventory[i] = null;
                renderInvSlot(i);
                updateLoadoutInvCount();
                return;
            }
            openItemPicker(slot, loadoutState.inventory[i], (name) => {
                loadoutState.inventory[i] = name;
                renderInvSlot(i);
            });
        });
        invGrid.appendChild(slot);
    }
    updateLoadoutInvCount();

    document.querySelectorAll('.eq-slot').forEach(slotEl => {
        const slotId = slotEl.dataset.slot;
        slotEl.addEventListener('click', (e) => {
            if (e.target.closest('.eq-remove')) {
                delete loadoutState.equipment[slotId];
                renderEquipSlot(slotId);
                return;
            }
            openItemPicker(slotEl, loadoutState.equipment[slotId], (name) => {
                loadoutState.equipment[slotId] = name;
                renderEquipSlot(slotId);
            });
        });
    });

    document.getElementById('loadoutItemSearch')?.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        const name = e.target.value.trim();
        if (!name) return;
        const freeIdx = loadoutState.inventory.findIndex(v => !v);
        if (freeIdx === -1) return;
        loadoutState.inventory[freeIdx] = name;
        renderInvSlot(freeIdx);
        e.target.value = '';
    });

    document.getElementById('loadoutClearBtn')?.addEventListener('click', () => {
        loadoutState.equipment = {};
        loadoutState.inventory.fill(null);
        EQUIP_SLOT_IDS.forEach(renderEquipSlot);
        for (let i = 0; i < INVENTORY_SIZE; i++) renderInvSlot(i);
        updateLoadoutInvCount();
    });

    document.getElementById('loadoutSaveBtn')?.addEventListener('click', () => {
        // TODO: persist via Api (e.g. writing into ~/.spawnpk-data/loadouts,
        // or a Warden-side store) once that system exists. For now this
        // just confirms the click so the button isn't a dead end -- the
        // "My Loadouts" tab will show real saves once wired up.
        window.alert('Saving isn\'t wired up yet — this will write your build to your local loadouts once that system ships.');
    });

    // TODO: wire to a real share-code endpoint. For now these just
    // acknowledge the click so the buttons aren't dead ends.
    document.getElementById('loadoutShareBtn')?.addEventListener('click', () => {
        window.alert('Sharing to the Encyclopedia is coming soon — this will upload your current build for others to search and import.');
    });

    initLoadoutTabs();
    initLoadoutMineTab();
    initLoadoutEncyclopedia();
}

/* ---- sub-tabs (Builder / My Loadouts / Encyclopedia) ---- */
function initLoadoutTabs() {
    const tabs = document.querySelectorAll('.loadout-tab');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const key = tab.dataset.ltab;
            document.querySelectorAll('.loadout-tab').forEach(t => t.classList.toggle('active', t === tab));
            document.querySelectorAll('.loadout-tabpage').forEach(p => p.classList.toggle('active', p.dataset.ltabpage === key));
            if (key === 'mine') loadLocalLoadouts();
        });
    });
}

/* ---- "My Loadouts" -- reads from the SpawnPK client's own
   ~/.spawnpk-data/loadouts folder via Api.get_local_loadouts().
   That system doesn't exist yet, so this renders whatever comes back
   (including an empty list) and falls back to an explanatory note if
   the API call itself isn't available in this build. ---- */
function loadLocalLoadouts() {
    const pathEl = document.getElementById('loadoutLocalPath');
    const wrap = document.getElementById('loadoutLocalCards');
    const api = window.pywebview && window.pywebview.api;
    if (!api || typeof api.get_local_loadouts !== 'function') {
        if (pathEl) pathEl.textContent = '~/.spawnpk-data/loadouts';
        return;
    }
    api.get_local_loadouts().then(res => {
        if (pathEl) pathEl.textContent = (res && res.path) || '~/.spawnpk-data/loadouts';
        const loadouts = (res && res.loadouts) || [];
        if (!wrap) return;
        if (!loadouts.length) {
            wrap.innerHTML = '<div class="loadout-empty-note">No loadouts found yet. Once the game client starts saving them here, they\'ll show up automatically.</div>';
            return;
        }
        wrap.innerHTML = '';
        loadouts.forEach(lo => {
            const items = [...Object.values(lo.equipment || {}), ...(lo.inventory || [])].filter(Boolean);
            const card = document.createElement('div');
            card.className = 'loadout-card';
            card.innerHTML = `<div class="lc-name">${escapeHtml(lo.name)}</div><div class="lc-icons">${items.slice(0, 10).map(n => ItemImages.icon(n, 22)).join('')}</div><div class="lc-meta">${items.length} item${items.length === 1 ? '' : 's'}</div>`;
            card.addEventListener('click', () => {
                loadoutState.equipment = { ...(lo.equipment || {}) };
                loadoutState.inventory = new Array(INVENTORY_SIZE).fill(null).map((_, i) => (lo.inventory || [])[i] || null);
                document.getElementById('loadoutNameInput').value = lo.name;
                EQUIP_SLOT_IDS.forEach(renderEquipSlot);
                for (let i = 0; i < INVENTORY_SIZE; i++) renderInvSlot(i);
                updateLoadoutInvCount();
                document.querySelector('.loadout-tab[data-ltab="builder"]')?.click();
            });
            wrap.appendChild(card);
        });
    }).catch(() => {
        if (wrap) wrap.innerHTML = '<div class="loadout-empty-note">Couldn\'t read local loadouts right now.</div>';
    });
}

/* ---- Encyclopedia -- community browse/search/import. No backend
   yet, so this runs on a small in-memory sample set purely to prove
   out the search/filter/sort/import interaction and the visual
   design. Swap ENCYCLOPEDIA_SAMPLE + the filtering below for a real
   Api.search_encyclopedia_loadouts() call once that service exists;
   the filter/sort logic already operates on the same {name,
   equipment, inventory, author, imports, created_at} shape a real
   API response should use. ---- */
const ENCYCLOPEDIA_SAMPLE = [
    { name: 'Max Melee PK', author: 'Zezima_OG', imports: 482, created_at: '2026-07-22',
      equipment: { head: 'Neitiznot faceguard', cape: 'Infernal cape', neck: 'Amulet of torture', weapon: 'Ghrazi rapier', body: 'Bandos chestplate', shield: 'Avernic defender', legs: 'Bandos tassets', hands: 'Ferocious gloves', feet: 'Primordial boots', ring: 'Berserker ring (i)' },
      inventory: ['Saradomin brew(4)', 'Super restore(4)', 'Karambwan'] },
    { name: 'Zerk Tank Pure', author: 'IronHiro', imports: 311, created_at: '2026-08-01',
      equipment: { head: 'Zerker helm', weapon: 'Dragon dagger(p++)', body: 'Zerker top', legs: 'Zerker skirt', feet: 'Dragon boots', ring: 'Warrior ring' },
      inventory: ['Prayer potion(4)', 'Shark'] },
    { name: 'Voidwaker Rush', author: 'SpawnGoblin', imports: 205, created_at: '2026-08-10',
      equipment: { head: 'Void melee helm', weapon: 'Voidwaker', body: 'Void knight top', legs: 'Void knight robe', hands: 'Void knight gloves', feet: 'Dragon boots' },
      inventory: ['Vengeance', 'Saradomin brew(4)'] },
    { name: 'Full Manta Ranger', author: 'CrossbowKing', imports: 158, created_at: '2026-06-30',
      equipment: { head: 'Armadyl helmet', cape: "Ava's assembler", body: 'Armadyl chestplate', legs: 'Armadyl chainskirt', weapon: 'Toxic blowpipe', ammo: 'Dragon dart', feet: 'Pegasian boots', ring: 'Archers ring (i)' },
      inventory: ['Ranging potion(4)', 'Super restore(4)'] },
    { name: 'Budget Hybrid PK', author: 'RookieRuner', imports: 96, created_at: '2026-08-13',
      equipment: { head: 'Helm of neitiznot', weapon: 'Rune scimitar', body: 'Fighter torso', legs: 'Obsidian platelegs', feet: 'Climbing boots' },
      inventory: ['Super combat potion(4)', 'Karambwan'] },
    { name: 'Ancient Mage Setup', author: 'FrostPixel', imports: 64, created_at: '2026-07-05',
      equipment: { head: "Ahrim's hood", cape: 'Imbued god cape', neck: 'Occult necklace', weapon: 'Kodai wand', body: "Ahrim's robetop", shield: 'Elidinis ward', legs: "Ahrim's robeskirt", ring: 'Seers ring (i)' },
      inventory: ['Saradomin brew(4)', 'Blood rune'] },
];

let encyclopediaImported = new Set();

function encCardHtml(lo, idx) {
    const items = [...Object.values(lo.equipment || {}), ...(lo.inventory || [])].filter(Boolean);
    const imported = encyclopediaImported.has(idx);
    return `
      <div class="enc-card" data-idx="${idx}">
        <div class="enc-card-head">
          <div><div class="enc-card-name">${escapeHtml(lo.name)}</div><div class="enc-card-author">by ${escapeHtml(lo.author)}</div></div>
          <div class="enc-card-badge">${lo.created_at}</div>
        </div>
        <div class="enc-card-icons">${items.slice(0, 9).map(n => ItemImages.icon(n, 26)).join('')}</div>
        <div class="enc-card-foot">
          <div class="enc-card-imports"><b>${lo.imports.toLocaleString()}</b> imports</div>
          <button class="enc-import-btn${imported ? ' imported' : ''}" data-idx="${idx}">${imported ? '✓ Imported' : 'Import'}</button>
        </div>
      </div>`;
}

function renderEncyclopedia(list) {
    const grid = document.getElementById('encyclopediaGrid');
    if (!grid) return;
    if (!list.length) {
        grid.innerHTML = '<div class="encyclopedia-empty">No loadouts match those filters — try broadening your search.</div>';
        return;
    }
    grid.innerHTML = list.map(({ lo, idx }) => encCardHtml(lo, idx)).join('');
    grid.querySelectorAll('.enc-import-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const idx = Number(btn.dataset.idx);
            encyclopediaImported.add(idx);
            btn.classList.add('imported');
            btn.textContent = '✓ Imported';
            // TODO: this is a design placeholder -- once the real
            // Encyclopedia backend exists this should call something
            // like Api.import_encyclopedia_loadout(id) to actually
            // hand it to the game client.
        });
    });
    grid.querySelectorAll('.enc-card').forEach(card => {
        card.addEventListener('click', () => {
            const idx = Number(card.dataset.idx);
            const lo = ENCYCLOPEDIA_SAMPLE[idx];
            if (!lo) return;
            loadoutState.equipment = { ...lo.equipment };
            loadoutState.inventory = new Array(INVENTORY_SIZE).fill(null).map((_, i) => lo.inventory[i] || null);
            document.getElementById('loadoutNameInput').value = lo.name + ' (copy)';
            EQUIP_SLOT_IDS.forEach(renderEquipSlot);
            for (let i = 0; i < INVENTORY_SIZE; i++) renderInvSlot(i);
            updateLoadoutInvCount();
            document.querySelector('.loadout-tab[data-ltab="builder"]')?.click();
        });
    });
}

function applyEncyclopediaFilters() {
    const q = (document.getElementById('encyclopediaSearchInput')?.value || '').trim().toLowerCase();
    const slot = document.getElementById('encyclopediaSlotFilter')?.value || '';
    const itemQ = (document.getElementById('encyclopediaItemFilter')?.value || '').trim().toLowerCase();
    const sort = document.getElementById('encyclopediaSort')?.value || 'popular';

    let list = ENCYCLOPEDIA_SAMPLE.map((lo, idx) => ({ lo, idx }));

    if (q) list = list.filter(({ lo }) => lo.name.toLowerCase().includes(q));
    if (slot) list = list.filter(({ lo }) => !!(lo.equipment && lo.equipment[slot]));
    if (itemQ) {
        list = list.filter(({ lo }) => {
            const all = [...Object.values(lo.equipment || {}), ...(lo.inventory || [])];
            return all.some(n => n && n.toLowerCase().includes(itemQ));
        });
    }

    if (sort === 'popular') list.sort((a, b) => b.lo.imports - a.lo.imports);
    else if (sort === 'recent') list.sort((a, b) => (a.lo.created_at < b.lo.created_at ? 1 : -1));
    else if (sort === 'name') list.sort((a, b) => a.lo.name.localeCompare(b.lo.name));

    renderEncyclopedia(list);
}

function initLoadoutEncyclopedia() {
    const grid = document.getElementById('encyclopediaGrid');
    if (!grid) return;
    applyEncyclopediaFilters();
    let debounceTimer = null;
    const debouncedApply = () => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(applyEncyclopediaFilters, 150);
    };
    document.getElementById('encyclopediaSearchInput')?.addEventListener('input', debouncedApply);
    document.getElementById('encyclopediaItemFilter')?.addEventListener('input', debouncedApply);
    document.getElementById('encyclopediaSlotFilter')?.addEventListener('change', applyEncyclopediaFilters);
    document.getElementById('encyclopediaSort')?.addEventListener('change', applyEncyclopediaFilters);
}

function initLoadoutMineTab() {
    document.getElementById('loadoutRefreshLocalBtn')?.addEventListener('click', loadLocalLoadouts);
}

/* ===== SETTINGS PAGE: Central API + Discord Webhook ===== */
/* ===== DONATE PAGE =====
   Everything shown here comes from the server (GET /donate/info --
   see server/donate.py) rather than being hardcoded client-side, so a
   modified/decompiled build can't be used to redirect donations --
   the client has no path to change what's displayed. Fetched fresh
   each time the page is opened; not cached, since it's low-traffic
   and the whole point is that it stays current. */
function copyToClipboard(text, btnEl) {
    const done = () => {
        if (!btnEl) return;
        const orig = btnEl.textContent;
        btnEl.textContent = '✓ Copied';
        btnEl.classList.add('copied');
        setTimeout(() => {
            btnEl.textContent = orig;
            btnEl.classList.remove('copied');
        }, 1600);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done).catch(() => {
            fallbackCopy(text); done();
        });
    } else {
        fallbackCopy(text); done();
    }
}
function fallbackCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (e) { /* best effort */ }
    ta.remove();
}

function donateRow(label, value) {
    const row = document.createElement('div');
    row.className = 'donate-row';
    row.innerHTML = `<span class="dr-label">${escapeHtml(label)}</span><span class="dr-value">${escapeHtml(value)}</span><button class="dr-copy">Copy</button>`;
    row.querySelector('.dr-copy').addEventListener('click', (e) => copyToClipboard(value, e.target));
    return row;
}

async function initDonatePage() {
    const page = document.querySelector('.page[data-page="donate"]');
    if (!page) return;
    const api = window.pywebview && window.pywebview.api;
    if (!api || typeof api.get_donate_info !== 'function') return;

    let info = null;
    try {
        info = await api.get_donate_info();
    } catch (err) {
        console.error('Failed to load donate info', err);
    }

    if (!info || !info.ok) {
        document.getElementById('donateIntro').textContent = "Couldn't load donation info right now — check your Central API connection.";
        document.getElementById('donateNoBenefitText').textContent = '';
        document.getElementById('donateNoBenefit').style.display = 'none';
        return;
    }

    document.getElementById('donateIntro').textContent = info.intro || 'Warden is free to use, but hosting it isn\'t.';
    document.getElementById('donateNoBenefitText').textContent = info.no_benefit_note ||
        'Donating doesn\'t unlock anything or get you any perks -- it just helps with hosting costs.';

    let anyMethod = false;

    // -- stripe --
    const stripe = info.stripe || {};
    if (stripe.enabled && stripe.payment_link) {
        anyMethod = true;
        const panel = document.getElementById('donateStripePanel');
        document.getElementById('donateStripeLabel').textContent = stripe.label || 'Pay securely with a card, Apple Pay, or Google Pay.';
        document.getElementById('donateStripeBtn').addEventListener('click', () => {
            const api2 = window.pywebview && window.pywebview.api;
            if (api2 && typeof api2.open_external_url === 'function') {
                api2.open_external_url(stripe.payment_link).catch(() => {});
            }
        });
        panel.style.display = '';
    }

    // -- crypto --
    const crypto = (info.crypto || []).filter(c => c && c.address);
    if (crypto.length) {
        anyMethod = true;
        const panel = document.getElementById('donateCryptoPanel');
        const list = document.getElementById('donateCryptoList');
        list.innerHTML = '';
        crypto.forEach(c => {
            const label = c.network ? `${c.label} (${c.network})` : c.label;
            list.appendChild(donateRow(label, c.address));
        });
        panel.style.display = '';
    }

    // -- bank transfer --
    const bank = info.bank_transfer || {};
    const bankFields = [
        ['Account name', bank.account_name],
        ['Sort code', bank.sort_code],
        ['Account number', bank.account_number],
        ['IBAN', bank.iban],
    ].filter(([, v]) => v);
    if (bank.enabled && bankFields.length) {
        anyMethod = true;
        const panel = document.getElementById('donateBankPanel');
        const list = document.getElementById('donateBankList');
        list.innerHTML = '';
        bankFields.forEach(([label, value]) => list.appendChild(donateRow(label, value)));
        document.getElementById('donateBankCountry').textContent = (bank.country || '').toUpperCase();
        document.getElementById('donateBankNote').textContent = bank.reference_note || '';
        panel.style.display = '';
    }

    // -- other links --
    const other = (info.other_links || []).filter(o => o && o.url);
    if (other.length) {
        anyMethod = true;
        const panel = document.getElementById('donateOtherPanel');
        const list = document.getElementById('donateOtherList');
        list.innerHTML = '';
        other.forEach(o => {
            const row = document.createElement('div');
            row.className = 'donate-row';
            row.innerHTML = `<span class="dr-label">${escapeHtml(o.label || 'Link')}</span><span class="dr-value">${escapeHtml(o.url)}</span><button class="dr-copy">Copy</button>`;
            row.querySelector('.dr-copy').addEventListener('click', (e) => copyToClipboard(o.url, e.target));
            list.appendChild(row);
        });
        panel.style.display = '';
    }

    // -- discord contact --
    const discord = info.discord || {};
    const discordHandle = discord.username || discord.id || '';
    if (discordHandle) {
        document.getElementById('donateDiscordName').textContent = discord.username
            ? `@${discord.username}`
            : `Discord ID: ${discord.id}`;
        document.getElementById('donateDiscordNote').textContent = discord.note || 'Reach out any time.';
        document.getElementById('donateDiscordCopyBtn').addEventListener('click', (e) => copyToClipboard(discordHandle, e.target));
    } else {
        document.getElementById('donateDiscordBody').style.display = 'none';
    }

    document.getElementById('donateEmptyNote').style.display = anyMethod ? 'none' : '';
}

function wireSettingsPanel() {
    const api = window.pywebview && window.pywebview.api;

    // Minimum alert value + sound/discord/startup toggles all persist
    // via api.save_config (generic patch endpoint -- see main.py).
    const minAlertEl = document.getElementById('settingsMinAlertValue');
    const soundSw = document.getElementById('soundAlertsSwitch');
    const discordSw = document.getElementById('discordForwardingSwitch');
    const startupSw = document.getElementById('launchOnStartupSwitch');
    const endpointEl = document.getElementById('settingsApiEndpoint');
    const httpBaseEl = document.getElementById('settingsApiHttpBase');
    const webhookEl = document.getElementById('settingsDiscordWebhook');

    if (api && typeof api.get_config === 'function') {
        api.get_config().then(cfg => {
            if (!cfg) return;
            if (minAlertEl && cfg.min_alert_value_m != null) minAlertEl.value = cfg.min_alert_value_m;
            if (soundSw) soundSw.classList.toggle('on', !!cfg.notifications_enabled);
            if (discordSw) discordSw.classList.toggle('on', cfg.discord_forwarding_enabled !== false);
            if (endpointEl) endpointEl.value = cfg.api_endpoint || '';
            if (httpBaseEl) httpBaseEl.value = cfg.api_http_base || '';
            if (webhookEl) webhookEl.value = cfg.discord_webhook || '';
        }).catch(() => {});
    }

    startApiStatsPolling();
    document.getElementById('toggleApiEndpointBtn')?.addEventListener('click', function() {
        const fields = document.getElementById('apiEndpointFields');
        const saveRow = document.getElementById('apiEndpointSaveRow');
        const nowHidden = fields?.classList.toggle('hidden');
        saveRow?.classList.toggle('hidden', nowHidden);
        this.textContent = nowHidden ? 'Configure Endpoint ▾' : 'Configure Endpoint ▴';
    });

    minAlertEl?.addEventListener('change', () => {
        const v = Math.max(0, Number(minAlertEl.value) || 0);
        api?.save_config?.({
            min_alert_value_m: v
        }).catch(err => console.error('Failed to save min alert value', err));
    });
    soundSw?.addEventListener('click', () => {
        soundSw.classList.toggle('on');
        api?.save_config?.({
            notifications_enabled: soundSw.classList.contains('on')
        }).catch(err => console.error('Failed to save notifications_enabled', err));
    });
    discordSw?.addEventListener('click', () => {
        discordSw.classList.toggle('on');
        api?.save_config?.({
            discord_forwarding_enabled: discordSw.classList.contains('on')
        }).catch(err => console.error('Failed to save discord_forwarding_enabled', err));
    });
    startupSw?.addEventListener('click', () => {
        startupSw.classList.toggle('on');
    });

    document.getElementById('saveApiBtn')?.addEventListener('click', async () => {
        const patch = {
            api_endpoint: (endpointEl?.value || '').trim(),
            api_http_base: (httpBaseEl?.value || '').trim()
        };
        try {
            await api?.save_config?.(patch);
            const resEl = document.getElementById('apiTestResult');
            if (resEl) {
                resEl.textContent = 'Saved. Restart Warden to reconnect with the new endpoint.';
                resEl.style.color = 'var(--toxic)';
            }
            pollApiStats();
        } catch (err) {
            console.error('Failed to save API settings', err);
        }
    });
    document.getElementById('testApiBtn')?.addEventListener('click', async function() {
        const resEl = document.getElementById('apiTestResult');
        const orig = this.textContent;
        this.textContent = 'Testing…';
        this.disabled = true;
        try {
            const result = await api?.test_api_connection?.();
            if (resEl) {
                if (result && result.ok) {
                    resEl.textContent = 'Connected ✓';
                    resEl.style.color = 'var(--toxic)';
                } else {
                    resEl.textContent = 'Failed: ' + (result?.error || 'unknown error');
                    resEl.style.color = 'var(--blood)';
                }
            }
        } catch (err) {
            if (resEl) {
                resEl.textContent = 'Failed: ' + err;
                resEl.style.color = 'var(--blood)';
            }
        }
        this.textContent = orig;
        this.disabled = false;
        pollApiStats();
    });

    document.getElementById('testWebhookBtn')?.addEventListener('click', async function() {
        const resEl = document.getElementById('webhookTestResult');
        const orig = this.textContent;
        this.textContent = 'Sending…';
        this.disabled = true;
        try {
            const result = await api?.test_discord_webhook?.((webhookEl?.value || '').trim());
            if (resEl) {
                if (result && result.ok) {
                    resEl.textContent = 'Test message sent ✓';
                    resEl.style.color = 'var(--toxic)';
                } else {
                    resEl.textContent = 'Failed: ' + (result?.error || 'unknown error');
                    resEl.style.color = 'var(--blood)';
                }
            }
        } catch (err) {
            if (resEl) {
                resEl.textContent = 'Failed: ' + err;
                resEl.style.color = 'var(--blood)';
            }
        }
        this.textContent = orig;
        this.disabled = false;
    });
    webhookEl?.addEventListener('change', () => {
        api?.save_config?.({
            discord_webhook: (webhookEl.value || '').trim()
        }).catch(err => console.error('Failed to save discord_webhook', err));
    });
}

/* ===== DEBUG PAGE ===== */
/* A real, capped, in-memory log of things that actually happened this
   session -- populated by debugLog() calls sprinkled at the points
   below (server events in/out, connectivity changes, errors caught).
   Not a fabricated static log. */
const DEBUG_LOG = [];

function debugLog(level, msg) {
    const t = new Date().toTimeString().slice(0, 8);
    DEBUG_LOG.unshift({
        t,
        level,
        msg
    });
    if (DEBUG_LOG.length > 300) DEBUG_LOG.length = 300;
    renderDebugLog();
}

function renderDebugLog() {
    const el = document.getElementById('debugLog');
    if (!el) return;
    const levelCls = {
        INFO: 'lvl-info',
        OK: 'lvl-ok',
        WARN: 'lvl-warn',
        ERROR: 'lvl-error'
    };
    el.innerHTML = DEBUG_LOG.length ? DEBUG_LOG.map(l =>
        `<div class="log-line ${levelCls[l.level]||'lvl-info'}"><span class="lt">${l.t}</span><span class="lv">${l.level}</span><span class="msg">${escapeHtml(l.msg)}</span></div>`
    ).join('') : '<div style="padding:12px 16px;color:var(--steel-dim);font-size:11px;">No log entries yet this session.</div>';
}

function updateDebugStatusCards(status) {
    const apiOrb = document.getElementById('debugOrbApi'),
        apiDesc = document.getElementById('debugApiDesc');
    const chatOrb = document.getElementById('debugOrbChat'),
        chatDesc = document.getElementById('debugChatDesc');
    const connected = !!(status && status.connected);
    if (apiOrb) apiOrb.classList.toggle('off', !connected);
    if (apiDesc) apiDesc.textContent = connected ? 'Connected · syncing events' : (status && status.configured === false ? 'Not configured' : 'Disconnected');
    // The chat watcher (RuneLite plugin side) isn't something the desktop
    // app can directly probe -- we infer "active" from whether we've
    // received any classified event at all this session.
    const active = ALL_EVENTS && ALL_EVENTS.length > 0;
    if (chatOrb) chatOrb.classList.toggle('off', !active);
    if (chatDesc) chatDesc.textContent = active ? 'Active · events received' : 'No events received yet';
    const discordOrb = document.getElementById('debugOrbDiscord'),
        discordDesc = document.getElementById('debugDiscordDesc');
    const api = window.pywebview && window.pywebview.api;
    if (api && typeof api.get_config === 'function') {
        api.get_config().then(cfg => {
            const has = !!(cfg && cfg.discord_webhook);
            if (discordOrb) discordOrb.classList.toggle('off', !has);
            if (discordDesc) discordDesc.textContent = has ? 'Configured' : 'Not configured';
        }).catch(() => {});
    }
}

function wireDebugPage() {
    renderDebugLog();
    updateDebugStatusCards({
        connected: false
    });

    document.getElementById('debugExportBtn')?.addEventListener('click', () => {
        const payload = JSON.stringify({
            exported_at: new Date().toISOString(),
            log: DEBUG_LOG,
            events: ALL_EVENTS
        }, null, 2);
        const blob = new Blob([payload], {
            type: 'application/json'
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'warden-debug-' + Date.now() + '.json';
        a.click();
        URL.revokeObjectURL(url);
    });
    document.getElementById('debugClearBtn')?.addEventListener('click', () => {
        DEBUG_LOG.length = 0;
        renderDebugLog();
    });
    document.getElementById('debugCopyBtn')?.addEventListener('click', async () => {
        const text = DEBUG_LOG.map(l => `[${l.t}] ${l.level} ${l.msg}`).join('\n');
        try {
            await navigator.clipboard.writeText(text);
            debugLog('OK', 'Log copied to clipboard');
        } catch (err) {
            debugLog('ERROR', 'Clipboard copy failed: ' + err);
        }
    });
    document.getElementById('debugReloadConfigBtn')?.addEventListener('click', async () => {
        const api = window.pywebview && window.pywebview.api;
        try {
            const cfg = await api?.get_config?.();
            if (cfg) {
                if (cfg.theme_accent) document.documentElement.style.setProperty('--blood', cfg.theme_accent);
                if (cfg.theme_glow) document.documentElement.style.setProperty('--blood-glow', cfg.theme_glow);
                if (cfg.username) applyUser(cfg.username);
                debugLog('OK', 'Config reloaded from disk');
            }
        } catch (err) {
            debugLog('ERROR', 'Reload config failed: ' + err);
        }
    });
    document.getElementById('debugRescanBtn')?.addEventListener('click', async () => {
        const api = window.pywebview && window.pywebview.api;
        try {
            const loaded = await loadAllEvents();
            renderKpis();
            renderDashboardDrops();
            debugLog(loaded ? 'OK' : 'WARN', loaded ? 'Rescanned local client cache' : 'Rescan returned no events');
        } catch (err) {
            debugLog('ERROR', 'Rescan failed: ' + err);
        }
    });
    document.getElementById('debugFlushBtn')?.addEventListener('click', async () => {
        const api = window.pywebview && window.pywebview.api;
        try {
            const res = await api?.flush_local_cache?.();
            ALL_EVENTS = [];
            renderKpis();
            renderDashboardDrops();
            debugLog('WARN', 'Local cache flushed (' + (res?.removed ?? 0) + ' rows removed)');
        } catch (err) {
            debugLog('ERROR', 'Flush cache failed: ' + err);
        }
    });
}

/* ===== WINDOW CHROME (frameless window: custom min/max/close + tray) ===== */
async function initWindowChrome() {
    const api = window.pywebview && window.pywebview.api;
    document.getElementById('winMin')?.addEventListener('click', () => {
        api?.minimize_window?.();
    });
    document.getElementById('winMax')?.addEventListener('click', () => {
        api?.toggle_maximize_window?.();
    });
    document.getElementById('winClose')?.addEventListener('click', () => {
        api?.request_close?.();
    });

    const sw = document.getElementById('closeBehaviorSwitch');
    if (!sw) return;
    if (api && typeof api.get_config === 'function') {
        try {
            const cfg = await api.get_config();
            sw.classList.toggle('on', cfg.close_behavior !== 'exit');
        } catch (err) {
            console.error('Failed to load close_behavior', err);
        }
    }
    sw.addEventListener('click', () => {
        sw.classList.toggle('on');
        const behavior = sw.classList.contains('on') ? 'background' : 'exit';
        if (api && typeof api.save_config === 'function') {
            api.save_config({
                close_behavior: behavior
            }).catch(err => console.error('Failed to save close_behavior', err));
        }
    });
}

/* ===== APP INIT ===== */
function initApp() {
    initWindowChrome();
    pollSyncStatus();
    setInterval(pollSyncStatus, 15000);
    document.querySelectorAll('.spark').forEach(spark => {
        for (let i = 0; i < 24; i++) {
            const bar = document.createElement('i');
            bar.style.height = (20 + Math.random() * 80) + '%';
            bar.style.animationDelay = (i * 0.02) + 's';
            spark.appendChild(bar);
        }
    });

    function tick() {
        document.getElementById('clockTxt').textContent = new Date().toTimeString().slice(0, 8);
    }
    setInterval(tick, 1000);
    tick();

    function makeCountdown(ringId, txtId, totalSec, startSec) {
        const ring = document.getElementById(ringId),
            txt = document.getElementById(txtId);
        const C = 169.6;
        let remaining = startSec;

        function render() {
            const frac = remaining / totalSec;
            ring.style.strokeDashoffset = C * (1 - frac);
            const m = String(Math.floor(remaining / 60)).padStart(2, '0'),
                s = String(remaining % 60).padStart(2, '0');
            txt.textContent = m + ':' + s;
        }
        render();
        setInterval(() => {
            remaining = remaining > 0 ? remaining - 1 : totalSec;
            render();
        }, 1000);
    }
    makeCountdown('eventRing', 'eventRingTxt', 372, 372);

    /* ===== Half TB / Full TB timers =====
       Start/stop countdowns with per-timer assignable hotkeys, saved to
       localStorage so bindings survive a restart. */
    const TB_TIMERS = {
        halftb: {
            ring: 'ring1',
            txt: 'ring1txt',
            total: 150,
            hkEl: 'ring1hk',
            defaultKey: 'Numpad1'
        },
        fulltb: {
            ring: 'ring2',
            txt: 'ring2txt',
            total: 300,
            hkEl: 'ring2hk',
            defaultKey: 'Numpad2'
        },
    };
    const tbState = {};

    function loadHotkey(id, fallback) {
        try {
            return localStorage.getItem('warden_hotkey_' + id) || fallback;
        } catch (e) {
            return fallback;
        }
    }

    function saveHotkey(id, key) {
        try {
            localStorage.setItem('warden_hotkey_' + id, key);
        } catch (e) {}
    }
    Object.keys(TB_TIMERS).forEach(id => {
        const cfg = TB_TIMERS[id];
        const ring = document.getElementById(cfg.ring),
            txt = document.getElementById(cfg.txt);
        const C = 169.6;
        const st = {
            remaining: cfg.total,
            running: false,
            interval: null,
            key: loadHotkey(id, cfg.defaultKey)
        };
        tbState[id] = st;
        document.getElementById(cfg.hkEl).textContent = 'Hotkey: ' + st.key;

        function render() {
            const frac = st.remaining / cfg.total;
            ring.style.strokeDashoffset = C * (1 - frac);
            const m = String(Math.floor(st.remaining / 60)).padStart(2, '0'),
                s = String(st.remaining % 60).padStart(2, '0');
            txt.textContent = m + ':' + s;
        }

        function tick() {
            if (st.remaining <= 0) {
                stop();
                return;
            }
            st.remaining -= 1;
            render();
            if (st.remaining <= 0) stop();
        }

        function start() {
            if (st.running) return;
            st.running = true;
            st.interval = setInterval(tick, 1000);
            updateBtn();
        }

        function stop() {
            st.running = false;
            if (st.interval) {
                clearInterval(st.interval);
                st.interval = null;
            }
            updateBtn();
        }

        function toggle() {
            st.running ? stop() : start();
        }

        function reset() {
            stop();
            st.remaining = cfg.total;
            render();
        }
        st.toggle = toggle;
        st.reset = reset;
        const card = ring.closest('.timer-card');
        const toggleBtn = card.querySelector('[data-act="toggle"]');

        function updateBtn() {
            toggleBtn.textContent = st.running ? '❚❚' : '▶';
        }
        toggleBtn.addEventListener('click', toggle);
        card.querySelector('[data-act="reset"]').addEventListener('click', reset);
        const bindBtn = card.querySelector('[data-act="bind"]');
        bindBtn.addEventListener('click', () => {
            bindBtn.classList.add('listening');
            bindBtn.textContent = 'Press key…';
            const onKey = (e) => {
                e.preventDefault();
                const key = e.code || e.key;
                st.key = key;
                saveHotkey(id, key);
                document.getElementById(cfg.hkEl).textContent = 'Hotkey: ' + key;
                bindBtn.classList.remove('listening');
                bindBtn.textContent = 'Set Key';
                window.removeEventListener('keydown', onKey, true);
            };
            window.addEventListener('keydown', onKey, true);
        });
        render();
        updateBtn();
    });
    // Global hotkey listener -- ignores keystrokes while typing in an input/textarea.
    window.addEventListener('keydown', (e) => {
        const tag = (e.target && e.target.tagName) || '';
        if (tag === 'INPUT' || tag === 'TEXTAREA') return;
        Object.keys(tbState).forEach(id => {
            const st = tbState[id];
            if ((e.code || e.key) === st.key) {
                e.preventDefault();
                st.toggle();
            }
        });
    });

    loadInitialFeed();
    document.getElementById('clearBtn').addEventListener('click', () => {
        document.getElementById('feed').innerHTML = '';
    });
    document.querySelectorAll('.switch').forEach(sw => {
        if (sw.id === 'closeBehaviorSwitch') return;
        sw.addEventListener('click', () => sw.classList.toggle('on'));
    });

    // page routing
    document.querySelectorAll('[data-page]').forEach(el => {
        if (el.classList.contains('page')) return;
        el.addEventListener('click', () => goToPage(el.dataset.page));
    });

    // custom items add/remove
    document.getElementById('addItemBtn').addEventListener('click', () => {
        const input = document.getElementById('newItemInput');
        const val = input.value.trim();
        if (!val) return;
        const row = document.createElement('div');
        row.className = 'item-mgr-row';
        row.innerHTML = `<span class="nm">${val}</span><span class="del">✕</span>`;
        row.querySelector('.del').addEventListener('click', () => row.remove());
        document.getElementById('itemMgrList').appendChild(row);
        input.value = '';
    });
    document.querySelectorAll('.item-mgr-row .del').forEach(d => d.addEventListener('click', (e) => e.target.closest('.item-mgr-row').remove()));

    document.querySelectorAll('#settingsSwatches .swatch').forEach(sw => {
        sw.addEventListener('click', () => {
            document.querySelectorAll('#settingsSwatches .swatch').forEach(s => s.classList.remove('selected'));
            sw.classList.add('selected');
            document.documentElement.style.setProperty('--blood', sw.dataset.c);
            document.documentElement.style.setProperty('--blood-glow', sw.dataset.g);
        });
    });
    wireSettingsPanel();
    wireDebugPage();
    initApiStatusOverlay();
    initLoadoutsPage();
    initDonatePage();

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
function seededRand(seedStr) {
    let h = 0;
    for (let i = 0; i < seedStr.length; i++) {
        h = (h << 5) - h + seedStr.charCodeAt(i);
        h |= 0;
    }
    return function() {
        h = (h * 9301 + 49297) % 233280;
        return h / 233280;
    };
}
const watchedUsers = []; // populated on init from the real watchlist
let activeWatch = 'ALL';

function matchesWatchPlayer(ev, name) {
    if (!ev || !name) return false;
    const f = ev.fields || {};
    const target = name.toLowerCase();
    return [f.player, f.killer, f.victim].some(v => v && stripTags(v).toLowerCase() === target);
}
async function initProfile() {
    document.getElementById('profBigAv').textContent = PRIMARY_USER.slice(0, 2).toUpperCase();
    document.getElementById('pnameText').textContent = PRIMARY_USER;
    watchedUsers.length = 0;
    watchedUsers.push({
        name: PRIMARY_USER,
        you: true
    });
    const api = window.pywebview && window.pywebview.api;
    if (api && typeof api.get_watchlist === 'function') {
        try {
            const names = await api.get_watchlist();
            (names || []).forEach(n => {
                if (n && n.toLowerCase() !== PRIMARY_USER.toLowerCase()) watchedUsers.push({
                    name: n,
                    you: false
                });
            });
        } catch (err) {
            console.error('Failed to load watchlist', err);
        }
    }
    renderWatchChips();
    renderProfileFeed();

    document.getElementById('pnameEditBtn').addEventListener('click', () => {
        document.getElementById('pnameDisplay').style.display = 'none';
        document.getElementById('pnameEditRow').classList.add('active');
        document.getElementById('pnameInput').value = PRIMARY_USER;
        document.getElementById('pnameInput').focus();
    });
    document.getElementById('pnameSave').addEventListener('click', () => {
        const v = document.getElementById('pnameInput').value.trim();
        if (v) {
            PRIMARY_USER = v;
            document.getElementById('pnameText').textContent = v;
            document.getElementById('userName').textContent = v;
            document.getElementById('userAv').textContent = v.slice(0, 2).toUpperCase();
            document.getElementById('profBigAv').textContent = v.slice(0, 2).toUpperCase();
            watchedUsers[0].name = v;
            if (api && typeof api.save_config === 'function') {
                api.save_config({
                    username: v
                }).catch(err => console.error('Failed to save username', err));
            }
            renderWatchChips();
            renderProfileFeed();
        }
        document.getElementById('pnameDisplay').style.display = 'flex';
        document.getElementById('pnameEditRow').classList.remove('active');
    });
    document.getElementById('addWatchBtn').addEventListener('click', async () => {
        const input = document.getElementById('newWatchInput');
        const v = input.value.trim();
        if (!v) return;
        if (api && typeof api.add_watch === 'function') {
            try {
                const names = await api.add_watch(v);
                watchedUsers.length = 0;
                watchedUsers.push({
                    name: PRIMARY_USER,
                    you: true
                });
                (names || []).forEach(n => {
                    if (n && n.toLowerCase() !== PRIMARY_USER.toLowerCase()) watchedUsers.push({
                        name: n,
                        you: false
                    });
                });
            } catch (err) {
                console.error('Failed to add watch', err);
                watchedUsers.push({
                    name: v,
                    you: false
                });
            }
        } else {
            watchedUsers.push({
                name: v,
                you: false
            });
        }
        renderWatchChips(true);
        input.value = '';
    });
}

function renderWatchChips(animateLast) {
    const row = document.getElementById('watchChips');
    row.innerHTML = '';
    const api = window.pywebview && window.pywebview.api;
    watchedUsers.forEach((u, idx) => {
        const chip = document.createElement('div');
        chip.className = 'chip' + (u.you ? ' you' : '') + (activeWatch === u.name ? ' active' : '') + ((animateLast && idx === watchedUsers.length - 1) ? ' chip-enter' : '');
        chip.innerHTML = `<span>${escapeHtml(u.name)}${u.you?' (you)':''}</span>` + (u.you ? '' : '<span class="x">✕</span>');
        chip.addEventListener('click', (e) => {
            if (e.target.classList.contains('x')) return;
            activeWatch = activeWatch === u.name ? 'ALL' : u.name;
            renderWatchChips();
            renderProfileFeed();
        });
        if (!u.you) {
            chip.querySelector('.x').addEventListener('click', (e) => {
                e.stopPropagation();
                watchedUsers.splice(idx, 1);
                if (activeWatch === u.name) activeWatch = 'ALL';
                if (api && typeof api.remove_watch === 'function') {
                    api.remove_watch(u.name).catch(err => console.error('Failed to remove watch', err));
                }
                renderWatchChips();
                renderProfileFeed();
            });
        }
        row.appendChild(chip);
    });
    const allChip = document.createElement('div');
    allChip.className = 'chip' + (activeWatch === 'ALL' ? ' active' : '');
    allChip.style.order = -1;
    allChip.innerHTML = '<span>All</span>';
    allChip.addEventListener('click', () => {
        activeWatch = 'ALL';
        renderWatchChips();
        renderProfileFeed();
    });
    row.prepend(allChip);

    document.getElementById('feedFilterLabel').textContent = activeWatch === 'ALL' ? 'All Watched Players' : activeWatch + "'s Feed";
    renderWatchStats();
}

function renderWatchStats() {
    const names = activeWatch === 'ALL' ? watchedUsers.map(u => u.name) : [activeWatch];
    const matched = ALL_EVENTS.filter(ev => names.some(n => matchesWatchPlayer(ev, n)));
    // "sales" isn't wired up yet -- market_store.recent_sales only
    // filters by item, not by buyer/seller username, so there's no
    // real per-player number to show here without fabricating one.
    const stats = {
        drops: matched.filter(isDropEvent).length,
        raids: matched.filter(e => e.event_type === 'raids_drop').length,
        sales: null
    };
    document.querySelectorAll('#watchStats .n').forEach(el => {
        const val = stats[el.dataset.w];
        el.style.opacity = '0';
        setTimeout(() => {
            el.textContent = (val === null || val === undefined) ? '—' : val;
            el.style.transition = 'opacity .25s ease';
            el.style.opacity = '1';
        }, 120);
    });
}

function renderProfileFeed() {
    const feed = document.getElementById('profileFeed');
    if (!feed) return;
    feed.innerHTML = '';
    const names = activeWatch === 'ALL' ? watchedUsers.map(u => u.name) : [activeWatch];
    const rows = ALL_EVENTS.filter(ev => names.some(n => matchesWatchPlayer(ev, n))).slice(0, 30);
    const nodes = rows.map(buildFeedItemNode).filter(Boolean);
    if (!nodes.length) {
        feed.innerHTML = `<div style="padding:16px;color:var(--steel-dim);font-size:11px;">No recorded events yet for ${activeWatch==='ALL'?'these players':escapeHtml(activeWatch)}.</div>`;
        return;
    }
    nodes.forEach(n => feed.appendChild(n));
}

/* ===== MARKET PAGE ===== */
/* Item catalog + sale history come from the central server's
   /market/items and /market/sales (see server/market_poller.py,
   server/items_catalog.py) via api.get_market_items() /
   api.get_market_sales() -- both plain REST passthroughs on the
   desktop side (main.py), no local caching. Falls back to a small
   demo catalog + synthetic series only when there's no bridge/data,
   same pattern as the dashboard feed (loadInitialFeed()). */
let MARKET_CATALOG = [];
let selectedItem = null,
    selectedItemId = null,
    selectedTf = '1D';
let currentSales = []; // sale rows for the selected item, newest-first, as returned by the API
// Item ids bumped to the top of the market item list because a new
// listing event came in for them (see wardenOnMarketListing below).
// Mirrors the server-side scan-priority bump in market_poller.py.
const priorityItemIds = new Set();
let renderMarketList = null; // set inside initMarket, called externally when priority changes
// Listings seen for tracked accounts, grouped by account name, for the
// Profile page's "Current Market Listings" panel.
const accountListings = {}; // { accountName: [ {item_name,item_id,price_gp,sale_time}, ... ] }
function itemColor(name) {
    const rnd = seededRand(name);
    const hue = Math.floor(rnd() * 360);
    return `hsl(${hue},55%,52%)`;
}

function formatGp(v) {
    const n = Number(v) || 0,
        a = Math.abs(n);
    if (a >= 1e15) return (n / 1e15).toFixed(2) + 'Q';
    if (a >= 1e12) return (n / 1e12).toFixed(2) + 'T';
    if (a >= 1e9) return (n / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return (n / 1e6).toFixed(1) + 'M';
    if (a >= 1e3) return (n / 1e3).toFixed(1) + 'K';
    return Math.round(n).toString();
}

function parseSaleTime(t) {
    if (!t) return new Date();
    const d = new Date(String(t).replace(' ', 'T'));
    return isNaN(d.getTime()) ? new Date() : d;
}
/* ===== TOASTS ===== */
function showToast(title, body, ms) {
    const stack = document.getElementById('toastStack');
    if (!stack) return;
    const el = document.createElement('div');
    el.className = 'warden-toast';
    el.innerHTML = `<div class="tt-title">${escapeHtml(title)}</div><div class="tt-body">${escapeHtml(body)}</div>`;
    stack.appendChild(el);
    setTimeout(() => {
        el.classList.add('leaving');
        setTimeout(() => el.remove(), 200);
    }, ms || 6000);
}

/* main.py forwards market_alert_triggered here (see main.py handle_server_event) */
window.wardenOnMarketAlert = function(event) {
    const dir = event.direction === 'above' ? 'rose above' : 'fell below';
    showToast('🔔 Price Alert', `${event.item_name} ${dir} ${formatGp(event.threshold_gp)} gp`, 8000);
    if (document.querySelector('.page.active')?.dataset.page === 'market') loadMarketAlerts();
};

async function initMarket() {
    const api = window.pywebview && window.pywebview.api;
    if (api && typeof api.get_market_items === 'function') {
        try {
            const items = await api.get_market_items();
            if (items && items.length) MARKET_CATALOG = items;
        } catch (err) {
            console.error('Failed to load market catalog', err);
        }
    }
    if (!MARKET_CATALOG.length) {
        const list = document.getElementById('itemList');
        if (list) list.innerHTML = '<div style="padding:16px;color:var(--steel-dim);font-size:11px;">No market catalog loaded. Check your Central API connection.</div>';
        return;
    }

    const list = document.getElementById('itemList');

    function renderList(filter) {
        list.innerHTML = '';
        const matches = MARKET_CATALOG.filter(it => it.name.toLowerCase().includes(filter.toLowerCase()));
        // Priority items (fresh listings from a tracked account) sort first
        // so they're immediately visible without the user having to search.
        matches.sort((a, b) => {
            const pa = priorityItemIds.has(a.item_id) ? 1 : 0,
                pb = priorityItemIds.has(b.item_id) ? 1 : 0;
            if (pa !== pb) return pb - pa;
            return 0;
        });
        matches.slice(0, 300).forEach(it => {
            const isPriority = priorityItemIds.has(it.item_id);
            const row = document.createElement('div');
            row.className = 'item-row' + (selectedItemId === it.item_id ? ' active' : '') + (isPriority ? ' priority' : '');
            row.innerHTML = `<div class="icon" style="background:${itemColor(it.name)}">${it.name.slice(0,2).toUpperCase()}</div><div class="info"><div class="nm">${it.name}${isPriority?' <span style="color:var(--blood);font-size:9px;">● NEW LISTING</span>':''}</div><div class="cat">#${it.item_id}</div></div>`;
            row.addEventListener('click', () => {
                selectedItemId = it.item_id;
                priorityItemIds.delete(it.item_id);
                renderList(document.getElementById('itemSearch').value);
                selectItem(it);
            });
            list.appendChild(row);
        });
    }
    renderMarketList = () => renderList(document.getElementById('itemSearch').value);
    document.getElementById('itemSearch').addEventListener('input', (e) => renderList(e.target.value));
    renderList('');
    document.querySelectorAll('.tf-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            document.querySelectorAll('.tf-chip').forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
            selectedTf = chip.dataset.tf;
            renderChart();
            renderDetailStats();
        });
    });
    if (MARKET_CATALOG.length) {
        selectedItemId = MARKET_CATALOG[0].item_id;
        renderList('');
        await selectItem(MARKET_CATALOG[0]);
    }
    populateLoadoutItemDatalist();
    wireMarketAlertBar();
}

/* Loadouts page item picker (see initLoadoutsPage / openItemPicker)
   pulls from this exact same list, so item names available there
   always match what's actually searchable/tradeable on the Market
   page -- one source of truth (server /market/items). */
function populateLoadoutItemDatalist() {
    const dl = document.getElementById('loadoutItemDatalist');
    if (!dl || !MARKET_CATALOG.length) return;
    dl.innerHTML = MARKET_CATALOG.map(it => `<option value="${escapeHtml(it.name)}">`).join('');
}

/* ===== MARKET PAGE: price alerts ===== */
async function loadMarketAlerts() {
    const wrap = document.getElementById('marketAlertsList');
    const api = window.pywebview && window.pywebview.api;
    if (!wrap || !api || typeof api.get_market_alerts !== 'function') return;
    let alerts = [];
    try {
        alerts = await api.get_market_alerts() || [];
    } catch (err) {
        console.error('Failed to load market alerts', err);
        return;
    }
    if (!alerts.length) {
        wrap.innerHTML = '';
        return;
    }
    wrap.innerHTML = alerts.map(a => `
      <div class="market-alert-row" data-id="${a.id}">
        <span>${a.active ? '🔔' : '✓'}</span>
        <span><b>${escapeHtml(a.item_name)}</b> ${a.direction === 'above' ? '≥' : '≤'} ${formatGp(a.price_gp)} gp</span>
        <span>${a.active ? 'watching' : 'triggered'}</span>
        <span class="maa-del" data-id="${a.id}">✕</span>
      </div>`).join('');
    wrap.querySelectorAll('.maa-del').forEach(btn => {
        btn.addEventListener('click', async () => {
            const id = Number(btn.dataset.id);
            const api2 = window.pywebview && window.pywebview.api;
            if (api2 && typeof api2.delete_market_alert === 'function') {
                await api2.delete_market_alert(id).catch(() => {});
                loadMarketAlerts();
            }
        });
    });
}

function wireMarketAlertBar() {
    document.getElementById('alertCreateBtn')?.addEventListener('click', async () => {
        const noteEl = document.getElementById('alertBarNote');
        const priceEl = document.getElementById('alertPriceInput');
        const dirEl = document.getElementById('alertDirection');
        const price = parseFloat((priceEl.value || '').replace(/,/g, ''));
        if (!selectedItemId || !selectedItem) {
            if (noteEl) noteEl.textContent = 'Select an item first';
            return;
        }
        if (!price || price <= 0) {
            if (noteEl) noteEl.textContent = 'Enter a valid price';
            return;
        }
        const api = window.pywebview && window.pywebview.api;
        if (!api || typeof api.create_market_alert !== 'function') return;
        try {
            const res = await api.create_market_alert(selectedItemId, selectedItem, dirEl.value, price, false);
            if (res && res.ok) {
                if (noteEl) noteEl.textContent = 'Alert added';
                priceEl.value = '';
                loadMarketAlerts();
            } else if (noteEl) {
                noteEl.textContent = (res && res.error) || 'Failed to add alert';
            }
        } catch (err) {
            if (noteEl) noteEl.textContent = 'Failed to add alert';
        }
    });
    loadMarketAlerts();
}

async function selectItem(it) {
    selectedItem = it.name;
    selectedItemId = it.item_id;
    document.getElementById('detIcon').textContent = it.name.slice(0, 2).toUpperCase();
    document.getElementById('detIcon').style.background = itemColor(it.name);
    document.getElementById('detName').textContent = it.name;
    document.getElementById('detCat').textContent = '#' + it.item_id;

    currentSales = [];
    const api = window.pywebview && window.pywebview.api;
    if (api && typeof api.get_market_sales === 'function') {
        try {
            currentSales = await api.get_market_sales(it.item_id, null, 300) || [];
        } catch (err) {
            console.error('Failed to load market sales', err);
        }
    }
    renderDetailStats();
    renderChart();
    renderSales();
}

function salesInTimeframe(tf) {
    if (tf === 'ALL') return currentSales;
    const spanMs = tf === '1D' ? 86400000 : tf === '7D' ? 7 * 86400000 : 30 * 86400000;
    const cutoff = Date.now() - spanMs;
    return currentSales.filter(s => parseSaleTime(s.sale_time).getTime() >= cutoff);
}

function renderDetailStats() {
    const priceEl = document.getElementById('detPrice'),
        deltaEl = document.getElementById('detDelta');
    if (!currentSales.length) {
        priceEl.textContent = 'No sales yet';
        deltaEl.textContent = '';
        deltaEl.className = 'd';
        return;
    }
    const latest = currentSales[0]; // API returns newest-first
    priceEl.textContent = formatGp(latest.price_gp) + ' gp';
    const windowSales = salesInTimeframe(selectedTf);
    const oldest = windowSales.length ? windowSales[windowSales.length - 1] : currentSales[currentSales.length - 1];
    const delta = oldest && oldest.price_gp ? ((latest.price_gp - oldest.price_gp) / oldest.price_gp * 100) : 0;
    deltaEl.textContent = (delta >= 0 ? '▲ +' : '▼ ') + Math.abs(delta).toFixed(1) + '% (' + selectedTf + ')';
    deltaEl.className = 'd ' + (delta >= 0 ? 'up' : 'down');
}

function renderChart() {
    const svg = document.getElementById('chartSvg');
    const windowSales = salesInTimeframe(selectedTf).slice().sort((a, b) => parseSaleTime(a.sale_time) - parseSaleTime(b.sale_time));
    const series = windowSales.map(s => s.price_gp);
    if (series.length < 2) {
        svg.innerHTML = `<text x="300" y="84" text-anchor="middle" fill="var(--steel-dim)" font-size="11">Not enough sale history yet</text>`;
        return;
    }
    const w = 600,
        h = 160,
        pad = 8;
    const min = Math.min(...series),
        max = Math.max(...series);
    const range = (max - min) || 1;
    const stepX = (w - pad * 2) / (series.length - 1);
    let d = 'M';
    series.forEach((v, i) => {
        const x = pad + i * stepX;
        const y = pad + (1 - (v - min) / range) * (h - pad * 2);
        d += (i === 0 ? '' : 'L') + x.toFixed(1) + ',' + y.toFixed(1) + ' ';
    });
    let dFill = d + `L${(w-pad).toFixed(1)},${(h-pad).toFixed(1)} L${pad},${(h-pad).toFixed(1)} Z`;
    svg.innerHTML = `
    <g class="chart-grid">
      <line x1="0" y1="${h*0.25}" x2="${w}" y2="${h*0.25}"/>
      <line x1="0" y1="${h*0.5}" x2="${w}" y2="${h*0.5}"/>
      <line x1="0" y1="${h*0.75}" x2="${w}" y2="${h*0.75}"/>
    </g>
    <path class="chart-fill" d="${dFill}" fill="var(--blood)"/>
    <path class="chart-path" d="${d}" stroke-dasharray="1000" stroke-dashoffset="1000"/>
  `;
    const path = svg.querySelector('.chart-path');
    requestAnimationFrame(() => {
        path.style.transition = 'stroke-dashoffset 1s ease';
        path.style.strokeDashoffset = '0';
    });
}

function renderSales() {
    const body = document.getElementById('salesBody');
    body.innerHTML = '';
    if (!currentSales.length) {
        body.innerHTML = '<tr><td colspan="5" style="color:var(--steel-dim);">No sales recorded yet</td></tr>';
        return;
    }
    currentSales.slice(0, 25).forEach(s => {
        const isMine = s.seller === PRIMARY_USER || s.buyer === PRIMARY_USER;
        const tr = document.createElement('tr');
        if (isMine) tr.classList.add('mine');
        const t = parseSaleTime(s.sale_time).toTimeString().slice(0, 8);
        tr.innerHTML = `<td>${t}</td><td>${s.seller||'—'}</td><td>${s.buyer||'—'}</td><td>${s.amount||1}</td><td class="c-amber">${formatGp(s.price_gp)}</td>`;
        body.appendChild(tr);
    });
}
/* main.py forwards market_sale_new broadcasts here (see sync/client.py
   + market_poller.py on the server) -- merge in new sales for whichever
   item is currently open, ignore everything else. */
function wardenOnMarketSale(event) {
    if (!event || event.item_id !== selectedItemId) return;
    const known = new Set(currentSales.map(s => s.id));
    const fresh = (event.records || []).filter(r => !known.has(r.id));
    if (!fresh.length) return;
    currentSales = fresh.concat(currentSales).sort((a, b) => parseSaleTime(b.sale_time) - parseSaleTime(a.sale_time));
    renderDetailStats();
    renderChart();
    renderSales();
}
window.wardenOnMarketSale = wardenOnMarketSale;

/* main.py forwards market_listing_new broadcasts here (see
   server/market_poller.py's _flag_tracked_listings +
   server/app.py's POST /market/track) -- fires when one of *our*
   tracked accounts (primary username + watchlist) shows up as the
   seller on a fresh trading-post record. We treat that as "a new
   listing for a user": bump the item to the top of the Market page's
   item list, and file it under that account on the Profile page. */
function wardenOnMarketListing(event) {
    if (!event || !event.item_id) return;
    priorityItemIds.add(event.item_id);
    if (typeof renderMarketList === 'function') renderMarketList();
    if (selectedItemId === event.item_id) {
        // Already looking at this item -- merge the fresh record in too,
        // same as a normal sale update would.
        wardenOnMarketSale({
            type: 'market_sale_new',
            item_id: event.item_id,
            records: [event.record]
        });
    }

    const account = event.account || 'Unknown';
    if (!accountListings[account]) accountListings[account] = [];
    const rec = event.record || {};
    accountListings[account] = accountListings[account].filter(l => l.item_id !== event.item_id || l.sale_time !== rec.sale_time);
    accountListings[account].unshift({
        item_id: event.item_id,
        item_name: event.item_name,
        price_gp: rec.price_gp,
        sale_time: rec.sale_time
    });
    accountListings[account] = accountListings[account].slice(0, 20);
    renderProfileListings();
}
window.wardenOnMarketListing = wardenOnMarketListing;

function renderProfileListings() {
    const el = document.getElementById('profileListings');
    if (!el) return;
    const accounts = Object.keys(accountListings).filter(a => accountListings[a].length);
    if (!accounts.length) {
        el.innerHTML = '<div style="padding:12px 16px;color:var(--steel-dim);font-size:11px;">No listings seen yet.</div>';
        return;
    }
    el.innerHTML = '';
    accounts.forEach(account => {
        const group = document.createElement('div');
        group.className = 'listing-account-group';
        const head = document.createElement('div');
        head.className = 'listing-account-head';
        head.textContent = account;
        group.appendChild(head);
        accountListings[account].forEach(l => {
            const row = document.createElement('div');
            row.className = 'listing-row' + (priorityItemIds.has(l.item_id) ? ' priority' : '');
            const t = l.sale_time ? parseSaleTime(l.sale_time).toTimeString().slice(0, 8) : '';
            row.innerHTML = `<span class="li-item">${ItemImages.icon(l.item_name, 18)} ${escapeHtml(l.item_name||('#'+l.item_id))}</span><span class="li-price">${formatGp(l.price_gp)} gp</span><span>${t}</span>`;
            group.appendChild(row);
        });
        el.appendChild(group);
    });
}