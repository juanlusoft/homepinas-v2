const express = require('express');
const router = express.Router();
const { execFile, spawn } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
const { requireAuth } = require('../middleware/auth');

// Load catalog
const CATALOG_PATH = path.join(__dirname, '../data/homestore-catalog.json');
const APPS_BASE = '/opt/homepinas/apps';
const INSTALLED_PATH = path.join(__dirname, '../config/homestore-installed.json');
const APP_CONFIGS_PATH = path.join(__dirname, '../config/homestore-app-configs');

// Helper: Validate app/container ID to prevent command injection
function validateAppId(id) {
    return id && /^[a-zA-Z0-9_-]+$/.test(id);
}

// Helper: Load catalog
async function loadCatalog() {
    try {
        const data = await fs.readFile(CATALOG_PATH, 'utf8');
        return JSON.parse(data);
    } catch {
        return { apps: [], categories: [] };
    }
}

// Helper: Load installed apps
async function loadInstalled() {
    try {
        const data = await fs.readFile(INSTALLED_PATH, 'utf8');
        return JSON.parse(data);
    } catch {
        return { apps: {} };
    }
}

// Helper: Save installed apps
async function saveInstalled(installed) {
    await fs.writeFile(INSTALLED_PATH, JSON.stringify(installed, null, 2));
}

// Helper: Load app-specific config (for reinstalls)
async function loadAppConfig(appId) {
    try {
        await fs.mkdir(APP_CONFIGS_PATH, { recursive: true });
        const configPath = path.join(APP_CONFIGS_PATH, `${appId}.json`);
        const data = await fs.readFile(configPath, 'utf8');
        return JSON.parse(data);
    } catch {
        return null;
    }
}

// Helper: Save app-specific config
async function saveAppConfig(appId, config) {
    try {
        await fs.mkdir(APP_CONFIGS_PATH, { recursive: true });
        const configPath = path.join(APP_CONFIGS_PATH, `${appId}.json`);
        await fs.writeFile(configPath, JSON.stringify(config, null, 2));
    } catch (e) {
        console.error(`Failed to save config for ${appId}:`, e);
    }
}

// Helper: Validate and create directory if needed
async function ensureDirectory(dirPath) {
    try {
        // Skip special paths like docker.sock
        if (dirPath.includes('.sock') || dirPath.includes('/dev/')) {
            return true;
        }
        await fs.mkdir(dirPath, { recursive: true });
        return true;
    } catch (e) {
        console.error(`Failed to create directory ${dirPath}:`, e);
        return false;
    }
}

// Helper: Check if Docker is available
async function checkDocker() {
    return new Promise((resolve) => {
        execFile('docker', ['--version'], (err) => resolve(!err));
    });
}

// Helper: Get container status
async function getContainerStatus(appId) {
    return new Promise((resolve) => {
        execFile('docker', ['ps', '-a', '--filter', `name=homestore-${appId}`, '--format', '{{.Status}}'], (err, stdout) => {
            if (err || !stdout.trim()) {
                resolve(null);
            } else {
                const status = stdout.trim().toLowerCase();
                if (status.includes('up')) {
                    resolve('running');
                } else if (status.includes('exited')) {
                    resolve('stopped');
                } else {
                    resolve('unknown');
                }
            }
        });
    });
}

// Helper: Get container stats
async function getContainerStats(appId) {
    return new Promise((resolve) => {
        execFile('docker', ['stats', `homestore-${appId}`, '--no-stream', '--format', '{{.CPUPerc}},{{.MemUsage}}'], (err, stdout) => {
            if (err || !stdout.trim()) {
                resolve(null);
            } else {
                const [cpu, mem] = stdout.trim().split(',');
                resolve({ cpu, memory: mem });
            }
        });
    });
}

// GET /homestore/catalog - List all available apps
router.get('/catalog', requireAuth, async (req, res) => {
    try {
        const catalog = await loadCatalog();
        const installed = await loadInstalled();
        
        // Enrich apps with install status and saved config
        const apps = await Promise.all(catalog.apps.map(async (app) => {
            const status = await getContainerStatus(app.id);
            const savedConfig = await loadAppConfig(app.id);
            const installInfo = installed.apps[app.id];
            
            return {
                ...app,
                installed: !!installInfo,
                status: status,
                installedAt: installInfo?.installedAt,
                config: savedConfig || installInfo?.config || null
            };
        }));
        
        res.json({
            success: true,
            version: catalog.version,
            categories: catalog.categories,
            apps
        });
    } catch (error) {
        console.error('Error loading catalog:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// GET /homestore/categories - List categories
router.get('/categories', requireAuth, async (req, res) => {
    try {
        const catalog = await loadCatalog();
        res.json({ success: true, categories: catalog.categories });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// GET /homestore/installed - List installed apps
router.get('/installed', requireAuth, async (req, res) => {
    try {
        const catalog = await loadCatalog();
        const installed = await loadInstalled();
        
        const apps = await Promise.all(
            Object.keys(installed.apps).map(async (appId) => {
                const appDef = catalog.apps.find(a => a.id === appId);
                const status = await getContainerStatus(appId);
                const stats = status === 'running' ? await getContainerStats(appId) : null;
                const savedConfig = await loadAppConfig(appId);
                
                return {
                    ...appDef,
                    ...installed.apps[appId],
                    status,
                    stats,
                    config: savedConfig || installed.apps[appId]?.config || null
                };
            })
        );
        
        res.json({ success: true, apps });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// GET /homestore/app/:id - Get app details
router.get('/app/:id', requireAuth, async (req, res) => {
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
        
        const status = await getContainerStatus(id);
        const stats = status === 'running' ? await getContainerStats(id) : null;
        const savedConfig = await loadAppConfig(id);
        
        res.json({
            success: true,
            app: {
                ...app,
                installed: !!installed.apps[id],
                status,
                stats,
                installedAt: installed.apps[id]?.installedAt,
                config: installed.apps[id]?.config,
                savedConfig: savedConfig
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// GET /homestore/app/:id/config - Get saved app config (for reinstalls)
router.get('/app/:id/config', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        if (!validateAppId(id)) {
            return res.status(400).json({ error: 'Invalid app ID' });
        }
        const config = await loadAppConfig(id);
        
        if (config) {
            res.json({ success: true, config });
        } else {
            res.json({ success: true, config: null });
        }
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// POST /homestore/install/:id - Install an app
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

// POST /homestore/uninstall/:id - Uninstall an app
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

// POST /homestore/start/:id - Start an app
router.post('/start/:id', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        if (!validateAppId(id)) {
            return res.status(400).json({ error: 'Invalid app ID' });
        }

        await new Promise((resolve, reject) => {
            execFile('docker', ['start', `homestore-${id}`], (err, stdout, stderr) => {
                if (err) reject(new Error(stderr || err.message));
                else resolve();
            });
        });
        
        res.json({ success: true, message: 'App started' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// POST /homestore/stop/:id - Stop an app
router.post('/stop/:id', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        if (!validateAppId(id)) {
            return res.status(400).json({ error: 'Invalid app ID' });
        }

        await new Promise((resolve, reject) => {
            execFile('docker', ['stop', `homestore-${id}`], (err, stdout, stderr) => {
                if (err) reject(new Error(stderr || err.message));
                else resolve();
            });
        });
        
        res.json({ success: true, message: 'App stopped' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// POST /homestore/restart/:id - Restart an app
router.post('/restart/:id', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        if (!validateAppId(id)) {
            return res.status(400).json({ error: 'Invalid app ID' });
        }

        await new Promise((resolve, reject) => {
            execFile('docker', ['restart', `homestore-${id}`], (err, stdout, stderr) => {
                if (err) reject(new Error(stderr || err.message));
                else resolve();
            });
        });
        
        res.json({ success: true, message: 'App restarted' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// GET /homestore/logs/:id - Get app logs
router.get('/logs/:id', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        if (!validateAppId(id)) {
            return res.status(400).json({ error: 'Invalid app ID' });
        }
        const lines = Math.min(Math.max(parseInt(req.query.lines) || 100, 1), 5000);

        const logs = await new Promise((resolve, reject) => {
            execFile('docker', ['logs', `homestore-${id}`, '--tail', String(lines)], (err, stdout, stderr) => {
                if (err) reject(new Error(err.message));
                else resolve(stdout + stderr);
            });
        });
        
        res.json({ success: true, logs });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// POST /homestore/update/:id - Update an app (pull new image and recreate)
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

// GET /homestore/check-docker - Check if Docker is available
router.get('/check-docker', requireAuth, async (req, res) => {
    const available = await checkDocker();
    res.json({ success: true, available });
});

module.exports = router;
