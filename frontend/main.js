/**
 * HomePiNAS Dashboard - Main Entry Point
 * Orchestrates initialization of all application modules.
 */
document.addEventListener('DOMContentLoaded', async () => {
    var d = document.getElementById('debug-errors');
    function dbg(msg) { window.__errors.push(msg); if(d) d.textContent = window.__errors.join('\n'); console.log(msg); }
    
    dbg('DOMContentLoaded fired');
    dbg('AppState: ' + !!window.AppState);
    dbg('AppUtils: ' + !!window.AppUtils);
    dbg('AppNotifications: ' + !!window.AppNotifications);
    dbg('AppRouter: ' + !!window.AppRouter);
    dbg('AppInit: ' + !!window.AppInit);
    dbg('initI18n: ' + !!window.initI18n);
    
    if (window.AppInit && window.AppInit.init) {
        try {
            dbg('Calling AppInit.init()...');
            await window.AppInit.init();
            dbg('AppInit.init() completed');
        } catch(e) {
            dbg('AppInit.init() ERROR: ' + e.message + ' @ ' + e.stack);
        }
    } else {
        dbg('ERROR: AppInit not loaded!');
    }
});
