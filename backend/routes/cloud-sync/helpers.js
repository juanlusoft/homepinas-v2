/**
 * HomePiNAS v2 - Cloud Sync Helpers
 * Syncthing installation and API utilities
 */
const { execFile, spawn } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
const http = require('http');

// Configuration
const SYSTEM_USER = process.env.USER || process.env.LOGNAME || 'homepinas';
const HOME_DIR = process.env.HOME || `/home/${SYSTEM_USER}`;

const SYNCTHING_CONFIG_DIRS = [
    `${HOME_DIR}/.local/state/syncthing`,
    `${HOME_DIR}/.config/syncthing`,
    '/var/lib/syncthing/.config/syncthing'
];
const SYNCTHING_API_URL = 'http://127.0.0.1:8384';
const STORAGE_BASE = '/mnt/storage';

let syncthingApiKey = null;

/**
 * Get Syncthing API key from config
 */
async function getApiKey() {
    if (syncthingApiKey) return syncthingApiKey;
    
    for (const configDir of SYNCTHING_CONFIG_DIRS) {
        try {
            const configPath = path.join(configDir, 'config.xml');
            const configXml = await fs.readFile(configPath, 'utf8');
            const match = configXml.match(/<apikey>([^<]+)<\/apikey>/);
            if (match) {
                syncthingApiKey = match[1];
                console.log('Found Syncthing API key in:', configDir);
                return syncthingApiKey;
            }
        } catch (e) {
            // Try next location
        }
    }
    console.error('Failed to find Syncthing API key in any location');
    return null;
}

/**
 * Reset cached API key (useful after installation)
 */
function resetApiKey() {
    syncthingApiKey = null;
}

/**
 * Make Syncthing API request
 */
async function syncthingApi(endpoint, method = 'GET', body = null) {
    const apiKey = await getApiKey();
    if (!apiKey) throw new Error('Syncthing API key not available');
    
    return new Promise((resolve, reject) => {
        const url = new URL(endpoint, SYNCTHING_API_URL);
        const options = {
            hostname: url.hostname,
            port: url.port,
            path: url.pathname + url.search,
            method,
            headers: {
                'X-API-Key': apiKey,
                'Content-Type': 'application/json',
                'Origin': SYNCTHING_API_URL  // Required to avoid CSRF error
            }
        };
        
        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch {
                    resolve(data);
                }
            });
        });
        
        req.on('error', reject);
        if (body) req.write(JSON.stringify(body));
        req.end();
    });
}

/**
 * Check if Syncthing is installed
 */
async function isSyncthingInstalled() {
    return new Promise((resolve) => {
        execFile('which', ['syncthing'], (err) => resolve(!err));
    });
}

/**
 * Check if Syncthing service is running
 */
async function isSyncthingRunning() {
    return new Promise((resolve) => {
        execFile('systemctl', ['is-active', `syncthing@${SYSTEM_USER}`], (err, stdout) => {
            resolve(stdout.trim() === 'active');
        });
    });
}

/**
 * Run execFile as a promise
 */
function execFilePromise(cmd, args, options = {}) {
    return new Promise((resolve, reject) => {
        execFile(cmd, args, options, (err, stdout, stderr) => {
            if (err) reject(new Error(stderr || err.message));
            else resolve(stdout);
        });
    });
}

/**
 * Run a piped command (cmd1 | cmd2) using spawn
 */
function spawnPipe(cmd1, args1, cmd2, args2, options = {}) {
    return new Promise((resolve, reject) => {
        const proc1 = spawn(cmd1, args1, options);
        const proc2 = spawn(cmd2, args2, options);

        proc1.stdout.pipe(proc2.stdin);

        let stderr1 = '';
        let stderr2 = '';
        let stdout2 = '';

        proc1.stderr.on('data', (data) => { stderr1 += data; });
        proc2.stderr.on('data', (data) => { stderr2 += data; });
        proc2.stdout.on('data', (data) => { stdout2 += data; });

        proc1.on('error', (err) => reject(err));
        proc2.on('error', (err) => reject(err));

        proc1.on('close', (code) => {
            if (code !== 0) reject(new Error(stderr1 || `${cmd1} exited with code ${code}`));
        });

        proc2.on('close', (code) => {
            if (code !== 0) reject(new Error(stderr2 || `${cmd2} exited with code ${code}`));
            else resolve(stdout2);
        });
    });
}

/**
 * Write string to a command's stdin using spawn
 */
function spawnWithStdin(cmd, args, inputData, options = {}) {
    return new Promise((resolve, reject) => {
        const proc = spawn(cmd, args, options);
        let stdout = '';
        let stderr = '';

        proc.stdout.on('data', (data) => { stdout += data; });
        proc.stderr.on('data', (data) => { stderr += data; });
        proc.on('error', (err) => reject(err));
        proc.on('close', (code) => {
            if (code !== 0) reject(new Error(stderr || `${cmd} exited with code ${code}`));
            else resolve(stdout);
        });

        proc.stdin.write(inputData);
        proc.stdin.end();
    });
}

/**
 * Install Syncthing
 */
async function installSyncthing() {
    const timeout = 300000;

    // Step 1: Add Syncthing release PGP keys
    await spawnPipe(
        'curl', ['-fsSL', 'https://syncthing.net/release-key.gpg'],
        'sudo', ['gpg', '--dearmor', '-o', '/usr/share/keyrings/syncthing-archive-keyring.gpg'],
        { timeout }
    );

    // Step 2: Add stable channel to APT sources
    const aptSource = 'deb [signed-by=/usr/share/keyrings/syncthing-archive-keyring.gpg] https://apt.syncthing.net/ syncthing stable\n';
    await spawnWithStdin(
        'sudo', ['tee', '/etc/apt/sources.list.d/syncthing.list'],
        aptSource,
        { timeout }
    );

    // Step 3: Update package lists
    await execFilePromise('sudo', ['apt-get', 'update'], { timeout });

    // Step 4: Install syncthing
    await execFilePromise('sudo', ['apt-get', 'install', '-y', 'syncthing'], { timeout });

    // Step 5: Enable syncthing service for current user
    await execFilePromise('sudo', ['systemctl', 'enable', `syncthing@${SYSTEM_USER}`], { timeout });

    // Step 6: Start syncthing service for current user
    await execFilePromise('sudo', ['systemctl', 'start', `syncthing@${SYSTEM_USER}`], { timeout });
}

module.exports = {
    SYSTEM_USER,
    HOME_DIR,
    SYNCTHING_CONFIG_DIRS,
    SYNCTHING_API_URL,
    STORAGE_BASE,
    getApiKey,
    resetApiKey,
    syncthingApi,
    isSyncthingInstalled,
    isSyncthingRunning,
    execFilePromise,
    spawnPipe,
    spawnWithStdin,
    installSyncthing
};
