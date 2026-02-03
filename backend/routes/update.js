/**
 * HomePiNAS - Update Routes
 * v1.5.7 - OTA Updates
 *
 * System update from GitHub repository
 */

const express = require('express');
const router = express.Router();
const { exec, execSync, execFileSync } = require('child_process');
const path = require('path');

const { requireAuth } = require('../middleware/auth');
const { criticalLimiter } = require('../middleware/rateLimit');
const { logSecurityEvent } = require('../utils/security');

const INSTALL_DIR = '/opt/homepinas';
const REPO_URL = 'https://github.com/juanlusoft/homepinas-v2.git';
const EXPECTED_REMOTE = 'github.com/juanlusoft/homepinas-v2'; // SECURITY: Expected repo pattern

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
            // SECURITY: Use execFileSync with explicit arguments
            execFileSync('git', ['fetch', 'origin', '--quiet'], {
                cwd: INSTALL_DIR,
                encoding: 'utf8',
                timeout: 30000
            });

            // Detect current branch
            let currentBranch = 'main';
            try {
                currentBranch = execFileSync('git', ['branch', '--show-current'], {
                    cwd: INSTALL_DIR, encoding: 'utf8', timeout: 5000
                }).trim() || 'main';
            } catch (e) {}

            // Get commits ahead of current HEAD on the SAME branch
            const remoteInfo = execFileSync('git', ['log', `HEAD..origin/${currentBranch}`, '--oneline'], {
                cwd: INSTALL_DIR,
                encoding: 'utf8',
                timeout: 10000
            }).trim();

            // Limit to first 5 lines
            const remoteLines = remoteInfo.split('\n').slice(0, 5).join('\n');

            if (remoteInfo) {
                updateAvailable = true;
                changelog = remoteLines;

                // Try to get latest version from remote package.json
                try {
                    const remotePackage = execFileSync('git', ['show', `origin/${currentBranch}:package.json`], {
                        cwd: INSTALL_DIR,
                        encoding: 'utf8',
                        timeout: 10000
                    });
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

    // SECURITY: Verify we're updating from the expected repository
    try {
        const remoteUrl = execFileSync('git', ['remote', 'get-url', 'origin'], {
            cwd: INSTALL_DIR,
            encoding: 'utf8',
            timeout: 5000
        }).trim();

        if (!remoteUrl.includes(EXPECTED_REMOTE)) {
            logSecurityEvent('UPDATE_REJECTED_WRONG_REPO', { remoteUrl, user: req.user.username }, req.ip);
            return res.status(400).json({
                success: false,
                error: 'Update rejected: Repository does not match expected source'
            });
        }
    } catch (e) {
        logSecurityEvent('UPDATE_REJECTED_VERIFY_FAILED', { error: e.message, user: req.user.username }, req.ip);
        return res.status(500).json({
            success: false,
            error: 'Failed to verify update source'
        });
    }

    // Send response immediately, update will happen in background
    res.json({
        success: true,
        message: 'Update started. The service will restart automatically. Please wait 30 seconds and refresh the page.'
    });

    // Perform update in background after response is sent
    setTimeout(async () => {
        try {
            console.log('[UPDATE] Starting system update...');

            // 1. Pull latest changes - using execFileSync where possible
            console.log('[UPDATE] Pulling latest changes from GitHub...');
            execFileSync('git', ['fetch', 'origin'], {
                cwd: INSTALL_DIR,
                encoding: 'utf8',
                timeout: 60000
            });
            // Detect current branch for update
            let updateBranch = 'main';
            try {
                updateBranch = execFileSync('git', ['branch', '--show-current'], {
                    cwd: INSTALL_DIR, encoding: 'utf8', timeout: 5000
                }).trim() || 'main';
            } catch (e) {}
            execFileSync('git', ['reset', '--hard', `origin/${updateBranch}`], {
                cwd: INSTALL_DIR,
                encoding: 'utf8',
                timeout: 30000
            });

            // 2. Install/update dependencies
            console.log('[UPDATE] Installing dependencies...');
            execFileSync('npm', ['install', '--production'], {
                cwd: INSTALL_DIR,
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
        // SECURITY: Use execFileSync with explicit arguments
        let log = 'No git history';
        let currentBranch = 'unknown';
        let lastCommit = 'unknown';

        try {
            log = execFileSync('git', ['log', '--oneline', '-10'], {
                cwd: INSTALL_DIR,
                encoding: 'utf8',
                timeout: 10000
            }).trim();
        } catch (e) {
            // Git log failed
        }

        try {
            currentBranch = execFileSync('git', ['branch', '--show-current'], {
                cwd: INSTALL_DIR,
                encoding: 'utf8',
                timeout: 5000
            }).trim();
        } catch (e) {
            // Branch check failed
        }

        try {
            lastCommit = execFileSync('git', ['log', '-1', '--format=%h %s (%cr)'], {
                cwd: INSTALL_DIR,
                encoding: 'utf8',
                timeout: 5000
            }).trim();
        } catch (e) {
            // Last commit check failed
        }

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
