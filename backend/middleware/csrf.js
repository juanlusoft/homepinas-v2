/**
 * HomePiNAS v2 - CSRF Protection Middleware
 * Security audit 2026-02-04
 * 
 * Token-based CSRF protection for state-changing requests
 */

const crypto = require('crypto');

// Store CSRF tokens by session ID (in-memory, cleared on restart)
const csrfTokens = new Map();

// Token validity: 24 hours
const CSRF_TOKEN_DURATION = 24 * 60 * 60 * 1000;

/**
 * Generate a CSRF token for a session
 */
function generateCsrfToken(sessionId) {
    if (!sessionId) return null;
    
    const token = crypto.randomBytes(32).toString('hex');
    csrfTokens.set(sessionId, {
        token,
        createdAt: Date.now()
    });
    
    return token;
}

/**
 * Get existing CSRF token for a session (or generate new one)
 */
function getCsrfToken(sessionId) {
    if (!sessionId) return null;
    
    const existing = csrfTokens.get(sessionId);
    if (existing && Date.now() - existing.createdAt < CSRF_TOKEN_DURATION) {
        return existing.token;
    }
    
    return generateCsrfToken(sessionId);
}

/**
 * Validate CSRF token
 */
function validateCsrfToken(sessionId, token) {
    if (!sessionId || !token) return false;
    
    const stored = csrfTokens.get(sessionId);
    if (!stored) return false;
    
    // Check expiration
    if (Date.now() - stored.createdAt > CSRF_TOKEN_DURATION) {
        csrfTokens.delete(sessionId);
        return false;
    }
    
    // Timing-safe comparison
    try {
        return crypto.timingSafeEqual(
            Buffer.from(stored.token, 'hex'),
            Buffer.from(token, 'hex')
        );
    } catch (e) {
        return false;
    }
}

/**
 * Clear CSRF token for a session (on logout)
 */
function clearCsrfToken(sessionId) {
    csrfTokens.delete(sessionId);
}

/**
 * Middleware: validate CSRF token on state-changing requests
 * Skips: GET, HEAD, OPTIONS requests
 * Skips: /api/auth/* routes (login/logout don't need CSRF)
 * Skips: /api/active-backup/agent/* routes (agent API uses token auth)
 */
function csrfProtection(req, res, next) {
    // Skip safe methods
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
        return next();
    }
    
    // Skip auth routes (login doesn't have session yet)
    if (req.path.startsWith('/api/auth/')) {
        return next();
    }
    
    // Skip agent API (uses its own token auth)
    if (req.path.startsWith('/api/active-backup/agent/')) {
        return next();
    }
    
    // Get session ID and CSRF token from headers
    const sessionId = req.headers['x-session-id'];
    const csrfToken = req.headers['x-csrf-token'];
    
    // If no session, auth middleware will handle it
    if (!sessionId) {
        return next();
    }
    
    // Validate CSRF token
    if (!validateCsrfToken(sessionId, csrfToken)) {
        return res.status(403).json({ 
            error: 'Invalid or missing CSRF token',
            code: 'CSRF_INVALID'
        });
    }
    
    next();
}

/**
 * Cleanup expired tokens periodically
 */
function cleanExpiredCsrfTokens() {
    const now = Date.now();
    for (const [sessionId, data] of csrfTokens) {
        if (now - data.createdAt > CSRF_TOKEN_DURATION) {
            csrfTokens.delete(sessionId);
        }
    }
}

// Clean tokens every hour
setInterval(cleanExpiredCsrfTokens, 60 * 60 * 1000);

module.exports = {
    generateCsrfToken,
    getCsrfToken,
    validateCsrfToken,
    clearCsrfToken,
    csrfProtection
};
