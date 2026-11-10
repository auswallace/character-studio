import { createHash } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { uploadFile } from '@/lib/storage';
import { errorResponse } from '@/lib/http';

// POST /api/characters/dataset/upload  multipart: persona_id + files[] (images)
// Drag-and-drop path into the training dataset. Max 50 files, 15 MB each.
export async function POST(request: NextRequest) {
  try {
    const form = await request.formData();
    const personaId = String(form.get('persona_id') || '');
    if (!personaId) return NextResponse.json({ error: 'persona_id required' }, { status: 400 });
    const all = form.getAll('files').filter((f): f is File => f instanceof File).slice(0, 120);
    if (!all.length) return NextResponse.json({ error: 'no files' }, { status: 400 });

    // Existing captions: a .txt with the same stem as an image (image_0028.png + image_0028.txt).
    // The first word is treated as the old trigger and replaced by this persona's trigger at train time.
    const captions = new Map<string, string>();
    for (const f of all) {
      if (f.name.toLowerCase().endsWith('.txt') && f.size < 4000) {
        captions.set(f.name.replace(/\.txt$/i, '').toLowerCase(), (await f.text()).trim().replace(/\s+/g, ' '));
      }
    }
    const images = all.filter(f => f.type.startsWith('image/'));
    if (!images.length) return NextResponse.json({ error: 'no image files (txt captions are optional and must sit next to images)' }, { status: 400 });

    let added = 0, withCaption = 0, duplicates = 0; const skipped: string[] = [];
    for (const file of images) {
      if (file.size > 25 * 1024 * 1024) { skipped.push(`${file.name}: over 25 MB`); continue; }
      const buf = Buffer.from(await file.arrayBuffer());
      const ext = file.type.includes('png') ? 'png' : file.type.includes('webp') ? 'webp' : 'jpg';
      const stem = file.name.replace(/\.[^.]+$/, '').toLowerCase();
      // Path is the content hash: the same bytes uploaded twice land on the same URL and the row is a no-op.
      const hash = createHash('sha256').update(buf).digest('hex').slice(0, 20);
      const path = `uploads/${personaId}/${hash}.${ext}`;
      const url = await uploadFile('persona-datasets', path, buf, file.type);
      const caption = captions.get(stem) || null;
      const { data: row, error } = await supabase.from('dataset_images').upsert({ persona_id: personaId, url, storage_path: path, source_kind: 'upload', approved: true, caption }, { onConflict: 'persona_id,url', ignoreDuplicates: true }).select('id');
      if (error) { skipped.push(`${file.name}: ${error.message}`); continue; }
      if (!row?.length) { duplicates++; continue; }
      added++; if (caption) withCaption++;
    }
    return NextResponse.json({ added, withCaption, duplicates, skipped });
  } catch (e) { return errorResponse(e, 'characters/dataset/upload'); }
}
