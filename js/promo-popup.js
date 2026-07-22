/* ==============================================
   PROMO-POPUP.JS — Church Programme Advertisement
   Jesus Embassy PWA
   -----------------------------------------------
   - Appears 3 seconds after the app opens
   - Auto-dismisses after 20 seconds if untouched
   - "Learn More" → navigates to the News page
   - "Explore" / × → dismisses immediately
   - Countdown progress bar shows remaining time
   - One popup per session (sessionStorage flag)
============================================== */

const SHOW_DELAY_MS  = 3000;   /* 3 seconds after load  */
const AUTO_CLOSE_MS  = 20000;  /* 20 second auto-close  */
const SESSION_KEY    = 'je_promo_shown';

export function initPromoPopup() {
  /* Only show once per session */
  if (sessionStorage.getItem(SESSION_KEY)) return;

  setTimeout(showPopup, SHOW_DELAY_MS);
}

function showPopup() {
  /* Mark shown for this session */
  sessionStorage.setItem(SESSION_KEY, '1');

  const overlay = document.getElementById('promo-overlay');
  const modal   = document.getElementById('promo-modal');
  if (!overlay || !modal) return;

  /* Show */
  overlay.classList.add('promo-visible');

  /* Prevent body scroll while popup is open */
  document.body.style.overflow = 'hidden';

  /* ── Countdown progress bar ── */
  const bar = document.getElementById('promo-progress-bar');
  if (bar) {
    bar.style.transition = `width ${AUTO_CLOSE_MS}ms linear`;
    /* Force reflow so the transition fires from 100% → 0% */
    bar.getBoundingClientRect();
    bar.style.width = '0%';
  }

  /* ── Countdown number ── */
  let secondsLeft = Math.round(AUTO_CLOSE_MS / 1000);
  const countEl   = document.getElementById('promo-countdown');
  if (countEl) countEl.textContent = secondsLeft;

  const countInterval = setInterval(() => {
    secondsLeft -= 1;
    if (countEl) countEl.textContent = Math.max(0, secondsLeft);
  }, 1000);

  /* ── Auto-close timer ── */
  const autoTimer = setTimeout(() => dismiss(true), AUTO_CLOSE_MS);

  /* ── Close helpers ── */
  function dismiss(auto = false) {
    clearTimeout(autoTimer);
    clearInterval(countInterval);
    document.body.style.overflow = '';
    overlay.classList.remove('promo-visible');
    overlay.addEventListener('transitionend', () => overlay.remove(), { once: true });
    if (!auto) console.log('[Promo] Dismissed by user');
  }

  /* ── Bind buttons ── */
  document.getElementById('promo-close-btn')?.addEventListener('click', () => dismiss());
  document.getElementById('promo-dismiss-btn')?.addEventListener('click', () => dismiss());

  document.getElementById('promo-learn-btn')?.addEventListener('click', () => {
    dismiss();
    /* Navigate to News section via router */
    import('./router.js').then(({ navigateTo }) => navigateTo('news')).catch(() => {
      window.location.hash = '#news';
    });
  });

  /* Tap backdrop to close */
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) dismiss();
  });
}
