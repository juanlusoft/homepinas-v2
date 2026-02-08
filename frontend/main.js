// Import i18n
import { initI18n, t, applyTranslations, getCurrentLang } from './i18n.js';

// State Management
const state = {
    isAuthenticated: false,
    currentView: 'loading',
    user: null,
    sessionId: null,
    csrfToken: null,
    publicIP: 'Scanning...',
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
    pollingIntervals: { stats: null, publicIP: null }
};

const API_BASE = window.location.origin + '/api';

// Local state for DHCP overrides (to track user changes before saving)
const localDhcpState = {};

// Security: HTML escape function to prevent XSS
function escapeHtml(unsafe) {
    if (unsafe === null || unsafe === undefined) return '';
    return String(unsafe)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// =============================================================================
// NOTIFICATION SYSTEM - Toast notifications with animations
// =============================================================================

let notificationQueue = [];
let isShowingNotification = false;

/**
 * Show a toast notification
 * @param {string} message - The message to display
 * @param {string} type - Type: 'success', 'error', 'warning', 'info'
 * @param {number} duration - Duration in ms (default: 4000)
 */
function showNotification(message, type = 'info', duration = 4000) {
    notificationQueue.push({ message, type, duration });
    processNotificationQueue();
}

function processNotificationQueue() {
    if (isShowingNotification || notificationQueue.length === 0) return;
    
    isShowingNotification = true;
    const { message, type, duration } = notificationQueue.shift();
    
    // Remove any existing notification
    const existing = document.querySelector('.notification-toast');
    if (existing) existing.remove();
    
    // Create notification element
    const toast = document.createElement('div');
    toast.className = `notification-toast ${type}`;
    
    // Icon based on type
    const icons = {
        success: '✅',
        error: '❌',
        warning: '⚠️',
        info: 'ℹ️'
    };
    
    // Title based on type
    const titles = {
        success: 'Éxito',
        error: 'Error',
        warning: 'Advertencia',
        info: 'Información'
    };
    
    toast.innerHTML = `
        <span class="notification-icon">${icons[type] || icons.info}</span>
        <div class="notification-content">
            <div class="notification-title">${titles[type] || titles.info}</div>
            <div class="notification-message">${escapeHtml(message)}</div>
        </div>
        <button class="notification-close" aria-label="Cerrar">×</button>
    `;
    
    document.body.appendChild(toast);
    
    // Close button handler
    const closeBtn = toast.querySelector('.notification-close');
    closeBtn.addEventListener('click', () => dismissNotification(toast));
    
    // Trigger animation
    requestAnimationFrame(() => {
        toast.classList.add('show');
    });
    
    // Auto dismiss
    setTimeout(() => dismissNotification(toast), duration);
}

function dismissNotification(toast) {
    if (!toast || !toast.parentNode) {
        isShowingNotification = false;
        processNotificationQueue();
        return;
    }
    
    toast.classList.remove('show');
    
    setTimeout(() => {
        if (toast.parentNode) toast.remove();
        isShowingNotification = false;
        processNotificationQueue();
    }, 400);
}

/**
 * Show a confirmation modal
 * @param {string} title - Modal title
 * @param {string} message - Modal message
 * @param {string} confirmText - Confirm button text (default: 'Confirmar')
 * @param {string} cancelText - Cancel button text (default: 'Cancelar')
 * @returns {Promise<boolean>} - True if confirmed, false if cancelled
 */
function showConfirmModal(title, message, confirmText = 'Confirmar', cancelText = 'Cancelar') {
    return new Promise((resolve) => {
        // Remove any existing confirm modal
        const existing = document.getElementById('confirm-modal');
        if (existing) existing.remove();
        
        const modal = document.createElement('div');
        modal.id = 'confirm-modal';
        modal.className = 'modal';
        modal.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.6);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 10000;
            animation: fadeIn 0.2s ease;
        `;
        
        modal.innerHTML = `
            <div class="glass-card scale-in" style="
                max-width: 400px;
                width: 90%;
                padding: 24px;
                text-align: center;
            ">
                <h3 style="margin-bottom: 16px; color: var(--text-primary);">${escapeHtml(title)}</h3>
                <p style="margin-bottom: 24px; color: var(--text-secondary); white-space: pre-wrap;">${escapeHtml(message)}</p>
                <div style="display: flex; gap: 12px; justify-content: center;">
                    <button id="confirm-cancel" class="wizard-btn wizard-btn-back">${escapeHtml(cancelText)}</button>
                    <button id="confirm-ok" class="wizard-btn wizard-btn-next">${escapeHtml(confirmText)}</button>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        // Focus the cancel button for safety
        document.getElementById('confirm-cancel').focus();
        
        // Event handlers
        document.getElementById('confirm-ok').addEventListener('click', () => {
            modal.remove();
            resolve(true);
        });
        
        document.getElementById('confirm-cancel').addEventListener('click', () => {
            modal.remove();
            resolve(false);
        });
        
        // Close on backdrop click
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.remove();
                resolve(false);
            }
        });
        
        // Close on Escape
        const handleEscape = (e) => {
            if (e.key === 'Escape') {
                modal.remove();
                resolve(false);
                document.removeEventListener('keydown', handleEscape);
            }
        };
        document.addEventListener('keydown', handleEscape);
    });
}

/**
 * Create confetti celebration effect
 */
function celebrateWithConfetti() {
    const container = document.createElement('div');
    container.className = 'confetti-container';
    document.body.appendChild(container);
    
    const colors = ['#4ecdc4', '#ff6b6b', '#ffe66d', '#95e1d3', '#f38181', '#aa96da'];
    
    for (let i = 0; i < 50; i++) {
        const confetti = document.createElement('div');
        confetti.className = 'confetti';
        confetti.style.left = Math.random() * 100 + '%';
        confetti.style.animationDelay = Math.random() * 2 + 's';
        confetti.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
        confetti.style.transform = `rotate(${Math.random() * 360}deg)`;
        container.appendChild(confetti);
    }
    
    // Remove after animation
    setTimeout(() => container.remove(), 4000);
}

// Authenticated fetch wrapper
async function authFetch(url, options = {}) {
    const headers = {
        'Content-Type': 'application/json',
        ...options.headers
    };

    if (state.sessionId) {
        headers['X-Session-Id'] = state.sessionId;
    }
    
    if (state.csrfToken) {
        headers['X-CSRF-Token'] = state.csrfToken;
    }

    const response = await fetch(url, { ...options, headers });

    // Handle CSRF errors (token expired after server restart)
    if (response.status === 403) {
        const cloned = response.clone();
        try {
            const data = await cloned.json();
            if (data.code === 'CSRF_INVALID' || (data.error && data.error.includes('CSRF'))) {
                clearSession();
                showNotification('Sesión expirada. Por favor, inicia sesión de nuevo.', 'warning');
                setTimeout(() => location.reload(), 1500);
                throw new Error('CSRF_EXPIRED');
            }
        } catch (e) {
            if (e.message === 'CSRF_EXPIRED') throw e;
            // Not a JSON response or not CSRF error, continue
        }
    }

    // Handle session expiration
    if (response.status === 401 && state.isAuthenticated) {
        state.isAuthenticated = false;
        state.sessionId = null;
        state.user = null;
        localStorage.removeItem('sessionId');
        switchView('login');
        throw new Error('Session expired');
    }

    return response;
}

// Session persistence
function saveSession(sessionId, csrfToken = null) {
    state.sessionId = sessionId;
    localStorage.setItem('sessionId', sessionId);
    if (csrfToken) {
        state.csrfToken = csrfToken;
        localStorage.setItem('csrfToken', csrfToken);
    }
}

function loadSession() {
    const sessionId = localStorage.getItem('sessionId');
    const csrfToken = localStorage.getItem('csrfToken');
    if (sessionId) {
        state.sessionId = sessionId;
    }
    if (csrfToken) {
        state.csrfToken = csrfToken;
    }
    return sessionId;
}

function clearSession() {
    state.sessionId = null;
    state.csrfToken = null;
    state.user = null;
    state.isAuthenticated = false;
    localStorage.removeItem('sessionId');
    localStorage.removeItem('csrfToken');
}

// DOM Elements
const views = {
    setup: document.getElementById('setup-view'),
    storage: document.getElementById('storage-view'),
    login: document.getElementById('login-view'),
    dashboard: document.getElementById('dashboard-view')
};

const viewsMap = {
    'dashboard': 'Resumen del Sistema',
    'docker': 'Gestor de Docker',
    'storage': 'Almacenamiento',
    'files': 'Gestor de Archivos',
    'terminal': 'Terminal y Herramientas',
    'network': 'Gestión de Red',
    'backup': 'Backup y Tareas',
    'active-backup': 'Active Backup',
    'cloud-sync': 'Cloud Sync',
    'cloud-backup': 'Cloud Backup',
    'homestore': 'HomeStore',
    'logs': 'Visor de Logs',
    'users': 'Gestión de Usuarios',
    'system': 'System Administration'
};

// =============================================================================
// URL ROUTING
// =============================================================================

/**
 * Navigate to a URL path and update browser history
 */
function navigateTo(path, replace = false) {
    if (replace) {
        history.replaceState({ path }, '', path);
    } else {
        history.pushState({ path }, '', path);
    }
}

/**
 * Get view name from URL path
 */
function getViewFromPath(path) {
    const cleanPath = path.replace(/^\//, '').split('?')[0];
    if (!cleanPath || cleanPath === 'home' || cleanPath === 'dashboard') return 'dashboard';
    if (viewsMap[cleanPath]) return cleanPath;
    return 'dashboard';
}

/**
 * Handle route change from URL
 */
function handleRouteChange() {
    const path = window.location.pathname;
    const view = getViewFromPath(path);

    // Update sidebar active state
    navLinks.forEach(link => {
        link.classList.toggle('active', link.dataset.view === view);
    });

    // Update title and render
    if (viewTitle) viewTitle.textContent = viewsMap[view] || 'HomePiNAS';
    renderContent(view);
    updateHeaderIPVisibility();
}

// Listen for browser back/forward
window.addEventListener('popstate', () => {
    if (state.isAuthenticated) {
        handleRouteChange();
    }
});

const setupForm = document.getElementById('setup-form');
const loginForm = document.getElementById('login-form');
const navLinks = document.querySelectorAll('.nav-links li');
const dashboardContent = document.getElementById('dashboard-content');
const viewTitle = document.getElementById('view-title');
const resetBtn = document.getElementById('reset-setup-btn');

// DDNS modal is created dynamically in renderDDNSSection/showDDNSForm

// Initialize State from Backend
async function initAuth() {
    try {
        // Try to load existing session
        loadSession();

        const [statusRes, disksRes] = await Promise.all([
            fetch(`${API_BASE}/system/status`),
            fetch(`${API_BASE}/system/disks`)
        ]);

        if (!statusRes.ok || !disksRes.ok) {
            throw new Error('Failed to fetch initial data');
        }

        const status = await statusRes.json();
        state.disks = await disksRes.json();

        state.user = status.user;
        state.storageConfig = status.storageConfig;
        state.network = status.network;

        // If we have a session, try to validate it
        if (state.sessionId && state.user && state.storageConfig.length > 0) {
            state.isAuthenticated = true;
            
            // Check URL first to avoid rendering dashboard then immediately re-rendering
            const urlPath = window.location.pathname;
            const urlView = getViewFromPath(urlPath);
            
            // Switch to dashboard view (CSS) but skip auto-render - we'll render the correct view below
            switchView('dashboard', true);
            
            // Render the correct view based on URL
            if (urlView !== 'dashboard' && urlPath && urlPath !== '/' && urlPath !== '/login' && urlPath !== '/setup') {
                // Update sidebar to highlight correct nav item
                navLinks.forEach(link => {
                    link.classList.toggle('active', link.dataset.view === urlView);
                });
                if (viewTitle) viewTitle.textContent = viewsMap[urlView] || 'HomePiNAS';
                await renderContent(urlView);
            } else {
                await renderContent('dashboard');
            }
        } else if (state.user && state.storageConfig.length > 0) {
            switchView('login');
        } else if (state.user) {
            switchView('storage');
            initStorageSetup();
        } else {
            switchView('setup');
        }
    } catch (e) {
        console.error('Backend Offline', e);
        switchView('setup');
    }

    startGlobalPolling();
}

function startGlobalPolling() {
    // Polling System Stats (CPU/RAM/Temp)
    state.pollingIntervals.stats = setInterval(async () => {
        try {
            const res = await authFetch(`${API_BASE}/system/stats`);
            if (res.ok) {
                state.globalStats = await res.json();

                // Re-render dashboard if active to show real-time changes
                if (state.currentView === "dashboard") renderDashboard();
            }
        } catch (e) {
            // Session expired - authFetch handles redirect, stop polling
            if (e.message === 'Session expired' || e.message === 'CSRF_EXPIRED') {
                stopGlobalPolling();
                return;
            }
            console.error('Stats polling error:', e);
        }
    }, 2000);

    // Polling Public IP
    updatePublicIP();
    state.pollingIntervals.publicIP = setInterval(updatePublicIP, 1000 * 60 * 10);
    
    // Start disk detection polling
    startDiskDetectionPolling();
}

function stopGlobalPolling() {
    if (state.pollingIntervals.stats) {
        clearInterval(state.pollingIntervals.stats);
        state.pollingIntervals.stats = null;
    }
    if (state.pollingIntervals.publicIP) {
        clearInterval(state.pollingIntervals.publicIP);
        state.pollingIntervals.publicIP = null;
    }
    if (state.pollingIntervals.diskDetection) {
        clearInterval(state.pollingIntervals.diskDetection);
        state.pollingIntervals.diskDetection = null;
    }
}

// Public IP Tracker
async function updatePublicIP() {
    const val = document.getElementById('public-ip-val');
    // TODO: Replace with real API endpoint (e.g. authFetch(`${API_BASE}/network/public-ip`))
    // const mockIps = ['84.120.45.122', '84.120.45.123', '84.120.45.124'];
    // state.publicIP = mockIps[Math.floor(Math.random() * mockIps.length)];
    state.publicIP = 'N/A';
    if (val) val.textContent = state.publicIP;

    // Don't re-render network view on IP update - causes duplicate cards
    // The network view already has the IP displayed
}

// ═══════════════════════════════════════════════════════════════════════════
// HYBRID DISK DETECTION - Notify user when new disks are detected
// ═══════════════════════════════════════════════════════════════════════════

let detectedNewDisks = [];
let diskNotificationShown = false;

// Check for new unconfigured disks
async function checkForNewDisks() {
    try {
        const res = await authFetch(`${API_BASE}/storage/disks/detect`);
        if (!res.ok) return;
        
        const { unconfigured } = await res.json();
        
        // Get ignored disks
        const ignoredRes = await authFetch(`${API_BASE}/storage/disks/ignored`);
        const { ignored } = ignoredRes.ok ? await ignoredRes.json() : { ignored: [] };
        
        // Filter out ignored disks
        const newDisks = unconfigured.filter(d => !ignored.includes(d.id));
        
        if (newDisks.length > 0 && !diskNotificationShown) {
            detectedNewDisks = newDisks;
            showDiskNotification(newDisks);
        } else if (newDisks.length === 0) {
            hideDiskNotification();
        }
    } catch (e) {
        console.error('Disk detection error:', e);
    }
}

// Show notification banner for new disks
function showDiskNotification(disks) {
    diskNotificationShown = true;
    
    // Remove existing notification if any
    const existing = document.getElementById('disk-notification');
    if (existing) existing.remove();
    
    const notification = document.createElement('div');
    notification.id = 'disk-notification';
    notification.style.cssText = `
        position: fixed;
        top: 70px;
        right: 20px;
        background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
        border: 1px solid #4ecdc4;
        border-radius: 12px;
        padding: 16px 20px;
        z-index: 99999;
        box-shadow: 0 8px 32px rgba(78, 205, 196, 0.3);
        max-width: 400px;
        animation: slideIn 0.3s ease-out;
    `;
    
    notification.innerHTML = `
        <style>
            @keyframes slideIn {
                from { transform: translateX(100%); opacity: 0; }
                to { transform: translateX(0); opacity: 1; }
            }
            .disk-notif-close {
                position: absolute;
                top: 8px;
                right: 12px;
                background: none;
                border: none;
                color: #888;
                font-size: 18px;
                cursor: pointer;
            }
            .disk-notif-close:hover { color: #fff; }
            .disk-notif-item {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 8px 0;
                border-bottom: 1px solid rgba(255,255,255,0.1);
            }
            .disk-notif-item:last-child { border-bottom: none; }
            .disk-notif-actions {
                display: flex;
                gap: 8px;
                margin-top: 12px;
            }
            .disk-notif-btn {
                padding: 6px 12px;
                border-radius: 6px;
                border: none;
                cursor: pointer;
                font-size: 12px;
                transition: all 0.2s;
            }
            .disk-notif-btn.primary {
                background: #4ecdc4;
                color: #1a1a2e;
            }
            .disk-notif-btn.secondary {
                background: rgba(255,255,255,0.1);
                color: #fff;
            }
            .disk-notif-btn:hover { transform: scale(1.05); }
        </style>
        <button class="disk-notif-close">×</button>
        <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 12px;">
            <span style="font-size: 24px;">🆕</span>
            <div>
                <div style="color: #4ecdc4; font-weight: 600;">Nuevo disco detectado</div>
                <div style="color: #888; font-size: 12px;">${disks.length} disco(s) disponible(s)</div>
            </div>
        </div>
        <div id="disk-notif-list">
            ${disks.map(d => `
                <div class="disk-notif-item">
                    <div>
                        <div style="color: #fff; font-weight: 500;">${d.model || d.id}</div>
                        <div style="color: #888; font-size: 11px;">${d.sizeFormatted} • ${d.id}</div>
                    </div>
                </div>
            `).join('')}
        </div>
        <div class="disk-notif-actions">
            <button class="disk-notif-btn primary" id="disk-notif-configure">Configurar</button>
            <button class="disk-notif-btn secondary" id="disk-notif-ignore">Ignorar</button>
        </div>
    `;
    
    document.body.appendChild(notification);
    
    // Add event listeners (CSP blocks inline onclick)
    document.getElementById('disk-notif-configure').addEventListener('click', showDiskActionModal);
    document.getElementById('disk-notif-ignore').addEventListener('click', ignoreDiskNotification);
    notification.querySelector('.disk-notif-close').addEventListener('click', hideDiskNotification);
}

function hideDiskNotification() {
    diskNotificationShown = false;
    const notification = document.getElementById('disk-notification');
    if (notification) {
        notification.style.animation = 'slideOut 0.3s ease-in forwards';
        setTimeout(() => notification.remove(), 300);
    }
}

// Add slideOut animation
const styleSheet = document.createElement('style');
styleSheet.textContent = `
    @keyframes slideOut {
        from { transform: translateX(0); opacity: 1; }
        to { transform: translateX(100%); opacity: 0; }
    }
`;
document.head.appendChild(styleSheet);

// Show modal to configure detected disk(s)
function showDiskActionModal() {
    hideDiskNotification();
    
    // Remove any existing modal first
    const existingModal = document.getElementById('disk-action-modal');
    if (existingModal) existingModal.remove();
    
    const modal = document.createElement('div');
    modal.id = 'disk-action-modal';
    modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0,0,0,0.8);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 99999;
    `;
    
    modal.innerHTML = `
        <div style="
            background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
            border: 1px solid rgba(78, 205, 196, 0.3);
            border-radius: 16px;
            padding: 24px;
            width: 90%;
            max-width: 500px;
            max-height: 80vh;
            overflow-y: auto;
        ">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
                <h3 style="color: #4ecdc4; margin: 0;">🆕 Configurar Nuevo Disco</h3>
                <div style="display: flex; gap: 8px;">
                    <button id="disk-modal-minimize" style="background: none; border: none; color: #888; font-size: 18px; cursor: pointer; display: none;" title="Minimizar">─</button>
                    <button id="disk-modal-close" style="background: none; border: none; color: #888; font-size: 24px; cursor: pointer;">×</button>
                </div>
            </div>
            
            <div id="disk-action-list">
                ${detectedNewDisks.map((d, i) => `
                    <div class="disk-config-card" style="
                        background: rgba(255,255,255,0.05);
                        border-radius: 12px;
                        padding: 16px;
                        margin-bottom: 16px;
                    ">
                        <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 12px;">
                            <div>
                                <div style="color: #fff; font-weight: 600; font-size: 16px;">${d.model || 'Disco'}</div>
                                <div style="color: #888; font-size: 12px;">${d.sizeFormatted} • /dev/${d.id}</div>
                                ${d.hasData ? '<div style="color: #f39c12; font-size: 11px; margin-top: 4px;">⚠️ Contiene datos</div>' : ''}
                            </div>
                            <div style="background: rgba(78,205,196,0.2); padding: 4px 8px; border-radius: 4px; font-size: 11px; color: #4ecdc4;">
                                ${d.transport?.toUpperCase() || 'N/A'}
                            </div>
                        </div>
                        
                        <div style="margin-bottom: 12px;">
                            <label style="color: #888; font-size: 12px; display: block; margin-bottom: 6px;">¿Qué hacer con este disco?</label>
                            <select id="disk-action-${d.id}" style="
                                width: 100%;
                                padding: 10px;
                                border-radius: 8px;
                                background: rgba(0,0,0,0.3);
                                border: 1px solid rgba(255,255,255,0.1);
                                color: #fff;
                                font-size: 14px;
                            ">
                                <option value="pool-data">📦 Añadir al pool (datos)</option>
                                <option value="pool-cache">⚡ Añadir al pool (caché)</option>
                                <option value="standalone">💾 Volumen independiente</option>
                                <option value="ignore">🔕 Ignorar</option>
                            </select>
                        </div>
                        
                        <div id="disk-options-${d.id}">
                            <div style="margin-bottom: 8px;">
                                <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
                                    <input type="checkbox" id="disk-format-${d.id}" ${d.hasData ? '' : 'checked'} style="accent-color: #4ecdc4;">
                                    <span style="color: #ccc; font-size: 13px;">Formatear disco (ext4)</span>
                                </label>
                                ${d.hasData ? '<div style="color: #e74c3c; font-size: 11px; margin-left: 24px;">⚠️ Esto borrará todos los datos</div>' : ''}
                            </div>
                            
                            <div id="standalone-name-${d.id}" style="display: none; margin-top: 8px;">
                                <label style="color: #888; font-size: 12px; display: block; margin-bottom: 4px;">Nombre del volumen:</label>
                                <input type="text" id="disk-name-${d.id}" placeholder="ej: backups" value="${d.id}" style="
                                    width: 100%;
                                    padding: 8px;
                                    border-radius: 6px;
                                    background: rgba(0,0,0,0.3);
                                    border: 1px solid rgba(255,255,255,0.1);
                                    color: #fff;
                                ">
                            </div>
                        </div>
                    </div>
                `).join('')}
            </div>
            
            <!-- Progress Section (hidden initially) -->
            <div id="disk-progress-section" style="display: none;">
                <div style="border-top: 1px solid rgba(255,255,255,0.1); padding-top: 16px; margin-top: 16px;">
                    <h4 style="color: #4ecdc4; margin: 0 0 12px 0; font-size: 14px;">📊 Progreso</h4>
                    <div id="disk-progress-steps"></div>
                </div>
            </div>
            
            <div id="disk-modal-buttons" style="display: flex; gap: 12px; justify-content: flex-end; margin-top: 20px;">
                <button id="disk-modal-cancel" style="
                    padding: 10px 20px;
                    border-radius: 8px;
                    background: rgba(255,255,255,0.1);
                    border: none;
                    color: #fff;
                    cursor: pointer;
                ">Cancelar</button>
                <button id="disk-modal-apply" style="
                    padding: 10px 20px;
                    border-radius: 8px;
                    background: #4ecdc4;
                    border: none;
                    color: #1a1a2e;
                    font-weight: 600;
                    cursor: pointer;
                ">Aplicar</button>
            </div>
            
            <!-- Close button after completion (hidden initially) -->
            <div id="disk-modal-done" style="display: none; margin-top: 20px; text-align: center;">
                <button id="disk-modal-close-done" style="
                    padding: 12px 32px;
                    border-radius: 8px;
                    background: #10b981;
                    border: none;
                    color: #fff;
                    font-weight: 600;
                    cursor: pointer;
                    font-size: 14px;
                ">✓ Cerrar</button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    // Use event delegation on the modal for all button clicks
    modal.addEventListener('click', (e) => {
        const target = e.target;
        
        // Close button (X)
        if (target.id === 'disk-modal-close' || target.closest('#disk-modal-close')) {
            e.preventDefault();
            closeDiskActionModal();
            return;
        }
        
        // Cancel button
        if (target.id === 'disk-modal-cancel' || target.closest('#disk-modal-cancel')) {
            e.preventDefault();
            closeDiskActionModal();
            return;
        }
        
        // Apply button
        if (target.id === 'disk-modal-apply' || target.closest('#disk-modal-apply')) {
            e.preventDefault();
            console.log('Apply button clicked!');
            applyDiskActions();
            return;
        }
        
        // Close done button (after completion)
        if (target.id === 'disk-modal-close-done' || target.closest('#disk-modal-close-done')) {
            e.preventDefault();
            closeDiskActionModal();
            removeDiskProgressWidget();
            // Refresh storage view
            if (state.currentView === 'storage') {
                renderContent('storage');
            }
            return;
        }
        
        // Minimize button
        if (target.id === 'disk-modal-minimize' || target.closest('#disk-modal-minimize')) {
            e.preventDefault();
            minimizeDiskModal();
            return;
        }
    });
    
    // Add event listeners for action changes (select dropdowns)
    detectedNewDisks.forEach(d => {
        const select = document.getElementById(`disk-action-${d.id}`);
        const standaloneDiv = document.getElementById(`standalone-name-${d.id}`);
        if (select && standaloneDiv) {
            select.addEventListener('change', () => {
                standaloneDiv.style.display = select.value === 'standalone' ? 'block' : 'none';
            });
        }
    });
    
    console.log('Disk action modal opened for disks:', detectedNewDisks.map(d => d.id));
}

function closeDiskActionModal() {
    const modal = document.getElementById('disk-action-modal');
    if (modal) modal.remove();
}

// Minimize modal to floating widget
function minimizeDiskModal() {
    const modal = document.getElementById('disk-action-modal');
    if (modal) modal.style.display = 'none';
    
    // Create or show floating widget
    let widget = document.getElementById('disk-progress-widget');
    if (!widget) {
        widget = document.createElement('div');
        widget.id = 'disk-progress-widget';
        widget.style.cssText = `
            position: fixed;
            bottom: 20px;
            right: 20px;
            background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
            border: 1px solid rgba(78, 205, 196, 0.3);
            border-radius: 12px;
            padding: 12px 16px;
            min-width: 250px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.4);
            z-index: 99998;
            cursor: pointer;
            transition: transform 0.2s;
        `;
        widget.innerHTML = `
            <div style="display: flex; align-items: center; gap: 12px;">
                <div class="disk-widget-spinner" style="
                    width: 20px;
                    height: 20px;
                    border: 2px solid rgba(78,205,196,0.3);
                    border-top-color: #4ecdc4;
                    border-radius: 50%;
                    animation: spin 1s linear infinite;
                "></div>
                <div>
                    <div style="color: #fff; font-weight: 600; font-size: 13px;">Configurando disco...</div>
                    <div id="disk-widget-status" style="color: #888; font-size: 11px;">En progreso</div>
                </div>
            </div>
        `;
        
        // Add spin animation if not exists
        if (!document.getElementById('spin-keyframes')) {
            const style = document.createElement('style');
            style.id = 'spin-keyframes';
            style.textContent = '@keyframes spin { to { transform: rotate(360deg); } }';
            document.head.appendChild(style);
        }
        
        widget.addEventListener('click', () => {
            widget.style.display = 'none';
            const modal = document.getElementById('disk-action-modal');
            if (modal) modal.style.display = 'flex';
        });
        
        widget.addEventListener('mouseenter', () => {
            widget.style.transform = 'scale(1.02)';
        });
        widget.addEventListener('mouseleave', () => {
            widget.style.transform = 'scale(1)';
        });
        
        document.body.appendChild(widget);
    } else {
        widget.style.display = 'block';
    }
}

// Update floating widget status
function updateDiskWidget(status, isDone = false) {
    const statusEl = document.getElementById('disk-widget-status');
    const widget = document.getElementById('disk-progress-widget');
    if (statusEl) statusEl.textContent = status;
    
    if (isDone && widget) {
        const spinner = widget.querySelector('.disk-widget-spinner');
        if (spinner) {
            spinner.style.animation = 'none';
            spinner.style.borderColor = '#10b981';
            spinner.innerHTML = '✓';
            spinner.style.display = 'flex';
            spinner.style.alignItems = 'center';
            spinner.style.justifyContent = 'center';
            spinner.style.color = '#10b981';
            spinner.style.fontSize = '12px';
        }
    }
}

// Remove floating widget
function removeDiskProgressWidget() {
    const widget = document.getElementById('disk-progress-widget');
    if (widget) widget.remove();
}

// Helper to update progress step UI
function updateDiskProgressStep(diskId, step, status, message) {
    const stepEl = document.getElementById(`progress-${diskId}-${step}`);
    if (!stepEl) return;
    
    const icons = { pending: '⏳', running: '🔄', done: '✅', error: '❌' };
    const colors = { pending: '#888', running: '#f59e0b', done: '#10b981', error: '#ef4444' };
    
    stepEl.innerHTML = `
        <span style="margin-right: 8px;">${icons[status]}</span>
        <span style="color: ${colors[status]};">${message}</span>
    `;
}

// Apply the selected actions for each disk
async function applyDiskActions() {
    console.log('applyDiskActions called, disks:', detectedNewDisks);
    
    if (!detectedNewDisks || detectedNewDisks.length === 0) {
        showNotification('No hay discos para configurar', 'error');
        closeDiskActionModal();
        return;
    }
    
    // Hide action list and buttons, show progress
    const actionList = document.getElementById('disk-action-list');
    const buttons = document.getElementById('disk-modal-buttons');
    const progressSection = document.getElementById('disk-progress-section');
    const minimizeBtn = document.getElementById('disk-modal-minimize');
    const progressSteps = document.getElementById('disk-progress-steps');
    const doneSection = document.getElementById('disk-modal-done');
    const closeBtn = document.getElementById('disk-modal-close');
    
    if (actionList) actionList.style.display = 'none';
    if (buttons) buttons.style.display = 'none';
    if (closeBtn) closeBtn.style.display = 'none';
    if (progressSection) progressSection.style.display = 'block';
    if (minimizeBtn) minimizeBtn.style.display = 'block'; // Show minimize button during progress
    
    // Build progress UI for each disk
    const diskConfigs = [];
    for (const disk of detectedNewDisks) {
        const action = document.getElementById(`disk-action-${disk.id}`)?.value;
        const format = document.getElementById(`disk-format-${disk.id}`)?.checked;
        const name = document.getElementById(`disk-name-${disk.id}`)?.value || disk.id;
        
        if (action === 'ignore') continue;
        
        diskConfigs.push({ disk, action, format, name });
        
        // Create progress steps for this disk
        const diskProgress = document.createElement('div');
        diskProgress.style.cssText = 'background: rgba(0,0,0,0.2); border-radius: 8px; padding: 12px; margin-bottom: 12px;';
        diskProgress.innerHTML = `
            <div style="color: #fff; font-weight: 600; margin-bottom: 8px;">💾 ${disk.model || disk.id} (${disk.sizeFormatted})</div>
            <div id="progress-${disk.id}-format" style="font-size: 13px; margin: 4px 0; display: ${format ? 'block' : 'none'};">
                <span style="margin-right: 8px;">⏳</span>
                <span style="color: #888;">Formatear disco...</span>
            </div>
            <div id="progress-${disk.id}-mount" style="font-size: 13px; margin: 4px 0;">
                <span style="margin-right: 8px;">⏳</span>
                <span style="color: #888;">Montar disco...</span>
            </div>
            <div id="progress-${disk.id}-pool" style="font-size: 13px; margin: 4px 0; display: ${action.startsWith('pool') ? 'block' : 'none'};">
                <span style="margin-right: 8px;">⏳</span>
                <span style="color: #888;">Añadir al pool...</span>
            </div>
            <div id="progress-${disk.id}-result" style="font-size: 13px; margin: 8px 0 0 0; display: none;"></div>
        `;
        progressSteps.appendChild(diskProgress);
    }
    
    if (diskConfigs.length === 0) {
        showNotification('Todos los discos marcados como ignorar', 'info');
        closeDiskActionModal();
        return;
    }
    
    // Process each disk
    const results = [];
    
    for (const { disk, action, format, name } of diskConfigs) {
        console.log(`Processing disk ${disk.id}: action=${action}, format=${format}`);
        
        if (!action) continue;
        
        try {
            let res;
            
            // Update UI: formatting
            if (format) {
                updateDiskProgressStep(disk.id, 'format', 'running', 'Formateando disco (puede tardar unos minutos)...');
                updateDiskWidget('Formateando ' + (disk.model || disk.id) + '...');
            }
            updateDiskProgressStep(disk.id, 'mount', 'pending', 'Montar disco...');
            if (action.startsWith('pool')) {
                updateDiskProgressStep(disk.id, 'pool', 'pending', 'Añadir al pool...');
            }
            
            if (action === 'pool-data' || action === 'pool-cache') {
                res = await authFetch(`${API_BASE}/storage/disks/add-to-pool`, {
                    method: 'POST',
                    body: JSON.stringify({
                        diskId: disk.id,
                        format: format,
                        role: action === 'pool-cache' ? 'cache' : 'data'
                    })
                });
            } else if (action === 'standalone') {
                res = await authFetch(`${API_BASE}/storage/disks/mount-standalone`, {
                    method: 'POST',
                    body: JSON.stringify({
                        diskId: disk.id,
                        format: format,
                        name: name
                    })
                });
            } else if (action === 'ignore') {
                res = await authFetch(`${API_BASE}/storage/disks/ignore`, {
                    method: 'POST',
                    body: JSON.stringify({ diskId: disk.id })
                });
            }
            
            if (res && res.ok) {
                const data = await res.json();
                results.push({ disk: disk.id, success: true, message: data.message });
                
                // Update UI: success
                if (format) updateDiskProgressStep(disk.id, 'format', 'done', 'Disco formateado');
                updateDiskProgressStep(disk.id, 'mount', 'done', 'Disco montado');
                if (action.startsWith('pool')) {
                    updateDiskProgressStep(disk.id, 'pool', 'done', 'Añadido al pool');
                }
                
                // Show result
                const resultEl = document.getElementById(`progress-${disk.id}-result`);
                if (resultEl) {
                    resultEl.style.display = 'block';
                    resultEl.innerHTML = `<span style="color: #10b981; font-weight: 600;">✅ ${data.message || 'Completado'}</span>`;
                }
            } else if (res) {
                const err = await res.json().catch(() => ({ error: 'Error desconocido' }));
                results.push({ disk: disk.id, success: false, message: err.error });
                
                // Update UI: error
                if (format) updateDiskProgressStep(disk.id, 'format', 'error', 'Error al formatear');
                updateDiskProgressStep(disk.id, 'mount', 'error', 'Error');
                
                // Show error
                const resultEl = document.getElementById(`progress-${disk.id}-result`);
                if (resultEl) {
                    resultEl.style.display = 'block';
                    resultEl.innerHTML = `<span style="color: #ef4444; font-weight: 600;">&#10060; ${escapeHtml(err.error)}</span>`;
                }
            }
        } catch (e) {
            // Check if it's a session/CSRF error - redirect to login
            if (e.message === 'CSRF_EXPIRED' || e.message.includes('CSRF') || e.message.includes('session')) {
                closeDiskActionModal();
                return; // authFetch already handles the redirect
            }
            
            results.push({ disk: disk.id, success: false, message: e.message });
            
            // Update UI: error
            updateDiskProgressStep(disk.id, 'format', 'error', 'Error');
            const resultEl = document.getElementById(`progress-${disk.id}-result`);
            if (resultEl) {
                resultEl.style.display = 'block';
                resultEl.innerHTML = `<span style="color: #ef4444; font-weight: 600;">&#10060; ${escapeHtml(e.message)}</span>`;
            }
        }
    }
    
    // Show done button, hide minimize button
    if (doneSection) doneSection.style.display = 'block';
    if (minimizeBtn) minimizeBtn.style.display = 'none';
    
    // Update widget as completed
    const successCount = results.filter(r => r.success).length;
    const failCount = results.filter(r => !r.success).length;
    
    if (failCount === 0 && successCount > 0) {
        updateDiskWidget(`✅ ${successCount} disco(s) configurado(s)`, true);
        showNotification(`✅ ${successCount} disco(s) configurado(s) correctamente`, 'success');
    } else if (failCount > 0) {
        updateDiskWidget(`⚠️ ${failCount} error(es)`, true);
        showNotification(`⚠️ ${failCount} error(es) al configurar discos`, 'error');
    }
    
    // Auto-remove widget after 5 seconds if completed successfully
    if (failCount === 0) {
        setTimeout(removeDiskProgressWidget, 5000);
    }
    
    // Reset detection state
    detectedNewDisks = [];
    diskNotificationShown = false;
}

// Ignore all detected disks
async function ignoreDiskNotification() {
    for (const disk of detectedNewDisks) {
        try {
            await authFetch(`${API_BASE}/storage/disks/ignore`, {
                method: 'POST',
                body: JSON.stringify({ diskId: disk.id })
            });
        } catch (e) {
            console.error('Failed to ignore disk:', e);
        }
    }
    hideDiskNotification();
    detectedNewDisks = [];
}

// Expose disk functions globally for onclick handlers
window.showDiskActionModal = showDiskActionModal;
window.closeDiskActionModal = closeDiskActionModal;
window.applyDiskActions = applyDiskActions;
window.ignoreDiskNotification = ignoreDiskNotification;

// Start disk detection polling (check every 30 seconds)
function startDiskDetectionPolling() {
    // Initial check after 5 seconds (give time for page to load)
    setTimeout(checkForNewDisks, 5000);
    // Then check every 30 seconds
    state.pollingIntervals.diskDetection = setInterval(checkForNewDisks, 30000);
}

// Router / View Switcher
// skipRender=true when caller will handle rendering separately (e.g. initAuth with URL routing)
function switchView(viewName, skipRender = false) {
    Object.values(views).forEach(v => v.classList.remove('active'));
    if (views[viewName]) {
        views[viewName].classList.add('active');
        if (viewName === 'dashboard' && !skipRender) renderContent('dashboard');
        // Update username display and avatar
        if (state.user) {
            state.username = state.user.username || "Admin";
            if (typeof updateUserAvatar === 'function') updateUserAvatar();
        }
    }
    updateHeaderIPVisibility();
    
    // Hide old settings controls when dashboard is active (dashboard has its own header)
    const settingsControls = document.getElementById('settings-controls');
    if (settingsControls) {
        settingsControls.style.display = viewName === 'dashboard' ? 'none' : 'flex';
    }
}

function updateHeaderIPVisibility() {
    const ipContainer = document.getElementById('public-ip-container');
    if (ipContainer) {
        const activeNav = document.querySelector('.nav-links li.active');
        const view = activeNav ? activeNav.dataset.view : '';
        const isAuth = views.dashboard.classList.contains('active');
        ipContainer.style.display = (isAuth && (view === 'network' || view === 'dashboard')) ? 'flex' : 'none';
    }
}

// First-Time Setup
setupForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('new-username').value.trim();
    const password = document.getElementById('new-password').value;
    const btn = e.target.querySelector('button');
    btn.textContent = 'Hardware Sync...';
    btn.disabled = true;

    try {
        const res = await fetch(`${API_BASE}/setup`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });

        const data = await res.json();

        if (!res.ok) {
            alert(data.message || 'Setup failed');
            btn.disabled = false;
            btn.textContent = 'Initialize Gateway';
            return;
        }

        // Save session from setup response
        if (data.sessionId) {
            saveSession(data.sessionId, data.csrfToken);
        }

        // Store only username, never password
        state.user = { username };
        switchView('storage');
        initStorageSetup();
    } catch (e) {
        console.error('Setup error:', e);
        alert('Hardware Link Failed');
        btn.disabled = false;
        btn.textContent = 'Initialize Gateway';
    }
});

// =============================================================================
// STORAGE WIZARD - Step-by-step configuration
// =============================================================================

const wizardState = {
    currentStep: 1,
    totalSteps: 7,
    disks: [],
    selectedDataDisks: [],
    selectedParityDisk: null,
    selectedCacheDisk: null,
    isConfiguring: false
};

// Load wizard state from localStorage
function loadWizardState() {
    try {
        const saved = localStorage.getItem('homepinas-wizard-state');
        if (saved) {
            const parsed = JSON.parse(saved);
            Object.assign(wizardState, parsed);
            return true;
        }
    } catch (e) {
        console.warn('Could not load wizard state:', e);
    }
    return false;
}

// Save wizard state to localStorage
function saveWizardState() {
    try {
        localStorage.setItem('homepinas-wizard-state', JSON.stringify({
            currentStep: wizardState.currentStep,
            selectedDataDisks: wizardState.selectedDataDisks,
            selectedParityDisk: wizardState.selectedParityDisk,
            selectedCacheDisk: wizardState.selectedCacheDisk
        }));
    } catch (e) {
        console.warn('Could not save wizard state:', e);
    }
}

// Clear wizard state
function clearWizardState() {
    wizardState.currentStep = 1;
    wizardState.selectedDataDisks = [];
    wizardState.selectedParityDisk = null;
    wizardState.selectedCacheDisk = null;
    localStorage.removeItem('homepinas-wizard-state');
}

// Initialize the storage wizard
function initStorageSetup() {
    console.log('[Wizard] Initializing storage setup wizard');
    
    // Load any saved state
    const hasSavedState = loadWizardState();
    
    // Start disk detection
    detectDisksForWizard();
    
    // Setup wizard navigation
    setupWizardNavigation();
    
    // If we have saved state and disks, restore to that step
    if (hasSavedState && wizardState.currentStep > 1) {
        // We'll navigate to the saved step after disk detection completes
    }
}

// Detect disks and populate the wizard
async function detectDisksForWizard() {
    const detectionContainer = document.getElementById('wizard-disk-detection');
    if (!detectionContainer) return;
    
    // Show loading spinner
    detectionContainer.innerHTML = `
        <div class="wizard-detecting">
            <div class="wizard-spinner"></div>
            <p class="wizard-detecting-text">${t('wizard.detectingDisks', 'Detectando discos conectados...')}</p>
        </div>
    `;
    
    try {
        const res = await fetch(`${API_BASE}/system/disks`);
        if (!res.ok) throw new Error('Failed to fetch disks');
        
        wizardState.disks = await res.json();
        state.disks = wizardState.disks; // Keep global state in sync
        
        // Short delay for UX (show the spinner briefly)
        await new Promise(r => setTimeout(r, 800));
        
        if (wizardState.disks.length === 0) {
            detectionContainer.innerHTML = `
                <div class="wizard-no-disks">
                    <div class="wizard-no-disks-icon">💿</div>
                    <p>${t('wizard.noDisks', 'No se detectaron discos disponibles')}</p>
                    <button class="wizard-btn wizard-btn-next" onclick="detectDisksForWizard()" style="margin-top: 16px;">
                        🔄 ${t('wizard.retry', 'Reintentar')}
                    </button>
                </div>
            `;
            return;
        }
        
        // Show detected disks summary
        detectionContainer.innerHTML = `
            <div style="text-align: center; padding: 20px 0;">
                <div style="font-size: 3rem; margin-bottom: 16px;">✅</div>
                <p style="font-size: 1.1rem; color: var(--text-primary); margin-bottom: 8px;">
                    <strong>${wizardState.disks.length}</strong> ${t('wizard.disksDetected', 'disco(s) detectado(s)')}
                </p>
                <div style="display: flex; justify-content: center; gap: 16px; margin-top: 16px; flex-wrap: wrap;">
                    ${wizardState.disks.map(d => `
                        <div style="background: var(--hover-bg); padding: 8px 16px; border-radius: 8px; font-size: 0.9rem;">
                            ${getDiskIcon(d.type)} ${escapeHtml(d.model || d.id)} <span style="color: var(--primary); font-weight: 600;">${escapeHtml(d.size)}</span>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
        
        // Enable next button
        const nextBtn = document.getElementById('wizard-next-1');
        if (nextBtn) nextBtn.disabled = false;
        
        // Populate disk lists for other steps
        populateWizardDiskLists();
        
        // Restore selections if we have saved state
        if (wizardState.selectedDataDisks.length > 0 || wizardState.selectedParityDisk || wizardState.selectedCacheDisk) {
            restoreWizardSelections();
        }
        
    } catch (e) {
        console.error('[Wizard] Disk detection error:', e);
        detectionContainer.innerHTML = `
            <div class="wizard-no-disks">
                <div class="wizard-no-disks-icon">❌</div>
                <p>${t('wizard.detectionError', 'Error al detectar discos')}</p>
                <button class="wizard-btn wizard-btn-next" onclick="detectDisksForWizard()" style="margin-top: 16px;">
                    🔄 ${t('wizard.retry', 'Reintentar')}
                </button>
            </div>
        `;
    }
}

// Get appropriate icon for disk type
function getDiskIcon(type) {
    switch (type?.toUpperCase()) {
        case 'NVME': return '⚡';
        case 'SSD': return '💾';
        case 'HDD': return '💿';
        default: return '📀';
    }
}

// Populate disk selection lists for all wizard steps
function populateWizardDiskLists() {
    // Data disks (all disks available)
    const dataList = document.getElementById('wizard-data-disks');
    if (dataList) {
        dataList.innerHTML = wizardState.disks.map(disk => createDiskCard(disk, 'checkbox', 'data')).join('');
        setupDiskCardListeners(dataList, 'data');
    }
    
    // Parity disks (all disks, but will filter based on data selection)
    const parityList = document.getElementById('wizard-parity-disks');
    if (parityList) {
        parityList.innerHTML = wizardState.disks.map(disk => createDiskCard(disk, 'radio', 'parity')).join('');
        setupDiskCardListeners(parityList, 'parity');
    }
    
    // Cache disks (only SSD/NVMe)
    const cacheList = document.getElementById('wizard-cache-disks');
    const noCacheMsg = document.getElementById('wizard-no-cache-disks');
    if (cacheList) {
        const ssdDisks = wizardState.disks.filter(d => d.type === 'NVMe' || d.type === 'SSD');
        if (ssdDisks.length > 0) {
            cacheList.innerHTML = ssdDisks.map(disk => createDiskCard(disk, 'radio', 'cache')).join('');
            cacheList.style.display = 'flex';
            if (noCacheMsg) noCacheMsg.style.display = 'none';
            setupDiskCardListeners(cacheList, 'cache');
        } else {
            cacheList.style.display = 'none';
            if (noCacheMsg) noCacheMsg.style.display = 'block';
        }
    }
}

// Create a disk selection card
function createDiskCard(disk, inputType, role) {
    const typeClass = (disk.type || 'hdd').toLowerCase();
    const selectorClass = inputType === 'checkbox' ? 'wizard-disk-checkbox' : 'wizard-disk-radio';
    
    return `
        <div class="wizard-disk-card" data-disk-id="${escapeHtml(disk.id)}" data-role="${role}">
            <div class="${selectorClass}"></div>
            <div class="wizard-disk-icon">${getDiskIcon(disk.type)}</div>
            <div class="wizard-disk-info">
                <div class="wizard-disk-name">
                    ${escapeHtml(disk.model || 'Unknown Disk')}
                    <span class="wizard-disk-badge ${typeClass}">${escapeHtml(disk.type || 'HDD')}</span>
                </div>
                <div class="wizard-disk-details">
                    /dev/${escapeHtml(disk.id)} • ${disk.temp ? disk.temp + '°C' : 'N/A'}
                </div>
            </div>
            <div class="wizard-disk-size">${escapeHtml(disk.size)}</div>
        </div>
    `;
}

// Setup click listeners for disk cards
function setupDiskCardListeners(container, role) {
    container.querySelectorAll('.wizard-disk-card').forEach(card => {
        card.addEventListener('click', () => handleDiskSelection(card, role));
    });
}

// Handle disk selection
function handleDiskSelection(card, role) {
    const diskId = card.dataset.diskId;
    const disk = wizardState.disks.find(d => d.id === diskId);
    if (!disk) return;
    
    if (role === 'data') {
        // Checkbox behavior - toggle selection
        card.classList.toggle('selected');
        
        if (card.classList.contains('selected')) {
            if (!wizardState.selectedDataDisks.includes(diskId)) {
                wizardState.selectedDataDisks.push(diskId);
            }
        } else {
            wizardState.selectedDataDisks = wizardState.selectedDataDisks.filter(id => id !== diskId);
        }
        
        // Update next button state
        const nextBtn = document.getElementById('wizard-next-2');
        if (nextBtn) nextBtn.disabled = wizardState.selectedDataDisks.length === 0;
        
        // Update parity disk options (disable selected data disks)
        updateParityDiskOptions();
        
    } else if (role === 'parity') {
        // Radio behavior - single selection
        const container = card.parentElement;
        container.querySelectorAll('.wizard-disk-card').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        wizardState.selectedParityDisk = diskId;
        
    } else if (role === 'cache') {
        // Radio behavior - single selection
        const container = card.parentElement;
        container.querySelectorAll('.wizard-disk-card').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        wizardState.selectedCacheDisk = diskId;
    }
    
    saveWizardState();
}

// Update parity disk options based on data disk selection
function updateParityDiskOptions() {
    const parityList = document.getElementById('wizard-parity-disks');
    if (!parityList) return;
    
    // Get the largest selected data disk size
    const selectedDataDiskSizes = wizardState.selectedDataDisks.map(id => {
        const disk = wizardState.disks.find(d => d.id === id);
        return disk ? parseDiskSize(disk.size) : 0;
    });
    const largestDataSize = Math.max(...selectedDataDiskSizes, 0);
    
    // Update each parity disk card
    parityList.querySelectorAll('.wizard-disk-card').forEach(card => {
        const diskId = card.dataset.diskId;
        const disk = wizardState.disks.find(d => d.id === diskId);
        
        // Disable if selected as data disk
        const isDataDisk = wizardState.selectedDataDisks.includes(diskId);
        // Disable if smaller than largest data disk
        const isTooSmall = disk && parseDiskSize(disk.size) < largestDataSize;
        
        if (isDataDisk || isTooSmall) {
            card.classList.add('disabled');
            card.classList.remove('selected');
            if (wizardState.selectedParityDisk === diskId) {
                wizardState.selectedParityDisk = null;
            }
        } else {
            card.classList.remove('disabled');
        }
    });
    
    // Also update cache disk options
    updateCacheDiskOptions();
}

// Update cache disk options based on selections
function updateCacheDiskOptions() {
    const cacheList = document.getElementById('wizard-cache-disks');
    if (!cacheList) return;
    
    cacheList.querySelectorAll('.wizard-disk-card').forEach(card => {
        const diskId = card.dataset.diskId;
        const isDataDisk = wizardState.selectedDataDisks.includes(diskId);
        const isParityDisk = wizardState.selectedParityDisk === diskId;
        
        if (isDataDisk || isParityDisk) {
            card.classList.add('disabled');
            card.classList.remove('selected');
            if (wizardState.selectedCacheDisk === diskId) {
                wizardState.selectedCacheDisk = null;
            }
        } else {
            card.classList.remove('disabled');
        }
    });
}

// Parse disk size string to bytes for comparison
function parseDiskSize(sizeStr) {
    if (!sizeStr) return 0;
    const match = sizeStr.match(/^([\d.]+)\s*(TB|GB|MB|KB|B)?$/i);
    if (!match) return 0;
    const num = parseFloat(match[1]);
    const unit = (match[2] || 'B').toUpperCase();
    const multipliers = { B: 1, KB: 1024, MB: 1024**2, GB: 1024**3, TB: 1024**4 };
    return num * (multipliers[unit] || 1);
}

// Restore saved selections when disk lists are populated
function restoreWizardSelections() {
    // Restore data disk selections
    wizardState.selectedDataDisks.forEach(diskId => {
        const card = document.querySelector(`#wizard-data-disks .wizard-disk-card[data-disk-id="${diskId}"]`);
        if (card) card.classList.add('selected');
    });
    
    // Update next button
    const nextBtn2 = document.getElementById('wizard-next-2');
    if (nextBtn2) nextBtn2.disabled = wizardState.selectedDataDisks.length === 0;
    
    // Restore parity selection
    if (wizardState.selectedParityDisk) {
        const card = document.querySelector(`#wizard-parity-disks .wizard-disk-card[data-disk-id="${wizardState.selectedParityDisk}"]`);
        if (card && !card.classList.contains('disabled')) card.classList.add('selected');
    }
    
    // Restore cache selection
    if (wizardState.selectedCacheDisk) {
        const card = document.querySelector(`#wizard-cache-disks .wizard-disk-card[data-disk-id="${wizardState.selectedCacheDisk}"]`);
        if (card && !card.classList.contains('disabled')) card.classList.add('selected');
    }
    
    // Update dependent options
    updateParityDiskOptions();
}

// Setup wizard navigation buttons
function setupWizardNavigation() {
    // Step 1 -> 2
    document.getElementById('wizard-next-1')?.addEventListener('click', () => navigateWizard(2));
    
    // Step 2
    document.getElementById('wizard-back-2')?.addEventListener('click', () => navigateWizard(1));
    document.getElementById('wizard-next-2')?.addEventListener('click', () => {
        updateParityDiskOptions();
        navigateWizard(3);
    });
    
    // Step 3
    document.getElementById('wizard-back-3')?.addEventListener('click', () => navigateWizard(2));
    document.getElementById('wizard-next-3')?.addEventListener('click', () => {
        updateCacheDiskOptions();
        navigateWizard(4);
    });
    document.getElementById('wizard-skip-parity')?.addEventListener('click', () => {
        wizardState.selectedParityDisk = null;
        document.querySelectorAll('#wizard-parity-disks .wizard-disk-card').forEach(c => c.classList.remove('selected'));
        updateCacheDiskOptions();
        navigateWizard(4);
    });
    
    // Step 4
    document.getElementById('wizard-back-4')?.addEventListener('click', () => navigateWizard(3));
    document.getElementById('wizard-next-4')?.addEventListener('click', () => {
        updateSummary();
        navigateWizard(5);
    });
    document.getElementById('wizard-skip-cache')?.addEventListener('click', () => {
        wizardState.selectedCacheDisk = null;
        document.querySelectorAll('#wizard-cache-disks .wizard-disk-card').forEach(c => c.classList.remove('selected'));
        updateSummary();
        navigateWizard(5);
    });
    
    // Step 5
    document.getElementById('wizard-back-5')?.addEventListener('click', () => navigateWizard(4));
    document.getElementById('wizard-create-pool')?.addEventListener('click', createStoragePool);
    
    // Step 7 (completed)
    document.getElementById('wizard-go-dashboard')?.addEventListener('click', () => {
        clearWizardState();
        if (state.sessionId) {
            state.isAuthenticated = true;
            switchView('dashboard');
        } else {
            switchView('login');
        }
    });
}

// Navigate to a specific wizard step
function navigateWizard(step) {
    const currentStepEl = document.querySelector(`.wizard-step[data-step="${wizardState.currentStep}"]`);
    const nextStepEl = document.querySelector(`.wizard-step[data-step="${step}"]`);
    
    if (!currentStepEl || !nextStepEl) return;
    
    // Animate out current step
    currentStepEl.classList.add('exit');
    
    setTimeout(() => {
        currentStepEl.classList.remove('active', 'exit');
        nextStepEl.classList.add('active');
        
        // Update progress indicator
        updateWizardProgress(step);
        
        wizardState.currentStep = step;
        saveWizardState();
    }, 300);
}

// Update the progress dots
function updateWizardProgress(step) {
    const progressContainer = document.getElementById('wizard-progress');
    if (!progressContainer) return;
    
    // For steps 6 and 7 (progress and completion), hide the progress indicator
    if (step >= 6) {
        progressContainer.style.display = 'none';
        return;
    }
    progressContainer.style.display = 'flex';
    
    const dots = progressContainer.querySelectorAll('.wizard-progress-dot');
    const lines = progressContainer.querySelectorAll('.wizard-progress-line');
    
    dots.forEach((dot, index) => {
        const dotStep = index + 1;
        dot.classList.remove('active', 'completed');
        dot.textContent = dotStep;
        
        if (dotStep < step) {
            dot.classList.add('completed');
            dot.textContent = '';
        } else if (dotStep === step) {
            dot.classList.add('active');
        }
    });
    
    lines.forEach((line, index) => {
        line.classList.toggle('completed', index < step - 1);
    });
}

// Update the summary step
function updateSummary() {
    // Data disks summary
    const dataContainer = document.getElementById('summary-data-disks');
    if (dataContainer) {
        if (wizardState.selectedDataDisks.length > 0) {
            dataContainer.innerHTML = wizardState.selectedDataDisks.map(id => {
                const disk = wizardState.disks.find(d => d.id === id);
                return `
                    <div class="wizard-summary-disk">
                        ${getDiskIcon(disk?.type)} ${escapeHtml(disk?.model || id)}
                        <span class="disk-role data">${escapeHtml(disk?.size || 'N/A')}</span>
                    </div>
                `;
            }).join('');
        } else {
            dataContainer.innerHTML = '<span class="wizard-summary-empty">Ninguno seleccionado</span>';
        }
    }
    
    // Parity disk summary
    const parityContainer = document.getElementById('summary-parity-disk');
    if (parityContainer) {
        if (wizardState.selectedParityDisk) {
            const disk = wizardState.disks.find(d => d.id === wizardState.selectedParityDisk);
            parityContainer.innerHTML = `
                <div class="wizard-summary-disk">
                    ${getDiskIcon(disk?.type)} ${escapeHtml(disk?.model || wizardState.selectedParityDisk)}
                    <span class="disk-role parity">${escapeHtml(disk?.size || 'N/A')}</span>
                </div>
            `;
        } else {
            parityContainer.innerHTML = '<span class="wizard-summary-empty">Sin paridad (no protegido)</span>';
        }
    }
    
    // Cache disk summary
    const cacheContainer = document.getElementById('summary-cache-disk');
    if (cacheContainer) {
        if (wizardState.selectedCacheDisk) {
            const disk = wizardState.disks.find(d => d.id === wizardState.selectedCacheDisk);
            cacheContainer.innerHTML = `
                <div class="wizard-summary-disk">
                    ${getDiskIcon(disk?.type)} ${escapeHtml(disk?.model || wizardState.selectedCacheDisk)}
                    <span class="disk-role cache">${escapeHtml(disk?.size || 'N/A')}</span>
                </div>
            `;
        } else {
            cacheContainer.innerHTML = '<span class="wizard-summary-empty">Sin caché</span>';
        }
    }
    
    // Total capacity
    const totalContainer = document.getElementById('summary-total-capacity');
    if (totalContainer) {
        let totalBytes = 0;
        wizardState.selectedDataDisks.forEach(id => {
            const disk = wizardState.disks.find(d => d.id === id);
            if (disk) totalBytes += parseDiskSize(disk.size);
        });
        totalContainer.textContent = formatBytes(totalBytes);
    }
}

// Format bytes to human readable
function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Create the storage pool
async function createStoragePool() {
    if (wizardState.isConfiguring) return;
    if (wizardState.selectedDataDisks.length === 0) {
        showNotification('Debes seleccionar al menos un disco de datos', 'error');
        return;
    }
    
    wizardState.isConfiguring = true;
    
    // Navigate to progress step
    navigateWizard(6);
    
    // Build disk selections
    const selections = [];
    
    wizardState.selectedDataDisks.forEach(id => {
        selections.push({ id, role: 'data', format: true });
    });
    
    if (wizardState.selectedParityDisk) {
        selections.push({ id: wizardState.selectedParityDisk, role: 'parity', format: true });
    }
    
    if (wizardState.selectedCacheDisk) {
        selections.push({ id: wizardState.selectedCacheDisk, role: 'cache', format: true });
    }
    
    const tasks = ['format', 'mount', 'snapraid', 'mergerfs', 'fstab', 'sync'];
    
    try {
        // Update task: format
        updateWizardTask('format', 'running', 'Formateando discos...');
        await new Promise(r => setTimeout(r, 500));
        
        // Call the API to configure the pool
        const res = await authFetch(`${API_BASE}/storage/pool/configure`, {
            method: 'POST',
            body: JSON.stringify({ disks: selections })
        });
        
        const data = await res.json();
        
        if (!res.ok) {
            throw new Error(data.error || 'Error al configurar el pool');
        }
        
        // Simulate progress through tasks
        updateWizardTask('format', 'done', 'Discos formateados');
        await new Promise(r => setTimeout(r, 300));
        
        updateWizardTask('mount', 'running', 'Montando particiones...');
        await new Promise(r => setTimeout(r, 500));
        updateWizardTask('mount', 'done', 'Particiones montadas');
        
        updateWizardTask('snapraid', 'running', 'Configurando SnapRAID...');
        await new Promise(r => setTimeout(r, 500));
        updateWizardTask('snapraid', 'done', 'SnapRAID configurado');
        
        updateWizardTask('mergerfs', 'running', 'Configurando MergerFS...');
        await new Promise(r => setTimeout(r, 500));
        updateWizardTask('mergerfs', 'done', 'MergerFS configurado');
        
        updateWizardTask('fstab', 'running', 'Actualizando /etc/fstab...');
        await new Promise(r => setTimeout(r, 500));
        updateWizardTask('fstab', 'done', '/etc/fstab actualizado');
        
        updateWizardTask('sync', 'running', 'Sincronización inicial...');
        
        // Start sync in background if parity is configured
        if (wizardState.selectedParityDisk) {
            try {
                await authFetch(`${API_BASE}/storage/snapraid/sync`, { method: 'POST' });
                // Poll for sync progress (simplified)
                await new Promise(r => setTimeout(r, 2000));
                updateWizardTask('sync', 'done', 'Sincronización completada');
            } catch (syncError) {
                console.warn('Sync skipped:', syncError);
                updateWizardTask('sync', 'done', 'Sincronización programada');
            }
        } else {
            updateWizardTask('sync', 'done', 'Sin paridad - omitido');
        }
        
        // Update state
        state.storageConfig = selections;
        
        // Wait a moment then show completion
        await new Promise(r => setTimeout(r, 1000));
        navigateWizard(7);
        
        // Celebrate!
        celebrateWithConfetti();
        showNotification('¡Pool de almacenamiento creado exitosamente!', 'success', 5000);
        
    } catch (e) {
        console.error('[Wizard] Pool creation error:', e);
        showNotification('Error: ' + e.message, 'error');
        
        // Mark current task as error
        tasks.forEach(task => {
            const item = document.querySelector(`.wizard-progress-item[data-task="${task}"]`);
            if (item) {
                const icon = item.querySelector('.wizard-progress-icon');
                if (icon && icon.classList.contains('running')) {
                    updateWizardTask(task, 'error', 'Error: ' + e.message);
                }
            }
        });
        
        wizardState.isConfiguring = false;
    }
}

// Update a task in the progress list
function updateWizardTask(taskName, status, message) {
    const item = document.querySelector(`.wizard-progress-item[data-task="${taskName}"]`);
    if (!item) return;
    
    const icon = item.querySelector('.wizard-progress-icon');
    const statusEl = item.querySelector('.wizard-progress-status');
    
    // Update icon
    icon.classList.remove('pending', 'running', 'done', 'error');
    icon.classList.add(status);
    
    switch (status) {
        case 'pending':
            icon.textContent = '⏳';
            break;
        case 'running':
            icon.textContent = '🔄';
            break;
        case 'done':
            icon.textContent = '✅';
            break;
        case 'error':
            icon.textContent = '❌';
            break;
    }
    
    // Update status text
    if (statusEl && message) {
        statusEl.textContent = message;
    }
}

// Legacy function for compatibility
function updateSummaryLegacy() {
    const roles = { data: 0, parity: 0, cache: 0 };
    document.querySelectorAll('.role-btn.active').forEach(btn => {
        const role = btn.dataset.role;
        if (role !== 'none') roles[role]++;
    });
    const dataCount = document.getElementById('data-count');
    const parityCount = document.getElementById('parity-count');
    const cacheCount = document.getElementById('cache-count');
    if (dataCount) dataCount.textContent = roles.data;
    if (parityCount) parityCount.textContent = roles.parity;
    if (cacheCount) cacheCount.textContent = roles.cache;
}

// Storage Progress Modal Functions
const progressModal = document.getElementById('storage-progress-modal');
const progressSteps = {
    format: document.getElementById('step-format'),
    mount: document.getElementById('step-mount'),
    snapraid: document.getElementById('step-snapraid'),
    mergerfs: document.getElementById('step-mergerfs'),
    fstab: document.getElementById('step-fstab'),
    sync: document.getElementById('step-sync')
};

function showProgressModal() {
    if (progressModal) {
        progressModal.classList.add('active');
        // Reset all steps
        Object.values(progressSteps).forEach(step => {
            if (step) {
                step.classList.remove('active', 'completed', 'error');
                const icon = step.querySelector('.step-icon');
                if (icon) icon.textContent = '⏳';
            }
        });
    }
}

function hideProgressModal() {
    if (progressModal) progressModal.classList.remove('active');
}

function updateProgressStep(stepId, status) {
    const step = progressSteps[stepId];
    if (!step) return;

    const icon = step.querySelector('.step-icon');

    step.classList.remove('active', 'completed', 'error');

    if (status === 'active') {
        step.classList.add('active');
        if (icon) icon.textContent = '';
    } else if (status === 'completed') {
        step.classList.add('completed');
        if (icon) icon.textContent = '';
    } else if (status === 'error') {
        step.classList.add('error');
        if (icon) icon.textContent = '';
    }
}

function updateSyncProgress(percent, statusText) {
    const fill = document.getElementById('sync-progress-fill');
    const status = document.getElementById('sync-status');
    const percentValue = Math.min(100, Math.max(0, percent || 0));

    if (fill) {
        fill.style.width = `${percentValue}%`;
    }
    if (status) {
        if (statusText && statusText.length > 0) {
            status.textContent = `${percentValue}% - ${statusText}`;
        } else {
            status.textContent = `${percentValue}% complete`;
        }
    }
}

async function pollSyncProgress() {
    return new Promise((resolve) => {
        // Poll more frequently at start for better responsiveness
        let pollCount = 0;

        const pollInterval = setInterval(async () => {
            pollCount++;
            try {
                const res = await fetch(`${API_BASE}/storage/snapraid/sync/progress`);
                const data = await res.json();

                // Always update the progress display
                updateSyncProgress(data.progress || 0, data.status || 'Syncing...');

                if (!data.running) {
                    clearInterval(pollInterval);
                    if (data.error) {
                        updateProgressStep('sync', 'error');
                        resolve({ success: false, error: data.error });
                    } else {
                        // Ensure we show 100% at completion
                        updateSyncProgress(100, data.status || 'Sync completed');
                        updateProgressStep('sync', 'completed');
                        resolve({ success: true });
                    }
                }

                // Safety timeout after 5 minutes of polling
                if (pollCount > 150) {
                    clearInterval(pollInterval);
                    updateProgressStep('sync', 'completed');
                    updateSyncProgress(100, 'Sync timeout - may still be running in background');
                    resolve({ success: true });
                }
            } catch (e) {
                // Don't fail immediately on network errors, retry a few times
                if (pollCount > 5) {
                    clearInterval(pollInterval);
                    resolve({ success: false, error: e.message });
                }
            }
        }, 1000); // Poll every second for better UI responsiveness
    });
}

const saveStorageBtn = document.getElementById('save-storage-btn');
if (saveStorageBtn) {
    saveStorageBtn.addEventListener('click', async () => {
        const selections = [];
        document.querySelectorAll('.role-selector').forEach(sel => {
            const diskId = sel.dataset.disk;
            const activeBtn = sel.querySelector('.role-btn.active');
            const role = activeBtn ? activeBtn.dataset.role : 'none';
            if (role !== 'none') {
                selections.push({
                    id: diskId,
                    role,
                    format: true
                });
            }
        });

        const dataDisks = selections.filter(s => s.role === 'data');
        const parityDisks = selections.filter(s => s.role === 'parity');

        if (dataDisks.length === 0) {
            alert('Please assign at least one disk as "Data" to create a pool.');
            return;
        }

        // Parity is optional, but if selected, must be >= largest data disk
        if (parityDisks.length > 0) {
            // Helper function to parse disk size to bytes
            const parseSize = (sizeStr) => {
                if (!sizeStr) return 0;
                const match = sizeStr.match(/^([\d.]+)\s*(TB|GB|MB|KB|B)?$/i);
                if (!match) return 0;
                const num = parseFloat(match[1]);
                const unit = (match[2] || 'B').toUpperCase();
                const multipliers = { B: 1, KB: 1024, MB: 1024**2, GB: 1024**3, TB: 1024**4 };
                return num * (multipliers[unit] || 1);
            };

            // Get disk sizes from state
            const getDiskSize = (diskId) => {
                const disk = state.disks.find(d => d.id === diskId);
                return disk ? parseSize(disk.size) : 0;
            };

            const largestDataSize = Math.max(...dataDisks.map(d => getDiskSize(d.id)));
            const smallestParitySize = Math.min(...parityDisks.map(d => getDiskSize(d.id)));

            if (smallestParitySize < largestDataSize) {
                alert('El disco de paridad debe ser igual o mayor que el disco de datos más grande.\n\nParity disk must be equal or larger than the largest data disk.');
                return;
            }
        }

        const diskList = selections.map(s => `${s.id} (${s.role})`).join(', ');
        const confirmed = await showConfirmModal('Formatear discos', `Se formatearán: ${diskList}\n\n¡Todos los datos serán BORRADOS!`);
        if (!confirmed) return;

        saveStorageBtn.disabled = true;
        showProgressModal();

        try {
            // Step 1: Format
            updateProgressStep('format', 'active');
            await new Promise(r => setTimeout(r, 500));

            // Call configure endpoint
            const res = await authFetch(`${API_BASE}/storage/pool/configure`, {
                method: 'POST',
                body: JSON.stringify({ disks: selections })
            });

            const data = await res.json();

            if (!res.ok) {
                throw new Error(data.error || 'Configuration failed');
            }

            // Update steps based on results
            updateProgressStep('format', 'completed');
            await new Promise(r => setTimeout(r, 300));

            updateProgressStep('mount', 'active');
            await new Promise(r => setTimeout(r, 500));
            updateProgressStep('mount', 'completed');

            updateProgressStep('snapraid', 'active');
            await new Promise(r => setTimeout(r, 500));
            updateProgressStep('snapraid', 'completed');

            updateProgressStep('mergerfs', 'active');
            await new Promise(r => setTimeout(r, 500));
            updateProgressStep('mergerfs', 'completed');

            updateProgressStep('fstab', 'active');
            await new Promise(r => setTimeout(r, 500));
            updateProgressStep('fstab', 'completed');

            // Step 6: SnapRAID initial sync
            updateProgressStep('sync', 'active');
            updateSyncProgress(0, 'Starting initial sync...');

            // Start sync in background
            try {
                await authFetch(`${API_BASE}/storage/snapraid/sync`, { method: 'POST' });
                // Poll for progress
                const syncResult = await pollSyncProgress();

                if (!syncResult.success) {
                    console.warn('Sync warning:', syncResult.error);
                    // Don't fail the whole process, sync can be run later
                    updateProgressStep('sync', 'completed');
                    updateSyncProgress(100, 'Sync will complete in background');
                }
            } catch (syncError) {
                console.warn('Sync skipped:', syncError);
                updateProgressStep('sync', 'completed');
                updateSyncProgress(100, 'Sync scheduled for later');
            }

            state.storageConfig = selections;

            // Update progress message
            const progressMsg = document.getElementById('progress-message');
            if (progressMsg) {
                // SECURITY: Escape poolMount to prevent XSS
                progressMsg.innerHTML = `✅ <strong>Storage Pool Created!</strong><br>Pool mounted at: ${escapeHtml(data.poolMount)}`;
            }

            // Show continue button
            const progressFooter = document.querySelector('.progress-footer');
            if (progressFooter) {
                progressFooter.classList.add('complete');
                const continueBtn = document.createElement('button');
                continueBtn.className = 'btn-primary';
                continueBtn.textContent = 'Continue to Dashboard';
                continueBtn.onclick = () => {
                    hideProgressModal();
                    if (state.sessionId) {
                        state.isAuthenticated = true;
                        switchView('dashboard');
                    } else {
                        switchView('login');
                    }
                };
                progressFooter.appendChild(continueBtn);
            }

        } catch (e) {
            console.error('Storage config error:', e);
            const progressMsg = document.getElementById('progress-message');
            if (progressMsg) {
                progressMsg.innerHTML = `❌ <strong>Configuration Failed:</strong><br>${escapeHtml(e.message)}`;
            }

            // Add retry button
            const progressFooter = document.querySelector('.progress-footer');
            if (progressFooter) {
                progressFooter.classList.add('complete');
                const retryBtn = document.createElement('button');
                retryBtn.className = 'btn-primary';
                retryBtn.textContent = 'Close & Retry';
                retryBtn.onclick = () => {
                    hideProgressModal();
                    saveStorageBtn.disabled = false;
                };
                progressFooter.appendChild(retryBtn);
            }
        }
    });
}

// Authentication
if (loginForm) {
    // Track pending 2FA state
    let pending2FAToken = null;

    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = document.getElementById('username').value.trim();
        const password = document.getElementById('password').value;
        const totpCode = document.getElementById('login-totp-code')?.value.trim();
        const btn = e.target.querySelector('button[type="submit"]');
        const totpGroup = document.getElementById('totp-input-group');

        btn.textContent = 'Hardware Auth...';
        btn.disabled = true;

        try {
            // If we have a pending 2FA token, complete 2FA verification
            if (pending2FAToken && totpCode) {
                const res = await fetch(`${API_BASE}/login/2fa`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ pendingToken: pending2FAToken, totpCode })
                });
                const data = await res.json();

                if (!res.ok || !data.success) {
                    alert(data.message || 'Código 2FA incorrecto');
                    btn.textContent = 'Verificar 2FA';
                    btn.disabled = false;
                    return;
                }

                // 2FA verified - save session and proceed
                saveSession(data.sessionId, data.csrfToken);
                state.isAuthenticated = true;
                state.user = data.user;
                pending2FAToken = null;
                if (totpGroup) totpGroup.style.display = 'none';
                switchView('dashboard');
                return;
            }

            // Regular login
            const res = await fetch(`${API_BASE}/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });
            const data = await res.json();

            if (!res.ok || !data.success) {
                alert(data.message || 'Security Error: Credentials Rejected by Hardware.');
                btn.textContent = 'Access Gateway';
                btn.disabled = false;
                return;
            }

            // Check if 2FA is required
            if (data.requires2FA) {
                pending2FAToken = data.pendingToken;
                if (totpGroup) {
                    totpGroup.style.display = 'block';
                    document.getElementById('login-totp-code').focus();
                }
                btn.textContent = 'Verificar 2FA';
                btn.disabled = false;
                return;
            }

            // No 2FA - save session and proceed
            if (data.sessionId) {
                saveSession(data.sessionId, data.csrfToken);
            }

            state.isAuthenticated = true;
            state.user = data.user;
            switchView('dashboard');
        } catch (e) {
            console.error('Login error:', e);
            alert('Security Server Offline or Network Link Broken');
            btn.textContent = 'Access Gateway';
            btn.disabled = false;
        }
    });
}

// Navigation - supports multiple nav-links groups (Synology-style layout)
const allNavLinks = document.querySelectorAll('.nav-links li[data-view]');
allNavLinks.forEach(link => {
    link.addEventListener('click', () => {
        // Remove active from ALL nav items across all groups
        allNavLinks.forEach(l => l.classList.remove('active'));
        link.classList.add('active');
        const view = link.dataset.view;

        // Update URL
        const path = view === 'dashboard' ? '/' : '/' + view;
        navigateTo(path);

        viewTitle.textContent = viewsMap[view] || 'HomePiNAS';
        renderContent(view);
        updateHeaderIPVisibility();
    });
});

// Sidebar Toggle (Synology-style)
const sidebarToggle = document.getElementById('sidebar-toggle');
const mainSidebar = document.getElementById('main-sidebar');
const mainContent = document.getElementById('main-content');

if (sidebarToggle && mainSidebar) {
    sidebarToggle.addEventListener('click', () => {
        mainSidebar.classList.toggle('collapsed');
        if (mainContent) mainContent.classList.toggle('sidebar-collapsed');
        // Save preference
        localStorage.setItem('sidebarCollapsed', mainSidebar.classList.contains('collapsed'));
    });
    
    // Restore preference
    if (localStorage.getItem('sidebarCollapsed') === 'true') {
        mainSidebar.classList.add('collapsed');
        if (mainContent) mainContent.classList.add('sidebar-collapsed');
    }
}

// Header theme toggle
const headerThemeToggle = document.getElementById('header-theme-toggle');
if (headerThemeToggle) {
    headerThemeToggle.addEventListener('click', () => {
        const html = document.documentElement;
        const currentTheme = html.getAttribute('data-theme') || 'light';
        const newTheme = currentTheme === 'light' ? 'dark' : 'light';
        html.setAttribute('data-theme', newTheme);
        localStorage.setItem('theme', newTheme);
        headerThemeToggle.textContent = newTheme === 'dark' ? '☀️' : '🌙';
    });
    
    // Set initial icon
    const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
    headerThemeToggle.textContent = currentTheme === 'dark' ? '☀️' : '🌙';
}

// Update user avatar letter
function updateUserAvatar() {
    const avatarEl = document.getElementById('user-avatar-letter');
    const usernameEl = document.getElementById('username-display');
    if (avatarEl && state.username) {
        avatarEl.textContent = state.username.charAt(0).toUpperCase();
    }
    if (usernameEl && state.username) {
        usernameEl.textContent = state.username;
    }
}

async function renderContent(view) {
    state.currentView = view;
    dashboardContent.innerHTML = '';
    if (view === 'dashboard') await renderDashboard();
    else if (view === 'docker') await renderDockerManager();
    else if (view === 'storage') await renderStorageDashboard();
    else if (view === 'files') await renderFilesView();
    else if (view === 'terminal') await renderTerminalView();
    else if (view === 'network') {
        await renderNetworkManager();
        // Append Samba + DDNS sections after network interfaces
        await renderSambaSection(dashboardContent);
        await renderDDNSSection(dashboardContent);
    }
    else if (view === 'backup') await renderBackupView();
    else if (view === 'active-backup') await renderActiveBackupView();
    else if (view === 'cloud-sync') await renderCloudSyncView();
    else if (view === 'cloud-backup') await renderCloudBackupView();
    else if (view === 'homestore') await renderHomeStoreView();
    else if (view === 'logs') await renderLogsView();
    else if (view === 'users') await renderUsersView();
    else if (view === 'system') {
        await renderSystemView();
        // Append UPS + Notifications after system view
        setTimeout(async () => {
            await renderUPSSection(dashboardContent);
            await renderNotificationsSection(dashboardContent);
        }, 100);
    }
}

// Real-Time Dashboard
async function renderDashboard() {
    const stats = state.globalStats;
    const cpuTemp = Number(stats.cpuTemp) || 0;
    const cpuLoad = Number(stats.cpuLoad) || 0;
    const ramUsedPercent = Number(stats.ramUsedPercent) || 0;
    const publicIP = escapeHtml(state.publicIP);
    
    // Fetch real LAN IP if not already loaded
    if (!state.network.interfaces || state.network.interfaces.length === 0 || state.network.interfaces[0]?.ip === '192.168.1.100') {
        try {
            const res = await fetch(`${API_BASE}/network/interfaces`);
            if (res.ok) {
                state.network.interfaces = await res.json();
            }
        } catch (e) {
            console.warn('Could not fetch network interfaces:', e);
        }
    }
    
    const lanIP = escapeHtml(state.network.interfaces[0]?.ip || 'No disponible');
    const ddnsCount = (state.network.ddns || []).filter(d => d.enabled).length;

    // CPU Model - save once and reuse (CPU doesn't change)
    if (stats.cpuModel && stats.cpuModel !== 'Unknown CPU') {
        localStorage.setItem('cpuModel', stats.cpuModel);
    }
    const cpuModel = localStorage.getItem('cpuModel') || stats.cpuModel || 'Unknown CPU';

    // Format uptime intelligently
    const uptimeSeconds = Number(stats.uptime) || 0;
    const days = Math.floor(uptimeSeconds / 86400);
    const hours = Math.floor((uptimeSeconds % 86400) / 3600);
    const minutes = Math.floor((uptimeSeconds % 3600) / 60);
    let uptimeStr;
    if (days > 0) {
        uptimeStr = `${days} día${days > 1 ? 's' : ''} ${hours}h`;
    } else if (hours > 0) {
        uptimeStr = `${hours} hora${hours > 1 ? 's' : ''} ${minutes}m`;
    } else {
        uptimeStr = `${minutes} minuto${minutes !== 1 ? 's' : ''}`;
    }

    // Generate core loads HTML (compact version)
    let coreLoadsHtml = '';
    if (stats.coreLoads && stats.coreLoads.length > 0) {
        coreLoadsHtml = stats.coreLoads.map((core, i) => `
            <div class="core-bar-mini">
                <span>C${i}</span>
                <div class="core-progress-mini">
                    <div class="core-fill-mini" style="width: ${core.load}%; background: ${core.load > 80 ? '#ef4444' : core.load > 50 ? '#f59e0b' : '#10b981'}"></div>
                </div>
                <span>${core.load}%</span>
            </div>
        `).join('');
    }

    // Fetch fan mode
    let fanMode = 'balanced';
    try {
        const fanModeRes = await fetch(`${API_BASE}/system/fan/mode`);
        if (fanModeRes.ok) {
            const fanModeData = await fanModeRes.json();
            fanMode = fanModeData.mode || 'balanced';
        }
    } catch (e) {
        console.error('Error fetching fan mode:', e);
    }

    // Generate fan mode selector HTML (only mode buttons, no RPM display)
    const fansFullHtml = `
        <div class="fan-mode-selector">
            <button class="fan-mode-btn ${fanMode === 'silent' ? 'active' : ''}" data-mode="silent" onclick="setFanMode('silent')">
                <span class="mode-icon">🤫</span>
                <span class="mode-name">Silent</span>
            </button>
            <button class="fan-mode-btn ${fanMode === 'balanced' ? 'active' : ''}" data-mode="balanced" onclick="setFanMode('balanced')">
                <span class="mode-icon">⚖️</span>
                <span class="mode-name">Balanced</span>
            </button>
            <button class="fan-mode-btn ${fanMode === 'performance' ? 'active' : ''}" data-mode="performance" onclick="setFanMode('performance')">
                <span class="mode-icon">🚀</span>
                <span class="mode-name">Performance</span>
            </button>
        </div>
    `;

    // Fetch disks for storage section
    let disksHtml = '';
    try {
        const disksRes = await fetch(`${API_BASE}/system/disks`);
        if (disksRes.ok) {
            const disks = await disksRes.json();

            // Group disks by role
            const disksByRole = { data: [], parity: [], cache: [], none: [] };
            disks.forEach(disk => {
                const config = state.storageConfig.find(s => s.id === disk.id);
                const role = config ? config.role : 'none';
                if (disksByRole[role]) {
                    disksByRole[role].push({ ...disk, role });
                } else {
                    disksByRole.none.push({ ...disk, role: 'none' });
                }
            });

            // Generate HTML for each role section
            const roleLabels = { data: '💾 Data', parity: '🛡️ Parity', cache: '⚡ Cache', none: '📦 Unassigned' };
            const roleColors = { data: '#6366f1', parity: '#f59e0b', cache: '#10b981', none: '#64748b' };

            for (const [role, roleDisks] of Object.entries(disksByRole)) {
                if (roleDisks.length > 0) {
                    disksHtml += `
                        <div class="disk-role-section">
                            <div class="disk-role-header" style="border-left: 3px solid ${roleColors[role]}">
                                <span>${roleLabels[role]}</span>
                                <span class="disk-count">${roleDisks.length} disk(s)</span>
                            </div>
                            <div class="disk-role-items">
                                ${roleDisks.map(disk => `
                                    <div class="disk-item-compact">
                                        <div class="disk-item-info">
                                            <span class="disk-name">${escapeHtml(disk.model || 'Unknown')}</span>
                                            <span class="disk-details">${escapeHtml(disk.id)} • ${escapeHtml(disk.size)} • ${escapeHtml(disk.type)}</span>
                                        </div>
                                        <div class="disk-item-temp ${disk.temp > 45 ? 'hot' : disk.temp > 38 ? 'warm' : 'cool'}">
                                            ${disk.temp || 0}°C
                                        </div>
                                    </div>
                                `).join('')}
                            </div>
                        </div>
                    `;
                }
            }
        }
    } catch (e) {
        console.error('Error fetching disks:', e);
        disksHtml = '<div class="no-disks">Unable to load disk information</div>';
    }

    dashboardContent.innerHTML = `
        <div class="glass-card overview-card" style="grid-column: 1 / -1;">
            <div class="overview-header">
                <h3>System Overview</h3>
                <div class="system-info-badge">
                    <span>${escapeHtml(stats.hostname || 'HomePiNAS')}</span>
                    <span class="separator">|</span>
                    <span>${escapeHtml(stats.distro || 'Linux')}</span>
                    <span class="separator">|</span>
                    <span>Uptime: ${uptimeStr}</span>
                </div>
            </div>
        </div>

        <div class="dashboard-grid-4">
            <div class="glass-card card-compact">
                <h3>🖥️ CPU</h3>
                <div class="cpu-model-compact">${escapeHtml(cpuModel)}</div>
                <div class="cpu-specs-row">
                    <span>${stats.cpuPhysicalCores || 0} Cores</span>
                    <span>${stats.cpuCores || 0} Threads</span>
                    <span>${stats.cpuSpeed || 0} GHz</span>
                    <span class="temp-badge ${cpuTemp > 70 ? 'hot' : cpuTemp > 55 ? 'warm' : 'cool'}">${cpuTemp}°C</span>
                </div>
                <div class="load-section">
                    <div class="load-header">
                        <span>Load</span>
                        <span style="color: ${cpuLoad > 80 ? '#ef4444' : cpuLoad > 50 ? '#f59e0b' : '#10b981'}">${cpuLoad}%</span>
                    </div>
                    <div class="progress-bar-mini">
                        <div class="progress-fill-mini" style="width: ${Math.min(cpuLoad, 100)}%; background: ${cpuLoad > 80 ? '#ef4444' : cpuLoad > 50 ? '#f59e0b' : 'var(--primary)'}"></div>
                    </div>
                </div>
                ${coreLoadsHtml ? `<div class="core-loads-mini">${coreLoadsHtml}</div>` : ''}
            </div>

            <div class="glass-card card-compact">
                <h3>💾 Memory</h3>
                <div class="memory-compact">
                    <div class="memory-circle-small">
                        <svg viewBox="0 0 36 36">
                            <path class="circle-bg" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"/>
                            <path class="circle-fill" stroke="${ramUsedPercent > 80 ? '#ef4444' : ramUsedPercent > 60 ? '#f59e0b' : '#10b981'}"
                                  stroke-dasharray="${ramUsedPercent}, 100"
                                  d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"/>
                        </svg>
                        <span class="memory-percent-small">${ramUsedPercent}%</span>
                    </div>
                    <div class="memory-details-compact">
                        <div class="mem-row"><span>Used</span><span>${stats.ramUsed || 0} GB</span></div>
                        <div class="mem-row"><span>Free</span><span>${stats.ramFree || 0} GB</span></div>
                        <div class="mem-row"><span>Total</span><span>${stats.ramTotal || 0} GB</span></div>
                        ${stats.swapTotal && parseFloat(stats.swapTotal) > 0 ? `<div class="mem-row swap"><span>Swap</span><span>${stats.swapUsed || 0}/${stats.swapTotal || 0} GB</span></div>` : ''}
                    </div>
                </div>
            </div>

            <div class="glass-card card-compact">
                <h3>🌀 Fans</h3>
                <div class="fans-compact">
                    ${fansFullHtml}
                </div>
            </div>

            <div class="glass-card card-compact">
                <h3>🌐 Network</h3>
                <div class="network-compact">
                    <div class="net-row"><span>Public IP</span><span class="ip-value">${publicIP}</span></div>
                    <div class="net-row"><span>LAN IP</span><span>${lanIP}</span></div>
                    <div class="net-row"><span>DDNS</span><span>${ddnsCount} Service(s)</span></div>
                </div>
            </div>
        </div>

        <div class="glass-card storage-overview" style="grid-column: 1 / -1;">
            <h3>💿 Connected Disks</h3>
            <div class="disks-by-role">
                ${disksHtml || '<div class="no-disks">No disks detected</div>'}
            </div>
        </div>
    `;
}

// Fan speed control - update percentage display while dragging
function updateFanPercent(fanId, value) {
    const percentEl = document.getElementById(`fan-percent-${fanId}`);
    if (percentEl) {
        percentEl.textContent = `${value}%`;
    }
}

// Fan speed control - apply speed when released
async function setFanSpeed(fanId, speed) {
    const percentEl = document.getElementById(`fan-percent-${fanId}`);
    if (percentEl) {
        percentEl.textContent = `${speed}% ⏳`;
    }

    try {
        const res = await authFetch(`${API_BASE}/system/fan`, {
            method: 'POST',
            body: JSON.stringify({ fanId, speed: parseInt(speed) })
        });
        const data = await res.json();

        if (percentEl) {
            if (res.ok) {
                percentEl.textContent = `${speed}% ✓`;
                setTimeout(() => {
                    percentEl.textContent = `${speed}%`;
                }, 1500);
            } else {
                percentEl.textContent = `${speed}% ✗`;
                console.error('Fan control error:', data.error);
            }
        }
    } catch (e) {
        console.error('Fan control error:', e);
        if (percentEl) {
            percentEl.textContent = `${speed}% ✗`;
        }
    }
}

window.updateFanPercent = updateFanPercent;
window.setFanSpeed = setFanSpeed;

// Fan mode control
async function setFanMode(mode) {
    // Update UI immediately
    document.querySelectorAll('.fan-mode-btn').forEach(btn => {
        btn.classList.remove('active');
        if (btn.dataset.mode === mode) {
            btn.classList.add('active');
            btn.innerHTML = `<span class="mode-icon">${btn.querySelector('.mode-icon').textContent}</span><span class="mode-name">⏳</span>`;
        }
    });

    try {
        const res = await authFetch(`${API_BASE}/system/fan/mode`, {
            method: 'POST',
            body: JSON.stringify({ mode })
        });
        const data = await res.json();

        if (res.ok) {
            // Update button to show success
            document.querySelectorAll('.fan-mode-btn').forEach(btn => {
                if (btn.dataset.mode === mode) {
                    const modeNames = { silent: 'Silent', balanced: 'Balanced', performance: 'Performance' };
                    btn.innerHTML = `<span class="mode-icon">${btn.querySelector('.mode-icon').textContent}</span><span class="mode-name">${modeNames[mode]} ✓</span>`;
                    setTimeout(() => {
                        btn.innerHTML = `<span class="mode-icon">${mode === 'silent' ? '🤫' : mode === 'balanced' ? '⚖️' : '🚀'}</span><span class="mode-name">${modeNames[mode]}</span>`;
                    }, 1500);
                }
            });
        } else {
            console.error('Fan mode error:', data.error);
            // Revert UI on error
            renderDashboard();
        }
    } catch (e) {
        console.error('Fan mode error:', e);
        renderDashboard();
    }
}

window.setFanMode = setFanMode;

// Real Storage Telemetry
async function renderStorageDashboard() {
    try {
        // Fetch disks and pool status
        const [disksRes, poolRes] = await Promise.all([
            fetch(`${API_BASE}/system/disks`),
            fetch(`${API_BASE}/storage/pool/status`)
        ]);
        
        if (disksRes.ok) state.disks = await disksRes.json();
        let poolStatus = {};
        if (poolRes.ok) poolStatus = await poolRes.json();

        // Storage Array Header (Cockpit style)
        const arrayCard = document.createElement('div');
        arrayCard.className = 'glass-card storage-array-view';
        arrayCard.style.gridColumn = '1 / -1';

        const arrayHeader = document.createElement('div');
        arrayHeader.className = 'storage-array-header';
        arrayHeader.innerHTML = `
            <h3>💾 ${t('storage.storageArray', 'Array de Almacenamiento')}</h3>
            <div class="storage-total-stats">
                <div class="storage-total-stat">
                    <span class="label">${t('storage.total', 'Total')}</span>
                    <span class="value">${escapeHtml(poolStatus.poolSize || 'N/A')}</span>
                </div>
                <div class="storage-total-stat">
                    <span class="label">${t('storage.used', 'Usado')}</span>
                    <span class="value">${escapeHtml(poolStatus.poolUsed || 'N/A')}</span>
                </div>
                <div class="storage-total-stat">
                    <span class="label">${t('storage.available', 'Disponible')}</span>
                    <span class="value" style="color: #10b981;">${escapeHtml(poolStatus.poolFree || 'N/A')}</span>
                </div>
            </div>
        `;
        arrayCard.appendChild(arrayHeader);

        // Mount points grid
        const mountsGrid = document.createElement('div');
        mountsGrid.className = 'storage-array-grid';

        // Pool mount (if configured)
        if (poolStatus.configured && poolStatus.running) {
            // Use backend-calculated percentage (avoids GB/TB unit mismatch)
            const poolPercent = poolStatus.usedPercent || 0;
            const poolFillClass = poolPercent > 90 ? 'high' : poolPercent > 70 ? 'medium' : 'low';

            const poolRow = document.createElement('div');
            poolRow.className = 'storage-mount-row pool';
            poolRow.innerHTML = `
                <div class="mount-info">
                    <span class="mount-path">${escapeHtml(poolStatus.poolMount || '/mnt/storage')}</span>
                    <span class="mount-device">MergerFS Pool</span>
                </div>
                <div class="mount-bar-container">
                    <div class="mount-bar">
                        <div class="mount-bar-fill ${poolFillClass}" style="width: ${poolPercent}%"></div>
                    </div>
                    <div class="mount-bar-text">
                        <span>${poolPercent}% ${t('storage.used', 'usado')}</span>
                        <span>${escapeHtml(poolStatus.poolFree || 'N/A')} ${t('storage.available', 'disponible')}</span>
                    </div>
                </div>
                <div class="mount-size">
                    <span class="available">${escapeHtml(poolStatus.poolFree || 'N/A')}</span>
                    <span class="total">de ${escapeHtml(poolStatus.poolSize || 'N/A')}</span>
                </div>
                <div class="mount-type">
                    <span class="mount-type-badge mergerfs">MergerFS</span>
                </div>
            `;
            mountsGrid.appendChild(poolRow);
        }

        // Individual disk mounts
        state.disks.forEach((disk, index) => {
            const config = state.storageConfig.find(s => s.id === disk.id);
            const role = config ? config.role : 'none';
            if (role === 'none') return;

            const usage = Math.min(Math.max(Number(disk.usage) || 0, 0), 100);
            const fillClass = usage > 90 ? 'high' : usage > 70 ? 'medium' : 'low';
            const mountPoint = role === 'data' ? `/mnt/disks/disk${index + 1}` : 
                              role === 'parity' ? `/mnt/parity${index + 1}` :
                              `/mnt/disks/cache${index + 1}`;

            const diskRow = document.createElement('div');
            diskRow.className = `storage-mount-row ${role}`;
            diskRow.innerHTML = `
                <div class="mount-info">
                    <span class="mount-path">${escapeHtml(mountPoint)}</span>
                    <span class="mount-device">/dev/${escapeHtml(disk.id)} • ${escapeHtml(disk.model || 'Unknown')}</span>
                </div>
                <div class="mount-bar-container">
                    <div class="mount-bar">
                        <div class="mount-bar-fill ${fillClass}" style="width: ${usage}%"></div>
                    </div>
                    <div class="mount-bar-text">
                        <span>${usage}% ${t('storage.used', 'usado')}</span>
                        <span>${escapeHtml(disk.size || 'N/A')}</span>
                    </div>
                </div>
                <div class="mount-size">
                    <span class="available">${escapeHtml(disk.size || 'N/A')}</span>
                    <span class="total">${role.toUpperCase()}</span>
                </div>
                <div class="mount-type">
                    <span class="mount-type-badge ext4">ext4</span>
                </div>
            `;
            mountsGrid.appendChild(diskRow);
        });

        arrayCard.appendChild(mountsGrid);
        dashboardContent.appendChild(arrayCard);

        // Disk cards grid (detailed view)
        const grid = document.createElement('div');
        grid.className = 'telemetry-grid';
        grid.style.marginTop = '20px';

        state.disks.forEach(disk => {
            const config = state.storageConfig.find(s => s.id === disk.id);
            const role = config ? config.role : 'none';
            const temp = Number(disk.temp) || 0;
            const tempClass = temp > 45 ? 'hot' : (temp > 38 ? 'warm' : 'cool');
            const usage = Math.min(Math.max(Number(disk.usage) || 0, 0), 100);

            const card = document.createElement('div');
            card.className = 'glass-card disk-card-advanced';

            // Create header
            const header = document.createElement('div');
            header.className = 'disk-header-adv';

            const headerInfo = document.createElement('div');
            const h4 = document.createElement('h4');
            h4.textContent = disk.model || 'Unknown';
            const infoSpan = document.createElement('span');
            infoSpan.style.cssText = 'font-size: 0.8rem; color: var(--text-dim); display: block;';
            infoSpan.textContent = `${disk.id || 'N/A'} • ${disk.type || 'Unknown'} • ${disk.size || 'N/A'}`;
            const serialSpan2 = document.createElement('span');
            serialSpan2.style.cssText = 'font-size: 0.75rem; color: var(--primary); display: block; margin-top: 4px; font-family: monospace;';
            serialSpan2.textContent = `SN: ${disk.serial || 'N/A'}`;
            headerInfo.appendChild(h4);
            headerInfo.appendChild(infoSpan);
            headerInfo.appendChild(serialSpan2);

            const roleBadge = document.createElement('span');
            roleBadge.className = `role-badge ${escapeHtml(role)}`;
            roleBadge.textContent = role;

            header.appendChild(headerInfo);
            header.appendChild(roleBadge);

            // Create progress container
            const progressContainer = document.createElement('div');
            progressContainer.className = 'disk-progress-container';
            progressContainer.innerHTML = `
                <div class="telemetry-stats-row"><span>${t('storage.healthStatus', 'Estado de Salud')}</span><span style="color:#10b981">${t('storage.optimal', 'Óptimo')}</span></div>
                <div class="disk-usage-bar"><div class="disk-usage-fill" style="width: ${usage}%; background: ${getRoleColor(role)}"></div></div>
            `;

            // Create telemetry row (only temperature, SN is in header)
            const telemetryRow = document.createElement('div');
            telemetryRow.className = 'telemetry-stats-row';

            const tempIndicator = document.createElement('div');
            tempIndicator.className = `temp-indicator ${tempClass}`;
            tempIndicator.innerHTML = `<span>🌡️</span><span>${temp}°C</span>`;

            telemetryRow.appendChild(tempIndicator);

            // Add configure button for unconfigured disks
            if (role === 'none') {
                const configBtn = document.createElement('button');
                configBtn.style.cssText = `
                    margin-left: auto;
                    padding: 6px 12px;
                    background: transparent;
                    border: 1px solid var(--primary, #0078d4);
                    color: var(--primary, #0078d4);
                    border-radius: 6px;
                    font-size: 12px;
                    cursor: pointer;
                    transition: all 0.2s;
                    white-space: nowrap;
                `;
                configBtn.textContent = '⚙️ Configurar';
                configBtn.addEventListener('mouseenter', () => {
                    configBtn.style.background = 'var(--primary, #0078d4)';
                    configBtn.style.color = '#fff';
                });
                configBtn.addEventListener('mouseleave', () => {
                    configBtn.style.background = 'transparent';
                    configBtn.style.color = 'var(--primary, #0078d4)';
                });
                configBtn.addEventListener('click', () => {
                    // Normalize disk object for showDiskActionModal (same format as /disks/detect)
                    detectedNewDisks = [{
                        id: disk.id,
                        model: disk.model || 'Disco',
                        size: disk.size,
                        sizeFormatted: disk.size || 'N/A',
                        transport: disk.type || 'unknown', // SSD/HDD -> treat as transport hint
                        serial: disk.serial,
                        hasData: true, // Assume existing disk has data (safer default)
                        partitions: []
                    }];
                    showDiskActionModal();
                });
                telemetryRow.appendChild(configBtn);
            }
            
            // Add "Remove from pool" button for disks in pool
            if (role !== 'none') {
                const removeBtn = document.createElement('button');
                removeBtn.style.cssText = `
                    margin-left: auto;
                    padding: 6px 12px;
                    background: transparent;
                    border: 1px solid var(--danger, #dc3545);
                    color: var(--danger, #dc3545);
                    border-radius: 6px;
                    font-size: 12px;
                    cursor: pointer;
                    transition: all 0.2s;
                    white-space: nowrap;
                `;
                removeBtn.textContent = '🗑️ Quitar del pool';
                removeBtn.addEventListener('mouseenter', () => {
                    removeBtn.style.background = 'var(--danger, #dc3545)';
                    removeBtn.style.color = '#fff';
                });
                removeBtn.addEventListener('mouseleave', () => {
                    removeBtn.style.background = 'transparent';
                    removeBtn.style.color = 'var(--danger, #dc3545)';
                });
                removeBtn.addEventListener('click', async () => {
                    if (!confirm(`¿Seguro que quieres quitar ${disk.model || disk.id} del pool?\n\nEl disco seguirá montado pero no formará parte del almacenamiento compartido.`)) {
                        return;
                    }
                    
                    removeBtn.disabled = true;
                    removeBtn.textContent = '⏳ Quitando...';
                    
                    try {
                        const res = await authFetch(`${API_BASE}/storage/disks/remove-from-pool`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ diskId: disk.id })
                        });
                        
                        const data = await res.json();
                        
                        if (res.ok && data.success) {
                            alert(`✅ ${data.message}`);
                            renderStorageDashboard(); // Refresh view
                        } else {
                            alert(`❌ Error: ${data.error || 'Unknown error'}`);
                            removeBtn.disabled = false;
                            removeBtn.textContent = '🗑️ Quitar del pool';
                        }
                    } catch (e) {
                        alert(`❌ Error: ${e.message}`);
                        removeBtn.disabled = false;
                        removeBtn.textContent = '🗑️ Quitar del pool';
                    }
                });
                telemetryRow.appendChild(removeBtn);
            }

            card.appendChild(header);
            card.appendChild(progressContainer);
            card.appendChild(telemetryRow);
            grid.appendChild(card);
        });

        dashboardContent.appendChild(grid);
    } catch (e) {
        console.error('Storage dashboard error:', e);
        dashboardContent.innerHTML = '<div class="glass-card"><h3>Error loading storage data</h3></div>';
    }
}

// Real Docker Logic
async function renderDockerManager() {
    // Show loading immediately
    dashboardContent.innerHTML = "<div class=\"glass-card\" style=\"grid-column: 1 / -1; text-align: center; padding: 40px;\"><h3>Loading Docker Manager...</h3></div>";
    // Fetch containers and update status
    let updateStatus = { lastCheck: null, updatesAvailable: 0 };
    try {
        const [containersRes, updateRes] = await Promise.all([
            fetch(`${API_BASE}/docker/containers`),
            fetch(`${API_BASE}/docker/update-status`)
        ]);
        if (containersRes.ok) state.dockers = await containersRes.json();
        if (updateRes.ok) updateStatus = await updateRes.json();
    } catch (e) {
        console.error('Docker unreachable:', e);
        state.dockers = [];
    }

    // Fetch compose files
    let composeFiles = [];
    try {
        const composeRes = await fetch(`${API_BASE}/docker/compose/list`);
        if (composeRes.ok) composeFiles = await composeRes.json();
    } catch (e) {
        console.error('Compose list error:', e);
    }

    // Header with actions
    const headerCard = document.createElement('div');
    headerCard.className = 'glass-card';
    headerCard.style.cssText = 'grid-column: 1 / -1; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 15px;';

    const headerLeft = document.createElement('div');
    const h3 = document.createElement('h3');
    h3.style.margin = '0';
    h3.textContent = 'Containers';
    const updateInfo = document.createElement('span');
    updateInfo.style.cssText = 'font-size: 0.8rem; color: var(--text-dim); display: block; margin-top: 5px;';
    updateInfo.textContent = updateStatus.lastCheck
        ? `Last check: ${new Date(updateStatus.lastCheck).toLocaleString()}`
        : 'Updates not checked yet';
    headerLeft.appendChild(h3);
    headerLeft.appendChild(updateInfo);

    const headerRight = document.createElement('div');
    headerRight.style.cssText = 'display: flex; gap: 10px; flex-wrap: wrap;';

    const checkUpdatesBtn = document.createElement('button');
    checkUpdatesBtn.className = 'btn-primary';
    checkUpdatesBtn.style.cssText = 'background: #6366f1; padding: 8px 16px; font-size: 0.85rem;';
    checkUpdatesBtn.innerHTML = '🔄 Check Updates';
    checkUpdatesBtn.addEventListener('click', checkDockerUpdates);

    const importComposeBtn = document.createElement('button');
    importComposeBtn.className = 'btn-primary';
    importComposeBtn.style.cssText = 'background: #10b981; padding: 8px 16px; font-size: 0.85rem;';
    importComposeBtn.innerHTML = '📦 Import Compose';
    importComposeBtn.addEventListener('click', openComposeModal);

    const stacksBtn = document.createElement('button');
    stacksBtn.className = 'btn-primary';
    stacksBtn.style.cssText = 'background: #f59e0b; padding: 8px 16px; font-size: 0.85rem;';
    stacksBtn.innerHTML = '🗂️ Stacks';
    stacksBtn.addEventListener('click', openStacksManager);

    headerRight.appendChild(checkUpdatesBtn);
    headerRight.appendChild(importComposeBtn);
    headerRight.appendChild(stacksBtn);
    headerCard.appendChild(headerLeft);
    headerCard.appendChild(headerRight);
    dashboardContent.appendChild(headerCard);

    // Containers section
    if (state.dockers.length === 0) {
        const emptyCard = document.createElement('div');
        emptyCard.className = 'glass-card';
        emptyCard.style.cssText = 'grid-column: 1/-1; text-align:center; padding: 40px;';
        emptyCard.innerHTML = `
            <h4 style="color: var(--text-dim);">No Containers Detected</h4>
            <p style="color: var(--text-dim); font-size: 0.9rem;">Import a docker-compose file or run containers manually.</p>
        `;
        dashboardContent.appendChild(emptyCard);
    } else {
        const containerGrid = document.createElement('div');
        containerGrid.style.cssText = 'display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 20px; grid-column: 1 / -1;';

        state.dockers.forEach(container => {
            const card = document.createElement('div');
            card.className = 'glass-card docker-card';
            card.style.padding = '20px';

            const isRunning = container.status === 'running';
            const hasUpdate = container.hasUpdate;

            // Header row
            const header = document.createElement('div');
            header.style.cssText = 'display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 15px;';

            const info = document.createElement('div');
            const nameRow = document.createElement('div');
            nameRow.style.cssText = 'display: flex; align-items: center; gap: 8px;';
            const h4 = document.createElement('h4');
            h4.style.margin = '0';
            h4.textContent = container.name || 'Unknown';
            nameRow.appendChild(h4);

            if (hasUpdate) {
                const updateBadge = document.createElement('span');
                updateBadge.style.cssText = 'background: #10b981; color: white; font-size: 0.7rem; padding: 2px 6px; border-radius: 4px; font-weight: 600;';
                updateBadge.textContent = 'UPDATE';
                nameRow.appendChild(updateBadge);
            }

            const imageSpan = document.createElement('span');
            imageSpan.style.cssText = 'font-size: 0.8rem; color: var(--text-dim); display: block; margin-top: 4px;';
            imageSpan.textContent = container.image || 'N/A';
            info.appendChild(nameRow);
            info.appendChild(imageSpan);

            const statusSpan = document.createElement('span');
            statusSpan.style.cssText = `
                padding: 4px 10px;
                border-radius: 12px;
                font-size: 0.75rem;
                font-weight: 600;
                background: ${isRunning ? 'rgba(16, 185, 129, 0.2)' : 'rgba(239, 68, 68, 0.2)'};
                color: ${isRunning ? '#10b981' : '#ef4444'};
            `;
            statusSpan.textContent = isRunning ? 'RUNNING' : 'STOPPED';

            header.appendChild(info);
            header.appendChild(statusSpan);

            // Stats row (only if running and has real data)
            card.appendChild(header);
            if (isRunning) {
                const hasCpuData = container.cpu && container.cpu !== '---' && container.cpu !== '0.0%';
                const hasRamData = container.ram && container.ram !== '---' && container.ram !== '0MB';
                
                if (hasCpuData || hasRamData) {
                    const statsRow = document.createElement('div');
                    statsRow.style.cssText = 'display: flex; gap: 20px; margin-bottom: 15px; padding: 10px; background: rgba(255,255,255,0.03); border-radius: 8px;';
                    statsRow.innerHTML = `
                        <div style="flex: 1; text-align: center;">
                            <div style="font-size: 0.7rem; color: var(--text-dim);">CPU</div>
                            <div style="font-size: 1rem; font-weight: 600; color: ${parseFloat(container.cpu) > 50 ? '#f59e0b' : '#10b981'}">${escapeHtml(container.cpu || '---')}</div>
                        </div>
                        <div style="flex: 1; text-align: center;">
                            <div style="font-size: 0.7rem; color: var(--text-dim);">RAM</div>
                            <div style="font-size: 1rem; font-weight: 600; color: #6366f1;">${escapeHtml(container.ram || '---')}</div>
                        </div>
                    `;
                    card.appendChild(statsRow);
                }
            }

            // Ports section
            if (container.ports && container.ports.length > 0) {
                const portsDiv = document.createElement('div');
                portsDiv.className = 'docker-ports';
                portsDiv.style.marginBottom = '12px'; // Add spacing before buttons
                container.ports.forEach(port => {
                    if (port.public) {
                        const badge = document.createElement('span');
                        badge.className = 'docker-port-badge';
                        badge.innerHTML = `<span class="port-public">${port.public}</span><span class="port-arrow">→</span><span class="port-private">${port.private}</span>`;
                        portsDiv.appendChild(badge);
                    }
                });
                if (portsDiv.children.length > 0) {
                    card.appendChild(portsDiv);
                }
            }

            // Controls row
            const controls = document.createElement('div');
            controls.style.cssText = 'display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px;';

            const actionBtn = document.createElement('button');
            actionBtn.className = 'btn-sm';
            actionBtn.style.cssText = `flex: 1; padding: 8px; background: ${isRunning ? '#ef4444' : '#10b981'}; color: white; border: none; border-radius: 6px; cursor: pointer;`;
            actionBtn.textContent = isRunning ? t('docker.stop', 'Detener') : t('docker.start', 'Iniciar');
            actionBtn.addEventListener('click', () => handleDockerAction(container.id, isRunning ? 'stop' : 'start', actionBtn));

            const restartBtn = document.createElement('button');
            restartBtn.className = 'btn-sm';
            restartBtn.style.cssText = 'flex: 1; padding: 8px; background: #f59e0b; color: white; border: none; border-radius: 6px; cursor: pointer;';
            restartBtn.textContent = t('docker.restart', 'Reiniciar');
            restartBtn.addEventListener('click', () => handleDockerAction(container.id, 'restart', restartBtn));

            controls.appendChild(actionBtn);
            controls.appendChild(restartBtn);

            if (hasUpdate) {
                const updateBtn = document.createElement('button');
                updateBtn.className = 'btn-sm';
                updateBtn.style.cssText = 'width: 100%; margin-top: 8px; padding: 10px; background: linear-gradient(135deg, #10b981, #059669); color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 600;';
                updateBtn.innerHTML = '⬆️ ' + t('docker.updateContainer', 'Actualizar');
                updateBtn.addEventListener('click', () => updateContainer(container.id, container.name, updateBtn));
                controls.appendChild(updateBtn);
            }

            card.appendChild(controls);

            // Action buttons row (logs, web, edit)
            const actionsRow = document.createElement('div');
            actionsRow.className = 'docker-actions-row';

            // Logs button (always show, works for running and stopped)
            const logsBtn = document.createElement('button');
            logsBtn.className = 'docker-action-btn logs';
            logsBtn.innerHTML = '📜 ' + t('docker.viewLogs', 'Logs');
            logsBtn.addEventListener('click', () => openContainerLogs(container.id, container.name));
            actionsRow.appendChild(logsBtn);

            if (isRunning) {
                // Open Web button (if has public ports)
                const webPort = container.ports?.find(p => p.public);
                if (webPort) {
                    const webBtn = document.createElement('button');
                    webBtn.className = 'docker-action-btn web';
                    webBtn.innerHTML = '🌐 ' + t('docker.openWebUI', 'Web');
                    webBtn.addEventListener('click', () => {
                        window.open(`http://${window.location.hostname}:${webPort.public}`, '_blank');
                    });
                    actionsRow.appendChild(webBtn);
                }
            }

            // Edit compose button (always show if container has compose file)
            if (container.compose) {
                const editBtn = document.createElement('button');
                editBtn.className = 'docker-action-btn edit';
                editBtn.innerHTML = '✏️ ' + t('docker.editCompose', 'Editar');
                editBtn.addEventListener('click', () => openEditComposeModal(container.compose.name));
                actionsRow.appendChild(editBtn);
            }

            if (actionsRow.children.length > 0) {
                card.appendChild(actionsRow);
            }

            // Notes section
            const notesDiv = document.createElement('div');
            notesDiv.className = 'docker-notes';
            
            const notesHeader = document.createElement('div');
            notesHeader.className = 'docker-notes-header';
            
            const notesLabel = document.createElement('span');
            notesLabel.textContent = `📝 ${t('docker.notes', 'Notas')}`;
            
            const saveNoteBtn = document.createElement('button');
            saveNoteBtn.className = 'btn-sm';
            saveNoteBtn.style.cssText = 'padding: 4px 8px; font-size: 0.7rem;';
            saveNoteBtn.textContent = t('docker.saveNote', 'Guardar');
            
            notesHeader.appendChild(notesLabel);
            notesHeader.appendChild(saveNoteBtn);
            
            const notesTextarea = document.createElement('textarea');
            notesTextarea.className = 'docker-notes-input';
            notesTextarea.placeholder = t('docker.addNote', 'Añadir notas, contraseñas, etc...');
            notesTextarea.value = container.notes || '';
            
            // Save button click handler
            saveNoteBtn.addEventListener('click', async () => {
                const ok = await saveContainerNotes(container.id, notesTextarea.value);
                if (ok) {
                    saveNoteBtn.textContent = '✓ ' + t('common.saved', 'Guardado');
                    setTimeout(() => {
                        saveNoteBtn.textContent = t('docker.saveNote', 'Guardar');
                    }, 2000);
                } else {
                    alert(t('common.error', 'Error al guardar'));
                }
            });
            
            notesDiv.appendChild(notesHeader);
            notesDiv.appendChild(notesTextarea);
            card.appendChild(notesDiv);

            containerGrid.appendChild(card);
        });

        dashboardContent.appendChild(containerGrid);
    }

    // Compose Files Section
    if (composeFiles.length > 0) {
        const composeSectionTitle = document.createElement('h3');
        composeSectionTitle.style.cssText = 'grid-column: 1 / -1; margin-top: 30px; margin-bottom: 10px;';
        composeSectionTitle.textContent = 'Docker Compose Files';
        dashboardContent.appendChild(composeSectionTitle);

        const composeGrid = document.createElement('div');
        composeGrid.style.cssText = 'display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 15px; grid-column: 1 / -1;';

        composeFiles.forEach(compose => {
            const card = document.createElement('div');
            card.className = 'glass-card';
            card.style.padding = '15px';

            const header = document.createElement('div');
            header.style.cssText = 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;';

            const name = document.createElement('h4');
            name.style.margin = '0';
            name.textContent = compose.name;

            const modified = document.createElement('span');
            modified.style.cssText = 'font-size: 0.75rem; color: var(--text-dim);';
            modified.textContent = new Date(compose.modified).toLocaleDateString();

            header.appendChild(name);
            header.appendChild(modified);

            const controls = document.createElement('div');
            controls.style.cssText = 'display: flex; gap: 8px;';

            const runBtn = document.createElement('button');
            runBtn.style.cssText = 'flex: 1; padding: 8px; background: #10b981; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 0.85rem;';
            runBtn.textContent = 'Run';
            runBtn.addEventListener('click', () => runCompose(compose.name, runBtn));

            const stopBtn = document.createElement('button');
            stopBtn.style.cssText = 'flex: 1; padding: 8px; background: #f59e0b; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 0.85rem;';
            stopBtn.textContent = 'Stop';
            stopBtn.addEventListener('click', () => stopCompose(compose.name, stopBtn));

            const deleteBtn = document.createElement('button');
            deleteBtn.style.cssText = 'padding: 8px 12px; background: #ef4444; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 0.85rem;';
            deleteBtn.textContent = '🗑️';
            deleteBtn.addEventListener('click', () => deleteCompose(compose.name));

            controls.appendChild(runBtn);
            controls.appendChild(stopBtn);
            controls.appendChild(deleteBtn);

            card.appendChild(header);
            card.appendChild(controls);
            composeGrid.appendChild(card);
        });

        dashboardContent.appendChild(composeGrid);
    }
}

// Docker Update Functions
async function checkDockerUpdates(event) {
    const btn = event.target;
    btn.disabled = true;
    btn.innerHTML = '🔄 Checking...';

    try {
        const res = await authFetch(`${API_BASE}/docker/check-updates`, { method: 'POST' });
        const data = await res.json();

        if (!res.ok) throw new Error(data.error || 'Check failed');

        alert(`Update check complete!\n\nImages checked: ${data.totalImages}\nUpdates available: ${data.updatesAvailable}`);
        renderContent('docker');
    } catch (e) {
        console.error('Docker update check error:', e);
        alert('Error: ' + e.message);
        btn.disabled = false;
        btn.innerHTML = '🔄 Check Updates';
    }
}

async function updateContainer(containerId, containerName, btn) {
    const confirmed = await showConfirmModal(
        `¿Actualizar "${containerName}"?`,
        'Esto parará el container, descargará la última imagen y lo recreará. Los volúmenes y datos se conservan.'
    );
    if (!confirmed) return;

    btn.disabled = true;
    btn.innerHTML = '⏳ Updating...';

    try {
        const res = await authFetch(`${API_BASE}/docker/update`, {
            method: 'POST',
            body: JSON.stringify({ containerId })
        });
        const data = await res.json();

        if (!res.ok) throw new Error(data.error || 'Update failed');

        alert(`Container "${containerName}" updated successfully!`);
        renderContent('docker');
    } catch (e) {
        console.error('Container update error:', e);
        alert('Update failed: ' + e.message);
        btn.disabled = false;
        btn.innerHTML = '⬆️ Update Container';
    }
}

// Compose Functions
function openComposeModal() {
    const modal = document.createElement('div');
    modal.id = 'compose-modal';
    modal.style.cssText = `
        position: fixed; top: 0; left: 0; right: 0; bottom: 0;
        background: rgba(0,0,0,0.8); display: flex; align-items: center;
        justify-content: center; z-index: 1000;
    `;

    modal.innerHTML = `
        <div style="background: var(--card-bg); padding: 30px; border-radius: 16px; width: 90%; max-width: 600px; max-height: 80vh; overflow-y: auto;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
                <h3 style="margin: 0;">Import Docker Compose</h3>
                <button id="close-compose-modal" style="background: none; border: none; color: white; font-size: 1.5rem; cursor: pointer;">&times;</button>
            </div>
            <div class="input-group" style="margin-bottom: 15px;">
                <input type="text" id="compose-name" placeholder=" " required>
                <label>Stack Name</label>
            </div>
            <div style="margin-bottom: 15px;">
                <label style="display: block; margin-bottom: 8px; color: var(--text-dim);">docker-compose.yml content:</label>
                <div style="display: flex; gap: 10px; margin-bottom: 10px;">
                    <label style="
                        flex: 1; padding: 12px; background: rgba(99, 102, 241, 0.2);
                        border: 2px dashed rgba(99, 102, 241, 0.5); border-radius: 8px;
                        color: #6366f1; text-align: center; cursor: pointer;
                        transition: all 0.2s ease;
                    ">
                        📁 Upload .yml file
                        <input type="file" id="compose-file-input" accept=".yml,.yaml" style="display: none;">
                    </label>
                </div>
                <textarea id="compose-content" style="
                    width: 100%; height: 300px; background: rgba(0,0,0,0.3);
                    border: 1px solid rgba(255,255,255,0.1); border-radius: 8px;
                    color: white; font-family: monospace; padding: 15px; resize: vertical;
                " placeholder="version: '3'
services:
  myapp:
    image: nginx:latest
    ports:
      - '8080:80'"></textarea>
            </div>
            <div style="display: flex; gap: 10px;">
                <button id="save-compose-btn" class="btn-primary" style="flex: 1; padding: 12px;">Save Compose</button>
                <button id="save-run-compose-btn" class="btn-primary" style="flex: 1; padding: 12px; background: #10b981;">Save & Run</button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    document.getElementById('close-compose-modal').addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });

    // File upload handler
    document.getElementById("compose-file-input").addEventListener("change", (e) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (event) => {
                document.getElementById("compose-content").value = event.target.result;
                // Auto-fill stack name from filename if empty
                const nameInput = document.getElementById("compose-name");
                if (!nameInput.value.trim()) {
                    nameInput.value = file.name.replace(/.(yml|yaml)$/i, "").replace(/docker-compose[-_]?/i, "") || "stack";
                }
            };
            reader.readAsText(file);
        }
    });


    document.getElementById('save-compose-btn').addEventListener('click', () => saveCompose(false));
    document.getElementById('save-run-compose-btn').addEventListener('click', () => saveCompose(true));
}

async function saveCompose(andRun) {
    const name = document.getElementById("compose-name").value.trim();
    const content = document.getElementById("compose-content").value;

    if (!name) {
        alert("Please enter a stack name");
        return;
    }
    if (!content) {
        alert("Please enter compose content");
        return;
    }

    // Replace modal content with progress view
    const modal = document.getElementById("compose-modal");
    const modalContent = modal.querySelector("div");
    modalContent.innerHTML = `
        <h3 style="margin: 0 0 20px 0;">Deploying Stack: ${escapeHtml(name)}</h3>
        <div id="deploy-steps">
            <div class="deploy-step" id="step-save">
                <span class="step-icon">⏳</span>
                <span class="step-text">Saving compose file...</span>
            </div>
            ${andRun ? `<div class="deploy-step" id="step-pull">
                <span class="step-icon">⏳</span>
                <span class="step-text">Pulling images...</span>
            </div>
            <div class="deploy-step" id="step-start">
                <span class="step-icon">⏳</span>
                <span class="step-text">Starting containers...</span>
            </div>` : ""}
        </div>
        <div style="margin: 20px 0;">
            <div style="background: rgba(255,255,255,0.1); border-radius: 8px; height: 8px; overflow: hidden;">
                <div id="deploy-progress" style="height: 100%; background: linear-gradient(90deg, #6366f1, #10b981); width: 0%; transition: width 0.3s ease;"></div>
            </div>
            <div id="deploy-status" style="margin-top: 10px; font-size: 0.9rem; color: var(--text-dim); text-align: center;">Initializing...</div>
        </div>
        <div id="deploy-log" style="display: none; margin: 15px 0; padding: 15px; background: rgba(0,0,0,0.3); border-radius: 8px; font-family: monospace; font-size: 0.8rem; max-height: 200px; overflow-y: auto; white-space: pre-wrap;"></div>
        <div id="deploy-actions" style="display: none; text-align: center;">
            <button id="deploy-close-btn" class="btn-primary" style="padding: 12px 30px;">Accept</button>
        </div>
    `;

    const updateStep = (stepId, status) => {
        const step = document.getElementById(stepId);
        if (!step) return;
        step.className = "deploy-step";
        if (status) step.classList.add(status);
    };

    const updateProgress = (percent, text) => {
        const bar = document.getElementById("deploy-progress");
        const status = document.getElementById("deploy-status");
        if (bar) bar.style.width = percent + "%";
        if (status) status.textContent = text;
    };

    const showResult = (success, message, log = "") => {
        const actions = document.getElementById("deploy-actions");
        const logDiv = document.getElementById("deploy-log");
        const btn = document.getElementById("deploy-close-btn");
        
        if (actions) actions.style.display = "block";
        if (!success && log && logDiv) {
            logDiv.style.display = "block";
            logDiv.textContent = log;
            logDiv.style.color = "#ef4444";
        }
        if (btn) {
            btn.textContent = success ? "Accept" : "Close";
            btn.style.background = success ? "#10b981" : "#ef4444";
            btn.onclick = () => {
                modal.remove();
                if (success) renderContent("docker");
            };
        }
        updateProgress(100, message);
    };

    try {
        // Step 1: Save compose file
        updateStep("step-save", "active");
        updateProgress(10, "Saving compose file...");

        const res = await authFetch(`${API_BASE}/docker/compose/import`, {
            method: "POST",
            body: JSON.stringify({ name, content })
        });
        const data = await res.json();

        if (!res.ok) throw new Error(data.error || "Import failed");
        
        updateStep("step-save", "done");
        updateProgress(andRun ? 33 : 100, andRun ? "Compose saved, starting deployment..." : "Compose saved successfully!");

        if (andRun) {
            // Step 2: Pull & Start
            updateStep("step-pull", "active");
            updateProgress(50, "Pulling images and starting containers...");

            const runRes = await authFetch(`${API_BASE}/docker/compose/up`, {
                method: "POST",
                body: JSON.stringify({ name })
            });
            const runData = await runRes.json();

            if (!runRes.ok) {
                updateStep("step-pull", "error");
                updateStep("step-start", "error");
                throw new Error(runData.error || runData.output || "Run failed");
            }

            updateStep("step-pull", "done");
            updateStep("step-start", "done");
            showResult(true, "Stack deployed successfully! ✅");
        } else {
            showResult(true, "Compose file saved! ✅");
        }

    } catch (e) {
        console.error("Compose deploy error:", e);
        const currentStep = document.querySelector(".deploy-step.active");
        if (currentStep) currentStep.classList.replace("active", "error");
        showResult(false, "Deployment failed ❌", e.message);
    }
}

async function runCompose(name, btn) {
    btn.disabled = true;
    btn.textContent = 'Starting...';

    try {
        const res = await authFetch(`${API_BASE}/docker/compose/up`, {
            method: 'POST',
            body: JSON.stringify({ name })
        });
        const data = await res.json();

        if (!res.ok) throw new Error(data.error || 'Start failed');

        alert(`Compose "${name}" started!`);
        renderContent('docker');
    } catch (e) {
        console.error('Compose run error:', e);
        alert('Error: ' + e.message);
        btn.disabled = false;
        btn.textContent = 'Run';
    }
}

async function stopCompose(name, btn) {
    btn.disabled = true;
    btn.textContent = 'Stopping...';

    try {
        const res = await authFetch(`${API_BASE}/docker/compose/down`, {
            method: 'POST',
            body: JSON.stringify({ name })
        });
        const data = await res.json();

        if (!res.ok) throw new Error(data.error || 'Stop failed');

        alert(`Compose "${name}" stopped!`);
        renderContent('docker');
    } catch (e) {
        console.error('Compose stop error:', e);
        alert('Error: ' + e.message);
        btn.disabled = false;
        btn.textContent = 'Stop';
    }
}

async function deleteCompose(name) {
    const confirmed = await showConfirmModal(
        `¿Eliminar "${name}"?`,
        'Esto parará todos los containers y eliminará el archivo compose.'
    );
    if (!confirmed) return;

    try {
        const res = await authFetch(`${API_BASE}/docker/compose/${encodeURIComponent(name)}`, {
            method: 'DELETE'
        });
        const data = await res.json();

        if (!res.ok) throw new Error(data.error || 'Delete failed');

        alert(`Compose "${name}" deleted!`);
        renderContent('docker');
    } catch (e) {
        console.error('Compose delete error:', e);
        alert('Error: ' + e.message);
    }
}

// Edit compose modal
async function openEditComposeModal(composeName) {
    // Fetch current compose content
    let content = '';
    try {
        const res = await authFetch(`${API_BASE}/docker/compose/${encodeURIComponent(composeName)}`);
        if (res.ok) {
            const data = await res.json();
            content = data.content || '';
        }
    } catch (e) {
        console.error('Error fetching compose:', e);
    }

    const modal = document.createElement('div');
    modal.className = 'modal active';
    modal.innerHTML = `
        <div class="glass-card modal-content" style="max-width: 700px; max-height: 80vh; overflow-y: auto;">
            <header class="modal-header">
                <h3>✏️ ${t('docker.editCompose', 'Editar Compose')}: ${escapeHtml(composeName)}</h3>
                <button id="close-edit-compose" class="btn-close">&times;</button>
            </header>
            <div style="padding: 20px;">
                <textarea id="edit-compose-content" style="
                    width: 100%; height: 400px; background: rgba(0,0,0,0.3);
                    border: 1px solid rgba(255,255,255,0.1); border-radius: 8px;
                    color: white; font-family: monospace; padding: 15px; resize: vertical;
                ">${escapeHtml(content)}</textarea>
            </div>
            <div class="modal-footer" style="display: flex; gap: 10px; padding: 15px;">
                <button id="cancel-edit-compose" class="btn-primary" style="background: var(--text-dim);">
                    ${t('common.cancel', 'Cancelar')}
                </button>
                <button id="save-edit-compose" class="btn-primary">
                    ${t('common.save', 'Guardar')}
                </button>
                <button id="save-run-edit-compose" class="btn-primary" style="background: #10b981;">
                    ${t('docker.saveAndRun', 'Guardar y Ejecutar')}
                </button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    // Close handlers
    const closeModal = () => modal.remove();
    document.getElementById('close-edit-compose').addEventListener('click', closeModal);
    document.getElementById('cancel-edit-compose').addEventListener('click', closeModal);

    // Click outside to close
    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeModal();
    });

    const saveHandler = async (andRun) => {
        const newContent = document.getElementById('edit-compose-content').value;
        try {
            // Save compose
            const saveRes = await authFetch(`${API_BASE}/docker/compose/${encodeURIComponent(composeName)}`, {
                method: 'PUT',
                body: JSON.stringify({ content: newContent })
            });
            if (!saveRes.ok) {
                const data = await saveRes.json();
                throw new Error(data.error || 'Failed to save');
            }

            if (andRun) {
                // Run compose
                const runRes = await authFetch(`${API_BASE}/docker/compose/up`, {
                    method: 'POST',
                    body: JSON.stringify({ name: composeName })
                });
                if (!runRes.ok) {
                    const data = await runRes.json();
                    throw new Error(data.error || 'Failed to run');
                }
            }

            modal.remove();
            renderContent('docker');
        } catch (e) {
            alert('Error: ' + e.message);
        }
    };

    document.getElementById('save-edit-compose').addEventListener('click', () => saveHandler(false));
    document.getElementById('save-run-edit-compose').addEventListener('click', () => saveHandler(true));
}

window.checkDockerUpdates = checkDockerUpdates;
window.updateContainer = updateContainer;
window.openComposeModal = openComposeModal;
window.openEditComposeModal = openEditComposeModal;

async function handleDockerAction(id, action, btn) {
    if (!btn) return;

    btn.disabled = true;
    btn.textContent = 'Processing...';

    try {
        const res = await authFetch(`${API_BASE}/docker/action`, {
            method: 'POST',
            body: JSON.stringify({ id, action })
        });

        if (!res.ok) {
            const data = await res.json();
            throw new Error(data.error || 'Docker action failed');
        }

        renderContent('docker');
    } catch (e) {
        console.error('Docker action error:', e);
        alert(e.message || 'Docker Logic Fail');
        btn.disabled = false;
        btn.textContent = action === 'stop' ? 'Stop' : 'Start';
    }
}

// Keep window reference for backward compatibility
window.handleDockerAction = handleDockerAction;

// Network Manager (Refined)
async function renderNetworkManager() {
    try {
        const res = await fetch(`${API_BASE}/network/interfaces`);
        if (!res.ok) throw new Error('Failed to fetch interfaces');
        state.network.interfaces = await res.json();
    } catch (e) {
        console.error('Network fetch error:', e);
        dashboardContent.innerHTML = '<div class="glass-card"><h3>Error loading network data</h3></div>';
        return;
    }

    // Remove any existing network-grid to prevent duplicates
    const existingGrid = dashboardContent.querySelector('.network-grid');
    if (existingGrid) existingGrid.remove();

    const container = document.createElement('div');
    container.className = 'network-grid';

    // 1. Interfaces Section
    const ifaceSection = document.createElement('div');
    const ifaceTitle = document.createElement('h3');
    ifaceTitle.textContent = 'CM5 Network Adapters';
    ifaceTitle.style.marginBottom = '20px';
    ifaceSection.appendChild(ifaceTitle);

    // Grid container for interface cards
    const interfacesGrid = document.createElement('div');
    interfacesGrid.className = 'interfaces-grid';

    state.network.interfaces.forEach(iface => {
        const card = document.createElement('div');
        card.className = 'glass-card interface-card';
        card.dataset.interfaceId = iface.id;

        const isConnected = iface.status === 'connected';
        // Use local state if available, otherwise use server state
        const isDhcp = localDhcpState[iface.id] !== undefined ? localDhcpState[iface.id] : iface.dhcp;

        // Create header
        const header = document.createElement('div');
        header.className = 'interface-header';

        const headerInfo = document.createElement('div');
        const h4 = document.createElement('h4');
        h4.textContent = `${iface.name || 'Unknown'} (${iface.id || 'N/A'})`;
        const statusSpan = document.createElement('span');
        statusSpan.style.cssText = `font-size: 0.8rem; color: ${isConnected ? '#10b981' : '#94a3b8'}`;
        statusSpan.textContent = (iface.status || 'unknown').toUpperCase();
        headerInfo.appendChild(h4);
        headerInfo.appendChild(statusSpan);

        const checkboxItem = document.createElement('div');
        checkboxItem.className = 'checkbox-item';

        const dhcpCheckbox = document.createElement('input');
        dhcpCheckbox.type = 'checkbox';
        dhcpCheckbox.id = `dhcp-${iface.id}`;
        dhcpCheckbox.checked = isDhcp;
        dhcpCheckbox.addEventListener('change', (e) => toggleDHCP(iface.id, e.target.checked, iface));

        const dhcpLabel = document.createElement('label');
        dhcpLabel.htmlFor = `dhcp-${iface.id}`;
        dhcpLabel.textContent = 'DHCP';

        checkboxItem.appendChild(dhcpCheckbox);
        checkboxItem.appendChild(dhcpLabel);

        header.appendChild(headerInfo);
        header.appendChild(checkboxItem);

        // Create form
        const netForm = document.createElement('div');
        netForm.className = 'net-form';
        netForm.id = `netform-${iface.id}`;

        if (isDhcp) {
            const inputGroup = document.createElement('div');
            inputGroup.className = 'input-group';
            inputGroup.style.gridColumn = '1 / -1';

            const ipInput = document.createElement('input');
            ipInput.type = 'text';
            ipInput.value = iface.ip || '';
            ipInput.disabled = true;
            ipInput.placeholder = ' ';

            const label = document.createElement('label');
            label.textContent = 'Hardware Assigned IP';

            inputGroup.appendChild(ipInput);
            inputGroup.appendChild(label);
            netForm.appendChild(inputGroup);
        } else {
            // IP Input
            const ipGroup = document.createElement('div');
            ipGroup.className = 'input-group';
            const ipInput = document.createElement('input');
            ipInput.type = 'text';
            ipInput.id = `ip-${iface.id}`;
            ipInput.value = iface.ip || '';
            ipInput.placeholder = ' ';
            const ipLabel = document.createElement('label');
            ipLabel.textContent = 'IP Address';
            ipGroup.appendChild(ipInput);
            ipGroup.appendChild(ipLabel);

            // Subnet Input
            const subnetGroup = document.createElement('div');
            subnetGroup.className = 'input-group';
            const subnetInput = document.createElement('input');
            subnetInput.type = 'text';
            subnetInput.id = `subnet-${iface.id}`;
            subnetInput.value = iface.subnet || '';
            subnetInput.placeholder = ' ';
            const subnetLabel = document.createElement('label');
            subnetLabel.textContent = 'Subnet Mask';
            subnetGroup.appendChild(subnetInput);
            subnetGroup.appendChild(subnetLabel);

            netForm.appendChild(ipGroup);
            netForm.appendChild(subnetGroup);
        }

        // Save button
        const btnContainer = document.createElement('div');
        btnContainer.style.cssText = 'display: flex; align-items: flex-end; padding-bottom: 25px; grid-column: 1 / -1;';

        const saveBtn = document.createElement('button');
        saveBtn.className = 'btn-primary';
        saveBtn.style.cssText = 'padding: 10px; max-width: 200px;';
        saveBtn.textContent = 'Save to Node';
        saveBtn.addEventListener('click', () => applyNetwork(iface.id));

        btnContainer.appendChild(saveBtn);
        netForm.appendChild(btnContainer);

        card.appendChild(header);
        card.appendChild(netForm);
        interfacesGrid.appendChild(card);
    });

    ifaceSection.appendChild(interfacesGrid);

    // DDNS section is now rendered by renderDDNSSection() after this function
    container.appendChild(ifaceSection);
    dashboardContent.appendChild(container);
}

// Network functions
function toggleDHCP(interfaceId, isChecked, iface) {
    // Update local state
    localDhcpState[interfaceId] = isChecked;

    // Re-render only the form for this interface
    const netForm = document.getElementById(`netform-${interfaceId}`);
    if (netForm) {
        renderNetForm(netForm, iface, isChecked);
    }
}

// Helper function to render the network form
function renderNetForm(netForm, iface, isDhcp) {
    netForm.innerHTML = '';

    if (isDhcp) {
        const inputGroup = document.createElement('div');
        inputGroup.className = 'input-group';
        inputGroup.style.gridColumn = '1 / -1';

        const ipInput = document.createElement('input');
        ipInput.type = 'text';
        ipInput.value = iface.ip || '';
        ipInput.disabled = true;
        ipInput.placeholder = ' ';

        const label = document.createElement('label');
        label.textContent = 'Hardware Assigned IP';

        inputGroup.appendChild(ipInput);
        inputGroup.appendChild(label);
        netForm.appendChild(inputGroup);
    } else {
        // IP Input
        const ipGroup = document.createElement('div');
        ipGroup.className = 'input-group';
        const ipInput = document.createElement('input');
        ipInput.type = 'text';
        ipInput.id = `ip-${iface.id}`;
        ipInput.value = iface.ip || '';
        ipInput.placeholder = ' ';
        const ipLabel = document.createElement('label');
        ipLabel.textContent = 'IP Address';
        ipGroup.appendChild(ipInput);
        ipGroup.appendChild(ipLabel);

        // Subnet Input
        const subnetGroup = document.createElement('div');
        subnetGroup.className = 'input-group';
        const subnetInput = document.createElement('input');
        subnetInput.type = 'text';
        subnetInput.id = `subnet-${iface.id}`;
        subnetInput.value = iface.subnet || '';
        subnetInput.placeholder = ' ';
        const subnetLabel = document.createElement('label');
        subnetLabel.textContent = 'Subnet Mask';
        subnetGroup.appendChild(subnetInput);
        subnetGroup.appendChild(subnetLabel);

        // Gateway Input
        const gatewayGroup = document.createElement('div');
        gatewayGroup.className = 'input-group';
        const gatewayInput = document.createElement('input');
        gatewayInput.type = 'text';
        gatewayInput.id = `gateway-${iface.id}`;
        gatewayInput.value = iface.gateway || '';
        gatewayInput.placeholder = ' ';
        const gatewayLabel = document.createElement('label');
        gatewayLabel.textContent = 'Gateway';
        gatewayGroup.appendChild(gatewayInput);
        gatewayGroup.appendChild(gatewayLabel);

        // DNS Input
        const dnsGroup = document.createElement('div');
        dnsGroup.className = 'input-group';
        const dnsInput = document.createElement('input');
        dnsInput.type = 'text';
        dnsInput.id = `dns-${iface.id}`;
        dnsInput.value = '';
        dnsInput.placeholder = ' ';
        const dnsLabel = document.createElement('label');
        dnsLabel.textContent = 'DNS (ej: 8.8.8.8)';
        dnsGroup.appendChild(dnsInput);
        dnsGroup.appendChild(dnsLabel);

        netForm.appendChild(ipGroup);
        netForm.appendChild(subnetGroup);
        netForm.appendChild(gatewayGroup);
        netForm.appendChild(dnsGroup);
    }

    // Save button
    const btnContainer = document.createElement('div');
    btnContainer.style.cssText = 'display: flex; align-items: flex-end; padding-top: 10px; grid-column: 1 / -1;';

    const saveBtn = document.createElement('button');
    saveBtn.className = 'btn-primary';
    saveBtn.style.cssText = 'padding: 10px; width: 100%;';
    saveBtn.textContent = 'Save to Node';
    saveBtn.addEventListener('click', () => applyNetwork(iface.id));

    btnContainer.appendChild(saveBtn);
    netForm.appendChild(btnContainer);
}

async function applyNetwork(interfaceId) {
    const dhcpCheckbox = document.getElementById(`dhcp-${interfaceId}`);
    const isDhcp = dhcpCheckbox ? dhcpCheckbox.checked : false;

    let config = { dhcp: isDhcp };

    if (!isDhcp) {
        const ipInput = document.getElementById(`ip-${interfaceId}`);
        const subnetInput = document.getElementById(`subnet-${interfaceId}`);
        const gatewayInput = document.getElementById(`gateway-${interfaceId}`);
        const dnsInput = document.getElementById(`dns-${interfaceId}`);

        if (ipInput) config.ip = ipInput.value.trim();
        if (subnetInput) config.subnet = subnetInput.value.trim();
        if (gatewayInput) config.gateway = gatewayInput.value.trim();
        if (dnsInput) config.dns = dnsInput.value.trim();

        // Basic validation
        const ipRegex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;

        if (config.ip && !ipRegex.test(config.ip)) {
            alert('Formato de IP inválido');
            return;
        }

        if (config.subnet && !ipRegex.test(config.subnet)) {
            alert('Formato de máscara de subred inválido');
            return;
        }

        if (config.gateway && !ipRegex.test(config.gateway)) {
            alert('Formato de puerta de enlace inválido');
            return;
        }

        if (config.dns && !ipRegex.test(config.dns)) {
            alert('Formato de DNS inválido');
            return;
        }
    }

    try {
        const res = await authFetch(`${API_BASE}/network/configure`, {
            method: 'POST',
            body: JSON.stringify({ id: interfaceId, config })
        });

        const data = await res.json();

        if (!res.ok) {
            throw new Error(data.error || 'Network configuration failed');
        }

        alert(data.message || 'Configuration saved');
    } catch (e) {
        console.error('Network config error:', e);
        alert(e.message || 'Failed to apply network configuration');
    }
}

// DDNS modal is now handled by showDDNSForm() in renderDDNSSection

// Terms and Conditions Modal
const termsModal = document.getElementById('terms-modal');
const termsLink = document.getElementById('terms-link');
const closeTermsBtn = document.getElementById('close-terms-modal');
const acceptTermsBtn = document.getElementById('accept-terms-btn');

if (termsLink) {
    termsLink.addEventListener('click', (e) => {
        e.preventDefault();
        if (termsModal) termsModal.style.display = 'flex';
    });
}

if (closeTermsBtn) {
    closeTermsBtn.addEventListener('click', () => {
        if (termsModal) termsModal.style.display = 'none';
    });
}

if (acceptTermsBtn) {
    acceptTermsBtn.addEventListener('click', () => {
        if (termsModal) termsModal.style.display = 'none';
    });
}

if (termsModal) {
    termsModal.addEventListener('click', (e) => {
        if (e.target === termsModal) {
            termsModal.style.display = 'none';
        }
    });
}

// System View (Real Actions)
function renderSystemView() {
    // Format uptime intelligently
    const uptimeSeconds = Number(state.globalStats.uptime) || 0;
    const days = Math.floor(uptimeSeconds / 86400);
    const hours = Math.floor((uptimeSeconds % 86400) / 3600);
    const minutes = Math.floor((uptimeSeconds % 3600) / 60);
    let uptimeStr;
    if (days > 0) {
        uptimeStr = `${days} día${days > 1 ? 's' : ''} ${hours}h`;
    } else if (hours > 0) {
        uptimeStr = `${hours} hora${hours > 1 ? 's' : ''} ${minutes}m`;
    } else {
        uptimeStr = `${minutes} minuto${minutes !== 1 ? 's' : ''}`;
    }
    const hostname = escapeHtml(state.globalStats.hostname || 'raspberrypi');

    const container = document.createElement('div');
    container.style.cssText = 'display: contents;';

    // Management card
    const mgmtCard = document.createElement('div');
    mgmtCard.className = 'glass-card';
    mgmtCard.style.gridColumn = '1 / -1';

    const mgmtTitle = document.createElement('h3');
    mgmtTitle.textContent = 'CM5 Node Management';

    const mgmtDesc = document.createElement('p');
    mgmtDesc.style.cssText = 'color: var(--text-dim); margin-top: 10px;';
    mgmtDesc.textContent = 'Execute physical actions on the NAS hardware.';

    const btnContainer = document.createElement('div');
    btnContainer.style.cssText = 'display: flex; gap: 20px; margin-top: 30px;';

    const rebootBtn = document.createElement('button');
    rebootBtn.className = 'btn-primary';
    rebootBtn.style.cssText = 'background: #f59e0b; box-shadow: 0 4px 15px rgba(245, 158, 11, 0.4);';
    rebootBtn.textContent = 'Restart Node';
    rebootBtn.addEventListener('click', () => systemAction('reboot'));

    const shutdownBtn = document.createElement('button');
    shutdownBtn.className = 'btn-primary';
    shutdownBtn.style.cssText = 'background: #ef4444; box-shadow: 0 4px 15px rgba(239, 68, 68, 0.4);';
    shutdownBtn.textContent = 'Power Off';
    shutdownBtn.addEventListener('click', () => systemAction('shutdown'));

    btnContainer.appendChild(rebootBtn);
    btnContainer.appendChild(shutdownBtn);

    mgmtCard.appendChild(mgmtTitle);
    mgmtCard.appendChild(mgmtDesc);
    mgmtCard.appendChild(btnContainer);

    // Info card
    const infoCard = document.createElement('div');
    infoCard.className = 'glass-card';

    const infoTitle = document.createElement('h3');
    infoTitle.textContent = 'System Info';

    const uptimeRow = document.createElement('div');
    uptimeRow.className = 'stat-row';
    uptimeRow.innerHTML = `<span>Logic Uptime</span> <span>${uptimeStr}</span>`;

    const hostnameRow = document.createElement('div');
    hostnameRow.className = 'stat-row';
    hostnameRow.innerHTML = `<span>Node Name</span> <span>${hostname}</span>`;

    infoCard.appendChild(infoTitle);
    infoCard.appendChild(uptimeRow);
    infoCard.appendChild(hostnameRow);

    // Update card
    const updateCard = document.createElement('div');
    updateCard.className = 'glass-card';

    const updateTitle = document.createElement('h3');
    updateTitle.textContent = 'Software Updates';

    const updateDesc = document.createElement('p');
    updateDesc.style.cssText = 'color: var(--text-dim); margin-top: 10px;';
    updateDesc.textContent = 'Check for and install HomePiNAS updates from GitHub.';

    const updateStatus = document.createElement('div');
    updateStatus.id = 'update-status';
    updateStatus.style.cssText = 'margin-top: 15px; padding: 10px; background: rgba(255,255,255,0.05); border-radius: 8px;';
    updateStatus.innerHTML = '<span style="color: var(--text-dim);">Click "Check Updates" to verify...</span>';

    const updateBtnContainer = document.createElement('div');
    updateBtnContainer.style.cssText = 'display: flex; gap: 15px; margin-top: 20px;';

    const checkUpdateBtn = document.createElement('button');
    checkUpdateBtn.className = 'btn-primary';
    checkUpdateBtn.style.cssText = 'background: #6366f1; box-shadow: 0 4px 15px rgba(99, 102, 241, 0.4);';
    checkUpdateBtn.textContent = 'Check Updates';
    checkUpdateBtn.addEventListener('click', checkForUpdates);

    const applyUpdateBtn = document.createElement('button');
    applyUpdateBtn.className = 'btn-primary';
    applyUpdateBtn.id = 'apply-update-btn';
    applyUpdateBtn.style.cssText = 'background: #10b981; box-shadow: 0 4px 15px rgba(16, 185, 129, 0.4); display: none;';
    applyUpdateBtn.textContent = 'Install Update';
    applyUpdateBtn.addEventListener('click', applyUpdate);

    updateBtnContainer.appendChild(checkUpdateBtn);
    updateBtnContainer.appendChild(applyUpdateBtn);

    updateCard.appendChild(updateTitle);
    updateCard.appendChild(updateDesc);
    updateCard.appendChild(updateStatus);
    updateCard.appendChild(updateBtnContainer);

    dashboardContent.appendChild(mgmtCard);
    dashboardContent.appendChild(infoCard);
    dashboardContent.appendChild(updateCard);
}

async function systemAction(action) {
    const actionLabel = action === 'reboot' ? 'reiniciar' : 'apagar';
    const confirmed = await showConfirmModal('Acción del sistema', `¿Seguro que quieres ${actionLabel} el NAS?`);
    if (!confirmed) return;

    try {
        const res = await authFetch(`${API_BASE}/system/${action}`, { method: 'POST' });

        if (!res.ok) {
            const data = await res.json();
            throw new Error(data.error || 'System action failed');
        }

        alert(`${action.toUpperCase()} command sent to Hardware.`);
    } catch (e) {
        console.error('System action error:', e);
        alert(e.message || 'System Logic Fail');
    }
}

window.systemAction = systemAction;

// Update Functions
async function checkForUpdates() {
    const statusEl = document.getElementById('update-status');
    const applyBtn = document.getElementById('apply-update-btn');

    if (!statusEl) return;

    statusEl.innerHTML = '<span style="color: #f59e0b;">Checking for updates...</span>';
    if (applyBtn) applyBtn.style.display = 'none';

    try {
        const res = await authFetch(`${API_BASE}/update/check`);
        const data = await res.json();

        if (!res.ok) {
            throw new Error(data.error || 'Failed to check updates');
        }

        if (data.updateAvailable) {
            statusEl.innerHTML = `
                <div style="color: #10b981; font-weight: 600;">Update Available!</div>
                <div style="margin-top: 8px; color: var(--text-dim);">
                    Current: <strong>v${escapeHtml(data.currentVersion)}</strong> →
                    Latest: <strong style="color: #10b981;">v${escapeHtml(data.latestVersion)}</strong>
                </div>
                <div style="margin-top: 10px; font-size: 0.85rem; color: var(--text-dim);">
                    <strong>Changes:</strong><br>
                    <code style="display: block; margin-top: 5px; padding: 8px; background: rgba(0,0,0,0.2); border-radius: 4px; white-space: pre-wrap;">${escapeHtml(data.changelog || 'See GitHub for details')}</code>
                </div>
            `;
            if (applyBtn) applyBtn.style.display = 'inline-block';
        } else {
            statusEl.innerHTML = `
                <div style="color: #6366f1;">You're up to date!</div>
                <div style="margin-top: 8px; color: var(--text-dim);">
                    Version: <strong>v${escapeHtml(data.currentVersion)}</strong>
                </div>
            `;
        }
    } catch (e) {
        console.error('Update check error:', e);
        statusEl.innerHTML = `<span style="color: #ef4444;">Error: ${escapeHtml(e.message)}</span>`;
    }
}

async function applyUpdate() {
    const confirmed = await showConfirmModal('Instalar actualización', '¿Instalar la actualización ahora? El servicio se reiniciará y puede perder conexión ~30 segundos.');
    if (!confirmed) return;

    const statusEl = document.getElementById('update-status');
    const applyBtn = document.getElementById('apply-update-btn');

    if (statusEl) {
        statusEl.innerHTML = '<span style="color: #f59e0b;">Installing update... Please wait.</span>';
    }
    if (applyBtn) {
        applyBtn.disabled = true;
        applyBtn.textContent = 'Installing...';
    }

    try {
        const res = await authFetch(`${API_BASE}/update/apply`, { method: 'POST' });
        const data = await res.json();

        if (!res.ok) {
            throw new Error(data.error || 'Update failed');
        }

        if (statusEl) {
            statusEl.innerHTML = `
                <div style="color: #10b981; font-weight: 600;">Update started!</div>
                <div style="margin-top: 8px; color: var(--text-dim);">
                    The service is restarting. This page will refresh automatically in 30 seconds...
                </div>
                <div style="margin-top: 10px;">
                    <div class="progress-bar" style="height: 4px; background: rgba(255,255,255,0.1); border-radius: 2px; overflow: hidden;">
                        <div id="update-progress" style="height: 100%; background: #10b981; width: 0%; transition: width 0.5s;"></div>
                    </div>
                </div>
            `;
        }

        // Progress animation and auto-refresh
        let progress = 0;
        const progressEl = document.getElementById('update-progress');
        const interval = setInterval(() => {
            progress += 3.33;
            if (progressEl) progressEl.style.width = `${Math.min(progress, 100)}%`;
            if (progress >= 100) {
                clearInterval(interval);
                window.location.reload();
            }
        }, 1000);

    } catch (e) {
        console.error('Update apply error:', e);
        if (statusEl) {
            statusEl.innerHTML = `<span style="color: #ef4444;">Update failed: ${escapeHtml(e.message)}</span>`;
        }
        if (applyBtn) {
            applyBtn.disabled = false;
            applyBtn.textContent = 'Retry Update';
            applyBtn.style.display = 'inline-block';
        }
    }
}

window.checkForUpdates = checkForUpdates;
window.applyUpdate = applyUpdate;

// Helper Colors
function getRoleColor(role) {
    switch (role) {
        case 'data': return '#6366f1';
        case 'parity': return '#f59e0b';
        case 'cache': return '#10b981';
        case 'independent': return '#14b8a6';
        default: return '#475569';
    }
}

if (resetBtn) {
    resetBtn.addEventListener('click', async () => {
        const confirmed = await showConfirmModal('RESETEAR NAS', '¿Seguro que quieres RESETEAR todo el NAS? Se borrará toda la configuración y será necesario configurarlo de nuevo.');
        if (!confirmed) return;

        resetBtn.textContent = 'Resetting Node...';
        resetBtn.disabled = true;

        try {
            const res = await authFetch(`${API_BASE}/system/reset`, { method: 'POST' });
            const data = await res.json();

            if (res.ok && data.success) {
                // Clear local session
                clearSession();
                window.location.reload();
            } else {
                alert('Reset Failed: ' + (data.error || 'Unknown error'));
                resetBtn.textContent = 'Reset Setup & Data';
                resetBtn.disabled = false;
            }
        } catch (e) {
            console.error('Reset error:', e);
            alert(e.message || 'Reset Error: Communications Broken');
            resetBtn.textContent = 'Reset Setup & Data';
            resetBtn.disabled = false;
        }
    });
}


// Logout handler
const logoutBtn = document.getElementById("logout-btn");
if (logoutBtn) {
    logoutBtn.addEventListener("click", async () => {
        const confirmed = await showConfirmModal('Cerrar sesión', '¿Seguro que quieres cerrar sesión?');
        if (confirmed) {
            clearSession();
            state.isAuthenticated = false;
            state.user = null;
            window.location.reload();
        }
    });
}

// =============================================================================
// TERMINAL VIEW
// =============================================================================

async function renderTerminalView() {
    // Fetch shortcuts
    try {
        const res = await authFetch(`${API_BASE}/shortcuts`);
        if (res.ok) {
            const data = await res.json();
            state.shortcuts = { defaults: data.defaults || [], custom: data.custom || [] };
        }
    } catch (e) {
        console.error('Shortcuts fetch error:', e);
    }

    const container = document.createElement('div');
    container.className = 'terminal-view-container';
    container.style.width = '100%';

    // Header
    const header = document.createElement('div');
    header.className = 'glass-card';
    header.style.cssText = 'grid-column: 1 / -1; margin-bottom: 20px;';
    header.innerHTML = `
        <h3>${t('terminal.title', 'Terminal y Herramientas')}</h3>
        <p style="color: var(--text-dim); margin-top: 10px;">
            ${t('shortcuts.defaultShortcuts', 'Accesos rápidos a herramientas del sistema')}
        </p>
    `;
    container.appendChild(header);

    // Shortcuts grid
    const grid = document.createElement('div');
    grid.className = 'terminal-grid';

    // Default shortcuts
    const allShortcuts = [...state.shortcuts.defaults, ...state.shortcuts.custom];
    
    allShortcuts.forEach(shortcut => {
        const card = document.createElement('div');
        card.className = 'glass-card shortcut-card';
        
        const iconDiv = document.createElement('div');
        iconDiv.className = 'icon';
        iconDiv.textContent = shortcut.icon || '💻';
        
        const nameDiv = document.createElement('div');
        nameDiv.className = 'name';
        nameDiv.textContent = shortcut.name;
        
        const descDiv = document.createElement('div');
        descDiv.className = 'description';
        descDiv.textContent = shortcut.description || shortcut.command;
        
        card.appendChild(iconDiv);
        card.appendChild(nameDiv);
        card.appendChild(descDiv);
        
        // Add delete button for custom shortcuts
        if (!shortcut.isDefault && shortcut.id) {
            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'shortcut-delete-btn';
            deleteBtn.innerHTML = '🗑️';
            deleteBtn.title = t('common.delete', 'Eliminar');
            deleteBtn.addEventListener('click', async (e) => {
                e.stopPropagation(); // Prevent opening terminal
                const confirmed = await showConfirmModal('Eliminar acceso directo', '¿Eliminar este acceso directo?');
                if (confirmed) {
                    try {
                        const res = await authFetch(`${API_BASE}/shortcuts/${shortcut.id}`, {
                            method: 'DELETE'
                        });
                        if (res.ok) {
                            renderContent('terminal');
                        } else {
                            const data = await res.json();
                            alert(data.error || 'Error');
                        }
                    } catch (err) {
                        console.error('Delete shortcut error:', err);
                        alert(t('common.error', 'Error'));
                    }
                }
            });
            card.appendChild(deleteBtn);
        }
        
        card.addEventListener('click', () => openTerminal(shortcut.command, shortcut.name));
        grid.appendChild(card);
    });

    // Add new shortcut button
    const addCard = document.createElement('div');
    addCard.className = 'glass-card shortcut-card add-new';
    addCard.innerHTML = `
        <div class="icon">➕</div>
        <div class="name">${t('shortcuts.addShortcut', 'Añadir Acceso Directo')}</div>
    `;
    addCard.addEventListener('click', openAddShortcutModal);
    grid.appendChild(addCard);

    container.appendChild(grid);
    dashboardContent.appendChild(container);
}

// Terminal WebSocket connection
let terminalWs = null;
let terminal = null;
let fitAddon = null;

function openTerminal(command = 'bash', title = 'Terminal') {
    const modal = document.getElementById('terminal-modal');
    const containerEl = document.getElementById('terminal-container');
    const statusEl = document.getElementById('terminal-status-text');

    if (!modal || !containerEl) {
        console.error('Terminal modal not found');
        return;
    }

    // Show modal
    modal.classList.add('active');
    containerEl.innerHTML = '';

    // Initialize xterm.js
    if (typeof Terminal !== 'undefined') {
        terminal = new Terminal({
            cursorBlink: true,
            fontSize: 14,
            fontFamily: '"Fira Code", "Monaco", "Consolas", monospace',
            theme: {
                background: '#1a1a2e',
                foreground: '#ffffff',
                cursor: '#84cc16',
                cursorAccent: '#1a1a2e',
                selection: 'rgba(132, 204, 22, 0.3)',
                // ANSI colors - brighter versions for dark background
                black: '#3a3a4a',
                red: '#ff6b6b',
                green: '#69ff94',
                yellow: '#fff56d',
                blue: '#6eb5ff',
                magenta: '#ff77ff',
                cyan: '#6ef5ff',
                white: '#ffffff',
                brightBlack: '#666677',
                brightRed: '#ff8080',
                brightGreen: '#8affaa',
                brightYellow: '#ffff88',
                brightBlue: '#88ccff',
                brightMagenta: '#ff99ff',
                brightCyan: '#88ffff',
                brightWhite: '#ffffff'
            },
            scrollback: 5000
        });

        // Load addons
        if (typeof FitAddon !== 'undefined') {
            fitAddon = new FitAddon.FitAddon();
            terminal.loadAddon(fitAddon);
        }

        if (typeof WebLinksAddon !== 'undefined') {
            terminal.loadAddon(new WebLinksAddon.WebLinksAddon());
        }

        terminal.open(containerEl);
        
        if (fitAddon) {
            setTimeout(() => fitAddon.fit(), 100);
        }

        // Connect WebSocket
        const sessionId = `term-${Date.now()}`;
        const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${wsProtocol}//${window.location.host}/api/terminal/ws?sessionId=${sessionId}&command=${encodeURIComponent(command)}&token=${state.sessionId}`;

        statusEl.textContent = t('terminal.connecting', 'Conectando...');

        terminalWs = new WebSocket(wsUrl);

        terminalWs.onopen = () => {
            statusEl.textContent = t('terminal.connected', 'Conectado');
            document.querySelector('.terminal-status').classList.remove('disconnected');
        };

        terminalWs.onmessage = (event) => {
            try {
                const msg = JSON.parse(event.data);
                if (msg.type === 'output') {
                    terminal.write(msg.data);
                } else if (msg.type === 'exit') {
                    terminal.write(`\\r\\n\\x1b[33m[Proceso terminado con código ${msg.exitCode}]\\x1b[0m\\r\\n`);
                    statusEl.textContent = t('terminal.disconnected', 'Desconectado');
                    document.querySelector('.terminal-status').classList.add('disconnected');
                }
            } catch (e) {
                console.error('Terminal message error:', e);
            }
        };

        terminalWs.onclose = (event) => {
            statusEl.textContent = t('terminal.disconnected', 'Desconectado');
            document.querySelector('.terminal-status').classList.add('disconnected');
            
            // Show helpful message if connection failed immediately
            if (event.code === 1006) {
                terminal.write('\r\n\x1b[31m[Error: No se pudo conectar al servidor de terminal]\x1b[0m\r\n');
                terminal.write('\x1b[33mPosibles causas:\x1b[0m\r\n');
                terminal.write('  - El módulo node-pty no está instalado correctamente\r\n');
                terminal.write('  - El servidor necesita reiniciarse después de la instalación\r\n');
                terminal.write('\x1b[33mSolución: sudo systemctl restart homepinas\x1b[0m\r\n');
            }
        };

        terminalWs.onerror = (err) => {
            console.error('Terminal WebSocket error:', err);
            statusEl.textContent = t('terminal.error', 'Error de conexión');
        };

        // Send input to WebSocket
        terminal.onData((data) => {
            if (terminalWs && terminalWs.readyState === WebSocket.OPEN) {
                terminalWs.send(JSON.stringify({ type: 'input', data }));
            }
        });

        // Handle resize
        terminal.onResize(({ cols, rows }) => {
            if (terminalWs && terminalWs.readyState === WebSocket.OPEN) {
                terminalWs.send(JSON.stringify({ type: 'resize', cols, rows }));
            }
        });

    } else {
        containerEl.innerHTML = '<p style="color: #ef4444; padding: 20px;">Error: xterm.js no disponible</p>';
    }
}

function closeTerminal() {
    const modal = document.getElementById('terminal-modal');
    if (modal) modal.classList.remove('active');

    if (terminalWs) {
        terminalWs.close();
        terminalWs = null;
    }

    if (terminal) {
        terminal.dispose();
        terminal = null;
    }
}

// Terminal modal controls
const closeTerminalBtn = document.getElementById('close-terminal-modal');
if (closeTerminalBtn) {
    closeTerminalBtn.addEventListener('click', closeTerminal);
}

const terminalFullscreenBtn = document.getElementById('terminal-fullscreen');
if (terminalFullscreenBtn) {
    terminalFullscreenBtn.addEventListener('click', () => {
        const modalContent = document.querySelector('.terminal-modal-content');
        if (modalContent) {
            modalContent.classList.toggle('fullscreen');
            if (fitAddon) fitAddon.fit();
        }
    });
}

// Close terminal on escape
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        const terminalModal = document.getElementById('terminal-modal');
        if (terminalModal && terminalModal.classList.contains('active')) {
            closeTerminal();
        }
    }
});

// Resize terminal on window resize
window.addEventListener('resize', () => {
    if (fitAddon && terminal) {
        fitAddon.fit();
    }
});

// =============================================================================
// SHORTCUTS MODAL
// =============================================================================

function openAddShortcutModal() {
    const modal = document.createElement('div');
    modal.id = 'shortcut-modal';
    modal.className = 'modal active';
    modal.innerHTML = `
        <div class="glass-card modal-content" style="max-width: 500px;">
            <header class="modal-header">
                <h3>${t('shortcuts.addShortcut', 'Añadir Acceso Directo')}</h3>
                <button id="close-shortcut-modal" class="btn-close">&times;</button>
            </header>
            <form id="shortcut-form">
                <div class="input-group">
                    <input type="text" id="shortcut-name" required placeholder=" ">
                    <label>${t('shortcuts.name', 'Nombre')}</label>
                </div>
                <div class="input-group">
                    <input type="text" id="shortcut-command" required placeholder=" ">
                    <label>${t('shortcuts.command', 'Comando')}</label>
                </div>
                <div class="input-group">
                    <input type="text" id="shortcut-description" placeholder=" ">
                    <label>${t('shortcuts.description', 'Descripción')}</label>
                </div>
                <div style="margin-bottom: 20px;">
                    <label style="display: block; margin-bottom: 10px; color: var(--text-dim);">${t('shortcuts.icon', 'Icono')}</label>
                    <div id="icon-picker" style="display: flex; flex-wrap: wrap; gap: 8px;"></div>
                </div>
                <input type="hidden" id="shortcut-icon" value="💻">
                <div class="modal-footer" style="display: flex; gap: 10px;">
                    <button type="button" id="cancel-shortcut-modal" class="btn-primary" style="background: var(--text-dim);">
                        ${t('common.cancel', 'Cancelar')}
                    </button>
                    <button type="submit" class="btn-primary">${t('common.save', 'Guardar')}</button>
                </div>
            </form>
        </div>
    `;

    document.body.appendChild(modal);
    
    // Close handlers
    const closeModal = () => modal.remove();
    document.getElementById('close-shortcut-modal').addEventListener('click', closeModal);
    document.getElementById('cancel-shortcut-modal').addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeModal();
    });

    // Populate icon picker
    const icons = ['💻', '📊', '📁', '📝', '🐳', '📜', '💾', '🧠', '⚙️', '🔧', '📦', '🌐', '🔒', '📡', '⏱️', '🎯', '🚀', '💡', '🔍', '📈'];
    const iconPicker = document.getElementById('icon-picker');
    icons.forEach(icon => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.style.cssText = 'width: 40px; height: 40px; border: 1px solid var(--card-border); border-radius: 8px; background: var(--card-bg); font-size: 1.2rem; cursor: pointer;';
        btn.textContent = icon;
        btn.addEventListener('click', () => {
            document.querySelectorAll('#icon-picker button').forEach(b => b.style.borderColor = 'var(--card-border)');
            btn.style.borderColor = 'var(--primary)';
            document.getElementById('shortcut-icon').value = icon;
        });
        iconPicker.appendChild(btn);
    });

    // Form submit
    document.getElementById('shortcut-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = document.getElementById('shortcut-name').value.trim();
        const command = document.getElementById('shortcut-command').value.trim();
        const description = document.getElementById('shortcut-description').value.trim();
        const icon = document.getElementById('shortcut-icon').value;

        try {
            const res = await authFetch(`${API_BASE}/shortcuts`, {
                method: 'POST',
                body: JSON.stringify({ name, command, description, icon })
            });
            const data = await res.json();

            if (!res.ok) throw new Error(data.error || 'Failed to create shortcut');

            modal.remove();
            renderContent('terminal');
        } catch (err) {
            alert('Error: ' + err.message);
        }
    });
}

// =============================================================================
// DOCKER VIEW LOGS
// =============================================================================

async function openContainerLogs(containerId, containerName) {
    const modal = document.createElement('div');
    modal.className = 'modal active';
    modal.innerHTML = `
        <div class="glass-card logs-modal-content">
            <header class="modal-header" style="padding: 15px 20px; border-bottom: 1px solid var(--card-border);">
                <h3>📜 Logs: ${escapeHtml(containerName)}</h3>
                <button id="close-logs-modal" class="btn-close">&times;</button>
            </header>
            <div class="logs-container" id="logs-content">
                <span style="color: var(--text-dim);">${t('common.loading', 'Cargando...')}</span>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    // Close handlers
    const closeModal = () => modal.remove();
    document.getElementById('close-logs-modal').addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeModal();
    });

    try {
        const res = await authFetch(`${API_BASE}/docker/logs/${encodeURIComponent(containerId)}?tail=200`);
        const data = await res.json();
        
        const logsEl = document.getElementById('logs-content');
        if (data.logs) {
            logsEl.textContent = data.logs;
            logsEl.scrollTop = logsEl.scrollHeight;
        } else {
            logsEl.innerHTML = '<span style="color: var(--text-dim);">No logs available</span>';
        }
    } catch (e) {
        document.getElementById('logs-content').innerHTML = `<span style="color: #ef4444;">Error: ${escapeHtml(e.message)}</span>`;
    }
}

window.openContainerLogs = openContainerLogs;

// =============================================================================
// DOCKER NOTES
// =============================================================================

async function saveContainerNotes(containerId, notes) {
    try {
        const res = await authFetch(`${API_BASE}/docker/notes/${encodeURIComponent(containerId)}`, {
            method: 'POST',
            body: JSON.stringify({ notes })
        });
        if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            throw new Error(data.error || 'Failed to save notes');
        }
        return true;
    } catch (e) {
        console.error('Save notes error:', e);
        return false;
    }
}

window.saveContainerNotes = saveContainerNotes;

// =============================================================================
// ENHANCED STORAGE VIEW
// =============================================================================

// This updates renderStorageDashboard to include mount points and Cockpit-style view
// The function is already defined, we just need to ensure it renders properly

// =============================================================================
// FILE MANAGER (File Station) - Enhanced
// =============================================================================

let currentFilePath = '/';
let fmViewMode = localStorage.getItem('fm-view-mode') || 'list'; // 'list' | 'grid'
let fmSelectedFiles = new Set(); // Set of full file paths for multi-select
let fmCurrentFiles = []; // current loaded file list for reference
let fmClipboard = { action: null, files: [] }; // { action: 'copy'|'cut', files: [{path, name}] }

async function renderFilesView() {
    // ══════════════════════════════════════════════════════════════════════════
    // FILE MANAGER - SYNOLOGY STYLE LAYOUT
    // ══════════════════════════════════════════════════════════════════════════
    
    // Clear previous content to avoid duplicates
    dashboardContent.innerHTML = '';
    
    // Main layout container
    const layout = document.createElement('div');
    layout.className = 'fm-layout';
    
    // ── LEFT SIDEBAR: Folder Tree ──
    const sidebar = document.createElement('div');
    sidebar.className = 'fm-sidebar';
    sidebar.innerHTML = `
        <div class="fm-sidebar-header">📂 Carpetas</div>
        <div class="fm-tree" id="fm-tree"></div>
    `;
    layout.appendChild(sidebar);
    
    // ── RIGHT PANEL: Main Content ──
    const main = document.createElement('div');
    main.className = 'fm-main';
    
    // Toolbar
    const toolbar = document.createElement('div');
    toolbar.className = 'fm-main-toolbar';
    
    // Row 1: breadcrumb + actions
    const toolbarRow1 = document.createElement('div');
    toolbarRow1.className = 'fm-toolbar-row';

    // Breadcrumb
    const breadcrumb = document.createElement('div');
    breadcrumb.className = 'fm-breadcrumb';
    breadcrumb.id = 'fm-breadcrumb';
    updateBreadcrumb(breadcrumb, currentFilePath);

    // Actions right
    const actions = document.createElement('div');
    actions.className = 'fm-actions';

    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.placeholder = '🔍 Buscar...';
    searchInput.className = 'fm-search-input';
    searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') searchFiles(searchInput.value); // Deep search on Enter
    });
    searchInput.addEventListener('input', (e) => {
        const query = e.target.value.trim().toLowerCase();
        if (!query) {
            // Empty search: show all files
            renderFilteredFiles(fmCurrentFiles);
        } else {
            // Local filter: instant results
            const filtered = fmCurrentFiles.filter(f => 
                f.name.toLowerCase().includes(query)
            );
            renderFilteredFiles(filtered, query);
        }
    });

    const uploadBtn = document.createElement('button');
    uploadBtn.className = 'btn-primary btn-sm';
    uploadBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg> Subir';
    uploadBtn.addEventListener('click', () => triggerFileUpload());

    const newFolderBtn = document.createElement('button');
    newFolderBtn.className = 'btn-primary btn-sm';
    newFolderBtn.style.background = '#6366f1';
    newFolderBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/><line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/></svg> Carpeta';
    newFolderBtn.addEventListener('click', () => createNewFolder());

    // View mode toggle
    const viewToggle = document.createElement('div');
    viewToggle.className = 'fm-view-toggle';
    const listBtn = document.createElement('button');
    listBtn.className = 'fm-view-btn' + (fmViewMode === 'list' ? ' active' : '');
    listBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>';
    listBtn.title = 'Vista lista';
    listBtn.addEventListener('click', () => { fmViewMode = 'list'; localStorage.setItem('fm-view-mode', 'list'); renderFilesView(); });
    const gridBtn = document.createElement('button');
    gridBtn.className = 'fm-view-btn' + (fmViewMode === 'grid' ? ' active' : '');
    gridBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>';
    gridBtn.title = 'Vista cuadrícula';
    gridBtn.addEventListener('click', () => { fmViewMode = 'grid'; localStorage.setItem('fm-view-mode', 'grid'); renderFilesView(); });
    viewToggle.appendChild(listBtn);
    viewToggle.appendChild(gridBtn);

    actions.appendChild(searchInput);
    actions.appendChild(uploadBtn);
    actions.appendChild(newFolderBtn);
    actions.appendChild(viewToggle);

    toolbarRow1.appendChild(breadcrumb);
    toolbarRow1.appendChild(actions);
    toolbar.appendChild(toolbarRow1);

    // Row 2: Bulk actions bar (hidden by default)
    const bulkBar = document.createElement('div');
    bulkBar.className = 'fm-bulk-bar';
    bulkBar.id = 'fm-bulk-bar';
    bulkBar.style.display = 'none';
    bulkBar.innerHTML = `
        <span class="fm-bulk-count" id="fm-bulk-count">0 seleccionados</span>
        <button class="fm-bulk-btn" onclick="fmBulkDownload()" title="Descargar seleccionados"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> Descargar</button>
        <button class="fm-bulk-btn" onclick="fmBulkCopy()" title="Copiar"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg> Copiar</button>
        <button class="fm-bulk-btn" onclick="fmBulkCut()" title="Mover"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><line x1="20" y1="4" x2="8.12" y2="15.88"/><line x1="14.47" y1="14.48" x2="20" y2="20"/><line x1="8.12" y1="8.12" x2="12" y2="12"/></svg> Mover</button>
        <button class="fm-bulk-btn fm-bulk-btn-danger" onclick="fmBulkDelete()" title="Eliminar seleccionados"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg> Eliminar</button>
        <button class="fm-bulk-btn" onclick="fmClearSelection()" title="Deseleccionar">✕ Limpiar</button>
    `;
    toolbar.appendChild(bulkBar);

    // Paste bar (when clipboard has items)
    if (fmClipboard.action && fmClipboard.files.length > 0) {
        const pasteBar = document.createElement('div');
        pasteBar.className = 'fm-paste-bar';
        pasteBar.innerHTML = `
            <span>📋 ${fmClipboard.files.length} archivo(s) en portapapeles (${fmClipboard.action === 'copy' ? 'copiar' : 'mover'})</span>
            <button class="btn-primary btn-sm" onclick="fmPaste()">📋 Pegar aquí</button>
            <button class="fm-bulk-btn" onclick="fmClipboard={action:null,files:[]};renderFilesView()">✕ Cancelar</button>
        `;
        toolbar.appendChild(pasteBar);
    }

    main.appendChild(toolbar);
    
    // Upload progress bar
    const uploadProgress = document.createElement('div');
    uploadProgress.className = 'fm-upload-progress';
    uploadProgress.id = 'fm-upload-progress';
    uploadProgress.style.display = 'none';
    uploadProgress.innerHTML = `
        <div class="fm-upload-info">
            <span id="fm-upload-filename">Subiendo...</span>
            <span id="fm-upload-percent">0%</span>
        </div>
        <div class="fm-progress-track">
            <div class="fm-progress-fill" id="fm-progress-fill" style="width: 0%"></div>
        </div>
    `;
    main.appendChild(uploadProgress);

    // Main content area (files list)
    const content = document.createElement('div');
    content.className = 'fm-main-content';
    content.id = 'fm-main-content';
    
    // Drag & drop overlay
    const dropZone = document.createElement('div');
    dropZone.className = 'fm-drop-zone';
    dropZone.id = 'fm-drop-zone';
    dropZone.innerHTML = `
        <div class="fm-drop-inner">
            <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="var(--primary, #84cc16)" stroke-width="1.5">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
                <polyline points="17 8 12 3 7 8"/>
                <line x1="12" y1="3" x2="12" y2="15"/>
            </svg>
            <p style="margin-top: 12px; font-size: 1.1rem; font-weight: 600;">Suelta los archivos aquí</p>
            <p style="font-size: 0.85rem; color: var(--text-dim);">Se subirán a <strong>${escapeHtml(currentFilePath)}</strong></p>
        </div>
    `;
    content.appendChild(dropZone);

    // Table header (only for list view)
    if (fmViewMode === 'list') {
        const tableHeader = document.createElement('div');
        tableHeader.className = 'fm-table-header';
        tableHeader.innerHTML = `
            <label class="fm-checkbox-wrap"><input type="checkbox" id="fm-select-all" onchange="fmToggleSelectAll(this.checked)"><span class="fm-checkbox-custom"></span></label>
            <span></span>
            <span>Nombre</span>
            <span>Tamaño</span>
            <span class="fm-hide-mobile">Modificado</span>
            <span class="fm-hide-mobile">Permisos</span>
            <span></span>
        `;
        content.appendChild(tableHeader);
    }

    const filesList = document.createElement('div');
    filesList.id = 'files-list';
    filesList.className = fmViewMode === 'grid' ? 'fm-grid' : 'fm-list';
    content.appendChild(filesList);

    main.appendChild(content);
    layout.appendChild(main);
    dashboardContent.appendChild(layout);

    // ── Setup drag & drop ──
    fmSetupDragDrop(layout);

    // Hidden file input
    let fileInput = document.getElementById('file-upload-input');
    if (!fileInput) {
        fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.id = 'file-upload-input';
        fileInput.multiple = true;
        fileInput.style.display = 'none';
        fileInput.addEventListener('change', handleFileUpload);
        document.body.appendChild(fileInput);
    }

    fmSelectedFiles.clear();
    
    // Load folder tree and files in parallel
    await Promise.all([
        loadFolderTree(),
        loadFiles(currentFilePath)
    ]);
}

// ══════════════════════════════════════════════════════════════════════════════
// FOLDER TREE (Synology-style sidebar)
// ══════════════════════════════════════════════════════════════════════════════
let fmExpandedFolders = new Set(['/']);

async function loadFolderTree() {
    const treeContainer = document.getElementById('fm-tree');
    if (!treeContainer) return;
    
    treeContainer.innerHTML = '<div style="padding: 12px; color: var(--text-dim);">Cargando...</div>';
    
    try {
        // Build tree starting from root
        const tree = await buildFolderTree('/');
        treeContainer.innerHTML = '';
        renderFolderTree(treeContainer, tree, 0);
    } catch (e) {
        console.error('loadFolderTree error:', e);
        treeContainer.innerHTML = '<div style="padding: 12px; color: #ef4444;">Error al cargar</div>';
    }
}

async function buildFolderTree(path) {
    try {
        const res = await authFetch(`${API_BASE}/files/list?path=${encodeURIComponent(path)}`);
        if (!res.ok) return { name: path.split('/').pop() || 'Storage', path, children: [] };
        const data = await res.json();
        
        const items = data.items || data.files || [];
        const folders = items
            .filter(f => f.type === 'directory' || f.isDirectory)
            .sort((a, b) => a.name.localeCompare(b.name))
            .map(f => ({
                name: f.name,
                path: path === '/' ? '/' + f.name : path + '/' + f.name,
                children: null // Lazy load
            }));
        
        return {
            name: path === '/' ? 'Storage' : path.split('/').pop(),
            path,
            children: folders
        };
    } catch (e) {
        return { name: path.split('/').pop() || 'Storage', path, children: [] };
    }
}

function renderFolderTree(container, node, level) {
    const item = document.createElement('div');
    item.className = 'fm-tree-item' + (currentFilePath === node.path ? ' active' : '');
    item.style.paddingLeft = (12 + level * 16) + 'px';
    
    // hasChildren: true if has loaded children OR children is null (not yet loaded)
    const hasChildren = node.children === null || (node.children && node.children.length > 0);
    const isExpanded = fmExpandedFolders.has(node.path);
    
    // Expand/collapse arrow
    const expandBtn = document.createElement('span');
    expandBtn.className = 'fm-tree-expand' + (isExpanded ? ' expanded' : '');
    expandBtn.innerHTML = hasChildren ? '▶' : '';
    expandBtn.style.visibility = hasChildren ? 'visible' : 'hidden';
    
    // Folder icon
    const icon = document.createElement('span');
    icon.className = 'fm-tree-icon';
    icon.textContent = isExpanded && hasChildren ? '📂' : '📁';
    
    // Folder name
    const name = document.createElement('span');
    name.textContent = node.name;
    name.style.overflow = 'hidden';
    name.style.textOverflow = 'ellipsis';
    
    item.appendChild(expandBtn);
    item.appendChild(icon);
    item.appendChild(name);
    
    // Click to navigate
    item.addEventListener('click', async (e) => {
        if (e.target === expandBtn || e.target.closest('.fm-tree-expand')) {
            // Toggle expand/collapse
            e.stopPropagation();
            if (isExpanded) {
                fmExpandedFolders.delete(node.path);
            } else {
                fmExpandedFolders.add(node.path);
                // Load children if not yet loaded
                if (node.children === null) {
                    const childData = await buildFolderTree(node.path);
                    node.children = childData.children || [];
                }
            }
            await loadFolderTree();
        } else {
            // Navigate to folder
            currentFilePath = node.path;
            fmExpandedFolders.add(node.path);
            // Load children if not yet loaded
            if (node.children === null) {
                const childData = await buildFolderTree(node.path);
                node.children = childData.children || [];
            }
            await renderFilesView();
        }
    });
    
    // ── Drop target for drag & drop ──
    item.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        item.classList.add('drop-target');
    });
    item.addEventListener('dragleave', () => {
        item.classList.remove('drop-target');
    });
    item.addEventListener('drop', async (e) => {
        e.preventDefault();
        item.classList.remove('drop-target');
        
        try {
            const data = JSON.parse(e.dataTransfer.getData('text/plain'));
            if (data.path && data.name) {
                // Don't move to same folder
                const srcFolder = data.path.substring(0, data.path.lastIndexOf('/')) || '/';
                if (srcFolder === node.path) return;
                
                // Move file
                const destPath = node.path === '/' ? '/' + data.name : node.path + '/' + data.name;
                const res = await authFetch(`${API_BASE}/files/move`, {
                    method: 'POST',
                    body: JSON.stringify({ source: data.path, destination: destPath })
                });
                
                if (res.ok) {
                    showNotification(`"${data.name}" movido a ${node.path}`, 'success');
                    await renderFilesView();
                } else {
                    const err = await res.json().catch(() => ({}));
                    showNotification('Error: ' + (err.error || 'No se pudo mover'), 'error');
                }
            }
        } catch (e) {
            console.error('Drop error:', e);
        }
    });
    
    container.appendChild(item);
    
    // Render children if expanded AND loaded
    if (hasChildren && isExpanded && Array.isArray(node.children) && node.children.length > 0) {
        const childrenContainer = document.createElement('div');
        childrenContainer.className = 'fm-tree-children';
        node.children.forEach(child => {
            renderFolderTree(childrenContainer, child, level + 1);
        });
        container.appendChild(childrenContainer);
    }
}

// ── Breadcrumb ──
function updateBreadcrumb(breadcrumb, filePath) {
    breadcrumb.innerHTML = '';
    const parts = filePath.split('/').filter(Boolean);

    const homeBtn = document.createElement('button');
    homeBtn.className = 'fm-breadcrumb-btn';
    homeBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>';
    homeBtn.title = 'Storage';
    homeBtn.addEventListener('click', () => { currentFilePath = '/'; renderFilesView(); });
    breadcrumb.appendChild(homeBtn);

    let accPath = '';
    parts.forEach((part, i) => {
        accPath += '/' + part;
        const sep = document.createElement('span');
        sep.className = 'fm-breadcrumb-sep';
        sep.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>';
        breadcrumb.appendChild(sep);

        const btn = document.createElement('button');
        btn.textContent = part;
        btn.className = 'fm-breadcrumb-btn' + (i === parts.length - 1 ? ' active' : '');
        const targetPath = accPath;
        btn.addEventListener('click', () => { currentFilePath = targetPath; renderFilesView(); });
        breadcrumb.appendChild(btn);
    });
}

// ── Load files ──
async function loadFiles(filePath) {
    const filesList = document.getElementById('files-list');
    if (!filesList) return;
    filesList.innerHTML = '<div class="fm-empty-state"><div class="fm-spinner"></div><p>Cargando archivos...</p></div>';

    try {
        const res = await authFetch(`${API_BASE}/files/list?path=${encodeURIComponent(filePath)}`);
        if (!res.ok) throw new Error('Failed to load files');
        const data = await res.json();
        const files = data.items || data || [];

        fmCurrentFiles = files;

        if (files.length === 0) {
            filesList.innerHTML = `<div class="fm-empty-state">
                <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="var(--text-dim)" stroke-width="1" opacity="0.4">
                    <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/>
                </svg>
                <p style="margin-top:12px">Carpeta vacía</p>
                <p style="font-size:0.8rem;color:var(--text-dim)">Arrastra archivos aquí o usa el botón Subir</p>
            </div>`;
            return;
        }

        // Sort: folders first, then alphabetical
        files.sort((a, b) => {
            if (a.type === 'directory' && b.type !== 'directory') return -1;
            if (a.type !== 'directory' && b.type === 'directory') return 1;
            return a.name.localeCompare(b.name);
        });

        filesList.innerHTML = '';

        if (fmViewMode === 'grid') {
            renderFilesGrid(filesList, files, filePath);
        } else {
            renderFilesList(filesList, files, filePath);
        }
    } catch (e) {
        console.error('Load files error:', e);
        filesList.innerHTML = '<div class="fm-empty-state" style="color:#ef4444"><p>❌ Error al cargar archivos</p></div>';
    }
}

// ── Render filtered files (for local search) ──
function renderFilteredFiles(files, highlightQuery = '') {
    const filesList = document.getElementById('files-list');
    if (!filesList) return;

    if (files.length === 0) {
        filesList.innerHTML = `<div class="fm-empty-state">
            <p>🔍 Sin resultados${highlightQuery ? ' para "' + highlightQuery + '"' : ''}</p>
            <p style="font-size:0.8rem;color:var(--text-dim)">Presiona Enter para buscar en subcarpetas</p>
        </div>`;
        return;
    }

    // Sort: folders first, then alphabetical
    const sorted = [...files].sort((a, b) => {
        if (a.type === 'directory' && b.type !== 'directory') return -1;
        if (a.type !== 'directory' && b.type === 'directory') return 1;
        return a.name.localeCompare(b.name);
    });

    filesList.innerHTML = '';
    if (fmViewMode === 'grid') {
        renderFilesGrid(filesList, sorted, currentFilePath);
    } else {
        renderFilesList(filesList, sorted, currentFilePath);
    }
}

// ── Render list view ──
function renderFilesList(container, files, filePath) {
    files.forEach(file => {
        const fullPath = filePath + '/' + file.name;
        const isSelected = fmSelectedFiles.has(fullPath);
        const row = document.createElement('div');
        row.className = 'fm-row' + (isSelected ? ' selected' : '');
        row.dataset.path = fullPath;

        const checkbox = document.createElement('label');
        checkbox.className = 'fm-checkbox-wrap';
        checkbox.innerHTML = `<input type="checkbox" ${isSelected ? 'checked' : ''} onchange="fmToggleSelect('${fullPath.replace(/'/g, "\\'")}', this.checked)"><span class="fm-checkbox-custom"></span>`;
        checkbox.addEventListener('click', (e) => e.stopPropagation());

        const iconWrap = document.createElement('span');
        iconWrap.className = 'fm-file-icon';
        iconWrap.innerHTML = file.type === 'directory' ? getFolderSVG() : getFileIconSVG(file.name);

        const nameSpan = document.createElement('span');
        nameSpan.className = 'fm-file-name';
        nameSpan.textContent = file.name;

        const sizeSpan = document.createElement('span');
        sizeSpan.className = 'fm-file-meta';
        sizeSpan.textContent = file.type === 'directory' ? '—' : formatFileSize(file.size);

        const dateSpan = document.createElement('span');
        dateSpan.className = 'fm-file-meta fm-hide-mobile';
        dateSpan.textContent = file.modified ? new Date(file.modified).toLocaleString('es-ES', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

        const permSpan = document.createElement('span');
        permSpan.className = 'fm-file-meta fm-hide-mobile fm-file-perm';
        permSpan.textContent = file.permissions || file.mode || '—';

        const actionsDiv = document.createElement('div');
        actionsDiv.className = 'fm-row-actions';

        if (file.type !== 'directory') {
            const dlBtn = document.createElement('button');
            dlBtn.className = 'fm-action-btn';
            dlBtn.title = 'Descargar';
            dlBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
            dlBtn.addEventListener('click', (e) => { e.stopPropagation(); downloadFile(fullPath); });
            actionsDiv.appendChild(dlBtn);
        }

        const menuBtn = document.createElement('button');
        menuBtn.className = 'fm-action-btn';
        menuBtn.title = 'Más opciones';
        menuBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/></svg>';
        menuBtn.addEventListener('click', (e) => { e.stopPropagation(); showFileContextMenu(e, fullPath, file); });
        actionsDiv.appendChild(menuBtn);

        row.appendChild(checkbox);
        row.appendChild(iconWrap);
        row.appendChild(nameSpan);
        row.appendChild(sizeSpan);
        row.appendChild(dateSpan);
        row.appendChild(permSpan);
        row.appendChild(actionsDiv);

        row.addEventListener('click', (e) => {
            if (file.type === 'directory') {
                currentFilePath = fullPath;
                renderFilesView();
            } else {
                fmPreviewFile(file, filePath);
            }
        });

        row.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            showFileContextMenu(e, fullPath, file);
        });

        // ── Drag & Drop ──
        row.draggable = true;
        row.addEventListener('dragstart', (e) => {
            e.dataTransfer.setData('text/plain', JSON.stringify({ path: fullPath, name: file.name }));
            e.dataTransfer.effectAllowed = 'move';
            row.classList.add('dragging');
            document.body.classList.add('fm-dragging');
        });
        row.addEventListener('dragend', () => {
            row.classList.remove('dragging');
            document.body.classList.remove('fm-dragging');
        });

        container.appendChild(row);
    });
}

// ── Render grid view ──
function renderFilesGrid(container, files, filePath) {
    files.forEach(file => {
        const fullPath = filePath + '/' + file.name;
        const isSelected = fmSelectedFiles.has(fullPath);
        const card = document.createElement('div');
        card.className = 'fm-grid-item' + (isSelected ? ' selected' : '');
        card.dataset.path = fullPath;

        const checkbox = document.createElement('label');
        checkbox.className = 'fm-checkbox-wrap fm-grid-checkbox';
        checkbox.innerHTML = `<input type="checkbox" ${isSelected ? 'checked' : ''} onchange="fmToggleSelect('${fullPath.replace(/'/g, "\\'")}', this.checked)"><span class="fm-checkbox-custom"></span>`;
        checkbox.addEventListener('click', (e) => e.stopPropagation());

        const iconArea = document.createElement('div');
        iconArea.className = 'fm-grid-icon';

        // For images, show thumbnail
        const ext = file.name.split('.').pop().toLowerCase();
        const imgExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp'];
        if (file.type !== 'directory' && imgExts.includes(ext)) {
            const thumb = document.createElement('img');
            thumb.className = 'fm-grid-thumb';
            thumb.src = `${API_BASE}/files/download?path=${encodeURIComponent(fullPath)}&sessionId=${state.sessionId}`;
            thumb.alt = file.name;
            thumb.loading = 'lazy';
            iconArea.appendChild(thumb);
        } else {
            iconArea.innerHTML = file.type === 'directory' ? getFolderSVG(48) : getFileIconSVG(file.name, 48);
        }

        const nameLabel = document.createElement('div');
        nameLabel.className = 'fm-grid-name';
        nameLabel.textContent = file.name;
        nameLabel.title = file.name;

        const metaLabel = document.createElement('div');
        metaLabel.className = 'fm-grid-meta';
        metaLabel.textContent = file.type === 'directory' ? 'Carpeta' : formatFileSize(file.size);

        card.appendChild(checkbox);
        card.appendChild(iconArea);
        card.appendChild(nameLabel);
        card.appendChild(metaLabel);

        card.addEventListener('click', (e) => {
            if (file.type === 'directory') {
                currentFilePath = fullPath;
                renderFilesView();
            } else {
                fmPreviewFile(file, filePath);
            }
        });

        card.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            showFileContextMenu(e, fullPath, file);
        });

        // ── Drag & Drop ──
        card.draggable = true;
        card.addEventListener('dragstart', (e) => {
            e.dataTransfer.setData('text/plain', JSON.stringify({ path: fullPath, name: file.name }));
            e.dataTransfer.effectAllowed = 'move';
            card.classList.add('dragging');
            document.body.classList.add('fm-dragging');
        });
        card.addEventListener('dragend', () => {
            card.classList.remove('dragging');
            document.body.classList.remove('fm-dragging');
        });

        container.appendChild(card);
    });
}

// ── File Icons (SVG) ──
function getFileIconSVG(name, size) {
    const s = size || 24;
    const ext = name.split('.').pop().toLowerCase();
    const colorMap = {
        // Images
        jpg: '#e879f9', jpeg: '#e879f9', png: '#e879f9', gif: '#e879f9', svg: '#e879f9', webp: '#e879f9', bmp: '#e879f9', ico: '#e879f9',
        // Video
        mp4: '#f97316', mkv: '#f97316', avi: '#f97316', mov: '#f97316', wmv: '#f97316', flv: '#f97316', webm: '#f97316',
        // Audio
        mp3: '#06b6d4', flac: '#06b6d4', wav: '#06b6d4', ogg: '#06b6d4', aac: '#06b6d4', wma: '#06b6d4', m4a: '#06b6d4',
        // Documents
        pdf: '#ef4444', doc: '#3b82f6', docx: '#3b82f6', xls: '#22c55e', xlsx: '#22c55e', ppt: '#f97316', pptx: '#f97316',
        txt: '#94a3b8', md: '#94a3b8', csv: '#22c55e', rtf: '#3b82f6',
        // Archives
        zip: '#eab308', tar: '#eab308', gz: '#eab308', rar: '#eab308', '7z': '#eab308', bz2: '#eab308', xz: '#eab308',
        // Code
        js: '#eab308', ts: '#3b82f6', py: '#22c55e', sh: '#22c55e', json: '#eab308', yml: '#ef4444', yaml: '#ef4444',
        html: '#f97316', css: '#3b82f6', php: '#8b5cf6', rb: '#ef4444', go: '#06b6d4', rs: '#f97316', java: '#ef4444',
        c: '#3b82f6', cpp: '#3b82f6', h: '#3b82f6', xml: '#f97316', sql: '#3b82f6',
        // Disk images
        iso: '#8b5cf6', img: '#8b5cf6', dmg: '#8b5cf6',
        // Config
        conf: '#94a3b8', cfg: '#94a3b8', ini: '#94a3b8', env: '#94a3b8', log: '#94a3b8', toml: '#94a3b8',
        // Fonts
        ttf: '#e879f9', otf: '#e879f9', woff: '#e879f9', woff2: '#e879f9',
    };
    const labelMap = {
        pdf: 'PDF', doc: 'DOC', docx: 'DOC', xls: 'XLS', xlsx: 'XLS', ppt: 'PPT', pptx: 'PPT',
        zip: 'ZIP', tar: 'TAR', gz: 'GZ', rar: 'RAR', '7z': '7Z',
        js: 'JS', ts: 'TS', py: 'PY', sh: 'SH', json: '{ }', yml: 'YML', yaml: 'YML',
        html: 'HTML', css: 'CSS', php: 'PHP', sql: 'SQL',
        mp3: '♪', flac: '♪', wav: '♪', ogg: '♪', aac: '♪', m4a: '♪',
        mp4: '▶', mkv: '▶', avi: '▶', mov: '▶', webm: '▶',
        jpg: '🖼', jpeg: '🖼', png: '🖼', gif: '🖼', svg: '🖼', webp: '🖼',
        iso: 'ISO', img: 'IMG',
    };
    const color = colorMap[ext] || '#94a3b8';
    const label = labelMap[ext] || ext.toUpperCase().slice(0, 4);
    const labelFontSize = label.length > 3 ? (s * 0.2) : (s * 0.28);
    return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none">
        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" fill="${color}20" stroke="${color}" stroke-width="1.5"/>
        <polyline points="14 2 14 8 20 8" stroke="${color}" stroke-width="1.5"/>
        <text x="12" y="17" text-anchor="middle" fill="${color}" font-size="${labelFontSize}" font-weight="700" font-family="system-ui">${label}</text>
    </svg>`;
}

function getFolderSVG(size) {
    const s = size || 24;
    return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none">
        <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" fill="#eab30830" stroke="#eab308" stroke-width="1.5"/>
    </svg>`;
}

function getFileIcon(name) {
    // Legacy compat — returns emoji
    const ext = name.split('.').pop().toLowerCase();
    const iconMap = {
        jpg: '🖼️', jpeg: '🖼️', png: '🖼️', gif: '🖼️', svg: '🖼️', webp: '🖼️', bmp: '🖼️',
        mp4: '🎬', mkv: '🎬', avi: '🎬', mov: '🎬', webm: '🎬',
        mp3: '🎵', flac: '🎵', wav: '🎵', ogg: '🎵', aac: '🎵', m4a: '🎵',
        pdf: '📕', doc: '📄', docx: '📄', xls: '📊', xlsx: '📊', ppt: '📊', pptx: '📊',
        txt: '📝', md: '📝', csv: '📊', rtf: '📄',
        zip: '📦', tar: '📦', gz: '📦', rar: '📦', '7z': '📦',
        js: '⚙️', ts: '⚙️', py: '🐍', sh: '🔧', json: '{ }', yml: '⚙️', yaml: '⚙️',
        html: '🌐', css: '🎨', php: '🐘', sql: '🗃️',
        iso: '💿', img: '💿', dmg: '💿',
        conf: '⚙️', cfg: '⚙️', ini: '⚙️', log: '📋', env: '🔒',
        ttf: '🔤', otf: '🔤', woff: '🔤',
    };
    return iconMap[ext] || '📄';
}

function formatFileSize(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return (bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0) + ' ' + units[i];
}

function triggerFileUpload() {
    const input = document.getElementById('file-upload-input');
    if (input) input.click();
}

// ── Upload with progress ──
async function handleFileUpload(e) {
    const files = e.target ? e.target.files : e;
    if (!files || files.length === 0) return;

    const progressEl = document.getElementById('fm-upload-progress');
    const filenameEl = document.getElementById('fm-upload-filename');
    const percentEl = document.getElementById('fm-upload-percent');
    const fillEl = document.getElementById('fm-progress-fill');
    if (progressEl) progressEl.style.display = 'block';

    const fileArray = Array.from(files);
    for (let idx = 0; idx < fileArray.length; idx++) {
        const file = fileArray[idx];
        if (filenameEl) filenameEl.textContent = `(${idx + 1}/${fileArray.length}) ${file.name}`;
        if (percentEl) percentEl.textContent = '0%';
        if (fillEl) fillEl.style.width = '0%';

        const formData = new FormData();
        formData.append('files', file);
        formData.append('path', currentFilePath);

        try {
            // Helper to perform upload with current CSRF token
            const doUpload = () => new Promise((resolve, reject) => {
                const xhr = new XMLHttpRequest();
                xhr.open('POST', `${API_BASE}/files/upload`);
                xhr.setRequestHeader('X-Session-Id', state.sessionId);
                if (state.csrfToken) xhr.setRequestHeader('X-CSRF-Token', state.csrfToken);

                xhr.upload.addEventListener('progress', (ev) => {
                    if (ev.lengthComputable) {
                        const pct = Math.round((ev.loaded / ev.total) * 100);
                        if (percentEl) percentEl.textContent = pct + '%';
                        if (fillEl) fillEl.style.width = pct + '%';
                    }
                });

                xhr.addEventListener('load', () => {
                    if (xhr.status >= 200 && xhr.status < 300) resolve();
                    else reject({ status: xhr.status, response: xhr.responseText });
                });
                xhr.addEventListener('error', () => reject({ status: 0, response: 'Network error' }));
                xhr.send(formData);
            });

            try {
                await doUpload();
            } catch (uploadErr) {
                // If 403, try refreshing CSRF token and retry once
                if (uploadErr.status === 403) {
                    console.log('CSRF token expired, refreshing...');
                    try {
                        const refreshRes = await fetch(`${API_BASE}/verify-session`, {
                            method: 'POST',
                            headers: { 'X-Session-Id': state.sessionId }
                        });
                        if (refreshRes.ok) {
                            const data = await refreshRes.json();
                            if (data.csrfToken) {
                                state.csrfToken = data.csrfToken;
                                localStorage.setItem('csrfToken', data.csrfToken);
                                console.log('CSRF token refreshed, retrying upload...');
                                await doUpload();
                            } else {
                                throw new Error('No CSRF token in response');
                            }
                        } else {
                            // Session invalid, force re-login
                            clearSession();
                            showView('login');
                            throw new Error('Session expired');
                        }
                    } catch (refreshErr) {
                        throw new Error('Upload failed: ' + uploadErr.status);
                    }
                } else {
                    throw new Error('Upload failed: ' + uploadErr.status);
                }
            }
        } catch (err) {
            console.error('Upload error:', err);
            alert(`Error al subir ${file.name}`);
        }
    }

    if (progressEl) {
        if (fillEl) fillEl.style.width = '100%';
        if (filenameEl) filenameEl.textContent = '✅ Subida completada';
        setTimeout(() => { progressEl.style.display = 'none'; }, 2000);
    }

    if (e.target) e.target.value = '';
    await loadFiles(currentFilePath);
}

// ── Drag & Drop ──
function fmSetupDragDrop(container) {
    let dragCounter = 0;
    const dropZone = document.getElementById('fm-drop-zone');
    if (!dropZone) return;

    const showDrop = () => dropZone.classList.add('active');
    const hideDrop = () => { dropZone.classList.remove('active'); dragCounter = 0; };

    container.addEventListener('dragenter', (e) => {
        e.preventDefault();
        dragCounter++;
        if (e.dataTransfer.types.includes('Files')) showDrop();
    });
    container.addEventListener('dragleave', (e) => {
        e.preventDefault();
        dragCounter--;
        if (dragCounter <= 0) hideDrop();
    });
    container.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
    });
    container.addEventListener('drop', (e) => {
        e.preventDefault();
        hideDrop();
        if (e.dataTransfer.files.length > 0) {
            handleFileUpload(e.dataTransfer.files);
        }
    });
}

// ── File preview ──
function fmPreviewFile(file, basePath) {
    const fullPath = basePath + '/' + file.name;
    const ext = file.name.split('.').pop().toLowerCase();
    const imgExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico'];
    const textExts = ['txt', 'md', 'log', 'json', 'yml', 'yaml', 'xml', 'csv', 'sh', 'bash', 'py', 'js', 'ts', 'html', 'css', 'php', 'rb', 'go', 'rs', 'java', 'c', 'cpp', 'h', 'sql', 'conf', 'cfg', 'ini', 'env', 'toml', 'service', 'properties', 'gitignore', 'dockerfile'];
    const videoExts = ['mp4', 'webm', 'ogg'];
    const audioExts = ['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a'];

    // Remove existing preview
    document.querySelectorAll('.fm-preview-overlay').forEach(m => m.remove());

    const overlay = document.createElement('div');
    overlay.className = 'fm-preview-overlay';
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

    const modal = document.createElement('div');
    modal.className = 'fm-preview-modal';

    // Header
    const header = document.createElement('div');
    header.className = 'fm-preview-header';
    
    const titleSpan = document.createElement('span');
    titleSpan.className = 'fm-preview-title';
    titleSpan.textContent = file.name;
    
    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'fm-preview-actions';
    
    const downloadBtn = document.createElement('button');
    downloadBtn.className = 'fm-action-btn';
    downloadBtn.title = 'Descargar';
    downloadBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
    downloadBtn.addEventListener('click', () => downloadFile(fullPath));
    
    const closeBtn = document.createElement('button');
    closeBtn.className = 'fm-action-btn';
    closeBtn.title = 'Cerrar';
    closeBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
    closeBtn.addEventListener('click', () => overlay.remove());
    
    actionsDiv.appendChild(downloadBtn);
    actionsDiv.appendChild(closeBtn);
    header.appendChild(titleSpan);
    header.appendChild(actionsDiv);
    modal.appendChild(header);

    const body = document.createElement('div');
    body.className = 'fm-preview-body';

    const fileUrl = `${API_BASE}/files/download?path=${encodeURIComponent(fullPath)}&sessionId=${state.sessionId}`;

    if (imgExts.includes(ext)) {
        body.innerHTML = `<img src="${fileUrl}" alt="${file.name}" class="fm-preview-image" />`;
    } else if (videoExts.includes(ext)) {
        body.innerHTML = `<video controls autoplay class="fm-preview-video"><source src="${fileUrl}"></video>`;
    } else if (audioExts.includes(ext)) {
        body.innerHTML = `<div class="fm-preview-audio-wrap">${getFileIconSVG(file.name, 80)}<audio controls autoplay style="width:100%;margin-top:20px"><source src="${fileUrl}"></audio></div>`;
    } else if (ext === 'pdf') {
        body.innerHTML = `<iframe src="${fileUrl}" class="fm-preview-pdf"></iframe>`;
    } else if (textExts.includes(ext)) {
        body.innerHTML = '<div class="fm-preview-loading"><div class="fm-spinner"></div></div>';
        fetch(fileUrl).then(r => r.text()).then(text => {
            const pre = document.createElement('pre');
            pre.className = 'fm-preview-code';
            pre.textContent = text.slice(0, 100000); // Limit to 100KB
            body.innerHTML = '';
            body.appendChild(pre);
        }).catch(() => {
            body.innerHTML = '<p style="color:#ef4444;text-align:center">Error al cargar el archivo</p>';
        });
    } else {
        body.innerHTML = `
            <div class="fm-preview-nopreview">
                ${getFileIconSVG(file.name, 80)}
                <p style="margin-top:16px;font-size:1rem">${escapeHtml(file.name)}</p>
                <p style="color:var(--text-dim);font-size:0.85rem">${formatFileSize(file.size)} · ${ext.toUpperCase()}</p>
                <button class="btn-primary btn-sm fm-nopreview-download" style="margin-top:16px">Descargar archivo</button>
            </div>
        `;
        body.querySelector('.fm-nopreview-download').addEventListener('click', () => downloadFile(fullPath));
    }

    modal.appendChild(body);

    // File info footer
    const footer = document.createElement('div');
    footer.className = 'fm-preview-footer';
    footer.innerHTML = `
        <span>📐 ${formatFileSize(file.size)}</span>
        <span>📅 ${file.modified ? new Date(file.modified).toLocaleString('es-ES') : '—'}</span>
        ${file.permissions ? `<span>🔒 ${file.permissions}</span>` : ''}
    `;
    modal.appendChild(footer);

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    // Close on Escape
    const escHandler = (e) => { if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', escHandler); } };
    document.addEventListener('keydown', escHandler);
}

// ── Multi-select ──
function fmToggleSelect(path, checked) {
    if (checked) {
        fmSelectedFiles.add(path);
    } else {
        fmSelectedFiles.delete(path);
    }
    fmUpdateBulkBar();
    // Update visual
    const row = document.querySelector(`[data-path="${CSS.escape(path)}"]`);
    if (row) row.classList.toggle('selected', checked);
}
window.fmToggleSelect = fmToggleSelect;

function fmToggleSelectAll(checked) {
    const filesList = document.getElementById('files-list');
    if (!filesList) return;
    filesList.querySelectorAll('input[type="checkbox"]').forEach(cb => {
        cb.checked = checked;
    });
    if (checked) {
        fmCurrentFiles.forEach(f => fmSelectedFiles.add(currentFilePath + '/' + f.name));
        filesList.querySelectorAll('[data-path]').forEach(r => r.classList.add('selected'));
    } else {
        fmSelectedFiles.clear();
        filesList.querySelectorAll('[data-path]').forEach(r => r.classList.remove('selected'));
    }
    fmUpdateBulkBar();
}
window.fmToggleSelectAll = fmToggleSelectAll;

function fmUpdateBulkBar() {
    const bar = document.getElementById('fm-bulk-bar');
    const count = document.getElementById('fm-bulk-count');
    if (!bar) return;
    if (fmSelectedFiles.size > 0) {
        bar.style.display = 'flex';
        if (count) count.textContent = `${fmSelectedFiles.size} seleccionado${fmSelectedFiles.size > 1 ? 's' : ''}`;
    } else {
        bar.style.display = 'none';
    }
}

function fmClearSelection() {
    fmSelectedFiles.clear();
    const filesList = document.getElementById('files-list');
    if (filesList) {
        filesList.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = false);
        filesList.querySelectorAll('[data-path]').forEach(r => r.classList.remove('selected'));
    }
    const selectAll = document.getElementById('fm-select-all');
    if (selectAll) selectAll.checked = false;
    fmUpdateBulkBar();
}
window.fmClearSelection = fmClearSelection;

// ── Bulk actions ──
async function fmBulkDelete() {
    if (fmSelectedFiles.size === 0) return;
    const confirmed = await showConfirmModal('Eliminar archivos', `¿Eliminar ${fmSelectedFiles.size} elemento(s)?`);
    if (!confirmed) return;
    for (const fp of fmSelectedFiles) {
        try {
            await authFetch(`${API_BASE}/files/delete`, { method: 'POST', body: JSON.stringify({ path: fp }) });
        } catch (e) { console.error('Delete error:', e); }
    }
    fmSelectedFiles.clear();
    await loadFiles(currentFilePath);
}
window.fmBulkDelete = fmBulkDelete;

function fmBulkDownload() {
    for (const fp of fmSelectedFiles) {
        downloadFile(fp);
    }
}
window.fmBulkDownload = fmBulkDownload;

function fmBulkCopy() {
    fmClipboard = { action: 'copy', files: Array.from(fmSelectedFiles).map(p => ({ path: p, name: p.split('/').pop() })) };
    fmClearSelection();
    renderFilesView();
}
window.fmBulkCopy = fmBulkCopy;

function fmBulkCut() {
    fmClipboard = { action: 'cut', files: Array.from(fmSelectedFiles).map(p => ({ path: p, name: p.split('/').pop() })) };
    fmClearSelection();
    renderFilesView();
}
window.fmBulkCut = fmBulkCut;

async function fmPaste() {
    if (!fmClipboard.action || fmClipboard.files.length === 0) return;
    for (const f of fmClipboard.files) {
        const newPath = currentFilePath + '/' + f.name;
        try {
            if (fmClipboard.action === 'copy') {
                await authFetch(`${API_BASE}/files/copy`, { method: 'POST', body: JSON.stringify({ srcPath: f.path, destPath: newPath }) });
            } else {
                await authFetch(`${API_BASE}/files/rename`, { method: 'POST', body: JSON.stringify({ oldPath: f.path, newPath: newPath }) });
            }
        } catch (e) { console.error('Paste error:', e); }
    }
    fmClipboard = { action: null, files: [] };
    await loadFiles(currentFilePath);
    renderFilesView();
}
window.fmPaste = fmPaste;

// ── CRUD operations ──
async function createNewFolder() {
    const name = prompt('Nombre de la carpeta:');
    if (!name) return;
    try {
        const res = await authFetch(`${API_BASE}/files/mkdir`, {
            method: 'POST',
            body: JSON.stringify({ path: currentFilePath + '/' + name })
        });
        if (!res.ok) throw new Error('Failed');
        await loadFiles(currentFilePath);
    } catch (e) {
        alert('Error al crear carpeta');
    }
}

async function downloadFile(filePath) {
    window.open(`${API_BASE}/files/download?path=${encodeURIComponent(filePath)}&sessionId=${state.sessionId}`, '_blank');
}

async function deleteFile(filePath, name) {
    const confirmed = await showConfirmModal('Eliminar archivo', `¿Eliminar "${name}"?`);
    if (!confirmed) return;
    try {
        const res = await authFetch(`${API_BASE}/files/delete`, {
            method: 'POST',
            body: JSON.stringify({ path: filePath })
        });
        if (!res.ok) throw new Error('Failed');
        await loadFiles(currentFilePath);
    } catch (e) {
        alert('Error al eliminar');
    }
}

async function renameFile(filePath, oldName) {
    const newName = prompt('Nuevo nombre:', oldName);
    if (!newName || newName === oldName) return;
    const dir = filePath.substring(0, filePath.lastIndexOf('/'));
    try {
        const res = await authFetch(`${API_BASE}/files/rename`, {
            method: 'POST',
            body: JSON.stringify({ oldPath: filePath, newPath: dir + '/' + newName })
        });
        if (!res.ok) throw new Error('Failed');
        await loadFiles(currentFilePath);
    } catch (e) {
        alert('Error al renombrar');
    }
}

// ── Search ──
async function searchFiles(query) {
    if (!query.trim()) { await loadFiles(currentFilePath); return; }
    const filesList = document.getElementById('files-list');
    if (!filesList) return;
    filesList.innerHTML = '<div class="fm-empty-state"><div class="fm-spinner"></div><p>🔍 Buscando...</p></div>';
    try {
        const res = await authFetch(`${API_BASE}/files/search?path=${encodeURIComponent(currentFilePath)}&query=${encodeURIComponent(query)}`);
        if (!res.ok) throw new Error('Search failed');
        const searchData = await res.json();
        const results = searchData.results || searchData || [];
        if (results.length === 0) {
            filesList.innerHTML = '<div class="fm-empty-state"><p>Sin resultados para "' + escapeHtml(query) + '"</p></div>';
            return;
        }
        filesList.innerHTML = '';
        filesList.className = 'fm-list';
        results.forEach(file => {
            const row = document.createElement('div');
            row.className = 'fm-row';
            row.innerHTML = `
                <span></span>
                <span class="fm-file-icon">${file.type === 'directory' ? getFolderSVG() : getFileIconSVG(file.name || file.path.split('/').pop())}</span>
                <span class="fm-file-name" style="grid-column: span 2">${file.path || file.name}</span>
                <span class="fm-file-meta">${file.type === 'directory' ? '—' : formatFileSize(file.size)}</span>
                <span></span><span></span>
            `;
            row.style.cursor = 'pointer';
            row.addEventListener('click', () => {
                if (file.type === 'directory') {
                    currentFilePath = file.path || ('/' + file.name);
                    renderFilesView();
                }
            });
            filesList.appendChild(row);
        });
    } catch (e) {
        filesList.innerHTML = '<div class="fm-empty-state" style="color:#ef4444">Error en la búsqueda</div>';
    }
}

// ── Enhanced Context Menu ──
function showFileContextMenu(e, filePath, file) {
    document.querySelectorAll('.fm-context-menu').forEach(m => m.remove());

    const menu = document.createElement('div');
    menu.className = 'fm-context-menu';

    // Position: ensure menu stays within viewport
    const menuWidth = 200;
    const menuHeight = 280;
    let top = e.clientY;
    let left = e.clientX;
    if (left + menuWidth > window.innerWidth) left = window.innerWidth - menuWidth - 8;
    if (top + menuHeight > window.innerHeight) top = window.innerHeight - menuHeight - 8;
    menu.style.top = top + 'px';
    menu.style.left = left + 'px';

    const ext = file.name.split('.').pop().toLowerCase();
    const imgExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp'];
    const previewable = file.type !== 'directory';

    const items = [
        ...(file.type === 'directory' ? [
            { icon: '📂', label: 'Abrir carpeta', action: () => { currentFilePath = filePath; renderFilesView(); } },
        ] : [
            { icon: '👁️', label: 'Vista previa', action: () => fmPreviewFile(file, filePath.substring(0, filePath.lastIndexOf('/'))) },
        ]),
        { icon: '✏️', label: 'Renombrar', action: () => renameFile(filePath, file.name) },
        ...(file.type !== 'directory' ? [
            { icon: '⬇️', label: 'Descargar', action: () => downloadFile(filePath) },
        ] : []),
        { divider: true },
        { icon: '📋', label: 'Copiar', action: () => { fmClipboard = { action: 'copy', files: [{ path: filePath, name: file.name }] }; renderFilesView(); } },
        { icon: '✂️', label: 'Mover', action: () => { fmClipboard = { action: 'cut', files: [{ path: filePath, name: file.name }] }; renderFilesView(); } },
        { divider: true },
        { icon: '🗑️', label: 'Eliminar', action: () => deleteFile(filePath, file.name), danger: true },
    ];

    items.forEach(item => {
        if (item.divider) {
            const hr = document.createElement('div');
            hr.className = 'fm-context-divider';
            menu.appendChild(hr);
            return;
        }
        const btn = document.createElement('button');
        btn.className = 'fm-context-item' + (item.danger ? ' danger' : '');
        btn.innerHTML = `<span>${item.icon}</span><span>${item.label}</span>`;
        btn.addEventListener('click', () => { menu.remove(); item.action(); });
        menu.appendChild(btn);
    });

    document.body.appendChild(menu);
    // Animate in
    requestAnimationFrame(() => menu.classList.add('visible'));
    setTimeout(() => {
        document.addEventListener('click', () => menu.remove(), { once: true });
    }, 10);
}

// =============================================================================
// USERS & 2FA VIEW
// =============================================================================

async function renderUsersView() {
    const container = document.createElement('div');
    container.style.cssText = 'display: contents;';

    // Users card
    const usersCard = document.createElement('div');
    usersCard.className = 'glass-card';
    usersCard.style.cssText = 'grid-column: 1 / -1;';

    const header = document.createElement('div');
    header.style.cssText = 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;';
    
    const title = document.createElement('h3');
    title.textContent = '👥 Gestión de Usuarios';
    
    const addBtn = document.createElement('button');
    addBtn.className = 'btn-primary btn-sm';
    addBtn.textContent = '+ Añadir Usuario';
    addBtn.addEventListener('click', () => showUserForm());
    
    header.appendChild(title);
    header.appendChild(addBtn);
    usersCard.appendChild(header);

    // Users table
    const table = document.createElement('div');
    table.id = 'users-table';
    table.style.cssText = 'border: 1px solid var(--border); border-radius: 8px; overflow: hidden;';
    
    const tableHeader = document.createElement('div');
    tableHeader.style.cssText = 'display: grid; grid-template-columns: 1fr 120px 160px 160px 80px; padding: 12px 20px; background: var(--bg-hover); font-weight: 600; font-size: 0.85rem; color: var(--text-dim);';
    tableHeader.innerHTML = '<span>Usuario</span><span>Rol</span><span>Creado</span><span>Último Acceso</span><span></span>';
    table.appendChild(tableHeader);
    
    const usersList = document.createElement('div');
    usersList.id = 'users-list';
    table.appendChild(usersList);
    usersCard.appendChild(table);
    container.appendChild(usersCard);

    // 2FA Card
    const tfaCard = document.createElement('div');
    tfaCard.className = 'glass-card';
    tfaCard.style.cssText = 'grid-column: 1 / -1;';
    
    const tfaTitle = document.createElement('h3');
    tfaTitle.textContent = '🔐 Autenticación de Dos Factores (2FA)';
    tfaTitle.style.marginBottom = '15px';
    tfaCard.appendChild(tfaTitle);
    
    const tfaContent = document.createElement('div');
    tfaContent.id = 'tfa-content';
    tfaContent.innerHTML = '<p style="color: var(--text-dim);">Cargando...</p>';
    tfaCard.appendChild(tfaContent);
    container.appendChild(tfaCard);

    dashboardContent.appendChild(container);
    await loadUsers();
    await load2FAStatus();
}

async function loadUsers() {
    const usersList = document.getElementById('users-list');
    if (!usersList) return;

    try {
        const res = await authFetch(`${API_BASE}/users`);
        let users = [];
        if (res.ok) {
            const data = await res.json();
            users = data.users || data || [];
        } else {
            // Fallback: show current user only
            users = [{ username: state.user?.username || 'admin', role: 'admin', createdAt: null, lastLogin: null }];
        }

        usersList.innerHTML = '';
        users.forEach(user => {
            const row = document.createElement('div');
            row.style.cssText = 'display: grid; grid-template-columns: 1fr 120px 160px 160px 80px; padding: 12px 20px; align-items: center; border-top: 1px solid var(--border);';
            
            const nameSpan = document.createElement('span');
            nameSpan.style.fontWeight = '500';
            nameSpan.textContent = user.username;
            if (user.username === state.user?.username) {
                const badge = document.createElement('span');
                badge.textContent = ' (tú)';
                badge.style.cssText = 'color: var(--accent); font-size: 0.8rem;';
                nameSpan.appendChild(badge);
            }

            const roleSpan = document.createElement('span');
            const roleBadge = document.createElement('span');
            roleBadge.style.cssText = `padding: 3px 10px; border-radius: 12px; font-size: 0.8rem; font-weight: 500; ${
                user.role === 'admin' ? 'background: rgba(239,68,68,0.15); color: #ef4444;' :
                user.role === 'user' ? 'background: rgba(99,102,241,0.15); color: #6366f1;' :
                'background: rgba(148,163,184,0.15); color: #94a3b8;'
            }`;
            roleBadge.textContent = user.role === 'admin' ? 'Admin' : user.role === 'user' ? 'Usuario' : 'Solo lectura';
            roleSpan.appendChild(roleBadge);

            const createdSpan = document.createElement('span');
            createdSpan.style.cssText = 'font-size: 0.85rem; color: var(--text-dim);';
            createdSpan.textContent = user.createdAt ? new Date(user.createdAt).toLocaleDateString('es-ES') : '—';

            const lastLoginSpan = document.createElement('span');
            lastLoginSpan.style.cssText = 'font-size: 0.85rem; color: var(--text-dim);';
            lastLoginSpan.textContent = user.lastLogin ? new Date(user.lastLogin).toLocaleString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';

            const actionsDiv = document.createElement('div');
            actionsDiv.style.cssText = 'display: flex; gap: 6px;';
            if (user.username !== state.user?.username) {
                const delBtn = document.createElement('button');
                delBtn.textContent = '🗑';
                delBtn.style.cssText = 'background: none; border: none; cursor: pointer; font-size: 1rem; opacity: 0.5;';
                delBtn.addEventListener('mouseenter', () => delBtn.style.opacity = '1');
                delBtn.addEventListener('mouseleave', () => delBtn.style.opacity = '0.5');
                delBtn.addEventListener('click', () => deleteUser(user.username));
                actionsDiv.appendChild(delBtn);
            }

            row.appendChild(nameSpan);
            row.appendChild(roleSpan);
            row.appendChild(createdSpan);
            row.appendChild(lastLoginSpan);
            row.appendChild(actionsDiv);
            usersList.appendChild(row);
        });
    } catch (e) {
        usersList.innerHTML = '<div style="padding: 20px; color: var(--text-dim);">Error cargando usuarios</div>';
    }
}

function showUserForm(editUser = null) {
    const existing = document.getElementById('user-form-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'user-form-modal';
    modal.className = 'modal active';
    modal.style.cssText = 'display: flex; position: fixed; inset: 0; z-index: 1000; align-items: center; justify-content: center; background: rgba(0,0,0,0.5);';

    modal.innerHTML = `
        <div class="glass-card modal-content" style="max-width: 450px; width: 90%;">
            <header class="modal-header" style="display: flex; justify-content: space-between; align-items: center;">
                <h3>${editUser ? 'Editar Usuario' : 'Nuevo Usuario'}</h3>
                <button class="btn-close" id="close-user-form">&times;</button>
            </header>
            <form id="user-create-form" style="display: flex; flex-direction: column; gap: 15px; margin-top: 15px;">
                <div class="input-group">
                    <input type="text" id="uf-username" required placeholder=" " value="${editUser?.username || ''}" ${editUser ? 'readonly' : ''}>
                    <label>Usuario</label>
                </div>
                <div class="input-group">
                    <input type="password" id="uf-password" ${editUser ? '' : 'required'} placeholder=" ">
                    <label>${editUser ? 'Nueva contraseña (dejar vacía para mantener)' : 'Contraseña'}</label>
                </div>
                <div class="input-group">
                    <select id="uf-role" style="padding: 12px; border-radius: 8px; border: 1px solid var(--border); background: var(--bg-card); color: var(--text); width: 100%;">
                        <option value="admin" ${editUser?.role === 'admin' ? 'selected' : ''}>Administrador</option>
                        <option value="user" ${(!editUser || editUser?.role === 'user') ? 'selected' : ''}>Usuario</option>
                        <option value="readonly" ${editUser?.role === 'readonly' ? 'selected' : ''}>Solo Lectura</option>
                    </select>
                </div>
                <button type="submit" class="btn-primary">${editUser ? 'Guardar Cambios' : 'Crear Usuario'}</button>
            </form>
        </div>
    `;

    document.body.appendChild(modal);
    document.getElementById('close-user-form').addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });

    document.getElementById('user-create-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = document.getElementById('uf-username').value.trim();
        const password = document.getElementById('uf-password').value;
        const role = document.getElementById('uf-role').value;

        try {
            const url = editUser ? `${API_BASE}/users/${encodeURIComponent(username)}` : `${API_BASE}/users`;
            const method = editUser ? 'PUT' : 'POST';
            const body = editUser ? { role, ...(password ? { password } : {}) } : { username, password, role };

            const res = await authFetch(url, { method, body: JSON.stringify(body) });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error(data.error || 'Failed');
            }
            modal.remove();
            await loadUsers();
        } catch (err) {
            alert('Error: ' + err.message);
        }
    });
}

async function deleteUser(username) {
    const confirmed = await showConfirmModal('Eliminar usuario', `¿Eliminar usuario "${username}"?`);
    if (!confirmed) return;
    try {
        const res = await authFetch(`${API_BASE}/users/${encodeURIComponent(username)}`, { method: 'DELETE' });
        if (!res.ok) throw new Error('Failed');
        await loadUsers();
    } catch (e) {
        alert('Error al eliminar usuario');
    }
}

async function load2FAStatus() {
    const content = document.getElementById('tfa-content');
    if (!content) return;

    try {
        const res = await authFetch(`${API_BASE}/totp/status`);
        if (!res.ok) throw new Error('Failed');
        const data = await res.json();

        if (data.enabled) {
            content.innerHTML = `
                <div style="display: flex; align-items: center; gap: 15px;">
                    <span style="font-size: 2rem;">✅</span>
                    <div>
                        <p style="font-weight: 600; color: #10b981;">2FA Activado</p>
                        <p style="color: var(--text-dim); font-size: 0.9rem;">Tu cuenta está protegida con autenticación de dos factores.</p>
                    </div>
                    <button class="btn-primary btn-sm" style="margin-left: auto; background: #ef4444;" id="disable-2fa-btn">Desactivar</button>
                </div>
            `;
            document.getElementById('disable-2fa-btn').addEventListener('click', disable2FA);
        } else {
            content.innerHTML = `
                <div style="display: flex; align-items: center; gap: 15px;">
                    <span style="font-size: 2rem;">🔓</span>
                    <div>
                        <p style="font-weight: 600;">2FA Desactivado</p>
                        <p style="color: var(--text-dim); font-size: 0.9rem;">Protege tu cuenta con una app de autenticación (Google Authenticator, Authy, etc.)</p>
                    </div>
                    <button class="btn-primary btn-sm" id="enable-2fa-btn" style="margin-left: auto;">Activar 2FA</button>
                </div>
            `;
            document.getElementById('enable-2fa-btn').addEventListener('click', setup2FA);
        }
    } catch (e) {
        content.innerHTML = '<p style="color: var(--text-dim);">No se pudo cargar el estado de 2FA</p>';
    }
}

async function setup2FA() {
    const content = document.getElementById('tfa-content');
    if (!content) return;

    try {
        const res = await authFetch(`${API_BASE}/totp/setup`, { method: 'POST' });
        if (!res.ok) throw new Error('Failed');
        const data = await res.json();

        content.innerHTML = `
            <div style="text-align: center; max-width: 400px; margin: 0 auto;">
                <p style="margin-bottom: 15px;">Escanea este código QR con tu app de autenticación:</p>
                <div style="background: var(--bg-card); padding: 20px; border-radius: 12px; display: inline-block; margin-bottom: 15px; border: 1px solid var(--border);">
                    <p style="font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 10px;">Introduce esta clave manualmente en tu app de autenticaci\u00f3n:</p>
                    <code id="totp-secret-display" style="display: block; background: var(--bg-hover); padding: 12px 16px; border-radius: 8px; font-size: 1.1rem; letter-spacing: 2px; word-break: break-all; user-select: all; cursor: text; color: var(--primary); font-weight: 600;">${escapeHtml(data.secret)}</code>
                    <button onclick="navigator.clipboard.writeText(document.getElementById('totp-secret-display').textContent).then(() => this.textContent = '\u2713 Copiado').catch(() => {})" style="margin-top: 10px; padding: 6px 16px; border-radius: 6px; border: 1px solid var(--border); background: var(--bg-hover); color: var(--text); cursor: pointer; font-size: 0.85rem;">Copiar clave</button>
                </div>
                <p style="font-size: 0.8rem; color: var(--text-dim); word-break: break-all; margin-bottom: 20px;">Account: ${escapeHtml(data.uri ? new URL(data.uri).pathname.replace(/^\\/\\/totp\\//, '') : '')}</p>
                <div style="display: flex; gap: 10px; justify-content: center; align-items: center;">
                    <input type="text" id="totp-verify-code" placeholder="Código de 6 dígitos" maxlength="6" style="padding: 12px; border-radius: 8px; border: 1px solid var(--border); background: var(--bg-card); color: var(--text); width: 160px; text-align: center; font-size: 1.2rem; letter-spacing: 4px;">
                    <button class="btn-primary" id="verify-totp-btn">Verificar</button>
                </div>
            </div>
        `;

        document.getElementById('verify-totp-btn').addEventListener('click', async () => {
            const token = document.getElementById('totp-verify-code').value.trim();
            if (token.length !== 6) { alert('Introduce un código de 6 dígitos'); return; }
            try {
                const vRes = await authFetch(`${API_BASE}/totp/verify`, {
                    method: 'POST',
                    body: JSON.stringify({ token, secret: data.secret })
                });
                if (!vRes.ok) { alert('Código incorrecto. Inténtalo de nuevo.'); return; }
                await load2FAStatus();
            } catch (err) {
                alert('Error al verificar');
            }
        });
    } catch (e) {
        alert('Error al configurar 2FA');
    }
}

async function disable2FA() {
    const password = prompt('Introduce tu contraseña para desactivar 2FA:');
    if (!password) return;
    try {
        const res = await authFetch(`${API_BASE}/totp/disable`, {
            method: 'DELETE',
            body: JSON.stringify({ password })
        });
        if (!res.ok) { alert('Contraseña incorrecta'); return; }
        await load2FAStatus();
    } catch (e) {
        alert('Error al desactivar 2FA');
    }
}

// =============================================================================
// BACKUP & SCHEDULER VIEW
// =============================================================================

async function renderBackupView() {
    const container = document.createElement('div');
    container.style.cssText = 'display: contents;';

    // === Backup Jobs Card ===
    const backupCard = document.createElement('div');
    backupCard.className = 'glass-card';
    backupCard.style.cssText = 'grid-column: 1 / -1;';

    const bHeader = document.createElement('div');
    bHeader.style.cssText = 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;';
    const bTitle = document.createElement('h3');
    bTitle.textContent = '💾 Trabajos de Backup';
    const addJobBtn = document.createElement('button');
    addJobBtn.className = 'btn-primary btn-sm';
    addJobBtn.textContent = '+ Nuevo Backup';
    addJobBtn.addEventListener('click', () => showBackupJobForm());
    bHeader.appendChild(bTitle);
    bHeader.appendChild(addJobBtn);
    backupCard.appendChild(bHeader);

    const jobsList = document.createElement('div');
    jobsList.id = 'backup-jobs-list';
    backupCard.appendChild(jobsList);
    container.appendChild(backupCard);

    // === Task Scheduler Card ===
    const schedCard = document.createElement('div');
    schedCard.className = 'glass-card';
    schedCard.style.cssText = 'grid-column: 1 / -1;';

    const sHeader = document.createElement('div');
    sHeader.style.cssText = 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;';
    const sTitle = document.createElement('h3');
    sTitle.textContent = '⏰ Programador de Tareas';
    const addTaskBtn = document.createElement('button');
    addTaskBtn.className = 'btn-primary btn-sm';
    addTaskBtn.textContent = '+ Nueva Tarea';
    addTaskBtn.addEventListener('click', () => showTaskForm());
    sHeader.appendChild(sTitle);
    sHeader.appendChild(addTaskBtn);
    schedCard.appendChild(sHeader);

    const tasksList = document.createElement('div');
    tasksList.id = 'scheduler-tasks-list';
    schedCard.appendChild(tasksList);
    container.appendChild(schedCard);

    dashboardContent.appendChild(container);
    await loadBackupJobs();
    await loadSchedulerTasks();
}

async function loadBackupJobs() {
    const list = document.getElementById('backup-jobs-list');
    if (!list) return;
    list.innerHTML = '<div style="padding: 20px; color: var(--text-dim);">Cargando...</div>';

    try {
        const res = await authFetch(`${API_BASE}/backup/jobs`);
        if (!res.ok) throw new Error('Failed');
        const data = await res.json();
        const jobs = data.jobs || data || [];

        if (!jobs || jobs.length === 0) {
            list.innerHTML = '<div style="padding: 30px; text-align: center; color: var(--text-dim);">No hay trabajos de backup configurados</div>';
            return;
        }

        list.innerHTML = '';
        jobs.forEach(job => {
            const card = document.createElement('div');
            card.style.cssText = 'display: flex; align-items: center; gap: 15px; padding: 15px; border: 1px solid var(--border); border-radius: 10px; margin-bottom: 10px;';

            const statusDot = document.createElement('span');
            statusDot.style.cssText = `width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; background: ${
                job.lastStatus === 'running' ? '#f59e0b' : job.lastStatus === 'success' ? '#10b981' : job.lastStatus === 'failed' ? '#ef4444' : '#94a3b8'
            };`;

            const info = document.createElement('div');
            info.style.cssText = 'flex: 1; min-width: 0;';
            info.innerHTML = `
                <div style="font-weight: 600;">${escapeHtml(job.name)}</div>
                <div style="font-size: 0.85rem; color: var(--text-dim);">${escapeHtml(job.type)} • ${escapeHtml(job.source)} → ${escapeHtml(job.destination)}</div>
                <div style="font-size: 0.8rem; color: var(--text-dim);">${job.schedule?.enabled ? '⏰ ' + escapeHtml(job.schedule.cron) : 'Manual'}${job.lastRun ? ' • Última: ' + new Date(job.lastRun).toLocaleString('es-ES') : ''}</div>
            `;

            const actions = document.createElement('div');
            actions.style.cssText = 'display: flex; gap: 6px; flex-shrink: 0;';

            const runBtn = document.createElement('button');
            runBtn.className = 'btn-primary btn-sm';
            runBtn.textContent = '▶ Ejecutar';
            runBtn.style.cssText = 'padding: 5px 12px; font-size: 0.8rem;';
            runBtn.addEventListener('click', () => runBackupJob(job.id));

            const delBtn = document.createElement('button');
            delBtn.className = 'btn-primary btn-sm';
            delBtn.style.cssText = 'padding: 5px 12px; font-size: 0.8rem; background: #ef4444;';
            delBtn.textContent = '🗑';
            delBtn.addEventListener('click', () => deleteBackupJob(job.id));

            actions.appendChild(runBtn);
            actions.appendChild(delBtn);

            card.appendChild(statusDot);
            card.appendChild(info);
            card.appendChild(actions);
            list.appendChild(card);
        });
    } catch (e) {
        list.innerHTML = '<div style="padding: 20px; color: #ef4444;">Error cargando backups</div>';
    }
}

function showBackupJobForm(editJob = null) {
    const existing = document.getElementById('backup-form-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'backup-form-modal';
    modal.className = 'modal active';
    modal.style.cssText = 'display: flex; position: fixed; inset: 0; z-index: 1000; align-items: center; justify-content: center; background: rgba(0,0,0,0.5);';

    modal.innerHTML = `
        <div class="glass-card modal-content" style="max-width: 500px; width: 90%;">
            <header class="modal-header" style="display: flex; justify-content: space-between; align-items: center;">
                <h3>${editJob ? 'Editar Backup' : 'Nuevo Backup'}</h3>
                <button class="btn-close" id="close-backup-form">&times;</button>
            </header>
            <form id="backup-create-form" style="display: flex; flex-direction: column; gap: 12px; margin-top: 15px;">
                <div class="input-group">
                    <input type="text" id="bj-name" required placeholder=" " value="${editJob?.name || ''}">
                    <label>Nombre</label>
                </div>
                <div class="input-group">
                    <input type="text" id="bj-source" required placeholder=" " value="${editJob?.source || '/mnt/storage'}">
                    <label>Origen</label>
                </div>
                <div class="input-group">
                    <input type="text" id="bj-dest" required placeholder=" " value="${editJob?.destination || '/mnt/backup'}">
                    <label>Destino</label>
                </div>
                <select id="bj-type" style="padding: 12px; border-radius: 8px; border: 1px solid var(--border); background: var(--bg-card); color: var(--text);">
                    <option value="rsync" ${editJob?.type === 'rsync' ? 'selected' : ''}>Rsync (incremental)</option>
                    <option value="tar" ${editJob?.type === 'tar' ? 'selected' : ''}>Tar (comprimido)</option>
                </select>
                <div style="display: flex; gap: 10px; align-items: center;">
                    <input type="checkbox" id="bj-scheduled" ${editJob?.schedule?.enabled ? 'checked' : ''}>
                    <label for="bj-scheduled" style="margin: 0;">Programar</label>
                    <input type="text" id="bj-cron" placeholder="0 2 * * *" value="${editJob?.schedule?.cron || '0 2 * * *'}" style="flex: 1; padding: 8px; border-radius: 8px; border: 1px solid var(--border); background: var(--bg-card); color: var(--text);">
                </div>
                <div class="input-group">
                    <input type="text" id="bj-excludes" placeholder=" " value="${editJob?.excludes?.join(', ') || ''}">
                    <label>Exclusiones (separadas por coma)</label>
                </div>
                <button type="submit" class="btn-primary">${editJob ? 'Guardar' : 'Crear Backup'}</button>
            </form>
        </div>
    `;

    document.body.appendChild(modal);
    document.getElementById('close-backup-form').addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });

    document.getElementById('backup-create-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const body = {
            name: document.getElementById('bj-name').value.trim(),
            source: document.getElementById('bj-source').value.trim(),
            destination: document.getElementById('bj-dest').value.trim(),
            type: document.getElementById('bj-type').value,
            schedule: {
                enabled: document.getElementById('bj-scheduled').checked,
                cron: document.getElementById('bj-cron').value.trim()
            },
            excludes: document.getElementById('bj-excludes').value.split(',').map(s => s.trim()).filter(Boolean)
        };

        try {
            const url = editJob ? `${API_BASE}/backup/jobs/${editJob.id}` : `${API_BASE}/backup/jobs`;
            const method = editJob ? 'PUT' : 'POST';
            const res = await authFetch(url, { method, body: JSON.stringify(body) });
            if (!res.ok) throw new Error('Failed');
            modal.remove();
            await loadBackupJobs();
        } catch (err) {
            alert('Error al guardar backup');
        }
    });
}

async function runBackupJob(id) {
    try {
        const res = await authFetch(`${API_BASE}/backup/jobs/${id}/run`, { method: 'POST' });
        if (!res.ok) throw new Error('Failed');
        alert('Backup iniciado');
        setTimeout(() => loadBackupJobs(), 2000);
    } catch (e) {
        alert('Error al ejecutar backup');
    }
}

async function deleteBackupJob(id) {
    const confirmed = await showConfirmModal('Eliminar backup', '¿Eliminar este trabajo de backup?');
    if (!confirmed) return;
    try {
        await authFetch(`${API_BASE}/backup/jobs/${id}`, { method: 'DELETE' });
        await loadBackupJobs();
    } catch (e) {
        alert('Error al eliminar');
    }
}

// --- Task Scheduler ---

async function loadSchedulerTasks() {
    const list = document.getElementById('scheduler-tasks-list');
    if (!list) return;
    list.innerHTML = '<div style="padding: 20px; color: var(--text-dim);">Cargando...</div>';

    try {
        const res = await authFetch(`${API_BASE}/scheduler/tasks`);
        if (!res.ok) throw new Error('Failed');
        const data = await res.json();
        const tasks = data.tasks || data || [];

        if (!tasks || tasks.length === 0) {
            list.innerHTML = '<div style="padding: 30px; text-align: center; color: var(--text-dim);">No hay tareas programadas</div>';
            return;
        }

        list.innerHTML = '';
        tasks.forEach(task => {
            const row = document.createElement('div');
            row.style.cssText = 'display: flex; align-items: center; gap: 15px; padding: 12px; border: 1px solid var(--border); border-radius: 10px; margin-bottom: 8px;';

            const toggle = document.createElement('input');
            toggle.type = 'checkbox';
            toggle.checked = task.enabled;
            toggle.style.cssText = 'width: 18px; height: 18px; cursor: pointer;';
            toggle.addEventListener('change', () => toggleTask(task.id));

            const info = document.createElement('div');
            info.style.cssText = 'flex: 1; min-width: 0;';
            info.innerHTML = `
                <div style="font-weight: 600;">${escapeHtml(task.name)}</div>
                <div style="font-size: 0.85rem; color: var(--text-dim); font-family: monospace;">${escapeHtml(task.command)}</div>
                <div style="font-size: 0.8rem; color: var(--text-dim);">⏰ ${escapeHtml(task.schedule)}</div>
            `;

            const actions = document.createElement('div');
            actions.style.cssText = 'display: flex; gap: 6px; flex-shrink: 0;';

            const runBtn = document.createElement('button');
            runBtn.className = 'btn-primary btn-sm';
            runBtn.style.cssText = 'padding: 5px 12px; font-size: 0.8rem;';
            runBtn.textContent = '▶';
            runBtn.addEventListener('click', () => runTask(task.id));

            const delBtn = document.createElement('button');
            delBtn.style.cssText = 'padding: 5px 12px; font-size: 0.8rem; background: #ef4444; border: none; color: white; border-radius: 6px; cursor: pointer;';
            delBtn.textContent = '🗑';
            delBtn.addEventListener('click', () => deleteTask(task.id));

            actions.appendChild(runBtn);
            actions.appendChild(delBtn);

            row.appendChild(toggle);
            row.appendChild(info);
            row.appendChild(actions);
            list.appendChild(row);
        });
    } catch (e) {
        list.innerHTML = '<div style="padding: 20px; color: #ef4444;">Error cargando tareas</div>';
    }
}

function showTaskForm() {
    const existing = document.getElementById('task-form-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'task-form-modal';
    modal.className = 'modal active';
    modal.style.cssText = 'display: flex; position: fixed; inset: 0; z-index: 1000; align-items: center; justify-content: center; background: rgba(0,0,0,0.5);';

    modal.innerHTML = `
        <div class="glass-card modal-content" style="max-width: 450px; width: 90%;">
            <header class="modal-header" style="display: flex; justify-content: space-between; align-items: center;">
                <h3>Nueva Tarea Programada</h3>
                <button class="btn-close" id="close-task-form">&times;</button>
            </header>
            <form id="task-create-form" style="display: flex; flex-direction: column; gap: 12px; margin-top: 15px;">
                <div class="input-group">
                    <input type="text" id="tf-name" required placeholder=" ">
                    <label>Nombre</label>
                </div>
                <div class="input-group">
                    <input type="text" id="tf-command" required placeholder=" ">
                    <label>Comando</label>
                </div>
                <div class="input-group">
                    <input type="text" id="tf-schedule" required placeholder=" " value="0 * * * *">
                    <label>Expresión Cron</label>
                </div>
                <div style="font-size: 0.8rem; color: var(--text-dim); padding: 0 4px;">
                    Formato: minuto hora día mes día-semana (ej: <code>0 2 * * *</code> = cada día a las 2:00)
                </div>
                <button type="submit" class="btn-primary">Crear Tarea</button>
            </form>
        </div>
    `;

    document.body.appendChild(modal);
    document.getElementById('close-task-form').addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });

    document.getElementById('task-create-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
            const res = await authFetch(`${API_BASE}/scheduler/tasks`, {
                method: 'POST',
                body: JSON.stringify({
                    name: document.getElementById('tf-name').value.trim(),
                    command: document.getElementById('tf-command').value.trim(),
                    schedule: document.getElementById('tf-schedule').value.trim(),
                    enabled: true
                })
            });
            if (!res.ok) throw new Error('Failed');
            modal.remove();
            await loadSchedulerTasks();
        } catch (err) {
            alert('Error al crear tarea');
        }
    });
}

async function toggleTask(id) {
    try {
        await authFetch(`${API_BASE}/scheduler/tasks/${id}/toggle`, { method: 'POST' });
    } catch (e) { console.error('Toggle task error:', e); }
}

async function runTask(id) {
    try {
        const res = await authFetch(`${API_BASE}/scheduler/tasks/${id}/run`, { method: 'POST' });
        if (!res.ok) throw new Error('Failed');
        const data = await res.json();
        alert(data.output ? `Resultado:\n${data.output.substring(0, 500)}` : 'Tarea ejecutada');
    } catch (e) {
        alert('Error al ejecutar tarea');
    }
}

async function deleteTask(id) {
    const confirmed = await showConfirmModal('Eliminar tarea', '¿Eliminar esta tarea programada?');
    if (!confirmed) return;
    try {
        await authFetch(`${API_BASE}/scheduler/tasks/${id}`, { method: 'DELETE' });
        await loadSchedulerTasks();
    } catch (e) {
        alert('Error al eliminar tarea');
    }
}

// =============================================================================
// LOG VIEWER
// =============================================================================

let currentLogTab = 'system';

async function renderLogsView() {
    const container = document.createElement('div');
    container.style.cssText = 'display: contents;';

    const card = document.createElement('div');
    card.className = 'glass-card';
    card.style.cssText = 'grid-column: 1 / -1;';

    // Tabs
    const tabs = document.createElement('div');
    tabs.style.cssText = 'display: flex; gap: 4px; margin-bottom: 15px; flex-wrap: wrap;';
    
    const logTabs = [
        { id: 'system', label: '🖥️ Sistema', icon: '' },
        { id: 'app', label: '📱 Aplicación', icon: '' },
        { id: 'auth', label: '🔐 Auth', icon: '' },
        { id: 'docker', label: '🐳 Docker', icon: '' },
        { id: 'samba', label: '📂 Samba', icon: '' }
    ];

    logTabs.forEach(tab => {
        const btn = document.createElement('button');
        btn.className = `btn-sm ${tab.id === currentLogTab ? 'btn-primary' : ''}`;
        btn.style.cssText = `padding: 8px 16px; border-radius: 8px; border: 1px solid var(--border); cursor: pointer; font-size: 0.85rem; ${
            tab.id === currentLogTab ? '' : 'background: var(--bg-card); color: var(--text);'
        }`;
        btn.textContent = tab.label;
        btn.addEventListener('click', () => {
            currentLogTab = tab.id;
            renderLogsView();
        });
        tabs.appendChild(btn);
    });

    card.appendChild(tabs);

    // Controls
    const controls = document.createElement('div');
    controls.style.cssText = 'display: flex; gap: 10px; margin-bottom: 15px; align-items: center; flex-wrap: wrap;';

    const linesSelect = document.createElement('select');
    linesSelect.id = 'log-lines';
    linesSelect.style.cssText = 'padding: 8px; border-radius: 8px; border: 1px solid var(--border); background: var(--bg-card); color: var(--text);';
    [50, 100, 200, 500, 1000].forEach(n => {
        const opt = document.createElement('option');
        opt.value = n; opt.textContent = `${n} líneas`;
        if (n === 100) opt.selected = true;
        linesSelect.appendChild(opt);
    });

    const filterInput = document.createElement('input');
    filterInput.type = 'text';
    filterInput.id = 'log-filter';
    filterInput.placeholder = 'Filtrar...';
    filterInput.style.cssText = 'padding: 8px 12px; border-radius: 8px; border: 1px solid var(--border); background: var(--bg-card); color: var(--text); flex: 1; min-width: 150px;';

    const refreshBtn = document.createElement('button');
    refreshBtn.className = 'btn-primary btn-sm';
    refreshBtn.textContent = '🔄 Actualizar';
    refreshBtn.addEventListener('click', () => fetchLogs());

    controls.appendChild(linesSelect);
    controls.appendChild(filterInput);
    controls.appendChild(refreshBtn);
    card.appendChild(controls);

    // Log output
    const logOutput = document.createElement('pre');
    logOutput.id = 'log-output';
    logOutput.style.cssText = 'background: #0d1117; color: #c9d1d9; padding: 15px; border-radius: 8px; overflow: auto; max-height: 60vh; font-family: "JetBrains Mono", "Fira Code", monospace; font-size: 0.8rem; line-height: 1.5; white-space: pre-wrap; word-break: break-all;';
    logOutput.textContent = 'Cargando...';
    card.appendChild(logOutput);

    container.appendChild(card);
    dashboardContent.appendChild(container);

    await fetchLogs();
}

async function fetchLogs() {
    const output = document.getElementById('log-output');
    if (!output) return;
    output.textContent = 'Cargando...';

    const lines = document.getElementById('log-lines')?.value || 100;
    const filter = document.getElementById('log-filter')?.value || '';

    try {
        let url = `${API_BASE}/logs/${currentLogTab}?lines=${lines}`;
        if (filter) url += `&filter=${encodeURIComponent(filter)}`;

        const res = await authFetch(url);
        if (!res.ok) throw new Error('Failed');
        const data = await res.json();

        output.textContent = data.logs || data.content || 'Sin datos';
        output.scrollTop = output.scrollHeight;
    } catch (e) {
        output.textContent = 'Error al cargar logs: ' + e.message;
    }
}

// =============================================================================
// SAMBA SHARES (added to Network view)
// =============================================================================

async function renderSambaSection(container) {
    const section = document.createElement('div');
    section.style.marginTop = '40px';

    const header = document.createElement('div');
    header.style.cssText = 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;';
    
    const title = document.createElement('h3');
    title.textContent = '📂 Carpetas Compartidas (Samba)';
    
    const btnGroup = document.createElement('div');
    btnGroup.style.cssText = 'display: flex; gap: 8px;';
    
    const addBtn = document.createElement('button');
    addBtn.className = 'btn-primary btn-sm';
    addBtn.textContent = '+ Nueva Compartición';
    addBtn.addEventListener('click', () => showSambaForm());

    const restartBtn = document.createElement('button');
    restartBtn.className = 'btn-primary btn-sm';
    restartBtn.style.background = '#f59e0b';
    restartBtn.textContent = '🔄 Reiniciar Samba';
    restartBtn.addEventListener('click', async () => {
        try {
            await authFetch(`${API_BASE}/samba/restart`, { method: 'POST' });
            alert('Samba reiniciado');
        } catch (e) { alert('Error'); }
    });

    btnGroup.appendChild(addBtn);
    btnGroup.appendChild(restartBtn);
    header.appendChild(title);
    header.appendChild(btnGroup);
    section.appendChild(header);

    // Status
    try {
        const statusRes = await authFetch(`${API_BASE}/samba/status`);
        if (statusRes.ok) {
            const status = await statusRes.json();
            const statusBadge = document.createElement('div');
            statusBadge.style.cssText = `display: inline-flex; align-items: center; gap: 6px; padding: 6px 14px; border-radius: 20px; font-size: 0.85rem; margin-bottom: 15px; ${
                status.active ? 'background: rgba(16,185,129,0.15); color: #10b981;' : 'background: rgba(239,68,68,0.15); color: #ef4444;'
            }`;
            statusBadge.textContent = status.running ? `✅ Activo • ${status.connectedCount || 0} conexiones` : '❌ Inactivo';
            section.appendChild(statusBadge);
        }
    } catch (e) {}

    // Shares list
    const sharesGrid = document.createElement('div');
    sharesGrid.id = 'samba-shares-grid';
    sharesGrid.style.cssText = 'display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 12px;';
    section.appendChild(sharesGrid);

    container.appendChild(section);
    await loadSambaShares();
}

async function loadSambaShares() {
    const grid = document.getElementById('samba-shares-grid');
    if (!grid) return;
    grid.innerHTML = '';

    try {
        const res = await authFetch(`${API_BASE}/samba/shares`);
        if (!res.ok) throw new Error('Failed');
        const data = await res.json();
        const shares = data.shares || data || [];

        if (!shares || shares.length === 0) {
            grid.innerHTML = '<div style="padding: 20px; color: var(--text-dim); grid-column: 1 / -1; text-align: center;">No hay comparticiones configuradas</div>';
            return;
        }

        shares.forEach(share => {
            const card = document.createElement('div');
            card.className = 'glass-card';
            card.style.cssText = 'padding: 15px;';

            card.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 10px;">
                    <div>
                        <h4 style="margin: 0;">📂 ${escapeHtml(share.name)}</h4>
                        <span style="font-size: 0.8rem; color: var(--text-dim);">${escapeHtml(share.path)}</span>
                    </div>
                </div>
                <div style="display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px;">
                    ${share.readOnly ? '<span style="font-size: 0.75rem; padding: 2px 8px; border-radius: 10px; background: rgba(245,158,11,0.15); color: #f59e0b;">Solo lectura</span>' : '<span style="font-size: 0.75rem; padding: 2px 8px; border-radius: 10px; background: rgba(16,185,129,0.15); color: #10b981;">Lectura/Escritura</span>'}
                    ${share.guestOk ? '<span style="font-size: 0.75rem; padding: 2px 8px; border-radius: 10px; background: rgba(148,163,184,0.15); color: #94a3b8;">Invitados</span>' : ''}
                </div>
                ${share.comment ? `<p style="font-size: 0.85rem; color: var(--text-dim); margin-top: 8px;">${escapeHtml(share.comment)}</p>` : ''}
            `;

            const delBtn = document.createElement('button');
            delBtn.textContent = '🗑';
            delBtn.style.cssText = 'position: absolute; top: 10px; right: 10px; background: none; border: none; cursor: pointer; opacity: 0.5; font-size: 1rem;';
            delBtn.addEventListener('mouseenter', () => delBtn.style.opacity = '1');
            delBtn.addEventListener('mouseleave', () => delBtn.style.opacity = '0.5');
            delBtn.addEventListener('click', () => deleteSambaShare(share.name));
            card.style.position = 'relative';
            card.appendChild(delBtn);

            grid.appendChild(card);
        });
    } catch (e) {
        grid.innerHTML = '<div style="padding: 20px; color: #ef4444; grid-column: 1 / -1;">Error cargando comparticiones</div>';
    }
}

function showSambaForm() {
    const existing = document.getElementById('samba-form-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'samba-form-modal';
    modal.className = 'modal active';
    modal.style.cssText = 'display: flex; position: fixed; inset: 0; z-index: 1000; align-items: center; justify-content: center; background: rgba(0,0,0,0.5);';

    modal.innerHTML = `
        <div class="glass-card modal-content" style="max-width: 450px; width: 90%;">
            <header class="modal-header" style="display: flex; justify-content: space-between; align-items: center;">
                <h3>Nueva Compartición Samba</h3>
                <button class="btn-close" id="close-samba-form">&times;</button>
            </header>
            <form id="samba-create-form" style="display: flex; flex-direction: column; gap: 12px; margin-top: 15px;">
                <div class="input-group">
                    <input type="text" id="sf-name" required placeholder=" ">
                    <label>Nombre</label>
                </div>
                <div class="input-group">
                    <input type="text" id="sf-path" required placeholder=" " value="/mnt/storage/">
                    <label>Ruta</label>
                </div>
                <div class="input-group">
                    <input type="text" id="sf-comment" placeholder=" ">
                    <label>Comentario</label>
                </div>
                <div style="display: flex; gap: 20px;">
                    <label style="display: flex; align-items: center; gap: 6px; cursor: pointer;">
                        <input type="checkbox" id="sf-readonly"> Solo lectura
                    </label>
                    <label style="display: flex; align-items: center; gap: 6px; cursor: pointer;">
                        <input type="checkbox" id="sf-guest"> Acceso invitados
                    </label>
                </div>
                <button type="submit" class="btn-primary">Crear Compartición</button>
            </form>
        </div>
    `;

    document.body.appendChild(modal);
    document.getElementById('close-samba-form').addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });

    document.getElementById('samba-create-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
            const res = await authFetch(`${API_BASE}/samba/shares`, {
                method: 'POST',
                body: JSON.stringify({
                    name: document.getElementById('sf-name').value.trim(),
                    path: document.getElementById('sf-path').value.trim(),
                    comment: document.getElementById('sf-comment').value.trim(),
                    readOnly: document.getElementById('sf-readonly').checked,
                    guestOk: document.getElementById('sf-guest').checked
                })
            });
            if (!res.ok) throw new Error('Failed');
            modal.remove();
            await loadSambaShares();
        } catch (err) {
            alert('Error al crear compartición');
        }
    });
}

async function deleteSambaShare(name) {
    const confirmed = await showConfirmModal('Eliminar compartición', `¿Eliminar compartición "${name}"?`);
    if (!confirmed) return;
    try {
        await authFetch(`${API_BASE}/samba/shares/${encodeURIComponent(name)}`, { method: 'DELETE' });
        await loadSambaShares();
    } catch (e) {
        alert('Error al eliminar');
    }
}

// =============================================================================
// UPS MONITOR (added to System view)
// =============================================================================

async function renderUPSSection(container) {
    const card = document.createElement('div');
    card.className = 'glass-card';
    card.style.cssText = 'grid-column: 1 / -1;';

    const title = document.createElement('h3');
    title.textContent = '🔋 Monitor UPS';
    title.style.marginBottom = '15px';
    card.appendChild(title);

    const content = document.createElement('div');
    content.id = 'ups-content';
    content.innerHTML = '<p style="color: var(--text-dim);">Cargando estado del UPS...</p>';
    card.appendChild(content);
    container.appendChild(card);

    try {
        const res = await authFetch(`${API_BASE}/ups/status`);
        if (!res.ok) throw new Error('Failed');
        const data = await res.json();

        if (!data.available) {
            content.innerHTML = `
                <div style="display: flex; align-items: center; gap: 12px; padding: 15px; background: var(--bg-hover); border-radius: 8px;">
                    <span style="font-size: 2rem;">🔌</span>
                    <div>
                        <p style="font-weight: 500;">No se detectó UPS</p>
                        <p style="color: var(--text-dim); font-size: 0.9rem;">Instala <code>apcupsd</code> o <code>nut</code> para monitorizar tu UPS.</p>
                    </div>
                </div>
            `;
            return;
        }

        const batteryColor = data.batteryCharge > 50 ? '#10b981' : data.batteryCharge > 20 ? '#f59e0b' : '#ef4444';
        content.innerHTML = `
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px;">
                <div style="padding: 15px; background: var(--bg-hover); border-radius: 10px; text-align: center;">
                    <div style="font-size: 2rem; margin-bottom: 5px;">🔋</div>
                    <div style="font-size: 1.5rem; font-weight: 700; color: ${batteryColor};">${data.batteryCharge || '—'}%</div>
                    <div style="font-size: 0.8rem; color: var(--text-dim);">Batería</div>
                </div>
                <div style="padding: 15px; background: var(--bg-hover); border-radius: 10px; text-align: center;">
                    <div style="font-size: 2rem; margin-bottom: 5px;">⏱️</div>
                    <div style="font-size: 1.5rem; font-weight: 700;">${data.runtime || '—'}</div>
                    <div style="font-size: 0.8rem; color: var(--text-dim);">Autonomía</div>
                </div>
                <div style="padding: 15px; background: var(--bg-hover); border-radius: 10px; text-align: center;">
                    <div style="font-size: 2rem; margin-bottom: 5px;">⚡</div>
                    <div style="font-size: 1.5rem; font-weight: 700;">${data.load || '—'}%</div>
                    <div style="font-size: 0.8rem; color: var(--text-dim);">Carga</div>
                </div>
                <div style="padding: 15px; background: var(--bg-hover); border-radius: 10px; text-align: center;">
                    <div style="font-size: 2rem; margin-bottom: 5px;">🔌</div>
                    <div style="font-size: 1.5rem; font-weight: 700;">${data.inputVoltage || '—'}V</div>
                    <div style="font-size: 0.8rem; color: var(--text-dim);">Voltaje</div>
                </div>
            </div>
            <div style="margin-top: 15px; padding: 12px; background: var(--bg-hover); border-radius: 8px; display: flex; gap: 20px; flex-wrap: wrap; font-size: 0.9rem;">
                <span><strong>Estado:</strong> ${escapeHtml(data.status || 'Unknown')}</span>
                <span><strong>Modelo:</strong> ${escapeHtml(data.model || 'Unknown')}</span>
                <span><strong>Driver:</strong> ${escapeHtml(data.driver || 'Unknown')}</span>
            </div>
        `;
    } catch (e) {
        content.innerHTML = '<p style="color: #ef4444;">Error al cargar estado del UPS</p>';
    }
}

// =============================================================================
// NOTIFICATIONS CONFIG (added to System view)
// =============================================================================

async function renderNotificationsSection(container) {
    const card = document.createElement('div');
    card.className = 'glass-card';
    card.style.cssText = 'grid-column: 1 / -1;';

    const title = document.createElement('h3');
    title.textContent = '🔔 Notificaciones';
    title.style.marginBottom = '20px';
    card.appendChild(title);

    const content = document.createElement('div');
    content.style.cssText = 'display: grid; grid-template-columns: 1fr 1fr; gap: 20px;';

    // Email config
    const emailSection = document.createElement('div');
    emailSection.innerHTML = `
        <h4 style="margin-bottom: 12px;">📧 Email (SMTP)</h4>
        <form id="notif-email-form" style="display: flex; flex-direction: column; gap: 10px;">
            <input type="text" id="ne-host" placeholder="Servidor SMTP" style="padding: 10px; border-radius: 8px; border: 1px solid var(--border); background: var(--bg-card); color: var(--text);">
            <div style="display: flex; gap: 8px;">
                <input type="number" id="ne-port" placeholder="Puerto" value="587" style="padding: 10px; border-radius: 8px; border: 1px solid var(--border); background: var(--bg-card); color: var(--text); width: 100px;">
                <label style="display: flex; align-items: center; gap: 4px;"><input type="checkbox" id="ne-secure"> SSL</label>
            </div>
            <input type="text" id="ne-user" placeholder="Usuario" style="padding: 10px; border-radius: 8px; border: 1px solid var(--border); background: var(--bg-card); color: var(--text);">
            <input type="password" id="ne-pass" placeholder="Contraseña" style="padding: 10px; border-radius: 8px; border: 1px solid var(--border); background: var(--bg-card); color: var(--text);">
            <input type="email" id="ne-from" placeholder="Remitente" style="padding: 10px; border-radius: 8px; border: 1px solid var(--border); background: var(--bg-card); color: var(--text);">
            <input type="email" id="ne-to" placeholder="Destinatario" style="padding: 10px; border-radius: 8px; border: 1px solid var(--border); background: var(--bg-card); color: var(--text);">
            <div style="display: flex; gap: 8px;">
                <button type="submit" class="btn-primary btn-sm">Guardar</button>
                <button type="button" class="btn-primary btn-sm" id="test-email-btn" style="background: #6366f1;">Probar</button>
            </div>
        </form>
    `;

    // Telegram config
    const telegramSection = document.createElement('div');
    telegramSection.innerHTML = `
        <h4 style="margin-bottom: 12px;">📱 Telegram</h4>
        <form id="notif-telegram-form" style="display: flex; flex-direction: column; gap: 10px;">
            <input type="text" id="nt-token" placeholder="Bot Token" style="padding: 10px; border-radius: 8px; border: 1px solid var(--border); background: var(--bg-card); color: var(--text);">
            <input type="text" id="nt-chatid" placeholder="Chat ID" style="padding: 10px; border-radius: 8px; border: 1px solid var(--border); background: var(--bg-card); color: var(--text);">
            <label style="display: flex; align-items: center; gap: 6px;"><input type="checkbox" id="nt-enabled"> Activado</label>
            <div style="display: flex; gap: 8px;">
                <button type="submit" class="btn-primary btn-sm">Guardar</button>
                <button type="button" class="btn-primary btn-sm" id="test-telegram-btn" style="background: #6366f1;">Probar</button>
            </div>
        </form>
    `;

    content.appendChild(emailSection);
    content.appendChild(telegramSection);
    card.appendChild(content);
    container.appendChild(card);

    // Load existing config
    try {
        const res = await authFetch(`${API_BASE}/notifications/config`);
        if (res.ok) {
            const config = await res.json();
            if (config.email) {
                if (config.email.host) document.getElementById('ne-host').value = config.email.host;
                if (config.email.port) document.getElementById('ne-port').value = config.email.port;
                document.getElementById('ne-secure').checked = config.email.secure || false;
                if (config.email.user) document.getElementById('ne-user').value = config.email.user;
                if (config.email.from) document.getElementById('ne-from').value = config.email.from;
                if (config.email.to) document.getElementById('ne-to').value = config.email.to;
            }
            if (config.telegram) {
                if (config.telegram.botToken) document.getElementById('nt-token').value = config.telegram.botToken;
                if (config.telegram.chatId) document.getElementById('nt-chatid').value = config.telegram.chatId;
                document.getElementById('nt-enabled').checked = config.telegram.enabled || false;
            }
        }
    } catch (e) {}

    // Wire up forms
    document.getElementById('notif-email-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
            await authFetch(`${API_BASE}/notifications/config/email`, {
                method: 'POST',
                body: JSON.stringify({
                    host: document.getElementById('ne-host').value,
                    port: parseInt(document.getElementById('ne-port').value) || 587,
                    secure: document.getElementById('ne-secure').checked,
                    user: document.getElementById('ne-user').value,
                    password: document.getElementById('ne-pass').value,
                    from: document.getElementById('ne-from').value,
                    to: document.getElementById('ne-to').value
                })
            });
            alert('Configuración email guardada');
        } catch (e) { alert('Error'); }
    });

    document.getElementById('notif-telegram-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
            await authFetch(`${API_BASE}/notifications/config/telegram`, {
                method: 'POST',
                body: JSON.stringify({
                    botToken: document.getElementById('nt-token').value,
                    chatId: document.getElementById('nt-chatid').value,
                    enabled: document.getElementById('nt-enabled').checked
                })
            });
            alert('Configuración Telegram guardada');
        } catch (e) { alert('Error'); }
    });

    document.getElementById('test-email-btn').addEventListener('click', async () => {
        try {
            const res = await authFetch(`${API_BASE}/notifications/test/email`, { method: 'POST' });
            alert(res.ok ? '¡Email de prueba enviado!' : 'Error al enviar');
        } catch (e) { alert('Error'); }
    });

    document.getElementById('test-telegram-btn').addEventListener('click', async () => {
        try {
            const res = await authFetch(`${API_BASE}/notifications/test/telegram`, { method: 'POST' });
            alert(res.ok ? '¡Mensaje de prueba enviado!' : 'Error al enviar');
        } catch (e) { alert('Error'); }
    });
}

// =============================================================================
// DDNS SECTION (enhanced for Network view)
// =============================================================================

async function renderDDNSSection(container) {
    const section = document.createElement('div');
    section.style.marginTop = '40px';

    const header = document.createElement('div');
    header.style.cssText = 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;';
    
    const title = document.createElement('h3');
    title.textContent = '🌐 DNS Dinámico (DDNS)';
    
    const addBtn = document.createElement('button');
    addBtn.className = 'btn-primary btn-sm';
    addBtn.textContent = '+ Añadir Servicio';
    addBtn.addEventListener('click', () => showDDNSForm());
    
    header.appendChild(title);
    header.appendChild(addBtn);
    section.appendChild(header);

    // Current IP
    const ipDiv = document.createElement('div');
    ipDiv.style.cssText = 'padding: 10px 15px; background: var(--bg-hover); border-radius: 8px; display: inline-flex; gap: 10px; align-items: center; margin-bottom: 15px;';
    ipDiv.innerHTML = `<strong>IP Pública:</strong> <span id="ddns-public-ip">Obteniendo...</span>`;
    section.appendChild(ipDiv);

    const servicesGrid = document.createElement('div');
    servicesGrid.id = 'ddns-services-grid';
    servicesGrid.style.cssText = 'display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 12px;';
    section.appendChild(servicesGrid);

    container.appendChild(section);

    // Fetch public IP
    try {
        const ipRes = await authFetch(`${API_BASE}/ddns/public-ip`);
        if (ipRes.ok) {
            const ipData = await ipRes.json();
            const ipEl = document.getElementById('ddns-public-ip');
            if (ipEl) ipEl.textContent = ipData.ip || 'Desconocida';
        }
    } catch (e) {}

    await loadDDNSServices();
}

async function loadDDNSServices() {
    const grid = document.getElementById('ddns-services-grid');
    if (!grid) return;
    grid.innerHTML = '';

    try {
        const res = await authFetch(`${API_BASE}/ddns/services`);
        if (!res.ok) throw new Error('Failed');
        const data = await res.json();
        const services = data.services || data || [];

        if (!services || services.length === 0) {
            grid.innerHTML = '<div style="padding: 20px; color: var(--text-dim); grid-column: 1 / -1; text-align: center;">No hay servicios DDNS configurados</div>';
            return;
        }

        services.forEach(svc => {
            const card = document.createElement('div');
            card.className = 'glass-card';
            card.style.cssText = 'padding: 15px; position: relative;';

            const providerLogos = { duckdns: '🦆', cloudflare: '☁️', noip: '🔗', dynu: '🌐' };
            card.innerHTML = `
                <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 10px;">
                    <span style="font-size: 1.5rem;">${providerLogos[svc.provider] || '🌐'}</span>
                    <div>
                        <h4 style="margin: 0;">${escapeHtml(svc.domain || svc.hostname || 'Unknown')}</h4>
                        <span style="font-size: 0.8rem; color: var(--text-dim);">${escapeHtml(svc.provider)}</span>
                    </div>
                    <span style="margin-left: auto; padding: 3px 10px; border-radius: 12px; font-size: 0.75rem; ${
                        svc.enabled ? 'background: rgba(16,185,129,0.15); color: #10b981;' : 'background: rgba(148,163,184,0.15); color: #94a3b8;'
                    }">${svc.enabled ? 'Activo' : 'Inactivo'}</span>
                </div>
                ${svc.lastUpdate ? `<div style="font-size: 0.8rem; color: var(--text-dim);">Última actualización: ${new Date(svc.lastUpdate).toLocaleString('es-ES')}</div>` : ''}
                ${svc.lastIP ? `<div style="font-size: 0.8rem; color: var(--text-dim);">IP: ${escapeHtml(svc.lastIP)}</div>` : ''}
            `;

            const btnGroup = document.createElement('div');
            btnGroup.style.cssText = 'display: flex; gap: 6px; margin-top: 10px;';

            const updateBtn = document.createElement('button');
            updateBtn.className = 'btn-primary btn-sm';
            updateBtn.style.cssText = 'padding: 4px 10px; font-size: 0.8rem;';
            updateBtn.textContent = '🔄 Actualizar';
            updateBtn.addEventListener('click', async () => {
                try {
                    const r = await authFetch(`${API_BASE}/ddns/services/${svc.id}/update`, { method: 'POST' });
                    alert(r.ok ? 'IP actualizada' : 'Error');
                    await loadDDNSServices();
                } catch (e) { alert('Error'); }
            });

            const delBtn = document.createElement('button');
            delBtn.style.cssText = 'padding: 4px 10px; font-size: 0.8rem; background: #ef4444; border: none; color: white; border-radius: 6px; cursor: pointer;';
            delBtn.textContent = '🗑';
            delBtn.addEventListener('click', async () => {
                const confirmed = await showConfirmModal('Eliminar DDNS', '¿Eliminar este servicio DDNS?');
                if (!confirmed) return;
                try {
                    await authFetch(`${API_BASE}/ddns/services/${svc.id}`, { method: 'DELETE' });
                    await loadDDNSServices();
                } catch (e) { alert('Error'); }
            });

            btnGroup.appendChild(updateBtn);
            btnGroup.appendChild(delBtn);
            card.appendChild(btnGroup);
            grid.appendChild(card);
        });
    } catch (e) {
        grid.innerHTML = '<div style="padding: 20px; color: #ef4444; grid-column: 1 / -1;">Error cargando servicios DDNS</div>';
    }
}

function showDDNSForm() {
    const existing = document.getElementById('ddns-form-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'ddns-form-modal';
    modal.className = 'modal active';
    modal.style.cssText = 'display: flex; position: fixed; inset: 0; z-index: 1000; align-items: center; justify-content: center; background: rgba(0,0,0,0.5);';

    modal.innerHTML = `
        <div class="glass-card modal-content" style="max-width: 450px; width: 90%;">
            <header class="modal-header" style="display: flex; justify-content: space-between; align-items: center;">
                <h3>Añadir Servicio DDNS</h3>
                <button class="btn-close" id="close-ddns-form">&times;</button>
            </header>
            <form id="ddns-create-form" style="display: flex; flex-direction: column; gap: 12px; margin-top: 15px;">
                <select id="df-provider" style="padding: 12px; border-radius: 8px; border: 1px solid var(--border); background: var(--bg-card); color: var(--text);">
                    <option value="duckdns">🦆 DuckDNS</option>
                    <option value="cloudflare">☁️ Cloudflare</option>
                    <option value="noip">🔗 No-IP</option>
                    <option value="dynu">🌐 Dynu</option>
                </select>
                <div id="ddns-provider-fields"></div>
                <label style="display: flex; align-items: center; gap: 6px;"><input type="checkbox" id="df-enabled" checked> Activado</label>
                <button type="submit" class="btn-primary">Guardar Servicio</button>
            </form>
        </div>
    `;

    document.body.appendChild(modal);
    document.getElementById('close-ddns-form').addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });

    const providerSelect = modal.querySelector('#df-provider');
    const fieldsDiv = modal.querySelector('#ddns-provider-fields');

    function updateProviderFields() {
        const provider = providerSelect.value;
        const fieldDefs = {
            duckdns: [{ id: 'df-domain', label: 'Subdominio (.duckdns.org)', type: 'text' }, { id: 'df-token', label: 'Token', type: 'text' }],
            cloudflare: [{ id: 'df-domain', label: 'Dominio', type: 'text' }, { id: 'df-zoneid', label: 'Zone ID', type: 'text' }, { id: 'df-apitoken', label: 'API Token', type: 'password' }],
            noip: [{ id: 'df-hostname', label: 'Hostname', type: 'text' }, { id: 'df-username', label: 'Usuario', type: 'text' }, { id: 'df-password', label: 'Contraseña', type: 'password' }],
            dynu: [{ id: 'df-hostname', label: 'Hostname', type: 'text' }, { id: 'df-apikey', label: 'API Key', type: 'password' }]
        };
        fieldsDiv.innerHTML = '';
        (fieldDefs[provider] || []).forEach(f => {
            fieldsDiv.innerHTML += `<div class="input-group"><input type="${f.type}" id="${f.id}" required placeholder=" "><label>${f.label}</label></div>`;
        });
    }
    providerSelect.addEventListener('change', updateProviderFields);
    updateProviderFields();

    document.getElementById('ddns-create-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const provider = providerSelect.value;
        const body = { provider, enabled: document.getElementById('df-enabled').checked };
        
        if (provider === 'duckdns') {
            body.domain = document.getElementById('df-domain').value.trim();
            body.token = document.getElementById('df-token').value.trim();
        } else if (provider === 'cloudflare') {
            body.domain = document.getElementById('df-domain').value.trim();
            body.zoneId = document.getElementById('df-zoneid').value.trim();
            body.apiToken = document.getElementById('df-apitoken').value.trim();
        } else if (provider === 'noip') {
            body.hostname = document.getElementById('df-hostname').value.trim();
            body.username = document.getElementById('df-username').value.trim();
            body.password = document.getElementById('df-password').value.trim();
        } else if (provider === 'dynu') {
            body.hostname = document.getElementById('df-hostname').value.trim();
            body.apiKey = document.getElementById('df-apikey').value.trim();
        }

        try {
            const res = await authFetch(`${API_BASE}/ddns/services`, { method: 'POST', body: JSON.stringify(body) });
            if (!res.ok) throw new Error('Failed');
            modal.remove();
            await loadDDNSServices();
        } catch (err) {
            alert('Error al guardar servicio DDNS');
        }
    });
}

// =============================================================================
// INITIALIZATION
// =============================================================================

// Initialize i18n first, then auth
async function init() {
    await initI18n();
    initAuth();
}

// Listen for language changes to re-render current view
window.addEventListener('i18n-updated', () => {
    if (state.isAuthenticated && state.currentView) {
        // Update view title
        const viewTitleEl = document.getElementById('view-title');
        if (viewTitleEl && viewsMap[state.currentView]) {
            viewTitleEl.textContent = viewsMap[state.currentView];
        }
        // Re-apply translations
        applyTranslations();
    }
});

// ══════════════════════════════════════════════════════════════
// ACTIVE BACKUP FOR BUSINESS
// ══════════════════════════════════════════════════════════════

let abDevices = [];
let abSelectedDevice = null;
let abBrowseVersion = null;
let abBrowsePath = '/';

async function renderActiveBackupView() {
    const container = document.createElement('div');
    container.style.cssText = 'display: contents;';

    // Header card
    const headerCard = document.createElement('div');
    headerCard.className = 'glass-card';
    headerCard.style.cssText = 'grid-column: 1 / -1;';

    const header = document.createElement('div');
    header.style.cssText = 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;';

    const title = document.createElement('h3');
    title.textContent = '🖥️ Active Backup';

    const addBtn = document.createElement('button');
    addBtn.className = 'btn-primary btn-sm';
    addBtn.textContent = '+ Añadir Dispositivo';
    addBtn.addEventListener('click', () => showAddDeviceForm());

    header.appendChild(title);
    header.appendChild(addBtn);
    headerCard.appendChild(header);

    // Pending agents section
    const pendingDiv = document.createElement('div');
    pendingDiv.id = 'ab-pending-agents';
    pendingDiv.style.cssText = 'margin-bottom: 20px;';
    headerCard.appendChild(pendingDiv);

    // Devices grid
    const grid = document.createElement('div');
    grid.id = 'ab-devices-grid';
    grid.style.cssText = 'display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 16px;';
    grid.innerHTML = '<div style="padding: 20px; color: var(--text-dim);">Cargando dispositivos...</div>';
    headerCard.appendChild(grid);
    container.appendChild(headerCard);

    // Detail panel (shown when a device is selected)
    const detailCard = document.createElement('div');
    detailCard.className = 'glass-card';
    detailCard.style.cssText = 'grid-column: 1 / -1; display: none;';
    detailCard.id = 'ab-detail-panel';
    container.appendChild(detailCard);

    // Recovery USB section
    const recoveryCard = document.createElement('div');
    recoveryCard.className = 'glass-card';
    recoveryCard.style.cssText = 'grid-column: 1 / -1;';
    recoveryCard.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
            <div>
                <h3 style="margin-bottom: 4px;">🔧 USB de Recuperación</h3>
                <p style="font-size: 0.85rem; color: var(--text-dim);">Crea un USB bootable para restaurar backups sin necesitar sistema operativo</p>
            </div>
        </div>
        <div id="ab-recovery-status" style="padding: 15px; background: var(--bg-hover); border-radius: 8px; border: 1px solid var(--border);">
            <p style="color: var(--text-dim);">Cargando...</p>
        </div>
    `;
    container.appendChild(recoveryCard);

    dashboardContent.appendChild(container);
    await loadABPendingAgents();
    await loadABDevices();
    await loadRecoveryStatus();
}

async function loadABPendingAgents() {
    const container = document.getElementById('ab-pending-agents');
    if (!container) return;

    try {
        const res = await authFetch(`${API_BASE}/active-backup/pending`);
        if (!res.ok) throw new Error('Failed');
        const data = await res.json();
        const pending = data.pending || [];

        if (pending.length === 0) {
            container.innerHTML = '';
            container.style.display = 'none';
            return;
        }

        container.style.display = 'block';
        container.innerHTML = `
            <div style="padding: 16px; background: linear-gradient(135deg, rgba(255,193,7,0.1), rgba(255,152,0,0.05)); border: 1px solid rgba(255,193,7,0.3); border-radius: 12px;">
                <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 12px;">
                    <span style="font-size: 1.3rem;">🔔</span>
                    <h4 style="margin: 0; color: #ffc107;">Dispositivos pendientes de aprobación</h4>
                </div>
                <div id="ab-pending-list" style="display: flex; flex-direction: column; gap: 10px;"></div>
            </div>`;

        const list = document.getElementById('ab-pending-list');
        for (const agent of pending) {
            const osIcon = agent.os === 'win32' ? '🪟' : agent.os === 'darwin' ? '🍎' : '🐧';
            const osName = agent.os === 'win32' ? 'Windows' : agent.os === 'darwin' ? 'macOS' : agent.os;
            const timeAgo = new Date(agent.registeredAt).toLocaleString('es-ES');

            const row = document.createElement('div');
            row.style.cssText = 'display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; background: var(--bg-hover); border-radius: 8px; border: 1px solid var(--border);';
            row.innerHTML = `
                <div style="flex: 1;">
                    <div style="font-weight: 600; font-size: 1rem;">${osIcon} ${agent.hostname}</div>
                    <div style="font-size: 0.82rem; color: var(--text-dim); margin-top: 2px;">${agent.ip} · ${osName} · Registrado: ${timeAgo}</div>
                </div>
                <div style="display: flex; gap: 8px;" id="ab-pending-actions-${agent.id}">
                    <button class="btn-primary btn-sm" style="padding: 6px 14px;" id="ab-approve-${agent.id}">✓ Aprobar</button>
                    <button class="btn-sm" style="padding: 6px 14px; background: var(--bg-hover); color: var(--text-dim); border: 1px solid var(--border); border-radius: 6px; cursor: pointer;" id="ab-reject-${agent.id}">✗ Rechazar</button>
                </div>`;
            list.appendChild(row);

            document.getElementById(`ab-approve-${agent.id}`).addEventListener('click', () => showApproveDialog(agent));
            document.getElementById(`ab-reject-${agent.id}`).addEventListener('click', () => rejectPendingAgent(agent));
        }
    } catch (e) {
        container.innerHTML = '';
        container.style.display = 'none';
    }
}

function showApproveDialog(agent) {
    const osIcon = agent.os === 'win32' ? '🪟' : agent.os === 'darwin' ? '🍎' : '🐧';

    // Create modal
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position: fixed; inset: 0; background: rgba(0,0,0,0.7); z-index: 1000; display: flex; align-items: center; justify-content: center; backdrop-filter: blur(4px);';
    overlay.id = 'ab-approve-overlay';

    // Auto-detect platform from agent OS
    let defaultPlatform = 'linux';
    if (agent.os === 'win32') defaultPlatform = 'windows';
    else if (agent.os === 'darwin') defaultPlatform = 'mac';

    overlay.innerHTML = `
        <div style="background: var(--bg-card, #1a1a2e); border-radius: 16px; padding: 32px; max-width: 480px; width: 90%; box-shadow: 0 20px 60px rgba(0,0,0,0.5); border: 1px solid var(--border); color: #f5f5f5;">
            <h3 style="margin: 0 0 4px 0; color: #f5f5f5;">${osIcon} Aprobar: ${agent.hostname}</h3>
            <p style="color: #a3a3a3; font-size: 0.85rem; margin-bottom: 24px;">${agent.ip}</p>
            
            <div style="display: flex; flex-direction: column; gap: 16px;">
                <div>
                    <label style="font-size: 0.85rem; font-weight: 500; display: block; margin-bottom: 6px; color: #f5f5f5;">Plataforma</label>
                    <select id="ab-approve-platform" style="width: 100%; padding: 10px 12px; background: #2a2a3e; border: 1px solid rgba(255,255,255,0.15); border-radius: 8px; color: #f5f5f5; font-size: 0.95rem;">
                        <option value="windows" ${defaultPlatform === 'windows' ? 'selected' : ''}>🪟 Windows</option>
                        <option value="linux" ${defaultPlatform === 'linux' ? 'selected' : ''}>🐧 Linux</option>
                        <option value="mac" ${defaultPlatform === 'mac' ? 'selected' : ''}>🍎 Mac</option>
                        <option value="vm">🖥️ Máquina virtual</option>
                    </select>
                </div>
                <div>
                    <label style="font-size: 0.85rem; font-weight: 500; display: block; margin-bottom: 6px; color: #f5f5f5;">Tipo de backup</label>
                    <select id="ab-approve-type" style="width: 100%; padding: 10px 12px; background: #2a2a3e; border: 1px solid rgba(255,255,255,0.15); border-radius: 8px; color: #f5f5f5; font-size: 0.95rem;">
                        <option value="image">💽 Imagen completa</option>
                        <option value="files">📁 Solo archivos</option>
                    </select>
                </div>
                <div>
                    <label style="font-size: 0.85rem; font-weight: 500; display: block; margin-bottom: 6px; color: #f5f5f5;">Programación</label>
                    <select id="ab-approve-schedule" style="width: 100%; padding: 10px 12px; background: #2a2a3e; border: 1px solid rgba(255,255,255,0.15); border-radius: 8px; color: #f5f5f5; font-size: 0.95rem;">
                        <option value="0 3 * * *">Diario a las 3:00 AM</option>
                        <option value="0 2 * * *">Diario a las 2:00 AM</option>
                        <option value="0 12 * * *">Diario a las 12:00</option>
                        <option value="0 3 * * 1">Semanal (Lunes 3:00 AM)</option>
                        <option value="0 3 * * 1,4">Lun/Jue a las 3:00 AM</option>
                        <option value="0 3 1 * *">Mensual (Día 1 a las 3:00 AM)</option>
                    </select>
                </div>
                <div>
                    <label style="font-size: 0.85rem; font-weight: 500; display: block; margin-bottom: 6px; color: #f5f5f5;">Copias a conservar</label>
                    <select id="ab-approve-retention" style="width: 100%; padding: 10px 12px; background: #2a2a3e; border: 1px solid rgba(255,255,255,0.15); border-radius: 8px; color: #f5f5f5; font-size: 0.95rem;">
                        <option value="2">2 copias</option>
                        <option value="3" selected>3 copias</option>
                        <option value="5">5 copias</option>
                        <option value="7">7 copias</option>
                        <option value="10">10 copias</option>
                    </select>
                </div>
            </div>

            <div style="display: flex; gap: 10px; margin-top: 28px; justify-content: flex-end;">
                <button id="ab-approve-cancel" class="btn-sm" style="padding: 8px 20px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); border-radius: 8px; color: #f5f5f5; cursor: pointer;">Cancelar</button>
                <button id="ab-approve-confirm" class="btn-primary btn-sm" style="padding: 8px 20px; background: #6366f1; color: #fff;">✓ Aprobar</button>
            </div>
        </div>`;

    document.body.appendChild(overlay);

    document.getElementById('ab-approve-cancel').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

    document.getElementById('ab-approve-confirm').addEventListener('click', async () => {
        const platform = document.getElementById('ab-approve-platform').value;
        const backupType = document.getElementById('ab-approve-type').value;
        const schedule = document.getElementById('ab-approve-schedule').value;
        const retention = parseInt(document.getElementById('ab-approve-retention').value);

        const btn = document.getElementById('ab-approve-confirm');
        btn.disabled = true;
        btn.textContent = 'Aprobando...';

        try {
            const res = await authFetch(`${API_BASE}/active-backup/pending/${agent.id}/approve`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ platform, backupType, schedule, retention }),
            });
            const data = await res.json();
            if (data.success) {
                overlay.remove();
                await loadABPendingAgents();
                await loadABDevices();
            } else {
                alert('Error: ' + (data.error || 'No se pudo aprobar'));
                btn.disabled = false;
                btn.textContent = '✓ Aprobar';
            }
        } catch (e) {
            alert('Error de conexión');
            btn.disabled = false;
            btn.textContent = '✓ Aprobar';
        }
    });
}

async function rejectPendingAgent(agent) {
    const confirmed = await showConfirmModal('Rechazar agente', `¿Rechazar "${agent.hostname}" (${agent.ip})?`);
    if (!confirmed) return;
    try {
        const res = await authFetch(`${API_BASE}/active-backup/pending/${agent.id}/reject`, { method: 'POST' });
        const data = await res.json();
        if (data.success) {
            await loadABPendingAgents();
        } else {
            alert('Error: ' + (data.error || 'No se pudo rechazar'));
        }
    } catch (e) {
        alert('Error de conexión');
    }
}

async function loadABDevices() {
    const grid = document.getElementById('ab-devices-grid');
    if (!grid) return;

    try {
        const res = await authFetch(`${API_BASE}/active-backup/devices`);
        if (!res.ok) throw new Error('Failed');
        const data = await res.json();
        abDevices = data.devices || [];

        if (abDevices.length === 0) {
            grid.innerHTML = `
                <div style="grid-column: 1 / -1; text-align: center; padding: 40px; color: var(--text-dim);">
                    <div style="font-size: 3rem; margin-bottom: 15px;">🖥️</div>
                    <p style="font-size: 1.1rem; margin-bottom: 8px;">No hay dispositivos registrados</p>
                    <p>Añade un PC o servidor para hacer backup automático al NAS</p>
                </div>`;
            return;
        }

        grid.innerHTML = '';
        abDevices.forEach(device => {
            const card = document.createElement('div');
            card.style.cssText = 'background: var(--bg-hover); border-radius: 12px; padding: 20px; border: 1px solid var(--border); cursor: pointer; transition: all 0.2s;';
            card.addEventListener('mouseenter', () => card.style.borderColor = 'var(--accent)');
            card.addEventListener('mouseleave', () => card.style.borderColor = 'var(--border)');

            const isOk = device.lastResult === 'success';
            const isFail = device.lastResult === 'failed';
            const isImage = device.backupType === 'image';
            const statusColor = isOk ? '#10b981' : isFail ? '#ef4444' : '#94a3b8';
            const statusText = isOk ? 'OK' : isFail ? 'Error' : 'Pendiente';
            const typeIcon = isImage ? '💽' : '📁';
            const typeLabel = isImage ? 'Imagen' : 'Archivos';
            const osIcon = device.os === 'windows' ? '🪟' : '🐧';
            const subtitle = isImage
                ? `${escapeHtml(device.ip)} · ${osIcon} ${typeLabel}`
                : `${escapeHtml(device.ip)} · ${escapeHtml(device.sshUser)}`;

            const lastBackup = device.lastBackup ? new Date(device.lastBackup).toLocaleString('es-ES', {
                day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'
            }) : 'Nunca';

            const sizeStr = formatABSize(device.totalSize || 0);
            const countLabel = isImage ? 'imágenes' : 'versiones';

            card.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px;">
                    <div>
                        <div style="font-weight: 600; font-size: 1.05rem;">${typeIcon} ${escapeHtml(device.name)}</div>
                        <div style="color: var(--text-dim); font-size: 0.85rem; margin-top: 2px;">${subtitle}</div>
                    </div>
                    <div style="display: flex; align-items: center; gap: 6px;">
                        <span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: ${statusColor};"></span>
                        <span style="font-size: 0.8rem; color: ${statusColor}; font-weight: 500;">${statusText}</span>
                    </div>
                </div>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; font-size: 0.85rem; color: var(--text-dim);">
                    <div>📅 ${lastBackup}</div>
                    <div>📦 ${device.backupCount || 0} ${countLabel}</div>
                    <div>💾 ${sizeStr}</div>
                    <div>🔄 ${device.enabled ? escapeHtml(device.schedule) : 'Desactivado'}</div>
                </div>
            `;

            // Action buttons
            const actions = document.createElement('div');
            actions.style.cssText = 'display: flex; gap: 8px; margin-top: 15px; border-top: 1px solid var(--border); padding-top: 12px;';

            if (device.agentToken) {
                // Agent-managed device: trigger backup via agent
                const triggerBtn = document.createElement('button');
                triggerBtn.className = 'btn-primary btn-sm';
                triggerBtn.style.cssText = 'flex: 1; padding: 8px;';
                triggerBtn.textContent = '▶ Backup';
                triggerBtn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    triggerBtn.textContent = '⏳ Enviado...';
                    triggerBtn.disabled = true;
                    try {
                        const res = await authFetch(`${API_BASE}/active-backup/devices/${device.id}/trigger`, { method: 'POST' });
                        const data = await res.json();
                        if (data.success) {
                            triggerBtn.textContent = '✓ Pendiente';
                            setTimeout(() => { triggerBtn.textContent = '▶ Backup'; triggerBtn.disabled = false; }, 5000);
                        } else {
                            alert(data.error || 'Error');
                            triggerBtn.textContent = '▶ Backup';
                            triggerBtn.disabled = false;
                        }
                    } catch(err) {
                        alert('Error de conexión');
                        triggerBtn.textContent = '▶ Backup';
                        triggerBtn.disabled = false;
                    }
                });
                actions.appendChild(triggerBtn);
            } else if (!isImage) {
                const backupBtn = document.createElement('button');
                backupBtn.className = 'btn-primary btn-sm';
                backupBtn.style.cssText = 'flex: 1; padding: 8px;';
                backupBtn.textContent = '▶ Backup';
                backupBtn.addEventListener('click', (e) => { e.stopPropagation(); triggerABBackup(device.id, backupBtn); });
                actions.appendChild(backupBtn);
            } else {
                const instrBtn = document.createElement('button');
                instrBtn.className = 'btn-primary btn-sm';
                instrBtn.style.cssText = 'flex: 1; padding: 8px;';
                instrBtn.textContent = '📋 Instrucciones';
                instrBtn.addEventListener('click', (e) => { e.stopPropagation(); showABInstructions(device); });
                actions.appendChild(instrBtn);
            }

            const browseBtn = document.createElement('button');
            browseBtn.className = 'btn-primary btn-sm';
            browseBtn.style.cssText = 'flex: 1; padding: 8px; background: #6366f1;';
            browseBtn.textContent = '📂 Explorar';
            browseBtn.addEventListener('click', (e) => { e.stopPropagation(); isImage ? openABImageBrowse(device) : openABBrowse(device); });

            const renameBtn = document.createElement('button');
            renameBtn.className = 'btn-primary btn-sm';
            renameBtn.style.cssText = 'padding: 8px; background: #64748b;';
            renameBtn.textContent = '✏️';
            renameBtn.title = 'Renombrar';
            renameBtn.addEventListener('click', (e) => { e.stopPropagation(); showRenameDialog(device); });

            const editBtn = document.createElement('button');
            editBtn.className = 'btn-primary btn-sm';
            editBtn.style.cssText = 'padding: 8px; background: #64748b;';
            editBtn.textContent = '⚙️';
            editBtn.title = 'Configurar';
            editBtn.addEventListener('click', (e) => { e.stopPropagation(); showEditDeviceForm(device); });

            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'btn-primary btn-sm';
            deleteBtn.style.cssText = 'padding: 8px; background: #ef4444;';
            deleteBtn.textContent = '🗑️';
            deleteBtn.addEventListener('click', (e) => { e.stopPropagation(); deleteABDevice(device); });

            actions.appendChild(browseBtn);
            actions.appendChild(renameBtn);
            actions.appendChild(editBtn);
            actions.appendChild(deleteBtn);
            card.appendChild(actions);

            grid.appendChild(card);
        });
    } catch (e) {
        console.error('Load AB devices error:', e);
        grid.innerHTML = '<div style="padding: 20px; color: #ef4444;">Error al cargar dispositivos</div>';
    }
}

function formatABSize(bytes) {
    if (bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return (bytes / Math.pow(1024, i)).toFixed(i > 1 ? 1 : 0) + ' ' + units[i];
}

function showAddDeviceForm(editDevice = null) {
    const existing = document.getElementById('ab-device-form-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'ab-device-form-modal';
    modal.className = 'modal active';
    modal.style.cssText = 'display: flex; position: fixed; inset: 0; z-index: 1000; align-items: center; justify-content: center; background: rgba(0,0,0,0.5);';

    const isEdit = !!editDevice;
    const curType = editDevice?.backupType || 'files';
    const curOS = editDevice?.os || 'linux';

    modal.innerHTML = `
        <div class="glass-card modal-content" style="max-width: 520px; width: 90%; max-height: 85vh; overflow-y: auto;">
            <header class="modal-header" style="display: flex; justify-content: space-between; align-items: center;">
                <h3>${isEdit ? '⚙️ Editar Dispositivo' : '🖥️ Añadir Dispositivo'}</h3>
                <button class="btn-close" id="close-ab-form">&times;</button>
            </header>
            <form id="ab-device-form" style="display: flex; flex-direction: column; gap: 12px; margin-top: 15px;">
                ${!isEdit ? `
                <div style="display: flex; gap: 10px;">
                    <button type="button" class="btn-primary ab-type-btn ${curType === 'files' ? '' : 'ab-type-inactive'}" data-type="files" style="flex: 1; padding: 14px; text-align: center; ${curType === 'files' ? '' : 'background: var(--bg-hover); color: var(--text-dim);'}">
                        <div style="font-size: 1.5rem;">📁</div>
                        <div style="font-weight: 600; margin-top: 4px;">Archivos</div>
                        <div style="font-size: 0.75rem; opacity: 0.7;">Rsync + SSH</div>
                    </button>
                    <button type="button" class="btn-primary ab-type-btn ${curType === 'image' ? '' : 'ab-type-inactive'}" data-type="image" style="flex: 1; padding: 14px; text-align: center; ${curType === 'image' ? '' : 'background: var(--bg-hover); color: var(--text-dim);'}">
                        <div style="font-size: 1.5rem;">💽</div>
                        <div style="font-weight: 600; margin-top: 4px;">Imagen Completa</div>
                        <div style="font-size: 0.75rem; opacity: 0.7;">Disco entero</div>
                    </button>
                </div>` : ''}
                <input type="hidden" id="ab-type" value="${curType}">
                
                ${!isEdit ? `
                <div id="ab-os-select" style="display: ${curType === 'image' ? 'flex' : 'none'}; gap: 10px;">
                    <button type="button" class="btn-primary ab-os-btn" data-os="windows" style="flex: 1; padding: 10px; ${curOS === 'windows' ? '' : 'background: var(--bg-hover); color: var(--text-dim);'}">🪟 Windows</button>
                    <button type="button" class="btn-primary ab-os-btn" data-os="linux" style="flex: 1; padding: 10px; ${curOS === 'linux' ? '' : 'background: var(--bg-hover); color: var(--text-dim);'}">🐧 Linux</button>
                </div>` : ''}
                <input type="hidden" id="ab-os" value="${curOS}">

                <div class="input-group">
                    <input type="text" id="ab-name" required placeholder=" " value="${escapeHtml(editDevice?.name || '')}">
                    <label>Nombre (ej: Portátil JLu)</label>
                </div>
                <div class="input-group">
                    <input type="text" id="ab-ip" required placeholder=" " value="${escapeHtml(editDevice?.ip || '')}">
                    <label>IP del equipo</label>
                </div>

                <div id="ab-ssh-fields" style="display: ${curType === 'files' ? 'flex' : 'none'}; flex-direction: column; gap: 12px;">
                    <div style="display: grid; grid-template-columns: 1fr 100px; gap: 10px;">
                        <div class="input-group">
                            <input type="text" id="ab-user" placeholder=" " value="${escapeHtml(editDevice?.sshUser || '')}">
                            <label>Usuario SSH</label>
                        </div>
                        <div class="input-group">
                            <input type="number" id="ab-port" placeholder=" " value="${editDevice?.sshPort || 22}">
                            <label>Puerto</label>
                        </div>
                    </div>
                    <div class="input-group">
                        <input type="text" id="ab-paths" placeholder=" " value="${escapeHtml((editDevice?.paths || ['/home']).join(', '))}">
                        <label>Rutas a copiar (separadas por coma)</label>
                    </div>
                    <div class="input-group">
                        <input type="text" id="ab-excludes" placeholder=" " value="${escapeHtml((editDevice?.excludes || ['.cache', '*.tmp', 'node_modules']).join(', '))}">
                        <label>Excluir (separadas por coma)</label>
                    </div>
                </div>

                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
                    <div class="input-group">
                        <input type="text" id="ab-schedule" required placeholder=" " value="${escapeHtml(editDevice?.schedule || '0 2 * * *')}">
                        <label>Cron (ej: 0 2 * * *)</label>
                    </div>
                    <div class="input-group">
                        <input type="number" id="ab-retention" min="1" max="100" placeholder=" " value="${editDevice?.retention || 5}">
                        <label>Versiones a mantener</label>
                    </div>
                </div>
                <button type="submit" class="btn-primary" style="padding: 14px;">${isEdit ? 'Guardar Cambios' : 'Añadir Dispositivo'}</button>
            </form>
            <div id="ab-setup-info" style="display: none; margin-top: 15px; padding: 15px; background: var(--bg-hover); border-radius: 8px; border: 1px solid var(--border);"></div>
        </div>
    `;

    document.body.appendChild(modal);
    document.getElementById('close-ab-form').addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });

    // Type toggle (files vs image)
    modal.querySelectorAll('.ab-type-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const type = btn.dataset.type;
            document.getElementById('ab-type').value = type;
            modal.querySelectorAll('.ab-type-btn').forEach(b => {
                b.style.background = b.dataset.type === type ? '' : 'var(--bg-hover)';
                b.style.color = b.dataset.type === type ? '' : 'var(--text-dim)';
            });
            document.getElementById('ab-ssh-fields').style.display = type === 'files' ? 'flex' : 'none';
            const osSelect = document.getElementById('ab-os-select');
            if (osSelect) osSelect.style.display = type === 'image' ? 'flex' : 'none';
        });
    });

    // OS toggle (windows vs linux) 
    modal.querySelectorAll('.ab-os-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const osVal = btn.dataset.os;
            document.getElementById('ab-os').value = osVal;
            modal.querySelectorAll('.ab-os-btn').forEach(b => {
                b.style.background = b.dataset.os === osVal ? '' : 'var(--bg-hover)';
                b.style.color = b.dataset.os === osVal ? '' : 'var(--text-dim)';
            });
        });
    });

    document.getElementById('ab-device-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const backupType = document.getElementById('ab-type').value;
        const isImage = backupType === 'image';

        const body = {
            name: document.getElementById('ab-name').value.trim(),
            ip: document.getElementById('ab-ip').value.trim(),
            backupType,
            os: document.getElementById('ab-os').value,
            schedule: document.getElementById('ab-schedule').value.trim(),
            retention: parseInt(document.getElementById('ab-retention').value) || 5,
        };

        if (!isImage) {
            body.sshUser = document.getElementById('ab-user').value.trim();
            body.sshPort = parseInt(document.getElementById('ab-port').value) || 22;
            body.paths = document.getElementById('ab-paths').value.split(',').map(s => s.trim()).filter(Boolean);
            body.excludes = document.getElementById('ab-excludes').value.split(',').map(s => s.trim()).filter(Boolean);
        }

        try {
            const url = isEdit ? `${API_BASE}/active-backup/devices/${editDevice.id}` : `${API_BASE}/active-backup/devices`;
            const method = isEdit ? 'PUT' : 'POST';
            const res = await authFetch(url, { method, body: JSON.stringify(body) });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed');

            const info = document.getElementById('ab-setup-info');

            if (!isEdit && isImage && data.sambaSetup) {
                // Show image backup instructions
                info.style.display = 'block';
                const instr = data.sambaSetup.instructions;
                info.innerHTML = `
                    <h4 style="margin-bottom: 12px; color: var(--accent);">💽 ${escapeHtml(instr.title)}</h4>
                    ${instr.steps.map(step => `
                        <div style="margin-bottom: 15px;">
                            <p style="font-weight: 600; font-size: 0.9rem; margin-bottom: 6px;">${escapeHtml(step.title)}</p>
                            <p style="font-size: 0.8rem; color: var(--text-dim); margin-bottom: 6px;">${escapeHtml(step.description)}</p>
                            <div style="background: #0a0a0a; color: #10b981; padding: 10px; border-radius: 6px; font-family: monospace; font-size: 0.75rem; word-break: break-all; white-space: pre-wrap; position: relative;">${escapeHtml(step.command)}</div>
                        </div>
                    `).join('')}
                    <button class="btn-primary btn-sm" style="margin-top: 5px;" onclick="this.closest('.modal').remove()">Entendido, cerrar</button>
                `;
                document.getElementById('ab-device-form').style.display = 'none';
            } else if (!isEdit && !isImage && data.sshPublicKey) {
                // Show SSH key instructions
                info.style.display = 'block';
                info.innerHTML = `
                    <h4 style="margin-bottom: 10px; color: var(--accent);">🔑 Configura el acceso SSH</h4>
                    <p style="font-size: 0.85rem; color: var(--text-dim); margin-bottom: 10px;">Ejecuta esto en <strong>${escapeHtml(body.name)}</strong> (${escapeHtml(body.ip)}):</p>
                    <div style="background: #0a0a0a; color: #10b981; padding: 12px; border-radius: 6px; font-family: monospace; font-size: 0.8rem; word-break: break-all; margin-bottom: 10px;">
                        <code id="ab-ssh-cmd">mkdir -p ~/.ssh && echo '${escapeHtml(data.sshPublicKey)}' >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys</code>
                    </div>
                    <button class="btn-primary btn-sm" onclick="navigator.clipboard.writeText(document.getElementById('ab-ssh-cmd').textContent);this.textContent='✅ Copiado'">📋 Copiar comando</button>
                    <button class="btn-primary btn-sm" style="margin-left: 8px; background: #6366f1;" onclick="this.closest('.modal').remove()">Listo, cerrar</button>
                `;
                document.getElementById('ab-device-form').style.display = 'none';
            } else {
                modal.remove();
            }
            await loadABDevices();
        } catch (err) {
            alert('Error: ' + err.message);
        }
    });
}

function showEditDeviceForm(device) {
    showAddDeviceForm(device);
}

function showRenameDialog(device) {
    const newName = prompt('Nuevo nombre para el dispositivo:', device.name);
    if (!newName || newName.trim() === '' || newName === device.name) return;
    
    authFetch(`${API_BASE}/active-backup/devices/${device.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim() }),
    })
    .then(res => res.json())
    .then(data => {
        if (data.success) {
            loadABDevices();
        } else {
            alert('Error: ' + (data.error || 'No se pudo renombrar'));
        }
    })
    .catch(() => alert('Error de conexión'));
}

async function showABInstructions(device) {
    try {
        const res = await authFetch(`${API_BASE}/active-backup/devices/${device.id}/instructions`);
        const data = await res.json();
        if (!data.success) throw new Error('Failed');

        const modal = document.createElement('div');
        modal.className = 'modal active';
        modal.style.cssText = 'display: flex; position: fixed; inset: 0; z-index: 1000; align-items: center; justify-content: center; background: rgba(0,0,0,0.5);';

        const instr = data.instructions;
        modal.innerHTML = `
            <div class="glass-card modal-content" style="max-width: 600px; width: 90%; max-height: 85vh; overflow-y: auto;">
                <header class="modal-header" style="display: flex; justify-content: space-between; align-items: center;">
                    <h3>💽 ${escapeHtml(instr.title)}</h3>
                    <button class="btn-close" onclick="this.closest('.modal').remove()">&times;</button>
                </header>
                <div style="margin-top: 15px;">
                    ${instr.steps.map(step => `
                        <div style="margin-bottom: 18px;">
                            <p style="font-weight: 600; font-size: 0.9rem; margin-bottom: 6px;">${escapeHtml(step.title)}</p>
                            <p style="font-size: 0.82rem; color: var(--text-dim); margin-bottom: 8px;">${escapeHtml(step.description)}</p>
                            <div style="background: #0a0a0a; color: #10b981; padding: 12px; border-radius: 6px; font-family: monospace; font-size: 0.75rem; word-break: break-all; white-space: pre-wrap; cursor: pointer; position: relative;" onclick="navigator.clipboard.writeText(this.textContent.trim());this.style.border='1px solid #10b981';setTimeout(()=>this.style.border='',1000)" title="Click para copiar">${escapeHtml(step.command)}</div>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;

        document.body.appendChild(modal);
        modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
    } catch(e) {
        alert('Error al cargar instrucciones');
    }
}

async function openABImageBrowse(device) {
    const panel = document.getElementById('ab-detail-panel');
    if (!panel) return;
    panel.style.display = 'block';

    try {
        const res = await authFetch(`${API_BASE}/active-backup/devices/${device.id}/images`);
        const data = await res.json();
        const images = data.images || [];
        const windowsBackups = data.windowsBackups || [];
        const allItems = [...windowsBackups, ...images];

        panel.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
                <h3>💽 ${escapeHtml(device.name)} — Imágenes de Backup</h3>
                <button class="btn-close" style="font-size: 1.5rem;" onclick="document.getElementById('ab-detail-panel').style.display='none'">&times;</button>
            </div>
            <div style="margin-bottom: 10px; font-size: 0.85rem; color: var(--text-dim);">
                Tamaño total: <strong>${formatABSize(data.totalSize || 0)}</strong>
            </div>
        `;

        if (allItems.length === 0) {
            panel.innerHTML += `
                <div style="padding: 30px; text-align: center; color: var(--text-dim);">
                    <p>No hay imágenes de backup todavía.</p>
                    <p style="margin-top: 8px;">Ejecuta el comando de backup desde el equipo Windows/Linux para que aparezcan aquí.</p>
                </div>`;
            return;
        }

        const list = document.createElement('div');
        list.style.cssText = 'border: 1px solid var(--border); border-radius: 8px; overflow: hidden;';

        const header = document.createElement('div');
        header.style.cssText = 'display: grid; grid-template-columns: 1fr 120px 160px 80px; padding: 10px 15px; background: var(--bg-hover); font-weight: 600; font-size: 0.8rem; color: var(--text-dim);';
        header.innerHTML = '<span>Nombre</span><span>Tamaño</span><span>Fecha</span><span>Tipo</span>';
        list.appendChild(header);

        allItems.forEach(item => {
            const row = document.createElement('div');
            row.style.cssText = 'display: grid; grid-template-columns: 1fr 120px 160px 80px; padding: 10px 15px; align-items: center; border-top: 1px solid var(--border);';

            const icon = item.type === 'windows-image' ? '🪟' : item.type === 'directory' ? '📁' : '💾';
            row.innerHTML = `
                <span style="display: flex; align-items: center; gap: 8px;">${icon} ${escapeHtml(item.name)}</span>
                <span style="font-size: 0.85rem; color: var(--text-dim);">${formatABSize(item.size)}</span>
                <span style="font-size: 0.85rem; color: var(--text-dim);">${new Date(item.modified).toLocaleString('es-ES', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                <span style="font-size: 0.8rem; padding: 2px 8px; border-radius: 8px; background: rgba(99,102,241,0.15); color: #6366f1;">${item.type === 'windows-image' ? 'WIM' : item.name.split('.').pop()}</span>
            `;
            list.appendChild(row);
        });

        panel.appendChild(list);
    } catch(e) {
        panel.innerHTML = '<p style="color: #ef4444;">Error al cargar imágenes</p>';
    }
}

async function deleteABDevice(device) {
    const confirmed = await showConfirmModal('Eliminar dispositivo', `¿Eliminar "${device.name}" y todos sus backups?`);
    if (!confirmed) return;
    try {
        const res = await authFetch(`${API_BASE}/active-backup/devices/${device.id}?deleteData=true`, { method: 'DELETE' });
        if (!res.ok) throw new Error('Failed');
        await loadABDevices();
    } catch (e) {
        alert('Error al eliminar dispositivo');
    }
}

async function triggerABBackup(deviceId, btn) {
    const origText = btn.textContent;
    btn.textContent = '⏳ Iniciando...';
    btn.disabled = true;

    try {
        const res = await authFetch(`${API_BASE}/active-backup/devices/${deviceId}/backup`, { method: 'POST' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed');

        btn.textContent = '🔄 En progreso...';

        // Poll status
        const poll = setInterval(async () => {
            try {
                const sr = await authFetch(`${API_BASE}/active-backup/devices/${deviceId}/status`);
                const sd = await sr.json();
                if (sd.status !== 'running') {
                    clearInterval(poll);
                    btn.textContent = origText;
                    btn.disabled = false;
                    await loadABDevices();
                    if (sd.lastResult === 'failed') {
                        alert('Backup falló: ' + (sd.lastError || 'Error desconocido'));
                    }
                }
            } catch(e) {
                clearInterval(poll);
                btn.textContent = origText;
                btn.disabled = false;
            }
        }, 3000);

    } catch (e) {
        alert('Error: ' + e.message);
        btn.textContent = origText;
        btn.disabled = false;
    }
}

async function openABBrowse(device) {
    abSelectedDevice = device;
    const panel = document.getElementById('ab-detail-panel');
    if (!panel) return;
    panel.style.display = 'block';

    // Load versions
    try {
        const res = await authFetch(`${API_BASE}/active-backup/devices/${device.id}/versions`);
        const data = await res.json();
        const versions = data.versions || [];

        if (versions.length === 0) {
            panel.innerHTML = `
                <h3 style="margin-bottom: 15px;">📂 ${escapeHtml(device.name)} — Sin backups</h3>
                <p style="color: var(--text-dim);">Ejecuta un backup primero para poder explorar archivos.</p>
                <button class="btn-primary btn-sm" style="margin-top: 10px;" onclick="document.getElementById('ab-detail-panel').style.display='none'">Cerrar</button>
            `;
            return;
        }

        panel.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
                <h3>📂 ${escapeHtml(device.name)}</h3>
                <button class="btn-close" style="font-size: 1.5rem;" onclick="document.getElementById('ab-detail-panel').style.display='none'">&times;</button>
            </div>
            <div style="display: flex; gap: 10px; margin-bottom: 15px; align-items: center;">
                <label style="font-weight: 500;">Versión:</label>
                <select id="ab-version-select" style="padding: 8px 12px; border-radius: 8px; border: 1px solid var(--border); background: var(--bg-card); color: var(--text);">
                    ${versions.reverse().map(v => `<option value="${escapeHtml(v.name)}">${escapeHtml(v.name)} — ${new Date(v.date).toLocaleString('es-ES', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })} (${formatABSize(v.size)})</option>`).join('')}
                </select>
            </div>
            <div id="ab-browse-breadcrumb" style="display: flex; gap: 4px; align-items: center; margin-bottom: 10px; font-size: 0.85rem; flex-wrap: wrap;"></div>
            <div id="ab-browse-list" style="border: 1px solid var(--border); border-radius: 8px; overflow: hidden; max-height: 400px; overflow-y: auto;"></div>
        `;

        const vSelect = document.getElementById('ab-version-select');
        vSelect.addEventListener('change', () => {
            abBrowseVersion = vSelect.value;
            abBrowsePath = '/';
            loadABBrowse(device.id);
        });

        abBrowseVersion = versions[0].name;
        abBrowsePath = '/';
        loadABBrowse(device.id);

    } catch(e) {
        panel.innerHTML = '<p style="color: #ef4444;">Error al cargar versiones</p>';
    }
}

async function loadABBrowse(deviceId) {
    const list = document.getElementById('ab-browse-list');
    const breadcrumb = document.getElementById('ab-browse-breadcrumb');
    if (!list) return;

    // Build breadcrumb
    if (breadcrumb) {
        breadcrumb.innerHTML = '';
        const homeBtn = document.createElement('button');
        homeBtn.style.cssText = 'padding: 4px 8px; border-radius: 4px; border: none; background: var(--bg-hover); color: var(--text); cursor: pointer;';
        homeBtn.textContent = '🏠 /';
        homeBtn.addEventListener('click', () => { abBrowsePath = '/'; loadABBrowse(deviceId); });
        breadcrumb.appendChild(homeBtn);

        const parts = abBrowsePath.split('/').filter(Boolean);
        let accumulated = '';
        parts.forEach(part => {
            accumulated += '/' + part;
            const sep = document.createElement('span');
            sep.textContent = ' › ';
            sep.style.color = 'var(--text-dim)';
            breadcrumb.appendChild(sep);

            const btn = document.createElement('button');
            btn.style.cssText = 'padding: 4px 8px; border-radius: 4px; border: none; background: var(--bg-hover); color: var(--text); cursor: pointer;';
            btn.textContent = part;
            const targetPath = accumulated;
            btn.addEventListener('click', () => { abBrowsePath = targetPath; loadABBrowse(deviceId); });
            breadcrumb.appendChild(btn);
        });
    }

    list.innerHTML = '<div style="padding: 20px; color: var(--text-dim);">Cargando...</div>';

    try {
        const res = await authFetch(`${API_BASE}/active-backup/devices/${deviceId}/browse?version=${encodeURIComponent(abBrowseVersion)}&path=${encodeURIComponent(abBrowsePath)}`);
        if (!res.ok) throw new Error('Failed');
        const data = await res.json();
        const items = data.items || [];

        if (items.length === 0) {
            list.innerHTML = '<div style="padding: 30px; text-align: center; color: var(--text-dim);">Carpeta vacía</div>';
            return;
        }

        list.innerHTML = '';

        // Header row
        const header = document.createElement('div');
        header.style.cssText = 'display: grid; grid-template-columns: 1fr 100px 160px 80px; padding: 10px 15px; background: var(--bg-hover); font-weight: 600; font-size: 0.8rem; color: var(--text-dim);';
        header.innerHTML = '<span>Nombre</span><span>Tamaño</span><span>Fecha</span><span></span>';
        list.appendChild(header);

        items.forEach(item => {
            const row = document.createElement('div');
            row.style.cssText = 'display: grid; grid-template-columns: 1fr 100px 160px 80px; padding: 10px 15px; align-items: center; border-top: 1px solid var(--border); cursor: pointer; transition: background 0.15s;';
            row.addEventListener('mouseenter', () => row.style.background = 'var(--bg-hover)');
            row.addEventListener('mouseleave', () => row.style.background = '');

            const nameSpan = document.createElement('span');
            nameSpan.style.cssText = 'display: flex; align-items: center; gap: 8px;';
            nameSpan.innerHTML = `<span>${item.type === 'directory' ? '📁' : '📄'}</span><span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(item.name)}</span>`;

            const sizeSpan = document.createElement('span');
            sizeSpan.style.cssText = 'font-size: 0.85rem; color: var(--text-dim);';
            sizeSpan.textContent = item.type === 'directory' ? '—' : formatABSize(item.size);

            const dateSpan = document.createElement('span');
            dateSpan.style.cssText = 'font-size: 0.85rem; color: var(--text-dim);';
            dateSpan.textContent = item.modified ? new Date(item.modified).toLocaleString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';

            const actionsSpan = document.createElement('span');
            if (item.type === 'file') {
                const dlBtn = document.createElement('button');
                dlBtn.className = 'btn-primary btn-sm';
                dlBtn.style.cssText = 'padding: 4px 10px; font-size: 0.8rem;';
                dlBtn.textContent = '⬇️';
                dlBtn.title = 'Descargar';
                const dlPath = abBrowsePath + '/' + item.name;
                dlBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    window.open(`${API_BASE}/active-backup/devices/${deviceId}/download?version=${encodeURIComponent(abBrowseVersion)}&path=${encodeURIComponent(dlPath)}`, '_blank');
                });
                actionsSpan.appendChild(dlBtn);
            }

            row.appendChild(nameSpan);
            row.appendChild(sizeSpan);
            row.appendChild(dateSpan);
            row.appendChild(actionsSpan);

            if (item.type === 'directory') {
                row.addEventListener('click', () => {
                    abBrowsePath = abBrowsePath + '/' + item.name;
                    loadABBrowse(deviceId);
                });
            }

            list.appendChild(row);
        });
    } catch(e) {
        list.innerHTML = '<div style="padding: 20px; color: #ef4444;">Error al explorar backup</div>';
    }
}

async function loadRecoveryStatus() {
    const container = document.getElementById('ab-recovery-status');
    if (!container) return;

    try {
        const res = await authFetch(`${API_BASE}/active-backup/recovery/status`);
        const data = await res.json();

        if (data.iso && data.iso.exists) {
            const size = formatABSize(data.iso.size);
            const date = new Date(data.iso.modified).toLocaleString('es-ES', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
            container.innerHTML = `
                <div style="display: flex; align-items: center; gap: 15px; flex-wrap: wrap;">
                    <div style="flex: 1; min-width: 200px;">
                        <div style="font-weight: 600; color: var(--accent);">✅ ISO disponible</div>
                        <div style="font-size: 0.85rem; color: var(--text-dim); margin-top: 4px;">${size} · Creada: ${date}</div>
                    </div>
                    <div style="display: flex; gap: 8px;">
                        <button class="btn-primary btn-sm" id="ab-download-iso" style="padding: 10px 16px;">⬇️ Descargar ISO</button>
                        <button class="btn-primary btn-sm" id="ab-rebuild-iso" style="padding: 10px 16px; background: #64748b;">🔄 Regenerar</button>
                    </div>
                </div>
                <div style="margin-top: 12px; padding: 12px; background: #0a0a0a; border-radius: 6px; font-family: monospace; font-size: 0.8rem; color: #10b981;">
                    <strong>Para flashear al USB:</strong><br>
                    sudo dd if=homepinas-recovery.iso of=/dev/sdX bs=4M status=progress && sync
                </div>
            `;

            document.getElementById('ab-download-iso').addEventListener('click', () => {
                window.open(`${API_BASE}/active-backup/recovery/download`, '_blank');
            });
            document.getElementById('ab-rebuild-iso').addEventListener('click', () => buildRecoveryISO());
        } else {
            container.innerHTML = `
                <div style="display: flex; align-items: center; gap: 15px; flex-wrap: wrap;">
                    <div style="flex: 1; min-width: 200px;">
                        <div style="font-weight: 500;">No hay ISO generada todavía</div>
                        <div style="font-size: 0.85rem; color: var(--text-dim); margin-top: 4px;">
                            Genera una ISO bootable (~500MB) que incluye herramientas de restauración, 
                            detección automática del NAS y soporte para BIOS + UEFI.
                        </div>
                    </div>
                    <button class="btn-primary" id="ab-build-iso" style="padding: 12px 20px;">🔧 Generar USB Recovery</button>
                </div>
                <div style="margin-top: 12px;">
                    <details style="color: var(--text-dim); font-size: 0.85rem;">
                        <summary style="cursor: pointer; font-weight: 500;">¿Qué incluye?</summary>
                        <ul style="margin-top: 8px; padding-left: 20px; line-height: 1.8;">
                            <li>🔍 Detección automática del NAS por red (mDNS)</li>
                            <li>📋 Menú interactivo para seleccionar backup</li>
                            <li>💽 Restauración de imágenes completas (Windows/Linux)</li>
                            <li>📁 Restauración de archivos (rsync)</li>
                            <li>🔧 Reparación de arranque (GRUB)</li>
                            <li>🖥️ Compatible BIOS y UEFI</li>
                            <li>📶 WiFi incluido (drivers firmware)</li>
                        </ul>
                    </details>
                </div>
            `;

            const buildBtn = document.getElementById('ab-build-iso');
            if (buildBtn) buildBtn.addEventListener('click', () => buildRecoveryISO());
        }
    } catch (e) {
        container.innerHTML = `<p style="color: var(--text-dim);">Scripts de recovery disponibles. La generación de ISO requiere un sistema x86_64.</p>
            <button class="btn-primary btn-sm" style="margin-top: 10px;" onclick="window.open('${API_BASE}/active-backup/recovery/scripts','_blank')">📦 Descargar Scripts</button>`;
    }
}

async function buildRecoveryISO() {
    const confirmed = await showConfirmModal('Generar ISO', 'Generar la ISO de recuperación puede tardar 10-20 minutos y requiere ~2GB de espacio. ¿Continuar?');
    if (!confirmed) return;

    try {
        const res = await authFetch(`${API_BASE}/active-backup/recovery/build`, { method: 'POST' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed');

        const container = document.getElementById('ab-recovery-status');
        if (container) {
            container.innerHTML = `
                <div style="text-align: center; padding: 20px;">
                    <div style="font-size: 2rem; margin-bottom: 10px;">⏳</div>
                    <div style="font-weight: 600;">Generando ISO de recuperación...</div>
                    <div style="color: var(--text-dim); font-size: 0.85rem; margin-top: 8px;">Esto puede tardar 10-20 minutos. No cierres esta página.</div>
                    <div style="margin-top: 15px; height: 4px; background: var(--border); border-radius: 2px; overflow: hidden;">
                        <div style="height: 100%; width: 30%; background: var(--accent); border-radius: 2px; animation: pulse 2s infinite;"></div>
                    </div>
                </div>
            `;

            // Poll every 15s for completion
            const poll = setInterval(async () => {
                try {
                    const sr = await authFetch(`${API_BASE}/active-backup/recovery/status`);
                    const sd = await sr.json();
                    if (sd.iso && sd.iso.exists) {
                        clearInterval(poll);
                        await loadRecoveryStatus();
                    }
                } catch(e) { /* keep polling */ }
            }, 15000);
        }
    } catch (e) {
        alert('Error: ' + e.message);
    }
}

// =============================================================================
// CLOUD SYNC (Syncthing Integration)
// =============================================================================

let cloudSyncRefreshInterval = null;

async function renderCloudSyncView() {
    const dashboardContent = document.getElementById('dashboard-content');
    if (!dashboardContent) return;
    
    // Clear any existing refresh interval
    if (cloudSyncRefreshInterval) {
        clearInterval(cloudSyncRefreshInterval);
        cloudSyncRefreshInterval = null;
    }
    
    dashboardContent.innerHTML = `
        <div class="card" style="margin-bottom: 20px;">
            <div id="cloud-sync-status">
                <h3 style="color: var(--primary);">☁️ Cloud Sync</h3>
                <p>Cargando...</p>
            </div>
        </div>
        <div id="cloud-sync-content"></div>
    `;
    
    await loadCloudSyncStatus();
    
    // Auto-refresh every 5 seconds when view is active
    cloudSyncRefreshInterval = setInterval(async () => {
        if (document.getElementById('cloud-sync-status')) {
            await refreshSyncStatus();
        } else {
            // View no longer visible, stop refresh
            clearInterval(cloudSyncRefreshInterval);
            cloudSyncRefreshInterval = null;
        }
    }, 5000);
}

async function loadCloudSyncStatus() {
    const statusDiv = document.getElementById('cloud-sync-status');
    const contentDiv = document.getElementById('cloud-sync-content');
    
    try {
        const res = await authFetch(`${API_BASE}/cloud-sync/status`);
        if (!res.ok) throw new Error('Failed to load status');
        const status = await res.json();
        
        if (!status.installed) {
            // Syncthing not installed
            statusDiv.innerHTML = `
                <h3 style="color: var(--primary);">☁️ Cloud Sync</h3>
                <p style="margin: 15px 0;">Syncthing no está instalado. Instálalo para sincronizar archivos entre tu NAS y otros dispositivos.</p>
                <button id="install-syncthing-btn" class="btn" style="background: var(--primary); color: #000; padding: 12px 24px; border: none; border-radius: 8px; cursor: pointer; font-weight: 600;">
                    📦 Instalar Syncthing
                </button>
            `;
            
            document.getElementById('install-syncthing-btn')?.addEventListener('click', installSyncthing);
            contentDiv.innerHTML = '';
            return;
        }
        
        if (!status.running) {
            // Syncthing installed but not running
            statusDiv.innerHTML = `
                <h3 style="color: var(--primary);">☁️ Cloud Sync</h3>
                <div style="display: flex; align-items: center; gap: 15px; margin: 15px 0;">
                    <span style="color: #f59e0b;">⚠️ Syncthing está detenido</span>
                    <button id="start-syncthing-btn" class="btn" style="background: #10b981; color: #fff; padding: 8px 16px; border: none; border-radius: 6px; cursor: pointer;">
                        ▶️ Iniciar
                    </button>
                </div>
            `;
            
            document.getElementById('start-syncthing-btn')?.addEventListener('click', startSyncthing);
            contentDiv.innerHTML = '';
            return;
        }
        
        // Syncthing is running
        statusDiv.innerHTML = `
            <h3 style="color: var(--primary);">☁️ Cloud Sync</h3>
            <div style="display: flex; align-items: center; gap: 20px; margin: 15px 0; flex-wrap: wrap;">
                <span style="color: #10b981;">● Activo</span>
                <span style="color: var(--text-dim);">v${escapeHtml(status.version || 'Unknown')}</span>
                <span style="color: var(--text-dim);">📁 ${status.folders.length} carpetas</span>
                <span style="color: var(--text-dim);">📱 ${status.connections} dispositivos conectados</span>
                <button id="stop-syncthing-btn" class="btn" style="background: #ef4444; color: #fff; padding: 6px 12px; border: none; border-radius: 6px; cursor: pointer; font-size: 0.85rem;">
                    ⏹️ Detener
                </button>
            </div>
        `;
        
        document.getElementById('stop-syncthing-btn')?.addEventListener('click', stopSyncthing);
        
        // Load folders and devices
        await renderCloudSyncContent(status);
        
    } catch (e) {
        statusDiv.innerHTML = `
            <h3 style="color: var(--primary);">☁️ Cloud Sync</h3>
            <p style="color: #ef4444;">Error: ${escapeHtml(e.message)}</p>
        `;
    }
}

async function renderCloudSyncContent(status) {
    const contentDiv = document.getElementById('cloud-sync-content');
    
    // Get device ID for QR
    let deviceId = status.deviceId || '';
    
    contentDiv.innerHTML = `
        <!-- Device ID / QR Section -->
        <div class="card" style="margin-bottom: 20px;">
            <h3 style="color: var(--secondary); margin-bottom: 15px;">🔗 Vincular Dispositivo</h3>
            <p style="color: var(--text-dim); margin-bottom: 10px;">Escanea el QR o copia el ID para añadir este NAS en Syncthing de tu PC/móvil:</p>
            <div style="display: flex; gap: 20px; align-items: flex-start; flex-wrap: wrap;">
                <div id="qr-code" style="background: #fff; padding: 10px; border-radius: 8px; width: 150px; height: 150px; display: flex; align-items: center; justify-content: center;">
                    <span style="color: #666; font-size: 0.8rem;">Generando QR...</span>
                </div>
                <div style="flex: 1; min-width: 200px;">
                    <label style="color: var(--text-dim); font-size: 0.85rem;">Device ID:</label>
                    <div style="display: flex; gap: 10px; margin-top: 5px;">
                        <input type="text" id="device-id-input" value="${escapeHtml(deviceId)}" readonly 
                            style="flex: 1; padding: 10px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 6px; color: var(--text); font-family: monospace; font-size: 0.75rem;">
                        <button id="copy-device-id-btn"
                            style="padding: 10px 15px; background: var(--primary); color: #000; border: none; border-radius: 6px; cursor: pointer; font-weight: 600;">
                            📋 Copiar
                        </button>
                    </div>
                </div>
            </div>
        </div>
        
        <!-- Folders Section -->
        <div class="card" style="margin-bottom: 20px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
                <h3 style="color: var(--secondary);">📁 Carpetas Sincronizadas</h3>
                <button id="add-folder-btn" style="padding: 8px 16px; background: #a78bfa; color: #000; border: none; border-radius: 6px; cursor: pointer; font-weight: 600;">
                    + Añadir Carpeta
                </button>
            </div>
            <div id="folders-list">
                ${status.folders.length === 0 ? '<p style="color: var(--text-dim);">No hay carpetas sincronizadas</p>' : ''}
            </div>
        </div>
        
        <!-- Devices Section -->
        <div class="card" style="margin-bottom: 20px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
                <h3 style="color: var(--secondary);">📱 Dispositivos</h3>
                <button id="add-device-btn" style="padding: 8px 16px; background: #22d3ee; color: #000; border: none; border-radius: 6px; cursor: pointer; font-weight: 600;">
                    + Añadir Dispositivo
                </button>
            </div>
            <div id="devices-list">
                <p style="color: var(--text-dim);">Cargando dispositivos...</p>
            </div>
        </div>
    `;
    
    // Generate QR code
    generateQRCode(deviceId);
    
    // Render folders
    renderFoldersList(status.folders);
    
    // Load and render devices
    await loadDevicesList();
    
    // Event listeners
    document.getElementById('add-folder-btn')?.addEventListener('click', showAddFolderModal);
    document.getElementById('add-device-btn')?.addEventListener('click', showAddDeviceModal);
    
    // Copy device ID button
    const copyBtn = document.getElementById('copy-device-id-btn');
    if (copyBtn) {
        copyBtn.addEventListener('click', () => {
            const input = document.getElementById('device-id-input');
            if (input) {
                navigator.clipboard.writeText(input.value);
                copyBtn.textContent = '✓ Copiado';
                setTimeout(() => copyBtn.textContent = '📋 Copiar', 2000);
            }
        });
    }
}

function generateQRCode(deviceId) {
    const qrDiv = document.getElementById('qr-code');
    if (!qrDiv || !deviceId) return;
    
    // Use a simple QR code API (or implement locally)
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=130x130&data=${encodeURIComponent(deviceId)}`;
    qrDiv.innerHTML = `<img src="${qrUrl}" alt="QR Code" style="width: 130px; height: 130px;">`;
}

function renderFoldersList(folders) {
    const listDiv = document.getElementById('folders-list');
    if (!listDiv) return;
    
    if (folders.length === 0) {
        listDiv.innerHTML = '<p style="color: var(--text-dim);">No hay carpetas sincronizadas. Añade una carpeta para empezar.</p>';
        return;
    }
    
    listDiv.innerHTML = folders.map(f => `
        <div class="sync-folder-card" data-folder-id="${escapeHtml(f.id)}" style="padding: 15px; background: rgba(255,255,255,0.03); border-radius: 10px; margin-bottom: 12px; border: 1px solid rgba(255,255,255,0.05);">
            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 10px;">
                <div style="flex: 1;">
                    <div style="font-weight: 600; color: var(--text); font-size: 1rem;">📁 ${escapeHtml(f.label)}</div>
                    <div style="font-size: 0.8rem; color: var(--text-dim); margin-top: 3px; font-family: monospace;">${escapeHtml(f.path)}</div>
                </div>
                <div style="display: flex; gap: 6px;">
                    <button class="pause-folder-btn" data-folder-id="${escapeHtml(f.id)}" data-paused="${f.paused}" 
                        style="padding: 6px 10px; background: ${f.paused ? '#10b981' : '#f59e0b'}; color: #fff; border: none; border-radius: 6px; cursor: pointer; font-size: 0.85rem;" 
                        title="${f.paused ? 'Reanudar' : 'Pausar'}">
                        ${f.paused ? '▶️' : '⏸️'}
                    </button>
                    <button class="browse-folder-btn" data-folder-path="${escapeHtml(f.path)}" 
                        style="padding: 6px 10px; background: #8b5cf6; color: #fff; border: none; border-radius: 6px; cursor: pointer; font-size: 0.85rem;" 
                        title="Ver archivos">
                        📂
                    </button>
                    <button class="share-folder-btn" data-folder-id="${escapeHtml(f.id)}" data-folder-label="${escapeHtml(f.label)}" 
                        style="padding: 6px 10px; background: #3b82f6; color: #fff; border: none; border-radius: 6px; cursor: pointer; font-size: 0.85rem;" 
                        title="Compartir">
                        📤
                    </button>
                    <button class="delete-folder-btn" data-folder-id="${escapeHtml(f.id)}" 
                        style="padding: 6px 10px; background: #ef4444; color: #fff; border: none; border-radius: 6px; cursor: pointer; font-size: 0.85rem;" 
                        title="Eliminar">
                        🗑️
                    </button>
                </div>
            </div>
            <div class="folder-sync-status" data-folder-id="${escapeHtml(f.id)}" style="margin-top: 10px;">
                <div style="display: flex; align-items: center; gap: 10px; font-size: 0.85rem;">
                    ${f.paused 
                        ? '<span style="color: #f59e0b;">⏸️ Pausada</span>' 
                        : '<span class="sync-state" style="color: #10b981;">● Cargando...</span>'}
                    <span style="color: var(--text-dim);">· ${f.devices} dispositivo(s)</span>
                </div>
                ${!f.paused ? `
                <div class="sync-progress-container" style="margin-top: 8px; display: none;">
                    <div style="display: flex; justify-content: space-between; font-size: 0.75rem; color: var(--text-dim); margin-bottom: 4px;">
                        <span class="sync-files">-- archivos</span>
                        <span class="sync-percent">--%</span>
                    </div>
                    <div style="height: 4px; background: rgba(255,255,255,0.1); border-radius: 2px; overflow: hidden;">
                        <div class="sync-progress-bar" style="height: 100%; background: var(--primary); width: 0%; transition: width 0.3s;"></div>
                    </div>
                </div>
                ` : ''}
            </div>
        </div>
    `).join('');
    
    // Attach event listeners
    listDiv.querySelectorAll('.delete-folder-btn').forEach(btn => {
        btn.addEventListener('click', () => deleteFolder(btn.dataset.folderId));
    });
    listDiv.querySelectorAll('.share-folder-btn').forEach(btn => {
        btn.addEventListener('click', () => showShareFolderModal(btn.dataset.folderId, btn.dataset.folderLabel));
    });
    listDiv.querySelectorAll('.pause-folder-btn').forEach(btn => {
        btn.addEventListener('click', () => toggleFolderPause(btn.dataset.folderId, btn.dataset.paused === 'true'));
    });
    listDiv.querySelectorAll('.browse-folder-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            // Navigate to Files view and open the folder
            state.currentView = 'files';
            state.filesCurrentPath = btn.dataset.folderPath;
            renderContent();
            updateSidebarActive();
        });
    });
    
    // Load detailed sync status for each folder
    loadFolderSyncStatuses();
}

// Load sync status for all folders without full re-render
async function loadFolderSyncStatuses() {
    try {
        const res = await authFetch(`${API_BASE}/cloud-sync/sync-status`);
        if (!res.ok) return;
        const statuses = await res.json();
        
        statuses.forEach(s => {
            updateFolderSyncUI(s);
        });
    } catch (e) {
        console.error('Error loading sync statuses:', e);
    }
}

// Update individual folder sync UI
function updateFolderSyncUI(status) {
    const card = document.querySelector(`.folder-sync-status[data-folder-id="${status.id}"]`);
    if (!card) return;
    
    const stateSpan = card.querySelector('.sync-state');
    const progressContainer = card.querySelector('.sync-progress-container');
    
    if (!stateSpan) return;
    
    // State mapping
    const stateMap = {
        'idle': { text: '✓ Sincronizado', color: '#10b981' },
        'scanning': { text: '🔍 Escaneando...', color: '#3b82f6' },
        'syncing': { text: '🔄 Sincronizando...', color: '#f59e0b' },
        'sync-preparing': { text: '⏳ Preparando...', color: '#8b5cf6' },
        'sync-waiting': { text: '⏳ Esperando...', color: '#6b7280' },
        'cleaning': { text: '🧹 Limpiando...', color: '#6b7280' },
        'error': { text: '❌ Error', color: '#ef4444' }
    };
    
    const stateInfo = stateMap[status.state] || { text: status.state, color: '#6b7280' };
    stateSpan.innerHTML = `<span style="color: ${stateInfo.color};">${stateInfo.text}</span>`;
    
    // Show progress bar if syncing
    if (progressContainer) {
        if (status.state === 'syncing' || status.needFiles > 0) {
            progressContainer.style.display = 'block';
            const filesSpan = progressContainer.querySelector('.sync-files');
            const percentSpan = progressContainer.querySelector('.sync-percent');
            const progressBar = progressContainer.querySelector('.sync-progress-bar');
            
            if (filesSpan) filesSpan.textContent = `${status.localFiles || 0} / ${status.globalFiles || 0} archivos`;
            if (percentSpan) percentSpan.textContent = `${status.completion || 0}%`;
            if (progressBar) progressBar.style.width = `${status.completion || 0}%`;
        } else {
            progressContainer.style.display = 'none';
        }
    }
}

// Refresh sync status without full re-render (for auto-refresh)
async function refreshSyncStatus() {
    try {
        // Update folder sync statuses
        await loadFolderSyncStatuses();
        
        // Update connection count
        const res = await authFetch(`${API_BASE}/cloud-sync/status`);
        if (res.ok) {
            const status = await res.json();
            const statusDiv = document.getElementById('cloud-sync-status');
            if (statusDiv) {
                const connSpan = statusDiv.querySelector('span:nth-child(4)');
                if (connSpan && connSpan.textContent.includes('dispositivos')) {
                    connSpan.textContent = `📱 ${status.connections} dispositivos conectados`;
                }
            }
        }
    } catch (e) {
        console.error('Refresh error:', e);
    }
}

// Toggle folder pause/resume
async function toggleFolderPause(folderId, isPaused) {
    try {
        const res = await authFetch(`${API_BASE}/cloud-sync/folders/${encodeURIComponent(folderId)}/pause`, {
            method: 'POST',
            body: JSON.stringify({ paused: !isPaused })
        });
        
        if (!res.ok) throw new Error('Failed to toggle pause');
        
        showNotification(isPaused ? 'Carpeta reanudada' : 'Carpeta pausada', 'success');
        await loadCloudSyncStatus();
    } catch (e) {
        showNotification('Error: ' + e.message, 'error');
    }
}

async function loadDevicesList() {
    const listDiv = document.getElementById('devices-list');
    if (!listDiv) return;
    
    try {
        const res = await authFetch(`${API_BASE}/cloud-sync/devices`);
        if (!res.ok) throw new Error('Failed to load devices');
        const devices = await res.json();
        
        if (devices.length === 0) {
            listDiv.innerHTML = '<p style="color: #9ca3af;">No hay dispositivos vinculados. Añade el Device ID de tu PC o móvil.</p>';
            return;
        }
        
        listDiv.innerHTML = devices.map(d => `
            <div class="sync-device-card" style="padding: 15px; background: rgba(255,255,255,0.03); border-radius: 10px; margin-bottom: 12px; border: 1px solid ${d.connected ? 'rgba(16,185,129,0.3)' : 'rgba(255,255,255,0.05)'};">
                <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                    <div style="flex: 1;">
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <span style="font-size: 1.2rem;">${d.connected ? '🟢' : '⚪'}</span>
                            <span style="font-weight: 600; color: var(--text); font-size: 1rem;">${escapeHtml(d.name)}</span>
                        </div>
                        <div style="font-size: 0.75rem; color: var(--text-dim); font-family: monospace; margin-top: 6px; word-break: break-all;">
                            ${escapeHtml(d.id.substring(0, 30))}...
                        </div>
                        <div style="display: flex; gap: 15px; margin-top: 8px; font-size: 0.8rem;">
                            ${d.connected 
                                ? `<span style="color: #10b981;">● Conectado</span><span style="color: var(--text-dim);">📍 ${escapeHtml(d.address || 'LAN')}</span>` 
                                : '<span style="color: #6b7280;">○ Desconectado</span>'}
                        </div>
                    </div>
                    <div style="display: flex; gap: 6px;">
                        <button class="rename-device-btn" data-device-id="${escapeHtml(d.id)}" data-device-name="${escapeHtml(d.name)}"
                            style="padding: 6px 10px; background: #6b7280; color: #fff; border: none; border-radius: 6px; cursor: pointer; font-size: 0.85rem;" 
                            title="Renombrar">
                            ✏️
                        </button>
                        <button class="delete-device-btn" data-device-id="${escapeHtml(d.id)}" 
                            style="padding: 6px 10px; background: #ef4444; color: #fff; border: none; border-radius: 6px; cursor: pointer; font-size: 0.85rem;"
                            title="Eliminar">
                            🗑️
                        </button>
                    </div>
                </div>
            </div>
        `).join('');
        
        // Attach event listeners
        listDiv.querySelectorAll('.rename-device-btn').forEach(btn => {
            btn.addEventListener('click', () => showRenameDeviceModal(btn.dataset.deviceId, btn.dataset.deviceName));
        });
        listDiv.querySelectorAll('.delete-device-btn').forEach(btn => {
            btn.addEventListener('click', () => deleteDevice(btn.dataset.deviceId));
        });
    } catch (e) {
        listDiv.innerHTML = `<p style="color: #ef4444;">Error: ${escapeHtml(e.message)}</p>`;
    }
}

// Rename device modal
function showRenameDeviceModal(deviceId, currentName) {
    const modal = document.createElement('div');
    modal.id = 'rename-device-modal';
    modal.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.8); display: flex; align-items: center; justify-content: center; z-index: 99999;';
    modal.innerHTML = `
        <div style="background: #1a1a2e; padding: 25px; border-radius: 12px; width: 90%; max-width: 400px;">
            <h3 style="color: #22d3ee; margin-bottom: 20px;">✏️ Renombrar Dispositivo</h3>
            <div style="margin-bottom: 20px;">
                <label style="color: #9ca3af; font-size: 0.9rem;">Nombre:</label>
                <input type="text" id="device-new-name" value="${escapeHtml(currentName)}"
                    style="width: 100%; padding: 12px; margin-top: 5px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); border-radius: 6px; color: #fff;">
            </div>
            <div style="display: flex; gap: 10px; justify-content: flex-end;">
                <button id="rename-cancel-btn"
                    style="padding: 10px 20px; background: #4b5563; color: #fff; border: none; border-radius: 6px; cursor: pointer;">
                    Cancelar
                </button>
                <button id="rename-save-btn"
                    style="padding: 10px 20px; background: #a78bfa; color: #000; border: none; border-radius: 6px; cursor: pointer; font-weight: 600;">
                    Guardar
                </button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    
    const input = document.getElementById('device-new-name');
    input.focus();
    input.select();
    
    document.getElementById('rename-cancel-btn').addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
    
    document.getElementById('rename-save-btn').addEventListener('click', async () => {
        const newName = input.value.trim();
        if (!newName) {
            showNotification('El nombre es obligatorio', 'error');
            return;
        }
        
        try {
            const res = await authFetch(`${API_BASE}/cloud-sync/devices/${encodeURIComponent(deviceId)}/rename`, {
                method: 'POST',
                body: JSON.stringify({ name: newName })
            });
            
            if (!res.ok) throw new Error('Failed to rename');
            
            modal.remove();
            showNotification('Dispositivo renombrado', 'success');
            await loadDevicesList();
        } catch (e) {
            showNotification('Error: ' + e.message, 'error');
        }
    });
    
    // Enter to save
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') document.getElementById('rename-save-btn').click();
    });
}

async function installSyncthing() {
    const installConfirmed = await showConfirmModal(
        '¿Instalar Syncthing?',
        'Esto puede tardar unos minutos mientras se descarga e instala.'
    );
    if (!installConfirmed) return;
    
    const btn = document.getElementById('install-syncthing-btn');
    if (btn) {
        btn.disabled = true;
        btn.textContent = '⏳ Instalando...';
    }
    
    try {
        const res = await authFetch(`${API_BASE}/cloud-sync/install`, { method: 'POST' });
        if (!res.ok) {
            const data = await res.json();
            throw new Error(data.error || 'Installation failed');
        }
        
        showNotification('Syncthing instalado correctamente', 'success');
        await loadCloudSyncStatus();
    } catch (e) {
        showNotification('Error: ' + e.message, 'error');
        if (btn) {
            btn.disabled = false;
            btn.textContent = '📦 Instalar Syncthing';
        }
    }
}

async function startSyncthing() {
    try {
        const res = await authFetch(`${API_BASE}/cloud-sync/start`, { method: 'POST' });
        if (!res.ok) throw new Error('Failed to start');
        
        showNotification('Syncthing iniciado', 'success');
        setTimeout(loadCloudSyncStatus, 2000);
    } catch (e) {
        showNotification('Error: ' + e.message, 'error');
    }
}

async function stopSyncthing() {
    const stopConfirmed = await showConfirmModal(
        '¿Detener Syncthing?',
        'La sincronización se pausará hasta que lo vuelvas a iniciar.'
    );
    if (!stopConfirmed) return;
    
    try {
        const res = await authFetch(`${API_BASE}/cloud-sync/stop`, { method: 'POST' });
        if (!res.ok) throw new Error('Failed to stop');
        
        showNotification('Syncthing detenido', 'success');
        await loadCloudSyncStatus();
    } catch (e) {
        showNotification('Error: ' + e.message, 'error');
    }
}

function showAddFolderModal() {
    const modal = document.createElement('div');
    modal.id = 'add-folder-modal';
    modal.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.8); display: flex; align-items: center; justify-content: center; z-index: 99999;';
    modal.innerHTML = `
        <div style="background: #1a1a2e; padding: 25px; border-radius: 12px; width: 90%; max-width: 500px;">
            <h3 style="color: #a78bfa; margin-bottom: 20px;">📁 Añadir Carpeta Sincronizada</h3>
            <div style="margin-bottom: 15px;">
                <label style="color: #9ca3af; font-size: 0.9rem;">Ruta (relativa a /mnt/storage):</label>
                <input type="text" id="folder-path" placeholder="ej: Documents, Photos, Backup" 
                    style="width: 100%; padding: 12px; margin-top: 5px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); border-radius: 6px; color: #fff;">
            </div>
            <div style="margin-bottom: 20px;">
                <label style="color: #9ca3af; font-size: 0.9rem;">Nombre (opcional):</label>
                <input type="text" id="folder-label" placeholder="Nombre para mostrar"
                    style="width: 100%; padding: 12px; margin-top: 5px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); border-radius: 6px; color: #fff;">
            </div>
            <div style="display: flex; gap: 10px; justify-content: flex-end;">
                <button id="cancel-folder-btn"
                    style="padding: 10px 20px; background: #4b5563; color: #fff; border: none; border-radius: 6px; cursor: pointer;">
                    Cancelar
                </button>
                <button id="add-folder-confirm-btn"
                    style="padding: 10px 20px; background: #a78bfa; color: #000; border: none; border-radius: 6px; cursor: pointer; font-weight: 600;">
                    Añadir
                </button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    document.getElementById('cancel-folder-btn').addEventListener('click', () => modal.remove());
    document.getElementById('add-folder-confirm-btn').addEventListener('click', addFolder);
    document.getElementById('folder-path').focus();
}

async function addFolder() {
    const path = document.getElementById('folder-path')?.value.trim();
    const label = document.getElementById('folder-label')?.value.trim();
    
    if (!path) {
        showNotification('La ruta es obligatoria', 'error');
        return;
    }
    
    try {
        const res = await authFetch(`${API_BASE}/cloud-sync/folders`, {
            method: 'POST',
            body: JSON.stringify({ path, label })
        });
        
        if (!res.ok) {
            const data = await res.json();
            throw new Error(data.error || 'Failed to add folder');
        }
        
        document.getElementById('add-folder-modal')?.remove();
        showNotification('Carpeta añadida', 'success');
        await loadCloudSyncStatus();
    } catch (e) {
        showNotification('Error: ' + e.message, 'error');
    }
}

async function deleteFolder(folderId) {
    // Use custom modal instead of confirm() which has issues in some contexts
    const confirmed = await showConfirmModal(
        '¿Eliminar carpeta?',
        'La carpeta se eliminará de la sincronización. Los archivos no se borrarán del disco.'
    );
    if (!confirmed) return;
    
    // Show loading state
    const foldersList = document.getElementById('folders-list');
    if (foldersList) {
        foldersList.style.opacity = '0.5';
        foldersList.style.pointerEvents = 'none';
    }
    
    try {
        const res = await authFetch(`${API_BASE}/cloud-sync/folders/${encodeURIComponent(folderId)}`, {
            method: 'DELETE'
        });
        
        if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            throw new Error(data.error || 'Failed to delete');
        }
        
        showNotification('Carpeta eliminada', 'success');
        // Force full re-render of Cloud Sync view
        await renderCloudSyncView();
    } catch (e) {
        showNotification('Error: ' + e.message, 'error');
        // Restore state on error
        if (foldersList) {
            foldersList.style.opacity = '1';
            foldersList.style.pointerEvents = 'auto';
        }
    }
}

async function showShareFolderModal(folderId, folderLabel) {
    // Fetch devices and current folder config
    let devices = [];
    let folderDevices = [];
    
    try {
        const devRes = await authFetch(`${API_BASE}/cloud-sync/devices`);
        if (devRes.ok) devices = await devRes.json();
        
        const statusRes = await authFetch(`${API_BASE}/cloud-sync/status`);
        if (statusRes.ok) {
            const status = await statusRes.json();
            const folder = status.folders?.find(f => f.id === folderId);
            folderDevices = folder?.deviceIds || [];
        }
    } catch (e) {
        console.error('Error loading devices:', e);
    }
    
    if (devices.length === 0) {
        showNotification('No hay dispositivos añadidos. Primero añade un dispositivo.', 'warning');
        return;
    }
    
    const modal = document.createElement('div');
    modal.id = 'share-folder-modal';
    modal.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.8); display: flex; align-items: center; justify-content: center; z-index: 99999;';
    modal.innerHTML = `
        <div style="background: #1a1a2e; padding: 25px; border-radius: 12px; width: 90%; max-width: 450px;">
            <h3 style="color: #22d3ee; margin-bottom: 20px;">📤 Compartir "${escapeHtml(folderLabel)}"</h3>
            <p style="color: #9ca3af; margin-bottom: 15px; font-size: 0.9rem;">
                Selecciona los dispositivos con los que quieres sincronizar esta carpeta:
            </p>
            <div id="share-devices-list" style="max-height: 300px; overflow-y: auto;">
                ${devices.map(d => `
                    <label style="display: flex; align-items: center; gap: 12px; padding: 12px; background: rgba(255,255,255,0.05); border-radius: 8px; margin-bottom: 8px; cursor: pointer;">
                        <input type="checkbox" class="share-device-checkbox" data-device-id="${escapeHtml(d.id)}" 
                            ${folderDevices.includes(d.id) ? 'checked' : ''}
                            style="width: 18px; height: 18px; cursor: pointer;">
                        <div>
                            <div style="color: #e5e7eb; font-weight: 500;">${d.connected ? '🟢' : '⚪'} ${escapeHtml(d.name)}</div>
                            <div style="color: #9ca3af; font-size: 0.8rem;">${escapeHtml(d.id.substring(0, 15))}...</div>
                        </div>
                    </label>
                `).join('')}
            </div>
            <div style="display: flex; gap: 12px; margin-top: 20px;">
                <button id="share-cancel-btn" style="flex: 1; padding: 12px; background: #4b5563; color: #fff; border: none; border-radius: 8px; cursor: pointer;">
                    Cancelar
                </button>
                <button id="share-save-btn" style="flex: 1; padding: 12px; background: #22c55e; color: #fff; border: none; border-radius: 8px; cursor: pointer; font-weight: 600;">
                    💾 Guardar
                </button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    
    // Cancel button
    document.getElementById('share-cancel-btn').addEventListener('click', () => modal.remove());
    
    // Backdrop click
    modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.remove();
    });
    
    // Save button
    document.getElementById('share-save-btn').addEventListener('click', async () => {
        const checkboxes = modal.querySelectorAll('.share-device-checkbox:checked');
        const selectedDevices = Array.from(checkboxes).map(cb => cb.dataset.deviceId);
        
        const saveBtn = document.getElementById('share-save-btn');
        saveBtn.disabled = true;
        saveBtn.textContent = 'Guardando...';
        
        try {
            // Share with each selected device
            for (const deviceId of selectedDevices) {
                if (!folderDevices.includes(deviceId)) {
                    await authFetch(`${API_BASE}/cloud-sync/folders/${encodeURIComponent(folderId)}/share`, {
                        method: 'POST',
                        body: JSON.stringify({ deviceId })
                    });
                }
            }
            
            // TODO: Unshare removed devices (need backend endpoint)
            
            modal.remove();
            showNotification('Carpeta compartida correctamente', 'success');
            await renderCloudSyncView();
        } catch (e) {
            showNotification('Error: ' + e.message, 'error');
            saveBtn.disabled = false;
            saveBtn.textContent = '💾 Guardar';
        }
    });
}

function showAddDeviceModal() {
    const modal = document.createElement('div');
    modal.id = 'add-device-modal';
    modal.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.8); display: flex; align-items: center; justify-content: center; z-index: 99999;';
    modal.innerHTML = `
        <div style="background: #1a1a2e; padding: 25px; border-radius: 12px; width: 90%; max-width: 500px;">
            <h3 style="color: #22d3ee; margin-bottom: 20px;">📱 Añadir Dispositivo</h3>
            <p style="color: #9ca3af; margin-bottom: 15px; font-size: 0.9rem;">
                Copia el Device ID de Syncthing desde tu PC o móvil (Ajustes → Mostrar ID).
            </p>
            <div style="margin-bottom: 15px;">
                <label style="color: #9ca3af; font-size: 0.9rem;">Device ID:</label>
                <input type="text" id="device-id" placeholder="XXXXXXX-XXXXXXX-XXXXXXX-XXXXXXX-XXXXXXX-XXXXXXX-XXXXXXX-XXXXXXX"
                    style="width: 100%; padding: 12px; margin-top: 5px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); border-radius: 6px; color: #fff; font-family: monospace; font-size: 0.8rem;">
            </div>
            <div style="margin-bottom: 20px;">
                <label style="color: #9ca3af; font-size: 0.9rem;">Nombre:</label>
                <input type="text" id="device-name" placeholder="Mi PC, iPhone, etc."
                    style="width: 100%; padding: 12px; margin-top: 5px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); border-radius: 6px; color: #fff;">
            </div>
            <div style="display: flex; gap: 10px; justify-content: flex-end;">
                <button id="cancel-device-btn"
                    style="padding: 10px 20px; background: #4b5563; color: #fff; border: none; border-radius: 6px; cursor: pointer;">
                    Cancelar
                </button>
                <button id="add-device-confirm-btn"
                    style="padding: 10px 20px; background: #22d3ee; color: #000; border: none; border-radius: 6px; cursor: pointer; font-weight: 600;">
                    Añadir
                </button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    document.getElementById('cancel-device-btn').addEventListener('click', () => modal.remove());
    document.getElementById('add-device-confirm-btn').addEventListener('click', addDevice);
    document.getElementById('device-id').focus();
}

async function addDevice() {
    const deviceId = document.getElementById('device-id')?.value.trim().toUpperCase();
    const name = document.getElementById('device-name')?.value.trim();
    
    if (!deviceId) {
        showNotification('El Device ID es obligatorio', 'error');
        return;
    }
    
    try {
        const res = await authFetch(`${API_BASE}/cloud-sync/devices`, {
            method: 'POST',
            body: JSON.stringify({ deviceId, name: name || 'New Device' })
        });
        
        if (!res.ok) {
            const data = await res.json();
            throw new Error(data.error || 'Failed to add device');
        }
        
        document.getElementById('add-device-modal')?.remove();
        showNotification('Dispositivo añadido', 'success');
        await loadDevicesList();
    } catch (e) {
        showNotification('Error: ' + e.message, 'error');
    }
}

async function deleteDevice(deviceId) {
    const deleteDeviceConfirmed = await showConfirmModal(
        '¿Eliminar dispositivo?',
        'Se dejará de sincronizar con este dispositivo.'
    );
    if (!deleteDeviceConfirmed) return;
    
    try {
        const res = await authFetch(`${API_BASE}/cloud-sync/devices/${encodeURIComponent(deviceId)}`, {
            method: 'DELETE'
        });
        
        if (!res.ok) throw new Error('Failed to delete');
        
        showNotification('Dispositivo eliminado', 'success');
        await loadDevicesList();
    } catch (e) {
        showNotification('Error: ' + e.message, 'error');
    }
}

// =============================================================================
// HOMESTORE - APP MARKETPLACE
// =============================================================================

let homestoreCatalog = null;
let homestoreFilter = 'all';
let systemArch = null;

async function renderHomeStoreView() {
    dashboardContent.innerHTML = `
        <div class="section">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
                <h2>🏪 HomeStore</h2>
                <div id="homestore-status" style="display: flex; gap: 15px; align-items: center;">
                    <div id="homestore-arch-status"></div>
                    <div id="homestore-docker-status"></div>
                </div>
            </div>
            <p style="color: var(--text-secondary); margin-bottom: 20px;">
                Instala aplicaciones con un clic. Todas funcionan sobre Docker.
            </p>
            
            <div id="homestore-categories" style="display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 20px;"></div>
            
            <div id="homestore-apps" class="grid-3" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 20px;"></div>
        </div>
    `;
    
    await loadHomeStoreCatalog();
}

async function loadHomeStoreCatalog() {
    const appsDiv = document.getElementById('homestore-apps');
    const categoriesDiv = document.getElementById('homestore-categories');
    const dockerStatusDiv = document.getElementById('homestore-docker-status');
    const archStatusDiv = document.getElementById('homestore-arch-status');
    
    try {
        // Detect system architecture
        if (!systemArch) {
            try {
                const archRes = await authFetch(`${API_BASE}/system/arch`);
                if (archRes.ok) {
                    systemArch = await archRes.json();
                }
            } catch (e) {
                console.warn('Could not detect architecture:', e);
                systemArch = { arch: 'unknown', isArm: false, isX86: false };
            }
        }
        
        // Show architecture
        if (archStatusDiv && systemArch) {
            const archLabel = systemArch.isArm ? 'ARM' : (systemArch.isX86 ? 'x86' : systemArch.arch);
            const archIcon = systemArch.isArm ? '🍓' : '💻';
            archStatusDiv.innerHTML = `<span style="color: var(--text-secondary);">${archIcon} ${archLabel.toUpperCase()}</span>`;
        }
        
        // Check Docker status
        const dockerRes = await authFetch(`${API_BASE}/homestore/check-docker`);
        const dockerData = await dockerRes.json();
        
        if (!dockerData.available) {
            dockerStatusDiv.innerHTML = `<span style="color: #ef4444;">⚠️ Docker no disponible</span>`;
            appsDiv.innerHTML = `
                <div style="grid-column: 1 / -1; text-align: center; padding: 40px; color: var(--text-secondary);">
                    <p style="font-size: 48px; margin-bottom: 20px;">🐳</p>
                    <p>Docker no está instalado o no está corriendo.</p>
                    <p style="margin-top: 10px;">Instala Docker primero desde el Gestor de Docker.</p>
                    <button onclick="navigateTo('/docker')" class="btn" style="margin-top: 20px; background: var(--primary); color: #000; padding: 10px 20px; border: none; border-radius: 8px; cursor: pointer;">
                        Ir a Gestor de Docker
                    </button>
                </div>
            `;
            return;
        }
        
        dockerStatusDiv.innerHTML = `<span style="color: #10b981;">✓ Docker activo</span>`;
        
        // Load catalog
        const res = await authFetch(`${API_BASE}/homestore/catalog`);
        const data = await res.json();
        
        if (!data.success) throw new Error(data.error);
        
        homestoreCatalog = data;
        
        // Render categories
        const categories = Object.entries(data.categories).sort((a, b) => a[1].order - b[1].order);
        categoriesDiv.innerHTML = `
            <button class="homestore-cat-btn ${homestoreFilter === 'all' ? 'active' : ''}" data-cat="all" 
                    style="padding: 8px 16px; border-radius: 20px; border: 1px solid var(--border); background: ${homestoreFilter === 'all' ? 'var(--primary)' : 'var(--bg-card)'}; color: ${homestoreFilter === 'all' ? '#000' : 'var(--text)'}; cursor: pointer;">
                Todas
            </button>
            <button class="homestore-cat-btn ${homestoreFilter === 'installed' ? 'active' : ''}" data-cat="installed"
                    style="padding: 8px 16px; border-radius: 20px; border: 1px solid var(--border); background: ${homestoreFilter === 'installed' ? 'var(--primary)' : 'var(--bg-card)'}; color: ${homestoreFilter === 'installed' ? '#000' : 'var(--text)'}; cursor: pointer;">
                ✓ Instaladas
            </button>
            ${categories.map(([id, cat]) => `
                <button class="homestore-cat-btn ${homestoreFilter === id ? 'active' : ''}" data-cat="${id}"
                        style="padding: 8px 16px; border-radius: 20px; border: 1px solid var(--border); background: ${homestoreFilter === id ? 'var(--primary)' : 'var(--bg-card)'}; color: ${homestoreFilter === id ? '#000' : 'var(--text)'}; cursor: pointer;">
                    ${cat.icon} ${cat.name}
                </button>
            `).join('')}
        `;
        
        // Add category click handlers
        categoriesDiv.querySelectorAll('.homestore-cat-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                homestoreFilter = btn.dataset.cat;
                loadHomeStoreCatalog();
            });
        });
        
        // Filter apps
        let apps = data.apps;
        if (homestoreFilter === 'installed') {
            apps = apps.filter(app => app.installed);
        } else if (homestoreFilter !== 'all') {
            apps = apps.filter(app => app.category === homestoreFilter);
        }
        
        // Render apps
        if (apps.length === 0) {
            appsDiv.innerHTML = `
                <div style="grid-column: 1 / -1; text-align: center; padding: 40px; color: var(--text-secondary);">
                    <p>No hay aplicaciones en esta categoría.</p>
                </div>
            `;
            return;
        }
        
        appsDiv.innerHTML = apps.map(app => renderHomeStoreAppCard(app, data.categories)).join('');
        
        // Add button handlers
        apps.forEach(app => {
            const card = document.getElementById(`homestore-app-${app.id}`);
            if (!card) return;
            
            card.querySelector('.homestore-install-btn')?.addEventListener('click', () => installHomeStoreApp(app.id));
            card.querySelector('.homestore-uninstall-btn')?.addEventListener('click', () => uninstallHomeStoreApp(app.id));
            card.querySelector('.homestore-start-btn')?.addEventListener('click', () => startHomeStoreApp(app.id));
            card.querySelector('.homestore-stop-btn')?.addEventListener('click', () => stopHomeStoreApp(app.id));
            card.querySelector('.homestore-open-btn')?.addEventListener('click', () => openHomeStoreApp(app));
            card.querySelector('.homestore-logs-btn')?.addEventListener('click', () => showHomeStoreAppLogs(app.id));
            card.querySelector('.homestore-update-btn')?.addEventListener('click', () => updateHomeStoreApp(app.id));
        });
        
    } catch (error) {
        console.error('Error loading HomeStore:', error);
        appsDiv.innerHTML = `
            <div style="grid-column: 1 / -1; text-align: center; padding: 40px; color: #ef4444;">
                <p>Error al cargar el catálogo: ${error.message}</p>
                <button onclick="loadHomeStoreCatalog()" class="btn" style="margin-top: 20px;">Reintentar</button>
            </div>
        `;
    }
}

function renderHomeStoreAppCard(app, categories) {
    const cat = categories[app.category] || { name: app.category, icon: '📦' };
    const isRunning = app.status === 'running';
    const isStopped = app.status === 'stopped';
    
    // Check architecture compatibility
    const appArch = app.arch || ['amd64', 'arm64', 'arm']; // Default to all if not specified
    const isCompatible = !systemArch || systemArch.arch === 'unknown' || appArch.includes(systemArch.arch);
    const archNote = app.archNote || '';
    
    let statusBadge = '';
    let actionButtons = '';
    let compatWarning = '';
    
    if (!isCompatible) {
        compatWarning = `
            <div style="background: #fef3c7; border: 1px solid #f59e0b; border-radius: 8px; padding: 8px 12px; margin-bottom: 12px; font-size: 0.85rem; color: #92400e;">
                ⚠️ No compatible con ${systemArch.arch.toUpperCase()}${archNote ? ` — ${archNote}` : ''}
            </div>
        `;
    }
    
    if (app.installed) {
        if (isRunning) {
            statusBadge = `<span style="background: #10b981; color: #fff; padding: 4px 12px; border-radius: 12px; font-size: 0.8rem;">● Activa</span>`;
            actionButtons = `
                <button class="homestore-open-btn" style="background: var(--primary); color: #000; padding: 8px 16px; border: none; border-radius: 6px; cursor: pointer; font-weight: 500;">
                    Abrir
                </button>
                <button class="homestore-stop-btn" style="background: #6b7280; color: #fff; padding: 8px 12px; border: none; border-radius: 6px; cursor: pointer;">
                    ⏹ Parar
                </button>
                <button class="homestore-logs-btn" style="background: transparent; border: 1px solid var(--border); color: var(--text); padding: 8px 12px; border-radius: 6px; cursor: pointer;">
                    📋
                </button>
            `;
        } else {
            statusBadge = `<span style="background: #6b7280; color: #fff; padding: 4px 12px; border-radius: 12px; font-size: 0.8rem;">○ Parada</span>`;
            actionButtons = `
                <button class="homestore-start-btn" style="background: #10b981; color: #fff; padding: 8px 16px; border: none; border-radius: 6px; cursor: pointer; font-weight: 500;">
                    ▶ Iniciar
                </button>
                <button class="homestore-uninstall-btn" style="background: #ef4444; color: #fff; padding: 8px 12px; border: none; border-radius: 6px; cursor: pointer;">
                    🗑
                </button>
                <button class="homestore-update-btn" style="background: transparent; border: 1px solid var(--border); color: var(--text); padding: 8px 12px; border-radius: 6px; cursor: pointer;">
                    ↻
                </button>
            `;
        }
    } else {
        if (isCompatible) {
            actionButtons = `
                <button class="homestore-install-btn" style="background: var(--primary); color: #000; padding: 8px 20px; border: none; border-radius: 6px; cursor: pointer; font-weight: 500;">
                    Instalar
                </button>
                <a href="${app.docs}" target="_blank" style="background: transparent; border: 1px solid var(--border); color: var(--text); padding: 8px 12px; border-radius: 6px; text-decoration: none; display: inline-block;">
                    📖 Docs
                </a>
            `;
        } else {
            actionButtons = `
                <button disabled style="background: #6b7280; color: #fff; padding: 8px 20px; border: none; border-radius: 6px; cursor: not-allowed; font-weight: 500; opacity: 0.6;">
                    No disponible
                </button>
                <a href="${app.docs}" target="_blank" style="background: transparent; border: 1px solid var(--border); color: var(--text); padding: 8px 12px; border-radius: 6px; text-decoration: none; display: inline-block;">
                    📖 Docs
                </a>
            `;
        }
    }
    
    // Show supported architectures
    const archBadges = appArch.map(a => {
        const isCurrentArch = systemArch && systemArch.arch === a;
        return `<span style="background: ${isCurrentArch ? '#10b981' : 'var(--bg-card)'}; color: ${isCurrentArch ? '#fff' : 'var(--text-secondary)'}; padding: 2px 6px; border-radius: 4px; font-size: 0.7rem; border: 1px solid var(--border);">${a}</span>`;
    }).join(' ');
    
    // Build config info section for installed apps
    let configInfoHtml = '';
    if (app.installed && app.config) {
        const configVolumes = app.config.volumes || app.volumes || {};
        const configPorts = app.config.ports || app.ports || {};
        
        // Show key paths (first 2 volumes)
        const volumeEntries = Object.entries(configVolumes).slice(0, 2);
        const volumeInfo = volumeEntries.map(([container, host]) => {
            const shortPath = host.length > 30 ? '...' + host.slice(-27) : host;
            return `<span style="font-family: monospace; font-size: 0.75rem; color: var(--text-secondary);" title="${escapeHtml(host)}">📁 ${escapeHtml(shortPath)}</span>`;
        }).join('<br>');
        
        // Show port
        const portEntry = Object.entries(configPorts)[0];
        const portInfo = portEntry ? `<span style="font-family: monospace; font-size: 0.75rem; color: var(--text-secondary);">🌐 :${escapeHtml(portEntry[0].split('/')[0])}</span>` : '';
        
        if (volumeInfo || portInfo) {
            configInfoHtml = `
                <div style="background: rgba(255,255,255,0.03); border: 1px solid var(--border); border-radius: 8px; padding: 10px 12px; margin-bottom: 12px; font-size: 0.8rem;">
                    <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 12px;">
                        <div style="flex: 1; line-height: 1.6;">${volumeInfo}</div>
                        <div>${portInfo}</div>
                    </div>
                </div>
            `;
        }
    }
    
    return `
        <div id="homestore-app-${app.id}" class="card" style="background: rgba(30, 30, 50, 0.7); border: 2px solid ${isCompatible ? 'rgba(100, 100, 140, 0.5)' : '#f59e0b'}; border-radius: 12px; padding: 20px; box-shadow: 0 2px 8px rgba(0,0,0,0.3); ${!isCompatible ? 'opacity: 0.7;' : ''}">
            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px;">
                <div style="display: flex; align-items: center; gap: 12px;">
                    <span style="font-size: 2rem;">${app.icon}</span>
                    <div>
                        <h3 style="margin: 0; font-size: 1.1rem;">${app.name}</h3>
                        <span style="color: var(--text-secondary); font-size: 0.85rem;">${cat.icon} ${cat.name}</span>
                    </div>
                </div>
                ${statusBadge}
            </div>
            ${compatWarning}
            <p style="color: var(--text-secondary); font-size: 0.9rem; margin-bottom: 12px; line-height: 1.4;">
                ${app.description}
            </p>
            ${configInfoHtml}
            <div style="margin-bottom: 12px;">
                ${archBadges}
            </div>
            <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                ${actionButtons}
            </div>
        </div>
    `;
}

// Show configuration modal before installing an app
async function showHomeStoreConfigModal(appId) {
    // Remove any existing modals first
    const existingModal = document.getElementById('homestore-config-modal');
    if (existingModal) existingModal.remove();
    const existingPicker = document.getElementById('folder-picker-modal');
    if (existingPicker) existingPicker.remove();
    
    // Find the app in the catalog
    const app = homestoreCatalog?.apps?.find(a => a.id === appId);
    if (!app) {
        showNotification('App no encontrada en el catálogo', 'error');
        return;
    }
    
    // Try to load previous configuration for reinstalls
    let previousConfig = null;
    try {
        const configRes = await authFetch(`${API_BASE}/homestore/app/${appId}/config`);
        if (configRes.ok) {
            const configData = await configRes.json();
            if (configData.success && configData.config) {
                previousConfig = configData.config;
            }
        }
    } catch (e) {
        // No previous config, that's fine
    }
    
    // Build volume config inputs
    const defaultVolumes = app.volumes || {};
    const volumeInputs = Object.entries(defaultVolumes).map(([containerPath, hostPath]) => {
        // Use previous config if available
        const savedPath = previousConfig?.volumes?.[containerPath] || hostPath;
        const isConfigDir = containerPath.toLowerCase().includes('config') || containerPath.toLowerCase().includes('data');
        const isMediaDir = containerPath.toLowerCase().includes('media') || 
                          containerPath.toLowerCase().includes('download') || 
                          containerPath.toLowerCase().includes('photos') ||
                          containerPath.toLowerCase().includes('storage');
        
        let label = containerPath;
        let icon = '📁';
        if (isConfigDir) {
            label = 'Configuración';
            icon = '⚙️';
        } else if (isMediaDir) {
            label = 'Media/Datos';
            icon = '🎬';
        }
        
        return `
            <div class="homestore-config-volume" style="margin-bottom: 16px;">
                <label style="color: var(--text-secondary); font-size: 0.85rem; display: block; margin-bottom: 6px;">
                    ${icon} ${escapeHtml(label)} <code style="font-size: 0.75rem; opacity: 0.7;">(${escapeHtml(containerPath)})</code>
                </label>
                <div style="display: flex; gap: 8px;">
                    <input type="text" 
                           class="homestore-volume-input" 
                           data-container-path="${escapeHtml(containerPath)}"
                           value="${escapeHtml(savedPath)}"
                           placeholder="${escapeHtml(hostPath)}"
                           style="flex: 1; padding: 10px 12px; background: rgba(255,255,255,0.1); border: 1px solid #3a3a5e; border-radius: 8px; color: #fff; font-family: monospace; font-size: 0.9rem;">
                    <button type="button" class="homestore-browse-btn" data-target="${escapeHtml(containerPath)}"
                            style="padding: 10px 14px; background: rgba(255,255,255,0.1); border: 1px solid var(--border); border-radius: 8px; cursor: pointer; color: var(--text);"
                            title="Explorar carpetas">
                        📂
                    </button>
                </div>
            </div>
        `;
    }).join('');
    
    // Build port config if applicable
    const defaultPorts = app.ports || {};
    const portInputs = Object.entries(defaultPorts).map(([hostPort, containerPort]) => {
        const savedPort = previousConfig?.ports?.[hostPort] || hostPort;
        return `
            <div class="homestore-config-port" style="margin-bottom: 12px;">
                <label style="color: var(--text-secondary); font-size: 0.85rem; display: block; margin-bottom: 6px;">
                    🌐 Puerto ${escapeHtml(String(containerPort).replace('/udp', ' (UDP)').replace('/tcp', ''))}
                </label>
                <div style="display: flex; align-items: center; gap: 8px;">
                    <input type="number" 
                           class="homestore-port-input" 
                           data-original-port="${escapeHtml(hostPort)}"
                           data-container-port="${escapeHtml(containerPort)}"
                           value="${escapeHtml(savedPort.toString().split('/')[0])}"
                           min="1" max="65535"
                           style="width: 100px; padding: 10px 12px; background: rgba(255,255,255,0.1); border: 1px solid #3a3a5e; border-radius: 8px; color: #fff; font-family: monospace;">
                    <span style="color: var(--text-secondary);">→ ${escapeHtml(containerPort)}</span>
                </div>
            </div>
        `;
    }).join('');
    
    // Build environment variables if applicable
    const defaultEnv = app.env || {};
    const envInputs = Object.entries(defaultEnv).length > 0 ? Object.entries(defaultEnv).map(([key, value]) => {
        const savedValue = previousConfig?.env?.[key] ?? value;
        const isPassword = key.toLowerCase().includes('password') || key.toLowerCase().includes('secret');
        return `
            <div class="homestore-config-env" style="margin-bottom: 12px;">
                <label style="color: var(--text-secondary); font-size: 0.85rem; display: block; margin-bottom: 6px;">
                    ${isPassword ? '🔑' : '📝'} ${escapeHtml(key)}
                </label>
                <input type="${isPassword ? 'password' : 'text'}" 
                       class="homestore-env-input" 
                       data-env-key="${escapeHtml(key)}"
                       value="${escapeHtml(savedValue)}"
                       placeholder="${escapeHtml(value)}"
                       style="width: 100%; padding: 10px 12px; background: rgba(255,255,255,0.1); border: 1px solid #3a3a5e; border-radius: 8px; color: #fff; font-family: monospace; font-size: 0.9rem;">
            </div>
        `;
    }).join('') : '';
    
    // Create the modal
    const modal = document.createElement('div');
    modal.id = 'homestore-config-modal';
    modal.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.92); display: flex; align-items: center; justify-content: center; z-index: 100000; backdrop-filter: blur(4px);';
    modal.innerHTML = `
        <div style="background: #1a1a2e; border: 1px solid #3a3a5e; border-radius: 16px; width: 90%; max-width: 600px; max-height: 85vh; overflow: hidden; display: flex; flex-direction: column; box-shadow: 0 25px 50px rgba(0,0,0,0.5);">
            <div style="padding: 20px 24px; border-bottom: 1px solid #3a3a5e; display: flex; justify-content: space-between; align-items: center; background: #1a1a2e;">
                <div style="display: flex; align-items: center; gap: 12px;">
                    <span style="font-size: 2rem;">${app.icon}</span>
                    <div>
                        <h3 style="margin: 0; font-size: 1.2rem; color: var(--text);">Configurar ${escapeHtml(app.name)}</h3>
                        <span style="color: var(--text-secondary); font-size: 0.85rem;">Personaliza la instalación</span>
                    </div>
                </div>
                <button id="homestore-config-close" style="background: none; border: none; font-size: 1.5rem; cursor: pointer; color: var(--text-secondary); padding: 4px 8px;">&times;</button>
            </div>
            
            <div style="padding: 24px; overflow-y: auto; flex: 1;">
                ${previousConfig ? `
                    <div style="background: rgba(34, 197, 94, 0.1); border: 1px solid #22c55e; border-radius: 8px; padding: 12px 16px; margin-bottom: 20px; display: flex; align-items: center; gap: 10px;">
                        <span style="font-size: 1.2rem;">♻️</span>
                        <div>
                            <div style="color: #22c55e; font-weight: 500;">Configuración anterior encontrada</div>
                            <div style="color: var(--text-secondary); font-size: 0.85rem;">Se han restaurado los paths de la instalación previa</div>
                        </div>
                    </div>
                ` : ''}
                
                ${volumeInputs ? `
                    <div style="margin-bottom: 24px;">
                        <h4 style="color: var(--primary); margin: 0 0 16px 0; font-size: 1rem; display: flex; align-items: center; gap: 8px;">
                            📂 Rutas de almacenamiento
                        </h4>
                        ${volumeInputs}
                    </div>
                ` : ''}
                
                ${portInputs ? `
                    <div style="margin-bottom: 24px;">
                        <h4 style="color: var(--primary); margin: 0 0 16px 0; font-size: 1rem; display: flex; align-items: center; gap: 8px;">
                            🌐 Puertos
                        </h4>
                        ${portInputs}
                    </div>
                ` : ''}
                
                ${envInputs ? `
                    <div style="margin-bottom: 24px;">
                        <h4 style="color: var(--primary); margin: 0 0 16px 0; font-size: 1rem; display: flex; align-items: center; gap: 8px;">
                            ⚙️ Variables de entorno
                        </h4>
                        ${envInputs}
                    </div>
                ` : ''}
            </div>
            
            <div style="padding: 16px 24px; border-top: 1px solid var(--border); display: flex; gap: 12px; justify-content: flex-end;">
                <button id="homestore-config-cancel" style="padding: 12px 24px; background: rgba(255,255,255,0.1); border: 1px solid #3a3a5e; border-radius: 8px; cursor: pointer; color: #fff; font-size: 0.95rem;">
                    Cancelar
                </button>
                <button id="homestore-config-install" style="padding: 12px 24px; background: var(--primary); border: none; border-radius: 8px; cursor: pointer; color: #000; font-weight: 600; font-size: 0.95rem; display: flex; align-items: center; gap: 8px;">
                    🚀 Instalar
                </button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    // Close handlers - also remove any picker modals
    const closeModal = () => {
        const pickerModal = document.getElementById('folder-picker-modal');
        if (pickerModal) pickerModal.remove();
        modal.remove();
    };
    document.getElementById('homestore-config-close').addEventListener('click', closeModal);
    document.getElementById('homestore-config-cancel').addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
    
    // Browse button handlers - open folder picker
    modal.querySelectorAll('.homestore-browse-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const targetPath = btn.dataset.target;
            const input = modal.querySelector(`.homestore-volume-input[data-container-path="${targetPath}"]`);
            if (!input) return;
            
            // Simple folder picker modal
            const currentPath = input.value || '/mnt/storage';
            const pickerModal = document.createElement('div');
            pickerModal.id = 'folder-picker-modal';
            pickerModal.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.9); display: flex; align-items: center; justify-content: center; z-index: 999999;';
            
            pickerModal.innerHTML = `
                <div style="background: var(--bg-card); border: 1px solid var(--border); border-radius: 12px; width: 90%; max-width: 500px; max-height: 70vh; display: flex; flex-direction: column;">
                    <div style="padding: 16px 20px; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center;">
                        <h3 style="margin: 0; font-size: 1rem;">📂 Seleccionar carpeta</h3>
                        <button id="folder-picker-close" style="background: none; border: none; font-size: 1.3rem; cursor: pointer; color: var(--text-secondary);">&times;</button>
                    </div>
                    <div style="padding: 16px 20px;">
                        <div style="display: flex; gap: 8px; margin-bottom: 16px;">
                            <input type="text" id="folder-picker-path" value="${escapeHtml(currentPath)}" 
                                   style="flex: 1; padding: 10px 12px; background: rgba(255,255,255,0.05); border: 1px solid var(--border); border-radius: 8px; color: var(--text); font-family: monospace;">
                            <button id="folder-picker-go" style="padding: 10px 14px; background: var(--primary); border: none; border-radius: 8px; cursor: pointer; color: #000;">Ir</button>
                        </div>
                        <div id="folder-picker-list" style="max-height: 300px; overflow-y: auto; background: rgba(0,0,0,0.2); border-radius: 8px; padding: 8px;">
                            <div style="padding: 20px; text-align: center; color: var(--text-secondary);">Cargando...</div>
                        </div>
                    </div>
                    <div style="padding: 12px 20px; border-top: 1px solid var(--border); display: flex; gap: 8px; justify-content: flex-end;">
                        <button id="folder-picker-cancel" style="padding: 10px 20px; background: rgba(255,255,255,0.1); border: 1px solid var(--border); border-radius: 8px; cursor: pointer; color: var(--text);">Cancelar</button>
                        <button id="folder-picker-select" style="padding: 10px 20px; background: var(--primary); border: none; border-radius: 8px; cursor: pointer; color: #000; font-weight: 600;">Seleccionar</button>
                    </div>
                </div>
            `;
            
            document.body.appendChild(pickerModal);
            
            const pathInput = document.getElementById('folder-picker-path');
            const listDiv = document.getElementById('folder-picker-list');
            
            async function loadFolders(path) {
                listDiv.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--text-secondary);">Cargando...</div>';
                try {
                    const res = await authFetch(`${API_BASE}/files/list?path=${encodeURIComponent(path)}`);
                    const data = await res.json();
                    
                    if (!data.success && data.error) {
                        listDiv.innerHTML = `<div style="padding: 20px; text-align: center; color: #ef4444;">${escapeHtml(data.error)}</div>`;
                        return;
                    }
                    
                    const folders = (data.files || []).filter(f => f.isDirectory);
                    
                    // Add parent directory option
                    let html = '';
                    if (path !== '/') {
                        html += `<div class="folder-item" data-path="${escapeHtml(path.split('/').slice(0, -1).join('/') || '/')}" 
                                     style="padding: 10px 12px; cursor: pointer; display: flex; align-items: center; gap: 8px; border-radius: 6px; margin-bottom: 4px;"
                                     onmouseover="this.style.background='rgba(255,255,255,0.1)'" onmouseout="this.style.background='transparent'">
                                    📁 <span style="color: var(--text-secondary);">..</span>
                                 </div>`;
                    }
                    
                    folders.forEach(f => {
                        const fullPath = path === '/' ? `/${f.name}` : `${path}/${f.name}`;
                        html += `<div class="folder-item" data-path="${escapeHtml(fullPath)}" 
                                     style="padding: 10px 12px; cursor: pointer; display: flex; align-items: center; gap: 8px; border-radius: 6px; margin-bottom: 4px;"
                                     onmouseover="this.style.background='rgba(255,255,255,0.1)'" onmouseout="this.style.background='transparent'">
                                    📁 ${escapeHtml(f.name)}
                                 </div>`;
                    });
                    
                    if (folders.length === 0 && path !== '/') {
                        html += '<div style="padding: 20px; text-align: center; color: var(--text-secondary);">Sin subcarpetas</div>';
                    }
                    
                    listDiv.innerHTML = html || '<div style="padding: 20px; text-align: center; color: var(--text-secondary);">Vacío</div>';
                    
                    // Add click handlers for folders
                    listDiv.querySelectorAll('.folder-item').forEach(item => {
                        item.addEventListener('click', () => {
                            pathInput.value = item.dataset.path;
                            loadFolders(item.dataset.path);
                        });
                    });
                } catch (e) {
                    listDiv.innerHTML = `<div style="padding: 20px; text-align: center; color: #ef4444;">Error: ${escapeHtml(e.message)}</div>`;
                }
            }
            
            loadFolders(currentPath.split('/').slice(0, -1).join('/') || '/');
            
            document.getElementById('folder-picker-go').addEventListener('click', () => loadFolders(pathInput.value));
            document.getElementById('folder-picker-close').addEventListener('click', () => pickerModal.remove());
            document.getElementById('folder-picker-cancel').addEventListener('click', () => pickerModal.remove());
            document.getElementById('folder-picker-select').addEventListener('click', () => {
                input.value = pathInput.value;
                pickerModal.remove();
            });
            pickerModal.addEventListener('click', (e) => { if (e.target === pickerModal) pickerModal.remove(); });
        });
    });
    
    // Install button handler
    document.getElementById('homestore-config-install').addEventListener('click', async () => {
        const installBtn = document.getElementById('homestore-config-install');
        installBtn.disabled = true;
        installBtn.innerHTML = '⏳ Instalando...';
        
        // Collect configuration
        const config = {
            volumes: {},
            ports: {},
            env: {}
        };
        
        // Collect volumes
        modal.querySelectorAll('.homestore-volume-input').forEach(input => {
            const containerPath = input.dataset.containerPath;
            const hostPath = input.value.trim();
            if (containerPath && hostPath) {
                config.volumes[containerPath] = hostPath;
            }
        });
        
        // Collect ports
        modal.querySelectorAll('.homestore-port-input').forEach(input => {
            const originalPort = input.dataset.originalPort;
            const containerPort = input.dataset.containerPort;
            const hostPort = input.value.trim();
            if (originalPort && hostPort) {
                // Preserve protocol suffix if present (e.g., /udp)
                const suffix = containerPort.includes('/') ? containerPort.split('/')[1] : '';
                config.ports[suffix ? `${hostPort}/${suffix}` : hostPort] = containerPort;
            }
        });
        
        // Collect environment variables
        modal.querySelectorAll('.homestore-env-input').forEach(input => {
            const key = input.dataset.envKey;
            const value = input.value;
            if (key) {
                config.env[key] = value;
            }
        });
        
        try {
            const res = await authFetch(`${API_BASE}/homestore/install/${appId}`, {
                method: 'POST',
                body: JSON.stringify({ config })
            });
            const data = await res.json();
            
            if (!data.success) throw new Error(data.error);
            
            closeModal();
            showNotification(`✅ ${app.name} instalado correctamente!`, 'success');
            if (data.webUI) {
                showNotification(`Accede en: http://${window.location.hostname}:${data.webUI}`, 'info');
            }
            await loadHomeStoreCatalog();
            
        } catch (error) {
            console.error('Install error:', error);
            showNotification(`❌ Error al instalar: ${error.message}`, 'error');
            installBtn.disabled = false;
            installBtn.innerHTML = '🚀 Instalar';
        }
    });
}

async function installHomeStoreApp(appId) {
    // Show configuration modal instead of installing directly
    await showHomeStoreConfigModal(appId);
}

async function uninstallHomeStoreApp(appId) {
    if (!confirm(`¿Desinstalar ${appId}?\n\n¿Eliminar también los datos?`)) return;
    
    const removeData = confirm('¿Eliminar los datos de la aplicación?');
    
    try {
        const res = await authFetch(`${API_BASE}/homestore/uninstall/${appId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ removeData })
        });
        const data = await res.json();
        
        if (!data.success) throw new Error(data.error);
        
        alert(`✅ ${appId} desinstalado`);
        await loadHomeStoreCatalog();
        
    } catch (error) {
        console.error('Uninstall error:', error);
        alert(`❌ Error: ${error.message}`);
    }
}

async function startHomeStoreApp(appId) {
    try {
        const res = await authFetch(`${API_BASE}/homestore/start/${appId}`, { method: 'POST' });
        const data = await res.json();
        
        if (!data.success) throw new Error(data.error);
        
        await loadHomeStoreCatalog();
        
    } catch (error) {
        alert(`❌ Error: ${error.message}`);
    }
}

async function stopHomeStoreApp(appId) {
    try {
        const res = await authFetch(`${API_BASE}/homestore/stop/${appId}`, { method: 'POST' });
        const data = await res.json();
        
        if (!data.success) throw new Error(data.error);
        
        await loadHomeStoreCatalog();
        
    } catch (error) {
        alert(`❌ Error: ${error.message}`);
    }
}

function openHomeStoreApp(app) {
    if (app.webUI) {
        const url = `http://${window.location.hostname}:${app.webUI}`;
        window.open(url, '_blank');
    }
}

async function showHomeStoreAppLogs(appId) {
    try {
        const res = await authFetch(`${API_BASE}/homestore/logs/${appId}?lines=100`);
        const data = await res.json();
        
        if (!data.success) throw new Error(data.error);
        
        // Create modal
        const modal = document.createElement('div');
        modal.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.8); z-index: 1000; display: flex; align-items: center; justify-content: center;';
        modal.innerHTML = `
            <div style="background: var(--bg-card); border-radius: 12px; padding: 20px; width: 90%; max-width: 800px; max-height: 80vh; display: flex; flex-direction: column;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
                    <h3 style="margin: 0;">📋 Logs: ${appId}</h3>
                    <button id="close-logs-modal" style="background: none; border: none; font-size: 1.5rem; cursor: pointer; color: var(--text);">×</button>
                </div>
                <pre style="background: #1a1a2e; color: #0f0; padding: 15px; border-radius: 8px; overflow: auto; flex: 1; font-size: 0.85rem; line-height: 1.4;">${data.logs || 'No logs available'}</pre>
            </div>
        `;
        
        modal.addEventListener('click', (e) => {
            if (e.target === modal || e.target.id === 'close-logs-modal') {
                modal.remove();
            }
        });
        
        document.body.appendChild(modal);
        
    } catch (error) {
        alert(`❌ Error: ${error.message}`);
    }
}

async function updateHomeStoreApp(appId) {
    if (!confirm(`¿Actualizar ${appId}?\n\nSe descargará la última versión de la imagen.`)) return;
    
    try {
        const res = await authFetch(`${API_BASE}/homestore/update/${appId}`, { method: 'POST' });
        const data = await res.json();
        
        if (!data.success) throw new Error(data.error);
        
        alert(`✅ ${appId} actualizado`);
        await loadHomeStoreCatalog();
        
    } catch (error) {
        alert(`❌ Error: ${error.message}`);
    }
}

// Expose HomeStore functions globally
window.loadHomeStoreCatalog = loadHomeStoreCatalog;
window.installHomeStoreApp = installHomeStoreApp;
window.uninstallHomeStoreApp = uninstallHomeStoreApp;
window.startHomeStoreApp = startHomeStoreApp;
window.stopHomeStoreApp = stopHomeStoreApp;
window.openHomeStoreApp = openHomeStoreApp;
window.showHomeStoreAppLogs = showHomeStoreAppLogs;
window.updateHomeStoreApp = updateHomeStoreApp;

// Expose functions globally for onclick handlers
window.deleteFolder = deleteFolder;
window.deleteDevice = deleteDevice;
window.addFolder = addFolder;
window.addDevice = addDevice;

// ============================================
// DOCKER STACKS MANAGER
// ============================================

let stacksCache = [];

async function openStacksManager() {
    // Remove existing modal
    const existing = document.getElementById('stacks-modal');
    if (existing) existing.remove();
    
    const modal = document.createElement('div');
    modal.id = 'stacks-modal';
    modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0,0,0,0.85);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 99999;
    `;
    
    modal.innerHTML = `
        <div style="
            background: #1a1a2e;
            border: 1px solid #3d3d5c;
            border-radius: 16px;
            width: 95%;
            max-width: 900px;
            max-height: 90vh;
            overflow: hidden;
            display: flex;
            flex-direction: column;
        ">
            <div style="padding: 20px; border-bottom: 1px solid #3d3d5c; display: flex; justify-content: space-between; align-items: center;">
                <h2 style="margin: 0; color: #10b981;">🗂️ Docker Stacks</h2>
                <button id="stacks-close-btn" style="background: none; border: none; color: #ffffff; font-size: 24px; cursor: pointer;">×</button>
            </div>
            <div style="padding: 20px; border-bottom: 1px solid #3d3d5c; display: flex; gap: 10px; flex-wrap: wrap;">
                <button id="stacks-new-btn" class="btn-primary" style="background: #10b981; color: white;">➕ Nuevo Stack</button>
                <button id="stacks-template-btn" class="btn-primary" style="background: #6366f1; color: white;">📋 Desde Template</button>
                <button id="stacks-refresh-btn" class="btn-primary" style="background: #4a4a6a; color: white;">🔄 Refrescar</button>
            </div>
            <div id="stacks-list" style="flex: 1; overflow-y: auto; padding: 20px;">
                <div style="text-align: center; padding: 40px; color: #a0a0b0;">
                    Cargando stacks...
                </div>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    // Event listeners
    document.getElementById('stacks-close-btn').addEventListener('click', () => modal.remove());
    document.getElementById('stacks-new-btn').addEventListener('click', openNewStackModal);
    document.getElementById('stacks-template-btn').addEventListener('click', openTemplateSelector);
    document.getElementById('stacks-refresh-btn').addEventListener('click', loadStacksList);
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
    
    await loadStacksList();
}

async function loadStacksList() {
    const listDiv = document.getElementById('stacks-list');
    if (!listDiv) return;
    
    listDiv.innerHTML = '<div style="text-align: center; padding: 40px; color: var(--text-secondary);">Cargando...</div>';
    
    try {
        const res = await authFetch(`${API_BASE}/stacks/list`);
        const data = await res.json();
        
        if (!data.success) throw new Error(data.error);
        
        stacksCache = data.stacks;
        
        if (data.stacks.length === 0) {
            listDiv.innerHTML = `
                <div style="text-align: center; padding: 60px; color: var(--text-secondary);">
                    <div style="font-size: 48px; margin-bottom: 20px;">📦</div>
                    <h3>No hay stacks</h3>
                    <p>Crea tu primer stack o usa una plantilla predefinida.</p>
                </div>
            `;
            return;
        }
        
        listDiv.innerHTML = data.stacks.map(stack => `
            <div class="stack-card" style="
                background: var(--bg-hover);
                border: 1px solid var(--border);
                border-radius: 12px;
                padding: 16px;
                margin-bottom: 12px;
                display: flex;
                justify-content: space-between;
                align-items: center;
                flex-wrap: wrap;
                gap: 12px;
            ">
                <div style="display: flex; align-items: center; gap: 12px;">
                    <span style="font-size: 32px;">${stack.icon || '📦'}</span>
                    <div>
                        <h4 style="margin: 0; color: var(--text);">${escapeHtml(stack.name || stack.id)}</h4>
                        <p style="margin: 4px 0 0; color: var(--text-secondary); font-size: 13px;">${escapeHtml(stack.description || 'Sin descripción')}</p>
                        <div style="display: flex; gap: 8px; margin-top: 8px; flex-wrap: wrap;">
                            ${stack.services.map(s => `
                                <span style="
                                    padding: 2px 8px;
                                    border-radius: 4px;
                                    font-size: 11px;
                                    background: ${s.state === 'running' ? 'rgba(16,185,129,0.2)' : 'rgba(239,68,68,0.2)'};
                                    color: ${s.state === 'running' ? '#10b981' : '#ef4444'};
                                ">${escapeHtml(s.name)}</span>
                            `).join('')}
                        </div>
                    </div>
                </div>
                <div style="display: flex; gap: 8px; align-items: center;">
                    <span style="
                        padding: 4px 12px;
                        border-radius: 20px;
                        font-size: 12px;
                        font-weight: 600;
                        background: ${stack.status === 'running' ? 'rgba(16,185,129,0.2)' : stack.status === 'partial' ? 'rgba(245,158,11,0.2)' : 'rgba(107,114,128,0.2)'};
                        color: ${stack.status === 'running' ? '#10b981' : stack.status === 'partial' ? '#f59e0b' : '#6b7280'};
                    ">${stack.status === 'running' ? '● Running' : stack.status === 'partial' ? '◐ Partial' : '○ Stopped'}</span>
                    
                    <button onclick="stackAction('${stack.id}', '${stack.status === 'running' ? 'down' : 'up'}', event)"
                        class="btn-primary" style="padding: 6px 12px; font-size: 12px; background: ${stack.status === 'running' ? '#ef4444' : '#10b981'};">
                        ${stack.status === 'running' ? '⏹ Stop' : '▶ Start'}
                    </button>
                    <button onclick="openStackEditor('${stack.id}')" class="btn-primary" style="padding: 6px 12px; font-size: 12px; background: #6366f1;">
                        ✏️ Edit
                    </button>
                    <button onclick="showStackLogs('${stack.id}')" class="btn-primary" style="padding: 6px 12px; font-size: 12px; background: var(--bg-hover);">
                        📜 Logs
                    </button>
                    <button onclick="deleteStack('${stack.id}')" class="btn-primary" style="padding: 6px 12px; font-size: 12px; background: #ef4444;">
                        🗑️
                    </button>
                </div>
            </div>
        `).join('');
        
    } catch (e) {
        listDiv.innerHTML = `<div style="text-align: center; padding: 40px; color: #ef4444;">Error: ${escapeHtml(e.message)}</div>`;
    }
}

async function openNewStackModal() {
    const modal = document.getElementById('stacks-modal');
    if (!modal) return;
    
    const content = modal.querySelector('div > div');
    content.innerHTML = `
        <div style="padding: 20px; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center;">
            <h2 style="margin: 0; color: var(--primary);">➕ Nuevo Stack</h2>
            <button id="stack-back-btn" style="background: none; border: none; color: var(--text); font-size: 14px; cursor: pointer;">← Volver</button>
        </div>
        <div style="padding: 20px; overflow-y: auto; max-height: 70vh;">
            <div style="margin-bottom: 16px;">
                <label style="display: block; margin-bottom: 6px; color: var(--text-secondary);">Nombre del Stack</label>
                <input type="text" id="stack-name" placeholder="mi-stack" style="
                    width: 100%;
                    padding: 10px;
                    border-radius: 8px;
                    border: 1px solid var(--border);
                    background: var(--bg-hover);
                    color: var(--text);
                    font-size: 14px;
                ">
            </div>
            <div style="margin-bottom: 16px;">
                <label style="display: block; margin-bottom: 6px; color: var(--text-secondary);">Descripción (opcional)</label>
                <input type="text" id="stack-desc" placeholder="Descripción del stack" style="
                    width: 100%;
                    padding: 10px;
                    border-radius: 8px;
                    border: 1px solid var(--border);
                    background: var(--bg-hover);
                    color: var(--text);
                    font-size: 14px;
                ">
            </div>
            <div style="margin-bottom: 16px;">
                <label style="display: block; margin-bottom: 6px; color: var(--text-secondary);">docker-compose.yml</label>
                <textarea id="stack-compose" placeholder="version: '3.8'
services:
  web:
    image: nginx
    ports:
      - '8080:80'" style="
                    width: 100%;
                    height: 300px;
                    padding: 12px;
                    border-radius: 8px;
                    border: 1px solid var(--border);
                    background: var(--bg-hover);
                    color: var(--text);
                    font-family: monospace;
                    font-size: 13px;
                    resize: vertical;
                "></textarea>
            </div>
            <button id="stack-create-btn" class="btn-primary" style="width: 100%; padding: 12px; background: #10b981; font-size: 14px;">
                🚀 Crear Stack
            </button>
        </div>
    `;
    
    document.getElementById('stack-back-btn').addEventListener('click', openStacksManager);
    document.getElementById('stack-create-btn').addEventListener('click', createStack);
}

async function createStack() {
    const name = document.getElementById('stack-name').value.trim();
    const description = document.getElementById('stack-desc').value.trim();
    const compose = document.getElementById('stack-compose').value;
    
    if (!name) return alert('El nombre es requerido');
    if (!compose) return alert('El contenido docker-compose es requerido');
    
    const btn = document.getElementById('stack-create-btn');
    btn.disabled = true;
    btn.innerHTML = '⏳ Creando...';
    
    try {
        const res = await authFetch(`${API_BASE}/stacks/create`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, description, compose })
        });
        const data = await res.json();
        
        if (!data.success) throw new Error(data.error);
        
        alert('Stack creado correctamente');
        openStacksManager();
    } catch (e) {
        alert('Error: ' + e.message);
        btn.disabled = false;
        btn.innerHTML = '🚀 Crear Stack';
    }
}

async function openTemplateSelector() {
    const modal = document.getElementById('stacks-modal');
    if (!modal) return;
    
    const content = modal.querySelector('div > div');
    content.innerHTML = `
        <div style="padding: 20px; border-bottom: 1px solid #3d3d5c; display: flex; justify-content: space-between; align-items: center;">
            <h2 style="margin: 0; color: #10b981;">📋 Plantillas</h2>
            <button id="template-back-btn" style="background: #4a4a6a; border: none; color: #ffffff; font-size: 14px; cursor: pointer; padding: 8px 16px; border-radius: 6px;">← Volver</button>
        </div>
        <div id="templates-list" style="padding: 20px; overflow-y: auto; max-height: 70vh;">
            <div style="text-align: center; padding: 40px; color: #a0a0b0;">Cargando plantillas...</div>
        </div>
    `;
    
    document.getElementById('template-back-btn').addEventListener('click', openStacksManager);
    
    try {
        const res = await authFetch(`${API_BASE}/stacks/templates`);
        const data = await res.json();
        
        const list = document.getElementById('templates-list');
        list.innerHTML = data.templates.map(t => `
            <div style="
                background: #2d2d44;
                border: 1px solid #3d3d5c;
                border-radius: 12px;
                padding: 16px;
                margin-bottom: 12px;
                display: flex;
                justify-content: space-between;
                align-items: center;
            ">
                <div style="display: flex; align-items: center; gap: 12px;">
                    <span style="font-size: 32px;">${t.icon}</span>
                    <div>
                        <h4 style="margin: 0; color: #ffffff;">${escapeHtml(t.name)}</h4>
                        <p style="margin: 4px 0 0; color: #a0a0b0; font-size: 13px;">${escapeHtml(t.description)}</p>
                    </div>
                </div>
                <button onclick="useTemplate('${t.id}')" class="btn-primary" style="padding: 8px 16px; background: #10b981; color: white;">
                    Usar
                </button>
            </div>
        `).join('');
    } catch (e) {
        document.getElementById('templates-list').innerHTML = `<div style="color: #ef4444;">Error: ${e.message}</div>`;
    }
}

async function useTemplate(templateId) {
    try {
        const res = await authFetch(`${API_BASE}/stacks/templates/${templateId}`);
        const data = await res.json();
        
        if (!data.success) throw new Error(data.error);
        
        // Open new stack modal with template content
        openNewStackModal();
        setTimeout(() => {
            document.getElementById('stack-name').value = templateId;
            document.getElementById('stack-desc').value = data.template.description;
            document.getElementById('stack-compose').value = data.template.compose;
        }, 100);
    } catch (e) {
        alert('Error: ' + e.message);
    }
}

async function stackAction(stackId, action, event) {
    const btn = event.target;
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '⏳...';
    
    try {
        const res = await authFetch(`${API_BASE}/stacks/${stackId}/${action}`, { method: 'POST' });
        const data = await res.json();
        
        if (!data.success) throw new Error(data.error);
        
        await loadStacksList();
    } catch (e) {
        alert('Error: ' + e.message);
        btn.disabled = false;
        btn.innerHTML = originalText;
    }
}

async function openStackEditor(stackId) {
    try {
        const res = await authFetch(`${API_BASE}/stacks/${stackId}`);
        const data = await res.json();
        
        if (!data.success) throw new Error(data.error);
        
        const modal = document.getElementById('stacks-modal');
        const content = modal.querySelector('div > div');
        
        content.innerHTML = `
            <div style="padding: 20px; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center;">
                <h2 style="margin: 0; color: var(--primary);">✏️ Editar: ${escapeHtml(data.stack.name || stackId)}</h2>
                <button id="editor-back-btn" style="background: none; border: none; color: var(--text); font-size: 14px; cursor: pointer;">← Volver</button>
            </div>
            <div style="padding: 20px; overflow-y: auto; max-height: 70vh;">
                <div style="margin-bottom: 16px;">
                    <label style="display: block; margin-bottom: 6px; color: var(--text-secondary);">docker-compose.yml</label>
                    <textarea id="edit-compose" style="
                        width: 100%;
                        height: 400px;
                        padding: 12px;
                        border-radius: 8px;
                        border: 1px solid var(--border);
                        background: var(--bg-hover);
                        color: var(--text);
                        font-family: monospace;
                        font-size: 13px;
                    ">${escapeHtml(data.stack.compose)}</textarea>
                </div>
                <div style="display: flex; gap: 10px;">
                    <button id="save-stack-btn" class="btn-primary" style="flex: 1; padding: 12px; background: #10b981;">
                        💾 Guardar
                    </button>
                    <button id="redeploy-stack-btn" class="btn-primary" style="flex: 1; padding: 12px; background: #6366f1;">
                        🚀 Guardar y Redesplegar
                    </button>
                </div>
            </div>
        `;
        
        document.getElementById('editor-back-btn').addEventListener('click', openStacksManager);
        document.getElementById('save-stack-btn').addEventListener('click', () => saveStack(stackId, false));
        document.getElementById('redeploy-stack-btn').addEventListener('click', () => saveStack(stackId, true));
    } catch (e) {
        alert('Error: ' + e.message);
    }
}

async function saveStack(stackId, redeploy) {
    const compose = document.getElementById('edit-compose').value;
    const btn = redeploy ? document.getElementById('redeploy-stack-btn') : document.getElementById('save-stack-btn');
    btn.disabled = true;
    btn.innerHTML = '⏳...';
    
    try {
        // Save
        let res = await authFetch(`${API_BASE}/stacks/${stackId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ compose })
        });
        let data = await res.json();
        if (!data.success) throw new Error(data.error);
        
        // Redeploy if requested
        if (redeploy) {
            res = await authFetch(`${API_BASE}/stacks/${stackId}/up`, { method: 'POST' });
            data = await res.json();
            if (!data.success) throw new Error(data.error);
        }
        
        alert(redeploy ? 'Stack guardado y redesplegado' : 'Stack guardado');
        openStacksManager();
    } catch (e) {
        alert('Error: ' + e.message);
        btn.disabled = false;
        btn.innerHTML = redeploy ? '🚀 Guardar y Redesplegar' : '💾 Guardar';
    }
}

async function showStackLogs(stackId) {
    const modal = document.getElementById('stacks-modal');
    const content = modal.querySelector('div > div');
    
    content.innerHTML = `
        <div style="padding: 20px; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center;">
            <h2 style="margin: 0; color: var(--primary);">📜 Logs: ${escapeHtml(stackId)}</h2>
            <button id="logs-back-btn" style="background: none; border: none; color: var(--text); font-size: 14px; cursor: pointer;">← Volver</button>
        </div>
        <div style="padding: 20px; overflow-y: auto; max-height: 70vh;">
            <pre id="stack-logs" style="
                background: #0a0a0a;
                padding: 16px;
                border-radius: 8px;
                overflow-x: auto;
                font-size: 12px;
                color: #10b981;
                max-height: 500px;
                overflow-y: auto;
            ">Cargando logs...</pre>
        </div>
    `;
    
    document.getElementById('logs-back-btn').addEventListener('click', openStacksManager);
    
    try {
        const res = await authFetch(`${API_BASE}/stacks/${stackId}/logs?lines=200`);
        const data = await res.json();
        document.getElementById('stack-logs').textContent = data.logs || 'Sin logs';
    } catch (e) {
        document.getElementById('stack-logs').textContent = 'Error: ' + e.message;
    }
}

async function deleteStack(stackId) {
    if (!confirm(`¿Eliminar el stack "${stackId}"? Esto detendrá y eliminará todos sus contenedores.`)) return;
    
    try {
        const res = await authFetch(`${API_BASE}/stacks/${stackId}`, { method: 'DELETE' });
        const data = await res.json();
        
        if (!data.success) throw new Error(data.error);
        
        await loadStacksList();
    } catch (e) {
        alert('Error: ' + e.message);
    }
}

// Expose stack functions globally
window.openStacksManager = openStacksManager;
window.stackAction = stackAction;
window.openStackEditor = openStackEditor;
window.showStackLogs = showStackLogs;
window.deleteStack = deleteStack;
window.useTemplate = useTemplate;

// ═══════════════════════════════════════════════════════════════════════════
// CLOUD BACKUP - rclone integration for Google Drive, Dropbox, OneDrive, etc.
// ═══════════════════════════════════════════════════════════════════════════

async function renderCloudBackupView() {
    const dashboardContent = document.getElementById('dashboard-content');
    if (!dashboardContent) return;
    
    dashboardContent.innerHTML = `
        <div class="glass-card" style="margin-bottom: 20px;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
                <div>
                    <h3 style="color: var(--primary); margin: 0;">☁️ Cloud Backup</h3>
                    <p style="color: var(--text-dim); margin: 5px 0 0;">Sincroniza con Google Drive, Dropbox, OneDrive y más</p>
                </div>
                <div id="cloud-backup-status-badge"></div>
            </div>
        </div>
        <div id="cloud-backup-content">
            <div style="text-align: center; padding: 40px; color: var(--text-dim);">
                Cargando...
            </div>
        </div>
    `;
    
    await loadCloudBackupStatus();
}

async function loadCloudBackupStatus() {
    const contentDiv = document.getElementById('cloud-backup-content');
    const badgeDiv = document.getElementById('cloud-backup-status-badge');
    
    try {
        const res = await authFetch(`${API_BASE}/cloud-backup/status`);
        if (!res.ok) throw new Error('Failed to load status');
        const status = await res.json();
        
        if (!status.installed) {
            // rclone not installed
            badgeDiv.innerHTML = '<span style="color: #f59e0b;">⚠️ rclone no instalado</span>';
            contentDiv.innerHTML = `
                <div class="glass-card" style="text-align: center; padding: 40px;">
                    <h3 style="margin-bottom: 15px;">📦 Instalar rclone</h3>
                    <p style="color: var(--text-dim); margin-bottom: 20px;">
                        rclone es necesario para conectar con servicios de nube como Google Drive, Dropbox, OneDrive, etc.
                    </p>
                    <button id="btn-install-rclone" class="btn-primary" style="padding: 12px 24px;">
                        Instalar rclone
                    </button>
                </div>
            `;
            document.getElementById('btn-install-rclone').addEventListener('click', installRclone);
            return;
        }
        
        badgeDiv.innerHTML = `<span style="color: #10b981;">✓ rclone v${status.version}</span>`;
        
        // Load configured remotes
        const remotesRes = await authFetch(`${API_BASE}/cloud-backup/remotes`);
        const remotesData = await remotesRes.json();
        
        let remotesHtml = '';
        if (remotesData.remotes && remotesData.remotes.length > 0) {
            remotesHtml = `
                <div class="glass-card" style="margin-bottom: 20px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
                        <h4 style="margin: 0;">🌐 Nubes Configuradas</h4>
                        <button data-action="add-cloud" class="btn-primary" style="padding: 8px 16px;">
                            + Añadir Nube
                        </button>
                    </div>
                    <div id="cloud-remotes-list">
                        ${remotesData.remotes.map(r => `
                            <div class="remote-card" style="display: flex; justify-content: space-between; align-items: center; padding: 15px; background: rgba(255,255,255,0.03); border-radius: 10px; margin-bottom: 10px; border: 1px solid rgba(255,255,255,0.05);">
                                <div style="display: flex; align-items: center; gap: 12px;">
                                    <span style="font-size: 1.8rem;">${r.icon}</span>
                                    <div>
                                        <div style="font-weight: 600;">${escapeHtml(r.name)}</div>
                                        <div style="font-size: 0.85rem; color: var(--text-dim);">${r.displayName}</div>
                                    </div>
                                </div>
                                <div style="display: flex; gap: 8px;">
                                    <button data-action="browse-remote" data-remote="${escapeHtml(r.name)}" class="btn-sm" style="background: #6366f1;" title="Explorar">
                                        📂
                                    </button>
                                    <button data-action="sync-remote" data-remote="${escapeHtml(r.name)}" class="btn-sm" style="background: #10b981;" title="Sincronizar">
                                        🔄
                                    </button>
                                    <button data-action="delete-remote" data-remote="${escapeHtml(r.name)}" class="btn-sm" style="background: #ef4444;" title="Eliminar">
                                        🗑️
                                    </button>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
        } else {
            remotesHtml = `
                <div class="glass-card" style="text-align: center; padding: 40px;">
                    <h3 style="margin-bottom: 15px;">🌐 No hay nubes configuradas</h3>
                    <p style="color: var(--text-dim); margin-bottom: 20px;">
                        Añade tu primera nube para empezar a sincronizar archivos
                    </p>
                    <button data-action="add-cloud" class="btn-primary" style="padding: 12px 24px;">
                        + Añadir Nube
                    </button>
                </div>
            `;
        }
        
        // Load active sync jobs
        const activeJobsRes = await authFetch(`${API_BASE}/cloud-backup/jobs/active`);
        const activeJobsData = await activeJobsRes.json();
        
        // Load scheduled syncs
        const schedulesRes = await authFetch(`${API_BASE}/cloud-backup/schedules`);
        const schedulesData = await schedulesRes.json();
        
        // Load transfer history
        const historyRes = await authFetch(`${API_BASE}/cloud-backup/history`);
        const historyData = await historyRes.json();
        
        // Build active syncs section (only if there are active jobs)
        let activeHtml = '';
        if (activeJobsData.jobs && activeJobsData.jobs.length > 0) {
            activeHtml = `
                <div class="glass-card" style="margin-bottom: 20px; border: 2px solid rgba(16,185,129,0.3);">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
                        <h4 style="margin: 0; color: #10b981;">🔄 Sincronizaciones Activas</h4>
                        <span style="font-size: 0.8rem; color: #a0a0b0;">Auto-actualiza cada 5s</span>
                    </div>
                    <div id="active-syncs-list">
                        ${activeJobsData.jobs.map(job => `
                            <div style="padding: 15px; background: rgba(16,185,129,0.05); border-radius: 8px; margin-bottom: 10px; border: 1px solid rgba(16,185,129,0.2);">
                                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                                    <div style="overflow: hidden;">
                                        <div style="font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(job.source)}</div>
                                        <div style="font-size: 0.8rem; color: #a0a0b0;">→ ${escapeHtml(job.dest)}</div>
                                    </div>
                                    <span style="color: #10b981; font-weight: 600; font-size: 1.1rem;">${job.percent}%</span>
                                </div>
                                <div style="height: 6px; background: #2d2d44; border-radius: 3px; overflow: hidden;">
                                    <div style="height: 100%; background: linear-gradient(90deg, #10b981, #6366f1); width: ${job.percent}%; transition: width 0.5s ease;"></div>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
            
            // Auto-refresh active syncs
            setTimeout(() => {
                if (document.getElementById('active-syncs-list')) {
                    loadCloudBackupStatus();
                }
            }, 5000);
        }
        
        // Build scheduled syncs section
        let schedulesHtml = `
            <div class="glass-card" style="margin-bottom: 20px;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
                    <h4 style="margin: 0;">⏰ Sincronizaciones Programadas</h4>
                </div>
                <div id="scheduled-syncs-list">
        `;
        
        if (schedulesData.schedules && schedulesData.schedules.length > 0) {
            schedulesHtml += schedulesData.schedules.map(s => `
                <div style="display: flex; justify-content: space-between; align-items: center; padding: 12px 15px; background: rgba(255,255,255,0.03); border-radius: 8px; margin-bottom: 8px; border: 1px solid ${s.enabled ? 'rgba(16,185,129,0.3)' : 'rgba(255,255,255,0.05)'};">
                    <div style="flex: 1; overflow: hidden;">
                        <div style="font-weight: 500;">${escapeHtml(s.name)}</div>
                        <div style="font-size: 0.8rem; color: #a0a0b0;">
                            ${escapeHtml(s.source)} → ${escapeHtml(s.dest)}
                        </div>
                        <div style="font-size: 0.75rem; color: #6366f1; margin-top: 4px;">
                            ${getScheduleLabel(s.schedule)} • ${s.mode}
                        </div>
                    </div>
                    <div style="display: flex; gap: 8px;">
                        <button data-action="toggle-schedule" data-id="${s.id}" class="btn-sm" style="background: ${s.enabled ? '#10b981' : '#4a4a6a'};" title="${s.enabled ? 'Pausar' : 'Activar'}">
                            ${s.enabled ? '⏸️' : '▶️'}
                        </button>
                        <button data-action="delete-schedule" data-id="${s.id}" class="btn-sm" style="background: #ef4444;" title="Eliminar">
                            🗑️
                        </button>
                    </div>
                </div>
            `).join('');
        } else {
            schedulesHtml += `<div style="text-align: center; padding: 20px; color: #a0a0b0;">No hay sincronizaciones programadas</div>`;
        }
        schedulesHtml += '</div></div>';
        
        // Build history section
        let historyHtml = `
            <div class="glass-card">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
                    <h4 style="margin: 0;">📜 Historial de Transferencias</h4>
                    ${historyData.history && historyData.history.length > 0 ? `
                        <button data-action="clear-history" class="btn-sm" style="background: #4a4a6a;">Limpiar</button>
                    ` : ''}
                </div>
                <div id="transfer-history-list" style="max-height: 300px; overflow-y: auto;">
        `;
        
        if (historyData.history && historyData.history.length > 0) {
            historyHtml += historyData.history.slice(0, 20).map(t => {
                const statusIcon = t.status === 'completed' ? '✅' : t.status === 'running' ? '🔄' : '❌';
                const statusColor = t.status === 'completed' ? '#10b981' : t.status === 'running' ? '#f59e0b' : '#ef4444';
                return `
                <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 12px; background: rgba(255,255,255,0.02); border-radius: 6px; margin-bottom: 6px; border-left: 3px solid ${statusColor};">
                    <div style="flex: 1; overflow: hidden;">
                        <div style="font-size: 0.85rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                            ${escapeHtml(t.source)} → ${escapeHtml(t.dest)}
                        </div>
                        <div style="font-size: 0.75rem; color: #a0a0b0;">
                            ${new Date(t.timestamp).toLocaleString()} • ${t.mode}
                        </div>
                    </div>
                    <span style="font-size: 1.2rem;" title="${t.status}">${statusIcon}</span>
                </div>
            `}).join('');
        } else {
            historyHtml += `<div style="text-align: center; padding: 20px; color: #a0a0b0;">Sin transferencias recientes</div>`;
        }
        historyHtml += '</div></div>';
        
        contentDiv.innerHTML = remotesHtml + activeHtml + schedulesHtml + historyHtml;
        
        // Bind event listeners after DOM is updated
        bindCloudBackupEventListeners();
        
    } catch (e) {
        contentDiv.innerHTML = `<div class="glass-card" style="color: #ef4444; padding: 20px;">Error: ${e.message}</div>`;
    }
}

// Bind all event listeners for Cloud Backup view using event delegation
function bindCloudBackupEventListeners() {
    const contentDiv = document.getElementById('cloud-backup-content');
    if (!contentDiv) return;
    
    // Remove old listener if exists
    contentDiv.removeEventListener('click', handleCloudBackupClick);
    // Add new listener
    contentDiv.addEventListener('click', handleCloudBackupClick);
}

// Event delegation handler for Cloud Backup
async function handleCloudBackupClick(e) {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    
    const action = btn.dataset.action;
    const remote = btn.dataset.remote;
    const id = btn.dataset.id;
    
    switch (action) {
        case 'add-cloud':
            showAddCloudModal();
            break;
        case 'browse-remote':
            browseRemote(remote);
            break;
        case 'sync-remote':
            syncRemote(remote);
            break;
        case 'delete-remote':
            deleteRemote(remote);
            break;
        case 'toggle-schedule':
            toggleScheduledSync(id);
            break;
        case 'delete-schedule':
            deleteScheduledSync(id);
            break;
        case 'clear-history':
            clearTransferHistory();
            break;
    }
}

// Helper: Get human-readable schedule label
function getScheduleLabel(schedule) {
    switch (schedule) {
        case 'hourly': return '⏱️ Cada hora';
        case 'daily': return '📅 Diario (3:00)';
        case 'weekly': return '📆 Semanal (Dom 3:00)';
        case 'monthly': return '🗓️ Mensual (día 1)';
        default: return `🕐 ${schedule}`;
    }
}

// Toggle scheduled sync enabled/disabled
async function toggleScheduledSync(id) {
    try {
        const res = await authFetch(`${API_BASE}/cloud-backup/schedules/${id}/toggle`, { method: 'POST' });
        const data = await res.json();
        if (data.success) {
            showNotification(data.enabled ? 'Sincronización activada' : 'Sincronización pausada', 'success');
            await loadCloudBackupStatus();
        } else {
            throw new Error(data.error);
        }
    } catch (e) {
        showNotification('Error: ' + e.message, 'error');
    }
}

// Delete scheduled sync
async function deleteScheduledSync(id) {
    if (!confirm('¿Eliminar esta sincronización programada?')) return;
    
    try {
        const res = await authFetch(`${API_BASE}/cloud-backup/schedules/${id}`, { method: 'DELETE' });
        const data = await res.json();
        if (data.success) {
            showNotification('Sincronización eliminada', 'success');
            await loadCloudBackupStatus();
        } else {
            throw new Error(data.error);
        }
    } catch (e) {
        showNotification('Error: ' + e.message, 'error');
    }
}

// Clear transfer history
async function clearTransferHistory() {
    if (!confirm('¿Limpiar todo el historial de transferencias?')) return;
    
    try {
        const res = await authFetch(`${API_BASE}/cloud-backup/history`, { method: 'DELETE' });
        const data = await res.json();
        if (data.success) {
            showNotification('Historial limpiado', 'success');
            await loadCloudBackupStatus();
        } else {
            throw new Error(data.error);
        }
    } catch (e) {
        showNotification('Error: ' + e.message, 'error');
    }
}

async function installRclone() {
    console.log('[Cloud Backup] installRclone called');
    if (!confirm('¿Instalar rclone? Esto puede tardar unos minutos.')) return;
    console.log('[Cloud Backup] User confirmed, starting install...');
    
    const contentDiv = document.getElementById('cloud-backup-content');
    
    const updateProgress = (step, percent, text) => {
        contentDiv.innerHTML = `
            <div class="glass-card" style="text-align: center; padding: 40px;">
                <h3 style="margin-bottom: 20px; color: var(--primary);">📦 Instalando rclone</h3>
                <div style="margin-bottom: 15px;">
                    <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                        <span style="color: #a0a0b0;">${text}</span>
                        <span style="color: #10b981; font-weight: 600;">${percent}%</span>
                    </div>
                    <div style="height: 8px; background: #2d2d44; border-radius: 4px; overflow: hidden;">
                        <div style="height: 100%; background: linear-gradient(90deg, #10b981, #6366f1); width: ${percent}%; transition: width 0.5s ease;"></div>
                    </div>
                </div>
                <div style="display: flex; justify-content: center; gap: 20px; margin-top: 20px;">
                    <span style="color: ${step >= 1 ? '#10b981' : '#4a4a6a'};">${step >= 1 ? '✅' : '⏳'} Descargando</span>
                    <span style="color: ${step >= 2 ? '#10b981' : '#4a4a6a'};">${step >= 2 ? '✅' : '⏳'} Extrayendo</span>
                    <span style="color: ${step >= 3 ? '#10b981' : '#4a4a6a'};">${step >= 3 ? '✅' : '⏳'} Instalando</span>
                </div>
            </div>
        `;
    };
    
    updateProgress(0, 5, 'Iniciando...');
    
    // Simulate progress while waiting for server
    let fakeProgress = 5;
    const progressInterval = setInterval(() => {
        if (fakeProgress < 30) {
            fakeProgress += 5;
            updateProgress(1, fakeProgress, 'Descargando rclone...');
        } else if (fakeProgress < 60) {
            fakeProgress += 3;
            updateProgress(2, fakeProgress, 'Extrayendo archivos...');
        } else if (fakeProgress < 90) {
            fakeProgress += 2;
            updateProgress(3, fakeProgress, 'Instalando...');
        }
    }, 500);
    
    try {
        const res = await authFetch(`${API_BASE}/cloud-backup/install`, { method: 'POST' });
        clearInterval(progressInterval);
        
        const data = await res.json();
        
        if (data.success) {
            updateProgress(3, 100, '¡Completado!');
            await new Promise(r => setTimeout(r, 1500));
            showNotification(`rclone v${data.version} instalado correctamente`, 'success');
            // Force full view re-render
            await renderCloudBackupView();
        } else {
            throw new Error(data.error);
        }
    } catch (e) {
        clearInterval(progressInterval);
        showNotification('Error instalando rclone: ' + e.message, 'error');
        await loadCloudBackupStatus();
    }
}

async function showAddCloudModal() {
    try {
        // Get available providers
        const res = await authFetch(`${API_BASE}/cloud-backup/providers`);
        if (!res.ok) {
            throw new Error('Error cargando proveedores');
        }
        const data = await res.json();
    
        const modal = document.createElement('div');
        modal.id = 'add-cloud-modal';
        modal.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.85); display: flex; align-items: center; justify-content: center; z-index: 100000;';
        
        modal.innerHTML = `
            <div style="background: #1a1a2e; border: 1px solid #3d3d5c; border-radius: 16px; width: 95%; max-width: 600px; max-height: 80vh; overflow: hidden;">
                <div style="padding: 20px; border-bottom: 1px solid #3d3d5c; display: flex; justify-content: space-between; align-items: center;">
                    <h3 style="margin: 0; color: #10b981;">☁️ Añadir Nube</h3>
                    <button data-action="close-modal" style="background: none; border: none; color: #fff; font-size: 24px; cursor: pointer;">×</button>
                </div>
                <div style="padding: 20px; overflow-y: auto; max-height: 60vh;">
                    <p style="color: #a0a0b0; margin-bottom: 20px;">Selecciona el servicio de nube que quieres configurar:</p>
                    <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 12px;">
                        ${data.providers.map(p => `
                            <button data-action="select-provider" data-provider="${p.id}" style="
                                background: rgba(255,255,255,0.05);
                                border: 2px solid rgba(255,255,255,0.1);
                                border-radius: 12px;
                                padding: 20px 15px;
                                cursor: pointer;
                                text-align: center;
                                transition: all 0.2s;
                            " onmouseover="this.style.borderColor='${p.color}'" onmouseout="this.style.borderColor='rgba(255,255,255,0.1)'">
                                <div style="font-size: 2rem; margin-bottom: 8px;">${p.icon}</div>
                                <div style="color: #fff; font-size: 0.9rem;">${p.name}</div>
                            </button>
                        `).join('')}
                    </div>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        // Add event listeners to modal
        modal.addEventListener('click', (e) => {
            const btn = e.target.closest('button[data-action]');
            if (!btn) return;
            
            const action = btn.dataset.action;
            if (action === 'close-modal') {
                modal.remove();
            } else if (action === 'select-provider') {
                const provider = btn.dataset.provider;
                modal.remove();
                startCloudConfig(provider);
            }
        });
        
    } catch (e) {
        console.error('[Cloud Backup] Error in showAddCloudModal:', e);
        showNotification('Error: ' + e.message, 'error');
    }
}

async function startCloudConfig(provider) {
    document.getElementById('add-cloud-modal')?.remove();
    
    const res = await authFetch(`${API_BASE}/cloud-backup/config/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, name: `${provider}_${Date.now()}` })
    });
    const data = await res.json();
    
    if (data.needsOAuth) {
        // Show OAuth instructions
        showOAuthModal(provider, data.instructions);
    } else {
        // Show config form
        showConfigFormModal(provider, data.fields);
    }
}

function showOAuthModal(provider, instructions) {
    const modal = document.createElement('div');
    modal.id = 'oauth-modal';
    modal.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.85); display: flex; align-items: center; justify-content: center; z-index: 100000;';
    
    modal.innerHTML = `
        <div style="background: #1a1a2e; border: 1px solid #3d3d5c; border-radius: 16px; width: 95%; max-width: 500px; padding: 25px;">
            <h3 style="color: #10b981; margin-bottom: 20px;">🔐 Autorización OAuth</h3>
            <div style="background: rgba(255,255,255,0.05); padding: 15px; border-radius: 8px; margin-bottom: 20px;">
                <pre style="white-space: pre-wrap; color: #a0a0b0; font-size: 0.9rem;">${escapeHtml(instructions)}</pre>
            </div>
            <div style="margin-bottom: 15px;">
                <label style="color: #fff; display: block; margin-bottom: 8px;">Nombre para esta nube:</label>
                <input type="text" id="oauth-remote-name" value="${provider}" style="width: 100%; padding: 10px; background: #2d2d44; border: 1px solid #3d3d5c; border-radius: 6px; color: #fff;">
            </div>
            <div style="margin-bottom: 20px;">
                <label style="color: #fff; display: block; margin-bottom: 8px;">Pega el token aquí:</label>
                <textarea id="oauth-token" rows="4" style="width: 100%; padding: 10px; background: #2d2d44; border: 1px solid #3d3d5c; border-radius: 6px; color: #fff; resize: vertical;"></textarea>
            </div>
            <div style="display: flex; gap: 10px; justify-content: flex-end;">
                <button data-action="cancel" style="padding: 10px 20px; background: #4a4a6a; border: none; border-radius: 6px; color: #fff; cursor: pointer;">Cancelar</button>
                <button data-action="save" style="padding: 10px 20px; background: #10b981; border: none; border-radius: 6px; color: #fff; cursor: pointer;">Guardar</button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    // Add event listeners
    modal.addEventListener('click', async (e) => {
        const btn = e.target.closest('button[data-action]');
        if (!btn) return;
        
        if (btn.dataset.action === 'cancel') {
            modal.remove();
        } else if (btn.dataset.action === 'save') {
            await saveOAuthConfig(provider);
        }
    });
}

async function saveOAuthConfig(provider) {
    const name = document.getElementById('oauth-remote-name').value.trim();
    const token = document.getElementById('oauth-token').value.trim();
    
    if (!name || !token) {
        alert('Nombre y token son requeridos');
        return;
    }
    
    try {
        const res = await authFetch(`${API_BASE}/cloud-backup/config/save-oauth`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, provider, token })
        });
        const data = await res.json();
        
        if (data.success) {
            document.getElementById('oauth-modal').remove();
            showNotification('Nube configurada correctamente', 'success');
            await loadCloudBackupStatus();
        } else {
            throw new Error(data.error);
        }
    } catch (e) {
        alert('Error: ' + e.message);
    }
}

function showConfigFormModal(provider, fields) {
    const modal = document.createElement('div');
    modal.id = 'config-form-modal';
    modal.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.85); display: flex; align-items: center; justify-content: center; z-index: 100000;';
    
    const fieldNames = fields.map(f => f.name);
    
    const fieldsHtml = fields.map(f => `
        <div style="margin-bottom: 15px;">
            <label style="color: #fff; display: block; margin-bottom: 8px;">${f.label}${f.required ? ' *' : ''}:</label>
            ${f.type === 'select' ? `
                <select id="config-${f.name}" style="width: 100%; padding: 10px; background: #2d2d44; border: 1px solid #3d3d5c; border-radius: 6px; color: #fff;">
                    ${f.options.map(o => `<option value="${o}">${o}</option>`).join('')}
                </select>
            ` : `
                <input type="${f.type}" id="config-${f.name}" value="${f.default || ''}" placeholder="${f.placeholder || ''}" 
                    style="width: 100%; padding: 10px; background: #2d2d44; border: 1px solid #3d3d5c; border-radius: 6px; color: #fff;">
            `}
        </div>
    `).join('');
    
    modal.innerHTML = `
        <div style="background: #1a1a2e; border: 1px solid #3d3d5c; border-radius: 16px; width: 95%; max-width: 500px; padding: 25px;">
            <h3 style="color: #10b981; margin-bottom: 20px;">⚙️ Configurar ${provider.toUpperCase()}</h3>
            <div style="margin-bottom: 15px;">
                <label style="color: #fff; display: block; margin-bottom: 8px;">Nombre para esta nube *:</label>
                <input type="text" id="config-name" value="${provider}" style="width: 100%; padding: 10px; background: #2d2d44; border: 1px solid #3d3d5c; border-radius: 6px; color: #fff;">
            </div>
            ${fieldsHtml}
            <div style="display: flex; gap: 10px; justify-content: flex-end; margin-top: 20px;">
                <button data-action="cancel" style="padding: 10px 20px; background: #4a4a6a; border: none; border-radius: 6px; color: #fff; cursor: pointer;">Cancelar</button>
                <button data-action="save" style="padding: 10px 20px; background: #10b981; border: none; border-radius: 6px; color: #fff; cursor: pointer;">Guardar</button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    // Add event listeners
    modal.addEventListener('click', async (e) => {
        const btn = e.target.closest('button[data-action]');
        if (!btn) return;
        
        if (btn.dataset.action === 'cancel') {
            modal.remove();
        } else if (btn.dataset.action === 'save') {
            await saveSimpleConfig(provider, fieldNames);
        }
    });
}

async function saveSimpleConfig(provider, fieldNames) {
    const name = document.getElementById('config-name').value.trim();
    if (!name) {
        alert('El nombre es requerido');
        return;
    }
    
    const config = {};
    for (const fieldName of fieldNames) {
        const el = document.getElementById(`config-${fieldName}`);
        if (el) config[fieldName] = el.value;
    }
    
    try {
        const res = await authFetch(`${API_BASE}/cloud-backup/config/save-simple`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, provider, config })
        });
        const data = await res.json();
        
        if (data.success) {
            document.getElementById('config-form-modal').remove();
            showNotification('Nube configurada correctamente', 'success');
            await loadCloudBackupStatus();
        } else {
            throw new Error(data.error);
        }
    } catch (e) {
        alert('Error: ' + e.message);
    }
}

async function browseRemote(remoteName, path = '') {
    const modal = document.createElement('div');
    modal.id = 'remote-browser-modal';
    modal.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.9); display: flex; align-items: center; justify-content: center; z-index: 100000;';
    
    modal.innerHTML = `
        <div style="background: #1a1a2e; border: 1px solid #3d3d5c; border-radius: 16px; width: 95%; max-width: 800px; height: 80vh; display: flex; flex-direction: column;">
            <div style="padding: 15px 20px; border-bottom: 1px solid #3d3d5c; display: flex; justify-content: space-between; align-items: center;">
                <div>
                    <h3 style="margin: 0; color: #10b981;">📂 ${escapeHtml(remoteName)}</h3>
                    <div id="remote-path-display" style="font-size: 0.85rem; color: #a0a0b0; margin-top: 4px;">/${escapeHtml(path)}</div>
                </div>
                <button data-action="close" style="background: none; border: none; color: #fff; font-size: 24px; cursor: pointer;">×</button>
            </div>
            <div style="padding: 10px 20px; border-bottom: 1px solid #3d3d5c; display: flex; gap: 10px;">
                <button id="remote-back-btn" data-action="back" style="padding: 8px 16px; background: #4a4a6a; border: none; border-radius: 6px; color: #fff; cursor: pointer;" ${!path ? 'disabled style="opacity:0.5;padding: 8px 16px; background: #4a4a6a; border: none; border-radius: 6px; color: #fff;"' : ''}>
                    ⬅️ Atrás
                </button>
                <button data-action="refresh" style="padding: 8px 16px; background: #4a4a6a; border: none; border-radius: 6px; color: #fff; cursor: pointer;">
                    🔄 Actualizar
                </button>
                <button data-action="sync-folder" style="padding: 8px 16px; background: #10b981; border: none; border-radius: 6px; color: #fff; cursor: pointer;">
                    📥 Sincronizar esta carpeta
                </button>
            </div>
            <div id="remote-files-list" style="flex: 1; overflow-y: auto; padding: 15px 20px;">
                <div style="text-align: center; padding: 40px; color: #a0a0b0;">Cargando...</div>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    // Store current state
    window.remoteBrowserState = { remoteName, path };
    
    // Add event delegation for modal buttons
    modal.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-action]');
        if (!btn) return;
        
        switch (btn.dataset.action) {
            case 'close': modal.remove(); break;
            case 'back': remoteBrowserBack(); break;
            case 'refresh': remoteBrowserRefresh(); break;
            case 'sync-folder': syncFromCurrentPath(); break;
        }
    });
    
    await loadRemoteFiles(remoteName, path);
}

async function loadRemoteFiles(remoteName, path) {
    const listDiv = document.getElementById('remote-files-list');
    const pathDisplay = document.getElementById('remote-path-display');
    
    if (pathDisplay) pathDisplay.textContent = '/' + path;
    
    try {
        const res = await authFetch(`${API_BASE}/cloud-backup/remotes/${encodeURIComponent(remoteName)}/ls?path=${encodeURIComponent(path)}`);
        if (!res.ok) throw new Error('Failed to load files');
        const data = await res.json();
        
        if (!data.items || data.items.length === 0) {
            listDiv.innerHTML = '<div style="text-align: center; padding: 40px; color: #a0a0b0;">📭 Carpeta vacía</div>';
            return;
        }
        
        // Sort: folders first, then files
        const sorted = data.items.sort((a, b) => {
            if (a.isDir && !b.isDir) return -1;
            if (!a.isDir && b.isDir) return 1;
            return a.name.localeCompare(b.name);
        });
        
        listDiv.innerHTML = sorted.map(item => `
            <div class="remote-file-item" style="display: flex; justify-content: space-between; align-items: center; padding: 12px 15px; background: rgba(255,255,255,0.03); border-radius: 8px; margin-bottom: 8px; cursor: ${item.isDir ? 'pointer' : 'default'}; border: 1px solid rgba(255,255,255,0.05);"
                ${item.isDir ? `data-action="navigate" data-path="${escapeHtml(item.path)}"` : ''}>
                <div style="display: flex; align-items: center; gap: 12px; overflow: hidden;">
                    <span style="font-size: 1.4rem;">${item.isDir ? '📁' : getFileIcon(item.name)}</span>
                    <div style="overflow: hidden;">
                        <div style="font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(item.name)}</div>
                        <div style="font-size: 0.8rem; color: #a0a0b0;">
                            ${item.isDir ? 'Carpeta' : formatFileSize(item.size)}
                            ${item.modTime ? ' • ' + new Date(item.modTime).toLocaleDateString() : ''}
                        </div>
                    </div>
                </div>
                ${!item.isDir ? `
                    <button data-action="download" data-path="${escapeHtml(item.path)}"
                        style="padding: 6px 12px; background: #6366f1; border: none; border-radius: 6px; color: #fff; cursor: pointer; font-size: 0.85rem;">
                        📥
                    </button>
                ` : ''}
            </div>
        `).join('');
        
        // Add event delegation for file list
        listDiv.addEventListener('click', (e) => {
            const item = e.target.closest('[data-action="navigate"]');
            if (item) {
                navigateRemoteFolder(item.dataset.path);
                return;
            }
            const downloadBtn = e.target.closest('[data-action="download"]');
            if (downloadBtn) {
                e.stopPropagation();
                downloadRemoteFile(window.remoteBrowserState.remoteName, downloadBtn.dataset.path);
            }
        });
        
    } catch (e) {
        listDiv.innerHTML = `<div style="text-align: center; padding: 40px; color: #ef4444;">Error: ${e.message}</div>`;
    }
}

function navigateRemoteFolder(path) {
    window.remoteBrowserState.path = path;
    loadRemoteFiles(window.remoteBrowserState.remoteName, path);
    
    // Enable back button
    const backBtn = document.getElementById('remote-back-btn');
    if (backBtn) {
        backBtn.disabled = false;
        backBtn.style.opacity = '1';
    }
}

function remoteBrowserBack() {
    const state = window.remoteBrowserState;
    if (!state.path) return;
    
    // Go up one level
    const parts = state.path.split('/').filter(Boolean);
    parts.pop();
    state.path = parts.join('/');
    
    loadRemoteFiles(state.remoteName, state.path);
    
    // Disable back button if at root
    if (!state.path) {
        const backBtn = document.getElementById('remote-back-btn');
        if (backBtn) {
            backBtn.disabled = true;
            backBtn.style.opacity = '0.5';
        }
    }
}

function remoteBrowserRefresh() {
    const state = window.remoteBrowserState;
    loadRemoteFiles(state.remoteName, state.path);
}

async function downloadRemoteFile(remoteName, filePath) {
    showNotification('Descarga iniciada...', 'info');
    // This would need a backend endpoint to handle the actual download
    alert(`Para descargar: rclone copy "${remoteName}:${filePath}" /mnt/storage/downloads/`);
}

function syncFromCurrentPath() {
    const state = window.remoteBrowserState;
    document.getElementById('remote-browser-modal')?.remove();
    showSyncWizard(state.remoteName, state.path);
}

async function syncRemote(remoteName) {
    showSyncWizard(remoteName, '');
}

function showSyncWizard(remoteName, remotePath = '') {
    const modal = document.createElement('div');
    modal.id = 'sync-wizard-modal';
    modal.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.9); display: flex; align-items: center; justify-content: center; z-index: 100000;';
    
    modal.innerHTML = `
        <div style="background: #1a1a2e; border: 1px solid #3d3d5c; border-radius: 16px; width: 95%; max-width: 600px; padding: 25px;">
            <h3 style="color: #10b981; margin-bottom: 20px;">🔄 Configurar Sincronización</h3>
            
            <div style="margin-bottom: 20px;">
                <label style="color: #fff; display: block; margin-bottom: 8px;">📤 Origen (nube):</label>
                <div style="display: flex; gap: 10px;">
                    <input type="text" id="sync-source" value="${remoteName}:${remotePath}" readonly 
                        style="flex: 1; padding: 10px; background: #2d2d44; border: 1px solid #3d3d5c; border-radius: 6px; color: #fff;">
                    <button data-action="browse-source" style="padding: 10px 15px; background: #6366f1; border: none; border-radius: 6px; color: #fff; cursor: pointer;">📂</button>
                </div>
            </div>
            
            <div style="margin-bottom: 20px;">
                <label style="color: #fff; display: block; margin-bottom: 8px;">📥 Destino (NAS):</label>
                <div style="display: flex; gap: 10px;">
                    <input type="text" id="sync-dest" value="/mnt/storage/cloud-backup/${remoteName}" 
                        style="flex: 1; padding: 10px; background: #2d2d44; border: 1px solid #3d3d5c; border-radius: 6px; color: #fff;">
                    <button data-action="browse-dest" style="padding: 10px 15px; background: #6366f1; border: none; border-radius: 6px; color: #fff; cursor: pointer;">📂</button>
                </div>
            </div>
            
            <div style="margin-bottom: 20px;">
                <label style="color: #fff; display: block; margin-bottom: 8px;">⚙️ Modo:</label>
                <select id="sync-mode" style="width: 100%; padding: 10px; background: #2d2d44; border: 1px solid #3d3d5c; border-radius: 6px; color: #fff;">
                    <option value="copy">📥 Copiar (solo añade archivos nuevos)</option>
                    <option value="sync">🔄 Sincronizar (hace destino idéntico al origen)</option>
                    <option value="move">✂️ Mover (elimina del origen después de copiar)</option>
                </select>
            </div>
            
            <div style="margin-bottom: 20px;">
                <label style="color: #fff; display: block; margin-bottom: 8px;">⏰ Programar:</label>
                <select id="sync-schedule" style="width: 100%; padding: 10px; background: #2d2d44; border: 1px solid #3d3d5c; border-radius: 6px; color: #fff;">
                    <option value="now">▶️ Ejecutar ahora (una vez)</option>
                    <option value="hourly">🕐 Cada hora</option>
                    <option value="daily">📅 Diariamente (3:00 AM)</option>
                    <option value="weekly">📆 Semanalmente (Domingo 3:00 AM)</option>
                </select>
            </div>
            
            <div style="display: flex; gap: 10px; justify-content: flex-end;">
                <button data-action="cancel" style="padding: 12px 24px; background: #4a4a6a; border: none; border-radius: 6px; color: #fff; cursor: pointer;">Cancelar</button>
                <button data-action="start-sync" style="padding: 12px 24px; background: #10b981; border: none; border-radius: 6px; color: #fff; cursor: pointer; font-weight: 600;">🚀 Iniciar</button>
            </div>
        </div>
    `;
    
    // Add event listeners
    modal.addEventListener('click', async (e) => {
        const btn = e.target.closest('button[data-action]');
        if (!btn) return;
        
        switch (btn.dataset.action) {
            case 'cancel': modal.remove(); break;
            case 'browse-source': browseForSync('source'); break;
            case 'browse-dest': browseLocalForSync(); break;
            case 'start-sync': await startSync(); break;
        }
    });
    
    document.body.appendChild(modal);
}

async function startSync() {
    const source = document.getElementById('sync-source').value;
    const dest = document.getElementById('sync-dest').value;
    const mode = document.getElementById('sync-mode').value;
    const schedule = document.getElementById('sync-schedule').value;
    
    if (!source || !dest) {
        alert('Origen y destino son requeridos');
        return;
    }
    
    document.getElementById('sync-wizard-modal')?.remove();
    
    if (schedule === 'now') {
        // Execute immediately
        showNotification('Iniciando sincronización...', 'info');
        
        try {
            const res = await authFetch(`${API_BASE}/cloud-backup/sync`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ source, dest, mode })
            });
            const data = await res.json();
            
            if (data.success) {
                showNotification('Sincronización iniciada en segundo plano', 'success');
                showSyncProgress(data.jobId);
            } else {
                throw new Error(data.error);
            }
        } catch (e) {
            showNotification('Error: ' + e.message, 'error');
        }
    } else {
        // Schedule for later - save to cron
        try {
            const name = `${source.split(':')[0]} → ${dest.split('/').pop()}`;
            const res = await authFetch(`${API_BASE}/cloud-backup/schedules`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, source, dest, mode, schedule })
            });
            const data = await res.json();
            
            if (data.success) {
                showNotification('Sincronización programada correctamente', 'success');
                await loadCloudBackupStatus();
            } else {
                throw new Error(data.error);
            }
        } catch (e) {
            showNotification('Error programando: ' + e.message, 'error');
        }
    }
}

function showSyncProgress(jobId) {
    const toast = document.createElement('div');
    toast.id = `sync-progress-${jobId}`;
    toast.style.cssText = 'position: fixed; bottom: 20px; right: 20px; background: #1a1a2e; border: 1px solid #3d3d5c; border-radius: 12px; padding: 15px 20px; z-index: 100001; width: 320px;';
    toast.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
            <span style="color: #10b981; font-weight: 600;">🔄 Sincronizando...</span>
            <button data-action="close" style="background: none; border: none; color: #fff; cursor: pointer; font-size: 18px;">×</button>
        </div>
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
            <span id="sync-progress-text-${jobId}" style="color: #a0a0b0; font-size: 0.85rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 240px;">Iniciando...</span>
            <span id="sync-progress-percent-${jobId}" style="color: #10b981; font-weight: 600; font-size: 0.9rem;">0%</span>
        </div>
        <div style="height: 6px; background: #2d2d44; border-radius: 3px; overflow: hidden;">
            <div id="sync-progress-bar-${jobId}" style="height: 100%; background: linear-gradient(90deg, #10b981, #6366f1); width: 0%; transition: width 0.5s ease;"></div>
        </div>
    `;
    document.body.appendChild(toast);
    
    // Close button
    toast.querySelector('[data-action="close"]').addEventListener('click', () => toast.remove());
    
    // Poll for progress
    const pollProgress = async () => {
        // Check if toast still exists
        if (!document.getElementById(`sync-progress-${jobId}`)) return;
        
        try {
            const res = await authFetch(`${API_BASE}/cloud-backup/jobs/${jobId}`);
            const data = await res.json();
            
            const textEl = document.getElementById(`sync-progress-text-${jobId}`);
            const barEl = document.getElementById(`sync-progress-bar-${jobId}`);
            const percentEl = document.getElementById(`sync-progress-percent-${jobId}`);
            
            // Parse rclone output to extract useful info
            const line = data.lastLine || '';
            
            // Try to extract percentage (e.g., "45%")
            const percentMatch = line.match(/(\d+)%/);
            const percent = percentMatch ? parseInt(percentMatch[1]) : 0;
            
            // Try to extract transferred amount (e.g., "1.234 GiB / 5.678 GiB")
            const transferMatch = line.match(/([\d.]+\s*[KMGT]i?B)\s*\/\s*([\d.]+\s*[KMGT]i?B)/i);
            const transferred = transferMatch ? `${transferMatch[1]} / ${transferMatch[2]}` : '';
            
            // Try to extract speed (e.g., "10.5 MiB/s")
            const speedMatch = line.match(/([\d.]+\s*[KMGT]i?B\/s)/i);
            const speed = speedMatch ? speedMatch[1] : '';
            
            // Update UI
            if (textEl) {
                if (transferred) {
                    textEl.textContent = `${transferred}${speed ? ' • ' + speed : ''}`;
                } else {
                    textEl.textContent = 'Procesando...';
                }
            }
            
            if (barEl) {
                barEl.style.width = percent + '%';
            }
            
            if (percentEl) {
                percentEl.textContent = percent + '%';
            }
            
            if (data.running) {
                setTimeout(pollProgress, 1500);
            } else {
                if (textEl) textEl.textContent = '✅ Completado';
                if (barEl) barEl.style.width = '100%';
                if (percentEl) percentEl.textContent = '100%';
                setTimeout(() => {
                    document.getElementById(`sync-progress-${jobId}`)?.remove();
                }, 5000);
            }
        } catch (e) {
            console.error('Progress poll error:', e);
            // Continue polling even on error
            setTimeout(pollProgress, 3000);
        }
    };
    
    // Start polling immediately
    pollProgress();
}

function browseLocalForSync() {
    // Simple prompt for now - could integrate with file browser
    const path = prompt('Ruta de destino en el NAS:', document.getElementById('sync-dest').value);
    if (path) {
        document.getElementById('sync-dest').value = path;
    }
}

async function deleteRemote(remoteName) {
    if (!confirm(`¿Eliminar la configuración de "${remoteName}"?`)) return;
    
    try {
        const res = await authFetch(`${API_BASE}/cloud-backup/remotes/${encodeURIComponent(remoteName)}/delete`, {
            method: 'POST'
        });
        const data = await res.json();
        
        if (data.success) {
            showNotification('Nube eliminada', 'success');
            await loadCloudBackupStatus();
        } else {
            throw new Error(data.error);
        }
    } catch (e) {
        alert('Error: ' + e.message);
    }
}

// Expose cloud backup functions globally
window.installRclone = installRclone;
window.showAddCloudModal = showAddCloudModal;
window.startCloudConfig = startCloudConfig;
window.saveOAuthConfig = saveOAuthConfig;
window.saveSimpleConfig = saveSimpleConfig;
window.browseRemote = browseRemote;
window.syncRemote = syncRemote;
window.deleteRemote = deleteRemote;
window.loadRemoteFiles = loadRemoteFiles;
window.navigateRemoteFolder = navigateRemoteFolder;
window.remoteBrowserBack = remoteBrowserBack;
window.remoteBrowserRefresh = remoteBrowserRefresh;
window.downloadRemoteFile = downloadRemoteFile;
window.syncFromCurrentPath = syncFromCurrentPath;
window.showSyncWizard = showSyncWizard;
window.startSync = startSync;
window.browseLocalForSync = browseLocalForSync;
window.toggleScheduledSync = toggleScheduledSync;
window.deleteScheduledSync = deleteScheduledSync;
window.clearTransferHistory = clearTransferHistory;

init();
console.log("HomePiNAS Core v2.6.0 Loaded - Cloud Backup");
