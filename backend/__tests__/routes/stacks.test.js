/**
 * HomePiNAS - Stacks Routes Tests
 * Tests for Docker Compose stack management API endpoints
 */

const express = require('express');
const request = require('supertest');

// Mock fs with both sync and async methods
jest.mock('fs', () => ({
    existsSync: jest.fn(() => true),
    mkdirSync: jest.fn(),
    promises: {
        readdir: jest.fn(),
        readFile: jest.fn(),
        writeFile: jest.fn(),
        mkdir: jest.fn(),
        rmdir: jest.fn(),
        stat: jest.fn(),
        unlink: jest.fn()
    }
}));

// Mock child_process
jest.mock('child_process', () => ({
    exec: jest.fn(),
    execFile: jest.fn()
}));

// Mock middleware
jest.mock('../../middleware/auth', () => ({
    requireAuth: (req, res, next) => {
        req.user = { username: 'testadmin' };
        next();
    }
}));

// Mock utils
jest.mock('../../utils/sanitize', () => ({
    sanitizeComposeName: jest.fn((name) => name && /^[a-zA-Z0-9_-]+$/.test(name) ? name : null),
    validateComposeContent: jest.fn((content) => content && content.length > 0 && content.length < 100000)
}));

jest.mock('../../utils/security', () => ({
    logSecurityEvent: jest.fn()
}));

const fs = require('fs');
const { execFile } = require('child_process');

// Get references to mocked functions
const mockReaddir = fs.promises.readdir;
const mockReadFile = fs.promises.readFile;
const mockWriteFile = fs.promises.writeFile;
const mockMkdir = fs.promises.mkdir;
const mockRmdir = fs.promises.rmdir;
const mockStat = fs.promises.stat;
const mockUnlink = fs.promises.unlink;

const stacksRouter = require('../../routes/stacks');
const app = express();
app.use(express.json());
app.use('/api/stacks', stacksRouter);

// Mock data
const mockStacksList = ['jellyfin', 'nextcloud', 'portainer'];

const mockComposeFile = `version: '3.8'
services:
  app:
    image: nginx:alpine
    ports:
      - "8080:80"
    volumes:
      - ./data:/usr/share/nginx/html`;

const mockStackStatus = [
    {
        Name: 'jellyfin_app_1',
        State: 'running',
        Status: 'Up 2 hours'
    },
    {
        Name: 'jellyfin_db_1', 
        State: 'running',
        Status: 'Up 2 hours'
    }
];

beforeAll(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterAll(() => {
    console.error.mockRestore();
    console.log.mockRestore();
});

beforeEach(() => {
    // Reset mocks
    mockReaddir.mockReset();
    mockReadFile.mockReset();
    mockWriteFile.mockReset();
    mockMkdir.mockReset();
    mockRmdir.mockReset();
    mockStat.mockReset();
    mockUnlink.mockReset();
    execFile.mockReset();
});

describe('GET /api/stacks/list', () => {
    test('returns list of stacks with status', async () => {
        mockReaddir.mockResolvedValue(mockStacksList);
        
        // Mock stack status for each stack
        execFile.mockImplementation((cmd, args, options, callback) => {
            if (args.includes('ps')) {
                const stackName = args.find(arg => arg.includes('docker-compose.yml'))?.split('/')[4]; // extract stack name
                if (stackName === 'jellyfin') {
                    callback(null, JSON.stringify(mockStackStatus[0]) + '\n' + JSON.stringify(mockStackStatus[1]));
                } else {
                    callback(null, '');
                }
            } else {
                callback(new Error('Unknown command'));
            }
        });

        const res = await request(app).get('/api/stacks/list');
        
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.stacks).toHaveLength(3);
        expect(res.body.stacks[0]).toMatchObject({
            name: 'jellyfin',
            status: 'running'
        });
    });

    test('handles empty stacks directory', async () => {
        mockReaddir.mockResolvedValue([]);

        const res = await request(app).get('/api/stacks/list');
        
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.stacks).toHaveLength(0);
    });

    test('handles directory read error', async () => {
        mockReaddir.mockRejectedValue(new Error('Directory not found'));

        const res = await request(app).get('/api/stacks/list');
        
        expect(res.status).toBe(500);
        expect(res.body.success).toBe(false);
    });
});

describe('GET /api/stacks/templates', () => {
    test('returns available templates', async () => {
        const res = await request(app).get('/api/stacks/templates');
        
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.templates).toBeDefined();
        expect(Array.isArray(res.body.templates)).toBe(true);
    });
});

describe('GET /api/stacks/templates/:id', () => {
    test('returns specific template', async () => {
        const res = await request(app).get('/api/stacks/templates/basic');
        
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.template).toBeDefined();
        expect(res.body.template.content).toContain('version:');
    });

    test('returns 404 for unknown template', async () => {
        const res = await request(app).get('/api/stacks/templates/nonexistent');
        
        expect(res.status).toBe(404);
        expect(res.body.success).toBe(false);
        expect(res.body.error).toBe('Template not found');
    });
});

describe('POST /api/stacks/create', () => {
    test('creates new stack successfully', async () => {
        mockMkdir.mockResolvedValue();
        mockWriteFile.mockResolvedValue();
        mockReaddir.mockResolvedValue([]); // No existing stacks

        const stackData = {
            name: 'test-stack',
            compose: mockComposeFile
        };

        const res = await request(app)
            .post('/api/stacks/create')
            .send(stackData);
        
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.message).toBe('Stack created successfully');
        
        expect(mockMkdir).toHaveBeenCalled();
        expect(mockWriteFile).toHaveBeenCalled();
    });

    test('returns 400 for missing name', async () => {
        const res = await request(app)
            .post('/api/stacks/create')
            .send({ compose: mockComposeFile });
        
        expect(res.status).toBe(400);
        expect(res.body.error).toBe('Stack name is required');
    });

    test('returns 400 for missing compose content', async () => {
        const res = await request(app)
            .post('/api/stacks/create')
            .send({ name: 'test-stack' });
        
        expect(res.status).toBe(400);
        expect(res.body.error).toBe('Docker Compose content is required');
    });

    test('returns 400 for invalid stack name', async () => {
        const { sanitizeComposeName } = require('../../utils/sanitize');
        sanitizeComposeName.mockReturnValue(null);

        const res = await request(app)
            .post('/api/stacks/create')
            .send({ name: 'invalid-name!', compose: mockComposeFile });
        
        expect(res.status).toBe(400);
        expect(res.body.error).toBe('Invalid stack name');
    });

    test('returns 409 for duplicate stack name', async () => {
        mockReaddir.mockResolvedValue(['existing-stack']);

        const res = await request(app)
            .post('/api/stacks/create')
            .send({ name: 'existing-stack', compose: mockComposeFile });
        
        expect(res.status).toBe(409);
        expect(res.body.error).toBe('Stack already exists');
    });

    test('handles file system errors', async () => {
        mockReaddir.mockResolvedValue([]);
        mockMkdir.mockRejectedValue(new Error('Permission denied'));

        const res = await request(app)
            .post('/api/stacks/create')
            .send({ name: 'test-stack', compose: mockComposeFile });
        
        expect(res.status).toBe(500);
        expect(res.body.success).toBe(false);
    });
});

describe('GET /api/stacks/:id', () => {
    test('returns stack details', async () => {
        mockReadFile.mockResolvedValue(mockComposeFile);

        const res = await request(app).get('/api/stacks/jellyfin');
        
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.stack).toMatchObject({
            name: 'jellyfin',
            compose: mockComposeFile
        });
    });

    test('returns 400 for invalid stack name', async () => {
        const { sanitizeComposeName } = require('../../utils/sanitize');
        sanitizeComposeName.mockReturnValue(null);

        const res = await request(app).get('/api/stacks/invalid!');
        
        expect(res.status).toBe(400);
        expect(res.body.error).toBe('Invalid stack name');
    });

    test('returns 404 for non-existent stack', async () => {
        mockReadFile.mockRejectedValue(new Error('ENOENT'));

        const res = await request(app).get('/api/stacks/nonexistent');
        
        expect(res.status).toBe(404);
        expect(res.body.success).toBe(false);
        expect(res.body.error).toBe('Stack not found');
    });
});

describe('PUT /api/stacks/:id', () => {
    test('updates stack successfully', async () => {
        mockWriteFile.mockResolvedValue();

        const updateData = {
            compose: mockComposeFile
        };

        const res = await request(app)
            .put('/api/stacks/jellyfin')
            .send(updateData);
        
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.message).toBe('Stack updated successfully');
    });

    test('returns 400 for invalid stack name', async () => {
        const { sanitizeComposeName } = require('../../utils/sanitize');
        sanitizeComposeName.mockReturnValue(null);

        const res = await request(app)
            .put('/api/stacks/invalid!')
            .send({ compose: mockComposeFile });
        
        expect(res.status).toBe(400);
        expect(res.body.error).toBe('Invalid stack name');
    });

    test('returns 400 for missing compose content', async () => {
        const res = await request(app)
            .put('/api/stacks/jellyfin')
            .send({});
        
        expect(res.status).toBe(400);
        expect(res.body.error).toBe('Docker Compose content is required');
    });

    test('handles file write error', async () => {
        mockWriteFile.mockRejectedValue(new Error('Write failed'));

        const res = await request(app)
            .put('/api/stacks/jellyfin')
            .send({ compose: mockComposeFile });
        
        expect(res.status).toBe(500);
        expect(res.body.success).toBe(false);
    });
});

describe('POST /api/stacks/:id/up', () => {
    test('starts stack successfully', async () => {
        execFile.mockImplementation((cmd, args, options, callback) => {
            callback(null, 'Services started');
        });

        const res = await request(app).post('/api/stacks/jellyfin/up');
        
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.message).toBe('Stack started successfully');
        
        expect(execFile).toHaveBeenCalledWith(
            'docker-compose',
            expect.arrayContaining(['up', '-d']),
            expect.any(Object),
            expect.any(Function)
        );
    });

    test('returns 400 for invalid stack name', async () => {
        const { sanitizeComposeName } = require('../../utils/sanitize');
        sanitizeComposeName.mockReturnValue(null);

        const res = await request(app).post('/api/stacks/invalid!/up');
        
        expect(res.status).toBe(400);
        expect(res.body.error).toBe('Invalid stack name');
    });

    test('handles docker-compose error', async () => {
        execFile.mockImplementation((cmd, args, options, callback) => {
            callback(new Error('Compose failed'));
        });

        const res = await request(app).post('/api/stacks/jellyfin/up');
        
        expect(res.status).toBe(500);
        expect(res.body.success).toBe(false);
        expect(res.body.error).toBe('Compose failed');
    });
});

describe('POST /api/stacks/:id/down', () => {
    test('stops stack successfully', async () => {
        execFile.mockImplementation((cmd, args, options, callback) => {
            callback(null, 'Services stopped');
        });

        const res = await request(app).post('/api/stacks/jellyfin/down');
        
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.message).toBe('Stack stopped successfully');
        
        expect(execFile).toHaveBeenCalledWith(
            'docker-compose',
            expect.arrayContaining(['down']),
            expect.any(Object),
            expect.any(Function)
        );
    });

    test('handles docker-compose error', async () => {
        execFile.mockImplementation((cmd, args, options, callback) => {
            callback(new Error('Stop failed'));
        });

        const res = await request(app).post('/api/stacks/jellyfin/down');
        
        expect(res.status).toBe(500);
        expect(res.body.success).toBe(false);
        expect(res.body.error).toBe('Stop failed');
    });
});

describe('POST /api/stacks/:id/restart', () => {
    test('restarts stack successfully', async () => {
        execFile.mockImplementation((cmd, args, options, callback) => {
            callback(null, 'Services restarted');
        });

        const res = await request(app).post('/api/stacks/jellyfin/restart');
        
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.message).toBe('Stack restarted successfully');
        
        expect(execFile).toHaveBeenCalledWith(
            'docker-compose',
            expect.arrayContaining(['restart']),
            expect.any(Object),
            expect.any(Function)
        );
    });

    test('handles docker-compose error', async () => {
        execFile.mockImplementation((cmd, args, options, callback) => {
            callback(new Error('Restart failed'));
        });

        const res = await request(app).post('/api/stacks/jellyfin/restart');
        
        expect(res.status).toBe(500);
        expect(res.body.success).toBe(false);
        expect(res.body.error).toBe('Restart failed');
    });
});

describe('GET /api/stacks/:id/logs', () => {
    test('returns stack logs', async () => {
        execFile.mockImplementation((cmd, args, options, callback) => {
            callback(null, 'Stack log line 1\nStack log line 2');
        });

        const res = await request(app).get('/api/stacks/jellyfin/logs');
        
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.logs).toBe('Stack log line 1\nStack log line 2');
        
        expect(execFile).toHaveBeenCalledWith(
            'docker-compose',
            expect.arrayContaining(['logs', '--tail', '100']),
            expect.any(Object),
            expect.any(Function)
        );
    });

    test('handles logs error', async () => {
        execFile.mockImplementation((cmd, args, options, callback) => {
            callback(new Error('Logs failed'));
        });

        const res = await request(app).get('/api/stacks/jellyfin/logs');
        
        expect(res.status).toBe(500);
        expect(res.body.success).toBe(false);
        expect(res.body.error).toBe('Logs failed');
    });
});

describe('DELETE /api/stacks/:id', () => {
    test('deletes stack successfully', async () => {
        execFile.mockImplementation((cmd, args, options, callback) => {
            callback(null, 'Stack stopped');
        });
        
        mockRmdir.mockResolvedValue();

        const res = await request(app).delete('/api/stacks/jellyfin');
        
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.message).toBe('Stack deleted successfully');
        
        // Verify stack was stopped first
        expect(execFile).toHaveBeenCalledWith(
            'docker-compose',
            expect.arrayContaining(['down']),
            expect.any(Object),
            expect.any(Function)
        );
        
        // Verify directory was removed
        expect(mockRmdir).toHaveBeenCalled();
    });

    test('handles docker-compose stop error but continues deletion', async () => {
        execFile.mockImplementation((cmd, args, options, callback) => {
            callback(new Error('Stack not running'));
        });
        
        mockRmdir.mockResolvedValue();

        const res = await request(app).delete('/api/stacks/jellyfin');
        
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.message).toBe('Stack deleted successfully');
        
        // Should still remove directory even if docker-compose failed
        expect(mockRmdir).toHaveBeenCalled();
    });

    test('handles directory removal error', async () => {
        execFile.mockImplementation((cmd, args, options, callback) => {
            callback(null, 'Stack stopped');
        });
        
        mockRmdir.mockRejectedValue(new Error('Permission denied'));

        const res = await request(app).delete('/api/stacks/jellyfin');
        
        expect(res.status).toBe(500);
        expect(res.body.success).toBe(false);
    });
});

describe('POST /api/stacks/:id/pull', () => {
    test('pulls stack images successfully', async () => {
        execFile.mockImplementation((cmd, args, options, callback) => {
            callback(null, 'Images pulled');
        });

        const res = await request(app).post('/api/stacks/jellyfin/pull');
        
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.message).toBe('Images pulled successfully');
        
        expect(execFile).toHaveBeenCalledWith(
            'docker-compose',
            expect.arrayContaining(['pull']),
            expect.any(Object),
            expect.any(Function)
        );
    });

    test('handles pull error', async () => {
        execFile.mockImplementation((cmd, args, options, callback) => {
            callback(new Error('Pull failed'));
        });

        const res = await request(app).post('/api/stacks/jellyfin/pull');
        
        expect(res.status).toBe(500);
        expect(res.body.success).toBe(false);
        expect(res.body.error).toBe('Pull failed');
    });
});