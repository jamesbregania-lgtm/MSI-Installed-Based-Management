// Repair Parts Monitoring (Admin > Monitoring). Pure: takes the dashboard's
// activity rows, so it is tested on its own (tests/repair-parts-usage.test.js).

// Same rule as activityRowInRange in routes/admin.routes.js: a row counts when
// its own date (dateSort, the SMR date where one exists) is inside the range.
function inRange(row, range) {
  if (!range || !range.start || !range.end) return true;
  const when = Number(row && row.dateSort);
  if (!when) return false;
  return when >= range.start.getTime() && when <= range.end.getTime();
}

/**
 * Repair Parts Monitoring: how often each part was used on a Repair inside the
 * selected range, grouped by unit type (CIJ, LASER, ...) and ranked most-used
 * first. A part counts once per repair it was used on; a repair's date is the
 * same SMR date every other range-aware card uses. Part names are matched
 * case-insensitively, since they all come from the admin Parts list.
 */
function buildRepairPartsUsage(activityRows = [], range = null) {
  const units = new Map();
  let repairs = 0;

  for (const row of activityRows) {
    if (!row || row.activityKind !== 'repair') continue;
    if (!inRange(row, range)) continue;
    const parts = Array.isArray(row.repairParts) ? row.repairParts : [];
    const seen = new Set();
    const names = [];
    for (const raw of parts) {
      const name = String(raw || '').trim();
      const key = name.toUpperCase();
      if (!name || seen.has(key)) continue;
      seen.add(key);
      names.push({ key, name: key });
    }
    if (!names.length) continue;
    repairs += 1;

    const unitName = String(row.unitName || '').trim() || 'Unknown Unit';
    const unitKey = unitName.toUpperCase();
    let unit = units.get(unitKey);
    if (!unit) {
      unit = { unit: unitName, total: 0, repairs: 0, parts: new Map() };
      units.set(unitKey, unit);
    }
    unit.repairs += 1;
    const model = String(row.modelName || '').trim() || 'Unknown Model';
    for (const { key, name } of names) {
      let part = unit.parts.get(key);
      if (!part) {
        part = { name, count: 0, models: new Map() };
        unit.parts.set(key, part);
      }
      part.count += 1;
      part.models.set(model, (part.models.get(model) || 0) + 1);
      unit.total += 1;
    }
  }

  const groups = Array.from(units.values())
    .map(unit => ({
      unit: unit.unit,
      total: unit.total,
      repairs: unit.repairs,
      parts: Array.from(unit.parts.values())
        .map(part => ({
          name: part.name,
          count: part.count,
          models: Array.from(part.models.entries())
            .map(([model, count]) => ({ model, count }))
            .sort((a, b) => b.count - a.count || a.model.localeCompare(b.model))
        }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    }))
    .sort((a, b) => b.total - a.total || a.unit.localeCompare(b.unit));

  return {
    groups,
    repairs,
    totalUsed: groups.reduce((sum, group) => sum + group.total, 0),
    distinctParts: groups.reduce((sum, group) => sum + group.parts.length, 0)
  };
}

module.exports = { buildRepairPartsUsage };
