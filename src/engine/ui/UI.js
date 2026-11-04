import * as THREE from 'three';

/**
 * DOM overlay UI: dialogue with typewriter text and choices, location
 * banners, floating interaction prompts, and a small HUD. Kept in the DOM
 * so text stays razor sharp on top of the post-processed 3D view.
 */

const el = (tag, cls, parent, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  if (parent) parent.appendChild(e);
  return e;
};

export class UIRoot {
  constructor(container = document.body) {
    this.root = el('div', 'hd-ui', container);
  }
}

export class DialogueBox {
  constructor(ui) {
    this.box = el('div', 'hd-dialogue', ui.root);
    this.name = el('div', 'hd-dialogue__name', this.box);
    this.text = el('div', 'hd-dialogue__text', this.box);
    this.next = el('div', 'hd-dialogue__next', this.box);
    this.choices = el('div', 'hd-choices', ui.root);
    this.active = false;
    this.cps = 48;
    // optional hooks (sound, logging): onLine(line), onChar(char, line), onMove(index), onPick(index), onClose()
    this.onLine = this.onChar = this.onMove = this.onPick = this.onClose = null;
    this._queue = [];
    this._resolve = null;
    this._full = '';
    this._shown = 0;
    this._choice = null;
  }

  /** Show a sequence of { speaker, text } lines; resolves when dismissed. */
  say(lines) {
    if (!Array.isArray(lines)) lines = [lines];
    return new Promise((resolve) => {
      this._queue = lines.slice();
      this._resolve = resolve;
      this.active = true;
      this.box.classList.add('is-open');
      this._advance();
    });
  }

  /** Ask a question; resolves with the chosen index. */
  choose(speaker, text, options) {
    return new Promise((resolve) => {
      this._queue = [{ speaker, text, options, onChoose: resolve }];
      this._resolve = () => {};
      this.active = true;
      this.box.classList.add('is-open');
      this._advance();
    });
  }

  _advance() {
    const line = this._queue.shift();
    if (!line) {
      if (this.active && this.onClose) this.onClose();
      this.active = false;
      this.box.classList.remove('is-open');
      this.choices.classList.remove('is-open');
      const r = this._resolve;
      this._resolve = null;
      if (r) r();
      return;
    }
    this._line = line;
    this.name.textContent = line.speaker || '';
    this.name.style.display = line.speaker ? '' : 'none';
    this._full = line.text;
    this._shown = 0;
    this.text.textContent = '';
    this.next.classList.remove('is-ready');
    this._choice = null;
    this.choices.classList.remove('is-open');
    if (this.onLine) this.onLine(line);
  }

  _openChoices() {
    const opts = this._line.options;
    this._choice = 0;
    this.choices.innerHTML = '';
    opts.forEach((o, i) => {
      const b = el('div', 'hd-choice', this.choices, o);
      b.addEventListener('mouseenter', () => {
        if (this._choice !== i && this.onMove) this.onMove(i);
        this._choice = i;
        this._renderChoices();
      });
      b.addEventListener('click', () => this._pick(i));
    });
    this.choices.classList.add('is-open');
    this._renderChoices();
  }

  _renderChoices() {
    [...this.choices.children].forEach((c, i) => c.classList.toggle('is-selected', i === this._choice));
  }

  _pick(i) {
    if (this.onPick) this.onPick(i);
    const cb = this._line.onChoose;
    this._queue = [];
    this._advance();
    cb(i);
  }

  update(dt, input) {
    if (!this.active) return;
    const confirm = input.pressed('Space', 'Enter', 'KeyE', 'Tap');
    if (this._shown < this._full.length) {
      const before = Math.floor(this._shown);
      this._shown = Math.min(this._full.length, this._shown + this.cps * dt);
      const now = Math.floor(this._shown);
      if (this.onChar && !confirm) for (let k = before; k < now; k++) this.onChar(this._full[k], this._line);
      this.text.textContent = this._full.slice(0, now);
      if (confirm) {
        this._shown = this._full.length;
        this.text.textContent = this._full;
      }
      if (this._shown >= this._full.length) {
        if (this._line.options) this._openChoices();
        else this.next.classList.add('is-ready');
      }
      return;
    }
    if (this._line.options) {
      if (this._choice === null) this._openChoices();
      const n = this._line.options.length;
      if (input.pressed('ArrowDown', 'KeyS')) { this._choice = (this._choice + 1) % n; this._renderChoices(); if (this.onMove) this.onMove(this._choice); }
      if (input.pressed('ArrowUp', 'KeyW')) { this._choice = (this._choice - 1 + n) % n; this._renderChoices(); if (this.onMove) this.onMove(this._choice); }
      if (confirm) this._pick(this._choice);
      return;
    }
    if (confirm) this._advance();
  }
}

export class Banner {
  constructor(ui) {
    this.el = el('div', 'hd-banner', ui.root);
    this.title = el('div', 'hd-banner__title', this.el);
    this.sub = el('div', 'hd-banner__sub', this.el);
    this._timer = null;
    this.current = null;
  }

  show(title, subtitle = '', hold = 3200) {
    this.current = title;
    this.title.textContent = title;
    this.sub.textContent = subtitle;
    this.el.classList.remove('is-open');
    void this.el.offsetWidth;
    this.el.classList.add('is-open');
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this.el.classList.remove('is-open'), hold);
  }
}

export class WorldPrompt {
  constructor(ui) {
    this.el = el('div', 'hd-prompt', ui.root);
    this._v = new THREE.Vector3();
  }

  show(text, worldPos, camera, renderer) {
    this.el.textContent = text;
    this._v.copy(worldPos).project(camera);
    const r = renderer.domElement.getBoundingClientRect();
    const x = (this._v.x * 0.5 + 0.5) * r.width + r.left;
    const y = (-this._v.y * 0.5 + 0.5) * r.height + r.top;
    this.el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;
    this.el.classList.add('is-open');
  }

  hide() {
    this.el.classList.remove('is-open');
  }
}

export class HUD {
  constructor(ui) {
    this.clock = el('div', 'hd-clock', ui.root);
    this.clockIcon = el('div', 'hd-clock__icon', this.clock);
    this.clockText = el('div', 'hd-clock__text', this.clock);
    this.clockTime = el('div', 'hd-clock__time', this.clockText);
    this.clockName = el('div', 'hd-clock__name', this.clockText);
    this.help = el('div', 'hd-help', ui.root, `
      <div><kbd>WASD</kbd><kbd>↑↓←→</kbd> Move &nbsp; <kbd>Shift</kbd> Run</div>
      <div><kbd>Space</kbd> Talk / Examine &nbsp; <kbd>Q</kbd><kbd>E</kbd> Orbit &nbsp; <kbd>Wheel</kbd> Zoom</div>
      <div><kbd>T</kbd> Time of day &nbsp; <kbd>P</kbd> Photo mode &nbsp; <kbd>M</kbd> Sound &nbsp; <kbd>G</kbd> Settings</div>`);
    this.fps = el('div', 'hd-fps', ui.root);
  }

  setTime(label, name, night) {
    this.clockTime.textContent = label;
    this.clockName.textContent = name;
    this.clockIcon.classList.toggle('is-night', night > 0.5);
  }

  setFps(n) {
    if (this.statsVisible) return;
    this.fps.textContent = n ? `${n} fps` : '';
  }

  /** Detailed performance readout (toggle with showStats). */
  showStats(on) {
    this.statsVisible = on;
    this.fps.classList.toggle('is-stats', on);
    if (!on) this.fps.textContent = '';
  }

  setStats(lines) {
    if (this.statsVisible) this.fps.textContent = lines.join('\n');
  }
}

export class TitleCard {
  /** options: menu entries (e.g. ['Continue', 'New Journey']); empty = "press to begin". */
  constructor(ui, { title, subtitle, prompt = 'Press Enter or tap to begin', options = [] }) {
    this.el = el('div', 'hd-title', ui.root, `
      <div class="hd-title__inner">
        <div class="hd-title__eyebrow">three.js · HD-2D engine</div>
        <div class="hd-title__name">${title}</div>
        <div class="hd-title__rule"><span></span><i></i><span></span></div>
        <div class="hd-title__sub">${subtitle}</div>
        ${options.length ? '<div class="hd-title__menu"></div>' : `<div class="hd-title__prompt">${prompt}</div>`}
      </div>`);
    this.open = true;
    this.options = options;
    this.selected = 0;
    this.picked = -1;
    this.onMove = null;
    const menu = this.el.querySelector('.hd-title__menu');
    this.items = options.map((o, i) => {
      const b = el('div', 'hd-title__option', menu, o);
      b.addEventListener('mouseenter', () => this.select(i));
      b.addEventListener('click', (e) => { e.stopPropagation(); this.select(i); this.picked = i; });
      return b;
    });
    this.select(0);
  }

  select(i) {
    if (!this.items.length) return;
    if (i !== this.selected && this.onMove) this.onMove(i);
    this.selected = (i + this.items.length) % this.items.length;
    this.items.forEach((b, k) => b.classList.toggle('is-selected', k === this.selected));
  }

  /** Returns the chosen option index (0 when there is no menu) or -1 while waiting. */
  update(input, clicked = false) {
    if (!this.open) return -1;
    if (this.items.length) {
      if (input.pressed('ArrowDown', 'KeyS')) this.select(this.selected + 1);
      if (input.pressed('ArrowUp', 'KeyW')) this.select(this.selected - 1);
    }
    if (this.picked >= 0) return this.picked;
    if (input.pressed('Enter', 'Space', 'Tap', 'KeyE') || clicked) return this.items.length ? this.selected : 0;
    return -1;
  }

  dismiss() {
    this.open = false;
    this.el.classList.add('is-closed');
    setTimeout(() => this.el.remove(), 1600);
  }
}
