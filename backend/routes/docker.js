/**
 * HomePiNAS - Docker Routes
 * v1.5.6 - Modular Architecture
 *
 * Docker container management
 */

const express = require('express');
const router = express.Router();
const Docker = require('dockerode');

const { requireAuth } = require('../middleware/auth');
const { logSecurityEvent } = require('../utils/security');
const { validateDockerAction } = require('../utils/sanitize');

const docker = new Docker({ socketPath: '/var/run/docker.sock' });

// List containers
router.get('/containers', async (req, res) => {
    try {
        const containers = await docker.listContainers({ all: true });
        res.json(containers.map(c => ({
            id: c.Id,
            name: c.Names[0].replace('/', ''),
            status: c.State,
            image: c.Image,
            cpu: '---',
            ram: '---'
        })));
    } catch (e) {
        console.warn('Docker check failed:', e.message);
        res.json([]);
    }
});

// Container action (start, stop, restart)
router.post('/action', requireAuth, async (req, res) => {
    const { id, action } = req.body;

    if (!id || typeof id !== 'string') {
        return res.status(400).json({ error: 'Invalid container ID' });
    }

    if (!validateDockerAction(action)) {
        return res.status(400).json({ error: 'Invalid action. Must be start, stop, or restart' });
    }

    try {
        const container = docker.getContainer(id);
        logSecurityEvent('DOCKER_ACTION', { containerId: id, action, user: req.user.username }, req.ip);

        if (action === 'start') await container.start();
        if (action === 'stop') await container.stop();
        if (action === 'restart') await container.restart();
        res.json({ success: true });
    } catch (e) {
        console.error('Docker action error:', e.message);
        res.status(500).json({ error: 'Docker action failed' });
    }
});

module.exports = router;
