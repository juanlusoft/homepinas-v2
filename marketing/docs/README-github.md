<p align="center">
  <img src="https://raw.githubusercontent.com/juanlusoft/homepinas-v2/main/frontend/img/logo.png" alt="HomePiNAS Logo" width="120">
</p>

<h1 align="center">HomePiNAS</h1>

<p align="center">
  <strong>Tu NAS Profesional en Raspberry Pi</strong><br>
  Dashboard premium para gestionar tu almacenamiento doméstico
</p>

<p align="center">
  <a href="#-instalación">Instalación</a> •
  <a href="#-características">Características</a> •
  <a href="#-capturas">Capturas</a> •
  <a href="#-requisitos">Requisitos</a> •
  <a href="#-documentación">Docs</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-2.2.2-blue.svg" alt="Version">
  <img src="https://img.shields.io/badge/license-MIT-green.svg" alt="License">
  <img src="https://img.shields.io/badge/platform-Raspberry%20Pi-red.svg" alt="Platform">
  <img src="https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg" alt="Node">
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/juanlusoft/homepinas-v2/main/marketing/screenshots/dashboard.png" alt="Dashboard Preview" width="800">
</p>

---

## ⚡ Instalación

Un comando. Eso es todo.

```bash
curl -fsSL https://raw.githubusercontent.com/juanlusoft/homepinas-v2/main/install.sh | sudo bash
```

El instalador configura automáticamente:
- ✅ Node.js y dependencias
- ✅ SnapRAID + MergerFS
- ✅ Docker y Docker Compose
- ✅ Samba para compartir archivos
- ✅ Certificados HTTPS
- ✅ Servicio systemd
- ✅ mDNS (acceso via `homepinas.local`)

---

## ✨ Características

### 🎨 Interfaz Premium
- Dashboard moderno con tema oscuro
- Diseño responsive (móvil, tablet, desktop)
- PWA - instálalo como app nativa
- Multiidioma (Español / English)

### 💾 Almacenamiento Inteligente
- **SnapRAID**: Protección de datos con paridad
- **MergerFS**: Pool de discos unificado
- Detección automática de discos (HDD, SSD, NVMe)
- Información SMART y temperaturas

### 🐳 Docker Integrado
- Gestión visual de contenedores
- Importar archivos docker-compose
- Ver logs en tiempo real
- Detección de actualizaciones
- Notas y puertos por contenedor

### 💻 Terminal Web
- Acceso SSH desde el navegador
- Soporte para htop, mc, nano, vim
- Auto-instalación de herramientas faltantes
- xterm.js con colores completos

### 🌡️ Control de Hardware
- Ventiladores PWM con curvas personalizables
- Modos: Silencioso / Equilibrado / Rendimiento
- Monitoreo de CPU, RAM y temperaturas

### 🔒 Seguridad
- HTTPS con certificados autogenerados
- Autenticación con bcrypt
- Rate limiting
- Sesiones persistentes (SQLite)

---

## 📸 Capturas de Pantalla

<details>
<summary>Ver más capturas</summary>

### Dashboard Principal
![Dashboard](marketing/screenshots/dashboard.png)

### Gestión de Docker
![Docker](marketing/screenshots/docker.png)

### Almacenamiento
![Storage](marketing/screenshots/storage.png)

### Terminal Web
![Terminal](marketing/screenshots/terminal.png)

</details>

---

## 📋 Requisitos

### Hardware Mínimo
- Raspberry Pi 4 (2GB+) o **Raspberry Pi 5 / CM5** (recomendado)
- Discos USB o SATA (HDD/SSD/NVMe)
- Tarjeta microSD o eMMC para el sistema

### Hardware Recomendado
- Raspberry Pi CM5 + IO Board
- 4GB+ RAM
- NVMe para sistema + HDDs para datos
- Ventilador con control PWM

### Software
- Raspberry Pi OS Lite (64-bit) - Bookworm
- Conexión a Internet para instalación

---

## 🆚 Comparativa

| Característica | Synology | TrueNAS | HomePiNAS |
|---------------|----------|---------|-----------|
| Precio HW | 400€+ | 300€+ | ~100€ |
| Software | Propietario | Open Source | Open Source |
| Instalación | Fácil | Compleja | 1 comando |
| Consumo | ~30W | ~50W+ | ~5W |
| Docker | ✅ | ✅ | ✅ |
| Raspberry Pi | ❌ | ❌ | ✅ |

---

## 📖 Documentación

- [Guía de Instalación](docs/INSTALL.md)
- [Configuración de Almacenamiento](docs/STORAGE.md)
- [Docker y Compose](docs/DOCKER.md)
- [Solución de Problemas](docs/TROUBLESHOOTING.md)

---

## 🤝 Contribuir

Las contribuciones son bienvenidas! Por favor:

1. Fork el repositorio
2. Crea una rama (`git checkout -b feature/nueva-caracteristica`)
3. Commit tus cambios (`git commit -m 'Añade nueva característica'`)
4. Push a la rama (`git push origin feature/nueva-caracteristica`)
5. Abre un Pull Request

---

## 📜 Licencia

MIT License - ver [LICENSE](LICENSE) para más detalles.

---

## 💬 Comunidad

- 🐛 [Reportar Bug](https://github.com/juanlusoft/homepinas-v2/issues)
- 💡 [Solicitar Feature](https://github.com/juanlusoft/homepinas-v2/issues)
- 💬 [Discusiones](https://github.com/juanlusoft/homepinas-v2/discussions)

---

<p align="center">
  Creado con ❤️ para la comunidad homelab<br>
  <a href="https://homelabs.club">homelabs.club</a>
</p>
