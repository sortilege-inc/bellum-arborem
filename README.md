# Bellum Arborem

A companion web app for **Root: The Roleplaying Game** (Magpie Games, Powered by the Apocalypse) — styled after the *Root* board game's warm, storybook Woodland.

Static, no-build-required HTML/CSS/JS. Open the files directly in a browser or serve the folder.

## Sections

- **Character Creator** (`character-creator.html`) — build a vagabond step by step: pick a
  playbook, take its stat spread, choose your nature, drives, playbook moves, weapon skills,
  roguish feats, equipment, and connections, then set starting faction reputation. Export the
  finished character as a JSON file, or import a saved character to keep playing.

More sections to come.

## Data

- `data/root-rules.json` — canonical, machine-readable Root ruleset (stats, playbooks, moves,
  natures, drives, equipment, feats, factions, reputation scale). Extracted from the
  `titterpig-dsl-root` DSL corpus. **This is the source of truth.**
- `data/root-rules.js` — generated wrapper that exposes the same data as `window.ROOT_RULES`
  so pages can load it via `<script>` and work from `file://` (no local server needed).

Regenerate the wrapper after editing the JSON:

```sh
node data/build-rules.mjs
```

## Character file format

The Character Creator exports a portable JSON character (`_format: "bellum-arborem.character"`).
Import reads the same shape, so a character exported from one session can be loaded in another.

## Layout

```
index.html               Landing page (Woodland hub)
character-creator.html    Character creator app
css/app.css               Shared Root-styled design system
js/creator.js             Character creator logic
data/root-rules.json      Canonical ruleset
data/root-rules.js        Generated window.ROOT_RULES wrapper
data/build-rules.mjs      Regenerates root-rules.js from root-rules.json
```
