/* ==============================================
   APP.JS — Main Application Logic
   Jesus Embassy PWA
   -----------------------------------------------
   CHANGELOG v3 (2025-06-15):
   - Added updateViaCache:'none' to SW registration
     so GitHub deployments are always detected
   - Wired #update-reload-btn to postMessage('SKIP_WAITING')
     so clicking Reload actually triggers SW swap
   - Added navigator.serviceWorker.controllerchange
     listener so page reloads automatically after
     new SW takes control
   - Added periodic SW update check every 60 seconds
   - Added SW_ACTIVATED message handler
   - Added detailed diagnostics logging throughout
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

  /* Store registration for the update reload button */
  let currentRegistration = null;
  let reloadPending       = false;

  window.addEventListener('load', () => {
    console.log('[SW] Registering service worker…');

    navigator.serviceWorker.register('/Church-website-/service-worker.js', {
      scope:         '/Church-website-/',
      /* ── KEY FIX: bypass HTTP cache when fetching the SW file ──
         Without this, GitHub Pages may serve a cached SW so the
         browser never detects that a new version was deployed.
         updateViaCache:'none' forces a fresh network fetch of the
         SW file on every navigation, guaranteeing updates are found. */
      updateViaCache: 'none'
    })
    .then(reg => {
      currentRegistration = reg;
      console.log('[SW] ✅ Registered. Scope:', reg.scope);
      console.log('[SW] SW state — installing:', reg.installing?.state,
                  '| waiting:', reg.waiting?.state,
                  '| active:', reg.active?.state);

      /* ── Detect when a new SW is found ────────────────────────── */
      reg.addEventListener('updatefound', () => {
        const newWorker = reg.installing;
        console.log('[SW] Update found — new worker installing…');

        newWorker?.addEventListener('statechange', () => {
          console.log('[SW] New worker state changed to:', newWorker.state);

          if (newWorker.state === 'installed') {
            if (navigator.serviceWorker.controller) {
              /* A previous SW was active — this is a version update */
              console.log('[SW] New version installed and waiting. Showing update toast…');
              showUpdateToast(reg);
            } else {
              /* First install — no previous controller */
              console.log('[SW] Service worker installed for the first time (no previous controller)');
            }
          }
        });
      });

      /* ── If there is already a waiting SW, show toast immediately ─ */
      if (reg.waiting && navigator.serviceWorker.controller) {
        console.log('[SW] There is already a waiting worker — showing update toast');
        showUpdateToast(reg);
      }

      /* ── Periodic update check every 60 seconds ─────────────────
         Belt-and-suspenders on top of navigation-triggered checks.
         Catches updates for users who keep the PWA open for hours. */
      setInterval(() => {
        console.log('[SW] Periodic update check…');
        reg.update().catch(err => console.warn('[SW] Update check failed:', err.message));
      }, 60_000);
    })
    .catch(err => {
      console.error('[SW] Registration failed:', err.message);
    });

    /* ── controllerchange: fired when a new SW takes control ────────
       After the waiting SW receives SKIP_WAITING and activates,
       the controller changes. We reload the page at this point so
       the user immediately sees the new version.
       reloadPending guard prevents double-reloads. */
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      console.log('[SW] Controller changed — new SW is now active');
      if (!reloadPending) {
        reloadPending = true;
        console.log('[SW] Reloading page to apply new version…');
        window.location.reload();
      }
    });

    /* ── SW_ACTIVATED message from the service worker ────────────── */
    navigator.serviceWorker.addEventListener('message', event => {
      if (event.data?.type === 'SW_ACTIVATED') {
        console.log('[SW] New SW activated. Version:', event.data.version);
      }
    });
  });

  /* ── Show update available toast ─────────────────────────────── */
  function showUpdateToast(reg) {
    const toast = document.getElementById('update-toast');
    if (!toast) return;

    toast.classList.add('show');
    console.log('[SW] Update toast shown');

    /* ── Reload button: send SKIP_WAITING to the waiting SW ────────
       1. waiting SW receives message → calls self.skipWaiting()
       2. waiting SW becomes active
       3. controllerchange fires in this page
       4. page reloads automatically via the listener above         */
    const reloadBtn = document.getElementById('update-reload-btn');
    if (reloadBtn && !reloadBtn.dataset.bound) {
      reloadBtn.dataset.bound = 'true';
      reloadBtn.addEventListener('click', () => {
        console.log('[SW] Reload button clicked — sending SKIP_WAITING to waiting worker');
        const waitingWorker = reg.waiting;
        if (waitingWorker) {
          waitingWorker.postMessage('SKIP_WAITING');
        } else {
          /* Fallback: just reload */
          window.location.reload();
        }
      });
    }
  }
})();

/* ── Navbar Scroll Behaviour ──────────────────── */
(function initNavbar() {
  const navbar = document.getElementById('navbar');
  if (!navbar) return;

  function onScroll() {
    navbar.classList.toggle('scrolled', window.scrollY > 60);
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

/* ── Mobile Bottom Nav Active State ──────────── */
(function initBottomNav() {
  const sections = document.querySelectorAll('section[id]');
  const navItems = document.querySelectorAll('.mobile-nav-item');
  if (!sections.length || !navItems.length) return;

  const obs = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const id = entry.target.id;
        navItems.forEach(item => {
          item.classList.toggle('active', item.getAttribute('href') === `#${id}`);
        });
      }
    });
  }, { threshold: 0.4 });

  sections.forEach(s => obs.observe(s));
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
