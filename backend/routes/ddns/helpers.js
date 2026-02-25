/**
 * HomePiNAS v2 - DDNS Helpers
 * Provider-specific updaters and utilities
 */

// Store last known public IP to skip unnecessary updates
let lastKnownIp = null;

// Store per-service status in memory (last update time, errors, etc.)
const serviceStatus = new Map();

/** Supported DDNS providers */
const VALID_PROVIDERS = ['duckdns', 'noip', 'cloudflare', 'dynu'];

/**
 * Get the current public IP address via ipify.
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
 */
function generateId() {
  return Date.now().toString(36);
}

/**
 * Get the display name/hostname for a service.
 */
function getServiceDisplayName(service) {
  return service.domain || service.hostname || service.provider;
}

/**
 * Validate service fields based on provider type.
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

/**
 * Redact sensitive fields from a service object
 */
function redactSensitiveFields(service) {
  const safe = { ...service };
  if (safe.token) safe.token = '***';
  if (safe.password) safe.password = '***';
  if (safe.apiToken) safe.apiToken = '***';
  if (safe.apiKey) safe.apiKey = '***';
  return safe;
}

module.exports = {
  lastKnownIp,
  setLastKnownIp: (ip) => { lastKnownIp = ip; },
  getLastKnownIp: () => lastKnownIp,
  serviceStatus,
  VALID_PROVIDERS,
  getPublicIp,
  updateService,
  generateId,
  getServiceDisplayName,
  validateServiceFields,
  redactSensitiveFields
};
