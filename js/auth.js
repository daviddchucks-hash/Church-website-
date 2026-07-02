/* ==============================================
   AUTH.JS — Firebase Authentication
   Jesus Embassy PWA
   -----------------------------------------------
   Handles all Firebase Auth operations:
   - Email & Password Sign Up / Login
   - Persistent Login (localStorage by default)
   - Password Reset & Email Verification
   - User profile stored in Firebase RTDB /users/{uid}
   - Auth state observable used for route protection

   Coding style: ES Modules, CDN imports, async/await
   (matches the rest of the codebase)
============================================== */

import { app, rtdb } from './firebase.js';
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  sendEmailVerification,
  signOut,
  onAuthStateChanged,
  setPersistence,
  browserLocalPersistence,
  browserSessionPersistence,
  updateProfile
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import {
  ref,
  set,
  get,
  serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js';

/* ── Initialize Auth ──────────────────────────────────────────── */
export const auth = getAuth(app);

/* Set default persistence: local → users stay logged in after closing browser */
setPersistence(auth, browserLocalPersistence).catch(err => {
  console.warn('[Auth] Could not set persistence:', err.message);
});

console.log('[Auth] Firebase Auth initialized');

/* ── Internal State ───────────────────────────────────────────── */
let _currentUser    = null;   /* currently signed-in user, or null  */
let _authLoaded     = false;  /* true once onAuthStateChanged fires  */
const _stateCallbacks = [];   /* fire on every auth state change     */
const _readyCallbacks = [];   /* fire once when first state resolved */

/* ── Firebase Auth State Listener ────────────────────────────── */
onAuthStateChanged(auth, (user) => {
  _currentUser = user;
  console.log('[Auth] State →', user ? `signed in: ${user.email}` : 'signed out');

  /* Notify all state subscribers */
  _stateCallbacks.forEach(cb => {
    try { cb(user); } catch (e) { console.error('[Auth] State callback error:', e); }
  });

  /* Notify ready subscribers (fires once on first resolution) */
  if (!_authLoaded) {
    _authLoaded = true;
    const pending = _readyCallbacks.splice(0); /* clear and collect */
    pending.forEach(cb => {
      try { cb(user); } catch (e) { console.error('[Auth] Ready callback error:', e); }
    });
  }
});

/* ── Public API ───────────────────────────────────────────────── */

/** Returns the currently signed-in Firebase user, or null. */
export function getCurrentUser() { return _currentUser; }

/** Returns true once Firebase has resolved the initial auth state. */
export function isAuthLoaded()   { return _authLoaded; }

/**
 * Subscribe to auth state changes.
 * If auth is already loaded, the callback fires immediately with the current user.
 * @param {function(user: User|null): void} callback
 */
export function onAuthStateChange(callback) {
  if (typeof callback !== 'function') return;
  _stateCallbacks.push(callback);
  /* Fire immediately if state is already known */
  if (_authLoaded) callback(_currentUser);
}

/**
 * Fires callback once when Firebase has determined the initial auth state.
 * Equivalent to a one-shot Promise for the first onAuthStateChanged event.
 * If auth is already resolved, fires synchronously.
 * @param {function(user: User|null): void} callback
 */
export function onAuthReady(callback) {
  if (typeof callback !== 'function') return;
  if (_authLoaded) {
    callback(_currentUser);
  } else {
    _readyCallbacks.push(callback);
  }
}

/* ── Firebase RTDB User Profile ───────────────────────────────── */

/**
 * Save user profile data to Firebase Realtime Database at /users/{uid}.
 * Called automatically after signUp.
 * @param {string} uid
 * @param {Object} data  — fullName, email, role, etc.
 */
async function saveUserToRTDB(uid, data) {
  if (!rtdb) {
    console.warn('[Auth] RTDB not available — user profile will not be saved');
    return;
  }
  try {
    await set(ref(rtdb, `users/${uid}`), {
      uid,
      ...data,
      createdAt: serverTimestamp()
    });
    console.log('[Auth] ✅ User profile saved to RTDB at /users/' + uid);
  } catch (err) {
    /* Non-fatal — Firebase Auth account is already created even if RTDB fails */
    console.error('[Auth] RTDB profile save failed:', err.message);
    console.warn('[Auth] Hint: ensure /users path has ".write": true in Firebase Security Rules');
  }
}

/**
 * Fetch user profile data from Firebase RTDB.
 * @param {string} uid
 * @returns {Promise<Object|null>}
 */
export async function getUserData(uid) {
  if (!rtdb || !uid) return null;
  try {
    const snap = await get(ref(rtdb, `users/${uid}`));
    return snap.exists() ? snap.val() : null;
  } catch (err) {
    console.error('[Auth] getUserData failed:', err.message);
    return null;
  }
}

/* ── Auth Operations ──────────────────────────────────────────── */

/**
 * Sign Up — creates a Firebase Auth account + saves profile to RTDB.
 * User is automatically signed in after successful registration.
 *
 * @param {Object} params
 * @param {string} params.fullName
 * @param {string} params.email
 * @param {string} params.password
 * @returns {Promise<User>}
 * @throws Firebase Auth error (check err.code for specific error)
 */
export async function signUp({ fullName, email, password }) {
  const credential = await createUserWithEmailAndPassword(auth, email, password);
  const user = credential.user;

  /* Store displayName on the Firebase Auth user so it is always available
     from getCurrentUser().displayName without needing an RTDB fetch */
  await updateProfile(user, { displayName: fullName.trim() }).catch(err => {
    console.warn('[Auth] updateProfile failed (non-critical):', err.message);
  });

  /* Send email verification — non-blocking, failure is non-fatal */
  sendEmailVerification(user).then(() => {
    console.log('[Auth] Verification email sent to:', user.email);
  }).catch(err => {
    console.warn('[Auth] Verification email not sent (non-critical):', err.message);
  });

  /* Save additional profile data to RTDB */
  await saveUserToRTDB(user.uid, {
    fullName: fullName.trim(),
    email:    user.email,
    role:     'member'
  });

  console.log('[Auth] ✅ Sign-up complete:', user.email);
  return user;
}

/**
 * Sign In — authenticates with email & password.
 *
 * @param {Object}  params
 * @param {string}  params.email
 * @param {string}  params.password
 * @param {boolean} [params.remember=true]  — if false, session-only persistence
 * @returns {Promise<User>}
 * @throws Firebase Auth error
 */
export async function signIn({ email, password, remember = true }) {
  const persistence = remember ? browserLocalPersistence : browserSessionPersistence;
  /* Best-effort persistence switch — failure doesn't block login */
  await setPersistence(auth, persistence).catch(() => {});
  const credential = await signInWithEmailAndPassword(auth, email, password);
  console.log('[Auth] ✅ Signed in:', credential.user.email);
  return credential.user;
}

/**
 * Sign Out — logs the current user out.
 * The onAuthStateChanged listener will fire and handle UI updates.
 * @returns {Promise<void>}
 */
export async function logout() {
  await signOut(auth);
  console.log('[Auth] ✅ Signed out');
}

/**
 * Send a password reset email.
 * @param {string} email
 * @returns {Promise<void>}
 * @throws Firebase Auth error
 */
export async function resetPassword(email) {
  await sendPasswordResetEmail(auth, email);
  console.log('[Auth] ✅ Password reset email sent to:', email);
}

/* ── Auth Error Messages ───────────────────────────────────────── */

const ERROR_MAP = {
  'auth/email-already-in-use':   'This email address is already registered. Please sign in instead.',
  'auth/invalid-email':          'Please enter a valid email address.',
  'auth/operation-not-allowed':  'Email & password sign-in is not enabled. Please contact admin.',
  'auth/weak-password':          'Password is too weak — please use at least 6 characters.',
  'auth/user-disabled':          'Your account has been disabled. Please contact us for assistance.',
  'auth/user-not-found':         'No account found with this email address. Please register first.',
  'auth/wrong-password':         'Incorrect password. Please try again, or use "Forgot password?"',
  'auth/invalid-credential':     'Incorrect email or password. Please try again.',
  'auth/too-many-requests':      'Too many failed attempts. Please wait a moment before trying again.',
  'auth/network-request-failed': 'Network error. Please check your internet connection and retry.',
  'auth/popup-blocked':          'Popup was blocked. Please allow popups for this site.',
  'auth/requires-recent-login':  'Please sign in again to complete this action.',
  'auth/missing-email':          'Please enter your email address.',
  'auth/missing-password':       'Please enter your password.',
};

/**
 * Returns a user-friendly error message for a Firebase Auth error code.
 * @param {string} code  — e.g. 'auth/wrong-password'
 * @returns {string}
 */
export function getAuthErrorMessage(code) {
  return ERROR_MAP[code] || 'Something went wrong. Please try again.';
}
