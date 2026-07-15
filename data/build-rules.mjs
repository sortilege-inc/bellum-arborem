#!/usr/bin/env node
/* Regenerate data/root-rules.js (a browser-loadable window.ROOT_RULES global)
   from the canonical data/root-rules.json. Run: node data/build-rules.mjs */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const jsonPath = join(here, 'root-rules.json');
const jsPath = join(here, 'root-rules.js');

const raw = readFileSync(jsonPath, 'utf8');
const data = JSON.parse(raw); // validate
const banner = '/* GENERATED from root-rules.json by build-rules.mjs — do not edit by hand. */\n';
writeFileSync(jsPath, banner + 'window.ROOT_RULES = ' + JSON.stringify(data) + ';\n');
console.log('Wrote ' + jsPath + ' (' + data.playbooks?.length + ' playbooks)');
