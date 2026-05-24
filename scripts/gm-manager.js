import * as DataManager from './data-manager.js';
import { calculatePoints } from './reputation-utils.js';

const ID = 'remito-reputation-tracker';
const { ApplicationV2 } = foundry.applications.api;
const { DialogV2 } = foundry.applications.api;

export class GmReputationManager extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: 'remito-gm-manager',
    window: { title: 'RRT.gmManager.title', resizable: true },
    position: { width: 640, height: 600 },
  };

  _dragNodeId = null;
  _viewMode = 'factions'; // 'factions' | 'relationships'
  _selectedActorId = null;

  // Flatten the nested faction tree into a renderable list with depth metadata
  static _flattenTree(factions, depth = 0) {
    const rows = [];
    const sorted = Object.values(factions).sort((a, b) => a.name.localeCompare(b.name));
    for (const node of sorted) {
      rows.push({ ...node, depth, hasChildren: Object.keys(node.subfactions ?? {}).length > 0 });
      if (node.subfactions) {
        rows.push(...GmReputationManager._flattenTree(node.subfactions, depth + 1));
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
    return { rows: GmReputationManager._flattenTree(factions), factions, pending };
  }

  async _renderHTML(context, options) {
    const root = document.createElement('div');
    root.classList.add('remito-gm-manager');

    // ── Toolbar ──────────────────────────────────────────────────────────────
    const toolbar = document.createElement('div');
    toolbar.classList.add('rrt-toolbar');

    if (this._viewMode === 'factions') {
      const addFactionBtn = this._makeButton('RRT.gmManager.addFaction', 'rrt-btn-add', () => this._onAddNode(null, 'faction'));
      const addCategoryBtn = this._makeButton('RRT.gmManager.addCategory', 'rrt-btn-add', () => this._onAddNode(null, 'category'));
      const addNpcBtn = this._makeButton('RRT.gmManager.addNpcTop', 'rrt-btn-add', () => this._onAddNode(null, 'npc'));
      toolbar.append(addFactionBtn, addCategoryBtn, addNpcBtn);
    }

    // Spacer
    const spacer = document.createElement('span');
    spacer.style.flex = '1';
    toolbar.appendChild(spacer);

    // View toggle
    const factionsToggle = this._makeButton('RRT.gmManager.viewFactions', this._viewMode === 'factions' ? 'rrt-btn-view-active' : '', () => { this._viewMode = 'factions'; this.render(); });
    const relToggle = this._makeButton('RRT.gmManager.viewRelationships', this._viewMode === 'relationships' ? 'rrt-btn-view-active' : '', () => { this._viewMode = 'relationships'; this.render(); });
    toolbar.append(factionsToggle, relToggle);
    root.appendChild(toolbar);

    // ── Relationship editor mode ──────────────────────────────────────────────
    if (this._viewMode === 'relationships') {
      root.appendChild(this._buildRelationshipEditor(context));
      return root;
    }

    // ── Faction tree ─────────────────────────────────────────────────────────
    const tree = document.createElement('div');
    tree.classList.add('rrt-faction-tree');

    // Wire the tree container as a drop zone for root-level drops
    tree.addEventListener('dragover', (e) => {
      // Only handle if the event target is the tree itself (not a child row)
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
        tree.appendChild(this._buildRow(row));
      }
    }

    root.appendChild(tree);

    // ── Pending declarations queue ────────────────────────────────────────────
    root.appendChild(this._buildDeclarationsSection(context.pending));

    return root;
  }

  _replaceHTML(result, content, options) {
    content.replaceChildren(result);
  }

  // Build a single faction/NPC/category row element
  _buildRow(row) {
    const el = document.createElement('div');
    el.classList.add('rrt-faction-row', `rrt-type-${row.type}`);
    el.style.setProperty('--rrt-depth', row.depth);
    el.dataset.id = row.id;
    el.dataset.type = row.type;
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
      // Category can contain factions and NPCs
      actions.append(
        this._makeButton('RRT.gmManager.addFactionSm', 'rrt-btn-add-sm', () => this._onAddNode(row, 'faction')),
        this._makeButton('RRT.gmManager.addNpc', 'rrt-btn-add-sm', () => this._onAddNode(row, 'npc')),
      );
    } else if (row.type === 'faction') {
      // Faction can contain NPCs only
      actions.appendChild(this._makeButton('RRT.gmManager.addNpc', 'rrt-btn-add-sm', () => this._onAddNode(row, 'npc')));
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
      // Use setTimeout so the dragging class applies after the drag image is captured
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
      // Clean up all drag state from every row in the tree
      this.element?.querySelectorAll('.rrt-dragging, .rrt-drag-over, .rrt-drag-invalid')
        .forEach(n => n.classList.remove('rrt-dragging', 'rrt-drag-over', 'rrt-drag-invalid'));
      this.element?.querySelector('.rrt-faction-tree')?.classList.remove('rrt-tree-drop-over');
    });

    return el;
  }

  // Returns true if moving sourceId onto targetId (becoming its child) is a legal operation
  _isValidDrop(sourceId, targetId, targetType, factions) {
    if (sourceId === targetId) return false;
    // Prevent dropping a node onto one of its own descendants (cycle)
    if (DataManager.isAncestor(factions, sourceId, targetId)) return false;

    const sourceNode = DataManager.findFactionById(factions, sourceId);
    if (!sourceNode) return false;

    const sourceType = sourceNode.type;

    // Category → can only go to root (handled by tree container drop zone, not row drops)
    if (sourceType === 'category') return false;
    // Faction → can go into a Category only
    if (sourceType === 'faction') return targetType === 'category';
    // NPC → can go into a Category or a Faction
    if (sourceType === 'npc') return targetType === 'category' || targetType === 'faction';

    return false;
  }

  async _doMove(sourceId, targetParentId) {
    const factions = DataManager.getFactions();
    DataManager.moveNode(factions, sourceId, targetParentId);
    await DataManager.setFactions(factions);
    this.render();
  }

  // ── Relationship editor ───────────────────────────────────────────────────

  _buildRelationshipEditor(context) {
    const wrap = document.createElement('div');
    wrap.classList.add('rrt-rel-editor');

    // Character picker
    const pickerRow = document.createElement('div');
    pickerRow.classList.add('rrt-rel-picker');

    const pickerLbl = document.createElement('label');
    pickerLbl.textContent = game.i18n.localize('RRT.gmManager.selectCharacter');
    pickerLbl.classList.add('rrt-rel-picker-label');

    const select = document.createElement('select');
    select.classList.add('rrt-rel-select');
    const blankOpt = document.createElement('option');
    blankOpt.value = '';
    blankOpt.textContent = '—';
    select.appendChild(blankOpt);
    for (const actor of game.actors.filter(a => a.type === 'character').sort((a, b) => a.name.localeCompare(b.name))) {
      const opt = document.createElement('option');
      opt.value = actor.id;
      opt.textContent = actor.name;
      if (actor.id === this._selectedActorId) opt.selected = true;
      select.appendChild(opt);
    }
    select.addEventListener('change', () => {
      this._selectedActorId = select.value || null;
      this.render();
    });

    pickerRow.append(pickerLbl, select);
    wrap.appendChild(pickerRow);

    // NPC rows
    const list = document.createElement('div');
    list.classList.add('rrt-rel-list');

    if (!this._selectedActorId) {
      const hint = document.createElement('p');
      hint.classList.add('rrt-empty');
      hint.textContent = game.i18n.localize('RRT.gmManager.selectCharacter');
      list.appendChild(hint);
      wrap.appendChild(list);
      return wrap;
    }

    const actor = game.actors.get(this._selectedActorId);
    if (!actor) { wrap.appendChild(list); return wrap; }

    // Flatten all non-category nodes from the tree
    const npcNodes = [];
    function walkForRel(factions) {
      const sorted = Object.values(factions).sort((a, b) => a.name.localeCompare(b.name));
      for (const node of sorted) {
        if (node.type !== 'category') npcNodes.push(node);
        if (node.subfactions) walkForRel(node.subfactions);
      }
    }
    walkForRel(context.factions);

    for (const node of npcNodes) {
      const rel = DataManager.getRelationship(actor, node.id);
      const row = document.createElement('div');
      row.classList.add('rrt-rel-row');

      const nameEl = document.createElement('span');
      nameEl.classList.add('rrt-rel-name');
      nameEl.textContent = node.name;

      const controls = document.createElement('div');
      controls.classList.add('rrt-rel-controls');

      const hpInput = document.createElement('input');
      hpInput.type = 'number';
      hpInput.classList.add('rrt-rel-hp');
      hpInput.value = rel.hiddenPoints ?? 0;
      hpInput.title = 'Hidden Points';

      const knownLabel = document.createElement('label');
      knownLabel.classList.add('rrt-rel-known-label');
      const knownCb = document.createElement('input');
      knownCb.type = 'checkbox';
      knownCb.checked = rel.isKnown ?? false;
      knownLabel.append(knownCb, document.createTextNode(game.i18n.localize('RRT.gmManager.isKnown')));

      const saveBtn = document.createElement('button');
      saveBtn.type = 'button';
      saveBtn.classList.add('rrt-btn', 'rrt-btn-add', 'rrt-rel-save');
      saveBtn.textContent = game.i18n.localize('RRT.gmManager.saveRelationship');
      saveBtn.addEventListener('click', async () => {
        const hp = parseInt(hpInput.value, 10);
        await DataManager.setRelationship(actor, node.id, {
          hiddenPoints: isNaN(hp) ? 0 : hp,
          isKnown: knownCb.checked,
        });
        this.render();
      });

      controls.append(hpInput, knownLabel, saveBtn);
      row.append(nameEl, controls);
      list.appendChild(row);
    }

    wrap.appendChild(list);
    return wrap;
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
      window: { title: game.i18n.localize('RRT.gmManager.deleteTitle') },
      content: game.i18n.format('RRT.gmManager.deleteConfirm', { name: row.name }),
    });
    if (!confirmed) return;

    const factions = DataManager.getFactions();
    this._deleteFromTree(factions, row.id);
    await DataManager.setFactions(factions);

    // Cascade: remove orphaned relationships and declarations
    await DataManager.cleanupOrphanedRelations();
    await DataManager.removeDeclarationsForNpc(row.id);

    this.render();
  }

  // Recursively remove a node by id from any level of the tree
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
