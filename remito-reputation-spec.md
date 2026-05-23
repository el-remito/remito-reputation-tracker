# Remito's Reputation Tracker — Claude Code Spec

## What we are building


**Primary target system:** Daggerheart (button injected into the controls dropdown).  
**Secondary:** generic Foundry header button fallback for other systems.  
**No build step.** Pure ES modules, vanilla DOM, no jQuery, no Handlebars required.

---

## Design rules (non-negotiable)

1. **Labels map to slot thresholds, never raw points.** If `pointsPerSlot` changes, label boundaries shift automatically.
2. **`hiddenPoints` is unbounded.** No hard cap. Overflow above the visual max creates a "buffer" — negative declarations must drain the overflow before slots visually drop.
3. **Positive relationships:** slot track + tier label visible to player.
4. **Negative relationships:** flavor-text sentence with a single GM-configured label only. No track shown.
5. **Declarations are the only player input.** Players never directly set relationship values. They submit narrative declarations; GMs review and apply.
6. **Pending declarations are visible to all players** (shared table accountability).
7. **Processed declarations** are per-character, archived after GM-configurable limit (default 25 entries).

---

## Data model

### World setting: `remito-reputation-tracker.factions`
```js
{
  [factionId]: {
    id: string,
    name: string,
    img: string,             // path or empty string
    description: string,
    type: 'faction' | 'npc' | 'category',
    isVisible: boolean,      // GM toggle — false = GM-only
    subfactions: {           // NPCs/sub-factions nested inside
      [id]: { ...same shape, subfactions: {} }
    }
  }
}
```
- `faction` — can contain subfactions/NPCs, has its own reputation track
- `npc` — individual character, has reputation track, cannot have subfactions
- `category` — organizational grouping only, no reputation track, no subfactions

### Actor flag: `remito-reputation-tracker.relationships`
```js
{
  [npcOrFactionId]: {
    hiddenPoints: number,          // unbounded, GM-only
    isKnown: boolean,              // GM reveals to this character
    playerLabelOverride: string | null  // GM can pin a specific label
  }
}
```

### World setting: `remito-reputation-tracker.declarations`
```js
[
  {
    id: string,                    // randomID()
    actorId: string,               // declaring character
    npcId: string,                 // target NPC/faction
    description: string,           // player-written narrative
    impactLevel: 'minor' | 'major' | 'severe' | 'massive',
    direction: 'positive' | 'negative',
    isPartyDeclaration: boolean,
    partyActorId: string | null,   // Party Actor ID if isPartyDeclaration
    status: 'pending' | 'accepted' | 'edited' | 'rejected',
    appliedPoints: number | null,  // set by GM on review (may differ from calculated)
    submittedAt: number,           // Date.now()
    reviewedAt: number | null,
    // Only present when isPartyDeclaration === true
    partyEntries: {
      [actorId]: {
        status: 'pending' | 'accepted' | 'edited' | 'rejected',
        appliedPoints: number | null
      }
    } | null
  }
]
```

---

## Settings

Register all under `remito-reputation-tracker`. All `scope: 'world'` unless noted.

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `slotsPerSide` | Number | `5` | Slots 1–10 per side of the track |
| `pointsPerSlot` | Number | `3` | Hidden points needed to fill one slot |
| `impactWeights.minor` | Number | `1` | Points for a minor declaration |
| `impactWeights.major` | Number | `2` | Points for a major declaration |
| `impactWeights.severe` | Number | `3` | Points for a severe declaration |
| `impactWeights.massive` | Number | `5` | Points for a massive declaration |
| `positiveTierLabels` | Array | see below | `[{ slotThreshold: N, label: string, flavorText: string }]` — one entry per slot level 1..slotsPerSide |
| `negativeTierLabels` | Array | see below | `[{ slotThreshold: N, label: string }]` — one entry per slot level 1..slotsPerSide (negative side) |
| `declarationArchiveLimit` | Number | `25` | Max processed declarations stored per character before auto-archiving oldest |
| `defaultNpcVisibility` | String | `'gm'` | `'gm'` or `'all'` — default for newly created NPCs |

**Default positive tier labels** (for slotsPerSide=5):
```
1 → Receptive,  "they seem open to what you have to say"
2 → Friendly,   "there's a warmth when you meet"
3 → Trusted,    "they seem to genuinely rely on you"
4 → Devoted,    "you sense a deep personal loyalty"
5 → Zealous,    "there is nothing they would not do for you"
```

**Default negative tier labels** (for slotsPerSide=5):
```
1 → Wary
2 → Unfriendly
3 → Hostile
4 → Resented
5 → Nemesis
```

---

## Slot/point calculation (core logic)

```js
// Number of slots to display (positive side)
function filledSlots(hiddenPoints, slotsPerSide, pointsPerSlot) {
  if (hiddenPoints <= 0) return 0;
  return Math.min(Math.ceil(hiddenPoints / pointsPerSlot), slotsPerSide);
}

// Overflow buffer (points accumulated above the visual max)
function overflowBuffer(hiddenPoints, slotsPerSide, pointsPerSlot) {
  const max = slotsPerSide * pointsPerSlot;
  return Math.max(0, hiddenPoints - max);
}

// Tier label for display (positive)
function getPositiveTierLabel(hiddenPoints, slotsPerSide, pointsPerSlot, positiveTierLabels) {
  const slots = filledSlots(hiddenPoints, slotsPerSide, pointsPerSlot);
  if (slots === 0) return null; // neutral
  return positiveTierLabels.find(t => t.slotThreshold === slots) ?? positiveTierLabels.at(-1);
}

// Tier label for negative (mirrors positive, uses negative labels)
function getNegativeTierLabel(hiddenPoints, slotsPerSide, pointsPerSlot, negativeTierLabels) {
  const absSlots = Math.min(Math.ceil(Math.abs(hiddenPoints) / pointsPerSlot), slotsPerSide);
  if (absSlots === 0) return null; // neutral
  return negativeTierLabels.find(t => t.slotThreshold === absSlots) ?? negativeTierLabels.at(-1);
}

// Points to apply for a declaration
function calculatePoints(impactLevel, direction, impactWeights) {
  const base = impactWeights[impactLevel] ?? 1;
  return direction === 'positive' ? base : -base;
}
```

---

## UI components

### 1. Reputation Panel (player-facing ApplicationV2)

**Trigger:** Flag icon in Daggerheart character sheet controls dropdown, or generic header button on other systems.  
**Window:** `id: 'remito-reputation-tracker-panel'`, resizable, ~460px default width.

**Sections (top to bottom):**

#### Header
- Character name + "Reputation" title
- If GM: show "GM view" badge

#### Faction/NPC list
Sorted alphabetically. Each faction is a collapsible group.

**Per NPC row — positive relationship (hiddenPoints > 0, isKnown: true):**
- Avatar (img or user icon fallback)
- Name + tier label as subtitle (e.g. "Trusted")
- Slot track: filled/empty slots, center divider pip
- If overflow > 0: last slot gets a subtle outer ring
- "Declare" button (opens Declare dialog)

**Per NPC row — negative relationship (hiddenPoints < 0, isKnown: true):**
- Avatar + name
- Flavor sentence: *"The last time you crossed paths, you had the impression things were [Hostile]."*
- No slot track shown
- "Declare" button

**Per NPC row — neutral (hiddenPoints near 0 or 0, isKnown: true):**
- Neutral state, no label, no slots
- "Declare" button

**Per NPC row — unknown (isKnown: false):**
- Visible only to GM
- Shows as greyed-out `???` with lock icon to other players
- Hidden entirely from non-GM players who don't own the character (if `isVisible: false` on NPC)

**Pending declarations section** (below the NPC list):
- Shows all pending declarations across all characters for this world
- Each entry: actor name → NPC name, impact level chip, description excerpt, "pending" badge
- Players can only see, not modify

**Processed declarations section** (per character, collapsible):
- Shows last N processed declarations for this character (N = `declarationArchiveLimit`)
- Three display states (see flavor text below)
- Oldest auto-removed when limit exceeded

---

### 2. Declare Change Dialog (ApplicationV2 or DialogV2)

**Fields:**
1. NPC picker — dropdown of known NPCs for this character
2. Description — textarea, placeholder: "Briefly describe what happened…"
3. Impact level — 4-button grid: Minor / Major / Severe / Massive (with point values shown)
4. Direction — 2-button toggle: Positive / Negative
5. Party toggle — checkbox "Apply to whole party" (only visible if character belongs to a Party Actor in Daggerheart). When checked, shows which party members will be affected.

**Submit behavior:**
- Creates a Declaration record with `status: 'pending'`
- For party declarations: one Declaration with `isPartyDeclaration: true`, `partyActorId`, and `partyEntries` initialized to `{ [actorId]: { status: 'pending', appliedPoints: null } }` for each party member
- Triggers a re-render of all open Reputation Panels (so the pending section updates for all players)

---

### 3. GM Reputation Manager (ApplicationV2)

**Trigger:** Flag icon in scene controls toolbar (token layer).  
**Window:** `id: 'remito-gm-manager'`, resizable, ~640px default width.

**Sections:**

#### NPC / Faction management
- Full CRUD: add faction/NPC/category, edit (name, img, description, type, visibility), delete (with name-confirmation dialog)
- Delete cascades: removes orphaned relationship entries from all actors
- Subfaction support: organizations can have nested NPCs
- Shows relationship summaries per NPC (which characters have non-neutral relationships, with tier labels)
- Clicking a character's relationship badge opens that character's Reputation Panel pre-scrolled to that NPC

#### Pending declarations queue
- All pending declarations, newest first
- Per declaration: actor name, NPC name, impact level chip, direction, description, calculated points preview
- **Standard declaration actions:** Accept / Edit / Reject
  - Accept: applies `calculatePoints(impactLevel, direction, impactWeights)` to `hiddenPoints`. Sets `status: 'accepted'`, `appliedPoints` to calculated value.
  - Edit: GM can override the `appliedPoints` value (or change impact level). Sets `status: 'edited'`.
  - Reject: Sets `status: 'rejected'`, `appliedPoints: 0`.
- **Party declaration actions:** Shows one grouped entry, expands to show per-character rows. Each character row has its own Accept / Edit / Reject. Overall declaration `status` becomes `'accepted'` once all party entries are reviewed.

#### Direct relationship editor (GM only)
- Search for a character + NPC combination
- Set `hiddenPoints` directly (number input)
- Set `isKnown` toggle
- Set `playerLabelOverride` (optional)

---

### 4. Processed declaration display states

These appear in the **Processed declarations** section of the player's Reputation Panel.

**State: `accepted`**  
Status badge: "Certain" (green)  
Flavor text: *"You are sure [NPC name] will remember this."*

**State: `edited`**  
Status badge: "Recalled" (amber)  
Flavor text: *"[NPC name] might remember this, but you wonder if it was how you remember it."*

**State: `rejected`**  
Status badge: "Unclear" (muted gray), card at 75% opacity  
Flavor text: *"This is a clear memory for you, but you cannot confirm it impacted [NPC name] at all..."*

NPC name is interpolated from the declaration's `npcId` → looked up in `remito-reputation-tracker.factions` tree.

---

## Foundry v14 API guidance

- **ApplicationV2:** Use `foundry.applications.api.ApplicationV2`. Override `_renderHTML()` to return a DOM element from `renderContent()`. Override `_replaceHTML(result, content)` to do `content.replaceChildren(result)`.
- **DialogV2:** Use `foundry.applications.api.DialogV2.confirm(...)` and `DialogV2.prompt(...)`. No legacy `Dialog`.
- **No jQuery.** All DOM manipulation via vanilla `document.createElement`, `element.addEventListener`, etc.
- **Scene controls (v14 pattern):**
  ```js
  Hooks.on("getSceneControlButtons", (controls) => {
    const tokens = Object.values(controls).find(c => c.name === "tokens");
    if (tokens) tokens.tools["remito-reputation-tracker"] = {
      name: "remito-reputation-tracker", title: "Reputation Manager",
      icon: "fas fa-flag", button: true,
      onClick: () => new GmReputationManager().render(true)
    };
  });
  ```
- **Daggerheart sheet hook:** `Hooks.on("renderCharacterSheet", ...)` with `game.system.id === 'daggerheart'` guard. Target `.controls-dropdown` for button injection.
- **Party Actor:** In Daggerheart, check `game.actors.filter(a => a.type === 'party')`. A character belongs to a party if `partyActor.system.members` (or equivalent) contains their ID. Verify exact path against live Daggerheart system data before hardcoding.
- **randomID():** Use Foundry's built-in `foundry.utils.randomID()` for all generated IDs.
- **Deep clone:** Use `foundry.utils.deepClone()` before mutating settings objects.

---

## Module file structure

```
remito-reputation-tracker/
  module.json
  scripts/
    main.js             — Hooks.once('init'), Hooks.once('ready'), scene controls, sheet hooks
    settings.js         — registerSettings(), all defaults, tier label defaults
    data-manager.js     — getFactions(), setFactions(), getRelationship(), setRelationship(),
                          getDeclarations(), addDeclaration(), updateDeclaration(),
                          cleanupOrphanedRelations(), archiveOldDeclarations()
    reputation-utils.js — filledSlots(), overflowBuffer(), getPositiveTierLabel(),
                          getNegativeTierLabel(), calculatePoints()
    reputation-panel.js — ActorReputationPanel extends ApplicationV2
    declare-dialog.js   — DeclareChangeDialog (ApplicationV2 or DialogV2 wrapper)
    gm-manager.js       — GmReputationManager extends ApplicationV2
  styles/
    reputation.css
  lang/
    en.json             — All user-facing strings (flavor texts, labels, UI copy)
  module.json
```

---

## Implementation order (suggested phases)

**Phase 1 — Foundation**
1. `module.json` (Foundry v14, id: `remito-reputation-tracker`)
2. `settings.js` — register all settings with defaults
3. `reputation-utils.js` — pure functions, no Foundry dependencies, easy to test
4. `data-manager.js` — CRUD wrappers around game.settings
5. `main.js` — init hook registers settings, ready hook exposes `window.RRT` debug utilities

**Phase 2 — GM Manager**
6. `gm-manager.js` — NPC/faction CRUD, basic list rendering
7. Scene control button injection
8. `reputation.css` — base styles

**Phase 3 — Player Panel**
9. `reputation-panel.js` — NPC list, slot tracks, flavor text states
10. Sheet button injection (Daggerheart + generic fallback)

**Phase 4 — Declarations**
11. `declare-dialog.js` — submission form, party toggle
12. GM queue in `gm-manager.js` — review actions, party per-character controls
13. Processed states in `reputation-panel.js` — Certain / Recalled / Unclear display
14. Archive auto-cleanup logic in `data-manager.js`

**Phase 5 — Polish**
15. Settings panel for tier labels, impact weights, slot config
16. Search/filter in GM Manager
17. Fuzzy matching for NPC search
18. GM direct relationship editor

---

## Debug utilities (expose on window.RRT in ready hook)

```js
window.RRT = {
  getFactions: () => game.settings.get('remito-reputation-tracker', 'factions'),
  setFactions: (data) => game.settings.set('remito-reputation-tracker', 'factions', data),
  getRelationships: (actorName) => game.actors.getName(actorName)?.getFlag('remito-reputation-tracker', 'relationships'),
  setRelationship: (actorName, npcId, points) => { /* ... */ },
  getDeclarations: () => game.settings.get('remito-reputation-tracker', 'declarations'),
  clearDeclarations: () => game.settings.set('remito-reputation-tracker', 'declarations', []),
  forceCleanupRelations: () => DataManager.cleanupOrphanedRelations()
};
```

---

## Key invariants to maintain throughout

- Tier labels are always derived from `filledSlots()`, never from raw `hiddenPoints`
- `hiddenPoints` is never displayed raw to non-GM users
- A declaration with `status: 'pending'` never modifies `hiddenPoints` — only GM review does
- Party declarations apply independently per character (GM can accept for Alice, reject for Bob)
- `isKnown: false` means the NPC is completely hidden from that character's Reputation Panel (not just greyed out — absent)
- When an NPC is deleted, run `cleanupOrphanedRelations()` and remove all declarations referencing that NPC ID
