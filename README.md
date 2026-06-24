# Remito's Reputation Tracker

A Foundry VTT module that tracks NPC and faction reputation for Daggerheart campaigns. Players
submit narrative "declarations" about how they affected an NPC; GMs review them and apply the
resulting point changes to a hidden reputation track. Players only ever see derived tier labels
and flavor text — never raw point values.

## Requirements

- Foundry VTT **v14** or later.
- Primarily designed and tested against the **Daggerheart** system, where the panel is injected
  directly into the character sheet's downtime section. On other systems the module still works
  via a generic actor-sheet header button fallback, but Daggerheart is the integration target.

## Installation

**Recommended:** in Foundry's Setup screen, go to **Add-on Modules → Install Module** and paste
this manifest URL:

```
https://raw.githubusercontent.com/el-remito/remito-reputation-tracker/main/module.json
```

**Manual install:** clone or download this repository into your Foundry `Data/modules/` folder
as `remito-reputation-tracker`, then enable it from the **Manage Modules** dialog in your world.

## Features

- Hidden, GM-controlled reputation tracks per NPC/faction, with configurable slot width and
  point-per-slot scaling.
- Players see only derived tier labels and flavor text for each relationship — never raw
  reputation points.
- Players submit narrative **declarations** (an impact level and a direction) instead of editing
  reputation directly; nothing changes until a GM reviews it.
- GM review queue: accept, edit, or reject declarations, including per-character review when a
  declaration was submitted for an entire party.
- Faction/NPC/category tree with drag-to-reorganize and nested subfactions.
- Fully configurable tier labels and flavor text (positive and negative), impact weights, default
  NPC visibility, and declaration archive length, all from a settings panel.

## Usage

1. **As GM**, open the **Reputation Manager** from the token-layer scene controls. Build out your
   factions, NPCs, and categories, and set up relationships as needed.
2. **As a player**, open the reputation panel from your character sheet (in the downtime section
   on Daggerheart sheets, or via the sheet header button on other systems) to see the NPCs you
   know about and their current standing toward you.
3. From the panel, use **Add a Memory** to declare an interaction with an NPC: pick the NPC,
   describe what happened, choose a direction (positive/negative) and an impact level
   (minor/major/severe/massive).
4. **As GM**, review pending declarations in the Reputation Manager's review queue. Accept them
   as-is, edit the impact before applying it, or reject them — each character in a party
   declaration can be resolved independently.

## Configuration

Available from the **Reputations Settings** menu in Foundry's module settings:

| Setting | Default | Description |
| --- | --- | --- |
| Slots Per Side | 5 | Number of visible reputation slots on each side (positive/negative) of an NPC's track. |
| Points Per Slot | 3 | Hidden points required to fill one slot. |
| Impact Weights | minor 1, major 2, severe 3, massive 5 | Hidden points awarded per declaration impact level. |
| Positive Tier Labels | Receptive → Friendly → Trusted → Devoted → Zealous | Labels and flavor text shown to players as positive slots fill. |
| Negative Tier Labels | Wary → Unfriendly → Hostile → Resented → Nemesis | Labels and flavor text shown to players as negative slots fill. |
| Declaration Archive Limit | 25 | How many resolved declarations are kept per character before older ones are pruned. |
| Default NPC Visibility | GM only | Whether newly created NPCs are visible to all players or hidden until a GM reveals them. |

## Debug helpers

Once a world is ready, debug helpers are exposed at `window.RRT` in the browser console:
`getFactions`, `setFactions`, `getRelationships`, `setRelationship`, `getDeclarations`,
`clearDeclarations`, `forceCleanupRelations`, `openPanel`.

## License

[MIT](LICENSE)
