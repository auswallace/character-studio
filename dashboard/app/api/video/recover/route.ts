import { NextRequest, NextResponse } from 'next/server';
import { supabase, apiKeys } from '@/lib/supabase';

// ─── POST — Recover stuck video generations ──────────────
//
// Checks all records with status='generating' that are older than 12 minutes.
// (It was 2 minutes, which is shorter than a normal job: reloading the Video tab mid-job made this route
// insert a second output row with the provider's temporary URL and no thumbnail, racing the real save.)
// For each, polls fal.ai or Wavespeed to check if the video actually completed.
// Updates the DB accordingly.

const FAL_QUEUE_BASE = 'https://queue.fal.run';

const FAL_MODEL_ENDPOINTS: Record<string, string> = {
  'kling_v3': 'fal-ai/kling-video/v3/pro/image-to-video',
  'kling_2.6_motion': 'fal-ai/kling-video/v2.6/pro/motion-control',
  'seedance_1.5': 'fal-ai/bytedance/seedance/v1.5/pro/image-to-video',
  'seedance_2.0': 'bytedance/seedance-2.0/image-to-video',
};

const WAVESPEED_POLL_BASE = 'https://api.wavespeed.ai/api/v3/predictions';

export async function POST(request: NextRequest) {
  try {
    // Find stuck records (generating for more than 12 minutes: longer than any live job in /api/video)
    const twoMinAgo = new Date(Date.now() - 12 * 60 * 1000).toISOString();

    const { data: stuck, error } = await supabase
      .from('video_generations')
      .select('id, video_model, provider, provider_request_id, created_at')
      .eq('status', 'generating')
      .lt('created_at', twoMinAgo)
      .limit(20);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!stuck || stuck.length === 0) {
      return NextResponse.json({ recovered: 0, message: 'No stuck generations found' });
    }

    console.log(`[video/recover] Found ${stuck.length} stuck records`);

    let recovered = 0;
    let failed = 0;

    for (const record of stuck) {
      try {
        // Try to recover from fal.ai if we have a request ID
        if (record.provider_request_id && record.provider === 'fal') {
          const falEndpoint = FAL_MODEL_ENDPOINTS[record.video_model];
          if (falEndpoint) {
            const result = await checkFalStatus(falEndpoint, record.provider_request_id);
            if (result.completed && result.videoUrl) {
              // Save the video output
              await supabase.from('video_outputs').insert({
                video_generation_id: record.id,
                url: result.videoUrl,
                filename: 'video.mp4',
                mime_type: 'video/mp4',
                has_audio: false,
                completed_at: new Date().toISOString(),
              });
              await supabase.from('video_generations').update({ status: 'done' }).eq('id', record.id);
              console.log(`[video/recover] Recovered ${record.id} from fal.ai`);
              recovered++;
              continue;
            } else if (result.failed) {
              await supabase.from('video_generations').update({
                status: 'error',
                error_details: result.error || 'Generation failed on provider',
              }).eq('id', record.id);
              failed++;
              continue;
            }
            // Still processing — skip for now
            continue;
          }
        }

        // Try Wavespeed if provider is wavespeed
        if (record.provider_request_id && record.provider === 'wavespeed') {
          const result = await checkWavespeedStatus(record.provider_request_id);
          if (result.completed && result.videoUrl) {
            await supabase.from('video_outputs').insert({
              video_generation_id: record.id,
              url: result.videoUrl,
              filename: 'video.mp4',
              mime_type: 'video/mp4',
              has_audio: false,
              completed_at: new Date().toISOString(),
            });
            await supabase.from('video_generations').update({ status: 'done' }).eq('id', record.id);
            console.log(`[video/recover] Recovered ${record.id} from Wavespeed`);
            recovered++;
            continue;
          } else if (result.failed) {
            await supabase.from('video_generations').update({
              status: 'error',
              error_details: result.error || 'Generation failed on provider',
            }).eq('id', record.id);
            failed++;
            continue;
          }
          continue;
        }

        // No provider request ID — record was created but never submitted
        // Mark as error if older than 10 minutes
        const age = Date.now() - new Date(record.created_at).getTime();
        if (age > 10 * 60 * 1000) {
          await supabase.from('video_generations').update({
            status: 'error',
            error_details: 'Generation timed out — no provider request ID',
          }).eq('id', record.id);
          failed++;
        }
      } catch (recoverErr) {
        console.error(`[video/recover] Error recovering ${record.id}:`, recoverErr);
      }
    }

    return NextResponse.json({
      total: stuck.length,
      recovered,
      failed,
      stillProcessing: stuck.length - recovered - failed,
    });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error('[video/recover] Error:', errMsg);
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}

// ─── Helpers ──────────────────────────────────────────────

interface PollResult {
  completed: boolean;
  failed: boolean;
  videoUrl?: string;
  error?: string;
}

async function checkFalStatus(endpoint: string, requestId: string): Promise<PollResult> {
  const falKey = apiKeys.fal;
  if (!falKey) return { completed: false, failed: false };

  try {
    const statusRes = await fetch(
      `${FAL_QUEUE_BASE}/${endpoint}/requests/${requestId}/status`,
      { headers: { Authorization: `Key ${falKey}` } },
    );

    if (!statusRes.ok) return { completed: false, failed: false };
    const status = await statusRes.json();

    if (status.status === 'COMPLETED') {
      const resultRes = await fetch(
        `${FAL_QUEUE_BASE}/${endpoint}/requests/${requestId}`,
        { headers: { Authorization: `Key ${falKey}` } },
      );
      if (!resultRes.ok) return { completed: false, failed: true, error: `Result fetch failed: ${resultRes.status}` };

      const data = await resultRes.json();
      const videoUrl = data.video?.url;
      return videoUrl
        ? { completed: true, failed: false, videoUrl }
        : { completed: false, failed: true, error: 'No video URL in result' };
    }

    if (status.status === 'FAILED') {
      return { completed: false, failed: true, error: status.error || 'Unknown fal.ai error' };
    }

    return { completed: false, failed: false }; // Still processing
  } catch {
    return { completed: false, failed: false };
  }
}

async function checkWavespeedStatus(requestId: string): Promise<PollResult> {
  const wsKey = apiKeys.wavespeed;
  if (!wsKey) return { completed: false, failed: false };

  try {
    const pollRes = await fetch(
      `${WAVESPEED_POLL_BASE}/${requestId}/result`,
      { headers: { Authorization: `Bearer ${wsKey}` } },
    );

    if (!pollRes.ok) return { completed: false, failed: false };
    const data = await pollRes.json();

    if (data.data?.status === 'completed' || data.status === 'completed') {
      const outputs = data.data?.outputs || data.outputs || [];
      const videoUrl = Array.isArray(outputs) ? outputs[0] : outputs;
      return videoUrl
        ? { completed: true, failed: false, videoUrl }
        : { completed: false, failed: true, error: 'No video URL in result' };
    }

    if (data.data?.status === 'failed' || data.status === 'failed') {
      return { completed: false, failed: true, error: data.data?.error || 'Unknown Wavespeed error' };
    }

    return { completed: false, failed: false };
  } catch {
    return { completed: false, failed: false };
  }
}
