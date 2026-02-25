/**
 * UPS Monitor Module
 * UPS status monitoring and configuration
 */
(function(window) {
    'use strict';
    
    const state = window.AppState;
    const API_BASE = window.API_BASE;

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
                <span><strong>Estado:</strong> ${escapeHtml(data.status || t('common.unknown', 'Desconocido'))}</span>
                <span><strong>Modelo:</strong> ${escapeHtml(data.model || t('common.unknown', 'Desconocido'))}</span>
                <span><strong>Driver:</strong> ${escapeHtml(data.driver || t('common.unknown', 'Desconocido'))}</span>
            </div>
        `;
    } catch (e) {
        content.innerHTML = '<p style="color: #ef4444;">Error al cargar estado del UPS</p>';
    }
}


    // Expose to window
    window.AppUPS = {
        render: renderUPSConfig
    };
    
})(window);
