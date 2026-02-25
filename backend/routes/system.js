/**
 * HomePiNAS - System Routes
 * v1.5.6 - Modular Architecture
 *
 * System monitoring: stats, fans, disks
 */

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const si = require('systeminformation');
const { execFileSync } = require('child_process');

const { requireAuth } = require('../middleware/auth');
const { logSecurityEvent } = require('../utils/security');
const { getData } = require('../utils/data');
const { validateFanId, validateFanMode } = require('../utils/sanitize');

// Fan mode presets configuration (v1.5.5 with hysteresis)
const FANCTL_CONF = '/usr/local/bin/homepinas-fanctl.conf';
const FAN_PRESETS = {
    silent: `# =========================================
# HomePinas Fan Control - SILENT preset
# Quiet operation, higher temperatures allowed
# v1.5.5 with hysteresis support
# =========================================

PWM1_T30=60
PWM1_T35=80
PWM1_T40=110
PWM1_T45=150
PWM1_TMAX=200

PWM2_T40=70
PWM2_T50=100
PWM2_T60=140
PWM2_TMAX=200

MIN_PWM1=60
MIN_PWM2=70
MAX_PWM=255

# Hysteresis: 5C means fans won't slow down until temp drops 5C below threshold
# Higher value = more stable fan speed, but slower response to cooling
HYST_TEMP=5
`,
    balanced: `# =========================================
# HomePinas Fan Control - BALANCED preset
# Recommended default settings
# v1.5.5 with hysteresis support
# =========================================

# PWM1 (HDD / SSD)
PWM1_T30=65
PWM1_T35=90
PWM1_T40=130
PWM1_T45=180
PWM1_TMAX=230

# PWM2 (NVMe + CPU)
PWM2_T40=80
PWM2_T50=120
PWM2_T60=170
PWM2_TMAX=255

# Safety limits
MIN_PWM1=65
MIN_PWM2=80
MAX_PWM=255

# Hysteresis: 3C is balanced between stability and responsiveness
HYST_TEMP=3
`,
    performance: `# =========================================
# HomePinas Fan Control - PERFORMANCE preset
# Cooling first, louder fans
# v1.5.5 with hysteresis support
# =========================================

PWM1_T30=80
PWM1_T35=120
PWM1_T40=170
PWM1_T45=220
PWM1_TMAX=255

PWM2_T40=120
PWM2_T50=170
PWM2_T60=220
PWM2_TMAX=255

MIN_PWM1=80
MIN_PWM2=120
MAX_PWM=255

# Hysteresis: 2C for quick response to temperature changes
HYST_TEMP=2
`
};

// System Hardware Telemetry
router.get('/stats', requireAuth, async (req, res) => {
    try {
        const [cpu, cpuInfo, mem, temp, osInfo, graphics] = await Promise.all([
            si.currentLoad(),
            si.cpu(),
            si.mem(),
            si.cpuTemperature(),
            si.osInfo(),
            si.graphics()
        ]);

        // Try to get fan speeds
        let fans = [];
        try {
            const fanList = [];
            // Read fan speeds from /sys/class/hwmon without shell
            const hwmonBase = '/sys/class/hwmon';
            if (fs.existsSync(hwmonBase)) {
                const hwmonDirs = fs.readdirSync(hwmonBase);
                for (const hwmon of hwmonDirs) {
                    const hwmonPath = path.join(hwmonBase, hwmon);
                    let hwmonName = 'unknown';
                    try { hwmonName = fs.readFileSync(path.join(hwmonPath, 'name'), 'utf8').trim(); } catch (e) {}

                    // Find fan*_input files
                    try {
                        const entries = fs.readdirSync(hwmonPath);
                        for (const entry of entries) {
                            const fanMatch = entry.match(/^fan(\d+)_input$/);
                            if (fanMatch) {
                                try {
                                    const rpm = parseInt(fs.readFileSync(path.join(hwmonPath, entry), 'utf8').trim()) || 0;
                                    fanList.push({
                                        id: fanList.length + 1,
                                        name: `${hwmonName} Fan ${fanMatch[1]}`,
                                        rpm
                                    });
                                } catch (e) {}
                            }
                        }
                    } catch (e) {}
                }
            }
            // Check RPi cooling fan
            try {
                const rpiFanPaths = fs.readdirSync('/sys/devices/platform/cooling_fan/hwmon/');
                for (const hwDir of rpiFanPaths) {
                    const fanInputPath = `/sys/devices/platform/cooling_fan/hwmon/${hwDir}/fan1_input`;
                    if (fs.existsSync(fanInputPath)) {
                        const rpm = parseInt(fs.readFileSync(fanInputPath, 'utf8').trim()) || 0;
                        fanList.push({ id: fanList.length + 1, name: 'RPi Fan 1', rpm });
                    }
                }
            } catch (e) {}
            fans = fanList;
        } catch (e) {
            fans = [];
        }

        const coreTemps = temp.cores && temp.cores.length > 0
            ? temp.cores.map((t, i) => ({ core: i, temp: Math.round(t) }))
            : [];

        const coreLoads = cpu.cpus
            ? cpu.cpus.map((c, i) => ({ core: i, load: Math.round(c.load) }))
            : [];

        res.json({
            cpuModel: cpuInfo.manufacturer + ' ' + cpuInfo.brand,
            cpuCores: cpuInfo.cores,
            cpuPhysicalCores: cpuInfo.physicalCores,
            cpuSpeed: cpuInfo.speed,
            cpuSpeedMax: cpuInfo.speedMax,
            cpuLoad: Math.round(cpu.currentLoad),
            coreLoads,
            cpuTemp: Math.round(temp.main || 0),
            cpuTempMax: Math.round(temp.max || 0),
            coreTemps,
            gpuTemp: graphics.controllers && graphics.controllers[0]
                ? Math.round(graphics.controllers[0].temperatureGpu || 0)
                : null,
            ramUsed: (mem.active / 1024 / 1024 / 1024).toFixed(1),
            ramTotal: (mem.total / 1024 / 1024 / 1024).toFixed(1),
            ramFree: (mem.free / 1024 / 1024 / 1024).toFixed(1),
            ramUsedPercent: Math.round((mem.active / mem.total) * 100),
            swapUsed: (mem.swapused / 1024 / 1024 / 1024).toFixed(1),
            swapTotal: (mem.swaptotal / 1024 / 1024 / 1024).toFixed(1),
            fans,
            uptime: si.time().uptime,
            hostname: osInfo.hostname,
            platform: osInfo.platform,
            distro: osInfo.distro,
            kernel: osInfo.kernel
        });
    } catch (e) {
        console.error('Stats error:', e);
        res.status(500).json({ error: 'Failed to fetch system stats' });
    }
});

// Fan control endpoint
router.post('/fan', requireAuth, (req, res) => {
    const { fanId, speed } = req.body;

    // Validate speed
    if (typeof speed !== 'number' || speed < 0 || speed > 100) {
        return res.status(400).json({ error: 'Invalid fan speed (0-100)' });
    }

    // SECURITY: Validate fanId - must be a small positive integer
    const validatedFanId = validateFanId(fanId);
    if (validatedFanId === null) {
        return res.status(400).json({ error: 'Invalid fan ID (must be 1-10)' });
    }

    const pwmValue = Math.round((speed / 100) * 255);
    const fanNum = validatedFanId;

    try {
        let found = false;

        // Method 1: Search hwmon devices for pwm control
        const hwmonBase = '/sys/class/hwmon';
        if (fs.existsSync(hwmonBase)) {
            const hwmonDirs = fs.readdirSync(hwmonBase);
            for (const hwmon of hwmonDirs) {
                const pwmPath = path.join(hwmonBase, hwmon, `pwm${fanNum}`);
                if (fs.existsSync(pwmPath)) {
                    execFileSync('sudo', ['tee', pwmPath], {
                        input: String(pwmValue),
                        encoding: 'utf8',
                        timeout: 10000,
                        stdio: ['pipe', 'pipe', 'pipe']
                    });
                    found = true;
                    break;
                }
            }
        }

        // Method 2: RPi cooling fan
        if (!found) {
            try {
                const rpiFanBase = '/sys/devices/platform/cooling_fan/hwmon/';
                if (fs.existsSync(rpiFanBase)) {
                    const rpiFanDirs = fs.readdirSync(rpiFanBase);
                    for (const dir of rpiFanDirs) {
                        const pwmPath = path.join(rpiFanBase, dir, 'pwm1');
                        if (fs.existsSync(pwmPath)) {
                            execFileSync('sudo', ['tee', pwmPath], {
                                input: String(pwmValue),
                                encoding: 'utf8',
                                timeout: 10000,
                                stdio: ['pipe', 'pipe', 'pipe']
                            });
                            found = true;
                            break;
                        }
                    }
                }
            } catch (e) {}
        }

        // Method 3: Thermal cooling device
        if (!found) {
            const coolingStatePath = '/sys/class/thermal/cooling_device0/cur_state';
            const coolingMaxPath = '/sys/class/thermal/cooling_device0/max_state';
            if (fs.existsSync(coolingStatePath)) {
                let maxState = 255;
                try { maxState = parseInt(fs.readFileSync(coolingMaxPath, 'utf8').trim()) || 255; } catch (e) {}
                const state = Math.round(pwmValue * maxState / 255);
                execFileSync('sudo', ['tee', coolingStatePath], {
                    input: String(state),
                    encoding: 'utf8',
                    timeout: 10000,
                    stdio: ['pipe', 'pipe', 'pipe']
                });
                found = true;
            }
        }

        if (found) {
            logSecurityEvent('FAN_CONTROL', { fanId: fanNum, speed, pwmValue }, req.ip);
            res.json({ success: true, message: `Fan ${fanNum} speed set to ${speed}%` });
        } else {
            res.status(500).json({ error: 'PWM control not available for this fan' });
        }
    } catch (e) {
        console.error('Fan control error:', e);
        res.status(500).json({ error: 'Fan control not available on this system' });
    }
});

// Get current fan mode
router.get('/fan/mode', requireAuth, (req, res) => {
    try {
        let currentMode = 'balanced';
        try {
            let configContent = '';
            try { configContent = fs.readFileSync(FANCTL_CONF, 'utf8'); } catch (e) {}

            if (configContent.includes('SILENT preset')) {
                currentMode = 'silent';
            } else if (configContent.includes('PERFORMANCE preset')) {
                currentMode = 'performance';
            } else if (configContent.includes('BALANCED preset') || configContent.includes('Custom curve')) {
                currentMode = 'balanced';
            }
        } catch (e) {
            currentMode = 'balanced';
        }

        res.json({
            mode: currentMode,
            modes: [
                { id: 'silent', name: 'Silent', description: 'Quiet operation, higher temps allowed' },
                { id: 'balanced', name: 'Balanced', description: 'Recommended default settings' },
                { id: 'performance', name: 'Performance', description: 'Maximum cooling, louder fans' }
            ]
        });
    } catch (e) {
        console.error('Fan mode read error:', e);
        res.status(500).json({ error: 'Failed to read fan mode' });
    }
});

// Set fan mode preset
router.post('/fan/mode', requireAuth, (req, res) => {
    const { mode } = req.body;

    // SECURITY: Validate mode using sanitize function
    const validatedMode = validateFanMode(mode);
    if (!validatedMode || !FAN_PRESETS[validatedMode]) {
        return res.status(400).json({ error: 'Invalid mode. Must be: silent, balanced, or performance' });
    }

    try {
        const preset = FAN_PRESETS[validatedMode];
        // Use os.tmpdir() for temp file — /mnt/storage/.tmp may not exist yet
        const os = require('os');
        const tempFile = path.join(os.tmpdir(), 'homepinas-fanctl-temp.conf');
        fs.writeFileSync(tempFile, preset, 'utf8');
        execFileSync('sudo', ['cp', tempFile, FANCTL_CONF], { encoding: 'utf8', timeout: 10000 });
        execFileSync('sudo', ['chmod', '644', FANCTL_CONF], { encoding: 'utf8', timeout: 10000 });
        fs.unlinkSync(tempFile);

        try {
            execFileSync('sudo', ['systemctl', 'restart', 'homepinas-fanctl'], { encoding: 'utf8', timeout: 10000 });
        } catch (e) {}

        logSecurityEvent('FAN_MODE_CHANGE', { mode: validatedMode, user: req.user.username }, req.ip);
        res.json({ success: true, message: `Fan mode set to ${validatedMode}`, mode: validatedMode });
    } catch (e) {
        console.error('Fan mode set error:', e);
        res.status(500).json({ error: 'Failed to set fan mode' });
    }
});

// Real Disk Detection & SMART
// Disks endpoint - public (needed by frontend for storage wizard)
router.get('/disks', async (req, res) => {
    try {
        // Get disk info from lsblk (no sudo needed, includes serial)
        let lsblkData = {};
        try {
            const lsblkJson = execFileSync('lsblk', ['-J', '-b', '-o', 'NAME,SIZE,TYPE,MODEL,SERIAL,TRAN'], { encoding: 'utf8' });
            const parsed = JSON.parse(lsblkJson);
            for (const dev of (parsed.blockdevices || [])) {
                lsblkData[dev.name] = {
                    size: dev.size,
                    type: dev.type,
                    model: dev.model || '',
                    serial: dev.serial || '',
                    transport: dev.tran || ''
                };
            }
        } catch (e) {
            console.log('lsblk parse error:', e.message);
        }

        const blockDevices = await si.blockDevices();
        const diskLayout = await si.diskLayout();

        const disks = blockDevices
            .filter(dev => {
                if (dev.type !== 'disk') return false;
                if (dev.name && dev.name.startsWith('mmcblk')) return false;
                if (dev.name && dev.name.startsWith('zram')) return false;
                if (dev.name && dev.name.startsWith('loop')) return false;
                if (dev.name && dev.name.startsWith('ram')) return false;
                if (dev.name && dev.name.startsWith('dm-')) return false;
                const sizeGB = dev.size / 1024 / 1024 / 1024;
                if (sizeGB < 1) return false;
                return true;
            })
            .map(dev => {
                const lsblk = lsblkData[dev.name] || {};
                const layoutInfo = diskLayout.find(d => d.device === dev.device) || {};
                const sizeGBraw = dev.size / 1024 / 1024 / 1024;
                const sizeGB = sizeGBraw.toFixed(0);

                // Determine disk type
                let diskType = 'HDD';
                if (layoutInfo.interfaceType === 'NVMe' || dev.name.includes('nvme') || lsblk.transport === 'nvme') {
                    diskType = 'NVMe';
                } else if ((layoutInfo.type || '').includes('SSD') || 
                           (lsblk.model || '').toLowerCase().includes('ssd') ||
                           (layoutInfo.name || '').toLowerCase().includes('ssd')) {
                    diskType = 'SSD';
                }

                // Get serial from lsblk (most reliable, no sudo)
                const serial = lsblk.serial || layoutInfo.serial || '';

                // Get model - prefer lsblk if it has a good value
                const lsblkModel = lsblk.model || '';
                const layoutModel = layoutInfo.model || layoutInfo.name || '';
                const finalModel = (lsblkModel && lsblkModel.length > 3) ? lsblkModel : 
                                   (layoutModel || lsblkModel || 'Unknown Drive');

                // Try to get temperature
                let temp = null;
                try {
                    // Method 1: drivetemp module exposes temps via hwmon
                    const tempBasePath = `/sys/block/${dev.name}/device/hwmon/`;
                    if (fs.existsSync(tempBasePath)) {
                        const hwmonDirs = fs.readdirSync(tempBasePath);
                        if (hwmonDirs.length > 0) {
                            const tempFile = path.join(tempBasePath, hwmonDirs[0], 'temp1_input');
                            if (fs.existsSync(tempFile)) {
                                const tempVal = parseInt(fs.readFileSync(tempFile, 'utf8').trim());
                                if (!isNaN(tempVal)) temp = Math.round(tempVal / 1000);
                            }
                        }
                    }
                } catch (e) {}

                // Method 2: smartctl fallback if hwmon didn't work
                if (temp === null) {
                    try {
                        const smartOut = execFileSync('sudo', ['smartctl', '-A', `/dev/${dev.name}`], { encoding: 'utf8', timeout: 5000 });
                        // SMART attributes format: ID ATTR_NAME FLAGS VALUE WORST THRESH TYPE UPDATED WHEN_FAILED RAW_VALUE
                        // We need RAW_VALUE (last column), not VALUE. Match the number after the dash (-) near end of line
                        const tempMatch = smartOut.match(/(?:Temperature_Celsius|Airflow_Temperature_Cel|Temperature_Internal|Temperature_Case)\s+\S+\s+\d+\s+\d+\s+\d+\s+\S+\s+\S+\s+\S+\s+(\d+)/);
                        if (tempMatch) {
                            temp = parseInt(tempMatch[1]);
                        } else {
                            // NVMe / newer format: "Temperature:    XX Celsius"
                            const nvmeMatch = smartOut.match(/Temperature:\s+(\d+)\s*Celsius/i);
                            if (nvmeMatch) temp = parseInt(nvmeMatch[1]);
                        }
                    } catch (e) {}
                }

                // Get disk usage from mounted partitions
                let usage = 0;
                try {
                    // Use execFileSync to avoid shell interpolation
                    const dfOutput = execFileSync('df', ['-P'], { encoding: 'utf8' });
                    // Filter lines matching this disk's partitions (e.g., /dev/sda1, /dev/sdb1)
                    const diskLine = dfOutput.split('\n')
                        .find(line => line.startsWith(`/dev/${dev.name}`));
                    if (diskLine) {
                        const parts = diskLine.trim().split(/\s+/);
                        if (parts.length >= 5) {
                            usage = parseInt(parts[4]) || 0; // Use% column
                        }
                    }
                } catch (e) {}

                return {
                    id: dev.name,
                    device: dev.device,
                    type: diskType,
                    size: sizeGBraw >= 1024 ? (sizeGBraw / 1024).toFixed(1) + ' TB' : sizeGB + ' GB',
                    model: finalModel,
                    serial: serial || 'N/A',
                    temp: temp,
                    usage
                };
            });
        res.json(disks);
    } catch (e) {
        console.error('Disk scan error:', e);
        res.status(500).json({ error: 'Failed to scan disks' });
    }
});

// System Status
// Status endpoint - public (needed by frontend to check if user exists)
router.get('/status', async (req, res) => {
    const data = getData();
    // Read version from package.json
    let version = '';
    try {
        const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8'));
        version = pkg.version || '';
    } catch { /* ignore */ }
    res.json({
        user: data.user ? { username: data.user.username } : null,
        storageConfig: data.storageConfig,
        poolConfigured: data.poolConfigured || false,
        network: data.network,
        version
    });
});

// System Architecture Detection
router.get('/arch', requireAuth, async (req, res) => {
    try {
        const os = require('os');
        const arch = os.arch(); // 'arm64', 'x64', 'arm', etc.
        const platform = os.platform(); // 'linux', 'darwin', 'win32'
        
        // Normalize architecture names
        let normalizedArch;
        switch (arch) {
            case 'arm64':
            case 'aarch64':
                normalizedArch = 'arm64';
                break;
            case 'arm':
            case 'armv7l':
                normalizedArch = 'arm';
                break;
            case 'x64':
            case 'amd64':
                normalizedArch = 'amd64';
                break;
            case 'ia32':
            case 'x86':
                normalizedArch = 'i386';
                break;
            default:
                normalizedArch = arch;
        }
        
        // Check if running on Raspberry Pi
        let isRaspberryPi = false;
        try {
            const cpuInfo = fs.readFileSync('/proc/cpuinfo', 'utf8');
            isRaspberryPi = cpuInfo.toLowerCase().includes('raspberry') || 
                           cpuInfo.toLowerCase().includes('bcm2');
        } catch (e) {}
        
        res.json({
            arch: normalizedArch,
            rawArch: arch,
            platform,
            isRaspberryPi,
            isArm: normalizedArch === 'arm64' || normalizedArch === 'arm',
            isX86: normalizedArch === 'amd64' || normalizedArch === 'i386'
        });
    } catch (error) {
        console.error('Architecture detection error:', error);
        res.status(500).json({ error: 'Failed to detect architecture' });
    }
});

module.exports = router;
