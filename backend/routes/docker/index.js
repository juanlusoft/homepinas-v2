/**
 * HomePiNAS Docker - Main Router
 * Enhanced Docker Manager with compose support
 * 
 * Modular structure:
 *   containers.js  — Container CRUD, actions, notes, logs
 *   images.js      — Image updates and management
 *   compose.js     — Docker Compose stack management
 *   helpers.js     — Shared utilities
 */

const express = require('express');
const router = express.Router();
const { requireAuth } = require('../../middleware/auth');

// ══════════════════════════════════════════════════════════════════════════
// Import sub-routers
// ══════════════════════════════════════════════════════════════════════════

const containersRouter = require('./containers');
const imagesRouter = require('./images');
const composeRouter = require('./compose');

// ══════════════════════════════════════════════════════════════════════════
// Mount sub-routers
// ══════════════════════════════════════════════════════════════════════════

// All routes require authentication (mounted at sub-router level)
// Container management
router.use('/', containersRouter);

// Image management
router.use('/', imagesRouter);

// Compose management
router.use('/', composeRouter);

module.exports = router;
