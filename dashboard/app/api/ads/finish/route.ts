import { NextRequest, NextResponse } from 'next/server';
import { readJson, errorResponse } from '@/lib/http';
import { safeFetch } from '@/lib/safe-url';
import { uploadFile } from '@/lib/storage';
import { finishAd, type AdFormat } from '@/lib/ad-finish';

// ─── Ad Finish ────────────────────────────────────────────
//
// POST /api/ads/finish
// {
//   clips: [{ url, seconds, caption? }],   // in order; output of /api/video (+ optional /api/ads/lipsync)
//   disclosure?: string,                   // default "AI-generated spokesperson"
//   formats?: ['9:16','1:1','16:9'],       // default ['9:16']
//   label?: string
// }
// Stitches the clips, burns in captions + the AI label, exports each format,
// uploads to video-pipeline/ads/final/<id>/ and returns the URLs.
//
// Clips that lack an audio track will fail the concat; generate with audio on
// (every model we use supports it) or run lipsync first.

export const maxDuration = 300; // ffmpeg on 3 formats of a 30s ad can take a while

export async function POST(request: NextRequest) {
  try {
    const body = await readJson<{
      clips?: { url: string; seconds?: number; caption?: string }[];
      disclosure?: string;
      formats?: AdFormat[];
      label?: string;
    }>(request, 128);

    if (!body.clips?.length) {
      return NextResponse.json({ error: 'clips[] is required' }, { status: 400 });
    }
    if (body.clips.length > 8) {
      return NextResponse.json({ error: 'max 8 clips' }, { status: 400 });
    }
    const formats = (body.formats || ['9:16']).filter((f): f is AdFormat => ['9:16', '1:1', '16:9'].includes(f));

    // Download clips in parallel.
    const buffers = await Promise.all(body.clips.map(async (c, i) => {
      const res = await safeFetch(c.url, { purpose: `clip ${i + 1}` });
      if (!res.ok) throw new Error(`clip ${i + 1} download failed: ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    }));

    const results = await finishAd({
      clips: body.clips.map((c, i) => ({ buffer: buffers[i], seconds: c.seconds || 5, caption: c.caption })),
      disclosure: body.disclosure ?? 'AI-generated spokesperson',
      formats,
    });

    const id = crypto.randomUUID();
    const safeLabel = (body.label || 'ad').replace(/[^a-z0-9_-]/gi, '_');
    const outputs = [];
    for (const r of results) {
      const storagePath = `ads/final/${id}/${safeLabel}_${r.format.replace(':', 'x')}.mp4`;
      const url = await uploadFile('video-pipeline', storagePath, r.buffer, 'video/mp4');
      outputs.push({ format: r.format, width: r.width, height: r.height, bytes: r.buffer.length, url, storagePath });
    }

    console.log(`[ads/finish] ${body.clips.length} clips -> ${outputs.length} format(s) (${id})`);
    return NextResponse.json({ id, outputs });
  } catch (error) {
    return errorResponse(error, 'ads/finish');
  }
}
