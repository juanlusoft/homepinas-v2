/**
 * HomePiNAS Docker - Container Management
 * Routes for container CRUD, actions, notes, and logs
 */

const express = require('express');
const router = express.Router();
const Docker = require('dockerode');

const { requireAuth } = require('../../middleware/auth');
const { logSecurityEvent } = require('../../utils/security');
const { validateDockerAction, validateContainerId } = require('../../utils/sanitize');
const {
    findComposeForContainer,
    parsePortMappings,
    loadUpdateCache,
    loadContainerNotes,
    saveContainerNotes
} = require('./helpers');

const docker = new Docker({ socketPath: '/var/run/docker.sock' });

// ═══════════════════════════════════════════════════════════════════════════
// CONTAINER ROUTES
// ═══════════════════════════════════════════════════════════════════════════

// List containers with update status, ports, and notes
router.get('/containers', requireAuth, async (req, res) => {
    try {
        const containers = await docker.listContainers({ all: true });
        const updateCache = loadUpdateCache();
        const containerNotes = loadContainerNotes();

        const result = await Promise.all(containers.map(async (c) => {
            const name = c.Names[0].replace('/', '');
            const image = c.Image;

            // Check if update is available from cache
            const hasUpdate = updateCache.updates[image] || false;

            // Get port mappings
            const ports = parsePortMappings(c.Ports);

            // Get notes for this container
            const notes = containerNotes[name] || containerNotes[c.Id] || '';

            // Find compose file if any
            const compose = findComposeForContainer(name);

            // Get container stats if running
            let cpu = '---';
            let ram = '---';

            if (c.State === 'running') {
                try {
                    const container = docker.getContainer(c.Id);
                    const stats = await container.stats({ stream: false });

                    // Calculate CPU percentage
                    const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - stats.precpu_stats.cpu_usage.total_usage;
                    const systemDelta = stats.cpu_stats.system_cpu_usage - stats.precpu_stats.system_cpu_usage;
                    const cpuPercent = (cpuDelta / systemDelta) * stats.cpu_stats.online_cpus * 100;
                    cpu = cpuPercent.toFixed(1) + '%';

                    // Calculate memory usage (check for undefined to avoid NaN)
                    if (stats.memory_stats?.usage) {
                        const memUsage = stats.memory_stats.usage / 1024 / 1024;
                        ram = memUsage.toFixed(0) + 'MB';
                    }
                } catch (e) {
                    // Stats not available
                }
            }

            return {
                id: c.Id,
                name,
                status: c.State,
                image,
                cpu,
                ram,
                ports,
                notes,
                compose,
                hasUpdate,
                created: c.Created
            };
        }));

        res.json(result);
    } catch (e) {
        console.warn('Docker check failed:', e.message);
        res.json([]);
    }
});

// Container action (start, stop, restart)
router.post('/action', requireAuth, async (req, res) => {
    const { id, action } = req.body;

    // SECURITY: Validate container ID format (hex string, 12-64 chars)
    if (!validateContainerId(id)) {
        return res.status(400).json({ error: 'Invalid container ID format' });
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

// ═══════════════════════════════════════════════════════════════════════════
// CONTAINER NOTES
// ═══════════════════════════════════════════════════════════════════════════

// Get notes for a container
router.get('/notes/:containerId', requireAuth, async (req, res) => {
    const { containerId } = req.params;
    
    if (!validateContainerId(containerId)) {
        return res.status(400).json({ error: 'Invalid container ID' });
    }

    const notes = loadContainerNotes();
    res.json({ notes: notes[containerId] || '' });
});

// Save notes for a container
router.post('/notes/:containerId', requireAuth, async (req, res) => {
    const { containerId } = req.params;
    const { notes } = req.body;
    
    if (!validateContainerId(containerId)) {
        return res.status(400).json({ error: 'Invalid container ID' });
    }

    if (typeof notes !== 'string') {
        return res.status(400).json({ error: 'Notes must be a string' });
    }

    // Limit notes length
    const safeNotes = notes.substring(0, 5000);

    const allNotes = loadContainerNotes();
    
    if (safeNotes.trim()) {
        allNotes[containerId] = safeNotes;
    } else {
        delete allNotes[containerId];
    }

    if (saveContainerNotes(allNotes)) {
        logSecurityEvent('CONTAINER_NOTES_SAVED', { containerId, user: req.user.username }, req.ip);
        res.json({ success: true, message: 'Notes saved' });
    } else {
        res.status(500).json({ error: 'Failed to save notes' });
    }
});

// ═══════════════════════════════════════════════════════════════════════════
// CONTAINER LOGS
// ═══════════════════════════════════════════════════════════════════════════

// Get container logs
router.get('/logs/:containerId', requireAuth, async (req, res) => {
    const { containerId } = req.params;
    const { tail = 100, since = '' } = req.query;
    
    if (!validateContainerId(containerId)) {
        return res.status(400).json({ error: 'Invalid container ID' });
    }

    try {
        const container = docker.getContainer(containerId);
        
        const opts = {
            stdout: true,
            stderr: true,
            tail: Math.min(parseInt(tail) || 100, 1000),
            timestamps: true
        };

        if (since) {
            opts.since = parseInt(since);
        }

        const logs = await container.logs(opts);
        
        // Parse logs (remove Docker stream header bytes)
        const logText = logs.toString('utf8');
        
        res.json({ 
            success: true, 
            logs: logText,
            containerId
        });
    } catch (e) {
        console.error('Container logs error:', e.message);
        res.status(500).json({ error: 'Failed to get container logs' });
    }
});

module.exports = router;
