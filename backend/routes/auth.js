/**
 * HomePiNAS - Authentication Routes
 * v1.5.6 - Modular Architecture
 *
 * User setup, login, logout
 */

const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const { spawn, execFileSync } = require('child_process');

const { authLimiter } = require('../middleware/rateLimit');
const { logSecurityEvent } = require('../utils/security');
const { getData, saveData } = require('../utils/data');
const { createSession, destroySession } = require('../utils/session');
const { validateUsername, validatePassword, sanitizeUsername } = require('../utils/sanitize');
const { getCsrfToken, clearCsrfToken } = require('../middleware/csrf');

const SALT_ROUNDS = 12;

/**
 * Create Samba user with same credentials (SECURE VERSION)
 */
async function createSambaUser(username, password) {
    const safeUsername = sanitizeUsername(username);
    if (!safeUsername) {
        console.error('Invalid username format for Samba user');
        return false;
    }

    try {
        // Check if system user exists
        try {
            execFileSync('id', [safeUsername], { encoding: 'utf8' });
        } catch (e) {
            execFileSync('sudo', ['useradd', '-M', '-s', '/sbin/nologin', safeUsername], { encoding: 'utf8' });
        }

        // Add user to sambashare group
        execFileSync('sudo', ['usermod', '-aG', 'sambashare', safeUsername], { encoding: 'utf8' });

        // Set Samba password using stdin (password never visible in process list)
        await new Promise((resolve, reject) => {
            const smbpasswd = spawn('sudo', ['smbpasswd', '-a', '-s', safeUsername], {
                stdio: ['pipe', 'pipe', 'pipe']
            });

            smbpasswd.stdin.write(password + '\n');
            smbpasswd.stdin.write(password + '\n');
            smbpasswd.stdin.end();

            let stderr = '';
            smbpasswd.stderr.on('data', (data) => { stderr += data.toString(); });

            smbpasswd.on('close', (code) => {
                if (code === 0) resolve();
                else reject(new Error(`smbpasswd failed: ${stderr}`));
            });

            smbpasswd.on('error', reject);
        });

        // Enable the Samba user
        execFileSync('sudo', ['smbpasswd', '-e', safeUsername], { encoding: 'utf8' });

        // Set ownership of storage pool directory
        try {
            execFileSync('sudo', ['chown', '-R', `${safeUsername}:sambashare`, '/mnt/storage'], { encoding: 'utf8' });
            execFileSync('sudo', ['chmod', '-R', '2775', '/mnt/storage'], { encoding: 'utf8' });
        } catch (e) {}

        // Restart Samba
        execFileSync('sudo', ['systemctl', 'restart', 'smbd'], { encoding: 'utf8' });
        execFileSync('sudo', ['systemctl', 'restart', 'nmbd'], { encoding: 'utf8' });

        console.log(`Samba user ${safeUsername} created successfully`);
        return true;
    } catch (e) {
        console.error('Failed to create Samba user:', e.message);
        return false;
    }
}

// Initial setup - create admin account
router.post('/setup', authLimiter, async (req, res) => {
    try {
        const { username, password } = req.body;

        if (!validateUsername(username)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid username. Must be 3-32 characters, alphanumeric with _ or -'
            });
        }

        if (!validatePassword(password)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid password. Must be 6-128 characters'
            });
        }

        const data = getData();

        if (data.user) {
            logSecurityEvent('SETUP_ATTEMPT_EXISTS', { username }, req.ip);
            return res.status(400).json({
                success: false,
                message: 'Admin account already exists. Reset first to create new account.'
            });
        }

        const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
        data.user = { username, password: hashedPassword };
        saveData(data);

        const sambaCreated = await createSambaUser(username, password);
        if (sambaCreated) {
            logSecurityEvent('SAMBA_USER_CREATED', { username }, req.ip);
        }

        logSecurityEvent('ADMIN_CREATED', { username }, req.ip);

        const sessionId = createSession(username);
        const csrfToken = getCsrfToken(sessionId);

        res.json({
            success: true,
            message: 'Admin account created' + (sambaCreated ? ' with SMB access' : ''),
            sessionId,
            csrfToken,
            user: { username },
            sambaEnabled: sambaCreated
        });
    } catch (e) {
        console.error('Setup error:', e);
        res.status(500).json({ success: false, message: 'Setup failed' });
    }
});

// Login
router.post('/login', authLimiter, async (req, res) => {
    try {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({ success: false, message: 'Username and password required' });
        }

        const data = getData();

        if (!data.user) {
            // SECURITY: Still do a bcrypt compare to prevent timing attacks
            // This ensures response time is similar whether user exists or not
            await bcrypt.compare(password, '$2b$12$invalid.hash.placeholder.for.timing.attack.prevention');
            logSecurityEvent('LOGIN_NO_USER', { username: '[REDACTED]' }, req.ip);
            return res.status(401).json({ success: false, message: 'Invalid credentials' });
        }

        // SECURITY: Always compare password first to ensure constant-time response
        const isPasswordValid = await bcrypt.compare(password, data.user.password);

        // SECURITY: Use timing-safe comparison for username
        const crypto = require('crypto');
        const usernameBuffer = Buffer.from(username);
        const storedUsernameBuffer = Buffer.from(data.user.username);
        
        // Pad to same length to prevent length-based timing attacks
        const maxLen = Math.max(usernameBuffer.length, storedUsernameBuffer.length);
        const paddedInput = Buffer.alloc(maxLen, 0);
        const paddedStored = Buffer.alloc(maxLen, 0);
        usernameBuffer.copy(paddedInput);
        storedUsernameBuffer.copy(paddedStored);
        
        const isUsernameValid = crypto.timingSafeEqual(paddedInput, paddedStored) && 
                                usernameBuffer.length === storedUsernameBuffer.length;

        if (isUsernameValid && isPasswordValid) {
            const sessionId = createSession(username);
            const csrfToken = getCsrfToken(sessionId);
            logSecurityEvent('LOGIN_SUCCESS', { username }, req.ip);
            res.json({
                success: true,
                sessionId,
                csrfToken,
                user: { username: data.user.username }
            });
        } else {
            logSecurityEvent('LOGIN_FAILED', { username: '[REDACTED]' }, req.ip);
            res.status(401).json({ success: false, message: 'Invalid credentials' });
        }
    } catch (e) {
        console.error('Login error:', e);
        res.status(500).json({ success: false, message: 'Login failed' });
    }
});

// Logout
router.post('/logout', (req, res) => {
    const sessionId = req.headers['x-session-id'];
    if (sessionId) {
        destroySession(sessionId);
        clearCsrfToken(sessionId);
        logSecurityEvent('LOGOUT', {}, req.ip);
    }
    res.json({ success: true });
});

module.exports = router;
