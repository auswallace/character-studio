import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function PATCH(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    // Read current starred value
    const { data: record, error: readError } = await supabase
      .from('carousels')
      .select('starred')
      .eq('id', id)
      .single();

    if (readError) throw readError;

    const currentStarred = record.starred || false;
    const newStarred = !currentStarred;

    // Toggle it
    const { error: updateError } = await supabase
      .from('carousels')
      .update({ starred: newStarred })
      .eq('id', id);

    if (updateError) throw updateError;

    return NextResponse.json({ success: true, starred: newStarred });
  } catch (err) {
    console.error(`[carousel/star] Error:`, err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
