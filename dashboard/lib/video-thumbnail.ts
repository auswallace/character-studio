import { spawn } from 'child_process';
import { mkdtemp, writeFile, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import ffmpegPath from 'ffmpeg-static';

// ─── Video Thumbnail Extraction ──────────────────────────
// Extracts a single JPEG frame from a video buffer using the static ffmpeg
// binary shipped via ffmpeg-static. Reads/writes to a tmp dir to avoid
// stdin/stdout streaming complexity (ffmpeg's MP4 demuxer needs seeking).

const FFMPEG = ffmpegPath as unknown as string | null;

export interface ThumbnailOptions {
  /** Seek time in seconds before grabbing the frame. Default 0.5. */
  seekSeconds?: number;
  /** JPEG quality 1-31 (lower = better). Default 4. */
  quality?: number;
  /** Max width in pixels; height auto. Default 1280. */
  maxWidth?: number;
}

export async function extractFirstFrame(
  videoBuffer: Buffer,
  opts: ThumbnailOptions = {},
): Promise<Buffer> {
  if (!FFMPEG) {
    throw new Error('ffmpeg-static binary path is unavailable');
  }
  const seek = opts.seekSeconds ?? 0.5;
  const quality = opts.quality ?? 4;
  const maxWidth = opts.maxWidth ?? 1280;

  const dir = await mkdtemp(join(tmpdir(), 'vidthumb-'));
  const inPath = join(dir, 'in.mp4');
  const outPath = join(dir, 'out.jpg');
  try {
    await writeFile(inPath, videoBuffer);

    await runFfmpeg([
      '-y',
      '-ss', String(seek),
      '-i', inPath,
      '-frames:v', '1',
      '-vf', `scale='min(${maxWidth},iw)':-2`,
      '-q:v', String(quality),
      outPath,
    ]);

    return await readFile(outPath);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => { /* best effort */ });
  }
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG as string, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    proc.stderr.on('data', (c: Buffer) => { stderr += c.toString(); });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-500)}`));
    });
  });
}

// Put the sound track of one video on another (video stream copied, audio re-encoded to AAC, cut to the shorter one).
// Returns null when the source has no audio track. Used by "Copy motion": Wan Animate output is silent.
export async function muxAudioFrom(videoBuffer: Buffer, audioSourceBuffer: Buffer): Promise<Buffer | null> {
  if (!FFMPEG) throw new Error('ffmpeg-static binary path is unavailable');
  const dir = await mkdtemp(join(tmpdir(), 'vidmux-'));
  const v = join(dir, 'v.mp4'), a = join(dir, 'a.mp4'), out = join(dir, 'out.mp4');
  try {
    await writeFile(v, videoBuffer); await writeFile(a, audioSourceBuffer);
    try {
      await runFfmpeg(['-y', '-i', v, '-i', a, '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-shortest', '-movflags', '+faststart', out]);
    } catch (e) {
      if (/matches no streams|does not contain any stream/i.test(e instanceof Error ? e.message : '')) return null;
      throw e;
    }
    return await readFile(out);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => { /* best effort */ });
  }
}
