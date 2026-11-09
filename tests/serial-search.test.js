const assert = require('node:assert/strict');
const { test, before, after } = require('node:test');
const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');
const express = require('express');

// Isolate all database access; these tests never use production credentials.
const calls = [];
let databaseResult = { data: [], error: null };
const queuedResults = [];
const database = {
  from(table) {
    calls.push(['from', table]);
    const query = {};
    for (const method of ['select', 'ilike', 'order', 'range', 'eq', 'maybeSingle']) {
      query[method] = (...args) => { calls.push([method, ...args]); return query; };
    }
    query.then = (resolve, reject) => Promise.resolve(queuedResults.shift() || databaseResult).then(resolve, reject);
    return query;
  }
};
const dbPath = require.resolve('../database/db');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: database };
const machines = require('../database/machines.store');

const machineRow = {
  id: 1234, client_id: 'inactive-client', client_name: 'Inactive Client',
  serial_no: 'SN-1234', unit: 'CIJ', model: '9750', status: 'Active',
  disabled_at: '2026-10-20T00:00:00Z', date_installed: '01/01/2025',
  initial_running_hours: 0,
  updates: [{ date: '02/01/2025', activityType: 'Repair', runningHours: 12 }],
  reports: [{ updateIndex: null, refNo: 'INSTALL' }, { updateIndex: 0, refNo: 'REPAIR', problem: 'Full notes' }]
};

test('search filters on the database, escapes wildcard characters, and pages beyond row 1000', async () => {
  calls.length = 0;
  databaseResult = { data: Array.from({ length: 26 }, (_, i) => ({ ...machineRow, id: i + 1001 })), error: null };
  const result = await machines.searchMachinesBySerialNo('  SN%_\\  ', 40);
  assert.equal(result.machines.length, 25);
  assert.equal(result.hasMore, true);
  assert.equal(result.machines[0].disabledAt, machineRow.disabled_at);
  assert.deepEqual(calls.find(call => call[0] === 'ilike'), ['ilike', 'serial_no', '%SN\\%\\_\\\\%']);
  assert.deepEqual(calls.find(call => call[0] === 'range'), ['range', 1000, 1025]);
  assert.equal(calls.some(call => call[0] === 'eq'), false, 'does not scope to active or assigned clients');
});

test('empty searches avoid a database query and database failures propagate', async () => {
  calls.length = 0;
  assert.deepEqual(await machines.searchMachinesBySerialNo(' '), { machines: [], hasMore: false });
  assert.equal(calls.length, 0);
  databaseResult = { data: null, error: new Error('offline') };
  await assert.rejects(machines.searchMachinesBySerialNo('SN'), /offline/);
});

test('search also works before the optional Disable Unit migration', async () => {
  queuedResults.push({ data: null, error: { code: '42703', message: 'column machines.disabled_at does not exist' } });
  databaseResult = { data: [{ ...machineRow, disabled_at: undefined }], error: null };
  const result = await machines.searchMachinesBySerialNo('SN');
  assert.equal(result.machines[0].serialNo, 'SN-1234');
  assert.equal(result.hasMore, false);
});

let server;
let origin;
before(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.session = req.headers['x-test-role'] ? { user: { role: req.headers['x-test-role'], username: 'test' } } : {};
    next();
  });
  app.use('/admin_account', require('../routes/admin.routes'));
  server = await new Promise(resolve => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
  origin = `http://127.0.0.1:${server.address().port}`;
});
after(() => new Promise(resolve => server.close(resolve)));

async function request(url, role) {
  return fetch(origin + url, { headers: { Accept: 'application/json', ...(role ? { 'x-test-role': role } : {}) }, redirect: 'manual' });
}

test('Admin and Sales can search and retrieve complete history, including disabled machines', async () => {
  for (const role of ['admin', 'sales']) {
    databaseResult = { data: [machineRow], error: null };
    const response = await request('/admin_account/serial-search?serial=sn', role);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal((await response.json()).machines[0].clientName, 'Inactive Client');
    databaseResult = { data: machineRow, error: null };
    const detail = await request('/admin_account/serial-search/1234', role);
    assert.equal(detail.status, 200);
    const payload = await detail.json();
    assert.equal(payload.machine.updates.length, 1);
    assert.equal(payload.machine.reports[1].problem, 'Full notes');
  }
});

test('Technicians and anonymous users cannot access either search endpoint', async () => {
  for (const endpoint of ['/admin_account/serial-search?serial=SN', '/admin_account/serial-search/1234']) {
    assert.equal((await request(endpoint, 'user')).status, 403);
    const anonymous = await request(endpoint);
    assert.equal(anonymous.status, 302);
    assert.equal(anonymous.headers.get('location'), '/login');
  }
});

test('invalid searches and IDs fail clearly; missing machines return 404', async () => {
  for (const endpoint of ['/serial-search', '/serial-search?serial=SN&page=-1', '/serial-search?serial=SN&page=1.5', '/serial-search?serial[]=SN', '/serial-search/no-id', '/serial-search/0']) {
    assert.equal((await request('/admin_account' + endpoint, 'admin')).status, 400);
  }
  databaseResult = { data: null, error: null };
  assert.equal((await request('/admin_account/serial-search/1234', 'sales')).status, 404);
  databaseResult = { data: [], error: null };
  assert.deepEqual((await (await request('/admin_account/serial-search?serial=missing', 'sales')).json()).machines, []);
});

test('shared viewer preserves all entries and matches reports to the right history entry', () => {
  const element = () => ({ addEventListener() {}, style: {}, classList: { add() {}, remove() {} } });
  const context = vm.createContext({ document: { getElementById: element }, window: {} });
  for (const script of ['client/client-state.js', 'client/client-helpers.js', 'shared/machine-history.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/js', script), 'utf8'), context);
  }
  context.record = { dateInstalled: '01/01/2025', initialRunningHours: 0, runningHours: 12, updates: machineRow.updates, reports: machineRow.reports };
  assert.equal(vm.runInContext('buildHistoryRows(record).length', context), 2);
  assert.equal(vm.runInContext('findReportForHistoryRow(record, buildHistoryRows(record)[0]).refNo', context), 'REPAIR');
  assert.equal(vm.runInContext('buildHistoryRows(record)[1].detail.runningHours', context), 0);
  context.record.reports = [machineRow.reports[0]];
  assert.equal(vm.runInContext('findReportForHistoryRow(record, buildHistoryRows(record)[0])', context), null);
  context.record.updates = [{ activityType: 'Cannibalize' }, { activityType: 'Parts Return' }, { activityType: 'Pull Out' }];
  assert.equal(vm.runInContext('buildHistoryRows(record).slice(0, 3).every(row => isAdHocHistoryRow(record, row, row.detail.activityType))', context), true);
});
