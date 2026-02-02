# Guión Video YouTube: "Monta tu NAS con Raspberry Pi en 5 minutos"

**Duración objetivo:** 8-10 minutos
**Estilo:** Tutorial directo, sin relleno

---

## INTRO (0:00 - 0:30)

**[Plano del NAS terminado con luces LED]**

"¿Quieres tu propio servidor de almacenamiento pero Synology cuesta 400 euros? 

En este video te enseño a montar un NAS profesional con una Raspberry Pi por menos de 100 euros. Y lo mejor: la instalación son 5 minutos y un solo comando.

Vamos a ello."

**[Logo/Intro del canal - 3 segundos máx]**

---

## QUÉ ES HOMEPINAS (0:30 - 1:30)

**[Pantalla mostrando el dashboard]**

"HomePiNAS es un software gratuito y open source que convierte tu Raspberry Pi en un NAS completo.

Tiene:
- Dashboard moderno con toda la info de tu sistema
- Gestión de discos con SnapRAID para proteger tus datos
- MergerFS para unir todos tus discos en uno
- Docker integrado para correr servicios
- Terminal web para acceder sin SSH
- Y Samba para compartir archivos en tu red

Todo esto con una interfaz que ya quisiera Synology."

---

## HARDWARE NECESARIO (1:30 - 2:30)

**[B-roll del hardware en mesa]**

"¿Qué necesitas?

MÍNIMO:
- Raspberry Pi 4 con 2GB de RAM
- Una tarjeta microSD
- Al menos un disco duro USB

RECOMENDADO (lo que uso yo):
- Raspberry Pi 5 o Compute Module 5
- Discos conectados por SATA o NVMe
- Un NVMe para el sistema
- HDDs grandes para almacenamiento

Mi setup tiene 6 discos de 26 terabytes, que suman más de 150 teras de almacenamiento bruto."

**[Mostrar el setup físico]**

---

## INSTALACIÓN (2:30 - 5:00)

**[Pantalla con terminal]**

"La instalación es ridículamente fácil. 

Primero, conecta tu Pi a la red y accede por SSH. Luego ejecutas este comando:"

**[Mostrar comando en pantalla grande]**
```
curl -fsSL https://raw.githubusercontent.com/juanlusoft/homepinas-v2/main/install.sh | sudo bash
```

"Dale Enter y... espera.

**[Timelapse de la instalación - 30 segundos]**

El instalador hace todo automáticamente:
- Instala Node.js
- Configura Docker
- Instala SnapRAID y MergerFS
- Configura Samba
- Genera certificados HTTPS
- Y crea el servicio del sistema

Cuando termina, te muestra la URL para acceder."

**[Mostrar pantalla final de instalación con URL]**

---

## PRIMER ACCESO (5:00 - 6:30)

**[Navegador abriendo la URL]**

"Abre el navegador y ve a la IP que te indica. Te pedirá crear un usuario y contraseña.

**[Mostrar pantalla de setup]**

Una vez dentro... bienvenido a tu NAS.

**[Tour rápido del dashboard]**

Aquí tienes:
- CPU, RAM y temperatura en tiempo real
- Estado de los ventiladores
- Tu IP pública y local
- Y acceso a todas las secciones"

---

## CONFIGURAR ALMACENAMIENTO (6:30 - 8:00)

**[Sección de almacenamiento]**

"Vamos a la parte importante: configurar los discos.

En la sección Storage ves todos los discos detectados. Seleccionas cuáles son para datos, cuál para paridad, y cuál para caché.

**[Demostración de selección de roles]**

Le das a crear pool y... listo. 

SnapRAID protege tus datos contra fallos de disco, y MergerFS los une para que veas todo como una sola carpeta.

Ahora puedes acceder a tus archivos desde cualquier ordenador de la red con la dirección que ves aquí."

**[Mostrar ruta SMB]**

---

## DOCKER Y EXTRAS (8:00 - 9:00)

**[Sección Docker]**

"Si quieres correr servicios como Plex, Nextcloud o lo que sea, ve a Docker. 

Puedes importar archivos compose, ver logs, y gestionar todo visualmente. Sin tocar la terminal si no quieres.

**[Mostrar terminal web]**

Aunque si la necesitas, tienes terminal web con htop, el gestor de archivos mc, y todas las herramientas típicas."

---

## CIERRE (9:00 - 9:30)

**[Volver al plano del NAS]**

"Y eso es todo. Un NAS profesional por 100 euros y 5 minutos de tu tiempo.

El código es open source, el link está en la descripción. Si te ha servido, dale like y suscríbete para más contenido de homelab.

¡Nos vemos en el siguiente video!"

---

## DESCRIPCIÓN DEL VIDEO

```
🏠 Monta tu propio NAS con Raspberry Pi usando HomePiNAS

En este tutorial te enseño a convertir una Raspberry Pi en un servidor de almacenamiento profesional en solo 5 minutos.

📥 INSTALACIÓN:
curl -fsSL https://raw.githubusercontent.com/juanlusoft/homepinas-v2/main/install.sh | sudo bash

🔗 LINKS:
- GitHub: https://github.com/juanlusoft/homepinas-v2
- Web: https://homepinas.homelabs.club

⏱️ TIMESTAMPS:
0:00 Intro
0:30 Qué es HomePiNAS
1:30 Hardware necesario
2:30 Instalación
5:00 Primer acceso
6:30 Configurar almacenamiento
8:00 Docker y extras
9:00 Cierre

🏷️ TAGS:
Raspberry Pi NAS, NAS casero, servidor de archivos, homelab, SnapRAID, MergerFS, HomePiNAS, alternativa Synology, NAS barato, self-hosted

#RaspberryPi #NAS #Homelab #Tutorial
```

---

## THUMBNAIL

**Elementos:**
- Raspberry Pi en primer plano
- Texto grande: "NAS en 5 MIN"
- Precio tachado "400€" → "100€"
- Cara sorprendida (si sale el creador)
- Fondo oscuro con verde neón (colores de HomePiNAS)
