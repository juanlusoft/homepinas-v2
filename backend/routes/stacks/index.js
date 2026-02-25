/**
 * HomePiNAS v2 - Docker Stacks
 * Manage multi-container applications with docker-compose
 *
 * Modular structure:
 *   templates.js  — Predefined stack templates (LAMP, LEMP, WordPress)
 *   crud.js       — List, create, get, update, delete stacks
 *   operations.js — Start, stop, restart, pull, logs
 *   helpers.js    — Utilities and constants
 */
const express = require('express');
const router = express.Router();
const { requireAuth } = require('../../middleware/auth');

// ── All routes require auth ──
router.use(requireAuth);

// ── Templates ──
const templatesRouter = require('./templates');
router.use('/', templatesRouter);

// ── CRUD operations ──
const crudRouter = require('./crud');
router.use('/', crudRouter);

// ── Stack operations ──
const operationsRouter = require('./operations');
router.use('/', operationsRouter);

module.exports = router;
