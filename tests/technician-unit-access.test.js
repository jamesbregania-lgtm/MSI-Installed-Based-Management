const assert = require('node:assert/strict');
const { test, before, after } = require('node:test');
const path = require('node:path');
const express = require('express');

// Isolate all database access; these tests never use production credentials.
// Each table answers with its own rows; `.maybeSingle()` returns the first row
// matching the last `.eq()`.
const tables = {};
const calls = [];
const database = {
  from(table) {
    let eqFilter = null;
    let single = false;
    const query = new Proxy({}, {
      get(target, method) {
        if (method === 'then') {
          const rows = tables[table] || [];
          const filtered = eqFilter ? rows.filter(row => String(row[eqFilter[0]]) === String(eqFilter[1])) : rows;
          const result = single ? { data: filtered[0] || null, error: null } : { data: filtered, error: null };
          return (resolve, reject) => Promise.resolve(result).then(resolve, reject);
        }
        return (...args) => {
          calls.push([table, method, ...args]);
          if (method === 'eq') eqFilter = args;
          if (method === 'maybeSingle') single = true;
          return query;
        };
      }
    });
    return query;
  }
};
const dbPath = require.resolve('../database/db');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: database };

const machineRow = (id, clientId, serial) => ({
  id, client_id: clientId, client_name: clientId.toUpperCase(), location: 'Calamba',
  serial_no: serial, unit: 'CIJ', model: '9750', status: 'Active', date_installed: '01/01/2025',
  initial_running_hours: 0, running_hours: 10, updates: [], reports: []
});

tables.clients = [
  { id: 'acme', name: 'ACME', location: 'Calamba', status: 'active' },
  { id: 'globex', name: 'GLOBEX', location: 'Cabuyao', status: 'active' }
];
tables.machines = [machineRow(1, 'acme', 'SN-ACME-1'), machineRow(2, 'acme', 'SN-ACME-2'), machineRow(3, 'globex', 'SN-GLOBEX-1')];
tables.accounts = [];
tables.parts_catalog = [];

let server;
let origin;
before(async () => {
  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '../views'));
  app.use(express.json());
  app.use((req, res, next) => {
    const role = req.headers['x-test-role'];
    req.session = role ? { user: { role, username: 'test', fullName: 'Test Tech' } } : {};
    res.locals.currentUser = req.session.user || null;
    res.locals.formatRoleLabel = r => r;
    next();
  });
  app.use('/user_account', require('../routes/user.routes'));
  app.use('/client', require('../routes/client.routes'));
  server = await new Promise(resolve => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
  origin = `http://127.0.0.1:${server.address().port}`;
});
after(() => new Promise(resolve => server.close(resolve)));

function request(url, role, accept = 'application/json') {
  return fetch(origin + url, { headers: { Accept: accept, ...(role ? { 'x-test-role': role } : {}) }, redirect: 'manual' });
}

test('technician home shows the serial search and no client list', async () => {
  const response = await request('/user_account', 'user', 'text/html');
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /id="unitSearchForm"/);
  assert.doesNotMatch(html, /GLOBEX|const CLIENTS/);
});

test('admin home still lists clients', async () => {
  const html = await (await request('/user_account', 'admin', 'text/html')).text();
  assert.match(html, /GLOBEX/);
  assert.doesNotMatch(html, /id="unitSearchForm"/);
});

test('technician serial search covers every client and returns only summary fields', async () => {
  const response = await request('/user_account/serial-search?serial=SN-G', 'user');
  assert.equal(response.status, 200);
  const { machines } = await response.json();
  assert.ok(machines.length > 0);
  assert.deepEqual(Object.keys(machines[0]).sort(), ['clientId', 'clientName', 'disabled', 'id', 'location', 'model', 'serialNo', 'status', 'unit']);
  assert.ok(calls.some(call => call[0] === 'machines' && call[1] === 'ilike' && call[3] === '%SN-G%'));
});

test('serial search rejects short queries and Sales users', async () => {
  assert.equal((await request('/user_account/serial-search?serial=SN', 'user')).status, 400);
  assert.equal((await request('/user_account/serial-search?serial=SN-ACME', 'sales')).status, 403);
  assert.equal((await request('/user_account/serial-search?serial=SN-ACME')).status, 302);
});

test('technicians cannot list a client\'s units without naming the searched unit', async () => {
  assert.equal((await request('/client/acme/machines', 'user')).status, 403);
  // A unit from a different client does not unlock this one.
  assert.equal((await request('/client/acme/machines?unit=3', 'user')).status, 403);
  const response = await request('/client/acme/machines?unit=2', 'user');
  assert.equal(response.status, 200);
  const { machineRecords } = await response.json();
  assert.deepEqual(machineRecords.map(machine => machine.serialNo), ['SN-ACME-2']);
});

test('technician client page shows only the opened unit', async () => {
  const blocked = await request('/client/acme', 'user', 'text/html');
  assert.equal(blocked.status, 302);
  assert.equal(blocked.headers.get('location'), '/user_account');
  assert.equal((await request('/client/acme?unit=3', 'user', 'text/html')).headers.get('location'), '/user_account');

  const response = await request('/client/acme?unit=1', 'user', 'text/html');
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /SN-ACME-1/);
  assert.doesNotMatch(html, /SN-ACME-2|GLOBEX/);
  assert.match(html, /const UNIT_ID = 1;/);
});

test('admins keep the full client view', async () => {
  const { machineRecords } = await (await request('/client/acme/machines', 'admin')).json();
  assert.equal(machineRecords.length, 2);
  const html = await (await request('/client/acme', 'admin', 'text/html')).text();
  assert.match(html, /SN-ACME-1/);
  assert.match(html, /SN-ACME-2/);
  assert.match(html, /const UNIT_ID = null;/);
});
