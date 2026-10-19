import { gsap } from 'gsap';
import { CARS } from './cars.js';
import { Showroom, DESTINATIONS } from './showroom.js';
import { escapeHtml as escape, cssImage, safeEmail, whatsappNumber, uiIcon } from './content-utils.js';
import { SUPABASE_CONFIG } from './site-config.js';

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
let queuedDestination = null;
let WHATSAPP_NUMBER = 'YOUR_WHATSAPP_NUMBER_HERE';
let whatsappUrl = `https://wa.me/${WHATSAPP_NUMBER}`;
const fallbackWhatsapp = WHATSAPP_NUMBER;
let siteContent = {};
let publicDataStarted = false;
let publicDataState = 'fallback';
let stopPublicData;
let activeInfoSection;
if (SUPABASE_CONFIG.url || SUPABASE_CONFIG.publishableKey) {
  CARS.splice(0);
  publicDataState = 'loading';
}

function revealWelcome() {
  setArrivalProgress('Almost ready...', 100);
  $('#arrival-curtain').classList.add('is-leaving');
  $('#world-header').classList.add('is-visible');
  $('#world-caption').classList.add('is-visible');
  $('#return-exterior').classList.add('is-visible');
  $('#return-exterior').innerHTML = `${uiIcon()}<span>EXTERIOR</span>`;
  $('#return-exterior').setAttribute('aria-label', 'Return to the dealership exterior');
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
  const selected = filter.value;
  filter.replaceChildren(new Option('All marques', ''));
  [...new Set(CARS.map((car) => car.brand))].sort().forEach((brand) => {
    if (![...filter.options].some((option) => option.value === brand)) filter.add(new Option(brand, brand));
  });
  filter.value = [...filter.options].some((option) => option.value === selected) ? selected : '';
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
  ].map(([brand, description], index) => `<article class="screen-brand" data-marque="${brand}"><span class="marque-index">0${index + 1} / SELECTED MARQUE</span><strong>${brand}</strong><p>${description}</p></article>`).join('');
}

function contactDetailsMarkup() {
  const contact = siteContent.contact ?? {};
  const email = contactEmail();
  return `<div class="contact-actions"><a class="contact-action contact-action--whatsapp" data-whatsapp href="${escape(whatsappUrl)}" target="_blank" rel="noopener noreferrer">Message on WhatsApp ${uiIcon()}</a><a class="contact-action" href="mailto:${escape(email)}">Send an email ${uiIcon()}</a></div><div class="screen-contact-grid"><div><span>LOCATION</span><strong>${escape(contact.address ?? 'Lebanon')}</strong><small>Private viewings by appointment</small></div><div><span>OPENING HOURS</span><strong>${escape(contact.hours ?? 'Mon–Sat · 09:00–19:00')}</strong><small>A personal welcome awaits</small></div><div><span>EMAIL</span><a href="mailto:${escape(email)}">${escape(email)}</a></div><div><span>TELEPHONE</span><strong>${escape(contact.phone || 'Details on request')}</strong><small>Contact our team to arrange a call</small></div></div>`;
}

function contactEmail() { return safeEmail(siteContent.contact?.email) || 'hello@example.com'; }
function aboutParagraphs() {
  const about = siteContent.about;
  return about ? `<p>${escape(about.paragraph1)}</p><p>${escape(about.paragraph2)}</p>` : '<p>AUTO HAUS GROUP is an independent automotive house built around thoughtful service, enduring design, and the pleasure of finding the right car.</p><p>A considered collection, a personal welcome, and room to make up your own mind.</p>';
}

function sectionMarkup(section) {
  $('#section-screen-content').scrollTop = 0;
  const labels = {
    inventory: ['LEFT WING · INVENTORY', 'THE COLLECTION', 'Available <em>vehicles.</em>', 'Distinctive cars. Thoughtfully selected.'],
    brands: ['RIGHT WING · BRANDS', 'THE MARQUES', 'Marques with <em>character.</em>', 'Different expressions of the same passion for the drive.'],
    services: ['BACK LEFT · SERVICES', 'BEYOND THE DRIVE', 'Every detail. <em>Considered.</em>', 'Personal support before, during, and after the drive.'],
    about: ['BACK RIGHT · ABOUT US', 'AUTO HAUS GROUP', 'A house built <em>around the drive.</em>', 'Independent by nature. Personal by design. Based in Lebanon.'],
    contact: ['FRONT DESK · CONTACT', 'A PERSONAL WELCOME', 'Let’s <em>talk.</em>', 'Your next car starts with a conversation. Our team in Lebanon is here for you.'],
  };
  const [location, eyebrow, title, intro] = labels[section];
  $('#section-location').textContent = location;
  $('#section-footnote').textContent = section === 'inventory' ? 'A CONSIDERED COLLECTION' : 'PERSONAL BY DESIGN';
  const copy = siteContent.copy ?? {};
  const customTitle = copy[`${section}_title`];
  const headingTitle = customTitle === undefined || customTitle === title.replace(/<\/?em>/g, '') ? title : escape(customTitle);
  const heading = `<header class="section-intro"><span class="eyebrow">${eyebrow}</span><h2>${headingTitle}</h2><p>${escape(copy[`${section}_intro`] ?? intro)}</p></header>`;
  if (section === 'inventory') {
    return `${heading}<div class="screen-inventory-filters"><label class="inventory-field inventory-field--search"><span>Search the collection</span><input id="screen-search" type="search" placeholder="Model, marque or style" aria-label="Search inventory"></label><label class="inventory-field"><span>Marque</span><select id="screen-brand" aria-label="Filter by brand"><option value="">All marques</option>${[...new Set(CARS.map((car) => car.brand))].map((brand) => `<option>${escape(brand)}</option>`).join('')}</select></label><label class="inventory-field"><span>Body style</span><select id="screen-style" aria-label="Filter by style"><option value="">All styles</option>${[...new Set(['Coupe','Sedan','SUV','Performance','Luxury',...CARS.map((car) => car.type),...CARS.map((car) => car.collection)])].filter(Boolean).map((style) => `<option>${escape(style)}</option>`).join('')}</select></label></div><div class="inventory-toolbar"><span id="screen-results-count" role="status" aria-live="polite"></span><button class="filter-reset" type="button" data-reset-inventory aria-label="Clear inventory filters" title="Clear filters">${uiIcon('rotate-ccw')}</button></div><div class="screen-inventory-grid" id="screen-inventory-grid"></div>`;
  }
  if (section === 'brands') return `${heading}<div class="screen-brand-list" id="brands-display"></div><div class="section-next-step"><span>Find the marque that feels like you.</span><button type="button" class="section-action" data-section-target="inventory">Explore the collection ${uiIcon()}</button></div>`;
  if (section === 'services') {
    const services = [
      ['01', 'Vehicle sales', 'A considered collection and personal guidance to find your next car.'],
      ['02', 'Trade-in', 'A thoughtful next step for the car you own and the one you want.'],
      ['03', 'Financing', 'Discuss purchase options that suit your plans and priorities.'],
      ['04', 'Vehicle inspection', 'A closer look at the details that matter before you decide.'],
      ['05', 'Maintenance', 'Care and attention to keep every journey feeling right.'],
      ['06', 'After-sales', 'A familiar point of contact throughout your ownership.'],
    ];
    const entries = siteContent.services?.items?.map((item,index) => [String(index+1).padStart(2,'0'),item.title,item.description]) ?? services;
    return `${heading}<div class="screen-service-list">${entries.map(([number, name, description]) => `<article class="screen-service"><span>${number} / AT YOUR SERVICE</span><strong>${escape(name)}</strong><p>${escape(description)}</p></article>`).join('')}</div><div class="section-next-step"><span>From the first conversation to the next chapter.</span><button type="button" class="section-action" data-section-target="contact">Speak to our team ${uiIcon()}</button></div>`;
  }
  if (section === 'about') {
    const values = siteContent.about?.values ?? [{title:'Curated',description:'Distinctive vehicles, thoughtfully selected.'},{title:'Personal',description:'Care and attention, at every step.'},{title:'Lebanon',description:'A local welcome. An international outlook.'}];
    return `${heading}<div class="about-story"><div>${aboutParagraphs()}<div class="about-timeline">${values.map((value) => `<div><b>${escape(value.title)}</b><span>${escape(value.description)}</span></div>`).join('')}</div></div><figure class="about-photo"><img src="assets/photos/showroom-interior.jpg" alt="An automotive gallery with performance cars on display" loading="lazy" decoding="async"><figcaption>Space to discover. Time to decide.</figcaption></figure></div><div class="section-next-step"><span>We look forward to welcoming you.</span><button type="button" class="section-action" data-section-target="contact">Arrange a visit ${uiIcon()}</button></div>`;
  }
  return `${heading}${contactDetailsMarkup()}`;
}

function renderWorldInventory() {
  const query = $('#screen-search')?.value.trim().toLowerCase() ?? '';
  const brand = $('#screen-brand')?.value ?? '';
  const style = $('#screen-style')?.value ?? '';
  const filtered = CARS.filter((car) => `${car.name} ${car.brand} ${car.type} ${car.collection}`.toLowerCase().includes(query) && (!brand || car.brand === brand) && (!style || car.type === style || car.collection === style));
  $('#screen-inventory-grid').innerHTML = filtered.map((car) => `<article class="inventory-screen-card" data-car-id="${escape(car.id)}" role="button" aria-label="Explore ${escape(car.brand)} ${escape(car.name)}, ${escape(car.year)}, ${escape(car.priceLabel)}" tabindex="0"><div class="inventory-screen-card__image ${car.hero ? 'has-photo' : 'is-pending'}">${car.hero ? `<img src="${escape(car.hero)}" alt="${escape(car.brand)} ${escape(car.name)}" loading="lazy" decoding="async">` : `<span class="pending-marque" aria-hidden="true">${escape(car.brand)}</span><span class="photo-pending-label">Photography pending</span>`}</div><div class="inventory-screen-card__copy"><div class="vehicle-card-meta"><small>${escape(car.brand)}</small><span>${escape(car.year)}</span></div><strong>${escape(car.name)}</strong><div class="vehicle-card-specs"><span>${escape(car.horsepower)}</span><span>${escape(car.type)}</span></div><div class="vehicle-card-footer"><b>${escape(car.priceLabel)}</b>${uiIcon()}</div></div></article>`).join('') || (publicDataState === 'loading' ? '<div class="inventory-empty" role="status"><strong>Loading available vehicles...</strong></div>' : publicDataState === 'error' ? '<div class="inventory-empty" role="status"><strong>Inventory temporarily unavailable.</strong><p>Please contact our team for current availability.</p></div>' : `<div class="inventory-empty"><strong>No vehicles found.</strong><p>Try another model, marque or body style.</p><button type="button" class="section-action" data-reset-inventory>Clear filters ${uiIcon('rotate-ccw')}</button></div>`);
  $('#screen-results-count').textContent = `${filtered.length} ${filtered.length === 1 ? 'vehicle' : 'vehicles'} · ${filtered.filter((car) => car.photographs.length).length} with photography`;
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
async function navigateTo(section) {
  if (showroom.entering || !DESTINATIONS[section]) return;
  if (showroom.outside) {
    queuedDestination = section === 'home' ? null : section;
    showroom.enter();
    return;
  }
  if (section === 'home') { returnHome(); return; }
  if (section === currentSection) return;
  const previousSection = currentSection;
  const token = ++navToken;
  if (!showroom.sectionsReady) {
    await showroom.prepareSections();
    if (token !== navToken) return;
  }
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

function returnHome(onComplete) {
  if (showroom.entering) return;
  const token = ++navToken;
  if (currentSection === 'home') {
    if (showroom.outside) showroom.enter();
    onComplete?.();
    return;
  }
  currentSection = 'home';
  hideSectionScreen();
  updateLocation('home');
  showroom.moveTo('home', (_route, safe) => {
    if (token === navToken) updateLocation('home');
    if (safe) onComplete?.();
  });
}

function returnExterior() {
  if (showroom.entering || showroom.transitioning || showroom.outside) return;
  const exit = () => showroom.exit();
  if (currentSection === 'home') exit();
  else returnHome(exit);
}

function openCar(id, preservePosition = false) {
  const car = CARS.find((entry) => entry.id === id);
  if (!car) return;
  activeCar = car;
  activePhoto = preservePosition ? Math.min(activePhoto, Math.max(0,car.photographs.length - 1)) : 0;
  $('#detail-kicker').textContent = `${car.brand} · ${car.year}`;
  $('#detail-name').textContent = car.name;
  $('#detail-price').textContent = car.priceLabel;
  $('#detail-model-status').textContent = car.photographs.length ? 'ORIGINAL VEHICLE PHOTOGRAPHY' : 'VEHICLE PHOTOGRAPHY PENDING';
  $('#spec-grid').innerHTML = [['Engine', car.engine], ['Power', car.horsepower], ['Transmission', car.transmission], ['Fuel', car.fuel], ['Mileage', car.mileage], ['Body style', car.type], ...(car.color ? [['Color',car.color]] : []), ...Object.entries(car.specifications ?? {})].map(([label, value]) => `<div class="detail-spec"><span>${escape(label)}</span><b>${escape(value)}</b></div>`).join('') + (car.description ? `<div class="detail-spec" style="grid-column:1 / -1;overflow-wrap:anywhere"><span>Description</span><p>${escape(car.description)}</p></div>` : '');
  renderGallery(car);
  $('#vehicle-view').classList.add('is-open');
  $('#vehicle-view').setAttribute('aria-hidden', 'false');
  if (!preservePosition) $('#close-detail').focus({ preventScroll: true });
}

function renderGallery(car) {
  const photos = car.photographs;
  const photo = photos[activePhoto];
  const viewer = $('#vehicle-view');
  viewer.classList.toggle('has-pending-photos', !photo || photo.pending);
  if (photo && !photo.pending) {
    $('#detail-photo').removeAttribute('data-placeholder');
    $('#detail-photo').style.backgroundImage = cssImage(photo.src);
    $('#detail-photo').setAttribute('aria-label', `${car.name}, ${photo.label} photograph`);
    $('#photo-credit').textContent = photo.credit;
  } else {
    $('#detail-photo').style.backgroundImage = 'none';
    $('#detail-photo').dataset.placeholder = photo ? `${photo.label.toUpperCase()} PHOTOGRAPH PENDING · AUTHENTIC IMAGE IN PREPARATION` : 'VEHICLE PHOTOGRAPHY PENDING · AUTHENTIC IMAGES IN PREPARATION';
    $('#detail-photo').setAttribute('aria-label', `${car.name}, ${photo?.label ?? 'vehicle'} photograph pending`);
    $('#photo-credit').textContent = 'VEHICLE-SPECIFIC PHOTOGRAPHY PENDING';
  }
  $('#detail-pagination').innerHTML = photos.map((item, index) => `<button class="${index === activePhoto ? 'is-active' : ''}" data-photo-index="${index}" aria-label="${escape(item.label)}${item.pending ? ', photograph pending' : ''}"></button>`).join('');
  $('#gallery-thumbs').innerHTML = photos.length ? photos.map((item, index) => `<button class="gallery-thumb ${index === activePhoto ? 'is-active' : ''} ${item.pending ? 'is-pending' : ''}" data-photo-index="${index}" aria-label="${escape(item.label)}${item.pending ? ', photograph pending' : ''}">${item.pending ? `<span>${escape(item.label)} · PENDING</span>` : `<img src="${escape(item.src)}" alt="${escape(item.label)}" loading="lazy"><span>${escape(item.label)}</span>`}</button>`).join('') : '<div class="gallery-pending">Vehicle-specific photographs are being prepared.</div>';
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
    about: ['OUR PHILOSOPHY', 'A house built<br /><em>around the drive.</em>', '<p>AUTO HAUS GROUP is an independent automotive house built around the pleasure of finding the right car. A considered collection, a personal welcome, and room to make up your own mind.</p><p>Lebanon.</p>'],
    contact: ['A PERSONAL WELCOME', 'Let’s<br /><em>talk.</em>', contactDetailsMarkup()],
  }[section];
  if (!content) return;
  activeInfoSection = section;
  if (section === 'about' && siteContent.about) content[2] = aboutParagraphs();
  if (siteContent.copy?.[`${section}_title`] !== undefined) content[1] = escape(siteContent.copy[`${section}_title`]);
  $('#info-eyebrow').textContent = content[0];
  $('#info-title').innerHTML = content[1];
  $('#info-content').innerHTML = content[2];
  panelOpen($('#info-panel'));
}

function showCredits() {
  openInfo('about');
  activeInfoSection = 'credits';
  $('#info-eyebrow').textContent = 'IMAGE SOURCES';
  $('#info-title').innerHTML = 'Photographs,<br /><em>properly credited.</em>';
  $('#info-content').innerHTML = `<div class="screen-contact-grid"><div><span>BMW Welt at night</span><a href="https://commons.wikimedia.org/wiki/File:BMW_Welt_Night.jpg" target="_blank" rel="noreferrer">Richard Bartz · CC BY-SA 2.5 ${uiIcon()}</a></div><div><span>BMW M4 at BMW Welt</span><a href="https://commons.wikimedia.org/wiki/File:BMW_M4_in_der_BMW_Welt.jpg" target="_blank" rel="noreferrer">Strubbl · CC0 ${uiIcon()}</a></div><div><span>2021 BMW M4, exterior</span><a href="https://commons.wikimedia.org/wiki/File:2021_BMW_M4_Competition_G82_front.jpg" target="_blank" rel="noreferrer">LuvsMG481 · CC BY-SA 4.0 ${uiIcon()}</a></div><div><span>Editorial category photographs</span><a href="https://unsplash.com/license" target="_blank" rel="noreferrer">Unsplash License ${uiIcon()}</a></div></div>`;
}

function wire() {
  $('#whatsapp-link').href = whatsappUrl;
  document.addEventListener('click', (event) => {
    if (event.target.closest('[data-whatsapp]') && !/^\d{8,15}$/.test(WHATSAPP_NUMBER)) {
      event.preventDefault();
      toast(`WhatsApp is not available yet. Please email ${contactEmail()}.`);
    }
  });
  $('#arrival-skip').addEventListener('click', finishArrival);
  const rememberSkip = $('#remember-skip');
  try { rememberSkip.checked = localStorage.getItem('auto-haus-skip-intro') === 'true'; } catch {}
  rememberSkip.addEventListener('change', () => {
    try { localStorage.setItem('auto-haus-skip-intro', String(rememberSkip.checked)); } catch {}
  });
  $('#return-exterior').addEventListener('click', () => {
    if (showroom.outside) returnHome();
    else returnExterior();
  });
  document.querySelectorAll('[data-destination]').forEach((button) => button.addEventListener('click', () => navigateTo(button.dataset.destination)));
  $('#screen-back').addEventListener('click', () => returnHome());
  document.querySelector('.world-header .wordmark').addEventListener('click', (event) => { event.preventDefault(); navigateTo('home'); });
  $('#section-screen-content').addEventListener('click', (event) => {
    const sectionTarget = event.target.closest('[data-section-target]');
    if (sectionTarget) navigateTo(sectionTarget.dataset.sectionTarget);
    if (event.target.closest('[data-reset-inventory]')) {
      ['screen-search', 'screen-brand', 'screen-style'].forEach((id) => { $(`#${id}`).value = ''; });
      renderWorldInventory();
    }
    const carCard = event.target.closest('[data-car-id]');
    if (carCard) openCar(carCard.dataset.carId);
  });
  $('#section-screen-content').addEventListener('keydown', (event) => {
    const carCard = event.target.closest('[data-car-id]');
    if (carCard && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      openCar(carCard.dataset.carId);
    }
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
    const body = encodeURIComponent(`Hello AUTO HAUS GROUP,\n\nI would like to arrange a private viewing of the ${activeCar.year} ${activeCar.brand} ${activeCar.name}.\n\nThank you.`);
    window.location.href = `mailto:${encodeURIComponent(contactEmail())}?subject=${subject}&body=${body}`;
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
  $('#inventory-results').innerHTML = cars.map((car) => `<article class="inventory-card" data-car-id="${escape(car.id)}" tabindex="0"><div class="inventory-swatch ${car.hero ? 'has-photo' : 'is-pending'}" ${car.hero ? `style="background-image:${escape(cssImage(car.hero))}"` : ''}></div><div class="inventory-copy"><small>${escape(car.brand)} · ${escape(car.year)}</small><strong>${escape(car.name)}</strong><span>${escape(car.horsepower)} · ${escape(car.type)}</span><span class="inventory-model-status ${car.photographs.length ? '' : 'is-pending'}">${car.photographs.length ? 'Photographs available' : 'Vehicle photography pending'}</span></div><span class="inventory-price">${money(car.price)}</span></article>`).join('') || `<p class="no-results">${publicDataState === 'loading' ? 'Loading available vehicles...' : publicDataState === 'error' ? 'Inventory temporarily unavailable. Please contact our team.' : 'No vehicles match those filters.'}</p>`;
}

function applyPublicSnapshot(snapshot) {
  const previous = activeCar?.id;
  const detailOpen = $('#vehicle-view').classList.contains('is-open');
  CARS.splice(0, CARS.length, ...snapshot.cars);
  siteContent = snapshot.content;
  publicDataState = 'ready';
  WHATSAPP_NUMBER = siteContent.contact ? whatsappNumber(siteContent.contact.whatsapp) : fallbackWhatsapp;
  whatsappUrl = `https://wa.me/${WHATSAPP_NUMBER}`;
  $('#whatsapp-link').href = whatsappUrl;
  populateBrands();
  const typeFilter = $('#type-filter');
  const selectedType = typeFilter.value;
  typeFilter.replaceChildren(new Option('All styles',''));
  [...new Set(['Sedan','Coupe','SUV','Performance','Luxury',...CARS.map((car) => car.type),...CARS.map((car) => car.collection)])].filter(Boolean).forEach((style) => typeFilter.add(new Option(style,style)));
  typeFilter.value = [...typeFilter.options].some((option) => option.value === selectedType) ? selectedType : '';
  renderInventory();
  if (currentSection !== 'home' && $('#screen-section').classList.contains('is-active')) {
    const container = $('#section-screen-content');
    const scrollTop = container.scrollTop;
    const filters = ['screen-search','screen-brand','screen-style'].map((id) => $(`#${id}`)?.value ?? '');
    const focusedId = document.activeElement?.id;
    const caret = focusedId === 'screen-search' ? $('#screen-search').selectionStart : null;
    container.innerHTML = sectionMarkup(currentSection);
    if (currentSection === 'inventory') {
      ['screen-search','screen-brand','screen-style'].forEach((id,index) => {
        const input = $(`#${id}`);
        input.value = filters[index];
        input.addEventListener(id === 'screen-search' ? 'input' : 'change',renderWorldInventory);
      });
      renderWorldInventory();
      if (focusedId) {
        $(`#${focusedId}`)?.focus({preventScroll:true});
        if (caret !== null) $('#screen-search').setSelectionRange(caret,caret);
      }
    }
    if (currentSection === 'brands') populateBrands();
    container.scrollTop = scrollTop;
  }
  if (detailOpen && previous) {
    if (CARS.some((car) => car.id === previous)) openCar(previous,true);
    else { activeCar = null; $('#vehicle-view').classList.remove('is-open'); $('#vehicle-view').setAttribute('aria-hidden','true'); }
  } else if (previous) activeCar = CARS.find((car) => car.id === previous) ?? null;
  if ($('#info-panel').classList.contains('is-open') && ['about','contact'].includes(activeInfoSection)) openInfo(activeInfoSection);
}

function schedulePublicData() {
  if (publicDataStarted) return;
  publicDataStarted = true;
  const connect = () => {
    if (showroom.isIntroPlaying || showroom.entering || showroom.transitioning) { window.setTimeout(connect,1500); return; }
    import('./public-data.js').then(({startPublicData}) => startPublicData({
      canRefresh: () => !showroom.isIntroPlaying && !showroom.entering && !showroom.transitioning,
      onUpdate: applyPublicSnapshot,
      onState: (status) => {
        publicDataState = status;
        if ($('#screen-inventory-grid') && currentSection === 'inventory') renderWorldInventory();
        if ($('#inventory-panel').classList.contains('is-open')) renderInventory();
      },
    })).then((stop) => { stopPublicData = stop; }).catch((error) => console.warn('Online inventory unavailable',error));
  };
  window.setTimeout(() => {
    if ('requestIdleCallback' in window) window.requestIdleCallback(connect,{timeout:5000});
    else connect();
  },2000);
  window.addEventListener('pagehide',() => stopPublicData?.(),{once:true});
}

function runEntrance() {
  const curtain = $('#arrival-curtain');
  curtain.classList.add('is-loading');
  setArrivalProgress('Preparing the showroom...', 2);
  showroom.onLoadProgress = (label, percentage) => setArrivalProgress(label, percentage);
  showroom.ready.then(() => {
    showroom.onLoadProgress = null;
    curtain.classList.remove('is-loading');
    const params = new URLSearchParams(location.search);
    const direct = rememberIntroSkip() || location.hash === '#live' || params.has('layout') || params.has('nostory');
    if (direct) {
      showroom.setTimeOfDay?.(0.35);
      showroom.cloudLayer.visible = false;
      showroom.introduce(true);
    } else {
      showroom.startStory().then((started) => {
        if (started) {
          curtain.classList.add('is-leaving');
          window.setTimeout(() => { curtain.hidden = true; }, 1100);
        } else {
          showroom.introduce(false);
        }
      });
    }
    showroom.stagesReady.then(() => import('./cars3d.js')).then((cars) => cars.placeCars(showroom)).catch((error) => console.warn('3D cars unavailable', error));
    return showroom.stagesReady;
  });
}

function rememberIntroSkip() {
  try { return localStorage.getItem('auto-haus-skip-intro') === 'true'; } catch { return false; }
}

function registerAssetCache() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  navigator.serviceWorker.register('sw.js').catch((error) => console.warn('Asset cache unavailable', error));
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
showroom.onEntered = (safe) => {
  revealWelcome();
  if (safe) showroom.prepareSections().catch((error) => console.error('Section preparation failed', error));
  const destination = queuedDestination;
  queuedDestination = null;
  if (safe && destination) navigateTo(destination);
  if (safe) schedulePublicData();
};
showroom.onExited = () => {
  $('#screen-home').classList.remove('is-active');
  $('#screen-home').setAttribute('aria-hidden', 'true');
  $('#return-exterior').innerHTML = `${uiIcon()}<span>ENTER SHOWROOM</span>`;
  $('#return-exterior').setAttribute('aria-label', 'Enter the showroom');
};
showroom.onSectionChange = updateLocation;
populateBrands();
wire();
registerAssetCache();
runEntrance();
