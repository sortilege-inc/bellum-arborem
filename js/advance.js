/* Bellum Arborem — Advance Woodland
   Import a Woodland (from the Woodland Creator) and work the "time passes"
   rules: roll each non-denizen faction, apply boons/defeats to the map.
   Consumes window.ROOT_WOODLAND (faction-roll rules + colors). */
(function () {
  'use strict';

  const W = window.ROOT_WOODLAND;
  const app = document.getElementById('app');
  const toastEl = document.getElementById('toast');
  const importBtn = document.getElementById('importBtn');
  const importFile = document.getElementById('importFile');
  const exportBtn = document.getElementById('exportBtn');
  const STORE_KEY = 'bellum-arborem.advance.wip';
  const CREATOR_KEY = 'bellum-arborem.woodland.wip';
  const DENIZEN = 'Denizens', UNCONTROLLED = 'Uncontrolled';
  const VB_W = 1000, VB_H = 640, NODE_R = 34;

  if (!W || !W.factionRoll) {
    app.innerHTML = '<div class="loaderr"><b>Woodland ruleset failed to load.</b> Make sure ' +
      '<code>data/woodland-rules.js</code> exists and includes the faction-roll rules ' +
      '(<code>node data/build-rules.mjs</code>).</div>';
    return;
  }
  const FR = W.factionRoll;

  let wd = null;         // the loaded woodland
  let round = null;      // active "time passes" round
  let lastRoll = null;

  // ---------- utils ----------
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function fmt(n) { return (n >= 0 ? '+' : '') + n; }
  function d6() { return Math.floor(Math.random() * 6) + 1; }
  function r2d6() { return d6() + d6(); }
  function toast(m) { toastEl.textContent = m; toastEl.classList.add('show'); clearTimeout(toast._t); toast._t = setTimeout(() => toastEl.classList.remove('show'), 2400); }
  function save() { if (wd) try { localStorage.setItem(STORE_KEY, JSON.stringify(wd)); } catch (e) {} }
  function byId(id) { return wd.clearings.find(c => c.id === id); }
  function isFactionControl(v) { return v && v !== DENIZEN && v !== UNCONTROLLED; }

  // ---------- normalize a loaded woodland ----------
  function normalize(data) {
    const w = Object.assign({ factions: [], clearings: [], edges: [], corner: {} }, data || {});
    if (!Array.isArray(w.clearings)) w.clearings = [];
    if (!Array.isArray(w.edges)) w.edges = [];
    w.clearings.forEach((c, i) => {
      if (typeof c.fortified !== 'boolean') c.fortified = false;
      if (!Array.isArray(c.structures)) c.structures = [];
      if (!Array.isArray(c.presence)) c.presence = [];
      if (typeof c.onWater !== 'boolean') c.onWater = false;
      if (typeof c.ruin !== 'boolean') c.ruin = false;
      if (typeof c.hoard !== 'number') c.hoard = 0;
      if (c.x == null || c.y == null) { c.x = 120 + (i % 4) * 240; c.y = 90 + Math.floor(i / 4) * 150; }
    });
    w.factionState = w.factionState || {};
    (w.factions || []).forEach(f => { w.factionState[f] = Object.assign({ resource: false, captured: false }, w.factionState[f]); });
    if (typeof w.round !== 'number') w.round = 0;
    if (!Array.isArray(w.log)) w.log = [];
    return w;
  }

  // ---------- faction queries ----------
  function factionsPresent() { return (wd.factions || []).filter(isFactionControl); }
  function controlledBy(f) { return wd.clearings.filter(c => c.control === f); }
  function roostCount(f) { return wd.clearings.filter(c => c.control === f && c.roost).length; }
  function sympathyCount() { return wd.clearings.filter(c => c.sympathy).length; }
  function hasStructures(f) { return wd.clearings.some(c => c.control === f && c.structures.length); }
  function mostControlledCount() { return Math.max(0, ...factionsPresent().map(f => controlledBy(f).length)); }
  function factionOrder() { return factionsPresent().slice().sort((a, b) => controlledBy(b).length - controlledBy(a).length); }
  function neighborIds(id) { return wd.edges.filter(e => e[0] === id || e[1] === id).map(e => e[0] === id ? e[1] : e[0]); }
  function hasPresence(c, f) { return (c.presence || []).indexOf(f) >= 0; }
  function addPresence(c, f) { if (!c.presence) c.presence = []; if (!hasPresence(c, f)) c.presence.push(f); }
  function hasStruct(c, s) { return (c.structures || []).indexOf(s) >= 0; }
  function addStruct(c, s) { if (!c.structures) c.structures = []; if (!hasStruct(c, s)) c.structures.push(s); }
  function removeStruct(c, s) { if (c.structures) { const i = c.structures.indexOf(s); if (i >= 0) c.structures.splice(i, 1); } }
  function presenceOf(f) { return wd.clearings.filter(c => hasPresence(c, f)); }
  function withStruct(s) { return wd.clearings.filter(c => hasStruct(c, s)); }

  function conditionMet(f) {
    if (f === 'The Marquisate') return controlledBy(f).length >= 5 || hasStructures(f);
    if (f === 'The Eyrie Dynasties') return roostCount(f) >= 2 || controlledBy(f).length >= 4;
    if (f === 'The Woodland Alliance') return sympathyCount() >= 3 || wd.clearings.some(c => c.control === f && c.base);
    if (f === 'The Lizard Cult') return withStruct('Garden').length >= 2;
    if (f === 'The Riverfolk Company') return withStruct('Trading post').length >= 3;
    if (f === 'The Grand Duchy') return controlledBy(f).length >= 2 && withStruct('Market').length >= 1 && withStruct('Citadel').length >= 1;
    if (f === 'The Corvid Conspiracy') return withStruct('Plot').length >= 3;
    if (f === 'The Hundreds') return withStruct('Mob').length >= 3 || wd.clearings.some(c => c.hoard > 0);
    if (f === 'The Keepers in Iron') return withStruct('Waystation').length >= 2;
    return false;
  }

  // Modifier breakdown for a faction given this round's toggles
  function modBreakdown(f, toggles) {
    const parts = [];
    const most = mostControlledCount();
    FR.modifiers.forEach(m => {
      if (m.toggle) { if (toggles && toggles[m.key]) parts.push({ label: m.label, v: m.v }); }
      else if (m.auto === 'mostClearings') { if (most > 0 && controlledBy(f).length === most) parts.push({ label: m.label, v: m.v }); }
      else if (m.auto === 'condition') { if (conditionMet(f)) parts.push({ label: m.label + ' (' + FR.conditions[f] + ')', v: m.v }); }
      else if (m.persist === 'resource') { if (wd.factionState[f] && wd.factionState[f].resource) parts.push({ label: m.label, v: m.v }); }
      else if (m.persist === 'captured') { if (wd.factionState[f] && wd.factionState[f].captured) parts.push({ label: m.label, v: m.v }); }
    });
    return parts;
  }
  function modTotal(parts) { return parts.reduce((s, p) => s + p.v, 0); }

  // ---------- boon eligibility & targets ----------
  function boonEligible(b, f) { if (b.except && b.except.indexOf(f) >= 0) return false; return b.factions.indexOf('*') >= 0 || b.factions.indexOf(f) >= 0; }
  function boonsFor(f) { return FR.minorBoons.filter(b => boonEligible(b, f)); }
  function majorBoonsFor(f) { return FR.majorBoons.filter(b => boonEligible(b, f)); }
  function targetsFor(need, f) {
    switch (need) {
      case 'adjacentTarget': {
        const owned = new Set(controlledBy(f).map(c => c.id));
        return wd.clearings.filter(c => c.control !== f && [...owned].some(id => neighborIds(id).indexOf(c.id) >= 0));
      }
      case 'controlledTarget': case 'twoControlled': case 'controlledStruct': return controlledBy(f);
      case 'twoTargets': case 'anyTarget': return wd.clearings.slice();
      case 'sympatheticTarget': return wd.clearings.filter(c => c.sympathy);
      case 'eyrieNoRoostTarget': return wd.clearings.filter(c => c.control === f && !c.roost);
      case 'presenceTarget': return presenceOf(f);
      case 'tradingPostTarget': return withStruct('Trading post');
      case 'plotTarget': return withStruct('Plot');
      case 'adjacentToPresence': {
        const pres = new Set(presenceOf(f).map(c => c.id));
        return wd.clearings.filter(c => !hasPresence(c, f) && [...pres].some(id => neighborIds(id).indexOf(c.id) >= 0));
      }
      case 'adjacentToMob': {
        const mobIds = new Set(wd.clearings.filter(c => hasStruct(c, 'Mob') || (c.stronghold && c.control === 'The Hundreds')).map(c => c.id));
        return wd.clearings.filter(c => !hasStruct(c, 'Mob') && [...mobIds].some(id => neighborIds(id).indexOf(c.id) >= 0));
      }
      case 'mobTarget': return withStruct('Mob');
      case 'mobHoardTarget': return wd.clearings.filter(c => hasStruct(c, 'Mob') && c.hoard > 0);
      case 'keepersPresenceNoWaystation': return wd.clearings.filter(c => hasPresence(c, f) && !hasStruct(c, 'Waystation'));
      case 'waystationTarget': return withStruct('Waystation');
      default: return [];
    }
  }

  // ---------- apply boons / defeats ----------
  function logEvent(f, text) { wd.log.push({ round: wd.round, faction: f, text }); }
  function applyBoon(f, key, sel) {
    const c = sel.t1 != null ? byId(sel.t1) : null;
    switch (key) {
      case 'attack': {
        if (!c) return 'Choose a clearing to attack.';
        const RAZABLE = ['Sawmill', 'Workshop', 'Recruiting post', 'Market', 'Citadel'];
        const razable = (c.structures || []).filter(s => RAZABLE.indexOf(s) >= 0);
        if (c.fortified) { c.fortified = false; logEvent(f, 'attacked ' + c.name + ' — destroyed its fortifications'); }
        else if (c.roost || c.base || razable.length) { c.roost = false; c.base = false; c.structures = c.structures.filter(s => RAZABLE.indexOf(s) < 0); logEvent(f, 'attacked ' + c.name + ' — razed its ' + (c.roost ? 'Roost' : c.base ? 'base' : 'structures')); }
        else { const prev = c.control; c.control = f; if (isFactionControl(prev) && prev !== f) c.contested = true; logEvent(f, 'attacked and took control of ' + c.name + (isFactionControl(prev) ? ' (from ' + prev + ')' : '')); }
        break;
      }
      case 'fortify': if (!c) return 'Choose a clearing to fortify.'; c.fortified = true; logEvent(f, 'fortified ' + c.name); break;
      case 'obtain': wd.factionState[f].resource = true; logEvent(f, 'obtained a valuable resource (+2 next roll while held)'); break;
      case 'establish': { const c2 = sel.t2 != null ? byId(sel.t2) : null; if (!c || !c2 || c === c2) return 'Choose two different clearings.'; c.sympathy = true; c2.sympathy = true; logEvent(f, 'established cells — sympathy in ' + c.name + ' and ' + c2.name); break; }
      case 'stamp': { const cl = controlledBy(f).filter(x => x.sympathy); cl.forEach(x => x.sympathy = false); logEvent(f, 'stamped out cells — removed sympathy from ' + (cl.length ? cl.map(x => x.name).join(', ') : 'its clearings')); break; }
      case 'industry': { const c2 = sel.t2 != null ? byId(sel.t2) : null; if (!c || !c2 || c === c2) return 'Choose two different controlled clearings.'; const ty = sel.type || W.factionRoll.industryTypes[0]; addStruct(c, ty); addStruct(c2, sel.type2 || ty); logEvent(f, 'built industry — ' + ty + ' in ' + c.name + ', ' + (sel.type2 || ty) + ' in ' + c2.name); break; }
      case 'gardenBuild': if (!c) return 'Choose a clearing with presence.'; addStruct(c, 'Garden'); logEvent(f, 'built a garden in ' + c.name); break;
      case 'proselytize': if (!c) return 'Choose a clearing.'; addPresence(c, f); logEvent(f, 'proselytized — added presence to ' + c.name); break;
      case 'commerce': if (!c) return 'Choose a clearing.'; addPresence(c, f); logEvent(f, 'conducted commerce — added presence to ' + c.name); break;
      case 'tradingPost': if (!c) return 'Choose a clearing with presence.'; addStruct(c, 'Trading post'); logEvent(f, 'built a trading post in ' + c.name); break;
      case 'tunnel': if (!c) return 'Choose a clearing.'; addStruct(c, 'Tunnel'); logEvent(f, 'connected a tunnel to ' + c.name); break;
      case 'marketCitadel': { if (!c) return 'Choose a controlled clearing.'; const ty = sel.type || 'Market'; addStruct(c, ty); logEvent(f, 'built a ' + ty.toLowerCase() + ' in ' + c.name); break; }
      case 'expand': { const c2 = sel.t2 != null ? byId(sel.t2) : null; if (!c) return 'Choose a clearing adjacent to presence.'; addPresence(c, f); if (c2 && c2 !== c) addPresence(c2, f); logEvent(f, 'expanded its network — presence to ' + c.name + (c2 && c2 !== c ? ' and ' + c2.name : '')); break; }
      case 'enactPlot': if (!c) return 'Choose a clearing with presence.'; addStruct(c, 'Plot'); logEvent(f, 'enacted a plot in ' + c.name); break;
      case 'stampPlot': { const cl = controlledBy(f).filter(x => hasStruct(x, 'Plot')); cl.forEach(x => x.structures = x.structures.filter(s => s !== 'Plot')); logEvent(f, 'stamped out plots' + (cl.length ? ' in ' + cl.map(x => x.name).join(', ') : ' in its clearings')); break; }
      case 'revolt': if (!c) return 'Choose a sympathetic clearing.'; c.base = true; c.control = 'The Woodland Alliance'; c.roost = false; c.structures = []; c.fortified = false; c.contested = true; logEvent(f, 'led a revolt in ' + c.name + ' — a base rises, all other structures fall'); break;
      case 'buildRoost': if (!c) return 'Choose an Eyrie clearing without a Roost.'; c.roost = true; logEvent(f, 'built a Roost in ' + c.name); break;
      case 'capture': { const tf = sel.faction; if (!tf) return 'Choose an enemy faction to capture from.'; wd.factionState[tf] = wd.factionState[tf] || { resource: false, captured: false }; wd.factionState[tf].captured = true; logEvent(f, 'captured a leader of ' + tf + ' (−1 on their rolls while held)'); break; }
      case 'rapidGarden': if (!c) return 'Choose a clearing with presence.'; addStruct(c, 'Garden'); { const prev = c.control; c.control = f; if (isFactionControl(prev) && prev !== f) c.contested = true; } logEvent(f, 'rapidly built a garden and took control of ' + c.name); break;
      case 'tradeWar': { const c2 = sel.t2 != null ? byId(sel.t2) : null; if (!c) return 'Choose a clearing with a trading post.'; const prev = c.control; c.control = f; if (isFactionControl(prev) && prev !== f) c.contested = true; if (c2 && c2 !== c) addStruct(c2, 'Trading post'); logEvent(f, 'launched a trade war — took ' + c.name + (c2 && c2 !== c ? ' and built a trading post in ' + c2.name : '')); break; }
      case 'culminatePlot': { if (!c) return 'Choose a clearing with a plot.'; const prev = c.control; c.control = f; if (isFactionControl(prev) && prev !== f) c.contested = true; logEvent(f, 'culminated a plot — took control of ' + c.name); break; }
      case 'inciteMob': if (!c) return 'Choose a clearing adjacent to a mob.'; addStruct(c, 'Mob'); logEvent(f, 'incited a mob in ' + c.name); break;
      case 'buildHoard': {
        if (!c) return 'Choose a clearing with a mob.';
        const RAZ = ['Sawmill', 'Workshop', 'Recruiting post', 'Market', 'Citadel', 'Garden', 'Trading post', 'Tunnel', 'Fortifications'];
        const enemy = (c.structures || []).filter(s => RAZ.indexOf(s) >= 0);
        const n = Math.ceil(d6() / 2), destroyed = Math.min(n, enemy.length);
        for (let k = 0; k < destroyed; k++) removeStruct(c, enemy[k]);
        const val = destroyed > 0 ? destroyed * 5 : 5;
        c.hoard = (c.hoard || 0) + val;
        logEvent(f, 'built a hoard in ' + c.name + ' (Value ' + c.hoard + (destroyed ? ', razed ' + destroyed + ' structure' + (destroyed === 1 ? '' : 's') : '') + ')'); break;
      }
      case 'sendCadre': if (!c) return 'Choose a clearing.'; addPresence(c, f); logEvent(f, 'sent a cadre — presence to ' + c.name); break;
      case 'moveWaystation': { if (!c) return 'Choose a Keepers-presence clearing.'; const from = wd.clearings.find(x => hasStruct(x, 'Waystation')); if (from) removeStruct(from, 'Waystation'); addStruct(c, 'Waystation'); logEvent(f, 'moved a waystation' + (from ? ' from ' + from.name : '') + ' to ' + c.name); break; }
      case 'wildUprising': {
        if (!c) return 'Choose a clearing with a mob and a hoard.';
        c.control = 'The Hundreds'; addStruct(c, 'Warriors');
        c.structures = (c.structures || []).filter(s => s === 'Mob' || s === 'Warriors');
        c.roost = false; c.base = false; c.fortified = false; c.contested = true;
        const strong = wd.clearings.find(x => x.stronghold && x.control === 'The Hundreds');
        if (strong) strong.hoard = (strong.hoard || 0) + (c.hoard || 0);
        const sent = c.hoard || 0; c.hoard = 0;
        logEvent(f, 'a wild uprising seizes ' + c.name + (sent ? '; a hoard of ' + sent + ' heads for the stronghold' : '')); break;
      }
      case 'establishWaystation': if (!c) return 'Choose a Keepers-presence clearing.'; addStruct(c, 'Waystation'); logEvent(f, 'established a waystation in ' + c.name); break;
      case 'discoverRuins': if (!c) return 'Choose a waystation clearing.'; c.ruin = true; logEvent(f, 'discovered a ruin near ' + c.name); break;
      default: return 'Unknown boon.';
    }
    return null;
  }
  function applyDefeat(f, type, sel) {
    const c = sel.t1 != null ? byId(sel.t1) : null;
    if (type === 'clearing') { if (!c) return 'Choose a clearing to lose.'; c.control = null; c.roost = false; c.base = false; c.fortified = false; c.structures = []; logEvent(f, 'lost control of ' + c.name + ' — it returns to its denizens'); }
    else if (type === 'structure') { if (!c) return 'Choose where a structure falls.'; if (c.fortified) { c.fortified = false; logEvent(f, 'lost the fortifications at ' + c.name); } else if (c.roost) { c.roost = false; logEvent(f, 'lost the Roost at ' + c.name); } else if (c.base) { c.base = false; logEvent(f, 'lost the base at ' + c.name); } else if (c.structures.length) { const s = c.structures.pop(); logEvent(f, 'lost the ' + s + ' at ' + c.name); } else return 'That clearing has no structure to lose.'; }
    else if (type === 'resource') { wd.factionState[f].resource = false; logEvent(f, 'lost its valuable resource'); }
    else return 'Choose a defeat.';
    return null;
  }

  // ---------- read-only map ----------
  const CONTROL_COLOR = {
    'The Marquisate': '#e08a4a', 'The Eyrie Dynasties': '#4a8ec2', 'The Woodland Alliance': '#68a054',
    'The Lizard Cult': '#c46a8f', 'The Riverfolk Company': '#3fb0a4', 'The Grand Duchy': '#9a7bd0', 'The Corvid Conspiracy': '#555b63',
    'The Hundreds': '#b5462f', 'The Keepers in Iron': '#7d7a6a'
  };
  const COMMUNITY_COLOR = { Rabbit: '#d3e2ba', Mouse: '#e4d9bf', Fox: '#eecaa4' };
  const COMMUNITY_ICON = { Rabbit: '🐰', Mouse: '🐭', Fox: '🦊' };
  const SYMPATHY_COLOR = '#4e9a3e';
  const STRUCT_GLYPH = { 'Garden': '❀', 'Trading post': '⚑', 'Tunnel': '◎', 'Market': '$', 'Citadel': '▣', 'Plot': '✦', 'Mob': '‡', 'Waystation': '⌘', 'Warriors': '⚔', 'Sawmill': '⚒', 'Workshop': '⚒', 'Recruiting post': '⚒' };
  function controlColor(c) { return isFactionControl(c.control) ? (CONTROL_COLOR[c.control] || '#b3a07a') : null; }
  // Thick faction-colored border = control; thin neutral border = denizen-held / uncontrolled.
  function controlBorder(c) { const col = controlColor(c); return col ? { col, w: 6 } : { col: '#5a4a30', w: 2.5 }; }
  function marks(c) {
    const m = [];
    if (c.ruin) m.push('▨');
    if (c.stronghold) m.push('★'); if (c.roost) m.push('⌂'); if (c.base) m.push('▲'); if (c.fortified) m.push('▮');
    (c.structures || []).forEach(s => m.push(STRUCT_GLYPH[s] || '⚒'));
    if (c.hoard) m.push('◈');
    return m.length ? '<text class="mark" x="' + c.x + '" y="' + (c.y - NODE_R - 7) + '" text-anchor="middle">' + m.join(' ') + '</text>' : '';
  }
  // Presence shown as small faction-colored dots along the bottom of the node.
  function presenceDots(c) {
    const p = c.presence || []; if (!p.length) return '';
    const w = 12, start = c.x - (p.length - 1) * w / 2, y = c.y + NODE_R - 2;
    return p.map((f, i) => '<circle cx="' + Math.round(start + i * w) + '" cy="' + y + '" r="5" fill="' + (CONTROL_COLOR[f] || '#888') + '" stroke="#3b2c1a" stroke-width="1.5"/>').join('');
  }
  function sympathyDot(c) {
    if (!c.sympathy) return '';
    const dx = Math.round(NODE_R * 0.866), dy = Math.round(NODE_R * 0.5); // 2 o'clock on the rim
    return '<circle cx="' + (c.x + dx) + '" cy="' + (c.y - dy) + '" r="9" fill="' + SYMPATHY_COLOR + '" stroke="#2c5320" stroke-width="2"/>';
  }
  function renderMap() {
    const byid = {}; wd.clearings.forEach(c => byid[c.id] = c);
    const edges = wd.edges.map(e => { const a = byid[e[0]], b = byid[e[1]]; return (a && b) ? '<line class="edge" x1="' + a.x + '" y1="' + a.y + '" x2="' + b.x + '" y2="' + b.y + '"/>' : ''; }).join('');
    const nodes = wd.clearings.map(c => { const bd = controlBorder(c); return '<g><circle cx="' + c.x + '" cy="' + c.y + '" r="' + NODE_R + '" fill="' + (COMMUNITY_COLOR[c.community] || '#e4d9bf') + '" stroke="' + bd.col + '" stroke-width="' + bd.w + '"/>' +
      '<text class="ico" x="' + c.x + '" y="' + (c.y + 1) + '" text-anchor="middle" dominant-baseline="central">' + (COMMUNITY_ICON[c.community] || '') + '</text>' +
      '<text class="nm" x="' + c.x + '" y="' + (c.y + NODE_R + 18) + '" text-anchor="middle">' + esc(c.name) + '</text>' + marks(c) + sympathyDot(c) + presenceDots(c) + '</g>'; }).join('');
    return '<svg class="woodmap" viewBox="0 0 ' + VB_W + ' ' + VB_H + '" xmlns="http://www.w3.org/2000/svg">' + edges + nodes + '</svg>';
  }

  // ---------- render ----------
  function render() {
    if (!wd) { renderLoad(); return; }
    exportBtn.disabled = false;
    let h = '<div class="dash">';
    h += '<div class="wtitle"><h1>The Woodland</h1><span class="roundpill">' + (wd.round ? 'After ' + wd.round + ' turn' + (wd.round === 1 ? '' : 's') + ' of war' : 'War begins') + '</span></div>';
    h += '<div class="mapwrap">' + renderMap() + '</div>' + legend();
    h += summaryPanel();
    h += roundPanel();
    h += logPanel();
    h += '</div>';
    app.innerHTML = h;
    wire();
    save();
  }

  function legend() {
    // only show swatches for factions actually in play
    const ctrl = factionsPresent().map(f => [f, CONTROL_COLOR[f] || '#b3a07a']);
    return '<div class="map-legend"><span style="font-weight:700">Border = control:</span>' +
      ctrl.map(l => '<span><span class="lgdot" style="background:transparent;border:3px solid ' + l[1] + '"></span>' + esc(l[0]) + '</span>').join('') +
      '<span><span class="lgdot" style="background:transparent;border:2px solid #5a4a30"></span>Denizen-held</span>' +
      '<span><span class="lgdot" style="background:' + SYMPATHY_COLOR + ';border-color:#2c5320"></span>Sympathy</span>' +
      '<span><span class="lgdot" style="background:#c46a8f"></span>presence (filled dot)</span>' +
      '<span>★⌂▲ base · ▮ fort · ❀ garden · ⚑ post · ◎ tunnel · $ market · ▣ citadel · ✦ plot</span></div>';
  }

  function summaryPanel() {
    let h = '<div class="panel"><p class="eyebrow" style="margin:0 0 10px">The factions</p><div class="summary-grid">';
    factionsPresent().forEach(f => {
      const st = wd.factionState[f] || {};
      const bits = [controlledBy(f).length + ' clearings'];
      if (roostCount(f)) bits.push(roostCount(f) + ' Roosts');
      if (wd.clearings.filter(c => c.control === f && c.base).length) bits.push('a base');
      if (presenceOf(f).length) bits.push(presenceOf(f).length + ' presence');
      if (f === 'The Hundreds') { const hv = wd.clearings.reduce((a, c) => a + (c.hoard || 0), 0); if (hv) bits.push('hoards worth ' + hv); }
      if (f === 'The Keepers in Iron') { const rn = wd.clearings.filter(c => c.ruin).length; if (rn) bits.push(rn + ' ruins'); }
      const OWNED = { 'Garden': 'The Lizard Cult', 'Trading post': 'The Riverfolk Company', 'Plot': 'The Corvid Conspiracy', 'Mob': 'The Hundreds', 'Warriors': 'The Hundreds', 'Waystation': 'The Keepers in Iron' };
      const myStructs = {}; wd.clearings.forEach(c => (c.structures || []).forEach(s => { const owner = OWNED[s]; if (owner ? owner === f : c.control === f) myStructs[s] = (myStructs[s] || 0) + 1; }));
      const structTxt = Object.keys(myStructs).map(s => myStructs[s] + '× ' + s).join(', ');
      h += '<div class="fsum"><h4>' + esc(f) + '</h4>' +
        '<div class="fstat">' + bits.join(' · ') + '</div>' +
        (structTxt ? '<div class="fstat">' + esc(structTxt) + '</div>' : '') +
        (conditionMet(f) ? '<div class="fstat" style="color:var(--alliance-dk)">strength condition met</div>' : '') +
        (st.resource ? '<div class="fstat">holds a resource (+2)</div>' : '') +
        (st.captured ? '<div class="fstat" style="color:var(--rust)">leader held captive (−1)</div>' : '') +
        '</div>';
    });
    h += '<div class="fsum"><h4>Denizens &amp; free</h4><div class="fstat">' + wd.clearings.filter(c => !isFactionControl(c.control)).length + ' clearings not under a faction · ' + sympathyCount() + ' with sympathy</div></div>';
    h += '</div></div>';
    return h;
  }

  // ---------- round panel ----------
  function roundPanel() {
    let h = '<div class="panel"><p class="eyebrow" style="margin:0 0 10px">Time passes — the war continues</p>';
    h += '<p class="small muted" style="margin:0 0 12px">' + esc(FR.description) + ' ' + esc(FR.order) + '</p>';
    if (!round) {
      h += '<button class="dice primary" id="startRound">🎲 Advance the war — roll each faction</button>';
      h += '</div>';
      return h;
    }
    round.queue.forEach((f, i) => {
      const state = i < round.idx ? 'done' : (i === round.idx ? 'active' : 'pending');
      h += factionCard(f, i, state);
    });
    if (round.idx >= round.queue.length) {
      h += '<div style="margin-top:10px"><button class="dice primary" id="startRound">🎲 Let more time pass (another round)</button> ' +
        '<button class="dice" id="endRound">Finish for now</button></div>';
    }
    h += '</div>';
    return h;
  }

  function factionCard(f, i, state) {
    if (state === 'pending') return '<div class="factioncard pending"><h3>' + esc(f) + '</h3><p class="small muted" style="margin:0">Waiting its turn…</p></div>';
    if (state === 'done') {
      const res = round.results[f];
      return '<div class="factioncard"><h3>' + esc(f) + ' <span class="tierbadge ' + tierCls(res.tier) + '">' + tierLabel(res.tier) + '</span></h3>' +
        '<p class="small" style="margin:2px 0 0">Rolled ' + res.total + '. ' + esc(res.summary) + '</p></div>';
    }
    // active
    const cur = round.cur;
    const parts = modBreakdown(f, cur.toggles);
    const tot = modTotal(parts);
    let h = '<div class="factioncard active"><h3>' + esc(f) + '</h3>';
    h += '<p class="small muted" style="margin:0 0 8px">' + controlledBy(f).length + ' clearings held.</p>';
    // modifiers
    parts.forEach(p => { h += '<div class="modline"><span>' + esc(p.label) + '</span><span class="mv ' + (p.v >= 0 ? 'pos' : 'neg') + '">' + fmt(p.v) + '</span></div>'; });
    FR.modifiers.filter(m => m.toggle).forEach(m => {
      h += '<label class="modtoggle"><input type="checkbox" data-toggle="' + m.key + '"' + (cur.toggles[m.key] ? ' checked' : '') + (cur.rolled ? ' disabled' : '') + '> ' + esc(m.label) + ' <span class="mv ' + (m.v >= 0 ? 'pos' : 'neg') + '">' + fmt(m.v) + '</span></label>';
    });
    h += '<div class="modtotal">Roll modifier: <b>' + fmt(tot) + '</b></div>';
    if (!cur.rolled) {
      h += '<div style="margin-top:10px"><button class="dice primary" id="rollFaction">🎲 Roll 2d6 ' + fmt(tot) + '</button></div>';
    } else {
      h += '<div class="rollout"><span class="big">' + cur.total + '</span><span class="tierbadge ' + tierCls(cur.tier) + '">' + tierLabel(cur.tier) + '</span>' +
        '<span class="small muted">2d6 (' + cur.a + '+' + cur.b + '=' + cur.base + ') ' + fmt(cur.mod) + ' = ' + cur.total + '</span></div>';
      h += resolution(f);
      h += '<div style="margin-top:10px"><button class="dice primary" id="applyFaction">Apply &amp; continue</button></div>';
    }
    h += '</div>';
    return h;
  }

  function resolution(f) {
    const cur = round.cur;
    if (cur.tier === '6-') {
      let h = '<label class="mini">Defeat — the faction loses one:</label>';
      h += '<div class="boonslot"><select id="defeatType">' +
        '<option value="">— choose —</option>' +
        '<option value="clearing">Control of a clearing (back to denizens)</option>' +
        '<option value="structure">A fortification or structure</option>' +
        '<option value="resource"' + (wd.factionState[f].resource ? '' : ' disabled') + '>A valuable resource</option>' +
        '</select>';
      if (cur.defeatType === 'clearing') h += targetSelect('dt1', controlledBy(f), 'Which clearing?');
      if (cur.defeatType === 'structure') h += targetSelect('dt1', wd.clearings.filter(c => c.control === f && (c.fortified || c.roost || c.base || c.structures.length)), 'Where?');
      h += '</div>';
      return h;
    }
    // hit or 10+: one minor boon, and (10+) a second minor or a major
    let h = '<label class="mini">' + (cur.tier === '10+' ? 'Great victory — a minor boon, then another minor or a major boon' : 'Victory — choose one minor boon') + '</label>';
    h += boonSlot(f, 1, 'minor');
    if (cur.tier === '10+') h += boonSlot(f, 2, 'both');
    return h;
  }

  function boonSlot(f, n, kind) {
    const cur = round.cur, selKey = 'slot' + n, sel = cur[selKey] || '';
    const minor = boonsFor(f), major = majorBoonsFor(f);
    let opts = '<option value="">— choose a boon —</option>';
    opts += '<optgroup label="Minor boons">' + minor.map(b => '<option value="minor:' + b.key + '"' + (sel === 'minor:' + b.key ? ' selected' : '') + '>' + esc(b.name) + '</option>').join('') + '</optgroup>';
    if (kind === 'both') opts += '<optgroup label="Major boons">' + major.map(b => '<option value="major:' + b.key + '"' + (sel === 'major:' + b.key ? ' selected' : '') + '>' + esc(b.name) + '</option>').join('') + '</optgroup>';
    let h = '<div class="boonslot"><select data-slot="' + n + '">' + opts + '</select>';
    if (sel) {
      const [tierK, key] = sel.split(':');
      const boon = (tierK === 'minor' ? minor : major).find(b => b.key === key);
      if (boon) {
        h += '<p class="bdesc">' + esc(boon.description) + '</p>';
        h += targetInputs(f, n, boon);
      }
    }
    h += '</div>';
    return h;
  }

  function targetInputs(f, n, boon) {
    const need = boon.needs;
    if (!need) return '';
    if (need === 'enemyFaction') {
      const enemies = factionsPresent().filter(x => x !== f);
      return targetSelectRaw('bt' + n + '_1', enemies.map(e => ({ id: e, name: e })), 'Capture from which faction?');
    }
    if (need === 'twoTargets' || need === 'twoControlled') {
      const list = targetsFor(need, f);
      let h = targetSelect('bt' + n + '_1', list, 'First clearing');
      h += targetSelect('bt' + n + '_2', list, 'Second clearing');
      if (need === 'twoControlled') {
        h += '<label class="mini">Structures</label>' + indSelect(n + '_1', W.factionRoll.industryTypes) + ' ' + indSelect(n + '_2', W.factionRoll.industryTypes);
      }
      return h;
    }
    if (need === 'adjacentToPresence') { // Corvid Expand network — up to two
      const list = targetsFor(need, f);
      return targetSelect('bt' + n + '_1', list, 'Clearing (adjacent to presence)') + targetSelect('bt' + n + '_2', list, 'Second clearing (optional)');
    }
    if (need === 'controlledStruct') { // Duchy market/citadel
      return targetSelect('bt' + n + '_1', targetsFor(need, f), 'Controlled clearing') +
        '<label class="mini">Build</label>' + indSelect(n + '_1', ['Market', 'Citadel']);
    }
    if (boon.key === 'tradeWar') { // Riverfolk — take a trading-post clearing + add a post adjacent
      return targetSelect('bt' + n + '_1', targetsFor('tradingPostTarget', f), 'Clearing with a trading post') +
        targetSelect('bt' + n + '_2', wd.clearings.slice(), 'Adjacent clearing for a new trading post');
    }
    const labels = { presenceTarget: 'Clearing with presence', anyTarget: 'Any clearing', controlledTarget: 'Controlled clearing', sympatheticTarget: 'Sympathetic clearing', eyrieNoRoostTarget: 'Eyrie clearing without a Roost', adjacentTarget: 'Adjacent clearing to attack', tradingPostTarget: 'Clearing with a trading post', plotTarget: 'Clearing with a plot', adjacentToMob: 'Clearing adjacent to a mob', mobTarget: 'Clearing with a mob', mobHoardTarget: 'Clearing with a mob and a hoard', keepersPresenceNoWaystation: 'Keepers-presence clearing (no waystation)', waystationTarget: 'Waystation clearing' };
    return targetSelect('bt' + n + '_1', targetsFor(need, f), labels[need] || 'Target clearing');
  }

  function indSelect(dataId, opts) {
    const cur = (round && round.cur && round.cur.targets) ? (round.cur.targets['ind_' + dataId] || '') : '';
    return '<select data-industry="' + dataId + '">' + opts.map(t => '<option' + (t === cur ? ' selected' : '') + '>' + t + '</option>').join('') + '</select>';
  }
  function targetSelect(id, list, label) { return targetSelectRaw(id, list.map(c => ({ id: c.id, name: c.name + ' (' + (isFactionControl(c.control) ? c.control : (c.control === UNCONTROLLED ? 'uncontrolled' : 'denizens')) + ')' })), label); }
  function targetSelectRaw(id, opts, label) {
    const cur = (round && round.cur && round.cur.targets) ? (round.cur.targets[id] || '') : '';
    return '<label class="mini">' + esc(label) + '</label><select data-target="' + id + '"><option value="">— choose —</option>' +
      opts.map(o => '<option value="' + esc(o.id) + '"' + (String(o.id) === String(cur) ? ' selected' : '') + '>' + esc(o.name) + '</option>').join('') + '</select>';
  }

  function tierCls(t) { return t === '10+' ? 'tier-10' : (t === '7-9' ? 'tier-79' : 'tier-6'); }
  function tierLabel(t) { return t === '10+' ? 'Great victory' : (t === '7-9' ? 'Victory' : 'Defeat'); }

  function logPanel() {
    if (!wd.log.length) return '';
    let h = '<div class="panel"><p class="eyebrow" style="margin:0 0 8px">War log</p><ul class="log">';
    let lastRound = null;
    wd.log.forEach(e => {
      if (e.round !== lastRound) { h += '<li class="round-sep">Turn ' + e.round + '</li>'; lastRound = e.round; }
      h += '<li><span class="who">' + esc(e.faction) + '</span> ' + esc(e.text) + '.</li>';
    });
    h += '</ul></div>';
    return h;
  }

  // ---------- wiring ----------
  function wire() {
    const sr = document.getElementById('startRound'); if (sr) sr.addEventListener('click', startRound);
    const er = document.getElementById('endRound'); if (er) er.addEventListener('click', () => { round = null; render(); });
    app.querySelectorAll('[data-toggle]').forEach(el => el.addEventListener('change', () => { round.cur.toggles[el.getAttribute('data-toggle')] = el.checked; render(); }));
    const rf = document.getElementById('rollFaction'); if (rf) rf.addEventListener('click', rollFaction);
    app.querySelectorAll('[data-slot]').forEach(el => el.addEventListener('change', () => { round.cur['slot' + el.getAttribute('data-slot')] = el.value; render(); }));
    // Persist target / structure selections so a re-render (e.g. picking the 2nd boon) doesn't wipe them.
    app.querySelectorAll('[data-target]').forEach(el => el.addEventListener('change', () => { round.cur.targets[el.getAttribute('data-target')] = el.value; }));
    app.querySelectorAll('[data-industry]').forEach(el => el.addEventListener('change', () => { round.cur.targets['ind_' + el.getAttribute('data-industry')] = el.value; }));
    const dt = document.getElementById('defeatType'); if (dt) dt.addEventListener('change', () => { round.cur.defeatType = dt.value; render(); });
    const af = document.getElementById('applyFaction'); if (af) af.addEventListener('click', applyFaction);
  }

  function startRound() {
    wd.round += 1;
    round = { queue: factionOrder(), idx: 0, results: {}, cur: freshCur() };
    if (!round.queue.length) { toast('No non-denizen factions to roll for.'); round = null; wd.round -= 1; return; }
    render();
  }
  function freshCur() { return { toggles: {}, rolled: false, slot1: '', slot2: '', defeatType: '', targets: {} }; }
  function rollFaction() {
    const f = round.queue[round.idx];
    const parts = modBreakdown(f, round.cur.toggles);
    const mod = modTotal(parts);
    const a = d6(), b = d6(), base = a + b, total = base + mod;
    Object.assign(round.cur, { rolled: true, a, b, base, mod, total, tier: total >= 10 ? '10+' : (total >= 7 ? '7-9' : '6-') });
    render();
  }

  function readTarget(id) {
    const stored = (round && round.cur && round.cur.targets) ? round.cur.targets[id] : undefined;
    const el = app.querySelector('[data-target="' + id + '"]');
    const v = (stored != null && stored !== '') ? stored : (el && el.value !== '' ? el.value : null);
    if (v == null || v === '') return null;
    return isNaN(+v) ? v : +v;
  }
  function readIndustry(dataId) {
    const stored = (round && round.cur && round.cur.targets) ? round.cur.targets['ind_' + dataId] : undefined;
    const el = app.querySelector('[data-industry="' + dataId + '"]');
    return (stored != null && stored !== '') ? stored : (el ? el.value : null);
  }
  function applyFaction() {
    const f = round.queue[round.idx], cur = round.cur;
    let err = null, summaries = [];
    if (cur.tier === '6-') {
      const type = cur.defeatType;
      if (!type) { toast('Choose the defeat.'); return; }
      err = applyDefeat(f, type, { t1: readTarget('dt1') });
      if (err) { toast(err); return; }
      summaries.push('Defeat resolved');
    } else {
      const slots = cur.tier === '10+' ? [1, 2] : [1];
      // resource consumed on a roll that used it
      for (const n of slots) {
        const sel = cur['slot' + n]; if (!sel) { toast('Choose boon ' + n + '.'); return; }
        const [tierK, key] = sel.split(':');
        const s = { t1: readTarget('bt' + n + '_1'), t2: readTarget('bt' + n + '_2'), faction: readTarget('bt' + n + '_1') };
        const i1 = readIndustry(n + '_1'), i2 = readIndustry(n + '_2');
        if (i1) s.type = i1; if (i2) s.type2 = i2;
        if (key === 'capture') s.faction = readTarget('bt' + n + '_1');
        err = applyBoon(f, key, s);
        if (err) { toast(err); return; }
      }
      summaries.push(cur.tier === '10+' ? 'Two boons taken' : 'One boon taken');
    }
    // consume a one-shot resource bonus after a completed roll (Obtain re-grants it)
    round.results[f] = { tier: cur.tier, total: cur.total, summary: summaries.join('; ') };
    round.idx += 1;
    round.cur = freshCur();
    render();
  }

  // ---------- load / export ----------
  function loadFromText(text) {
    let data; try { data = JSON.parse(text); } catch (e) { toast('That file is not valid JSON.'); return; }
    if (!data || data._format !== 'bellum-arborem.woodland') { if (!confirm('This does not look like a Bellum Arborem Woodland. Load anyway?')) return; }
    if (!Array.isArray(data.clearings) || !data.clearings.length) { toast('That Woodland has no clearings.'); return; }
    wd = normalize(data); round = null; render();
    toast('Loaded Woodland (' + wd.clearings.length + ' clearings)');
  }
  importBtn.addEventListener('click', () => importFile.click());
  importFile.addEventListener('change', () => { const f = importFile.files[0]; if (!f) return; const rd = new FileReader(); rd.onload = () => { loadFromText(rd.result); importFile.value = ''; }; rd.readAsText(f); });
  exportBtn.addEventListener('click', () => {
    if (!wd) return;
    const blob = new Blob([JSON.stringify(wd, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob); const a = document.createElement('a');
    a.href = url; a.download = 'bellum-arborem-woodland-turn' + wd.round + '.json'; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000); toast('Exported the Woodland');
  });

  function renderLoad() {
    exportBtn.disabled = true;
    const hasWip = !!localStorage.getItem(STORE_KEY);
    const hasCreator = !!localStorage.getItem(CREATOR_KEY);
    let h = '<div class="panel loadpane"><div class="big">⚔️</div>';
    h += '<h2 style="margin:0 0 8px">Load a Woodland to advance</h2>';
    h += '<p class="muted" style="max-width:54ch;margin:0 auto 18px">Import a Woodland you built in the Woodland Creator, then let time pass — roll each faction and watch the war shift the map.</p>';
    h += '<div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap">';
    h += '<button class="btn" id="loadImport">Import Woodland JSON…</button>';
    if (hasWip) h += '<button class="btn ghost" id="loadWip">Resume last session</button>';
    if (hasCreator) h += '<button class="btn ghost" id="loadCreator">Load from Woodland Creator</button>';
    h += '</div></div>';
    app.innerHTML = h;
    document.getElementById('loadImport').addEventListener('click', () => importFile.click());
    const lw = document.getElementById('loadWip'); if (lw) lw.addEventListener('click', () => { try { wd = normalize(JSON.parse(localStorage.getItem(STORE_KEY))); render(); toast('Resumed'); } catch (e) { toast('Could not read saved session'); } });
    const lc = document.getElementById('loadCreator'); if (lc) lc.addEventListener('click', () => { try { const d = JSON.parse(localStorage.getItem(CREATOR_KEY)); if (!d.clearings || !d.clearings.length) return toast('The Creator draft has no clearings yet.'); wd = normalize(d); render(); toast('Loaded from Creator'); } catch (e) { toast('Could not read Creator draft'); } });
  }

  // ---------- boot ----------
  (function boot() {
    try { const wip = localStorage.getItem(STORE_KEY); if (wip) { const d = JSON.parse(wip); if (d && Array.isArray(d.clearings) && d.clearings.length) wd = normalize(d); } } catch (e) {}
    render();
  })();
})();
