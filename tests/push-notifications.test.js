const assert = require('node:assert/strict');
const { test, before, after, beforeEach } = require('node:test');
const express = require('express');

// Isolate all database access; these tests never use production credentials.
// Rows per table; `.eq()`/`.in()` filter, `.maybeSingle()`/`.single()` return
// the first match, and writes change the rows the way Postgres would.
const tables = {};
let nextId = 100;
const database = {
  from(table) {
    const filters = [];
    let single = false;
    let action = 'select';
    let payload = null;
    const matches = row => filters.every(([field, values]) => values.includes(String(row[field])));
    const run = () => {
      const rows = tables[table] || (tables[table] = []);
      if (action === 'insert') {
        const row = { id: nextId++, status: 'scheduled', updated_at: 'v1', ...payload };
        rows.push(row);
        return single ? row : [row];
      }
      if (action === 'upsert') {
        const existing = rows.find(row => row.endpoint === payload.endpoint);
        if (existing) Object.assign(existing, payload);
        else rows.push({ id: nextId++, ...payload });
        return null;
      }
      if (action === 'update') {
        const hit = rows.filter(matches);
        hit.forEach(row => Object.assign(row, payload));
        return single ? hit[0] || null : hit;
      }
      if (action === 'delete') {
        const hit = rows.filter(matches);
        tables[table] = rows.filter(row => !matches(row));
        return hit;
      }
      const hit = rows.filter(matches);
      return single ? hit[0] || null : hit;
    };
    const query = new Proxy({}, {
      get(target, method) {
        if (method === 'then') {
          return (resolve, reject) => Promise.resolve({ data: run(), error: null }).then(resolve, reject);
        }
        return (...args) => {
          if (method === 'eq') filters.push([args[0], [String(args[1])]]);
          if (method === 'in') filters.push([args[0], args[1].map(String)]);
          if (method === 'maybeSingle' || method === 'single') single = true;
          if (['insert', 'update', 'upsert', 'delete'].includes(method)) {
            action = method;
            payload = Array.isArray(args[0]) ? args[0][0] : args[0];
          }
          return query;
        };
      }
    });
    return query;
  }
};
const dbPath = require.resolve('../database/db');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: database };

// Stand-in for the web-push library: records each push; an endpoint listed in
// `goneEndpoints` answers 410 like a phone that unsubscribed.
const pushes = [];
const goneEndpoints = new Set();
const webpushPath = require.resolve('web-push');
require.cache[webpushPath] = {
  id: webpushPath, filename: webpushPath, loaded: true,
  exports: {
    setVapidDetails() {},
    async sendNotification(subscription, payload) {
      if (goneEndpoints.has(subscription.endpoint)) throw Object.assign(new Error('gone'), { statusCode: 410 });
      pushes.push({ endpoint: subscription.endpoint, ...JSON.parse(payload) });
    }
  }
};
process.env.VAPID_PUBLIC_KEY = 'test-public-key';
process.env.VAPID_PRIVATE_KEY = 'test-private-key';

const { scheduleNotification } = require('../lib/push-notify');

const manilaDate = (offsetDays = 0) => {
  const date = new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
};

const scheduleRow = (id, fields = {}) => ({
  id, technician_username: 'tech1', technician_name: 'Tech One', client_id: 'acme', client_name: 'ACME',
  location: 'Calamba', schedule_date: manilaDate(2), schedule_time: '09:00:00', description: 'Fix printer',
  status: 'scheduled', updated_at: 'v1', ...fields
});

beforeEach(() => {
  pushes.length = 0;
  goneEndpoints.clear();
  tables.accounts = [
    { username: 'tech1', role: 'user', status: 'active', full_name: 'Tech One' },
    { username: 'tech2', role: 'user', status: 'active', full_name: 'Tech Two' }
  ];
  tables.clients = [{ id: 'acme', name: 'ACME', location: 'Calamba', status: 'active' }];
  tables.schedules = [scheduleRow(7)];
  tables.push_subscriptions = [
    { id: 1, username: 'tech1', endpoint: 'https://push.example/tech1', p256dh: 'k', auth: 'a' },
    { id: 2, username: 'tech2', endpoint: 'https://push.example/tech2', p256dh: 'k', auth: 'a' }
  ];
});

let server;
let origin;
let session;
before(async () => {
  const app = express();
  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());
  app.use((req, res, next) => {
    req.session = session;
    next();
  });
  app.use('/admin_account', require('../routes/admin.routes'));
  app.use('/user_account', require('../routes/user.routes'));
  server = await new Promise(resolve => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
  origin = `http://127.0.0.1:${server.address().port}`;
});
after(() => new Promise(resolve => server.close(resolve)));

async function adminPost(path, fields) {
  session = { user: { role: 'admin', username: 'boss', fullName: 'Boss' } };
  const response = await fetch(`${origin}/admin_account${path}`, {
    method: 'POST', body: new URLSearchParams(fields), redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
  });
  assert.equal(response.status, 302);
  return { error: session.flashError || null, success: session.flashSuccess || null };
}

const saveFields = fields => ({
  technicianUsername: 'tech1', clientId: 'acme', location: 'Calamba', date: manilaDate(2),
  time: '09:00', description: 'Fix printer', ...fields
});

test('a new schedule notifies only that technician\'s phone', async () => {
  const { error, success } = await adminPost('/schedules/save', saveFields({ date: manilaDate(4) }));
  assert.equal(error, null);
  assert.equal(pushes.length, 1);
  assert.equal(pushes[0].endpoint, 'https://push.example/tech1');
  assert.equal(pushes[0].title, 'New schedule');
  assert.match(pushes[0].body, /ACME · Calamba/);
  assert.equal(pushes[0].url, '/user_account#schedule');
  assert.match(success, /Notification sent to their phone/);
});

test('the admin is told when the technician has notifications off', async () => {
  tables.push_subscriptions = [];
  const { success } = await adminPost('/schedules/save', saveFields({ date: manilaDate(4) }));
  assert.equal(pushes.length, 0);
  assert.match(success, /have not turned on notifications/);
});

test('editing what the technician sees sends "Schedule changed"; saving unchanged sends nothing', async () => {
  await adminPost('/schedules/save', saveFields({ scheduleId: '7' }));
  assert.equal(pushes.length, 0);

  await adminPost('/schedules/save', saveFields({ scheduleId: '7', time: '13:30' }));
  assert.equal(pushes.length, 1);
  assert.equal(pushes[0].title, 'Schedule changed');
  assert.match(pushes[0].body, /1:30 PM/);
  assert.equal(pushes[0].tag, 'schedule-7');
});

test('reassigning a schedule tells the old technician it is removed and the new one it is theirs', async () => {
  await adminPost('/schedules/save', saveFields({ scheduleId: '7', technicianUsername: 'tech2' }));
  assert.deepEqual(
    pushes.map(p => [p.endpoint, p.title]),
    [['https://push.example/tech1', 'Schedule removed'], ['https://push.example/tech2', 'New schedule']]
  );
});

test('cancelling and reopening notify; marking done does not', async () => {
  await adminPost('/schedules/status', { scheduleId: '7', status: 'cancelled' });
  await adminPost('/schedules/status', { scheduleId: '7', status: 'scheduled' });
  await adminPost('/schedules/status', { scheduleId: '7', status: 'done' });
  assert.deepEqual(pushes.map(p => p.title), ['Schedule cancelled', 'Schedule back on']);
});

test('deleting a live schedule notifies; past schedules stay quiet', async () => {
  await adminPost('/schedules/delete', { scheduleId: '7' });
  assert.deepEqual(pushes.map(p => p.title), ['Schedule removed']);

  pushes.length = 0;
  tables.schedules = [scheduleRow(8, { schedule_date: manilaDate(-3) })];
  await adminPost('/schedules/delete', { scheduleId: '8' });
  assert.equal(pushes.length, 0);
});

test('a phone that unsubscribed is forgotten after its first failed push', async () => {
  goneEndpoints.add('https://push.example/tech1');
  const { success } = await adminPost('/schedules/save', saveFields({ date: manilaDate(4) }));
  assert.match(success, /have not turned on notifications/);
  assert.deepEqual(tables.push_subscriptions.map(s => s.username), ['tech2']);
});

async function techPost(path, body, role = 'user') {
  session = { user: { role, username: 'tech1', fullName: 'Tech One' } };
  return fetch(`${origin}/user_account${path}`, {
    method: 'POST', body: JSON.stringify(body), redirect: 'manual',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' }
  });
}

test('a technician can subscribe their phone', async () => {
  tables.push_subscriptions = [];
  const subscription = { endpoint: 'https://push.example/new-phone', keys: { p256dh: 'p', auth: 'a' } };
  assert.equal((await techPost('/push/subscribe', { subscription })).status, 200);
  assert.deepEqual(tables.push_subscriptions.map(s => [s.username, s.endpoint]), [['tech1', 'https://push.example/new-phone']]);
});

test('there is no way to test or turn off notifications from the site', async () => {
  // Express answers an unknown POST with 404.
  assert.equal((await techPost('/push/test', {})).status, 404);
  assert.equal((await techPost('/push/unsubscribe', { endpoint: 'https://push.example/tech1' })).status, 404);
  assert.equal(pushes.length, 0);
  assert.equal(tables.push_subscriptions.length, 2);
});

test('the same phone moves to whoever subscribes it last', async () => {
  const subscription = { endpoint: 'https://push.example/tech2', keys: { p256dh: 'p', auth: 'a' } };
  assert.equal((await techPost('/push/subscribe', { subscription })).status, 200);
  assert.deepEqual(tables.push_subscriptions.map(s => s.username), ['tech1', 'tech1']);
});

test('only technicians can subscribe, and only real push endpoints are accepted', async () => {
  const subscription = { endpoint: 'https://push.example/x', keys: { p256dh: 'p', auth: 'a' } };
  assert.equal((await techPost('/push/subscribe', { subscription }, 'admin')).status, 403);
  assert.equal((await techPost('/push/subscribe', { subscription }, 'sales')).status, 403);
  assert.equal((await techPost('/push/subscribe', { subscription: { ...subscription, endpoint: 'http://evil.example' } })).status, 400);
  assert.equal((await techPost('/push/subscribe', { subscription: { endpoint: subscription.endpoint } })).status, 400);
});

test('notification text reads naturally', () => {
  const note = scheduleNotification('created', {
    id: 3, clientName: 'ACME', location: 'Calamba', date: '2026-11-05', time: '09:00'
  });
  assert.equal(note.title, 'New schedule');
  assert.equal(note.body, 'ACME · Calamba\nThu, Nov 5, 9:00 AM');
  assert.equal(scheduleNotification('changed', { id: 3, clientName: 'ACME', date: '2026-11-05', time: '' }).body, 'ACME\nThu, Nov 5');
});

test('the technician page carries the phone setup reminder and links the app manifest', async () => {
  const path = require('node:path');
  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '../views'));
  app.use((req, res, next) => {
    req.session = { user: { role: req.headers['x-test-role'], username: 'tech1', fullName: 'Tech One' } };
    res.locals.currentUser = req.session.user;
    res.locals.formatRoleLabel = r => r;
    next();
  });
  app.use('/user_account', require('../routes/user.routes'));
  const page = await new Promise(resolve => { const l = app.listen(0, '127.0.0.1', () => resolve(l)); });
  try {
    const get = role => fetch(`http://127.0.0.1:${page.address().port}/user_account`, { headers: { 'x-test-role': role } }).then(r => r.text());
    const tech = await get('user');
    assert.match(tech, /<link rel="manifest" href="\/manifest.webmanifest">/);
    assert.match(tech, /id="setupModal" data-push-key="test-public-key"/);
    assert.match(tech, /tech_setup\.js/);
    assert.match(tech, /id="setupNotifyBtn"[^>]*>Turn on notifications</);
    assert.match(tech, /id="setupInstallBtn"[^>]*>Install app</);
    // A reminder inside My Schedule, never a popup over the page.
    assert.doesNotMatch(tech, /role="dialog"|aria-modal|class="setup-modal"/);
    assert.ok(tech.indexOf('id="setupModal"') > tech.indexOf('id="view-schedule"'), 'the reminder sits inside the schedule section');
    // No way to test it or turn notifications off.
    assert.doesNotMatch(tech, /Send test|Turn off/);
    // Admins and Sales get no schedules, so no setup reminder.
    assert.doesNotMatch(await get('admin'), /id="setupModal"|tech_setup\.js/);
  } finally {
    await new Promise(resolve => page.close(resolve));
  }
});
