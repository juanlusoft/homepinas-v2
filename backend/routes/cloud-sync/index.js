/**
 * HomePiNAS v2 - Cloud Sync
 * Syncthing-based file synchronization across devices
 *
 * Modular structure:
 *   status.js    — System status, device ID, QR, sync progress
 *   lifecycle.js — Install, start, stop Syncthing
 *   folders.js   — Shared folder management
 *   devices.js   — Device pairing and management
 *   helpers.js   — Syncthing API utilities
 */
const express = require('express');
const router = express.Router();
const { requireAuth } = require('../../middleware/auth');

// ── All routes require auth ──
router.use(requireAuth);

// ── Status ──
const statusRouter = require('./status');
router.use('/', statusRouter);

// ── Lifecycle ──
const lifecycleRouter = require('./lifecycle');
router.use('/', lifecycleRouter);

// ── Folders ──
const foldersRouter = require('./folders');
router.use('/', foldersRouter);

// ── Devices ──
const devicesRouter = require('./devices');
router.use('/', devicesRouter);

module.exports = router;
