# Frontend Modules

This directory contains the modular breakdown of the HomePiNAS Dashboard frontend.

## Overview

The original `main.js` (13,500+ lines) has been refactored into focused modules following the code quality standards (max 300 lines per file where feasible).

## Module Structure

Modules use IIFE (Immediately Invoked Function Expression) pattern to maintain global namespace compatibility without requiring a bundler.

Each module:
- Is wrapped in an IIFE: `(function(window) { ... })(window)`
- Uses `'use strict'` mode
- Accesses global state via `window.AppState`
- Exposes public APIs via `window.App<ModuleName>`

## Module Dependencies

Loading order is critical. See `index.html` for the correct sequence:

1. **Core Infrastructure**
   - `state.js` - Global state management
   - `utils.js` - Utility functions (escapeHtml, etc.)

2. **System Services**
   - `notifications.js` - Toast notification system
   - `router.js` - URL routing and view management

3. **Feature Modules** (order independent)
   - `storage-wizard.js` - Storage configuration wizard
   - `terminal.js` - Terminal interface
   - `shortcuts.js` - Shortcuts modal
   - `docker-logs.js` - Docker logs viewer
   - `docker-notes.js` - Docker notes management
   - `file-manager.js` - File browser and management
   - `users.js` - User management and 2FA
   - `backup.js` - Backup and scheduler
   - `logs.js` - System logs viewer
   - `samba.js` - Samba/SMB shares
   - `ups.js` - UPS monitoring
   - `notifications-config.js` - Notification settings
   - `ddns.js` - Dynamic DNS configuration
   - `active-directory.js` - Samba AD DC
   - `cloud-sync.js` - Syncthing integration
   - `homestore.js` - App marketplace
   - `docker-stacks.js` - Docker Compose stacks

4. **Initialization**
   - `init.js` - Application initialization
   - `main.js` - Entry point orchestration

## Large File Exceptions

Some modules exceed the 300-line guideline due to complex workflows:

- **storage-wizard.js** (~3300 lines): Complex 7-step wizard with state management
- **file-manager.js** (~1400 lines): Full file browser with upload/download/permissions
- **router.js** (~1080 lines): Routing + polling + disk detection system
- **init.js** (~1080 lines): Complex initialization with multiple async operations
- **active-directory.js** (~1150 lines): AD domain setup and configuration
- **cloud-sync.js** (~850 lines): Syncthing integration and sync management
- **homestore.js** (~795 lines): App marketplace with installation workflows
- **docker-stacks.js** (~1600 lines): Docker Compose stack deployment and management

These exceptions are documented in each module header and follow the Code Quality SKILL.md guideline: "Large files (>300 lines): OK if it's a single cohesive domain concept that's harder to split."

## Future Refactoring

Large modules can be further split as needed:

### storage-wizard.js
Could be split into:
- `storage-wizard-ui.js` - UI rendering
- `storage-wizard-state.js` - State management
- `storage-wizard-api.js` - API calls

### file-manager.js
Could be split into:
- `file-manager-ui.js` - File browser UI
- `file-manager-operations.js` - File operations
- `file-manager-upload.js` - Upload handling
- `file-manager-permissions.js` - Permission management

## Development

After modifying modules:

1. Run syntax check: `node --check modules/<module>.js`
2. Test in browser for runtime errors
3. Check browser console for missing dependencies
4. Verify functionality in UI

## Backup

Original monolithic file preserved as `main.js.backup` (13,500 lines).
