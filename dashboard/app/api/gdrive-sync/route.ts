import { NextRequest } from 'next/server';
import { spawn } from 'child_process';
import { resolve } from 'path';
import { existsSync } from 'fs';

export const dynamic = 'force-dynamic';

// Resolve CLI script path at runtime (avoid Turbopack static analysis)
function getScriptDir() {
  return resolve(process.cwd(), '..', 'seedream-local');
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const dryRun = body.dryRun === true;
  const force = body.force === true;

  const scriptDir = getScriptDir();
  // The Drive sync script is a separate private tool and is not part of this repo.
  if (!existsSync(resolve(scriptDir, 'gdrive-sync.js'))) {
    return Response.json({ error: 'Drive sync is not included in this repo.' }, { status: 501 });
  }
  const args = [resolve(scriptDir, 'gdrive-sync.js')];
  if (dryRun) args.push('--dry-run');
  if (force) args.push('--force');

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const child = spawn(process.execPath, args, {
        cwd: scriptDir,
        env: { ...process.env },
      });

      function send(event: string, data: string) {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      }

      child.stdout.on('data', (chunk: Buffer) => {
        const lines = chunk.toString().split('\n').filter(Boolean);
        for (const line of lines) {
          send('log', line);
        }
      });

      child.stderr.on('data', (chunk: Buffer) => {
        const lines = chunk.toString().split('\n').filter(Boolean);
        for (const line of lines) {
          send('error', line);
        }
      });

      child.on('close', (code) => {
        send('done', code === 0 ? 'success' : `exit code ${code}`);
        controller.close();
      });

      child.on('error', (err) => {
        send('error', err.message);
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
