/* ==============================================
   APP.JS — Main Application Logic
   Jesus Embassy PWA
   -----------------------------------------------
   CHANGELOG v4 (2025-06-16):
   - Integrated app-style page router (router.js)
   - Navbar scroll behaviour now page-aware:
     transparent on Home, always dark on others
   - Replaced scroll-based bottom-nav active
     state with page-router active state
   - All Firebase / SW / install logic unchanged
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

/* ── Page Router ──────────────────────────────── */
(async function initAppRouter() {
  try {
    const { initRouter } = await import('./router.js');
    initRouter();
    console.log('[App] Router initialized');
  } catch (err) {
    console.error('[App] Router failed to initialize:', err.message);
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
