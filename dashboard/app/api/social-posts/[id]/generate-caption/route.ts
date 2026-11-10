import { NextRequest, NextResponse } from 'next/server';
import { apiKeys, GROK_VISION_MODEL } from '@/lib/supabase';
import { getTemplate } from '@/lib/prompt-templates';

// Map persona display names → template keys
const PERSONA_CAPTION_KEYS: Record<string, string> = {
  'sofi belle': 'caption:instructions:sofi_belle',
  'samantha bell': 'caption:instructions:samantha_bell',
};

const PLATFORM_PROMPTS: Record<string, string> = {
  Instagram: `Instagram: 1-3 sentences. Can be slightly longer if it feels natural. First line is what people see before "...more" so make it count. No emojis.`,
  Twitter: `Twitter/X: MUST be a simple question. Ask something that makes people want to reply. The question should relate to the image — what she's wearing, where she is, the vibe, a choice, an opinion. Keep it under 200 characters. Think engagement-bait questions that feel natural from a hot girl, not corporate polls. Examples of good X captions: "would you take me on a second date dressed like this", "be honest do I look better in black or white", "what would you do if I showed up like this"`,
  Threads: `Threads: Conversational and authentic — like texting your followers. 1-2 sentences max. Threads is text-first, so the caption matters more than on Instagram. Think casual hot take, relatable thought, or asking a question that invites replies. No emojis. Examples: "tell me this lighting isn't doing something rn", "posting this before my confidence runs out"`,
  TikTok: `TikTok: Short, hook-first, trending vibe. No emojis.`,
};

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await params; // consume params even though we don't need the id
    const body = await request.json();
    const { platform, imageUrl, persona } = body;

    if (!platform || !imageUrl) {
      return NextResponse.json(
        { error: 'platform and imageUrl are required' },
        { status: 400 }
      );
    }

    const grokKey = apiKeys.grok;
    if (!grokKey) {
      return NextResponse.json(
        { error: 'Grok API key not configured' },
        { status: 500 }
      );
    }

    const platformInstruction = PLATFORM_PROMPTS[platform] || PLATFORM_PROMPTS.Instagram;

    // Fetch persona-specific caption instructions (if configured)
    let personaInstructions = '';
    if (persona) {
      const templateKey = PERSONA_CAPTION_KEYS[persona.toLowerCase()];
      if (templateKey) {
        personaInstructions = await getTemplate(templateKey, '');
      }
    }

    const prompt = `Look at this image. Write a single caption for ${platform}.

${persona ? `You are ${persona}. ` : ''}You are a hot girl posting on social media. Write like a real person — flirty, playful, low effort, confident. The kind of caption a 22 year old influencer girl would actually type with her thumbs in 5 seconds.

VOICE RULES:
- Short. Most captions are 1-2 sentences MAX. Sometimes just a few words.
- Lowercase is fine. Don't capitalize everything like a press release.
- Flirty, teasing, a little suggestive but never trying too hard
- ABSOLUTELY NO EMOJIS. Zero. None. Not a single one.
- NEVER sound like a marketing team, a brand, a LinkedIn post, or a motivational speaker
- No hashtags ever
- No cringe phrases like "living my best life", "self-care Sunday", "main character moment"
- It should sound like something you'd text your friends, not write in a blog

WHAT GOOD CAPTIONS LOOK LIKE:
- "caught you staring"
- "idk felt cute"
- "this pic goes hard idc"
- "not sorry about it"
- "hi I missed you"
- "posting before I overthink it"

CRITICAL: Your caption must be ORIGINAL and reference something specific about what's actually in the image — the outfit, the setting, the pose, the mood, the lighting, whatever stands out.

INSTAGRAM STRATEGY RULES:
- NEVER mention "fanvue", "onlyfans", "fansly", or any subscription platform by name
- NEVER use "link in bio" CTAs
- No hashtags
- Keep captions clean and SFW

PLATFORM RULES:
${platformInstruction}
${personaInstructions ? `\nADDITIONAL PERSONA INSTRUCTIONS:\n${personaInstructions}\n` : ''}
Return ONLY the caption text, nothing else. No quotes, no JSON, no explanation — just the caption itself.`;

    const response = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${grokKey}`,
      },
      body: JSON.stringify({
        model: GROK_VISION_MODEL,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image_url',
                image_url: { url: imageUrl },
              },
              {
                type: 'text',
                text: prompt,
              },
            ],
          },
        ],
        max_tokens: 300,
        temperature: 0.9,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('[generate-caption] Grok API error:', errText);
      return NextResponse.json(
        { error: `Grok API error: ${response.status}` },
        { status: 502 }
      );
    }

    const data = await response.json();
    const caption = data.choices?.[0]?.message?.content?.trim() || '';

    // Clean up any stray quotes the model may wrap the output in
    const cleaned = caption.replace(/^["']|["']$/g, '');

    return NextResponse.json({ caption: cleaned });
  } catch (error) {
    console.error('[generate-caption] Error:', error);
    return NextResponse.json(
      { error: 'Failed to generate caption' },
      { status: 500 }
    );
  }
}
