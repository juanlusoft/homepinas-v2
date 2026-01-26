/**
 * HomePiNAS - Update Routes
 * v1.5.7 - OTA Updates
 *
 * System update from GitHub repository
 */

const express = require('express');
const router = express.Router();
const { exec, execSync } = require('child_process');
const path = require('path');

const { requireAuth } = require('../middleware/auth');
const { criticalLimiter } = require('../middleware/rateLimit');
const { logSecurityEvent } = require('../utils/security');

const INSTALL_DIR = '/opt/homepinas';
const REPO_URL = 'https://github.com/juanlusoft/homepinas-v2.git';

// Check for updates
router.get('/check', requireAuth, async (req, res) => {
    try {
        // Get current local version
        const packageJson = require(path.join(INSTALL_DIR, 'package.json'));
        const currentVersion = packageJson.version;

        // Fetch latest version from GitHub
        let latestVersion = currentVersion;
        let updateAvailable = false;
        let changelog = '';

        try {
            // Fetch remote tags/version
            const remoteInfo = execSync(
                `cd ${INSTALL_DIR} && git fetch origin --quiet && git log HEAD..origin/main --oneline 2>/dev/null | head -5`,
                { encoding: 'utf8', timeout: 30000 }
            ).trim();

            if (remoteInfo) {
                updateAvailable = true;
                changelog = remoteInfo;

                // Try to get latest version from remote package.json
                try {
                    const remotePackage = execSync(
                        `cd ${INSTALL_DIR} && git show origin/main:package.json 2>/dev/null`,
                        { encoding: 'utf8', timeout: 10000 }
                    );
                    const remotePkg = JSON.parse(remotePackage);
                    latestVersion = remotePkg.version;
                } catch (e) {
                    // Can't get remote version, that's ok
                }
            }
        } catch (e) {
            // Git fetch failed, maybe no internet
            console.error('Update check failed:', e.message);
        }

        res.json({
            currentVersion,
            latestVersion,
            updateAvailable,
            changelog,
            installDir: INSTALL_DIR
        });
    } catch (e) {
        console.error('Update check error:', e);
        res.status(500).json({ error: 'Failed to check for updates' });
    }
});

// Perform update
router.post('/apply', requireAuth, criticalLimiter, async (req, res) => {
    logSecurityEvent('UPDATE_STARTED', { user: req.user.username }, req.ip);

    // Send response immediately, update will happen in background
    res.json({
        success: true,
        message: 'Update started. The service will restart automatically. Please wait 30 seconds and refresh the page.'
    });

    // Perform update in background after response is sent
    setTimeout(async () => {
        try {
            console.log('[UPDATE] Starting system update...');

            // 1. Pull latest changes
            console.log('[UPDATE] Pulling latest changes from GitHub...');
            execSync(`cd ${INSTALL_DIR} && git fetch origin && git reset --hard origin/main`, {
                encoding: 'utf8',
                timeout: 60000
            });

            // 2. Install/update dependencies
            console.log('[UPDATE] Installing dependencies...');
            execSync(`cd ${INSTALL_DIR} && npm install --production`, {
                encoding: 'utf8',
                timeout: 120000
            });

            // 3. Restart service
            console.log('[UPDATE] Restarting HomePiNAS service...');
            exec('sudo systemctl restart homepinas', (error) => {
                if (error) {
                    console.error('[UPDATE] Restart failed:', error.message);
                } else {
                    console.log('[UPDATE] Service restarted successfully');
                }
            });

            logSecurityEvent('UPDATE_COMPLETED', {}, '');

        } catch (e) {
            console.error('[UPDATE] Update failed:', e.message);
            logSecurityEvent('UPDATE_FAILED', { error: e.message }, '');
        }
    }, 500);
});

// Get update log/status
router.get('/status', requireAuth, (req, res) => {
    try {
        // Get git log of recent changes
        const log = execSync(
            `cd ${INSTALL_DIR} && git log --oneline -10 2>/dev/null || echo "No git history"`,
            { encoding: 'utf8' }
        ).trim();

        const currentBranch = execSync(
            `cd ${INSTALL_DIR} && git branch --show-current 2>/dev/null || echo "unknown"`,
            { encoding: 'utf8' }
        ).trim();

        const lastCommit = execSync(
            `cd ${INSTALL_DIR} && git log -1 --format="%h %s (%cr)" 2>/dev/null || echo "unknown"`,
            { encoding: 'utf8' }
        ).trim();

        res.json({
            branch: currentBranch,
            lastCommit,
            recentChanges: log.split('\n')
        });
    } catch (e) {
        res.status(500).json({ error: 'Failed to get update status' });
    }
});

module.exports = router;
