import { NextRequest, NextResponse } from 'next/server';
import { apiKeys, GROK_TEXT_MODEL } from '@/lib/supabase';

export async function POST(request: NextRequest) {
  try {
    const { stats } = await request.json();
    if (!stats) {
      return NextResponse.json({ error: 'Missing stats' }, { status: 400 });
    }

    const grokKey = apiKeys.grok;
    if (!grokKey) {
      return NextResponse.json({ strategy: 'Configure xAI API key to enable AI strategy insights.' });
    }

    const prompt = `You are a social media growth strategist for an AI influencer brand. Based on these scheduling stats for this month, give ONE short, actionable strategy recommendation (2-3 sentences max). Be specific and direct.

Stats:
- Total posts scheduled: ${stats.totalPosts}
- Persona balance: ${Object.entries(stats.personaBalance || {}).map(([k, v]) => `${k}: ${v}%`).join(', ')}
- Platform mix: ${Object.entries(stats.contentMix || {}).map(([k, v]) => `${k}: ${v}%`).join(', ')}
- Days with no posts this month: ${stats.gapDays}
- Month: ${stats.month}

Give a short, punchy strategy recommendation. No fluff.`;

    const res = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${grokKey}` },
      body: JSON.stringify({
        model: GROK_TEXT_MODEL,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 200,
        temperature: 0.7,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error('[insights] Grok error:', errText);
      return NextResponse.json({ strategy: 'Unable to generate strategy right now.' });
    }

    const data = await res.json();
    const strategy = data.choices?.[0]?.message?.content?.trim() || 'No strategy generated.';
    return NextResponse.json({ strategy });
  } catch (err) {
    console.error('[insights] Error:', err);
    return NextResponse.json({ strategy: 'Unable to generate strategy right now.' });
  }
}
