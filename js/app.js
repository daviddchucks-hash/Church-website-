/* ==============================================
   APP.JS — Main Application Logic
   Jesus Embassy PWA
============================================== */

/* ── Splash Screen ────────────────────────── */
(function initSplash() {
  const splash  = document.getElementById('splash-screen');
  if (!splash) return;
  const MIN_MS  = 2400;
  const start   = Date.now();

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
    window.addEventListener('load', hideSplash);
  }
})();

/* ── Service Worker Registration ─────────── */
(function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/Church-website-/service-worker.js', {
      scope: '/Church-website-/'
    }).then(reg => {
      console.log('[SW] Registered, scope:', reg.scope);

      reg.addEventListener('updatefound', () => {
        const newWorker = reg.installing;
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            const toast = document.getElementById('update-toast');
            if (toast) toast.classList.add('show');
          }
        });
      });
    }).catch(err => console.warn('[SW] Registration failed:', err));
  });
})();

/* ── Navbar Scroll Behaviour ──────────────── */
(function initNavbar() {
  const navbar = document.getElementById('navbar');
  if (!navbar) return;

  function onScroll() {
    navbar.classList.toggle('scrolled', window.scrollY > 60);
  }

  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll(); /* Run once on load */
})();

/* ── Mobile Menu Toggle ──────────────────── */
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

/* ── Hero Slider ──────────────────────────── */
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

/* ── Scroll Reveal ────────────────────────── */
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

/* ── Mobile Bottom Nav Active State ─────── */
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

/* ── Contact Form — Formspree ─────────────── */
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

/* ── Firebase Notifications (async init) ── */
(async function initFirebaseNotifications() {
  try {
    const { initNotifications } = await import('./notifications.js');
    await initNotifications();
  } catch (err) {
    console.warn('[Notifications] Could not initialize FCM:', err.message);
  }
})();
