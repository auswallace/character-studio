import { NextRequest, NextResponse } from 'next/server';
import { upscaleRecordImages } from '@/lib/upscale';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const body = await request.json();
    const imageIndex = typeof body.imageIndex === 'number' ? body.imageIndex : undefined;

    // Fire-and-forget — respond immediately, upscale runs in background
    upscaleRecordImages('Generation', id, imageIndex).catch(err =>
      console.error(`[upscale] Background upscale failed for Generation/${id}:`, err)
    );

    return NextResponse.json({ success: true, message: 'Upscale started' });
  } catch (err) {
    console.error(`[upscale] Error:`, err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
