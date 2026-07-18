/* Bellum Arborem — Ruins & Expeditions
   Forge a ruin (random generation), then run a delve: track levels, rooms, loot,
   the delve moves, and threats of the ruins. Consumes window.ROOT_WOODLAND.expedition. */
(function () {
  'use strict';

  const W = window.ROOT_WOODLAND;
  const EXP = W && W.expedition;
  const app = document.getElementById('app');
  const STORE_KEY = 'bellum-arborem.expedition.wip';

  if (!EXP) {
    app.innerHTML = '<div class="loaderr"><b>The expedition tables are missing.</b> Make sure the Ruins &amp; Expeditions data has been merged into <code>data/woodland-rules.json</code> and rebuilt (<code>node data/build-rules.mjs</code>).</div>';
    return;
  }

  // ---------- utility ----------
  function band3(n) { return n <= 2 ? 0 : (n <= 4 ? 1 : 2); }        // 1-2 / 3-4 / 5-6 → 0/1/2
  function tierOf(total) { return total >= 10 ? '10+' : (total >= 7 ? '7-9' : 'miss'); }
  function tierCls(t) { return t === '10+' ? 'tier-10' : (t === '7-9' ? 'tier-79' : 'tier-6'); }
  function tierName(t) { return t === '10+' ? 'Strong hit' : (t === '7-9' ? 'Weak hit' : 'Miss'); }

  // parse a range spec ("2-7", "10+", "≤7"/"7 or less", "8+", "14") and test a value
  function inRange(spec, v) {
    spec = String(spec).trim();
    if (/or less$/.test(spec)) return v <= parseInt(spec, 10);
    if (spec.indexOf('≤') === 0) return v <= parseInt(spec.slice(1), 10);
    if (/\+$/.test(spec)) return v >= parseInt(spec, 10);
    if (spec.indexOf('-') > 0) { const [a, b] = spec.split('-').map(x => parseInt(x, 10)); return v >= a && v <= b; }
    return v === parseInt(spec, 10);
  }
  // lowest value a range spec can match (for out-of-range fallback direction)
  function rangeMin(spec) {
    spec = String(spec).trim();
    if (/or less$/.test(spec) || spec.indexOf('≤') === 0) return -Infinity;
    if (/\+$/.test(spec)) return parseInt(spec, 10);
    if (spec.indexOf('-') > 0) return parseInt(spec.split('-')[0], 10);
    return parseInt(spec, 10);
  }
  function lookup(results, v) {
    const hit = results.find(r => inRange(r.range, v));
    if (hit) return hit;
    // Below the table's lowest bound → clamp to the first row; above → the last row.
    const minLow = Math.min.apply(null, results.map(r => rangeMin(r.range)));
    return v < minLow ? results[0] : results[results.length - 1];
  }

  // ---------- state ----------
  let state = load() || fresh();
  const ui = { moves: {} };   // transient: per-move modifier checkbox state + last result

  function fresh() {
    return { _format: 'bellum-arborem.expedition', ruin: null, notes: '',
      levels: [freshLevel(1)], curLevel: 1,
      band: { depletion: 0, exhaustion: 0, wear: 0, injury: 0 },
      loot: [], threat: null, log: [] };
  }
  function freshLevel(n) { return { n, rooms: [], safeChambers: 0, scavenged: false }; }
  function curLevel() { return state.levels.find(l => l.n === state.curLevel) || state.levels[state.levels.length - 1]; }
  function save() { try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) {} }
  function load() { try { const s = localStorage.getItem(STORE_KEY); return s ? JSON.parse(s) : null; } catch (e) { return null; } }
  function log(text) { state.log.push({ level: state.curLevel, text }); }

  // ---------- ruin generation ----------
  function rollReshaped() { const a = d6() + d6(); return { roll: a, text: lookup(EXP.generation.reshaped.results, a).text }; }
  function rollGrid(g) { const row = d6(), col = d6(); return { text: g.grid[band3(row)][band3(col)] }; }
  function forgeRuin() {
    state.ruin = {
      reshaped: rollReshaped().text,
      purpose: rollGrid(EXP.generation.originalPurpose).text,
      whyRuin: rollGrid(EXP.generation.whyRuin).text,
      whoLives: rollGrid(EXP.generation.whoLives).text
    };
    log('Forged a new ruin.');
    render();
  }
  function rerollAttr(key) {
    if (!state.ruin) return;
    if (key === 'reshaped') state.ruin.reshaped = rollReshaped().text;
    else if (key === 'purpose') state.ruin.purpose = rollGrid(EXP.generation.originalPurpose).text;
    else if (key === 'whyRuin') state.ruin.whyRuin = rollGrid(EXP.generation.whyRuin).text;
    else if (key === 'whoLives') state.ruin.whoLives = rollGrid(EXP.generation.whoLives).text;
    render();
  }

  // ---------- delve: rooms / levels / loot ----------
  function enterRoom() {
    const lv = curLevel();
    const total = d6() + d6() + lv.rooms.length;
    const r = lookup(EXP.layout.rooms.results, total);
    lv.rooms.push({ roll: total, exits: r.exits, deadEnd: !!r.deadEnd });
    log('Entered a room on Level ' + lv.n + ' (rolled ' + total + '): ' + r.text.replace(/\.$/, '') + '.');
    render();
  }
  function delveDeeperResolve(tier) {
    // advance to the next level, roll its "more levels?" + loot
    const newN = state.levels.length + 1;
    const levelRoll = d6() + newN;
    const more = lookup(EXP.layout.moreLevels.results, levelRoll);
    const lootRoll = d6() + newN;
    const loot = lookup(EXP.layout.levelLoot.results, lootRoll);
    state.levels.push(freshLevel(newN));
    state.curLevel = newN;
    state.loot.push({ level: newN, value: loot.value, items: loot.items, relics: loot.relics, text: loot.text });
    log('Delved to Level ' + newN + '. ' + (more.more ? 'There are more levels below.' : 'This is the last level in the ruin.') +
      ' Level holds: ' + loot.text);
    return { newN, more, loot };
  }
  function setSafe(delta) { const lv = curLevel(); lv.safeChambers = Math.max(0, lv.safeChambers + delta); render(); }
  function gotoLevel(n) { state.curLevel = n; render(); }

  // ---------- band resource counters ----------
  function bump(key, delta) { state.band[key] = Math.max(0, (state.band[key] || 0) + delta); render(); }

  // ---------- moves ----------
  function moveState(key) { if (!ui.moves[key]) ui.moves[key] = { mods: {}, result: null }; return ui.moves[key]; }
  function rollMove(mv) {
    const ms = moveState(mv.key);
    let mod = 0;
    if (mv.choices) {
      // Mutually exclusive: exactly one travel style contributes its modifier.
      const pick = mv.choices[ms.choice];
      mod = pick ? pick.v : 0;
    } else {
      (mv.modifiers || []).forEach((o, i) => { if (ms.mods[i]) mod += o.v; });
    }
    const a = d6(), b = d6(), total = a + b + mod, tier = tierOf(total);
    ms.result = { a, b, mod, total, tier, text: outcomeText(mv, tier) };
    log(mv.name + ': rolled ' + total + ' (' + a + '+' + b + (mod ? (mod > 0 ? '+' + mod : mod) : '') + ') — ' + tierName(tier) + '.');
    if (mv.advancesLevel && tier !== 'miss') delveDeeperResolve(tier);
    render();
  }
  function rollCamp(mv) {
    const ms = moveState(mv.key);
    const dep = Math.max(0, parseInt((ms.depletion != null ? ms.depletion : 0), 10) || 0);
    let bonus = 0; (mv.modifiers || []).forEach((o, i) => { if (ms.mods[i]) bonus += o.v; });
    const mod = Math.min(4, dep + bonus);
    const a = d6(), b = d6(), total = a + b + mod, tier = tierOf(total);
    ms.result = { a, b, mod, total, tier, text: outcomeText(mv, tier), picks: tier === '10+' ? 2 : (tier === '7-9' ? 1 : 0) };
    log('Make Camp: rolled ' + total + ' (' + a + '+' + b + '+' + mod + ', from ' + dep + '-depletion) — ' + tierName(tier) + '.');
    render();
  }
  function rollScavenge(mv) {
    const lv = curLevel();
    const pool = lv.n + lv.safeChambers;
    const dice = []; for (let i = 0; i < pool; i++) dice.push(d6());
    const ms = moveState(mv.key);
    ms.scavenge = { dice, level: lv.n };
    lv.scavenged = true;
    log('Scavenged Level ' + lv.n + ': rolled ' + pool + ' dice [' + dice.join(', ') + '].');
    render();
  }
  function pressForward() {
    const lv = curLevel();
    state.band.depletion = (state.band.depletion || 0) + 1;
    log('Pressed forward on Level ' + lv.n + ' — marked 1-depletion (or draw a threat if none can pay).');
    render();
  }
  function outcomeText(mv, tier) { const o = mv.outcomes || {}; return tier === '10+' ? (o['10+'] || o.hit) : (tier === '7-9' ? o['7-9'] : o.miss); }

  function scavengeSpendFor(die) { const s = EXP.scavengeSpend.find(x => inRange(x.die, die)); return s ? s.text : ''; }

  // ---------- threats ----------
  function threatListForLevel(n) { return n <= 1 ? EXP.threats.level1 : (n <= 3 ? EXP.threats.level23 : EXP.threats.level4plus); }
  function drawThreat() {
    const grp = threatListForLevel(state.curLevel);
    const pick = grp.list[Math.floor(Math.random() * grp.list.length)];
    state.threat = { level: state.curLevel, group: grp.label, text: pick };
    log('Threat of the ruins (' + grp.label + '): ' + pick);
    render();
  }

  // ==================================================================
  // RENDER
  // ==================================================================
  function render() {
    save();
    let h = '<div class="dash">';
    h += ruinPanel();
    if (state.ruin) {
      h += delvePanel();
      h += movesPanel();
      h += threatPanel();
      h += logPanel();
    }
    h += '</div>';
    app.innerHTML = h;
    wire();
  }

  function ruinPanel() {
    if (!state.ruin) {
      return '<div class="panel"><div class="empty"><p style="font-family:\'Bree Serif\',serif;font-size:19px;color:var(--rust);margin:0 0 6px">The ruins await.</p>' +
        '<p class="muted small" style="max-width:440px;margin:0 auto 16px">Forge a ruin from the Ancients’ depths — its makers, its purpose, its downfall, and whatever now lurks within — then lead a band down into it.</p>' +
        '<button class="btn" id="forgeBtn">Forge a ruin</button></div></div>';
    }
    const r = state.ruin;
    const row = (key, q, v) => '<div class="rrow"><div class="rvv"><p class="rq">' + esc(q) + '</p><div class="rv">' + esc(v) + '</div></div>' +
      '<button class="reroll" data-reroll="' + key + '" title="Re-roll" aria-label="Re-roll this detail">↻</button></div>';
    let h = '<div class="ruincard"><h2>The Ruin</h2><div class="rgrid">';
    h += row('purpose', 'Originally a…', r.purpose);
    h += row('whyRuin', 'Ruined by…', r.whyRuin);
    h += row('whoLives', 'Now home to…', r.whoLives);
    h += row('reshaped', 'Reshaped since?', r.reshaped);
    h += '</div>';
    h += '<textarea class="rnotes" id="ruinNotes" placeholder="Name it, sketch its layout, jot the relic the band is after…">' + esc(state.notes || '') + '</textarea>';
    return h + '</div>';
  }

  function delvePanel() {
    const lv = curLevel();
    let h = '<div class="panel">';
    h += '<div class="levhead"><span class="levpill">Level ' + lv.n + '</span>';
    // level switcher
    if (state.levels.length > 1) {
      h += '<span class="levmeta">Jump to: ' + state.levels.map(l => l.n === state.curLevel ?
        ('<b>' + l.n + '</b>') : ('<a href="#" data-goto="' + l.n + '">' + l.n + '</a>')).join(' · ') + '</span>';
    }
    h += '</div>';

    // rooms on this level
    h += '<p class="eyebrow" style="margin:6px 0 2px">Rooms explored on this level</p>';
    if (lv.rooms.length) {
      h += '<div class="rooms">' + lv.rooms.map((rm, i) => '<span class="room' + (rm.deadEnd && rm.exits === 0 ? ' dead' : '') + '">#' + (i + 1) +
        ' <span class="rx">' + (rm.exits === 0 ? 'dead end' : rm.exits + ' exit' + (rm.exits === 1 ? '' : 's')) + (rm.deadEnd && rm.exits ? ' → dead end' : '') + '</span></span>').join('') + '</div>';
    } else {
      h += '<p class="muted small" style="margin:4px 0 8px">No rooms mapped yet on this level.</p>';
    }
    h += '<div class="foot" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:12px">' +
      '<button class="btn small" id="enterRoom">Enter a room</button>' +
      '<span class="counter"><span class="small muted">Adjacent safe chambers</span>' +
      '<button data-safe="-1">−</button><span class="cval">' + lv.safeChambers + '</span><button data-safe="1">+</button></span>' +
      '</div>';

    // band resources
    h += '<p class="eyebrow" style="margin:10px 0 4px">Band resources</p><div style="display:flex;gap:16px;flex-wrap:wrap">';
    [['depletion', 'Depletion'], ['exhaustion', 'Exhaustion'], ['wear', 'Wear'], ['injury', 'Injury']].forEach(([k, lbl]) => {
      h += '<span class="counter"><span class="small muted">' + lbl + '</span><button data-band="' + k + '" data-delta="-1">−</button>' +
        '<span class="cval">' + (state.band[k] || 0) + '</span><button data-band="' + k + '" data-delta="1">+</button></span>';
    });
    h += '</div>';

    // loot
    if (state.loot.length) {
      const totVal = state.loot.reduce((a, l) => a + (l.value || 0), 0);
      const totRel = state.loot.reduce((a, l) => a + (l.relics || 0), 0);
      h += '<p class="eyebrow" style="margin:14px 0 2px">Treasure of the depths ' +
        '<span class="muted" style="font-weight:400;text-transform:none;letter-spacing:0">— ' + totVal + ' Value' +
        (totRel ? ', ' + totRel + ' relic' + (totRel === 1 ? '' : 's') : '') + '</span></p>';
      h += '<ul class="lootlist">' + state.loot.map(l => '<li><span class="lv">Lv ' + l.level + '</span><span>' + esc(l.text) +
        (l.relics ? ' <span class="relicdot">✦×' + l.relics + '</span>' : '') + '</span></li>').join('') + '</ul>';
    }
    return h + '</div>';
  }

  function modRow(mv, i, o) {
    const ms = moveState(mv.key);
    const cls = o.v > 0 ? 'pos' : (o.v < 0 ? 'neg' : '');
    const vtxt = o.v > 0 ? '+' + o.v : (o.v < 0 ? String(o.v) : '±0');
    // `choices` are mutually exclusive (radios); `modifiers` stack (checkboxes).
    const input = mv.choices
      ? '<input type="radio" name="ch_' + mv.key + '" data-choice="' + mv.key + ':' + i + '"' + (ms.choice === i ? ' checked' : '') + '>'
      : '<input type="checkbox" data-mod="' + mv.key + ':' + i + '"' + (ms.mods[i] ? ' checked' : '') + '>';
    return '<label>' + input + '<span>' + esc(o.label) + '</span><span class="mv ' + cls + '">' + vtxt + '</span></label>';
  }

  function movesPanel() {
    let h = '<div class="panel"><p class="eyebrow" style="margin:0 0 10px">The delve moves</p><div class="moves">';
    EXP.moves.forEach(mv => { h += moveCard(mv); });
    h += '</div></div>';
    return h;
  }

  function moveCard(mv) {
    const ms = moveState(mv.key);
    let h = '<div class="move"><h4>' + esc(mv.name) + '</h4><p class="mroll">' + esc(mv.roll) + '</p>' +
      '<p class="mtrig">' + esc(mv.trigger) + '</p>';

    if (mv.noRoll) {
      h += '<div class="foot"><button class="btn small" data-press="1">Press forward</button></div>';
      h += '<p class="outcome muted">' + esc(mv.cost) + '</p>';
      return h + '</div>';
    }
    if (mv.dicePool) {
      const lv = curLevel(); const pool = lv.n + lv.safeChambers;
      h += '<p class="small muted" style="margin:0 0 8px">Pool this level: <b>' + pool + '</b> dice (Level ' + lv.n + ' + ' + lv.safeChambers + ' safe chamber' + (lv.safeChambers === 1 ? '' : 's') + ').' +
        (lv.scavenged ? ' <span style="color:var(--bad)">Already scavenged this level.</span>' : '') + '</p>';
      h += '<div class="foot"><button class="btn small" data-scavenge="1"' + (lv.scavenged ? ' disabled' : '') + '>Roll ' + pool + ' dice</button></div>';
      if (ms.scavenge && ms.scavenge.level === lv.n) {
        h += '<div class="result"><div class="diepool">' + ms.scavenge.dice.map(dn =>
          '<div class="die"><div class="dn">' + dn + '</div><div class="ds">' + esc(scavengeSpendFor(dn)) + '</div></div>').join('') + '</div></div>';
      }
      h += '<details class="ref"><summary>Spend guide</summary><ul class="tlist">' +
        EXP.scavengeSpend.map(s => '<li><b>' + s.die + ':</b> ' + esc(s.text) + '</li>').join('') + '</ul></details>';
      return h + '</div>';
    }

    // modifier / choice checkboxes
    const opts = mv.modifiers || mv.choices || [];
    if (opts.length) h += '<div class="mods">' + opts.map((o, i) => modRow(mv, i, o)).join('') + '</div>';
    if (mv.key === 'makeCamp') {
      h += '<div class="camp-inp"><label>Depletion the band marks: <input type="number" min="0" value="' + (ms.depletion != null ? ms.depletion : 0) + '" data-camp="dep"></label></div>';
    }
    h += '<div class="foot"><button class="btn small" data-roll="' + mv.key + '">Roll</button>';
    if (ms.result) h += '<span class="rolln">' + ms.result.total + ' <span class="dice">(' + ms.result.a + '+' + ms.result.b +
      (ms.result.mod ? (ms.result.mod > 0 ? '+' + ms.result.mod : ms.result.mod) : '') + ')</span>' +
      '<span class="tierbadge ' + tierCls(ms.result.tier) + '">' + tierName(ms.result.tier) + '</span></span>';
    h += '</div>';
    if (ms.result) {
      h += '<div class="result"><p class="outcome">' + esc(ms.result.text) + '</p>';
      if (mv.key === 'makeCamp' && ms.result.picks > 0 && mv.picks) {
        h += '<p class="small muted" style="margin:6px 0 2px">Each resting vagabond picks ' + ms.result.picks + ':</p><ul class="picks">' +
          mv.picks.map(p => '<li>' + esc(p) + '</li>').join('') + '</ul>';
      }
      h += '</div>';
    }
    return h + '</div>';
  }

  function threatPanel() {
    let h = '<div class="panel"><div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap">' +
      '<p class="eyebrow" style="margin:0">Threats of the ruins</p>' +
      '<button class="btn small ghost" id="drawThreat">Draw a threat (Level ' + state.curLevel + ')</button></div>';
    if (state.threat) {
      h += '<div class="threatbox"><div class="tt">' + esc(state.threat.group) + '</div><p class="td">' + esc(state.threat.text) + '</p></div>';
    }
    [EXP.threats.level1, EXP.threats.level23, EXP.threats.level4plus].forEach(g => {
      h += '<details class="ref"><summary>' + esc(g.label) + '</summary><p class="small muted" style="margin:2px 0 4px">' + esc(g.note) +
        '</p><ul class="tlist">' + g.list.map(t => '<li>' + esc(t) + '</li>').join('') + '</ul></details>';
    });
    return h + '</div>';
  }

  function logPanel() {
    if (!state.log.length) return '';
    let h = '<div class="panel"><p class="eyebrow" style="margin:0 0 8px">Delve log</p><ul class="log">';
    let last = null;
    state.log.slice().reverse().forEach(e => {
      if (e.level !== last) { h += '<li class="sep">Level ' + e.level + '</li>'; last = e.level; }
      h += '<li>' + esc(e.text) + '</li>';
    });
    return h + '</ul></div>';
  }

  // ==================================================================
  // WIRING
  // ==================================================================
  function wire() {
    const g = id => document.getElementById(id);
    if (g('forgeBtn')) g('forgeBtn').addEventListener('click', forgeRuin);
    app.querySelectorAll('[data-reroll]').forEach(b => b.addEventListener('click', () => rerollAttr(b.getAttribute('data-reroll'))));
    if (g('ruinNotes')) g('ruinNotes').addEventListener('input', e => { state.notes = e.target.value; save(); });
    if (g('enterRoom')) g('enterRoom').addEventListener('click', enterRoom);
    app.querySelectorAll('[data-safe]').forEach(b => b.addEventListener('click', () => setSafe(+b.getAttribute('data-safe'))));
    app.querySelectorAll('[data-band]').forEach(b => b.addEventListener('click', () => bump(b.getAttribute('data-band'), +b.getAttribute('data-delta'))));
    app.querySelectorAll('[data-goto]').forEach(a => a.addEventListener('click', e => { e.preventDefault(); gotoLevel(+a.getAttribute('data-goto')); }));
    // move checkboxes — update ui state without re-render
    app.querySelectorAll('[data-mod]').forEach(cb => cb.addEventListener('change', () => {
      const [key, i] = cb.getAttribute('data-mod').split(':'); moveState(key).mods[+i] = cb.checked;
    }));
    app.querySelectorAll('[data-choice]').forEach(rb => rb.addEventListener('change', () => {
      const [key, i] = rb.getAttribute('data-choice').split(':'); moveState(key).choice = +i;
    }));
    app.querySelectorAll('[data-camp]').forEach(inp => inp.addEventListener('input', () => { moveState('makeCamp').depletion = inp.value; }));
    app.querySelectorAll('[data-roll]').forEach(b => b.addEventListener('click', () => {
      const mv = EXP.moves.find(m => m.key === b.getAttribute('data-roll'));
      if (mv.key === 'makeCamp') rollCamp(mv); else rollMove(mv);
    }));
    app.querySelectorAll('[data-scavenge]').forEach(b => b.addEventListener('click', () => rollScavenge(EXP.moves.find(m => m.dicePool))));
    app.querySelectorAll('[data-press]').forEach(b => b.addEventListener('click', pressForward));
    if (g('drawThreat')) g('drawThreat').addEventListener('click', drawThreat);
  }

  // ---------- top bar: import / export / reset ----------
  document.getElementById('exportBtn').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob), a = document.createElement('a');
    const nm = (state.ruin && state.ruin.purpose ? state.ruin.purpose.replace(/[^a-z0-9]+/gi, '-').toLowerCase() : 'ruin');
    a.href = url; a.download = 'delve-' + nm + '.json'; a.click(); URL.revokeObjectURL(url);
  });
  document.getElementById('importBtn').addEventListener('click', () => document.getElementById('importFile').click());
  document.getElementById('importFile').addEventListener('change', e => {
    const f = e.target.files[0]; if (!f) return;
    const rd = new FileReader();
    rd.onload = () => {
      try {
        const data = JSON.parse(rd.result);
        if (data._format !== 'bellum-arborem.expedition') { toast('Not a Bellum Arborem delve file.'); return; }
        state = Object.assign(fresh(), data);
        if (!state.levels || !state.levels.length) state.levels = [freshLevel(1)];
        Object.keys(ui.moves).forEach(k => delete ui.moves[k]);
        render(); toast('Delve imported.');
      } catch (err) { toast('Could not read that file.'); }
    };
    rd.readAsText(f); e.target.value = '';
  });
  document.getElementById('resetBtn').addEventListener('click', () => {
    if (state.ruin && !confirm('Abandon the current delve and start a new one?')) return;
    state = fresh(); Object.keys(ui.moves).forEach(k => delete ui.moves[k]); render();
  });

  render();
})();
