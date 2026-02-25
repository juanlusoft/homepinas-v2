/**
 * HomePiNAS v2 - VPN Server Routes (WireGuard)
 *
 * Gestión completa de servidor VPN WireGuard:
 * - Instalar/desinstalar WireGuard
 * - Activar/desactivar el servicio
 * - Crear/eliminar clientes con QR codes
 * - Ver estado y clientes conectados
 * - Configuración de puerto y DNS
 *
 * SECURITY:
 * - Claves privadas NUNCA se guardan en data.json
 * - Clave privada del servidor solo existe en /etc/wireguard/wg0.conf
 * - Claves privadas de clientes se guardan en /etc/wireguard/clients/<name>.conf
 * - data.json solo almacena metadatos (nombre, IP, publicKey, fecha, revoked)
 * - Solo usuarios admin pueden gestionar VPN (requireAdmin middleware)
 * - Interfaz de red detectada dinámicamente (no hardcoded eth0)
 * - wg syncconf para recargar sin desconectar peers
 */

const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/rbac');
const { logSecurityEvent, sudoExec } = require('../utils/security');
const { getData, saveData } = require('../utils/data');
const { execFile, spawn } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);
const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * Helper: ejecutar comando con stdin usando spawn
 */
function spawnWithStdin(cmd, args, stdinData) {
    return new Promise((resolve, reject) => {
        const proc = spawn(cmd, args);
        let stdout = '';
        let stderr = '';
        proc.stdout.on('data', (data) => { stdout += data; });
        proc.stderr.on('data', (data) => { stderr += data; });
        proc.on('close', (code) => {
            if (code !== 0) reject(new Error(`${cmd} failed (code ${code}): ${stderr}`));
            else resolve(stdout);
        });
        proc.on('error', (err) => reject(err));
        proc.stdin.write(stdinData);
        proc.stdin.end();
    });
}

// Directorio de configuración de WireGuard
const WG_DIR = '/etc/wireguard';
const WG_CONF = path.join(WG_DIR, 'wg0.conf');
const WG_CLIENTS_DIR = path.join(WG_DIR, 'clients');

// Estado de instalación en memoria (para proceso async)
const INSTALL_LOCK_FILE = path.join(os.tmpdir(), 'homepinas-vpn-install.lock');
let installState = {
    running: false,
    step: '',
    progress: 0,     // 0-100
    error: null,
    completed: false
};

// Al iniciar, comprobar si quedó un lock de instalación interrumpida
try {
    if (fs.existsSync(INSTALL_LOCK_FILE)) {
        const lockAge = Date.now() - fs.statSync(INSTALL_LOCK_FILE).mtimeMs;
        if (lockAge > 600000) { // > 10 minutos = instalación zombi
            fs.unlinkSync(INSTALL_LOCK_FILE);
            console.warn('[VPN] Lock de instalación huérfano eliminado (>10 min)');
        } else {
            installState.error = 'Instalación interrumpida por reinicio del servidor. Inténtelo de nuevo.';
            fs.unlinkSync(INSTALL_LOCK_FILE);
        }
    }
} catch { /* ignore */ }

// Todas las rutas requieren autenticación + admin
router.use(requireAuth);
router.use(requireAdmin);

// --- Helpers ---

/**
 * Comprobar si WireGuard está instalado
 */
async function isWireguardInstalled() {
    try {
        await execFileAsync('which', ['wg']);
        return true;
    } catch {
        return false;
    }
}

/**
 * Comprobar si el servicio wg-quick@wg0 está activo
 */
async function getServiceStatus() {
    try {
        const { stdout } = await execFileAsync('systemctl', ['is-active', 'wg-quick@wg0']);
        return stdout.trim();
    } catch (err) {
        return err.stdout ? err.stdout.trim() : 'inactive';
    }
}

/**
 * Comprobar si el servicio está habilitado al arranque
 */
async function isServiceEnabled() {
    try {
        const { stdout } = await execFileAsync('systemctl', ['is-enabled', 'wg-quick@wg0']);
        return stdout.trim() === 'enabled';
    } catch {
        return false;
    }
}

/**
 * Detectar la interfaz de red predeterminada dinámicamente.
 * Usa `ip route show default` para obtener la interfaz real.
 * En Pi CM5 puede ser end0, eth1, wlan0, etc.
 */
async function getDefaultInterface() {
    try {
        const { stdout } = await execFileAsync('ip', ['route', 'show', 'default']);
        const match = stdout.match(/dev\s+(\S+)/);
        if (match && match[1]) return match[1];
    } catch (e) {
        console.warn('[VPN] No se pudo detectar interfaz por defecto via ip route:', e.message);
    }

    // Fallback: buscar primera interfaz IPv4 no-interna
    const interfaces = os.networkInterfaces();
    for (const [name, addrs] of Object.entries(interfaces)) {
        for (const addr of addrs) {
            if (addr.family === 'IPv4' && !addr.internal) {
                return name;
            }
        }
    }
    return 'eth0';
}

/**
 * Obtener la IP local principal del servidor
 */
function getServerLocalIP() {
    const interfaces = os.networkInterfaces();
    for (const iface of Object.values(interfaces)) {
        for (const addr of iface) {
            if (addr.family === 'IPv4' && !addr.internal) {
                return addr.address;
            }
        }
    }
    return '127.0.0.1';
}

/**
 * Obtener la IP pública del servidor
 */
async function getPublicIP() {
    try {
        const response = await fetch('https://api.ipify.org?format=json');
        if (!response.ok) throw new Error('HTTP error');
        const data = await response.json();
        return data.ip;
    } catch {
        return null;
    }
}

/**
 * Generar par de claves WireGuard
 */
async function generateKeyPair() {
    const { stdout: privateKey } = await execFileAsync('wg', ['genkey']);
    const privKey = privateKey.trim();

    // Pasar la clave privada por stdin a wg pubkey
    const pubKeyRaw = await spawnWithStdin('wg', ['pubkey'], privKey);
    const publicKey = pubKeyRaw.trim();

    return {
        privateKey: privKey,
        publicKey
    };
}

/**
 * Generar clave pre-compartida (PSK)
 */
async function generatePresharedKey() {
    const { stdout } = await execFileAsync('wg', ['genpsk']);
    return stdout.trim();
}

/**
 * Leer la configuración VPN almacenada en data.json
 * NOTA: Solo metadatos, NUNCA claves privadas
 */
function getVpnConfig() {
    const data = getData();
    if (!data.vpn) {
        data.vpn = {
            installed: false,
            port: 51820,
            dns: '1.1.1.1, 8.8.8.8',
            subnet: '10.66.66.0/24',
            endpoint: '',
            serverPublicKey: '',
            clients: []
        };
    }
    return data.vpn;
}

/**
 * Guardar configuración VPN (solo metadatos)
 */
function saveVpnConfig(vpnConfig) {
    const data = getData();
    data.vpn = vpnConfig;
    saveData(data);
}

/**
 * Generar el archivo wg0.conf del servidor.
 * Requiere la clave privada del servidor como parámetro (no la lee de data.json).
 * Detecta la interfaz de red dinámicamente.
 * pskMap: opcional, Map<publicKey, presharedKey> para clientes nuevos que aún no están en wg0.conf.
 * Para clientes existentes, el PSK se lee del wg0.conf actual.
 */
async function generateServerConfig(vpnConfig, serverPrivateKey, netInterface, pskMap) {
    const serverAddr = vpnConfig.subnet.split('/')[0].replace(/\.\d+$/, '.1');
    const iface = netInterface || 'eth0';
    let config = '[Interface]\n';
    config += `Address = ${serverAddr}/24\n`;
    config += `ListenPort = ${vpnConfig.port}\n`;
    config += `PrivateKey = ${serverPrivateKey}\n`;
    config += `PostUp = iptables -A FORWARD -i wg0 -j ACCEPT; iptables -t nat -A POSTROUTING -o ${iface} -j MASQUERADE\n`;
    config += `PostDown = iptables -D FORWARD -i wg0 -j ACCEPT; iptables -t nat -D POSTROUTING -o ${iface} -j MASQUERADE\n`;

    // Añadir peers (clientes) - publicKey y presharedKey (leída de disco o del map de nuevos)
    const clients = vpnConfig.clients || [];
    for (const client of clients) {
        if (!client.revoked) {
            // PSK: primero del map (cliente nuevo), luego del wg0.conf existente
            let psk = pskMap?.get(client.publicKey) || null;
            if (!psk) {
                psk = await readPresharedKeyFromConf(client.publicKey);
            }
            config += `\n# ${client.name}\n`;
            config += '[Peer]\n';
            config += `PublicKey = ${client.publicKey}\n`;
            if (psk) config += `PresharedKey = ${psk}\n`;
            config += `AllowedIPs = ${client.address}/32\n`;
        }
    }

    return config;
}

/**
 * Generar configuración de cliente.
 * La clave privada del cliente se lee del archivo en disco, no de data.json.
 */
function generateClientConfig(vpnConfig, clientPrivateKey, clientAddress, clientPresharedKey) {
    const serverAddress = vpnConfig.endpoint || getServerLocalIP();
    let config = '[Interface]\n';
    config += `PrivateKey = ${clientPrivateKey}\n`;
    config += `Address = ${clientAddress}/32\n`;
    config += `DNS = ${vpnConfig.dns}\n`;
    config += '\n';
    config += '[Peer]\n';
    config += `PublicKey = ${vpnConfig.serverPublicKey}\n`;
    config += `PresharedKey = ${clientPresharedKey}\n`;
    config += `Endpoint = ${serverAddress}:${vpnConfig.port}\n`;
    config += 'AllowedIPs = 0.0.0.0/0, ::/0\n';
    config += 'PersistentKeepalive = 25\n';
    return config;
}

/**
 * Escribir la configuración del servidor al disco
 */
/**
 * @param {object} vpnConfig
 * @param {string} serverPrivateKey
 * @param {Map<string,string>} [pskMap] - Map<publicKey, presharedKey> for new clients not yet in wg0.conf
 */
async function writeServerConfig(vpnConfig, serverPrivateKey, pskMap) {
    const netInterface = await getDefaultInterface();
    const config = await generateServerConfig(vpnConfig, serverPrivateKey, netInterface, pskMap);
    const tmpFile = '/tmp/wg0.conf.tmp';
    fs.writeFileSync(tmpFile, config, { mode: 0o600 });
    await sudoExec('cp', [tmpFile, WG_CONF]);
    await sudoExec('chmod', ['600', WG_CONF]);
    fs.unlinkSync(tmpFile);
}

/**
 * Guardar configuración de cliente en /etc/wireguard/clients/<name>.conf
 */
async function saveClientConfFile(clientName, configContent) {
    const tmpFile = `/tmp/vpn-client-${clientName}.conf`;
    const destFile = path.join(WG_CLIENTS_DIR, `${clientName}.conf`);
    fs.writeFileSync(tmpFile, configContent, { mode: 0o600 });
    await sudoExec('cp', [tmpFile, destFile]);
    await sudoExec('chmod', ['600', destFile]);
    fs.unlinkSync(tmpFile);
}

/**
 * Leer configuración de cliente desde /etc/wireguard/clients/<name>.conf
 */
async function readClientConfFile(clientName) {
    const confPath = path.join(WG_CLIENTS_DIR, `${clientName}.conf`);
    try {
        const { stdout } = await sudoExec('cat', [confPath]);
        return stdout;
    } catch {
        return null;
    }
}

/**
 * Eliminar configuración de cliente del disco de forma segura.
 * Intenta shred (sobrescribe + elimina), fallback a rm -f.
 */
async function deleteClientConfFile(clientName) {
    const confPath = path.join(WG_CLIENTS_DIR, `${clientName}.conf`);
    try {
        // shred: sobrescribe con datos aleatorios 3 veces y luego elimina
        await sudoExec('shred', ['-u', '-z', confPath], { timeout: 10000 });
    } catch {
        // shred puede no estar disponible; fallback a rm -f
        try {
            await sudoExec('rm', ['-f', confPath], { timeout: 5000 });
        } catch {
            // Archivo puede no existir → ok
        }
    }
}

/**
 * Leer la clave privada del servidor desde wg0.conf
 */
async function readServerPrivateKey() {
    try {
        const { stdout } = await sudoExec('cat', [WG_CONF]);
        const match = stdout.match(/PrivateKey\s*=\s*(\S+)/);
        return match ? match[1] : null;
    } catch {
        return null;
    }
}

/**
 * Leer el PresharedKey de un peer desde wg0.conf, buscando por su PublicKey.
 * Devuelve null si no se encuentra.
 */
async function readPresharedKeyFromConf(publicKey) {
    try {
        const { stdout } = await sudoExec('cat', [WG_CONF]);
        // Parse peers: split por [Peer]
        const sections = stdout.split(/^\[Peer\]/m);
        for (const section of sections) {
            if (section.includes(publicKey)) {
                const pskMatch = section.match(/PresharedKey\s*=\s*(\S+)/);
                return pskMatch ? pskMatch[1] : null;
            }
        }
    } catch {
        // ignore
    }
    return null;
}

/**
 * Recargar configuración de WireGuard sin desconectar peers.
 * Genera un stripped config (sin PostUp/PostDown que wg no entiende)
 * y usa wg syncconf para hot-reload. Si falla, hace restart completo.
 */
async function reloadWireguard() {
    const status = await getServiceStatus();
    if (status !== 'active') return;

    try {
        // Leer wg0.conf y eliminar las líneas que wg syncconf no soporta
        // (Address, PostUp, PostDown, DNS, SaveConfig)
        const { stdout: fullConf } = await sudoExec('cat', [WG_CONF]);
        const unsupportedKeys = /^\s*(Address|PostUp|PostDown|DNS|SaveConfig)\s*=/i;
        const strippedLines = fullConf.split('\n').filter(line => !unsupportedKeys.test(line));
        const stripped = strippedLines.join('\n');

        const tmpStripped = '/tmp/wg0-stripped.conf';
        fs.writeFileSync(tmpStripped, stripped, { mode: 0o600 });

        await sudoExec('wg', ['syncconf', 'wg0', tmpStripped]);
        fs.unlinkSync(tmpStripped);
        console.log('[VPN] Configuración recargada con wg syncconf (sin desconectar peers)');
    } catch (e) {
        console.warn('[VPN] wg syncconf falló, haciendo restart completo:', e.message);
        try {
            await sudoExec('systemctl', ['restart', 'wg-quick@wg0']);
        } catch (restartErr) {
            console.error('[VPN] Error en restart fallback:', restartErr.message);
        }
    }
}

/**
 * Liberar locks de dpkg/apt de forma segura.
 * Solo actúa si los lock files existen (indicando locks huérfanos).
 * Usa SIGTERM primero, espera, y solo SIGKILL si es necesario.
 * Siempre ejecuta dpkg --configure -a para reparar estado corrupto.
 */
async function releaseDpkgLocks() {
    const lockFiles = [
        '/var/lib/dpkg/lock-frontend',
        '/var/lib/dpkg/lock',
        '/var/lib/apt/lists/lock',
        '/var/cache/apt/archives/lock'
    ];

    // Comprobar si hay locks reales antes de matar nada
    let hasLocks = false;
    for (const lockFile of lockFiles) {
        try {
            await sudoExec('fuser', [lockFile], { timeout: 5000 });
            hasLocks = true;
            break;
        } catch {
            // fuser falla si el archivo no está en uso → ok
        }
    }

    if (!hasLocks) {
        console.log('[VPN] No se detectaron locks de dpkg activos');
        return;
    }

    // 1. Intento graceful: SIGTERM primero
    const processNames = ['apt-get', 'apt', 'dpkg'];
    for (const procName of processNames) {
        try {
            await sudoExec('killall', ['-TERM', procName], { timeout: 5000 });
            console.log(`[VPN] SIGTERM enviado a ${procName}`);
        } catch {
            // No hay proceso corriendo → ok
        }
    }

    // Esperar a que terminen normalmente
    await new Promise(resolve => setTimeout(resolve, 3000));

    // 2. Solo si aún hay locks, SIGKILL como último recurso
    for (const lockFile of lockFiles) {
        try {
            await sudoExec('fuser', ['-k', lockFile], { timeout: 5000 });
        } catch {
            // ok
        }
    }

    await new Promise(resolve => setTimeout(resolve, 1000));

    // 3. Eliminar lock files huérfanos
    for (const lockFile of lockFiles) {
        try {
            await sudoExec('rm', ['-f', lockFile], { timeout: 5000 });
        } catch {
            // Puede que no exista → ok
        }
    }

    console.log('[VPN] Locks de dpkg liberados');
}

/**
 * Obtener siguiente IP disponible en la subred
 */
function getNextClientIP(vpnConfig) {
    const baseParts = vpnConfig.subnet.split('/')[0].split('.');
    const usedIPs = new Set();

    // .1 es el servidor
    usedIPs.add(1);

    for (const client of (vpnConfig.clients || [])) {
        const lastOctet = parseInt(client.address.split('.').pop());
        usedIPs.add(lastOctet);
    }

    // Buscar siguiente IP libre (2-254)
    for (let i = 2; i <= 254; i++) {
        if (!usedIPs.has(i)) {
            return `${baseParts[0]}.${baseParts[1]}.${baseParts[2]}.${i}`;
        }
    }

    throw new Error('No hay IPs disponibles en la subred');
}

// --- Rutas ---

/**
 * GET /status - Estado general del servidor VPN
 */
router.get('/status', async (req, res) => {
    try {
        const installed = await isWireguardInstalled();
        const vpnConfig = getVpnConfig();

        let serviceStatus = 'inactive';
        let enabled = false;
        let connectedPeers = [];

        if (installed) {
            serviceStatus = await getServiceStatus();
            enabled = await isServiceEnabled();

            // Obtener peers conectados
            if (serviceStatus === 'active') {
                try {
                    const { stdout } = await sudoExec('wg', ['show', 'wg0', 'dump']);
                    const lines = stdout.trim().split('\n');
                    // Primera línea es el servidor, resto son peers
                    for (let i = 1; i < lines.length; i++) {
                        const parts = lines[i].split('\t');
                        if (parts.length >= 8) {
                            const publicKey = parts[0];
                            const endpoint = parts[2];
                            const allowedIps = parts[3];
                            const latestHandshake = parseInt(parts[4]);
                            const transferRx = parseInt(parts[5]);
                            const transferTx = parseInt(parts[6]);

                            // Buscar nombre del cliente por su clave pública
                            const client = (vpnConfig.clients || []).find(c => c.publicKey === publicKey);

                            connectedPeers.push({
                                name: client ? client.name : 'Desconocido',
                                publicKey: publicKey.substring(0, 12) + '...',
                                endpoint: endpoint === '(none)' ? null : endpoint,
                                allowedIps,
                                latestHandshake: latestHandshake > 0 ? new Date(latestHandshake * 1000).toISOString() : null,
                                transferRx,
                                transferTx,
                                connected: latestHandshake > 0 && (Date.now() / 1000 - latestHandshake) < 180
                            });
                        }
                    }
                } catch (e) {
                    console.error('[VPN] Error leyendo peers:', e.message);
                }
            }
        }

        // Obtener IP pública y detectar si el endpoint es una IP local
        let publicIP = vpnConfig.endpoint || null;
        let endpointIsLocal = false;
        if (!publicIP) {
            publicIP = await getPublicIP();
        }
        // Comprobar si el endpoint configurado es una IP local/privada
        const configuredEndpoint = vpnConfig.endpoint || publicIP || '';
        if (configuredEndpoint) {
            endpointIsLocal = /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|127\.)/.test(configuredEndpoint);
        }

        const clients = (vpnConfig.clients || []).map(c => ({
            id: c.id,
            name: c.name,
            address: c.address,
            publicKey: c.publicKey,
            createdAt: c.createdAt,
            revoked: c.revoked || false
        }));

        res.json({
            success: true,
            installed,
            service: serviceStatus,
            running: serviceStatus === 'active',
            enabled,
            port: vpnConfig.port,
            dns: vpnConfig.dns,
            subnet: vpnConfig.subnet,
            endpoint: vpnConfig.endpoint,
            publicIP,
            endpointIsLocal,
            clientCount: clients.filter(c => !c.revoked).length,
            clients,
            connectedPeers
        });
    } catch (err) {
        console.error('[VPN] Error obteniendo estado:', err);
        res.status(500).json({ success: false, error: 'Error obteniendo estado VPN' });
    }
});

/**
 * GET /install/progress - Obtener progreso de la instalación en curso
 */
router.get('/install/progress', (req, res) => {
    res.json({
        success: true,
        ...installState
    });
});

/**
 * POST /install - Instalar WireGuard (async - responde inmediatamente)
 * El progreso se consulta via GET /install/progress
 */
router.post('/install', async (req, res) => {
    try {
        const installed = await isWireguardInstalled();
        if (installed) {
            return res.json({ success: true, message: 'WireGuard ya está instalado' });
        }

        if (installState.running) {
            return res.json({ success: true, message: 'Instalación en progreso', installing: true });
        }

        // Iniciar instalación en background
        installState = { running: true, step: 'Iniciando...', progress: 0, error: null, completed: false };
        res.json({ success: true, message: 'Instalación iniciada', installing: true });

        // Ejecutar instalación async (no bloquea la respuesta HTTP)
        runInstallBackground(req.user).catch(err => {
            console.error('[VPN] Error en instalación background:', err);
            installState.running = false;
            installState.error = err.message;
        });

    } catch (err) {
        console.error('[VPN] Error instalando:', err);
        res.status(500).json({ success: false, error: `Error instalando WireGuard: ${err.message}` });
    }
});

/**
 * Proceso de instalación en background
 */
async function runInstallBackground(user) {
    // Crear lock file para detectar reinicio durante instalación
    try { fs.writeFileSync(INSTALL_LOCK_FILE, String(Date.now())); } catch { /* ignore */ }

    try {
        // Paso 1: Liberar locks de dpkg (matar procesos zombie, eliminar locks huérfanos)
        installState.step = 'Liberando locks del sistema...';
        installState.progress = 5;
        await releaseDpkgLocks();

        // Opciones para evitar prompts interactivos de dpkg/apt
        const nonInteractiveEnv = { env: { ...process.env, DEBIAN_FRONTEND: 'noninteractive' } };

        // Paso 2: Reparar dpkg si necesario
        installState.step = 'Verificando estado de paquetes...';
        installState.progress = 10;
        try {
            await sudoExec('dpkg', ['--configure', '-a'], { timeout: 120000, ...nonInteractiveEnv });
        } catch (e) {
            console.warn('[VPN] dpkg --configure -a falló (puede no ser necesario):', e.message);
        }

        // Paso 3: apt-get update
        installState.step = 'Actualizando repositorios...';
        installState.progress = 20;
        await sudoExec('apt-get', ['update'], { timeout: 120000, ...nonInteractiveEnv });

        // Paso 4: Instalar paquetes (el más lento)
        installState.step = 'Instalando WireGuard y herramientas...';
        installState.progress = 35;
        await sudoExec('apt-get', ['install', '-y', '-o', 'Dpkg::Options::=--force-confold', 'wireguard', 'wireguard-tools', 'qrencode'], { timeout: 300000, ...nonInteractiveEnv });

        // Paso 5: IP forwarding
        installState.step = 'Configurando IP forwarding...';
        installState.progress = 70;
        const sysctlContent = 'net.ipv4.ip_forward=1\nnet.ipv6.conf.all.forwarding=1\n';
        const tmpSysctl = '/tmp/99-wireguard.conf';
        fs.writeFileSync(tmpSysctl, sysctlContent);
        await sudoExec('cp', [tmpSysctl, '/etc/sysctl.d/99-wireguard.conf']);
        fs.unlinkSync(tmpSysctl);
        await sudoExec('sysctl', ['--system'], { timeout: 10000 });

        // Paso 6: Crear directorio
        installState.step = 'Creando directorios...';
        installState.progress = 80;
        await sudoExec('mkdir', ['-p', WG_CLIENTS_DIR]);
        await sudoExec('chmod', ['700', WG_DIR]);

        // Paso 7: Generar claves
        installState.step = 'Generando claves del servidor...';
        installState.progress = 85;
        const serverKeys = await generateKeyPair();

        // Paso 8: Configurar
        installState.step = 'Guardando configuración...';
        installState.progress = 90;
        const vpnConfig = getVpnConfig();
        vpnConfig.installed = true;
        vpnConfig.serverPublicKey = serverKeys.publicKey;

        if (!vpnConfig.endpoint) {
            const data = getData();
            const ddnsServices = (data.network && data.network.ddns) || [];
            const activeDDNS = ddnsServices.find(s => s.enabled);
            if (activeDDNS) {
                vpnConfig.endpoint = activeDDNS.domain || activeDDNS.hostname;
            } else {
                const publicIP = await getPublicIP();
                vpnConfig.endpoint = publicIP || getServerLocalIP();
            }
        }

        await writeServerConfig(vpnConfig, serverKeys.privateKey);
        saveVpnConfig(vpnConfig);

        // Completado
        installState.step = '¡Instalación completada!';
        installState.progress = 100;
        installState.completed = true;
        installState.running = false;
        try { fs.unlinkSync(INSTALL_LOCK_FILE); } catch { /* ignore */ }

        logSecurityEvent('vpn_installed', { user, port: vpnConfig.port });
        console.log('[VPN] Instalación completada exitosamente');

    } catch (err) {
        console.error('[VPN] Error en instalación:', err);
        installState.step = `Error: ${err.message}`;
        installState.error = err.message;
        installState.running = false;
        try { fs.unlinkSync(INSTALL_LOCK_FILE); } catch { /* ignore */ }
    }
}

/**
 * POST /start - Activar servicio VPN
 */
router.post('/start', async (req, res) => {
    try {
        const installed = await isWireguardInstalled();
        if (!installed) {
            return res.status(400).json({ success: false, error: 'WireGuard no está instalado' });
        }

        await sudoExec('systemctl', ['enable', 'wg-quick@wg0']);
        await sudoExec('systemctl', ['start', 'wg-quick@wg0']);

        // Verificar
        await new Promise(resolve => setTimeout(resolve, 1000));
        const status = await getServiceStatus();

        logSecurityEvent('vpn_started', { user: req.user });

        res.json({
            success: true,
            message: 'Servidor VPN activado',
            service: status,
            running: status === 'active'
        });
    } catch (err) {
        console.error('[VPN] Error iniciando:', err);
        res.status(500).json({ success: false, error: `Error iniciando VPN: ${err.message}` });
    }
});

/**
 * POST /stop - Detener servicio VPN
 */
router.post('/stop', async (req, res) => {
    try {
        await sudoExec('systemctl', ['stop', 'wg-quick@wg0']);
        await sudoExec('systemctl', ['disable', 'wg-quick@wg0']);

        logSecurityEvent('vpn_stopped', { user: req.user });

        res.json({ success: true, message: 'Servidor VPN detenido' });
    } catch (err) {
        console.error('[VPN] Error deteniendo:', err);
        res.status(500).json({ success: false, error: `Error deteniendo VPN: ${err.message}` });
    }
});

/**
 * POST /restart - Reiniciar servicio VPN
 */
router.post('/restart', async (req, res) => {
    try {
        await sudoExec('systemctl', ['restart', 'wg-quick@wg0']);

        await new Promise(resolve => setTimeout(resolve, 1000));
        const status = await getServiceStatus();

        logSecurityEvent('vpn_restarted', { user: req.user });

        res.json({
            success: true,
            message: 'Servidor VPN reiniciado',
            service: status,
            running: status === 'active'
        });
    } catch (err) {
        console.error('[VPN] Error reiniciando:', err);
        res.status(500).json({ success: false, error: `Error reiniciando VPN: ${err.message}` });
    }
});

/**
 * PUT /config - Actualizar configuración del servidor VPN
 */
router.put('/config', async (req, res) => {
    try {
        const { port, dns, endpoint } = req.body;
        const vpnConfig = getVpnConfig();

        // Validar puerto
        if (port !== undefined) {
            const portNum = parseInt(port);
            if (isNaN(portNum) || portNum < 1024 || portNum > 65535) {
                return res.status(400).json({ success: false, error: 'Puerto inválido (1024-65535)' });
            }
            // Comprobar si el puerto ya está en uso por otro servicio
            if (portNum !== vpnConfig.port) {
                try {
                    const { stdout } = await execFileAsync('ss', ['-tulnp']);
                    const portInUse = stdout.split('\n').some(line =>
                        line.includes(`:${portNum} `) && !line.includes('wg')
                    );
                    if (portInUse) {
                        return res.status(400).json({ success: false, error: `Puerto ${portNum} ya está en uso por otro servicio` });
                    }
                } catch {
                    // ss no disponible, continuar sin validación
                }
            }
            vpnConfig.port = portNum;
        }

        // Validar DNS
        if (dns !== undefined) {
            if (typeof dns !== 'string' || dns.length > 200) {
                return res.status(400).json({ success: false, error: 'DNS inválido' });
            }
            vpnConfig.dns = dns.trim();
        }

        // Validar endpoint
        if (endpoint !== undefined) {
            if (typeof endpoint !== 'string' || endpoint.length > 253) {
                return res.status(400).json({ success: false, error: 'Endpoint inválido' });
            }
            vpnConfig.endpoint = endpoint.trim();
        }

        // Reescribir configuración (leer clave privada del servidor desde disco)
        const serverPrivateKey = await readServerPrivateKey();
        if (serverPrivateKey) {
            await writeServerConfig(vpnConfig, serverPrivateKey);
        }
        saveVpnConfig(vpnConfig);

        // Reiniciar si estaba activo (cambio de puerto requiere restart completo)
        const status = await getServiceStatus();
        if (status === 'active') {
            await sudoExec('systemctl', ['restart', 'wg-quick@wg0']);
        }

        logSecurityEvent('vpn_config_updated', { user: req.user, port: vpnConfig.port });

        res.json({ success: true, message: 'Configuración actualizada' });
    } catch (err) {
        console.error('[VPN] Error actualizando config:', err);
        res.status(500).json({ success: false, error: `Error actualizando configuración: ${err.message}` });
    }
});

/**
 * POST /clients - Crear un nuevo cliente VPN
 */
router.post('/clients', async (req, res) => {
    try {
        const { name } = req.body;

        if (!name || typeof name !== 'string') {
            return res.status(400).json({ success: false, error: 'Nombre de cliente requerido' });
        }

        // Validar nombre (solo alfanumérico, guiones, guiones bajos)
        const safeName = name.trim();
        if (!/^[a-zA-Z0-9_-]{1,32}$/.test(safeName)) {
            return res.status(400).json({ success: false, error: 'Nombre inválido (solo letras, números, - y _, máx 32 caracteres)' });
        }

        const vpnConfig = getVpnConfig();

        // Comprobar nombre duplicado
        if (vpnConfig.clients.some(c => c.name === safeName && !c.revoked)) {
            return res.status(400).json({ success: false, error: 'Ya existe un cliente con ese nombre' });
        }

        // Generar claves
        const clientKeys = await generateKeyPair();
        const presharedKey = await generatePresharedKey();
        const clientIP = getNextClientIP(vpnConfig);

        // En data.json solo guardamos metadatos (NO claves privadas NI material criptográfico)
        // PSK se almacena solo en wg0.conf y en el .conf del cliente
        const clientMeta = {
            id: Date.now().toString(36),
            name: safeName,
            publicKey: clientKeys.publicKey,
            address: clientIP,
            createdAt: new Date().toISOString(),
            revoked: false
        };

        vpnConfig.clients.push(clientMeta);
        saveVpnConfig(vpnConfig);

        // Reescribir config del servidor con el nuevo peer
        // Pass PSK via map since it's not yet in wg0.conf
        const pskMap = new Map([[clientKeys.publicKey, presharedKey]]);
        const serverPrivateKey = await readServerPrivateKey();
        if (serverPrivateKey) {
            await writeServerConfig(vpnConfig, serverPrivateKey, pskMap);
        }

        // Generar configuración del cliente (con clave privada)
        const clientConf = generateClientConfig(vpnConfig, clientKeys.privateKey, clientIP, presharedKey);

        // Guardar .conf del cliente en disco (clave privada solo aquí)
        await saveClientConfFile(safeName, clientConf);

        // Generar QR code como SVG
        let qrSvg = null;
        try {
            const stdout = await spawnWithStdin('qrencode', ['-t', 'SVG', '-o', '-'], clientConf);
            qrSvg = stdout;
        } catch (e) {
            console.warn('[VPN] No se pudo generar QR:', e.message);
        }

        // Si el servicio está activo, recargar sin desconectar peers
        await reloadWireguard();

        logSecurityEvent('vpn_client_created', {
            user: req.user,
            clientName: safeName,
            clientIP
        });

        res.status(201).json({
            success: true,
            client: {
                id: clientMeta.id,
                name: clientMeta.name,
                address: clientMeta.address,
                createdAt: clientMeta.createdAt
            },
            config: clientConf,
            qrSvg
        });
    } catch (err) {
        console.error('[VPN] Error creando cliente:', err);
        res.status(500).json({ success: false, error: `Error creando cliente: ${err.message}` });
    }
});

/**
 * GET /clients/:id/config - Obtener configuración de un cliente (para descargar/QR)
 * Lee la clave privada desde el archivo en disco, nunca de data.json
 */
router.get('/clients/:id/config', async (req, res) => {
    try {
        const vpnConfig = getVpnConfig();
        const client = vpnConfig.clients.find(c => c.id === req.params.id);

        if (!client) {
            return res.status(404).json({ success: false, error: 'Cliente no encontrado' });
        }

        if (client.revoked) {
            return res.status(400).json({ success: false, error: 'Cliente revocado' });
        }

        // Leer .conf del disco
        const clientConf = await readClientConfFile(client.name);
        if (!clientConf) {
            return res.status(404).json({ success: false, error: 'Archivo de configuración del cliente no encontrado' });
        }

        // Generar QR
        let qrSvg = null;
        try {
            const stdout = await spawnWithStdin('qrencode', ['-t', 'SVG', '-o', '-'], clientConf);
            qrSvg = stdout;
        } catch (e) {
            console.warn('[VPN] No se pudo generar QR:', e.message);
        }

        res.json({
            success: true,
            client: {
                id: client.id,
                name: client.name,
                address: client.address
            },
            config: clientConf,
            qrSvg
        });
    } catch (err) {
        console.error('[VPN] Error obteniendo config cliente:', err);
        res.status(500).json({ success: false, error: 'Error obteniendo configuración del cliente' });
    }
});

/**
 * DELETE /clients/:id - Revocar/eliminar un cliente VPN
 */
router.delete('/clients/:id', async (req, res) => {
    try {
        const vpnConfig = getVpnConfig();
        const clientIndex = vpnConfig.clients.findIndex(c => c.id === req.params.id);

        if (clientIndex === -1) {
            return res.status(404).json({ success: false, error: 'Cliente no encontrado' });
        }

        const client = vpnConfig.clients[clientIndex];
        client.revoked = true;
        client.revokedAt = new Date().toISOString();

        saveVpnConfig(vpnConfig);

        // Eliminar archivo .conf del cliente (contiene la clave privada)
        await deleteClientConfFile(client.name);

        // Reescribir config del servidor sin este peer
        const serverPrivateKey = await readServerPrivateKey();
        if (serverPrivateKey) {
            await writeServerConfig(vpnConfig, serverPrivateKey);
        }

        // Recargar sin desconectar otros peers
        await reloadWireguard();

        logSecurityEvent('vpn_client_revoked', {
            user: req.user,
            clientName: client.name,
            clientId: client.id
        });

        res.json({ success: true, message: `Cliente ${client.name} revocado` });
    } catch (err) {
        console.error('[VPN] Error revocando cliente:', err);
        res.status(500).json({ success: false, error: 'Error revocando cliente' });
    }
});

/**
 * POST /uninstall - Desinstalar WireGuard
 */
router.post('/uninstall', async (req, res) => {
    try {
        // Detener servicio
        try {
            await sudoExec('systemctl', ['stop', 'wg-quick@wg0']);
            await sudoExec('systemctl', ['disable', 'wg-quick@wg0']);
        } catch (e) {
            // Puede que ya esté parado
        }

        // Liberar locks de dpkg y reparar si necesario
        const nonInteractiveEnv = { env: { ...process.env, DEBIAN_FRONTEND: 'noninteractive' } };
        await releaseDpkgLocks();
        try {
            await sudoExec('dpkg', ['--configure', '-a'], { timeout: 120000, ...nonInteractiveEnv });
        } catch (e) {
            console.warn('[VPN] dpkg --configure -a falló:', e.message);
        }

        // Desinstalar paquetes
        await sudoExec('apt-get', ['remove', '-y', '-o', 'Dpkg::Options::=--force-confold', 'wireguard', 'wireguard-tools'], { timeout: 120000, ...nonInteractiveEnv });

        // Limpiar configuración local
        const vpnConfig = getVpnConfig();
        vpnConfig.installed = false;
        vpnConfig.serverPublicKey = '';
        vpnConfig.clients = [];
        saveVpnConfig(vpnConfig);

        logSecurityEvent('vpn_uninstalled', { user: req.user });

        res.json({ success: true, message: 'WireGuard desinstalado' });
    } catch (err) {
        console.error('[VPN] Error desinstalando:', err);
        res.status(500).json({ success: false, error: `Error desinstalando: ${err.message}` });
    }
});

module.exports = router;
