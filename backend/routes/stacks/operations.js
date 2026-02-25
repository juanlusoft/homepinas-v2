/**
 * HomePiNAS v2 - Docker Stacks Operations
 * Start, stop, restart, pull, logs
 */
const express = require('express');
const router = express.Router();
const path = require('path');
const { execFileSync } = require('child_process');
const { requireAuth } = require('../../middleware/auth');
const { STACKS_DIR, pathExists } = require('./helpers');

// Deploy/Start stack
router.post('/:id/up', requireAuth, async (req, res) => {
    try {
        if (!/^[a-zA-Z0-9_-]+$/.test(req.params.id)) {
            return res.status(400).json({ error: 'Invalid stack ID' });
        }
        const stackPath = path.join(STACKS_DIR, req.params.id);
        const composePath = path.join(stackPath, 'docker-compose.yml');

        if (!(await pathExists(composePath))) {
            return res.status(404).json({ error: 'Stack not found' });
        }

        const output = execFileSync('docker', ['compose', '-f', composePath, 'up', '-d'], {
            encoding: 'utf8',
            timeout: 120000,
            cwd: stackPath,
            stdio: 'pipe'
        });
        
        res.json({ success: true, message: 'Stack started', output });
    } catch (e) {
        console.error('Stack up error:', e);
        res.status(500).json({ error: e.message, output: e.stdout || e.stderr });
    }
});

// Stop stack
router.post('/:id/down', requireAuth, async (req, res) => {
    try {
        if (!/^[a-zA-Z0-9_-]+$/.test(req.params.id)) {
            return res.status(400).json({ error: 'Invalid stack ID' });
        }
        const stackPath = path.join(STACKS_DIR, req.params.id);
        const composePath = path.join(stackPath, 'docker-compose.yml');

        if (!(await pathExists(composePath))) {
            return res.status(404).json({ error: 'Stack not found' });
        }

        const output = execFileSync('docker', ['compose', '-f', composePath, 'down'], {
            encoding: 'utf8',
            timeout: 60000,
            cwd: stackPath,
            stdio: 'pipe'
        });
        
        res.json({ success: true, message: 'Stack stopped', output });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Restart stack
router.post('/:id/restart', requireAuth, async (req, res) => {
    try {
        if (!/^[a-zA-Z0-9_-]+$/.test(req.params.id)) {
            return res.status(400).json({ error: 'Invalid stack ID' });
        }
        const stackPath = path.join(STACKS_DIR, req.params.id);
        const composePath = path.join(stackPath, 'docker-compose.yml');

        if (!(await pathExists(composePath))) {
            return res.status(404).json({ error: 'Stack not found' });
        }

        execFileSync('docker', ['compose', '-f', composePath, 'restart'], {
            encoding: 'utf8',
            timeout: 60000,
            cwd: stackPath,
            stdio: 'pipe'
        });
        
        res.json({ success: true, message: 'Stack restarted' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Pull latest images for stack
router.post('/:id/pull', requireAuth, async (req, res) => {
    try {
        if (!/^[a-zA-Z0-9_-]+$/.test(req.params.id)) {
            return res.status(400).json({ error: 'Invalid stack ID' });
        }
        const stackPath = path.join(STACKS_DIR, req.params.id);
        const composePath = path.join(stackPath, 'docker-compose.yml');
        
        if (!(await pathExists(composePath))) {
            return res.status(404).json({ error: 'Stack not found' });
        }
        
        const output = execFileSync('docker', ['compose', '-f', composePath, 'pull'], {
            encoding: 'utf8',
            timeout: 300000,
            cwd: stackPath,
            stdio: 'pipe'
        });
        
        res.json({ success: true, message: 'Images pulled', output });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Get stack logs
router.get('/:id/logs', requireAuth, async (req, res) => {
    try {
        if (!/^[a-zA-Z0-9_-]+$/.test(req.params.id)) {
            return res.status(400).json({ error: 'Invalid stack ID' });
        }
        const stackPath = path.join(STACKS_DIR, req.params.id);
        const composePath = path.join(stackPath, 'docker-compose.yml');
        const service = req.query.service;
        if (service && !/^[a-zA-Z0-9_-]+$/.test(service)) {
            return res.status(400).json({ error: 'Invalid service name' });
        }
        const lines = Math.min(Math.max(parseInt(req.query.lines) || 100, 1), 5000);

        if (!(await pathExists(composePath))) {
            return res.status(404).json({ error: 'Stack not found' });
        }

        const args = ['compose', '-f', composePath, 'logs', `--tail=${lines}`];
        if (service) args.push(service);
        const logs = execFileSync('docker', args,
            { encoding: 'utf8', timeout: 30000, cwd: stackPath, stdio: 'pipe' }
        );
        
        res.json({ success: true, logs });
    } catch (e) {
        res.json({ success: false, error: e.message });
    }
});

module.exports = router;
