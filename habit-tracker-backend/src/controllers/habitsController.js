'use strict';

const { v4: uuidv4 } = require('uuid');
const db = require('../db');

// ─── GET /api/habits ──────────────────────────────────────────────────────────

async function getHabits(req, res, next) {
  try {
    const habitsResult = await db.query(
      'SELECT id, name, emoji, frequency, sort_order, created_at FROM habits WHERE user_id = $1 ORDER BY sort_order ASC',
      [req.user.id]
    );

    return res.status(200).json({ habits: habitsResult.rows });
  } catch (err) {
    next(err);
  }
}

// ─── POST /api/habits ─────────────────────────────────────────────────────────

async function createHabit(req, res, next) {
  try {
    const { name, emoji = '✅', frequency = 7 } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Missing field', message: 'name is required.' });
    }

    const freq = parseInt(frequency, 10);
    if (isNaN(freq) || freq < 1 || freq > 7) {
      return res.status(400).json({ error: 'Invalid frequency', message: 'frequency must be an integer between 1 and 7.' });
    }

    // Get current max sort_order for this user
    const maxRowResult = await db.query(
      'SELECT MAX(sort_order) AS max_order FROM habits WHERE user_id = $1',
      [req.user.id]
    );
    const maxRow = maxRowResult.rows[0];
    const sortOrder = (maxRow && maxRow.max_order !== null ? maxRow.max_order : -1) + 1;

    const id = uuidv4();

    await db.query(
      'INSERT INTO habits (id, user_id, name, emoji, frequency, sort_order) VALUES ($1, $2, $3, $4, $5, $6)',
      [id, req.user.id, name.trim(), emoji.trim(), freq, sortOrder]
    );

    const habitResult = await db.query(
      'SELECT id, name, emoji, frequency, sort_order, created_at FROM habits WHERE id = $1',
      [id]
    );
    const habit = habitResult.rows[0];

    return res.status(201).json({ habit });
  } catch (err) {
    next(err);
  }
}

// ─── PUT /api/habits/reorder ─────────────────────────────────────────────────
// IMPORTANT: This route must be registered BEFORE /:id in Express

async function reorderHabits(req, res, next) {
  const client = await db.pool.connect();
  try {
    const { order } = req.body;

    if (!Array.isArray(order) || order.length === 0) {
      return res.status(400).json({ error: 'Invalid body', message: 'order must be a non-empty array of habit IDs.' });
    }

    await client.query('BEGIN');
    
    for (let index = 0; index < order.length; index++) {
      const id = order[index];
      await client.query(
        'UPDATE habits SET sort_order = $1 WHERE id = $2 AND user_id = $3',
        [index, id, req.user.id]
      );
    }

    await client.query('COMMIT');

    return res.status(200).json({ message: 'Order updated' });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
}

// ─── PUT /api/habits/:id ──────────────────────────────────────────────────────

async function updateHabit(req, res, next) {
  try {
    const { id } = req.params;

    // Verify ownership
    const existingResult = await db.query(
      'SELECT id FROM habits WHERE id = $1 AND user_id = $2',
      [id, req.user.id]
    );
    const existing = existingResult.rows[0];

    if (!existing) {
      return res.status(404).json({ error: 'Habit not found' });
    }

    const { name, emoji, frequency, sort_order } = req.body;

    // Build dynamic SET clause — only update provided fields
    const fields = [];
    const values = [];
    let placeholderIdx = 1;

    if (name !== undefined) {
      if (!name.trim()) return res.status(400).json({ error: 'Invalid value', message: 'name cannot be empty.' });
      fields.push(`name = $${placeholderIdx++}`);
      values.push(name.trim());
    }
    if (emoji !== undefined) {
      fields.push(`emoji = $${placeholderIdx++}`);
      values.push(emoji.trim());
    }
    if (frequency !== undefined) {
      const freq = parseInt(frequency, 10);
      if (isNaN(freq) || freq < 1 || freq > 7) {
        return res.status(400).json({ error: 'Invalid frequency', message: 'frequency must be between 1 and 7.' });
      }
      fields.push(`frequency = $${placeholderIdx++}`);
      values.push(freq);
    }
    if (sort_order !== undefined) {
      fields.push(`sort_order = $${placeholderIdx++}`);
      values.push(parseInt(sort_order, 10));
    }

    if (fields.length === 0) {
      return res.status(400).json({ error: 'No fields to update', message: 'Provide at least one of: name, emoji, frequency, sort_order.' });
    }

    values.push(id, req.user.id); // WHERE clause params
    const queryText = `UPDATE habits SET ${fields.join(', ')} WHERE id = $${placeholderIdx++} AND user_id = $${placeholderIdx++}`;
    
    await db.query(queryText, values);

    const updatedResult = await db.query(
      'SELECT id, name, emoji, frequency, sort_order, created_at FROM habits WHERE id = $1',
      [id]
    );
    const updated = updatedResult.rows[0];

    return res.status(200).json({ habit: updated });
  } catch (err) {
    next(err);
  }
}

// ─── DELETE /api/habits/:id ───────────────────────────────────────────────────

async function deleteHabit(req, res, next) {
  try {
    const { id } = req.params;

    const existingResult = await db.query(
      'SELECT id FROM habits WHERE id = $1 AND user_id = $2',
      [id, req.user.id]
    );
    const existing = existingResult.rows[0];

    if (!existing) {
      return res.status(404).json({ error: 'Habit not found' });
    }

    // Cascade in schema will also remove habit_logs rows
    await db.query(
      'DELETE FROM habits WHERE id = $1 AND user_id = $2',
      [id, req.user.id]
    );

    return res.status(200).json({ message: 'Habit deleted' });
  } catch (err) {
    next(err);
  }
}

module.exports = { getHabits, createHabit, reorderHabits, updateHabit, deleteHabit };
