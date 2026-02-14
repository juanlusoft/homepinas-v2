/**
 * HomePiNAS - Active Backup Routes Tests
 * Tests for centralized PC/server backup endpoints
 */

const express = require('express');
const request = require('supertest');
const path = require('path');

// Mock fs before requiring router
jest.mock('fs', () => {
    const actual = jest.requireActual('fs');
    return {
        ...actual,
        existsSync: jest.fn(() => true),
        mkdirSync: jest.fn(),
        readdirSync: jest.fn(() => []),
        statSync: jest.fn(() => ({ isDirectory: () => true, size: 1000, mtime: new Date() })),
        readFileSync: jest.fn(() => 'ssh-rsa AAAAB...'),
        writeFileSync: jest.fn(),
        rmSync: jest.fn(),
        unlinkSync: jest.fn(),
        symlinkSync: jest.fn(),
        readlinkSync: jest.fn(() => 'v1'),
        chmodSync: jest.fn(),
    };
});

// Mock child_process
jest.mock('child_process', () => ({
    execFile: jest.fn((cmd, args, cb) => {
        if (typeof cb === 'function') cb(null, { stdout: '', stderr: '' });
        return { stdout: '', stderr: '' };
    }),
    spawn: jest.fn(() => ({
        stdin: { write: jest.fn(), end: jest.fn() },
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        on: jest.fn((event, cb) => {
            if (event === 'close') setTimeout(() => cb(0), 0);
        }),
        kill: jest.fn()
    }))
}));

jest.mock('util', () => ({
    ...jest.requireActual('util'),
    promisify: jest.fn((fn) => (...args) => Promise.resolve({ stdout: 'ssh-rsa AAAAB...', stderr: '' }))
}));

// Mock data utils
jest.mock('../../utils/data', () => ({
    getData: jest.fn(),
    saveData: jest.fn()
}));

// Mock security
jest.mock('../../utils/security', () => ({
    logSecurityEvent: jest.fn()
}));

// Mock auth middleware
jest.mock('../../middleware/auth', () => ({
    requireAuth: (req, res, next) => {
        req.user = { username: 'testuser', role: 'admin' };
        next();
    }
}));

// Mock os module - spread actual and override specific functions
jest.mock('os', () => {
    const actual = jest.requireActual('os');
    return {
        ...actual,
        homedir: () => '/home/test',
        hostname: () => 'test-nas',
        networkInterfaces: () => ({
            eth0: [{ family: 'IPv4', address: '192.168.1.100', internal: false }]
        })
    };
});

const fs = require('fs');
const { getData, saveData } = require('../../utils/data');
const { logSecurityEvent } = require('../../utils/security');

// Suppress console during tests
beforeAll(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterAll(() => {
    console.log.mockRestore();
    console.error.mockRestore();
});

// Create Express app
const activeBackupRouter = require('../../routes/active-backup');
const app = express();
app.use(express.json());
app.use('/api/active-backup', activeBackupRouter);

// ============================================================================
// AGENT ENDPOINTS (NO AUTH)
// ============================================================================

describe('POST /api/active-backup/agent/register', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('registers new agent successfully', async () => {
        getData.mockReturnValue({
            activeBackup: { devices: [], pendingAgents: [] }
        });

        const res = await request(app)
            .post('/api/active-backup/agent/register')
            .send({ hostname: 'test-pc', ip: '192.168.1.50', os: 'windows', mac: 'AA:BB:CC:DD:EE:FF' });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.status).toBe('pending');
        expect(res.body.agentId).toBeDefined();
        expect(res.body.agentToken).toBeDefined();
        expect(saveData).toHaveBeenCalled();
    });

    test('returns existing agent if already registered', async () => {
        getData.mockReturnValue({
            activeBackup: {
                devices: [{
                    id: 'existing-id',
                    agentToken: 'existing-token',
                    agentHostname: 'test-pc',
                    ip: '192.168.1.50',
                    agentMac: 'AA:BB:CC:DD:EE:FF',
                    status: 'approved'
                }],
                pendingAgents: []
            }
        });

        const res = await request(app)
            .post('/api/active-backup/agent/register')
            .send({ hostname: 'test-pc', ip: '192.168.1.50', mac: 'AA:BB:CC:DD:EE:FF' });

        expect(res.status).toBe(200);
        expect(res.body.agentId).toBe('existing-id');
        expect(res.body.status).toBe('approved');
    });

    test('returns pending agent if already pending', async () => {
        getData.mockReturnValue({
            activeBackup: {
                devices: [],
                pendingAgents: [{
                    id: 'pending-id',
                    agentToken: 'pending-token',
                    hostname: 'test-pc',
                    ip: '192.168.1.50',
                    mac: 'AA:BB:CC:DD:EE:FF'
                }]
            }
        });

        const res = await request(app)
            .post('/api/active-backup/agent/register')
            .send({ hostname: 'test-pc', ip: '192.168.1.50', mac: 'AA:BB:CC:DD:EE:FF' });

        expect(res.status).toBe(200);
        expect(res.body.agentId).toBe('pending-id');
        expect(res.body.status).toBe('pending');
    });

    test('rejects missing hostname', async () => {
        const res = await request(app)
            .post('/api/active-backup/agent/register')
            .send({ ip: '192.168.1.50' });

        expect(res.status).toBe(400);
        expect(res.body.error).toContain('hostname');
    });
});

describe('GET /api/active-backup/agent/poll', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('returns pending status for pending agent', async () => {
        getData.mockReturnValue({
            activeBackup: {
                devices: [],
                pendingAgents: [{ agentToken: 'pending-token' }]
            }
        });

        const res = await request(app)
            .get('/api/active-backup/agent/poll')
            .set('X-Agent-Token', 'pending-token');

        expect(res.status).toBe(200);
        expect(res.body.status).toBe('pending');
    });

    test('returns config for approved device', async () => {
        getData.mockReturnValue({
            activeBackup: {
                devices: [{
                    id: 'device-1',
                    agentToken: 'approved-token',
                    name: 'Test PC',
                    backupType: 'files',
                    schedule: '0 2 * * *',
                    retention: 5,
                    paths: ['/home'],
                    enabled: true
                }],
                pendingAgents: []
            }
        });

        const res = await request(app)
            .get('/api/active-backup/agent/poll')
            .set('X-Agent-Token', 'approved-token');

        expect(res.status).toBe(200);
        expect(res.body.status).toBe('approved');
        expect(res.body.config.deviceName).toBe('Test PC');
        expect(res.body.config.backupType).toBe('files');
    });

    test('includes samba credentials for image backups', async () => {
        getData.mockReturnValue({
            activeBackup: {
                devices: [{
                    id: 'device-1',
                    agentToken: 'image-token',
                    name: 'Windows PC',
                    backupType: 'image',
                    sambaShare: 'backup-abc123',
                    sambaUser: 'backupuser',
                    sambaPass: 'secret'
                }],
                pendingAgents: []
            }
        });

        const res = await request(app)
            .get('/api/active-backup/agent/poll')
            .set('X-Agent-Token', 'image-token');

        expect(res.status).toBe(200);
        expect(res.body.config.sambaShare).toBe('backup-abc123');
        expect(res.body.config.nasAddress).toBeDefined();
    });

    test('rejects missing token', async () => {
        const res = await request(app)
            .get('/api/active-backup/agent/poll');

        expect(res.status).toBe(401);
        expect(res.body.error).toContain('token');
    });

    test('returns 404 for unknown token', async () => {
        getData.mockReturnValue({
            activeBackup: { devices: [], pendingAgents: [] }
        });

        const res = await request(app)
            .get('/api/active-backup/agent/poll')
            .set('X-Agent-Token', 'unknown-token');

        expect(res.status).toBe(404);
    });
});

describe('POST /api/active-backup/agent/report', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('records successful backup', async () => {
        getData.mockReturnValue({
            activeBackup: {
                devices: [{
                    id: 'device-1',
                    agentToken: 'valid-token',
                    name: 'Test PC'
                }]
            }
        });

        const res = await request(app)
            .post('/api/active-backup/agent/report')
            .set('X-Agent-Token', 'valid-token')
            .send({ status: 'success', duration: 120, size: 1024000 });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(saveData).toHaveBeenCalled();
        expect(logSecurityEvent).toHaveBeenCalledWith(
            'active_backup_agent_success',
            'agent',
            expect.objectContaining({ device: 'Test PC' })
        );
    });

    test('records failed backup and sends notification', async () => {
        getData.mockReturnValue({
            activeBackup: {
                devices: [{
                    id: 'device-1',
                    agentToken: 'valid-token',
                    name: 'Test PC'
                }]
            },
            notifications: {}
        });

        const res = await request(app)
            .post('/api/active-backup/agent/report')
            .set('X-Agent-Token', 'valid-token')
            .send({ status: 'failed', error: 'Connection timeout' });

        expect(res.status).toBe(200);
        expect(logSecurityEvent).toHaveBeenCalledWith(
            'active_backup_agent_failed',
            'agent',
            expect.anything()
        );
    });

    test('rejects missing token', async () => {
        const res = await request(app)
            .post('/api/active-backup/agent/report')
            .send({ status: 'success' });

        expect(res.status).toBe(401);
    });
});

// ============================================================================
// DEVICE MANAGEMENT (WITH AUTH)
// ============================================================================

describe('GET /api/active-backup/devices', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('lists all devices with backup info', async () => {
        fs.existsSync.mockReturnValue(true);
        fs.readdirSync.mockReturnValue(['v1', 'v2']);
        fs.statSync.mockReturnValue({ 
            isDirectory: () => true, 
            size: 1000, 
            mtime: new Date() 
        });
        
        getData.mockReturnValue({
            activeBackup: {
                devices: [{
                    id: 'device-1',
                    name: 'My PC',
                    ip: '192.168.1.50',
                    backupType: 'files',
                    lastBackup: '2026-02-14T10:00:00Z',
                    lastResult: 'success'
                }]
            }
        });

        const res = await request(app)
            .get('/api/active-backup/devices');

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.devices).toHaveLength(1);
        expect(res.body.devices[0].name).toBe('My PC');
        expect(res.body.devices[0].backupCount).toBe(2);
    });

    test('returns empty array when no devices', async () => {
        getData.mockReturnValue({});

        const res = await request(app)
            .get('/api/active-backup/devices');

        expect(res.status).toBe(200);
        expect(res.body.devices).toEqual([]);
    });
});

describe('POST /api/active-backup/devices', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        fs.existsSync.mockReturnValue(true);
    });

    test('creates file backup device', async () => {
        getData.mockReturnValue({ activeBackup: { devices: [] } });

        const res = await request(app)
            .post('/api/active-backup/devices')
            .send({
                name: 'Linux Server',
                ip: '192.168.1.100',
                sshUser: 'root',
                sshPort: 22,
                paths: ['/home', '/var/www'],
                backupType: 'files'
            });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.device.name).toBe('Linux Server');
        expect(res.body.device.backupType).toBe('files');
        expect(res.body.sshPublicKey).toBeDefined();
        expect(res.body.setupInstructions).toContain('ssh');
        expect(saveData).toHaveBeenCalled();
        expect(logSecurityEvent).toHaveBeenCalledWith(
            'active_backup_device_added',
            'testuser',
            expect.anything()
        );
    });

    test('creates image backup device with samba setup', async () => {
        getData.mockReturnValue({ activeBackup: { devices: [] } });
        fs.readFileSync.mockReturnValue('[global]\n');

        const res = await request(app)
            .post('/api/active-backup/devices')
            .send({
                name: 'Windows PC',
                ip: '192.168.1.101',
                backupType: 'image',
                os: 'windows'
            });

        expect(res.status).toBe(200);
        expect(res.body.device.backupType).toBe('image');
        expect(res.body.device.sambaShare).toBeDefined();
    });

    test('rejects missing required fields', async () => {
        getData.mockReturnValue({ activeBackup: { devices: [] } });

        const res = await request(app)
            .post('/api/active-backup/devices')
            .send({ name: 'Test' });

        expect(res.status).toBe(400);
        expect(res.body.error).toContain('ip');
    });

    test('rejects file backup without sshUser', async () => {
        getData.mockReturnValue({ activeBackup: { devices: [] } });

        const res = await request(app)
            .post('/api/active-backup/devices')
            .send({
                name: 'Server',
                ip: '192.168.1.100',
                backupType: 'files'
            });

        expect(res.status).toBe(400);
        expect(res.body.error).toContain('sshUser');
    });
});

describe('PUT /api/active-backup/devices/:id', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('updates device configuration', async () => {
        getData.mockReturnValue({
            activeBackup: {
                devices: [{
                    id: 'device-1',
                    name: 'Old Name',
                    ip: '192.168.1.50',
                    schedule: '0 2 * * *'
                }]
            }
        });

        const res = await request(app)
            .put('/api/active-backup/devices/device-1')
            .send({
                name: 'New Name',
                schedule: '0 3 * * *',
                retention: 10
            });

        expect(res.status).toBe(200);
        expect(res.body.device.name).toBe('New Name');
        expect(res.body.device.schedule).toBe('0 3 * * *');
        expect(saveData).toHaveBeenCalled();
    });

    test('returns 404 for unknown device', async () => {
        getData.mockReturnValue({ activeBackup: { devices: [] } });

        const res = await request(app)
            .put('/api/active-backup/devices/unknown')
            .send({ name: 'Test' });

        expect(res.status).toBe(404);
    });
});

describe('DELETE /api/active-backup/devices/:id', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('removes device without data', async () => {
        getData.mockReturnValue({
            activeBackup: {
                devices: [{
                    id: 'device-1',
                    name: 'Test PC'
                }]
            }
        });

        const res = await request(app)
            .delete('/api/active-backup/devices/device-1');

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(saveData).toHaveBeenCalled();
        expect(logSecurityEvent).toHaveBeenCalledWith(
            'active_backup_device_removed',
            'testuser',
            expect.anything()
        );
    });

    test('removes device and deletes data when requested', async () => {
        getData.mockReturnValue({
            activeBackup: {
                devices: [{
                    id: 'device-1',
                    name: 'Test PC'
                }]
            }
        });

        const res = await request(app)
            .delete('/api/active-backup/devices/device-1?deleteData=true');

        expect(res.status).toBe(200);
        expect(fs.rmSync).toHaveBeenCalled();
    });

    test('returns 404 for unknown device', async () => {
        getData.mockReturnValue({ activeBackup: { devices: [] } });

        const res = await request(app)
            .delete('/api/active-backup/devices/unknown');

        expect(res.status).toBe(404);
    });
});

// ============================================================================
// SSH KEY
// ============================================================================

describe('GET /api/active-backup/ssh-key', () => {
    test('returns public SSH key', async () => {
        fs.existsSync.mockReturnValue(true);
        fs.readFileSync.mockReturnValue('ssh-rsa AAAAB3...');

        const res = await request(app)
            .get('/api/active-backup/ssh-key');

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.publicKey).toContain('ssh-rsa');
    });
});

// ============================================================================
// BACKUP OPERATIONS
// ============================================================================

describe('POST /api/active-backup/devices/:id/backup', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('starts manual backup', async () => {
        getData.mockReturnValue({
            activeBackup: {
                devices: [{
                    id: 'device-1',
                    name: 'Test PC',
                    paths: ['/home'],
                    sshUser: 'user',
                    ip: '192.168.1.50'
                }]
            }
        });

        const res = await request(app)
            .post('/api/active-backup/devices/device-1/backup');

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.message).toContain('started');
    });

    test('returns 404 for unknown device', async () => {
        getData.mockReturnValue({ activeBackup: { devices: [] } });

        const res = await request(app)
            .post('/api/active-backup/devices/unknown/backup');

        expect(res.status).toBe(404);
    });
});

describe('GET /api/active-backup/devices/:id/status', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('returns idle status with last backup info', async () => {
        getData.mockReturnValue({
            activeBackup: {
                devices: [{
                    id: 'device-1',
                    lastBackup: '2026-02-14T10:00:00Z',
                    lastResult: 'success',
                    lastDuration: 120
                }]
            }
        });

        const res = await request(app)
            .get('/api/active-backup/devices/device-1/status');

        expect(res.status).toBe(200);
        expect(res.body.status).toBe('idle');
        expect(res.body.lastResult).toBe('success');
        expect(res.body.lastDuration).toBe(120);
    });
});

// ============================================================================
// BROWSE & RESTORE
// ============================================================================

describe('GET /api/active-backup/devices/:id/versions', () => {
    test('lists backup versions', async () => {
        fs.existsSync.mockReturnValue(true);
        fs.readdirSync.mockReturnValue(['v1', 'v2', 'v3']);
        fs.statSync.mockReturnValue({
            isDirectory: () => true,
            mtime: new Date('2026-02-14'),
            size: 1000
        });

        const res = await request(app)
            .get('/api/active-backup/devices/device-1/versions');

        expect(res.status).toBe(200);
        expect(res.body.versions).toHaveLength(3);
    });
});

describe('GET /api/active-backup/devices/:id/browse', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('browses backup directory', async () => {
        fs.existsSync.mockReturnValue(true);
        fs.statSync.mockReturnValue({ isDirectory: () => true, size: 1000, mtime: new Date() });
        fs.readdirSync.mockReturnValue([
            { name: 'folder', isDirectory: () => true },
            { name: 'file.txt', isDirectory: () => false }
        ]);

        const res = await request(app)
            .get('/api/active-backup/devices/device-1/browse?version=v1&path=/home');

        expect(res.status).toBe(200);
        expect(res.body.items).toBeDefined();
    });

    test('blocks path traversal', async () => {
        fs.existsSync.mockReturnValue(true);
        fs.statSync.mockReturnValue({ isDirectory: () => true });

        const res = await request(app)
            .get('/api/active-backup/devices/device-1/browse?version=v1&path=/../../../etc/passwd');

        expect(res.status).toBe(403);
        expect(res.body.error).toContain('denied');
    });
});

describe('GET /api/active-backup/devices/:id/download', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('blocks path traversal on download', async () => {
        fs.existsSync.mockReturnValue(true);
        fs.statSync.mockReturnValue({ isDirectory: () => false });

        const res = await request(app)
            .get('/api/active-backup/devices/device-1/download?version=v1&path=/../../../etc/passwd');

        expect(res.status).toBe(403);
    });

    test('returns 404 for missing file', async () => {
        fs.existsSync.mockReturnValue(false);

        const res = await request(app)
            .get('/api/active-backup/devices/device-1/download?version=v1&path=/missing.txt');

        expect(res.status).toBe(404);
    });
});

describe('POST /api/active-backup/devices/:id/restore', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('rejects missing parameters', async () => {
        getData.mockReturnValue({
            activeBackup: {
                devices: [{ id: 'device-1', name: 'Test' }]
            }
        });

        const res = await request(app)
            .post('/api/active-backup/devices/device-1/restore')
            .send({});

        expect(res.status).toBe(400);
        expect(res.body.error).toContain('required');
    });

    test('returns 404 for unknown device', async () => {
        getData.mockReturnValue({ activeBackup: { devices: [] } });

        const res = await request(app)
            .post('/api/active-backup/devices/unknown/restore')
            .send({ version: 'v1', sourcePath: '/home' });

        expect(res.status).toBe(404);
    });
});

// ============================================================================
// PENDING AGENTS
// ============================================================================

describe('GET /api/active-backup/pending', () => {
    test('lists pending agents', async () => {
        getData.mockReturnValue({
            activeBackup: {
                devices: [],
                pendingAgents: [
                    { id: 'agent-1', hostname: 'PC-1', ip: '192.168.1.50' },
                    { id: 'agent-2', hostname: 'PC-2', ip: '192.168.1.51' }
                ]
            }
        });

        const res = await request(app)
            .get('/api/active-backup/pending');

        expect(res.status).toBe(200);
        expect(res.body.pending).toHaveLength(2);
    });
});

describe('POST /api/active-backup/pending/:id/approve', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('approves pending agent', async () => {
        getData.mockReturnValue({
            activeBackup: {
                devices: [],
                pendingAgents: [{
                    id: 'agent-1',
                    hostname: 'Test-PC',
                    ip: '192.168.1.50',
                    agentToken: 'token-123',
                    os: 'windows'
                }]
            }
        });

        const res = await request(app)
            .post('/api/active-backup/pending/agent-1/approve')
            .send({ name: 'My Windows PC', backupType: 'files' });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(saveData).toHaveBeenCalled();
    });

    test('returns 404 for unknown agent', async () => {
        getData.mockReturnValue({
            activeBackup: { devices: [], pendingAgents: [] }
        });

        const res = await request(app)
            .post('/api/active-backup/pending/unknown/approve')
            .send({ name: 'Test' });

        expect(res.status).toBe(404);
    });
});

describe('POST /api/active-backup/pending/:id/reject', () => {
    test('rejects pending agent', async () => {
        getData.mockReturnValue({
            activeBackup: {
                devices: [],
                pendingAgents: [{ id: 'agent-1', hostname: 'Test' }]
            }
        });

        const res = await request(app)
            .post('/api/active-backup/pending/agent-1/reject');

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(saveData).toHaveBeenCalled();
    });
});
