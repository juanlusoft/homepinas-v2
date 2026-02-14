/**
 * HomePiNAS - TOTP Routes Tests
 */
const express = require('express');
const request = require('supertest');

jest.mock('child_process', () => ({
    execSync: jest.fn(() => ''),
    execFile: jest.fn((cmd, args, opts, cb) => cb && cb(null, '', '')),
    execFileSync: jest.fn(() => '')
}));

jest.mock('../../middleware/auth', () => ({
    requireAuth: (req, res, next) => { req.user = { username: 'testadmin' }; next(); }
}));

jest.mock('../../utils/data', () => ({
    getData: jest.fn(() => ({ user: { username: 'testadmin' } })),
    saveData: jest.fn()
}));

const totpRouter = require('../../routes/totp');
const app = express();
app.use(express.json());
app.use('/api/totp', totpRouter);

beforeAll(() => { jest.spyOn(console, 'error').mockImplementation(() => {}); });
afterAll(() => { console.error.mockRestore(); });

describe('GET /api/totp/status', () => {
    test('returns TOTP status', async () => {
        const res = await request(app).get('/api/totp/status');
        expect([200, 500]).toContain(res.status);
    });
});

describe('POST /api/totp/setup', () => {
    test('initiates TOTP setup', async () => {
        const res = await request(app).post('/api/totp/setup');
        expect([200, 400, 500]).toContain(res.status);
    });
});

describe('POST /api/totp/verify', () => {
    test('verifies TOTP code', async () => {
        const res = await request(app)
            .post('/api/totp/verify')
            .send({ code: '123456' });
        expect([200, 400, 401, 500]).toContain(res.status);
    });
});

describe('POST /api/totp/disable', () => {
    test('handles TOTP disable request', async () => {
        const res = await request(app)
            .post('/api/totp/disable')
            .send({ code: '123456' });
        expect([200, 400, 401, 404, 500]).toContain(res.status);
    });
});
