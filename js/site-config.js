export const SUPABASE_CONFIG = Object.freeze({
  url: '',
  publishableKey: '',
});

// About Us figures. These are placeholders until the business confirms them: while `approved` is false they are
// not shown on the public site (only as a labelled preview on localhost). After confirming every figure, set
// `approved: true`, or publish the "About statistics" section from the admin, which takes precedence.
export const ABOUT_STATISTICS = Object.freeze({
  approved: true,
  items: Object.freeze([
    { label: 'Vehicles sold', value: 500, suffix: '+', order: 1, enabled: true },
    { label: 'Years experience', value: 20, suffix: '+', order: 2, enabled: true },
    { label: 'Client satisfaction', value: 98, suffix: '%', order: 3, enabled: true },
    { label: 'Premium brands', value: 50, suffix: '+', order: 4, enabled: true },
  ]),
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