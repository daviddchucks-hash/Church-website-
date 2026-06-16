/* ==============================================
   NOTIFICATIONS.JS — Firebase Cloud Messaging
   Token Management & Firebase Realtime Database
   Jesus Embassy PWA
   -----------------------------------------------
   STORAGE: Firebase Realtime Database ONLY
   Path: /fcm-tokens/{tokenKey}

   All Firestore code removed. Tokens are stored
   exclusively in Firebase Realtime Database plus
   localStorage as a local backup.
============================================== */

import { rtdb, messaging } from './firebase.js';
import {
  getToken, onMessage
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging.js';
import {
  ref,
  set,
  update,
  serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js';

/* ── Constants ─────────────────────────────────────────────────── */
const VAPID_KEY        = 'BD9OJEHu9mVHq9TuPn89avERMGT09er4ZZQzRMvHRaP379C6Xocoq6GW5OtB4SlJEwvIKH8iER6xnBYP7y0kbV8';
const RTDB_TOKENS_PATH = 'fcm-tokens';
const MAX_RETRIES      = 3;

/* ── Platform detection ─────────────────────────────────────────── */
function getPlatformInfo() {
  const ua = navigator.userAgent;

  const platform = /Android/i.test(ua)    ? 'android'
    : /iPhone|iPad|iPod/i.test(ua)        ? 'ios'
    : /Windows/i.test(ua)                 ? 'windows'
    : /Mac/i.test(ua)                     ? 'mac'
    : 'other';

  const browser = /Edg\//i.test(ua)       ? 'edge'
    : /Chrome/i.test(ua)                  ? 'chrome'
    : /Firefox/i.test(ua)                 ? 'firefox'
    : /Safari/i.test(ua)                  ? 'safari'
    : 'other';

  const deviceType = /Mobi|Android/i.test(ua) ? 'mobile'
    : /Tablet|iPad/i.test(ua)                 ? 'tablet'
    : 'desktop';

  return { platform, browser, deviceType };
}

/**
 * Convert an FCM token into a Realtime Database–safe key.
 * FCM tokens can contain '.', '/', '#', '$', '[', ']' — all
 * invalid in RTDB paths. We take the last 40 chars and sanitise.
 */
function tokenToKey(token) {
  return token.slice(-40).replace(/[.#$[\]/]/g, '_');
}

/* ── Retry helper (exponential back-off) ────────────────────────── */
async function withRetry(label, fn, maxAttempts = MAX_RETRIES) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await fn();
      console.log(`[FCM] ${label} succeeded on attempt ${attempt}`);
      return result;
    } catch (err) {
      const delay = Math.pow(2, attempt) * 500; /* 1 s, 2 s, 4 s */
      console.warn(`[FCM] ${label} — attempt ${attempt}/${maxAttempts} failed:`, err.message);
      if (attempt < maxAttempts) {
        console.log(`[FCM] Retrying ${label} in ${delay} ms…`);
        await new Promise(r => setTimeout(r, delay));
      } else {
        console.error(`[FCM] ${label} — all ${maxAttempts} attempts exhausted.`, err);
        throw err;
      }
    }
  }
}

/* ── Get the active service-worker registration ─────────────────── */
async function getActiveSWRegistration() {
  if (!('serviceWorker' in navigator)) {
    console.warn('[FCM] Service workers not supported');
    return undefined;
  }
  try {
    console.log('[FCM] Waiting for active SW via navigator.serviceWorker.ready…');
    const reg = await navigator.serviceWorker.ready;
    console.log('[FCM] Active SW scope:', reg.scope, '| state:', reg.active?.state);
    return reg;
  } catch (err) {
    console.error('[FCM] Could not get SW registration:', err.message);
    return undefined;
  }
}

/* ──────────────────────────────────────────────────────────────────
   SAVE token to Firebase Realtime Database
   Path: /fcm-tokens/{tokenKey}
─────────────────────────────────────────────────────────────────── */
async function saveTokenToRTDB(token) {
  if (!rtdb) {
    throw new Error('Realtime Database not initialized — check firebase.js');
  }

  const tokenKey  = tokenToKey(token);
  const tokenPath = `${RTDB_TOKENS_PATH}/${tokenKey}`;
  const { platform, browser, deviceType } = getPlatformInfo();

  console.log('[FCM] RTDB: writing token to path:', tokenPath);
  console.log('[FCM] RTDB: platform:', platform, '| browser:', browser, '| device:', deviceType);

  await set(ref(rtdb, tokenPath), {
    token,
    platform,
    browser,
    deviceType,
    userAgent:   navigator.userAgent.slice(0, 200),
    createdAt:   serverTimestamp(),
    lastUpdated: serverTimestamp(),
    active:      true
  });

  console.log('[FCM] ✅ RTDB: token saved at', tokenPath);
}

/* ──────────────────────────────────────────────────────────────────
   UPDATE lastUpdated timestamp for an existing token
─────────────────────────────────────────────────────────────────── */
async function updateTokenTimestampInRTDB(token) {
  if (!rtdb) return;

  const tokenKey  = tokenToKey(token);
  const tokenPath = `${RTDB_TOKENS_PATH}/${tokenKey}`;

  console.log('[FCM] RTDB: updating lastUpdated at', tokenPath);
  await update(ref(rtdb, tokenPath), {
    lastUpdated: serverTimestamp(),
    active:      true
  });
  console.log('[FCM] ✅ RTDB: lastUpdated refreshed');
}

/* ──────────────────────────────────────────────────────────────────
   PERSIST token — RTDB (with retry) + localStorage backup
─────────────────────────────────────────────────────────────────── */
async function persistToken(token) {
  console.log('[FCM] Persisting token (last 16):', token.slice(-16));

  /* localStorage — always written immediately as local backup */
  localStorage.setItem('fcm-token', token);
  localStorage.setItem('fcm-token-saved-at', new Date().toISOString());
  console.log('[FCM] localStorage: token saved');

  /* Realtime Database — with retry */
  try {
    await withRetry('RTDB save', () => saveTokenToRTDB(token));
    localStorage.setItem('fcm-token-rtdb-ok', 'true');
  } catch (err) {
    console.error('[FCM] ❌ RTDB: token could not be saved after all retries.');
    console.error('[FCM] Check Firebase Realtime Database security rules — allow writes to /fcm-tokens');
    localStorage.setItem('fcm-token-rtdb-ok', 'false');
  }
}

/* ──────────────────────────────────────────────────────────────────
   REQUEST notification permission and obtain FCM token
─────────────────────────────────────────────────────────────────── */
async function requestNotificationPermission() {
  console.log('[FCM] ── Permission flow started ───────────────────────────');

  if (!messaging) {
    console.error('[FCM] messaging is null — Firebase Messaging not available');
    return null;
  }
  if (!('Notification' in window)) {
    console.warn('[FCM] Notifications API not supported in this browser');
    return null;
  }

  console.log('[FCM] Current permission:', Notification.permission);

  if (Notification.permission === 'denied') {
    console.info('[FCM] Permission previously denied — cannot request');
    return null;
  }

  /* Request permission */
  console.log('[FCM] Calling Notification.requestPermission()…');
  let permission;
  try {
    permission = await Notification.requestPermission();
  } catch (err) {
    console.error('[FCM] requestPermission threw:', err.message);
    return null;
  }

  console.log('[FCM] Permission result:', permission);
  if (permission !== 'granted') return null;

  /* Get active SW */
  const swReg = await getActiveSWRegistration();
  if (!swReg) {
    console.error('[FCM] No active SW found — cannot bind FCM token');
    return null;
  }

  /* Get FCM token */
  console.log('[FCM] Calling getToken()…');
  let token;
  try {
    token = await getToken(messaging, {
      vapidKey:                  VAPID_KEY,
      serviceWorkerRegistration: swReg
    });
  } catch (err) {
    console.error('[FCM] getToken() error:', err.code || err.name, err.message);
    return null;
  }

  if (!token) {
    console.warn('[FCM] getToken() returned empty. Verify VAPID key and SW registration.');
    return null;
  }

  console.log('[FCM] ✅ Token obtained (last 16):', token.slice(-16));
  await persistToken(token);
  return token;
}

/* ──────────────────────────────────────────────────────────────────
   TOKEN REFRESH — called on every page load when permission=granted
─────────────────────────────────────────────────────────────────── */
async function checkAndRefreshToken() {
  if (!messaging || Notification.permission !== 'granted') return;

  console.log('[FCM] ── Token refresh check ────────────────────────────────');
  const stored = localStorage.getItem('fcm-token');
  console.log('[FCM] Stored token (last 16):', stored ? stored.slice(-16) : 'none');

  const swReg = await getActiveSWRegistration();
  if (!swReg) {
    console.error('[FCM] Refresh: no active SW');
    return;
  }

  let current;
  try {
    current = await getToken(messaging, {
      vapidKey:                  VAPID_KEY,
      serviceWorkerRegistration: swReg
    });
  } catch (err) {
    console.warn('[FCM] Refresh getToken() failed:', err.message);
    return;
  }

  if (!current) {
    console.warn('[FCM] Refresh: getToken() empty');
    return;
  }

  if (current !== stored) {
    console.log('[FCM] Token has rotated — saving new token to RTDB');
    await persistToken(current);
  } else {
    console.log('[FCM] Token unchanged — updating lastUpdated in RTDB');
    try {
      await withRetry('RTDB timestamp update', () => updateTokenTimestampInRTDB(current));
    } catch {
      console.warn('[FCM] Timestamp update failed (non-critical)');
    }
    localStorage.setItem('fcm-token-refreshed-at', new Date().toISOString());
  }
}

/* ──────────────────────────────────────────────────────────────────
   FOREGROUND message handler (app is open / visible)
─────────────────────────────────────────────────────────────────── */
function initForegroundMessages() {
  if (!messaging) return;

  onMessage(messaging, (payload) => {
    console.log('[FCM] Foreground message received:', JSON.stringify(payload));
    const n     = payload.notification || {};
    const d     = payload.data          || {};
    const title = n.title || d.title || 'Jesus Embassy';
    const body  = n.body  || d.body  || 'You have a new notification';
    showInAppNotification(title, body);
  });

  console.log('[FCM] ✅ Foreground message handler active');
}

/* ──────────────────────────────────────────────────────────────────
   IN-APP notification toast (for foreground messages)
─────────────────────────────────────────────────────────────────── */
function showInAppNotification(title, body) {
  const toast = document.getElementById('notif-toast');
  if (!toast) return;

  const titleEl = toast.querySelector('.notif-title');
  const bodyEl  = toast.querySelector('.notif-body');
  if (titleEl) titleEl.textContent = title;
  if (bodyEl)  bodyEl.textContent  = body;

  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 6000);
}

/* ──────────────────────────────────────────────────────────────────
   PERMISSION BANNER (shown to visitors who haven't decided yet)
─────────────────────────────────────────────────────────────────── */
function showNotifBanner() {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'granted') return;
  if (Notification.permission === 'denied')  return;
  if (localStorage.getItem('notif-banner-dismissed') === 'true') return;

  const banner = document.getElementById('notif-banner');
  if (!banner) return;

  setTimeout(() => banner.classList.add('show'), 5000);

  document.getElementById('notif-allow-btn')?.addEventListener('click', async () => {
    banner.classList.remove('show');
    const token = await requestNotificationPermission();
    if (token) console.log('[FCM] ✅ Push notifications enabled');
  }, { once: true });

  document.getElementById('notif-dismiss-btn')?.addEventListener('click', () => {
    banner.classList.remove('show');
    localStorage.setItem('notif-banner-dismissed', 'true');
  }, { once: true });
}

/* ──────────────────────────────────────────────────────────────────
   MAIN ENTRY POINT (called from app.js)
─────────────────────────────────────────────────────────────────── */
export async function initNotifications() {
  console.log('[FCM] ══ initNotifications() ══');
  console.log('[FCM] permission:', 'Notification' in window ? Notification.permission : 'unsupported');
  console.log('[FCM] rtdb:', rtdb ? '✅' : '❌ null');
  console.log('[FCM] messaging:', messaging ? '✅' : '❌ null');

  if (!('Notification' in window)) return;

  initForegroundMessages();
  showNotifBanner();

  if (Notification.permission === 'granted') {
    await checkAndRefreshToken();
  }

  console.log('[FCM] ══ initNotifications() done ══');
}

export { requestNotificationPermission, showInAppNotification };
