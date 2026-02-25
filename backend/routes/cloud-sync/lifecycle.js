/**
 * HomePiNAS v2 - Cloud Sync Lifecycle
 * Install, start, stop Syncthing service
 */
const express = require('express');
const router = express.Router();
const { execFile } = require('child_process');
const { requireAuth } = require('../../middleware/auth');
const {
    SYSTEM_USER,
    isSyncthingInstalled,
    installSyncthing,
    resetApiKey
} = require('./helpers');

/**
 * POST /install - Install Syncthing
 */
router.post('/install', requireAuth, async (req, res) => {
    try {
        const installed = await isSyncthingInstalled();
        if (installed) {
            return res.json({ success: true, message: 'Syncthing already installed' });
        }
        
        await installSyncthing();
        
        // Wait for Syncthing to initialize
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        // Reset API key cache
        resetApiKey();
        
        res.json({ success: true, message: 'Syncthing installed and started' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

/**
 * POST /start - Start Syncthing service
 */
router.post('/start', requireAuth, async (req, res) => {
    try {
        await new Promise((resolve, reject) => {
            execFile('sudo', ['systemctl', 'start', `syncthing@${SYSTEM_USER}`], (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

/**
 * POST /stop - Stop Syncthing service
 */
router.post('/stop', requireAuth, async (req, res) => {
    try {
        await new Promise((resolve, reject) => {
            execFile('sudo', ['systemctl', 'stop', `syncthing@${SYSTEM_USER}`], (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

module.exports = router;
