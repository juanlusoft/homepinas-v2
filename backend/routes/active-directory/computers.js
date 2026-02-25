/**
 * HomePiNAS v2 - Active Directory Computers
 * List domain-joined computers
 */
const express = require('express');
const router = express.Router();
const { requireAuth } = require('../../middleware/auth');
const { requireAdmin } = require('../../middleware/rbac');
const { execFileAsync, getADStatus } = require('./helpers');

router.get('/computers', requireAuth, requireAdmin, async (req, res) => {
    try {
        const status = await getADStatus();
        if (!status.provisioned || !status.running) {
            return res.status(400).json({ error: 'AD DC not running' });
        }

        const { stdout } = await execFileAsync('sudo', ['samba-tool', 'computer', 'list']);
        const computers = stdout.trim().split('\n').filter(c => c);

        res.json(computers.map(name => ({ name })));
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
