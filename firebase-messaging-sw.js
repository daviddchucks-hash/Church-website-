/* ================================================================
   FIREBASE-MESSAGING-SW.JS — Jesus Embassy PWA
   ================================================================
   ⚠️  THIS FILE IS NO LONGER REGISTERED AS A SERVICE WORKER.
   ----------------------------------------------------------------
   WHY: A browser only permits ONE service worker per scope.
   Both this file and service-worker.js had scope /Church-website-/.
   Registering two SWs at the same scope caused only one to win,
   and the losing SW's push handler was never called.

   FIX: Firebase messaging code was merged into service-worker.js.
   service-worker.js now handles BOTH caching AND push notifications.
   All getToken() calls pass navigator.serviceWorker.ready (which
   resolves to service-worker.js) as serviceWorkerRegistration.

   This file is kept as a reference / standalone backup only.
   To use it standalone (e.g., if you move to a root domain):
     - Remove Firebase code from service-worker.js
     - Register this file: navigator.serviceWorker.register('/firebase-messaging-sw.js')
     - Use that registration in getToken()
   ================================================================ */

importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

if (!firebase.apps.length) {
  firebase.initializeApp({
    apiKey:            "AIzaSyCuAIyM54XWy4DaYqoFYoEIUP0mQNaZQY4",
    authDomain:        "church-app-637f7.firebaseapp.com",
    projectId:         "church-app-637f7",
    storageBucket:     "church-app-637f7.firebasestorage.app",
    messagingSenderId: "534721516086",
    appId:             "1:534721516086:web:1dd27eae690c620098be97",
    measurementId:     "G-JJL8SP6LNW"
  });
}

const messaging = firebase.messaging();

messaging.onBackgroundMessage(function (payload) {
  console.log('[FCM SW standalone] Background message:', payload);
  const { notification = {}, data = {} } = payload;
  const title = notification.title || data.title || 'Jesus Embassy';
  const body  = notification.body  || data.body  || 'You have a new message.';
  const icon  = notification.icon  || '/Church-website-/assets/icons/icon-192.png';
  const clickAction = notification.click_action || data.click_action || '/Church-website-/';

  return self.registration.showNotification(title, {
    body,
    icon,
    badge:              '/Church-website-/assets/icons/icon-192.png',
    tag:                data.tag || 'je-notification',
    renotify:           true,
    requireInteraction: false,
    silent:             false,
    vibrate:            [200, 100, 200],
    data:               { url: clickAction, ...data },
    actions: [
      { action: 'open',    title: 'Open App' },
      { action: 'dismiss', title: 'Dismiss'  }
    ]
  });
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  if (event.action === 'dismiss') return;
  const url = (event.notification.data && event.notification.data.url)
    ? event.notification.data.url
    : '/Church-website-/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(wcs => {
      for (const c of wcs) {
        if (c.url.includes('/Church-website-/') && 'focus' in c) return c.focus();
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});

self.addEventListener('push', function (event) {
  if (!event.data) return;
  let payload = {};
  try { payload = event.data.json(); } catch (e) {
    payload = { notification: { title: 'Jesus Embassy', body: event.data.text() } };
  }
  const { notification = {}, data = {} } = payload;
  if (!notification.title && !data.title) return;
  event.waitUntil(
    self.registration.showNotification(
      notification.title || data.title || 'Jesus Embassy',
      {
        body:  notification.body  || data.body  || '',
        icon:  notification.icon  || '/Church-website-/assets/icons/icon-192.png',
        badge: '/Church-website-/assets/icons/icon-192.png',
        tag:   data.tag || 'je-notification',
        data:  { url: data.click_action || '/Church-website-/' }
      }
    )
  );
});
