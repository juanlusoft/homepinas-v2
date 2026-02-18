/**
 * HomePiNAS - Active Directory Routes Tests
 * Tests for Samba AD DC endpoints
 */

const express = require('express');
const request = require('supertest');

// Mock fs.promises
jest.mock('fs', () => ({
    ...jest.requireActual('fs'),
    promises: {
        access: jest.fn(() => Promise.resolve()),
        readFile: jest.fn(() => Promise.resolve(JSON.stringify({ domain: 'HOMELABS', realm: 'HOMELABS.LOCAL' }))),
        writeFile: jest.fn(() => Promise.resolve()),
        mkdir: jest.fn(() => Promise.resolve()),
        unlink: jest.fn(() => Promise.resolve())
    }
}));

// Mock child_process
jest.mock('child_process', () => ({
    exec: jest.fn((cmd, opts, cb) => {
        const callback = typeof opts === 'function' ? opts : cb;
        
        if (cmd.includes('which samba-tool')) {
            callback(null, { stdout: '/usr/bin/samba-tool', stderr: '' });
        } else if (cmd.includes('is-active samba-ad-dc')) {
            callback(null, { stdout: 'active', stderr: '' });
        } else if (cmd.includes('samba-tool user list')) {
            callback(null, { stdout: 'Administrator\ntestuser\n', stderr: '' });
        } else if (cmd.includes('samba-tool group list')) {
            callback(null, { stdout: 'Domain Admins\nDomain Users\n', stderr: '' });
        } else if (cmd.includes('samba-tool computer list')) {
            callback(null, { stdout: 'PC-001$\n', stderr: '' });
        } else {
            callback(null, { stdout: '', stderr: '' });
        }
    }),
    execFile: jest.fn((file, args, opts, cb) => {
        const callback = typeof opts === 'function' ? opts : cb;
        const cmd = file + ' ' + (args || []).join(' ');
        
        if (file === 'which' && args.includes('samba-tool')) {
            callback(null, '/usr/bin/samba-tool', '');
        } else if (file === 'systemctl' && args.includes('is-active')) {
            callback(null, 'active', '');
        } else if (file === 'sudo' && args.includes('samba-tool')) {
            if (args.includes('user') && args.includes('list')) {
                callback(null, 'Administrator\ntestuser\n', '');
            } else if (args.includes('group') && args.includes('list')) {
                callback(null, 'Domain Admins\nDomain Users\n', '');
            } else if (args.includes('computer') && args.includes('list')) {
                callback(null, 'PC-001$\n', '');
            } else if (args.includes('user') && args.includes('show')) {
                callback(null, 'cn: Test User\nmail: test@test.com\n', '');
            } else {
                callback(null, '', '');
            }
        } else if (file === 'samba-tool') {
            if (args.includes('user') && args.includes('list')) {
                callback(null, 'Administrator\ntestuser\n', '');
            } else if (args.includes('group') && args.includes('list')) {
                callback(null, 'Domain Admins\nDomain Users\n', '');
            } else if (args.includes('computer') && args.includes('list')) {
                callback(null, 'PC-001$\n', '');
            } else if (args.includes('user') && args.includes('show')) {
                callback(null, 'cn: Test User\nmail: test@test.com\n', '');
            } else {
                callback(null, '', '');
            }
        } else {
            callback(null, '', '');
        }
    }),
    spawn: jest.fn(() => ({
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        on: jest.fn((event, cb) => event === 'close' && cb(0)),
        kill: jest.fn()
    }))
}));

// Mock util.promisify to work with our execFile mock
jest.mock('util', () => ({
    ...jest.requireActual('util'),
    promisify: jest.fn((fn) => (...args) => {
        return new Promise((resolve, reject) => {
            fn(...args, (err, stdout, stderr) => {
                if (err) reject(err);
                else resolve({ stdout, stderr });
            });
        });
    })
}));

// Mock auth middleware
jest.mock('../../middleware/auth', () => ({
    requireAuth: (req, res, next) => { req.user = { username: 'admin', role: 'admin' }; next(); }
}));

// Mock security
jest.mock('../../utils/security', () => ({
    logSecurityEvent: jest.fn(),
    sudoExec: jest.fn(() => Promise.resolve({ stdout: '', stderr: '' }))
}));

// Mock rbac middleware
jest.mock('../../middleware/rbac', () => ({
    requireAdmin: (req, res, next) => next(),
    requirePermission: () => (req, res, next) => next(),
    hasPermission: jest.fn(() => true),
    getUserRole: jest.fn(() => 'admin'),
    getUserPermissions: jest.fn(() => ['read', 'write', 'delete', 'admin'])
}));

// Suppress console during tests
beforeAll(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterAll(() => {
    console.log.mockRestore();
    console.error.mockRestore();
});

// Create Express app
const adRouter = require('../../routes/active-directory');
const app = express();
app.use(express.json());
app.use('/api/ad', adRouter);

// ============================================================================
// GET /status
// ============================================================================

describe('GET /api/ad/status', () => {
    test('returns AD DC status', async () => {
        const res = await request(app).get('/api/ad/status');
        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('installed');
        expect(res.body).toHaveProperty('provisioned');
        expect(res.body).toHaveProperty('running');
    });
});

// ============================================================================
// POST /install
// ============================================================================

describe('POST /api/ad/install', () => {
    test('handles install request', async () => {
        const res = await request(app).post('/api/ad/install');
        // Should return 200 (already installed) or start installation
        expect(res.status).not.toBe(404);
    });
});

// ============================================================================
// POST /provision
// ============================================================================

describe('POST /api/ad/provision', () => {
    test('rejects missing domain', async () => {
        const res = await request(app)
            .post('/api/ad/provision')
            .send({ adminPassword: 'Test123!' });
        expect(res.status).toBe(400);
    });

    test('rejects missing password', async () => {
        const res = await request(app)
            .post('/api/ad/provision')
            .send({ domain: 'HOMELABS.LOCAL' });
        expect(res.status).toBe(400);
    });

    test('rejects weak password', async () => {
        const res = await request(app)
            .post('/api/ad/provision')
            .send({ domain: 'HOMELABS', realm: 'HOMELABS.LOCAL', adminPassword: '123' });
        expect(res.status).toBe(400);
        expect(res.body.error).toContain('Password');
    });
});

// ============================================================================
// GET /users
// ============================================================================

describe('GET /api/ad/users', () => {
    test('returns user list', async () => {
        const res = await request(app).get('/api/ad/users');
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
    });
});

// ============================================================================
// POST /users
// ============================================================================

describe('POST /api/ad/users', () => {
    test('rejects missing username', async () => {
        const res = await request(app)
            .post('/api/ad/users')
            .send({ password: 'Test123!' });
        expect(res.status).toBe(400);
    });

    test('rejects missing password', async () => {
        const res = await request(app)
            .post('/api/ad/users')
            .send({ username: 'newuser' });
        expect(res.status).toBe(400);
    });
});

// ============================================================================
// DELETE /users/:username
// ============================================================================

describe('DELETE /api/ad/users/:username', () => {
    test('rejects deleting Administrator', async () => {
        const res = await request(app).delete('/api/ad/users/Administrator');
        expect(res.status).toBe(400);
        expect(res.body.error).toContain('Administrator');
    });
});

// ============================================================================
// POST /users/:username/password
// ============================================================================

describe('POST /api/ad/users/:username/password', () => {
    test('rejects missing password', async () => {
        const res = await request(app)
            .post('/api/ad/users/testuser/password')
            .send({});
        expect(res.status).toBe(400);
    });
});

// ============================================================================
// GET /computers
// ============================================================================

describe('GET /api/ad/computers', () => {
    test('returns computer list', async () => {
        const res = await request(app).get('/api/ad/computers');
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
    });
});

// ============================================================================
// GET /groups
// ============================================================================

describe('GET /api/ad/groups', () => {
    test('returns group list', async () => {
        const res = await request(app).get('/api/ad/groups');
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
    });
});

// ============================================================================
// POST /groups
// ============================================================================

describe('POST /api/ad/groups', () => {
    test('rejects missing group name', async () => {
        const res = await request(app)
            .post('/api/ad/groups')
            .send({});
        expect(res.status).toBe(400);
    });
});

// ============================================================================
// POST /service/:action
// ============================================================================

describe('POST /api/ad/service/:action', () => {
    test('handles start action', async () => {
        const res = await request(app).post('/api/ad/service/start');
        expect(res.status).not.toBe(404);
    });

    test('handles stop action', async () => {
        const res = await request(app).post('/api/ad/service/stop');
        expect(res.status).not.toBe(404);
    });

    test('handles restart action', async () => {
        const res = await request(app).post('/api/ad/service/restart');
        expect(res.status).not.toBe(404);
    });

    test('rejects invalid action', async () => {
        const res = await request(app).post('/api/ad/service/invalid');
        expect(res.status).toBe(400);
    });
});
