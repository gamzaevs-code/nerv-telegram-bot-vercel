const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function query(sql, params = []) {
  return pool.query(sql, params);
}

// Выполняет callback внутри транзакции.
// В callback передаётся client — используй client.query(...) вместо query(...).
// При любой ошибке — автоматический ROLLBACK.
async function withTransaction(callback) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      console.error('ROLLBACK failed:', rollbackErr);
    }
    throw e;
  } finally {
    client.release();
  }
}

module.exports = { query, pool, withTransaction };
