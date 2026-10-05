import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { rng } from './textures.js';

const TAU = Math.PI * 2;
const TILE = 8;
const LOT = { x: 26, zMin: -26, zMax: 24 };
const ROAD = { x: 38, zMin: -38, zMax: 36 };
const WALK = { x: 44, zMin: -44, zMax: 42 };
const UNIT = new THREE.BoxGeometry(1, 1, 1);

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}

function repeatTexture(c, anisotropy = 4) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = anisotropy;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function scaleBoxUV(geometry, [w, h, d], tile) {
  const uv = geometry.attributes.uv;
  const faces = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) {
    for (let i = 0; i < 4; i++) {
      const k = f * 4 + i;
      uv.setXY(k, (uv.getX(k) * faces[f][0]) / tile, (uv.getY(k) * faces[f][1]) / tile);
    }
  }
}

// Flat shape with a rectangular hole, lying on y = 0 (shape y maps to world -z).
function ringGeometry([x0, z0, x1, z1], [hx0, hz0, hx1, hz1], tile) {
  const shape = new THREE.Shape();
  shape.moveTo(x0, -z0);
  shape.lineTo(x1, -z0);
  shape.lineTo(x1, -z1);
  shape.lineTo(x0, -z1);
  shape.closePath();
  const hole = new THREE.Path();
  hole.moveTo(hx0, -hz0);
  hole.lineTo(hx0, -hz1);
  hole.lineTo(hx1, -hz1);
  hole.lineTo(hx1, -hz0);
  hole.closePath();
  shape.holes.push(hole);
  const geometry = new THREE.ShapeGeometry(shape);
  const uv = geometry.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / tile, uv.getY(i) / tile);
  geometry.rotateX(-Math.PI / 2);
  return geometry;
}

/* ---------- procedural facades (one 256 px tile = 8 m x 8 m = 2 bays x 2 floors) ---------- */

function speckle(g, r, color, count, size = 2) {
  for (let i = 0; i < count; i++) {
    g.fillStyle = color;
    g.fillRect(r() * 256, r() * 256, 1 + r() * size, 1 + r() * size);
  }
}

function glassGradient(g, y, h, k) {
  const grad = g.createLinearGradient(0, y, 0, y + h);
  grad.addColorStop(0, `rgb(${150 + k * 30 | 0},${188 + k * 22 | 0},${218 + k * 14 | 0})`);
  grad.addColorStop(1, `rgb(${46 + k * 22 | 0},${80 + k * 22 | 0},${106 + k * 20 | 0})`);
  return grad;
}

function facadeCurtain() {
  const [c, g] = canvas(256, 256);
  const r = rng(11);
  g.fillStyle = '#cbc4b2';
  g.fillRect(0, 0, 256, 256);
  for (let fy = 0; fy < 2; fy++) {
    for (let bx = 0; bx < 2; bx++) {
      const x = bx * 128 + 4;
      const y = fy * 128 + 4;
      g.fillStyle = glassGradient(g, y, 96, r());
      g.fillRect(x, y, 120, 96);
      g.save();
      g.beginPath();
      g.rect(x, y, 120, 96);
      g.clip();
      g.fillStyle = 'rgba(255,255,255,0.11)';
      g.beginPath();
      g.moveTo(x + 24, y);
      g.lineTo(x + 58, y);
      g.lineTo(x + 20, y + 96);
      g.lineTo(x - 14, y + 96);
      g.fill();
      if (r() < 0.4) {
        g.fillStyle = 'rgba(236,229,212,0.6)';
        g.fillRect(x, y, 120, 18 + r() * 50);
      }
      g.restore();
      g.fillStyle = '#a3a9a7';
      g.fillRect(x, y + 100, 120, 24);
      g.fillStyle = 'rgba(0,0,0,0.14)';
      g.fillRect(x, y + 100, 120, 2);
    }
  }
  return c;
}

function facadeStone() {
  const [c, g] = canvas(256, 256);
  const r = rng(23);
  g.fillStyle = '#d9d1bf';
  g.fillRect(0, 0, 256, 256);
  speckle(g, r, 'rgba(120,108,90,0.07)', 700);
  speckle(g, r, 'rgba(255,255,255,0.08)', 500);
  for (let fy = 0; fy < 2; fy++) {
    g.fillStyle = '#c8bfab';
    g.fillRect(0, fy * 128, 256, 5);
    for (let bx = 0; bx < 2; bx++) {
      const x = bx * 128 + 30;
      const y = fy * 128 + 26;
      g.fillStyle = '#a89e8a';
      g.fillRect(x - 5, y - 5, 74, 94);
      g.fillStyle = glassGradient(g, y, 84, r());
      g.fillRect(x, y, 64, 84);
      g.fillStyle = '#d9d1bf';
      g.fillRect(x + 31, y, 3, 84);
      g.fillRect(x, y + 28, 64, 3);
      g.fillStyle = '#f0eadd';
      g.fillRect(x - 7, y + 84, 78, 6);
      g.fillStyle = 'rgba(0,0,0,0.16)';
      g.fillRect(x - 7, y + 90, 78, 4);
    }
  }
  return c;
}

function facadeRibbon() {
  const [c, g] = canvas(256, 256);
  const r = rng(37);
  g.fillStyle = '#bdbab2';
  g.fillRect(0, 0, 256, 256);
  speckle(g, r, 'rgba(70,68,62,0.07)', 800);
  for (let fy = 0; fy < 2; fy++) {
    const y = fy * 128 + 32;
    g.fillStyle = glassGradient(g, y, 64, r());
    g.fillRect(0, y, 256, 64);
    for (let x = 0; x < 256; x += 32) {
      g.fillStyle = '#2d3032';
      g.fillRect(x, y, 2, 64);
      if (r() < 0.35) {
        g.fillStyle = 'rgba(232,226,210,0.55)';
        g.fillRect(x + 2, y, 30, 12 + r() * 30);
      }
    }
    g.fillStyle = '#e1ddd0';
    g.fillRect(0, y - 5, 256, 5);
    g.fillStyle = '#a19e95';
    g.fillRect(0, fy * 128 + 120, 256, 8);
  }
  return c;
}

function facadeStorefront() {
  const [c, g] = canvas(256, 256);
  const r = rng(41);
  g.fillStyle = '#d3ccbb';
  g.fillRect(0, 0, 256, 256);
  g.fillStyle = '#9d9684';
  g.fillRect(0, 62, 256, 3);
  for (let bx = 0; bx < 2; bx++) {
    const x = bx * 128 + 6;
    const grad = g.createLinearGradient(0, 70, 0, 236);
    grad.addColorStop(0, '#a5bccd');
    grad.addColorStop(0.45, '#c9c2ae');
    grad.addColorStop(1, '#ecd09a');
    g.fillStyle = grad;
    g.fillRect(x, 70, 116, 166);
    for (let i = 0; i < 5; i++) {
      g.fillStyle = `rgba(255,235,190,${0.2 + r() * 0.3})`;
      g.fillRect(x + 8 + r() * 90, 150 + r() * 60, 8 + r() * 14, 20 + r() * 40);
    }
    g.fillStyle = 'rgba(255,255,255,0.12)';
    g.beginPath();
    g.moveTo(x + 20, 70);
    g.lineTo(x + 54, 70);
    g.lineTo(x + 18, 236);
    g.lineTo(x - 14, 236);
    g.fill();
  }
  g.fillStyle = '#2d3032';
  for (const x of [0, 126, 250]) g.fillRect(x, 66, 6, 170);
  g.fillStyle = '#6b6a66';
  g.fillRect(0, 236, 256, 20);
  g.fillStyle = '#2d3032';
  g.fillRect(24, 28, 80 + r() * 60, 6);
  return c;
}

function foliageCanvas(opaque) {
  const [c, g] = canvas(256, 256);
  const r = rng(opaque ? 53 : 59);
  const greens = ['#2f5524', '#3f6a2b', '#4f7d33', '#5e8f3b', '#6f9c45', '#27491f'];
  if (opaque) {
    g.fillStyle = '#2b4d21';
    g.fillRect(0, 0, 256, 256);
  }
  for (let i = 0; i < (opaque ? 520 : 340); i++) {
    const x = r() * 256;
    const y = r() * 256;
    const rot = r() * Math.PI;
    const size = 9 + r() * 12;
    g.fillStyle = greens[Math.floor(r() * greens.length)];
    g.globalAlpha = 0.92;
    g.beginPath();
    g.ellipse(x, y, size, size * 0.42, rot, 0, TAU);
    g.fill();
    g.globalAlpha = 0.25;
    g.strokeStyle = '#cfe7a0';
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(x - Math.cos(rot) * size, y - Math.sin(rot) * size);
    g.lineTo(x + Math.cos(rot) * size, y + Math.sin(rot) * size);
    g.stroke();
  }
  g.globalAlpha = 1;
  return c;
}

function blobTexture() {
  const [c, g] = canvas(64, 64);
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(0,0,0,0.5)');
  grad.addColorStop(0.6, 'rgba(0,0,0,0.2)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

/* ---------- stage 1: ground, plaza, road ---------- */

export function buildGround(s, root) {
  const m = s.m;
  const base = new THREE.Mesh(new THREE.PlaneGeometry(1200, 1200), new THREE.MeshStandardMaterial({ color: '#9a9c97', roughness: 0.95 }));
  base.rotation.x = -Math.PI / 2;
  base.position.y = -0.2;
  root.add(base);

  const roadW = ROAD.x * 2;
  const roadD = ROAD.zMax - ROAD.zMin;
  const asphaltGeo = new THREE.PlaneGeometry(roadW, roadD);
  const au = asphaltGeo.attributes.uv;
  for (let i = 0; i < au.count; i++) au.setXY(i, (au.getX(i) * roadW) / 5, (au.getY(i) * roadD) / 5);
  const asphalt = new THREE.Mesh(asphaltGeo, m.asphalt);
  asphalt.rotation.x = -Math.PI / 2;
  asphalt.position.set(0, -0.15, (ROAD.zMax + ROAD.zMin) / 2);
  asphalt.receiveShadow = true;
  root.add(asphalt);

  const walk = new THREE.Mesh(ringGeometry([-WALK.x, WALK.zMin, WALK.x, WALK.zMax], [-ROAD.x, ROAD.zMin, ROAD.x, ROAD.zMax], 3), m.sidewalk);
  walk.position.y = -0.02;
  walk.receiveShadow = true;
  root.add(walk);

  const plaza = new THREE.Mesh(ringGeometry([-LOT.x, LOT.zMin, LOT.x, LOT.zMax], [-15.9, -15.9, 15.9, 11.25], 12), m.paving);
  plaza.position.y = 0.004;
  plaza.receiveShadow = true;
  root.add(plaza);
}

/* ---------- stage 2: street furniture, landscaping and the surrounding district ---------- */

export function buildDistrict(s, g) {
  const m = s.m;
  const rand = rng(2024);
  buildStreet(s, g, m);
  buildLandscape(s, g, m, rand);
  buildBuildings(g, m);
}

function buildStreet(s, g, m) {
  const curb = [];
  const curbBox = (sx, sz, x, z, y) => curb.push([sx, 0.18, sz, x, y, z]);
  const lotDepth = LOT.zMax - LOT.zMin;
  const lotMid = (LOT.zMax + LOT.zMin) / 2;
  curbBox(0.3, lotDepth, -LOT.x, lotMid, -0.06);
  curbBox(0.3, lotDepth, LOT.x, lotMid, -0.06);
  curbBox(LOT.x * 2, 0.3, 0, LOT.zMin, -0.06);
  curbBox(LOT.x * 2, 0.3, 0, LOT.zMax, -0.06);
  const roadDepth = ROAD.zMax - ROAD.zMin;
  const roadMid = (ROAD.zMax + ROAD.zMin) / 2;
  curbBox(0.3, roadDepth, -ROAD.x, roadMid, -0.1);
  curbBox(0.3, roadDepth, ROAD.x, roadMid, -0.1);
  curbBox(ROAD.x * 2, 0.3, 0, ROAD.zMin, -0.1);
  curbBox(ROAD.x * 2, 0.3, 0, ROAD.zMax, -0.1);
  s.instancedBoxes(g, m.concrete, curb, { castShadow: false });

  const paint = new THREE.MeshStandardMaterial({ color: '#ecebe4', roughness: 0.7 });
  const marks = [];
  for (let x = -34; x <= 34; x += 7) {
    if (Math.abs(x) < 6) continue;
    marks.push([3.4, 0.012, 0.2, x, -0.144, 30]);
    marks.push([3.4, 0.012, 0.2, x, -0.144, -32]);
  }
  for (let z = -34; z <= 34; z += 7) {
    marks.push([0.2, 0.012, 3.4, -32, -0.144, z]);
    marks.push([0.2, 0.012, 3.4, 32, -0.144, z]);
  }
  for (let i = -4; i <= 4; i++) marks.push([0.55, 0.012, 11.6, i * 1.1, -0.144, 30]);
  s.instancedBoxes(g, paint, marks, { castShadow: false });

  // Street lamps on the lot edge; each arm reaches over the plaza.
  const lamps = [];
  for (let x = -20; x <= 20; x += 10) {
    lamps.push([x, 22.6, 0, -1]);
    lamps.push([x, -24.6, 0, 1]);
  }
  for (let z = -18; z <= 14; z += 8) {
    lamps.push([-24.6, z, 1, 0]);
    lamps.push([24.6, z, -1, 0]);
  }
  const d = new THREE.Object3D();
  const poleMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.07, 0.11, 7.2, 10), m.darkSteel, lamps.length);
  const armMesh = new THREE.InstancedMesh(UNIT, m.darkSteel, lamps.length);
  const headMesh = new THREE.InstancedMesh(UNIT, m.ledSoft, lamps.length);
  lamps.forEach(([x, z, dx, dz], i) => {
    const yaw = Math.atan2(dx, dz);
    d.rotation.set(0, 0, 0);
    d.scale.set(1, 1, 1);
    d.position.set(x, 3.6, z);
    d.updateMatrix();
    poleMesh.setMatrixAt(i, d.matrix);
    d.rotation.set(0, yaw, 0);
    d.scale.set(0.09, 0.09, 1.8);
    d.position.set(x + dx * 0.9, 7.1, z + dz * 0.9);
    d.updateMatrix();
    armMesh.setMatrixAt(i, d.matrix);
    d.scale.set(0.34, 0.07, 0.8);
    d.position.set(x + dx * 1.7, 7.02, z + dz * 1.7);
    d.updateMatrix();
    headMesh.setMatrixAt(i, d.matrix);
  });
  poleMesh.castShadow = true;
  g.add(poleMesh, armMesh, headMesh);

  const bollardCount = 17;
  const bollards = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.09, 0.09, 0.85, 14), m.steel, bollardCount);
  d.rotation.set(0, 0, 0);
  d.scale.set(1, 1, 1);
  for (let i = 0; i < bollardCount; i++) {
    d.position.set(-24 + i * 3, 0.43, 23.3);
    d.updateMatrix();
    bollards.setMatrixAt(i, d.matrix);
  }
  bollards.castShadow = true;
  g.add(bollards);

  for (const x of [-10, 10]) {
    const bench = new THREE.Group();
    bench.position.set(x, 0, 18.4);
    s.box(bench, [2.2, 0.08, 0.55], [0, 0.46, 0], m.wood);
    for (const lx of [-0.9, 0.9]) s.box(bench, [0.06, 0.44, 0.45], [lx, 0.22, 0], m.darkSteel);
    g.add(bench);
  }
}

function buildLandscape(s, g, m, rand) {
  const hedge = new THREE.MeshStandardMaterial({ map: repeatTexture(foliageCanvas(true), 4), roughness: 0.85 });
  hedge.userData.tile = 1.4;
  const hedges = [
    [[-15.2, 0.5, 13.1], [9.4, 1, 1.2]], [[15.2, 0.5, 13.1], [9.4, 1, 1.2]],
    [[-18.4, 0.5, -2.2], [1.2, 1, 25]], [[18.4, 0.5, -2.2], [1.2, 1, 25]],
    [[0, 0.5, -18.4], [29, 1, 1.2]],
  ];
  for (const [[x, y, z], size] of hedges) {
    s.box(g, size, [x, y, z], hedge);
    s.box(g, [size[0] + 0.5, 0.16, size[2] + 0.5], [x, 0.08, z], m.concrete, { castShadow: false });
  }

  // Planters framing the entrance, each with its own species and seed.
  const planters = [['olive', 41, -7.2, 15.2, 1.5], ['fig', 42, 7.2, 15.2, 1.45], ['olive', 43, -12.4, 15.8, 1.35], ['strelitzia', 44, 12.4, 15.8, 1.35]];
  for (const [species, seed, x, z, scale] of planters) {
    const { group } = s.plants.build(species, seed, { pot: 'concrete', potRadius: 0.62, potHeight: 0.8, scale });
    group.position.set(x, 0.004, z);
    g.add(group);
  }

  // Street trees: instanced trunks plus crossed foliage cards that share one geometry and one material.
  const spots = [];
  for (const x of [-15, -5, 5, 15]) spots.push([x, 21.4, 1]);
  for (const x of [-20, -8, 4, 16]) spots.push([x, -24.2, 0.95]);
  for (const z of [-14, -6, 2, 10, 18]) {
    spots.push([-23.2, z, 1]);
    spots.push([23.2, z, 0.95]);
  }
  for (let x = -40; x <= 40; x += 13) {
    spots.push([x, 40, 1.15]);
    spots.push([x + 5, -42, 1.1]);
  }
  for (let z = -38; z <= 36; z += 12) {
    spots.push([-41, z, 1.15]);
    spots.push([41, z + 3, 1.1]);
  }
  const perTree = 6;
  const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.13, 0.24, 1, 8), m.bark, spots.length);
  const foliageMat = new THREE.MeshStandardMaterial({ map: repeatTexture(foliageCanvas(false), 4), roughness: 0.75, side: THREE.DoubleSide, alphaTest: 0.35, alphaToCoverage: true });
  const foliage = new THREE.InstancedMesh(foliageCards(), foliageMat, spots.length * perTree);
  const d = new THREE.Object3D();
  const col = new THREE.Color();
  const blobs = [];
  spots.forEach(([x, z, k], i) => {
    const h = (3.4 + rand() * 1.6) * k;
    d.position.set(x, h / 2, z);
    d.rotation.set(0, rand() * TAU, 0);
    d.scale.set(k, h, k);
    d.updateMatrix();
    trunks.setMatrixAt(i, d.matrix);
    for (let j = 0; j < perTree; j++) {
      const a = rand() * TAU;
      const rr = j === 0 ? 0 : 0.9 + rand() * 0.9;
      const size = (2.4 + rand() * 1.2) * k;
      d.position.set(x + Math.cos(a) * rr * k, h + 0.5 + (j === 0 ? 1.2 : rand() * 1.7) * k, z + Math.sin(a) * rr * k);
      d.rotation.set(0, rand() * TAU, 0);
      d.scale.setScalar(size);
      d.updateMatrix();
      foliage.setMatrixAt(i * perTree + j, d.matrix);
      const l = 0.78 + rand() * 0.36;
      foliage.setColorAt(i * perTree + j, col.setRGB(l * (0.92 + rand() * 0.16), l, l * (0.82 + rand() * 0.2)));
    }
    blobs.push([x, z, 5.6 * k]);
  });
  trunks.castShadow = true;
  g.add(trunks, foliage);

  const shadowGeos = blobs.map(([x, z, size]) => {
    const geo = new THREE.PlaneGeometry(size, size);
    geo.rotateX(-Math.PI / 2);
    geo.translate(x, 0.012, z);
    return geo;
  });
  g.add(new THREE.Mesh(mergeGeometries(shadowGeos), new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, opacity: 0.55, depthWrite: false })));
}

// Three crossed quads with outward-facing normals so clusters shade like soft blobs.
function foliageCards() {
  const a = new THREE.PlaneGeometry(1, 1);
  const b = new THREE.PlaneGeometry(1, 1);
  b.rotateY(Math.PI / 2);
  const c = new THREE.PlaneGeometry(1, 1);
  c.rotateX(Math.PI / 2);
  c.rotateY(0.6);
  const geo = mergeGeometries([a, b, c]);
  const n = geo.attributes.normal;
  const p = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < n.count; i++) {
    v.set(p.getX(i), p.getY(i) + 0.15, p.getZ(i)).normalize();
    n.setXYZ(i, v.x, v.y, v.z);
  }
  return geo;
}

/* ---------- buildings: detailed near the showroom, simple boxes further out, merged per side and material ---------- */

function buildBuildings(g, m) {
  const facades = {
    curtain: new THREE.MeshStandardMaterial({ map: repeatTexture(facadeCurtain()), roughness: 0.2, metalness: 0.35, envMapIntensity: 1.4 }),
    stone: new THREE.MeshStandardMaterial({ map: repeatTexture(facadeStone()), roughness: 0.85, metalness: 0 }),
    ribbon: new THREE.MeshStandardMaterial({ map: repeatTexture(facadeRibbon()), roughness: 0.55, metalness: 0.1, envMapIntensity: 1.1 }),
  };
  const shop = new THREE.MeshStandardMaterial({ map: repeatTexture(facadeStorefront()), roughness: 0.3, metalness: 0.2, envMapIntensity: 1.2 });
  const kinds = ['curtain', 'stone', 'ribbon'];
  const buckets = new Map();
  const add = (side, material, geometry) => {
    const key = `${side}|${material.uuid}`;
    if (!buckets.has(key)) buckets.set(key, { material, geometries: [] });
    buckets.get(key).geometries.push(geometry);
  };
  const box = (size, [x, y, z], tile = TILE) => {
    const geo = new THREE.BoxGeometry(...size);
    scaleBoxUV(geo, size, tile);
    geo.translate(x, y, z);
    return geo;
  };

  const NORMAL = { E: [-1, 0], W: [1, 0], N: [0, 1], S: [0, -1] };
  const centre = (side, mid, depth, gap) => {
    if (side === 'E') return [WALK.x + gap + depth / 2, mid];
    if (side === 'W') return [-(WALK.x + gap + depth / 2), mid];
    if (side === 'S') return [mid, WALK.zMax + gap + depth / 2];
    return [mid, WALK.zMin - gap - depth / 2];
  };
  // Boxes expressed in the building frame: u along the facade, t towards the showroom, y height.
  const feature = (side, c, along, depth, h, u, t, y, material, tile = 1) => {
    const [nx, nz] = NORMAL[side];
    const alongX = nx === 0;
    const size = alongX ? [along, h, depth] : [depth, h, along];
    const pos = [c[0] + nx * t + (alongX ? u : 0), y, c[1] + nz * t + (alongX ? 0 : u)];
    add(side, material, box(size, pos, tile));
  };

  const row = (side, from, to, near, seed) => {
    const r = rng(seed);
    const horizontal = side === 'E' || side === 'W';
    let cursor = from;
    for (;;) {
      const w = [16, 24, 32][Math.floor(r() * 3)];
      if (cursor + w > to) break;
      const depth = near ? 18 : 22;
      const floors = near ? 5 + Math.floor(r() * 6) : 10 + Math.floor(r() * 8);
      const h = floors * 4 + 8;
      const kind = kinds[Math.floor(r() * kinds.length)];
      const c = centre(side, cursor + w / 2, depth, near ? 0 : 36);
      const size = horizontal ? [depth, w] : [w, depth];
      cursor += w + (near ? 3 : 5);
      if (!near) {
        add(side, facades[kind], box([size[0], h, size[1]], [c[0], h / 2, c[1]]));
        continue;
      }
      add(side, shop, box([size[0], 8, size[1]], [c[0], 4, c[1]]));
      add(side, facades[kind], box([size[0] - 1.2, h - 8, size[1] - 1.2], [c[0], 8 + (h - 8) / 2, c[1]]));
      add(side, m.concrete, box([size[0], 0.5, size[1]], [c[0], h + 0.25, c[1]], 2.4));
      for (let i = 0; i < 2; i++) {
        const ox = (r() - 0.5) * (size[0] - 6);
        const oz = (r() - 0.5) * (size[1] - 6);
        add(side, m.concrete, box([3 + r() * 3, 2 + r() * 1.5, 3 + r() * 3], [c[0] + ox, h + 1.5, c[1] + oz], 2.4));
      }
      feature(side, c, w + 0.6, 2.6, 0.3, 0, depth / 2 + 0.5, 8.15, m.brass);
      if (kind === 'curtain') {
        for (let u = -w / 2 + 2; u <= w / 2 - 1; u += 4) feature(side, c, 0.18, 0.6, h - 9, u, depth / 2 - 0.3, 8.6 + (h - 9) / 2, m.brass);
      } else if (kind === 'stone') {
        for (let floor = 2; floor < floors; floor += 2) {
          const y = 8 + floor * 4 - 0.1;
          for (let u = -w / 2 + 4; u < w / 2; u += 8) {
            feature(side, c, 6.4, 1.3, 0.16, u, depth / 2 - 0.05, y, m.brass);
            feature(side, c, 6.4, 0.04, 1.05, u, depth / 2 + 0.65, y + 0.6, m.glass);
          }
        }
      }
    }
  };

  // Near row (high detail) hugs the outer sidewalk; the second row (simplified) sits behind an alley.
  row('E', -62, 60, true, 301);
  row('W', -62, 60, true, 302);
  row('N', -44, 44, true, 303);
  row('S', -44, 44, true, 304);
  row('E', -100, 100, false, 311);
  row('W', -100, 100, false, 312);
  row('N', -80, 80, false, 313);
  row('S', -80, 80, false, 314);

  // Far skyline: plain boxes in a ring, enough to read as a district through the haze.
  const far = rng(777);
  for (let i = 0; i < 44; i++) {
    const a = (i / 44) * TAU + far() * 0.1;
    const radius = 175 + far() * 50;
    const w = 20 + far() * 16;
    const h = 56 + far() * 70;
    const geo = box([w, h, w], [0, h / 2, 0]);
    geo.rotateY(-a);
    geo.translate(Math.cos(a) * radius, 0, -4 + Math.sin(a) * radius);
    add('F', facades[kinds[i % 3]], geo);
  }

  for (const { material, geometries } of buckets.values()) {
    const mesh = new THREE.Mesh(mergeGeometries(geometries), material);
    g.add(mesh);
  }
}
