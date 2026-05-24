import * as DataManager from './data-manager.js';

const ID = 'remito-reputation-tracker';
const { ApplicationV2 } = foundry.applications.api;

export class DeclareChangeDialog extends ApplicationV2 {
  constructor({ actor, npcId } = {}, options = {}) {
    super(options);
    this.actor = actor;
    this.preselectedNpcId = npcId ?? null;
    this._direction = 'positive';
    this._impactLevel = 'minor';
  }

  get id() {
    return `remito-declare-${this.actor?.id ?? 'unknown'}`;
  }

  get title() {
    return game.i18n.localize('RRT.declare.title');
  }

  static DEFAULT_OPTIONS = {
    window: { resizable: false },
    position: { width: 420 },
  };

  async _prepareContext(options) {
    const factions = DataManager.getFactions();
    const isGM = game.user.isGM;
    const npcs = [];

    function walk(container) {
      const sorted = Object.values(container).sort((a, b) => a.name.localeCompare(b.name));
      for (const node of sorted) {
        if (node.type !== 'category' && (isGM || node.isVisible)) {
          npcs.push(node);
        }
        if (node.subfactions) walk(node.subfactions);
      }
    }
    walk(factions);

    const impactWeights = game.settings.get(ID, 'impactWeights');
    return { npcs, impactWeights };
  }

  async _renderHTML(context, options) {
    const root = document.createElement('div');
    root.classList.add('rrt-declare-dialog');

    // ── NPC picker ────────────────────────────────────────────────────────────
    const npcGroup = document.createElement('div');
    npcGroup.classList.add('rrt-declare-field');

    const npcLbl = document.createElement('label');
    npcLbl.textContent = game.i18n.localize('RRT.declare.npcLabel');

    const npcSelect = document.createElement('select');
    npcSelect.name = 'npcId';
    for (const npc of context.npcs) {
      const opt = document.createElement('option');
      opt.value = npc.id;
      opt.textContent = npc.name;
      if (npc.id === this.preselectedNpcId) opt.selected = true;
      npcSelect.appendChild(opt);
    }

    npcGroup.append(npcLbl, npcSelect);
    root.appendChild(npcGroup);

    // ── Description ───────────────────────────────────────────────────────────
    const descGroup = document.createElement('div');
    descGroup.classList.add('rrt-declare-field');

    const descLbl = document.createElement('label');
    descLbl.textContent = game.i18n.localize('RRT.declare.descriptionLabel');

    const descArea = document.createElement('textarea');
    descArea.name = 'description';
    descArea.placeholder = game.i18n.localize('RRT.declare.descriptionPlaceholder');
    descArea.rows = 3;

    descGroup.append(descLbl, descArea);
    root.appendChild(descGroup);

    // ── Direction toggle ──────────────────────────────────────────────────────
    const dirGroup = document.createElement('div');
    dirGroup.classList.add('rrt-declare-section');

    const dirLbl = document.createElement('span');
    dirLbl.classList.add('rrt-declare-section-label');
    dirLbl.textContent = game.i18n.localize('RRT.declare.directionLabel');

    const dirRow = document.createElement('div');
    dirRow.classList.add('rrt-direction-toggle');

    for (const dir of ['positive', 'negative']) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.dataset.dir = dir;
      btn.classList.add('rrt-dir-btn', `rrt-dir-${dir}`);
      if (dir === this._direction) btn.classList.add('active');
      btn.textContent = game.i18n.localize(`RRT.declare.direction.${dir}`);
      btn.addEventListener('click', () => {
        this._direction = dir;
        root.querySelectorAll('.rrt-dir-btn').forEach(b => b.classList.toggle('active', b.dataset.dir === dir));
        root.querySelectorAll('.rrt-impact-btn').forEach(b => this._setImpactLabel(b, b.dataset.impact, context.impactWeights));
      });
      dirRow.appendChild(btn);
    }

    dirGroup.append(dirLbl, dirRow);
    root.appendChild(dirGroup);

    // ── Impact grid ───────────────────────────────────────────────────────────
    const impactGroup = document.createElement('div');
    impactGroup.classList.add('rrt-declare-section');

    const impactLbl = document.createElement('span');
    impactLbl.classList.add('rrt-declare-section-label');
    impactLbl.textContent = game.i18n.localize('RRT.declare.impactLabel');

    const impactGrid = document.createElement('div');
    impactGrid.classList.add('rrt-impact-grid');

    for (const level of ['minor', 'major', 'severe', 'massive']) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.dataset.impact = level;
      btn.classList.add('rrt-impact-btn');
      if (level === this._impactLevel) btn.classList.add('active');
      this._setImpactLabel(btn, level, context.impactWeights);
      btn.addEventListener('click', () => {
        this._impactLevel = level;
        root.querySelectorAll('.rrt-impact-btn').forEach(b => b.classList.toggle('active', b.dataset.impact === level));
      });
      impactGrid.appendChild(btn);
    }

    impactGroup.append(impactLbl, impactGrid);
    root.appendChild(impactGroup);

    // ── Footer ────────────────────────────────────────────────────────────────
    const footer = document.createElement('div');
    footer.classList.add('rrt-declare-footer');

    const submitBtn = document.createElement('button');
    submitBtn.type = 'button';
    submitBtn.classList.add('rrt-btn', 'rrt-btn-add');
    submitBtn.textContent = game.i18n.localize('RRT.declare.submit');
    submitBtn.addEventListener('click', () => this._onSubmit(root));

    footer.appendChild(submitBtn);
    root.appendChild(footer);

    return root;
  }

  _replaceHTML(result, content, options) {
    content.replaceChildren(result);
  }

  _setImpactLabel(btn, level, impactWeights) {
    const pts = impactWeights[level] ?? 1;
    const sign = this._direction === 'positive' ? '+' : '−';
    btn.innerHTML = `<span class="rrt-impact-name">${game.i18n.localize(`RRT.impact.${level}`)}</span>`
      + `<span class="rrt-impact-pts">${sign}${pts}</span>`;
  }

  async _onSubmit(root) {
    const npcId = root.querySelector('[name="npcId"]')?.value;
    const description = root.querySelector('[name="description"]')?.value?.trim();

    if (!npcId) return ui.notifications.warn(game.i18n.localize('RRT.declare.errorNoNpc'));
    if (!description) return ui.notifications.warn(game.i18n.localize('RRT.declare.errorNoDesc'));

    const declaration = {
      id: foundry.utils.randomID(),
      actorId: this.actor.id,
      npcId,
      direction: this._direction,
      impactLevel: this._impactLevel,
      description,
      status: 'pending',
      submittedAt: Date.now(),
      reviewedAt: null,
    };

    await DataManager.addDeclaration(declaration);
    Hooks.callAll('remito.declarationAdded', declaration);
    this.close();
  }
}
