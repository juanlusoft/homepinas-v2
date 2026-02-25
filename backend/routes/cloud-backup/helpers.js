/**
 * HomePiNAS Cloud Backup - Shared Helpers
 * Utility functions for rclone operations and data management
 */

const { execFileSync, execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Config paths
const RCLONE_CONFIG = '/home/homepinas/.config/rclone/rclone.conf';
const RCLONE_BIN = '/usr/bin/rclone';

// ═══════════════════════════════════════════════════════════════════════════
// Validation Functions
// ═══════════════════════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════════════════════
// Rclone Info Functions
// ═══════════════════════════════════════════════════════════════════════════

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
// Transfer History Functions
// ═══════════════════════════════════════════════════════════════════════════

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
        const dir = path.dirname(historyPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
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

// ═══════════════════════════════════════════════════════════════════════════
// Scheduled Sync Functions
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
        const dir = path.dirname(schedulePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
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

module.exports = {
    RCLONE_CONFIG,
    RCLONE_BIN,
    validateRemoteName,
    validateRclonePath,
    isRcloneInstalled,
    getRcloneVersion,
    listRemotes,
    getRemoteType,
    getRemoteInfo,
    loadTransferHistory,
    saveTransferHistory,
    logTransfer,
    loadScheduledSyncs,
    saveScheduledSyncs,
    scheduleToCron,
    writeCloudBackupCrontab,
    getProviderFields
};
