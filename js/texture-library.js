import * as THREE from 'three';
import { SPECS, surfaceJob } from './textures.js';

const ORDER = ['floor', 'wood', 'concrete', 'paving', 'leather', 'counter', 'board', 'fabric', 'darkstone', 'brushed', 'soil'];

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
  constructor(renderer) {
    this.aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    this.sets = {};
    this.onChange = null;
    for (const [name, spec] of Object.entries(SPECS)) {
      const c = runSync(surfaceJob(spec.kind, spec.quick, spec.P, spec.normal));
      this.sets[name] = { map: this._tex(toCanvas(c.size, c.color), true), rough: this._tex(toCanvas(c.size, c.rough), false), normal: this._tex(toCanvas(c.size, c.normal), false) };
    }
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
