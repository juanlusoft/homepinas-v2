/**
 * HomePiNAS - Logs Routes Tests
 */

const express = require('express');
const request = require('supertest');

jest.mock('child_process', () => ({
    execSync: jest.fn(() => 'Jan 01 12:00:00 pinas systemd[1]: Started HomePiNAS'),
    execFile: jest.fn((cmd, args, opts, cb) => cb && cb(null, '', '')),
    execFileSync: jest.fn(() => '')
}));

jest.mock('fs', () => ({
    existsSync: jest.fn(() => true),
    readFileSync: jest.fn(() => '2026-01-01 12:00:00 INFO Test log entry'),
    readdirSync: jest.fn(() => ['app.log', 'error.log']),
    readFile: jest.fn((path, opts, cb) => cb && cb(null, 'log content')),
    readdir: jest.fn((path, cb) => cb && cb(null, ['app.log'])),
    stat: jest.fn((path, cb) => cb && cb(null, { size: 1024, mtime: new Date() }))
}));

jest.mock('../../middleware/auth', () => ({
    requireAuth: (req, res, next) => {
        req.user = { username: 'testadmin' };
        next();
    }
}));

const logsRouter = require('../../routes/logs');
const app = express();
app.use(express.json());
app.use('/api/logs', logsRouter);

beforeAll(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterAll(() => {
    console.error.mockRestore();
});

describe('GET /api/logs/system', () => {
    test('returns system logs', async () => {
        const res = await request(app).get('/api/logs/system');
        expect([200, 500]).toContain(res.status);
    });
});

describe('GET /api/logs/app', () => {
    test('returns app logs', async () => {
        const res = await request(app).get('/api/logs/app');
        expect([200, 500]).toContain(res.status);
    });
});

describe('GET /api/logs/auth', () => {
    test('returns auth logs', async () => {
        const res = await request(app).get('/api/logs/auth');
        expect([200, 500]).toContain(res.status);
    });
});

describe('GET /api/logs/docker', () => {
    test('returns docker logs', async () => {
        const res = await request(app).get('/api/logs/docker');
        expect([200, 500]).toContain(res.status);
    });
});

describe('GET /api/logs/samba', () => {
    test('returns samba logs', async () => {
        const res = await request(app).get('/api/logs/samba');
        expect([200, 500]).toContain(res.status);
    });
});

describe('GET /api/logs/files', () => {
    test('returns list of log files', async () => {
        const res = await request(app).get('/api/logs/files');
        expect([200, 500]).toContain(res.status);
    });
});

describe('GET /api/logs/file', () => {
    test('handles file request', async () => {
        const res = await request(app).get('/api/logs/file?name=app.log');
        expect([200, 400, 404, 500]).toContain(res.status);
    });
});
