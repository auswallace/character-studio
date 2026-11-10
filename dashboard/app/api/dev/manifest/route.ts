import { NextRequest, NextResponse } from 'next/server';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

// DEV ONLY. POST /api/dev/manifest  { endpoint, provider, schema }  -> writes lib/models/<slug>.json
// Used by scripts/model-manifest.mjs and by a browser session on a provider's OpenAPI page (the
// sandbox that edits this repo has no network, so the schema is fetched where it can be reached).
// Refuses outside development and off localhost.

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'content-type' };

export async function OPTIONS() { return new NextResponse(null, { status: 204, headers: CORS }); }

export async function POST(request: NextRequest) {
  if (process.env.NODE_ENV !== 'development') return NextResponse.json({ error: 'dev only' }, { status: 403, headers: CORS });
  const host = request.headers.get('host') || '';
  if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)) return NextResponse.json({ error: 'localhost only' }, { status: 403, headers: CORS });
  try {
    const body = await request.json() as { endpoint?: string; provider?: string; schema?: unknown; manifest?: unknown };
    if (!body.endpoint || !/^[a-z0-9][a-z0-9./_-]+$/i.test(body.endpoint)) return NextResponse.json({ error: 'endpoint required' }, { status: 400, headers: CORS });
    const slug = body.endpoint.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
    const dir = join(process.cwd(), 'lib', 'models');
    await mkdir(dir, { recursive: true });
    const doc = { endpoint: body.endpoint, provider: body.provider || 'fal', fetched_at: new Date().toISOString(), ...(body.manifest ? { manifest: body.manifest } : {}), ...(body.schema ? { schema: body.schema } : {}) };
    await writeFile(join(dir, `${slug}.json`), JSON.stringify(doc, null, 2) + '\n');
    return NextResponse.json({ written: `lib/models/${slug}.json` }, { headers: CORS });
  } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500, headers: CORS }); }
}
