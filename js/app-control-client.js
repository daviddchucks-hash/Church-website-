/* ==============================================
   APP-CONTROL-CLIENT.JS — Firebase RTDB Listener
   Jesus Embassy PWA
   -----------------------------------------------
   Real-time App Control via Firebase Realtime Database.

   MIGRATION NOTE:
   This file was previously a polling client for
   the Node.js server.js (GET /api/app-status every
   5 seconds). That approach could not work on GitHub
   Pages because server.js requires a Node.js host.

   REPLACEMENT:
   Uses Firebase Realtime Database onValue() listener
   at path /appSettings for instant real-time updates.
   No external server required — works entirely via
   Firebase client SDK. Changes propagate to ALL
   connected users instantly (sub-second latency).

   INTERFACE (unchanged from v1 — app.js still works):
   - startAppControlPoller()  — start real-time listener
   - stopAppControlPoller()   — detach listener
   - isPollerRunning()        — returns true if active
   - getStatusEndpoint()      — returns RTDB path string
   - fetchCurrentStatus()     — one-shot REST fetch
============================================== */

import { rtdb } from './firebase.js';
import {
  ref,
  onValue
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js';

/* ── Configuration ───────────────────────────────── */
const RTDB_STATUS_PATH = 'appSettings';
const RTDB_REST_URL    = 'https://church-app-637f7-default-rtdb.firebaseio.com/appSettings.json';

/* ── Internal state ──────────────────────────────── */
let _lastStatus      = null;
let _listenerActive  = false;
let _unsubscribe     = null;

/* ── Helpers ─────────────────────────────────────── */
function booleanToMode(data) {
  if (!data)                  return 'online';
  if (data.shutdown)          return 'shutdown';
  if (data.maintenance)       return 'maintenance';
  if (data.readOnly)          return 'readonly';
  if (data.online === false)  return 'offline';
  return 'online';
}

/* ── Apply and broadcast status change ───────────── */
function applyStatusData(data) {
  /* null snapshot means /appSettings node doesn't exist yet — treat as online */
  if (!data || typeof data !== 'object') data = {};

  const mode    = booleanToMode(data);
  const message = data.maintenanceMessage || '';

  /* Only dispatch if something actually changed */
  const fingerprint = `${mode}|${message}`;
  if (fingerprint === _lastStatus) return;
  _lastStatus = fingerprint;

  console.log('[AppControl] Status update →', mode, '| msg:', message || '(none)');

  window.dispatchEvent(new CustomEvent('app-status-changed', {
    detail: { status: mode, maintenanceMessage: message, raw: data }
  }));
}

/* ── Start real-time Firebase listener ───────────── */
export function startAppControlPoller() {
  if (_listenerActive) return;

  if (!rtdb) {
    console.warn('[AppControl] Firebase RTDB not initialized — App Control disabled');
    return;
  }

  _listenerActive = true;

  const statusRef = ref(rtdb, RTDB_STATUS_PATH);

  /* onValue fires immediately with current data, then on every change */
  _unsubscribe = onValue(
    statusRef,
    (snapshot) => {
      const data = snapshot.val();
      console.log('[AppControl] RTDB onValue received:', data);
      applyStatusData(data);
    },
    (error) => {
      console.error('[AppControl] RTDB listener error:', error.message,
        '— check /appSettings has ".read": true in Firebase Security Rules');
      /* Do NOT change app state on error — preserve last known status */
    }
  );

  console.log('[AppControl] ✅ Real-time RTDB listener active. Path:', RTDB_STATUS_PATH);
}

/* ── Stop the listener ───────────────────────────── */
export function stopAppControlPoller() {
  _listenerActive = false;
  if (_unsubscribe) {
    _unsubscribe();
    _unsubscribe = null;
    console.log('[AppControl] RTDB listener detached');
  }
}

/* ── Query current state ─────────────────────────── */
export function isPollerRunning()   { return _listenerActive; }
export function getStatusEndpoint() { return `Firebase RTDB: /${RTDB_STATUS_PATH}`; }

/* ── One-shot REST fetch (for admin panel reads) ──── */
export async function fetchCurrentStatus() {
  const res = await fetch(RTDB_REST_URL, {
    method: 'GET',
    cache:  'no-store',
    signal: AbortSignal.timeout(8000)
  });
  if (!res.ok) throw new Error(`RTDB REST error HTTP ${res.status}`);
  const data = await res.json();
  return data || {};
}
