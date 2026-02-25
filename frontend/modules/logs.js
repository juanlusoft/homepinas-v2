/**
 * Log Viewer Module
 * System logs viewer
 */
(function(window) {
    'use strict';
    
    const state = window.AppState;
    const API_BASE = window.API_BASE;

// =============================================================================

let currentLogTab = 'system';

async function renderLogsView() {
    const container = document.createElement('div');
    container.style.cssText = 'display: contents;';

    const card = document.createElement('div');
    card.className = 'glass-card';
    card.style.cssText = 'grid-column: 1 / -1;';

    // Tabs
    const tabs = document.createElement('div');
    tabs.style.cssText = 'display: flex; gap: 4px; margin-bottom: 15px; flex-wrap: wrap;';
    
    const logTabs = [
        { id: 'system', label: '🖥️ Sistema', icon: '' },
        { id: 'app', label: '📱 Aplicación', icon: '' },
        { id: 'auth', label: '🔐 Auth', icon: '' },
        { id: 'docker', label: '🐳 Docker', icon: '' },
        { id: 'samba', label: '📂 Samba', icon: '' }
    ];

    logTabs.forEach(tab => {
        const btn = document.createElement('button');
        btn.className = `btn-sm ${tab.id === currentLogTab ? 'btn-primary' : ''}`;
        btn.style.cssText = `padding: 8px 16px; border-radius: 8px; border: 1px solid var(--border); cursor: pointer; font-size: 0.85rem; ${
            tab.id === currentLogTab ? '' : 'background: var(--bg-card); color: var(--text);'
        }`;
        btn.textContent = tab.label;
        btn.addEventListener('click', () => {
            currentLogTab = tab.id;
            renderLogsView();
        });
        tabs.appendChild(btn);
    });

    card.appendChild(tabs);

    // Controls
    const controls = document.createElement('div');
    controls.style.cssText = 'display: flex; gap: 10px; margin-bottom: 15px; align-items: center; flex-wrap: wrap;';

    const linesSelect = document.createElement('select');
    linesSelect.id = 'log-lines';
    linesSelect.style.cssText = 'padding: 8px; border-radius: 8px; border: 1px solid var(--border); background: var(--bg-card); color: var(--text);';
    [50, 100, 200, 500, 1000].forEach(n => {
        const opt = document.createElement('option');
        opt.value = n; opt.textContent = `${n} líneas`;
        if (n === 100) opt.selected = true;
        linesSelect.appendChild(opt);
    });

    const filterInput = document.createElement('input');
    filterInput.type = 'text';
    filterInput.id = 'log-filter';
    filterInput.placeholder = 'Filtrar...';
    filterInput.style.cssText = 'padding: 8px 12px; border-radius: 8px; border: 1px solid var(--border); background: var(--bg-card); color: var(--text); flex: 1; min-width: 150px;';

    const refreshBtn = document.createElement('button');
    refreshBtn.className = 'btn-primary btn-sm';
    refreshBtn.textContent = '🔄 Actualizar';
    refreshBtn.addEventListener('click', () => fetchLogs());

    controls.appendChild(linesSelect);
    controls.appendChild(filterInput);
    controls.appendChild(refreshBtn);
    card.appendChild(controls);

    // Log output
    const logOutput = document.createElement('pre');
    logOutput.id = 'log-output';
    logOutput.style.cssText = 'background: #0d1117; color: #c9d1d9; padding: 15px; border-radius: 8px; overflow: auto; max-height: 60vh; font-family: "JetBrains Mono", "Fira Code", monospace; font-size: 0.8rem; line-height: 1.5; white-space: pre-wrap; word-break: break-all;';
    logOutput.textContent = 'Cargando...';
    card.appendChild(logOutput);

    container.appendChild(card);
    dashboardContent.appendChild(container);

    await fetchLogs();
}

async function fetchLogs() {
    const output = document.getElementById('log-output');
    if (!output) return;
    output.textContent = 'Cargando...';

    const lines = document.getElementById('log-lines')?.value || 100;
    const filter = document.getElementById('log-filter')?.value || '';

    try {
        let url = `${API_BASE}/logs/${currentLogTab}?lines=${lines}`;
        if (filter) url += `&filter=${encodeURIComponent(filter)}`;

        const res = await authFetch(url);
        if (!res.ok) throw new Error('Failed');
        const data = await res.json();

        output.textContent = data.logs || data.content || 'Sin datos';
        output.scrollTop = output.scrollHeight;
    } catch (e) {
        output.textContent = 'Error al cargar logs: ' + e.message;
    }
}


    // Expose to window
    window.AppLogs = {
        render: renderLogsView
    };
    
})(window);
