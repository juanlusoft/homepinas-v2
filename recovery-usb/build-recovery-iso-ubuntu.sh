#!/bin/bash
###############################################################################
# HomePiNAS Recovery USB Builder (Ubuntu 24.04 HWE)
# Generates a bootable ISO with automatic NAS detection and backup restore
# Based on Ubuntu 24.04 (Noble) with HWE kernel 6.8 for modern hardware support
###############################################################################

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BUILD_DIR="/home/juanlu/homepinas-recovery-build"
ISO_OUTPUT="${SCRIPT_DIR}/homepinas-recovery.iso"
WORK_DIR="${BUILD_DIR}/work"
ROOTFS="${BUILD_DIR}/rootfs"
ISO_DIR="${BUILD_DIR}/iso"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log() { echo -e "${GREEN}[HomePiNAS]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

###############################################################################
# Check dependencies
###############################################################################
check_deps() {
    log "Checking build dependencies..."
    local deps=(debootstrap xorriso isolinux syslinux-utils squashfs-tools grub-pc-bin grub-efi-amd64-bin mtools)
    local missing=()
    
    for dep in "${deps[@]}"; do
        if ! dpkg -l "$dep" &>/dev/null; then
            missing+=("$dep")
        fi
    done
    
    if [ ${#missing[@]} -gt 0 ]; then
        log "Installing missing packages: ${missing[*]}"
        sudo apt-get update
        sudo apt-get install -y "${missing[@]}"
    fi
}

###############################################################################
# Build minimal Ubuntu rootfs with HWE kernel
###############################################################################
build_rootfs() {
    log "Building minimal Ubuntu 24.04 (Noble) rootfs with HWE kernel..."
    
    rm -rf "${ROOTFS}"
    mkdir -p "${ROOTFS}"
    
    # Bootstrap minimal Ubuntu 24.04 (noble) with HWE kernel
    # HWE kernel is linux-image-generic-hwe-24.04 which provides 6.8+
    sudo debootstrap --arch=amd64 --variant=minbase \
        --include=linux-image-generic-hwe-24.04,linux-modules-generic-hwe-24.04,live-boot,systemd-sysv \
        noble "${ROOTFS}" http://archive.ubuntu.com/ubuntu
    
    # Install required packages inside chroot
    sudo chroot "${ROOTFS}" /bin/bash -c "
        export DEBIAN_FRONTEND=noninteractive
        apt-get update
        apt-get install -y --no-install-recommends \
            network-manager \
            avahi-utils \
            cifs-utils \
            nfs-common \
            ntfs-3g \
            partclone \
            parted \
            gdisk \
            dosfstools \
            e2fsprogs \
            btrfs-progs \
            xfsprogs \
            pv \
            gzip \
            pigz \
            dialog \
            curl \
            jq \
            openssh-client \
            rsync \
            efibootmgr \
            grub-efi-amd64-bin \
            grub-pc-bin \
            wimtools \
            pciutils \
            usbutils \
            dmidecode \
            hdparm \
            smartmontools \
            less \
            nano \
            linux-firmware
        
        # Clean up to reduce size
        apt-get clean
        rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*
    "
    
    log "Rootfs built successfully with Ubuntu 24.04 HWE kernel 6.8"
}

###############################################################################
# Install HomePiNAS recovery scripts into rootfs
###############################################################################
install_recovery_scripts() {
    log "Installing HomePiNAS recovery scripts..."
    
    # Copy the TUI recovery tool (should be ASCII-cleaned version)
    if [ -f "${SCRIPT_DIR}/homepinas-restore-ascii.sh" ]; then
        RESTORE_SCRIPT="${SCRIPT_DIR}/homepinas-restore-ascii.sh"
    else
        RESTORE_SCRIPT="${SCRIPT_DIR}/homepinas-restore.sh"
        warn "Using homepinas-restore.sh (non-ASCII version found, consider using homepinas-restore-ascii.sh)"
    fi
    
    sudo cp "$RESTORE_SCRIPT" "${ROOTFS}/usr/local/bin/homepinas-restore"
    sudo chmod +x "${ROOTFS}/usr/local/bin/homepinas-restore"
    
    # Copy the NAS discovery script
    if [ -f "${SCRIPT_DIR}/nas-discover-ascii.sh" ]; then
        DISCOVER_SCRIPT="${SCRIPT_DIR}/nas-discover-ascii.sh"
    else
        DISCOVER_SCRIPT="${SCRIPT_DIR}/nas-discover.sh"
        warn "Using nas-discover.sh (non-ASCII version found, consider using nas-discover-ascii.sh)"
    fi
    
    sudo cp "$DISCOVER_SCRIPT" "${ROOTFS}/usr/local/bin/nas-discover"
    sudo chmod +x "${ROOTFS}/usr/local/bin/nas-discover"
    
    # Auto-start recovery tool on login
    sudo tee "${ROOTFS}/etc/profile.d/homepinas-recovery.sh" > /dev/null << 'PROFILE'
#!/bin/bash
# Auto-launch HomePiNAS Recovery on first terminal
if [ "$(tty)" = "/dev/tty1" ] && [ -z "$HOMEPINAS_STARTED" ]; then
    export HOMEPINAS_STARTED=1
    clear
    /usr/local/bin/homepinas-restore
fi
PROFILE
    sudo chmod +x "${ROOTFS}/etc/profile.d/homepinas-recovery.sh"
    
    # Auto-login on tty1
    sudo mkdir -p "${ROOTFS}/etc/systemd/system/getty@tty1.service.d"
    sudo tee "${ROOTFS}/etc/systemd/system/getty@tty1.service.d/autologin.conf" > /dev/null << 'AUTOLOGIN'
[Service]
ExecStart=
ExecStart=-/sbin/agetty --autologin root --noclear %I $TERM
AUTOLOGIN
    
    # Set hostname
    echo "homepinas-recovery" | sudo tee "${ROOTFS}/etc/hostname" > /dev/null
    
    # Enable NetworkManager
    sudo chroot "${ROOTFS}" systemctl enable NetworkManager
    
    # Set root password
    sudo chroot "${ROOTFS}" /bin/bash -c "echo 'root:homepinas' | chpasswd"
    
    # Set locale (C for ASCII compatibility)
    echo "LANG=C.UTF-8" | sudo tee "${ROOTFS}/etc/default/locale" > /dev/null
    
    # Splash banner (ASCII-only)
    sudo tee "${ROOTFS}/etc/motd" > /dev/null << 'MOTD'

====================================================================
                                                               
  HomePiNAS Recovery System v2.0 (Ubuntu 24.04 HWE)
                                                               
  Backup recovery tool for HomePiNAS
  Connects to your NAS automatically
                                                               
  Type 'homepinas-restore' if the menu does not appear
                                                               
====================================================================

MOTD
    
    log "Recovery scripts installed"
}

###############################################################################
# Build ISO with BIOS + UEFI boot support
###############################################################################
build_iso() {
    log "Building bootable ISO..."
    
    rm -rf "${ISO_DIR}"
    mkdir -p "${ISO_DIR}"/{boot/grub,isolinux,live,EFI/boot}
    
    # Create squashfs
    log "Compressing rootfs into squashfs..."
    sudo mksquashfs "${ROOTFS}" "${ISO_DIR}/live/filesystem.squashfs" \
        -comp xz -b 1M -Xdict-size 100%
    
    # Copy kernel and initramfs
    VMLINUZ=$(ls "${ROOTFS}"/boot/vmlinuz-* 2>/dev/null | sort -V | tail -1)
    INITRD=$(ls "${ROOTFS}"/boot/initrd.img-* 2>/dev/null | sort -V | tail -1)
    
    if [ -z "$VMLINUZ" ] || [ -z "$INITRD" ]; then
        error "Could not find kernel or initrd in rootfs"
    fi
    
    sudo cp "$VMLINUZ" "${ISO_DIR}/boot/vmlinuz"
    sudo cp "$INITRD" "${ISO_DIR}/boot/initrd.img"
    
    log "Kernel: $(basename $VMLINUZ)"
    log "Initrd: $(basename $INITRD)"
    
    # GRUB config (for UEFI) - ASCII only
    cat > /tmp/grub.cfg << 'GRUBCFG'
set timeout=5
set default=0

menuentry "HomePiNAS Recovery System" {
    linux /boot/vmlinuz boot=live components quiet splash
    initrd /boot/initrd.img
}

menuentry "HomePiNAS Recovery (Safe Mode)" {
    linux /boot/vmlinuz boot=live components nomodeset
    initrd /boot/initrd.img
}

menuentry "Shell (command line)" {
    linux /boot/vmlinuz boot=live components
    initrd /boot/initrd.img
}
GRUBCFG
    sudo cp /tmp/grub.cfg "${ISO_DIR}/boot/grub/grub.cfg"
    
    # ISOLINUX config (for BIOS) - ASCII only
    cat > /tmp/isolinux.cfg << 'ISOLINUXCFG'
UI vesamenu.c32
PROMPT 0
TIMEOUT 50
DEFAULT recovery

LABEL recovery
    MENU LABEL HomePiNAS Recovery System
    KERNEL /boot/vmlinuz
    APPEND initrd=/boot/initrd.img boot=live components quiet splash

LABEL safe
    MENU LABEL HomePiNAS Recovery (Safe Mode)
    KERNEL /boot/vmlinuz
    APPEND initrd=/boot/initrd.img boot=live components nomodeset

LABEL shell
    MENU LABEL Shell
    KERNEL /boot/vmlinuz
    APPEND initrd=/boot/initrd.img boot=live components
ISOLINUXCFG
    sudo cp /tmp/isolinux.cfg "${ISO_DIR}/isolinux/isolinux.cfg"
    
    # Copy ISOLINUX binaries
    sudo cp /usr/lib/ISOLINUX/isolinux.bin "${ISO_DIR}/isolinux/"
    sudo cp /usr/lib/syslinux/modules/bios/ldlinux.c32 "${ISO_DIR}/isolinux/"
    sudo cp /usr/lib/syslinux/modules/bios/vesamenu.c32 "${ISO_DIR}/isolinux/"
    sudo cp /usr/lib/syslinux/modules/bios/libcom32.c32 "${ISO_DIR}/isolinux/"
    sudo cp /usr/lib/syslinux/modules/bios/libutil.c32 "${ISO_DIR}/isolinux/"
    
    # Create EFI boot image
    log "Creating EFI boot image..."
    dd if=/dev/zero of="${ISO_DIR}/EFI/boot/efiboot.img" bs=1M count=10
    mkfs.vfat "${ISO_DIR}/EFI/boot/efiboot.img"
    EFIMNT=$(mktemp -d)
    sudo mount "${ISO_DIR}/EFI/boot/efiboot.img" "$EFIMNT"
    sudo mkdir -p "$EFIMNT/EFI/boot"
    sudo grub-mkimage -O x86_64-efi -o "$EFIMNT/EFI/boot/bootx64.efi" \
        -p /boot/grub \
        part_gpt part_msdos fat ext2 normal chain boot configfile linux \
        multiboot iso9660 gfxmenu gfxterm all_video loadenv search \
        search_fs_uuid search_fs_file search_label
    sudo cp /tmp/grub.cfg "$EFIMNT/EFI/boot/grub.cfg"
    sudo umount "$EFIMNT"
    rmdir "$EFIMNT"
    
    # Build final ISO
    log "Creating ISO image with hybrid BIOS+UEFI support..."
    xorriso -as mkisofs \
        -iso-level 3 \
        -full-iso9660-filenames \
        -volid "HOMEPINAS_RECOVERY" \
        -eltorito-boot isolinux/isolinux.bin \
        -eltorito-catalog isolinux/boot.cat \
        -no-emul-boot \
        -boot-load-size 4 \
        -boot-info-table \
        -isohybrid-mbr /usr/lib/ISOLINUX/isohdpfx.bin \
        -eltorito-alt-boot \
        -e EFI/boot/efiboot.img \
        -no-emul-boot \
        -isohybrid-gpt-basdat \
        -output "${ISO_OUTPUT}" \
        "${ISO_DIR}"
    
    ISO_SIZE=$(du -h "${ISO_OUTPUT}" | cut -f1)
    log "[OK] ISO created: ${ISO_OUTPUT} (${ISO_SIZE})"
    log ""
    log "To write to USB:"
    log "  sudo dd if=${ISO_OUTPUT} of=/dev/sdX bs=4M status=progress && sync"
    log ""
    log "To boot with Ventoy, copy the ISO to your Ventoy USB"
    log "Replace /dev/sdX with your USB drive device"
}

###############################################################################
# Cleanup
###############################################################################
cleanup() {
    log "Cleaning up build files..."
    sudo rm -rf "${BUILD_DIR}"
}

###############################################################################
# Main
###############################################################################
main() {
    echo ""
    echo "=========================================="
    echo " HomePiNAS Recovery USB Builder"
    echo " Ubuntu 24.04 HWE (Kernel 6.8)"
    echo "=========================================="
    echo ""
    
    if [ "$EUID" -ne 0 ]; then
        error "This script must be run as root (sudo)"
    fi
    
    check_deps
    build_rootfs
    install_recovery_scripts
    build_iso
    
    echo ""
    read -p "Clean up build files? [Y/n] " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]] || [[ -z $REPLY ]]; then
        cleanup
    fi
    
    log "[DONE] Flash the ISO to a USB drive and boot from it."
}

main "$@"
