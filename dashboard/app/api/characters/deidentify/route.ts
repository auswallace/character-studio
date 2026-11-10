import { NextRequest, NextResponse } from 'next/server';
import { errorResponse, readJson } from '@/lib/http';
import { assertSpendAllowed } from '@/lib/spend-guard';
import { deidentifyScene } from '@/lib/deidentify';

// POST /api/characters/deidentify { sceneUrl, aspect? } -> { url, cached, costUsd }
// Preview of the "pose only" mannequin. Cached per scene URL (second call is free).
export const maxDuration = 300;

const ASPECTS = new Set(['9:16', '3:4', '1:1', '16:9', '4:3', '2:3', '3:2']);

export async function POST(request: NextRequest) {
  try {
    const body = await readJson<{ sceneUrl?: string; aspect?: string }>(request, 16);
    if (!body.sceneUrl) return NextResponse.json({ error: 'sceneUrl is required' }, { status: 400 });
    await assertSpendAllowed();
    const aspect = body.aspect && ASPECTS.has(body.aspect) ? body.aspect : undefined;
    return NextResponse.json(await deidentifyScene(body.sceneUrl, aspect));
  } catch (e) {
    return errorResponse(e, 'characters/deidentify');
  }
}
