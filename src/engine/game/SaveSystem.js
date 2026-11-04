/**
 * Save games and settings in localStorage. Storage can be unavailable
 * (private windows, blocked site data), so every call fails soft and the
 * game simply carries on without persistence.
 */
export class SaveSystem {
  constructor(key = 'hd2d') {
    this.key = key;
  }

  _get(k) {
    try {
      const v = localStorage.getItem(`${this.key}:${k}`);
      return v ? JSON.parse(v) : null;
    } catch {
      return null;
    }
  }

  _set(k, v) {
    try {
      localStorage.setItem(`${this.key}:${k}`, JSON.stringify(v));
      return true;
    } catch {
      return false;
    }
  }

  load() {
    const s = this._get('save');
    return s && s.v === 1 ? s : null;
  }

  save(data) {
    return this._set('save', { v: 1, savedAt: Date.now(), ...data });
  }

  clear() {
    try { localStorage.removeItem(`${this.key}:save`); } catch { /* ignore */ }
  }

  loadSettings() {
    return this._get('settings') || {};
  }

  saveSettings(s) {
    return this._set('settings', s);
  }
}
