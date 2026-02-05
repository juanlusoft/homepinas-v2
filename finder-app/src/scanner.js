const Bonjour = require('bonjour-service').Bonjour;
const net = require('net');
const os = require('os');
const http = require('http');

const NAS_PORT = 3001;
const SCAN_TIMEOUT = 3000;

/**
 * Escanea la red buscando dispositivos HomePiNAS
 * Métodos: mDNS, hostname, subnet scan
 */
async function scanNetwork() {
  const devices = new Map();
  
  // Ejecutar todos los métodos en paralelo
  const results = await Promise.allSettled([
    scanMDNS(),
    scanSubnet(),
    scanKnownHostnames()
  ]);
  
  // Combinar resultados
  for (const result of results) {
    if (result.status === 'fulfilled' && result.value) {
      for (const device of result.value) {
        // Usar IP como key para evitar duplicados
        if (!devices.has(device.ip)) {
          devices.set(device.ip, device);
        }
      }
    }
  }
  
  return Array.from(devices.values());
}

/**
 * Busca via mDNS/Bonjour
 */
function scanMDNS() {
  return new Promise((resolve) => {
    const devices = [];
    const bonjour = new Bonjour();
    
    const browser = bonjour.find({ type: 'http' }, (service) => {
      // Buscar servicios HomePiNAS
      if (service.name?.toLowerCase().includes('homepinas') || 
          service.port === NAS_PORT) {
        const ip = service.addresses?.find(a => a.includes('.')) || service.host;
        if (ip) {
          devices.push({
            ip: ip.replace(/\.local$/, ''),
            name: service.name || 'HomePiNAS',
            hostname: service.host || '',
            method: 'mDNS'
          });
        }
      }
    });
    
    setTimeout(() => {
      browser.stop();
      bonjour.destroy();
      resolve(devices);
    }, SCAN_TIMEOUT);
  });
}

/**
 * Escanea la subnet local en puerto 3001
 */
async function scanSubnet() {
  const devices = [];
  const localIPs = getLocalIPs();
  
  for (const localIP of localIPs) {
    const subnet = localIP.split('.').slice(0, 3).join('.');
    const promises = [];
    
    // Escanear rango 1-254
    for (let i = 1; i <= 254; i++) {
      const ip = `${subnet}.${i}`;
      promises.push(checkHomePiNAS(ip));
    }
    
    const results = await Promise.allSettled(promises);
    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) {
        devices.push(result.value);
      }
    }
  }
  
  return devices;
}

/**
 * Prueba hostnames conocidos
 */
async function scanKnownHostnames() {
  const devices = [];
  const hostnames = ['pinas', 'pinas.local', 'homepinas', 'homepinas.local', 'nas', 'nas.local'];
  
  const promises = hostnames.map(async (hostname) => {
    try {
      const { lookup } = require('dns').promises;
      const result = await lookup(hostname);
      return checkHomePiNAS(result.address, hostname);
    } catch {
      return null;
    }
  });
  
  const results = await Promise.allSettled(promises);
  for (const result of results) {
    if (result.status === 'fulfilled' && result.value) {
      devices.push(result.value);
    }
  }
  
  return devices;
}

/**
 * Verifica si una IP tiene HomePiNAS corriendo
 */
function checkHomePiNAS(ip, hostname = '') {
  return new Promise((resolve) => {
    const options = {
      hostname: ip,
      port: NAS_PORT,
      path: '/api/system/info',
      method: 'GET',
      timeout: 1500
    };
    
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const info = JSON.parse(data);
          if (info.product === 'HomePiNAS' || info.hostname) {
            resolve({
              ip,
              name: info.hostname || info.name || 'HomePiNAS',
              hostname: hostname || info.hostname || '',
              version: info.version || '',
              method: 'HTTP'
            });
          } else {
            resolve(null);
          }
        } catch {
          // Si el puerto responde pero no es JSON válido, podría ser HomePiNAS
          if (res.statusCode === 200 || res.statusCode === 401) {
            resolve({
              ip,
              name: hostname || 'HomePiNAS',
              hostname: hostname || '',
              method: 'HTTP'
            });
          } else {
            resolve(null);
          }
        }
      });
    });
    
    req.on('error', () => resolve(null));
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
    
    req.end();
  });
}

/**
 * Obtiene las IPs locales del sistema
 */
function getLocalIPs() {
  const ips = [];
  const interfaces = os.networkInterfaces();
  
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        ips.push(iface.address);
      }
    }
  }
  
  return ips;
}

module.exports = { scanNetwork };
