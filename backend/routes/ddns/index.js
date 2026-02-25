/**
 * HomePiNAS v2 - Dynamic DNS
 * Configure and manage DDNS services (DuckDNS, No-IP, Cloudflare, Dynu)
 *
 * Modular structure:
 *   services.js  — CRUD operations for DDNS services
 *   status.js    — Public IP and service status
 *   update.js    — Force update a service
 *   scheduler.js — Background auto-updater (5min interval)
 *   helpers.js   — Provider updaters and utilities
 */
const express = require('express');
const router = express.Router();
const { requireAuth } = require('../../middleware/auth');

// Start background scheduler
require('./scheduler');

// ── All routes require auth ──
router.use(requireAuth);

// ── Services CRUD ──
const servicesRouter = require('./services');
router.use('/', servicesRouter);

// ── Status ──
const statusRouter = require('./status');
router.use('/', statusRouter);

// ── Force update ──
const updateRouter = require('./update');
router.use('/', updateRouter);

module.exports = router;
