/**
 * HomePiNAS - DDNS Routes Tests
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
    getData: jest.fn(() => ({ ddns: { services: [] } })),
    saveData: jest.fn()
}));

jest.mock('../../utils/security', () => ({
    logSecurityEvent: jest.fn()
}));

const { getData, saveData } = require('../../utils/data');
const ddnsRouter = require('../../routes/ddns');
const app = express();
app.use(express.json());
app.use('/api/ddns', ddnsRouter);

beforeAll(() => { jest.spyOn(console, 'error').mockImplementation(() => {}); });
afterAll(() => { console.error.mockRestore(); });

describe('GET /api/ddns/services', () => {
    test('returns DDNS services list', async () => {
        const res = await request(app).get('/api/ddns/services');
        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('services');
    });
});

describe('POST /api/ddns/services', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        getData.mockReturnValue({ ddns: { services: [] } });
    });

    test('creates new DDNS service', async () => {
        const res = await request(app)
            .post('/api/ddns/services')
            .send({ 
                provider: 'duckdns', 
                domain: 'mynas.duckdns.org', 
                token: 'abc123',
                enabled: true
            });
        expect(res.status).toBe(201);
        expect(saveData).toHaveBeenCalled();
    });

    test('rejects missing provider', async () => {
        const res = await request(app)
            .post('/api/ddns/services')
            .send({ domain: 'test.com', token: 'abc' });
        expect(res.status).toBe(400);
    });
});

describe('GET /api/ddns/status', () => {
    test('returns DDNS status', async () => {
        const res = await request(app).get('/api/ddns/status');
        expect(res.status).toBe(200);
    });
});

describe('GET /api/ddns/public-ip', () => {
    test('returns public IP or handles error', async () => {
        // Mock global fetch
        global.fetch = jest.fn(() => Promise.resolve({
            text: () => Promise.resolve('1.2.3.4')
        }));

        const res = await request(app).get('/api/ddns/public-ip');
        // Should not be 404 (endpoint exists)
        expect(res.status).not.toBe(404);
    });
});
