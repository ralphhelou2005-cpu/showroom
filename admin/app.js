import { createClient } from '@supabase/supabase-js';
import { createIcons, LayoutDashboard, CarFront, FileText, LogOut, Plus, Search, RefreshCw, ArrowLeft, Trash2, Save, Upload, Image as ImageIcon, Check, ChevronUp, ChevronDown, ExternalLink, Eye, EyeOff, LoaderCircle, X, Mail, LockKeyhole } from 'lucide';
import { validateSupabaseConfig } from '../js/site-config.js';
import { escapeHtml as escape, safeImageUrl } from '../js/content-utils.js';
import { ensure, readAll, signImages, optimizePhoto, validatePhotoFile, vehiclePayload, saveVehicle, cleanupStorage } from './data.js';
import { overview, inventory, inventoryResults, editor, photoGrid, specRow, contentEditor, contentItem } from './views.js';

const app = document.querySelector('#admin-app');
const logoUrl = new URL('../assets/logo/logo-white.png', import.meta.url).href;
const state = { client: null, user: null, authorized: false, view: 'overview', busy: false, dirty: false, vehicles: [], contents: [], draft: null, images: [], authNonce: 0, projectUrl: '', loaded: false };
const recovery = new URLSearchParams(location.hash.slice(1)).get('type');
let recovering = recovery === 'recovery' || recovery === 'invite';
let notificationTimer;

function icon(name) { return `<i data-lucide="${name}" aria-hidden="true"></i>`; }
function icons() {
  createIcons({ icons: { LayoutDashboard, CarFront, FileText, LogOut, Plus, Search, RefreshCw, ArrowLeft, Trash2, Save, Upload, Image: ImageIcon, Check, ChevronUp, ChevronDown, ExternalLink, Eye, EyeOff, LoaderCircle, X, Mail, LockKeyhole }, attrs: { 'stroke-width': 1.7, 'aria-hidden': 'true' } });
}
function notify(message, error = false) {
  const element = document.querySelector('#notification');
  element.textContent = message;
  element.classList.toggle('error', error);
  element.hidden = false;
  clearTimeout(notificationTimer);
  notificationTimer = setTimeout(() => { element.hidden = true; }, error ? 10000 : 5000);
}
function showFormStatus(message, error = false) {
  const element = document.querySelector('#form-status');
  if (!element) { notify(message, error); return; }
  element.textContent = message;
  element.classList.toggle('error', error);
}
function setBusy(busy) {
  state.busy = busy;
  app.setAttribute('aria-busy', String(busy));
  app.querySelectorAll('[data-busy-control], fieldset').forEach((element) => { element.disabled = busy; });
}
function brand() { return `<div class="brand-lockup"><img src="${logoUrl}" alt="AUTO HAUS GROUP"><span>Private administration</span></div>`; }
function gate(message = '', heading = 'Staff sign in') {
  state.authorized = false;
  app.setAttribute('aria-busy', 'false');
  app.innerHTML = `<main class="gate"><div class="gate-inner">${brand()}<form class="gate-form" id="login-form"><h1>${heading}</h1>${state.client ? `<label class="field"><span>Email</span><input name="email" type="email" autocomplete="username" required maxlength="254" data-busy-control></label><label class="field"><span>Password</span><div class="password-input"><input id="password" name="password" type="password" autocomplete="current-password" required data-busy-control><button type="button" class="icon-button" data-action="password-visibility" aria-label="Show password" title="Show password">${icon('eye')}</button></div></label><button class="button" type="submit" data-busy-control>${icon('lock-keyhole')} Sign in</button><button class="button text-button" type="button" data-action="reset-password" data-busy-control>Forgot password?</button>` : ''}<p id="form-status" class="form-status ${message ? 'error' : ''}" role="status">${escape(message)}</p></form><div class="gate-footer"><a href="../">Return to showroom</a></div></div></main>`;
  icons();
}
function denied() {
  state.authorized = false;
  state.vehicles = [];
  state.contents = [];
  state.dirty = false;
  app.setAttribute('aria-busy', 'false');
  app.innerHTML = `<main class="gate"><div class="gate-inner">${brand()}<section class="gate-form"><h1>Access restricted</h1><p class="form-status error">This account is not authorized to administer AUTO HAUS GROUP.</p><p class="form-status">${escape(state.user?.email)}</p><button class="button secondary" data-action="logout">${icon('log-out')} Sign out</button></section></div></main>`;
  icons();
}
function passwordForm() {
  app.setAttribute('aria-busy', 'false');
  app.innerHTML = `<main class="gate"><div class="gate-inner">${brand()}<form class="gate-form" id="password-form"><h1>Set your password</h1><label class="field"><span>New password</span><input name="password" type="password" autocomplete="new-password" minlength="12" required data-busy-control></label><label class="field"><span>Confirm password</span><input name="confirm" type="password" autocomplete="new-password" minlength="12" required data-busy-control></label><p id="form-status" class="form-status" role="status"></p><button class="button" data-busy-control>${icon('save')} Save password</button><button type="button" class="button text-button" data-action="logout">Sign out</button></form></div></main>`;
  icons();
}
async function authorize(session) {
  const nonce = ++state.authNonce;
  if (!session) { state.user = null; gate(); return; }
  if (state.user?.id !== session.user.id) {
    releasePreviews(); state.dirty = false; state.loaded = false; state.vehicles = []; state.contents = [];
  }
  state.user = session.user;
  if (recovering) { passwordForm(); return; }
  const { data, error } = await state.client.rpc('is_admin');
  if (nonce !== state.authNonce) return;
  if (error || data !== true) { denied(); if (error) notify('Authorization could not be verified. Try signing in again.', true); return; }
  state.authorized = true;
  render();
  await loadData();
}
function render() {
  if (!state.authorized) return;
  app.setAttribute('aria-busy', 'false');
  app.innerHTML = `<div class="shell"><aside class="sidebar"><img class="sidebar-logo" src="${logoUrl}" alt="AUTO HAUS GROUP"><span class="sidebar-label">DEALERSHIP ADMINISTRATION</span><nav aria-label="Administration">${[['overview','layout-dashboard','Overview'],['inventory','car-front','Inventory'],['content','file-text','Website content']].map(([view, name, label]) => `<button class="nav-button ${state.view === view ? 'active' : ''}" data-view="${view}" ${state.view === view ? 'aria-current="page"' : ''}>${icon(name)}<span>${label}</span></button>`).join('')}</nav><div class="sidebar-bottom"><a href="../" target="_blank" rel="noopener noreferrer" title="Open showroom">${icon('external-link')}<span>Open showroom</span></a><button data-action="logout" title="Sign out" data-busy-control>${icon('log-out')}<span>Sign out</span></button></div></aside><div class="workspace"><header class="topbar"><div><strong>AUTO HAUS GROUP</strong><span class="connection">Administration</span></div><span class="account">${escape(state.user?.email)}</span></header><main class="main-content" id="main-content"><div class="page-heading"><h1>${state.view === 'overview' ? 'Overview' : state.view === 'inventory' ? 'Inventory' : 'Website content'}</h1></div><div class="empty-state"><h2>Connected</h2><p>Your staff access has been verified.</p></div></main></div></div>`;
  icons();
  renderView();
}

function renderView() {
  const content = document.querySelector('#main-content');
  if (!content || !state.authorized) return;
  if (!state.loaded) { content.innerHTML = '<div class="boot-status" role="status">Loading dealership data...</div>'; return; }
  content.innerHTML = state.view === 'editor' ? editor(state) : state.view === 'inventory' ? inventory(state) : state.view === 'content' ? contentEditor(state) : overview(state);
  icons();
}
function markDirty() {
  state.dirty = true;
  const indicator = document.querySelector('#unsaved-status');
  if (indicator) indicator.textContent = 'Unsaved changes';
}
function releasePreviews() {
  state.images.forEach((image) => { if (image.localPreview) URL.revokeObjectURL(image.preview); });
}
function confirmAction(title, description, label = 'Delete') {
  const dialog = document.querySelector('#confirm-dialog');
  document.querySelector('#confirm-title').textContent = title;
  document.querySelector('#confirm-description').textContent = description;
  const button = document.querySelector('#confirm-action');
  button.textContent = label;
  button.classList.toggle('danger', label === 'Delete' || label === 'Discard');
  return new Promise((resolve) => {
    dialog.returnValue = 'cancel';
    dialog.addEventListener('close', () => resolve(dialog.returnValue === 'confirm'), { once: true });
    dialog.showModal();
    dialog.querySelector('[value=cancel]').focus();
  });
}
async function leaveEditor() {
  if (state.dirty && !await confirmAction('Discard unsaved changes?', 'Your unsaved changes will be lost.', 'Discard')) return false;
  releasePreviews(); state.images = []; state.draft = null; state.dirty = false;
  return true;
}
async function loadData() {
  setBusy(true);
  const userId = state.user?.id;
  try {
    const [vehicles, contents] = await Promise.all([readAll(state.client, 'vehicles', '*,vehicle_images(*)'), readAll(state.client, 'site_content')]);
    const images = vehicles.flatMap((vehicle) => vehicle.vehicle_images);
    let urls = new Map();
    try { urls = await signImages(state.client, images); }
    catch { notify('Inventory loaded, but some photo previews are unavailable. Refresh to retry.', true); }
    if (!state.authorized || state.user?.id !== userId) return;
    images.forEach((image) => {
      image.preview = safeImageUrl(image.legacy_path ?? urls.get(image.storage_path), state.projectUrl, new URL('../',location.href).href);
    });
    vehicles.forEach((vehicle) => vehicle.vehicle_images.sort((first, second) => first.sort_order - second.sort_order));
    state.vehicles = vehicles; state.contents = contents; state.loaded = true;
    renderView();
  } catch (error) {
    if (state.authorized) {
      document.querySelector('#main-content').innerHTML = `<div class="notice error">The database could not be loaded. Check the connection and migrations.</div><button class="button secondary" data-action="refresh">${icon('refresh-cw')} Retry</button>`;
      icons();
      notify(error.code === '42501' ? 'Access denied. Sign out and contact your administrator.' : 'Loading failed. No changes have been made.', true);
    }
  } finally { setBusy(false); }
}
function editVehicle(id) {
  releasePreviews();
  const vehicle = state.vehicles.find((entry) => entry.id === id);
  state.draft = vehicle ? structuredClone(vehicle) : {
    id: crypto.randomUUID(), version: null, brand: '', model: '', year: new Date().getFullYear(), price: '', mileage: null,
    mileage_label: '', fuel: '', transmission: '', color: '', body_type: '', collection: '', horsepower: '', engine: '',
    description: '', specifications: {}, status: 'available', published: false,
  };
  state.images = vehicle ? structuredClone(vehicle.vehicle_images) : [];
  state.view = 'editor'; state.dirty = false;
  render();
  document.querySelector('[name=brand]').focus();
}
function capturePhotos() {
  document.querySelectorAll('[data-photo]').forEach((element) => {
    const image = state.images[Number(element.dataset.photo)];
    image.label = element.querySelector('[data-photo-label]').value;
    image.credit = element.querySelector('[data-photo-credit]').value;
    image.is_cover = element.querySelector('[name=cover-photo]').checked;
  });
}
function renderPhotos() {
  document.querySelector('#photo-grid').innerHTML = photoGrid(state.images);
  document.querySelector('#photo-total').textContent = `${state.images.length} / 24`;
  icons();
}
async function addPhotos(input) {
  const files = [...input.files];
  if (!files.length) return;
  if (state.images.length + files.length > 24) { notify('A vehicle can have up to 24 photographs.', true); input.value = ''; return; }
  setBusy(true); capturePhotos();
  try {
    files.forEach(validatePhotoFile);
    for (const file of files) {
      const optimized = await optimizePhoto(file);
      state.images.push({ id: crypto.randomUUID(), file: optimized, preview: URL.createObjectURL(optimized), localPreview: true, label: file.name.replace(/\.[^.]+$/, '').slice(0,120), credit: '', pending: false, is_cover: !state.images.some((image) => image.is_cover) });
      markDirty();
    }
    renderPhotos();
  } catch (error) { renderPhotos(); notify(error.message || 'This photograph could not be processed.', true); }
  finally { input.value = ''; setBusy(false); }
}
async function commitVehicle(form) {
  capturePhotos();
  const progress = document.querySelector('#upload-progress');
  try {
    const payload = vehiclePayload(form, state.draft.id);
    setBusy(true);
    showFormStatus('Saving vehicle...');
    await saveVehicle(state.client, state.draft, payload, state.images, (completed, total) => {
      progress.hidden = false; progress.max = total; progress.value = completed;
      showFormStatus(`Uploading photograph ${completed} of ${total}...`);
    });
    state.dirty = false; releasePreviews(); state.images = []; state.draft = null; state.view = 'inventory';
    render(); await loadData(); announceUpdate(); notify('Vehicle saved.');
  } catch (error) {
    showFormStatus(error.code === '40001' ? error.message : `Save incomplete. ${error.message || 'Check the connection and retry.'} Any newly created record remains an unpublished draft until the save completes.`, true);
    progress.hidden = true;
  } finally { setBusy(false); }
}
function contentPayload(form) {
  const data = {};
  new FormData(form).forEach((value,key) => { if (key !== 'published') data[key] = String(value).trim(); });
  const list = document.querySelector('#content-items');
  if (list) data[list.dataset.kind] = [...list.querySelectorAll('[data-content-item]')].map((element) => ({ title: element.querySelector('[data-item-title]').value.trim(), description: element.querySelector('[data-item-description]').value.trim() }));
  return data;
}
async function commitContent(form) {
  const section = state.contentSection ?? 'about';
  const record = state.contents.find((entry) => entry.section === section);
  const content = contentPayload(form);
  const published = new FormData(form).has('published');
  setBusy(true); showFormStatus('Saving content...');
  try {
    const saved = ensure(await state.client.rpc('save_site_content', { section_id: section, content, is_published: published, expected_version: record.version }));
    Object.assign(record, saved); state.dirty = false; renderView(); announceUpdate(); notify('Website content saved.');
  } catch (error) { showFormStatus(error.message || 'Content could not be saved. Please retry.', true); }
  finally { setBusy(false); }
}
function announceUpdate() {
  if (!('BroadcastChannel' in window)) return;
  const channel = new BroadcastChannel('auto-haus-content-updated');
  channel.postMessage('refresh'); channel.close();
}
async function login(form) {
  const values = new FormData(form);
  setBusy(true);
  showFormStatus('Signing in...');
  try {
    const { data, error } = await state.client.auth.signInWithPassword({ email: String(values.get('email')).trim(), password: String(values.get('password')) });
    if (error) throw error;
    form.reset();
    await authorize(data.session);
  } catch { showFormStatus('Sign-in failed. Check your credentials or contact your administrator.', true); }
  finally { setBusy(false); }
}
async function logout() {
  if (!await leaveEditor()) return;
  setBusy(true);
  const { error } = await state.client.auth.signOut({ scope: 'local' });
  if (error) { setBusy(false); notify('Sign-out failed. Please retry.', true); return; }
  state.authNonce += 1;
  state.user = null;
  state.vehicles = [];
  state.contents = [];
  state.loaded = false;
  state.dirty = false;
  recovering = false;
  gate();
  setBusy(false);
}

app.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (state.busy) return;
  if (event.target.id === 'login-form') await login(event.target);
  if (event.target.id === 'vehicle-form' && state.authorized) await commitVehicle(event.target);
  if (event.target.id === 'content-form' && state.authorized) await commitContent(event.target);
  if (event.target.id === 'password-form') {
    const values = new FormData(event.target);
    if (values.get('password') !== values.get('confirm')) { showFormStatus('Passwords do not match.', true); return; }
    setBusy(true);
    const { error } = await state.client.auth.updateUser({ password: String(values.get('password')) });
    setBusy(false);
    if (error) { showFormStatus('The password could not be updated. Request a new recovery email or retry.', true); return; }
    recovering = false;
    await authorize((await state.client.auth.getSession()).data.session);
  }
});
app.addEventListener('click', async (event) => {
  const button = event.target.closest('button');
  if (!button || state.busy) return;
  const action = button.dataset.action;
  if (action === 'logout') await logout();
  if (button.dataset.view && state.authorized && await leaveEditor()) { state.view = button.dataset.view; render(); }
  if (state.authorized) {
    if (action === 'add' && await leaveEditor()) editVehicle();
    if (action === 'edit' && await leaveEditor()) editVehicle(button.dataset.id);
    if (action === 'back' && await leaveEditor()) { state.view = 'inventory'; render(); await loadData(); }
    if (action === 'refresh' && await leaveEditor()) await loadData();
    if (action === 'add-spec') {
      const rows = document.querySelector('#specification-rows');
      if (rows.children.length >= 24) { notify('A vehicle can have up to 24 additional specifications.', true); return; }
      rows.insertAdjacentHTML('beforeend', specRow()); icons(); markDirty();
    }
    if (action === 'remove-spec') { button.closest('[data-spec-row]').remove(); markDirty(); }
    if (action?.startsWith('photo-')) {
      capturePhotos();
      const index = Number(button.dataset.index);
      if (action === 'photo-remove') {
        const [removed] = state.images.splice(index,1);
        if (removed.localPreview) URL.revokeObjectURL(removed.preview);
        if (removed.is_cover) { const cover = state.images.find((image) => !image.pending); if (cover) cover.is_cover = true; }
      } else {
        const target = index + (action === 'photo-up' ? -1 : 1);
        if (target >= 0 && target < state.images.length) [state.images[index],state.images[target]] = [state.images[target],state.images[index]];
      }
      renderPhotos(); markDirty();
    }
    if (action === 'add-content-item') {
      const items = document.querySelector('#content-items');
      if (items.children.length >= 12) { notify('A section can have up to 12 entries.',true); return; }
      items.insertAdjacentHTML('beforeend', contentItem({title:'',description:''},items.children.length,items.dataset.kind)); icons(); markDirty();
    }
    if (action === 'remove-content-item') {
      if (document.querySelectorAll('[data-content-item]').length < 2) { notify('Keep at least one entry.',true); return; }
      button.closest('[data-content-item]').remove(); markDirty();
    }
    if (action === 'toggle-status' || action === 'delete-vehicle') {
      const vehicle = state.vehicles.find((entry) => entry.id === button.dataset.id);
      const deleting = action === 'delete-vehicle';
      const status = vehicle.status === 'sold' ? 'available' : 'sold';
      if (!await confirmAction(deleting ? 'Delete vehicle?' : `Mark ${status}?`, deleting ? `${vehicle.brand} ${vehicle.model} will be permanently removed. Photo cleanup can be run from Overview.` : `${vehicle.brand} ${vehicle.model}${status === 'sold' ? ' will be removed from public inventory.' : ' will appear publicly if published.'}`, deleting ? 'Delete' : `Mark ${status}`)) return;
      setBusy(true);
      try {
        if (deleting) ensure(await state.client.rpc('delete_vehicle',{vehicle_id:vehicle.id,expected_version:vehicle.version}));
        else await saveVehicle(state.client,vehicle,{...vehicle,status},vehicle.vehicle_images);
        await loadData(); announceUpdate(); notify(deleting ? 'Vehicle deleted.' : `Vehicle marked ${status}.`);
      } catch (error) { notify(error.message || 'The change could not be saved.',true); }
      finally { setBusy(false); }
    }
    if (action === 'cleanup') {
      setBusy(true);
      try { const count = await cleanupStorage(state.client); document.querySelector('#cleanup-result').textContent = `${count} unused photographs deleted. In-progress uploads are retained for 24 hours.`; }
      catch { notify('Cleanup incomplete. Files still in use are protected; retry later.',true); }
      finally { setBusy(false); }
    }
  }
  if (action === 'password-visibility') {
    const input = document.querySelector('#password');
    const visible = input.type === 'password';
    input.type = visible ? 'text' : 'password';
    button.title = visible ? 'Hide password' : 'Show password';
    button.setAttribute('aria-label', button.title);
    button.innerHTML = icon(visible ? 'eye-off' : 'eye');
    icons();
  }
  if (action === 'reset-password') {
    const input = document.querySelector('[name=email]');
    if (!input.reportValidity()) return;
    setBusy(true);
    const { error } = await state.client.auth.resetPasswordForEmail(input.value.trim(), { redirectTo: new URL('./', location.href).href });
    setBusy(false);
    showFormStatus(error ? 'The recovery email could not be sent. Please retry later.' : 'If this account exists, a recovery email has been sent.', Boolean(error));
  }
});
app.addEventListener('input', (event) => {
  if (event.target.id === 'inventory-search') { state.search = event.target.value; document.querySelector('#inventory-table').innerHTML = inventoryResults(state); icons(); }
  if (event.target.closest('#vehicle-form, #content-form')) markDirty();
});
app.addEventListener('change', async (event) => {
  if (event.target.id === 'photo-files' && state.authorized && !state.busy) await addPhotos(event.target);
  if (event.target.closest('#vehicle-form, #content-form')) markDirty();
  if (event.target.id === 'inventory-status' || event.target.id === 'inventory-visibility') {
    state[event.target.id === 'inventory-status' ? 'statusFilter' : 'visibilityFilter'] = event.target.value;
    document.querySelector('#inventory-table').innerHTML = inventoryResults(state); icons();
  }
  if (event.target.id === 'content-section') {
    const section = event.target.value;
    if (await leaveEditor()) { state.contentSection = section; renderView(); }
    else event.target.value = state.contentSection ?? 'about';
  }
});
window.addEventListener('beforeunload', (event) => { if (state.dirty) { event.preventDefault(); event.returnValue = ''; } });
window.addEventListener('focus', async () => {
  if (!state.authorized || state.busy) return;
  const { data, error } = await state.client.rpc('is_admin');
  if (!error && data !== true) { releasePreviews(); denied(); }
});

async function start() {
  if (window.top !== window.self) { app.textContent = 'Administration cannot be embedded.'; return; }
  let config;
  try { config = validateSupabaseConfig(); }
  catch (error) { gate(error.message, 'Connection unavailable'); return; }
  if (!config.configured) { gate('Administration has not been configured. Contact your site administrator.', 'Connection unavailable'); return; }
  state.projectUrl = config.url;
  state.client = createClient(config.url, config.publishableKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'auto-haus-admin-auth' },
    global: { fetch: (input, options = {}) => fetch(input, { ...options, signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000) }) },
  });
  state.client.auth.onAuthStateChange((event, session) => {
    if (event === 'PASSWORD_RECOVERY') recovering = true;
    if (event === 'SIGNED_OUT') { state.authNonce += 1; releasePreviews(); state.dirty = false; state.loaded = false; state.vehicles = []; state.contents = []; state.user = null; gate(); }
    else if (event === 'PASSWORD_RECOVERY' || (event === 'SIGNED_IN' && (!state.authorized || state.user?.id !== session?.user.id))) setTimeout(() => authorize(session).catch(() => gate('Authorization could not be verified.')), 0);
  });
  try { await authorize((await state.client.auth.getSession()).data.session); }
  catch { gate('Connection failed. Please reload and try again.'); }
}
start();