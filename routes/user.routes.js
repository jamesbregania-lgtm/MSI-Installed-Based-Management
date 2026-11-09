const express = require('express');
const { listActiveClients, filterClientsForUser } = require('../database/clients.store');
const { searchMachinesBySerialNo } = require('../database/machines.store');
const { listSchedulesForTechnician } = require('../database/schedules.store');
const { saveSubscription } = require('../database/push-subscriptions.store');
const { requireTechnicianOrAdmin, requireTechnicianSearch, isTechnician } = require('../middleware/auth');
const { getPushPublicKey } = require('../lib/push-notify');

const router = express.Router();

// Technicians search by serial instead of browsing clients. A short query
// would match most of the database and turn the search back into a browse, so
// at least this many characters are required.
const MIN_SERIAL_SEARCH_LENGTH = 4;

// Schedules from yesterday (server date) on. The page decides what "today" is
// from the phone's own clock, so the server only has to not cut today off
// when its time zone is behind the technician's.
function scheduleWindowStart() {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

router.get('/', requireTechnicianOrAdmin, async (req, res) => {
  const technician = isTechnician(req.session.user);
  // Technicians never receive the client list — not even hidden in the page.
  const activeClients = technician
    ? []
    : filterClientsForUser(req.session.user, await listActiveClients())
      .sort((a, b) => a.name.localeCompare(b.name));
  const schedules = technician
    ? await listSchedulesForTechnician(req.session.user.username, scheduleWindowStart()).catch(err => {
      console.error('[schedules] could not load for technician:', err.message || err);
      return [];
    })
    : [];

  res.render('user_account', {
    currentUser: req.session.user,
    clients: activeClients,
    serialSearchMode: technician,
    schedules,
    minSerialSearchLength: MIN_SERIAL_SEARCH_LENGTH,
    // Empty when notifications aren't set up on the server; the page then
    // doesn't offer them.
    pushPublicKey: technician ? getPushPublicKey() : ''
  });
});

// Serial search for the technician home page. Same database search as the
// admin's Serial Number Search, but each result carries only what is needed
// to pick the right unit and open it.
router.get('/serial-search', requireTechnicianSearch, async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const serial = typeof req.query.serial === 'string' ? req.query.serial.trim() : '';
  const page = req.query.page === undefined ? 0 : Number(req.query.page);
  if (serial.length < MIN_SERIAL_SEARCH_LENGTH || serial.length > 100) {
    return res.status(400).json({
      ok: false,
      error: `Enter at least ${MIN_SERIAL_SEARCH_LENGTH} characters of the serial number.`
    });
  }
  if (!Number.isSafeInteger(page) || page < 0 || page > 1000000) {
    return res.status(400).json({ ok: false, error: 'Invalid page.' });
  }
  try {
    const result = await searchMachinesBySerialNo(serial, page);
    const machines = result.machines.map(machine => ({
      id: machine.id,
      clientId: machine.clientId || '',
      clientName: machine.clientName || '',
      location: machine.location || '',
      serialNo: machine.serialNo || '',
      unit: machine.unit || '',
      model: machine.model || '',
      status: machine.status || '',
      disabled: Boolean(machine.disabledAt)
    }));
    return res.json({ ok: true, machines, hasMore: result.hasMore, page });
  } catch (error) {
    console.error('[technician serial-search]', error.message);
    return res.status(500).json({ ok: false, error: 'Could not search serial numbers. Please try again.' });
  }
});

/**
 * Schedule notifications. The phone's browser hands over a push subscription
 * when the technician taps "Turn on notifications"; only technicians get
 * schedules, so only they can subscribe.
 */
function requireTechnicianJson(req, res, next) {
  if (!isTechnician(req.session.user)) {
    return res.status(403).json({ ok: false, error: 'Only technicians receive schedule notifications.' });
  }
  return next();
}

function readSubscription(body) {
  const sub = body && body.subscription;
  const endpoint = sub && typeof sub.endpoint === 'string' ? sub.endpoint : '';
  const keys = sub && sub.keys;
  // Push services are always https; anything else is not a real subscription.
  if (!endpoint.startsWith('https://') || endpoint.length > 1000) return null;
  if (!keys || typeof keys.p256dh !== 'string' || typeof keys.auth !== 'string') return null;
  if (keys.p256dh.length > 200 || keys.auth.length > 100) return null;
  return { endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } };
}

router.post('/push/subscribe', requireTechnicianOrAdmin, requireTechnicianJson, async (req, res) => {
  if (!getPushPublicKey()) {
    return res.status(503).json({ ok: false, error: 'Notifications are not set up on the server yet.' });
  }
  const subscription = readSubscription(req.body);
  if (!subscription) return res.status(400).json({ ok: false, error: 'Invalid notification subscription.' });
  try {
    await saveSubscription(req.session.user.username, subscription, req.headers['user-agent']);
  } catch (err) {
    if (err && err.code === 'PUSH_UNAVAILABLE') {
      console.error('[push]', err.message);
      return res.status(503).json({ ok: false, error: 'Notifications need a one-time database setup (migration 006) that has not been run yet.' });
    }
    throw err;
  }
  return res.json({ ok: true });
});

module.exports = router;
