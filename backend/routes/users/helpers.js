/**
 * HomePiNAS v2 - User Management Helpers
 * Utilities for user management and Samba integration
 */
const { execFileSync, spawn } = require('child_process');
const { getData, saveData } = require('../../utils/data');

const BCRYPT_ROUNDS = 12;

/**
 * Get the users array from data, handling legacy single-user format.
 */
function getUsers() {
  const data = getData();

  // Modern multi-user format
  if (data.users && Array.isArray(data.users)) {
    return data.users;
  }

  // Legacy single-user format: migrate to array
  if (data.user) {
    const legacyUser = {
      ...data.user,
      role: data.user.role || 'admin',
      createdAt: data.user.createdAt || new Date().toISOString(),
      lastLogin: data.user.lastLogin || null,
    };
    return [legacyUser];
  }

  return [];
}

/**
 * Strip password from user object before sending to client
 */
function sanitizeUser(user) {
  const { password, ...safe } = user;
  return safe;
}

/**
 * Find a user by username (case-insensitive)
 */
function findUser(username) {
  const users = getUsers();
  return users.find(u => u.username.toLowerCase() === username.toLowerCase());
}

/**
 * Save the users array back to data store
 */
function saveUsers(users) {
  const data = getData();
  data.users = users;
  saveData(data);
}

/**
 * Create a Samba system user (for share access)
 */
async function createSambaUser(username, password) {
  try {
    execFileSync('sudo', ['useradd', '-M', '-s', '/sbin/nologin', username], { encoding: 'utf8' });
  } catch (err) {
    // User might already exist, that's OK
  }

  try {
    execFileSync('sudo', ['usermod', '-aG', 'sambashare', username], { encoding: 'utf8' });
  } catch (err) {}

  try {
    await new Promise((resolve, reject) => {
      const proc = spawn('sudo', ['smbpasswd', '-a', '-s', username], {
        stdio: ['pipe', 'pipe', 'pipe']
      });
      proc.stdin.write(password + '\n');
      proc.stdin.write(password + '\n');
      proc.stdin.end();
      proc.on('close', (code) => code === 0 ? resolve() : reject(new Error(`smbpasswd exit ${code}`)));
      proc.on('error', reject);
      setTimeout(() => { proc.kill(); reject(new Error('smbpasswd timeout')); }, 10000);
    });
    execFileSync('sudo', ['smbpasswd', '-e', username], { encoding: 'utf8' });
  } catch (err) {
    console.warn('Could not set Samba password:', err.message);
  }
}

/**
 * Remove a Samba system user
 */
async function removeSambaUser(username) {
  try {
    execFileSync('sudo', ['smbpasswd', '-x', username], { encoding: 'utf8', timeout: 10000 });
  } catch (err) {
    console.warn('Could not remove Samba user:', err.message);
  }
  try {
    execFileSync('sudo', ['userdel', username], { encoding: 'utf8', timeout: 10000 });
  } catch (err) {
    console.warn('Could not remove system user:', err.message);
  }
}

/**
 * Update Samba password for a user
 */
async function updateSambaPassword(username, password) {
  try {
    await new Promise((resolve, reject) => {
      const proc = spawn('sudo', ['smbpasswd', '-s', username], { stdio: ['pipe', 'pipe', 'pipe'] });
      proc.stdin.write(password + '\n');
      proc.stdin.write(password + '\n');
      proc.stdin.end();
      proc.on('close', resolve);
      proc.on('error', reject);
      setTimeout(() => { proc.kill(); resolve(); }, 10000);
    });
  } catch (err) {
    console.warn('Samba password update failed for', username, err.message);
  }
}

module.exports = {
    BCRYPT_ROUNDS,
    getUsers,
    sanitizeUser,
    findUser,
    saveUsers,
    createSambaUser,
    removeSambaUser,
    updateSambaPassword
};
