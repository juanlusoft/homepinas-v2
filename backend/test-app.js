/**
 * HomePiNAS - Test App Wrapper
 * 
 * This wrapper exports the Express app without starting the HTTP/HTTPS servers.
 * Used for integration testing with supertest.
 * 
 * NOTE: This is a minimal setup for testing - some features may not work:
 * - WebSocket terminal connections
 * - SSL certificate generation
 * - System directories that require sudo
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const helmet = require('helmet');

// Set test environment flag to prevent certain initialization
process.env.NODE_ENV = process.env.NODE_ENV || 'test';

// Import utilities - with fallback to mock for test environment
let sessionUtils;
try {
    sessionUtils = require('./utils/session');
    
    // Try to initialize real session database
    try {
        sessionUtils.initSessionDb();
        console.log('[TEST] Using real session database');
    } catch (e) {
        console.warn('[TEST] Real session DB failed, using mock:', e.message);
        // Fall back to mock
        sessionUtils = require('./utils/session-mock');
        sessionUtils.initSessionDb();
    }
} catch (e) {
    console.warn('[TEST] Session utilities not available, using mock');
    sessionUtils = require('./utils/session-mock');
    sessionUtils.initSessionDb();
}

// Export session functions so routes can use them
// This overrides the real session module when in test mode
if (process.env.NODE_ENV === 'test' || process.env.TEST_MODE === 'true') {
    // Monkey-patch the session module to use our mock
    require.cache[require.resolve('./utils/session')] = {
        id: require.resolve('./utils/session'),
        filename: require.resolve('./utils/session'),
        loaded: true,
        exports: sessionUtils
    };
}

// Import middleware
const { generalLimiter } = require('./middleware/rateLimit');
const { csrfProtection } = require('./middleware/csrf');

// Import routes
const systemRoutes = require('./routes/system');
const storageRoutes = require('./routes/storage');
const dockerRoutes = require('./routes/docker');
const authRoutes = require('./routes/auth');
const networkRoutes = require('./routes/network');
const powerRoutes = require('./routes/power');
const updateRoutes = require('./routes/update');
const terminalRoutes = require('./routes/terminal');
const shortcutsRoutes = require('./routes/shortcuts');
const filesRoutes = require('./routes/files');
const usersRoutes = require('./routes/users');
const sambaRoutes = require('./routes/samba');
const notificationsRoutes = require('./routes/notifications');
const totpRoutes = require('./routes/totp');
const logsRoutes = require('./routes/logs');
const backupRoutes = require('./routes/backup');
const schedulerRoutes = require('./routes/scheduler');
const upsRoutes = require('./routes/ups');
const ddnsRoutes = require('./routes/ddns');
const activeBackupRoutes = require('./routes/active-backup');
const cloudSyncRoutes = require('./routes/cloud-sync');
const cloudBackupRoutes = require('./routes/cloud-backup');

// Optional routes that may fail in test environment
let homestoreRoutes, stacksRoutes, activeDirectoryRoutes;
try {
    homestoreRoutes = require('./routes/homestore');
} catch (e) {
    console.warn('[TEST] Homestore routes not loaded:', e.message);
}

try {
    // Stacks route creates /opt/homepinas at module load time - skip in test
    if (process.env.NODE_ENV !== 'test') {
        stacksRoutes = require('./routes/stacks');
    }
} catch (e) {
    console.warn('[TEST] Stacks routes not loaded:', e.message);
}

try {
    activeDirectoryRoutes = require('./routes/active-directory');
} catch (e) {
    console.warn('[TEST] Active Directory routes not loaded:', e.message);
}

// Initialize Express app
const app = express();

// =============================================================================
// MIDDLEWARE
// =============================================================================

// Security headers (simplified for testing)
app.use(helmet({
    contentSecurityPolicy: false,
    hsts: false,
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: false,
    crossOriginResourcePolicy: false,
}));

// CORS - Allow all origins in test
app.use(cors({
    origin: true,
    credentials: true,
}));

// Rate limiting (disabled or very permissive in test)
// app.use(generalLimiter);

// Body parsing
app.use(express.json({ limit: '5mb' }));

// CSRF protection
app.use(csrfProtection);

// =============================================================================
// API ROUTES
// =============================================================================

// Core routes
app.use('/api/system', systemRoutes);
app.use('/api/storage', storageRoutes);
app.use('/api/docker', dockerRoutes);
app.use('/api', authRoutes);
app.use('/api/network', networkRoutes);
app.use('/api/power', powerRoutes);
app.use('/api/update', updateRoutes);
app.use('/api/terminal', terminalRoutes);
app.use('/api/shortcuts', shortcutsRoutes);
app.use('/api/files', filesRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/samba', sambaRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/totp', totpRoutes);
app.use('/api/logs', logsRoutes);
app.use('/api/backup', backupRoutes);
app.use('/api/scheduler', schedulerRoutes);
app.use('/api/ups', upsRoutes);
app.use('/api/ddns', ddnsRoutes);
app.use('/api/active-backup', activeBackupRoutes);
app.use('/api/cloud-sync', cloudSyncRoutes);
app.use('/api/cloud-backup', cloudBackupRoutes);

// Optional routes (only if loaded)
if (homestoreRoutes) app.use('/api/homestore', homestoreRoutes);
if (stacksRoutes) app.use('/api/stacks', stacksRoutes);
if (activeDirectoryRoutes) app.use('/api/ad', activeDirectoryRoutes);

// =============================================================================
// GLOBAL ERROR HANDLER
// =============================================================================

app.use((err, req, res, next) => {
    console.error(`[TEST ERROR] ${req.method} ${req.path}:`, err.message);
    res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

// Export app without starting servers
module.exports = app;
