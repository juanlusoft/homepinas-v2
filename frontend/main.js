/**
 * HomePiNAS Dashboard - Main Entry Point
 * Orchestrates initialization of all application modules.
 */
document.addEventListener('DOMContentLoaded', async () => {
    console.log('HomePiNAS Dashboard - Initializing...');

    if (window.AppInit && window.AppInit.init) {
        await window.AppInit.init();
    } else {
        console.error('AppInit module not loaded!');
    }

    console.log('HomePiNAS Dashboard - Ready');
});
