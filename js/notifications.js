/* ==============================================
   NOTIFICATIONS.JS — Firebase Cloud Messaging
   Token Management & Firebase Storage
   Jesus Embassy PWA
   -----------------------------------------------
   CHANGELOG v3 (2025-06-15):
   PRIMARY:   Realtime Database (/fcm-tokens/)
   SECONDARY: Firestore (notificationSubscribers)
   TERTIARY:  localStorage (always)

   KEY FIXES in this version:
   1. Switched from Firestore-only to RTDB primary
      so tokens reach Firebase Realtime Database
      as the user expects.
   2. Added 3-attempt retry with exponential backoff
      so transient network errors don't silently
      drop the token.
   3. Added DETAILED console logging at every step
      so failures are immediately visible in DevTools.
   4. navigator.serviceWorker.ready used consistently
      throughout so getToken() is always bound to the
      correct SW (service-worker.js, which handles push).
   5. Token refresh passes serviceWorkerRegistration
      so refreshed tokens are not bound to dead SWs.
============================================== */

import { rtdb, db, messaging } from './firebase.js';
import {
  getToken, onMessage
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging.js';

/* ── Realtime Database imports ─────────────────────────────────── */
import {
  ref as rtdbRef,
  set as rtdbSet,
  update as rtdbUpdate,
  serverTimestamp as rtdbServerTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js';

/* ── Firestore imports (secondary fallback) ─────────────────────── */
import {
  doc, setDoc, serverTimestamp as fsServerTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

/* ── Constants ─────────────────────────────────────────────────── */
const VAPID_KEY         = 'BD9OJEHu9mVHq9TuPn89avERMGT09er4ZZQzRMvHRaP379C6Xocoq6GW5OtB4SlJEwvIKH8iER6xnBYP7y0kbV8';
const RTDB_TOKENS_PATH  = 'fcm-tokens';   /* Realtime Database path */
const FS_COLLECTION     = 'notificationSubscribers'; /* Firestore collection */
const MAX_RETRIES       = 3;

/* ──────────────────────────────────────────────────────────────────
   UTILITY: Platform / Device Detection
─────────────────────────────────────────────────────────────────── */
function getPlatformInfo() {
  const ua = navigator.userAgent;

  const platform = /Android/i.test(ua)     ? 'android'
    : /iPhone|iPad|iPod/i.test(ua)         ? 'ios'
    : /Windows/i.test(ua)                  ? 'windows'
    : /Mac/i.test(ua)                      ? 'mac'
    : 'other';

  const browser = /Edg\//i.test(ua)        ? 'edge'
    : /Chrome/i.test(ua)                   ? 'chrome'
    : /Firefox/i.test(ua)                  ? 'firefox'
    : /Safari/i.test(ua)                   ? 'safari'
    : 'other';

  const deviceType = /Mobi|Android/i.test(ua) ? 'mobile'
    : /Tablet|iPad/i.test(ua)               ? 'tablet'
    : 'desktop';

  return { platform, browser, deviceType };
}

/**
 * Make a RTDB-safe key from an FCM token.
 * FCM tokens may contain '/' and '.' which are invalid in RTDB paths.
 * We take the last 40 characters and replace any unsafe chars.
 */
function tokenToKey(token) {
  return token.slice(-40).replace(/[.#$\[\]/]/g, '_');
}

/* ──────────────────────────────────────────────────────────────────
   UTILITY: Retry wrapper with exponential backoff
─────────────────────────────────────────────────────────────────── */
async function withRetry(label, fn, maxAttempts = MAX_RETRIES) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await fn();
      console.log(`[FCM] ${label} succeeded on attempt ${attempt}`);
      return result;
    } catch (err) {
      const delay = Math.pow(2, attempt) * 500; /* 1s, 2s, 4s */
      console.warn(`[FCM] ${label} attempt ${attempt}/${maxAttempts} failed:`, err.message);
      if (attempt < maxAttempts) {
        console.log(`[FCM] Retrying ${label} in ${delay}ms…`);
        await new Promise(r => setTimeout(r, delay));
      } else {
        console.error(`[FCM] ${label} failed after ${maxAttempts} attempts. Last error:`, err.message, err);
        throw err;
      }
    }
  }
}

/* ──────────────────────────────────────────────────────────────────
   STEP 1: Get the active SW registration.
   Returns the ServiceWorkerRegistration for service-worker.js.
   Passing this to getToken() binds the FCM token to the correct SW
   (the one that actually receives push events).
─────────────────────────────────────────────────────────────────── */
async function getActiveSWRegistration() {
  if (!('serviceWorker' in navigator)) {
    console.warn('[FCM] Service workers not supported in this browser');
    return undefined;
  }

  try {
    console.log('[FCM] Waiting for active SW registration via navigator.serviceWorker.ready…');
    const reg = await navigator.serviceWorker.ready;
    console.log('[FCM] Active SW registration obtained. Scope:', reg.scope);
    console.log('[FCM] SW state:', reg.active?.state || 'unknown');
    return reg;
  } catch (err) {
    console.error('[FCM] Could not get SW registration:', err.message);
    return undefined;
  }
}

/* ──────────────────────────────────────────────────────────────────
   STEP 2a: Save token to Firebase Realtime Database (PRIMARY)
   Path: /fcm-tokens/{tokenKey}
─────────────────────────────────────────────────────────────────── */
async function saveTokenToRTDB(token) {
  if (!rtdb) {
    console.error('[FCM] RTDB: database not initialized — cannot save token');
    throw new Error('RTDB not initialized');
  }

  const tokenKey = tokenToKey(token);
  const { platform, browser, deviceType } = getPlatformInfo();

  console.log('[FCM] RTDB: saving token to path:', `${RTDB_TOKENS_PATH}/${tokenKey}`);
  console.log('[FCM] RTDB: platform info:', { platform, browser, deviceType });

  const tokenRef  = rtdbRef(rtdb, `${RTDB_TOKENS_PATH}/${tokenKey}`);
  const tokenData = {
    token,
    platform,
    browser,
    deviceType,
    userAgent:   navigator.userAgent.slice(0, 200),
    createdAt:   rtdbServerTimestamp(),
    lastUpdated: rtdbServerTimestamp(),
    active:      true,
    url:         self?.location?.href || window.location.href
  };

  await rtdbSet(tokenRef, tokenData);
  console.log('[FCM] ✅ RTDB: token saved successfully at key:', tokenKey);
  return tokenKey;
}

/* ──────────────────────────────────────────────────────────────────
   STEP 2b: Update token timestamp in RTDB (on token refresh)
─────────────────────────────────────────────────────────────────── */
async function updateTokenInRTDB(token) {
  if (!rtdb) {
    console.warn('[FCM] RTDB: cannot update token — database not initialized');
    return;
  }

  const tokenKey  = tokenToKey(token);
  const tokenRef  = rtdbRef(rtdb, `${RTDB_TOKENS_PATH}/${tokenKey}`);

  console.log('[FCM] RTDB: updating lastUpdated for key:', tokenKey);
  await rtdbUpdate(tokenRef, {
    lastUpdated: rtdbServerTimestamp(),
    active:      true
  });
  console.log('[FCM] ✅ RTDB: token timestamp updated');
}

/* ──────────────────────────────────────────────────────────────────
   STEP 3: Save token to Firestore (SECONDARY fallback)
─────────────────────────────────────────────────────────────────── */
async function saveTokenToFirestore(token) {
  if (!db) {
    console.warn('[FCM] Firestore: not initialized — skipping fallback save');
    return;
  }

  const tokenId = token.slice(-32);
  const { platform, browser, deviceType } = getPlatformInfo();

  console.log('[FCM] Firestore: saving token to collection:', FS_COLLECTION, '| doc ID:', tokenId);

  const docRef = doc(db, FS_COLLECTION, tokenId);
  await setDoc(docRef, {
    token,
    platform,
    browser,
    deviceType,
    createdAt:   fsServerTimestamp(),
    lastUpdated: fsServerTimestamp(),
    active:      true
  }, { merge: true });

  console.log('[FCM] ✅ Firestore: token saved. Doc ID:', tokenId);
}

/* ──────────────────────────────────────────────────────────────────
   MAIN TOKEN SAVE: Tries RTDB first, falls back to Firestore.
   localStorage is always written regardless.
─────────────────────────────────────────────────────────────────── */
async function persistToken(token) {
  console.log('[FCM] Starting token persistence for token (last 16 chars):', token.slice(-16));

  /* Tertiary: always save to localStorage immediately */
  localStorage.setItem('fcm-token', token);
  localStorage.setItem('fcm-token-saved-at', new Date().toISOString());
  console.log('[FCM] localStorage: token saved');

  /* Primary: Realtime Database (with retry) */
  let rtdbOk = false;
  try {
    await withRetry('RTDB token save', () => saveTokenToRTDB(token));
    rtdbOk = true;
    localStorage.setItem('fcm-token-rtdb-saved', 'true');
  } catch (err) {
    console.error('[FCM] RTDB: all retries exhausted. RTDB save failed. Trying Firestore fallback…');
    localStorage.setItem('fcm-token-rtdb-saved', 'false');
  }

  /* Secondary: Firestore fallback (with retry) — only if RTDB failed */
  if (!rtdbOk) {
    try {
      await withRetry('Firestore token save', () => saveTokenToFirestore(token));
      localStorage.setItem('fcm-token-fs-saved', 'true');
    } catch (err) {
      console.error('[FCM] Firestore: all retries exhausted. Token only in localStorage.');
      localStorage.setItem('fcm-token-fs-saved', 'false');
    }
  } else {
    /* Also save to Firestore if RTDB succeeded (belt-and-suspenders) */
    try {
      await saveTokenToFirestore(token);
    } catch (err) {
      console.warn('[FCM] Firestore: secondary save failed (RTDB save was successful so this is OK):', err.message);
    }
  }

  console.log('[FCM] Token persistence complete. RTDB:', rtdbOk ? '✅' : '❌', '| localStorage: ✅');
}

/* ──────────────────────────────────────────────────────────────────
   STEP 4: Request notification permission and get FCM token.
─────────────────────────────────────────────────────────────────── */
async function requestNotificationPermission() {
  console.log('[FCM] ── Starting notification permission flow ──────────────────');

  if (!messaging) {
    console.error('[FCM] Messaging is null — not supported or init failed. Aborting.');
    return null;
  }

  if (!('Notification' in window)) {
    console.warn('[FCM] Notifications API not supported in this browser. Aborting.');
    return null;
  }

  console.log('[FCM] Current Notification.permission:', Notification.permission);

  if (Notification.permission === 'denied') {
    console.info('[FCM] Permission was previously denied by user. Cannot request again.');
    return null;
  }

  /* Step 4a: Request permission */
  console.log('[FCM] Requesting Notification.requestPermission()…');
  let permission;
  try {
    permission = await Notification.requestPermission();
  } catch (err) {
    console.error('[FCM] Notification.requestPermission() threw:', err.message);
    return null;
  }

  console.log('[FCM] Permission result:', permission);

  if (permission !== 'granted') {
    console.info('[FCM] Permission not granted. Status:', permission, '— aborting token request');
    return null;
  }

  /* Step 4b: Get active service worker registration */
  console.log('[FCM] Permission granted. Getting active SW registration…');
  const swReg = await getActiveSWRegistration();

  if (!swReg) {
    console.error('[FCM] No active service worker found. Token cannot be obtained without a SW.');
    return null;
  }

  /* Step 4c: Get FCM token */
  console.log('[FCM] Calling getToken() with VAPID key and SW registration…');
  let token;
  try {
    token = await getToken(messaging, {
      vapidKey:                  VAPID_KEY,
      serviceWorkerRegistration: swReg  /* ← CRITICAL: binds token to correct SW */
    });
  } catch (err) {
    console.error('[FCM] getToken() threw an error:', err.code || err.name, '|', err.message);
    console.error('[FCM] Full error object:', err);
    return null;
  }

  if (!token) {
    console.warn('[FCM] getToken() returned empty/null. Check:');
    console.warn('  1. VAPID key is correct in Firebase Console > Project Settings > Cloud Messaging');
    console.warn('  2. Service worker is active and serving at /Church-website-/');
    console.warn('  3. Firebase Messaging SDK is loaded in the SW (importScripts)');
    return null;
  }

  console.log('[FCM] ✅ FCM token obtained successfully. Token (last 16):', token.slice(-16));

  /* Step 4d: Persist token to Firebase databases */
  await persistToken(token);

  return token;
}

/* ──────────────────────────────────────────────────────────────────
   Token Refresh: called on every page load when permission='granted'.
   Ensures the stored token is current. FCM tokens can rotate.
─────────────────────────────────────────────────────────────────── */
async function checkAndRefreshToken() {
  if (!messaging) {
    console.warn('[FCM] Refresh: messaging unavailable');
    return;
  }

  if (Notification.permission !== 'granted') {
    console.log('[FCM] Refresh: permission not granted, skipping refresh');
    return;
  }

  console.log('[FCM] ── Token refresh check ────────────────────────────────────');
  const storedToken = localStorage.getItem('fcm-token');
  console.log('[FCM] Stored token (last 16):', storedToken ? storedToken.slice(-16) : 'none');

  const swReg = await getActiveSWRegistration();
  if (!swReg) {
    console.error('[FCM] Refresh: no active SW — cannot refresh token');
    return;
  }

  let currentToken;
  try {
    currentToken = await getToken(messaging, {
      vapidKey:                  VAPID_KEY,
      serviceWorkerRegistration: swReg  /* ← CRITICAL: always pass this */
    });
  } catch (err) {
    console.warn('[FCM] Refresh: getToken() failed:', err.code || err.message);
    return;
  }

  if (!currentToken) {
    console.warn('[FCM] Refresh: getToken() returned empty. User may need to re-grant permission.');
    return;
  }

  console.log('[FCM] Refresh: current token (last 16):', currentToken.slice(-16));

  if (currentToken !== storedToken) {
    console.log('[FCM] ✅ Token has rotated — saving new token to all databases');
    await persistToken(currentToken);
  } else {
    console.log('[FCM] Token unchanged — updating lastUpdated timestamp');
    try {
      await withRetry('RTDB timestamp update', () => updateTokenInRTDB(currentToken));
    } catch (err) {
      console.warn('[FCM] Timestamp update failed (non-critical):', err.message);
    }
    localStorage.setItem('fcm-token-refreshed-at', new Date().toISOString());
  }
}

/* ──────────────────────────────────────────────────────────────────
   Foreground Message Handler:
   Called when the app is open (visible) and a push arrives.
   Firebase does NOT show a notification automatically for foreground
   messages — we must show our own in-app toast.
─────────────────────────────────────────────────────────────────── */
function initForegroundMessages() {
  if (!messaging) {
    console.warn('[FCM] Foreground handler: messaging unavailable');
    return;
  }

  onMessage(messaging, (payload) => {
    console.log('[FCM] Foreground message received:', JSON.stringify(payload));

    const notification = payload.notification || {};
    const data         = payload.data          || {};
    const title        = notification.title || data.title || 'Jesus Embassy';
    const body         = notification.body  || data.body  || 'You have a new notification';

    console.log('[FCM] Showing in-app toast:', title, '|', body);
    showInAppNotification(title, body);
  });

  console.log('[FCM] ✅ Foreground message handler registered');
}

/* ──────────────────────────────────────────────────────────────────
   In-App Notification Toast (shown for foreground messages)
─────────────────────────────────────────────────────────────────── */
function showInAppNotification(title, body) {
  const toast = document.getElementById('notif-toast');
  if (!toast) {
    console.warn('[FCM] #notif-toast element not found in DOM — showing alert instead');
    return;
  }

  const titleEl = toast.querySelector('.notif-title');
  const bodyEl  = toast.querySelector('.notif-body');

  if (titleEl) titleEl.textContent = title;
  if (bodyEl)  bodyEl.textContent  = body;

  toast.classList.add('show');

  /* Auto-dismiss after 6 seconds */
  setTimeout(() => toast.classList.remove('show'), 6000);
  console.log('[FCM] In-app toast shown');
}

/* ──────────────────────────────────────────────────────────────────
   Notification Permission Banner (shown to new visitors)
─────────────────────────────────────────────────────────────────── */
function showNotifBanner() {
  if (!('Notification' in window)) return;

  /* Don't show if permission already decided or banner was dismissed */
  if (Notification.permission === 'granted') {
    console.log('[FCM] Banner: permission already granted, not showing banner');
    return;
  }

  if (Notification.permission === 'denied') {
    console.log('[FCM] Banner: permission was denied, not showing banner');
    return;
  }

  if (localStorage.getItem('notif-banner-dismissed') === 'true') {
    console.log('[FCM] Banner: previously dismissed by user');
    return;
  }

  const banner = document.getElementById('notif-banner');
  if (!banner) {
    console.warn('[FCM] Banner: #notif-banner element not in DOM');
    return;
  }

  console.log('[FCM] Banner: showing notification permission banner in 5 seconds…');
  setTimeout(() => {
    banner.classList.add('show');
    console.log('[FCM] Banner: shown');
  }, 5000);

  document.getElementById('notif-allow-btn')?.addEventListener('click', async () => {
    console.log('[FCM] Banner: user clicked Allow Notifications');
    banner.classList.remove('show');
    const token = await requestNotificationPermission();
    if (token) {
      console.log('[FCM] ✅ Push notifications enabled. Token stored.');
    } else {
      console.warn('[FCM] Push notifications could not be fully enabled');
    }
  }, { once: true });

  document.getElementById('notif-dismiss-btn')?.addEventListener('click', () => {
    console.log('[FCM] Banner: user dismissed');
    banner.classList.remove('show');
    localStorage.setItem('notif-banner-dismissed', 'true');
  }, { once: true });
}

/* ──────────────────────────────────────────────────────────────────
   MAIN ENTRY POINT
─────────────────────────────────────────────────────────────────── */
export async function initNotifications() {
  console.log('[FCM] ══════════════════════════════════════════════');
  console.log('[FCM] initNotifications() starting…');
  console.log('[FCM] Notification.permission:', 'Notification' in window ? Notification.permission : 'API not available');
  console.log('[FCM] messaging object:', messaging ? '✅ available' : '❌ null');
  console.log('[FCM] rtdb object:', rtdb ? '✅ available' : '❌ null');
  console.log('[FCM] db (Firestore) object:', db ? '✅ available' : '❌ null');
  console.log('[FCM] ══════════════════════════════════════════════');

  if (!('Notification' in window)) {
    console.warn('[FCM] Notifications API not available — iOS Safari or restricted browser?');
    return;
  }

  /* Start listening for foreground push messages immediately */
  initForegroundMessages();

  /* Show the permission banner if needed */
  showNotifBanner();

  /* If permission already granted, validate / refresh the stored token */
  if (Notification.permission === 'granted') {
    console.log('[FCM] Permission already granted — running token refresh check');
    await checkAndRefreshToken();
  }

  console.log('[FCM] initNotifications() complete');
}

/* Named exports for external use */
export { requestNotificationPermission, showInAppNotification };
