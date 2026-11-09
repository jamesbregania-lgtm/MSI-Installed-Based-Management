const db = require('./db');
const { removePhotoFile } = require('../lib/photo-storage');

// An image picked but never saved with an update (the form was abandoned) is
// deleted after this long.
const UNATTACHED_TTL_MS = 24 * 60 * 60 * 1000;

// "relation does not exist" (database/db.js maps MySQL 1146 to 42P01):
// the 007 migration hasn't been run yet.
function isMissingTableError(error) {
  const code = String(error && error.code || '');
  return code === '42P01' || code === 'PGRST205';
}

function checkError(error) {
  if (!error) return;
  if (isMissingTableError(error)) {
    const err = new Error('Image uploads are not set up yet — run database/migrations/007-update-photos.sql.');
    err.code = 'PHOTOS_UNAVAILABLE';
    throw err;
  }
  throw error;
}

function mapRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    clientId: row.client_id,
    machineId: row.machine_id,
    filePath: row.file_path,
    originalName: row.original_name || '',
    mime: row.mime,
    sizeBytes: Number(row.size_bytes) || 0,
    uploadedBy: row.uploaded_by,
    createdAt: row.created_at,
    attachedAt: row.attached_at
  };
}

async function createPhoto({ id, clientId, filePath, originalName, mime, sizeBytes, uploadedBy }) {
  const { error } = await db.from('update_photos').insert({
    id,
    client_id: String(clientId || '').trim(),
    file_path: filePath,
    original_name: originalName,
    mime,
    size_bytes: sizeBytes,
    uploaded_by: String(uploadedBy || '').trim().toLowerCase()
  });
  checkError(error);
}

async function findPhotoById(id) {
  const { data, error } = await db
    .from('update_photos')
    .select('*')
    .eq('id', String(id || ''))
    .maybeSingle();
  checkError(error);
  return mapRow(data);
}

/**
 * Marks an image as belonging to the update being saved. Succeeds only for an
 * image this user uploaded for this client that no update has used yet, and
 * only once — two saves racing for the same image can't both get it.
 * Returns the photo, or null when it can't be claimed.
 */
async function claimPhoto({ id, clientId, uploadedBy }) {
  const { data, error } = await db
    .from('update_photos')
    .update({ attached_at: new Date().toISOString() })
    .eq('id', String(id || ''))
    .eq('client_id', String(clientId || '').trim())
    .eq('uploaded_by', String(uploadedBy || '').trim().toLowerCase())
    .is('attached_at', null)
    .select('*');
  checkError(error);
  return mapRow(Array.isArray(data) ? data[0] : null);
}

/** Undo a claim when the update it was for failed to save. */
async function releasePhoto(id) {
  const { error } = await db
    .from('update_photos')
    .update({ attached_at: null, machine_id: null })
    .eq('id', String(id || ''));
  checkError(error);
}

async function setPhotoMachine(id, machineId) {
  const { error } = await db
    .from('update_photos')
    .update({ machine_id: Number(machineId) })
    .eq('id', String(id || ''));
  checkError(error);
}

/**
 * Deletes images that were uploaded but never saved with an update, rows and
 * files both. Returns how many went.
 */
async function deleteAbandonedPhotos(now = Date.now()) {
  const { data, error } = await db
    .from('update_photos')
    .select('id, file_path, created_at')
    .is('attached_at', null);
  checkError(error);

  const stale = (data || []).filter(row => {
    const created = Date.parse(row.created_at);
    return Number.isFinite(created) && now - created > UNATTACHED_TTL_MS;
  });

  let removed = 0;
  for (const row of stale) {
    // Only rows still unattached: one may have been claimed since the select.
    const { data: gone, error: deleteError } = await db
      .from('update_photos')
      .delete()
      .eq('id', row.id)
      .is('attached_at', null)
      .select('id');
    checkError(deleteError);
    if (Array.isArray(gone) && gone.length) {
      await removePhotoFile(row.file_path);
      removed += 1;
    }
  }
  return removed;
}

module.exports = {
  UNATTACHED_TTL_MS,
  createPhoto,
  findPhotoById,
  claimPhoto,
  releasePhoto,
  setPhotoMachine,
  deleteAbandonedPhotos
};
