import { validateSupabaseConfig } from './site-config.js';
import { readAll, signImages } from './supabase-data.js';
import { safeImageUrl } from './content-utils.js';

export function toPublicCar(vehicle, signed = new Map(), projectUrl = '', baseUrl = globalThis.location?.href) {
  const photographs = [...(vehicle.vehicle_images ?? [])].sort((first, second) => Number(second.is_cover) - Number(first.is_cover) || first.sort_order - second.sort_order).map((image) => {
    const src = safeImageUrl(image.legacy_path ?? signed.get(image.storage_path), projectUrl, baseUrl);
    return { label: image.label, credit: image.credit, src, pending: image.pending || !src };
  });
  const price = Number(vehicle.price);
  return {
    id: vehicle.legacy_id || vehicle.id, name: vehicle.model, brand: vehicle.brand, year: vehicle.year, price,
    priceLabel: new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(price),
    horsepower: vehicle.horsepower, engine: vehicle.engine, transmission: vehicle.transmission, fuel: vehicle.fuel,
    mileage: vehicle.mileage === null ? vehicle.mileage_label : `${Number(vehicle.mileage).toLocaleString('en-US')} km`,
    color: vehicle.color, description: vehicle.description, specifications: vehicle.specifications,
    type: vehicle.body_type, collection: vehicle.collection, photographs, hero: photographs.find((image) => !image.pending)?.src ?? '',
  };
}

export async function loadPublicSnapshot(client, projectUrl, baseUrl) {
  const [vehicles, content] = await Promise.all([readAll(client, 'vehicles', '*,vehicle_images(*)'), readAll(client, 'site_content')]);
  const visible = vehicles.filter((vehicle) => vehicle.published && vehicle.status === 'available');
  let signed = new Map();
  try { signed = await signImages(client, visible.flatMap((vehicle) => vehicle.vehicle_images)); }
  catch (error) { console.warn('Vehicle photo previews are temporarily unavailable.', error.message); }
  return {
    cars: visible.toSorted((first, second) => first.created_at.localeCompare(second.created_at) || first.id.localeCompare(second.id)).map((vehicle) => toPublicCar(vehicle, signed, projectUrl, baseUrl)),
    content: Object.fromEntries(content.filter((entry) => entry.published).map((entry) => [entry.section, entry.data])),
  };
}

export async function startPublicData({ onUpdate, onState = () => {}, canRefresh = () => true }) {
  let config;
  try { config = validateSupabaseConfig(); }
  catch (error) { onState('error'); console.warn('Public inventory configuration is invalid.', error.message); return () => {}; }
  if (!config.configured) return () => {};
  onState('loading');
  let client;
  try {
    const { createClient } = await import('@supabase/supabase-js');
    client = createClient(config.url, config.publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'auto-haus-public' },
      global: { fetch: (input, options = {}) => fetch(input, { ...options, cache: 'no-store', signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000) }) },
    });
  } catch (error) { onState('error'); console.warn('Public inventory connection is unavailable.', error.message); return () => {}; }
  let busy = false;
  let stopped = false;
  let requested = false;
  const refresh = async () => {
    if (stopped || document.hidden || !canRefresh()) return;
    if (busy) { requested = true; return; }
    busy = true;
    try {
      const snapshot = await loadPublicSnapshot(client, config.url, new URL('./', location.href).href);
      if (!stopped) { onUpdate(snapshot); onState('ready'); }
    } catch (error) { if (!stopped) onState('error'); console.warn('Public inventory refresh failed.', error.message); }
    finally { busy = false; if (requested) { requested = false; refresh(); } }
  };
  const interval = setInterval(refresh, 60000);
  const visible = () => { if (!document.hidden) refresh(); };
  window.addEventListener('focus', refresh);
  document.addEventListener('visibilitychange', visible);
  const channel = 'BroadcastChannel' in window ? new BroadcastChannel('auto-haus-content-updated') : null;
  if (channel) channel.onmessage = () => refresh();
  window.addEventListener('auto-haus-refresh', refresh);
  await refresh();
  return () => {
    stopped = true; clearInterval(interval); channel?.close();
    window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', visible);
    window.removeEventListener('auto-haus-refresh', refresh);
  };
}