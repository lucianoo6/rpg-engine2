import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, launch, openPage, openGame } from './harness.js';

let srv, browser;
before(async () => { srv = await startServer(); browser = await launch(); });
after(async () => { await browser?.close(); await srv?.server.close(); });

/** Mean and spread of the frame's luminance, to catch black or blank renders. */
async function frameStats(page) {
  const png = await page.screenshot({ timeout: 120000 });
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = new OffscreenCanvas(img.width, img.height);
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, img.width, img.height).data;
    let sum = 0, sum2 = 0, n = 0;
    for (let i = 0; i < d.length; i += 16) {
      const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      sum += l; sum2 += l * l; n++;
    }
    const mean = sum / n;
    return { mean, std: Math.sqrt(sum2 / n - mean * mean) };
  }, png.toString('base64'));
}

test('the village boots, renders a lit frame and logs no errors', async () => {
  const { page, problems } = await openGame(browser, srv.url, 'notitle&nosave&time=13&at=22,33.2');
  await page.evaluate(() => { hd2d.map.world.triggers.forEach((t) => { t.fired = true; }); return T.step(6); });
  const s = await frameStats(page);
  assert.ok(s.mean > 40, `frame too dark (mean ${s.mean.toFixed(1)})`);
  assert.ok(s.std > 15, `frame looks blank (std ${s.std.toFixed(1)})`);
  const info = await page.evaluate(() => ({ calls: hd2d.engine.stats.calls, programs: hd2d.engine.stats.programs, map: hd2d.map.id }));
  assert.equal(info.map, 'village');
  assert.ok(info.calls > 20, `draw calls ${info.calls}`);
  assert.deepEqual(problems, []);
  await page.close();
});

test('the inn loads from its Tiled file with a sprite sheet from disk', async () => {
  const { page, problems } = await openGame(browser, srv.url, 'notitle&nosave&map=inn&at=7,6.3&time=22');
  const r = await page.evaluate(async () => {
    await T.step(6);
    const marta = hd2d.map.findNpc('Marta');
    return { map: hd2d.map.id, indoor: !!hd2d.map.env.indoor, martaFromFile: !!marta.char.sheet.frameRects, npcs: hd2d.map.npcs.length };
  });
  assert.deepEqual(r, { map: 'inn', indoor: true, martaFromFile: true, npcs: 2 });
  const s = await frameStats(page);
  assert.ok(s.mean > 20 && s.std > 10, `inn frame looks wrong (${JSON.stringify(s)})`);
  assert.deepEqual(problems, []);
  await page.close();
});

test('every quality preset applies without errors', async () => {
  const { page, problems } = await openGame(browser, srv.url, 'notitle&nosave&at=27,33.5&time=22');
  const levels = await page.evaluate(async () => {
    const out = [];
    for (const l of ['low', 'medium', 'high', 'ultra']) {
      hd2d.quality.set(l, { auto: false });
      await T.step(3);
      out.push([l, hd2d.lightPool.size, hd2d.engine.post.gatherMat.defines.SAMPLES]);
    }
    return out;
  });
  assert.deepEqual(levels, [['low', 4, 16], ['medium', 6, 24], ['high', 8, 40], ['ultra', 10, 56]]);
  assert.deepEqual(problems, []);
  await page.close();
});

test('tool pages load without errors', async () => {
  for (const p of ['sprites.html', 'minimal.html', 'export.html']) {
    const { page, problems } = await openPage(browser, `${srv.url}${p}?manual`);
    await page.waitForTimeout(1500);
    assert.deepEqual(problems, [], p);
    await page.close();
  }
});
