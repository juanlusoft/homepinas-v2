/**
 * HomePiNAS v2 - UPS Support Routes
 * 
 * Monitor UPS status via apcupsd (apcaccess) or NUT (upsc).
 * Provides status monitoring, configuration, event history, and self-test.
 */

const express = require('express');
const router = express.Router();
const { execFile } = require('child_process');
const { requireAuth } = require('../middleware/auth');
const { logSecurityEvent } = require('../utils/security');
const { getData, saveData } = require('../utils/data');

// --- UPS Detection Helpers ---

/**
 * Try to get UPS status from apcaccess (apcupsd).
 * Parses "KEY : VALUE" output into a key-value object.
 * @returns {Promise<object|null>} Parsed status object or null if unavailable
 */
function getApcaccessStatus() {
  return new Promise((resolve) => {
    execFile('apcaccess', [], { timeout: 10000 }, (err, stdout) => {
      if (err) {
        resolve(null);
        return;
      }

      const result = {};
      const lines = stdout.split('\n');
      for (const line of lines) {
        const colonIndex = line.indexOf(':');
        if (colonIndex === -1) continue;
        const key = line.substring(0, colonIndex).trim();
        const value = line.substring(colonIndex + 1).trim();
        if (key) result[key] = value;
      }
      resolve(result);
    });
  });
}

/**
 * Try to get UPS status from upsc (NUT).
 * Parses "key: value" output into a key-value object.
 * @returns {Promise<object|null>} Parsed status object or null if unavailable
 */
function getUpscStatus() {
  return new Promise((resolve) => {
    execFile('upsc', ['ups@localhost'], { timeout: 10000 }, (err, stdout) => {
      if (err) {
        resolve(null);
        return;
      }

      const result = {};
      const lines = stdout.split('\n');
      for (const line of lines) {
        const colonIndex = line.indexOf(':');
        if (colonIndex === -1) continue;
        const key = line.substring(0, colonIndex).trim();
        const value = line.substring(colonIndex + 1).trim();
        if (key) result[key] = value;
      }
      resolve(result);
    });
  });
}

/**
 * Normalize apcaccess output to a standard status format.
 * @param {object} raw - Raw apcaccess key-value data
 * @returns {object} Normalized UPS status
 */
function normalizeApcaccess(raw) {
  return {
    available: true,
    driver: 'apcupsd',
    status: raw.STATUS || 'UNKNOWN',
    batteryCharge: parseFloat(raw.BCHARGE) || null,
    runtime: parseFloat(raw.TIMELEFT) || null, // Minutes
    load: parseFloat(raw.LOADPCT) || null,
    inputVoltage: parseFloat(raw.LINEV) || null,
    outputVoltage: parseFloat(raw.OUTPUTV) || null,
    model: raw.MODEL || raw.UPSNAME || 'Unknown',
    lastEvent: raw.LASTXFER || null,
    raw // Include raw data for debugging
  };
}

/**
 * Normalize upsc (NUT) output to a standard status format.
 * @param {object} raw - Raw upsc key-value data
 * @returns {object} Normalized UPS status
 */
function normalizeUpsc(raw) {
  // Map NUT status codes
  let status = raw['ups.status'] || 'UNKNOWN';
  const statusMap = {
    'OL': 'ONLINE',
    'OB': 'ON BATTERY',
    'LB': 'LOW BATTERY',
    'OL CHRG': 'ONLINE CHARGING',
    'OB DISCHRG': 'ON BATTERY DISCHARGING'
  };
  status = statusMap[status] || status;

  return {
    available: true,
    driver: 'nut',
    status,
    batteryCharge: parseFloat(raw['battery.charge']) || null,
    runtime: parseFloat(raw['battery.runtime']) ? parseFloat(raw['battery.runtime']) / 60 : null, // Seconds to minutes
    load: parseFloat(raw['ups.load']) || null,
    inputVoltage: parseFloat(raw['input.voltage']) || null,
    outputVoltage: parseFloat(raw['output.voltage']) || null,
    model: raw['ups.model'] || raw['ups.mfr'] || 'Unknown',
    lastEvent: raw['ups.alarm'] || null,
    raw
  };
}

// All routes require authentication
router.use(requireAuth);

// --- Routes ---

/**
 * GET /status - Get current UPS status
 * Tries apcaccess first, falls back to upsc, or returns "not available".
 */
router.get('/status', async (req, res) => {
  try {
    // Try apcupsd first
    const apcData = await getApcaccessStatus();
    if (apcData && Object.keys(apcData).length > 0) {
      const status = normalizeApcaccess(apcData);
      return res.json({ success: true, ...status });
    }

    // Fall back to NUT (upsc)
    const nutData = await getUpscStatus();
    if (nutData && Object.keys(nutData).length > 0) {
      const status = normalizeUpsc(nutData);
      return res.json({ success: true, ...status });
    }

    // Neither is available
    res.json({
      success: true,
      available: false,
      driver: 'none',
      message: 'No UPS software detected. Install apcupsd or nut.'
    });
  } catch (err) {
    console.error('Error getting UPS status:', err);
    res.status(500).json({ success: false, error: 'Failed to get UPS status' });
  }
});

/**
 * GET /config - Get UPS notification configuration
 * Returns thresholds and notification preferences from stored data.
 */
router.get('/config', (req, res) => {
  try {
    const data = getData();
    const upsConfig = (data.ups && data.ups.config) || {
      lowBatteryThreshold: 30,
      criticalThreshold: 10,
      notifyOnPower: true,
      shutdownOnCritical: false
    };
    res.json({ success: true, config: upsConfig });
  } catch (err) {
    console.error('Error getting UPS config:', err);
    res.status(500).json({ success: false, error: 'Failed to get UPS config' });
  }
});

/**
 * POST /config - Save UPS notification configuration
 * Body: { lowBatteryThreshold, criticalThreshold, notifyOnPower, shutdownOnCritical }
 */
router.post('/config', (req, res) => {
  try {
    const { lowBatteryThreshold, criticalThreshold, notifyOnPower, shutdownOnCritical } = req.body;

    // Validate thresholds
    if (lowBatteryThreshold !== undefined) {
      if (typeof lowBatteryThreshold !== 'number' || lowBatteryThreshold < 0 || lowBatteryThreshold > 100) {
        return res.status(400).json({ success: false, error: 'Low battery threshold must be 0-100' });
      }
    }
    if (criticalThreshold !== undefined) {
      if (typeof criticalThreshold !== 'number' || criticalThreshold < 0 || criticalThreshold > 100) {
        return res.status(400).json({ success: false, error: 'Critical threshold must be 0-100' });
      }
    }

    const data = getData();
    if (!data.ups) data.ups = {};

    // Merge with existing config
    const existing = data.ups.config || {
      lowBatteryThreshold: 30,
      criticalThreshold: 10,
      notifyOnPower: true,
      shutdownOnCritical: false
    };

    data.ups.config = {
      lowBatteryThreshold: (typeof lowBatteryThreshold === 'number') ? lowBatteryThreshold : existing.lowBatteryThreshold,
      criticalThreshold: (typeof criticalThreshold === 'number') ? criticalThreshold : existing.criticalThreshold,
      notifyOnPower: (typeof notifyOnPower === 'boolean') ? notifyOnPower : existing.notifyOnPower,
      shutdownOnCritical: (typeof shutdownOnCritical === 'boolean') ? shutdownOnCritical : existing.shutdownOnCritical
    };

    saveData(data);

    logSecurityEvent('ups_config_updated', { config: data.ups.config, user: req.user });

    res.json({ success: true, config: data.ups.config });
  } catch (err) {
    console.error('Error saving UPS config:', err);
    res.status(500).json({ success: false, error: 'Failed to save UPS config' });
  }
});

/**
 * GET /history - Get UPS event history
 * Returns power events, battery swaps, and other UPS-related events.
 */
router.get('/history', (req, res) => {
  try {
    const data = getData();
    const history = (data.ups && data.ups.history) || [];
    res.json({ success: true, history });
  } catch (err) {
    console.error('Error getting UPS history:', err);
    res.status(500).json({ success: false, error: 'Failed to get UPS event history' });
  }
});

/**
 * POST /test - Run UPS self-test
 * Tries apctest (apcupsd) first, falls back to upscmd (NUT).
 */
router.post('/test', async (req, res) => {
  try {
    // Detect which driver is available by trying to get status first
    const apcData = await getApcaccessStatus();

    if (apcData && Object.keys(apcData).length > 0) {
      // Use apcupsd self-test
      execFile('apctest', [], { timeout: 30000 }, (err, stdout, stderr) => {
        if (err) {
          console.error('apctest error:', err);
          return res.status(500).json({
            success: false,
            driver: 'apcupsd',
            error: `Self-test failed: ${err.message}`
          });
        }

        // Record test event in history
        recordUpsEvent('self_test', {
          driver: 'apcupsd',
          result: 'initiated',
          output: stdout.slice(0, 500)
        });

        logSecurityEvent('ups_self_test', { driver: 'apcupsd', user: req.user });

        res.json({
          success: true,
          driver: 'apcupsd',
          message: 'Self-test initiated',
          output: stdout
        });
      });
      return;
    }

    // Try NUT
    const nutData = await getUpscStatus();
    if (nutData && Object.keys(nutData).length > 0) {
      execFile('upscmd', ['ups@localhost', 'test.battery.start'], { timeout: 30000 }, (err, stdout, stderr) => {
        if (err) {
          console.error('upscmd error:', err);
          return res.status(500).json({
            success: false,
            driver: 'nut',
            error: `Self-test failed: ${err.message}`
          });
        }

        recordUpsEvent('self_test', {
          driver: 'nut',
          result: 'initiated',
          output: stdout.slice(0, 500)
        });

        logSecurityEvent('ups_self_test', { driver: 'nut', user: req.user });

        res.json({
          success: true,
          driver: 'nut',
          message: 'Battery self-test initiated',
          output: stdout
        });
      });
      return;
    }

    // No UPS software found
    res.status(404).json({
      success: false,
      available: false,
      driver: 'none',
      message: 'No UPS software detected. Install apcupsd or nut.'
    });
  } catch (err) {
    console.error('Error running UPS self-test:', err);
    res.status(500).json({ success: false, error: 'Failed to run UPS self-test' });
  }
});

// --- Helper Functions ---

/**
 * Record a UPS event in the history log.
 * Keeps the last 100 events.
 * @param {string} type - Event type (e.g., 'self_test', 'power_loss', 'power_restored')
 * @param {object} details - Event details
 */
function recordUpsEvent(type, details) {
  try {
    const data = getData();
    if (!data.ups) data.ups = {};
    if (!data.ups.history) data.ups.history = [];

    data.ups.history.unshift({
      type,
      timestamp: new Date().toISOString(),
      ...details
    });

    // Keep last 100 events
    if (data.ups.history.length > 100) {
      data.ups.history = data.ups.history.slice(0, 100);
    }

    saveData(data);
  } catch (err) {
    console.error('Error recording UPS event:', err);
  }
}

module.exports = router;
