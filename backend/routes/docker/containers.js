/**
 * HomePiNAS Docker - Container Management Routes
 * REFACTORED: Business logic moved to services/docker.js
 * Routes handle: request parsing → service call → response formatting
 */

const express = require('express');
const router = express.Router();
const { requireAuth } = require('../../middleware/auth');
const { logSecurityEvent } = require('../../utils/security');
const { validateDockerAction, validateContainerId } = require('../../utils/sanitize');
const dockerService = require('../../services/docker');

/**
 * GET /containers
 * List all containers with stats, ports, and metadata
 */
router.get('/containers', requireAuth, async (req, res) => {
    try {
        const containers = await dockerService.listContainers({ all: true });
        res.json({ containers, count: containers.length });
    } catch (error) {
        console.error('List containers error:', error);
        res.status(500).json({ error: 'Failed to list containers' });
    }
});

/**
 * GET /containers/:id
 * Get detailed container information
 */
router.get('/containers/:id', requireAuth, async (req, res) => {
    try {
        const containerId = validateContainerId(req.params.id);
        if (!containerId) {
            return res.status(400).json({ error: 'Invalid container ID' });
        }

        const container = await dockerService.getContainer(containerId);
        res.json({ container });
    } catch (error) {
        console.error('Get container error:', error);
        if (error.statusCode === 404) {
            return res.status(404).json({ error: 'Container not found' });
        }
        res.status(500).json({ error: 'Failed to get container' });
    }
});

/**
 * POST /containers/:id/start
 * Start a container
 */
router.post('/containers/:id/start', requireAuth, async (req, res) => {
    try {
        const containerId = validateContainerId(req.params.id);
        if (!containerId) {
            return res.status(400).json({ error: 'Invalid container ID' });
        }

        const result = await dockerService.startContainer(containerId);
        
        if (!result.success) {
            return res.status(500).json({ error: result.error });
        }

        logSecurityEvent('CONTAINER_STARTED', { containerId }, req.ip);
        res.json({ success: true, message: 'Container started' });
    } catch (error) {
        console.error('Start container error:', error);
        res.status(500).json({ error: 'Failed to start container' });
    }
});

/**
 * POST /containers/:id/stop
 * Stop a container
 */
router.post('/containers/:id/stop', requireAuth, async (req, res) => {
    try {
        const containerId = validateContainerId(req.params.id);
        if (!containerId) {
            return res.status(400).json({ error: 'Invalid container ID' });
        }

        const result = await dockerService.stopContainer(containerId);
        
        if (!result.success) {
            return res.status(500).json({ error: result.error });
        }

        logSecurityEvent('CONTAINER_STOPPED', { containerId }, req.ip);
        res.json({ success: true, message: 'Container stopped' });
    } catch (error) {
        console.error('Stop container error:', error);
        res.status(500).json({ error: 'Failed to stop container' });
    }
});

/**
 * POST /containers/:id/restart
 * Restart a container
 */
router.post('/containers/:id/restart', requireAuth, async (req, res) => {
    try {
        const containerId = validateContainerId(req.params.id);
        if (!containerId) {
            return res.status(400).json({ error: 'Invalid container ID' });
        }

        const result = await dockerService.restartContainer(containerId);
        
        if (!result.success) {
            return res.status(500).json({ error: result.error });
        }

        logSecurityEvent('CONTAINER_RESTARTED', { containerId }, req.ip);
        res.json({ success: true, message: 'Container restarted' });
    } catch (error) {
        console.error('Restart container error:', error);
        res.status(500).json({ error: 'Failed to restart container' });
    }
});

/**
 * DELETE /containers/:id
 * Remove a container
 */
router.delete('/containers/:id', requireAuth, async (req, res) => {
    try {
        const containerId = validateContainerId(req.params.id);
        if (!containerId) {
            return res.status(400).json({ error: 'Invalid container ID' });
        }

        const { force, volumes } = req.body;

        const result = await dockerService.removeContainer(containerId, { force, volumes });
        
        if (!result.success) {
            return res.status(500).json({ error: result.error });
        }

        logSecurityEvent('CONTAINER_REMOVED', { containerId, force, volumes }, req.ip);
        res.json({ success: true, message: 'Container removed' });
    } catch (error) {
        console.error('Remove container error:', error);
        res.status(500).json({ error: 'Failed to remove container' });
    }
});

/**
 * GET /containers/:id/logs
 * Get container logs
 */
router.get('/containers/:id/logs', requireAuth, async (req, res) => {
    try {
        const containerId = validateContainerId(req.params.id);
        if (!containerId) {
            return res.status(400).json({ error: 'Invalid container ID' });
        }

        const tail = parseInt(req.query.tail) || 100;
        const timestamps = req.query.timestamps !== 'false';

        const logs = await dockerService.getContainerLogs(containerId, { tail, timestamps });
        res.json({ logs });
    } catch (error) {
        console.error('Get container logs error:', error);
        res.status(500).json({ error: 'Failed to get logs' });
    }
});

/**
 * GET /containers/:id/stats
 * Get container stats
 */
router.get('/containers/:id/stats', requireAuth, async (req, res) => {
    try {
        const containerId = validateContainerId(req.params.id);
        if (!containerId) {
            return res.status(400).json({ error: 'Invalid container ID' });
        }

        const stats = await dockerService.getContainerStats(containerId);
        res.json({ stats });
    } catch (error) {
        console.error('Get container stats error:', error);
        res.status(500).json({ error: 'Failed to get stats' });
    }
});

/**
 * PUT /containers/:id/notes
 * Update container notes
 */
router.put('/containers/:id/notes', requireAuth, async (req, res) => {
    try {
        const containerId = validateContainerId(req.params.id);
        if (!containerId) {
            return res.status(400).json({ error: 'Invalid container ID' });
        }

        const { notes } = req.body;

        const result = dockerService.updateContainerNotes(containerId, notes);
        
        if (!result.success) {
            return res.status(500).json({ error: result.error });
        }

        res.json({ success: true, message: 'Notes updated' });
    } catch (error) {
        console.error('Update notes error:', error);
        res.status(500).json({ error: 'Failed to update notes' });
    }
});

module.exports = router;
