/**
 * HomePiNAS v2 - HomeStore
 * App marketplace for Docker containers
 *
 * Modular structure:
 *   catalog.js   — Browse catalog and categories
 *   installed.js — List installed apps with stats
 *   app.js       — Get app details and config
 *   install.js   — Install, uninstall, update apps
 *   lifecycle.js — Start, stop, restart apps
 *   logs.js      — View container logs
 *   docker.js    — Docker availability check
 *   helpers.js   — Shared utilities
 */
const express = require('express');
const router = express.Router();
const { requireAuth } = require('../../middleware/auth');

// ── All routes require auth ──
router.use(requireAuth);

// ── Catalog ──
const catalogRouter = require('./catalog');
router.use('/', catalogRouter);

// ── Installed apps ──
const installedRouter = require('./installed');
router.use('/', installedRouter);

// ── App details ──
const appRouter = require('./app');
router.use('/', appRouter);

// ── Installation ──
const installRouter = require('./install');
router.use('/', installRouter);

// ── Lifecycle ──
const lifecycleRouter = require('./lifecycle');
router.use('/', lifecycleRouter);

// ── Logs ──
const logsRouter = require('./logs');
router.use('/', logsRouter);

// ── Docker status ──
const dockerRouter = require('./docker');
router.use('/', dockerRouter);

module.exports = router;
