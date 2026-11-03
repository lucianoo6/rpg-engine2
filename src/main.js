import './engine/ui/ui.css';
import { VillageDemo } from './demo/VillageDemo.js';

const demo = new VillageDemo(document.getElementById('app'));
// `?manual` leaves the loop stopped so tests can call hd2d.engine.step(dt) deterministically.
if (!new URLSearchParams(location.search).has('manual')) demo.start();

// Handy for poking at the engine from the browser console.
window.hd2d = demo;
