import { NextRequest, NextResponse } from 'next/server';
import { safeFetch } from '@/lib/safe-url';
import { supabase } from '@/lib/supabase';
import { uploadFile } from '@/lib/storage';
import { extractFirstFrame } from '@/lib/video-thumbnail';

// ─── POST — Backfill missing video thumbnails ────────────
//
// One-shot endpoint to extract poster JPEGs for video_outputs rows where
// thumbnail_url IS NULL. Processes a batch per call so the request doesn't
// time out; call repeatedly until { remaining: 0 }.
//
// curl -X POST http://localhost:3000/api/video/backfill-thumbnails

const BATCH_SIZE = 5;

export async function POST(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const batch = Math.min(parseInt(searchParams.get('batch') || String(BATCH_SIZE)), 20);

    const { data: rows, error: queryErr } = await supabase
      .from('video_outputs')
      .select('id, video_generation_id, url, thumbnail_storage_path')
      .is('thumbnail_url', null)
      .not('url', 'is', null)
      .or('thumbnail_storage_path.is.null,thumbnail_storage_path.neq.__unrecoverable__')
      .limit(batch);

    if (queryErr) return NextResponse.json({ error: queryErr.message }, { status: 500 });
    if (!rows || rows.length === 0) {
      return NextResponse.json({ processed: 0, succeeded: 0, failed: 0, remaining: 0 });
    }

    let succeeded = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const row of rows) {
      try {
        const resp = await safeFetch(row.url as string, { purpose: 'thumbnail backfill', trustedProviderUrl: true });
        if (!resp.ok) {
          // Source URL is gone — mark unrecoverable so we stop retrying
          await supabase
            .from('video_outputs')
            .update({ thumbnail_storage_path: '__unrecoverable__' })
            .eq('id', row.id);
          throw new Error(`fetch ${resp.status} (marked unrecoverable)`);
        }
        const buffer = Buffer.from(await resp.arrayBuffer());

        const thumbBuffer = await extractFirstFrame(buffer);
        const thumbPath = `generated/${row.video_generation_id}/thumb.jpg`;
        const thumbUrl = await uploadFile('video-pipeline', thumbPath, thumbBuffer, 'image/jpeg');

        const { error: updateErr } = await supabase
          .from('video_outputs')
          .update({ thumbnail_url: thumbUrl, thumbnail_storage_path: thumbPath })
          .eq('id', row.id);

        if (updateErr) throw new Error(`update: ${updateErr.message}`);
        succeeded++;
        console.log(`[backfill-thumbs] OK ${row.id}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`${row.id}: ${msg}`);
        failed++;
        console.error(`[backfill-thumbs] FAIL ${row.id}: ${msg}`);
      }
    }

    // Remaining count (excluding records we've marked unrecoverable)
    const { count } = await supabase
      .from('video_outputs')
      .select('*', { count: 'exact', head: true })
      .is('thumbnail_url', null)
      .not('url', 'is', null)
      .or('thumbnail_storage_path.is.null,thumbnail_storage_path.neq.__unrecoverable__');

    return NextResponse.json({
      processed: rows.length,
      succeeded,
      failed,
      remaining: count ?? 0,
      errors: errors.length ? errors : undefined,
    });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error('[backfill-thumbs] error:', errMsg);
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}
