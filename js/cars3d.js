export const CAR_SLOTS = [];

export async function placeCars(showroom, slots = CAR_SLOTS) {
  const placed = [];
  if (!slots.length) return placed;
  const { loadCar } = await import('./realism-upgrade.js');
  for (const slot of slots) {
    try {
      const car = await loadCar(showroom, slot.url, slot);
      placed.push({ slot, ...car });
    } catch {
      // Missing models are optional; the photo inventory remains available.
    }
  }
  if (placed.length) console.info(`Placed ${placed.length} car model(s).`);
  if (location.search.includes('layout')) enableLayoutMode(showroom, placed);
  return placed;
}

function enableLayoutMode(showroom, placed) {
  if (!placed.length) return;
  let index = 0;
  const note = () => {
    const { group, slot } = placed[index];
    const { x, z } = group.position;
    console.info(`${slot.id}: position: [${x.toFixed(2)}, 0, ${z.toFixed(2)}], rotationY: ${group.rotation.y.toFixed(2)}, scale: ${group.scale.x.toFixed(2)}`);
  };
  window.addEventListener('keydown', (event) => {
    const { group } = placed[index];
    const step = event.shiftKey ? 0.5 : 0.1;
    let handled = true;
    if (event.key === 'Tab') index = (index + 1) % placed.length;
    else if (event.key === 'ArrowLeft') group.position.x -= step;
    else if (event.key === 'ArrowRight') group.position.x += step;
    else if (event.key === 'ArrowUp') group.position.z -= step;
    else if (event.key === 'ArrowDown') group.position.z += step;
    else if (event.key === '[') group.rotation.y -= 0.08;
    else if (event.key === ']') group.rotation.y += 0.08;
    else if (event.key === '-') group.scale.multiplyScalar(0.98);
    else if (event.key === '=' || event.key === '+') group.scale.multiplyScalar(1.02);
    else if (event.key.toLowerCase() !== 'p') handled = false;
    if (!handled) return;
    event.preventDefault();
    showroom.shadowDirty = true;
    showroom.requestRender();
    note();
  });
  note();
}
