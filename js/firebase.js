/* ==============================================
   FIREBASE.JS — Firebase Initialization
   Jesus Embassy PWA
   -----------------------------------------------
   NOTE: Firebase client-side config keys are
   public by design. Security is enforced via
   Firebase Security Rules in the console.

   CHANGELOG v2:
   - Added databaseURL for Realtime Database
   - Exports rtdb (Realtime Database instance)
   - Firestore kept as secondary fallback
============================================== */

import { initializeApp }  from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getDatabase }     from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js';
import { getFirestore }    from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { getMessaging }    from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging.js';
import { getAnalytics }    from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-analytics.js';

const firebaseConfig = {
  apiKey:            'AIzaSyCuAIyM54XWy4DaYqoFYoEIUP0mQNaZQY4',
  authDomain:        'church-app-637f7.firebaseapp.com',
  projectId:         'church-app-637f7',
  storageBucket:     'church-app-637f7.firebasestorage.app',
  messagingSenderId: '534721516086',
  appId:             '1:534721516086:web:1dd27eae690c620098be97',
  /* ── RTDB URL (required for Realtime Database) ── */
  databaseURL:       'https://church-app-637f7-default-rtdb.firebaseio.com',
  measurementId:     'G-JJL8SP6LNW'
};

/* ── Initialize App ───────────────────────────────────────────── */
const app = initializeApp(firebaseConfig);
console.log('[Firebase] App initialized. Project:', firebaseConfig.projectId);

/* ── Realtime Database (PRIMARY token store) ──────────────────── */
let rtdb = null;
try {
  rtdb = getDatabase(app);
  console.log('[Firebase] Realtime Database connected:', firebaseConfig.databaseURL);
} catch (err) {
  console.error('[Firebase] Realtime Database init failed:', err.message);
}

/* ── Firestore (SECONDARY / fallback token store) ─────────────── */
let db = null;
try {
  db = getFirestore(app);
  console.log('[Firebase] Firestore connected');
} catch (err) {
  console.warn('[Firebase] Firestore init failed:', err.message);
}

/* ── Firebase Messaging ───────────────────────────────────────── */
let messaging = null;
try {
  messaging = getMessaging(app);
  console.log('[Firebase] Messaging initialized');
} catch (err) {
  console.warn('[Firebase] Messaging not supported in this context:', err.message);
}

/* ── Analytics ────────────────────────────────────────────────── */
try {
  getAnalytics(app);
  console.log('[Firebase] Analytics initialized');
} catch (err) {
  console.warn('[Firebase] Analytics not available:', err.message);
}

export { app, rtdb, db, messaging };
