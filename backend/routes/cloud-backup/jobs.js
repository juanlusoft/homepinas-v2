/**
 * HomePiNAS Cloud Backup - Job Management
 * Routes for managing sync jobs, history, and schedules
 */

const express = require('express');
const router = express.Router();
const { execFileSync, spawn } = require('child_process');
const fs = require('fs');
const crypto = require('crypto');

const { requireAuth } = require('../../middleware/auth');
const {
    validateRclonePath,
    isRcloneInstalled,
    loadTransferHistory,
    saveTransferHistory,
    logTransfer,
    loadScheduledSyncs,
    saveScheduledSyncs,
    writeCloudBackupCrontab
} = require('./helpers');

// ═══════════════════════════════════════════════════════════════════════════
// SYNC OPERATIONS
// ═══════════════════════════════════════════════════════════════════════════

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
// SCHEDULED SYNCS
// ═══════════════════════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════════════════════
// RESUME INTERRUPTED SYNCS ON STARTUP
// ═══════════════════════════════════════════════════════════════════════════

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
