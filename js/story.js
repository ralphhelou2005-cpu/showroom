import * as THREE from 'three';
import { uiIcon } from './content-utils.js';

const DURATION = 18;
const P_DOORS = [0.54, 0.68];

const CHAPTERS = [
  { from: 0.0, to: 0.26, no: '01', title: 'AUTO HAUS GROUP', line: 'Lebanon.' },
  { from: 0.26, to: 0.48, no: '02', title: 'The house', line: 'A considered collection.' },
  { from: 0.48, to: 0.68, no: '03', title: 'Arrival', line: 'Independent by nature. Since 1988.' },
  { from: 0.68, to: 1.01, no: '04', title: 'Welcome', line: 'Come on in.' },
];

const ARRIVAL_POSITIONS = [[22, 104, 38], [23, 80, 39], [22, 62, 39], [20, 46, 38], [15, 30, 36], [6, 18, 35], [0, 10, 32], [0, 5, 26], [0, 2.5, 20], [0, 2.72, 18], [0, 3.22, 15.7], [0, 3.82, 12.4], [0, 3.82, 10], [0, 2.35, 7], [0, 2.35, 4.7]];
const ARRIVAL_LOOKS = [[0, 80, -70], [0, 52, -18], [0, 33, -8], [0, 16, -3], [0, 9, 1], [0, 9, 4], [0, 7, 8], [0, 5, 9], [0, 4, 11], [0, 3.5, 8], [0, 3, 5], [0, 2.2, 2], [0, 2, -1.4], [0, 1.9, -1.4], [0, 1.9, -1.4]];

const clamp = THREE.MathUtils.clamp;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const vec = (p) => new THREE.Vector3(...p);

const STYLE = `
.story-hud{position:absolute;inset:0;z-index:6;pointer-events:none;color:#f3efe6;font-family:'Manrope','DM Sans',system-ui,sans-serif;transition:opacity .8s;background:linear-gradient(0deg,rgba(8,10,9,.5),transparent 40%)}
.story-hud.is-leaving{opacity:0}
.story-logo{position:absolute;left:5.2%;top:30px;height:22px;opacity:.95}
.story-chapter{position:absolute;left:5.2%;bottom:15%;max-width:min(540px,84vw);opacity:0;transform:translateY(14px);transition:opacity .7s,transform .7s;text-shadow:0 2px 26px rgba(0,0,0,.55)}
.story-chapter.is-on{opacity:1;transform:none}
.story-chapter .no{display:block;margin-bottom:14px;color:#d4b97e;font-size:11px;font-weight:600;letter-spacing:.32em;text-transform:uppercase}
.story-chapter h2{margin:0 0 12px;font:500 42px/1.08 'Playfair Display',Georgia,serif;letter-spacing:0}
.story-chapter p{margin:0;font-size:14px;letter-spacing:0;opacity:.85}
.story-rail{position:absolute;right:28px;top:50%;width:2px;height:min(38vh,320px);transform:translateY(-50%);background:rgba(243,239,230,.25)}
.story-rail i{position:absolute;left:0;top:0;width:100%;height:0;background:#d4b97e}
.story-hint{position:absolute;left:50%;bottom:30px;display:flex;gap:10px;align-items:center;transform:translateX(-50%);font-size:11px;font-weight:600;letter-spacing:.3em;text-transform:uppercase;transition:opacity .5s;text-shadow:0 1px 14px rgba(0,0,0,.6)}
.story-hint b{display:inline-block;animation:story-bob 1.6s ease-in-out infinite}
@keyframes story-bob{50%{transform:translateY(6px)}}
.story-wait{position:absolute;left:50%;bottom:64px;transform:translateX(-50%);font-size:11px;letter-spacing:.24em;text-transform:uppercase;opacity:0;transition:opacity .4s}
.story-wait.is-on{opacity:.9}
.story-skip{position:absolute;right:5.2%;bottom:26px;pointer-events:auto;padding:10px 16px;border:1px solid rgba(243,239,230,.4);background:rgba(10,12,11,.35);color:inherit;font:600 11px 'Manrope',sans-serif;letter-spacing:.24em;cursor:pointer;backdrop-filter:blur(6px)}
.story-skip:hover{border-color:#d4b97e;color:#d4b97e}
@media(max-width:640px){.story-chapter{bottom:19%}.story-chapter h2{font-size:32px}.story-rail{right:14px}.story-logo{top:22px;height:18px}}
`;

export class ScrollStory {
  constructor(showroom, home) {
    this.showroom = showroom;
    this.target = 0;
    this.current = 0;
    this.lastApplied = -1;
    this.fast = false;
    this.wantEnd = false;
    this.elapsed = 0;
    this.skipElapsed = 0;
    this.skipStart = 0;
    this.done = false;
    this.interiorReady = false;
    this.chapterIndex = -2;
    this.finalPosition = vec(home.position);
    this.finalLook = vec(home.target);
    const positions = ARRIVAL_POSITIONS.map(vec);
    const targets = ARRIVAL_LOOKS.map(vec);
    positions.at(-1).copy(this.finalPosition);
    targets.at(-1).copy(this.finalLook);
    this.positionCurve = new THREE.CatmullRomCurve3(positions, false, 'centripetal');
    this.lookCurve = new THREE.CatmullRomCurve3(targets, false, 'centripetal');
    this.orientationSteps = 1200;
    this.orientations = [];
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const target = new THREE.Vector3();
    for (let index = 0; index <= this.orientationSteps; index++) {
      this.positionCurve.getPoint(index / this.orientationSteps, position);
      this.lookCurve.getPoint(index / this.orientationSteps, target);
      matrix.lookAt(position, target, showroom.camera.up);
      this.orientations.push(new THREE.Quaternion().setFromRotationMatrix(matrix));
    }
    showroom.interiorReady?.then(() => { this.interiorReady = true; });
  }

  begin() {
    const s = this.showroom;
    if (s.isIntroPlaying || s.entering || s.transitioning) return false;
    const safety = s.pathHit(this.positionCurve.getPoints(1800));
    if (!safety.safe) {
      console.error('Arrival path blocked', safety);
      return false;
    }
    s.isIntroPlaying = true;
    s.entering = true;
    s.transitioning = true;
    s.motion?.kill();
    s.motion = null;
    s.animationTime = performance.now();
    s.beginIntroQuality();
    s.skipEntrance = () => this.skip();
    s.setTimeOfDay?.(0.18);
    this.apply(0);
    this.mount();
    s.prepareSections().catch((error) => console.error('Intro background preparation failed', error));
    return true;
  }

  cap() { return this.interiorReady ? 1 : 0.22; }

  skip() {
    if (this.wantEnd) return;
    this.fast = true;
    this.wantEnd = true;
    this.skipStart = this.current;
    this.skipElapsed = 0;
    this.target = this.cap();
  }

  update(deltaMs) {
    if (this.done || document.hidden) return;
    if (!this.interiorReady) { this.updateHud(); return; }
    const dt = Math.max(0, deltaMs) / 1000;
    if (this.wantEnd) {
      this.skipElapsed += dt;
      this.target = 1;
      this.current = 1 - (1 - this.skipStart) * Math.exp(-3 * this.skipElapsed);
    } else {
      this.elapsed += dt;
      const drivenTime = Math.min(this.elapsed, DURATION);
      this.target = Math.min(this.cap(), this.elapsed / DURATION);
      const lag = -Math.expm1(-5 * drivenTime) / (5 * DURATION);
      this.current = this.target - lag * Math.exp(-5 * Math.max(0, this.elapsed - DURATION));
    }
    if (this.current !== this.lastApplied) {
      this.apply(this.current);
      this.lastApplied = this.current;
    }
    this.updateHud();
    if (this.current >= 0.9985 && this.target >= 1) this.finish();
  }

  apply(progress) {
    const s = this.showroom;
    const eased = smooth(0, 1, progress);
    this.positionCurve.getPoint(eased, s.camera.position);
    this.lookCurve.getPoint(eased, s.lookTarget);
    if (progress === 1) {
      s.camera.position.copy(this.finalPosition);
      s.lookTarget.copy(this.finalLook);
    }
    const sample = eased * this.orientationSteps;
    const index = Math.min(this.orientationSteps - 1, Math.floor(sample));
    s.camera.quaternion.slerpQuaternions(this.orientations[index], this.orientations[index + 1], sample - index);
    s.updateCameraFraming();
    s.lastSafeCameraPosition.copy(s.camera.position);

    const doors = smooth(P_DOORS[0], P_DOORS[1], progress);
    if (s.doors) {
      s.doors[0].pivot.position.x = -3.4 * doors;
      s.doors[1].pivot.position.x = 3.4 * doors;
    }
    s.updateClouds?.(progress);
    s.updateIntroQuality(progress);
    s.setTimeOfDay?.(0.18 + smooth(0.25, 0.9, progress) * 0.17);
    s.dirty = true;
  }

  finish() {
    if (this.done) return;
    this.done = true;
    this.current = 1;
    this.target = 1;
    this.lastApplied = 1;
    const s = this.showroom;
    this.apply(1);
    s.finishIntroQuality();
    s.lastSafeCameraPosition.copy(s.camera.position);
    s.isIntroPlaying = false;
    s.entering = false;
    s.transitioning = false;
    s.outside = false;
    s.fastEntrance = false;
    s.currentDestination = 'home';
    s.dirty = true;
    s.prepareDecor().catch((error) => console.warn('Background ornaments unavailable', error));
    this.hud.classList.add('is-leaving');
    setTimeout(() => { this.hud.remove(); this.styleTag.remove(); }, 900);
    s.onEntered?.(true);
  }

  dispose() {
    this.done = true;
    this.showroom.isIntroPlaying = false;
    this.hud?.remove();
    this.styleTag?.remove();
  }

  mount() {
    this.styleTag = document.createElement('style');
    this.styleTag.textContent = STYLE;
    document.head.append(this.styleTag);
    const hud = document.createElement('div');
    hud.className = 'story-hud';
    hud.setAttribute('role', 'region');
    hud.setAttribute('aria-label', 'Showroom arrival introduction');
    hud.innerHTML = `
      <img class="story-logo" src="${this.showroom.logoURL}" alt="" />
      <div class="story-chapter" id="story-chapter"><span class="no"></span><h2></h2><p></p></div>
      <div class="story-rail"><i></i></div>
      <button class="story-skip" type="button">SKIP ${uiIcon()}</button>`;
    (document.getElementById('showroom-app') ?? document.body).append(hud);
    this.hud = hud;
    this.chapterEl = hud.querySelector('.story-chapter');
    this.railFill = hud.querySelector('.story-rail i');
    hud.querySelector('.story-skip').addEventListener('click', () => this.skip());
  }

  updateHud() {
    const progress = this.current;
    this.railFill.style.height = `${(progress * 100).toFixed(1)}%`;
    const index = CHAPTERS.findIndex((chapter) => progress >= chapter.from && progress < chapter.to);
    if (index === this.chapterIndex) return;
    this.chapterIndex = index;
    this.chapterEl.classList.remove('is-on');
    if (index < 0) return;
    const chapter = CHAPTERS[index];
    setTimeout(() => {
      if (this.chapterIndex !== index) return;
      this.chapterEl.querySelector('.no').textContent = `${chapter.no} / 0${CHAPTERS.length}`;
      this.chapterEl.querySelector('h2').textContent = chapter.title;
      this.chapterEl.querySelector('p').textContent = chapter.line;
      this.chapterEl.classList.add('is-on');
    }, 260);
  }
}
