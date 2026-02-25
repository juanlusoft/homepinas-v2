/**
 * Notification System Module
 * Toast notifications with animations
 */
(function(window) {
    'use strict';
    
    const escapeHtml = window.AppUtils.escapeHtml;


/**
 * Show a toast notification
 * @param {string} message - The message to display
 * @param {string} type - Type: 'success', 'error', 'warning', 'info'
 * @param {number} duration - Duration in ms (default: 4000)
 */
function showNotification(message, type = 'info', duration = 4000) {
    notificationQueue.push({ message, type, duration });
    processNotificationQueue();
}

function processNotificationQueue() {
    if (isShowingNotification || notificationQueue.length === 0) return;
    
    isShowingNotification = true;
    const { message, type, duration } = notificationQueue.shift();
    
    // Remove any existing notification
    const existing = document.querySelector('.notification-toast');
    if (existing) existing.remove();
    
    // Create notification element
    const toast = document.createElement('div');
    toast.className = `notification-toast ${type}`;
    
    // Icon based on type
    const icons = {
        success: '✅',
        error: '❌',
        warning: '⚠️',
        info: 'ℹ️'
    };
    
    // Title based on type
    const titles = {
        success: 'Éxito',
        error: 'Error',
        warning: 'Advertencia',
        info: 'Información'
    };
    
    toast.innerHTML = `
        <span class="notification-icon">${icons[type] || icons.info}</span>
        <div class="notification-content">
            <div class="notification-title">${titles[type] || titles.info}</div>
            <div class="notification-message">${escapeHtml(message)}</div>
        </div>
        <button class="notification-close" aria-label="Cerrar">×</button>
    `;
    
    document.body.appendChild(toast);
    
    // Close button handler
    const closeBtn = toast.querySelector('.notification-close');
    closeBtn.addEventListener('click', () => dismissNotification(toast));
    
    // Trigger animation
    requestAnimationFrame(() => {
        toast.classList.add('show');
    });
    
    // Auto dismiss
    setTimeout(() => dismissNotification(toast), duration);
}

function dismissNotification(toast) {
    if (!toast || !toast.parentNode) {
        isShowingNotification = false;
        processNotificationQueue();
        return;
    }
    
    toast.classList.remove('show');
    
    setTimeout(() => {
        if (toast.parentNode) toast.remove();
        isShowingNotification = false;
        processNotificationQueue();
    }, 400);
}

/**
 * Show a confirmation modal
 * @param {string} title - Modal title
 * @param {string} message - Modal message
 * @param {string} confirmText - Confirm button text (default: 'Confirmar')
 * @param {string} cancelText - Cancel button text (default: 'Cancelar')
 * @returns {Promise<boolean>} - True if confirmed, false if cancelled
 */
function showConfirmModal(title, message, confirmText = 'Confirmar', cancelText = 'Cancelar') {
    return new Promise((resolve) => {
        // Remove any existing confirm modal
        const existing = document.getElementById('confirm-modal');
        if (existing) existing.remove();
        
        const modal = document.createElement('div');
        modal.id = 'confirm-modal';
        modal.className = 'modal';
        modal.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.6);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 10000;
            animation: fadeIn 0.2s ease;
        `;
        
        modal.innerHTML = `
            <div class="glass-card scale-in" style="
                max-width: 400px;
                width: 90%;
                padding: 24px;
                text-align: center;
            ">
                <h3 style="margin-bottom: 16px; color: var(--text-primary);">${escapeHtml(title)}</h3>
                <p style="margin-bottom: 24px; color: var(--text-secondary); white-space: pre-wrap;">${escapeHtml(message)}</p>
                <div style="display: flex; gap: 12px; justify-content: center;">
                    <button id="confirm-cancel" class="wizard-btn wizard-btn-back">${escapeHtml(cancelText)}</button>
                    <button id="confirm-ok" class="wizard-btn wizard-btn-next">${escapeHtml(confirmText)}</button>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        // Focus the cancel button for safety
        document.getElementById('confirm-cancel').focus();
        
        // Event handlers
        document.getElementById('confirm-ok').addEventListener('click', () => {
            modal.remove();
            resolve(true);
        });
        
        document.getElementById('confirm-cancel').addEventListener('click', () => {
            modal.remove();
            resolve(false);
        });
        
        // Close on backdrop click
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.remove();
                resolve(false);
            }
        });
        
        // Close on Escape
        const handleEscape = (e) => {
            if (e.key === 'Escape') {
                modal.remove();
                resolve(false);
                document.removeEventListener('keydown', handleEscape);
            }
        };
        document.addEventListener('keydown', handleEscape);
    });
}

/**
 * Create confetti celebration effect
 */
function celebrateWithConfetti() {
    const container = document.createElement('div');
    container.className = 'confetti-container';
    document.body.appendChild(container);
    
    const colors = ['#4ecdc4', '#ff6b6b', '#ffe66d', '#95e1d3', '#f38181', '#aa96da'];
    
    for (let i = 0; i < 50; i++) {
        const confetti = document.createElement('div');
        confetti.className = 'confetti';
        confetti.style.left = Math.random() * 100 + '%';
        confetti.style.animationDelay = Math.random() * 2 + 's';
        confetti.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
        confetti.style.transform = `rotate(${Math.random() * 360}deg)`;
        container.appendChild(confetti);
    }
    
    // Remove after animation
    setTimeout(() => container.remove(), 4000);
}

// Authenticated fetch wrapper
async function authFetch(url, options = {}) {
    const headers = {
        'Content-Type': 'application/json',
        ...options.headers
    };

    if (state.sessionId) {
        headers['X-Session-Id'] = state.sessionId;
    }
    
    if (state.csrfToken) {
        headers['X-CSRF-Token'] = state.csrfToken;
    }

    const response = await fetch(url, { ...options, headers });

    // Handle CSRF errors (token expired after server restart)
    if (response.status === 403) {
        const cloned = response.clone();
        try {
            const data = await cloned.json();
            if (data.code === 'CSRF_INVALID' || (data.error && data.error.includes('CSRF'))) {
                clearSession();
                showNotification('Sesión expirada. Por favor, inicia sesión de nuevo.', 'warning');
                setTimeout(() => location.reload(), 1500);
                throw new Error('CSRF_EXPIRED');
            }
        } catch (e) {
            if (e.message === 'CSRF_EXPIRED') throw e;
            // Not a JSON response or not CSRF error, continue
        }
    }

    // Handle session expiration
    if (response.status === 401 && state.isAuthenticated) {
        state.isAuthenticated = false;
        state.sessionId = null;
        state.user = null;
        sessionStorage.removeItem('sessionId');
        switchView('login');
        throw new Error('Session expired');
    }

    return response;
}

// Session persistence
function saveSession(sessionId, csrfToken = null) {
    state.sessionId = sessionId;
    sessionStorage.setItem('sessionId', sessionId);
    if (csrfToken) {
        state.csrfToken = csrfToken;
        sessionStorage.setItem('csrfToken', csrfToken);
    }
}

function loadSession() {
    const sessionId = sessionStorage.getItem('sessionId');
    const csrfToken = sessionStorage.getItem('csrfToken');
    if (sessionId) {
        state.sessionId = sessionId;
    }
    if (csrfToken) {
        state.csrfToken = csrfToken;
    }
    return sessionId;
}

function clearSession() {
    state.sessionId = null;
    state.csrfToken = null;
    state.user = null;
    state.isAuthenticated = false;
}

    // Expose to window
    window.AppNotifications = {
        show: showNotification
    };

})(window);
