# F19 Grand Prix 🏁

Juego de carreras de Fórmula en 3D para el navegador, hecho con [three.js](https://threejs.org/) (WebGL). No necesita instalación ni servidor propio: todo (circuitos, autos, texturas y sonido) se genera por código, y el multijugador online funciona entre navegadores (WebRTC).

## Características

- **Online**: creá una sala, compartí el código o el link y corré contra tus amigos (hasta 10 pilotos). El anfitrión elige circuito, vueltas, clima y si los lugares libres los completa la IA. Si alguien se desconecta en plena carrera, la IA toma su auto.
- **3 circuitos con desniveles**:
  - *Valle Verde*: circuito de montaña de día, eses en subida y una recta en bajada.
  - *Costa Azul*: al atardecer junto al mar, con palmeras, barcos y un mirador.
  - *Desierto Nocturno*: carrera nocturna con torres de reflectores, ciudad iluminada y escapatorias pintadas.
- **Clima**: sol, nublado o lluvia (pista mojada con reflejos, spray de agua, gotas y menos agarre).
- **Autos detallados**: 10 autos de 5 equipos ficticios con halo, pontones con undercut, alerones de varios elementos, DRS móvil, números y sponsors en la carrocería, casco con diseño, discos de freno que se ponen incandescentes y luz trasera que parpadea.
- **Gráficos**: sombras en tiempo real, reflejos dinámicos en la pintura, cielo con nubes, bloom, destello del sol, gradación de color por ambiente, desenfoque por velocidad, humo, polvo, chispas y marcas de neumáticos. Calidad Ultra / Alta / Media / Baja con resolución adaptativa.
- **Menú nuevo**: pantalla de inicio sobre una carrera cinemática, selección de circuito con minimapas, **garaje 3D** con el auto girando en un estudio, opciones de gráficos/sonido y lobby online.
- **Modos**: Carrera (1, 3, 5 o 10 vueltas, 3 dificultades) y Contrarreloj con récord por circuito.
- **Cámaras**: persecución, lejana, T-Cam y cockpit, más cámaras de TV al terminar.
- **Controles**: teclado, mando (gamepad) y pantalla táctil (celular/tablet).

## Controles

| Acción | Teclado | Mando |
| --- | --- | --- |
| Acelerar | `W` / `↑` | RT / A |
| Frenar / reversa | `S` / `↓` | LT / B |
| Girar | `A` `D` / `←` `→` | Stick izquierdo |
| DRS | `Espacio` / `E` / `Shift` | X / RB |
| Cambiar cámara | `C` | Y |
| Mirar atrás | `L` | LB |
| Volver a la pista | `R` | Select |
| Pausa | `Esc` / `P` | Start |
| Sonido | `M` | — |

## Cómo jugar online

1. Entrá a **Online**, escribí tu nombre y tocá **Crear sala**.
2. Pasale a tus amigos el código de 4 letras o el **link de invitación** (abre la sala directamente).
3. Cuando estén todos en la sala, el anfitrión toca **Iniciar carrera**.

La conexión es directa entre jugadores (WebRTC, en estrella con el anfitrión). Para encontrarse usa el servidor público gratuito de [PeerJS](https://peerjs.com/). En la gran mayoría de las redes funciona sin configurar nada; algunas redes corporativas o de celular muy restrictivas pueden bloquear WebRTC. El anfitrión debe mantener la pestaña del juego visible durante la carrera.

Para usar un servidor PeerJS propio: `npx peer --port 9000` y abrir el juego con `?peer=tu-servidor:9000`.

## Jugar en tu computadora

El juego tiene que servirse por HTTP (abrir `index.html` con doble clic no funciona). Desde esta carpeta:

```bash
python3 -m http.server 8080
# o bien
npx serve .
```

y abrí <http://localhost:8080>.

## Publicarlo en una página

El juego es 100 % estático: se sube la carpeta tal cual a cualquier hosting con HTTPS (necesario para el online).

### GitHub Pages
1. Uní esta rama a `main`.
2. En el repo: **Settings → Pages → Build and deployment → Source: Deploy from a branch**, rama `main`, carpeta `/ (root)`.
3. En uno o dos minutos queda en `https://TU-USUARIO.github.io/NOMBRE-DEL-REPO/`. Ese link es el que compartís para jugar online.

### Netlify / Vercel / Cloudflare Pages
Arrastrá la carpeta a <https://app.netlify.com/drop> (o conectá el repo). No hace falta comando de build; el directorio de publicación es la raíz.

### itch.io
Comprimí la carpeta en un `.zip` (con `index.html` en la raíz), creá un proyecto de tipo **HTML** y marcá "This file will be played in the browser".

## Estructura

```
index.html          Página, HUD y menús
css/style.css       Estilos
js/main.js          Punto de entrada
js/game.js          Render, bucle, estados de carrera, clima y garaje
js/menu.js          Pantallas del menú, selección de circuito y lobby
js/online.js        Sala online: lobby, sincronización e interpolación de autos
js/net.js           Conexiones P2P con PeerJS
js/tracks.js        Definición de los circuitos
js/trackdata.js     Geometría, alturas, trazada ideal y perfil de velocidad
js/track.js         Construcción 3D del circuito
js/decor.js         Árboles, palmeras, casas, ciudad, reflectores y barcos
js/world.js         Cielo, sol, niebla, clima, lluvia y reflejos dinámicos
js/car.js           Modelo 3D del auto y calcos
js/showroom.js      Estudio 3D del garaje
js/physics.js       Dinámica del auto (agarre, aerodinámica, frenos, pendientes)
js/race.js          Simulación: vueltas, límites, choques, DRS, posiciones
js/ai.js            Pilotos de la computadora
js/camera.js        Cámaras
js/hud.js           Interfaz en pantalla y minimapa
js/audio.js         Sonido sintetizado (Web Audio)
js/particles.js     Humo, spray, polvo, chispas y marcas de neumáticos
js/textures.js      Texturas generadas por código
js/input.js         Teclado, mando y táctil
vendor/three/       three.js r186 (licencia MIT)
vendor/peerjs/      PeerJS 1.5.5 (licencia MIT)
```

Equipos, pilotos y marcas del juego son ficticios.
