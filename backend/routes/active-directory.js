/**
 * Active Directory Domain Controller (Samba AD DC)
 * HomePiNAS v2.7
 *
 * Permite al NAS actuar como controlador de dominio Active Directory.
 * - Equipos Windows se unen al dominio
 * - Usuarios AD gestionados desde dashboard
 * - DNS integrado (Samba lo incluye)
 * - GPOs básicas
 *
 * SECURITY: All routes require authentication. Uses execFile instead of exec.
 */

const express = require('express');
const router = express.Router();
const { execFile, spawn } = require('child_process');
const util = require('util');
const execFileAsync = util.promisify(execFile);
const fs = require('fs').promises;
const path = require('path');
const { requireAuth } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/rbac');

// ============================================================================
// CONSTANTS
// ============================================================================

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

// ============================================================================
// HELPERS
// ============================================================================

async function isSambaADInstalled() {
    try {
        await execFileAsync('which', ['samba-tool']);
        return true;
    } catch {
        return false;
    }
}

async function isADProvisioned() {
    try {
        await fs.access(AD_PROVISIONED_FLAG);
        return true;
    } catch {
        return false;
    }
}

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

// ============================================================================
// ALL ROUTES REQUIRE AUTH + ADMIN
// ============================================================================
router.use(requireAuth);
router.use(requireAdmin);

// ============================================================================
// ROUTES
// ============================================================================

router.get('/status', async (req, res) => {
    try {
        const status = await getADStatus();
        res.json(status);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.post('/install', async (req, res) => {
    try {
        const status = await getADStatus();
        if (status.installed) {
            return res.json({ success: true, message: 'Samba AD DC already installed' });
        }

        // Use execFile with env var set via options, install packages one by one
        await execFileAsync('sudo', ['apt-get', 'update'], { timeout: 120000, env: { ...process.env, DEBIAN_FRONTEND: 'noninteractive' } });
        await execFileAsync('sudo', ['apt-get', 'install', '-y', ...AD_PACKAGES], {
            timeout: 600000,
            env: { ...process.env, DEBIAN_FRONTEND: 'noninteractive' }
        });

        res.json({ success: true, message: 'Samba AD DC installed' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.post('/provision', async (req, res) => {
    try {
        const { domain, realm, adminPassword } = req.body;

        if (!domain || !realm || !adminPassword) {
            return res.status(400).json({ error: 'domain, realm, and adminPassword required' });
        }

        if (!DOMAIN_PATTERN.test(domain)) {
            return res.status(400).json({ error: 'Invalid domain name (must be 1-15 alphanumeric chars, start with letter)' });
        }

        if (!REALM_PATTERN.test(realm)) {
            return res.status(400).json({ error: 'Invalid realm (must be FQDN like domain.local)' });
        }

        if (adminPassword.length < 8 || adminPassword.length > 128) {
            return res.status(400).json({ error: 'Password must be 8-128 characters' });
        }

        const status = await getADStatus();
        if (!status.installed) {
            return res.status(400).json({ error: 'Samba AD DC not installed. Install first.' });
        }

        if (status.provisioned) {
            return res.status(400).json({ error: 'AD DC already provisioned' });
        }

        // Stop existing Samba services
        for (const svc of ['smbd', 'nmbd', 'winbind']) {
            try { await execFileAsync('sudo', ['systemctl', 'stop', svc]); } catch {}
            try { await execFileAsync('sudo', ['systemctl', 'disable', svc]); } catch {}
        }

        // Backup existing smb.conf
        const backupName = `${SAMBA_CONF}.backup.${Date.now()}`;
        try { await execFileAsync('sudo', ['mv', SAMBA_CONF, backupName]); } catch {}
        try { await execFileAsync('sudo', ['rm', '-f', SAMBA_CONF]); } catch {}

        // Provision the domain using execFile with --adminpass as a separate argument
        await execFileAsync('sudo', [
            'samba-tool', 'domain', 'provision',
            '--use-rfc2307',
            `--realm=${realm.toUpperCase()}`,
            `--domain=${domain.toUpperCase()}`,
            '--server-role=dc',
            '--dns-backend=SAMBA_INTERNAL',
            `--adminpass=${adminPassword}`
        ], { timeout: 300000 });

        // Copy Kerberos config
        await execFileAsync('sudo', ['cp', `${SAMBA_PRIVATE}/krb5.conf`, '/etc/krb5.conf']);

        // Enable and start samba-ad-dc
        await execFileAsync('sudo', ['systemctl', 'unmask', 'samba-ad-dc']);
        await execFileAsync('sudo', ['systemctl', 'enable', 'samba-ad-dc']);
        await execFileAsync('sudo', ['systemctl', 'start', 'samba-ad-dc']);

        // Mark as provisioned — write flag file using spawn to pipe data
        await execFileAsync('sudo', ['mkdir', '-p', '/etc/homepinas']);
        const flagData = JSON.stringify({
            domain: domain.toUpperCase(),
            realm: realm.toUpperCase(),
            provisionedAt: new Date().toISOString()
        });
        await new Promise((resolve, reject) => {
            const proc = spawn('sudo', ['tee', AD_PROVISIONED_FLAG], { stdio: ['pipe', 'ignore', 'pipe'] });
            proc.on('error', reject);
            proc.on('close', (code) => code === 0 ? resolve() : reject(new Error(`tee exited ${code}`)));
            proc.stdin.write(flagData);
            proc.stdin.end();
        });

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

router.get('/users', async (req, res) => {
    try {
        const status = await getADStatus();
        if (!status.provisioned || !status.running) {
            return res.status(400).json({ error: 'AD DC not running' });
        }

        const { stdout } = await execFileAsync('sudo', ['samba-tool', 'user', 'list']);
        const systemUsers = ['guest', 'krbtgt'];
        const users = stdout.trim().split('\n').filter(u => u && !systemUsers.includes(u.toLowerCase()));

        const userDetails = [];
        for (const username of users) {
            try {
                const { stdout: info } = await execFileAsync('samba-tool', ['user', 'show', username]);
                const user = { username };

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

router.post('/users', async (req, res) => {
    try {
        const { username, password, displayName, email } = req.body;

        if (!username || !password) {
            return res.status(400).json({ error: 'username and password required' });
        }

        if (!USERNAME_PATTERN.test(username)) {
            return res.status(400).json({ error: 'Invalid username' });
        }

        if (password.length < 8 || password.length > 128) {
            return res.status(400).json({ error: 'Password must be 8-128 characters' });
        }

        const status = await getADStatus();
        if (!status.provisioned || !status.running) {
            return res.status(400).json({ error: 'AD DC not running' });
        }

        // Build args array — no shell interpolation
        const args = ['samba-tool', 'user', 'create', username, `--newpassword=${password}`];

        if (displayName && /^[a-zA-Z0-9 ._-]{1,64}$/.test(displayName)) {
            args.push(`--given-name=${displayName}`);
        }
        if (email && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
            args.push(`--mail-address=${email}`);
        }

        await execFileAsync('sudo', args);

        res.json({ success: true, message: `User ${username} created` });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.delete('/users/:username', async (req, res) => {
    try {
        const { username } = req.params;

        if (!USERNAME_PATTERN.test(username)) {
            return res.status(400).json({ error: 'Invalid username' });
        }

        if (username.toLowerCase() === 'administrator') {
            return res.status(400).json({ error: 'Cannot delete Administrator account' });
        }

        const status = await getADStatus();
        if (!status.provisioned || !status.running) {
            return res.status(400).json({ error: 'AD DC not running' });
        }

        await execFileAsync('sudo', ['samba-tool', 'user', 'delete', username]);

        res.json({ success: true, message: `User ${username} deleted` });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.post('/users/:username/password', async (req, res) => {
    try {
        const { username } = req.params;
        const { newPassword } = req.body;

        if (!USERNAME_PATTERN.test(username)) {
            return res.status(400).json({ error: 'Invalid username' });
        }

        if (!newPassword || newPassword.length < 8 || newPassword.length > 128) {
            return res.status(400).json({ error: 'Password must be 8-128 characters' });
        }

        const status = await getADStatus();
        if (!status.provisioned || !status.running) {
            return res.status(400).json({ error: 'AD DC not running' });
        }

        await execFileAsync('sudo', ['samba-tool', 'user', 'setpassword', username, `--newpassword=${newPassword}`]);

        res.json({ success: true, message: `Password reset for ${username}` });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.get('/computers', async (req, res) => {
    try {
        const status = await getADStatus();
        if (!status.provisioned || !status.running) {
            return res.status(400).json({ error: 'AD DC not running' });
        }

        const { stdout } = await execFileAsync('sudo', ['samba-tool', 'computer', 'list']);
        const computers = stdout.trim().split('\n').filter(c => c);

        res.json(computers.map(name => ({ name })));
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.get('/groups', async (req, res) => {
    try {
        const status = await getADStatus();
        if (!status.provisioned || !status.running) {
            return res.status(400).json({ error: 'AD DC not running' });
        }

        const { stdout } = await execFileAsync('sudo', ['samba-tool', 'group', 'list']);
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

router.post('/groups', async (req, res) => {
    try {
        const { name, description } = req.body;

        if (!name || !GROUP_NAME_PATTERN.test(name)) {
            return res.status(400).json({ error: 'Invalid group name' });
        }

        const status = await getADStatus();
        if (!status.provisioned || !status.running) {
            return res.status(400).json({ error: 'AD DC not running' });
        }

        const args = ['samba-tool', 'group', 'add', name];
        if (description && /^[a-zA-Z0-9 ._-]{1,256}$/.test(description)) {
            args.push(`--description=${description}`);
        }

        await execFileAsync('sudo', args);

        res.json({ success: true, message: `Group ${name} created` });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.post('/groups/:name/members', async (req, res) => {
    try {
        const { name } = req.params;
        const { username } = req.body;

        if (!GROUP_NAME_PATTERN.test(name)) {
            return res.status(400).json({ error: 'Invalid group name' });
        }
        if (!username || !USERNAME_PATTERN.test(username)) {
            return res.status(400).json({ error: 'Invalid username' });
        }

        const status = await getADStatus();
        if (!status.provisioned || !status.running) {
            return res.status(400).json({ error: 'AD DC not running' });
        }

        await execFileAsync('sudo', ['samba-tool', 'group', 'addmembers', name, username]);

        res.json({ success: true, message: `User ${username} added to group ${name}` });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.delete('/groups/:name/members/:username', async (req, res) => {
    try {
        const { name, username } = req.params;

        if (!GROUP_NAME_PATTERN.test(name)) {
            return res.status(400).json({ error: 'Invalid group name' });
        }
        if (!USERNAME_PATTERN.test(username)) {
            return res.status(400).json({ error: 'Invalid username' });
        }

        const status = await getADStatus();
        if (!status.provisioned || !status.running) {
            return res.status(400).json({ error: 'AD DC not running' });
        }

        await execFileAsync('sudo', ['samba-tool', 'group', 'removemembers', name, username]);

        res.json({ success: true, message: `User ${username} removed from group ${name}` });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

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

        await execFileAsync('sudo', ['systemctl', action, 'samba-ad-dc']);

        res.json({ success: true, message: `AD DC service ${action}ed` });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
