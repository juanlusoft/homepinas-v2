/**
 * Notifications Config Module
 * System notifications configuration
 */
(function(window) {
    'use strict';
    
    const state = window.AppState;
    const API_BASE = window.API_BASE;

// =============================================================================

async function renderNotificationsSection(container) {
    const card = document.createElement('div');
    card.className = 'glass-card';
    card.style.cssText = 'grid-column: 1 / -1;';

    const title = document.createElement('h3');
    title.textContent = '🔔 Notificaciones';
    title.style.marginBottom = '20px';
    card.appendChild(title);

    const content = document.createElement('div');
    content.style.cssText = 'display: grid; grid-template-columns: 1fr 1fr; gap: 20px;';

    // Email config
    const emailSection = document.createElement('div');
    emailSection.innerHTML = `
        <h4 style="margin-bottom: 12px;">📧 Email (SMTP)</h4>
        <form id="notif-email-form" style="display: flex; flex-direction: column; gap: 10px;">
            <input type="text" id="ne-host" placeholder="Servidor SMTP" style="padding: 10px; border-radius: 8px; border: 1px solid var(--border); background: var(--bg-card); color: var(--text);">
            <div style="display: flex; gap: 8px;">
                <input type="number" id="ne-port" placeholder="Puerto" value="587" style="padding: 10px; border-radius: 8px; border: 1px solid var(--border); background: var(--bg-card); color: var(--text); width: 100px;">
                <label style="display: flex; align-items: center; gap: 4px;"><input type="checkbox" id="ne-secure"> SSL</label>
            </div>
            <input type="text" id="ne-user" placeholder="Usuario" style="padding: 10px; border-radius: 8px; border: 1px solid var(--border); background: var(--bg-card); color: var(--text);">
            <input type="password" id="ne-pass" placeholder="Contraseña" style="padding: 10px; border-radius: 8px; border: 1px solid var(--border); background: var(--bg-card); color: var(--text);">
            <input type="email" id="ne-from" placeholder="Remitente" style="padding: 10px; border-radius: 8px; border: 1px solid var(--border); background: var(--bg-card); color: var(--text);">
            <input type="email" id="ne-to" placeholder="Destinatario" style="padding: 10px; border-radius: 8px; border: 1px solid var(--border); background: var(--bg-card); color: var(--text);">
            <div style="display: flex; gap: 8px;">
                <button type="submit" class="btn-primary btn-sm">Guardar</button>
                <button type="button" class="btn-primary btn-sm" id="test-email-btn" style="background: #6366f1;">Probar</button>
            </div>
        </form>
    `;

    // Telegram config
    const telegramSection = document.createElement('div');
    telegramSection.innerHTML = `
        <h4 style="margin-bottom: 12px;">📱 Telegram</h4>
        <form id="notif-telegram-form" style="display: flex; flex-direction: column; gap: 10px;">
            <input type="text" id="nt-token" placeholder="Bot Token" style="padding: 10px; border-radius: 8px; border: 1px solid var(--border); background: var(--bg-card); color: var(--text);">
            <input type="text" id="nt-chatid" placeholder="Chat ID" style="padding: 10px; border-radius: 8px; border: 1px solid var(--border); background: var(--bg-card); color: var(--text);">
            <label style="display: flex; align-items: center; gap: 6px;"><input type="checkbox" id="nt-enabled"> Activado</label>
            <div style="display: flex; gap: 8px;">
                <button type="submit" class="btn-primary btn-sm">Guardar</button>
                <button type="button" class="btn-primary btn-sm" id="test-telegram-btn" style="background: #6366f1;">Probar</button>
            </div>
        </form>
    `;

    content.appendChild(emailSection);
    content.appendChild(telegramSection);
    card.appendChild(content);
    container.appendChild(card);

    // Load existing config
    try {
        const res = await authFetch(`${API_BASE}/notifications/config`);
        if (res.ok) {
            const config = await res.json();
            if (config.email) {
                if (config.email.host) document.getElementById('ne-host').value = config.email.host;
                if (config.email.port) document.getElementById('ne-port').value = config.email.port;
                document.getElementById('ne-secure').checked = config.email.secure || false;
                if (config.email.user) document.getElementById('ne-user').value = config.email.user;
                if (config.email.from) document.getElementById('ne-from').value = config.email.from;
                if (config.email.to) document.getElementById('ne-to').value = config.email.to;
            }
            if (config.telegram) {
                if (config.telegram.botToken) document.getElementById('nt-token').value = config.telegram.botToken;
                if (config.telegram.chatId) document.getElementById('nt-chatid').value = config.telegram.chatId;
                document.getElementById('nt-enabled').checked = config.telegram.enabled || false;
            }
        }
    } catch (e) {}

    // Wire up forms
    document.getElementById('notif-email-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
            await authFetch(`${API_BASE}/notifications/config/email`, {
                method: 'POST',
                body: JSON.stringify({
                    host: document.getElementById('ne-host').value,
                    port: parseInt(document.getElementById('ne-port').value) || 587,
                    secure: document.getElementById('ne-secure').checked,
                    user: document.getElementById('ne-user').value,
                    password: document.getElementById('ne-pass').value,
                    from: document.getElementById('ne-from').value,
                    to: document.getElementById('ne-to').value
                })
            });
            alert('Configuración email guardada');
        } catch (e) { alert('Error'); }
    });

    document.getElementById('notif-telegram-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
            await authFetch(`${API_BASE}/notifications/config/telegram`, {
                method: 'POST',
                body: JSON.stringify({
                    botToken: document.getElementById('nt-token').value,
                    chatId: document.getElementById('nt-chatid').value,
                    enabled: document.getElementById('nt-enabled').checked
                })
            });
            alert('Configuración Telegram guardada');
        } catch (e) { alert('Error'); }
    });

    document.getElementById('test-email-btn').addEventListener('click', async () => {
        try {
            const res = await authFetch(`${API_BASE}/notifications/test/email`, { method: 'POST' });
            alert(res.ok ? '¡Email de prueba enviado!' : 'Error al enviar');
        } catch (e) { alert('Error'); }
    });

    document.getElementById('test-telegram-btn').addEventListener('click', async () => {
        try {
            const res = await authFetch(`${API_BASE}/notifications/test/telegram`, { method: 'POST' });
            alert(res.ok ? '¡Mensaje de prueba enviado!' : 'Error al enviar');
        } catch (e) { alert('Error'); }
    });
}


    // Expose to window
    window.AppNotificationsConfig = {
        render: renderNotificationsConfig
    };
    
})(window);
