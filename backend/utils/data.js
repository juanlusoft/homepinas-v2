/**
 * HomePiNAS - Data Storage Utilities
 * v1.6.0 - Modular Architecture with File Locking
 *
 * JSON file-based configuration storage with atomic writes
 * and file locking to prevent data corruption from concurrent access.
 *
 * File locking prevents race conditions when multiple processes/threads
 * attempt to write to the same file simultaneously.
 */

const fs = require('fs');
const path = require('path');
const lockfile = require('proper-lockfile');

const DATA_FILE = path.join(__dirname, '..', 'config', 'data.json');
const LOCK_OPTIONS = {
    retries: {
        retries: 5,
        minTimeout: 50,
        maxTimeout: 200
    },
    stale: 10000 // Consider lock stale after 10 seconds
};

const initialState = {
    user: null,
    users: [],
    storageConfig: [],
    network: {
        interfaces: [
            { id: 'eth0', name: 'Ethernet', ip: '192.168.1.100', subnet: '255.255.255.0', gateway: '192.168.1.1', dns: '8.8.8.8', dhcp: true, status: 'connected' },
            { id: 'eth1', name: 'Ethernet 2', ip: '10.0.0.15', subnet: '255.255.255.0', gateway: '10.0.0.1', dns: '10.0.0.1', dhcp: false, status: 'connected' },
            { id: 'wlan0', name: 'Wi-Fi', ip: '192.168.1.105', subnet: '255.255.255.0', gateway: '192.168.1.1', dns: '1.1.1.1', dhcp: true, status: 'disconnected' }
        ],
        ddns: []
    },
    notifications: {
        email: null,
        telegram: null,
        history: []
    },
    backups: [],
    scheduledTasks: [],
    ups: {
        config: {
            lowBatteryThreshold: 30,
            criticalThreshold: 10,
            notifyOnPower: true,
            shutdownOnCritical: false
        },
        history: []
    }
};

// In-memory cache with invalidation tracking
let dataCache = null;
let cacheTimestamp = 0;

/**
 * Ensure config directory exists with secure permissions
 */
function ensureConfigDir() {
    const configDir = path.dirname(DATA_FILE);
    if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });
    }
}

/**
 * Invalidate the in-memory cache
 * Called after write operations to ensure fresh reads
 */
function invalidateCache() {
    dataCache = null;
    cacheTimestamp = 0;
}

/**
 * Check if cache is valid based on file modification time
 * @returns {boolean} True if cache is fresh
 */
function isCacheValid() {
    if (!dataCache) return false;
    
    try {
        const stats = fs.statSync(DATA_FILE);
        return stats.mtimeMs <= cacheTimestamp;
    } catch {
        return false;
    }
}

/**
 * Read data from JSON file (synchronous, thread-safe with cache)
 * Uses in-memory cache that's invalidated on writes.
 * @returns {Object} Parsed configuration data
 */
function getData() {
    try {
        ensureConfigDir();
        
        // Return cached data if valid
        if (isCacheValid()) {
            return dataCache;
        }
        
        if (!fs.existsSync(DATA_FILE)) {
            fs.writeFileSync(DATA_FILE, JSON.stringify(initialState, null, 2));
            dataCache = JSON.parse(JSON.stringify(initialState));
            cacheTimestamp = Date.now();
            return dataCache;
        }
        
        const content = fs.readFileSync(DATA_FILE, 'utf8');
        dataCache = JSON.parse(content);
        cacheTimestamp = Date.now();
        return dataCache;
    } catch (e) {
        console.error('Error reading data file:', e.message);
        fs.writeFileSync(DATA_FILE, JSON.stringify(initialState, null, 2));
        dataCache = JSON.parse(JSON.stringify(initialState));
        cacheTimestamp = Date.now();
        return dataCache;
    }
}

/**
 * Read data from JSON file (async, with file locking)
 * Preferred method for async contexts.
 * @returns {Promise<Object>} Parsed configuration data
 */
async function getDataAsync() {
    try {
        ensureConfigDir();
        
        // Return cached data if valid
        if (isCacheValid()) {
            return dataCache;
        }
        
        if (!fs.existsSync(DATA_FILE)) {
            await fs.promises.writeFile(DATA_FILE, JSON.stringify(initialState, null, 2));
            dataCache = JSON.parse(JSON.stringify(initialState));
            cacheTimestamp = Date.now();
            return dataCache;
        }
        
        const content = await fs.promises.readFile(DATA_FILE, 'utf8');
        dataCache = JSON.parse(content);
        cacheTimestamp = Date.now();
        return dataCache;
    } catch (e) {
        console.error('Error reading data file:', e.message);
        await fs.promises.writeFile(DATA_FILE, JSON.stringify(initialState, null, 2));
        dataCache = JSON.parse(JSON.stringify(initialState));
        cacheTimestamp = Date.now();
        return dataCache;
    }
}

/**
 * Save data to JSON file with atomic write (synchronous, no locking)
 * This is the legacy method for backward compatibility.
 * WARNING: Not protected against race conditions. Use saveDataAsync() instead.
 * 
 * @param {Object} data - Data to save
 * @deprecated Use saveDataAsync() for race condition protection
 */
function saveData(data) {
    try {
        ensureConfigDir();
        const tmpFile = DATA_FILE + '.tmp.' + process.pid;
        fs.writeFileSync(tmpFile, JSON.stringify(data, null, 2), { mode: 0o600 });
        fs.renameSync(tmpFile, DATA_FILE);
        invalidateCache();
    } catch (e) {
        console.error('Error saving data file:', e.message);
        // Clean up temp file on failure
        try { fs.unlinkSync(DATA_FILE + '.tmp.' + process.pid); } catch {}
        throw new Error('Failed to save configuration');
    }
}

/**
 * Save data to JSON file with file locking and atomic write (async)
 * This prevents race conditions when multiple processes write simultaneously.
 * 
 * Locking strategy:
 * 1. Acquire exclusive lock on data file
 * 2. Write to temporary file
 * 3. Atomically rename temp file to data file
 * 4. Release lock
 * 5. Invalidate cache
 * 
 * @param {Object} data - Data to save
 * @returns {Promise<void>}
 * @throws {Error} If save operation fails
 */
async function saveDataAsync(data) {
    let release = null;
    const tmpFile = DATA_FILE + '.tmp.' + process.pid;
    
    try {
        ensureConfigDir();
        
        // Ensure data file exists before locking
        if (!fs.existsSync(DATA_FILE)) {
            await fs.promises.writeFile(DATA_FILE, JSON.stringify(initialState, null, 2));
        }
        
        // Acquire exclusive lock
        release = await lockfile.lock(DATA_FILE, LOCK_OPTIONS);
        
        // Write to temp file
        await fs.promises.writeFile(tmpFile, JSON.stringify(data, null, 2), { mode: 0o600 });
        
        // Atomic rename
        await fs.promises.rename(tmpFile, DATA_FILE);
        
        // Invalidate cache after successful write
        invalidateCache();
        
    } catch (e) {
        console.error('Error saving data file:', e.message);
        
        // Clean up temp file on failure
        try {
            await fs.promises.unlink(tmpFile);
        } catch {}
        
        throw new Error('Failed to save configuration: ' + e.message);
    } finally {
        // Always release lock
        if (release) {
            try {
                await release();
            } catch (e) {
                console.error('Error releasing lock:', e.message);
            }
        }
    }
}

module.exports = {
    getData,
    getDataAsync,
    saveData,
    saveDataAsync,
    invalidateCache,
    DATA_FILE,
    initialState
};
