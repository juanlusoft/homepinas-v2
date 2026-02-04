# HomePiNAS Mobile App — Plan

## Objetivo
App móvil para gestionar el NAS desde el teléfono. Mismo dashboard pero adaptado a móvil, con notificaciones push.

## Tecnología

### Opción recomendada: React Native + Expo
- **Por qué**: JS/React — mismo lenguaje que el frontend web, reutilizable
- Cross-platform: Android + iOS con un solo código
- Expo simplifica builds, OTA updates, push notifications
- Sin necesidad de Xcode para desarrollo (solo para publish en App Store)

### Alternativas descartadas:
- **Flutter**: Requiere aprender Dart, no reutiliza nada del frontend actual
- **PWA**: Limitaciones en iOS (no push notifications fiables, no background)
- **Capacitor/Ionic**: Webview wrapper, rendimiento inferior

## Arquitectura

```
┌─────────────┐     HTTPS/API      ┌──────────────┐
│  App Móvil   │ ◄──────────────► │  NAS Backend  │
│ React Native │    puerto 3001    │  (Express.js) │
└──────┬───────┘                   └──────┬────────┘
       │                                   │
       ▼                                   ▼
  Push Notifications              Webhook → Expo Push
  (Expo Push Service)             (nuevo endpoint)
```

### Conexión al NAS
1. **Descubrimiento local**: mDNS/Bonjour (misma red WiFi)
2. **IP manual**: El usuario introduce IP:puerto
3. **DDNS/Remoto**: Si tiene DDNS configurado, usa el dominio
4. **QR Code**: Generar QR desde el dashboard web para vincular rápido

## Pantallas

### 1. 🏠 Dashboard (Home)
- Estado del NAS: CPU, RAM, temperatura, uptime
- Storage: uso de disco, pool health
- Alertas activas (disco dañado, backup fallido, etc.)
- Acciones rápidas: reiniciar, apagar

### 2. 💾 Storage
- Vista de discos con estado SMART
- Pool mergerfs/SnapRAID status
- Uso por carpeta
- Gráficas de uso en el tiempo

### 3. 📁 File Station
- Explorador de archivos (navegar /mnt/storage)
- Upload desde el móvil (fotos, vídeos, docs)
- Download/compartir archivos
- Preview de imágenes y vídeos
- Crear carpetas, renombrar, mover, borrar

### 4. 🔄 Active Backup
- Lista de dispositivos con estado
- Último backup, próximo programado
- Trigger manual de backup
- Ver versiones/historial
- Aprobar/rechazar agentes pendientes

### 5. 📊 Samba
- Carpetas compartidas (estado, permisos)
- Conexiones activas
- Crear/editar/eliminar shares

### 6. 👥 Usuarios
- Lista de usuarios
- Crear/editar/eliminar
- Cambiar permisos y roles
- 2FA status

### 7. 🔔 Notificaciones
- Feed de eventos (backups, errores, logins)
- Config push notifications
- Filtros por tipo

### 8. ⚙️ Ajustes
- Config DDNS
- Config email/Telegram notifications
- UPS status
- Programador de tareas
- Actualizar HomePiNAS
- Logs del sistema

### 9. 🔗 Conexión
- Añadir/gestionar NAS (multi-NAS)
- Estado de conexión
- QR scanner para vincular

## Notificaciones Push

### Eventos que generan push:
- ❌ Backup fallido
- ✅ Backup completado (configurable)
- ⚠️ Disco con errores SMART
- 🔴 NAS offline / sin respuesta
- 👤 Nuevo agente pendiente de aprobación
- 🔐 Login sospechoso / fallido
- 🔄 Actualización disponible
- ⚡ UPS en batería

### Implementación:
1. App registra Expo Push Token al conectarse al NAS
2. Nuevo endpoint en backend: `POST /api/push/register` (guarda tokens)
3. Backend envía push via Expo Push API cuando ocurre un evento
4. Sin servidor intermediario — NAS → Expo Push Service → dispositivo

## Estructura del proyecto

```
mobile-app/
├── app/                    # Expo Router (file-based routing)
│   ├── (tabs)/             # Tab navigation
│   │   ├── index.tsx       # Dashboard
│   │   ├── storage.tsx     # Storage
│   │   ├── files.tsx       # File Station
│   │   ├── backup.tsx      # Active Backup
│   │   └── settings.tsx    # Ajustes
│   ├── login.tsx           # Login / conexión NAS
│   ├── users.tsx           # Gestión usuarios
│   └── notifications.tsx   # Feed notificaciones
├── components/
│   ├── DiskCard.tsx
│   ├── BackupDevice.tsx
│   ├── FileList.tsx
│   ├── StatsChart.tsx
│   └── ...
├── services/
│   ├── api.ts              # Cliente API NAS
│   ├── discovery.ts        # mDNS discovery
│   ├── push.ts             # Push notifications
│   └── storage.ts          # AsyncStorage (tokens, config)
├── hooks/
│   ├── useNAS.ts           # Hook conexión NAS
│   ├── useAuth.ts          # Auth state
│   └── usePush.ts          # Push notifications
├── assets/
│   ├── icon.png
│   └── splash.png
├── app.json                # Expo config
├── package.json
└── tsconfig.json
```

## Diseño UI

### Estilo
- **Dark mode** por defecto (consistente con el dashboard web)
- Mismo color scheme: verde HomePiNAS, fondo oscuro
- Cards con glassmorphism suave
- Animaciones sutiles (Reanimated)
- Haptic feedback en acciones importantes

### Navegación
- **Tab bar** inferior: Dashboard / Storage / Files / Backup / Más
- **Stack navigation** dentro de cada tab
- **Pull to refresh** en todas las listas
- **Swipe actions** en listas (eliminar, editar)

## Fases de desarrollo

### Fase 1 — MVP (1-2 semanas)
- Login + conexión al NAS (IP manual)
- Dashboard con stats básicos
- Active Backup: ver dispositivos, trigger manual
- Notificaciones in-app

### Fase 2 — File Management (1 semana)
- File Station completo
- Upload desde cámara/galería
- Preview de archivos

### Fase 3 — Full Admin (1 semana)
- Storage management
- Samba shares
- Usuarios y permisos
- Ajustes completos

### Fase 4 — Push + Polish (1 semana)
- Push notifications
- mDNS discovery
- QR code linking
- Multi-NAS support
- Widget para home screen (estado rápido)

## VPN Integrada — Acceso remoto + bloqueo de publicidad

### Opción 1 (Recomendada): Tailscale — Sin abrir puertos
- **WireGuard por debajo** pero con NAT traversal automático
- **Sin abrir puertos** en el router — atraviesa firewalls solo
- Gratis hasta 100 dispositivos (plan Personal)
- Apps nativas Android/iOS/Windows/Mac/Linux
- Exit node: todo el tráfico del móvil pasa por el NAS
- Compatible con PiHole/AdGuard como DNS
- Setup en el NAS: una línea (`tailscale up --advertise-exit-node`)

#### Flujo usuario Tailscale (ultra-fácil)
1. Admin activa "VPN (Tailscale)" en el dashboard
2. HomePiNAS instala Tailscale y lo configura como exit node
3. Aparece un link de autenticación → admin lo abre y aprueba
4. Admin pulsa "Invitar dispositivo" → genera link/QR de invitación
5. Usuario instala Tailscale en el móvil → abre link → conectado ✅
6. Activa "Use exit node" → todo el tráfico por el NAS
7. PiHole/AdGuard como DNS → sin publicidad en cualquier red 🚫📢

#### Dashboard — Sección Tailscale
```
┌─────────────────────────────────────────┐
│  🔒 VPN (Tailscale)          [Activar] │
│─────────────────────────────────────────│
│  Estado: ● Conectado                    │
│  IP Tailscale: 100.64.x.x              │
│  Exit node: ✅ Activo                   │
│  MagicDNS: ✅ Activo                    │
│                                         │
│  📱 Dispositivos en la red:             │
│  ┌─────────────────────────────────┐   │
│  │ 🟢 PiNas (este NAS) 100.64.0.1│   │
│  │ 🟢 iPhone-Juan    100.64.0.2   │   │
│  │ 🟢 iPad-casa      100.64.0.3   │   │
│  │ ⚪ Portátil        100.64.0.4   │   │
│  └─────────────────────────────────┘   │
│                                         │
│  [📱 Invitar dispositivo]               │
│                                         │
│  ⚙️ Opciones:                          │
│  DNS: [Auto ▾] / PiHole / AdGuard     │
│  Exit node: [✅ Activado]               │
│  Subnet routes: [Red local ▾]          │
└─────────────────────────────────────────┘
```

#### Implementación backend (Tailscale)
1. **Instalar**: `curl -fsSL https://tailscale.com/install.sh | sh`
2. **Activar**: `tailscale up --advertise-exit-node --advertise-routes=192.168.1.0/24`
3. **Estado**: `tailscale status --json` → parsear dispositivos, IPs
4. **Auth key**: Usar Tailscale API para generar auth keys pre-aprobadas
5. **Invitar**: Generar link con auth key → QR code
6. **DNS**: `tailscale set --accept-dns=false` + config personalizada
7. **Endpoints API NAS**:
   - `POST /api/vpn/setup` — instalar y configurar Tailscale
   - `GET /api/vpn/status` — estado, peers (`tailscale status --json`)
   - `POST /api/vpn/invite` — generar auth key + QR para nuevo dispositivo
   - `PUT /api/vpn/config` — DNS, exit node, subnet routes
   - `POST /api/vpn/logout` — desconectar Tailscale
8. **Auto-detect ad-blockers**: Buscar PiHole/AdGuard en Docker → ofrecerlos como DNS

#### Ventajas Tailscale vs WireGuard manual
| | Tailscale | WireGuard |
|---|---|---|
| Abrir puertos | ❌ No | ✅ Sí (51820 UDP) |
| DDNS necesario | ❌ No | ✅ Sí |
| Config router | ❌ Nada | ✅ Port forward |
| Setup usuario | Instalar app + link | Instalar app + escanear QR |
| NAT traversal | ✅ Automático | ❌ Manual |
| Multi-NAS | ✅ Una cuenta | ⚠️ Cada uno por separado |
| Dependencia externa | Tailscale servers (coord) | ❌ Ninguna |

---

### Opción 2 (Avanzada): WireGuard — Sin dependencias externas
- Para usuarios que prefieren no depender de terceros
- Requiere abrir puerto 51820 UDP en el router
- Requiere DDNS o IP pública fija
- Control total de la infraestructura

#### Flujo usuario WireGuard
1. Admin activa "VPN (WireGuard)" en el dashboard
2. HomePiNAS instala WireGuard automáticamente
3. Admin pulsa "Añadir dispositivo" → introduce nombre (ej: "iPhone de Juan")
4. Se genera config + QR en pantalla
5. Usuario abre WireGuard en el móvil → escanea QR → conectado ✅
6. Si tiene PiHole/AdGuard → DNS apunta al contenedor → sin publicidad 🚫📢

### Arquitectura
```
┌──────────┐    WireGuard     ┌──────────────┐    DNS     ┌─────────────┐
│  Móvil   │ ◄─────────────► │  NAS (wg0)   │ ────────► │  PiHole /   │
│  (app)   │   túnel UDP     │  10.0.0.1    │           │  AdGuard    │
└──────────┘   puerto 51820   └──────────────┘           │  (Docker)   │
                                     │                    └─────────────┘
                                     ▼
                              Red local del NAS
                              (acceso a archivos,
                               dashboard, etc.)
```

### Dashboard — Sección VPN
```
┌─────────────────────────────────────────┐
│  🔒 VPN (WireGuard)          [Activar] │
│─────────────────────────────────────────│
│  Estado: ● Activo | Puerto: 51820      │
│  IP pública: 83.xx.xx.xx (auto)        │
│  Red VPN: 10.0.0.0/24                  │
│                                         │
│  📱 Dispositivos conectados:            │
│  ┌─────────────────────────────────┐   │
│  │ 🟢 iPhone de Juan  10.0.0.2    │   │
│  │ 🟢 iPad de casa    10.0.0.3    │   │
│  │ ⚪ Portátil oficina 10.0.0.4   │   │
│  └─────────────────────────────────┘   │
│                                         │
│  [+ Añadir dispositivo]                │
│                                         │
│  ⚙️ Opciones:                          │
│  DNS: [Auto ▾] / PiHole / AdGuard     │
│  Acceso: [Solo NAS ▾] / Todo el tráfico│
│  DDNS: homepinas.duckdns.org           │
└─────────────────────────────────────────┘
```

### Añadir dispositivo → Modal con QR
```
┌──────────────────────────────────┐
│  📱 Nuevo dispositivo            │
│                                  │
│  Nombre: [iPhone de Juan    ]    │
│                                  │
│  ┌────────────────────┐         │
│  │                    │         │
│  │     [QR CODE]      │         │
│  │                    │         │
│  └────────────────────┘         │
│                                  │
│  1. Instala WireGuard en tu     │
│     móvil (App Store/Play Store)│
│  2. Abre la app → "+"           │
│  3. Escanea este código QR      │
│  4. ¡Listo! Activa el túnel     │
│                                  │
│  [📋 Copiar config] [✕ Cerrar]  │
└──────────────────────────────────┘
```

### Opciones de DNS (integración ad-blocking)
| Opción | DNS | Resultado |
|--------|-----|-----------|
| Auto | DNS del router/ISP | Solo acceso remoto |
| PiHole | IP contenedor PiHole | Acceso remoto + sin anuncios |
| AdGuard Home | IP contenedor AdGuard | Acceso remoto + sin anuncios |
| Personalizado | IP custom | Lo que el usuario quiera |

### Modos de VPN
- **Solo NAS (split tunnel)**: Solo tráfico hacia la red local pasa por VPN. Internet directo.
- **Todo el tráfico (full tunnel)**: Todo pasa por el NAS. Ideal con PiHole para bloquear publicidad en cualquier red.

### Implementación backend
1. **Instalar WireGuard**: `apt install wireguard-tools` + generar claves servidor
2. **Endpoint**: `POST /api/vpn/setup` — config inicial (puerto, red, interfaz)
3. **Endpoint**: `POST /api/vpn/peer` — añadir dispositivo (genera claves, config, QR)
4. **Endpoint**: `DELETE /api/vpn/peer/:id` — eliminar dispositivo
5. **Endpoint**: `GET /api/vpn/status` — estado, peers conectados (wg show)
6. **Endpoint**: `PUT /api/vpn/config` — cambiar DNS, modo, puerto
7. **QR**: Generar con `qrcode` npm package directamente en el backend
8. **Port forwarding**: Instrucciones en pantalla para abrir puerto 51820 en el router
9. **Auto-detect contenedores**: Buscar PiHole/AdGuard en Docker y ofrecerlos como opción DNS

### Detección automática de ad-blockers
```javascript
// Buscar contenedores PiHole o AdGuard corriendo
const containers = await docker.listContainers();
const adBlockers = containers.filter(c => 
  c.Image.includes('pihole') || 
  c.Image.includes('adguard')
);
// Ofrecer automáticamente como opción DNS en la VPN
```

### Seguridad
- Claves privadas nunca salen del dispositivo (generadas y mostradas solo una vez)
- QR temporal: se puede configurar expiración
- Revocación instantánea desde el dashboard
- Logs de conexión/desconexión

### Requisitos del usuario
1. Puerto 51820 UDP abierto en el router (o el que elija)
2. DDNS configurado (o IP pública fija)
3. App WireGuard en el móvil (gratuita)

## Cambios necesarios en el backend

1. **Push notifications endpoint**: `POST /api/push/register`, `DELETE /api/push/unregister`
2. **Push sender**: Integrar Expo Push API en el notification system existente
3. **QR code endpoint**: `GET /api/system/pair-qr` (genera token temporal + URL)
4. **CORS**: Asegurar que acepta requests de la app
5. **File upload**: Verificar que el endpoint soporta multipart desde móvil

## Distribución

### Android
- **APK directo**: Descarga desde el dashboard del NAS
- **Google Play**: Cuando esté estable (requiere cuenta dev $25 one-time)

### iOS
- **TestFlight**: Para beta testing
- **App Store**: Cuando esté estable (requiere Apple Dev $99/año)
- **Alternativa**: Solo APK + web para iOS (PWA fallback)

## Estimación
- **MVP funcional**: 2 semanas
- **App completa**: 4-5 semanas
- **Publish**: +1 semana (store assets, review, etc.)
