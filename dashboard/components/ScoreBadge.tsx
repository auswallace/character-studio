'use client';

import type { ImageScore } from '@/lib/use-scores';

// Face-consistency badge. Thresholds match scripts/scorer/README.md:
// >= 0.60 same person, 0.45-0.60 probably, < 0.45 not the same face.

interface ScoreBadgeProps {
  score: ImageScore | null | undefined;
  style?: React.CSSProperties;
}

export default function ScoreBadge({ score, style }: ScoreBadgeProps) {
  if (!score) return null; // not scored (yet), or scorer off
  const s = score.score;
  const [bg, fg, label, title] =
    s == null ? ['var(--color-bg-tertiary)', 'var(--color-text-secondary)', 'no face', 'No face found']
    : s >= 0.6 ? ['var(--color-success-muted)', '#065F46', `face ${s.toFixed(2)}`, 'Face match to her dataset: same person (>= 0.60)']
    : s >= 0.45 ? ['var(--color-warning-muted)', '#92400E', `face ${s.toFixed(2)}`, 'Face match to her dataset: probably her (0.45-0.60)']
    : ['var(--color-error-muted)', '#991B1B', `face ${s.toFixed(2)}`, 'Face match to her dataset: not her (< 0.45)'];
  return (
    <span
      title={`${title}${score.faces > 1 ? ` · ${score.faces} faces in frame` : ''}`}
      style={{ fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 6, background: bg, color: fg, lineHeight: 1.3, ...style }}
    >
      {label}{score.faces > 1 ? ` · ${score.faces}` : ''}
    </span>
  );
}
