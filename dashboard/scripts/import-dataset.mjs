#!/usr/bin/env node
// Import a folder of images (+ optional same-name .txt captions) into a persona's character dataset.
//   node scripts/import-dataset.mjs --dir ~/Downloads/lora_v1 --persona "Samantha" [--dry]
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, extname, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const dir = arg('--dir'); const who = arg('--persona'); const dry = args.includes('--dry');
if (!dir || !who) { console.error('usage: --dir <folder> --persona <name>'); process.exit(1); }

for (const line of readFileSync('.env.local', 'utf8').split('\n')) { const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, ''); }
const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_ANON_KEY;
const sb = createClient(url, key);

const { data: personas, error: pe } = await sb.from('personas').select('id,name');
if (pe || !personas) { console.error('cannot reach Supabase:', pe?.message); process.exit(1); }
const persona = personas.find(p => p.name.toLowerCase().includes(who.toLowerCase()));
if (!persona) { console.error('persona not found. have:', personas.map(p => p.name).join(', ')); process.exit(1); }

const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
const files = readdirSync(dir).filter(f => MIME[extname(f).toLowerCase()]).sort();
console.log(`[import] ${files.length} images from ${dir} -> ${persona.name} (${persona.id})${dry ? ' [dry run]' : ''}`);
let added = 0, dup = 0, cap = 0;
for (const f of files) {
  const buf = readFileSync(join(dir, f));
  const ext = extname(f).toLowerCase(); const mime = MIME[ext];
  const hash = createHash('sha256').update(buf).digest('hex').slice(0, 20);
  const path = `uploads/${persona.id}/${hash}.${ext === '.jpeg' ? 'jpg' : ext.slice(1)}`;
  const txt = join(dir, basename(f, ext) + '.txt');
  const caption = existsSync(txt) ? readFileSync(txt, 'utf8').trim().replace(/\s+/g, ' ') : null;
  if (dry) { console.log(`  ${f}  ${(buf.length / 1e6).toFixed(1)}MB ${caption ? 'caption' : ''}`); continue; }
  const { error: ue } = await sb.storage.from('persona-datasets').upload(path, buf, { contentType: mime, upsert: true });
  if (ue) { console.error(`  ${f}: upload failed: ${ue.message}`); continue; }
  const publicUrl = sb.storage.from('persona-datasets').getPublicUrl(path).data.publicUrl;
  const { data: row, error } = await sb.from('dataset_images').upsert({ persona_id: persona.id, url: publicUrl, storage_path: path, source_kind: 'upload', approved: true, caption }, { onConflict: 'persona_id,url', ignoreDuplicates: true }).select('id');
  if (error) { console.error(`  ${f}: ${error.message}`); continue; }
  if (!row?.length) { dup++; continue; }
  added++; if (caption) cap++;
  process.stdout.write(`\r[import] ${added + dup}/${files.length}   `);
}
console.log(`\n[import] added ${added} (${cap} with captions), ${dup} already there. Open the Character tab and hit Sort.`);
