/**
 * HomePiNAS Cloud Backup - Provider Management
 * Routes for managing cloud storage providers and remotes
 */

const express = require('express');
const router = express.Router();
const { execFileSync } = require('child_process');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');

const { requireAuth } = require('../../middleware/auth');
const {
    validateRemoteName,
    validateRclonePath,
    isRcloneInstalled,
    getRcloneVersion,
    listRemotes,
    getRemoteType,
    getRemoteInfo,
    getProviderFields
} = require('./helpers');

// Supported providers with display info
const PROVIDERS = {
    'drive': { name: 'Google Drive', icon: '📁', color: '#4285f4' },
    'dropbox': { name: 'Dropbox', icon: '📦', color: '#0061ff' },
    'onedrive': { name: 'Microsoft OneDrive', icon: '☁️', color: '#0078d4' },
    'mega': { name: 'MEGA', icon: '🔴', color: '#d9272e' },
    's3': { name: 'Amazon S3', icon: '🪣', color: '#ff9900' },
    'b2': { name: 'Backblaze B2', icon: '🔥', color: '#e21e29' },
    'pcloud': { name: 'pCloud', icon: '🌥️', color: '#00bcd4' },
    'box': { name: 'Box', icon: '📤', color: '#0061d5' },
    'sftp': { name: 'SFTP', icon: '🔐', color: '#4caf50' },
    'webdav': { name: 'WebDAV', icon: '🌐', color: '#607d8b' },
    'ftp': { name: 'FTP', icon: '📂', color: '#795548' },
    'nextcloud': { name: 'Nextcloud', icon: '☁️', color: '#0082c9' },
};

// ═══════════════════════════════════════════════════════════════════════════
// ROUTES
// ═══════════════════════════════════════════════════════════════════════════

// GET /status - Check rclone status
router.get('/status', requireAuth, (req, res) => {
    const installed = isRcloneInstalled();
    const version = installed ? getRcloneVersion() : null;
    const remotes = installed ? listRemotes() : [];
    
    res.json({
        installed,
        version,
        remotesCount: remotes.length,
        configPath: '/home/homepinas/.config/rclone/rclone.conf'
    });
});

// GET /providers - List available providers
router.get('/providers', requireAuth, (req, res) => {
    const providers = Object.entries(PROVIDERS).map(([id, info]) => ({
        id,
        ...info
    }));
    res.json({ providers });
});

// GET /remotes - List configured remotes with details
router.get('/remotes', requireAuth, async (req, res) => {
    try {
        const remoteNames = listRemotes();
        const remotes = [];
        
        for (const name of remoteNames) {
            const type = getRemoteType(name);
            const providerInfo = PROVIDERS[type] || { name: type, icon: '☁️', color: '#666' };
            
            remotes.push({
                name,
                type,
                displayName: providerInfo.name,
                icon: providerInfo.icon,
                color: providerInfo.color
            });
        }
        
        res.json({ remotes });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// GET /remotes/:name/about - Get remote space info
router.get('/remotes/:name/about', requireAuth, async (req, res) => {
    const { name } = req.params;
    
    try {
        const info = getRemoteInfo(name);
        if (info) {
            res.json({
                total: info.total,
                used: info.used,
                free: info.free,
                trashed: info.trashed || 0
            });
        } else {
            res.json({ total: null, used: null, free: null });
        }
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// GET /remotes/:name/ls - List files in remote
router.get('/remotes/:name/ls', requireAuth, async (req, res) => {
    const { name } = req.params;
    const remotePath = req.query.path || '';

    if (!validateRemoteName(name)) {
        return res.status(400).json({ error: 'Invalid remote name' });
    }

    try {
        const fullPath = remotePath ? `${name}:${remotePath}` : `${name}:`;
        const output = execFileSync('rclone', ['lsjson', fullPath, '--max-depth', '1'], {
            encoding: 'utf8',
            timeout: 60000
        });

        const items = JSON.parse(output);
        res.json({
            path: remotePath,
            items: items.map(item => ({
                name: item.Name,
                path: remotePath ? `${remotePath}/${item.Name}` : item.Name,
                isDir: item.IsDir,
                size: item.Size,
                modTime: item.ModTime,
                mimeType: item.MimeType
            }))
        });
    } catch (e) {
        res.status(500).json({ error: 'Failed to list remote files' });
    }
});

// POST /remotes/:name/delete - Delete a remote config
router.post('/remotes/:name/delete', requireAuth, async (req, res) => {
    const { name } = req.params;

    if (!validateRemoteName(name)) {
        return res.status(400).json({ error: 'Invalid remote name' });
    }

    try {
        execFileSync('rclone', ['config', 'delete', name], { encoding: 'utf8' });
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: 'Failed to delete remote' });
    }
});

// POST /config/create - Create new remote interactively
router.post('/config/create', requireAuth, async (req, res) => {
    const { provider, name } = req.body;
    
    if (!provider || !name) {
        return res.status(400).json({ error: 'Provider and name required' });
    }
    
    // Validate name (alphanumeric and underscore only)
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
        return res.status(400).json({ error: 'Invalid remote name. Use only letters, numbers, underscore, dash.' });
    }
    
    // Check if name already exists
    const existing = listRemotes();
    if (existing.includes(name)) {
        return res.status(400).json({ error: 'Remote with this name already exists' });
    }
    
    try {
        const simpleProviders = ['sftp', 'ftp', 'webdav', 's3', 'b2'];
        
        if (simpleProviders.includes(provider)) {
            // Return form fields needed for this provider
            const fields = getProviderFields(provider);
            res.json({ 
                needsOAuth: false,
                fields 
            });
        } else {
            // OAuth providers - need to run rclone authorize
            res.json({
                needsOAuth: true,
                instructions: `Para configurar ${PROVIDERS[provider]?.name || provider}, necesitas autorizar acceso:
                
1. En una terminal del NAS, ejecuta:
   rclone authorize "${provider}"
   
2. Se abrirá un navegador para autorizar
3. Copia el token que aparece
4. Pégalo en el siguiente paso`,
                provider
            });
        }
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// POST /config/save-simple - Save simple (non-OAuth) remote config
router.post('/config/save-simple', requireAuth, async (req, res) => {
    const { name, provider, config } = req.body;

    if (!name || !provider || !config) {
        return res.status(400).json({ error: 'Name, provider, and config required' });
    }

    if (!validateRemoteName(name)) {
        return res.status(400).json({ error: 'Invalid remote name' });
    }

    const validProviders = ['sftp', 'ftp', 'webdav', 's3', 'b2', 'drive', 'dropbox', 'onedrive', 'mega', 'pcloud', 'box', 'nextcloud'];
    if (!validProviders.includes(provider)) {
        return res.status(400).json({ error: 'Invalid provider' });
    }

    try {
        // Build args array safely (no shell interpolation)
        const args = ['config', 'create', name, provider];

        for (const [key, value] of Object.entries(config)) {
            if (value && /^[a-zA-Z0-9_]+$/.test(key)) {
                args.push(`${key}=${value}`);
            }
        }

        execFileSync('rclone', args, { encoding: 'utf8', timeout: 30000 });
        res.json({ success: true, name });
    } catch (e) {
        res.status(500).json({ error: 'Failed to create remote config' });
    }
});

// POST /config/save-oauth - Save OAuth remote with token
router.post('/config/save-oauth', requireAuth, async (req, res) => {
    const { name, provider, token } = req.body;

    if (!name || !provider || !token) {
        return res.status(400).json({ error: 'Name, provider, and token required' });
    }

    if (!validateRemoteName(name)) {
        return res.status(400).json({ error: 'Invalid remote name' });
    }

    try {
        execFileSync('rclone', ['config', 'create', name, provider, `token=${token}`], { encoding: 'utf8', timeout: 30000 });
        res.json({ success: true, name });
    } catch (e) {
        res.status(500).json({ error: 'Failed to create OAuth remote' });
    }
});

// POST /install - Install rclone
router.post('/install', requireAuth, async (req, res) => {
    try {
        console.log('Starting rclone installation...');

        // Detect architecture
        const arch = execFileSync('uname', ['-m'], { encoding: 'utf8' }).trim();
        let rcloneArch = 'amd64';
        if (arch === 'aarch64' || arch === 'arm64') rcloneArch = 'arm64';
        else if (arch.startsWith('arm')) rcloneArch = 'arm';

        // Validate rcloneArch is one of expected values
        if (!['amd64', 'arm64', 'arm'].includes(rcloneArch)) {
            return res.status(500).json({ error: 'Unsupported architecture' });
        }

        console.log(`Detected architecture: ${arch} -> rclone arch: ${rcloneArch}`);

        const tmpDir = `/mnt/storage/.tmp/rclone-install-${crypto.randomBytes(8).toString('hex')}`;
        fs.mkdirSync(tmpDir, { recursive: true });

        const downloadUrl = `https://downloads.rclone.org/rclone-current-linux-${rcloneArch}.zip`;
        console.log(`Downloading from: ${downloadUrl}`);

        execFileSync('curl', ['-fsSL', downloadUrl, '-o', path.join(tmpDir, 'rclone.zip')], {
            encoding: 'utf8',
            timeout: 60000
        });

        execFileSync('unzip', ['-o', path.join(tmpDir, 'rclone.zip'), '-d', tmpDir], { encoding: 'utf8' });

        // Find extracted directory
        const entries = fs.readdirSync(tmpDir).filter(e =>
            e.startsWith('rclone-') && fs.statSync(path.join(tmpDir, e)).isDirectory()
        );
        if (entries.length === 0) throw new Error('Extracted rclone directory not found');

        const rcloneBin = path.join(tmpDir, entries[0], 'rclone');
        execFileSync('sudo', ['cp', rcloneBin, '/usr/local/bin/rclone'], { encoding: 'utf8' });
        execFileSync('sudo', ['chmod', '755', '/usr/local/bin/rclone'], { encoding: 'utf8' });

        // Cleanup
        fs.rmSync(tmpDir, { recursive: true, force: true });

        const version = getRcloneVersion();
        console.log(`rclone installed: ${version}`);

        if (version) {
            res.json({ success: true, version });
        } else {
            throw new Error('Installation completed but rclone not found');
        }
    } catch (e) {
        console.error('rclone install error:', e.message);
        res.status(500).json({ error: 'Failed to install rclone' });
    }
});

module.exports = router;
