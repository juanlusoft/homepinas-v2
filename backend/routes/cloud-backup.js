/**
 * HomePiNAS Cloud Backup - rclone integration
 * Supports 40+ cloud services: Google Drive, Dropbox, OneDrive, S3, etc.
 */

const express = require('express');
const router = express.Router();
const { execFileSync, execFile, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// Auth middleware
const { requireAuth } = require('../middleware/auth');

// Config paths
const RCLONE_CONFIG = '/home/homepinas/.config/rclone/rclone.conf';
const RCLONE_BIN = '/usr/bin/rclone';

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

// Validation: remote name must be alphanumeric/underscore/dash
function validateRemoteName(name) {
    if (!name || typeof name !== 'string') return false;
    return /^[a-zA-Z0-9_-]+$/.test(name);
}

// Validation: rclone path must not contain shell metacharacters
function validateRclonePath(p) {
    if (!p || typeof p !== 'string') return false;
    if (/[;|&$`\\<>(){}!#\n\r]/.test(p)) return false;
    return true;
}

// Helper: Check if rclone is installed
function isRcloneInstalled() {
    try {
        execFileSync('which', ['rclone'], { encoding: 'utf8' });
        return true;
    } catch {
        return false;
    }
}

// Helper: Get rclone version
function getRcloneVersion() {
    try {
        const output = execFileSync('rclone', ['version'], { encoding: 'utf8', timeout: 10000 });
        const match = output.match(/rclone v([\d.]+)/);
        return match ? match[1] : null;
    } catch {
        return null;
    }
}

// Helper: List configured remotes
function listRemotes() {
    try {
        const output = execFileSync('rclone', ['listremotes'], { encoding: 'utf8', timeout: 10000 });
        return output.trim().split('\n').filter(Boolean).map(r => r.replace(':', ''));
    } catch {
        return [];
    }
}

// Helper: Get remote type
function getRemoteType(remoteName) {
    if (!validateRemoteName(remoteName)) return 'unknown';
    try {
        const output = execFileSync('rclone', ['config', 'show', remoteName], { encoding: 'utf8', timeout: 10000 });
        const match = output.match(/type\s*=\s*(\w+)/);
        return match ? match[1] : 'unknown';
    } catch {
        return 'unknown';
    }
}

// Helper: Get remote info
function getRemoteInfo(remoteName) {
    if (!validateRemoteName(remoteName)) return null;
    try {
        const output = execFileSync('rclone', ['about', `${remoteName}:`, '--json'], { encoding: 'utf8', timeout: 30000 });
        return JSON.parse(output);
    } catch {
        return null;
    }
}

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
        configPath: RCLONE_CONFIG
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
// This starts the rclone config process and returns a session ID
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
        // For OAuth-based providers, we need to use rclone authorize
        // For simple providers (sftp, ftp, webdav), we can configure directly
        
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

// Helper: Load transfer history
function loadTransferHistory() {
    const historyPath = '/opt/homepinas/backend/data/transfer-history.json';
    try {
        if (fs.existsSync(historyPath)) {
            return JSON.parse(fs.readFileSync(historyPath, 'utf8'));
        }
    } catch (e) {
        console.error('Error loading transfer history:', e);
    }
    return [];
}

// Helper: Save transfer history
function saveTransferHistory(history) {
    const historyPath = '/opt/homepinas/backend/data/transfer-history.json';
    try {
        // Keep only last 100 entries
        const trimmed = history.slice(-100);
        fs.writeFileSync(historyPath, JSON.stringify(trimmed, null, 2));
    } catch (e) {
        console.error('Error saving transfer history:', e);
    }
}

// Helper: Add transfer to history
function logTransfer(transfer) {
    const history = loadTransferHistory();
    history.push({
        ...transfer,
        timestamp: new Date().toISOString()
    });
    saveTransferHistory(history);
}

// POST /sync - Start sync operation
router.post('/sync', requireAuth, async (req, res) => {
    const { source, dest, mode = 'copy', deleteFiles = false } = req.body;

    if (!source || !dest) {
        return res.status(400).json({ error: 'Source and destination required' });
    }

    if (!validateRclonePath(source) || !validateRclonePath(dest)) {
        return res.status(400).json({ error: 'Invalid source or destination path' });
    }

    const validModes = ['sync', 'copy', 'move'];
    const selectedMode = validModes.includes(mode) ? mode : 'copy';

    try {
        // Build args array safely
        const args = [selectedMode, source, dest, '--progress', '--stats-one-line'];
        if (selectedMode === 'sync' && deleteFiles) {
            args.push('--delete-during');
        }

        const jobId = crypto.randomBytes(8).toString('hex');
        const logFile = `/mnt/storage/.tmp/rclone-job-${jobId}.log`;

        // Create dest directory if local path
        if (!dest.includes(':')) {
            fs.mkdirSync(dest, { recursive: true });
        }

        // Log start of transfer
        logTransfer({
            id: jobId,
            source,
            dest,
            mode: selectedMode,
            status: 'running'
        });

        // Run in background using spawn (no shell)
        const logFd = fs.openSync(logFile, 'w');
        const child = spawn('rclone', args, {
            stdio: ['ignore', logFd, logFd],
            detached: true
        });
        child.unref();
        fs.closeSync(logFd);

        child.on('close', (code) => {
            const status = code !== 0 ? 'failed' : 'completed';
            const history = loadTransferHistory();
            const idx = history.findIndex(t => t.id === jobId);
            if (idx !== -1) {
                history[idx].status = status;
                history[idx].completedAt = new Date().toISOString();
                if (code !== 0) history[idx].error = `Exit code ${code}`;
                saveTransferHistory(history);
            }
        });

        res.json({
            success: true,
            jobId,
            message: 'Sync started in background'
        });
    } catch (e) {
        res.status(500).json({ error: 'Failed to start sync' });
    }
});

// GET /jobs/active - Get all active sync jobs
router.get('/jobs/active', requireAuth, (req, res) => {
    try {
        const history = loadTransferHistory();
        const activeJobs = history.filter(t => t.status === 'running');
        
        // Get progress for each active job
        const jobsWithProgress = activeJobs.map(job => {
            const logFile = `/mnt/storage/.tmp/rclone-job-${job.id}.log`;
            let lastLine = '';
            let percent = 0;
            
            try {
                if (fs.existsSync(logFile)) {
                    const log = fs.readFileSync(logFile, 'utf8');
                    const lines = log.trim().split('\n');
                    lastLine = lines[lines.length - 1] || '';
                    
                    // Extract percentage
                    const percentMatch = lastLine.match(/(\d+)%/);
                    if (percentMatch) percent = parseInt(percentMatch[1]);
                }
            } catch (e) {
                // Ignore read errors
            }
            
            return {
                ...job,
                lastLine,
                percent
            };
        });
        
        res.json({ jobs: jobsWithProgress });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// GET /jobs/:id - Get job status
router.get('/jobs/:id', requireAuth, (req, res) => {
    const { id } = req.params;
    if (!/^[a-zA-Z0-9]+$/.test(id)) {
        return res.status(400).json({ error: 'Invalid job ID' });
    }
    const logFile = `/mnt/storage/.tmp/rclone-job-${id}.log`;
    
    try {
        if (fs.existsSync(logFile)) {
            const log = fs.readFileSync(logFile, 'utf8');
            const lines = log.trim().split('\n');
            const lastLine = lines[lines.length - 1] || '';
            
            // Check if process is still running (check in history)
            const history = loadTransferHistory();
            const transfer = history.find(t => t.id === id);
            const isRunning = transfer?.status === 'running';
            
            res.json({
                jobId: id,
                running: isRunning,
                lastLine,
                log: lines.slice(-20).join('\n')
            });
        } else {
            res.json({ jobId: id, running: false, error: 'Job not found' });
        }
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// GET /history - Get transfer history
router.get('/history', requireAuth, (req, res) => {
    try {
        const history = loadTransferHistory();
        // Return most recent first
        res.json({ history: history.reverse() });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// DELETE /history - Clear transfer history
router.delete('/history', requireAuth, (req, res) => {
    try {
        saveTransferHistory([]);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ═══════════════════════════════════════════════════════════════════════════
// SCHEDULED SYNC - Cron integration
// ═══════════════════════════════════════════════════════════════════════════

// Helper: Load scheduled syncs
function loadScheduledSyncs() {
    const schedulePath = '/opt/homepinas/backend/data/scheduled-syncs.json';
    try {
        if (fs.existsSync(schedulePath)) {
            return JSON.parse(fs.readFileSync(schedulePath, 'utf8'));
        }
    } catch (e) {
        console.error('Error loading scheduled syncs:', e);
    }
    return [];
}

// Helper: Save scheduled syncs
function saveScheduledSyncs(syncs) {
    const schedulePath = '/opt/homepinas/backend/data/scheduled-syncs.json';
    try {
        fs.writeFileSync(schedulePath, JSON.stringify(syncs, null, 2));
    } catch (e) {
        console.error('Error saving scheduled syncs:', e);
    }
}

// Helper: Convert schedule preset to cron expression
function scheduleToCron(schedule) {
    switch (schedule) {
        case 'hourly': return '0 * * * *';          // Every hour at :00
        case 'daily': return '0 3 * * *';            // Daily at 3:00 AM
        case 'weekly': return '0 3 * * 0';           // Sunday at 3:00 AM
        case 'monthly': return '0 3 1 * *';          // 1st of month at 3:00 AM
        default: return schedule;                     // Custom cron expression
    }
}

// Helper: Write scheduled syncs to system crontab
function writeCloudBackupCrontab() {
    return new Promise((resolve, reject) => {
        const syncs = loadScheduledSyncs().filter(s => s.enabled);

        // Read existing crontab (to preserve non-cloud-backup entries)
        execFile('crontab', ['-l'], { encoding: 'utf8' }, (err, existingCrontab) => {
            if (err) existingCrontab = '';

            // Only filter lines tagged by HomePiNAS (not all rclone lines)
            const otherLines = existingCrontab.split('\n').filter(line =>
                !line.includes('# HomePiNAS Cloud Backup:') &&
                !line.startsWith('# ═══ HomePiNAS Cloud Backup')
            );

            // Remove orphaned HomePiNAS cron command lines (next line after a removed comment)
            const cleanedLines = [];
            let skipNext = false;
            for (const line of otherLines) {
                if (skipNext) { skipNext = false; continue; }
                cleanedLines.push(line);
            }

            let content = cleanedLines.join('\n').trim() + '\n\n';
            content += '# ═══ HomePiNAS Cloud Backup Scheduled Syncs ═══\n';

            syncs.forEach(sync => {
                // Validate sync fields to prevent crontab injection
                if (!validateRclonePath(sync.source) || !validateRclonePath(sync.dest)) return;
                if (!/^[a-zA-Z0-9 _-]+$/.test(sync.name)) return;
                if (!/^[a-zA-Z0-9]+$/.test(sync.id)) return;

                const cronExpr = scheduleToCron(sync.schedule);
                if (!/^[\d*,\/-\s]+$/.test(cronExpr)) return;

                const logFile = `/var/log/homepinas/cloud-backup-${sync.id}.log`;
                const rcloneMode = sync.mode === 'sync' ? 'sync' : 'copy';

                content += `# HomePiNAS Cloud Backup: ${sync.name} (ID: ${sync.id})\n`;
                content += `${cronExpr} /usr/bin/rclone ${rcloneMode} "${sync.source}" "${sync.dest}" >> ${logFile} 2>&1\n`;
            });

            // Write to temp file and apply
            const tmpFile = `/mnt/storage/.tmp/homepinas-crontab-${crypto.randomBytes(8).toString('hex')}`;
            fs.writeFile(tmpFile, content, (writeErr) => {
                if (writeErr) return reject(writeErr);

                execFile('crontab', [tmpFile], (cronErr) => {
                    fs.unlink(tmpFile, () => {});
                    if (cronErr) return reject(cronErr);
                    resolve();
                });
            });
        });
    });
}

// GET /schedules - List scheduled syncs
router.get('/schedules', requireAuth, (req, res) => {
    try {
        const schedules = loadScheduledSyncs();
        res.json({ schedules });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// POST /schedules - Create scheduled sync
router.post('/schedules', requireAuth, async (req, res) => {
    const { name, source, dest, mode = 'copy', schedule } = req.body;
    
    if (!name || !source || !dest || !schedule) {
        return res.status(400).json({ error: 'Name, source, dest, and schedule required' });
    }
    
    if (!validateRclonePath(source) || !validateRclonePath(dest)) {
        return res.status(400).json({ error: 'Invalid source or destination path' });
    }

    try {
        const syncs = loadScheduledSyncs();
        const newSync = {
            id: crypto.randomBytes(6).toString('hex'),
            name: name.replace(/[^a-zA-Z0-9 _-]/g, ''),
            source,
            dest,
            mode: ['sync', 'copy'].includes(mode) ? mode : 'copy',
            schedule,
            enabled: true,
            createdAt: new Date().toISOString()
        };

        syncs.push(newSync);
        saveScheduledSyncs(syncs);

        // Update system crontab
        await writeCloudBackupCrontab();

        // Create log directory with proper permissions (750, not 777)
        execFileSync('sudo', ['mkdir', '-p', '/var/log/homepinas'], { encoding: 'utf8' });
        execFileSync('sudo', ['chmod', '750', '/var/log/homepinas'], { encoding: 'utf8' });

        res.json({ success: true, schedule: newSync });
    } catch (e) {
        res.status(500).json({ error: 'Failed to create schedule' });
    }
});

// DELETE /schedules/:id - Delete scheduled sync
router.delete('/schedules/:id', requireAuth, async (req, res) => {
    const { id } = req.params;
    
    try {
        let syncs = loadScheduledSyncs();
        syncs = syncs.filter(s => s.id !== id);
        saveScheduledSyncs(syncs);
        
        // Update system crontab
        await writeCloudBackupCrontab();
        
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// POST /schedules/:id/toggle - Enable/disable scheduled sync
router.post('/schedules/:id/toggle', requireAuth, async (req, res) => {
    const { id } = req.params;
    
    try {
        const syncs = loadScheduledSyncs();
        const sync = syncs.find(s => s.id === id);
        
        if (!sync) {
            return res.status(404).json({ error: 'Schedule not found' });
        }
        
        sync.enabled = !sync.enabled;
        saveScheduledSyncs(syncs);
        
        // Update system crontab
        await writeCloudBackupCrontab();
        
        res.json({ success: true, enabled: sync.enabled });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Helper: Get configuration fields for a provider
function getProviderFields(provider) {
    const fields = {
        sftp: [
            { name: 'host', label: 'Host', type: 'text', required: true },
            { name: 'user', label: 'Usuario', type: 'text', required: true },
            { name: 'pass', label: 'Contraseña', type: 'password', required: false },
            { name: 'port', label: 'Puerto', type: 'number', default: 22 },
            { name: 'key_file', label: 'Archivo de clave SSH', type: 'text', required: false },
        ],
        ftp: [
            { name: 'host', label: 'Host', type: 'text', required: true },
            { name: 'user', label: 'Usuario', type: 'text', required: true },
            { name: 'pass', label: 'Contraseña', type: 'password', required: true },
            { name: 'port', label: 'Puerto', type: 'number', default: 21 },
        ],
        webdav: [
            { name: 'url', label: 'URL WebDAV', type: 'text', required: true, placeholder: 'https://example.com/dav' },
            { name: 'user', label: 'Usuario', type: 'text', required: true },
            { name: 'pass', label: 'Contraseña', type: 'password', required: true },
        ],
        s3: [
            { name: 'provider', label: 'Proveedor S3', type: 'select', options: ['AWS', 'Minio', 'Wasabi', 'DigitalOcean', 'Other'], required: true },
            { name: 'access_key_id', label: 'Access Key ID', type: 'text', required: true },
            { name: 'secret_access_key', label: 'Secret Access Key', type: 'password', required: true },
            { name: 'region', label: 'Región', type: 'text', default: 'us-east-1' },
            { name: 'endpoint', label: 'Endpoint (si no es AWS)', type: 'text', required: false },
        ],
        b2: [
            { name: 'account', label: 'Account ID', type: 'text', required: true },
            { name: 'key', label: 'Application Key', type: 'password', required: true },
        ],
    };
    
    return fields[provider] || [];
}

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

// Resume interrupted syncs on startup
function resumeInterruptedSyncs() {
    try {
        if (!isRcloneInstalled()) {
            console.log('[Cloud Backup] rclone not installed, skipping resume');
            return;
        }
        
        const history = loadTransferHistory();
        const interrupted = history.filter(t => t.status === 'running');
        
        if (interrupted.length === 0) {
            console.log('[Cloud Backup] No interrupted syncs to resume');
            return;
        }
        
        console.log(`[Cloud Backup] Resuming ${interrupted.length} interrupted sync(s)...`);
        
        interrupted.forEach(job => {
            const { source, dest, mode, id: oldId } = job;

            // Validate stored paths
            if (!validateRclonePath(source) || !validateRclonePath(dest)) {
                job.status = 'failed';
                job.error = 'Invalid path in stored job';
                return;
            }

            const jobId = crypto.randomBytes(8).toString('hex');
            const logFile = `/mnt/storage/.tmp/rclone-job-${jobId}.log`;

            const rcloneMode = ['sync', 'move'].includes(mode) ? mode : 'copy';
            const args = [rcloneMode, source, dest, '--progress', '--stats-one-line'];

            // Mark old job as resumed
            job.status = 'resumed';
            job.resumedAs = jobId;

            history.push({
                id: jobId,
                source,
                dest,
                mode: rcloneMode,
                status: 'running',
                timestamp: new Date().toISOString(),
                resumedFrom: oldId
            });

            console.log(`[Cloud Backup] Resuming: ${source} → ${dest} (job ${jobId})`);
            const logFd = fs.openSync(logFile, 'w');
            const child = spawn('rclone', args, {
                stdio: ['ignore', logFd, logFd],
                detached: true
            });
            child.unref();
            fs.closeSync(logFd);

            child.on('close', (code) => {
                const status = code !== 0 ? 'failed' : 'completed';
                const h = loadTransferHistory();
                const idx = h.findIndex(t => t.id === jobId);
                if (idx !== -1) {
                    h[idx].status = status;
                    h[idx].completedAt = new Date().toISOString();
                    if (code !== 0) h[idx].error = `Exit code ${code}`;
                    saveTransferHistory(h);
                }
                console.log(`[Cloud Backup] Sync ${jobId} ${status}`);
            });
        });
        
        saveTransferHistory(history);
    } catch (e) {
        console.error('[Cloud Backup] Error resuming syncs:', e.message);
    }
}

// Run on module load (with small delay to let server start)
setTimeout(resumeInterruptedSyncs, 3000);

module.exports = router;
