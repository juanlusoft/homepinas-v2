/**
 * HomePiNAS v2 - Docker Stacks CRUD
 * List, create, get, update, delete stacks
 */
const express = require('express');
const router = express.Router();
const fsp = require('fs').promises;
const path = require('path');
const { execFileSync } = require('child_process');
const { requireAuth } = require('../../middleware/auth');
const { STACKS_DIR, pathExists } = require('./helpers');
const { STACK_TEMPLATES } = require('./templates');

// List all stacks
router.get('/list', requireAuth, async (req, res) => {
    try {
        const stacks = [];
        
        if (await pathExists(STACKS_DIR)) {
            const dirs = (await fsp.readdir(STACKS_DIR, { withFileTypes: true }))
                .filter(d => d.isDirectory());
            
            for (const dir of dirs) {
                const stackPath = path.join(STACKS_DIR, dir.name);
                const composePath = path.join(stackPath, 'docker-compose.yml');
                const metaPath = path.join(stackPath, 'stack.json');
                
                if (await pathExists(composePath)) {
                    let meta = { name: dir.name, description: '', icon: '📦' };
                    if (await pathExists(metaPath)) {
                        try {
                            meta = { ...meta, ...JSON.parse(await fsp.readFile(metaPath, 'utf8')) };
                        } catch (e) {}
                    }
                    
                    // Get stack status
                    let status = 'stopped';
                    let services = [];
                    try {
                        const ps = execFileSync('docker', ['compose', '-f', composePath, 'ps', '--format', 'json'],
                            { encoding: 'utf8', timeout: 10000, stdio: 'pipe' });
                        const containers = ps.trim().split('\n').filter(l => l).map(l => {
                            try { return JSON.parse(l); } catch { return null; }
                        }).filter(c => c);

                        services = containers.map(c => ({
                            name: c.Service || c.Name,
                            state: c.State || 'unknown',
                            status: c.Status || ''
                        }));

                        if (services.length > 0) {
                            const running = services.filter(s => s.state === 'running').length;
                            if (running === services.length) status = 'running';
                            else if (running > 0) status = 'partial';
                            else status = 'stopped';
                        }
                    } catch (e) {}
                    
                    stacks.push({
                        id: dir.name,
                        ...meta,
                        status,
                        services,
                        path: stackPath
                    });
                }
            }
        }
        
        res.json({ success: true, stacks });
    } catch (e) {
        console.error('List stacks error:', e);
        res.status(500).json({ error: e.message });
    }
});

// Create new stack
router.post('/create', requireAuth, async (req, res) => {
    try {
        const { name, compose, description, icon, template } = req.body;
        
        if (!name || !/^[a-z0-9_-]+$/i.test(name)) {
            return res.status(400).json({ error: 'Invalid stack name. Use only letters, numbers, - and _' });
        }
        
        const stackPath = path.join(STACKS_DIR, name);
        if (await pathExists(stackPath)) {
            return res.status(400).json({ error: 'Stack already exists' });
        }
        
        // Get compose content
        let composeContent = compose;
        if (template && STACK_TEMPLATES[template]) {
            composeContent = STACK_TEMPLATES[template].compose;
        }
        
        if (!composeContent) {
            return res.status(400).json({ error: 'No compose content provided' });
        }
        
        // Create stack directory and files
        await fsp.mkdir(stackPath, { recursive: true });
        await fsp.writeFile(path.join(stackPath, 'docker-compose.yml'), composeContent);
        await fsp.writeFile(path.join(stackPath, 'stack.json'), JSON.stringify({
            name,
            description: description || '',
            icon: icon || '📦',
            createdAt: new Date().toISOString()
        }, null, 2));
        
        // Create html directory for web stacks
        if (composeContent.includes('/var/www/html')) {
            await fsp.mkdir(path.join(stackPath, 'html'), { recursive: true });
            await fsp.writeFile(path.join(stackPath, 'html', 'index.php'), 
                '<?php phpinfo(); ?>');
        }
        
        res.json({ success: true, message: 'Stack created', path: stackPath });
    } catch (e) {
        console.error('Create stack error:', e);
        res.status(500).json({ error: e.message });
    }
});

// Get stack details
router.get('/:id', requireAuth, async (req, res) => {
    try {
        if (!/^[a-zA-Z0-9_-]+$/.test(req.params.id)) {
            return res.status(400).json({ error: 'Invalid stack ID' });
        }
        const stackPath = path.join(STACKS_DIR, req.params.id);
        const composePath = path.join(stackPath, 'docker-compose.yml');
        const metaPath = path.join(stackPath, 'stack.json');
        
        if (!(await pathExists(composePath))) {
            return res.status(404).json({ error: 'Stack not found' });
        }
        
        const compose = await fsp.readFile(composePath, 'utf8');
        let meta = { name: req.params.id };
        if (await pathExists(metaPath)) {
            try { meta = JSON.parse(await fsp.readFile(metaPath, 'utf8')); } catch {}
        }
        
        res.json({ success: true, stack: { ...meta, compose, path: stackPath } });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Update stack compose file
router.put('/:id', requireAuth, async (req, res) => {
    try {
        if (!/^[a-zA-Z0-9_-]+$/.test(req.params.id)) {
            return res.status(400).json({ error: 'Invalid stack ID' });
        }
        const { compose, description, icon } = req.body;
        const stackPath = path.join(STACKS_DIR, req.params.id);
        const composePath = path.join(stackPath, 'docker-compose.yml');
        const metaPath = path.join(stackPath, 'stack.json');
        
        if (!(await pathExists(stackPath))) {
            return res.status(404).json({ error: 'Stack not found' });
        }
        
        if (compose) {
            await fsp.writeFile(composePath, compose);
        }
        
        if (description !== undefined || icon !== undefined) {
            let meta = {};
            if (await pathExists(metaPath)) {
                try { meta = JSON.parse(await fsp.readFile(metaPath, 'utf8')); } catch {}
            }
            if (description !== undefined) meta.description = description;
            if (icon !== undefined) meta.icon = icon;
            meta.updatedAt = new Date().toISOString();
            await fsp.writeFile(metaPath, JSON.stringify(meta, null, 2));
        }
        
        res.json({ success: true, message: 'Stack updated' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Delete stack
router.delete('/:id', requireAuth, async (req, res) => {
    try {
        if (!/^[a-zA-Z0-9_-]+$/.test(req.params.id)) {
            return res.status(400).json({ error: 'Invalid stack ID' });
        }
        const stackPath = path.join(STACKS_DIR, req.params.id);
        const composePath = path.join(stackPath, 'docker-compose.yml');
        
        if (!(await pathExists(stackPath))) {
            return res.status(404).json({ error: 'Stack not found' });
        }
        
        // Stop containers first
        if (await pathExists(composePath)) {
            try {
                execFileSync('docker', ['compose', '-f', composePath, 'down', '-v'], {
                    encoding: 'utf8',
                    timeout: 60000,
                    cwd: stackPath,
                    stdio: 'pipe'
                });
            } catch (e) {
                console.error('Error stopping stack:', e.message);
            }
        }
        
        // Remove directory
        await fsp.rm(stackPath, { recursive: true, force: true });
        
        res.json({ success: true, message: 'Stack deleted' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

module.exports = router;
