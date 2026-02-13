/**
 * Active Directory Domain Controller (Samba AD DC)
 * HomePiNAS v2.7
 * 
 * Permite al NAS actuar como controlador de dominio Active Directory.
 * - Equipos Windows se unen al dominio
 * - Usuarios AD gestionados desde dashboard
 * - DNS integrado (Samba lo incluye)
 * - GPOs básicas
 */

const express = require('express');
const router = express.Router();
const { exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);
const fs = require('fs').promises;
const path = require('path');

// ============================================================================
// CONSTANTS
// ============================================================================

const SAMBA_CONF = '/etc/samba/smb.conf';
const SAMBA_PRIVATE = '/var/lib/samba/private';
const AD_PROVISIONED_FLAG = '/etc/homepinas/.ad-provisioned';

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Check if Samba AD DC is installed
 */
async function isSambaADInstalled() {
    try {
        await execAsync('which samba-tool');
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
 * Get AD DC status
 */
async function getADStatus() {
    const installed = await isSambaADInstalled();
    const provisioned = await isADProvisioned();
    
    let running = false;
    let domain = null;
    let realm = null;
    
    if (provisioned) {
        // Check if service is running
        try {
            const { stdout } = await execAsync('systemctl is-active samba-ad-dc', { timeout: 5000 });
            running = stdout.trim() === 'active';
        } catch {
            running = false;
        }
        
        // Read domain/realm from provisioned flag file (reliable source)
        try {
            const flagData = await fs.readFile(AD_PROVISIONED_FLAG, 'utf8');
            const config = JSON.parse(flagData);
            domain = config.domain || null;
            realm = config.realm || null;
        } catch {
            // Fallback to samba-tool if flag file is corrupted
            try {
                const { stdout } = await execAsync("sudo samba-tool domain info 127.0.0.1 2>/dev/null | grep -E '^(Domain|Realm)' || true");
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

// ============================================================================
// ROUTES
// ============================================================================

/**
 * GET /ad/status
 * Returns AD DC status
 */
router.get('/status', async (req, res) => {
    try {
        const status = await getADStatus();
        res.json(status);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /ad/install
 * Install Samba AD DC packages
 */
router.post('/install', async (req, res) => {
    try {
        const status = await getADStatus();
        if (status.installed) {
            return res.json({ success: true, message: 'Samba AD DC already installed' });
        }
        
        // Install packages
        const packages = [
            'samba',
            'samba-ad-dc',
            'samba-dsdb-modules',
            'samba-vfs-modules',
            'winbind',
            'libpam-winbind',
            'libnss-winbind',
            'krb5-user',
            'krb5-config'
        ];
        
        await execAsync(`DEBIAN_FRONTEND=noninteractive apt-get update && apt-get install -y ${packages.join(' ')}`, {
            timeout: 600000 // 10 minutes
        });
        
        res.json({ success: true, message: 'Samba AD DC installed' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /ad/provision
 * Provision the AD DC domain
 * Body: { domain: "HOMELABS", realm: "homelabs.local", adminPassword: "..." }
 */
router.post('/provision', async (req, res) => {
    try {
        const { domain, realm, adminPassword } = req.body;
        
        if (!domain || !realm || !adminPassword) {
            return res.status(400).json({ error: 'domain, realm, and adminPassword required' });
        }
        
        // Validate domain name (NetBIOS style, max 15 chars)
        if (!/^[A-Z][A-Z0-9]{0,14}$/.test(domain.toUpperCase())) {
            return res.status(400).json({ error: 'Invalid domain name (must be 1-15 alphanumeric chars, start with letter)' });
        }
        
        // Validate realm (FQDN style)
        if (!/^[a-z][a-z0-9.-]+\.[a-z]{2,}$/i.test(realm)) {
            return res.status(400).json({ error: 'Invalid realm (must be FQDN like domain.local)' });
        }
        
        // Validate password complexity
        if (adminPassword.length < 8) {
            return res.status(400).json({ error: 'Password must be at least 8 characters' });
        }
        
        const status = await getADStatus();
        if (!status.installed) {
            return res.status(400).json({ error: 'Samba AD DC not installed. Install first.' });
        }
        
        if (status.provisioned) {
            return res.status(400).json({ error: 'AD DC already provisioned' });
        }
        
        // Stop existing Samba services
        await execAsync('sudo systemctl stop smbd nmbd winbind 2>/dev/null || true');
        await execAsync('sudo systemctl disable smbd nmbd winbind 2>/dev/null || true');
        
        // Backup and REMOVE existing smb.conf (samba-tool requires it to not exist)
        await execAsync(`sudo mv ${SAMBA_CONF} ${SAMBA_CONF}.backup.$(date +%Y%m%d%H%M%S) 2>/dev/null || true`);
        await execAsync(`sudo rm -f ${SAMBA_CONF}`);
        
        // Provision the domain
        const provisionCmd = [
            'sudo samba-tool domain provision',
            '--use-rfc2307',
            `--realm=${realm.toUpperCase()}`,
            `--domain=${domain.toUpperCase()}`,
            '--server-role=dc',
            '--dns-backend=SAMBA_INTERNAL',
            `--adminpass='${adminPassword.replace(/'/g, "'\\''")}'`
        ].join(' ');
        
        await execAsync(provisionCmd, { timeout: 300000 }); // 5 minutes
        
        // Copy Kerberos config
        await execAsync(`sudo cp ${SAMBA_PRIVATE}/krb5.conf /etc/krb5.conf`);
        
        // Enable and start samba-ad-dc
        await execAsync('sudo systemctl unmask samba-ad-dc');
        await execAsync('sudo systemctl enable samba-ad-dc');
        await execAsync('sudo systemctl start samba-ad-dc');
        
        // Mark as provisioned
        await execAsync('sudo mkdir -p /etc/homepinas');
        const flagData = JSON.stringify({
            domain: domain.toUpperCase(),
            realm: realm.toUpperCase(),
            provisionedAt: new Date().toISOString()
        });
        await execAsync(`echo '${flagData}' | sudo tee ${AD_PROVISIONED_FLAG} > /dev/null`);
        
        res.json({ 
            success: true, 
            message: 'AD DC provisioned successfully',
            domain: domain.toUpperCase(),
            realm: realm.toUpperCase()
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /ad/users
 * List AD users
 */
router.get('/users', async (req, res) => {
    try {
        const status = await getADStatus();
        if (!status.provisioned || !status.running) {
            return res.status(400).json({ error: 'AD DC not running' });
        }
        
        const { stdout } = await execAsync('sudo samba-tool user list');
        // Filter out system accounts
        const systemUsers = ['guest', 'krbtgt'];
        const users = stdout.trim().split('\n').filter(u => u && !systemUsers.includes(u.toLowerCase()));
        
        // Get details for each user
        const userDetails = [];
        for (const username of users) {
            try {
                const { stdout: info } = await execAsync(`samba-tool user show "${username}" 2>/dev/null`);
                const user = { username };
                
                // Parse user info
                for (const line of info.split('\n')) {
                    if (line.includes(':')) {
                        const [key, ...valueParts] = line.split(':');
                        const value = valueParts.join(':').trim();
                        if (key.trim() === 'cn') user.displayName = value;
                        if (key.trim() === 'mail') user.email = value;
                        if (key.trim() === 'userAccountControl') user.enabled = !value.includes('ACCOUNTDISABLE');
                    }
                }
                
                userDetails.push(user);
            } catch {
                userDetails.push({ username });
            }
        }
        
        res.json(userDetails);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /ad/users
 * Create AD user
 * Body: { username, password, displayName?, email? }
 */
router.post('/users', async (req, res) => {
    try {
        const { username, password, displayName, email } = req.body;
        
        if (!username || !password) {
            return res.status(400).json({ error: 'username and password required' });
        }
        
        // Validate username
        if (!/^[a-zA-Z][a-zA-Z0-9._-]{0,19}$/.test(username)) {
            return res.status(400).json({ error: 'Invalid username' });
        }
        
        const status = await getADStatus();
        if (!status.provisioned || !status.running) {
            return res.status(400).json({ error: 'AD DC not running' });
        }
        
        let cmd = `samba-tool user create "${username}" '${password.replace(/'/g, "'\\''")}'`;
        
        if (displayName) {
            cmd += ` --given-name="${displayName}"`;
        }
        if (email) {
            cmd += ` --mail-address="${email}"`;
        }
        
        await execAsync(cmd);
        
        res.json({ success: true, message: `User ${username} created` });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * DELETE /ad/users/:username
 * Delete AD user
 */
router.delete('/users/:username', async (req, res) => {
    try {
        const { username } = req.params;
        
        // Prevent deleting Administrator
        if (username.toLowerCase() === 'administrator') {
            return res.status(400).json({ error: 'Cannot delete Administrator account' });
        }
        
        const status = await getADStatus();
        if (!status.provisioned || !status.running) {
            return res.status(400).json({ error: 'AD DC not running' });
        }
        
        await execAsync(`samba-tool user delete "${username}"`);
        
        res.json({ success: true, message: `User ${username} deleted` });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /ad/users/:username/password
 * Reset user password
 * Body: { newPassword }
 */
router.post('/users/:username/password', async (req, res) => {
    try {
        const { username } = req.params;
        const { newPassword } = req.body;
        
        if (!newPassword) {
            return res.status(400).json({ error: 'newPassword required' });
        }
        
        const status = await getADStatus();
        if (!status.provisioned || !status.running) {
            return res.status(400).json({ error: 'AD DC not running' });
        }
        
        await execAsync(`samba-tool user setpassword "${username}" --newpassword='${newPassword.replace(/'/g, "'\\''")}' `);
        
        res.json({ success: true, message: `Password reset for ${username}` });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /ad/computers
 * List domain-joined computers
 */
router.get('/computers', async (req, res) => {
    try {
        const status = await getADStatus();
        if (!status.provisioned || !status.running) {
            return res.status(400).json({ error: 'AD DC not running' });
        }
        
        const { stdout } = await execAsync('sudo samba-tool computer list');
        const computers = stdout.trim().split('\n').filter(c => c);
        
        res.json(computers.map(name => ({ name })));
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /ad/groups
 * List AD groups
 */
router.get('/groups', async (req, res) => {
    try {
        const status = await getADStatus();
        if (!status.provisioned || !status.running) {
            return res.status(400).json({ error: 'AD DC not running' });
        }
        
        const { stdout } = await execAsync('sudo samba-tool group list');
        // Filter out AD system groups (builtin and default)
        const systemGroups = [
            'allowed rodc password replication group',
            'cert publishers',
            'denied rodc password replication group',
            'dnsadmins',
            'dnsupdateproxy',
            'domain admins',
            'domain computers',
            'domain controllers',
            'domain guests',
            'domain users',
            'enterprise admins',
            'enterprise read-only domain controllers',
            'group policy creator owners',
            'ras and ias servers',
            'read-only domain controllers',
            'schema admins',
            'dnsadmins',
            'enterprise key admins',
            'key admins',
            'protected users',
            'cloneable domain controllers',
            'account operators',
            'administrators',
            'backup operators',
            'certificate service dcom access',
            'cryptographic operators',
            'distributed com users',
            'event log readers',
            'guests',
            'iis_iusrs',
            'incoming forest trust builders',
            'network configuration operators',
            'performance log users',
            'performance monitor users',
            'pre-windows 2000 compatible access',
            'print operators',
            'remote desktop users',
            'remote management users',
            'replicator',
            'server operators',
            'storage replica administrators',
            'terminal server license servers',
            'users',
            'windows authorization access group'
        ];
        const groups = stdout.trim().split('\n').filter(g => g && !systemGroups.includes(g.toLowerCase()));
        
        res.json(groups.map(name => ({ name })));
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /ad/groups
 * Create AD group
 * Body: { name, description? }
 */
router.post('/groups', async (req, res) => {
    try {
        const { name, description } = req.body;
        
        if (!name) {
            return res.status(400).json({ error: 'name required' });
        }
        
        const status = await getADStatus();
        if (!status.provisioned || !status.running) {
            return res.status(400).json({ error: 'AD DC not running' });
        }
        
        let cmd = `samba-tool group add "${name}"`;
        if (description) {
            cmd += ` --description="${description}"`;
        }
        
        await execAsync(cmd);
        
        res.json({ success: true, message: `Group ${name} created` });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /ad/groups/:name/members
 * Add user to group
 * Body: { username }
 */
router.post('/groups/:name/members', async (req, res) => {
    try {
        const { name } = req.params;
        const { username } = req.body;
        
        if (!username) {
            return res.status(400).json({ error: 'username required' });
        }
        
        const status = await getADStatus();
        if (!status.provisioned || !status.running) {
            return res.status(400).json({ error: 'AD DC not running' });
        }
        
        await execAsync(`samba-tool group addmembers "${name}" "${username}"`);
        
        res.json({ success: true, message: `User ${username} added to group ${name}` });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * DELETE /ad/groups/:name/members/:username
 * Remove user from group
 */
router.delete('/groups/:name/members/:username', async (req, res) => {
    try {
        const { name, username } = req.params;
        
        const status = await getADStatus();
        if (!status.provisioned || !status.running) {
            return res.status(400).json({ error: 'AD DC not running' });
        }
        
        await execAsync(`samba-tool group removemembers "${name}" "${username}"`);
        
        res.json({ success: true, message: `User ${username} removed from group ${name}` });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /ad/service/:action
 * Start/stop/restart AD DC service
 */
router.post('/service/:action', async (req, res) => {
    try {
        const { action } = req.params;
        
        if (!['start', 'stop', 'restart'].includes(action)) {
            return res.status(400).json({ error: 'Invalid action. Use start, stop, or restart' });
        }
        
        const status = await getADStatus();
        if (!status.provisioned) {
            return res.status(400).json({ error: 'AD DC not provisioned' });
        }
        
        await execAsync(`systemctl ${action} samba-ad-dc`);
        
        res.json({ success: true, message: `AD DC service ${action}ed` });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
