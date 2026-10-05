import * as THREE from 'three';
import { gsap } from 'gsap';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { rng } from './textures.js';
import { TextureLibrary } from './texture-library.js';
import { createMaterials } from './materials.js';
import { PlantFactory } from './plants.js';
import { buildDistrict, buildGround } from './district.js';

const DESTINATIONS = {
  home: { label: 'CENTER · WELCOME', position: [0, 2.35, 4.7], target: [0, 2, -1.4], waypoints: [[0, 2.35, 14.2], [0, 2.35, 10], [0, 2.35, 7], [0, 2.35, 4.7]], screenClass: 'screen-home' },
  inventory: { label: 'LEFT WING · INVENTORY', position: [-5.3, 2.35, 1.7], target: [-8, 2.1, -3.1], waypoints: [[0, 2.35, 4.7], [-3.1, 2.35, 3.1], [-5.3, 2.35, 1.7]], screenClass: 'screen-left' },
  brands: { label: 'RIGHT WING · BRANDS', position: [5.3, 2.35, 1.7], target: [8, 2.1, -3.1], waypoints: [[0, 2.35, 4.7], [3.1, 2.35, 3.1], [5.3, 2.35, 1.7]], screenClass: 'screen-right' },
  services: { label: 'BACK LEFT · SERVICES', position: [-5.2, 2.4, -7.2], target: [-9, 2.25, -12.4], waypoints: [[0, 2.35, 4.7], [-4.2, 2.35, 2.8], [-6, 2.4, -2.8], [-5.2, 2.4, -7.2]], screenClass: 'screen-back-left' },
  about: { label: 'BACK RIGHT · ABOUT US', position: [5.2, 2.4, -7.2], target: [9, 2.25, -12.4], waypoints: [[0, 2.35, 4.7], [4.2, 2.35, 2.8], [6, 2.4, -2.8], [5.2, 2.4, -7.2]], screenClass: 'screen-back-right' },
  contact: { label: 'FRONT RIGHT · RECEPTION', position: [4.4, 2.3, 3.1], target: [8.4, 1.8, 8.3], waypoints: [[0, 2.35, 4.7], [2.4, 2.3, 4.2], [4.4, 2.3, 3.1]], screenClass: 'screen-front' },
};

const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);
export const SUN_DIRECTION = new THREE.Vector3(-24, 21, 10).normalize();
const wait = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
const CENTER_Z = -4.15;

function scaleBoxUV(geometry, [w, h, d], tile, ox, oy) {
  const uv = geometry.attributes.uv;
  const faces = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) {
    for (let i = 0; i < 4; i++) {
      const k = f * 4 + i;
      uv.setXY(k, (uv.getX(k) * faces[f][0]) / tile + ox, (uv.getY(k) * faces[f][1]) / tile + oy);
    }
  }
}

function scaleUV(geometry, su, sv) {
  const uv = geometry.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
}

function canvasTexture(canvas, anisotropy = 8) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = anisotropy;
  return t;
}

export class Showroom {
  constructor(canvas) {
    this.canvas = canvas;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#bcd0e6');
    this.scene.fog = new THREE.FogExp2('#c9d7e6', 0.0036);
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 400);
    this.camera.position.set(0, 2.5, 20);
    this.lookTarget = new THREE.Vector3(0, 2, -1.4);
    this.camera.lookAt(this.lookTarget);
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.maxPixelRatio = Math.min(devicePixelRatio, 1.5);
    this.pixelRatio = this.maxPixelRatio;
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 0.68;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    // The room is static, so shadow maps are re-rendered only when content is added.
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.shadowMap.needsUpdate = true;
    RectAreaLightUniformsLib.init();

    this.currentDestination = 'entrance';
    this.transitioning = false;
    this.entering = false;
    this.dirty = true;
    this.shadowDirty = true;
    this.lastShadow = 0;
    this.motion = null;
    this.cameraRadius = 0.38;
    this.cameraColliders = [];
    this.lastSafeCameraPosition = this.camera.position.clone();
    this._camBox = new THREE.Box3();
    this._lo = new THREE.Vector3();
    this._hi = new THREE.Vector3();
    this._startLook = new THREE.Vector3();
    this._endLook = new THREE.Vector3();
    this.timings = {};
    this.interiorReady = new Promise((resolve) => { this._resolveInterior = resolve; });
    this.rand = rng(20240603);
    this.root = new THREE.Group();
    this.scene.add(this.root);
    this.contactMats = new Map();
    this.roundedGeo = new Map();
    this.frameTimes = { average: 16, last: performance.now(), checked: performance.now() };

    this.lib = new TextureLibrary(this.renderer);
    this.m = createMaterials(this.lib);
    this.plants = new PlantFactory(this.m);

    // Stage 1: everything needed for the entrance (lighting, shell, glass, doors, central feature).
    const t0 = performance.now();
    this.buildLighting();
    this.buildSky();
    this.buildEnvironmentMap();
    this.buildShell();
    this.registerCameraColliders();
    this.lib.onChange = () => this.requestRender();
    this.createResizeHandling();
    this.timings.stage1 = Math.round(performance.now() - t0);
    this.tick = () => this.renderFrame();
    gsap.ticker.add(this.tick);
    // Compile shaders without blocking, then stream the rest in while the doors open.
    this.ready = this.start();
  }

  async start() {
    try {
      await this.renderer.compileAsync(this.scene, this.camera);
    } catch (error) {
      console.warn('Shader precompile skipped', error);
    }
    this.requestRender();
    this.stagesReady = this.runStages();
    return true;
  }

  requestRender() {
    this.dirty = true;
  }

  /* ---------- helpers ---------- */

  box(parent, size, position, material, options = {}) {
    const geometry = new THREE.BoxGeometry(...size);
    const tile = material.userData.tile;
    if (tile) scaleBoxUV(geometry, size, tile, this.rand(), this.rand());
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(...position);
    mesh.castShadow = options.castShadow ?? true;
    mesh.receiveShadow = options.receiveShadow ?? true;
    parent.add(mesh);
    return mesh;
  }

  rbox(parent, size, radius, position, material, options = {}) {
    const key = `${size.join(',')}:${radius}`;
    if (!this.roundedGeo.has(key)) this.roundedGeo.set(key, new RoundedBoxGeometry(size[0], size[1], size[2], 3, radius));
    const mesh = new THREE.Mesh(this.roundedGeo.get(key), material);
    mesh.position.set(...position);
    if (options.rotation) mesh.rotation.set(...options.rotation);
    mesh.castShadow = options.castShadow ?? true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  instancedBoxes(parent, material, items, { castShadow = true } = {}) {
    const mesh = new THREE.InstancedMesh(UNIT_BOX, material, items.length);
    const d = new THREE.Object3D();
    items.forEach(([sx, sy, sz, x, y, z], i) => {
      d.position.set(x, y, z);
      d.scale.set(sx, sy, sz);
      d.updateMatrix();
      mesh.setMatrixAt(i, d.matrix);
    });
    mesh.castShadow = castShadow;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  lathe(parent, profile, material, position, scale = 1) {
    const mesh = new THREE.Mesh(new THREE.LatheGeometry(profile.map(([x, y]) => new THREE.Vector2(x * scale, y * scale)), 40), material);
    mesh.position.set(...position);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  contact(parent, x, z, w, d, { opacity = 0.45, round = false, rotation = 0 } = {}) {
    if (!this.contactTex) {
      const radial = document.createElement('canvas');
      radial.width = radial.height = 128;
      const rg = radial.getContext('2d');
      const grad = rg.createRadialGradient(64, 64, 0, 64, 64, 64);
      grad.addColorStop(0, 'rgba(0,0,0,0.85)');
      grad.addColorStop(0.55, 'rgba(0,0,0,0.35)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      rg.fillStyle = grad;
      rg.fillRect(0, 0, 128, 128);
      const soft = document.createElement('canvas');
      soft.width = soft.height = 128;
      const sg = soft.getContext('2d');
      sg.filter = 'blur(12px)';
      sg.fillStyle = 'rgba(0,0,0,0.9)';
      sg.fillRect(30, 30, 68, 68);
      this.contactTex = { round: new THREE.CanvasTexture(radial), box: new THREE.CanvasTexture(soft) };
    }
    const key = `${round}:${opacity}`;
    if (!this.contactMats.has(key)) {
      this.contactMats.set(key, new THREE.MeshBasicMaterial({ map: round ? this.contactTex.round : this.contactTex.box, transparent: true, opacity, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    }
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, d), this.contactMats.get(key));
    mesh.rotation.set(-Math.PI / 2, 0, rotation);
    mesh.position.set(x, 0.004, z);
    parent.add(mesh);
  }

  wallWash(parent, position, rotationY, w, h, opacity = 0.3) {
    if (!this.washTex) {
      const c = document.createElement('canvas');
      c.width = 64;
      c.height = 256;
      const g = c.getContext('2d');
      const grad = g.createLinearGradient(0, 0, 0, 256);
      grad.addColorStop(0, 'rgba(255,255,255,0.9)');
      grad.addColorStop(0.5, 'rgba(255,255,255,0.25)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, 64, 256);
      this.washTex = new THREE.CanvasTexture(c);
      this.washMat = new THREE.MeshBasicMaterial({ map: this.washTex, color: '#ffc98a', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    }
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), this.washMat.clone());
    mesh.material.opacity = opacity;
    mesh.position.set(...position);
    mesh.rotation.y = rotationY;
    parent.add(mesh);
  }

  screenCanvas(title, lines, aspect, small = 'ATELIER MOTORS  /  STUTTGART') {
    const w = 1536;
    const h = Math.round(w / aspect);
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d');
    const bg = g.createLinearGradient(0, 0, w, h);
    bg.addColorStop(0, '#2a2e30');
    bg.addColorStop(1, '#171a1c');
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
    const s = w / 768;
    g.fillStyle = '#d4b97e';
    g.fillRect(52 * s, 55 * s, 62 * s, 3 * s);
    g.font = `600 ${20 * s}px Manrope, sans-serif`;
    g.fillText(small, 132 * s, 62 * s);
    g.fillStyle = '#ffffff';
    g.font = `700 ${70 * s}px Manrope, sans-serif`;
    g.fillText(title, 52 * s, 154 * s);
    g.strokeStyle = 'rgba(255,255,255,.35)';
    g.lineWidth = 1.5 * s;
    g.beginPath();
    g.moveTo(52 * s, 190 * s);
    g.lineTo(w - 52 * s, 190 * s);
    g.stroke();
    lines.forEach((line, i) => {
      const y = (246 + i * 54) * s;
      g.fillStyle = '#d4b97e';
      g.fillRect(54 * s, y - 14 * s, 11 * s, 11 * s);
      g.fillStyle = '#ffffff';
      let size = 36 * s;
      g.font = `600 ${size}px Manrope, sans-serif`;
      const maxWidth = w - 84 * s - 52 * s;
      const width = g.measureText(line).width;
      if (width > maxWidth) {
        size *= maxWidth / width;
        g.font = `600 ${size}px Manrope, sans-serif`;
      }
      g.fillText(line, 84 * s, y);
    });
    g.fillStyle = '#d4b97e';
    g.fillRect(52 * s, h - 40 * s, w - 104 * s, 2 * s);
    return c;
  }

  brandCanvas(text, sub, aspect) {
    const w = 1536;
    const h = Math.round(w / aspect);
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d');
    const bg = g.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, '#2a2e30');
    bg.addColorStop(0.5, '#171a1c');
    bg.addColorStop(1, '#25292b');
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = '#ffffff';
    g.font = `700 ${h * 0.2}px Manrope, sans-serif`;
    g.fillText(text, w / 2, h * 0.46);
    g.fillStyle = '#d4b97e';
    g.font = `600 ${h * 0.07}px Manrope, sans-serif`;
    g.fillText(sub, w / 2, h * 0.68);
    g.fillRect(w * 0.3, h * 0.28, w * 0.4, Math.max(2, h * 0.006));
    g.fillRect(w * 0.3, h * 0.8, w * 0.4, Math.max(2, h * 0.006));
    return c;
  }

  screenMaterial(canvas, intensity = 0.95, mirror = false) {
    const tex = canvasTexture(canvas, Math.min(16, this.renderer.capabilities.getMaxAnisotropy()));
    if (mirror) {
      tex.repeat.x = -1;
      tex.offset.x = 1;
    }
    return new THREE.MeshPhysicalMaterial({ color: '#050606', roughness: 0.32, metalness: 0, emissive: '#ffffff', emissiveMap: tex, emissiveIntensity: intensity * 0.6, clearcoat: 0.3, clearcoatRoughness: 0.15 });
  }

  digitalPanel(parent, position, rotationY, w, h, title, lines) {
    const panel = new THREE.Group();
    panel.position.set(...position);
    panel.rotation.y = rotationY;
    this.box(panel, [w + 0.24, h + 0.24, 0.14], [0, 0, -0.07], this.m.darkSteel);
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(w, h), this.screenMaterial(this.screenCanvas(title, lines, w / h)));
    screen.position.z = 0.004;
    panel.add(screen);
    this.box(panel, [w * 0.7, 0.03, 0.03], [0, -h / 2 - 0.2, 0.02], this.m.ledWarm, { castShadow: false });
    parent.add(panel);
    return panel;
  }

  sign(parent, text, position, width, height = 0.52) {
    const frame = this.box(parent, [width, height, 0.05], position, this.m.darkSteel, { castShadow: false });
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(width - 0.06, height - 0.06), this.screenMaterial(this.brandCanvas(text, '', (width - 0.06) / (height - 0.06)), 0.9));
    plate.position.set(position[0], position[1], position[2] + 0.028);
    parent.add(plate);
    return frame;
  }

  async commit(group) {
    try {
      await this.renderer.compileAsync(group, this.camera, this.scene);
    } catch (error) {
      console.warn('Shader precompile skipped', error);
    }
    this.root.add(group);
    this.shadowDirty = true;
    this.requestRender();
  }

  /* ---------- stage 1: lighting, environment, shell ---------- */

  buildLighting() {
    const scene = this.scene;
    scene.add(new THREE.HemisphereLight('#e6eefa', '#cfcac2', 0.28));

    // Daylight from the upper left; the ceiling casts shadows so sun only enters through the glass.
    const sun = new THREE.DirectionalLight('#fff0dc', 2.6);
    sun.position.copy(SUN_DIRECTION).multiplyScalar(60).add(new THREE.Vector3(0, 0, -3));
    sun.target.position.set(0, 0, -3);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -30, right: 30, top: 26, bottom: -26, near: 5, far: 130 });
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.04;
    scene.add(sun, sun.target);

    const spot = (color, intensity, pos, target, angle, penumbra, shadow = false) => {
      const l = new THREE.SpotLight(color, intensity, 0, angle, penumbra, 2);
      l.position.set(...pos);
      l.target.position.set(...target);
      if (shadow) {
        l.castShadow = true;
        l.shadow.mapSize.set(1024, 1024);
        l.shadow.bias = -0.0003;
        l.shadow.normalBias = 0.02;
      }
      scene.add(l, l.target);
    };
    spot('#ffe3bd', 160, [0, 8.5, CENTER_Z + 0.25], [0, 0.9, CENTER_Z], Math.PI / 6, 0.65, true);
    spot('#ffdcb0', 70, [-8.6, 6.9, -5.45], [-14.8, 2.9, -5.45], 0.55, 0.7);
    spot('#ffdcb0', 70, [8.6, 6.9, -5.45], [14.8, 2.9, -5.45], 0.55, 0.7);
    spot('#ffe0b8', 60, [-8.2, 8.4, -10], [-8.2, 2.6, -14.8], 0.6, 0.7);
    spot('#ffe0b8', 60, [8.2, 8.4, -10], [8.2, 2.6, -14.8], 0.6, 0.7);
    spot('#ffe0b8', 70, [8.4, 8.4, 5.2], [8.4, 1.2, 8.6], 0.6, 0.7);
    spot('#fff0d6', 70, [0, 8.3, 9.6], [0, 0.2, 11.6], 0.9, 0.8);

    const rect = (color, intensity, w, h, pos, look) => {
      const l = new THREE.RectAreaLight(color, intensity, w, h);
      l.position.set(...pos);
      l.lookAt(...look);
      scene.add(l);
    };
    rect('#e4eeff', 1.6, 24, 6.5, [-15.3, 4.4, -3], [0, 3, -3]);
    rect('#fff0dc', 0.45, 12, 20, [0, 8.6, -3], [0, 0, -3]);
  }

  // Procedural HDR-style environment for PMREM: the same daylight sky, a bright sun, a warm ceiling, a pale floor and a city ring.
  buildEnvironmentMap() {
    const env = new THREE.Scene();
    const stage = new THREE.Group();
    stage.position.y = -3;
    env.add(stage);
    const basic = (r, g, b, side = THREE.DoubleSide) => new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(r, g, b), side });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(300, 32, 16), new THREE.MeshBasicMaterial({ map: this.skyTexture, color: new THREE.Color().setRGB(1.35, 1.35, 1.4), side: THREE.BackSide }));
    sky.rotation.y = 0;
    env.add(sky);
    const plane = (w, h, x, y, z, rx, ry, mat) => {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
      p.position.set(x, y, z);
      p.rotation.set(rx, ry, 0);
      stage.add(p);
    };
    plane(400, 400, 0, 0, -3, -Math.PI / 2, 0, basic(0.5, 0.47, 0.42));
    plane(32, 34, 0, 8.7, -3, Math.PI / 2, 0, basic(0.8, 0.76, 0.7));
    const warm = basic(7, 5.2, 3.2);
    for (const x of [-10, -6, -2, 2, 6, 10]) plane(0.9, 22, x, 8.6, -3, Math.PI / 2, 0, warm);
    const sun = new THREE.Mesh(new THREE.CircleGeometry(14, 24), basic(60, 52, 40));
    sun.position.copy(SUN_DIRECTION).multiplyScalar(250);
    sun.lookAt(0, 0, 0);
    env.add(sun);
    const city = basic(0.3, 0.34, 0.4, THREE.FrontSide);
    const rand = rng(909);
    for (let i = 0; i < 28; i++) {
      const a = (i / 28) * Math.PI * 2;
      const d = 58 + rand() * 24;
      const h = 22 + rand() * 40;
      const b = new THREE.Mesh(new THREE.BoxGeometry(14 + rand() * 12, h, 14 + rand() * 12), city);
      b.position.set(Math.cos(a) * d, h / 2 - 3, Math.sin(a) * d);
      b.rotation.y = -a;
      env.add(b);
    }
    const generator = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = generator.fromScene(env, 0.02, 0.1, 600).texture;
    this.scene.environmentIntensity = 0.75;
    generator.dispose();
    env.traverse((o) => {
      o.geometry?.dispose();
      o.material?.dispose();
    });
  }

  buildSky() {
    const W = 1024;
    const H = 512;
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, '#4a7dc0');
    grad.addColorStop(0.3, '#7ba5d8');
    grad.addColorStop(0.44, '#bcd5ec');
    grad.addColorStop(0.495, '#e9e5d9');
    grad.addColorStop(0.5, '#d6d1c4');
    grad.addColorStop(0.52, '#9b9c97');
    grad.addColorStop(1, '#6f7170');
    g.fillStyle = grad;
    g.fillRect(0, 0, W, H);
    const sx = ((Math.atan2(SUN_DIRECTION.z, -SUN_DIRECTION.x) / (Math.PI * 2)) + 1) % 1 * W;
    const sy = (Math.acos(SUN_DIRECTION.y) / Math.PI) * H;
    const glow = g.createRadialGradient(sx, sy, 0, sx, sy, 150);
    glow.addColorStop(0, 'rgba(255,248,230,1)');
    glow.addColorStop(0.08, 'rgba(255,240,205,0.85)');
    glow.addColorStop(0.35, 'rgba(255,232,190,0.22)');
    glow.addColorStop(1, 'rgba(255,232,190,0)');
    g.fillStyle = glow;
    g.fillRect(0, 0, W, H);
    const r = rng(5);
    g.filter = 'blur(9px)';
    for (let i = 0; i < 52; i++) {
      g.fillStyle = `rgba(255,255,255,${0.1 + r() * 0.22})`;
      g.beginPath();
      g.ellipse(r() * W, H * (0.16 + r() * 0.3), 30 + r() * 80, 5 + r() * 12, 0, 0, Math.PI * 2);
      g.fill();
    }
    g.filter = 'none';
    this.skyTexture = canvasTexture(c, 4);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(220, 48, 24), new THREE.MeshBasicMaterial({ map: this.skyTexture, side: THREE.BackSide, fog: false, depthWrite: false }));
    dome.renderOrder = -10;
    this.scene.add(dome);
  }

  buildShell() {
    const m = this.m;
    const root = this.root;

    const floorGeo = new THREE.PlaneGeometry(32, 27);
    scaleUV(floorGeo, 32 / 11, 27 / 11);
    const floor = new THREE.Mesh(floorGeo, m.floor);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, 0, -2.25);
    floor.receiveShadow = true;
    root.add(floor);

    buildGround(this, root);

    // Low stone plinths under the floor-to-ceiling glass.
    this.box(root, [32, 0.72, 0.5], [0, 0.36, -16], m.concreteDark, { castShadow: false });
    for (const x of [-16, 16]) this.box(root, [0.5, 0.72, 34], [x, 0.36, -3], m.concreteDark, { castShadow: false });
    for (const s of [-1, 1]) this.box(root, [10.7, 0.72, 0.4], [s * 10.45, 0.36, 11.2], m.concreteDark, { castShadow: false });

    const H = 8.05;
    const cy = 0.72 + H / 2;
    const glass = [];
    const frame = [];
    for (const x of [-15.72, 15.72]) {
      for (let k = 0; k < 5; k++) glass.push([0.06, H, 4.86, x, cy, -12.5 + k * 5]);
      for (let k = 0; k < 6; k++) frame.push([0.16, H, 0.14, x, cy, -15 + k * 5]);
      for (const y of [0.78, 7.3, 8.72]) frame.push([0.16, 0.1, 25.1, x, y, -2.5]);
    }
    for (let k = 0; k < 8; k++) glass.push([3.86, H, 0.06, -14 + k * 4, cy, -15.72]);
    for (let k = 0; k < 9; k++) frame.push([0.14, H, 0.16, -16 + k * 4, cy, -15.75]);
    for (const y of [0.78, 7.3, 8.72]) frame.push([32, 0.1, 0.14, 0, y, -15.75]);
    for (const s of [-1, 1]) {
      for (const x of [5.15, 10.3, 15.45]) frame.push([0.14, H, 0.16, s * x, cy, 11.2]);
      for (const x of [7.72, 12.88]) glass.push([5.0, H, 0.06, s * x, cy, 11.2]);
      for (const y of [0.78, 7.3, 8.72]) frame.push([10.4, 0.1, 0.14, s * 10.4, y, 11.2]);
    }
    this.instancedBoxes(root, m.glass, glass, { castShadow: false });
    this.instancedBoxes(root, m.darkSteel, frame);

    this.buildEntrance(root);
    this.buildCeiling(root);
    this.buildColumns(root);
    this.buildCentralFeature(root);
  }

  buildEntrance(root) {
    const m = this.m;
    const z = 11.2;
    this.box(root, [6.8, 0.26, 0.66], [0, 6.52, z], m.steel);
    for (const x of [-1.8, 1.8]) {
      this.box(root, [0.18, 6.35, 0.38], [x, 3.2, z], m.steel);
      this.box(root, [0.7, 0.13, 0.7], [x, 0.065, z], m.darkstone);
    }
    for (const x of [-3.45, 3.45]) {
      this.box(root, [3.3, 6.1, 0.05], [x, 3.12, z], m.glass, { castShadow: false });
      for (const y of [0.07, 6.17]) this.box(root, [3.3, 0.1, 0.1], [x, y, z], m.darkSteel);
    }
    this.box(root, [10.3, 2.15, 0.3], [0, 7.72, z + 0.15], m.board);
    this.sign(root, 'ATELIER MOTORS', [0, 7.6, z + 0.33], 4.6, 0.58);
    this.box(root, [3.6, 0.02, 0.5], [0, 0.01, z + 0.2], m.steel, { castShadow: false });

    this.doors = [];
    for (const side of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(0, 0, z + 0.22);
      const part = (size, pos, mat) => this.box(pivot, size, pos, mat, { castShadow: false });
      part([1.62, 6.1, 0.05], [side * 0.81, 3.1, 0], m.doorGlass);
      for (const y of [0.06, 6.14]) part([1.62, 0.12, 0.08], [side * 0.81, y, 0], m.darkSteel);
      for (const edge of [0, side * 1.62]) part([0.05, 6.2, 0.09], [edge, 3.1, 0], m.darkSteel);
      for (const dz of [-0.07, 0.07]) part([0.04, 1.3, 0.05], [side * 0.15, 1.15, dz], m.steel);
      root.add(pivot);
      this.doors.push({ pivot, side });
    }
  }

  buildCeiling(root) {
    const m = this.m;
    this.box(root, [32, 0.45, 34], [0, 9, -3], m.ceiling, { castShadow: true });
    const beams = [];
    for (let x = -12; x <= 12; x += 4) beams.push([0.15, 0.22, 28, x, 8.62, -3]);
    for (const z of [-13, -7, -1, 5]) beams.push([29, 0.14, 0.16, 0, 8.66, z]);
    this.instancedBoxes(root, m.concrete, beams, { castShadow: false });
    const strips = [-10, -6, -2, 2, 6, 10].map((x) => [0.1, 0.04, 24, x, 8.752, -3]);
    this.instancedBoxes(root, m.ledSoft, strips, { castShadow: false });

    const spots = [];
    for (const x of [-10, -6, -2, 2, 6, 10]) {
      for (const z of [-12, -8, 0, 4, 8]) spots.push([x, z]);
    }
    const downlights = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.09, 0.09, 0.03, 20), m.ledWarm, spots.length);
    const trims = new THREE.InstancedMesh(new THREE.TorusGeometry(0.1, 0.012, 6, 20), m.steel, spots.length);
    const d = new THREE.Object3D();
    spots.forEach(([x, z], i) => {
      d.position.set(x + 0.9, 8.755, z);
      d.rotation.set(0, 0, 0);
      d.updateMatrix();
      downlights.setMatrixAt(i, d.matrix);
      d.rotation.set(Math.PI / 2, 0, 0);
      d.position.y = 8.745;
      d.updateMatrix();
      trims.setMatrixAt(i, d.matrix);
    });
    root.add(downlights, trims);

    for (const [radius, tube] of [[4.3, 0.04], [3.65, 0.025]]) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, tube, 10, 144), m.ledWarm);
      ring.rotation.x = Math.PI / 2;
      ring.position.set(0, 8.28, CENTER_Z);
      ring.scale.set(1.22, 1, 1);
      root.add(ring);
    }
  }

  buildColumns(root) {
    const m = this.m;
    const positions = [-12.9, 12.9].flatMap((x) => [-10.5, -2.6, 5.8].map((z) => [x, z]));
    const parts = [
      [new THREE.CylinderGeometry(0.34, 0.43, 8.2, 28), m.column, 4.12],
      [new THREE.CylinderGeometry(0.68, 0.72, 0.38, 32), m.darkstone, 0.19],
      [new THREE.CylinderGeometry(0.52, 0.42, 0.3, 32), m.column, 8.26],
    ];
    const d = new THREE.Object3D();
    for (const [geometry, material, y] of parts) {
      const mesh = new THREE.InstancedMesh(geometry, material, positions.length);
      positions.forEach(([x, z], i) => {
        d.position.set(x, y, z);
        d.updateMatrix();
        mesh.setMatrixAt(i, d.matrix);
      });
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      root.add(mesh);
    }
    for (const [x, z] of positions) this.contact(root, x, z, 1.9, 1.9, { round: true, opacity: 0.4 });
  }

  buildCentralFeature(root) {
    const m = this.m;
    const island = new THREE.Group();
    island.position.set(0, 0, CENTER_Z);

    for (const [radius, tube] of [[4.45, 0.014], [3.92, 0.008], [2.9, 0.006]]) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, tube, 6, 160), m.brass);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.004;
      island.add(ring);
    }
    this.contact(island, 0, 0, 5.6, 5.6, { round: true, opacity: 0.3 });

    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.065, 0.92, 14), m.brass);
      post.position.set(Math.cos(a) * 1.96, 0.46, Math.sin(a) * 1.96);
      post.castShadow = true;
      island.add(post);
      const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 0.035, 24), m.brass);
      foot.position.set(Math.cos(a) * 1.96, 0.018, Math.sin(a) * 1.96);
      island.add(foot);
    }
    const counter = new THREE.Mesh(new THREE.TorusGeometry(1.92, 0.14, 20, 120), m.counter);
    counter.rotation.x = Math.PI / 2;
    counter.position.y = 0.96;
    counter.castShadow = true;
    counter.receiveShadow = true;
    island.add(counter);
    const edge = new THREE.Mesh(new THREE.TorusGeometry(1.92, 0.018, 8, 120), m.brass);
    edge.rotation.x = Math.PI / 2;
    edge.position.y = 1.105;
    island.add(edge);
    const underglow = new THREE.Mesh(new THREE.TorusGeometry(1.92, 0.02, 8, 120), m.ledWarm);
    underglow.rotation.x = Math.PI / 2;
    underglow.position.y = 0.82;
    island.add(underglow);

    const column = new THREE.Group();
    column.position.y = 0.28;
    const support = new THREE.Mesh(new THREE.CylinderGeometry(0.68, 0.76, 1.75, 96), m.steel);
    support.position.y = 1.15;
    support.castShadow = true;
    support.receiveShadow = true;
    column.add(support);
    this.box(column, [2.75, 1.52, 0.16], [0, 1.72, 0.68], m.darkSteel);
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(2.58, 1.35), this.screenMaterial(this.brandCanvas('WELCOME', 'INFORMATION  ·  APPOINTMENTS  ·  ENQUIRIES', 2.58 / 1.35), 1));
    screen.position.set(0, 1.72, 0.77);
    column.add(screen);
    island.add(column);
    root.add(island);
  }

  registerCameraColliders() {
    const add = (name, min, max, dynamic = false) => {
      this.cameraColliders.push({ name, bounds: new THREE.Box3(new THREE.Vector3(...min), new THREE.Vector3(...max)), dynamic });
    };
    add('west perimeter wall', [-16.35, 0, -20], [-15.25, 9.4, 15]);
    add('east perimeter wall', [15.25, 0, -20], [16.35, 9.4, 15]);
    add('rear perimeter wall', [-16.4, 0, -16.55], [16.4, 9.4, -15.35]);
    add('ceiling', [-16.2, 8.75, -20], [16.2, 9.45, 15]);
    add('left front glass', [-16.35, 0, 11.05], [-5.12, 9.4, 11.4]);
    add('right front glass', [5.12, 0, 11.05], [16.35, 9.4, 11.4]);
    add('entrance fascia', [-5.1, 6.2, 11.0], [5.1, 9.4, 11.6]);
    add('left entrance jamb', [-1.98, 0, 10.83], [-1.62, 6.8, 11.62]);
    add('right entrance jamb', [1.62, 0, 10.83], [1.98, 6.8, 11.62]);
    add('left entrance sidelight', [-5.12, 0, 11.12], [-1.98, 5.95, 11.3]);
    add('right entrance sidelight', [1.98, 0, 11.12], [5.12, 5.95, 11.3]);
    add('reception desk', [6.0, 0, 5.75], [10.8, 1.55, 8.45]);
    add('reception back wall', [5.4, 0, 9.5], [11.4, 4.6, 10.1]);
    add('reception chair left', [4.45, 0, 5.8], [5.55, 1.65, 6.9]);
    add('reception chair right', [11.25, 0, 5.8], [12.35, 1.65, 6.9]);
    add('left lounge seating', [-12.35, 0, 0.72], [-8.45, 1.82, 2.3]);
    add('right lounge seating', [8.45, 0, 0.72], [12.35, 1.82, 2.3]);
    add('left coffee table', [-11.4, 0, -1.75], [-9.4, 1.24, -0.24]);
    add('right coffee table', [9.4, 0, -1.75], [11.4, 1.24, -0.24]);
    add('rear digital brand display', [-4.2, 3.35, -15.35], [4.2, 6.65, -14.75]);
    add('central information island', [-2.4, 0, -6.6], [2.4, 3.25, -1.7]);
    add('left curved gallery wall', [-15.25, 0, -8.05], [-13.4, 5.7, -2.85]);
    add('right curved gallery wall', [13.4, 0, -8.05], [15.25, 5.7, -2.85]);
    add('rear gallery staircase', [-5.2, 0, -15.3], [1.4, 3.0, -13.6]);
    add('services digital screen', [-11, 1.75, -14.95], [-5.5, 5.05, -14.35]);
    add('about digital screen', [5.5, 1.75, -14.95], [11, 5.05, -14.35]);
    for (const x of [-12.9, 12.9]) {
      for (const z of [-10.5, -2.6, 5.8]) add('architectural column', [x - 0.52, 0, z - 0.52], [x + 0.52, 8.45, z + 0.52]);
    }
    for (const [x, z] of this.plantSpots()) add('planter', [x - 0.55, 0, z - 0.55], [x + 0.55, 2.8, z + 0.55]);
  }

  plantSpots() {
    return [[-12.5, 8.2], [12.5, 8.2], [-13.35, -8.1], [13.35, -8.1], [-13.45, 3.7], [13.45, 3.7], [-3.7, 9.8], [3.7, 9.8], [-14.0, -13.8], [14.0, -13.8]];
  }

  /* ---------- stage 2/3 orchestration ---------- */

  async runStages() {
    await wait(30);
    const build = async (name, job) => {
      const t = performance.now();
      try {
        const group = new THREE.Group();
        group.name = name;
        job(group);
        await this.commit(group);
      } catch (error) {
        console.error(`Showroom stage (${name}) failed`, error);
      }
      this.timings[name] = Math.round(performance.now() - t);
      await wait(4);
    };
    // Geometry visible from the entrance is committed first; the entrance camera waits for it (with a cap).
    const interior = [
      ['wings', (g) => this.buildWings(g)],
      ['panels', (g) => this.buildPanels(g)],
      ['reception', (g) => this.buildReception(g)],
      ['lounge', (g) => this.buildLounge(g)],
      ['stair', (g) => this.buildStair(g)],
      ['plants', (g) => this.buildPlants(g)],
      ['district', (g) => buildDistrict(this, g)],
    ];
    let done = 0;
    for (const [name, job] of interior) {
      await build(name, job);
      done += 1;
      this.onLoadProgress?.('Furnishing the interior...', 10 + Math.round((done / interior.length) * 50));
    }
    this._resolveInterior();
    this.onStage?.(2);

    await build('decor', (g) => this.buildDecor(g));
    this.onLoadProgress?.('Refining materials...', 66);

    // Full-size textures are generated in workers and swapped in as they arrive.
    const t = performance.now();
    await this.lib.upgrade();
    this.timings.textures = Math.round(performance.now() - t);
    this.onLoadProgress?.('Preparing the lighting...', 90);
    await this.prewarm();
    this.onLoadProgress?.('Ready', 100);
    this.onStage?.(3);
  }

  // Uploads every texture and renders the shadows once so the entrance never pays first-use costs.
  async prewarm() {
    this.scene.traverse((object) => {
      for (const material of object.material ? [].concat(object.material) : []) {
        for (const value of Object.values(material)) if (value?.isTexture) this.renderer.initTexture(value);
      }
    });
    this.renderer.shadowMap.needsUpdate = true;
    this.shadowDirty = false;
    this.renderer.render(this.scene, this.camera);
    this.renderer.getContext().finish();
    await wait(30);
  }

  /* ---------- stage 2 ---------- */

  buildWings(g) {
    const m = this.m;
    const shellMat = m.board.clone();
    shellMat.side = THREE.BackSide;
    const brassBack = m.brass.clone();
    brassBack.side = THREE.BackSide;
    const ledBack = m.ledWarm.clone();
    ledBack.side = THREE.BackSide;
    for (const side of [-1, 1]) {
      const wing = new THREE.Group();
      wing.position.set(side * 11.9, 0, -5.45);
      wing.rotation.y = side < 0 ? Math.PI : 0;
      const R = 3;
      const H = 5.6;
      const shellGeo = new THREE.CylinderGeometry(R, R, H, 72, 1, true, Math.PI * 0.2, Math.PI * 0.6);
      scaleUV(shellGeo, (R * Math.PI * 0.6) / 2.2, H / 2.2);
      const shell = new THREE.Mesh(shellGeo, shellMat);
      shell.position.y = H / 2;
      shell.receiveShadow = true;
      shell.castShadow = true;
      wing.add(shell);

      const Rs = 2.95;
      const arc = 1.559;
      const start = Math.PI / 2 - arc / 2;
      const title = side < 0 ? 'INVENTORY' : 'BRANDS';
      const lines = side < 0 ? ['THE COLLECTION', 'Performance · Touring · Electric', 'Photography and specifications'] : ['BMW     MERCEDES-BENZ', 'PORSCHE     AUDI', 'RANGE ROVER     FERRARI'];
      const screenMat = this.screenMaterial(this.screenCanvas(title, lines, (Rs * arc) / 2.5), 0.95, true);
      screenMat.side = THREE.BackSide;
      const screen = new THREE.Mesh(new THREE.CylinderGeometry(Rs, Rs, 2.5, 72, 1, true, start, arc), screenMat);
      screen.position.y = 3.1;
      wing.add(screen);
      for (const [y, h, mat] of [[4.38, 0.06, brassBack], [1.82, 0.06, brassBack], [1.74, 0.03, ledBack]]) {
        const band = new THREE.Mesh(new THREE.CylinderGeometry(Rs - 0.005, Rs - 0.005, h, 72, 1, true, start, arc), mat);
        band.position.y = y;
        wing.add(band);
      }
      g.add(wing);
    }

    for (const s of [-1, 1]) {
      for (const z of [-11.2, 1.2, 7.1]) {
        this.box(g, [0.14, 4.4, 4.4], [s * 15.36, 2.6, z], m.board);
        if (z === 7.1) continue;
        this.box(g, [0.12, 4.2, 4.1], [s * 15.2, 2.5, z], m.wood);
        this.instancedBoxes(g, m.steel, [-1.5, -0.5, 0.5, 1.5].map((f) => [0.04, 4.1, 0.05, s * 15.12, 2.5, z + f]));
        this.box(g, [0.38, 0.07, 4.0], [s * 14.95, 1.1, z], m.counter);
        this.box(g, [0.04, 0.025, 3.7], [s * 15.04, 1.05, z], m.ledWarm, { castShadow: false });
        this.box(g, [0.05, 0.03, 3.8], [s * 15.1, 4.55, z], m.ledSoft, { castShadow: false });
      }
    }
  }

  buildPanels(g) {
    const m = this.m;
    this.box(g, [7.9, 2.9, 0.2], [0, 5.05, -15.2], m.darkSteel);
    const brand = new THREE.Mesh(new THREE.PlaneGeometry(7.5, 2.5), this.screenMaterial(this.brandCanvas('ATELIER MOTORS', 'PRIVATE AUTOMOTIVE HOUSE  ·  EST. 1988  ·  STUTTGART', 7.5 / 2.5), 1));
    brand.position.set(0, 5.05, -15.09);
    g.add(brand);
    this.box(g, [5.8, 0.035, 0.035], [0, 3.45, -15.0], m.ledWarm, { castShadow: false });
    for (const x of [-10.5, -5.4, 5.4, 10.5]) this.box(g, [4.5, 2.9, 0.12], [x, 4.5, -15.4], m.board);

    this.digitalPanel(g, [-8.25, 3.4, -14.72], 0, 5.2, 2.75, 'SERVICES', ['Vehicle sales and trade-in', 'Financing · Inspection', 'Maintenance · After-sales']);
    this.digitalPanel(g, [8.25, 3.4, -14.72], 0, 5.2, 2.75, 'OUR STORY', ['Independent by nature · Since 1988', 'A considered collection', 'A personal welcome in Stuttgart']);
    this.digitalPanel(g, [8.4, 2.95, 9.66], Math.PI, 4.35, 1.95, 'CONTACT', ['WhatsApp · +49 (0)00 0000 0000', 'hello@example.com · Mon–Sat 09:00–19:00']);
  }

  buildReception(g) {
    const m = this.m;
    this.box(g, [5.8, 4.4, 0.3], [8.4, 2.2, 9.85], m.board);
    this.box(g, [5.5, 0.04, 0.05], [8.4, 4.45, 9.6], m.ledSoft, { castShadow: false });

    const desk = new THREE.Group();
    desk.position.set(8.4, 0, 8.35);
    desk.rotation.y = Math.PI / 2;
    const front = new THREE.Mesh(new THREE.CylinderGeometry(2.18, 2.35, 1.08, 72, 1, false, Math.PI * 0.12, Math.PI * 0.76), m.wood);
    scaleUV(front.geometry, 2, 1);
    front.position.y = 0.62;
    front.castShadow = true;
    front.receiveShadow = true;
    desk.add(front);
    const top = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.4, 0.13, 80, 1, false, Math.PI * 0.12, Math.PI * 0.76), m.counter);
    top.position.y = 1.22;
    top.castShadow = true;
    top.receiveShadow = true;
    desk.add(top);
    const inlay = new THREE.Mesh(new THREE.CylinderGeometry(2.37, 2.37, 0.03, 80, 1, true, Math.PI * 0.12, Math.PI * 0.76), m.brass);
    inlay.position.y = 1.13;
    desk.add(inlay);
    const kick = new THREE.Mesh(new THREE.CylinderGeometry(2.36, 2.36, 0.03, 80, 1, true, Math.PI * 0.12, Math.PI * 0.76), m.ledWarm);
    kick.position.y = 0.1;
    desk.add(kick);
    g.add(desk);
    this.contact(g, 8.4, 7.2, 5.4, 3.8, { opacity: 0.35 });

    for (const [x, rot] of [[5.0, -0.45], [11.8, 0.45]]) {
      const chair = new THREE.Group();
      chair.position.set(x, 0, 6.35);
      chair.rotation.y = rot;
      this.rbox(chair, [0.9, 0.2, 0.86], 0.07, [0, 0.55, 0], m.leather);
      this.rbox(chair, [0.9, 0.9, 0.16], 0.07, [0, 1.02, -0.38], m.leather, { rotation: [-0.1, 0, 0] });
      for (const lx of [-0.36, 0.36]) {
        for (const lz of [-0.3, 0.3]) this.box(chair, [0.045, 0.52, 0.045], [lx, 0.26, lz], m.brass);
      }
      g.add(chair);
      this.contact(g, x, 6.35, 1.4, 1.4, { opacity: 0.4 });
    }
  }

  buildLounge(g) {
    const m = this.m;
    const sofaGeo = (parent, mat) => {
      this.rbox(parent, [3.2, 0.3, 0.95], 0.06, [0, 0.33, 0], mat);
      this.rbox(parent, [3.2, 0.66, 0.22], 0.08, [0, 0.8, -0.37], mat);
      for (const ax of [-1.5, 1.5]) this.rbox(parent, [0.2, 0.62, 0.95], 0.07, [ax, 0.62, 0], mat);
      for (const cx of [-0.98, 0, 0.98]) {
        this.rbox(parent, [0.96, 0.2, 0.82], 0.08, [cx, 0.56, 0.06], mat);
        this.rbox(parent, [0.96, 0.5, 0.2], 0.09, [cx, 0.92, -0.22], mat, { rotation: [-0.14, 0, 0] });
      }
      for (const fx of [-1.45, 1.45]) {
        for (const fz of [-0.38, 0.38]) this.box(parent, [0.05, 0.14, 0.05], [fx, 0.07, fz], m.brass);
      }
    };
    [[-10.4, m.leather, m.fabric], [10.4, m.leatherCognac, m.fabric]].forEach(([x, leather]) => {
      const rugEdge = new THREE.Mesh(new THREE.PlaneGeometry(4.5, 4.1), m.rugEdge);
      scaleUV(rugEdge.geometry, 4.5 / 0.5, 4.1 / 0.5);
      rugEdge.rotation.x = -Math.PI / 2;
      rugEdge.position.set(x, 0.006, 0.2);
      rugEdge.receiveShadow = true;
      g.add(rugEdge);
      const rug = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 3.8), m.rug);
      scaleUV(rug.geometry, 4.2 / 0.5, 3.8 / 0.5);
      rug.rotation.x = -Math.PI / 2;
      rug.position.set(x, 0.012, 0.2);
      rug.receiveShadow = true;
      g.add(rug);

      const sofa = new THREE.Group();
      sofa.position.set(x, 0.012, 1.5);
      sofa.rotation.y = Math.PI;
      sofaGeo(sofa, leather);
      g.add(sofa);
      this.contact(g, x, 1.5, 3.8, 1.5, { opacity: 0.5 });

      const table = new THREE.Group();
      table.position.set(x, 0.012, -1);
      this.box(table, [2.0, 0.06, 1.1], [0, 0.63, 0], m.counter);
      this.box(table, [1.8, 0.03, 0.9], [0, 0.22, 0], m.smoked, { castShadow: false });
      for (const lx of [-0.9, 0.9]) {
        for (const lz of [-0.48, 0.48]) this.box(table, [0.035, 0.6, 0.035], [lx, 0.3, lz], m.brass);
      }
      g.add(table);
      this.contact(g, x, -1, 2.6, 1.8, { opacity: 0.4 });

      const lampX = x < 0 ? -12.55 : 12.55;
      const lamp = new THREE.Group();
      lamp.position.set(lampX, 0, 0.4);
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.19, 0.025, 28), m.brass);
      base.position.y = 0.0125;
      lamp.add(base);
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1.55, 10), m.brass);
      stem.position.y = 0.8;
      lamp.add(stem);
      const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.27, 0.34, 28, 1, true), m.lampShade);
      shade.position.y = 1.62;
      lamp.add(shade);
      g.add(lamp);
      this.glow(g, lampX, 0.4, 2.2, '#ffc98a', 0.22);
    });
  }

  glow(parent, x, z, size, color, opacity) {
    if (!this.glowTex) {
      const c = document.createElement('canvas');
      c.width = c.height = 128;
      const ctx = c.getContext('2d');
      const grad = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
      grad.addColorStop(0, 'rgba(255,255,255,1)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 128, 128);
      this.glowTex = new THREE.CanvasTexture(c);
    }
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshBasicMaterial({ map: this.glowTex, color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false }));
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, 0.008, z);
    parent.add(mesh);
  }

  buildStair(g) {
    const m = this.m;
    const zc = -14.6;
    for (let i = 0; i < 10; i++) {
      const top = 0.25 * (i + 1);
      this.box(g, [0.5, 0.07, 1.3], [-4.9 + i * 0.5, top - 0.035, zc], m.wood);
    }
    this.box(g, [1.6, 0.1, 1.3], [0.55, 2.45, zc], m.wood);
    const slope = Math.atan2(2.5, 5);
    for (const dz of [-0.66, 0.66]) {
      const stringer = this.box(g, [5.6, 0.2, 0.05], [-2.65, 1.1, zc + dz], m.darkSteel);
      stringer.rotation.z = slope;
    }
    const glass = this.box(g, [5.6, 0.95, 0.025], [-2.65, 1.72, zc + 0.66], m.glass, { castShadow: false });
    glass.rotation.z = slope;
    const rail = this.box(g, [5.6, 0.05, 0.05], [-2.65, 2.2, zc + 0.66], m.brass);
    rail.rotation.z = slope;
    this.box(g, [1.6, 0.95, 0.025], [0.55, 2.98, zc + 0.66], m.glass, { castShadow: false });
    this.box(g, [1.6, 0.05, 0.05], [0.55, 3.46, zc + 0.66], m.brass);
    this.contact(g, -2.2, zc, 6.4, 2.0, { opacity: 0.3 });
  }

  buildPlants(g) {
    const defs = [
      ['fig', 11, { pot: 'concrete', potRadius: 0.36, potHeight: 0.62, scale: 1.12 }],
      ['olive', 12, { pot: 'white', potRadius: 0.4, potHeight: 0.55, scale: 1 }],
      ['strelitzia', 13, { pot: 'ceramic', potRadius: 0.38, potHeight: 0.6, scale: 1 }],
      ['fig', 14, { pot: 'ceramic', potRadius: 0.34, potHeight: 0.6, scale: 1.05 }],
      ['monstera', 15, { pot: 'terracotta', potRadius: 0.3, potHeight: 0.5, scale: 1 }],
      ['snake', 16, { pot: 'white', potRadius: 0.28, potHeight: 0.45, scale: 1 }],
      ['fig', 17, { pot: 'concrete', potRadius: 0.36, potHeight: 0.62, scale: 1.2 }],
      ['strelitzia', 18, { pot: 'concrete', potRadius: 0.38, potHeight: 0.6, scale: 1.1 }],
      ['olive', 19, { pot: 'concrete', potRadius: 0.42, potHeight: 0.58, scale: 1.05 }],
      ['monstera', 20, { pot: 'ceramic', potRadius: 0.32, potHeight: 0.52, scale: 1.1 }],
    ];
    this.plantSpots().forEach(([x, z], i) => {
      const [species, seed, options] = defs[i];
      const { group } = this.plants.build(species, seed, options);
      group.position.set(x, 0, z);
      g.add(group);
      this.contact(g, x, z, 1.5, 1.5, { round: true, opacity: 0.5 });
    });
  }

  /* ---------- stage 3 ---------- */

  paintArt(seed, palette) {
    const c = document.createElement('canvas');
    c.width = 768;
    c.height = 512;
    const g = c.getContext('2d');
    const r = rng(seed);
    g.fillStyle = palette[0];
    g.fillRect(0, 0, 768, 512);
    g.filter = 'blur(10px)';
    for (let i = 0; i < 6; i++) {
      g.fillStyle = palette[1 + Math.floor(r() * (palette.length - 1))];
      g.globalAlpha = 0.55 + r() * 0.4;
      g.fillRect(r() * 520 - 40, r() * 330 - 30, 140 + r() * 420, 90 + r() * 260);
    }
    g.filter = 'none';
    g.globalAlpha = 1;
    for (let i = 0; i < 900; i++) {
      g.fillStyle = r() < 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.06)';
      g.fillRect(r() * 768, r() * 512, 1 + r() * 14, 1 + r() * 2);
    }
    return c;
  }

  placeBooks(parent, [x, y, z], rotationY, specs) {
    const mat = this.bookMat ?? (this.bookMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.7, metalness: 0 }));
    const mesh = new THREE.InstancedMesh(UNIT_BOX, mat, specs.length);
    const d = new THREE.Object3D();
    const c = new THREE.Color();
    let level = y;
    specs.forEach(([w, h, depth, color], i) => {
      d.position.set(x, level + h / 2, z);
      d.rotation.set(0, rotationY + (this.rand() - 0.5) * 0.18, 0);
      d.scale.set(w, h, depth);
      d.updateMatrix();
      mesh.setMatrixAt(i, d.matrix);
      mesh.setColorAt(i, c.set(color));
      level += h;
    });
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
  }

  buildDecor(g) {
    const m = this.m;

    // Sculptures on stone plinths.
    for (const [x, kind] of [[-8, 'knot'], [8, 'monolith']]) {
      this.box(g, [0.55, 1.05, 0.55], [x, 0.525, -1.7], m.darkstone);
      if (kind === 'knot') {
        const knot = new THREE.Mesh(new THREE.TorusKnotGeometry(0.22, 0.065, 180, 18, 2, 3), m.brass);
        knot.position.set(x, 1.42, -1.7);
        knot.rotation.set(0.3, 0.6, 0);
        knot.castShadow = true;
        g.add(knot);
      } else {
        const profile = [[0, 0], [0.16, 0], [0.2, 0.18], [0.12, 0.55], [0.07, 0.8], [0.05, 0.92], [0, 0.94]];
        this.lathe(g, profile, m.ceramicWhite, [x, 1.05, -1.7], 1.0);
      }
      this.contact(g, x, -1.7, 1.2, 1.2, { round: true, opacity: 0.45 });
    }

    // Artwork on the entrance-side wall panels.
    const palettes = [['#2b2a28', '#c0a37a', '#6b7f86', '#e6dccb', '#8a4b36'], ['#202426', '#9aa6a4', '#d6c6a4', '#41585f', '#b8744a']];
    [[-1, 71], [1, 72]].forEach(([s, seed], i) => {
      const x = s * 15.24;
      this.box(g, [0.06, 2.34, 3.34], [x, 2.7, 7.1], m.darkSteel);
      const mat = new THREE.MeshStandardMaterial({ map: canvasTexture(this.paintArt(seed, palettes[i]), 8), roughness: 0.72, metalness: 0 });
      const art = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 2.2), mat);
      art.position.set(x - s * 0.035, 2.7, 7.1);
      art.rotation.y = -s * Math.PI / 2;
      g.add(art);
      this.box(g, [0.1, 0.04, 1.3], [x - s * 0.08, 4.02, 7.1], m.brass);
      this.box(g, [0.06, 0.012, 1.15], [x - s * 0.1, 3.99, 7.1], m.ledWarm, { castShadow: false });
      this.wallWash(g, [s * 15.19, 3.0, 7.1], -s * Math.PI / 2, 3.8, 2.2, 0.16);
    });
    for (const s of [-1, 1]) {
      for (const z of [-11.2, 1.2]) this.wallWash(g, [s * 15.12, 3.2, z], -s * Math.PI / 2, 3.9, 3.6, 0.28);
    }

    // Shelf styling.
    const shelf = (s, z, seed) => {
      const r = rng(seed);
      const x = s * 14.95;
      const colors = ['#2b3a3f', '#8a6a4a', '#d9d1bf', '#4b2f2a', '#59634a', '#b9a47a'];
      const specs = [];
      for (let i = 0; i < 4; i++) specs.push([0.2 + r() * 0.1, 0.035 + r() * 0.03, 0.26, colors[Math.floor(r() * colors.length)]]);
      this.placeBooks(g, [x, 1.135, z - 1.2], s * Math.PI / 2, specs);
      const vase = [[0, 0], [0.07, 0], [0.09, 0.08], [0.05, 0.22], [0.035, 0.3], [0.05, 0.34]];
      this.lathe(g, vase, seed % 2 ? m.ceramicWhite : m.ceramicDark, [x, 1.135, z + 0.2], 1);
      const bowl = [[0, 0], [0.06, 0.005], [0.14, 0.06], [0.15, 0.075], [0.13, 0.07], [0.05, 0.02]];
      this.lathe(g, bowl, m.brass, [x, 1.135, z + 1.1], 1);
    };
    shelf(-1, -11.2, 1);
    shelf(1, -11.2, 2);
    shelf(-1, 1.2, 3);
    shelf(1, 1.2, 4);

    // Coffee-table styling.
    [[-10.4, 21], [10.4, 22]].forEach(([x, seed]) => {
      this.placeBooks(g, [x - 0.55, 0.69, -0.85], 0.3, [[0.36, 0.045, 0.28, '#d9d1bf'], [0.32, 0.04, 0.25, '#2b3a3f'], [0.28, 0.035, 0.22, '#8a6a4a']]);
      const bowl = [[0, 0], [0.07, 0.005], [0.17, 0.07], [0.18, 0.09], [0.16, 0.085], [0.06, 0.02]];
      this.lathe(g, bowl, m.ceramicWhite, [x + 0.55, 0.69, -0.75], 1);
      const { group } = this.plants.build('snake', seed, { pot: 'white', potRadius: 0.09, potHeight: 0.14, scale: 0.22 });
      group.position.set(x + 0.05, 0.69, -1.15);
      g.add(group);
    });

    // Reception accessories (desk-local arc maps to world x = 8.4 + z, z = 8.35 - x).
    this.placeBooks(g, [7.7, 1.285, 6.45], 0.2, [[0.3, 0.025, 0.22, '#2b2a28'], [0.28, 0.02, 0.2, '#b9a47a']]);
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.035, 0.1, 20), m.brass);
    cup.position.set(8.9, 1.335, 6.5);
    cup.castShadow = true;
    g.add(cup);
    const bell = new THREE.Mesh(new THREE.SphereGeometry(0.045, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), m.brass);
    bell.position.set(8.15, 1.285, 6.6);
    g.add(bell);
    const { group: deskPlant } = this.plants.build('monstera', 31, { pot: 'ceramic', potRadius: 0.1, potHeight: 0.16, scale: 0.28 });
    deskPlant.position.set(9.35, 1.285, 6.7);
    g.add(deskPlant);
  }

  /* ---------- camera, navigation, collisions ---------- */

  cameraCollisionAt(position) {
    if (position.y < 0.85 || position.y > 8.3) return { name: position.y < 0.85 ? 'floor clearance' : 'ceiling clearance' };
    const r = this.cameraRadius;
    const box = this._camBox.set(this._lo.set(position.x - r, position.y - r, position.z - r), this._hi.set(position.x + r, position.y + r, position.z + r));
    for (const collider of this.cameraColliders) {
      if (collider.bounds.intersectsBox(box)) return collider;
    }
    return null;
  }

  // Samples a path and reports the first collider it touches.
  pathHit(samples) {
    for (const point of samples) {
      const hit = this.cameraCollisionAt(point);
      if (hit) return { safe: false, obstacle: hit.name, point: point.toArray() };
    }
    return { safe: true };
  }

  // Builds a smooth, collision-checked curve through the points; falls back to straight segments if the curve clips something.
  buildPath(points) {
    const vectors = [];
    for (const p of points) {
      const v = new THREE.Vector3(...p);
      if (!vectors.length || vectors[vectors.length - 1].distanceTo(v) > 0.05) vectors.push(v);
    }
    if (vectors.length < 2) return { empty: true, length: 0 };
    let length = 0;
    for (let i = 1; i < vectors.length; i++) length += vectors[i].distanceTo(vectors[i - 1]);
    const line = () => {
      const path = new THREE.CurvePath();
      for (let i = 1; i < vectors.length; i++) path.add(new THREE.LineCurve3(vectors[i - 1], vectors[i]));
      return path;
    };
    const candidates = vectors.length > 2 ? [new THREE.CatmullRomCurve3(vectors, false, 'centripetal'), line()] : [line()];
    let blocked = null;
    for (const curve of candidates) {
      const check = this.pathHit(curve.getSpacedPoints(Math.ceil(length / 0.15)));
      if (check.safe) return { curve, length };
      blocked = check;
    }
    return { blocked, length };
  }

  validateCameraPath(points) {
    const built = this.buildPath(points);
    return built.blocked ?? { safe: true };
  }

  // Glides along a pre-validated curve with a single tween; no allocations or collision work per frame.
  followCameraPath(points, targetPosition, duration, onComplete, onProgress, ease = 'sine.inOut') {
    this.motion?.kill();
    this.motion = null;
    const built = this.buildPath(points);
    if (built.empty) {
      onComplete?.(true);
      return null;
    }
    if (built.blocked) {
      console.error(`Blocked showroom camera route at ${built.blocked.obstacle}`, built.blocked.point);
      onComplete?.(false);
      return null;
    }
    const { curve } = built;
    const startLook = this._startLook.copy(this.lookTarget);
    const endLook = this._endLook.set(...targetPosition);
    const state = { t: 0 };
    this.motion = gsap.to(state, {
      t: 1,
      duration,
      ease,
      onUpdate: () => {
        curve.getPointAt(state.t, this.camera.position);
        this.lookTarget.lerpVectors(startLook, endLook, state.t);
        this.camera.lookAt(this.lookTarget);
        this.lastSafeCameraPosition.copy(this.camera.position);
        this.dirty = true;
        onProgress?.(state.t);
      },
      onComplete: () => {
        this.motion = null;
        this.dirty = true;
        onComplete?.(true);
      },
    });
    return this.motion;
  }

  createResizeHandling() {
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.canvas.parentElement);
    this.resize();
  }

  resize() {
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    if (!width || !height) return;
    this.camera.aspect = width / height;
    this.camera.fov = width < 640 ? 54 : width < 960 ? 46 : 38;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(Math.min(this.pixelRatio, width < 640 ? 1.15 : this.maxPixelRatio));
    this.renderer.setSize(width, height, false);
    this.dirty = true;
  }

  enter() {
    if (this.entering) return;
    this.entering = true;
    this.transitioning = true;
    this.currentDestination = 'home';
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const route = [[0, 2.5, 20], [0, 2.5, 14.2], [0, 2.35, 10], [0, 2.35, 7], [0, 2.35, 4.7]];
    const finish = (safe) => {
      this.entering = false;
      this.transitioning = false;
      this.onEntered?.(Boolean(safe));
    };
    if (this.buildPath(route).blocked) {
      console.error('Entrance camera route is blocked');
      finish(false);
      return;
    }
    const openDoor = (door, x) => gsap.to(door.pivot.position, { x, duration: reducedMotion ? 0.15 : 2.1, delay: 0.15, ease: 'power2.inOut', onUpdate: () => { this.dirty = true; } });
    this.entranceTweens = [openDoor(this.doors[0], -3.4), openDoor(this.doors[1], 3.4)];
    this.onEntranceProgress?.('Opening glass doors...', 24);
    // Everything is already built and uploaded; a lighter render resolution keeps the glide smooth on integrated GPUs.
    const fullRatio = this.pixelRatio;
    this.pixelRatio = Math.min(this.pixelRatio, 1);
    this.resize();
    this.skipEntrance = () => { this.entranceTweens.forEach((t) => t.timeScale(6)); this.motion?.timeScale(6); };
    wait(reducedMotion ? 0 : 1100).then(() => {
      this.followCameraPath(route, [0, 1.9, -1.4], reducedMotion ? 0.15 : 5.2, (safe) => {
        this.pixelRatio = Math.max(this.pixelRatio, Math.min(fullRatio, this.maxPixelRatio));
        this.resize();
        finish(safe);
      }, (progress) => {
        const label = progress > 0.88 ? 'Almost ready...' : progress > 0.2 ? 'Entering showroom...' : 'Opening glass doors...';
        this.onEntranceProgress?.(label, Math.min(99, Math.round(24 + progress * 74)));
      });
    });
  }

  // Candidate routes from the current camera position, preferring the most direct collision-free one.
  planRoute(route, toHome) {
    const from = this.camera.position.toArray();
    const home = DESTINATIONS.home.position;
    const isHome = (p) => p.every((v, i) => Math.abs(v - home[i]) < 0.001);
    const waypoints = toHome ? [] : route.waypoints;
    const tail = waypoints.filter((p) => !isHome(p));
    const candidates = [
      [from, route.position],
      [from, ...waypoints.slice(1), route.position],
      [from, home, ...tail, route.position],
      [from, [from[0], 2.35, 2.8], home, ...tail, route.position],
    ];
    for (const points of candidates) {
      const built = this.buildPath(points);
      if (!built.blocked) return { points, length: built.length };
    }
    return null;
  }

  moveTo(destination, onComplete) {
    if (this.entering) return false;
    const route = DESTINATIONS[destination] ?? DESTINATIONS.home;
    const plan = this.planRoute(route, destination === 'home');
    if (!plan) {
      console.error(`Camera route to ${destination} is blocked`);
      onComplete?.(route, false);
      return false;
    }
    this.currentDestination = destination;
    this.transitioning = true;
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const duration = reducedMotion ? 0.2 : THREE.MathUtils.clamp(1.7 + plan.length * 0.17, 2.2, 4.2);
    this.followCameraPath(plan.points, route.target, duration, (safe) => {
      this.transitioning = false;
      onComplete?.(route, safe);
    });
    return true;
  }

  // Lower the render resolution on slow GPUs and restore it when there is headroom.
  adaptQuality(now) {
    const t = this.frameTimes;
    const dt = now - t.last;
    t.last = now;
    if (document.hidden || !document.hasFocus()) { t.checked = now; return; }
    if (dt < 250) t.average = t.average * 0.94 + dt * 0.06;
    if (now - t.checked < 2000) return;
    t.checked = now;
    if (t.average > 26 && this.pixelRatio > 0.8) {
      this.pixelRatio = Math.max(0.8, this.pixelRatio - 0.15);
      this.resize();
    } else if (t.average < 17.5 && this.pixelRatio < this.maxPixelRatio) {
      this.pixelRatio = Math.min(this.maxPixelRatio, this.pixelRatio + 0.1);
      this.resize();
    }
  }

  render() {
    this.renderFrame();
  }

  // Renders only when something changed; the scene is static between camera moves, so idle frames cost nothing.
  renderFrame() {
    if (!this.dirty) return;
    this.dirty = false;
    const now = performance.now();
    if (this.shadowDirty && now - this.lastShadow > 500) {
      this.renderer.shadowMap.needsUpdate = true;
      this.shadowDirty = false;
      this.lastShadow = now;
    }
    if (this.transitioning) this.adaptQuality(now);
    this.renderer.render(this.scene, this.camera);
    if (this.shadowDirty) this.dirty = true;
  }

  dispose() {
    gsap.ticker.remove(this.tick);
    this.motion?.kill();
    this.resizeObserver.disconnect();
    this.renderer.dispose();
  }
}

export { DESTINATIONS };
