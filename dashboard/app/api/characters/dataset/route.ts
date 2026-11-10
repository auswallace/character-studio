import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { errorResponse, readJson } from '@/lib/http';

// GET    /api/characters/dataset?persona_id=
// POST   /api/characters/dataset   { persona_id, urls: string[] }        add library images (dedup by url)
// PATCH  /api/characters/dataset   { id, caption?, approved?, view? }
// DELETE /api/characters/dataset   { id } | { persona_id, all: true }

export async function GET(request: NextRequest) {
  try {
    const personaId = request.nextUrl.searchParams.get('persona_id');
    if (!personaId) return NextResponse.json({ error: 'persona_id required' }, { status: 400 });
    const { data, error } = await supabase.from('dataset_images').select('*').eq('persona_id', personaId).order('created_at', { ascending: true });
    if (error) throw error;
    return NextResponse.json({ images: data || [] });
  } catch (e) { return errorResponse(e, 'characters/dataset'); }
}

export async function POST(request: NextRequest) {
  try {
    const { persona_id, urls } = await readJson<{ persona_id?: string; urls?: string[] }>(request, 256);
    if (!persona_id || !Array.isArray(urls) || !urls.length) return NextResponse.json({ error: 'persona_id and urls[] required' }, { status: 400 });
    const clean = Array.from(new Set(urls.filter(u => typeof u === 'string' && /^https?:\/\//.test(u)))).slice(0, 200);

    // best effort: link back to the library row that owns the url
    const rows = [];
    for (const url of clean) {
      let source_kind = 'library', source_image_id: string | null = null, storage_path: string | null = null;
      for (const [table, kind] of [['generation_images', 'generation'], ['remix_images', 'remix'], ['carousel_images', 'carousel']] as const) {
        const { data } = await supabase.from(table).select('id, storage_path').eq('url', url).maybeSingle<{ id: string; storage_path: string | null }>();
        if (data) { source_kind = kind; source_image_id = data.id; storage_path = data.storage_path; break; }
      }
      rows.push({ persona_id, url, source_kind, source_image_id, storage_path, approved: true });
    }
    const { data, error } = await supabase.from('dataset_images').upsert(rows, { onConflict: 'persona_id,url', ignoreDuplicates: true }).select();
    if (error) throw error;
    return NextResponse.json({ added: data?.length || 0 });
  } catch (e) { return errorResponse(e, 'characters/dataset'); }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await readJson<{ id?: string; caption?: string; approved?: boolean; view?: string }>(request, 32);
    if (!body.id) return NextResponse.json({ error: 'id required' }, { status: 400 });
    const patch: Record<string, unknown> = {};
    if (typeof body.caption === 'string') patch.caption = body.caption.slice(0, 600);
    if (typeof body.approved === 'boolean') patch.approved = body.approved;
    if (typeof body.view === 'string') patch.view = body.view.slice(0, 20);
    const { error } = await supabase.from('dataset_images').update(patch).eq('id', body.id);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (e) { return errorResponse(e, 'characters/dataset'); }
}

export async function DELETE(request: NextRequest) {
  try {
    const body = await readJson<{ id?: string; persona_id?: string; all?: boolean }>(request, 16);
    if (body.id) {
      const { error } = await supabase.from('dataset_images').delete().eq('id', body.id);
      if (error) throw error;
      return NextResponse.json({ success: true });
    }
    if (body.persona_id && body.all) {
      const { error } = await supabase.from('dataset_images').delete().eq('persona_id', body.persona_id);
      if (error) throw error;
      return NextResponse.json({ success: true });
    }
    return NextResponse.json({ error: 'id or persona_id+all required' }, { status: 400 });
  } catch (e) { return errorResponse(e, 'characters/dataset'); }
}
