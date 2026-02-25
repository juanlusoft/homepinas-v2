/**
 * HomePiNAS v2 - Scheduler Operations
 * Run, toggle, view crontab
 */
const express = require('express');
const router = express.Router();
const { execFile } = require('child_process');
const { requireAuth } = require('../../middleware/auth');
const { logSecurityEvent } = require('../../utils/security');
const { getData, saveData } = require('../../utils/data');
const { findDangerousPattern, writeCrontab } = require('./helpers');

/**
 * POST /tasks/:id/run - Execute a task immediately
 */
router.post('/tasks/:id/run', requireAuth, (req, res) => {
  try {
    const data = getData();
    if (!data.scheduledTasks) data.scheduledTasks = [];

    const task = data.scheduledTasks.find(t => t.id === req.params.id);
    if (!task) {
      return res.status(404).json({ success: false, error: 'Task not found' });
    }

    const dangerousMatch = findDangerousPattern(task.command);
    if (dangerousMatch) {
      return res.status(400).json({
        success: false,
        error: `Command contains dangerous pattern: "${dangerousMatch}"`
      });
    }

    execFile('/bin/sh', ['-c', task.command], {
      timeout: 60000,
      maxBuffer: 1024 * 1024
    }, (err, stdout, stderr) => {
      const finishedAt = new Date().toISOString();
      const result = err ? 'failed' : 'success';

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
 */
router.post('/tasks/:id/toggle', requireAuth, async (req, res) => {
  try {
    const data = getData();
    if (!data.scheduledTasks) data.scheduledTasks = [];

    const task = data.scheduledTasks.find(t => t.id === req.params.id);
    if (!task) {
      return res.status(404).json({ success: false, error: 'Task not found' });
    }

    task.enabled = !task.enabled;
    task.updatedAt = new Date().toISOString();
    saveData(data);

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
 * GET /crontab - Read and display the current system crontab
 */
router.get('/crontab', requireAuth, (req, res) => {
  execFile('crontab', ['-l'], (err, stdout, stderr) => {
    if (err) {
      if (stderr && stderr.includes('no crontab for')) {
        return res.json({ success: true, crontab: '', message: 'No crontab configured' });
      }
      return res.status(500).json({ success: false, error: 'Failed to read crontab' });
    }
    res.json({ success: true, crontab: stdout });
  });
});

module.exports = router;
