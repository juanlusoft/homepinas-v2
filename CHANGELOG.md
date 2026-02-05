# Changelog

All notable changes to HomePiNAS are documented in this file.

## [2.5.0] - 2025-02-05

### Added
- **Cloud Sync** — Syncthing integration for real-time folder synchronization
  - Add/remove sync folders from dashboard
  - Monitor connection and sync status
  - Peer-to-peer encrypted sync between devices

### Changed
- **HTTP → HTTPS redirect** — HTTP requests now automatically redirect to HTTPS
- **Dynamic user detection** — Syncthing service now detects system username automatically (no hardcoded paths)

### Fixed
- **Terminal colors** — Fixed visibility of colored text on dark backgrounds
- **Cloud Sync delete folder** — Replaced browser `confirm()` with custom modal for better UX
- **SPA routing race condition** — Fixed incorrect view rendering on initial page load
- **Cloud Sync duplicate title** — Removed duplicate heading in Cloud Sync view
- **CSP compliance** — Replaced inline onclick handlers with addEventListener

---

## [2.4.0] - 2025-02-04

### Added
- **Active Backup for Business** — Centralized backup solution for PCs and servers
  - Backup Agent for Windows/Mac (Electron app)
  - Image backup (full disk) and file backup (folders with deduplication)
  - Versioning with retention policies
  - Web-based file restore
- **USB Recovery Tool** — Bootable Debian ISO for bare-metal restore
- **Agent auto-registration** — Devices discover NAS via mDNS, admin approves from dashboard
- **Per-device Samba shares** — Auto-created with random credentials for each backup device

### Fixed
- Session expiration handling during polling
- NaN display for container RAM stats
- Disk action modal from card buttons
- Virtual device filtering (zram/ram/loop)

---

## [2.3.0] - 2025-02-01

### Added
- **File Manager** — Upload, download, drag & drop, preview
- **Users & Permissions** — Multi-user with admin/user roles
- **Samba Management** — Network shares from dashboard
- **Notifications** — Email and Telegram alerts
- **2FA (TOTP)** — Google Authenticator compatible
- **Log Viewer** — System and security logs
- **Backup & Restore** — Configuration backup
- **Task Scheduler** — Cron jobs from dashboard
- **UPS Monitoring** — APC UPS support
- **DDNS** — DuckDNS, No-IP, Dynu integration

---

## [2.2.0] - 2025-01-28

### Added
- **Responsive UI** — Full mobile support
- **PWA Support** — Install as native app
- **mDNS Discovery** — Access via `homepinas.local`

---

## [2.1.0] - 2025-01-25

### Added
- **Multi-language** — English and Spanish support
- **Theme toggle** — Light/dark mode

---

## [2.0.0] - 2025-01-20

### Changed
- Complete UI redesign
- New storage wizard
- Docker management overhaul

---

## [1.0.0] - 2025-01-15

### Added
- Initial release
- SnapRAID + MergerFS integration
- Basic dashboard with system monitoring
- Fan control (EMC2305)
- Web terminal
