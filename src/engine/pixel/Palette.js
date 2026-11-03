/**
 * Colour utilities for pixel art. Ramps are hue-shifted the way pixel
 * artists paint: shadows drift towards blue/violet, highlights towards
 * warm yellow, which keeps shading lively instead of muddy.
 */

export function hex(h) {
  const s = h.replace('#', '');
  const n = parseInt(s.length === 3 ? s.split('').map((c) => c + c).join('') : s, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function toHex([r, g, b]) {
  return '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
}

export function toHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return [h, s, l];
}

export function fromHsl(h, s, l) {
  h = ((h % 360) + 360) % 360;
  s = Math.min(1, Math.max(0, s));
  l = Math.min(1, Math.max(0, l));
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255].map(Math.round);
}

function hueToward(h, target, amount) {
  let d = ((target - h + 540) % 360) - 180;
  const step = Math.sign(d) * Math.min(Math.abs(d), amount);
  return h + step;
}

/** Lighten (k > 0) or darken (k < 0) with pixel-art hue shifting. */
export function shift(rgb, k, { hueShift = 14, satShift = 0.05 } = {}) {
  const [h, s, l] = toHsl(rgb);
  if (k === 0) return rgb.slice();
  const amt = Math.abs(k);
  const target = k > 0 ? 55 : 245;
  const nh = s < 0.04 ? h : hueToward(h, target, hueShift * amt * 6);
  const ns = k > 0 ? s - satShift * amt * 2 : s + satShift * amt * 3;
  return fromHsl(nh, ns, l + k);
}

/**
 * Build a ramp of `steps` colours from darkest to lightest with `base`
 * in the middle.
 */
export function ramp(base, steps = 5, step = 0.085, opts) {
  const rgb = typeof base === 'string' ? hex(base) : base;
  const mid = Math.floor(steps / 2);
  const out = [];
  for (let i = 0; i < steps; i++) out.push(shift(rgb, (i - mid) * step, opts));
  return out;
}

export function mix(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export function scale(rgb, k) {
  return [rgb[0] * k, rgb[1] * k, rgb[2] * k];
}
