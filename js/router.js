/* ==============================================
   ROUTER.JS — App-Style Page Router
   Jesus Embassy PWA
   -----------------------------------------------
   Hash-based SPA router. Each page section is
   wrapped in a .page div with id="page-{name}".
   Navigation changes the URL hash; hashchange
   event fires and showPage() displays the target.

   Supports:
   - Browser back/forward buttons
   - Page-enter animations
   - Navbar state per page
   - Scroll-reveal re-triggering on page show
============================================== */

const PAGES = ['home', 'about', 'services', 'news', 'sermons', 'give', 'gallery', 'contact', 'settings', 'login', 'register', 'profile'];
const DEFAULT_PAGE = 'home';

/* Legacy section hash aliases → page names */
const ALIASES = {
  'hero':   'home',
  'events': 'services',
  '':       'home',
};

const PAGE_TITLES = {
  home:     'Jesus Embassy – RCCG',
  about:    'About Us | Jesus Embassy',
  services: 'Services & Events | Jesus Embassy',
  news:     'Church News | Jesus Embassy',
  sermons:  'Sermons | Jesus Embassy',
  give:     'Give | Jesus Embassy',
  gallery:  'Gallery | Jesus Embassy',
  contact:  'Contact Us | Jesus Embassy',
  settings: 'Settings | Jesus Embassy',
  login:    'Sign In | Jesus Embassy',
  register: 'Create Account | Jesus Embassy',
  profile:  'My Profile | Jesus Embassy',
};

let currentPage = null;
let _pageChangeCallbacks = [];

/* ── Resolve hash string → valid page id ──────── */
function hashToPage(hash) {
  const raw = (hash || '').replace(/^#/, '').toLowerCase().trim();
  if (ALIASES[raw] !== undefined) return ALIASES[raw];
  return PAGES.includes(raw) ? raw : DEFAULT_PAGE;
}

/* ── Reveal elements currently in viewport ──────── */
function triggerRevealInPage(pageEl) {
  if (!pageEl) return;
  const vh = window.innerHeight;
  pageEl.querySelectorAll('.reveal:not(.visible), .reveal-left:not(.visible), .reveal-right:not(.visible)').forEach(el => {
    const rect = el.getBoundingClientRect();
    if (rect.top < vh * 0.9) {
      el.classList.add('visible');
    }
  });
}

/* ── Update navbar for current page ─────────────── */
function updateNavbar(pageId) {
  const navbar = document.getElementById('navbar');
  if (!navbar) return;

  if (pageId === 'home') {
    /* Home: transparent until scrolled */
    navbar.classList.toggle('scrolled', window.scrollY > 60);
  } else {
    /* All other pages: always show dark navbar */
    navbar.classList.add('scrolled');
  }
}

/* ── Register a page-change callback ─────────────── */
export function onPageChange(cb) {
  if (typeof cb === 'function') _pageChangeCallbacks.push(cb);
}

/* ── Update nav active indicators ───────────────── */
function updateNavActive(pageId) {
  /* Top desktop nav and hamburger nav */
  document.querySelectorAll('[data-page]').forEach(el => {
    el.classList.toggle('nav-active', el.dataset.page === pageId);
    if (el.tagName === 'A' || el.tagName === 'BUTTON') {
      el.setAttribute('aria-current', el.dataset.page === pageId ? 'page' : 'false');
    }
  });

  /* Bottom nav <a> items (skip the More button — it has no href) */
  document.querySelectorAll('.mobile-nav-item[href]').forEach(item => {
    const target = hashToPage(item.getAttribute('href') || '');
    item.classList.toggle('active', target === pageId);
    item.setAttribute('aria-current', target === pageId ? 'page' : 'false');
  });

  /* Fire registered callbacks (e.g. More Tray) */
  _pageChangeCallbacks.forEach(cb => cb(pageId));
}

/* ── Show page ───────────────────────────────────── */
function showPage(pageId, skipAnimation) {
  if (currentPage === pageId) return;
  currentPage = pageId;

  /* Hide all pages */
  PAGES.forEach(id => {
    const el = document.getElementById(`page-${id}`);
    if (!el) return;
    el.style.display = 'none';
    el.classList.remove('page-active');
    el.setAttribute('aria-hidden', 'true');
  });

  /* Show target page */
  const nextEl = document.getElementById(`page-${pageId}`);
  if (nextEl) {
    nextEl.style.display = 'block';
    nextEl.setAttribute('aria-hidden', 'false');

    if (skipAnimation) {
      nextEl.classList.add('page-active');
    } else {
      /* Two-frame trick: let display:block paint before adding transition class */
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          nextEl.classList.add('page-active');
        });
      });
    }

    /* Scroll window to top of new page */
    window.scrollTo({ top: 0, behavior: 'instant' });

    /* Re-trigger reveals after animation starts */
    setTimeout(() => triggerRevealInPage(nextEl), 80);
  }

  /* Update UI chrome */
  updateNavActive(pageId);
  updateNavbar(pageId);

  /* Update document title */
  document.title = PAGE_TITLES[pageId] || 'Jesus Embassy – RCCG';

  console.log('[Router] Navigated to page:', pageId);
}

/* ── Public navigate API ─────────────────────────── */
export function navigateTo(pageId) {
  if (!PAGES.includes(pageId)) pageId = DEFAULT_PAGE;
  /* Push state so back button works */
  history.pushState({ page: pageId }, '', `#${pageId}`);
  showPage(pageId);
}

/* ── Close mobile hamburger menu ─────────────────── */
function closeMobileMenu() {
  const navMobile = document.getElementById('nav-mobile');
  const toggle    = document.getElementById('nav-toggle');
  if (navMobile) navMobile.classList.remove('open');
  if (toggle)    { toggle.classList.remove('open'); toggle.setAttribute('aria-expanded', 'false'); }
}

/* ── Initialize router ───────────────────────────── */
export function initRouter() {
  /* Determine starting page from URL hash */
  const initial = hashToPage(window.location.hash);

  /* Show initial page without animation */
  showPage(initial, true);

  /* hashchange fires when user clicks a regular <a href="#..."> link */
  window.addEventListener('hashchange', () => {
    showPage(hashToPage(window.location.hash));
  });

  /* popstate fires on browser back/forward */
  window.addEventListener('popstate', e => {
    const pageId = (e.state && e.state.page) || hashToPage(window.location.hash);
    showPage(pageId);
  });

  /* Intercept clicks on elements with data-page attribute */
  document.addEventListener('click', e => {
    const el = e.target.closest('[data-page]');
    if (!el) return;
    e.preventDefault();
    navigateTo(el.dataset.page);
    closeMobileMenu();
  });

  /* Keep navbar state correct on window scroll (home page) */
  window.addEventListener('scroll', () => {
    if (currentPage === 'home') updateNavbar('home');
  }, { passive: true });

  console.log('[Router] Initialized. Starting page:', initial);
}
