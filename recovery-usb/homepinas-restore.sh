#!/bin/bash
###############################################################################
# HomePiNAS Recovery TUI
# Interactive restore tool for HomePiNAS Active Backup
# Uses dialog for TUI menus — auto-discovers NAS and restores backups
###############################################################################

set -o pipefail

# ── Configuration ──
NAS_ADDR=""
SESSION_ID=""
API_BASE=""
RESTORE_LOG="/tmp/homepinas-restore.log"
BACKTITLE="🏠 HomePiNAS Recovery System v1.0"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# ── Colors (for non-dialog output) ──
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

###############################################################################
# Utility functions
###############################################################################

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$RESTORE_LOG"
}

api_get() {
    local endpoint="$1"
    curl -sk --connect-timeout 10 --max-time 30 \
        -H "X-Session-Id: ${SESSION_ID}" \
        "${API_BASE}${endpoint}" 2>/dev/null
}

api_post() {
    local endpoint="$1"
    local data="$2"
    curl -sk --connect-timeout 10 --max-time 30 \
        -X POST \
        -H "Content-Type: application/json" \
        -H "X-Session-Id: ${SESSION_ID}" \
        -d "$data" \
        "${API_BASE}${endpoint}" 2>/dev/null
}

# Show error dialog
show_error() {
    dialog --backtitle "$BACKTITLE" --title "❌ Error" --msgbox "$1" 8 60
}

# Show info dialog
show_info() {
    dialog --backtitle "$BACKTITLE" --title "ℹ️  Información" --msgbox "$1" 8 60
}

# Confirm dialog — returns 0 on yes
confirm() {
    dialog --backtitle "$BACKTITLE" --title "Confirmar" --yesno "$1" 8 60
    return $?
}

###############################################################################
# Network setup
###############################################################################

setup_network() {
    dialog --backtitle "$BACKTITLE" --title "🌐 Red" \
        --infobox "Configurando red...\n\nEsperando conexión de red (DHCP)..." 6 50

    # Wait for network (max 30 seconds)
    local attempts=0
    while [ $attempts -lt 30 ]; do
        if ip route get 1.1.1.1 &>/dev/null; then
            local ip
            ip=$(ip route get 1.1.1.1 2>/dev/null | grep -oP 'src \K\S+')
            log "Network ready, IP: $ip"
            return 0
        fi
        sleep 1
        attempts=$((attempts + 1))
    done

    dialog --backtitle "$BACKTITLE" --title "⚠️ Red" --yesno \
        "No se detectó conexión de red automática.\n\n¿Deseas configurarla manualmente?" 8 55
    
    if [ $? -eq 0 ]; then
        configure_network_manual
    else
        return 1
    fi
}

configure_network_manual() {
    # List available interfaces
    local ifaces
    ifaces=$(ip -o link show | awk -F': ' '{print $2}' | grep -v '^lo$')
    
    local menu_items=()
    for iface in $ifaces; do
        local state
        state=$(cat "/sys/class/net/${iface}/operstate" 2>/dev/null || echo "unknown")
        menu_items+=("$iface" "$state")
    done

    if [ ${#menu_items[@]} -eq 0 ]; then
        show_error "No se encontraron interfaces de red"
        return 1
    fi

    local selected_iface
    selected_iface=$(dialog --backtitle "$BACKTITLE" --title "Seleccionar interfaz" \
        --menu "Elige la interfaz de red:" 15 50 6 \
        "${menu_items[@]}" 3>&1 1>&2 2>&3)
    
    [ $? -ne 0 ] && return 1

    local config_method
    config_method=$(dialog --backtitle "$BACKTITLE" --title "Configuración" \
        --menu "Método de configuración:" 10 50 3 \
        "dhcp" "Automático (DHCP)" \
        "static" "Manual (IP estática)" 3>&1 1>&2 2>&3)
    
    [ $? -ne 0 ] && return 1

    if [ "$config_method" = "dhcp" ]; then
        dialog --backtitle "$BACKTITLE" --infobox "Obteniendo IP por DHCP..." 4 40
        ip link set "$selected_iface" up
        dhclient -v "$selected_iface" 2>/dev/null || dhcpcd "$selected_iface" 2>/dev/null
        sleep 3
    else
        local ip_addr
        ip_addr=$(dialog --backtitle "$BACKTITLE" --title "IP estática" \
            --inputbox "Dirección IP (ej: 192.168.1.50/24):" 8 50 "192.168.1.50/24" 3>&1 1>&2 2>&3)
        [ $? -ne 0 ] && return 1
        
        local gateway
        gateway=$(dialog --backtitle "$BACKTITLE" --title "Gateway" \
            --inputbox "Puerta de enlace (ej: 192.168.1.1):" 8 50 "192.168.1.1" 3>&1 1>&2 2>&3)
        [ $? -ne 0 ] && return 1
        
        ip link set "$selected_iface" up
        ip addr add "$ip_addr" dev "$selected_iface"
        ip route add default via "$gateway"
    fi

    # Verify connectivity
    if ip route get 1.1.1.1 &>/dev/null; then
        local my_ip
        my_ip=$(ip -o -4 addr show "$selected_iface" | awk '{print $4}' | cut -d/ -f1)
        show_info "Red configurada correctamente\n\nIP: ${my_ip}\nInterfaz: ${selected_iface}"
        return 0
    else
        show_error "No se pudo establecer conexión de red"
        return 1
    fi
}

###############################################################################
# NAS Discovery
###############################################################################

discover_nas_tui() {
    local tmpfile
    tmpfile=$(mktemp)

    dialog --backtitle "$BACKTITLE" --title "🔍 Buscando NAS" \
        --infobox "Buscando HomePiNAS en la red...\n\nMétodo 1: mDNS/Avahi..." 7 50
    
    # Source nas-discover functions
    if [ -f "${SCRIPT_DIR}/nas-discover" ]; then
        source "${SCRIPT_DIR}/nas-discover"
    elif [ -f "/usr/local/bin/nas-discover" ]; then
        source "/usr/local/bin/nas-discover"
    fi

    # Try automatic discovery
    local result
    result=$(discover_nas 2>/dev/null)
    
    if [ -n "$result" ]; then
        NAS_ADDR="$result"
        API_BASE="https://${NAS_ADDR}/api"
        log "NAS found at $NAS_ADDR"
        
        dialog --backtitle "$BACKTITLE" --title "✅ NAS encontrado" \
            --msgbox "HomePiNAS encontrado en:\n\n  📡 ${NAS_ADDR}\n\nConectando..." 9 50
        return 0
    fi

    # Manual entry if auto-discovery fails
    dialog --backtitle "$BACKTITLE" --title "⚠️ NAS no encontrado" --yesno \
        "No se encontró HomePiNAS automáticamente.\n\n¿Quieres introducir la dirección manualmente?" 8 55
    
    if [ $? -ne 0 ]; then
        return 1
    fi

    local manual_addr
    manual_addr=$(dialog --backtitle "$BACKTITLE" --title "Dirección del NAS" \
        --inputbox "Introduce la IP o hostname del NAS:\n(ej: 192.168.1.100)" 9 50 "" 3>&1 1>&2 2>&3)
    
    [ $? -ne 0 ] && return 1

    # Try with default port
    local port="3001"
    if echo "$manual_addr" | grep -q ":"; then
        port=$(echo "$manual_addr" | cut -d: -f2)
        manual_addr=$(echo "$manual_addr" | cut -d: -f1)
    fi

    dialog --backtitle "$BACKTITLE" --infobox "Verificando conexión con ${manual_addr}:${port}..." 4 55

    if curl -sk --connect-timeout 5 "https://${manual_addr}:${port}/api/system/stats" &>/dev/null; then
        NAS_ADDR="${manual_addr}:${port}"
        API_BASE="https://${NAS_ADDR}/api"
        log "NAS manually set to $NAS_ADDR"
        show_info "Conexión verificada con ${NAS_ADDR}"
        return 0
    else
        show_error "No se pudo conectar con ${manual_addr}:${port}\n\nVerifica que el NAS esté encendido y accesible."
        return 1
    fi
}

###############################################################################
# NAS Authentication
###############################################################################

login_tui() {
    local credentials
    credentials=$(dialog --backtitle "$BACKTITLE" --title "🔐 Inicio de sesión" \
        --form "Credenciales del HomePiNAS:" 12 50 3 \
        "Usuario:" 1 1 "admin" 1 12 25 50 \
        "Contraseña:" 2 1 "" 2 12 25 50 \
        3>&1 1>&2 2>&3)
    
    [ $? -ne 0 ] && return 1

    local username password
    username=$(echo "$credentials" | sed -n '1p')
    password=$(echo "$credentials" | sed -n '2p')

    if [ -z "$username" ] || [ -z "$password" ]; then
        show_error "Usuario y contraseña son obligatorios"
        return 1
    fi

    dialog --backtitle "$BACKTITLE" --infobox "Iniciando sesión..." 4 35

    local response
    response=$(curl -sk --connect-timeout 10 \
        -X POST \
        -H "Content-Type: application/json" \
        -d "{\"username\":\"${username}\",\"password\":\"${password}\"}" \
        "${API_BASE}/login" 2>/dev/null)

    SESSION_ID=$(echo "$response" | jq -r '.sessionId // empty' 2>/dev/null)

    if [ -z "$SESSION_ID" ]; then
        local err_msg
        err_msg=$(echo "$response" | jq -r '.error // "Error desconocido"' 2>/dev/null)
        show_error "Login fallido: ${err_msg}"
        log "Login failed for user $username: $err_msg"
        return 1
    fi

    log "Logged in as $username, session: $SESSION_ID"
    return 0
}

###############################################################################
# List devices
###############################################################################

select_device() {
    dialog --backtitle "$BACKTITLE" --infobox "Obteniendo dispositivos..." 4 40

    local response
    response=$(api_get "/active-backup/devices")
    
    local devices_json
    devices_json=$(echo "$response" | jq -r '.devices // []' 2>/dev/null)
    local count
    count=$(echo "$devices_json" | jq 'length' 2>/dev/null)

    if [ -z "$count" ] || [ "$count" = "0" ]; then
        show_error "No hay dispositivos con backup en el NAS.\n\nRegistra un dispositivo primero desde el dashboard."
        return 1
    fi

    # Build menu items
    local menu_items=()
    local i=0
    while [ $i -lt "$count" ]; do
        local id name type os_type last_backup
        id=$(echo "$devices_json" | jq -r ".[$i].id" 2>/dev/null)
        name=$(echo "$devices_json" | jq -r ".[$i].name" 2>/dev/null)
        type=$(echo "$devices_json" | jq -r ".[$i].type // \"files\"" 2>/dev/null)
        os_type=$(echo "$devices_json" | jq -r ".[$i].os // \"linux\"" 2>/dev/null)
        last_backup=$(echo "$devices_json" | jq -r ".[$i].lastBackup // \"nunca\"" 2>/dev/null)
        
        if [ "$last_backup" != "nunca" ] && [ "$last_backup" != "null" ]; then
            last_backup=$(date -d "$last_backup" '+%d/%m/%Y %H:%M' 2>/dev/null || echo "$last_backup")
        else
            last_backup="sin backup"
        fi
        
        menu_items+=("$id" "${name} [${type}/${os_type}] (${last_backup})")
        i=$((i + 1))
    done

    local selected_device
    selected_device=$(dialog --backtitle "$BACKTITLE" --title "💻 Seleccionar dispositivo" \
        --menu "Elige el dispositivo a restaurar:" 18 70 10 \
        "${menu_items[@]}" 3>&1 1>&2 2>&3)
    
    [ $? -ne 0 ] && return 1

    echo "$selected_device"
    return 0
}

###############################################################################
# Select backup version
###############################################################################

select_version() {
    local device_id="$1"

    dialog --backtitle "$BACKTITLE" --infobox "Obteniendo versiones de backup..." 4 45

    local response
    response=$(api_get "/active-backup/devices/${device_id}/versions")
    
    local versions_json
    versions_json=$(echo "$response" | jq -r '.versions // []' 2>/dev/null)
    local count
    count=$(echo "$versions_json" | jq 'length' 2>/dev/null)

    if [ -z "$count" ] || [ "$count" = "0" ]; then
        show_error "No hay versiones de backup para este dispositivo."
        return 1
    fi

    local menu_items=()
    local i=0
    while [ $i -lt "$count" ]; do
        local version size date_str
        version=$(echo "$versions_json" | jq -r ".[$i].name" 2>/dev/null)
        size=$(echo "$versions_json" | jq -r ".[$i].size // \"?\"" 2>/dev/null)
        date_str=$(echo "$versions_json" | jq -r ".[$i].date // \"\"" 2>/dev/null)
        
        if [ -n "$date_str" ] && [ "$date_str" != "null" ]; then
            date_str=$(date -d "$date_str" '+%d/%m/%Y %H:%M' 2>/dev/null || echo "$date_str")
        fi
        
        menu_items+=("$version" "${date_str} — ${size}")
        i=$((i + 1))
    done

    local selected_version
    selected_version=$(dialog --backtitle "$BACKTITLE" --title "📦 Seleccionar versión" \
        --menu "Elige la versión de backup:" 18 65 10 \
        "${menu_items[@]}" 3>&1 1>&2 2>&3)
    
    [ $? -ne 0 ] && return 1

    echo "$selected_version"
    return 0
}

###############################################################################
# Select target disk
###############################################################################

select_target_disk() {
    dialog --backtitle "$BACKTITLE" --infobox "Detectando discos..." 4 35

    # List all disks except the boot device
    local boot_disk
    boot_disk=$(lsblk -ndo PKNAME "$(findmnt -no SOURCE /)" 2>/dev/null || echo "")

    local menu_items=()
    while IFS= read -r line; do
        local disk_name disk_size disk_model
        disk_name=$(echo "$line" | awk '{print $1}')
        disk_size=$(echo "$line" | awk '{print $2}')
        disk_model=$(echo "$line" | awk '{$1=$2=""; print $0}' | xargs)

        # Skip boot disk and loop/ram devices
        [ "$disk_name" = "$boot_disk" ] && continue
        [[ "$disk_name" =~ ^(loop|ram|sr) ]] && continue

        menu_items+=("/dev/${disk_name}" "${disk_size} ${disk_model}")
    done < <(lsblk -dnpo NAME,SIZE,MODEL 2>/dev/null | sed 's|/dev/||')

    if [ ${#menu_items[@]} -eq 0 ]; then
        show_error "No se encontraron discos disponibles para restaurar.\n\nConecta el disco destino e intenta de nuevo."
        return 1
    fi

    local selected_disk
    selected_disk=$(dialog --backtitle "$BACKTITLE" --title "💾 Seleccionar disco destino" \
        --menu "⚠️  EL DISCO SELECCIONADO SERÁ BORRADO COMPLETAMENTE\n\nElige el disco destino:" 18 65 8 \
        "${menu_items[@]}" 3>&1 1>&2 2>&3)
    
    [ $? -ne 0 ] && return 1

    # Double confirm
    local disk_info
    disk_info=$(lsblk -dno SIZE,MODEL "$selected_disk" 2>/dev/null)
    
    dialog --backtitle "$BACKTITLE" --title "⚠️  ¡ATENCIÓN!" --yesno \
        "¡TODOS LOS DATOS en ${selected_disk} se PERDERÁN!\n\nDisco: ${selected_disk}\nInfo: ${disk_info}\n\n¿Estás SEGURO de que quieres continuar?" 12 60
    
    [ $? -ne 0 ] && return 1

    # Triple confirm for safety
    dialog --backtitle "$BACKTITLE" --title "⚠️  ÚLTIMA CONFIRMACIÓN" --yesno \
        "Escribir:\n  ${selected_disk}\n\nEsta operación NO se puede deshacer.\n\n¿Continuar con la restauración?" 11 55
    
    [ $? -ne 0 ] && return 1

    echo "$selected_disk"
    return 0
}

###############################################################################
# Restore file-level backup
###############################################################################

restore_files() {
    local device_id="$1"
    local version="$2"

    # Browse backup contents
    dialog --backtitle "$BACKTITLE" --infobox "Cargando contenido del backup..." 4 45

    local response
    response=$(api_get "/active-backup/devices/${device_id}/browse?version=${version}&path=/")
    
    local files_json
    files_json=$(echo "$response" | jq -r '.files // []' 2>/dev/null)
    local count
    count=$(echo "$files_json" | jq 'length' 2>/dev/null)

    if [ -z "$count" ] || [ "$count" = "0" ]; then
        show_error "El backup está vacío o no se puede leer."
        return 1
    fi

    # Ask what to restore
    local restore_choice
    restore_choice=$(dialog --backtitle "$BACKTITLE" --title "📂 Restaurar archivos" \
        --menu "¿Qué quieres restaurar?" 12 55 4 \
        "todo" "Restaurar TODO el backup" \
        "carpeta" "Elegir carpeta específica" \
        "manual" "Escribir ruta manualmente" 3>&1 1>&2 2>&3)
    
    [ $? -ne 0 ] && return 1

    local source_path="/"
    
    case "$restore_choice" in
        "todo")
            source_path="/"
            ;;
        "carpeta")
            source_path=$(browse_backup_dirs "$device_id" "$version" "/")
            [ $? -ne 0 ] && return 1
            ;;
        "manual")
            source_path=$(dialog --backtitle "$BACKTITLE" --title "Ruta" \
                --inputbox "Ruta dentro del backup (ej: /home/user/docs):" 8 55 "/" 3>&1 1>&2 2>&3)
            [ $? -ne 0 ] && return 1
            ;;
    esac

    # Ask destination
    local dest_path
    dest_path=$(dialog --backtitle "$BACKTITLE" --title "Destino" \
        --inputbox "¿Dónde restaurar en ESTE equipo?\n(Ruta local destino):" 9 55 "/mnt/restore" 3>&1 1>&2 2>&3)
    [ $? -ne 0 ] && return 1

    # Create destination
    mkdir -p "$dest_path" 2>/dev/null

    # Confirm
    dialog --backtitle "$BACKTITLE" --title "Confirmar restauración" --yesno \
        "Restaurar archivos:\n\n  Origen: backup ${version} → ${source_path}\n  Destino: ${dest_path}\n  NAS: ${NAS_ADDR}\n\n¿Continuar?" 12 60
    [ $? -ne 0 ] && return 1

    # Download and restore via rsync from NAS
    # The NAS serves files, we pull via API download
    restore_files_download "$device_id" "$version" "$source_path" "$dest_path"
}

browse_backup_dirs() {
    local device_id="$1"
    local version="$2"
    local current_path="$3"

    while true; do
        local response
        response=$(api_get "/active-backup/devices/${device_id}/browse?version=${version}&path=${current_path}")
        
        local files_json
        files_json=$(echo "$response" | jq -r '.files // []' 2>/dev/null)
        
        local menu_items=()
        
        # Add parent directory option
        if [ "$current_path" != "/" ]; then
            menu_items+=(".." "⬆️  Directorio anterior")
        fi
        
        # Add "select this" option
        menu_items+=("SELECCIONAR" "✅ Restaurar esta carpeta: ${current_path}")
        
        # List directories
        local count
        count=$(echo "$files_json" | jq 'length' 2>/dev/null)
        local i=0
        while [ $i -lt "${count:-0}" ]; do
            local name is_dir size
            name=$(echo "$files_json" | jq -r ".[$i].name" 2>/dev/null)
            is_dir=$(echo "$files_json" | jq -r ".[$i].isDirectory // false" 2>/dev/null)
            size=$(echo "$files_json" | jq -r ".[$i].size // 0" 2>/dev/null)
            
            if [ "$is_dir" = "true" ]; then
                menu_items+=("$name" "📁 ${name}/")
            else
                # Show files but they won't navigate deeper
                local human_size
                human_size=$(numfmt --to=iec "$size" 2>/dev/null || echo "${size}B")
                menu_items+=("$name" "📄 ${human_size}")
            fi
            i=$((i + 1))
        done

        local choice
        choice=$(dialog --backtitle "$BACKTITLE" --title "📂 ${current_path}" \
            --menu "Navega por el backup:" 20 65 12 \
            "${menu_items[@]}" 3>&1 1>&2 2>&3)
        
        [ $? -ne 0 ] && return 1

        case "$choice" in
            "..")
                current_path=$(dirname "$current_path")
                [ "$current_path" = "." ] && current_path="/"
                ;;
            "SELECCIONAR")
                echo "$current_path"
                return 0
                ;;
            *)
                # Check if it's a directory
                local is_dir_check
                is_dir_check=$(echo "$files_json" | jq -r ".[] | select(.name==\"${choice}\") | .isDirectory // false" 2>/dev/null)
                if [ "$is_dir_check" = "true" ]; then
                    if [ "$current_path" = "/" ]; then
                        current_path="/${choice}"
                    else
                        current_path="${current_path}/${choice}"
                    fi
                else
                    # Selected a file — use its path
                    if [ "$current_path" = "/" ]; then
                        echo "/${choice}"
                    else
                        echo "${current_path}/${choice}"
                    fi
                    return 0
                fi
                ;;
        esac
    done
}

restore_files_download() {
    local device_id="$1"
    local version="$2"
    local source_path="$3"
    local dest_path="$4"

    log "Starting file restore: device=$device_id version=$version source=$source_path dest=$dest_path"

    # Get file listing recursively
    local response
    response=$(api_get "/active-backup/devices/${device_id}/browse?version=${version}&path=${source_path}")
    
    local files_json
    files_json=$(echo "$response" | jq -r '.files // []' 2>/dev/null)
    local total_files
    total_files=$(echo "$files_json" | jq 'length' 2>/dev/null)

    if [ -z "$total_files" ] || [ "$total_files" = "0" ]; then
        show_error "No se encontraron archivos para restaurar"
        return 1
    fi

    # Download each file via API
    local current=0
    local errors=0

    (
        local i=0
        while [ $i -lt "$total_files" ]; do
            local name is_dir file_path
            name=$(echo "$files_json" | jq -r ".[$i].name" 2>/dev/null)
            is_dir=$(echo "$files_json" | jq -r ".[$i].isDirectory // false" 2>/dev/null)
            
            if [ "$source_path" = "/" ]; then
                file_path="/${name}"
            else
                file_path="${source_path}/${name}"
            fi

            local pct=$(( (i * 100) / total_files ))
            echo "$pct"
            echo "XXX"
            echo "Restaurando: ${name}\n(${i}/${total_files})"
            echo "XXX"

            if [ "$is_dir" = "true" ]; then
                mkdir -p "${dest_path}${file_path}" 2>/dev/null
            else
                # Download file from NAS
                local dest_file="${dest_path}${file_path}"
                mkdir -p "$(dirname "$dest_file")" 2>/dev/null
                
                local dl_path
                dl_path=$(echo "$file_path" | sed 's|^/||')
                
                curl -sk -o "$dest_file" \
                    -H "X-Session-Id: ${SESSION_ID}" \
                    "${API_BASE}/active-backup/devices/${device_id}/download?version=${version}&path=${dl_path}" 2>/dev/null
                
                if [ $? -ne 0 ]; then
                    echo "Error descargando: $file_path" >> "$RESTORE_LOG"
                    errors=$((errors + 1))
                fi
            fi
            
            i=$((i + 1))
        done
        echo "100"
    ) | dialog --backtitle "$BACKTITLE" --title "📥 Restaurando archivos" \
        --gauge "Preparando..." 8 60 0

    log "File restore completed. Errors: $errors"
    
    show_info "Restauración completada\n\nArchivos: ${total_files}\nDestino: ${dest_path}\nErrores: ${errors}"
}

###############################################################################
# Restore full disk image
###############################################################################

restore_image() {
    local device_id="$1"
    local version="$2"

    # Get device info to know OS type
    local response
    response=$(api_get "/active-backup/devices")
    
    local device_json
    device_json=$(echo "$response" | jq -r ".devices[] | select(.id==\"${device_id}\")" 2>/dev/null)
    local os_type
    os_type=$(echo "$device_json" | jq -r '.os // "linux"' 2>/dev/null)

    # Check what images are available
    local images_response
    images_response=$(api_get "/active-backup/devices/${device_id}/images?version=${version}")
    
    local images
    images=$(echo "$images_response" | jq -r '.images // []' 2>/dev/null)
    local img_count
    img_count=$(echo "$images" | jq 'length' 2>/dev/null)

    if [ -z "$img_count" ] || [ "$img_count" = "0" ]; then
        # Try listing files in the version directory
        images_response=$(api_get "/active-backup/devices/${device_id}/browse?version=${version}&path=/")
        images=$(echo "$images_response" | jq -r '[.files[] | select(.name | test("\\.(img|img\\.gz|img\\.xz|wim|partclone|dd)$"))]' 2>/dev/null)
        img_count=$(echo "$images" | jq 'length' 2>/dev/null)
    fi

    # Select target disk
    local target_disk
    target_disk=$(select_target_disk)
    [ $? -ne 0 ] && return 1

    case "$os_type" in
        "windows")
            restore_image_windows "$device_id" "$version" "$target_disk"
            ;;
        *)
            restore_image_linux "$device_id" "$version" "$target_disk"
            ;;
    esac
}

###############################################################################
# Linux image restore (dd/partclone)
###############################################################################

restore_image_linux() {
    local device_id="$1"
    local version="$2"
    local target_disk="$3"

    log "Starting Linux image restore to $target_disk"

    # List image files in backup
    local response
    response=$(api_get "/active-backup/devices/${device_id}/browse?version=${version}&path=/")
    
    local files_json
    files_json=$(echo "$response" | jq -r '.files // []' 2>/dev/null)

    # Find image files (.img, .img.gz, .img.xz, .partclone, .dd)
    local img_files=()
    local img_names=()
    local count
    count=$(echo "$files_json" | jq 'length' 2>/dev/null)
    local i=0
    while [ $i -lt "${count:-0}" ]; do
        local name size
        name=$(echo "$files_json" | jq -r ".[$i].name" 2>/dev/null)
        size=$(echo "$files_json" | jq -r ".[$i].size // 0" 2>/dev/null)
        
        if echo "$name" | grep -qiE '\.(img|img\.gz|img\.xz|partclone|dd)(\.gz|\.xz)?$'; then
            local human_size
            human_size=$(numfmt --to=iec "$size" 2>/dev/null || echo "${size}B")
            img_files+=("$name")
            img_names+=("$name" "${human_size}")
        fi
        i=$((i + 1))
    done

    # Check for partition table backup
    local has_pt_backup=false
    local pt_file=""
    for f in "${img_files[@]}"; do
        if echo "$f" | grep -qiE '(partition-table|pt|sfdisk|sgdisk)\.(dump|bak|backup)'; then
            has_pt_backup=true
            pt_file="$f"
        fi
    done

    # Check for full disk image (single file)
    local full_disk_img=""
    for f in "${img_files[@]}"; do
        if echo "$f" | grep -qiE '^(disk|full|sda|nvme).*\.(img|dd)(\.gz|\.xz)?$'; then
            full_disk_img="$f"
        fi
    done

    if [ -n "$full_disk_img" ]; then
        # Full disk image — write directly
        dialog --backtitle "$BACKTITLE" --title "Restaurando imagen completa" --yesno \
            "Se encontró imagen de disco completa:\n  ${full_disk_img}\n\nSe escribirá directamente en:\n  ${target_disk}\n\n¿Continuar?" 12 60
        [ $? -ne 0 ] && return 1

        restore_single_image "$device_id" "$version" "$full_disk_img" "$target_disk"
    elif [ ${#img_files[@]} -gt 0 ]; then
        # Multiple partition images
        restore_partition_images "$device_id" "$version" "$target_disk" "${img_files[@]}"
    else
        show_error "No se encontraron imágenes de disco en este backup.\n\nAsegúrate de que el backup se hizo en modo 'image'."
        return 1
    fi
}

restore_single_image() {
    local device_id="$1"
    local version="$2"
    local image_file="$3"
    local target_disk="$4"

    log "Restoring full disk image: $image_file → $target_disk"

    # Unmount any partitions on target
    for part in "${target_disk}"*; do
        umount "$part" 2>/dev/null
    done

    # Get the image size for progress
    local img_size_response
    img_size_response=$(api_get "/active-backup/devices/${device_id}/browse?version=${version}&path=/")
    local img_size
    img_size=$(echo "$img_size_response" | jq -r ".files[] | select(.name==\"${image_file}\") | .size // 0" 2>/dev/null)

    # Determine decompression
    local decompress_cmd="cat"
    if echo "$image_file" | grep -q '\.gz$'; then
        decompress_cmd="pigz -dc"
        command -v pigz &>/dev/null || decompress_cmd="gzip -dc"
    elif echo "$image_file" | grep -q '\.xz$'; then
        decompress_cmd="xz -dc"
    fi

    # Determine restore command
    local write_cmd="dd of=${target_disk} bs=4M status=none"
    if echo "$image_file" | grep -q '\.partclone'; then
        write_cmd="partclone.restore -s - -o ${target_disk}"
    fi

    # Download and write
    (
        echo "10"
        echo "XXX"
        echo "Descargando y escribiendo imagen...\n${image_file} → ${target_disk}"
        echo "XXX"

        local dl_path
        dl_path=$(echo "$image_file" | sed 's|^/||')
        
        curl -sk \
            -H "X-Session-Id: ${SESSION_ID}" \
            "${API_BASE}/active-backup/devices/${device_id}/download?version=${version}&path=${dl_path}" 2>/dev/null \
            | $decompress_cmd \
            | dd of="$target_disk" bs=4M status=none conv=fsync 2>>"$RESTORE_LOG"

        echo "90"
        echo "XXX"
        echo "Sincronizando disco..."
        echo "XXX"
        sync

        echo "100"
    ) | dialog --backtitle "$BACKTITLE" --title "💾 Restaurando imagen" \
        --gauge "Preparando descarga..." 8 60 0

    # Verify
    if [ $? -eq 0 ]; then
        # Re-read partition table
        partprobe "$target_disk" 2>/dev/null
        
        log "Image restore completed: $image_file → $target_disk"
        show_info "✅ Imagen restaurada correctamente\n\n${image_file} → ${target_disk}\n\nPuedes reiniciar desde el disco restaurado."
    else
        show_error "Error durante la restauración.\n\nRevisa el log: ${RESTORE_LOG}"
    fi
}

restore_partition_images() {
    local device_id="$1"
    local version="$2"
    local target_disk="$3"
    shift 3
    local images=("$@")

    log "Restoring partition images to $target_disk"

    # Restore partition table first if available
    local pt_file=""
    for f in "${images[@]}"; do
        if echo "$f" | grep -qiE '(partition-table|sfdisk|sgdisk)\.(dump|bak)'; then
            pt_file="$f"
            break
        fi
    done

    local step=0
    local total=${#images[@]}

    (
        # Restore partition table
        if [ -n "$pt_file" ]; then
            echo "5"
            echo "XXX"
            echo "Restaurando tabla de particiones..."
            echo "XXX"

            local pt_path
            pt_path=$(echo "$pt_file" | sed 's|^/||')
            
            local pt_data
            pt_data=$(curl -sk \
                -H "X-Session-Id: ${SESSION_ID}" \
                "${API_BASE}/active-backup/devices/${device_id}/download?version=${version}&path=${pt_path}" 2>/dev/null)

            if echo "$pt_file" | grep -qi "sgdisk"; then
                echo "$pt_data" | sgdisk --load-backup=- "$target_disk" 2>>"$RESTORE_LOG"
            else
                echo "$pt_data" | sfdisk "$target_disk" 2>>"$RESTORE_LOG"
            fi
            partprobe "$target_disk" 2>/dev/null
            sleep 2
        fi

        # Restore each partition image
        for img in "${images[@]}"; do
            # Skip partition table files
            echo "$img" | grep -qiE '(partition-table|sfdisk|sgdisk)' && continue

            step=$((step + 1))
            local pct=$(( (step * 100) / (total + 1) ))
            echo "$pct"
            echo "XXX"
            echo "Restaurando partición: ${img}\n(${step}/${total})"
            echo "XXX"

            # Determine target partition from filename
            # Naming convention: part1.img, part2.img, sda1.img, nvme0n1p1.img etc.
            local part_num
            part_num=$(echo "$img" | grep -oP '(?:part|p|sda|nvme\dn\dp)(\d+)' | grep -oP '\d+$')
            
            if [ -z "$part_num" ]; then
                # Try sequential numbering
                part_num="$step"
            fi

            local target_part
            if echo "$target_disk" | grep -q "nvme"; then
                target_part="${target_disk}p${part_num}"
            else
                target_part="${target_disk}${part_num}"
            fi

            if [ ! -b "$target_part" ]; then
                echo "Partition $target_part not found, skipping" >> "$RESTORE_LOG"
                continue
            fi

            # Determine decompression
            local decompress_cmd="cat"
            if echo "$img" | grep -q '\.gz$'; then
                decompress_cmd="pigz -dc"
                command -v pigz &>/dev/null || decompress_cmd="gzip -dc"
            elif echo "$img" | grep -q '\.xz$'; then
                decompress_cmd="xz -dc"
            fi

            # Download and write
            local dl_path
            dl_path=$(echo "$img" | sed 's|^/||')
            
            if echo "$img" | grep -qi 'partclone'; then
                curl -sk \
                    -H "X-Session-Id: ${SESSION_ID}" \
                    "${API_BASE}/active-backup/devices/${device_id}/download?version=${version}&path=${dl_path}" 2>/dev/null \
                    | $decompress_cmd \
                    | partclone.restore -s - -o "$target_part" 2>>"$RESTORE_LOG"
            elif echo "$img" | grep -qi 'ntfsclone'; then
                curl -sk \
                    -H "X-Session-Id: ${SESSION_ID}" \
                    "${API_BASE}/active-backup/devices/${device_id}/download?version=${version}&path=${dl_path}" 2>/dev/null \
                    | $decompress_cmd \
                    | ntfsclone --restore-image -O "$target_part" - 2>>"$RESTORE_LOG"
            else
                curl -sk \
                    -H "X-Session-Id: ${SESSION_ID}" \
                    "${API_BASE}/active-backup/devices/${device_id}/download?version=${version}&path=${dl_path}" 2>/dev/null \
                    | $decompress_cmd \
                    | dd of="$target_part" bs=4M status=none conv=fsync 2>>"$RESTORE_LOG"
            fi
        done

        echo "95"
        echo "XXX"
        echo "Sincronizando..."
        echo "XXX"
        sync

        echo "100"
    ) | dialog --backtitle "$BACKTITLE" --title "💾 Restaurando particiones" \
        --gauge "Preparando..." 8 60 0

    partprobe "$target_disk" 2>/dev/null

    log "Partition restore completed"
    show_info "✅ Particiones restauradas en ${target_disk}\n\nPuedes reiniciar desde el disco restaurado."
}

###############################################################################
# Windows image restore
###############################################################################

restore_image_windows() {
    local device_id="$1"
    local version="$2"
    local target_disk="$3"

    log "Starting Windows image restore to $target_disk"

    # Browse backup directory for WIM/image files
    local response
    response=$(api_get "/active-backup/devices/${device_id}/browse?version=${version}&path=/")
    local files_json
    files_json=$(echo "$response" | jq -r '.files // []' 2>/dev/null)

    # Find WIM files and disk images
    local wim_file=""
    local efi_img=""
    local recovery_img=""
    local full_img=""

    local count
    count=$(echo "$files_json" | jq 'length' 2>/dev/null)
    local i=0
    while [ $i -lt "${count:-0}" ]; do
        local name
        name=$(echo "$files_json" | jq -r ".[$i].name" 2>/dev/null)
        
        case "$name" in
            *.wim) wim_file="$name" ;;
            *efi*|*EFI*|*boot*.img*) efi_img="$name" ;;
            *recovery*|*Recovery*) recovery_img="$name" ;;
            *.img|*.img.gz|*.dd|*.dd.gz) full_img="$name" ;;
        esac
        i=$((i + 1))
    done

    if [ -n "$full_img" ]; then
        # Full disk image — easiest path
        restore_single_image "$device_id" "$version" "$full_img" "$target_disk"
        return
    fi

    if [ -z "$wim_file" ]; then
        show_error "No se encontró imagen Windows (WIM o disco completo).\n\nVerifica que el backup se realizó correctamente."
        return 1
    fi

    # Windows WIM-based restore
    dialog --backtitle "$BACKTITLE" --title "🪟 Windows Restore" --yesno \
        "Se encontró imagen Windows WIM:\n  ${wim_file}\n\nSe crearán las particiones necesarias:\n  - EFI (512MB)\n  - MSR (16MB)\n  - Windows (resto)\n\n¿Continuar?" 14 60
    [ $? -ne 0 ] && return 1

    (
        echo "5"
        echo "XXX"
        echo "Creando tabla de particiones GPT..."
        echo "XXX"

        # Unmount everything
        for part in "${target_disk}"*; do
            umount "$part" 2>/dev/null
        done

        # Create GPT partition table
        sgdisk --zap-all "$target_disk" 2>>"$RESTORE_LOG"
        sgdisk --new=1:0:+512M --typecode=1:ef00 --change-name=1:"EFI" "$target_disk" 2>>"$RESTORE_LOG"
        sgdisk --new=2:0:+16M --typecode=2:0c01 --change-name=2:"MSR" "$target_disk" 2>>"$RESTORE_LOG"
        sgdisk --new=3:0:0 --typecode=3:0700 --change-name=3:"Windows" "$target_disk" 2>>"$RESTORE_LOG"
        partprobe "$target_disk" 2>/dev/null
        sleep 2

        # Determine partition names
        local efi_part win_part
        if echo "$target_disk" | grep -q "nvme"; then
            efi_part="${target_disk}p1"
            win_part="${target_disk}p3"
        else
            efi_part="${target_disk}1"
            win_part="${target_disk}3"
        fi

        echo "15"
        echo "XXX"
        echo "Formateando particiones..."
        echo "XXX"

        # Format
        mkfs.vfat -F32 "$efi_part" 2>>"$RESTORE_LOG"
        mkfs.ntfs -f "$win_part" 2>>"$RESTORE_LOG"

        echo "20"
        echo "XXX"
        echo "Descargando imagen WIM desde NAS...\nEsto puede tardar varios minutos."
        echo "XXX"

        # Download WIM to temp
        local wim_tmp="/tmp/homepinas-windows.wim"
        local dl_path
        dl_path=$(echo "$wim_file" | sed 's|^/||')
        
        curl -sk \
            -H "X-Session-Id: ${SESSION_ID}" \
            -o "$wim_tmp" \
            "${API_BASE}/active-backup/devices/${device_id}/download?version=${version}&path=${dl_path}" 2>>"$RESTORE_LOG"

        echo "50"
        echo "XXX"
        echo "Aplicando imagen Windows (wimapply)...\nEsto puede tardar 10-30 minutos."
        echo "XXX"

        # Mount Windows partition
        local win_mount="/mnt/win-restore"
        mkdir -p "$win_mount"
        mount "$win_part" "$win_mount"

        # Apply WIM
        wimapply "$wim_tmp" 1 "$win_mount" 2>>"$RESTORE_LOG"

        echo "80"
        echo "XXX"
        echo "Configurando bootloader EFI..."
        echo "XXX"

        # Mount EFI and set up boot
        local efi_mount="/mnt/efi-restore"
        mkdir -p "$efi_mount"
        mount "$efi_part" "$efi_mount"

        # Restore EFI boot from backup or rebuild
        if [ -n "$efi_img" ]; then
            local efi_dl_path
            efi_dl_path=$(echo "$efi_img" | sed 's|^/||')
            curl -sk \
                -H "X-Session-Id: ${SESSION_ID}" \
                "${API_BASE}/active-backup/devices/${device_id}/download?version=${version}&path=${efi_dl_path}" 2>/dev/null \
                | tar -xzf - -C "$efi_mount" 2>/dev/null
        else
            # Try to rebuild boot files from the Windows installation
            mkdir -p "$efi_mount/EFI/Microsoft/Boot"
            if [ -f "$win_mount/Windows/Boot/EFI/bootmgfw.efi" ]; then
                cp "$win_mount/Windows/Boot/EFI/bootmgfw.efi" "$efi_mount/EFI/Microsoft/Boot/"
                cp "$win_mount/Windows/Boot/EFI/bootmgfw.efi" "$efi_mount/EFI/boot/bootx64.efi" 2>/dev/null
            fi
            # Create BCD store
            if command -v bcdboot &>/dev/null; then
                bcdboot "$win_mount/Windows" --s "$efi_mount" --l es-ES 2>>"$RESTORE_LOG"
            fi
        fi

        echo "90"
        echo "XXX"
        echo "Limpiando y sincronizando..."
        echo "XXX"

        umount "$efi_mount" 2>/dev/null
        umount "$win_mount" 2>/dev/null
        rm -f "$wim_tmp"
        sync

        echo "100"
    ) | dialog --backtitle "$BACKTITLE" --title "🪟 Restaurando Windows" \
        --gauge "Preparando..." 8 60 0

    partprobe "$target_disk" 2>/dev/null

    log "Windows image restore completed"
    show_info "✅ Windows restaurado en ${target_disk}\n\nParticiones creadas:\n  1. EFI (512MB)\n  2. MSR (16MB)\n  3. Windows (NTFS)\n\nRetira el USB y reinicia desde el disco."
}

###############################################################################
# Disk utilities
###############################################################################

disk_utilities_menu() {
    while true; do
        local choice
        choice=$(dialog --backtitle "$BACKTITLE" --title "🔧 Utilidades de disco" \
            --menu "Herramientas de disco:" 15 55 7 \
            "info" "📋 Información de discos" \
            "smart" "🔍 Estado SMART" \
            "part" "📊 Ver particiones" \
            "mount" "📁 Montar partición" \
            "umount" "⏏️  Desmontar partición" \
            "shell" "💻 Abrir terminal" \
            "back" "⬅️  Volver" 3>&1 1>&2 2>&3)
        
        [ $? -ne 0 ] && return

        case "$choice" in
            "info")
                local disk_info
                disk_info=$(lsblk -o NAME,SIZE,TYPE,FSTYPE,MOUNTPOINT,MODEL 2>/dev/null)
                dialog --backtitle "$BACKTITLE" --title "Discos detectados" \
                    --msgbox "$disk_info" 20 75
                ;;
            "smart")
                local disks
                disks=$(lsblk -dnpo NAME 2>/dev/null)
                local smart_output=""
                for disk in $disks; do
                    [[ "$disk" =~ loop|ram ]] && continue
                    smart_output+="═══ ${disk} ═══\n"
                    smart_output+=$(smartctl -H "$disk" 2>/dev/null | grep -E "SMART|result|Health" || echo "No SMART disponible")
                    smart_output+="\n\n"
                done
                dialog --backtitle "$BACKTITLE" --title "Estado SMART" \
                    --msgbox "$smart_output" 20 70
                ;;
            "part")
                local part_info
                part_info=$(fdisk -l 2>/dev/null | head -80)
                dialog --backtitle "$BACKTITLE" --title "Particiones" \
                    --msgbox "$part_info" 22 75
                ;;
            "mount")
                local part_dev
                part_dev=$(dialog --backtitle "$BACKTITLE" --inputbox \
                    "Dispositivo a montar (ej: /dev/sda1):" 8 50 "" 3>&1 1>&2 2>&3)
                [ $? -ne 0 ] && continue
                local mount_point="/mnt/manual"
                mkdir -p "$mount_point"
                if mount "$part_dev" "$mount_point" 2>/tmp/mount_err; then
                    show_info "Montado: ${part_dev} → ${mount_point}"
                else
                    show_error "Error montando: $(cat /tmp/mount_err)"
                fi
                ;;
            "umount")
                local umount_dev
                umount_dev=$(dialog --backtitle "$BACKTITLE" --inputbox \
                    "Punto de montaje o dispositivo a desmontar:" 8 50 "/mnt/manual" 3>&1 1>&2 2>&3)
                [ $? -ne 0 ] && continue
                if umount "$umount_dev" 2>/tmp/umount_err; then
                    show_info "Desmontado: ${umount_dev}"
                else
                    show_error "Error: $(cat /tmp/umount_err)"
                fi
                ;;
            "shell")
                clear
                echo -e "${CYAN}═══ Terminal HomePiNAS Recovery ═══${NC}"
                echo -e "Escribe ${BOLD}exit${NC} para volver al menú"
                echo ""
                /bin/bash
                ;;
            "back")
                return
                ;;
        esac
    done
}

###############################################################################
# System info
###############################################################################

show_system_info() {
    local info=""
    info+="═══ Sistema ═══\n"
    info+="Hostname: $(hostname)\n"
    info+="Kernel: $(uname -r)\n"
    info+="Arch: $(uname -m)\n"
    info+="\n═══ Red ═══\n"
    info+="$(ip -4 addr show | grep -E 'inet ' | awk '{print $NF": "$2}')\n"
    info+="\n═══ NAS ═══\n"
    if [ -n "$NAS_ADDR" ]; then
        info+="Conectado a: ${NAS_ADDR}\n"
        info+="Sesión: ${SESSION_ID:0:16}...\n"
    else
        info+="No conectado\n"
    fi
    info+="\n═══ Discos ═══\n"
    info+="$(lsblk -o NAME,SIZE,TYPE,MODEL 2>/dev/null)\n"
    info+="\n═══ Memoria ═══\n"
    info+="$(free -h | head -2)\n"

    dialog --backtitle "$BACKTITLE" --title "ℹ️  Información del sistema" \
        --msgbox "$info" 25 70
}

###############################################################################
# Main menu
###############################################################################

main_menu() {
    while true; do
        local nas_status="❌ Sin conexión"
        if [ -n "$SESSION_ID" ]; then
            nas_status="✅ ${NAS_ADDR}"
        fi

        local choice
        choice=$(dialog --backtitle "$BACKTITLE" --title "Menú principal — NAS: ${nas_status}" \
            --menu "¿Qué deseas hacer?" 16 60 8 \
            "restore" "🔄 Restaurar backup" \
            "connect" "🔌 Conectar a NAS" \
            "disks" "🔧 Utilidades de disco" \
            "info" "ℹ️  Información del sistema" \
            "log" "📝 Ver log de operaciones" \
            "shell" "💻 Abrir terminal" \
            "reboot" "🔃 Reiniciar equipo" \
            "poweroff" "⏻  Apagar equipo" 3>&1 1>&2 2>&3)
        
        [ $? -ne 0 ] && exit_menu

        case "$choice" in
            "restore")
                if [ -z "$SESSION_ID" ]; then
                    show_error "Primero debes conectarte al NAS.\n\nSelecciona 'Conectar a NAS' del menú."
                    continue
                fi
                restore_menu
                ;;
            "connect")
                connect_to_nas
                ;;
            "disks")
                disk_utilities_menu
                ;;
            "info")
                show_system_info
                ;;
            "log")
                if [ -f "$RESTORE_LOG" ]; then
                    dialog --backtitle "$BACKTITLE" --title "Log" \
                        --textbox "$RESTORE_LOG" 22 75
                else
                    show_info "No hay log todavía."
                fi
                ;;
            "shell")
                clear
                echo -e "${CYAN}═══ Terminal HomePiNAS Recovery ═══${NC}"
                echo -e "Escribe ${BOLD}exit${NC} para volver al menú"
                echo ""
                /bin/bash
                ;;
            "reboot")
                confirm "¿Reiniciar el equipo?" && reboot
                ;;
            "poweroff")
                confirm "¿Apagar el equipo?" && poweroff
                ;;
        esac
    done
}

connect_to_nas() {
    # Reset connection
    SESSION_ID=""
    NAS_ADDR=""
    API_BASE=""

    discover_nas_tui || return 1
    
    # Login loop (3 attempts)
    local attempts=0
    while [ $attempts -lt 3 ]; do
        login_tui && return 0
        attempts=$((attempts + 1))
        if [ $attempts -lt 3 ]; then
            dialog --backtitle "$BACKTITLE" --yesno \
                "Intento ${attempts}/3 fallido.\n\n¿Reintentar?" 7 40
            [ $? -ne 0 ] && return 1
        fi
    done

    show_error "Demasiados intentos fallidos."
    return 1
}

restore_menu() {
    # Select device
    local device_id
    device_id=$(select_device)
    [ $? -ne 0 ] && return

    # Get device type
    local response
    response=$(api_get "/active-backup/devices")
    local device_json
    device_json=$(echo "$response" | jq -r ".devices[] | select(.id==\"${device_id}\")" 2>/dev/null)
    local backup_type
    backup_type=$(echo "$device_json" | jq -r '.type // "files"' 2>/dev/null)
    local device_name
    device_name=$(echo "$device_json" | jq -r '.name // "Unknown"' 2>/dev/null)

    # Select version
    local version
    version=$(select_version "$device_id")
    [ $? -ne 0 ] && return

    log "Selected device: $device_name ($device_id), version: $version, type: $backup_type"

    # Route to appropriate restore
    case "$backup_type" in
        "image")
            restore_image "$device_id" "$version"
            ;;
        "files"|*)
            restore_files "$device_id" "$version"
            ;;
    esac
}

exit_menu() {
    dialog --backtitle "$BACKTITLE" --title "Salir" --yesno \
        "¿Qué deseas hacer?" 9 45 \
        --yes-label "Volver al menú" \
        --no-label "Salir al terminal"
    
    if [ $? -ne 0 ]; then
        clear
        echo -e "${GREEN}═══════════════════════════════════════${NC}"
        echo -e "${GREEN} HomePiNAS Recovery — Modo terminal${NC}"
        echo -e "${GREEN}═══════════════════════════════════════${NC}"
        echo ""
        echo -e "Escribe ${BOLD}homepinas-restore${NC} para volver al menú"
        echo ""
        exit 0
    fi
}

###############################################################################
# Startup
###############################################################################

main() {
    # Initialize log
    echo "═══ HomePiNAS Recovery Started $(date) ═══" > "$RESTORE_LOG"
    log "System: $(uname -a)"

    # Check if dialog is available
    if ! command -v dialog &>/dev/null; then
        echo -e "${RED}Error: 'dialog' no está instalado${NC}"
        echo "Instala con: apt-get install dialog"
        exit 1
    fi

    # Welcome screen
    dialog --backtitle "$BACKTITLE" --title "🏠 HomePiNAS Recovery" --msgbox \
        "Bienvenido al sistema de recuperación HomePiNAS\n\n\
Este asistente te guiará para:\n\n\
  🔍 Encontrar tu NAS en la red\n\
  📦 Seleccionar un backup existente\n\
  💾 Restaurar en el disco destino\n\n\
Soporta:\n\
  • Linux (dd, partclone)\n\
  • Windows (WIM, ntfsclone)\n\
  • Restauración de archivos individuales\n\n\
Asegúrate de que:\n\
  ✓ El NAS está encendido y en la misma red\n\
  ✓ El disco destino está conectado\n\
  ✓ Tienes credenciales del NAS" 22 58

    # Setup network
    setup_network

    # Try to auto-discover and connect
    dialog --backtitle "$BACKTITLE" --yesno \
        "¿Conectar al NAS automáticamente?" 6 45
    
    if [ $? -eq 0 ]; then
        connect_to_nas
    fi

    # Main loop
    main_menu
}

main "$@"
