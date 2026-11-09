const assert = require('node:assert/strict');
const { test } = require('node:test');

// Isolate all database access; records the filters each query was built with.
const queries = [];
const database = {
  from(table) {
    const query = { table, filters: {}, patch: null };
    queries.push(query);
    const builder = new Proxy({}, {
      get(target, method) {
        if (method === 'then') {
          const row = {
            id: 1, technician_username: ['tech1', 'tech2'], client_id: 'acme', schedule_date: '2026-10-30',
            status: 'done', ...query.patch
          };
          return (resolve, reject) => Promise.resolve({ data: [row], error: null }).then(resolve, reject);
        }
        return (...args) => {
          if (method === 'eq' || method === 'in') query.filters[args[0]] = args[1];
          if (method === 'update') query.patch = args[0];
          return builder;
        };
      }
    });
    return builder;
  }
};
const dbPath = require.resolve('../database/db');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: database };

const { completeSchedulesForLog } = require('../database/schedules.store');

test('a log completes the open schedules of every technician on it for that client today', async () => {
  const done = await completeSchedulesForLog(['Tech1', 'tech2', 'tech1'], 'acme', '2026-10-30');
  assert.equal(done.length, 1);
  const [query] = queries;
  assert.equal(query.table, 'schedules');
  assert.equal(query.patch.status, 'done');
  assert.deepEqual(query.filters, {
    technician_username: ['tech1', 'tech2'],
    client_id: 'acme',
    schedule_date: '2026-10-30',
    status: 'scheduled'
  });
});

test('nothing is updated without a technician or client', async () => {
  queries.length = 0;
  assert.deepEqual(await completeSchedulesForLog([], 'acme'), []);
  assert.deepEqual(await completeSchedulesForLog(['tech1'], ''), []);
  assert.equal(queries.length, 0);
});
