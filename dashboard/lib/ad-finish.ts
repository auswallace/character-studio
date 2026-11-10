// dashboard/lib/ad-finish.ts
//
// Finishing pass for spokesperson ads: stitch clips, burn in captions and the
// AI disclosure label, and export in 9:16 / 1:1 / 16:9. Uses the ffmpeg-static
// binary (same as lib/video-thumbnail.ts). Everything runs in a tmp dir.
//
// Captions use drawtext with `textfile=` so we never have to escape quotes.
// Font: FFMPEG_FONT env, else the macOS system font, else drawtext's default.

import { spawn } from 'child_process';
import { mkdtemp, writeFile, readFile, rm, access } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import ffmpegPath from 'ffmpeg-static';

const FFMPEG = ffmpegPath as unknown as string | null;

export type AdFormat = '9:16' | '1:1' | '16:9';

export interface FinishClip {
  buffer: Buffer;
  seconds: number;
  caption?: string;
}

export interface FinishOptions {
  clips: FinishClip[];
  disclosure?: string;          // small label shown for the whole video, e.g. "AI-generated spokesperson"
  formats?: AdFormat[];
  fps?: number;                 // default 30
  captionFontSize?: number;     // relative to 1080 height; default 56
}

export interface FinishResult {
  format: AdFormat;
  buffer: Buffer;
  width: number;
  height: number;
}

const SIZES: Record<AdFormat, [number, number]> = {
  '9:16': [1080, 1920],
  '1:1': [1080, 1080],
  '16:9': [1920, 1080],
};

const MAC_FONT = '/System/Library/Fonts/Supplemental/Arial.ttf';

async function fontArg(): Promise<string> {
  const candidates = [process.env.FFMPEG_FONT, MAC_FONT].filter(Boolean) as string[];
  for (const f of candidates) {
    try { await access(f); return `fontfile='${f}':`; } catch { /* try next */ }
  }
  return ''; // drawtext falls back to fontconfig default
}

/** Escape a path for use inside an ffmpeg filter graph option. */
function esc(p: string): string {
  return p.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'");
}

export async function finishAd(opts: FinishOptions): Promise<FinishResult[]> {
  if (!FFMPEG) throw new Error('ffmpeg-static binary path is unavailable');
  if (!opts.clips.length) throw new Error('No clips');

  const formats = opts.formats?.length ? opts.formats : (['9:16'] as AdFormat[]);
  const fps = opts.fps ?? 30;
  const font = await fontArg();
  const dir = await mkdtemp(join(tmpdir(), 'adfinish-'));

  try {
    // 1. Write inputs + caption text files.
    const inputs: string[] = [];
    const captionFiles: (string | null)[] = [];
    for (let i = 0; i < opts.clips.length; i++) {
      const p = join(dir, `in${i}.mp4`);
      await writeFile(p, opts.clips[i].buffer);
      inputs.push(p);
      if (opts.clips[i].caption?.trim()) {
        const cp = join(dir, `cap${i}.txt`);
        await writeFile(cp, opts.clips[i].caption!.trim(), 'utf8');
        captionFiles.push(cp);
      } else {
        captionFiles.push(null);
      }
    }
    let disclosureFile: string | null = null;
    if (opts.disclosure?.trim()) {
      disclosureFile = join(dir, 'disclosure.txt');
      await writeFile(disclosureFile, opts.disclosure.trim(), 'utf8');
    }

    const results: FinishResult[] = [];

    for (const format of formats) {
      const [W, H] = SIZES[format];
      const capSize = Math.round((opts.captionFontSize ?? 56) * (H / 1080) * (format === '16:9' ? 1 : 1.15));
      const discSize = Math.round(capSize * 0.5);

      // 2. Build one filter graph: per clip -> normalize (scale+crop to WxH, fps, sar)
      //    + caption; then concat; then disclosure overlay for the whole run.
      const parts: string[] = [];
      for (let i = 0; i < inputs.length; i++) {
        let chain =
          `[${i}:v]scale=${W}:${H}:force_original_aspect_ratio=increase,` +
          `crop=${W}:${H},fps=${fps},setsar=1,format=yuv420p`;
        if (captionFiles[i]) {
          chain +=
            `,drawtext=${font}textfile='${esc(captionFiles[i]!)}':` +
            `fontsize=${capSize}:fontcolor=white:borderw=${Math.max(2, Math.round(capSize / 14))}:bordercolor=black@0.85:` +
            `box=1:boxcolor=black@0.35:boxborderw=${Math.round(capSize / 3)}:` +
            `x=(w-text_w)/2:y=h*0.78-text_h/2:line_spacing=${Math.round(capSize / 5)}`;
        }
        chain += `[v${i}]`;
        parts.push(chain);
        // audio: resample so concat has matching streams; silent track if clip has none
        parts.push(`[${i}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo[a${i}]`);
      }
      const concatIn = inputs.map((_, i) => `[v${i}][a${i}]`).join('');
      parts.push(`${concatIn}concat=n=${inputs.length}:v=1:a=1[vc][ac]`);

      let finalV = '[vc]';
      if (disclosureFile) {
        parts.push(
          `[vc]drawtext=${font}textfile='${esc(disclosureFile)}':fontsize=${discSize}:fontcolor=white@0.9:` +
          `box=1:boxcolor=black@0.45:boxborderw=${Math.round(discSize / 2)}:` +
          `x=w-text_w-${Math.round(W * 0.03)}:y=${Math.round(H * 0.03)}[vd]`,
        );
        finalV = '[vd]';
      }

      const out = join(dir, `out_${format.replace(':', 'x')}.mp4`);
      const args = ['-y'];
      for (const p of inputs) args.push('-i', p);
      args.push(
        '-filter_complex', parts.join(';'),
        '-map', finalV, '-map', '[ac]',
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '160k',
        '-movflags', '+faststart',
        out,
      );

      await runFfmpeg(args);
      results.push({ format, buffer: await readFile(out), width: W, height: H });
    }

    return results;
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
      else reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-800)}`));
    });
  });
}
