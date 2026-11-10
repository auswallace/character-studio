'use client';

import { useState, useEffect } from 'react';
import type { ActiveJob } from '@/contexts/ActiveJobsContext';

interface ActiveJobCardProps {
  job: ActiveJob;
  accentVar?: string;
}

export default function ActiveJobCard({ job, accentVar = '--color-accent' }: ActiveJobCardProps) {
  const isRunning = job.status === 'running';
  const isDone = job.status === 'done';
  const isError = job.status === 'error';

  // Shimmer animation offset
  const [shimmer, setShimmer] = useState(0);
  useEffect(() => {
    if (!isRunning) return;
    const interval = setInterval(() => setShimmer(s => (s + 1) % 100), 30);
    return () => clearInterval(interval);
  }, [isRunning]);

  return (
    <div
      style={{
        borderRadius: 14,
        overflow: 'hidden',
        background: 'var(--color-bg-primary)',
        border: '1px solid',
        borderColor: isError ? 'var(--color-error)' : 'var(--color-border)',
      }}
    >
      {/* Header */}
      <div style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {isRunning && (
            <div style={{ width: 20, height: 20, position: 'relative' }}>
              <svg width="20" height="20" viewBox="0 0 48 48" style={{ animation: 'hexPulse 2s ease-in-out infinite' }}>
                <defs>
                  <linearGradient id={`jobGrad-${job.id}`} x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#1D4ED8"/>
                    <stop offset="100%" stopColor="#60A5FA"/>
                  </linearGradient>
                </defs>
                <polygon points="24,2 44,13 44,35 24,46 4,35 4,13" fill={`url(#jobGrad-${job.id})`}/>
                <circle cx="24" cy="24" r="7" fill="none" stroke="white" strokeWidth="2" opacity="0.8"/>
              </svg>
            </div>
          )}
          {isDone && (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" fill="var(--color-success)" opacity="0.15"/>
              <path d="M8 12.5L11 15.5L16 9.5" stroke="var(--color-success)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          )}
          {isError && (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" fill="var(--color-error)" opacity="0.15"/>
              <path d="M15 9L9 15M9 9L15 15" stroke="var(--color-error)" strokeWidth="2" strokeLinecap="round"/>
            </svg>
          )}
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-primary)' }}>
            {isDone ? (job.resultName || 'Complete') : isError ? 'Failed' : 'Generating...'}
          </span>
          {isRunning && (
            <span style={{
              fontSize: 11,
              fontWeight: 500,
              color: '#3B82F6',
              background: 'rgba(59,130,246,0.08)',
              padding: '2px 8px',
              borderRadius: 8,
            }}>
              {job.stage === 'Starting...' ? 'Preparing' :
               job.stage === 'Calling API...' ? 'Sending' :
               job.stage === 'Connected...' ? 'Processing' :
               job.stage?.includes('Generating') ? 'Creating' :
               job.stage === 'Done!' ? 'Finishing' :
               'Working'}
            </span>
          )}
          {isDone && (
            <span style={{
              fontSize: 11,
              fontWeight: 500,
              color: 'var(--color-success)',
              background: 'var(--color-success-muted)',
              padding: '2px 8px',
              borderRadius: 8,
            }}>
              {job.imageCount} images
            </span>
          )}
          {isError && (
            <span style={{
              fontSize: 11,
              fontWeight: 500,
              color: 'var(--color-error)',
              background: 'var(--color-error-muted)',
              padding: '2px 8px',
              borderRadius: 8,
            }}>
              {job.errorMessage || 'Generation failed'}
            </span>
          )}
        </div>
        <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>
          {job.model}
        </span>
      </div>

      {/* Progress bar — smooth gradient shimmer */}
      {isRunning && (
        <div style={{ padding: '0 16px 10px' }}>
          <div style={{ height: 3, borderRadius: 2, background: 'var(--color-bg-tertiary)', overflow: 'hidden', position: 'relative' }}>
            <div
              style={{
                height: '100%',
                borderRadius: 2,
                width: `${Math.max(job.progress, 5)}%`,
                background: 'linear-gradient(90deg, #1D4ED8, #60A5FA, #1D4ED8)',
                backgroundSize: '200% 100%',
                backgroundPosition: `${shimmer}% 0`,
                transition: 'width 1.5s ease-out',
              }}
            />
          </div>
        </div>
      )}

      {/* Streamed images + skeleton placeholders */}
      {(job.streamedImages.length > 0 || (isRunning && job.progress > 10)) && (
        <div style={{ padding: '0 16px 16px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
            {job.streamedImages.map((url, i) => (
              <div
                key={i}
                className="fade-in"
                style={{ aspectRatio: '4/5', borderRadius: 10, overflow: 'hidden', position: 'relative', background: 'var(--color-bg-tertiary)' }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt={`Generated ${i + 1}`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              </div>
            ))}
            {isRunning && Array.from(
              { length: Math.max(0, job.numImages - job.streamedImages.length) },
              (_, i) => (
                <div
                  key={`ph-${i}`}
                  style={{
                    aspectRatio: '4/5',
                    borderRadius: 10,
                    background: 'var(--color-bg-tertiary)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    position: 'relative',
                    overflow: 'hidden',
                  }}
                >
                  {/* Shimmer overlay */}
                  <div style={{
                    position: 'absolute',
                    inset: 0,
                    background: `linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.04) 50%, transparent 100%)`,
                    backgroundSize: '200% 100%',
                    animation: 'shimmerSlide 1.8s ease-in-out infinite',
                  }} />
                  {/* Top-left status badge */}
                  <div style={{
                    position: 'absolute',
                    top: 8,
                    left: 8,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 7,
                    background: 'rgba(255,255,255,0.85)',
                    backdropFilter: 'blur(8px)',
                    boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
                    borderRadius: 24,
                    padding: '6px 12px 6px 7px',
                  }}>
                    <svg width="18" height="18" viewBox="0 0 48 48" style={{ animation: 'spinPulse 3s ease-in-out infinite', flexShrink: 0 }}>
                      <defs>
                        <linearGradient id={`ajGrad-${i}`} x1="0%" y1="0%" x2="100%" y2="100%">
                          <stop offset="0%" stopColor="#1D4ED8"/>
                          <stop offset="100%" stopColor="#60A5FA"/>
                        </linearGradient>
                      </defs>
                      <polygon points="24,4 42,14 42,34 24,44 6,34 6,14" fill={`url(#ajGrad-${i})`}/>
                      <circle cx="24" cy="24" r="9" fill="white"/>
                    </svg>
                    <span className="shimmer-text" style={{ fontSize: 12, fontWeight: 600 }}>Generating</span>
                  </div>
                </div>
              ),
            )}
          </div>
        </div>
      )}

      <style>{`
        @keyframes spinPulse {
          0% { transform: rotate(0deg) scale(1); opacity: 0.6; }
          50% { transform: rotate(180deg) scale(1.1); opacity: 1; }
          100% { transform: rotate(360deg) scale(1); opacity: 0.6; }
        }
        @keyframes shimmerSlide {
          0% { background-position: -200% 0; }
          100% { background-position: 200% 0; }
        }
        .shimmer-text {
          background: linear-gradient(90deg, #333 0%, #333 35%, #999 50%, #333 65%, #333 100%);
          background-size: 200% 100%;
          -webkit-background-clip: text;
          background-clip: text;
          -webkit-text-fill-color: transparent;
          animation: shimmerText 2s ease-in-out infinite;
        }
        @keyframes shimmerText {
          0% { background-position: 100% 0; }
          100% { background-position: -100% 0; }
        }
      `}</style>
    </div>
  );
}
