/**
 * Docker Notes Module
 * Docker container notes management
 */
(function(window) {
    'use strict';
    
    const state = window.AppState;
    const API_BASE = window.API_BASE;

// =============================================================================

async function saveContainerNotes(containerId, notes) {
    try {
        const res = await authFetch(`${API_BASE}/docker/notes/${encodeURIComponent(containerId)}`, {
            method: 'POST',
            body: JSON.stringify({ notes })
        });
        if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            throw new Error(data.error || 'Failed to save notes');
        }
        return true;
    } catch (e) {
        console.error('Save notes error:', e);
        return false;
    }
}

window.saveContainerNotes = saveContainerNotes;


    // Expose to window
    window.AppDockerNotes = {
        show: showDockerNotes,
        update: updateDockerNotes
    };
    
})(window);
