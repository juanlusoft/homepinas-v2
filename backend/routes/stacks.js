/**
 * HomePiNAS - Docker Stacks/Compose Routes
 * Manage multi-container applications with docker-compose
 */

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');
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
    'monitoring': {
        name: 'Monitoring Stack',
        description: 'Prometheus + Grafana',
        icon: '📊',
        compose: `version: '3.8'
services:
  prometheus:
    image: prom/prometheus:latest
    ports:
      - "9090:9090"
    volumes:
      - ./prometheus.yml:/etc/prometheus/prometheus.yml
      - prometheus_data:/prometheus
    command:
      - '--config.file=/etc/prometheus/prometheus.yml'
      - '--storage.tsdb.path=/prometheus'
    restart: unless-stopped

  grafana:
    image: grafana/grafana:latest
    ports:
      - "3000:3000"
    environment:
      GF_SECURITY_ADMIN_PASSWORD: \${GRAFANA_PASSWORD:-admin}
    volumes:
      - grafana_data:/var/lib/grafana
    depends_on:
      - prometheus
    restart: unless-stopped

volumes:
  prometheus_data:
  grafana_data:
`
    },
    'media': {
        name: 'Media Stack',
        description: 'Jellyfin + Sonarr + Radarr + Lidarr + Readarr + Bazarr + Prowlarr + Jellyseerr',
        icon: '🎬',
        compose: `version: '3.8'
services:
  jellyfin:
    image: lscr.io/linuxserver/jellyfin:latest
    environment:
      - PUID=1000
      - PGID=1000
      - TZ=Europe/Madrid
    volumes:
      - ./jellyfin:/config
      - /mnt/storage/media:/data/media
    ports:
      - "8096:8096"
    restart: unless-stopped

  sonarr:
    image: lscr.io/linuxserver/sonarr:latest
    environment:
      - PUID=1000
      - PGID=1000
      - TZ=Europe/Madrid
    volumes:
      - ./sonarr:/config
      - /mnt/storage/media/tv:/tv
      - /mnt/storage/downloads:/downloads
    ports:
      - "8989:8989"
    restart: unless-stopped

  radarr:
    image: lscr.io/linuxserver/radarr:latest
    environment:
      - PUID=1000
      - PGID=1000
      - TZ=Europe/Madrid
    volumes:
      - ./radarr:/config
      - /mnt/storage/media/movies:/movies
      - /mnt/storage/downloads:/downloads
    ports:
      - "7878:7878"
    restart: unless-stopped

  lidarr:
    image: lscr.io/linuxserver/lidarr:latest
    environment:
      - PUID=1000
      - PGID=1000
      - TZ=Europe/Madrid
    volumes:
      - ./lidarr:/config
      - /mnt/storage/media/music:/music
      - /mnt/storage/downloads:/downloads
    ports:
      - "8686:8686"
    restart: unless-stopped

  readarr:
    image: lscr.io/linuxserver/readarr:nightly
    environment:
      - PUID=1000
      - PGID=1000
      - TZ=Europe/Madrid
    volumes:
      - ./readarr:/config
      - /mnt/storage/media/books:/books
      - /mnt/storage/downloads:/downloads
    ports:
      - "8787:8787"
    restart: unless-stopped

  bazarr:
    image: lscr.io/linuxserver/bazarr:latest
    environment:
      - PUID=1000
      - PGID=1000
      - TZ=Europe/Madrid
    volumes:
      - ./bazarr:/config
      - /mnt/storage/media/tv:/tv
      - /mnt/storage/media/movies:/movies
    ports:
      - "6767:6767"
    restart: unless-stopped

  prowlarr:
    image: lscr.io/linuxserver/prowlarr:latest
    environment:
      - PUID=1000
      - PGID=1000
      - TZ=Europe/Madrid
    volumes:
      - ./prowlarr:/config
    ports:
      - "9696:9696"
    restart: unless-stopped

  jellyseerr:
    image: fallenbagel/jellyseerr:latest
    environment:
      - TZ=Europe/Madrid
    volumes:
      - ./jellyseerr:/app/config
    ports:
      - "5055:5055"
    restart: unless-stopped
`
    }
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
                        const ps = execSync(`docker compose -f "${composePath}" ps --format json 2>/dev/null || echo "[]"`, 
                            { encoding: 'utf8', timeout: 10000 });
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

        const output = execSync(`docker compose -f "${composePath}" up -d 2>&1`, {
            encoding: 'utf8',
            timeout: 120000,
            cwd: stackPath
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

        const output = execSync(`docker compose -f "${composePath}" down 2>&1`, {
            encoding: 'utf8',
            timeout: 60000,
            cwd: stackPath
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

        execSync(`docker compose -f "${composePath}" restart 2>&1`, {
            encoding: 'utf8',
            timeout: 60000,
            cwd: stackPath
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

        const serviceArg = service ? ` ${service}` : '';
        const logs = execSync(
            `docker compose -f "${composePath}" logs --tail=${lines}${serviceArg} 2>&1`,
            { encoding: 'utf8', timeout: 30000, cwd: stackPath }
        );
        
        res.json({ success: true, logs });
    } catch (e) {
        res.json({ success: true, logs: e.message });
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
                execSync(`docker compose -f "${composePath}" down -v 2>&1`, {
                    encoding: 'utf8',
                    timeout: 60000,
                    cwd: stackPath
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
        
        const output = execSync(`docker compose -f "${composePath}" pull 2>&1`, {
            encoding: 'utf8',
            timeout: 300000,
            cwd: stackPath
        });
        
        res.json({ success: true, message: 'Images pulled', output });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

module.exports = router;
