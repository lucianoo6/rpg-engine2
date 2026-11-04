// Shared helpers for the browser tests: a Vite dev server on a free port and
// a Chromium page that collects console errors and can step the game.
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));

// software GL works everywhere (CI, containers); a real GPU is used when present
const GL_ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];

export async function startServer() {
  const server = await createServer({ root, logLevel: 'error', server: { port: 0, host: '127.0.0.1' } });
  await server.listen();
  const { port } = server.httpServer.address();
  return { server, url: `http://127.0.0.1:${port}/` };
}

export async function launch() {
  return chromium.launch({ args: GL_ARGS });
}

/** Messages that are not our bugs (driver chatter in software GL). */
const IGNORE = [/GPU stall due to ReadPixels/, /Automatic fallback to software WebGL/, /\[vite\]/];

export async function openPage(browser, url, { width = 640, height = 360, context = null } = {}) {
  const page = await (context || browser).newPage({ viewport: { width, height } });
  const problems = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if ((m.type() === 'error' || m.type() === 'warning') && !IGNORE.some((r) => r.test(m.text()))) problems.push(`${m.type()}: ${m.text()}`);
  });
  await page.goto(url, { waitUntil: 'load', timeout: 120000 });
  return { page, problems };
}

/** Game page in deterministic manual mode, with stepping helpers on window.T. */
export async function openGame(browser, baseUrl, query = '', opts = {}) {
  const r = await openPage(browser, `${baseUrl}?nogui&manual&mute&quality=low&${query}`, opts);
  await r.page.waitForFunction(() => window.hd2d, null, { timeout: 120000 });
  await r.page.evaluate(() => {
    const yieldFrame = () => new Promise((res) => setTimeout(res, 0)); // lets event-script promises run
    window.T = {
      async step(n = 1) {
        for (let i = 0; i < n; i++) { hd2d.engine.step(1 / 30); await yieldFrame(); }
      },
      press(code) { hd2d.input.pressedSet.add(code); },
      /** Step until cond() holds; auto-advances dialogue and picks `pick` in choices. */
      async until(cond, maxFrames = 900, pick = 0) {
        const d = hd2d.dialogue;
        for (let i = 0; i < maxFrames; i++) {
          if (cond()) return i;
          if (d.active && d._shown >= d._full.length && i % 6 === 0) {
            if (d._line.options && d._choice !== null) d._choice = pick;
            hd2d.input.pressedSet.add('Space');
          }
          hd2d.engine.step(1 / 30);
          await yieldFrame();
        }
        return -1;
      },
    };
  });
  return r;
}
