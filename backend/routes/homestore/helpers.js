/**
 * HomePiNAS v2 - HomeStore Helpers
 * Shared utilities for app management
 */
const { execFile } = require('child_process');
const fs = require('fs').promises;
const path = require('path');

// Constants
const CATALOG_PATH = path.join(__dirname, '../../data/homestore-catalog.json');
const APPS_BASE = '/opt/homepinas/apps';
const INSTALLED_PATH = path.join(__dirname, '../../config/homestore-installed.json');
const APP_CONFIGS_PATH = path.join(__dirname, '../../config/homestore-app-configs');

/**
 * Validate app/container ID to prevent command injection
 */
function validateAppId(id) {
    return id && /^[a-zA-Z0-9_-]+$/.test(id);
}

/**
 * Load catalog from disk
 */
async function loadCatalog() {
    try {
        const data = await fs.readFile(CATALOG_PATH, 'utf8');
        return JSON.parse(data);
    } catch {
        return { apps: [], categories: [] };
    }
}

/**
 * Load installed apps registry
 */
async function loadInstalled() {
    try {
        const data = await fs.readFile(INSTALLED_PATH, 'utf8');
        return JSON.parse(data);
    } catch {
        return { apps: {} };
    }
}

/**
 * Save installed apps registry
 */
async function saveInstalled(installed) {
    await fs.writeFile(INSTALLED_PATH, JSON.stringify(installed, null, 2));
}

/**
 * Load app-specific config (for reinstalls)
 */
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

/**
 * Save app-specific config
 */
async function saveAppConfig(appId, config) {
    try {
        await fs.mkdir(APP_CONFIGS_PATH, { recursive: true });
        const configPath = path.join(APP_CONFIGS_PATH, `${appId}.json`);
        await fs.writeFile(configPath, JSON.stringify(config, null, 2));
    } catch (e) {
        console.error(`Failed to save config for ${appId}:`, e);
    }
}

/**
 * Validate and create directory if needed
 */
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

/**
 * Check if Docker is available
 */
async function checkDocker() {
    return new Promise((resolve) => {
        execFile('docker', ['--version'], (err) => resolve(!err));
    });
}

/**
 * Get container status (running/stopped/unknown)
 */
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

/**
 * Get container stats (CPU & memory usage)
 */
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

module.exports = {
    CATALOG_PATH,
    APPS_BASE,
    INSTALLED_PATH,
    APP_CONFIGS_PATH,
    validateAppId,
    loadCatalog,
    loadInstalled,
    saveInstalled,
    loadAppConfig,
    saveAppConfig,
    ensureDirectory,
    checkDocker,
    getContainerStatus,
    getContainerStats
};
