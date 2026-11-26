(() => {
  "use strict";
  const clamp = (v, low = 0, high = 1) => Math.max(low, Math.min(high, v));
  function luminance(color) {
    const linear = [color.r, color.g, color.b].map(v => {
      const c = v / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
  }
  function contrast(a, b) {
    const x = luminance(a), y = luminance(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  }
  function saturation(c) {
    const high = Math.max(c.r, c.g, c.b), low = Math.min(c.r, c.g, c.b);
    return high === 0 ? 0 : (high - low) / high;
  }
  function distance(a, b) {
    return Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b) / (255 * Math.sqrt(3));
  }
  function composite(c, alpha, backdrop) {
    return { r: c.r * alpha + backdrop * (1 - alpha), g: c.g * alpha + backdrop * (1 - alpha), b: c.b * alpha + backdrop * (1 - alpha) };
  }
  function inferTheme(samples, prefersDark) {
    const colors = new Map();
    for (const c of samples.filter(c => c && c.a >= 0.8)) {
      const key = [c.r, c.g, c.b].map(v => Math.round(v / 16)).join(",");
      const entry = colors.get(key) || { color: c, count: 0 };
      entry.count += 1;
      colors.set(key, entry);
    }
    const best = [...colors.values()].sort((a, b) => b.count - a.count)[0];
    const base = best?.color || (prefersDark ? { r: 24, g: 26, b: 31, a: 1 } : { r: 255, g: 255, b: 255, a: 1 });
    return { base, mode: luminance(base) < 0.35 ? "dark" : "light" };
  }
  function surface(color, foreground, info, theme, settings) {
    if (!color || color.a < 0.04 || info.protected) return null;
    // Leave status/brand colors alone unless they are the page's own base tint.
    if (saturation(color) > 0.32 && distance(color, theme.base) > 0.2) return null;
    const t = clamp(settings.transparency / 100);
    const base = info.root || (info.large && distance(color, theme.base) < 0.15);
    let factor = base ? (1 - t) ** 3 : info.elevated ? 0.98 - t * 0.16 : 0.92 - t * 0.55;
    let alpha = color.a * factor;
    // Protect cards against both a black and a white desktop backdrop. Clear
    // page canvases are intentionally exempt, otherwise they could never clear.
    if (settings.protectContrast && !base && foreground?.a >= 0.8 && contrast(foreground, color) >= 4.5) {
      while (alpha < color.a && Math.min(contrast(foreground, composite(color, alpha, 0)), contrast(foreground, composite(color, alpha, 255))) < 4.5) {
        alpha = Math.min(color.a, alpha + 0.025);
      }
    }
    return { ...color, a: clamp(alpha), kind: base ? "base" : info.elevated ? "overlay" : "surface" };
  }
  function css(color) {
    return `rgba(${Math.round(color.r)}, ${Math.round(color.g)}, ${Math.round(color.b)}, ${Math.round(clamp(color.a) * 1000) / 1000})`;
  }
  // Computed gradients resolve their stop colors. Images, masks, URL functions
  // and paint worklets are deliberately not rewritten.
  function gradient(image, parseColor) {
    if (!image || image === "none" || /url\(|image-set\(|paint\(/i.test(image) || !/gradient\(/i.test(image)) return null;
    const pattern = /(?:rgba?|hsla?|oklch|oklab|lab|lch|color)\([^()]*\)|#[0-9a-f]{3,8}\b/gi;
    const stops = [...image.matchAll(pattern)].map(match => ({ text: match[0], color: parseColor(match[0]) }));
    if (!stops.length || stops.some(stop => !stop.color)) return null;
    const mean = { r: 0, g: 0, b: 0, a: 0 };
    for (const { color } of stops) for (const key of Object.keys(mean)) mean[key] += color[key] / stops.length;
    return { color: mean, recolor(alpha) {
      let i = 0;
      return image.replace(pattern, () => { const c = stops[i++].color; return css({ ...c, a: c.a * alpha }); });
    }, colors: stops.map(stop => stop.color) };
  }
  // Reads a CSS color without a canvas. Browsers with fingerprinting protection
  // (Helide's canvas pixel noising among them) perturb canvas read-back by a
  // level or so, which would skew every tint. Returns null for forms it does
  // not know (named colors, display-p3 ...); the caller then asks a canvas.
  const NUMBER = "[+-]?(?:\\d+\\.?\\d*|\\.\\d+)(?:e[+-]?\\d+)?";
  const SPACE = "(?:\\s*,\\s*|\\s+)";
  const FUNCTION = /^(rgba?|hsla?|oklab|oklch|lab|lch|color)\(\s*([^)]*?)\s*\)$/i;
  function channels(body) {
    const [main, alpha = null, ...extra] = body.split("/").map(part => part.trim());
    if (extra.length) return null;
    const parts = main.split(/\s*,\s*|\s+/).filter(Boolean);
    if (alpha === null && parts.length === 4) return { parts: parts.slice(0, 3), alpha: parts[3] };
    return parts.length === 3 ? { parts, alpha } : null;
  }
  function number(text, percentScale) {
    if (text === "none") return 0;
    const match = new RegExp("^(" + NUMBER + ")(%?)$", "i").exec(text);
    if (!match) return null;
    const value = Number(match[1]);
    return match[2] ? value / 100 * percentScale : value;
  }
  function hue(text) {
    if (text === "none") return 0;
    const match = new RegExp("^(" + NUMBER + ")(deg|rad|grad|turn)?$", "i").exec(text);
    if (!match) return null;
    const value = Number(match[1]), unit = (match[2] || "deg").toLowerCase();
    return unit === "rad" ? value * 180 / Math.PI : unit === "grad" ? value * 0.9 : unit === "turn" ? value * 360 : value;
  }
  const encode = v => {
    const x = clamp(v);
    return 255 * (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055);
  };
  function fromOklab(L, a, b) {
    const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
    return [encode(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
      encode(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
      encode(-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s)];
  }
  function fromLab(L, a, b) {
    const fy = (L + 16) / 116, fx = fy + a / 500, fz = fy - b / 200;
    const epsilon = 216 / 24389, kappa = 24389 / 27;
    const x = (fx ** 3 > epsilon ? fx ** 3 : (116 * fx - 16) / kappa) * 0.96422;
    const y = L > kappa * epsilon ? fy ** 3 : L / kappa;
    const z = (fz ** 3 > epsilon ? fz ** 3 : (116 * fz - 16) / kappa) * 0.82521;
    // XYZ (D50) to linear sRGB, Bradford-adapted.
    return [encode(3.1338561 * x - 1.6168667 * y - 0.4906146 * z),
      encode(-0.9787684 * x + 1.9161415 * y + 0.0334540 * z),
      encode(0.0719453 * x - 0.2289914 * y + 1.4052427 * z)];
  }
  function parse(text) {
    text = String(text ?? "").trim();
    if (text.startsWith("#")) {
      const hex = text.slice(1);
      if (!/^[0-9a-f]+$/i.test(hex) || ![3, 4, 6, 8].includes(hex.length)) return null;
      const full = hex.length < 5 ? [...hex].map(c => c + c).join("") : hex;
      const byte = i => parseInt(full.slice(i * 2, i * 2 + 2), 16);
      return { r: byte(0), g: byte(1), b: byte(2), a: full.length === 8 ? byte(3) / 255 : 1 };
    }
    const match = FUNCTION.exec(text);
    if (!match) return null;
    const name = match[1].toLowerCase();
    let body = match[2];
    if (name === "color") {
      // Only the sRGB form; display-p3 and friends need a real conversion.
      const srgb = /^srgb\s+(.*)$/i.exec(body);
      if (!srgb) return null;
      body = srgb[1];
    }
    const split = channels(body);
    if (!split) return null;
    let alpha = 1;
    if (split.alpha !== null) {
      alpha = number(split.alpha, 1);
      if (alpha === null) return null;
    }
    const p = split.parts;
    let rgb;
    if (name === "rgb" || name === "rgba") {
      const values = p.map(part => number(part, 255));
      if (values.includes(null)) return null;
      rgb = values.map(v => clamp(v, 0, 255));
    } else if (name === "color") {
      const values = p.map(part => number(part, 1));
      if (values.includes(null)) return null;
      rgb = values.map(v => clamp(v) * 255);
    } else if (name === "hsl" || name === "hsla") {
      const H = hue(p[0]), S = number(p[1], 1), L = number(p[2], 1);
      if (H === null || S === null || L === null || !/%$/.test(p[1]) || !/%$/.test(p[2])) return null;
      const sat = clamp(S), light = clamp(L), k = n => (n + H / 30) % 12;
      const f = n => light - sat * Math.min(light, 1 - light) * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
      rgb = [f(0), f(8), f(4)].map(v => clamp(v) * 255);
    } else if (name === "oklab" || name === "lab") {
      const ok = name === "oklab";
      const L = number(p[0], ok ? 1 : 100), a = number(p[1], ok ? 0.4 : 125), b = number(p[2], ok ? 0.4 : 125);
      if (L === null || a === null || b === null) return null;
      rgb = ok ? fromOklab(L, a, b) : fromLab(L, a, b);
    } else {
      const ok = name === "oklch";
      const L = number(p[0], ok ? 1 : 100), C = number(p[1], ok ? 0.4 : 150), H = hue(p[2]);
      if (L === null || C === null || H === null) return null;
      const radians = H * Math.PI / 180;
      rgb = (ok ? fromOklab : fromLab)(L, C * Math.cos(radians), C * Math.sin(radians));
    }
    return { r: Math.round(rgb[0]), g: Math.round(rgb[1]), b: Math.round(rgb[2]), a: clamp(alpha) };
  }
  const api = { luminance, contrast, saturation, distance, inferTheme, surface, css, gradient, parse };
  globalThis.HelideStylesPalette = api;
  if (typeof module !== "undefined") module.exports = api;
})();
