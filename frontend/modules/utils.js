/**
 * Utility Functions Module
 * Common utility functions used across the application
 */
(function(window) {
    'use strict';

    /**
     * Security: HTML escape function to prevent XSS
     * @param {*} unsafe - The input to escape
     * @returns {string} - HTML-safe string
     */
    function escapeHtml(unsafe) {
        if (unsafe === null || unsafe === undefined) return '';
        return String(unsafe)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    // Expose to window
    window.AppUtils = {
        escapeHtml
    };

})(window);
