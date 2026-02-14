/**
 * HomePiNAS - Auth Routes Tests
 * Tests for authentication API endpoints
 */

const express = require('express');
const request = require('supertest');

// Mock all dependencies before requiring the router
jest.mock('../../utils/data', () => ({
    getData: jest.fn(),
    saveData: jest.fn()
}));

jest.mock('../../utils/session', () => ({
    createSession: jest.fn(),
    destroySession: jest.fn(),
    validateSession: jest.fn()
}));

jest.mock('../../utils/security', () => ({
    logSecurityEvent: jest.fn()
}));

jest.mock('../../middleware/csrf', () => ({
    getCsrfToken: jest.fn(() => 'mock-csrf-token'),
    clearCsrfToken: jest.fn()
}));

jest.mock('../../middleware/rateLimit', () => ({
    authLimiter: (req, res, next) => next()
}));

// Mock child_process to prevent actual system calls
jest.mock('child_process', () => ({
    spawn: jest.fn(() => ({
        stdin: { write: jest.fn(), end: jest.fn() },
        stderr: { on: jest.fn() },
        on: jest.fn((event, cb) => {
            if (event === 'close') setTimeout(() => cb(0), 0);
        }),
        kill: jest.fn()
    })),
    execFileSync: jest.fn()
}));

const { getData, saveData } = require('../../utils/data');
const { createSession, destroySession, validateSession } = require('../../utils/session');
const { logSecurityEvent } = require('../../utils/security');
const { getCsrfToken, clearCsrfToken } = require('../../middleware/csrf');

// Suppress console.log/error during tests
beforeAll(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterAll(() => {
    console.log.mockRestore();
    console.error.mockRestore();
});

// Create Express app with auth router
const authRouter = require('../../routes/auth');
const app = express();
app.use(express.json());
app.use('/api/auth', authRouter);

// ============================================================================
// POST /api/auth/setup TESTS
// ============================================================================

describe('POST /api/auth/setup', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('creates admin account successfully', async () => {
        getData.mockReturnValue({});
        createSession.mockReturnValue('new-session-id');

        const res = await request(app)
            .post('/api/auth/setup')
            .send({ username: 'myadmin', password: 'password123' });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.sessionId).toBe('new-session-id');
        expect(res.body.csrfToken).toBe('mock-csrf-token');
        expect(saveData).toHaveBeenCalled();
        expect(logSecurityEvent).toHaveBeenCalledWith(
            'ADMIN_CREATED',
            expect.objectContaining({ username: 'myadmin' }),
            expect.any(String)
        );
    });

    test('rejects invalid username - too short', async () => {
        getData.mockReturnValue({});

        const res = await request(app)
            .post('/api/auth/setup')
            .send({ username: 'ab', password: 'password123' });

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
        expect(res.body.message).toContain('Invalid username');
    });

    test('rejects invalid username - reserved', async () => {
        getData.mockReturnValue({});

        const res = await request(app)
            .post('/api/auth/setup')
            .send({ username: 'root', password: 'password123' });

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
    });

    test('rejects invalid password - too short', async () => {
        getData.mockReturnValue({});

        const res = await request(app)
            .post('/api/auth/setup')
            .send({ username: 'validuser', password: '123' });

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
        expect(res.body.message).toContain('Invalid password');
    });

    test('rejects if admin already exists', async () => {
        getData.mockReturnValue({
            user: { username: 'existingadmin', password: 'hash' }
        });

        const res = await request(app)
            .post('/api/auth/setup')
            .send({ username: 'newadmin', password: 'password123' });

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
        expect(res.body.message).toContain('already exists');
        expect(logSecurityEvent).toHaveBeenCalledWith(
            'SETUP_ATTEMPT_EXISTS',
            expect.any(Object),
            expect.any(String)
        );
    });
});

// ============================================================================
// POST /api/auth/login TESTS
// ============================================================================

describe('POST /api/auth/login', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('returns 400 if username missing', async () => {
        const res = await request(app)
            .post('/api/auth/login')
            .send({ password: 'password123' });

        expect(res.status).toBe(400);
        expect(res.body.message).toContain('Username and password required');
    });

    test('returns 400 if password missing', async () => {
        const res = await request(app)
            .post('/api/auth/login')
            .send({ username: 'admin' });

        expect(res.status).toBe(400);
        expect(res.body.message).toContain('Username and password required');
    });

    test('returns 401 if no user exists', async () => {
        getData.mockReturnValue({});

        const res = await request(app)
            .post('/api/auth/login')
            .send({ username: 'admin', password: 'password123' });

        expect(res.status).toBe(401);
        expect(res.body.message).toContain('Invalid credentials');
        expect(logSecurityEvent).toHaveBeenCalledWith(
            'LOGIN_NO_USER',
            expect.any(Object),
            expect.any(String)
        );
    });

    test('returns 401 for wrong password', async () => {
        // Use a real bcrypt hash for 'correctpassword'
        const bcrypt = require('bcrypt');
        const hashedPassword = await bcrypt.hash('correctpassword', 10);
        
        getData.mockReturnValue({
            user: { username: 'admin', password: hashedPassword }
        });

        const res = await request(app)
            .post('/api/auth/login')
            .send({ username: 'admin', password: 'wrongpassword' });

        expect(res.status).toBe(401);
        expect(res.body.message).toContain('Invalid credentials');
        expect(logSecurityEvent).toHaveBeenCalledWith(
            'LOGIN_FAILED',
            expect.any(Object),
            expect.any(String)
        );
    });

    test('succeeds with correct credentials', async () => {
        const bcrypt = require('bcrypt');
        const hashedPassword = await bcrypt.hash('correctpassword', 10);
        
        getData.mockReturnValue({
            user: { username: 'admin', password: hashedPassword }
        });
        createSession.mockReturnValue('session-123');

        const res = await request(app)
            .post('/api/auth/login')
            .send({ username: 'admin', password: 'correctpassword' });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.sessionId).toBe('session-123');
        expect(res.body.csrfToken).toBe('mock-csrf-token');
        expect(res.body.user.username).toBe('admin');
        expect(logSecurityEvent).toHaveBeenCalledWith(
            'LOGIN_SUCCESS',
            expect.objectContaining({ username: 'admin' }),
            expect.any(String)
        );
    });

    test('returns requires2FA when 2FA is enabled', async () => {
        const bcrypt = require('bcrypt');
        const hashedPassword = await bcrypt.hash('password123', 10);
        
        getData.mockReturnValue({
            user: { 
                username: 'admin', 
                password: hashedPassword,
                totpEnabled: true,
                totpSecret: 'JBSWY3DPEHPK3PXP' // Example base32 secret
            }
        });

        const res = await request(app)
            .post('/api/auth/login')
            .send({ username: 'admin', password: 'password123' });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.requires2FA).toBe(true);
        expect(res.body.pendingToken).toBeDefined();
        expect(res.body.sessionId).toBeUndefined();
        expect(logSecurityEvent).toHaveBeenCalledWith(
            'LOGIN_PENDING_2FA',
            expect.any(Object),
            expect.any(String)
        );
    });
});

// ============================================================================
// POST /api/auth/login/2fa TESTS
// ============================================================================

describe('POST /api/auth/login/2fa', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('returns 400 if pendingToken missing', async () => {
        const res = await request(app)
            .post('/api/auth/login/2fa')
            .send({ totpCode: '123456' });

        expect(res.status).toBe(400);
        expect(res.body.message).toContain('Pending token and TOTP code required');
    });

    test('returns 400 if totpCode missing', async () => {
        const res = await request(app)
            .post('/api/auth/login/2fa')
            .send({ pendingToken: 'token123' });

        expect(res.status).toBe(400);
    });

    test('returns 400 for invalid TOTP format', async () => {
        const res = await request(app)
            .post('/api/auth/login/2fa')
            .send({ pendingToken: 'token123', totpCode: 'abc' });

        expect(res.status).toBe(400);
        expect(res.body.message).toContain('6 digits');
    });

    test('returns 401 for invalid pending token', async () => {
        const res = await request(app)
            .post('/api/auth/login/2fa')
            .send({ pendingToken: 'invalid-token', totpCode: '123456' });

        expect(res.status).toBe(401);
        expect(res.body.message).toContain('Invalid or expired');
    });
});

// ============================================================================
// POST /api/auth/verify-session TESTS
// ============================================================================

describe('POST /api/auth/verify-session', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('returns 401 if no session header', async () => {
        const res = await request(app)
            .post('/api/auth/verify-session');

        expect(res.status).toBe(401);
        expect(res.body.message).toContain('No session');
    });

    test('returns 401 for invalid session', async () => {
        validateSession.mockReturnValue(null);

        const res = await request(app)
            .post('/api/auth/verify-session')
            .set('x-session-id', 'invalid-session');

        expect(res.status).toBe(401);
        expect(res.body.message).toContain('Invalid session');
    });

    test('returns new CSRF token for valid session', async () => {
        validateSession.mockReturnValue({ username: 'admin' });

        const res = await request(app)
            .post('/api/auth/verify-session')
            .set('x-session-id', 'valid-session-id');

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.csrfToken).toBe('mock-csrf-token');
    });
});

// ============================================================================
// POST /api/auth/logout TESTS
// ============================================================================

describe('POST /api/auth/logout', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('succeeds even without session', async () => {
        const res = await request(app)
            .post('/api/auth/logout');

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });

    test('destroys session and clears CSRF token', async () => {
        const res = await request(app)
            .post('/api/auth/logout')
            .set('x-session-id', 'session-to-destroy');

        expect(res.status).toBe(200);
        expect(destroySession).toHaveBeenCalledWith('session-to-destroy');
        expect(clearCsrfToken).toHaveBeenCalledWith('session-to-destroy');
        expect(logSecurityEvent).toHaveBeenCalledWith(
            'LOGOUT',
            expect.any(Object),
            expect.any(String)
        );
    });
});
