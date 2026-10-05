# Atelier Motors — Spatial Showroom

The showroom uses Three.js for architecture, lighting, twin automatic sliding glass doors, and controlled camera travel between physical showroom areas. The building is the 3D experience; there are no vehicle meshes or GLB car models. Inventory and vehicle details remain photographic HTML/CSS interfaces.

## Run in Chrome

1. Open this folder in VS Code.
2. Select **Atelier Motors: Chrome** under **Run and Debug** and press F5, or run **Terminal → Run Task… → Run Atelier Motors showroom**.
3. Open `http://localhost:8001/` if using the task directly.

Three.js and GSAP are loaded via the browser import map. Architecture uses procedural materials and geometry. Vehicle photography lives under `assets/photos/` and appears only in the inventory and detail interfaces.

## Spatial layout

- Entrance: the camera starts outside the front threshold. Two separate transparent glass door panels slide outward while the camera advances into the interior.
- Center: floor-integrated circular reception ring, digital information display, and suspended atrium light feature.
- Left wing: illuminated inventory information gallery.
- Right wing: illuminated marque gallery.
- Back left: services.
- Back right: about.
- Front desk: contact.

The main screen opens on the unobstructed 3D center atrium. Open **Navigation** to choose a zone; the camera walks to that physical area before its HTML display appears. The selector is available on desktop and mobile without staying over the architecture.

The entrance route is authored as three clear stages: outside threshold, central entrance corridor, then the open center aisle. Static obstacle bounds cover the perimeter, furniture, reception, planters, columns, and navigation displays; every path is sampled with a camera clearance radius before movement, then swept against static and moving-door bounds during the animation. Keep the center aisle and the authored waypoints clear when moving architectural pieces. Camera positions and waypoint routes live together in `DESTINATIONS` in `js/showroom.js`.

## Photo inventory

Edit the `CARS` array in `js/cars.js`. Set a local `hero` image and add accurate `photographs` with `label`, `src`, and `credit`. Only use vehicle-specific imagery for the exact model/trim shown. Leave the photo array empty until verified photography is available; the inventory will mark it pending and will not invent a car image.

## Architecture and navigation

- `js/showroom.js` contains the architectural environment, paired entrance doors, generated PMREM reflections, polished stone floor, architectural lighting, collision volumes, and named camera routes.
- `js/main.js` controls the entrance sequence, destination navigation, section HTML, filters, and photo detail view.
- `css/style.css` styles the environment overlay and HTML display surfaces.
- `js/cars.js` is the photo/inventory data source; it is not used to create 3D vehicle meshes.
- `assets/photos/` contains the local image assets and their credits are linked in the interface.

Tune the named camera positions in the `DESTINATIONS` map in `js/showroom.js` to change the physical layout/section stops. Add or adjust architectural elements in `createEnvironment()` and its helper methods.
