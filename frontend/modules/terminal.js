/**
 * Terminal View Module
 * Terminal interface and command execution
 */
(function(window) {
    'use strict';
    
    const state = window.AppState;
    const API_BASE = window.API_BASE;

// =============================================================================

async function renderTerminalView() {
    // Fetch shortcuts
    try {
        const res = await authFetch(`${API_BASE}/shortcuts`);
        if (res.ok) {
            const data = await res.json();
            state.shortcuts = { defaults: data.defaults || [], custom: data.custom || [] };
        }
    } catch (e) {
        console.error('Shortcuts fetch error:', e);
    }

    const container = document.createElement('div');
    container.className = 'terminal-view-container';
    container.style.width = '100%';

    // Header
    const header = document.createElement('div');
    header.className = 'glass-card';
    header.style.cssText = 'grid-column: 1 / -1; margin-bottom: 20px;';
    header.innerHTML = `
        <h3>${t('terminal.title', 'Terminal y Herramientas')}</h3>
        <p style="color: var(--text-dim); margin-top: 10px;">
            ${t('shortcuts.defaultShortcuts', 'Accesos rápidos a herramientas del sistema')}
        </p>
    `;
    container.appendChild(header);

    // Shortcuts grid
    const grid = document.createElement('div');
    grid.className = 'terminal-grid';

    // Default shortcuts
    const allShortcuts = [...state.shortcuts.defaults, ...state.shortcuts.custom];
    
    allShortcuts.forEach(shortcut => {
        const card = document.createElement('div');
        card.className = 'glass-card shortcut-card';
        
        const iconDiv = document.createElement('div');
        iconDiv.className = 'icon';
        iconDiv.textContent = shortcut.icon || '💻';
        
        const nameDiv = document.createElement('div');
        nameDiv.className = 'name';
        nameDiv.textContent = shortcut.name;
        
        const descDiv = document.createElement('div');
        descDiv.className = 'description';
        descDiv.textContent = shortcut.description || shortcut.command;
        
        card.appendChild(iconDiv);
        card.appendChild(nameDiv);
        card.appendChild(descDiv);
        
        // Add delete button for custom shortcuts
        if (!shortcut.isDefault && shortcut.id) {
            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'shortcut-delete-btn';
            deleteBtn.innerHTML = '🗑️';
            deleteBtn.title = t('common.delete', 'Eliminar');
            deleteBtn.addEventListener('click', async (e) => {
                e.stopPropagation(); // Prevent opening terminal
                const confirmed = await showConfirmModal('Eliminar acceso directo', '¿Eliminar este acceso directo?');
                if (confirmed) {
                    try {
                        const res = await authFetch(`${API_BASE}/shortcuts/${shortcut.id}`, {
                            method: 'DELETE'
                        });
                        if (res.ok) {
                            renderContent('terminal');
                        } else {
                            const data = await res.json();
                            alert(data.error || 'Error');
                        }
                    } catch (err) {
                        console.error('Delete shortcut error:', err);
                        alert(t('common.error', 'Error'));
                    }
                }
            });
            card.appendChild(deleteBtn);
        }
        
        card.addEventListener('click', () => openTerminal(shortcut.command, shortcut.name));
        grid.appendChild(card);
    });

    // Add new shortcut button
    const addCard = document.createElement('div');
    addCard.className = 'glass-card shortcut-card add-new';
    addCard.innerHTML = `
        <div class="icon">➕</div>
        <div class="name">${t('shortcuts.addShortcut', 'Añadir Acceso Directo')}</div>
    `;
    addCard.addEventListener('click', openAddShortcutModal);
    grid.appendChild(addCard);

    container.appendChild(grid);
    dashboardContent.appendChild(container);
}

// Terminal WebSocket connection
let terminalWs = null;
let terminal = null;
let fitAddon = null;

function openTerminal(command = 'bash', title = 'Terminal') {
    const modal = document.getElementById('terminal-modal');
    const containerEl = document.getElementById('terminal-container');
    const statusEl = document.getElementById('terminal-status-text');

    if (!modal || !containerEl) {
        console.error('Terminal modal not found');
        return;
    }

    // Show modal
    modal.classList.add('active');
    containerEl.innerHTML = '';

    // Initialize xterm.js
    if (typeof Terminal !== 'undefined') {
        terminal = new Terminal({
            cursorBlink: true,
            fontSize: 14,
            fontFamily: '"Fira Code", "Monaco", "Consolas", monospace',
            theme: {
                background: '#1a1a2e',
                foreground: '#ffffff',
                cursor: '#84cc16',
                cursorAccent: '#1a1a2e',
                selection: 'rgba(132, 204, 22, 0.3)',
                // ANSI colors - brighter versions for dark background
                black: '#3a3a4a',
                red: '#ff6b6b',
                green: '#69ff94',
                yellow: '#fff56d',
                blue: '#6eb5ff',
                magenta: '#ff77ff',
                cyan: '#6ef5ff',
                white: '#ffffff',
                brightBlack: '#666677',
                brightRed: '#ff8080',
                brightGreen: '#8affaa',
                brightYellow: '#ffff88',
                brightBlue: '#88ccff',
                brightMagenta: '#ff99ff',
                brightCyan: '#88ffff',
                brightWhite: '#ffffff'
            },
            scrollback: 5000
        });

        // Load addons
        if (typeof FitAddon !== 'undefined') {
            fitAddon = new FitAddon.FitAddon();
            terminal.loadAddon(fitAddon);
        }

        if (typeof WebLinksAddon !== 'undefined') {
            terminal.loadAddon(new WebLinksAddon.WebLinksAddon());
        }

        terminal.open(containerEl);
        
        if (fitAddon) {
            setTimeout(() => fitAddon.fit(), 100);
        }

        // Connect WebSocket
        // NOTE: WebSocket API does not support custom headers during handshake.
        // Token in query string is the standard pattern for WS auth (wss:// encrypts the URL).
        const sessionId = `term-${Date.now()}`;
        const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${wsProtocol}//${window.location.host}/api/terminal/ws?sessionId=${sessionId}&command=${encodeURIComponent(command)}&token=${state.sessionId}`;

        statusEl.textContent = t('terminal.connecting', 'Conectando...');

        terminalWs = new WebSocket(wsUrl);

        terminalWs.onopen = () => {
            statusEl.textContent = t('terminal.connected', 'Conectado');
            document.querySelector('.terminal-status').classList.remove('disconnected');
        };

        terminalWs.onmessage = (event) => {
            try {
                const msg = JSON.parse(event.data);
                if (msg.type === 'output') {
                    terminal.write(msg.data);
                } else if (msg.type === 'exit') {
                    terminal.write(`\\r\\n\\x1b[33m[Proceso terminado con código ${msg.exitCode}]\\x1b[0m\\r\\n`);
                    statusEl.textContent = t('terminal.disconnected', 'Desconectado');
                    document.querySelector('.terminal-status').classList.add('disconnected');
                }
            } catch (e) {
                console.error('Terminal message error:', e);
            }
        };

        terminalWs.onclose = (event) => {
            statusEl.textContent = t('terminal.disconnected', 'Desconectado');
            document.querySelector('.terminal-status').classList.add('disconnected');
            
            // Show helpful message if connection failed immediately
            if (event.code === 1006) {
                terminal.write('\r\n\x1b[31m[Error: No se pudo conectar al servidor de terminal]\x1b[0m\r\n');
                terminal.write('\x1b[33mPosibles causas:\x1b[0m\r\n');
                terminal.write('  - El módulo node-pty no está instalado correctamente\r\n');
                terminal.write('  - El servidor necesita reiniciarse después de la instalación\r\n');
                terminal.write('\x1b[33mSolución: sudo systemctl restart homepinas\x1b[0m\r\n');
            }
        };

        terminalWs.onerror = (err) => {
            console.error('Terminal WebSocket error:', err);
            statusEl.textContent = t('terminal.error', 'Error de conexión');
        };

        // Send input to WebSocket
        terminal.onData((data) => {
            if (terminalWs && terminalWs.readyState === WebSocket.OPEN) {
                terminalWs.send(JSON.stringify({ type: 'input', data }));
            }
        });

        // Handle resize
        terminal.onResize(({ cols, rows }) => {
            if (terminalWs && terminalWs.readyState === WebSocket.OPEN) {
                terminalWs.send(JSON.stringify({ type: 'resize', cols, rows }));
            }
        });

    } else {
        containerEl.innerHTML = '<p style="color: #ef4444; padding: 20px;">Error: xterm.js no disponible</p>';
    }
}

function closeTerminal() {
    const modal = document.getElementById('terminal-modal');
    if (modal) modal.classList.remove('active');

    if (terminalWs) {
        terminalWs.close();
        terminalWs = null;
    }

    if (terminal) {
        terminal.dispose();
        terminal = null;
    }
}

// Terminal modal controls
const closeTerminalBtn = document.getElementById('close-terminal-modal');
if (closeTerminalBtn) {
    closeTerminalBtn.addEventListener('click', closeTerminal);
}

const terminalFullscreenBtn = document.getElementById('terminal-fullscreen');
if (terminalFullscreenBtn) {
    terminalFullscreenBtn.addEventListener('click', () => {
        const modalContent = document.querySelector('.terminal-modal-content');
        if (modalContent) {
            modalContent.classList.toggle('fullscreen');
            if (fitAddon) fitAddon.fit();
        }
    });
}

// Close terminal on escape
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        const terminalModal = document.getElementById('terminal-modal');
        if (terminalModal && terminalModal.classList.contains('active')) {
            closeTerminal();
        }
    }
});

// Resize terminal on window resize
window.addEventListener('resize', () => {
    if (fitAddon && terminal) {
        fitAddon.fit();
    }
});


    // Expose to window
    window.AppTerminal = {
        render: renderTerminalView
    };
    
})(window);
