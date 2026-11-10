#!/usr/bin/env node
// dashboard/scripts/export-supabase.mjs
//
// Full export of the create-ai Supabase project to a local folder (e.g. the LaCie).
// Exports: every table (JSON), every storage bucket (original files), and an
// optional pg_dump of the public schema.
//
// Usage (run from dashboard/):
//   node scripts/export-supabase.mjs "/Volumes/LaCie/create-ai-backup"
//
// Env (read from .env.local automatically, or set in the shell):
//   SUPABASE_URL                 required
//   SUPABASE_SERVICE_ROLE_KEY    strongly recommended (anon key can't see private buckets / RLS rows)
//   SUPABASE_ANON_KEY            used only if no service role key
//   SUPABASE_DB_URL              optional; enables pg_dump (needs `brew install libpq`)
//
// Safe to re-run: files that already exist with the same size are skipped.
// EXPORT_CONCURRENCY (default 8) controls parallel downloads.

import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync, mkdirSync, writeFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';

// ─── Env ──────────────────────────────────────────────────

function loadEnvLocal() {
  const p = join(process.cwd(), '.env.local');
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
loadEnvLocal();

const OUT = process.argv[2];
const URL_ = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
const USING_SERVICE = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);

if (!OUT) { console.error('Usage: node scripts/export-supabase.mjs <output-folder>'); process.exit(1); }
if (!URL_ || !KEY) { console.error('[export] Missing SUPABASE_URL or a key'); process.exit(1); }
if (!USING_SERVICE) console.warn('[export] WARNING: no SUPABASE_SERVICE_ROLE_KEY, using anon key. Private buckets and RLS-protected rows may be skipped.');

const supabase = createClient(URL_, KEY, { auth: { persistSession: false } });
const FALLBACK_BUCKETS = ['persona-refs', 'generated-images', 'remix-images', 'carousel-images', 'social-media', 'scraped-content', 'x-reposter', 'video-pipeline'];
const PAGE = 1000;
const CONCURRENCY = Number(process.env.EXPORT_CONCURRENCY || 8);
const manifest = { exportedAt: new Date().toISOString(), project: URL_, usingServiceRole: USING_SERVICE, tables: {}, buckets: {}, pgDump: null, errors: [] };

function ensureDir(d) { mkdirSync(d, { recursive: true }); }

// ─── Tables ───────────────────────────────────────────────

async function listTables() {
  // PostgREST root returns an OpenAPI doc listing every exposed table/view.
  const res = await fetch(`${URL_}/rest/v1/`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
  if (!res.ok) throw new Error(`OpenAPI fetch failed: ${res.status}`);
  const doc = await res.json();
  return Object.keys(doc.paths || {}).map(p => p.replace(/^\//, '')).filter(p => p && !p.startsWith('rpc/'));
}

async function exportTables() {
  const dir = join(OUT, 'tables');
  ensureDir(dir);
  const tables = await listTables();
  console.log(`[export] ${tables.length} tables found`);
  for (const t of tables) {
    const rows = [];
    try {
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await supabase.from(t).select('*').range(from, from + PAGE - 1);
        if (error) throw error;
        rows.push(...data);
        if (data.length < PAGE) break;
      }
      writeFileSync(join(dir, `${t}.json`), JSON.stringify(rows, null, 2));
      manifest.tables[t] = rows.length;
      console.log(`[export]   ${t}: ${rows.length} rows`);
    } catch (err) {
      const msg = err?.message || String(err);
      manifest.errors.push({ table: t, error: msg });
      console.error(`[export]   ${t}: FAILED ${msg}`);
    }
  }
}

// ─── Storage ──────────────────────────────────────────────

async function listBucketNames() {
  const { data, error } = await supabase.storage.listBuckets();
  if (error || !data?.length) {
    console.warn('[export] listBuckets unavailable, using known bucket names');
    return FALLBACK_BUCKETS;
  }
  return data.map(b => b.name);
}

async function walk(bucket, prefix, out) {
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase.storage.from(bucket).list(prefix, { limit: PAGE, offset, sortBy: { column: 'name', order: 'asc' } });
    if (error) throw error;
    for (const item of data) {
      const path = prefix ? `${prefix}/${item.name}` : item.name;
      if (item.id === null) await walk(bucket, path, out);       // folder
      else out.push({ path, size: item.metadata?.size ?? null });  // file
    }
    if (data.length < PAGE) break;
  }
}

async function exportStorage() {
  for (const bucket of await listBucketNames()) {
    const files = [];
    let ok = 0, skipped = 0, failed = 0, bytes = 0;
    try { await walk(bucket, '', files); }
    catch (err) { manifest.errors.push({ bucket, error: err?.message || String(err) }); console.error(`[export] ${bucket}: list FAILED`); continue; }
    console.log(`[export] ${bucket}: ${files.length} files`);
    // Download CONCURRENCY files at a time (sequential was ~1-2s/file on 4K images).
    const queue = [...files];
    let done = 0;
    async function worker() {
      while (queue.length) {
        const f = queue.shift();
        const dest = join(OUT, 'storage', bucket, f.path);
        if (existsSync(dest) && f.size !== null && statSync(dest).size === f.size) { skipped++; }
        else {
          try {
            const { data, error } = await supabase.storage.from(bucket).download(f.path);
            if (error) throw error;
            const buf = Buffer.from(await data.arrayBuffer());
            ensureDir(dirname(dest));
            writeFileSync(dest, buf);
            ok++; bytes += buf.length;
          } catch (err) {
            failed++;
            manifest.errors.push({ bucket, path: f.path, error: err?.message || String(err) });
          }
        }
        done++;
        if (done % 100 === 0) console.log(`[export]   ${bucket}: ${done}/${files.length}`);
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    manifest.buckets[bucket] = { files: files.length, downloaded: ok, skipped, failed, bytes };
    console.log(`[export]   ${bucket}: done (${ok} new, ${skipped} already there, ${failed} failed)`);
  }
}

// ─── pg_dump (optional) ───────────────────────────────────

function pgDump() {
  const dbUrl = process.env.SUPABASE_DB_URL;
  if (!dbUrl) { console.log('[export] SUPABASE_DB_URL not set, skipping pg_dump (table JSON still exported)'); return; }
  const dir = join(OUT, 'db');
  ensureDir(dir);
  const file = join(dir, 'public-schema.sql');
  const r = spawnSync('pg_dump', ['--no-owner', '--no-privileges', '--schema=public', '-f', file, dbUrl], { stdio: 'inherit' });
  manifest.pgDump = r.status === 0 ? file : `failed (exit ${r.status ?? r.error?.message})`;
}

// ─── Main ─────────────────────────────────────────────────

ensureDir(OUT);
console.log(`[export] Exporting ${URL_} -> ${OUT}`);
pgDump();
await exportTables();
await exportStorage();
writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`[export] Done. ${manifest.errors.length} errors. See ${join(OUT, 'manifest.json')}`);
