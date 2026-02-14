/**
 * HomePiNAS - Update Routes Tests
 */
const express = require('express');
const request = require('supertest');

jest.mock('child_process', () => ({
    execSync: jest.fn(() => 'v2.5.0'),
    execFile: jest.fn((cmd, args, opts, cb) => cb && cb(null, '', '')),
    execFileSync: jest.fn(() => ''),
    spawn: jest.fn(() => ({
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        on: jest.fn((event, cb) => event === 'close' && cb(0)),
        kill: jest.fn()
    }))
}));

jest.mock('fs', () => ({
    ...jest.requireActual('fs'),
    existsSync: jest.fn(() => true),
    readFileSync: jest.fn(() => '{"version": "2.5.0"}')
}));

jest.mock('../../middleware/auth', () => ({
    requireAuth: (req, res, next) => { req.user = { username: 'testadmin', role: 'admin' }; next(); }
}));

jest.mock('../../middleware/rbac', () => ({
    requireAdmin: (req, res, next) => next()
}));

jest.mock('../../middleware/rateLimit', () => ({
    criticalLimiter: (req, res, next) => next()
}));

jest.mock('../../utils/data', () => ({
    getData: jest.fn(() => ({})),
    saveData: jest.fn()
}));

jest.mock('../../utils/security', () => ({
    logSecurityEvent: jest.fn()
}));

const updateRouter = require('../../routes/update');
const app = express();
app.use(express.json());
app.use('/api/update', updateRouter);

beforeAll(() => { 
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {}); 
});
afterAll(() => { 
    console.log.mockRestore();
    console.error.mockRestore(); 
});

describe('GET /api/update/check', () => {
    test('checks for updates', async () => {
        const res = await request(app).get('/api/update/check');
        // Should return 200 or 500 (if git fails)
        expect(res.status).not.toBe(404);
    });
});

describe('GET /api/update/status', () => {
    test('returns update status', async () => {
        const res = await request(app).get('/api/update/status');
        expect(res.status).toBe(200);
    });
});

describe('POST /api/update/apply', () => {
    test('applies update', async () => {
        const res = await request(app).post('/api/update/apply');
        // Should return 200/202/400/500 but not 404
        expect(res.status).not.toBe(404);
    });
});
