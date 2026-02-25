/**
 * HomePiNAS Docker - Shared Helpers
 * Utility functions for Docker management
 */

const fs = require('fs');
const path = require('path');

// Paths
const COMPOSE_DIR = path.join(__dirname, '..', '..', 'config', 'compose');
const UPDATE_CACHE_FILE = path.join(__dirname, '..', '..', 'config', 'docker-updates.json');
const CONTAINER_NOTES_FILE = path.join(__dirname, '..', '..', 'config', 'container-notes.json');

// Ensure directories exist
if (!fs.existsSync(COMPOSE_DIR)) {
    fs.mkdirSync(COMPOSE_DIR, { recursive: true });
}

// ═══════════════════════════════════════════════════════════════════════════
// Container Helper Functions
// ═══════════════════════════════════════════════════════════════════════════

// Find compose file for a container
function findComposeForContainer(containerName) {
    try {
        const dirs = fs.readdirSync(COMPOSE_DIR);
        for (const dir of dirs) {
            const composeFile = path.join(COMPOSE_DIR, dir, 'docker-compose.yml');
            if (fs.existsSync(composeFile)) {
                const content = fs.readFileSync(composeFile, 'utf8');
                // Check if this compose file defines this container
                if (content.includes(`container_name: ${containerName}`) || 
                    content.includes(`container_name: "${containerName}"`) ||
                    content.includes(`container_name: '${containerName}'`)) {
                    return { name: dir, path: composeFile };
                }
                // Also check service name
                const serviceRegex = new RegExp(`^\\s*${containerName}:\\s*$`, 'm');
                if (serviceRegex.test(content)) {
                    return { name: dir, path: composeFile };
                }
            }
        }
    } catch (e) {
        console.error('Error finding compose for container:', e.message);
    }
    return null;
}

// Parse port mappings from container info
function parsePortMappings(ports) {
    if (!ports || !Array.isArray(ports)) return [];
    return ports.map(p => {
        if (p.PublicPort && p.PrivatePort) {
            return {
                public: p.PublicPort,
                private: p.PrivatePort,
                type: p.Type || 'tcp',
                ip: p.IP || '0.0.0.0'
            };
        } else if (p.PrivatePort) {
            return {
                public: null,
                private: p.PrivatePort,
                type: p.Type || 'tcp',
                ip: null
            };
        }
        return null;
    }).filter(Boolean);
}

// ═══════════════════════════════════════════════════════════════════════════
// Update Cache Functions
// ═══════════════════════════════════════════════════════════════════════════

// Load update cache
function loadUpdateCache() {
    try {
        if (fs.existsSync(UPDATE_CACHE_FILE)) {
            return JSON.parse(fs.readFileSync(UPDATE_CACHE_FILE, 'utf8'));
        }
    } catch (e) {
        console.error('Error loading update cache:', e.message);
    }
    return { lastCheck: null, updates: {} };
}

// Save update cache
function saveUpdateCache(cache) {
    try {
        fs.writeFileSync(UPDATE_CACHE_FILE, JSON.stringify(cache, null, 2));
    } catch (e) {
        console.error('Error saving update cache:', e.message);
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Container Notes Functions
// ═══════════════════════════════════════════════════════════════════════════

// Load container notes
function loadContainerNotes() {
    try {
        if (fs.existsSync(CONTAINER_NOTES_FILE)) {
            return JSON.parse(fs.readFileSync(CONTAINER_NOTES_FILE, 'utf8'));
        }
    } catch (e) {
        console.error('Error loading container notes:', e.message);
    }
    return {};
}

// Save container notes
function saveContainerNotes(notes) {
    try {
        fs.writeFileSync(CONTAINER_NOTES_FILE, JSON.stringify(notes, null, 2));
        return true;
    } catch (e) {
        console.error('Error saving container notes:', e.message);
        return false;
    }
}

module.exports = {
    COMPOSE_DIR,
    UPDATE_CACHE_FILE,
    CONTAINER_NOTES_FILE,
    findComposeForContainer,
    parsePortMappings,
    loadUpdateCache,
    saveUpdateCache,
    loadContainerNotes,
    saveContainerNotes
};
