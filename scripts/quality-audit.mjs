import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';
import sharp from 'sharp';
import { installOpaqueReuse } from '../js/frame-renderer.js';
import { visibleStatistics } from '../js/content-utils.js';
import { ABOUT_STATISTICS } from '../js/site-config.js';

for (const samples of [[],[2,1]]) {
  const renderer = {
    extensions:{has:() => true}, capabilities:{maxSamples:4},
    getContext:() => ({RENDERBUFFER:0x8d41,RGBA16F:0x881a,SAMPLES:0x80a9,getInternalformatParameter:() => new Int32Array(samples)}),
  };
  assert.equal(installOpaqueReuse(renderer,{}),null,'Unsupported four-sample HDR must use stock rendering');
}

const url = process.argv.find((argument) => argument.startsWith('http')) ?? 'http://localhost:8002/';
const label = process.argv.includes('--after') ? 'after' : 'before';
const reducedMotion = process.argv.includes('--reduced-motion');
const output = resolve(tmpdir(), `auto-haus-quality-${label}${reducedMotion ? '-reduced-motion' : ''}`);
await mkdir(output, { recursive: true });
await rm(resolve(output,'failure.json'),{force:true});
const executablePath = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
].find(existsSync);
assert.ok(executablePath, 'A local Chromium browser is required.');
const browser = await chromium.launch({ executablePath, headless: true, args: ['--ignore-gpu-blocklist', '--use-angle=d3d11'] });
const report = { label, url, screenshots: [], consoleErrors: [], failedRequests: [], layout: [], benchmarks: [], pixelComparisons: [], limitations: ['Mobile viewports/touch are emulated, not measured on physical phones. Fixed-pose diagnostic variants are not production quality settings. The baseline-only missing favicon request is stubbed in this harness.'] };

function observe(page) {
  page.on('pageerror',(error) => report.consoleErrors.push(error.message));
  page.on('console',(message) => { if (message.type() === 'error') report.consoleErrors.push(`${message.text()} (${message.location().url})`); });
  page.on('requestfailed',(request) => report.failedRequests.push({url:request.url(),error:request.failure()?.errorText}));
}

async function capture(page, name) {
  const file = resolve(output, `${name}.png`);
  await page.screenshot({ path: file, animations:'disabled' });
  report.screenshots.push({ name, file });
}

async function comparePipeline(page,name) {
  if (!process.argv.includes('--pipeline-probe')) return;
  const canvas = page.locator('#showroom-canvas');
  const optimized = await canvas.screenshot();
  await page.evaluate(() => { window.__qualityPipeline.enabled = false; window.__showroom.requestRender(); window.__showroom.renderFrame(); });
  const original = await canvas.screenshot();
  const first = await sharp(original).removeAlpha().raw().toBuffer({resolveWithObject:true});
  const second = await sharp(optimized).removeAlpha().raw().toBuffer();
  let absolute = 0;
  let changed = 0;
  for (let pixel = 0; pixel < first.data.length; pixel += 3) {
    let maximum = 0;
    for (let channel = 0; channel < 3; channel += 1) {
      const difference = Math.abs(first.data[pixel + channel] - second[pixel + channel]);
      maximum = Math.max(maximum,difference); absolute += difference;
    }
    if (maximum > 12) changed += 1;
  }
  report.pixelComparisons.push({name,meanAbsoluteChannelDifference:absolute / first.data.length,pixelsOver12Percent:100 * changed / (first.info.width * first.info.height)});
  await writeFile(resolve(output,`${name}-original-canvas.png`),original);
  await writeFile(resolve(output,`${name}-pipeline-canvas.png`),optimized);
  await page.evaluate(() => { window.__qualityPipeline.enabled = true; window.__showroom.requestRender(); window.__showroom.renderFrame(); });
}

async function verifyCanvas(page) {
  const result = await page.evaluate(() => {
    const room = window.__showroom;
    room.requestRender(); room.renderFrame();
    const gl = room.renderer.getContext();
    const colors = [];
    const pixel = new Uint8Array(4);
    for (const horizontal of [.2,.5,.8]) for (const vertical of [.2,.5,.8]) {
      gl.readPixels(Math.floor(gl.drawingBufferWidth * horizontal),Math.floor(gl.drawingBufferHeight * vertical),1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);
      colors.push([...pixel].slice(0,3));
    }
    return {width:gl.drawingBufferWidth,height:gl.drawingBufferHeight,colors,distinctColors:new Set(colors.map((color) => color.join(','))).size,glError:gl.getError()};
  });
  assert.equal(result.glError,0,'Canvas readback failed');
  assert.ok(result.distinctColors > 2 && result.colors.some((color) => color.some((channel) => channel > 20)),'3D canvas is blank');
  return result;
}

const statFormat = new Intl.NumberFormat('en-US');
const expectedStats = visibleStatistics(ABOUT_STATISTICS.items).map((stat) => {
  const figure = `${statFormat.format(stat.value)}${stat.suffix}`;
  return { figure, label:stat.label, spoken:`${figure} ${stat.label}`, offset:339.292 * (1 - (stat.suffix === '%' ? stat.value / 100 : 1)) };
});
assert.equal(expectedStats.length,4,'The About figures are designed as a 2x2 set');

async function aboutStatistics(page, activate, navigate, prefix) {
  const reduced = await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
  // Recorded from the moment the About content is inserted, so no state change can be missed.
  await page.evaluate(() => {
    const content = document.querySelector('#section-screen-content');
    const trace = window.__statsTrace = { initial:null, states:[], textUpdates:0, renders:[], frames:[] };
    trace.observer = new MutationObserver((records) => {
      const block = content.querySelector('.about-stats');
      if (!block) return;
      trace.initial ??= { state:block.dataset.state, numbers:[...block.querySelectorAll('.about-stat__number')].map((node) => node.textContent) };
      records.forEach((record) => {
        if (record.type === 'attributes' && record.target === block) trace.states.push([block.dataset.state, performance.now()]);
        else if (record.type === 'characterData' || record.target.closest?.('.about-stat__number')) trace.textUpdates += 1;
      });
    });
    trace.observer.observe(content, { subtree:true, childList:true, characterData:true, attributes:true, attributeFilter:['data-state'] });
  });
  await navigate('about');
  await page.waitForFunction(() => document.querySelector('#screen-section.is-active #section-screen-content .about-stats'), null, { timeout:10000 });
  const initial = await page.evaluate(() => window.__statsTrace.initial);
  if (reduced) assert.equal(initial.state,'done','Reduced motion must show the final figures without animation');
  else assert.ok(initial.state === 'ready' && initial.numbers.every((number) => number === '0'),'Figures must start hidden and count up from zero');
  // The figures must never wake the 3D renderer; main-thread frames are sampled at the same time.
  await page.evaluate(() => {
    const room = window.__showroom;
    const trace = window.__statsTrace;
    const render = room.renderer.render;
    room.renderer.render = (...args) => { trace.renders.push(performance.now()); return render.apply(room.renderer, args); };
    trace.restore = () => { room.renderer.render = render; trace.stopped = true; };
    const frame = (now) => { trace.frames.push(now); if (!trace.stopped) requestAnimationFrame(frame); };
    requestAnimationFrame(frame);
  });
  await page.locator('#section-screen-content .about-stat__dial').first().scrollIntoViewIfNeeded();
  await page.waitForFunction(() => document.querySelector('#section-screen-content .about-stats')?.dataset.state === 'done', null, { timeout:15000 });
  await page.waitForTimeout(800);
  const trace = await page.evaluate(() => {
    const trace = window.__statsTrace;
    trace.restore();
    const playing = trace.states.find(([state]) => state === 'playing')?.[1];
    const done = trace.states.find(([state]) => state === 'done')?.[1] ?? 0;
    const during = (time) => playing !== undefined && time >= playing && time <= done;
    const frames = trace.frames.filter(during);
    const intervals = frames.slice(1).map((time, index) => time - frames[index]);
    return { states:trace.states.map(([state]) => state), playing, done, textUpdates:trace.textUpdates, rendersAfterArrival:trace.renders.length, rendersWhileAnimating:trace.renders.filter(during).length, framesWhileAnimating:frames.length, worstFrameMs:Math.max(0,...intervals) };
  });
  const animation = { reduced, ...trace, durationMs:trace.playing === undefined ? 0 : trace.done - trace.playing };
  if (reduced) assert.ok(!animation.states.includes('playing'),'Reduced motion must not animate the figures');
  else {
    assert.deepEqual(animation.states,['playing','done'],'Figures must play exactly once');
    assert.ok(animation.durationMs > 1400 && animation.durationMs < 3000,`Unexpected figure animation duration ${animation.durationMs}`);
    assert.ok(animation.textUpdates >= 8,'Figure count-up was not progressive');
    assert.equal(animation.rendersWhileAnimating,0,'About figures woke the WebGL renderer');
  }
  const measure = () => page.evaluate(() => {
    const block = document.querySelector('#section-screen-content .about-stats');
    const content = document.querySelector('#section-screen-content');
    const box = (element) => element.getBoundingClientRect();
    const cells = [...block.querySelectorAll('.about-stat')];
    const parts = cells.flatMap((cell, index) => [[`dial${index}`, box(cell.querySelector('.about-stat__dial'))], [`label${index}`, box(cell.querySelector('.about-stat__label'))]]);
    const overlaps = [];
    parts.forEach(([name, rect], position) => parts.slice(position + 1).forEach(([other, second]) => {
      if (Math.min(rect.right, second.right) - Math.max(rect.left, second.left) > 1 && Math.min(rect.bottom, second.bottom) - Math.max(rect.top, second.top) > 1) overlaps.push(`${name}/${other}`);
    }));
    const blockBox = box(block);
    return {
      values:cells.map((cell) => cell.querySelector('.about-stat__figure').textContent),
      labels:cells.map((cell) => cell.querySelector('.about-stat__label').textContent),
      spoken:cells.map((cell) => cell.querySelector('.visually-hidden').textContent),
      columns:new Set(cells.map((cell) => Math.round(box(cell).left))).size,
      rows:new Set(cells.map((cell) => Math.round(box(cell).top))).size,
      overlaps,
      ring:box(cells[0].querySelector('.about-stat__dial')).width,
      figuresFit:cells.every((cell) => {
        const dial = box(cell.querySelector('.about-stat__dial'));
        const number = box(cell.querySelector('.about-stat__number'));
        const end = box(cell.querySelector('.about-stat__suffix') ?? cell.querySelector('.about-stat__number')).right;
        return number.left >= dial.left + dial.width * .1 && end <= dial.right - dial.width * .1;
      }),
      labelsInside:cells.every((cell) => { const label = box(cell.querySelector('.about-stat__label')); return label.left >= blockBox.left && label.right <= blockBox.right; }),
      numberSize:parseFloat(getComputedStyle(cells[0].querySelector('.about-stat__figure')).fontSize),
      labelSize:parseFloat(getComputedStyle(cells[0].querySelector('.about-stat__label')).fontSize),
      offsets:cells.map((cell) => parseFloat(getComputedStyle(cell.querySelector('.about-stat__progress')).strokeDashoffset)),
      visible:cells.every((cell) => getComputedStyle(cell).opacity === '1' && getComputedStyle(cell.querySelector('.about-stat__label')).opacity === '1'),
      contentOverflowX:content.scrollWidth > content.clientWidth,
      pageOverflowX:document.documentElement.scrollWidth > innerWidth,
      previewNote:block.querySelector('.about-stats__note')?.textContent ?? null,
    };
  });
  const original = page.viewportSize();
  const layouts = [];
  for (const viewport of [original,{ width:640,height:900 },{ width:390,height:844 },{ width:320,height:568 }]) {
    await page.setViewportSize(viewport);
    await page.waitForTimeout(200);
    const layout = { viewport:`${viewport.width}x${viewport.height}`, ...await measure() };
    assert.deepEqual(layout.values,expectedStats.map((stat) => stat.figure),`Final figures changed at ${layout.viewport}`);
    assert.deepEqual(layout.labels,expectedStats.map((stat) => stat.label));
    assert.deepEqual(layout.spoken,expectedStats.map((stat) => stat.spoken));
    assert.ok(layout.columns === 2 && layout.rows === 2,`Statistics are not a 2x2 grid at ${layout.viewport}`);
    assert.deepEqual(layout.overlaps,[],`Statistics overlap at ${layout.viewport}`);
    assert.ok(layout.figuresFit && layout.labelsInside && layout.visible,`Statistics do not fit at ${layout.viewport}`);
    assert.ok(!layout.contentOverflowX && !layout.pageOverflowX,`Horizontal overflow at ${layout.viewport}`);
    assert.ok(layout.labelSize >= 9 && layout.numberSize >= 20,`Statistics text too small at ${layout.viewport}`);
    assert.ok(layout.offsets.every((offset, index) => Math.abs(offset - expectedStats[index].offset) < .01),'Ring progress is wrong');
    assert.equal(Boolean(layout.previewNote),!ABOUT_STATISTICS.approved,'Unapproved figures must be labelled as a localhost preview');
    const file = resolve(output,`${prefix}-about-stats-${viewport.width}.png`);
    await page.locator('#section-screen-content .about-stats').screenshot({ path:file });
    report.screenshots.push({ name:`${prefix}-about-stats-${viewport.width}`, file });
    // What a visitor sees once the second row is scrolled into the panel, including surrounding controls.
    await page.locator('#section-screen-content .about-stat').nth(2).scrollIntoViewIfNeeded();
    const view = resolve(output,`${prefix}-about-view-${viewport.width}.png`);
    await page.screenshot({ path:view, animations:'disabled' });
    report.screenshots.push({ name:`${prefix}-about-view-${viewport.width}`, file:view });
    layouts.push(layout);
  }
  await page.setViewportSize(original);
  await navigate('contact');
  await navigate('about');
  const reopened = await page.evaluate(() => {
    const block = document.querySelector('#section-screen-content .about-stats');
    return { state:block.dataset.state, values:[...block.querySelectorAll('.about-stat__figure')].map((node) => node.textContent), plays:window.__statsTrace.states.filter(([state]) => state === 'playing').length };
  });
  assert.equal(reopened.state,'done','Statistics replayed after camera navigation');
  assert.equal(reopened.plays,reduced ? 0 : 1,'Statistics replayed after resizing or navigation');
  assert.deepEqual(reopened.values,expectedStats.map((stat) => stat.figure));
  assert.equal(await page.locator('#show-credits, .image-credit').count(),0,'Floating image-credits button still present');
  await page.locator('#section-screen-content [data-show-credits]').scrollIntoViewIfNeeded();
  await activate('#section-screen-content [data-show-credits]');
  await page.locator('#info-panel.is-open').waitFor();
  const credits = await page.evaluate(() => ({
    eyebrow:document.querySelector('#info-eyebrow').textContent,
    entries:document.querySelectorAll('#info-content .screen-contact-grid > div').length,
    links:[...document.querySelectorAll('#info-content a')].map((link) => ({ href:link.getAttribute('href'), rel:link.rel, target:link.target })),
  }));
  assert.equal(credits.entries,7,'Credits panel is incomplete');
  assert.ok(credits.links.every((link) => link.target === '_blank' && link.rel.includes('noreferrer')),'Credits links must open safely');
  credits.bundledLicenceStatus = await page.evaluate(async () => (await fetch(document.querySelector('#info-content a[href$="icons-LICENSE.txt"]').href)).status);
  assert.equal(credits.bundledLicenceStatus,200,'Bundled icon licence is missing');
  await activate('#info-close');
  await page.locator('#info-panel.is-open').waitFor({ state:'hidden' });
  await page.evaluate(() => window.__statsTrace.observer.disconnect());
  return { animation, layouts:layouts.map(({ viewport, ring, numberSize, labelSize, columns, rows }) => ({ viewport, ring, numberSize, labelSize, columns, rows })), reopened:reopened.state, credits:{ eyebrow:credits.eyebrow, entries:credits.entries, links:credits.links.length, bundledLicenceStatus:credits.bundledLicenceStatus } };
}

async function functional(page,touch = false) {
  const activate = async (selector) => touch ? page.locator(selector).tap() : page.locator(selector).click();
  const navigate = async (destination) => {
    await activate(`#showroom-nav [data-destination=${destination}]`);
    await page.waitForFunction((destination) => {
      const room = window.__showroom;
      return room.currentDestination === destination && !room.motion && !room.transitioning && !room.entering;
    },destination,{timeout:30000});
    return page.evaluate(() => ({destination:window.__showroom.currentDestination,collision:window.__showroom.cameraCollisionAt(window.__showroom.camera.position),target:window.__showroom.lookTarget.toArray()}));
  };
  const result = {touchEmulated:touch,navigation:[]};
  // First About visit of the page load, so the one-time figure animation is observable.
  result.about = await aboutStatistics(page,activate,navigate,touch ? 'mobile' : 'desktop');
  for (const destination of ['inventory','brands','services','about','contact','home']) {
    const pose = await navigate(destination);
    assert.equal(pose.collision,null,`Collision at ${destination}`);
    result.navigation.push(pose);
  }
  await navigate('inventory');
  assert.equal(await page.locator('.inventory-screen-card').count(),6,'Original inventory changed');
  await page.locator('#screen-search').fill('not-a-real-car');
  assert.equal(await page.locator('.inventory-screen-card').count(),0,'Inventory search did not filter');
  await activate('.inventory-toolbar [data-reset-inventory]');
  assert.equal(await page.locator('.inventory-screen-card').count(),6,'Filter reset failed');
  await page.locator('#screen-brand').selectOption('BMW');
  assert.equal(await page.locator('.inventory-screen-card').count(),1,'Marque filter failed');
  await activate('.inventory-screen-card');
  await page.locator('#vehicle-view.is-open').waitFor();
  const originalName = await page.locator('#detail-name').textContent();
  const originalPhoto = await page.locator('#detail-photo').evaluate((element) => element.style.backgroundImage);
  await activate('#next-photo');
  assert.notEqual(await page.locator('#detail-photo').evaluate((element) => element.style.backgroundImage),originalPhoto,'Gallery next photo did not advance');
  await activate('#next-vehicle');
  assert.notEqual(await page.locator('#detail-name').textContent(),originalName,'Next vehicle failed');
  await activate('#previous-vehicle');
  assert.equal(await page.locator('#detail-name').textContent(),originalName,'Previous vehicle failed');
  await activate('#close-detail');
  await page.locator('#vehicle-view.is-open').waitFor({state:'hidden'});
  await navigate('contact');
  assert.ok(await page.locator('#screen-section a[href^="mailto:"]').count() > 0,'Contact email missing');
  const whatsapp = page.locator('#screen-section [data-whatsapp]');
  const href = await whatsapp.getAttribute('href');
  if (!/^https:\/\/wa\.me\/\d{8,15}$/.test(href)) {
    await activate('#screen-section [data-whatsapp]');
    assert.match(await page.locator('#toast').textContent(),/not available yet/i,'Unconfigured WhatsApp must fail honestly');
  }
  const rapid = await page.evaluate(async () => {
    for (const destination of ['inventory','services','brands']) document.querySelector(`#showroom-nav [data-destination=${destination}]`).click();
    return true;
  });
  assert.ok(rapid);
  await page.waitForFunction(() => window.__showroom.currentDestination === 'brands' && !window.__showroom.motion && !window.__showroom.transitioning,null,{timeout:30000});
  result.rapidNavigation = 'last request wins';
  await navigate('home');
  result.canvas = await verifyCanvas(page);
  const layout = await page.evaluate(() => {
    const nav = document.querySelector('#showroom-nav').getBoundingClientRect();
    const buttons = [...document.querySelectorAll('#showroom-nav button')].map((element) => { const box = element.getBoundingClientRect(); return {width:box.width,height:box.height}; });
    return {overflow:document.documentElement.scrollWidth > innerWidth,buttons,navWithinViewport:nav.left >= 0 && nav.right <= innerWidth && nav.top >= 0 && nav.bottom <= innerHeight,arrows:/[\u2190-\u2199\u21ba\u21bb\u279c\u27a1]/.test(document.body.innerText)};
  });
  assert.equal(layout.overflow,false,'Page overflows');
  assert.equal(layout.arrows,false,'Visible UI arrow glyph remains');
  assert.ok(layout.navWithinViewport,'Navigation exceeds viewport');
  if (touch) assert.ok(layout.buttons.every((button) => button.height >= 44 && button.width >= 44),'Touch navigation target is too small');
  result.layout = layout;
  result.idleRenders = await page.evaluate(async () => {
    const room = window.__showroom;
    const render = room.renderer.render;
    let renders = 0;
    room.renderer.render = (...args) => { renders += 1; return render(...args); };
    try { for (let frame = 0; frame < 12; frame++) await new Promise(requestAnimationFrame); }
    finally { room.renderer.render = render; }
    return renders;
  });
  assert.equal(result.idleRenders,0,'Idle scene keeps rendering');
  await capture(page,touch ? 'mobile-functional-home' : 'desktop-functional-home');
  return result;
}

async function inspectLoading(page, name) {
  const result = await page.evaluate(() => {
    const curtain = document.querySelector('#arrival-curtain');
    const selectors = ['.arrival-brand', '.arrival-caption', '.arrival-status', '.arrival-progress', '.arrival-remember', '.arrival-skip'];
    const boxes = selectors.map((selector) => {
      const element = curtain.querySelector(selector);
      const box = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return { selector, left: box.left, top: box.top, right: box.right, bottom: box.bottom, width: box.width, height: box.height, visible: box.width > 0 && box.height > 0 && style.display !== 'none' };
    }).filter((box) => box.visible);
    const overlaps = [];
    boxes.forEach((first, index) => {
      boxes.slice(index + 1).forEach((second) => {
        if (Math.min(first.right, second.right) - Math.max(first.left, second.left) > 2 && Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top) > 2) overlaps.push([first.selector, second.selector]);
      });
    });
    const brand = curtain.querySelector('.arrival-brand').getBoundingClientRect();
    const topLayer = document.elementFromPoint(brand.left + 5,brand.top + 5)?.closest('#arrival-curtain') === curtain;
    return { width: innerWidth, height: innerHeight, hidden: document.hidden, boxes, overlaps, topLayer, horizontalOverflow: document.documentElement.scrollWidth > innerWidth };
  });
  report.layout.push({ name, ...result });
  await capture(page, name);
}

async function ready(page, query = 'nostory') {
  await page.goto(`${url}${url.includes('?') ? '&' : '?'}debug&${query}&quality=${label}`, { waitUntil: 'domcontentloaded', timeout:120000 });
  await page.waitForFunction(() => window.__showroom?.sectionsReady && !window.__showroom.startupPreparing && !window.__showroom.entering && !window.__showroom.transitioning && !window.__showroom.outside, null, { timeout: 120000 });
}

async function bench(page, variant) {
  return page.evaluate(async (variant) => {
    const room = window.__showroom;
    const renderer = room.renderer;
    const gl = renderer.getContext();
    const timer = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    const materials = new Set();
    const snapshots = [];
    room.scene.traverse((object) => {
      for (const material of [].concat(object.material ?? [])) materials.add(material);
      if (variant === 'glass-hidden-diagnostic' && [].concat(object.material ?? []).some((material) => material.transmission > 0)) {
        snapshots.push({ object, visible: object.visible }); object.visible = false;
      }
    });
    const normals = [];
    if (variant === 'normalmaps-off-diagnostic') {
      for (const material of materials) if (material.normalMap) {
        normals.push({ material, map: material.normalMap }); material.normalMap = null; material.needsUpdate = true;
      }
    }
    const queries = [];
    const gpu = [];
    const cpu = [];
    const intervals = [];
    const calls = [];
    const triangles = [];
    const drawClasses = {};
    const beforeRender = room.scene.onBeforeRender;
    let frameDraws = {};
    const callbacks = [];
    room.scene.traverse((object) => {
      if (!object.isMesh) return;
      const previous = object.onBeforeRender;
      callbacks.push({ object, previous });
      object.onBeforeRender = function (...args) {
        const material = args[4];
        const type = material.transmission > 0 ? 'transmission' : material.transparent ? 'alpha' : 'opaque';
        const target = renderer.getRenderTarget();
        const key = `${target ? 'offscreen' : 'screen'}:${type}`;
        frameDraws[key] = (frameDraws[key] ?? 0) + 1;
        return previous.apply(this,args);
      };
    });
    let previousTime;
    try {
      for (let frame = 0; frame < 54; frame += 1) {
        await new Promise(requestAnimationFrame);
        const now = performance.now();
        if (frame >= 12 && previousTime) intervals.push(now - previousTime);
        previousTime = now;
        frameDraws = {};
        room.updateCameraCulling();
        if (variant === 'glass-hidden-diagnostic') snapshots.forEach(({object}) => { object.visible = false; });
        while (queries.length && gl.getQueryParameter(queries[0].query, gl.QUERY_RESULT_AVAILABLE)) {
          const pending = queries.shift();
          if (pending.frame >= 12 && !gl.getParameter(timer.GPU_DISJOINT_EXT)) gpu.push(gl.getQueryParameter(pending.query, gl.QUERY_RESULT) / 1e6);
          gl.deleteQuery(pending.query);
        }
        const query = timer ? gl.createQuery() : null;
        if (query) gl.beginQuery(timer.TIME_ELAPSED_EXT, query);
        const started = performance.now();
        renderer.render(room.scene, room.camera);
        const elapsed = performance.now() - started;
        if (query) { gl.endQuery(timer.TIME_ELAPSED_EXT); queries.push({ query, frame }); }
        room.dirty = false;
        if (frame >= 12) {
          cpu.push(elapsed); calls.push(renderer.info.render.calls); triangles.push(renderer.info.render.triangles);
          Object.entries(frameDraws).forEach(([key,value]) => { drawClasses[key] = (drawClasses[key] ?? 0) + value; });
        }
      }
      const mean = (values) => values.length ? values.reduce((total,value) => total + value,0) / values.length : null;
      const sorted = intervals.toSorted((first,second) => first - second);
      return { variant, position: room.camera.position.toArray(), cpuMeanMs: mean(cpu), gpuMeanMs: mean(gpu), frameMeanMs: mean(intervals), p95Ms: sorted[Math.floor(sorted.length * .95)], peakCalls: Math.max(...calls), peakTriangles: Math.max(...triangles), drawClasses: Object.fromEntries(Object.entries(drawClasses).map(([key,value]) => [key,value / cpu.length])), dpr: renderer.getPixelRatio(), transmissionScale: renderer.transmissionResolutionScale, glError: gl.getError() };
    } finally {
      queries.forEach(({query}) => gl.deleteQuery(query));
      callbacks.forEach(({object,previous}) => { object.onBeforeRender = previous; });
      snapshots.forEach(({object,visible}) => { object.visible = visible; });
      normals.forEach(({material,map}) => { material.normalMap = map; material.needsUpdate = true; });
      room.scene.onBeforeRender = beforeRender;
      room.requestRender();
    }
  }, variant);
}

try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: reducedMotion ? 'reduce' : 'no-preference' });
  await context.route('**/favicon.ico',(route) => route.fulfill({status:204,body:''}));
  const page = await context.newPage();
  observe(page);
  if (process.argv.includes('--layout-only')) {
    await page.route('**/js/main.js',(route) => route.fulfill({status:200,contentType:'text/javascript',body:''}));
    await page.goto(url,{waitUntil:'networkidle'});
    await page.evaluate(() => document.fonts.ready);
  } else {
  await ready(page);
  report.wood = await page.evaluate(() => {
    const room = window.__showroom;
    const wood = room.m.wood;
    let boardBatches = 0;
    room.scene.traverse((object) => { if (object.name === 'physical-scale-oak-boards') boardBatches += 1; });
    return {tileMetres:wood.userData.tile,grainAlongLength:wood.userData.grainAlongLength,boardBatches,roughness:wood.roughness,normalScale:wood.normalScale.toArray(),colorMap:!!wood.map,roughnessMap:!!wood.roughnessMap,normalMap:!!wood.normalMap,aoMap:!!wood.aoMap};
  });
  assert.ok(report.wood.colorMap && report.wood.roughnessMap && report.wood.normalMap && report.wood.aoMap,'An existing oak PBR map is missing');
  report.loading = await page.evaluate(() => ({ timings: window.__showroom.timings, renderer: window.__showroom.renderer.getContext().getParameter(window.__showroom.renderer.getContext().getExtension('WEBGL_debug_renderer_info').UNMASKED_RENDERER_WEBGL) }));
  await capture(page,'main-interior');
  report.canvas = await verifyCanvas(page);
  if (process.argv.includes('--functional')) report.functional = await functional(page);
  if (process.argv.includes('--pipeline-probe')) {
    const installed = await page.evaluate(() => {
      window.__qualityPipeline = window.__showroom.frameRenderer;
      window.__showroom.requestRender();
      return !!window.__qualityPipeline;
    });
    assert.ok(installed,'This pixel-comparison run requires supported opaque-pass reuse');
    await capture(page,'main-interior-pipeline');
    await comparePipeline(page,'main-interior');
  }
  await page.locator('#showroom-nav [data-destination=inventory]').click();
  await page.waitForFunction(() => window.__showroom.currentDestination === 'inventory' && !window.__showroom.transitioning, null, { timeout: 30000 });
  await capture(page,'inventory');
  report.publicInventory = await page.locator('.inventory-screen-card').count();
  await page.locator('#showroom-nav [data-destination=home]').click();
  await page.waitForFunction(() => window.__showroom.currentDestination === 'home' && !window.__showroom.transitioning, null, { timeout: 30000 });
  if (!process.argv.includes('--scene-only')) report.benchmarks.push({ pose:'home', ...await bench(page,'original') });
  const poses = [
    { name:'exterior-front', position:[0,9.8,39.5], target:[0,8.5,0] },
    { name:'aerial-building', position:[24,32,35], target:[0,10,0] },
    { name:'glass-facade', position:[5,5,21], target:[0,4,0] },
    { name:'wood-reception', position:[3.2,2.3,2.1], target:[0,1,-2.2] },
    { name:'surroundings', position:[40,11,30], target:[45,7,-35] },
  ];
  for (const pose of poses) {
    await page.evaluate(({position,target}) => {
      const room = window.__showroom;
      room.camera.position.set(...position); room.lookTarget.set(...target); room.camera.lookAt(room.lookTarget);
      room.camera.updateMatrixWorld(); room.updateCameraCulling(); room.requestRender(); room.renderFrame();
    },pose);
    await capture(page,pose.name);
    await comparePipeline(page,pose.name);
    if (pose.name === 'exterior-front' && !process.argv.includes('--scene-only')) {
      for (const variant of ['original','glass-hidden-diagnostic','normalmaps-off-diagnostic']) report.benchmarks.push({ pose:pose.name, ...await bench(page,variant) });
    }
  }
  }
  if (process.argv.includes('--functional')) {
    const admin = await context.newPage();
    const response = await admin.goto(new URL('admin/',url).href,{waitUntil:'networkidle'});
    assert.equal(response.status(),200,'Existing admin route failed');
    assert.match(await admin.locator('body').innerText(),/unavailable|not configured/i,'Unconfigured admin state changed');
    report.admin = {httpStatus:response.status(),configuration:'still unconfigured; authentication/database policies unchanged'};
    await admin.close();
  }
  for (const viewport of [{ width:1280,height:800 },{ width:390,height:844 },{ width:360,height:640 },{ width:320,height:568 },{ width:844,height:390 },{width:568,height:320}]) {
    await page.setViewportSize(viewport);
    await page.evaluate(() => {
      const curtain = document.querySelector('#arrival-curtain');
      curtain.hidden = false; curtain.classList.remove('is-leaving'); curtain.classList.add('is-loading');
      document.querySelector('#arrival-status').textContent = 'Preparing the showroom...';
    });
    await inspectLoading(page,`loading-${viewport.width}x${viewport.height}`);
    await page.evaluate(() => document.querySelector('#arrival-curtain').classList.remove('is-loading'));
    await inspectLoading(page,`ready-${viewport.width}x${viewport.height}`);
  }
  await context.close();
  if (process.argv.includes('--mobile')) {
    const mobile = await browser.newContext({ viewport: { width:390,height:844 }, deviceScaleFactor: 2, isMobile:true, hasTouch:true, reducedMotion:'no-preference' });
    const phone = await mobile.newPage();
    await mobile.route('**/favicon.ico',(route) => route.fulfill({status:204,body:''}));
    observe(phone);
    await ready(phone);
    report.mobile = { emulated:true, benchmark:await bench(phone,'original') };
    report.mobile.canvas = await verifyCanvas(phone);
    if (process.argv.includes('--functional')) report.mobile.functional = await functional(phone,true);
    await capture(phone,'mobile-interior');
    await mobile.close();
  }
  const source = await readFile(new URL('../js/main.js',import.meta.url),'utf8');
  report.publicAdminLink = /data-destination=["']admin|href=["'][^"']*\/admin\//.test(source);
  await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2));
  assert.equal(report.consoleErrors.length,0,report.consoleErrors.join('\n'));
  assert.ok(report.benchmarks.every((result) => result.glError === 0),'GPU diagnostic produced a GL error');
  if (label === 'after') assert.ok(report.layout.every((result) => !result.overlaps.length && !result.horizontalOverflow && result.topLayer),'Loading layout overlaps, loses its top layer or exceeds its viewport');
  console.log(JSON.stringify({ ...report, screenshots:report.screenshots.map(({name}) => name), layout:report.layout.map(({name,overlaps,horizontalOverflow}) => ({name,overlaps,horizontalOverflow})) },null,2));
  console.log(`Quality audit: ${output}`);
} catch (error) {
  await writeFile(resolve(output,'failure.json'),JSON.stringify({error:error.stack},null,2));
  console.error(error.message);
  process.exitCode = 1;
} finally { await browser.close(); }