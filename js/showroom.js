import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { rng } from './textures.js';
import { TextureLibrary } from './texture-library.js';
import { createMaterials } from './materials.js';
import { PlantFactory } from './plants.js';
import { buildDistrict, buildGround } from './district.js';
import { installOpaqueReuse } from './frame-renderer.js';

const DESTINATIONS = {
  home: { label: 'CENTER · WELCOME', position: [0, 2.35, 4.7], target: [0, 2, -1.4], waypoints: [[0, 2.35, 14.2], [0, 2.35, 10], [0, 2.35, 7], [0, 2.35, 4.7]], screenClass: 'screen-home' },
  inventory: { label: 'LEFT WING · INVENTORY', position: [-5.3, 2.35, 1.7], target: [-8, 2.1, -3.1], waypoints: [[0, 2.35, 4.7], [-3.1, 2.35, 3.1], [-5.3, 2.35, 1.7]], screenClass: 'screen-left' },
  brands: { label: 'RIGHT WING · BRANDS', position: [5.3, 2.35, 1.7], target: [8, 2.1, -3.1], waypoints: [[0, 2.35, 4.7], [3.1, 2.35, 3.1], [5.3, 2.35, 1.7]], screenClass: 'screen-right' },
  services: { label: 'BACK LEFT · SERVICES', position: [-5.2, 2.4, -7.2], target: [-9, 2.25, -12.4], waypoints: [[0, 2.35, 4.7], [-4.2, 2.35, 2.8], [-6, 2.4, -2.8], [-5.2, 2.4, -7.2]], screenClass: 'screen-back-left' },
  about: { label: 'BACK RIGHT · ABOUT US', position: [5.2, 2.4, -7.2], target: [9, 2.25, -12.4], waypoints: [[0, 2.35, 4.7], [4.2, 2.35, 2.8], [6, 2.4, -2.8], [5.2, 2.4, -7.2]], screenClass: 'screen-back-right' },
  contact: { label: 'FRONT RIGHT · CONTACT', position: [4.4, 2.3, 3.1], target: [8.4, 2.95, 9.58], waypoints: [[0, 2.35, 4.7], [2.4, 2.3, 4.2], [4.4, 2.3, 3.1]], screenClass: 'screen-front' },
};

const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);
UNIT_BOX.setAttribute('uv2', UNIT_BOX.attributes.uv.clone());
const UNIT_PANE = new THREE.PlaneGeometry(1, 1);
UNIT_PANE.setAttribute('uv2', UNIT_PANE.attributes.uv.clone());
export const SUN_DIRECTION = new THREE.Vector3(-24, 21, 10).normalize();
const wait = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
const CENTER_Z = -4.15;

// Same curves as the former GSAP eases, so route timing and feel are unchanged.
const EASES = {
  'sine.inOut': (t) => (1 - Math.cos(Math.PI * t)) / 2,
  'power2.inOut': (t) => (t < 0.5 ? 4 * t * t * t : 1 - ((2 - 2 * t) ** 3) / 2),
};
// Slow frames advance animations by real time, so routes keep their duration on any GPU. A longer gap is a stall
// (tab switch, blocking work) and advances one nominal frame instead, as GSAP's lag smoothing did.
const STALL_GAP = 500;
const STALL_STEP = 1000 / 30;

// Time-based tween advanced only by the showroom's frame loop, from the same timestamp the frame is rendered for.
class FrameTween {
  constructor(seconds, { delay = 0, ease = 'sine.inOut', onUpdate, onComplete } = {}) {
    this.length = Math.max(0, seconds) * 1000;
    this.elapsed = -Math.max(0, delay) * 1000;
    this.ease = EASES[ease] ?? EASES['sine.inOut'];
    this.onUpdate = onUpdate;
    this.onComplete = onComplete;
    this.speed = 1;
    this.paused = false;
    this.finished = false;
  }

  advance(milliseconds) {
    if (this.paused || this.finished) return;
    this.elapsed += milliseconds * this.speed;
    if (this.elapsed >= 0) this.render();
  }

  render() {
    const progress = this.progress();
    this.onUpdate?.(this.ease(progress));
    if (progress < 1) return;
    this.finished = true;
    this.onComplete?.();
  }

  progress(value) {
    if (value === undefined) return this.length ? THREE.MathUtils.clamp(this.elapsed / this.length, 0, 1) : this.elapsed >= 0 ? 1 : 0;
    if (!this.finished) {
      this.elapsed = value * this.length;
      this.render();
    }
    return this;
  }

  duration() { return this.length / 1000; }
  timeScale(speed) { this.speed = speed; return this; }
  pause() { this.paused = true; return this; }
  kill() { this.finished = true; return this; }
}

const EVENING = {
  sunColor: ['#fff0dc', '#ffb36b', '#7f8fc8'],
  sunIntensity: [2.15, 1.95, 0.35],
  hemiSky: ['#e6eefa', '#c9b8ab', '#3a4470'],
  hemiGround: ['#cfcac2', '#7a6657', '#1e2234'],
  hemiIntensity: [0.72, 0.68, 0.45],
  fog: ['#c9d7e6', '#dfb894', '#2b3254'],
  fogDensity: [0.0036, 0.0042, 0.0046],
  sky: ['#ffffff', '#ffb98c', '#6f86c8'],
  envIntensity: [0.8, 0.75, 0.55],
  ledBoost: [0, 0.5, 1],
  wakeLights: 34,
};

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

function scaleWoodUV(geometry, size, tile, offsetU = 0, offsetV = 0) {
  const positions = geometry.attributes.position;
  const normals = geometry.attributes.normal;
  const uv = geometry.attributes.uv;
  for (let vertex = 0; vertex < positions.count; vertex++) {
    const normal = [Math.abs(normals.getX(vertex)),Math.abs(normals.getY(vertex)),Math.abs(normals.getZ(vertex))];
    const facing = normal.indexOf(Math.max(...normal));
    const axes = facing === 0 ? [2,1] : facing === 1 ? [0,2] : [0,1];
    if (size[axes[0]] < size[axes[1]]) axes.reverse();
    uv.setXY(vertex,positions.getComponent(vertex,axes[0]) / tile + offsetU,positions.getComponent(vertex,axes[1]) / tile + offsetV);
  }
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
    this.camera.position.set(22, 104, 38);
    this.lookTarget = new THREE.Vector3(0, 80, -70);
    this.camera.lookAt(this.lookTarget);
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
    const coarsePointer = matchMedia('(pointer: coarse)').matches;
    this.highTier = !coarsePointer && innerWidth >= 1200 && (navigator.deviceMemory ?? 8) >= 8 && (navigator.hardwareConcurrency ?? 4) >= 12;
    this.maxPixelRatio = Math.max(1, Math.min(devicePixelRatio, this.highTier ? 1.5 : coarsePointer ? 1.15 : 1.25));
    this.pixelRatio = this.maxPixelRatio;
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.transmissionResolutionScale = 1;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 0.68;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    // The room is static, so shadow maps are re-rendered only when content is added.
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.shadowMap.needsUpdate = true;

    this.currentDestination = 'entrance';
    this.startupPreparing = true;
    this.outside = true;
    this.fastEntrance = false;
    this.transitioning = false;
    this.entering = false;
    this.isIntroPlaying = false;
    this.dirty = true;
    this.shadowDirty = true;
    this.lastShadow = 0;
    this.motion = null;
    this.tweens = new Set();
    this.cameraRadius = 0.38;
    this.cameraColliders = [];
    this.lastSafeCameraPosition = this.camera.position.clone();
    this._camBox = new THREE.Box3();
    this._lo = new THREE.Vector3();
    this._hi = new THREE.Vector3();
    this._startLook = new THREE.Vector3();
    this._endLook = new THREE.Vector3();
    this._cameraClip = new THREE.Matrix4();
    this._cameraFrustum = new THREE.Frustum();
    this.cameraCullingEnabled = true;
    this.cullingMeshes = [];
    this.glassPlanes = [];
    this.timings = {};
    this.interiorReady = new Promise((resolve) => { this._resolveInterior = resolve; });
    this.stagesReady = new Promise((resolve) => { this._resolveStages = resolve; });
    this.sectionsReady = false;
    this.rand = rng(20240603);
    this.root = new THREE.Group();
    this.scene.add(this.root);
    this.deferredGroups = [];
    this.contactMats = new Map();
    this.roundedGeo = new Map();
    this.exteriorWakeLights = [];
    this.frameTimes = { average: 16, last: performance.now(), checked: performance.now() };
    // Resolution multiplier for frames where the camera travels; it only drops on GPUs that cannot keep travel fluid.
    this.motionScale = 1;
    this.motionCeiling = 1;
    this.renderScale = 1;
    this.motionGaps = [];
    this.settleFrames = 0;
    this.wasMoving = false;
    // Frame pacing: frames still on the GPU, and the cadence in display refreshes that the GPU sustains.
    this.inFlight = [];
    // How long the last full-resolution frames drawn on an idle GPU took to leave it, in milliseconds.
    this.fullFrameCosts = [];
    this.pace = { cadence: 1, refresh: 1000 / 60, gaps: new Float64Array(30), gapCount: 0, lastCallback: null, lastDraw: null, draws: 0, fast: 0, misses: 0, late: false, settle: 0, lowered: false, floor: 1, floorUntil: 0, backoff: 7500 };
    this.resuming = false;

    this.lib = new TextureLibrary(this.renderer, { maxSize: this.highTier ? 2048 : 1024 });
    this.m = createMaterials(this.lib);
    this.plants = new PlantFactory(this.m);
    this.compilationEnvironment = new THREE.Texture({ width: 1536, height: 2048 });
    this.compilationEnvironment.mapping = THREE.CubeUVReflectionMapping;
    this.compilationEnvironment.type = THREE.HalfFloatType;
    this.compilationEnvironment.colorSpace = THREE.LinearSRGBColorSpace;
    this.scene.environment = this.compilationEnvironment;
    this.distantGlass = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.02, depthWrite: false, side: THREE.DoubleSide });
    this.distantGlass.forceSinglePass = true;
    this.introGlassMeshes = new Map();

    // Stage 1: everything needed for the entrance (lighting, shell, glass, doors, central feature).
    const t0 = performance.now();
    this.buildLighting();
    this.buildSky();
    this.buildClouds();
    this.buildShell();
    this.registerCameraColliders();
    this.lib.onChange = () => this.requestRender();
    this.createResizeHandling();
    this.post = null;
    const realismStarted = performance.now();
    this.realismReady = this.initRealism().finally(() => { this.timings.realism = Math.round(performance.now() - realismStarted); });
    this.storyModuleReady = import('./story.js');
    const measure = (name, load) => {
      const started = performance.now();
      return load().finally(() => { this.timings[name] = Math.round(performance.now() - started); });
    };
    this.shaderAssetsReady = Promise.all([
      measure('pbrMaps', () => this.lib.loadExternalMaps((loaded, total) => this.onLoadProgress?.('Loading showroom materials...', 4 + Math.round((loaded / Math.max(total, 1)) * 12))).catch((error) => console.warn('PBR maps unavailable; using compact procedural materials', error))),
      measure('logo', () => this.loadLogo().catch((error) => console.warn('Official logo unavailable; keeping sign lettering', error))),
    ]);
    this.environmentReady = measure('hdri', () => this.loadEnvironment().catch((error) => {
      console.warn('HDRI unavailable; using the procedural environment', error);
      if (!this.scene.environment || this.scene.environment === this.compilationEnvironment) this.buildEnvironmentMap();
    }));
    this.criticalAssetsReady = Promise.all([this.shaderAssetsReady, this.environmentReady]);
    this.timings.stage1 = Math.round(performance.now() - t0);
    this.animationTime = null;
    this.onVisibilityChange = () => { this.animationTime = null; };
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    // The only animation loop: the cinematic, camera routes and doors all advance from this frame's timestamp, then the frame renders.
    this.tick = (time) => {
      this.animationFrame = requestAnimationFrame(this.tick);
      if (!this.frameDue(time)) return;
      const gap = this.animationTime === null ? 0 : Math.max(0, time - this.animationTime);
      let delta = gap > STALL_GAP ? STALL_STEP : gap;
      this.animationTime = time;
      if (this.resuming) {
        // The previous frame showed the still view at a new resolution; the clock starts from it with one regular step.
        delta = Math.min(delta, this.pace.cadence * this.pace.refresh);
        this.resuming = false;
      }
      if (this.beginTravel()) {
        this.drawFrame(time);
        return;
      }
      this.story?.update(delta);
      this.motion?.advance(delta);
      for (const tween of this.tweens) {
        tween.advance(delta);
        if (tween.finished) this.tweens.delete(tween);
      }
      this.updateRenderScale(gap);
      this.drawFrame(time);
    };
    this.animationFrame = requestAnimationFrame(this.tick);
    // Compile shaders without blocking, then stream the rest in while the doors open.
    this.ready = this.start();
  }

  async start() {
    const started = performance.now();
    await Promise.all([this.runStages(), this.shaderAssetsReady, this.realismReady, this.storyModuleReady]);
    if (this.lib.sets.wood.ao) {
      this.m.wood.aoMap = this.lib.sets.wood.ao;
      this.m.wood.aoMapIntensity = 0.3;
      this.m.wood.needsUpdate = true;
    }
    this.prepareCameraCulling();
    this.frameRenderer = this.post ? null : installOpaqueReuse(this.renderer,this.scene);
    const compileStarted = performance.now();
    try {
      await this.compilePasses(this.scene);
    } catch (error) {
      console.warn('Final shader precompile skipped', error);
    }
    this.timings.shaderCompilation = Math.round(performance.now() - compileStarted);
    await this.criticalAssetsReady;
    if (this.scene.environment.image.height !== this.compilationEnvironment.image.height) await this.compilePasses(this.scene);
    this.compilationEnvironment.dispose();
    this.timings.programsBeforePrewarm = this.renderer.info.programs.length;
    const prewarmStarted = performance.now();
    await this.prewarm();
    this.prepareCameraCulling();
    this.timings.prewarm = Math.round(performance.now() - prewarmStarted);
    this.timings.programsAfterPrewarm = this.renderer.info.programs.length;
    const firstUseStarted = performance.now();
    for (const program of this.renderer.info.programs) program.getUniforms();
    this.timings.shaderFirstUse = Math.round(performance.now() - firstUseStarted);
    this.startupPreparing = false;
    this.sectionsReady = true;
    this._resolveInterior();
    this._resolveStages();
    this.requestRender();
    this.timings.criticalReady = Math.round(performance.now() - started);
    this.onLoadProgress?.('Showroom ready', 100);
    return true;
  }

  requestRender() {
    this.dirty = true;
  }

  async initRealism() {
    if (new URLSearchParams(location.search).get('fx') === '0') return;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.95;
    const lowPower = matchMedia('(pointer: coarse)').matches || innerWidth < 640 || (navigator.deviceMemory ?? 8) <= 4;
    const enableEffects = new URLSearchParams(location.search).get('fx') === '1';
    if (lowPower || !enableEffects) return;
    try {
      const fx = await import('./realism-upgrade.js');
      fx.upgradeRenderer(this.renderer);
      fx.upgradeMaterials(this.m);
      this.post = fx.createPostProcessing(this);
      this.requestRender();
    } catch (error) {
      console.warn('Realism upgrade skipped', error);
      this.post = null;
    }
  }

  loadLogo() {
    const logo = document.querySelector('#arrival-curtain img');
    this.logoURL = logo?.currentSrc || logo?.src || new URL('assets/logo/logo-white.png', document.baseURI).href;
    return this.logoLoading ??= this.lib.loadImage(this.logoURL).then((image) => {
      this.logoImage = image;
      this.applyLogo();
    });
  }

  async loadEnvironment() {
    return this.environmentLoading ??= (async () => {
      const { HDRLoader } = await import('three/addons/loaders/HDRLoader.js');
      const texture = await this.lib.cachedAsset('assets/environment/urban_street_01_2k.hdr', (url) => new HDRLoader().setDataType(THREE.HalfFloatType).loadAsync(url));
      texture.mapping = THREE.EquirectangularReflectionMapping;
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      const environment = pmrem.fromEquirectangular(texture).texture;
      const previous = this.scene.environment;
      this.scene.environment = environment;
      this.scene.environmentIntensity = 0.62;
      texture.dispose();
      pmrem.dispose();
      previous?.dispose();
      this.requestRender();
    })();
  }

  applyLogo() {
    const image = this.logoImage;
    if (!image || !this.logoPlates) return;
    for (const plate of this.logoPlates) {
      const { canvas, texture, aspect, fillWidth = 0.72, fillHeight = 0.66 } = plate;
      canvas.width = this.highTier ? 2048 : 1024;
      canvas.height = Math.round(canvas.width / aspect);
      const g = canvas.getContext('2d');
      const { width, height } = canvas;
      const bg = g.createLinearGradient(0, 0, 0, height);
      bg.addColorStop(0, '#2a2e30');
      bg.addColorStop(0.5, '#171a1c');
      bg.addColorStop(1, '#25292b');
      g.fillStyle = bg;
      g.fillRect(0, 0, width, height);
      const scale = Math.min((width * fillWidth) / image.width, (height * fillHeight) / image.height);
      const drawWidth = image.width * scale;
      const drawHeight = image.height * scale;
      g.drawImage(image, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
      texture.dispose();
      texture.needsUpdate = true;
    }
    this.requestRender();
  }

  setTimeOfDay(k) {
    k = THREE.MathUtils.clamp(k, 0, 1);
    if (this._tod !== undefined && k !== 0 && k !== 1 && Math.abs(this._tod - k) < 0.002) return;
    this._tod = k;
    const colors = (this._eveningColors ??= Object.fromEntries(['sunColor', 'hemiSky', 'hemiGround', 'fog', 'sky'].map((key) => [key, EVENING[key].map((color) => new THREE.Color(color))])));
    const temp = (this._eveningTmp ??= new THREE.Color());
    const colorAt = (key) => {
      const [day, golden, night] = colors[key];
      return k < 0.5 ? temp.copy(day).lerp(golden, k * 2) : temp.copy(golden).lerp(night, (k - 0.5) * 2);
    };
    const numberAt = ([day, golden, night]) => (k < 0.5 ? day + (golden - day) * k * 2 : golden + (night - golden) * (k - 0.5) * 2);

    if (this.sun) { this.sun.color.copy(colorAt('sunColor')); this.sun.intensity = numberAt(EVENING.sunIntensity); }
    if (this.hemi) {
      this.hemi.color.copy(colorAt('hemiSky'));
      this.hemi.groundColor.copy(colorAt('hemiGround'));
      this.hemi.intensity = numberAt(EVENING.hemiIntensity);
    }
    this.scene.fog.color.copy(colorAt('fog'));
    this.scene.fog.density = numberAt(EVENING.fogDensity);
    this.scene.background.copy(colorAt('fog'));
    this.skyDome?.material.color.copy(colorAt('sky'));
    this.scene.environmentIntensity = numberAt(EVENING.envIntensity);

    const boost = numberAt(EVENING.ledBoost);
    const base = (this._ledBase ??= { ledWarm: this.m.ledWarm.emissiveIntensity, ledSoft: this.m.ledSoft.emissiveIntensity, lampShade: this.m.lampShade.emissiveIntensity });
    for (const key of Object.keys(base)) this.m[key].emissiveIntensity = base[key] * (1 + boost * 0.9);
    const wake = THREE.MathUtils.smoothstep(k, 0.25, 0.75);
    for (const light of this.exteriorWakeLights) light.intensity = EVENING.wakeLights * wake;
    this.requestRender();
  }

  async startStory() {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
    try {
      await this.ready;
      const { ScrollStory } = await this.storyModuleReady;
      if (this.isIntroPlaying) return true;
      if (this.entering || this.transitioning) return false;
      this.story?.dispose();
      this.story = new ScrollStory(this, DESTINATIONS.home);
      return this.story.begin();
    } catch (error) {
      console.warn('Scroll story unavailable', error);
      return false;
    }
  }

  /* ---------- helpers ---------- */

  box(parent, size, position, material, options = {}) {
    const glazing = material.transmission > 0.9;
    const geometry = glazing ? new THREE.PlaneGeometry(Math.max(size[0], size[2]), size[1]) : new THREE.BoxGeometry(...size);
    const tile = material.userData.tile;
    if (tile) {
      if (material.userData.grainAlongLength) scaleWoodUV(geometry,size,tile,this.rand(),this.rand());
      else scaleBoxUV(geometry, size, tile, this.rand(), this.rand());
    }
    geometry.setAttribute('uv2', geometry.attributes.uv.clone());
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(...position);
    if (glazing && size[0] < size[2]) mesh.rotation.y = Math.PI / 2;
    mesh.castShadow = options.castShadow ?? true;
    mesh.receiveShadow = options.receiveShadow ?? true;
    parent.add(mesh);
    return mesh;
  }

  rbox(parent, size, radius, position, material, options = {}) {
    const key = `${size.join(',')}:${radius}${material.userData.grainAlongLength ? ':wood' : ''}`;
    if (!this.roundedGeo.has(key)) {
      const geometry = new RoundedBoxGeometry(size[0], size[1], size[2], 3, radius);
      if (material.userData.grainAlongLength) scaleWoodUV(geometry,size,material.userData.tile);
      geometry.setAttribute('uv2', geometry.attributes.uv.clone());
      this.roundedGeo.set(key, geometry);
    }
    const mesh = new THREE.Mesh(this.roundedGeo.get(key), material);
    mesh.position.set(...position);
    if (options.rotation) mesh.rotation.set(...options.rotation);
    mesh.castShadow = options.castShadow ?? true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  instancedBoxes(parent, material, items, { castShadow = true } = {}) {
    if (material.userData.grainAlongLength && items.length) {
      const grain = rng(4412);
      const pieces = items.map(([width,height,depth,positionX,positionY,positionZ]) => {
        const geometry = new THREE.BoxGeometry(width,height,depth);
        scaleWoodUV(geometry,[width,height,depth],material.userData.tile,grain(),grain());
        geometry.setAttribute('uv2',geometry.attributes.uv.clone());
        geometry.translate(positionX,positionY,positionZ);
        return geometry;
      });
      const mesh = new THREE.Mesh(mergeGeometries(pieces),material);
      pieces.forEach((geometry) => geometry.dispose());
      mesh.castShadow = castShadow;
      mesh.receiveShadow = true;
      mesh.name = 'physical-scale-oak-boards';
      parent.add(mesh);
      return mesh;
    }
    const glazing = material.transmission > 0.9;
    if (glazing) {
      const planes = new Map();
      for (const item of items) {
        const axis = item[0] < item[2] ? 3 : 5;
        const key = `${axis}:${item[axis]}`;
        if (!planes.has(key)) planes.set(key, []);
        planes.get(key).push(item);
      }
      for (const panes of planes.values()) {
        const paneMaterial = material.clone();
        paneMaterial.side = THREE.FrontSide;
        this.createBoxInstances(parent, paneMaterial, panes, castShadow);
      }
      return;
    }
    return this.createBoxInstances(parent, material, items, castShadow);
  }

  createBoxInstances(parent, material, items, castShadow) {
    const glazing = material.transmission > 0.9;
    const mesh = new THREE.InstancedMesh(glazing ? UNIT_PANE : UNIT_BOX, material, items.length);
    const d = new THREE.Object3D();
    items.forEach(([sx, sy, sz, x, y, z], i) => {
      d.position.set(x, y, z);
      d.rotation.set(0, glazing && sx < sz ? Math.PI / 2 : 0, 0);
      d.scale.set(glazing ? Math.max(sx, sz) : sx, sy, glazing ? 1 : sz);
      d.updateMatrix();
      mesh.setMatrixAt(i, d.matrix);
    });
    mesh.castShadow = castShadow;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
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

  screenCanvas(title, lines, aspect, small = 'AUTO HAUS GROUP  /  LEBANON') {
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

  brandCanvas(text, sub, aspect, titleScale = 0.25) {
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
    g.font = `700 ${h * titleScale}px Manrope, sans-serif`;
    const largeTitle = titleScale > 0.3;
    g.fillText(text, w / 2, h * (largeTitle ? 0.43 : 0.46));
    g.fillStyle = '#d4b97e';
    g.font = `600 ${h * 0.07}px Manrope, sans-serif`;
    g.fillText(sub, w / 2, h * (largeTitle ? 0.75 : 0.68));
    g.fillRect(w * 0.3, h * (largeTitle ? 0.08 : 0.28), w * 0.4, Math.max(2, h * 0.006));
    g.fillRect(w * 0.3, h * (largeTitle ? 0.92 : 0.8), w * 0.4, Math.max(2, h * 0.006));
    return c;
  }

  screenMaterial(canvas, intensity = 0.95, mirror = false) {
    const tex = canvasTexture(canvas, Math.min(16, this.renderer.capabilities.getMaxAnisotropy()));
    if (mirror) {
      tex.repeat.x = -1;
      tex.offset.x = 1;
    }
    return new THREE.MeshStandardMaterial({ color: '#050606', roughness: 0.32, metalness: 0, emissive: '#ffffff', emissiveMap: tex, emissiveIntensity: intensity * 0.6 });
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

  sign(parent, text, position, width, height = 0.52, options = {}) {
    const frame = this.box(parent, [width, height, 0.05], position, this.m.darkSteel, { castShadow: false });
    const aspect = (width - 0.06) / (height - 0.06);
    const canvas = this.brandCanvas(text, '', aspect, 0.52);
    const material = this.screenMaterial(canvas, 0.9);
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(width - 0.06, height - 0.06), material);
    plate.position.set(position[0], position[1], position[2] + 0.028);
    parent.add(plate);
    if (text === 'AUTO HAUS GROUP') {
      (this.logoPlates ??= []).push({ canvas, texture: material.emissiveMap, aspect, fillWidth: options.fillWidth ?? 0.72, fillHeight: options.fillHeight ?? 0.66 });
      this.applyLogo();
    }
    return frame;
  }

  commit(group) {
    this.batchStaticMeshes(group, true);
    this.root.add(group);
    if (this.distantGlazingActive) this.applyDistantGlazing(group);
    this.shadowDirty = true;
    if (!this.startupPreparing) this.prepareCameraCulling();
    this.requestRender();
  }

  prepareCameraCulling() {
    for (const { object, visible } of this.cullingMeshes) object.visible = visible;
    this.cullingMeshes.length = 0;
    this.glassPlanes.length = 0;
    this.root.updateWorldMatrix(true, true);
    const movingRoots = new Set([this.cloudLayer, ...(this.doors ?? []).map(door => door.pivot)]);
    this.root.traverse((object) => {
      if (!object.isMesh || object.isSkinnedMesh) return;
      let moving = false;
      for (let parent = object; parent; parent = parent.parent) {
        if (parent.isLOD) return;
        if (movingRoots.has(parent)) moving = true;
      }
      if (object.isInstancedMesh) object.computeBoundingBox();
      else if (!object.geometry.boundingBox) object.geometry.computeBoundingBox();
      const localBounds = object.isInstancedMesh ? object.boundingBox : object.geometry.boundingBox;
      if (!localBounds || localBounds.isEmpty()) return;
      if (!moving) this.cullingMeshes.push({ object, visible: object.visible, bounds: localBounds.clone().applyMatrix4(object.matrixWorld) });
      if (object.geometry.type === 'PlaneGeometry' && object.material?.transmission > 0) {
        if (!object.userData.cameraGlassMaterial) {
          object.material = object.material.clone();
          object.material.side = THREE.FrontSide;
          object.userData.cameraGlassMaterial = true;
        }
        const localMatrix = new THREE.Matrix4();
        if (object.isInstancedMesh) object.getMatrixAt(0, localMatrix);
        const worldMatrix = new THREE.Matrix4().multiplyMatrices(object.matrixWorld, localMatrix);
        const normal = new THREE.Vector3(0, 0, 1).applyNormalMatrix(new THREE.Matrix3().getNormalMatrix(worldMatrix));
        const point = new THREE.Vector3().setFromMatrixPosition(worldMatrix);
        this.glassPlanes.push({ object, plane: new THREE.Plane().setFromNormalAndCoplanarPoint(normal, point) });
      }
    });
    this.frameRenderer?.refresh();
  }

  updateCameraCulling() {
    this.camera.updateMatrixWorld();
    this._cameraClip.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
    this._cameraFrustum.setFromProjectionMatrix(this._cameraClip, this.camera.coordinateSystem);
    const retainAll = !this.cameraCullingEnabled || this.renderer.shadowMap.needsUpdate;
    for (const entry of this.cullingMeshes) {
      entry.object.visible = entry.visible && (retainAll || this._cameraFrustum.intersectsBox(entry.bounds));
    }
    for (const { object, plane } of this.glassPlanes) {
      const side = plane.distanceToPoint(this.camera.position) >= 0 ? THREE.FrontSide : THREE.BackSide;
      if (object.material.side !== side) {
        object.material.side = side;
        object.material.needsUpdate = true;
      }
    }
  }

  batchStaticMeshes(group, flatten = false) {
    if (!flatten) for (const child of group.children) if (child.isGroup) this.batchStaticMeshes(child);
    group.updateWorldMatrix(true, false);
    const inverse = flatten ? group.matrixWorld.clone().invert() : null;
    const candidates = [];
    const movingRoots = new Set((this.doors ?? []).map((door) => door.pivot));
    if (flatten) group.traverse((object) => {
      if (!object.isMesh) return;
      for (let parent = object.parent; parent && parent !== group; parent = parent.parent) {
        if (parent.isLOD || movingRoots.has(parent)) return;
      }
      candidates.push(object);
    });
    else candidates.push(...group.children);
    const buckets = new Map();
    for (const mesh of candidates) {
      if (!mesh.isMesh || mesh.isInstancedMesh || Array.isArray(mesh.material) || mesh.material.transparent || mesh.material.transmission > 0) continue;
      const attributes = Object.keys(mesh.geometry.attributes).sort().join(',');
      const key = `${mesh.material.uuid}:${mesh.castShadow}:${mesh.receiveShadow}:${!!mesh.geometry.index}:${attributes}`;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(mesh);
    }
    for (const meshes of buckets.values()) {
      if (meshes.length < 2) continue;
      const geometries = meshes.map((mesh) => {
        mesh.updateWorldMatrix(true, false);
        const matrix = inverse ? inverse.clone().multiply(mesh.matrixWorld) : mesh.matrix;
        return mesh.geometry.clone().applyMatrix4(matrix);
      });
      const geometry = mergeGeometries(geometries);
      geometries.forEach((item) => item.dispose());
      if (!geometry) continue;
      const merged = new THREE.Mesh(geometry, meshes[0].material);
      merged.castShadow = meshes[0].castShadow;
      merged.receiveShadow = meshes[0].receiveShadow;
      meshes.forEach((mesh) => mesh.parent.remove(mesh));
      group.add(merged);
    }
  }

  /* ---------- stage 1: lighting, environment, shell ---------- */

  buildLighting() {
    const scene = this.scene;
    this.hemi = new THREE.HemisphereLight('#e6eefa', '#cbd0c8', 0.72);
    scene.add(this.hemi);

    // Daylight from the upper left; the ceiling casts shadows so sun only enters through the glass.
    const sun = new THREE.DirectionalLight('#fff0dc', 2.15);
    sun.position.copy(SUN_DIRECTION).multiplyScalar(60).add(new THREE.Vector3(0, 0, -3));
    sun.target.position.set(0, 0, -3);
    this.sun = sun;
    sun.castShadow = true;
    const highTier = this.highTier;
    sun.shadow.mapSize.setScalar(highTier ? 1024 : 512);
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
    spot('#ffe3bd', 160, [0, 8.5, CENTER_Z + 0.25], [0, 0.9, CENTER_Z], Math.PI / 6, 0.65);
    spot('#ffe6c8', 190, [0, 14.75, 6], [0, 9.4, 4.2], 1.15, 0.9);
    spot('#ffe6c8', 150, [0, 19.7, 6], [0, 15.5, 4.2], 1.2, 0.9);
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
    this.skyDome = dome;
    this.scene.add(dome);
  }

  buildClouds() {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 256;
    const context = canvas.getContext('2d');
    const random = rng(641);
    for (let puff = 0; puff < 36; puff++) {
      const x = 86 + random() * 340;
      const y = 88 + random() * 86;
      const radius = 35 + random() * 58;
      const shade = context.createRadialGradient(x, y, radius * 0.06, x, y, radius);
      shade.addColorStop(0, 'rgba(255,255,255,0.94)');
      shade.addColorStop(0.42, 'rgba(247,250,253,0.84)');
      shade.addColorStop(0.74, 'rgba(217,230,242,0.38)');
      shade.addColorStop(1, 'rgba(217,230,242,0)');
      context.fillStyle = shade;
      context.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    }
    context.save();
    context.globalCompositeOperation = 'destination-in';
    context.translate(256, 128);
    context.scale(1, 0.5);
    const edge = context.createRadialGradient(0, 0, 120, 0, 0, 256);
    edge.addColorStop(0, 'rgba(255,255,255,1)');
    edge.addColorStop(1, 'rgba(255,255,255,0)');
    context.fillStyle = edge;
    context.fillRect(-256, -256, 512, 512);
    context.restore();
    const texture = canvasTexture(canvas, 2);
    const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, opacity: 0.94, depthWrite: false, side: THREE.DoubleSide, fog: false, alphaTest: 0.015, toneMapped: false });
    material.forceSinglePass = true;
    material.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', `
        vec4 mvPosition = modelViewMatrix * vec4(instanceMatrix[3].xyz, 1.0);
        vec2 cloudSize = vec2(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz));
        mvPosition.xy += position.xy * cloudSize;
        gl_Position = projectionMatrix * mvPosition;
      `);
    };
    material.customProgramCacheKey = () => 'arrival-cloud-billboards';
    const clouds = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), material, 24);
    clouds.name = 'visible-layered-arrival-clouds';
    const transform = new THREE.Object3D();
    const heights = [94, 78, 62];
    for (let index = 0; index < clouds.count; index++) {
      const layer = Math.floor(index / 8);
      const angle = index * Math.PI * 0.25 + random() * 0.3;
      const radius = 18 + layer * 7 + random() * 12;
      transform.position.set(22 - layer * 3 + Math.cos(angle) * radius, heights[layer] + random() * 4, 12 + Math.sin(angle) * radius);
      transform.scale.set(28 + random() * 14, 16 + random() * 8, 1);
      transform.updateMatrix();
      clouds.setMatrixAt(index, transform.matrix);
    }
    clouds.frustumCulled = false;
    this.cloudLayer = clouds;
    this.scene.add(clouds);
  }

  updateClouds(progress = 0) {
    if (!this.cloudLayer) return;
    this.cloudLayer.material.opacity = 0.94 * THREE.MathUtils.smoothstep(this.camera.position.y, 30, 46);
    this.cloudLayer.visible = this.cloudLayer.material.opacity > 0.01;
    this.cloudLayer.position.x = progress * 1.5;
  }

  buildShell() {
    const m = this.m;
    const root = this.root;

    const floorGeo = new THREE.PlaneGeometry(32, 27);
    scaleUV(floorGeo, 32 / 6, 27 / 6);
    floorGeo.setAttribute('uv2', floorGeo.attributes.uv.clone());
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

    this.buildExteriorFacade(root);
    this.buildUpperLevels(root);
    this.buildEntrance(root);
    this.buildCeiling(root);
    this.buildColumns(root);
    this.buildCentralFeature(root);
  }

  buildExteriorFacade(root) {
    const stone = this.m.concrete.clone();
    stone.color.set('#e0e2de');
    stone.roughness = 0.72;
    stone.normalScale.setScalar(0.2);
    const silver = this.m.steel.clone();
    silver.color.set('#c5c9ca');
    silver.roughness = 0.36;
    silver.metalness = 0.58;
    const charcoal = this.m.darkstone.clone();
    charcoal.color.set('#171a1c');
    charcoal.roughness = 0.48;
    charcoal.metalness = 0.12;
    charcoal.normalScale.setScalar(0.06);
    this.facadeMaterials = { stone, silver, charcoal };
    const facade = new THREE.Group();
    facade.name = 'unified-building-envelope';
    root.add(facade);
    const front = 11.4;
    const slabs = new THREE.Group();
    slabs.name = 'continuous-floor-plates';
    facade.add(slabs);
    this.box(slabs, [32, 0.46, 27.4], [0, 9.15, -2.25], stone);
    this.box(slabs, [32, 0.46, 27.4], [0, 15.27, -2.25], stone);
    for (const levelY of [9.15, 15.27, 20.22]) {
      this.box(facade, [32.5, 0.56, 1.05], [0, levelY, front + 0.12], stone);
      this.box(facade, [32.5, 0.08, 1.14], [0, levelY - 0.28, front + 0.16], silver, { castShadow: false });
      this.box(facade, [30.8, 0.035, 0.055], [0, levelY - 0.33, front + 0.63], this.m.ledSoft, { castShadow: false });
      for (const side of [-1, 1]) this.box(facade, [0.72, 0.56, 27.5], [side * 15.78, levelY, -2.25], stone);
    }
    const panes = [];
    const mullions = [];
    const sidePanes = [];
    const sideFrames = [];
    const sideWalls = [];
    for (const [floor, top] of [[9.38, 14.98], [15.5, 19.94]]) {
      const height = top - floor;
      for (let bay = 0; bay < 8; bay++) {
        const x = -13.7375 + bay * 3.925;
        panes.push([3.82, height, 0.02, x, floor + height / 2, front]);
      }
      for (let bay = 0; bay <= 8; bay++) mullions.push([0.085, height, 0.15, -15.7 + bay * 3.925, floor + height / 2, front + 0.04]);
      for (const y of [floor + 0.035, top - 0.035]) mullions.push([31.4, 0.07, 0.15, 0, y, front + 0.04]);
      this.box(facade, [31.5, height, 0.3], [0, floor + height / 2, -15.7], stone);
      for (const side of [-1, 1]) {
        sideWalls.push([0.35, height, 3.7, side * 15.72, floor + height / 2, -13.92]);
        for (let bay = 0; bay < 5; bay++) {
          const z = -9.68 + bay * 4.65;
          sidePanes.push([0.02, height, 4.54, side * 15.72, floor + height / 2, z]);
        }
        for (let bay = 0; bay <= 5; bay++) sideFrames.push([0.15, height, 0.085, side * 15.76, floor + height / 2, -12.005 + bay * 4.65]);
        for (const y of [floor + 0.035, top - 0.035]) sideFrames.push([0.15, 0.07, 23.25, side * 15.76, y, -0.38]);
        for (let fin = 0; fin < 8; fin++) sideFrames.push([0.35, height * 0.86, 0.055, side * 15.98, floor + height / 2, -11.7 + fin * 0.38]);
      }
    }
    const curtain = new THREE.Group();
    curtain.name = 'continuous-center-and-wing-glazing';
    facade.add(curtain);
    this.instancedBoxes(curtain, this.m.glass, panes, { castShadow: false });
    this.instancedBoxes(curtain, silver, mullions, { castShadow: false });
    const sides = new THREE.Group();
    sides.name = 'designed-side-facades';
    facade.add(sides);
    this.instancedBoxes(sides, this.m.glass, sidePanes, { castShadow: false });
    this.instancedBoxes(sides, silver, sideFrames, { castShadow: false });
    this.instancedBoxes(sides, stone, sideWalls);
    const centralFrame = new THREE.Group();
    centralFrame.name = 'reference-black-central-facade';
    facade.add(centralFrame);
    const floorDrop = 15.27 - 9.15;
    const headerY = 18.65 - floorDrop;
    const panelJoints = [];
    for (const side of [-1, 1]) {
      this.box(centralFrame, [2.0, 18.62 - floorDrop, 1.15], [side * 6.3, 10.51 - floorDrop / 2, 11.92], charcoal);
      this.box(centralFrame, [2.06, 0.22, 1.25], [side * 6.3, 1.27, 11.92], charcoal);
      for (const y of [3.35, 6.55, 9.35, 12.55]) panelJoints.push([1.9, 0.012, 0.025, side * 6.3, y, 12.5]);
    }
    this.box(centralFrame, [14.6, 2.4, 1.26], [0, headerY, 11.98], charcoal);
    this.box(centralFrame, [14.65, 0.09, 1.28], [0, 19.9 - floorDrop, 11.98], silver, { castShadow: false });
    this.instancedBoxes(centralFrame, this.m.darkSteel, panelJoints, { castShadow: false });
    this.sign(centralFrame, 'AUTO HAUS GROUP', [0, headerY, 12.63], 12.5, 2.03, { fillWidth: 0.94, fillHeight: 0.9 });
    for (const side of [-1, 1]) {
      this.box(sides, [0.3, 20.0, 0.35], [side * 15.7, 10.12, -15.7], charcoal);
      this.box(sides, [1.1, 0.6, 18], [side * 16.8, 0.3, -1.2], stone, { castShadow: false });
      for (const z of [-7.5, -1.2, 5.1]) {
        const { group } = this.plants.build('olive', 140 + Math.round(z * 10) + side, { pot: 'ceramic', potRadius: 0.42, potHeight: 0.6, scale: 0.7 });
        group.position.set(side * 16.8, 0.6, z);
        group.traverse((object) => { object.castShadow = false; });
        sides.add(group);
      }
    }
    const stairs = new THREE.Group();
    stairs.name = 'solid-entrance-stair-and-landing';
    root.add(stairs);
    const nosings = [];
    for (let step = 0; step < 11; step++) {
      const height = 0.12 * (step + 1);
      this.box(stairs, [10.7, height, 0.56], [0, height / 2, 18.0 - step * 0.56], stone);
      nosings.push([10.3, 0.015, 0.045, 0, height + 0.008, 18.24 - step * 0.56]);
    }
    this.box(stairs, [10.7, 1.38, 1.54], [0, 0.69, 11.93], stone);
    this.instancedBoxes(stairs, silver, nosings, { castShadow: false });
    for (const side of [-1, 1]) {
      const from = new THREE.Vector3(side * 5.12, 1.14, 18.2);
      const to = new THREE.Vector3(side * 5.12, 2.4, 11.95);
      const delta = to.clone().sub(from);
      const handrail = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, delta.length(), 8), silver);
      handrail.position.copy(from).add(to).multiplyScalar(0.5);
      handrail.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize());
      stairs.add(handrail);
      for (let post = 0; post < 4; post++) this.box(stairs, [0.035, 1.04, 0.035], [side * 5.12, 0.62 + post * 0.4, 18.2 - post * 2.08], silver, { castShadow: false });
    }
    this.buildRoof(facade);
    this.batchStaticMeshes(facade);
    this.batchStaticMeshes(sides);
    this.batchStaticMeshes(stairs);
  }

  buildUpperLevels(root) {
    const materials = this.m;
    const interiors = new THREE.Group();
    interiors.name = 'furnished-upper-showrooms';
    root.add(interiors);
    const wall = materials.concrete.clone();
    wall.color.set('#e0e3df');
    wall.roughness = 0.78;
    wall.emissive.set('#d9c2a0');
    wall.emissiveIntensity = 0.04;
    const officeStone = materials.floor.clone();
    officeStone.name = 'light-polished-stone-office-worktops';
    const officeBrand = this.screenMaterial(this.brandCanvas('PRIVATE SALES', 'AUTO HAUS GROUP', 5.6 / 1.15), 0.8);
    const officePanes = [];
    const frames = [];
    const worktops = [];
    const cabinetry = [];
    const leatherSeats = [];
    const cognacSeats = [];
    const woodSlats = [];
    const lightBars = [];
    const papers = [];
    const monitors = [];
    interiors.userData.rooms = [];
    const levels = [
      { floor: 9.38, ceiling: 14.98, name: 'sales-consultation-level' },
      { floor: 15.5, ceiling: 19.94, name: 'private-sales-and-delivery-level' },
    ];

    const addChair = (x, z, floor, facing = 1, width = 0.9) => {
      leatherSeats.push([width, 0.16, 0.86, x, floor + 0.51, z]);
      leatherSeats.push([width, 0.77, 0.14, x, floor + 1.01, z - facing * 0.4]);
      for (const side of [-1, 1]) {
        leatherSeats.push([0.09, 0.1, 0.65, x + side * (width / 2 - 0.02), floor + 0.76, z]);
        frames.push([0.035, 0.25, 0.035, x + side * (width / 2 - 0.02), floor + 0.61, z + 0.18]);
      }
      frames.push([0.08, 0.4, 0.08, x, floor + 0.26, z]);
      frames.push([0.66, 0.055, 0.07, x, floor + 0.07, z]);
      frames.push([0.07, 0.055, 0.66, x, floor + 0.07, z]);
    };
    const addDesk = (x, z, floor) => {
      worktops.push([3.35, 0.13, 1.6, x, floor + 0.8, z]);
      cabinetry.push([0.85, 0.69, 1.4, x - 1.08, floor + 0.37, z]);
      frames.push([0.075, 0.72, 1.35, x + 1.25, floor + 0.38, z]);
      for (const y of [0.22, 0.43, 0.64]) frames.push([0.46, 0.025, 0.025, x - 1.08, floor + y, z + 0.71]);
      frames.push([1.05, 0.63, 0.07, x + 0.4, floor + 1.25, z - 0.35]);
      frames.push([0.07, 0.25, 0.07, x + 0.4, floor + 0.97, z - 0.35]);
      frames.push([0.44, 0.035, 0.32, x + 0.4, floor + 0.88, z - 0.35]);
      monitors.push([0.93, 0.51, 0.012, x + 0.4, floor + 1.25, z - 0.306]);
      papers.push([0.52, 0.018, 0.38, x - 0.45, floor + 0.875, z + 0.15]);
      addChair(x, z - 1.55, floor, 1, 0.95);
      for (const side of [-1, 1]) addChair(x + side * 0.78, z + 1.5, floor, -1);
    };
    const addLounge = (x, floor, ceiling, cognac) => {
      const upholstery = cognac ? cognacSeats : leatherSeats;
      const sofaZ = -1.65;
      const tableZ = -3.7;
      upholstery.push([5.5, 0.34, 1.2, x, floor + 0.35, sofaZ]);
      upholstery.push([5.5, 0.8, 0.22, x, floor + 0.93, sofaZ + 0.53]);
      for (const side of [-1, 1]) upholstery.push([0.22, 0.73, 1.2, x + side * 2.65, floor + 0.68, sofaZ]);
      for (const cushion of [-1.75, 0, 1.75]) upholstery.push([1.68, 0.15, 1.0, x + cushion, floor + 0.59, sofaZ - 0.05]);
      for (const side of [-1, 1]) {
        frames.push([0.09, 0.16, 0.78, x + side * 2.35, floor + 0.09, sofaZ]);
        addChair(x + side * 2.0, -5.25, floor, 1, 1.12);
      }
      worktops.push([2.7, 0.12, 1.35, x, floor + 0.48, tableZ]);
      cabinetry.push([1.9, 0.37, 0.95, x, floor + 0.235, tableZ]);
      const pendant = new THREE.Mesh(new THREE.TorusGeometry(0.98, 0.032, 6, 40), materials.ledWarm);
      pendant.rotation.x = Math.PI / 2;
      pendant.position.set(x, ceiling - 0.85, -3.3);
      interiors.add(pendant);
      frames.push([0.016, 0.78, 0.016, x, ceiling - 0.42, -3.3]);
    };

    for (const level of levels) {
      const { floor, ceiling } = level;
      const levelGroup = new THREE.Group();
      levelGroup.name = level.name;
      interiors.add(levelGroup);
      const floorGeometry = new THREE.PlaneGeometry(31.3, 26.8);
      scaleUV(floorGeometry, 31.3 / 6, 26.8 / 6);
      floorGeometry.setAttribute('uv2', floorGeometry.attributes.uv.clone());
      const floorMesh = new THREE.Mesh(floorGeometry, materials.floor);
      floorMesh.rotation.x = -Math.PI / 2;
      floorMesh.position.set(0, floor + 0.012, -2.25);
      floorMesh.receiveShadow = true;
      levelGroup.add(floorMesh);
      const partitionHeight = ceiling - floor - 0.65;
      this.box(levelGroup, [31.3, 0.08, 26.6], [0, ceiling - 0.03, -2.25], materials.ceiling, { castShadow: false });
      const rooms = [{ x: 0, z: -1.55, width: 8.6, depth: 8.2, purpose: floor < 12 ? 'client-meeting-boardroom' : 'vehicle-delivery-suite' }];
      for (const side of [-1, 1]) {
        rooms.push({ x: side * 10.25, z: 3.95, width: 8.0, depth: 8.2, purpose: floor < 12 ? 'sales-consultation-office' : 'private-client-office' });
        rooms.push({ x: side * 10.25, z: -10.25, width: 8.0, depth: 7.3, purpose: side < 0 ? 'ownership-and-finance-office' : 'configuration-workspace' });
        addLounge(side * 10.25, floor, ceiling, side > 0);
        for (const z of [3.95, -10.25]) addDesk(side * 10.25, z, floor);
        const backdropHeight = partitionHeight - 0.85;
        this.box(levelGroup, [6.8, backdropHeight, 0.2], [side * 10.25, floor + backdropHeight / 2 + 0.04, -0.36], wall, { castShadow: false });
        const brand = new THREE.Mesh(new THREE.PlaneGeometry(5.6, 1.15), officeBrand);
        brand.position.set(side * 10.25, floor + 2.55, -0.245);
        levelGroup.add(brand);
        for (const edge of [-1, 1]) {
          woodSlats.push([0.2, backdropHeight, 0.22, side * 10.25 + edge * 3.28, floor + backdropHeight / 2 + 0.04, -0.22]);
          lightBars.push([0.028, backdropHeight - 0.24, 0.04, side * 10.25 + edge * 3.13, floor + backdropHeight / 2 + 0.04, -0.24]);
        }
        cabinetry.push([5.7, 0.95, 0.55, side * 10.25, floor + 0.49, -13.5]);
        for (let slat = 0; slat < 20; slat++) woodSlats.push([0.055, partitionHeight * 0.84, 0.11, side * 10.25 - 2.85 + slat * 0.3, floor + partitionHeight * 0.5, -13.9]);
        this.digitalPanel(levelGroup, [side * 10.25, floor + 2.55, -13.76], 0, 5.35, 1.65, side < 0 ? 'PRIVATE SALES' : 'CONFIGURATION', ['AUTO HAUS GROUP', floor < 12 ? 'OWNERSHIP & FINANCE' : 'PERSONAL DELIVERY']);
      }

      for (const room of rooms) {
        const frontZ = room.z + room.depth / 2;
        const rearZ = room.z - room.depth / 2;
        const paneWidth = room.width / 3;
        const doorSide = room.x < 0 ? 1 : -1;
        interiors.userData.rooms.push({ ...room, floor, height: partitionHeight });
        for (const z of [frontZ, rearZ]) {
          for (let bay = 0; bay < 3; bay++) officePanes.push([paneWidth - 0.075, partitionHeight, 0.02, room.x - room.width / 2 + paneWidth * (bay + 0.5), floor + partitionHeight / 2, z]);
          for (let bay = 0; bay <= 3; bay++) frames.push([0.055, partitionHeight, 0.075, room.x - room.width / 2 + paneWidth * bay, floor + partitionHeight / 2, z]);
          for (const y of [floor + 0.035, floor + partitionHeight]) frames.push([room.width, 0.07, 0.075, room.x, y, z]);
        }
        for (const side of [-1, 1]) {
          const x = room.x + side * room.width / 2;
          if (side === doorSide) {
            const entryStart = room.z - 0.75;
            const entryEnd = room.z + 0.65;
            for (const [start, end] of [[rearZ, entryStart], [entryEnd, frontZ]]) officePanes.push([0.02, partitionHeight, end - start - 0.06, x, floor + partitionHeight / 2, (start + end) / 2]);
            officePanes.push([0.02, 2.7, 1.3, x, floor + 1.35, room.z - 0.05]);
            officePanes.push([0.02, partitionHeight - 2.8, 1.34, x, floor + 2.8 + (partitionHeight - 2.8) / 2, room.z - 0.05]);
            for (const z of [entryStart, entryEnd]) frames.push([0.075, partitionHeight, 0.06, x, floor + partitionHeight / 2, z]);
            frames.push([0.08, 0.07, 1.4, x, floor + 2.76, room.z - 0.05]);
            frames.push([0.04, 0.62, 0.035, x + side * 0.05, floor + 1.25, entryEnd - 0.16]);
          } else {
            officePanes.push([0.02, partitionHeight, room.depth - 0.06, x, floor + partitionHeight / 2, room.z]);
            for (const z of [rearZ + room.depth / 3, rearZ + room.depth * 2 / 3]) frames.push([0.075, partitionHeight, 0.055, x, floor + partitionHeight / 2, z]);
          }
          for (const y of [floor + 0.035, floor + partitionHeight]) frames.push([0.075, 0.07, room.depth, x, y, room.z]);
        }
        const lightY = floor + Math.min(3.85, partitionHeight - 0.18);
        lightBars.push([room.width * 0.68, 0.05, 0.14, room.x, lightY, room.z]);
        frames.push([room.width * 0.7, 0.07, 0.19, room.x, lightY + 0.05, room.z]);
        const hangingHeight = ceiling - 0.12 - lightY;
        for (const side of [-1, 1]) frames.push([0.014, hangingHeight, 0.014, room.x + side * room.width * 0.26, lightY + hangingHeight / 2, room.z]);
      }

      this.box(levelGroup, [8.6, partitionHeight, 0.16], [0, floor + partitionHeight / 2, -5.77], wall, { castShadow: false });
      this.sign(levelGroup, 'AUTO HAUS GROUP', [0, floor + 2.75, -5.665], 6.8, 0.9);
      worktops.push([4.8, 0.13, 1.9, 0, floor + 0.81, -1.55]);
      for (const side of [-1, 1]) frames.push([0.16, 0.74, 1.3, side * 1.65, floor + 0.39, -1.55]);
      for (const x of [-1.6, 0, 1.6]) {
        addChair(x, 0.15, floor, -1, 0.98);
        addChair(x, -3.25, floor, 1, 0.98);
      }
      cabinetry.push([4.2, 0.88, 0.55, 0, floor + 0.46, -4.92]);
      this.box(levelGroup, [7.4, partitionHeight, 0.22], [0, floor + partitionHeight / 2, -13.78], wall, { castShadow: false });
      for (const x of [-1.85, 1.85]) {
        frames.push([1.68, 2.55, 0.06, x, floor + 1.275, -13.63]);
        frames.push([0.022, 2.45, 0.015, x, floor + 1.275, -13.585]);
        lightBars.push([1.85, 0.035, 0.08, x, floor + 2.72, -13.55]);
      }
      lightBars.push([24, 0.035, 0.07, 0, ceiling - 0.2, 10.35]);
      const welcome = new THREE.Group();
      welcome.name = `${level.name}-client-lounge`;
      welcome.position.set(0, floor, 7.1);
      this.rbox(welcome, [4.5, 0.32, 1.18], 0.08, [0, 0.34, 0.95], materials.leather, { castShadow: false });
      this.rbox(welcome, [4.5, 0.78, 0.24], 0.07, [0, 0.92, 1.46], materials.leather, { castShadow: false });
      for (const side of [-1, 1]) this.rbox(welcome, [0.22, 0.7, 1.18], 0.06, [side * 2.14, 0.65, 0.95], materials.leather, { castShadow: false });
      this.rbox(welcome, [2.9, 0.12, 1.25], 0.04, [0, 0.48, -1.15], materials.counter, { castShadow: false });
      this.box(welcome, [2.2, 0.36, 0.8], [0, 0.24, -1.15], materials.wood, { castShadow: false });
      levelGroup.add(welcome);
      for (const side of [-1, 1]) {
        for (const z of [9.1, -12.6]) {
          const { group } = this.plants.build('monstera', Math.round(floor * 10 + z * 3 + side), { pot: 'ceramic', potRadius: 0.4, potHeight: 0.58, scale: 0.7 });
          group.position.set(side * 13.65, floor, z);
          group.traverse((object) => { object.castShadow = false; });
          levelGroup.add(group);
        }
      }
    }

    const partitions = new THREE.Group();
    partitions.name = 'upper-glass-office-partitions';
    interiors.add(partitions);
    this.instancedBoxes(partitions, materials.glass, officePanes, { castShadow: false });
    this.instancedBoxes(interiors, materials.darkSteel, frames, { castShadow: false });
    this.instancedBoxes(interiors, officeStone, worktops, { castShadow: false });
    this.instancedBoxes(interiors, materials.wood, [...cabinetry, ...woodSlats], { castShadow: false });
    this.instancedBoxes(interiors, materials.leather, leatherSeats, { castShadow: false });
    this.instancedBoxes(interiors, materials.leatherCognac, cognacSeats, { castShadow: false });
    this.instancedBoxes(interiors, materials.ledWarm, lightBars, { castShadow: false });
    this.instancedBoxes(interiors, materials.paper, papers, { castShadow: false });
    this.instancedBoxes(interiors, materials.smoked, monitors, { castShadow: false });
    this.batchStaticMeshes(interiors);
  }

  buildRoof(parent) {
    const roof = new THREE.Group();
    roof.name = 'complete-roof-and-screened-services';
    parent.add(roof);
    const { stone, silver, charcoal } = this.facadeMaterials;
    const membrane = new THREE.MeshStandardMaterial({ color: '#a6afac', roughness: 0.92, metalness: 0 });
    this.box(roof, [32.5, 0.46, 27.8], [0, 20.22, -2.25], stone);
    this.box(roof, [31.9, 0.06, 27.2], [0, 20.48, -2.25], membrane, { castShadow: false });
    const parapets = [];
    const caps = [];
    for (const x of [-16.1, 16.1]) {
      parapets.push([0.2, 0.65, 27.8, x, 20.79, -2.25]);
      caps.push([0.3, 0.05, 27.9, x, 21.14, -2.25]);
    }
    for (const z of [-16.05, 11.55]) {
      parapets.push([32.4, 0.65, 0.2, 0, 20.79, z]);
      caps.push([32.6, 0.05, 0.3, 0, 21.14, z]);
    }
    this.instancedBoxes(roof, stone, parapets);
    this.instancedBoxes(roof, silver, caps, { castShadow: false });
    this.box(roof, [8.2, 0.1, 6.8], [8.6, 20.57, -10], charcoal, { castShadow: false });
    const louvers = [];
    for (let row = 0; row < 9; row++) {
      const y = 20.72 + row * 0.15;
      for (const z of [-13.4, -6.6]) louvers.push([8.2, 0.075, 0.08, 8.6, y, z]);
      for (const x of [4.5, 12.7]) louvers.push([0.08, 0.075, 6.8, x, y, -10]);
    }
    this.instancedBoxes(roof, charcoal, louvers, { castShadow: false });
    for (const x of [6.5, 10.5]) {
      this.box(roof, [2.8, 1.0, 3.4], [x, 21.1, -10], silver);
      for (const z of [-10.75, -9.25]) {
        const fan = new THREE.Mesh(new THREE.CylinderGeometry(0.52, 0.52, 0.06, 20), charcoal);
        fan.position.set(x, 21.63, z);
        roof.add(fan);
        const grille = new THREE.Mesh(new THREE.TorusGeometry(0.46, 0.018, 4, 20), silver);
        grille.rotation.x = Math.PI / 2;
        grille.position.set(x, 21.67, z);
        roof.add(grille);
      }
    }
    this.box(roof, [3.4, 1.7, 3.8], [-10.4, 21.38, -10.5], stone);
    this.box(roof, [3.6, 0.14, 4.0], [-10.4, 22.28, -10.5], silver);
    this.box(roof, [1.0, 1.5, 0.04], [-10.4, 21.31, -8.58], charcoal, { castShadow: false });
    this.box(roof, [1.6, 0.12, 1.9], [-4.1, 20.62, -9.5], silver, { castShadow: false });
    const seams = [];
    for (let x = -14; x <= 14; x += 3.5) seams.push([0.015, 0.008, 26.8, x, 20.516, -2.25]);
    for (const x of [-15.4, 15.4]) seams.push([0.12, 0.02, 26.6, x, 20.525, -2.25]);
    this.instancedBoxes(roof, charcoal, seams, { castShadow: false });
    for (const x of [-14.9, 14.9]) for (const z of [-14.7, 10.2]) this.box(roof, [0.34, 0.025, 0.34], [x, 20.54, z], charcoal, { castShadow: false });
    for (const x of [-2.0, 1.2]) {
      const vent = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.18, 0.65, 12), silver);
      vent.position.set(x, 20.86, -13.7);
      roof.add(vent);
      this.box(roof, [0.45, 0.045, 0.45], [x, 21.21, -13.7], charcoal, { castShadow: false });
    }
    this.batchStaticMeshes(roof);
  }

  buildEntrance(root) {
    const m = this.m;
    const z = 11.2;
    this.box(root, [10.3, 0.3, 0.66], [0, 7.73, z], m.steel);
    this.box(root, [10.15, 1.08, 0.025], [0, 8.42, z], m.glass, { castShadow: false });
    const stairRise = 1.38;
    for (const x of [-1.8, 1.8]) {
      this.box(root, [0.18, 6.35, 0.38], [x, stairRise + 3.2, z], m.steel);
      this.box(root, [0.7, 0.13, 0.7], [x, stairRise + 0.065, z], m.darkstone);
    }
    for (const x of [-3.45, 3.45]) {
      this.box(root, [3.3, 6.1, 0.05], [x, stairRise + 3.12, z], m.glass, { castShadow: false });
      for (const y of [0.07, 6.17]) this.box(root, [3.3, 0.1, 0.1], [x, stairRise + y, z], m.darkSteel);
    }
    this.box(root, [3.6, 0.02, 0.5], [0, 0.01, z + 0.2], m.steel, { castShadow: false });
    for (let step = 0; step < 11; step++) {
      const height = stairRise * (step + 1) / 11;
      this.box(root, [3.22, height, 0.4], [0, height / 2, 6.95 + step * 0.4], m.counter, { castShadow: false });
    }

    this.doors = [];
    for (const side of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(0, stairRise, z + 0.22);
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
    this.box(root, [31.4, 0.1, 26.8], [0, 8.88, -2.25], m.ceiling, { castShadow: false });
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
    const materials = this.m;
    const reception = new THREE.Group();
    reception.name = 'main-center-reception';
    reception.position.set(0, 0, CENTER_Z);
    reception.userData.counterSize = [6.76, 1.195, 2.38];
    root.add(reception);
    for (const radius of [4.45, 3.92]) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.008, 6, 96), materials.brass);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.004;
      reception.add(ring);
    }
    const counter = new THREE.Group();
    counter.name = 'stone-and-oak-reception-counter';
    reception.add(counter);
    this.rbox(counter, [5.9, 0.95, 0.34], 0.06, [0, 0.59, 0.64], materials.wood);
    this.rbox(counter, [6.76, 0.13, 0.79], 0.035, [0, 1.13, 0.56], materials.counter);
    this.box(counter, [5.65, 0.1, 0.26], [0, 0.09, 0.6], materials.darkSteel, { castShadow: false });
    this.box(counter, [5.6, 0.025, 0.035], [0, 0.165, 0.792], materials.ledWarm, { castShadow: false });
    this.box(counter, [5.85, 0.022, 0.025], [0, 1.048, 0.831], materials.brass, { castShadow: false });
    const slats = [];
    for (let index = 0; index < 42; index++) slats.push([0.035, 0.73, 0.035, -2.82 + index * 0.138, 0.64, 0.824]);
    this.instancedBoxes(counter, materials.wood, slats, { castShadow: false });
    for (const side of [-1, 1]) {
      this.rbox(counter, [0.52, 0.95, 1.84], 0.06, [side * 3.0, 0.59, -0.1], materials.counter);
      this.rbox(counter, [0.87, 0.13, 1.6], 0.035, [side * 2.93, 1.13, -0.625], materials.counter);
      this.box(counter, [0.025, 0.025, 1.35], [side * 3.22, 0.17, -0.12], materials.ledWarm, { castShadow: false });
      this.box(counter, [0.81, 0.52, 0.055], [side * 1.35, 1.2, -0.13], materials.darkSteel, { castShadow: false });
      this.box(counter, [0.045, 0.24, 0.045], [side * 1.35, 0.96, -0.13], materials.steel, { castShadow: false });
      this.box(counter, [0.38, 0.025, 0.26], [side * 1.35, 0.88, -0.13], materials.darkSteel, { castShadow: false });
      const chair = new THREE.Group();
      chair.name = 'reception-staff-chair';
      chair.position.set(side * 1.35, 0, -1.63);
      this.rbox(chair, [0.9, 0.17, 0.82], 0.06, [0, 0.53, 0], materials.leather);
      this.rbox(chair, [0.9, 0.79, 0.14], 0.06, [0, 1.0, -0.37], materials.leather);
      for (const arm of [-1, 1]) this.box(chair, [0.08, 0.09, 0.65], [arm * 0.44, 0.76, 0], materials.leather, { castShadow: false });
      this.box(chair, [0.08, 0.41, 0.08], [0, 0.29, 0], materials.steel, { castShadow: false });
      this.box(chair, [0.68, 0.05, 0.07], [0, 0.075, 0], materials.darkSteel, { castShadow: false });
      this.box(chair, [0.07, 0.05, 0.68], [0, 0.075, 0], materials.darkSteel, { castShadow: false });
      reception.add(chair);
    }
    this.box(counter, [5.0, 0.09, 1.1], [0, 0.81, -0.5], materials.wood);
    this.box(counter, [0.46, 0.02, 0.34], [0, 0.867, -0.8], materials.paper, { castShadow: false });
    this.sign(counter, 'AUTO HAUS GROUP', [0, 0.64, 0.86], 4.25, 0.54);
    this.contact(reception, 0, 0, 7.4, 3.2, { opacity: 0.22 });
    const backdrop = new THREE.Group();
    backdrop.name = 'reception-brand-and-enquiries-wall';
    this.box(backdrop, [5.95, 3.05, 0.22], [0, 1.64, -2.75], materials.darkstone);
    for (const side of [-1, 1]) {
      this.box(backdrop, [0.12, 2.8, 0.09], [side * 2.83, 1.63, -2.60], materials.wood, { castShadow: false });
      this.box(backdrop, [0.025, 2.65, 0.035], [side * 2.72, 1.61, -2.58], materials.ledWarm, { castShadow: false });
    }
    this.box(backdrop, [5.5, 0.035, 0.05], [0, 3.11, -2.58], materials.ledSoft, { castShadow: false });
    reception.add(backdrop);
    this.batchStaticMeshes(reception);
  }

  registerCameraColliders() {
    const add = (name, min, max, dynamic = false) => {
      this.cameraColliders.push({ name, bounds: new THREE.Box3(new THREE.Vector3(...min), new THREE.Vector3(...max)), dynamic });
    };
    add('west perimeter wall', [-16.35, 0, -20], [-15.25, 9.4, 15]);
    add('east perimeter wall', [15.25, 0, -20], [16.35, 9.4, 15]);
    add('rear perimeter wall', [-16.4, 0, -16.55], [16.4, 9.4, -15.35]);
    add('ceiling', [-16.2, 8.75, -16], [16.2, 9.45, 11.8]);
    add('upper building and roof', [-16.45, 8.92, -16.4], [16.45, 22.5, 12.72]);
    for (const side of [-1, 1]) add('black facade pier', [side * 6.3 - 1.03, 1.16, 11.295], [side * 6.3 + 1.03, 13.74, 12.545]);
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
    add('central reception counter', [-3.45, 0, -5.65], [3.45, 1.5, -3.16]);
    add('reception brand partition', [-3.05, 0, -7.05], [3.05, 3.3, -6.72]);
    for (const side of [-1, 1]) add('central reception staff chair', [side * 1.35 - 0.52, 0, -6.25], [side * 1.35 + 0.52, 1.55, -5.32]);
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
    const stagesStarted = performance.now();
    await wait(30);
    const build = async (name, job, secondary) => {
      const t = performance.now();
      try {
        const group = new THREE.Group();
        group.name = name;
        job(group);
        if (secondary) {
          this.batchStaticMeshes(group);
          this.deferredGroups.push(group);
        } else this.commit(group);
      } catch (error) {
        console.error(`Showroom stage (${name}) failed`, error);
      }
      this.timings[name] = Math.round(performance.now() - t);
      await wait(4);
    };
    // Geometry visible from the entrance is committed first; the entrance camera waits for it (with a cap).
    const interior = [
      ['district', (g) => buildDistrict(this, g)],
      ['wings', (g) => this.buildWings(g)],
      ['panels', (g) => this.buildPanels(g)],
      ['reception', (g) => this.buildReception(g)],
      ['lounge', (g) => this.buildLounge(g)],
      ['stair', (g) => this.buildStair(g)],
      ['plants', (g) => this.buildPlants(g)],
    ];
    let done = 0;
    for (const [name, job, secondary] of interior) {
      await build(name, job, secondary);
      done += 1;
      this.onLoadProgress?.('Furnishing the interior...', 10 + Math.round((done / interior.length) * 50));
    }
    for (const group of this.root.children) if (group.isGroup) this.batchStaticMeshes(group, true);
    this.batchStaticMeshes(this.root);
    this.timings.criticalScene = Math.round(performance.now() - stagesStarted);
    this.onLoadProgress?.('Preparing the lighting...', 96);
  }

  prepareSections() {
    if (this.sectionsReady) return Promise.resolve();
    if (this.sectionsLoading) return this.sectionsLoading;
    this.sectionsLoading = (async () => {
      await this.ready;
      const started = performance.now();
      for (const group of this.deferredGroups) {
        await new Promise((resolve) => {
          if ('requestIdleCallback' in window) requestIdleCallback(resolve, { timeout: 100 });
          else setTimeout(resolve, 0);
        });
        await this.compilePasses(group);
        this.uploadTextures(group);
        this.commit(group);
      }
      this.deferredGroups.length = 0;
      await this.prewarm();
      this._resolveInterior();
      this.onStage?.(2);
      this.sectionsReady = true;
      this.timings.backgroundSections = Math.round(performance.now() - started);
      this._resolveStages();
      this.onStage?.(3);
    })();
    return this.sectionsLoading;
  }

  prepareDecor() {
    return this.decorLoading ??= (async () => {
      await this.stagesReady;
      await new Promise((resolve) => {
        if ('requestIdleCallback' in window) requestIdleCallback(resolve, { timeout: 1000 });
        else setTimeout(resolve, 16);
      });
      // Building and committing block the main thread, so both wait for a still camera instead of landing mid-move.
      const still = () => new Promise((resolve) => {
        const check = () => (this.motion || this.transitioning || this.isIntroPlaying || this.tweens.size ? requestAnimationFrame(check) : resolve());
        check();
      });
      await still();
      const group = new THREE.Group();
      group.name = 'decor';
      this.buildDecor(group);
      await this.compilePasses(group);
      await still();
      // First use of a new program is a synchronous GPU round trip; pay it now rather than in the next frame.
      for (const program of this.renderer.info.programs) program.getUniforms();
      this.uploadTextures(group);
      this.commit(group);
    })();
  }

  async compilePasses(group) {
    if (!this.startupPreparing) {
      group = group.clone(true);
      const copies = new Map();
      const copy = (material) => {
        if (!copies.has(material)) {
          const prepared = material.clone();
          prepared.onBeforeCompile = material.onBeforeCompile;
          prepared.customProgramCacheKey = material.customProgramCacheKey;
          copies.set(material, prepared);
        }
        return copies.get(material);
      };
      group.traverse((object) => {
        if (object.material) object.material = Array.isArray(object.material) ? object.material.map(copy) : copy(object.material);
      });
      (this.compilationMaterials ??= []).push(...copies.values());
    }
    const renderer = this.renderer;
    const target = renderer.getRenderTarget();
    const toneMapping = renderer.toneMapping;
    this.linearCompileTarget ??= new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, colorSpace: THREE.LinearSRGBColorSpace });
    const prepare = (backFaces, linear = true) => {
      const materials = new Map();
      group.traverse((object) => {
        const material = object.material;
        if (backFaces && material?.transmission > 0) materials.set(material, material.side);
      });
      if (linear) {
        renderer.setRenderTarget(this.linearCompileTarget);
        renderer.toneMapping = THREE.NoToneMapping;
      }
      for (const material of materials.keys()) { material.side = THREE.BackSide; material.needsUpdate = true; }
      let pending;
      try {
        pending = renderer.compileAsync(group, this.camera, this.scene);
      } finally {
        for (const [material, side] of materials) { material.side = side; material.needsUpdate = true; }
        renderer.toneMapping = toneMapping;
        renderer.setRenderTarget(target);
      }
      return pending;
    };
    // The sun's shadow pass draws casters with depth variants compileAsync never sees; left alone, the first
    // shadow refresh after a commit links one synchronously (about 300 ms on an integrated GPU).
    const prepareShadows = () => {
      const flip = { [THREE.FrontSide]: THREE.BackSide, [THREE.BackSide]: THREE.FrontSide, [THREE.DoubleSide]: THREE.DoubleSide };
      const casters = new THREE.Group();
      const variants = new Set();
      group.traverse((object) => {
        if (!object.isMesh || !object.castShadow || object.isSkinnedMesh || object.isBatchedMesh) return;
        const materials = Array.isArray(object.material) ? object.geometry.groups.map((part) => object.material[part.materialIndex]) : [object.material];
        for (const material of materials) {
          const key = `${material?.id}:${object.isInstancedMesh}:${!!object.instanceColor}:${!!object.morphTexture}:${object.geometry.morphAttributes.position?.length ?? 0}`;
          if (!material?.visible || variants.has(key)) continue;
          variants.add(key);
          // Mirrors WebGLShadowMap's depth-material setup so these programs are the ones the shadow pass requests.
          const depth = Object.assign(new THREE.MeshDepthMaterial(), {
            side: material.shadowSide ?? flip[material.side],
            map: material.map, alphaMap: material.alphaMap, alphaTest: material.alphaToCoverage ? 0.5 : material.alphaTest,
            displacementMap: material.displacementMap, displacementScale: material.displacementScale, displacementBias: material.displacementBias,
            clipShadows: material.clipShadows, clippingPlanes: material.clippingPlanes, clipIntersection: material.clipIntersection, wireframe: material.wireframe,
          });
          (this.compilationMaterials ??= []).push(depth);
          casters.add(object.isInstancedMesh
            ? Object.assign(new THREE.InstancedMesh(object.geometry, depth, 0), { instanceColor: object.instanceColor, morphTexture: object.morphTexture })
            : new THREE.Mesh(object.geometry, depth));
        }
      });
      renderer.setRenderTarget(this.linearCompileTarget);
      // Shadow casters are drawn without the scene, so their programs carry no fog.
      const fog = this.scene.fog;
      this.scene.fog = null;
      try {
        return renderer.compileAsync(casters, this.camera, this.scene);
      } finally {
        this.scene.fog = fog;
        renderer.setRenderTarget(target);
      }
    };
    // Camera-side culling draws panes seen from behind as BackSide in the tone-mapped screen pass;
    // compiling that variant with the screen pass keeps it from compiling mid-move.
    await Promise.all([renderer.compileAsync(group, this.camera, this.scene), prepare(true, false), prepareShadows()]);
    await prepare(false);
    await prepare(true);
  }

  uploadTextures(group) {
    const textures = new Set();
    group.traverse((object) => {
      for (const material of object.material ? [].concat(object.material) : []) {
        for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
      }
    });
    for (const texture of textures) this.renderer.initTexture(texture);
  }

  // Uploads every texture and renders the shadows once so the entrance never pays first-use costs.
  async prewarm() {
    if (this.isIntroPlaying) return;
    const target = this.renderer.getRenderTarget();
    this.warmCamera ??= this.camera.clone();
    this.warmTarget ??= new THREE.WebGLRenderTarget(64, 64, { type: THREE.HalfFloatType, colorSpace: THREE.SRGBColorSpace });
    const uploadStarted = performance.now();
    this.uploadTextures(this.scene);
    this.timings[this.startupPreparing ? 'textureUploads' : 'backgroundTextureUploads'] = Math.round(performance.now() - uploadStarted);
    this.renderer.shadowMap.needsUpdate = this.startupPreparing;
    if (this.startupPreparing) this.shadowDirty = false;
    const frameStarted = performance.now();
    const hidden = this.root.children.filter((group) => !group.visible);
    const meshStates = [];
    const lodStates = [];
    try {
      if (this.startupPreparing && this.shaderWarmup) this.scene.add(this.shaderWarmup);
      for (const group of hidden) group.visible = true;
      this.renderer.setRenderTarget(this.warmTarget);
      this.warmCamera.position.set(24, 32, 35);
      this.warmCamera.lookAt(0, 10, 0);
      this.renderer.render(this.scene, this.warmCamera);
      this.scene.traverse((object) => {
        if (object.isMesh) {
          meshStates.push({ object, frustumCulled: object.frustumCulled });
          object.frustumCulled = false;
        }
        if (object.isLOD) {
          lodStates.push({ object, autoUpdate: object.autoUpdate, visible: object.levels.map(level => level.object.visible) });
          object.autoUpdate = false;
          for (const level of object.levels) level.object.visible = true;
        }
      });
      this.warmCamera.position.copy(this.camera.position);
      this.warmCamera.quaternion.copy(this.camera.quaternion);
      this.renderer.render(this.scene, this.warmCamera);
      this.warmCamera.position.set(0, 2.35, 4.7);
      this.warmCamera.lookAt(0, 2, -1.4);
      for (const { object } of this.glassPlanes) {
        object.material.side = THREE.BackSide;
        object.material.needsUpdate = true;
      }
      this.renderer.render(this.scene, this.warmCamera);
    } finally {
      this.updateCameraCulling();
      for (const { object, frustumCulled } of meshStates) object.frustumCulled = frustumCulled;
      for (const { object, autoUpdate, visible } of lodStates) {
        object.autoUpdate = autoUpdate;
        object.levels.forEach((level, index) => { level.object.visible = visible[index]; });
      }
      if (this.shaderWarmup) { this.scene.remove(this.shaderWarmup); this.shaderWarmup = null; }
      for (const group of hidden) group.visible = false;
      this.renderer.setRenderTarget(target);
    }
    if (this.startupPreparing) {
      const position = this.camera.position.clone();
      const rotation = this.camera.quaternion.clone();
      try {
        this.camera.position.set(0, 2.35, 4.7);
        this.camera.lookAt(0, 2, -1.4);
        this.updateCameraCulling();
        this.renderer.render(this.scene, this.camera);
      } finally {
        this.camera.position.copy(position);
        this.camera.quaternion.copy(rotation);
        this.updateCameraCulling();
      }
      this.renderer.render(this.scene, this.camera);
    }
    this.timings[this.startupPreparing ? 'prewarmFrame' : 'backgroundPrewarmFrame'] = Math.round(performance.now() - frameStarted);
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
    const brand = new THREE.Mesh(new THREE.PlaneGeometry(7.5, 2.5), this.screenMaterial(this.brandCanvas('AUTO HAUS GROUP', 'LEBANON', 7.5 / 2.5), 1));
    brand.position.set(0, 5.05, -15.09);
    g.add(brand);
    this.box(g, [5.8, 0.035, 0.035], [0, 3.45, -15.0], m.ledWarm, { castShadow: false });
    for (const x of [-10.5, -5.4, 5.4, 10.5]) this.box(g, [4.5, 2.9, 0.12], [x, 4.5, -15.4], m.board);

    this.digitalPanel(g, [-8.25, 3.4, -14.72], 0, 5.2, 2.75, 'SERVICES', ['Vehicle sales and trade-in', 'Financing · Inspection', 'Maintenance · After-sales']);
    this.digitalPanel(g, [8.25, 3.4, -14.72], 0, 5.2, 2.75, 'OUR STORY', ['Independent by nature · Since 1988', 'A considered collection', 'A personal welcome in Lebanon']);
    const contactScreen = this.digitalPanel(g, [8.4, 2.95, 9.58], Math.PI, 4.35, 1.95, 'CONTACT', ['Appointments & enquiries', 'Telephone  |  Email  |  Showroom hours']);
    contactScreen.name = 'contact-section-screen';
    this.sign(g, 'AUTO HAUS GROUP', [0, 2.3, CENTER_Z - 2.595], 4.6, 0.78);
    this.box(g, [3.65, 0.024, 0.035], [0, 1.65, CENTER_Z - 2.555], m.brass, { castShadow: false });
  }

  buildReception(g) {
    const m = this.m;
    this.box(g, [5.8, 4.4, 0.3], [8.4, 2.2, 9.85], m.board);
    this.box(g, [5.5, 0.04, 0.05], [8.4, 4.45, 9.6], m.ledSoft, { castShadow: false });

    const desk = new THREE.Group();
    desk.name = 'side-client-consultation-counter';
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

  get navigationLocked() {
    return this.isIntroPlaying || this.entering;
  }

  cameraCollisionAt(position) {
    if (position.y < 0.85) return { name: 'floor clearance' };
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

  // Glides along a pre-validated curve with a single frame-driven tween; no allocations or collision work per frame.
  followCameraPath(points, targetPosition, duration, onComplete, onProgress, ease = 'sine.inOut') {
    if (this.isIntroPlaying) return null;
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
    const endPosition = new THREE.Vector3(...points.at(-1));
    const startRotation = this.camera.quaternion.clone();
    const endRotation = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(endPosition, endLook, this.camera.up));
    this.motion = new FrameTween(duration, {
      ease,
      onUpdate: (t) => {
        curve.getPointAt(t, this.camera.position);
        this.lookTarget.lerpVectors(startLook, endLook, t);
        this.camera.quaternion.slerpQuaternions(startRotation, endRotation, t);
        this.updateCameraFraming();
        this.lastSafeCameraPosition.copy(this.camera.position);
        this.dirty = true;
        onProgress?.(t);
      },
      onComplete: () => {
        this.camera.position.copy(endPosition);
        this.lookTarget.copy(endLook);
        this.camera.quaternion.copy(endRotation);
        this.lastSafeCameraPosition.copy(this.camera.position);
        this.motion = null;
        this.dirty = true;
        onComplete?.(true);
      },
    });
    return this.motion;
  }

  // Slides a door along x in the frame loop; a newer slide replaces one still running.
  slideDoor(door, x, seconds, delay = 0) {
    door.slide?.kill();
    let from = null;
    door.slide = new FrameTween(seconds, {
      delay,
      ease: 'power2.inOut',
      onUpdate: (t) => {
        from ??= door.pivot.position.x;
        door.pivot.position.x = t === 1 ? x : from + (x - from) * t;
        this.dirty = true;
      },
    });
    this.tweens.add(door.slide);
    return door.slide;
  }

  createResizeHandling() {
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.canvas.parentElement);
    this.resize();
  }

  updateCameraFraming() {
    const width = this.viewportWidth ?? this.canvas.clientWidth;
    const interiorFov = width < 640 ? 54 : width < 960 ? 46 : 38;
    const exteriorFov = width < 640 ? Math.min(108, THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(32.5)) / this.camera.aspect))) : 50;
    const exterior = THREE.MathUtils.smoothstep(this.camera.position.z, 20, 32);
    const fov = THREE.MathUtils.lerp(interiorFov, exteriorFov, exterior);
    if (Math.abs(this.camera.fov - fov) < 0.025) return;
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
  }

  resize() {
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    if (!width || !height) return;
    this.viewportWidth = width;
    this.viewportHeight = height;
    this.camera.aspect = width / height;
    this.updateCameraFraming();
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
    this.applyPixelRatio();
  }

  applyPixelRatio() {
    this.basePixelRatio = Math.min(this.pixelRatio, this.viewportWidth < 640 ? 1.15 : this.maxPixelRatio);
    this.renderer.setPixelRatio(this.basePixelRatio * this.renderScale);
    this.post?.setSize(this.viewportWidth, this.viewportHeight, this.renderer.getPixelRatio());
    this.pace.settle = 2;
    this.dirty = true;
  }

  // A travel that starts from a still view first redraws that view at the travel resolution, so the buffers are
  // reallocated while the camera is at rest; the travel clock starts once that frame has left the GPU.
  beginTravel() {
    const moving = Boolean(this.motion) || this.isIntroPlaying;
    if (!moving || this.wasMoving || !this.viewportWidth) return false;
    this.wasMoving = true;
    this.motionCeiling = 1;
    this.motionGaps.length = 0;
    this.settleFrames = 2;
    // Before the first travel, full-resolution frames that all took over two refreshes to leave an idle GPU show that
    // travel at full resolution would fall below 30 FPS, so travel starts with fewer pixels instead of switching mid-move.
    // The fastest sample counts, because single frames can carry one-off uploads.
    const cost = this.motionScale === 1 && this.fullFrameCosts.length ? Math.min(...this.fullFrameCosts) : 0;
    if (cost > 34) this.motionScale = Math.max(Math.min(1, 0.75 / this.basePixelRatio), Math.round(Math.sqrt(28 / cost) * 20) / 20);
    if (this.motionScale === this.renderScale) return false;
    this.renderScale = this.motionScale;
    this.applyPixelRatio();
    this.resuming = true;
    return true;
  }

  // While the camera travels on a GPU that cannot keep it fluid (median frame over 40 ms), travel frames render fewer
  // pixels, down to 0.75 device pixels per CSS pixel. Every still view renders at full resolution.
  updateRenderScale(gap) {
    if (!this.dirty || !this.viewportWidth) return;
    const moving = Boolean(this.motion) || this.isIntroPlaying;
    if (moving && !this.wasMoving) {
      this.motionCeiling = 1;
      this.motionGaps.length = 0;
      this.settleFrames = 2;
    }
    this.wasMoving = moving;
    // Changes during travel or at its end apply at once: holding a moving camera for the reallocation would also show.
    const scale = moving ? this.motionScale : 1;
    if (scale !== this.renderScale) {
      this.renderScale = scale;
      this.applyPixelRatio();
      this.motionGaps.length = 0;
      this.settleFrames = 2;
      return;
    }
    if (!moving) return;
    // The first frames after a start or resize still carry the previous frame's cost.
    if (this.settleFrames > 0) {
      this.settleFrames--;
      return;
    }
    if (gap > 0 && gap < STALL_GAP) this.motionGaps.push(gap);
    if (this.motionGaps.length < 8) return;
    const sorted = this.motionGaps.sort((left, right) => left - right);
    const typical = (sorted[3] + sorted[4]) / 2;
    this.motionGaps.length = 0;
    const floor = Math.min(1, 0.75 / this.basePixelRatio);
    if (typical > 40 && this.motionScale > floor) {
      // Pixel cost scales with the square of the ratio; aim near 28 ms (about 35 FPS).
      this.motionCeiling = this.motionScale - 0.05;
      this.motionScale = Math.max(floor, Math.min(this.motionCeiling, Math.round(this.motionScale * Math.sqrt(28 / typical) * 20) / 20));
    } else if (typical < 22 && this.motionScale < this.motionCeiling) {
      this.motionScale = Math.min(this.motionCeiling, this.motionScale + 0.1);
    }
  }

  introduce(skip = false) {
    if (this.isIntroPlaying) return;
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (skip || reducedMotion) {
      this.cloudLayer.visible = false;
      this.exteriorWakeLights.forEach((light) => { light.intensity = 34; });
      this.camera.position.set(0, 2.5, 20);
      this.lookTarget.set(0, 6, 11);
      this.camera.lookAt(this.lookTarget);
      this.requestRender();
      this.fastEntrance = skip;
      this.enter();
      return;
    }
    this.startStory().then((started) => {
      if (!started) this.introduce(true);
      else document.getElementById('arrival-curtain').hidden = true;
    });
  }

  enter() {
    if (this.navigationLocked) return;
    this.entering = true;
    this.transitioning = true;
    this.currentDestination = 'home';
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const outsideStart = this.camera.position.toArray();
    const approach = outsideStart[2] > 22 ? [outsideStart, [0, 7, 28], [0, 2.5, 20]] : [outsideStart];
    const route = [...approach, [0, 2.72, 18], [0, 3.22, 15.7], [0, 3.82, 12.4], [0, 3.82, 10], [0, 2.35, 7], [0, 2.35, 4.7]];
    const finish = (safe) => {
      this.entering = false;
      this.transitioning = false;
      this.outside = false;
      this.fastEntrance = false;
      this.onEntered?.(Boolean(safe));
    };
    if (this.buildPath(route).blocked) {
      console.error('Entrance camera route is blocked');
      finish(false);
      return;
    }
    const openDoor = (door, x) => this.slideDoor(door, x, reducedMotion || this.fastEntrance ? 0.15 : 2.1, 0.15);
    this.entranceTweens = [openDoor(this.doors[0], -3.4), openDoor(this.doors[1], 3.4)];
    this.onEntranceProgress?.('Opening glass doors...', 24);
    this.skipEntrance = () => { this.entranceTweens.forEach((t) => t.timeScale(6)); this.motion?.timeScale(6); };
    this.prepareSections().then(() => wait(reducedMotion || this.fastEntrance ? 0 : 1100)).then(() => {
      this.followCameraPath(route, DESTINATIONS.home.target, reducedMotion || this.fastEntrance ? 0.2 : 5.2, (safe) => {
        finish(safe);
        if (safe) this.prepareDecor().catch((error) => console.warn('Background ornaments unavailable', error));
      }, (progress) => {
        const label = progress > 0.88 ? 'Almost ready...' : progress > 0.2 ? 'Entering showroom...' : 'Opening glass doors...';
        this.onEntranceProgress?.(label, Math.min(99, Math.round(24 + progress * 74)));
      });
    });
  }

  exit() {
    if (this.navigationLocked || this.transitioning || this.outside) return;
    this.transitioning = true;
    const route = [this.camera.position.toArray(), [0, 2.35, 7], [0, 2.35, 10], [0, 3.82, 12.4], [0, 3.22, 15.7], [0, 2.5, 20], [0, 5.2, 27], [0, 9.8, 39.5]];
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.followCameraPath(route, [0, 10.5, 11], reducedMotion ? 0.2 : 6.2, (safe) => {
      this.transitioning = false;
      this.outside = true;
      for (const door of this.doors) this.slideDoor(door, 0, reducedMotion ? 0.1 : 1.8);
      this.onExited?.(Boolean(safe));
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
    if (this.navigationLocked) return false;
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
    const duration = reducedMotion ? 0.2 : THREE.MathUtils.clamp(1.25 + plan.length * 0.125, 1.6, 3.1);
    this.followCameraPath(plan.points, route.target, duration, (safe) => {
      this.transitioning = false;
      onComplete?.(route, safe);
    });
    return true;
  }

  beginIntroQuality() {
    this.introRendering = true;
  }

  applyDistantGlazing(group) {
    group.traverse((object) => {
      if (object.material?.transmission > 0) {
        this.introGlassMeshes.set(object, object.material);
        object.material = this.distantGlass;
      }
    });
  }

  setDistantGlazing(active) {
    if (active === this.distantGlazingActive) return;
    this.distantGlazingActive = active;
    if (active) this.applyDistantGlazing(this.root);
    else {
      for (const [mesh, material] of this.introGlassMeshes) mesh.material = material;
      this.introGlassMeshes.clear();
    }
  }

  updateIntroQuality() {}

  finishIntroQuality() {
    this.setDistantGlazing(false);
    this.introRendering = false;
    this.cloudLayer.visible = false;
    for (const name of ['furnished-upper-showrooms', 'panels', 'reception', 'lounge']) {
      const group = this.scene.getObjectByName(name);
      if (group) group.visible = true;
    }
  }

  adaptQuality(now) {
    const t = this.frameTimes;
    if (this.introRendering) { t.last = now; return; }
    if (!this.entering && !this.transitioning) {
      t.last = now;
      t.checked = now;
      return;
    }
    const dt = now - t.last;
    t.last = now;
    if (document.hidden) { t.checked = now; return; }
    if (dt < 250) t.average = t.average * 0.94 + dt * 0.06;
    if (now - t.checked < 500) return;
    t.checked = now;
    if (t.average > 30) this.post?.setQuality(true);
    else if (t.average < 18) this.post?.setQuality(false);
  }

  render() {
    this.renderFrame();
  }

  // Frame pacing. Frames are drawn on a steady cadence of whole display refreshes with at most two still on the GPU, so
  // the CPU prepares one frame while the GPU draws the previous one. Without a limit the browser queued several frames
  // ahead of a slow GPU and then blocked, which showed as slow motion followed by jumps.
  frameDue(time) {
    const pace = this.pace;
    // The display refresh interval: the lower quartile of the last 30 callback gaps, so one odd gap changes nothing.
    const gap = pace.lastCallback === null ? 0 : time - pace.lastCallback;
    pace.lastCallback = time;
    if (gap > 3 && gap < 100) {
      pace.gaps[pace.gapCount++] = gap;
      if (pace.gapCount === pace.gaps.length) {
        pace.refresh = pace.gaps.sort()[7];
        pace.gapCount = 0;
      }
    }
    const gl = this.renderer.getContext();
    const now = performance.now();
    while (this.inFlight.length) {
      const frame = this.inFlight[0];
      const done = gl.getSyncParameter(frame.fence, gl.SYNC_STATUS) === gl.SIGNALED;
      if (!done && now - frame.time < 1000) break;
      // A frame that left the GPU a refresh before the next one was due shows that a shorter cadence would hold.
      if (done && frame.drawn !== null && time - frame.drawn < (pace.cadence - 0.5) * pace.refresh) pace.fast++;
      if (done && frame.full) {
        this.fullFrameCosts.push(time - frame.drawn);
        if (this.fullFrameCosts.length > 5) this.fullFrameCosts.shift();
      }
      gl.deleteSync(frame.fence);
      this.inFlight.shift();
    }
    if (pace.lastDraw !== null && time - pace.lastDraw < (pace.cadence - 0.5) * pace.refresh) return false;
    if (this.inFlight.length < 2 && !(this.resuming && this.inFlight.length)) return true;
    // A frame is due but the GPU is still two frames behind.
    if (!pace.late && this.inFlight.length >= 2) {
      pace.late = true;
      pace.misses++;
    }
    return false;
  }

  drawFrame(time) {
    if (this.renderFrame(time)) this.paceFrame(time);
  }

  // Lengthens the cadence when the GPU falls behind twice within ten frames, and shortens it when three of those frames
  // left the GPU a refresh early. A shorter cadence that failed is not tried again for 15 s, then 30, up to 2 minutes.
  paceFrame(time) {
    const pace = this.pace;
    const elapsed = pace.lastDraw === null ? Infinity : time - pace.lastDraw;
    pace.lastDraw = time;
    pace.late = false;
    // Only consecutive frames of an animation show what the GPU sustains. Frames after a resolution or cadence change
    // still carry the reallocation, the frames queued before it or a GPU clock that has not risen yet.
    if (elapsed > (pace.cadence + 3) * pace.refresh || pace.settle > 0) {
      pace.settle = Math.max(0, pace.settle - 1);
      pace.draws = pace.fast = pace.misses = 0;
      return;
    }
    pace.draws++;
    if (pace.misses >= 2) {
      if (pace.lowered) {
        pace.backoff = Math.min(120000, pace.backoff * 2);
        pace.floor = pace.cadence + 1;
        pace.floorUntil = time + pace.backoff;
      }
      // No longer than about 33 ms: a GPU slower than that draws as many frames as it can, with two on the GPU at most.
      pace.cadence = Math.min(Math.max(1, Math.floor(35 / pace.refresh)), pace.cadence + 1);
      pace.lowered = false;
      pace.settle = 2;
    } else if (pace.draws >= 10) {
      pace.lowered = pace.misses === 0 && pace.fast >= 3 && pace.cadence > (time < pace.floorUntil ? pace.floor : 1);
      if (pace.lowered) {
        pace.cadence--;
        pace.settle = 3;
      }
    } else return;
    pace.draws = pace.fast = pace.misses = 0;
  }

  // Renders only when something changed; the scene is static between camera moves, so idle frames cost nothing.
  renderFrame(time = null) {
    if (this.startupPreparing || document.hidden) return false;
    const now = performance.now();
    this.adaptQuality(now);
    if (!this.dirty) return false;
    this.dirty = false;
    if (this.shadowDirty && !this.introRendering && now - this.lastShadow > 500) {
      this.renderer.shadowMap.needsUpdate = true;
      this.shadowDirty = false;
      this.lastShadow = now;
    }
    this.updateCameraCulling();
    if (this.post && !this.introRendering) {
      try {
        this.post.render();
      } catch (error) {
        console.warn('Post-processing disabled', error);
        this.post = null;
        this.renderer.setRenderTarget(null);
        this.renderer.render(this.scene, this.camera);
      }
    } else this.renderer.render(this.scene, this.camera);
    const gl = this.renderer.getContext();
    const full = time !== null && this.renderScale === 1 && this.inFlight.length === 0;
    this.inFlight.push({ fence: gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0), time: performance.now(), drawn: time, full });
    if (this.shadowDirty && !this.introRendering) this.dirty = true;
    return true;
  }

  dispose() {
    cancelAnimationFrame(this.animationFrame);
    this.motion?.kill();
    this.tweens.clear();
    this.introTimeline?.kill();
    this.story?.dispose();
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    this.warmTarget?.dispose();
    this.linearCompileTarget?.dispose();
    this.frameRenderer?.dispose();
    this.distantGlass.dispose();
    this.compilationMaterials?.forEach((material) => material.dispose());
    this.resizeObserver.disconnect();
    this.renderer.dispose();
  }
}

export { DESTINATIONS };
