import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

// DELETE /api/presets/[id]   (user presets only; builtins are protected)
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { data, error } = await supabase
    .from('video_presets')
    .delete()
    .eq('id', id)
    .eq('source', 'user')
    .select('id');

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data?.length) return NextResponse.json({ error: 'not found or builtin' }, { status: 404 });
  return NextResponse.json({ success: true });
}
