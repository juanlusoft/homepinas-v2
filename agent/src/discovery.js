/**
 * NAS Discovery - Find HomePiNAS on the local network
 * Methods: mDNS/Bonjour, hostname, subnet scan
 */

const https = require('https');
const os = require('os');

class NASDiscovery {
  constructor() {
    this.timeout = 5000;
  }

  async discover() {
    const results = [];

    // Method 1: Try mDNS/Bonjour
    try {
      const mdnsResults = await this._discoverMDNS();
      results.push(...mdnsResults);
    } catch (e) {}

    // Method 2: Try common hostnames
    const hostnames = ['homepinas.local', 'homepinas', 'nas.local'];
    for (const host of hostnames) {
      try {
        const result = await this._checkHost(host, 3001);
        if (result) results.push(result);
      } catch (e) {}
    }

    // Method 3: Subnet scan
    if (results.length === 0) {
      try {
        const scanResults = await this._scanSubnet();
        results.push(...scanResults);
      } catch (e) {}
    }

    // Deduplicate by IP
    const seen = new Set();
    return results.filter(r => {
      if (seen.has(r.address)) return false;
      seen.add(r.address);
      return true;
    });
  }

  async _discoverMDNS() {
    return new Promise((resolve) => {
      const results = [];
      try {
        const { Bonjour } = require('bonjour-service');
        const bonjour = new Bonjour();

        const browser = bonjour.find({ type: 'https' }, (service) => {
          if (service.name && service.name.toLowerCase().includes('homepinas')) {
            results.push({
              address: service.addresses?.[0] || service.host,
              port: service.port || 3001,
              name: service.name,
              method: 'mdns',
            });
          }
        });

        setTimeout(() => {
          browser.stop();
          bonjour.destroy();
          resolve(results);
        }, 3000);
      } catch (e) {
        resolve([]);
      }
    });
  }

  async _checkHost(host, port) {
    return new Promise((resolve) => {
      const req = https.get({
        hostname: host,
        port,
        path: '/api/system/stats',
        rejectAuthorized: false,
        timeout: this.timeout,
        agent: new https.Agent({ rejectUnauthorized: false }),
      }, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (json.cpuModel || json.hostname) {
              resolve({
                address: host,
                port,
                name: json.hostname || 'HomePiNAS',
                method: 'hostname',
              });
            } else {
              resolve(null);
            }
          } catch (e) {
            resolve(null);
          }
        });
      });

      req.on('error', () => resolve(null));
      req.on('timeout', () => { req.destroy(); resolve(null); });
    });
  }

  async _scanSubnet() {
    const localIP = this._getLocalIP();
    if (!localIP) return [];

    const subnet = localIP.replace(/\.\d+$/, '.');
    const results = [];
    const promises = [];

    for (let i = 1; i <= 254; i++) {
      const ip = subnet + i;
      if (ip === localIP) continue;

      promises.push(
        this._checkHost(ip, 3001).then(result => {
          if (result) results.push(result);
        }).catch(() => {})
      );

      // Batch: 30 concurrent
      if (promises.length >= 30) {
        await Promise.allSettled(promises.splice(0, 30));
      }
    }

    await Promise.allSettled(promises);
    return results;
  }

  _getLocalIP() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]) {
        if (iface.family === 'IPv4' && !iface.internal) {
          return iface.address;
        }
      }
    }
    return null;
  }
}

module.exports = { NASDiscovery };
