export function filledSlots(hiddenPoints, slotsPerSide, pointsPerSlot) {
  if (hiddenPoints <= 0) return 0;
  return Math.min(Math.ceil(hiddenPoints / pointsPerSlot), slotsPerSide);
}

export function overflowBuffer(hiddenPoints, slotsPerSide, pointsPerSlot) {
  const max = slotsPerSide * pointsPerSlot;
  return Math.max(0, hiddenPoints - max);
}

export function getPositiveTierLabel(hiddenPoints, slotsPerSide, pointsPerSlot, positiveTierLabels) {
  const slots = filledSlots(hiddenPoints, slotsPerSide, pointsPerSlot);
  if (slots === 0) return null;
  return positiveTierLabels.find(t => t.slotThreshold === slots) ?? positiveTierLabels.at(-1);
}

export function getNegativeTierLabel(hiddenPoints, slotsPerSide, pointsPerSlot, negativeTierLabels) {
  const absSlots = Math.min(Math.ceil(Math.abs(hiddenPoints) / pointsPerSlot), slotsPerSide);
  if (absSlots === 0) return null;
  return negativeTierLabels.find(t => t.slotThreshold === absSlots) ?? negativeTierLabels.at(-1);
}

export function calculatePoints(impactLevel, direction, impactWeights) {
  const base = impactWeights[impactLevel] ?? 1;
  return direction === 'positive' ? base : -base;
}
