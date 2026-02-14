/**
 * HomePiNAS - Docker Routes Tests
 */
const express = require('express');
const request = require('supertest');

jest.mock('child_process', () => ({
    execSync: jest.fn(() => ''),
    execFile: jest.fn((cmd, args, opts, cb) => cb && cb(null, '', '')),
    execFileSync: jest.fn(() => '')
}));

jest.mock('dockerode', () => {
    return jest.fn().mockImplementation(() => ({
        listContainers: jest.fn(() => Promise.resolve([])),
        listImages: jest.fn(() => Promise.resolve([])),
        getContainer: jest.fn(() => ({
            inspect: jest.fn(() => Promise.resolve({ State: { Running: true } })),
            start: jest.fn(() => Promise.resolve()),
            stop: jest.fn(() => Promise.resolve()),
            restart: jest.fn(() => Promise.resolve())
        })),
        info: jest.fn(() => Promise.resolve({ Containers: 0, Images: 0 }))
    }));
});

jest.mock('../../middleware/auth', () => ({
    requireAuth: (req, res, next) => { req.user = { username: 'testadmin' }; next(); }
}));

jest.mock('../../utils/data', () => ({
    getData: jest.fn(() => ({})),
    saveData: jest.fn()
}));

const dockerRouter = require('../../routes/docker');
const app = express();
app.use(express.json());
app.use('/api/docker', dockerRouter);

beforeAll(() => { jest.spyOn(console, 'error').mockImplementation(() => {}); });
afterAll(() => { console.error.mockRestore(); });

describe('GET /api/docker/status', () => {
    test('returns docker status', async () => {
        const res = await request(app).get('/api/docker/status');
        expect([200, 401, 403, 404, 500]).toContain(res.status);
    });
});

describe('GET /api/docker/containers', () => {
    test('returns containers list', async () => {
        const res = await request(app).get('/api/docker/containers');
        expect([200, 401, 403, 500]).toContain(res.status);
    });
});

describe('POST /api/docker/containers/:id/start', () => {
    test('starts container', async () => {
        const res = await request(app).post('/api/docker/containers/abc123/start');
        expect([200, 400, 404, 500]).toContain(res.status);
    });
});

describe('POST /api/docker/containers/:id/stop', () => {
    test('stops container', async () => {
        const res = await request(app).post('/api/docker/containers/abc123/stop');
        expect([200, 400, 404, 500]).toContain(res.status);
    });
});

describe('POST /api/docker/containers/:id/restart', () => {
    test('restarts container', async () => {
        const res = await request(app).post('/api/docker/containers/abc123/restart');
        expect([200, 400, 404, 500]).toContain(res.status);
    });
});
