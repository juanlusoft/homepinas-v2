#!/bin/bash

# HomePiNAS - Raspberry Pi OS Image Customizer
# This script customizes a Raspberry Pi OS image to auto-install HomePiNAS on first boot
#
# Usage: sudo ./customize-image.sh <path-to-rpi-image.img>

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${BLUE}=========================================${NC}"
echo -e "${BLUE}  HomePiNAS Image Customizer v2.0       ${NC}"
echo -e "${BLUE}  Homelabs.club Edition                 ${NC}"
echo -e "${BLUE}=========================================${NC}"

# Check for root
if [ "$EUID" -ne 0 ]; then
    echo -e "${RED}Please run as root (use sudo)${NC}"
    exit 1
fi

# Check arguments
if [ -z "$1" ]; then
    echo -e "${RED}Usage: sudo $0 <path-to-rpi-image.img>${NC}"
    echo -e "${YELLOW}Example: sudo $0 2024-03-15-raspios-bookworm-arm64.img${NC}"
    exit 1
fi

IMAGE_FILE="$1"

if [ ! -f "$IMAGE_FILE" ]; then
    echo -e "${RED}Image file not found: $IMAGE_FILE${NC}"
    exit 1
fi

# Check if image is compressed
if [[ "$IMAGE_FILE" == *.xz ]]; then
    echo -e "${BLUE}Decompressing image...${NC}"
    xz -dk "$IMAGE_FILE"
    IMAGE_FILE="${IMAGE_FILE%.xz}"
fi

if [[ "$IMAGE_FILE" == *.zip ]]; then
    echo -e "${BLUE}Extracting image...${NC}"
    unzip -o "$IMAGE_FILE"
    IMAGE_FILE=$(ls -1 *.img 2>/dev/null | head -1)
fi

echo -e "${BLUE}Working with image: $IMAGE_FILE${NC}"

# Create mount points
MOUNT_BOOT="/mnt/rpi-boot"
MOUNT_ROOT="/mnt/rpi-root"

# Cleanup function
cleanup() {
    echo -e "${BLUE}Cleaning up...${NC}"
    umount "$MOUNT_BOOT" 2>/dev/null || true
    umount "$MOUNT_ROOT" 2>/dev/null || true
    # Remove kpartx mappings if any
    kpartx -d "$IMAGE_FILE" 2>/dev/null || true
    # Detach any loop devices for this image
    for loop in $(losetup -j "$IMAGE_FILE" 2>/dev/null | cut -d: -f1); do
        losetup -d "$loop" 2>/dev/null || true
    done
    losetup -D 2>/dev/null || true
}

# Cleanup on error only (not on success, we handle that manually)
trap 'cleanup; exit 1' ERR

# Cleanup any existing loop devices before starting
echo -e "${BLUE}Cleaning up any existing loop devices...${NC}"
cleanup

mkdir -p "$MOUNT_BOOT" "$MOUNT_ROOT"

# Setup loop device with partitions using losetup
echo -e "${BLUE}Setting up loop device...${NC}"
LOOP_DEV=$(losetup -f --show -P "$IMAGE_FILE")
echo -e "${GREEN}Loop device: $LOOP_DEV${NC}"

# Wait for partition devices to appear
sleep 1

# Find partition devices
BOOT_PART="${LOOP_DEV}p1"
ROOT_PART="${LOOP_DEV}p2"

if [ ! -b "$BOOT_PART" ] || [ ! -b "$ROOT_PART" ]; then
    echo -e "${RED}Partition devices not found. Trying kpartx...${NC}"
    kpartx -av "$IMAGE_FILE"
    sleep 1
    # kpartx creates /dev/mapper/loopXp1, /dev/mapper/loopXp2
    LOOP_NAME=$(basename "$LOOP_DEV")
    BOOT_PART="/dev/mapper/${LOOP_NAME}p1"
    ROOT_PART="/dev/mapper/${LOOP_NAME}p2"
fi

echo -e "${GREEN}Boot partition: $BOOT_PART${NC}"
echo -e "${GREEN}Root partition: $ROOT_PART${NC}"

# Mount partitions
echo -e "${BLUE}Mounting partitions...${NC}"
mount "$BOOT_PART" "$MOUNT_BOOT"
mount "$ROOT_PART" "$MOUNT_ROOT"

echo -e "${GREEN}Partitions mounted${NC}"

# Create the first-boot installation script
echo -e "${BLUE}Adding HomePiNAS first-boot installer...${NC}"

cat > "$MOUNT_ROOT/opt/homepinas-firstboot.sh" << 'FIRSTBOOT'
#!/bin/bash

# HomePiNAS First Boot Installer
# This script runs once on first boot to install HomePiNAS

LOG="/var/log/homepinas-firstboot.log"
MARKER="/opt/.homepinas-installed"

# Only run if not already installed
if [ -f "$MARKER" ]; then
    exit 0
fi

exec > >(tee -a "$LOG") 2>&1

echo "========================================"
echo "HomePiNAS First Boot Installer"
echo "Started: $(date)"
echo "========================================"

# Wait for network
echo "Waiting for network..."
for i in {1..30}; do
    if ping -c 1 github.com &>/dev/null; then
        echo "Network available"
        break
    fi
    sleep 2
done

# Run the HomePiNAS installer
echo "Starting HomePiNAS installation..."
curl -fsSL https://raw.githubusercontent.com/juanlusoft/homepinas-v2/main/install.sh | bash

# Mark as installed
if [ $? -eq 0 ]; then
    touch "$MARKER"
    echo "HomePiNAS installed successfully"

    # Disable this service
    systemctl disable homepinas-firstboot.service

    echo "First boot setup complete. Rebooting in 10 seconds..."
    sleep 10
    reboot
else
    echo "Installation failed. Will retry on next boot."
fi
FIRSTBOOT

chmod +x "$MOUNT_ROOT/opt/homepinas-firstboot.sh"

# Create systemd service for first boot
cat > "$MOUNT_ROOT/etc/systemd/system/homepinas-firstboot.service" << 'SERVICE'
[Unit]
Description=HomePiNAS First Boot Installer
After=network-online.target
Wants=network-online.target
ConditionPathExists=!/opt/.homepinas-installed

[Service]
Type=oneshot
ExecStart=/opt/homepinas-firstboot.sh
RemainAfterExit=yes
StandardOutput=journal+console
StandardError=journal+console

[Install]
WantedBy=multi-user.target
SERVICE

# Enable the service
ln -sf /etc/systemd/system/homepinas-firstboot.service "$MOUNT_ROOT/etc/systemd/system/multi-user.target.wants/homepinas-firstboot.service"

# Optional: Pre-configure some settings
echo -e "${BLUE}Configuring default settings...${NC}"

# Enable SSH by default
touch "$MOUNT_BOOT/ssh"
echo -e "${GREEN}SSH enabled${NC}"

# Set default hostname
echo "homepinas" > "$MOUNT_ROOT/etc/hostname"
sed -i 's/raspberrypi/homepinas/g' "$MOUNT_ROOT/etc/hosts" 2>/dev/null || true
echo -e "${GREEN}Hostname set to 'homepinas'${NC}"

# Configure locale (optional)
echo "LANG=en_US.UTF-8" > "$MOUNT_ROOT/etc/default/locale"

# Unmount partitions
echo -e "${BLUE}Unmounting partitions...${NC}"
sync
umount "$MOUNT_BOOT"
umount "$MOUNT_ROOT"

# Detach loop device
echo -e "${BLUE}Detaching loop device...${NC}"
kpartx -d "$IMAGE_FILE" 2>/dev/null || true
if [ -n "$LOOP_DEV" ]; then
    losetup -d "$LOOP_DEV" 2>/dev/null || true
fi

rmdir "$MOUNT_BOOT" "$MOUNT_ROOT" 2>/dev/null || true

# Rename output image
OUTPUT_IMAGE="${IMAGE_FILE%.img}-homepinas.img"
mv "$IMAGE_FILE" "$OUTPUT_IMAGE"

echo -e "${GREEN}=========================================${NC}"
echo -e "${GREEN}  Image customization complete!         ${NC}"
echo -e "${GREEN}=========================================${NC}"
echo ""
echo -e "${YELLOW}Output image: ${GREEN}$OUTPUT_IMAGE${NC}"
echo ""
echo -e "${YELLOW}Next steps:${NC}"
echo -e "1. Flash the image to an SD card:"
echo -e "   ${BLUE}sudo dd if=$OUTPUT_IMAGE of=/dev/sdX bs=4M status=progress${NC}"
echo -e "   Or use Raspberry Pi Imager / balenaEtcher"
echo ""
echo -e "2. Insert SD card into Raspberry Pi and power on"
echo ""
echo -e "3. HomePiNAS will install automatically on first boot"
echo -e "   (This takes 5-10 minutes depending on internet speed)"
echo ""
echo -e "4. Access dashboard at: ${GREEN}https://<raspberry-ip>:3001${NC}"
echo ""
