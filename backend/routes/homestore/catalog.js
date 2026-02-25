/**
 * HomePiNAS v2 - HomeStore Catalog Routes
 * Browse available apps and categories
 */
const express = require('express');
const router = express.Router();
const { requireAuth } = require('../../middleware/auth');
const {
    loadCatalog,
    loadInstalled,
    loadAppConfig,
    getContainerStatus
} = require('./helpers');

/**
 * GET /catalog - List all available apps with install status
 */
router.get('/catalog', requireAuth, async (req, res) => {
    try {
        const catalog = await loadCatalog();
        const installed = await loadInstalled();
        
        // Enrich apps with install status and saved config
        const apps = await Promise.all(catalog.apps.map(async (app) => {
            const status = await getContainerStatus(app.id);
            const savedConfig = await loadAppConfig(app.id);
            const installInfo = installed.apps[app.id];
            
            return {
                ...app,
                installed: !!installInfo,
                status: status,
                installedAt: installInfo?.installedAt,
                config: savedConfig || installInfo?.config || null
            };
        }));
        
        res.json({
            success: true,
            version: catalog.version,
            categories: catalog.categories,
            apps
        });
    } catch (error) {
        console.error('Error loading catalog:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /categories - List app categories
 */
router.get('/categories', requireAuth, async (req, res) => {
    try {
        const catalog = await loadCatalog();
        res.json({ success: true, categories: catalog.categories });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
