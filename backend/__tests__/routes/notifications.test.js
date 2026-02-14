/**
 * HomePiNAS - Notifications Routes Tests
 * Tests for email and Telegram notification endpoints
 */

const express = require('express');
const request = require('supertest');

// Mock nodemailer
jest.mock('nodemailer', () => ({
    createTransport: jest.fn(() => ({
        sendMail: jest.fn(() => Promise.resolve({ messageId: 'test-message-id' }))
    }))
}));

// Mock global fetch for Telegram API
global.fetch = jest.fn(() =>
    Promise.resolve({
        json: () => Promise.resolve({ ok: true, result: { message_id: 123 } })
    })
);

// Mock data utils
jest.mock('../../utils/data', () => ({
    getData: jest.fn(),
    saveData: jest.fn()
}));

// Mock security
jest.mock('../../utils/security', () => ({
    logSecurityEvent: jest.fn()
}));

// Mock sanitize
jest.mock('../../utils/sanitize', () => ({
    sanitizeString: jest.fn(s => s)
}));

// Mock auth middleware
jest.mock('../../middleware/auth', () => ({
    requireAuth: (req, res, next) => {
        req.user = { username: 'testuser' };
        next();
    }
}));

const nodemailer = require('nodemailer');
const { getData, saveData } = require('../../utils/data');
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
const notificationsRouter = require('../../routes/notifications');
const app = express();
app.use(express.json());
app.use('/api/notifications', notificationsRouter);

// ============================================================================
// GET /config
// ============================================================================

describe('GET /api/notifications/config', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('returns config with masked sensitive fields', async () => {
        getData.mockReturnValue({
            notifications: {
                email: {
                    host: 'smtp.example.com',
                    port: 587,
                    secure: false,
                    user: 'user@example.com',
                    password: 'secretpassword123',
                    from: 'nas@example.com',
                    to: 'admin@example.com'
                },
                telegram: {
                    botToken: '123456789:ABCdefGHIjklMNOpqrSTUvwxYZ',
                    chatId: '-123456',
                    enabled: true
                }
            }
        });

        const res = await request(app)
            .get('/api/notifications/config');

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.config.email.host).toBe('smtp.example.com');
        expect(res.body.config.email.password).toBe('••••d123');
        expect(res.body.config.email.configured).toBe(true);
        expect(res.body.config.telegram.botToken).toContain('••••');
        expect(res.body.config.telegram.enabled).toBe(true);
    });

    test('returns unconfigured state when no notifications set', async () => {
        getData.mockReturnValue({});

        const res = await request(app)
            .get('/api/notifications/config');

        expect(res.status).toBe(200);
        expect(res.body.config.email.configured).toBe(false);
        expect(res.body.config.telegram.configured).toBe(false);
    });
});

// ============================================================================
// POST /config/email
// ============================================================================

describe('POST /api/notifications/config/email', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        getData.mockReturnValue({ notifications: {} });
    });

    test('saves valid email configuration', async () => {
        const res = await request(app)
            .post('/api/notifications/config/email')
            .send({
                host: 'smtp.gmail.com',
                port: 587,
                secure: false,
                user: 'user@gmail.com',
                password: 'apppassword',
                from: 'nas@gmail.com',
                to: 'admin@gmail.com'
            });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(saveData).toHaveBeenCalled();
        expect(logSecurityEvent).toHaveBeenCalledWith(
            'notifications',
            'email_config_updated',
            expect.anything()
        );
    });

    test('rejects missing host', async () => {
        const res = await request(app)
            .post('/api/notifications/config/email')
            .send({
                port: 587,
                secure: false,
                user: 'user@gmail.com',
                password: 'pass',
                from: 'from@test.com',
                to: 'to@test.com'
            });

        expect(res.status).toBe(400);
        expect(res.body.error).toContain('host');
    });

    test('rejects invalid port', async () => {
        const res = await request(app)
            .post('/api/notifications/config/email')
            .send({
                host: 'smtp.test.com',
                port: 99999,
                secure: false,
                user: 'user@test.com',
                password: 'pass',
                from: 'from@test.com',
                to: 'to@test.com'
            });

        expect(res.status).toBe(400);
        expect(res.body.error).toContain('Port');
    });

    test('rejects non-boolean secure', async () => {
        const res = await request(app)
            .post('/api/notifications/config/email')
            .send({
                host: 'smtp.test.com',
                port: 587,
                secure: 'true',
                user: 'user@test.com',
                password: 'pass',
                from: 'from@test.com',
                to: 'to@test.com'
            });

        expect(res.status).toBe(400);
        expect(res.body.error).toContain('boolean');
    });

    test('rejects missing password', async () => {
        const res = await request(app)
            .post('/api/notifications/config/email')
            .send({
                host: 'smtp.test.com',
                port: 587,
                secure: false,
                user: 'user@test.com',
                from: 'from@test.com',
                to: 'to@test.com'
            });

        expect(res.status).toBe(400);
        expect(res.body.error).toContain('password');
    });
});

// ============================================================================
// POST /config/telegram
// ============================================================================

describe('POST /api/notifications/config/telegram', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        getData.mockReturnValue({ notifications: {} });
    });

    test('saves valid telegram configuration', async () => {
        const res = await request(app)
            .post('/api/notifications/config/telegram')
            .send({
                botToken: '123456789:ABCdefGHIjklMNO',
                chatId: '-123456',
                enabled: true
            });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(saveData).toHaveBeenCalled();
        expect(logSecurityEvent).toHaveBeenCalledWith(
            'notifications',
            'telegram_config_updated',
            expect.anything()
        );
    });

    test('accepts numeric chatId', async () => {
        const res = await request(app)
            .post('/api/notifications/config/telegram')
            .send({
                botToken: '123:ABC',
                chatId: -123456,
                enabled: true
            });

        expect(res.status).toBe(200);
    });

    test('rejects missing botToken', async () => {
        const res = await request(app)
            .post('/api/notifications/config/telegram')
            .send({
                chatId: '-123456',
                enabled: true
            });

        expect(res.status).toBe(400);
        expect(res.body.error).toContain('token');
    });

    test('rejects missing chatId', async () => {
        const res = await request(app)
            .post('/api/notifications/config/telegram')
            .send({
                botToken: '123:ABC',
                enabled: true
            });

        expect(res.status).toBe(400);
        expect(res.body.error).toContain('Chat ID');
    });

    test('rejects non-boolean enabled', async () => {
        const res = await request(app)
            .post('/api/notifications/config/telegram')
            .send({
                botToken: '123:ABC',
                chatId: '-123',
                enabled: 'yes'
            });

        expect(res.status).toBe(400);
        expect(res.body.error).toContain('boolean');
    });
});

// ============================================================================
// POST /test/email
// ============================================================================

describe('POST /api/notifications/test/email', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('sends test email successfully', async () => {
        getData.mockReturnValue({
            notifications: {
                email: {
                    host: 'smtp.test.com',
                    port: 587,
                    secure: false,
                    user: 'user@test.com',
                    password: 'password',
                    from: 'nas@test.com',
                    to: 'admin@test.com'
                }
            }
        });

        const res = await request(app)
            .post('/api/notifications/test/email');

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.messageId).toBeDefined();
        expect(nodemailer.createTransport).toHaveBeenCalled();
        expect(logSecurityEvent).toHaveBeenCalledWith(
            'notifications',
            'test_email_sent',
            expect.anything()
        );
    });

    test('fails when email not configured', async () => {
        getData.mockReturnValue({});

        const res = await request(app)
            .post('/api/notifications/test/email');

        expect(res.status).toBe(400);
        expect(res.body.error).toContain('not configured');
    });

    test('handles SMTP errors', async () => {
        getData.mockReturnValue({
            notifications: {
                email: {
                    host: 'smtp.test.com',
                    user: 'user',
                    password: 'pass'
                }
            }
        });

        nodemailer.createTransport.mockReturnValueOnce({
            sendMail: jest.fn(() => Promise.reject(new Error('SMTP connection failed')))
        });

        const res = await request(app)
            .post('/api/notifications/test/email');

        expect(res.status).toBe(500);
        expect(res.body.error).toContain('SMTP connection failed');
    });
});

// ============================================================================
// POST /test/telegram
// ============================================================================

describe('POST /api/notifications/test/telegram', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        global.fetch.mockResolvedValue({
            json: () => Promise.resolve({ ok: true })
        });
    });

    test('sends test telegram message', async () => {
        getData.mockReturnValue({
            notifications: {
                telegram: {
                    botToken: '123:ABC',
                    chatId: '-123456',
                    enabled: true
                }
            }
        });

        const res = await request(app)
            .post('/api/notifications/test/telegram');

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(global.fetch).toHaveBeenCalledWith(
            expect.stringContaining('api.telegram.org'),
            expect.anything()
        );
        expect(logSecurityEvent).toHaveBeenCalledWith(
            'notifications',
            'test_telegram_sent',
            expect.anything()
        );
    });

    test('fails when telegram not configured', async () => {
        getData.mockReturnValue({});

        const res = await request(app)
            .post('/api/notifications/test/telegram');

        expect(res.status).toBe(400);
        expect(res.body.error).toContain('not configured');
    });

    test('handles Telegram API errors', async () => {
        getData.mockReturnValue({
            notifications: {
                telegram: {
                    botToken: 'invalid',
                    chatId: '-123',
                    enabled: true
                }
            }
        });

        global.fetch.mockResolvedValueOnce({
            json: () => Promise.resolve({ ok: false, description: 'Unauthorized' })
        });

        const res = await request(app)
            .post('/api/notifications/test/telegram');

        expect(res.status).toBe(400);
        expect(res.body.error).toContain('Unauthorized');
    });
});

// ============================================================================
// POST /send
// ============================================================================

describe('POST /api/notifications/send', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        global.fetch.mockResolvedValue({
            json: () => Promise.resolve({ ok: true })
        });
    });

    test('sends notification via email', async () => {
        getData.mockReturnValue({
            notifications: {
                email: {
                    host: 'smtp.test.com',
                    user: 'user',
                    password: 'pass',
                    from: 'from@test.com',
                    to: 'to@test.com'
                }
            }
        });

        const res = await request(app)
            .post('/api/notifications/send')
            .send({
                title: 'Test Alert',
                message: 'This is a test',
                channels: ['email']
            });

        expect(res.status).toBe(200);
        expect(res.body.results.email).toBe('sent');
        expect(saveData).toHaveBeenCalled();
    });

    test('sends notification via telegram', async () => {
        getData.mockReturnValue({
            notifications: {
                telegram: {
                    botToken: '123:ABC',
                    chatId: '-123',
                    enabled: true
                }
            }
        });

        const res = await request(app)
            .post('/api/notifications/send')
            .send({
                title: 'Test Alert',
                message: 'This is a test',
                channels: ['telegram']
            });

        expect(res.status).toBe(200);
        expect(res.body.results.telegram).toBe('sent');
    });

    test('sends to multiple channels', async () => {
        getData.mockReturnValue({
            notifications: {
                email: {
                    host: 'smtp.test.com',
                    user: 'user',
                    password: 'pass',
                    from: 'from@test.com',
                    to: 'to@test.com'
                },
                telegram: {
                    botToken: '123:ABC',
                    chatId: '-123',
                    enabled: true
                }
            }
        });

        const res = await request(app)
            .post('/api/notifications/send')
            .send({
                title: 'Multi-channel',
                message: 'Test',
                channels: ['email', 'telegram']
            });

        expect(res.status).toBe(200);
        expect(res.body.results.email).toBe('sent');
        expect(res.body.results.telegram).toBe('sent');
    });

    test('rejects missing title', async () => {
        const res = await request(app)
            .post('/api/notifications/send')
            .send({
                message: 'Test',
                channels: ['email']
            });

        expect(res.status).toBe(400);
        expect(res.body.error).toContain('Title');
    });

    test('rejects missing message', async () => {
        const res = await request(app)
            .post('/api/notifications/send')
            .send({
                title: 'Test',
                channels: ['email']
            });

        expect(res.status).toBe(400);
        expect(res.body.error).toContain('Message');
    });

    test('rejects empty channels array', async () => {
        const res = await request(app)
            .post('/api/notifications/send')
            .send({
                title: 'Test',
                message: 'Test',
                channels: []
            });

        expect(res.status).toBe(400);
        expect(res.body.error).toContain('channel');
    });

    test('returns not_configured for unconfigured channels', async () => {
        getData.mockReturnValue({});

        const res = await request(app)
            .post('/api/notifications/send')
            .send({
                title: 'Test',
                message: 'Test',
                channels: ['email', 'telegram']
            });

        expect(res.status).toBe(200);
        expect(res.body.results.email).toBe('not_configured');
        expect(res.body.results.telegram).toBe('not_configured');
    });
});

// ============================================================================
// GET /history
// ============================================================================

describe('GET /api/notifications/history', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('returns notification history', async () => {
        getData.mockReturnValue({
            notifications: {
                history: [
                    { id: 1, title: 'Alert 1', timestamp: '2026-02-14T10:00:00Z' },
                    { id: 2, title: 'Alert 2', timestamp: '2026-02-14T11:00:00Z' }
                ]
            }
        });

        const res = await request(app)
            .get('/api/notifications/history');

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.history).toHaveLength(2);
        expect(res.body.total).toBe(2);
    });

    test('returns empty array when no history', async () => {
        getData.mockReturnValue({});

        const res = await request(app)
            .get('/api/notifications/history');

        expect(res.status).toBe(200);
        expect(res.body.history).toHaveLength(0);
    });

    test('limits history to 50 entries', async () => {
        const bigHistory = Array.from({ length: 100 }, (_, i) => ({
            id: i,
            title: `Alert ${i}`
        }));

        getData.mockReturnValue({
            notifications: { history: bigHistory }
        });

        const res = await request(app)
            .get('/api/notifications/history');

        expect(res.status).toBe(200);
        expect(res.body.history).toHaveLength(50);
        expect(res.body.total).toBe(100);
    });
});
