/**
 * HomePiNAS v2 - Backup Service Layer
 * Business logic for backup job management, execution, and scheduling
 */

const path = require('path');
const fs = require('fs').promises;
const { getData, saveData } = require('../utils/data');

/**
 * Validate path is within /mnt/ to prevent directory traversal
 * @param {string} p - Path to validate
 * @returns {boolean}
 */
function isValidMntPath(p) {
    if (!p || typeof p !== 'string') return false;
    const resolved = path.resolve(p);
    return resolved.startsWith('/mnt/');
}

/**
 * Generate unique backup job ID
 * @returns {string}
 */
function generateJobId() {
    return Date.now().toString(36);
}

/**
 * Validate cron expression format
 * @param {string} cron - Cron expression
 * @returns {boolean}
 */
function isValidCron(cron) {
    const cronRegex = /^(\*|[0-9,\-\/]+)\s+(\*|[0-9,\-\/]+)\s+(\*|[0-9,\-\/]+)\s+(\*|[0-9,\-\/]+)\s+(\*|[0-9,\-\/]+)$/;
    return cronRegex.test(cron);
}

/**
 * Get all backup jobs
 * @returns {Array} Array of backup jobs
 */
function getAllJobs() {
    const data = getData();
    return data.backups || [];
}

/**
 * Get backup job by ID
 * @param {string} jobId - Job identifier
 * @returns {Object|null} Job object or null if not found
 */
function getJobById(jobId) {
    const data = getData();
    const jobs = data.backups || [];
    return jobs.find(j => j.id === jobId) || null;
}

/**
 * Create a new backup job
 * @param {Object} jobParams - Job parameters
 * @returns {Object} Result with { success: boolean, job?: Object, error?: string }
 */
function createJob(jobParams) {
    const { name, source, destination, type, schedule, excludes, retention } = jobParams;

    // Validate required fields
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
        return { success: false, error: 'Job name is required' };
    }
    if (!source || !destination) {
        return { success: false, error: 'Source and destination paths are required' };
    }
    if (!['rsync', 'tar'].includes(type)) {
        return { success: false, error: 'Type must be "rsync" or "tar"' };
    }

    // Validate paths
    if (!isValidMntPath(source)) {
        return { success: false, error: 'Source path must be within /mnt/' };
    }
    if (!isValidMntPath(destination)) {
        return { success: false, error: 'Destination path must be within /mnt/' };
    }

    // Validate schedule if provided
    if (schedule && schedule.cron && !isValidCron(schedule.cron)) {
        return { success: false, error: 'Invalid cron expression' };
    }

    const job = {
        id: generateJobId(),
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

    return { success: true, job };
}

/**
 * Update an existing backup job
 * @param {string} jobId - Job identifier
 * @param {Object} updates - Fields to update
 * @returns {Object} Result with { success: boolean, job?: Object, error?: string }
 */
function updateJob(jobId, updates) {
    const data = getData();
    if (!data.backups) data.backups = [];

    const jobIndex = data.backups.findIndex(j => j.id === jobId);
    if (jobIndex === -1) {
        return { success: false, error: 'Backup job not found' };
    }

    const job = data.backups[jobIndex];
    const { name, source, destination, type, schedule, excludes, retention } = updates;

    // Validate and update fields
    if (name !== undefined) {
        if (typeof name !== 'string' || name.trim().length === 0) {
            return { success: false, error: 'Job name cannot be empty' };
        }
        job.name = name.trim();
    }
    if (source !== undefined) {
        if (!isValidMntPath(source)) {
            return { success: false, error: 'Source path must be within /mnt/' };
        }
        job.source = path.resolve(source);
    }
    if (destination !== undefined) {
        if (!isValidMntPath(destination)) {
            return { success: false, error: 'Destination path must be within /mnt/' };
        }
        job.destination = path.resolve(destination);
    }
    if (type !== undefined) {
        if (!['rsync', 'tar'].includes(type)) {
            return { success: false, error: 'Type must be "rsync" or "tar"' };
        }
        job.type = type;
    }
    if (schedule !== undefined) {
        if (schedule.cron && !isValidCron(schedule.cron)) {
            return { success: false, error: 'Invalid cron expression' };
        }
        job.schedule = { ...job.schedule, ...schedule };
    }
    if (excludes !== undefined) {
        job.excludes = Array.isArray(excludes) ? excludes.filter(e => typeof e === 'string') : [];
    }
    if (retention !== undefined) {
        if (retention.keepLast !== undefined && (typeof retention.keepLast !== 'number' || retention.keepLast <= 0)) {
            return { success: false, error: 'Retention keepLast must be a positive number' };
        }
        job.retention = { ...job.retention, ...retention };
    }

    saveData(data);
    return { success: true, job };
}

/**
 * Delete a backup job
 * @param {string} jobId - Job identifier
 * @returns {Object} Result with { success: boolean, error?: string }
 */
function deleteJob(jobId) {
    const data = getData();
    if (!data.backups) data.backups = [];

    const jobIndex = data.backups.findIndex(j => j.id === jobId);
    if (jobIndex === -1) {
        return { success: false, error: 'Backup job not found' };
    }

    data.backups.splice(jobIndex, 1);
    saveData(data);

    return { success: true };
}

/**
 * Add history entry to backup job
 * @param {string} jobId - Job identifier
 * @param {Object} historyEntry - History entry object
 * @returns {boolean} Success status
 */
function addJobHistory(jobId, historyEntry) {
    try {
        const data = getData();
        if (!data.backups) return false;

        const job = data.backups.find(j => j.id === jobId);
        if (!job) return false;

        if (!job.history) job.history = [];
        job.history.unshift(historyEntry);

        // Keep only the last N entries based on retention
        const keepLast = job.retention?.keepLast || 10;
        if (job.history.length > keepLast) {
            job.history = job.history.slice(0, keepLast);
        }

        job.lastRun = historyEntry.startedAt;
        job.lastResult = historyEntry.success ? 'success' : 'failed';

        saveData(data);
        return true;
    } catch (error) {
        console.error('Failed to add job history:', error);
        return false;
    }
}

/**
 * Get job execution status
 * @param {string} jobId - Job identifier
 * @param {Map} runningJobs - Map of currently running jobs
 * @returns {Object} Status object
 */
function getJobStatus(jobId, runningJobs) {
    const job = getJobById(jobId);
    if (!job) {
        return { status: 'not_found' };
    }

    const running = runningJobs.get(jobId);
    if (running) {
        return {
            status: 'running',
            pid: running.pid,
            startedAt: running.startedAt,
            output: running.output.slice(-2000) // Last 2KB
        };
    }

    return {
        status: 'idle',
        lastRun: job.lastRun || null,
        lastResult: job.lastResult || null
    };
}

module.exports = {
    isValidMntPath,
    generateJobId,
    isValidCron,
    getAllJobs,
    getJobById,
    createJob,
    updateJob,
    deleteJob,
    addJobHistory,
    getJobStatus
};
