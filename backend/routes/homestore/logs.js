/**
 * HomePiNAS v2 - HomeStore Logs
 * Retrieve container logs
 */
const express = require('express');
const router = express.Router();
const { execFile } = require('child_process');
const { requireAuth } = require('../../middleware/auth');
const { validateAppId } = require('./helpers');

/**
 * GET /logs/:id - Get app logs
 */
router.get('/logs/:id', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        if (!validateAppId(id)) {
            return res.status(400).json({ error: 'Invalid app ID' });
        }
        const lines = Math.min(Math.max(parseInt(req.query.lines) || 100, 1), 5000);

        const logs = await new Promise((resolve, reject) => {
            execFile('docker', ['logs', `homestore-${id}`, '--tail', String(lines)], (err, stdout, stderr) => {
                if (err) reject(new Error(err.message));
                else resolve(stdout + stderr);
            });
        });
        
        res.json({ success: true, logs });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
