export const SUPABASE_CONFIG = Object.freeze({
  url: '',
  publishableKey: '',
});

export function validateSupabaseConfig(config = SUPABASE_CONFIG) {
  const url = String(config.url ?? '').trim().replace(/\/$/, '');
  const publishableKey = String(config.publishableKey ?? '').trim();
  if (!url && !publishableKey) return { configured: false, url: '', publishableKey: '' };
  if (!url || !publishableKey) throw new Error('Set both the Supabase project URL and publishable key.');
  const parsed = new URL(url);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
  if ((parsed.protocol !== 'https:' && !(local && parsed.protocol === 'http:')) || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/') {
    throw new Error('Use the HTTPS Supabase project origin, without a path or credentials.');
  }
  let publicKey = publishableKey.startsWith('sb_publishable_');
  if (publishableKey.split('.').length === 3) {
    try {
      const payload = publishableKey.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      publicKey = JSON.parse(atob(payload)).role === 'anon';
    } catch {
      publicKey = false;
    }
  }
  if (!publicKey) throw new Error('Only a Supabase publishable or legacy anon key may be used in the browser. Never use a secret/service-role key.');
  return { configured: true, url, publishableKey };
}