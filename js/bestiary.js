/* Bellum Arborem — Bestiary
   Browse the Ruins & Expeditions monsters and track their harm during a
   fight. Consumes window.ROOT_RULES.monsters. */
(function () {
  'use strict';

  const R = window.ROOT_RULES;
  const app = document.getElementById('app');
  const searchEl = document.getElementById('search');
  const STORE_KEY = 'bellum-arborem.bestiary.wip';
  const MONSTERS = (R && R.monsters) || [];
  const TRACK_ORDER = ['injury', 'exhaustion', 'wear', 'morale'];

  let instances = [];
  let filter = '';
  let nextId = 1;

  function save() { try { localStorage.setItem(STORE_KEY, JSON.stringify({ instances, nextId })); } catch (e) {} }
  function monster(name) { return MONSTERS.find(m => m.name === name); }
  function statblockOf(inst) { const m = monster(inst.monster); if (!m) return null; return (m.statblocks || []).find(s => (s.variant || null) === (inst.variant || null)) || m.statblocks[0]; }

  if (!MONSTERS.length) {
    app.innerHTML = '<div class="loaderr"><b>No monsters in the ruleset.</b> Make sure the R&amp;E bestiary has been merged into <code>data/root-rules.json</code> and rebuilt (<code>node data/build-rules.mjs</code>).</div>';
    return;
  }

  // ---------- combat tracker ----------
  function addInstance(name, variant) {
    const m = monster(name); if (!m) return;
    const v = variant != null ? variant : (m.statblocks[0].variant || null);
    const n = instances.filter(x => x.monster === name).length + 1;
    instances.push({ id: nextId++, monster: name, variant: v, label: m.name + (m.statblocks.length > 1 || n > 1 ? ' ' + n : ''), marked: {} });
    save(); render();
  }
  function trackerPanel() {
    let h = '<div class="panel"><p class="eyebrow" style="margin:0 0 10px">Combat tracker</p>';
    if (!instances.length) { h += '<p class="muted small" style="margin:0">No monsters in play. Tap <b>Track</b> on a beast below to bring it into a fight and mark its harm here.</p></div>'; return h; }
    h += '<div class="tracker">';
    instances.forEach(inst => {
      const m = monster(inst.monster), sb = statblockOf(inst);
      h += '<div class="inst"><div class="ihead">' +
        '<input type="text" class="ilabel" data-ilabel="' + inst.id + '" value="' + esc(inst.label) + '">';
      if (m.statblocks.length > 1) {
        h += '<select data-ivar="' + inst.id + '">' + m.statblocks.map(s => '<option value="' + esc(s.variant || '') + '"' + ((s.variant || null) === (inst.variant || null) ? ' selected' : '') + '>' + esc(s.variant || 'Default') + '</option>').join('') + '</select>';
      }
      h += '<span class="muted small" style="margin-left:auto">' + esc((sb && sb.harmInflicted) || m.harmInflicted || '') + '</span>' +
        '<button class="rm" data-irm="' + inst.id + '" title="Remove" aria-label="Remove from the tracker">✕</button></div>';
      // tracks — standard ones first (in TRACK_ORDER), then any others (e.g. "Swarm Track")
      const tracks = ((sb && sb.tracks) || []).slice().sort((a, b) => {
        const ai = TRACK_ORDER.indexOf(a.track), bi = TRACK_ORDER.indexOf(b.track);
        return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
      });
      tracks.forEach(t => {
        const tn = t.track, v = inst.marked[tn] || 0;
        const onCls = TRACK_ORDER.indexOf(tn) >= 0 ? 'on-' + tn : 'on-other';
        let boxes = '';
        for (let i = 0; i < t.size; i++) boxes += '<div class="box ' + (i < v ? onCls : '') + '" data-box="' + inst.id + '|' + tn + '|' + i + '"></div>';
        h += '<div class="trk"><div class="tl"><span class="tn">' + esc(tn) + '</span><span class="tc">' + v + '/' + t.size + '</span></div><div class="boxes">' + boxes + '</div></div>';
      });
      // quick reference
      h += '<details class="mdet"><summary>instinct · traits · moves</summary>' + refBlock(m) + '</details>';
      h += '</div>';
    });
    h += '</div></div>';
    return h;
  }

  function refBlock(m) {
    let h = '';
    if (m.instinct) h += '<p style="margin:2px 0"><span class="lbl3" style="margin:0 6px 0 0;display:inline">Instinct</span><b>' + esc(m.instinct.name) + '</b> — <span class="muted">' + esc(m.instinct.description) + '</span></p>';
    if (m.traits && m.traits.length) { h += '<div class="lbl3">Traits</div>' + m.traits.map(t => '<div class="trait"><b>' + esc(t.name) + '</b> — ' + esc(t.description) + '</div>').join(''); }
    if (m.moves && m.moves.length) { h += '<div class="lbl3">Moves</div><ul class="mmoves">' + m.moves.map(mv => '<li>' + esc(mv) + '</li>').join('') + '</ul>'; }
    return h;
  }

  // ---------- bestiary reference ----------
  function bestiaryPanel() {
    const list = MONSTERS.filter(m => !filter || m.name.toLowerCase().indexOf(filter) >= 0);
    let h = '<div class="panel"><p class="eyebrow" style="margin:0 0 10px">Bestiary (' + list.length + ')</p>';
    if (!list.length) h += '<p class="muted small">No beasts match “' + esc(filter) + '”.</p>';
    list.forEach(m => {
      h += '<div class="mcard"><h3>' + esc(m.name) + '</h3><p class="harm">Inflicts ' + esc(m.harmInflicted || '—') + '</p>';
      (m.statblocks || []).forEach(sb => {
        h += '<div class="sb">' + (sb.variant ? '<div class="sbv">' + esc(sb.variant) + (sb.harmInflicted ? ' — ' + esc(sb.harmInflicted) : '') + '</div>' : '') +
          '<div class="sbt">' + (sb.tracks || []).map(t => esc(t.track) + ' ' + t.size).join(' · ') + '</div></div>';
      });
      h += refBlock(m);
      if (m.description) h += '<details class="mdet"><summary>Lore &amp; GM advice</summary><div class="mdesc">' + esc(m.description) + '</div></details>';
      h += '<div style="margin-top:10px"><button class="btn small" data-track="' + esc(m.name) + '">+ Track this monster</button></div>';
      h += '</div>';
    });
    h += '</div>';
    return h;
  }

  // ---------- render ----------
  function render() {
    app.innerHTML = trackerPanel() + bestiaryPanel();
    wire();
    save();
  }
  function wire() {
    app.querySelectorAll('[data-track]').forEach(el => el.addEventListener('click', () => addInstance(el.getAttribute('data-track'))));
    app.querySelectorAll('[data-irm]').forEach(el => el.addEventListener('click', () => { const id = +el.getAttribute('data-irm'); instances = instances.filter(x => x.id !== id); render(); }));
    app.querySelectorAll('[data-ilabel]').forEach(el => el.addEventListener('input', () => { const inst = instances.find(x => x.id === +el.getAttribute('data-ilabel')); if (inst) { inst.label = el.value; save(); } }));
    app.querySelectorAll('[data-ivar]').forEach(el => el.addEventListener('change', () => { const inst = instances.find(x => x.id === +el.getAttribute('data-ivar')); if (inst) { inst.variant = el.value || null; inst.marked = {}; render(); } }));
    app.querySelectorAll('[data-box]').forEach(el => el.addEventListener('click', () => {
      const [id, tn, i] = el.getAttribute('data-box').split('|');
      const inst = instances.find(x => x.id === +id); if (!inst) return;
      const idx = +i, cur = inst.marked[tn] || 0;
      inst.marked[tn] = (cur === idx + 1) ? idx : idx + 1;
      render();
    }));
  }

  searchEl.addEventListener('input', () => { filter = searchEl.value.trim().toLowerCase(); render(); });

  // ---------- boot ----------
  (function boot() {
    try { const wip = localStorage.getItem(STORE_KEY); if (wip) { const d = JSON.parse(wip); if (d && Array.isArray(d.instances)) { instances = d.instances.filter(x => monster(x.monster)); nextId = d.nextId || (instances.reduce((m, x) => Math.max(m, x.id), 0) + 1); } } } catch (e) {}
    render();
  })();
})();
