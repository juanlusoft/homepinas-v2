#!/bin/bash

# HomePiNAS - Raspberry Pi OS Image Customizer
# Customizes a Raspberry Pi OS image with HomePiNAS first-boot setup
#
# Usage: sudo ./customize-image.sh <path-to-rpi-image.img>

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
VERSION=$(grep '"version"' "$SCRIPT_DIR/../package.json" 2>/dev/null | head -1 | sed 's/.*: "\(.*\)".*/\1/' || echo "2.0.0")

echo -e "${BLUE}=========================================${NC}"
echo -e "${BLUE}  HomePiNAS Image Builder v$VERSION     ${NC}"
echo -e "${BLUE}  homelabs.club                         ${NC}"
echo -e "${BLUE}=========================================${NC}"

# Check for root
if [ "$EUID" -ne 0 ]; then
    echo -e "${RED}Please run as root (use sudo)${NC}"
    exit 1
fi

# Check arguments
if [ -z "$1" ]; then
    echo -e "${RED}Usage: sudo $0 <path-to-rpi-image.img>${NC}"
    echo -e "${YELLOW}Example: sudo $0 2024-03-15-raspios-bookworm-arm64-lite.img${NC}"
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

# Enable SSH
touch "$MOUNT_BOOT/ssh"
echo -e "${GREEN}✓ SSH enabled${NC}"

# Create directories
mkdir -p "$MOUNT_ROOT/usr/local/bin"
mkdir -p "$MOUNT_ROOT/etc/homepinas"
mkdir -p "$MOUNT_ROOT/etc/systemd/system/multi-user.target.wants"

# Copy firstboot.sh
echo -e "${BLUE}Installing firstboot.sh...${NC}"
cat > "$MOUNT_ROOT/usr/local/bin/homepinas-firstboot.sh" << 'FIRSTBOOT'
#!/bin/bash
# HomePiNAS Installer
# Instala el sistema desde USB a disco interno (eMMC, SSD, etc.)

set -e

FIRSTBOOT_MARKER="/etc/homepinas/.firstboot-done"
LOG="/var/log/homepinas-installer.log"

# Si ya se ejecutó, salir
if [[ -f "$FIRSTBOOT_MARKER" ]]; then
    exit 0
fi

exec > >(tee -a "$LOG") 2>&1
echo "=== HomePiNAS Installer - $(date) ==="

# Esperar a que el sistema esté listo
sleep 3

# Obtener disco de origen (donde estamos corriendo)
SOURCE_ROOT=$(findmnt -n -o SOURCE /)
SOURCE_DISK=$(lsblk -no PKNAME "$SOURCE_ROOT" 2>/dev/null || echo "")
if [[ -z "$SOURCE_DISK" ]]; then
    SOURCE_DISK=$(echo "$SOURCE_ROOT" | sed 's/[0-9]*$//' | sed 's/p$//')
fi
SOURCE_DISK="/dev/$SOURCE_DISK"

clear
echo ""
echo "  ╔═══════════════════════════════════════════════════════════╗"
echo "  ║                                                           ║"
echo "  ║   🏠 HomePiNAS - Instalador                               ║"
echo "  ║                                                           ║"
echo "  ╚═══════════════════════════════════════════════════════════╝"
echo ""
sleep 2

# Instalar dialog si no está
if ! command -v dialog &>/dev/null; then
    echo "Instalando herramientas..."
    apt-get update -qq && apt-get install -y -qq dialog parted rsync
fi

# Función para obtener discos disponibles (excluyendo el USB de origen)
get_available_disks() {
    local disks=""
    local count=0
    
    # Primero verificar eMMC
    if [[ -b /dev/mmcblk0 ]] && [[ "$SOURCE_DISK" != "/dev/mmcblk0" ]]; then
        local size=$(lsblk -dn -o SIZE /dev/mmcblk0 2>/dev/null || echo "??")
        disks="$disks /dev/mmcblk0 \"eMMC interno ($size) [RECOMENDADO]\" on"
        count=$((count+1))
    fi
    
    # Luego otros discos
    for disk in /dev/sd[a-z] /dev/nvme[0-9]n[0-9]; do
        [[ -b "$disk" ]] || continue
        [[ "$disk" == "$SOURCE_DISK" ]] && continue
        
        local size=$(lsblk -dn -o SIZE "$disk" 2>/dev/null || echo "??")
        local model=$(lsblk -dn -o MODEL "$disk" 2>/dev/null | xargs || echo "Disco")
        
        # Ignorar discos sin tamaño (vacíos/desconectados)
        [[ "$size" == "0B" ]] && continue
        
        if [[ $count -eq 0 ]]; then
            disks="$disks $disk \"$model ($size)\" on"
        else
            disks="$disks $disk \"$model ($size)\" off"
        fi
        count=$((count+1))
    done
    
    echo "$disks"
    return $count
}

# Pantalla de bienvenida
dialog --title "🏠 HomePiNAS Installer" --msgbox "\n¡Bienvenido al instalador de HomePiNAS!\n\nEste asistente instalará el sistema en el\ndisco interno de tu NAS.\n\nEl USB de instalación podrá retirarse\nuna vez completada la instalación." 14 55

# Obtener discos disponibles
DISK_OPTIONS=$(get_available_disks)
DISK_COUNT=$?

if [[ $DISK_COUNT -eq 0 ]] || [[ -z "$DISK_OPTIONS" ]]; then
    dialog --title "Error" --msgbox "\nNo se encontraron discos disponibles para instalar.\n\nAsegúrate de que el NAS tenga:\n  • eMMC interno, o\n  • Un SSD/HDD conectado" 12 55
    exit 1
fi

# Seleccionar disco destino
TARGET_DISK=$(eval "dialog --title 'Seleccionar Disco' --radiolist '\nSelecciona el disco donde instalar HomePiNAS:\n\n(El disco seleccionado será BORRADO)' 18 65 6 $DISK_OPTIONS" 3>&1 1>&2 2>&3)

if [[ -z "$TARGET_DISK" ]]; then
    dialog --title "Cancelado" --msgbox "Instalación cancelada." 7 40
    exit 1
fi

# Confirmar borrado
TARGET_SIZE=$(lsblk -dn -o SIZE "$TARGET_DISK" 2>/dev/null || echo "??")
dialog --title "⚠️ ADVERTENCIA" --yesno "\n¡ATENCIÓN!\n\nTodos los datos en:\n  $TARGET_DISK ($TARGET_SIZE)\n\nserán BORRADOS permanentemente.\n\n¿Continuar con la instalación?" 14 50

if [[ $? -ne 0 ]]; then
    dialog --title "Cancelado" --msgbox "Instalación cancelada." 7 40
    exit 1
fi

# Obtener particiones de origen
SOURCE_BOOT=$(findmnt -n -o SOURCE /boot/firmware 2>/dev/null || findmnt -n -o SOURCE /boot 2>/dev/null || echo "")

# Calcular tamaños
BOOT_SIZE=512  # MB
ROOT_SIZE=$(df -BM --output=used / | tail -1 | tr -d 'M ')
ROOT_SIZE=$((ROOT_SIZE + 500))  # +500MB margen

# Iniciar instalación
(
echo "10"; echo "# Preparando disco..."
sleep 1

# Desmontar particiones del disco destino si existen
umount ${TARGET_DISK}* 2>/dev/null || true
umount ${TARGET_DISK}p* 2>/dev/null || true

echo "20"; echo "# Creando tabla de particiones..."

# Crear tabla de particiones
parted -s "$TARGET_DISK" mklabel gpt
parted -s "$TARGET_DISK" mkpart primary fat32 1MiB ${BOOT_SIZE}MiB
parted -s "$TARGET_DISK" set 1 boot on
parted -s "$TARGET_DISK" mkpart primary ext4 ${BOOT_SIZE}MiB 100%

# Esperar a que aparezcan las particiones
sleep 2
partprobe "$TARGET_DISK" 2>/dev/null || true
sleep 2

# Determinar nombres de particiones
if [[ "$TARGET_DISK" == /dev/mmcblk* ]] || [[ "$TARGET_DISK" == /dev/nvme* ]]; then
    TARGET_BOOT="${TARGET_DISK}p1"
    TARGET_ROOT="${TARGET_DISK}p2"
else
    TARGET_BOOT="${TARGET_DISK}1"
    TARGET_ROOT="${TARGET_DISK}2"
fi

# Esperar a que las particiones existan
for i in {1..10}; do
    [[ -b "$TARGET_BOOT" ]] && [[ -b "$TARGET_ROOT" ]] && break
    sleep 1
    partprobe "$TARGET_DISK" 2>/dev/null || true
done

echo "30"; echo "# Formateando particiones..."

# Formatear
mkfs.vfat -F 32 -n BOOT "$TARGET_BOOT"
mkfs.ext4 -F -L rootfs "$TARGET_ROOT"

echo "40"; echo "# Montando particiones..."

# Montar destino
mkdir -p /mnt/target /mnt/target-boot
mount "$TARGET_ROOT" /mnt/target
mkdir -p /mnt/target/boot/firmware
mount "$TARGET_BOOT" /mnt/target/boot/firmware

echo "50"; echo "# Copiando sistema (esto tardará varios minutos)..."

# Copiar sistema con rsync
rsync -aAXH --info=progress2 \
    --exclude='/mnt/*' \
    --exclude='/proc/*' \
    --exclude='/sys/*' \
    --exclude='/dev/*' \
    --exclude='/run/*' \
    --exclude='/tmp/*' \
    --exclude='/var/tmp/*' \
    --exclude='/var/cache/apt/archives/*.deb' \
    --exclude='/lost+found' \
    / /mnt/target/ 2>/dev/null || true

echo "80"; echo "# Copiando partición de arranque..."

# Copiar boot
rsync -aAXH /boot/firmware/ /mnt/target/boot/firmware/

echo "85"; echo "# Configurando arranque..."

# Obtener UUIDs nuevos
NEW_BOOT_UUID=$(blkid -s UUID -o value "$TARGET_BOOT")
NEW_ROOT_UUID=$(blkid -s UUID -o value "$TARGET_ROOT")
NEW_ROOT_PARTUUID=$(blkid -s PARTUUID -o value "$TARGET_ROOT")

# Actualizar fstab
# Escribir fstab (evitar heredoc anidado)
echo "# HomePiNAS fstab" > /mnt/target/etc/fstab
echo "UUID=$NEW_ROOT_UUID  /               ext4    defaults,noatime  0  1" >> /mnt/target/etc/fstab
echo "UUID=$NEW_BOOT_UUID  /boot/firmware  vfat    defaults          0  2" >> /mnt/target/etc/fstab

# Actualizar cmdline.txt
sed -i "s|root=[^ ]*|root=PARTUUID=$NEW_ROOT_PARTUUID|" /mnt/target/boot/firmware/cmdline.txt

echo "90"; echo "# Creando directorios necesarios..."

# Crear directorios que excluimos
mkdir -p /mnt/target/{proc,sys,dev,run,tmp,mnt}
chmod 1777 /mnt/target/tmp

echo "95"; echo "# Finalizando..."

# Marcar instalación como completada
mkdir -p /mnt/target/etc/homepinas
touch /mnt/target/etc/homepinas/.installed-from-usb

# Desmontar
sync
umount /mnt/target/boot/firmware
umount /mnt/target

echo "100"; echo "# ¡Instalación completada!"

) | dialog --title "Instalando HomePiNAS" --gauge "\nPreparando instalación..." 10 60 0

# Éxito
dialog --title "✅ Instalación Completada" --msgbox "\n¡HomePiNAS se ha instalado correctamente!\n\nDisco: $TARGET_DISK\n\nAhora:\n  1. Retira el USB de instalación\n  2. El sistema se reiniciará automáticamente\n  3. Arrancará desde el disco interno" 14 55

# Marcar como completado en el USB también (para que no vuelva a ejecutar)
mkdir -p /etc/homepinas
touch "$FIRSTBOOT_MARKER"

# Limpiar pantalla
clear
echo ""
echo "  ✅ HomePiNAS instalado correctamente"
echo ""
echo "  Retira el USB y el sistema reiniciará en 10 segundos..."
echo ""

sleep 10
reboot
FIRSTBOOT

chmod +x "$MOUNT_ROOT/usr/local/bin/homepinas-firstboot.sh"
echo -e "${GREEN}✓ firstboot.sh instalado${NC}"

# Copy install-dashboard.sh
echo -e "${BLUE}Installing install-dashboard.sh...${NC}"
cat > "$MOUNT_ROOT/usr/local/bin/install-dashboard.sh" << 'INSTALLER'
#!/bin/bash
# HomePiNAS Dashboard Installer
# Descarga e instala la última versión del dashboard

set -e

REPO="juanlusoft/homepinas-v2"
INSTALL_DIR="/opt/homepinas"
LOG="/var/log/homepinas-install.log"
BRANCH="${1:-main}"

# Colores
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log() { echo -e "${GREEN}[HomePiNAS]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

exec > >(tee -a "$LOG") 2>&1

echo ""
echo "  ╔═══════════════════════════════════════════════════════════╗"
echo "  ║   🏠 HomePiNAS Dashboard Installer                        ║"
echo "  ╚═══════════════════════════════════════════════════════════╝"
echo ""

# Verificar root
if [[ $EUID -ne 0 ]]; then
    error "Este script debe ejecutarse como root (sudo)"
fi

# Verificar conexión a internet
log "Verificando conexión a internet..."
for i in {1..30}; do
    if ping -c 1 github.com &>/dev/null; then
        break
    fi
    echo "  Esperando red... ($i/30)"
    sleep 2
done

if ! ping -c 1 github.com &>/dev/null; then
    error "No hay conexión a internet. Verifica tu red."
fi

# Detectar arquitectura
ARCH=$(uname -m)
log "Arquitectura detectada: $ARCH"

# Instalar dependencias
log "Instalando dependencias del sistema..."
apt-get update -qq

DEPS="git curl wget nodejs npm dialog avahi-daemon samba mergerfs smartmontools hdparm parted gdisk lsof"

for dep in $DEPS; do
    if ! dpkg -s "$dep" &>/dev/null; then
        log "  Instalando $dep..."
        apt-get install -y -qq "$dep"
    fi
done

# Verificar versión de Node.js
NODE_VERSION=$(node -v 2>/dev/null | sed 's/v//' | cut -d. -f1)
if [[ -z "$NODE_VERSION" ]] || [[ "$NODE_VERSION" -lt 20 ]]; then
    log "Instalando Node.js 22..."
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
    apt-get install -y -qq nodejs
fi

log "Node.js: $(node -v), npm: $(npm -v)"

# Crear directorio de instalación
log "Preparando instalación en $INSTALL_DIR..."
mkdir -p "$INSTALL_DIR"

# Descargar última versión
if [[ -d "$INSTALL_DIR/.git" ]]; then
    log "Actualizando desde repositorio existente..."
    cd "$INSTALL_DIR"
    git fetch origin
    git checkout "$BRANCH"
    git pull origin "$BRANCH"
else
    log "Clonando repositorio..."
    rm -rf "$INSTALL_DIR"
    git clone -b "$BRANCH" "https://github.com/$REPO.git" "$INSTALL_DIR"
    cd "$INSTALL_DIR"
fi

# Obtener versión
VERSION=$(grep '"version"' package.json | head -1 | sed 's/.*: "\(.*\)".*/\1/')
log "Versión instalada: v$VERSION"

# Instalar dependencias npm
log "Instalando dependencias Node.js..."
cd "$INSTALL_DIR/backend"
npm install --omit=dev --silent

# Crear directorios necesarios
log "Creando estructura de directorios..."
mkdir -p /mnt/storage
mkdir -p /mnt/disks
mkdir -p /etc/homepinas
mkdir -p "$INSTALL_DIR/backend/config"

# Importar usuario del firstboot si existe
if [[ -f /etc/homepinas/setup.json ]]; then
    log "Importando configuración del primer arranque..."
    ADMIN_USER=$(grep adminUser /etc/homepinas/setup.json | sed 's/.*: "\(.*\)".*/\1/')
    if [[ -n "$ADMIN_USER" ]]; then
        log "  Usuario admin: $ADMIN_USER"
    fi
fi

# Generar certificado SSL si no existe
if [[ ! -f "$INSTALL_DIR/backend/config/server.crt" ]]; then
    log "Generando certificado SSL auto-firmado..."
    HOSTNAME=$(hostname)
    openssl req -x509 -nodes -days 3650 -newkey rsa:2048 \
        -keyout "$INSTALL_DIR/backend/config/server.key" \
        -out "$INSTALL_DIR/backend/config/server.crt" \
        -subj "/CN=$HOSTNAME/O=HomePiNAS/C=ES" \
        -addext "subjectAltName=DNS:$HOSTNAME,DNS:$HOSTNAME.local,DNS:localhost,IP:127.0.0.1" \
        -addext "keyUsage=digitalSignature,keyEncipherment" \
        -addext "extendedKeyUsage=serverAuth" 2>/dev/null
    chmod 600 "$INSTALL_DIR/backend/config/server.key"
fi

# Crear servicio systemd
log "Configurando servicio systemd..."
cat > /etc/systemd/system/homepinas.service << EOF
[Unit]
Description=HomePiNAS Dashboard
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=$INSTALL_DIR/backend
ExecStart=/usr/bin/node index.js
Restart=always
RestartSec=10
Environment=NODE_ENV=production
Environment=PORT=443

# Capabilities para puertos privilegiados
AmbientCapabilities=CAP_NET_BIND_SERVICE
CapabilityBoundingSet=CAP_NET_BIND_SERVICE

[Install]
WantedBy=multi-user.target
EOF

# Crear servicio redirect HTTP -> HTTPS
cat > /etc/systemd/system/homepinas-redirect.service << EOF
[Unit]
Description=HomePiNAS HTTP to HTTPS Redirect
After=network.target

[Service]
Type=simple
ExecStart=/usr/bin/node -e "require('http').createServer((q,r)=>{r.writeHead(301,{Location:'https://'+q.headers.host+q.url});r.end()}).listen(80)"
Restart=always

AmbientCapabilities=CAP_NET_BIND_SERVICE
CapabilityBoundingSet=CAP_NET_BIND_SERVICE

[Install]
WantedBy=multi-user.target
EOF

# Habilitar servicios
systemctl daemon-reload
systemctl enable homepinas.service
systemctl enable homepinas-redirect.service

# Configurar Avahi/mDNS
log "Configurando mDNS..."
mkdir -p /etc/avahi/services
cat > /etc/avahi/services/homepinas.service << EOF
<?xml version="1.0" standalone='no'?>
<!DOCTYPE service-group SYSTEM "avahi-service.dtd">
<service-group>
  <name replace-wildcards="yes">HomePiNAS on %h</name>
  <service>
    <type>_https._tcp</type>
    <port>443</port>
  </service>
  <service>
    <type>_homepinas._tcp</type>
    <port>443</port>
  </service>
</service-group>
EOF

systemctl restart avahi-daemon 2>/dev/null || true

# Deshabilitar este servicio de instalación
systemctl disable homepinas-install.service 2>/dev/null || true

# Iniciar servicio
log "Iniciando HomePiNAS..."
systemctl start homepinas.service
systemctl start homepinas-redirect.service

# Esperar a que arranque
sleep 3

# Verificar
if systemctl is-active --quiet homepinas.service; then
    echo ""
    echo "  ╔═══════════════════════════════════════════════════════════╗"
    echo "  ║   ✅ HomePiNAS instalado correctamente                    ║"
    echo "  ╚═══════════════════════════════════════════════════════════╝"
    echo ""
    echo "  Versión: v$VERSION"
    echo "  Dashboard: https://$(hostname).local"
    echo "  IP local:  https://$(hostname -I | awk '{print $1}')"
    echo ""
else
    error "El servicio no arrancó correctamente. Revisa: journalctl -u homepinas -n 50"
fi
INSTALLER

chmod +x "$MOUNT_ROOT/usr/local/bin/install-dashboard.sh"
echo -e "${GREEN}✓ install-dashboard.sh instalado${NC}"

# Create systemd service for firstboot
echo -e "${BLUE}Creating systemd services...${NC}"
cat > "$MOUNT_ROOT/etc/systemd/system/homepinas-firstboot.service" << 'SERVICE'
[Unit]
Description=HomePiNAS First Boot Setup
After=multi-user.target
ConditionPathExists=!/etc/homepinas/.firstboot-done

[Service]
Type=oneshot
ExecStart=/usr/local/bin/homepinas-firstboot.sh
StandardInput=tty
StandardOutput=tty
TTYPath=/dev/tty1
TTYReset=yes
TTYVHangup=yes
RemainAfterExit=no

[Install]
WantedBy=multi-user.target
SERVICE

# Create systemd service for dashboard install
cat > "$MOUNT_ROOT/etc/systemd/system/homepinas-install.service" << 'SERVICE'
[Unit]
Description=HomePiNAS Dashboard Auto-Install
After=network-online.target homepinas-firstboot.service
Wants=network-online.target
ConditionPathExists=/etc/homepinas/.firstboot-done
ConditionPathExists=!/opt/homepinas/backend/index.js

[Service]
Type=oneshot
ExecStart=/usr/local/bin/install-dashboard.sh
RemainAfterExit=yes
StandardOutput=journal+console
StandardError=journal+console

[Install]
WantedBy=multi-user.target
SERVICE

# Enable services
ln -sf /etc/systemd/system/homepinas-firstboot.service "$MOUNT_ROOT/etc/systemd/system/multi-user.target.wants/"
ln -sf /etc/systemd/system/homepinas-install.service "$MOUNT_ROOT/etc/systemd/system/multi-user.target.wants/"

# Run installer on first login (instead of relying on systemd service)
cat > "$MOUNT_ROOT/etc/profile.d/homepinas-installer.sh" << 'INSTALLER_PROFILE'
#!/bin/bash
# Run HomePiNAS installer on first login if not done yet
if [[ ! -f /etc/homepinas/.firstboot-done ]] && [[ -x /usr/local/bin/homepinas-firstboot.sh ]]; then
    # Only run on TTY (not SSH)
    if [[ $(tty) == /dev/tty* ]]; then
        echo ""
        echo "  🏠 Iniciando instalador de HomePiNAS..."
        echo ""
        sleep 1
        sudo /usr/local/bin/homepinas-firstboot.sh
    fi
fi
INSTALLER_PROFILE
chmod +x "$MOUNT_ROOT/etc/profile.d/homepinas-installer.sh"

echo -e "${GREEN}✓ Systemd services configured${NC}"

# Create MOTD
echo -e "${BLUE}Adding MOTD...${NC}"
mkdir -p "$MOUNT_ROOT/etc/update-motd.d"
cat > "$MOUNT_ROOT/etc/update-motd.d/99-homepinas" << 'MOTD'
#!/bin/bash
if [[ -f /opt/homepinas/backend/index.js ]]; then
    VERSION=$(grep '"version"' /opt/homepinas/package.json 2>/dev/null | head -1 | sed 's/.*: "\(.*\)".*/\1/')
    IP=$(hostname -I | awk '{print $1}')
    echo ""
    echo "  🏠 HomePiNAS v${VERSION:-?}"
    echo "  Dashboard: https://${IP}"
    echo ""
elif [[ -f /etc/homepinas/.firstboot-done ]]; then
    echo ""
    echo "  🏠 HomePiNAS - Dashboard instalándose..."
    echo "  Revisa: journalctl -u homepinas-install -f"
    echo ""
else
    echo ""
    echo "  🏠 HomePiNAS - Reinicia para comenzar setup"
    echo ""
fi
MOTD
chmod +x "$MOUNT_ROOT/etc/update-motd.d/99-homepinas"
echo -e "${GREEN}✓ MOTD added${NC}"

# Cleanup and unmount
echo -e "${BLUE}Unmounting partitions...${NC}"
sync
umount "$MOUNT_BOOT"
umount "$MOUNT_ROOT"
losetup -d "$LOOP_DEV"

# Detach loop device
echo -e "${BLUE}Detaching loop device...${NC}"
kpartx -d "$IMAGE_FILE" 2>/dev/null || true
if [ -n "$LOOP_DEV" ]; then
    losetup -d "$LOOP_DEV" 2>/dev/null || true
fi

rmdir "$MOUNT_BOOT" "$MOUNT_ROOT" 2>/dev/null || true

# Rename output image
OUTPUT_IMAGE="${IMAGE_FILE%.img}-homepinas-v${VERSION}.img"
mv "$IMAGE_FILE" "$OUTPUT_IMAGE"

echo ""
echo -e "${GREEN}=========================================${NC}"
echo -e "${GREEN}  ✅ Image customization complete!      ${NC}"
echo -e "${GREEN}=========================================${NC}"
echo ""
echo -e "Output image: ${BLUE}$OUTPUT_IMAGE${NC}"
echo ""
echo -e "${YELLOW}Next steps:${NC}"
echo "1. Flash with Raspberry Pi Imager or balenaEtcher"
echo "2. Boot the Raspberry Pi"
echo "3. Follow the on-screen setup wizard"
echo "4. Dashboard installs automatically after setup"
echo ""
echo -e "Access: ${GREEN}https://homepinas.local${NC}"
echo ""
