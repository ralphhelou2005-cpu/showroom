# AUTO HAUS GROUP: realism + cinematic arrival upgrade

The production-quality audit at the end of this file describes the latest changes and acceptance limits. Earlier sections record historical configurations, including temporary quality reductions that are no longer active. Current intro DPR is not reduced, and physical glass uses full-resolution transmission throughout.

Two routes, both included. They link to each other.

**Route A: live 3D (your existing Three.js showroom)**
Automatic cloud-layer arrival, aerial roof reveal, frontal approach, and sliding-door entry. The facade, floor plates, sides, roof, upper-floor furnishings, glazing, stone floor, landscaping, and loading gate have been reworked without replacing the website.

**Route B: scroll-scrubbed video (`video-story/`)**
Separate scroll-scrubbed route, currently using placeholder footage made from the supplied photos. Ends on an "Enter the live showroom" button that opens Route A.

## Exterior and Interior Design Pass

- Reference-inspired black central piers reach the entrance landing and connect to a satin-black fascia. Its header and logo are lowered one 6.12 m storey to a center height of 12.53 m; width, style, logo resolution, glass, and exterior rendering settings are unchanged.
- Ten large glazed office/meeting rooms replace the sparse upper-floor islands. Four front-facing offices, larger stone desks, client seating, storage, display backdrops, lounges, and planted corners read through the facade.
- A 6.76 m central stone-and-oak reception replaces the circular information island. It has practical staff worktops, two chairs, a quiet branded backdrop, and subtle brass/light detailing. Home owns this reception. Contact has its own front-right screen and look target; the shared navigation controller and other destinations are unchanged.
- Existing floor maps, slab scale, roughness and reflection settings remain unchanged. New furniture reuses existing materials and shared instances; no external model downloads or additional lighting passes were added.
- Logo GPU uploads follow the 1K/2K device tier. The critical loading gate prepares the entrance scene and shader programs; secondary geometry uploads run during the cloud sequence, behind a readiness cap before the building reveal.

## Current Files

- `js/showroom.js`: connected facade, side glazing, upper rooms, roof services, cloud geometry, lighting, collision bounds, loading, and responsive framing.
- `js/story.js`: one automatic, timestamp-driven cinematic route, sampled safety check, visible cloud reveal, door timing, control ownership, and Skip.
- `js/materials.js`, `js/textures.js`, `js/texture-library.js`: thin clear glass, coherent polished stone, seven critical downloaded maps, and simpler PBR finishes.
- `js/district.js`: volumetric branched trees, distance detail, clear entrance axis, and surrounding-building collision bounds.
- `js/main.js`, `js/cars3d.js`: preserved navigation with deferred decor and optional model helpers.
- `js/realism-upgrade.js`: optional effects/model helpers without overrides that undo clear glass or stone settings.
- `index.html`, `sw.js`: eliminate duplicate preload downloads and use current code with reusable asset caching.
- `css/style.css`: preserve the existing design with a two-row phone navigation that keeps all six tabs visible.
- `.gitignore`: exclude `node_modules/` and `dist/`.
- `assets/logo/` and the separate `video-story/` route remain in place. Archived `patches/` are historical, not the current implementation.

## URL switches

| URL | Effect |
|-----|--------|
| `/` | automatic cloud arrival, then the normal showroom; other camera inputs are suspended during arrival |
| `/?nostory` or `/#live` | skip the story (also used when "skip intro" is remembered) |
| `/?fx=1` | enable optional GTAO/bloom post-processing on supported desktop devices |
| `/?fx=0` | turn off the realism upgrade |
| `/?layout` | skip the story and enable car placement keys (Tab, arrows, `[` `]`, `-` `+`, `P` logs the slot) |
| `/?debug` | exposes `window.__showroom` (your existing switch) |

## Tuning

- Story length, door timing, camera/look path, chapter text: top of `js/story.js`.
- Evening colours, sun, fog, sky tint, facade light strength: the `EVENING` table near the top of `js/showroom.js`.
- Base lighting/tone mapping and framing: `js/showroom.js`; glass/stone settings: `js/materials.js`; optional ambient occlusion/bloom: `js/realism-upgrade.js`.
- Car positions: `CAR_SLOTS` in `js/cars3d.js`.

## What is NOT included, and why

- **3D car models.** None can be produced here, and the project deliberately avoids fabricated cars. Put `.glb` files in `assets/models/` (names in `cars3d.js`); missing files are skipped.
- **Additional heavy models.** Upper floors use shared/instanced office and meeting furniture, planted corners, large stone desks, branded display walls, glazed rooms, lounges, and suspended lights. Street trees use irregular canopy volumes rather than crossed flat cards. Existing asphalt/oak/HDR assets remain; worn-concrete maps are not applied to marble.
- **Final video footage.** `video-story/assets/story.mp4` is a placeholder built from your two photos. See `video-story/PROMPTS.md`.

## Cloud, Camera and Loading Performance Pass

The current facade, lowered black feature, logo, floors, reception, furniture, destination targets and permanent glass/lighting settings are unchanged. This pass changes scheduling, batching, temporary distant-intro rendering and asset reuse only.

- Clouds previously occupied a narrow 59-66 m layer under a 104 m starting camera. There are now 24 camera-facing instances across approximately 62-97 m, with a feathered generated 512x256 atlas and one draw call. Cloud pixels affect about 72% of the starting desktop canvas; screenshots also verify cloud passage and the below-cloud building reveal. Clouds are disabled after arrival.
- One native `requestAnimationFrame` loop owns the cinematic and renderer. Navigation retains its existing GSAP curve tweens, but cannot run while the intro owns the camera. Wheel/touch/keyboard no longer scrub the cinematic. Timestamp/delta-based 30/60/120 FPS simulations all complete in 18.4 seconds, excluding the brief opening cloud hold for background readiness.
- The measured transmission bottleneck doubled opaque draws: an approach probe took 51.4 ms with transmission versus 23.8 ms without that pass. Only the distant cinematic uses clear alpha glazing; original physical glass and full transmission resolution return before door entry. Half-second adaptive DPR changes also produced allocation pauses during flight, so intro DPR is fixed at a device-capped 0.7 conservative / 1 high-tier and restored normally at arrival. Static scene batches stay within architectural groups to preserve useful culling. Existing instanced plants, distant-tree detail and shared 256 px district facades remain in use.
- The original loading gate warmed the whole scene and missed linear/transmission and first-draw shader variants. Important variants are now precompiled and warmed with shared tiny placeholders and a separate offscreen camera. Secondary geometry uploads start during the opening clouds; a readiness gate prevents entry/reveal pop-in. Tiny ornaments wait until arrival. No all-asset cache invalidation was added.
- The conservative image/HDR payload falls from 13,822,000 to 12,732,918 bytes. Measured production critical resources, including compressed code/CSS, fall from approximately 14.08 MB to 12.97 MB. Only the two color maps use new 1K quality-95 variants; the 2K originals, 1K normal/ARM/AO maps and 2K HDRI are retained. The official logo uses the already-loaded HTML URL instead of a second production path. Every initial asset size is listed in `README.md`.

### Native GPU Measurements

Windows Edge/Chromium, Intel UHD 620 via ANGLE D3D11, 1280x800, default effects off. The native profiler is in `scripts/profile-intro.mjs`; the integrated editor browser is background-throttled and is not used as the FPS benchmark.

| Metric | Original built site | Final native-rAF built site |
|--------|--------------------:|--------------------------------:|
| Critical readiness | 30.36 s | 8.58 s |
| First critical prewarm render | 18.02 s | 0.75 s |
| Full intro average FPS | 31.9 | 45.0 |
| Aerial average FPS | 29.4 | 53.2 |
| Approach average FPS | 30.7 | 39.9 |
| Entrance average FPS | 38.2 | 34.5 |
| Peak draw calls | 701 | 388 |
| Camera/render intervals over 100 ms | One 100.1 ms interval | None |

The final primary run's worst camera interval was 56.1 ms; background sections prepared in 133 ms during the opening clouds. A same-browser repeat reached readiness in 2.64 seconds, averaged 48 FPS and recorded zero transferred bytes for all critical resources. It also recorded four isolated 110-244 ms scheduling intervals, without matching main-thread long tasks or repeated DPR changes; completely stutter-free behavior is not guaranteed. The independent final source primary/repeat runs had no intervals over 100 ms.

These are local native GPU measurements, not a universal loading/FPS guarantee or a pristine driver-cache benchmark. Shader cache, thermals and browser scheduling influence repeatability. The approximately-30-FPS lower-end phase target is met in the final primary run; 50-60 FPS is reached aerially, not throughout close-up entry on this integrated GPU. The remaining expensive close-up physical-glass pass is deliberately preserved. The unchanged 7.3 MB HDRI and shader preparation still make cold startup noticeable. Historical design-pass editor-browser timings were 8.1-10.0 seconds warm and 11.4 seconds with the app asset cache cleared, and are not directly comparable to a native graphics context.

## Verification

The production build succeeds with the existing main-chunk size warning. Checks cover desktop/390x844 cloud screenshots and nonblank canvas pixels, cloud passage, the building reveal, a 1,800-sample collision-free route, input isolation, identical 30/60/120 FPS timing, pre-door physical-glass restoration, disabled post-arrival clouds, restored device DPR, all six section buttons, distinct Home/Contact targets, ten retained upper rooms, and no WebGL errors. Earlier design-pass checks also covered inventory filtering, eight-photo gallery paging and 320x568 facade framing. No commit, push or remote deployment has been made.

## Camera-Only Audit: 2026-10-14

### Camera Writers and Ownership

| File and function | Responsibility before this pass | Current behavior |
|---|---|---|
| `js/showroom.js`: constructor | Initial position and `lookAt` | Unchanged bootstrap pose; explicit `isIntroPlaying` state |
| `js/showroom.js`: `prewarm` | Warm-camera poses and temporary saved/restored live-camera poses before readiness | Same preparation; cannot run during the intro |
| `js/story.js`: `ScrollStory.apply`, called by `begin`, `update`, `finish` | Intro position/look curves and per-frame `lookAt` | Sole intro writer; same position path and precomputed quaternion interpolation |
| `js/showroom.js`: `followCameraPath` | Single GSAP progress tween writes route position and per-frame `lookAt` | Same routes/durations, quaternion interpolation, exact endpoint, blocked during intro |
| `js/showroom.js`: `introduce` | Direct initial pose for skipped/reduced-motion entry | Cannot overwrite an active intro |
| `js/showroom.js`: `enter`, `exit`, `moveTo` | Dispatch route camera tweens | Intro-locked; entry now shares the exact Home target |
| `js/showroom.js`: `resize`, `updateCameraFraming` | Aspect, FOV, projection and renderer dimensions only | No position/rotation/target reset; regression-tested during and after intro |

`js/main.js` dispatches navigation but does not write camera transforms. No OrbitControls, pointer-follow, wheel/scroll camera, competing correction system, or camera-owning second render loop was found. There is one primary showroom rAF loop and one stored GSAP route tween; replacement already killed the previous tween. The profiler's observer loop reads poses, and the standalone video route has a separate video-scrub loop, neither of which writes or renders the live camera. Optional postprocessing consumes the same camera without controlling it.

### Confirmed Defects and Changes

- The former intro filter depended on frame-step size: equal-time 30 and 120 FPS poses differed by up to 0.212228 scene units. Its exact elapsed-time solution now agrees within 0.000001 units at 30/60/120 FPS, including Skip. The authored cloud/descent/building/stairs/doors/interior position path remains unchanged.
- Route `lookAt` interpolation accelerated rotation sharply on Home/Contact travel. Actual-tween tests reduce the peak sampled angular step from 0.018622 to 0.006781 radians, without changing route geometry, timing, destination, or final orientation.
- Intro/re-entry previously ended at target `[0, 1.9, -1.4]`, while Home used `[0, 2, -1.4]`. All now finish at exact position `[0, 2.35, 4.7]` and Home target `[0, 2, -1.4]`, with no active tween and an unlocked controller.
- Native WebGL tracing found deferred `getProgramInfoLog` / `getShaderInfoLog` calls blocking for up to 64.4 ms each around 16-22% intro progress, with doors still closed. Three.js `compileAsync` had completed, but `WebGLProgram.onFirstUse` diagnostics/uniform/attribute caching remained deferred. `start` now calls `getUniforms` on already compiled programs before releasing readiness. Repeated tracing found zero shader-log stalls during movement.
- Tracing found zero mid-intro shader compilations, program links, texture uploads, buffer uploads, or resource loads. Geometry/texture/program counts remain stable. Camera updates average approximately 0.07-0.08 ms. Existing HDRI, scene initialization and shader compilation stay before movement; no unrelated loading change was made.

### Measured Limits

Windows native Edge, Intel UHD 620 / ANGLE D3D11, 1280x800, default effects off, full current quality. Heavy WebGL tracing is disabled for these before/after measurements.

| Run | Before maximum interval | After maximum interval | Before average FPS | After average FPS |
|---|---:|---:|---:|---:|
| Fresh browser context | 284.1 ms | 300.9 ms | 17.7 | 16.8 |
| Same-browser reload | 153.6 ms | 303.8 ms | 18.6 | 24.2 |

These runs do not establish improved maximum frame time or a stutter-free result. The remaining largest intervals occurred between animation callbacks without matching >100 ms renderer calls or recorded JavaScript long tasks. GPU rendering still averages approximately 55 ms overall and 73 ms during approach; scheduling/driver outliers remain. A camera conflict is not the cause of that sustained GPU cost. No quality reduction or graphics redesign was used to hide it.

### Reproducible Checks

Use the existing development Node environment:

```powershell
node scripts/profile-intro.mjs --camera-check
node scripts/profile-intro.mjs --camera-regression --summary
node scripts/profile-intro.mjs --trace-gl --summary
node scripts/profile-intro.mjs --repeat --summary
```

The camera regression covers fresh/reload completion, cache- and service-worker-bypassed hard reload with Skip, intro navigation lock, duplicate intro requests, transform-preserving resize during/after intro, exact stopped handoff, Inventory/Home, and Exterior-to-interior. Reports are written separately in the OS temporary directory. Full WebGL tracing and >40 ms warnings are opt-in test instrumentation, not a second production render loop.

Protected-file hashes verify that UI, WhatsApp, inventory, assets/material helpers, lighting helpers, cache behavior and renderer/DPR settings remain unchanged. Scene-building code and cloud visuals are unchanged. Glass remains transmission 1, roughness 0.006, thickness 0.008, transmission scale 1. No commit or push was made.

## Production-Quality Audit: 2026-10-19

**Status: improvements implemented and locally verified, not a stable-60-FPS or physical-phone production certification.** Loading remains noticeable and occasional long frames remain. No commit, push or deployment was made.

### Safety and Baseline

- The complete pre-quality working tree, including the unfinished admin integration, was archived outside the project as `../showroom-backups/showroom-before-quality-20261019-160707.tar`. Dependencies, build output and Git metadata were excluded. SHA256: `A863017D1855D4B651308578B95E52D1D26402D6F4A4655F1BAEE40E50C22CE0`. Restore into a separate directory, not over current work.
- Recent rendering history consists of `47985ef` (2026-10-15, "new update") and the initial commit. Measurements below compare against the saved working tree, not a checkout that would discard the newer admin work.
- Hashes against that archive confirm 15 protected files unchanged: deployment/runtime configuration, package manifests, public Supabase configuration, admin application files, all three SQL migrations and the existing main README. All 26 original image/HDR assets are unchanged. No authentication, database policy, environment-file or deployment changes were made in this quality pass.

### Actual Cause and Rendering Change

The sustained bottleneck was repeated opaque shading around physical transmission, not competing camera controls. The original front-facade probe drew 243 opaque meshes offscreen and the same 243 onscreen, plus 26 transmission and 40 alpha draws: 552 calls and 534,750 triangles. GPU time was approximately 129 ms. Hiding glass diagnostically reduced it to about 54 ms; disabling normal maps reduced it to about 89 ms. Neither diagnostic reduction ships.

[js/frame-renderer.js](js/frame-renderer.js) renders opaque HDR color and depth once, then reuses them inside Three.js's normal transmission/screen ordering. It retains physical glass, depth occlusion, alpha surfaces, tone mapping and display-space fog. It is installed by [js/showroom.js](js/showroom.js), refreshes its material cache when scene groups change, and disposes its resources with the showroom.

Stock rendering remains the fallback for unsupported float-color/four-sample RGBA16F targets, pending shadow updates, render-target/override renders, and views without visible transmission. Optional postprocessing keeps its existing renderer. The unsupported-format branches are exercised by the audit.

No objects, furnishings, plants, normal maps, reflections or lights were removed. DPR remains the original device-capped value, at least 1 during the desktop intro and 1.15 in the phone emulation. Transmission resolution remains 1; facade glass remains transmission 1, roughness 0.006, thickness 0.008. Existing marble, lighting, cached sun shadows and HDRI are retained.

**Memory tradeoff:** the extra full-resolution HDR/depth target and four-sample buffers can require approximately 60 bytes per drawing-buffer pixel: about 61 MB at 1280x800 or 26 MB at the tested phone buffer, excluding driver overhead. Scene vertex/index buffer estimates increase from 4.63 to 6.62 MB with physical-scale boards and nearby facade detail. The approximately 135.8 MB scene-texture estimate is unchanged and excludes render targets. This is not a measured total GPU-memory figure; mobile tile-based GPU bandwidth and memory behavior still need physical-device validation.

### Measured Results

Native headless Edge/Chromium, Intel UHD 620, ANGLE D3D11, 8 hardware threads. WebGL runs were serial. The mobile viewport is 390x844 with device scale 2, touch emulation and unchanged capped renderer DPR 1.15, not a phone GPU. Fresh means a fresh browser context, not a pristine OS/driver cache. Times include the complete authored approximately 18.4-second cinematic; heavy GL tracing is identified separately.

| Run | Fresh / repeat FPS | Fresh / repeat p95 | Fresh / repeat maximum | Peak calls |
|---|---:|---:|---:|---:|
| Saved original desktop source | 15.2 / 21.3 | 124.6 ms / not recorded | 342.8 / 123.5 ms | 501 |
| Final scene, stock renderer control | 20.8 / 20.3 | 76.8 / 92.7 ms | 240.2 / 220.6 ms | 501 |
| Same final scene, opaque reuse | 27.0 / 26.2 | 52.8 / 61.8 ms | 66.8 / 69.1 ms | 283 |
| Final production bundle, GL tracing | 27.7 / 23.7 | 65.5 / 71.9 ms | 206.3 / 1744.1 ms | 283 |
| Saved original production bundle, mobile emulation | 28.7 / 29.8 | 52.7 / 53.6 ms | 427.1 / 104.5 ms | 504 |
| Final production bundle, mobile emulation | 42.2 / 43.4 | 38.6 / 34.9 ms | 101.5 / 109.8 ms | 285 |

The matched final-scene desktop pair isolates the renderer change from added district geometry: average GPU time falls from 42.5 to 32.1 ms, render CPU from 29.4 to 16.1 ms, peak draws by 43.5%, and submitted triangles from 546,358 to 273,646. This is less repeated work, not removed architecture. The final mobile-emulation approach still averages only 36 FPS; entrance averages 52.4 FPS.

Run-to-run variance is material: another final-source run measured 17.9 / 25.0 FPS. The table is evidence, not a guarantee. The 1744 ms repeat interval in the traced production run remains unresolved and prevents a stutter-free claim. No stable 60 FPS acceptance was achieved.

### Loading and Camera

- Startup is **not demonstrably faster**. The saved original desktop source loaded in 12.43 / 4.60 seconds fresh/repeat; the matched final-source pair was 17.64 / 10.52 seconds stock versus 16.77 / 11.00 seconds with reuse. Production mobile-emulation loading was 16.11 / 9.93 seconds before and 16.49 / 11.09 seconds after. The traced desktop production run took 23.21 / 9.67 seconds.
- A concurrent shader-preparation experiment was rejected and removed: the corrected version retained 67 programs but did not improve the approximately 10.3-second readiness baseline. Original sequential preparation remains. No original HDRI or PBR images were reduced or replaced to manufacture a loading result. Mobile production critical encoded resources increase only from 13,591,551 to 13,599,625 bytes.
- The final uninduced production trace records zero shader compilations, program links, texture uploads and buffer uploads during movement, with 67 programs stable throughout. One approximately 0.7 KB icon-sprite fetch occurred near the UI handoff; there is no claim that literally no request can occur. The approximately 7.3 MB HDRI and shader/prewarm work remain before movement.
- The existing single camera owner, quaternion paths, cancellation, collision checks and exact Home handoff remain. Full cloud, aerial, frontal, doors, entry and reception stages complete in the production profiler. Final 30/60/120 FPS complete/Skip simulations and real GSAP route endpoint checks pass. The earlier native renderer-stage regression also passed ownership, resize, reload/Skip, Exterior/re-entry and section transitions.
- No OrbitControls, drag-to-orbit or free-camera touch controller exists in this application. None was invented or claimed fixed. Existing touch navigation was tested with actual Playwright taps; rapid destination replacement settles on the last requested section.

### Realism and UI Changes

- [js/materials.js](js/materials.js) and [js/showroom.js](js/showroom.js): reuse the existing oak color/normal/ARM/AO maps with physical 0.9-metre repeats, grain along board length, deterministic offsets and matte roughness 0.92. Rounded and instanced boards receive size-aware UVs; merged boards avoid extra per-board draws.
- [js/district.js](js/district.js): add shared nearest-row window reveals, sills, headers, mullions, floor ledges, coping and shop entrances. Facade canvases gain small window recess shadows; awnings/uprights use appropriate existing finishes. Detail stays in shared geometry/material buckets; distant layout, skyline, trees and roads remain, without new image downloads.
- [css/style.css](css/style.css): replace absolute loader placement with responsive grid rows, wrapping status text and 44-pixel preference/Skip targets. The loader owns the top layer; leaving text hides before overlapping showroom chrome. Brand, copy, progress and saved Skip preference remain.
- [index.html](index.html), [js/main.js](js/main.js), [js/story.js](js/story.js), [js/content-utils.js](js/content-utils.js) and [video-story/index.html](video-story/index.html): replace UI arrow glyphs with fixed-size Lucide SVG symbols while retaining handlers and accessible labels. The small [assets/logo/icons.svg](assets/logo/icons.svg) sprite and [assets/logo/icons-LICENSE.txt](assets/logo/icons-LICENSE.txt) ship through the existing asset-copy path. Attribution is in [assets/README.md](assets/README.md). No icon JS bundle or dependency was added to public startup.

### Verification and Evidence

The final [scripts/quality-audit.mjs](scripts/quality-audit.mjs) run passed with zero console errors and failed requests. It checks desktop and touch-emulated navigation to all six destinations, collision-free endpoints, search/no-results/reset/marque filters, six retained vehicles, gallery photo/vehicle paging, email, honest unconfigured WhatsApp behavior, last-request-wins navigation, zero idle renders over 12 frames, and nonblank GL pixel readback. The admin route remains HTTP 200 with its honest unconfigured state.

All 12 loader combinations pass overlap, top-layer and horizontal-overflow checks: loading/ready at 1280x800, 390x844, 360x640, 320x568, 844x390 and 568x320. Same-instance stock/reuse pixel comparisons across six poses have mean channel differences below 1 on a 0-255 scale; at most 2.44% of pixels differ by more than 12 in any channel. Output is not bit-identical. Screenshots were visually reviewed for framing, retained glass/stone, texture continuity and unobstructed controls.

Production build succeeds for both entries under the existing `/showroom/` configuration, including admin, icons and attribution. The existing large-chunk warning remains. All 12 local admin foundation checks pass after correcting one test's RLS expectation from "throw" to "zero updated rows" in [scripts/test-admin.mjs](scripts/test-admin.mjs). No policy was changed. Live Supabase authentication, storage, recovery and deployment remain untested and unconfigured.

Before/after captures and raw reports are preserved in [patches/quality-2026-10-19](patches/quality-2026-10-19), outside the folders copied into production assets:

| View | Before | After |
|---|---|---|
| Exterior | [Before](patches/quality-2026-10-19/exterior-front-before.png) | [After](patches/quality-2026-10-19/exterior-front-after.png) |
| Aerial | [Before](patches/quality-2026-10-19/aerial-building-before.png) | [After](patches/quality-2026-10-19/aerial-building-after.png) |
| Glass | [Before](patches/quality-2026-10-19/glass-facade-before.png) | [After](patches/quality-2026-10-19/glass-facade-after.png) |
| Main interior | [Before](patches/quality-2026-10-19/main-interior-before.png) | [After](patches/quality-2026-10-19/main-interior-after.png) |
| Wood/reception | [Before](patches/quality-2026-10-19/wood-reception-before.png) | [After](patches/quality-2026-10-19/wood-reception-after.png) |
| Surroundings | [Before](patches/quality-2026-10-19/surroundings-before.png) | [After](patches/quality-2026-10-19/surroundings-after.png) |
| Phone loading | [Before](patches/quality-2026-10-19/loading-390x844-before.png) | [After](patches/quality-2026-10-19/loading-390x844-after.png) |
| Inventory | [Before](patches/quality-2026-10-19/inventory-before.png) | [After](patches/quality-2026-10-19/inventory-after.png) |
| Phone interior | [Before](patches/quality-2026-10-19/mobile-interior-before.png) | [After](patches/quality-2026-10-19/mobile-interior-after.png) |

The saved original main-interior capture includes its loader fade and is not a clean pixel comparator. Loader images intentionally force a layout state; their displayed percentage is not a loading measurement. Final captures disable CSS transitions for stable review. Quantitative rendering comparisons toggle stock/reuse within the same final scene, avoiding those UI differences.

Raw metrics: [desktop-original-baseline.json](patches/quality-2026-10-19/desktop-original-baseline.json), [desktop-final-stock.json](patches/quality-2026-10-19/desktop-final-stock.json), [desktop-final-reuse.json](patches/quality-2026-10-19/desktop-final-reuse.json), [desktop-built-trace.json](patches/quality-2026-10-19/desktop-built-trace.json), [mobile-built-before.json](patches/quality-2026-10-19/mobile-built-before.json), [mobile-built-after.json](patches/quality-2026-10-19/mobile-built-after.json), [visual-functional-after.json](patches/quality-2026-10-19/visual-functional-after.json).

### Reproduce and Remaining Gates

```powershell
npm run build
node scripts/profile-intro.mjs --built --repeat --summary
node scripts/profile-intro.mjs --built --mobile --repeat --summary
node scripts/profile-intro.mjs --built --trace-gl --summary
node scripts/profile-intro.mjs http://127.0.0.1:5174/ --stock-renderer --repeat --summary
node scripts/profile-intro.mjs --camera-check
node scripts/quality-audit.mjs http://127.0.0.1:5174/ --after --scene-only --pipeline-probe --functional --mobile
npm run test:admin
```

The quality audit requires a supported native Chromium GPU and an existing local server. Native source serving still relies on remote ESM imports; connection-refused/remote-load-timeout attempts and one transient network-error audit were not counted as passes. The final clean functional/visual audit used Vite's local dependencies. Production performance runs used local production bundles. No network timeout or real-device performance issue is claimed fixed.

Before production acceptance: test physical iPhone/Safari and Android GPUs, portrait/landscape interaction, context recovery and render-target memory pressure; investigate the remaining long-frame outliers and startup cost; verify live admin flows only after approved Supabase setup. Stable 60 FPS and faster loading remain unmet requirements, not hidden by reduced resolution or removed detail.
