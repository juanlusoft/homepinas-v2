/**
 * Users & 2FA Module
 * User management and two-factor authentication
 */
(function(window) {
    'use strict';
    
    const state = window.AppState;
    const API_BASE = window.API_BASE;
    const escapeHtml = window.AppUtils.escapeHtml;

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
                    <button id="totp-copy-btn" style="margin-top: 10px; padding: 6px 16px; border-radius: 6px; border: 1px solid var(--border); background: var(--bg-hover); color: var(--text); cursor: pointer; font-size: 0.85rem;">Copiar clave</button>
                </div>
                <p style="font-size: 0.8rem; color: var(--text-dim); word-break: break-all; margin-bottom: 20px;">Account: ${escapeHtml(data.uri ? new URL(data.uri).pathname.replace(/^\/\/totp\//, '') : '')}</p>
                <div style="display: flex; gap: 10px; justify-content: center; align-items: center;">
                    <input type="text" id="totp-verify-code" placeholder="Código de 6 dígitos" maxlength="6" style="padding: 12px; border-radius: 8px; border: 1px solid var(--border); background: var(--bg-card); color: var(--text); width: 160px; text-align: center; font-size: 1.2rem; letter-spacing: 4px;">
                    <button class="btn-primary" id="verify-totp-btn">Verificar</button>
                </div>
            </div>
        `;

        document.getElementById('totp-copy-btn')?.addEventListener('click', function() {
            navigator.clipboard.writeText(document.getElementById('totp-secret-display').textContent)
                .then(() => { this.textContent = '\u2713 Copiado'; })
                .catch(() => {});
        });

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


    // Expose to window
    window.AppUsers = {
        render: renderUsersView
    };
    
})(window);
