import * as THREE from 'three';
import { SPECS, surfaceJob } from './textures.js';

const ORDER = ['floor', 'wood', 'concrete', 'asphalt', 'paving', 'leather', 'counter', 'board', 'fabric', 'darkstone', 'brushed', 'soil'];

function runSync(job) {
  let r = job.next();
  while (!r.done) r = job.next();
  return r.value;
}

function toCanvas(size, data) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(data), size, size), 0, 0);
  return canvas;
}

// Small textures are generated synchronously for the first frame; full-size ones are generated in workers and swapped in.
export class TextureLibrary {
  constructor(renderer, { maxSize = 1024 } = {}) {
    this.aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    this.maxSize = Math.min(maxSize, renderer.capabilities.maxTextureSize);
    this.sets = {};
    this.assetCache = new Map();
    this.onChange = null;
    for (const [name, spec] of Object.entries(SPECS)) {
      const c = runSync(surfaceJob(spec.kind, spec.quick, spec.P, spec.normal));
      this.sets[name] = { map: this._tex(toCanvas(c.size, c.color), true), rough: this._tex(toCanvas(c.size, c.rough), false), normal: this._tex(toCanvas(c.size, c.normal), false) };
    }
  }

  cachedAsset(url, load) {
    const key = new URL(url, document.baseURI).href;
    if (!this.assetCache.has(key)) this.assetCache.set(key, load(key).catch((error) => { this.assetCache.delete(key); throw error; }));
    return this.assetCache.get(key);
  }

  loadImage(url) {
    return this.cachedAsset(url, (key) => new Promise((resolve, reject) => {
      const existing = [...document.images].find((image) => (image.currentSrc || image.src) === key);
      const image = existing ?? new Image();
      if (existing?.complete && existing.naturalWidth) { resolve(existing); return; }
      image.addEventListener('load', () => resolve(image), { once: true });
      image.addEventListener('error', reject, { once: true });
      if (!existing) image.src = key;
    }));
  }

  loadExternalMaps(onProgress) {
    return this.externalMapsReady ??= this._loadExternalMaps(onProgress);
  }

  async _loadExternalMaps(onProgress) {
    const manager = new THREE.LoadingManager();
    manager.onProgress = (_url, loaded, total) => onProgress?.(loaded, total);
    const loader = new THREE.TextureLoader(manager);
    const files = [
      ['asphalt', 'map', 'assets/materials/asphalt-color.webp', THREE.SRGBColorSpace],
      ['asphalt', 'normal', 'assets/materials/asphalt-normal.webp', THREE.NoColorSpace],
      ['asphalt', 'rough', 'assets/materials/asphalt-arm.webp', THREE.NoColorSpace],
      ['wood', 'map', 'assets/materials/oak-color.webp', THREE.SRGBColorSpace],
      ['wood', 'normal', 'assets/materials/oak-normal.webp', THREE.NoColorSpace],
      ['wood', 'rough', 'assets/materials/oak-arm.webp', THREE.NoColorSpace],
      ['wood', 'ao', 'assets/materials/oak-ao.webp', THREE.NoColorSpace],
    ];
    const results = await Promise.allSettled(files.map(async ([set, key, url, colorSpace]) => {
      const source = this.maxSize <= 1024 && key === 'map' ? url.replace('.webp', '-1k.webp') : url;
      const texture = await this.cachedAsset(source, (key) => loader.loadAsync(key));
      const image = texture.image;
      const scale = Math.min(1, this.maxSize / Math.max(image.width, image.height));
      if (scale < 1 && typeof createImageBitmap === 'function') {
        const bitmap = await createImageBitmap(image, { resizeWidth: Math.round(image.width * scale), resizeHeight: Math.round(image.height * scale), resizeQuality: 'high', imageOrientation: 'flipY', colorSpaceConversion: 'none', premultiplyAlpha: 'none' }).catch(() => null);
        if (bitmap) { texture.image = bitmap; texture.flipY = false; }
      }
      return { set, key, colorSpace, texture };
    }));
    const failed = results.filter((result) => result.status === 'rejected');
    if (failed.length) {
      results.filter((result) => result.status === 'fulfilled').forEach((result) => { result.value.texture.image.close?.(); result.value.texture.dispose(); });
      throw new Error(`${failed.length} critical PBR texture(s) failed to load`);
    }
    const loaded = results.map((result) => result.value);

    for (const { set, key, colorSpace, texture } of loaded) {
      const target = key === 'ao' ? texture : this.sets[set][key];
      if (key !== 'ao') target.dispose();
      target.image = texture.image;
      target.flipY = texture.flipY;
      target.colorSpace = colorSpace;
      target.wrapS = target.wrapT = THREE.RepeatWrapping;
      target.minFilter = THREE.LinearMipmapLinearFilter;
      target.magFilter = THREE.LinearFilter;
      target.generateMipmaps = true;
      target.anisotropy = this.aniso;
      target.needsUpdate = true;
      if (key === 'ao') this.sets[set].ao = target;
      else texture.dispose();
    }
    this.onChange?.('external PBR maps');
  }

  _tex(canvas, srgb) {
    const t = new THREE.CanvasTexture(canvas);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.anisotropy = this.aniso;
    return t;
  }

  _apply({ name, size, color, rough, normal }) {
    const set = this.sets[name];
    for (const [key, data] of [['map', color], ['rough', rough], ['normal', normal]]) {
      const t = set[key];
      t.dispose();
      t.image = toCanvas(size, data);
      t.needsUpdate = true;
    }
    this.onChange?.(name);
  }

  upgrade() {
    const count = Math.max(1, Math.min(3, (navigator.hardwareConcurrency || 4) - 1));
    const queue = [...ORDER];
    return new Promise((resolve) => {
      let running = 0;
      const workers = [];
      const finish = () => {
        workers.forEach((w) => w.terminate());
        resolve();
      };
      const next = (worker) => {
        const name = queue.shift();
        if (!name) {
          running -= 1;
          if (running === 0) finish();
          return;
        }
        worker.postMessage({ name });
      };
      try {
        for (let i = 0; i < count; i++) {
          const worker = new Worker(new URL('./texture-worker.js', import.meta.url), { type: 'module' });
          workers.push(worker);
          running += 1;
          worker.onmessage = ({ data }) => {
            this._apply(data);
            next(worker);
          };
          worker.onerror = (event) => {
            console.warn('Texture worker failed, keeping the compact textures', event.message);
            worker.terminate();
            running -= 1;
            if (running === 0) finish();
          };
          next(worker);
        }
      } catch (error) {
        console.warn('Texture workers unavailable', error);
        finish();
      }
    });
  }
}
