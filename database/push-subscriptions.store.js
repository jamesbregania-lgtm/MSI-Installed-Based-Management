const db = require('./db');

// "relation does not exist" (database/db.js maps MySQL 1146 to 42P01):
// the 006 migration hasn't been run yet.
function isMissingTableError(error) {
  const code = String(error && error.code || '');
  return code === '42P01' || code === 'PGRST205';
}

function unavailableError() {
  const err = new Error('push_subscriptions table is missing — run database/migrations/006-push-subscriptions.sql.');
  err.code = 'PUSH_UNAVAILABLE';
  return err;
}

function mapRow(row) {
  return {
    id: row.id,
    username: row.username,
    endpoint: row.endpoint,
    keys: { p256dh: row.p256dh, auth: row.auth }
  };
}

/**
 * Save (or re-point) one phone's subscription to `username`. Keyed by the
 * endpoint, so the same phone never ends up subscribed for two technicians.
 */
async function saveSubscription(username, subscription, userAgent) {
  const { error } = await db
    .from('push_subscriptions')
    .upsert({
      username: String(username || '').trim().toLowerCase(),
      endpoint: subscription.endpoint,
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
      user_agent: String(userAgent || '').slice(0, 300),
      updated_at: new Date().toISOString()
    }, { onConflict: 'endpoint' });
  if (error) {
    if (isMissingTableError(error)) throw unavailableError();
    throw error;
  }
}

/** Remove phones the push service says are gone (404/410). */
async function deleteSubscriptionsByEndpoint(endpoints) {
  if (!endpoints.length) return;
  const { error } = await db
    .from('push_subscriptions')
    .delete()
    .in('endpoint', endpoints);
  if (error && !isMissingTableError(error)) throw error;
}

/** Every phone a technician has turned notifications on for. */
async function listSubscriptionsForUser(username) {
  const key = String(username || '').trim().toLowerCase();
  if (!key) return [];
  const { data, error } = await db
    .from('push_subscriptions')
    .select('*')
    .eq('username', key);
  if (error) {
    if (isMissingTableError(error)) return [];
    throw error;
  }
  return (data || []).map(mapRow);
}

module.exports = {
  saveSubscription,
  deleteSubscriptionsByEndpoint,
  listSubscriptionsForUser
};
