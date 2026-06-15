/* ================================================================
   SERVICE-WORKER.JS — Jesus Embassy PWA
   Combines: Caching strategies + Firebase Cloud Messaging
   ----------------------------------------------------------------
   WHY MERGED: A browser only allows ONE active service worker per
   scope. Both service-worker.js and firebase-messaging-sw.js had
   scope /Church-website-/. Only one can win. The fix is to put all
   Firebase messaging code HERE so a single registered SW handles
   both caching and push events.
   ----------------------------------------------------------------
   Firebase compat SDK loaded via importScripts because native ESM
   imports in service workers require { type:'module' } which is
   not yet universally supported (not supported in Firefox SWs).
================================================================ */

/* ── Firebase Cloud Messaging — MUST be first ────────────────── */
try {
  importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
  importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

  /* Guard against double-init if SW is re-evaluated */
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

  /* ── Background Message Handler ──────────────────────────────
     onBackgroundMessage is called when the app is in the
     background or closed AND the message has no 'notification'
     key (data-only messages). For notification-type messages
     Firebase Console sends, the browser handles them via the
     push event below — but we show them here explicitly too.
  ──────────────────────────────────────────────────────────── */
  messaging.onBackgroundMessage(function (payload) {
    console.log('[FCM SW] Background message received:', payload);

    const { notification = {}, data = {} } = payload;
    const title       = notification.title || data.title || 'Jesus Embassy';
    const body        = notification.body  || data.body  || 'You have a new message from Jesus Embassy.';
    const icon        = notification.icon  || '/Church-website-/assets/icons/icon-192.png';
    const badge       = '/Church-website-/assets/icons/icon-192.png';
    const clickAction = notification.click_action || data.click_action || '/Church-website-/';

    return self.registration.showNotification(title, {
      body,
      icon,
      badge,
      image:              notification.image || data.image || null,
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

} catch (err) {
  /* Non-fatal — caching still works, but push won't */
  console.error('[SW] Firebase Messaging init failed (CDN load error?):', err);
}

/* ── Notification Click Handler ──────────────────────────────── */
self.addEventListener('notificationclick', function (event) {
  event.notification.close();

  if (event.action === 'dismiss') return;

  const urlToOpen = (event.notification.data && event.notification.data.url)
    ? event.notification.data.url
    : '/Church-website-/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      for (const client of windowClients) {
        if (client.url.includes('/Church-website-/') && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(urlToOpen);
      }
    })
  );
});

/* ── Push Event Fallback ─────────────────────────────────────────
   Firebase Console test messages send { notification, data }.
   The Firebase SDK intercepts these and calls onBackgroundMessage
   only for data-only messages. For notification-type messages the
   browser auto-shows a notification using the 'notification' key —
   BUT only if the service worker is properly registered and active.
   This fallback ensures notification-type messages are always shown
   even if the SDK intercept fails for any reason.
──────────────────────────────────────────────────────────────── */
self.addEventListener('push', function (event) {
  /* Firebase SDK handles this above; this is a safety net only */
  if (!event.data) return;

  let payload = {};
  try {
    payload = event.data.json();
  } catch (e) {
    payload = { notification: { title: 'Jesus Embassy', body: event.data.text() } };
  }

  /* Only handle if the SDK hasn't already shown a notification */
  const { notification = {}, data = {} } = payload;
  if (!notification.title && !data.title) return;

  const title = notification.title || data.title || 'Jesus Embassy';
  const body  = notification.body  || data.body  || '';
  const icon  = notification.icon  || '/Church-website-/assets/icons/icon-192.png';

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon,
      badge: '/Church-website-/assets/icons/icon-192.png',
      tag:   data.tag || 'je-notification',
      data:  { url: data.click_action || '/Church-website-/' }
    })
  );
});

/* ================================================================
   CACHING STRATEGIES
================================================================ */

const CACHE_VERSION = 'je-v2.1.0';
const STATIC_CACHE  = `${CACHE_VERSION}-static`;
const DYNAMIC_CACHE = `${CACHE_VERSION}-dynamic`;

const STATIC_ASSETS = [
  '/Church-website-/',
  '/Church-website-/index.html',
  '/Church-website-/manifest.json',
  '/Church-website-/css/style.css',
  '/Church-website-/css/components.css',
  '/Church-website-/css/responsive.css',
  '/Church-website-/js/app.js',
  '/Church-website-/js/install.js',
  '/Church-website-/assets/icons/icon-192.png',
  '/Church-website-/assets/icons/icon-512.png',
];

const CACHEABLE_HOSTS = [
  'fonts.googleapis.com',
  'fonts.gstatic.com',
];

/* ── INSTALL ─────────────────────────────────────────────────── */
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(cache => cache.addAll(STATIC_ASSETS).catch(err => {
        console.warn('[SW] Pre-cache partial failure (non-fatal):', err);
      }))
      .then(() => self.skipWaiting())
  );
});

/* ── ACTIVATE ────────────────────────────────────────────────── */
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(k => k !== STATIC_CACHE && k !== DYNAMIC_CACHE)
          .map(k => {
            console.log('[SW] Deleting old cache:', k);
            return caches.delete(k);
          })
      ))
      .then(() => self.clients.claim())
  );
});

/* ── FETCH ───────────────────────────────────────────────────── */
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== 'GET') return;
  if (url.protocol === 'chrome-extension:') return;

  /* Skip all Firebase/Google API requests — do not cache or intercept */
  if (url.hostname.includes('firebaseio.com'))         return;
  if (url.hostname.includes('firebase.google.com'))    return;
  if (url.hostname.includes('firebaseapp.com'))        return;
  if (url.hostname.includes('googleapis.com'))         return;
  if (url.hostname.includes('gstatic.com'))            return;
  if (url.hostname.includes('fcm.googleapis.com'))     return;
  if (url.hostname.includes('firebaseinstallations'))  return;

  /* Network-first for HTML navigation */
  if (request.mode === 'navigate' || request.headers.get('Accept')?.includes('text/html')) {
    event.respondWith(networkFirstThenCache(request, STATIC_CACHE));
    return;
  }

  /* Cache-first for same-origin static assets */
  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirstThenNetwork(request, STATIC_CACHE));
    return;
  }

  /* Stale-while-revalidate for Google Fonts */
  if (CACHEABLE_HOSTS.some(h => url.hostname.includes(h))) {
    event.respondWith(staleWhileRevalidate(request, DYNAMIC_CACHE));
    return;
  }
});

/* ── Caching Helpers ─────────────────────────────────────────── */
async function networkFirstThenCache(request, cacheName) {
  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch {
    const cached = await caches.match(request);
    return cached || caches.match('/Church-website-/index.html');
  }
}

async function cacheFirstThenNetwork(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch {
    return new Response('Offline – Please check your connection.', {
      status: 503,
      statusText: 'Service Unavailable',
      headers: { 'Content-Type': 'text/plain' }
    });
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache  = await caches.open(cacheName);
  const cached = await cache.match(request);

  const fetchPromise = fetch(request).then(networkResponse => {
    if (networkResponse.ok) cache.put(request, networkResponse.clone());
    return networkResponse;
  }).catch(() => null);

  return cached || fetchPromise;
}
