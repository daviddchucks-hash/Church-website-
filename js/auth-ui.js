/* ==============================================
   AUTH-UI.JS — Authentication UI Logic
   Jesus Embassy PWA
   -----------------------------------------------
   Initialises:
   - Login page (form, forgot-password)
   - Register page (form + validation)
   - Profile page (load user data, logout)
   - Navigation auth state (login/profile buttons)
   - Router auth guard (registered via setAuthGuard)

   ROUTE PROTECTION DESIGN
   ───────────────────────
   The auth guard is registered inside router.js via setAuthGuard().
   That guard runs at the top of showPage() — the single code path
   that ALL navigations (hashchange, popstate, data-page clicks,
   navigateTo()) go through — so it cannot be bypassed.

   Pages that do NOT require Firebase Auth:
     login, register, settings
   Settings is deliberately exempt because the admin panel has its
   own independent password gate (embassy1) — admins must always be
   able to reach settings for maintenance recovery, even before
   creating a Firebase Auth account.

   Called from app.js as: initAuthUI()
============================================== */

import {
  signUp,
  signIn,
  logout,
  resetPassword,
  getUserData,
  getCurrentUser,
  isAuthLoaded,
  onAuthStateChange,
  getAuthErrorMessage
} from './auth.js';

import { navigateTo, setAuthGuard } from './router.js';

/* ── Helpers ──────────────────────────────────────────────────── */
const el = id => document.getElementById(id);

function showError(elId, msg, isSuccess = false) {
  const e = el(elId);
  if (!e) return;
  e.textContent = msg;
  e.classList.add('show');
  e.classList.toggle('auth-success', isSuccess);
}

function hideError(elId) {
  const e = el(elId);
  if (!e) return;
  e.textContent = '';
  e.classList.remove('show', 'auth-success');
}

function setLoading(btnId, spinnerId, labelId, loading, labelText) {
  const btn     = el(btnId);
  const spinner = el(spinnerId);
  const label   = el(labelId);
  if (btn)    btn.disabled   = loading;
  if (spinner) spinner.style.display = loading ? 'inline-block' : 'none';
  if (label && labelText) label.textContent = labelText;
}

/* ── Pages exempt from Firebase Auth ─────────────────────────────
   login     — auth form itself
   register  — new account form
   settings  — has its own admin password gate (embassy1); admins
               must always be able to reach it for maintenance recovery
──────────────────────────────────────────────────────────────── */
const EXEMPT_PAGES = new Set(['login', 'register', 'settings']);

/* Remember where the user was trying to go before being redirected to login */
let _pendingRedirect = null;

/* ══════════════════════════════════════════════════════════════
   ROUTER AUTH GUARD
   Registered via setAuthGuard(). Called from inside showPage()
   for EVERY navigation — no bypass possible.
══════════════════════════════════════════════════════════════ */
function authGuard(pageId) {
  /* Don't intercept while Firebase Auth state is unknown (initial load).
     The splash screen covers any content during this < 300 ms window.
     Once auth resolves, handleAuthRouting() corrects the page if needed. */
  if (!isAuthLoaded()) return null;

  const user = getCurrentUser();

  if (user) {
    /* ── Signed in ──
       Redirect away from auth-form pages.
       Use _pendingRedirect as the post-login target (set on logout). */
    if (pageId === 'login' || pageId === 'register') {
      return _pendingRedirect || 'home';
    }
    return null; /* all other pages: proceed */
  } else {
    /* ── Not signed in ──
       Exempt pages are allowed through; everything else → login. */
    if (EXEMPT_PAGES.has(pageId)) return null;

    /* Save intended destination so we can redirect there after login */
    if (pageId !== 'home') _pendingRedirect = pageId;
    return 'login';
  }
}

/* ══════════════════════════════════════════════════════════════
   AUTH STATE → POST-ACTION ROUTING
   Handles redirects that happen BECAUSE AUTH CHANGED (not because
   of a navigation intent). This is complementary to authGuard:
   guard handles navigation attempts; this handles state changes.
══════════════════════════════════════════════════════════════ */
function handleAuthRouting(user) {
  const hash   = (window.location.hash || '').replace('#', '').toLowerCase().trim();
  const pageId = hash || 'home';

  if (user) {
    /* User just signed in or session was restored */
    if (pageId === 'login' || pageId === 'register') {
      const target = _pendingRedirect || 'home';
      _pendingRedirect = null;
      navigateTo(target);
    }
    /* Load profile data if already on profile page */
    if (pageId === 'profile') loadProfileData();

  } else {
    /* User just signed out */
    if (!EXEMPT_PAGES.has(pageId)) {
      /* Save current page as redirect target (so they return here after login) */
      _pendingRedirect = (pageId === 'home') ? null : pageId;
      navigateTo('login');
    }
  }

  updateNavForAuth(user);
}

/* ══════════════════════════════════════════════════════════════
   PASSWORD VISIBILITY TOGGLE
══════════════════════════════════════════════════════════════ */
function initPasswordToggles() {
  document.querySelectorAll('.auth-toggle-pw').forEach(btn => {
    btn.addEventListener('click', () => {
      const input  = el(btn.dataset.target);
      if (!input) return;
      const show   = input.type === 'password';
      input.type   = show ? 'text' : 'password';
      btn.textContent = show ? '🙈' : '👁';
      btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    });
  });
}

/* ══════════════════════════════════════════════════════════════
   LOGIN PAGE
══════════════════════════════════════════════════════════════ */
function initLoginPage() {
  const form = el('login-form');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideError('login-error');

    const email    = el('login-email')?.value.trim();
    const password = el('login-password')?.value;
    const remember = el('login-remember')?.checked !== false;

    if (!email)    { showError('login-error', 'Please enter your email address.'); return; }
    if (!password) { showError('login-error', 'Please enter your password.');      return; }

    setLoading('login-btn', 'login-spinner', 'login-btn-label', true, 'Signing in…');

    try {
      await signIn({ email, password, remember });
      /* handleAuthRouting fires via onAuthStateChange and handles the redirect */
    } catch (err) {
      console.error('[AuthUI] Login error:', err.code, err.message);
      showError('login-error', getAuthErrorMessage(err.code || err.message || ''));
      setLoading('login-btn', 'login-spinner', 'login-btn-label', false, 'Sign In');
    }
  });

  /* Forgot Password */
  el('login-forgot-link')?.addEventListener('click', async (e) => {
    e.preventDefault();
    hideError('login-error');

    const email = el('login-email')?.value.trim();
    if (!email) {
      showError('login-error', 'Enter your email address above, then click "Forgot password?"');
      el('login-email')?.focus();
      return;
    }

    try {
      await resetPassword(email);
      showError('login-error',
        `✅ Password reset email sent to ${email}. Check your inbox (and spam folder).`,
        true /* isSuccess */
      );
    } catch (err) {
      showError('login-error', getAuthErrorMessage(err.code || ''));
    }
  });

  /* Clear errors on input */
  ['login-email', 'login-password'].forEach(id => {
    el(id)?.addEventListener('input', () => hideError('login-error'));
  });

  console.log('[AuthUI] Login page initialized');
}

/* ══════════════════════════════════════════════════════════════
   REGISTER PAGE
══════════════════════════════════════════════════════════════ */
function initRegisterPage() {
  const form = el('register-form');
  if (!form) return;

  /* Live password-match indicator */
  const updateMatchHint = () => {
    const pw   = el('register-password')?.value  || '';
    const cf   = el('register-confirm')?.value   || '';
    const hint = el('register-match-hint');
    if (!hint) return;
    if (!cf) { hint.textContent = ''; return; }
    hint.textContent = pw === cf ? '✅ Passwords match' : '❌ Passwords do not match';
    hint.style.color = pw === cf ? '#2ecc71' : '#e74c3c';
  };

  ['register-password', 'register-confirm'].forEach(id => {
    el(id)?.addEventListener('input', () => { hideError('register-error'); updateMatchHint(); });
  });
  ['register-fullname', 'register-email'].forEach(id => {
    el(id)?.addEventListener('input', () => hideError('register-error'));
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideError('register-error');

    const fullName        = el('register-fullname')?.value.trim();
    const email           = el('register-email')?.value.trim();
    const password        = el('register-password')?.value;
    const confirmPassword = el('register-confirm')?.value;

    if (!fullName)        { showError('register-error', 'Please enter your full name.');        return; }
    if (!email)           { showError('register-error', 'Please enter your email address.');    return; }
    if (!password)        { showError('register-error', 'Please choose a password.');           return; }
    if (!confirmPassword) { showError('register-error', 'Please confirm your password.');       return; }
    if (password !== confirmPassword) {
      showError('register-error', 'Passwords do not match. Please try again.');
      el('register-confirm')?.focus();
      return;
    }
    if (password.length < 6) {
      showError('register-error', 'Password must be at least 6 characters.');
      return;
    }

    setLoading('register-btn', 'register-spinner', 'register-btn-label', true, 'Creating account…');

    try {
      await signUp({ fullName, email, password });
      /* handleAuthRouting fires and handles redirect */
    } catch (err) {
      console.error('[AuthUI] Register error:', err.code, err.message);
      showError('register-error', getAuthErrorMessage(err.code || err.message || ''));
      setLoading('register-btn', 'register-spinner', 'register-btn-label', false, 'Create Account');
    }
  });

  console.log('[AuthUI] Register page initialized');
}

/* ══════════════════════════════════════════════════════════════
   PROFILE PAGE
══════════════════════════════════════════════════════════════ */

/** Load and display the current user's profile data */
export async function loadProfileData() {
  const user = getCurrentUser();
  if (!user) return;

  const nameEl     = el('profile-name');
  const emailEl    = el('profile-email');
  const avatarEl   = el('profile-avatar');
  const verifiedEl = el('profile-verified');

  /* ── Step 1: Render immediately from Firebase Auth user object ──────────
     user.displayName is set at sign-up via updateProfile(), so it is
     always present without any network call. Falls back to email prefix
     for accounts created before this update. */
  const authName = (user.displayName || '').trim() || user.email.split('@')[0];

  if (nameEl)   nameEl.textContent   = authName;
  if (emailEl)  emailEl.textContent  = user.email;
  if (avatarEl) avatarEl.textContent = authName.charAt(0).toUpperCase();

  if (verifiedEl) {
    verifiedEl.textContent = user.emailVerified ? '✅ Email Verified' : '⚠️ Email Not Verified';
    verifiedEl.className   = 'profile-verified-badge ' + (user.emailVerified ? 'verified' : 'unverified');
  }

  /* Update nav button name straight away */
  const navNameSpan = el('nav-profile-btn')?.querySelector('.nav-profile-name');
  if (navNameSpan) navNameSpan.textContent = authName.split(' ')[0].slice(0, 10);

  /* ── Step 2: Enrich from RTDB (role, join date, canonical fullName) ─────
     Non-blocking — the profile is already usable from Step 1.
     Fails gracefully if RTDB rules are not yet configured. */
  try {
    const data = await getUserData(user.uid);
    if (!data) return; /* no RTDB entry yet — auth display is sufficient */

    /* Prefer RTDB fullName (exactly what the user typed at sign-up) */
    const rtdbName = (data.fullName || '').trim();
    if (rtdbName && rtdbName !== authName) {
      if (nameEl)      nameEl.textContent      = rtdbName;
      if (avatarEl)    avatarEl.textContent    = rtdbName.charAt(0).toUpperCase();
      if (navNameSpan) navNameSpan.textContent = rtdbName.split(' ')[0].slice(0, 10);
    }

    /* Role */
    const roleEl = el('profile-role');
    if (roleEl) roleEl.textContent = capitalise(data.role || 'member');

    /* Join date */
    const joinEl = el('profile-joined');
    let joinDate = null;
    if (typeof data.createdAt === 'number' && data.createdAt > 0) {
      joinDate = new Date(data.createdAt);
    } else if (user.metadata?.creationTime) {
      joinDate = new Date(user.metadata.creationTime);
    }
    if (joinEl) {
      joinEl.textContent = joinDate
        ? joinDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
        : '—';
    }

  } catch (err) {
    /* RTDB unavailable — auth-only display already shown, no action needed */
    console.warn('[AuthUI] RTDB profile fetch skipped:', err.message);
  }
}

function capitalise(str) {
  return str ? str.charAt(0).toUpperCase() + str.slice(1) : '';
}

function initProfilePage() {
  const logoutBtn = el('profile-logout-btn');
  if (!logoutBtn) return;

  logoutBtn.addEventListener('click', async () => {
    logoutBtn.disabled   = true;
    logoutBtn.textContent = '⏳ Signing out…';
    try {
      await logout();
      /* handleAuthRouting fires via onAuthStateChange → navigates to login */
    } catch (err) {
      console.error('[AuthUI] Logout error:', err);
      logoutBtn.disabled   = false;
      logoutBtn.textContent = '🚪 Sign Out';
    }
  });

  console.log('[AuthUI] Profile page initialized');
}

/* ══════════════════════════════════════════════════════════════
   NAVIGATION AUTH STATE
   Updates nav buttons / mobile menu / More tray to reflect
   whether the user is signed in or not.
══════════════════════════════════════════════════════════════ */
function updateNavForAuth(user) {
  /* Desktop nav */
  const navLoginBtn   = el('nav-login-btn');
  const navProfileBtn = el('nav-profile-btn');
  if (navLoginBtn)   navLoginBtn.style.display   = user ? 'none' : '';
  if (navProfileBtn) navProfileBtn.style.display = user ? ''     : 'none';

  if (navProfileBtn && user) {
    const nameSpan = navProfileBtn.querySelector('.nav-profile-name');
    if (nameSpan) {
      const first = (user.email || '').split('@')[0];
      nameSpan.textContent = (first.charAt(0).toUpperCase() + first.slice(1)).slice(0, 10);
    }
  }

  /* Mobile hamburger menu */
  const mobileLoginBtn   = el('mobile-login-btn');
  const mobileProfileBtn = el('mobile-profile-btn');
  const mobileLogoutBtn  = el('mobile-logout-btn');
  if (mobileLoginBtn)   mobileLoginBtn.style.display   = user ? 'none' : '';
  if (mobileProfileBtn) mobileProfileBtn.style.display = user ? ''     : 'none';
  if (mobileLogoutBtn)  mobileLogoutBtn.style.display  = user ? ''     : 'none';

  /* More tray */
  const trayLoginItem   = el('more-tray-login');
  const trayProfileItem = el('more-tray-profile');
  if (trayLoginItem)   trayLoginItem.style.display   = user ? 'none' : '';
  if (trayProfileItem) trayProfileItem.style.display = user ? ''     : 'none';
}

/* ── Mobile logout button ─────────────────────────────────────── */
function initMobileLogout() {
  el('mobile-logout-btn')?.addEventListener('click', async () => {
    const btn = el('mobile-logout-btn');
    if (btn) { btn.textContent = 'Signing out…'; btn.disabled = true; }
    try {
      await logout();
    } catch (err) {
      console.error('[AuthUI] Mobile logout error:', err);
      if (btn) { btn.textContent = '🚪 Sign Out'; btn.disabled = false; }
    }
  });
}

/* ══════════════════════════════════════════════════════════════
   PUBLIC ENTRY POINT
   Called from app.js after initRouter().
══════════════════════════════════════════════════════════════ */
export function initAuthUI() {
  /* Initialize form UI (doesn't depend on auth state) */
  initPasswordToggles();
  initLoginPage();
  initRegisterPage();
  initProfilePage();
  initMobileLogout();

  /* Register the router guard immediately.
     The guard no-ops while isAuthLoaded() is false, so it is safe
     to register before auth state resolves. Once auth loads, it
     enforces protection on every subsequent navigation attempt. */
  setAuthGuard(authGuard);

  /* Subscribe to auth state changes. This fires immediately with
     the current user when auth is already resolved (e.g. returning
     user with a cached session), or fires later when the Firebase
     SDK resolves the session from IndexedDB / network. */
  onAuthStateChange(handleAuthRouting);

  console.log('[AuthUI] ✅ Authentication UI and route guard initialized');
}
