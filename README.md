# HomePiNAS v2.2.0

Premium NAS Dashboard for Raspberry Pi CM5 - Homelabs.club Edition

![HomePiNAS Dashboard](https://img.shields.io/badge/version-2.2.0-brightgreen)
![PWA Ready](https://img.shields.io/badge/PWA-Ready-blueviolet)
![Mobile Friendly](https://img.shields.io/badge/Mobile-Friendly-blue)

## 🚀 Features

- **SnapRAID + MergerFS** - Disk pooling with parity protection
- **Samba Sharing** - Network file sharing with automatic user creation
- **Docker Management** - Container control from dashboard
- **Fan Control** - PWM control for EMC2305 (Silent/Balanced/Performance)
- **System Monitoring** - CPU, Memory, Disk, Network stats
- **DDNS Support** - Cloudflare, No-IP, DuckDNS
- **📱 PWA Support** - Install as native app on mobile/desktop
- **🌐 mDNS Discovery** - Access via `homepinas.local` on local network
- **📱 Responsive UI** - Optimized for mobile devices

## 🔒 Security Features

- Bcrypt password hashing (12 rounds)
- SQLite-backed persistent sessions with expiration
- Rate limiting protection
- Helmet security headers
- Input sanitization for shell commands
- Restricted sudoers configuration
- HTTPS support with self-signed certificates

## ⚡ Quick Install

```bash
curl -fsSL https://raw.githubusercontent.com/juanlusoft/homepinas-v2/main/install.sh | sudo bash
```

## 📋 Requirements

- Raspberry Pi CM5 (or compatible ARM64 device)
- Raspberry Pi OS Bookworm (64-bit) or Debian Trixie
- At least 2 disks for SnapRAID (1 data + 1 parity)

## 🌐 Access

### Local Network (mDNS)

After installation, access your NAS using the hostname:

```
https://homepinas.local:3001
```

> **Note:** mDNS works on most devices. On Windows, you may need to install [Bonjour](https://support.apple.com/kb/DL999) for `.local` domain support.

### IP Address Access

```
https://<IP>:3001    (HTTPS - Recommended)
http://<IP>:3000     (HTTP - Fallback)
```

### Network Share (SMB)

```
\\homepinas.local\Storage
or
\\<IP>\Storage
```

## 📱 PWA Installation

HomePiNAS can be installed as a Progressive Web App:

### On Mobile (iOS/Android):
1. Open `https://homepinas.local:3001` in Safari (iOS) or Chrome (Android)
2. Tap the share button → "Add to Home Screen"
3. HomePiNAS will appear as a native app

### On Desktop (Chrome/Edge):
1. Open `https://homepinas.local:3001` in Chrome or Edge
2. Click the install icon in the address bar
3. Or use the menu → "Install HomePiNAS"

## 🔧 Configuration

### Change Hostname (for mDNS)

To access via `homepinas.local`, set the hostname:

```bash
sudo hostnamectl set-hostname homepinas
sudo reboot
```

### Generate PWA Icons

If you need to regenerate the PWA icons:

```bash
# Install rsvg-convert (if not available)
sudo apt install librsvg2-bin

# Run the icon generator
./scripts/generate-icons.sh
```

## 📁 Directory Structure

```
/opt/homepinas/           # Application files
/mnt/storage/             # MergerFS pool mount
/mnt/disks/disk[1-6]/     # Individual data disks
/mnt/parity[1-2]/         # Parity disks
/etc/avahi/services/      # mDNS service definitions
```

## 📜 Version History

### v2.2.0 - Mobile & PWA Edition
- **📱 Responsive UI** - Full mobile support with collapsible sidebar
- **📲 PWA Support** - Install as native app with offline caching
- **🌐 mDNS Discovery** - Access via `hostname.local` on local network
- **🖐️ Touch Optimized** - Larger touch targets for mobile devices
- **📡 Windows Discovery** - WSDD for Windows network browsing

### v2.1.1 - Stability Release
- Bug fixes and performance improvements
- Improved error handling

### v2.1.0 - Internationalization
- Multi-language support (English/Spanish)
- Theme toggle (Light/Dark mode)
- Persistent preferences

### v2.0.0 - Major Rewrite
- Complete UI redesign
- Enhanced Docker management
- Improved storage configuration wizard

### v1.5.x - Security Hardened
- HTTPS with self-signed certificates
- Bcrypt password hashing
- Rate limiting and security headers
- OTA updates from dashboard
- Fan control with hysteresis

## 🐛 Troubleshooting

### mDNS not working

1. Check Avahi is running:
   ```bash
   sudo systemctl status avahi-daemon
   ```

2. Verify the service file exists:
   ```bash
   ls -la /etc/avahi/services/homepinas.service
   ```

3. On Windows, ensure Bonjour is installed or use IP address.

### PWA not installing

1. Ensure you're accessing via HTTPS
2. Check the browser console for errors
3. Clear browser cache and try again

### Service Worker issues

Clear the service worker cache:
```javascript
// In browser console
navigator.serviceWorker.getRegistrations().then(regs => {
  regs.forEach(reg => reg.unregister());
});
caches.keys().then(names => {
  names.forEach(name => caches.delete(name));
});
```

## 📝 License

MIT License - [Homelabs.club](https://homelabs.club)

---

**Made with ❤️ for the home lab community**
