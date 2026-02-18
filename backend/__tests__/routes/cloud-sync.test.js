/**
 * HomePiNAS - Cloud Sync Routes Tests
 * Tests for Syncthing-based cloud sync endpoints
 * 
 * Note: These tests verify endpoint availability and basic validation.
 * Full integration tests require a running Syncthing instance.
 */

const express = require('express');
const request = require('supertest');

// Mock child_process
jest.mock('child_process', () => ({
    exec: jest.fn((cmd, optsOrCb, cb) => {
        const callback = typeof optsOrCb === 'function' ? optsOrCb : cb;
        if (cmd.includes('which syncthing')) {
            callback(null, '/usr/bin/syncthing', '');
        } else if (cmd.includes('is-active')) {
            callback(null, 'active', '');
        } else {
            callback(null, '', '');
        }
    }),
    execFile: jest.fn((cmd, args, optsOrCb, cb) => {
        const callback = typeof optsOrCb === 'function' ? optsOrCb : cb;
        if (cmd === 'which' && args.includes('syncthing')) {
            callback(null, '/usr/bin/syncthing', '');
        } else if (cmd === 'systemctl' && args.includes('is-active')) {
            callback(null, 'inactive', '');
        } else if (cmd === 'sudo') {
            callback(null, '', '');
        } else {
            callback(null, '', '');
        }
    }),
    spawn: jest.fn(() => ({
        stdout: { on: jest.fn(), pipe: jest.fn() },
        stdin: { end: jest.fn() },
        stderr: { on: jest.fn() },
        on: jest.fn((event, cb) => event === 'close' && cb(0)),
        kill: jest.fn()
    }))
}));

// Mock auth middleware
jest.mock('../../middleware/auth', () => ({
    requireAuth: (req, res, next) => { req.user = { username: 'testuser' }; next(); }
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
const cloudSyncRouter = require('../../routes/cloud-sync');
const app = express();
app.use(express.json());
app.use('/api/cloud-sync', cloudSyncRouter);

// ============================================================================
// GET /status
// ============================================================================

describe('GET /api/cloud-sync/status', () => {
    test('returns syncthing status', async () => {
        const res = await request(app).get('/api/cloud-sync/status');
        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('installed');
        expect(res.body).toHaveProperty('running');
    });
});

// ============================================================================
// POST /install
// ============================================================================

describe('POST /api/cloud-sync/install', () => {
    test('handles install request', async () => {
        const res = await request(app).post('/api/cloud-sync/install');
        // Should return 200 (already installed) or handle gracefully
        expect(res.status).toBe(200);
    });
});

// ============================================================================
// POST /start
// ============================================================================

describe('POST /api/cloud-sync/start', () => {
    test('starts syncthing service', async () => {
        const res = await request(app).post('/api/cloud-sync/start');
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });
});

// ============================================================================
// POST /stop
// ============================================================================

describe('POST /api/cloud-sync/stop', () => {
    test('stops syncthing service', async () => {
        const res = await request(app).post('/api/cloud-sync/stop');
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });
});

// ============================================================================
// POST /folders - Validation tests
// ============================================================================

describe('POST /api/cloud-sync/folders', () => {
    test('rejects missing path', async () => {
        const res = await request(app)
            .post('/api/cloud-sync/folders')
            .send({ label: 'Test' });
        expect(res.status).toBe(400);
        expect(res.body.error).toContain('Path');
    });

    test('rejects path outside storage', async () => {
        const res = await request(app)
            .post('/api/cloud-sync/folders')
            .send({ path: '/etc/passwd' });
        expect(res.status).toBe(400);
        expect(res.body.error).toContain('storage');
    });
});
