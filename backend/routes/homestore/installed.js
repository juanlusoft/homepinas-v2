/**
 * HomePiNAS v2 - HomeStore Installed Apps
 * List installed apps with status
 */
const express = require('express');
const router = express.Router();
const { requireAuth } = require('../../middleware/auth');
const {
    loadCatalog,
    loadInstalled,
    loadAppConfig,
    getContainerStatus,
    getContainerStats
} = require('./helpers');

/**
 * GET /installed - List installed apps with status and stats
 */
router.get('/installed', requireAuth, async (req, res) => {
    try {
        const catalog = await loadCatalog();
        const installed = await loadInstalled();
        
        const apps = await Promise.all(
            Object.keys(installed.apps).map(async (appId) => {
                const appDef = catalog.apps.find(a => a.id === appId);
                const status = await getContainerStatus(appId);
                const stats = status === 'running' ? await getContainerStats(appId) : null;
                const savedConfig = await loadAppConfig(appId);
                
                return {
                    ...appDef,
                    ...installed.apps[appId],
                    status,
                    stats,
                    config: savedConfig || installed.apps[appId]?.config || null
                };
            })
        );
        
        res.json({ success: true, apps });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
