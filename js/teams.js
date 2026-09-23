// Equipos y pilotos ficticios.
export const TEAMS = [
  { id: 'rossa', name: 'Scuderia Rossa', short: 'ROSSA', primary: '#c8102e', secondary: '#ffd200', tertiary: '#111111', helmet: '#ffd200', decal: '#ffffff', sponsor: 'VELOX', numbers: [7, 21] },
  { id: 'argento', name: 'Argento GP', short: 'ARGENTO', primary: '#b4bcc3', secondary: '#00b3a6', tertiary: '#0d0f12', helmet: '#00b3a6', decal: '#0d0f12', sponsor: 'QUANTUM', numbers: [3, 33] },
  { id: 'papaya', name: 'Papaya Racing', short: 'PAPAYA', primary: '#ff7a00', secondary: '#1e88e5', tertiary: '#111111', helmet: '#1e88e5', decal: '#ffffff', sponsor: 'NITRO FUEL', numbers: [11, 27] },
  { id: 'verde', name: 'Verde Motorsport', short: 'VERDE', primary: '#0b6e4f', secondary: '#c6ff00', tertiary: '#0a0a0a', helmet: '#c6ff00', decal: '#c6ff00', sponsor: 'HELIX', numbers: [5, 12] },
  { id: 'notte', name: 'Notte Blu', short: 'NOTTE BLU', primary: '#1a2b8f', secondary: '#ff2d55', tertiary: '#ffd200', helmet: '#ffffff', decal: '#ffffff', sponsor: 'SKYLINE', numbers: [9, 88] },
];

export const DRIVERS = [
  [{ name: 'Marco Vitale', code: 'VIT' }, { name: 'Andrea Solís', code: 'SOL' }],
  [{ name: 'Kai Brandt', code: 'BRA' }, { name: 'Luca Moreau', code: 'MOR' }],
  [{ name: 'Theo Walsh', code: 'WAL' }, { name: 'Nico Arendt', code: 'ARE' }],
  [{ name: 'Iván Castro', code: 'CAS' }, { name: 'Oskar Lind', code: 'LIN' }],
  [{ name: 'Yuki Aranda', code: 'ARA' }, { name: 'Félix Duval', code: 'DUV' }],
];

export const PLAYER_DRIVER = { name: 'Tú', code: 'TÚ' };

// Código de 3 letras a partir de un nombre
export function codeFor(name) {
  const clean = (name || 'TU').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  return (clean + 'XXX').slice(0, 3);
}
