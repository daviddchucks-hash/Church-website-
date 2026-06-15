/* ==============================================
   NOTIFICATIONS.JS — Firebase Cloud Messaging
   Token Management & Firestore Storage
   Jesus Embassy PWA
   -----------------------------------------------
   KEY FIX: All getToken() calls now pass the
   actual active service worker registration via
   navigator.serviceWorker.ready — this binds
   the token to the SW that has the push handler.
   Without this, Firebase either can't find a SW
   or binds the token to a dead registration, so
   push events are received by nobody.
============================================== */

import { db, messaging } from './firebase.js';
import {
  getToken, onMessage
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging.js';
import {
  doc, setDoc, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

const VAPID_KEY         = 'BD9OJEHu9mVHq9TuPn89avERMGT09er4ZZQzRMvHRaP379C6Xocoq6GW5OtB4SlJEwvIKH8iER6xnBYP7y0kbV8';
const TOKENS_COLLECTION = 'notificationSubscribers';

/* ── Platform / Device Detection ─────────────────────────────── */
function getPlatformInfo() {
  const ua = navigator.userAgent;

  const platform = /Android/i.test(ua)        ? 'android'
    : /iPhone|iPad|iPod/i.test(ua)            ? 'ios'
    : /Windows/i.test(ua)                     ? 'windows'
    : /Mac/i.test(ua)                         ? 'mac'
    : 'other';

  const browser = /Chrome/i.test(ua) && !/Edge/i.test(ua) ? 'chrome'
    : /Firefox/i.test(ua)                                  ? 'firefox'
    : /Safari/i.test(ua)                                   ? 'safari'
    : /Edge/i.test(ua)                                     ? 'edge'
    : 'other';

  const deviceType = /Mobi|Android/i.test(ua) ? 'mobile'
    : /Tablet|iPad/i.test(ua)                 ? 'tablet'
    : 'desktop';

  return { platform, browser, deviceType };
}

/* ── Get Active SW Registration ───────────────────────────────
   navigator.serviceWorker.ready resolves to the ServiceWorker-
   Registration that is active and controlling the page. This is
   service-worker.js (which now contains the Firebase messaging
   code). Passing this to getToken() binds the FCM token to the
   correct SW — the one that will actually receive push events.
──────────────────────────────────────────────────────────────── */
async function getActiveSWRegistration() {
  if (!('serviceWorker' in navigator)) return undefined;
  try {
    /* Waits until the SW is installed AND activated */
    const reg = await navigator.serviceWorker.ready;
    console.log('[FCM] Active SW registration scope:', reg.scope);
    return reg;
  } catch (err) {
    console.error('[FCM] Could not get SW registration:', err);
    return undefined;
  }
}

/* ── Store Token in Firestore ─────────────────────────────────── */
async function saveTokenToFirestore(token) {
  if (!token) return;

  try {
    const { platform, browser, deviceType } = getPlatformInfo();

    /* Doc ID = last 32 chars of token to prevent duplicate docs */
    const tokenId = token.slice(-32);
    const docRef  = doc(db, TOKENS_COLLECTION, tokenId);

    await setDoc(docRef, {
      token,
      platform,
      browser,
      deviceType,
      createdAt:   serverTimestamp(),
      lastUpdated: serverTimestamp(),
      active:      true
    }, { merge: true });

    console.log('[FCM] Token saved to Firestore. Doc ID:', tokenId);
  } catch (err) {
    console.error('[FCM] Failed to save token to Firestore:', err);
  }
}

/* ── Update token's lastUpdated timestamp ─────────────────────── */
async function updateTokenTimestamp(token) {
  if (!token) return;
  try {
    const tokenId = token.slice(-32);
    const docRef  = doc(db, TOKENS_COLLECTION, tokenId);
    await setDoc(docRef, { lastUpdated: serverTimestamp(), active: true }, { merge: true });
  } catch (err) {
    console.warn('[FCM] Could not update token timestamp:', err);
  }
}

/* ── Request Notification Permission & Get Token ──────────────── */
async function requestNotificationPermission() {
  if (!messaging) {
    console.warn('[FCM] Messaging unavailable (not supported or init failed)');
    return null;
  }

  if (!('Notification' in window)) {
    console.warn('[FCM] Notifications API not supported in this browser');
    return null;
  }

  if (Notification.permission === 'denied') {
    console.info('[FCM] Notifications were previously denied by user');
    return null;
  }

  try {
    const permission = await Notification.requestPermission();

    if (permission !== 'granted') {
      console.info('[FCM] Permission not granted. Status:', permission);
      return null;
    }

    /* FIX BUG 1 & 2: Use navigator.serviceWorker.ready to get the
       active SW registration. This is service-worker.js, which now
       contains Firebase messaging code and WILL receive push events.
       Previously, getRegistration('/Church-website-/firebase-messaging-sw.js')
       was used — that file path is not a valid scope URL, so it
       always returned undefined, making getToken() use a broken default. */
    const swReg = await getActiveSWRegistration();

    if (!swReg) {
      console.error('[FCM] No active service worker found. Cannot get FCM token.');
      return null;
    }

    console.log('[FCM] Requesting FCM token with SW scope:', swReg.scope);

    const token = await getToken(messaging, {
      vapidKey:                  VAPID_KEY,
      serviceWorkerRegistration: swReg   /* ← CRITICAL: bind token to the right SW */
    });

    if (token) {
      console.log('[FCM] FCM registration token obtained successfully');
      await saveTokenToFirestore(token);
      localStorage.setItem('fcm-token', token);
      return token;
    } else {
      console.warn('[FCM] getToken() returned empty. Verify VAPID key and SW registration.');
      return null;
    }

  } catch (err) {
    console.error('[FCM] Token request failed:', err.code || err.message, err);
    return null;
  }
}

/* ── Foreground Message Handler ───────────────────────────────── */
function initForegroundMessages() {
  if (!messaging) return;

  onMessage(messaging, (payload) => {
    console.log('[FCM] Foreground message received:', payload);

    const { notification = {}, data = {} } = payload;
    const title = notification.title || data.title || 'Jesus Embassy';
    const body  = notification.body  || data.body  || 'You have a new notification';

    showInAppNotification(title, body);
  });

  console.log('[FCM] Foreground message handler registered');
}

/* ── In-App Notification Toast ────────────────────────────────── */
function showInAppNotification(title, body) {
  const toast = document.getElementById('notif-toast');
  if (!toast) {
    console.warn('[FCM] #notif-toast element not found in DOM');
    return;
  }

  const titleEl = toast.querySelector('.notif-title');
  const bodyEl  = toast.querySelector('.notif-body');

  if (titleEl) titleEl.textContent = title;
  if (bodyEl)  bodyEl.textContent  = body;

  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 6000);
}

/* ── Notification Permission Banner ───────────────────────────── */
function showNotifBanner() {
  /* Don't show if permission is already decided or banner dismissed */
  if (
    Notification.permission === 'granted' ||
    Notification.permission === 'denied'  ||
    localStorage.getItem('notif-banner-dismissed') === 'true'
  ) return;

  const banner = document.getElementById('notif-banner');
  if (!banner) return;

  setTimeout(() => banner.classList.add('show'), 5000);

  document.getElementById('notif-allow-btn')?.addEventListener('click', async () => {
    banner.classList.remove('show');
    const token = await requestNotificationPermission();
    if (token) console.log('[FCM] Push notifications enabled.');
  });

  document.getElementById('notif-dismiss-btn')?.addEventListener('click', () => {
    banner.classList.remove('show');
    localStorage.setItem('notif-banner-dismissed', 'true');
  });
}

/* ── Token Refresh on Revisit ─────────────────────────────────── */
async function checkAndRefreshToken() {
  if (!messaging || Notification.permission !== 'granted') return;

  const storedToken = localStorage.getItem('fcm-token');

  try {
    /* FIX BUG 3: Pass serviceWorkerRegistration here too.
       Previously this call had NO serviceWorkerRegistration, causing
       Firebase to search for its default SW at the root origin (/),
       which doesn't exist. This regenerated tokens tied to dead SWs. */
    const swReg = await getActiveSWRegistration();

    const currentToken = await getToken(messaging, {
      vapidKey:                  VAPID_KEY,
      serviceWorkerRegistration: swReg   /* ← CRITICAL FIX */
    });

    if (!currentToken) {
      console.warn('[FCM] Token refresh returned empty. User may need to re-grant permission.');
      return;
    }

    if (currentToken !== storedToken) {
      console.log('[FCM] Token has changed — updating Firestore with new token');
      await saveTokenToFirestore(currentToken);
      localStorage.setItem('fcm-token', currentToken);
    } else {
      /* Token unchanged — just update the lastUpdated timestamp */
      await updateTokenTimestamp(storedToken);
    }
  } catch (err) {
    console.warn('[FCM] Token refresh failed:', err.code || err.message);
  }
}

/* ── Init ─────────────────────────────────────────────────────── */
export async function initNotifications() {
  if (!('Notification' in window)) {
    console.warn('[FCM] Notifications not supported in this browser');
    return;
  }

  /* Set up foreground message listener immediately */
  initForegroundMessages();

  /* Show the permission-request banner if not yet decided */
  showNotifBanner();

  /* If already granted, refresh/validate token on every page load */
  if (Notification.permission === 'granted') {
    await checkAndRefreshToken();
  }
}

export { requestNotificationPermission, showInAppNotification };
