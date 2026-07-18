/* Bellum Arborem — Relics
   A reference for the Ruins & Expeditions relics. Consumes window.ROOT_RULES.relics. */
(function () {
  'use strict';

  const R = window.ROOT_RULES || window.ROOT_RELICS;
  const app = document.getElementById('app');
  const searchEl = document.getElementById('search');
  const RELICS = (R && R.relics) || [];
  let filter = '';


  if (!RELICS.length) {
    app.innerHTML = '<div class="loaderr"><b>No relics in the ruleset.</b> Make sure the R&amp;E relics have been merged into <code>data/root-rules.json</code> and rebuilt (<code>node data/build-rules.mjs</code>).</div>';
    return;
  }

  function render() {
    const list = RELICS.filter(r => !filter || r.name.toLowerCase().indexOf(filter) >= 0 ||
      (r.abilities || []).some(a => a.name.toLowerCase().indexOf(filter) >= 0));
    let h = '<div class="panel"><p class="eyebrow" style="margin:0 0 10px">Relics (' + list.length + ')</p>';
    if (!list.length) h += '<p class="muted small">No relics match “' + esc(filter) + '”.</p>';
    list.forEach(r => {
      h += '<div class="rcard"><h3>' + esc(r.name) + '</h3>' +
        '<div class="rmeta"><span class="tag">Wear ' + (r.wear != null ? r.wear : '—') + '</span>' +
        '<span class="tag">Load ' + (r.load != null ? r.load : '—') + '</span></div>';
      h += '<div class="lbl3">Abilities</div>';
      (r.abilities || []).forEach(a => {
        h += '<div class="abil"><div class="an">' + esc(a.name) + '</div><div class="ad">' + esc(a.description) + '</div></div>';
      });
      if (r.description) h += '<details class="rdet"><summary>Lore</summary><div class="rdesc">' + esc(r.description) + '</div></details>';
      h += '</div>';
    });
    h += '</div>';
    app.innerHTML = h;
  }

  searchEl.addEventListener('input', () => { filter = searchEl.value.trim().toLowerCase(); render(); });
  render();
})();
