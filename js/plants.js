import * as THREE from 'three';
import { rng } from './textures.js';

const TAU = Math.PI * 2;

function bladeWidth(profile, b) {
  switch (profile) {
    case 'lance': return Math.pow(Math.sin(Math.PI * Math.pow(b, 0.6)), 1.15) * (1 - 0.15 * b);
    case 'heart': return Math.pow(Math.sin(Math.PI * Math.pow(b, 0.55)), 0.9);
    case 'sword': return Math.pow(Math.sin(Math.PI * Math.min(1, b * 0.96 + 0.02)), 0.25);
    default: return Math.pow(Math.sin(Math.PI * Math.pow(b, 0.75)), 0.85);
  }
}

// A leaf strip along +Y with a stalk, a midrib fold and a downward curl towards +Z.
function leafGeometry({ length, width, ls, ws, curl, fold, petiole, profile }) {
  const cols = ws * 2 + 1;
  const pos = [];
  const uv = [];
  const idx = [];
  for (let i = 0; i <= ls; i++) {
    const t = i / ls;
    const w = t < petiole ? 0.011 : width * bladeWidth(profile, (t - petiole) / (1 - petiole)) + 0.011;
    for (let j = 0; j < cols; j++) {
      const s = (j / (cols - 1)) * 2 - 1;
      const x = s * w;
      const arc = t * t * curl * length;
      pos.push(x, t * length - arc * 0.35, arc + (t < petiole ? 0 : Math.abs(x) * fold));
      uv.push((s + 1) / 2, t);
    }
  }
  for (let i = 0; i < ls; i++) {
    for (let j = 0; j < cols - 1; j++) {
      const a = i * cols + j;
      const c = a + cols;
      idx.push(a, a + 1, c, a + 1, c + 1, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function leafTexture(kind) {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 256;
  const g = c.getContext('2d');
  const [base, tip] = { broad: ['#1b3b1b', '#427c37'], long: ['#285222', '#52903f'], small: ['#5a7355', '#92a686'], monstera: ['#173620', '#38712f'], snake: ['#264a29', '#4a7c3d'] }[kind];
  const grad = g.createLinearGradient(0, 256, 0, 0);
  grad.addColorStop(0, base);
  grad.addColorStop(1, tip);
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 256);
  const r = rng(kind.length * 977);
  if (kind === 'snake') {
    for (let y = 0; y < 256; y += 9) {
      g.fillStyle = `rgba(${r() < 0.5 ? '12,36,14' : '196,214,128'},${0.16 + r() * 0.2})`;
      g.beginPath();
      g.moveTo(0, y);
      g.bezierCurveTo(40, y - 6 + r() * 12, 88, y - 6 + r() * 12, 128, y + r() * 6);
      g.lineTo(128, y + 4 + r() * 4);
      g.bezierCurveTo(88, y + 3, 40, y + 3, 0, y + 5);
      g.fill();
    }
  } else {
    g.strokeStyle = 'rgba(210,235,170,0.2)';
    g.lineWidth = 1.1;
    for (let i = 1; i < 16; i++) {
      const y = 256 - i * 16;
      for (const side of [-1, 1]) {
        g.beginPath();
        g.moveTo(64, y);
        g.quadraticCurveTo(64 + side * 30, y - 8, 64 + side * 62, y - 30);
        g.stroke();
      }
    }
    const rib = g.createLinearGradient(0, 256, 0, 0);
    rib.addColorStop(0, 'rgba(225,240,185,0.55)');
    rib.addColorStop(1, 'rgba(225,240,185,0.08)');
    g.strokeStyle = rib;
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(64, 256);
    g.lineTo(64, 0);
    g.stroke();
  }
  for (let i = 0; i < 220; i++) {
    g.fillStyle = r() < 0.5 ? 'rgba(0,0,0,0.07)' : 'rgba(230,240,180,0.06)';
    g.fillRect(r() * 128, r() * 256, 1 + r() * 2, 1 + r() * 2);
  }
  if (kind === 'monstera') {
    g.globalCompositeOperation = 'destination-out';
    for (let k = 0; k < 6; k++) {
      const y = 215 - k * 33;
      for (const side of [0, 128]) {
        const dir = side === 0 ? 1 : -1;
        g.beginPath();
        g.moveTo(side, y - 7);
        g.lineTo(side + dir * 50, y + 6);
        g.lineTo(side, y + 8);
        g.closePath();
        g.fill();
      }
    }
    for (let k = 0; k < 4; k++) {
      for (const side of [-1, 1]) {
        g.beginPath();
        g.ellipse(64 + side * 15, 190 - k * 38, 4, 8, 0, 0, TAU);
        g.fill();
      }
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

const SPECIES = {
  fig: { tex: 'broad', leaf: { length: 0.52, width: 0.17, ls: 8, ws: 2, curl: 0.2, fold: 0.12, petiole: 0.14, profile: 'ovate' }, lo: { ls: 3, ws: 1 }, rough: 0.38 },
  strelitzia: { tex: 'long', leaf: { length: 1.35, width: 0.2, ls: 10, ws: 2, curl: 0.16, fold: 0.1, petiole: 0.45, profile: 'lance' }, lo: { ls: 4, ws: 1 }, rough: 0.45 },
  olive: { tex: 'small', leaf: { length: 0.1, width: 0.02, ls: 3, ws: 1, curl: 0.15, fold: 0.1, petiole: 0.08, profile: 'lance' }, lo: { ls: 2, ws: 1 }, rough: 0.55 },
  monstera: { tex: 'monstera', leaf: { length: 0.6, width: 0.3, ls: 8, ws: 3, curl: 0.28, fold: 0.1, petiole: 0.42, profile: 'heart' }, lo: { ls: 3, ws: 2 }, rough: 0.4, alphaTest: 0.5 },
  snake: { tex: 'snake', leaf: { length: 1, width: 0.055, ls: 6, ws: 1, curl: 0.04, fold: 0.1, petiole: 0, profile: 'sword' }, lo: { ls: 2, ws: 1 }, rough: 0.34 },
};

const _y = new THREE.Vector3();
const _z = new THREE.Vector3();
const _x = new THREE.Vector3();
const _p = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _s = new THREE.Vector3();
const DOWN = new THREE.Vector3(0, -1, 0);

// Leaf grows along `elev`/`yaw`; its curl side (+Z) is rolled to point downwards so leaves droop naturally.
function leafMatrix(out, x, y, z, yaw, elev, roll, scale) {
  _y.set(Math.cos(elev) * Math.cos(yaw), Math.sin(elev), Math.cos(elev) * Math.sin(yaw));
  _z.copy(DOWN).addScaledVector(_y, -DOWN.dot(_y));
  if (_z.lengthSq() < 1e-4) _z.set(Math.cos(yaw), 0, Math.sin(yaw));
  _z.normalize().applyAxisAngle(_y, roll);
  _x.crossVectors(_y, _z).normalize();
  _z.crossVectors(_x, _y);
  _m.makeBasis(_x, _y, _z);
  _m.scale(_s.set(scale, scale, scale));
  _m.setPosition(_p.set(x, y, z));
  out.copy(_m);
}

export class PlantFactory {
  constructor(mats) {
    this.m = mats;
    this.geo = new Map();
    this.leafMats = new Map();
    this.textures = new Map();
    this.pebbleGeo = new THREE.IcosahedronGeometry(1, 1);
  }

  _geometry(name, low) {
    const key = name + (low ? ':lo' : '');
    if (!this.geo.has(key)) {
      const sp = SPECIES[name];
      this.geo.set(key, leafGeometry(low ? { ...sp.leaf, ...sp.lo } : sp.leaf));
    }
    return this.geo.get(key);
  }

  _material(name) {
    if (!this.leafMats.has(name)) {
      const sp = SPECIES[name];
      if (!this.textures.has(sp.tex)) this.textures.set(sp.tex, leafTexture(sp.tex));
      const map = this.textures.get(sp.tex);
      this.leafMats.set(name, new THREE.MeshStandardMaterial({ map, roughness: sp.rough, metalness: 0, side: THREE.DoubleSide, emissive: new THREE.Color('#355a22'), emissiveMap: map, emissiveIntensity: 0.1, alphaTest: sp.alphaTest ?? 0 }));
    }
    return this.leafMats.get(name);
  }

  _pot(style, r, h) {
    const pts = [[0, 0], [r * 0.72, 0], [r * 0.8, h * 0.04], [r * 0.97, h * 0.85], [r * 1.02, h * 0.98], [r * 1.02, h], [r * 0.94, h], [r * 0.9, h * 0.9]].map(([x, y]) => new THREE.Vector2(x, y));
    const mat = { concrete: this.m.concreteDark, ceramic: this.m.ceramicDark, white: this.m.ceramicWhite, terracotta: this.m.terracotta }[style] ?? this.m.concreteDark;
    const pot = new THREE.Mesh(new THREE.LatheGeometry(pts, 40), mat);
    pot.castShadow = true;
    pot.receiveShadow = true;
    return pot;
  }

  build(species, seed, { pot = 'concrete', potRadius = 0.32, potHeight = 0.6, scale = 1 } = {}) {
    const rand = rng(seed);
    const sp = SPECIES[species];
    const group = new THREE.Group();
    const base = potHeight * 0.88;
    group.add(this._pot(pot, potRadius, potHeight));

    const soil = new THREE.Mesh(new THREE.CircleGeometry(potRadius * 0.9, 28), this.m.soil);
    soil.rotation.x = -Math.PI / 2;
    soil.position.y = base;
    soil.receiveShadow = true;
    group.add(soil);

    const pebbles = new THREE.InstancedMesh(this.pebbleGeo, this.m.pebble, 26);
    const d = new THREE.Object3D();
    for (let i = 0; i < 26; i++) {
      const a = rand() * TAU;
      const rr = Math.sqrt(rand()) * potRadius * 0.8;
      const sz = 0.014 + rand() * 0.022;
      d.position.set(Math.cos(a) * rr, base + 0.004, Math.sin(a) * rr);
      d.scale.set(sz * 1.3, sz * 0.55, sz);
      d.rotation.y = rand() * TAU;
      d.updateMatrix();
      pebbles.setMatrixAt(i, d.matrix);
    }
    group.add(pebbles);

    const leaves = [];
    const trunkMat = this.m.bark;
    const addTrunk = (radius0, radius1, height, x, z, tiltX, tiltZ) => {
      const t = new THREE.Mesh(new THREE.CylinderGeometry(radius1, radius0, height, 8), trunkMat);
      t.position.set(x, base + height / 2, z);
      t.rotation.set(tiltX, 0, tiltZ);
      t.castShadow = true;
      group.add(t);
    };
    let height = 1;

    if (species === 'fig') {
      height = 1.7 + rand() * 0.35;
      const lean = (rand() - 0.5) * 0.18;
      const tilt = Math.atan2(lean, height);
      addTrunk(0.034, 0.014, height, lean / 2, 0, 0, -tilt);
      const n = 36 + Math.floor(rand() * 8);
      for (let i = 0; i < n; i++) {
        const f = i / (n - 1);
        const y = height * (0.36 + 0.64 * f);
        const yaw = i * 2.39996 + rand() * 0.35;
        const px = (y / height) * lean;
        leaves.push([px + Math.cos(yaw) * 0.025, base + y, Math.sin(yaw) * 0.025, yaw, 0.3 + f * 0.75 + rand() * 0.25, (rand() - 0.5) * 0.7, (1.1 - f * 0.45) * (0.88 + rand() * 0.24)]);
      }
      height += base + 0.45;
    } else if (species === 'strelitzia') {
      const n = 14;
      for (let i = 0; i < n; i++) {
        const a = rand() * TAU;
        leaves.push([Math.cos(a) * 0.07, base, Math.sin(a) * 0.07, a + (rand() - 0.5) * 0.6, 0.95 + rand() * 0.5, (rand() - 0.5) * 0.9, 0.78 + rand() * 0.4]);
      }
      height = base + 1.55;
    } else if (species === 'olive') {
      height = 1.35;
      const lean = [[0.06, 0.1], [-0.12, -0.04], [0.04, -0.14]];
      lean.forEach(([lx, lz], k) => addTrunk(0.034, 0.016, height - k * 0.12, lx * 0.5, lz * 0.5, lz * 1.1, -lx * 1.1));
      const cy = base + height + 0.3;
      for (let i = 0; i < 260; i++) {
        let vx, vy, vz;
        do { vx = rand() * 2 - 1; vy = rand() * 2 - 1; vz = rand() * 2 - 1; } while (vx * vx + vy * vy + vz * vz > 1);
        const rr = 0.55 + rand() * 0.45;
        const x = vx * 0.62 * rr;
        const y = cy + vy * 0.62 * rr;
        const z = vz * 0.62 * rr;
        leaves.push([x, y, z, Math.atan2(z, x) + (rand() - 0.5) * 1.2, vy * 0.9 + (rand() - 0.5) * 0.8, rand() * TAU, 0.8 + rand() * 0.45]);
      }
      height = cy + 0.6;
    } else if (species === 'monstera') {
      const n = 10;
      for (let i = 0; i < n; i++) {
        const a = rand() * TAU;
        leaves.push([Math.cos(a) * 0.06, base, Math.sin(a) * 0.06, a, 0.85 + rand() * 0.45, (rand() - 0.5) * 0.6, 0.78 + rand() * 0.4]);
      }
      height = base + 1.15;
    } else {
      const n = 18;
      for (let i = 0; i < n; i++) {
        const a = rand() * TAU;
        const rr = Math.sqrt(rand()) * potRadius * 0.55;
        leaves.push([Math.cos(a) * rr, base, Math.sin(a) * rr, a, 1.25 + rand() * 0.3, rand() * TAU, 0.7 + rand() * 0.55]);
      }
      height = base + 1.1;
    }

    const hi = new THREE.InstancedMesh(this._geometry(species, false), this._material(species), leaves.length);
    const lo = new THREE.InstancedMesh(this._geometry(species, true), this._material(species), leaves.length);
    const mat4 = new THREE.Matrix4();
    const col = new THREE.Color();
    leaves.forEach(([x, y, z, yaw, elev, roll, sc], i) => {
      leafMatrix(mat4, x, y, z, yaw, elev, roll, sc);
      hi.setMatrixAt(i, mat4);
      const l = 0.82 + rand() * 0.3;
      hi.setColorAt(i, col.setRGB(l * (1 + (rand() - 0.5) * 0.12), l * (1 + (rand() - 0.5) * 0.05), l * (1 - rand() * 0.16)));
    });
    lo.instanceMatrix = hi.instanceMatrix;
    lo.instanceColor = hi.instanceColor;
    for (const mesh of [hi, lo]) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    }
    const lod = new THREE.LOD();
    lod.addLevel(hi, 0);
    lod.addLevel(lo, 13);
    group.add(lod);

    group.rotation.y = rand() * TAU;
    group.scale.setScalar(scale * (0.95 + rand() * 0.1));
    return { group, radius: Math.max(potRadius, 0.45) * scale, height: height * scale };
  }
}
