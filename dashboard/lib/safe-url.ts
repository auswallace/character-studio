// dashboard/lib/safe-url.ts
//
// SSRF guard for every server route that fetches a URL it did not build itself
// (user-supplied image/video URLs, provider output URLs). Without this a request
// like /api/...?url=http://169.254.169.254/ or http://localhost:54321/ would be
// fetched by the server with the server's network access.
//
// Two modes:
//   safeFetch(url)                           user-supplied URL: https + host allowlist
//   safeFetch(url, { trustedProviderUrl })   URL the server got back from Wavespeed/fal:
//                                            https, no IPs/localhost, any public host
// Provider output CDNs change domains, so the allowlist must not apply to them
// (it silently dropped every generated image on 2026-11-04).

const STATIC_ALLOWED_SUFFIXES = [
  // our storage
  'supabase.co', 'supabase.in',
  // providers that hand back output URLs
  'wavespeed.ai', 'wavespeed.com', 'fal.media', 'fal.run', 'fal.ai',
  'elevenlabs.io',
  // Late CDN
  'getlate.dev', 'late.dev', 'late.com',
  // scraped-content image hosts (image-proxy)
  'cdninstagram.com', 'fbcdn.net', 'twimg.com', 'ton.twitter.com',
  // Google (Veo / Gemini Omni outputs may be served from here)
  'googleapis.com', 'googleusercontent.com',
];

function extraAllowedHosts(): string[] {
  const out: string[] = [];
  const raw = process.env.ALLOWED_FETCH_HOSTS; // comma-separated, optional
  if (raw) out.push(...raw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean));
  try {
    const u = new URL(process.env.SUPABASE_URL || '');
    if (u.hostname) out.push(u.hostname.toLowerCase());
  } catch { /* no SUPABASE_URL */ }
  return out;
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1', 'host.docker.internal']);

function isIpLiteral(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':');
}

export class UnsafeUrlError extends Error {
  constructor(msg: string) { super(msg); this.name = 'UnsafeUrlError'; }
}

/**
 * Throws UnsafeUrlError unless `input` is an https URL on an allowlisted host.
 * Returns the parsed URL on success.
 */
/**
 * Looser check for URLs the SERVER obtained from a trusted provider response
 * (Wavespeed / fal output CDNs change domains). Still blocks the dangerous
 * targets: non-https, IP literals, localhost, internal names. No host allowlist.
 */
export function assertPublicHttpsUrl(input: string, purpose?: string): URL {
  let u: URL;
  try { u = new URL(input); } catch { throw new UnsafeUrlError(`Invalid URL${purpose ? ` for ${purpose}` : ''}`); }
  const host = u.hostname.toLowerCase();
  const extra = extraAllowedHosts();
  const isLocalSupabase = LOCAL_HOSTS.has(host) && extra.includes(host);
  if (isLocalSupabase) return u;
  if (u.protocol !== 'https:') throw new UnsafeUrlError(`Only https URLs are allowed (${host})`);
  if (LOCAL_HOSTS.has(host) || isIpLiteral(host) || host.endsWith('.local') || host.endsWith('.internal') || !host.includes('.')) {
    throw new UnsafeUrlError(`Host not allowed: ${host}`);
  }
  return u;
}

export function assertSafeUrl(input: string, opts: { allowHosts?: string[]; purpose?: string } = {}): URL {
  let u: URL;
  try { u = new URL(input); } catch { throw new UnsafeUrlError(`Invalid URL${opts.purpose ? ` for ${opts.purpose}` : ''}`); }

  const host = u.hostname.toLowerCase();
  const extra = [...extraAllowedHosts(), ...(opts.allowHosts || []).map(h => h.toLowerCase())];
  const isLocalSupabase = LOCAL_HOSTS.has(host) && extra.includes(host); // only when SUPABASE_URL itself is local (dev)

  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && isLocalSupabase)) {
    throw new UnsafeUrlError(`Only https URLs are allowed (${host})`);
  }
  if (!isLocalSupabase && (LOCAL_HOSTS.has(host) || isIpLiteral(host) || host.endsWith('.local') || host.endsWith('.internal'))) {
    throw new UnsafeUrlError(`Host not allowed: ${host}`);
  }

  const ok = isLocalSupabase
    || extra.some(h => host === h || host.endsWith(`.${h}`))
    || STATIC_ALLOWED_SUFFIXES.some(suf => host === suf || host.endsWith(`.${suf}`));
  if (!ok) throw new UnsafeUrlError(`Host not allowed: ${host}`);

  return u;
}

/**
 * fetch() that refuses non-allowlisted hosts. Drop-in for server-side downloads.
 * Redirects are followed by hand (max 3 hops) so every hop is checked too;
 * provider CDNs often 302 to a signed URL.
 */
export async function safeFetch(input: string, init?: RequestInit & { purpose?: string; allowHosts?: string[]; trustedProviderUrl?: boolean }): Promise<Response> {
  const { purpose, allowHosts, trustedProviderUrl, ...rest } = init || {};
  let url = input;
  for (let hop = 0; hop < 4; hop++) {
    if (trustedProviderUrl) assertPublicHttpsUrl(url, purpose);
    else assertSafeUrl(url, { purpose, allowHosts });
    const res = await fetch(url, { ...rest, redirect: 'manual' });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) return res;
      url = new URL(loc, url).toString();
      continue;
    }
    return res;
  }
  throw new UnsafeUrlError(`Too many redirects${purpose ? ` for ${purpose}` : ''}`);
}
