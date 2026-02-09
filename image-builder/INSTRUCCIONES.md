# 🏠 HomePiNAS - Instalación en 3 Pasos

## Lo que necesitas

- Raspberry Pi 4, Pi 5, CM4 o CM5
- Tarjeta microSD de 16GB o más (recomendado 32GB)
- Discos duros para el NAS (SATA, USB o NVMe)
- Cable de red (recomendado) o WiFi configurado

---

## Paso 1: Descargar

📥 **Descarga la imagen de HomePiNAS:**

👉 [**Descargar HomePiNAS (última versión)**](https://github.com/juanlusoft/homepinas-v2/releases/latest)

Busca el archivo: `HomePiNAS-vX.X.X-arm64.img.xz`

---

## Paso 2: Grabar en la tarjeta SD

📀 **Usa Raspberry Pi Imager:**

1. Descarga [Raspberry Pi Imager](https://www.raspberrypi.com/software/)
2. Ábrelo y haz clic en **"CHOOSE OS"**
3. Baja hasta **"Use custom"** y selecciona el archivo `.img.xz` descargado
4. Haz clic en **"CHOOSE STORAGE"** y selecciona tu tarjeta SD
5. **⚙️ Haz clic en el engranaje** (configuración) y configura:
   - ✅ Set hostname: `homepinas`
   - ✅ Enable SSH: Use password authentication
   - ✅ Set username and password: **elige tu usuario y contraseña**
   - ✅ Configure wireless LAN: (si usas WiFi)
   - ✅ Set locale: Europe/Madrid, es
6. Haz clic en **"WRITE"** y espera a que termine

---

## Paso 3: Encender y esperar

🔌 **Arranca tu Raspberry Pi:**

1. Inserta la tarjeta SD en la Raspberry Pi
2. Conecta los discos duros
3. Conecta el cable de red (o usa WiFi)
4. Conecta la alimentación

⏳ **Espera 5-10 minutos** — HomePiNAS se instala automáticamente.

El LED verde parpadeará durante la instalación. Cuando termine, la Pi se reiniciará sola.

---

## Paso 4: ¡Listo!

🎉 **Accede a tu NAS:**

Abre un navegador y ve a:

```
https://homepinas.local
```

O si no funciona, busca la IP de tu Pi en el router y ve a:

```
https://192.168.1.XXX
```

**Primera vez:** Crea tu usuario administrador y configura los discos.

---

## 🆘 ¿Problemas?

### No encuentro la Pi en la red
- Espera 10 minutos más (la instalación puede tardar)
- Verifica que el LED verde parpadea
- Conecta un monitor para ver el progreso

### La instalación falló
Conéctate por SSH y revisa el log:
```bash
ssh tu-usuario@homepinas.local
cat /var/log/homepinas-firstboot.log
```

### Reinstalar desde cero
```bash
sudo rm /opt/.homepinas-installed
sudo systemctl enable homepinas-firstboot.service
sudo reboot
```

---

## 📞 Soporte

- **Telegram:** [@homelabsclub](https://t.me/homelabsclub)
- **Web:** [homelabs.club](https://homelabs.club)
- **GitHub:** [Issues](https://github.com/juanlusoft/homepinas-v2/issues)

---

*HomePiNAS es un proyecto de [HomeLabs Club](https://homelabs.club) 🏠*
