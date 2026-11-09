const crypto = require('crypto');
const db = require('./db');

// The parts catalog is the one list of parts technicians may pick from
// (Cannibalize, Parts Return and the Repair "Parts Used" field). Only admins
// write to it. Part number + unit identify a part; the display name used all
// over the app is "<part_number> <description>".

function mapRow(row) {
  return {
    id: row.id,
    partNumber: row.part_number || '',
    description: row.description || '',
    unit: row.unit || '',
    modelSeries: row.model_series || '',
    name: `${row.part_number || ''} ${row.description || ''}`.trim(),
    createdAt: row.created_at
  };
}

async function listParts() {
  const { data, error } = await db.from('parts_catalog').select('*');
  if (error) throw error;
  return (data || []).map(mapRow).sort((a, b) =>
    a.unit.localeCompare(b.unit) || a.partNumber.localeCompare(b.partNumber)
  );
}

async function findPartById(id) {
  const { data, error } = await db.from('parts_catalog').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data ? mapRow(data) : null;
}

async function insertPart({ partNumber, description, unit }) {
  const { data, error } = await db
    .from('parts_catalog')
    .insert({
      id: crypto.randomUUID(),
      part_number: partNumber,
      description,
      unit,
      model_series: null
    })
    .select('*')
    .single();
  if (error) throw error;
  return mapRow(data);
}

async function updatePart(id, { partNumber, description, unit }) {
  const { error } = await db
    .from('parts_catalog')
    .update({ part_number: partNumber, description, unit })
    .eq('id', id);
  if (error) throw error;
}

async function deletePart(id) {
  const { error } = await db.from('parts_catalog').delete().eq('id', id);
  if (error) throw error;
}

/** Keys used to spot the same part entered twice. */
function partKey(partNumber, unit) {
  return `${String(unit || '').trim().toUpperCase()}|${String(partNumber || '').trim().toUpperCase()}`;
}

module.exports = { listParts, findPartById, insertPart, updatePart, deletePart, partKey };
