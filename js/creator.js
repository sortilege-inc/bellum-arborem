/* Bellum Arborem — Character Creator
   Consumes window.ROOT_RULES (see data/root-rules.js). Self-contained, no framework. */
(function () {
  'use strict';

  const R = window.ROOT_RULES;
  const bodyEl = document.getElementById('stepBody');
  const stepsEl = document.getElementById('steps');
  const backBtn = document.getElementById('backBtn');
  const nextBtn = document.getElementById('nextBtn');
  const exportBtn = document.getElementById('exportBtn');
  const importBtn = document.getElementById('importBtn');
  const importFile = document.getElementById('importFile');
  const toastEl = document.getElementById('toast');
  const STORE_KEY = 'bellum-arborem.character.wip';

  // ---- Guard: rules must load ----
  if (!R || !Array.isArray(R.playbooks) || !R.playbooks.length) {
    bodyEl.innerHTML =
      '<div class="loaderr"><b>Ruleset failed to load.</b> Make sure <code>data/root-rules.js</code> ' +
      'exists next to this page (run <code>node data/build-rules.mjs</code> to generate it from ' +
      '<code>data/root-rules.json</code>).</div>';
    document.querySelector('.navbtns').classList.add('hidden');
    return;
  }

  // ---------- State ----------
  function newCharacter() {
    return {
      _format: 'bellum-arborem.character', _version: 1, _app: 'Bellum Arborem',
      playbook: null,
      name: '', pronouns: '', demeanor: '', look: '', background: '',
      stats: {},
      statBoost: null,   // the stat given the creation +1 (baked into stats)
      nature: null,
      drives: [],
      moves: [],
      weaponSkills: [], roguishFeats: [], equipment: [],
      connections: [],
      reputation: {},
      harm: { Injury: 0, Exhaustion: 0, Depletion: 0 },
      value: 0, load: 0,
      notes: ''
    };
  }

  let state = newCharacter();
  let stepIdx = 0;

  // ---------- Helpers ----------
  const stats = R.stats || ['Charm', 'Cunning', 'Finesse', 'Luck', 'Might'];
  const factions = (R.factions || []).map(f => f.name);

  function pb() { return R.playbooks.find(p => p.name === state.playbook) || null; }
  function driveCount() { const p = pb(); return p && p.driveChoose != null ? p.driveChoose : 2; }
  function natureCount() { const p = pb(); return p && p.natureChoose != null ? p.natureChoose : 1; }
  function moveCount() { const p = pb(); return p && p.playbookMovesChoose != null ? p.playbookMovesChoose : 2; }
  function weaponOptions() { const p = pb(); return (p && p.weaponSkills && p.weaponSkills.options) || []; }
  function weaponChoose() { const p = pb(); return (p && p.weaponSkills && p.weaponSkills.choose) || 0; }
  function weaponsChosen() { return state.weaponSkills.length; }
  function grantedFeats() { const p = pb(); return (p && p.startingRoguishFeats) || []; }
  function featChoose() { const p = pb(); return (p && p.roguishFeatsChoose) || 0; }
  function featExtras() { const g = grantedFeats(); return state.roguishFeats.filter(f => g.indexOf(f) < 0).length; }
  const STAT_BOOST_MAX = 2; // creation +1 may not raise a stat above +2
  function canBoost(s) { return state.statBoost !== s && state.stats[s] < STAT_BOOST_MAX; }
  function setBoost(s) {
    if (state.statBoost === s) { state.stats[s] -= 1; state.statBoost = null; return; } // toggle off
    if (state.stats[s] >= STAT_BOOST_MAX) return;                                        // would exceed +2
    if (state.statBoost) state.stats[state.statBoost] -= 1;                              // move the +1
    state.stats[s] += 1; state.statBoost = s;
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function fmtStat(n) { return (n >= 0 ? '+' : '') + n; }

  function save() { try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) {} }
  function toast(msg) {
    toastEl.textContent = msg; toastEl.classList.add('show');
    clearTimeout(toast._t); toast._t = setTimeout(() => toastEl.classList.remove('show'), 2200);
  }

  // Apply a playbook: seed stats, starting gear, connections, reputation. Resets dependent picks.
  function applyPlaybook(name) {
    const p = R.playbooks.find(x => x.name === name);
    if (!p) return;
    state.playbook = name;
    state.stats = {};
    stats.forEach(s => { state.stats[s] = (p.stats && p.stats[s] != null) ? p.stats[s] : 0; });
    state.statBoost = null;
    state.nature = null;
    state.drives = [];
    state.moves = [];
    state.weaponSkills = [];                                    // chosen from playbook options
    state.roguishFeats = (p.startingRoguishFeats || []).slice(); // granted (locked) + chosen extras
    state.equipment = [];
    state.value = p.startingValue || 0;
    state.load = 0;
    state.connections = (p.connections || []).map(prompt => ({ prompt, answer: '' }));
    // Reputation: start every faction at neutral unless already present
    const rep = {};
    factions.forEach(f => { rep[f] = state.reputation[f] || { status: 0, prestige: 0, notoriety: 0 }; });
    state.reputation = rep;
    exportBtn.disabled = false;
  }

  // ---------- Steps ----------
  const STEPS = [
    { id: 'playbook', label: 'Playbook', render: renderPlaybook, valid: () => !!state.playbook },
    { id: 'identity', label: 'Identity', render: renderIdentity, valid: () => state.name.trim().length > 0 },
    { id: 'stats', label: 'Stats', render: renderStats, valid: () => !!state.statBoost },
    { id: 'nature', label: 'Nature', render: renderNature, valid: () => !!state.nature },
    { id: 'drives', label: 'Drives', render: renderDrives, valid: () => state.drives.length === driveCount() },
    { id: 'moves', label: 'Moves', render: renderMoves, valid: () => state.moves.length === moveCount() },
    { id: 'gear', label: 'Skills & Gear', render: renderGear, valid: () => weaponsChosen() === weaponChoose() && featExtras() === featChoose() },
    { id: 'connections', label: 'Connections', render: renderConnections, valid: () => true },
    { id: 'reputation', label: 'Reputation', render: renderReputation, valid: () => true },
    { id: 'review', label: 'Review', render: renderReview, valid: () => true }
  ];

  function renderSteps() {
    stepsEl.innerHTML = '';
    STEPS.forEach((st, i) => {
      const pip = document.createElement('button');
      pip.className = 'step-pip' + (i === stepIdx ? ' active' : '') +
        (i < stepIdx && st.valid() ? ' done' : '');
      pip.innerHTML = '<span class="n">' + (i + 1) + '</span>' + esc(st.label);
      pip.disabled = i > 0 && !state.playbook; // must pick a playbook first
      pip.addEventListener('click', () => goto(i));
      stepsEl.appendChild(pip);
    });
  }

  function render() {
    const st = STEPS[stepIdx];
    bodyEl.innerHTML = '';
    st.render();
    renderSteps();
    backBtn.disabled = stepIdx === 0;
    nextBtn.classList.toggle('hidden', stepIdx === STEPS.length - 1);
    nextBtn.textContent = 'Next →';
    save();
  }

  function goto(i) {
    if (i < 0 || i >= STEPS.length) return;
    if (i > 0 && !state.playbook) { toast('Choose a playbook first.'); return; }
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
      case 'playbook': return 'Choose a playbook to continue.';
      case 'identity': return 'Give your vagabond a name.';
      case 'stats': return 'Add your +1 to one stat (tap a stat).';
      case 'nature': return 'Choose ' + natureCount() + ' nature.';
      case 'drives': return 'Choose exactly ' + driveCount() + ' drives.';
      case 'moves': return 'Choose exactly ' + moveCount() + ' playbook moves.';
      case 'gear': {
        const w = weaponChoose() - weaponsChosen(), f = featChoose() - featExtras();
        const parts = [];
        if (w > 0) parts.push('choose ' + w + ' more weapon skill' + (w > 1 ? 's' : ''));
        if (f > 0) parts.push('choose ' + f + ' more roguish feat' + (f > 1 ? 's' : ''));
        return 'Still to do: ' + (parts.join(' and ') || 'adjust your selections') + '.';
      }
      default: return 'Please complete this step.';
    }
  }

  // ---------- Renderers ----------
  function heading(title, intro) {
    return '<h2>' + esc(title) + '</h2>' + (intro ? '<p class="step-intro">' + intro + '</p>' : '');
  }

  function renderPlaybook() {
    let h = heading('Choose your playbook',
      'Your playbook is the heart of your vagabond — it sets your starting stats, moves, and gear. ' +
      'Pick the one that calls to you.');
    h += '<div class="grid">';
    R.playbooks.forEach(p => {
      const on = state.playbook === p.name;
      const spread = stats.map(s => '<span class="tag" style="margin:2px 3px 0 0">' + s.slice(0, 3) +
        ' ' + fmtStat(p.stats ? p.stats[s] : 0) + '</span>').join('');
      const desc = firstSentence(p.blurb || (p.stats ? '' : ''));
      h += '<div class="card selectable' + (on ? ' selected' : '') + '" data-pb="' + esc(p.name) + '">' +
        '<h3 style="margin:0 0 6px;color:var(--accent-dk)">' + esc(p.name) + '</h3>' +
        '<p class="muted small" style="margin:0 0 10px">' + esc(desc) + '</p>' +
        '<div>' + spread + '</div></div>';
    });
    h += '</div>';
    bodyEl.innerHTML = h;
    bodyEl.querySelectorAll('[data-pb]').forEach(el => el.addEventListener('click', () => {
      const name = el.getAttribute('data-pb');
      if (state.playbook && state.playbook !== name &&
        (state.nature || state.drives.length || state.moves.length)) {
        if (!confirm('Switching playbooks will reset your nature, drives, moves, and starting gear. Continue?')) return;
      }
      applyPlaybook(name);
      render();
    }));
  }

  function firstSentence(txt) {
    if (!txt) return 'A vagabond of the Woodland.';
    const t = String(txt).trim();
    const m = t.match(/^[^.!?]*[.!?]/);
    let s = m ? m[0] : t;
    if (s.length > 180) s = s.slice(0, 177) + '…';
    return s;
  }

  function renderIdentity() {
    bodyEl.innerHTML = heading('Who are they?',
      'Name your vagabond and sketch their look and demeanor. Only a name is required.') +
      field('Name', 'name', 'text', state.name, 'e.g. Bramble, Quill, Old Ferro') +
      field('Pronouns', 'pronouns', 'text', state.pronouns, 'e.g. she/her, they/them') +
      field('Demeanor', 'demeanor', 'text', state.demeanor, 'How do they carry themselves?') +
      field('Look', 'look', 'area', state.look, 'Species, dress, scars, the details others notice.') +
      field('Background', 'background', 'area', state.background, 'Where do they come from? Optional.');
    bindFields();
  }

  function field(label, key, type, val, ph) {
    const input = type === 'area'
      ? '<textarea data-k="' + key + '" placeholder="' + esc(ph) + '">' + esc(val) + '</textarea>'
      : '<input type="text" data-k="' + key + '" value="' + esc(val) + '" placeholder="' + esc(ph) + '">';
    return '<label class="field"><span class="lbl">' + esc(label) + '</span>' + input + '</label>';
  }
  function bindFields() {
    bodyEl.querySelectorAll('[data-k]').forEach(el => el.addEventListener('input', () => {
      state[el.getAttribute('data-k')] = el.value; save();
    }));
  }

  function renderStats() {
    const p = pb();
    let h = heading('Starting stats',
      'Your playbook sets your starting spread, then <b>add +1 to one stat</b> (it can’t go above +2). ' +
      'You roll <b>2d6 + stat</b> for moves (10+ strong hit, 7–9 weak hit, 6− miss).');
    h += '<div class="stat-row">';
    stats.forEach(s => {
      const v = state.stats[s];
      const boosted = state.statBoost === s;
      const locked = !boosted && v >= STAT_BOOST_MAX; // already +2 (or higher): can't take the +1
      h += '<div class="stat selectable' + (boosted ? ' selected' : '') + (locked ? ' disabled' : '') +
        '" data-boost="' + esc(s) + '"' + (locked ? ' title="Already at +2"' : '') + '>' +
        '<div class="name">' + esc(s) + '</div>' +
        '<div class="val ' + (v >= 0 ? 'pos' : '') + '">' + (v < 0 ? '−' + Math.abs(v) : v) + '</div>' +
        (boosted ? '<div class="boost-tag">+1</div>' : '') + '</div>';
    });
    h += '</div>';
    const cls = state.statBoost ? 'met' : '';
    h += '<p class="small" style="margin-top:14px"><span class="counter ' + cls + '">' +
      (state.statBoost ? '+1 added to ' + esc(state.statBoost) : 'Choose a stat to raise by +1') +
      '</span> <span class="muted">— tap a stat above. Spread for <b>' + esc(p.name) + '</b>.</span></p>';
    bodyEl.innerHTML = h;
    bodyEl.querySelectorAll('[data-boost]').forEach(el => el.addEventListener('click', () => {
      const s = el.getAttribute('data-boost');
      if (!boostableClick(s)) { toast(s + ' is already at +2.'); return; }
      setBoost(s); render();
    }));
  }
  function boostableClick(s) { return state.statBoost === s || state.stats[s] < STAT_BOOST_MAX; }

  function renderNature() {
    const p = pb();
    const list = p.natures || R.natures || [];
    let h = heading('Choose your nature',
      'Your nature is who you are at your core. Clear all your exhaustion when you act in accordance ' +
      'with it under its condition. Choose <b>' + natureCount() + '</b>.');
    h += '<div class="picklist">';
    list.forEach(n => {
      const on = state.nature === n.name;
      h += pickRow('radio', on, n.name, n.condition, 'nat', n.name);
    });
    h += '</div>';
    bodyEl.innerHTML = h;
    bodyEl.querySelectorAll('[data-nat]').forEach(el => el.addEventListener('click', () => {
      state.nature = el.getAttribute('data-nat'); render();
    }));
  }

  function renderDrives() {
    const p = pb();
    const list = p.drives || R.drives || [];
    const need = driveCount();
    const cls = state.drives.length === need ? 'met' : (state.drives.length > need ? 'over' : '');
    let h = heading('Choose your drives',
      'Drives are what pull your vagabond forward. Marking a drive can earn advancement. ' +
      'Choose <b>' + need + '</b>. <span class="counter ' + cls + '">' + state.drives.length + '/' + need + '</span>');
    h += '<div class="picklist">';
    list.forEach(d => {
      const on = state.drives.indexOf(d.name) >= 0;
      const full = !on && state.drives.length >= need;
      h += pickRow('check', on, d.name, d.condition, 'drv', d.name, full);
    });
    h += '</div>';
    bodyEl.innerHTML = h;
    bodyEl.querySelectorAll('[data-drv]').forEach(el => el.addEventListener('click', () => {
      if (el.classList.contains('disabled')) return;
      const name = el.getAttribute('data-drv');
      const i = state.drives.indexOf(name);
      if (i >= 0) state.drives.splice(i, 1);
      else if (state.drives.length < need) state.drives.push(name);
      render();
    }));
  }

  function pickRow(kind, on, title, sub, attr, val, disabled) {
    return '<div class="pick ' + (kind === 'radio' ? 'radio' : '') + (on ? ' on' : '') +
      (disabled ? ' disabled' : '') + '" data-' + attr + '="' + esc(val) + '">' +
      '<span class="mark"></span>' +
      '<div class="p-title">' + esc(title) + '</div>' +
      (sub ? '<div class="p-sub">' + esc(sub) + '</div>' : '') + '</div>';
  }

  function renderMoves() {
    const p = pb();
    const list = p.playbookMoves || [];
    const need = moveCount();
    const cls = state.moves.length === need ? 'met' : (state.moves.length > need ? 'over' : '');
    let h = heading('Choose your playbook moves',
      'These are the special moves only your playbook can grant. Choose <b>' + need + '</b>. ' +
      '<span class="counter ' + cls + '">' + state.moves.length + '/' + need + '</span>');
    h += '<div class="picklist">';
    list.forEach(m => {
      const on = state.moves.indexOf(m.name) >= 0;
      const full = !on && state.moves.length >= need;
      h += '<div class="pick' + (on ? ' on' : '') + (full ? ' disabled' : '') + '" data-mv="' + esc(m.name) + '">' +
        '<span class="mark"></span>' +
        '<div class="p-title">' + esc(m.name) + '</div>' +
        moveInner(m) + '</div>';
    });
    h += '</div>';
    // Basic moves reference
    const basics = (R.basicMoves || []).filter(m => (m.category || 'Basic') === 'Basic');
    if (basics.length) {
      h += '<details style="margin-top:20px"><summary class="eyebrow" style="cursor:pointer">' +
        'Basic moves you always have (' + basics.length + ')</summary>' +
        '<div class="picklist" style="margin-top:12px">' +
        basics.map(m => '<div class="move">' + '<div class="m-name">' + esc(m.name) + '</div>' +
          moveInner(m) + '</div>').join('') + '</div></details>';
    }
    bodyEl.innerHTML = h;
    bodyEl.querySelectorAll('[data-mv]').forEach(el => el.addEventListener('click', (ev) => {
      if (ev.target.tagName === 'SUMMARY') return;
      if (el.classList.contains('disabled')) return;
      const name = el.getAttribute('data-mv');
      const i = state.moves.indexOf(name);
      if (i >= 0) state.moves.splice(i, 1);
      else if (state.moves.length < need) state.moves.push(name);
      render();
    }));
  }

  function moveInner(m) {
    let h = '';
    if (m.trigger) h += '<div class="m-trigger">' + esc(m.trigger) + '</div>';
    if (m.outcomes) {
      Object.keys(m.outcomes).forEach(k => {
        h += '<div class="m-tier"><b>' + esc(k) + '</b> ' + esc(m.outcomes[k]) + '</div>';
      });
    }
    if (m.options && m.options.length) {
      h += '<ul class="m-opts">' + m.options.map(o => '<li>' + esc(o) + '</li>').join('') + '</ul>';
    }
    if (m.notes) h += '<div class="m-notes">' + esc(m.notes) + '</div>';
    return h;
  }

  function renderGear() {
    const p = pb();
    const wChoose = weaponChoose(), granted = grantedFeats(), fChoose = featChoose();
    let h = heading('Skills & gear',
      'Choose the weapon skill and roguish feats your vagabond starts with, then spend your ' +
      'Value on equipment.');

    // --- Weapon skills: choose N of options (some playbooks grant no weapon-skill choice) ---
    if (wChoose > 0 && weaponOptions().length) {
      const wCls = weaponsChosen() === wChoose ? 'met' : (weaponsChosen() > wChoose ? 'over' : '');
      h += '<dt class="eyebrow" style="display:block;margin:6px 0 8px">Weapon skill — choose ' + wChoose +
        ' <span class="counter ' + wCls + '">' + weaponsChosen() + '/' + wChoose + '</span></dt>';
      h += '<div class="picklist">';
      weaponOptions().forEach(name => {
        const on = state.weaponSkills.indexOf(name) >= 0;
        const full = wChoose > 1 && !on && weaponsChosen() >= wChoose; // choose-1 acts as radio (replace)
        h += pickRow(wChoose === 1 ? 'radio' : 'check', on, name, '', 'wsk', name, full);
      });
      h += '</div>';
    } else {
      h += '<dt class="eyebrow" style="display:block;margin:6px 0 8px">Weapon skill</dt>' +
        '<p class="muted small">This playbook grants no starting weapon-skill choice.</p>';
    }

    // --- Roguish feats: granted (locked) + choose extras ---
    h += '<dt class="eyebrow" style="display:block;margin:18px 0 8px">Roguish feats' +
      (fChoose ? ' — choose ' + fChoose + ' more <span class="counter ' +
        (featExtras() === fChoose ? 'met' : featExtras() > fChoose ? 'over' : '') + '">' + featExtras() + '/' + fChoose + '</span>' : '') +
      '</dt>';
    const feats = R.roguishFeats || [];
    if (!feats.length) h += '<p class="muted small">No roguish feats in the ruleset.</p>';
    else {
      h += '<div class="picklist">';
      feats.forEach(f => {
        const isGranted = granted.indexOf(f.name) >= 0;
        const on = state.roguishFeats.indexOf(f.name) >= 0;
        const full = !on && !isGranted && featExtras() >= fChoose;
        const disabled = isGranted || full || (fChoose === 0 && !isGranted);
        const sub = (f.description || '') + (f.risks && f.risks.length ? '  ⚠ ' + f.risks.join('; ') : '');
        h += '<div class="pick' + (on ? ' on' : '') + (disabled ? ' disabled' : '') + '" data-feat="' + esc(f.name) + '">' +
          '<span class="mark"></span>' +
          '<div class="p-title">' + esc(f.name) + (isGranted ? ' <span class="tag" style="font-size:9px">granted</span>' : '') + '</div>' +
          (sub ? '<div class="p-sub">' + esc(sub) + '</div>' : '') + '</div>';
      });
      h += '</div>';
    }

    // --- Value & equipment ---
    const spent = state.equipment.reduce((s, n) => { const e = (R.equipment || []).find(x => x.name === n); return s + ((e && e.value) || 0); }, 0);
    const load = state.equipment.reduce((s, n) => { const e = (R.equipment || []).find(x => x.name === n); return s + ((e && e.load) || 0); }, 0);
    const over = spent > (p.startingValue || 0);
    h += '<dt class="eyebrow" style="display:block;margin:18px 0 8px">Equipment — Starting Value ' + (p.startingValue || 0) + '</dt>';
    h += '<p class="small muted" style="margin:0 0 10px">Spent <b style="color:' + (over ? 'var(--bad)' : 'var(--ink)') + '">' +
      spent + '</b> of ' + (p.startingValue || 0) + ' Value · Load ' + load + '. Buying gear is optional — your GM has final say.</p>';
    h += '<div class="picklist">';
    (R.equipment || []).forEach(e => {
      const on = state.equipment.indexOf(e.name) >= 0;
      h += '<div class="pick' + (on ? ' on' : '') + '" data-eq="' + esc(e.name) + '"><span class="mark"></span>' +
        '<div class="p-title">' + esc(e.name) + '</div>' +
        '<div class="p-sub">' + esc(equipMetaText(e)) + '</div></div>';
    });
    h += '</div>';

    bodyEl.innerHTML = h;
    bodyEl.querySelectorAll('[data-wsk]').forEach(el => el.addEventListener('click', () => {
      if (el.classList.contains('disabled')) return;
      const name = el.getAttribute('data-wsk'), i = state.weaponSkills.indexOf(name);
      if (i >= 0) state.weaponSkills.splice(i, 1);
      else if (wChoose === 1) state.weaponSkills = [name];
      else if (weaponsChosen() < wChoose) state.weaponSkills.push(name);
      render();
    }));
    bodyEl.querySelectorAll('[data-feat]').forEach(el => el.addEventListener('click', () => {
      if (el.classList.contains('disabled')) return;
      const name = el.getAttribute('data-feat'), i = state.roguishFeats.indexOf(name);
      if (i >= 0) { if (granted.indexOf(name) >= 0) return; state.roguishFeats.splice(i, 1); }
      else if (featExtras() < fChoose) state.roguishFeats.push(name);
      render();
    }));
    bodyEl.querySelectorAll('[data-eq]').forEach(el => el.addEventListener('click', () => {
      const name = el.getAttribute('data-eq'), i = state.equipment.indexOf(name);
      if (i >= 0) state.equipment.splice(i, 1); else state.equipment.push(name);
      state.load = state.equipment.reduce((s, n) => { const e = (R.equipment || []).find(x => x.name === n); return s + ((e && e.load) || 0); }, 0);
      render();
    }));
  }

  function equipMetaText(e) {
    const bits = [];
    if (e.value != null) bits.push('Value ' + e.value);
    if (e.load != null) bits.push('Load ' + e.load);
    if (e.range) bits.push(e.range);
    if (e.tags && e.tags.length) bits.push(e.tags.join(', '));
    return bits.join(' · ') + (e.description ? ' — ' + e.description : '');
  }

  function equipMeta(e) {
    const bits = [];
    if (e.value != null) bits.push('Value ' + e.value);
    if (e.load != null) bits.push('Load ' + e.load);
    if (e.wear != null) bits.push('Wear ' + e.wear);
    if (e.range) bits.push(esc(e.range));
    if (e.tags && e.tags.length) bits.push(e.tags.map(esc).join(', '));
    let h = bits.length ? '<div class="m-tier muted">' + bits.join(' · ') + '</div>' : '';
    if (e.description) h += '<div class="m-notes">' + esc(e.description) + '</div>';
    return h;
  }

  function listBlock(label, arr) {
    let h = '<dt class="eyebrow" style="display:block;margin:18px 0 8px">' + esc(label) + '</dt>';
    if (!arr || !arr.length) return h + '<p class="muted small">None.</p>';
    h += '<div>' + arr.map(x => '<span class="tag" style="margin:0 6px 6px 0">' + esc(x) + '</span>').join('') + '</div>';
    return h;
  }

  function renderConnections() {
    let h = heading('Connections',
      'Connections tie you to the other vagabonds in your band. Fill in the blanks with another ' +
      'player\'s character (or leave them for the table). Optional now — you can finish these together.');
    if (!state.connections.length) h += '<p class="muted">This playbook lists no connection prompts.</p>';
    h += '<div class="picklist">';
    state.connections.forEach((c, i) => {
      const parts = splitConnection(c.prompt);
      h += '<div class="conn">' +
        (parts.name ? '<div class="conn-name">' + esc(parts.name) + '</div>' : '') +
        '<p class="conn-prompt">' + esc(parts.text) + '</p>' +
        '<input type="text" data-conn="' + i + '" value="' + esc(c.answer) + '" placeholder="Who fills the blank — and the answer"></div>';
    });
    h += '</div>';
    bodyEl.innerHTML = h;
    bodyEl.querySelectorAll('[data-conn]').forEach(el => el.addEventListener('input', () => {
      state.connections[+el.getAttribute('data-conn')].answer = el.value; save();
    }));
  }
  // Connection prompts read "Name: explanation with ___ blanks" — split the label from the text.
  function splitConnection(prompt) {
    const m = String(prompt || '').match(/^([^:]{1,40}):\s*([\s\S]+)$/);
    return m ? { name: m[1].trim(), text: m[2].trim() } : { name: '', text: String(prompt || '') };
  }

  function renderReputation() {
    let h = heading('Faction reputation',
      'Your standing with the Woodland\'s powers, from −3 to +3. Most vagabonds begin neutral; ' +
      'adjust if your playbook or table says otherwise.');
    h += '<div class="panel" style="padding:8px 18px;background:var(--cream-hi)">';
    factions.forEach(f => {
      const r = state.reputation[f] || { status: 0 };
      const cls = tagClass(f);
      h += '<div class="rep-row">' +
        '<div class="rep-name"><span class="tag ' + cls + '">' + esc(f) + '</span></div>' +
        '<div class="stepper">' +
        '<button data-rep="' + esc(f) + '" data-d="-1">−</button>' +
        '<span class="v ' + (r.status >= 0 ? 'pos' : '') + '">' + (r.status < 0 ? '−' + Math.abs(r.status) : r.status) + '</span>' +
        '<button data-rep="' + esc(f) + '" data-d="1">+</button>' +
        '</div></div>';
    });
    h += '</div>';
    if (R.reputationScale && R.reputationScale.length) {
      h += '<details style="margin-top:16px"><summary class="eyebrow" style="cursor:pointer">Reputation scale</summary>' +
        '<div class="small" style="margin-top:10px">' +
        R.reputationScale.map(s => '<div class="m-tier"><b>' + fmtStat(s.status) + '</b> ' +
          esc(s.label || '') + (s.effect ? ' — ' + esc(s.effect) : '') + '</div>').join('') +
        '</div></details>';
    }
    bodyEl.innerHTML = h;
    bodyEl.querySelectorAll('[data-rep]').forEach(el => el.addEventListener('click', () => {
      const f = el.getAttribute('data-rep'); const d = +el.getAttribute('data-d');
      const r = state.reputation[f] || { status: 0, prestige: 0, notoriety: 0 };
      r.status = Math.max(-3, Math.min(3, r.status + d));
      state.reputation[f] = r; render();
    }));
  }

  function tagClass(f) {
    const s = f.toLowerCase();
    if (s.indexOf('marqu') >= 0) return 'marquise';
    if (s.indexOf('eyrie') >= 0) return 'eyrie';
    if (s.indexOf('alliance') >= 0) return 'alliance';
    if (s.indexOf('vagabond') >= 0) return 'vagabond';
    return '';
  }

  function renderReview() {
    const p = pb();
    const missing = [];
    if (!state.name.trim()) missing.push('a name');
    if (!state.statBoost) missing.push('your +1 stat');
    if (!state.nature) missing.push('a nature');
    if (state.drives.length !== driveCount()) missing.push(driveCount() + ' drives');
    if (state.moves.length !== moveCount()) missing.push(moveCount() + ' playbook moves');
    if (weaponsChosen() !== weaponChoose()) missing.push(weaponChoose() + ' weapon skill');
    if (featExtras() !== featChoose()) missing.push(featChoose() + ' chosen roguish feats');

    let h = heading('Review & export',
      'Give your vagabond a last look, then export them as a JSON file to bring to the table.');
    if (missing.length) {
      h += '<div class="loaderr" style="border-color:var(--accent-dk);background:#f8ecd6;color:var(--accent-dk)">' +
        'Still to do: ' + missing.map(esc).join(', ') + '. You can export anyway as a work in progress.</div>';
    }
    h += '<div class="review">';
    h += row('Name', state.name + (state.pronouns ? ' (' + state.pronouns + ')' : ''));
    h += row('Playbook', p.name);
    h += row('Stats', stats.map(s => s + ' ' + fmtStat(state.stats[s]) + (state.statBoost === s ? ' (+1)' : '')).join('  ·  '));
    if (state.demeanor) h += row('Demeanor', state.demeanor);
    if (state.look) h += row('Look', state.look);
    if (state.background) h += row('Background', state.background);
    h += row('Nature', state.nature || '—');
    h += row('Drives', state.drives.join(', ') || '—');
    h += row('Playbook moves', state.moves.join(', ') || '—');
    h += row('Weapon skill', state.weaponSkills.join(', ') || '—');
    h += row('Roguish feats', state.roguishFeats.join(', ') || '—');
    const spent = state.equipment.reduce((s, n) => { const e = (R.equipment || []).find(x => x.name === n); return s + ((e && e.value) || 0); }, 0);
    h += row('Value', (p.startingValue || 0) + ' (spent ' + spent + ', load ' + (state.load || 0) + ')');
    h += row('Equipment', state.equipment.join(', ') || '—');
    const conns = state.connections.filter(c => c.answer.trim());
    if (conns.length) h += row('Connections', conns.map(c => c.answer).join('; '));
    h += row('Reputation', factions.map(f => f + ' ' + fmtStat((state.reputation[f] || {}).status || 0)).join('  ·  '));
    h += '</div>';
    h += '<label class="field" style="margin-top:18px"><span class="lbl">Notes</span>' +
      '<textarea data-k="notes" placeholder="Anything else to remember.">' + esc(state.notes) + '</textarea></label>';
    h += '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:8px">' +
      '<button class="btn" id="dl">⬇ Export character JSON</button>' +
      '<button class="btn ghost" id="copy">Copy to clipboard</button>' +
      '<button class="btn ghost" id="reset">Start over</button></div>';
    bodyEl.innerHTML = h;
    bindFields();
    document.getElementById('dl').addEventListener('click', exportChar);
    document.getElementById('copy').addEventListener('click', copyChar);
    document.getElementById('reset').addEventListener('click', () => {
      if (confirm('Discard this character and start over?')) {
        state = newCharacter(); exportBtn.disabled = true; stepIdx = 0; save(); render();
      }
    });
  }

  function row(dt, dd) { return '<dt>' + esc(dt) + '</dt><dd>' + esc(dd) + '</dd>'; }

  // ---------- Export / Import ----------
  function cleanChar() {
    const c = JSON.parse(JSON.stringify(state));
    return c;
  }
  function fileName() {
    const base = (state.name || 'vagabond').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'vagabond';
    return 'bellum-arborem-' + base + '.json';
  }
  function exportChar() {
    const data = JSON.stringify(cleanChar(), null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = fileName();
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('Exported ' + fileName());
  }
  function copyChar() {
    const data = JSON.stringify(cleanChar(), null, 2);
    if (navigator.clipboard) navigator.clipboard.writeText(data).then(() => toast('Copied to clipboard'),
      () => toast('Copy failed'));
    else toast('Clipboard unavailable');
  }

  exportBtn.addEventListener('click', exportChar);
  importBtn.addEventListener('click', () => importFile.click());
  importFile.addEventListener('change', () => {
    const f = importFile.files[0]; if (!f) return;
    const reader = new FileReader();
    reader.onload = () => { loadCharacter(reader.result); importFile.value = ''; };
    reader.readAsText(f);
  });

  function loadCharacter(text) {
    let data;
    try { data = JSON.parse(text); } catch (e) { toast('That file is not valid JSON.'); return; }
    if (!data || data._format !== 'bellum-arborem.character') {
      if (!confirm('This does not look like a Bellum Arborem character. Try to import anyway?')) return;
    }
    const fresh = newCharacter();
    state = Object.assign(fresh, data);
    // Normalize structures that must exist
    state.harm = Object.assign({ Injury: 0, Exhaustion: 0, Depletion: 0 }, data.harm || {});
    if (!Array.isArray(state.drives)) state.drives = [];
    if (!Array.isArray(state.moves)) state.moves = [];
    if (!Array.isArray(state.connections)) state.connections = [];
    if (!state.reputation) state.reputation = {};
    factions.forEach(f => { if (!state.reputation[f]) state.reputation[f] = { status: 0, prestige: 0, notoriety: 0 }; });
    if (state.playbook && !pb()) toast('Note: playbook "' + state.playbook + '" is not in the loaded ruleset.');
    exportBtn.disabled = !state.playbook;
    stepIdx = STEPS.length - 1; // jump to review
    save(); render();
    toast('Imported ' + (state.name || 'character'));
  }

  // ---------- Boot ----------
  (function boot() {
    let restored = false;
    try {
      const wip = localStorage.getItem(STORE_KEY);
      if (wip) {
        const data = JSON.parse(wip);
        if (data && data.playbook) {
          state = Object.assign(newCharacter(), data);
          exportBtn.disabled = false;
          restored = true;
        }
      }
    } catch (e) {}
    render();
    if (restored) toast('Restored your work in progress');
  })();

})();
