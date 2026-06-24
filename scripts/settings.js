import { ReputationSettingsPanel } from './settings-panel.js';

const ID = 'remito-reputation-tracker';

const DEFAULT_POSITIVE_TIER_LABELS = [
  { slotThreshold: 1, label: 'Receptive',   flavorText: 'they seem open to what you have to say' },
  { slotThreshold: 2, label: 'Friendly',    flavorText: "there's a warmth when you meet" },
  { slotThreshold: 3, label: 'Trusted',     flavorText: 'they seem to genuinely rely on you' },
  { slotThreshold: 4, label: 'Devoted',     flavorText: 'you sense a deep personal loyalty' },
  { slotThreshold: 5, label: 'Zealous',     flavorText: 'there is nothing they would not do for you' },
];

const DEFAULT_NEGATIVE_TIER_LABELS = [
  { slotThreshold: 1, label: 'Wary',       flavorText: 'something about them puts you on edge' },
  { slotThreshold: 2, label: 'Unfriendly', flavorText: 'they make no effort to hide their dislike' },
  { slotThreshold: 3, label: 'Hostile',    flavorText: 'every interaction feels like a threat' },
  { slotThreshold: 4, label: 'Resented',   flavorText: 'you sense a deep and personal grudge' },
  { slotThreshold: 5, label: 'Nemesis',    flavorText: 'there is nothing they would not do against you' },
];

export function registerSettings() {
  game.settings.registerMenu(ID, 'config', {
    name: 'RRT.settings.configure.name',
    label: 'RRT.settings.configure.label',
    icon: 'fas fa-cog',
    type: ReputationSettingsPanel,
    restricted: true,
  });

  game.settings.register(ID, 'slotsPerSide', {
    name: 'RRT.settings.slotsPerSide.name',
    hint: 'RRT.settings.slotsPerSide.hint',
    scope: 'world',
    config: true,
    type: Number,
    default: 5,
  });

  game.settings.register(ID, 'pointsPerSlot', {
    name: 'RRT.settings.pointsPerSlot.name',
    hint: 'RRT.settings.pointsPerSlot.hint',
    scope: 'world',
    config: true,
    type: Number,
    default: 3,
  });

  game.settings.register(ID, 'impactWeights', {
    name: 'RRT.settings.impactWeights.name',
    scope: 'world',
    config: false,
    type: Object,
    default: { minor: 1, major: 2, severe: 3, massive: 5 },
  });

  game.settings.register(ID, 'positiveTierLabels', {
    name: 'RRT.settings.positiveTierLabels.name',
    scope: 'world',
    config: false,
    type: Array,
    default: DEFAULT_POSITIVE_TIER_LABELS,
  });

  game.settings.register(ID, 'negativeTierLabels', {
    name: 'RRT.settings.negativeTierLabels.name',
    scope: 'world',
    config: false,
    type: Array,
    default: DEFAULT_NEGATIVE_TIER_LABELS,
  });

  game.settings.register(ID, 'factions', {
    name: 'RRT.settings.factions.name',
    scope: 'world',
    config: false,
    type: Object,
    default: {},
  });

  game.settings.register(ID, 'declarations', {
    name: 'RRT.settings.declarations.name',
    scope: 'world',
    config: false,
    type: Array,
    default: [],
  });

  game.settings.register(ID, 'declarationArchiveLimit', {
    name: 'RRT.settings.declarationArchiveLimit.name',
    hint: 'RRT.settings.declarationArchiveLimit.hint',
    scope: 'world',
    config: true,
    type: Number,
    default: 25,
  });

  game.settings.register(ID, 'defaultNpcVisibility', {
    name: 'RRT.settings.defaultNpcVisibility.name',
    hint: 'RRT.settings.defaultNpcVisibility.hint',
    scope: 'world',
    config: true,
    type: String,
    default: 'gm',
    choices: {
      gm: 'RRT.settings.defaultNpcVisibility.gm',
      all: 'RRT.settings.defaultNpcVisibility.all',
    },
  });
}
