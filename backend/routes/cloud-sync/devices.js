/**
 * HomePiNAS v2 - Cloud Sync Devices
 * Manage connected devices
 */
const express = require('express');
const router = express.Router();
const { requireAuth } = require('../../middleware/auth');
const { syncthingApi } = require('./helpers');

/**
 * GET /devices - List connected devices
 */
router.get('/devices', requireAuth, async (req, res) => {
    try {
        const config = await syncthingApi('/rest/config');
        const connections = await syncthingApi('/rest/system/connections');
        const status = await syncthingApi('/rest/system/status');
        
        const devices = (config.devices || [])
            .filter(d => d.deviceID !== status.myID) // Exclude self
            .map(d => {
                const conn = connections.connections?.[d.deviceID] || {};
                return {
                    id: d.deviceID,
                    name: d.name || 'Unknown',
                    connected: conn.connected || false,
                    paused: d.paused || false,
                    address: conn.address || null,
                    lastSeen: conn.lastSeen || null,
                    inBytesTotal: conn.inBytesTotal || 0,
                    outBytesTotal: conn.outBytesTotal || 0
                };
            });
        
        res.json(devices);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

/**
 * POST /devices - Add a new device
 */
router.post('/devices', requireAuth, async (req, res) => {
    try {
        const { deviceId, name } = req.body;
        
        if (!deviceId) {
            return res.status(400).json({ error: 'Device ID is required' });
        }
        
        // Validate device ID format (7 groups of 7 chars separated by dashes)
        const deviceIdPattern = /^[A-Z0-9]{7}-[A-Z0-9]{7}-[A-Z0-9]{7}-[A-Z0-9]{7}-[A-Z0-9]{7}-[A-Z0-9]{7}-[A-Z0-9]{7}-[A-Z0-9]{7}$/;
        if (!deviceIdPattern.test(deviceId)) {
            return res.status(400).json({ error: 'Invalid device ID format' });
        }
        
        const config = await syncthingApi('/rest/config');
        
        // Check if device already exists
        if (config.devices?.some(d => d.deviceID === deviceId)) {
            return res.status(400).json({ error: 'Device already added' });
        }
        
        // Add device
        config.devices = config.devices || [];
        config.devices.push({
            deviceID: deviceId,
            name: name || 'New Device',
            addresses: ['dynamic'],
            compression: 'metadata',
            introducer: false,
            paused: false
        });
        
        await syncthingApi('/rest/config', 'PUT', config);
        
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

/**
 * DELETE /devices/:id - Remove a device
 */
router.delete('/devices/:id', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        
        const config = await syncthingApi('/rest/config');
        
        // Remove device
        config.devices = (config.devices || []).filter(d => d.deviceID !== id);
        
        // Remove device from all folders
        config.folders = (config.folders || []).map(f => ({
            ...f,
            devices: (f.devices || []).filter(d => d.deviceID !== id)
        }));
        
        await syncthingApi('/rest/config', 'PUT', config);
        
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

/**
 * POST /devices/:id/rename - Rename a device
 */
router.post('/devices/:id/rename', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const { name } = req.body;
        
        if (!name || !name.trim()) {
            return res.status(400).json({ error: 'Name is required' });
        }
        
        const config = await syncthingApi('/rest/config');
        
        const device = config.devices?.find(d => d.deviceID === id);
        if (!device) {
            return res.status(404).json({ error: 'Device not found' });
        }
        
        device.name = name.trim();
        
        await syncthingApi('/rest/config', 'PUT', config);
        
        res.json({ success: true, name: device.name });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

module.exports = router;
