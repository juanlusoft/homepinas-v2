# Posts para Reddit

---

## r/homelab

### Título
**HomePiNAS: Convertí mi Raspberry Pi en un NAS con dashboard premium (open source)**

### Contenido
Hey r/homelab!

Llevo un tiempo trabajando en **HomePiNAS**, un software que convierte cualquier Raspberry Pi (4/5/CM5) en un NAS completo con:

- 🎨 Dashboard moderno (dark mode, responsive, PWA)
- 💾 SnapRAID + MergerFS integrado
- 🐳 Gestión de Docker con UI
- 💻 Terminal web (htop, mc, etc.)
- 🌡️ Control de ventiladores PWM
- 🔒 HTTPS + autenticación

**Instalación en 1 comando:**
```bash
curl -fsSL https://raw.githubusercontent.com/juanlusoft/homepinas-v2/main/install.sh | sudo bash
```

Mi setup actual:
- Pi CM5 + IO Board
- 6x HDDs de 26TB (SnapRAID)
- 1x NVMe 256GB (sistema)
- Consumo total: ~25W

**GitHub:** https://github.com/juanlusoft/homepinas-v2

Acepto feedback y sugerencias. Es 100% open source (MIT).

[IMAGEN DEL DASHBOARD]

---

## r/selfhosted

### Título
**Open source NAS software for Raspberry Pi - HomePiNAS v2.2**

### Contenido
Hi everyone!

Just released a new version of HomePiNAS, a self-hosted NAS solution designed specifically for Raspberry Pi.

**Key features:**
- Beautiful dark-mode dashboard
- SnapRAID + MergerFS for data protection
- Docker management built-in
- Web terminal (xterm.js)
- PWA support (install as app)
- Auto-updates from dashboard

**One-liner install:**
```bash
curl -fsSL https://raw.githubusercontent.com/juanlusoft/homepinas-v2/main/install.sh | sudo bash
```

It's perfect if you want a Synology-like experience on a Pi without the cost.

Repo: https://github.com/juanlusoft/homepinas-v2

Happy to answer questions!

---

## r/raspberry_pi

### Título
**Hice un software NAS gratuito para Raspberry Pi con interfaz premium**

### Contenido
¡Hola a todos!

Quería compartir mi proyecto: **HomePiNAS**, un dashboard para convertir tu Raspberry Pi en un NAS completo.

**¿Por qué otro NAS software?**
- OpenMediaVault es genial pero pesado
- TrueNAS no corre en Pi
- Quería algo **bonito** y **simple**

**Lo que hace:**
- Dashboard con métricas en tiempo real
- Gestión de discos con SnapRAID y MergerFS
- Docker integrado (compose, logs, updates)
- Terminal web
- Samba para compartir archivos
- Control de ventiladores

**Compatibilidad:**
- ✅ Raspberry Pi 4 (2GB+)
- ✅ Raspberry Pi 5
- ✅ Compute Module 5

**Instalar:**
```bash
curl -fsSL https://raw.githubusercontent.com/juanlusoft/homepinas-v2/main/install.sh | sudo bash
```

Código en GitHub: https://github.com/juanlusoft/homepinas-v2

¡Feedback bienvenido!

---

## r/DataHoarder

### Título
**Free NAS software for Pi with SnapRAID + MergerFS - HomePiNAS**

### Contenido
Fellow data hoarders,

Built a NAS dashboard for Raspberry Pi that might interest you. It's called **HomePiNAS**.

**Storage features:**
- SnapRAID parity protection (auto sync daily)
- MergerFS disk pooling
- SMART monitoring
- Temperature tracking per disk
- Supports HDD, SSD, and NVMe (even via USB adapters)

**My current setup:**
- 6x 26TB HDDs = 156TB raw
- 1x parity disk
- MergerFS pool = ~130TB usable
- Running on Pi CM5

**The dashboard shows:**
- Real-time disk health
- Pool status
- Easy role assignment (data/parity/cache)

Install:
```bash
curl -fsSL https://raw.githubusercontent.com/juanlusoft/homepinas-v2/main/install.sh | sudo bash
```

It's free and open source: https://github.com/juanlusoft/homepinas-v2

---

# Tips para publicar:

1. **Mejor hora**: Martes-Jueves, 14:00-18:00 UTC
2. **Imágenes**: Siempre incluir screenshots del dashboard
3. **Responder comentarios**: Mantente activo las primeras 2 horas
4. **No spam**: Espera al menos 1 semana entre posts en diferentes subs
5. **Crosspost**: Usa crosspost en lugar de copiar para mantener discusión unificada
