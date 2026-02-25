/**
 * HomePiNAS - Storage Routes (Modular)
 * v1.6.0 - Split from monolithic storage.js
 * 
 * Structure:
 *   index.js     - Main router (this file)
 *   pool.js      - Pool status and configuration
 *   snapraid.js  - SnapRAID operations (sync, scrub, status)
 *   disks.js     - Disk management (detect, add, remove, mount, ignore)
 *   helpers.js   - Shared utilities
 *   systemd.js   - Systemd mount unit management
 *   config.js    - Legacy config endpoint
 */

const express = require('express');
const router = express.Router();
const { requireAuth } = require('../../middleware/auth');

// ══════════════════════════════════════════════════════════════════════════
// Import sub-routers
// ══════════════════════════════════════════════════════════════════════════

const poolRouter = require('./pool');
const snapraidRouter = require('./snapraid');
const disksRouter = require('./disks');
const configRouter = require('./config');

// ══════════════════════════════════════════════════════════════════════════
// Mount sub-routers
// ══════════════════════════════════════════════════════════════════════════

// Pool management
router.use('/pool', poolRouter);

// SnapRAID operations
router.use('/snapraid', snapraidRouter);

// Disk management
router.use('/disks', disksRouter);

// Legacy config endpoint (backward compat)
router.use('/', configRouter);

module.exports = router;
