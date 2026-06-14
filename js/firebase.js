/* ==============================================
   FIREBASE.JS — Firebase Initialization
   Jesus Embassy PWA
   NOTE: Firebase client-side config keys are
   designed to be public — security is enforced
   via Firebase Security Rules in the console.
============================================== */

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getFirestore }   from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { getMessaging }   from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging.js';
import { getAnalytics }   from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-analytics.js';

const firebaseConfig = {
  apiKey:            "AIzaSyCuAIyM54XWy4DaYqoFYoEIUP0mQNaZQY4",
  authDomain:        "church-app-637f7.firebaseapp.com",
  projectId:         "church-app-637f7",
  storageBucket:     "church-app-637f7.firebasestorage.app",
  messagingSenderId: "534721516086",
  appId:             "1:534721516086:web:1dd27eae690c620098be97",
  measurementId:     "G-JJL8SP6LNW"
};

const app       = initializeApp(firebaseConfig);
const db        = getFirestore(app);
let   messaging = null;

try {
  messaging = getMessaging(app);
} catch (err) {
  console.warn('[Firebase] Messaging not supported in this context:', err.message);
}

try {
  getAnalytics(app);
} catch (err) {
  console.warn('[Firebase] Analytics not available:', err.message);
}

export { app, db, messaging };
