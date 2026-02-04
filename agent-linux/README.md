# HomePiNAS Backup Agent — Linux

Agente de backup para Debian/Ubuntu. Daemon ligero en bash + systemd, sin GUI.

## Instalación

```bash
curl -fsSL https://raw.githubusercontent.com/juanlusoft/homepinas-v2/main/agent-linux/homepinas-agent.sh | sudo bash -s install
```

O manualmente:

```bash
wget https://raw.githubusercontent.com/juanlusoft/homepinas-v2/main/agent-linux/homepinas-agent.sh
chmod +x homepinas-agent.sh
sudo ./homepinas-agent.sh install
```

## Funcionamiento

1. **Auto-descubre** el NAS en la red (mDNS → hostname → subnet scan)
2. **Se registra** automáticamente
3. **Espera aprobación** del admin en el dashboard del NAS
4. **Backups automáticos** según el horario configurado desde el NAS

## Comandos

```bash
sudo homepinas-agent install     # Instalar como servicio
sudo homepinas-agent uninstall   # Desinstalar
sudo homepinas-agent status      # Ver estado
sudo homepinas-agent backup      # Backup manual
sudo homepinas-agent discover    # Buscar NAS
sudo homepinas-agent reset       # Reiniciar configuración
```

## Logs

```bash
journalctl -u homepinas-agent -f
```

## Config

Archivo: `/etc/homepinas-agent/agent.conf`

## Tipos de backup

- **files** — rsync incremental de las rutas configuradas
- **image** — partclone/dd del dispositivo raíz

## Dependencias

Se instalan automáticamente: `curl`, `cifs-utils`, `rsync`, `avahi-utils`

Opcionales para image backup: `partclone`

## Desinstalación

```bash
sudo homepinas-agent uninstall
```

La configuración se conserva en `/etc/homepinas-agent/`.
