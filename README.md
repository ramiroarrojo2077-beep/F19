# F19 Grand Prix 🏁

Juego de carreras de Fórmula en 3D que corre directamente en el navegador, hecho con [three.js](https://threejs.org/) (WebGL). No necesita instalación, servidor especial ni assets externos: todo (circuito, autos, texturas y sonido) se genera por código.

## Características

- **Circuito de ~4 km** con rectas, horquilla, eses y chicana: pianos, grava, muros con publicidad, alambrado, tribunas con público animado, boxes, pórtico de largada con semáforo, puente, árboles y montañas.
- **10 autos** de 5 equipos ficticios, modelados en 3D (halo, alerones, DRS móvil, ruedas que giran y doblan, pintura con barniz y reflejos).
- **Gráficos**: cielo dinámico con nubes, sombras en tiempo real, reflejos del entorno, bloom, antialiasing SMAA, desenfoque por velocidad, partículas (humo, polvo, chispas del fondo plano).
- **IA** que sigue la trazada ideal, frena en su punto, adelanta y usa el DRS.
- **Modos**: Carrera (1, 3, 5 o 10 vueltas, 3 dificultades) y Contrarreloj con récord guardado.
- **Cámaras**: persecución, lejana, T-Cam, cockpit, más cámaras de TV al terminar.
- Semáforo de largada, tabla de posiciones estilo TV, minimapa, tiempos por vuelta, DRS, sonido de motor sintetizado con efecto Doppler.
- **Controles**: teclado, mando (gamepad) y pantalla táctil (celular/tablet).
- Resolución adaptativa y 3 niveles de calidad gráfica.

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

## Jugar en tu computadora

Por usar módulos de JavaScript, el juego tiene que servirse por HTTP (abrir `index.html` con doble clic no funciona). Desde esta carpeta:

```bash
python3 -m http.server 8080
# o bien
npx serve .
```

y abrí <http://localhost:8080>.

## Publicarlo en una página

El juego es 100 % estático: se sube la carpeta tal cual a cualquier hosting.

### GitHub Pages
1. Subí el repositorio a GitHub (rama `main`).
2. En el repo: **Settings → Pages → Build and deployment → Source: Deploy from a branch**.
3. Elegí la rama `main` y la carpeta `/ (root)` y guardá.
4. En uno o dos minutos queda publicado en `https://TU-USUARIO.github.io/NOMBRE-DEL-REPO/`.

### Netlify / Vercel / Cloudflare Pages
Arrastrá la carpeta del proyecto a <https://app.netlify.com/drop> (o conectá el repo). No hace falta comando de build; el directorio de publicación es la raíz.

### itch.io
Comprimí la carpeta en un `.zip` (con `index.html` en la raíz), creá un proyecto de tipo **HTML** y subí el zip marcando "This file will be played in the browser".

### Insertarlo en otra página
```html
<iframe src="https://TU-USUARIO.github.io/NOMBRE-DEL-REPO/" width="1280" height="720"
        allow="fullscreen; gamepad; autoplay" style="border:0"></iframe>
```

## Estructura

```
index.html          Página, HUD y menús
css/style.css       Estilos de la interfaz
js/main.js          Render, bucle de juego, menús y estados
js/trackdata.js     Geometría del circuito, trazada ideal y perfil de velocidad
js/track.js         Construcción 3D del circuito y el entorno
js/car.js           Modelo 3D procedural del auto
js/physics.js       Dinámica del auto (agarre, aerodinámica, frenos)
js/race.js          Simulación de carrera: vueltas, límites, choques, DRS, posiciones
js/ai.js            Pilotos controlados por la computadora
js/camera.js        Cámaras
js/hud.js           Interfaz en pantalla y minimapa
js/audio.js         Sonido sintetizado (Web Audio)
js/particles.js     Humo, polvo y chispas
js/textures.js      Texturas generadas por código
js/input.js         Teclado, mando y táctil
vendor/three/       three.js r186 (licencia MIT)
```

Equipos, pilotos y marcas del juego son ficticios.
