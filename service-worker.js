/* ================================================================
   SERVICE-WORKER.JS — Jesus Embassy PWA
   Version: je-v4.0.0 | Built: 2025-06-15
   ----------------------------------------------------------------
   SINGLE WORKER DESIGN:
   One SW handles both caching and FCM push notifications.
   A browser only allows ONE active SW per scope. If both
   service-worker.js and firebase-messaging-sw.js were registered,
   only one wins and push events are lost. All FCM code lives here.

   CACHE STRATEGY (v4 — network-first for all mutable assets):
   • HTML:       Network-first → cache fallback
   • CSS / JS:   Network-first → cache fallback  ← KEY FIX
   • Images:     Cache-first  → network fallback
   • Fonts (CDN): Stale-while-revalidate
   • Firebase/Google APIs: NEVER intercepted

   This ensures GitHub deployments are always visible immediately.
   Users never see stale CSS/JS even without reinstalling.

   UPDATES:
   • skipWaiting() called in install → new SW activates immediately
   • clients.claim() in activate    → page is claimed right away
   • Message handler for SKIP_WAITING from app.js reload button
   • Periodic self.registration.update() every 60 s
   ================================================================ */

/* ──────────────────────────────────────────────────────────────────
   PART 1 — Firebase Cloud Messaging (background push notifications)
   MUST be loaded before the install/activate/fetch handlers.
─────────────────────────────────────────────────────────────────── */
try {
  importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
  importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

  if (!firebase.apps.length) {
    firebase.initializeApp({
      apiKey:            'AIzaSyCuAIyM54XWy4DaYqoFYoEIUP0mQNaZQY4',
      authDomain:        'church-app-637f7.firebaseapp.com',
      projectId:         'church-app-637f7',
      storageBucket:     'church-app-637f7.firebasestorage.app',
      messagingSenderId: '534721516086',
      appId:             '1:534721516086:web:1dd27eae690c620098be97',
      databaseURL:       'https://church-app-637f7-default-rtdb.firebaseio.com',
      measurementId:     'G-JJL8SP6LNW'
    });
    console.log('[FCM SW] Firebase initialized successfully');
  }

  const messaging = firebase.messaging();

  /* ── Background Message Handler ─────────────────────────────────
     Called for DATA-ONLY messages when the app is in background/closed.
     For notification-type messages Firebase Console sends, the browser
     handles them natively using the 'notification' key — but we show
     them here explicitly so data-only messages also appear.
  ─────────────────────────────────────────────────────────────────*/
  messaging.onBackgroundMessage(function (payload) {
    console.log('[FCM SW] Background message received:', JSON.stringify(payload));

    const notification  = payload.notification || {};
    const data          = payload.data          || {};

    const title       = notification.title || data.title || 'Jesus Embassy';
    const body        = notification.body  || data.body  || 'You have a new message from Jesus Embassy.';
    const icon        = notification.icon  || '/Church-website-/assets/icons/icon-192.png';
    const badge       = '/Church-website-/assets/icons/icon-192.png';
    const clickAction = notification.click_action || data.click_action || '/Church-website-/';

    console.log('[FCM SW] Showing notification:', title, '|', body);

    return self.registration.showNotification(title, {
      body,
      icon,
      badge,
      image:              notification.image || data.image || undefined,
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

  console.log('[FCM SW] Background message handler registered');

} catch (err) {
  /* Non-fatal — caching still works; push notifications won't */
  console.error('[SW] Firebase Messaging init failed:', err.message || err);
}

/* ── Notification Click Handler ──────────────────────────────────── */
self.addEventListener('notificationclick', function (event) {
  console.log('[SW] Notification clicked. Action:', event.action);
  event.notification.close();

  if (event.action === 'dismiss') return;

  const urlToOpen = (event.notification.data && event.notification.data.url)
    ? event.notification.data.url
    : '/Church-website-/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      for (const client of windowClients) {
        if (client.url.includes('/Church-website-/') && 'focus' in client) {
          console.log('[SW] Focusing existing window');
          return client.focus();
        }
      }
      console.log('[SW] Opening new window:', urlToOpen);
      if (clients.openWindow) return clients.openWindow(urlToOpen);
    })
  );
});

/* ── Push Event Safety-Net ───────────────────────────────────────────
   Firebase SDK intercepts push events for notification-type messages
   from the Firebase Console. This is a fallback for cases where the
   SDK intercept fails (e.g., network error loading Firebase CDN).
─────────────────────────────────────────────────────────────────────*/
self.addEventListener('push', function (event) {
  if (!event.data) {
    console.log('[SW] Push received with no data — ignoring');
    return;
  }

  let payload = {};
  try {
    payload = event.data.json();
  } catch (e) {
    payload = { notification: { title: 'Jesus Embassy', body: event.data.text() } };
  }

  console.log('[SW] Push event received (safety-net handler):', JSON.stringify(payload));

  const notification = payload.notification || {};
  const data         = payload.data          || {};

  /* Only show if there is a title — otherwise Firebase SDK already handled it */
  const title = notification.title || data.title;
  if (!title) {
    console.log('[SW] Push: no title found, Firebase SDK likely handled it');
    return;
  }

  const body = notification.body || data.body || '';
  const icon = notification.icon || '/Church-website-/assets/icons/icon-192.png';

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

/* ──────────────────────────────────────────────────────────────────
   PART 2 — Caching Strategies
─────────────────────────────────────────────────────────────────── */

/* ── Cache Version ───────────────────────────────────────────────────
   IMPORTANT FOR DEVELOPERS:
   Update CACHE_VERSION any time you change service-worker.js so the
   browser detects a new SW. Also update it on major deployments.
   Format: je-v{major}.{minor}.{patch}-{YYYY-MM-DD}
─────────────────────────────────────────────────────────────────── */
const CACHE_VERSION = 'je-v6.0.0-20250617';
const STATIC_CACHE  = `${CACHE_VERSION}-static`;
const DYNAMIC_CACHE = `${CACHE_VERSION}-dynamic`;

console.log('[SW] Cache version:', CACHE_VERSION);

/* Pre-cache these assets on install (offline shell) */
const STATIC_ASSETS = [
  '/Church-website-/',
  '/Church-website-/index.html',
  '/Church-website-/manifest.json',
  '/Church-website-/css/style.css',
  '/Church-website-/css/components.css',
  '/Church-website-/css/responsive.css',
  '/Church-website-/js/app.js',
  '/Church-website-/js/router.js',
  '/Church-website-/js/install.js',
  '/Church-website-/js/settings.js',
  '/Church-website-/assets/icons/icon-192.png',
  '/Church-website-/assets/icons/icon-512.png',
];

/* Google Fonts CDN — use stale-while-revalidate */
const FONT_HOSTS = [
  'fonts.googleapis.com',
  'fonts.gstatic.com',
];

/* Firebase / Google API hostnames — NEVER intercept */
const PASSTHROUGH_HOSTS = [
  'firebaseio.com',
  'firebase.google.com',
  'firebaseapp.com',
  'fcm.googleapis.com',
  'googleapis.com',
  'gstatic.com',
  'firebaseinstallations.googleapis.com',
];

/* ── INSTALL ──────────────────────────────────────────────────────── */
self.addEventListener('install', event => {
  console.log('[SW] Install event. Version:', CACHE_VERSION);

  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(cache => {
        console.log('[SW] Pre-caching', STATIC_ASSETS.length, 'assets into', STATIC_CACHE);
        return Promise.all(
          STATIC_ASSETS.map(url =>
            cache.add(url).catch(err => {
              /* Non-fatal: asset may not exist yet (first deploy) */
              console.warn('[SW] Pre-cache miss (non-fatal):', url, err.message);
            })
          )
        );
      })
      .then(() => {
        console.log('[SW] Pre-cache complete. Calling skipWaiting()');
        /* Activate new SW immediately — do not wait for old tabs to close */
        return self.skipWaiting();
      })
      .catch(err => {
        console.error('[SW] Install failed:', err);
      })
  );
});

/* ── ACTIVATE ─────────────────────────────────────────────────────── */
self.addEventListener('activate', event => {
  console.log('[SW] Activate event. Cleaning old caches…');

  event.waitUntil(
    caches.keys()
      .then(keys => {
        console.log('[SW] All caches found:', keys);
        const toDelete = keys.filter(k => k !== STATIC_CACHE && k !== DYNAMIC_CACHE);

        if (toDelete.length) {
          console.log('[SW] Deleting old caches:', toDelete);
        } else {
          console.log('[SW] No old caches to delete');
        }

        return Promise.all(toDelete.map(k => {
          console.log('[SW] Deleting cache:', k);
          return caches.delete(k);
        }));
      })
      .then(() => {
        console.log('[SW] Cache cleanup done. Calling clients.claim()');
        /* Take control of all open tabs immediately */
        return self.clients.claim();
      })
      .then(() => {
        console.log('[SW] Activation complete. SW version:', CACHE_VERSION);
        /* Notify all clients that a new version is active */
        return self.clients.matchAll({ type: 'window' }).then(clients => {
          clients.forEach(client => {
            client.postMessage({ type: 'SW_ACTIVATED', version: CACHE_VERSION });
          });
        });
      })
      .catch(err => {
        console.error('[SW] Activate failed:', err);
      })
  );
});

/* ── MESSAGE HANDLER ─────────────────────────────────────────────────
   app.js sends 'SKIP_WAITING' when user clicks the update reload button.
   This tells the waiting SW to activate immediately.
─────────────────────────────────────────────────────────────────────*/
self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') {
    console.log('[SW] Received SKIP_WAITING message — activating now');
    self.skipWaiting();
  }
});

/* ── FETCH ──────────────────────────────────────────────────────────
   Strategy map:
   ┌─────────────────────────────┬──────────────────────────────────┐
   │ Request type                │ Strategy                         │
   ├─────────────────────────────┼──────────────────────────────────┤
   │ Firebase / Google APIs      │ PASSTHROUGH (never intercept)    │
   │ HTML navigation             │ Network-first → cache fallback   │
   │ CSS / JS files              │ Network-first → cache fallback   │
   │ Same-origin other           │ Network-first → cache fallback   │
   │ Images / icons              │ Cache-first  → network fallback  │
   │ Google Fonts CDN            │ Stale-while-revalidate           │
   └─────────────────────────────┴──────────────────────────────────┘

   Network-first for CSS/JS is the KEY FIX for the stale-content bug.
   Previously cache-first was used, meaning deployed CSS/JS updates
   were invisible until the user cleared storage and reinstalled.
──────────────────────────────────────────────────────────────────── */
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  /* Only handle GET */
  if (request.method !== 'GET') return;

  /* Skip chrome-extension requests */
  if (url.protocol === 'chrome-extension:') return;

  /* PASSTHROUGH: never intercept Firebase / Google API calls */
  if (PASSTHROUGH_HOSTS.some(host => url.hostname.includes(host))) {
    return; /* Let browser handle natively */
  }

  const path = url.pathname.toLowerCase();

  /* Google Fonts CDN — stale-while-revalidate */
  if (FONT_HOSTS.some(h => url.hostname.includes(h))) {
    event.respondWith(staleWhileRevalidate(request, DYNAMIC_CACHE));
    return;
  }

  /* Images & icons — cache-first (they rarely change) */
  if (/\.(png|jpg|jpeg|gif|svg|webp|ico)$/i.test(path)) {
    event.respondWith(cacheFirstThenNetwork(request, STATIC_CACHE));
    return;
  }

  /* HTML, CSS, JS, JSON — NETWORK-FIRST so deployments are always visible */
  if (
    request.mode === 'navigate' ||
    request.headers.get('Accept')?.includes('text/html') ||
    /\.(html|css|js|json)$/i.test(path) ||
    url.origin === self.location.origin
  ) {
    event.respondWith(networkFirstThenCache(request, STATIC_CACHE));
    return;
  }
});

/* ── Caching Helpers ─────────────────────────────────────────────── */

/**
 * Network-first: try network, update cache on success, fall back to cache.
 * Used for HTML, CSS, JS — ensures deployments are immediately visible.
 */
async function networkFirstThenCache(request, cacheName) {
  try {
    const networkResponse = await fetch(request, {
      /* Bypass browser HTTP cache for these requests so we always get
         the latest file from the server (GitHub Pages CDN) */
      cache: 'no-cache'
    });

    if (networkResponse.ok) {
      const cache = await caches.open(cacheName);
      await cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch {
    /* Network unavailable — serve from cache */
    const cached = await caches.match(request);
    if (cached) return cached;
    /* Final fallback: offline page */
    const offlineFallback = await caches.match('/Church-website-/index.html');
    return offlineFallback || new Response(
      '<html><body><h2>You are offline.</h2><p>Please check your connection and reload.</p></body></html>',
      { status: 503, headers: { 'Content-Type': 'text/html' } }
    );
  }
}

/**
 * Cache-first: serve from cache immediately, fall back to network.
 * Used for images/icons — saves bandwidth for static binary assets.
 */
async function cacheFirstThenNetwork(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      const cache = await caches.open(cacheName);
      await cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch {
    return new Response('Asset unavailable offline.', {
      status: 503,
      statusText: 'Service Unavailable',
      headers: { 'Content-Type': 'text/plain' }
    });
  }
}

/**
 * Stale-while-revalidate: serve cached immediately, revalidate in background.
 * Used for Google Fonts — fast page loads, fonts update eventually.
 */
async function staleWhileRevalidate(request, cacheName) {
  const cache  = await caches.open(cacheName);
  const cached = await cache.match(request);

  const fetchPromise = fetch(request).then(networkResponse => {
    if (networkResponse.ok) cache.put(request, networkResponse.clone());
    return networkResponse;
  }).catch(() => null);

  return cached || fetchPromise;
}

/* ── Periodic SW self-update check ──────────────────────────────────
   After 60 seconds, tell the browser to check if a new service-worker.js
   has been deployed to GitHub Pages. This is a belt-and-suspenders approach
   on top of the browser's own navigation-triggered update checks.
─────────────────────────────────────────────────────────────────────*/
setTimeout(() => {
  self.registration.update().catch(err => {
    console.warn('[SW] Periodic update check failed:', err.message);
  });
}, 60_000);
