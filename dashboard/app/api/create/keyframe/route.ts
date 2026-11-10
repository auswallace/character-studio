import { NextRequest, NextResponse } from 'next/server';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeFile, readFile, unlink } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import ffmpegPath from 'ffmpeg-static';
import { errorResponse, readJson } from '@/lib/http';
import { safeFetch } from '@/lib/safe-url';
import { uploadFile } from '@/lib/storage';

// POST /api/create/keyframe  { videoUrl, at?: seconds }
// Downloads a video (direct link, <= 60 MB), grabs one frame, uploads it, returns { frameUrl, videoUrl }.
// Used by Create > Copy this video: the frame becomes the scene she is placed into; the video
// itself is the motion reference for Kling Motion.

const run = promisify(execFile);
const FFMPEG = ffmpegPath as unknown as string | null;

export async function POST(request: NextRequest) {
  try {
    const { videoUrl, at } = await readJson<{ videoUrl?: string; at?: number }>(request, 8);
    if (!videoUrl || !/^https?:\/\//.test(videoUrl)) return NextResponse.json({ error: 'videoUrl required (direct link to an mp4/mov)' }, { status: 400 });
    if (!FFMPEG) return NextResponse.json({ error: 'ffmpeg not available' }, { status: 500 });
    const res = await safeFetch(videoUrl, { purpose: 'keyframe source', trustedProviderUrl: true });
    if (!res.ok) return NextResponse.json({ error: `could not download video (${res.status})` }, { status: 400 });
    const ct = res.headers.get('content-type') || '';
    if (!/video|octet-stream/.test(ct)) return NextResponse.json({ error: `not a video link (${ct}). Paste a direct .mp4 link, or download the clip and upload it.` }, { status: 400 });
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 60 * 1024 * 1024) return NextResponse.json({ error: 'video over 60 MB' }, { status: 400 });

    const stamp = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const inPath = join(tmpdir(), `kf_${stamp}.mp4`), outPath = join(tmpdir(), `kf_${stamp}.jpg`);
    await writeFile(inPath, buf);
    try {
      await run(FFMPEG, ['-y', '-ss', String(Math.max(0, Number(at) || 0.5)), '-i', inPath, '-frames:v', '1', '-q:v', '2', outPath], { timeout: 60_000 });
      const frame = await readFile(outPath);
      const path = `keyframes/${stamp}.jpg`;
      const frameUrl = await uploadFile('remix-images', path, frame, 'image/jpeg');
      // keep the clip too so Kling Motion can fetch it from a stable URL
      const clipUrl = await uploadFile('remix-images', `keyframes/${stamp}.mp4`, buf, 'video/mp4');
      return NextResponse.json({ frameUrl, videoUrl: clipUrl, bytes: buf.length });
    } finally {
      await unlink(inPath).catch(() => {}); await unlink(outPath).catch(() => {});
    }
  } catch (e) { return errorResponse(e, 'create/keyframe'); }
}
