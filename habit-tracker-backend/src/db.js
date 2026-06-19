'use strict';

const { Pool } = require('pg');

// Initialize pg Pool using connection string from environment variables
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false, // Standard for Neon DB to avoid credential/CA issues
  },
});

module.exports = {
  /**
   * Helper function to execute a single query.
   * Automatically acquires and releases a client from the pool.
   */
  query: (text, params) => pool.query(text, params),
  pool,
};
