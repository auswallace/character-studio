#!/usr/bin/env node
// dashboard/scripts/smoke.mjs
//
// 30-second smoke test. Hits every read-only API route against a running dev
// server and fails loudly if any returns an error. Costs nothing: no
// generation, no provider calls, no writes.
//
//   npm run dev        (in another terminal)
//   npm run smoke      (this)
//
// BASE_URL overrides http://localhost:3000.

const BASE = process.env.BASE_URL || 'http://localhost:3000';

const ROUTES = [
  '/api/config',
  '/api/provider-config',
  '/api/prompt-templates',
  '/api/generations?limit=1',
  '/api/carousel?limit=1',
  '/api/video?limit=1',
  '/api/social-posts',
  '/api/social-posts/insights',
  '/api/inspiration?limit=1',
  '/api/inspiration/accounts',
  '/api/inspiration/scrape-costs',
  '/api/inspiration/x-posts',
  '/api/dev-tickets',
  '/api/dev-progress',
  '/api/post-ideas',
  '/api/presets',
  '/api/characters',
];

let failed = 0;
const t0 = Date.now();

for (const route of ROUTES) {
  const started = Date.now();
  try {
    const res = await fetch(BASE + route, { signal: AbortSignal.timeout(20000) });
    const ms = Date.now() - started;
    let body = null;
    try { body = await res.json(); } catch { /* non-JSON is fine for some routes */ }
    const err = body && typeof body === 'object' && 'error' in body ? body.error : null;
    if (!res.ok || err) {
      failed++;
      console.log(`FAIL  ${route}  ${res.status}  ${ms}ms  ${err ? String(err).slice(0, 120) : ''}`);
    } else {
      const size = Array.isArray(body) ? `${body.length} items` : body && typeof body === 'object' ? `${Object.keys(body).length} keys` : 'ok';
      console.log(`ok    ${route}  ${res.status}  ${ms}ms  ${size}`);
    }
  } catch (e) {
    failed++;
    console.log(`FAIL  ${route}  ${e?.message || e}`);
  }
}

console.log(`\n${ROUTES.length - failed}/${ROUTES.length} passed in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
process.exit(failed ? 1 : 0);
