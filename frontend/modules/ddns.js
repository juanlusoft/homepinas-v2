/**
 * DDNS Module
 * Dynamic DNS configuration and management
 */
(function(window) {
    'use strict';
    
    const state = window.AppState;
    const API_BASE = window.API_BASE;
    const escapeHtml = window.AppUtils.escapeHtml;

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
                        <h4 style="margin: 0;">${escapeHtml(svc.domain || svc.hostname || t('common.unknown', 'Desconocido'))}</h4>
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


    // Expose to window
    window.AppDDNS = {
        render: renderDDNSSection
    };
    
})(window);
