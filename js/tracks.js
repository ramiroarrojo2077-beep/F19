// Definición de los circuitos: trazado (x, z, altura) y ambientación.
// El primer punto de control es la línea de meta; la recta anterior aloja la parrilla.

export const TRACKS = [
  {
    id: 'valle',
    name: 'Valle Verde',
    place: 'Circuito de montaña',
    env: 'day',
    desc: 'Rápido y con desniveles: eses en subida, horquilla en la cima y una recta en bajada.',
    ctrl: [
      [-300, 0, 0], [0, 0, 0], [300, 0, 0], [480, 0, 0],
      [580, 40, 0.5], [610, 130, 2], [560, 220, 5], [450, 250, 8],
      [340, 225, 11], [250, 280, 14], [150, 250, 16], [60, 310, 18],
      [-10, 410, 21], [10, 530, 24], [90, 610, 26], [60, 700, 27],
      [-40, 720, 26], [-180, 690, 22], [-400, 640, 15], [-620, 600, 8],
      [-760, 530, 4], [-820, 400, 2], [-790, 280, 1], [-840, 200, 0.5],
      [-800, 110, 0], [-700, 40, 0], [-560, 0, 0],
    ],
    decor: { trees: 'forest', water: null, buildings: 'village', ground: 'grass' },
  },
  {
    id: 'costa',
    name: 'Costa Azul',
    place: 'Riviera al atardecer',
    env: 'sunset',
    desc: 'Recta junto al mar, subida hasta el mirador y bajada técnica hacia la chicana.',
    ctrl: [
      [150, 0, 0], [400, 0, 0], [650, 0, 0], [820, 20, 0],
      [900, 110, 1], [860, 220, 4], [720, 260, 8], [600, 320, 12],
      [560, 440, 16], [640, 560, 20], [760, 600, 23], [820, 700, 25],
      [760, 800, 25], [620, 790, 23], [460, 700, 19], [300, 720, 15],
      [150, 800, 11], [0, 780, 8], [-150, 700, 6], [-260, 580, 4],
      [-240, 440, 3], [-330, 330, 2], [-420, 200, 1], [-360, 100, 0.3],
      [-240, 30, 0], [-110, 0, 0], [20, 0, 0],
    ],
    decor: { trees: 'palm', water: { side: 'z-', level: -1.2, edge: -95 }, buildings: 'coast', ground: 'coast' },
  },
  {
    id: 'noche',
    name: 'Desierto Nocturno',
    place: 'Gran Premio bajo las luces',
    env: 'night',
    desc: 'Carrera nocturna con reflectores: rectas largas, frenadas fuertes y curvas lentas.',
    ctrl: [
      [150, 0, 0], [420, 0, 0], [700, 0, 0], [860, 30, 0],
      [900, 150, 0.5], [820, 240, 1], [650, 230, 2], [520, 300, 3],
      [520, 450, 4], [640, 560, 4], [800, 600, 3.5], [900, 720, 3],
      [820, 860, 2.5], [640, 880, 2.5], [420, 820, 3], [220, 860, 3.5],
      [40, 900, 3], [-120, 820, 2.5], [-160, 660, 2], [-60, 540, 1.5],
      [-120, 400, 1], [-260, 320, 0.5], [-300, 160, 0], [-200, 40, 0],
      [-90, 0, 0], [30, 0, 0],
    ],
    decor: { trees: 'desert', water: null, buildings: 'city', ground: 'sand' },
  },
];

export const WEATHERS = [
  { id: 'sol', name: 'Soleado' },
  { id: 'nublado', name: 'Nublado' },
  { id: 'lluvia', name: 'Lluvia' },
];

export function trackById(id) {
  return TRACKS.find((t) => t.id === id) || TRACKS[0];
}
