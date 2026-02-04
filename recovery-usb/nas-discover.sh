#!/bin/bash
###############################################################################
# HomePiNAS NAS Discovery
# Finds HomePiNAS instances on the local network
###############################################################################

CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

# Try multiple discovery methods and return NAS IP + port
discover_nas() {
    local found_ip=""
    local found_port="3001"
    
    # Method 1: mDNS / Avahi
    if command -v avahi-browse &>/dev/null; then
        echo -e "${CYAN}Buscando NAS por mDNS...${NC}" >&2
        local mdns_result
        mdns_result=$(avahi-browse -trkp _https._tcp 2>/dev/null | grep "homepinas" | head -1)
        if [ -n "$mdns_result" ]; then
            found_ip=$(echo "$mdns_result" | awk -F';' '{print $8}')
            found_port=$(echo "$mdns_result" | awk -F';' '{print $9}')
            if [ -n "$found_ip" ]; then
                echo -e "${GREEN}✅ Encontrado por mDNS: ${found_ip}:${found_port}${NC}" >&2
                echo "${found_ip}:${found_port}"
                return 0
            fi
        fi
    fi
    
    # Method 2: Try homepinas.local
    echo -e "${CYAN}Probando homepinas.local...${NC}" >&2
    local resolved_ip
    resolved_ip=$(getent hosts homepinas.local 2>/dev/null | awk '{print $1}' | head -1)
    if [ -n "$resolved_ip" ]; then
        if curl -sk --connect-timeout 3 "https://${resolved_ip}:3001/api/system/stats" &>/dev/null; then
            echo -e "${GREEN}✅ Encontrado: ${resolved_ip}:3001${NC}" >&2
            echo "${resolved_ip}:3001"
            return 0
        fi
    fi
    
    # Method 3: Scan common subnets for HomePiNAS API
    echo -e "${CYAN}Escaneando red local...${NC}" >&2
    
    # Get local IP to determine subnet
    local local_ip
    local_ip=$(ip route get 1.1.1.1 2>/dev/null | grep -oP 'src \K\S+')
    if [ -z "$local_ip" ]; then
        local_ip=$(hostname -I 2>/dev/null | awk '{print $1}')
    fi
    
    if [ -n "$local_ip" ]; then
        local subnet
        subnet=$(echo "$local_ip" | sed 's/\.[0-9]*$/./')
        
        echo -e "${CYAN}Escaneando ${subnet}0/24...${NC}" >&2
        
        # Parallel scan of common IPs
        for i in $(seq 1 254); do
            (
                local ip="${subnet}${i}"
                if curl -sk --connect-timeout 1 --max-time 2 "https://${ip}:3001/api/system/stats" 2>/dev/null | grep -q "cpuModel"; then
                    echo "${ip}:3001"
                fi
            ) &
            
            # Limit parallel connections
            if (( i % 50 == 0 )); then
                wait
            fi
        done
        wait
    fi
    
    return 1
}

# Get list of backup devices from NAS
get_devices() {
    local nas_addr="$1"
    local session_id="$2"
    
    curl -sk "https://${nas_addr}/api/active-backup/devices" \
        -H "X-Session-Id: ${session_id}" 2>/dev/null
}

# Login to NAS
login_nas() {
    local nas_addr="$1"
    local username="$2"
    local password="$3"
    
    curl -sk "https://${nas_addr}/api/login" \
        -X POST \
        -H "Content-Type: application/json" \
        -d "{\"username\":\"${username}\",\"password\":\"${password}\"}" 2>/dev/null
}

# If run directly, discover and print
if [ "${BASH_SOURCE[0]}" = "$0" ]; then
    echo "=== HomePiNAS NAS Discovery ==="
    result=$(discover_nas)
    if [ -n "$result" ]; then
        echo -e "\n${GREEN}NAS encontrado en: ${result}${NC}"
    else
        echo -e "\n${RED}No se encontró ningún HomePiNAS en la red${NC}"
        echo "Asegúrate de que el NAS está encendido y en la misma red"
        exit 1
    fi
fi
