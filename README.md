# HomePiNAS v1.5.0

Premium NAS Dashboard for Raspberry Pi CM5 - Security Hardened Edition

## Features

- **SnapRAID + MergerFS** - Disk pooling with parity protection
- **Samba Sharing** - Network file sharing with automatic user creation
- **Docker Management** - Container control from dashboard
- **Fan Control** - PWM control for EMC2305 (Silent/Balanced/Performance)
- **System Monitoring** - CPU, Memory, Disk, Network stats
- **DDNS Support** - Cloudflare, No-IP, DuckDNS

## Security Features (v1.5.0)

- Bcrypt password hashing (12 rounds)
- Session-based authentication with expiration
- Rate limiting protection
- Helmet security headers
- Input sanitization for shell commands
- Restricted sudoers configuration
- HTTPS support with self-signed certificates

## Quick Install

```bash
curl -fsSL https://raw.githubusercontent.com/juanlusoft/homepinas-v2/main/install.sh | sudo bash
```

## Requirements

- Raspberry Pi CM5 (or compatible ARM64 device)
- Raspberry Pi OS Bookworm (64-bit)
- At least 2 disks for SnapRAID (1 data + 1 parity)

## Access

- Dashboard: `https://<IP>:3001`
- SMB Share: `\\<IP>\Storage`

## Version History

- **1.5.0** - Security hardened edition
  - Fixed command injection vulnerabilities
  - Secure Samba password handling
  - Restricted sudoers permissions
  - HTTPS with self-signed certificates
  - SQLite session persistence
  - Fan control hysteresis

## License

MIT
