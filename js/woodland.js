/* Bellum Arborem — Woodland Creator
   Roll-only "Making the Woodland": you draw the map, this rolls the tables
   step-by-step, clearing-by-clearing, with a reroll at every step.
   Consumes window.ROOT_WOODLAND (data/woodland-rules.js). */
(function () {
  'use strict';

  const W = window.ROOT_WOODLAND;
  const bodyEl = document.getElementById('stepBody');
  const stepsEl = document.getElementById('steps');
  const backBtn = document.getElementById('backBtn');
  const nextBtn = document.getElementById('nextBtn');
  const exportBtn = document.getElementById('exportBtn');
  const importBtn = document.getElementById('importBtn');
  const importFile = document.getElementById('importFile');
  const STORE_KEY = 'bellum-arborem.woodland.wip';

  if (!W || !W.tables || !W.tables.dominantCommunity) {
    bodyEl.innerHTML = '<div class="loaderr"><b>Woodland ruleset failed to load.</b> Make sure ' +
      '<code>data/woodland-rules.js</code> exists (run <code>node data/build-rules.mjs</code>).</div>';
    document.querySelector('.navbtns').classList.add('hidden');
    return;
  }

  const DENIZEN = 'Denizens';
  const UNCONTROLLED = 'Uncontrolled';

  // ---------- Dice ----------
  function fromRanges(ranges, v) {
    for (const r of ranges) if (v >= r.min && v <= r.max) return r;
    return null;
  }
  function rollRange(tbl) { const v = tbl.die === '1d6' ? d6() : r2d6(); const r = fromRanges(tbl.ranges, v); return { v, result: r ? r.result : null, row: r }; }
  function rollGrid(tbl) { const row = d6(), col = d6(); return { row, col, result: tbl.grid[row - 1][col - 1] }; }
  function rollName() {
    const t = W.tables.clearingName;
    const rowDie = d6(), colDie = d6();
    const ci = colDie <= 2 ? 0 : colDie <= 4 ? 1 : 2;
    return { rowDie, colDie, ci, name: t.rows[rowDie - 1][ci] };
  }
  function swapName(nd) {
    const t = W.tables.clearingName;
    const ci = nd.rowDie <= 2 ? 0 : nd.rowDie <= 4 ? 1 : 2;
    return { rowDie: nd.colDie, colDie: nd.rowDie, ci, name: t.rows[nd.colDie - 1][ci] };
  }

  // ---------- State ----------
  function fresh() {
    return {
      _format: 'bellum-arborem.woodland', _version: 1, _app: 'Bellum Arborem',
      factions: ['The Marquisate', 'The Eyrie Dynasties', 'The Woodland Alliance'],
      corner: {},
      clearings: [],
      edges: [],                // [idLow, idHigh] pairs — the drawn paths
      draft: null,
      uprisingDone: false,
      lizardOutcast: null,      // the outcast denizen community (Lizard Cult setup)
      notes: ''
    };
  }
  let state = fresh();
  let stepIdx = 0;
  let connectSel = null; // clearing id currently selected for drawing a path

  function newClearing(id, community, paths, name, pos) {
    return {
      id, name, community, paths,
      x: pos ? pos.x : null, y: pos ? pos.y : null,
      control: null,            // faction name, DENIZEN, UNCONTROLLED, or null (unrolled = denizen-held)
      stronghold: false, roost: false, base: false,
      sympathy: false, contested: false,
      distMarq: '', distRoost: '',   // manual override for faction distance (blank = auto from map)
      allianceState: null,
      presence: [],             // faction names with presence (Lizard / Riverfolk / Corvid / Keepers / Hundreds)
      structures: [],           // garden, trading post, tunnel, market, citadel, plot, Mob, Waystation, Warriors, …
      onWater: false,           // sits on a river or lake (Riverfolk criterion)
      ruin: false,              // a ruin sits at or near this clearing (R&E)
      hoard: 0,                 // Hundreds hoard Value here (0 = none)
      war: null, warFactions: '',
      inhabitants: [], buildings: [], problems: [],
      _roll: {}
    };
  }

  // ---------- Map geometry / graph ----------
  const VB_W = 1000, VB_H = 640, NODE_R = 34;
  function seedPos(index) {
    // loose 4-column grid the user can rearrange
    const cols = 4, cw = VB_W / cols, rh = 150, top = 90;
    const col = index % cols, row = Math.floor(index / cols);
    const jitter = ((index * 37) % 40) - 20;
    return { x: Math.round(cw * (col + 0.5) + jitter), y: Math.round(top + row * rh + (col % 2 ? 22 : 0)) };
  }
  function ensurePositions() {
    state.clearings.forEach((c, i) => { if (c.x == null || c.y == null) { const p = seedPos(i); c.x = p.x; c.y = p.y; } });
  }
  function edgeKey(a, b) { return a < b ? a + '-' + b : b + '-' + a; }
  function hasEdge(a, b) { return state.edges.some(e => edgeKey(e[0], e[1]) === edgeKey(a, b)); }
  function toggleEdge(a, b) {
    if (a === b) return;
    const k = edgeKey(a, b), i = state.edges.findIndex(e => edgeKey(e[0], e[1]) === k);
    if (i >= 0) state.edges.splice(i, 1); else state.edges.push(a < b ? [a, b] : [b, a]);
  }
  function degree(id) { return state.edges.filter(e => e[0] === id || e[1] === id).length; }
  function neighborIds(id) { return state.edges.filter(e => e[0] === id || e[1] === id).map(e => e[0] === id ? e[1] : e[0]); }
  function clearingById(id) { return state.clearings.find(c => c.id === id); }
  function bfsFrom(anchorIds) {
    const dist = {}; const q = [];
    anchorIds.forEach(id => { if (dist[id] == null) { dist[id] = 0; q.push(id); } });
    while (q.length) { const cur = q.shift(); neighborIds(cur).forEach(nb => { if (dist[nb] == null) { dist[nb] = dist[cur] + 1; q.push(nb); } }); }
    return dist;
  }
  function graphConnected() {
    if (state.clearings.length < 2) return true;
    const d = bfsFrom([state.clearings[0].id]);
    return state.clearings.every(c => d[c.id] != null);
  }

  // ---------- SVG map ----------
  const COMMUNITY_COLOR = {
    Rabbit: { fill: '#d3e2ba', stroke: '#5f7a3f' },
    Mouse: { fill: '#e4d9bf', stroke: '#8a7657' },
    Fox: { fill: '#eecaa4', stroke: '#b5623a' }
  };
  const COMMUNITY_ICON = { Rabbit: '🐰', Mouse: '🐭', Fox: '🦊' };
  const CONTROL_COLOR = {
    'The Marquisate': '#e08a4a', 'The Eyrie Dynasties': '#4a8ec2', 'The Woodland Alliance': '#68a054',
    'The Lizard Cult': '#c46a8f', 'The Riverfolk Company': '#3fb0a4', 'The Grand Duchy': '#9a7bd0',
    'The Corvid Conspiracy': '#555b63', 'The Hundreds': '#b5462f', 'The Keepers in Iron': '#7d7a6a'
  };
  function controlColor(c) {
    if (c.control && CONTROL_COLOR[c.control]) return CONTROL_COLOR[c.control];
    if (c.control === UNCONTROLLED) return '#cdbf9f';
    return '#b3a07a'; // denizen-held / unrolled
  }
  const STRUCT_GLYPH = { 'Garden': '❀', 'Trading post': '⚑', 'Tunnel': '◎', 'Market': '$', 'Citadel': '▣', 'Plot': '✦', 'Mob': '‡', 'Waystation': '⌘', 'Warriors': '⚔', 'Sawmill': '⚒', 'Workshop': '⚒', 'Recruiting post': '⚒' };
  function controlMarks(c) {
    const m = [];
    if (c.ruin) m.push('▨');
    if (c.stronghold) m.push('★'); if (c.roost) m.push('⌂'); if (c.base) m.push('▲');
    (c.structures || []).forEach(s => m.push(STRUCT_GLYPH[s] || '⚒'));
    if (c.hoard) m.push('◈');
    return m.length ? '<text class="mark" x="' + c.x + '" y="' + (c.y - NODE_R - 7) + '" text-anchor="middle">' + m.join(' ') + '</text>' : '';
  }
  const SYMPATHY_COLOR = '#4e9a3e';
  function sympathyDot(c) {
    if (!c.sympathy) return '';
    const dx = Math.round(NODE_R * 0.866), dy = Math.round(NODE_R * 0.5); // 2 o'clock on the rim
    return '<circle cx="' + (c.x + dx) + '" cy="' + (c.y - dy) + '" r="9" fill="' + SYMPATHY_COLOR + '" stroke="#2c5320" stroke-width="2"/>';
  }

  function renderMapSvg(opts) {
    opts = opts || {};
    ensurePositions();
    const byId = {}; state.clearings.forEach(c => { byId[c.id] = c; });
    const edges = state.edges.map(e => {
      const a = byId[e[0]], b = byId[e[1]]; if (!a || !b) return '';
      return '<line class="edge" data-a="' + e[0] + '" data-b="' + e[1] + '" x1="' + a.x + '" y1="' + a.y + '" x2="' + b.x + '" y2="' + b.y + '"/>';
    }).join('');
    const control = opts.colorBy === 'control';
    const nodes = state.clearings.map(c => {
      const cc = COMMUNITY_COLOR[c.community] || { fill: '#e4d9bf', stroke: '#8a7657' };
      // Fill always shows the dominant community; a thick faction-colored border shows control.
      const fill = cc.fill;
      let stroke = cc.stroke, sw = 2.5;
      if (control) {
        const cCol = (c.control && CONTROL_COLOR[c.control]) ? CONTROL_COLOR[c.control] : null;
        stroke = cCol || '#5a4a30'; sw = cCol ? 6 : 2.5;
      }
      const sel = opts.interactive && connectSel === c.id;
      const ring = sel ? '<circle class="selring" cx="' + c.x + '" cy="' + c.y + '" r="' + (NODE_R + 6) + '" fill="none" stroke-width="3" stroke-dasharray="5 4"/>' : '';
      const deg = opts.interactive ? '<text class="deg ' + (degree(c.id) >= c.paths ? 'ok' : '') + '" x="' + c.x + '" y="' + (c.y - NODE_R - 7) + '" text-anchor="middle">' + degree(c.id) + '/' + c.paths + '</text>' : '';
      const marks = control ? controlMarks(c) : '';
      const symp = control ? sympathyDot(c) : '';
      return '<g class="node" data-node="' + c.id + '">' + ring +
        '<circle cx="' + c.x + '" cy="' + c.y + '" r="' + NODE_R + '" fill="' + fill + '" stroke="' + stroke + '" stroke-width="' + sw + '"/>' +
        '<text class="ico" x="' + c.x + '" y="' + (c.y + 1) + '" text-anchor="middle" dominant-baseline="central">' + (COMMUNITY_ICON[c.community] || '') + '</text>' +
        '<text class="nm" x="' + c.x + '" y="' + (c.y + NODE_R + 18) + '" text-anchor="middle">' + esc(c.name) + '</text>' +
        deg + marks + symp + '</g>';
    }).join('');
    return '<svg class="woodmap" viewBox="0 0 ' + VB_W + ' ' + VB_H + '" xmlns="http://www.w3.org/2000/svg">' + edges + nodes + '</svg>';
  }

  function updateNodeDom(svg, c) {
    const g = svg.querySelector('[data-node="' + c.id + '"]');
    if (!g) return;
    g.querySelectorAll('circle').forEach(ci => { ci.setAttribute('cx', c.x); ci.setAttribute('cy', c.y); });
    const ico = g.querySelector('.ico'); if (ico) { ico.setAttribute('x', c.x); ico.setAttribute('y', c.y + 1); }
    const nm = g.querySelector('.nm'); if (nm) { nm.setAttribute('x', c.x); nm.setAttribute('y', c.y + NODE_R + 18); }
    const deg = g.querySelector('.deg'); if (deg) { deg.setAttribute('x', c.x); deg.setAttribute('y', c.y - NODE_R - 7); }
    svg.querySelectorAll('line.edge').forEach(ln => {
      if (+ln.getAttribute('data-a') === c.id) { ln.setAttribute('x1', c.x); ln.setAttribute('y1', c.y); }
      if (+ln.getAttribute('data-b') === c.id) { ln.setAttribute('x2', c.x); ln.setAttribute('y2', c.y); }
    });
  }

  function wireMapSvg() {
    const svg = bodyEl.querySelector('svg.woodmap');
    if (!svg) return;
    let down = null;
    svg.addEventListener('pointerdown', e => {
      const g = e.target.closest('[data-node]');
      if (!g) { if (connectSel != null) { connectSel = null; render(); } return; }
      e.preventDefault();
      const id = +g.getAttribute('data-node'), c = clearingById(id);
      down = { id, sx: e.clientX, sy: e.clientY, ox: c.x, oy: c.y, moved: false };
      try { svg.setPointerCapture(e.pointerId); } catch (_) {}
    });
    svg.addEventListener('pointermove', e => {
      if (!down) return;
      const dx = e.clientX - down.sx, dy = e.clientY - down.sy;
      if (!down.moved && Math.hypot(dx, dy) > 4) down.moved = true;
      if (down.moved) {
        const r = svg.getBoundingClientRect();
        const c = clearingById(down.id);
        c.x = Math.max(NODE_R, Math.min(VB_W - NODE_R, down.ox + dx * (VB_W / r.width)));
        c.y = Math.max(NODE_R, Math.min(VB_H - NODE_R, down.oy + dy * (VB_H / r.height)));
        updateNodeDom(svg, c);
      }
    });
    function end(e) {
      if (!down) return;
      const d = down; down = null;
      try { svg.releasePointerCapture(e.pointerId); } catch (_) {}
      if (d.moved) { save(); return; }
      if (connectSel == null) connectSel = d.id;
      else if (connectSel === d.id) connectSel = null;
      else { toggleEdge(connectSel, d.id); connectSel = null; }
      render();
    }
    svg.addEventListener('pointerup', end);
    svg.addEventListener('pointercancel', () => { down = null; });
  }

  function save() { try { localStorage.setItem(STORE_KEY, JSON.stringify(strip())); } catch (e) {} }
  function strip() { const c = JSON.parse(JSON.stringify(state)); c.draft = null; return c; }
  function selected(key) { const f = W.coreFactions.find(x => x.key === key); return f && state.factions.indexOf(f.name) >= 0; }
  function controlledBy(faction) { return state.clearings.filter(c => c.control === faction); }
  function nonStronghold(c) { return !c.stronghold; }

  // ---------- Steps (dynamic on faction selection) ----------
  const FSEL = W.factionSelect || { min: 2, max: 3 };
  function buildSteps() {
    const s = [
      { id: 'factions', label: 'Factions', render: renderFactions, valid: () => state.factions.length >= FSEL.min && state.factions.length <= FSEL.max },
      { id: 'map', label: 'Map', render: renderMap, valid: () => state.clearings.length === W.mapSize }
    ];
    // Ruins are placed after the map, before faction control (needed for the Keepers + expeditions)
    if (selected('keepers') || anyRuin()) s.push({ id: 'ruins', label: 'Ruins', render: renderRuins, valid: () => true });
    // Setup order: Marquisate, Eyrie, Alliance, Lizard, Riverfolk, Grand Duchy, Corvid, Hundreds, Keepers, Denizens
    if (selected('marquisate')) s.push({ id: 'marquisate', label: 'Marquisate', render: renderMarquisate, valid: () => controlledBy('The Marquisate').length > 0 });
    if (selected('eyrie')) s.push({ id: 'eyrie', label: 'Eyrie', render: renderEyrie, valid: () => controlledBy('The Eyrie Dynasties').length > 0 });
    if (selected('alliance')) s.push({ id: 'alliance', label: 'Alliance', render: renderAlliance, valid: () => true });
    if (selected('lizard')) s.push({ id: 'lizard', label: 'Lizard Cult', render: renderLizard, valid: () => controlledBy('The Lizard Cult').length > 0 });
    if (selected('riverfolk')) s.push({ id: 'riverfolk', label: 'Riverfolk', render: renderRiverfolk, valid: () => controlledBy('The Riverfolk Company').length > 0 });
    if (selected('duchy')) s.push({ id: 'duchy', label: 'Grand Duchy', render: renderDuchy, valid: () => controlledBy('The Grand Duchy').length > 0 });
    if (selected('corvid')) s.push({ id: 'corvid', label: 'Corvid', render: renderCorvid, valid: () => true });
    if (selected('hundreds')) s.push({ id: 'hundreds', label: 'Hundreds', render: renderHundreds, valid: () => controlledBy('The Hundreds').length > 0 });
    if (selected('keepers')) s.push({ id: 'keepers', label: 'Keepers', render: renderKeepers, valid: () => true });
    s.push({ id: 'denizens', label: 'Denizens', render: renderDenizens, valid: () => true });
    s.push({ id: 'flesh', label: 'Flesh out', render: renderFlesh, valid: () => true });
    s.push({ id: 'review', label: 'Review', render: renderReview, valid: () => true });
    return s;
  }
  let STEPS = buildSteps();

  function renderSteps() {
    stepsEl.innerHTML = '';
    STEPS.forEach((st, i) => {
      const pip = document.createElement('button');
      pip.className = 'step-pip' + (i === stepIdx ? ' active' : '') + (i < stepIdx && st.valid() ? ' done' : '');
      pip.innerHTML = '<span class="n">' + (i + 1) + '</span>' + esc(st.label);
      pip.disabled = i > 1 && state.clearings.length !== W.mapSize;
      pip.addEventListener('click', () => goto(i));
      stepsEl.appendChild(pip);
    });
  }

  function render() {
    STEPS = buildSteps();
    if (stepIdx >= STEPS.length) stepIdx = STEPS.length - 1;
    bodyEl.innerHTML = '';
    STEPS[stepIdx].render();
    renderSteps();
    backBtn.disabled = stepIdx === 0;
    nextBtn.classList.toggle('hidden', stepIdx === STEPS.length - 1);
    exportBtn.disabled = state.clearings.length === 0;
    save();
  }
  function goto(i) {
    if (i < 0 || i >= STEPS.length) return;
    if (i > 1 && state.clearings.length !== W.mapSize) { toast('Finish the 12-clearing map first.'); return; }
    stepIdx = i; window.scrollTo({ top: 0, behavior: 'smooth' }); render();
  }
  nextBtn.addEventListener('click', () => {
    const st = STEPS[stepIdx];
    if (!st.valid()) { toast(validMsg(st)); return; }
    goto(stepIdx + 1);
  });
  backBtn.addEventListener('click', () => goto(stepIdx - 1));
  function validMsg(st) {
    switch (st.id) {
      case 'factions': return 'Choose two or three factions (Denizens are always present).';
      case 'map': return 'Roll all ' + W.mapSize + ' clearings to continue.';
      case 'marquisate': return 'Set the Marquisate stronghold clearing first.';
      case 'eyrie': return 'Set the Eyrie’s initial Roost clearing first.';
      default: return 'Complete this step.';
    }
  }
  function heading(t, intro, note) {
    return '<h2>' + esc(t) + '</h2>' + (intro ? '<p class="step-intro">' + intro + '</p>' : '') +
      (note ? '<p class="rule-note">' + esc(note) + '</p>' : '');
  }

  // ---------- Step: Factions ----------
  function renderFactions() {
    let h = heading('Choose your factions', W.descriptions.makingTheWoodland);
    h += '<div class="picklist" style="display:flex;flex-direction:column;gap:10px">';
    h += '<div class="pick on" style="cursor:default"><span class="mark"></span>' +
      '<div class="p-title">The Denizens</div><div class="p-sub">Always present — the general inhabitants of the Woodland.</div></div>';
    W.coreFactions.forEach(f => {
      const on = state.factions.indexOf(f.name) >= 0;
      h += '<div class="pick' + (on ? ' on' : '') + '" data-fac="' + esc(f.name) + '"><span class="mark"></span>' +
        '<div class="p-title">' + esc(f.name) + '</div><div class="p-sub">' + esc(f.blurb) + '</div></div>';
    });
    h += '</div>';
    const n = state.factions.length, ok = n >= FSEL.min && n <= FSEL.max;
    h += '<p class="small ' + (ok ? 'muted' : '') + '" style="margin-top:12px' + (ok ? '' : ';color:var(--rust)') + '">' +
      n + ' factions selected (' + FSEL.min + '–' + FSEL.max + ').</p>';
    bodyEl.innerHTML = h;
    bodyEl.querySelectorAll('[data-fac]').forEach(el => el.addEventListener('click', () => {
      const name = el.getAttribute('data-fac');
      const i = state.factions.indexOf(name);
      if (i >= 0) state.factions.splice(i, 1);
      else if (state.factions.length < FSEL.max) state.factions.push(name);
      else { toast('At most ' + FSEL.max + ' non-denizen factions.'); return; }
      render();
    }));
  }

  // ---------- Step: Map ----------
  function communityCount(comm) { return state.clearings.filter(c => c.community === comm).length; }
  function nameUsed(name) { return state.clearings.some(c => c.name === name); }

  function rollDraftCommunity() {
    // respect max 4 per community
    for (let i = 0; i < 60; i++) {
      const r = rollRange(W.tables.dominantCommunity);
      if (communityCount(r.result) < W.maxPerCommunity) return { value: r.result, v: r.v };
    }
    // all full: pick any not-yet-full
    const avail = W.communities.find(c => communityCount(c) < W.maxPerCommunity);
    return { value: avail || 'Fox', v: null };
  }
  function rollDraftName() {
    for (let i = 0; i < 40; i++) { const nd = rollName(); if (!nameUsed(nd.name)) return nd; }
    return rollName();
  }
  function newDraft() {
    const comm = rollDraftCommunity();
    const paths = rollRange(W.tables.numberOfPaths);
    const nd = rollDraftName();
    return { community: comm.value, paths: paths.result, name: nd.name, nameDice: nd, capNote: comm.v == null };
  }

  function renderMap() {
    if (state.clearings.length < W.mapSize && !state.draft) state.draft = newDraft();
    const n = state.clearings.length;
    let h = heading('Draw the map — clearing by clearing',
      W.descriptions.mapOfTheWoodland,
      'Birds are never dominant. At most four clearings of each community; each name is used once.');

    if (n < W.mapSize) {
      const d = state.draft;
      h += '<div class="panel" style="background:var(--card);margin-bottom:16px">';
      h += '<p class="eyebrow" style="margin:0 0 10px">Clearing ' + (n + 1) + ' of ' + W.mapSize + '</p>';
      h += '<div class="roll"><span class="rlabel">Dominant community</span><span class="rvalue">' + esc(d.community) + '</span>' +
        '<button class="dice" data-r="comm">↺ Reroll (1d6)</button></div>';
      h += '<div class="roll"><span class="rlabel">Number of paths</span><span class="rvalue">' + d.paths +
        ' <span class="dcount">path' + (d.paths === 1 ? '' : 's') + '</span></span>' +
        '<button class="dice" data-r="paths">↺ Reroll (2d6)</button></div>';
      h += '<div class="roll"><span class="rlabel">Name</span>' +
        '<input type="text" class="rvalue nm" data-r="nameedit" value="' + esc(d.name) + '" style="max-width:220px">' +
        '<button class="dice" data-r="swap" title="Read the dice the other way">⇄ Swap</button>' +
        '<button class="dice" data-r="name">↺ Reroll (2d6)</button></div>';
      h += '<div style="margin-top:12px"><button class="dice primary" data-r="add">+ Add clearing &amp; roll next</button></div>';
      h += '</div>';
    } else {
      h += '<p class="badge yes" style="margin-bottom:14px">All ' + W.mapSize + ' clearings rolled — draw them, then continue.</p>';
    }

    // Committed list
    h += '<p class="eyebrow" style="margin:6px 0 8px">Clearings (' + n + '/' + W.mapSize + ')' +
      '  ·  Rabbit ' + communityCount('Rabbit') + '/4 · Mouse ' + communityCount('Mouse') + '/4 · Fox ' + communityCount('Fox') + '/4</p>';
    h += '<div class="clist">';
    state.clearings.forEach((c, i) => {
      h += '<div class="crow"><span class="cnum">' + (i + 1) + '</span>' +
        '<input type="text" class="nm cname" data-edit="name" data-i="' + i + '" value="' + esc(c.name) + '">' +
        '<select class="comm" data-edit="community" data-i="' + i + '">' +
        W.communities.map(cm => '<option' + (cm === c.community ? ' selected' : '') + '>' + esc(cm) + '</option>').join('') +
        '</select>' +
        '<input type="number" class="pths" data-edit="paths" data-i="' + i + '" min="1" max="6" value="' + c.paths + '">' +
        '<span class="dcount">paths</span>' +
        '<button class="dice" data-reroll="' + i + '">↺</button>' +
        '<button class="rm" data-del="' + i + '" title="Remove" aria-label="Remove this clearing">✕</button></div>';
    });
    h += '</div>';

    // --- Interactive SVG map ---
    if (n > 0) {
      const drawn = state.edges.length;
      const conn = graphConnected();
      h += '<div class="mapsec">';
      h += '<p class="eyebrow" style="margin:20px 0 6px">Draw the paths</p>';
      h += '<p class="rule-note">Click a clearing, then another, to add or remove a path between them. ' +
        'Drag a clearing to move it. Each node shows its paths drawn vs. its rolled number.</p>';
      h += '<p class="small muted" style="margin:0 0 8px">Paths drawn: <b>' + drawn + '</b>' +
        (connectSel != null ? ' · <span style="color:var(--accent-dk)">' + esc((clearingById(connectSel) || {}).name || '') + ' selected — click another clearing to link</span>' :
          '') + ' · ' + (conn ? '<span class="badge yes">all connected</span>' : '<span class="badge no">not all connected</span>') + '</p>';
      h += '<div class="mapwrap">' + renderMapSvg({ interactive: true, colorBy: 'community' }) + '</div>';
      h += '<div class="map-toolbar">' +
        '<button class="dice" id="mapClearPaths">Clear all paths</button>' +
        '<button class="dice" id="mapReset">Reset layout</button>' +
        '<span class="map-legend"><span><span class="lgdot" style="background:#d3e2ba;border-color:#5f7a3f"></span>🐰 Rabbit</span>' +
        '<span><span class="lgdot" style="background:#e4d9bf;border-color:#8a7657"></span>🐭 Mouse</span>' +
        '<span><span class="lgdot" style="background:#eecaa4;border-color:#b5623a"></span>🦊 Fox</span></span>' +
        '</div>';
      h += '</div>';
    }

    bodyEl.innerHTML = h;
    wireMap();
    wireMapSvg();
    const cp = document.getElementById('mapClearPaths');
    if (cp) cp.addEventListener('click', () => { if (!state.edges.length || confirm('Remove all drawn paths?')) { state.edges = []; connectSel = null; render(); } });
    const mr = document.getElementById('mapReset');
    if (mr) mr.addEventListener('click', () => { state.clearings.forEach((c, i) => { const p = seedPos(i); c.x = p.x; c.y = p.y; }); connectSel = null; render(); });
  }

  function wireMap() {
    const d = state.draft;
    bodyEl.querySelectorAll('[data-r]').forEach(el => {
      const act = el.getAttribute('data-r');
      if (act === 'nameedit') { el.addEventListener('input', () => { d.name = el.value; save(); }); return; }
      el.addEventListener('click', () => {
        if (act === 'comm') { const c = rollDraftCommunity(); d.community = c.value; }
        else if (act === 'paths') { d.paths = rollRange(W.tables.numberOfPaths).result; }
        else if (act === 'name') { const nd = rollDraftName(); d.name = nd.name; d.nameDice = nd; }
        else if (act === 'swap') { const s = swapName(d.nameDice); d.name = s.name; d.nameDice = s; }
        else if (act === 'add') {
          const id = (state.clearings.reduce((m, c) => Math.max(m, c.id), 0) || 0) + 1;
          state.clearings.push(newClearing(id, d.community, d.paths, (d.name || '').trim() || 'Unnamed', seedPos(state.clearings.length)));
          state.draft = state.clearings.length < W.mapSize ? newDraft() : null;
        }
        render();
      });
    });
    bodyEl.querySelectorAll('[data-edit]').forEach(el => el.addEventListener('input', () => {
      const i = +el.getAttribute('data-i'), k = el.getAttribute('data-edit');
      state.clearings[i][k] = k === 'paths' ? (+el.value || 1) : el.value;
      save();
    }));
    bodyEl.querySelectorAll('[data-reroll]').forEach(el => el.addEventListener('click', () => {
      const i = +el.getAttribute('data-reroll'), c = state.clearings[i];
      c.community = rollDraftCommunity().value; c.paths = rollRange(W.tables.numberOfPaths).result;
      const nd = rollDraftName(); c.name = nd.name; render();
    }));
    bodyEl.querySelectorAll('[data-del]').forEach(el => el.addEventListener('click', () => {
      const i = +el.getAttribute('data-del'), removed = state.clearings[i];
      state.clearings.splice(i, 1);
      if (removed) state.edges = state.edges.filter(e => e[0] !== removed.id && e[1] !== removed.id);
      if (connectSel === (removed && removed.id)) connectSel = null;
      if (!state.draft) state.draft = newDraft();
      render();
    }));
  }

  // ---------- Corner roller ----------
  function cornerRoller(which, suggestion) {
    const cur = state.corner[which];
    return '<div class="roll"><span class="rlabel">Woodland corner</span>' +
      '<span class="rvalue">' + (cur ? esc(cur) : '<span class="muted" style="font-style:italic">not set</span>') + '</span>' +
      (suggestion ? '<span class="dcount">' + esc(suggestion) + '</span>' : '') +
      '<button class="dice" data-corner="' + which + '">🎲 Roll 1d6 (reroll 5–6)</button></div>';
  }
  function rollCorner() {
    for (let i = 0; i < 30; i++) { const r = rollRange(W.tables.woodlandCorner); if (r.result !== 'Reroll') return r.result; }
    return 'Northwest corner';
  }

  // ---------- Faction pass shared: stronghold/roost picker ----------
  function anchorPicker(label, markerKey, faction) {
    const anchored = state.clearings.find(c => c[markerKey]);
    let h = '<label class="field" style="max-width:340px"><span class="lbl">' + esc(label) + '</span>' +
      '<select id="anchorSel"><option value="">— choose a clearing —</option>' +
      state.clearings.map((c, i) => '<option value="' + i + '"' + (c[markerKey] ? ' selected' : '') + '>' +
        esc(c.name) + ' (' + esc(c.community) + ')</option>').join('') + '</select></label>';
    return h;
  }

  // ---------- Step: Marquisate ----------
  function renderMarquisate() {
    let h = heading('First: the Marquisate', W.descriptions.marquisate, W.descriptions.woodlandCorner);
    h += cornerRoller('marquisate', '');
    h += anchorPicker('Stronghold clearing', 'stronghold', 'The Marquisate');
    const stronghold = state.clearings.find(c => c.stronghold);
    let distMap = {};
    if (stronghold) {
      distMap = bfsFrom([stronghold.id]);
      h += '<p class="rule-note">Distances are read from your drawn map — the shortest path from the stronghold. ' +
        'Override any by hand. Distances of 5+ are never in Marquisate control.</p>';
      if (!graphConnected()) h += '<p class="small" style="color:var(--rust);margin:0 0 8px">Some clearings aren’t linked on the map yet — draw their paths (Map step) for automatic distances, or override by hand.</p>';
      h += '<div class="clist">';
      state.clearings.forEach((c, i) => { h += c.stronghold ? marqRow(c, i, true, 0) : marqRow(c, i, false, distMap[c.id]); });
      h += '</div>';
    }
    bodyEl.innerHTML = h;
    wireCorner();
    wireAnchor('stronghold', 'The Marquisate');
    bodyEl.querySelectorAll('[data-marqdist]').forEach(el => el.addEventListener('input', () => {
      state.clearings[+el.getAttribute('data-marqdist')].distMarq = el.value; save();
    }));
    bodyEl.querySelectorAll('[data-marqroll]').forEach(el => el.addEventListener('click', () => {
      const c = state.clearings[+el.getAttribute('data-marqroll')];
      const auto = distMap[c.id];
      const effD = c.distMarq !== '' ? Math.max(1, Math.round(+c.distMarq) || 1) : (auto != null ? auto : 99);
      const bucket = W.tables.marquisateControl.byPaths.find(b => b.paths === Math.min(effD, 5));
      const roll = r2d6();
      const inControl = !!bucket && bucket.controlMin != null && roll >= bucket.controlMin;
      if (inControl) c.control = 'The Marquisate';
      else if (c.control === 'The Marquisate') c.control = null;
      c._roll.marq = { roll, d: effD, inControl };
      render();
    }));
  }
  function marqRow(c, i, isStronghold, autoD) {
    if (isStronghold) return '<div class="crow"><span class="cname">' + esc(c.name) + '</span>' +
      '<span class="badge roost">Stronghold — controlled</span></div>';
    const rr = c._roll.marq;
    const autoTxt = autoD != null ? 'auto ' + autoD + ' path' + (autoD === 1 ? '' : 's') : 'unlinked';
    return '<div class="crow"><span class="cname">' + esc(c.name) + '</span>' +
      '<span class="dcount">' + autoTxt + '</span>' +
      '<input type="number" class="pths" min="1" max="9" placeholder="' + (autoD != null ? autoD : '?') + '" step="1" data-marqdist="' + i + '" value="' + esc(c.distMarq) + '" title="Override distance">' +
      '<button class="dice" data-marqroll="' + i + '">🎲 Roll 2d6</button>' +
      (rr ? '<span class="badge ' + (rr.inControl ? 'yes' : 'no') + '">' + (rr.inControl ? 'In Marquisate control' : 'Not in control') + '</span>' : '') +
      (c.control && c.control !== 'The Marquisate' ? '<span class="badge no">' + esc(c.control) + '</span>' : '') + '</div>';
  }

  // ---------- Step: Eyrie ----------
  function renderEyrie() {
    const opp = state.corner.marquisate ? 'opposite the Marquisate stronghold' : '';
    let h = heading('Second: the Eyrie Dynasties', W.descriptions.eyrie, W.descriptions.woodlandCorner + (opp ? ' Choose the corner ' + opp + '.' : ''));
    h += cornerRoller('eyrie', opp);
    h += anchorPicker('Initial Roost clearing', 'roost', 'The Eyrie Dynasties');
    const anchor = state.clearings.find(c => c.roost);
    let distMap = {};
    if (anchor) {
      const roostIds = state.clearings.filter(c => c.roost).map(c => c.id);
      distMap = bfsFrom(roostIds);
      const roosts = roostIds.length;
      const ctrl = controlledBy('The Eyrie Dynasties').length;
      h += '<p class="rule-note">Distances are read from your drawn map — the shortest path from the nearest Roost (recomputed as Roosts spread). ' +
        'Override any by hand. Max ' + W.tables.eyrieControl.maxRoosts + ' Roosts and ' + W.tables.eyrieControl.maxControlled + ' controlled clearings. ' +
        'The Marquisate stronghold is skipped.</p>';
      h += '<p class="small muted">Roosts placed: ' + roosts + '/' + W.tables.eyrieControl.maxRoosts +
        ' · Eyrie clearings: ' + ctrl + '/' + W.tables.eyrieControl.maxControlled + '</p>';
      h += '<div class="clist">';
      state.clearings.forEach((c, i) => {
        if (c.stronghold) return;
        if (c.roost && c === anchor) { h += '<div class="crow"><span class="cname">' + esc(c.name) + '</span><span class="badge roost">Initial Roost — controlled</span></div>'; return; }
        h += eyrieRow(c, i, distMap[c.id]);
      });
      h += '</div>';
    }
    bodyEl.innerHTML = h;
    wireCorner();
    wireAnchor('roost', 'The Eyrie Dynasties');
    bodyEl.querySelectorAll('[data-eyriedist]').forEach(el => el.addEventListener('input', () => {
      state.clearings[+el.getAttribute('data-eyriedist')].distRoost = el.value; save();
    }));
    bodyEl.querySelectorAll('[data-eyrieroll]').forEach(el => el.addEventListener('click', () => {
      const c = state.clearings[+el.getAttribute('data-eyrieroll')];
      const auto = distMap[c.id];
      const d = c.distRoost !== '' ? Math.max(1, Math.round(+c.distRoost) || 1) : (auto != null ? auto : 99);
      const bucket = W.tables.eyrieControl.byPaths.find(b => b.paths === Math.min(d, 4));
      const roll = r2d6();
      const controlledNow = controlledBy('The Eyrie Dynasties').length;
      const roostsNow = state.clearings.filter(x => x.roost).length;
      let outcome = 'not';
      if (bucket && bucket.roostMin != null && roll >= bucket.roostMin) outcome = 'roost';
      else if (bucket && bucket.controlMin != null && roll >= bucket.controlMin) outcome = 'control';
      // caps
      if (outcome !== 'not' && c.control !== 'The Eyrie Dynasties' && controlledNow >= W.tables.eyrieControl.maxControlled) {
        outcome = 'capped';
      }
      if (outcome === 'roost' && roostsNow >= W.tables.eyrieControl.maxRoosts && !c.roost) outcome = 'control';
      const seized = c.control && c.control !== 'The Eyrie Dynasties' && outcome !== 'not' && outcome !== 'capped';
      if (outcome === 'roost') { c.control = 'The Eyrie Dynasties'; c.roost = true; }
      else if (outcome === 'control') { c.control = 'The Eyrie Dynasties'; c.roost = false; }
      if (seized) c.contested = true; // changed hands between non-denizen factions
      c._roll.eyrie = { roll, d, outcome, seized };
      render();
    }));
  }
  function eyrieRow(c, i, autoD) {
    const rr = c._roll.eyrie;
    let badge = '';
    if (rr) {
      const map = { not: ['no', 'not in control'], control: ['yes', 'Eyrie, no Roost'], roost: ['roost', 'Eyrie + Roost'], capped: ['no', 'cap reached'] };
      const m = map[rr.outcome];
      badge = '<span class="badge ' + m[0] + '">' + m[1] + (rr.seized ? ' (seized)' : '') + '</span>';
    }
    const autoTxt = autoD != null ? 'auto ' + autoD + ' path' + (autoD === 1 ? '' : 's') : 'unlinked';
    return '<div class="crow"><span class="cname">' + esc(c.name) + '</span>' +
      (c.control ? '<span class="badge ' + (c.control === 'The Eyrie Dynasties' ? 'yes' : 'no') + '">' + esc(c.control) + (c.roost ? ' ⌂' : '') + '</span>' : '') +
      '<span class="dcount">' + autoTxt + '</span>' +
      '<input type="number" class="pths" min="1" max="9" placeholder="' + (autoD != null ? autoD : '?') + '" step="1" data-eyriedist="' + i + '" value="' + esc(c.distRoost) + '" title="Override distance">' +
      '<button class="dice" data-eyrieroll="' + i + '">🎲 Roll 2d6</button>' + badge + '</div>';
  }

  // ---------- Step: Alliance ----------
  function derivedState(c) {
    if (c.contested) return 'Contested';
    if (c.control && c.control !== DENIZEN && c.control !== UNCONTROLLED) return 'Controlled';
    return 'Uncontrolled';
  }
  function factionTagClass(f) {
    const s = (f || '').toLowerCase();
    if (s.indexOf('marqu') >= 0) return 'marquise';
    if (s.indexOf('eyrie') >= 0) return 'eyrie';
    if (s.indexOf('alliance') >= 0) return 'alliance';
    return '';
  }
  function renderAlliance() {
    let h = heading('Third: the Woodland Alliance', W.descriptions.alliance, W.descriptions.uprising);
    h += '<p class="eyebrow" style="margin:4px 0 8px">1 · Sympathy</p>';
    h += '<p class="rule-note">A clearing’s state is set by who holds it — <b>Uncontrolled</b> (denizen-held), ' +
      '<b>Controlled</b> (a faction holds it, named beside the clearing), or <b>Contested</b> (it changed hands ' +
      'between factions). That state sets the sympathy target; change it if your table disagrees.</p><div class="clist">';
    state.clearings.forEach((c, i) => {
      const st = c.allianceState || derivedState(c);
      const rr = c._roll.symp;
      const holder = (c.control && c.control !== DENIZEN && c.control !== UNCONTROLLED)
        ? '<span class="tag ' + factionTagClass(c.control) + '">' + esc(c.control) + '</span>' : '';
      h += '<div class="crow"><span class="cname">' + esc(c.name) + '</span>' + holder +
        '<select data-symstate="' + i + '" class="comm">' +
        ['Uncontrolled', 'Controlled', 'Contested'].map(s => '<option' + (s === st ? ' selected' : '') + '>' + s + '</option>').join('') + '</select>' +
        '<button class="dice" data-symroll="' + i + '">🎲 Roll 2d6</button>' +
        (rr ? '<span class="badge ' + (c.sympathy ? 'yes' : 'no') + '">' + (c.sympathy ? 'Sympathy' : 'No sympathy') + '</span>' : '') +
        (c.base ? '<span class="badge yes">base</span>' : '') + '</div>';
    });
    h += '</div>';

    const symp = state.clearings.filter(c => c.sympathy);
    h += '<p class="eyebrow" style="margin:18px 0 8px">2 · Uprising ' +
      (state.uprisingDone ? '<span class="badge yes">an uprising occurred — stop</span>' : '') + '</p>';
    if (!symp.length) h += '<p class="muted small">Roll sympathy first; sympathetic clearings will appear here.</p>';
    else {
      h += '<p class="rule-note">Roll for each sympathetic clearing in turn. Stop once an Uprising (10+) occurs.</p><div class="clist">';
      symp.forEach(c => {
        const i = state.clearings.indexOf(c);
        const rr = c._roll.upr;
        h += '<div class="crow"><span class="cname">' + esc(c.name) + '</span>' +
          '<button class="dice" data-uprroll="' + i + '"' + (state.uprisingDone && !rr ? ' disabled title="An uprising already occurred"' : '') + '>🎲 Roll 2d6</button>' +
          (rr ? '<span class="badge ' + (rr.uprising ? 'yes' : 'no') + '">' + esc(rr.short) + '</span>' : '') + '</div>';
      });
      h += '</div>';
    }
    bodyEl.innerHTML = h;
    bodyEl.querySelectorAll('[data-symstate]').forEach(el => el.addEventListener('change', () => {
      state.clearings[+el.getAttribute('data-symstate')].allianceState = el.value; save();
    }));
    bodyEl.querySelectorAll('[data-symroll]').forEach(el => el.addEventListener('click', () => {
      const c = state.clearings[+el.getAttribute('data-symroll')];
      const st = c.allianceState || derivedState(c);
      const row = W.tables.allianceSympathy.byState.find(b => b.state === st);
      const roll = r2d6();
      c.sympathy = roll >= row.sympathyMin;
      c.allianceState = st;
      c._roll.symp = { roll };
      if (!c.sympathy) { c._roll.upr = null; }
      render();
    }));
    bodyEl.querySelectorAll('[data-uprroll]').forEach(el => el.addEventListener('click', () => {
      const c = state.clearings[+el.getAttribute('data-uprroll')];
      const roll = r2d6();
      const row = fromRanges(W.tables.uprising.ranges, roll);
      c._roll.upr = { roll, uprising: row.uprising, short: row.uprising ? (row.spread ? 'Uprising + spread' : 'Uprising') : 'no uprising' };
      if (row.uprising) {
        c.base = true; c.control = 'The Woodland Alliance'; c.roost = false; c.stronghold = false;
        if (row.spread) {
          // Natural 12: sympathy spreads to every clearing connected to the base.
          neighborIds(c.id).forEach(id => { const n = clearingById(id); if (n) n.sympathy = true; });
          c._roll.upr.short = 'Uprising + sympathy spreads';
        }
        state.uprisingDone = true;
      } else { c.base = false; }
      render();
    }));
  }

  // ---------- Expansion-faction placement (Lizard / Riverfolk / Grand Duchy / Corvid) ----------
  function hasPresence(c, f) { return (c.presence || []).indexOf(f) >= 0; }
  function addPresence(c, f) { if (!c.presence) c.presence = []; if (!hasPresence(c, f)) c.presence.push(f); }
  function removePresence(c, f) { if (!c.presence) return; const i = c.presence.indexOf(f); if (i >= 0) c.presence.splice(i, 1); }
  function hasStruct(c, s) { return (c.structures || []).indexOf(s) >= 0; }
  function addStruct(c, s) { if (!c.structures) c.structures = []; if (!hasStruct(c, s)) c.structures.push(s); }
  function removeStruct(c, s) { if (c.structures) c.structures = c.structures.filter(x => x !== s); }
  function randomPick(arr, n) { const a = arr.slice(), out = []; while (out.length < n && a.length) out.push(a.splice(Math.floor(Math.random() * a.length), 1)[0]); return out; }
  function presenceRow(faction) {
    const pres = state.clearings.filter(c => hasPresence(c, faction));
    return pres.length ? pres.map(c => esc(c.name)).join(', ') : '—';
  }

  // --- Fourth: The Lizard Cult ---
  function placeLizardPresence() {
    state.clearings.forEach(c => removePresence(c, 'The Lizard Cult'));
    randomPick(state.clearings.filter(c => c.community === state.lizardOutcast), 2).forEach(c => addPresence(c, 'The Lizard Cult'));
  }
  function renderLizard() {
    let h = heading('Fourth: the Lizard Cult', W.descriptions.lizard, W.descriptions.controlVsPresence);
    h += '<div class="roll"><span class="rlabel">Outcast community</span><span class="rvalue">' +
      (state.lizardOutcast ? esc(state.lizardOutcast) : '<span class="muted" style="font-style:italic">not rolled</span>') +
      '</span><button class="dice" data-lizard-outcast>🎲 Roll 1d6</button></div>';
    if (state.lizardOutcast) h += '<p class="small muted">Presence (2 random ' + esc(state.lizardOutcast) + ' clearings): <b>' + presenceRow('The Lizard Cult') +
      '</b> <button class="dice" data-lizard-repres>↺ Reroll</button></p>';
    h += cornerRoller('lizard', 'opposite the Marquisate / Eyrie if possible');
    h += anchorSelect('lizardGarden', 'Garden clearing (Lizard control, in a corner)', c => c.control === 'The Lizard Cult' && hasStruct(c, 'Garden'));
    bodyEl.innerHTML = h;
    wireCorner();
    document.querySelector('[data-lizard-outcast]').addEventListener('click', () => { state.lizardOutcast = rollRange(W.tables.outcast).result; placeLizardPresence(); render(); });
    const rp = document.querySelector('[data-lizard-repres]'); if (rp) rp.addEventListener('click', () => { placeLizardPresence(); render(); });
    document.getElementById('lizardGarden').addEventListener('change', function () {
      state.clearings.forEach(c => { if (c.control === 'The Lizard Cult' && hasStruct(c, 'Garden')) { c.control = null; removeStruct(c, 'Garden'); } });
      if (this.value !== '') { const c = state.clearings[+this.value]; c.control = 'The Lizard Cult'; addStruct(c, 'Garden'); }
      render();
    });
  }

  // --- Fifth: The Riverfolk Company (rivers/lakes simplified to an on-water toggle) ---
  function riverfolkYeses(c) { let y = 0; if (c.onWater) y++; if (c.paths >= 3) y++; if (c.paths >= 4) y++; return y; }
  function placeRiverfolk() {
    state.clearings.forEach(c => { removePresence(c, 'The Riverfolk Company'); if (c.control === 'The Riverfolk Company') c.control = null; removeStruct(c, 'Trading post'); });
    const ranked = state.clearings.slice().sort((a, b) => riverfolkYeses(b) - riverfolkYeses(a));
    ranked.slice(0, 4).forEach(c => addPresence(c, 'The Riverfolk Company'));
    // Control + trading post in the highest-ranked clearing that can be theirs (not already faction-held)
    const top = ranked.find(c => !c.stronghold && !c.roost && (!c.control || c.control === DENIZEN || c.control === UNCONTROLLED));
    if (top) { top.control = 'The Riverfolk Company'; addStruct(top, 'Trading post'); }
    render();
  }
  function renderRiverfolk() {
    let h = heading('Fifth: the Riverfolk Company', W.descriptions.riverfolk,
      'This tool skips drawing rivers and lakes — mark which clearings sit on the water, then it ranks every clearing by water + paths and places the Riverfolk.');
    h += '<p class="eyebrow" style="margin:6px 0 6px">On a river or lake</p><div class="clist">';
    state.clearings.forEach((c, i) => {
      h += '<div class="crow"><span class="cname">' + esc(c.name) + '</span><span class="dcount">' + c.paths + ' paths · ' + riverfolkYeses(c) + ' yes</span>' +
        '<label class="modtoggle" style="margin-left:auto;cursor:pointer"><input type="checkbox" data-water="' + i + '"' + (c.onWater ? ' checked' : '') + '> on water</label></div>';
    });
    h += '</div><div style="margin-top:12px"><button class="dice primary" data-river-place>🎲 Place the Riverfolk by criteria</button></div>';
    h += '<p class="small muted" style="margin-top:10px">Presence: <b>' + presenceRow('The Riverfolk Company') + '</b> · Control + trading post: <b>' +
      (controlledBy('The Riverfolk Company').map(c => esc(c.name)).join(', ') || '—') + '</b></p>';
    bodyEl.innerHTML = h;
    bodyEl.querySelectorAll('[data-water]').forEach(el => el.addEventListener('change', () => { state.clearings[+el.getAttribute('data-water')].onWater = el.checked; save(); render(); }));
    document.querySelector('[data-river-place]').addEventListener('click', placeRiverfolk);
  }

  // --- Sixth: The Grand Duchy ---
  function renderDuchy() {
    let h = heading('Sixth: the Grand Duchy', W.descriptions.duchy);
    h += '<details style="margin:0 0 12px"><summary class="eyebrow" style="cursor:pointer">Duchy Invasion — which corner</summary><div class="small" style="margin-top:8px">' +
      W.tables.duchyInvasion.rows.map(r => '<div class="m-tier"><b>' + esc(r.when) + '</b> — ' + esc(r.corner) + '</div>').join('') + '</div></details>';
    h += cornerRoller('duchy', '');
    h += anchorSelect('duchyStart', 'Invasion clearing (tunnel + Duchy control, in a corner)', c => c._duchyStart);
    const start = state.clearings.find(c => c._duchyStart);
    if (start) {
      const adj = neighborIds(start.id);
      h += '<p class="rule-note">For each clearing directly connected to <b>' + esc(start.name) + '</b>, roll 2d6 — on a 10+ the Duchy takes control.</p><div class="clist">';
      state.clearings.filter(c => adj.indexOf(c.id) >= 0).forEach(c => {
        const i = state.clearings.indexOf(c), rr = c._roll.duchy;
        h += '<div class="crow"><span class="cname">' + esc(c.name) + '</span>' +
          (c.control ? '<span class="badge ' + (c.control === 'The Grand Duchy' ? 'yes' : 'no') + '">' + esc(c.control) + '</span>' : '') +
          '<button class="dice" data-duchy-roll="' + i + '">🎲 Roll 2d6</button>' +
          (rr ? '<span class="badge ' + (rr.ctrl ? 'yes' : 'no') + '">' + (rr.ctrl ? 'Duchy control' : 'no') + '</span>' : '') + '</div>';
      });
      h += '</div><div style="margin-top:10px"><button class="dice" data-duchy-tunnel>🎲 Add a tunnel to a random clearing</button></div>';
    }
    bodyEl.innerHTML = h;
    wireCorner();
    document.getElementById('duchyStart').addEventListener('change', function () {
      state.clearings.forEach(c => { if (c._duchyStart) { c._duchyStart = false; if (c.control === 'The Grand Duchy') c.control = null; removeStruct(c, 'Tunnel'); } });
      if (this.value !== '') { const c = state.clearings[+this.value]; c._duchyStart = true; c.control = 'The Grand Duchy'; addStruct(c, 'Tunnel'); }
      render();
    });
    bodyEl.querySelectorAll('[data-duchy-roll]').forEach(el => el.addEventListener('click', () => {
      const c = state.clearings[+el.getAttribute('data-duchy-roll')], roll = r2d6(), ctrl = roll >= 10;
      if (ctrl) c.control = 'The Grand Duchy'; c._roll.duchy = { roll, ctrl }; render();
    }));
    const dt = document.querySelector('[data-duchy-tunnel]'); if (dt) dt.addEventListener('click', () => {
      const c = randomPick(state.clearings.filter(x => x.control !== 'The Grand Duchy' && !hasStruct(x, 'Tunnel')), 1)[0];
      if (c) { addStruct(c, 'Tunnel'); toast('Tunnel added to ' + c.name); } render();
    });
  }

  // --- Seventh: The Corvid Conspiracy ---
  function renderCorvid() {
    let h = heading('Seventh: the Corvid Conspiracy', W.descriptions.corvid, W.descriptions.controlVsPresence);
    const pres = state.clearings.filter(c => hasPresence(c, 'The Corvid Conspiracy'));
    h += '<p class="small muted">Presence (4 random clearings, no control): <b>' + presenceRow('The Corvid Conspiracy') + '</b></p>';
    h += '<div style="margin-top:8px"><button class="dice primary" data-corvid-place>🎲 ' + (pres.length ? 'Reroll' : 'Place') + ' Corvid presence</button></div>';
    bodyEl.innerHTML = h;
    document.querySelector('[data-corvid-place]').addEventListener('click', () => {
      state.clearings.forEach(c => removePresence(c, 'The Corvid Conspiracy'));
      randomPick(state.clearings, 4).forEach(c => addPresence(c, 'The Corvid Conspiracy'));
      render();
    });
  }

  // shared clearing <select> that runs a picker; matcher marks the current selection
  function anchorSelect(id, label, isSel) {
    return '<label class="field" style="max-width:380px"><span class="lbl">' + esc(label) + '</span>' +
      '<select id="' + id + '"><option value="">— choose a clearing —</option>' +
      state.clearings.map((c, i) => '<option value="' + i + '"' + (isSel(c) ? ' selected' : '') + '>' + esc(c.name) + ' (' + esc(c.community) + ')</option>').join('') +
      '</select></label>';
  }

  // ---------- Ruins (R&E) ----------
  function anyRuin() { return state.clearings.some(c => c.ruin); }
  function ruinIds() { return state.clearings.filter(c => c.ruin).map(c => c.id); }
  function adjacentToRuin(c) { return c.ruin || neighborIds(c.id).some(id => { const n = clearingById(id); return n && n.ruin; }); }
  function renderRuins() {
    const rt = W.tables.ruins || { base: 2 };
    let h = heading('Ruins of the Ancients', W.descriptions.ruins,
      'Ruins matter for the Keepers in Iron and for expeditions. Roll to scatter them, then tap any clearing to add or remove a ruin.');
    h += '<div style="margin-bottom:12px"><button class="dice primary" data-ruin-roll>🎲 Roll & scatter ruins (2 + ½·1d6)</button>' +
      '<span class="small muted" style="margin-left:10px">' + ruinIds().length + ' ruin' + (ruinIds().length === 1 ? '' : 's') + ' placed</span></div>';
    h += '<div class="clist">';
    state.clearings.forEach((c, i) => {
      h += '<div class="crow"><span class="cname">' + esc(c.name) + '</span><span class="dcount">' + esc(c.community) + '</span>' +
        '<label class="modtoggle" style="margin-left:auto;cursor:pointer"><input type="checkbox" data-ruin="' + i + '"' + (c.ruin ? ' checked' : '') + '> ruin here</label></div>';
    });
    h += '</div>';
    bodyEl.innerHTML = h;
    document.querySelector('[data-ruin-roll]').addEventListener('click', () => {
      const extra = Math.ceil((d6()) / 2), total = (rt.base || 2) + extra;
      state.clearings.forEach(c => c.ruin = false);
      randomPick(state.clearings, Math.min(total, state.clearings.length)).forEach(c => c.ruin = true);
      toast('Placed ' + total + ' ruins'); render();
    });
    bodyEl.querySelectorAll('[data-ruin]').forEach(el => el.addEventListener('change', () => { state.clearings[+el.getAttribute('data-ruin')].ruin = el.checked; save(); render(); }));
  }

  // ---------- Eighth: The Hundreds ----------
  function renderHundreds() {
    let h = heading('Eighth: the Hundreds', W.descriptions.hundreds, W.descriptions.woodlandCorner);
    h += cornerRoller('hundreds', '');
    h += anchorSelect('hundredsStrong', 'Stronghold clearing (control + mob + warriors + hoard 30, in a corner)', c => c.stronghold && c.control === 'The Hundreds');
    const strong = state.clearings.find(c => c.stronghold && c.control === 'The Hundreds');
    if (strong) {
      const distMap = bfsFrom([strong.id]);
      h += '<p class="rule-note">For each other clearing, roll the Mob Table (2d6 − paths from the stronghold). A mob on 10+, or on 7–9 if another faction holds it. Then roll a Hoard for each mob.</p><div class="clist">';
      state.clearings.forEach((c, i) => {
        if (c === strong) return;
        const auto = distMap[c.id], mob = c._roll.mob, hoard = c._roll.hoard;
        h += '<div class="crow"><span class="cname">' + esc(c.name) + '</span>' +
          '<span class="dcount">' + (auto != null ? auto + ' away' : 'unlinked') + '</span>' +
          '<button class="dice" data-hmob="' + i + '">🎲 Mob</button>' +
          (mob ? '<span class="badge ' + (mob.placed ? 'yes' : 'no') + '">' + mob.roll + ' → ' + (mob.placed ? 'mob' : 'none') + '</span>' : '') +
          (hasStruct(c, 'Mob') ? '<button class="dice" data-hhoard="' + i + '">🎲 Hoard</button>' : '') +
          (hoard ? '<span class="badge ' + (hoard.value ? 'yes' : 'no') + '">' + hoard.roll + ' → ' + (hoard.value ? 'hoard ' + hoard.value : 'none') + '</span>' : '') + '</div>';
      });
      h += '</div>';
    }
    bodyEl.innerHTML = h;
    wireCorner();
    document.getElementById('hundredsStrong').addEventListener('change', function () {
      state.clearings.forEach(c => { if (c.stronghold && c.control === 'The Hundreds') { c.stronghold = false; c.control = null; c.hoard = 0; removeStruct(c, 'Mob'); removeStruct(c, 'Warriors'); removePresence(c, 'The Hundreds'); } });
      if (this.value !== '') { const c = state.clearings[+this.value]; c.stronghold = true; c.control = 'The Hundreds'; c.hoard = 30; addStruct(c, 'Mob'); addStruct(c, 'Warriors'); addPresence(c, 'The Hundreds'); }
      render();
    });
    bodyEl.querySelectorAll('[data-hmob]').forEach(el => el.addEventListener('click', () => {
      const c = state.clearings[+el.getAttribute('data-hmob')];
      const dist = bfsFrom([strong.id])[c.id]; const roll = r2d6() - (dist != null ? dist : 0);
      const row = fromRanges(W.tables.mob.ranges, roll);
      const placed = row.mob === true || (row.mob === 'ifEnemy' && isFactionControl(c.control) && c.control !== 'The Hundreds');
      if (placed) addStruct(c, 'Mob'); else { removeStruct(c, 'Mob'); c.hoard = 0; c._roll.hoard = null; }
      c._roll.mob = { roll, placed }; render();
    }));
    bodyEl.querySelectorAll('[data-hhoard]').forEach(el => el.addEventListener('click', () => {
      const c = state.clearings[+el.getAttribute('data-hhoard')], roll = r2d6(), row = fromRanges(W.tables.hoard.ranges, roll);
      const enemyStructs = (c.structures || []).filter(s => ['Sawmill', 'Workshop', 'Recruiting post', 'Market', 'Citadel', 'Garden', 'Trading post', 'Tunnel'].indexOf(s) >= 0);
      const destroyed = Math.min(row.destroy || 0, enemyStructs.length);
      let value = 0;
      if (row.perStructure != null) { value = (row.base || 0) + destroyed * row.perStructure; if (!enemyStructs.length && !row.base) value = 0; }
      for (let k = 0; k < destroyed; k++) removeStruct(c, enemyStructs[k]);
      c.hoard = value; c._roll.hoard = { roll, value }; render();
    }));
  }

  // ---------- Ninth: The Keepers in Iron ----------
  function keepersControlRoll(c) {
    const roll = r2d6(), row = fromRanges(W.tables.keepersControl.ranges, roll);
    let took = false;
    if (row.control === 'yes') took = true;
    else if (row.control === 'ifUncontrolled') took = !isFactionControl(c.control);
    if (took) c.control = 'The Keepers in Iron';
    return { roll, took };
  }
  function renderKeepers() {
    let h = heading('Ninth: the Keepers in Iron', W.descriptions.keepers, W.descriptions.controlVsPresence);
    if (!anyRuin()) { h += '<p class="rule-note" style="color:var(--rust)">The Keepers need ruins. Add some in the Ruins step first.</p>'; bodyEl.innerHTML = h; return; }
    h += anchorSelect('keepersWay1', 'First waystation (a clearing at or adjacent to a ruin)', c => c.control === 'The Keepers in Iron' || hasStruct(c, 'Waystation'));
    const eligible = state.clearings.filter(adjacentToRuin);
    h += '<p class="small muted">Eligible (by a ruin): ' + (eligible.map(c => esc(c.name)).join(', ') || '—') + '</p>';
    const ways = state.clearings.filter(c => hasStruct(c, 'Waystation'));
    if (ways.length) {
      h += '<p class="eyebrow" style="margin:14px 0 6px">Second waystation</p>' +
        '<button class="dice" data-keepers-second>🎲 Roll Second Waystation table</button>';
      if (state._keepersSecond) h += '<span class="badge ' + (state._keepersSecond.place ? 'yes' : 'no') + '" style="margin-left:8px">' + state._keepersSecond.roll + ' → ' + (state._keepersSecond.place ? 'place a 2nd' : 'no 2nd') + '</span>';
      if (state._keepersSecond && state._keepersSecond.place) h += anchorSelect('keepersWay2', 'Second waystation clearing (by another ruin)', c => false);
    }
    h += '<p class="small muted" style="margin-top:10px">Waystations: ' + (ways.map(c => esc(c.name) + (c.control === 'The Keepers in Iron' ? ' (control)' : '')).join(', ') || '—') + '</p>';
    bodyEl.innerHTML = h;
    document.getElementById('keepersWay1').addEventListener('change', function () {
      state.clearings.forEach(c => { if (hasStruct(c, 'Waystation') && !c._keepersSecondWay) { removeStruct(c, 'Waystation'); removePresence(c, 'The Keepers in Iron'); if (c.control === 'The Keepers in Iron') c.control = null; } });
      if (this.value !== '') { const c = state.clearings[+this.value]; addStruct(c, 'Waystation'); addPresence(c, 'The Keepers in Iron'); c._roll.keepers = keepersControlRoll(c); }
      render();
    });
    const sb = document.querySelector('[data-keepers-second]');
    if (sb) sb.addEventListener('click', () => { const roll = r2d6(), row = fromRanges(W.tables.secondWaystation.ranges, roll); const first = state.clearings.find(c => hasStruct(c, 'Waystation')); const place = row.place === 'yes' || (row.place === 'ifControlFirst' && first && first.control === 'The Keepers in Iron'); state._keepersSecond = { roll, place }; render(); });
    const w2 = document.getElementById('keepersWay2');
    if (w2) w2.addEventListener('change', function () {
      state.clearings.forEach(c => { if (c._keepersSecondWay) { c._keepersSecondWay = false; removeStruct(c, 'Waystation'); removePresence(c, 'The Keepers in Iron'); if (c.control === 'The Keepers in Iron') c.control = null; } });
      if (this.value !== '') { const c = state.clearings[+this.value]; c._keepersSecondWay = true; addStruct(c, 'Waystation'); addPresence(c, 'The Keepers in Iron'); c._roll.keepers = keepersControlRoll(c); }
      render();
    });
  }

  // ---------- Step: Denizens ----------
  function denizenEligible(c) {
    if (c.stronghold || c.roost || c.base) return false;
    if (!c.control || c.control === DENIZEN || c.control === UNCONTROLLED) return false;
    return true;
  }
  function renderDenizens() {
    let h = heading('Last: the Denizens', W.descriptions.denizens);
    const elig = state.clearings.filter(denizenEligible);
    if (!elig.length) h += '<p class="muted">No eligible clearings — nothing controlled is left to slip from a faction’s grasp.</p>';
    else {
      h += '<div class="clist">';
      elig.forEach(c => {
        const i = state.clearings.indexOf(c);
        const rr = c._roll.den;
        h += '<div class="crow"><span class="cname">' + esc(c.name) + '</span>' +
          '<span class="badge no">' + esc(c.control) + '</span>' +
          '<button class="dice" data-denroll="' + i + '">🎲 Roll 2d6</button>' +
          (rr ? '<span class="badge ' + (rr.unc ? 'yes' : 'no') + '">' + (rr.unc ? 'Returned to denizens' : 'Holds') + '</span>' : '') + '</div>';
      });
      h += '</div>';
    }
    bodyEl.innerHTML = h;
    bodyEl.querySelectorAll('[data-denroll]').forEach(el => el.addEventListener('click', () => {
      const c = state.clearings[+el.getAttribute('data-denroll')];
      const roll = r2d6();
      const row = fromRanges(W.tables.denizenReturn.ranges, roll);
      c._roll.den = { roll, unc: !!row.uncontrolled };
      if (row.uncontrolled) c.control = UNCONTROLLED;
      render();
    }));
  }

  // ---------- Step: Flesh out ----------
  function renderFlesh() {
    let h = heading('Flesh out the clearings', W.descriptions.fleshingOut,
      'Optional — roll two inhabitants, two buildings, and two problems for any clearing you like.');
    h += '<div style="margin-bottom:14px"><button class="dice primary" id="fleshAll">🎲 Roll all clearings</button></div>';
    state.clearings.forEach((c, i) => {
      h += '<div class="fx-clearing"><h4>' + esc(c.name) + ' <span class="dcount">' + esc(c.community) + ' · ' + c.paths + ' paths</span></h4>' +
        fxRow('Inhabitants', c.inhabitants, 'inh', i) +
        fxRow('Buildings', c.buildings, 'bld', i) +
        fxRow('Problems', c.problems, 'prb', i) + '</div>';
    });
    bodyEl.innerHTML = h;
    document.getElementById('fleshAll').addEventListener('click', () => { state.clearings.forEach(rollFlesh); render(); });
    bodyEl.querySelectorAll('[data-fx]').forEach(el => el.addEventListener('click', () => {
      const i = +el.getAttribute('data-i'), kind = el.getAttribute('data-fx');
      rollFleshKind(state.clearings[i], kind); render();
    }));
  }
  function fxRow(label, arr, kind, i) {
    return '<div class="fx-row"><span class="fx-lbl">' + label + '</span>' +
      (arr && arr.length ? arr.map(x => '<span class="tag">' + esc(x) + '</span>').join('') : '<span class="muted small">—</span>') +
      '<button class="dice" data-fx="' + kind + '" data-i="' + i + '" style="margin-left:auto">🎲</button></div>';
  }
  function rollFleshKind(c, kind) {
    const map = { inh: ['inhabitants', 'importantInhabitants'], bld: ['buildings', 'importantBuildings'], prb: ['problems', 'problems'] };
    const [field, tbl] = map[kind];
    c[field] = [rollGrid(W.tables[tbl]).result, rollGrid(W.tables[tbl]).result];
  }
  function rollFlesh(c) { rollFleshKind(c, 'inh'); rollFleshKind(c, 'bld'); rollFleshKind(c, 'prb'); }

  // ---------- Corner / anchor wiring ----------
  function wireCorner() {
    bodyEl.querySelectorAll('[data-corner]').forEach(el => el.addEventListener('click', () => {
      state.corner[el.getAttribute('data-corner')] = rollCorner(); render();
    }));
  }
  function wireAnchor(markerKey, faction) {
    const sel = document.getElementById('anchorSel');
    if (!sel) return;
    sel.addEventListener('change', () => {
      state.clearings.forEach(c => { if (c[markerKey]) { c[markerKey] = false; if (c.control === faction && !c.base) c.control = null; } });
      const v = sel.value;
      if (v !== '') { const c = state.clearings[+v]; c[markerKey] = true; c.control = faction; }
      render();
    });
  }

  // ---------- Step: Review ----------
  function renderReview() {
    let h = heading('Review & export the Woodland',
      'Your Woodland is ready. Export it as JSON to keep, or import one to revise.');
    h += '<p class="small muted">Factions: ' + state.factions.map(esc).join(', ') + ', and the Denizens.' +
      (state.corner.marquisate ? ' · Marquisate corner: ' + esc(state.corner.marquisate) : '') +
      (state.corner.eyrie ? ' · Eyrie corner: ' + esc(state.corner.eyrie) : '') + '</p>';
    if (state.clearings.length) {
      h += '<div class="mapwrap review">' + renderMapSvg({ interactive: false, colorBy: 'control' }) + '</div>';
      const inPlay = (state.factions || []).filter(f => CONTROL_COLOR[f]);
      h += '<div class="map-legend" style="margin:10px 0 18px"><span style="font-weight:700">Border = control:</span>' +
        inPlay.map(f => '<span><span class="lgdot" style="background:transparent;border:3px solid ' + CONTROL_COLOR[f] + '"></span>' + esc(f) + '</span>').join('') +
        '<span><span class="lgdot" style="background:transparent;border:2px solid #5a4a30"></span>Denizen-held</span>' +
        '<span><span class="lgdot" style="background:' + SYMPATHY_COLOR + ';border-color:#2c5320"></span>Sympathy</span>' +
        '<span>▨ ruin · ★ stronghold · ⌂ Roost · ▲ base · ‡ mob · ◈ hoard · ⌘ waystation · ⚔ warriors · ❀ garden · ⚑ post · ◎ tunnel · $ market · ▣ citadel · ✦ plot</span></div>';
    }
    h += '<div class="tbl-scroll"><table class="review-tbl"><thead><tr>' +
      '<th>#</th><th>Clearing</th><th>Community</th><th>Paths</th><th>Control</th><th>Marks</th><th>War</th><th>Details</th>' +
      '</tr></thead><tbody>';
    state.clearings.forEach((c, i) => {
      const marks = [c.ruin ? 'ruin' : '', c.stronghold ? 'stronghold' : '', c.roost ? 'Roost' : '', c.base ? 'base' : '', (c.structures || []).join(', '),
        c.hoard ? 'hoard ' + c.hoard : '', c.sympathy ? 'sympathy' : '', c.contested ? 'contested' : '', (c.presence || []).length ? 'presence: ' + c.presence.map(f => f.replace('The ', '')).join('/') : ''].filter(Boolean).join(', ');
      const details = [c.inhabitants.join(', '), c.buildings.join(', '), c.problems.join(', ')].filter(Boolean).join(' · ');
      h += '<tr><td>' + (i + 1) + '</td><td><b>' + esc(c.name) + '</b></td><td>' + esc(c.community) + '</td><td>' + c.paths + '</td>' +
        '<td>' + esc(c.control || DENIZEN) + '</td><td>' + esc(marks || '—') + '</td><td>' + esc(c.war || '—') + '</td><td>' + esc(details || '—') + '</td></tr>';
    });
    h += '</tbody></table></div>';
    h += '<label class="field" style="margin-top:16px"><span class="lbl">Notes</span><textarea data-notes placeholder="History, contested clearings, anything else.">' + esc(state.notes) + '</textarea></label>';
    h += '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:8px">' +
      '<button class="btn" id="dl">⬇ Export Woodland JSON</button>' +
      '<button class="btn ghost" id="copy">Copy to clipboard</button>' +
      '<button class="btn ghost" id="reset">Start over</button></div>';
    bodyEl.innerHTML = h;
    const ta = bodyEl.querySelector('[data-notes]'); ta.addEventListener('input', () => { state.notes = ta.value; save(); });
    document.getElementById('dl').addEventListener('click', exportWoodland);
    document.getElementById('copy').addEventListener('click', copyWoodland);
    document.getElementById('reset').addEventListener('click', () => {
      if (confirm('Discard this Woodland and start over?')) { state = fresh(); stepIdx = 0; save(); render(); }
    });
  }

  // ---------- Export / Import ----------
  function fileName() { return 'bellum-arborem-woodland.json'; }
  function exportWoodland() {
    const blob = new Blob([JSON.stringify(strip(), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob); const a = document.createElement('a');
    a.href = url; a.download = fileName(); document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000); toast('Exported ' + fileName());
  }
  function copyWoodland() {
    const s = JSON.stringify(strip(), null, 2);
    if (navigator.clipboard) navigator.clipboard.writeText(s).then(() => toast('Copied to clipboard'), () => toast('Copy failed'));
    else toast('Clipboard unavailable');
  }
  exportBtn.addEventListener('click', exportWoodland);
  importBtn.addEventListener('click', () => importFile.click());
  importFile.addEventListener('change', () => {
    const f = importFile.files[0]; if (!f) return;
    const rd = new FileReader(); rd.onload = () => { loadWoodland(rd.result); importFile.value = ''; }; rd.readAsText(f);
  });
  function loadWoodland(text) {
    let data; try { data = JSON.parse(text); } catch (e) { toast('That file is not valid JSON.'); return; }
    if (!data || data._format !== 'bellum-arborem.woodland') {
      if (!confirm('This does not look like a Bellum Arborem Woodland. Import anyway?')) return;
    }
    state = Object.assign(fresh(), data); state.draft = null;
    if (!Array.isArray(state.clearings)) state.clearings = [];
    if (!Array.isArray(state.edges)) state.edges = [];
    const ids = new Set(state.clearings.map(c => c.id));
    state.edges = state.edges.filter(e => Array.isArray(e) && ids.has(e[0]) && ids.has(e[1]));
    state.clearings.forEach(c => { if (!c._roll) c._roll = {}; ['inhabitants', 'buildings', 'problems', 'presence', 'structures'].forEach(k => { if (!Array.isArray(c[k])) c[k] = []; }); if (typeof c.onWater !== 'boolean') c.onWater = false; if (typeof c.ruin !== 'boolean') c.ruin = false; if (typeof c.hoard !== 'number') c.hoard = 0; });
    ensurePositions();
    stepIdx = STEPS.length; render(); stepIdx = STEPS.length - 1; goto(stepIdx);
    toast('Imported Woodland (' + state.clearings.length + ' clearings)');
  }

  // ---------- Boot ----------
  (function boot() {
    let restored = false;
    try {
      const wip = localStorage.getItem(STORE_KEY);
      if (wip) { const data = JSON.parse(wip); if (data && Array.isArray(data.clearings) && (data.clearings.length || (data.factions && data.factions.length))) { state = Object.assign(fresh(), data); state.draft = null; restored = true; } }
    } catch (e) {}
    render();
    if (restored) toast('Restored your work in progress');
  })();
})();
