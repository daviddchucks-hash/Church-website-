/* ==============================================
   INSTALL.JS — PWA Install Prompt Handler
   Jesus Embassy PWA
============================================== */

let deferredPrompt = null;

const installBanner    = document.getElementById('install-banner');
const installBtnMain   = document.getElementById('install-btn-main');
const navInstallBtn    = document.getElementById('nav-install-btn');
const mobileInstallBtn = document.getElementById('nav-mobile-install-btn');
const bannerClose      = document.getElementById('install-banner-close');

/* ── Already Installed Detection ─────────── */
const isStandaloneMode =
  window.matchMedia('(display-mode: standalone)').matches ||
  window.navigator.standalone === true ||
  document.referrer.includes('android-app://');

const alreadyInstalled =
  localStorage.getItem('pwa-installed') === 'true' || isStandaloneMode;

let bannerAutoHideTimer = null;

/* ── Show Install UI ──────────────────────── */
function showInstallUI() {
  if (alreadyInstalled || localStorage.getItem('pwa-installed') === 'true') return;

  if (installBanner)    installBanner.classList.add('show');
  if (navInstallBtn)    navInstallBtn.classList.add('visible');
  if (mobileInstallBtn) mobileInstallBtn.classList.add('visible');

  /* Auto-hide bottom banner after 9 seconds — nav button stays */
  bannerAutoHideTimer = setTimeout(() => {
    if (installBanner) installBanner.classList.remove('show');
  }, 9000);
}

/* ── Hide All Install UI ──────────────────── */
function hideAllInstallUI() {
  clearTimeout(bannerAutoHideTimer);
  if (installBanner)    installBanner.classList.remove('show');
  if (navInstallBtn)    navInstallBtn.classList.remove('visible');
  if (mobileInstallBtn) mobileInstallBtn.classList.remove('visible');
}

/* ── Mark as Installed ───────────────────── */
function markInstalled() {
  localStorage.setItem('pwa-installed', 'true');
  hideAllInstallUI();
  console.log('[PWA] App marked as installed');
}

/* ── Trigger Install Prompt ──────────────── */
async function triggerInstall() {
  if (!deferredPrompt) {
    console.warn('[PWA] No deferred prompt available');
    return;
  }

  try {
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    console.log('[PWA] Install outcome:', outcome);
    deferredPrompt = null;

    if (outcome === 'accepted') {
      markInstalled();
    } else {
      /* User declined — hide banner, keep nav button available */
      if (installBanner) installBanner.classList.remove('show');
    }
  } catch (err) {
    console.error('[PWA] Install prompt error:', err);
  }
}

/* ── Event Listeners ─────────────────────── */

/* Browser fires this when the app becomes installable */
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();

  if (alreadyInstalled || localStorage.getItem('pwa-installed') === 'true') return;

  deferredPrompt = e;
  /* Delay so user can see the page content first */
  setTimeout(showInstallUI, 3500);
});

/* Fires after successful install from any method */
window.addEventListener('appinstalled', () => {
  console.log('[PWA] App installed successfully');
  deferredPrompt = null;
  markInstalled();
});

/* Install button clicks */
if (installBtnMain)   installBtnMain.addEventListener('click', triggerInstall);
if (navInstallBtn)    navInstallBtn.addEventListener('click', triggerInstall);
if (mobileInstallBtn) mobileInstallBtn.addEventListener('click', triggerInstall);

/* Dismiss banner (X button) — only hides the banner, nav button stays */
if (bannerClose) {
  bannerClose.addEventListener('click', () => {
    clearTimeout(bannerAutoHideTimer);
    if (installBanner) installBanner.classList.remove('show');
  });
}

/* If already in standalone/installed mode, hide everything */
if (alreadyInstalled) {
  hideAllInstallUI();
}
