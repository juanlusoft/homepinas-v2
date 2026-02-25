/**
 * HomePiNAS Cloud Backup - Main Router
 * rclone integration for 40+ cloud services
 * 
 * Modular structure:
 *   providers.js  — Provider/remote management, install, config
 *   jobs.js       — Sync operations, job tracking, schedules
 *   helpers.js    — Shared utilities and validation
 */

const express = require('express');
const router = express.Router();
const { requireAuth } = require('../../middleware/auth');

// ══════════════════════════════════════════════════════════════════════════
// Import sub-routers
// ══════════════════════════════════════════════════════════════════════════

const providersRouter = require('./providers');
const jobsRouter = require('./jobs');

// ══════════════════════════════════════════════════════════════════════════
// Mount sub-routers
// ══════════════════════════════════════════════════════════════════════════

// Provider and remote management
router.use('/', providersRouter);

// Job and sync management
router.use('/', jobsRouter);

module.exports = router;
