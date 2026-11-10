import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { errorResponse, readJson } from '@/lib/http';

// Named dataset selections. A set is a list of dataset_images ids; loading one sets approved = (id in set).
// GET    /api/characters/dataset/sets?persona_id=     -> { sets: [{ id, name, count, created_at }] }
// POST   /api/characters/dataset/sets  { persona_id, name }            saves the current approved selection
// PATCH  /api/characters/dataset/sets  { id }                           loads a set (approve exactly its images)
// DELETE /api/characters/dataset/sets  { id }

export async function GET(request: NextRequest) {
  try {
    const personaId = request.nextUrl.searchParams.get('persona_id');
    if (!personaId) return NextResponse.json({ error: 'persona_id required' }, { status: 400 });
    const { data, error } = await supabase.from('dataset_sets').select('id, name, image_ids, created_at').eq('persona_id', personaId).order('created_at');
    if (error) throw error;
    return NextResponse.json({ sets: (data || []).map(s => ({ id: s.id, name: s.name, count: (s.image_ids as string[]).length, created_at: s.created_at })) });
  } catch (e) { return errorResponse(e, 'characters/dataset/sets'); }
}

export async function POST(request: NextRequest) {
  try {
    const { persona_id, name } = await readJson<{ persona_id?: string; name?: string }>(request, 8);
    if (!persona_id || !name?.trim()) return NextResponse.json({ error: 'persona_id and name required' }, { status: 400 });
    const { data: imgs } = await supabase.from('dataset_images').select('id').eq('persona_id', persona_id).eq('approved', true);
    const ids = (imgs || []).map(i => i.id);
    if (!ids.length) return NextResponse.json({ error: 'nothing ticked' }, { status: 400 });
    const { data, error } = await supabase.from('dataset_sets').insert({ persona_id, name: name.trim().slice(0, 80), image_ids: ids }).select('id').single();
    if (error) throw error;
    return NextResponse.json({ id: data.id, count: ids.length });
  } catch (e) { return errorResponse(e, 'characters/dataset/sets'); }
}

export async function PATCH(request: NextRequest) {
  try {
    const { id } = await readJson<{ id?: string }>(request, 8);
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
    const { data: set, error } = await supabase.from('dataset_sets').select('persona_id, image_ids').eq('id', id).single<{ persona_id: string; image_ids: string[] }>();
    if (error || !set) return NextResponse.json({ error: 'set not found' }, { status: 404 });
    await supabase.from('dataset_images').update({ approved: false }).eq('persona_id', set.persona_id);
    if (set.image_ids.length) await supabase.from('dataset_images').update({ approved: true }).in('id', set.image_ids);
    return NextResponse.json({ loaded: set.image_ids.length });
  } catch (e) { return errorResponse(e, 'characters/dataset/sets'); }
}

export async function DELETE(request: NextRequest) {
  try {
    const { id } = await readJson<{ id?: string }>(request, 8);
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
    const { error } = await supabase.from('dataset_sets').delete().eq('id', id);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (e) { return errorResponse(e, 'characters/dataset/sets'); }
}
