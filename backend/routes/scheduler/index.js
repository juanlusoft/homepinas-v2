/**
 * HomePiNAS v2 - Task Scheduler (Cron Manager)
 * Manage system cron jobs through the dashboard
 *
 * Modular structure:
 *   tasks.js      — CRUD operations for scheduled tasks
 *   operations.js — Run, toggle, view crontab
 *   helpers.js    — Validation and crontab generation
 */
const express = require('express');
const router = express.Router();
const { requireAuth } = require('../../middleware/auth');

// ── All routes require auth ──
router.use(requireAuth);

// ── Tasks CRUD ──
const tasksRouter = require('./tasks');
router.use('/', tasksRouter);

// ── Operations ──
const operationsRouter = require('./operations');
router.use('/', operationsRouter);

module.exports = router;
