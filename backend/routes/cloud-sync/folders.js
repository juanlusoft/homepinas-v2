/**
 * HomePiNAS v2 - Cloud Sync Folders
 * Manage shared folders
 */
const express = require('express');
const router = express.Router();
const fs = require('fs').promises;
const path = require('path');
const { requireAuth } = require('../../middleware/auth');
const { syncthingApi, STORAGE_BASE } = require('./helpers');

/**
 * GET /folders - List shared folders
 */
router.get('/folders', requireAuth, async (req, res) => {
    try {
        const config = await syncthingApi('/rest/config');
        const folderStats = await syncthingApi('/rest/stats/folder');
        
        const folders = (config.folders || []).map(f => {
            const stats = folderStats[f.id] || {};
            return {
                id: f.id,
                label: f.label || f.id,
                path: f.path,
                paused: f.paused,
                type: f.type, // sendreceive, sendonly, receiveonly
                devices: (f.devices || []).map(d => d.deviceID),
                lastScan: stats.lastScan,
                lastFile: stats.lastFile
            };
        });
        
        res.json(folders);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

/**
 * POST /folders - Add a new shared folder
 */
router.post('/folders', requireAuth, async (req, res) => {
    try {
        const { path: folderPath, label, type = 'sendreceive' } = req.body;
        
        if (!folderPath) {
            return res.status(400).json({ error: 'Path is required' });
        }
        
        // Ensure path is under storage
        const fullPath = folderPath.startsWith('/') ? folderPath : path.join(STORAGE_BASE, folderPath);
        if (!fullPath.startsWith(STORAGE_BASE)) {
            return res.status(400).json({ error: 'Path must be under /mnt/storage' });
        }
        
        // Create folder if it doesn't exist
        await fs.mkdir(fullPath, { recursive: true });
        
        // Generate folder ID
        const folderId = `homepinas-${Date.now()}`;
        
        // Get current config
        const config = await syncthingApi('/rest/config');
        
        // Get this device's ID
        const status = await syncthingApi('/rest/system/status');
        
        // Add new folder
        config.folders = config.folders || [];
        config.folders.push({
            id: folderId,
            label: label || path.basename(fullPath),
            path: fullPath,
            type,
            rescanIntervalS: 60,
            fsWatcherEnabled: true,
            fsWatcherDelayS: 10,
            devices: [{ deviceID: status.myID }]
        });
        
        // Save config
        await syncthingApi('/rest/config', 'PUT', config);
        
        res.json({ success: true, folderId, path: fullPath });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

/**
 * DELETE /folders/:id - Remove a shared folder
 */
router.delete('/folders/:id', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        
        const config = await syncthingApi('/rest/config');
        config.folders = (config.folders || []).filter(f => f.id !== id);
        
        await syncthingApi('/rest/config', 'PUT', config);
        
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

/**
 * POST /folders/:id/share - Share folder with a device
 */
router.post('/folders/:id/share', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const { deviceId } = req.body;
        
        if (!deviceId) {
            return res.status(400).json({ error: 'Device ID is required' });
        }
        
        const config = await syncthingApi('/rest/config');
        
        const folder = config.folders?.find(f => f.id === id);
        if (!folder) {
            return res.status(404).json({ error: 'Folder not found' });
        }
        
        // Check if device exists
        if (!config.devices?.some(d => d.deviceID === deviceId)) {
            return res.status(400).json({ error: 'Device not found' });
        }
        
        // Add device to folder if not already shared
        folder.devices = folder.devices || [];
        if (!folder.devices.some(d => d.deviceID === deviceId)) {
            folder.devices.push({ deviceID: deviceId });
        }
        
        await syncthingApi('/rest/config', 'PUT', config);
        
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

/**
 * POST /folders/:id/pause - Pause/resume folder sync
 */
router.post('/folders/:id/pause', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const { paused } = req.body;
        
        const config = await syncthingApi('/rest/config');
        
        const folder = config.folders?.find(f => f.id === id);
        if (!folder) {
            return res.status(404).json({ error: 'Folder not found' });
        }
        
        folder.paused = !!paused;
        
        await syncthingApi('/rest/config', 'PUT', config);
        
        res.json({ success: true, paused: folder.paused });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

module.exports = router;
