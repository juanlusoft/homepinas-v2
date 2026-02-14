/**
 * HomePiNAS - Backup Routes Tests
 */
const express = require('express');
const request = require('supertest');
const path = require('path');

jest.mock('fs', () => ({
    ...jest.requireActual('fs'),
    existsSync: jest.fn(() => true),
    mkdirSync: jest.fn(),
    readdirSync: jest.fn(() => []),
    statSync: jest.fn(() => ({ isDirectory: () => true, size: 1000, mtime: new Date() })),
    readFileSync: jest.fn(() => '{}'),
    writeFileSync: jest.fn(),
    rmSync: jest.fn()
}));

jest.mock('child_process', () => ({
    execFile: jest.fn((cmd, args, cb) => {
        if (typeof cb === 'function') cb(null, { stdout: '', stderr: '' });
    }),
    spawn: jest.fn(() => {
        const EventEmitter = require('events');
        const proc = new EventEmitter();
        proc.stdout = new EventEmitter();
        proc.stderr = new EventEmitter();
        proc.pid = 12345;
        proc.kill = jest.fn();
        setTimeout(() => proc.emit('close', 0), 10);
        return proc;
    })
}));

jest.mock('../../middleware/auth', () => ({
    requireAuth: (req, res, next) => { req.user = { username: 'testadmin', role: 'admin' }; next(); }
}));

jest.mock('../../utils/data', () => ({
    getData: jest.fn(() => ({ backups: [] })),
    saveData: jest.fn()
}));

jest.mock('../../utils/security', () => ({
    logSecurityEvent: jest.fn()
}));

// Mock path.resolve to allow test paths
const originalResolve = path.resolve;
jest.spyOn(path, 'resolve').mockImplementation((...args) => {
    const result = originalResolve(...args);
    // Make test paths appear to be within /mnt/
    if (args[0] && args[0].includes('/mnt/')) {
        return args[0];
    }
    return result;
});

const { getData, saveData } = require('../../utils/data');
const backupRouter = require('../../routes/backup');
const app = express();
app.use(express.json());
app.use('/api/backup', backupRouter);

beforeAll(() => { 
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {}); 
});
afterAll(() => { 
    console.log.mockRestore();
    console.error.mockRestore(); 
});

describe('GET /api/backup/jobs', () => {
    test('returns backup jobs list', async () => {
        getData.mockReturnValue({ backups: [] });
        
        const res = await request(app).get('/api/backup/jobs');
        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('jobs');
    });
});

describe('POST /api/backup/jobs', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        getData.mockReturnValue({ backups: [] });
    });

    test('creates new backup job', async () => {
        const res = await request(app)
            .post('/api/backup/jobs')
            .send({ 
                name: 'Daily Backup',
                source: '/mnt/storage/data',
                destination: '/mnt/storage/backups',
                type: 'rsync',
                schedule: { enabled: true, cron: '0 2 * * *' },
                retention: { keepLast: 7 }
            });
        expect(res.status).toBe(201);
        expect(res.body.job.name).toBe('Daily Backup');
        expect(saveData).toHaveBeenCalled();
    });

    test('rejects missing name', async () => {
        const res = await request(app)
            .post('/api/backup/jobs')
            .send({ source: '/mnt/storage', destination: '/mnt/backup', type: 'rsync' });
        expect(res.status).toBe(400);
        expect(res.body.error).toContain('name');
    });

    test('rejects missing source/destination', async () => {
        const res = await request(app)
            .post('/api/backup/jobs')
            .send({ name: 'Test', type: 'rsync' });
        expect(res.status).toBe(400);
    });

    test('rejects invalid type', async () => {
        const res = await request(app)
            .post('/api/backup/jobs')
            .send({ 
                name: 'Test',
                source: '/mnt/storage/data',
                destination: '/mnt/storage/backups',
                type: 'invalid'
            });
        expect(res.status).toBe(400);
        expect(res.body.error).toContain('Type');
    });
});

describe('PUT /api/backup/jobs/:id', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('updates backup job', async () => {
        getData.mockReturnValue({ 
            backups: [{ 
                id: 'job123', 
                name: 'Old Name', 
                source: '/mnt/storage/data',
                destination: '/mnt/storage/backups',
                type: 'rsync'
            }] 
        });

        const res = await request(app)
            .put('/api/backup/jobs/job123')
            .send({ name: 'New Name' });
        expect(res.status).toBe(200);
        expect(saveData).toHaveBeenCalled();
    });

    test('returns 404 for unknown job', async () => {
        getData.mockReturnValue({ backups: [] });

        const res = await request(app)
            .put('/api/backup/jobs/unknown')
            .send({ name: 'Test' });
        expect(res.status).toBe(404);
    });
});

describe('DELETE /api/backup/jobs/:id', () => {
    test('deletes backup job', async () => {
        getData.mockReturnValue({ 
            backups: [{ id: 'job123', name: 'Test' }] 
        });

        const res = await request(app).delete('/api/backup/jobs/job123');
        expect(res.status).toBe(200);
        expect(saveData).toHaveBeenCalled();
    });

    test('returns 404 for unknown job', async () => {
        getData.mockReturnValue({ backups: [] });

        const res = await request(app).delete('/api/backup/jobs/unknown');
        expect(res.status).toBe(404);
    });
});

describe('POST /api/backup/jobs/:id/run', () => {
    test('triggers backup job', async () => {
        getData.mockReturnValue({ 
            backups: [{ 
                id: 'job123', 
                name: 'Test', 
                source: '/mnt/storage/data', 
                destination: '/mnt/storage/backups',
                type: 'rsync',
                excludes: [],
                retention: { keepLast: 5 }
            }] 
        });

        const res = await request(app).post('/api/backup/jobs/job123/run');
        expect(res.status).toBe(200);
    });

    test('returns 404 for unknown job', async () => {
        getData.mockReturnValue({ backups: [] });

        const res = await request(app).post('/api/backup/jobs/unknown/run');
        expect(res.status).toBe(404);
    });
});

describe('GET /api/backup/jobs/:id/status', () => {
    test('returns job status', async () => {
        getData.mockReturnValue({ 
            backups: [{ id: 'job123', lastRun: null, lastResult: null }] 
        });

        const res = await request(app).get('/api/backup/jobs/job123/status');
        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('status');
    });

    test('returns 404 for unknown job', async () => {
        getData.mockReturnValue({ backups: [] });

        const res = await request(app).get('/api/backup/jobs/unknown/status');
        expect(res.status).toBe(404);
    });
});

describe('GET /api/backup/jobs/:id/history', () => {
    test('returns job history', async () => {
        getData.mockReturnValue({ 
            backups: [{ id: 'job123', history: [] }] 
        });

        const res = await request(app).get('/api/backup/jobs/job123/history');
        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('history');
    });

    test('returns 404 for unknown job', async () => {
        getData.mockReturnValue({ backups: [] });

        const res = await request(app).get('/api/backup/jobs/unknown/history');
        expect(res.status).toBe(404);
    });
});
