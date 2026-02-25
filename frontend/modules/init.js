/**
 * Initialization Module
 * Application initialization and setup
 * 
 * NOTE: This file exceeds 300 lines due to complex initialization
 * workflow with multiple async operations and view rendering.
 */
(function(window) {
    'use strict';
    
    const state = window.AppState;
    const API_BASE = window.API_BASE;
    const escapeHtml = window.AppUtils.escapeHtml;
    const t = window.t;
    const showNotification = window.AppNotifications.show;

// =============================================================================

// Initialize i18n first, then start the app
async function init() {
    if (typeof initI18n === 'function') {
        await initI18n();
    }
    if (window.AppRouter && window.AppRouter.initAuth) {
        await window.AppRouter.initAuth();
    }
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

    // Auto-refresh pending agents and device status every 15 seconds
    if (window._abRefreshInterval) clearInterval(window._abRefreshInterval);
    window._abRefreshInterval = setInterval(async () => {
        // Only refresh if Active Backup view is still visible
        if (!document.getElementById('ab-pending-agents')) {
            clearInterval(window._abRefreshInterval);
            return;
        }
        await loadABPendingAgents();
        await loadABDevices();
    }, 15000);
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
                    <button class="btn-primary btn-sm" data-action="close-modal" style="margin-top: 5px;">Entendido, cerrar</button>
                `;
                info.querySelector('[data-action="close-modal"]')?.addEventListener('click', function() { this.closest('.modal').remove(); });
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
                    <button class="btn-primary btn-sm" data-action="copy-ssh-cmd">📋 Copiar comando</button>
                    <button class="btn-primary btn-sm" data-action="close-modal" style="margin-left: 8px; background: #6366f1;">Listo, cerrar</button>
                `;
                info.querySelector('[data-action="copy-ssh-cmd"]')?.addEventListener('click', function() {
                    navigator.clipboard.writeText(document.getElementById('ab-ssh-cmd').textContent);
                    this.textContent = '✅ Copiado';
                });
                info.querySelector('[data-action="close-modal"]')?.addEventListener('click', function() { this.closest('.modal').remove(); });
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
                    <button class="btn-close" data-action="close-modal">&times;</button>
                </header>
                <div style="margin-top: 15px;">
                    ${instr.steps.map(step => `
                        <div style="margin-bottom: 18px;">
                            <p style="font-weight: 600; font-size: 0.9rem; margin-bottom: 6px;">${escapeHtml(step.title)}</p>
                            <p style="font-size: 0.82rem; color: var(--text-dim); margin-bottom: 8px;">${escapeHtml(step.description)}</p>
                            <div class="ab-copy-cmd" style="background: #0a0a0a; color: #10b981; padding: 12px; border-radius: 6px; font-family: monospace; font-size: 0.75rem; word-break: break-all; white-space: pre-wrap; cursor: pointer; position: relative;" title="Click para copiar">${escapeHtml(step.command)}</div>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;

        document.body.appendChild(modal);
        modal.querySelector('[data-action="close-modal"]')?.addEventListener('click', () => modal.remove());
        modal.querySelectorAll('.ab-copy-cmd').forEach(el => {
            el.addEventListener('click', () => {
                navigator.clipboard.writeText(el.textContent.trim());
                el.style.border = '1px solid #10b981';
                setTimeout(() => { el.style.border = ''; }, 1000);
            });
        });
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
                <button class="btn-close" data-action="close-panel" style="font-size: 1.5rem;">&times;</button>
            </div>
            <div style="margin-bottom: 10px; font-size: 0.85rem; color: var(--text-dim);">
                Tamaño total: <strong>${formatABSize(data.totalSize || 0)}</strong>
            </div>
        `;
        panel.querySelector('[data-action="close-panel"]')?.addEventListener('click', () => { document.getElementById('ab-detail-panel').style.display = 'none'; });

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
                <button class="btn-primary btn-sm" data-action="close-panel" style="margin-top: 10px;">Cerrar</button>
            `;
            panel.querySelector('[data-action="close-panel"]')?.addEventListener('click', () => { document.getElementById('ab-detail-panel').style.display = 'none'; });
            return;
        }

        panel.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
                <h3>📂 ${escapeHtml(device.name)}</h3>
                <button class="btn-close" data-action="close-panel" style="font-size: 1.5rem;">&times;</button>
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

        panel.querySelector('[data-action="close-panel"]')?.addEventListener('click', () => { document.getElementById('ab-detail-panel').style.display = 'none'; });

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
            <button class="btn-primary btn-sm" data-action="download-scripts" style="margin-top: 10px;">📦 Descargar Scripts</button>`;
        container.querySelector('[data-action="download-scripts"]')?.addEventListener('click', () => { window.open(`${API_BASE}/active-backup/recovery/scripts`, '_blank'); });
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


    // Expose to window
    window.AppInit = {
        init: init
    };
    
})(window);
