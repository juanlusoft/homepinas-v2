/**
 * HomePiNAS v2 - Active Directory Provision
 * Install and provision AD DC
 */
const express = require('express');
const router = express.Router();
const { spawn } = require('child_process');
const { requireAuth } = require('../../middleware/auth');
const { requireAdmin } = require('../../middleware/rbac');
const {
    SAMBA_CONF,
    SAMBA_PRIVATE,
    AD_PROVISIONED_FLAG,
    AD_PACKAGES,
    DOMAIN_PATTERN,
    REALM_PATTERN,
    execFileAsync,
    getADStatus
} = require('./helpers');

router.post('/install', requireAuth, requireAdmin, async (req, res) => {
    try {
        const status = await getADStatus();
        if (status.installed) {
            return res.json({ success: true, message: 'Samba AD DC already installed' });
        }

        await execFileAsync('sudo', ['apt-get', 'update'], {
            timeout: 120000,
            env: { ...process.env, DEBIAN_FRONTEND: 'noninteractive' }
        });
        await execFileAsync('sudo', ['apt-get', 'install', '-y', ...AD_PACKAGES], {
            timeout: 600000,
            env: { ...process.env, DEBIAN_FRONTEND: 'noninteractive' }
        });

        res.json({ success: true, message: 'Samba AD DC installed' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.post('/provision', requireAuth, requireAdmin, async (req, res) => {
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

        // Provision the domain
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

        // Mark as provisioned
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

module.exports = router;
