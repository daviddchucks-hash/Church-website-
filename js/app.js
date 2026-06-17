/* ==============================================
   APP.JS — Main Application Logic
   Jesus Embassy PWA
   -----------------------------------------------
   CHANGELOG v5 (2025-06-17):
   - Added Settings page to More tray (TRAY_PAGES)
   - Added Firebase app status monitoring
     (online / readonly / maintenance modes)
   - Added admin-logout handler
   - All previous functionality unchanged
============================================== */

/* ── Splash Screen ────────────────────────────── */
(function initSplash() {
  const splash = document.getElementById('splash-screen');
  if (!splash) return;

  const MIN_MS = 2400;
  const start  = Date.now();

  function hideSplash() {
    const remaining = Math.max(0, MIN_MS - (Date.now() - start));
    setTimeout(() => {
      splash.classList.add('fade-out');
      splash.addEventListener('transitionend', () => splash.remove(), { once: true });
    }, remaining);
  }

  if (document.readyState === 'complete') {
    hideSplash();
  } else {
    window.addEventListener('load', hideSplash, { once: true });
  }
})();

/* ── Service Worker Registration ──────────────── */
(function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) {
    console.warn('[SW] Service workers not supported in this browser');
    return;
  }

  let currentRegistration = null;
  let reloadPending       = false;

  window.addEventListener('load', () => {
    console.log('[SW] Registering service worker…');

    navigator.serviceWorker.register('/Church-website-/service-worker.js', {
      scope:         '/Church-website-/',
      updateViaCache: 'none'
    })
    .then(reg => {
      currentRegistration = reg;
      console.log('[SW] ✅ Registered. Scope:', reg.scope);

      reg.addEventListener('updatefound', () => {
        const newWorker = reg.installing;
        console.log('[SW] Update found — new worker installing…');

        newWorker?.addEventListener('statechange', () => {
          console.log('[SW] New worker state changed to:', newWorker.state);

          if (newWorker.state === 'installed') {
            if (navigator.serviceWorker.controller) {
              console.log('[SW] New version installed and waiting. Showing update toast…');
              showUpdateToast(reg);
            } else {
              console.log('[SW] Service worker installed for the first time');
            }
          }
        });
      });

      if (reg.waiting && navigator.serviceWorker.controller) {
        console.log('[SW] There is already a waiting worker — showing update toast');
        showUpdateToast(reg);
      }

      setInterval(() => {
        console.log('[SW] Periodic update check…');
        reg.update().catch(err => console.warn('[SW] Update check failed:', err.message));
      }, 60_000);
    })
    .catch(err => {
      console.error('[SW] Registration failed:', err.message);
    });

    navigator.serviceWorker.addEventListener('controllerchange', () => {
      console.log('[SW] Controller changed — new SW is now active');
      if (!reloadPending) {
        reloadPending = true;
        console.log('[SW] Reloading page to apply new version…');
        window.location.reload();
      }
    });

    navigator.serviceWorker.addEventListener('message', event => {
      if (event.data?.type === 'SW_ACTIVATED') {
        console.log('[SW] New SW activated. Version:', event.data.version);
      }
    });
  });

  function showUpdateToast(reg) {
    const toast = document.getElementById('update-toast');
    if (!toast) return;

    toast.classList.add('show');
    console.log('[SW] Update toast shown');

    const reloadBtn = document.getElementById('update-reload-btn');
    if (reloadBtn && !reloadBtn.dataset.bound) {
      reloadBtn.dataset.bound = 'true';
      reloadBtn.addEventListener('click', () => {
        console.log('[SW] Reload button clicked — sending SKIP_WAITING to waiting worker');
        const waitingWorker = reg.waiting;
        if (waitingWorker) {
          waitingWorker.postMessage('SKIP_WAITING');
        } else {
          window.location.reload();
        }
      });
    }
  }
})();

/* ── Navbar Scroll Behaviour ──────────────────────
   Transparent on Home page, always dark elsewhere.
   The router also calls updateNavbar() on page
   change — this listener keeps it in sync on scroll.
──────────────────────────────────────────────── */
(function initNavbar() {
  const navbar = document.getElementById('navbar');
  if (!navbar) return;

  function onScroll() {
    /* Only apply transparent/scrolled toggle on Home page */
    const hash = (window.location.hash || '#home').replace('#', '');
    const isHome = hash === 'home' || hash === '' || hash === 'hero';
    if (isHome) {
      navbar.classList.toggle('scrolled', window.scrollY > 60);
    } else {
      navbar.classList.add('scrolled');
    }
  }

  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
})();

/* ── Mobile Menu Toggle ───────────────────────── */
(function initMobileMenu() {
  const toggle    = document.getElementById('nav-toggle');
  const navMobile = document.getElementById('nav-mobile');
  if (!toggle || !navMobile) return;

  toggle.addEventListener('click', () => {
    const isOpen = navMobile.classList.toggle('open');
    toggle.classList.toggle('open', isOpen);
    toggle.setAttribute('aria-expanded', String(isOpen));
  });

  /* Close menu when a link is clicked (router also calls closeMobileMenu) */
  navMobile.querySelectorAll('a').forEach(link => {
    link.addEventListener('click', () => {
      navMobile.classList.remove('open');
      toggle.classList.remove('open');
      toggle.setAttribute('aria-expanded', 'false');
    });
  });
})();

/* ── Hero Slider ──────────────────────────────── */
(function initHeroSlider() {
  const slides = document.querySelectorAll('.hero-slide');
  const dots   = document.querySelectorAll('.hero-dot');
  if (!slides.length) return;

  let current = 0;
  let timer;

  function goTo(index) {
    slides[current].classList.remove('active');
    dots[current]?.classList.remove('active');
    dots[current]?.setAttribute('aria-selected', 'false');
    current = ((index % slides.length) + slides.length) % slides.length;
    slides[current].classList.add('active');
    dots[current]?.classList.add('active');
    dots[current]?.setAttribute('aria-selected', 'true');
  }

  function next() { goTo(current + 1); }
  function prev() { goTo(current - 1); }

  function startTimer() {
    clearInterval(timer);
    timer = setInterval(next, 5000);
  }

  document.getElementById('hero-next')?.addEventListener('click', () => { next(); startTimer(); });
  document.getElementById('hero-prev')?.addEventListener('click', () => { prev(); startTimer(); });

  dots.forEach(dot => {
    dot.addEventListener('click', () => { goTo(+dot.dataset.index); startTimer(); });
  });

  /* Touch / swipe support */
  let touchStartX = 0;
  const hero = document.getElementById('hero');
  if (hero) {
    hero.addEventListener('touchstart', e => {
      touchStartX = e.changedTouches[0].clientX;
    }, { passive: true });

    hero.addEventListener('touchend', e => {
      const diff = touchStartX - e.changedTouches[0].clientX;
      if (Math.abs(diff) > 40) {
        diff > 0 ? next() : prev();
        startTimer();
      }
    }, { passive: true });
  }

  startTimer();
})();

/* ── Scroll Reveal ────────────────────────────── */
(function initScrollReveal() {
  const targets = document.querySelectorAll('.reveal, .reveal-left, .reveal-right');
  if (!targets.length) return;

  const obs = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        obs.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12 });

  targets.forEach(el => obs.observe(el));
})();

/* ── Contact Form — Formspree ─────────────────── */
(function initContactForm() {
  const form      = document.getElementById('contact-form');
  const submitBtn = document.getElementById('contact-submit-btn');
  const successEl = document.getElementById('form-success');
  const errorEl   = document.getElementById('form-error');
  const resetBtn  = document.getElementById('form-reset-btn');
  if (!form) return;

  function validateForm() {
    let valid = true;
    form.querySelectorAll('[required]').forEach(el => {
      el.classList.remove('invalid');
      if (!el.value.trim()) { el.classList.add('invalid'); valid = false; }
    });
    const emailEl = form.querySelector('#email');
    if (emailEl?.value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailEl.value)) {
      emailEl.classList.add('invalid');
      valid = false;
    }
    return valid;
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    /* Block submission in read-only mode */
    if (document.body.classList.contains('app-readonly')) {
      errorEl.textContent = '⚠️ The app is currently in Read-Only Mode. Form submissions are disabled.';
      errorEl.classList.add('show');
      return;
    }

    errorEl.classList.remove('show');

    if (!validateForm()) {
      errorEl.textContent = '⚠️ Please fill in all required fields correctly.';
      errorEl.classList.add('show');
      errorEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      return;
    }

    submitBtn.classList.add('btn-sending');
    submitBtn.textContent = 'Sending…';

    try {
      const res = await fetch(form.action, {
        method: 'POST',
        body:   new FormData(form),
        headers: { 'Accept': 'application/json' }
      });

      if (res.ok) {
        form.style.display = 'none';
        successEl.classList.add('show');
        errorEl.classList.remove('show');
      } else {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || 'Server error');
      }
    } catch (err) {
      console.error('[Form]', err);
      errorEl.textContent = '⚠️ Something went wrong. Please try again or email us directly.';
      errorEl.classList.add('show');
      submitBtn.classList.remove('btn-sending');
      submitBtn.textContent = 'Send Message ✦';
    }
  });

  resetBtn?.addEventListener('click', () => {
    form.reset();
    form.style.display = '';
    successEl.classList.remove('show');
    errorEl.classList.remove('show');
    submitBtn.classList.remove('btn-sending');
    submitBtn.textContent = 'Send Message ✦';
    form.querySelectorAll('.invalid').forEach(el => el.classList.remove('invalid'));
  });

  form.querySelectorAll('input, textarea').forEach(el => {
    el.addEventListener('input', () => el.classList.remove('invalid'));
  });
})();

/* ── Page Router + More Tray ──────────────────── */
(async function initAppRouter() {
  try {
    const { initRouter, onPageChange } = await import('./router.js');
    const { initSettings, onSettingsPageEnter } = await import('./settings.js');

    initRouter();
    initSettings();
    console.log('[App] Router and Settings initialized');

    /* Pages that live inside the More tray */
    const TRAY_PAGES = new Set(['services', 'news', 'gallery', 'contact', 'settings']);

    const tray        = document.getElementById('more-tray');
    const backdrop    = document.getElementById('more-tray-backdrop');
    const moreBtn     = document.getElementById('more-nav-btn');
    const trayItems   = document.querySelectorAll('.more-tray-item');

    if (!tray || !backdrop || !moreBtn) return;

    /* ── Open / close helpers ── */
    function openTray() {
      tray.classList.add('open');
      tray.setAttribute('aria-hidden', 'false');
      backdrop.classList.add('open');
      backdrop.setAttribute('aria-hidden', 'false');
      moreBtn.setAttribute('aria-expanded', 'true');
      moreBtn.classList.add('active');
    }

    function closeTray() {
      tray.classList.remove('open');
      tray.setAttribute('aria-hidden', 'true');
      backdrop.classList.remove('open');
      backdrop.setAttribute('aria-hidden', 'true');
      moreBtn.setAttribute('aria-expanded', 'false');
      /* Keep active class if current page is a tray page */
      const hash = (window.location.hash || '').replace('#', '');
      if (!TRAY_PAGES.has(hash)) moreBtn.classList.remove('active');
    }

    /* ── Toggle on More button tap ── */
    moreBtn.addEventListener('click', () => {
      const isOpen = tray.classList.contains('open');
      isOpen ? closeTray() : openTray();
    });

    /* ── Close when backdrop is tapped ── */
    backdrop.addEventListener('click', closeTray);

    /* ── Close when a tray page link is clicked ── */
    trayItems.forEach(item => {
      item.addEventListener('click', () => {
        setTimeout(closeTray, 80);
      });
    });

    /* ── Close on Escape key ── */
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && tray.classList.contains('open')) closeTray();
    });

    /* ── Highlight the active tray item + More button on page changes ── */
    onPageChange(pageId => {
      /* Mark More button active when on any tray page */
      moreBtn.classList.toggle('active', TRAY_PAGES.has(pageId));

      /* Highlight matching tray item */
      trayItems.forEach(item => {
        const target = (item.getAttribute('href') || '').replace('#', '');
        const match = target === pageId || (pageId === 'services' && target === 'events');
        item.classList.toggle('tray-active', match);
      });

      /* Auto-close tray when navigating */
      closeTray();

      /* Settings page: show gate or admin content */
      if (pageId === 'settings') {
        onSettingsPageEnter();
        /* When navigating to settings, hide maintenance overlay */
        const overlay = document.getElementById('maintenance-overlay');
        if (overlay) overlay.style.display = 'none';
      }

      /* Check maintenance after leaving settings */
      if (pageId !== 'settings') {
        reApplyAppStatus();
      }
    });

    console.log('[App] More tray initialized');
  } catch (err) {
    console.error('[App] Router/Tray failed to initialize:', err.message);
  }
})();

/* ── Firebase Notifications (async init) ─────── */
(async function initFirebaseNotifications() {
  try {
    console.log('[App] Loading notifications module…');
    const { initNotifications } = await import('./notifications.js');
    await initNotifications();
  } catch (err) {
    console.warn('[Notifications] Could not initialize FCM:', err.message);
  }
})();

/* ── App Status Monitoring ────────────────────────
   Watches Firebase RTDB /appSettings in real-time.
   Applies online / readonly / maintenance mode
   across the entire app. Admins are never locked out.
──────────────────────────────────────────────── */
let _currentAppStatus = 'online';
let _currentMaintenanceMsg = '';

function adminIsAuthed() {
  const SESSION_KEY = 'je-admin-auth';
  const SESSION_TTL = 8 * 60 * 60 * 1000;
  const ts = sessionStorage.getItem(SESSION_KEY);
  return !!(ts && (Date.now() - +ts) < SESSION_TTL);
}

function currentPageIsSettings() {
  return (window.location.hash || '').replace('#', '') === 'settings';
}

function applyAppStatus(status, maintenanceMessage) {
  _currentAppStatus      = status;
  _currentMaintenanceMsg = maintenanceMessage || '';

  const readonlyBanner   = document.getElementById('readonly-banner');
  const maintenanceOverlay = document.getElementById('maintenance-overlay');

  /* ── Read-Only Mode ── */
  document.body.classList.toggle('app-readonly', status === 'readonly');
  if (readonlyBanner) readonlyBanner.classList.toggle('show', status === 'readonly');

  /* ── Maintenance Mode ── */
  if (maintenanceOverlay) {
    const shouldShowOverlay =
      status === 'maintenance' &&
      !adminIsAuthed() &&
      !currentPageIsSettings();

    if (shouldShowOverlay) {
      const msgEl = document.getElementById('maintenance-msg-text');
      if (msgEl) msgEl.textContent = maintenanceMessage || 'We are updating the church app. Please check back later.';
      maintenanceOverlay.style.display = 'flex';
    } else {
      maintenanceOverlay.style.display = 'none';
    }
  }

  console.log('[AppStatus] Mode applied:', status);
}

function reApplyAppStatus() {
  applyAppStatus(_currentAppStatus, _currentMaintenanceMsg);
}

/* Admin logout: re-check maintenance after logout */
window.addEventListener('admin-logout', () => {
  reApplyAppStatus();
  /* If maintenance, navigate home */
  if (_currentAppStatus === 'maintenance') {
    window.location.hash = '#home';
  }
});

/* Manual app-status-changed event (from settings.js) */
window.addEventListener('app-status-changed', e => {
  applyAppStatus(e.detail.status, e.detail.maintenanceMessage);
});

/* Maintenance overlay "Admin Access" button */
document.addEventListener('DOMContentLoaded', () => {
  const accessBtn = document.getElementById('maintenance-admin-btn');
  if (accessBtn) {
    accessBtn.addEventListener('click', () => {
      const overlay = document.getElementById('maintenance-overlay');
      if (overlay) overlay.style.display = 'none';
      window.location.hash = '#settings';
    });
  }
});

(async function initAppStatusMonitor() {
  try {
    const { rtdb } = await import('./firebase.js');
    const { ref, onValue } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js');

    if (!rtdb) { console.warn('[AppStatus] RTDB not available'); return; }

    onValue(ref(rtdb, 'appSettings'), snapshot => {
      const data = snapshot.val() || {};
      const status  = data.status             || 'online';
      const message = data.maintenanceMessage || '';
      applyAppStatus(status, message);
    }, err => {
      console.warn('[AppStatus] RTDB listen error (non-critical):', err.message);
    });

    console.log('[AppStatus] Realtime listener active');
  } catch (err) {
    console.warn('[AppStatus] Could not initialize real-time status monitor:', err.message);
    /* Fallback: poll every 30s */
    setInterval(async () => {
      try {
        const res = await fetch('https://church-app-637f7-default-rtdb.firebaseio.com/appSettings.json');
        if (res.ok) {
          const data = await res.json() || {};
          applyAppStatus(data.status || 'online', data.maintenanceMessage || '');
        }
      } catch { /* non-critical */ }
    }, 30_000);
  }
})();
