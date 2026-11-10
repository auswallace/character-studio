import { NextRequest, NextResponse } from 'next/server';
import { assertSpendAllowed } from '@/lib/spend-guard';
import { readJson, errorResponse } from '@/lib/http';
import { safeFetch } from '@/lib/safe-url';
import { apiKeys } from '@/lib/supabase';
import { uploadFile } from '@/lib/storage';
import { runWavespeedJob } from '@/lib/wavespeed-poll';
import { spawn } from 'child_process';
import { mkdtemp, writeFile, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import ffmpegPath from 'ffmpeg-static';

export const maxDuration = 300;

// audioUrl may also point at a video (.mp4/.mov): its sound track is pulled out with ffmpeg and used as the
// voice. Lets one clip borrow the voice of another (e.g. a Veo clip's voice on a silent Wan clip).
async function audioFromVideo(url: string): Promise<string> {
  const FFMPEG = ffmpegPath as unknown as string | null;
  if (!FFMPEG) throw new Error('ffmpeg-static binary path is unavailable');
  const res = await safeFetch(url, { purpose: 'voice source video', trustedProviderUrl: true });
  if (!res.ok) throw new Error(`Could not download the voice source: ${res.status}`);
  const dir = await mkdtemp(join(tmpdir(), 'lipsync-audio-'));
  try {
    const inp = join(dir, 'in.mp4'), out = join(dir, 'voice.mp3');
    await writeFile(inp, Buffer.from(await res.arrayBuffer()));
    await new Promise<void>((resolve, reject) => {
      const p = spawn(FFMPEG, ['-y', '-loglevel', 'error', '-i', inp, '-vn', '-ac', '1', '-ar', '44100', '-b:a', '128k', out]);
      let err = ''; p.stderr.on('data', d => { err += String(d); });
      p.on('close', code => code === 0 ? resolve() : reject(new Error(`ffmpeg could not extract audio (${code}): ${err.slice(0, 200)}`)));
    });
    const buf = await readFile(out);
    return await uploadFile('video-pipeline', `ads/voice/extracted-${crypto.randomUUID()}.mp3`, buf, 'audio/mpeg');
  } finally { await rm(dir, { recursive: true, force: true }).catch(() => {}); }
}

// ─── Lip Sync (Kling Lipsync via Wavespeed) ───────────────
//
// POST /api/ads/lipsync  { videoUrl, audioUrl, label? }
// Re-animates the mouth in an existing clip to match a fixed-voice audio track.
// This is how the spokesperson keeps ONE voice across clips: generate the clip
// with any model, make the line with /api/ads/voice, then lipsync the two.
//
// Wavespeed limits (kwaivgi/kling-lipsync/audio-to-video):
//   video: mp4/mov, 2-10s, 720p or 1080p, 720-1920px each side, <=100MB
//   audio: mp3/wav/m4a/aac, <=5MB
// The result is re-uploaded to our storage so the provider URL can expire.

const ENDPOINT = 'https://api.wavespeed.ai/api/v3/kwaivgi/kling-lipsync/audio-to-video';

export async function POST(request: NextRequest) {
  try {
    const { videoUrl, audioUrl, label } = await readJson<{ videoUrl?: string; audioUrl?: string; label?: string }>(request, 64);
    await assertSpendAllowed();

    if (!videoUrl || !audioUrl) {
      return NextResponse.json({ error: 'videoUrl and audioUrl are required' }, { status: 400 });
    }
    const wsKey = apiKeys.wavespeed;
    if (!wsKey) {
      return NextResponse.json({ error: 'Wavespeed API key not configured' }, { status: 500 });
    }

    const voiceUrl = /\.(mp4|mov)(\?|$)/i.test(audioUrl) ? await audioFromVideo(audioUrl) : audioUrl;
    const job = await runWavespeedJob({
      endpoint: ENDPOINT, body: { video: videoUrl, audio: voiceUrl }, apiKey: wsKey, tag: 'ads/lipsync', label: 'Kling Lipsync',
    });
    const outputUrl = job.outputs[0];
    const requestId = job.requestId;

    // Persist to our own storage (provider URLs expire).
    const dl = await safeFetch(outputUrl, { purpose: 'lipsync output', trustedProviderUrl: true });
    if (!dl.ok) throw new Error(`Could not download lipsync result: ${dl.status}`);
    const buffer = Buffer.from(await dl.arrayBuffer());
    const id = crypto.randomUUID();
    const storagePath = `ads/lipsync/${id}/${(label || 'clip').replace(/[^a-z0-9_-]/gi, '_')}.mp4`;
    const url = await uploadFile('video-pipeline', storagePath, buffer, 'video/mp4');

    console.log(`[ads/lipsync] done -> ${storagePath} (${(buffer.length / 1024 / 1024).toFixed(1)} MB)`);
    return NextResponse.json({ url, storagePath, providerUrl: outputUrl, requestId });
  } catch (error) {
    return errorResponse(error, 'ads/lipsync');
  }
}
