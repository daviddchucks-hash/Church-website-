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
   browser detects a new SW. Also update it on major deployments
   Format: je-v{major}.{minor}.{patch}-{YYYY-MM-DD}
─────────────────────────────────────────────────────────────────── */
const CACHE_VERSION = 'je-v9.0.0-20260702';
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
  '/Church-website-/css/auth.css',
  '/Church-website-/js/app.js',
  '/Church-website-/js/router.js',
  '/Church-website-/js/install.js',
  '/Church-website-/js/settings.js',
  '/Church-website-/js/auth.js',
  '/Church-website-/js/auth-ui.js',
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

/* ── App Status — Emergency Shutdown Enforcement ────────────────────
   The SW independently polls /api/app-status for app status and enforces
   'offline'/'shutdown' at the network layer.  This means installed PWAs
   and devices with cached content CANNOT bypass an emergency shutdown —
   the SW intercepts every navigation and serves a shutdown page instead.
   admin.html is always exempt so the admin can restore the app.

   Uses Firebase Realtime Database REST (public read of /appSettings).
   No Node.js server required — works on GitHub Pages.
─────────────────────────────────────────────────────────────────────*/
/*
  Firebase RTDB REST endpoint for /appSettings (public read, no auth needed).
  Ensure Firebase Security Rules allow ".read": true on /appSettings.
*/
const APP_STATUS_URL    = 'https://church-app-637f7-default-rtdb.firebaseio.com/appSettings.json';
const APP_STATUS_KEY    = '__je-app-status__';
const STATUS_REFRESH_MS = 30_000; /* re-check every 30 seconds */

let _swAppStatus   = 'online';
let _statusChecked = 0; /* timestamp of last successful check */

/* Convert boolean status object to mode string */
function swBooleanToMode(data) {
  if (!data)                  return 'online';
  if (data.shutdown)          return 'shutdown';
  if (data.maintenance)       return 'maintenance';
  if (data.readOnly)          return 'readonly';
  if (data.online === false)  return 'offline';
  return 'online';
}

async function fetchSwAppStatus() {
  try {
    const res = await fetch(APP_STATUS_URL, { cache: 'no-store' });
    if (res.ok) {
      const data   = await res.json();
      _swAppStatus   = swBooleanToMode(data);
      _statusChecked = Date.now();
      /* Persist to cache for offline fallback */
      const c = await caches.open(DYNAMIC_CACHE);
      await c.put(APP_STATUS_KEY, new Response(
        JSON.stringify({ status: _swAppStatus, ts: _statusChecked }),
        { headers: { 'Content-Type': 'application/json' } }
      ));
      console.log('[SW] App status from Firebase RTDB:', _swAppStatus);
    }
  } catch {
    /* Network unavailable — try last cached value */
    try {
      const c = await caches.open(DYNAMIC_CACHE);
      const r = await c.match(APP_STATUS_KEY);
      if (r) {
        const d = await r.json();
        _swAppStatus   = d?.status || 'online';
        _statusChecked = d?.ts   || 0;
        console.log('[SW] App status from cache (offline fallback):', _swAppStatus);
      }
    } catch { /* ignore */ }
  }
  return _swAppStatus;
}

function makeShutdownPage() {
  return new Response(
    '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/>' +
    '<meta name="viewport" content="width=device-width,initial-scale=1"/>' +
    '<title>Jesus Embassy \u2014 Offline</title>' +
    '<style>*{box-sizing:border-box;margin:0;padding:0}' +
    'body{min-height:100vh;display:flex;align-items:center;justify-content:center;' +
    'background:linear-gradient(160deg,#080518,#130a30,#0a0418);' +
    'font-family:system-ui,sans-serif;color:#fff;text-align:center;padding:24px}' +
    '.box{max-width:380px}' +
    '.icon{font-size:4rem;margin-bottom:20px}' +
    'h1{font-size:1.4rem;font-weight:700;margin-bottom:12px}' +
    'p{font-size:0.88rem;color:rgba(255,255,255,0.65);line-height:1.7;margin-bottom:16px}' +
    '.btn{display:inline-block;margin:10px 6px 0;padding:11px 28px;' +
    'background:linear-gradient(135deg,#C9A84C,#E8C97E);' +
    'color:#1a0f3d;font-weight:700;border-radius:8px;text-decoration:none;cursor:pointer}' +
    '.admin{font-size:0.72rem;color:rgba(255,255,255,0.25);margin-top:24px;display:block;' +
    'text-decoration:none}</style></head>' +
    '<body><div class="box">' +
    '<div class="icon">\uD83D\uDD0C</div>' +
    '<h1>Jesus Embassy is Offline</h1>' +
    '<p>The app has been temporarily taken offline by the administrator.<br>Please check back later.</p>' +
    '<p style="font-size:0.8rem;color:rgba(255,255,255,0.4)">God bless you.</p>' +
    '<a class="btn" href="javascript:location.reload()">Try Again</a>' +
    '<a class="admin" href="/Church-website-/admin.html">Admin Access</a>' +
    '</div></body></html>',
    {
      status:  503,
      headers: { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' }
    }
  );
}

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
        /* Fetch app status immediately so shutdown enforcement is ready */
        fetchSwAppStatus().catch(() => { /* non-fatal */ });
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

  /* ── Emergency Shutdown enforcement (navigation requests only) ──────
     Check RTDB app status every STATUS_REFRESH_MS.  If status is
     'offline' or 'shutdown', serve the shutdown page instead of cached
     content.  Admin page (/admin.html) is always exempt.
  ─────────────────────────────────────────────────────────────────── */
  if (request.mode === 'navigate') {
    const isAdminPage = url.pathname.includes('admin.html');
    if (!isAdminPage) {
      const needsRefresh = (Date.now() - _statusChecked) > STATUS_REFRESH_MS;
      event.respondWith(
        (needsRefresh ? fetchSwAppStatus() : Promise.resolve(_swAppStatus))
          .then(status => {
            if (status === 'offline' || status === 'shutdown') {
              console.log('[SW] Emergency shutdown active — serving shutdown page');
              return makeShutdownPage();
            }
            return networkFirstThenCache(request, STATIC_CACHE);
          })
          .catch(() => networkFirstThenCache(request, STATIC_CACHE))
      );
      return;
    }
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
  /* Also refresh app status so shutdown enforcement stays current */
  fetchSwAppStatus().catch(() => { /* non-fatal */ });
}, 60_000);

/* Continue re-checking app status every 30 s so that an emergency shutdown
   propagates quickly even on devices that are not navigating. */
setInterval(() => {
  fetchSwAppStatus().catch(() => { /* non-fatal */ });
}, STATUS_REFRESH_MS);
