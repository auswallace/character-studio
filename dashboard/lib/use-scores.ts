'use client';

// Client hook: face-consistency scores for a set of parent records, keyed by image URL.
// Polls /api/scores every 4s while some images are still unscored (scoring runs in the
// background after save), and stops after 90s or when everything is scored.
// Does nothing when the scorer is not configured.

import { useEffect, useState } from 'react';

export type ScoreKind = 'generation' | 'remix' | 'carousel';
export interface ImageScore { score: number | null; faces: number; view: string | null }

const POLL_MS = 4000;
const MAX_POLL_MS = 90_000;

export function useScores(kind: ScoreKind, parentIds: string[]): Record<string, ImageScore | null> {
  const [scores, setScores] = useState<Record<string, ImageScore | null>>({});
  const key = [...new Set(parentIds.filter(Boolean))].sort().join(',');

  useEffect(() => {
    if (!key) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const started = Date.now();

    const tick = async () => {
      try {
        const res = await fetch(`/api/scores?kind=${kind}&parent_ids=${key}`);
        if (!res.ok || stopped) return;
        const data = (await res.json()) as { configured: boolean; scores: Record<string, ImageScore | null> };
        setScores(data.scores || {});
        const pending = Object.values(data.scores || {}).some(v => v === null);
        if (data.configured && pending && Date.now() - started < MAX_POLL_MS) timer = setTimeout(tick, POLL_MS);
      } catch { /* best effort */ }
    };
    void tick();
    return () => { stopped = true; if (timer) clearTimeout(timer); };
  }, [kind, key]);

  return scores;
}
