/* Bellum Arborem — Play mode
   Load a character JSON, then play: mark harm, adjust faction reputation,
   roll moves (2d6 + stat), advance stats. Consumes window.ROOT_RULES. */
(function () {
  'use strict';

  const R = window.ROOT_RULES;
  const app = document.getElementById('app');
  const importBtn = document.getElementById('importBtn');
  const importFile = document.getElementById('importFile');
  const saveBtn = document.getElementById('saveBtn');
  const STORE_KEY = 'bellum-arborem.play.wip';
  const CREATOR_KEY = 'bellum-arborem.character.wip';
  const STATS = (R && R.stats) || ['Charm', 'Cunning', 'Finesse', 'Luck', 'Might'];
  const HARM = ['Injury', 'Exhaustion', 'Depletion'];
  const HARM_BASE = (R.harmTracks && R.harmTracks[0] && R.harmTracks[0].base) || 4;
  const HARM_MAX = (R.harmTracks && R.harmTracks[0] && R.harmTracks[0].max) || 6;
  // A track's size = base (4) plus any advancement / move box bonuses, capped at the max (6).
  function trackSize(name) { return Math.min(HARM_MAX, HARM_BASE + ((char.harmBoxes && char.harmBoxes[name]) || 0)); }
  const HARM_NOTE = {
    Injury: 'Toughness. Mark as you are hurt; clear by resting or care.',
    Exhaustion: 'Energy. Clear your whole track by acting in line with your Nature.',
    Depletion: 'Supplies / pockets. Mark as you spend and improvise; clear by resupplying.'
  };

  let char = null;
  let lastRoll = null;
  let freeStat = STATS[0];

  // ---------- utils ----------
  function save() { if (char) try { localStorage.setItem(STORE_KEY, JSON.stringify(char)); } catch (e) {} }
  function pb() { return R.playbooks.find(p => p.name === (char && char.playbook)) || null; }
  const factions = (R.factions || []).map(f => f.name);

  // ---------- normalize a loaded character ----------
  function normalize(data) {
    const c = Object.assign({
      _format: 'bellum-arborem.character', playbook: null, name: '', pronouns: '',
      stats: {}, nature: null, drives: [], moves: [], weaponSkills: [], roguishFeats: [],
      equipment: [], connections: [], reputation: {}, harm: {}, value: 0, load: 0, notes: ''
    }, data || {});
    STATS.forEach(s => { if (typeof c.stats[s] !== 'number') c.stats[s] = 0; });
    HARM.forEach(h => { if (typeof c.harm[h] !== 'number') c.harm[h] = 0; });
    if (!c.harmBoxes || typeof c.harmBoxes !== 'object') c.harmBoxes = {};
    HARM.forEach(h => { if (typeof c.harmBoxes[h] !== 'number') c.harmBoxes[h] = 0; });
    factions.forEach(f => { if (!c.reputation[f]) c.reputation[f] = { status: 0, prestige: 0, notoriety: 0 }; });
    ['drives', 'moves', 'weaponSkills', 'roguishFeats', 'equipment', 'connections', 'speciesMoves'].forEach(k => { if (!Array.isArray(c[k])) c[k] = []; });
    return c;
  }
  function speciesAbility() {
    if (char && char.speciesAbility) return char.speciesAbility; // from export
    const sp = (char && char.species || '').trim().toLowerCase();
    if (!sp) return null;
    return (R.speciesAbilities || []).find(x => (x.species || []).some(t => { const b = t.toLowerCase(); return sp === b || b.indexOf(sp) === 0 || sp.indexOf(b) === 0; })) || null;
  }

  // ---------- move resolution ----------
  function resolveMoves() {
    const out = { playbook: [], species: [], groups: {} };
    const p = pb();
    if (p && Array.isArray(p.playbookMoves)) {
      (char.moves || []).forEach(name => {
        const m = p.playbookMoves.find(x => x.name === name);
        if (m) out.playbook.push(Object.assign({ category: 'Playbook' }, m));
        else out.playbook.push({ name, category: 'Playbook' });
      });
    }
    (char.speciesMoves || []).forEach(name => {
      const m = (R.speciesMoves || []).find(x => x.name === name);
      out.species.push(m ? Object.assign({ category: 'Species' }, m) : { name, category: 'Species' });
    });
    (R.basicMoves || []).forEach(m => {
      const cat = m.category || 'Basic';
      (out.groups[cat] = out.groups[cat] || []).push(m);
    });
    return out;
  }
  function statMod(statName) { return STATS.indexOf(statName) >= 0 ? (char.stats[statName] || 0) : null; }
  function rollMove(move) {
    const a = d6(), b = d6(), base = a + b;
    const mod = statMod(move.stat);
    const total = base + (mod || 0);
    const tier = total >= 10 ? '10+' : (total >= 7 ? '7-9' : '6-');
    lastRoll = { move, a, b, base, mod, statName: move.stat, total, tier, at: (lastRoll ? lastRoll.at + 1 : 1) };
    render();
  }
  function rollFree() {
    const a = d6(), b = d6(), base = a + b, mod = char.stats[freeStat] || 0, total = base + mod;
    const tier = total >= 10 ? '10+' : (total >= 7 ? '7-9' : '6-');
    lastRoll = { move: { name: 'Roll + ' + freeStat }, a, b, base, mod, statName: freeStat, total, tier, at: (lastRoll ? lastRoll.at + 1 : 1) };
    render();
  }
  function outcomeLines(move, tier) {
    if (!move.outcomes) return [];
    const o = move.outcomes, lines = [];
    const isHit = tier !== '6-';
    if (tier === '10+' && o['10+']) lines.push(['10+', o['10+']]);
    if (tier === '7-9' && o['7-9']) lines.push(['7-9', o['7-9']]);
    if (isHit && o['hit']) lines.push(['hit', o['hit']]);
    if (tier === '6-' && o['6-']) lines.push(['6-', o['6-']]);
    if (tier === '6-' && o['miss']) lines.push(['miss', o['miss']]);
    if (o['any']) lines.push(['any', o['any']]);
    return lines;
  }

  // ---------- render ----------
  function render() {
    if (!char) { renderLoad(); return; }
    saveBtn.disabled = false;
    let h = '<div class="sheet">';
    h += header() + rollBanner() + freeRoller();
    h += '<div class="grid2">' + harmPanel() + repPanel() + '</div>';
    h += movesPanel();
    h += '<div class="grid2">' + statsPanel() + traitsPanel() + '</div>';
    h += gearPanel();
    h += notesPanel();
    h += '</div>';
    app.innerHTML = h;
    wire();
    save();
  }

  function renderLoad() {
    saveBtn.disabled = true;
    const hasWip = !!localStorage.getItem(STORE_KEY);
    const hasCreator = !!localStorage.getItem(CREATOR_KEY);
    let h = '<div class="panel loadpane">';
    h += '<div class="big">🐾</div>';
    h += '<h2 style="margin:0 0 8px">Load a vagabond to play</h2>';
    h += '<p class="muted" style="max-width:52ch;margin:0 auto 18px">Import a character you exported from the Character Creator, then track harm, shift your faction reputation, and roll your moves.</p>';
    h += '<div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap">';
    h += '<button class="btn" id="loadImport">Import character JSON…</button>';
    if (hasWip) h += '<button class="btn ghost" id="loadWip">Resume last session</button>';
    if (hasCreator) h += '<button class="btn ghost" id="loadCreator">Load in-progress from Creator</button>';
    h += '</div></div>';
    app.innerHTML = h;
    document.getElementById('loadImport').addEventListener('click', () => importFile.click());
    const lw = document.getElementById('loadWip'); if (lw) lw.addEventListener('click', () => { try { char = normalize(JSON.parse(localStorage.getItem(STORE_KEY))); render(); toast('Resumed'); } catch (e) { toast('Could not read saved session'); } });
    const lc = document.getElementById('loadCreator'); if (lc) lc.addEventListener('click', () => { try { char = normalize(JSON.parse(localStorage.getItem(CREATOR_KEY))); render(); toast('Loaded ' + (char.name || 'character')); } catch (e) { toast('Could not read Creator draft'); } });
  }

  function header() {
    const p = pb();
    return '<div class="ptitle"><h1>' + esc(char.name || 'Unnamed vagabond') + '</h1>' +
      (char.pronouns ? '<span class="muted">' + esc(char.pronouns) + '</span>' : '') +
      '<span class="pb">' + esc(char.playbook || (p && p.name) || '') + '</span></div>' +
      (char.demeanor || char.look ? '<p class="muted small" style="margin:2px 0 0">' + esc([char.demeanor, char.look].filter(Boolean).join(' · ')) + '</p>' : '');
  }

  function rollBanner() {
    if (!lastRoll) return '<div class="rollbanner"><span class="dieface">🎲</span><div class="rb-main"><div class="rb-move muted">Roll a move or the dice to see the result here.</div></div></div>';
    const r = lastRoll;
    const tcls = r.tier === '10+' ? 'tier-10' : (r.tier === '7-9' ? 'tier-79' : 'tier-6');
    const tlabel = r.tier === '10+' ? 'Strong hit' : (r.tier === '7-9' ? 'Weak hit' : 'Miss');
    const modTxt = r.mod == null ? ' (roll with ' + esc(r.statName || '—') + ')' : ' ' + fmt(r.mod) + ' ' + esc(r.statName || '');
    let out = '';
    if (r.move && r.move.outcomes) {
      out = outcomeLines(r.move, r.tier).map(l => '<div class="rb-out"><b>' + esc(l[0]) + '</b> ' + esc(l[1]) + '</div>').join('');
    }
    return '<div class="rollbanner"><span class="dieface">' + r.total + '</span>' +
      '<div class="rb-main"><div class="rb-move">' + esc(r.move ? r.move.name : '') +
      ' <span class="tierbadge ' + tcls + '">' + tlabel + '</span></div>' +
      '<div class="rb-calc">2d6 (' + r.a + '+' + r.b + '=' + r.base + ')' + modTxt + ' = <b>' + r.total + '</b></div>' + out + '</div></div>';
  }

  function freeRoller() {
    return '<div class="panel" style="padding:12px 16px"><div class="free-roll">' +
      '<span class="rep-mini">Quick roll</span>' +
      '<span class="statpick">' + STATS.map(s => '<button data-free="' + s + '" class="' + (s === freeStat ? 'sel' : '') + '">' + esc(s) + ' ' + fmt(char.stats[s] || 0) + '</button>').join('') + '</span>' +
      '<button class="btn small" id="freeRollBtn">🎲 Roll 2d6 ' + fmt(char.stats[freeStat] || 0) + '</button></div></div>';
  }

  function harmPanel() {
    let h = '<div class="panel"><p class="eyebrow" style="margin:0 0 12px">Harm tracks</p>';
    HARM.forEach(name => {
      const size = trackSize(name);
      const v = Math.min(char.harm[name] || 0, size);
      let boxes = '';
      for (let i = 0; i < size; i++) boxes += '<div class="hbox ' + (i < v ? 'on' : '') + '" data-harm="' + name + '" data-i="' + i + '"></div>';
      h += '<div class="harm"><div class="hlabel"><span class="hname">' + name + '</span><span class="hcount">' + v + '/' + size + '</span></div>' +
        '<div class="hboxes">' + boxes + '</div><div class="hnote">' + esc(HARM_NOTE[name] || '') + '</div></div>';
    });
    h += '</div>';
    return h;
  }

  function repPanel() {
    let h = '<div class="panel"><p class="eyebrow" style="margin:0 0 8px">Faction reputation</p>';
    factions.forEach(f => {
      const r = char.reputation[f] || { status: 0, prestige: 0, notoriety: 0 };
      h += '<div class="rep-row"><span class="rep-name"><span class="tag ' + tagClass(f) + '">' + esc(f) + '</span></span>' +
        '<span class="stepper"><button data-rep="' + esc(f) + '" data-k="status" data-d="-1">−</button>' +
        '<span class="v ' + (r.status >= 0 ? 'pos' : '') + '">' + (r.status < 0 ? '−' + Math.abs(r.status) : r.status) + '</span>' +
        '<button data-rep="' + esc(f) + '" data-k="status" data-d="1">+</button></span>' +
        '<span class="stepper"><span class="rep-mini">Prestige</span><button data-rep="' + esc(f) + '" data-k="prestige" data-d="-1">−</button><span class="v">' + (r.prestige || 0) + '</span><button data-rep="' + esc(f) + '" data-k="prestige" data-d="1">+</button></span>' +
        '<span class="stepper"><span class="rep-mini">Notoriety</span><button data-rep="' + esc(f) + '" data-k="notoriety" data-d="-1">−</button><span class="v">' + (r.notoriety || 0) + '</span><button data-rep="' + esc(f) + '" data-k="notoriety" data-d="1">+</button></span>' +
        '</div>';
    });
    h += '</div>';
    return h;
  }
  function tagClass(f) { const s = f.toLowerCase(); if (s.indexOf('marqu') >= 0) return 'marquise'; if (s.indexOf('eyrie') >= 0) return 'eyrie'; if (s.indexOf('alliance') >= 0) return 'alliance'; if (s.indexOf('vagabond') >= 0) return 'vagabond'; return ''; }

  function movesPanel() {
    const rm = resolveMoves();
    let h = '<div class="panel"><p class="eyebrow" style="margin:0 0 10px">Moves — roll with a tap</p>';
    if (rm.playbook.length) {
      h += '<p class="rep-mini" style="margin:4px 0">Playbook moves</p>';
      rm.playbook.forEach((m, i) => { h += moveCard(m, 'pb', i); });
    }
    if (rm.species.length) {
      h += '<p class="rep-mini" style="margin:10px 0 4px">Species moves</p>';
      rm.species.forEach((m, i) => { h += moveCard(m, 'sp', i); });
    }
    const order = ['Basic', 'Weapon', 'Travel', 'Session', 'Reputation'];
    order.forEach(cat => {
      const list = rm.groups[cat]; if (!list || !list.length) return;
      const open = cat === 'Basic' ? ' open' : '';
      h += '<details class="movegroup"' + open + '><summary>' + cat + ' moves (' + list.length + ')</summary>';
      list.forEach((m, i) => { h += moveCard(m, cat, i); });
      h += '</details>';
    });
    h += '</div>';
    return h;
  }
  function moveCard(m, grp, i) {
    const mod = statMod(m.stat);
    const canRoll = !!m.stat;
    const btn = canRoll
      ? '<button class="btn small" data-roll="' + grp + ':' + i + '">🎲 ' + esc(m.stat) + (mod != null ? ' ' + fmt(mod) : '') + '</button>'
      : '<span class="rep-mini">no roll</span>';
    let inner = '';
    if (m.trigger) inner += '<div class="mc-trigger">' + esc(m.trigger) + '</div>';
    return '<div class="movecard"><div class="mc-top"><span class="mc-name">' + esc(m.name) + '</span>' + btn + '</div>' + inner + '</div>';
  }

  function statsPanel() {
    let h = '<div class="panel"><p class="eyebrow" style="margin:0 0 12px">Stats</p><div class="stat-row">';
    STATS.forEach(s => {
      const v = char.stats[s] || 0;
      h += '<div class="stat" style="flex:1 1 90px"><div class="name">' + esc(s) + '</div>' +
        '<div class="stepper" style="justify-content:center"><button data-stat="' + s + '" data-d="-1">−</button>' +
        '<span class="v ' + (v >= 0 ? 'pos' : '') + '">' + (v < 0 ? '−' + Math.abs(v) : v) + '</span>' +
        '<button data-stat="' + s + '" data-d="1">+</button></div></div>';
    });
    h += '</div></div>';
    return h;
  }

  function traitsPanel() {
    const p = pb();
    const nat = p && (p.natures || []).find(n => n.name === char.nature);
    let h = '<div class="panel"><p class="eyebrow" style="margin:0 0 8px">Nature &amp; drives</p>';
    h += '<p style="margin:0 0 6px"><b>' + esc(char.nature || '—') + '</b>' + (nat ? ' <span class="muted small">' + esc(nat.condition) + '</span>' : '') + '</p>';
    h += '<p class="rep-mini" style="margin:8px 0 4px">Drives</p><div>' + (char.drives.length ? char.drives.map(d => '<span class="tag" style="margin:0 6px 6px 0">' + esc(d) + '</span>').join('') : '<span class="muted small">—</span>') + '</div>';
    const ab = speciesAbility();
    if (char.species || ab) {
      h += '<p class="rep-mini" style="margin:12px 0 4px">Species' + (char.species ? ' — ' + esc(char.species) : '') + '</p>';
      if (ab) h += '<p style="margin:0"><b>' + esc(ab.name) + '</b> <span class="muted small">' + esc(ab.description) + '</span></p>';
    }
    h += '</div>';
    return h;
  }

  function gearPanel() {
    const p = pb();
    const spent = char.equipment.reduce((s, n) => { const e = (R.equipment || []).find(x => x.name === n); return s + ((e && e.value) || 0); }, 0);
    let h = '<div class="panel"><p class="eyebrow" style="margin:0 0 10px">Skills &amp; gear</p>';
    h += tagLine('Weapon skills', char.weaponSkills);
    h += tagLine('Roguish feats', char.roguishFeats);
    h += tagLine('Equipment', char.equipment);
    h += '<p class="small muted" style="margin:10px 0 0">Value ' + (char.value != null ? char.value : (p && p.startingValue) || 0) + ' · spent ' + spent + ' · load ' + (char.load || 0) + '</p>';
    return h + '</div>';
  }
  function tagLine(label, arr) {
    return '<p class="rep-mini" style="margin:8px 0 4px">' + label + '</p><div>' + (arr && arr.length ? arr.map(x => '<span class="tag" style="margin:0 6px 6px 0">' + esc(x) + '</span>').join('') : '<span class="muted small">—</span>') + '</div>';
  }

  function notesPanel() {
    return '<div class="panel"><p class="eyebrow" style="margin:0 0 8px">Notes</p><textarea data-notes placeholder="Session notes, conditions, promises owed…">' + esc(char.notes || '') + '</textarea></div>';
  }

  // ---------- wiring ----------
  function wire() {
    const rm = resolveMoves();
    document.getElementById('freeRollBtn').addEventListener('click', rollFree);
    app.querySelectorAll('[data-free]').forEach(el => el.addEventListener('click', () => { freeStat = el.getAttribute('data-free'); render(); }));
    app.querySelectorAll('[data-roll]').forEach(el => el.addEventListener('click', () => {
      const [grp, i] = el.getAttribute('data-roll').split(':');
      const move = grp === 'pb' ? rm.playbook[+i] : grp === 'sp' ? rm.species[+i] : rm.groups[grp][+i];
      if (move) rollMove(move);
    }));
    app.querySelectorAll('[data-harm]').forEach(el => el.addEventListener('click', () => {
      const name = el.getAttribute('data-harm'), i = +el.getAttribute('data-i');
      char.harm[name] = (char.harm[name] === i + 1) ? i : i + 1;
      render();
    }));
    app.querySelectorAll('[data-rep]').forEach(el => el.addEventListener('click', () => {
      const f = el.getAttribute('data-rep'), k = el.getAttribute('data-k'), d = +el.getAttribute('data-d');
      const r = char.reputation[f] || { status: 0, prestige: 0, notoriety: 0 };
      if (k === 'status') r.status = Math.max(-3, Math.min(3, r.status + d));
      else r[k] = Math.max(0, (r[k] || 0) + d);
      char.reputation[f] = r; render();
    }));
    app.querySelectorAll('[data-stat]').forEach(el => el.addEventListener('click', () => {
      const s = el.getAttribute('data-stat'), d = +el.getAttribute('data-d');
      char.stats[s] = Math.max(-3, Math.min(5, (char.stats[s] || 0) + d)); render();
    }));
    const ta = app.querySelector('[data-notes]'); if (ta) ta.addEventListener('input', () => { char.notes = ta.value; save(); });
  }

  // ---------- load / save ----------
  function loadFromText(text) {
    let data; try { data = JSON.parse(text); } catch (e) { toast('That file is not valid JSON.'); return; }
    if (!data || data._format !== 'bellum-arborem.character') {
      if (!confirm('This does not look like a Bellum Arborem character. Load anyway?')) return;
    }
    char = normalize(data); lastRoll = null; render();
    toast('Loaded ' + (char.name || 'character'));
  }
  importBtn.addEventListener('click', () => importFile.click());
  importFile.addEventListener('change', () => { const f = importFile.files[0]; if (!f) return; const rd = new FileReader(); rd.onload = () => { loadFromText(rd.result); importFile.value = ''; }; rd.readAsText(f); });
  saveBtn.addEventListener('click', () => {
    if (!char) return;
    const base = (char.name || 'vagabond').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'vagabond';
    const blob = new Blob([JSON.stringify(char, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob); const a = document.createElement('a');
    a.href = url; a.download = 'bellum-arborem-' + base + '.json'; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000); toast('Saved character JSON');
  });

  // ---------- boot ----------
  if (!R || !Array.isArray(R.playbooks)) {
    app.innerHTML = '<div class="loaderr"><b>Ruleset failed to load.</b> Make sure <code>data/root-rules.js</code> exists (run <code>node data/build-rules.mjs</code>).</div>';
    return;
  }
  (function boot() {
    try { const wip = localStorage.getItem(STORE_KEY); if (wip) { const d = JSON.parse(wip); if (d && d.playbook) { char = normalize(d); } } } catch (e) {}
    render();
  })();
})();
