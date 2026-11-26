const { test } = require('node:test');
const assert = require('node:assert/strict');
const P = require('../palette.js');
require('../shared.js');
const white = { r: 255, g: 255, b: 255, a: 1 };
const dark = { r: 24, g: 26, b: 31, a: 1 };
const settings = { transparency: 65, protectContrast: true };
const theme = P.inferTheme([white, white, dark], true);
test('actual page palette wins over the OS theme', () => {
  assert.equal(theme.mode, 'light');
  assert.equal(P.inferTheme([dark, dark, white], false).mode, 'dark');
});
test('a page canvas is clearer than a text-bearing card', () => {
  const base = P.surface(white, dark, { root: true }, theme, settings);
  const card = P.surface(white, dark, {}, theme, settings);
  assert.ok(base.a < 0.1);
  assert.ok(card.a > base.a && card.a < 1);
  assert.equal(card.r, 255);
});
test('strong accent colors and protected surfaces are kept intact', () => {
  assert.equal(P.surface({ r: 15, g: 90, b: 245, a: 1 }, white, {}, theme, settings), null);
  assert.equal(P.surface(white, dark, { protected: true }, theme, settings), null);
});
test('contrast protection increases card opacity', () => {
  const safe = P.surface(dark, white, {}, P.inferTheme([dark], false), settings);
  const airy = P.surface(dark, white, {}, P.inferTheme([dark], false), { ...settings, protectContrast: false });
  assert.ok(safe.a > airy.a);
});
test('transparent pixels are not replaced with a tint', () => {
  assert.equal(P.surface({ ...white, a: 0 }, dark, {}, theme, settings), null);
});
test('existing alpha is never made more opaque than its original value', () => {
  assert.ok(P.surface({ ...white, a: 0.4 }, dark, {}, theme, settings).a <= 0.4);
});
test('image backgrounds cannot be rewritten as gradients', () => {
  assert.equal(P.gradient('url("https://example.test/image.png")', () => white), null);
  assert.equal(P.gradient('image-set(url("x") 1x)', () => white), null);
});
test('gradient stops retain color and get explicit alpha', () => {
  const gradient = P.gradient('linear-gradient(rgb(255, 255, 255), rgb(24, 26, 31))', value => value.includes('255') ? white : dark);
  assert.equal(gradient.recolor(0.4), 'linear-gradient(rgba(255, 255, 255, 0.4), rgba(24, 26, 31, 0.4))');
});
test('site opt-out and global disable take precedence', () => {
  const S = global.HelideStylesSettings;
  assert.equal(S.isEnabled(S.normalize({ sites: { 'example.test': false } }), 'example.test'), false);
  assert.equal(S.isEnabled(S.normalize({ enabled: false }), 'other.test'), false);
  assert.equal(S.isEnabled(S.normalize({ transparency: 0 }), 'other.test'), false);
  assert.equal(S.siteKey('file:///tmp/page.html'), 'file://');
  assert.equal(S.siteKey('chrome://flags'), null);
  assert.equal(S.normalize(null).transparency, 65);
});
// Colors are read in script, not through a canvas: canvas read-back is noised
// by fingerprinting protection, and premultiplied alpha loses precision.
// Expected values come from Chromium's own conversion.
test('parse reads rgb() in every syntax, exactly', () => {
  assert.deepEqual(P.parse('rgb(245, 246, 248)'), { r: 245, g: 246, b: 248, a: 1 });
  assert.deepEqual(P.parse('rgba(245, 246, 248, 0.008)'), { r: 245, g: 246, b: 248, a: 0.008 });
  assert.deepEqual(P.parse('rgb(10% 20% 30%)'), { r: 26, g: 51, b: 77, a: 1 });
  assert.deepEqual(P.parse('rgb(1 2 3 / 50%)'), { r: 1, g: 2, b: 3, a: 0.5 });
  assert.deepEqual(P.parse('  RGB(12.4, 99.5, 200)  '), { r: 12, g: 100, b: 200, a: 1 });
});
test('parse reads hex colors', () => {
  assert.deepEqual(P.parse('#abc'), { r: 170, g: 187, b: 204, a: 1 });
  const half = P.parse('#a1b2c380');
  assert.deepEqual([half.r, half.g, half.b], [161, 178, 195]);
  assert.ok(Math.abs(half.a - 128 / 255) < 1e-9);
  assert.equal(P.parse('#abcde'), null);
});
test('parse converts oklch, oklab, lab and lch like Chromium', () => {
  const rgb = text => { const c = P.parse(text); return [c.r, c.g, c.b]; };
  assert.deepEqual(rgb('oklch(0.627955 0.257683 29.2339)'), [255, 0, 0]);
  assert.deepEqual(rgb('oklch(0.97 0.013 255.5)'), [239, 246, 254]);
  assert.deepEqual(rgb('oklch(62.8% 0.2577 29.23)'), [255, 0, 0]);
  assert.deepEqual(rgb('oklch(0.7 0.1 0.5turn)'), [75, 179, 161]);
  assert.deepEqual(rgb('oklab(0.7 -0.05 0.1)'), [154, 167, 82]);
  assert.deepEqual(rgb('lab(50 40 -30)'), [165, 91, 171]);
  assert.deepEqual(rgb('lab(70% 20 40)'), [220, 157, 99]);
  assert.deepEqual(rgb('lch(70 50 120)'), [145, 183, 88]);
  assert.equal(P.parse('oklab(0.5 0 0 / 0.5)').a, 0.5);
});
test('parse reads hsl() and color(srgb)', () => {
  assert.deepEqual(P.parse('hsl(200 50% 40%)'), { r: 51, g: 119, b: 153, a: 1 });
  assert.deepEqual(P.parse('color(srgb 0.2 0.4 0.6)'), { r: 51, g: 102, b: 153, a: 1 });
});
test('parse leaves forms it does not know to the browser', () => {
  for (const text of ['red', 'color(display-p3 1 0 0)', 'rgb(1 2)', 'oklch(0.5 0.1)', 'rgb(a b c)', '', null]) {
    assert.equal(P.parse(text), null, String(text));
  }
});
test('gradients are recolored with the same exact parse', () => {
  const g = P.gradient('linear-gradient(rgb(240, 242, 246), rgb(226, 229, 234))', P.parse);
  assert.equal(g.recolor(0.5), 'linear-gradient(rgba(240, 242, 246, 0.5), rgba(226, 229, 234, 0.5))');
});
