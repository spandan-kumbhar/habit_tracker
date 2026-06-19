'use strict';

const { v4: uuidv4 } = require('uuid');
const db = require('../db');

// ─── Helpers ──────────────────────────────────────────────────────────────────

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Returns the number of days in a given year/month (1-indexed month).
 * Correctly handles leap years for February.
 */
function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate(); // month is 1-indexed here
}

/**
 * Pads a number to 2 digits.
 */
function pad(n) {
  return String(n).padStart(2, '0');
}

// ─── GET /api/logs?year=YYYY&month=M ─────────────────────────────────────────

async function getLogs(req, res, next) {
  try {
    const { year, month } = req.query;

    if (!year || !month) {
      return res.status(400).json({ error: 'Missing params', message: 'year and month query parameters are required.' });
    }

    const y = parseInt(year, 10);
    const m = parseInt(month, 10);

    if (isNaN(y) || isNaN(m) || m < 1 || m > 12) {
      return res.status(400).json({ error: 'Invalid params', message: 'Provide a valid year and month (1–12).' });
    }

    const days = daysInMonth(y, m);
    const dateFrom = `${y}-${pad(m)}-01`;
    const dateTo   = `${y}-${pad(m)}-${pad(days)}`;

    const logsResult = await db.query(`
      SELECT hl.id, hl.habit_id, hl.date, hl.completed
      FROM habit_logs hl
      INNER JOIN habits h ON h.id = hl.habit_id
      WHERE hl.user_id = $1
        AND hl.date >= $2
        AND hl.date <= $3
      ORDER BY hl.date ASC
    `, [req.user.id, dateFrom, dateTo]);

    return res.status(200).json({ logs: logsResult.rows });
  } catch (err) {
    next(err);
  }
}

// ─── POST /api/logs/toggle ────────────────────────────────────────────────────

async function toggleLog(req, res, next) {
  try {
    const { habit_id, date } = req.body;

    if (!habit_id || !date) {
      return res.status(400).json({ error: 'Missing fields', message: 'habit_id and date are required.' });
    }

    if (!DATE_RE.test(date)) {
      return res.status(400).json({ error: 'Invalid date format', message: 'date must be YYYY-MM-DD.' });
    }

    // Verify habit belongs to the requesting user
    const habitResult = await db.query(
      'SELECT id FROM habits WHERE id = $1 AND user_id = $2',
      [habit_id, req.user.id]
    );
    const habit = habitResult.rows[0];

    if (!habit) {
      return res.status(404).json({ error: 'Habit not found' });
    }

    // Check if a log already exists for this habit + date
    const existingResult = await db.query(
      'SELECT id, completed FROM habit_logs WHERE habit_id = $1 AND date = $2',
      [habit_id, date]
    );
    const existing = existingResult.rows[0];

    let log;

    if (existing) {
      // Flip completed value
      const newCompleted = existing.completed === 1 ? 0 : 1;
      await db.query(
        'UPDATE habit_logs SET completed = $1 WHERE id = $2',
        [newCompleted, existing.id]
      );
      log = { id: existing.id, habit_id, date, completed: newCompleted };
    } else {
      // Insert with completed = 1
      const id = uuidv4();
      await db.query(
        'INSERT INTO habit_logs (id, habit_id, user_id, date, completed) VALUES ($1, $2, $3, $4, $5)',
        [id, habit_id, req.user.id, date, 1]
      );
      log = { id, habit_id, date, completed: 1 };
    }

    return res.status(200).json({ log });
  } catch (err) {
    next(err);
  }
}

// ─── GET /api/logs/stats?year=YYYY&month=M ───────────────────────────────────

async function getStats(req, res, next) {
  try {
    const { year, month } = req.query;

    if (!year || !month) {
      return res.status(400).json({ error: 'Missing params', message: 'year and month query parameters are required.' });
    }

    const y = parseInt(year, 10);
    const m = parseInt(month, 10);

    if (isNaN(y) || isNaN(m) || m < 1 || m > 12) {
      return res.status(400).json({ error: 'Invalid params', message: 'Provide a valid year and month (1–12).' });
    }

    const days = daysInMonth(y, m);       // e.g. 30 for June
    const dateFrom = `${y}-${pad(m)}-01`;
    const dateTo   = `${y}-${pad(m)}-${pad(days)}`;

    // Total completions for this user in the month
    const compRowResult = await db.query(`
      SELECT COUNT(*) AS total
      FROM habit_logs hl
      WHERE hl.user_id = $1 AND hl.completed = 1
        AND hl.date >= $2 AND hl.date <= $3
    `, [req.user.id, dateFrom, dateTo]);
    const total_completions = parseInt(compRowResult.rows[0].total, 10) || 0;

    // Total habits for this user
    const habitsRowResult = await db.query(
      'SELECT COUNT(*) AS total FROM habits WHERE user_id = $1',
      [req.user.id]
    );
    const total_habits = parseInt(habitsRowResult.rows[0].total, 10) || 0;

    // Days elapsed — if current month use today's date, else full month
    const today = new Date();
    const isCurrentMonth = (today.getFullYear() === y && (today.getMonth() + 1) === m);
    const days_elapsed = isCurrentMonth ? today.getDate() : days;

    // Stats calculations
    const daily_avg = days_elapsed > 0
      ? parseFloat((total_completions / days_elapsed).toFixed(1))
      : 0;

    const monthly_goal = total_habits * days;

    const success_rate = monthly_goal > 0
      ? `${((total_completions / monthly_goal) * 100).toFixed(1)}%`
      : '0%';

    return res.status(200).json({
      stats: {
        total_completions,
        total_habits,
        days_in_month: days,
        days_elapsed,
        daily_avg,
        monthly_goal,
        success_rate,
      },
    });
  } catch (err) {
    next(err);
  }
}

// ─── DELETE /api/logs?habit_id=xxx&date=YYYY-MM-DD ───────────────────────────

async function deleteLog(req, res, next) {
  try {
    const { habit_id, date } = req.query;

    if (!habit_id || !date) {
      return res.status(400).json({ error: 'Missing params', message: 'habit_id and date query parameters are required.' });
    }

    // Verify ownership via habits table
    const habitResult = await db.query(
      'SELECT id FROM habits WHERE id = $1 AND user_id = $2',
      [habit_id, req.user.id]
    );
    const habit = habitResult.rows[0];

    if (!habit) {
      return res.status(404).json({ error: 'Habit not found' });
    }

    await db.query(
      'DELETE FROM habit_logs WHERE habit_id = $1 AND date = $2 AND user_id = $3',
      [habit_id, date, req.user.id]
    );

    return res.status(200).json({ message: 'Log deleted' });
  } catch (err) {
    next(err);
  }
}

// ───

module.exports = { getLogs, toggleLog, getStats, deleteLog };
