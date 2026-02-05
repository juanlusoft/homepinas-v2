# HomePiNAS Finder

App standalone para descubrir dispositivos HomePiNAS en tu red local.

## Características

- 🔍 **Escaneo automático** via mDNS, puerto 3001 y hostnames conocidos
- 📋 **Lista de dispositivos** con nombre, IP y versión
- 🚀 **Un clic para conectar** - abre el navegador directamente
- 🎨 **UI moderna** y minimalista
- 💻 **Multiplataforma** - Windows, macOS, Linux

## Desarrollo

```bash
# Instalar dependencias
npm install

# Ejecutar en modo desarrollo
npm start

# Ejecutar con DevTools
npm start -- --dev
```

## Empaquetado

```bash
# Todas las plataformas
npm run build

# Solo Windows
npm run build:win

# Solo macOS
npm run build:mac

# Solo Linux
npm run build:linux
```

Los instaladores se generan en `dist/`.

## Iconos

Antes de empaquetar, añade los iconos en `assets/`:

- `icon.png` - 512x512px mínimo (Linux)
- `icon.ico` - Windows
- `icon.icns` - macOS

Puedes generar los formatos desde un PNG con herramientas como [electron-icon-builder](https://www.npmjs.com/package/electron-icon-builder).

## Métodos de descubrimiento

1. **mDNS/Bonjour** - Busca servicios `_http._tcp` que contengan "homepinas"
2. **Subnet scan** - Escanea el puerto 3001 en toda la subred local
3. **Hostnames conocidos** - Prueba `pinas.local`, `homepinas.local`, etc.

## Estructura

```
finder-app/
├── src/
│   ├── main.js      # Proceso principal Electron
│   ├── preload.js   # Bridge seguro IPC
│   ├── scanner.js   # Lógica de descubrimiento
│   └── index.html   # UI
├── assets/          # Iconos
├── package.json
└── README.md
```

## Licencia

MIT © homelabs.club
