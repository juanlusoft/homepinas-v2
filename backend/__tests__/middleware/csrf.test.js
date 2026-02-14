/**
 * HomePiNAS - CSRF Middleware Tests
 * Tests for CSRF token generation, validation, and protection
 */

const {
    generateCsrfToken,
    getCsrfToken,
    validateCsrfToken,
    clearCsrfToken,
    csrfProtection
} = require('../../middleware/csrf');

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
        expect(getCsrfToken(undefined)).toBeNull();
    });

    test('returns existing valid token', () => {
        const sessionId = 'session-get-existing';
        const token1 = generateCsrfToken(sessionId);
        const token2 = getCsrfToken(sessionId);
        expect(token1).toBe(token2);
    });

    test('generates new token if none exists', () => {
        const token = getCsrfToken('session-new-' + Date.now());
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
        expect(validateCsrfToken('unknown-session', 'fake-token')).toBe(false);
    });

    test('returns true for valid token', () => {
        const sessionId = 'session-valid';
        const token = generateCsrfToken(sessionId);
        expect(validateCsrfToken(sessionId, token)).toBe(true);
    });

    test('returns false for wrong token', () => {
        const sessionId = 'session-wrong-token';
        generateCsrfToken(sessionId);
        expect(validateCsrfToken(sessionId, 'wrong-token-value')).toBe(false);
    });

    test('returns false for token from different session', () => {
        const token1 = generateCsrfToken('session-a');
        generateCsrfToken('session-b');
        expect(validateCsrfToken('session-b', token1)).toBe(false);
    });

    test('returns false for malformed token', () => {
        const sessionId = 'session-malformed';
        generateCsrfToken(sessionId);
        expect(validateCsrfToken(sessionId, 'not-hex!')).toBe(false);
        expect(validateCsrfToken(sessionId, '')).toBe(false);
    });
});

// ============================================================================
// clearCsrfToken TESTS
// ============================================================================

describe('clearCsrfToken', () => {
    test('removes token for session', () => {
        const sessionId = 'session-to-clear';
        const token = generateCsrfToken(sessionId);
        
        // Token is valid before clearing
        expect(validateCsrfToken(sessionId, token)).toBe(true);
        
        clearCsrfToken(sessionId);
        
        // Token is invalid after clearing
        expect(validateCsrfToken(sessionId, token)).toBe(false);
    });

    test('does not throw for non-existent session', () => {
        expect(() => clearCsrfToken('non-existent')).not.toThrow();
    });
});

// ============================================================================
// csrfProtection MIDDLEWARE TESTS
// ============================================================================

describe('csrfProtection', () => {
    test('skips GET requests', () => {
        const req = mockReq('GET', '/api/files');
        const res = mockRes();
        const next = jest.fn();
        
        csrfProtection(req, res, next);
        
        expect(next).toHaveBeenCalled();
        expect(res.status).not.toHaveBeenCalled();
    });

    test('skips HEAD requests', () => {
        const req = mockReq('HEAD', '/api/files');
        const res = mockRes();
        const next = jest.fn();
        
        csrfProtection(req, res, next);
        
        expect(next).toHaveBeenCalled();
    });

    test('skips OPTIONS requests', () => {
        const req = mockReq('OPTIONS', '/api/files');
        const res = mockRes();
        const next = jest.fn();
        
        csrfProtection(req, res, next);
        
        expect(next).toHaveBeenCalled();
    });

    test('skips /api/auth/* routes', () => {
        const req = mockReq('POST', '/api/auth/login');
        const res = mockRes();
        const next = jest.fn();
        
        csrfProtection(req, res, next);
        
        expect(next).toHaveBeenCalled();
    });

    test('skips /api/verify-session route', () => {
        const req = mockReq('POST', '/api/verify-session');
        const res = mockRes();
        const next = jest.fn();
        
        csrfProtection(req, res, next);
        
        expect(next).toHaveBeenCalled();
    });

    test('skips /api/active-backup/agent/* routes', () => {
        const req = mockReq('POST', '/api/active-backup/agent/register');
        const res = mockRes();
        const next = jest.fn();
        
        csrfProtection(req, res, next);
        
        expect(next).toHaveBeenCalled();
    });

    test('skips if no session ID (let auth middleware handle it)', () => {
        const req = mockReq('POST', '/api/files/upload', { sessionId: null });
        const res = mockRes();
        const next = jest.fn();
        
        csrfProtection(req, res, next);
        
        expect(next).toHaveBeenCalled();
    });

    test('returns 403 for missing CSRF token', () => {
        const sessionId = 'csrf-test-session-1';
        generateCsrfToken(sessionId);
        
        const req = mockReq('POST', '/api/files/delete', { 
            sessionId,
            csrfToken: null 
        });
        const res = mockRes();
        const next = jest.fn();
        
        csrfProtection(req, res, next);
        
        expect(res.statusCode).toBe(403);
        expect(res.body.code).toBe('CSRF_INVALID');
        expect(next).not.toHaveBeenCalled();
    });

    test('returns 403 for invalid CSRF token', () => {
        const sessionId = 'csrf-test-session-2';
        generateCsrfToken(sessionId);
        
        const req = mockReq('POST', '/api/files/delete', { 
            sessionId,
            csrfToken: 'invalid-token-value' 
        });
        const res = mockRes();
        const next = jest.fn();
        
        csrfProtection(req, res, next);
        
        expect(res.statusCode).toBe(403);
        expect(next).not.toHaveBeenCalled();
    });

    test('allows request with valid CSRF token', () => {
        const sessionId = 'csrf-test-session-3';
        const token = generateCsrfToken(sessionId);
        
        const req = mockReq('POST', '/api/files/delete', { 
            sessionId,
            csrfToken: token 
        });
        const res = mockRes();
        const next = jest.fn();
        
        csrfProtection(req, res, next);
        
        expect(next).toHaveBeenCalled();
        expect(res.status).not.toHaveBeenCalled();
    });

    test('validates PUT requests', () => {
        const sessionId = 'csrf-test-session-4';
        const token = generateCsrfToken(sessionId);
        
        const req = mockReq('PUT', '/api/users/update', { 
            sessionId,
            csrfToken: token 
        });
        const res = mockRes();
        const next = jest.fn();
        
        csrfProtection(req, res, next);
        
        expect(next).toHaveBeenCalled();
    });

    test('validates DELETE requests', () => {
        const sessionId = 'csrf-test-session-5';
        const token = generateCsrfToken(sessionId);
        
        const req = mockReq('DELETE', '/api/files/remove', { 
            sessionId,
            csrfToken: token 
        });
        const res = mockRes();
        const next = jest.fn();
        
        csrfProtection(req, res, next);
        
        expect(next).toHaveBeenCalled();
    });
});
