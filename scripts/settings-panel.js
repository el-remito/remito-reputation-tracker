const ID = 'remito-reputation-tracker';
const { ApplicationV2 } = foundry.applications.api;
const { DialogV2 } = foundry.applications.api;

export class ReputationSettingsPanel extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: 'remito-settings-panel',
    window: { title: 'RRT.settings.panel.title', resizable: true },
    position: { width: 520, height: 600 },
  };

  async _prepareContext(options) {
    return {
      slotsPerSide: game.settings.get(ID, 'slotsPerSide'),
      pointsPerSlot: game.settings.get(ID, 'pointsPerSlot'),
      archiveLimit: game.settings.get(ID, 'declarationArchiveLimit'),
      impactWeights: game.settings.get(ID, 'impactWeights'),
      positiveTierLabels: game.settings.get(ID, 'positiveTierLabels'),
      negativeTierLabels: game.settings.get(ID, 'negativeTierLabels'),
    };
  }

  async _renderHTML(context, options) {
    const root = document.createElement('div');
    root.classList.add('rrt-settings-panel');

    // ── Core settings ─────────────────────────────────────────────────────────
    const coreSection = document.createElement('div');
    coreSection.classList.add('rrt-settings-section');
    this._addSectionHeader(coreSection, game.i18n.localize('RRT.settings.panel.coreHeader'));
    this._addNumberRow(coreSection, 'slotsPerSide', game.i18n.localize('RRT.settings.slotsPerSide.name'), context.slotsPerSide, 1, 20);
    this._addNumberRow(coreSection, 'pointsPerSlot', game.i18n.localize('RRT.settings.pointsPerSlot.name'), context.pointsPerSlot, 1, 20);
    this._addNumberRow(coreSection, 'archiveLimit', game.i18n.localize('RRT.settings.declarationArchiveLimit.name'), context.archiveLimit, 1, 500);
    root.appendChild(coreSection);

    // ── Impact weights ────────────────────────────────────────────────────────
    const impactSection = document.createElement('div');
    impactSection.classList.add('rrt-settings-section');
    this._addSectionHeader(impactSection, game.i18n.localize('RRT.settings.panel.impactHeader'));
    for (const level of ['minor', 'major', 'severe', 'massive']) {
      this._addNumberRow(impactSection, `impact_${level}`, game.i18n.localize(`RRT.impact.${level}`), context.impactWeights[level], 1, 20);
    }
    root.appendChild(impactSection);

    // ── Positive tier labels ──────────────────────────────────────────────────
    const posSection = document.createElement('div');
    posSection.classList.add('rrt-settings-section');
    this._addSectionHeader(posSection, game.i18n.localize('RRT.settings.panel.posHeader'));
    const posTable = this._buildTierTable(context.positiveTierLabels, 'pos', true);
    this._recalcSlots(posTable);
    posSection.appendChild(posTable);
    const posAddBtn = document.createElement('button');
    posAddBtn.type = 'button';
    posAddBtn.classList.add('rrt-btn', 'rrt-btn-add-sm');
    posAddBtn.textContent = game.i18n.localize('RRT.settings.panel.addTier');
    posAddBtn.addEventListener('click', () => this._addTierRow(posTable, true));
    posSection.appendChild(posAddBtn);
    root.appendChild(posSection);

    // ── Negative tier labels ──────────────────────────────────────────────────
    const negSection = document.createElement('div');
    negSection.classList.add('rrt-settings-section');
    this._addSectionHeader(negSection, game.i18n.localize('RRT.settings.panel.negHeader'));
    const negTable = this._buildTierTable(context.negativeTierLabels, 'neg', true);
    this._recalcSlots(negTable);
    negSection.appendChild(negTable);
    const negAddBtn = document.createElement('button');
    negAddBtn.type = 'button';
    negAddBtn.classList.add('rrt-btn', 'rrt-btn-add-sm');
    negAddBtn.textContent = game.i18n.localize('RRT.settings.panel.addTier');
    negAddBtn.addEventListener('click', () => this._addTierRow(negTable, false));
    negSection.appendChild(negAddBtn);
    root.appendChild(negSection);

    // ── Footer ────────────────────────────────────────────────────────────────
    const footer = document.createElement('div');
    footer.classList.add('rrt-settings-footer');

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.classList.add('rrt-btn');
    cancelBtn.textContent = game.i18n.localize('RRT.settings.panel.cancel');
    cancelBtn.addEventListener('click', () => this.close());

    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.classList.add('rrt-btn', 'rrt-btn-add');
    saveBtn.textContent = game.i18n.localize('RRT.gmManager.save');
    saveBtn.addEventListener('click', () => this._onSave(root));

    footer.append(cancelBtn, saveBtn);
    root.appendChild(footer);

    return root;
  }

  _replaceHTML(result, content, options) {
    content.replaceChildren(result);
  }

  _addSectionHeader(container, text) {
    const h = document.createElement('h3');
    h.classList.add('rrt-section-header');
    h.textContent = text;
    container.appendChild(h);
  }

  _addNumberRow(container, name, label, value, min = 1, max = 999) {
    const row = document.createElement('div');
    row.classList.add('rrt-settings-row');
    const lbl = document.createElement('label');
    lbl.textContent = label;
    lbl.classList.add('rrt-settings-label');
    const input = document.createElement('input');
    input.type = 'number';
    input.name = name;
    input.value = value;
    input.min = min;
    input.max = max;
    input.classList.add('rrt-settings-num');
    row.append(lbl, input);
    container.appendChild(row);
  }

  _buildTierTable(labels, prefix, hasFlavorText) {
    const table = document.createElement('div');
    table.classList.add('rrt-tier-table');
    table.dataset.prefix = prefix;
    table.dataset.hasFlavor = hasFlavorText ? '1' : '0';

    const headerRow = document.createElement('div');
    headerRow.classList.add('rrt-tier-header');
    const slotHead = document.createElement('span');
    slotHead.textContent = game.i18n.localize('RRT.settings.panel.colSlot');
    const labelHead = document.createElement('span');
    labelHead.textContent = game.i18n.localize('RRT.settings.panel.colLabel');
    headerRow.append(slotHead, labelHead);
    if (hasFlavorText) {
      const flavorHead = document.createElement('span');
      flavorHead.textContent = game.i18n.localize('RRT.settings.panel.colFlavor');
      headerRow.appendChild(flavorHead);
    }
    headerRow.appendChild(document.createElement('span')); // spacer for remove btn
    table.appendChild(headerRow);

    for (const tier of labels) {
      table.appendChild(this._makeTierRow(tier, hasFlavorText));
    }
    return table;
  }

  _makeTierRow(tier, hasFlavorText) {
    const row = document.createElement('div');
    row.classList.add('rrt-tier-row');

    const slotEl = document.createElement('span');
    slotEl.classList.add('rrt-tier-slot');
    slotEl.textContent = '—';

    const labelInput = document.createElement('input');
    labelInput.type = 'text';
    labelInput.classList.add('rrt-tier-label-input');
    labelInput.value = tier.label ?? '';

    row.append(slotEl, labelInput);

    if (hasFlavorText) {
      const flavorInput = document.createElement('input');
      flavorInput.type = 'text';
      flavorInput.classList.add('rrt-tier-flavor-input');
      flavorInput.value = tier.flavorText ?? '';
      row.appendChild(flavorInput);
    }

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.classList.add('rrt-btn', 'rrt-btn-delete', 'rrt-tier-remove');
    removeBtn.textContent = '×';
    removeBtn.addEventListener('click', () => {
      const table = row.parentElement;
      row.remove();
      if (table) this._recalcSlots(table);
    });
    row.appendChild(removeBtn);

    return row;
  }

  _addTierRow(table, hasFlavorText) {
    const newTier = { slotThreshold: 0, label: '', flavorText: '' };
    table.appendChild(this._makeTierRow(newTier, hasFlavorText));
    this._recalcSlots(table);
  }

  _recalcSlots(table) {
    const rows = table.querySelectorAll('.rrt-tier-row');
    rows.forEach((row, i) => {
      const slotEl = row.querySelector('.rrt-tier-slot');
      if (slotEl) slotEl.textContent = i + 1;
    });
  }

  async _onSave(root) {
    const getNum = (name, fallback) => {
      const v = parseInt(root.querySelector(`[name="${name}"]`)?.value, 10);
      return isNaN(v) ? fallback : v;
    };

    const newSlotsPerSide = getNum('slotsPerSide', 5);
    const currentSlots = game.settings.get(ID, 'slotsPerSide');

    if (newSlotsPerSide < currentSlots) {
      const ok = await DialogV2.confirm({
        window: { title: game.i18n.localize('RRT.settings.panel.shrinkTitle') },
        content: game.i18n.format('RRT.settings.panel.shrinkWarning', { from: currentSlots, to: newSlotsPerSide }),
      });
      if (!ok) return;
    }

    const readTable = (selector, hasFlavorText) => {
      const rows = root.querySelectorAll(`${selector} .rrt-tier-row`);
      return Array.from(rows).map((row, i) => {
        const label = row.querySelector('.rrt-tier-label-input')?.value?.trim() ?? '';
        const flavorText = hasFlavorText ? (row.querySelector('.rrt-tier-flavor-input')?.value?.trim() ?? '') : '';
        return { slotThreshold: i + 1, label, flavorText };
      });
    };

    await game.settings.set(ID, 'slotsPerSide', newSlotsPerSide);
    await game.settings.set(ID, 'pointsPerSlot', getNum('pointsPerSlot', 3));
    await game.settings.set(ID, 'declarationArchiveLimit', getNum('archiveLimit', 25));
    await game.settings.set(ID, 'impactWeights', {
      minor:   getNum('impact_minor', 1),
      major:   getNum('impact_major', 2),
      severe:  getNum('impact_severe', 3),
      massive: getNum('impact_massive', 5),
    });
    await game.settings.set(ID, 'positiveTierLabels', readTable('.rrt-tier-table[data-prefix="pos"]', true));
    await game.settings.set(ID, 'negativeTierLabels', readTable('.rrt-tier-table[data-prefix="neg"]', true));

    ui.notifications.info(game.i18n.localize('RRT.settings.panel.saved'));
    this.close();
  }
}
