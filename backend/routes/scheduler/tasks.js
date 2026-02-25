/**
 * HomePiNAS v2 - Scheduler Tasks CRUD
 * Create, read, update, delete scheduled tasks
 */
const express = require('express');
const router = express.Router();
const { requireAuth } = require('../../middleware/auth');
const { logSecurityEvent } = require('../../utils/security');
const { getData, saveData } = require('../../utils/data');
const {
    isValidCron,
    findDangerousPattern,
    generateId,
    writeCrontab
} = require('./helpers');

/**
 * GET /tasks - List all scheduled tasks
 */
router.get('/tasks', requireAuth, (req, res) => {
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
 */
router.post('/tasks', requireAuth, async (req, res) => {
  try {
    const { name, command, schedule, enabled, user } = req.body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({ success: false, error: 'Task name is required' });
    }

    if (!command || typeof command !== 'string' || command.trim().length === 0) {
      return res.status(400).json({ success: false, error: 'Command is required' });
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
router.put('/tasks/:id', requireAuth, async (req, res) => {
  try {
    const data = getData();
    if (!data.scheduledTasks) data.scheduledTasks = [];

    const taskIndex = data.scheduledTasks.findIndex(t => t.id === req.params.id);
    if (taskIndex === -1) {
      return res.status(404).json({ success: false, error: 'Task not found' });
    }

    const task = data.scheduledTasks[taskIndex];
    const { name, command, schedule, enabled, user } = req.body;

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
router.delete('/tasks/:id', requireAuth, async (req, res) => {
  try {
    const data = getData();
    if (!data.scheduledTasks) data.scheduledTasks = [];

    const taskIndex = data.scheduledTasks.findIndex(t => t.id === req.params.id);
    if (taskIndex === -1) {
      return res.status(404).json({ success: false, error: 'Task not found' });
    }

    const removed = data.scheduledTasks.splice(taskIndex, 1)[0];
    saveData(data);

    await writeCrontab();

    logSecurityEvent('task_deleted', { taskId: removed.id, name: removed.name, user: req.user });

    res.json({ success: true, message: 'Task deleted' });
  } catch (err) {
    console.error('Error deleting task:', err);
    res.status(500).json({ success: false, error: 'Failed to delete task' });
  }
});

module.exports = router;
