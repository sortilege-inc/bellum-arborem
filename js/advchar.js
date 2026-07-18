/* Bellum Arborem — Advance Character
   Load a character JSON, set how many advancements they've earned, and spend
   them on legal advancement options. Consumes window.ROOT_RULES. */
(function () {
  'use strict';

  const R = window.ROOT_RULES;
  const app = document.getElementById('app');
  const toastEl = document.getElementById('toast');
  const importBtn = document.getElementById('importBtn');
  const importFile = document.getElementById('importFile');
  const saveBtn = document.getElementById('saveBtn');
  const STORE_KEY = 'bellum-arborem.advchar.wip';
  const CREATOR_KEY = 'bellum-arborem.character.wip';
  const PLAY_KEY = 'bellum-arborem.play.wip';
  const STATS = (R && R.stats) || ['Charm', 'Cunning', 'Finesse', 'Luck', 'Might'];
  const HARM = ['Injury', 'Exhaustion', 'Depletion'];

  let char = null;
  let sel = {}; // transient picker selections, keyed by option

  // ---------- utils ----------
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function fmt(n) { return (n >= 0 ? '+' : '') + n; }
  function toast(m) { toastEl.textContent = m; toastEl.classList.add('show'); clearTimeout(toast._t); toast._t = setTimeout(() => toastEl.classList.remove('show'), 2400); }
  function save() { if (char) try { localStorage.setItem(STORE_KEY, JSON.stringify(char)); } catch (e) {} }
  function pb() { return R.playbooks.find(p => p.name === (char && char.playbook)) || null; }

  // master list of choosable weapon skills (union across playbooks)
  const WEAPON_SKILLS = (() => { const s = new Set(); (R.playbooks || []).forEach(p => (p.weaponSkills && p.weaponSkills.options || []).forEach(w => s.add(w))); return [...s].sort(); })();

  function normalize(data) {
    const c = Object.assign({
      _format: 'bellum-arborem.character', playbook: null, name: '', species: '',
      stats: {}, moves: [], weaponSkills: [], roguishFeats: [], speciesMoves: [], connections: [],
      harm: {}, reputation: {}
    }, data || {});
    STATS.forEach(s => { if (typeof c.stats[s] !== 'number') c.stats[s] = 0; });
    HARM.forEach(h => { if (typeof c.harm[h] !== 'number') c.harm[h] = 0; });
    ['moves', 'weaponSkills', 'roguishFeats', 'speciesMoves', 'connections'].forEach(k => { if (!Array.isArray(c[k])) c[k] = []; });
    if (!Array.isArray(c.otherMoves)) c.otherMoves = [];       // moves from other playbooks {name, from}
    if (!Array.isArray(c.masteries)) c.masteries = [];         // mastery move names
    if (!Array.isArray(c.connectionsExtra)) c.connectionsExtra = [];
    if (!c.harmBoxes || typeof c.harmBoxes !== 'object') c.harmBoxes = { Injury: 0, Exhaustion: 0, Depletion: 0 };
    HARM.forEach(h => { if (typeof c.harmBoxes[h] !== 'number') c.harmBoxes[h] = 0; });
    if (!Array.isArray(c.advancements)) c.advancements = [];   // log of taken advancements
    if (typeof c.advancementsRemaining !== 'number') c.advancementsRemaining = 0;
    return c;
  }

  // ---------- move ownership (for masteries) ----------
  function ownedMoveNames() {
    const set = new Set();
    (R.basicMoves || []).forEach(m => set.add(m.name));
    (char.moves || []).forEach(n => set.add(n));
    (char.weaponSkills || []).forEach(n => set.add(n));
    (char.otherMoves || []).forEach(o => set.add(o.name));
    return set;
  }
  function speciesMatch(a, b) { a = (a || '').toLowerCase(); b = (b || '').toLowerCase(); return !!a && (a === b || b.indexOf(a) === 0 || a.indexOf(b) === 0); }
  function speciesMovesFor(spName) { return spName ? (R.speciesMoves || []).filter(m => (m.species || []).some(t => speciesMatch(spName, t))) : []; }

  // ---------- advancement options ----------
  function pbMovePool() { const p = pb(); return p ? (p.playbookMoves || []).filter(m => char.moves.indexOf(m.name) < 0) : []; }
  function otherMovePool() {
    const out = []; const mine = char.playbook;
    (R.playbooks || []).forEach(p => { if (p.name === mine) return; (p.playbookMoves || []).forEach(m => { if (!char.otherMoves.some(o => o.name === m.name)) out.push({ name: m.name, from: p.name, trigger: m.trigger }); }); });
    return out;
  }
  function weaponPool() { return WEAPON_SKILLS.filter(w => char.weaponSkills.indexOf(w) < 0); }
  function featPool() { return (R.roguishFeats || []).map(f => f.name).filter(n => char.roguishFeats.indexOf(n) < 0); }
  function masteryPool() { const owned = ownedMoveNames(); return (R.masteries || []).filter(m => owned.has(m.move) && char.masteries.indexOf(m.move) < 0); }
  function speciesMovePool() { return speciesMovesFor(char.species).map(m => m.name).filter(n => char.speciesMoves.indexOf(n) < 0); }

  const OPTIONS = [
    { key: 'stat', name: 'Take +1 to a stat', limit: 'to a max of +2',
      status: () => STATS.map(s => s + ' ' + fmt(char.stats[s])).join(' · '),
      legal: () => STATS.some(s => char.stats[s] < 2),
      desc: 'Add +1 to one of your stats (the most it reaches this way is +2; some moves can push it to +3).' },
    { key: 'pbmove', name: 'New move from your playbook', limit: 'max 5 from your own playbook',
      status: () => char.moves.length + '/5 taken',
      legal: () => char.moves.length < 5 && pbMovePool().length > 0,
      desc: 'Gain another move from your own playbook.' },
    { key: 'othermove', name: 'Move from another playbook', limit: 'max 2 from other playbooks',
      status: () => char.otherMoves.length + '/2 taken',
      legal: () => char.otherMoves.length < 2 && otherMovePool().length > 0,
      desc: 'Take a move from any other playbook.' },
    { key: 'weapon', name: 'Up to two weapon skills', limit: 'max 7 total',
      status: () => char.weaponSkills.length + '/7',
      legal: () => char.weaponSkills.length < 7 && weaponPool().length > 0,
      desc: 'Learn one or two new weapon skills.', multi: 2 },
    { key: 'feat', name: 'Up to two roguish feats', limit: 'max 6 total',
      status: () => char.roguishFeats.length + '/6',
      legal: () => char.roguishFeats.length < 6 && featPool().length > 0,
      desc: 'Learn one or two new roguish feats.', multi: 2 },
    { key: 'harm', name: 'Add a box to a harm track', limit: 'max 6 each',
      status: () => HARM.map(h => h + ' +' + char.harmBoxes[h]).join(' · '),
      legal: () => true,
      desc: 'Give one harm track another box (Injury / Exhaustion / Depletion). Base track size isn’t in the ruleset — the book caps each at six boxes total.' },
    { key: 'connection', name: 'Up to two connections', limit: 'max 6 total',
      status: () => (char.connections.length + char.connectionsExtra.length) + ' connections',
      legal: () => true,
      desc: 'Add one or two new connection types (e.g. Protector, Watcher).' },
    { key: 'mastery', name: 'Take a mastery', limit: 'Travelers & Outsiders · 12+ enhancement',
      status: () => char.masteries.length + ' taken',
      legal: () => masteryPool().length > 0,
      desc: 'Deepen a move you already have with its 12+ mastery.' },
    { key: 'speciesmove', name: 'Take a species move', limit: 'Travelers & Outsiders',
      status: () => char.species ? (char.speciesMoves.length + ' taken · ' + char.species) : 'set a species first',
      legal: () => speciesMovePool().length > 0,
      desc: 'Take another move available to your species.' }
  ];

  // ---------- pickers ----------
  function picker(opt) {
    const k = opt.key;
    if (k === 'stat') return chooseOne(k, STATS.filter(s => char.stats[s] < 2).map(s => ({ v: s, label: s + ' ' + fmt(char.stats[s]) + ' → ' + fmt(char.stats[s] + 1) })));
    if (k === 'pbmove') return chooseOne(k, pbMovePool().map(m => ({ v: m.name, label: m.name })));
    if (k === 'othermove') return chooseOne(k, otherMovePool().map(m => ({ v: m.name + '||' + m.from, label: m.name + ' — ' + m.from.replace('The ', '') })));
    if (k === 'weapon') return chooseMany(k, weaponPool().map(w => ({ v: w, label: w })), opt.multi);
    if (k === 'feat') return chooseMany(k, featPool().map(f => ({ v: f, label: f })), opt.multi);
    if (k === 'harm') return chooseOne(k, HARM.map(h => ({ v: h, label: h + ' (+' + char.harmBoxes[h] + ')' })));
    if (k === 'connection') return '<input type="text" data-adv-text="' + k + '" placeholder="Connection type, e.g. Protector, Watcher">' + spendBtn(k);
    if (k === 'mastery') return chooseOne(k, masteryPool().map(m => ({ v: m.move, label: m.move })));
    if (k === 'speciesmove') return chooseOne(k, speciesMovePool().map(n => ({ v: n, label: n })));
    return '';
  }
  function chooseOne(k, opts) {
    return '<select data-adv-sel="' + k + '"><option value="">— choose —</option>' +
      opts.map(o => '<option value="' + esc(o.v) + '"' + (sel[k] === o.v ? ' selected' : '') + '>' + esc(o.label) + '</option>').join('') + '</select>' + spendBtn(k);
  }
  function chooseMany(k, opts, max) {
    const chosen = sel[k] || [];
    return '<div class="summ">' + opts.map(o => '<button type="button" class="chip ' + (chosen.indexOf(o.v) >= 0 ? 'on' : '') + '" data-adv-chip="' + k + '" data-v="' + esc(o.v) + '">' + esc(o.label) + '</button>').join('') + '</div>' +
      '<div class="picker" style="margin-top:8px"><span class="opt ocount" style="border:none;padding:0;background:none">' + chosen.length + '/' + max + ' picked</span>' + spendBtn(k) + '</div>';
  }
  function spendBtn(k) { return ' <button class="btn small" data-adv-spend="' + k + '">Spend 1 advancement</button>'; }

  // ---------- apply ----------
  function logAdv(text, undo) { char.advancements.push({ text, undo }); char.advancementsRemaining = Math.max(0, char.advancementsRemaining - 1); }
  function spend(k) {
    if (char.advancementsRemaining <= 0) { toast('No advancements left to spend — add some above.'); return; }
    const opt = OPTIONS.find(o => o.key === k);
    if (!opt.legal()) { toast('That advancement isn’t available.'); return; }
    let ok = false;
    if (k === 'stat') { const s = sel.stat; if (!s) return toast('Choose a stat.'); if (char.stats[s] >= 2) return toast(s + ' is already at +2.'); char.stats[s] += 1; logAdv('+1 ' + s + ' (now ' + fmt(char.stats[s]) + ')', () => { char.stats[s] -= 1; }); ok = true; }
    else if (k === 'pbmove') { const m = sel.pbmove; if (!m) return toast('Choose a move.'); char.moves.push(m); logAdv('Playbook move: ' + m, () => { char.moves.splice(char.moves.indexOf(m), 1); }); ok = true; }
    else if (k === 'othermove') { const v = sel.othermove; if (!v) return toast('Choose a move.'); const [name, from] = v.split('||'); char.otherMoves.push({ name, from }); logAdv('Move from ' + from.replace('The ', '') + ': ' + name, () => { char.otherMoves = char.otherMoves.filter(o => !(o.name === name && o.from === from)); }); ok = true; }
    else if (k === 'weapon') { const list = (sel.weapon || []).slice(); if (!list.length) return toast('Pick one or two weapon skills.'); if (char.weaponSkills.length + list.length > 7) return toast('That would exceed 7 weapon skills.'); char.weaponSkills.push(...list); logAdv('Weapon skill' + (list.length > 1 ? 's' : '') + ': ' + list.join(', '), () => { list.forEach(w => char.weaponSkills.splice(char.weaponSkills.indexOf(w), 1)); }); ok = true; }
    else if (k === 'feat') { const list = (sel.feat || []).slice(); if (!list.length) return toast('Pick one or two roguish feats.'); if (char.roguishFeats.length + list.length > 6) return toast('That would exceed 6 roguish feats.'); char.roguishFeats.push(...list); logAdv('Roguish feat' + (list.length > 1 ? 's' : '') + ': ' + list.join(', '), () => { list.forEach(f => char.roguishFeats.splice(char.roguishFeats.indexOf(f), 1)); }); ok = true; }
    else if (k === 'harm') { const h = sel.harm; if (!h) return toast('Choose a harm track.'); char.harmBoxes[h] += 1; logAdv('+1 box to ' + h, () => { char.harmBoxes[h] -= 1; }); ok = true; }
    else if (k === 'connection') { const t = (sel.connectionText || '').trim(); if (!t) return toast('Name the connection type.'); char.connectionsExtra.push(t); logAdv('Connection: ' + t, () => { char.connectionsExtra.splice(char.connectionsExtra.indexOf(t), 1); }); ok = true; }
    else if (k === 'mastery') { const m = sel.mastery; if (!m) return toast('Choose a mastery.'); char.masteries.push(m); logAdv('Mastery: ' + m, () => { char.masteries.splice(char.masteries.indexOf(m), 1); }); ok = true; }
    else if (k === 'speciesmove') { const m = sel.speciesmove; if (!m) return toast('Choose a species move.'); char.speciesMoves.push(m); logAdv('Species move: ' + m, () => { char.speciesMoves.splice(char.speciesMoves.indexOf(m), 1); }); ok = true; }
    if (ok) { sel = {}; render(); }
  }
  function undoLast() {
    const last = char.advancements.pop(); if (!last) return;
    if (typeof last.undo === 'function') last.undo();
    char.advancementsRemaining += 1; render();
  }

  // ---------- render ----------
  function render() {
    if (!char) { renderLoad(); return; }
    saveBtn.disabled = false;
    const p = pb();
    let h = '<div class="sheet">';
    h += '<div class="ptitle"><h1>' + esc(char.name || 'Unnamed vagabond') + '</h1><span class="pb">' + esc(char.playbook || '') + '</span></div>';
    // advancement counter
    h += '<div class="advbar"><span class="lbl2">Advancements to spend</span>' +
      '<span class="stepper2"><button data-adv-dec>−</button></span><span class="remain">' + char.advancementsRemaining + '</span><span class="stepper2"><button data-adv-inc>+</button></span>' +
      '<span class="muted small">' + char.advancements.length + ' spent so far</span></div>';
    // options
    h += '<div class="panel"><p class="eyebrow" style="margin:0 0 10px">Advancement options</p>';
    OPTIONS.forEach(opt => {
      const legal = opt.legal(), canSpend = legal && char.advancementsRemaining > 0;
      h += '<div class="opt' + (legal ? '' : ' disabled') + '"><div class="oh"><span class="oname">' + esc(opt.name) + '</span>' +
        '<span class="ocount">' + esc(opt.status()) + '</span></div>' +
        '<div class="odesc">' + esc(opt.desc) + ' <i>(' + esc(opt.limit) + ')</i></div>';
      if (canSpend) h += '<div class="picker">' + picker(opt) + '</div>';
      else if (legal) h += '<div class="odesc" style="color:var(--accent-dk)">Add an advancement above to spend it here.</div>';
      else h += '<div class="odesc" style="color:var(--ink-faint)">Maxed out or unavailable.</div>';
      h += '</div>';
    });
    h += '</div>';
    // log
    if (char.advancements.length) {
      h += '<div class="panel"><p class="eyebrow" style="margin:0 0 8px">Advancements taken</p><ul class="log">';
      char.advancements.forEach((a, i) => { h += '<li><span>' + esc(a.text) + '</span>' + (i === char.advancements.length - 1 ? '<button class="undo" data-adv-undo>undo</button>' : '') + '</li>'; });
      h += '</ul></div>';
    }
    // current sheet summary
    h += sheetSummary();
    h += '</div>';
    app.innerHTML = h;
    wire();
    save();
  }

  function sheetSummary() {
    let h = '<div class="panel"><p class="eyebrow" style="margin:0 0 8px">Current sheet</p>';
    h += tagLine('Stats', STATS.map(s => s + ' ' + fmt(char.stats[s])));
    h += tagLine('Playbook moves', char.moves);
    if (char.otherMoves.length) h += tagLine('Other-playbook moves', char.otherMoves.map(o => o.name + ' (' + o.from.replace('The ', '') + ')'));
    h += tagLine('Weapon skills', char.weaponSkills);
    h += tagLine('Roguish feats', char.roguishFeats);
    if (char.speciesMoves.length) h += tagLine('Species moves', char.speciesMoves);
    if (char.masteries.length) h += tagLine('Masteries', char.masteries);
    if (HARM.some(hh => char.harmBoxes[hh])) h += tagLine('Extra harm boxes', HARM.filter(hh => char.harmBoxes[hh]).map(hh => hh + ' +' + char.harmBoxes[hh]));
    if (char.connectionsExtra.length) h += tagLine('Added connections', char.connectionsExtra);
    return h + '</div>';
  }
  function tagLine(label, arr) {
    return '<p class="rep-mini" style="margin:8px 0 4px;font-family:\'Bitter\',serif;font-weight:700;font-size:11px;letter-spacing:.5px;text-transform:uppercase;color:var(--ink-soft)">' + esc(label) + '</p><div class="summ">' +
      (arr && arr.length ? arr.map(x => '<span class="tag" style="margin:0">' + esc(x) + '</span>').join('') : '<span class="muted small">—</span>') + '</div>';
  }

  // ---------- wiring ----------
  function wire() {
    const dec = app.querySelector('[data-adv-dec]'); if (dec) dec.addEventListener('click', () => { char.advancementsRemaining = Math.max(0, char.advancementsRemaining - 1); render(); });
    const inc = app.querySelector('[data-adv-inc]'); if (inc) inc.addEventListener('click', () => { char.advancementsRemaining += 1; render(); });
    app.querySelectorAll('[data-adv-sel]').forEach(el => el.addEventListener('change', () => { sel[el.getAttribute('data-adv-sel')] = el.value; }));
    app.querySelectorAll('[data-adv-text]').forEach(el => el.addEventListener('input', () => { sel.connectionText = el.value; }));
    app.querySelectorAll('[data-adv-chip]').forEach(el => el.addEventListener('click', () => {
      const k = el.getAttribute('data-adv-chip'), v = el.getAttribute('data-v'), opt = OPTIONS.find(o => o.key === k);
      sel[k] = sel[k] || []; const i = sel[k].indexOf(v);
      if (i >= 0) sel[k].splice(i, 1); else if (sel[k].length < opt.multi) sel[k].push(v);
      render();
    }));
    app.querySelectorAll('[data-adv-spend]').forEach(el => el.addEventListener('click', () => spend(el.getAttribute('data-adv-spend'))));
    const un = app.querySelector('[data-adv-undo]'); if (un) un.addEventListener('click', undoLast);
  }

  // ---------- load / save ----------
  function loadFromText(text) {
    let data; try { data = JSON.parse(text); } catch (e) { return toast('That file is not valid JSON.'); }
    if (!data || data._format !== 'bellum-arborem.character') { if (!confirm('This does not look like a Bellum Arborem character. Load anyway?')) return; }
    char = normalize(data); sel = {}; render(); toast('Loaded ' + (char.name || 'character'));
  }
  importBtn.addEventListener('click', () => importFile.click());
  importFile.addEventListener('change', () => { const f = importFile.files[0]; if (!f) return; const rd = new FileReader(); rd.onload = () => { loadFromText(rd.result); importFile.value = ''; }; rd.readAsText(f); });
  saveBtn.addEventListener('click', () => {
    if (!char) return;
    const base = (char.name || 'vagabond').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'vagabond';
    const out = JSON.parse(JSON.stringify(char)); out.advancements = out.advancements.map(a => ({ text: a.text })); // drop undo fns
    const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob); const a = document.createElement('a');
    a.href = url; a.download = 'bellum-arborem-' + base + '.json'; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000); toast('Saved advanced character');
  });

  function renderLoad() {
    saveBtn.disabled = true;
    const has = k => !!localStorage.getItem(k);
    let h = '<div class="panel loadpane"><div class="big">🎓</div><h2 style="margin:0 0 8px">Load a vagabond to advance</h2>' +
      '<p class="muted" style="max-width:52ch;margin:0 auto 18px">Import a character, set how many advancements they’ve earned, then spend them on legal options.</p>' +
      '<div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap"><button class="btn" id="loadImport">Import character JSON…</button>';
    if (has(STORE_KEY)) h += '<button class="btn ghost" id="loadWip">Resume last session</button>';
    if (has(PLAY_KEY)) h += '<button class="btn ghost" id="loadPlay">Load from Play</button>';
    if (has(CREATOR_KEY)) h += '<button class="btn ghost" id="loadCreator">Load from Creator</button>';
    h += '</div></div>';
    app.innerHTML = h;
    document.getElementById('loadImport').addEventListener('click', () => importFile.click());
    const b = (id, key, msg) => { const el = document.getElementById(id); if (el) el.addEventListener('click', () => { try { char = normalize(JSON.parse(localStorage.getItem(key))); render(); toast(msg); } catch (e) { toast('Could not read that save.'); } }); };
    b('loadWip', STORE_KEY, 'Resumed'); b('loadPlay', PLAY_KEY, 'Loaded from Play'); b('loadCreator', CREATOR_KEY, 'Loaded from Creator');
  }

  // ---------- boot ----------
  if (!R || !Array.isArray(R.playbooks)) { app.innerHTML = '<div class="loaderr"><b>Ruleset failed to load.</b> Run <code>node data/build-rules.mjs</code>.</div>'; return; }
  (function boot() {
    try { const wip = localStorage.getItem(STORE_KEY); if (wip) { const d = JSON.parse(wip); if (d && d.playbook) char = normalize(d); } } catch (e) {}
    render();
  })();
})();
