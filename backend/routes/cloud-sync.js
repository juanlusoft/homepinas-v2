const express = require('express');
const router = express.Router();
const { exec, spawn } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
const https = require('https');
const http = require('http');

// Syncthing configuration (check multiple possible locations)
// Get current system user (for syncthing service)
const SYSTEM_USER = process.env.USER || process.env.LOGNAME || 'homepinas';
const HOME_DIR = process.env.HOME || `/home/${SYSTEM_USER}`;

const SYNCTHING_CONFIG_DIRS = [
    `${HOME_DIR}/.local/state/syncthing`,
    `${HOME_DIR}/.config/syncthing`,
    '/var/lib/syncthing/.config/syncthing'
];
const SYNCTHING_API_URL = 'http://127.0.0.1:8384';
const STORAGE_BASE = '/mnt/storage';

let syncthingApiKey = null;

// Helper: Get Syncthing API key from config
async function getApiKey() {
    if (syncthingApiKey) return syncthingApiKey;
    
    for (const configDir of SYNCTHING_CONFIG_DIRS) {
        try {
            const configPath = path.join(configDir, 'config.xml');
            const configXml = await fs.readFile(configPath, 'utf8');
            const match = configXml.match(/<apikey>([^<]+)<\/apikey>/);
            if (match) {
                syncthingApiKey = match[1];
                console.log('Found Syncthing API key in:', configDir);
                return syncthingApiKey;
            }
        } catch (e) {
            // Try next location
        }
    }
    console.error('Failed to find Syncthing API key in any location');
    return null;
}

// Helper: Make Syncthing API request
async function syncthingApi(endpoint, method = 'GET', body = null) {
    const apiKey = await getApiKey();
    if (!apiKey) throw new Error('Syncthing API key not available');
    
    return new Promise((resolve, reject) => {
        const url = new URL(endpoint, SYNCTHING_API_URL);
        const options = {
            hostname: url.hostname,
            port: url.port,
            path: url.pathname + url.search,
            method,
            headers: {
                'X-API-Key': apiKey,
                'Content-Type': 'application/json'
            }
        };
        
        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch {
                    resolve(data);
                }
            });
        });
        
        req.on('error', reject);
        if (body) req.write(JSON.stringify(body));
        req.end();
    });
}

// Helper: Check if Syncthing is installed
async function isSyncthingInstalled() {
    return new Promise((resolve) => {
        exec('which syncthing', (err) => resolve(!err));
    });
}

// Helper: Check if Syncthing service is running
async function isSyncthingRunning() {
    return new Promise((resolve) => {
        exec(`systemctl is-active syncthing@${SYSTEM_USER}`, (err, stdout) => {
            resolve(stdout.trim() === 'active');
        });
    });
}

// Helper: Install Syncthing
async function installSyncthing() {
    return new Promise((resolve, reject) => {
        const commands = [
            // Add Syncthing release PGP keys
            'curl -fsSL https://syncthing.net/release-key.gpg | sudo gpg --dearmor -o /usr/share/keyrings/syncthing-archive-keyring.gpg',
            // Add stable channel to APT sources
            'echo "deb [signed-by=/usr/share/keyrings/syncthing-archive-keyring.gpg] https://apt.syncthing.net/ syncthing stable" | sudo tee /etc/apt/sources.list.d/syncthing.list',
            // Update and install
            'sudo apt-get update',
            'sudo apt-get install -y syncthing',
            // Enable and start service for current user
            `sudo systemctl enable syncthing@${SYSTEM_USER}`,
            `sudo systemctl start syncthing@${SYSTEM_USER}`
        ];
        
        exec(commands.join(' && '), { timeout: 300000 }, (err, stdout, stderr) => {
            if (err) reject(new Error(stderr || err.message));
            else resolve(stdout);
        });
    });
}

// GET /cloud-sync/status - Get Syncthing status
router.get('/status', async (req, res) => {
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
                status.folders = (config.folders || []).map(f => ({
                    id: f.id,
                    label: f.label || f.id,
                    path: f.path,
                    paused: f.paused,
                    devices: f.devices?.length || 0
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

// POST /cloud-sync/install - Install Syncthing
router.post('/install', async (req, res) => {
    try {
        const installed = await isSyncthingInstalled();
        if (installed) {
            return res.json({ success: true, message: 'Syncthing already installed' });
        }
        
        await installSyncthing();
        
        // Wait for Syncthing to initialize
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        // Reset API key cache
        syncthingApiKey = null;
        
        res.json({ success: true, message: 'Syncthing installed and started' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// POST /cloud-sync/start - Start Syncthing service
router.post('/start', async (req, res) => {
    try {
        await new Promise((resolve, reject) => {
            exec(`sudo systemctl start syncthing@${SYSTEM_USER}`, (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// POST /cloud-sync/stop - Stop Syncthing service
router.post('/stop', async (req, res) => {
    try {
        await new Promise((resolve, reject) => {
            exec(`sudo systemctl stop syncthing@${SYSTEM_USER}`, (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// GET /cloud-sync/device-id - Get this device's ID for pairing
router.get('/device-id', async (req, res) => {
    try {
        const status = await syncthingApi('/rest/system/status');
        res.json({ deviceId: status.myID });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// GET /cloud-sync/folders - List shared folders
router.get('/folders', async (req, res) => {
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

// POST /cloud-sync/folders - Add a new shared folder
router.post('/folders', async (req, res) => {
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

// DELETE /cloud-sync/folders/:id - Remove a shared folder
router.delete('/folders/:id', async (req, res) => {
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

// GET /cloud-sync/devices - List connected devices
router.get('/devices', async (req, res) => {
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

// POST /cloud-sync/devices - Add a new device
router.post('/devices', async (req, res) => {
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

// DELETE /cloud-sync/devices/:id - Remove a device
router.delete('/devices/:id', async (req, res) => {
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

// POST /cloud-sync/folders/:id/share - Share folder with a device
router.post('/folders/:id/share', async (req, res) => {
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

// GET /cloud-sync/qr - Generate QR code data for device pairing
router.get('/qr', async (req, res) => {
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

// GET /cloud-sync/sync-status - Get detailed sync status for all folders
router.get('/sync-status', async (req, res) => {
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
