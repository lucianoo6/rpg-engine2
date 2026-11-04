/**
 * Event scripts: small lists of commands that drive dialogue and cutscenes.
 * They are plain JSON, so they can live in code, in a map file, or in a
 * Tiled object's `script` property.
 *
 *   [
 *     { "do": "emote", "who": "Marta", "icon": "!" },
 *     { "do": "walk", "who": "Marta", "to": "player" },
 *     { "do": "say", "who": "Marta", "text": "Welcome to the Sleeping Fox!" },
 *     { "do": "choose", "who": "Marta", "text": "A room for the night?",
 *       "options": ["Yes", "No"],
 *       "then": [[{ "do": "time", "hour": 7.5 }], [{ "do": "say", "who": "Marta", "text": "Suit yourself." }]] },
 *     { "do": "flag", "set": "metMarta" }
 *   ]
 *
 * Commands
 *   say      who?, speaker?, text          show a line (speaker defaults to who)
 *   choose   who?, text, options, then[]   branch on the picked option
 *   walk     who, to, run?, stop?, wait?   path-find to [x,z] | "player" | spawn name | actor name
 *   face     who, to                       turn towards a point or actor
 *   emote    who, icon (! ? ♪ … ♥ z), s?   balloon over a head
 *   hop      who, height?, s?, wait?        a little jump (surprise, joy)
 *   wait     s                             pause
 *   camera   focus?, distance?, reset?, s? frame an actor / restore the camera
 *   fade     to (0..1), s?                 fade to/from black
 *   time     hour, s?                      move the clock (time-lapse)
 *   flag     set? / clear?                 story flags (saved)
 *   if       flag | notFlag, then, else    branch on a flag
 *   warp     map, spawn                    change map
 *   sound    name                          play an Sfx method (crystal, rest, zone…)
 *   banner   title, subtitle?              location-style title card
 *   save                                   save the game
 *   run      script                        run a named script
 * Actors: "player", "self" (the NPC being talked to) or an NPC name.
 */

/** Normalise anything script-like into a command list (or null). */
export function parseScript(value, map = null, speaker = '') {
  if (value === undefined || value === null || value === '') return null;
  if (Array.isArray(value)) return value;
  if (typeof value === 'object') return value.commands || [value];
  const s = String(value).trim();
  if (s.startsWith('[') || s.startsWith('{')) return parseScript(JSON.parse(s), map, speaker);
  if (s.startsWith('@')) return [{ do: 'run', script: s.slice(1) }];
  return s.split('|').map((text) => ({ do: 'say', speaker, text: text.trim() }));
}

export class EventRunner {
  /**
   * `game` must provide: dialogue, banner, sfx, cycle, rig, flags (Set),
   * actor(name, ctx), point(spec, ctx), nav(), wait(s), fadeTo(v, s),
   * emote(char, icon, s), cameraReset(), warp(map, spawn), save(),
   * findScript(name).
   */
  constructor(game) {
    this.game = game;
    this.running = 0;
    this.handlers = {};
    const g = game;
    const run = (cmds, ctx) => this.run(cmds, ctx);
    this.register('say', async (c, ctx) => {
      const who = c.who ? g.actor(c.who, ctx) : null;
      const speaker = c.speaker ?? (who ? who.name : '');
      await g.dialogue.say({ speaker, text: c.text });
    });
    this.register('choose', async (c, ctx) => {
      const who = c.who ? g.actor(c.who, ctx) : null;
      const pick = await g.dialogue.choose(c.speaker ?? (who ? who.name : ''), c.text, c.options);
      ctx.choice = pick;
      if (c.then && c.then[pick]) await run(c.then[pick], ctx);
    });
    this.register('walk', async (c, ctx) => {
      const a = g.actor(c.who, ctx);
      const [x, z] = g.point(c.to, ctx);
      const toActor = typeof c.to === 'string' && !!g.actor(c.to, ctx, true);
      const p = a.walkTo(x, z, { nav: g.nav(), run: !!c.run, stopDistance: c.stop ?? (toActor ? 1.1 : 0.1), speed: c.speed ?? 1 });
      if (c.wait !== false) await p;
    });
    this.register('face', (c, ctx) => {
      const [x, z] = g.point(c.to, ctx);
      g.actor(c.who, ctx).faceToward(x, z);
    });
    this.register('emote', async (c, ctx) => {
      const p = g.emote(g.actor(c.who, ctx), c.icon || '!', c.s ?? 1.2);
      if (c.wait !== false) await p;
    });
    this.register('hop', async (c, ctx) => {
      const p = g.actor(c.who, ctx).hop(c.height ?? 0.32, c.s ?? 0.3);
      if (c.wait !== false) await p;
    });
    this.register('wait', (c) => g.wait(c.s ?? 0.5));
    this.register('camera', async (c, ctx) => {
      if (c.reset) g.cameraReset();
      if (c.focus) g.rig.follow = g.actor(c.focus, ctx);
      if (c.distance) g.rig.distanceTarget = c.distance;
      if (c.s) await g.wait(c.s);
    });
    this.register('fade', (c) => g.fadeTo(c.to ?? 1, c.s ?? 0.6));
    this.register('time', async (c) => {
      g.cycle.transitionTo(c.hour, c.s ?? 3);
      await g.wait(c.s ?? 3);
    });
    this.register('flag', (c) => {
      if (c.set) g.flags.add(c.set);
      if (c.clear) g.flags.delete(c.clear);
    });
    this.register('if', async (c, ctx) => {
      const ok = c.flag !== undefined ? g.flags.has(c.flag) : c.notFlag !== undefined ? !g.flags.has(c.notFlag) : !!c.cond;
      const branch = ok ? c.then : c.else;
      if (branch) await run(branch, ctx);
    });
    this.register('warp', (c) => g.warp(c.map, c.spawn));
    this.register('sound', (c) => { if (g.sfx[c.name]) g.sfx[c.name](); });
    this.register('banner', (c) => g.banner.show(c.title, c.subtitle || ''));
    this.register('save', () => g.save());
    this.register('run', (c, ctx) => run(g.findScript(c.script), ctx));
  }

  /** Add or replace a command: fn(command, ctx) may return a promise. */
  register(name, fn) {
    this.handlers[name] = fn;
  }

  get busy() {
    return this.running > 0;
  }

  async run(script, ctx = {}) {
    if (!script) return;
    this.running++;
    try {
      for (const c of script) {
        const h = this.handlers[c.do];
        if (!h) { console.warn(`Unknown event command "${c.do}"`, c); continue; }
        await h(c, ctx);
      }
    } finally {
      this.running--;
    }
  }
}
