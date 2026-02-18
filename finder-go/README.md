# HomePiNAS Finder

Encuentra tu HomePiNAS en la red local. Portable, sin instalación.

## ¿Qué hace?

1. Ejecutas el binario (doble clic)
2. Se abre tu navegador automáticamente
3. Escanea la red buscando dispositivos HomePiNAS
4. Click en el que quieras → se abre el dashboard

## Métodos de descubrimiento

- **DNS hostnames**: pinas.local, homepinas.local, nas.local...
- **Subnet scan**: escanea el puerto 443 en toda tu subred
- **Verificación HTTP**: confirma que es HomePiNAS via `/api/system/info`

## Descargas

| Plataforma | Archivo | Tamaño |
|---|---|---|
| Windows (64-bit) | `HomePiNAS-Finder-windows-amd64.exe` | ~6 MB |
| macOS (Intel) | `HomePiNAS-Finder-macos-amd64` | ~6 MB |
| macOS (Apple Silicon) | `HomePiNAS-Finder-macos-arm64` | ~6 MB |
| Linux (64-bit) | `HomePiNAS-Finder-linux-amd64` | ~6 MB |
| Linux (ARM64/Pi) | `HomePiNAS-Finder-linux-arm64` | ~6 MB |

## Compilar

```bash
# Requiere Go 1.21+
go build -ldflags="-s -w" -o HomePiNAS-Finder .

# Todas las plataformas
make all
```

## Notas

- **Zero install**: un solo ejecutable, sin dependencias
- **Privacidad**: todo local, no envía datos a ningún servidor
- **Auto-scan**: empieza a buscar al abrir
- **Self-signed TLS**: acepta certificados auto-firmados del NAS
