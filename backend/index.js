/**
 * HomePiNAS - Premium NAS Dashboard for Raspberry Pi CM5
 * v2.1.0 - Extended Features
 *
 * Homelabs.club Edition with:
 * - Bcrypt password hashing
 * - SQLite-backed persistent sessions
 * - Rate limiting protection
 * - Input sanitization
 * - Restricted sudoers
 * - HTTPS support
 * - Fan hysteresis
 * - Docker Compose management
 * - Container update detection
 * - Web Terminal (PTY + xterm.js)
 * - Configurable Shortcuts
 * - Internationalization (i18n)
 * - Enhanced Storage View
 */

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const helmet = require('helmet');

// Import utilities
const { initSessionDb, startSessionCleanup } = require('./utils/session');

// Import middleware
const { generalLimiter } = require('./middleware/rateLimit');

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

// Import terminal WebSocket handler
let setupTerminalWebSocket;
try {
    setupTerminalWebSocket = require('./utils/terminal-ws').setupTerminalWebSocket;
} catch (e) {
    console.warn('[WARN] Terminal WebSocket not available - node-pty may not be installed');
    setupTerminalWebSocket = null;
}

// Configuration
const VERSION = '2.3.0';
const HTTPS_PORT = process.env.HTTPS_PORT || 3001;
const HTTP_PORT = process.env.HTTP_PORT || 3000;
const SSL_CERT_PATH = path.join(__dirname, 'certs', 'server.crt');
const SSL_KEY_PATH = path.join(__dirname, 'certs', 'server.key');

// Initialize Express app
const app = express();

// Initialize session database
initSessionDb();
startSessionCleanup();

// Ensure config directory exists
const configDir = path.join(__dirname, 'config');
if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
}

// =============================================================================
// MIDDLEWARE
// =============================================================================

// Security headers (configured for local network with improved security)
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'"], // Needed for some inline scripts
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
            fontSrc: ["'self'", "https://fonts.gstatic.com"],
            imgSrc: ["'self'", "data:"],
            connectSrc: ["'self'"],
            frameAncestors: ["'none'"], // Prevent clickjacking
        },
    },
    hsts: false, // Disabled for local network (self-signed certs)
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: false,
    crossOriginResourcePolicy: { policy: "same-origin" },
    originAgentCluster: false,
    xFrameOptions: { action: "deny" }, // Additional clickjacking protection
}));

// CORS - Configured for local network NAS with origin validation
// SECURITY: Restrict to same-origin and local network patterns
app.use(cors({
    origin: function(origin, callback) {
        // Allow requests with no origin (same-origin, mobile apps, curl, etc.)
        if (!origin) return callback(null, true);
        
        // Allow local network IPs and localhost
        const allowedPatterns = [
            /^https?:\/\/localhost(:\d+)?$/,
            /^https?:\/\/127\.0\.0\.1(:\d+)?$/,
            /^https?:\/\/192\.168\.\d{1,3}\.\d{1,3}(:\d+)?$/,
            /^https?:\/\/10\.\d{1,3}\.\d{1,3}\.\d{1,3}(:\d+)?$/,
            /^https?:\/\/172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}(:\d+)?$/,
            /^https?:\/\/\[::1\](:\d+)?$/,
        ];
        
        const isAllowed = allowedPatterns.some(pattern => pattern.test(origin));
        if (isAllowed) {
            callback(null, true);
        } else {
            console.warn(`CORS blocked origin: ${origin}`);
            callback(new Error('CORS not allowed'));
        }
    },
    credentials: true,
}));

// Rate limiting
app.use(generalLimiter);

// Body parsing
app.use(express.json({ limit: '10kb' }));

// =============================================================================
// STATIC FILES
// =============================================================================

// Serve frontend files
app.use(express.static(path.join(__dirname, '../')));
app.use('/frontend', express.static(path.join(__dirname, '../frontend')));

// Serve i18n files
app.use('/frontend/i18n', express.static(path.join(__dirname, '../frontend/i18n')));

// SPA routes - serve index.html for frontend views
const spaRoutes = ['/', '/dashboard', '/docker', '/storage', '/files', '/network', '/system', '/terminal', '/shortcuts', '/backup', '/logs', '/users'];
spaRoutes.forEach(route => {
    app.get(route, (req, res) => {
        res.sendFile(path.join(__dirname, '../index.html'));
    });
});

// =============================================================================
// API ROUTES
// =============================================================================

// System routes (stats, fans, disks, status)
app.use('/api/system', systemRoutes);

// Storage routes (pool, snapraid)
app.use('/api/storage', storageRoutes);

// Docker routes
app.use('/api/docker', dockerRoutes);

// Authentication routes (setup, login, logout)
app.use('/api', authRoutes);

// Network routes
app.use('/api/network', networkRoutes);

// Power routes (reset, reboot, shutdown)
app.use('/api/system', powerRoutes);

// Update routes (check, apply)
app.use('/api/update', updateRoutes);

// Terminal routes (PTY sessions)
app.use('/api/terminal', terminalRoutes);

// Shortcuts routes (configurable program shortcuts)
app.use('/api/shortcuts', shortcutsRoutes);

// File Manager routes (File Station)
app.use('/api/files', filesRoutes);

// User Management routes
app.use('/api/users', usersRoutes);

// Samba Share Management routes
app.use('/api/samba', sambaRoutes);

// Notification routes (email + Telegram)
app.use('/api/notifications', notificationsRoutes);

// TOTP 2FA routes
app.use('/api/totp', totpRoutes);

// Log Viewer routes
app.use('/api/logs', logsRoutes);

// Backup Management routes
app.use('/api/backup', backupRoutes);

// Task Scheduler routes
app.use('/api/scheduler', schedulerRoutes);

// UPS Monitor routes
app.use('/api/ups', upsRoutes);

// Dynamic DNS routes
app.use('/api/ddns', ddnsRoutes);

// =============================================================================
// SERVER STARTUP
// =============================================================================

console.log(`
╔═══════════════════════════════════════════════════════════╗
║                    HomePiNAS v${VERSION}                      ║
║           Premium NAS Dashboard for Raspberry Pi          ║
║                   Homelabs.club Edition                   ║
╚═══════════════════════════════════════════════════════════╝
`);

// Start HTTPS server if certificates exist
let httpsServer = null;
if (fs.existsSync(SSL_CERT_PATH) && fs.existsSync(SSL_KEY_PATH)) {
    try {
        const sslOptions = {
            key: fs.readFileSync(SSL_KEY_PATH),
            cert: fs.readFileSync(SSL_CERT_PATH)
        };
        httpsServer = https.createServer(sslOptions, app);
        httpsServer.listen(HTTPS_PORT, '0.0.0.0', () => {
            console.log(`[HTTPS] Secure server running on https://0.0.0.0:${HTTPS_PORT}`);
        });
    } catch (e) {
        console.error('[HTTPS] Failed to start:', e.message);
    }
}

// Always start HTTP server
const httpServer = http.createServer(app);
httpServer.listen(HTTP_PORT, '0.0.0.0', () => {
    console.log(`[HTTP]  Server running on http://0.0.0.0:${HTTP_PORT}`);
    if (httpsServer) {
        console.log('\n[INFO]  Recommended: Use HTTPS on port ' + HTTPS_PORT + ' for secure access');
    } else {
        console.log('\n[WARN]  HTTPS not configured. Run install.sh to generate SSL certificates.');
    }
    console.log('\n[INFO]  Modular architecture loaded:');
    console.log('        - routes/system.js         (stats, fans, disks)');
    console.log('        - routes/storage.js        (pool, snapraid)');
    console.log('        - routes/docker.js         (containers)');
    console.log('        - routes/auth.js           (login, setup)');
    console.log('        - routes/network.js        (interfaces)');
    console.log('        - routes/power.js          (reboot, shutdown)');
    console.log('        - routes/update.js         (OTA updates)');
    console.log('        - routes/terminal.js       (web terminal)');
    console.log('        - routes/shortcuts.js      (custom shortcuts)');
    console.log('        - routes/files.js          (file manager)');
    console.log('        - routes/users.js          (user management)');
    console.log('        - routes/samba.js          (samba shares)');
    console.log('        - routes/notifications.js  (email/telegram)');
    console.log('        - routes/totp.js           (2FA)');
    console.log('        - routes/logs.js           (log viewer)');
    console.log('        - routes/backup.js         (backup jobs)');
    console.log('        - routes/scheduler.js      (task scheduler)');
    console.log('        - routes/ups.js            (UPS monitor)');
    console.log('        - routes/ddns.js           (dynamic DNS)');
    console.log('');
    
    // Setup Terminal WebSocket on HTTP server
    if (setupTerminalWebSocket) {
        try {
            setupTerminalWebSocket(httpServer);
            console.log('[WS]    Terminal WebSocket available at /api/terminal/ws');
        } catch (e) {
            console.warn('[WARN]  Terminal WebSocket setup failed:', e.message);
        }
    }
});

// Setup Terminal WebSocket on HTTPS server if available
if (httpsServer && setupTerminalWebSocket) {
    try {
        setupTerminalWebSocket(httpsServer);
    } catch (e) {
        console.warn('[WARN]  Terminal WebSocket (HTTPS) setup failed:', e.message);
    }
}

module.exports = app;
