/**
 * HomePiNAS v2 - Active Directory Users
 * User CRUD operations
 */
const express = require('express');
const router = express.Router();
const { requireAuth } = require('../../middleware/auth');
const { requireAdmin } = require('../../middleware/rbac');
const { USERNAME_PATTERN, execFileAsync, getADStatus } = require('./helpers');

router.get('/users', requireAuth, requireAdmin, async (req, res) => {
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

router.post('/users', requireAuth, requireAdmin, async (req, res) => {
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

router.delete('/users/:username', requireAuth, requireAdmin, async (req, res) => {
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

router.post('/users/:username/password', requireAuth, requireAdmin, async (req, res) => {
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

module.exports = router;
