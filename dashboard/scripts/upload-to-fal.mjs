#!/usr/bin/env node
// Upload a file to fal's CDN storage (for LoRA files over Supabase's 50 MB cap).
// Uses @fal-ai/client, which does multipart for files over 100 MB.
//   npm install @fal-ai/client   (once)
//   node scripts/upload-to-fal.mjs ~/Downloads/lora_v1/mia_zimage_1.safetensors
// Prints the public URL to pass to Versions > Import LoRA.
import { readFileSync, statSync } from 'node:fs';
import { basename } from 'node:path';

const file = process.argv[2];
if (!file) { console.error('usage: node scripts/upload-to-fal.mjs <file>'); process.exit(1); }
for (const line of readFileSync('.env.local', 'utf8').split('\n')) { const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, ''); }
const key = process.env.FAL_API_KEY || process.env.FAL_KEY;
if (!key) { console.error('FAL_API_KEY missing in .env.local'); process.exit(1); }

let fal;
try { ({ fal } = await import('@fal-ai/client')); }
catch { console.error('Run once: npm install @fal-ai/client'); process.exit(1); }
fal.config({ credentials: key });

const size = statSync(file).size;
console.log(`[fal-upload] ${basename(file)} (${(size / 1e6).toFixed(1)} MB)`);
const blob = new Blob([readFileSync(file)], { type: 'application/octet-stream' });
const url = await fal.storage.upload(new File([blob], basename(file), { type: 'application/octet-stream' }));
console.log(`[fal-upload] done\n${url}`);
