import * as DataManager from './data-manager.js';
import { calculatePoints, getPositiveTierLabel, getNegativeTierLabel } from './reputation-utils.js';

const ID = 'remito-reputation-tracker';
const { ApplicationV2 } = foundry.applications.api;
const { DialogV2 } = foundry.applications.api;

export class GmReputationManager extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: 'remito-gm-manager',
    window: { title: 'RRT.gmManager.title', resizable: true },
    position: { width: 680, height: 620 },
  };

  _dragNodeId = null;
  _searchQuery = '';

  // Flatten the nested faction tree into a renderable list with depth + parentId metadata
  static _flattenTree(factions, depth = 0, parentId = null) {
    const rows = [];
    const sorted = Object.values(factions).sort((a, b) => a.name.localeCompare(b.name));
    for (const node of sorted) {
      rows.push({ ...node, depth, parentId, hasChildren: Object.keys(node.subfactions ?? {}).length > 0 });
      if (node.subfactions) {
        rows.push(...GmReputationManager._flattenTree(node.subfactions, depth + 1, node.id));
      }
    }
    return rows;
  }

  async _prepareContext(options) {
    const factions = DataManager.getFactions();
    const allDeclarations = DataManager.getDeclarations();
    const pending = allDeclarations
      .filter(d => d.status === 'pending')
      .sort((a, b) => b.submittedAt - a.submittedAt)
      .map(d => ({
        ...d,
        actorName: game.actors.get(d.actorId)?.name ?? '???',
        npcName: DataManager.findFactionById(factions, d.npcId)?.name ?? '???',
      }));

    // Compute relationship badges: { [nodeId]: [{ actorId, actorName, points, tierLabel }] }
    const slotsPerSide = game.settings.get(ID, 'slotsPerSide');
    const pointsPerSlot = game.settings.get(ID, 'pointsPerSlot');
    const positiveTierLabels = game.settings.get(ID, 'positiveTierLabels');
    const negativeTierLabels = game.settings.get(ID, 'negativeTierLabels');
    const relBadges = {};
    for (const actor of game.actors.filter(a => a.type === 'character')) {
      const rels = DataManager.getAllRelationships(actor);
      for (const [npcId, rel] of Object.entries(rels)) {
        if (!rel.hiddenPoints) continue;
        if (!relBadges[npcId]) relBadges[npcId] = [];
        const points = rel.hiddenPoints;
        const tierLabel = points > 0
          ? (getPositiveTierLabel(points, slotsPerSide, pointsPerSlot, positiveTierLabels)?.label ?? `+${points}`)
          : (getNegativeTierLabel(points, slotsPerSide, pointsPerSlot, negativeTierLabels)?.label ?? String(points));
        relBadges[npcId].push({ actorId: actor.id, actorName: actor.name, points, tierLabel });
      }
    }

    return { rows: GmReputationManager._flattenTree(factions), factions, pending, relBadges };
  }

  async _renderHTML(context, options) {
    const root = document.createElement('div');
    root.classList.add('remito-gm-manager');

    // ── Toolbar ──────────────────────────────────────────────────────────────
    const toolbar = document.createElement('div');
    toolbar.classList.add('rrt-toolbar');

    const addFactionBtn = this._makeButton('RRT.gmManager.addFaction', 'rrt-btn-add', () => this._onAddNode(null, 'faction'));
    const addCategoryBtn = this._makeButton('RRT.gmManager.addCategory', 'rrt-btn-add', () => this._onAddNode(null, 'category'));
    const addNpcBtn = this._makeButton('RRT.gmManager.addNpcTop', 'rrt-btn-add', () => this._onAddNode(null, 'npc'));

    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.classList.add('rrt-toolbar-search');
    searchInput.placeholder = game.i18n.localize('RRT.gmManager.searchPlaceholder');
    searchInput.value = this._searchQuery;
    toolbar._searchInput = searchInput;

    toolbar.append(addFactionBtn, addCategoryBtn, addNpcBtn, searchInput);
    root.appendChild(toolbar);

    // ── Faction tree ─────────────────────────────────────────────────────────
    const tree = document.createElement('div');
    tree.classList.add('rrt-faction-tree');

    // Wire the tree container as a drop zone for root-level drops
    tree.addEventListener('dragover', (e) => {
      if (e.target !== tree) return;
      if (!this._dragNodeId) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      tree.classList.add('rrt-tree-drop-over');
    });
    tree.addEventListener('dragleave', (e) => {
      if (e.target === tree) tree.classList.remove('rrt-tree-drop-over');
    });
    tree.addEventListener('drop', async (e) => {
      if (e.target !== tree) return;
      e.preventDefault();
      tree.classList.remove('rrt-tree-drop-over');
      const sourceId = e.dataTransfer.getData('text/plain');
      if (!sourceId) return;
      await this._doMove(sourceId, null);
    });

    if (context.rows.length === 0) {
      const empty = document.createElement('p');
      empty.classList.add('rrt-empty');
      empty.textContent = game.i18n.localize('RRT.gmManager.empty');
      tree.appendChild(empty);
    } else {
      for (const row of context.rows) {
        tree.appendChild(this._buildRow(row, context.relBadges));
      }
    }

    // Wire search input
    this._applySearchFilter(tree, this._searchQuery);
    toolbar._searchInput.addEventListener('input', (e) => {
      this._searchQuery = e.target.value;
      this._applySearchFilter(tree, this._searchQuery);
    });

    root.appendChild(tree);

    // ── Pending declarations queue ────────────────────────────────────────────
    root.appendChild(this._buildDeclarationsSection(context.pending));

    return root;
  }

  _replaceHTML(result, content, options) {
    content.replaceChildren(result);
  }

  // ── Search ────────────────────────────────────────────────────────────────

  _applySearchFilter(tree, query) {
    const q = (query ?? '').toLowerCase().trim();
    const rowEls = tree.querySelectorAll('.rrt-faction-row');

    if (!q) {
      for (const row of rowEls) row.style.display = '';
      return;
    }

    // First pass: find rows whose name matches
    const visible = new Set();
    for (const row of rowEls) {
      const name = row.querySelector('.rrt-row-name')?.textContent?.toLowerCase() ?? '';
      if (name.includes(q)) visible.add(row.dataset.id);
    }

    // Second pass: ensure all ancestors of matching rows stay visible
    for (const row of rowEls) {
      if (!visible.has(row.dataset.id)) continue;
      let parentId = row.dataset.parentId;
      while (parentId) {
        visible.add(parentId);
        const parentEl = tree.querySelector(`.rrt-faction-row[data-id="${parentId}"]`);
        parentId = parentEl?.dataset.parentId;
      }
    }

    // Apply visibility
    for (const row of rowEls) {
      row.style.display = visible.has(row.dataset.id) ? '' : 'none';
    }
  }

  // Build a single faction/NPC/category row element
  _buildRow(row, relBadges = {}) {
    const el = document.createElement('div');
    el.classList.add('rrt-faction-row', `rrt-type-${row.type}`);
    el.style.setProperty('--rrt-depth', row.depth);
    el.dataset.id = row.id;
    el.dataset.type = row.type;
    if (row.parentId) el.dataset.parentId = row.parentId;
    el.draggable = true;

    // Drag handle
    const handle = document.createElement('i');
    handle.className = 'fas fa-grip-vertical rrt-drag-handle';
    el.appendChild(handle);

    // Visibility indicator
    const vis = document.createElement('span');
    vis.classList.add('rrt-vis-icon');
    vis.title = row.isVisible
      ? game.i18n.localize('RRT.gmManager.visibleToAll')
      : game.i18n.localize('RRT.gmManager.gmOnly');
    vis.innerHTML = row.isVisible ? '<i class="fas fa-eye"></i>' : '<i class="fas fa-eye-slash"></i>';
    el.appendChild(vis);

    // Name + type badge
    const info = document.createElement('div');
    info.classList.add('rrt-row-info');

    const name = document.createElement('span');
    name.classList.add('rrt-row-name');
    name.textContent = row.name;

    const badge = document.createElement('span');
    badge.classList.add('rrt-type-badge');
    badge.textContent = game.i18n.localize(`RRT.type.${row.type}`);

    info.append(name, badge);
    el.appendChild(info);

    // Actions
    const actions = document.createElement('div');
    actions.classList.add('rrt-row-actions');

    if (row.type === 'category') {
      actions.append(
        this._makeButton('RRT.gmManager.addFactionSm', 'rrt-btn-add-sm', () => this._onAddNode(row, 'faction')),
        this._makeButton('RRT.gmManager.addNpc', 'rrt-btn-add-sm', () => this._onAddNode(row, 'npc')),
      );
    } else if (row.type === 'faction') {
      actions.appendChild(this._makeButton('RRT.gmManager.addNpc', 'rrt-btn-add-sm', () => this._onAddNode(row, 'npc')));
    }

    // Rels button for non-category rows (NPC/faction have reputation tracks)
    if (row.type !== 'category') {
      actions.appendChild(this._makeButton('RRT.gmManager.editRels', 'rrt-btn-rels', () => this._onEditRelationships(row)));
    }

    const editBtn = this._makeButton('RRT.gmManager.edit', 'rrt-btn-edit', () => this._onEdit(row));
    const delBtn = this._makeButton('RRT.gmManager.delete', 'rrt-btn-delete', () => this._onDelete(row));
    actions.append(editBtn, delBtn);
    el.appendChild(actions);

    // ── Drag events ───────────────────────────────────────────────────────────
    el.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', row.id);
      e.dataTransfer.effectAllowed = 'move';
      this._dragNodeId = row.id;
      setTimeout(() => el.classList.add('rrt-dragging'), 0);
    });

    el.addEventListener('dragover', (e) => {
      if (!this._dragNodeId || this._dragNodeId === row.id) return;
      const factions = DataManager.getFactions();
      if (this._isValidDrop(this._dragNodeId, row.id, row.type, factions)) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        el.classList.add('rrt-drag-over');
        el.classList.remove('rrt-drag-invalid');
      } else {
        el.classList.add('rrt-drag-invalid');
        el.classList.remove('rrt-drag-over');
      }
    });

    el.addEventListener('dragleave', () => {
      el.classList.remove('rrt-drag-over', 'rrt-drag-invalid');
    });

    el.addEventListener('drop', async (e) => {
      e.preventDefault();
      el.classList.remove('rrt-drag-over', 'rrt-drag-invalid');
      const sourceId = e.dataTransfer.getData('text/plain');
      if (!sourceId || sourceId === row.id) return;
      const factions = DataManager.getFactions();
      if (!this._isValidDrop(sourceId, row.id, row.type, factions)) return;
      await this._doMove(sourceId, row.id);
    });

    el.addEventListener('dragend', () => {
      this._dragNodeId = null;
      this.element?.querySelectorAll('.rrt-dragging, .rrt-drag-over, .rrt-drag-invalid')
        .forEach(n => n.classList.remove('rrt-dragging', 'rrt-drag-over', 'rrt-drag-invalid'));
      this.element?.querySelector('.rrt-faction-tree')?.classList.remove('rrt-tree-drop-over');
    });

    // ── Relationship badges ───────────────────────────────────────────────────
    if (row.type !== 'category') {
      const badges = (relBadges[row.id] ?? []).sort((a, z) => a.actorName.localeCompare(z.actorName));
      if (badges.length > 0) {
        const badgeRow = document.createElement('div');
        badgeRow.classList.add('rrt-rel-badges');
        for (const b of badges) {
          const badgeEl = document.createElement('span');
          badgeEl.classList.add('rrt-rel-badge', b.points > 0 ? 'rrt-direction-positive' : 'rrt-direction-negative');
          badgeEl.textContent = `${b.actorName}: ${b.tierLabel}`;
          badgeEl.title = b.actorName;
          badgeEl.addEventListener('click', () => Hooks.callAll('remito.openPanel', b.actorId));
          badgeRow.appendChild(badgeEl);
        }
        el.appendChild(badgeRow);
      }
    }

    return el;
  }

  // Returns true if moving sourceId onto targetId (becoming its child) is a legal operation
  _isValidDrop(sourceId, targetId, targetType, factions) {
    if (sourceId === targetId) return false;
    if (DataManager.isAncestor(factions, sourceId, targetId)) return false;

    const sourceNode = DataManager.findFactionById(factions, sourceId);
    if (!sourceNode) return false;

    const sourceType = sourceNode.type;

    if (sourceType === 'category') return false;
    if (sourceType === 'faction') return targetType === 'category';
    if (sourceType === 'npc') return targetType === 'category' || targetType === 'faction';

    return false;
  }

  async _doMove(sourceId, targetParentId) {
    const factions = DataManager.getFactions();
    DataManager.moveNode(factions, sourceId, targetParentId);
    await DataManager.setFactions(factions);
    this.render();
  }

  // ── Per-NPC Relationship Editor ───────────────────────────────────────────

  async _onEditRelationships(row) {
    const characters = game.actors
      .filter(a => a.type === 'character')
      .sort((a, b) => a.name.localeCompare(b.name));

    if (characters.length === 0) {
      ui.notifications.warn('No character actors found.');
      return;
    }

    let html = '<div class="rrt-rel-dialog">';
    for (const actor of characters) {
      const rel = DataManager.getRelationship(actor, row.id);
      html += `
        <div class="rrt-rel-dialog-row" data-actor-id="${actor.id}">
          <span class="rrt-rel-dialog-name">${this._esc(actor.name)}</span>
          <input type="number" name="hp" class="rrt-rel-hp" value="${rel.hiddenPoints ?? 0}" />
          <label class="rrt-rel-known-label">
            <input type="checkbox" name="isKnown" ${rel.isKnown ? 'checked' : ''} />
            ${game.i18n.localize('RRT.gmManager.isKnown')}
          </label>
          <div class="rrt-rel-overrides">
            <input type="text" name="override" class="rrt-rel-override" value="${this._esc(rel.playerLabelOverride ?? '')}" placeholder="${game.i18n.localize('RRT.gmManager.playerLabelOverride')}" />
            <input type="text" name="flavorOverride" class="rrt-rel-flavor-override" value="${this._esc(rel.playerFlavorOverride ?? '')}" placeholder="${game.i18n.localize('RRT.gmManager.playerFlavorOverride')}" />
          </div>
        </div>
      `;
    }
    html += '</div>';

    const saved = await DialogV2.prompt({
      classes: ['rrt-themed-dialog'],
      window: { title: game.i18n.format('RRT.gmManager.editRelsTitle', { name: row.name }) },
      content: html,
      ok: {
        label: game.i18n.localize('RRT.gmManager.saveAll'),
        callback: async (event, button) => {
          for (const rowEl of button.form.querySelectorAll('[data-actor-id]')) {
            const actorId = rowEl.dataset.actorId;
            const actor = game.actors.get(actorId);
            if (!actor) continue;
            const hp = parseInt(rowEl.querySelector('[name="hp"]').value, 10);
            const isKnown = rowEl.querySelector('[name="isKnown"]').checked;
            const override = rowEl.querySelector('[name="override"]').value.trim() || null;
            const flavorOverride = rowEl.querySelector('[name="flavorOverride"]').value.trim() || null;
            await DataManager.setRelationship(actor, row.id, {
              hiddenPoints: isNaN(hp) ? 0 : hp,
              isKnown,
              playerLabelOverride: override,
              playerFlavorOverride: flavorOverride,
            });
          }
          return true;
        },
      },
    });

    if (saved) {
      ui.notifications.info(game.i18n.localize('RRT.gmManager.relsSaved'));
      this.render();
    }
  }

  // ── Declarations queue ────────────────────────────────────────────────────

  _buildDeclarationsSection(pending) {
    const section = document.createElement('div');
    section.classList.add('rrt-queue-section');

    const header = document.createElement('h3');
    header.classList.add('rrt-section-header', 'rrt-queue-header');
    header.textContent = game.i18n.localize('RRT.gmManager.pendingDeclarations');
    section.appendChild(header);

    if (pending.length === 0) {
      const empty = document.createElement('p');
      empty.classList.add('rrt-empty');
      empty.textContent = game.i18n.localize('RRT.gmManager.noPending');
      section.appendChild(empty);
      return section;
    }

    for (const d of pending) {
      const card = document.createElement('div');
      card.classList.add('rrt-queue-card');

      const cardHeader = document.createElement('div');
      cardHeader.classList.add('rrt-card-header');

      const who = document.createElement('span');
      who.classList.add('rrt-card-who');
      who.textContent = `${d.actorName} → ${d.npcName}`;

      const chip = document.createElement('span');
      chip.classList.add('rrt-impact-chip', `rrt-direction-${d.direction}`);
      chip.textContent = game.i18n.localize(`RRT.impact.${d.impactLevel}`);

      const impactWeights = game.settings.get(ID, 'impactWeights');
      const pts = impactWeights[d.impactLevel] ?? 1;
      const sign = d.direction === 'positive' ? '+' : '−';
      const ptsEl = document.createElement('span');
      ptsEl.classList.add('rrt-queue-pts');
      ptsEl.textContent = `${sign}${pts}`;

      cardHeader.append(who, chip, ptsEl);
      card.appendChild(cardHeader);

      const desc = document.createElement('p');
      desc.classList.add('rrt-card-desc');
      desc.textContent = d.description.length > 120 ? d.description.slice(0, 120) + '…' : d.description;
      card.appendChild(desc);

      const actions = document.createElement('div');
      actions.classList.add('rrt-queue-actions');
      actions.append(
        this._makeButton('RRT.gmManager.accept', 'rrt-btn-add', () => this._onAccept(d)),
        this._makeButton('RRT.gmManager.editPoints', 'rrt-btn-edit', () => this._onEditDeclaration(d)),
        this._makeButton('RRT.gmManager.reject', 'rrt-btn-delete', () => this._onReject(d)),
      );
      card.appendChild(actions);

      section.appendChild(card);
    }

    return section;
  }

  async _onAccept(d) {
    const impactWeights = game.settings.get(ID, 'impactWeights');
    const pts = calculatePoints(d.impactLevel, d.direction, impactWeights);
    const actor = game.actors.get(d.actorId);
    if (actor) {
      const rel = DataManager.getRelationship(actor, d.npcId);
      await DataManager.setRelationship(actor, d.npcId, { hiddenPoints: (rel.hiddenPoints ?? 0) + pts });
    }
    await DataManager.updateDeclaration(d.id, { status: 'accepted', reviewedAt: Date.now() });
    await DataManager.archiveOldDeclarations(d.actorId, game.settings.get(ID, 'declarationArchiveLimit'));
    this.render();
  }

  async _onEditDeclaration(d) {
    const impactWeights = game.settings.get(ID, 'impactWeights');
    const defaultPts = calculatePoints(d.impactLevel, d.direction, impactWeights);

    const rawVal = await DialogV2.prompt({
      classes: ['rrt-themed-dialog'],
      window: { title: game.i18n.localize('RRT.gmManager.editPointsTitle') },
      content: `<label>${game.i18n.localize('RRT.gmManager.editPointsPrompt')}<input type="number" name="pts" value="${defaultPts}" autofocus /></label>`,
      ok: {
        label: game.i18n.localize('RRT.gmManager.save'),
        callback: (event, button) => button.form.elements.pts.value,
      },
    });

    if (rawVal === null || rawVal === undefined || rawVal === '') return;
    const pts = parseInt(rawVal, 10);
    if (isNaN(pts)) return;

    const actor = game.actors.get(d.actorId);
    if (actor) {
      const rel = DataManager.getRelationship(actor, d.npcId);
      await DataManager.setRelationship(actor, d.npcId, { hiddenPoints: (rel.hiddenPoints ?? 0) + pts });
    }
    await DataManager.updateDeclaration(d.id, { status: 'edited', reviewedAt: Date.now() });
    await DataManager.archiveOldDeclarations(d.actorId, game.settings.get(ID, 'declarationArchiveLimit'));
    this.render();
  }

  async _onReject(d) {
    const confirmed = await DialogV2.confirm({
      classes: ['rrt-themed-dialog'],
      window: { title: game.i18n.localize('RRT.gmManager.rejectTitle') },
      content: game.i18n.localize('RRT.gmManager.rejectConfirm'),
    });
    if (!confirmed) return;
    await DataManager.updateDeclaration(d.id, { status: 'rejected', reviewedAt: Date.now() });
    await DataManager.archiveOldDeclarations(d.actorId, game.settings.get(ID, 'declarationArchiveLimit'));
    this.render();
  }

  _makeButton(i18nKey, cssClass, onClick) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.classList.add('rrt-btn');
    if (cssClass) btn.classList.add(cssClass);
    btn.textContent = game.i18n.localize(i18nKey);
    btn.addEventListener('click', onClick);
    return btn;
  }

  // ── CRUD handlers ─────────────────────────────────────────────────────────

  async _onAddNode(parent, type) {
    const name = await DialogV2.prompt({
      classes: ['rrt-themed-dialog'],
      window: { title: game.i18n.localize(`RRT.gmManager.add${this._capitalize(type)}Title`) },
      content: `<label>${game.i18n.localize('RRT.gmManager.nameLabel')}<input type="text" name="name" autofocus /></label>`,
      ok: {
        label: game.i18n.localize('RRT.gmManager.create'),
        callback: (event, button, dialog) => button.form.elements.name.value.trim(),
      },
    });

    if (!name) return;

    const defaultVisibility = game.settings.get(ID, 'defaultNpcVisibility');
    const newNode = {
      id: foundry.utils.randomID(),
      name,
      img: '',
      description: '',
      type,
      isVisible: defaultVisibility === 'all',
      subfactions: {},
    };

    const factions = DataManager.getFactions();

    if (parent) {
      const parentNode = DataManager.findFactionById(factions, parent.id);
      if (parentNode) {
        if (!parentNode.subfactions) parentNode.subfactions = {};
        parentNode.subfactions[newNode.id] = newNode;
      }
    } else {
      factions[newNode.id] = newNode;
    }

    await DataManager.setFactions(factions);
    this.render();
  }

  async _onEdit(row) {
    const result = await DialogV2.prompt({
      classes: ['rrt-themed-dialog'],
      window: { title: game.i18n.localize('RRT.gmManager.editTitle') },
      content: this._buildEditForm(row),
      ok: {
        label: game.i18n.localize('RRT.gmManager.save'),
        callback: (event, button, dialog) => {
          const f = button.form.elements;
          return {
            name: f.name.value.trim(),
            description: f.description.value.trim(),
            img: f.img.value.trim(),
            isVisible: f.isVisible.checked,
          };
        },
      },
    });

    if (!result || !result.name) return;

    const factions = DataManager.getFactions();
    const node = DataManager.findFactionById(factions, row.id);
    if (!node) return;

    Object.assign(node, result);
    await DataManager.setFactions(factions);
    this.render();
  }

  _buildEditForm(row) {
    return `
      <div class="rrt-edit-form">
        <label>${game.i18n.localize('RRT.gmManager.nameLabel')}
          <input type="text" name="name" value="${this._esc(row.name)}" autofocus />
        </label>
        <label>${game.i18n.localize('RRT.gmManager.imgLabel')}
          <input type="text" name="img" value="${this._esc(row.img ?? '')}" placeholder="path/to/image.webp" />
        </label>
        <label>${game.i18n.localize('RRT.gmManager.descriptionLabel')}
          <textarea name="description">${this._esc(row.description ?? '')}</textarea>
        </label>
        <label class="rrt-checkbox-label">
          <input type="checkbox" name="isVisible" ${row.isVisible ? 'checked' : ''} />
          ${game.i18n.localize('RRT.gmManager.visibleToAll')}
        </label>
      </div>
    `;
  }

  async _onDelete(row) {
    const confirmed = await DialogV2.confirm({
      classes: ['rrt-themed-dialog'],
      window: { title: game.i18n.localize('RRT.gmManager.deleteTitle') },
      content: game.i18n.format('RRT.gmManager.deleteConfirm', { name: row.name }),
    });
    if (!confirmed) return;

    const factions = DataManager.getFactions();
    this._deleteFromTree(factions, row.id);
    await DataManager.setFactions(factions);

    await DataManager.cleanupOrphanedRelations();
    await DataManager.removeDeclarationsForNpc(row.id);

    this.render();
  }

  _deleteFromTree(container, id) {
    if (container[id]) {
      delete container[id];
      return true;
    }
    for (const node of Object.values(container)) {
      if (node.subfactions && this._deleteFromTree(node.subfactions, id)) return true;
    }
    return false;
  }

  _capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  _esc(str) {
    return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
}
