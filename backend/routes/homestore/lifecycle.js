/**
 * HomePiNAS v2 - HomeStore Lifecycle Management
 * Start, stop, restart apps
 */
const express = require('express');
const router = express.Router();
const { execFile } = require('child_process');
const { requireAuth } = require('../../middleware/auth');
const { validateAppId } = require('./helpers');

/**
 * POST /start/:id - Start an app
 */
router.post('/start/:id', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        if (!validateAppId(id)) {
            return res.status(400).json({ error: 'Invalid app ID' });
        }

        await new Promise((resolve, reject) => {
            execFile('docker', ['start', `homestore-${id}`], (err, stdout, stderr) => {
                if (err) reject(new Error(stderr || err.message));
                else resolve();
            });
        });
        
        res.json({ success: true, message: 'App started' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /stop/:id - Stop an app
 */
router.post('/stop/:id', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        if (!validateAppId(id)) {
            return res.status(400).json({ error: 'Invalid app ID' });
        }

        await new Promise((resolve, reject) => {
            execFile('docker', ['stop', `homestore-${id}`], (err, stdout, stderr) => {
                if (err) reject(new Error(stderr || err.message));
                else resolve();
            });
        });
        
        res.json({ success: true, message: 'App stopped' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /restart/:id - Restart an app
 */
router.post('/restart/:id', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        if (!validateAppId(id)) {
            return res.status(400).json({ error: 'Invalid app ID' });
        }

        await new Promise((resolve, reject) => {
            execFile('docker', ['restart', `homestore-${id}`], (err, stdout, stderr) => {
                if (err) reject(new Error(stderr || err.message));
                else resolve();
            });
        });
        
        res.json({ success: true, message: 'App restarted' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
