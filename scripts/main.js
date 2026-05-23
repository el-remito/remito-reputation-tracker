import { registerSettings } from './settings.js';
import * as DataManager from './data-manager.js';
import { GmReputationManager } from './gm-manager.js';
import { ActorReputationPanel, openPanels } from './reputation-panel.js';

// M4: import { DeclareChangeDialog } from './declare-dialog.js';

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
    openPanel: (actorName) => {
      const actor = game.actors.getName(actorName);
      if (!actor) return console.warn(`RRT: actor "${actorName}" not found`);
      new ActorReputationPanel(actor).render(true);
    },
  };

  console.log('remito-reputation-tracker | Ready. Debug utilities available at window.RRT');
});

// Re-render all open panels when declarations or relationship flags change
Hooks.on('updateSetting', (setting) => {
  if (!setting.key?.startsWith('remito-reputation-tracker')) return;
  for (const panel of openPanels.values()) {
    if (panel.rendered) panel.render();
  }
});

// Re-render panels when actor flags change (relationship updates)
Hooks.on('updateActor', (actor) => {
  const panel = openPanels.get(actor.id);
  if (panel?.rendered) panel.render();
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

// Sheet button injection — Daggerheart path (ApplicationV2 CharacterSheet)
Hooks.on('renderCharacterSheet', (app, html, data) => {
  if (game.system.id !== 'daggerheart') return;
  const actor = app.actor;
  if (!actor) return;
  if (html.querySelector('[data-rrt-injected]')) return;

  const downtime = html.querySelector('.downtime-section');
  if (!downtime) return;

  const openPanel = () => {
    let panel = openPanels.get(actor.id);
    if (!panel || !panel.rendered) {
      panel = new ActorReputationPanel(actor);
      openPanels.set(actor.id, panel);
    }
    panel.render(true);
  };

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.dataset.tooltip = game.i18n.localize('RRT.panel.openButton');
  btn.dataset.rrtInjected = '1';
  btn.innerHTML = '<i class="fa-solid fa-fw fa-flag"></i>';
  btn.addEventListener('click', openPanel);
  downtime.appendChild(btn);
});

// Sheet button injection — generic fallback for non-Daggerheart systems
Hooks.on('renderActorSheet', (app, html, data) => {
  if (game.system.id === 'daggerheart') return;
  const actor = app.actor;
  if (!actor) return;
  if (html.querySelector('[data-rrt-injected]')) return;

  const openPanel = () => {
    let panel = openPanels.get(actor.id);
    if (!panel || !panel.rendered) {
      panel = new ActorReputationPanel(actor);
      openPanels.set(actor.id, panel);
    }
    panel.render(true);
  };

  const header = html.querySelector('.window-header');
  if (header) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.classList.add('rrt-header-btn');
    btn.dataset.rrtInjected = '1';
    btn.title = game.i18n.localize('RRT.panel.openButton');
    btn.innerHTML = '<i class="fas fa-flag"></i>';
    btn.addEventListener('click', openPanel);
    header.appendChild(btn);
  }
});
