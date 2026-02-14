/**
 * HomePiNAS - Auth Middleware Tests
 * Tests for authentication middleware
 */

// Mock dependencies before requiring the module
jest.mock('../../utils/session', () => ({
    validateSession: jest.fn()
}));

jest.mock('../../utils/security', () => ({
    logSecurityEvent: jest.fn()
}));

const { requireAuth } = require('../../middleware/auth');
const { validateSession } = require('../../utils/session');
const { logSecurityEvent } = require('../../utils/security');

// Mock request/response helpers
function mockReq(sessionId) {
    return {
        headers: {
            'x-session-id': sessionId
        },
        query: {},
        path: '/api/test',
        ip: '192.168.1.100'
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
// requireAuth TESTS
// ============================================================================

describe('requireAuth', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('returns 401 when no session ID provided', () => {
        validateSession.mockReturnValue(null);
        
        const req = mockReq(null);
        const res = mockRes();
        const next = jest.fn();
        
        requireAuth(req, res, next);
        
        expect(res.statusCode).toBe(401);
        expect(res.body.error).toContain('Authentication required');
        expect(next).not.toHaveBeenCalled();
    });

    test('returns 401 when session is invalid', () => {
        validateSession.mockReturnValue(null);
        
        const req = mockReq('invalid-session-id');
        const res = mockRes();
        const next = jest.fn();
        
        requireAuth(req, res, next);
        
        expect(res.statusCode).toBe(401);
        expect(next).not.toHaveBeenCalled();
    });

    test('logs security event on unauthorized access', () => {
        validateSession.mockReturnValue(null);
        
        const req = mockReq('invalid-session');
        req.path = '/api/sensitive/data';
        const res = mockRes();
        const next = jest.fn();
        
        requireAuth(req, res, next);
        
        expect(logSecurityEvent).toHaveBeenCalledWith(
            'UNAUTHORIZED_ACCESS',
            { path: '/api/sensitive/data' },
            '192.168.1.100'
        );
    });

    test('calls next with valid session', () => {
        const mockSession = {
            username: 'john',
            role: 'admin',
            sessionId: 'valid-session-123'
        };
        validateSession.mockReturnValue(mockSession);
        
        const req = mockReq('valid-session-123');
        const res = mockRes();
        const next = jest.fn();
        
        requireAuth(req, res, next);
        
        expect(next).toHaveBeenCalled();
        expect(res.status).not.toHaveBeenCalled();
    });

    test('attaches session to request', () => {
        const mockSession = {
            username: 'jane',
            role: 'user',
            sessionId: 'session-456'
        };
        validateSession.mockReturnValue(mockSession);
        
        const req = mockReq('session-456');
        const res = mockRes();
        const next = jest.fn();
        
        requireAuth(req, res, next);
        
        expect(req.user).toEqual(mockSession);
        expect(req.user.username).toBe('jane');
        expect(req.user.role).toBe('user');
    });

    test('passes session ID from header to validateSession', () => {
        validateSession.mockReturnValue(null);
        
        const req = mockReq('my-session-id-xyz');
        const res = mockRes();
        const next = jest.fn();
        
        requireAuth(req, res, next);
        
        expect(validateSession).toHaveBeenCalledWith('my-session-id-xyz');
    });
});
