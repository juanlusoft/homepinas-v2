/**
 * HomePiNAS v2 - HomeStore Installation
 * Install, uninstall, and update apps
 */
const express = require('express');
const router = express.Router();
const { execFile } = require('child_process');
const { requireAuth } = require('../../middleware/auth');
const {
    APPS_BASE,
    validateAppId,
    loadCatalog,
    loadInstalled,
    saveInstalled,
    loadAppConfig,
    saveAppConfig,
    ensureDirectory,
    checkDocker
} = require('./helpers');

/**
 * POST /install/:id - Install an app with config
 */
router.post('/install/:id', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        if (!validateAppId(id)) {
            return res.status(400).json({ error: 'Invalid app ID' });
        }
        const { config } = req.body || {};

        // Check Docker
        if (!await checkDocker()) {
            return res.status(400).json({ success: false, error: 'Docker is not available' });
        }
        
        const catalog = await loadCatalog();
        const installed = await loadInstalled();
        
        const app = catalog.apps.find(a => a.id === id);
        if (!app) {
            return res.status(404).json({ success: false, error: 'App not found' });
        }
        
        if (installed.apps[id]) {
            return res.status(400).json({ success: false, error: 'App is already installed' });
        }
        
        // Merge default volumes with custom config
        const finalVolumes = { ...app.volumes };
        if (config?.volumes) {
            // Custom volumes override defaults (key is container path)
            for (const [containerPath, hostPath] of Object.entries(config.volumes)) {
                if (finalVolumes[containerPath] !== undefined) {
                    finalVolumes[containerPath] = hostPath;
                }
            }
        }
        
        // Merge default ports with custom config
        const finalPorts = { ...app.ports };
        if (config?.ports) {
            // Custom ports: the config.ports has hostPort as key
            // We need to rebuild the ports mapping
            const newPorts = {};
            for (const [hostPort, containerPort] of Object.entries(config.ports)) {
                newPorts[hostPort] = containerPort;
            }
            // Replace all ports with custom ones
            Object.keys(finalPorts).forEach(k => delete finalPorts[k]);
            Object.assign(finalPorts, newPorts);
        }
        
        // Create app directories for volumes
        for (const [containerPath, hostPath] of Object.entries(finalVolumes)) {
            const created = await ensureDirectory(hostPath);
            if (!created) {
                console.warn(`Could not create directory: ${hostPath}`);
            }
        }
        
        // Build docker run args array
        const dockerArgs = ['run', '-d', '--name', `homestore-${id}`, '--restart', 'unless-stopped'];

        // Add ports
        for (const [host, container] of Object.entries(finalPorts)) {
            // Handle port formats like "51820/udp"
            const hostPort = host.split('/')[0];
            const protocol = host.includes('/') ? host.split('/')[1] : '';
            const containerPort = container.includes('/') ? container : (protocol ? `${container}/${protocol}` : container);
            dockerArgs.push('-p', `${hostPort}:${containerPort}`);
        }

        // Add volumes
        for (const [container, host] of Object.entries(finalVolumes)) {
            dockerArgs.push('-v', `${host}:${container}`);
        }

        // Add environment variables (merge defaults with user config)
        const envVars = { ...app.env, ...(config?.env || {}) };
        for (const [key, value] of Object.entries(envVars)) {
            dockerArgs.push('-e', `${key}=${String(value)}`);
        }

        // Add capabilities
        if (app.capabilities) {
            for (const cap of app.capabilities) {
                dockerArgs.push('--cap-add', cap);
            }
        }

        // Add sysctls
        if (app.sysctls) {
            for (const [key, value] of Object.entries(app.sysctls)) {
                dockerArgs.push('--sysctl', `${key}=${value}`);
            }
        }

        // Add privileged if needed
        if (app.privileged) {
            dockerArgs.push('--privileged');
        }

        // Add image
        dockerArgs.push(app.image);

        console.log('Installing app:', 'docker', dockerArgs.join(' '));

        // Execute
        await new Promise((resolve, reject) => {
            execFile('docker', dockerArgs, { timeout: 300000 }, (err, stdout, stderr) => {
                if (err) {
                    console.error('Install error:', stderr);
                    reject(new Error(stderr || err.message));
                } else {
                    resolve(stdout);
                }
            });
        });
        
        // Build full config to save
        const fullConfig = {
            volumes: finalVolumes,
            ports: finalPorts,
            env: envVars,
            installedAt: new Date().toISOString()
        };
        
        // Save config for future reinstalls
        await saveAppConfig(id, fullConfig);
        
        // Save to installed
        installed.apps[id] = {
            installedAt: new Date().toISOString(),
            config: fullConfig
        };
        await saveInstalled(installed);
        
        // Determine which port to use for webUI
        let webUIPort = app.webUI;
        if (config?.ports) {
            // Find the port mapping for the webUI
            for (const [hostPort, containerPort] of Object.entries(finalPorts)) {
                const cPort = String(containerPort).split('/')[0];
                if (cPort === String(app.webUI)) {
                    webUIPort = hostPort.split('/')[0];
                    break;
                }
            }
        }
        
        res.json({
            success: true,
            message: `${app.name} installed successfully`,
            webUI: webUIPort || null
        });
        
    } catch (error) {
        console.error('Install error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /uninstall/:id - Uninstall an app, optionally remove data
 */
router.post('/uninstall/:id', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        if (!validateAppId(id)) {
            return res.status(400).json({ error: 'Invalid app ID' });
        }
        const { removeData } = req.body || {};

        const catalog = await loadCatalog();
        const installed = await loadInstalled();

        const app = catalog.apps.find(a => a.id === id);
        if (!app) {
            return res.status(404).json({ success: false, error: 'App not found' });
        }

        if (!installed.apps[id]) {
            return res.status(400).json({ success: false, error: 'App is not installed' });
        }

        // Stop and remove container
        await new Promise((resolve) => {
            execFile('docker', ['stop', `homestore-${id}`], (err) => {
                execFile('docker', ['rm', `homestore-${id}`], (err) => {
                    resolve(); // Continue even if error (container might not exist)
                });
            });
        });
        
        // Optionally remove data
        if (removeData) {
            const appDir = `${APPS_BASE}/${id}`;
            await new Promise((resolve) => {
                execFile('rm', ['-rf', appDir], (err) => resolve());
            });
        }
        
        // Remove from installed
        delete installed.apps[id];
        await saveInstalled(installed);
        
        res.json({
            success: true,
            message: `${app.name} uninstalled successfully`
        });
        
    } catch (error) {
        console.error('Uninstall error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /update/:id - Update an app (pull new image and recreate)
 */
router.post('/update/:id', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        if (!validateAppId(id)) {
            return res.status(400).json({ error: 'Invalid app ID' });
        }

        const catalog = await loadCatalog();
        const installed = await loadInstalled();
        
        const app = catalog.apps.find(a => a.id === id);
        if (!app) {
            return res.status(404).json({ success: false, error: 'App not found' });
        }
        
        if (!installed.apps[id]) {
            return res.status(400).json({ success: false, error: 'App is not installed' });
        }
        
        // Pull new image
        await new Promise((resolve, reject) => {
            execFile('docker', ['pull', app.image], { timeout: 600000 }, (err, stdout, stderr) => {
                if (err) reject(new Error(stderr || err.message));
                else resolve();
            });
        });

        // Stop and remove old container
        await new Promise((resolve) => {
            execFile('docker', ['stop', `homestore-${id}`], () => {
                execFile('docker', ['rm', `homestore-${id}`], () => resolve());
            });
        });
        
        // Load saved config (persisted from installation)
        const savedConfig = await loadAppConfig(id);
        const config = savedConfig || installed.apps[id].config || {};
        
        // Use saved volumes/ports or fall back to defaults
        const finalVolumes = config.volumes || app.volumes || {};
        const finalPorts = config.ports || app.ports || {};
        const finalEnv = config.env || app.env || {};
        
        // Build docker run args array with saved configuration
        const dockerArgs = ['run', '-d', '--name', `homestore-${id}`, '--restart', 'unless-stopped'];

        // Add ports
        for (const [host, container] of Object.entries(finalPorts)) {
            const hostPort = host.split('/')[0];
            const protocol = host.includes('/') ? host.split('/')[1] : '';
            const containerPort = container.includes('/') ? container : (protocol ? `${container}/${protocol}` : container);
            dockerArgs.push('-p', `${hostPort}:${containerPort}`);
        }

        // Add volumes
        for (const [container, host] of Object.entries(finalVolumes)) {
            dockerArgs.push('-v', `${host}:${container}`);
        }

        // Add environment variables
        for (const [key, value] of Object.entries(finalEnv)) {
            dockerArgs.push('-e', `${key}=${String(value)}`);
        }

        if (app.capabilities) {
            for (const cap of app.capabilities) {
                dockerArgs.push('--cap-add', cap);
            }
        }

        if (app.sysctls) {
            for (const [key, value] of Object.entries(app.sysctls)) {
                dockerArgs.push('--sysctl', `${key}=${value}`);
            }
        }

        if (app.privileged) {
            dockerArgs.push('--privileged');
        }

        dockerArgs.push(app.image);

        console.log('Updating app with config:', 'docker', dockerArgs.join(' '));

        await new Promise((resolve, reject) => {
            execFile('docker', dockerArgs, { timeout: 300000 }, (err, stdout, stderr) => {
                if (err) reject(new Error(stderr || err.message));
                else resolve();
            });
        });
        
        // Update installed timestamp
        installed.apps[id].updatedAt = new Date().toISOString();
        await saveInstalled(installed);
        
        res.json({ success: true, message: `${app.name} updated successfully` });
        
    } catch (error) {
        console.error('Update error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
