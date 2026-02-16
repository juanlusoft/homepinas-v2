/**
 * HomePiNAS - Power Routes
 * v1.5.6 - Modular Architecture
 *
 * System power actions: reboot, shutdown, reset
 */

const express = require('express');
const router = express.Router();
const fs = require('fs');
const { execFile } = require('child_process');

const { requireAuth } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/rbac');
const { criticalLimiter } = require('../middleware/rateLimit');
const { logSecurityEvent } = require('../utils/security');
const { clearAllSessions } = require('../utils/session');
const { DATA_FILE } = require('../utils/data');

// System reset (authenticated - from dashboard)
router.post('/reset', requireAuth, requireAdmin, criticalLimiter, (req, res) => {
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

// Factory reset (public - from login page when locked out)
// Rate limited: 1 request per hour per IP
const factoryResetLimiter = require('express-rate-limit')({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 1,
    message: { error: 'Too many reset attempts. Try again in 1 hour.' }
});

router.post('/factory-reset', factoryResetLimiter, (req, res) => {
    try {
        logSecurityEvent('FACTORY_RESET', { source: 'login-page' }, req.ip);

        if (fs.existsSync(DATA_FILE)) {
            fs.unlinkSync(DATA_FILE);
        }

        // Clear all sessions from SQLite
        clearAllSessions();

        res.json({ success: true, message: 'Factory reset complete. Refresh to set up.' });
    } catch (e) {
        console.error('Factory reset error:', e);
        res.status(500).json({ error: 'Reset failed' });
    }
});

// System reboot
router.post('/reboot', requireAuth, requireAdmin, criticalLimiter, (req, res) => {
    logSecurityEvent('SYSTEM_REBOOT', { user: req.user.username }, req.ip);
    res.json({ success: true, message: 'Rebooting...' });

    setTimeout(() => {
        execFile('sudo', ['reboot'], (error) => {
            if (error) {
                console.error('Reboot failed:', error.message);
            }
        });
    }, 1000);
});

// System shutdown
router.post('/shutdown', requireAuth, requireAdmin, criticalLimiter, (req, res) => {
    logSecurityEvent('SYSTEM_SHUTDOWN', { user: req.user.username }, req.ip);
    res.json({ success: true, message: 'Shutting down...' });

    setTimeout(() => {
        execFile('sudo', ['shutdown', '-h', 'now'], (error) => {
            if (error) {
                console.error('Shutdown failed:', error.message);
            }
        });
    }, 1000);
});

module.exports = router;
