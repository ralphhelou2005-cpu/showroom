import { gsap } from 'gsap';
import { CARS } from './cars.js';
import { Showroom, DESTINATIONS } from './showroom.js';

const $ = (selector) => document.querySelector(selector);
const money = (price) => `$${price.toLocaleString('en-US')}`;
const showroom = new Showroom($('#showroom-canvas'));
if (location.search.includes('debug')) window.__showroom = showroom;
let currentSection = 'home';
let activeCar = null;
let activePhoto = 0;
let navToken = 0;
let toastTimer;
let inventoryTrigger = null;

function revealWelcome() {
  setArrivalProgress('Almost ready...', 100);
  $('#arrival-curtain').classList.add('is-leaving');
  $('#world-header').classList.add('is-visible');
  $('#world-caption').classList.add('is-visible');
  $('#screen-home').classList.remove('is-active');
  $('#screen-home').setAttribute('aria-hidden', 'true');
  window.setTimeout(() => { $('#arrival-curtain').hidden = true; }, 1100);
  updateLocation('home');
}

function toast(message) {
  $('#toast').textContent = message;
  $('#toast').classList.add('is-visible');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => $('#toast').classList.remove('is-visible'), 3000);
}

function updateLocation(section) {
  const route = DESTINATIONS[section] ?? DESTINATIONS.home;
  $('#world-location-label').textContent = section === 'home' ? 'MAIN SHOWROOM' : route.label;
  document.querySelectorAll('#showroom-nav [data-destination]').forEach((button) => {
    const active = button.dataset.destination === section;
    button.classList.toggle('is-active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
}

function populateBrands() {
  const filter = $('#brand-filter');
  [...new Set(CARS.map((car) => car.brand))].sort().forEach((brand) => {
    if (![...filter.options].some((option) => option.value === brand)) filter.add(new Option(brand, brand));
  });
  document.querySelectorAll('.inventory-count').forEach((node) => { node.textContent = String(CARS.length).padStart(2, '0'); });
  const display = $('#brands-display');
  if (!display) return;
  display.innerHTML = [
     ['BMW', 'M performance · Precision · Motorsport heritage'],
     ['Mercedes-Benz', 'Craft · Innovation · Effortless touring'],
     ['Porsche', 'Engineering · Driver focus · Enduring form'],
     ['Audi', 'Progressive design · Technology · Precision'],
     ['Range Rover', 'Modern luxury · Capability · Open horizons'],
     ['Ferrari', 'Italian craft · Performance · Heritage'],
  ].map(([brand, description], index) => `<article class="screen-brand"><span>0${index + 1} · SELECTED MARQUE</span><strong>${brand}</strong><p>${description}</p></article>`).join('');
}

function sectionMarkup(section) {
  const labels = { inventory: ['LEFT WING · INVENTORY', 'Available <em>vehicles.</em>', 'Browse the current collection and choose a vehicle to explore.'], brands: ['RIGHT WING · BRANDS', 'Marques with <em>character.</em>', 'A considered selection of automotive houses.'], services: ['BACK LEFT · SERVICES', 'Thoughtful at <em>every turn.</em>', 'Personal support before, during, and after the drive.'], about: ['BACK RIGHT · ABOUT US', 'A house built <em>around the drive.</em>', 'Independent by nature. Personal by design.'], contact: ['FRONT DESK · CONTACT', 'We’ll put <em>the kettle on.</em>', 'Appointments are welcome. Let’s start with a conversation.'] };
  const [location, title, intro] = labels[section];
  $('#section-location').textContent = location;
  $('#section-footnote').textContent = section === 'inventory' ? 'PHOTOGRAPHED VEHICLES · STUTTGART' : 'ATELIER MOTORS · EST. 1988';
  if (section === 'inventory') {
    return `<div class="eyebrow"><i></i> THE COLLECTION</div><h2>${title}</h2><p>${intro}</p><div class="screen-inventory-filters"><input id="screen-search" type="search" placeholder="Search inventory" aria-label="Search inventory"><select id="screen-brand" aria-label="Filter by brand"><option value="">All marques</option>${[...new Set(CARS.map((car) => car.brand))].map((brand) => `<option>${brand}</option>`).join('')}</select><select id="screen-style" aria-label="Filter by style"><option value="">All styles</option><option>Coupe</option><option>Sedan</option><option>SUV</option><option>Performance</option><option>Luxury</option></select></div><div class="screen-inventory-grid" id="screen-inventory-grid"></div><div class="screen-inventory-count" id="screen-results-count"></div>`;
  }
  if (section === 'brands') return `<div class="eyebrow"><i></i> THE MARQUES</div><h2>${title}</h2><p>${intro}</p><div class="screen-brand-list" id="brands-display"></div>`;
  if (section === 'services') return `<div class="eyebrow"><i></i> BEYOND THE DRIVE</div><h2>${title}</h2><p>${intro}</p><div class="screen-service-list"><article class="screen-service"><span>01 · SALES</span><strong>Vehicle sales</strong></article><article class="screen-service"><span>02 · EXCHANGE</span><strong>Trade-in</strong></article><article class="screen-service"><span>03 · FINANCE</span><strong>Financing</strong></article><article class="screen-service"><span>04 · INSPECTION</span><strong>Vehicle inspection</strong></article><article class="screen-service"><span>05 · CARE</span><strong>Maintenance</strong></article><article class="screen-service"><span>06 · OWNERSHIP</span><strong>After-sales</strong></article></div>`;
  if (section === 'about') return `<div class="eyebrow"><i></i> OUR PHILOSOPHY</div><h2>${title}</h2><div class="about-story"><div><p>Atelier Motors is an independent automotive house built around thoughtful service, enduring design, and the pleasure of finding the right car.</p><div class="about-timeline"><div><b>1988</b><span>A personal automotive house opens in Stuttgart.</span></div><div><b>2005</b><span>A new generation brings a wider European collection.</span></div><div><b>TODAY</b><span>Independent by nature. Personal by design.</span></div></div></div><img src="assets/photos/showroom-interior.jpg" alt="A considered automotive gallery interior" loading="lazy"></div>`;
  return `<div class="eyebrow"><i></i> COME SAY HELLO</div><h2>${title}</h2><p>${intro}</p><div class="screen-contact-grid"><div><span>Telephone</span><a href="tel:+490000000000">+49 (0)00 0000 0000</a></div><div><span>WhatsApp</span><a href="https://wa.me/490000000000">Message our team ↗</a></div><div><span>Email</span><a href="mailto:hello@example.com">hello@example.com</a></div><div><span>Location</span><span>Showroom address, Stuttgart</span></div><div><span>Hours</span><span>Mon–Sat · 09:00–19:00</span></div></div>`;
}

function renderWorldInventory() {
  const query = $('#screen-search')?.value.trim().toLowerCase() ?? '';
  const brand = $('#screen-brand')?.value ?? '';
  const style = $('#screen-style')?.value ?? '';
  const filtered = CARS.filter((car) => `${car.name} ${car.brand} ${car.type} ${car.collection}`.toLowerCase().includes(query) && (!brand || car.brand === brand) && (!style || car.type === style || car.collection === style));
  $('#screen-inventory-grid').innerHTML = filtered.map((car) => `<article class="inventory-screen-card" data-car-id="${car.id}" tabindex="0"><div class="inventory-screen-card__image ${car.hero ? 'has-photo' : 'is-pending'}" ${car.hero ? `style="background-image:url('${car.hero}')"` : ''}></div><div class="inventory-screen-card__copy"><small>${car.brand} · ${car.year}</small><strong>${car.name}</strong><span>${car.priceLabel} · ${car.horsepower}</span><span class="inventory-model-status ${car.photographs.length ? '' : 'is-pending'}">${car.photographs.length ? 'Photos available' : 'Photos pending'}</span></div></article>`).join('');
  $('#screen-results-count').textContent = `${filtered.length} DISPLAYED · ${filtered.filter((car) => car.photographs.length).length} WITH VEHICLE PHOTOGRAPHY`;
}

function hideSectionScreen() {
  $('#screen-home').classList.remove('is-active');
  $('#screen-section').classList.remove('is-active');
  $('#screen-section').setAttribute('aria-hidden', 'true');
  closePanels();
  $('#vehicle-view').classList.remove('is-open');
  $('#vehicle-view').setAttribute('aria-hidden', 'true');
}

// Any section can be reached from any other; a new request simply replaces the one in flight.
function navigateTo(section) {
  if (showroom.entering || !DESTINATIONS[section]) return;
  if (section === 'home') { returnHome(); return; }
  if (section === currentSection) return;
  const previousSection = currentSection;
  const token = ++navToken;
  currentSection = section;
  hideSectionScreen();
  updateLocation(section);
  $('#screen-section').classList.remove('screen-left', 'screen-right', 'screen-back-left', 'screen-back-right', 'screen-front');
  $('#screen-section').classList.add(DESTINATIONS[section].screenClass);
  showroom.moveTo(section, (_route, safe) => {
    if (token !== navToken) return;
    if (!safe) {
      currentSection = previousSection;
      updateLocation(previousSection);
      if (previousSection !== 'home') {
        $('#screen-section').classList.add('is-active');
        $('#screen-section').setAttribute('aria-hidden', 'false');
      }
      toast('That walkway is temporarily unavailable. Please try another showroom area.');
      return;
    }
    $('#section-screen-content').innerHTML = sectionMarkup(section);
    $('#screen-section').classList.add('is-active');
    $('#screen-section').setAttribute('aria-hidden', 'false');
    if (section === 'inventory') {
      renderWorldInventory();
      ['screen-search', 'screen-brand', 'screen-style'].forEach((id) => $(`#${id}`).addEventListener(id === 'screen-search' ? 'input' : 'change', renderWorldInventory));
    }
    if (section === 'brands') populateBrands();
  });
}

function returnHome() {
  if (showroom.entering || currentSection === 'home') return;
  const token = ++navToken;
  currentSection = 'home';
  hideSectionScreen();
  updateLocation('home');
  showroom.moveTo('home', () => {
    if (token === navToken) updateLocation('home');
  });
}

function openCar(id) {
  const car = CARS.find((entry) => entry.id === id);
  if (!car) return;
  activeCar = car;
  activePhoto = 0;
  $('#detail-kicker').textContent = `${car.brand} · ${car.year}`;
  $('#detail-name').textContent = car.name;
  $('#detail-price').textContent = car.priceLabel;
  $('#detail-model-status').textContent = car.photographs.length ? 'ORIGINAL VEHICLE PHOTOGRAPHY' : 'VEHICLE PHOTOGRAPHY PENDING';
  $('#spec-grid').innerHTML = [['Engine', car.engine], ['Power', car.horsepower], ['Transmission', car.transmission], ['Fuel', car.fuel], ['Mileage', car.mileage], ['Body style', car.type]].map(([label, value]) => `<div class="detail-spec"><span>${label}</span><b>${value}</b></div>`).join('');
  renderGallery(car);
  $('#vehicle-view').classList.add('is-open');
  $('#vehicle-view').setAttribute('aria-hidden', 'false');
  $('#close-detail').focus({ preventScroll: true });
}

function renderGallery(car) {
  const photos = car.photographs;
  const photo = photos[activePhoto];
  const viewer = $('#vehicle-view');
  viewer.classList.toggle('has-pending-photos', !photo || photo.pending);
  if (photo && !photo.pending) {
    $('#detail-photo').removeAttribute('data-placeholder');
    $('#detail-photo').style.backgroundImage = `url('${photo.src}')`;
    $('#detail-photo').setAttribute('aria-label', `${car.name}, ${photo.label} photograph`);
    $('#photo-credit').textContent = photo.credit;
  } else {
    $('#detail-photo').style.backgroundImage = 'none';
    $('#detail-photo').dataset.placeholder = photo ? `${photo.label.toUpperCase()} PHOTOGRAPH PENDING · AUTHENTIC IMAGE IN PREPARATION` : 'VEHICLE PHOTOGRAPHY PENDING · AUTHENTIC IMAGES IN PREPARATION';
    $('#detail-photo').setAttribute('aria-label', `${car.name}, ${photo?.label ?? 'vehicle'} photograph pending`);
    $('#photo-credit').textContent = 'VEHICLE-SPECIFIC PHOTOGRAPHY PENDING';
  }
  $('#detail-pagination').innerHTML = photos.map((item, index) => `<button class="${index === activePhoto ? 'is-active' : ''}" data-photo-index="${index}" aria-label="${item.label}${item.pending ? ', photograph pending' : ''}"></button>`).join('');
  $('#gallery-thumbs').innerHTML = photos.length ? photos.map((item, index) => `<button class="gallery-thumb ${index === activePhoto ? 'is-active' : ''} ${item.pending ? 'is-pending' : ''}" data-photo-index="${index}" aria-label="${item.label}${item.pending ? ', photograph pending' : ''}">${item.pending ? `<span>${item.label} · PENDING</span>` : `<img src="${item.src}" alt="${item.label}" loading="lazy"><span>${item.label}</span>`}</button>`).join('') : '<div class="gallery-pending">Vehicle-specific photographs are being prepared.</div>';
  $('#gallery-count').textContent = photos.length ? `${String(activePhoto + 1).padStart(2, '0')} / ${String(photos.length).padStart(2, '0')}` : 'PHOTOGRAPHY PENDING';
  $('#next-photo').disabled = photos.length < 2;
  document.querySelectorAll('[data-photo-index]').forEach((button) => button.addEventListener('click', () => setPhoto(Number(button.dataset.photoIndex))));
}

function setPhoto(index) {
  if (!activeCar?.photographs.length) return;
  activePhoto = (index + activeCar.photographs.length) % activeCar.photographs.length;
  renderGallery(activeCar);
}

function stepVehicle(direction) {
  if (!activeCar) return;
  const index = CARS.findIndex((car) => car.id === activeCar.id);
  openCar(CARS[(index + direction + CARS.length) % CARS.length].id);
}

function panelOpen(panel) {
  closePanels(false);
  $('#panel-scrim').classList.add('is-open');
  panel.classList.add('is-open');
  panel.setAttribute('aria-hidden', 'false');
}

function closePanels() {
  $('#panel-scrim').classList.remove('is-open');
  $('#inventory-panel').classList.remove('is-open');
  $('#info-panel').classList.remove('is-open');
  $('#inventory-panel').setAttribute('aria-hidden', 'true');
  $('#info-panel').setAttribute('aria-hidden', 'true');
}

function openInventory() {
  inventoryTrigger = document.activeElement;
  renderInventory();
  panelOpen($('#inventory-panel'));
  $('#search-input').focus({ preventScroll: true });
}

function openInfo(section) {
  const content = {
    about: ['OUR PHILOSOPHY', 'A house built<br /><em>around the drive.</em>', '<p>Atelier Motors is an independent automotive house built around the pleasure of finding the right car. A considered collection, a personal welcome, and room to make up your own mind.</p><p>Since 1988, Stuttgart.</p>'],
    contact: ['COME SAY HELLO', 'We’ll put<br /><em>the kettle on.</em>', '<div class="screen-contact-grid"><div><span>Telephone</span><a href="tel:+490000000000">+49 (0)00 0000 0000</a></div><div><span>WhatsApp</span><a href="https://wa.me/490000000000">Message our team ↗</a></div><div><span>Email</span><a href="mailto:hello@example.com">hello@example.com</a></div><div><span>Location</span><span>Showroom address, Stuttgart</span></div><div><span>Hours</span><span>Mon–Sat · 09:00–19:00</span></div></div>'],
  }[section];
  if (!content) return;
  $('#info-eyebrow').textContent = content[0];
  $('#info-title').innerHTML = content[1];
  $('#info-content').innerHTML = content[2];
  panelOpen($('#info-panel'));
}

function showCredits() {
  openInfo('about');
  $('#info-eyebrow').textContent = 'IMAGE SOURCES';
  $('#info-title').innerHTML = 'Photographs,<br /><em>properly credited.</em>';
  $('#info-content').innerHTML = '<div class="screen-contact-grid"><div><span>BMW Welt at night</span><a href="https://commons.wikimedia.org/wiki/File:BMW_Welt_Night.jpg" target="_blank" rel="noreferrer">Richard Bartz · CC BY-SA 2.5 ↗</a></div><div><span>BMW M4 at BMW Welt</span><a href="https://commons.wikimedia.org/wiki/File:BMW_M4_in_der_BMW_Welt.jpg" target="_blank" rel="noreferrer">Strubbl · CC0 ↗</a></div><div><span>2021 BMW M4, exterior</span><a href="https://commons.wikimedia.org/wiki/File:2021_BMW_M4_Competition_G82_front.jpg" target="_blank" rel="noreferrer">LuvsMG481 · CC BY-SA 4.0 ↗</a></div><div><span>Editorial category photographs</span><a href="https://unsplash.com/license" target="_blank" rel="noreferrer">Unsplash License ↗</a></div></div>';
}

function wire() {
  $('#arrival-skip').addEventListener('click', finishArrival);
  document.querySelectorAll('[data-destination]').forEach((button) => button.addEventListener('click', () => navigateTo(button.dataset.destination)));
  $('#screen-back').addEventListener('click', returnHome);
  document.querySelector('.world-header .wordmark').addEventListener('click', (event) => { event.preventDefault(); navigateTo('home'); });
  $('#section-screen-content').addEventListener('click', (event) => {
    const carCard = event.target.closest('[data-car-id]');
    if (carCard) openCar(carCard.dataset.carId);
  });
  $('#section-screen-content').addEventListener('keydown', (event) => {
    const carCard = event.target.closest('[data-car-id]');
    if (carCard && (event.key === 'Enter' || event.key === ' ')) openCar(carCard.dataset.carId);
  });
  $('#inventory-results').addEventListener('click', (event) => {
    const card = event.target.closest('[data-car-id]');
    if (card) openCar(card.dataset.carId);
  });
  $('#inventory-results').addEventListener('keydown', (event) => {
    const card = event.target.closest('[data-car-id]');
    if (card && (event.key === 'Enter' || event.key === ' ')) openCar(card.dataset.carId);
  });
  $('#panel-scrim').addEventListener('click', closePanels);
  $('#inventory-close').addEventListener('click', () => {
    closePanels();
    (inventoryTrigger?.isConnected ? inventoryTrigger : document.querySelector('#showroom-nav [data-destination="inventory"]')).focus({ preventScroll: true });
  });
  $('#info-close').addEventListener('click', closePanels);
  document.querySelectorAll('[data-open="inventory"]').forEach((button) => button.addEventListener('click', openInventory));
  $('#contact-dealer').addEventListener('click', () => openInfo('contact'));
  $('#search-input').addEventListener('input', renderInventory);
  ['brand-filter', 'type-filter', 'price-filter', 'sort-filter'].forEach((id) => $(`#${id}`).addEventListener('change', renderInventory));
  $('#close-detail').addEventListener('click', () => {
    $('#vehicle-view').classList.remove('is-open');
    $('#vehicle-view').setAttribute('aria-hidden', 'true');
  });
  $('#close-detail-panel').addEventListener('click', () => { $('#vehicle-view').classList.remove('is-open'); $('#vehicle-view').setAttribute('aria-hidden', 'true'); });
  $('#next-photo').addEventListener('click', () => setPhoto(activePhoto + 1));
  $('#previous-vehicle').addEventListener('click', () => stepVehicle(-1));
  $('#next-vehicle').addEventListener('click', () => stepVehicle(1));
  $('#request-drive').addEventListener('click', () => {
    if (!activeCar) return;
    const subject = encodeURIComponent(`Private viewing: ${activeCar.name}`);
    const body = encodeURIComponent(`Hello Atelier Motors,\n\nI would like to arrange a private viewing of the ${activeCar.year} ${activeCar.brand} ${activeCar.name}.\n\nThank you.`);
    window.location.href = `mailto:hello@example.com?subject=${subject}&body=${body}`;
  });
  $('#show-credits').addEventListener('click', showCredits);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closePanels();
      if ($('#vehicle-view').classList.contains('is-open')) $('#vehicle-view').classList.remove('is-open');
      else if (currentSection !== 'home') returnHome();
    }
    if (event.key === 'ArrowLeft' && activeCar) stepVehicle(-1);
    if (event.key === 'ArrowRight' && activeCar) stepVehicle(1);
  });
  window.addEventListener('pagehide', () => showroom.dispose(), { once: true });
}

function renderInventory() {
  const query = $('#search-input').value.trim().toLowerCase();
  const brand = $('#brand-filter').value;
  const type = $('#type-filter').value;
  const maxPrice = Number($('#price-filter').value) || Infinity;
  const sort = $('#sort-filter').value;
  let cars = CARS.filter((car) => `${car.name} ${car.brand} ${car.type} ${car.collection}`.toLowerCase().includes(query) && (!brand || car.brand === brand) && (!type || car.type === type || car.collection === type) && car.price <= maxPrice);
  if (sort === 'price-asc') cars = cars.toSorted((a, b) => a.price - b.price);
  if (sort === 'price-desc') cars = cars.toSorted((a, b) => b.price - a.price);
  if (sort === 'year-desc') cars = cars.toSorted((a, b) => b.year - a.year);
  $('#results-count').textContent = `${String(cars.length).padStart(2, '0')} ${cars.length === 1 ? 'vehicle' : 'vehicles'}`;
  $('#inventory-results').innerHTML = cars.map((car) => `<article class="inventory-card" data-car-id="${car.id}" tabindex="0"><div class="inventory-swatch ${car.hero ? 'has-photo' : 'is-pending'}" ${car.hero ? `style="background-image:url('${car.hero}')"` : ''}></div><div class="inventory-copy"><small>${car.brand} · ${car.year}</small><strong>${car.name}</strong><span>${car.horsepower} · ${car.type}</span><span class="inventory-model-status ${car.photographs.length ? '' : 'is-pending'}">${car.photographs.length ? 'Photographs available' : 'Vehicle photography pending'}</span></div><span class="inventory-price">${money(car.price)}</span></article>`).join('') || '<p class="no-results">No vehicles match those filters.</p>';
}

function runEntrance() {
  const curtain = $('#arrival-curtain');
  curtain.classList.add('is-loading');
  setArrivalProgress('Preparing the showroom...', 2);
  showroom.onLoadProgress = (label, percentage) => setArrivalProgress(label, Math.min(23, Math.round(percentage * 0.23)));
  showroom.ready
    .then(() => showroom.stagesReady)
    .then(() => {
      showroom.onLoadProgress = null;
      curtain.classList.remove('is-loading');
      showroom.enter();
    });
}

function setArrivalProgress(label, percentage) {
  $('#arrival-status').textContent = label;
  $('#arrival-percentage').textContent = `${percentage}%`;
  $('#arrival-progress').style.width = `${percentage}%`;
}

function finishArrival() {
  if ($('#arrival-curtain').classList.contains('is-loading')) return;
  showroom.skipEntrance?.();
}

showroom.onEntranceProgress = setArrivalProgress;
showroom.onEntered = revealWelcome;
showroom.onSectionChange = updateLocation;
populateBrands();
wire();
runEntrance();
