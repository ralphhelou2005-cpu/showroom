// Pure math, no imports: shared by the main thread and the texture worker.
const TAU = Math.PI * 2;

export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(x, y, s) {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(s, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}

const smooth = (t) => t * t * (3 - 2 * t);

// Periodic value noise: tiles seamlessly on the unit square.
function vnoise(u, v, px, py, s) {
  const x = u * px;
  const y = v * py;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = smooth(x - x0);
  const fy = smooth(y - y0);
  const xa = ((x0 % px) + px) % px;
  const ya = ((y0 % py) + py) % py;
  const xb = (xa + 1) % px;
  const yb = (ya + 1) % py;
  const a = hash(xa, ya, s);
  const b = hash(xb, ya, s);
  const c = hash(xa, yb, s);
  const d = hash(xb, yb, s);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

function fbm(u, v, period, octaves, s) {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let p = period;
  for (let i = 0; i < octaves; i++) {
    sum += amp * vnoise(u, v, p, p, s + i * 17);
    norm += amp;
    amp *= 0.5;
    p *= 2;
  }
  return sum / norm;
}

const hx = (h) => {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

// Each surface writes o = [r, g, b (0-255 sRGB), roughness (0-1), height].
const SURFACES = {
  marble(u, v, o, P) {
    const n = P.slabs;
    const su = u * n;
    const sv = v * n;
    const ix = Math.floor(su);
    const iy = Math.floor(sv);
    const lu = su - ix;
    const lv = sv - iy;
    const slab = hash(ix, iy, 7);
    const uu = (u + slab * 0.37) % 1;
    const vv = (v + slab * 0.61) % 1;
    const wx = fbm(uu, vv, 3, 3, 11);
    const wy = fbm(uu, vv, 3, 3, 13);
    const cloud = fbm(uu + wx * 0.1, vv + wy * 0.1, 5, 4, 21);
    const r1 = 1 - Math.abs(2 * fbm(uu + wx * 0.18, vv + wy * 0.18, 4, 3, 31) - 1);
    const r2 = 1 - Math.abs(2 * fbm(uu + wy * 0.12, vv + wx * 0.12, 9, 3, 41) - 1);
    const vein = Math.min(1, Math.pow(r1, 42) * 0.8 + Math.pow(r2, 70) * 0.35);
    const tone = 0.95 + slab * 0.1;
    const k = clamp01((cloud - 0.35) * 2.2);
    const { b, t, vc } = P;
    let R = (b[0] + (t[0] - b[0]) * k) * tone;
    let G = (b[1] + (t[1] - b[1]) * k) * tone;
    let B = (b[2] + (t[2] - b[2]) * k) * tone;
    R += (vc[0] - R) * vein * (P.vs ?? 0.4);
    G += (vc[1] - G) * vein * (P.vs ?? 0.4);
    B += (vc[2] - B) * vein * (P.vs ?? 0.4);
    const speck = vnoise(uu, vv, 384, 384, 51);
    const scuff = Math.max(0, fbm(u, v, 6, 3, 61) - 0.52) * 0.55;
    const scratch = vnoise(uu, vv, 3, 420, 71) * vnoise(uu, vv, 420, 3, 73);
    let rough = 0.17 + cloud * 0.1 + (speck > 0.84 ? 0.12 : 0) + vein * 0.06 + scuff + scratch * 0.1 + (P.roughBias || 0);
    let height = -vein * 0.25 + (speck - 0.5) * 0.12;
    if (P.joint > 0) {
      const d = Math.min(lu, 1 - lu, lv, 1 - lv);
      if (d < P.joint) {
        const jm = 1 - clamp01((d - P.joint * 0.45) / (P.joint * 0.55));
        R += (P.grout[0] - R) * jm;
        G += (P.grout[1] - G) * jm;
        B += (P.grout[2] - B) * jm;
        rough += (0.78 - rough) * jm;
        height -= jm;
      }
    }
    o[0] = R; o[1] = G; o[2] = B; o[3] = rough; o[4] = height;
  },

  concrete(u, v, o, P) {
    const cloud = fbm(u, v, 3, 5, 101);
    const mid = fbm(u, v, 12, 3, 103);
    const pit = vnoise(u, v, 160, 160, 107);
    const pitMask = pit > 0.86 ? (pit - 0.86) / 0.14 : 0;
    let board = 0;
    let tone = 0;
    if (P.boards) {
      const by = v * P.boards;
      const f = by - Math.floor(by);
      board = f < 0.014 ? 1 : 0;
      tone = (hash(Math.floor(by), 0, 5) - 0.5) * 0.09;
    }
    const l = P.base + (cloud - 0.5) * P.contrast + (mid - 0.5) * 10 - pitMask * 30 - board * 22 + tone * 255;
    o[0] = l * P.tint[0]; o[1] = l * P.tint[1]; o[2] = l * P.tint[2];
    o[3] = 0.72 + (cloud - 0.5) * 0.2 + pitMask * 0.1;
    o[4] = (cloud - 0.5) * 0.3 + mid * 0.1 - pitMask * 0.8 - board * 0.5;
  },

  wood(u, v, o, P) {
    const sl = u * P.slats;
    const slat = Math.floor(sl);
    const lu = sl - slat;
    const s = hash(slat, 3, 9);
    const uu = (u + s) % 1;
    const warp = fbm(uu, v, 2, 4, 111);
    const rings = Math.sin((lu * 3.2 + warp * 2.2 + s * 5) * TAU) * 0.5 + 0.5;
    const fiber = vnoise(uu, v, 120, 5, 113);
    const pore = vnoise(uu, v, 220, 22, 115) > 0.78 ? 1 : 0;
    const tone = clamp01(0.55 * rings + 0.45 * fiber) * 0.85;
    const bright = 0.9 + s * 0.2;
    const { dark, light } = P;
    o[0] = (dark[0] + (light[0] - dark[0]) * tone) * bright;
    o[1] = (dark[1] + (light[1] - dark[1]) * tone) * bright;
    o[2] = (dark[2] + (light[2] - dark[2]) * tone) * bright;
    o[3] = 0.36 + fiber * 0.14 + pore * 0.1;
    o[4] = fiber * 0.12 - pore * 0.3 + rings * 0.08;
    if (lu < 0.012 || lu > 0.988) {
      o[0] *= 0.35; o[1] *= 0.35; o[2] *= 0.35; o[3] = 0.8; o[4] = -0.8;
    }
  },

  brushed(u, v, o, P) {
    const st = vnoise(u, v, 3, P.lines, 121) * 0.6 + vnoise(u, v, 5, P.lines * 2, 123) * 0.4;
    const lum = 150 + (st - 0.5) * P.contrast * 2;
    o[0] = lum; o[1] = lum; o[2] = lum;
    o[3] = P.rough + (st - 0.5) * 0.22;
    o[4] = (st - 0.5) * 0.25;
  },

  leather(u, v, o, P) {
    const g1 = vnoise(u, v, P.cells, P.cells, 131);
    const g2 = vnoise(u, v, P.cells * 2, P.cells * 2, 133);
    const h = (1 - Math.abs(2 * g1 - 1)) * 0.6 + g2 * 0.25;
    const lum = 126 + (h - 0.5) * 22;
    o[0] = lum; o[1] = lum; o[2] = lum;
    o[3] = 0.5 + (1 - h) * 0.12;
    o[4] = h;
  },

  fabric(u, v, o, P) {
    const a = Math.sin(u * P.threads * TAU);
    const b = Math.sin(v * P.threads * TAU);
    const weave = a * b * 0.5 + 0.5;
    const fiber = vnoise(u, v, 256, 256, 141);
    const lum = 120 + (weave - 0.5) * 26 + (fiber - 0.5) * 30;
    o[0] = lum; o[1] = lum; o[2] = lum;
    o[3] = 0.85;
    o[4] = weave * 0.5 + fiber * 0.3;
  },

  soil(u, v, o) {
    const n = fbm(u, v, 8, 4, 151);
    const g = vnoise(u, v, 96, 96, 153);
    const l = 0.55 + n * 0.5 + (g - 0.5) * 0.4;
    o[0] = 54 * l; o[1] = 40 * l; o[2] = 31 * l;
    o[3] = 0.95;
    o[4] = n * 0.5 + g * 0.5;
  },
};

// quick: size generated synchronously for the first frame. full: size generated in the background.
export const SPECS = {
  floor: { kind: 'marble', quick: 512, full: 512, normal: 0.025, P: { slabs: 3, joint: 0.0015, vs: 0.62, roughBias: 0.09, b: hx('#e3e5e1'), t: hx('#cdd2ce'), vc: hx('#858e8b'), grout: hx('#bdc4bf') } },
  counter: { kind: 'marble', quick: 128, full: 512, normal: 0.5, P: { slabs: 1, joint: 0, b: hx('#e6e1d4'), t: hx('#d3cdbe'), vc: hx('#9a9488'), grout: hx('#000000') } },
  darkstone: { kind: 'marble', quick: 128, full: 512, normal: 0.5, P: { slabs: 1, joint: 0, b: hx('#2b2d2c'), t: hx('#3a3c3a'), vc: hx('#9b9b95'), grout: hx('#000000') } },
  concrete: { kind: 'concrete', quick: 128, full: 512, normal: 0.8, P: { base: 178, contrast: 40, tint: [1, 0.99, 0.96], boards: 0 } },
  asphalt: { kind: 'concrete', quick: 64, full: 256, normal: 0.35, P: { base: 92, contrast: 24, tint: [0.96, 0.97, 0.98], boards: 0 } },
  board: { kind: 'concrete', quick: 128, full: 512, normal: 0.9, P: { base: 190, contrast: 30, tint: [1, 0.99, 0.97], boards: 10 } },
  wood: { kind: 'wood', quick: 128, full: 768, normal: 0.6, P: { slats: 6, dark: hx('#6b4a31'), light: hx('#b88d5f') } },
  brushed: { kind: 'brushed', quick: 128, full: 512, normal: 0.5, P: { lines: 220, contrast: 38, rough: 0.3 } },
  leather: { kind: 'leather', quick: 128, full: 512, normal: 0.7, P: { cells: 110 } },
  fabric: { kind: 'fabric', quick: 128, full: 512, normal: 0.9, P: { threads: 64 } },
  soil: { kind: 'soil', quick: 64, full: 256, normal: 1, P: {} },
  paving: { kind: 'marble', quick: 128, full: 512, normal: 0.35, P: { slabs: 6, joint: 0.006, roughBias: 0.5, b: hx('#c4bfb3'), t: hx('#b3aea2'), vc: hx('#a29d92'), grout: hx('#8a857b') } },
};

export function* surfaceJob(kind, size, P, normalStrength) {
  const fn = SURFACES[kind];
  const color = new Uint8ClampedArray(size * size * 4);
  const rough = new Uint8ClampedArray(size * size * 4);
  const height = new Float32Array(size * size);
  const o = [0, 0, 0, 0, 0];
  for (let y = 0; y < size; y++) {
    const v = 1 - (y + 0.5) / size;
    for (let x = 0; x < size; x++) {
      fn((x + 0.5) / size, v, o, P);
      const i = y * size + x;
      const j = i * 4;
      color[j] = o[0]; color[j + 1] = o[1]; color[j + 2] = o[2]; color[j + 3] = 255;
      const r = clamp01(o[3]) * 255;
      rough[j] = r; rough[j + 1] = r; rough[j + 2] = r; rough[j + 3] = 255;
      height[i] = o[4];
    }
    if ((y & 7) === 7) yield;
  }
  const normal = new Uint8ClampedArray(size * size * 4);
  const k = normalStrength * 6;
  for (let y = 0; y < size; y++) {
    const ym = ((y - 1 + size) % size) * size;
    const yp = ((y + 1) % size) * size;
    for (let x = 0; x < size; x++) {
      const xm = (x - 1 + size) % size;
      const xp = (x + 1) % size;
      const nx = -(height[y * size + xp] - height[y * size + xm]) * k;
      const ny = (height[yp + x] - height[ym + x]) * k;
      const len = Math.hypot(nx, ny, 1);
      const j = (y * size + x) * 4;
      normal[j] = (nx / len * 0.5 + 0.5) * 255;
      normal[j + 1] = (ny / len * 0.5 + 0.5) * 255;
      normal[j + 2] = (1 / len * 0.5 + 0.5) * 255;
      normal[j + 3] = 255;
    }
    if ((y & 15) === 15) yield;
  }
  return { size, color, rough, normal };
}
