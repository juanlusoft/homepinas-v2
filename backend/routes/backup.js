/**
 * HomePiNAS v2 - Backup Management Routes
 * 
 * Create and manage backup jobs using rsync or tar.
 * Supports scheduling, retention policies, and restore operations.
 */

const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { execFile, spawn } = require('child_process');
const { requireAuth } = require('../middleware/auth');
const { logSecurityEvent } = require('../utils/security');
const { getData, saveData } = require('../utils/data');

// In-memory map of currently running backup processes
const runningJobs = new Map();

// --- Helpers ---

/**
 * Validate that a path is within /mnt/ to prevent directory traversal attacks.
 * @param {string} p - The path to validate
 * @returns {boolean} True if the resolved path starts with /mnt/
 */
function isValidMntPath(p) {
  if (!p || typeof p !== 'string') return false;
  const resolved = path.resolve(p);
  return resolved.startsWith('/mnt/');
}

/**
 * Generate a unique ID for backup jobs.
 * @returns {string} Base-36 encoded timestamp
 */
function generateId() {
  return Date.now().toString(36);
}

/**
 * Get the in-memory status for a job, or return idle defaults.
 * @param {string} jobId - The backup job ID
 * @param {object} job - The backup job object from storage
 * @returns {object} Status object with running state and last run info
 */
function getJobStatus(jobId, job) {
  const running = runningJobs.get(jobId);
  if (running) {
    return {
      status: 'running',
      pid: running.pid,
      startedAt: running.startedAt,
      output: running.output.slice(-2000) // Last 2KB of output
    };
  }
  return {
    status: 'idle',
    lastRun: job.lastRun || null,
    lastResult: job.lastResult || null
  };
}

// All routes require authentication
router.use(requireAuth);

// --- Routes ---

/**
 * GET /jobs - List all backup jobs
 */
router.get('/jobs', (req, res) => {
  try {
    const data = getData();
    const backups = data.backups || [];
    res.json({ success: true, jobs: backups });
  } catch (err) {
    console.error('Error listing backup jobs:', err);
    res.status(500).json({ success: false, error: 'Failed to list backup jobs' });
  }
});

/**
 * POST /jobs - Create a new backup job
 * Body: { name, source, destination, type, schedule, excludes, retention }
 */
router.post('/jobs', (req, res) => {
  try {
    const { name, source, destination, type, schedule, excludes, retention } = req.body;

    // Validate required fields
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({ success: false, error: 'Job name is required' });
    }
    if (!source || !destination) {
      return res.status(400).json({ success: false, error: 'Source and destination paths are required' });
    }
    if (!['rsync', 'tar'].includes(type)) {
      return res.status(400).json({ success: false, error: 'Type must be "rsync" or "tar"' });
    }

    // Validate paths are within /mnt/
    if (!isValidMntPath(source)) {
      return res.status(400).json({ success: false, error: 'Source path must be within /mnt/' });
    }
    if (!isValidMntPath(destination)) {
      return res.status(400).json({ success: false, error: 'Destination path must be within /mnt/' });
    }

    // Validate schedule if provided
    if (schedule && schedule.cron) {
      const cronRegex = /^(\*|[0-9,\-\/]+)\s+(\*|[0-9,\-\/]+)\s+(\*|[0-9,\-\/]+)\s+(\*|[0-9,\-\/]+)\s+(\*|[0-9,\-\/]+)$/;
      if (!cronRegex.test(schedule.cron)) {
        return res.status(400).json({ success: false, error: 'Invalid cron expression' });
      }
    }

    const job = {
      id: generateId(),
      name: name.trim(),
      source: path.resolve(source),
      destination: path.resolve(destination),
      type,
      schedule: {
        enabled: (schedule && schedule.enabled) || false,
        cron: (schedule && schedule.cron) || '0 2 * * *' // Default: 2 AM daily
      },
      excludes: Array.isArray(excludes) ? excludes.filter(e => typeof e === 'string') : [],
      retention: {
        keepLast: (retention && typeof retention.keepLast === 'number' && retention.keepLast > 0)
          ? retention.keepLast
          : 10
      },
      history: [],
      lastRun: null,
      lastResult: null,
      createdAt: new Date().toISOString()
    };

    const data = getData();
    if (!data.backups) data.backups = [];
    data.backups.push(job);
    saveData(data);

    logSecurityEvent('backup_job_created', { jobId: job.id, name: job.name, user: req.user });

    res.status(201).json({ success: true, job });
  } catch (err) {
    console.error('Error creating backup job:', err);
    res.status(500).json({ success: false, error: 'Failed to create backup job' });
  }
});

/**
 * PUT /jobs/:id - Update an existing backup job
 */
router.put('/jobs/:id', (req, res) => {
  try {
    const data = getData();
    if (!data.backups) data.backups = [];

    const jobIndex = data.backups.findIndex(j => j.id === req.params.id);
    if (jobIndex === -1) {
      return res.status(404).json({ success: false, error: 'Backup job not found' });
    }

    // Check if job is currently running
    if (runningJobs.has(req.params.id)) {
      return res.status(409).json({ success: false, error: 'Cannot update a running job' });
    }

    const { name, source, destination, type, schedule, excludes, retention } = req.body;
    const job = data.backups[jobIndex];

    // Validate and update fields if provided
    if (name !== undefined) {
      if (typeof name !== 'string' || name.trim().length === 0) {
        return res.status(400).json({ success: false, error: 'Job name cannot be empty' });
      }
      job.name = name.trim();
    }
    if (source !== undefined) {
      if (!isValidMntPath(source)) {
        return res.status(400).json({ success: false, error: 'Source path must be within /mnt/' });
      }
      job.source = path.resolve(source);
    }
    if (destination !== undefined) {
      if (!isValidMntPath(destination)) {
        return res.status(400).json({ success: false, error: 'Destination path must be within /mnt/' });
      }
      job.destination = path.resolve(destination);
    }
    if (type !== undefined) {
      if (!['rsync', 'tar'].includes(type)) {
        return res.status(400).json({ success: false, error: 'Type must be "rsync" or "tar"' });
      }
      job.type = type;
    }
    if (schedule !== undefined) {
      if (schedule.cron) {
        const cronRegex = /^(\*|[0-9,\-\/]+)\s+(\*|[0-9,\-\/]+)\s+(\*|[0-9,\-\/]+)\s+(\*|[0-9,\-\/]+)\s+(\*|[0-9,\-\/]+)$/;
        if (!cronRegex.test(schedule.cron)) {
          return res.status(400).json({ success: false, error: 'Invalid cron expression' });
        }
        job.schedule.cron = schedule.cron;
      }
      if (typeof schedule.enabled === 'boolean') {
        job.schedule.enabled = schedule.enabled;
      }
    }
    if (excludes !== undefined) {
      job.excludes = Array.isArray(excludes) ? excludes.filter(e => typeof e === 'string') : [];
    }
    if (retention !== undefined && typeof retention.keepLast === 'number' && retention.keepLast > 0) {
      job.retention.keepLast = retention.keepLast;
    }

    job.updatedAt = new Date().toISOString();
    data.backups[jobIndex] = job;
    saveData(data);

    logSecurityEvent('backup_job_updated', { jobId: job.id, name: job.name, user: req.user });

    res.json({ success: true, job });
  } catch (err) {
    console.error('Error updating backup job:', err);
    res.status(500).json({ success: false, error: 'Failed to update backup job' });
  }
});

/**
 * DELETE /jobs/:id - Delete a backup job
 */
router.delete('/jobs/:id', (req, res) => {
  try {
    const data = getData();
    if (!data.backups) data.backups = [];

    const jobIndex = data.backups.findIndex(j => j.id === req.params.id);
    if (jobIndex === -1) {
      return res.status(404).json({ success: false, error: 'Backup job not found' });
    }

    // Kill running process if any
    if (runningJobs.has(req.params.id)) {
      const running = runningJobs.get(req.params.id);
      if (running.process) {
        running.process.kill('SIGTERM');
      }
      runningJobs.delete(req.params.id);
    }

    const removed = data.backups.splice(jobIndex, 1)[0];
    saveData(data);

    logSecurityEvent('backup_job_deleted', { jobId: removed.id, name: removed.name, user: req.user });

    res.json({ success: true, message: 'Backup job deleted' });
  } catch (err) {
    console.error('Error deleting backup job:', err);
    res.status(500).json({ success: false, error: 'Failed to delete backup job' });
  }
});

/**
 * POST /jobs/:id/run - Execute a backup job immediately
 * Spawns rsync or tar as a child process and tracks it in memory.
 */
router.post('/jobs/:id/run', (req, res) => {
  try {
    const data = getData();
    if (!data.backups) data.backups = [];

    const job = data.backups.find(j => j.id === req.params.id);
    if (!job) {
      return res.status(404).json({ success: false, error: 'Backup job not found' });
    }

    // Check if already running
    if (runningJobs.has(req.params.id)) {
      return res.status(409).json({ success: false, error: 'Job is already running' });
    }

    let proc;
    const startedAt = new Date().toISOString();

    if (job.type === 'rsync') {
      // Build rsync command arguments
      const args = ['-avz', '--delete'];
      // Add exclude patterns
      if (job.excludes && job.excludes.length > 0) {
        job.excludes.forEach(pattern => {
          args.push(`--exclude=${pattern}`);
        });
      }
      // Source must end with / for rsync to copy contents
      const srcPath = job.source.endsWith('/') ? job.source : job.source + '/';
      args.push(srcPath, job.destination);

      proc = spawn('rsync', args);
    } else if (job.type === 'tar') {
      // Create timestamped tar archive in destination
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const archiveName = `backup-${timestamp}.tar.gz`;
      const archivePath = path.join(job.destination, archiveName);

      // Ensure destination directory exists
      try {
        fs.mkdirSync(job.destination, { recursive: true });
      } catch (mkdirErr) {
        return res.status(500).json({ success: false, error: 'Failed to create destination directory' });
      }

      const args = ['czf', archivePath, '-C', job.source, '.'];
      // Add exclude patterns for tar
      if (job.excludes && job.excludes.length > 0) {
        job.excludes.forEach(pattern => {
          args.unshift(`--exclude=${pattern}`);
        });
        // Rearrange: excludes first, then czf etc.
        // Actually tar expects: tar --exclude=pattern czf archive -C source .
        // Let's rebuild properly
        const tarArgs = [];
        job.excludes.forEach(pattern => {
          tarArgs.push(`--exclude=${pattern}`);
        });
        tarArgs.push('czf', archivePath, '-C', job.source, '.');
        proc = spawn('tar', tarArgs);
      } else {
        proc = spawn('tar', args);
      }
    }

    // Track the running process
    const jobState = {
      process: proc,
      pid: proc.pid,
      startedAt,
      output: ''
    };
    runningJobs.set(req.params.id, jobState);

    // Collect output
    proc.stdout.on('data', (chunk) => {
      jobState.output += chunk.toString();
      // Trim output buffer to prevent memory issues (keep last 50KB)
      if (jobState.output.length > 50000) {
        jobState.output = jobState.output.slice(-50000);
      }
    });
    proc.stderr.on('data', (chunk) => {
      jobState.output += chunk.toString();
      if (jobState.output.length > 50000) {
        jobState.output = jobState.output.slice(-50000);
      }
    });

    // Handle process completion
    proc.on('close', (code) => {
      const finishedAt = new Date().toISOString();
      const result = code === 0 ? 'success' : 'failed';

      // Update job data with run history
      const currentData = getData();
      const currentJob = currentData.backups.find(j => j.id === req.params.id);
      if (currentJob) {
        if (!currentJob.history) currentJob.history = [];
        currentJob.history.unshift({
          startedAt,
          finishedAt,
          result,
          exitCode: code,
          outputTail: jobState.output.slice(-1000) // Keep last 1KB in history
        });
        // Trim history to last 20 entries
        if (currentJob.history.length > 20) {
          currentJob.history = currentJob.history.slice(0, 20);
        }
        currentJob.lastRun = finishedAt;
        currentJob.lastResult = result;

        // Apply retention policy for tar backups
        if (currentJob.type === 'tar' && currentJob.retention && currentJob.retention.keepLast > 0) {
          applyRetention(currentJob);
        }

        saveData(currentData);
      }

      // Remove from running jobs map
      runningJobs.delete(req.params.id);

      logSecurityEvent('backup_job_completed', {
        jobId: req.params.id,
        result,
        exitCode: code,
        user: req.user
      });
    });

    proc.on('error', (err) => {
      console.error(`Backup process error for job ${req.params.id}:`, err);
      runningJobs.delete(req.params.id);

      // Record failure in history
      const currentData = getData();
      const currentJob = currentData.backups.find(j => j.id === req.params.id);
      if (currentJob) {
        if (!currentJob.history) currentJob.history = [];
        currentJob.history.unshift({
          startedAt,
          finishedAt: new Date().toISOString(),
          result: 'error',
          error: err.message
        });
        if (currentJob.history.length > 20) {
          currentJob.history = currentJob.history.slice(0, 20);
        }
        currentJob.lastRun = new Date().toISOString();
        currentJob.lastResult = 'error';
        saveData(currentData);
      }
    });

    logSecurityEvent('backup_job_started', { jobId: job.id, name: job.name, type: job.type, user: req.user });

    res.json({ success: true, status: 'started', pid: proc.pid });
  } catch (err) {
    console.error('Error running backup job:', err);
    res.status(500).json({ success: false, error: 'Failed to start backup job' });
  }
});

/**
 * GET /jobs/:id/status - Get current status of a backup job
 */
router.get('/jobs/:id/status', (req, res) => {
  try {
    const data = getData();
    if (!data.backups) data.backups = [];

    const job = data.backups.find(j => j.id === req.params.id);
    if (!job) {
      return res.status(404).json({ success: false, error: 'Backup job not found' });
    }

    const status = getJobStatus(req.params.id, job);
    res.json({ success: true, jobId: job.id, name: job.name, ...status });
  } catch (err) {
    console.error('Error getting job status:', err);
    res.status(500).json({ success: false, error: 'Failed to get job status' });
  }
});

/**
 * GET /jobs/:id/history - Get run history for a backup job (last 20 runs)
 */
router.get('/jobs/:id/history', (req, res) => {
  try {
    const data = getData();
    if (!data.backups) data.backups = [];

    const job = data.backups.find(j => j.id === req.params.id);
    if (!job) {
      return res.status(404).json({ success: false, error: 'Backup job not found' });
    }

    const history = (job.history || []).slice(0, 20);
    res.json({ success: true, jobId: job.id, name: job.name, history });
  } catch (err) {
    console.error('Error getting job history:', err);
    res.status(500).json({ success: false, error: 'Failed to get job history' });
  }
});

/**
 * POST /jobs/:id/restore - Restore from a tar backup archive
 * Body: { archive: 'backup-2025-01-01T00-00-00-000Z.tar.gz' }
 */
router.post('/jobs/:id/restore', (req, res) => {
  try {
    const data = getData();
    if (!data.backups) data.backups = [];

    const job = data.backups.find(j => j.id === req.params.id);
    if (!job) {
      return res.status(404).json({ success: false, error: 'Backup job not found' });
    }

    if (job.type !== 'tar') {
      return res.status(400).json({ success: false, error: 'Restore is only supported for tar backup jobs' });
    }

    const { archive } = req.body;
    if (!archive || typeof archive !== 'string') {
      return res.status(400).json({ success: false, error: 'Archive filename is required' });
    }

    // Sanitize archive filename - prevent path traversal
    const sanitizedArchive = path.basename(archive);
    if (sanitizedArchive !== archive) {
      return res.status(400).json({ success: false, error: 'Invalid archive filename' });
    }

    const archivePath = path.join(job.destination, sanitizedArchive);

    // Verify archive exists
    if (!fs.existsSync(archivePath)) {
      return res.status(404).json({ success: false, error: 'Archive file not found' });
    }

    // Verify target path is still within /mnt/
    if (!isValidMntPath(archivePath)) {
      return res.status(400).json({ success: false, error: 'Archive path must be within /mnt/' });
    }

    // Extract archive to source path
    const proc = spawn('tar', ['xzf', archivePath, '-C', job.source]);

    const restoreState = { output: '' };

    proc.stdout.on('data', (chunk) => {
      restoreState.output += chunk.toString();
    });
    proc.stderr.on('data', (chunk) => {
      restoreState.output += chunk.toString();
    });

    proc.on('close', (code) => {
      logSecurityEvent('backup_restore_completed', {
        jobId: job.id,
        archive: sanitizedArchive,
        result: code === 0 ? 'success' : 'failed',
        user: req.user
      });
    });

    proc.on('error', (err) => {
      console.error(`Restore error for job ${req.params.id}:`, err);
    });

    logSecurityEvent('backup_restore_started', {
      jobId: job.id,
      archive: sanitizedArchive,
      target: job.source,
      user: req.user
    });

    res.json({
      success: true,
      status: 'started',
      pid: proc.pid,
      message: `Restoring ${sanitizedArchive} to ${job.source}`
    });
  } catch (err) {
    console.error('Error restoring backup:', err);
    res.status(500).json({ success: false, error: 'Failed to start restore' });
  }
});

// --- Retention Helper ---

/**
 * Apply retention policy for tar backups.
 * Removes oldest archives exceeding the keepLast count.
 * @param {object} job - The backup job object
 */
function applyRetention(job) {
  try {
    if (!fs.existsSync(job.destination)) return;

    const files = fs.readdirSync(job.destination)
      .filter(f => f.startsWith('backup-') && f.endsWith('.tar.gz'))
      .sort()
      .reverse(); // Newest first

    if (files.length > job.retention.keepLast) {
      const toRemove = files.slice(job.retention.keepLast);
      toRemove.forEach(file => {
        const filePath = path.join(job.destination, file);
        try {
          fs.unlinkSync(filePath);
          console.log(`Retention: removed old backup ${file}`);
        } catch (unlinkErr) {
          console.error(`Retention: failed to remove ${file}:`, unlinkErr);
        }
      });
    }
  } catch (err) {
    console.error('Error applying retention policy:', err);
  }
}

module.exports = router;
