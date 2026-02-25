/**
 * Docker Logs Module
 * Docker container logs viewer
 */
(function(window) {
    'use strict';
    
    const state = window.AppState;
    const API_BASE = window.API_BASE;

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
            logsEl.innerHTML = `<span style="color: var(--text-dim);">${t('logs.noLogs', 'No hay logs disponibles')}</span>`;
        }
    } catch (e) {
        document.getElementById('logs-content').innerHTML = `<span style="color: #ef4444;">Error: ${escapeHtml(e.message)}</span>`;
    }
}

window.openContainerLogs = openContainerLogs;


    // Expose to window
    window.AppDockerLogs = {
        show: showDockerLogs,
        close: closeDockerLogs
    };
    
})(window);
