/**
 * HomePiNAS v2 - Dynamic DNS Routes
 * 
 * Configure and manage DDNS services (DuckDNS, No-IP, Cloudflare, Dynu).
 * Includes background updater that checks every 5 minutes.
 */

const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { ddnsLimiter } = require('../middleware/rateLimit');
const { logSecurityEvent } = require('../utils/security');
const { getData, saveData } = require('../utils/data');

// Store last known public IP to skip unnecessary updates
let lastKnownIp = null;

// Store per-service status in memory (last update time, errors, etc.)
const serviceStatus = new Map();

// --- Provider Update Helpers ---

/**
 * Get the current public IP address via ipify.
 * @returns {Promise<string>} The public IP address
 */
async function getPublicIp() {
  const response = await fetch('https://api.ipify.org?format=json');
  if (!response.ok) {
    throw new Error(`Failed to get public IP: HTTP ${response.status}`);
  }
  const data = await response.json();
  return data.ip;
}

/**
 * Update DuckDNS with current IP.
 * @param {object} service - The DDNS service config
 * @param {string} ip - The current public IP
 * @returns {Promise<object>} Update result
 */
async function updateDuckDns(service, ip) {
  const url = `https://www.duckdns.org/update?domains=${encodeURIComponent(service.domain)}&token=${encodeURIComponent(service.token)}&ip=${encodeURIComponent(ip)}`;
  const response = await fetch(url);
  const text = await response.text();

  if (text.trim() === 'OK') {
    return { success: true, message: 'DuckDNS updated successfully' };
  }
  throw new Error(`DuckDNS update failed: ${text.trim()}`);
}

/**
 * Update No-IP with current IP.
 * @param {object} service - The DDNS service config
 * @param {string} ip - The current public IP
 * @returns {Promise<object>} Update result
 */
async function updateNoIp(service, ip) {
  // No-IP uses HTTP Basic Auth
  const credentials = Buffer.from(`${service.username}:${service.password}`).toString('base64');
  const url = `https://dynupdate.no-ip.com/nic/update?hostname=${encodeURIComponent(service.hostname)}&myip=${encodeURIComponent(ip)}`;

  const response = await fetch(url, {
    headers: {
      'Authorization': `Basic ${credentials}`,
      'User-Agent': 'HomePiNAS/2.0 admin@localhost'
    }
  });
  const text = await response.text();

  // No-IP returns "good <ip>" or "nochg <ip>" on success
  if (text.startsWith('good') || text.startsWith('nochg')) {
    return { success: true, message: `No-IP updated: ${text.trim()}` };
  }
  throw new Error(`No-IP update failed: ${text.trim()}`);
}

/**
 * Update Cloudflare DNS A record with current IP.
 * Uses Cloudflare API v4 to find and update the record.
 * @param {object} service - The DDNS service config
 * @param {string} ip - The current public IP
 * @returns {Promise<object>} Update result
 */
async function updateCloudflare(service, ip) {
  const baseUrl = 'https://api.cloudflare.com/client/v4';
  const headers = {
    'Authorization': `Bearer ${service.apiToken}`,
    'Content-Type': 'application/json'
  };

  // First, find the DNS record ID for the domain
  const listUrl = `${baseUrl}/zones/${service.zoneId}/dns_records?type=A&name=${encodeURIComponent(service.domain)}`;
  const listResponse = await fetch(listUrl, { headers });
  const listData = await listResponse.json();

  if (!listData.success) {
    const errors = listData.errors.map(e => e.message).join(', ');
    throw new Error(`Cloudflare API error: ${errors}`);
  }

  if (listData.result.length === 0) {
    // Record doesn't exist, create it
    const createUrl = `${baseUrl}/zones/${service.zoneId}/dns_records`;
    const createResponse = await fetch(createUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        type: 'A',
        name: service.domain,
        content: ip,
        ttl: 300,
        proxied: service.proxied || false
      })
    });
    const createData = await createResponse.json();

    if (!createData.success) {
      const errors = createData.errors.map(e => e.message).join(', ');
      throw new Error(`Cloudflare create failed: ${errors}`);
    }
    return { success: true, message: 'Cloudflare DNS record created' };
  }

  // Update existing record
  const recordId = listData.result[0].id;
  const updateUrl = `${baseUrl}/zones/${service.zoneId}/dns_records/${recordId}`;
  const updateResponse = await fetch(updateUrl, {
    method: 'PUT',
    headers,
    body: JSON.stringify({
      type: 'A',
      name: service.domain,
      content: ip,
      ttl: 300,
      proxied: service.proxied || false
    })
  });
  const updateData = await updateResponse.json();

  if (!updateData.success) {
    const errors = updateData.errors.map(e => e.message).join(', ');
    throw new Error(`Cloudflare update failed: ${errors}`);
  }
  return { success: true, message: 'Cloudflare DNS record updated' };
}

/**
 * Update Dynu DNS with current IP.
 * @param {object} service - The DDNS service config
 * @param {string} ip - The current public IP
 * @returns {Promise<object>} Update result
 */
async function updateDynu(service, ip) {
  const url = `https://api.dynu.com/nic/update?hostname=${encodeURIComponent(service.hostname)}&myip=${encodeURIComponent(ip)}&password=${encodeURIComponent(service.apiKey)}`;

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'HomePiNAS/2.0'
    }
  });
  const text = await response.text();

  // Dynu returns "good" or "nochg" on success
  if (text.startsWith('good') || text.startsWith('nochg')) {
    return { success: true, message: `Dynu updated: ${text.trim()}` };
  }
  throw new Error(`Dynu update failed: ${text.trim()}`);
}

/**
 * Update a single DDNS service with the given IP.
 * Dispatches to the correct provider update function.
 * @param {object} service - The DDNS service config
 * @param {string} ip - The public IP to set
 * @returns {Promise<object>} Update result
 */
async function updateService(service, ip) {
  switch (service.provider) {
    case 'duckdns':
      return updateDuckDns(service, ip);
    case 'noip':
      return updateNoIp(service, ip);
    case 'cloudflare':
      return updateCloudflare(service, ip);
    case 'dynu':
      return updateDynu(service, ip);
    default:
      throw new Error(`Unknown provider: ${service.provider}`);
  }
}

/**
 * Generate a unique ID for DDNS services.
 * @returns {string} Base-36 encoded timestamp
 */
function generateId() {
  return Date.now().toString(36);
}

/**
 * Get the display name/hostname for a service (varies by provider).
 * @param {object} service - The DDNS service config
 * @returns {string} Display name
 */
function getServiceDisplayName(service) {
  return service.domain || service.hostname || service.provider;
}

// --- Validation ---

/** Supported DDNS providers */
const VALID_PROVIDERS = ['duckdns', 'noip', 'cloudflare', 'dynu'];

/**
 * Validate service fields based on provider type.
 * @param {object} body - The request body
 * @returns {string|null} Error message or null if valid
 */
function validateServiceFields(body) {
  if (!body.provider || !VALID_PROVIDERS.includes(body.provider)) {
    return `Provider must be one of: ${VALID_PROVIDERS.join(', ')}`;
  }

  switch (body.provider) {
    case 'duckdns':
      if (!body.domain || typeof body.domain !== 'string') return 'DuckDNS requires a domain';
      if (!body.token || typeof body.token !== 'string') return 'DuckDNS requires a token';
      break;
    case 'noip':
      if (!body.hostname || typeof body.hostname !== 'string') return 'No-IP requires a hostname';
      if (!body.username || typeof body.username !== 'string') return 'No-IP requires a username';
      if (!body.password || typeof body.password !== 'string') return 'No-IP requires a password';
      break;
    case 'cloudflare':
      if (!body.domain || typeof body.domain !== 'string') return 'Cloudflare requires a domain';
      if (!body.zoneId || typeof body.zoneId !== 'string') return 'Cloudflare requires a zoneId';
      if (!body.apiToken || typeof body.apiToken !== 'string') return 'Cloudflare requires an apiToken';
      break;
    case 'dynu':
      if (!body.hostname || typeof body.hostname !== 'string') return 'Dynu requires a hostname';
      if (!body.apiKey || typeof body.apiKey !== 'string') return 'Dynu requires an apiKey';
      break;
  }
  return null;
}

// All routes require authentication
router.use(requireAuth);

// --- Routes ---

/**
 * GET /services - List all configured DDNS services
 */
router.get('/services', (req, res) => {
  try {
    const data = getData();
    if (!data.network) data.network = {};
    const services = data.network.ddns || [];

    // Redact sensitive fields (tokens, passwords) in response
    const safeServices = services.map(s => {
      const safe = { ...s };
      if (safe.token) safe.token = '***';
      if (safe.password) safe.password = '***';
      if (safe.apiToken) safe.apiToken = '***';
      if (safe.apiKey) safe.apiKey = '***';
      return safe;
    });

    res.json({ success: true, services: safeServices });
  } catch (err) {
    console.error('Error listing DDNS services:', err);
    res.status(500).json({ success: false, error: 'Failed to list DDNS services' });
  }
});

/**
 * POST /services - Add a new DDNS service
 * Body varies by provider (see validateServiceFields for required fields).
 */
router.post('/services', (req, res) => {
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

    // Return with sensitive fields redacted
    const safeService = { ...service };
    if (safeService.token) safeService.token = '***';
    if (safeService.password) safeService.password = '***';
    if (safeService.apiToken) safeService.apiToken = '***';
    if (safeService.apiKey) safeService.apiKey = '***';

    res.status(201).json({ success: true, service: safeService });
  } catch (err) {
    console.error('Error adding DDNS service:', err);
    res.status(500).json({ success: false, error: 'Failed to add DDNS service' });
  }
});

/**
 * PUT /services/:id - Update a DDNS service configuration
 */
router.put('/services/:id', (req, res) => {
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

    // Return with sensitive fields redacted
    const safeService = { ...service };
    if (safeService.token) safeService.token = '***';
    if (safeService.password) safeService.password = '***';
    if (safeService.apiToken) safeService.apiToken = '***';
    if (safeService.apiKey) safeService.apiKey = '***';

    res.json({ success: true, service: safeService });
  } catch (err) {
    console.error('Error updating DDNS service:', err);
    res.status(500).json({ success: false, error: 'Failed to update DDNS service' });
  }
});

/**
 * DELETE /services/:id - Remove a DDNS service
 */
router.delete('/services/:id', (req, res) => {
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

/**
 * POST /services/:id/update - Force an IP update for a specific service
 */
router.post('/services/:id/update', ddnsLimiter, async (req, res) => {
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

/**
 * GET /public-ip - Get the current public IP address
 */
router.get('/public-ip', async (req, res) => {
  try {
    const ip = await getPublicIp();
    lastKnownIp = ip;
    res.json({ success: true, ip });
  } catch (err) {
    console.error('Error getting public IP:', err);
    res.status(500).json({ success: false, error: 'Failed to get public IP' });
  }
});

/**
 * GET /status - Get status of all DDNS services
 * Shows last update time, current IP, and any errors.
 */
router.get('/status', async (req, res) => {
  try {
    const data = getData();
    if (!data.network) data.network = {};
    const services = data.network.ddns || [];

    // Try to get current public IP
    let currentIp = lastKnownIp;
    try {
      currentIp = await getPublicIp();
      lastKnownIp = currentIp;
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

// --- Background Updater ---

/**
 * Background DDNS updater.
 * Runs every 5 minutes, updates all enabled services if the IP has changed.
 */
const DDNS_UPDATE_INTERVAL = 5 * 60 * 1000; // 5 minutes

const ddnsInterval = setInterval(async () => {
  try {
    // Get current public IP
    let currentIp;
    try {
      currentIp = await getPublicIp();
    } catch (ipErr) {
      console.error('DDNS background updater: failed to get public IP:', ipErr.message);
      return;
    }

    // Skip update if IP hasn't changed
    if (currentIp === lastKnownIp) {
      return;
    }

    console.log(`DDNS: IP changed from ${lastKnownIp} to ${currentIp}, updating services...`);
    lastKnownIp = currentIp;

    // Get all enabled services
    const data = getData();
    if (!data.network || !data.network.ddns) return;

    const enabledServices = data.network.ddns.filter(s => s.enabled);
    if (enabledServices.length === 0) return;

    // Update each enabled service
    for (const service of enabledServices) {
      try {
        await updateService(service, currentIp);

        // Update stored status
        service.lastUpdate = new Date().toISOString();
        service.lastIp = currentIp;
        service.lastError = null;

        serviceStatus.set(service.id, {
          lastUpdate: service.lastUpdate,
          lastIp: currentIp,
          lastError: null
        });

        console.log(`DDNS: Updated ${service.provider} (${getServiceDisplayName(service)}) to ${currentIp}`);
      } catch (updateErr) {
        service.lastError = updateErr.message;
        serviceStatus.set(service.id, {
          lastUpdate: service.lastUpdate,
          lastIp: service.lastIp,
          lastError: updateErr.message
        });
        console.error(`DDNS: Failed to update ${service.provider} (${getServiceDisplayName(service)}):`, updateErr.message);
      }
    }

    // Save all updates
    saveData(data);
  } catch (err) {
    console.error('DDNS background updater error:', err);
  }
}, DDNS_UPDATE_INTERVAL);

// Prevent the interval from keeping the process alive if it should exit
if (ddnsInterval.unref) {
  ddnsInterval.unref();
}

module.exports = router;
