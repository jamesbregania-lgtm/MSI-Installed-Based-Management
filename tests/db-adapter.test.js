const assert = require('node:assert/strict');
const { test } = require('node:test');

// Stand-in for mysql2: records every statement and answers from `answers`.
const statements = [];
let answers = [];
const fakeConn = {
  async query(sql, params) {
    statements.push({ sql, params });
    const next = answers.shift();
    if (next instanceof Error) throw next;
    return [next || []];
  },
  async beginTransaction() { statements.push({ sql: 'BEGIN' }); },
  async commit() { statements.push({ sql: 'COMMIT' }); },
  async rollback() { statements.push({ sql: 'ROLLBACK' }); },
  release() {}
};
const mysqlPath = require.resolve('mysql2');
require.cache[mysqlPath] = {
  id: mysqlPath, filename: mysqlPath, loaded: true,
  exports: {
    createPool: () => ({
      on() {},
      promise: () => ({ ...fakeConn, getConnection: async () => fakeConn, end: async () => {} })
    })
  }
};
process.env.MYSQL_USER = 'test';
process.env.MYSQL_DATABASE = 'test';
const db = require('../database/db');

function reset(next = []) {
  statements.length = 0;
  answers = next;
}

test('rows come back shaped like PostgREST: parsed JSON, Postgres-style timestamps', async () => {
  reset([[{
    id: 5, updates: '[{"a":1}]', reports: [{ refNo: 'X' }], running_hours: 12.5,
    created_at: '2026-10-20 09:02:12.037832', disabled_at: '2026-10-15 12:54:23.325000'
  }]]);
  const { data, error } = await db.from('machines').select('*').eq('id', 5).maybeSingle();
  assert.equal(error, null);
  assert.deepEqual(data.updates, [{ a: 1 }]);           // MariaDB: JSON arrives as text
  assert.deepEqual(data.reports, [{ refNo: 'X' }]);     // MySQL: JSON arrives parsed
  assert.equal(data.created_at, '2026-10-20T09:02:12.037832+00:00');
  assert.equal(data.disabled_at, '2026-10-15T12:54:23.325+00:00');
  assert.match(statements[0].sql, /FROM `machines` WHERE \(`id` = \?\)$/);
  assert.doesNotMatch(statements[0].sql, /unit_only_key/);
});

test('writes store JSON as text and ISO timestamps as UTC DATETIME', async () => {
  reset([{ affectedRows: 1, insertId: 0 }]);
  const { error } = await db.from('machines').insert({ client_id: 'acme', updates: [], part_service_dates: {} });
  assert.equal(error, null);
  const insert = statements.find(s => s.sql.startsWith('INSERT'));
  assert.deepEqual(insert.params, ['acme', '[]', '{}']);

  reset([[{ __pk: 7 }], { affectedRows: 1 }, [{ id: 7, disabled_at: '2026-11-03 01:02:03.456', __pk: 7 }]]);
  const { data } = await db.from('machines')
    .update({ disabled_at: '2026-11-03T01:02:03.456Z', disabled_by: 'admin' })
    .eq('id', 7).is('disabled_at', null).select('*');
  assert.equal(data.length, 1);
  assert.equal(data[0].disabled_at, '2026-11-03T01:02:03.456+00:00');
  const update = statements.find(s => s.sql.startsWith('UPDATE'));
  assert.deepEqual(update.params, ['2026-11-03 01:02:03.456', 'admin', [7]]);
  assert.match(statements.find(s => s.sql.includes('FOR UPDATE')).sql, /`disabled_at` IS NULL/);
});

test('a conditional update that matches nothing changes nothing and returns []', async () => {
  reset([[]]);
  const { data, error } = await db.from('clients').update({ sales_username: 'rep' })
    .eq('id', 'acme').is('sales_username', null).select('id');
  assert.equal(error, null);
  assert.deepEqual(data, []);
  assert.equal(statements.some(s => s.sql.startsWith('UPDATE')), false);
});

test('ordering matches Postgres: linguistic text order, NULLS LAST ascending', async () => {
  reset([[]]);
  await db.from('schedules').select('*').order('schedule_date').order('schedule_time', { nullsFirst: true });
  assert.match(statements[0].sql, /ORDER BY \(`schedule_date` IS NULL\) ASC, `schedule_date` ASC, \(`schedule_time` IS NULL\) DESC, `schedule_time` ASC$/);
  reset([[]]);
  await db.from('clients').select('*').order('name');
  assert.match(statements[0].sql, /`name` COLLATE utf8mb4_unicode_ci ASC/);
});

test('serial search: case-insensitive LIKE and PostgREST-style range paging', async () => {
  reset([[]]);
  await db.from('machines').select('id, serial_no').ilike('serial_no', '%SN\\%%').order('serial_no').order('id').range(1000, 1025);
  assert.match(statements[0].sql, /LOWER\(`serial_no`\) LIKE LOWER\(\?\)/);
  assert.match(statements[0].sql, /LIMIT 26 OFFSET 1000$/);
  assert.deepEqual(statements[0].params, ['%SN\\%%']);
});

test('MySQL errors carry the Postgres codes the stores check', async () => {
  reset([Object.assign(new Error('Duplicate entry'), { errno: 1062, code: 'ER_DUP_ENTRY' })]);
  const dup = await db.from('accounts').insert({ username: 'a', password_hash: 'x' });
  assert.equal(dup.error.code, '23505');

  reset([Object.assign(new Error("Table 'x.schedules' doesn't exist"), { errno: 1146, code: 'ER_NO_SUCH_TABLE' })]);
  const missing = await db.from('schedules').select('*');
  assert.equal(missing.error.code, '42P01');
  assert.equal(missing.data, null);
});

test('upsert updates every sent column except the conflict key', async () => {
  reset([{ affectedRows: 1 }]);
  await db.from('push_subscriptions').upsert({ username: 'tech1', endpoint: 'https://e', p256dh: 'k', auth: 'a' }, { onConflict: 'endpoint' });
  const sql = statements.find(s => s.sql.startsWith('INSERT')).sql;
  assert.match(sql, /ON DUPLICATE KEY UPDATE `username` = VALUES\(`username`\), `p256dh` = VALUES\(`p256dh`\), `auth` = VALUES\(`auth`\)$/);
});

test('maybeSingle errors on several rows, single errors on none', async () => {
  reset([[{ id: 1 }, { id: 2 }]]);
  assert.equal((await db.from('unit_models').select('*').maybeSingle()).error.code, 'PGRST116');
  reset([[]]);
  assert.equal((await db.from('unit_models').select('*').maybeSingle()).data, null);
  reset([[]]);
  assert.equal((await db.from('unit_models').select('*').single()).error.code, 'PGRST116');
});
