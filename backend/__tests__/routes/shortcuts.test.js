/**
 * HomePiNAS - Shortcuts Routes Tests
 * Tests for configurable program shortcuts
 */

const express = require('express');
const request = require('supertest');

// Mock fs
jest.mock('fs', () => ({
    ...jest.requireActual('fs'),
    existsSync: jest.fn(() => true),
    readFileSync: jest.fn(() => JSON.stringify({ shortcuts: [] })),
    writeFileSync: jest.fn(),
    mkdirSync: jest.fn()
}));

// Mock auth middleware
jest.mock('../../middleware/auth', () => ({
    requireAuth: (req, res, next) => { req.user = { username: 'testuser' }; next(); }
}));

// Mock security
jest.mock('../../utils/security', () => ({
    logSecurityEvent: jest.fn()
}));

const fs = require('fs');
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
const shortcutsRouter = require('../../routes/shortcuts');
const app = express();
app.use(express.json());
app.use('/api/shortcuts', shortcutsRouter);

// ============================================================================
// GET /
// ============================================================================

describe('GET /api/shortcuts', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('returns default and custom shortcuts', async () => {
        fs.readFileSync.mockReturnValue(JSON.stringify({ 
            shortcuts: [{ id: 'custom-1', name: 'Custom', command: 'bash' }] 
        }));

        const res = await request(app).get('/api/shortcuts');
        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('defaults');
        expect(res.body).toHaveProperty('custom');
        expect(res.body).toHaveProperty('icons');
        expect(res.body).toHaveProperty('allowedCommands');
        expect(res.body.defaults.length).toBeGreaterThan(0);
    });

    test('returns empty custom array when file missing', async () => {
        fs.existsSync.mockReturnValue(false);

        const res = await request(app).get('/api/shortcuts');
        expect(res.status).toBe(200);
        expect(res.body.custom).toEqual([]);
    });
});

// ============================================================================
// POST /
// ============================================================================

describe('POST /api/shortcuts', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        fs.existsSync.mockReturnValue(true);
        fs.readFileSync.mockReturnValue(JSON.stringify({ shortcuts: [] }));
    });

    test('creates new shortcut', async () => {
        const res = await request(app)
            .post('/api/shortcuts')
            .send({
                name: 'My Shortcut',
                command: 'htop',
                icon: '📊',
                description: 'Process monitor'
            });
        // API returns 200, not 201
        expect(res.status).toBe(200);
        expect(res.body.shortcut.name).toBe('My Shortcut');
        expect(res.body.shortcut.command).toBe('htop');
        expect(fs.writeFileSync).toHaveBeenCalled();
        expect(logSecurityEvent).toHaveBeenCalled();
    });

    test('rejects invalid command', async () => {
        const res = await request(app)
            .post('/api/shortcuts')
            .send({
                name: 'Hack',
                command: 'rm -rf /',
                icon: '💻'
            });
        expect(res.status).toBe(400);
        expect(res.body.error).toContain('Invalid');
    });

    test('rejects missing name', async () => {
        const res = await request(app)
            .post('/api/shortcuts')
            .send({
                command: 'bash'
            });
        expect(res.status).toBe(400);
    });
});

// ============================================================================
// PUT /:id
// ============================================================================

describe('PUT /api/shortcuts/:id', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        fs.existsSync.mockReturnValue(true);
        fs.readFileSync.mockReturnValue(JSON.stringify({ 
            shortcuts: [{ id: 'shortcut-1', name: 'Old Name', command: 'bash' }] 
        }));
    });

    test('updates existing shortcut', async () => {
        const res = await request(app)
            .put('/api/shortcuts/shortcut-1')
            .send({
                name: 'New Name',
                command: 'htop'
            });
        expect(res.status).toBe(200);
        expect(res.body.shortcut.name).toBe('New Name');
        expect(fs.writeFileSync).toHaveBeenCalled();
    });

    test('returns 404 for unknown shortcut', async () => {
        fs.readFileSync.mockReturnValue(JSON.stringify({ shortcuts: [] }));
        
        const res = await request(app)
            .put('/api/shortcuts/unknown')
            .send({ name: 'Test', command: 'bash' });
        expect(res.status).toBe(404);
    });

    test('rejects modifying default shortcuts', async () => {
        const res = await request(app)
            .put('/api/shortcuts/default-terminal')
            .send({ name: 'Modified' });
        expect(res.status).toBe(400);
        expect(res.body.error).toContain('default');
    });
});

// ============================================================================
// DELETE /:id
// ============================================================================

describe('DELETE /api/shortcuts/:id', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        fs.existsSync.mockReturnValue(true);
        fs.readFileSync.mockReturnValue(JSON.stringify({ 
            shortcuts: [{ id: 'shortcut-1', name: 'To Delete', command: 'bash' }] 
        }));
    });

    test('deletes existing shortcut', async () => {
        const res = await request(app).delete('/api/shortcuts/shortcut-1');
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(fs.writeFileSync).toHaveBeenCalled();
        expect(logSecurityEvent).toHaveBeenCalled();
    });

    test('returns 404 for unknown shortcut', async () => {
        const res = await request(app).delete('/api/shortcuts/unknown');
        expect(res.status).toBe(404);
    });

    test('rejects deleting default shortcuts', async () => {
        const res = await request(app).delete('/api/shortcuts/default-terminal');
        expect(res.status).toBe(400);
        expect(res.body.error).toContain('default');
    });
});
