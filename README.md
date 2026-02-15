# HomePiNAS v2.8.0

Premium NAS Dashboard for Raspberry Pi CM5 - Homelabs.club Edition

![HomePiNAS Dashboard](https://img.shields.io/badge/version-2.8.0-brightgreen)
![Tests](https://img.shields.io/badge/tests-432%20passing-success)
![PWA Ready](https://img.shields.io/badge/PWA-Ready-blueviolet)
![Mobile Friendly](https://img.shields.io/badge/Mobile-Friendly-blue)

## 🚀 Features

### Core
- **SnapRAID + MergerFS** — Disk pooling with parity protection
- **Samba Sharing** — Network file sharing with automatic user creation
- **Docker Management** — Container control from dashboard (Dockhand GUI)
- **Fan Control** — PWM control for EMC2305 (Silent/Balanced/Performance)
- **System Monitoring** — CPU, Memory, Disk, Network stats
- **Web Terminal** — Full terminal access from the browser
- **File Manager** — Upload, download, drag & drop, preview

### Advanced
- **👥 Users & Permissions** — Multi-user with admin/user roles
- **🔐 2FA (TOTP)** — Google Authenticator compatible
- **📧 Notifications** — Email and Telegram alerts
- **📋 Log Viewer** — System and security logs
- **💾 Backup** — Create, schedule, and restore backups
- **⏰ Task Scheduler** — Cron jobs from dashboard
- **🔌 UPS Support** — APC UPS monitoring
- **🌐 DDNS** — DuckDNS, No-IP, Dynu remote access
- **🏪 HomeStore** — App marketplace with 43+ one-click installs

### 🏢 Active Directory Domain Controller (NEW in v2.7+)
- **Samba AD DC** — Full Windows domain controller
- **User & Group management** — Create, delete, manage from dashboard
- **Windows integration** — Join Windows 10/11 PCs to domain
- **Professional UI** — Tabs, cards, step-by-step instructions

### ☁️ Cloud Sync (Syncthing)
- **Real-time folder sync** between NAS and other devices
- **Syncthing integration** — Peer-to-peer, encrypted sync
- **Dashboard management** — Add/remove sync folders from UI
- **Auto-detection** — Finds Syncthing config across system users
- **Status monitoring** — Connection and sync status at a glance

### 🖥️ Active Backup for Business
- **Centralized backup** of PCs and servers to NAS
- **Backup Agent** — Install on Windows/Mac, managed from NAS dashboard
- **Image backup** — Full disk (Windows wbadmin, Linux dd/partclone)
- **File backup** — Folders via rsync+SSH with hardlink deduplication
- **Versioning** — Keep multiple backup copies with retention policies
- **Web restore** — Browse and download files from any backup version
- **🆕 USB Recovery Tool** — Bootable Debian ISO for bare-metal restore
- **Dynamic user detection** — Works with any system username

### Mobile & PWA
- **📱 Responsive UI** — Full mobile support
- **📲 PWA Support** — Install as native app
- **🌐 mDNS Discovery** — Access via `homepinas.local`

### 🧪 Testing
- **432 unit tests** across 27 test suites
- **Jest + Supertest** — Automated CI via GitHub Actions
- **Full coverage** — Auth, RBAC, files, storage, backup, AD, and more

## 🔒 Security

- Bcrypt password hashing (12 rounds)
- SQLite-backed persistent sessions
- Rate limiting + Helmet headers
- Input sanitization for shell commands
- Restricted sudoers configuration
- HTTPS with self-signed certificates
- 2FA (TOTP) support

## ⚡ Quick Install

### NAS Dashboard

```bash
curl -fsSL https://raw.githubusercontent.com/juanlusoft/homepinas-v2/main/install.sh | sudo bash
```

### 💻 Backup Agent (Windows/Mac)

Download and install the Backup Agent on any PC you want to protect:

| Platform | Download |
|----------|----------|
| Windows | [HomePiNAS-Backup-Setup.exe](https://github.com/juanlusoft/homepinas-v2/releases/latest) |
| macOS | [HomePiNAS-Backup.dmg](https://github.com/juanlusoft/homepinas-v2/releases/latest) |

**Or build from source:**

```bash
git clone https://github.com/juanlusoft/homepinas-v2.git
cd homepinas-v2/agent
npm install
npm start          # Run in development
npm run build:win  # Build Windows .exe
npm run build:mac  # Build macOS .dmg
```

#### How it works

1. **Install the Agent** on your PC → opens automatically
2. **Click "Search NAS"** → finds your HomePiNAS on the network
3. **Wait for approval** → your NAS admin approves the device
4. **Backups run automatically** → scheduled, with retention, no config needed

The admin manages everything from the NAS dashboard: approve devices, set schedule, trigger backups, browse/restore files.

## 📋 Requirements

- Raspberry Pi CM5 (or compatible ARM64 device)
- Raspberry Pi OS Bookworm (64-bit) or Debian Trixie
- At least 2 disks for SnapRAID (1 data + 1 parity)

## 🌐 Access

### Local Network
```
https://homepinas.local         (mDNS)
https://<IP>                    (HTTPS - puerto 443)
http://<IP>                     (HTTP - redirige a HTTPS)
```

### Network Share (SMB)
```
\\homepinas.local\Storage
```

## 📁 Directory Structure

```
/opt/homepinas/              # Application files
/mnt/storage/                # MergerFS pool mount
/mnt/storage/active-backup/  # Active Backup data
/mnt/disks/disk[1-6]/        # Individual data disks
/mnt/parity[1-2]/            # Parity disks
/mnt/disks/cache[1-2]/       # NVMe/SSD cache
```

## 📜 Version History

### v2.8.0 — Active Directory + Testing + HomeStore
- **Active Directory DC** — Full Samba AD domain controller with UI
- **432 unit tests** — Jest + Supertest, CI via GitHub Actions
- **HomeStore** — 43 one-click app installs
- **Dockhand** — Docker GUI integration
- **SQLite session persistence**

### v2.7.0 — Active Directory
- **Samba AD DC** — Provision domain, manage users/groups
- **Windows 10/11 domain join** — Step-by-step instructions in UI
- **Professional AD UI** — Tabs, cards, filtered system accounts

### v2.6.0 — Image Builder
- **Pre-built image strategy** — Flash and boot on any disk
- **Firstboot wizard** — Expand partition, set hostname/user/pass

### v2.5.0 — Cloud Sync + Polish
- **Cloud Sync** — Syncthing integration for real-time folder sync
- **HTTP → HTTPS redirect** — Automatic secure connection
- **Dynamic user detection** — No hardcoded usernames

### v2.4.0 — Active Backup + Recovery
- **Active Backup** — Centralized backup of PCs/servers
- **Backup Agent** — Cross-platform Electron app (Windows/Mac)
- **USB Recovery Tool** — Bootable Debian ISO for bare-metal restore

### v2.3.0 — Extended Features
- File Manager, Users & Permissions, Samba management
- Notifications, 2FA, Log Viewer, Backup, Scheduler, UPS, DDNS

### v2.2.0 — Mobile & PWA
### v2.1.0 — Internationalization
### v2.0.0 — Major Rewrite

## 🐛 Troubleshooting

### Backup Agent can't find NAS
1. Ensure NAS and PC are on the same network
2. Check Avahi is running: `sudo systemctl status avahi-daemon`
3. Enter IP manually in the Agent if auto-discovery fails

### wbadmin fails on Windows
- Run the Agent as Administrator
- On Windows Home: use Control Panel → Backup → Create system image
- On Windows Pro: `dism /online /enable-feature /featurename:WindowsServerBackup`

### mDNS not working
```bash
sudo systemctl status avahi-daemon
ls -la /etc/avahi/services/homepinas.service
```

## 📝 License

MIT License — [Homelabs.club](https://homelabs.club)

---

**Made with ❤️ for the home lab community**
