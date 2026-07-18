#!/usr/bin/env node
/* Regenerate the browser-loadable rule globals from their canonical JSON.
   Each *-rules.json becomes a *-rules.js that assigns a window.<GLOBAL>.
   Run: node data/build-rules.mjs */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

const BUILDS = [
  { json: 'root-rules.json',     js: 'root-rules.js',     global: 'ROOT_RULES' },
  { json: 'woodland-rules.json', js: 'woodland-rules.js', global: 'ROOT_WOODLAND' }
];

// Narrow bundles: reference-only pages load just the slice they use instead of the
// whole ~350 KB root-rules.js. Each slice mirrors the shape the page expects (R.<key>).
const SLICES = [
  { json: 'root-rules.json', js: 'root-relics.js',   global: 'ROOT_RELICS',   keys: ['relics'] },
  { json: 'root-rules.json', js: 'root-monsters.js', global: 'ROOT_MONSTERS', keys: ['monsters'] }
];

// Escape "</script>" so rules text can never break out of the generated <script> element.
const emit = (obj) => JSON.stringify(obj).replace(/</g, '\\u003c');

for (const b of BUILDS) {
  const data = JSON.parse(readFileSync(join(here, b.json), 'utf8')); // validate
  const banner = '/* GENERATED from ' + b.json + ' by build-rules.mjs — do not edit by hand. */\n';
  writeFileSync(join(here, b.js), banner + 'window.' + b.global + ' = ' + emit(data) + ';\n');
  console.log('Wrote ' + b.js + ' (window.' + b.global + ')');
}

for (const s of SLICES) {
  const data = JSON.parse(readFileSync(join(here, s.json), 'utf8'));
  const slice = {};
  for (const k of s.keys) slice[k] = data[k];
  const banner = '/* GENERATED slice of ' + s.json + ' (' + s.keys.join(', ') + ') by build-rules.mjs — do not edit by hand. */\n';
  writeFileSync(join(here, s.js), banner + 'window.' + s.global + ' = ' + emit(slice) + ';\n');
  console.log('Wrote ' + s.js + ' (window.' + s.global + ', keys: ' + s.keys.join(', ') + ')');
}
