export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
}

export function cssImage(url) {
  if (!url) return 'none';
  return `url("${String(url).replace(/["'()\\<>\s]/g, (character) => encodeURIComponent(character))}")`;
}

export function safeImageUrl(value, projectUrl = '', baseUrl = globalThis.location?.href ?? 'https://localhost/') {
  if (typeof value !== 'string') return '';
  if (/^assets\/photos\/[A-Za-z0-9_-]+\.(jpg|jpeg|png|webp)$/.test(value)) return new URL(value, baseUrl).href;
  try {
    const url = new URL(value);
    const project = new URL(projectUrl);
    if (url.origin !== project.origin || url.username || url.password || url.hash
      || !/^\/storage\/v1\/object\/sign\/vehicle-images\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.webp$/.test(url.pathname)
      || !/^[A-Za-z0-9_.-]+$/.test(url.searchParams.get('token') ?? '')
      || [...url.searchParams.keys()].some((key) => key !== 'token')) return '';
    return url.href;
  } catch { return ''; }
}

export function safeEmail(value) {
  return /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,}$/.test(String(value)) ? String(value) : '';
}

// Enabled About Us figures in display order. Malformed entries are dropped rather than shown.
export function visibleStatistics(items) {
  if (!Array.isArray(items)) return [];
  return items
    .filter((item) => item?.enabled === true && typeof item.label === 'string' && item.label.trim()
      && Number.isInteger(item.value) && item.value >= 0 && item.value <= 1000000
      && ['', '+', '%'].includes(item.suffix) && (item.suffix !== '%' || item.value <= 100))
    .map((item) => ({ label: item.label.trim().slice(0, 60), value: item.value, suffix: item.suffix, order: Number.isInteger(item.order) ? item.order : 0 }))
    .sort((first, second) => first.order - second.order)
    .slice(0, 8);
}

export function whatsappNumber(value) {
  return /^\d{8,15}$/.test(String(value)) ? String(value) : '';
}

export function uiIcon(name = 'arrow-up-right') {
  const symbol = ['arrow-up-right','arrow-left','arrow-right','rotate-ccw','arrow-down'].includes(name) ? name : 'arrow-up-right';
  return `<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><use href="assets/logo/icons.svg#${symbol}"></use></svg>`;
}