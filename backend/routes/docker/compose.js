/**
 * HomePiNAS Docker - Compose Management
 * Routes for docker-compose stack management
 */

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const { requireAuth } = require('../../middleware/auth');
const { logSecurityEvent } = require('../../utils/security');
const { sanitizeComposeName, validateComposeContent } = require('../../utils/sanitize');
const { COMPOSE_DIR } = require('./helpers');

// ═══════════════════════════════════════════════════════════════════════════
// COMPOSE ROUTES
// ═══════════════════════════════════════════════════════════════════════════

// Import docker-compose.yml
router.post('/compose/import', requireAuth, async (req, res) => {
    const { name, content } = req.body;

    if (!name || !content) {
        return res.status(400).json({ error: 'Name and content required' });
    }

    // SECURITY: Sanitize name using dedicated function
    const safeName = sanitizeComposeName(name);
    if (!safeName) {
        return res.status(400).json({ error: 'Invalid compose name (alphanumeric, dashes, underscores only)' });
    }

    // SECURITY: Validate compose content
    const contentValidation = validateComposeContent(content);
    if (!contentValidation.valid) {
        return res.status(400).json({ error: contentValidation.error });
    }

    try {
        const composeDir = path.join(COMPOSE_DIR, safeName);
        const composeFile = path.join(composeDir, 'docker-compose.yml');

        // Create directory
        if (!fs.existsSync(composeDir)) {
            fs.mkdirSync(composeDir, { recursive: true });
        }

        // Save compose file
        fs.writeFileSync(composeFile, content, 'utf8');

        logSecurityEvent('DOCKER_COMPOSE_IMPORT', { name: safeName, user: req.user.username }, req.ip);

        res.json({
            success: true,
            message: `Compose file "${safeName}" saved`,
            path: composeFile
        });
    } catch (e) {
        console.error('Compose import error:', e);
        res.status(500).json({ error: 'Failed to save compose file' });
    }
});

// List saved compose files
router.get('/compose/list', requireAuth, async (req, res) => {
    try {
        const composes = [];

        if (fs.existsSync(COMPOSE_DIR)) {
            const dirs = fs.readdirSync(COMPOSE_DIR);
            for (const dir of dirs) {
                const composeFile = path.join(COMPOSE_DIR, dir, 'docker-compose.yml');
                if (fs.existsSync(composeFile)) {
                    const stat = fs.statSync(composeFile);
                    composes.push({
                        name: dir,
                        path: composeFile,
                        modified: stat.mtime
                    });
                }
            }
        }

        res.json(composes);
    } catch (e) {
        console.error('Compose list error:', e);
        res.status(500).json({ error: 'Failed to list compose files' });
    }
});

// Run docker-compose up
router.post('/compose/up', requireAuth, async (req, res) => {
    const { name } = req.body;

    if (!name) {
        return res.status(400).json({ error: 'Compose name required' });
    }

    // SECURITY: Use dedicated sanitization function
    const safeName = sanitizeComposeName(name);
    if (!safeName) {
        return res.status(400).json({ error: 'Invalid compose name' });
    }

    const composeDir = path.join(COMPOSE_DIR, safeName);
    const composeFile = path.join(composeDir, 'docker-compose.yml');

    // SECURITY: Verify path doesn't escape COMPOSE_DIR
    const resolvedDir = path.resolve(composeDir);
    if (!resolvedDir.startsWith(path.resolve(COMPOSE_DIR))) {
        return res.status(400).json({ error: 'Invalid compose path' });
    }

    if (!fs.existsSync(composeFile)) {
        return res.status(404).json({ error: 'Compose file not found' });
    }

    try {
        logSecurityEvent('DOCKER_COMPOSE_UP', { name: safeName, user: req.user.username }, req.ip);

        // SECURITY: Use execFile with explicit arguments instead of shell interpolation
        const output = execFileSync('docker', ['compose', 'up', '-d'], {
            cwd: composeDir,
            encoding: 'utf8',
            timeout: 300000 // 5 minutes
        });

        res.json({
            success: true,
            message: `Compose "${safeName}" started`,
            output
        });
    } catch (e) {
        console.error('Compose up error:', e);
        res.status(500).json({
            error: 'Failed to start compose',
            details: e.stderr || e.message
        });
    }
});

// Stop docker-compose
router.post('/compose/down', requireAuth, async (req, res) => {
    const { name } = req.body;

    if (!name) {
        return res.status(400).json({ error: 'Compose name required' });
    }

    // SECURITY: Use dedicated sanitization function
    const safeName = sanitizeComposeName(name);
    if (!safeName) {
        return res.status(400).json({ error: 'Invalid compose name' });
    }

    const composeDir = path.join(COMPOSE_DIR, safeName);
    const composeFile = path.join(composeDir, 'docker-compose.yml');

    // SECURITY: Verify path doesn't escape COMPOSE_DIR
    const resolvedDir = path.resolve(composeDir);
    if (!resolvedDir.startsWith(path.resolve(COMPOSE_DIR))) {
        return res.status(400).json({ error: 'Invalid compose path' });
    }

    if (!fs.existsSync(composeFile)) {
        return res.status(404).json({ error: 'Compose file not found' });
    }

    try {
        logSecurityEvent('DOCKER_COMPOSE_DOWN', { name: safeName, user: req.user.username }, req.ip);

        // SECURITY: Use execFile with explicit arguments
        const output = execFileSync('docker', ['compose', 'down'], {
            cwd: composeDir,
            encoding: 'utf8',
            timeout: 120000
        });

        res.json({
            success: true,
            message: `Compose "${safeName}" stopped`,
            output
        });
    } catch (e) {
        console.error('Compose down error:', e);
        res.status(500).json({ error: 'Failed to stop compose' });
    }
});

// Delete compose file
router.delete('/compose/:name', requireAuth, async (req, res) => {
    // SECURITY: Use dedicated sanitization function
    const safeName = sanitizeComposeName(req.params.name);
    if (!safeName) {
        return res.status(400).json({ error: 'Invalid compose name' });
    }

    const composeDir = path.join(COMPOSE_DIR, safeName);

    // SECURITY: Verify path doesn't escape COMPOSE_DIR
    const resolvedDir = path.resolve(composeDir);
    if (!resolvedDir.startsWith(path.resolve(COMPOSE_DIR))) {
        return res.status(400).json({ error: 'Invalid compose path' });
    }

    if (!fs.existsSync(composeDir)) {
        return res.status(404).json({ error: 'Compose not found' });
    }

    try {
        // Stop containers first
        try {
            execFileSync('docker', ['compose', 'down'], {
                cwd: composeDir,
                encoding: 'utf8',
                timeout: 60000
            });
        } catch (e) {
            // Ignore errors - containers may not be running
        }

        // Remove directory
        fs.rmSync(composeDir, { recursive: true, force: true });

        logSecurityEvent('DOCKER_COMPOSE_DELETE', { name: safeName, user: req.user.username }, req.ip);

        res.json({ success: true, message: `Compose "${safeName}" deleted` });
    } catch (e) {
        console.error('Compose delete error:', e);
        res.status(500).json({ error: 'Failed to delete compose' });
    }
});

// Get compose file content
router.get('/compose/:name', requireAuth, async (req, res) => {
    // SECURITY: Use dedicated sanitization function
    const safeName = sanitizeComposeName(req.params.name);
    if (!safeName) {
        return res.status(400).json({ error: 'Invalid compose name' });
    }

    const composeFile = path.join(COMPOSE_DIR, safeName, 'docker-compose.yml');

    // SECURITY: Verify path doesn't escape COMPOSE_DIR
    const resolvedFile = path.resolve(composeFile);
    if (!resolvedFile.startsWith(path.resolve(COMPOSE_DIR))) {
        return res.status(400).json({ error: 'Invalid compose path' });
    }

    if (!fs.existsSync(composeFile)) {
        return res.status(404).json({ error: 'Compose not found' });
    }

    try {
        const content = fs.readFileSync(composeFile, 'utf8');
        res.json({ name: safeName, content });
    } catch (e) {
        res.status(500).json({ error: 'Failed to read compose file' });
    }
});

// Update compose file content
router.put('/compose/:name', requireAuth, async (req, res) => {
    const { content } = req.body;
    
    if (!content) {
        return res.status(400).json({ error: 'Content required' });
    }

    // SECURITY: Use dedicated sanitization function
    const safeName = sanitizeComposeName(req.params.name);
    if (!safeName) {
        return res.status(400).json({ error: 'Invalid compose name' });
    }

    // SECURITY: Validate compose content
    const contentValidation = validateComposeContent(content);
    if (!contentValidation.valid) {
        return res.status(400).json({ error: contentValidation.error });
    }

    const composeFile = path.join(COMPOSE_DIR, safeName, 'docker-compose.yml');

    // SECURITY: Verify path doesn't escape COMPOSE_DIR
    const resolvedFile = path.resolve(composeFile);
    if (!resolvedFile.startsWith(path.resolve(COMPOSE_DIR))) {
        return res.status(400).json({ error: 'Invalid compose path' });
    }

    if (!fs.existsSync(composeFile)) {
        return res.status(404).json({ error: 'Compose not found' });
    }

    try {
        fs.writeFileSync(composeFile, content, 'utf8');
        logSecurityEvent('DOCKER_COMPOSE_EDIT', { name: safeName, user: req.user.username }, req.ip);
        res.json({ success: true, message: `Compose "${safeName}" updated` });
    } catch (e) {
        res.status(500).json({ error: 'Failed to update compose file' });
    }
});

module.exports = router;
