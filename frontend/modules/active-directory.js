/**
 * Active Directory Module
 * Samba AD DC configuration and management
 * 
 * NOTE: This file exceeds 300 lines due to complex AD domain
 * setup workflow and configuration options.
 */
(function(window) {
    'use strict';
    
    const state = window.AppState;
    const API_BASE = window.API_BASE;
    const escapeHtml = window.AppUtils.escapeHtml;

// =============================================================================

let adRefreshInterval = null;

async function renderActiveDirectoryView() {
    const dashboardContent = document.getElementById('dashboard-content');
    if (!dashboardContent) return;
    
    // Clear any existing refresh interval
    if (adRefreshInterval) {
        clearInterval(adRefreshInterval);
        adRefreshInterval = null;
    }
    
    dashboardContent.innerHTML = `
        <div class="section-header">
            <h2>🏢 Active Directory Domain Controller</h2>
            <p class="section-subtitle">Gestiona tu dominio AD desde HomePiNAS</p>
        </div>
        <div id="ad-content">
            <div class="loading-spinner">Cargando...</div>
        </div>
    `;
    
    await renderADContent();
}

async function renderADContent() {
    const container = document.getElementById('ad-content');
    if (!container) return;
    
    try {
        const res = await authFetch(`${API_BASE}/ad/status`);
        const status = await res.json();
        
        if (!status.installed) {
            // Not installed - show install button
            container.innerHTML = `
                <div class="card" style="text-align: center; padding: 40px;">
                    <h3 style="color: var(--warning);">⚠️ Samba AD DC no instalado</h3>
                    <p style="margin: 20px 0; color: var(--text-secondary);">
                        Active Directory Domain Controller permite que equipos Windows se unan a tu NAS como controlador de dominio.
                    </p>
                    <button class="btn btn-primary" id="ad-install-btn">
                        📦 Instalar Samba AD DC
                    </button>
                    <p style="margin-top: 15px; font-size: 0.85rem; color: var(--text-muted);">
                        Esto instalará ~500MB de paquetes y tardará unos minutos.
                    </p>
                </div>
            `;
            
            document.getElementById('ad-install-btn')?.addEventListener('click', async () => {
                const btn = document.getElementById('ad-install-btn');
                btn.disabled = true;
                btn.innerHTML = '⏳ Instalando...';
                
                try {
                    const res = await authFetch(`${API_BASE}/ad/install`, { method: 'POST' });
                    const data = await res.json();
                    
                    if (data.success) {
                        showNotification('Samba AD DC instalado correctamente', 'success');
                        await renderADContent();
                    } else {
                        showNotification(data.error || 'Error instalando', 'error');
                        btn.disabled = false;
                        btn.innerHTML = '📦 Instalar Samba AD DC';
                    }
                } catch (err) {
                    showNotification('Error: ' + err.message, 'error');
                    btn.disabled = false;
                    btn.innerHTML = '📦 Instalar Samba AD DC';
                }
            });
            return;
        }
        
        if (!status.provisioned) {
            // Installed but not provisioned - show provision form
            container.innerHTML = `
                <style>
                    .ad-setup-container {
                        display: grid;
                        grid-template-columns: 1fr 1fr;
                        gap: 24px;
                        max-width: 1200px;
                    }
                    @media (max-width: 900px) {
                        .ad-setup-container { grid-template-columns: 1fr; }
                    }
                    .ad-form-card {
                        background: var(--card-bg, #fff);
                        border-radius: 12px;
                        padding: 28px;
                        box-shadow: 0 2px 12px rgba(0,0,0,0.08);
                        border: 1px solid var(--border-color, #e0e0e0);
                    }
                    .ad-form-header {
                        display: flex;
                        align-items: center;
                        gap: 12px;
                        margin-bottom: 8px;
                    }
                    .ad-form-header-icon {
                        width: 48px;
                        height: 48px;
                        background: linear-gradient(135deg, #3b82f6, #1d4ed8);
                        border-radius: 12px;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        font-size: 24px;
                    }
                    .ad-form-header h3 {
                        margin: 0;
                        font-size: 1.25rem;
                        font-weight: 600;
                    }
                    .ad-form-header p {
                        margin: 4px 0 0 0;
                        color: var(--text-secondary, #666);
                        font-size: 0.875rem;
                    }
                    .ad-form-field {
                        margin-bottom: 20px;
                    }
                    .ad-form-field label {
                        display: block;
                        font-weight: 500;
                        margin-bottom: 6px;
                        color: var(--text-primary, #333);
                        font-size: 0.9rem;
                    }
                    .ad-form-field input {
                        width: 100%;
                        padding: 12px 14px;
                        border: 1px solid var(--border-color, #d1d5db);
                        border-radius: 8px;
                        font-size: 0.95rem;
                        transition: border-color 0.2s, box-shadow 0.2s;
                        background: var(--input-bg, #fff);
                        color: var(--text-primary, #333);
                        box-sizing: border-box;
                    }
                    .ad-form-field input:focus {
                        outline: none;
                        border-color: #3b82f6;
                        box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.15);
                    }
                    .ad-form-field input::placeholder {
                        color: var(--text-tertiary, #9ca3af);
                    }
                    .ad-form-field small {
                        display: block;
                        margin-top: 6px;
                        color: var(--text-secondary, #666);
                        font-size: 0.8rem;
                    }
                    .ad-form-row {
                        display: grid;
                        grid-template-columns: 1fr 1fr;
                        gap: 16px;
                    }
                    @media (max-width: 500px) {
                        .ad-form-row { grid-template-columns: 1fr; }
                    }
                    .ad-submit-btn {
                        width: 100%;
                        padding: 14px 24px;
                        background: linear-gradient(135deg, #3b82f6, #1d4ed8);
                        color: white;
                        border: none;
                        border-radius: 8px;
                        font-size: 1rem;
                        font-weight: 600;
                        cursor: pointer;
                        transition: transform 0.15s, box-shadow 0.15s;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        gap: 8px;
                    }
                    .ad-submit-btn:hover {
                        transform: translateY(-1px);
                        box-shadow: 0 4px 12px rgba(59, 130, 246, 0.35);
                    }
                    .ad-submit-btn:disabled {
                        opacity: 0.6;
                        cursor: not-allowed;
                        transform: none;
                    }
                    .ad-info-card {
                        background: var(--card-bg, #fff);
                        border-radius: 12px;
                        padding: 28px;
                        box-shadow: 0 2px 12px rgba(0,0,0,0.08);
                        border: 1px solid var(--border-color, #e0e0e0);
                    }
                    .ad-info-card h4 {
                        margin: 0 0 16px 0;
                        font-size: 1rem;
                        font-weight: 600;
                        display: flex;
                        align-items: center;
                        gap: 8px;
                    }
                    .ad-info-item {
                        display: flex;
                        gap: 12px;
                        padding: 14px 0;
                        border-bottom: 1px solid var(--border-color, #e5e7eb);
                    }
                    .ad-info-item:last-child {
                        border-bottom: none;
                    }
                    .ad-info-icon {
                        width: 36px;
                        height: 36px;
                        background: var(--bg-tertiary, #f3f4f6);
                        border-radius: 8px;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        font-size: 16px;
                        flex-shrink: 0;
                    }
                    .ad-info-content strong {
                        display: block;
                        font-weight: 500;
                        margin-bottom: 2px;
                        color: var(--text-primary, #333);
                    }
                    .ad-info-content span {
                        color: var(--text-secondary, #666);
                        font-size: 0.85rem;
                    }
                </style>
                
                <div class="ad-setup-container">
                    <div class="ad-form-card">
                        <div class="ad-form-header">
                            <div class="ad-form-header-icon">🏢</div>
                            <div>
                                <h3>Configurar Dominio</h3>
                                <p>Samba AD DC instalado — configura tu dominio</p>
                            </div>
                        </div>
                        
                        <form id="ad-provision-form" style="margin-top: 24px;">
                            <div class="ad-form-field">
                                <label>Nombre del dominio (NetBIOS)</label>
                                <input type="text" id="ad-domain" placeholder="HOMELABS" 
                                       pattern="[A-Za-z][A-Za-z0-9]{0,14}" required
                                       style="text-transform: uppercase;">
                                <small>Máx 15 caracteres, solo letras y números</small>
                            </div>
                            
                            <div class="ad-form-field">
                                <label>Realm (FQDN)</label>
                                <input type="text" id="ad-realm" placeholder="homelabs.local" required>
                                <small>Nombre completo del dominio para Kerberos</small>
                            </div>
                            
                            <div class="ad-form-row">
                                <div class="ad-form-field">
                                    <label>Contraseña Administrator</label>
                                    <input type="password" id="ad-password" minlength="8" required
                                           placeholder="••••••••">
                                    <small>Mínimo 8 caracteres</small>
                                </div>
                                
                                <div class="ad-form-field">
                                    <label>Confirmar contraseña</label>
                                    <input type="password" id="ad-password-confirm" minlength="8" required
                                           placeholder="••••••••">
                                </div>
                            </div>
                            
                            <button type="submit" class="ad-submit-btn">
                                <span>🚀</span> Crear Dominio
                            </button>
                        </form>
                    </div>
                    
                    <div class="ad-info-card">
                        <h4>📘 ¿Qué es Active Directory?</h4>
                        
                        <div class="ad-info-item">
                            <div class="ad-info-icon">🏷️</div>
                            <div class="ad-info-content">
                                <strong>Nombre NetBIOS</strong>
                                <span>Nombre corto del dominio (ej: HOMELABS, EMPRESA)</span>
                            </div>
                        </div>
                        
                        <div class="ad-info-item">
                            <div class="ad-info-icon">🌐</div>
                            <div class="ad-info-content">
                                <strong>Realm (FQDN)</strong>
                                <span>Nombre completo usado por Kerberos (ej: homelabs.local)</span>
                            </div>
                        </div>
                        
                        <div class="ad-info-item">
                            <div class="ad-info-icon">🖥️</div>
                            <div class="ad-info-content">
                                <strong>Unir equipos Windows</strong>
                                <span>Los PCs podrán unirse al dominio con login centralizado</span>
                            </div>
                        </div>
                        
                        <div class="ad-info-item">
                            <div class="ad-info-icon">🔐</div>
                            <div class="ad-info-content">
                                <strong>DNS integrado</strong>
                                <span>Samba incluye servidor DNS para el dominio</span>
                            </div>
                        </div>
                    </div>
                </div>
            `;
            
            document.getElementById('ad-provision-form')?.addEventListener('submit', async (e) => {
                e.preventDefault();
                
                const domain = document.getElementById('ad-domain').value.toUpperCase();
                const realm = document.getElementById('ad-realm').value.toLowerCase();
                const password = document.getElementById('ad-password').value;
                const passwordConfirm = document.getElementById('ad-password-confirm').value;
                
                if (password !== passwordConfirm) {
                    showNotification('Las contraseñas no coinciden', 'error');
                    return;
                }
                
                const btn = e.target.querySelector('button[type="submit"]');
                btn.disabled = true;
                btn.innerHTML = '⏳ Creando dominio...';
                
                try {
                    const res = await authFetch(`${API_BASE}/ad/provision`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ domain, realm, adminPassword: password })
                    });
                    const data = await res.json();
                    
                    if (data.success) {
                        showNotification(`Dominio ${data.domain} creado correctamente`, 'success');
                        await renderADContent();
                    } else {
                        showNotification(data.error || 'Error creando dominio', 'error');
                        btn.disabled = false;
                        btn.innerHTML = '🚀 Crear Dominio';
                    }
                } catch (err) {
                    showNotification('Error: ' + err.message, 'error');
                    btn.disabled = false;
                    btn.innerHTML = '🚀 Crear Dominio';
                }
            });
            return;
        }
        
        // Provisioned - show full dashboard
        const [usersRes, computersRes, groupsRes] = await Promise.all([
            authFetch(`${API_BASE}/ad/users`),
            authFetch(`${API_BASE}/ad/computers`),
            authFetch(`${API_BASE}/ad/groups`)
        ]);
        
        const usersData = await usersRes.json();
        const computersData = await computersRes.json();
        const groupsData = await groupsRes.json();
        
        // Ensure arrays even if API returns error object
        const users = Array.isArray(usersData) ? usersData : [];
        const computers = Array.isArray(computersData) ? computersData : [];
        const groups = Array.isArray(groupsData) ? groupsData : [];
        
        container.innerHTML = `
            <style>
                .ad-dashboard { max-width: 1400px; }
                .ad-header-card {
                    background: linear-gradient(135deg, #1e3a5f 0%, #2d5a87 100%);
                    border-radius: 16px;
                    padding: 24px 28px;
                    color: white;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    flex-wrap: wrap;
                    gap: 20px;
                    box-shadow: 0 4px 20px rgba(30, 58, 95, 0.3);
                }
                .ad-header-info { display: flex; align-items: center; gap: 16px; }
                .ad-header-icon {
                    width: 56px; height: 56px;
                    background: rgba(255,255,255,0.15);
                    border-radius: 14px;
                    display: flex; align-items: center; justify-content: center;
                    font-size: 28px;
                }
                .ad-header-text h2 { margin: 0; font-size: 1.5rem; font-weight: 600; }
                .ad-header-text p { margin: 4px 0 0; opacity: 0.85; font-size: 0.95rem; }
                .ad-header-status {
                    display: flex; align-items: center; gap: 8px;
                    background: rgba(255,255,255,0.1); padding: 6px 14px;
                    border-radius: 20px; font-size: 0.85rem;
                }
                .ad-header-status .dot {
                    width: 10px; height: 10px; border-radius: 50%;
                    background: ${status.running ? '#4ade80' : '#f87171'};
                    box-shadow: 0 0 8px ${status.running ? '#4ade80' : '#f87171'};
                }
                .ad-header-actions { display: flex; gap: 10px; }
                .ad-header-actions button {
                    padding: 10px 18px; border-radius: 8px; border: none;
                    font-weight: 500; cursor: pointer; transition: all 0.2s;
                    display: flex; align-items: center; gap: 6px;
                }
                .ad-btn-stop { background: rgba(248,113,113,0.9); color: white; }
                .ad-btn-stop:hover { background: #f87171; }
                .ad-btn-start { background: rgba(74,222,128,0.9); color: #166534; }
                .ad-btn-start:hover { background: #4ade80; }
                .ad-btn-restart { background: rgba(255,255,255,0.15); color: white; }
                .ad-btn-restart:hover { background: rgba(255,255,255,0.25); }
                .ad-btn-restart:disabled { opacity: 0.4; cursor: not-allowed; }
                
                .ad-stats-grid {
                    display: grid;
                    grid-template-columns: repeat(3, 1fr);
                    gap: 16px;
                    margin-top: 20px;
                }
                @media (max-width: 700px) { .ad-stats-grid { grid-template-columns: 1fr; } }
                .ad-stat-card {
                    background: var(--card-bg, #fff);
                    border-radius: 12px;
                    padding: 20px 24px;
                    display: flex;
                    align-items: center;
                    gap: 16px;
                    box-shadow: 0 2px 8px rgba(0,0,0,0.06);
                    border: 1px solid var(--border-color, #e5e7eb);
                }
                .ad-stat-icon {
                    width: 48px; height: 48px;
                    border-radius: 12px;
                    display: flex; align-items: center; justify-content: center;
                    font-size: 22px;
                }
                .ad-stat-icon.users { background: #dbeafe; }
                .ad-stat-icon.computers { background: #fce7f3; }
                .ad-stat-icon.groups { background: #d1fae5; }
                .ad-stat-value { font-size: 1.75rem; font-weight: 700; color: var(--text-primary, #1f2937); }
                .ad-stat-label { font-size: 0.85rem; color: var(--text-secondary, #6b7280); margin-top: 2px; }
                
                .ad-tabs {
                    display: flex;
                    gap: 4px;
                    margin-top: 24px;
                    background: var(--bg-secondary, #f3f4f6);
                    padding: 4px;
                    border-radius: 12px;
                    width: fit-content;
                }
                .ad-tab {
                    padding: 10px 20px;
                    border: none;
                    background: transparent;
                    border-radius: 8px;
                    cursor: pointer;
                    font-weight: 500;
                    color: var(--text-secondary, #6b7280);
                    transition: all 0.2s;
                    display: flex;
                    align-items: center;
                    gap: 6px;
                }
                .ad-tab:hover { color: var(--text-primary, #1f2937); }
                .ad-tab.active {
                    background: var(--card-bg, #fff);
                    color: #3b82f6;
                    box-shadow: 0 1px 3px rgba(0,0,0,0.1);
                }
                
                .ad-content-card {
                    background: var(--card-bg, #fff);
                    border-radius: 12px;
                    padding: 24px;
                    margin-top: 16px;
                    box-shadow: 0 2px 8px rgba(0,0,0,0.06);
                    border: 1px solid var(--border-color, #e5e7eb);
                }
                .ad-content-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 20px;
                    flex-wrap: wrap;
                    gap: 12px;
                }
                .ad-content-header h3 { margin: 0; font-size: 1.1rem; font-weight: 600; }
                .ad-add-btn {
                    padding: 8px 16px;
                    background: linear-gradient(135deg, #3b82f6, #1d4ed8);
                    color: white;
                    border: none;
                    border-radius: 8px;
                    font-weight: 500;
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    transition: transform 0.15s, box-shadow 0.15s;
                }
                .ad-add-btn:hover {
                    transform: translateY(-1px);
                    box-shadow: 0 4px 12px rgba(59, 130, 246, 0.35);
                }
                
                .ad-table {
                    width: 100%;
                    border-collapse: collapse;
                }
                .ad-table th {
                    text-align: left;
                    padding: 12px 16px;
                    font-weight: 600;
                    font-size: 0.8rem;
                    text-transform: uppercase;
                    letter-spacing: 0.5px;
                    color: var(--text-secondary, #6b7280);
                    border-bottom: 2px solid var(--border-color, #e5e7eb);
                }
                .ad-table td {
                    padding: 14px 16px;
                    border-bottom: 1px solid var(--border-color, #f3f4f6);
                    color: var(--text-primary, #1f2937);
                }
                .ad-table tr:hover { background: var(--bg-secondary, #f9fafb); }
                .ad-table-empty {
                    text-align: center;
                    padding: 40px;
                    color: var(--text-secondary, #9ca3af);
                }
                .ad-table-empty-icon { font-size: 48px; margin-bottom: 12px; opacity: 0.5; }
            </style>
            
            <div class="ad-dashboard">
                <!-- Header -->
                <div class="ad-header-card">
                    <div class="ad-header-info">
                        <div class="ad-header-icon">🏢</div>
                        <div class="ad-header-text">
                            <h2>${escapeHtml(status.domain || 'HOMELABS')}</h2>
                            <p>${escapeHtml(status.realm || 'homelabs.local')}</p>
                        </div>
                        <div class="ad-header-status">
                            <span class="dot"></span>
                            ${status.running ? 'Activo' : 'Detenido'}
                        </div>
                    </div>
                    <div class="ad-header-actions">
                        <button class="${status.running ? 'ad-btn-stop' : 'ad-btn-start'}" id="ad-toggle-btn">
                            ${status.running ? '⏹️ Detener' : '▶️ Iniciar'}
                        </button>
                        <button class="ad-btn-restart" id="ad-restart-btn" ${!status.running ? 'disabled' : ''}>
                            🔄 Reiniciar
                        </button>
                    </div>
                </div>
                
                <!-- Stats -->
                <div class="ad-stats-grid">
                    <div class="ad-stat-card">
                        <div class="ad-stat-icon users">👤</div>
                        <div>
                            <div class="ad-stat-value">${users.length}</div>
                            <div class="ad-stat-label">Usuarios</div>
                        </div>
                    </div>
                    <div class="ad-stat-card">
                        <div class="ad-stat-icon computers">💻</div>
                        <div>
                            <div class="ad-stat-value">${computers.length}</div>
                            <div class="ad-stat-label">Equipos unidos</div>
                        </div>
                    </div>
                    <div class="ad-stat-card">
                        <div class="ad-stat-icon groups">👥</div>
                        <div>
                            <div class="ad-stat-value">${groups.length}</div>
                            <div class="ad-stat-label">Grupos</div>
                        </div>
                    </div>
                </div>
                
                <!-- Tabs -->
                <div class="ad-tabs">
                    <button class="ad-tab active" data-tab="ad-users">👤 Usuarios</button>
                    <button class="ad-tab" data-tab="ad-computers">💻 Equipos</button>
                    <button class="ad-tab" data-tab="ad-groups">👥 Grupos</button>
                    <button class="ad-tab" data-tab="ad-join">📋 Unir Equipo</button>
                </div>
                
                <!-- Tab Content -->
                <div id="ad-tab-content" class="ad-content-card">
                    <!-- Content rendered here -->
                </div>
            </div>
        `;
        
        // Tab switching
        container.querySelectorAll('.ad-tab').forEach(btn => {
            btn.addEventListener('click', () => {
                container.querySelectorAll('.ad-tab').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                renderADTab(btn.dataset.tab, { users, computers, groups, status });
            });
        });
        
        // Service controls
        document.getElementById('ad-toggle-btn')?.addEventListener('click', async () => {
            const action = status.running ? 'stop' : 'start';
            try {
                await authFetch(`${API_BASE}/ad/service/${action}`, { method: 'POST' });
                showNotification(`Servicio ${action === 'start' ? 'iniciado' : 'detenido'}`, 'success');
                await renderADContent();
            } catch (err) {
                showNotification('Error: ' + err.message, 'error');
            }
        });
        
        document.getElementById('ad-restart-btn')?.addEventListener('click', async () => {
            try {
                await authFetch(`${API_BASE}/ad/service/restart`, { method: 'POST' });
                showNotification('Servicio reiniciado', 'success');
                await renderADContent();
            } catch (err) {
                showNotification('Error: ' + err.message, 'error');
            }
        });
        
        // Render initial tab
        renderADTab('ad-users', { users, computers, groups, status });
        
    } catch (error) {
        container.innerHTML = `
            <div class="card" style="text-align: center; padding: 40px;">
                <h3 style="color: var(--danger);">❌ Error</h3>
                <p>${escapeHtml(error.message)}</p>
                <button class="btn btn-primary" data-action="retry-ad">🔄 Reintentar</button>
            </div>
        `;
        container.querySelector('[data-action="retry-ad"]')?.addEventListener('click', () => renderADContent());
    }
}

function renderADTab(tab, data) {
    const container = document.getElementById('ad-tab-content');
    if (!container) return;
    
    const { users, computers, groups, status } = data;
    
    switch (tab) {
        case 'ad-users':
            container.innerHTML = `
                <div class="ad-content-header">
                    <h3>👤 Usuarios del Dominio</h3>
                    <button class="ad-add-btn" id="ad-add-user-btn">➕ Nuevo Usuario</button>
                </div>
                ${users.length === 0 ? `
                    <div class="ad-table-empty">
                        <div class="ad-table-empty-icon">👤</div>
                        <p>No hay usuarios en el dominio</p>
                        <p style="font-size: 0.85rem;">Haz clic en "Nuevo Usuario" para crear el primero</p>
                    </div>
                ` : `
                    <table class="ad-table">
                        <thead>
                            <tr>
                                <th>Usuario</th>
                                <th>Nombre</th>
                                <th>Estado</th>
                                <th style="width: 120px;">Acciones</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${users.map(u => `
                                <tr>
                                    <td><strong>${escapeHtml(u.username)}</strong></td>
                                    <td>${escapeHtml(u.displayName || '-')}</td>
                                    <td>
                                        <span style="display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 12px; font-size: 0.8rem; font-weight: 500; ${u.enabled !== false ? 'background: #dcfce7; color: #166534;' : 'background: #fee2e2; color: #991b1b;'}">
                                            <span style="width: 6px; height: 6px; border-radius: 50%; background: currentColor;"></span>
                                            ${u.enabled !== false ? 'Activo' : 'Deshabilitado'}
                                        </span>
                                    </td>
                                    <td>
                                        <div style="display: flex; gap: 6px;">
                                            <button class="ad-reset-pwd" data-user="${escapeHtml(u.username)}" title="Cambiar contraseña" style="padding: 6px 10px; border: 1px solid var(--border-color, #e5e7eb); background: var(--card-bg, #fff); border-radius: 6px; cursor: pointer;">🔑</button>
                                            <button class="ad-delete-user" data-user="${escapeHtml(u.username)}" title="Eliminar usuario" style="padding: 6px 10px; border: 1px solid #fecaca; background: #fef2f2; border-radius: 6px; cursor: pointer; ${u.username.toLowerCase() === 'administrator' ? 'opacity: 0.4; cursor: not-allowed;' : ''}" ${u.username.toLowerCase() === 'administrator' ? 'disabled' : ''}>🗑️</button>
                                        </div>
                                    </td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                `}
            `;
            
            // Add user button
            document.getElementById('ad-add-user-btn')?.addEventListener('click', () => showADUserModal());
            
            // Reset password buttons
            container.querySelectorAll('.ad-reset-pwd').forEach(btn => {
                btn.addEventListener('click', () => showADPasswordModal(btn.dataset.user));
            });
            
            // Delete user buttons
            container.querySelectorAll('.ad-delete-user').forEach(btn => {
                btn.addEventListener('click', async () => {
                    const username = btn.dataset.user;
                    if (!confirm(`¿Eliminar usuario ${username}?`)) return;
                    
                    try {
                        await authFetch(`${API_BASE}/ad/users/${username}`, { method: 'DELETE' });
                        showNotification(`Usuario ${username} eliminado`, 'success');
                        await renderADContent();
                    } catch (err) {
                        showNotification('Error: ' + err.message, 'error');
                    }
                });
            });
            break;
            
        case 'ad-computers':
            container.innerHTML = `
                <div class="ad-content-header">
                    <h3>💻 Equipos Unidos al Dominio</h3>
                </div>
                ${computers.length === 0 ? `
                    <div class="ad-table-empty">
                        <div class="ad-table-empty-icon">💻</div>
                        <p>No hay equipos unidos al dominio</p>
                        <p style="font-size: 0.85rem;">Ve a la pestaña "Unir Equipo" para ver las instrucciones</p>
                    </div>
                ` : `
                    <table class="ad-table">
                        <thead>
                            <tr>
                                <th>Nombre del Equipo</th>
                                <th>Sistema</th>
                                <th>Unido</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${computers.map(c => `
                                <tr>
                                    <td style="display: flex; align-items: center; gap: 10px;">
                                        <span style="width: 36px; height: 36px; background: #fce7f3; border-radius: 8px; display: flex; align-items: center; justify-content: center;">💻</span>
                                        <strong>${escapeHtml(c.name)}</strong>
                                    </td>
                                    <td>${escapeHtml(c.os || 'Windows')}</td>
                                    <td style="color: var(--text-secondary);">${escapeHtml(c.joined || '-')}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                `}
            `;
            break;
            
        case 'ad-groups':
            container.innerHTML = `
                <div class="ad-content-header">
                    <h3>👥 Grupos del Dominio</h3>
                    <button class="ad-add-btn" id="ad-add-group-btn">➕ Nuevo Grupo</button>
                </div>
                ${groups.length === 0 ? `
                    <div class="ad-table-empty">
                        <div class="ad-table-empty-icon">👥</div>
                        <p>No hay grupos en el dominio</p>
                    </div>
                ` : `
                    <table class="ad-table">
                        <thead>
                            <tr>
                                <th>Nombre del Grupo</th>
                                <th>Miembros</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${groups.map(g => `
                                <tr>
                                    <td style="display: flex; align-items: center; gap: 10px;">
                                        <span style="width: 36px; height: 36px; background: #d1fae5; border-radius: 8px; display: flex; align-items: center; justify-content: center;">👥</span>
                                        <strong>${escapeHtml(g.name)}</strong>
                                    </td>
                                    <td style="color: var(--text-secondary);">${g.members || 0} miembros</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                `}
            `;
            
            document.getElementById('ad-add-group-btn')?.addEventListener('click', () => showADGroupModal());
            break;
            
        case 'ad-join':
            container.innerHTML = `
                <div class="ad-content-header">
                    <h3>📋 Unir Equipo Windows al Dominio</h3>
                </div>
                
                <!-- Domain Info Card -->
                <div style="background: linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%); border-radius: 12px; padding: 20px; color: white; margin-bottom: 24px; display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px;">
                    <div style="text-align: center;">
                        <div style="font-size: 0.8rem; opacity: 0.85; margin-bottom: 4px;">DOMINIO</div>
                        <div style="font-size: 1.25rem; font-weight: 600;">${escapeHtml(status.domain)}</div>
                    </div>
                    <div style="text-align: center; border-left: 1px solid rgba(255,255,255,0.2); border-right: 1px solid rgba(255,255,255,0.2);">
                        <div style="font-size: 0.8rem; opacity: 0.85; margin-bottom: 4px;">REALM</div>
                        <div style="font-size: 1.25rem; font-weight: 600;">${escapeHtml(status.realm)}</div>
                    </div>
                    <div style="text-align: center;">
                        <div style="font-size: 0.8rem; opacity: 0.85; margin-bottom: 4px;">SERVIDOR DNS</div>
                        <div style="font-size: 1.25rem; font-weight: 600;">${window.location.hostname}</div>
                    </div>
                </div>
                
                <!-- Steps -->
                <div style="display: grid; gap: 16px;">
                    <div style="display: flex; gap: 16px; padding: 20px; background: var(--bg-secondary, #f9fafb); border-radius: 12px; border: 1px solid var(--border-color, #e5e7eb);">
                        <div style="width: 40px; height: 40px; background: #dbeafe; color: #1d4ed8; border-radius: 10px; display: flex; align-items: center; justify-content: center; font-weight: 700; flex-shrink: 0;">1</div>
                        <div style="flex: 1;">
                            <h4 style="margin: 0 0 12px 0; font-size: 1rem;">Configurar DNS del equipo (Windows 11)</h4>
                            
                            <div style="display: grid; gap: 12px;">
                                <div style="display: flex; align-items: flex-start; gap: 10px; padding: 12px; background: white; border-radius: 8px; border-left: 3px solid #3b82f6;">
                                    <span style="background: #dbeafe; color: #1d4ed8; padding: 2px 8px; border-radius: 4px; font-weight: 600; font-size: 0.8rem;">1.1</span>
                                    <div>
                                        <strong>Abrir Configuración de Red</strong><br>
                                        <span style="color: var(--text-secondary, #6b7280);">Clic derecho en el icono de WiFi/Red (abajo a la derecha) → <strong>"Configuración de red e Internet"</strong></span>
                                    </div>
                                </div>
                                
                                <div style="display: flex; align-items: flex-start; gap: 10px; padding: 12px; background: white; border-radius: 8px; border-left: 3px solid #3b82f6;">
                                    <span style="background: #dbeafe; color: #1d4ed8; padding: 2px 8px; border-radius: 4px; font-weight: 600; font-size: 0.8rem;">1.2</span>
                                    <div>
                                        <strong>Ir a "Configuración de red avanzada"</strong><br>
                                        <span style="color: var(--text-secondary, #6b7280);">Baja hasta el final y pulsa <strong>"Configuración de red avanzada"</strong></span>
                                    </div>
                                </div>
                                
                                <div style="display: flex; align-items: flex-start; gap: 10px; padding: 12px; background: white; border-radius: 8px; border-left: 3px solid #3b82f6;">
                                    <span style="background: #dbeafe; color: #1d4ed8; padding: 2px 8px; border-radius: 4px; font-weight: 600; font-size: 0.8rem;">1.3</span>
                                    <div>
                                        <strong>Seleccionar tu conexión (Ethernet o Wi-Fi)</strong><br>
                                        <span style="color: var(--text-secondary, #6b7280);">Haz clic en tu adaptador de red activo para expandirlo, luego pulsa <strong>"Ver propiedades adicionales"</strong></span>
                                    </div>
                                </div>
                                
                                <div style="display: flex; align-items: flex-start; gap: 10px; padding: 12px; background: white; border-radius: 8px; border-left: 3px solid #3b82f6;">
                                    <span style="background: #dbeafe; color: #1d4ed8; padding: 2px 8px; border-radius: 4px; font-weight: 600; font-size: 0.8rem;">1.4</span>
                                    <div>
                                        <strong>Editar la configuración DNS</strong><br>
                                        <span style="color: var(--text-secondary, #6b7280);">Junto a "Asignación de servidor DNS" pulsa <strong>"Editar"</strong></span>
                                    </div>
                                </div>
                                
                                <div style="display: flex; align-items: flex-start; gap: 10px; padding: 12px; background: white; border-radius: 8px; border-left: 3px solid #10b981;">
                                    <span style="background: #d1fae5; color: #166534; padding: 2px 8px; border-radius: 4px; font-weight: 600; font-size: 0.8rem;">1.5</span>
                                    <div>
                                        <strong>Cambiar a "Manual" y poner esta IP:</strong><br>
                                        <code style="background: #fef3c7; padding: 4px 12px; border-radius: 4px; font-weight: 700; font-size: 1.1rem; display: inline-block; margin-top: 4px;">${window.location.hostname}</code>
                                        <br><span style="color: var(--text-secondary, #6b7280); font-size: 0.85rem;">Activa IPv4, pon esta IP en "DNS preferido" y guarda</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                    
                    <div style="display: flex; gap: 16px; padding: 20px; background: var(--bg-secondary, #f9fafb); border-radius: 12px; border: 1px solid var(--border-color, #e5e7eb);">
                        <div style="width: 40px; height: 40px; background: #dbeafe; color: #1d4ed8; border-radius: 10px; display: flex; align-items: center; justify-content: center; font-weight: 700; flex-shrink: 0;">2</div>
                        <div style="flex: 1;">
                            <h4 style="margin: 0 0 12px 0; font-size: 1rem;">Unir el equipo al dominio (Windows 11)</h4>
                            
                            <div style="display: grid; gap: 12px;">
                                <div style="display: flex; align-items: flex-start; gap: 10px; padding: 12px; background: white; border-radius: 8px; border-left: 3px solid #3b82f6;">
                                    <span style="background: #dbeafe; color: #1d4ed8; padding: 2px 8px; border-radius: 4px; font-weight: 600; font-size: 0.8rem;">2.1</span>
                                    <div>
                                        <strong>Abrir Configuración</strong><br>
                                        <span style="color: var(--text-secondary, #6b7280);">Pulsa <code style="background: #f3f4f6; padding: 2px 6px; border-radius: 3px;">⊞ Win + I</code> o busca "Configuración" en el menú inicio</span>
                                    </div>
                                </div>
                                
                                <div style="display: flex; align-items: flex-start; gap: 10px; padding: 12px; background: white; border-radius: 8px; border-left: 3px solid #3b82f6;">
                                    <span style="background: #dbeafe; color: #1d4ed8; padding: 2px 8px; border-radius: 4px; font-weight: 600; font-size: 0.8rem;">2.2</span>
                                    <div>
                                        <strong>Ir a Sistema → Información</strong><br>
                                        <span style="color: var(--text-secondary, #6b7280);">En el menú lateral izquierdo selecciona <strong>Sistema</strong>, luego baja hasta <strong>Información</strong> (o "Acerca de")</span>
                                    </div>
                                </div>
                                
                                <div style="display: flex; align-items: flex-start; gap: 10px; padding: 12px; background: white; border-radius: 8px; border-left: 3px solid #3b82f6;">
                                    <span style="background: #dbeafe; color: #1d4ed8; padding: 2px 8px; border-radius: 4px; font-weight: 600; font-size: 0.8rem;">2.3</span>
                                    <div>
                                        <strong>Clic en "Dominio o grupo de trabajo"</strong><br>
                                        <span style="color: var(--text-secondary, #6b7280);">Busca el enlace <strong>"Dominio o grupo de trabajo"</strong> en la sección "Especificaciones del dispositivo"</span>
                                    </div>
                                </div>
                                
                                <div style="display: flex; align-items: flex-start; gap: 10px; padding: 12px; background: white; border-radius: 8px; border-left: 3px solid #3b82f6;">
                                    <span style="background: #dbeafe; color: #1d4ed8; padding: 2px 8px; border-radius: 4px; font-weight: 600; font-size: 0.8rem;">2.4</span>
                                    <div>
                                        <strong>Clic en "Cambiar..."</strong><br>
                                        <span style="color: var(--text-secondary, #6b7280);">Se abre la ventana de Propiedades del sistema. Pulsa el botón <strong>"Cambiar..."</strong></span>
                                    </div>
                                </div>
                                
                                <div style="display: flex; align-items: flex-start; gap: 10px; padding: 12px; background: white; border-radius: 8px; border-left: 3px solid #10b981;">
                                    <span style="background: #d1fae5; color: #166534; padding: 2px 8px; border-radius: 4px; font-weight: 600; font-size: 0.8rem;">2.5</span>
                                    <div>
                                        <strong>Seleccionar "Dominio" e introducir:</strong><br>
                                        <code style="background: #fef3c7; padding: 4px 12px; border-radius: 4px; font-weight: 700; font-size: 1.1rem; display: inline-block; margin-top: 4px;">${escapeHtml(status.realm)}</code>
                                    </div>
                                </div>
                                
                                <div style="display: flex; align-items: flex-start; gap: 10px; padding: 12px; background: white; border-radius: 8px; border-left: 3px solid #10b981;">
                                    <span style="background: #d1fae5; color: #166534; padding: 2px 8px; border-radius: 4px; font-weight: 600; font-size: 0.8rem;">2.6</span>
                                    <div>
                                        <strong>Introducir credenciales del dominio:</strong><br>
                                        <span style="color: var(--text-secondary, #6b7280);">Usuario:</span> <code style="background: #fef3c7; padding: 2px 8px; border-radius: 4px; font-weight: 600;">Administrator</code><br>
                                        <span style="color: var(--text-secondary, #6b7280);">Contraseña:</span> <span style="color: #dc2626;">la que pusiste al crear el dominio</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                    
                    <div style="display: flex; gap: 16px; padding: 20px; background: var(--bg-secondary, #f9fafb); border-radius: 12px; border: 1px solid var(--border-color, #e5e7eb);">
                        <div style="width: 40px; height: 40px; background: #d1fae5; color: #166534; border-radius: 10px; display: flex; align-items: center; justify-content: center; font-weight: 700; flex-shrink: 0;">3</div>
                        <div>
                            <h4 style="margin: 0 0 8px 0; font-size: 1rem;">Reiniciar y listo ✓</h4>
                            <p style="margin: 0; color: var(--text-secondary, #6b7280);">
                                Tras reiniciar, podrás hacer login con cualquier usuario del dominio.<br>
                                Formato: <code style="background: white; padding: 2px 8px; border-radius: 4px;">${escapeHtml(status.domain)}\\usuario</code> o <code style="background: white; padding: 2px 8px; border-radius: 4px;">usuario@${escapeHtml(status.realm)}</code>
                            </p>
                        </div>
                    </div>
                    
                    <!-- Important note about DNS -->
                    <div style="display: flex; gap: 16px; padding: 20px; margin-top: 16px; background: #fef3c7; border-radius: 12px; border: 1px solid #fcd34d;">
                        <div style="width: 40px; height: 40px; background: #fbbf24; color: white; border-radius: 10px; display: flex; align-items: center; justify-content: center; font-size: 20px; flex-shrink: 0;">💡</div>
                        <div>
                            <h4 style="margin: 0 0 8px 0; font-size: 1rem; color: #92400e;">¿Y si salgo de casa?</h4>
                            <p style="margin: 0; color: #a16207; line-height: 1.6;">
                                <strong>El DNS del NAS solo es necesario para unirse al dominio.</strong><br>
                                Una vez unido, puedes volver a poner el DNS en <strong>automático (DHCP)</strong> y tendrás internet normal dentro y fuera de casa.<br>
                                El equipo seguirá unido al dominio aunque cambies el DNS.
                            </p>
                        </div>
                    </div>
                </div>
            `;
            break;
    }
}

// Modal for adding AD user
function showADUserModal() {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
        <div class="modal" style="max-width: 400px;">
            <div class="modal-header">
                <h3>➕ Nuevo Usuario AD</h3>
                <button class="modal-close">&times;</button>
            </div>
            <form id="ad-user-form" class="modal-body">
                <div class="form-group">
                    <label>Nombre de usuario</label>
                    <input type="text" id="ad-new-username" required pattern="[a-zA-Z][a-zA-Z0-9._-]{0,19}">
                </div>
                <div class="form-group">
                    <label>Nombre completo (opcional)</label>
                    <input type="text" id="ad-new-displayname">
                </div>
                <div class="form-group">
                    <label>Contraseña</label>
                    <input type="password" id="ad-new-password" required minlength="8">
                </div>
                <div class="form-actions">
                    <button type="button" class="btn btn-secondary modal-cancel">Cancelar</button>
                    <button type="submit" class="btn btn-primary">Crear Usuario</button>
                </div>
            </form>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    modal.querySelector('.modal-close')?.addEventListener('click', () => modal.remove());
    modal.querySelector('.modal-cancel')?.addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
    
    modal.querySelector('#ad-user-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const username = document.getElementById('ad-new-username').value;
        const displayName = document.getElementById('ad-new-displayname').value;
        const password = document.getElementById('ad-new-password').value;
        
        try {
            const res = await authFetch(`${API_BASE}/ad/users`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, displayName, password })
            });
            const data = await res.json();
            
            if (data.success) {
                showNotification(`Usuario ${username} creado`, 'success');
                modal.remove();
                await renderADContent();
            } else {
                showNotification(data.error || 'Error creando usuario', 'error');
            }
        } catch (err) {
            showNotification('Error: ' + err.message, 'error');
        }
    });
}

// Modal for resetting password
function showADPasswordModal(username) {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
        <div class="modal" style="max-width: 400px;">
            <div class="modal-header">
                <h3>🔑 Cambiar Contraseña</h3>
                <button class="modal-close">&times;</button>
            </div>
            <form id="ad-pwd-form" class="modal-body">
                <p>Usuario: <strong>${escapeHtml(username)}</strong></p>
                <div class="form-group">
                    <label>Nueva contraseña</label>
                    <input type="password" id="ad-pwd-new" required minlength="8">
                </div>
                <div class="form-actions">
                    <button type="button" class="btn btn-secondary modal-cancel">Cancelar</button>
                    <button type="submit" class="btn btn-primary">Cambiar</button>
                </div>
            </form>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    modal.querySelector('.modal-close')?.addEventListener('click', () => modal.remove());
    modal.querySelector('.modal-cancel')?.addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
    
    modal.querySelector('#ad-pwd-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const newPassword = document.getElementById('ad-pwd-new').value;
        
        try {
            const res = await authFetch(`${API_BASE}/ad/users/${username}/password`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ newPassword })
            });
            const data = await res.json();
            
            if (data.success) {
                showNotification(`Contraseña de ${username} cambiada`, 'success');
                modal.remove();
            } else {
                showNotification(data.error || 'Error cambiando contraseña', 'error');
            }
        } catch (err) {
            showNotification('Error: ' + err.message, 'error');
        }
    });
}

// Modal for adding group
function showADGroupModal() {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
        <div class="modal" style="max-width: 400px;">
            <div class="modal-header">
                <h3>➕ Nuevo Grupo AD</h3>
                <button class="modal-close">&times;</button>
            </div>
            <form id="ad-group-form" class="modal-body">
                <div class="form-group">
                    <label>Nombre del grupo</label>
                    <input type="text" id="ad-new-group" required>
                </div>
                <div class="form-group">
                    <label>Descripción (opcional)</label>
                    <input type="text" id="ad-new-group-desc">
                </div>
                <div class="form-actions">
                    <button type="button" class="btn btn-secondary modal-cancel">Cancelar</button>
                    <button type="submit" class="btn btn-primary">Crear Grupo</button>
                </div>
            </form>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    modal.querySelector('.modal-close')?.addEventListener('click', () => modal.remove());
    modal.querySelector('.modal-cancel')?.addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
    
    modal.querySelector('#ad-group-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const name = document.getElementById('ad-new-group').value;
        const description = document.getElementById('ad-new-group-desc').value;
        
        try {
            const res = await authFetch(`${API_BASE}/ad/groups`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, description })
            });
            const data = await res.json();
            
            if (data.success) {
                showNotification(`Grupo ${name} creado`, 'success');
                modal.remove();
                await renderADContent();
            } else {
                showNotification(data.error || 'Error creando grupo', 'error');
            }
        } catch (err) {
            showNotification('Error: ' + err.message, 'error');
        }
    });
}


    // Expose to window
    window.AppActiveDirectory = {
        render: renderActiveDirectoryView
    };
    
})(window);
