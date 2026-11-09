/**
 * One-time move of every row from Supabase (Postgres) to the Hostinger MySQL
 * database, then a row-by-row comparison of the two.
 *
 *   node scripts/copy-supabase-to-mysql.js --create-schema   create the tables (database/mysql-schema.sql)
 *   node scripts/copy-supabase-to-mysql.js --copy            copy every row, then verify
 *   node scripts/copy-supabase-to-mysql.js --verify          compare only; changes nothing
 *
 * Needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (source) and MYSQL_HOST,
 * MYSQL_PORT, MYSQL_USER, MYSQL_PASSWORD, MYSQL_DATABASE (target) in .env.
 *
 * Supabase is only ever read (select), never written. MySQL is only written
 * by --copy, which refuses to run unless every target table is empty, so it
 * can never overwrite or duplicate rows; the whole copy is one transaction, so
 * a failure leaves MySQL empty again. Rows keep their ids, and every column is
 * copied as stored — no trimming, de-duplication or clean-up.
 *
 * For the final cut-over, stop people saving (or take the site offline) while
 * --copy runs, so nothing is written to Supabase after it has been read.
 */
require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const { createClient } = require('@supabase/supabase-js');
const db = require('../database/db');

// Parents before children (machines.client_id references clients.id).
const TABLE_ORDER = [
  'accounts', 'clients', 'machines', 'parts_catalog', 'invites',
  'password_resets', 'unit_models', 'schedules', 'push_subscriptions', 'profiles'
];
const PAGE = 500; // under PostgREST's 1000-row cap

function supabaseClient() {
  const url = String(process.env.SUPABASE_URL || '').trim();
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set.');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function readSupabaseTable(supabase, table) {
  const pk = db.TABLES[table].primaryKey;
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase.from(table).select('*').order(pk).range(from, from + PAGE - 1);
    if (error) throw new Error(`Supabase ${table}: ${error.message}`);
    rows.push(...data);
    if (data.length < PAGE) break;
  }
  return rows;
}

async function readMysqlTable(table) {
  const { data, error } = await db.from(table).select('*');
  if (error) throw error;
  return data;
}

// Stable JSON: object keys sorted (jsonb and MySQL JSON both reorder keys).
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value === undefined ? null : value);
}

async function createSchema() {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'database', 'mysql-schema.sql'), 'utf8');
  const statements = sql
    .split('\n').filter(line => !line.trim().startsWith('--')).join('\n')
    .split(';').map(s => s.trim()).filter(Boolean);
  for (const statement of statements) await db.getPool().query(statement);
  console.log(`Schema applied (${statements.length} statements).`);
}

async function copy() {
  const supabase = supabaseClient();
  const pool = db.getPool();

  for (const table of TABLE_ORDER) {
    const [[{ n }]] = await pool.query(`SELECT COUNT(*) AS n FROM \`${table}\``);
    if (Number(n) > 0) {
      throw new Error(`MySQL table ${table} already has ${n} rows — refusing to copy. Nothing was written.`);
    }
  }

  const source = {};
  for (const table of TABLE_ORDER) {
    source[table] = await readSupabaseTable(supabase, table);
    const known = new Set(db.TABLES[table].columns);
    const unknown = source[table].length ? Object.keys(source[table][0]).filter(c => !known.has(c)) : [];
    if (unknown.length) {
      throw new Error(`Supabase ${table} has columns the MySQL schema lacks: ${unknown.join(', ')}. Nothing was written.`);
    }
    console.log(`read   ${table.padEnd(20)} ${source[table].length} rows`);
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    for (const table of TABLE_ORDER) {
      const columns = db.TABLES[table].columns;
      for (const row of source[table]) {
        const present = columns.filter(c => Object.prototype.hasOwnProperty.call(row, c));
        await conn.query(
          `INSERT INTO \`${table}\` (${present.map(c => `\`${c}\``).join(', ')}) VALUES (?)`,
          [present.map(c => db.toDbValue(table, c, row[c]))]
        );
      }
      console.log(`wrote  ${table.padEnd(20)} ${source[table].length} rows`);
    }
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function verify() {
  const supabase = supabaseClient();
  let problems = 0;
  for (const table of TABLE_ORDER) {
    const pk = db.TABLES[table].primaryKey;
    const [left, right] = await Promise.all([readSupabaseTable(supabase, table), readMysqlTable(table)]);
    const mysqlByKey = new Map(right.map(row => [String(row[pk]), row]));
    const diffs = [];
    for (const row of left) {
      const other = mysqlByKey.get(String(row[pk]));
      if (!other) { diffs.push(`${pk}=${row[pk]} missing in MySQL`); continue; }
      mysqlByKey.delete(String(row[pk]));
      for (const column of Object.keys(row)) {
        if (canonical(row[column]) !== canonical(other[column])) {
          diffs.push(`${pk}=${row[pk]} ${column}: supabase=${canonical(row[column]).slice(0, 80)} mysql=${canonical(other[column]).slice(0, 80)}`);
        }
      }
    }
    for (const key of mysqlByKey.keys()) diffs.push(`${pk}=${key} only in MySQL`);
    problems += diffs.length;
    console.log(`${diffs.length ? 'DIFF ' : 'same '}  ${table.padEnd(20)} supabase=${left.length} mysql=${right.length}${diffs.length ? ` differences=${diffs.length}` : ''}`);
    diffs.slice(0, 5).forEach(d => console.log('         ' + d));
  }
  console.log(problems ? `\n${problems} difference(s) found.` : '\nEvery row and column matches.');
  return problems === 0;
}

(async () => {
  const flag = process.argv[2];
  let ok = true;
  if (flag === '--create-schema') await createSchema();
  else if (flag === '--copy') { await copy(); ok = await verify(); }
  else if (flag === '--verify') ok = await verify();
  else {
    console.log('Usage: node scripts/copy-supabase-to-mysql.js --create-schema | --copy | --verify');
    ok = false;
  }
  await db.end();
  process.exit(ok ? 0 : 1);
})().catch(async err => {
  console.error(err.message || err);
  await db.end().catch(() => {});
  process.exit(1);
});
