#!/bin/bash
###############################################################################
# HomePiNAS Recovery USB Builder (Ubuntu 24.04 HWE)
# Generates a bootable ISO with automatic NAS detection and backup restore
# Supports BIOS + UEFI on modern hardware (Lenovo M90q, Minisforum, Dell, HP)
###############################################################################

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BUILD_DIR="/tmp/homepinas-recovery-build"
ISO_OUTPUT="${SCRIPT_DIR}/homepinas-recovery.iso"
WORK_DIR="${BUILD_DIR}/work"
ROOTFS="${BUILD_DIR}/rootfs"
ISO_DIR="${BUILD_DIR}/iso"
UBUNTU_RELEASE="noble"  # Ubuntu 24.04 LTS

# ASCII-safe colors
GREEN='[32m'
YELLOW='[33m'
RED='[31m'
CYAN='[36m'
RESET='[0m'

log() { echo "${GREEN}[HomePiNAS]${RESET} $1"; }
warn() { echo "${YELLOW}[WARN]${RESET} $1"; }
error() { echo "${RED}[ERROR]${RESET} $1"; exit 1; }

###############################################################################
# Check dependencies
###############################################################################
check_deps() {
    log "Checking build dependencies..."
    local deps=(debootstrap xorriso isolinux syslinux-utils squashfs-tools \
                grub-pc-bin grub-efi-amd64-bin mtools dosfstools)
    local missing=()
    
    for dep in "${deps[@]}"; do
        if ! dpkg -l | grep -q "^ii  $dep"; then
            missing+=("$dep")
        fi
    done
    
    if [ ${#missing[@]} -gt 0 ]; then
        log "Installing missing packages: ${missing[*]}"
        sudo apt-get update
        sudo apt-get install -y "${missing[@]}"
    fi
    
    if ! command -v mkisofs &>/dev/null && ! command -v xorriso &>/dev/null; then
        error "xorriso not found. Install with: sudo apt-get install xorriso"
    fi
}

###############################################################################
# Build Ubuntu 24.04 HWE rootfs
###############################################################################
build_rootfs() {
    log "Building Ubuntu 24.04 LTS rootfs with HWE kernel..."
    
    rm -rf "${ROOTFS}"
    mkdir -p "${ROOTFS}"
    
    # Bootstrap Ubuntu 24.04 noble
    sudo debootstrap --arch=amd64 --variant=minbase \
        --include=linux-image-generic-hwe-24.04 \
        "$UBUNTU_RELEASE" "${ROOTFS}" \
        http://archive.ubuntu.com/ubuntu/
    
    # Install required packages inside chroot
    sudo chroot "${ROOTFS}" /bin/bash -c "
        export DEBIAN_FRONTEND=noninteractive
        apt-get update
        apt-get install -y --no-install-recommends \
            linux-headers-generic-hwe-24.04 \
            live-boot \
            live-config \
            systemd-sysv \
            network-manager \
            avahi-daemon \
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
            lsb-release \
            less \
            nano \
            vim-tiny \
            firmware-linux-free \
            firmware-linux-nonfree \
            firmware-realtek \
            firmware-iwlwifi \
            firmware-atheros \
            firmware-brcm80211 \
            firmware-intel-sound \
            firmware-misc-nonfree \
            intel-microcode \
            amd64-microcode \
            systemd-container \
            util-linux
        
        # Update initramfs to detect hardware properly
        update-initramfs -u -k all
        
        # Clean up to reduce size
        apt-get clean
        apt-get autoclean
        rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/* /var/cache/apt/*
    "
    
    log "Rootfs built successfully with Ubuntu 24.04 HWE kernel"
}

###############################################################################
# Install HomePiNAS recovery scripts into rootfs
###############################################################################
install_recovery_scripts() {
    log "Installing HomePiNAS recovery scripts..."
    
    # Copy the TUI recovery tool
    sudo cp "${SCRIPT_DIR}/homepinas-restore.sh" "${ROOTFS}/usr/local/bin/homepinas-restore"
    sudo chmod +x "${ROOTFS}/usr/local/bin/homepinas-restore"
    
    # Copy the NAS discovery script
    sudo cp "${SCRIPT_DIR}/nas-discover.sh" "${ROOTFS}/usr/local/bin/nas-discover"
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
    
    # Auto-login on tty1 with systemd
    sudo mkdir -p "${ROOTFS}/etc/systemd/system/getty@tty1.service.d"
    sudo tee "${ROOTFS}/etc/systemd/system/getty@tty1.service.d/autologin.conf" > /dev/null << 'AUTOLOGIN'
[Service]
ExecStart=
ExecStart=-/sbin/agetty --autologin root --noclear %I $TERM
AUTOLOGIN
    
    # Set hostname
    echo "homepinas-recovery" | sudo tee "${ROOTFS}/etc/hostname" > /dev/null
    
    # Set hosts
    sudo tee "${ROOTFS}/etc/hosts" > /dev/null << 'HOSTS'
127.0.0.1   localhost
127.0.1.1   homepinas-recovery
::1         localhost ip6-localhost ip6-loopback
ff02::1     ip6-allnodes
ff02::2     ip6-allrouters
HOSTS
    
    # Enable services
    sudo chroot "${ROOTFS}" systemctl enable NetworkManager 2>/dev/null || true
    sudo chroot "${ROOTFS}" systemctl enable avahi-daemon 2>/dev/null || true
    sudo chroot "${ROOTFS}" systemctl enable systemd-resolved 2>/dev/null || true
    
    # Set root password (empty - auto-login anyway)
    sudo chroot "${ROOTFS}" /bin/bash -c "echo 'root:homepinas' | chpasswd"
    
    # Set locale to en_US.UTF-8 (ASCII safe)
    echo "LANG=en_US.UTF-8" | sudo tee "${ROOTFS}/etc/default/locale" > /dev/null
    sudo chroot "${ROOTFS}" locale-gen en_US.UTF-8 2>/dev/null || true
    
    # Splash banner (ASCII only)
    sudo tee "${ROOTFS}/etc/motd" > /dev/null << 'MOTD'

==============================================================

    HomePiNAS Recovery System v1.0

    Automatic NAS detection and backup restore

    Type 'homepinas-restore' if the menu does not appear

==============================================================

MOTD
    
    log "Recovery scripts installed"
}

###############################################################################
# Build ISO with BIOS + UEFI boot support
###############################################################################
build_iso() {
    log "Building bootable ISO (BIOS + UEFI)..."
    
    rm -rf "${ISO_DIR}"
    mkdir -p "${ISO_DIR}"/{boot/grub,isolinux,live,EFI/boot}
    
    # Create squashfs with xz compression
    log "Compressing rootfs into squashfs..."
    sudo mksquashfs "${ROOTFS}" "${ISO_DIR}/live/filesystem.squashfs" \
        -comp xz -b 1M -Xdict-size 100% -processors 4
    
    # Copy kernel and initramfs from the built rootfs
    VMLINUZ=$(sudo ls "${ROOTFS}"/boot/vmlinuz-* | sort -V | tail -1)
    INITRD=$(sudo ls "${ROOTFS}"/boot/initrd.img-* | sort -V | tail -1)
    
    if [ -z "$VMLINUZ" ] || [ -z "$INITRD" ]; then
        error "Could not find kernel or initramfs in rootfs"
    fi
    
    sudo cp "$VMLINUZ" "${ISO_DIR}/boot/vmlinuz"
    sudo cp "$INITRD" "${ISO_DIR}/boot/initrd.img"
    
    log "Using kernel: $(basename $VMLINUZ)"
    log "Using initramfs: $(basename $INITRD)"
    
    # GRUB config (UEFI + BIOS)
    cat > /tmp/grub.cfg << 'GRUBCFG'
set timeout=10
set default=0

menuentry "HomePiNAS Recovery System" {
    linux   /boot/vmlinuz boot=live components quiet splash
    initrd  /boot/initrd.img
}

menuentry "HomePiNAS Recovery (Safe Mode - no GPU)" {
    linux   /boot/vmlinuz boot=live components nomodeset
    initrd  /boot/initrd.img
}

menuentry "Shell (Command Line)" {
    linux   /boot/vmlinuz boot=live components
    initrd  /boot/initrd.img
}
GRUBCFG
    sudo cp /tmp/grub.cfg "${ISO_DIR}/boot/grub/grub.cfg"
    
    # ISOLINUX config (BIOS boot)
    cat > /tmp/isolinux.cfg << 'ISOLINUXCFG'
UI vesamenu.c32
PROMPT 0
TIMEOUT 100
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
    log "Setting up BIOS boot..."
    sudo cp /usr/lib/ISOLINUX/isolinux.bin "${ISO_DIR}/isolinux/" 2>/dev/null || \
        sudo cp /usr/lib/syslinux/isolinux.bin "${ISO_DIR}/isolinux/"
    sudo cp /usr/lib/syslinux/modules/bios/ldlinux.c32 "${ISO_DIR}/isolinux/"
    sudo cp /usr/lib/syslinux/modules/bios/vesamenu.c32 "${ISO_DIR}/isolinux/"
    sudo cp /usr/lib/syslinux/modules/bios/libcom32.c32 "${ISO_DIR}/isolinux/"
    sudo cp /usr/lib/syslinux/modules/bios/libutil.c32 "${ISO_DIR}/isolinux/"
    
    # Create EFI boot image
    log "Setting up UEFI boot..."
    dd if=/dev/zero of="${ISO_DIR}/EFI/boot/efiboot.img" bs=1M count=20
    mkfs.vfat "${ISO_DIR}/EFI/boot/efiboot.img"
    
    EFIMNT=$(mktemp -d)
    sudo mount -o loop "${ISO_DIR}/EFI/boot/efiboot.img" "$EFIMNT"
    
    sudo mkdir -p "$EFIMNT/EFI/boot"
    
    # Build GRUB EFI image
    sudo grub-mkimage -O x86_64-efi -o "$EFIMNT/EFI/boot/bootx64.efi" \
        -p "(hd0,gpt2)/boot/grub" \
        part_gpt part_msdos fat ext2 normal chain boot configfile linux \
        multiboot iso9660 gfxmenu gfxterm all_video loadenv search \
        search_fs_uuid search_fs_file search_label efi_gop efi_uga \
        2>/dev/null || \
    sudo grub-mkimage -O x86_64-efi -o "$EFIMNT/EFI/boot/bootx64.efi" \
        part_gpt fat ext2 normal boot linux iso9660
    
    sudo mkdir -p "$EFIMNT/boot/grub"
    sudo cp /tmp/grub.cfg "$EFIMNT/boot/grub/grub.cfg"
    
    # Create UEFI shell fallback
    sudo mkdir -p "$EFIMNT/efi/boot"
    sudo cp "$EFIMNT/EFI/boot/bootx64.efi" "$EFIMNT/efi/boot/bootx64.efi"
    
    sudo umount "$EFIMNT"
    rmdir "$EFIMNT"
    
    # Build final ISO with xorriso
    log "Creating hybrid ISO..."
    
    # Get paths for isohybrid
    ISOHYBRID_PATH="/usr/lib/ISOLINUX/isohdpfx.bin"
    if [ ! -f "$ISOHYBRID_PATH" ]; then
        ISOHYBRID_PATH="/usr/lib/syslinux/isohdpfx.bin"
    fi
    
    if [ ! -f "$ISOHYBRID_PATH" ]; then
        warn "isohybrid MBR not found, ISO will be UEFI/BIOS but not hybrid USB-bootable"
        HYBRID_OPT=""
    else
        HYBRID_OPT="-isohybrid-mbr $ISOHYBRID_PATH"
    fi
    
    xorriso -as mkisofs \
        -iso-level 3 \
        -full-iso9660-filenames \
        -volid "HOMEPINAS" \
        -eltorito-boot isolinux/isolinux.bin \
        -eltorito-catalog isolinux/boot.cat \
        -no-emul-boot \
        -boot-load-size 4 \
        -boot-info-table \
        $HYBRID_OPT \
        -eltorito-alt-boot \
        -e EFI/boot/efiboot.img \
        -no-emul-boot \
        -isohybrid-gpt-basdat \
        -output "${ISO_OUTPUT}" \
        "${ISO_DIR}"
    
    if [ $? -ne 0 ]; then
        error "Failed to create ISO"
    fi
    
    ISO_SIZE=$(du -h "${ISO_OUTPUT}" | cut -f1)
    log "ISO created: ${ISO_OUTPUT} (${ISO_SIZE})"
    log ""
    log "To write to USB:"
    log "  sudo dd if=${ISO_OUTPUT} of=/dev/sdX bs=4M status=progress && sync"
    log ""
    log "Or use Etcher, Ventoy, or similar tool"
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
    echo "=================================================="
    echo "  HomePiNAS Recovery USB Builder (Ubuntu 24.04)"
    echo "=================================================="
    echo ""
    
    if [ "$EUID" -ne 0 ]; then
        error "This script must be run as root (sudo build-recovery-iso.sh)"
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
    
    log "Recovery ISO ready for deployment!"
    log "Flash to USB and boot to recover backups from NAS"
}

main "$@"
