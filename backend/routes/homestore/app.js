/**
 * HomePiNAS v2 - HomeStore App Details
 * Get individual app info and config
 */
const express = require('express');
const router = express.Router();
const { requireAuth } = require('../../middleware/auth');
const {
    validateAppId,
    loadCatalog,
    loadInstalled,
    loadAppConfig,
    getContainerStatus,
    getContainerStats
} = require('./helpers');

/**
 * GET /app/:id - Get app details with status
 */
router.get('/app/:id', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        if (!validateAppId(id)) {
            return res.status(400).json({ error: 'Invalid app ID' });
        }
        const catalog = await loadCatalog();
        const installed = await loadInstalled();
        
        const app = catalog.apps.find(a => a.id === id);
        if (!app) {
            return res.status(404).json({ success: false, error: 'App not found' });
        }
        
        const status = await getContainerStatus(id);
        const stats = status === 'running' ? await getContainerStats(id) : null;
        const savedConfig = await loadAppConfig(id);
        
        res.json({
            success: true,
            app: {
                ...app,
                installed: !!installed.apps[id],
                status,
                stats,
                installedAt: installed.apps[id]?.installedAt,
                config: installed.apps[id]?.config,
                savedConfig: savedConfig
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /app/:id/config - Get saved app config (for reinstalls)
 */
router.get('/app/:id/config', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        if (!validateAppId(id)) {
            return res.status(400).json({ error: 'Invalid app ID' });
        }
        const config = await loadAppConfig(id);
        
        if (config) {
            res.json({ success: true, config });
        } else {
            res.json({ success: true, config: null });
        }
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
