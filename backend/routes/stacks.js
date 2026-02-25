/**
 * HomePiNAS - Docker Stacks/Compose Routes
 * Manage multi-container applications with docker-compose
 */

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { execFileSync, spawn } = require('child_process');
const { requireAuth } = require('../middleware/auth');

const STACKS_DIR = '/opt/homepinas/stacks';

// Ensure stacks directory exists
if (!fs.existsSync(STACKS_DIR)) {
    fs.mkdirSync(STACKS_DIR, { recursive: true });
}

// Templates for common stacks
const STACK_TEMPLATES = {
    'lamp': {
        name: 'LAMP Stack',
        description: 'Linux, Apache, MySQL, PHP',
        icon: '🐘',
        compose: `version: '3.8'
services:
  web:
    image: php:8.2-apache
    ports:
      - "8080:80"
    volumes:
      - ./html:/var/www/html
    depends_on:
      - db
    restart: unless-stopped

  db:
    image: mysql:8.0
    environment:
      MYSQL_ROOT_PASSWORD: \${MYSQL_ROOT_PASSWORD:-changeme}
      MYSQL_DATABASE: \${MYSQL_DATABASE:-app}
    volumes:
      - mysql_data:/var/lib/mysql
    restart: unless-stopped

  phpmyadmin:
    image: phpmyadmin:latest
    ports:
      - "8081:80"
    environment:
      PMA_HOST: db
    depends_on:
      - db
    restart: unless-stopped

volumes:
  mysql_data:
`
    },
    'lemp': {
        name: 'LEMP Stack',
        description: 'Linux, Nginx, MySQL, PHP',
        icon: '🐬',
        compose: `version: '3.8'
services:
  web:
    image: nginx:alpine
    ports:
      - "8080:80"
    volumes:
      - ./html:/var/www/html
      - ./nginx.conf:/etc/nginx/conf.d/default.conf
    depends_on:
      - php
    restart: unless-stopped

  php:
    image: php:8.2-fpm
    volumes:
      - ./html:/var/www/html
    restart: unless-stopped

  db:
    image: mysql:8.0
    environment:
      MYSQL_ROOT_PASSWORD: \${MYSQL_ROOT_PASSWORD:-changeme}
      MYSQL_DATABASE: \${MYSQL_DATABASE:-app}
    volumes:
      - mysql_data:/var/lib/mysql
    restart: unless-stopped

volumes:
  mysql_data:
`
    },
    'wordpress': {
        name: 'WordPress',
        description: 'WordPress con MySQL',
        icon: '📝',
        compose: `version: '3.8'
services:
  wordpress:
    image: wordpress:latest
    ports:
      - "8080:80"
    environment:
      WORDPRESS_DB_HOST: db
      WORDPRESS_DB_USER: wordpress
      WORDPRESS_DB_PASSWORD: \${DB_PASSWORD:-changeme}
      WORDPRESS_DB_NAME: wordpress
    volumes:
      - wordpress_data:/var/www/html
    depends_on:
      - db
    restart: unless-stopped

  db:
    image: mysql:8.0
    environment:
      MYSQL_DATABASE: wordpress
      MYSQL_USER: wordpress
      MYSQL_PASSWORD: \${DB_PASSWORD:-changeme}
      MYSQL_ROOT_PASSWORD: \${DB_ROOT_PASSWORD:-rootchangeme}
    volumes:
      - db_data:/var/lib/mysql
    restart: unless-stopped

volumes:
  wordpress_data:
  db_data:
`
    },
};

// List all stacks
router.get('/list', requireAuth, async (req, res) => {
    try {
        const stacks = [];
        
        if (fs.existsSync(STACKS_DIR)) {
            const dirs = fs.readdirSync(STACKS_DIR, { withFileTypes: true })
                .filter(d => d.isDirectory());
            
            for (const dir of dirs) {
                const stackPath = path.join(STACKS_DIR, dir.name);
                const composePath = path.join(stackPath, 'docker-compose.yml');
                const metaPath = path.join(stackPath, 'stack.json');
                
                if (fs.existsSync(composePath)) {
                    let meta = { name: dir.name, description: '', icon: '📦' };
                    if (fs.existsSync(metaPath)) {
                        try {
                            meta = { ...meta, ...JSON.parse(fs.readFileSync(metaPath, 'utf8')) };
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

// Get stack templates
router.get('/templates', requireAuth, (req, res) => {
    const templates = Object.entries(STACK_TEMPLATES).map(([id, t]) => ({
        id,
        name: t.name,
        description: t.description,
        icon: t.icon
    }));
    res.json({ success: true, templates });
});

// Get template content
router.get('/templates/:id', requireAuth, (req, res) => {
    if (!/^[a-zA-Z0-9_-]+$/.test(req.params.id)) {
        return res.status(400).json({ error: 'Invalid stack ID' });
    }
    const template = STACK_TEMPLATES[req.params.id];
    if (!template) {
        return res.status(404).json({ error: 'Template not found' });
    }
    res.json({ success: true, template });
});

// Create new stack
router.post('/create', requireAuth, async (req, res) => {
    try {
        const { name, compose, description, icon, template } = req.body;
        
        if (!name || !/^[a-z0-9_-]+$/i.test(name)) {
            return res.status(400).json({ error: 'Invalid stack name. Use only letters, numbers, - and _' });
        }
        
        const stackPath = path.join(STACKS_DIR, name);
        if (fs.existsSync(stackPath)) {
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
        fs.mkdirSync(stackPath, { recursive: true });
        fs.writeFileSync(path.join(stackPath, 'docker-compose.yml'), composeContent);
        fs.writeFileSync(path.join(stackPath, 'stack.json'), JSON.stringify({
            name,
            description: description || '',
            icon: icon || '📦',
            createdAt: new Date().toISOString()
        }, null, 2));
        
        // Create html directory for web stacks
        if (composeContent.includes('/var/www/html')) {
            fs.mkdirSync(path.join(stackPath, 'html'), { recursive: true });
            fs.writeFileSync(path.join(stackPath, 'html', 'index.php'), 
                '<?php phpinfo(); ?>');
        }
        
        res.json({ success: true, message: 'Stack created', path: stackPath });
    } catch (e) {
        console.error('Create stack error:', e);
        res.status(500).json({ error: e.message });
    }
});

// Get stack details
router.get('/:id', requireAuth, (req, res) => {
    try {
        if (!/^[a-zA-Z0-9_-]+$/.test(req.params.id)) {
            return res.status(400).json({ error: 'Invalid stack ID' });
        }
        const stackPath = path.join(STACKS_DIR, req.params.id);
        const composePath = path.join(stackPath, 'docker-compose.yml');
        const metaPath = path.join(stackPath, 'stack.json');
        
        if (!fs.existsSync(composePath)) {
            return res.status(404).json({ error: 'Stack not found' });
        }
        
        const compose = fs.readFileSync(composePath, 'utf8');
        let meta = { name: req.params.id };
        if (fs.existsSync(metaPath)) {
            try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')); } catch {}
        }
        
        res.json({ success: true, stack: { ...meta, compose, path: stackPath } });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Update stack compose file
router.put('/:id', requireAuth, (req, res) => {
    try {
        if (!/^[a-zA-Z0-9_-]+$/.test(req.params.id)) {
            return res.status(400).json({ error: 'Invalid stack ID' });
        }
        const { compose, description, icon } = req.body;
        const stackPath = path.join(STACKS_DIR, req.params.id);
        const composePath = path.join(stackPath, 'docker-compose.yml');
        const metaPath = path.join(stackPath, 'stack.json');
        
        if (!fs.existsSync(stackPath)) {
            return res.status(404).json({ error: 'Stack not found' });
        }
        
        if (compose) {
            fs.writeFileSync(composePath, compose);
        }
        
        if (description !== undefined || icon !== undefined) {
            let meta = {};
            if (fs.existsSync(metaPath)) {
                try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')); } catch {}
            }
            if (description !== undefined) meta.description = description;
            if (icon !== undefined) meta.icon = icon;
            meta.updatedAt = new Date().toISOString();
            fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
        }
        
        res.json({ success: true, message: 'Stack updated' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Deploy/Start stack
router.post('/:id/up', requireAuth, async (req, res) => {
    try {
        if (!/^[a-zA-Z0-9_-]+$/.test(req.params.id)) {
            return res.status(400).json({ error: 'Invalid stack ID' });
        }
        const stackPath = path.join(STACKS_DIR, req.params.id);
        const composePath = path.join(stackPath, 'docker-compose.yml');

        if (!fs.existsSync(composePath)) {
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

        if (!fs.existsSync(composePath)) {
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

        if (!fs.existsSync(composePath)) {
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

// Get stack logs
router.get('/:id/logs', requireAuth, (req, res) => {
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

        if (!fs.existsSync(composePath)) {
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

// Delete stack
router.delete('/:id', requireAuth, async (req, res) => {
    try {
        if (!/^[a-zA-Z0-9_-]+$/.test(req.params.id)) {
            return res.status(400).json({ error: 'Invalid stack ID' });
        }
        const stackPath = path.join(STACKS_DIR, req.params.id);
        const composePath = path.join(stackPath, 'docker-compose.yml');
        
        if (!fs.existsSync(stackPath)) {
            return res.status(404).json({ error: 'Stack not found' });
        }
        
        // Stop containers first
        if (fs.existsSync(composePath)) {
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
        fs.rmSync(stackPath, { recursive: true, force: true });
        
        res.json({ success: true, message: 'Stack deleted' });
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
        
        if (!fs.existsSync(composePath)) {
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

module.exports = router;
