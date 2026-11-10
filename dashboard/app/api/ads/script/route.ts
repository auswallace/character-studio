import { NextRequest, NextResponse } from 'next/server';
import { readJson, errorResponse } from '@/lib/http';
import { apiKeys, GROK_TEXT_MODEL } from '@/lib/supabase';

// ─── Ad Script Generator ─────────────────────────────────
//
// POST /api/ads/script
// Generates a short spokesperson video ad script for a product, split into
// clips the video models can render (each clip = one generation).
//
// Compliance by design (FTC fake-reviews rule, 2024): the character is a
// SPOKESPERSON / PRESENTER, never a "customer". Scripts never claim personal
// use, results, or a timeline of use ("I've used this for 3 weeks"). The AI
// disclosure line is returned so the UI can burn it in.
//
// This is a NEW prompt. It does not touch the image/remix/video templates.

// ─── Types ────────────────────────────────────────────────

interface AdScriptRequest {
  productName: string;
  productDescription: string;     // what it is, who it's for, 1-3 key benefits
  audience?: string;              // "busy parents", "runners", ...
  tone?: 'warm' | 'direct' | 'playful' | 'premium';
  totalSeconds?: number;          // 15 | 20 | 30
  clipSeconds?: number;           // per-clip length the chosen model supports (5-15)
  spokesperson?: string;          // short description of the AI character
  cta?: string;                   // "Link in bio", "Shop at example.com"
  platform?: 'tiktok' | 'reels' | 'shorts' | 'x';
}

export interface AdClip {
  index: number;
  section: 'hook' | 'problem' | 'demo' | 'proof' | 'cta';
  seconds: number;
  dialogue: string;               // spoken line, plain text, no quotes
  action: string;                 // what the spokesperson does with the product
  shot: string;                   // framing + camera
  videoPrompt: string;            // ready-to-send prompt for Seedance/Kling/Omni
  caption: string;                // on-screen text for this clip
}

export interface AdScript {
  title: string;
  totalSeconds: number;
  clips: AdClip[];
  disclosure: string;             // e.g. "AI-generated spokesperson"
  hashtags: string[];
  complianceNotes: string[];
}

// ─── Prompt ───────────────────────────────────────────────

const BANNED_CLAIMS = [
  'I use this every day', 'I\'ve been using', 'changed my life', 'cured', 'guaranteed',
  'clinically proven', 'doctors recommend', 'best in the world', '#1', 'results in',
];

function buildSystemPrompt(req: AdScriptRequest, clipCount: number, clipSeconds: number): string {
  return `You write short-form video ad scripts for an AI-generated SPOKESPERSON (not a customer).

Hard rules:
1. The spokesperson PRESENTS and DEMONSTRATES the product. They never claim to have bought it, used it for a period of time, or gotten personal results. No "I've used this for weeks", no before/after, no testimonial language.
2. No health, medical, financial, or performance claims unless the product description states them explicitly. No superlatives ("best", "#1"). No "guaranteed".
3. Never use these phrases: ${BANNED_CLAIMS.join('; ')}.
4. Every clip must be renderable by an image-to-video model: ONE continuous shot, ONE location, the spokesperson holding or showing the product. No cuts inside a clip. No text on screen inside the video prompt (captions are added later).
5. Dialogue per clip must fit the clip length: about 2.5 words per second. For a ${clipSeconds}s clip that is at most ${Math.round(clipSeconds * 2.5)} words.
6. Clip 1 is the hook: first 2 seconds must earn the next 3. Ask a question or state the one thing the product does. Last clip is the CTA, using the CTA text given.
7. videoPrompt format: "[Shot]. [Spokesperson description] [action with product], says \\"[dialogue]\\". [Lighting]. [Camera]." Keep it under 90 words. Dialogue goes in quotes inside the prompt so the model lip-syncs it.
8. Tone: ${req.tone || 'warm'}. Platform: ${req.platform || 'reels'}. Audience: ${req.audience || 'general'}.

Output ONLY valid JSON matching this shape, no markdown fences, no commentary:
{
  "title": string,
  "clips": [ { "index": number, "section": "hook"|"problem"|"demo"|"proof"|"cta", "seconds": number, "dialogue": string, "action": string, "shot": string, "videoPrompt": string, "caption": string } ],
  "hashtags": string[]  (3-5, no spaces, lowercase)
}
Produce exactly ${clipCount} clips of ${clipSeconds} seconds each, in order: hook, then problem/demo/proof as needed, then cta.`;
}

// ─── Route ────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const body = await readJson<AdScriptRequest>(request, 64);

    if (!body.productName || !body.productDescription) {
      return NextResponse.json({ error: 'productName and productDescription are required' }, { status: 400 });
    }

    const grokKey = apiKeys.grok;
    if (!grokKey) {
      return NextResponse.json({ error: 'Grok API key not configured' }, { status: 500 });
    }

    const totalSeconds = [15, 20, 30].includes(body.totalSeconds || 0) ? (body.totalSeconds as number) : 15;
    const clipSeconds = Math.min(Math.max(body.clipSeconds || 5, 3), 30);
    const clipCount = Math.max(1, Math.round(totalSeconds / clipSeconds));

    const userPrompt = [
      `Product: ${body.productName}`,
      `Description: ${body.productDescription}`,
      `Spokesperson: ${body.spokesperson || 'a friendly woman in her late 20s, natural look, casual clothing'}`,
      `CTA text: ${body.cta || 'Link in bio'}`,
      `Total length: ${totalSeconds}s as ${clipCount} clips of ${clipSeconds}s`,
    ].join('\n');

    const res = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${grokKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: GROK_TEXT_MODEL,
        messages: [
          { role: 'system', content: buildSystemPrompt(body, clipCount, clipSeconds) },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.8,
        max_tokens: 2000,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Grok API error ${res.status}: ${errText.substring(0, 200)}`);
    }

    const data = await res.json();
    const raw: string = data.choices?.[0]?.message?.content?.trim() || '';
    const jsonText = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');

    let parsed: { title: string; clips: AdClip[]; hashtags?: string[] };
    try {
      parsed = JSON.parse(jsonText);
    } catch {
      throw new Error(`Grok returned non-JSON: ${raw.substring(0, 200)}`);
    }

    if (!Array.isArray(parsed.clips) || parsed.clips.length === 0) {
      throw new Error('Grok returned no clips');
    }

    // Server-side compliance pass: flag any banned phrase that slipped through.
    const complianceNotes: string[] = [];
    for (const clip of parsed.clips) {
      const text = `${clip.dialogue} ${clip.videoPrompt} ${clip.caption}`.toLowerCase();
      for (const phrase of BANNED_CLAIMS) {
        if (text.includes(phrase.toLowerCase())) {
          complianceNotes.push(`Clip ${clip.index}: contains "${phrase}" - rewrite before use`);
        }
      }
      const words = (clip.dialogue || '').split(/\s+/).filter(Boolean).length;
      if (words > clip.seconds * 3) {
        complianceNotes.push(`Clip ${clip.index}: ${words} words is too many for ${clip.seconds}s`);
      }
    }

    const script: AdScript = {
      title: parsed.title || `${body.productName} ad`,
      totalSeconds,
      clips: parsed.clips.map((c, i) => ({ ...c, index: i + 1, seconds: c.seconds || clipSeconds })),
      disclosure: 'AI-generated spokesperson',
      hashtags: (parsed.hashtags || []).slice(0, 5),
      complianceNotes,
    };

    console.log(`[ads/script] ${script.clips.length} clips for "${body.productName}" (${complianceNotes.length} compliance notes)`);
    return NextResponse.json(script);
  } catch (error) {
    return errorResponse(error, 'ads/script');
  }
}
