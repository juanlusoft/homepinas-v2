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
# HomePiNAS First Boot Setup
# Se ejecuta una sola vez en el primer arranque

set -e

FIRSTBOOT_MARKER="/etc/homepinas/.firstboot-done"
LOG="/var/log/homepinas-firstboot.log"

# Si ya se ejecutó, salir
if [[ -f "$FIRSTBOOT_MARKER" ]]; then
    exit 0
fi

exec > >(tee -a "$LOG") 2>&1
echo "=== HomePiNAS First Boot - $(date) ==="

# Esperar a que el sistema esté listo
sleep 5

# Verificar que tenemos terminal
if ! tty -s; then
    echo "No TTY disponible, esperando..."
    sleep 10
fi

# Función para mostrar dialogo
show_dialog() {
    if command -v dialog &>/dev/null; then
        dialog "$@"
    elif command -v whiptail &>/dev/null; then
        whiptail "$@"
    else
        echo "ERROR: Se requiere dialog o whiptail"
        exit 1
    fi
}

clear

# Banner
echo ""
echo "  ╔═══════════════════════════════════════════════════════════╗"
echo "  ║                                                           ║"
echo "  ║   🏠 HomePiNAS - Configuración Inicial                    ║"
echo "  ║                                                           ║"
echo "  ╚═══════════════════════════════════════════════════════════╝"
echo ""
sleep 2

# Instalar dialog si no está
if ! command -v dialog &>/dev/null; then
    echo "Instalando herramientas de configuración..."
    apt-get update -qq && apt-get install -y -qq dialog
fi

# Pantalla de bienvenida
dialog --title "🏠 HomePiNAS" --msgbox "\n¡Bienvenido a HomePiNAS!\n\nEste asistente te ayudará a configurar tu NAS.\n\nNecesitarás:\n  • Un nombre para tu NAS\n  • Un nombre de usuario\n  • Una contraseña segura" 15 50

# Configurar hostname
HOSTNAME=$(dialog --title "Nombre del NAS" --inputbox "\nIntroduce el nombre para tu NAS:\n(solo letras, números y guiones)" 10 50 "homepinas" 3>&1 1>&2 2>&3)

if [[ -z "$HOSTNAME" ]]; then
    HOSTNAME="homepinas"
fi

# Validar hostname
HOSTNAME=$(echo "$HOSTNAME" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9-]//g')

# Configurar usuario
USERNAME=$(dialog --title "Usuario Administrador" --inputbox "\nIntroduce el nombre de usuario:\n(será el administrador del NAS)" 10 50 "admin" 3>&1 1>&2 2>&3)

if [[ -z "$USERNAME" ]]; then
    USERNAME="admin"
fi

# Validar username
USERNAME=$(echo "$USERNAME" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9_]//g')

# Configurar contraseña
while true; do
    PASSWORD=$(dialog --title "Contraseña" --insecure --passwordbox "\nIntroduce la contraseña para '$USERNAME':\n(mínimo 8 caracteres)" 10 50 3>&1 1>&2 2>&3)
    
    if [[ ${#PASSWORD} -lt 8 ]]; then
        dialog --title "Error" --msgbox "La contraseña debe tener al menos 8 caracteres." 8 45
        continue
    fi
    
    PASSWORD2=$(dialog --title "Confirmar Contraseña" --insecure --passwordbox "\nRepite la contraseña:" 10 50 3>&1 1>&2 2>&3)
    
    if [[ "$PASSWORD" != "$PASSWORD2" ]]; then
        dialog --title "Error" --msgbox "Las contraseñas no coinciden. Inténtalo de nuevo." 8 45
        continue
    fi
    
    break
done

# Confirmación
dialog --title "Confirmar Configuración" --yesno "\n¿Es correcta esta configuración?\n\n  Nombre del NAS: $HOSTNAME\n  Usuario: $USERNAME\n  Contraseña: ********" 12 50

if [[ $? -ne 0 ]]; then
    dialog --title "Cancelado" --msgbox "Configuración cancelada. Reinicia para volver a intentarlo." 8 50
    exit 1
fi

# Aplicar configuración
dialog --title "Aplicando..." --infobox "\nConfigurando el sistema...\n\nEsto puede tardar unos minutos." 8 45

# 1. Cambiar hostname
echo "$HOSTNAME" > /etc/hostname
sed -i "s/127.0.1.1.*/127.0.1.1\t$HOSTNAME/" /etc/hosts
hostnamectl set-hostname "$HOSTNAME" 2>/dev/null || true

# 2. Crear usuario si no existe
if ! id "$USERNAME" &>/dev/null; then
    useradd -m -s /bin/bash -G sudo,adm "$USERNAME"
fi

# 3. Establecer contraseña
echo "$USERNAME:$PASSWORD" | chpasswd

# 4. Guardar config para HomePiNAS dashboard
mkdir -p /etc/homepinas
cat > /etc/homepinas/setup.json << EOF
{
    "hostname": "$HOSTNAME",
    "adminUser": "$USERNAME",
    "setupCompleted": true,
    "setupDate": "$(date -Iseconds)"
}
EOF
chmod 600 /etc/homepinas/setup.json

# 5. Marcar como completado
touch "$FIRSTBOOT_MARKER"

# 6. Deshabilitar este servicio para futuros arranques
systemctl disable homepinas-firstboot.service 2>/dev/null || true

dialog --title "✅ Configuración Completa" --msgbox "\n¡HomePiNAS está configurado!\n\n  Hostname: $HOSTNAME\n  Usuario: $USERNAME\n\nEl sistema se reiniciará para aplicar los cambios.\n\nDespués el dashboard se instalará automáticamente." 14 55

# Limpiar pantalla
clear
echo ""
echo "  ✅ HomePiNAS configurado correctamente"
echo ""
echo "  Reiniciando en 5 segundos..."
echo ""

sleep 5
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
