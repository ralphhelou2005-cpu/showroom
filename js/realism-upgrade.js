// realism-upgrade.js: drop into js/ next to showroom.js.
// Untested against your live scene (I can't run a browser here), so change one thing at a time.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

/* 1. Renderer: filmic tone mapping instead of Neutral @ 0.68 (which looks flat and dim). */
export function upgradeRenderer(renderer) {
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.85; // tune 0.7 to 1.1
  renderer.outputColorSpace = THREE.SRGBColorSpace;
}

/* 2. Post-processing: MSAA'd HDR target, ambient occlusion, subtle bloom, tone mapping in OutputPass.
      Replace every `renderer.render(scene, camera)` with `this.post.render()`. */
export function createPostProcessing(showroom) {
  const { renderer, scene, camera } = showroom;
  const size = renderer.getSize(new THREE.Vector2());
  const pr = renderer.getPixelRatio();
  const target = new THREE.WebGLRenderTarget(size.x * pr, size.y * pr, { type: THREE.HalfFloatType, samples: 2 });
  const composer = new EffectComposer(renderer, target);
  composer.setPixelRatio(pr);
  composer.setSize(size.x, size.y);

  composer.addPass(new RenderPass(scene, camera));

  const gtao = new GTAOPass(scene, camera, size.x, size.y);
  gtao.updateGtaoMaterial({ radius: 0.5, distanceExponent: 1.5, thickness: 1, scale: 1, samples: 8 });
  gtao.blendIntensity = 0.68;
  composer.addPass(gtao);

  // Threshold above 1 so only genuinely bright things (LEDs, sun glints on paint) glow.
  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.12, 0.6, 1.35);
  composer.addPass(bloom);

  composer.addPass(new OutputPass()); // applies renderer.toneMapping + sRGB

  return {
    composer, gtao, bloom,
    render: () => composer.render(),
    setSize(w, h, pixelRatio) { composer.setPixelRatio(pixelRatio); composer.setSize(w, h); },
    // Call from adaptQuality() when the GPU struggles.
    setQuality(low) { gtao.enabled = !low; bloom.enabled = !low; },
  };
}

/* 3. Real HDRI for lighting + reflections (e.g. a Poly Haven "studio" or "showroom" .hdr, 2K).
      Replaces the procedural buildEnvironmentMap(); keep the sky dome for the background. */
export async function loadHDRI(showroom, url, intensity = 1) {
  let Loader;
  try { Loader = (await import('three/addons/loaders/HDRLoader.js')).HDRLoader; }
  catch { Loader = (await import('three/addons/loaders/RGBELoader.js')).RGBELoader; }
  const tex = await new Loader().loadAsync(url);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  const pmrem = new THREE.PMREMGenerator(showroom.renderer);
  showroom.scene.environment = pmrem.fromEquirectangular(tex).texture;
  showroom.scene.environmentIntensity = intensity;
  tex.dispose();
  pmrem.dispose();
  showroom.requestRender();
}

/* 4. Metallic car paint: clearcoat over a flaked base. */
function flakeNormalMap() {
  const s = 512;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  g.fillStyle = 'rgb(128,128,255)';
  g.fillRect(0, 0, s, s);
  for (let i = 0; i < 9000; i++) {
    g.fillStyle = `rgb(${128 + (Math.random() - 0.5) * 70},${128 + (Math.random() - 0.5) * 70},255)`;
    g.fillRect(Math.random() * s, Math.random() * s, 1 + Math.random() * 1.5, 1 + Math.random() * 1.5);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(6, 6);
  return t;
}

export function createCarPaint(color = '#8a0f14') {
  return new THREE.MeshPhysicalMaterial({
    color, metalness: 0.85, roughness: 0.32,
    clearcoat: 1, clearcoatRoughness: 0.035,
    normalMap: flakeNormalMap(), normalScale: new THREE.Vector2(0.15, 0.15),
    envMapIntensity: 1.2,
  });
}

/* 5. Load a .glb car, fix its materials, drop it on the floor with a contact shadow.
      Example: await loadCar(this, 'assets/models/car.glb', { position: [0, 0, -4.15], color: '#0b1d3a' }) */
export async function loadCar(showroom, url, { position = [0, 0, 0], rotationY = 0, scale = 1, color = '#8a0f14' } = {}) {
  const draco = new DRACOLoader().setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.185.0/examples/jsm/libs/draco/gltf/');
  const loader = new GLTFLoader().setDRACOLoader(draco);
  const gltf = await loader.loadAsync(url);
  const car = gltf.scene;
  // Ground the model: wheels on y = 0, centred on its own origin, so `position` is where the car actually sits.
  const bounds = new THREE.Box3().setFromObject(car);
  const centre = bounds.getCenter(new THREE.Vector3());
  car.position.set(-centre.x, -bounds.min.y, -centre.z);
  // A fixed colour repaints the body; with no colour the model's own body colour is kept but gets clearcoat paint.
  const fixedPaint = color ? createCarPaint(color) : null;
  const paintCache = new Map();
  const paintFor = (m) => {
    if (fixedPaint) return fixedPaint;
    if (!paintCache.has(m)) paintCache.set(m, createCarPaint(m.color ?? '#808080'));
    return paintCache.get(m);
  };

  car.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.receiveShadow = true;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    mats.forEach((m, i) => {
      const n = (m.name || '').toLowerCase();
      let next = m;
      if (/body|paint|carpaint|exterior/.test(n)) next = paintFor(m);
      else if (/glass|window|windshield/.test(n)) {
        next = new THREE.MeshPhysicalMaterial({ color: '#1a2326', metalness: 0, roughness: 0.02, transparent: true, opacity: 0.35, envMapIntensity: 2.5, depthWrite: false });
      } else if (/tire|tyre|rubber/.test(n)) { m.roughness = 0.85; m.metalness = 0; }
      else if (/chrome|rim|wheel|metal/.test(n)) { m.metalness = 1; m.roughness = Math.min(m.roughness ?? 0.2, 0.2); }
      if (Array.isArray(o.material)) o.material[i] = next; else o.material = next;
    });
  });

  // Soft contact shadow so the car doesn't float.
  const dims = bounds.getSize(new THREE.Vector3());
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(128, 128, 10, 128, 128, 128);
  grad.addColorStop(0, 'rgba(0,0,0,0.75)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(dims.x * 1.25, dims.z * 1.25),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.01;

  const group = new THREE.Group();
  group.add(car, shadow);
  group.position.set(...position);
  group.rotation.y = rotationY;
  group.scale.setScalar(scale);
  showroom.root.add(group);
  showroom.shadowDirty = true;
  showroom.requestRender();
  const setColor = (hex) => {
    const targets = fixedPaint ? [fixedPaint] : [...paintCache.values()];
    targets.forEach((p) => p.color.set(hex));
    showroom.requestRender();
  };
  return { group, setColor };
}

/* 6. Material tweaks for materials.js: glossier floor and glass that reflects the room. */
export function upgradeMaterials(m) {
  m.floor.roughness = 1;
  m.floor.envMapIntensity = 0.65;
}
