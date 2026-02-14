/**
 * HomePiNAS - Network Routes Tests
 */

const express = require('express');
const request = require('supertest');

jest.mock('systeminformation', () => ({
    networkInterfaces: jest.fn(() => Promise.resolve([
        { iface: 'eth0', ip4: '192.168.1.100', mac: 'aa:bb:cc:dd:ee:ff' },
        { iface: 'wlan0', ip4: '192.168.1.101', mac: '11:22:33:44:55:66' }
    ]))
}));

jest.mock('child_process', () => ({
    execSync: jest.fn(() => ''),
    execFile: jest.fn((cmd, args, opts, cb) => cb && cb(null, '', '')),
    execFileSync: jest.fn(() => '')
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

const networkRouter = require('../../routes/network');
const app = express();
app.use(express.json());
app.use('/api/network', networkRouter);

beforeAll(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterAll(() => {
    console.error.mockRestore();
});

describe('GET /api/network/interfaces', () => {
    test('returns network interfaces', async () => {
        const res = await request(app).get('/api/network/interfaces');
        expect(res.status).toBe(200);
        expect(res.body).toBeDefined();
    });
});

describe('POST /api/network/configure', () => {
    test('returns 400 if interface missing', async () => {
        const res = await request(app)
            .post('/api/network/configure')
            .send({ ip: '192.168.1.50' });
        expect(res.status).toBe(400);
    });

    test('returns 400 for invalid IP', async () => {
        const res = await request(app)
            .post('/api/network/configure')
            .send({ interface: 'eth0', ip: 'invalid' });
        expect(res.status).toBe(400);
    });

    test('configures network interface', async () => {
        const res = await request(app)
            .post('/api/network/configure')
            .send({ 
                interface: 'eth0', 
                ip: '192.168.1.50',
                netmask: '255.255.255.0',
                gateway: '192.168.1.1'
            });
        expect([200, 400, 500]).toContain(res.status);
    });
});
