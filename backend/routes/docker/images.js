/**
 * HomePiNAS Docker - Image Management
 * Routes for checking and updating Docker images
 */

const express = require('express');
const router = express.Router();
const Docker = require('dockerode');

const { requireAuth } = require('../../middleware/auth');
const { logSecurityEvent } = require('../../utils/security');
const { validateContainerId } = require('../../utils/sanitize');
const { loadUpdateCache, saveUpdateCache } = require('./helpers');

const docker = new Docker({ socketPath: '/var/run/docker.sock' });

// ═══════════════════════════════════════════════════════════════════════════
// IMAGE UPDATE ROUTES
// ═══════════════════════════════════════════════════════════════════════════

// Check for image updates
router.post('/check-updates', requireAuth, async (req, res) => {
    try {
        logSecurityEvent('DOCKER_CHECK_UPDATES', { user: req.user.username }, req.ip);

        const containers = await docker.listContainers({ all: true });
        const images = [...new Set(containers.map(c => c.Image))];
        const updates = {};
        const results = [];

        for (const imageName of images) {
            try {
                // Get current image ID
                const currentImage = await docker.getImage(imageName).inspect();
                const currentId = currentImage.Id;

                // Pull latest and check if ID changed
                results.push(`Checking ${imageName}...`);

                await new Promise((resolve, reject) => {
                    docker.pull(imageName, (err, stream) => {
                        if (err) {
                            results.push(`  Skip: ${err.message}`);
                            resolve();
                            return;
                        }

                        docker.modem.followProgress(stream, async (err, output) => {
                            if (err) {
                                results.push(`  Error: ${err.message}`);
                                resolve();
                                return;
                            }

                            try {
                                const newImage = await docker.getImage(imageName).inspect();
                                const newId = newImage.Id;

                                if (newId !== currentId) {
                                    updates[imageName] = true;
                                    results.push(`  UPDATE AVAILABLE!`);
                                } else {
                                    updates[imageName] = false;
                                    results.push(`  Up to date`);
                                }
                            } catch (e) {
                                results.push(`  Check failed: ${e.message}`);
                            }
                            resolve();
                        });
                    });
                });
            } catch (e) {
                results.push(`${imageName}: Error - ${e.message}`);
            }
        }

        // Save update cache
        const cache = {
            lastCheck: new Date().toISOString(),
            updates
        };
        saveUpdateCache(cache);

        const updatesAvailable = Object.values(updates).filter(v => v).length;

        res.json({
            success: true,
            lastCheck: cache.lastCheck,
            updatesAvailable,
            totalImages: images.length,
            updates,
            log: results
        });
    } catch (e) {
        console.error('Docker update check error:', e);
        res.status(500).json({ error: 'Failed to check for updates' });
    }
});

// Get update status (cached)
router.get('/update-status', requireAuth, async (req, res) => {
    const cache = loadUpdateCache();
    res.json({
        lastCheck: cache.lastCheck,
        updates: cache.updates,
        updatesAvailable: Object.values(cache.updates).filter(v => v).length
    });
});

// Update a specific container
router.post('/update', requireAuth, async (req, res) => {
    const { containerId } = req.body;

    // SECURITY: Validate container ID format
    if (!validateContainerId(containerId)) {
        return res.status(400).json({ error: 'Invalid container ID format' });
    }

    try {
        const container = docker.getContainer(containerId);
        const info = await container.inspect();
        const imageName = info.Config.Image;
        const containerName = info.Name.replace('/', '');

        logSecurityEvent('DOCKER_UPDATE', { containerId, image: imageName, user: req.user.username }, req.ip);

        // Get container config for recreation
        const hostConfig = info.HostConfig;
        const config = info.Config;

        // Stop and remove old container
        try {
            await container.stop();
        } catch (e) {
            // Already stopped
        }
        await container.remove();

        // Pull latest image
        await new Promise((resolve, reject) => {
            docker.pull(imageName, (err, stream) => {
                if (err) return reject(err);
                docker.modem.followProgress(stream, (err) => {
                    if (err) return reject(err);
                    resolve();
                });
            });
        });

        // Recreate container with same config
        const newContainer = await docker.createContainer({
            Image: imageName,
            name: containerName,
            Env: config.Env,
            ExposedPorts: config.ExposedPorts,
            HostConfig: hostConfig,
            Labels: config.Labels,
            Volumes: config.Volumes
        });

        // Start the new container
        await newContainer.start();

        // Update cache - mark as no update available
        const cache = loadUpdateCache();
        cache.updates[imageName] = false;
        saveUpdateCache(cache);

        res.json({
            success: true,
            message: `Container ${containerName} updated successfully`,
            newContainerId: newContainer.id
        });
    } catch (e) {
        console.error('Docker update error:', e);
        res.status(500).json({ error: `Update failed: ${e.message}` });
    }
});

module.exports = router;
