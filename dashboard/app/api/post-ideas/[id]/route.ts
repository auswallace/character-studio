import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

// PATCH: Update an idea
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json();

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.caption_draft !== undefined) updates.caption_draft = body.caption_draft;
  if (body.images !== undefined) updates.images = body.images;
  if (body.platform !== undefined) updates.platform = body.platform;
  if (body.persona !== undefined) updates.persona = body.persona;

  const { data, error } = await supabase
    .from('post_ideas')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: 'Failed to update idea' }, { status: 500 });
  }
  return NextResponse.json({ idea: data });
}

// DELETE: Delete an idea
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const { error } = await supabase
    .from('post_ideas')
    .delete()
    .eq('id', id);

  if (error) {
    return NextResponse.json({ error: 'Failed to delete idea' }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}
