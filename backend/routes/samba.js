/**
 * HomePiNAS v2 - Samba Share Management Routes
 * REFACTORED: Business logic moved to services/samba.js
 * Routes handle: request parsing → service call → response formatting
 */

const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/rbac');
const { logSecurityEvent } = require('../utils/security');
const sambaService = require('../services/samba');

// All routes require authentication
router.use(requireAuth);

/**
 * GET /shares
 * List all configured Samba shares
 */
router.get('/shares', requireAdmin, async (req, res) => {
    try {
        const shares = await sambaService.getAllShares();
        res.json({ shares, count: shares.length });
    } catch (err) {
        console.error('List shares error:', err.message);
        res.status(500).json({ error: 'Failed to read Samba configuration' });
    }
});

/**
 * POST /shares
 * Create a new Samba share
 * Body: { name, path, comment, readOnly, guestOk, validUsers }
 */
router.post('/shares', requireAdmin, async (req, res) => {
    try {
        const { name, path, comment, readOnly, guestOk, validUsers } = req.body;
        
        const result = await sambaService.createShare({
            name,
            path,
            comment,
            readOnly,
            guestOk,
            validUsers
        });

        if (!result.success) {
            const statusCode = result.error.includes('already exists') ? 409 : 400;
            return res.status(statusCode).json({ error: result.error });
        }

        logSecurityEvent('samba_share_created', req.user.username, {
            share: name,
            path: result.share.path,
        });

        res.status(201).json({
            message: `Share '${name}' created successfully`,
            share: result.share,
        });
    } catch (err) {
        console.error('Create share error:', err.message);
        res.status(500).json({ error: 'Failed to create share' });
    }
});

/**
 * PUT /shares/:name
 * Update an existing Samba share
 * Body: { path, comment, readOnly, guestOk, validUsers }
 */
router.put('/shares/:name', requireAdmin, async (req, res) => {
    try {
        const shareName = req.params.name;
        const { path, comment, readOnly, guestOk, validUsers } = req.body;

        const result = await sambaService.updateShare(shareName, {
            path,
            comment,
            readOnly,
            guestOk,
            validUsers
        });

        if (!result.success) {
            const statusCode = result.error === 'Share not found' ? 404 : 400;
            return res.status(statusCode).json({ error: result.error });
        }

        logSecurityEvent('samba_share_updated', req.user.username, {
            share: shareName,
            changes: req.body,
        });

        res.json({
            message: `Share '${shareName}' updated successfully`,
            share: result.share,
        });
    } catch (err) {
        console.error('Update share error:', err.message);
        res.status(500).json({ error: 'Failed to update share' });
    }
});

/**
 * DELETE /shares/:name
 * Remove a Samba share
 */
router.delete('/shares/:name', requireAdmin, async (req, res) => {
    try {
        const shareName = req.params.name;

        const result = await sambaService.deleteShare(shareName);

        if (!result.success) {
            const statusCode = result.error === 'Share not found' ? 404 : 500;
            return res.status(statusCode).json({ error: result.error });
        }

        logSecurityEvent('samba_share_deleted', req.user.username, {
            share: shareName,
            path: result.path,
        });

        res.json({ message: `Share '${shareName}' deleted successfully` });
    } catch (err) {
        console.error('Delete share error:', err.message);
        res.status(500).json({ error: 'Failed to delete share' });
    }
});

/**
 * GET /status
 * Get Samba service status and connected users
 */
router.get('/status', requireAdmin, async (req, res) => {
    try {
        const status = await sambaService.getSambaStatus();
        res.json(status);
    } catch (err) {
        console.error('Samba status error:', err.message);
        res.status(500).json({ error: 'Failed to get Samba status' });
    }
});

/**
 * POST /restart
 * Restart Samba services
 */
router.post('/restart', requireAdmin, async (req, res) => {
    try {
        await sambaService.restartSamba();

        logSecurityEvent('samba_restart', req.user.username);

        // Wait and check status
        await new Promise(resolve => setTimeout(resolve, 1000));

        const status = await sambaService.getSambaStatus();

        res.json({
            message: 'Samba services restarted',
            status: status.service,
            running: status.running,
        });
    } catch (err) {
        console.error('Samba restart error:', err.message);
        res.status(500).json({ error: 'Failed to restart Samba services' });
    }
});

module.exports = router;
