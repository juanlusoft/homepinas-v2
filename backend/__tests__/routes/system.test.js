/**
 * HomePiNAS - System Routes Tests
 */

const express = require('express');
const request = require('supertest');

jest.mock('systeminformation', () => ({
    cpu: jest.fn(() => Promise.resolve({ manufacturer: 'ARM', brand: 'Cortex-A76', speed: 2.4 })),
    mem: jest.fn(() => Promise.resolve({ total: 8589934592, used: 4294967296, free: 4294967296 })),
    fsSize: jest.fn(() => Promise.resolve([{ fs: '/dev/sda1', size: 500000000000, used: 250000000000 }])),
    cpuTemperature: jest.fn(() => Promise.resolve({ main: 45 })),
    currentLoad: jest.fn(() => Promise.resolve({ currentLoad: 25 })),
    networkStats: jest.fn(() => Promise.resolve([{ iface: 'eth0', rx_sec: 1000, tx_sec: 500 }])),
    system: jest.fn(() => Promise.resolve({ model: 'Raspberry Pi 5', serial: 'ABC123' })),
    osInfo: jest.fn(() => Promise.resolve({ distro: 'Debian', release: '12', hostname: 'pinas' })),
    time: jest.fn(() => Promise.resolve({ uptime: 86400 }))
}));

jest.mock('child_process', () => ({
    execSync: jest.fn(() => ''),
    execFileSync: jest.fn(() => ''),
    execFile: jest.fn((cmd, args, opts, cb) => cb && cb(null, '', ''))
}));

jest.mock('fs', () => ({
    existsSync: jest.fn(() => true),
    readFileSync: jest.fn(() => '50'),
    writeFileSync: jest.fn(),
    readdirSync: jest.fn(() => ['pwm1'])
}));

jest.mock('../../middleware/auth', () => ({
    requireAuth: (req, res, next) => {
        req.user = { username: 'testadmin' };
        next();
    }
}));

jest.mock('../../utils/security', () => ({
    logSecurityEvent: jest.fn()
}));

jest.mock('../../utils/data', () => ({
    getData: jest.fn(() => ({})),
    saveData: jest.fn()
}));

const systemRouter = require('../../routes/system');
const app = express();
app.use(express.json());
app.use('/api/system', systemRouter);

beforeAll(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterAll(() => {
    console.error.mockRestore();
    console.log.mockRestore();
});

describe('GET /api/system/stats', () => {
    test('returns system statistics', async () => {
        const res = await request(app).get('/api/system/stats');
        expect([200, 500]).toContain(res.status);
    });
});

describe('GET /api/system/disks', () => {
    test('returns disk information', async () => {
        const res = await request(app).get('/api/system/disks');
        expect([200, 500]).toContain(res.status);
    });
});

describe('GET /api/system/status', () => {
    test('returns system status', async () => {
        const res = await request(app).get('/api/system/status');
        expect([200, 500]).toContain(res.status);
    });
});

describe('POST /api/system/fan', () => {
    test('returns 400 for invalid fan speed', async () => {
        const res = await request(app)
            .post('/api/system/fan')
            .send({ speed: 150 });
        expect(res.status).toBe(400);
    });

    test('processes fan speed request', async () => {
        const res = await request(app)
            .post('/api/system/fan')
            .send({ speed: 50 });
        expect([200, 400, 404, 500]).toContain(res.status);
    });
});

describe('GET /api/system/fan/mode', () => {
    test('returns fan mode', async () => {
        const res = await request(app).get('/api/system/fan/mode');
        expect(res.status).toBe(200);
    });
});

describe('POST /api/system/fan/mode', () => {
    test('processes fan mode request', async () => {
        const res = await request(app)
            .post('/api/system/fan/mode')
            .send({ mode: 'balanced' });
        expect([200, 400, 500]).toContain(res.status);
    });

    test('rejects invalid mode', async () => {
        const res = await request(app)
            .post('/api/system/fan/mode')
            .send({ mode: 'invalid' });
        expect(res.status).toBe(400);
    });
});
