/**
 * Samba Shares Module
 * Samba/SMB share management
 */
(function(window) {
    'use strict';
    
    const state = window.AppState;
    const API_BASE = window.API_BASE;
    const escapeHtml = window.AppUtils.escapeHtml;

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


    // Expose to window
    window.AppSamba = {
        render: renderSambaShares
    };
    
})(window);
