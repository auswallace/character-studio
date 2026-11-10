import { NextRequest, NextResponse } from 'next/server';
import { readJson, errorResponse } from '@/lib/http';
import { apiKeys } from '@/lib/supabase';
import { uploadFile } from '@/lib/storage';

// ─── Spokesperson Voice (TTS) ─────────────────────────────
//
// POST /api/ads/voice  { text, voiceId?, label? }
// Turns one clip's dialogue into an MP3 with a FIXED ElevenLabs voice, so the
// spokesperson sounds the same in every clip and every ad. Uploads the MP3 to
// the video-pipeline bucket and returns its public URL (the lipsync model
// needs a URL, not bytes).
//
// Env: ELEVENLABS_API_KEY (required), ELEVENLABS_VOICE_ID (default voice).

const ELEVEN_TTS = 'https://api.elevenlabs.io/v1/text-to-speech';

export async function POST(request: NextRequest) {
  try {
    const { text, voiceId, label } = await readJson<{ text?: string; voiceId?: string; label?: string }>(request, 64);

    if (!text || !text.trim()) {
      return NextResponse.json({ error: 'text is required' }, { status: 400 });
    }
    if (text.length > 1000) {
      return NextResponse.json({ error: 'text too long (max 1000 chars per clip)' }, { status: 400 });
    }

    const key = apiKeys.elevenlabs;
    if (!key) {
      return NextResponse.json({ error: 'ELEVENLABS_API_KEY not configured' }, { status: 500 });
    }
    const voice = voiceId || process.env.ELEVENLABS_VOICE_ID;
    if (!voice) {
      return NextResponse.json({ error: 'No voice: pass voiceId or set ELEVENLABS_VOICE_ID' }, { status: 400 });
    }

    const res = await fetch(`${ELEVEN_TTS}/${voice}?output_format=mp3_44100_128`, {
      method: 'POST',
      headers: {
        'xi-api-key': key,
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        text: text.trim(),
        model_id: 'eleven_multilingual_v2',
        voice_settings: { stability: 0.5, similarity_boost: 0.8, style: 0.2, use_speaker_boost: true },
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`ElevenLabs error ${res.status}: ${errText.substring(0, 200)}`);
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length > 5 * 1024 * 1024) {
      throw new Error('Audio over 5MB; Kling lipsync rejects files that large. Shorten the text.');
    }

    const id = crypto.randomUUID();
    const storagePath = `ads/voice/${id}/${(label || 'clip').replace(/[^a-z0-9_-]/gi, '_')}.mp3`;
    const url = await uploadFile('video-pipeline', storagePath, buffer, 'audio/mpeg');

    console.log(`[ads/voice] ${text.length} chars -> ${(buffer.length / 1024).toFixed(0)} KB -> ${storagePath}`);
    return NextResponse.json({ url, storagePath, bytes: buffer.length, voiceId: voice });
  } catch (error) {
    return errorResponse(error, 'ads/voice');
  }
}
