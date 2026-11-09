const db = require('./db');

function normalizeAccountRole(role, department) {
  const normalizedRole = String(role || 'user').trim().toLowerCase();
  const normalizedDept = String(department || '').trim().toLowerCase();
  if (normalizedRole === 'user' && normalizedDept === 'sales') return 'sales';
  return normalizedRole;
}

function mapRow(row) {
  if (!row) return null;
  const normalizedRole = normalizeAccountRole(row.role, row.department);
  return {
    username: row.username,
    passwordHash: row.password_hash,
    role: normalizedRole,
    fullName: row.full_name,
    email: row.email || '',
    department: row.department || '',
    branch: row.branch || '',
    status: row.status
  };
}

async function findActiveAccountByUsername(username) {
  const key = String(username || '').trim().toLowerCase();
  const { data, error } = await db
    .from('accounts')
    .select('*')
    .eq('username', key)
    .neq('status', 'inactive')
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data ? mapRow(data) : null;
}

async function findAccountByUsername(username) {
  const key = String(username || '').trim().toLowerCase();
  const { data, error } = await db
    .from('accounts')
    .select('*')
    .eq('username', key)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data ? mapRow(data) : null;
}

async function findAccountByEmail(email) {
  const key = String(email || '').trim().toLowerCase();
  if (!key) return null;
  const { data, error } = await db
    .from('accounts')
    .select('*')
    .eq('email', key)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data ? mapRow(data) : null;
}

async function listUserAccounts() {
  const { data, error } = await db
    .from('accounts')
    .select('*')
    .eq('role', 'user')
    .order('full_name');
  if (error) throw error;
  return (data || []).map(mapRow);
}

async function listStaffAccounts() {
  const { data, error } = await db
    .from('accounts')
    .select('*')
    .in('role', ['user', 'sales'])
    .order('full_name');
  if (error) throw error;
  return (data || []).map(mapRow);
}

// Admin names that belong to no technician account. Reports store only a
// name, so an admin who also has a technician login under the same name has
// to stay visible: dropping the name would drop their technician work too.
async function listAdminAccountNames() {
  const { data, error } = await db
    .from('accounts')
    .select('full_name, role, department');
  if (error) throw error;
  const key = name => String(name || '').trim().replace(/\s+/g, ' ').toLowerCase();
  const rows = data || [];
  const technicianNames = new Set(
    rows
      .filter(row => normalizeAccountRole(row.role, row.department) === 'user')
      .map(row => key(row.full_name))
  );
  return rows
    .filter(row => row.role === 'admin' && row.full_name && !technicianNames.has(key(row.full_name)))
    .map(row => row.full_name);
}

async function usernameExists(username) {
  const key = String(username || '').trim().toLowerCase();
  const { data, error } = await db
    .from('accounts')
    .select('username')
    .eq('username', key)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

async function createUserAccount(account) {
  const username = String(account.username || '').trim().toLowerCase();
  const { error } = await db
    .from('accounts')
    .insert({
      username,
      password_hash: String(account.passwordHash || ''),
      role: String(account.role || 'user'),
      full_name: String(account.fullName || ''),
      email: String(account.email || '').trim().toLowerCase(),
      department: String(account.department || ''),
      branch: String(account.branch || ''),
      status: String(account.status || 'active')
    });

  if (error) {
    // Unique constraint violation means username already exists
    if (error.code === '23505') return false;
    throw error;
  }
  return true;
}

async function updateUserAccount(username, updates) {
  const key = String(username || '').trim().toLowerCase();
  const patch = {};

  if (Object.prototype.hasOwnProperty.call(updates, 'fullName')) {
    patch.full_name = String(updates.fullName || '');
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'department')) {
    patch.department = String(updates.department || '');
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'branch')) {
    patch.branch = String(updates.branch || '');
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'status')) {
    patch.status = String(updates.status || 'active');
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'passwordHash')) {
    patch.password_hash = String(updates.passwordHash || '');
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'email')) {
    patch.email = String(updates.email || '').trim().toLowerCase();
  }

  if (Object.keys(patch).length === 0) return false;

  const { data, error } = await db
    .from('accounts')
    .update(patch)
    .eq('username', key)
    .in('role', ['user', 'sales'])
    .select('username');

  if (error) throw error;
  return data && data.length > 0;
}

async function resetUserPassword(username, passwordHash) {
  return updateUserAccount(username, { passwordHash });
}

async function setUserStatus(username, status) {
  return updateUserAccount(username, { status });
}

module.exports = {
  findAccountByUsername,
  findAccountByEmail,
  findActiveAccountByUsername,
  listUserAccounts,
  listStaffAccounts,
  listAdminAccountNames,
  usernameExists,
  createUserAccount,
  updateUserAccount,
  resetUserPassword,
  setUserStatus
};