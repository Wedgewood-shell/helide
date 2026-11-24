#!/usr/bin/env node
// End-to-end test for smart sidebar collapse: the vertical tab strip collapses
// while the window is narrower than 65% of the screen and expands while it is
// wider, and a three-finger swipe over a collapsed strip shows the titles in
// pills that grow out of it.
//
// Runs Helide against the fake Wayland compositor in
// tests/fake-wayland-compositor (a 1280x800 output) with temporary profiles,
// resizes the window from the compositor and checks frames of it. No real
// input devices or desktop session are involved.
//
//   node scripts/test-smart-sidebar-collapse.mjs
//
// Needs a built tree (build/src/out/Default/helium), libwayland-server and
// wayland-scanner. HELIDE_TEST_EXECUTABLE overrides the browser.
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';

import {
  activate, activeTab, changed, ensureBuilt, makeTester, openTabs, run, session as baseSession, waitFor,
} from './lib/fake-wayland-browser.mjs';

const frames = '/tmp/helide-smart-sidebar-frame';
const SCREEN_WIDTH = 1280;
// 65% of the screen is 832 DIPs.
const NARROW = 800, WIDE = 900;

const session = (browserPrefs, body, prefs = {}) => baseSession({
  browserPrefs, prefs, vmodule: 'helium_smart_sidebar_collapse=1,helium_tab_scrubber=1',
  logFilter: /Smart sidebar|Tab scrub|Check failed|FATAL/,
}, body);
const tester = makeTester();
const { test } = tester;

// The share of a rectangle that has the tab strip's background colour,
// sampled low in the strip, under the tabs.
function stripShare(frame, [x0, y0, x1, y1]) {
  const at = (x, y) => {
    const i = (y * frame.width + x) * 3;
    return [frame.pixels[i], frame.pixels[i + 1], frame.pixels[i + 2]];
  };
  const strip = at(20, 650);
  let same = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const [r, g, b] = at(x, y);
    if (Math.abs(r - strip[0]) + Math.abs(g - strip[1]) + Math.abs(b - strip[2]) < 8) same++;
  }
  return same / ((x1 - x0) * (y1 - y0));
}
// The rows of a frame from `y0` down.
const crop = (frame, y0) => ({
  width: frame.width, height: frame.height - y0, pixels: frame.pixels.subarray(y0 * frame.width * 3),
});
// The page when collapsed, the strip when expanded.
const STRIP_EDGE = [70, 560, 190, 640];

// The frames include the window's shadow, so they are wider than the window.
const frameWidth = async compositor => +(await compositor.cmd('size')).match(/^ok size (\d+)/)[1];

// Each session's window starts as wide as the screen.
let shadow = 0;
const measureShadow = async compositor => { shadow = await frameWidth(compositor) - SCREEN_WIDTH; };

async function resize(compositor, width, name) {
  await compositor.cmd(`resize ${width} 800`);
  await waitFor(async () => await frameWidth(compositor) === width + shadow,
      `the window to become ${width} wide`);
  await sleep(900);  // the collapse animation
  return compositor.frame(`${frames}-${name}.ppm`);
}
const expanded = frame => stripShare(frame, STRIP_EDGE) > 0.9;
const collapsed = frame => stripShare(frame, STRIP_EDGE) < 0.1;

ensureBuilt();

await session({ smart_sidebar_collapse: true }, async ({ compositor, cdp }) => {
  await openTabs(cdp, 4);
  await compositor.cmd('motion 1000 400');  // away from the strip
  await sleep(800);
  await measureShadow(compositor);

  await test('a window as wide as the screen keeps the strip expanded', async () => {
    const frame = await compositor.frame(`${frames}-full.ppm`);
    assert.ok(expanded(frame), `strip share ${stripShare(frame, STRIP_EDGE)}`);
  });

  await test(`narrower than 65% of the screen (${NARROW} of ${SCREEN_WIDTH}) collapses it`, async () => {
    const frame = await resize(compositor, NARROW, 'narrow');
    assert.ok(collapsed(frame), `strip share ${stripShare(frame, STRIP_EDGE)}`);
  });

  await test('a swipe over the collapsed strip shows the title in a pill over the page', async () => {
    await activate(cdp, 'Tab 1');
    await compositor.cmd('motion 600 400');
    await sleep(300);
    const before = await compositor.frame(`${frames}-pill-before.ppm`);
    await compositor.swipe(3, run(80, 20));
    await sleep(300);
    const during = await compositor.frame(`${frames}-pill-during.ppm`);
    // Right of the 42 DIP strip, where only a pill draws.
    const pill = changed(before, during, { x0: 60, x1: 110 });
    assert.ok(pill.count > 300, `the pill should reach over the page (changed pixels: ${pill.count})`);
    const beyond = changed(before, during, { x0: 400, x1: NARROW });
    assert.ok(beyond.count < 50, `and stop after the title (changed pixels: ${beyond.count})`);
    await compositor.end();
    await sleep(600);
    assert.equal((await activeTab(cdp)).title, 'Tab 3', 'lifting still switches');
    // Below the page's text, which changed with the tab.
    const after = await compositor.frame(`${frames}-pill-after.ppm`);
    const left = changed(crop(before, 100), crop(after, 100), { x0: 60, x1: 110 });
    assert.ok(left.count < 50, `the pill goes away (changed pixels: ${left.count})`);
  });

  await test('wider than 65% of the screen expands it again', async () => {
    await compositor.cmd('motion 850 400');
    const frame = await resize(compositor, WIDE, 'wide');
    assert.ok(expanded(frame), `strip share ${stripShare(frame, STRIP_EDGE)}`);
  });

  await test('a height change alone does nothing', async () => {
    await compositor.cmd(`resize ${WIDE} 780`);
    await sleep(900);
    const frame = await compositor.frame(`${frames}-shorter.ppm`);
    assert.ok(expanded(frame), `strip share ${stripShare(frame, STRIP_EDGE)}`);
  });
});

await session({ smart_sidebar_collapse: false }, async ({ compositor, cdp }) => {
  await openTabs(cdp, 2);
  await compositor.cmd('motion 1000 400');
  await sleep(800);
  await measureShadow(compositor);

  await test('turned off, a narrow window keeps the strip expanded', async () => {
    const frame = await resize(compositor, NARROW, 'off-narrow');
    assert.ok(expanded(frame), `strip share ${stripShare(frame, STRIP_EDGE)}`);
  });
});

await session({ smart_sidebar_collapse: true }, async ({ compositor, cdp }) => {
  await openTabs(cdp, 2);
  await compositor.cmd('motion 1000 400');
  await sleep(800);
  await measureShadow(compositor);

  await test('a collapsed strip from the last session expands in a wide window', async () => {
    const frame = await compositor.frame(`${frames}-restored.ppm`);
    assert.ok(expanded(frame), `strip share ${stripShare(frame, STRIP_EDGE)}`);
  });
}, { vertical_tabs: { collapsed_state: true } });

if (tester.failures) { console.log(`${tester.failures} test(s) failed`); process.exit(1); }
console.log('All smart sidebar collapse tests passed.');
