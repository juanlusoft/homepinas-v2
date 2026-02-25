/**
 * HomePiNAS v2 - DDNS Status
 * Get public IP and service status
 */
const express = require('express');
const router = express.Router();
const { requireAuth } = require('../../middleware/auth');
const { getData } = require('../../utils/data');
const {
  getPublicIp,
  getServiceDisplayName,
  setLastKnownIp,
  getLastKnownIp
} = require('./helpers');

/**
 * GET /public-ip - Get the current public IP address
 */
router.get('/public-ip', requireAuth, async (req, res) => {
  try {
    const ip = await getPublicIp();
    setLastKnownIp(ip);
    res.json({ success: true, ip });
  } catch (err) {
    console.error('Error getting public IP:', err);
    res.status(500).json({ success: false, error: 'Failed to get public IP' });
  }
});

/**
 * GET /status - Get status of all DDNS services
 */
router.get('/status', requireAuth, async (req, res) => {
  try {
    const data = getData();
    if (!data.network) data.network = {};
    const services = data.network.ddns || [];

    // Try to get current public IP
    let currentIp = getLastKnownIp();
    try {
      currentIp = await getPublicIp();
      setLastKnownIp(currentIp);
    } catch (ipErr) {
      console.error('Could not fetch public IP for status:', ipErr);
    }

    const statuses = services.map(s => ({
      id: s.id,
      provider: s.provider,
      name: getServiceDisplayName(s),
      enabled: s.enabled,
      lastUpdate: s.lastUpdate || null,
      lastIp: s.lastIp || null,
      lastError: s.lastError || null,
      ipCurrent: currentIp === s.lastIp
    }));

    res.json({
      success: true,
      currentIp,
      services: statuses
    });
  } catch (err) {
    console.error('Error getting DDNS status:', err);
    res.status(500).json({ success: false, error: 'Failed to get DDNS status' });
  }
});

module.exports = router;
