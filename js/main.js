// Punto de entrada.
import { Game } from './game.js';

const game = new Game();
window.__game = game;
game.init().catch((err) => {
  console.error(err);
  const s = document.getElementById('load-status');
  document.getElementById('loading').classList.remove('done');
  s.textContent = 'No se pudo iniciar el juego: ' + (err && err.message ? err.message : err) + '. Probá con otro navegador o activá la aceleración por hardware.';
  s.classList.add('error');
});
