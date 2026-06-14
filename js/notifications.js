/* ==============================================
   NOTIFICATIONS.JS — Firebase Cloud Messaging
   Token Management & Firestore Storage
   Jesus Embassy PWA
============================================== */

import { db, messaging } from './firebase.js';
import {
  getToken, onMessage
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging.js';
import {
  collection, doc, setDoc, query, where, getDocs, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

const VAPID_KEY = 'BD9OJEHu9mVHq9TuPn89avERMGT09er4ZZQzRMvHRaP379C6Xocoq6GW5OtB4SlJEwvIKH8iER6xnBYP7y0kbV8';
const TOKENS_COLLECTION = 'notificationSubscribers';

/* ── Platform / Device Detection ─────────── */
function getPlatformInfo() {
  const ua = navigator.userAgent;
  const platform = /Android/i.test(ua)  ? 'android'
    : /iPhone|iPad|iPod/i.test(ua)       ? 'ios'
    : /Windows/i.test(ua)               ? 'windows'
    : /Mac/i.test(ua)                   ? 'mac'
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

/* ── Store Token in Firestore ─────────────── */
async function saveTokenToFirestore(token) {
  if (!token) return;

  try {
    const { platform, browser, deviceType } = getPlatformInfo();

    /* Use token hash as doc ID to prevent duplicates */
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

    console.log('[FCM] Token saved to Firestore:', tokenId);
  } catch (err) {
    console.error('[FCM] Failed to save token:', err);
  }
}

/* ── Update existing token's lastUpdated ─── */
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

/* ── Request Notification Permission ─────── */
async function requestNotificationPermission() {
  if (!messaging) {
    console.warn('[FCM] Messaging unavailable');
    return null;
  }

  if (!('Notification' in window)) {
    console.warn('[FCM] Notifications not supported');
    return null;
  }

  /* Already denied — don't pester the user */
  if (Notification.permission === 'denied') {
    console.info('[FCM] Notifications previously denied by user');
    return null;
  }

  try {
    const permission = await Notification.requestPermission();

    if (permission !== 'granted') {
      console.info('[FCM] Permission not granted:', permission);
      return null;
    }

    /* Get SW registration for messaging */
    let swReg;
    if ('serviceWorker' in navigator) {
      swReg = await navigator.serviceWorker.getRegistration(
        '/Church-website-/firebase-messaging-sw.js'
      );
      if (!swReg) {
        swReg = await navigator.serviceWorker.getRegistration('/Church-website-/');
      }
    }

    const token = await getToken(messaging, {
      vapidKey:            VAPID_KEY,
      serviceWorkerRegistration: swReg
    });

    if (token) {
      console.log('[FCM] Registration token obtained');
      await saveTokenToFirestore(token);
      localStorage.setItem('fcm-token', token);
      return token;
    } else {
      console.warn('[FCM] No token obtained — check VAPID key and service worker');
      return null;
    }
  } catch (err) {
    console.error('[FCM] Token request failed:', err);
    return null;
  }
}

/* ── Handle Foreground Messages ──────────── */
function initForegroundMessages() {
  if (!messaging) return;

  onMessage(messaging, (payload) => {
    console.log('[FCM] Foreground message received:', payload);

    const { notification = {}, data = {} } = payload;
    const title = notification.title || data.title || 'Jesus Embassy';
    const body  = notification.body  || data.body  || 'You have a new notification';

    showInAppNotification(title, body);
  });
}

/* ── In-App Notification Toast ────────────── */
function showInAppNotification(title, body) {
  let toast = document.getElementById('notif-toast');

  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'notif-toast';
    toast.innerHTML = `
      <button id="notif-toast-close" aria-label="Close notification">✕</button>
      <div class="notif-title"></div>
      <div class="notif-body"></div>
    `;
    document.body.appendChild(toast);

    document.getElementById('notif-toast-close').addEventListener('click', () => {
      toast.classList.remove('show');
    });
  }

  toast.querySelector('.notif-title').textContent = title;
  toast.querySelector('.notif-body').textContent  = body;
  toast.classList.add('show');

  setTimeout(() => toast.classList.remove('show'), 6000);
}

/* ── Notification Permission Banner UI ────── */
function showNotifBanner() {
  /* Don't show if already granted or denied */
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
    await requestNotificationPermission();
  });

  document.getElementById('notif-dismiss-btn')?.addEventListener('click', () => {
    banner.classList.remove('show');
    localStorage.setItem('notif-banner-dismissed', 'true');
  });
}

/* ── Token Refresh Handler ────────────────── */
async function checkAndRefreshToken() {
  if (!messaging || Notification.permission !== 'granted') return;

  const storedToken = localStorage.getItem('fcm-token');
  if (!storedToken) return;

  try {
    const currentToken = await getToken(messaging, { vapidKey: VAPID_KEY });
    if (currentToken !== storedToken) {
      console.log('[FCM] Token refreshed, updating Firestore');
      await saveTokenToFirestore(currentToken);
      localStorage.setItem('fcm-token', currentToken);
    } else {
      await updateTokenTimestamp(storedToken);
    }
  } catch (err) {
    console.warn('[FCM] Token refresh failed:', err);
  }
}

/* ── Init ─────────────────────────────────── */
export async function initNotifications() {
  if (!('Notification' in window)) return;

  initForegroundMessages();
  showNotifBanner();

  /* Silently refresh token if already permitted */
  if (Notification.permission === 'granted') {
    await checkAndRefreshToken();
  }
}

export { requestNotificationPermission, showInAppNotification };
