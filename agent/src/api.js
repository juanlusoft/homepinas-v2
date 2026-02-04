/**
 * NAS API Client - Communicate with HomePiNAS backend
 */

const https = require('https');

class NASApi {
  constructor() {
    this.agent = new https.Agent({ rejectUnauthorized: false });
  }

  _request(method, address, port, path, sessionId, body = null) {
    return new Promise((resolve, reject) => {
      const options = {
        hostname: address,
        port,
        path: `/api${path}`,
        method,
        agent: this.agent,
        timeout: 30000,
        headers: {
          'Content-Type': 'application/json',
        },
      };

      if (sessionId) {
        options.headers['X-Session-Id'] = sessionId;
      }

      const req = https.request(options, (res) => {
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

      req.on('error', (err) => reject(new Error(`Connexion failed: ${err.message}`)));
      req.on('timeout', () => { req.destroy(); reject(new Error('Connection timeout')); });

      if (body) {
        req.write(JSON.stringify(body));
      }
      req.end();
    });
  }

  async testConnection(address, port) {
    return this._request('GET', address, port, '/system/stats', null);
  }

  async login(address, port, username, password) {
    return this._request('POST', address, port, '/login', null, { username, password });
  }

  async registerDevice(address, port, sessionId, deviceInfo) {
    return this._request('POST', address, port, '/active-backup/devices', sessionId, deviceInfo);
  }

  async reportBackupResult(deviceId, status, details) {
    // This will be called to update the NAS with backup results
    // The NAS tracks this via the device status
    return { success: true };
  }

  async getDeviceStatus(address, port, sessionId, deviceId) {
    return this._request('GET', address, port, `/active-backup/devices/${deviceId}/status`, sessionId);
  }
}

module.exports = { NASApi };
