/* ==============================================
   APP-CONTROL-CLIENT.JS — Status Checker
   Jesus Embassy PWA
   -----------------------------------------------
   Lightweight polling client for the App Control
   server. Polls /api/app-status every 5 seconds.
   No Firebase required.

   Dispatches window event 'app-status-changed'
   whenever status changes. Handles network failures
   gracefully — last known status is preserved.

   PWA: checks status immediately on launch.
============================================== */

/* ── Configuration ───────────────────────────────── */
/*
  APP_CONTROL_SERVER — set this to your Express server URL.
  Examples:
    'https://your-app.onrender.com'          ← Render.com
    'https://your-app.railway.app'           ← Railway
    'https://your-repl.replit.app'           ← Replit
    'http://localhost:3000'                  ← Local dev

  The server must expose GET /api/app-status
*/
const APP_CONTROL_SERVER = (() => {
  /* Allow runtime override via window.APP_CONTROL_SERVER */
  if (typeof window !== 'undefined' && window.APP_CONTROL_SERVER) {
    return window.APP_CONTROL_SERVER.replace(/\/$/, '');
  }
  /* ↓ Change this to your deployed server URL */
  return 'https://YOUR-SERVER-URL';
})();

const APP_STATUS_ENDPOINT = `${APP_CONTROL_SERVER}/api/app-status`;
const POLL_INTERVAL_MS    = 5000;   /* 5 seconds */
const FAIL_RETRY_MS       = 10000;  /* back-off on failure */

/* ── Internal state ──────────────────────────────── */
let _lastStatus       = null;
let _pollerTimer      = null;
let _pollerRunning    = false;
let _consecutiveFails = 0;

/* ── Helpers ─────────────────────────────────────── */
function booleanToMode(data) {
  if (!data)             return 'online';
  if (data.shutdown)     return 'shutdown';
  if (data.maintenance)  return 'maintenance';
  if (data.readOnly)     return 'readonly';
  if (data.online === false) return 'offline';
  return 'online';
}

/* ── Fetch status from server ────────────────────── */
async function fetchAppStatus() {
  const res = await fetch(APP_STATUS_ENDPOINT, {
    method: 'GET',
    cache:  'no-store',
    signal: AbortSignal.timeout(8000)  /* 8 s timeout */
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/* ── Apply and broadcast status change ───────────── */
function applyStatusData(data) {
  if (!data || typeof data !== 'object') return;

  const mode    = booleanToMode(data);
  const message = data.maintenanceMessage || '';

  /* Only dispatch if something changed */
  const fingerprint = `${mode}|${message}`;
  if (fingerprint === _lastStatus) return;
  _lastStatus = fingerprint;

  console.log('[AppControl] Status update →', mode, '| msg:', message || '(none)');

  window.dispatchEvent(new CustomEvent('app-status-changed', {
    detail: { status: mode, maintenanceMessage: message, raw: data }
  }));
}

/* ── Single poll cycle ───────────────────────────── */
async function pollOnce() {
  try {
    const data = await fetchAppStatus();
    _consecutiveFails = 0;
    applyStatusData(data);
  } catch (err) {
    _consecutiveFails++;
    /* Only warn after 2+ consecutive failures to reduce noise */
    if (_consecutiveFails >= 2) {
      console.warn('[AppControl] Status check failed ×' + _consecutiveFails + ':', err.message);
    }
    /* Don't change app state on network failure — preserve last known status */
  }
}

/* ── Start the poller ────────────────────────────── */
export function startAppControlPoller() {
  if (_pollerRunning) return;
  _pollerRunning = true;

  /* Immediate check on launch */
  pollOnce();

  /* Schedule recurring polls */
  function scheduleNext() {
    const interval = _consecutiveFails >= 3 ? FAIL_RETRY_MS : POLL_INTERVAL_MS;
    _pollerTimer = setTimeout(async () => {
      await pollOnce();
      if (_pollerRunning) scheduleNext();
    }, interval);
  }

  scheduleNext();
  console.log('[AppControl] Poller started. Endpoint:', APP_STATUS_ENDPOINT);
}

/* ── Stop the poller ─────────────────────────────── */
export function stopAppControlPoller() {
  _pollerRunning = false;
  if (_pollerTimer) { clearTimeout(_pollerTimer); _pollerTimer = null; }
}

/* ── Query current state ─────────────────────────── */
export function isPollerRunning()  { return _pollerRunning; }
export function getStatusEndpoint() { return APP_STATUS_ENDPOINT; }

/* ── One-shot fetch (for admin panel reads) ──────── */
export async function fetchCurrentStatus() {
  return fetchAppStatus();
}
