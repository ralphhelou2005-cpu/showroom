# AUTO HAUS GROUP — Spatial Showroom

The showroom uses Three.js for architecture, lighting, twin automatic sliding glass doors, and controlled camera travel between physical showroom areas. The exterior is a connected three-storey building with continuous floor plates, center glazing, finished side facades, furnished upper floors, and a complete serviced roof. A visible cloud layer leads into the automatic aerial arrival. The existing website structure, inventory, six sections, and photographic vehicle detail interfaces remain in place; the upper workspaces and central reception have been redesigned.

## Exterior and interior design pass

The front reference in `assets/reference/facade-front.jpg` informs the broad black central piers and sign-bearing fascia. The header and logo have been lowered by one 6.12 m storey, from a center height of 18.65 m to 12.53 m. The pier bases stay at the entrance landing and their tops align with the lower header. The supplied white logo still spans approximately 11 m of the unchanged 14.6 m fascia without stretching; its dimensions, texture resolution, and fit settings are unchanged. The exterior return camera is slightly higher to make the upper workspaces easier to see. Glass, lighting, rendering settings, and floor materials are preserved.

Each upper floor has five large glazed rooms: two front-facing sales/private-client offices, two ownership/finance/configuration workspaces, and a central meeting or delivery suite. Offices have 3.35 m stone desks, staff/client seating, storage, monitors, brand backdrops, and suspended light bars. The meeting table is 4.8 m; larger lounges and planted corners fill the remaining zones without blocking the circulation routes.

The ground-floor center has a 6.76 m stone-and-oak reception counter with side returns, brass detailing, a recessed light accent, two staff chairs, practical worktops, and a restrained branded backdrop. This reception belongs to Home. Contact keeps its separate front-right camera position and looks at the dedicated Contact screen at `[8.4, 2.95, 9.58]`, not the center reception. The side counter and its back wall are retained; the back wall now carries the Contact screen. Shared navigation handling and the other destination routes are unchanged. New furniture uses shared/instanced geometry and existing materials rather than additional model downloads; logo uploads are 1K normally or 2K on high-tier devices.

The official logo is in `assets/logo/`, and the supplied facade references are in `assets/reference/`. `assets/image.png` is a different dealership's logo and is intentionally not used. There are no 3D vehicle models in the upgrade package; the optional loader skips missing models and keeps the photo-based inventory available.

## Run in Chrome

1. Open this folder in VS Code.
2. Select **AUTO HAUS GROUP: Chrome** under **Run and Debug** and press F5, or run **Terminal → Run Task… → Run AUTO HAUS GROUP showroom**.
3. Open `http://localhost:8001/` if using the task directly.

Three.js and GSAP are loaded via the browser import map in the static localhost experience. Architecture uses procedural materials and geometry. Vehicle photography lives under `assets/photos/` and appears in the inventory and detail interfaces.

The main page plays an approximately 18-second cloud-to-entrance arrival when motion is allowed. One timestamp-driven loop owns the camera; scroll, touch, keyboard and section controls cannot redirect the cinematic. Skip accelerates the same safe path. The separate placeholder-footage route is `video-story/index.html`. Add `?nostory` or `#live` to enter the live showroom directly; `?fx=1` enables optional GTAO/bloom, while `?fx=0` disables the realism upgrade. Reduced-motion and remembered-skip preferences remain supported.

For a Vite deployment build, install Node.js 20.19+ or 22.12+, then run `npm install` and `npm run build`. The static PowerShell localhost server does not require Node.js. `vite.config.js` uses the `/showroom/` base and copies photos, logo/reference images, PBR maps, HDRI, the service worker, and standalone video-story route into `dist/`. Source asset references remain relative for localhost and repository-subpath hosting. The versioned service worker uses network-first JavaScript/CSS and cache-first image/HDR assets; HTML and the optional video are excluded. Generated dependencies and build files are ignored by Git.

## Poly Haven Assets

The downloaded EXRs are not shipped directly. Converted maps in `assets/materials/` preserve sRGB albedo separately from linear data maps. Only the visibly useful sets are included:

| Asset | Use | Original bytes | Optimized bytes | Readiness |
|-------|-----|---------------:|----------------:|-----------|
| Asphalt Pit Lane albedo / normal / ARM | Road and forecourt | 22,269,785 | 4,554,356 | Critical |
| Concrete Floor Worn normal / ARM | Retained files; no longer used on marble | 14,530,142 | 2,204,452 | Not requested |
| Oak Veneer albedo / normal / ARM / AO | Interior wood furniture and reception | 17,445,298 | 1,955,176 | Critical |
| Urban Street 01 2K HDRI | PMREM reflections only; procedural sky remains visible | 7,286,632 | 7,286,632 | Critical |

Seven external maps total 5,420,450 bytes on the conservative device tier, versus the previous 6,509,532 bytes. Only the asphalt and oak color maps use new 1K quality-95 web variants; the original 2K files remain available to high-tier devices. The 1K normal, ARM and AO maps are unchanged. The generated 512 px polished-stone set supplies consistent color, normal, and roughness maps without additional downloads, with a 6 m repeat and 2 m slabs. The normal showroom keeps thin physical glass, transmission 1, IOR 1.5, roughness 0.004-0.006, and a full-resolution transmission buffer. Only the distant cinematic temporarily uses clear alpha glazing; original physical materials and full transmission resolution return before door entry. Intro DPR stays fixed at a device-capped 0.7 on conservative hardware or 1 on high-tier hardware, avoiding framebuffer reallocations during movement; normal DPR returns at arrival. Stone and matte finishes use standard PBR shaders; the expensive composer is opt-in with `?fx=1` and is bypassed during the cinematic.

The critical readiness gate prepares the exterior/roof/side geometry, stairs, doors, central reception, entrance-visible floor/furniture, district and planting, critical maps/HDR/logo, shaders and GPU uploads. Important secondary shader programs are precompiled and warmed with tiny shared-geometry placeholders, not the entire hidden scene. Upper-office geometry uploads, side consultation, Contact/Services/About displays and the lounge are prepared after the cloud cinematic starts. A cloud-phase readiness cap prevents the building reveal until they are ready, so nothing pops in during entry. Tiny ornaments wait until arrival; section HTML and vehicle photography remain on demand. The warm camera and small offscreen targets never move the live camera. Stable image/HDR URLs and the existing asset cache are preserved; in-flight loader promises and the official logo are shared.

### Initial asset sizes

| Asset | Initial resolution | Bytes |
|-------|--------------------|------:|
| Urban Street 01 HDRI | 2K | 7,286,632 |
| Asphalt color | 1K conservative / 2K high-tier | 545,250 / 1,550,884 |
| Asphalt normal | 1K | 1,929,266 |
| Asphalt ARM | 1K | 1,074,206 |
| Oak color | 1K conservative / 2K high-tier | 137,234 / 220,682 |
| Oak normal | 1K | 394,732 |
| Oak ARM | 1K | 950,632 |
| Oak AO | 1K | 389,130 |
| Official white logo | Supplied PNG, shared with the HTML | 25,836 |
| Cloud atlas | Generated 512x256 | No download |
| Sky, polished stone, plants and district facades | Generated 128px-1K | No download |

No 4K/8K/16K texture is requested by the intro. Unused worn-concrete source maps, facade reference photos, gallery photography, optional effects and model decoders are not critical downloads. The conservative critical image/HDR payload is 12,732,918 bytes; the high-tier payload is 13,822,000 bytes. JavaScript/CSS/fonts add hosting-dependent overhead.

### Performance checks

Run `npm run profile:intro -- http://localhost:8001/` or `npm run profile:intro -- http://127.0.0.1:8002/showroom/` after a build. Add `--repeat` for a same-browser cached revisit, resource transfer sizes and long-task evidence. The script uses local Edge/Chrome on the real GPU, reports loading, phase FPS, long frames, draw calls, payload and glass restoration, and saves JSON in the OS temporary directory. `npm run optimize:intro-assets` reproducibly regenerates the two 1K color variants with Sharp. The Node tools are development-only; the static PowerShell server still does not need Node.

The older design-pass timings (8.1-10.0 seconds warm and 11.4 seconds with the app asset cache cleared) were measured in the integrated editor browser and are not comparable to native cold-context shader compilation. Native performance results are documented in `README-UPGRADE.md`; neither set of local measurements is a universal network/hardware guarantee.

## Spatial layout

- Entrance: the camera begins with an aerial exterior approach, descends to the stepped front entrance, and passes through two transparent glass doors that slide outward.
- Center: stone-and-oak staffed reception, restrained brand backdrop, floor inlays, and suspended atrium lighting.
- Left wing: illuminated inventory information gallery.
- Right wing: illuminated marque gallery.
- Back left: services.
- Back right: about.
- Home: center reception / main welcome area.
- Contact: dedicated front-right Contact screen and contact details.

The main screen opens on the unobstructed 3D center atrium. Open **Navigation** to choose a zone; the camera walks to that physical area before its HTML display appears. The selector is available on desktop and mobile without staying over the architecture.

The arrival uses one smooth position curve and one smooth look-target curve, sampled before movement. Bounds cover the showroom, upper building/roof, furniture, street lamps, tree canopies/trunks, neighboring buildings, and shop awnings. Doors open before the camera crosses their plane. Navigation paths are sampled with a clearance radius before movement; no per-frame physics sweep is claimed. The exterior lens widens responsively and returns to the existing interior lens near the entrance. Keep the center aisle and authored waypoints clear when moving architectural pieces. Camera positions and waypoint routes live together in `DESTINATIONS` in `js/showroom.js`.

## Photo inventory

Edit the `CARS` array in `js/cars.js`. Set a local `hero` image and add accurate `photographs` with `label`, `src`, and `credit`. Only use vehicle-specific imagery for the exact model/trim shown. Leave the photo array empty until verified photography is available; the inventory will mark it pending and will not invent a car image.

## Contact configuration

Set `WHATSAPP_NUMBER` near the top of `js/main.js` to the dealership's real WhatsApp number. Use international digits only, including Lebanon's `961` country code, without `+`, spaces, dashes, or a leading local zero. The floating button and both Contact views share this one setting and open `https://wa.me/<number>` in a new tab.

`YOUR_WHATSAPP_NUMBER_HERE` is intentionally not a working number. Until it is replaced, WhatsApp clicks show an email fallback instead of opening an invalid chat. The existing `hello@example.com` email and opening hours are placeholders to confirm before publishing; no telephone number or street address has been invented. The displayed dealership location is Lebanon.

The five section overlays use lightweight HTML/CSS and existing photographs/fonts. The WhatsApp brand icon is an inline CC0 Simple Icons asset with no runtime dependency. The Arrival Film link has been removed from the live page; the standalone `video-story/` files remain available. Location wording says Lebanon in the HTML, intro caption, and three existing 3D display-text strings. Rendering settings, showroom geometry, camera routes, intro animation, and loading behavior are not changed by this UI pass.

## Architecture and navigation

- `js/showroom.js` contains the architectural environment, paired entrance doors, PMREM HDR reflections, material loading/readiness gate, lighting, collision volumes, and named camera routes.
- `js/main.js` controls the arrival mode, destination navigation, section HTML, filters, photo detail view, and optional car-model loading.
- `js/story.js` contains the automatic, single-clock cloud-to-interior sequence; `js/realism-upgrade.js` contains optional post-processing and model-loading helpers.
- `js/cars3d.js` defines optional GLB display slots. Models are not included; missing files are skipped.
- `css/style.css` styles the environment overlay and HTML display surfaces.
- `js/cars.js` is the photo/inventory data source; it is not used to create 3D vehicle meshes.
- `assets/photos/` contains the local image assets and their credits are linked in the interface.
- `assets/logo/` and `assets/reference/` contain the supplied logo and dealership reference stills.

Tune the named camera positions in `DESTINATIONS`, the architecture in `buildExteriorFacade()`, `buildUpperLevels()`, and `buildRoof()`, and the cloud layer in `buildClouds()`. Camera and look control points live in `js/story.js`. Street trees use instanced irregular canopy volumes and branches, with fewer clusters for distant trees. No real vehicle models have been added or fabricated.
