/**
 * Keyboard + touch input. Keyboard uses KeyboardEvent.code so layouts do
 * not matter. Touch: drag anywhere to move with a virtual stick, tap to act.
 */
export class Input {
  constructor(element = window) {
    this.down = new Set();
    this.pressedSet = new Set();
    this.touchVec = { x: 0, y: 0 };
    this.enabled = true;
    this.wheel = 0;

    window.addEventListener('keydown', (e) => {
      if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      if (!this.down.has(e.code)) this.pressedSet.add(e.code);
      this.down.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.down.delete(e.code));
    window.addEventListener('blur', () => this.down.clear());
    element.addEventListener('wheel', (e) => {
      this.wheel += Math.sign(e.deltaY);
      e.preventDefault();
    }, { passive: false });
    this._setupTouch(element);
  }

  _setupTouch(el) {
    const stick = document.createElement('div');
    stick.className = 'hd-stick';
    stick.innerHTML = '<div class="hd-stick__knob"></div>';
    document.body.appendChild(stick);
    const knob = stick.firstChild;
    let id = null, ox = 0, oy = 0, moved = false, t0 = 0;
    el.addEventListener('touchstart', (e) => {
      if (id !== null) return;
      const t = e.changedTouches[0];
      id = t.identifier; ox = t.clientX; oy = t.clientY; moved = false; t0 = performance.now();
      stick.style.left = `${ox}px`;
      stick.style.top = `${oy}px`;
      stick.classList.add('is-active');
      e.preventDefault();
    }, { passive: false });
    el.addEventListener('touchmove', (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier !== id) continue;
        let dx = t.clientX - ox, dy = t.clientY - oy;
        const len = Math.hypot(dx, dy);
        if (len > 8) moved = true;
        const max = 48;
        if (len > max) { dx *= max / len; dy *= max / len; }
        this.touchVec.x = dx / max;
        this.touchVec.y = -dy / max;
        knob.style.transform = `translate(${dx}px, ${dy}px)`;
      }
      e.preventDefault();
    }, { passive: false });
    const end = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier !== id) continue;
        if (!moved && performance.now() - t0 < 300) this.pressedSet.add('Tap');
        id = null;
        this.touchVec.x = this.touchVec.y = 0;
        knob.style.transform = '';
        stick.classList.remove('is-active');
      }
    };
    el.addEventListener('touchend', end);
    el.addEventListener('touchcancel', end);
  }

  isDown(...codes) {
    return this.enabled && codes.some((c) => this.down.has(c));
  }

  pressed(...codes) {
    return this.enabled && codes.some((c) => this.pressedSet.has(c));
  }

  /** Movement axis in screen terms: x right, y up (away from camera). */
  axis() {
    if (!this.enabled) return { x: 0, y: 0 };
    let x = 0, y = 0;
    if (this.isDown('KeyA', 'ArrowLeft')) x -= 1;
    if (this.isDown('KeyD', 'ArrowRight')) x += 1;
    if (this.isDown('KeyW', 'ArrowUp')) y += 1;
    if (this.isDown('KeyS', 'ArrowDown')) y -= 1;
    x += this.touchVec.x;
    y += this.touchVec.y;
    const len = Math.hypot(x, y);
    if (len > 1) { x /= len; y /= len; }
    return { x, y };
  }

  consumeWheel() {
    const w = this.wheel;
    this.wheel = 0;
    return w;
  }

  endFrame() {
    this.pressedSet.clear();
  }
}
