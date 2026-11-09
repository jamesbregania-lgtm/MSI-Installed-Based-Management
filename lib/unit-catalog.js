const { listUnitModels } = require('../database/unit-models.store');

// Machine records spell the unit type inconsistently ("P & A" vs "P&A"), so
// every unit lookup goes through one normalizer.
function normalizeUnitKey(value) {
  const upper = String(value || '').trim().replace(/\s+/g, ' ').toUpperCase();
  return upper === 'P & A' ? 'P&A' : upper;
}

// Duplicate-check key for a model: uppercase, spaces and hyphens dropped, so
// "9750 G", "9750G" and "9750-g" count as the same model.
function normalizeModelKey(value) {
  return String(value || '').toUpperCase().replace(/[\s-]+/g, '');
}

function cleanName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

/**
 * The built-in catalog with admin-added units/models merged on top. Added
 * models get an empty parts list, like most built-in models already have.
 * Never mutates `baseCatalog` — each route keeps its own parts lists.
 */
function mergeCatalog(baseCatalog, rows = []) {
  const merged = {};
  Object.entries(baseCatalog || {}).forEach(([unit, models]) => {
    merged[unit] = { ...models };
  });

  rows.forEach(row => {
    const unitKey = normalizeUnitKey(row.unit);
    let unitName = Object.keys(merged).find(name => normalizeUnitKey(name) === unitKey);
    if (!unitName) {
      unitName = row.unit;
      merged[unitName] = {};
    }
    if (row.model && !Object.prototype.hasOwnProperty.call(merged[unitName], row.model)) {
      merged[unitName][row.model] = [];
    }
  });

  return merged;
}

/**
 * Loads the merged catalog. Falls back to the built-in catalog when the
 * unit_models table doesn't exist yet or can't be read, so the Add Printer
 * form and dashboard never break over this feature.
 */
async function getUnitCatalog(baseCatalog) {
  try {
    const { rows } = await listUnitModels();
    return mergeCatalog(baseCatalog, rows);
  } catch (err) {
    console.error('[unit catalog] falling back to built-in catalog:', err.message || err);
    return mergeCatalog(baseCatalog, []);
  }
}

function findUnitName(catalog, unit) {
  const key = normalizeUnitKey(unit);
  return Object.keys(catalog || {}).find(name => normalizeUnitKey(name) === key) || null;
}

/**
 * Where a model already exists, under ANY unit — the rule is one model name in
 * the whole system, so CIJ 9450 existing blocks TTO 9450. Returns
 * { unit, model } of the existing entry, or null.
 */
function findModelConflict(catalog, model) {
  const key = normalizeModelKey(model);
  if (!key) return null;
  for (const [unit, models] of Object.entries(catalog || {})) {
    const existing = Object.keys(models || {}).find(name => normalizeModelKey(name) === key);
    if (existing) return { unit, model: existing };
  }
  return null;
}

module.exports = {
  normalizeUnitKey,
  normalizeModelKey,
  cleanName,
  mergeCatalog,
  getUnitCatalog,
  findUnitName,
  findModelConflict
};
