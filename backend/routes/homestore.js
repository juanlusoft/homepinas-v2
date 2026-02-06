const express = require('express');
const router = express.Router();
const { exec, spawn } = require('child_process');
const fs = require('fs').promises;
const path = require('path');

// Load catalog
const CATALOG_PATH = path.join(__dirname, '../data/homestore-catalog.json');
const APPS_BASE = '/opt/homepinas/apps';
const INSTALLED_PATH = path.join(__dirname, '../config/homestore-installed.json');
const APP_CONFIGS_PATH = path.join(__dirname, '../config/homestore-app-configs');

// Helper: Load catalog
async function loadCatalog() {
    const data = await fs.readFile(CATALOG_PATH, 'utf8');
    return JSON.parse(data);
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
        exec('docker --version', (err) => resolve(!err));
    });
}

// Helper: Get container status
async function getContainerStatus(appId) {
    return new Promise((resolve) => {
        exec(`docker ps -a --filter "name=homestore-${appId}" --format "{{.Status}}"`, (err, stdout) => {
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
        exec(`docker stats homestore-${appId} --no-stream --format "{{.CPUPerc}},{{.MemUsage}}"`, (err, stdout) => {
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
router.get('/catalog', async (req, res) => {
    try {
        const catalog = await loadCatalog();
        const installed = await loadInstalled();
        
        // Enrich apps with install status
        const apps = await Promise.all(catalog.apps.map(async (app) => {
            const status = await getContainerStatus(app.id);
            return {
                ...app,
                installed: !!installed.apps[app.id],
                status: status,
                installedAt: installed.apps[app.id]?.installedAt
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
router.get('/categories', async (req, res) => {
    try {
        const catalog = await loadCatalog();
        res.json({ success: true, categories: catalog.categories });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// GET /homestore/installed - List installed apps
router.get('/installed', async (req, res) => {
    try {
        const catalog = await loadCatalog();
        const installed = await loadInstalled();
        
        const apps = await Promise.all(
            Object.keys(installed.apps).map(async (appId) => {
                const appDef = catalog.apps.find(a => a.id === appId);
                const status = await getContainerStatus(appId);
                const stats = status === 'running' ? await getContainerStats(appId) : null;
                
                return {
                    ...appDef,
                    ...installed.apps[appId],
                    status,
                    stats
                };
            })
        );
        
        res.json({ success: true, apps });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// GET /homestore/app/:id - Get app details
router.get('/app/:id', async (req, res) => {
    try {
        const { id } = req.params;
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
router.get('/app/:id/config', async (req, res) => {
    try {
        const { id } = req.params;
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
router.post('/install/:id', async (req, res) => {
    try {
        const { id } = req.params;
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
        
        // Build docker run command
        let cmd = `docker run -d --name homestore-${id} --restart unless-stopped`;
        
        // Add ports
        for (const [host, container] of Object.entries(finalPorts)) {
            // Handle port formats like "51820/udp"
            const hostPort = host.split('/')[0];
            const protocol = host.includes('/') ? host.split('/')[1] : '';
            const containerPort = container.includes('/') ? container : (protocol ? `${container}/${protocol}` : container);
            cmd += ` -p ${hostPort}:${containerPort}`;
        }
        
        // Add volumes
        for (const [container, host] of Object.entries(finalVolumes)) {
            cmd += ` -v ${host}:${container}`;
        }
        
        // Add environment variables (merge defaults with user config)
        const envVars = { ...app.env, ...(config?.env || {}) };
        for (const [key, value] of Object.entries(envVars)) {
            // Escape quotes in values for shell
            const escapedValue = String(value).replace(/"/g, '\\"');
            cmd += ` -e ${key}="${escapedValue}"`;
        }
        
        // Add capabilities
        if (app.capabilities) {
            for (const cap of app.capabilities) {
                cmd += ` --cap-add=${cap}`;
            }
        }
        
        // Add sysctls
        if (app.sysctls) {
            for (const [key, value] of Object.entries(app.sysctls)) {
                cmd += ` --sysctl ${key}=${value}`;
            }
        }
        
        // Add privileged if needed
        if (app.privileged) {
            cmd += ' --privileged';
        }
        
        // Add image
        cmd += ` ${app.image}`;
        
        console.log('Installing app:', cmd);
        
        // Execute
        await new Promise((resolve, reject) => {
            exec(cmd, { timeout: 300000 }, (err, stdout, stderr) => {
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
router.post('/uninstall/:id', async (req, res) => {
    try {
        const { id } = req.params;
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
            exec(`docker stop homestore-${id} && docker rm homestore-${id}`, (err) => {
                resolve(); // Continue even if error (container might not exist)
            });
        });
        
        // Optionally remove data
        if (removeData) {
            const appDir = `${APPS_BASE}/${id}`;
            await new Promise((resolve) => {
                exec(`rm -rf "${appDir}"`, (err) => resolve());
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
router.post('/start/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        await new Promise((resolve, reject) => {
            exec(`docker start homestore-${id}`, (err, stdout, stderr) => {
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
router.post('/stop/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        await new Promise((resolve, reject) => {
            exec(`docker stop homestore-${id}`, (err, stdout, stderr) => {
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
router.post('/restart/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        await new Promise((resolve, reject) => {
            exec(`docker restart homestore-${id}`, (err, stdout, stderr) => {
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
router.get('/logs/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const lines = req.query.lines || 100;
        
        const logs = await new Promise((resolve, reject) => {
            exec(`docker logs homestore-${id} --tail ${lines} 2>&1`, (err, stdout) => {
                if (err) reject(new Error(err.message));
                else resolve(stdout);
            });
        });
        
        res.json({ success: true, logs });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// POST /homestore/update/:id - Update an app (pull new image and recreate)
router.post('/update/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
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
            exec(`docker pull ${app.image}`, { timeout: 600000 }, (err, stdout, stderr) => {
                if (err) reject(new Error(stderr || err.message));
                else resolve();
            });
        });
        
        // Stop and remove old container
        await new Promise((resolve) => {
            exec(`docker stop homestore-${id} && docker rm homestore-${id}`, () => resolve());
        });
        
        // Reinstall with same config
        const config = installed.apps[id].config;
        
        // Build docker run command (same as install)
        let cmd = `docker run -d --name homestore-${id} --restart unless-stopped`;
        
        if (app.ports) {
            for (const [host, container] of Object.entries(app.ports)) {
                cmd += ` -p ${host}:${container}`;
            }
        }
        
        if (app.volumes) {
            for (const [container, host] of Object.entries(app.volumes)) {
                cmd += ` -v ${host}:${container}`;
            }
        }
        
        const envVars = { ...app.env, ...(config?.env || {}) };
        for (const [key, value] of Object.entries(envVars)) {
            cmd += ` -e ${key}="${value}"`;
        }
        
        if (app.capabilities) {
            for (const cap of app.capabilities) {
                cmd += ` --cap-add=${cap}`;
            }
        }
        
        if (app.sysctls) {
            for (const [key, value] of Object.entries(app.sysctls)) {
                cmd += ` --sysctl ${key}=${value}`;
            }
        }
        
        if (app.privileged) {
            cmd += ' --privileged';
        }
        
        cmd += ` ${app.image}`;
        
        await new Promise((resolve, reject) => {
            exec(cmd, { timeout: 300000 }, (err, stdout, stderr) => {
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
router.get('/check-docker', async (req, res) => {
    const available = await checkDocker();
    res.json({ success: true, available });
});

module.exports = router;
