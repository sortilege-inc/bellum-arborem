# Bellum Arborem

A companion web app for **Root: The Roleplaying Game** (Magpie Games, Powered by the Apocalypse) — styled after the *Root* board game's warm, storybook Woodland.

Static, no-build-required HTML/CSS/JS. Open the files directly in a browser or serve the folder.

## Sections

- **Character Creator** (`character-creator.html`) — build a vagabond step by step: pick a
  playbook, take its stat spread, choose your nature, drives, playbook moves, weapon skills,
  roguish feats, equipment, and connections, then set starting faction reputation. Export the
  finished character as a JSON file, or import a saved character to keep playing.

- **Woodland Creator** (`woodland-creator.html`) — "Making the Woodland": roll the tables clearing
  by clearing (dominant community, paths, name), then **draw the map on an interactive SVG canvas** —
  click two clearings to link a path (each node tracks paths-drawn vs. its rolled number), drag to
  rearrange. The faction-control passes (Marquisate → Eyrie → Woodland Alliance → Denizens) read
  each clearing's distance straight from the drawn map (shortest path), with a manual override, then
  flesh-out (inhabitants/buildings/problems). The Review step draws the finished map colored by
  faction control. A reroll at every step. Export/import the Woodland (map layout included) as JSON.

More sections to come.

## Data

- `data/root-rules.json` — canonical, machine-readable Root ruleset (stats, playbooks, moves,
  natures, drives, equipment, feats, factions, reputation scale). Extracted from the
  `titterpig-dsl-root` DSL corpus. **This is the source of truth.**
- `data/woodland-rules.json` — canonical Woodland-creation tables (dominant community, paths, name
  generator, faction-control tables, flesh-out tables) from the same corpus.
- `data/root-rules.js` / `data/woodland-rules.js` — generated wrappers exposing the same data as
  `window.ROOT_RULES` / `window.ROOT_WOODLAND` so pages load them via `<script>` and work from
  `file://` (no local server needed).

Regenerate the wrapper after editing the JSON:

```sh
node data/build-rules.mjs
```

## Character file format

The Character Creator exports a portable JSON character (`_format: "bellum-arborem.character"`).
Import reads the same shape, so a character exported from one session can be loaded in another.

## Layout

```
index.html                Landing page (Woodland hub)
character-creator.html     Character creator app
woodland-creator.html      Woodland creator app
css/app.css                Shared Root-styled design system
js/creator.js              Character creator logic
js/woodland.js             Woodland creator logic
data/root-rules.json       Canonical character ruleset
data/woodland-rules.json   Canonical Woodland-creation tables
data/root-rules.js         Generated window.ROOT_RULES wrapper
data/woodland-rules.js     Generated window.ROOT_WOODLAND wrapper
data/build-rules.mjs       Regenerates the .js wrappers from the .json sources
```
