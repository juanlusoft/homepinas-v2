/**
 * HomePiNAS - Rate Limiting Middleware
 * v1.5.6 - Modular Architecture
 */

const rateLimit = require('express-rate-limit');

/**
 * General rate limiter - relaxed for local network NAS dashboard
 */
const generalLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 1000, // Very high limit for local network
    message: { error: 'Too many requests, please try again later' },
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => {
        const skipPaths = [
            '/api/system/stats',
            '/api/system/disks',
            '/api/system/status',
            '/api/system/fan/mode',
            '/api/docker/containers',
            '/api/network/interfaces'
        ];
        return skipPaths.includes(req.path) || req.method === 'GET';
    }
});

/**
 * Auth rate limiter - stricter for login attempts
 */
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10,
    message: { error: 'Too many login attempts, please try again later' }
});

/**
 * Critical actions rate limiter
 */
const criticalLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 10,
    message: { error: 'Too many critical actions, please try again later' }
});

module.exports = {
    generalLimiter,
    authLimiter,
    criticalLimiter
};
