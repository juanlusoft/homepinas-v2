/**
 * HomePiNAS v2 - Docker Stacks Helpers
 * Utilities for stack management
 */
const fsp = require('fs').promises;
const path = require('path');

const STACKS_DIR = '/opt/homepinas/stacks';

/**
 * Check if a path exists (async)
 */
async function pathExists(filePath) {
  try {
    await fsp.access(filePath);
    return true;
  } catch {
    return false;
  }
}

// Ensure stacks directory exists (async initialization)
(async () => {
  if (!(await pathExists(STACKS_DIR))) {
    await fsp.mkdir(STACKS_DIR, { recursive: true });
  }
})();

module.exports = {
    STACKS_DIR,
    pathExists
};
