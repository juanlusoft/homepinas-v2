/**
 * HomePiNAS - Rate Limiting Middleware
 * v1.5.6 - Modular Architecture
 */

const rateLimit = require('express-rate-limit');

/**
 * General rate limiter - relaxed for local network NAS dashboard
 * SECURITY: Only skip specific high-frequency polling endpoints, not all GETs
 */
const generalLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 500, // High but not unlimited for local network
    message: { error: 'Too many requests, please try again later' },
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => {
        // SECURITY: Only skip specific polling endpoints that need high frequency
        const skipPaths = [
            '/api/system/stats',
            '/api/system/fan/mode',
            '/api/docker/containers'
        ];
        return skipPaths.includes(req.path);
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

/**
 * Notification rate limiter - prevent spam via email/telegram
 */
const notificationLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 20,
    message: { error: 'Too many notification requests, please try again later' }
});

/**
 * DDNS update rate limiter - prevent excessive API calls to providers
 */
const ddnsLimiter = rateLimit({
    windowMs: 5 * 60 * 1000, // 5 minutes
    max: 10,
    message: { error: 'Too many DDNS update requests, please try again later' }
});

/**
 * VPN management rate limiter - prevent abuse of VPN client creation/install
 */
const vpnLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 20,
    message: { error: 'Too many VPN requests, please try again later' }
});

module.exports = {
    generalLimiter,
    authLimiter,
    criticalLimiter,
    notificationLimiter,
    ddnsLimiter,
    vpnLimiter
};
