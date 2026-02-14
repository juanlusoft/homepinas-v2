/**
 * HomePiNAS - Homestore Routes Tests
 * Tests for homestore app management API endpoints
 */

const express = require('express');
const request = require('supertest');

// Mock fs promises
jest.mock('fs', () => ({
    promises: {
        readFile: jest.fn(),
        writeFile: jest.fn(),
        mkdir: jest.fn()
    }
}));

// Mock child_process
jest.mock('child_process', () => ({
    exec: jest.fn(),
    execFile: jest.fn(),
    spawn: jest.fn(() => ({
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        on: jest.fn()
    }))
}));

// Mock middleware
jest.mock('../../middleware/auth', () => ({
    requireAuth: (req, res, next) => {
        req.user = { username: 'testadmin' };
        next();
    }
}));

const { exec, execFile } = require('child_process');
const fs = require('fs');

// Get references to the mocked functions
const mockReadFile = fs.promises.readFile;
const mockWriteFile = fs.promises.writeFile;
const mockMkdir = fs.promises.mkdir;

const homestoreRouter = require('../../routes/homestore');
const app = express();
app.use(express.json());
app.use('/api/homestore', homestoreRouter);

// Mock data
const mockCatalog = {
    version: "2.0.0",
    categories: {
        media: { name: "Multimedia", icon: "🎬", order: 1 }
    },
    apps: [
        {
            id: "jellyfin",
            name: "Jellyfin",
            description: "Servidor multimedia",
            category: "media",
            icon: "https://example.com/jellyfin.png",
            image: "jellyfin/jellyfin:latest",
            ports: { "8096": "8096" },
            volumes: { "/config": "/opt/homepinas/apps/jellyfin/config" },
            env: {},
            webUI: 8096
        }
    ]
};

const mockInstalled = {
    apps: {
        jellyfin: {
            installedAt: "2024-02-14T12:00:00.000Z",
            config: {
                ports: { "8096": "8096" },
                volumes: { "/config": "/opt/homepinas/apps/jellyfin/config" }
            }
        }
    }
};

const mockAppConfig = {
    ports: { "8096": "8097" },
    env: { "JELLYFIN_PublishedServerUrl": "http://localhost:8097" }
};

beforeAll(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterAll(() => {
    console.error.mockRestore();
    console.log.mockRestore();
});

beforeEach(() => {
    // Reset mocks
    mockReadFile.mockReset();
    mockWriteFile.mockReset();
    mockMkdir.mockReset();
    exec.mockReset();
    execFile.mockReset();
});

describe('GET /api/homestore/catalog', () => {
    test('returns basic catalog', async () => {
        mockReadFile
            .mockResolvedValueOnce(JSON.stringify(mockCatalog))
            .mockRejectedValueOnce(new Error('Not found')); // installed.json not found
        
        execFile.mockImplementation((cmd, args, callback) => {
            callback(null, '');
        });

        const res = await request(app).get('/api/homestore/catalog');
        
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.version).toBe('2.0.0');
        expect(res.body.apps).toHaveLength(1);
        expect(res.body.apps[0]).toMatchObject({
            id: 'jellyfin',
            name: 'Jellyfin',
            installed: false
        });
    });

    test('handles catalog read error', async () => {
        mockReadFile.mockRejectedValue(new Error('File not found'));

        const res = await request(app).get('/api/homestore/catalog');
        
        expect(res.status).toBe(500);
        expect(res.body.success).toBe(false);
        expect(res.body.error).toBe('File not found');
    });
});

describe('GET /api/homestore/categories', () => {
    test('returns categories list', async () => {
        mockReadFile.mockResolvedValue(JSON.stringify(mockCatalog));

        const res = await request(app).get('/api/homestore/categories');
        
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.categories).toEqual(mockCatalog.categories);
    });

    test('handles catalog read error', async () => {
        mockReadFile.mockRejectedValue(new Error('Read error'));

        const res = await request(app).get('/api/homestore/categories');
        
        expect(res.status).toBe(500);
        expect(res.body.success).toBe(false);
        expect(res.body.error).toBe('Read error');
    });
});

describe('GET /api/homestore/installed', () => {
    test('returns installed apps', async () => {
        mockReadFile
            .mockResolvedValueOnce(JSON.stringify(mockCatalog))
            .mockResolvedValueOnce(JSON.stringify(mockInstalled));
        
        execFile.mockImplementation((cmd, args, callback) => {
            callback(null, 'Up 2 hours\n');
        });

        const res = await request(app).get('/api/homestore/installed');
        
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.apps).toHaveLength(1);
        expect(res.body.apps[0]).toMatchObject({
            id: 'jellyfin',
            name: 'Jellyfin'
        });
    });

    test('handles no installed apps', async () => {
        mockReadFile
            .mockResolvedValueOnce(JSON.stringify(mockCatalog))
            .mockRejectedValueOnce(new Error('Not found'));

        const res = await request(app).get('/api/homestore/installed');
        
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.apps).toHaveLength(0);
    });
});

describe('GET /api/homestore/app/:id', () => {
    test('returns app details with status', async () => {
        mockReadFile
            .mockResolvedValueOnce(JSON.stringify(mockCatalog))
            .mockResolvedValueOnce(JSON.stringify(mockInstalled))
            .mockResolvedValueOnce(JSON.stringify(mockAppConfig)); // saved config
        
        execFile.mockImplementation((cmd, args, callback) => {
            if (args.includes('ps')) {
                callback(null, 'Up 2 hours\n');
            } else if (args.includes('stats')) {
                callback(null, '20.5%,512MiB / 8GiB\n');
            }
        });

        const res = await request(app).get('/api/homestore/app/jellyfin');
        
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.app).toMatchObject({
            id: 'jellyfin',
            name: 'Jellyfin',
            installed: true,
            status: 'running',
            stats: {
                cpu: '20.5%',
                memory: '512MiB / 8GiB'
            },
            installedAt: mockInstalled.apps.jellyfin.installedAt,
            savedConfig: mockAppConfig
        });
    });

    test('returns 400 for invalid app ID', async () => {
        const res = await request(app).get('/api/homestore/app/invalid-id!');
        
        expect(res.status).toBe(400);
        expect(res.body.error).toBe('Invalid app ID');
    });

    test('returns 404 for unknown app', async () => {
        mockReadFile.mockResolvedValue(JSON.stringify(mockCatalog));

        const res = await request(app).get('/api/homestore/app/unknown');
        
        expect(res.status).toBe(404);
        expect(res.body.success).toBe(false);
        expect(res.body.error).toBe('App not found');
    });

    test('handles catalog read error', async () => {
        mockReadFile.mockRejectedValue(new Error('Read error'));

        const res = await request(app).get('/api/homestore/app/jellyfin');
        
        expect(res.status).toBe(500);
        expect(res.body.success).toBe(false);
    });
});

describe('GET /api/homestore/app/:id/config', () => {
    test('returns saved config if exists', async () => {
        mockReadFile.mockResolvedValue(JSON.stringify(mockAppConfig));

        const res = await request(app).get('/api/homestore/app/jellyfin/config');
        
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.config).toEqual(mockAppConfig);
    });

    test('returns null config if not found', async () => {
        mockReadFile.mockRejectedValue(new Error('Not found'));

        const res = await request(app).get('/api/homestore/app/jellyfin/config');
        
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.config).toBeNull();
    });

    test('returns 400 for invalid app ID', async () => {
        const res = await request(app).get('/api/homestore/app/invalid$/config');
        
        expect(res.status).toBe(400);
        expect(res.body.error).toBe('Invalid app ID');
    });

    test('handles read error', async () => {
        mockReadFile.mockRejectedValue(new Error('Filesystem error'));

        const res = await request(app).get('/api/homestore/app/jellyfin/config');
        
        expect(res.status).toBe(500);
        expect(res.body.success).toBe(false);
    });
});

describe('POST /api/homestore/install/:id', () => {
    test('returns 400 for invalid app ID', async () => {
        const res = await request(app)
            .post('/api/homestore/install/invalid!')
            .send({});
        
        expect(res.status).toBe(400);
        expect(res.body.error).toBe('Invalid app ID');
    });

    test('returns 404 for unknown app', async () => {
        mockReadFile.mockResolvedValue(JSON.stringify(mockCatalog));

        const res = await request(app)
            .post('/api/homestore/install/unknown')
            .send({});
        
        expect(res.status).toBe(404);
        expect(res.body.success).toBe(false);
        expect(res.body.error).toBe('App not found');
    });

    test('returns 409 if app already installed', async () => {
        mockReadFile
            .mockResolvedValueOnce(JSON.stringify(mockCatalog))
            .mockResolvedValueOnce(JSON.stringify(mockInstalled));

        const res = await request(app)
            .post('/api/homestore/install/jellyfin')
            .send({});
        
        expect(res.status).toBe(409);
        expect(res.body.success).toBe(false);
        expect(res.body.error).toBe('App already installed');
    });

    test('handles docker unavailable', async () => {
        mockReadFile
            .mockResolvedValueOnce(JSON.stringify(mockCatalog))
            .mockRejectedValueOnce(new Error('Not found')); // no installed.json
        
        exec.mockImplementation((cmd, callback) => {
            callback(new Error('Docker not found'));
        });

        const res = await request(app)
            .post('/api/homestore/install/jellyfin')
            .send({});
        
        expect(res.status).toBe(503);
        expect(res.body.success).toBe(false);
        expect(res.body.error).toBe('Docker is not available');
    });

    test('installs app successfully', async () => {
        mockReadFile
            .mockResolvedValueOnce(JSON.stringify(mockCatalog))
            .mockRejectedValueOnce(new Error('Not found')); // no installed.json
        
        exec.mockImplementation((cmd, callback) => {
            callback(null, 'Docker version 20.10.0');
        });

        execFile.mockImplementation((cmd, args, callback) => {
            callback(null, 'Success');
        });

        mockMkdir.mockResolvedValue();
        mockWriteFile.mockResolvedValue();

        const res = await request(app)
            .post('/api/homestore/install/jellyfin')
            .send({});
        
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.message).toBe('App installed successfully');
    });

    test('handles docker pull failure', async () => {
        mockReadFile
            .mockResolvedValueOnce(JSON.stringify(mockCatalog))
            .mockRejectedValueOnce(new Error('Not found'));
        
        exec.mockImplementation((cmd, callback) => callback(null, 'Docker available'));
        
        execFile.mockImplementation((cmd, args, callback) => {
            if (args.includes('pull')) {
                callback(new Error('Pull failed'));
            }
        });

        const res = await request(app)
            .post('/api/homestore/install/plex')
            .send({});
        
        expect(res.status).toBe(500);
        expect(res.body.success).toBe(false);
        expect(res.body.error).toBe('Pull failed');
    });
});

describe('POST /api/homestore/uninstall/:id', () => {
    test('returns 400 for invalid app ID', async () => {
        const res = await request(app).post('/api/homestore/uninstall/invalid!');
        
        expect(res.status).toBe(400);
        expect(res.body.error).toBe('Invalid app ID');
    });

    test('returns 404 if app not installed', async () => {
        mockReadFile.mockRejectedValue(new Error('Not found'));

        const res = await request(app).post('/api/homestore/uninstall/jellyfin');
        
        expect(res.status).toBe(404);
        expect(res.body.success).toBe(false);
        expect(res.body.error).toBe('App not installed');
    });

    test('uninstalls app successfully', async () => {
        mockReadFile.mockResolvedValue(JSON.stringify(mockInstalled));
        
        execFile.mockImplementation((cmd, args, callback) => {
            callback(null, 'Container removed');
        });

        mockWriteFile.mockResolvedValue();

        const res = await request(app).post('/api/homestore/uninstall/jellyfin');
        
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.message).toBe('App uninstalled successfully');
        
        expect(execFile).toHaveBeenCalledWith('docker', ['rm', '-f', 'homestore-jellyfin'], expect.any(Function));
        expect(mockWriteFile).toHaveBeenCalled();
    });

    test('handles docker command failure', async () => {
        mockReadFile.mockResolvedValue(JSON.stringify(mockInstalled));
        
        execFile.mockImplementation((cmd, args, callback) => {
            callback(new Error('Docker error'));
        });

        const res = await request(app).post('/api/homestore/uninstall/jellyfin');
        
        expect(res.status).toBe(500);
        expect(res.body.success).toBe(false);
        expect(res.body.error).toBe('Docker error');
    });
});

describe('POST /api/homestore/start/:id', () => {
    test('starts app container successfully', async () => {
        execFile.mockImplementation((cmd, args, callback) => {
            callback(null, 'Container started');
        });

        const res = await request(app).post('/api/homestore/start/jellyfin');
        
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.message).toBe('App started successfully');
        expect(execFile).toHaveBeenCalledWith('docker', ['start', 'homestore-jellyfin'], expect.any(Function));
    });

    test('returns 400 for invalid app ID', async () => {
        const res = await request(app).post('/api/homestore/start/invalid!');
        
        expect(res.status).toBe(400);
        expect(res.body.error).toBe('Invalid app ID');
    });

    test('handles docker start failure', async () => {
        execFile.mockImplementation((cmd, args, callback) => {
            callback(new Error('Start failed'));
        });

        const res = await request(app).post('/api/homestore/start/jellyfin');
        
        expect(res.status).toBe(500);
        expect(res.body.success).toBe(false);
        expect(res.body.error).toBe('Start failed');
    });
});

describe('POST /api/homestore/stop/:id', () => {
    test('stops app container successfully', async () => {
        execFile.mockImplementation((cmd, args, callback) => {
            callback(null, 'Container stopped');
        });

        const res = await request(app).post('/api/homestore/stop/jellyfin');
        
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.message).toBe('App stopped successfully');
        expect(execFile).toHaveBeenCalledWith('docker', ['stop', 'homestore-jellyfin'], expect.any(Function));
    });

    test('returns 400 for invalid app ID', async () => {
        const res = await request(app).post('/api/homestore/stop/invalid!');
        
        expect(res.status).toBe(400);
        expect(res.body.error).toBe('Invalid app ID');
    });

    test('handles docker stop failure', async () => {
        execFile.mockImplementation((cmd, args, callback) => {
            callback(new Error('Stop failed'));
        });

        const res = await request(app).post('/api/homestore/stop/jellyfin');
        
        expect(res.status).toBe(500);
        expect(res.body.success).toBe(false);
        expect(res.body.error).toBe('Stop failed');
    });
});

describe('POST /api/homestore/restart/:id', () => {
    test('restarts app container successfully', async () => {
        execFile.mockImplementation((cmd, args, callback) => {
            callback(null, 'Container restarted');
        });

        const res = await request(app).post('/api/homestore/restart/jellyfin');
        
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.message).toBe('App restarted successfully');
        expect(execFile).toHaveBeenCalledWith('docker', ['restart', 'homestore-jellyfin'], expect.any(Function));
    });

    test('returns 400 for invalid app ID', async () => {
        const res = await request(app).post('/api/homestore/restart/invalid!');
        
        expect(res.status).toBe(400);
        expect(res.body.error).toBe('Invalid app ID');
    });

    test('handles docker restart failure', async () => {
        execFile.mockImplementation((cmd, args, callback) => {
            callback(new Error('Restart failed'));
        });

        const res = await request(app).post('/api/homestore/restart/jellyfin');
        
        expect(res.status).toBe(500);
        expect(res.body.success).toBe(false);
        expect(res.body.error).toBe('Restart failed');
    });
});

describe('GET /api/homestore/logs/:id', () => {
    test('returns app logs successfully', async () => {
        execFile.mockImplementation((cmd, args, callback) => {
            callback(null, 'App log line 1\nApp log line 2\n');
        });

        const res = await request(app).get('/api/homestore/logs/jellyfin');
        
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.logs).toBe('App log line 1\nApp log line 2\n');
        expect(execFile).toHaveBeenCalledWith('docker', ['logs', '--tail', '100', 'homestore-jellyfin'], expect.any(Function));
    });

    test('returns 400 for invalid app ID', async () => {
        const res = await request(app).get('/api/homestore/logs/invalid!');
        
        expect(res.status).toBe(400);
        expect(res.body.error).toBe('Invalid app ID');
    });

    test('handles docker logs failure', async () => {
        execFile.mockImplementation((cmd, args, callback) => {
            callback(new Error('Logs failed'));
        });

        const res = await request(app).get('/api/homestore/logs/jellyfin');
        
        expect(res.status).toBe(500);
        expect(res.body.success).toBe(false);
        expect(res.body.error).toBe('Logs failed');
    });
});

describe('POST /api/homestore/update/:id', () => {
    test('returns 400 for invalid app ID', async () => {
        const res = await request(app).post('/api/homestore/update/invalid!');
        
        expect(res.status).toBe(400);
        expect(res.body.error).toBe('Invalid app ID');
    });

    test('returns 404 for unknown app', async () => {
        mockReadFile.mockResolvedValue(JSON.stringify(mockCatalog));

        const res = await request(app).post('/api/homestore/update/unknown');
        
        expect(res.status).toBe(404);
        expect(res.body.success).toBe(false);
        expect(res.body.error).toBe('App not found');
    });

    test('returns 404 if app not installed', async () => {
        mockReadFile
            .mockResolvedValueOnce(JSON.stringify(mockCatalog))
            .mockRejectedValueOnce(new Error('Not found'));

        const res = await request(app).post('/api/homestore/update/plex');
        
        expect(res.status).toBe(404);
        expect(res.body.success).toBe(false);
        expect(res.body.error).toBe('App not installed');
    });

    test('updates app successfully', async () => {
        mockReadFile
            .mockResolvedValueOnce(JSON.stringify(mockCatalog))
            .mockResolvedValueOnce(JSON.stringify(mockInstalled));
        
        execFile.mockImplementation((cmd, args, callback) => {
            callback(null, 'Success');
        });

        mockMkdir.mockResolvedValue();

        const res = await request(app).post('/api/homestore/update/jellyfin');
        
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.message).toBe('App updated successfully');
    });

    test('handles update failure', async () => {
        mockReadFile
            .mockResolvedValueOnce(JSON.stringify(mockCatalog))
            .mockResolvedValueOnce(JSON.stringify(mockInstalled));
        
        execFile.mockImplementation((cmd, args, callback) => {
            if (args.includes('pull')) {
                callback(new Error('Pull failed'));
            }
        });

        const res = await request(app).post('/api/homestore/update/jellyfin');
        
        expect(res.status).toBe(500);
        expect(res.body.success).toBe(false);
        expect(res.body.error).toBe('Pull failed');
    });
});

describe('GET /api/homestore/check-docker', () => {
    test('returns docker available', async () => {
        exec.mockImplementation((cmd, callback) => {
            callback(null, 'Docker version 20.10.0');
        });

        const res = await request(app).get('/api/homestore/check-docker');
        
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.available).toBe(true);
    });

    test('returns docker not available', async () => {
        exec.mockImplementation((cmd, callback) => {
            callback(new Error('Docker not found'));
        });

        const res = await request(app).get('/api/homestore/check-docker');
        
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.available).toBe(false);
    });
});