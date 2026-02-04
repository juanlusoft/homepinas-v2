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
