const mysql = require('mysql2');

/**
 * MySQL data access with the same call shape the stores used with Supabase:
 *
 *   const { data, error } = await db.from('machines').select('*').eq('id', 5).maybeSingle();
 *
 * Only the query-builder methods the stores actually call are implemented,
 * and each one keeps its Postgres/PostgREST meaning so the store logic didn't
 * have to change when the database moved to Hostinger MySQL:
 *   - queries never throw; they resolve to { data, error } like supabase-js
 *   - jsonb columns come back as objects/arrays, timestamptz columns as
 *     "2026-10-20T09:02:12.037832+00:00" strings, exactly as PostgREST sent them
 *   - text sorts like Postgres' en_US collation, and NULLs sort last ascending
 *   - unique / missing-table / missing-column errors carry the Postgres codes
 *     (23505, 42P01, 42703) the stores already check for
 *   - .update()/.delete()/.insert() followed by .select() return the rows written
 */

// Column layout of every table (see database/mysql-schema.sql). select('*')
// expands to these, which also keeps the helper column unit_models.unit_only_key
// out of results.
const TABLES = {
  accounts: {
    primaryKey: 'username',
    columns: ['username', 'password_hash', 'role', 'full_name', 'email', 'department', 'branch', 'status']
  },
  clients: {
    primaryKey: 'id',
    columns: ['id', 'name', 'location', 'status', 'sales_username']
  },
  machines: {
    primaryKey: 'id',
    columns: [
      'id', 'client_id', 'client_name', 'location', 'unit', 'model', 'serial_no', 'date_installed',
      'running_hours', 'status', 'description', 'submitted_by', 'technicians', 'maintenance_service_date',
      'part_service_dates', 'part_service_hours', 'part_service_adjustments', 'initial_running_hours',
      'initial_status', 'initial_description', 'initial_maintenance_service_date',
      'initial_part_service_dates', 'initial_part_service_hours', 'updates', 'reports', 'created_at',
      'smr_date', 'initial_smr_date', 'disabled_at', 'disabled_by'
    ],
    json: [
      'technicians', 'part_service_dates', 'part_service_hours', 'part_service_adjustments',
      'initial_part_service_dates', 'initial_part_service_hours', 'updates', 'reports'
    ],
    timestamps: ['created_at', 'disabled_at'],
    numbers: ['id', 'running_hours', 'initial_running_hours']
  },
  parts_catalog: {
    primaryKey: 'id',
    columns: ['id', 'part_number', 'description', 'model_series', 'created_at', 'unit', 'expiry_months', 'expiry_hours', 'expiry_days'],
    timestamps: ['created_at'],
    numbers: ['expiry_months', 'expiry_hours', 'expiry_days']
  },
  invites: {
    primaryKey: 'token',
    columns: ['token', 'email', 'role', 'branch', 'department', 'status', 'created_at', 'expires_at', 'accepted_at', 'accepted_username']
  },
  password_resets: {
    primaryKey: 'token',
    columns: ['token', 'username', 'email', 'status', 'created_at', 'expires_at', 'used_at']
  },
  unit_models: {
    primaryKey: 'id',
    columns: ['id', 'unit', 'unit_key', 'model', 'model_key', 'created_by', 'created_at'],
    timestamps: ['created_at'],
    numbers: ['id']
  },
  schedules: {
    primaryKey: 'id',
    columns: [
      'id', 'technician_username', 'technician_name', 'client_id', 'client_name', 'location',
      'schedule_date', 'schedule_time', 'description', 'status', 'created_by', 'created_at', 'updated_at'
    ],
    timestamps: ['created_at', 'updated_at'],
    numbers: ['id'],
    // DATE / TIME: compared and sorted as values, not as text.
    temporal: ['schedule_date', 'schedule_time']
  },
  push_subscriptions: {
    primaryKey: 'id',
    columns: ['id', 'username', 'endpoint', 'p256dh', 'auth', 'user_agent', 'created_at', 'updated_at'],
    timestamps: ['created_at', 'updated_at'],
    numbers: ['id']
  },
  update_photos: {
    primaryKey: 'id',
    columns: [
      'id', 'client_id', 'machine_id', 'file_path', 'original_name', 'mime', 'size_bytes',
      'uploaded_by', 'created_at', 'attached_at'
    ],
    timestamps: ['created_at', 'attached_at'],
    numbers: ['machine_id', 'size_bytes']
  },
  profiles: {
    primaryKey: 'id',
    columns: ['created_at', 'id', 'email', 'full_name'],
    timestamps: ['created_at']
  }
};

// MySQL error number -> the Postgres SQLSTATE the stores check for.
const POSTGRES_CODES = {
  1062: '23505', // ER_DUP_ENTRY                    -> unique_violation
  1146: '42P01', // ER_NO_SUCH_TABLE                -> undefined_table
  1054: '42703', // ER_BAD_FIELD_ERROR              -> undefined_column
  1451: '23503', // ER_ROW_IS_REFERENCED_2          -> foreign_key_violation
  1452: '23503', // ER_NO_REFERENCED_ROW_2          -> foreign_key_violation
  3819: '23514', // ER_CHECK_CONSTRAINT_VIOLATED    -> check_violation (MySQL)
  4025: '23514'  // ER_CONSTRAINT_FAILED            -> check_violation (MariaDB)
};

let pool = null;

function getPool() {
  if (pool) return pool;
  const config = {
    host: process.env.MYSQL_HOST || 'localhost',
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER || '',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || ''
  };
  if (!config.user || !config.database) {
    console.error(
      '[db] MYSQL_USER / MYSQL_DATABASE are not set — every query will fail. ' +
      'Set MYSQL_HOST, MYSQL_PORT, MYSQL_USER, MYSQL_PASSWORD and MYSQL_DATABASE in the hosting panel.'
    );
  }
  const base = mysql.createPool({
    ...config,
    charset: 'utf8mb4',
    timezone: 'Z',
    // DATETIME/DATE/TIME arrive as strings and are formatted below, so no
    // value ever passes through the server's local time zone.
    dateStrings: true,
    connectionLimit: Number(process.env.MYSQL_CONNECTION_LIMIT || 5),
    waitForConnections: true,
    enableKeepAlive: true
  });
  // CURRENT_TIMESTAMP defaults must be UTC, like Postgres now() in timestamptz.
  // Strict mode: Hostinger's server default isn't, and without it an
  // over-long or invalid value is silently cut down instead of rejected —
  // Postgres always rejected it.
  base.on('connection', conn => conn.query(
    "SET time_zone = '+00:00', sql_mode = 'STRICT_ALL_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION'"
  ));
  pool = base.promise();
  return pool;
}

function tableInfo(table) {
  const info = TABLES[table];
  if (!info) throw new Error(`Unknown table "${table}".`);
  return {
    json: [], timestamps: [], numbers: [], temporal: [],
    ...info
  };
}

function quoteId(name) {
  if (!/^[a-z_][a-z0-9_]*$/i.test(name)) throw new Error(`Bad column name "${name}".`);
  return '`' + name + '`';
}

// "2026-10-20 09:02:12.037832" (UTC) -> "2026-10-20T09:02:12.037832+00:00",
// trimming trailing fractional zeros the way Postgres prints timestamptz.
function formatTimestamp(value) {
  if (value === null || value === undefined) return value;
  const match = /^(\d{4}-\d\d-\d\d)[ T](\d\d:\d\d:\d\d)(?:\.(\d+))?/.exec(String(value));
  if (!match) return value;
  const fraction = (match[3] || '').replace(/0+$/, '');
  return `${match[1]}T${match[2]}${fraction ? '.' + fraction : ''}+00:00`;
}

// Any ISO string / Date -> "YYYY-MM-DD HH:MM:SS.ffffff" in UTC. Keeps all six
// fractional digits of a Postgres-formatted value (JS Dates only hold ms).
function toDatetime(value) {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return value.toISOString().replace('T', ' ').replace('Z', '');
  const text = String(value).trim();
  const match = /^(\d{4}-\d\d-\d\d)[ T](\d\d:\d\d:\d\d)(?:\.(\d{1,6}))?(Z|[+-]00(?::?00)?)?$/.exec(text);
  if (match) return `${match[1]} ${match[2]}${match[3] ? '.' + match[3] : ''}`;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) throw new Error(`Invalid timestamp "${text}".`);
  return parsed.toISOString().replace('T', ' ').replace('Z', '');
}

function toDbValue(info, column, value) {
  if (value === undefined) return null;
  if (info.json.includes(column)) return value === null ? null : JSON.stringify(value);
  if (info.timestamps.includes(column)) return toDatetime(value);
  return value;
}

function fromDbRow(info, row) {
  const out = {};
  for (const [column, value] of Object.entries(row)) {
    if (info.json.includes(column)) {
      // MySQL hands JSON back parsed; MariaDB (JSON = LONGTEXT) as a string.
      out[column] = typeof value === 'string' ? JSON.parse(value) : value;
    } else if (info.timestamps.includes(column)) {
      out[column] = formatTimestamp(value);
    } else if (info.numbers.includes(column) && typeof value === 'string') {
      out[column] = Number(value);
    } else {
      out[column] = value;
    }
  }
  return out;
}

function toError(err) {
  const error = new Error(err && err.message ? err.message : String(err));
  error.code = POSTGRES_CODES[err && err.errno] || (err && err.code) || '';
  error.mysqlCode = err && err.code;
  error.errno = err && err.errno;
  error.details = err && err.sqlMessage ? err.sqlMessage : null;
  return error;
}

class Query {
  constructor(table) {
    this.table = table;
    this.info = tableInfo(table);
    this.action = 'select';
    this.columns = null;
    this.returning = false;
    this.filters = [];
    this.orders = [];
    this.limitCount = null;
    this.offsetCount = null;
    this.singleMode = null;
    this.payload = null;
    this.conflictColumn = null;
  }

  select(columns = '*') {
    if (this.action === 'select') this.columns = columns;
    else this.returning = columns;
    return this;
  }

  insert(values) { this.action = 'insert'; this.payload = values; return this; }
  update(values) { this.action = 'update'; this.payload = values; return this; }
  delete() { this.action = 'delete'; return this; }
  upsert(values, { onConflict } = {}) {
    this.action = 'upsert';
    this.payload = values;
    this.conflictColumn = onConflict || this.info.primaryKey;
    return this;
  }

  eq(column, value) { this.filters.push({ sql: `${quoteId(column)} = ?`, params: [this.filterValue(column, value)] }); return this; }
  // Like Postgres, <> never matches NULL.
  neq(column, value) { this.filters.push({ sql: `${quoteId(column)} <> ?`, params: [this.filterValue(column, value)] }); return this; }
  gte(column, value) { this.filters.push({ sql: `${quoteId(column)} >= ?`, params: [this.filterValue(column, value)] }); return this; }
  in(column, values) {
    const list = Array.isArray(values) ? values : [];
    if (!list.length) this.filters.push({ sql: 'FALSE', params: [] });
    else this.filters.push({ sql: `${quoteId(column)} IN (?)`, params: [list.map(v => this.filterValue(column, v))] });
    return this;
  }
  is(column, value) {
    if (value !== null) throw new Error('.is() only supports null.');
    this.filters.push({ sql: `${quoteId(column)} IS NULL`, params: [] });
    return this;
  }
  not(column, operator, value) {
    if (operator !== 'is' || value !== null) throw new Error('.not() only supports ("column", "is", null).');
    this.filters.push({ sql: `${quoteId(column)} IS NOT NULL`, params: [] });
    return this;
  }
  // Case-insensitive LIKE; the caller's pattern (with its \% \_ \\ escapes) is
  // used as-is, as PostgREST did.
  ilike(column, pattern) {
    this.filters.push({ sql: `LOWER(${quoteId(column)}) LIKE LOWER(?)`, params: [String(pattern)] });
    return this;
  }

  order(column, { ascending = true, nullsFirst } = {}) {
    // Postgres default: NULLS LAST ascending, NULLS FIRST descending.
    const nullsGoFirst = nullsFirst === undefined ? !ascending : Boolean(nullsFirst);
    const direction = ascending ? 'ASC' : 'DESC';
    const isText = !this.info.numbers.includes(column)
      && !this.info.timestamps.includes(column)
      && !this.info.temporal.includes(column);
    const collated = isText ? `${quoteId(column)} COLLATE utf8mb4_unicode_ci` : quoteId(column);
    this.orders.push(`(${quoteId(column)} IS NULL) ${nullsGoFirst ? 'DESC' : 'ASC'}`, `${collated} ${direction}`);
    // utf8mb4_unicode_ci ties "GP1" and "Gp1"; Postgres puts lowercase first.
    if (isText) this.orders.push(`${quoteId(column)} ${ascending ? 'DESC' : 'ASC'}`);
    return this;
  }

  limit(count) { this.limitCount = Number(count); return this; }
  range(from, to) { this.offsetCount = Number(from); this.limitCount = Number(to) - Number(from) + 1; return this; }
  maybeSingle() { this.singleMode = 'maybe'; return this; }
  single() { this.singleMode = 'single'; return this; }

  then(resolve, reject) {
    return this.run().then(resolve, reject);
  }

  filterValue(column, value) {
    return this.info.timestamps.includes(column) ? toDatetime(value) : value;
  }

  selectList(columns) {
    const spec = columns === true || columns === undefined || columns === null ? '*' : String(columns);
    const names = spec.trim() === '*'
      ? this.info.columns
      : spec.split(',').map(name => name.trim()).filter(Boolean);
    return names.map(quoteId).join(', ');
  }

  whereClause() {
    if (!this.filters.length) return { sql: '', params: [] };
    return {
      sql: ' WHERE ' + this.filters.map(f => `(${f.sql})`).join(' AND '),
      params: this.filters.flatMap(f => f.params)
    };
  }

  tailClause() {
    let sql = this.orders.length ? ' ORDER BY ' + this.orders.join(', ') : '';
    if (this.limitCount !== null) sql += ` LIMIT ${Math.max(0, Math.floor(this.limitCount))}`;
    if (this.offsetCount !== null) {
      if (this.limitCount === null) sql += ' LIMIT 18446744073709551615';
      sql += ` OFFSET ${Math.max(0, Math.floor(this.offsetCount))}`;
    }
    return sql;
  }

  shape(rows) {
    const mapped = rows.map(row => fromDbRow(this.info, row));
    if (!this.singleMode) return { data: mapped, error: null };
    if (mapped.length > 1) {
      return { data: null, error: Object.assign(new Error('JSON object requested, multiple (or no) rows returned'), { code: 'PGRST116' }) };
    }
    if (!mapped.length && this.singleMode === 'single') {
      return { data: null, error: Object.assign(new Error('JSON object requested, multiple (or no) rows returned'), { code: 'PGRST116' }) };
    }
    return { data: mapped[0] || null, error: null };
  }

  async run() {
    try {
      switch (this.action) {
        case 'select': return await this.runSelect();
        case 'insert': return await this.runInsert();
        case 'update': return await this.runUpdate();
        case 'delete': return await this.runDelete();
        case 'upsert': return await this.runUpsert();
        default: throw new Error(`Unknown action ${this.action}`);
      }
    } catch (err) {
      return { data: null, error: toError(err) };
    }
  }

  async runSelect() {
    const where = this.whereClause();
    const sql = `SELECT ${this.selectList(this.columns)} FROM ${quoteId(this.table)}${where.sql}${this.tailClause()}`;
    const [rows] = await getPool().query(sql, where.params);
    return this.shape(rows);
  }

  // Rows by primary key, in the order given.
  async fetchByKeys(conn, keys) {
    if (!keys.length) return [];
    const pk = this.info.primaryKey;
    const [rows] = await conn.query(
      `SELECT ${this.selectList(this.returning)}, ${quoteId(pk)} AS __pk FROM ${quoteId(this.table)} WHERE ${quoteId(pk)} IN (?)`,
      [keys]
    );
    const byKey = new Map(rows.map(row => [String(row.__pk), row]));
    return keys.map(key => byKey.get(String(key))).filter(Boolean).map(row => {
      const { __pk, ...rest } = row;
      return rest;
    });
  }

  async withTransaction(work) {
    const conn = await getPool().getConnection();
    try {
      await conn.beginTransaction();
      const result = await work(conn);
      await conn.commit();
      return result;
    } catch (err) {
      try { await conn.rollback(); } catch { /* keep the original error */ }
      throw err;
    } finally {
      conn.release();
    }
  }

  assignments(values) {
    const columns = Object.keys(values);
    if (!columns.length) throw new Error('Nothing to write.');
    return {
      columns,
      sql: columns.map(c => `${quoteId(c)} = ?`).join(', '),
      params: columns.map(c => toDbValue(this.info, c, values[c]))
    };
  }

  async runInsert() {
    const rows = Array.isArray(this.payload) ? this.payload : [this.payload];
    const pk = this.info.primaryKey;
    return this.withTransaction(async conn => {
      const keys = [];
      for (const row of rows) {
        const set = this.assignments(row);
        const [result] = await conn.query(`INSERT INTO ${quoteId(this.table)} SET ${set.sql}`, set.params);
        keys.push(row[pk] !== undefined ? row[pk] : result.insertId);
      }
      if (!this.returning) return { data: null, error: null };
      return this.shape(await this.fetchByKeys(conn, keys));
    });
  }

  async runUpsert() {
    const rows = Array.isArray(this.payload) ? this.payload : [this.payload];
    const conflict = this.conflictColumn;
    return this.withTransaction(async conn => {
      const keys = [];
      for (const row of rows) {
        const set = this.assignments(row);
        const updates = set.columns.filter(c => c !== conflict && c !== this.info.primaryKey);
        const onDuplicate = updates.length
          ? updates.map(c => `${quoteId(c)} = VALUES(${quoteId(c)})`).join(', ')
          : `${quoteId(conflict)} = ${quoteId(conflict)}`;
        await conn.query(
          `INSERT INTO ${quoteId(this.table)} SET ${set.sql} ON DUPLICATE KEY UPDATE ${onDuplicate}`,
          set.params
        );
        if (this.returning) {
          const [found] = await conn.query(
            `SELECT ${quoteId(this.info.primaryKey)} AS __pk FROM ${quoteId(this.table)} WHERE ${quoteId(conflict)} = ?`,
            [toDbValue(this.info, conflict, row[conflict])]
          );
          if (found[0]) keys.push(found[0].__pk);
        }
      }
      if (!this.returning) return { data: null, error: null };
      return this.shape(await this.fetchByKeys(conn, keys));
    });
  }

  // Locks the matching rows, so a conditional update (e.g. "only while
  // disabled_at IS NULL") reports exactly the rows it changed.
  async lockMatchingKeys(conn) {
    const where = this.whereClause();
    const pk = this.info.primaryKey;
    const [rows] = await conn.query(
      `SELECT ${quoteId(pk)} AS __pk FROM ${quoteId(this.table)}${where.sql}${this.tailClause()} FOR UPDATE`,
      where.params
    );
    return rows.map(row => row.__pk);
  }

  async runUpdate() {
    const set = this.assignments(this.payload || {});
    if (!this.returning) {
      const where = this.whereClause();
      await getPool().query(`UPDATE ${quoteId(this.table)} SET ${set.sql}${where.sql}`, [...set.params, ...where.params]);
      return { data: null, error: null };
    }
    return this.withTransaction(async conn => {
      const keys = await this.lockMatchingKeys(conn);
      if (keys.length) {
        await conn.query(
          `UPDATE ${quoteId(this.table)} SET ${set.sql} WHERE ${quoteId(this.info.primaryKey)} IN (?)`,
          [...set.params, keys]
        );
      }
      return this.shape(await this.fetchByKeys(conn, keys));
    });
  }

  async runDelete() {
    if (!this.returning) {
      const where = this.whereClause();
      await getPool().query(`DELETE FROM ${quoteId(this.table)}${where.sql}`, where.params);
      return { data: null, error: null };
    }
    return this.withTransaction(async conn => {
      const keys = await this.lockMatchingKeys(conn);
      const rows = await this.fetchByKeys(conn, keys);
      if (keys.length) {
        await conn.query(`DELETE FROM ${quoteId(this.table)} WHERE ${quoteId(this.info.primaryKey)} IN (?)`, [keys]);
      }
      return this.shape(rows);
    });
  }
}

const db = {
  from(table) {
    return new Query(table);
  },
  // For scripts (copy/verify) and shutdown; the app itself only uses from().
  getPool,
  async end() {
    if (pool) {
      const current = pool;
      pool = null;
      await current.end();
    }
  },
  TABLES,
  toDbValue: (table, column, value) => toDbValue(tableInfo(table), column, value),
  fromDbRow: (table, row) => fromDbRow(tableInfo(table), row)
};

module.exports = db;
