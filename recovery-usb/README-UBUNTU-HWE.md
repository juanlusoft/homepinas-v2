# HomePiNAS Recovery USB - Ubuntu 24.04 HWE Edition

This is the Ubuntu 24.04 HWE (Hardware Enablement) kernel version of the HomePiNAS recovery ISO.

## Why Ubuntu 24.04 HWE?

The original Debian 12 kernel (6.1) lacks drivers for modern NICs like Intel i219-V, preventing automatic network configuration on newer systems (Lenovo M90q, Minisforum, Dell, HP recent models).

**Ubuntu 24.04 HWE provides kernel 6.8** with comprehensive driver support for:
- Intel i219-V, i219-LM
- Realtek RTL8111/8168
- Modern AMD/Intel chipset drivers
- Current NIC firmware

## Building the ISO

### Prerequisites

The build script requires these packages:
```bash
sudo apt-get install debootstrap xorriso isolinux syslinux-utils \
    squashfs-tools grub-pc-bin grub-efi-amd64-bin mtools
```

### Build

From the `recovery-usb/` directory:

```bash
sudo ./build-recovery-iso-ubuntu.sh
```

The script will:
1. Bootstrap a minimal Ubuntu 24.04 (noble) rootfs
2. Install kernel HWE 6.8 + drivers + firmware
3. Install recovery tools (wimtools, partclone, ntfs-3g, etc.)
4. Copy HomePiNAS recovery scripts
5. Build a hybrid BIOS+UEFI ISO
6. Output: `homepinas-recovery.iso` in the same directory

**Build time:** ~15-20 minutes (depending on internet speed)
**ISO size:** ~800MB-1GB

## Flashing to USB

### Option 1: dd (direct write)

```bash
# Find your USB device
lsblk

# Write the ISO (replace sdX with your device)
sudo dd if=homepinas-recovery.iso of=/dev/sdX bs=4M status=progress && sync
```

### Option 2: Ventoy (recommended)

1. Install Ventoy on your USB: https://www.ventoy.net/
2. Copy `homepinas-recovery.iso` to the Ventoy partition
3. Boot from the USB

The ISO is fully hybrid and works with both methods.

## Booting

### UEFI
- The USB will appear in UEFI boot menu as a UEFI option
- Select and boot

### BIOS (Legacy)
- The USB will appear as a bootable device
- Select and boot

### Auto-boot
The recovery system will:
1. Automatically configure network (DHCP)
2. Auto-discover HomePiNAS on the network
3. Launch the recovery TUI

If the TUI doesn't appear, type:
```
homepinas-restore
```

## ASCII vs Non-ASCII Scripts

Two versions of the recovery scripts are provided:

### Original (non-ASCII)
- `homepinas-restore.sh` — includes emojis and special characters
- `nas-discover.sh` — includes box-drawing characters

### ASCII-only versions (recommended for compatibility)
- `homepinas-restore-ascii.sh` — ASCII only, same functionality
- `nas-discover-ascii.sh` — ASCII only, same functionality

The build script automatically uses the `-ascii.sh` versions if they exist.

**All characters outside ASCII range are replaced:**
- Emojis: 🏠 → [HOME], ❌ → [ERROR], ✓ → [OK], etc.
- Box drawing: ║ → |, ═ → =, etc.
- Special chars: — → --, ü/ñ/é → u/n/e, etc.

## Testing (without flashing to USB)

### QEMU UEFI Test

```bash
# Install QEMU
sudo apt-get install qemu-system-x86 ovmf

# Boot ISO in QEMU (UEFI)
qemu-system-x86_64 \
    -bios /usr/share/OVMF/OVMF_CODE.fd \
    -cdrom homepinas-recovery.iso \
    -m 2048 \
    -enable-kvm \
    -net nic,model=e1000 \
    -net user,hostfwd=tcp:127.0.0.1:3001-:3001
```

### QEMU BIOS Test

```bash
qemu-system-x86_64 \
    -cdrom homepinas-recovery.iso \
    -m 2048 \
    -enable-kvm \
    -net nic,model=e1000 \
    -net user
```

### What to check

1. **Boot sequence** — does it boot in both UEFI and BIOS?
2. **Network** — does NetworkManager detect and configure network automatically?
3. **NAS discovery** — can it find the HomePiNAS server?
4. **TUI** — does the recovery menu appear?
5. **Tools present** — partclone, wimlib, cifs-utils, parted, etc.

## Hardware tested

✓ Lenovo M90q G3 (i5-12500)
✓ Minisforum M1 Pro (Ultra 9 285)
✓ Dell OptiPlex (various generations)
✓ HP ProDesk

## Files

- `build-recovery-iso-ubuntu.sh` — Build script (Ubuntu 24.04 HWE)
- `homepinas-restore.sh` — Recovery TUI (original with emojis)
- `homepinas-restore-ascii.sh` — Recovery TUI (ASCII-only)
- `nas-discover.sh` — NAS discovery tool (original)
- `nas-discover-ascii.sh` — NAS discovery tool (ASCII-only)
- `README-UBUNTU-HWE.md` — This file

## Troubleshooting

### ISO doesn't boot
- Verify ISO checksum: `sha256sum homepinas-recovery.iso`
- Try the dd method instead of Ventoy
- Ensure USB is fully written: `sudo sync`

### Network not detected
- Check NIC is recognized: `lspci | grep -i ethernet`
- Check DHCP is working: `dhclient -v eth0` (after logging in)
- Check WiFi is not being used (recovery ISO has no WiFi support)

### Recovery TUI doesn't appear
- Log in as root (password: `homepinas`)
- Type `homepinas-restore`

### NAS not discovered
- Verify NAS is on the same network
- Verify NAS is reachable: `ping <nas-ip>`
- Check NAS is running HomePiNAS service

## Changelog

### v2.0 (Ubuntu 24.04 HWE)
- **New:** Ubuntu 24.04 base with HWE kernel 6.8
- **New:** Support for modern NICs (i219-V, etc.)
- **New:** ASCII-only versions of scripts for compatibility
- **New:** Hybrid BIOS+UEFI ISO with Ventoy support
- **Fixed:** Network configuration on modern systems
- **Fixed:** Encoding issues with non-ASCII characters

### v1.0 (Debian 12)
- Initial release with Debian bookworm
- Kernel 6.1 (limited NIC support)
- Limited to legacy BIOS on some systems

---

**HomePiNAS Recovery System** - Backup & Recovery Made Simple  
For more info: https://github.com/juanlusoft/homepinas-v2
