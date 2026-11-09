const db = require('./db');

// "relation does not exist" (database/db.js maps MySQL 1146 to 42P01):
// the 002 migration hasn't been run yet.
function isMissingTableError(error) {
  const code = String(error && error.code || '');
  return code === '42P01' || code === 'PGRST205';
}

function mapRow(row) {
  return {
    id: row.id,
    unit: row.unit,
    unitKey: row.unit_key,
    model: row.model || null,
    modelKey: row.model_key || null,
    createdBy: row.created_by || '',
    createdAt: row.created_at
  };
}

/**
 * Admin-added units/models. Returns { rows, available } — available is false
 * when the table hasn't been created, so callers fall back to the built-in
 * catalog instead of failing the page.
 */
async function listUnitModels() {
  const { data, error } = await db
    .from('unit_models')
    .select('*')
    .order('id');
  if (error) {
    if (isMissingTableError(error)) return { rows: [], available: false };
    throw error;
  }
  return { rows: (data || []).map(mapRow), available: true };
}

async function insertUnitModel({ unit, unitKey, model, modelKey, createdBy }) {
  const { data, error } = await db
    .from('unit_models')
    .insert({
      unit,
      unit_key: unitKey,
      model: model || null,
      model_key: modelKey || null,
      created_by: createdBy || ''
    })
    .select('*')
    .single();
  if (error) {
    if (error.code === '23505') {
      const dup = new Error('Duplicate unit or model.');
      dup.code = 'DUPLICATE_UNIT_MODEL';
      throw dup;
    }
    throw error;
  }
  return mapRow(data);
}

async function findUnitModelById(id) {
  const { data, error } = await db
    .from('unit_models')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data ? mapRow(data) : null;
}

async function deleteUnitModel(id) {
  const { error } = await db.from('unit_models').delete().eq('id', id);
  if (error) throw error;
}

module.exports = { listUnitModels, insertUnitModel, findUnitModelById, deleteUnitModel };
