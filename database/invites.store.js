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
    email: row.email,
    role: row.role,
    branch: row.branch,
    department: row.department,
    status: row.status,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    acceptedAt: row.accepted_at,
    acceptedUsername: row.accepted_username
  };
}

async function createInvite(invite) {
  const token = normalizeToken(invite.token);
  const row = {
    token,
    email: String(invite.email || '').trim().toLowerCase(),
    role: String(invite.role || ''),
    branch: String(invite.branch || ''),
    department: String(invite.department || ''),
    status: String(invite.status || 'pending'),
    created_at: invite.createdAt ? String(invite.createdAt) : null,
    expires_at: invite.expiresAt ? String(invite.expiresAt) : null,
    accepted_at: invite.acceptedAt ? String(invite.acceptedAt) : null,
    accepted_username: invite.acceptedUsername ? String(invite.acceptedUsername) : null
  };

  const { error } = await db
    .from('invites')
    .upsert(row, { onConflict: 'token' });

  if (error) throw error;
  return invite;
}

async function findInviteByToken(token) {
  const key = normalizeToken(token);
  if (!key) return null;

  const { data, error } = await db
    .from('invites')
    .select('*')
    .eq('token', key)
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data ? mapRow(data) : null;
}

async function updateInvite(token, updates) {
  const key = normalizeToken(token);
  const patch = {};

  if (Object.prototype.hasOwnProperty.call(updates, 'email')) {
    patch.email = String(updates.email || '').trim().toLowerCase();
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'role')) {
    patch.role = String(updates.role || '');
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'branch')) {
    patch.branch = String(updates.branch || '');
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'department')) {
    patch.department = String(updates.department || '');
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
  if (Object.prototype.hasOwnProperty.call(updates, 'acceptedAt')) {
    patch.accepted_at = updates.acceptedAt ? String(updates.acceptedAt) : null;
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'acceptedUsername')) {
    patch.accepted_username = updates.acceptedUsername ? String(updates.acceptedUsername) : null;
  }

  if (Object.keys(patch).length === 0) return false;

  const { data, error } = await db
    .from('invites')
    .update(patch)
    .eq('token', key)
    .select('token');

  if (error) throw error;
  return data && data.length > 0;
}

module.exports = {
  createInvite,
  findInviteByToken,
  updateInvite
};