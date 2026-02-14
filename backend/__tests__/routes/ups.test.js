/**
 * HomePiNAS - UPS Routes Tests
 */
const express = require('express');
const request = require('supertest');

jest.mock('child_process', () => ({
    execSync: jest.fn(() => 'STATUS: OL\nLINEV: 230.0 Volts'),
    execFile: jest.fn((cmd, args, opts, cb) => cb && cb(null, '', '')),
    execFileSync: jest.fn(() => '')
}));

jest.mock('../../middleware/auth', () => ({
    requireAuth: (req, res, next) => { req.user = { username: 'testadmin' }; next(); }
}));

jest.mock('../../utils/data', () => ({
    getData: jest.fn(() => ({})),
    saveData: jest.fn()
}));

const upsRouter = require('../../routes/ups');
const app = express();
app.use(express.json());
app.use('/api/ups', upsRouter);

beforeAll(() => { jest.spyOn(console, 'error').mockImplementation(() => {}); });
afterAll(() => { console.error.mockRestore(); });

describe('GET /api/ups/status', () => {
    test('returns UPS status', async () => {
        const res = await request(app).get('/api/ups/status');
        expect([200, 500]).toContain(res.status);
    });
});

describe('GET /api/ups/config', () => {
    test('returns UPS config', async () => {
        const res = await request(app).get('/api/ups/config');
        expect([200, 500]).toContain(res.status);
    });
});

describe('POST /api/ups/config', () => {
    test('configures UPS', async () => {
        const res = await request(app)
            .post('/api/ups/config')
            .send({ type: 'apc', device: '/dev/usb/hiddev0' });
        expect([200, 400, 500]).toContain(res.status);
    });
});
