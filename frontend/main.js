/**
 * HomePiNAS Dashboard - Main Entry Point
 * 
 * This file orchestrates the initialization of all application modules.
 * Individual modules are loaded via script tags in index.html.
 * 
 * Module Loading Order (defined in index.html):
 * 1. i18n.js - Internationalization
 * 2. state.js - State management
 * 3. utils.js - Utility functions
 * 4. notifications.js - Toast notifications
 * 5. router.js - URL routing and navigation
 * 6. All feature modules (storage-wizard, file-manager, docker-*, etc.)
 * 7. init.js - Application initialization
 * 8. main.js (this file) - Final orchestration
 */

// Import i18n
import { initI18n, t, applyTranslations, getCurrentLang } from './i18n.js';

// Wait for DOM to be ready
document.addEventListener('DOMContentLoaded', async () => {
    console.log('HomePiNAS Dashboard - Initializing...');
    
    // Initialize i18n
    await initI18n();
    
    // Make translation function globally available
    window.t = t;
    window.getCurrentLang = getCurrentLang;
    window.applyTranslations = applyTranslations;
    
    // Initialize authentication and app
    if (window.AppInit && window.AppInit.init) {
        await window.AppInit.init();
    } else {
        console.error('AppInit module not loaded!');
    }
    
    console.log('HomePiNAS Dashboard - Ready');
});

// Export for module compatibility
export { t, getCurrentLang, applyTranslations };
