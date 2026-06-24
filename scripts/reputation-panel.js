import * as DataManager from './data-manager.js';
import { filledSlots, overflowBuffer, getPositiveTierLabel, getNegativeTierLabel } from './reputation-utils.js';
import { DeclareChangeDialog } from './declare-dialog.js';
import { NpcDetailPanel, openDetailPanels } from './npc-detail-panel.js';

const ID = 'remito-reputation-tracker';
const { ApplicationV2 } = foundry.applications.api;

// Track all open panels so we can re-render them when data changes
export const openPanels = new Map(); // actorId → ActorReputationPanel instance

export class ActorReputationPanel extends ApplicationV2 {
  constructor(actor, options = {}) {
    super(options);
    this.actor = actor;
  }

  _activeTab = 'factions'; // 'factions' | 'declarations'

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

    // Build hierarchical npcTree: { renderType: 'category'|'npc', depth, ...row_data }
    const npcTree = [];

    function walkFactions(container, depth = 0) {
      const sorted = Object.values(container).sort((a, b) => a.name.localeCompare(b.name));
      for (const node of sorted) {
        if (node.type === 'category') {
          if (!isGM && !node.isVisible) {
            if (node.subfactions) walkFactions(node.subfactions, depth + 1);
            continue;
          }
          npcTree.push({ renderType: 'category', id: node.id, name: node.name, depth });
          if (node.subfactions) walkFactions(node.subfactions, depth + 1);
          continue;
        }

        // faction or npc — has reputation track
        if (!isGM && !node.isVisible) {
          if (node.subfactions) walkFactions(node.subfactions, depth + 1);
          continue;
        }

        const rel = relationships[node.id] ?? { hiddenPoints: 0, isKnown: false, playerLabelOverride: null };

        if (!isGM && !rel.isKnown) {
          if (node.subfactions) walkFactions(node.subfactions, depth + 1);
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
            ? { label: rel.playerLabelOverride, flavorText: rel.playerFlavorOverride ?? '' }
            : (getPositiveTierLabel(hp, slotsPerSide, pointsPerSlot, positiveTierLabels) ?? { label: '', flavorText: '' });
          tierLabel = tier.label;
          flavorText = tier.flavorText;
        } else if (hp < 0) {
          state = 'negative';
          const tier = rel.playerLabelOverride
            ? { label: rel.playerLabelOverride, flavorText: rel.playerFlavorOverride ?? '' }
            : (getNegativeTierLabel(hp, slotsPerSide, pointsPerSlot, negativeTierLabels) ?? { label: '', flavorText: '' });
          tierLabel = tier.label;
          flavorText = tier.flavorText ?? null; // M6.1: propagate negative flavor text
        } else {
          state = 'neutral';
          tierLabel = null;
          flavorText = null;
        }

        npcTree.push({
          renderType: 'npc',
          id: node.id,
          name: node.name,
          img: node.img || null,
          depth,
          state,
          tierLabel,
          flavorText,
          slots,
          slotsPerSide,
          overflow,
          isKnown: rel.isKnown,
          hiddenPoints: isGM ? hp : null,
        });

        if (node.subfactions) walkFactions(node.subfactions, depth + 1);
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

    return { npcTree, pending, processed, slotsPerSide, isGM };
  }

  async _renderHTML(context, options) {
    const root = document.createElement('div');
    root.classList.add('remito-reputation-panel');

    // ── Tab bar ───────────────────────────────────────────────────────────────
    const tabBar = document.createElement('div');
    tabBar.classList.add('rrt-tab-bar');

    const factionsTabBtn = document.createElement('button');
    factionsTabBtn.type = 'button';
    factionsTabBtn.classList.add('rrt-tab-btn');
    if (this._activeTab === 'factions') factionsTabBtn.classList.add('rrt-tab-btn--active');
    factionsTabBtn.textContent = game.i18n.localize('RRT.panel.tabFactions');
    factionsTabBtn.addEventListener('click', () => { this._activeTab = 'factions'; this.render(); });

    const declTabBtn = document.createElement('button');
    declTabBtn.type = 'button';
    declTabBtn.classList.add('rrt-tab-btn');
    if (this._activeTab === 'declarations') declTabBtn.classList.add('rrt-tab-btn--active');
    declTabBtn.textContent = game.i18n.localize('RRT.panel.tabDeclarations');
    declTabBtn.addEventListener('click', () => { this._activeTab = 'declarations'; this.render(); });

    tabBar.append(factionsTabBtn, declTabBtn);
    root.appendChild(tabBar);

    // ── Factions tab ──────────────────────────────────────────────────────────
    if (this._activeTab === 'factions') {
      const npcSection = document.createElement('div');
      npcSection.classList.add('rrt-section');

      const npcHeader = document.createElement('h3');
      npcHeader.classList.add('rrt-section-header');
      npcHeader.textContent = game.i18n.localize('RRT.panel.relationships');
      npcSection.appendChild(npcHeader);

      if (context.npcTree.length === 0) {
        const empty = document.createElement('p');
        empty.classList.add('rrt-empty');
        empty.textContent = game.i18n.localize('RRT.panel.noRelationships');
        npcSection.appendChild(empty);
      } else {
        for (const entry of context.npcTree) {
          if (entry.renderType === 'category') {
            npcSection.appendChild(this._buildCategoryHeader(entry));
          } else {
            npcSection.appendChild(this._buildNpcRow(entry, context.slotsPerSide));
          }
        }
      }
      root.appendChild(npcSection);
    }

    // ── Declarations tab ──────────────────────────────────────────────────────
    if (this._activeTab === 'declarations') {
      // Pending declarations
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

      // Processed declarations
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
    }

    return root;
  }

  _replaceHTML(result, content, options) {
    const scrollTop = content.querySelector('.remito-reputation-panel')?.scrollTop ?? 0;
    content.replaceChildren(result);
    const panel = content.querySelector('.remito-reputation-panel');
    if (panel) panel.scrollTop = scrollTop;
  }

  // ── Row builders ──────────────────────────────────────────────────────────

  _buildCategoryHeader(entry) {
    const el = document.createElement('div');
    el.classList.add('rrt-category-header');
    el.style.setProperty('--rrt-depth', entry.depth);
    el.textContent = entry.name;
    return el;
  }

  _buildNpcRow(row, slotsPerSide) {
    const el = document.createElement('div');
    el.classList.add('rrt-npc-row', `rrt-state-${row.state}`);
    el.dataset.npcId = row.id;
    if (row.depth) el.style.setProperty('--rrt-depth', row.depth);

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

    // GM click → open NPC detail panel
    if (game.user.isGM) {
      const openDetail = () => {
        const panelId = `remito-npc-detail-${this.actor.id}-${row.id}`;
        let detail = openDetailPanels.get(panelId);
        if (!detail || !detail.rendered) {
          detail = new NpcDetailPanel(this.actor, row.id);
          openDetailPanels.set(panelId, detail);
        }
        detail.render(true);
      };
      avatar.classList.add('rrt-clickable');
      avatar.addEventListener('click', openDetail);
    }

    el.appendChild(avatar);

    // Info block
    const info = document.createElement('div');
    info.classList.add('rrt-npc-info');

    const nameEl = document.createElement('div');
    nameEl.classList.add('rrt-npc-name');

    nameEl.textContent = row.name;
    if (row.state === 'unknown') {
      nameEl.insertAdjacentHTML('beforeend', ' <i class="fas fa-lock" style="font-size:0.7em"></i>');
    }
    info.appendChild(nameEl);

    if (row.state === 'positive' && row.tierLabel) {
      const sub = document.createElement('div');
      sub.classList.add('rrt-npc-subtitle');
      sub.textContent = row.tierLabel;
      info.appendChild(sub);
      if (row.flavorText) {
        const flavor = document.createElement('div');
        flavor.classList.add('rrt-npc-flavor');
        flavor.textContent = row.flavorText;
        info.appendChild(flavor);
      }
    }

    if (row.state === 'negative' && row.tierLabel) {
      const sub = document.createElement('div');
      sub.classList.add('rrt-npc-subtitle');
      sub.textContent = row.tierLabel;
      info.appendChild(sub);
      const flavor = document.createElement('div');
      flavor.classList.add('rrt-npc-flavor');
      // M6.1: use custom flavor text if available, otherwise fall back to generic format
      flavor.textContent = row.flavorText
        ? row.flavorText
        : game.i18n.format('RRT.panel.negativeFlavor', { label: row.tierLabel });
      info.appendChild(flavor);
    }

    // GM click on info block → open NPC detail panel (reuse same openDetail logic as avatar)
    if (game.user.isGM) {
      const openDetail = () => {
        const panelId = `remito-npc-detail-${this.actor.id}-${row.id}`;
        let detail = openDetailPanels.get(panelId);
        if (!detail || !detail.rendered) {
          detail = new NpcDetailPanel(this.actor, row.id);
          openDetailPanels.set(panelId, detail);
        }
        detail.render(true);
      };
      info.classList.add('rrt-clickable');
      info.addEventListener('click', openDetail);
    }

    el.appendChild(info);

    // Slot track (positive only)
    if (row.state === 'positive') {
      el.appendChild(this._buildSlotTrack(row.slots, slotsPerSide, row.overflow > 0));
    }

    // Declare button — visible for every rendered row (players never see unknown-state rows)
    const declareBtn = document.createElement('button');
    declareBtn.type = 'button';
    declareBtn.classList.add('rrt-btn', 'rrt-btn-declare');
    declareBtn.textContent = game.i18n.localize('RRT.panel.declare');
    declareBtn.dataset.npcId = row.id;
    declareBtn.addEventListener('click', () => new DeclareChangeDialog({ actor: this.actor, npcId: row.id }).render(true));
    el.appendChild(declareBtn);

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
      if (isFilled && isLast && hasOverflow) {
        slot.classList.add('rrt-slot--overflow');
        slot.title = game.i18n.localize('RRT.panel.overflowTooltip');
      }
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

    if (d.description) {
      const desc = document.createElement('p');
      desc.classList.add('rrt-card-desc');
      desc.textContent = d.description.length > 120 ? d.description.slice(0, 120) + '…' : d.description;
      card.appendChild(desc);
    }

    const flavor = document.createElement('p');
    flavor.classList.add('rrt-card-flavor');
    flavor.textContent = game.i18n.format(`RRT.processedFlavor.${d.status}`, { npcName: d.npcName });
    card.appendChild(flavor);

    return card;
  }
}
