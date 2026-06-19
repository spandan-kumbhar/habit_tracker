'use strict';

// ─── Environment ──────────────────────────────────────────────────────────────
require('dotenv').config();

// ─── DB init (must run before any route handler touches the DB) ───────────────
const initDb = require('./models/initDb');

// ─── Imports ──────────────────────────────────────────────────────────────────
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const authMiddleware = require('./middleware/auth');
const errorHandler = require('./middleware/errorHandler');

const authRouter   = require('./routes/auth');
const habitsRouter = require('./routes/habits');
const logsRouter   = require('./routes/logs');

// ─── App Setup ────────────────────────────────────────────────────────────────
const app = express();

// Parse JSON bodies
app.use(express.json());

// CORS — allow requests from the configured frontend URL
app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Global rate limiter: 100 requests per 15 minutes per IP
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests', message: 'Please try again later.' },
});
app.use(limiter);

// ─── Health Check ─────────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─── Routes ───────────────────────────────────────────────────────────────────
// Auth routes: register & login are public; /me uses per-route guard in auth.js
app.use('/api/auth', authRouter);

// Habits and logs routes: ALL protected by JWT auth middleware
app.use('/api/habits', authMiddleware, habitsRouter);
app.use('/api/logs', authMiddleware, logsRouter);

// ─── 404 Handler ─────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// ─── Error Handler (must be last) ─────────────────────────────────────────────
app.use(errorHandler);

// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT, 10) || 3001;

(async () => {
  try {
    await initDb();
    app.listen(PORT, () => {
      console.log(`✅ Server running on port ${PORT}`);
      console.log(`   Environment : ${process.env.NODE_ENV || 'development'}`);
      console.log(`   Frontend URL: ${process.env.FRONTEND_URL || '*'}`);
      console.log(`   Database    : PostgreSQL (Neon)`);
    });
  } catch (err) {
    console.error('❌ Database initialization failed. Shutting down.', err);
    process.exit(1);
  }
})();

module.exports = app; // export for testing purposes
