/**
 * HomePiNAS - Files Routes Tests
 * Tests for File Station API endpoints
 */

const express = require('express');
const request = require('supertest');
const path = require('path');

// Mock fs - define functions that jest.mock can reference
jest.mock('fs', () => ({
    existsSync: jest.fn(),
    statSync: jest.fn(),
    lstatSync: jest.fn(),
    readdirSync: jest.fn(),
    mkdirSync: jest.fn(),
    renameSync: jest.fn(),
    rmSync: jest.fn(),
    cpSync: jest.fn(),
    unlinkSync: jest.fn(),
    copyFileSync: jest.fn(),
}));

// Get reference to mocked fs
const mockFs = require('fs');

// Mock dependencies
jest.mock('../../middleware/auth', () => ({
    requireAuth: (req, res, next) => {
        req.user = { username: 'testuser' };
        next();
    }
}));

jest.mock('../../middleware/rbac', () => ({
    requirePermission: (permission) => (req, res, next) => {
        req.user.permissions = ['read', 'write', 'delete'];
        if (req.user.permissions.includes(permission)) {
            next();
        } else {
            res.status(403).json({ error: 'Permission denied' });
        }
    }
}));

jest.mock('../../utils/security', () => ({
    logSecurityEvent: jest.fn()
}));

// Mock multer
jest.mock('multer', () => {
    const multer = () => ({
        array: () => (req, res, next) => {
            req.files = req.body._mockFiles || [];
            req.body = req.body._mockBody || req.body;
            next();
        }
    });
    multer.diskStorage = jest.fn(() => ({}));
    return multer;
});

// Note: os module not mocked - files.js uses os.tmpdir() which works fine in tests

const { logSecurityEvent } = require('../../utils/security');

// Create app AFTER mocks
const filesRouter = require('../../routes/files');
const app = express();
app.use(express.json());
app.use('/api/files', filesRouter);

// ============================================================================
// GET /api/files/list TESTS
// ============================================================================

describe('GET /api/files/list', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('lists root directory successfully', async () => {
        mockFs.existsSync.mockReturnValue(true);
        mockFs.statSync.mockImplementation((p) => ({
            isDirectory: () => true,
            isFile: () => false,
            size: 4096,
            mtime: new Date('2026-01-01'),
            mode: 0o755
        }));
        mockFs.readdirSync.mockReturnValue(['folder1', 'file1.txt']);

        const res = await request(app)
            .get('/api/files/list')
            .query({ path: '/' });

        expect(res.status).toBe(200);
        expect(res.body.path).toBe('/');
        expect(res.body.items).toBeDefined();
        expect(res.body.count).toBe(2);
    });

    test('returns 404 for non-existent directory', async () => {
        mockFs.existsSync.mockReturnValue(false);

        const res = await request(app)
            .get('/api/files/list')
            .query({ path: '/nonexistent' });

        expect(res.status).toBe(404);
        expect(res.body.error).toContain('not found');
    });

    test('returns 400 for path traversal attempt', async () => {
        const res = await request(app)
            .get('/api/files/list')
            .query({ path: '/../etc/passwd' });

        expect(res.status).toBe(400);
        expect(res.body.error).toContain('Invalid path');
    });

    test('returns 400 when path is not a directory', async () => {
        mockFs.existsSync.mockReturnValue(true);
        mockFs.statSync.mockReturnValue({
            isDirectory: () => false
        });

        const res = await request(app)
            .get('/api/files/list')
            .query({ path: '/file.txt' });

        expect(res.status).toBe(400);
        expect(res.body.error).toContain('not a directory');
    });
});

// ============================================================================
// GET /api/files/download TESTS
// ============================================================================

describe('GET /api/files/download', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('returns 400 if path not provided', async () => {
        const res = await request(app)
            .get('/api/files/download');

        expect(res.status).toBe(400);
        expect(res.body.error).toContain('Path parameter required');
    });

    test('returns 404 for non-existent file', async () => {
        mockFs.existsSync.mockReturnValue(false);

        const res = await request(app)
            .get('/api/files/download')
            .query({ path: '/nonexistent.txt' });

        expect(res.status).toBe(404);
        expect(res.body.error).toContain('File not found');
    });

    test('returns 400 when trying to download directory', async () => {
        mockFs.existsSync.mockReturnValue(true);
        mockFs.statSync.mockReturnValue({
            isDirectory: () => true
        });

        const res = await request(app)
            .get('/api/files/download')
            .query({ path: '/folder' });

        expect(res.status).toBe(400);
        expect(res.body.error).toContain('Cannot download a directory');
    });
});

// ============================================================================
// POST /api/files/mkdir TESTS
// ============================================================================

describe('POST /api/files/mkdir', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('creates directory successfully', async () => {
        mockFs.existsSync.mockReturnValue(false);
        mockFs.mkdirSync.mockReturnValue(undefined);

        const res = await request(app)
            .post('/api/files/mkdir')
            .send({ path: '/newfolder' });

        expect(res.status).toBe(200);
        expect(res.body.message).toContain('Directory created');
        expect(mockFs.mkdirSync).toHaveBeenCalled();
        expect(logSecurityEvent).toHaveBeenCalledWith(
            'dir_create',
            'testuser',
            expect.objectContaining({ path: '/newfolder' })
        );
    });

    test('returns 400 if path not provided', async () => {
        const res = await request(app)
            .post('/api/files/mkdir')
            .send({});

        expect(res.status).toBe(400);
        expect(res.body.error).toContain('Path parameter required');
    });

    test('returns 409 if directory already exists', async () => {
        mockFs.existsSync.mockReturnValue(true);

        const res = await request(app)
            .post('/api/files/mkdir')
            .send({ path: '/existingfolder' });

        expect(res.status).toBe(409);
        expect(res.body.error).toContain('already exists');
    });

    test('rejects path traversal', async () => {
        const res = await request(app)
            .post('/api/files/mkdir')
            .send({ path: '/../etc/evil' });

        expect(res.status).toBe(400);
        expect(res.body.error).toContain('Invalid path');
    });
});

// ============================================================================
// POST /api/files/rename TESTS
// ============================================================================

describe('POST /api/files/rename', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('renames file successfully', async () => {
        mockFs.existsSync.mockImplementation((p) => {
            return p.includes('oldfile');
        });
        mockFs.renameSync.mockReturnValue(undefined);

        const res = await request(app)
            .post('/api/files/rename')
            .send({ oldPath: '/oldfile.txt', newPath: '/newfile.txt' });

        expect(res.status).toBe(200);
        expect(res.body.message).toContain('Renamed successfully');
        expect(logSecurityEvent).toHaveBeenCalledWith(
            'file_rename',
            'testuser',
            expect.any(Object)
        );
    });

    test('returns 400 if oldPath missing', async () => {
        const res = await request(app)
            .post('/api/files/rename')
            .send({ newPath: '/newfile.txt' });

        expect(res.status).toBe(400);
        expect(res.body.error).toContain('Both oldPath and newPath are required');
    });

    test('returns 404 if source not found', async () => {
        mockFs.existsSync.mockReturnValue(false);

        const res = await request(app)
            .post('/api/files/rename')
            .send({ oldPath: '/nonexistent.txt', newPath: '/new.txt' });

        expect(res.status).toBe(404);
        expect(res.body.error).toContain('Source path not found');
    });

    test('returns 409 if destination exists', async () => {
        mockFs.existsSync.mockReturnValue(true);

        const res = await request(app)
            .post('/api/files/rename')
            .send({ oldPath: '/old.txt', newPath: '/existing.txt' });

        expect(res.status).toBe(409);
        expect(res.body.error).toContain('Destination already exists');
    });
});

// ============================================================================
// POST /api/files/delete TESTS
// ============================================================================

describe('POST /api/files/delete', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('deletes file successfully', async () => {
        mockFs.existsSync.mockReturnValue(true);
        mockFs.statSync.mockReturnValue({
            isDirectory: () => false
        });
        mockFs.rmSync.mockReturnValue(undefined);

        const res = await request(app)
            .post('/api/files/delete')
            .send({ path: '/file-to-delete.txt' });

        expect(res.status).toBe(200);
        expect(res.body.message).toContain('Deleted successfully');
        expect(mockFs.rmSync).toHaveBeenCalled();
        expect(logSecurityEvent).toHaveBeenCalledWith(
            'file_delete',
            'testuser',
            expect.objectContaining({ type: 'file' })
        );
    });

    test('deletes directory successfully', async () => {
        mockFs.existsSync.mockReturnValue(true);
        mockFs.statSync.mockReturnValue({
            isDirectory: () => true
        });
        mockFs.rmSync.mockReturnValue(undefined);

        const res = await request(app)
            .post('/api/files/delete')
            .send({ path: '/folder-to-delete' });

        expect(res.status).toBe(200);
        expect(logSecurityEvent).toHaveBeenCalledWith(
            'file_delete',
            'testuser',
            expect.objectContaining({ type: 'directory' })
        );
    });

    test('returns 400 if path not provided', async () => {
        const res = await request(app)
            .post('/api/files/delete')
            .send({});

        expect(res.status).toBe(400);
        expect(res.body.error).toContain('Path parameter required');
    });

    test('returns 404 if path not found', async () => {
        mockFs.existsSync.mockReturnValue(false);

        const res = await request(app)
            .post('/api/files/delete')
            .send({ path: '/nonexistent.txt' });

        expect(res.status).toBe(404);
        expect(res.body.error).toContain('Path not found');
    });

    test('prevents deleting storage root', async () => {
        mockFs.existsSync.mockReturnValue(true);

        const res = await request(app)
            .post('/api/files/delete')
            .send({ path: '/' });

        expect(res.status).toBe(403);
        expect(res.body.error).toContain('Cannot delete storage root');
    });
});

// ============================================================================
// POST /api/files/move TESTS
// ============================================================================

describe('POST /api/files/move', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('moves file successfully', async () => {
        mockFs.existsSync.mockReturnValue(true);
        mockFs.renameSync.mockReturnValue(undefined);

        const res = await request(app)
            .post('/api/files/move')
            .send({ source: '/file.txt', destination: '/folder/file.txt' });

        expect(res.status).toBe(200);
        expect(res.body.message).toContain('Moved successfully');
        expect(logSecurityEvent).toHaveBeenCalledWith(
            'file_move',
            'testuser',
            expect.any(Object)
        );
    });

    test('returns 400 if source missing', async () => {
        const res = await request(app)
            .post('/api/files/move')
            .send({ destination: '/folder' });

        expect(res.status).toBe(400);
        expect(res.body.error).toContain('Both source and destination are required');
    });

    test('returns 404 if source not found', async () => {
        mockFs.existsSync.mockReturnValue(false);

        const res = await request(app)
            .post('/api/files/move')
            .send({ source: '/nonexistent.txt', destination: '/dest.txt' });

        expect(res.status).toBe(404);
        expect(res.body.error).toContain('Source not found');
    });
});

// ============================================================================
// POST /api/files/copy TESTS
// ============================================================================

describe('POST /api/files/copy', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('copies file successfully', async () => {
        mockFs.existsSync.mockReturnValue(true);
        mockFs.cpSync.mockReturnValue(undefined);

        const res = await request(app)
            .post('/api/files/copy')
            .send({ source: '/file.txt', destination: '/file-copy.txt' });

        expect(res.status).toBe(200);
        expect(res.body.message).toContain('Copied successfully');
        expect(mockFs.cpSync).toHaveBeenCalled();
        expect(logSecurityEvent).toHaveBeenCalledWith(
            'file_copy',
            'testuser',
            expect.any(Object)
        );
    });

    test('returns 404 if source not found', async () => {
        mockFs.existsSync.mockReturnValue(false);

        const res = await request(app)
            .post('/api/files/copy')
            .send({ source: '/nonexistent.txt', destination: '/dest.txt' });

        expect(res.status).toBe(404);
    });
});

// ============================================================================
// GET /api/files/info TESTS
// ============================================================================

describe('GET /api/files/info', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('returns file info successfully', async () => {
        mockFs.existsSync.mockReturnValue(true);
        mockFs.statSync.mockReturnValue({
            isDirectory: () => false,
            size: 1024,
            birthtime: new Date('2026-01-01'),
            mtime: new Date('2026-01-15'),
            atime: new Date('2026-01-20'),
            mode: 0o644,
            uid: 1000,
            gid: 1000
        });
        mockFs.lstatSync.mockReturnValue({
            isSymbolicLink: () => false
        });

        const res = await request(app)
            .get('/api/files/info')
            .query({ path: '/test.txt' });

        expect(res.status).toBe(200);
        expect(res.body.name).toBe('test.txt');
        expect(res.body.type).toBe('file');
        expect(res.body.size).toBe(1024);
        expect(res.body.mimeType).toBe('text/plain');
    });

    test('returns directory info', async () => {
        mockFs.existsSync.mockReturnValue(true);
        mockFs.statSync.mockReturnValue({
            isDirectory: () => true,
            size: 4096,
            birthtime: new Date(),
            mtime: new Date(),
            atime: new Date(),
            mode: 0o755,
            uid: 1000,
            gid: 1000
        });
        mockFs.lstatSync.mockReturnValue({
            isSymbolicLink: () => false
        });

        const res = await request(app)
            .get('/api/files/info')
            .query({ path: '/folder' });

        expect(res.status).toBe(200);
        expect(res.body.type).toBe('directory');
        expect(res.body.mimeType).toBeNull();
    });

    test('returns 400 if path not provided', async () => {
        const res = await request(app)
            .get('/api/files/info');

        expect(res.status).toBe(400);
    });

    test('returns 404 if path not found', async () => {
        mockFs.existsSync.mockReturnValue(false);

        const res = await request(app)
            .get('/api/files/info')
            .query({ path: '/nonexistent' });

        expect(res.status).toBe(404);
    });
});

// ============================================================================
// GET /api/files/search TESTS
// ============================================================================

describe('GET /api/files/search', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('returns 400 if query not provided', async () => {
        const res = await request(app)
            .get('/api/files/search')
            .query({ path: '/' });

        expect(res.status).toBe(400);
        expect(res.body.error).toContain('Search query is required');
    });

    test('returns 400 if query is empty', async () => {
        const res = await request(app)
            .get('/api/files/search')
            .query({ path: '/', query: '   ' });

        expect(res.status).toBe(400);
    });

    test('returns 404 if search directory not found', async () => {
        mockFs.existsSync.mockReturnValue(false);

        const res = await request(app)
            .get('/api/files/search')
            .query({ path: '/nonexistent', query: 'test' });

        expect(res.status).toBe(404);
        expect(res.body.error).toContain('Search directory not found');
    });

    test('searches files successfully', async () => {
        mockFs.existsSync.mockReturnValue(true);
        mockFs.statSync.mockReturnValue({
            isDirectory: () => true,
            size: 100,
            mtime: new Date()
        });
        mockFs.readdirSync.mockReturnValue([]);

        const res = await request(app)
            .get('/api/files/search')
            .query({ path: '/', query: 'test' });

        expect(res.status).toBe(200);
        expect(res.body.query).toBe('test');
        expect(res.body.results).toBeDefined();
        expect(Array.isArray(res.body.results)).toBe(true);
    });
});
