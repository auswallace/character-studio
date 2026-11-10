// dashboard/lib/wavespeed-poll.ts
//
// One implementation of the Wavespeed async pattern: POST to a model endpoint,
// get a prediction id, poll /predictions/{id}/result until completed/failed.
// Every video provider, lipsync, and any future Wavespeed call should use this
// instead of carrying its own copy of the loop.

export const WAVESPEED_POLL_BASE = 'https://api.wavespeed.ai/api/v3/predictions';

export interface WavespeedJobOptions {
  endpoint: string;                       // full URL of the model endpoint
  body: Record<string, unknown>;
  apiKey: string;
  tag: string;                            // log prefix, e.g. 'kling', 'veo'
  label?: string;                         // human name for progress messages
  pollIntervalMs?: number;                // default 5000
  maxPolls?: number;                      // default 120 (~10 min)
  onProgress?: (stage: string) => void;
  onRequestId?: (requestId: string, provider: string) => void;
}

export interface WavespeedJobResult {
  requestId: string;
  outputs: string[];                      // output URLs (first is usually the one you want)
  submittedAt: string;
  completedAt: string;
  raw: unknown;                           // full final poll payload, for cost/metadata extraction
}

const TERMINAL_FAILURES = new Set(['failed', 'cancelled', 'timeout', 'deleted']);

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function runWavespeedJob(opts: WavespeedJobOptions): Promise<WavespeedJobResult> {
  const { endpoint, body, apiKey, tag } = opts;
  const label = opts.label || tag;
  const pollInterval = opts.pollIntervalMs ?? 5000;
  const maxPolls = opts.maxPolls ?? 120;
  if (!apiKey) throw new Error('Wavespeed API key not configured');

  const submittedAt = new Date().toISOString();
  console.log(`[${tag}] Submitting to Wavespeed (${label})...`);
  opts.onProgress?.(`Submitting to Wavespeed (${label})...`);

  const submitRes = await fetch(endpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!submitRes.ok) {
    const errText = await submitRes.text();
    throw new Error(`Wavespeed submit error ${submitRes.status}: ${errText.substring(0, 300)}`);
  }
  const submitData = await submitRes.json();
  const requestId: string | undefined = submitData.data?.id || submitData.id;
  if (!requestId) throw new Error('Wavespeed: no request ID returned');

  console.log(`[${tag}] Wavespeed request_id: ${requestId}`);
  opts.onRequestId?.(requestId, 'wavespeed');
  opts.onProgress?.('Queued, waiting for generation...');

  const pollEndpoint = `${WAVESPEED_POLL_BASE}/${requestId}/result`;
  for (let poll = 0; poll < maxPolls; poll++) {
    await sleep(pollInterval);

    const pollRes = await fetch(pollEndpoint, { headers: { Authorization: `Bearer ${apiKey}` } });
    if (!pollRes.ok) {
      console.warn(`[${tag}] poll ${poll + 1} HTTP ${pollRes.status}`);
      continue;
    }
    const pollData = await pollRes.json();
    const status: string = pollData.data?.status || pollData.status || '';

    if (status === 'completed') {
      const rawOutputs = pollData.data?.outputs ?? pollData.outputs ?? [];
      const list = Array.isArray(rawOutputs) ? rawOutputs : [rawOutputs];
      const outputs = list.map((o: unknown) => (typeof o === 'string' ? o : (o as { url?: string })?.url)).filter(Boolean) as string[];
      if (!outputs.length) throw new Error('Wavespeed: completed but no output URL returned');
      console.log(`[${tag}] Wavespeed complete: ${outputs[0]}`);
      return { requestId, outputs, submittedAt, completedAt: new Date().toISOString(), raw: pollData };
    }

    if (TERMINAL_FAILURES.has(status)) {
      throw new Error(`Wavespeed generation ${status}: ${pollData.data?.error || 'unknown'}`);
    }

    const elapsed = Math.round((poll + 1) * pollInterval / 1000);
    opts.onProgress?.(`Generating video... (${elapsed}s)`);
  }

  throw new Error(`Wavespeed: timed out after ${maxPolls * pollInterval / 1000}s`);
}
