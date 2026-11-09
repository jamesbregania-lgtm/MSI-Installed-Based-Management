const db = require('./db');

function normalizeToken(token) {
  let decoded;
  try {
    decoded = decodeURIComponent(String(token || ''));
  } catch {
    decoded = String(token || '');
  }
  return decoded
    .trim()
    .toLowerCase()
    .replace(/[^a-f0-9]/g, '');
}

function mapRow(row) {
  if (!row) return null;
  return {
    token: row.token,
    username: String(row.username || '').trim().toLowerCase(),
    email: String(row.email || '').trim().toLowerCase(),
    status: String(row.status || 'pending'),
    createdAt: row.created_at ? String(row.created_at) : null,
    expiresAt: row.expires_at ? String(row.expires_at) : null,
    usedAt: row.used_at ? String(row.used_at) : null
  };
}

async function createPasswordReset(resetEntry) {
  const token = normalizeToken(resetEntry.token);
  const row = {
    token,
    username: String(resetEntry.username || '').trim().toLowerCase(),
    email: String(resetEntry.email || '').trim().toLowerCase(),
    status: String(resetEntry.status || 'pending'),
    created_at: resetEntry.createdAt ? String(resetEntry.createdAt) : null,
    expires_at: resetEntry.expiresAt ? String(resetEntry.expiresAt) : null,
    used_at: resetEntry.usedAt ? String(resetEntry.usedAt) : null
  };

  const { error } = await db
    .from('password_resets')
    .upsert(row, { onConflict: 'token' });

  if (error) throw error;
  return mapRow(row);
}

async function findPasswordResetByToken(token) {
  const key = normalizeToken(token);
  if (!key) return null;

  const { data, error } = await db
    .from('password_resets')
    .select('*')
    .eq('token', key)
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data ? mapRow(data) : null;
}

async function updatePasswordReset(token, updates = {}) {
  const key = normalizeToken(token);
  const patch = {};

  if (Object.prototype.hasOwnProperty.call(updates, 'username')) {
    patch.username = String(updates.username || '').trim().toLowerCase();
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'email')) {
    patch.email = String(updates.email || '').trim().toLowerCase();
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'status')) {
    patch.status = String(updates.status || 'pending');
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'createdAt')) {
    patch.created_at = updates.createdAt ? String(updates.createdAt) : null;
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'expiresAt')) {
    patch.expires_at = updates.expiresAt ? String(updates.expiresAt) : null;
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'usedAt')) {
    patch.used_at = updates.usedAt ? String(updates.usedAt) : null;
  }

  if (Object.keys(patch).length === 0) return false;

  const { data, error } = await db
    .from('password_resets')
    .update(patch)
    .eq('token', key)
    .select('token');

  if (error) throw error;
  return data && data.length > 0;
}

module.exports = {
  createPasswordReset,
  findPasswordResetByToken,
  updatePasswordReset
};
