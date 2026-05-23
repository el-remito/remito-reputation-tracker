import * as DataManager from './data-manager.js';
import { filledSlots, overflowBuffer, getPositiveTierLabel, getNegativeTierLabel } from './reputation-utils.js';

const ID = 'remito-reputation-tracker';
const { ApplicationV2 } = foundry.applications.api;

// Track all open panels so we can re-render them when data changes
export const openPanels = new Map(); // actorId → ActorReputationPanel instance

export class ActorReputationPanel extends ApplicationV2 {
  constructor(actor, options = {}) {
    super(options);
    this.actor = actor;
  }

  get id() {
    return `remito-reputation-panel-${this.actor.id}`;
  }

  static DEFAULT_OPTIONS = {
    window: { resizable: true },
    position: { width: 460, height: 600 },
  };

  get title() {
    const isGM = game.user.isGM;
    const gmBadge = isGM ? ` [${game.i18n.localize('RRT.panel.gmBadge')}]` : '';
    return `${this.actor.name} — ${game.i18n.localize('RRT.panel.title')}${gmBadge}`;
  }

  async _prepareContext(options) {
    const factions = DataManager.getFactions();
    const relationships = DataManager.getAllRelationships(this.actor);
    const slotsPerSide = game.settings.get(ID, 'slotsPerSide');
    const pointsPerSlot = game.settings.get(ID, 'pointsPerSlot');
    const positiveTierLabels = game.settings.get(ID, 'positiveTierLabels');
    const negativeTierLabels = game.settings.get(ID, 'negativeTierLabels');
    const archiveLimit = game.settings.get(ID, 'declarationArchiveLimit');
    const isGM = game.user.isGM;

    // Flatten faction tree into NPC/faction rows (skip categories — no track)
    const npcRows = [];
    function walkFactions(container) {
      const sorted = Object.values(container).sort((a, b) => a.name.localeCompare(b.name));
      for (const node of sorted) {
        if (node.type === 'category') {
          if (node.subfactions) walkFactions(node.subfactions);
          continue;
        }
        // Skip GM-only entries for non-GMs
        if (!isGM && !node.isVisible) {
          if (node.subfactions) walkFactions(node.subfactions);
          continue;
        }

        const rel = relationships[node.id] ?? { hiddenPoints: 0, isKnown: false, playerLabelOverride: null };

        if (!isGM && !rel.isKnown) {
          // Unknown to this player — skip entirely (not even ??? shown)
          if (node.subfactions) walkFactions(node.subfactions);
          continue;
        }

        const hp = rel.hiddenPoints ?? 0;
        const slots = filledSlots(hp, slotsPerSide, pointsPerSlot);
        const overflow = overflowBuffer(hp, slotsPerSide, pointsPerSlot);

        let state, tierLabel, flavorText;
        if (!rel.isKnown) {
          state = 'unknown'; // GM only
          tierLabel = null;
          flavorText = null;
        } else if (hp > 0) {
          state = 'positive';
          const tier = rel.playerLabelOverride
            ? { label: rel.playerLabelOverride, flavorText: '' }
            : (getPositiveTierLabel(hp, slotsPerSide, pointsPerSlot, positiveTierLabels) ?? { label: '', flavorText: '' });
          tierLabel = tier.label;
          flavorText = tier.flavorText;
        } else if (hp < 0) {
          state = 'negative';
          const tier = rel.playerLabelOverride
            ? { label: rel.playerLabelOverride }
            : (getNegativeTierLabel(hp, slotsPerSide, pointsPerSlot, negativeTierLabels) ?? { label: '' });
          tierLabel = tier.label;
          flavorText = null;
        } else {
          state = 'neutral';
          tierLabel = null;
          flavorText = null;
        }

        npcRows.push({
          id: node.id,
          name: node.name,
          img: node.img || null,
          state,
          tierLabel,
          flavorText,
          slots,
          slotsPerSide,
          overflow,
          isKnown: rel.isKnown,
          hiddenPoints: isGM ? hp : null, // only expose raw points to GM
        });

        if (node.subfactions) walkFactions(node.subfactions);
      }
    }
    walkFactions(factions);

    // Pending declarations — all characters, visible to all players
    const allDeclarations = DataManager.getDeclarations();
    const pending = allDeclarations
      .filter(d => d.status === 'pending')
      .sort((a, b) => b.submittedAt - a.submittedAt)
      .map(d => ({
        ...d,
        actorName: game.actors.get(d.actorId)?.name ?? '???',
        npcName: DataManager.findFactionById(factions, d.npcId)?.name ?? '???',
      }));

    // Processed declarations — this actor only
    const processed = allDeclarations
      .filter(d => d.actorId === this.actor.id && d.status !== 'pending')
      .sort((a, b) => (b.reviewedAt ?? 0) - (a.reviewedAt ?? 0))
      .slice(0, archiveLimit)
      .map(d => ({
        ...d,
        npcName: DataManager.findFactionById(factions, d.npcId)?.name ?? '???',
      }));

    return { npcRows, pending, processed, slotsPerSide, isGM };
  }

  async _renderHTML(context, options) {
    const root = document.createElement('div');
    root.classList.add('remito-reputation-panel');

    // ── NPC list ─────────────────────────────────────────────────────────────
    const npcSection = document.createElement('div');
    npcSection.classList.add('rrt-section');

    const npcHeader = document.createElement('h3');
    npcHeader.classList.add('rrt-section-header');
    npcHeader.textContent = game.i18n.localize('RRT.panel.relationships');
    npcSection.appendChild(npcHeader);

    if (context.npcRows.length === 0) {
      const empty = document.createElement('p');
      empty.classList.add('rrt-empty');
      empty.textContent = game.i18n.localize('RRT.panel.noRelationships');
      npcSection.appendChild(empty);
    } else {
      for (const row of context.npcRows) {
        npcSection.appendChild(this._buildNpcRow(row, context.slotsPerSide));
      }
    }
    root.appendChild(npcSection);

    // ── Pending declarations ─────────────────────────────────────────────────
    const pendingSection = document.createElement('div');
    pendingSection.classList.add('rrt-section');

    const pendingHeader = document.createElement('h3');
    pendingHeader.classList.add('rrt-section-header');
    pendingHeader.textContent = game.i18n.localize('RRT.panel.pendingDeclarations');
    pendingSection.appendChild(pendingHeader);

    if (context.pending.length === 0) {
      const empty = document.createElement('p');
      empty.classList.add('rrt-empty');
      empty.textContent = game.i18n.localize('RRT.panel.noPending');
      pendingSection.appendChild(empty);
    } else {
      for (const d of context.pending) {
        pendingSection.appendChild(this._buildPendingCard(d));
      }
    }
    root.appendChild(pendingSection);

    // ── Processed declarations ───────────────────────────────────────────────
    const processedSection = document.createElement('div');
    processedSection.classList.add('rrt-section');

    const processedHeader = document.createElement('h3');
    processedHeader.classList.add('rrt-section-header');
    processedHeader.textContent = game.i18n.localize('RRT.panel.processedDeclarations');
    processedSection.appendChild(processedHeader);

    if (context.processed.length === 0) {
      const empty = document.createElement('p');
      empty.classList.add('rrt-empty');
      empty.textContent = game.i18n.localize('RRT.panel.noProcessed');
      processedSection.appendChild(empty);
    } else {
      for (const d of context.processed) {
        processedSection.appendChild(this._buildProcessedCard(d));
      }
    }
    root.appendChild(processedSection);

    return root;
  }

  _replaceHTML(result, content, options) {
    content.replaceChildren(result);
  }

  // ── Row builders ──────────────────────────────────────────────────────────

  _buildNpcRow(row, slotsPerSide) {
    const el = document.createElement('div');
    el.classList.add('rrt-npc-row', `rrt-state-${row.state}`);
    el.dataset.npcId = row.id;

    // Avatar
    const avatar = document.createElement('div');
    avatar.classList.add('rrt-npc-avatar');
    if (row.img) {
      const img = document.createElement('img');
      img.src = row.img;
      img.alt = row.name;
      avatar.appendChild(img);
    } else {
      avatar.innerHTML = '<i class="fas fa-user"></i>';
    }
    el.appendChild(avatar);

    // Info block
    const info = document.createElement('div');
    info.classList.add('rrt-npc-info');

    const nameEl = document.createElement('div');
    nameEl.classList.add('rrt-npc-name');

    if (row.state === 'unknown') {
      nameEl.textContent = '???';
      nameEl.insertAdjacentHTML('beforeend', ' <i class="fas fa-lock" style="font-size:0.7em"></i>');
    } else {
      nameEl.textContent = row.name;
    }
    info.appendChild(nameEl);

    if (row.state === 'positive' && row.tierLabel) {
      const sub = document.createElement('div');
      sub.classList.add('rrt-npc-subtitle');
      sub.textContent = row.tierLabel;
      info.appendChild(sub);
    }

    if (row.state === 'negative' && row.tierLabel) {
      const flavor = document.createElement('div');
      flavor.classList.add('rrt-npc-flavor');
      flavor.textContent = game.i18n.format('RRT.panel.negativeFlavor', { label: row.tierLabel });
      info.appendChild(flavor);
    }

    el.appendChild(info);

    // Slot track (positive only)
    if (row.state === 'positive') {
      el.appendChild(this._buildSlotTrack(row.slots, slotsPerSide, row.overflow > 0));
    }

    // Declare button (stub — wired in M4)
    if (row.state !== 'unknown') {
      const declareBtn = document.createElement('button');
      declareBtn.type = 'button';
      declareBtn.classList.add('rrt-btn', 'rrt-btn-declare');
      declareBtn.textContent = game.i18n.localize('RRT.panel.declare');
      declareBtn.dataset.npcId = row.id;
      // M4: declareBtn.addEventListener('click', () => new DeclareChangeDialog({actor: this.actor, npcId: row.id}).render(true));
      el.appendChild(declareBtn);
    }

    return el;
  }

  _buildSlotTrack(filled, slotsPerSide, hasOverflow) {
    const track = document.createElement('div');
    track.classList.add('rrt-slot-track');

    for (let i = 0; i < slotsPerSide; i++) {
      const slot = document.createElement('span');
      const isFilled = i < filled;
      const isLast = i === filled - 1;
      slot.classList.add('rrt-slot');
      if (isFilled) slot.classList.add('rrt-slot--filled');
      if (isFilled && isLast && hasOverflow) slot.classList.add('rrt-slot--overflow');
      track.appendChild(slot);
    }

    return track;
  }

  _buildPendingCard(d) {
    const card = document.createElement('div');
    card.classList.add('rrt-declaration-card', 'rrt-status--pending');

    const header = document.createElement('div');
    header.classList.add('rrt-card-header');

    const who = document.createElement('span');
    who.classList.add('rrt-card-who');
    who.textContent = `${d.actorName} → ${d.npcName}`;

    const chip = document.createElement('span');
    chip.classList.add('rrt-impact-chip', `rrt-direction-${d.direction}`);
    chip.textContent = game.i18n.localize(`RRT.impact.${d.impactLevel}`);

    const badge = document.createElement('span');
    badge.classList.add('rrt-status-badge');
    badge.textContent = game.i18n.localize('RRT.status.pending');

    header.append(who, chip, badge);
    card.appendChild(header);

    const desc = document.createElement('p');
    desc.classList.add('rrt-card-desc');
    desc.textContent = d.description.length > 80 ? d.description.slice(0, 80) + '…' : d.description;
    card.appendChild(desc);

    return card;
  }

  _buildProcessedCard(d) {
    const card = document.createElement('div');
    card.classList.add('rrt-declaration-card', `rrt-status--${d.status}`);

    const header = document.createElement('div');
    header.classList.add('rrt-card-header');

    const npcEl = document.createElement('span');
    npcEl.classList.add('rrt-card-who');
    npcEl.textContent = d.npcName;

    const badge = document.createElement('span');
    badge.classList.add('rrt-status-badge');
    badge.textContent = game.i18n.localize(`RRT.status.${d.status}`);

    header.append(npcEl, badge);
    card.appendChild(header);

    const flavor = document.createElement('p');
    flavor.classList.add('rrt-card-flavor');
    flavor.textContent = game.i18n.format(`RRT.processedFlavor.${d.status}`, { npcName: d.npcName });
    card.appendChild(flavor);

    return card;
  }
}
