// Measures camera pacing during section navigation in a built copy of the site.
// Usage: node scripts/profile-navigation.mjs [--snapshot=<dist dir>] [--mobile] [--viewport=1536x730@1.25] [--early] [--gpu-breakdown] [--label=name] [--headed]
// --early starts navigating as soon as the entrance finishes, while background decor is still being prepared.
// --gpu-breakdown also times still frames at each arrival with test-only switches that isolate one GPU cost each;
// its navigation numbers are not comparable because the switches recompile shaders.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, resolve, sep } from 'node:path';
import { chromium } from 'playwright-core';

const option = (name) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const mobile = process.argv.includes('--mobile');
const early = process.argv.includes('--early');
const gpuBreakdown = process.argv.includes('--gpu-breakdown');
const viewport = option('viewport')?.match(/^(\d+)x(\d+)(?:@([\d.]+))?$/);
const label = option('label') ?? (mobile ? 'mobile' : 'desktop');
const directory = resolve(option('snapshot') ?? 'dist');
const reportPath = resolve(tmpdir(), `auto-haus-navigation-${label}.json`);
const gpuReportPath = resolve(tmpdir(), `auto-haus-gpu-${label}.json`);
const tour = ['inventory', 'brands', 'services', 'about', 'contact', 'home', 'exterior', 'interior'];
assert.ok(existsSync(resolve(directory, 'index.html')), `No built site in ${directory}`);

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
const server = createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  const file = resolve(directory, pathname.slice('/showroom/'.length) || 'index.html');
  if (!pathname.startsWith('/showroom/') || !file.startsWith(directory + sep) || !existsSync(file) || !statSync(file).isFile()) {
    response.writeHead(404).end();
    return;
  }
  response.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream', 'Cache-Control': /\.(?:hdr|webp|png|jpe?g)$/.test(file) ? 'public, max-age=86400' : 'no-cache' });
  response.end(readFileSync(file));
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const url = `http://127.0.0.1:${server.address().port}/showroom/?debug&nostory`;

const executablePath = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync);
assert.ok(executablePath, 'A local Chromium browser is required');
const browser = await chromium.launch({ executablePath, headless: !process.argv.includes('--headed'), args: ['--ignore-gpu-blocklist', '--use-angle=d3d11'] });

// Runs in the page: median GPU time of still frames per switch, each reverted before the next. 'base' repeats last to expose drift.
const variantNames = ['base', 'frontToBack', 'noShadowSampling', 'noGlass', 'noOpaqueReuse', 'halfResolution', 'base'];
async function measureVariants(names) {
  const room = window.__showroom;
  const nav = window.__nav;
  const renderer = room.renderer;
  const pixelRatio = renderer.getPixelRatio();
  const glass = new Set();
  room.scene.traverse((object) => { for (const material of [].concat(object.material ?? [])) if (material.transmission > 0) glass.add(material); });
  const switches = {
    base: [() => {}, () => {}],
    frontToBack: [() => renderer.setOpaqueSort((a, b) => a.groupOrder - b.groupOrder || a.renderOrder - b.renderOrder || a.z - b.z || a.id - b.id), () => renderer.setOpaqueSort(null)],
    noShadowSampling: [() => { room.sun.castShadow = false; }, () => { room.sun.castShadow = true; }],
    noGlass: [() => glass.forEach((material) => { material.visible = false; }), () => glass.forEach((material) => { material.visible = true; })],
    noOpaqueReuse: [() => { if (room.frameRenderer) room.frameRenderer.enabled = false; }, () => { if (room.frameRenderer) room.frameRenderer.enabled = true; }],
    halfResolution: [() => renderer.setPixelRatio(pixelRatio / 2), () => renderer.setPixelRatio(pixelRatio)],
  };
  const median = (values) => {
    const sorted = values.toSorted((first, second) => first - second);
    return sorted.length ? +sorted[Math.floor(sorted.length / 2)].toFixed(2) : null;
  };
  const results = [];
  for (const name of names) {
    const [apply, revert] = switches[name];
    apply();
    Object.assign(nav, { renders: [], recording: true });
    for (let frame = 0; frame < 40; frame++) {
      room.dirty = true;
      await new Promise(requestAnimationFrame);
    }
    nav.recording = false;
    const measured = nav.renders.slice(10);
    const timed = measured.map((frame) => frame.gpu).filter(Number.isFinite);
    results.push({ name, gpuMs: median(timed), samples: timed.length, renderCpuMs: median(measured.map((frame) => frame.cpu)), calls: measured.at(-1)?.calls ?? null });
    revert();
  }
  room.dirty = true;
  return results;
}

const statistics = (values) => {
  if (!values.length) return null;
  const sorted = values.toSorted((first, second) => first - second);
  const pick = (quantile) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * quantile))];
  const round = (value) => +value.toFixed(2);
  return { count: sorted.length, mean: round(sorted.reduce((sum, value) => sum + value, 0) / sorted.length), min: round(sorted[0]), p50: round(pick(0.5)), p95: round(pick(0.95)), max: round(sorted.at(-1)) };
};

try {
  const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : viewport ? { width: +viewport[1], height: +viewport[2] } : { width: 1280, height: 800 }, ...(mobile ? { deviceScaleFactor: 2, isMobile: true, hasTouch: true } : viewport?.[3] ? { deviceScaleFactor: +viewport[3] } : {}), reducedMotion: 'no-preference' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text().startsWith('Failed to load resource') ? `${message.text()} ${message.location()?.url ?? ''}`.trim() : message.text()); });
  page.on('response', (response) => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
  // The local test server has no site-root favicon; Chromium reports that 404 as a console error.
  const ignorable = (message) => /favicon\.ico$/.test(message);
  const pageErrors = () => {
    const urls = errors.filter((message) => /^\d{3} /.test(message));
    return errors.filter((message) => {
      if (ignorable(message)) return false;
      return !(message.startsWith('Failed to load resource') && urls.length && urls.every(ignorable));
    });
  };
  await page.addInitScript(() => {
    const nav = window.__nav = { frameTime: 0, intervals: [], renders: [], ticks: [], longTasks: [], clicks: [], newPrograms: [], programLog: [], recording: false, hooked: false };
    new PerformanceObserver((list) => { for (const entry of list.getEntries()) nav.longTasks.push({ start: entry.startTime, duration: entry.duration }); }).observe({ type: 'longtask', buffered: true });
    document.addEventListener('click', (event) => { if (event.target.closest('#showroom-nav [data-destination], #return-exterior')) nav.clicks.push(event.timeStamp); }, true);
    const hook = (room) => {
      nav.hooked = true;
      nav.initialPrograms = room.renderer.info.programs.map((program) => ({ name: program.name, cacheKey: program.cacheKey }));
      nav.loggedPrograms = nav.initialPrograms.length;
      const renderer = room.renderer;
      const gl = renderer.getContext();
      const timer = gl.getExtension('EXT_disjoint_timer_query_webgl2');
      const pending = [];
      const render = renderer.render;
      renderer.render = function (...args) {
        if (!nav.recording || args[1] !== room.camera || renderer.getRenderTarget()) return render.apply(this, args);
        while (pending.length && gl.getQueryParameter(pending[0].query, gl.QUERY_RESULT_AVAILABLE)) {
          const entry = pending.shift();
          if (!gl.getParameter(timer.GPU_DISJOINT_EXT)) entry.frame.gpu = gl.getQueryParameter(entry.query, gl.QUERY_RESULT) / 1e6;
          gl.deleteQuery(entry.query);
        }
        const query = timer ? gl.createQuery() : null;
        if (query) gl.beginQuery(timer.TIME_ELAPSED_EXT, query);
        const started = performance.now();
        const result = render.apply(this, args);
        const cpu = performance.now() - started;
        if (query) gl.endQuery(timer.TIME_ELAPSED_EXT);
        const motion = room.motion;
        if (motion && !motion.__navId) motion.__navId = nav.renders.length + 1;
        const programs = renderer.info.programs;
        if (programs.length > nav.programCount) {
          for (const program of programs.slice(nav.programCount)) nav.newPrograms.push({ frameTime: nav.frameTime, cpu, name: program.name, cacheKey: program.cacheKey, position: room.camera.position.toArray() });
        }
        nav.programCount = programs.length;
        const frame = {
          frameTime: nav.frameTime, now: started, cpu, calls: renderer.info.render.calls, programs: programs.length, textures: renderer.info.memory.textures, geometries: renderer.info.memory.geometries, pixelRatio: renderer.getPixelRatio(),
          motion: motion ? motion.__navId : 0, motionTime: motion ? motion.progress() * motion.duration() * 1000 : null,
          position: room.camera.position.toArray(), transitioning: room.transitioning, hidden: document.hidden,
        };
        nav.renders.push(frame);
        if (query) pending.push({ query, frame });
        return result;
      };
      const tick = room.tick;
      room.tick = (...args) => {
        const started = performance.now();
        tick(...args);
        if (nav.recording) nav.ticks.push(performance.now() - started);
      };
    };
    let previous = 0;
    const frame = (time) => {
      nav.frameTime = time;
      if (nav.recording && previous) nav.intervals.push({ time, dt: time - previous });
      previous = time;
      const room = window.__showroom;
      if (!nav.hooked && room?.frameRenderer !== undefined && !room.startupPreparing) hook(room);
      // Every program compiled after startup, whatever compiled it, with the room state at that moment.
      const programs = nav.hooked ? room.renderer.info.programs : null;
      if (programs && programs.length > nav.loggedPrograms) {
        for (const program of programs.slice(nav.loggedPrograms)) nav.programLog.push({ time, name: program.name, cacheKey: program.cacheKey, motion: Boolean(room.motion), transitioning: room.transitioning, outside: room.outside, recording: nav.recording, position: room.camera.position.toArray().map((value) => +value.toFixed(2)) });
      }
      if (programs) nav.loggedPrograms = programs.length;
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => { const room = window.__showroom; return room && window.__nav.hooked && !room.outside && !room.entering && !room.transitioning && room.sectionsReady; }, null, { timeout: 180000 });
  if (!early) {
    await page.evaluate(async () => { await window.__showroom.decorLoading; });
    await page.waitForTimeout(1500);
  }
  const environment = await page.evaluate(() => {
    const room = window.__showroom;
    const gl = room.renderer.getContext();
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    return { renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER), pixelRatio: room.renderer.getPixelRatio(), drawingBuffer: [gl.drawingBufferWidth, gl.drawingBufferHeight], opaqueReuse: !!room.frameRenderer?.enabled, hidden: document.hidden, focused: document.hasFocus(), programs: room.renderer.info.programs.length, fullFrameCosts: room.fullFrameCosts?.map((cost) => +cost.toFixed(1)), travelScale: room.motionScale };
  });
  const moves = [];
  const breakdown = [];
  for (const destination of tour) {
    const knownPrograms = await page.evaluate(() => {
      const nav = window.__nav;
      const programs = window.__showroom.renderer.info.programs;
      Object.assign(nav, { intervals: [], renders: [], ticks: [], clicks: [], newPrograms: [], programCount: programs.length, recording: true, started: performance.now() });
      return programs.map((program) => ({ name: program.name, cacheKey: program.cacheKey }));
    });
    const target = destination === 'exterior' || destination === 'interior' ? page.locator('#return-exterior') : page.locator(`#showroom-nav [data-destination="${destination}"]`);
    if (mobile) await target.tap();
    else await target.click();
    await page.waitForFunction((destination) => {
      const room = window.__showroom;
      if (destination === 'exterior') return room.outside && !room.transitioning && !room.motion;
      if (destination === 'interior') return !room.outside && !room.entering && !room.transitioning && !room.motion;
      return room.currentDestination === destination && !room.transitioning && !room.motion;
    }, destination, { timeout: 60000 });
    await page.waitForTimeout(1200);
    const raw = await page.evaluate(() => {
      const nav = window.__nav;
      nav.recording = false;
      return { intervals: nav.intervals, renders: nav.renders, ticks: nav.ticks, newPrograms: nav.newPrograms, click: nav.clicks[0] ?? nav.started, longTasks: nav.longTasks.filter((task) => task.start >= nav.started), finished: performance.now() };
    });
    if (gpuBreakdown) breakdown.push({ destination, variants: await page.evaluate(measureVariants, variantNames) });
    // Describes each shader compiled mid-move by the parameters that differ from its closest existing program.
    const compiledPrograms = raw.newPrograms.map((program) => {
      const fields = program.cacheKey.split(',');
      let closest = null;
      for (const known of knownPrograms.filter((entry) => entry.name === program.name)) {
        const other = known.cacheKey.split(',');
        const differences = fields.flatMap((value, index) => value === other[index] ? [] : [`#${index}: ${other[index] ?? '∅'} -> ${value}`]);
        if (!closest || differences.length < closest.length) closest = differences;
      }
      return { name: program.name, frameTime: program.frameTime, renderCpuMs: +program.cpu.toFixed(1), position: program.position.map((value) => +value.toFixed(2)), differences: closest?.slice(0, 12) ?? 'no program with this name existed' };
    });
    const withMotion = raw.renders.filter((frame) => frame.motion);
    // A travel that starts at rest first redraws the still view at the travel resolution. Frames drawn before the travel
    // clock starts add start latency, not judder.
    const moving = withMotion.slice(Math.max(0, withMotion.findIndex((frame) => frame.motionTime > 0)));
    const first = moving[0];
    const last = moving.at(-1);
    // Intervals between drawn camera frames; with GPU pacing the page keeps its 60 Hz callbacks but draws only when the GPU is free.
    const intervals = moving.slice(1).map((frame, index) => frame.frameTime - moving[index].frameTime);
    const callbackIntervals = first ? raw.intervals.filter((entry) => entry.time > first.frameTime && entry.time <= last.frameTime).map((entry) => entry.dt) : [];
    const pacing = [];
    let stalled = 0;
    for (let index = 1; index < moving.length; index++) {
      const previous = moving[index - 1];
      const current = moving[index];
      if (previous.motion !== current.motion) continue;
      const frameStep = current.frameTime - previous.frameTime;
      const motionStep = current.motionTime - previous.motionTime;
      if (frameStep <= 0) continue;
      pacing.push(Math.abs(motionStep - frameStep));
      if (motionStep < 0.5) stalled++;
    }
    const gpu = moving.map((frame) => frame.gpu).filter(Number.isFinite);
    const hitches = moving.slice(1).flatMap((frame, index) => {
      const before = moving[index];
      const interval = frame.frameTime - before.frameTime;
      if (interval <= 100) return [];
      return [{ at: +(frame.frameTime - raw.click).toFixed(1), intervalMs: +interval.toFixed(1), renderCpuMs: +before.cpu.toFixed(1), gpuMs: before.gpu ? +before.gpu.toFixed(1) : null, pixelRatio: before.pixelRatio, nextPixelRatio: frame.pixelRatio, programsAdded: frame.programs - before.programs, texturesAdded: frame.textures - before.textures }];
    });
    // Page callbacks blocked for over 100 ms (main-thread work), including after the camera stops.
    const callbackHitches = raw.intervals.filter((entry) => entry.dt > 100).map((entry) => {
      const index = raw.renders.findIndex((frame) => frame.frameTime >= entry.time - entry.dt);
      const frame = raw.renders[index];
      const before = raw.renders[Math.max(0, index - 1)];
      return {
        at: +(entry.time - raw.click).toFixed(1), intervalMs: +entry.dt.toFixed(1), duringMotion: Boolean(first && entry.time > first.frameTime && entry.time <= last.frameTime),
        renderCpuMs: frame ? +frame.cpu.toFixed(1) : null, gpuMs: frame?.gpu ? +frame.gpu.toFixed(1) : null,
        programsAdded: frame && before ? frame.programs - before.programs : null, texturesAdded: frame && before ? frame.textures - before.textures : null, geometriesAdded: frame && before ? frame.geometries - before.geometries : null,
      };
    });
    moves.push({
      destination,
      motionFrames: moving.length,
      durationMs: first ? +(last.frameTime - first.frameTime).toFixed(1) : 0,
      fps: intervals.length ? +(1000 * intervals.length / intervals.reduce((sum, value) => sum + value, 0)).toFixed(1) : null,
      frameInterval: statistics(intervals),
      callbackInterval: statistics(callbackIntervals),
      intervalsOver50: intervals.filter((value) => value > 50).length,
      intervalsOver100: intervals.filter((value) => value > 100).length,
      pacingError: statistics(pacing),
      stalledFrames: stalled,
      startLatencyMs: first ? +(first.frameTime - raw.click).toFixed(1) : null,
      stillFramesBeforeStart: withMotion.length - moving.length,
      renderCpu: statistics(moving.map((frame) => frame.cpu)),
      tickCpu: statistics(raw.ticks),
      gpu: statistics(gpu),
      pixelRatio: statistics(moving.map((frame) => frame.pixelRatio)),
      finalPixelRatio: raw.renders.at(-1)?.pixelRatio ?? null,
      drawCalls: statistics(moving.map((frame) => frame.calls)),
      programsAdded: first ? raw.renders.at(-1).programs - raw.renders[0].programs : 0,
      texturesAdded: first ? raw.renders.at(-1).textures - raw.renders[0].textures : 0,
      geometriesAdded: first ? raw.renders.at(-1).geometries - raw.renders[0].geometries : 0,
      compiledPrograms,
      hitches,
      callbackHitches,
      longTasks: raw.longTasks.map((task) => +task.duration.toFixed(1)),
      hiddenFrames: raw.renders.filter((frame) => frame.hidden).length,
    });
  }
  const all = (key) => moves.flatMap((move) => move[key] ? [move[key]] : []);
  const programLog = await page.evaluate(() => ({ initial: window.__nav.initialPrograms, added: window.__nav.programLog }));
  const describeProgram = (program) => {
    const fields = program.cacheKey.split(',');
    let closest = null;
    for (const known of programLog.initial.filter((entry) => entry.name === program.name)) {
      const other = known.cacheKey.split(',');
      const differences = fields.flatMap((value, index) => value === other[index] ? [] : [`#${index}: ${other[index] ?? '∅'} -> ${value}`]);
      if (!closest || differences.length < closest.length) closest = differences;
    }
    return { ...program, cacheKey: undefined, differences: closest?.slice(0, 12) ?? 'no startup program with this name' };
  };
  const report = {
    label, mobile, early, url, browser: browser.version(), environment, errors: pageErrors(), rawErrors: errors,
    summary: {
      fps: +(moves.reduce((sum, move) => sum + (move.fps ?? 0) * (move.frameInterval?.count ?? 0), 0) / Math.max(1, moves.reduce((sum, move) => sum + (move.frameInterval?.count ?? 0), 0))).toFixed(1),
      worstP95IntervalMs: Math.max(...all('frameInterval').map((entry) => entry.p95)),
      worstIntervalMs: Math.max(...all('frameInterval').map((entry) => entry.max)),
      intervalsOver50: moves.reduce((sum, move) => sum + move.intervalsOver50, 0),
      intervalsOver100: moves.reduce((sum, move) => sum + move.intervalsOver100, 0),
      meanPacingErrorMs: +(moves.reduce((sum, move) => sum + (move.pacingError?.mean ?? 0) * (move.pacingError?.count ?? 0), 0) / Math.max(1, moves.reduce((sum, move) => sum + (move.pacingError?.count ?? 0), 0))).toFixed(2),
      worstP95PacingErrorMs: Math.max(...all('pacingError').map((entry) => entry.p95)),
      stalledFrames: moves.reduce((sum, move) => sum + move.stalledFrames, 0),
      meanStartLatencyMs: +(moves.reduce((sum, move) => sum + (move.startLatencyMs ?? 0), 0) / moves.length).toFixed(1),
      meanGpuMs: +(moves.reduce((sum, move) => sum + (move.gpu?.mean ?? 0) * (move.gpu?.count ?? 0), 0) / Math.max(1, moves.reduce((sum, move) => sum + (move.gpu?.count ?? 0), 0))).toFixed(2),
      programsAdded: moves.reduce((sum, move) => sum + move.programsAdded, 0),
      longTasksOver50: moves.flatMap((move) => move.longTasks).filter((duration) => duration > 50).length,
    },
    moves,
    programsAfterStartup: programLog.added.map(describeProgram),
  };
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  if (gpuBreakdown) {
    writeFileSync(gpuReportPath, JSON.stringify({ label, environment, breakdown }, null, 2));
    for (const { destination, variants } of breakdown) console.log(`${destination.padEnd(10)} ${variants.map(({ name, gpuMs, calls }) => `${name}=${gpuMs}ms/${calls}`).join('  ')}`);
    console.log(`GPU report: ${gpuReportPath}`);
  }
  console.log(JSON.stringify({ label, environment, errors: report.errors, summary: report.summary, moves: moves.map(({ destination, durationMs, fps, frameInterval, callbackInterval, pacingError, stalledFrames, startLatencyMs, gpu, pixelRatio, finalPixelRatio, programsAdded, longTasks, hitches, callbackHitches }) => ({ destination, durationMs, fps, p50: frameInterval?.p50, p95: frameInterval?.p95, max: frameInterval?.max, callbackP95: callbackInterval?.p95, pacingP95: pacingError?.p95, stalledFrames, startLatencyMs, gpuMean: gpu?.mean, pixelRatio: pixelRatio ? [pixelRatio.min, pixelRatio.p50, pixelRatio.max] : null, finalPixelRatio, programsAdded, longTasks: longTasks.length, hitches: hitches.length, callbackHitches: callbackHitches.length })) }, null, 2));
  console.log(`Report: ${reportPath}`);
  assert.equal(report.errors.length, 0, report.errors.join('\n'));
} finally {
  await browser.close();
  await new Promise((done) => server.close(done));
}
