/**
 * Compatibility shim — the real data layer lives in each *.store.js file,
 * which talks to the Hostinger MySQL database through database/db.js.
 *
 * This file only exports the helpers that routes still import directly
 * (getDb, getDbConfigSummary).
 */
const db = require('./db');

// Called in server.js on startup: one round trip so a wrong host or password
// shows up in the log straight away instead of on the first page load.
async function getDb() {
  await db.getPool().query('SELECT 1');
  return {};
}

function getDbConfigSummary() {
  return {
    mode: 'mysql',
    host: `${process.env.MYSQL_HOST || 'localhost'}:${process.env.MYSQL_PORT || 3306}`,
    database: process.env.MYSQL_DATABASE || 'unknown',
    ssl: false
  };
}

module.exports = {
  getDb,
  getDbConfigSummary
};
