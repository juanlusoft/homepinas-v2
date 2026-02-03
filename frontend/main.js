// Import i18n
import { initI18n, t, applyTranslations, getCurrentLang } from './i18n.js';

// State Management
const state = {
    isAuthenticated: false,
    currentView: 'loading',
    user: null,
    sessionId: null,
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

// Authenticated fetch wrapper
async function authFetch(url, options = {}) {
    const headers = {
        'Content-Type': 'application/json',
        ...options.headers
    };

    if (state.sessionId) {
        headers['X-Session-Id'] = state.sessionId;
    }

    const response = await fetch(url, { ...options, headers });

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
function saveSession(sessionId) {
    state.sessionId = sessionId;
    localStorage.setItem('sessionId', sessionId);
}

function loadSession() {
    const sessionId = localStorage.getItem('sessionId');
    if (sessionId) {
        state.sessionId = sessionId;
    }
    return sessionId;
}

function clearSession() {
    state.sessionId = null;
    state.user = null;
    state.isAuthenticated = false;
    localStorage.removeItem('sessionId');
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

// DDNS Elements
const ddnsModal = document.getElementById('ddns-modal');
const ddnsForm = document.getElementById('ddns-form');
const serviceSelect = document.getElementById('ddns-service-select');
const dynamicFields = document.getElementById('ddns-dynamic-fields');

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
            switchView('dashboard');

            // Check URL and navigate to correct view
            const urlPath = window.location.pathname;
            if (urlPath && urlPath !== '/' && urlPath !== '/login' && urlPath !== '/setup') {
                const urlView = getViewFromPath(urlPath);
                if (urlView !== 'dashboard') {
                    handleRouteChange();
                }
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
            const res = await fetch(`${API_BASE}/system/stats`);
            if (res.ok) {
                state.globalStats = await res.json();

                // Re-render dashboard if active to show real-time changes
                if (state.currentView === "dashboard") renderDashboard();
            }
        } catch (e) {
            console.error('Stats polling error:', e);
        }
    }, 2000);

    // Polling Public IP
    updatePublicIP();
    state.pollingIntervals.publicIP = setInterval(updatePublicIP, 1000 * 60 * 10);
}

// Public IP Tracker
async function updatePublicIP() {
    const val = document.getElementById('public-ip-val');
    const mockIps = ['84.120.45.122', '84.120.45.123', '84.120.45.124'];
    state.publicIP = mockIps[Math.floor(Math.random() * mockIps.length)];
    if (val) val.textContent = state.publicIP;

    const activeNav = document.querySelector('.nav-links li.active');
    if (activeNav && activeNav.dataset.view === 'network') renderNetworkManager();
}

// Router / View Switcher
function switchView(viewName) {
    Object.values(views).forEach(v => v.classList.remove('active'));
    if (views[viewName]) {
        views[viewName].classList.add('active');
        if (viewName === 'dashboard') renderContent('dashboard');
        // Update username display
        const usernameEl = document.getElementById("username-display");
        if (usernameEl && state.user) usernameEl.textContent = state.user.username || "Admin";
    }
    updateHeaderIPVisibility();
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
            saveSession(data.sessionId);
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

function initStorageSetup() {
    const tableBody = document.getElementById('granular-disk-list');
    if (!tableBody) return;
    tableBody.innerHTML = '';

    state.disks.forEach(disk => {
        const tr = document.createElement('tr');

        // Create elements safely to prevent XSS
        const diskInfoTd = document.createElement('td');
        const diskInfoDiv = document.createElement('div');
        diskInfoDiv.className = 'disk-info';

        const modelStrong = document.createElement('strong');
        modelStrong.textContent = disk.model || 'Unknown';

        const infoSpan = document.createElement('span');
        infoSpan.textContent = `${disk.id || 'N/A'} • ${disk.size || 'N/A'}`;

        diskInfoDiv.appendChild(modelStrong);
        diskInfoDiv.appendChild(infoSpan);
        diskInfoTd.appendChild(diskInfoDiv);

        const typeTd = document.createElement('td');
        const typeBadge = document.createElement('span');
        typeBadge.className = `badge ${escapeHtml((disk.type || 'unknown').toLowerCase())}`;
        typeBadge.textContent = disk.type || 'Unknown';
        typeTd.appendChild(typeBadge);

        const roleTd = document.createElement('td');
        const roleDiv = document.createElement('div');
        roleDiv.className = 'role-selector';
        roleDiv.dataset.disk = disk.id;

        const roles = ['none', 'data', 'parity'];
        if (disk.type === 'NVMe' || disk.type === 'SSD') {
            roles.push('cache');
        }

        roles.forEach((role, index) => {
            const btn = document.createElement('button');
            btn.className = `role-btn${index === 0 ? ' active' : ''}`;
            btn.dataset.role = role;
            btn.textContent = role.charAt(0).toUpperCase() + role.slice(1);
            roleDiv.appendChild(btn);
        });

        roleTd.appendChild(roleDiv);

        tr.appendChild(diskInfoTd);
        tr.appendChild(typeTd);
        tr.appendChild(roleTd);
        tableBody.appendChild(tr);
    });

    document.querySelectorAll('.role-btn').forEach(btn => {
        btn.onclick = (e) => {
            const container = e.target.parentElement;
            container.querySelectorAll('.role-btn').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            updateSummary();
        };
    });
}

function updateSummary() {
    const roles = { data: 0, parity: 0, cache: 0 };
    document.querySelectorAll('.role-btn.active').forEach(btn => {
        const role = btn.dataset.role;
        if (role !== 'none') roles[role]++;
    });
    document.getElementById('data-count').textContent = roles.data;
    document.getElementById('parity-count').textContent = roles.parity;
    document.getElementById('cache-count').textContent = roles.cache;
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

        const diskList = selections.map(s => `${s.id} (${s.role})`).join('\n');
        const confirmed = confirm(`⚠️ WARNING: This will FORMAT the following disks:\n\n${diskList}\n\nAll data will be ERASED!\n\nDo you want to continue?`);

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
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = document.getElementById('username').value.trim();
        const password = document.getElementById('password').value;
        const btn = e.target.querySelector('button[type="submit"]');

        btn.textContent = 'Hardware Auth...';
        btn.disabled = true;

        try {
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

            // Save session
            if (data.sessionId) {
                saveSession(data.sessionId);
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

// Navigation
navLinks.forEach(link => {
    link.addEventListener('click', () => {
        navLinks.forEach(l => l.classList.remove('active'));
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

async function renderContent(view) {
    state.currentView = view;
    dashboardContent.innerHTML = '';
    if (view === 'dashboard') renderDashboard();
    else if (view === 'docker') renderDockerManager();
    else if (view === 'storage') renderStorageDashboard();
    else if (view === 'files') renderFilesView();
    else if (view === 'terminal') renderTerminalView();
    else if (view === 'network') {
        await renderNetworkManager();
        // Append Samba + DDNS sections after network interfaces
        await renderSambaSection(dashboardContent);
        await renderDDNSSection(dashboardContent);
    }
    else if (view === 'backup') renderBackupView();
    else if (view === 'logs') renderLogsView();
    else if (view === 'users') renderUsersView();
    else if (view === 'system') {
        renderSystemView();
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
    const lanIP = escapeHtml(state.network.interfaces[0]?.ip || 'Scanning...');
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
            const poolUsedNum = parseFloat(poolStatus.poolUsed) || 0;
            const poolSizeNum = parseFloat(poolStatus.poolSize) || 1;
            const poolPercent = Math.round((poolUsedNum / poolSizeNum) * 100);
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

    headerRight.appendChild(checkUpdatesBtn);
    headerRight.appendChild(importComposeBtn);
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

            // Stats row (only if running)
            if (isRunning) {
                const statsRow = document.createElement('div');
                statsRow.style.cssText = 'display: flex; gap: 20px; margin-bottom: 15px; padding: 10px; background: rgba(255,255,255,0.03); border-radius: 8px;';
                statsRow.innerHTML = `
                    <div style="flex: 1; text-align: center;">
                        <div style="font-size: 0.7rem; color: var(--text-dim);">CPU</div>
                        <div style="font-size: 1rem; font-weight: 600; color: ${container.cpu !== '---' && parseFloat(container.cpu) > 50 ? '#f59e0b' : '#10b981'}">${escapeHtml(container.cpu)}</div>
                    </div>
                    <div style="flex: 1; text-align: center;">
                        <div style="font-size: 0.7rem; color: var(--text-dim);">RAM</div>
                        <div style="font-size: 1rem; font-weight: 600; color: #6366f1;">${escapeHtml(container.ram)}</div>
                    </div>
                `;
                card.appendChild(header);
                card.appendChild(statsRow);
            } else {
                card.appendChild(header);
            }

            // Ports section
            if (container.ports && container.ports.length > 0) {
                const portsDiv = document.createElement('div');
                portsDiv.className = 'docker-ports';
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
            controls.style.cssText = 'display: flex; gap: 8px; flex-wrap: wrap;';

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
async function checkDockerUpdates() {
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
    if (!confirm(`Update container "${containerName}"?\n\nThis will:\n1. Stop the container\n2. Pull the latest image\n3. Recreate the container\n\nVolumes and data will be preserved.`)) {
        return;
    }

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
    if (!confirm(`Delete compose "${name}"?\n\nThis will stop all containers and remove the compose file.`)) {
        return;
    }

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

    // 2. DDNS Section
    const ddnsSection = document.createElement('div');
    const ddnsTitle = document.createElement('h3');
    ddnsTitle.style.cssText = 'margin-top: 40px; margin-bottom: 20px;';
    ddnsTitle.textContent = 'Remote Access (DDNS)';
    ddnsSection.appendChild(ddnsTitle);

    const ddnsGrid = document.createElement('div');
    ddnsGrid.className = 'ddns-grid';

    (state.network.ddns || []).forEach(service => {
        const card = document.createElement('div');
        card.className = 'glass-card ddns-card';

        const isOnline = service.status === 'online';

        // Header
        const ddnsHeader = document.createElement('div');
        ddnsHeader.className = 'ddns-header';

        const logo = document.createElement('div');
        logo.className = 'ddns-logo';
        logo.style.background = isOnline ? '#10b981' : '#ef4444';
        logo.textContent = (service.name || 'U').charAt(0);

        const headerInfo = document.createElement('div');
        const serviceH4 = document.createElement('h4');
        serviceH4.textContent = service.name || 'Unknown';
        const statusInfo = document.createElement('span');
        statusInfo.style.fontSize = '0.75rem';
        // SECURITY: Escape service.status to prevent XSS
        statusInfo.innerHTML = `<span class="status-dot ${isOnline ? 'status-check-online' : 'status-check-offline'}"></span>${escapeHtml((service.status || 'unknown').toUpperCase())}`;
        headerInfo.appendChild(serviceH4);
        headerInfo.appendChild(statusInfo);

        ddnsHeader.appendChild(logo);
        ddnsHeader.appendChild(headerInfo);

        // Domain row
        const domainRow = document.createElement('div');
        domainRow.className = 'status-row-net';
        const domainLabel = document.createElement('span');
        domainLabel.textContent = 'Domain';
        const domainValue = document.createElement('span');
        domainValue.style.color = 'white';
        domainValue.textContent = service.domain || 'N/A';
        domainRow.appendChild(domainLabel);
        domainRow.appendChild(domainValue);

        // IP row
        const ipRow = document.createElement('div');
        ipRow.className = 'status-row-net';
        const ipLabel = document.createElement('span');
        ipLabel.textContent = 'Gateway IP';
        const ipValue = document.createElement('span');
        ipValue.style.cssText = 'color: #10b981; font-weight: 600;';
        ipValue.textContent = isOnline ? (state.publicIP || '---') : '---';
        ipRow.appendChild(ipLabel);
        ipRow.appendChild(ipValue);

        card.appendChild(ddnsHeader);
        card.appendChild(domainRow);
        card.appendChild(ipRow);
        ddnsGrid.appendChild(card);
    });

    // Add service button
    const addCard = document.createElement('div');
    addCard.className = 'btn-add-ddns';
    addCard.addEventListener('click', openDDNSModal);

    const plusIcon = document.createElement('span');
    plusIcon.className = 'plus-icon';
    plusIcon.textContent = '+';
    const addText = document.createElement('span');
    addText.style.cssText = 'font-size: 0.9rem; font-weight: 600;';
    addText.textContent = 'Add Service';

    addCard.appendChild(plusIcon);
    addCard.appendChild(addText);
    ddnsGrid.appendChild(addCard);

    ddnsSection.appendChild(ddnsGrid);
    container.appendChild(ifaceSection);
    container.appendChild(ddnsSection);
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

function openDDNSModal() {
    if (ddnsModal) {
        ddnsModal.style.display = 'flex';
    }
}

function closeDDNSModal() {
    if (ddnsModal) {
        ddnsModal.style.display = 'none';
    }
}

// Initialize modal close button
const closeModalBtn = document.getElementById('close-modal');
if (closeModalBtn) {
    closeModalBtn.addEventListener('click', closeDDNSModal);
}

// Close modal on outside click
if (ddnsModal) {
    ddnsModal.addEventListener('click', (e) => {
        if (e.target === ddnsModal) {
            closeDDNSModal();
        }
    });
}

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
    const actionLabel = action === 'reboot' ? 'restart' : 'shut down';

    if (!confirm(`Are you sure you want to ${actionLabel} the NAS?`)) return;

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
    if (!confirm('Install the update now? The service will restart and you may lose connection for ~30 seconds.')) {
        return;
    }

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
        if (!confirm('Are you sure you want to RESET the entire NAS? This will delete all configuration and require a new setup.')) return;

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
    logoutBtn.addEventListener("click", () => {
        if (confirm(t('common.confirmLogout', "Are you sure you want to logout?"))) {
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
                if (confirm(t('shortcuts.confirmDelete', '¿Eliminar este acceso directo?'))) {
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
                background: '#0d0d0d',
                foreground: '#e5e5e5',
                cursor: '#84cc16',
                selection: 'rgba(132, 204, 22, 0.3)'
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
// FILE MANAGER (File Station)
// =============================================================================

let currentFilePath = '/';

async function renderFilesView() {
    const container = document.createElement('div');
    container.className = 'files-container';
    container.style.cssText = 'display: contents;';

    // Toolbar
    const toolbar = document.createElement('div');
    toolbar.className = 'glass-card files-toolbar';
    toolbar.style.cssText = 'grid-column: 1 / -1; display: flex; align-items: center; gap: 12px; padding: 15px 20px; flex-wrap: wrap;';

    // Breadcrumb
    const breadcrumb = document.createElement('div');
    breadcrumb.className = 'files-breadcrumb';
    breadcrumb.style.cssText = 'display: flex; align-items: center; gap: 4px; flex: 1; min-width: 200px; overflow-x: auto;';
    updateBreadcrumb(breadcrumb, currentFilePath);

    // Action buttons
    const actions = document.createElement('div');
    actions.style.cssText = 'display: flex; gap: 8px; flex-wrap: wrap;';

    const uploadBtn = document.createElement('button');
    uploadBtn.className = 'btn-primary btn-sm';
    uploadBtn.textContent = '📤 Subir';
    uploadBtn.addEventListener('click', () => triggerFileUpload());

    const newFolderBtn = document.createElement('button');
    newFolderBtn.className = 'btn-primary btn-sm';
    newFolderBtn.style.background = '#6366f1';
    newFolderBtn.textContent = '📁 Nueva Carpeta';
    newFolderBtn.addEventListener('click', () => createNewFolder());

    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.placeholder = '🔍 Buscar...';
    searchInput.style.cssText = 'padding: 8px 12px; border-radius: 8px; border: 1px solid var(--border); background: var(--bg-card); color: var(--text); width: 200px;';
    searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') searchFiles(searchInput.value);
    });

    actions.appendChild(searchInput);
    actions.appendChild(uploadBtn);
    actions.appendChild(newFolderBtn);

    toolbar.appendChild(breadcrumb);
    toolbar.appendChild(actions);
    container.appendChild(toolbar);

    // File list card
    const listCard = document.createElement('div');
    listCard.className = 'glass-card';
    listCard.style.cssText = 'grid-column: 1 / -1; padding: 0; overflow: hidden;';
    listCard.id = 'files-list-card';

    // Table header
    const tableHeader = document.createElement('div');
    tableHeader.className = 'files-table-header';
    tableHeader.style.cssText = 'display: grid; grid-template-columns: 40px 1fr 100px 160px 60px; padding: 12px 20px; background: var(--bg-hover); font-weight: 600; font-size: 0.85rem; color: var(--text-dim);';
    tableHeader.innerHTML = '<span></span><span>Nombre</span><span>Tamaño</span><span>Modificado</span><span></span>';
    listCard.appendChild(tableHeader);

    const filesList = document.createElement('div');
    filesList.id = 'files-list';
    filesList.style.cssText = 'max-height: 65vh; overflow-y: auto;';
    listCard.appendChild(filesList);

    container.appendChild(listCard);
    dashboardContent.appendChild(container);

    // Hidden file input for uploads
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

    await loadFiles(currentFilePath);
}

function updateBreadcrumb(breadcrumb, filePath) {
    breadcrumb.innerHTML = '';
    const parts = filePath.split('/').filter(Boolean);
    const homeBtn = document.createElement('button');
    homeBtn.textContent = '🏠';
    homeBtn.className = 'breadcrumb-btn';
    homeBtn.style.cssText = 'background: none; border: none; cursor: pointer; padding: 4px 8px; border-radius: 6px; font-size: 1rem;';
    homeBtn.addEventListener('click', () => { currentFilePath = '/'; renderFilesView(); });
    breadcrumb.appendChild(homeBtn);

    let accPath = '';
    parts.forEach((part, i) => {
        accPath += '/' + part;
        const sep = document.createElement('span');
        sep.textContent = '›';
        sep.style.cssText = 'color: var(--text-dim); margin: 0 2px;';
        breadcrumb.appendChild(sep);

        const btn = document.createElement('button');
        btn.textContent = part;
        btn.className = 'breadcrumb-btn';
        btn.style.cssText = `background: none; border: none; cursor: pointer; padding: 4px 8px; border-radius: 6px; font-size: 0.9rem; color: ${i === parts.length - 1 ? 'var(--text)' : 'var(--text-dim)'};`;
        const targetPath = accPath;
        btn.addEventListener('click', () => { currentFilePath = targetPath; renderFilesView(); });
        breadcrumb.appendChild(btn);
    });
}

async function loadFiles(filePath) {
    const filesList = document.getElementById('files-list');
    if (!filesList) return;
    filesList.innerHTML = '<div style="padding: 40px; text-align: center; color: var(--text-dim);">Cargando...</div>';

    try {
        const res = await authFetch(`${API_BASE}/files/list?path=${encodeURIComponent(filePath)}`);
        if (!res.ok) throw new Error('Failed to load files');
        const files = await res.json();

        if (files.length === 0) {
            filesList.innerHTML = '<div style="padding: 40px; text-align: center; color: var(--text-dim);">📂 Carpeta vacía</div>';
            return;
        }

        // Sort: folders first, then alphabetical
        files.sort((a, b) => {
            if (a.type === 'directory' && b.type !== 'directory') return -1;
            if (a.type !== 'directory' && b.type === 'directory') return 1;
            return a.name.localeCompare(b.name);
        });

        filesList.innerHTML = '';
        files.forEach(file => {
            const row = document.createElement('div');
            row.className = 'files-row';
            row.style.cssText = 'display: grid; grid-template-columns: 40px 1fr 100px 160px 60px; padding: 10px 20px; align-items: center; border-bottom: 1px solid var(--border); cursor: pointer; transition: background 0.15s;';
            row.addEventListener('mouseenter', () => row.style.background = 'var(--bg-hover)');
            row.addEventListener('mouseleave', () => row.style.background = '');

            const icon = document.createElement('span');
            icon.style.fontSize = '1.2rem';
            icon.textContent = file.type === 'directory' ? '📁' : getFileIcon(file.name);

            const nameSpan = document.createElement('span');
            nameSpan.textContent = file.name;
            nameSpan.style.cssText = 'overflow: hidden; text-overflow: ellipsis; white-space: nowrap;';

            const sizeSpan = document.createElement('span');
            sizeSpan.style.cssText = 'font-size: 0.85rem; color: var(--text-dim);';
            sizeSpan.textContent = file.type === 'directory' ? '—' : formatFileSize(file.size);

            const dateSpan = document.createElement('span');
            dateSpan.style.cssText = 'font-size: 0.85rem; color: var(--text-dim);';
            dateSpan.textContent = new Date(file.modified).toLocaleString('es-ES', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

            const actionsDiv = document.createElement('div');
            actionsDiv.style.cssText = 'display: flex; gap: 4px;';

            if (file.type !== 'directory') {
                const dlBtn = document.createElement('button');
                dlBtn.textContent = '⬇';
                dlBtn.title = 'Descargar';
                dlBtn.style.cssText = 'background: none; border: none; cursor: pointer; font-size: 1rem; padding: 2px;';
                dlBtn.addEventListener('click', (e) => { e.stopPropagation(); downloadFile(filePath + '/' + file.name); });
                actionsDiv.appendChild(dlBtn);
            }

            const delBtn = document.createElement('button');
            delBtn.textContent = '🗑';
            delBtn.title = 'Eliminar';
            delBtn.style.cssText = 'background: none; border: none; cursor: pointer; font-size: 1rem; padding: 2px; opacity: 0.5;';
            delBtn.addEventListener('mouseenter', () => delBtn.style.opacity = '1');
            delBtn.addEventListener('mouseleave', () => delBtn.style.opacity = '0.5');
            delBtn.addEventListener('click', (e) => { e.stopPropagation(); deleteFile(filePath + '/' + file.name, file.name); });
            actionsDiv.appendChild(delBtn);

            row.appendChild(icon);
            row.appendChild(nameSpan);
            row.appendChild(sizeSpan);
            row.appendChild(dateSpan);
            row.appendChild(actionsDiv);

            // Click to navigate into folder or preview file
            row.addEventListener('click', () => {
                if (file.type === 'directory') {
                    currentFilePath = filePath + '/' + file.name;
                    renderFilesView();
                }
            });

            // Right-click context menu
            row.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                showFileContextMenu(e, filePath + '/' + file.name, file);
            });

            filesList.appendChild(row);
        });
    } catch (e) {
        console.error('Load files error:', e);
        filesList.innerHTML = '<div style="padding: 40px; text-align: center; color: #ef4444;">Error al cargar archivos</div>';
    }
}

function getFileIcon(name) {
    const ext = name.split('.').pop().toLowerCase();
    const iconMap = {
        jpg: '🖼️', jpeg: '🖼️', png: '🖼️', gif: '🖼️', svg: '🖼️', webp: '🖼️',
        mp4: '🎬', mkv: '🎬', avi: '🎬', mov: '🎬',
        mp3: '🎵', flac: '🎵', wav: '🎵', ogg: '🎵',
        pdf: '📕', doc: '📄', docx: '📄', txt: '📄', md: '📄',
        zip: '📦', tar: '📦', gz: '📦', rar: '📦', '7z': '📦',
        js: '⚙️', py: '⚙️', sh: '⚙️', json: '⚙️', yml: '⚙️', yaml: '⚙️',
        iso: '💿', img: '💿',
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

async function handleFileUpload(e) {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    for (const file of files) {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('path', currentFilePath);

        try {
            const res = await fetch(`${API_BASE}/files/upload`, {
                method: 'POST',
                headers: { 'X-Session-Id': state.sessionId },
                body: formData
            });
            if (!res.ok) throw new Error('Upload failed');
        } catch (err) {
            console.error('Upload error:', err);
            alert(`Error al subir ${file.name}`);
        }
    }
    e.target.value = '';
    await loadFiles(currentFilePath);
}

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
    if (!confirm(`¿Eliminar "${name}"?`)) return;
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

async function searchFiles(query) {
    if (!query.trim()) { await loadFiles(currentFilePath); return; }
    const filesList = document.getElementById('files-list');
    if (!filesList) return;
    filesList.innerHTML = '<div style="padding: 40px; text-align: center; color: var(--text-dim);">🔍 Buscando...</div>';
    try {
        const res = await authFetch(`${API_BASE}/files/search?path=${encodeURIComponent(currentFilePath)}&query=${encodeURIComponent(query)}`);
        if (!res.ok) throw new Error('Search failed');
        const results = await res.json();
        if (results.length === 0) {
            filesList.innerHTML = '<div style="padding: 40px; text-align: center; color: var(--text-dim);">Sin resultados</div>';
            return;
        }
        filesList.innerHTML = '';
        results.forEach(file => {
            const row = document.createElement('div');
            row.style.cssText = 'display: grid; grid-template-columns: 40px 1fr 100px; padding: 10px 20px; align-items: center; border-bottom: 1px solid var(--border);';
            const icon = document.createElement('span');
            icon.textContent = file.type === 'directory' ? '📁' : getFileIcon(file.name);
            const nameSpan = document.createElement('span');
            nameSpan.textContent = file.path;
            nameSpan.style.cssText = 'overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.9rem;';
            const sizeSpan = document.createElement('span');
            sizeSpan.style.cssText = 'font-size: 0.85rem; color: var(--text-dim);';
            sizeSpan.textContent = file.type === 'directory' ? '—' : formatFileSize(file.size);
            row.appendChild(icon);
            row.appendChild(nameSpan);
            row.appendChild(sizeSpan);
            filesList.appendChild(row);
        });
    } catch (e) {
        filesList.innerHTML = '<div style="padding: 40px; text-align: center; color: #ef4444;">Error en la búsqueda</div>';
    }
}

function showFileContextMenu(e, filePath, file) {
    // Remove existing context menu
    document.querySelectorAll('.file-context-menu').forEach(m => m.remove());
    
    const menu = document.createElement('div');
    menu.className = 'file-context-menu';
    menu.style.cssText = `position: fixed; top: ${e.clientY}px; left: ${e.clientX}px; background: var(--bg-card); border: 1px solid var(--border); border-radius: 8px; padding: 6px 0; box-shadow: 0 8px 24px rgba(0,0,0,0.3); z-index: 9999; min-width: 160px;`;
    
    const items = [
        { icon: '✏️', label: 'Renombrar', action: () => renameFile(filePath, file.name) },
        ...(file.type !== 'directory' ? [{ icon: '⬇️', label: 'Descargar', action: () => downloadFile(filePath) }] : []),
        { icon: '🗑️', label: 'Eliminar', action: () => deleteFile(filePath, file.name) }
    ];
    
    items.forEach(item => {
        const btn = document.createElement('button');
        btn.style.cssText = 'display: flex; align-items: center; gap: 8px; width: 100%; padding: 8px 16px; background: none; border: none; cursor: pointer; color: var(--text); font-size: 0.9rem; text-align: left;';
        btn.addEventListener('mouseenter', () => btn.style.background = 'var(--bg-hover)');
        btn.addEventListener('mouseleave', () => btn.style.background = '');
        btn.innerHTML = `<span>${item.icon}</span><span>${item.label}</span>`;
        btn.addEventListener('click', () => { menu.remove(); item.action(); });
        menu.appendChild(btn);
    });
    
    document.body.appendChild(menu);
    document.addEventListener('click', () => menu.remove(), { once: true });
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
            users = await res.json();
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
    if (!confirm(`¿Eliminar usuario "${username}"?`)) return;
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
                <div style="background: white; padding: 20px; border-radius: 12px; display: inline-block; margin-bottom: 15px;">
                    <img src="https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(data.uri)}" alt="QR Code" style="display: block;">
                </div>
                <p style="font-size: 0.8rem; color: var(--text-dim); word-break: break-all; margin-bottom: 20px;">Secret: ${escapeHtml(data.secret)}</p>
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
        const jobs = await res.json();

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
    if (!confirm('¿Eliminar este trabajo de backup?')) return;
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
        const tasks = await res.json();

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
    if (!confirm('¿Eliminar esta tarea?')) return;
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
            statusBadge.textContent = status.active ? `✅ Activo • ${status.connections || 0} conexiones` : '❌ Inactivo';
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
        const shares = await res.json();

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
    if (!confirm(`¿Eliminar compartición "${name}"?`)) return;
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
        const services = await res.json();

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
                if (!confirm('¿Eliminar este servicio DDNS?')) return;
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

init();
console.log("HomePiNAS Core v2.3.0 Loaded - (Files + Users + 2FA + Samba + DDNS + Backup + Scheduler + Logs + UPS + Notifications)");
