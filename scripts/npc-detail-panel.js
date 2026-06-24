import * as DataManager from './data-manager.js';
import { filledSlots, overflowBuffer, getPositiveTierLabel, getNegativeTierLabel } from './reputation-utils.js';
import { DeclareChangeDialog } from './declare-dialog.js';

const ID = 'remito-reputation-tracker';
const { ApplicationV2 } = foundry.applications.api;

// Track open detail panels so main.js can re-render them on data changes
export const openDetailPanels = new Map(); // panel.id → NpcDetailPanel instance

export class NpcDetailPanel extends ApplicationV2 {
  constructor(actor, npcId, options = {}) {
    super(options);
    this.actor = actor;
    this.npcId = npcId;
  }

  get id() {
    return `remito-npc-detail-${this.actor.id}-${this.npcId}`;
  }

  static DEFAULT_OPTIONS = {
    window: { resizable: true },
    position: { width: 380, height: 500 },
  };

  get title() {
    const node = DataManager.findFactionById(DataManager.getFactions(), this.npcId);
    return node?.name ?? '—';
  }

  async _prepareContext(options) {
    const factions = DataManager.getFactions();
    const node = DataManager.findFactionById(factions, this.npcId);
    if (!node) return { missing: true };

    const slotsPerSide = game.settings.get(ID, 'slotsPerSide');
    const pointsPerSlot = game.settings.get(ID, 'pointsPerSlot');
    const positiveTierLabels = game.settings.get(ID, 'positiveTierLabels');
    const negativeTierLabels = game.settings.get(ID, 'negativeTierLabels');

    const relationships = DataManager.getAllRelationships(this.actor);
    const rel = relationships[this.npcId] ?? { hiddenPoints: 0, isKnown: false, playerLabelOverride: null, playerFlavorOverride: null };

    const hp = rel.hiddenPoints ?? 0;
    const slots = filledSlots(hp, slotsPerSide, pointsPerSlot);
    const overflow = overflowBuffer(hp, slotsPerSide, pointsPerSlot);

    let state, tierLabel, flavorText;
    if (hp > 0) {
      state = 'positive';
      const tier = rel.playerLabelOverride
        ? { label: rel.playerLabelOverride, flavorText: rel.playerFlavorOverride ?? '' }
        : (getPositiveTierLabel(hp, slotsPerSide, pointsPerSlot, positiveTierLabels) ?? { label: '', flavorText: '' });
      tierLabel = tier.label;
      flavorText = tier.flavorText || null;
    } else if (hp < 0) {
      state = 'negative';
      const tier = rel.playerLabelOverride
        ? { label: rel.playerLabelOverride, flavorText: rel.playerFlavorOverride ?? '' }
        : (getNegativeTierLabel(hp, slotsPerSide, pointsPerSlot, negativeTierLabels) ?? { label: '', flavorText: '' });
      tierLabel = tier.label;
      flavorText = tier.flavorText || null;
    } else {
      state = 'neutral';
      tierLabel = null;
      flavorText = null;
    }

    // All memories for this actor + NPC (pending + processed), sorted chronologically by submission time
    const allDeclarations = DataManager.getDeclarations();
    const allMemories = allDeclarations
      .filter(d => d.actorId === this.actor.id && d.npcId === this.npcId)
      .sort((a, b) => (a.submittedAt ?? 0) - (b.submittedAt ?? 0));

    return { node, state, tierLabel, flavorText, slots, slotsPerSide, overflow, hiddenPoints: hp, isKnown: rel.isKnown, allMemories };
  }

  async _renderHTML(context, options) {
    const root = document.createElement('div');
    root.classList.add('rrt-npc-detail-panel');

    if (context.missing) {
      const p = document.createElement('p');
      p.classList.add('rrt-empty');
      p.textContent = 'Entry not found.';
      root.appendChild(p);
      return root;
    }

    // ── Header ───────────────────────────────────────────────────────────────
    const header = document.createElement('div');
    header.classList.add('rrt-detail-header', `rrt-state-${context.state}`);

    // Avatar
    const avatar = document.createElement('div');
    avatar.classList.add('rrt-detail-avatar');
    if (context.node.img) {
      const img = document.createElement('img');
      img.src = context.node.img;
      img.alt = context.node.name;
      avatar.appendChild(img);
    } else {
      avatar.innerHTML = '<i class="fas fa-user"></i>';
    }
    header.appendChild(avatar);

    // Header info column
    const headerInfo = document.createElement('div');
    headerInfo.classList.add('rrt-detail-header-info');

    // Name + type badge
    const nameEl = document.createElement('div');
    nameEl.classList.add('rrt-detail-name');
    nameEl.textContent = context.node.name;

    const typeBadge = document.createElement('span');
    typeBadge.classList.add('rrt-detail-type-badge');
    typeBadge.textContent = game.i18n.localize(`RRT.type.${context.node.type}`);
    nameEl.appendChild(typeBadge);
    headerInfo.appendChild(nameEl);

    // Tier label
    if (context.tierLabel) {
      const labelEl = document.createElement('div');
      labelEl.classList.add('rrt-detail-tier-label');
      labelEl.textContent = context.tierLabel;
      headerInfo.appendChild(labelEl);
    }

    // Pip meter (positive only)
    if (context.state === 'positive') {
      headerInfo.appendChild(this._buildSlotTrack(context.slots, context.slotsPerSide, context.overflow > 0));
    }

    // Flavor text
    if (context.flavorText) {
      const flavorEl = document.createElement('div');
      flavorEl.classList.add('rrt-detail-flavor');
      flavorEl.textContent = context.flavorText;
      headerInfo.appendChild(flavorEl);
    }

    header.appendChild(headerInfo);
    root.appendChild(header);

    // ── Memories ──────────────────────────────────────────────────────────────
    const declSection = document.createElement('div');
    declSection.classList.add('rrt-detail-section');

    const declHeader = document.createElement('h3');
    declHeader.classList.add('rrt-section-header');
    declHeader.textContent = game.i18n.localize('RRT.panel.memories');
    declSection.appendChild(declHeader);

    if (context.allMemories.length === 0) {
      const empty = document.createElement('p');
      empty.classList.add('rrt-empty');
      empty.textContent = game.i18n.localize('RRT.panel.noMemories');
      declSection.appendChild(empty);
    } else {
      for (const d of context.allMemories) {
        declSection.appendChild(this._buildDeclarationCard(d, context.node.name));
      }
    }
    root.appendChild(declSection);

    // ── Make Declaration button ───────────────────────────────────────────────
    const declareBtn = document.createElement('button');
    declareBtn.type = 'button';
    declareBtn.classList.add('rrt-btn', 'rrt-detail-declare-btn');
    declareBtn.textContent = game.i18n.localize('RRT.panel.declare');
    declareBtn.addEventListener('click', () => new DeclareChangeDialog({ actor: this.actor, npcId: this.npcId }).render(true));
    root.appendChild(declareBtn);

    return root;
  }

  _replaceHTML(result, content, options) {
    const scrollTop = content.querySelector('.rrt-npc-detail-panel')?.scrollTop ?? 0;
    content.replaceChildren(result);
    const panel = content.querySelector('.rrt-npc-detail-panel');
    if (panel) panel.scrollTop = scrollTop;
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  _buildSlotTrack(filled, slotsPerSide, hasOverflow) {
    const track = document.createElement('div');
    track.classList.add('rrt-slot-track');
    for (let i = 0; i < slotsPerSide; i++) {
      const slot = document.createElement('span');
      const isFilled = i < filled;
      const isLast = i === filled - 1;
      slot.classList.add('rrt-slot');
      if (isFilled) slot.classList.add('rrt-slot--filled');
      if (isFilled && isLast && hasOverflow) {
        slot.classList.add('rrt-slot--overflow');
        slot.title = game.i18n.localize('RRT.panel.overflowTooltip');
      }
      track.appendChild(slot);
    }
    return track;
  }

  _buildDeclarationCard(d, npcName) {
    const card = document.createElement('div');
    card.classList.add('rrt-detail-decl-card', `rrt-status--${d.status}`);

    // Header row: status badge + direction chip
    const header = document.createElement('div');
    header.classList.add('rrt-card-header');

    const badge = document.createElement('span');
    badge.classList.add('rrt-status-badge');
    badge.textContent = game.i18n.localize(`RRT.status.${d.status}`);
    header.appendChild(badge);

    if (d.direction && d.impactLevel) {
      const chip = document.createElement('span');
      chip.classList.add('rrt-impact-chip', `rrt-direction-${d.direction}`);
      chip.textContent = game.i18n.localize(`RRT.impact.${d.impactLevel}`);
      header.appendChild(chip);
    }

    card.appendChild(header);

    // Description (full, no truncation)
    if (d.description) {
      const desc = document.createElement('p');
      desc.classList.add('rrt-card-desc');
      desc.textContent = d.description;
      card.appendChild(desc);
    }

    // Memory flavor line (omitted for pending — GM hasn't reviewed yet)
    if (d.status !== 'pending') {
      const flavor = document.createElement('p');
      flavor.classList.add('rrt-card-flavor');
      flavor.textContent = game.i18n.format(`RRT.processedFlavor.${d.status}`, { npcName });
      card.appendChild(flavor);
    }

    return card;
  }
}
