/**
 * HomePiNAS - RBAC Middleware Tests
 * Tests for Role-Based Access Control
 */

const {
    PERMISSIONS,
    getUserRole,
    getUserPermissions,
    requirePermission,
    requireAdmin,
    hasPermission
} = require('../../middleware/rbac');

// Mock getData
jest.mock('../../utils/data', () => ({
    getData: jest.fn()
}));

const { getData } = require('../../utils/data');

// Mock request/response helpers
function mockReq(username) {
    return {
        user: username ? { username } : null
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
// PERMISSIONS CONSTANT TESTS
// ============================================================================

describe('PERMISSIONS', () => {
    test('admin has all permissions', () => {
        expect(PERMISSIONS.admin).toContain('read');
        expect(PERMISSIONS.admin).toContain('write');
        expect(PERMISSIONS.admin).toContain('delete');
        expect(PERMISSIONS.admin).toContain('admin');
    });

    test('user has read/write/delete but not admin', () => {
        expect(PERMISSIONS.user).toContain('read');
        expect(PERMISSIONS.user).toContain('write');
        expect(PERMISSIONS.user).toContain('delete');
        expect(PERMISSIONS.user).not.toContain('admin');
    });

    test('readonly only has read', () => {
        expect(PERMISSIONS.readonly).toEqual(['read']);
    });
});

// ============================================================================
// getUserRole TESTS
// ============================================================================

describe('getUserRole', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('returns admin for primary user', () => {
        getData.mockReturnValue({
            user: { username: 'primaryadmin' },
            users: []
        });
        
        expect(getUserRole('primaryadmin')).toBe('admin');
    });

    test('returns role from multi-user list', () => {
        getData.mockReturnValue({
            user: { username: 'primaryadmin' },
            users: [
                { username: 'john', role: 'user' },
                { username: 'jane', role: 'readonly' }
            ]
        });
        
        expect(getUserRole('john')).toBe('user');
        expect(getUserRole('jane')).toBe('readonly');
    });

    test('returns readonly for unknown users', () => {
        getData.mockReturnValue({
            user: { username: 'primaryadmin' },
            users: []
        });
        
        expect(getUserRole('unknown')).toBe('readonly');
    });

    test('handles case-insensitive username lookup', () => {
        getData.mockReturnValue({
            user: { username: 'admin' },
            users: [
                { username: 'John', role: 'user' }
            ]
        });
        
        expect(getUserRole('john')).toBe('user');
        expect(getUserRole('JOHN')).toBe('user');
    });

    test('handles missing user data gracefully', () => {
        getData.mockReturnValue({});
        
        expect(getUserRole('anyone')).toBe('readonly');
    });
});

// ============================================================================
// getUserPermissions TESTS
// ============================================================================

describe('getUserPermissions', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('returns correct permissions for admin', () => {
        getData.mockReturnValue({
            user: { username: 'admin' },
            users: []
        });
        
        const perms = getUserPermissions('admin');
        expect(perms).toEqual(PERMISSIONS.admin);
    });

    test('returns correct permissions for user role', () => {
        getData.mockReturnValue({
            user: { username: 'admin' },
            users: [{ username: 'john', role: 'user' }]
        });
        
        const perms = getUserPermissions('john');
        expect(perms).toEqual(PERMISSIONS.user);
    });

    test('returns readonly permissions for unknown users', () => {
        getData.mockReturnValue({
            user: { username: 'admin' },
            users: []
        });
        
        const perms = getUserPermissions('stranger');
        expect(perms).toEqual(PERMISSIONS.readonly);
    });
});

// ============================================================================
// hasPermission TESTS
// ============================================================================

describe('hasPermission', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('returns true when user has permission', () => {
        getData.mockReturnValue({
            user: { username: 'admin' },
            users: []
        });
        
        expect(hasPermission('admin', 'admin')).toBe(true);
        expect(hasPermission('admin', 'read')).toBe(true);
    });

    test('returns false when user lacks permission', () => {
        getData.mockReturnValue({
            user: { username: 'admin' },
            users: [{ username: 'viewer', role: 'readonly' }]
        });
        
        expect(hasPermission('viewer', 'write')).toBe(false);
        expect(hasPermission('viewer', 'delete')).toBe(false);
        expect(hasPermission('viewer', 'admin')).toBe(false);
    });

    test('readonly users can only read', () => {
        getData.mockReturnValue({
            user: { username: 'admin' },
            users: [{ username: 'guest', role: 'readonly' }]
        });
        
        expect(hasPermission('guest', 'read')).toBe(true);
        expect(hasPermission('guest', 'write')).toBe(false);
    });
});

// ============================================================================
// requirePermission MIDDLEWARE TESTS
// ============================================================================

describe('requirePermission', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('returns 401 when not authenticated', () => {
        const middleware = requirePermission('read');
        const req = mockReq(null);
        const res = mockRes();
        const next = jest.fn();
        
        middleware(req, res, next);
        
        expect(res.statusCode).toBe(401);
        expect(res.body.error).toContain('Authentication required');
        expect(next).not.toHaveBeenCalled();
    });

    test('returns 403 when permission denied', () => {
        getData.mockReturnValue({
            user: { username: 'admin' },
            users: [{ username: 'viewer', role: 'readonly' }]
        });
        
        const middleware = requirePermission('write');
        const req = mockReq('viewer');
        const res = mockRes();
        const next = jest.fn();
        
        middleware(req, res, next);
        
        expect(res.statusCode).toBe(403);
        expect(res.body.error).toContain('Permission denied');
        expect(next).not.toHaveBeenCalled();
    });

    test('calls next when permission granted', () => {
        getData.mockReturnValue({
            user: { username: 'admin' },
            users: []
        });
        
        const middleware = requirePermission('admin');
        const req = mockReq('admin');
        const res = mockRes();
        const next = jest.fn();
        
        middleware(req, res, next);
        
        expect(next).toHaveBeenCalled();
        expect(req.user.role).toBe('admin');
        expect(req.user.permissions).toEqual(PERMISSIONS.admin);
    });

    test('attaches role and permissions to request', () => {
        getData.mockReturnValue({
            user: { username: 'admin' },
            users: [{ username: 'editor', role: 'user' }]
        });
        
        const middleware = requirePermission('write');
        const req = mockReq('editor');
        const res = mockRes();
        const next = jest.fn();
        
        middleware(req, res, next);
        
        expect(req.user.role).toBe('user');
        expect(req.user.permissions).toEqual(PERMISSIONS.user);
    });
});

// ============================================================================
// requireAdmin MIDDLEWARE TESTS
// ============================================================================

describe('requireAdmin', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('allows admin users', () => {
        getData.mockReturnValue({
            user: { username: 'superadmin' },
            users: []
        });
        
        const req = mockReq('superadmin');
        const res = mockRes();
        const next = jest.fn();
        
        requireAdmin(req, res, next);
        
        expect(next).toHaveBeenCalled();
    });

    test('blocks non-admin users', () => {
        getData.mockReturnValue({
            user: { username: 'admin' },
            users: [{ username: 'regular', role: 'user' }]
        });
        
        const req = mockReq('regular');
        const res = mockRes();
        const next = jest.fn();
        
        requireAdmin(req, res, next);
        
        expect(res.statusCode).toBe(403);
        expect(next).not.toHaveBeenCalled();
    });
});
