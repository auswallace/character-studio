import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

/**
 * Toggle the use_for_generation (favorite) flag on a scraped_posts record.
 * Body: { id: string, favorite: boolean }
 */
export async function PATCH(request: NextRequest) {
  try {
    const { id, favorite } = await request.json();

    if (!id || typeof favorite !== 'boolean') {
      return NextResponse.json(
        { error: 'Missing id or favorite boolean' },
        { status: 400 }
      );
    }

    const { error } = await supabase
      .from('scraped_posts')
      .update({ use_for_generation: favorite })
      .eq('id', id);

    if (error) throw new Error(`Supabase update failed: ${error.message}`);

    return NextResponse.json({ ok: true, id, favorite });
  } catch (error) {
    console.error('[api/inspiration/favorite] PATCH Error:', error);
    return NextResponse.json(
      { error: 'Failed to update favorite' },
      { status: 500 }
    );
  }
}
