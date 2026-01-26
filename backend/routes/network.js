/**
 * HomePiNAS - Network Routes
 * v1.5.6 - Modular Architecture
 *
 * Network interface management
 */

const express = require('express');
const router = express.Router();
const si = require('systeminformation');

const { requireAuth } = require('../middleware/auth');
const { logSecurityEvent } = require('../utils/security');

// Get network interfaces
router.get('/interfaces', async (req, res) => {
    try {
        const netInterfaces = await si.networkInterfaces();
        res.json(netInterfaces.map(iface => ({
            id: iface.iface,
            name: iface.ifaceName || iface.iface,
            ip: iface.ip4,
            subnet: iface.ip4subnet,
            dhcp: iface.dhcp,
            status: iface.operstate === 'up' ? 'connected' : 'disconnected'
        })));
    } catch (e) {
        res.status(500).json({ error: 'Failed to read network interfaces' });
    }
});

// Configure network interface
router.post('/configure', requireAuth, (req, res) => {
    try {
        const { id, config } = req.body;

        if (!id || typeof id !== 'string') {
            return res.status(400).json({ error: 'Invalid interface ID' });
        }

        if (!config || typeof config !== 'object') {
            return res.status(400).json({ error: 'Invalid configuration' });
        }

        const ipRegex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
        if (config.ip && !ipRegex.test(config.ip)) {
            return res.status(400).json({ error: 'Invalid IP address format' });
        }

        if (config.subnet && !ipRegex.test(config.subnet)) {
            return res.status(400).json({ error: 'Invalid subnet mask format' });
        }

        logSecurityEvent('NETWORK_CONFIG', { user: req.user.username, interface: id }, req.ip);

        // In a real scenario, this would trigger shell scripts to edit netplan/nmcli
        res.json({ success: true, message: `Config for ${id} received (Hardware apply pending)` });
    } catch (e) {
        console.error('Network config error:', e);
        res.status(500).json({ error: 'Failed to configure network' });
    }
});

module.exports = router;
