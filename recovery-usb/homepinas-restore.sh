#!/bin/bash
###############################################################################
# HomePiNAS Recovery Tool - TUI Interface
# Interactive restore of PC/server backups from HomePiNAS NAS
###############################################################################

set -euo pipefail

# Source the discovery script
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if [ -f "${SCRIPT_DIR}/nas-discover" ]; then
    source "${SCRIPT_DIR}/nas-discover"
elif [ -f "/usr/local/bin/nas-discover" ]; then
    source "/usr/local/bin/nas-discover"
fi

# State
NAS_ADDR=""
SESSION_ID=""
SELECTED_DEVICE=""
SELECTED_VERSION=""
TARGET_DISK=""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

###############################################################################
# UI Helpers
###############################################################################

clear_screen() {
    clear
    echo ""
    echo -e "${CYAN}╔══════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${CYAN}║${NC}     🏠 ${BOLD}HomePiNAS Recovery System${NC}                            ${CYAN}║${NC}"
    echo -e "${CYAN}╚══════════════════════════════════════════════════════════════╝${NC}"
    echo ""
}

print_step() {
    echo -e "${GREEN}▸${NC} ${BOLD}$1${NC}"
}

print_info() {
    echo -e "  ${DIM}$1${NC}"
}

print_error() {
    echo -e "  ${RED}✗ $1${NC}"
}

print_success() {
    echo -e "  ${GREEN}✓ $1${NC}"
}

press_enter() {
    echo ""
    read -p "  Pulsa Enter para continuar..." -r
}

# Dialog wrapper (falls back to simple text if dialog not available)
HAS_DIALOG=false
if command -v dialog &>/dev/null; then
    HAS_DIALOG=true
fi

###############################################################################
# Step 1: Network Setup
###############################################################################
setup_network() {
    clear_screen
    print_step "Paso 1/5: Conectando a la red..."
    echo ""
    
    # Wait for network
    local retries=0
    local max_retries=30
    
    while [ $retries -lt $max_retries ]; do
        if ip route get 1.1.1.1 &>/dev/null; then
            local ip
            ip=$(ip route get 1.1.1.1 | grep -oP 'src \K\S+')
            print_success "Red conectada (IP: ${ip})"
            return 0
        fi
        retries=$((retries + 1))
        echo -ne "\r  Esperando conexión de red... (${retries}/${max_retries})"
        sleep 2
    done
    
    echo ""
    print_error "No se detectó conexión de red"
    echo ""
    echo "  Opciones:"
    echo "    1) Reintentar (esperar más)"
    echo "    2) Configurar WiFi manualmente"
    echo "    3) Salir al shell"
    echo ""
    read -p "  Elige [1/2/3]: " -r choice
    
    case "$choice" in
        1) setup_network ;;
        2) setup_wifi ;;
        3) exec /bin/bash ;;
        *) setup_network ;;
    esac
}

setup_wifi() {
    echo ""
    print_step "Configuración WiFi"
    
    # List available networks
    echo ""
    echo "  Redes disponibles:"
    nmcli dev wifi list 2>/dev/null | head -20
    echo ""
    read -p "  Nombre de la red (SSID): " -r ssid
    read -sp "  Contraseña: " -r password
    echo ""
    
    nmcli dev wifi connect "$ssid" password "$password" 2>/dev/null
    
    if [ $? -eq 0 ]; then
        print_success "Conectado a ${ssid}"
        sleep 2
    else
        print_error "No se pudo conectar a ${ssid}"
        press_enter
        setup_network
    fi
}

###############################################################################
# Step 2: Find NAS
###############################################################################
find_nas() {
    clear_screen
    print_step "Paso 2/5: Buscando HomePiNAS en la red..."
    echo ""
    
    # Discover NAS
    local result
    result=$(discover_nas 2>&1 | tee /dev/stderr | grep -E '^[0-9]+\.' | head -1)
    
    if [ -z "$result" ]; then
        echo ""
        print_error "No se encontró HomePiNAS automáticamente"
        echo ""
        read -p "  Introduce la IP del NAS manualmente (ej: 192.168.1.123): " -r manual_ip
        
        if [ -n "$manual_ip" ]; then
            NAS_ADDR="${manual_ip}:3001"
        else
            print_error "IP requerida"
            press_enter
            find_nas
            return
        fi
    else
        NAS_ADDR="$result"
    fi
    
    # Verify NAS is reachable
    echo ""
    echo -e "  Verificando ${NAS_ADDR}..."
    if curl -sk --connect-timeout 5 "https://${NAS_ADDR}/api/system/stats" 2>/dev/null | grep -q "cpuModel"; then
        print_success "HomePiNAS encontrado en ${NAS_ADDR}"
    else
        print_error "No se pudo conectar a ${NAS_ADDR}"
        press_enter
        find_nas
        return
    fi
    
    # Login
    echo ""
    print_step "Iniciar sesión en el NAS"
    echo ""
    read -p "  Usuario: " -r username
    read -sp "  Contraseña: " -r password
    echo ""
    
    local login_result
    login_result=$(login_nas "$NAS_ADDR" "$username" "$password")
    SESSION_ID=$(echo "$login_result" | jq -r '.sessionId // empty' 2>/dev/null)
    
    if [ -z "$SESSION_ID" ]; then
        print_error "Login fallido"
        press_enter
        find_nas
        return
    fi
    
    print_success "Sesión iniciada como ${username}"
    sleep 1
}

###############################################################################
# Step 3: Select Device & Backup
###############################################################################
select_backup() {
    clear_screen
    print_step "Paso 3/5: Seleccionar backup a restaurar"
    echo ""
    
    # Get devices
    local devices_json
    devices_json=$(get_devices "$NAS_ADDR" "$SESSION_ID")
    
    local device_count
    device_count=$(echo "$devices_json" | jq '.devices | length' 2>/dev/null || echo 0)
    
    if [ "$device_count" -eq 0 ]; then
        print_error "No hay dispositivos con backup en el NAS"
        press_enter
        return 1
    fi
    
    # List devices
    echo "  Dispositivos con backup:"
    echo ""
    echo -e "  ${DIM}  #  Nombre                     Tipo        Último backup        Estado${NC}"
    echo -e "  ${DIM}  ── ─────────────────────────── ─────────── ──────────────────── ──────${NC}"
    
    for i in $(seq 0 $((device_count - 1))); do
        local name type last_backup last_result
        name=$(echo "$devices_json" | jq -r ".devices[$i].name" 2>/dev/null)
        type=$(echo "$devices_json" | jq -r ".devices[$i].backupType // \"files\"" 2>/dev/null)
        last_backup=$(echo "$devices_json" | jq -r ".devices[$i].lastBackup // \"Nunca\"" 2>/dev/null)
        last_result=$(echo "$devices_json" | jq -r ".devices[$i].lastResult // \"—\"" 2>/dev/null)
        
        local type_label
        [ "$type" = "image" ] && type_label="💽 Imagen" || type_label="📁 Archivos"
        
        local status_icon
        [ "$last_result" = "success" ] && status_icon="${GREEN}✓${NC}" || status_icon="${YELLOW}—${NC}"
        
        # Format date
        if [ "$last_backup" != "Nunca" ] && [ "$last_backup" != "null" ]; then
            last_backup=$(date -d "$last_backup" "+%d/%m/%Y %H:%M" 2>/dev/null || echo "$last_backup")
        fi
        
        printf "  %2d) %-28s %-11s %-20s %b\n" $((i+1)) "$name" "$type_label" "$last_backup" "$status_icon"
    done
    
    echo ""
    read -p "  Selecciona dispositivo [1-${device_count}]: " -r device_choice
    
    if ! [[ "$device_choice" =~ ^[0-9]+$ ]] || [ "$device_choice" -lt 1 ] || [ "$device_choice" -gt "$device_count" ]; then
        print_error "Selección inválida"
        press_enter
        select_backup
        return
    fi
    
    local idx=$((device_choice - 1))
    SELECTED_DEVICE=$(echo "$devices_json" | jq -r ".devices[$idx].id" 2>/dev/null)
    local device_name
    device_name=$(echo "$devices_json" | jq -r ".devices[$idx].name" 2>/dev/null)
    local device_type
    device_type=$(echo "$devices_json" | jq -r ".devices[$idx].backupType // \"files\"" 2>/dev/null)
    
    print_success "Seleccionado: ${device_name}"
    echo ""
    
    # Select version/image
    if [ "$device_type" = "image" ]; then
        select_image "$device_name"
    else
        select_version "$device_name"
    fi
}

select_version() {
    local device_name="$1"
    
    print_step "Seleccionar versión de backup"
    echo ""
    
    local versions_json
    versions_json=$(curl -sk "https://${NAS_ADDR}/api/active-backup/devices/${SELECTED_DEVICE}/versions" \
        -H "X-Session-Id: ${SESSION_ID}" 2>/dev/null)
    
    local version_count
    version_count=$(echo "$versions_json" | jq '.versions | length' 2>/dev/null || echo 0)
    
    if [ "$version_count" -eq 0 ]; then
        print_error "No hay versiones de backup para este dispositivo"
        press_enter
        return 1
    fi
    
    echo -e "  ${DIM}  #  Versión     Fecha                    Tamaño${NC}"
    echo -e "  ${DIM}  ── ─────────── ──────────────────────── ──────────${NC}"
    
    for i in $(seq 0 $((version_count - 1))); do
        local vname vdate vsize
        vname=$(echo "$versions_json" | jq -r ".versions[$i].name" 2>/dev/null)
        vdate=$(echo "$versions_json" | jq -r ".versions[$i].date" 2>/dev/null)
        vsize=$(echo "$versions_json" | jq -r ".versions[$i].size" 2>/dev/null)
        
        vdate=$(date -d "$vdate" "+%d/%m/%Y %H:%M" 2>/dev/null || echo "$vdate")
        vsize=$(numfmt --to=iec "$vsize" 2>/dev/null || echo "${vsize}B")
        
        printf "  %2d) %-11s %-24s %s\n" $((i+1)) "$vname" "$vdate" "$vsize"
    done
    
    echo ""
    read -p "  Selecciona versión [1-${version_count}]: " -r version_choice
    
    if ! [[ "$version_choice" =~ ^[0-9]+$ ]] || [ "$version_choice" -lt 1 ] || [ "$version_choice" -gt "$version_count" ]; then
        print_error "Selección inválida"
        press_enter
        select_version "$device_name"
        return
    fi
    
    local vidx=$((version_choice - 1))
    SELECTED_VERSION=$(echo "$versions_json" | jq -r ".versions[$vidx].name" 2>/dev/null)
    print_success "Versión seleccionada: ${SELECTED_VERSION}"
}

select_image() {
    local device_name="$1"
    
    print_step "Seleccionar imagen de backup"
    echo ""
    
    local images_json
    images_json=$(curl -sk "https://${NAS_ADDR}/api/active-backup/devices/${SELECTED_DEVICE}/images" \
        -H "X-Session-Id: ${SESSION_ID}" 2>/dev/null)
    
    local images
    images=$(echo "$images_json" | jq -r '.images[]?.name // empty' 2>/dev/null)
    local wbackups
    wbackups=$(echo "$images_json" | jq -r '.windowsBackups[]?.name // empty' 2>/dev/null)
    
    if [ -z "$images" ] && [ -z "$wbackups" ]; then
        print_error "No hay imágenes de backup para este dispositivo"
        press_enter
        return 1
    fi
    
    echo "  Imágenes disponibles:"
    echo ""
    
    local count=0
    local -a image_list=()
    
    while IFS= read -r img; do
        [ -z "$img" ] && continue
        count=$((count + 1))
        image_list+=("$img")
        local isize
        isize=$(echo "$images_json" | jq -r ".windowsBackups[] | select(.name==\"$img\") | .size" 2>/dev/null)
        isize=$(numfmt --to=iec "$isize" 2>/dev/null || echo "?")
        printf "  %2d) 🪟 %s (%s)\n" "$count" "$img" "$isize"
    done <<< "$wbackups"
    
    while IFS= read -r img; do
        [ -z "$img" ] && continue
        count=$((count + 1))
        image_list+=("$img")
        printf "  %2d) 💾 %s\n" "$count" "$img"
    done <<< "$images"
    
    echo ""
    read -p "  Selecciona imagen [1-${count}]: " -r img_choice
    
    if ! [[ "$img_choice" =~ ^[0-9]+$ ]] || [ "$img_choice" -lt 1 ] || [ "$img_choice" -gt "$count" ]; then
        print_error "Selección inválida"
        press_enter
        select_image "$device_name"
        return
    fi
    
    SELECTED_VERSION="${image_list[$((img_choice - 1))]}"
    print_success "Imagen seleccionada: ${SELECTED_VERSION}"
}

###############################################################################
# Step 4: Select Target Disk
###############################################################################
select_target_disk() {
    clear_screen
    print_step "Paso 4/5: Seleccionar disco de destino"
    echo ""
    echo -e "  ${RED}⚠️  ATENCIÓN: El disco seleccionado se SOBREESCRIBIRÁ completamente${NC}"
    echo ""
    
    # List disks
    echo "  Discos disponibles:"
    echo ""
    
    local -a disk_list=()
    local count=0
    
    while IFS= read -r line; do
        local disk_name disk_size disk_model
        disk_name=$(echo "$line" | awk '{print $1}')
        disk_size=$(echo "$line" | awk '{print $4}')
        disk_model=$(echo "$line" | awk '{for(i=6;i<=NF;i++) printf "%s ", $i; print ""}' | sed 's/ *$//')
        
        # Skip the USB we booted from
        local is_removable
        is_removable=$(cat "/sys/block/${disk_name}/removable" 2>/dev/null || echo "0")
        
        count=$((count + 1))
        disk_list+=("/dev/${disk_name}")
        
        local icon="💿"
        [ "$is_removable" = "1" ] && icon="🔌"
        
        printf "  %2d) %s /dev/%-6s %8s  %s\n" "$count" "$icon" "$disk_name" "$disk_size" "$disk_model"
    done < <(lsblk -dno NAME,TYPE,TRAN,SIZE,RM,MODEL 2>/dev/null | grep "disk" | grep -v "loop")
    
    if [ $count -eq 0 ]; then
        print_error "No se encontraron discos"
        press_enter
        return 1
    fi
    
    echo ""
    read -p "  Selecciona disco destino [1-${count}]: " -r disk_choice
    
    if ! [[ "$disk_choice" =~ ^[0-9]+$ ]] || [ "$disk_choice" -lt 1 ] || [ "$disk_choice" -gt "$count" ]; then
        print_error "Selección inválida"
        press_enter
        select_target_disk
        return
    fi
    
    TARGET_DISK="${disk_list[$((disk_choice - 1))]}"
    
    # Show disk details
    echo ""
    echo "  Detalles del disco seleccionado:"
    lsblk -o NAME,SIZE,TYPE,FSTYPE,MOUNTPOINT "$TARGET_DISK" 2>/dev/null | sed 's/^/    /'
    echo ""
    
    print_success "Disco destino: ${TARGET_DISK}"
}

###############################################################################
# Step 5: Confirm & Restore
###############################################################################
confirm_and_restore() {
    clear_screen
    print_step "Paso 5/5: Confirmar y restaurar"
    echo ""
    echo "  Resumen de la operación:"
    echo ""
    echo -e "    NAS:        ${BOLD}${NAS_ADDR}${NC}"
    echo -e "    Dispositivo: ${BOLD}${SELECTED_DEVICE}${NC}"
    echo -e "    Versión:     ${BOLD}${SELECTED_VERSION}${NC}"
    echo -e "    Disco:       ${BOLD}${TARGET_DISK}${NC}"
    echo ""
    echo -e "  ${RED}⚠️  TODOS LOS DATOS EN ${TARGET_DISK} SE PERDERÁN${NC}"
    echo ""
    read -p "  ¿Estás seguro? Escribe 'RESTAURAR' para confirmar: " -r confirm
    
    if [ "$confirm" != "RESTAURAR" ]; then
        print_error "Restauración cancelada"
        press_enter
        main_menu
        return
    fi
    
    echo ""
    print_step "Iniciando restauración..."
    echo ""
    
    # Mount NAS share
    local mount_point="/mnt/nas-backup"
    mkdir -p "$mount_point"
    
    local device_json
    device_json=$(curl -sk "https://${NAS_ADDR}/api/active-backup/devices/${SELECTED_DEVICE}" \
        -H "X-Session-Id: ${SESSION_ID}" 2>/dev/null)
    local backup_type
    backup_type=$(echo "$device_json" | jq -r '.backupType // "files"' 2>/dev/null)
    
    # Get NAS IP without port
    local nas_ip="${NAS_ADDR%%:*}"
    
    # Mount via SMB
    print_info "Montando backup desde NAS..."
    
    local share_name
    if [ "$backup_type" = "image" ]; then
        share_name=$(echo "$device_json" | jq -r '.sambaShare // empty' 2>/dev/null)
    else
        share_name="active-backup"
    fi
    
    # Try mounting
    if ! mount -t cifs "//${nas_ip}/${share_name}" "$mount_point" \
        -o username=homepinas,password=homepinas,vers=3.0 2>/dev/null; then
        # Fallback: mount the whole storage share
        if ! mount -t cifs "//${nas_ip}/Storage" "$mount_point" \
            -o username=homepinas,password=homepinas,vers=3.0 2>/dev/null; then
            print_error "No se pudo montar el NAS. Intentando por SSH..."
            # TODO: SSH fallback
            press_enter
            return 1
        fi
    fi
    
    print_success "NAS montado en ${mount_point}"
    
    if [ "$backup_type" = "image" ]; then
        restore_image "$mount_point"
    else
        restore_files "$mount_point"
    fi
    
    # Cleanup
    umount "$mount_point" 2>/dev/null || true
}

###############################################################################
# Restore: Image (dd/partclone)
###############################################################################
restore_image() {
    local mount_point="$1"
    
    # Find the image file
    local image_path=""
    
    # Check for Windows Image Backup
    if [ -d "${mount_point}/WindowsImageBackup" ]; then
        print_info "Detectado Windows Image Backup"
        print_info "Este tipo de backup se restaura mejor desde Windows Recovery"
        echo ""
        echo "  Para restaurar:"
        echo "    1. Arranca con USB de instalación de Windows"
        echo "    2. Reparar el equipo → Solucionar problemas"
        echo "    3. Recuperación de imagen del sistema"
        echo "    4. Selecciona la imagen de red: //${NAS_ADDR%%:*}/Storage"
        echo ""
        press_enter
        return
    fi
    
    # Find .img, .img.gz, .pcl.gz files
    local -a images=()
    while IFS= read -r f; do
        [ -n "$f" ] && images+=("$f")
    done < <(find "$mount_point" -maxdepth 2 -name "*.img" -o -name "*.img.gz" -o -name "*.pcl.gz" 2>/dev/null | sort -r)
    
    if [ ${#images[@]} -eq 0 ]; then
        print_error "No se encontraron imágenes de disco"
        press_enter
        return 1
    fi
    
    # Use selected or first available
    if [ -n "$SELECTED_VERSION" ]; then
        for img in "${images[@]}"; do
            if [[ "$img" == *"$SELECTED_VERSION"* ]]; then
                image_path="$img"
                break
            fi
        done
    fi
    [ -z "$image_path" ] && image_path="${images[0]}"
    
    print_info "Imagen: $(basename "$image_path")"
    local img_size
    img_size=$(stat -c%s "$image_path" 2>/dev/null || echo 0)
    
    echo ""
    print_step "Restaurando imagen a ${TARGET_DISK}..."
    echo ""
    
    # Determine restore method
    if [[ "$image_path" == *.pcl.gz ]]; then
        # Partclone compressed
        print_info "Método: partclone (comprimido)"
        pigz -dc "$image_path" | partclone.restore -s - -O "$TARGET_DISK" 2>&1 | \
            while IFS= read -r line; do
                echo -ne "\r  ${line}                    "
            done
    elif [[ "$image_path" == *.img.gz ]]; then
        # DD compressed
        print_info "Método: dd (comprimido con gzip)"
        pigz -dc "$image_path" | pv -s "$((img_size * 3))" | dd of="$TARGET_DISK" bs=4M status=none
    elif [[ "$image_path" == *.img ]]; then
        # DD raw
        print_info "Método: dd (raw)"
        pv "$image_path" | dd of="$TARGET_DISK" bs=4M status=none
    fi
    
    sync
    echo ""
    print_success "¡Imagen restaurada correctamente!"
    
    # Fix boot if needed
    fix_boot
}

###############################################################################
# Restore: Files (rsync from backup version)
###############################################################################
restore_files() {
    local mount_point="$1"
    
    # Find the version directory
    local version_dir="${mount_point}/active-backup/${SELECTED_DEVICE}/${SELECTED_VERSION}"
    
    if [ ! -d "$version_dir" ]; then
        # Try finding it
        version_dir=$(find "$mount_point" -maxdepth 4 -type d -name "$SELECTED_VERSION" 2>/dev/null | head -1)
    fi
    
    if [ ! -d "$version_dir" ]; then
        print_error "No se encontró la versión ${SELECTED_VERSION}"
        press_enter
        return 1
    fi
    
    print_info "Origen: ${version_dir}"
    
    # For file-level restore, we need to mount the target disk first
    print_step "Montando disco destino..."
    
    local target_mount="/mnt/target"
    mkdir -p "$target_mount"
    
    # Try to detect and mount partitions
    partprobe "$TARGET_DISK" 2>/dev/null
    sleep 1
    
    local partitions
    partitions=$(lsblk -lno NAME,FSTYPE "$TARGET_DISK" | grep -v "^$(basename "$TARGET_DISK") " | awk '$2 != "" {print $1}')
    
    if [ -z "$partitions" ]; then
        print_error "No se detectaron particiones en ${TARGET_DISK}"
        echo "  ¿Quieres formatear el disco con ext4?"
        read -p "  [s/N]: " -r format_choice
        if [ "$format_choice" = "s" ] || [ "$format_choice" = "S" ]; then
            parted -s "$TARGET_DISK" mklabel gpt
            parted -s "$TARGET_DISK" mkpart primary ext4 1MiB 100%
            partprobe "$TARGET_DISK"
            sleep 1
            mkfs.ext4 -F "${TARGET_DISK}1" 2>/dev/null
            partitions="$(basename "${TARGET_DISK}")1"
        else
            press_enter
            return 1
        fi
    fi
    
    # Mount the main partition (usually the largest one)
    local main_part
    main_part=$(echo "$partitions" | head -1)
    mount "/dev/${main_part}" "$target_mount" 2>/dev/null || {
        print_error "No se pudo montar /dev/${main_part}"
        press_enter
        return 1
    }
    
    print_success "Disco montado en ${target_mount}"
    echo ""
    print_step "Restaurando archivos..."
    echo ""
    
    rsync -aHAXv --progress "$version_dir/" "$target_mount/" 2>&1 | \
        while IFS= read -r line; do
            # Show progress without flooding
            if [[ "$line" == *"%" ]] || [[ "$line" == *"sent"* ]] || [[ "$line" == *"total"* ]]; then
                echo -e "\r  ${line}                    "
            fi
        done
    
    sync
    umount "$target_mount" 2>/dev/null
    
    echo ""
    print_success "¡Archivos restaurados correctamente!"
    
    fix_boot
}

###############################################################################
# Fix boot (reinstall GRUB if Linux)
###############################################################################
fix_boot() {
    echo ""
    read -p "  ¿Quieres reparar el arranque? (para Linux) [s/N]: " -r fix_choice
    
    if [ "$fix_choice" = "s" ] || [ "$fix_choice" = "S" ]; then
        local target_mount="/mnt/target"
        mkdir -p "$target_mount"
        
        # Find and mount root partition
        local root_part
        root_part=$(lsblk -lno NAME,FSTYPE "$TARGET_DISK" | grep -E "ext4|btrfs|xfs" | head -1 | awk '{print $1}')
        
        if [ -z "$root_part" ]; then
            print_error "No se encontró partición root"
            return
        fi
        
        mount "/dev/${root_part}" "$target_mount" 2>/dev/null || return
        
        # Check if it's a Linux system
        if [ -f "${target_mount}/etc/os-release" ]; then
            print_info "Sistema Linux detectado"
            
            # Mount required filesystems
            mount --bind /dev "${target_mount}/dev"
            mount --bind /proc "${target_mount}/proc"
            mount --bind /sys "${target_mount}/sys"
            
            # Mount EFI partition if exists
            local efi_part
            efi_part=$(lsblk -lno NAME,FSTYPE "$TARGET_DISK" | grep "vfat" | head -1 | awk '{print $1}')
            if [ -n "$efi_part" ]; then
                mkdir -p "${target_mount}/boot/efi"
                mount "/dev/${efi_part}" "${target_mount}/boot/efi"
            fi
            
            # Reinstall GRUB
            chroot "$target_mount" /bin/bash -c "
                if [ -n '$efi_part' ]; then
                    grub-install --target=x86_64-efi --efi-directory=/boot/efi --bootloader-id=linux 2>/dev/null || true
                else
                    grub-install ${TARGET_DISK} 2>/dev/null || true
                fi
                update-grub 2>/dev/null || true
            "
            
            # Cleanup mounts
            umount "${target_mount}/boot/efi" 2>/dev/null || true
            umount "${target_mount}/sys" 2>/dev/null || true
            umount "${target_mount}/proc" 2>/dev/null || true
            umount "${target_mount}/dev" 2>/dev/null || true
            
            print_success "GRUB reinstalado"
        fi
        
        umount "$target_mount" 2>/dev/null || true
    fi
}

###############################################################################
# Main Menu
###############################################################################
main_menu() {
    clear_screen
    echo "  Opciones:"
    echo ""
    echo "    1) 🔄 Restaurar backup completo"
    echo "    2) 📂 Explorar backup (montar como lectura)"
    echo "    3) 🔧 Shell (línea de comandos)"
    echo "    4) 🔌 Apagar"
    echo "    5) 🔁 Reiniciar"
    echo ""
    read -p "  Elige [1-5]: " -r choice
    
    case "$choice" in
        1) full_restore ;;
        2) explore_backup ;;
        3) exec /bin/bash ;;
        4) poweroff ;;
        5) reboot ;;
        *) main_menu ;;
    esac
}

full_restore() {
    setup_network
    find_nas
    select_backup || { press_enter; main_menu; return; }
    select_target_disk || { press_enter; main_menu; return; }
    confirm_and_restore
    
    echo ""
    echo -e "  ${GREEN}═══════════════════════════════════════════${NC}"
    echo -e "  ${GREEN}  ✅ Restauración completada${NC}"
    echo -e "  ${GREEN}  Retira el USB y reinicia el equipo${NC}"
    echo -e "  ${GREEN}═══════════════════════════════════════════${NC}"
    echo ""
    echo "    1) Reiniciar ahora"
    echo "    2) Volver al menú"
    echo "    3) Shell"
    echo ""
    read -p "  Elige [1-3]: " -r post_choice
    case "$post_choice" in
        1) reboot ;;
        2) main_menu ;;
        3) exec /bin/bash ;;
        *) main_menu ;;
    esac
}

explore_backup() {
    setup_network
    find_nas
    select_backup || { press_enter; main_menu; return; }
    
    local nas_ip="${NAS_ADDR%%:*}"
    local mount_point="/mnt/nas-backup"
    mkdir -p "$mount_point"
    
    print_step "Montando backup..."
    mount -t cifs "//${nas_ip}/Storage" "$mount_point" \
        -o username=homepinas,password=homepinas,vers=3.0,ro 2>/dev/null || {
        print_error "No se pudo montar"
        press_enter
        main_menu
        return
    }
    
    print_success "Backup montado en ${mount_point}"
    print_info "Usa 'ls', 'cd', 'cp' para explorar los archivos"
    print_info "Escribe 'exit' para volver al menú"
    echo ""
    
    cd "$mount_point"
    /bin/bash
    cd /
    umount "$mount_point" 2>/dev/null || true
    
    main_menu
}

###############################################################################
# Entry point
###############################################################################
main_menu
