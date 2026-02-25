/**
 * HomePiNAS v2 - HomeStore Docker Status
 * Check Docker availability
 */
const express = require('express');
const router = express.Router();
const { requireAuth } = require('../../middleware/auth');
const { checkDocker } = require('./helpers');

/**
 * GET /check-docker - Check if Docker is available
 */
router.get('/check-docker', requireAuth, async (req, res) => {
    const available = await checkDocker();
    res.json({ success: true, available });
});

module.exports = router;
