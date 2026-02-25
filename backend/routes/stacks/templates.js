/**
 * HomePiNAS v2 - Docker Stacks Templates
 * Predefined stack templates
 */
const express = require('express');
const router = express.Router();
const { requireAuth } = require('../../middleware/auth');

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

module.exports = router;
module.exports.STACK_TEMPLATES = STACK_TEMPLATES;
