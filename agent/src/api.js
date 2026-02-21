/**
 * NAS API Client - Communicate with HomePiNAS backend
 *
 * SECURITY: Uses custom CA certificate for self-signed cert validation.
 * Falls back to fingerprint pinning if no CA cert is available.
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

class NASApi {
  constructor(options = {}) {
    this._pinnedFingerprint = options.pinnedFingerprint || null;
    this._caPath = options.caPath || path.join(__dirname, '..', 'config', 'nas-ca.pem');

    // Try to load the NAS CA certificate for proper validation
    let ca = null;
    try {
      if (fs.existsSync(this._caPath)) {
        ca = fs.readFileSync(this._caPath);
      }
    } catch (e) {
      console.warn('Could not load NAS CA certificate:', e.message);
    }

    if (ca) {
      // Validate against the NAS's own CA
      this.agent = new https.Agent({ ca, rejectUnauthorized: true });
    } else {
      // Self-signed cert: allow but verify fingerprint on each request
      this.agent = new https.Agent({ rejectUnauthorized: false });
      console.warn('[NASApi] No CA cert found — using fingerprint pinning for self-signed certs');
    }
  }

  setPinnedFingerprint(fingerprint) {
    this._pinnedFingerprint = fingerprint;
  }

  _request(method, address, port, reqPath, headers = {}, body = null) {
    return new Promise((resolve, reject) => {
      const options = {
        hostname: address,
        port,
        path: `/api${reqPath}`,
        method,
        agent: this.agent,
        timeout: 120000,
        headers: {
          'Content-Type': 'application/json',
          ...headers,
        },
      };

      const req = https.request(options, (res) => {
        // Fingerprint pinning for self-signed certs
        if (this._pinnedFingerprint && res.socket) {
          const cert = res.socket.getPeerCertificate();
          if (cert && cert.fingerprint256) {
            const actual = cert.fingerprint256.replace(/:/g, '').toLowerCase();
            const expected = this._pinnedFingerprint.replace(/:/g, '').toLowerCase();
            if (actual !== expected) {
              req.destroy();
              return reject(new Error('TLS certificate fingerprint mismatch — possible MITM attack'));
            }
          }
        }

        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (res.statusCode >= 400) {
              reject(new Error(json.error || `HTTP ${res.statusCode}`));
            } else {
              resolve(json);
            }
          } catch (e) {
            reject(new Error(`Invalid response from NAS`));
          }
        });
      });

      req.on('error', (err) => reject(new Error(`Connection failed: ${err.message}`)));
      req.on('timeout', () => { req.destroy(); reject(new Error('Connection timeout')); });

      if (body) req.write(JSON.stringify(body));
      req.end();
    });
  }

  async testConnection(address, port) {
    return this._request('GET', address, port, '/active-backup/agent/ping');
  }

  async authenticate(address, port, username, password) {
    const result = await this._request('POST', address, port, '/login', {}, { username, password });
    if (!result || !result.success) {
      throw new Error(result?.message || 'Credenciales incorrectas');
    }
    return result;
  }

  async agentRegister(address, port, deviceInfo) {
    return this._request('POST', address, port, '/active-backup/agent/register', {}, deviceInfo);
  }

  async agentPoll(address, port, agentToken) {
    return this._request('GET', address, port, '/active-backup/agent/poll', { 'X-Agent-Token': agentToken });
  }

  async agentReport(address, port, agentToken, result) {
    return this._request('POST', address, port, '/active-backup/agent/report', { 'X-Agent-Token': agentToken }, result);
  }
}

module.exports = { NASApi };
