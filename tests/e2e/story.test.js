// The whole loop a player goes through: opening cutscene, entering the inn,
// the innkeeper's welcome (path-finding round the bar), renting a room,
// leaving, and continuing from the save after a reload.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, launch, openGame } from './harness.js';

let srv, browser, context;
before(async () => {
  srv = await startServer();
  browser = await launch();
  context = await browser.newContext(); // one context = one localStorage for save/continue
});
after(async () => { await browser?.close(); await srv?.server.close(); });

test('opening, inn, welcome cutscene, saving and continuing', { timeout: 15 * 60 * 1000 }, async (t) => {
  let { page, problems } = await openGame(browser, srv.url, '', { context });
  await page.evaluate(() => { hd2d.engine.post.enabled = false; });

  await t.test('title starts a new journey and Pip greets the player', async () => {
    const r = await page.evaluate(async () => {
      await T.step(2);
      const hadMenu = hd2d.title.options.length;
      T.press('Enter');
      await T.step(2);
      const pip = hd2d.map.findNpc('Pip').char;
      let closest = 99;
      const frames = await T.until(() => {
        closest = Math.min(closest, pip.position.distanceTo(hd2d.player.position));
        return hd2d.flags.has('metPip') && !hd2d.events.busy;
      }, 1500);
      return { hadMenu, frames, closest };
    });
    assert.equal(r.hadMenu, 0, 'no Continue without a save');
    assert.ok(r.frames > 0, 'cutscene finished');
    assert.ok(r.closest < 1.5, `Pip ran up to the player (closest ${r.closest})`);
  });

  await t.test('the inn door warps inside and the welcome scene plays', async () => {
    const r = await page.evaluate(async () => {
      const sp = hd2d.map.spawns.innDoor;
      hd2d.player.position.set(sp.x, 0, sp.z - 0.1);
      hd2d.player.facing.set(0, -1);
      await T.step(2);
      const label = hd2d._findTarget()?.label;
      T.press('Space');
      const warped = await T.until(() => hd2d.map.id === 'inn' && !hd2d._warping, 300);
      const marta = hd2d.map.findNpc('Marta').char;
      let closest = 99;
      const done = await T.until(() => {
        closest = Math.min(closest, marta.position.distanceTo(hd2d.player.position));
        return hd2d.flags.has('rentedRoom') && !hd2d.events.busy && !hd2d.dialogue.active;
      }, 2500, 0);
      return { label, warped, done, closest, time: hd2d.cycle.time, back: marta.position.distanceTo({ x: 6.5, y: 0, z: 2.0 }) };
    });
    assert.equal(r.label, 'Enter');
    assert.ok(r.warped > 0, 'warped into the inn');
    assert.ok(r.done > 0, 'welcome scene finished');
    assert.ok(r.closest < 1.6, `Marta walked round the bar to the player (closest ${r.closest.toFixed(2)})`);
    assert.ok(Math.abs(r.time - 7.5) < 0.05, `resting set the clock to morning (${r.time})`);
    assert.ok(r.back < 0.5, 'Marta went back behind the bar');
  });

  await t.test('walking out of the door returns to the village and autosaves', async () => {
    const r = await page.evaluate(async () => {
      hd2d.player.position.set(7, 0, 9.6);
      hd2d.input.down.add('KeyS');
      const f = await T.until(() => hd2d.map.id === 'village' && !hd2d._warping, 300);
      hd2d.input.down.delete('KeyS');
      return { f, save: JSON.parse(localStorage.getItem('hollowbrook:save')) };
    });
    assert.ok(r.f > 0);
    assert.equal(r.save.map, 'village');
    assert.ok(r.save.flags.includes('rentedRoom'));
  });

  await t.test('after a reload, Continue restores map, place, time and flags', async () => {
    await page.close();
    ({ page, problems } = await openGame(browser, srv.url, '', { context }));
    const r = await page.evaluate(async () => {
      await T.step(2);
      const options = hd2d.title.options;
      T.press('Enter');
      await T.step(2);
      await T.until(() => !hd2d.busy, 300);
      const p = hd2d.player.position;
      return { options, map: hd2d.map.id, x: p.x, z: p.z, time: hd2d.cycle.time, flags: [...hd2d.flags] };
    });
    assert.deepEqual(r.options, ['Continue', 'New Journey']);
    assert.equal(r.map, 'village');
    assert.ok(Math.hypot(r.x - 11.7, r.z - 23) < 0.6, `position restored (${r.x}, ${r.z})`);
    assert.ok(Math.abs(r.time - 7.5) < 0.2);
    assert.ok(r.flags.includes('metPip') && r.flags.includes('rentedRoom'));
  });

  assert.deepEqual(problems, []);
});
