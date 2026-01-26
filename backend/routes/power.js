/**
 * HomePiNAS - Power Routes
 * v1.5.6 - Modular Architecture
 *
 * System power actions: reboot, shutdown, reset
 */

const express = require('express');
const router = express.Router();
const fs = require('fs');
const { exec } = require('child_process');

const { requireAuth } = require('../middleware/auth');
const { criticalLimiter } = require('../middleware/rateLimit');
const { logSecurityEvent } = require('../utils/security');
const { clearAllSessions } = require('../utils/session');
const { DATA_FILE } = require('../utils/data');

// System reset
router.post('/reset', requireAuth, criticalLimiter, (req, res) => {
    try {
        logSecurityEvent('SYSTEM_RESET', { user: req.user.username }, req.ip);

        if (fs.existsSync(DATA_FILE)) {
            fs.unlinkSync(DATA_FILE);
        }

        // Clear all sessions from SQLite
        clearAllSessions();

        res.json({ success: true, message: 'System configuration reset' });
    } catch (e) {
        console.error('Reset error:', e);
        res.status(500).json({ error: 'Reset failed' });
    }
});

// System reboot
router.post('/reboot', requireAuth, criticalLimiter, (req, res) => {
    logSecurityEvent('SYSTEM_REBOOT', { user: req.user.username }, req.ip);
    res.json({ message: 'Rebooting...' });

    setTimeout(() => {
        exec('reboot', (error) => {
            if (error) {
                console.error('Reboot failed:', error.message);
            }
        });
    }, 1000);
});

// System shutdown
router.post('/shutdown', requireAuth, criticalLimiter, (req, res) => {
    logSecurityEvent('SYSTEM_SHUTDOWN', { user: req.user.username }, req.ip);
    res.json({ message: 'Shutting down...' });

    setTimeout(() => {
        exec('shutdown -h now', (error) => {
            if (error) {
                console.error('Shutdown failed:', error.message);
            }
        });
    }, 1000);
});

module.exports = router;
