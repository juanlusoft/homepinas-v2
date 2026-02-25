/**
 * HomePiNAS v2 - Cloud Sync Status
 * Syncthing status, device ID, QR, and sync progress
 */
const express = require('express');
const router = express.Router();
const { requireAuth } = require('../../middleware/auth');
const {
    syncthingApi,
    isSyncthingInstalled,
    isSyncthingRunning
} = require('./helpers');

/**
 * GET /status - Get Syncthing status
 */
router.get('/status', requireAuth, async (req, res) => {
    try {
        const installed = await isSyncthingInstalled();
        const running = installed ? await isSyncthingRunning() : false;
        
        let status = {
            installed,
            running,
            version: null,
            deviceId: null,
            connections: 0,
            folders: []
        };
        
        if (running) {
            try {
                // Get system status
                const sysStatus = await syncthingApi('/rest/system/status');
                status.deviceId = sysStatus.myID;
                
                // Get version
                const version = await syncthingApi('/rest/system/version');
                status.version = version.version;
                
                // Get connections
                const connections = await syncthingApi('/rest/system/connections');
                status.connections = Object.keys(connections.connections || {}).filter(
                    id => connections.connections[id].connected
                ).length;
                
                // Get folders
                const config = await syncthingApi('/rest/config');
                const myID = sysStatus.myID;
                status.folders = (config.folders || []).map(f => ({
                    id: f.id,
                    label: f.label || f.id,
                    path: f.path,
                    paused: f.paused,
                    devices: (f.devices || []).filter(d => d.deviceID !== myID).length,
                    deviceIds: (f.devices || []).filter(d => d.deviceID !== myID).map(d => d.deviceID)
                }));
                
            } catch (e) {
                console.error('Syncthing API error:', e.message);
            }
        }
        
        res.json(status);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

/**
 * GET /device-id - Get this device's ID for pairing
 */
router.get('/device-id', requireAuth, async (req, res) => {
    try {
        const status = await syncthingApi('/rest/system/status');
        res.json({ deviceId: status.myID });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

/**
 * GET /qr - Generate QR code data for device pairing
 */
router.get('/qr', requireAuth, async (req, res) => {
    try {
        const status = await syncthingApi('/rest/system/status');
        
        // QR contains the device ID which can be scanned by Syncthing app
        const qrData = status.myID;
        
        res.json({ 
            deviceId: status.myID,
            qrData: qrData
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

/**
 * GET /sync-status - Get detailed sync status for all folders
 */
router.get('/sync-status', requireAuth, async (req, res) => {
    try {
        const config = await syncthingApi('/rest/config');
        const folders = config.folders || [];
        
        const statuses = await Promise.all(folders.map(async (f) => {
            try {
                const status = await syncthingApi(`/rest/db/status?folder=${encodeURIComponent(f.id)}`);
                return {
                    id: f.id,
                    label: f.label || f.id,
                    state: status.state,
                    globalFiles: status.globalFiles,
                    globalBytes: status.globalBytes,
                    localFiles: status.localFiles,
                    localBytes: status.localBytes,
                    needFiles: status.needFiles,
                    needBytes: status.needBytes,
                    completion: status.globalBytes > 0 
                        ? Math.round((status.localBytes / status.globalBytes) * 100) 
                        : 100
                };
            } catch (e) {
                return {
                    id: f.id,
                    label: f.label || f.id,
                    state: 'error',
                    error: e.message
                };
            }
        }));
        
        res.json(statuses);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

module.exports = router;
