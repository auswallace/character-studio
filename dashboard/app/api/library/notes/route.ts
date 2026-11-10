import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { errorResponse, readJson } from '@/lib/http';

// One free-text note per Library image.
// GET /api/library/notes                               -> { notes: { "<source>:<record>:<index>": "text" } }
// PUT /api/library/notes { key, note }                 -> saves; an empty note deletes it

const SOURCES = new Set(['generation', 'remix', 'carousel', 'video']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET() {
  try {
    const { data, error } = await supabase.from('library_notes').select('source, record_id, image_index, note').limit(20000);
    if (error) throw error;
    const notes: Record<string, string> = {};
    for (const n of data || []) notes[`${n.source}:${n.record_id}:${n.image_index}`] = n.note;
    return NextResponse.json({ notes });
  } catch (e) { return errorResponse(e, 'library/notes'); }
}

export async function PUT(request: NextRequest) {
  try {
    const { key, note } = await readJson<{ key?: string; note?: string }>(request, 16);
    const [source, record_id, idx] = String(key || '').split(':');
    if (!SOURCES.has(source) || !UUID.test(record_id || '')) return NextResponse.json({ error: 'bad key' }, { status: 400 });
    const image_index = Number(idx) || 0;
    const text = (note || '').trim().slice(0, 1000);
    if (!text) {
      const { error } = await supabase.from('library_notes').delete().eq('source', source).eq('record_id', record_id).eq('image_index', image_index);
      if (error) throw error;
    } else {
      const { error } = await supabase.from('library_notes').upsert({ source, record_id, image_index, note: text, updated_at: new Date().toISOString() }, { onConflict: 'source,record_id,image_index' });
      if (error) throw error;
    }
    return NextResponse.json({ success: true, note: text });
  } catch (e) { return errorResponse(e, 'library/notes'); }
}
