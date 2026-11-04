import './engine/ui/ui.css';
import { HollowbrookGame } from './demo/Game.js';

const game = new HollowbrookGame(document.getElementById('app'));
game.init().then(() => {
  // Handy for poking at the engine from the browser console.
  window.hd2d = game;
  // `?manual` leaves the loop stopped so tests can call hd2d.engine.step(dt) deterministically.
  if (!new URLSearchParams(location.search).has('manual')) game.start();
}).catch((err) => {
  console.error(err);
  document.body.insertAdjacentHTML('beforeend', `<pre style="position:fixed;inset:auto 16px 16px;color:#fbb;font:13px monospace;white-space:pre-wrap">${String(err.stack || err)}</pre>`);
});
