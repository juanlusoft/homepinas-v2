/**
 * HomePiNAS - Disk Management Routes
 * Handles disk detection, addition, removal, mounting, and ignore list
 * 
 * REFACTORED: Business logic moved to services/storage.js
 * Routes now only handle: request parsing → service call → response formatting
 */

const express = require('express');
const router = express.Router();
const { requireAuth } = require('../../middleware/auth');
const { logSecurityEvent } = require('../../utils/security');
const storageService = require('../../services/storage');

/**
 * Detect all available disks
 * GET /disks/detect
 */
router.get('/detect', requireAuth, async (req, res) => {
    try {
        const result = await storageService.detectDisks();
        res.json(result);
    } catch (e) {
        console.error('Disk detection error:', e);
        res.status(500).json({ error: 'Failed to detect disks' });
    }
});

/**
 * Add a disk to the MergerFS pool
 * POST /disks/add-to-pool
 * Body: { diskId: 'sdb', format: true/false, role: 'data'|'cache'|'parity', force: false }
 */
router.post('/add-to-pool', requireAuth, async (req, res) => {
    try {
        const { diskId, format, role = 'data', force = false } = req.body;
        
        const result = await storageService.addDiskToPool(diskId, { format, role, force });
        
        if (!result.success) {
            const statusCode = result.requiresConfirmation ? 409 : 400;
            return res.status(statusCode).json({ 
                error: result.error,
                hasData: result.requiresConfirmation,
                requiresConfirmation: result.requiresConfirmation
            });
        }

        logSecurityEvent('DISK_ADDED_TO_POOL', { 
            diskId: result.data.diskId, 
            role: result.data.role, 
            mountPoint: result.data.mountPoint 
        }, req.ip);

        res.json({ 
            success: true, 
            message: `Disk ${result.data.diskId} added to pool as ${result.data.role}`,
            mountPoint: result.data.mountPoint,
            uuid: result.data.uuid
        });
    } catch (e) {
        console.error('Add to pool error:', e);
        res.status(500).json({ error: `Failed to add disk: ${e.message}` });
    }
});

/**
 * Remove disk from pool
 * POST /disks/remove-from-pool
 * Body: { diskId: 'sdb' }
 */
router.post('/remove-from-pool', requireAuth, async (req, res) => {
    try {
        const { diskId } = req.body;
        
        const result = await storageService.removeDiskFromPool(diskId);
        
        if (!result.success) {
            return res.status(400).json({ error: result.error });
        }

        logSecurityEvent('DISK_REMOVED_FROM_POOL', { 
            diskId: result.data.diskId 
        }, req.ip);

        res.json({ 
            success: true, 
            message: `Disk ${result.data.diskId} removed from pool`,
            remainingDisks: result.data.remainingDisks
        });
    } catch (e) {
        console.error('Remove from pool error:', e);
        res.status(500).json({ error: `Failed to remove disk: ${e.message}` });
    }
});

/**
 * Mount disk as standalone volume (not in pool)
 * POST /disks/mount-standalone
 * Body: { diskId: 'sdb', format: true/false, name: 'backups' }
 */
router.post('/mount-standalone', requireAuth, async (req, res) => {
    try {
        const { diskId, format, name } = req.body;
        
        const result = await storageService.mountStandalone(diskId, { format, name });
        
        if (!result.success) {
            return res.status(400).json({ error: result.error });
        }

        logSecurityEvent('STANDALONE_VOLUME_CREATED', { 
            diskId, 
            name: result.data.name, 
            mountPoint: result.data.mountPoint 
        }, req.ip);

        res.json({
            success: true,
            message: `Volume "${result.data.name}" created at ${result.data.mountPoint}`,
            mountPoint: result.data.mountPoint,
            uuid: result.data.uuid
        });
    } catch (e) {
        console.error('Standalone mount error:', e);
        res.status(500).json({ error: `Failed: ${e.message}` });
    }
});

/**
 * Dismiss/ignore a detected disk (won't show in notifications)
 * POST /disks/ignore
 * Body: { diskId: 'sdb' }
 */
router.post('/ignore', requireAuth, async (req, res) => {
    try {
        const { diskId } = req.body;
        
        const result = storageService.ignoreDisk(diskId);
        
        if (!result.success) {
            return res.status(400).json({ error: result.error });
        }

        res.json({ success: true, message: `Disk ${diskId} ignored` });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

/**
 * Get list of ignored disks
 * GET /disks/ignored
 */
router.get('/ignored', requireAuth, (req, res) => {
    try {
        const ignored = storageService.getIgnoredDisks();
        res.json({ ignored });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

/**
 * Un-ignore a disk
 * POST /disks/unignore
 * Body: { diskId: 'sdb' }
 */
router.post('/unignore', requireAuth, async (req, res) => {
    try {
        const { diskId } = req.body;
        
        const result = storageService.unignoreDisk(diskId);
        
        if (!result.success) {
            return res.status(400).json({ error: result.error });
        }

        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

module.exports = router;
