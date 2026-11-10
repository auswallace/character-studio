#!/usr/bin/env node
// Refresh fal model manifests from fal's own OpenAPI, into lib/models/<slug>.json (same shape /api/dev/manifest writes).
//   node scripts/model-manifest.mjs                      # refresh every fal endpoint already in lib/models
//   node scripts/model-manifest.mjs fal-ai/flux-2/lora   # one or more endpoint ids
// WaveSpeed has no public OpenAPI: those files are hand-written from the docs page (see their `source` field).
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'lib', 'models');
const slugOf = (id) => id.replace(/[^a-z0-9]+/gi, '-').toLowerCase();

async function existingFalIds() {
  const ids = [];
  for (const f of await readdir(dir)) {
    if (!f.endsWith('.json')) continue;
    const d = JSON.parse(await readFile(join(dir, f), 'utf8'));
    if (d.provider === 'fal' && d.endpoint) ids.push(d.endpoint);
  }
  return ids;
}

async function fetchManifest(id) {
  const url = `https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=${encodeURIComponent(id)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${id}: HTTP ${res.status}`);
  const o = await res.json();
  let input = null;
  for (const ops of Object.values(o.paths || {})) {
    const ref = ops.post?.requestBody?.content?.['application/json']?.schema?.$ref;
    if (ref) { input = ref.split('/').pop(); break; }
  }
  if (!input) throw new Error(`${id}: no POST input schema in openapi`);
  const components = o.components?.schemas || {};
  if (!components[input]) throw new Error(`${id}: input schema ${input} missing`);
  return { endpoint: id, provider: 'fal', fetched_at: new Date().toISOString(), schema: { input, components } };
}

const ids = process.argv.slice(2).length ? process.argv.slice(2) : await existingFalIds();
let failed = 0;
for (const id of ids) {
  try {
    const doc = await fetchManifest(id);
    const path = join(dir, `${slugOf(id)}.json`);
    let changed = true;
    try {
      const old = JSON.parse(await readFile(path, 'utf8'));
      changed = JSON.stringify(old.schema) !== JSON.stringify(doc.schema);
    } catch { /* new file */ }
    await writeFile(path, JSON.stringify(doc, null, 2) + '\n');
    const n = Object.keys(doc.schema.components[doc.schema.input].properties || {}).length;
    console.log(`${changed ? 'updated' : 'same   '} ${id} (${n} input fields) -> lib/models/${slugOf(id)}.json`);
  } catch (e) {
    failed++;
    console.error(`FAILED ${e.message}`);
  }
}
if (failed) process.exit(1);
