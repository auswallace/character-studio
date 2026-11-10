import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { deleteFile } from '@/lib/storage';

// ─── PATCH — Toggle Star ─────────────────────────────────

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;

    // Get current starred state
    const { data: current, error: fetchError } = await supabase
      .from('video_generations')
      .select('starred')
      .eq('id', id)
      .single();

    if (fetchError || !current) {
      return NextResponse.json({ error: 'Video generation not found' }, { status: 404 });
    }

    const newStarred = !current.starred;
    const { error: updateError } = await supabase
      .from('video_generations')
      .update({ starred: newStarred })
      .eq('id', id);

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    return NextResponse.json({ starred: newStarred });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error('[video/star] Error:', errMsg);
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}

// ─── DELETE — Delete Video Generation + Outputs ───────────

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;

    // Get all outputs to clean up storage
    const { data: outputs } = await supabase
      .from('video_outputs')
      .select('storage_path')
      .eq('video_generation_id', id);

    // Delete storage files
    if (outputs && outputs.length > 0) {
      await Promise.allSettled(
        outputs
          .filter(o => o.storage_path)
          .map(o => deleteFile('video-pipeline', o.storage_path!))
      );
    }

    // Delete outputs (cascade should handle this, but be explicit)
    await supabase
      .from('video_outputs')
      .delete()
      .eq('video_generation_id', id);

    // Delete generation record
    const { error: deleteError } = await supabase
      .from('video_generations')
      .delete()
      .eq('id', id);

    if (deleteError) {
      return NextResponse.json({ error: deleteError.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error('[video/delete] Error:', errMsg);
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}
