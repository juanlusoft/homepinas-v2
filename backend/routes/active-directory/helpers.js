/**
 * HomePiNAS v2 - Active Directory Helpers
 * Constants, patterns, and status utilities
 */
const { promisify } = require('util');
const { execFile } = require('child_process');
const fs = require('fs').promises;

const execFileAsync = promisify(execFile);

// Constants
const SAMBA_CONF = '/etc/samba/smb.conf';
const SAMBA_PRIVATE = '/var/lib/samba/private';
const AD_PROVISIONED_FLAG = '/etc/homepinas/.ad-provisioned';

// Allowed packages for AD DC installation (whitelist)
const AD_PACKAGES = [
    'samba', 'samba-ad-dc', 'samba-dsdb-modules', 'samba-vfs-modules',
    'winbind', 'libpam-winbind', 'libnss-winbind', 'krb5-user', 'krb5-config'
];

// Input validation patterns
const USERNAME_PATTERN = /^[a-zA-Z][a-zA-Z0-9._-]{0,19}$/;
const DOMAIN_PATTERN = /^[A-Za-z][A-Za-z0-9]{0,14}$/;
const REALM_PATTERN = /^[a-z][a-z0-9.-]+\.[a-z]{2,}$/i;
const GROUP_NAME_PATTERN = /^[a-zA-Z][a-zA-Z0-9 ._-]{0,63}$/;

/**
 * Check if Samba AD DC is installed
 */
async function isSambaADInstalled() {
    try {
        await execFileAsync('which', ['samba-tool']);
        return true;
    } catch {
        return false;
    }
}

/**
 * Check if AD DC is provisioned
 */
async function isADProvisioned() {
    try {
        await fs.access(AD_PROVISIONED_FLAG);
        return true;
    } catch {
        return false;
    }
}

/**
 * Get complete AD DC status
 */
async function getADStatus() {
    const installed = await isSambaADInstalled();
    const provisioned = await isADProvisioned();

    let running = false;
    let domain = null;
    let realm = null;

    if (provisioned) {
        try {
            const { stdout } = await execFileAsync('systemctl', ['is-active', 'samba-ad-dc'], { timeout: 5000 });
            running = stdout.trim() === 'active';
        } catch {
            running = false;
        }

        try {
            const flagData = await fs.readFile(AD_PROVISIONED_FLAG, 'utf8');
            const config = JSON.parse(flagData);
            domain = config.domain || null;
            realm = config.realm || null;
        } catch {
            try {
                const { stdout } = await execFileAsync('sudo', ['samba-tool', 'domain', 'info', '127.0.0.1'], { timeout: 10000 });
                const lines = stdout.split('\n');
                for (const line of lines) {
                    if (line.startsWith('Domain')) domain = line.split(':')[1]?.trim();
                    if (line.startsWith('Realm')) realm = line.split(':')[1]?.trim();
                }
            } catch {
                // ignore
            }
        }
    }

    return { installed, provisioned, running, domain, realm };
}

module.exports = {
    SAMBA_CONF,
    SAMBA_PRIVATE,
    AD_PROVISIONED_FLAG,
    AD_PACKAGES,
    USERNAME_PATTERN,
    DOMAIN_PATTERN,
    REALM_PATTERN,
    GROUP_NAME_PATTERN,
    execFileAsync,
    isSambaADInstalled,
    isADProvisioned,
    getADStatus
};
