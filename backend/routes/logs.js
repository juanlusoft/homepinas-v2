/**
 * HomePiNAS v2 - System Log Viewer Routes
 * 
 * Read and display system, application, and service logs.
 * Uses journalctl for systemd-managed logs and direct file reading for others.
 */

const express = require('express');
const router = express.Router();
const { execFile } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');
const { requireAuth } = require('../middleware/auth');
const { logSecurityEvent } = require('../utils/security');
const { sanitizeString } = require('../utils/sanitize');

const execFileAsync = promisify(execFile);
const readFileAsync = promisify(fs.readFile);
const readdirAsync = promisify(fs.readdir);
const statAsync = promisify(fs.stat);

// All log routes require authentication
router.use(requireAuth);

/**
 * Validate and parse the 'lines' query parameter.
 * Must be a positive integer, max 1000. Defaults to 100.
 * @param {string|undefined} linesParam - The raw lines parameter
 * @returns {{ valid: boolean, value?: number, error?: string }}
 */
function validateLines(linesParam) {
  if (linesParam === undefined || linesParam === '') {
    return { valid: true, value: 100 };
  }
  const num = parseInt(linesParam, 10);
  if (isNaN(num) || num < 1 || !Number.isInteger(num)) {
    return { valid: false, error: 'Lines must be a positive integer' };
  }
  if (num > 1000) {
    return { valid: false, error: 'Lines must not exceed 1000' };
  }
  return { valid: true, value: num };
}

/**
 * Validate the 'filter' query parameter.
 * Alphanumeric + spaces + basic punctuation only, max 100 chars.
 * @param {string|undefined} filterParam - The raw filter parameter
 * @returns {{ valid: boolean, value?: string, error?: string }}
 */
function validateFilter(filterParam) {
  if (filterParam === undefined || filterParam === '') {
    return { valid: true, value: null };
  }
  if (filterParam.length > 100) {
    return { valid: false, error: 'Filter must not exceed 100 characters' };
  }
  // Allow alphanumeric, spaces, dots, dashes, underscores, colons, slashes, brackets
  if (!/^[a-zA-Z0-9\s.\-_:\/\[\]()]+$/.test(filterParam)) {
    return { valid: false, error: 'Filter contains invalid characters. Only alphanumeric, spaces, and basic punctuation are allowed.' };
  }
  return { valid: true, value: filterParam };
}

/**
 * Execute journalctl with the given arguments and optional grep filter.
 * @param {string[]} args - journalctl arguments
 * @param {string|null} filter - Optional grep pattern
 * @returns {Promise<string>} Log output
 */
async function readJournalctl(args, filter) {
  const { stdout } = await execFileAsync('journalctl', args, {
    maxBuffer: 5 * 1024 * 1024, // 5MB buffer for large log outputs
    timeout: 15000 // 15 second timeout
  });

  // Apply grep filter if provided
  if (filter) {
    const lines = stdout.split('\n');
    const filtered = lines.filter(line =>
      line.toLowerCase().includes(filter.toLowerCase())
    );
    return filtered.join('\n');
  }

  return stdout;
}

/**
 * Get the last N lines from a string.
 * @param {string} content - Full file content
 * @param {number} numLines - Number of lines to return
 * @returns {string} Last N lines
 */
function getLastLines(content, numLines) {
  const lines = content.split('\n').filter(line => line.trim() !== '');
  return lines.slice(-numLines).join('\n');
}

/**
 * GET /system
 * Read system logs via journalctl.
 * Query params: lines (default 100, max 1000), filter (grep pattern)
 */
router.get('/system', async (req, res) => {
  try {
    const linesResult = validateLines(req.query.lines);
    if (!linesResult.valid) {
      return res.status(400).json({ success: false, error: linesResult.error });
    }

    const filterResult = validateFilter(req.query.filter);
    if (!filterResult.valid) {
      return res.status(400).json({ success: false, error: filterResult.error });
    }

    const args = ['--no-pager', '-n', String(linesResult.value), '--output=short-iso'];
    const output = await readJournalctl(args, filterResult.value);

    res.json({
      success: true,
      logs: output,
      lines: linesResult.value,
      filter: filterResult.value,
      source: 'journalctl (system)'
    });
  } catch (error) {
    console.error('Error reading system logs:', error);
    res.status(500).json({ success: false, error: `Failed to read system logs: ${error.message}` });
  }
});

/**
 * GET /app
 * Read HomePiNAS application logs from journalctl.
 * Query params: lines (default 100, max 1000), filter (grep pattern)
 */
router.get('/app', async (req, res) => {
  try {
    const linesResult = validateLines(req.query.lines);
    if (!linesResult.valid) {
      return res.status(400).json({ success: false, error: linesResult.error });
    }

    const filterResult = validateFilter(req.query.filter);
    if (!filterResult.valid) {
      return res.status(400).json({ success: false, error: filterResult.error });
    }

    const args = ['-u', 'homepinas.service', '--no-pager', '-n', String(linesResult.value), '--output=short-iso'];
    const output = await readJournalctl(args, filterResult.value);

    res.json({
      success: true,
      logs: output,
      lines: linesResult.value,
      filter: filterResult.value,
      source: 'homepinas.service'
    });
  } catch (error) {
    console.error('Error reading app logs:', error);
    res.status(500).json({ success: false, error: `Failed to read application logs: ${error.message}` });
  }
});

/**
 * GET /auth
 * Read auth/security logs (SSH service) via journalctl.
 * Query params: lines (default 100, max 1000), filter (grep pattern)
 */
router.get('/auth', async (req, res) => {
  try {
    const linesResult = validateLines(req.query.lines);
    if (!linesResult.valid) {
      return res.status(400).json({ success: false, error: linesResult.error });
    }

    const filterResult = validateFilter(req.query.filter);
    if (!filterResult.valid) {
      return res.status(400).json({ success: false, error: filterResult.error });
    }

    const args = ['-u', 'ssh', '-n', String(linesResult.value), '--no-pager', '--output=short-iso'];
    const output = await readJournalctl(args, filterResult.value);

    res.json({
      success: true,
      logs: output,
      lines: linesResult.value,
      filter: filterResult.value,
      source: 'ssh.service'
    });
  } catch (error) {
    console.error('Error reading auth logs:', error);
    res.status(500).json({ success: false, error: `Failed to read auth logs: ${error.message}` });
  }
});

/**
 * GET /docker
 * Read Docker daemon logs via journalctl.
 * Query params: lines (default 100, max 1000), filter (grep pattern)
 */
router.get('/docker', async (req, res) => {
  try {
    const linesResult = validateLines(req.query.lines);
    if (!linesResult.valid) {
      return res.status(400).json({ success: false, error: linesResult.error });
    }

    const filterResult = validateFilter(req.query.filter);
    if (!filterResult.valid) {
      return res.status(400).json({ success: false, error: filterResult.error });
    }

    const args = ['-u', 'docker.service', '-n', String(linesResult.value), '--no-pager', '--output=short-iso'];
    const output = await readJournalctl(args, filterResult.value);

    res.json({
      success: true,
      logs: output,
      lines: linesResult.value,
      filter: filterResult.value,
      source: 'docker.service'
    });
  } catch (error) {
    console.error('Error reading Docker logs:', error);
    res.status(500).json({ success: false, error: `Failed to read Docker logs: ${error.message}` });
  }
});

/**
 * GET /samba
 * Read Samba logs from /var/log/samba/log.smbd.
 * Query params: lines (default 100, max 1000)
 */
router.get('/samba', async (req, res) => {
  try {
    const linesResult = validateLines(req.query.lines);
    if (!linesResult.valid) {
      return res.status(400).json({ success: false, error: linesResult.error });
    }

    const sambaLogPath = '/var/log/samba/log.smbd';

    try {
      const content = await readFileAsync(sambaLogPath, 'utf8');
      const output = getLastLines(content, linesResult.value);

      res.json({
        success: true,
        logs: output,
        lines: linesResult.value,
        source: sambaLogPath
      });
    } catch (fileError) {
      if (fileError.code === 'ENOENT') {
        return res.status(404).json({ success: false, error: 'Samba log file not found. Is Samba installed?' });
      }
      if (fileError.code === 'EACCES') {
        return res.status(403).json({ success: false, error: 'Permission denied reading Samba log file' });
      }
      throw fileError;
    }
  } catch (error) {
    console.error('Error reading Samba logs:', error);
    res.status(500).json({ success: false, error: `Failed to read Samba logs: ${error.message}` });
  }
});

/**
 * GET /files
 * List available log files in /var/log/.
 * Returns file names and sizes only (no content).
 */
router.get('/files', async (req, res) => {
  try {
    const logDir = '/var/log';
    const entries = await readdirAsync(logDir, { withFileTypes: true });

    const files = [];
    for (const entry of entries) {
      try {
        const fullPath = path.join(logDir, entry.name);
        const stats = await statAsync(fullPath);
        files.push({
          name: entry.name,
          isDirectory: entry.isDirectory(),
          size: stats.size,
          modified: stats.mtime.toISOString()
        });
      } catch (statError) {
        // Skip files we can't stat (permission issues)
        files.push({
          name: entry.name,
          isDirectory: entry.isDirectory(),
          size: null,
          modified: null,
          error: 'Permission denied'
        });
      }
    }

    // Sort alphabetically
    files.sort((a, b) => a.name.localeCompare(b.name));

    res.json({ success: true, files: files, directory: logDir });
  } catch (error) {
    console.error('Error listing log files:', error);
    res.status(500).json({ success: false, error: `Failed to list log files: ${error.message}` });
  }
});

/**
 * GET /file
 * Read a specific log file from /var/log/.
 * Query params: path (required, relative to /var/log/), lines (default 100, max 1000)
 * Validates that the resolved path stays within /var/log/ to prevent directory traversal.
 */
router.get('/file', async (req, res) => {
  try {
    const filePath = req.query.path;

    if (!filePath || typeof filePath !== 'string') {
      return res.status(400).json({ success: false, error: 'File path is required' });
    }

    const linesResult = validateLines(req.query.lines);
    if (!linesResult.valid) {
      return res.status(400).json({ success: false, error: linesResult.error });
    }

    // Security: resolve the path and ensure it stays within /var/log/
    const baseDir = '/var/log';
    const resolvedPath = path.resolve(baseDir, filePath);

    if (!resolvedPath.startsWith(baseDir + '/') && resolvedPath !== baseDir) {
      logSecurityEvent('logs', 'directory_traversal_attempt', {
        user: req.user.username,
        requestedPath: filePath,
        resolvedPath: resolvedPath
      });
      return res.status(403).json({ success: false, error: 'Access denied: path must be within /var/log/' });
    }

    try {
      // Check if the path is a file (not directory)
      const stats = await statAsync(resolvedPath);
      if (stats.isDirectory()) {
        return res.status(400).json({ success: false, error: 'Specified path is a directory, not a file' });
      }

      // Read file and return last N lines
      const content = await readFileAsync(resolvedPath, 'utf8');
      const output = getLastLines(content, linesResult.value);

      res.json({
        success: true,
        logs: output,
        lines: linesResult.value,
        file: resolvedPath,
        totalSize: stats.size
      });
    } catch (fileError) {
      if (fileError.code === 'ENOENT') {
        return res.status(404).json({ success: false, error: 'Log file not found' });
      }
      if (fileError.code === 'EACCES') {
        return res.status(403).json({ success: false, error: 'Permission denied reading log file' });
      }
      throw fileError;
    }
  } catch (error) {
    console.error('Error reading log file:', error);
    res.status(500).json({ success: false, error: `Failed to read log file: ${error.message}` });
  }
});

module.exports = router;
