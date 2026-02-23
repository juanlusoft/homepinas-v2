# HomePiNAS Recovery USB Builder

Bootable recovery system for HomePiNAS Active Backup restore operations.

## Features

- **Ubuntu 24.04 LTS with HWE kernel (6.8)** — Latest hardware support
- **BIOS + UEFI boot** — Works on modern machines (Lenovo M90q, Minisforum, Dell, HP, etc.)
- **Automatic network discovery** — DHCP + mDNS for NAS detection
- **Interactive TUI** — Dialog-based restore tool
- **Wide filesystem support** — NTFS, ext4, btrfs, xfs, FAT32
- **Image restore tools** — wimtools, partclone, dd, rsync
- **Hardware-agnostic** — Includes broad driver/firmware support

## Building

### Prerequisites

```bash
sudo apt-get install debootstrap xorriso isolinux syslinux-utils \
    squashfs-tools grub-pc-bin grub-efi-amd64-bin mtools dosfstools
```

### Build the ISO

```bash
sudo ./build-recovery-iso.sh
```

Output: `homepinas-recovery.iso` (~800MB)

The script will:
1. Bootstrap Ubuntu 24.04 LTS rootfs
2. Install recovery tools and TUI
3. Create squashfs filesystem
4. Generate BIOS (ISOLINUX) and UEFI (GRUB EFI) boot loaders
5. Package as hybrid ISO (bootable from USB via `dd` or Ventoy)

## Writing to USB

### Method 1: Direct `dd` (Hybrid)
```bash
# Find your USB device
lsblk

# Write (replace sdX with your device, e.g. sdb)
sudo dd if=homepinas-recovery.iso of=/dev/sdX bs=4M status=progress && sync
```

### Method 2: Ventoy (Recommended)
```bash
# Mount Ventoy USB, copy ISO
cp homepinas-recovery.iso /mnt/ventoy/
```

### Method 3: Etcher/Other tools
- Balena Etcher
- GNOME Disks
- Rufus (Windows)

## Booting

### BIOS/Legacy Boot
- Plug USB and select boot device (F12, Del, Esc during startup)
- Select USB device
- Choose recovery option from ISOLINUX menu

### UEFI Boot
- Enable UEFI in firmware
- Disable Secure Boot (or enroll custom key)
- Plug USB and select UEFI boot device
- Choose recovery option from GRUB menu

### Safe Mode
- If GPU issues occur, boot "Safe Mode (no GPU)" option
- Disables X11, uses framebuffer

## Boot Options

| Option | Purpose |
|--------|---------|
| HomePiNAS Recovery System | Standard recovery (with GUI) |
| Safe Mode | Framebuffer-only, no GPU drivers |
| Shell | Direct command line (skip TUI) |

## Kernel & Hardware

- **Kernel**: Ubuntu 24.04 HWE (6.8+)
- **CPU microcode**: intel-microcode + amd64-microcode included
- **Firmware**: Full linux-firmware package
- **Network**: NetworkManager + systemd-resolved
- **NAS discovery**: avahi-daemon + mDNS queries

## Filesystem Support

**Built-in tools:**
- `wimtools` — WIM image restore (Windows backups)
- `partclone` — Block-level imaging
- `dd` — Raw disk imaging
- `rsync` — File-level sync
- `ntfs-3g` — NTFS read/write
- `btrfs-tools` — Btrfs operations
- `xfsprogs` — XFS tools
- `e2fsprogs` — ext2/3/4 tools

## TUI Features

The `homepinas-restore` TUI provides:
1. **NAS discovery** — mDNS + avahi
2. **Backup selection** — List available backups by device/date
3. **Restore wizard** — Step-by-step restore (disk selection, verification)
4. **Progress monitoring** — Real-time progress bars
5. **Error recovery** — Retry on failures
6. **Log export** — Save logs to USB for debugging

## Customization

### Adding tools to the ISO

Edit `build-recovery-iso.sh` and add to the chroot install section:

```bash
sudo chroot "${ROOTFS}" /bin/bash -c "
    apt-get update
    apt-get install -y your-package-here
    apt-get clean
"
```

### Changing boot messages

Edit the MOTD banner and GRUB/ISOLINUX configs in the script.

### Language/Locale

Currently uses en_US.UTF-8 (ASCII-safe). To change:

```bash
# In the script, modify:
echo "LANG=YOUR_LOCALE.UTF-8" | sudo tee "${ROOTFS}/etc/default/locale"
```

## Troubleshooting

### ISO won't boot on UEFI
- Check Secure Boot is disabled in firmware
- Try Safe Mode option
- Verify USB was written completely (`lsblk` after writing)

### Network not detected
- Check DHCP server running on network
- Try manual network config in TUI
- Check firmware/network driver support

### Can't find NAS
- Ensure NAS and recovery machine are on same subnet
- Check NAS mDNS is enabled (avahi-daemon running)
- Try manual IP entry in TUI

### Out of memory during restore
- Reduce squashfs compression (edit script)
- Use smaller image files
- Increase RAM in system

## ISO Details

- **Size**: ~800MB
- **Filesystem**: Hybrid MBR/GPT
- **Boot loaders**: ISOLINUX (BIOS) + GRUB EFI (UEFI)
- **Kernel**: Ubuntu 24.04 HWE (6.8+)
- **Init system**: systemd
- **Live tools**: live-boot, live-config

## Version

- **Builder version**: 2.0 (Ubuntu 24.04 HWE)
- **Recovery TUI**: v1.0
- **Release date**: 2026-02-23

## License

Same as HomePiNAS project

## See also

- [HomePiNAS Documentation](https://homelabs.club)
- [Active Backup Guide](../docs/active-backup.md)
- [NAS Discovery](nas-discover.sh)
- [Restore Tool](homepinas-restore.sh)
