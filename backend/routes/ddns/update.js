/**
 * HomePiNAS v2 - DDNS Force Update
 * Manually trigger IP update for a service
 */
const express = require('express');
const router = express.Router();
const { requireAuth } = require('../../middleware/auth');
const { ddnsLimiter } = require('../../middleware/rateLimit');
const { logSecurityEvent } = require('../../utils/security');
const { getData, saveData } = require('../../utils/data');
const {
  getPublicIp,
  updateService,
  serviceStatus
} = require('./helpers');

/**
 * POST /services/:id/update - Force an IP update for a specific service
 */
router.post('/services/:id/update', requireAuth, ddnsLimiter, async (req, res) => {
  try {
    const data = getData();
    if (!data.network) data.network = {};
    if (!data.network.ddns) data.network.ddns = [];

    const service = data.network.ddns.find(s => s.id === req.params.id);
    if (!service) {
      return res.status(404).json({ success: false, error: 'DDNS service not found' });
    }

    // Get current public IP
    const ip = await getPublicIp();

    // Force update regardless of IP change
    const result = await updateService(service, ip);

    // Update stored service status
    service.lastUpdate = new Date().toISOString();
    service.lastIp = ip;
    service.lastError = null;
    saveData(data);

    // Update in-memory status
    serviceStatus.set(service.id, {
      lastUpdate: service.lastUpdate,
      lastIp: ip,
      lastError: null
    });

    logSecurityEvent('ddns_force_update', {
      serviceId: service.id,
      provider: service.provider,
      ip,
      user: req.user
    });

    res.json({ success: true, ip, ...result });
  } catch (err) {
    console.error('Error forcing DDNS update:', err);

    // Store the error
    const data = getData();
    if (data.network && data.network.ddns) {
      const service = data.network.ddns.find(s => s.id === req.params.id);
      if (service) {
        service.lastError = err.message;
        saveData(data);
      }
    }

    res.status(500).json({ success: false, error: `DDNS update failed: ${err.message}` });
  }
});

module.exports = router;
