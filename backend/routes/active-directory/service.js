/**
 * HomePiNAS v2 - Active Directory Service Control
 * Start, stop, restart AD DC service
 */
const express = require('express');
const router = express.Router();
const { requireAuth } = require('../../middleware/auth');
const { requireAdmin } = require('../../middleware/rbac');
const { execFileAsync, getADStatus } = require('./helpers');

router.post('/service/:action', requireAuth, requireAdmin, async (req, res) => {
    try {
        const { action } = req.params;

        if (!['start', 'stop', 'restart'].includes(action)) {
            return res.status(400).json({ error: 'Invalid action. Use start, stop, or restart' });
        }

        const status = await getADStatus();
        if (!status.provisioned) {
            return res.status(400).json({ error: 'AD DC not provisioned' });
        }

        await execFileAsync('sudo', ['systemctl', action, 'samba-ad-dc']);

        res.json({ success: true, message: `AD DC service ${action}ed` });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
