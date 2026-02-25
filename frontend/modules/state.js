/**
 * State Management Module
 * Central state store for the application
 */
(function(window) {
    'use strict';

    // State Management
    const state = {
        isAuthenticated: false,
        currentView: 'loading',
        user: null,
        sessionId: null,
        csrfToken: null,
        publicIP: 'Escaneando...',
        globalStats: { cpuLoad: 0, cpuTemp: 0, ramUsed: 0, ramTotal: 0, uptime: 0 },
        storageConfig: [],
        disks: [],
        network: {
            interfaces: [],
            ddns: []
        },
        dockers: [],
        shortcuts: { defaults: [], custom: [] },
        terminalSession: null,
        pollingIntervals: { stats: null, publicIP: null, storage: null }
    };

    const API_BASE = window.location.origin + '/api';

    // Local state for DHCP overrides (to track user changes before saving)
    const localDhcpState = {};

    // Expose to window
    window.AppState = state;
    window.API_BASE = API_BASE;
    window.localDhcpState = localDhcpState;

})(window);
