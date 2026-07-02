/* ==============================================
   AUTH-UI.JS — Authentication UI Logic
   Jesus Embassy PWA
   -----------------------------------------------
   Initialises:
   - Login page (form handling, forgot password)
   - Register page (form + validation)
   - Profile page (load user data, logout)
   - Navigation auth state (login/profile buttons)
   - Route protection (redirects unauthenticated users)

   Called from app.js as: initAuthUI()
============================================== */

import {
  signUp,
  signIn,
  logout,
  resetPassword,
  getUserData,
  getCurrentUser,
  onAuthStateChange,
  getAuthErrorMessage
} from './auth.js';

import { navigateTo } from './router.js';

/* ── Helpers ──────────────────────────────────────────────────── */
const el = id => document.getElementById(id);

function showError(elId, msg, isSuccess = false) {
  const e = el(elId);
  if (!e) return;
  e.textContent = msg;
  e.classList.add('show');
  if (isSuccess) {
    e.classList.add('auth-success');
  } else {
    e.classList.remove('auth-success');
  }
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
  if (btn)     btn.disabled   = loading;
  if (spinner) spinner.style.display = loading ? 'inline-block' : 'none';
  if (label && labelText)   label.textContent = labelText;
}

/* ── Pages that do NOT require authentication ─────────────────── */
const PUBLIC_PAGES = new Set(['login', 'register']);

/* Page user tried to visit before being redirected to login */
let _pendingRedirect = null;

/* ── Password Visibility Toggle ───────────────────────────────── */
function initPasswordToggles() {
  document.querySelectorAll('.auth-toggle-pw').forEach(btn => {
    btn.addEventListener('click', () => {
      const input = el(btn.dataset.target);
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
    if (!password) { showError('login-error', 'Please enter your password.'); return; }

    setLoading('login-btn', 'login-spinner', 'login-btn-label', true, 'Signing in…');

    try {
      await signIn({ email, password, remember });
      /* onAuthStateChange (below) handles redirect after successful login */
    } catch (err) {
      console.error('[AuthUI] Login error:', err.code, err.message);
      showError('login-error', getAuthErrorMessage(err.code || err.message || ''));
      setLoading('login-btn', 'login-spinner', 'login-btn-label', false, 'Sign In');
    }
  });

  /* Forgot Password */
  const forgotLink = el('login-forgot-link');
  if (forgotLink) {
    forgotLink.addEventListener('click', async (e) => {
      e.preventDefault();
      hideError('login-error');

      const email = el('login-email')?.value.trim();
      if (!email) {
        showError('login-error', 'Please enter your email address above, then click "Forgot password?"');
        el('login-email')?.focus();
        return;
      }

      try {
        await resetPassword(email);
        showError('login-error', `✅ Password reset email sent to ${email}. Check your inbox (and spam folder).`, true);
      } catch (err) {
        showError('login-error', getAuthErrorMessage(err.code || ''));
      }
    });
  }

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
    if (pw === cf) {
      hint.textContent = '✅ Passwords match';
      hint.style.color = '#2ecc71';
    } else {
      hint.textContent = '❌ Passwords do not match';
      hint.style.color = '#e74c3c';
    }
  };

  ['register-password', 'register-confirm'].forEach(id => {
    el(id)?.addEventListener('input', () => {
      hideError('register-error');
      updateMatchHint();
    });
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

    /* Validation */
    if (!fullName)              { showError('register-error', 'Please enter your full name.'); return; }
    if (!email)                 { showError('register-error', 'Please enter your email address.'); return; }
    if (!password)              { showError('register-error', 'Please enter a password.'); return; }
    if (!confirmPassword)       { showError('register-error', 'Please confirm your password.'); return; }
    if (password !== confirmPassword) {
      showError('register-error', 'Passwords do not match. Please re-enter them.');
      el('register-confirm')?.focus();
      return;
    }
    if (password.length < 6) {
      showError('register-error', 'Password must be at least 6 characters long.');
      return;
    }

    setLoading('register-btn', 'register-spinner', 'register-btn-label', true, 'Creating account…');

    try {
      await signUp({ fullName, email, password });
      /* onAuthStateChange handles redirect after successful registration */
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
async function loadProfileData() {
  const user = getCurrentUser();
  if (!user) return;

  /* Immediately show what we know from Firebase Auth */
  const emailEl   = el('profile-email');
  const avatarEl  = el('profile-avatar');

  if (emailEl)  emailEl.textContent  = user.email;
  if (avatarEl) avatarEl.textContent = (user.email || 'M').charAt(0).toUpperCase();

  /* Set verification badge */
  const verifiedEl = el('profile-verified');
  if (verifiedEl) {
    verifiedEl.textContent = user.emailVerified ? '✅ Email Verified' : '⚠️ Email Not Verified';
    verifiedEl.className   = 'profile-verified-badge ' + (user.emailVerified ? 'verified' : 'unverified');
  }

  /* Load richer data from RTDB */
  try {
    const data = await getUserData(user.uid);
    const displayName = (data?.fullName || user.displayName || '').trim() || user.email.split('@')[0];

    const nameEl  = el('profile-name');
    const roleEl  = el('profile-role');
    const joinEl  = el('profile-joined');

    if (nameEl)  nameEl.textContent  = displayName;
    if (avatarEl) avatarEl.textContent = displayName.charAt(0).toUpperCase();
    if (roleEl)  roleEl.textContent  = data?.role ? capitalise(data.role) : 'Member';

    /* Join date — prefer RTDB createdAt (server timestamp), fallback to Firebase Auth metadata */
    let joinDate = null;
    if (data?.createdAt && typeof data.createdAt === 'number') {
      joinDate = new Date(data.createdAt);
    } else if (user.metadata?.creationTime) {
      joinDate = new Date(user.metadata.creationTime);
    }

    if (joinEl && joinDate) {
      joinEl.textContent = joinDate.toLocaleDateString('en-GB', {
        day: 'numeric', month: 'long', year: 'numeric'
      });
    } else if (joinEl) {
      joinEl.textContent = '—';
    }

    /* Update nav profile button with real name */
    const navProfileBtn = el('nav-profile-btn');
    if (navProfileBtn && displayName) {
      navProfileBtn.title = displayName;
      const nameSpan = navProfileBtn.querySelector('.nav-profile-name');
      if (nameSpan) nameSpan.textContent = displayName.split(' ')[0]; /* first name only */
    }

  } catch (err) {
    console.warn('[AuthUI] Could not load RTDB profile data:', err.message);
    const nameEl = el('profile-name');
    if (nameEl && !nameEl.textContent) nameEl.textContent = user.email;
  }
}

function capitalise(str) {
  return str ? str.charAt(0).toUpperCase() + str.slice(1) : '';
}

function initProfilePage() {
  /* Logout button */
  const logoutBtn = el('profile-logout-btn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      logoutBtn.disabled   = true;
      logoutBtn.textContent = '⏳ Signing out…';
      try {
        await logout();
        /* onAuthStateChange handles redirect to login */
      } catch (err) {
        console.error('[AuthUI] Logout error:', err);
        logoutBtn.disabled   = false;
        logoutBtn.textContent = '🚪 Sign Out';
      }
    });
  }

  console.log('[AuthUI] Profile page initialized');
}

/* ══════════════════════════════════════════════════════════════
   NAVIGATION AUTH STATE
══════════════════════════════════════════════════════════════ */

function updateNavForAuth(user) {
  /* Desktop nav — login link vs profile button */
  const navLoginBtn   = el('nav-login-btn');
  const navProfileBtn = el('nav-profile-btn');
  if (navLoginBtn)   navLoginBtn.style.display   = user ? 'none' : '';
  if (navProfileBtn) navProfileBtn.style.display = user ? '' : 'none';

  if (navProfileBtn && user) {
    /* Show first name or first letter of email */
    const userData = getCurrentUser();
    const nameSpan = navProfileBtn.querySelector('.nav-profile-name');
    if (nameSpan) {
      const first = (user.email || '').split('@')[0];
      nameSpan.textContent = first.charAt(0).toUpperCase() + first.slice(1, 8);
    }
  }

  /* Mobile hamburger menu */
  const mobileLoginBtn   = el('mobile-login-btn');
  const mobileProfileBtn = el('mobile-profile-btn');
  const mobileLogoutBtn  = el('mobile-logout-btn');
  if (mobileLoginBtn)   mobileLoginBtn.style.display   = user ? 'none' : '';
  if (mobileProfileBtn) mobileProfileBtn.style.display = user ? '' : 'none';
  if (mobileLogoutBtn)  mobileLogoutBtn.style.display  = user ? '' : 'none';

  /* More tray auth items */
  const trayLoginItem   = el('more-tray-login');
  const trayProfileItem = el('more-tray-profile');
  if (trayLoginItem)   trayLoginItem.style.display   = user ? 'none' : '';
  if (trayProfileItem) trayProfileItem.style.display = user ? '' : 'none';
}

/* ── Mobile logout handler ────────────────────────────────────── */
function initMobileLogout() {
  const btn = el('mobile-logout-btn');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    btn.textContent = 'Signing out…';
    btn.disabled    = true;
    try {
      await logout();
    } catch (err) {
      btn.textContent = 'Sign Out';
      btn.disabled    = false;
    }
  });
}

/* ══════════════════════════════════════════════════════════════
   ROUTE PROTECTION
   Fires on every auth state change. Handles redirects.
══════════════════════════════════════════════════════════════ */
function handleAuthRouting(user) {
  const hash   = (window.location.hash || '').replace('#', '').toLowerCase().trim();
  const pageId = hash || 'home';

  if (user) {
    /* ── Signed in ── */
    /* If user is on login or register page, redirect them away */
    if (pageId === 'login' || pageId === 'register') {
      const target = _pendingRedirect || 'home';
      _pendingRedirect = null;
      navigateTo(target);
    }
    /* If user navigates to profile, load fresh data */
    if (pageId === 'profile') {
      loadProfileData();
    }
  } else {
    /* ── Not signed in ── */
    if (!PUBLIC_PAGES.has(pageId)) {
      /* Remember where they wanted to go */
      _pendingRedirect = (pageId === 'home' || pageId === '') ? null : pageId;
      navigateTo('login');
    }
  }

  /* Always update nav to reflect current auth state */
  updateNavForAuth(user);
}

/* ── Also handle hash changes for protection after initial load ── */
function initHashChangeGuard() {
  window.addEventListener('hashchange', () => {
    const user   = getCurrentUser();
    const hash   = (window.location.hash || '').replace('#', '').toLowerCase().trim();
    const pageId = hash || 'home';

    if (!user && !PUBLIC_PAGES.has(pageId)) {
      _pendingRedirect = pageId === 'home' ? null : pageId;
      navigateTo('login');
      return;
    }
    if (pageId === 'profile' && user) {
      loadProfileData();
    }
  });
}

/* ══════════════════════════════════════════════════════════════
   PUBLIC ENTRY POINT
   Called from app.js after initRouter()
══════════════════════════════════════════════════════════════ */
export function initAuthUI() {
  initPasswordToggles();
  initLoginPage();
  initRegisterPage();
  initProfilePage();
  initMobileLogout();
  initHashChangeGuard();

  /* Wire into auth state — this fires immediately if auth is already loaded */
  onAuthStateChange(handleAuthRouting);

  console.log('[AuthUI] ✅ Authentication UI initialized');
}

/* Export loadProfileData so app.js can call it on page change */
export { loadProfileData };
