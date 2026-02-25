/**
 * HomePiNAS v2 - DDNS Background Scheduler
 * Auto-update DDNS services when public IP changes
 */
const { getData, saveData } = require('../../utils/data');
const {
  getPublicIp,
  updateService,
  getServiceDisplayName,
  setLastKnownIp,
  getLastKnownIp,
  serviceStatus
} = require('./helpers');

const DDNS_UPDATE_INTERVAL = 5 * 60 * 1000; // 5 minutes

/**
 * Background DDNS updater.
 * Runs every 5 minutes, updates all enabled services if the IP has changed.
 */
async function runDDNSUpdate() {
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
    const lastIp = getLastKnownIp();
    if (currentIp === lastIp) {
      return;
    }

    console.log(`DDNS: IP changed from ${lastIp} to ${currentIp}, updating services...`);
    setLastKnownIp(currentIp);

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
}

// Start the background updater
const ddnsInterval = setInterval(runDDNSUpdate, DDNS_UPDATE_INTERVAL);

// Prevent the interval from keeping the process alive if it should exit
if (ddnsInterval.unref) {
  ddnsInterval.unref();
}

module.exports = { runDDNSUpdate, ddnsInterval };
