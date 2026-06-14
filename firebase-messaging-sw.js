/* ==============================================
   FIREBASE-MESSAGING-SW.JS
   Firebase Cloud Messaging Service Worker
   Jesus Embassy PWA
   Handles background push notifications
============================================== */

importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey:            "AIzaSyCuAIyM54XWy4DaYqoFYoEIUP0mQNaZQY4",
  authDomain:        "church-app-637f7.firebaseapp.com",
  projectId:         "church-app-637f7",
  storageBucket:     "church-app-637f7.firebasestorage.app",
  messagingSenderId: "534721516086",
  appId:             "1:534721516086:web:1dd27eae690c620098be97",
  measurementId:     "G-JJL8SP6LNW"
});

const messaging = firebase.messaging();

/* ── Background Message Handler ─────────── */
messaging.onBackgroundMessage(function(payload) {
  console.log('[FCM SW] Background message received:', payload);

  const { notification = {}, data = {} } = payload;

  const title   = notification.title || data.title || 'Jesus Embassy';
  const body    = notification.body  || data.body  || 'You have a new message from Jesus Embassy.';
  const icon    = notification.icon  || '/Church-website-/assets/icons/icon-192.png';
  const badge   = '/Church-website-/assets/icons/icon-192.png';
  const image   = notification.image || data.image || null;
  const clickAction = notification.click_action || data.click_action || '/Church-website-/';
  const tag     = data.tag || 'je-notification';

  const notifOptions = {
    body,
    icon,
    badge,
    image,
    tag,
    renotify:        true,
    requireInteraction: false,
    silent:          false,
    vibrate:         [200, 100, 200],
    data: {
      url: clickAction,
      ...data
    },
    actions: [
      { action: 'open',    title: 'Open App' },
      { action: 'dismiss', title: 'Dismiss'  }
    ]
  };

  return self.registration.showNotification(title, notifOptions);
});

/* ── Notification Click Handler ──────────── */
self.addEventListener('notificationclick', function(event) {
  event.notification.close();

  if (event.action === 'dismiss') return;

  const urlToOpen = event.notification.data?.url || '/Church-website-/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      /* Focus existing window if one is already open */
      for (const client of windowClients) {
        if (client.url.includes('/Church-website-/') && 'focus' in client) {
          return client.focus();
        }
      }
      /* Otherwise open a new window */
      if (clients.openWindow) {
        return clients.openWindow(urlToOpen);
      }
    })
  );
});

/* ── Push Event Fallback ─────────────────── */
self.addEventListener('push', function(event) {
  /* Firebase SDK handles this, but this is a safety net */
  if (!event.data) return;

  let data = {};
  try { data = event.data.json(); } catch (e) {
    data = { notification: { title: 'Jesus Embassy', body: event.data.text() } };
  }
});
