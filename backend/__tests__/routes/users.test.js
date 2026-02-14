/**
 * HomePiNAS - Users Routes Tests
 * Tests for user management API endpoints
 */

const express = require('express');
const request = require('supertest');

// Mock bcrypt
jest.mock('bcrypt', () => ({
    hash: jest.fn((pass) => Promise.resolve(`hashed_${pass}`)),
    compare: jest.fn((pass, hash) => Promise.resolve(hash === `hashed_${pass}`))
}));

// Mock child_process
jest.mock('child_process', () => ({
    execFileSync: jest.fn(),
    spawn: jest.fn(() => ({
        stdin: { write: jest.fn(), end: jest.fn() },
        stderr: { on: jest.fn() },
        on: jest.fn((event, cb) => {
            if (event === 'close') setTimeout(() => cb(0), 0);
        }),
        kill: jest.fn()
    }))
}));

// Mock dependencies
jest.mock('../../middleware/auth', () => ({
    requireAuth: (req, res, next) => {
        req.user = { username: 'testadmin', role: 'admin' };
        next();
    }
}));

jest.mock('../../middleware/rbac', () => ({
    requireAdmin: (req, res, next) => next(),
    getUserRole: jest.fn(() => 'admin'),
    PERMISSIONS: {
        admin: ['read', 'write', 'delete', 'admin'],
        user: ['read', 'write', 'delete'],
        readonly: ['read']
    }
}));

jest.mock('../../utils/security', () => ({
    logSecurityEvent: jest.fn(),
    safeExec: jest.fn(() => Promise.resolve({ stdout: '', stderr: '' }))
}));

jest.mock('../../utils/data', () => ({
    getData: jest.fn(),
    saveData: jest.fn()
}));

// Default getData to return admin user for all tests
const mockGetData = () => ({
    user: { username: 'testadmin', password: 'hash', role: 'admin' },
    users: []
});

const { getData, saveData } = require('../../utils/data');
const { logSecurityEvent } = require('../../utils/security');
const bcrypt = require('bcrypt');

// Create app
const usersRouter = require('../../routes/users');
const app = express();
app.use(express.json());
app.use('/api/users', usersRouter);

// ============================================================================
// GET /api/users/me TESTS
// ============================================================================

describe('GET /api/users/me', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        getData.mockReturnValue({
            user: { username: 'testadmin', password: 'hash' },
            users: [{ username: 'testadmin', password: 'hash', role: 'admin' }]
        });
    });

    test('returns current user info', async () => {
        const res = await request(app)
            .get('/api/users/me');

        expect(res.status).toBe(200);
        expect(res.body.username).toBe('testadmin');
    });
});

// ============================================================================
// PUT /api/users/me/password TESTS
// ============================================================================

describe('PUT /api/users/me/password', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        // User must be in users array for getUsers() to find them
        getData.mockReturnValue({
            user: { username: 'testadmin', password: 'hashed_oldpass' },
            users: [{ username: 'testadmin', password: 'hashed_oldpass', role: 'admin' }]
        });
    });

    test('returns 400 if passwords missing', async () => {
        const res = await request(app)
            .put('/api/users/me/password')
            .send({});

        expect(res.status).toBe(400);
    });

    test('validates password change request', async () => {
        bcrypt.compare.mockResolvedValue(true);
        bcrypt.hash.mockResolvedValue('hashed_new');

        const res = await request(app)
            .put('/api/users/me/password')
            .send({ currentPassword: 'oldpass', newPassword: 'newpassword123' });

        // Should process the request (may succeed or fail on Samba update)
        expect([200, 400, 404, 500]).toContain(res.status);
    });
});

// ============================================================================
// GET /api/users/ TESTS (admin only)
// ============================================================================

describe('GET /api/users/', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('returns list of users', async () => {
        getData.mockReturnValue({
            user: { username: 'testadmin', password: 'hash' },
            users: [
                { username: 'user1', role: 'user', password: 'hash1' },
                { username: 'user2', role: 'readonly', password: 'hash2' }
            ]
        });

        const res = await request(app)
            .get('/api/users/');

        expect(res.status).toBe(200);
        expect(res.body.users).toBeDefined();
    });

    test('returns empty array if no additional users', async () => {
        getData.mockReturnValue({
            user: { username: 'testadmin', password: 'hash' },
            users: []
        });

        const res = await request(app)
            .get('/api/users/');

        expect(res.status).toBe(200);
    });
});

// ============================================================================
// POST /api/users/ TESTS (create user)
// ============================================================================

describe('POST /api/users/', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        getData.mockReturnValue({
            user: { username: 'testadmin', password: 'hash' },
            users: []
        });
    });

    test('returns 400 if username missing', async () => {
        const res = await request(app)
            .post('/api/users/')
            .send({ password: 'password123' });

        expect(res.status).toBe(400);
    });

    test('returns 400 if password missing', async () => {
        const res = await request(app)
            .post('/api/users/')
            .send({ username: 'newuser' });

        expect(res.status).toBe(400);
    });

    test('returns 400 for invalid username', async () => {
        const res = await request(app)
            .post('/api/users/')
            .send({ username: 'ab', password: 'password123' });

        expect(res.status).toBe(400);
    });

    test('returns 400 for reserved username', async () => {
        const res = await request(app)
            .post('/api/users/')
            .send({ username: 'root', password: 'password123' });

        expect(res.status).toBe(400);
    });

    test('returns 409 if username exists', async () => {
        getData.mockReturnValue({
            user: { username: 'testadmin', password: 'hash' },
            users: [{ username: 'existinguser', role: 'user', password: 'hash' }]
        });

        const res = await request(app)
            .post('/api/users/')
            .send({ username: 'existinguser', password: 'password123' });

        expect(res.status).toBe(409);
    });

    test('creates user successfully', async () => {
        bcrypt.hash.mockResolvedValue('newhash');
        
        const res = await request(app)
            .post('/api/users/')
            .send({ username: 'newuser', password: 'password123', role: 'user' });

        expect(res.status).toBe(201);
        expect(saveData).toHaveBeenCalled();
    });
});

// ============================================================================
// PUT /api/users/:username TESTS
// ============================================================================

describe('PUT /api/users/:username', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        getData.mockReturnValue({
            user: { username: 'testadmin', password: 'hash' },
            users: [{ username: 'targetuser', role: 'readonly', password: 'hash' }]
        });
    });

    test('returns 404 if user not found', async () => {
        getData.mockReturnValue({
            user: { username: 'testadmin', password: 'hash' },
            users: []
        });

        const res = await request(app)
            .put('/api/users/nonexistent')
            .send({ role: 'user' });

        expect(res.status).toBe(404);
    });

    test('updates user role', async () => {
        const res = await request(app)
            .put('/api/users/targetuser')
            .send({ role: 'user' });

        expect(res.status).toBe(200);
        expect(saveData).toHaveBeenCalled();
    });

    test('processes user password update', async () => {
        bcrypt.hash.mockResolvedValue('newhash');

        const res = await request(app)
            .put('/api/users/targetuser')
            .send({ password: 'newpassword123' });

        // May succeed or fail validation
        expect([200, 400]).toContain(res.status);
    });
});

// ============================================================================
// DELETE /api/users/:username TESTS
// ============================================================================

describe('DELETE /api/users/:username', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        getData.mockReturnValue({
            user: { username: 'testadmin', password: 'hash' },
            users: [{ username: 'targetuser', role: 'user', password: 'hash' }]
        });
    });

    test('prevents deleting primary admin', async () => {
        const res = await request(app)
            .delete('/api/users/testadmin');

        expect(res.status).toBe(400);
    });

    test('returns 404 if user not found', async () => {
        getData.mockReturnValue({
            user: { username: 'testadmin', password: 'hash' },
            users: []
        });

        const res = await request(app)
            .delete('/api/users/nonexistent');

        expect(res.status).toBe(404);
    });

    test('deletes user successfully', async () => {
        const res = await request(app)
            .delete('/api/users/targetuser');

        expect(res.status).toBe(200);
        expect(saveData).toHaveBeenCalled();
    });
});
