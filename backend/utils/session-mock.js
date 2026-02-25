/**
 * HomePiNAS - In-Memory Session Mock for Testing
 * 
 * Provides a simple in-memory session store when better-sqlite3 is not available.
 * This is ONLY for testing - do NOT use in production!
 */

const crypto = require('crypto');

// In-memory session storage
const sessions = new Map();

// Session expiry time (30 days)
const SESSION_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Initialize session database (no-op for mock)
 */
function initSessionDb() {
    console.log('[SESSION MOCK] Using in-memory session store for testing');
    return true;
}

/**
 * Start session cleanup (no-op for mock, could add interval cleanup if needed)
 */
function startSessionCleanup() {
    // Clean up expired sessions every 5 minutes
    setInterval(() => {
        const now = Date.now();
        for (const [sessionId, session] of sessions.entries()) {
            if (session.expires < now) {
                sessions.delete(sessionId);
            }
        }
    }, 5 * 60 * 1000);
}

/**
 * Create a new session
 */
function createSession(username, ip, userAgent) {
    const sessionId = crypto.randomBytes(32).toString('hex');
    const now = Date.now();
    const expires = now + SESSION_EXPIRY_MS;

    sessions.set(sessionId, {
        sessionId,
        username,
        ip,
        userAgent: userAgent || '',
        createdAt: now,
        lastActivity: now,
        expires
    });

    return sessionId;
}

/**
 * Get session by ID
 */
function getSession(sessionId) {
    if (!sessionId) return null;
    
    const session = sessions.get(sessionId);
    if (!session) return null;

    // Check if expired
    if (session.expires < Date.now()) {
        sessions.delete(sessionId);
        return null;
    }

    // Update last activity
    session.lastActivity = Date.now();
    
    return session;
}

/**
 * Destroy a session
 */
function destroySession(sessionId) {
    return sessions.delete(sessionId);
}

/**
 * Update session activity timestamp
 */
function updateSessionActivity(sessionId) {
    const session = sessions.get(sessionId);
    if (session) {
        session.lastActivity = Date.now();
        return true;
    }
    return false;
}

/**
 * Get all sessions for a user
 */
function getUserSessions(username) {
    const userSessions = [];
    for (const session of sessions.values()) {
        if (session.username === username) {
            userSessions.push(session);
        }
    }
    return userSessions;
}

/**
 * Destroy all sessions for a user
 */
function destroyUserSessions(username) {
    let count = 0;
    for (const [sessionId, session] of sessions.entries()) {
        if (session.username === username) {
            sessions.delete(sessionId);
            count++;
        }
    }
    return count;
}

module.exports = {
    initSessionDb,
    startSessionCleanup,
    createSession,
    getSession,
    destroySession,
    updateSessionActivity,
    getUserSessions,
    destroyUserSessions
};
