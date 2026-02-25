/**
 * HomePiNAS v2 - Backup Management Routes
 * REFACTORED: Business logic moved to services/backup.js
 * Routes handle: request parsing → service call → response formatting
 * 
 * Create and manage backup jobs using rsync or tar.
 * Supports scheduling, retention policies, and restore operations.
 */

const express = require('express');
const router = express.Router();
const path = require('path');
const { spawn } = require('child_process');
const { requireAuth } = require('../middleware/auth');
const { logSecurityEvent } = require('../utils/security');
const backupService = require('../services/backup');

// In-memory map of currently running backup processes
const runningJobs = new Map();

/**
 * GET /jobs
 * List all backup jobs with their status
 */
router.get('/jobs', requireAuth, async (req, res) => {
    try {
        const jobs = backupService.getAllJobs();
        
        // Enrich with running status
        const enrichedJobs = jobs.map(job => ({
            ...job,
            running: runningJobs.has(job.id),
            status: backupService.getJobStatus(job.id, runningJobs)
        }));
        
        res.json({ jobs: enrichedJobs, count: enrichedJobs.length });
    } catch (error) {
        console.error('List backup jobs error:', error);
        res.status(500).json({ error: 'Failed to list backup jobs' });
    }
});

/**
 * GET /jobs/:id
 * Get a specific backup job by ID
 */
router.get('/jobs/:id', requireAuth, async (req, res) => {
    try {
        const jobId = req.params.id;
        const job = backupService.getJobById(jobId);
        
        if (!job) {
            return res.status(404).json({ error: 'Backup job not found' });
        }
        
        const status = backupService.getJobStatus(jobId, runningJobs);
        
        res.json({ job: { ...job, ...status } });
    } catch (error) {
        console.error('Get backup job error:', error);
        res.status(500).json({ error: 'Failed to get backup job' });
    }
});

/**
 * POST /jobs
 * Create a new backup job
 * Body: { name, source, destination, type, schedule, excludes, retention }
 */
router.post('/jobs', requireAuth, async (req, res) => {
    try {
        const { name, source, destination, type, schedule, excludes, retention } = req.body;
        
        const result = backupService.createJob({
            name,
            source,
            destination,
            type,
            schedule,
            excludes,
            retention
        });
        
        if (!result.success) {
            return res.status(400).json({ error: result.error });
        }
        
        logSecurityEvent('BACKUP_JOB_CREATED', { 
            jobId: result.job.id, 
            name: result.job.name 
        }, req.ip);
        
        res.status(201).json({
            success: true,
            message: `Backup job "${name}" created`,
            job: result.job
        });
    } catch (error) {
        console.error('Create backup job error:', error);
        res.status(500).json({ error: 'Failed to create backup job' });
    }
});

/**
 * PUT /jobs/:id
 * Update an existing backup job
 * Body: { name, source, destination, type, schedule, excludes, retention }
 */
router.put('/jobs/:id', requireAuth, async (req, res) => {
    try {
        const jobId = req.params.id;
        const updates = req.body;
        
        const result = backupService.updateJob(jobId, updates);
        
        if (!result.success) {
            const statusCode = result.error === 'Backup job not found' ? 404 : 400;
            return res.status(statusCode).json({ error: result.error });
        }
        
        logSecurityEvent('BACKUP_JOB_UPDATED', { 
            jobId, 
            updates: Object.keys(updates) 
        }, req.ip);
        
        res.json({
            success: true,
            message: `Backup job updated`,
            job: result.job
        });
    } catch (error) {
        console.error('Update backup job error:', error);
        res.status(500).json({ error: 'Failed to update backup job' });
    }
});

/**
 * DELETE /jobs/:id
 * Delete a backup job
 */
router.delete('/jobs/:id', requireAuth, async (req, res) => {
    try {
        const jobId = req.params.id;
        
        // Don't allow deletion of running jobs
        if (runningJobs.has(jobId)) {
            return res.status(409).json({ 
                error: 'Cannot delete a running backup job. Stop it first.' 
            });
        }
        
        const result = backupService.deleteJob(jobId);
        
        if (!result.success) {
            const statusCode = result.error === 'Backup job not found' ? 404 : 500;
            return res.status(statusCode).json({ error: result.error });
        }
        
        logSecurityEvent('BACKUP_JOB_DELETED', { jobId }, req.ip);
        
        res.json({ 
            success: true, 
            message: 'Backup job deleted' 
        });
    } catch (error) {
        console.error('Delete backup job error:', error);
        res.status(500).json({ error: 'Failed to delete backup job' });
    }
});

/**
 * POST /jobs/:id/run
 * Manually trigger a backup job
 */
router.post('/jobs/:id/run', requireAuth, async (req, res) => {
    try {
        const jobId = req.params.id;
        const job = backupService.getJobById(jobId);
        
        if (!job) {
            return res.status(404).json({ error: 'Backup job not found' });
        }
        
        if (runningJobs.has(jobId)) {
            return res.status(409).json({ error: 'Backup job is already running' });
        }
        
        // Start backup in background
        res.json({ 
            success: true, 
            message: `Backup job "${job.name}" started` 
        });
        
        runBackupJob(job);
    } catch (error) {
        console.error('Run backup job error:', error);
        res.status(500).json({ error: 'Failed to run backup job' });
    }
});

/**
 * POST /jobs/:id/stop
 * Stop a running backup job
 */
router.post('/jobs/:id/stop', requireAuth, async (req, res) => {
    try {
        const jobId = req.params.id;
        
        const running = runningJobs.get(jobId);
        if (!running) {
            return res.status(404).json({ error: 'Backup job is not running' });
        }
        
        // Kill the process
        try {
            process.kill(running.pid, 'SIGTERM');
        } catch (e) {
            console.error('Failed to kill backup process:', e);
        }
        
        runningJobs.delete(jobId);
        
        logSecurityEvent('BACKUP_JOB_STOPPED', { jobId }, req.ip);
        
        res.json({ 
            success: true, 
            message: 'Backup job stopped' 
        });
    } catch (error) {
        console.error('Stop backup job error:', error);
        res.status(500).json({ error: 'Failed to stop backup job' });
    }
});

/**
 * GET /jobs/:id/logs
 * Get output logs from a running or last completed backup
 */
router.get('/jobs/:id/logs', requireAuth, async (req, res) => {
    try {
        const jobId = req.params.id;
        const job = backupService.getJobById(jobId);
        
        if (!job) {
            return res.status(404).json({ error: 'Backup job not found' });
        }
        
        const running = runningJobs.get(jobId);
        if (running) {
            // Return live output
            return res.json({
                running: true,
                output: running.output.slice(-5000) // Last 5KB
            });
        }
        
        // Return last history entry
        const lastRun = job.history && job.history.length > 0 ? job.history[0] : null;
        res.json({
            running: false,
            lastRun
        });
    } catch (error) {
        console.error('Get backup logs error:', error);
        res.status(500).json({ error: 'Failed to get logs' });
    }
});

/**
 * Execute a backup job (internal function)
 * @param {Object} job - Backup job object
 */
async function runBackupJob(job) {
    const startedAt = new Date().toISOString();
    let output = '';
    
    try {
        // Prepare command based on type
        let command, args;
        
        if (job.type === 'rsync') {
            command = 'rsync';
            args = [
                '-av',
                '--delete',
                '--stats',
                ...job.excludes.map(e => `--exclude=${e}`),
                job.source.endsWith('/') ? job.source : job.source + '/',
                job.destination.endsWith('/') ? job.destination : job.destination + '/'
            ];
        } else if (job.type === 'tar') {
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const archiveName = `backup-${path.basename(job.source)}-${timestamp}.tar.gz`;
            const archivePath = path.join(job.destination, archiveName);
            
            command = 'tar';
            args = [
                '-czf',
                archivePath,
                ...job.excludes.flatMap(e => ['--exclude', e]),
                '-C',
                path.dirname(job.source),
                path.basename(job.source)
            ];
        } else {
            throw new Error(`Unknown backup type: ${job.type}`);
        }
        
        // Spawn process
        const proc = spawn(command, args, {
            stdio: ['ignore', 'pipe', 'pipe']
        });
        
        // Track running job
        runningJobs.set(job.id, {
            pid: proc.pid,
            startedAt,
            output: ''
        });
        
        // Capture output
        proc.stdout.on('data', (data) => {
            output += data.toString();
            const running = runningJobs.get(job.id);
            if (running) {
                running.output += data.toString();
                // Keep only last 10KB
                if (running.output.length > 10000) {
                    running.output = running.output.slice(-10000);
                }
            }
        });
        
        proc.stderr.on('data', (data) => {
            output += data.toString();
            const running = runningJobs.get(job.id);
            if (running) {
                running.output += data.toString();
                if (running.output.length > 10000) {
                    running.output = running.output.slice(-10000);
                }
            }
        });
        
        // Wait for completion
        await new Promise((resolve, reject) => {
            proc.on('close', (code) => {
                runningJobs.delete(job.id);
                
                const finishedAt = new Date().toISOString();
                const success = code === 0;
                
                // Add to history
                backupService.addJobHistory(job.id, {
                    startedAt,
                    finishedAt,
                    success,
                    exitCode: code,
                    output: output.slice(-5000) // Keep last 5KB
                });
                
                if (success) {
                    console.log(`[Backup] Job "${job.name}" completed successfully`);
                    resolve();
                } else {
                    console.error(`[Backup] Job "${job.name}" failed with code ${code}`);
                    reject(new Error(`Backup failed with exit code ${code}`));
                }
            });
            
            proc.on('error', (err) => {
                runningJobs.delete(job.id);
                reject(err);
            });
        });
    } catch (error) {
        console.error(`[Backup] Error running job "${job.name}":`, error);
        
        // Add failed history entry
        backupService.addJobHistory(job.id, {
            startedAt,
            finishedAt: new Date().toISOString(),
            success: false,
            exitCode: -1,
            output: `Error: ${error.message}\n${output.slice(-5000)}`
        });
    }
}

module.exports = router;
