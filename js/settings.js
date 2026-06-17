/* ==============================================
   SETTINGS.JS — Admin Settings Panel
   Jesus Embassy PWA
   -----------------------------------------------
   Integrated admin dashboard inside the main app.
   Replaces the separate admin.html page.

   Features:
   - Password-gated access (session-based)
   - Dashboard with live stats
   - Push notification composer + sender (FCM v1)
   - Subscriber management
   - App Control (online / readonly / maintenance)
   - Service Account settings
============================================== */

/* ── Constants ──────────────────────────────────────────────── */
const CORRECT_PW   = 'embassy1';
const SESSION_KEY  = 'je-admin-auth';
const SESSION_TTL  = 8 * 60 * 60 * 1000;
const SA_KEY       = 'je-admin-sa';
const TOKEN_CACHE  = 'je-admin-oauth-token';
const TOKEN_EXP    = 'je-admin-oauth-exp';
const TOKENS_PATH  = 'fcm-tokens';
const NOTIF_HIST   = 'je-admin-notif-history';
const PROJECT_ID   = 'church-app-637f7';
/* FCM scope — used for sending notifications */
const FCM_SCOPE    = 'https://www.googleapis.com/auth/firebase.messaging https://www.googleapis.com/auth/firebase';
/* Full admin scope — used for RTDB REST writes and rules management */
const ADMIN_SCOPE  = 'https://www.googleapis.com/auth/firebase https://www.googleapis.com/auth/cloud-platform';
const FCM_URL      = `https://fcm.googleapis.com/v1/projects/${PROJECT_ID}/messages:send`;
const ICON_URL     = 'https://daviddchucks-hash.github.io/Church-website-/assets/icons/icon-192.png';
const RTDB_URL_BASE = `https://${PROJECT_ID}-default-rtdb.firebaseio.com`;
const PARALLEL     = 50;
const ACTIVE_DAYS  = 7 * 24 * 60 * 60 * 1000;
const APP_CONTROL_CODE = '0000';

let allTokens = [];
let _rtdb = null;

/* ── Helpers ─────────────────────────────────────────────────── */
const el  = id  => document.getElementById(id);
const now = ()  => Date.now();

function showResult(id, msg, type) {
  const b = el(id);
  if (!b) return;
  b.textContent = msg;
  b.className   = `settings-result-banner ${type} show`;
}

function hideResult(id) {
  const b = el(id);
  if (!b) return;
  b.className = 'settings-result-banner';
}

/* ── Auth ────────────────────────────────────────────────────── */
export function isAdminAuthed() {
  const ts = sessionStorage.getItem(SESSION_KEY);
  return !!(ts && (now() - +ts) < SESSION_TTL);
}

function login()  { sessionStorage.setItem(SESSION_KEY, String(now())); }

function logout() {
  sessionStorage.removeItem(SESSION_KEY);
  sessionStorage.removeItem(TOKEN_CACHE);
  sessionStorage.removeItem(TOKEN_EXP);
  showGate();
  /* After logout — re-check maintenance mode */
  window.dispatchEvent(new CustomEvent('admin-logout'));
}

/* ── Gate / Panel toggling ───────────────────────────────────── */
function showGate() {
  const gate  = el('settings-gate');
  const admin = el('settings-admin');
  if (gate)  gate.style.display  = 'flex';
  if (admin) admin.style.display = 'none';
  const pwd = el('settings-pwd');
  if (pwd) { pwd.value = ''; pwd.focus(); }
  const err = el('settings-gate-error');
  if (err) err.classList.remove('show');
}

function showAdminContent() {
  const gate  = el('settings-gate');
  const admin = el('settings-admin');
  if (gate)  gate.style.display  = 'none';
  if (admin) admin.style.display = 'block';
  loadDashboard();
}

/* ── Tab management ──────────────────────────────────────────── */
function switchTab(tabName) {
  document.querySelectorAll('.settings-tab-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === tabName);
  });
  document.querySelectorAll('.settings-tab-panel').forEach(p => {
    p.classList.toggle('active', p.id === `settings-tab-${tabName}`);
  });
  if (tabName === 'notifications') loadTokens();
  if (tabName === 'dashboard')     loadDashboard();
  if (tabName === 'app-control')   loadAppStatus();
  if (tabName === 'diagnostics')   runDiagnostics();
}

/* ── Dashboard ───────────────────────────────────────────────── */
async function loadDashboard() {
  const saRaw = localStorage.getItem(SA_KEY);

  if (saRaw) {
    try {
      const saData = JSON.parse(saRaw);
      const accessToken = await getAccessToken(saData.client_email, saData.private_key);
      const rtdbUrl = `${RTDB_URL_BASE}/${TOKENS_PATH}.json`;
      const res = await fetch(rtdbUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (res.ok) {
        const data = await res.json();
        allTokens = data ? Object.values(data).filter(Boolean) : [];
        const el_total = el('dash-tokens');
        if (el_total) el_total.textContent = allTokens.length;
      }
    } catch (err) {
      console.warn('[Settings] Dashboard token load failed:', err.message);
    }
  } else {
    const el_total = el('dash-tokens');
    if (el_total) el_total.textContent = '—';
  }

  const history = getNotifHistory();
  const elLast  = el('dash-last-notif');
  if (elLast) {
    if (history.length) {
      const last = history[history.length - 1];
      elLast.textContent = `${last.title} (${new Date(last.ts).toLocaleDateString()})`;
    } else {
      elLast.textContent = 'None yet';
    }
  }

  loadAppStatusBadge();
}

async function loadAppStatusBadge() {
  try {
    let url = `${RTDB_URL_BASE}/appSettings.json`;
    try { const t = await getAdminToken(); url = `${url}?access_token=${t}`; } catch { /* fall through */ }
    const res  = await fetch(url);
    const data = res.ok ? await res.json() : null;
    const status = data?.status || 'online';
    const badge  = el('dash-app-status');
    if (!badge) return;
    const map = { online: '🟢 Online', readonly: '🟡 Read-Only', maintenance: '🔴 Maintenance', offline: '⛔ Offline', shutdown: '⛔ Shutdown' };
    badge.textContent = map[status] || status;
    badge.dataset.status = status;
  } catch { /* non-critical */ }
}

/* ── Notification History ────────────────────────────────────── */
function getNotifHistory() {
  try { return JSON.parse(localStorage.getItem(NOTIF_HIST) || '[]'); } catch { return []; }
}

function addNotifHistory(title, body, success, fail, total) {
  const history = getNotifHistory();
  history.unshift({ title, body, success, fail, total, ts: Date.now() });
  if (history.length > 20) history.splice(20);
  localStorage.setItem(NOTIF_HIST, JSON.stringify(history));
}

function renderNotifHistory() {
  const container = el('notif-history-list');
  if (!container) return;
  const history = getNotifHistory();
  if (!history.length) {
    container.innerHTML = '<div class="settings-empty-state"><span>📭</span><p>No notifications sent yet.</p></div>';
    return;
  }
  container.innerHTML = history.map(n => `
    <div class="notif-hist-item">
      <div class="notif-hist-title">${n.title}</div>
      <div class="notif-hist-body">${n.body}</div>
      <div class="notif-hist-meta">
        <span class="pill-ok">✅ ${n.success} delivered</span>
        ${n.fail ? `<span class="pill-fail">❌ ${n.fail} failed</span>` : ''}
        <span class="notif-hist-date">${new Date(n.ts).toLocaleString()}</span>
      </div>
    </div>
  `).join('');
}

/* ── Load Subscribers (Tokens) ───────────────────────────────── */
async function loadTokens() {
  const saRaw = localStorage.getItem(SA_KEY);

  if (!saRaw) {
    const dbStatus = el('settings-db-status');
    if (dbStatus) { dbStatus.textContent = 'No credentials'; dbStatus.style.color = '#e67e22'; }
    const sc = el('settings-subscriber-content');
    if (sc) sc.innerHTML = `
      <div class="settings-empty-state">
        <span>🔑</span>
        <p>Add your Service Account JSON in the <strong>Settings</strong> tab first.</p>
      </div>`;
    ['settings-stat-total','settings-stat-active','settings-stat-mobile','settings-stat-desktop']
      .forEach(id => { const e = el(id); if (e) e.textContent = '—'; });
    return;
  }

  let saData;
  try { saData = JSON.parse(saRaw); } catch {
    const dbStatus = el('settings-db-status');
    if (dbStatus) dbStatus.textContent = 'Bad credentials';
    return;
  }

  try {
    const dbStatus = el('settings-db-status');
    if (dbStatus) { dbStatus.textContent = 'Loading…'; dbStatus.style.color = ''; }

    /* FIX: use getAdminToken() with firebase+cloud-platform scope, not the
       FCM-scoped getAccessToken().  The SA must have at least the
       "Firebase Realtime Database Admin" IAM role to bypass .read:false rules. */
    const adminToken = await getAdminToken();
    const rtdbUrl = `${RTDB_URL_BASE}/${TOKENS_PATH}.json?access_token=${adminToken}`;
    const res = await fetch(rtdbUrl);

    if (!res.ok) {
      const body = await res.text();
      if (res.status === 401 || res.status === 403) {
        /* Graceful fallback: rules may allow public read — try without token */
        const fallbackRes = await fetch(`${RTDB_URL_BASE}/${TOKENS_PATH}.json`);
        if (fallbackRes.ok) {
          const fallbackData = await fallbackRes.json();
          allTokens = fallbackData ? Object.values(fallbackData).filter(Boolean) : [];
          if (dbStatus) { dbStatus.textContent = 'Connected (public)'; dbStatus.style.color = '#e67e22'; }
          updateStats();
          renderTable();
          const dashTokens = el('dash-tokens');
          if (dashTokens) dashTokens.textContent = allTokens.length;
          return;
        }
        throw new Error(
          `Cannot read subscriber list (${res.status}). ` +
          `In Firebase Console → Realtime Database → Rules, ` +
          `change "fcm-tokens" to { ".write": true, ".read": true } and Publish.`
        );
      }
      throw new Error(`RTDB REST error ${res.status}: ${body}`);
    }

    const data = await res.json();
    allTokens = data ? Object.values(data).filter(Boolean) : [];

    if (dbStatus) { dbStatus.textContent = 'Connected'; dbStatus.style.color = ''; }
    updateStats();
    renderTable();
    const dashTokens = el('dash-tokens');
    if (dashTokens) dashTokens.textContent = allTokens.length;

  } catch (err) {
    console.error('[Settings] RTDB error:', err);
    const dbStatus = el('settings-db-status');
    if (dbStatus) { dbStatus.textContent = 'Load failed'; dbStatus.style.color = '#e74c3c'; }
    const sc = el('settings-subscriber-content');
    if (sc) sc.innerHTML = `
      <div class="settings-empty-state">
        <span>⚠️</span>
        <p>${err.message}</p>
      </div>`;
  }
}

function updateStats() {
  const nowMs   = now();
  const active  = allTokens.filter(t => typeof t.lastUpdated === 'number' && (nowMs - t.lastUpdated) < ACTIVE_DAYS).length;
  const mobile  = allTokens.filter(t => t.deviceType === 'mobile').length;
  const desktop = allTokens.filter(t => t.deviceType === 'desktop').length;

  const ids = { total: allTokens.length, active, mobile, desktop };
  Object.entries(ids).forEach(([k, v]) => {
    const e = el(`settings-stat-${k}`); if (e) e.textContent = v;
  });

  const platforms = {};
  allTokens.forEach(t => { const p = t.platform || 'other'; platforms[p] = (platforms[p] || 0) + 1; });
  const pb = el('settings-platform-bar');
  if (pb) pb.innerHTML = Object.entries(platforms).map(([p, c]) =>
    `<div class="platform-pill"><span class="pval">${c}</span><span class="plbl">${p}</span></div>`
  ).join('');
}

function renderTable() {
  const wrap = el('settings-subscriber-content');
  if (!wrap) return;
  if (!allTokens.length) {
    wrap.innerHTML = `<div class="settings-empty-state"><span>🔔</span><p>No subscribers yet.</p></div>`;
    return;
  }
  const nowMs = now();
  const rows  = [...allTokens]
    .sort((a, b) => (b.lastUpdated || 0) - (a.lastUpdated || 0))
    .map((t, i) => {
      const lu  = typeof t.lastUpdated === 'number' ? t.lastUpdated : 0;
      const act = lu && (nowMs - lu) < ACTIVE_DAYS;
      const dev = t.deviceType || 'unknown';
      return `<tr>
        <td>${i + 1}</td>
        <td><span class="pill ${act ? 'pill-active' : 'pill-stale'}">${act ? '● Active' : '○ Stale'}</span></td>
        <td>${t.platform || '—'} / ${t.browser || '—'}</td>
        <td><span class="pill ${dev === 'mobile' ? 'pill-mobile' : dev === 'tablet' ? 'pill-tablet' : 'pill-desktop'}">${dev}</span></td>
        <td class="token-mono">…${(t.token || '').slice(-20)}</td>
        <td style="white-space:nowrap;color:var(--s-muted)">${lu ? new Date(lu).toLocaleString() : '—'}</td>
      </tr>`;
    }).join('');

  wrap.innerHTML = `
    <div class="settings-table-wrap">
      <table>
        <thead><tr>
          <th>#</th><th>Status</th><th>Platform / Browser</th>
          <th>Device</th><th>Token (last 20)</th><th>Last Seen</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

/* ══════════════════════════════════════════════════════════════
   FCM HTTP v1 — JWT + OAuth + Send
══════════════════════════════════════════════════════════════ */
function b64url(str) {
  return btoa(str).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}
function objToB64url(obj) {
  return b64url(unescape(encodeURIComponent(JSON.stringify(obj))));
}

async function importPrivateKey(pem) {
  const stripped = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\s+/g, '');
  const binary = Uint8Array.from(atob(stripped), c => c.charCodeAt(0));
  return crypto.subtle.importKey(
    'pkcs8', binary.buffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false, ['sign']
  );
}

async function createJWT(clientEmail, privateKey) {
  const cryptoKey = await importPrivateKey(privateKey);
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + 3600;
  const header  = objToB64url({ alg: 'RS256', typ: 'JWT' });
  const payload = objToB64url({
    iss: clientEmail, scope: FCM_SCOPE,
    aud: 'https://oauth2.googleapis.com/token', iat, exp
  });
  const sigInput  = `${header}.${payload}`;
  const encoded   = new TextEncoder().encode(sigInput);
  const sigBuffer = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey, encoded);
  const sigB64    = b64url(String.fromCharCode(...new Uint8Array(sigBuffer)));
  return `${sigInput}.${sigB64}`;
}

async function fetchAccessToken(clientEmail, privateKey) {
  const jwt = await createJWT(clientEmail, privateKey);
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt })
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error_description || `OAuth error ${res.status}`);
  }
  const data = await res.json();
  return data.access_token;
}

async function getAccessToken(clientEmail, privateKey) {
  const cached = sessionStorage.getItem(TOKEN_CACHE);
  const expiry  = parseInt(sessionStorage.getItem(TOKEN_EXP) || '0', 10);
  if (cached && now() < expiry - 60_000) return cached;
  const token = await fetchAccessToken(clientEmail, privateKey);
  sessionStorage.setItem(TOKEN_CACHE, token);
  sessionStorage.setItem(TOKEN_EXP,   String(now() + 3_600_000));
  return token;
}

async function sendOne(accessToken, fcmToken, title, body, url) {
  const res = await fetch(FCM_URL, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: {
        token: fcmToken,
        notification: { title, body },
        webpush: {
          fcm_options: { link: url },
          notification: { title, body, icon: ICON_URL, badge: ICON_URL, requireInteraction: false, vibrate: [200, 100, 200] }
        },
        data: { click_action: url }
      }
    })
  });
  if (res.status === 404) return false;
  return res.ok;
}

async function sendAll(accessToken, tokens, title, body, url) {
  let done = 0, success = 0, fail = 0;
  const total = tokens.length;
  const updateProgress = () => {
    const pct = Math.round((done / total) * 100);
    const pb = el('settings-progress-bar'); if (pb) pb.style.width = `${pct}%`;
    const pl = el('settings-progress-label'); if (pl) pl.textContent = `Sent ${done} of ${total}…`;
  };
  for (let i = 0; i < total; i += PARALLEL) {
    const batch   = tokens.slice(i, i + PARALLEL);
    const results = await Promise.allSettled(batch.map(t => sendOne(accessToken, t, title, body, url)));
    results.forEach(r => {
      if (r.status === 'fulfilled' && r.value) success++;
      else fail++;
      done++;
    });
    updateProgress();
  }
  return { success, fail };
}

/* ── App Control ─────────────────────────────────────────────── */

/**
 * Get an SA OAuth token scoped for Firebase admin operations
 * (RTDB REST writes + rules management).
 */
async function getAdminToken() {
  const saRaw = localStorage.getItem(SA_KEY);
  if (!saRaw) throw new Error('No Service Account credentials. Open the 🔑 Settings tab and paste your SA JSON first.');
  const saData = JSON.parse(saRaw);

  /* Use a separate cache key for the admin (broader) scope */
  const ADMIN_CACHE     = 'je-admin-oauth-admin-token';
  const ADMIN_CACHE_EXP = 'je-admin-oauth-admin-exp';
  const cached = sessionStorage.getItem(ADMIN_CACHE);
  const expiry = parseInt(sessionStorage.getItem(ADMIN_CACHE_EXP) || '0', 10);
  if (cached && now() < expiry - 60_000) return cached;

  /* Build JWT with the admin scope */
  const cryptoKey = await importPrivateKey(saData.private_key);
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + 3600;
  const header  = objToB64url({ alg: 'RS256', typ: 'JWT' });
  const payload = objToB64url({
    iss: saData.client_email, scope: ADMIN_SCOPE,
    aud: 'https://oauth2.googleapis.com/token', iat, exp
  });
  const sigInput  = `${header}.${payload}`;
  const encoded   = new TextEncoder().encode(sigInput);
  const sigBuffer = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey, encoded);
  const sigB64    = b64url(String.fromCharCode(...new Uint8Array(sigBuffer)));
  const jwt       = `${sigInput}.${sigB64}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt })
  });
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error(d.error_description || `OAuth error ${res.status}`);
  }
  const d = await res.json();
  sessionStorage.setItem(ADMIN_CACHE, d.access_token);
  sessionStorage.setItem(ADMIN_CACHE_EXP, String(now() + 3_600_000));
  return d.access_token;
}

/**
 * loadAppStatus — reads /appSettings from RTDB using SA token when available.
 * Falls back to public read (works after setupRtdbRules() has been run).
 */
async function loadAppStatus() {
  const statusBtns = document.querySelectorAll('.app-control-btn');

  /* Show loading state */
  const badge = el('app-control-status-badge');
  if (badge) { badge.textContent = '⏳ Loading…'; badge.dataset.status = ''; }

  try {
    let url = `${RTDB_URL_BASE}/appSettings.json`;
    try {
      const token = await getAdminToken();
      url = `${RTDB_URL_BASE}/appSettings.json?access_token=${token}`;
    } catch (saErr) {
      console.warn('[AppControl] SA token unavailable for loadAppStatus, trying public read:', saErr.message);
    }

    const res  = await fetch(url);
    if (!res.ok) throw new Error(`RTDB read error ${res.status} — run "Setup Firebase Rules" first.`);
    const data   = await res.json();
    const status = data?.status || 'online';
    const msg    = data?.maintenanceMessage || '';

    statusBtns.forEach(btn => {
      btn.classList.toggle('active-mode', btn.dataset.mode === status);
    });

    const msgArea = el('maintenance-message-input');
    if (msgArea) msgArea.value = msg;

    if (badge) {
      const map = { online: '🟢 Online', readonly: '🟡 Read-Only', maintenance: '🔴 Maintenance', offline: '⛔ Offline', shutdown: '⛔ Shutdown' };
      badge.textContent = map[status] || status;
      badge.dataset.status = status;
    }

    hideResult('app-control-setup-result');
  } catch (err) {
    console.warn('[Settings] App status load failed:', err.message);
    if (badge) { badge.textContent = '⚠️ Load failed'; badge.dataset.status = ''; }
    showResult('app-control-setup-result',
      `⚠️ Could not read /appSettings: ${err.message}`, 'error');
  }
}

/**
 * setAppStatus — writes new status to RTDB using SA OAuth token.
 * This REQUIRES Service Account credentials in the 🔑 Settings tab.
 */
async function setAppStatus(mode, message) {
  const code = prompt('Enter the 4-digit App Control code to apply this change:');
  if (code === null) return;
  if (code.trim() !== APP_CONTROL_CODE) {
    showResult('app-control-setup-result', '❌ Incorrect code. Changes not applied.', 'error');
    return;
  }

  showResult('app-control-setup-result', '⏳ Authenticating with Firebase…', 'info');

  try {
    const token   = await getAdminToken();
    const payload = JSON.stringify({
      status:             mode,
      maintenanceMessage: message || '',
      updatedAt:          Date.now()
    });

    const res = await fetch(`${RTDB_URL_BASE}/appSettings.json?access_token=${token}`, {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json' },
      body:    payload
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Firebase error ${res.status}: ${body}`);
    }

    showResult('app-control-setup-result',
      `✅ App status set to "${mode}" successfully. All connected devices will update in seconds.`, 'success');

    loadAppStatus();

    /* Notify all listeners on this tab immediately */
    window.dispatchEvent(new CustomEvent('app-status-changed', {
      detail: { status: mode, maintenanceMessage: message || '' }
    }));

  } catch (err) {
    showResult('app-control-setup-result', `❌ Failed to update status: ${err.message}`, 'error');
  }
}

/**
 * showManualRulesSetup — called when API returns 401/403.
 * Reveals the manual-rules-guide div with the correct JSON pre-filled.
 */
function showManualRulesSetup(rulesObj) {
  const guide = el('manual-rules-guide');
  const pre   = el('manual-rules-json');
  const fallback = {
    rules: {
      appSettings:   { '.read': true, '.write': true },
      'fcm-tokens':  { '.write': true, '.read': true }
    }
  };
  if (guide) guide.style.display = 'block';
  if (pre)   pre.textContent = JSON.stringify(rulesObj || fallback, null, 2);
}

/**
 * setupRtdbRules — one-time setup to make /appSettings publicly readable.
 * Must be run once by the admin before real-time sync works on all devices.
 *
 * Uses the Service Account to:
 *  1. Fetch current RTDB security rules
 *  2. Add/update: appSettings { .read: true, .write: true }
 *  3. Keep existing fcm-tokens rules
 *  4. PUT the merged rules back
 *  5. Write an initial "online" status to /appSettings
 */
async function setupRtdbRules() {
  showResult('app-control-setup-result', '⏳ Checking current Firebase rules…', 'info');

  /* ── PRE-CHECK: are rules already working? ─────────────────────────
     Try a public read on /appSettings (no auth required if .read:true).
     If this succeeds, the rules are already configured correctly and we
     SKIP the rules-API call entirely (which always returns 401 if the SA
     doesn't have the Firebase Admin IAM role).
  ─────────────────────────────────────────────────────────────────── */
  try {
    const preCheck = await fetch(`${RTDB_URL_BASE}/appSettings.json`, { cache: 'no-store' });
    if (preCheck.ok) {
      const existing = await preCheck.json();
      showResult('app-control-setup-result',
        '⏳ Rules already active — writing initial status…', 'info');

      /* Try to write/confirm initial status using admin token */
      let token;
      try { token = await getAdminToken(); } catch { /* skip if no SA */ }

      if (token) {
        const initRes = await fetch(
          `${RTDB_URL_BASE}/appSettings.json?access_token=${token}`,
          {
            method:  existing ? 'PATCH' : 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify(
              existing
                ? { updatedAt: Date.now() }  /* just touch timestamp */
                : { status: 'online', maintenanceMessage: '', updatedAt: Date.now() }
            )
          }
        );
        if (!initRes.ok) {
          console.warn('[SetupRules] Status write failed:', initRes.status);
        }
      }

      showResult('app-control-setup-result',
        '✅ Firebase is already configured! App Control is active on all devices. ' +
        'Real-time sync is working. You can now use the mode buttons below.',
        'success');
      loadAppStatus();

      const setupBtn = el('setup-rtdb-rules-btn');
      if (setupBtn) { setupBtn.textContent = '✅ Already Configured'; setupBtn.disabled = true; }
      return; /* ← done — no rules-API call needed */
    }
  } catch { /* network error — fall through to full setup */ }

  /* ── FULL SETUP: rules not yet set ────────────────────────────────
     /appSettings is not publicly readable yet. Attempt to set rules via
     the API. This requires Firebase Admin IAM role on the service account.
     If it fails (401), show the manual instructions.
  ─────────────────────────────────────────────────────────────────── */
  showResult('app-control-setup-result', '⏳ Getting admin token…', 'info');
  let token;
  try {
    token = await getAdminToken();
  } catch (err) {
    showResult('app-control-setup-result',
      `❌ SA credentials needed: ${err.message}`, 'error');
    return;
  }

  try {
    /* Fetch current rules */
    showResult('app-control-setup-result', '⏳ Fetching current Firebase rules…', 'info');
    const getRulesRes = await fetch(
      `${RTDB_URL_BASE}/.settings/rules.json?access_token=${token}`
    );

    let currentRules = { rules: {} };
    if (getRulesRes.ok) {
      currentRules = await getRulesRes.json();
    } else {
      console.warn('[SetupRules] Could not fetch existing rules, starting fresh.');
    }
    currentRules.rules = currentRules.rules || {};

    /* Merge required paths */
    currentRules.rules.appSettings  = { '.read': true, '.write': true };
    currentRules.rules['fcm-tokens'] = { '.write': true, '.read': true };

    /* Write merged rules */
    showResult('app-control-setup-result', '⏳ Applying security rules…', 'info');
    const putRulesRes = await fetch(
      `${RTDB_URL_BASE}/.settings/rules.json?access_token=${token}`,
      {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(currentRules)
      }
    );

    if (!putRulesRes.ok) {
      const errBody = await putRulesRes.text();
      if (putRulesRes.status === 401 || putRulesRes.status === 403) {
        showManualRulesSetup(currentRules);
        throw new Error(
          `Rules API: 401 Unauthorized — your service account needs the ` +
          `"Firebase Realtime Database Admin" IAM role in Google Cloud Console. ` +
          `Manual setup instructions are now shown below the button.`
        );
      }
      throw new Error(`Rules update failed ${putRulesRes.status}: ${errBody}`);
    }

    /* Write initial /appSettings */
    showResult('app-control-setup-result', '⏳ Initialising /appSettings…', 'info');
    const initRes = await fetch(
      `${RTDB_URL_BASE}/appSettings.json?access_token=${token}`,
      {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ status: 'online', maintenanceMessage: '', updatedAt: Date.now() })
      }
    );

    if (!initRes.ok) {
      const errBody = await initRes.text();
      throw new Error(`Initial write failed ${initRes.status}: ${errBody}`);
    }

    showResult('app-control-setup-result',
      '✅ Firebase rules updated! App Control is now fully active on all devices. ' +
      'Real-time sync will activate within seconds.', 'success');

    loadAppStatus();

    const setupBtn = el('setup-rtdb-rules-btn');
    if (setupBtn) { setupBtn.textContent = '✅ Rules Configured'; setupBtn.disabled = true; }

  } catch (err) {
    showResult('app-control-setup-result', `❌ Setup failed: ${err.message}`, 'error');
  }
}

/* ── Admin Diagnostics ───────────────────────────────────────── */
async function runDiagnostics() {
  const container = el('diagnostics-result');
  if (!container) return;

  container.innerHTML = '<div style="color:rgba(255,255,255,0.5);font-size:0.85rem">⏳ Running diagnostics…</div>';

  const rows = [];

  function row(icon, label, status, detail) {
    const color = status === 'ok' ? '#2ecc71' : status === 'warn' ? '#e67e22' : '#e74c3c';
    return `<div style="display:flex;align-items:flex-start;gap:10px;padding:10px 0;
             border-bottom:1px solid rgba(255,255,255,0.07)">
      <span style="font-size:1.1rem;flex-shrink:0">${icon}</span>
      <div style="flex:1;min-width:0">
        <div style="font-size:0.85rem;font-weight:600;color:#fff">${label}</div>
        ${detail ? `<div style="font-size:0.77rem;color:rgba(255,255,255,0.52);
          margin-top:3px;word-break:break-word;line-height:1.5">${detail}</div>` : ''}
      </div>
      <span style="font-size:0.72rem;font-weight:700;color:${color};flex-shrink:0;
        text-transform:uppercase;padding-top:2px">${status}</span>
    </div>`;
  }

  /* 1 — Firebase SDK */
  try {
    const { app } = await import('./firebase.js');
    rows.push(row('🔥', 'Firebase SDK', 'ok',
      `App: ${app.name} | Project: ${app.options.projectId}`));
  } catch (err) {
    rows.push(row('🔥', 'Firebase SDK', 'fail', err.message));
  }

  /* 2 — RTDB public read (/appSettings) */
  try {
    const res = await fetch(`${RTDB_URL_BASE}/appSettings.json`, { cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      rows.push(row('🗄️', 'RTDB — public read (/appSettings)', 'ok',
        `status: "${data?.status || '(null)'}" | updatedAt: ${data?.updatedAt ? new Date(data.updatedAt).toLocaleString() : 'never'}`));
    } else if (res.status === 401 || res.status === 403) {
      rows.push(row('🗄️', 'RTDB — public read (/appSettings)', 'warn',
        `${res.status} — rules not configured. Click "Setup Firebase Rules" on the App Control tab.`));
    } else {
      rows.push(row('🗄️', 'RTDB — public read (/appSettings)', 'fail', `HTTP ${res.status}`));
    }
  } catch (err) {
    rows.push(row('🗄️', 'RTDB — public read (/appSettings)', 'fail', err.message));
  }

  /* 3 — RTDB admin write (via SA token) */
  const saRaw = localStorage.getItem(SA_KEY);
  if (saRaw) {
    try {
      const sa = JSON.parse(saRaw);
      const token = await getAdminToken();
      const res = await fetch(
        `${RTDB_URL_BASE}/.info/serverTimeOffset.json?access_token=${token}`,
        { cache: 'no-store' }
      );
      if (res.ok) {
        rows.push(row('🔐', 'RTDB admin token (SA)', 'ok',
          `Authenticated as: ${sa.client_email}`));
      } else {
        rows.push(row('🔐', 'RTDB admin token (SA)', 'warn',
          `HTTP ${res.status} — SA may lack database permissions`));
      }
    } catch (err) {
      rows.push(row('🔐', 'RTDB admin token (SA)', 'warn',
        `Token error: ${err.message}`));
    }
  } else {
    rows.push(row('🔐', 'RTDB admin token (SA)', 'warn',
      'No Service Account saved. Open 🔑 Settings tab and paste your SA JSON.'));
  }

  /* 4 — Rules API write permission */
  if (saRaw) {
    try {
      const token = await getAdminToken();
      const getRules = await fetch(
        `${RTDB_URL_BASE}/.settings/rules.json?access_token=${token}`,
        { cache: 'no-store' }
      );
      if (getRules.ok) {
        rows.push(row('📋', 'Rules API (read)', 'ok',
          'SA can read RTDB security rules'));
        const putRules = await fetch(
          `${RTDB_URL_BASE}/.settings/rules.json?access_token=${token}`,
          { method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: await getRules.clone().text() }
        );
        if (putRules.ok) {
          rows.push(row('📋', 'Rules API (write)', 'ok',
            'SA has Firebase Admin IAM role — automatic setup will succeed'));
        } else {
          rows.push(row('📋', 'Rules API (write)', 'warn',
            `${putRules.status} — SA lacks "Firebase Realtime Database Admin" IAM role. Use manual setup.`));
        }
      } else {
        rows.push(row('📋', 'Rules API', 'warn',
          `${getRules.status} — SA cannot read rules. Grant "Firebase Admin" IAM role, or use manual setup.`));
      }
    } catch (err) {
      rows.push(row('📋', 'Rules API', 'warn', err.message));
    }
  }

  /* 5 — Firebase Messaging */
  try {
    const { messaging } = await import('./firebase.js');
    if (messaging) {
      const perm = 'Notification' in window ? Notification.permission : 'unsupported';
      rows.push(row('📨', 'Firebase Messaging (FCM)', 'ok',
        `Initialized | Notification permission: ${perm}`));
    } else {
      rows.push(row('📨', 'Firebase Messaging (FCM)', 'warn',
        'Messaging is null — not supported in this context (expected on iOS Safari)'));
    }
  } catch (err) {
    rows.push(row('📨', 'Firebase Messaging (FCM)', 'fail', err.message));
  }

  /* 6 — Service Worker */
  if ('serviceWorker' in navigator) {
    try {
      const reg = await navigator.serviceWorker.ready;
      const sw  = reg.active;
      rows.push(row('⚙️', 'Service Worker', 'ok',
        `State: ${sw?.state || 'unknown'} | Scope: ${reg.scope}`));
    } catch (err) {
      rows.push(row('⚙️', 'Service Worker', 'fail', err.message));
    }
  } else {
    rows.push(row('⚙️', 'Service Worker', 'warn',
      'Service workers not supported in this browser'));
  }

  /* 7 — FCM Token in localStorage */
  const storedToken = localStorage.getItem('fcm-token');
  if (storedToken) {
    const savedAt  = localStorage.getItem('fcm-token-saved-at') || 'unknown';
    const rtdbOk   = localStorage.getItem('fcm-token-rtdb-ok');
    rows.push(row('🔑', 'FCM Token', 'ok',
      `…${storedToken.slice(-20)} | RTDB saved: ${rtdbOk === 'true' ? '✅' : rtdbOk === 'false' ? '❌' : '?'} | At: ${savedAt}`));
  } else {
    rows.push(row('🔑', 'FCM Token', 'warn',
      'No FCM token stored — user has not granted notification permission yet'));
  }

  /* 8 — Realtime listener test */
  try {
    const { rtdb } = await import('./firebase.js');
    const { ref, onValue, off } = await import(
      'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js'
    );
    if (!rtdb) throw new Error('RTDB not initialized');
    const result = await new Promise((resolve, reject) => {
      const testRef = ref(rtdb, 'appSettings');
      const timer   = setTimeout(() => { off(testRef); reject(new Error('Timeout after 5 s')); }, 5000);
      onValue(testRef, snapshot => {
        clearTimeout(timer);
        off(testRef);
        resolve(snapshot.val());
      }, err => {
        clearTimeout(timer);
        off(testRef);
        reject(err);
      });
    });
    const st = result?.status || '(null)';
    rows.push(row('📡', 'Realtime listener (/appSettings)', 'ok',
      `Active — current status: "${st}"`));
  } catch (err) {
    const isPerms = /permission_denied|Permission denied/i.test(err.message);
    rows.push(row('📡', 'Realtime listener (/appSettings)',
      isPerms ? 'warn' : 'fail',
      `${err.message}${isPerms ? ' — run "Setup Firebase Rules" on the App Control tab to fix' : ''}`));
  }

  container.innerHTML =
    `<div style="font-size:0.78rem;color:rgba(255,255,255,0.35);margin-bottom:8px">
       Checked at: ${new Date().toLocaleTimeString()}
     </div>` +
    rows.join('') +
    `<div style="margin-top:12px;font-size:0.74rem;color:rgba(255,255,255,0.3)">
       🟢 ok · 🟠 warn · 🔴 fail
     </div>`;
}

/* ── Settings (Service Account) ──────────────────────────────── */
function refreshKeyStatus() {
  const raw = localStorage.getItem(SA_KEY);
  const s   = el('settings-key-status');
  if (!s) return;
  if (!raw) { s.textContent = '⚠ No credentials saved'; s.className = 'settings-key-status missing'; return; }
  try {
    const d = JSON.parse(raw);
    if (d.client_email && d.private_key) {
      s.textContent = `✅ Credentials saved — ${d.client_email}`;
      s.className = 'settings-key-status ok';
    } else {
      s.textContent = '⚠ Saved JSON is missing required fields'; s.className = 'settings-key-status missing';
    }
  } catch { s.textContent = '⚠ Saved data is invalid JSON'; s.className = 'settings-key-status missing'; }
}

/* ── Bind all event listeners ────────────────────────────────── */
function bindEvents() {
  /* Gate form */
  const gateForm = el('settings-gate-form');
  if (gateForm) {
    gateForm.addEventListener('submit', e => {
      e.preventDefault();
      const pwd = el('settings-pwd');
      if (pwd && pwd.value.trim() === CORRECT_PW) {
        login();
        showAdminContent();
      } else {
        const err = el('settings-gate-error');
        if (err) err.classList.add('show');
        if (pwd) { pwd.value = ''; pwd.focus(); }
      }
    });
  }

  const settingsPwd = el('settings-pwd');
  if (settingsPwd) {
    settingsPwd.addEventListener('input', () => {
      const err = el('settings-gate-error'); if (err) err.classList.remove('show');
    });
  }

  /* Logout */
  const logoutBtn = el('settings-logout-btn');
  if (logoutBtn) logoutBtn.addEventListener('click', logout);

  /* Tabs */
  document.querySelectorAll('.settings-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  /* Notifications: char counters + preview */
  const notifTitle = el('settings-notif-title');
  if (notifTitle) {
    notifTitle.addEventListener('input', () => {
      const n = notifTitle.value.length;
      const c = el('settings-title-count');
      if (c) { c.textContent = `${n} / 60`; c.className = 'settings-char-count' + (n > 54 ? (n >= 60 ? ' over' : ' warn') : ''); }
      const pt = el('settings-preview-title'); if (pt) pt.textContent = notifTitle.value || 'Notification Title';
    });
  }
  const notifBody = el('settings-notif-body');
  if (notifBody) {
    notifBody.addEventListener('input', () => {
      const n = notifBody.value.length;
      const c = el('settings-body-count');
      if (c) { c.textContent = `${n} / 160`; c.className = 'settings-char-count' + (n > 144 ? (n >= 160 ? ' over' : ' warn') : ''); }
      const pb = el('settings-preview-body'); if (pb) pb.textContent = notifBody.value || 'Your message will appear here.';
    });
  }

  /* Send button */
  const sendBtn = el('settings-send-btn');
  if (sendBtn) {
    sendBtn.addEventListener('click', async () => {
      const title = el('settings-notif-title')?.value.trim();
      const body  = el('settings-notif-body')?.value.trim();
      const url   = el('settings-notif-url')?.value.trim() || 'https://daviddchucks-hash.github.io/Church-website-/';

      hideResult('settings-result-banner');
      if (!title) return showResult('settings-result-banner', '⚠ Please enter a notification title.', 'error');
      if (!body)  return showResult('settings-result-banner', '⚠ Please enter a message body.', 'error');

      const saRaw = localStorage.getItem(SA_KEY);
      if (!saRaw) return showResult('settings-result-banner', '⚠ No credentials saved. Open the Settings tab and add your Service Account JSON.', 'error');
      let saData;
      try { saData = JSON.parse(saRaw); } catch { return showResult('settings-result-banner', '⚠ Saved credentials are invalid JSON.', 'error'); }
      const { client_email, private_key } = saData;
      if (!client_email || !private_key) return showResult('settings-result-banner', '⚠ Credentials missing client_email or private_key.', 'error');

      const tokens = allTokens.map(t => t.token).filter(Boolean);
      if (!tokens.length) {
        await loadTokens();
        const freshTokens = allTokens.map(t => t.token).filter(Boolean);
        if (!freshTokens.length) return showResult('settings-result-banner', '⚠ No subscribers found. Check your RTDB.', 'error');
      }

      sendBtn.disabled = true;
      const spinner = el('settings-send-spinner'); if (spinner) spinner.style.display = 'inline-block';
      const label   = el('settings-send-label');   if (label)  label.textContent = 'Sending…';
      const pw = el('settings-progress-wrap'); if (pw) pw.style.display = 'block';
      const pb = el('settings-progress-bar');  if (pb) pb.style.width = '0%';
      const pl = el('settings-progress-label'); if (pl) pl.textContent = 'Getting access token…';

      try {
        const accessToken = await getAccessToken(client_email, private_key);
        if (pl) pl.textContent = 'Starting delivery…';
        const finalTokens = allTokens.map(t => t.token).filter(Boolean);
        const { success, fail } = await sendAll(accessToken, finalTokens, title, body, url);
        addNotifHistory(title, body, success, fail, finalTokens.length);
        showResult('settings-result-banner', `✅ Done! ${success} delivered${fail ? `, ${fail} failed` : ''}. Total: ${finalTokens.length}.`, 'success');
        /* Reset form */
        if (el('settings-notif-title')) el('settings-notif-title').value = '';
        if (el('settings-notif-body'))  el('settings-notif-body').value  = '';
        if (el('settings-preview-title')) el('settings-preview-title').textContent = 'Notification Title';
        if (el('settings-preview-body'))  el('settings-preview-body').textContent  = 'Your message will appear here.';
        if (el('settings-title-count'))   el('settings-title-count').textContent   = '0 / 60';
        if (el('settings-body-count'))    el('settings-body-count').textContent     = '0 / 160';
      } catch (err) {
        let hint = '';
        if (/invalid_grant|invalid JWT|key/i.test(err.message)) hint = ' Check Service Account JSON is correct.';
        showResult('settings-result-banner', `❌ ${err.message}.${hint}`, 'error');
      } finally {
        sendBtn.disabled = false;
        if (spinner) spinner.style.display = 'none';
        if (label)   label.textContent = '📣 Send to All Subscribers';
        if (pw) pw.style.display = 'none';
      }
    });
  }

  /* Refresh subscribers */
  const refreshBtn = el('settings-refresh-btn');
  if (refreshBtn) refreshBtn.addEventListener('click', loadTokens);

  /* App Control buttons */
  document.querySelectorAll('.app-control-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.mode;
      const msg  = el('maintenance-message-input')?.value.trim() || '';
      setAppStatus(mode, msg);
    });
  });

  /* Save maintenance message */
  const saveMsgBtn = el('save-maintenance-msg-btn');
  if (saveMsgBtn) {
    saveMsgBtn.addEventListener('click', async () => {
      const code = prompt('Enter the 4-digit App Control code:');
      if (code === null) return;
      if (code.trim() !== APP_CONTROL_CODE) {
        showResult('app-control-setup-result', '❌ Incorrect code.', 'error');
        return;
      }
      const msg = el('maintenance-message-input')?.value.trim() || '';
      showResult('app-control-setup-result', '⏳ Saving…', 'info');
      try {
        const token = await getAdminToken();
        const res = await fetch(
          `${RTDB_URL_BASE}/appSettings/maintenanceMessage.json?access_token=${token}`,
          { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(msg) }
        );
        if (!res.ok) throw new Error(`Firebase error ${res.status}`);
        showResult('app-control-setup-result', '✅ Maintenance message saved and live on all devices.', 'success');
      } catch (err) {
        showResult('app-control-setup-result', `❌ ${err.message}`, 'error');
      }
    });
  }

  /* Setup Firebase Rules button (one-time) */
  const setupRulesBtn = el('setup-rtdb-rules-btn');
  if (setupRulesBtn) {
    setupRulesBtn.addEventListener('click', setupRtdbRules);
  }

  /* Save Service Account */
  const saveSaBtn = el('settings-save-sa-btn');
  if (saveSaBtn) {
    saveSaBtn.addEventListener('click', () => {
      const raw = el('settings-sa-json')?.value.trim();
      if (!raw) return showResult('settings-sa-result', '⚠ Please paste your Service Account JSON.', 'error');
      let parsed;
      try { parsed = JSON.parse(raw); } catch { return showResult('settings-sa-result', '⚠ Invalid JSON.', 'error'); }
      if (!parsed.client_email || !parsed.private_key) return showResult('settings-sa-result', '⚠ JSON is missing client_email or private_key.', 'error');
      if (parsed.project_id && parsed.project_id !== PROJECT_ID) return showResult('settings-sa-result', `⚠ Key belongs to project "${parsed.project_id}", not "${PROJECT_ID}".`, 'error');
      localStorage.setItem(SA_KEY, raw);
      sessionStorage.removeItem(TOKEN_CACHE);
      sessionStorage.removeItem(TOKEN_EXP);
      const saJsonEl = el('settings-sa-json'); if (saJsonEl) saJsonEl.value = '';
      refreshKeyStatus();
      showResult('settings-sa-result', '✅ Credentials saved. Loading subscribers now…', 'success');
      loadTokens();
    });
  }

  /* Clear Service Account */
  const clearSaBtn = el('settings-clear-sa-btn');
  if (clearSaBtn) {
    clearSaBtn.addEventListener('click', () => {
      if (!confirm('Remove saved Service Account credentials? You will need to re-paste them to send notifications.')) return;
      localStorage.removeItem(SA_KEY);
      sessionStorage.removeItem(TOKEN_CACHE);
      sessionStorage.removeItem(TOKEN_EXP);
      refreshKeyStatus();
      showResult('settings-sa-result', '✅ Credentials cleared.', 'success');
    });
  }

  /* Quick action buttons on Dashboard */
  document.querySelectorAll('[data-goto]').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.goto));
  });

  /* Copy Rules JSON button (shown after 401 on setup) */
  const copyRulesBtn = el('copy-rules-btn');
  if (copyRulesBtn) {
    copyRulesBtn.addEventListener('click', () => {
      const pre = el('manual-rules-json');
      if (!pre) return;
      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(pre.textContent).then(() => {
          copyRulesBtn.textContent = '✅ Copied!';
          setTimeout(() => { copyRulesBtn.textContent = '📋 Copy Rules JSON'; }, 2000);
        }).catch(() => { /* fallback below */ });
      } else {
        /* Older browser fallback */
        const sel   = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(pre);
        sel?.removeAllRanges();
        sel?.addRange(range);
      }
    });
  }

  /* Run Diagnostics button */
  const runDiagBtn = el('run-diagnostics-btn');
  if (runDiagBtn) runDiagBtn.addEventListener('click', runDiagnostics);
}

/* ── Public entry point ──────────────────────────────────────── */
export function initSettings() {
  bindEvents();
  console.log('[Settings] Initialized');
}

export function onSettingsPageEnter() {
  if (isAdminAuthed()) {
    showAdminContent();
  } else {
    showGate();
  }
  renderNotifHistory();
  refreshKeyStatus();
}
