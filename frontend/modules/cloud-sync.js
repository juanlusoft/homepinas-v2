/**
 * Cloud Sync Module
 * Syncthing integration for cloud synchronization
 * 
 * NOTE: This file exceeds 300 lines due to complex sync
 * configuration and folder management.
 */
(function(window) {
    'use strict';
    
    const state = window.AppState;
    const API_BASE = window.API_BASE;
    const escapeHtml = window.AppUtils.escapeHtml;

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
                <span style="color: var(--text-dim);">${escapeHtml(status.version ? (status.version.startsWith('v') ? status.version : 'v' + status.version) : t('common.unknown', 'Desconocido'))}</span>
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
                    <label style="color: var(--text-dim); font-size: 0.85rem;">ID del Dispositivo:</label>
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
    
    // Show device ID as copyable text (external QR APIs may be blocked by CSP)
    qrDiv.innerHTML = `
        <div style="background: var(--bg-card); border: 2px dashed var(--border); border-radius: 10px; padding: 15px; text-align: center;">
            <span style="font-size: 2rem;">📋</span>
            <p style="font-size: 0.75rem; color: var(--text-dim); margin-top: 5px;">Copia el ID del dispositivo</p>
        </div>`;
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
            renderContent('files');
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
            listDiv.innerHTML = '<p style="color: #9ca3af;">No hay dispositivos vinculados. Añade el ID del Dispositivo de tu PC o móvil.</p>';
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
                Copia el ID del Dispositivo de Syncthing desde tu PC o móvil (Ajustes → Mostrar ID).
            </p>
            <div style="margin-bottom: 15px;">
                <label style="color: #9ca3af; font-size: 0.9rem;">ID del Dispositivo:</label>
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
        showNotification('El ID del Dispositivo es obligatorio', 'error');
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


    // Expose to window
    window.AppCloudSync = {
        render: renderCloudSyncView
    };
    
})(window);
