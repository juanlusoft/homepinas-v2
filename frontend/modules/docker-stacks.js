/**
 * Docker Stacks Module
 * Docker Compose stack management
 * 
 * NOTE: This file exceeds 300 lines due to complex stack
 * deployment and service management workflows.
 */
(function(window) {
    'use strict';
    
    const state = window.AppState;
    const API_BASE = window.API_BASE;
    const escapeHtml = window.AppUtils.escapeHtml;

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
                    ">${stack.status === 'running' ? '● En Ejecución' : stack.status === 'partial' ? '◐ Parcial' : '○ Detenido'}</span>

                    <button data-action="toggle" data-stack="${stack.id}" data-cmd="${stack.status === 'running' ? 'down' : 'up'}"
                        class="btn-primary stack-btn" style="padding: 6px 12px; font-size: 12px; background: ${stack.status === 'running' ? '#ef4444' : '#10b981'};">
                        ${stack.status === 'running' ? '⏹ Detener' : '▶ Iniciar'}
                    </button>
                    <button data-action="edit" data-stack="${stack.id}" class="btn-primary stack-btn" style="padding: 6px 12px; font-size: 12px; background: #6366f1;">
                        ✏️ Editar
                    </button>
                    <button data-action="logs" data-stack="${stack.id}" class="btn-primary stack-btn" style="padding: 6px 12px; font-size: 12px; background: var(--bg-hover);">
                        📜 Logs
                    </button>
                    <button data-action="delete" data-stack="${stack.id}" class="btn-primary stack-btn" style="padding: 6px 12px; font-size: 12px; background: #ef4444;">
                        🗑️
                    </button>
                </div>
            </div>
        `).join('');
        
        // Bind event listeners for stack buttons
        listDiv.querySelectorAll('.stack-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const action = btn.dataset.action;
                const stackId = btn.dataset.stack;
                if (action === 'toggle') {
                    await stackAction(stackId, btn.dataset.cmd, e);
                } else if (action === 'edit') {
                    await openStackEditor(stackId);
                } else if (action === 'logs') {
                    await showStackLogs(stackId);
                } else if (action === 'delete') {
                    await deleteStack(stackId);
                }
            });
        });
        
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
                    border: 1px solid #4a4a6a;
                    background: #1a1a2e;
                    color: #e0e0e0;
                    font-size: 14px;
                ">
            </div>
            <div style="margin-bottom: 16px;">
                <label style="display: block; margin-bottom: 6px; color: var(--text-secondary);">Descripción (opcional)</label>
                <input type="text" id="stack-desc" placeholder="Descripción del stack" style="
                    width: 100%;
                    padding: 10px;
                    border-radius: 8px;
                    border: 1px solid #4a4a6a;
                    background: #1a1a2e;
                    color: #e0e0e0;
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
                    border: 1px solid #4a4a6a;
                    background: #1a1a2e;
                    color: #e0e0e0;
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
                <button data-action="use-template" data-template-id="${t.id}" class="btn-primary" style="padding: 8px 16px; background: #10b981; color: white;">
                    Usar
                </button>
            </div>
        `).join('');

        list.querySelectorAll('[data-action="use-template"]').forEach(btn => {
            btn.addEventListener('click', () => useTemplate(btn.dataset.templateId));
        });
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
                        border: 1px solid #4a4a6a;
                        background: #1a1a2e;
                        color: #e0e0e0;
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
                            <button data-action="select-provider" data-provider="${p.id}" data-color="${p.color}" class="cloud-provider-btn" style="
                                background: rgba(255,255,255,0.05);
                                border: 2px solid rgba(255,255,255,0.1);
                                border-radius: 12px;
                                padding: 20px 15px;
                                cursor: pointer;
                                text-align: center;
                                transition: all 0.2s;
                            ">
                                <div style="font-size: 2rem; margin-bottom: 8px;">${p.icon}</div>
                                <div style="color: #fff; font-size: 0.9rem;">${p.name}</div>
                            </button>
                        `).join('')}
                    </div>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);

        // Add hover effect for cloud provider buttons
        modal.querySelectorAll('.cloud-provider-btn').forEach(btn => {
            const color = btn.dataset.color;
            btn.addEventListener('mouseover', () => { btn.style.borderColor = color; });
            btn.addEventListener('mouseout', () => { btn.style.borderColor = 'rgba(255,255,255,0.1)'; });
        });

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

    try {
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
    } catch (err) {
        console.error('[Cloud Backup] Error in startCloudConfig:', err);
        showNotification('Error configurando nube: ' + err.message, 'error');
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
        
        // Clone and replace listDiv to remove old event listeners, preventing accumulation
        const newListDiv = listDiv.cloneNode(true);
        listDiv.parentNode.replaceChild(newListDiv, listDiv);

        // Add event delegation for file list
        newListDiv.addEventListener('click', (e) => {
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
            case 'browse-source': browseRemote(remoteName); break;
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
window.navigateTo = navigateTo;
window.renderADContent = renderADContent;
window.detectDisksForWizard = detectDisksForWizard;

init();
console.log("HomePiNAS Core v2.6.0 Loaded - Cloud Backup");

    // Expose to window
    window.AppDockerStacks = {
        render: renderDockerStacksView
    };
    
})(window);
