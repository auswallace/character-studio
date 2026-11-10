import { NextRequest, NextResponse } from 'next/server';
import { manifestFor, exposedFields, listManifests } from '@/lib/models/manifest';
import { MODEL_ENDPOINTS } from '@/lib/models/endpoints';
import { getProviderConfig } from '@/lib/providers/router';

// GET /api/models                  -> { endpoints: [...] }
// GET /api/models?endpoint=<id>    -> { endpoint, manifest, exposed: [...] }   (what the Studio renders chips from)
// GET /api/models?model=<app id>   -> same, for the endpoint the primary provider (Settings) will hit for that model
export async function GET(request: NextRequest) {
  let ep = request.nextUrl.searchParams.get('endpoint');
  const model = request.nextUrl.searchParams.get('model');
  let provider: string | undefined;
  if (!ep && model) {
    const cfg = await getProviderConfig();
    provider = cfg.primaryProvider === 'fal' ? 'fal' : 'wavespeed';
    ep = MODEL_ENDPOINTS[provider as 'fal' | 'wavespeed'][model] || null;
    if (!ep) return NextResponse.json({ error: `no endpoint for model ${model} on ${provider}` }, { status: 404 });
  }
  if (!ep) return NextResponse.json({ endpoints: listManifests() });
  const m = manifestFor(ep);
  if (!m) return NextResponse.json({ error: `no manifest for ${ep}` }, { status: 404 });
  return NextResponse.json({ endpoint: ep, provider: provider || m.provider, manifest: m, exposed: exposedFields(ep) });
}
