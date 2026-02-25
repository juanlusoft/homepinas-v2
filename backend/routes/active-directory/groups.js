/**
 * HomePiNAS v2 - Active Directory Groups
 * Group management and membership
 */
const express = require('express');
const router = express.Router();
const { requireAuth } = require('../../middleware/auth');
const { requireAdmin } = require('../../middleware/rbac');
const { USERNAME_PATTERN, GROUP_NAME_PATTERN, execFileAsync, getADStatus } = require('./helpers');

const SYSTEM_GROUPS = [
    'allowed rodc password replication group', 'cert publishers',
    'denied rodc password replication group', 'dnsadmins', 'dnsupdateproxy',
    'domain admins', 'domain computers', 'domain controllers',
    'domain guests', 'domain users', 'enterprise admins',
    'enterprise read-only domain controllers', 'group policy creator owners',
    'ras and ias servers', 'read-only domain controllers', 'schema admins',
    'enterprise key admins', 'key admins', 'protected users',
    'cloneable domain controllers', 'account operators', 'administrators',
    'backup operators', 'certificate service dcom access', 'cryptographic operators',
    'distributed com users', 'event log readers', 'guests', 'iis_iusrs',
    'incoming forest trust builders', 'network configuration operators',
    'performance log users', 'performance monitor users',
    'pre-windows 2000 compatible access', 'print operators',
    'remote desktop users', 'remote management users', 'replicator',
    'server operators', 'storage replica administrators',
    'terminal server license servers', 'users',
    'windows authorization access group'
];

router.get('/groups', requireAuth, requireAdmin, async (req, res) => {
    try {
        const status = await getADStatus();
        if (!status.provisioned || !status.running) {
            return res.status(400).json({ error: 'AD DC not running' });
        }

        const { stdout } = await execFileAsync('sudo', ['samba-tool', 'group', 'list']);
        const groups = stdout.trim().split('\n').filter(g => g && !SYSTEM_GROUPS.includes(g.toLowerCase()));

        res.json(groups.map(name => ({ name })));
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.post('/groups', requireAuth, requireAdmin, async (req, res) => {
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

router.post('/groups/:name/members', requireAuth, requireAdmin, async (req, res) => {
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

router.delete('/groups/:name/members/:username', requireAuth, requireAdmin, async (req, res) => {
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

module.exports = router;
