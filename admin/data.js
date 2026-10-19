import { ensure } from '../js/supabase-data.js';
export { ensure, readAll, signImages } from '../js/supabase-data.js';

const BUCKET = 'vehicle-images';
const MAX_PHOTOS = 24;
const MAX_INPUT_SIZE = 20 * 1024 * 1024;
const MAX_OUTPUT_SIZE = 2 * 1024 * 1024;

export function validatePhotoFile(file) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('Choose JPEG, PNG or WebP photographs.');
  if (!file.size || file.size > MAX_INPUT_SIZE) throw new Error('Each original photograph must be between 1 byte and 20 MB.');
}

export async function optimizePhoto(file) {
  validatePhotoFile(file);
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  try {
    if (bitmap.width * bitmap.height > 80000000 || !bitmap.width || !bitmap.height) throw new Error('This photograph has unsupported dimensions.');
    let scale = Math.min(1, 1920 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    for (let attempt = 0; attempt < 4; attempt += 1) {
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext('2d', { alpha: false });
      if (!context) throw new Error('Photograph optimization is unavailable in this browser.');
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', 0.84));
      if (!blob || blob.type !== 'image/webp') throw new Error('WebP export is unavailable in this browser.');
      if (blob.size <= MAX_OUTPUT_SIZE) return blob;
      scale *= 0.75;
    }
    throw new Error('This photograph could not be reduced below 2 MB.');
  } finally { bitmap.close(); }
}

export function vehiclePayload(form, id) {
  const specifications = {};
  for (const row of form.querySelectorAll('[data-spec-row]')) {
    const key = row.querySelector('[data-spec-key]').value.trim();
    const value = row.querySelector('[data-spec-value]').value.trim();
    if (!key && !value) continue;
    if (!key || !value) throw new Error('Complete both fields for every specification.');
    if (Object.hasOwn(specifications, key) || ['__proto__', 'prototype', 'constructor'].includes(key)) throw new Error('Use unique specification names.');
    Object.defineProperty(specifications, key, { value, enumerable: true });
  }
  if (Object.keys(specifications).length > 24) throw new Error('A vehicle can have up to 24 additional specifications.');
  const fields = new FormData(form);
  const text = (name) => String(fields.get(name) ?? '').trim();
  return {
    id, brand: text('brand'), model: text('model'), year: Number(text('year')), price: Number(text('price')),
    mileage: text('mileage') === '' ? null : Number(text('mileage')), mileage_label: text('mileage_label'),
    fuel: text('fuel'), transmission: text('transmission'), color: text('color'), body_type: text('body_type'),
    collection: text('collection'), horsepower: text('horsepower'), engine: text('engine'), description: text('description'),
    specifications, status: text('status'), published: fields.has('published'),
  };
}

export async function saveVehicle(client, draft, payload, images, progress = () => {}) {
  if (images.length > MAX_PHOTOS) throw new Error('A vehicle can have up to 24 photographs.');
  const save = async (data, metadata, version) => ensure(await client.rpc('save_vehicle', { payload: data, images: metadata, expected_version: version }));
  if (!draft.version && images.some((image) => image.file)) {
    const reserved = await save({ ...payload, published: false }, [], null);
    draft.version = reserved.version;
    draft.published = false;
  }
  let completed = 0;
  for (const image of images) {
    if (!image.file || image.uploaded) continue;
    const path = `${payload.id}/${crypto.randomUUID()}.webp`;
    ensure(await client.rpc('queue_vehicle_upload', { vehicle_id: payload.id, object_path: path }));
    ensure(await client.storage.from(BUCKET).upload(path, image.file, { contentType: 'image/webp', cacheControl: '300', upsert: false }));
    image.storage_path = path;
    image.uploaded = true;
    completed += 1;
    progress(completed, images.filter((entry) => entry.file).length);
  }
  const metadata = images.map((image) => ({
    id: image.id, storage_path: image.storage_path ?? null, legacy_path: image.legacy_path ?? null,
    label: image.label, credit: image.credit, is_cover: image.is_cover, pending: image.pending ?? false,
  }));
  const saved = await save(payload, metadata, draft.version ?? null);
  Object.assign(draft, saved);
  images.forEach((image) => { delete image.file; delete image.uploaded; });
  return saved;
}

export async function cleanupStorage(client) {
  const queued = ensure(await client.from('storage_cleanup').select('path').lte('not_before', new Date().toISOString()).order('created_at').limit(100));
  let deleted = 0;
  for (let offset = 0; offset < queued.length; offset += 50) {
    const paths = queued.slice(offset, offset + 50).map((image) => image.path);
    ensure(await client.storage.from(BUCKET).remove(paths));
    deleted += ensure(await client.rpc('finish_vehicle_cleanup', { object_paths: paths }));
  }
  return deleted;
}