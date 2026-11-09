const db = require('./db');

function mapRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    location: row.location || '',
    status: row.status,
    salesUsername: String(row.sales_username || '').trim().toLowerCase()
  };
}

/**
 * Sales users only see the clients assigned to them. Every other role gets the
 * list untouched. A sales user with nothing assigned sees nothing.
 */
function filterClientsForUser(user, clients) {
  const list = Array.isArray(clients) ? clients : [];
  if (!user || user.role !== 'sales') return list;
  const me = String(user.username || '').trim().toLowerCase();
  if (!me) return [];
  return list.filter(client => client.salesUsername === me);
}

/**
 * Whether `user` may see the client with this id. Only sales users are ever
 * refused — for any client not assigned to them, including one that doesn't exist.
 */
async function canUserSeeClient(user, clientId) {
  if (!user || user.role !== 'sales') return true;
  const client = await findClientById(clientId);
  return Boolean(client && filterClientsForUser(user, [client]).length);
}

/**
 * Assigns a client to a sales account, or clears it when salesUsername is empty.
 * A client only ever holds one sales account (it is a single column). Without
 * `replace`, assigning is conditional on the client having no sales account, so
 * an admin can't silently take a client from another sales user; with
 * `replace`, the existing assignment is changed to the new one.
 * Returns { result: 'ok' | 'not_found' | 'taken', owner? }.
 */
async function assignClientSales(clientId, salesUsername, { replace = false } = {}) {
  const key = String(clientId || '').trim().toLowerCase();
  const sales = String(salesUsername || '').trim().toLowerCase();

  if (!sales || replace) {
    const { data, error } = await db
      .from('clients')
      .update({ sales_username: sales || null })
      .eq('id', key)
      .select('id');
    if (error) throw error;
    return { result: data && data.length ? 'ok' : 'not_found' };
  }

  const { data, error } = await db
    .from('clients')
    .update({ sales_username: sales })
    .eq('id', key)
    .is('sales_username', null)
    .select('id');
  if (error) throw error;
  if (data && data.length) return { result: 'ok' };

  const existing = await findClientById(key);
  if (!existing) return { result: 'not_found' };
  if (existing.salesUsername === sales) return { result: 'ok' };
  return { result: 'taken', owner: existing.salesUsername };
}

/**
 * False until database/migrations/003-client-sales-assignment.sql has been run.
 * Until then no client can be assigned, so every Sales user sees no clients.
 */
async function isSalesAssignmentAvailable() {
  const { error } = await db.from('clients').select('sales_username').limit(1);
  return !error;
}

async function listClients() {
  const { data, error } = await db
    .from('clients')
    .select('*')
    .order('name');
  if (error) throw error;
  return (data || []).map(mapRow);
}

async function listActiveClients() {
  const { data, error } = await db
    .from('clients')
    .select('*')
    .neq('status', 'inactive')
    .order('name');
  if (error) throw error;
  return (data || []).map(mapRow);
}

async function findClientById(clientId) {
  const key = String(clientId || '').trim().toLowerCase();
  const { data, error } = await db
    .from('clients')
    .select('*')
    .eq('id', key)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data ? mapRow(data) : null;
}

async function findActiveClientByName(name) {
  const key = String(name || '').trim().toLowerCase();
  const { data, error } = await db
    .from('clients')
    .select('*')
    .neq('status', 'inactive');
  if (error) throw error;
  // Case-insensitive name match (ilike could work, but exact match is safer)
  const found = (data || []).find(
    row => String(row.name || '').trim().toLowerCase() === key
  );
  return found ? mapRow(found) : null;
}

async function createClient(client) {
  const id = String(client.id || '').trim().toLowerCase();
  const { error } = await db
    .from('clients')
    .insert({
      id,
      name: String(client.name || '').trim(),
      location: String(client.location || '').trim(),
      status: String(client.status || 'active')
    });

  if (error) {
    if (error.code === '23505') return false;
    throw error;
  }
  return true;
}

async function updateClient(clientId, updates) {
  const key = String(clientId || '').trim().toLowerCase();
  const patch = {};

  if (Object.prototype.hasOwnProperty.call(updates, 'name')) {
    patch.name = String(updates.name || '').trim();
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'location')) {
    patch.location = String(updates.location || '').trim();
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'status')) {
    patch.status = String(updates.status || 'active');
  }

  if (Object.keys(patch).length === 0) return false;

  const { data, error } = await db
    .from('clients')
    .update(patch)
    .eq('id', key)
    .select('id');

  if (error) throw error;
  const updated = Boolean(data && data.length > 0);

  // Each machine keeps a copy of its client's name, and screens such as the
  // duplicate-serial warning and the Activity Log read that copy. Carry a
  // rename onto it so those screens don't keep showing the old name. The
  // rename itself has already landed, so a failure here is logged, not thrown.
  if (updated && patch.name) {
    const { error: machineError } = await db
      .from('machines')
      .update({ client_name: patch.name })
      .eq('client_id', key);
    if (machineError) {
      console.error('[clients] renamed but could not update machine client names:', machineError.message || machineError);
    }
  }

  return updated;
}

async function setClientStatus(clientId, status) {
  return updateClient(clientId, { status });
}

module.exports = {
  listClients,
  listActiveClients,
  findClientById,
  findActiveClientByName,
  createClient,
  updateClient,
  setClientStatus,
  filterClientsForUser,
  canUserSeeClient,
  assignClientSales,
  isSalesAssignmentAvailable
};