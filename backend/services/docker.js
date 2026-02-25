/**
 * HomePiNAS v2 - Docker Service Layer
 * Business logic for Docker container and image management
 */

const Docker = require('dockerode');
const docker = new Docker({ socketPath: '/var/run/docker.sock' });

const {
    findComposeForContainer,
    parsePortMappings,
    loadUpdateCache,
    saveUpdateCache,
    loadContainerNotes,
    saveContainerNotes
} = require('../routes/docker/helpers');

/**
 * Get all containers with status, stats, and metadata
 * @param {Object} options - { all: boolean }
 * @returns {Promise<Array>} Array of container objects
 */
async function listContainers(options = { all: true }) {
    try {
        const containers = await docker.listContainers(options);
        const updateCache = loadUpdateCache();
        const containerNotes = loadContainerNotes();

        const result = await Promise.all(containers.map(async (c) => {
            const name = c.Names[0].replace('/', '');
            const image = c.Image;

            // Check for updates
            const hasUpdate = updateCache.updates[image] || false;

            // Get port mappings
            const ports = parsePortMappings(c.Ports);

            // Get notes
            const notes = containerNotes[name] || containerNotes[c.Id] || '';

            // Find compose file
            const compose = findComposeForContainer(name);

            // Get stats if running
            let cpu = '---';
            let ram = '---';

            if (c.State === 'running') {
                try {
                    const container = docker.getContainer(c.Id);
                    const stats = await container.stats({ stream: false });

                    // CPU percentage
                    const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - stats.precpu_stats.cpu_usage.total_usage;
                    const systemDelta = stats.cpu_stats.system_cpu_usage - stats.precpu_stats.system_cpu_usage;
                    const cpuPercent = (cpuDelta / systemDelta) * stats.cpu_stats.online_cpus * 100;
                    cpu = cpuPercent.toFixed(1) + '%';

                    // Memory usage
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
                hasUpdate,
                notes,
                compose: compose ? compose.name : null,
                created: c.Created,
                uptime: c.Status
            };
        }));

        return result;
    } catch (error) {
        console.error('List containers error:', error);
        throw error;
    }
}

/**
 * Get container by ID or name
 * @param {string} containerId - Container ID or name
 * @returns {Promise<Object>} Container object
 */
async function getContainer(containerId) {
    try {
        const container = docker.getContainer(containerId);
        const info = await container.inspect();
        
        return {
            id: info.Id,
            name: info.Name.replace('/', ''),
            status: info.State.Status,
            image: info.Config.Image,
            created: info.Created,
            state: info.State,
            config: info.Config,
            networkSettings: info.NetworkSettings
        };
    } catch (error) {
        console.error('Get container error:', error);
        throw error;
    }
}

/**
 * Start a container
 * @param {string} containerId - Container ID or name
 * @returns {Promise<Object>} Result
 */
async function startContainer(containerId) {
    try {
        const container = docker.getContainer(containerId);
        await container.start();
        return { success: true };
    } catch (error) {
        console.error('Start container error:', error);
        return { success: false, error: error.message };
    }
}

/**
 * Stop a container
 * @param {string} containerId - Container ID or name
 * @returns {Promise<Object>} Result
 */
async function stopContainer(containerId) {
    try {
        const container = docker.getContainer(containerId);
        await container.stop();
        return { success: true };
    } catch (error) {
        console.error('Stop container error:', error);
        return { success: false, error: error.message };
    }
}

/**
 * Restart a container
 * @param {string} containerId - Container ID or name
 * @returns {Promise<Object>} Result
 */
async function restartContainer(containerId) {
    try {
        const container = docker.getContainer(containerId);
        await container.restart();
        return { success: true };
    } catch (error) {
        console.error('Restart container error:', error);
        return { success: false, error: error.message };
    }
}

/**
 * Remove a container
 * @param {string} containerId - Container ID or name
 * @param {Object} options - { force: boolean, volumes: boolean }
 * @returns {Promise<Object>} Result
 */
async function removeContainer(containerId, options = {}) {
    try {
        const container = docker.getContainer(containerId);
        await container.remove({
            force: options.force || false,
            v: options.volumes || false
        });
        return { success: true };
    } catch (error) {
        console.error('Remove container error:', error);
        return { success: false, error: error.message };
    }
}

/**
 * Get container logs
 * @param {string} containerId - Container ID or name
 * @param {Object} options - { tail: number, timestamps: boolean }
 * @returns {Promise<string>} Log output
 */
async function getContainerLogs(containerId, options = {}) {
    try {
        const container = docker.getContainer(containerId);
        const logs = await container.logs({
            stdout: true,
            stderr: true,
            tail: options.tail || 100,
            timestamps: options.timestamps !== false
        });
        
        // Convert buffer to string and clean ANSI codes
        return logs.toString('utf8')
            .replace(/[\x00-\x1F\x7F-\x9F]/g, '')
            .replace(/\x1b\[[0-9;]*m/g, '');
    } catch (error) {
        console.error('Get container logs error:', error);
        throw error;
    }
}

/**
 * Get container stats (real-time)
 * @param {string} containerId - Container ID or name
 * @returns {Promise<Object>} Stats object
 */
async function getContainerStats(containerId) {
    try {
        const container = docker.getContainer(containerId);
        const stats = await container.stats({ stream: false });

        // Calculate CPU percentage
        const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - stats.precpu_stats.cpu_usage.total_usage;
        const systemDelta = stats.cpu_stats.system_cpu_usage - stats.precpu_stats.system_cpu_usage;
        const cpuPercent = (cpuDelta / systemDelta) * stats.cpu_stats.online_cpus * 100;

        // Memory usage
        const memUsage = stats.memory_stats.usage || 0;
        const memLimit = stats.memory_stats.limit || 0;
        const memPercent = memLimit > 0 ? (memUsage / memLimit) * 100 : 0;

        // Network I/O
        const networks = stats.networks || {};
        let rxBytes = 0;
        let txBytes = 0;
        for (const iface of Object.values(networks)) {
            rxBytes += iface.rx_bytes || 0;
            txBytes += iface.tx_bytes || 0;
        }

        // Disk I/O
        const ioStats = stats.blkio_stats?.io_service_bytes_recursive || [];
        let diskRead = 0;
        let diskWrite = 0;
        for (const io of ioStats) {
            if (io.op === 'read') diskRead += io.value || 0;
            if (io.op === 'write') diskWrite += io.value || 0;
        }

        return {
            cpu: {
                percent: cpuPercent.toFixed(2),
                usage: stats.cpu_stats.cpu_usage.total_usage
            },
            memory: {
                usage: memUsage,
                limit: memLimit,
                percent: memPercent.toFixed(2),
                usageMB: (memUsage / 1024 / 1024).toFixed(0),
                limitMB: (memLimit / 1024 / 1024).toFixed(0)
            },
            network: {
                rxBytes,
                txBytes,
                rxMB: (rxBytes / 1024 / 1024).toFixed(2),
                txMB: (txBytes / 1024 / 1024).toFixed(2)
            },
            disk: {
                read: diskRead,
                write: diskWrite,
                readMB: (diskRead / 1024 / 1024).toFixed(2),
                writeMB: (diskWrite / 1024 / 1024).toFixed(2)
            }
        };
    } catch (error) {
        console.error('Get container stats error:', error);
        throw error;
    }
}

/**
 * Update container notes
 * @param {string} containerIdentifier - Container ID or name
 * @param {string} notes - Notes text
 * @returns {Object} Result
 */
function updateContainerNotes(containerIdentifier, notes) {
    try {
        const containerNotes = loadContainerNotes();
        containerNotes[containerIdentifier] = notes || '';
        saveContainerNotes(containerNotes);
        return { success: true };
    } catch (error) {
        console.error('Update container notes error:', error);
        return { success: false, error: error.message };
    }
}

/**
 * List Docker images
 * @returns {Promise<Array>} Array of image objects
 */
async function listImages() {
    try {
        const images = await docker.listImages({ all: false });
        
        return images.map(img => ({
            id: img.Id,
            tags: img.RepoTags || [],
            size: img.Size,
            sizeMB: (img.Size / 1024 / 1024).toFixed(2),
            created: img.Created,
            containers: img.Containers || 0
        }));
    } catch (error) {
        console.error('List images error:', error);
        throw error;
    }
}

/**
 * Pull Docker image
 * @param {string} imageName - Image name (e.g., 'nginx:latest')
 * @returns {Promise<Object>} Result with stream
 */
async function pullImage(imageName) {
    try {
        const stream = await docker.pull(imageName);
        
        return new Promise((resolve, reject) => {
            docker.modem.followProgress(stream, (err, output) => {
                if (err) {
                    reject(err);
                } else {
                    resolve({ success: true, output });
                }
            });
        });
    } catch (error) {
        console.error('Pull image error:', error);
        return { success: false, error: error.message };
    }
}

/**
 * Remove Docker image
 * @param {string} imageId - Image ID
 * @param {Object} options - { force: boolean }
 * @returns {Promise<Object>} Result
 */
async function removeImage(imageId, options = {}) {
    try {
        const image = docker.getImage(imageId);
        await image.remove({ force: options.force || false });
        return { success: true };
    } catch (error) {
        console.error('Remove image error:', error);
        return { success: false, error: error.message };
    }
}

module.exports = {
    listContainers,
    getContainer,
    startContainer,
    stopContainer,
    restartContainer,
    removeContainer,
    getContainerLogs,
    getContainerStats,
    updateContainerNotes,
    listImages,
    pullImage,
    removeImage
};
