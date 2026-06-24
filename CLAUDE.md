# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Foundry VTT v14 module (`remito-reputation-tracker`) that tracks NPC/faction reputation for
Daggerheart campaigns. Players submit narrative "declarations" about how they affected an NPC;
GMs review them and apply the resulting point changes to a hidden reputation track. Players only
ever see derived tier labels/flavor text — never raw point values.

The full design spec lives in `remito-reputation-spec.md` — read it for the data model, settings
table, UI section breakdowns, and phase plan. It is the source of truth for *intended* behavior;
the code below is the current implementation of phases M1–M4.

## Commands

There is **no build step, no bundler, no test suite, and no linter** — pure ES modules loaded
directly by Foundry. To "run" the module:

1. Symlink or copy this directory into your Foundry `Data/modules/` folder as `remito-reputation-tracker`.
2. Enable it in a world running Foundry v14 (ideally with the Daggerheart system installed — that's
   the primary integration target).
3. Reload Foundry; check the browser console for `remito-reputation-tracker | Ready.`

There's no automated way to exercise the code — verify changes by loading the module in an actual
Foundry world and exercising the UI (player panel via the Daggerheart sheet's downtime section flag
button, GM manager via the token-layer scene control).

Debug helpers are exposed at `window.RRT` in the browser console once the world is ready
(`getFactions`, `setFactions`, `getRelationships`, `setRelationship`, `getDeclarations`,
`clearDeclarations`, `forceCleanupRelations`, `openPanel`).

## Architecture

### Data flow
All persistent state lives in two places, accessed exclusively through `data-manager.js` (never
touch `game.settings`/actor flags directly from UI code):

- **World setting `factions`** — a nested tree of faction/NPC/category nodes (`type: 'faction' | 'npc' | 'category'`).
  Factions and NPCs carry reputation tracks and can nest subfactions; categories are pure grouping.
  Tree operations (`findFactionById`, `collectFactionIds`, `moveNode`, `isAncestor`,
  `cleanupOrphanedRelations`) all walk this structure recursively.
- **Actor flag `relationships`** — per-actor map of `npcId → { hiddenPoints, isKnown, playerLabelOverride, playerFlavorOverride }`.
  `hiddenPoints` is unbounded and never shown raw to players.
- **World setting `declarations`** — flat array of declaration records (`status: pending | accepted | edited | rejected`),
  including grouped party declarations with per-character `partyEntries`.

Derived display values (slot counts, overflow buffer, tier labels, point deltas) are computed by
the **pure, Foundry-independent functions in `reputation-utils.js`** — `filledSlots`,
`overflowBuffer`, `getPositiveTierLabel`, `getNegativeTierLabel`, `calculatePoints`. Tier labels
must always be derived from `filledSlots()` (slot thresholds), never from raw `hiddenPoints`,
so that changing `pointsPerSlot` shifts boundaries automatically.

### UI layer (ApplicationV2, no jQuery/Handlebars)
Every window extends `foundry.applications.api.ApplicationV2` and follows the same rendering
pattern: `_prepareContext()` builds a plain data object (querying settings + DataManager),
`_renderHTML(context, options)` builds a vanilla DOM tree from it, and `_replaceHTML(result, content)`
does `content.replaceChildren(result)`. All event wiring is `addEventListener` on the rendered
elements — no templating engine.

- `reputation-panel.js` — `ActorReputationPanel`: player-facing panel (per-actor, keyed in the
  module-level `openPanels` map by actor id). Builds a hierarchical `npcTree` by walking the
  faction tree, filtering by visibility/`isKnown`/GM status, and computing per-row state
  (`positive | negative | unknown` + tier label/flavor).
- `npc-detail-panel.js` — `NpcDetailPanel`: drill-down view for a single actor↔NPC relationship,
  tracked in `openDetailPanels`.
- `declare-dialog.js` — `DeclareChangeDialog`: the player submission form (NPC picker, impact
  level, direction, party toggle). Writes pending `Declaration` records only — never mutates
  `hiddenPoints` directly.
- `gm-manager.js` — `GmReputationManager`: faction/NPC CRUD (with drag-to-reorganize via
  `moveNode`/`isAncestor`), the pending-declarations review queue (accept/edit/reject, including
  per-character party entry review), and the direct relationship editor.
- `settings-panel.js` — `ReputationSettingsPanel`: world-config UI for tier labels, impact
  weights, slot/point configuration (registered as a settings menu in `settings.js`).

### Wiring (`main.js`)
Registers settings on `init`; on `ready` exposes `window.RRT` and wires cross-window
communication. Key hooks:
- `getSceneControlButtons` — injects the GM Manager button into the token layer toolbar (GM only).
- `renderCharacterSheet` (Daggerheart only, guarded by `game.system.id === 'daggerheart'`) —
  injects the panel-open button into `.controls-dropdown` / `.downtime-section`.
- `renderActorSheet` — generic header-button fallback for non-Daggerheart systems.
- `updateSetting` / `updateActor` — re-render every open panel/detail-panel in `openPanels` /
  `openDetailPanels` whenever reputation data changes, so all clients stay in sync.
- `remito.openPanel` custom hook — lets the GM manager open a specific player's panel
  (e.g. clicking a relationship badge).

### Localization
All user-facing strings (including flavor-text templates) live in `lang/en.json` under the `RRT.*`
namespace — never hardcode display strings in script files.

## Key invariants (from the spec — do not violate)

- Tier labels are always derived from `filledSlots()`, never from raw `hiddenPoints`.
- `hiddenPoints` is never displayed raw to non-GM users.
- A `pending` declaration never modifies `hiddenPoints` — only GM review (`updateDeclaration`)
  applies `calculatePoints()` to the actor's relationship.
- Party declarations apply independently per character — the GM can accept for one member and
  reject for another.
- `isKnown: false` means the NPC is completely absent from that character's panel, not just greyed out.
- Deleting an NPC must cascade: `cleanupOrphanedRelations()` + `removeDeclarationsForNpc()`.

## Foundry v14 conventions used throughout

- `foundry.applications.api.ApplicationV2` / `DialogV2` — no legacy `Dialog`, no jQuery.
- `foundry.utils.randomID()` for generated IDs, `foundry.utils.deepClone()` before mutating any
  settings object or actor flag (data-manager getters already return deep clones).
- Party Actor membership: `game.actors.filter(a => a.type === 'party')`, verify the member-list
  path against the live Daggerheart system data rather than assuming a shape.
