/**
 * HomePiNAS - Samba Routes Tests
 * Tests for Samba share management endpoints
 */

const express = require('express');
const request = require('supertest');

// Mock fs
jest.mock('fs', () => {
    const actual = jest.requireActual('fs');
    return {
        ...actual,
        existsSync: jest.fn(() => true),
        mkdirSync: jest.fn(),
        readFileSync: jest.fn(() => `[global]
   workgroup = WORKGROUP

[shared]
   path = /mnt/storage/shared
   comment = Public share
   read only = no
   guest ok = yes
   browseable = yes
   valid users = user1, user2
`),
        writeFileSync: jest.fn(),
        unlinkSync: jest.fn()
    };
});

// Mock child_process
jest.mock('child_process', () => ({
    execFile: jest.fn((cmd, args, cb) => {
        if (typeof cb === 'function') {
            if (args && args[0] === 'is-active') {
                cb(null, { stdout: 'active', stderr: '' });
            } else if (args && args[0] === 'smbstatus') {
                cb(null, { stdout: '{}', stderr: '' });
            } else {
                cb(null, { stdout: '', stderr: '' });
            }
        }
        return { stdout: '', stderr: '' };
    }),
    spawn: jest.fn(() => ({
        stdin: { write: jest.fn(), end: jest.fn() },
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        on: jest.fn((event, cb) => {
            if (event === 'close') setTimeout(() => cb(0), 0);
        }),
        kill: jest.fn()
    }))
}));

jest.mock('util', () => ({
    ...jest.requireActual('util'),
    promisify: jest.fn((fn) => (...args) => {
        if (args[0] === 'is-active') {
            return Promise.resolve({ stdout: 'active', stderr: '' });
        }
        if (args[0] === 'smbstatus') {
            return Promise.resolve({ stdout: '{"sessions":{}}', stderr: '' });
        }
        return Promise.resolve({ stdout: '', stderr: '' });
    })
}));

// Mock data utils
jest.mock('../../utils/data', () => ({
    getData: jest.fn(() => ({
        user: { username: 'testuser', role: 'admin' },
        users: []
    })),
    saveData: jest.fn()
}));

// Mock security
jest.mock('../../utils/security', () => ({
    logSecurityEvent: jest.fn(),
    safeExec: jest.fn(() => Promise.resolve({ stdout: '', stderr: '' })),
    sudoExec: jest.fn(() => Promise.resolve({ stdout: '', stderr: '' }))
}));

// Mock auth middleware
jest.mock('../../middleware/auth', () => ({
    requireAuth: (req, res, next) => {
        req.user = { username: 'testuser', role: 'admin' };
        next();
    }
}));

// Mock sanitize
jest.mock('../../utils/sanitize', () => ({
    sanitizePathWithinBase: jest.fn((p, base) => {
        if (p && p.startsWith('/mnt/storage')) return p;
        if (p && !p.includes('..')) return `/mnt/storage/${p}`;
        return null;
    })
}));

const fs = require('fs');
const { getData } = require('../../utils/data');
const { logSecurityEvent, safeExec, sudoExec } = require('../../utils/security');
const { sanitizePathWithinBase } = require('../../utils/sanitize');

// Suppress console during tests
beforeAll(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterAll(() => {
    console.log.mockRestore();
    console.error.mockRestore();
    console.warn.mockRestore();
});

// Create Express app
const sambaRouter = require('../../routes/samba');
const app = express();
app.use(express.json());
app.use('/api/samba', sambaRouter);

// ============================================================================
// GET /shares
// ============================================================================

describe('GET /api/samba/shares', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('lists all shares from smb.conf', async () => {
        fs.readFileSync.mockReturnValue(`[global]
   workgroup = WORKGROUP

[shared]
   path = /mnt/storage/shared
   comment = Public share
   read only = no
   guest ok = yes
   browseable = yes
   valid users = user1, user2

[private]
   path = /mnt/storage/private
   read only = yes
   guest ok = no
`);

        const res = await request(app)
            .get('/api/samba/shares');

        expect(res.status).toBe(200);
        expect(res.body.shares).toHaveLength(2);
        expect(res.body.shares[0].name).toBe('shared');
        expect(res.body.shares[0].path).toBe('/mnt/storage/shared');
        expect(res.body.shares[0].guestOk).toBe(true);
        expect(res.body.shares[1].name).toBe('private');
        expect(res.body.shares[1].readOnly).toBe(true);
    });

    test('returns empty array when no shares', async () => {
        fs.readFileSync.mockReturnValue(`[global]
   workgroup = WORKGROUP
`);

        const res = await request(app)
            .get('/api/samba/shares');

        expect(res.status).toBe(200);
        expect(res.body.shares).toHaveLength(0);
    });

    test('skips system sections', async () => {
        fs.readFileSync.mockReturnValue(`[global]
   workgroup = WORKGROUP

[printers]
   path = /var/spool/samba

[print$]
   path = /var/lib/samba/printers

[homes]
   browseable = no

[myshare]
   path = /mnt/storage/myshare
`);

        const res = await request(app)
            .get('/api/samba/shares');

        expect(res.status).toBe(200);
        expect(res.body.shares).toHaveLength(1);
        expect(res.body.shares[0].name).toBe('myshare');
    });
});

// ============================================================================
// POST /shares
// ============================================================================

describe('POST /api/samba/shares', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        fs.readFileSync.mockReturnValue('[global]\n   workgroup = WORKGROUP\n');
        fs.existsSync.mockReturnValue(true);
    });

    test('creates new share successfully', async () => {
        sanitizePathWithinBase.mockReturnValue('/mnt/storage/newshare');

        const res = await request(app)
            .post('/api/samba/shares')
            .send({
                name: 'newshare',
                path: '/mnt/storage/newshare',
                comment: 'New share',
                readOnly: false,
                guestOk: true,
                validUsers: ['user1']
            });

        expect(res.status).toBe(201);
        expect(res.body.message).toContain('created');
        expect(res.body.share.name).toBe('newshare');
        expect(sudoExec).toHaveBeenCalled();
        expect(logSecurityEvent).toHaveBeenCalledWith(
            'samba_share_created',
            'testuser',
            expect.anything()
        );
    });

    test('rejects invalid share name', async () => {
        const res = await request(app)
            .post('/api/samba/shares')
            .send({
                name: 'invalid name!',
                path: '/mnt/storage/test'
            });

        expect(res.status).toBe(400);
        expect(res.body.error).toContain('Invalid share name');
    });

    test('rejects reserved names', async () => {
        const res = await request(app)
            .post('/api/samba/shares')
            .send({
                name: 'global',
                path: '/mnt/storage/test'
            });

        expect(res.status).toBe(400);
        expect(res.body.error).toContain('Invalid share name');
    });

    test('rejects missing path', async () => {
        const res = await request(app)
            .post('/api/samba/shares')
            .send({ name: 'myshare' });

        expect(res.status).toBe(400);
        expect(res.body.error).toContain('path');
    });

    test('rejects path outside storage', async () => {
        sanitizePathWithinBase.mockReturnValue(null);

        const res = await request(app)
            .post('/api/samba/shares')
            .send({
                name: 'hackshare',
                path: '/etc/passwd'
            });

        expect(res.status).toBe(400);
        expect(res.body.error).toContain('within /mnt/storage');
    });

    test('rejects duplicate share name', async () => {
        fs.readFileSync.mockReturnValue(`[global]

[existing]
   path = /mnt/storage/existing
`);
        sanitizePathWithinBase.mockReturnValue('/mnt/storage/newpath');

        const res = await request(app)
            .post('/api/samba/shares')
            .send({
                name: 'existing',
                path: '/mnt/storage/newpath'
            });

        expect(res.status).toBe(409);
        expect(res.body.error).toContain('already exists');
    });

    test('creates directory if not exists', async () => {
        fs.existsSync.mockReturnValue(false);
        sanitizePathWithinBase.mockReturnValue('/mnt/storage/newdir');

        const res = await request(app)
            .post('/api/samba/shares')
            .send({
                name: 'newdir',
                path: '/mnt/storage/newdir'
            });

        expect(res.status).toBe(201);
        expect(fs.mkdirSync).toHaveBeenCalledWith('/mnt/storage/newdir', { recursive: true });
    });
});

// ============================================================================
// PUT /shares/:name
// ============================================================================

describe('PUT /api/samba/shares/:name', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        fs.readFileSync.mockReturnValue(`[global]

[myshare]
   path = /mnt/storage/myshare
   comment = Old comment
   read only = no
`);
    });

    test('updates share configuration', async () => {
        sanitizePathWithinBase.mockReturnValue('/mnt/storage/newpath');

        const res = await request(app)
            .put('/api/samba/shares/myshare')
            .send({
                path: '/mnt/storage/newpath',
                comment: 'New comment',
                readOnly: true
            });

        expect(res.status).toBe(200);
        expect(res.body.share.path).toBe('/mnt/storage/newpath');
        expect(res.body.share.comment).toBe('New comment');
        expect(res.body.share.readOnly).toBe(true);
        expect(logSecurityEvent).toHaveBeenCalledWith(
            'samba_share_updated',
            'testuser',
            expect.anything()
        );
    });

    test('returns 404 for unknown share', async () => {
        const res = await request(app)
            .put('/api/samba/shares/nonexistent')
            .send({ comment: 'test' });

        expect(res.status).toBe(404);
        expect(res.body.error).toContain('not found');
    });

    test('rejects invalid path', async () => {
        sanitizePathWithinBase.mockReturnValue(null);

        const res = await request(app)
            .put('/api/samba/shares/myshare')
            .send({ path: '/etc/shadow' });

        expect(res.status).toBe(400);
        expect(res.body.error).toContain('within /mnt/storage');
    });
});

// ============================================================================
// DELETE /shares/:name
// ============================================================================

describe('DELETE /api/samba/shares/:name', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        fs.readFileSync.mockReturnValue(`[global]

[todelete]
   path = /mnt/storage/todelete
`);
    });

    test('deletes share successfully', async () => {
        const res = await request(app)
            .delete('/api/samba/shares/todelete');

        expect(res.status).toBe(200);
        expect(res.body.message).toContain('deleted');
        expect(logSecurityEvent).toHaveBeenCalledWith(
            'samba_share_deleted',
            'testuser',
            expect.anything()
        );
    });

    test('returns 404 for unknown share', async () => {
        const res = await request(app)
            .delete('/api/samba/shares/nonexistent');

        expect(res.status).toBe(404);
        expect(res.body.error).toContain('not found');
    });
});

// ============================================================================
// GET /status
// ============================================================================

describe('GET /api/samba/status', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('returns service status', async () => {
        const { execFile } = require('child_process');
        const { promisify } = require('util');

        const res = await request(app)
            .get('/api/samba/status');

        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('service');
        expect(res.body).toHaveProperty('running');
        expect(res.body).toHaveProperty('connectedUsers');
    });
});

// ============================================================================
// POST /restart
// ============================================================================

describe('POST /api/samba/restart', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('restarts samba services', async () => {
        const res = await request(app)
            .post('/api/samba/restart');

        expect(res.status).toBe(200);
        expect(res.body.message).toContain('restarted');
        expect(sudoExec).toHaveBeenCalled();
        expect(logSecurityEvent).toHaveBeenCalledWith(
            'samba_restart',
            'testuser'
        );
    });
});

// ============================================================================
// ADMIN MIDDLEWARE
// ============================================================================

describe('Admin middleware', () => {
    test('rejects non-admin users', async () => {
        // Mock getData to return a non-admin user
        getData.mockReturnValue({
            user: { username: 'other', role: 'admin' },
            users: [{ username: 'testuser', role: 'user' }]
        });

        const res = await request(app)
            .get('/api/samba/shares');

        expect(res.status).toBe(403);
        expect(res.body.error).toContain('Admin');
    });
});
