/* ==============================================
   SERVICE-WORKER.JS — Jesus Embassy PWA
   Strategy: Cache-first for assets, Network-first for HTML
   Version bump triggers full cache refresh
============================================== */

const CACHE_VERSION = 'je-v2.0.0';
const STATIC_CACHE  = `${CACHE_VERSION}-static`;
const DYNAMIC_CACHE = `${CACHE_VERSION}-dynamic`;

/* Files to pre-cache on install */
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

/* Third-party hosts to cache with stale-while-revalidate */
const CACHEABLE_HOSTS = [
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'www.gstatic.com',
];

/* ── INSTALL ──────────────────────────────── */
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(cache => cache.addAll(STATIC_ASSETS).catch(err => {
        console.warn('[SW] Pre-cache partial failure (non-fatal):', err);
      }))
      .then(() => self.skipWaiting())
  );
});

/* ── ACTIVATE ─────────────────────────────── */
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

/* ── FETCH ────────────────────────────────── */
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  /* Skip non-GET, chrome-extension, and Firebase requests */
  if (request.method !== 'GET') return;
  if (url.protocol === 'chrome-extension:') return;
  if (url.hostname.includes('firebaseio.com'))    return;
  if (url.hostname.includes('firebase.google.com')) return;
  if (url.hostname.includes('googleapis.com') && !CACHEABLE_HOSTS.includes(url.hostname)) return;

  /* Strategy A: Network-first for HTML navigation */
  if (request.mode === 'navigate' || request.headers.get('Accept')?.includes('text/html')) {
    event.respondWith(networkFirstThenCache(request, STATIC_CACHE));
    return;
  }

  /* Strategy B: Cache-first for same-origin static assets */
  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirstThenNetwork(request, STATIC_CACHE));
    return;
  }

  /* Strategy C: Stale-while-revalidate for fonts and Firebase SDK */
  if (CACHEABLE_HOSTS.some(h => url.hostname.includes(h))) {
    event.respondWith(staleWhileRevalidate(request, DYNAMIC_CACHE));
    return;
  }

  /* Default: network only */
  event.respondWith(
    fetch(request).catch(() => caches.match('/Church-website-/index.html'))
  );
});

/* ── Caching Helpers ──────────────────────── */
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
