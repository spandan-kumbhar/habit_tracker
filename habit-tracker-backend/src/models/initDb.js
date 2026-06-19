'use strict';

// Load env vars before importing db so DATABASE_URL is available
require('dotenv').config();

const db = require('../db');

/**
 * Creates all required tables if they don't already exist.
 * Safe to call on every startup — fully idempotent.
 */
async function initDb() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS users (
      id            VARCHAR(255) PRIMARY KEY,
      email         VARCHAR(255) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      name          VARCHAR(255) NOT NULL,
      created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS habits (
      id          VARCHAR(255) PRIMARY KEY,
      user_id     VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name        VARCHAR(255) NOT NULL,
      emoji       VARCHAR(50) DEFAULT '✅',
      frequency   INTEGER DEFAULT 7,
      sort_order  INTEGER DEFAULT 0,
      created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS habit_logs (
      id          VARCHAR(255) PRIMARY KEY,
      habit_id    VARCHAR(255) NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
      user_id     VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      date        VARCHAR(50) NOT NULL,
      completed   INTEGER DEFAULT 0,
      UNIQUE(habit_id, date)
    );
  `);

  console.log('✅ Database initialised — all tables ready.');
}

module.exports = initDb;

// Allow direct invocation: `node src/models/initDb.js`
if (require.main === module) {
  initDb()
    .then(() => {
      console.log('Database init script completed successfully.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('Failed to initialize database:', err);
      process.exit(1);
    });
}
