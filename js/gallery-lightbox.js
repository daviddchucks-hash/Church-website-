/**
 * Gallery Lightbox
 * Opens a fullscreen preview when a gallery item is tapped.
 * Provides swipe navigation and a direct download button.
 */

export function initGalleryLightbox() {
  const lightbox   = document.getElementById('gallery-lightbox');
  const backdrop   = document.getElementById('gallery-lb-backdrop');
  const img        = document.getElementById('gallery-lb-img');
  const caption    = document.getElementById('gallery-lb-caption');
  const closeBtn   = document.getElementById('gallery-lb-close');
  const prevBtn    = document.getElementById('gallery-lb-prev');
  const nextBtn    = document.getElementById('gallery-lb-next');
  const dlBtn      = document.getElementById('gallery-lb-download');
  const counter    = document.getElementById('gallery-lb-counter');

  if (!lightbox) return;

  let items   = [];   // { src, caption } array built from current page
  let current = 0;    // index of open photo

  /* ── Build / refresh the item list from .gallery-item buttons ── */
  function buildItems() {
    items = Array.from(document.querySelectorAll('.gallery-item[data-src]')).map(el => ({
      src:     el.dataset.src,
      caption: el.dataset.caption || '',
    }));
  }

  /* ── Show lightbox at index i ── */
  function open(i) {
    buildItems();
    if (!items.length) return;
    current = ((i % items.length) + items.length) % items.length;

    img.src        = '';                     // reset so spinner shows on slow connections
    img.src        = items[current].src;
    img.alt        = items[current].caption;
    caption.textContent = items[current].caption;
    counter.textContent = `${current + 1} / ${items.length}`;

    // Show / hide nav arrows
    prevBtn.style.display = items.length > 1 ? '' : 'none';
    nextBtn.style.display = items.length > 1 ? '' : 'none';

    lightbox.setAttribute('aria-hidden', 'false');
    lightbox.classList.add('lb-visible');
    document.body.style.overflow = 'hidden';
    closeBtn.focus();
  }

  /* ── Close lightbox ── */
  function close() {
    lightbox.classList.remove('lb-visible');
    lightbox.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    img.src = '';
  }

  /* ── Navigate ── */
  function prev() { open(current - 1); }
  function next() { open(current + 1); }

  /* ── Download the current photo ── */
  async function download() {
    const { src, caption: cap } = items[current];
    dlBtn.disabled = true;
    dlBtn.textContent = 'Saving…';

    try {
      const res   = await fetch(src);
      const blob  = await res.blob();
      const url   = URL.createObjectURL(blob);
      const a     = document.createElement('a');
      const ext   = src.split('.').pop() || 'webp';
      a.href      = url;
      a.download  = `jesus-embassy-${cap.toLowerCase().replace(/\s+/g, '-')}.${ext}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (err) {
      console.warn('Gallery download failed:', err);
      // Fallback: open image in same tab so user can long-press save
      window.open(items[current].src, '_self');
    } finally {
      dlBtn.disabled = false;
      dlBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"
        stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
        <polyline points="7 10 12 15 17 10"/>
        <line x1="12" y1="15" x2="12" y2="3"/>
      </svg> Download`;
    }
  }

  /* ── Touch / swipe support ── */
  let touchStartX = null;
  lightbox.addEventListener('touchstart', e => {
    touchStartX = e.touches[0].clientX;
  }, { passive: true });
  lightbox.addEventListener('touchend', e => {
    if (touchStartX === null) return;
    const dx = e.changedTouches[0].clientX - touchStartX;
    touchStartX = null;
    if (Math.abs(dx) < 50) return;   // not a real swipe
    dx < 0 ? next() : prev();
  }, { passive: true });

  /* ── Keyboard ── */
  document.addEventListener('keydown', e => {
    if (!lightbox.classList.contains('lb-visible')) return;
    if (e.key === 'Escape')      close();
    if (e.key === 'ArrowLeft')   prev();
    if (e.key === 'ArrowRight')  next();
  });

  /* ── Wire up controls ── */
  closeBtn.addEventListener('click', close);
  backdrop.addEventListener('click', close);
  prevBtn.addEventListener('click', prev);
  nextBtn.addEventListener('click', next);
  dlBtn.addEventListener('click', download);

  /* ── Wire up gallery items (delegate from grid, works after SPA nav) ── */
  document.addEventListener('click', e => {
    const item = e.target.closest('.gallery-item[data-src]');
    if (!item) return;
    buildItems();
    const idx = items.findIndex(it => it.src === item.dataset.src);
    open(idx >= 0 ? idx : 0);
  });
}
