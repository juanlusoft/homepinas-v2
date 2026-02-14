/**
 * HomePiNAS - CSRF Middleware Tests
 * Tests for CSRF token generation, validation, and protection
 */

// In-memory token storage for tests (prefixed with mock to be allowed in jest.mock)
const mockTokenStorage = new Map();

// Mock session module before requiring csrf
jest.mock('../../utils/session', () => ({
    storeCsrfToken: jest.fn((sessionId, token) => {
        mockTokenStorage.set(sessionId, { token, createdAt: Date.now() });
    }),
    getCsrfTokenFromDb: jest.fn((sessionId) => {
        return mockTokenStorage.get(sessionId) || null;
    }),
    deleteCsrfToken: jest.fn((sessionId) => {
        mockTokenStorage.delete(sessionId);
    }),
    cleanExpiredCsrfTokens: jest.fn(),
    CSRF_TOKEN_DURATION: 24 * 60 * 60 * 1000 // 24 hours
}));

const {
    generateCsrfToken,
    getCsrfToken,
    validateCsrfToken,
    clearCsrfToken,
    csrfProtection
} = require('../../middleware/csrf');

// Clear token storage before each test
beforeEach(() => {
    mockTokenStorage.clear();
    jest.clearAllMocks();
});

// Mock request/response helpers
function mockReq(method, path, headers = {}) {
    return {
        method,
        path,
        headers: {
            'x-session-id': headers.sessionId || null,
            'x-csrf-token': headers.csrfToken || null,
            ...headers
        }
    };
}

function mockRes() {
    const res = {
        statusCode: 200,
        body: null,
        status: jest.fn(function(code) {
            this.statusCode = code;
            return this;
        }),
        json: jest.fn(function(body) {
            this.body = body;
            return this;
        })
    };
    return res;
}

// ============================================================================
// generateCsrfToken TESTS
// ============================================================================

describe('generateCsrfToken', () => {
    test('returns null for null sessionId', () => {
        expect(generateCsrfToken(null)).toBeNull();
        expect(generateCsrfToken(undefined)).toBeNull();
    });

    test('generates 64-char hex token', () => {
        const token = generateCsrfToken('session-123');
        expect(token).toHaveLength(64);
        expect(token).toMatch(/^[a-f0-9]+$/);
    });

    test('generates unique tokens', () => {
        const token1 = generateCsrfToken('session-1');
        const token2 = generateCsrfToken('session-2');
        expect(token1).not.toBe(token2);
    });

    test('overwrites existing token for same session', () => {
        const token1 = generateCsrfToken('session-overwrite');
        const token2 = generateCsrfToken('session-overwrite');
        expect(token1).not.toBe(token2);
        // Only the second token should be valid
        expect(validateCsrfToken('session-overwrite', token2)).toBe(true);
        expect(validateCsrfToken('session-overwrite', token1)).toBe(false);
    });
});

// ============================================================================
// getCsrfToken TESTS
// ============================================================================

describe('getCsrfToken', () => {
    test('returns null for null sessionId', () => {
        expect(getCsrfToken(null)).toBeNull();
    });

    test('returns existing valid token', () => {
        const token = generateCsrfToken('session-get');
        const retrieved = getCsrfToken('session-get');
        expect(retrieved).toBe(token);
    });

    test('generates new token if none exists', () => {
        const token = getCsrfToken('session-new');
        expect(token).toHaveLength(64);
    });
});

// ============================================================================
// validateCsrfToken TESTS
// ============================================================================

describe('validateCsrfToken', () => {
    test('returns false for null inputs', () => {
        expect(validateCsrfToken(null, 'token')).toBe(false);
        expect(validateCsrfToken('session', null)).toBe(false);
        expect(validateCsrfToken(null, null)).toBe(false);
    });

    test('returns false for unknown session', () => {
        expect(validateCsrfToken('unknown-session', 'token')).toBe(false);
    });

    test('returns true for valid token', () => {
        const token = generateCsrfToken('session-validate');
        expect(validateCsrfToken('session-validate', token)).toBe(true);
    });

    test('returns false for wrong token', () => {
        generateCsrfToken('session-wrong');
        expect(validateCsrfToken('session-wrong', 'wrong-token')).toBe(false);
    });

    test('returns false for token from different session', () => {
        const token1 = generateCsrfToken('session-a');
        generateCsrfToken('session-b');
        expect(validateCsrfToken('session-b', token1)).toBe(false);
    });
});

// ============================================================================
// clearCsrfToken TESTS
// ============================================================================

describe('clearCsrfToken', () => {
    test('removes token for session', () => {
        const token = generateCsrfToken('session-clear');
        expect(validateCsrfToken('session-clear', token)).toBe(true);
        clearCsrfToken('session-clear');
        expect(validateCsrfToken('session-clear', token)).toBe(false);
    });

    test('does not error for unknown session', () => {
        expect(() => clearCsrfToken('unknown')).not.toThrow();
    });
});

// ============================================================================
// csrfProtection Middleware TESTS
// ============================================================================

describe('csrfProtection middleware', () => {
    test('skips GET requests', () => {
        const req = mockReq('GET', '/api/test');
        const res = mockRes();
        const next = jest.fn();

        csrfProtection(req, res, next);
        expect(next).toHaveBeenCalled();
        expect(res.status).not.toHaveBeenCalled();
    });

    test('skips HEAD requests', () => {
        const req = mockReq('HEAD', '/api/test');
        const res = mockRes();
        const next = jest.fn();

        csrfProtection(req, res, next);
        expect(next).toHaveBeenCalled();
    });

    test('skips OPTIONS requests', () => {
        const req = mockReq('OPTIONS', '/api/test');
        const res = mockRes();
        const next = jest.fn();

        csrfProtection(req, res, next);
        expect(next).toHaveBeenCalled();
    });

    test('skips excluded paths', () => {
        // Note: paths must match startsWith pattern including trailing slash for agent
        const excludedPaths = ['/api/auth/setup', '/api/auth/login', '/api/active-backup/agent/register'];
        
        for (const path of excludedPaths) {
            const req = mockReq('POST', path, { sessionId: 'sess-1' });
            const res = mockRes();
            const next = jest.fn();

            csrfProtection(req, res, next);
            expect(next).toHaveBeenCalled();
        }
    });

    test('skips POST without session ID (auth middleware handles it)', () => {
        // CSRF middleware now lets requests without session through
        // because auth middleware will reject them
        const req = mockReq('POST', '/api/test');
        const res = mockRes();
        const next = jest.fn();

        csrfProtection(req, res, next);
        expect(next).toHaveBeenCalled();
    });

    test('rejects POST without CSRF token', () => {
        const req = mockReq('POST', '/api/test', { sessionId: 'session-no-token' });
        const res = mockRes();
        const next = jest.fn();

        csrfProtection(req, res, next);
        expect(res.status).toHaveBeenCalledWith(403);
        expect(next).not.toHaveBeenCalled();
    });

    test('rejects POST with invalid CSRF token', () => {
        generateCsrfToken('session-invalid');
        const req = mockReq('POST', '/api/test', {
            sessionId: 'session-invalid',
            csrfToken: 'wrong-token'
        });
        const res = mockRes();
        const next = jest.fn();

        csrfProtection(req, res, next);
        expect(res.status).toHaveBeenCalledWith(403);
        expect(next).not.toHaveBeenCalled();
    });

    test('allows request with valid CSRF token', () => {
        const token = generateCsrfToken('session-valid');
        const req = mockReq('POST', '/api/test', {
            sessionId: 'session-valid',
            csrfToken: token
        });
        const res = mockRes();
        const next = jest.fn();

        csrfProtection(req, res, next);
        expect(next).toHaveBeenCalled();
        expect(res.status).not.toHaveBeenCalled();
    });

    test('validates PUT requests', () => {
        const token = generateCsrfToken('session-put');
        const req = mockReq('PUT', '/api/test', {
            sessionId: 'session-put',
            csrfToken: token
        });
        const res = mockRes();
        const next = jest.fn();

        csrfProtection(req, res, next);
        expect(next).toHaveBeenCalled();
    });

    test('validates DELETE requests', () => {
        const token = generateCsrfToken('session-delete');
        const req = mockReq('DELETE', '/api/test', {
            sessionId: 'session-delete',
            csrfToken: token
        });
        const res = mockRes();
        const next = jest.fn();

        csrfProtection(req, res, next);
        expect(next).toHaveBeenCalled();
    });
});
