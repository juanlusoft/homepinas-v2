/**
 * HomePiNAS - Session Utility Tests
 * Tests for SQLite-backed session management
 */

const fs = require('fs');
const path = require('path');

// Mock fs and Database before requiring session module
jest.mock('fs');
jest.mock('better-sqlite3');

const Database = require('better-sqlite3');
const {
    initSessionDb,
    createSession,
    validateSession,
    destroySession,
    clearAllSessions,
    cleanExpiredSessions,
    SESSION_DURATION,
    SESSION_IDLE_TIMEOUT,
    storeCsrfToken,
    getCsrfTokenFromDb,
    deleteCsrfToken,
    cleanExpiredCsrfTokens,
    CSRF_TOKEN_DURATION
} = require('../../utils/session');

// Mock database instance
let mockDb;
let mockPrepare;
let mockExec;

describe('Session Management', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.spyOn(console, 'log').mockImplementation(() => {});
        jest.spyOn(console, 'error').mockImplementation(() => {});
        jest.spyOn(console, 'warn').mockImplementation(() => {});

        // Setup mock database
        mockPrepare = jest.fn();
        mockExec = jest.fn();
        mockDb = {
            prepare: mockPrepare,
            exec: mockExec
        };

        Database.mockReturnValue(mockDb);

        // Mock fs methods
        fs.existsSync = jest.fn().mockReturnValue(true);
        fs.mkdirSync = jest.fn();
        fs.chmodSync = jest.fn();
    });

    afterEach(() => {
        console.log.mockRestore();
        console.error.mockRestore();
        console.warn.mockRestore();
    });

    // ============================================================================
    // initSessionDb TESTS
    // ============================================================================

    describe('initSessionDb', () => {
        test('creates config directory if it does not exist', () => {
            fs.existsSync.mockReturnValue(false);
            
            initSessionDb();
            
            expect(fs.mkdirSync).toHaveBeenCalledWith(
                expect.stringContaining('config'),
                { recursive: true, mode: 0o700 }
            );
        });

        test('initializes SQLite database', () => {
            initSessionDb();
            
            expect(Database).toHaveBeenCalledWith(
                expect.stringContaining('sessions.db')
            );
        });

        test('sets restrictive permissions on database file', () => {
            initSessionDb();
            
            expect(fs.chmodSync).toHaveBeenCalledWith(
                expect.stringContaining('sessions.db'),
                0o600
            );
        });

        test('creates sessions table', () => {
            initSessionDb();
            
            expect(mockExec).toHaveBeenCalledWith(
                expect.stringContaining('CREATE TABLE IF NOT EXISTS sessions')
            );
        });

        test('creates csrf_tokens table', () => {
            initSessionDb();
            
            expect(mockExec).toHaveBeenCalledWith(
                expect.stringContaining('CREATE TABLE IF NOT EXISTS csrf_tokens')
            );
        });

        test('creates index on expires_at column', () => {
            initSessionDb();
            
            expect(mockExec).toHaveBeenCalledWith(
                expect.stringContaining('CREATE INDEX IF NOT EXISTS idx_sessions_expires')
            );
        });

        test('handles database initialization errors gracefully', () => {
            Database.mockImplementation(() => {
                throw new Error('Database initialization failed');
            });
            
            const result = initSessionDb();
            
            expect(result).toBe(false);
            expect(console.error).toHaveBeenCalledWith(
                'Failed to initialize session database:',
                'Database initialization failed'
            );
        });

        test('handles permission setting errors gracefully', () => {
            fs.chmodSync.mockImplementation(() => {
                throw new Error('Permission denied');
            });
            
            initSessionDb();
            
            expect(console.warn).toHaveBeenCalledWith(
                'Could not set restrictive permissions on session database'
            );
        });

        test('returns true on successful initialization', () => {
            const result = initSessionDb();
            
            expect(result).toBe(true);
        });

        test('handles ALTER TABLE errors (column already exists)', () => {
            mockExec.mockImplementationOnce(() => {})  // CREATE TABLE sessions
                .mockImplementationOnce(() => { throw new Error('Column exists'); })  // ALTER TABLE
                .mockImplementationOnce(() => {});  // CREATE INDEX
            
            const result = initSessionDb();
            
            expect(result).toBe(true);
        });
    });

    // ============================================================================
    // createSession TESTS
    // ============================================================================

    describe('createSession', () => {
        beforeEach(() => {
            // Initialize db mock
            initSessionDb();
        });

        test('creates session with UUID and expiration', () => {
            const mockRun = jest.fn();
            mockPrepare.mockReturnValue({ run: mockRun });
            
            const sessionId = createSession('testuser');
            
            expect(sessionId).toBeDefined();
            expect(sessionId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
            expect(mockPrepare).toHaveBeenCalledWith(
                expect.stringContaining('INSERT INTO sessions')
            );
        });

        test('inserts session with correct username', () => {
            const mockRun = jest.fn();
            mockPrepare.mockReturnValue({ run: mockRun });
            
            createSession('john_doe');
            
            expect(mockRun).toHaveBeenCalledWith(
                expect.any(String),  // sessionId (UUID)
                'john_doe',
                expect.any(Number)   // expiresAt
            );
        });

        test('sets expiration to SESSION_DURATION from now', () => {
            const mockRun = jest.fn();
            mockPrepare.mockReturnValue({ run: mockRun });
            const now = Date.now();
            
            createSession('testuser');
            
            const expiresAt = mockRun.mock.calls[0][2];
            expect(expiresAt).toBeGreaterThan(now);
            expect(expiresAt).toBeLessThanOrEqual(now + SESSION_DURATION + 100);
        });

        test('returns null when database not initialized', () => {
            // Simulate uninitialized db
            Database.mockReturnValue(null);
            
            const result = createSession('testuser');
            
            expect(result).toBeNull();
        });

        test('returns null on database error', () => {
            mockPrepare.mockReturnValue({
                run: jest.fn().mockImplementation(() => {
                    throw new Error('Database error');
                })
            });
            
            const result = createSession('testuser');
            
            expect(result).toBeNull();
            expect(console.error).toHaveBeenCalledWith(
                'Failed to create session:',
                'Database error'
            );
        });
    });

    // ============================================================================
    // validateSession TESTS
    // ============================================================================

    describe('validateSession', () => {
        beforeEach(() => {
            initSessionDb();
        });

        test('returns null for null sessionId', () => {
            const result = validateSession(null);
            expect(result).toBeNull();
        });

        test('returns null for undefined sessionId', () => {
            const result = validateSession(undefined);
            expect(result).toBeNull();
        });

        test('returns null for empty sessionId', () => {
            const result = validateSession('');
            expect(result).toBeNull();
        });

        test('returns null when session not found in database', () => {
            const mockGet = jest.fn().mockReturnValue(null);
            mockPrepare.mockReturnValue({ get: mockGet });
            
            const result = validateSession('non-existent-session-id');
            
            expect(result).toBeNull();
        });

        test('returns null and destroys expired session (absolute expiration)', () => {
            const expiredSession = {
                session_id: 'session-123',
                username: 'testuser',
                expires_at: Date.now() - 1000,  // Expired 1 second ago
                last_activity: Date.now() - 1000
            };
            
            const mockGet = jest.fn().mockReturnValue(expiredSession);
            const mockRun = jest.fn();
            mockPrepare.mockReturnValueOnce({ get: mockGet })
                .mockReturnValueOnce({ run: mockRun });  // destroySession
            
            const result = validateSession('session-123');
            
            expect(result).toBeNull();
            expect(mockPrepare).toHaveBeenCalledWith(
                expect.stringContaining('DELETE FROM sessions')
            );
        });

        test('returns null and destroys idle session (idle timeout)', () => {
            const idleSession = {
                session_id: 'session-456',
                username: 'testuser',
                expires_at: Date.now() + SESSION_DURATION,  // Not expired
                last_activity: Date.now() - SESSION_IDLE_TIMEOUT - 1000  // Idle too long
            };
            
            const mockGet = jest.fn().mockReturnValue(idleSession);
            const mockRun = jest.fn();
            mockPrepare.mockReturnValueOnce({ get: mockGet })
                .mockReturnValueOnce({ run: mockRun });
            
            const result = validateSession('session-456');
            
            expect(result).toBeNull();
        });

        test('returns session data for valid session', () => {
            const validSession = {
                session_id: 'session-789',
                username: 'john',
                expires_at: Date.now() + SESSION_DURATION,
                last_activity: Date.now() - 1000  // Active 1 second ago
            };
            
            const mockGet = jest.fn().mockReturnValue(validSession);
            const mockRun = jest.fn();
            mockPrepare.mockReturnValueOnce({ get: mockGet })
                .mockReturnValueOnce({ run: mockRun });  // UPDATE last_activity
            
            const result = validateSession('session-789');
            
            expect(result).toEqual({
                username: 'john',
                expiresAt: validSession.expires_at
            });
        });

        test('updates last_activity timestamp on valid session', () => {
            const validSession = {
                session_id: 'session-xyz',
                username: 'jane',
                expires_at: Date.now() + SESSION_DURATION,
                last_activity: Date.now() - 60000  // 1 minute ago
            };
            
            const mockGet = jest.fn().mockReturnValue(validSession);
            const mockRun = jest.fn();
            mockPrepare.mockReturnValueOnce({ get: mockGet })
                .mockReturnValueOnce({ run: mockRun });
            
            const now = Date.now();
            validateSession('session-xyz');
            
            expect(mockPrepare).toHaveBeenCalledWith(
                expect.stringContaining('UPDATE sessions SET last_activity')
            );
            expect(mockRun).toHaveBeenCalledWith(
                expect.any(Number),  // timestamp close to now
                'session-xyz'
            );
        });

        test('handles missing last_activity field gracefully', () => {
            const sessionWithoutActivity = {
                session_id: 'session-old',
                username: 'olduser',
                expires_at: Date.now() + SESSION_DURATION,
                last_activity: null
            };
            
            const mockGet = jest.fn().mockReturnValue(sessionWithoutActivity);
            const mockRun = jest.fn();
            mockPrepare.mockReturnValueOnce({ get: mockGet })
                .mockReturnValueOnce({ run: mockRun });
            
            const result = validateSession('session-old');
            
            expect(result).toBeDefined();
            expect(result.username).toBe('olduser');
        });

        test('handles database errors gracefully', () => {
            mockPrepare.mockImplementation(() => {
                throw new Error('Database query failed');
            });
            
            const result = validateSession('session-error');
            
            expect(result).toBeNull();
            expect(console.error).toHaveBeenCalledWith(
                'Failed to validate session:',
                'Database query failed'
            );
        });

        test('continues on last_activity update error', () => {
            const validSession = {
                session_id: 'session-update-fail',
                username: 'user123',
                expires_at: Date.now() + SESSION_DURATION,
                last_activity: Date.now()
            };
            
            const mockGet = jest.fn().mockReturnValue(validSession);
            const mockRun = jest.fn().mockImplementation(() => {
                throw new Error('Update failed');
            });
            mockPrepare.mockReturnValueOnce({ get: mockGet })
                .mockReturnValueOnce({ run: mockRun });
            
            // Should still return session even if update fails
            const result = validateSession('session-update-fail');
            
            expect(result).toBeDefined();
            expect(result.username).toBe('user123');
        });
    });

    // ============================================================================
    // destroySession TESTS
    // ============================================================================

    describe('destroySession', () => {
        beforeEach(() => {
            initSessionDb();
        });

        test('deletes session from database', () => {
            const mockRun = jest.fn();
            mockPrepare.mockReturnValue({ run: mockRun });
            
            destroySession('session-to-delete');
            
            expect(mockPrepare).toHaveBeenCalledWith(
                'DELETE FROM sessions WHERE session_id = ?'
            );
            expect(mockRun).toHaveBeenCalledWith('session-to-delete');
        });

        test('handles database errors gracefully', () => {
            mockPrepare.mockReturnValue({
                run: jest.fn().mockImplementation(() => {
                    throw new Error('Delete failed');
                })
            });
            
            expect(() => destroySession('session-error')).not.toThrow();
            expect(console.error).toHaveBeenCalledWith(
                'Failed to destroy session:',
                'Delete failed'
            );
        });

        test('does nothing when database not initialized', () => {
            Database.mockReturnValue(null);
            
            expect(() => destroySession('any-session')).not.toThrow();
        });
    });

    // ============================================================================
    // clearAllSessions TESTS
    // ============================================================================

    describe('clearAllSessions', () => {
        beforeEach(() => {
            initSessionDb();
        });

        test('deletes all sessions from database', () => {
            clearAllSessions();
            
            expect(mockExec).toHaveBeenCalledWith('DELETE FROM sessions');
        });

        test('handles database errors gracefully', () => {
            mockExec.mockImplementation((sql) => {
                if (sql === 'DELETE FROM sessions') {
                    throw new Error('Clear failed');
                }
            });
            
            expect(() => clearAllSessions()).not.toThrow();
            expect(console.error).toHaveBeenCalledWith(
                'Failed to clear sessions:',
                'Clear failed'
            );
        });
    });

    // ============================================================================
    // cleanExpiredSessions TESTS
    // ============================================================================

    describe('cleanExpiredSessions', () => {
        beforeEach(() => {
            initSessionDb();
        });

        test('deletes expired and idle sessions', () => {
            const mockRun = jest.fn().mockReturnValue({ changes: 5 });
            mockPrepare.mockReturnValue({ run: mockRun });
            
            cleanExpiredSessions();
            
            expect(mockPrepare).toHaveBeenCalledWith(
                expect.stringContaining('DELETE FROM sessions')
            );
            expect(mockRun).toHaveBeenCalledWith(
                expect.any(Number),  // now
                expect.any(Number)   // idle threshold
            );
        });

        test('logs cleanup results when sessions were cleaned', () => {
            const mockRun = jest.fn().mockReturnValue({ changes: 3 });
            mockPrepare.mockReturnValue({ run: mockRun });
            
            cleanExpiredSessions();
            
            expect(console.log).toHaveBeenCalledWith(
                'Cleaned 3 expired/idle sessions'
            );
        });

        test('does not log when no sessions were cleaned', () => {
            const mockRun = jest.fn().mockReturnValue({ changes: 0 });
            mockPrepare.mockReturnValue({ run: mockRun });
            
            console.log.mockClear();
            cleanExpiredSessions();
            
            expect(console.log).not.toHaveBeenCalledWith(
                expect.stringContaining('Cleaned')
            );
        });

        test('handles database errors gracefully', () => {
            mockPrepare.mockImplementation(() => {
                throw new Error('Cleanup failed');
            });
            
            expect(() => cleanExpiredSessions()).not.toThrow();
            expect(console.error).toHaveBeenCalledWith(
                'Failed to clean expired sessions:',
                'Cleanup failed'
            );
        });
    });

    // ============================================================================
    // CSRF Token Persistence TESTS
    // ============================================================================

    describe('storeCsrfToken', () => {
        beforeEach(() => {
            initSessionDb();
        });

        test('stores CSRF token in database', () => {
            const mockRun = jest.fn();
            mockPrepare.mockReturnValue({ run: mockRun });
            
            const result = storeCsrfToken('session-123', 'csrf-token-abc');
            
            expect(result).toBe(true);
            expect(mockPrepare).toHaveBeenCalledWith(
                expect.stringContaining('INSERT OR REPLACE INTO csrf_tokens')
            );
            expect(mockRun).toHaveBeenCalledWith(
                'session-123',
                'csrf-token-abc',
                expect.any(Number)  // created_at timestamp
            );
        });

        test('returns false for null sessionId', () => {
            const result = storeCsrfToken(null, 'token');
            expect(result).toBe(false);
        });

        test('returns false for null token', () => {
            const result = storeCsrfToken('session-id', null);
            expect(result).toBe(false);
        });

        test('handles database errors', () => {
            mockPrepare.mockReturnValue({
                run: jest.fn().mockImplementation(() => {
                    throw new Error('Store failed');
                })
            });
            
            const result = storeCsrfToken('session-id', 'token');
            
            expect(result).toBe(false);
            expect(console.error).toHaveBeenCalledWith(
                'Failed to store CSRF token:',
                'Store failed'
            );
        });
    });

    describe('getCsrfTokenFromDb', () => {
        beforeEach(() => {
            initSessionDb();
        });

        test('retrieves CSRF token from database', () => {
            const mockToken = {
                token: 'csrf-token-xyz',
                created_at: Date.now()
            };
            const mockGet = jest.fn().mockReturnValue(mockToken);
            mockPrepare.mockReturnValue({ get: mockGet });
            
            const result = getCsrfTokenFromDb('session-456');
            
            expect(result).toEqual({
                token: 'csrf-token-xyz',
                createdAt: mockToken.created_at
            });
            expect(mockGet).toHaveBeenCalledWith('session-456');
        });

        test('returns null when token not found', () => {
            const mockGet = jest.fn().mockReturnValue(null);
            mockPrepare.mockReturnValue({ get: mockGet });
            
            const result = getCsrfTokenFromDb('non-existent');
            
            expect(result).toBeNull();
        });

        test('returns null and deletes expired token', () => {
            const expiredToken = {
                token: 'old-token',
                created_at: Date.now() - CSRF_TOKEN_DURATION - 1000
            };
            const mockGet = jest.fn().mockReturnValue(expiredToken);
            const mockRun = jest.fn();
            mockPrepare.mockReturnValueOnce({ get: mockGet })
                .mockReturnValueOnce({ run: mockRun });  // deleteCsrfToken
            
            const result = getCsrfTokenFromDb('session-expired');
            
            expect(result).toBeNull();
            expect(mockPrepare).toHaveBeenCalledWith(
                expect.stringContaining('DELETE FROM csrf_tokens')
            );
        });

        test('returns null for null sessionId', () => {
            const result = getCsrfTokenFromDb(null);
            expect(result).toBeNull();
        });

        test('handles database errors', () => {
            mockPrepare.mockImplementation(() => {
                throw new Error('Query failed');
            });
            
            const result = getCsrfTokenFromDb('session-id');
            
            expect(result).toBeNull();
            expect(console.error).toHaveBeenCalledWith(
                'Failed to get CSRF token:',
                'Query failed'
            );
        });
    });

    describe('deleteCsrfToken', () => {
        beforeEach(() => {
            initSessionDb();
        });

        test('deletes CSRF token from database', () => {
            const mockRun = jest.fn();
            mockPrepare.mockReturnValue({ run: mockRun });
            
            deleteCsrfToken('session-to-delete');
            
            expect(mockPrepare).toHaveBeenCalledWith(
                'DELETE FROM csrf_tokens WHERE session_id = ?'
            );
            expect(mockRun).toHaveBeenCalledWith('session-to-delete');
        });

        test('handles database errors gracefully', () => {
            mockPrepare.mockReturnValue({
                run: jest.fn().mockImplementation(() => {
                    throw new Error('Delete failed');
                })
            });
            
            expect(() => deleteCsrfToken('session-id')).not.toThrow();
            expect(console.error).toHaveBeenCalledWith(
                'Failed to delete CSRF token:',
                'Delete failed'
            );
        });
    });

    describe('cleanExpiredCsrfTokens', () => {
        beforeEach(() => {
            initSessionDb();
        });

        test('deletes expired CSRF tokens', () => {
            const mockRun = jest.fn().mockReturnValue({ changes: 4 });
            mockPrepare.mockReturnValue({ run: mockRun });
            
            cleanExpiredCsrfTokens();
            
            expect(mockPrepare).toHaveBeenCalledWith(
                'DELETE FROM csrf_tokens WHERE created_at < ?'
            );
            expect(mockRun).toHaveBeenCalledWith(expect.any(Number));
        });

        test('logs cleanup results when tokens were cleaned', () => {
            const mockRun = jest.fn().mockReturnValue({ changes: 2 });
            mockPrepare.mockReturnValue({ run: mockRun });
            
            cleanExpiredCsrfTokens();
            
            expect(console.log).toHaveBeenCalledWith(
                'Cleaned 2 expired CSRF tokens'
            );
        });

        test('does not log when no tokens were cleaned', () => {
            const mockRun = jest.fn().mockReturnValue({ changes: 0 });
            mockPrepare.mockReturnValue({ run: mockRun });
            
            console.log.mockClear();
            cleanExpiredCsrfTokens();
            
            expect(console.log).not.toHaveBeenCalledWith(
                expect.stringContaining('Cleaned')
            );
        });

        test('handles database errors gracefully', () => {
            mockPrepare.mockImplementation(() => {
                throw new Error('Cleanup failed');
            });
            
            expect(() => cleanExpiredCsrfTokens()).not.toThrow();
            expect(console.error).toHaveBeenCalledWith(
                'Failed to clean CSRF tokens:',
                'Cleanup failed'
            );
        });
    });

    // ============================================================================
    // Constants TESTS
    // ============================================================================

    describe('Session Constants', () => {
        test('SESSION_DURATION is 24 hours', () => {
            expect(SESSION_DURATION).toBe(24 * 60 * 60 * 1000);
        });

        test('SESSION_IDLE_TIMEOUT is 2 hours', () => {
            expect(SESSION_IDLE_TIMEOUT).toBe(2 * 60 * 60 * 1000);
        });

        test('CSRF_TOKEN_DURATION is 24 hours', () => {
            expect(CSRF_TOKEN_DURATION).toBe(24 * 60 * 60 * 1000);
        });
    });
});
