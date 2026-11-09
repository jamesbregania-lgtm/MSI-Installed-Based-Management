const assert = require('node:assert/strict');
const { test, before, after } = require('node:test');
const express = require('express');

// Isolate all database access; these tests never use production credentials.
// Rows per table; `.eq()` filters, `.maybeSingle()` returns the first match,
// and insert/update echo the written row back.
const tables = {};
const writes = [];
const database = {
  from(table) {
    let eqFilter = null;
    let single = false;
    let written = null;
    const query = new Proxy({}, {
      get(target, method) {
        if (method === 'then') {
          let result;
          if (written) {
            result = { data: { id: 99, ...(eqFilter ? tables[table].find(r => String(r[eqFilter[0]]) === String(eqFilter[1])) : {}), ...written }, error: null };
          } else {
            const rows = (tables[table] || []).filter(row => !eqFilter || String(row[eqFilter[0]]) === String(eqFilter[1]));
            result = { data: single ? rows[0] || null : rows, error: null };
          }
          return (resolve, reject) => Promise.resolve(result).then(resolve, reject);
        }
        return (...args) => {
          if (method === 'eq') eqFilter = args;
          if (method === 'maybeSingle' || method === 'single') single = true;
          if (method === 'insert' || method === 'update') {
            written = Array.isArray(args[0]) ? args[0][0] : args[0];
            writes.push([table, method, written]);
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

// Manila's date, as the route computes it.
const manilaDate = (offsetDays = 0) => {
  const date = new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
};

tables.accounts = [{ username: 'tech1', role: 'user', status: 'active', full_name: 'Tech One' }];
tables.clients = [{ id: 'acme', name: 'ACME', location: 'Calamba', status: 'active' }];
tables.schedules = [{
  id: 7, technician_username: 'tech1', technician_name: 'Tech One', client_id: 'acme', client_name: 'ACME',
  location: 'Calamba', schedule_date: manilaDate(-5), schedule_time: null, description: 'Old job', status: 'scheduled'
}, {
  id: 8, technician_username: 'tech1', technician_name: 'Tech One', client_id: 'acme', client_name: 'ACME',
  location: 'Calamba', schedule_date: manilaDate(-5), schedule_time: null, description: 'Finished job', status: 'done'
}];

let server;
let origin;
let session;
before(async () => {
  const app = express();
  app.use(express.urlencoded({ extended: true }));
  app.use((req, res, next) => {
    req.session = session;
    next();
  });
  app.use('/admin_account', require('../routes/admin.routes'));
  server = await new Promise(resolve => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
  origin = `http://127.0.0.1:${server.address().port}`;
});
after(() => new Promise(resolve => server.close(resolve)));

async function save(fields) {
  session = { user: { role: 'admin', username: 'boss', fullName: 'Boss' } };
  writes.length = 0;
  const body = new URLSearchParams({
    technicianUsername: 'tech1', clientId: 'acme', location: 'Calamba', time: '', description: 'Fix printer', ...fields
  });
  const response = await fetch(`${origin}/admin_account/schedules/save`, {
    method: 'POST', body, redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
  });
  assert.equal(response.status, 302);
  return { error: session.flashError || null, saved: writes.some(([table]) => table === 'schedules') };
}

test('a new schedule cannot be dated in the past', async () => {
  const result = await save({ date: manilaDate(-1) });
  assert.match(result.error, /cannot be in the past/);
  assert.equal(result.saved, false);
});

test('today and future dates are accepted', async () => {
  for (const date of [manilaDate(0), manilaDate(3)]) {
    const result = await save({ date });
    assert.equal(result.error, null, `date ${date}`);
    assert.equal(result.saved, true);
  }
});

test('an existing past schedule can be edited while its date is unchanged', async () => {
  const kept = await save({ scheduleId: '7', date: manilaDate(-5), description: 'Corrected notes' });
  assert.equal(kept.error, null);
  assert.equal(kept.saved, true);

  const moved = await save({ scheduleId: '7', date: manilaDate(-2) });
  assert.match(moved.error, /cannot be in the past/);
  assert.equal(moved.saved, false);
});

test('a completed schedule cannot be edited', async () => {
  const result = await save({ scheduleId: '8', date: manilaDate(-5), description: 'Changed' });
  assert.match(result.error, /completed schedule can no longer be edited/);
  assert.equal(result.saved, false);
});
