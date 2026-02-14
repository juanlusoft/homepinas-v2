/**
 * HomePiNAS - Cloud Backup Routes Tests
 * Tests for cloud backup management API endpoints
 */

const express = require('express');
const request = require('supertest');

// Mock fs
jest.mock('fs', () => ({
    promises: {
        readFile: jest.fn(),
        writeFile: jest.fn(),
        mkdir: jest.fn(),
        access: jest.fn(),
        stat: jest.fn(),
        unlink: jest.fn()
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

jest.mock('../../middleware/rbac', () => ({
    requireAdmin: (req, res, next) => next()
}));

// Mock utils
jest.mock('../../utils/security', () => ({
    logSecurityEvent: jest.fn()
}));

jest.mock('../../utils/data', () => ({
    getData: jest.fn(() => ({})),
    saveData: jest.fn()
}));

const fs = require('fs');
const { exec, execFile } = require('child_process');
const { getData, saveData } = require('../../utils/data');

// Get mock references
const mockReadFile = fs.promises.readFile;
const mockWriteFile = fs.promises.writeFile;
const mockMkdir = fs.promises.mkdir;
const mockAccess = fs.promises.access;
const mockStat = fs.promises.stat;
const mockUnlink = fs.promises.unlink;

const cloudBackupRouter = require('../../routes/cloud-backup');
const app = express();
app.use(express.json());
app.use('/api/cloud-backup', cloudBackupRouter);

// Mock data
const mockConfig = {
    provider: 'google-drive',
    config: {
        client_id: 'test-client-id',
        client_secret: 'test-client-secret'
    },
    enabled: true
};

const mockBackupList = [
    {
        name: 'backup-2024-02-14-12-00-00.tar.gz',
        size: 1024000,
        modified: '2024-02-14T12:00:00Z'
    },
    {
        name: 'backup-2024-02-13-12-00-00.tar.gz',
        size: 2048000,
        modified: '2024-02-13T12:00:00Z'
    }
];

const mockSchedule = {
    enabled: true,
    frequency: 'daily',
    time: '02:00',
    retention: 7
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
    mockAccess.mockReset();
    mockStat.mockReset();
    mockUnlink.mockReset();
    exec.mockReset();
    execFile.mockReset();
    getData.mockReset();
    saveData.mockReset();
});

describe('GET /api/cloud-backup/providers', () => {
    test('returns available providers', async () => {
        const res = await request(app).get('/api/cloud-backup/providers');
        
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.providers).toBeDefined();
        expect(res.body.providers['google-drive']).toMatchObject({
            name: 'Google Drive',
            type: 'rclone'
        });
        expect(res.body.providers.s3).toMatchObject({
            name: 'Amazon S3',
            type: 'rclone'
        });
    });
});

describe('GET /api/cloud-backup/config', () => {
    test('returns current configuration with masked secrets', async () => {
        mockReadFile.mockResolvedValue(JSON.stringify(mockConfig));

        const res = await request(app).get('/api/cloud-backup/config');
        
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.config).toMatchObject({
            provider: 'google-drive',
            enabled: true
        });
        expect(res.body.config.config.client_secret).toBe('***');
        expect(res.body.config.config.client_id).toBe('test-client-id');
    });

    test('returns empty config when file not found', async () => {
        mockReadFile.mockRejectedValue(new Error('ENOENT'));

        const res = await request(app).get('/api/cloud-backup/config');
        
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.config).toBeNull();
    });

    test('handles invalid JSON in config file', async () => {
        mockReadFile.mockResolvedValue('invalid-json');

        const res = await request(app).get('/api/cloud-backup/config');
        
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.config).toBeNull();
    });
});

describe('POST /api/cloud-backup/config', () => {
    test('saves configuration successfully', async () => {
        mockMkdir.mockResolvedValue();
        mockWriteFile.mockResolvedValue();

        const newConfig = {
            provider: 'google-drive',
            config: {
                client_id: 'new-client-id',
                client_secret: 'new-client-secret'
            },
            enabled: true
        };

        const res = await request(app)
            .post('/api/cloud-backup/config')
            .send(newConfig);
        
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.message).toBe('Cloud backup configured successfully');
        
        expect(mockWriteFile).toHaveBeenCalled();
    });

    test('returns 400 for missing provider', async () => {
        const res = await request(app)
            .post('/api/cloud-backup/config')
            .send({ config: {} });
        
        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
        expect(res.body.error).toBe('Provider is required');
    });

    test('returns 400 for invalid provider', async () => {
        const res = await request(app)
            .post('/api/cloud-backup/config')
            .send({
                provider: 'invalid-provider',
                config: {}
            });
        
        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
        expect(res.body.error).toBe('Invalid provider');
    });

    test('validates required configuration fields', async () => {
        const res = await request(app)
            .post('/api/cloud-backup/config')
            .send({
                provider: 'google-drive',
                config: {
                    client_id: 'test-id'
                    // Missing required client_secret
                }
            });
        
        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
        expect(res.body.error).toContain('client_secret is required');
    });

    test('handles file write error', async () => {
        mockMkdir.mockResolvedValue();
        mockWriteFile.mockRejectedValue(new Error('Write failed'));

        const res = await request(app)
            .post('/api/cloud-backup/config')
            .send({
                provider: 'google-drive',
                config: {
                    client_id: 'test-id',
                    client_secret: 'test-secret'
                }
            });
        
        expect(res.status).toBe(500);
        expect(res.body.success).toBe(false);
    });
});

describe('POST /api/cloud-backup/test', () => {
    test('tests connection successfully', async () => {
        mockReadFile.mockResolvedValue(JSON.stringify(mockConfig));
        
        execFile.mockImplementation((cmd, args, callback) => {
            callback(null, 'rclone test output');
        });

        const res = await request(app).post('/api/cloud-backup/test');
        
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.message).toBe('Connection test successful');
    });

    test('returns 400 when no configuration exists', async () => {
        mockReadFile.mockRejectedValue(new Error('ENOENT'));

        const res = await request(app).post('/api/cloud-backup/test');
        
        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
        expect(res.body.error).toBe('No cloud backup configuration found');
    });

    test('handles connection test failure', async () => {
        mockReadFile.mockResolvedValue(JSON.stringify(mockConfig));
        
        execFile.mockImplementation((cmd, args, callback) => {
            callback(new Error('Connection failed'));
        });

        const res = await request(app).post('/api/cloud-backup/test');
        
        expect(res.status).toBe(500);
        expect(res.body.success).toBe(false);
        expect(res.body.error).toBe('Connection test failed');
    });
});

describe('GET /api/cloud-backup/status', () => {
    test('returns backup status', async () => {
        mockReadFile.mockResolvedValue(JSON.stringify(mockConfig));
        
        getData.mockReturnValue({
            lastBackup: '2024-02-14T12:00:00Z',
            backupInProgress: false
        });

        const res = await request(app).get('/api/cloud-backup/status');
        
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.status).toMatchObject({
            configured: true,
            enabled: true,
            lastBackup: '2024-02-14T12:00:00Z',
            backupInProgress: false
        });
    });

    test('returns unconfigured status', async () => {
        mockReadFile.mockRejectedValue(new Error('ENOENT'));

        const res = await request(app).get('/api/cloud-backup/status');
        
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.status.configured).toBe(false);
    });
});

describe('POST /api/cloud-backup/backup', () => {
    test('starts manual backup successfully', async () => {
        mockReadFile.mockResolvedValue(JSON.stringify(mockConfig));
        
        getData.mockReturnValue({ backupInProgress: false });
        
        exec.mockImplementation((cmd, callback) => {
            callback(null, 'Backup started');
        });

        const res = await request(app).post('/api/cloud-backup/backup');
        
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.message).toBe('Backup started successfully');
        
        expect(saveData).toHaveBeenCalled();
    });

    test('returns 400 when backup already in progress', async () => {
        mockReadFile.mockResolvedValue(JSON.stringify(mockConfig));
        
        getData.mockReturnValue({ backupInProgress: true });

        const res = await request(app).post('/api/cloud-backup/backup');
        
        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
        expect(res.body.error).toBe('Backup already in progress');
    });

    test('returns 400 when not configured', async () => {
        mockReadFile.mockRejectedValue(new Error('ENOENT'));

        const res = await request(app).post('/api/cloud-backup/backup');
        
        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
        expect(res.body.error).toBe('Cloud backup not configured');
    });

    test('handles backup start failure', async () => {
        mockReadFile.mockResolvedValue(JSON.stringify(mockConfig));
        
        getData.mockReturnValue({ backupInProgress: false });
        
        exec.mockImplementation((cmd, callback) => {
            callback(new Error('Backup failed to start'));
        });

        const res = await request(app).post('/api/cloud-backup/backup');
        
        expect(res.status).toBe(500);
        expect(res.body.success).toBe(false);
    });
});

describe('POST /api/cloud-backup/restore', () => {
    test('starts restore successfully', async () => {
        mockReadFile.mockResolvedValue(JSON.stringify(mockConfig));
        
        exec.mockImplementation((cmd, callback) => {
            callback(null, 'Restore started');
        });

        const res = await request(app)
            .post('/api/cloud-backup/restore')
            .send({ filename: 'backup-2024-02-14-12-00-00.tar.gz' });
        
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.message).toBe('Restore started successfully');
    });

    test('returns 400 for missing filename', async () => {
        const res = await request(app)
            .post('/api/cloud-backup/restore')
            .send({});
        
        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
        expect(res.body.error).toBe('Backup filename is required');
    });

    test('returns 400 when not configured', async () => {
        mockReadFile.mockRejectedValue(new Error('ENOENT'));

        const res = await request(app)
            .post('/api/cloud-backup/restore')
            .send({ filename: 'backup.tar.gz' });
        
        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
        expect(res.body.error).toBe('Cloud backup not configured');
    });

    test('handles restore failure', async () => {
        mockReadFile.mockResolvedValue(JSON.stringify(mockConfig));
        
        exec.mockImplementation((cmd, callback) => {
            callback(new Error('Restore failed'));
        });

        const res = await request(app)
            .post('/api/cloud-backup/restore')
            .send({ filename: 'backup.tar.gz' });
        
        expect(res.status).toBe(500);
        expect(res.body.success).toBe(false);
    });
});

describe('GET /api/cloud-backup/list', () => {
    test('returns list of backups', async () => {
        mockReadFile.mockResolvedValue(JSON.stringify(mockConfig));
        
        execFile.mockImplementation((cmd, args, callback) => {
            const output = mockBackupList.map(backup => 
                `${backup.size}\t${backup.modified}\t${backup.name}`
            ).join('\n');
            callback(null, output);
        });

        const res = await request(app).get('/api/cloud-backup/list');
        
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.backups).toHaveLength(2);
        expect(res.body.backups[0]).toMatchObject({
            name: 'backup-2024-02-14-12-00-00.tar.gz',
            size: expect.any(Number)
        });
    });

    test('returns empty list when no backups', async () => {
        mockReadFile.mockResolvedValue(JSON.stringify(mockConfig));
        
        execFile.mockImplementation((cmd, args, callback) => {
            callback(null, '');
        });

        const res = await request(app).get('/api/cloud-backup/list');
        
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.backups).toHaveLength(0);
    });

    test('returns 400 when not configured', async () => {
        mockReadFile.mockRejectedValue(new Error('ENOENT'));

        const res = await request(app).get('/api/cloud-backup/list');
        
        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
        expect(res.body.error).toBe('Cloud backup not configured');
    });

    test('handles rclone list error', async () => {
        mockReadFile.mockResolvedValue(JSON.stringify(mockConfig));
        
        execFile.mockImplementation((cmd, args, callback) => {
            callback(new Error('List failed'));
        });

        const res = await request(app).get('/api/cloud-backup/list');
        
        expect(res.status).toBe(500);
        expect(res.body.success).toBe(false);
    });
});

describe('DELETE /api/cloud-backup/backup/:filename', () => {
    test('deletes backup successfully', async () => {
        mockReadFile.mockResolvedValue(JSON.stringify(mockConfig));
        
        execFile.mockImplementation((cmd, args, callback) => {
            callback(null, 'File deleted');
        });

        const res = await request(app).delete('/api/cloud-backup/backup/backup-2024-02-14.tar.gz');
        
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.message).toBe('Backup deleted successfully');
    });

    test('returns 400 when not configured', async () => {
        mockReadFile.mockRejectedValue(new Error('ENOENT'));

        const res = await request(app).delete('/api/cloud-backup/backup/backup.tar.gz');
        
        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
        expect(res.body.error).toBe('Cloud backup not configured');
    });

    test('handles deletion error', async () => {
        mockReadFile.mockResolvedValue(JSON.stringify(mockConfig));
        
        execFile.mockImplementation((cmd, args, callback) => {
            callback(new Error('Delete failed'));
        });

        const res = await request(app).delete('/api/cloud-backup/backup/backup.tar.gz');
        
        expect(res.status).toBe(500);
        expect(res.body.success).toBe(false);
    });
});

describe('GET /api/cloud-backup/schedule', () => {
    test('returns backup schedule', async () => {
        mockReadFile.mockResolvedValue(JSON.stringify(mockSchedule));

        const res = await request(app).get('/api/cloud-backup/schedule');
        
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.schedule).toMatchObject({
            enabled: true,
            frequency: 'daily',
            time: '02:00',
            retention: 7
        });
    });

    test('returns null when no schedule configured', async () => {
        mockReadFile.mockRejectedValue(new Error('ENOENT'));

        const res = await request(app).get('/api/cloud-backup/schedule');
        
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.schedule).toBeNull();
    });
});

describe('POST /api/cloud-backup/schedule', () => {
    test('sets backup schedule successfully', async () => {
        mockWriteFile.mockResolvedValue();

        const schedule = {
            enabled: true,
            frequency: 'weekly',
            time: '03:00',
            retention: 14
        };

        const res = await request(app)
            .post('/api/cloud-backup/schedule')
            .send(schedule);
        
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.message).toBe('Backup schedule configured successfully');
        
        expect(mockWriteFile).toHaveBeenCalled();
    });

    test('returns 400 for invalid frequency', async () => {
        const res = await request(app)
            .post('/api/cloud-backup/schedule')
            .send({
                enabled: true,
                frequency: 'invalid',
                time: '03:00'
            });
        
        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
        expect(res.body.error).toContain('Invalid frequency');
    });

    test('returns 400 for invalid time format', async () => {
        const res = await request(app)
            .post('/api/cloud-backup/schedule')
            .send({
                enabled: true,
                frequency: 'daily',
                time: '25:00' // Invalid time
            });
        
        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
        expect(res.body.error).toContain('Invalid time format');
    });

    test('handles file write error', async () => {
        mockWriteFile.mockRejectedValue(new Error('Write failed'));

        const res = await request(app)
            .post('/api/cloud-backup/schedule')
            .send({
                enabled: true,
                frequency: 'daily',
                time: '03:00'
            });
        
        expect(res.status).toBe(500);
        expect(res.body.success).toBe(false);
    });
});

describe('DELETE /api/cloud-backup/schedule', () => {
    test('deletes backup schedule successfully', async () => {
        mockUnlink.mockResolvedValue();

        const res = await request(app).delete('/api/cloud-backup/schedule');
        
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.message).toBe('Backup schedule removed successfully');
        
        expect(mockUnlink).toHaveBeenCalled();
    });

    test('handles file not found error gracefully', async () => {
        mockUnlink.mockRejectedValue(new Error('ENOENT'));

        const res = await request(app).delete('/api/cloud-backup/schedule');
        
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.message).toBe('Backup schedule removed successfully');
    });

    test('handles other deletion errors', async () => {
        mockUnlink.mockRejectedValue(new Error('Permission denied'));

        const res = await request(app).delete('/api/cloud-backup/schedule');
        
        expect(res.status).toBe(500);
        expect(res.body.success).toBe(false);
    });
});