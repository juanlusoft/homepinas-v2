/**
 * Shortcuts Modal Module
 * Custom shortcuts management
 */
(function(window) {
    'use strict';
    
    const state = window.AppState;
    const API_BASE = window.API_BASE;

// =============================================================================

function openAddShortcutModal() {
    const modal = document.createElement('div');
    modal.id = 'shortcut-modal';
    modal.className = 'modal active';
    modal.innerHTML = `
        <div class="glass-card modal-content" style="max-width: 500px;">
            <header class="modal-header">
                <h3>${t('shortcuts.addShortcut', 'Añadir Acceso Directo')}</h3>
                <button id="close-shortcut-modal" class="btn-close">&times;</button>
            </header>
            <form id="shortcut-form">
                <div class="input-group">
                    <input type="text" id="shortcut-name" required placeholder=" ">
                    <label>${t('shortcuts.name', 'Nombre')}</label>
                </div>
                <div class="input-group">
                    <input type="text" id="shortcut-command" required placeholder=" ">
                    <label>${t('shortcuts.command', 'Comando')}</label>
                </div>
                <div class="input-group">
                    <input type="text" id="shortcut-description" placeholder=" ">
                    <label>${t('shortcuts.description', 'Descripción')}</label>
                </div>
                <div style="margin-bottom: 20px;">
                    <label style="display: block; margin-bottom: 10px; color: var(--text-dim);">${t('shortcuts.icon', 'Icono')}</label>
                    <div id="icon-picker" style="display: flex; flex-wrap: wrap; gap: 8px;"></div>
                </div>
                <input type="hidden" id="shortcut-icon" value="💻">
                <div class="modal-footer" style="display: flex; gap: 10px;">
                    <button type="button" id="cancel-shortcut-modal" class="btn-primary" style="background: var(--text-dim);">
                        ${t('common.cancel', 'Cancelar')}
                    </button>
                    <button type="submit" class="btn-primary">${t('common.save', 'Guardar')}</button>
                </div>
            </form>
        </div>
    `;

    document.body.appendChild(modal);
    
    // Close handlers
    const closeModal = () => modal.remove();
    document.getElementById('close-shortcut-modal').addEventListener('click', closeModal);
    document.getElementById('cancel-shortcut-modal').addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeModal();
    });

    // Populate icon picker
    const icons = ['💻', '📊', '📁', '📝', '🐳', '📜', '💾', '🧠', '⚙️', '🔧', '📦', '🌐', '🔒', '📡', '⏱️', '🎯', '🚀', '💡', '🔍', '📈'];
    const iconPicker = document.getElementById('icon-picker');
    icons.forEach(icon => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.style.cssText = 'width: 40px; height: 40px; border: 1px solid var(--card-border); border-radius: 8px; background: var(--card-bg); font-size: 1.2rem; cursor: pointer;';
        btn.textContent = icon;
        btn.addEventListener('click', () => {
            document.querySelectorAll('#icon-picker button').forEach(b => b.style.borderColor = 'var(--card-border)');
            btn.style.borderColor = 'var(--primary)';
            document.getElementById('shortcut-icon').value = icon;
        });
        iconPicker.appendChild(btn);
    });

    // Form submit
    document.getElementById('shortcut-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = document.getElementById('shortcut-name').value.trim();
        const command = document.getElementById('shortcut-command').value.trim();
        const description = document.getElementById('shortcut-description').value.trim();
        const icon = document.getElementById('shortcut-icon').value;

        try {
            const res = await authFetch(`${API_BASE}/shortcuts`, {
                method: 'POST',
                body: JSON.stringify({ name, command, description, icon })
            });
            const data = await res.json();

            if (!res.ok) throw new Error(data.error || 'Failed to create shortcut');

            modal.remove();
            renderContent('terminal');
        } catch (err) {
            alert('Error: ' + err.message);
        }
    });
}


    // Expose to window
    window.AppShortcuts = {
        open: openShortcutsModal
    };
    
})(window);
