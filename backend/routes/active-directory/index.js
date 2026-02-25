/**
 * HomePiNAS v2 - Active Directory Domain Controller
 * Samba AD DC management - Windows domain controller
 *
 * Modular structure:
 *   status.js    — Get AD DC status
 *   provision.js — Install and provision AD DC
 *   users.js     — AD user management (CRUD)
 *   groups.js    — AD group management and membership
 *   computers.js — List domain-joined computers
 *   service.js   — Service lifecycle (start/stop/restart)
 *   helpers.js   — Utilities and constants
 */
const express = require('express');
const router = express.Router();
const { requireAuth } = require('../../middleware/auth');
const { requireAdmin } = require('../../middleware/rbac');

// ── All routes require auth + admin ──
router.use(requireAuth);
router.use(requireAdmin);

// ── Status ──
const statusRouter = require('./status');
router.use('/', statusRouter);

// ── Provision ──
const provisionRouter = require('./provision');
router.use('/', provisionRouter);

// ── Users ──
const usersRouter = require('./users');
router.use('/', usersRouter);

// ── Groups ──
const groupsRouter = require('./groups');
router.use('/', groupsRouter);

// ── Computers ──
const computersRouter = require('./computers');
router.use('/', computersRouter);

// ── Service ──
const serviceRouter = require('./service');
router.use('/', serviceRouter);

module.exports = router;
