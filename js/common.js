/* Bellum Arborem — shared helpers + accessibility layer.
   Loaded before each page's own script. Exposes window.BA and a few globals
   (esc/d6/r2d6/fmt/toast) so per-page scripts can share one implementation. */
(function () {
  'use strict';

  // ---------- pure helpers ----------
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function d6() { return Math.floor(Math.random() * 6) + 1; }
  function r2d6() { return d6() + d6(); }
  function fmt(n) { return (n > 0 ? '+' : '') + n; }

  // ---------- toast (single implementation; needs a #toast element on the page) ----------
  let toastTimer = null;
  function toast(msg) {
    const t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2300);
  }

  // ---------- JSON download / read ----------
  function downloadJSON(filename, obj) {
    const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  }
  function readJSONFile(file, onData, onErr) {
    const rd = new FileReader();
    rd.onload = () => { try { onData(JSON.parse(rd.result)); } catch (e) { if (onErr) onErr(e); } };
    rd.readAsText(file);
  }

  // ---------- keyboard accessibility ----------
  // The app renders many selectable controls as <div>/<span> with click handlers.
  // Make them focusable and Enter/Space-activatable, and reflect toggle state via aria-pressed.
  // (The interactive SVG woodland map is intentionally excluded — it needs its own pointer model.)
  const A11Y_SEL = '.pick,.card.selectable,.stat.selectable,.statpick,.hbox,.box';
  function decorate(el) {
    if (!el.matches || !el.matches(A11Y_SEL)) return;
    const tag = el.tagName;
    if (tag === 'BUTTON' || tag === 'A' || tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '0');
    if (!el.hasAttribute('role')) el.setAttribute('role', 'button');
    const on = el.classList.contains('selected') || el.classList.contains('on');
    el.setAttribute('aria-pressed', on ? 'true' : 'false');
  }
  function scan(node) {
    if (!node || node.nodeType !== 1) return;
    decorate(node);
    if (node.querySelectorAll) node.querySelectorAll(A11Y_SEL).forEach(decorate);
  }
  function initA11y() {
    scan(document.body);
    const mo = new MutationObserver(muts => {
      muts.forEach(m => m.addedNodes && m.addedNodes.forEach(scan));
    });
    mo.observe(document.body, { childList: true, subtree: true });
    // Enter / Space activates a focused custom button.
    document.addEventListener('keydown', e => {
      if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
      const el = e.target;
      if (el && el.getAttribute && el.getAttribute('role') === 'button' &&
          el.tagName !== 'BUTTON' && el.tagName !== 'A') {
        e.preventDefault();
        el.click();
      }
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initA11y);
  else initA11y();

  // ---------- exports ----------
  window.BA = { esc, d6, r2d6, fmt, toast, downloadJSON, readJSONFile };
  // Convenience globals (per-page scripts may still define their own locals, which shadow these).
  window.esc = esc; window.d6 = d6; window.r2d6 = r2d6; window.fmt = fmt; window.toast = toast;
})();
