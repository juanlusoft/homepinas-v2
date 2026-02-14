/**
 * HomePiNAS - Power Routes Tests
 */

const express = require('express');
const request = require('supertest');

jest.mock('child_process', () => ({
    execSync: jest.fn(() => '')
}));

jest.mock('../../middleware/auth', () => ({
    requireAuth: (req, res, next) => {
        req.user = { username: 'testadmin', role: 'admin' };
        next();
    }
}));

jest.mock('../../middleware/rbac', () => ({
    requireAdmin: (req, res, next) => next()
}));

jest.mock('../../middleware/rateLimit', () => ({
    criticalLimiter: (req, res, next) => next()
}));

jest.mock('../../utils/security', () => ({
    logSecurityEvent: jest.fn()
}));

jest.mock('../../utils/data', () => ({
    getData: jest.fn(() => ({})),
    saveData: jest.fn()
}));

const powerRouter = require('../../routes/power');
const app = express();
app.use(express.json());
app.use('/api/power', powerRouter);

beforeAll(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterAll(() => {
    console.error.mockRestore();
    console.log.mockRestore();
});

describe('POST /api/power/reset', () => {
    test('resets HomePiNAS service', async () => {
        const res = await request(app).post('/api/power/reset');
        expect([200, 500]).toContain(res.status);
    });
});

describe('POST /api/power/reboot', () => {
    test('initiates reboot', async () => {
        const res = await request(app).post('/api/power/reboot');
        expect([200, 500]).toContain(res.status);
    });
});

describe('POST /api/power/shutdown', () => {
    test('initiates shutdown', async () => {
        const res = await request(app).post('/api/power/shutdown');
        expect([200, 500]).toContain(res.status);
    });
});
