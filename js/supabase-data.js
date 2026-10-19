export function ensure(result) {
  if (result.error) throw result.error;
  return result.data;
}

export async function readAll(client, table, columns = '*') {
  const rows = [];
  for (let offset = 0; ; offset += 200) {
    const page = ensure(await client.from(table).select(columns).order(table === 'site_content' ? 'section' : 'id').range(offset, offset + 199));
    rows.push(...page);
    if (page.length < 200) return rows;
  }
}

export async function signImages(client, images) {
  const paths = [...new Set(images.map((image) => image.storage_path).filter(Boolean))];
  const urls = new Map();
  for (let offset = 0; offset < paths.length; offset += 100) {
    const signed = ensure(await client.storage.from('vehicle-images').createSignedUrls(paths.slice(offset, offset + 100), 300));
    signed.forEach((image) => { if (!image.error && image.signedUrl) urls.set(image.path, image.signedUrl); });
  }
  return urls;
}