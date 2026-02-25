/**
 * HomePiNAS v2 - Active Directory Status
 * Get AD DC status
 */
const express = require('express');
const router = express.Router();
const { requireAuth } = require('../../middleware/auth');
const { requireAdmin } = require('../../middleware/rbac');
const { getADStatus } = require('./helpers');

router.get('/status', requireAuth, requireAdmin, async (req, res) => {
    try {
        const status = await getADStatus();
        res.json(status);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
