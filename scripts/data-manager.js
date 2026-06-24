const ID = 'remito-reputation-tracker';
const FLAG = 'relationships';

const DEFAULT_RELATIONSHIP = { hiddenPoints: 0, isKnown: false, playerLabelOverride: null, playerFlavorOverride: null };

function getSetting(key) {
  return foundry.utils.deepClone(game.settings.get(ID, key));
}

// ── Factions ────────────────────────────────────────────────────────────────

export function getFactions() {
  return getSetting('factions');
}

export async function setFactions(data) {
  return game.settings.set(ID, 'factions', data);
}

// Walk the nested faction tree and collect all leaf NPC/faction IDs (non-category nodes)
export function collectFactionIds(factions) {
  const ids = new Set();
  function walk(node) {
    ids.add(node.id);
    if (node.subfactions) {
      for (const child of Object.values(node.subfactions)) walk(child);
    }
  }
  for (const node of Object.values(factions)) walk(node);
  return ids;
}

// Find a faction/NPC by id anywhere in the tree; returns the node or null
export function findFactionById(factions, id) {
  for (const node of Object.values(factions)) {
    if (node.id === id) return node;
    if (node.subfactions) {
      const found = findFactionById(node.subfactions, id);
      if (found) return found;
    }
  }
  return null;
}

// ── Relationships ────────────────────────────────────────────────────────────

export function getAllRelationships(actor) {
  return foundry.utils.deepClone(actor.getFlag(ID, FLAG) ?? {});
}

export function getRelationship(actor, npcId) {
  const all = actor.getFlag(ID, FLAG) ?? {};
  return foundry.utils.deepClone(all[npcId] ?? DEFAULT_RELATIONSHIP);
}

export async function setRelationship(actor, npcId, patch) {
  const all = getAllRelationships(actor);
  all[npcId] = { ...(all[npcId] ?? DEFAULT_RELATIONSHIP), ...patch };
  return actor.setFlag(ID, FLAG, all);
}

// ── Tree reorganization ───────────────────────────────────────────────────

// Remove a node from wherever it lives in the tree and return it.
function extractNode(container, nodeId) {
  if (container[nodeId]) {
    const node = container[nodeId];
    delete container[nodeId];
    return node;
  }
  for (const child of Object.values(container)) {
    if (child.subfactions) {
      const found = extractNode(child.subfactions, nodeId);
      if (found) return found;
    }
  }
  return null;
}

// Move nodeId to be a child of targetParentId (or to root if targetParentId is null).
// Mutates the factions object in place — caller must save afterwards.
export function moveNode(factions, nodeId, targetParentId) {
  const node = extractNode(factions, nodeId);
  if (!node) return;

  if (targetParentId === null) {
    factions[nodeId] = node;
  } else {
    const target = findFactionById(factions, targetParentId);
    if (!target) { factions[nodeId] = node; return; } // safety: restore to root
    if (!target.subfactions) target.subfactions = {};
    target.subfactions[nodeId] = node;
  }
}

// Returns true if candidateId is an ancestor of nodeId in the tree.
export function isAncestor(factions, candidateId, nodeId) {
  function walk(container) {
    if (container[candidateId]) {
      return _hasDescendant(container[candidateId], nodeId);
    }
    for (const child of Object.values(container)) {
      if (child.subfactions && walk(child.subfactions)) return true;
    }
    return false;
  }
  function _hasDescendant(node, id) {
    if (!node.subfactions) return false;
    if (node.subfactions[id]) return true;
    return Object.values(node.subfactions).some(c => _hasDescendant(c, id));
  }
  return walk(factions);
}

// Remove relationship keys for NPCs that no longer exist in the faction tree
export async function cleanupOrphanedRelations() {
  const factions = getFactions();
  const validIds = collectFactionIds(factions);
  const actors = game.actors.filter(a => a.getFlag(ID, FLAG));
  for (const actor of actors) {
    const all = getAllRelationships(actor);
    let changed = false;
    for (const npcId of Object.keys(all)) {
      if (!validIds.has(npcId)) {
        delete all[npcId];
        changed = true;
      }
    }
    if (changed) await actor.setFlag(ID, FLAG, all);
  }
}

// ── Declarations ─────────────────────────────────────────────────────────────

export function getDeclarations() {
  return getSetting('declarations');
}

export async function addDeclaration(declaration) {
  const declarations = getDeclarations();
  declarations.push(declaration);
  return game.settings.set(ID, 'declarations', declarations);
}

export async function updateDeclaration(id, patch) {
  const declarations = getDeclarations();
  const idx = declarations.findIndex(d => d.id === id);
  if (idx === -1) return;
  declarations[idx] = { ...declarations[idx], ...patch };
  return game.settings.set(ID, 'declarations', declarations);
}

// Remove all declarations referencing a deleted NPC id
export async function removeDeclarationsForNpc(npcId) {
  const declarations = getDeclarations().filter(d => d.npcId !== npcId);
  return game.settings.set(ID, 'declarations', declarations);
}

// Keep only the most recent `limit` processed (non-pending) declarations per actor
export async function archiveOldDeclarations(actorId, limit) {
  const declarations = getDeclarations();
  const processed = declarations
    .filter(d => d.actorId === actorId && d.status !== 'pending')
    .sort((a, b) => (a.reviewedAt ?? 0) - (b.reviewedAt ?? 0));

  if (processed.length <= limit) return;

  const toRemove = new Set(processed.slice(0, processed.length - limit).map(d => d.id));
  const pruned = declarations.filter(d => !toRemove.has(d.id));
  return game.settings.set(ID, 'declarations', pruned);
}
