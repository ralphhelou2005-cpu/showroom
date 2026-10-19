import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, resolve, sep } from 'node:path';
import sharp from 'sharp';
import { chromium } from 'playwright-core';

const materialNames = ['asphalt-color', 'asphalt-normal', 'asphalt-arm', 'oak-color', 'oak-normal', 'oak-arm', 'oak-ao'];

if (process.argv.includes('--assets') || process.argv.includes('--optimize')) {
  const assets = [];
  for (const name of materialNames) {
    const source = resolve('assets/materials', `${name}.webp`);
    const metadata = await sharp(source).metadata();
    const entry = { name, format: metadata.format, width: metadata.width, height: metadata.height, bytes: statSync(source).size };
    if (process.argv.includes('--optimize')) {
      const output = resolve('assets/materials', `${name}-1k.webp`);
      if (name.endsWith('-color')) {
        await sharp(source).resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true }).webp({ quality: 95, effort: 6 }).toFile(output);
        entry.webBytes = statSync(output).size;
      }
    }
    assets.push(entry);
  }
  writeFileSync(resolve(tmpdir(), 'auto-haus-material-sizes.json'), JSON.stringify(assets, null, 2));
  console.log(JSON.stringify(assets, null, 2));
  process.exit(0);
}

if (process.argv.includes('--camera-check')) {
  const { ScrollStory } = await import('../js/story.js');
  const { Showroom, DESTINATIONS } = await import('../js/showroom.js');
  const { gsap } = await import('gsap');
  const { Box3, PerspectiveCamera, Quaternion, Vector3 } = await import('three');
  globalThis.document = { hidden: false };
  const snapshots = [];
  for (const mode of ['complete', 'skip']) for (const fps of [30, 60, 120]) {
    const camera = new PerspectiveCamera(38, 1.6, 0.1, 400);
    const showroom = {
      camera,
      lookTarget: new Vector3(),
      lastSafeCameraPosition: new Vector3(),
      updateCameraFraming() {},
      updateIntroQuality() {},
      finishIntroQuality() {},
      prepareDecor: async () => {},
    };
    const story = new ScrollStory(showroom, DESTINATIONS.home);
    story.interiorReady = true;
    story.updateHud = () => {};
    story.hud = { classList: { add() {} }, remove() {} };
    story.styleTag = { remove() {} };
    story.apply(0);
    const samples = [];
    for (let frame = 1; frame <= fps * 20; frame++) {
      if (mode === 'skip' && frame === fps * 3 + 1) story.skip();
      story.update(1000 / fps);
      if (frame % (fps * 3) === 0) samples.push({ seconds: frame / fps, progress: story.current, position: camera.position.toArray(), quaternion: camera.quaternion.toArray() });
    }
    snapshots.push({ mode, fps, samples, finalPosition: camera.position.toArray(), finalTarget: showroom.lookTarget.toArray(), complete: story.done });
    assert.deepEqual(camera.position.toArray(), DESTINATIONS.home.position);
    assert.deepEqual(showroom.lookTarget.toArray(), DESTINATIONS.home.target);
    assert.equal(showroom.isIntroPlaying, false);
    assert.equal(showroom.entering, false);
    assert.equal(story.done, true);
  }
  const comparisons = snapshots.filter(run => run.fps !== 120).map(run => {
    const reference = snapshots.find(sample => sample.mode === run.mode && sample.fps === 120);
    return {
      mode: run.mode,
      fps: run.fps,
      maximumPositionDifference: Math.max(...run.samples.map((sample, index) => new Vector3(...sample.position).distanceTo(new Vector3(...reference.samples[index].position)))),
      maximumRotationDifference: Math.max(...run.samples.map((sample, index) => new Quaternion(...sample.quaternion).angleTo(new Quaternion(...reference.samples[index].quaternion)))),
      maximumProgressDifference: Math.max(...run.samples.map((sample, index) => Math.abs(sample.progress - reference.samples[index].progress))),
    };
  });
  const routes = [];
  for (const [from, to] of [['home', 'contact'], ['contact', 'home'], ['home', 'inventory']]) {
    const room = Object.create(Showroom.prototype);
    Object.assign(room, {
      camera: new PerspectiveCamera(38, 1.6, 0.1, 400),
      lookTarget: new Vector3(...DESTINATIONS[from].target),
      lastSafeCameraPosition: new Vector3(),
      cameraRadius: 0.38,
      cameraColliders: [],
      _camBox: new Box3(), _lo: new Vector3(), _hi: new Vector3(),
      _startLook: new Vector3(), _endLook: new Vector3(),
      viewportWidth: 1280,
    });
    room.camera.position.set(...DESTINATIONS[from].position);
    room.camera.lookAt(room.lookTarget);
    const tween = room.followCameraPath([DESTINATIONS[from].position, DESTINATIONS[to].position], DESTINATIONS[to].target, 3);
    tween.pause();
    const formerCamera = room.camera.clone();
    const previous = room.camera.quaternion.clone();
    const formerPrevious = previous.clone();
    let maximumRotationStep = 0;
    let formerMaximumRotationStep = 0;
    for (let frame = 1; frame <= 600; frame++) {
      tween.progress(frame / 600);
      formerCamera.position.copy(room.camera.position);
      formerCamera.lookAt(room.lookTarget);
      maximumRotationStep = Math.max(maximumRotationStep, previous.angleTo(room.camera.quaternion));
      formerMaximumRotationStep = Math.max(formerMaximumRotationStep, formerPrevious.angleTo(formerCamera.quaternion));
      previous.copy(room.camera.quaternion);
      formerPrevious.copy(formerCamera.quaternion);
    }
    routes.push({ from, to, maximumRotationStep, formerMaximumRotationStep, finalPosition: room.camera.position.toArray(), finalTarget: room.lookTarget.toArray() });
    assert.deepEqual(room.camera.position.toArray(), DESTINATIONS[to].position);
    assert.deepEqual(room.lookTarget.toArray(), DESTINATIONS[to].target);
    assert.ok(room.camera.quaternion.angleTo(formerCamera.quaternion) < 1e-6);
    assert.ok(maximumRotationStep <= formerMaximumRotationStep + 1e-6);
    tween.kill();
  }
  gsap.ticker.sleep();
  const report = { snapshots, comparisons, routes };
  writeFileSync(resolve(tmpdir(), 'auto-haus-camera-determinism.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  assert.ok(comparisons.every(run => run.maximumPositionDifference < 1e-6), 'Intro pose depends on frame rate');
  assert.ok(comparisons.every(run => run.maximumRotationDifference < 1e-6), 'Intro rotation depends on frame rate');
  assert.ok(comparisons.every(run => run.maximumProgressDifference < 1e-6), 'Intro progress depends on frame rate');
  process.exit(0);
}

let url = process.argv.find(argument => argument.startsWith('http')) ?? 'http://localhost:8001/';
const built = process.argv.includes('--built');
const mobile = process.argv.includes('--mobile');
const stockRenderer = process.argv.includes('--stock-renderer');
const snapshotDirectory = process.argv.find((argument) => argument.startsWith('--snapshot='))?.slice('--snapshot='.length);
const reportPath = resolve(tmpdir(), snapshotDirectory ? `auto-haus-snapshot${mobile ? '-mobile' : ''}.json` : mobile ? 'auto-haus-intro-mobile.json' : stockRenderer ? 'auto-haus-intro-stock-renderer.json' : built ? 'auto-haus-intro-built.json' : process.argv.includes('--camera-regression') ? 'auto-haus-camera-regression.json' : process.argv.includes('--trace-gl') ? 'auto-haus-camera-driver-trace.json' : process.argv.includes('--baseline') ? 'auto-haus-intro-before.json' : 'auto-haus-intro-after.json');
let deploymentServer;
if (built || snapshotDirectory) {
  const directory = resolve(snapshotDirectory ?? 'dist');
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.wasm': 'application/wasm' };
  deploymentServer = createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const file = resolve(directory, pathname.slice('/showroom/'.length) || 'index.html');
    if (!pathname.startsWith('/showroom/') || !file.startsWith(directory + sep) || !existsSync(file) || !statSync(file).isFile()) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream', 'Cache-Control': /\.(?:hdr|webp|png|jpe?g)$/.test(file) ? 'public, max-age=86400' : 'no-cache' });
    response.end(readFileSync(file));
  });
  await new Promise(resolve => deploymentServer.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${deploymentServer.address().port}/showroom/`;
}
const executablePath = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
].find(existsSync);
assert.ok(executablePath, 'A local Chromium browser is required');
console.log(`Profiling ${url}`);
const browser = await chromium.launch({ executablePath, headless: !process.argv.includes('--headed'), args: ['--ignore-gpu-blocklist', '--use-angle=d3d11'] }).catch(error => {
  writeFileSync(reportPath, JSON.stringify({ error: error.stack }, null, 2));
  throw error;
});
try {
  const context = await browser.newContext({ viewport: mobile ? {width:390,height:844} : {width:1280,height:800}, ...(mobile ? {deviceScaleFactor:2,isMobile:true,hasTouch:true} : {}), reducedMotion: 'no-preference' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const regression = [];
  const validatePose = async (name, destination = 'home') => {
    const state = await page.evaluate(destination => {
      const room = window.__showroom;
      const position = room.camera.position.toArray();
      const target = room.lookTarget.toArray();
      const reference = room.camera.clone();
      reference.lookAt(room.lookTarget);
      return { destination, position, target, rotationError: room.camera.quaternion.angleTo(reference.quaternion), locked: room.navigationLocked, introPlaying: room.isIntroPlaying, motion: !!room.motion, entering: room.entering, transitioning: room.transitioning };
    }, destination);
    assert.equal(state.locked, false, `${name}: camera remains locked`);
    assert.equal(state.motion, false, `${name}: camera tween remains active`);
    assert.equal(state.entering, false, `${name}: entrance remains active`);
    assert.equal(state.transitioning, false, `${name}: transition remains active`);
    assert.ok(state.rotationError < 1e-6, `${name}: target and orientation disagree`);
    if (destination === 'home') {
      assert.deepEqual(state.position, [0, 2.35, 4.7]);
      assert.deepEqual(state.target, [0, 2, -1.4]);
    }
    if (destination === 'inventory') {
      assert.deepEqual(state.position, [-5.3, 2.35, 1.7]);
      assert.deepEqual(state.target, [-8, 2.1, -3.1]);
    }
    regression.push({ name, ...state });
    return state;
  };
  const testIntroLockAndResize = async () => {
    await page.waitForFunction(() => window.__showroom?.isIntroPlaying && window.__showroom.story.current > 0.025, null, { timeout: 120000 });
    const state = await page.evaluate(async () => {
      const room = window.__showroom;
      const story = room.story;
      const position = room.camera.position.clone();
      const rotation = room.camera.quaternion.clone();
      const target = room.lookTarget.clone();
      const destination = room.currentDestination;
      for (const button of document.querySelectorAll('#showroom-nav button')) button.click();
      const navigationBlocked = room.moveTo('inventory') === false;
      const tweenBlocked = room.followCameraPath([[0, 2.35, 4.7], [-5.3, 2.35, 1.7]], [-8, 2.1, -3.1], 1) === null;
      room.enter();
      room.exit();
      room.introduce(true);
      room.resize();
      const unchanged = position.equals(room.camera.position) && target.equals(room.lookTarget) && rotation.angleTo(room.camera.quaternion) < 1e-7;
      const duplicateStart = room.startStory();
      const immediatelyUnchanged = story === room.story && !room.motion;
      await duplicateStart;
      return { navigationBlocked, tweenBlocked, resizeAndControlsPreservedPose: unchanged, immediatelyUnchanged, sameIntro: story === room.story, sameDestination: destination === room.currentDestination, locked: room.navigationLocked };
    });
    assert.ok(Object.values(state).every(Boolean), 'A competing controller changed the intro camera');
    regression.push({ name: 'intro ownership and resize', ...state });
    await page.setViewportSize({ width: 1100, height: 740 });
    await page.waitForFunction(() => window.__showroom?.viewportWidth === 1100, null, { timeout: 10000 });
  };
  await page.addInitScript(({stockRenderer}) => {
    if (stockRenderer) {
      let room;
      Object.defineProperty(window,'__showroom',{
        configurable:true,
        get:() => room,
        set:(value) => { room = value; room.ready.then(() => { if (room.frameRenderer) room.frameRenderer.enabled = false; }); },
      });
    }
    localStorage.removeItem('auto-haus-skip-intro');
    window.__profile = { frames: [], renders: [], jobs: [], longTasks: [], started: 0, complete: false };
    new PerformanceObserver(list => {
      for (const entry of list.getEntries()) {
        window.__profile.longTasks.push({ start: entry.startTime, duration: entry.duration, name: entry.name, attribution: entry.attribution.map(item => ({ name: item.name, containerType: item.containerType, containerSrc: item.containerSrc })) });
      }
    }).observe({ type: 'longtask', buffered: true });
    let previous;
    const record = () => {
      const now = performance.now();
      const showroom = window.__showroom;
      const audit = window.__profile;
      if (showroom?.story && !showroom.story.done) {
        if (!audit.started) {
          audit.started = now;
          for (const name of ['compilePasses', 'uploadTextures', 'batchStaticMeshes', 'commit', 'prewarm', 'resize']) {
            const original = showroom[name].bind(showroom);
            showroom[name] = (...args) => {
              const started = performance.now();
              const progress = showroom.story.current;
              const result = original(...args);
              const synchronous = performance.now() - started;
              const record = () => audit.jobs.push({ name, group: args[0]?.name, progress, synchronous, total: performance.now() - started });
              if (result?.then) result.then(record);
              else record();
              return result;
            };
          }
          audit.secondaryAtStart = showroom.deferredGroups?.map(group => group.name);
          audit.initialization = { shaderCompilations: 0, programLinks: 0, textureUploads: 0, bufferUploads: 0 };
          audit.glStalls = [];
          audit.cameraUpdates = [];
          const applyCamera = showroom.story.apply.bind(showroom.story);
          showroom.story.apply = (...args) => {
            const started = performance.now();
            const result = applyCamera(...args);
            audit.cameraUpdates.push(performance.now() - started);
            return result;
          };
          const render = showroom.renderer.render.bind(showroom.renderer);
          const gl = showroom.renderer.getContext();
          if (location.search.includes('trace-gl')) {
            const operations = { compileShader: 'shaderCompilations', linkProgram: 'programLinks', texImage2D: 'textureUploads', texSubImage2D: 'textureUploads', compressedTexImage2D: 'textureUploads', bufferData: 'bufferUploads', bufferSubData: 'bufferUploads', drawElements: null, drawElementsInstanced: null, drawArrays: null, drawArraysInstanced: null };
            const methods = new Set();
            for (let prototype = Object.getPrototypeOf(gl); prototype && prototype !== Object.prototype; prototype = Object.getPrototypeOf(prototype)) {
              for (const name of Object.getOwnPropertyNames(prototype)) if (name !== 'constructor' && typeof gl[name] === 'function') methods.add(name);
            }
            for (const name of methods) {
              const counter = operations[name];
              const original = gl[name].bind(gl);
              gl[name] = (...args) => {
                const started = performance.now();
                const result = original(...args);
                const duration = performance.now() - started;
                if (showroom.story && !showroom.story.done) {
                  if (counter) audit.initialization[counter]++;
                  if (duration > 3) audit.glStalls.push({ name, duration, progress: showroom.story.current, camera: showroom.camera.position.toArray(), arguments: args.filter(value => typeof value === 'number').slice(0, 8) });
                }
                return result;
              };
            }
          }
          const timer = gl.getExtension('EXT_disjoint_timer_query_webgl2');
          const pendingQueries = [];
          audit.gpuTimingSupported = !!timer;
          showroom.renderer.render = (...args) => {
            while (pendingQueries.length && gl.getQueryParameter(pendingQueries[0].query, gl.QUERY_RESULT_AVAILABLE)) {
              const pending = pendingQueries.shift();
              if (!gl.getParameter(timer.GPU_DISJOINT_EXT)) pending.frame.gpuMs = gl.getQueryParameter(pending.query, gl.QUERY_RESULT) / 1e6;
              gl.deleteQuery(pending.query);
            }
            const query = timer ? gl.createQuery() : null;
            if (query) gl.beginQuery(timer.TIME_ELAPSED_EXT, query);
            const started = performance.now();
            const result = render(...args);
            if (query) gl.endQuery(timer.TIME_ELAPSED_EXT);
            const frame = { ms: performance.now() - started, progress: showroom.story.current, calls: showroom.renderer.info.render.calls, triangles: showroom.renderer.info.render.triangles, geometries: showroom.renderer.info.memory.geometries, textures: showroom.renderer.info.memory.textures, programs: showroom.renderer.info.programs.length, camera: args[1] === showroom.camera ? 'live' : 'warm' };
            audit.renders.push(frame);
            if (query) pendingQueries.push({ query, frame });
            return result;
          };
        }
        if (previous) {
          const dt = now - previous.time;
          audit.frames.push({ dt, progress: showroom.story.current, step: showroom.camera.position.distanceTo(previous.position), angle: showroom.camera.quaternion.angleTo(previous.quaternion), dpr: showroom.renderer.getPixelRatio(), camera: showroom.camera.position.toArray(), clouds: showroom.cloudLayer.visible, doors: showroom.doors.map(door => door.pivot.position.x), programs: showroom.renderer.info.programs.length });
          if (dt > 40 && location.search.includes('trace-gl')) console.warn('Frame spike:', dt.toFixed(1), 'ms, intro progress:', showroom.story.current.toFixed(4));
        }
        previous ??= { time: now, position: showroom.camera.position.clone(), quaternion: showroom.camera.quaternion.clone() };
        previous.time = now;
        previous.position.copy(showroom.camera.position);
        previous.quaternion.copy(showroom.camera.quaternion);
      } else if (audit.started && showroom?.story?.done) {
        audit.complete = true;
        audit.finished = now;
        return;
      }
      requestAnimationFrame(record);
    };
    requestAnimationFrame(record);
  },{stockRenderer});
  await page.goto(`${url}${url.includes('?') ? '&' : '?'}debug&qa=native-profile${process.argv.includes('--trace-gl') ? '&trace-gl' : ''}`, { waitUntil: 'domcontentloaded', timeout:120000 });
  if (process.argv.includes('--camera-regression')) await testIntroLockAndResize();
  await page.waitForFunction(() => window.__profile.complete, null, { timeout: 120000 });
  const result = await page.evaluate(() => {
    const showroom = window.__showroom;
    const audit = window.__profile;
    const summarize = (from, to) => {
      const frames = audit.frames.filter(frame => frame.progress >= from && frame.progress < to);
      const renders = audit.renders.filter(frame => frame.progress >= from && frame.progress < to);
      const gpuFrames = renders.filter(frame => Number.isFinite(frame.gpuMs));
      const sorted = frames.map(frame => frame.dt).sort((left, right) => left - right);
      return { frames: frames.length, fps: +(1000 * frames.length / frames.reduce((sum, frame) => sum + frame.dt, 0)).toFixed(1), p95ms: +sorted[Math.floor(sorted.length * .95)]?.toFixed(1), maxMs: Math.max(...sorted), renderCPUms: +(renders.reduce((sum, frame) => sum + frame.ms, 0) / Math.max(1, renders.length)).toFixed(1), gpuMeanMs: gpuFrames.length ? +(gpuFrames.reduce((sum, frame) => sum + frame.gpuMs, 0) / gpuFrames.length).toFixed(1) : null, gpuPeakMs: gpuFrames.length ? +Math.max(...gpuFrames.map(frame => frame.gpuMs)).toFixed(1) : null, peakCalls: Math.max(...renders.map(frame => frame.calls)), peakTriangles: Math.max(...renders.map(frame => frame.triangles)), peakGeometries: Math.max(...renders.map(frame => frame.geometries)), peakTextures: Math.max(...renders.map(frame => frame.textures)), firstPrograms: renders[0]?.programs, lastPrograms: renders.at(-1)?.programs, minDPR: Math.min(...frames.map(frame => frame.dpr)) };
    };
    const criticalResources = performance.getEntriesByType('resource').filter(entry => entry.responseEnd <= audit.started);
    const resources = [...new Map(criticalResources.map(entry => [entry.name, { url: entry.name, bytes: entry.encodedBodySize || entry.decodedBodySize, transfer: entry.transferSize }])).values()];
    const assetRequests = new Map();
    for (const entry of criticalResources) {
      if (/\.(?:hdr|webp)$/.test(new URL(entry.name).pathname)) assetRequests.set(entry.name, (assetRequests.get(entry.name) ?? 0) + 1);
    }
    const duplicateCriticalAssets = [...assetRequests].filter(([, count]) => count > 1);
    const gl = showroom.renderer.getContext();
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    const lights = [];
    const materials = new Set();
    const geometries = new Set();
    const textures = new Set();
    showroom.scene.traverse(object => {
      if (object.isLight) lights.push({ type: object.type, castShadow: object.castShadow, mapSize: object.castShadow ? object.shadow.mapSize.toArray() : null });
      if (object.geometry) geometries.add(object.geometry);
      for (const material of object.material ? [].concat(object.material) : []) {
        materials.add(material);
        for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
      }
    });
    textures.add(showroom.scene.environment);
    const buffers = new Set();
    for (const geometry of geometries) {
      for (const attribute of Object.values(geometry.attributes)) if (attribute.array) buffers.add(attribute.array.buffer);
      if (geometry.index) buffers.add(geometry.index.array.buffer);
    }
    const geometryBytes = [...buffers].reduce((total, buffer) => total + buffer.byteLength, 0);
    const textureBytesEstimate = [...textures].reduce((total, texture) => {
      const image = texture.image;
      const channelBytes = texture.type === 1015 ? 4 : texture.type === 1016 ? 2 : 1;
      return total + (image?.width ?? 0) * (image?.height ?? 0) * 4 * channelBytes * (texture.generateMipmaps ? 4 / 3 : 1);
    }, 0);
    return { timings: showroom.timings, loadingMs: audit.started, duration: +(audit.finished - audit.started).toFixed(1), aerial: summarize(0, .48), approach: summarize(.48, .76), entrance: summarize(.76, 1), full: summarize(0, 1), secondaryAtStart: audit.secondaryAtStart, slowJobs: audit.jobs.filter(job => job.synchronous > 15 || job.total > 500).sort((left, right) => right.synchronous - left.synchronous).slice(0, 12), slowFrames: audit.renders.filter(frame => frame.ms > 100).sort((left, right) => right.ms - left.ms).slice(0, 8), slowIntervals: audit.frames.filter(frame => frame.dt > 100).slice(0, 8), criticalBytes: resources.reduce((sum, entry) => sum + entry.bytes, 0), duplicateCriticalAssets, largest: [...resources].sort((left, right) => right.bytes - left.bytes).slice(0, 10), resources, memory: { geometries: showroom.renderer.info.memory.geometries, textures: showroom.renderer.info.memory.textures, geometryBytes, textureBytesEstimate: Math.round(textureBytesEstimate), renderTargetsExcluded: true }, lights, transparentMaterials: [...materials].filter(material => material.transparent).length, transmissionMaterials: [...materials].filter(material => material.transmission > 0).length, postProcessing: !!showroom.post, renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER), focused: document.hasFocus(), hidden: document.hidden, finalCamera: showroom.camera.position.toArray(), glass: { roughness: showroom.m.glass.roughness, transmission: showroom.m.glass.transmission, thickness: showroom.m.glass.thickness, bufferScale: showroom.renderer.transmissionResolutionScale }, collision: showroom.cameraCollisionAt(showroom.camera.position), glError: gl.getError() };
  });
  result.browser = browser.version();
  result.mobileEmulation = mobile ? {viewport:{width:390,height:844},deviceScaleFactor:2,hasTouch:true,physicalPhone:false} : false;
  result.stockRendererDiagnostic = stockRenderer;
  result.snapshotDirectory = snapshotDirectory ?? null;
  result.headless = !process.argv.includes('--headed');
  result.cameraAudit = await page.evaluate(() => ({
    isIntroPlaying: window.__showroom.isIntroPlaying,
    navigationLocked: window.__showroom.navigationLocked,
    motionActive: !!window.__showroom.motion,
    finalTarget: window.__showroom.lookTarget.toArray(),
    controlsPresent: !!window.__showroom.controls,
    cameraUpdateMeanMs: window.__profile.cameraUpdates.reduce((total, duration) => total + duration, 0) / Math.max(1, window.__profile.cameraUpdates.length),
    frameSpikes: window.__profile.frames.filter(frame => frame.dt > 40),
    initialization: location.search.includes('trace-gl') ? window.__profile.initialization : null,
    glStalls: window.__profile.glStalls,
    resourcesDuringIntro: performance.getEntriesByType('resource').filter(entry => entry.startTime >= window.__profile.started && entry.startTime < window.__profile.finished).map(entry => ({ url: entry.name, started: entry.startTime - window.__profile.started, duration: entry.duration })),
  }));
  assert.equal(result.glError, 0);
  assert.equal(result.collision, null);
  assert.equal(errors.length, 0, errors.join('\n'));
  assert.equal(result.duplicateCriticalAssets.length, 0, 'Critical HDR/PBR assets were requested more than once');
  result.longTasks = await page.evaluate(() => {
    const audit = window.__profile;
    return audit.longTasks.filter(task => task.start >= audit.started && task.start < audit.finished).map(task => ({ ...task, sinceIntro: +(task.start - audit.started).toFixed(1) }));
  });
  if (process.argv.includes('--camera-regression')) {
    await validatePose('fresh complete intro');
    const afterFinish = await page.evaluate(() => {
      const room = window.__showroom;
      const position = room.camera.position.clone();
      const rotation = room.camera.quaternion.clone();
      const target = room.lookTarget.clone();
      room.story.update(1000);
      room.resize();
      return { position: position.distanceTo(room.camera.position), rotation: rotation.angleTo(room.camera.quaternion), target: target.distanceTo(room.lookTarget) };
    });
    assert.ok(Object.values(afterFinish).every(value => value < 1e-7), 'Completed intro or resize changed the camera');
    regression.push({ name: 'finished intro and resize do not move camera', ...afterFinish });
    await page.setViewportSize({ width: 1280, height: 800 });
    const navigate = async destination => {
      await page.locator(`#showroom-nav [data-destination="${destination}"]`).click();
      await page.waitForFunction(destination => { const room = window.__showroom; return room.currentDestination === destination && !room.transitioning && !room.motion; }, destination, { timeout: 30000 });
      await validatePose(`navigate to ${destination}`, destination);
    };
    await navigate('inventory');
    await navigate('home');
    await page.locator('#return-exterior').click();
    await page.waitForFunction(() => window.__showroom.outside && !window.__showroom.transitioning, null, { timeout: 30000 });
    await validatePose('return to exterior', 'exterior');
    await page.locator('#return-exterior').click();
    await page.waitForFunction(() => !window.__showroom.outside && !window.__showroom.entering && !window.__showroom.transitioning, null, { timeout: 30000 });
    await validatePose('exterior to interior');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__profile.complete, null, { timeout: 120000 });
    await validatePose('reload complete intro');
    const session = await context.newCDPSession(page);
    await session.send('Network.enable');
    await session.send('Network.setCacheDisabled', { cacheDisabled: true });
    await session.send('Network.setBypassServiceWorker', { bypass: true });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__showroom?.isIntroPlaying && window.__showroom.story.current > 0.15, null, { timeout: 120000 });
    await page.locator('.story-skip').click();
    await page.waitForFunction(() => window.__profile.complete, null, { timeout: 30000 });
    await validatePose('hard reload and Skip Intro');
    await session.send('Network.setCacheDisabled', { cacheDisabled: false });
    await session.send('Network.setBypassServiceWorker', { bypass: false });
    await session.detach();
    result.regression = regression;
    assert.equal(errors.length, 0, errors.join('\n'));
  }
  if (process.argv.includes('--repeat')) {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__profile.complete, null, { timeout: 120000 });
    result.repeat = await page.evaluate(() => {
      const showroom = window.__showroom;
      const audit = window.__profile;
      const resources = performance.getEntriesByType('resource').filter(entry => entry.responseEnd <= audit.started);
      const gl = showroom.renderer.getContext();
      const sorted = audit.frames.map((frame) => frame.dt).sort((first,second) => first - second);
      return { timings: showroom.timings, loadingMs: audit.started, duration: +(audit.finished - audit.started).toFixed(1), fps: +(1000 * audit.frames.length / audit.frames.reduce((sum, frame) => sum + frame.dt, 0)).toFixed(1), p95ms:sorted[Math.floor(sorted.length * .95)], maximumFrameMs:Math.max(...sorted), frameSpikesOver40:sorted.filter((duration) => duration > 40).length, slowIntervals: audit.frames.filter(frame => frame.dt > 100), longTasks: audit.longTasks.filter(task => task.start >= audit.started && task.start < audit.finished).map(task => ({ ...task, sinceIntro: +(task.start - audit.started).toFixed(1) })), resourceTransferBytes: resources.reduce((sum, entry) => sum + entry.transferSize, 0), assets: resources.filter(entry => /\.(?:hdr|webp|png)$/.test(entry.name)).map(entry => ({ url: entry.name, transfer: entry.transferSize, duration: +entry.duration.toFixed(1) })), collision: showroom.cameraCollisionAt(showroom.camera.position), glError: gl.getError() };
    });
    assert.equal(result.repeat.glError, 0);
    assert.equal(result.repeat.collision, null);
    assert.equal(errors.length, 0, errors.join('\n'));
  }
  writeFileSync(reportPath, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(process.argv.includes('--summary') ? { full: result.full, loadingMs:result.loadingMs, mobileEmulation:result.mobileEmulation, stockRendererDiagnostic:stockRenderer, repeat: result.repeat && { fps: result.repeat.fps, p95ms:result.repeat.p95ms, loadingMs:result.repeat.loadingMs, maximumFrameMs: result.repeat.maximumFrameMs, duration: result.repeat.duration }, cameraAudit: { ...result.cameraAudit, frameSpikes: result.cameraAudit.frameSpikes.length, glStalls: result.cameraAudit.glStalls.toSorted((left, right) => right.duration - left.duration).slice(0, 12) }, regression: result.regression, timings: result.timings, glass: result.glass } : result, null, 2));
  console.log(`Report: ${reportPath}`);
} catch (error) {
  writeFileSync(reportPath, JSON.stringify({ error: error.stack }, null, 2));
  throw error;
} finally {
  await browser.close();
  if (deploymentServer) await new Promise(resolve => deploymentServer.close(resolve));
}