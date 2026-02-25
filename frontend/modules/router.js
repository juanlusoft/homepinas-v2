/**
 * Router Module
 * URL routing, view management, and navigation
 * 
 * NOTE: This file exceeds 300 lines due to complex routing logic,
 * polling management, and disk notification system.
 */
(function(window) {
    'use strict';
    
    const state = window.AppState;
    const API_BASE = window.API_BASE;
    const escapeHtml = window.AppUtils.escapeHtml;
    const showNotification = window.AppNotifications ? window.AppNotifications.show : null;
    
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
    'active-directory': 'Active Directory',
    'cloud-sync': 'Cloud Sync',
    'cloud-backup': 'Cloud Backup',
    'homestore': '🏪 HomeStore',
    'logs': 'Visor de Logs',
    'users': 'Gestión de Usuarios',
    'system': 'Administración del Sistema'
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
    // Start pending agent detection polling
    startPendingAgentPolling();
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
    try {
        const res = await authFetch(`${API_BASE}/ddns/public-ip`);
        if (res.ok) {
            const data = await res.json();
            state.publicIP = data.ip || 'N/A';
        } else {
            state.publicIP = 'N/A';
        }
    } catch (e) {
        console.warn('Could not fetch public IP:', e);
        state.publicIP = 'N/A';
    }
    if (val) val.textContent = state.publicIP;
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

// ═══════════════════════════════════════════════════════════════════════════
// PENDING AGENT DETECTION - Global banner for new backup agents
// ═══════════════════════════════════════════════════════════════════════════

let pendingAgentBannerShown = false;
let lastPendingAgentIds = [];

async function checkForPendingAgents() {
    try {
        const res = await authFetch(`${API_BASE}/active-backup/pending`);
        if (!res.ok) return;
        const data = await res.json();
        const pending = data.pending || [];

        const currentIds = pending.map(a => a.id).sort().join(',');
        const previousIds = lastPendingAgentIds.join(',');

        if (pending.length > 0 && (currentIds !== previousIds || !pendingAgentBannerShown)) {
            lastPendingAgentIds = pending.map(a => a.id).sort();
            showPendingAgentBanner(pending);
        } else if (pending.length === 0 && pendingAgentBannerShown) {
            hidePendingAgentBanner();
        }
    } catch (e) {}
}

function showPendingAgentBanner(agents) {
    pendingAgentBannerShown = true;
    const existing = document.getElementById('agent-pending-notification');
    if (existing) existing.remove();

    const notification = document.createElement('div');
    notification.id = 'agent-pending-notification';
    notification.style.cssText = `
        position: fixed;
        top: 70px;
        right: 20px;
        background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
        border: 1px solid #f59e0b;
        border-radius: 12px;
        padding: 16px 20px;
        z-index: 99998;
        box-shadow: 0 8px 32px rgba(245, 158, 11, 0.3);
        max-width: 400px;
        animation: slideIn 0.3s ease-out;
    `;

    const agentList = agents.map(a => {
        const osIcon = a.os === 'win32' ? '🪟' : a.os === 'darwin' ? '🍎' : '🐧';
        return `<div style="display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.1);">
            <div>
                <div style="color: #fff; font-weight: 500;">${osIcon} ${a.hostname}</div>
                <div style="color: #888; font-size: 11px;">${a.ip} · ${a.os === 'win32' ? 'Windows' : a.os === 'darwin' ? 'macOS' : a.os}</div>
            </div>
        </div>`;
    }).join('');

    notification.innerHTML = `
        <button style="position: absolute; top: 8px; right: 12px; background: none; border: none; color: #888; font-size: 18px; cursor: pointer;" id="agent-notif-close">×</button>
        <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 12px;">
            <span style="font-size: 24px;">🔔</span>
            <div>
                <div style="color: #f59e0b; font-weight: 600;">Nuevo equipo quiere conectarse</div>
                <div style="color: #888; font-size: 12px;">${agents.length} dispositivo(s) pendiente(s)</div>
            </div>
        </div>
        <div>${agentList}</div>
        <div style="display: flex; gap: 8px; margin-top: 12px;">
            <button style="padding: 6px 12px; border-radius: 6px; border: none; cursor: pointer; font-size: 12px; background: #f59e0b; color: #1a1a2e; font-weight: 600;" id="agent-notif-review">Revisar</button>
            <button style="padding: 6px 12px; border-radius: 6px; border: none; cursor: pointer; font-size: 12px; background: rgba(255,255,255,0.1); color: #fff;" id="agent-notif-dismiss">Ahora no</button>
        </div>
    `;

    document.body.appendChild(notification);

    document.getElementById('agent-notif-close').addEventListener('click', hidePendingAgentBanner);
    document.getElementById('agent-notif-dismiss').addEventListener('click', hidePendingAgentBanner);
    document.getElementById('agent-notif-review').addEventListener('click', () => {
        hidePendingAgentBanner();
        navigateTo('active-backup');
    });
}

function hidePendingAgentBanner() {
    pendingAgentBannerShown = false;
    const notification = document.getElementById('agent-pending-notification');
    if (notification) {
        notification.style.animation = 'slideOut 0.3s ease-in forwards';
        setTimeout(() => notification.remove(), 300);
    }
}

function startPendingAgentPolling() {
    setTimeout(checkForPendingAgents, 8000);
    state.pollingIntervals.pendingAgents = setInterval(checkForPendingAgents, 15000);
}

// Router / View Switcher
// skipRender=true when caller will handle rendering separately (e.g. initAuth with URL routing)
function switchView(viewName, skipRender = false) {
    Object.values(views).forEach(v => v.classList.remove('active'));
    if (views[viewName]) {
        views[viewName].classList.add('active');
        
        // Update URL for auth views to prevent confusion (e.g. user lands on /files but sees setup)
        if (viewName === 'setup' || viewName === 'login' || viewName === 'storage') {
            const targetPath = viewName === 'storage' ? '/setup/storage' : '/' + viewName;
            if (window.location.pathname !== targetPath) {
                history.replaceState({ path: targetPath }, '', targetPath);
            }
        }
        
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
    btn.textContent = t('auth.hardwareSync', 'Sincronizando Hardware...');
    btn.disabled = true;

    try {
        const res = await fetch(`${API_BASE}/setup`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });

        const data = await res.json();

        if (!res.ok) {
            alert(data.message || t('common.error', 'Error en la configuración'));
            btn.disabled = false;
            btn.textContent = t('auth.initializeGateway', 'Inicializar Sistema');
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
        alert(t('common.error', 'Error de conexión con hardware'));
        btn.disabled = false;
        btn.textContent = t('auth.initializeGateway', 'Inicializar Sistema');
    }
});


    // Expose to window
    window.AppRouter = {
        navigateTo,
        getViewFromPath,
        handleRouteChange,
        switchView,
        startGlobalPolling,
        stopGlobalPolling,
        views,
        viewsMap
    };
    
})(window);
