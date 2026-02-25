/**
 * HomePiNAS v2 - DDNS Services CRUD
 * Create, read, update, delete DDNS services
 */
const express = require('express');
const router = express.Router();
const { requireAuth } = require('../../middleware/auth');
const { logSecurityEvent } = require('../../utils/security');
const { getData, saveData } = require('../../utils/data');
const {
  generateId,
  getServiceDisplayName,
  validateServiceFields,
  redactSensitiveFields,
  serviceStatus
} = require('./helpers');

/**
 * GET /services - List all configured DDNS services
 */
router.get('/services', requireAuth, (req, res) => {
  try {
    const data = getData();
    if (!data.network) data.network = {};
    const services = data.network.ddns || [];

    // Redact sensitive fields (tokens, passwords) in response
    const safeServices = services.map(redactSensitiveFields);

    res.json({ success: true, services: safeServices });
  } catch (err) {
    console.error('Error listing DDNS services:', err);
    res.status(500).json({ success: false, error: 'Failed to list DDNS services' });
  }
});

/**
 * POST /services - Add a new DDNS service
 */
router.post('/services', requireAuth, (req, res) => {
  try {
    const validationError = validateServiceFields(req.body);
    if (validationError) {
      return res.status(400).json({ success: false, error: validationError });
    }

    const service = {
      id: generateId(),
      provider: req.body.provider,
      enabled: typeof req.body.enabled === 'boolean' ? req.body.enabled : true,
      createdAt: new Date().toISOString(),
      lastUpdate: null,
      lastIp: null,
      lastError: null
    };

    // Copy provider-specific fields
    switch (req.body.provider) {
      case 'duckdns':
        service.domain = req.body.domain.trim();
        service.token = req.body.token.trim();
        break;
      case 'noip':
        service.hostname = req.body.hostname.trim();
        service.username = req.body.username.trim();
        service.password = req.body.password;
        break;
      case 'cloudflare':
        service.domain = req.body.domain.trim();
        service.zoneId = req.body.zoneId.trim();
        service.apiToken = req.body.apiToken.trim();
        service.proxied = req.body.proxied || false;
        break;
      case 'dynu':
        service.hostname = req.body.hostname.trim();
        service.apiKey = req.body.apiKey.trim();
        break;
    }

    const data = getData();
    if (!data.network) data.network = {};
    if (!data.network.ddns) data.network.ddns = [];
    data.network.ddns.push(service);
    saveData(data);

    logSecurityEvent('ddns_service_added', {
      serviceId: service.id,
      provider: service.provider,
      name: getServiceDisplayName(service),
      user: req.user
    });

    res.status(201).json({ success: true, service: redactSensitiveFields(service) });
  } catch (err) {
    console.error('Error adding DDNS service:', err);
    res.status(500).json({ success: false, error: 'Failed to add DDNS service' });
  }
});

/**
 * PUT /services/:id - Update a DDNS service configuration
 */
router.put('/services/:id', requireAuth, (req, res) => {
  try {
    const data = getData();
    if (!data.network) data.network = {};
    if (!data.network.ddns) data.network.ddns = [];

    const serviceIndex = data.network.ddns.findIndex(s => s.id === req.params.id);
    if (serviceIndex === -1) {
      return res.status(404).json({ success: false, error: 'DDNS service not found' });
    }

    const service = data.network.ddns[serviceIndex];
    const body = req.body;

    // Update common fields
    if (typeof body.enabled === 'boolean') service.enabled = body.enabled;

    // Update provider-specific fields (only non-empty values)
    switch (service.provider) {
      case 'duckdns':
        if (body.domain) service.domain = body.domain.trim();
        if (body.token) service.token = body.token.trim();
        break;
      case 'noip':
        if (body.hostname) service.hostname = body.hostname.trim();
        if (body.username) service.username = body.username.trim();
        if (body.password) service.password = body.password;
        break;
      case 'cloudflare':
        if (body.domain) service.domain = body.domain.trim();
        if (body.zoneId) service.zoneId = body.zoneId.trim();
        if (body.apiToken) service.apiToken = body.apiToken.trim();
        if (typeof body.proxied === 'boolean') service.proxied = body.proxied;
        break;
      case 'dynu':
        if (body.hostname) service.hostname = body.hostname.trim();
        if (body.apiKey) service.apiKey = body.apiKey.trim();
        break;
    }

    service.updatedAt = new Date().toISOString();
    data.network.ddns[serviceIndex] = service;
    saveData(data);

    logSecurityEvent('ddns_service_updated', {
      serviceId: service.id,
      provider: service.provider,
      user: req.user
    });

    res.json({ success: true, service: redactSensitiveFields(service) });
  } catch (err) {
    console.error('Error updating DDNS service:', err);
    res.status(500).json({ success: false, error: 'Failed to update DDNS service' });
  }
});

/**
 * DELETE /services/:id - Remove a DDNS service
 */
router.delete('/services/:id', requireAuth, (req, res) => {
  try {
    const data = getData();
    if (!data.network) data.network = {};
    if (!data.network.ddns) data.network.ddns = [];

    const serviceIndex = data.network.ddns.findIndex(s => s.id === req.params.id);
    if (serviceIndex === -1) {
      return res.status(404).json({ success: false, error: 'DDNS service not found' });
    }

    const removed = data.network.ddns.splice(serviceIndex, 1)[0];
    serviceStatus.delete(removed.id);
    saveData(data);

    logSecurityEvent('ddns_service_deleted', {
      serviceId: removed.id,
      provider: removed.provider,
      user: req.user
    });

    res.json({ success: true, message: 'DDNS service removed' });
  } catch (err) {
    console.error('Error deleting DDNS service:', err);
    res.status(500).json({ success: false, error: 'Failed to delete DDNS service' });
  }
});

module.exports = router;
