'use strict';

const { Pool } = require('pg');
const config = require('./config');

// Single shared pool for the whole app. Sized (config.db.max) to hold up under
// ~80 concurrent lab users.
const pool = new Pool({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.database,
  max: config.db.max,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

pool.on('error', (err) => {
  // Don't crash the whole app if an idle client errors out.
  console.error('[db] unexpected idle client error:', err.message);
});

// Wait for Postgres to accept connections (used at boot before schema/seed).
async function waitForDb(retries = 60, delayMs = 2000) {
  for (let i = 0; i < retries; i++) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch (err) {
      console.log(`[db] waiting for database (${i + 1}/${retries}): ${err.code || err.message}`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw new Error('[db] database never became available');
}

// Run a query inside a READ ONLY transaction. Used for the intentionally
// SQL-injectable product search: UNION/error-based *read* exploitation still
// works, but stacked write/DDL statements (`'; DROP TABLE orders; --`, UPDATE,
// DELETE, INSERT) are rejected by Postgres — so the SQLi stays a data-DISCLOSURE
// bug and a student can't irreparably wreck the shared environment (spec §7).
async function readonlyQuery(text) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN READ ONLY');
    const res = await client.query(text);
    await client.query('COMMIT');
    return res;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) { /* ignore */ }
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  pool,
  query: (text, params) => pool.query(text, params),
  readonlyQuery,
  waitForDb,
};
