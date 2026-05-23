import { registerSettings } from './settings.js';
import * as DataManager from './data-manager.js';

// M2: import { GmReputationManager } from './gm-manager.js';
// M3: import { ActorReputationPanel } from './reputation-panel.js';

Hooks.once('init', () => {
  registerSettings();
});

Hooks.once('ready', () => {
  window.RRT = {
    getFactions: () => game.settings.get('remito-reputation-tracker', 'factions'),
    setFactions: (data) => game.settings.set('remito-reputation-tracker', 'factions', data),
    getRelationships: (actorName) =>
      game.actors.getName(actorName)?.getFlag('remito-reputation-tracker', 'relationships'),
    setRelationship: async (actorName, npcId, points) => {
      const actor = game.actors.getName(actorName);
      if (!actor) return console.warn(`RRT: actor "${actorName}" not found`);
      return DataManager.setRelationship(actor, npcId, { hiddenPoints: points });
    },
    getDeclarations: () => game.settings.get('remito-reputation-tracker', 'declarations'),
    clearDeclarations: () => game.settings.set('remito-reputation-tracker', 'declarations', []),
    forceCleanupRelations: () => DataManager.cleanupOrphanedRelations(),
  };

  console.log('remito-reputation-tracker | Ready. Debug utilities available at window.RRT');
});

// M2: Scene control button injection goes here
// M3: renderActorSheet hook for sheet button injection goes here
