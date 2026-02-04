#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
# HomePiNAS Backup Agent — Linux (Debian/Ubuntu)
# Daemon CLI: auto-discover NAS → register → poll → backup
# ═══════════════════════════════════════════════════════════════════
set -euo pipefail

VERSION="1.0.0"
CONFIG_DIR="/etc/homepinas-agent"
CONFIG_FILE="$CONFIG_DIR/agent.conf"
LOG_TAG="homepinas-agent"
POLL_INTERVAL=60
DISCOVER_TIMEOUT=3

# ── Logging ──────────────────────────────────────────────────────
log()  { logger -t "$LOG_TAG" -p user.info  "$*"; echo "[$(date '+%F %T')] $*"; }
warn() { logger -t "$LOG_TAG" -p user.warn  "WARN: $*"; echo "[$(date '+%F %T')] WARN: $*" >&2; }
err()  { logger -t "$LOG_TAG" -p user.err   "ERROR: $*"; echo "[$(date '+%F %T')] ERROR: $*" >&2; }

# ── Config helpers ───────────────────────────────────────────────
load_config() {
  if [[ -f "$CONFIG_FILE" ]]; then
    source "$CONFIG_FILE"
  fi
  NAS_ADDRESS="${NAS_ADDRESS:-}"
  NAS_PORT="${NAS_PORT:-3001}"
  AGENT_ID="${AGENT_ID:-}"
  AGENT_TOKEN="${AGENT_TOKEN:-}"
  STATUS="${STATUS:-disconnected}"
  DEVICE_NAME="${DEVICE_NAME:-$(hostname)}"
  BACKUP_TYPE="${BACKUP_TYPE:-files}"
  BACKUP_PATHS="${BACKUP_PATHS:-/home}"
  SCHEDULE="${SCHEDULE:-0 3 * * *}"
  RETENTION="${RETENTION:-3}"
  SAMBA_SHARE="${SAMBA_SHARE:-}"
  SAMBA_USER="${SAMBA_USER:-}"
  SAMBA_PASS="${SAMBA_PASS:-}"
  LAST_BACKUP="${LAST_BACKUP:-}"
  LAST_RESULT="${LAST_RESULT:-}"
}

save_config() {
  mkdir -p "$CONFIG_DIR"
  cat > "$CONFIG_FILE" <<EOF
# HomePiNAS Backup Agent config — auto-generated
NAS_ADDRESS="$NAS_ADDRESS"
NAS_PORT="$NAS_PORT"
AGENT_ID="$AGENT_ID"
AGENT_TOKEN="$AGENT_TOKEN"
STATUS="$STATUS"
DEVICE_NAME="$DEVICE_NAME"
BACKUP_TYPE="$BACKUP_TYPE"
BACKUP_PATHS="$BACKUP_PATHS"
SCHEDULE="$SCHEDULE"
RETENTION="$RETENTION"
SAMBA_SHARE="$SAMBA_SHARE"
SAMBA_USER="$SAMBA_USER"
SAMBA_PASS="$SAMBA_PASS"
LAST_BACKUP="$LAST_BACKUP"
LAST_RESULT="$LAST_RESULT"
EOF
  chmod 600 "$CONFIG_FILE"
}

# ── API helpers ──────────────────────────────────────────────────
api_get() {
  local path="$1"
  shift
  curl -sSk --max-time 30 \
    -H "Content-Type: application/json" \
    "$@" \
    "https://${NAS_ADDRESS}:${NAS_PORT}/api${path}" 2>/dev/null
}

api_post() {
  local path="$1"
  local body="$2"
  shift 2
  curl -sSk --max-time 30 \
    -H "Content-Type: application/json" \
    -X POST -d "$body" \
    "$@" \
    "https://${NAS_ADDRESS}:${NAS_PORT}/api${path}" 2>/dev/null
}

# ── Network helpers ──────────────────────────────────────────────
get_local_ip() {
  ip -4 route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="src") print $(i+1)}' | head -1
}

get_mac() {
  local ip
  ip=$(get_local_ip)
  [[ -z "$ip" ]] && return
  local iface
  iface=$(ip -o addr show | grep "$ip" | awk '{print $2}' | head -1)
  [[ -n "$iface" ]] && cat "/sys/class/net/$iface/address" 2>/dev/null
}

# ── NAS Discovery ────────────────────────────────────────────────
discover_nas() {
  # All log output goes to stderr so stdout is clean for the result
  log "Buscando HomePiNAS en la red..." >&2
  local found=""

  # Method 1: mDNS / Avahi
  if command -v avahi-browse &>/dev/null; then
    log "  → Buscando via mDNS..." >&2
    local mdns_result
    mdns_result=$(avahi-browse -tpk _https._tcp 2>/dev/null | grep -i homepinas | head -1 || true)
    if [[ -n "$mdns_result" ]]; then
      local addr
      addr=$(echo "$mdns_result" | awk -F';' '{print $8}')
      if [[ -n "$addr" ]]; then
        found=$(check_nas "$addr" 3001)
      fi
    fi
  fi

  # Method 2: Common hostnames
  if [[ -z "$found" ]]; then
    log "  → Probando hostnames conocidos..." >&2
    for host in homepinas.local homepinas nas.local PiNas.local PiNas; do
      found=$(check_nas "$host" 3001)
      [[ -n "$found" ]] && break
    done
  fi

  # Method 3: Subnet scan
  if [[ -z "$found" ]]; then
    log "  → Escaneando subred..." >&2
    local local_ip subnet
    local_ip=$(get_local_ip)
    if [[ -n "$local_ip" ]]; then
      subnet="${local_ip%.*}"
      for i in $(seq 1 254); do
        local ip="${subnet}.${i}"
        [[ "$ip" == "$local_ip" ]] && continue
        found=$(check_nas "$ip" 3001)
        if [[ -n "$found" ]]; then
          break
        fi
      done
    fi
  fi

  if [[ -n "$found" ]]; then
    echo "$found"
  else
    return 1
  fi
}

check_nas() {
  local host="$1" port="$2"
  local result
  result=$(curl -sSk --connect-timeout "$DISCOVER_TIMEOUT" --max-time "$DISCOVER_TIMEOUT" \
    "https://${host}:${port}/api/system/stats" 2>/dev/null) || return 0
  if echo "$result" | grep -qE '"cpuModel"|"hostname"'; then
    echo "${host}:${port}"
  fi
}

# ── Registration ─────────────────────────────────────────────────
register_agent() {
  local local_ip mac
  local_ip=$(get_local_ip)
  mac=$(get_mac)

  log "Registrando agente en NAS ${NAS_ADDRESS}:${NAS_PORT}..."

  local body
  body=$(cat <<EOF
{
  "hostname": "$(hostname)",
  "ip": "${local_ip:-0.0.0.0}",
  "os": "linux",
  "mac": "${mac:-00:00:00:00:00:00}"
}
EOF
)

  local result
  result=$(api_post "/active-backup/agent/register" "$body") || {
    err "No se pudo registrar en el NAS"
    return 1
  }

  AGENT_ID=$(echo "$result" | grep -o '"agentId":"[^"]*"' | cut -d'"' -f4)
  AGENT_TOKEN=$(echo "$result" | grep -o '"agentToken":"[^"]*"' | cut -d'"' -f4)
  STATUS=$(echo "$result" | grep -o '"status":"[^"]*"' | cut -d'"' -f4)

  if [[ -z "$AGENT_TOKEN" ]]; then
    err "Registro fallido — sin token"
    return 1
  fi

  log "Registrado OK — ID: $AGENT_ID, Status: $STATUS"
  save_config
}

# ── Polling ──────────────────────────────────────────────────────
poll_nas() {
  [[ -z "$NAS_ADDRESS" || -z "$AGENT_TOKEN" ]] && return 1

  local result
  result=$(api_get "/active-backup/agent/poll" -H "X-Agent-Token: $AGENT_TOKEN") || return 1

  local new_status
  new_status=$(echo "$result" | grep -o '"status":"[^"]*"' | cut -d'"' -f4)

  if [[ "$new_status" == "approved" && "$STATUS" != "approved" ]]; then
    log "✅ Dispositivo aprobado por el NAS"
    STATUS="approved"
  elif [[ "$new_status" == "pending" ]]; then
    STATUS="pending"
  fi

  # Parse config from NAS
  if [[ "$new_status" == "approved" ]]; then
    local cfg_type cfg_schedule cfg_retention cfg_share cfg_user cfg_pass cfg_nas
    cfg_type=$(echo "$result" | grep -o '"backupType":"[^"]*"' | cut -d'"' -f4)
    cfg_schedule=$(echo "$result" | grep -o '"schedule":"[^"]*"' | cut -d'"' -f4)
    cfg_retention=$(echo "$result" | grep -o '"retention":[0-9]*' | cut -d: -f2)
    cfg_share=$(echo "$result" | grep -o '"sambaShare":"[^"]*"' | cut -d'"' -f4)
    cfg_user=$(echo "$result" | grep -o '"sambaUser":"[^"]*"' | cut -d'"' -f4)
    cfg_pass=$(echo "$result" | grep -o '"sambaPass":"[^"]*"' | cut -d'"' -f4)
    cfg_nas=$(echo "$result" | grep -o '"nasAddress":"[^"]*"' | cut -d'"' -f4)

    [[ -n "$cfg_type" ]]     && BACKUP_TYPE="$cfg_type"
    [[ -n "$cfg_schedule" ]] && SCHEDULE="$cfg_schedule"
    [[ -n "$cfg_retention" ]] && RETENTION="$cfg_retention"
    [[ -n "$cfg_share" ]]    && SAMBA_SHARE="$cfg_share"
    [[ -n "$cfg_user" ]]     && SAMBA_USER="$cfg_user"
    [[ -n "$cfg_pass" ]]     && SAMBA_PASS="$cfg_pass"
    [[ -n "$cfg_nas" ]]      && NAS_ADDRESS="$cfg_nas"

    save_config

    # Check if NAS triggered a manual backup
    local action
    action=$(echo "$result" | grep -o '"action":"[^"]*"' | cut -d'"' -f4)
    if [[ "$action" == "backup" ]]; then
      log "🔔 NAS solicitó backup manual"
      run_backup
    fi
  fi

  save_config
}

# ── Schedule check ───────────────────────────────────────────────
check_schedule() {
  [[ "$STATUS" != "approved" ]] && return
  [[ -z "$SCHEDULE" ]] && return

  local sched_min sched_hour now_min now_hour
  sched_min=$(echo "$SCHEDULE" | awk '{print $1}')
  sched_hour=$(echo "$SCHEDULE" | awk '{print $2}')
  now_min=$(date '+%-M')
  now_hour=$(date '+%-H')

  if [[ "$now_hour" == "$sched_hour" && "$now_min" == "$sched_min" ]]; then
    log "⏰ Hora programada — iniciando backup"
    run_backup
  fi
}

# ── Backup execution ────────────────────────────────────────────
BACKUP_RUNNING=false

run_backup() {
  [[ "$BACKUP_RUNNING" == "true" ]] && { warn "Backup ya en curso"; return; }
  BACKUP_RUNNING=true

  local start_time duration
  start_time=$(date +%s)

  log "Iniciando backup ($BACKUP_TYPE)..."

  local mount_point="/tmp/homepinas-backup-$$"
  mkdir -p "$mount_point"

  local result_status="success"
  local result_error=""

  # Mount Samba share
  local share_name="${SAMBA_SHARE:-active-backup}"
  if ! mount -t cifs "//${NAS_ADDRESS}/${share_name}" "$mount_point" \
    -o "username=${SAMBA_USER},password=${SAMBA_PASS},vers=3.0,uid=$(id -u),gid=$(id -g)" 2>/dev/null; then
    err "No se pudo montar el share //${NAS_ADDRESS}/${share_name}"
    result_status="error"
    result_error="No se pudo montar el share Samba"
    BACKUP_RUNNING=false
    report_result "$result_status" "$(($(date +%s) - start_time))" "$result_error"
    return 1
  fi

  if [[ "$BACKUP_TYPE" == "image" ]]; then
    run_image_backup "$mount_point" || {
      result_status="error"
      result_error="Backup de imagen falló"
    }
  else
    run_file_backup "$mount_point" || {
      result_status="error"
      result_error="Backup de archivos falló"
    }
  fi

  # Unmount
  sync
  umount "$mount_point" 2>/dev/null || umount -l "$mount_point" 2>/dev/null
  rmdir "$mount_point" 2>/dev/null

  duration=$(($(date +%s) - start_time))
  LAST_BACKUP=$(date -u '+%Y-%m-%dT%H:%M:%SZ')
  LAST_RESULT="$result_status"
  save_config

  if [[ "$result_status" == "success" ]]; then
    log "✅ Backup completado en ${duration}s"
  else
    err "❌ Backup fallido tras ${duration}s: $result_error"
  fi

  report_result "$result_status" "$duration" "$result_error"
  BACKUP_RUNNING=false
}

run_image_backup() {
  local mount_point="$1"
  local hostname
  hostname=$(hostname)
  local timestamp
  timestamp=$(date -u '+%Y-%m-%d_%H%M%S')
  local dest="${mount_point}/ImageBackup/${hostname}/${timestamp}"

  mkdir -p "$dest"

  # Find root device
  local root_dev
  root_dev=$(findmnt -n -o SOURCE / | head -1)
  if [[ -z "$root_dev" ]]; then
    err "No se pudo determinar el dispositivo raíz"
    return 1
  fi

  log "  Creando imagen de $root_dev..."

  if command -v partclone.ext4 &>/dev/null; then
    # Prefer partclone (space-efficient)
    partclone.ext4 -c -s "$root_dev" -o "${dest}/root.img" 2>/dev/null || {
      # Fallback: try generic partclone
      partclone.dd -s "$root_dev" -o "${dest}/root.img" 2>/dev/null || {
        err "partclone falló"
        return 1
      }
    }
  elif command -v dd &>/dev/null; then
    # Fallback to dd
    dd if="$root_dev" of="${dest}/root.img" bs=4M status=progress 2>/dev/null || {
      err "dd falló"
      return 1
    }
  else
    err "No se encontró partclone ni dd"
    return 1
  fi

  # Save partition info
  fdisk -l "$root_dev" > "${dest}/partition-info.txt" 2>/dev/null || true
  blkid "$root_dev" > "${dest}/blkid.txt" 2>/dev/null || true
  lsblk -f > "${dest}/lsblk.txt" 2>/dev/null || true

  log "  Imagen guardada en ${dest}/"
}

run_file_backup() {
  local mount_point="$1"
  local hostname
  hostname=$(hostname)
  local timestamp
  timestamp=$(date -u '+%Y-%m-%dT%H:%M:%SZ')
  local dest_base="${mount_point}/FileBackup/${hostname}"
  local failed=0

  # Split BACKUP_PATHS by : or space
  IFS=':' read -ra paths <<< "$BACKUP_PATHS"

  for src_path in "${paths[@]}"; do
    [[ -z "$src_path" ]] && continue
    [[ ! -d "$src_path" ]] && { warn "Ruta no existe: $src_path"; continue; }

    local folder_name
    folder_name=$(basename "$src_path")
    local dest="${dest_base}/${folder_name}"

    mkdir -p "$dest"
    log "  rsync: $src_path → $dest"

    if ! rsync -az --delete "$src_path/" "$dest/" 2>/dev/null; then
      warn "rsync falló para $src_path"
      failed=$((failed + 1))
    fi
  done

  [[ $failed -gt 0 ]] && return 1
  return 0
}

# ── Report result to NAS ────────────────────────────────────────
report_result() {
  local status="$1" duration="$2" error="${3:-}"

  [[ -z "$NAS_ADDRESS" || -z "$AGENT_TOKEN" ]] && return

  local body
  if [[ "$status" == "success" ]]; then
    body="{\"status\":\"success\",\"duration\":$duration}"
  else
    body="{\"status\":\"error\",\"duration\":$duration,\"error\":\"$error\"}"
  fi

  api_post "/active-backup/agent/report" "$body" \
    -H "X-Agent-Token: $AGENT_TOKEN" >/dev/null 2>&1 || true
}

# ── Install / Uninstall ─────────────────────────────────────────
install_service() {
  local script_path
  script_path=$(readlink -f "$0" 2>/dev/null || echo "")

  # Install dependencies
  log "Instalando dependencias..."
  apt-get update -qq
  apt-get install -y -qq curl cifs-utils rsync avahi-utils >/dev/null 2>&1 || true

  # Copy script — if piped (stdin), download fresh; otherwise copy the file
  if [[ -z "$script_path" || "$script_path" == *"/bash" || ! -f "$script_path" ]]; then
    log "Descargando agente..."
    curl -fsSL "https://raw.githubusercontent.com/juanlusoft/homepinas-v2/main/agent-linux/homepinas-agent.sh" \
      -o /usr/local/bin/homepinas-agent
  else
    cp "$script_path" /usr/local/bin/homepinas-agent
  fi
  chmod +x /usr/local/bin/homepinas-agent

  # Create systemd service
  cat > /etc/systemd/system/homepinas-agent.service <<EOF
[Unit]
Description=HomePiNAS Backup Agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=/usr/local/bin/homepinas-agent daemon
Restart=always
RestartSec=30
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

  systemctl daemon-reload
  systemctl enable homepinas-agent
  systemctl start homepinas-agent

  log "✅ Servicio instalado y arrancado"
  log "   Ver logs: journalctl -u homepinas-agent -f"
  log "   Estado:   systemctl status homepinas-agent"
  log "   Config:   $CONFIG_FILE"
}

uninstall_service() {
  systemctl stop homepinas-agent 2>/dev/null || true
  systemctl disable homepinas-agent 2>/dev/null || true
  rm -f /etc/systemd/system/homepinas-agent.service
  systemctl daemon-reload
  rm -f /usr/local/bin/homepinas-agent
  log "✅ Servicio desinstalado (config conservada en $CONFIG_DIR)"
}

# ── Daemon main loop ────────────────────────────────────────────
run_daemon() {
  log "HomePiNAS Backup Agent v${VERSION} — Linux"
  load_config

  # If no NAS configured, discover
  if [[ -z "$NAS_ADDRESS" ]]; then
    local nas_found
    nas_found=$(discover_nas) || {
      err "No se encontró ningún HomePiNAS en la red. Reintentando en 60s..."
      sleep 60
      exec "$0" daemon
    }
    NAS_ADDRESS="${nas_found%%:*}"
    NAS_PORT="${nas_found##*:}"
    save_config
    log "NAS encontrado: $NAS_ADDRESS:$NAS_PORT"
  fi

  # If not registered, register
  if [[ -z "$AGENT_TOKEN" ]]; then
    register_agent || {
      err "Registro fallido. Reintentando en 60s..."
      sleep 60
      exec "$0" daemon
    }
  fi

  log "Iniciando polling (cada ${POLL_INTERVAL}s)..."

  while true; do
    poll_nas || warn "Poll fallido — reintentando..."
    check_schedule
    sleep "$POLL_INTERVAL"
  done
}

# ── CLI ──────────────────────────────────────────────────────────
show_status() {
  load_config
  echo "═══════════════════════════════════════"
  echo "  HomePiNAS Backup Agent v${VERSION}"
  echo "═══════════════════════════════════════"
  echo "  NAS:          ${NAS_ADDRESS:-no configurado}:${NAS_PORT}"
  echo "  Estado:       ${STATUS}"
  echo "  Dispositivo:  ${DEVICE_NAME}"
  echo "  Tipo backup:  ${BACKUP_TYPE}"
  echo "  Rutas:        ${BACKUP_PATHS}"
  echo "  Horario:      ${SCHEDULE}"
  echo "  Retención:    ${RETENTION} versiones"
  echo "  Último:       ${LAST_BACKUP:-nunca} (${LAST_RESULT:-n/a})"
  echo "═══════════════════════════════════════"
}

usage() {
  cat <<EOF
HomePiNAS Backup Agent v${VERSION} — Linux

Uso: $(basename "$0") <comando>

Comandos:
  install     Instalar como servicio systemd
  uninstall   Desinstalar servicio
  daemon      Ejecutar en primer plano (usado por systemd)
  status      Ver estado actual
  backup      Ejecutar backup ahora
  discover    Buscar NAS en la red
  reset       Borrar configuración y empezar de nuevo

EOF
}

# ── Main ─────────────────────────────────────────────────────────
case "${1:-}" in
  install)
    [[ $EUID -ne 0 ]] && { err "Necesitas root: sudo $0 install"; exit 1; }
    install_service
    ;;
  uninstall)
    [[ $EUID -ne 0 ]] && { err "Necesitas root: sudo $0 uninstall"; exit 1; }
    uninstall_service
    ;;
  daemon)
    run_daemon
    ;;
  status)
    show_status
    ;;
  backup)
    [[ $EUID -ne 0 ]] && { err "Necesitas root para montar shares: sudo $0 backup"; exit 1; }
    load_config
    run_backup
    ;;
  discover)
    discover_nas && echo "NAS encontrado" || echo "No se encontró NAS"
    ;;
  reset)
    [[ $EUID -ne 0 ]] && { err "Necesitas root: sudo $0 reset"; exit 1; }
    rm -f "$CONFIG_FILE"
    log "Config borrada. El agente se re-registrará al reiniciar."
    systemctl restart homepinas-agent 2>/dev/null || true
    ;;
  -h|--help|help|"")
    usage
    ;;
  *)
    err "Comando desconocido: $1"
    usage
    exit 1
    ;;
esac
