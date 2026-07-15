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

for (const b of BUILDS) {
  const data = JSON.parse(readFileSync(join(here, b.json), 'utf8')); // validate
  const banner = '/* GENERATED from ' + b.json + ' by build-rules.mjs — do not edit by hand. */\n';
  writeFileSync(join(here, b.js), banner + 'window.' + b.global + ' = ' + JSON.stringify(data) + ';\n');
  console.log('Wrote ' + b.js + ' (window.' + b.global + ')');
}
