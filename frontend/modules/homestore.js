/**
 * HomeStore Module
 * Application marketplace for HomePiNAS
 * 
 * NOTE: This file exceeds 300 lines due to complex app
 * marketplace UI and installation workflows.
 */
(function(window) {
    'use strict';
    
    const state = window.AppState;
    const API_BASE = window.API_BASE;
    const escapeHtml = window.AppUtils.escapeHtml;

// =============================================================================

let homestoreCatalog = null;
let homestoreFilter = 'all';
let systemArch = null;

async function renderHomeStoreView() {
    dashboardContent.innerHTML = `
        <div class="section">
            <div style="display: flex; justify-content: flex-end; align-items: center; margin-bottom: 10px;">
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
                    <button data-action="go-docker" class="btn" style="margin-top: 20px; background: var(--primary); color: #000; padding: 10px 20px; border: none; border-radius: 8px; cursor: pointer;">
                        Ir a Gestor de Docker
                    </button>
                </div>
            `;
            appsDiv.querySelector('[data-action="go-docker"]')?.addEventListener('click', () => navigateTo('/docker'));
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
                <button data-action="retry-catalog" class="btn" style="margin-top: 20px;">Reintentar</button>
            </div>
        `;
        appsDiv.querySelector('[data-action="retry-catalog"]')?.addEventListener('click', () => loadHomeStoreCatalog());
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
        <div id="homestore-app-${app.id}" class="card" style="background: rgba(30, 30, 50, 0.95); border: 2px solid ${isCompatible ? 'rgba(100, 100, 140, 0.5)' : '#f59e0b'}; border-radius: 12px; padding: 20px; box-shadow: 0 2px 8px rgba(0,0,0,0.3); color: #fff; ${!isCompatible ? 'opacity: 0.7;' : ''}">
            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px;">
                <div style="display: flex; align-items: center; gap: 12px;">
                    ${app.icon && app.icon.startsWith('http') ? `<img src="${app.icon}" style="width: 48px; height: 48px; border-radius: 8px;" onerror="this.outerHTML='📦'">` : `<span style="font-size: 2rem;">${app.icon || '📦'}</span>`}
                    <div>
                        <h3 style="margin: 0; font-size: 1.1rem; color: #fff;">${app.name}</h3>
                        <span style="color: rgba(255,255,255,0.7); font-size: 0.85rem;">${cat.icon} ${cat.name}</span>
                    </div>
                </div>
                ${statusBadge}
            </div>
            ${compatWarning}
            <p style="color: rgba(255,255,255,0.8); font-size: 0.9rem; margin-bottom: 12px; line-height: 1.4;">
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
                    ${app.icon && app.icon.startsWith('http') ? `<img src="${app.icon}" style="width: 48px; height: 48px; border-radius: 8px;" onerror="this.outerHTML='📦'">` : `<span style="font-size: 2rem;">${app.icon || '📦'}</span>`}
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
            
            // Add hover CSS for folder items
            if (!document.getElementById('folder-item-hover-style')) {
                const style = document.createElement('style');
                style.id = 'folder-item-hover-style';
                style.textContent = '.folder-item-hover:hover { background: rgba(255,255,255,0.1) !important; }';
                document.head.appendChild(style);
            }

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
                        html += `<div class="folder-item folder-item-hover" data-path="${escapeHtml(path.split('/').slice(0, -1).join('/') || '/')}"
                                     style="padding: 10px 12px; cursor: pointer; display: flex; align-items: center; gap: 8px; border-radius: 6px; margin-bottom: 4px;">
                                    📁 <span style="color: var(--text-secondary);">..</span>
                                 </div>`;
                    }
                    
                    folders.forEach(f => {
                        const fullPath = path === '/' ? `/${f.name}` : `${path}/${f.name}`;
                        html += `<div class="folder-item folder-item-hover" data-path="${escapeHtml(fullPath)}"
                                     style="padding: 10px 12px; cursor: pointer; display: flex; align-items: center; gap: 8px; border-radius: 6px; margin-bottom: 4px;">
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
    if (!confirm(`¿Desinstalar ${appId}?`)) return;

    const removeData = confirm('¿Eliminar también los datos de la aplicación?');
    
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


    // Expose to window
    window.AppHomeStore = {
        render: renderHomeStoreView
    };
    
})(window);
