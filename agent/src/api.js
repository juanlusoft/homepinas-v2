/**
 * NAS API Client - Communicate with HomePiNAS backend
 */

const https = require('https');

class NASApi {
  constructor() {
    this.agent = new https.Agent({ rejectUnauthorized: false });
  }

  _request(method, address, port, path, headers = {}, body = null) {
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
          ...headers,
        },
      };

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

      req.on('error', (err) => reject(new Error(`Connection failed: ${err.message}`)));
      req.on('timeout', () => { req.destroy(); reject(new Error('Connection timeout')); });

      if (body) req.write(JSON.stringify(body));
      req.end();
    });
  }

  async testConnection(address, port) {
    return this._request('GET', address, port, '/system/stats');
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
