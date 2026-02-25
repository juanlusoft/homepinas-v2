/**
 * HomePiNAS - Legacy Storage Config Endpoint
 * Backward compatibility for old config API
 */

const express = require('express');
const router = express.Router();
const { logSecurityEvent } = require('../../utils/security');
const { getData, saveData } = require('../../utils/data');
const { validateSession } = require('../../utils/session');
const { validateDiskConfig } = require('../../utils/sanitize');

/**
 * Storage config (legacy)
 * POST /config
 * NOTE: This endpoint allows initial config without auth (first-time setup),
 * but requires auth if storage is already configured
 */
router.post('/config', (req, res) => {
    try {
        const { config } = req.body;
        const data = getData();

        // SECURITY: Require auth if storage already configured
        if (data.storageConfig && data.storageConfig.length > 0) {
            const sessionId = req.headers['x-session-id'];
            const session = validateSession(sessionId);
            if (!session) {
                logSecurityEvent('UNAUTHORIZED_STORAGE_CHANGE', {}, req.ip);
                return res.status(401).json({ error: 'Authentication required' });
            }
        }

        if (!Array.isArray(config)) {
            return res.status(400).json({ error: 'Invalid configuration format' });
        }

        // SECURITY: Use validateDiskConfig from sanitize module
        const validatedConfig = validateDiskConfig(config);
        if (!validatedConfig) {
            return res.status(400).json({ error: 'Invalid disk configuration. Check disk IDs and roles.' });
        }

        data.storageConfig = validatedConfig;
        saveData(data);

        logSecurityEvent('STORAGE_CONFIG', { disks: validatedConfig.length }, req.ip);
        res.json({ success: true, message: 'Storage configuration saved' });
    } catch (e) {
        console.error('Storage config error:', e);
        res.status(500).json({ error: 'Failed to save storage configuration' });
    }
});

module.exports = router;
