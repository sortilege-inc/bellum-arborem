# Bellum Arborem

A companion web app for **Root: The Roleplaying Game** (Magpie Games, Powered by the Apocalypse) — styled after the *Root* board game's warm, storybook Woodland.

Static, no-build-required HTML/CSS/JS. Open the files directly in a browser or serve the folder.

## Sections

- **Character Creator** (`character-creator.html`) — build a vagabond step by step: pick a
  playbook (all 19 — the 9 core plus the 10 Travelers & Outsiders playbooks), take its stat spread
  and add your +1 (max +2), choose your nature, drives, playbook moves, weapon skill, roguish feats,
  equipment, and connections, then set starting faction reputation. Your chosen species grants its
  **species ability** and unlocks **species moves** to take; **masteries** (12+ move enhancements
  taken via advancement) are shown for reference. Export the finished character as a JSON file, or
  import a saved character to keep playing.

- **Woodland Creator** (`woodland-creator.html`) — "Making the Woodland": roll the tables clearing
  by clearing (dominant community, paths, name), then **draw the map on an interactive SVG canvas** —
  click two clearings to link a path (each node tracks paths-drawn vs. its rolled number), drag to
  rearrange. Choose 2–7 factions (the 3 core plus the 4 Travelers & Outsiders factions) and run each
  one's placement pass in setup order: Marquisate → Eyrie → Woodland Alliance → Lizard Cult →
  Riverfolk → Grand Duchy → Corvid → Denizens. The core passes read each clearing's distance straight
  from the drawn map; the T&O factions add **presence** (a foothold short of control) and their own
  structures (gardens, trading posts, tunnels). Rivers/lakes are simplified to an "on water" toggle.
  Then flesh-out (inhabitants/buildings/problems). The Review step draws the finished map colored by
  faction control with structure glyphs. Export/import the Woodland (map layout included) as JSON.

- **Play** (`play.html`) — load a character JSON and take the vagabond into the field: mark the three
  harm tracks (Injury / Exhaustion / Depletion), shift faction reputation (status + prestige /
  notoriety), advance stats, and **roll any move** (2d6 + the move's stat, with the strong-hit /
  weak-hit / miss outcome shown) plus a free quick-roll. Save the updated character back to JSON.

- **Advance Woodland** (`advance-woodland.html`) — import a Woodland (from the Woodland Creator) and
  work the "time passes" rules: roll each non-denizen faction in turn (with the situational
  modifiers), then take minor/major boons on a hit or suffer a defeat on a miss. Supports all seven
  factions with their own faction-phase boons — the core ones (attack, fortify, revolt, build Roost,
  capture, …) plus the Travelers & Outsiders boons (proselytize, conduct commerce, build a garden /
  trading post / tunnel / market / citadel, enact and culminate plots, expand a network, trade war,
  …) — including the "presence" mechanic. Boons and defeats apply to the map, a war log records every
  turn, and you export the advanced Woodland. Runs on the same `bellum-arborem.woodland` JSON.

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
play.html                  Play mode (load a character and play)
advance-woodland.html      Advance Woodland (the "time passes" war loop)
css/app.css                Shared Root-styled design system
js/creator.js              Character creator logic
js/woodland.js             Woodland creator logic
js/play.js                 Play-mode logic
js/advance.js              Advance-Woodland logic
data/root-rules.json       Canonical character ruleset
data/woodland-rules.json   Canonical Woodland-creation tables
data/root-rules.js         Generated window.ROOT_RULES wrapper
data/woodland-rules.js     Generated window.ROOT_WOODLAND wrapper
data/build-rules.mjs       Regenerates the .js wrappers from the .json sources
```
