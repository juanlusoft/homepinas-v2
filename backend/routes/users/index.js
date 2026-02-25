/**
 * HomePiNAS v2 - User Management
 * Multi-user system with roles: admin, user, readonly
 *
 * Modular structure:
 *   me.js      — Current user operations (GET /me, PUT /me/password)
 *   admin.js   — Admin operations (list, create, update, delete users)
 *   helpers.js — Utilities and Samba integration
 */
const express = require('express');
const router = express.Router();
const { requireAuth } = require('../../middleware/auth');

// ── All routes require auth ──
router.use(requireAuth);

// ── Current user operations (must be before admin routes to avoid param conflict) ──
const meRouter = require('./me');
router.use('/', meRouter);

// ── Admin operations ──
const adminRouter = require('./admin');
router.use('/', adminRouter);

module.exports = router;
