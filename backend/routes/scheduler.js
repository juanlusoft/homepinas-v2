/**
 * HomePiNAS v2 - Task Scheduler Routes (Cron Manager)
 * 
 * Manage system cron jobs through the dashboard.
 * Provides CRUD operations for scheduled tasks and writes them to system crontab.
 */

const express = require('express');
const router = express.Router();
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { requireAuth } = require('../middleware/auth');
const { logSecurityEvent } = require('../utils/security');
const { getData, saveData } = require('../utils/data');

// --- Validation Helpers ---

/** Regex to validate standard 5-field cron expressions */
const CRON_REGEX = /^(\*|[0-9,\-\/]+)\s+(\*|[0-9,\-\/]+)\s+(\*|[0-9,\-\/]+)\s+(\*|[0-9,\-\/]+)\s+(\*|[0-9,\-\/]+)$/;

/** Dangerous command patterns that must be blocked for safety */
const DANGEROUS_PATTERNS = [
  'rm -rf /',
  'mkfs',
  'dd if=',
  ':(){ :|:& };:',
  '> /dev/sda',
  'chmod -R 777 /',
  '$(', '`',       // command substitution
  '| ', ' |',      // pipes
  '; ',             // command chaining
  '&& ', '|| ',    // logical operators
  '> /dev/',        // writing to devices
  '/etc/shadow',    // sensitive files
  '/etc/passwd',
  'curl ', 'wget ', // downloads
  'python ', 'perl ', 'ruby ', // script interpreters
  'nc ', 'ncat ',   // netcat
  'base64',         // encoding tricks
  'eval ',          // eval
];

/**
 * Validate a cron expression string.
 * @param {string} expr - The cron expression to validate
 * @returns {boolean} True if the expression is valid
 */
function isValidCron(expr) {
  if (!expr || typeof expr !== 'string') return false;
  return CRON_REGEX.test(expr.trim());
}

/**
 * Check if a command contains dangerous patterns.
 * @param {string} command - The shell command to check
 * @returns {string|null} The matched dangerous pattern, or null if safe
 */
function findDangerousPattern(command) {
  if (!command || typeof command !== 'string') return null;
  const lower = command.toLowerCase();
  for (const pattern of DANGEROUS_PATTERNS) {
    if (lower.includes(pattern.toLowerCase())) {
      return pattern;
    }
  }
  return null;
}

/**
 * Generate a unique ID for tasks.
 * @returns {string} Base-36 encoded timestamp
 */
function generateId() {
  return Date.now().toString(36);
}

/**
 * Write all enabled tasks to the system crontab.
 * Generates crontab content with a HomePiNAS header, writes to a temp file,
 * then applies it with `crontab tempfile`.
 * @returns {Promise<void>}
 */
function writeCrontab() {
  return new Promise((resolve, reject) => {
    const data = getData();
    const tasks = data.scheduledTasks || [];

    // Build crontab content
    let content = '# HomePiNAS v2 - Managed Crontab\n';
    content += '# DO NOT EDIT MANUALLY - Changes will be overwritten by HomePiNAS\n';
    content += `# Last updated: ${new Date().toISOString()}\n\n`;

    tasks.forEach(task => {
      if (task.enabled) {
        // Active task: schedule command
        content += `# ${task.name} (ID: ${task.id})\n`;
        content += `${task.schedule} ${task.command}\n\n`;
      } else {
        // Disabled task: comment it out
        content += `# ${task.name} (ID: ${task.id}) [DISABLED]\n`;
        content += `# ${task.schedule} ${task.command}\n\n`;
      }
    });

    // Write to temp file
    const tmpFile = path.join('/mnt/storage/.tmp', `homepinas-crontab-${Date.now()}`);
    fs.writeFile(tmpFile, content, (writeErr) => {
      if (writeErr) {
        return reject(new Error(`Failed to write temp crontab: ${writeErr.message}`));
      }

      // Apply crontab from temp file
      execFile('crontab', [tmpFile], (execErr, stdout, stderr) => {
        // Clean up temp file regardless of result
        fs.unlink(tmpFile, () => {}); // Ignore cleanup errors

        if (execErr) {
          return reject(new Error(`Failed to apply crontab: ${execErr.message}`));
        }
        resolve();
      });
    });
  });
}

// All routes require authentication
router.use(requireAuth);

// --- Routes ---

/**
 * GET /tasks - List all scheduled tasks
 */
router.get('/tasks', (req, res) => {
  try {
    const data = getData();
    const tasks = data.scheduledTasks || [];
    res.json({ success: true, tasks });
  } catch (err) {
    console.error('Error listing tasks:', err);
    res.status(500).json({ success: false, error: 'Failed to list scheduled tasks' });
  }
});

/**
 * POST /tasks - Create a new scheduled task
 * Body: { name, command, schedule, enabled, user }
 */
router.post('/tasks', async (req, res) => {
  try {
    const { name, command, schedule, enabled, user } = req.body;

    // Validate name
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({ success: false, error: 'Task name is required' });
    }

    // Validate command
    if (!command || typeof command !== 'string' || command.trim().length === 0) {
      return res.status(400).json({ success: false, error: 'Command is required' });
    }
    if (command.length > 500) {
      return res.status(400).json({ success: false, error: 'Command must be 500 characters or fewer' });
    }

    // Check for dangerous patterns
    const dangerousMatch = findDangerousPattern(command);
    if (dangerousMatch) {
      logSecurityEvent('dangerous_command_blocked', {
        command,
        pattern: dangerousMatch,
        user: req.user
      });
      return res.status(400).json({
        success: false,
        error: `Command contains dangerous pattern: "${dangerousMatch}"`
      });
    }

    // Validate cron schedule
    if (!isValidCron(schedule)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid cron expression. Use 5-field format: minute hour day month weekday'
      });
    }

    const task = {
      id: generateId(),
      name: name.trim(),
      command: command.trim(),
      schedule: schedule.trim(),
      enabled: typeof enabled === 'boolean' ? enabled : true,
      user: (user && typeof user === 'string') ? user.trim() : 'root',
      createdAt: new Date().toISOString(),
      lastRun: null,
      lastResult: null
    };

    const data = getData();
    if (!data.scheduledTasks) data.scheduledTasks = [];
    data.scheduledTasks.push(task);
    saveData(data);

    // Update system crontab
    await writeCrontab();

    logSecurityEvent('task_created', { taskId: task.id, name: task.name, user: req.user });

    res.status(201).json({ success: true, task });
  } catch (err) {
    console.error('Error creating task:', err);
    res.status(500).json({ success: false, error: 'Failed to create task' });
  }
});

/**
 * PUT /tasks/:id - Update an existing scheduled task
 */
router.put('/tasks/:id', async (req, res) => {
  try {
    const data = getData();
    if (!data.scheduledTasks) data.scheduledTasks = [];

    const taskIndex = data.scheduledTasks.findIndex(t => t.id === req.params.id);
    if (taskIndex === -1) {
      return res.status(404).json({ success: false, error: 'Task not found' });
    }

    const task = data.scheduledTasks[taskIndex];
    const { name, command, schedule, enabled, user } = req.body;

    // Validate and update fields if provided
    if (name !== undefined) {
      if (typeof name !== 'string' || name.trim().length === 0) {
        return res.status(400).json({ success: false, error: 'Task name cannot be empty' });
      }
      task.name = name.trim();
    }

    if (command !== undefined) {
      if (typeof command !== 'string' || command.trim().length === 0) {
        return res.status(400).json({ success: false, error: 'Command cannot be empty' });
      }
      if (command.length > 500) {
        return res.status(400).json({ success: false, error: 'Command must be 500 characters or fewer' });
      }
      const dangerousMatch = findDangerousPattern(command);
      if (dangerousMatch) {
        logSecurityEvent('dangerous_command_blocked', {
          command,
          pattern: dangerousMatch,
          user: req.user
        });
        return res.status(400).json({
          success: false,
          error: `Command contains dangerous pattern: "${dangerousMatch}"`
        });
      }
      task.command = command.trim();
    }

    if (schedule !== undefined) {
      if (!isValidCron(schedule)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid cron expression. Use 5-field format: minute hour day month weekday'
        });
      }
      task.schedule = schedule.trim();
    }

    if (typeof enabled === 'boolean') {
      task.enabled = enabled;
    }

    if (user !== undefined && typeof user === 'string') {
      task.user = user.trim();
    }

    task.updatedAt = new Date().toISOString();
    data.scheduledTasks[taskIndex] = task;
    saveData(data);

    // Rewrite system crontab
    await writeCrontab();

    logSecurityEvent('task_updated', { taskId: task.id, name: task.name, user: req.user });

    res.json({ success: true, task });
  } catch (err) {
    console.error('Error updating task:', err);
    res.status(500).json({ success: false, error: 'Failed to update task' });
  }
});

/**
 * DELETE /tasks/:id - Delete a scheduled task
 */
router.delete('/tasks/:id', async (req, res) => {
  try {
    const data = getData();
    if (!data.scheduledTasks) data.scheduledTasks = [];

    const taskIndex = data.scheduledTasks.findIndex(t => t.id === req.params.id);
    if (taskIndex === -1) {
      return res.status(404).json({ success: false, error: 'Task not found' });
    }

    const removed = data.scheduledTasks.splice(taskIndex, 1)[0];
    saveData(data);

    // Rewrite system crontab without the deleted task
    await writeCrontab();

    logSecurityEvent('task_deleted', { taskId: removed.id, name: removed.name, user: req.user });

    res.json({ success: true, message: 'Task deleted' });
  } catch (err) {
    console.error('Error deleting task:', err);
    res.status(500).json({ success: false, error: 'Failed to delete task' });
  }
});

/**
 * POST /tasks/:id/run - Execute a task immediately
 * Runs the command and returns its output.
 */
router.post('/tasks/:id/run', (req, res) => {
  try {
    const data = getData();
    if (!data.scheduledTasks) data.scheduledTasks = [];

    const task = data.scheduledTasks.find(t => t.id === req.params.id);
    if (!task) {
      return res.status(404).json({ success: false, error: 'Task not found' });
    }

    // Re-check for dangerous patterns at runtime
    const dangerousMatch = findDangerousPattern(task.command);
    if (dangerousMatch) {
      return res.status(400).json({
        success: false,
        error: `Command contains dangerous pattern: "${dangerousMatch}"`
      });
    }

    // Execute command via shell
    execFile('/bin/sh', ['-c', task.command], {
      timeout: 60000, // 60 second timeout for immediate execution
      maxBuffer: 1024 * 1024 // 1MB output buffer
    }, (err, stdout, stderr) => {
      const finishedAt = new Date().toISOString();
      const result = err ? 'failed' : 'success';

      // Update task with run result
      const currentData = getData();
      const currentTask = currentData.scheduledTasks.find(t => t.id === req.params.id);
      if (currentTask) {
        currentTask.lastRun = finishedAt;
        currentTask.lastResult = result;
        saveData(currentData);
      }

      logSecurityEvent('task_executed', {
        taskId: task.id,
        name: task.name,
        result,
        user: req.user
      });

      if (err) {
        return res.json({
          success: true,
          result: 'failed',
          exitCode: err.code || null,
          stdout: stdout || '',
          stderr: stderr || err.message
        });
      }

      res.json({
        success: true,
        result: 'success',
        stdout: stdout || '',
        stderr: stderr || ''
      });
    });
  } catch (err) {
    console.error('Error executing task:', err);
    res.status(500).json({ success: false, error: 'Failed to execute task' });
  }
});

/**
 * POST /tasks/:id/toggle - Enable or disable a task
 * Toggles the enabled state and rewrites the crontab.
 */
router.post('/tasks/:id/toggle', async (req, res) => {
  try {
    const data = getData();
    if (!data.scheduledTasks) data.scheduledTasks = [];

    const task = data.scheduledTasks.find(t => t.id === req.params.id);
    if (!task) {
      return res.status(404).json({ success: false, error: 'Task not found' });
    }

    // Toggle enabled state
    task.enabled = !task.enabled;
    task.updatedAt = new Date().toISOString();
    saveData(data);

    // Rewrite crontab with updated state
    await writeCrontab();

    logSecurityEvent('task_toggled', {
      taskId: task.id,
      name: task.name,
      enabled: task.enabled,
      user: req.user
    });

    res.json({ success: true, task });
  } catch (err) {
    console.error('Error toggling task:', err);
    res.status(500).json({ success: false, error: 'Failed to toggle task' });
  }
});

/**
 * GET /crontab - Read and display the current system crontab (read-only)
 */
router.get('/crontab', (req, res) => {
  execFile('crontab', ['-l'], (err, stdout, stderr) => {
    if (err) {
      // crontab -l returns exit code 1 when no crontab exists
      if (stderr && stderr.includes('no crontab for')) {
        return res.json({ success: true, crontab: '', message: 'No crontab configured' });
      }
      return res.status(500).json({ success: false, error: 'Failed to read crontab' });
    }
    res.json({ success: true, crontab: stdout });
  });
});

module.exports = router;
