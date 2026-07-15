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
  const toastEl = document.getElementById('toast');
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
  function d6() { return Math.floor(Math.random() * 6) + 1; }
  function r2d6() { return d6() + d6(); }
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
      draft: null,
      uprisingDone: false,
      notes: ''
    };
  }
  let state = fresh();
  let stepIdx = 0;

  function newClearing(id, community, paths, name) {
    return {
      id, name, community, paths,
      control: null,            // faction name, DENIZEN, UNCONTROLLED, or null (unrolled = denizen-held)
      stronghold: false, roost: false, base: false,
      sympathy: false, contested: false,
      distMarq: '', distRoost: '',
      allianceState: null,
      war: null, warFactions: '',
      inhabitants: [], buildings: [], problems: [],
      _roll: {}
    };
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function save() { try { localStorage.setItem(STORE_KEY, JSON.stringify(strip())); } catch (e) {} }
  function strip() { const c = JSON.parse(JSON.stringify(state)); c.draft = null; return c; }
  function toast(m) { toastEl.textContent = m; toastEl.classList.add('show'); clearTimeout(toast._t); toast._t = setTimeout(() => toastEl.classList.remove('show'), 2400); }
  function selected(key) { const f = W.coreFactions.find(x => x.key === key); return f && state.factions.indexOf(f.name) >= 0; }
  function controlledBy(faction) { return state.clearings.filter(c => c.control === faction); }
  function nonStronghold(c) { return !c.stronghold; }

  // ---------- Steps (dynamic on faction selection) ----------
  function buildSteps() {
    const s = [
      { id: 'factions', label: 'Factions', render: renderFactions, valid: () => state.factions.length >= 2 && state.factions.length <= 3 },
      { id: 'map', label: 'Map', render: renderMap, valid: () => state.clearings.length === W.mapSize }
    ];
    if (selected('marquisate')) s.push({ id: 'marquisate', label: 'Marquisate', render: renderMarquisate, valid: () => controlledBy('The Marquisate').length > 0 });
    if (selected('eyrie')) s.push({ id: 'eyrie', label: 'Eyrie', render: renderEyrie, valid: () => controlledBy('The Eyrie Dynasties').length > 0 });
    if (selected('alliance')) s.push({ id: 'alliance', label: 'Alliance', render: renderAlliance, valid: () => true });
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
    const n = state.factions.length;
    h += '<p class="small ' + (n >= 2 && n <= 3 ? 'muted' : '') + '" style="margin-top:12px' + (n < 2 || n > 3 ? ';color:var(--rust)' : '') + '">' +
      n + ' of 2–3 factions selected.</p>';
    bodyEl.innerHTML = h;
    bodyEl.querySelectorAll('[data-fac]').forEach(el => el.addEventListener('click', () => {
      const name = el.getAttribute('data-fac');
      const i = state.factions.indexOf(name);
      if (i >= 0) state.factions.splice(i, 1);
      else if (state.factions.length < 3) state.factions.push(name);
      else { toast('At most three non-denizen factions.'); return; }
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
        '<button class="rm" data-del="' + i + '" title="Remove">✕</button></div>';
    });
    h += '</div>';
    bodyEl.innerHTML = h;
    wireMap();
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
          state.clearings.push(newClearing(id, d.community, d.paths, (d.name || '').trim() || 'Unnamed'));
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
      state.clearings.splice(+el.getAttribute('data-del'), 1);
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
    if (stronghold) {
      h += '<p class="rule-note">For each other clearing, enter how many <b>paths away from the stronghold</b> it sits, then roll. ' +
        'Distances of 5+ are never in Marquisate control.</p>';
      h += '<div class="clist">';
      state.clearings.forEach((c, i) => {
        if (c.stronghold) { h += marqRow(c, i, true); return; }
        h += marqRow(c, i, false);
      });
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
      const d = Math.max(1, +c.distMarq || 1);
      const bucket = W.tables.marquisateControl.byPaths.find(b => b.paths === Math.min(d, 5));
      const roll = r2d6();
      const inControl = bucket.controlMin != null && roll >= bucket.controlMin;
      c.control = inControl ? 'The Marquisate' : c.control;
      if (inControl && c.control !== 'The Marquisate') c.control = 'The Marquisate';
      if (!inControl && c.control === 'The Marquisate') c.control = null;
      c._roll.marq = { roll, d, inControl };
      render();
    }));
  }
  function marqRow(c, i, isStronghold) {
    if (isStronghold) return '<div class="crow"><span class="cname">' + esc(c.name) + '</span>' +
      '<span class="badge roost">Stronghold — controlled</span></div>';
    const rr = c._roll.marq;
    return '<div class="crow"><span class="cname">' + esc(c.name) + '</span>' +
      '<span class="dcount">paths away</span>' +
      '<input type="number" class="pths" min="1" max="9" data-marqdist="' + i + '" value="' + esc(c.distMarq) + '">' +
      '<button class="dice" data-marqroll="' + i + '">🎲 Roll 2d6</button>' +
      (rr ? '<span class="badge ' + (rr.inControl ? 'yes' : 'no') + '">' + rr.roll + ' → ' + (rr.inControl ? 'Marquisate' : 'not') + '</span>' : '') +
      (c.control && c.control !== 'The Marquisate' ? '<span class="badge no">' + esc(c.control) + '</span>' : '') + '</div>';
  }

  // ---------- Step: Eyrie ----------
  function renderEyrie() {
    const opp = state.corner.marquisate ? 'opposite the Marquisate stronghold' : '';
    let h = heading('Second: the Eyrie Dynasties', W.descriptions.eyrie, W.descriptions.woodlandCorner + (opp ? ' Choose the corner ' + opp + '.' : ''));
    h += cornerRoller('eyrie', opp);
    h += anchorPicker('Initial Roost clearing', 'roost', 'The Eyrie Dynasties');
    const anchor = state.clearings.find(c => c.roost);
    if (anchor) {
      const roosts = state.clearings.filter(c => c.roost).length;
      const ctrl = controlledBy('The Eyrie Dynasties').length;
      h += '<p class="rule-note">Enter each clearing’s <b>paths from the nearest Roost</b>, then roll. ' +
        'Max ' + W.tables.eyrieControl.maxRoosts + ' Roosts and ' + W.tables.eyrieControl.maxControlled + ' controlled clearings. ' +
        'The Marquisate stronghold is skipped.</p>';
      h += '<p class="small muted">Roosts placed: ' + roosts + '/' + W.tables.eyrieControl.maxRoosts +
        ' · Eyrie clearings: ' + ctrl + '/' + W.tables.eyrieControl.maxControlled + '</p>';
      h += '<div class="clist">';
      state.clearings.forEach((c, i) => {
        if (c.stronghold) return;
        if (c.roost && c === anchor) { h += '<div class="crow"><span class="cname">' + esc(c.name) + '</span><span class="badge roost">Initial Roost — controlled</span></div>'; return; }
        h += eyrieRow(c, i);
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
      const d = Math.max(1, +c.distRoost || 1);
      const bucket = W.tables.eyrieControl.byPaths.find(b => b.paths === Math.min(d, 4));
      const roll = r2d6();
      const controlledNow = controlledBy('The Eyrie Dynasties').length;
      const roostsNow = state.clearings.filter(x => x.roost).length;
      let outcome = 'not';
      if (bucket.roostMin != null && roll >= bucket.roostMin) outcome = 'roost';
      else if (bucket.controlMin != null && roll >= bucket.controlMin) outcome = 'control';
      // caps
      if (outcome !== 'not' && c.control !== 'The Eyrie Dynasties' && controlledNow >= W.tables.eyrieControl.maxControlled) {
        outcome = 'capped';
      }
      if (outcome === 'roost' && roostsNow >= W.tables.eyrieControl.maxRoosts && !c.roost) outcome = 'control';
      const seized = c.control && c.control !== 'The Eyrie Dynasties' && outcome !== 'not' && outcome !== 'capped';
      if (outcome === 'roost') { c.control = 'The Eyrie Dynasties'; c.roost = true; }
      else if (outcome === 'control') { c.control = 'The Eyrie Dynasties'; c.roost = false; }
      c._roll.eyrie = { roll, d, outcome, seized };
      render();
    }));
  }
  function eyrieRow(c, i) {
    const rr = c._roll.eyrie;
    let badge = '';
    if (rr) {
      const map = { not: ['no', 'not in control'], control: ['yes', 'Eyrie, no Roost'], roost: ['roost', 'Eyrie + Roost'], capped: ['no', 'cap reached'] };
      const m = map[rr.outcome];
      badge = '<span class="badge ' + m[0] + '">' + rr.roll + ' → ' + m[1] + (rr.seized ? ' (seized)' : '') + '</span>';
    }
    return '<div class="crow"><span class="cname">' + esc(c.name) + '</span>' +
      (c.control ? '<span class="badge ' + (c.control === 'The Eyrie Dynasties' ? 'yes' : 'no') + '">' + esc(c.control) + (c.roost ? ' ⌂' : '') + '</span>' : '') +
      '<span class="dcount">from Roost</span>' +
      '<input type="number" class="pths" min="1" max="9" data-eyriedist="' + i + '" value="' + esc(c.distRoost) + '">' +
      '<button class="dice" data-eyrieroll="' + i + '">🎲 Roll 2d6</button>' + badge + '</div>';
  }

  // ---------- Step: Alliance ----------
  function derivedState(c) {
    if (c.contested) return 'Contested';
    if (c.control && c.control !== DENIZEN && c.control !== UNCONTROLLED) return 'Controlled';
    return 'Uncontrolled';
  }
  function renderAlliance() {
    let h = heading('Third: the Woodland Alliance', W.descriptions.alliance, W.descriptions.uprising);
    h += '<p class="eyebrow" style="margin:4px 0 8px">1 · Sympathy</p><div class="clist">';
    state.clearings.forEach((c, i) => {
      const st = c.allianceState || derivedState(c);
      const rr = c._roll.symp;
      h += '<div class="crow"><span class="cname">' + esc(c.name) + '</span>' +
        '<select data-symstate="' + i + '" class="comm">' +
        ['Uncontrolled', 'Controlled', 'Contested'].map(s => '<option' + (s === st ? ' selected' : '') + '>' + s + '</option>').join('') + '</select>' +
        '<button class="dice" data-symroll="' + i + '">🎲 Roll 2d6</button>' +
        (rr ? '<span class="badge ' + (c.sympathy ? 'yes' : 'no') + '">' + rr.roll + ' → ' + (c.sympathy ? 'sympathy' : 'none') + '</span>' : '') +
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
          (rr ? '<span class="badge ' + (rr.uprising ? 'yes' : 'no') + '">' + rr.roll + ' → ' + esc(rr.short) + '</span>' : '') + '</div>';
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
        if (row.spread) c._roll.upr.short = 'Uprising + sympathy spreads';
        state.uprisingDone = true;
      } else { c.base = false; }
      render();
    }));
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
          (rr ? '<span class="badge ' + (rr.unc ? 'yes' : 'no') + '">' + rr.roll + ' → ' + (rr.unc ? 'uncontrolled' : 'holds') + '</span>' : '') + '</div>';
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
    h += '<div class="tbl-scroll"><table class="review-tbl"><thead><tr>' +
      '<th>#</th><th>Clearing</th><th>Community</th><th>Paths</th><th>Control</th><th>Marks</th><th>War</th><th>Details</th>' +
      '</tr></thead><tbody>';
    state.clearings.forEach((c, i) => {
      const marks = [c.stronghold ? 'stronghold' : '', c.roost ? 'Roost' : '', c.base ? 'base' : '', c.sympathy ? 'sympathy' : '', c.contested ? 'contested' : ''].filter(Boolean).join(', ');
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
    state.clearings.forEach(c => { if (!c._roll) c._roll = {}; ['inhabitants', 'buildings', 'problems'].forEach(k => { if (!Array.isArray(c[k])) c[k] = []; }); });
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
