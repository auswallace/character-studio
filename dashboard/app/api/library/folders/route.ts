import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { errorResponse, readJson } from '@/lib/http';

// Library folders for the Gallery. An image (source + record + index) is in at most one folder.
// GET    /api/library/folders                      -> { folders: [{ id, name, count }], items: { "<source>:<record>:<index>": folderId } }
// POST   /api/library/folders { name }             -> { folder }
// PATCH  /api/library/folders { id, name }         rename
// PATCH  /api/library/folders { folder_id | null, keys: ["source:record:index", ...] }   move (null = remove from its folder)
// DELETE /api/library/folders { id }               deletes the folder; its images stay in the Library, unfiled

const SOURCES = new Set(['generation', 'remix', 'carousel', 'video']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET() {
  try {
    const [{ data: folders, error: e1 }, { data: items, error: e2 }] = await Promise.all([
      supabase.from('library_folders').select('id, name, created_at').order('created_at', { ascending: true }),
      supabase.from('library_folder_items').select('source, record_id, image_index, folder_id').limit(20000),
    ]);
    if (e1) throw e1; if (e2) throw e2;
    const map: Record<string, string> = {};
    const counts: Record<string, number> = {};
    for (const it of items || []) { map[`${it.source}:${it.record_id}:${it.image_index}`] = it.folder_id; counts[it.folder_id] = (counts[it.folder_id] || 0) + 1; }
    return NextResponse.json({ folders: (folders || []).map(f => ({ id: f.id, name: f.name, count: counts[f.id] || 0 })), items: map });
  } catch (e) { return errorResponse(e, 'library/folders'); }
}

export async function POST(request: NextRequest) {
  try {
    const { name } = await readJson<{ name?: string }>(request, 8);
    const clean = (name || '').trim().slice(0, 60);
    if (!clean) return NextResponse.json({ error: 'name required' }, { status: 400 });
    const { data, error } = await supabase.from('library_folders').insert({ name: clean }).select('id, name').single();
    if (error) throw error;
    return NextResponse.json({ folder: { ...data, count: 0 } });
  } catch (e) { return errorResponse(e, 'library/folders'); }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await readJson<{ id?: string; name?: string; folder_id?: string | null; keys?: string[] }>(request, 512);
    if (body.id && typeof body.name === 'string') {
      const clean = body.name.trim().slice(0, 60);
      if (!clean) return NextResponse.json({ error: 'name required' }, { status: 400 });
      const { error } = await supabase.from('library_folders').update({ name: clean }).eq('id', body.id);
      if (error) throw error;
      return NextResponse.json({ success: true });
    }
    if (!Array.isArray(body.keys) || !body.keys.length) return NextResponse.json({ error: 'keys[] required' }, { status: 400 });
    const rows = body.keys.slice(0, 2000).map(k => { const [source, record_id, idx] = String(k).split(':'); return { source, record_id, image_index: Number(idx) || 0 }; })
      .filter(r => SOURCES.has(r.source) && UUID.test(r.record_id));
    if (!rows.length) return NextResponse.json({ error: 'no valid keys' }, { status: 400 });
    if (body.folder_id) {
      if (!UUID.test(body.folder_id)) return NextResponse.json({ error: 'bad folder_id' }, { status: 400 });
      const { error } = await supabase.from('library_folder_items').upsert(rows.map(r => ({ ...r, folder_id: body.folder_id })), { onConflict: 'source,record_id,image_index' });
      if (error) throw error;
    } else {
      for (const r of rows) {
        const { error } = await supabase.from('library_folder_items').delete().eq('source', r.source).eq('record_id', r.record_id).eq('image_index', r.image_index);
        if (error) throw error;
      }
    }
    return NextResponse.json({ moved: rows.length });
  } catch (e) { return errorResponse(e, 'library/folders'); }
}

export async function DELETE(request: NextRequest) {
  try {
    const { id } = await readJson<{ id?: string }>(request, 8);
    if (!id || !UUID.test(id)) return NextResponse.json({ error: 'id required' }, { status: 400 });
    const { error } = await supabase.from('library_folders').delete().eq('id', id);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (e) { return errorResponse(e, 'library/folders'); }
}
