import { registerSettings } from './settings.js';
import * as DataManager from './data-manager.js';
import { GmReputationManager } from './gm-manager.js';

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
      return DataManager.setRelationship(actor, npcId, { hiddenPoints: points, isKnown: true });
    },
    getDeclarations: () => game.settings.get('remito-reputation-tracker', 'declarations'),
    clearDeclarations: () => game.settings.set('remito-reputation-tracker', 'declarations', []),
    forceCleanupRelations: () => DataManager.cleanupOrphanedRelations(),
  };

  console.log('remito-reputation-tracker | Ready. Debug utilities available at window.RRT');
});

// Scene controls — GM Reputation Manager button (token layer)
Hooks.on('getSceneControlButtons', (controls) => {
  if (!game.user?.isGM) return;
  const tokens = Object.values(controls).find(c => c.name === 'tokens');
  if (tokens) {
    tokens.tools['remito-reputation-tracker'] = {
      name: 'remito-reputation-tracker',
      title: game.i18n.localize('RRT.gmManager.title'),
      icon: 'fas fa-flag',
      button: true,
      onClick: () => new GmReputationManager().render(true),
    };
  }
});

// M3: renderActorSheet hook for sheet button injection goes here
