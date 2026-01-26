/**
 * HomePiNAS - Authentication Middleware
 * v1.5.6 - Modular Architecture
 */

const { validateSession } = require('../utils/session');
const { logSecurityEvent } = require('../utils/security');

/**
 * Require authentication middleware
 */
function requireAuth(req, res, next) {
    const sessionId = req.headers['x-session-id'];
    const session = validateSession(sessionId);

    if (!session) {
        logSecurityEvent('UNAUTHORIZED_ACCESS', { path: req.path }, req.ip);
        return res.status(401).json({ error: 'Authentication required' });
    }

    req.user = session;
    next();
}

module.exports = {
    requireAuth
};
