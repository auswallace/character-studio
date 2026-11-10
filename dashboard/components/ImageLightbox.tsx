'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';

interface LightboxImage {
  url: string;
  label?: string;
  type?: 'image' | 'video';
}

interface LightboxActions {
  onStar?: (index: number) => void;
  onUpscale?: (index: number) => void;
  onRemix?: (index: number) => void;
  onCarouselImage?: (index: number) => void;
  onDownload?: (index: number) => void;
  onDelete?: (index: number) => void;
  onNote?: (index: number, text: string) => void;   // save a free-text note for the image (empty = remove)
}

interface LightboxImageMeta {
  starred?: boolean;
  upscaled?: boolean;
  note?: string;
  score?: { score: number | null; faces: number } | null;   // face match to her dataset (scripts/scorer); a result, not a setting
}

/** Generation metadata for the info panel */
interface GenerationMeta {
  personaName?: string;
  personaAvatar?: string;
  genName?: string;
  feature?: 'Image Copy' | 'Image Remix' | 'Image Carousel' | 'Video';
  model?: string;
  quality?: string;
  aspectRatio?: string;
  createdAt?: string;
  prompt?: string;
  provider?: string;
  resolution?: string;
  refImage?: string;
  outputThumbnails?: string[];
  providerInput?: Record<string, unknown> | null;   // exact JSON sent to the provider (endpoint + fields)
  // Video-specific fields
  duration?: number;
  hasAudio?: boolean;
  cfgScale?: number;
  cameraFixed?: boolean;
  characterOrientation?: 'image' | 'video';
  seed?: number;
  sourceImageUrl?: string;
}

interface ImageLightboxProps {
  images: LightboxImage[];
  initialIndex: number;
  onClose: () => void;
  actions?: LightboxActions;
  imageMeta?: LightboxImageMeta[];
  generationMeta?: GenerationMeta;
  generationMetas?: GenerationMeta[];
}

export type { LightboxImage, LightboxActions, LightboxImageMeta, GenerationMeta };

export default function ImageLightbox({ images, initialIndex, onClose, actions, imageMeta, generationMeta, generationMetas }: ImageLightboxProps) {
  const [index, setIndex] = useState(initialIndex);
  const [mounted, setMounted] = useState(false);
  const [seeAllOpen, setSeeAllOpen] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [viewingRef, setViewingRef] = useState(false);
  const [zoomed, setZoomed] = useState(false);   // full-size view for judging faces; click or Esc leaves it
  const moreMenuRef = useRef<HTMLDivElement>(null);

  // Portal mount guard
  useEffect(() => { setMounted(true); }, []);

  // Body scroll lock
  useEffect(() => {
    const original = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = original; };
  }, []);

  // Keyboard navigation
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT')) { if (e.key === 'Escape') t.blur(); return; }   // typing a note: arrows and Esc stay in the field
    if (e.key === 'Escape') { if (zoomed) setZoomed(false); else onClose(); }
    if (e.key === 'ArrowLeft') { setIndex(prev => Math.max(0, prev - 1)); setViewingRef(false); setZoomed(false); }
    if (e.key === 'ArrowRight') { setIndex(prev => Math.min(images.length - 1, prev + 1)); setViewingRef(false); setZoomed(false); }
  }, [onClose, images.length, zoomed]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // Close more menu on outside click
  useEffect(() => {
    if (!moreMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (moreMenuRef.current && !moreMenuRef.current.contains(e.target as Node)) {
        setMoreMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [moreMenuOpen]);

  if (!mounted) return null;

  const current = images[index];
  if (!current) return null;

  const meta = imageMeta?.[index];
  const gm = generationMetas?.[index] || generationMeta;
  const hasPanel = !!gm;
  const displayUrl = viewingRef && gm?.refImage ? gm.refImage : current.url;
  const hasPrev = index > 0;
  const hasNext = index < images.length - 1;

  // Model badge colors
  const getModelBadgeStyle = (model?: string) => {
    if (!model) return {};
    const m = model.toLowerCase();
    if (m.includes('nanobanana')) return { background: '#FEF9C3', color: '#A16207' };
    if (m.includes('seedream')) return { background: '#E0E7FF', color: '#4338CA' };
    return { background: '#F5F5F5', color: '#555' };
  };

  const getFeatureBadgeStyle = (feature?: string) => {
    if (feature === 'Image Remix') return { background: '#D1FAE5', color: '#065F46' };
    if (feature === 'Image Carousel') return { background: '#EDE9FE', color: '#5B21B6' };
    return { background: '#DBEAFE', color: '#1E40AF' };
  };

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) +
      ' \u00b7 ' +
      d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  };

  return createPortal(
    <div
      className="fixed inset-0"
      style={{ zIndex: 50, background: current.type === 'video' ? 'transparent' : '#000' }}
      onClick={onClose}
    >
      {/* Blurred background — image backdrop for images, frosted glass for videos */}
      <div
        style={{
          position: 'absolute', inset: 0, zIndex: 0,
          ...(current.type === 'video'
            ? { background: 'rgba(243, 243, 243, 0.35)', backdropFilter: 'blur(32px)' }
            : {
                backgroundImage: `url(${displayUrl})`,
                backgroundSize: 'cover', backgroundPosition: 'center',
                filter: 'blur(10px) saturate(1.6) brightness(0.5)',
                transform: 'scale(1.5)',
              }
          ),
        }}
      />
      {/* Subtle scrim for contrast */}
      <div style={{ position: 'absolute', inset: 0, zIndex: 1, background: 'rgba(0,0,0,0.15)' }} />

      {/* Close button (only shown when no panel — panel has its own close) */}
      {!hasPanel && (
        <button
          onClick={onClose}
          className="absolute top-5 right-6 w-10 h-10 rounded-full flex items-center justify-center transition-colors"
          style={{ background: 'rgba(0,0,0,0.3)', color: 'rgba(255,255,255,0.8)', zIndex: 100, border: '1px solid rgba(255,255,255,0.15)', backdropFilter: 'blur(12px)' }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      )}

      {/* Previous arrow */}
      {hasPrev && (
        <button
          onClick={(e) => { e.stopPropagation(); setIndex(prev => prev - 1); setViewingRef(false); }}
          className="absolute w-11 h-11 rounded-full flex items-center justify-center transition-colors"
          style={{ left: 16, top: '50%', transform: 'translateY(-50%)', background: 'rgba(255,255,255,0.9)', color: '#333', zIndex: 50, border: '1px solid rgba(0,0,0,0.08)', backdropFilter: 'blur(12px)', boxShadow: '0 2px 8px rgba(0,0,0,0.15)' }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
      )}

      {/* Next arrow — positioned left of the panel when panel is shown */}
      {hasNext && (
        <button
          onClick={(e) => { e.stopPropagation(); setIndex(prev => prev + 1); setViewingRef(false); }}
          className="absolute w-11 h-11 rounded-full flex items-center justify-center transition-colors"
          style={{ right: hasPanel ? 396 : 16, top: '50%', transform: 'translateY(-50%)', background: 'rgba(255,255,255,0.9)', color: '#333', zIndex: 50, border: '1px solid rgba(0,0,0,0.08)', backdropFilter: 'blur(12px)', boxShadow: '0 2px 8px rgba(0,0,0,0.15)' }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      )}

      {/* Main content area */}
      <div
        className="fixed inset-0 flex items-center justify-center"
        style={{ zIndex: 10, padding: '48px 60px', gap: 28 }}
        onClick={onClose}
      >
        {/* Image/Video area */}
        <div className="flex-1 flex items-center justify-center relative" style={{ minWidth: 0, maxHeight: '80vh' }}>
          {current.type === 'video' ? (
            <video
              src={displayUrl}
              controls
              autoPlay
              onClick={(e) => e.stopPropagation()}
              className="object-contain"
              style={{
                width: 'auto', height: 'auto',
                maxWidth: hasPanel ? '100%' : '90vw',
                maxHeight: '80vh',   // must match the container's maxHeight or tall videos get clipped
                borderRadius: 16,
                boxShadow: '0 24px 80px rgba(0,0,0,0.5), 0 2px 8px rgba(0,0,0,0.3)',
              }}
            />
          ) : (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={displayUrl}
                alt={viewingRef ? 'Reference image' : (current.label || `Image ${index + 1}`)}
                onClick={(e) => { e.stopPropagation(); setZoomed(true); }}
                title="Click to view full size"
                className="object-contain"
                style={{
                  maxWidth: hasPanel ? '100%' : '90vw',
                  maxHeight: hasPanel ? '90vh' : '90vh',
                  cursor: 'zoom-in',
                  borderRadius: 16,
                  boxShadow: '0 24px 80px rgba(0,0,0,0.5), 0 2px 8px rgba(0,0,0,0.3)',
                }}
              />
            </>
          )}
          {/* Full-size view: the image at its real pixel size in a scrollable layer above everything */}
          {zoomed && current.type !== 'video' && (
            <div
              onClick={(e) => { e.stopPropagation(); setZoomed(false); }}
              style={{ position: 'fixed', inset: 0, zIndex: 200, overflow: 'auto', background: 'rgba(0,0,0,0.92)', cursor: 'zoom-out', display: 'flex' }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={displayUrl} alt={current.label || `Image ${index + 1} at full size`} style={{ margin: 'auto', maxWidth: 'none', display: 'block' }} />
            </div>
          )}
          {/* Counter (only in legacy mode) */}
          {!hasPanel && images.length > 1 && (
            <div
              className="absolute px-4 py-1.5 rounded-full text-xs font-medium"
              style={{ bottom: 16, left: '50%', transform: 'translateX(-50%)', background: 'rgba(0,0,0,0.5)', color: 'rgba(255,255,255,0.7)', backdropFilter: 'blur(16px)', border: '1px solid rgba(255,255,255,0.1)', letterSpacing: '0.02em' }}
            >
              {index + 1} of {images.length}
            </div>
          )}
        </div>

        {/* Info Panel (only shown when generationMeta is provided) */}
        {hasPanel && (
          <div
            onClick={(e) => e.stopPropagation()}
            className="flex flex-col overflow-hidden"
            style={{
              width: 320, minWidth: 320,
              height: '95vh',
              background: '#FFFFFF',
              border: '1px solid rgba(0,0,0,0.06)',
              borderRadius: 16,
              boxShadow: '0 16px 64px rgba(0,0,0,0.25)',
            }}
          >
            {/* Close button inside panel */}
            <div className="flex justify-end" style={{ padding: '12px 12px 0 0' }}>
              <button
                onClick={onClose}
                className="w-8 h-8 rounded-full flex items-center justify-center transition-colors hover:bg-gray-100"
                style={{ background: 'none', border: 'none', color: '#999', cursor: 'pointer' }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            {/* Header: Persona */}
            <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' as const, color: '#999', padding: '4px 20px 8px' }}>Persona</div>
            <div className="flex items-center gap-3" style={{ padding: '0 20px 14px', borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
              {gm?.personaAvatar ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={gm.personaAvatar} alt="" className="rounded-full object-cover" style={{ width: 42, height: 42, border: '2px solid #F5F5F5' }} />
              ) : (
                <div className="rounded-full flex items-center justify-center" style={{ width: 42, height: 42, background: '#F5F5F5', color: '#999', fontSize: 16, fontWeight: 600 }}>
                  {(gm?.personaName || '?')[0]}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div style={{ fontSize: 14, fontWeight: 600, color: '#111' }}>{gm?.personaName || 'Unknown'}</div>
                <div style={{ fontSize: 12, color: '#999', marginTop: 2 }}>{gm?.genName || ''}</div>
              </div>
            </div>

            {/* Images: Ref → Output */}
            {(gm?.refImage || gm?.outputThumbnails) && (
              <>
                <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' as const, color: '#999', padding: '14px 20px 8px' }}>Images</div>
                <div className="flex items-end gap-2" style={{ padding: '4px 20px 14px', borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
                  {gm?.refImage && (
                    <div className="flex flex-col items-center gap-1">
                      <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase' as const, color: '#999' }}>Ref</span>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={gm.refImage}
                        alt="Reference"
                        className="object-cover cursor-pointer"
                        onClick={() => setViewingRef(true)}
                        style={{
                          width: 52, height: 68, borderRadius: 8,
                          border: viewingRef ? '1.5px solid #60A5FA' : '1.5px solid rgba(0,0,0,0.06)',
                          boxShadow: viewingRef ? '0 0 0 1px #60A5FA' : 'none',
                          transition: 'border-color 0.15s, box-shadow 0.15s',
                        }}
                      />
                    </div>
                  )}
                  {gm?.refImage && gm?.outputThumbnails && (
                    <div className="flex items-center self-center" style={{ width: 16, height: 1, background: 'rgba(0,0,0,0.15)', marginBottom: 8, flexShrink: 0 }} />
                  )}
                  {gm?.outputThumbnails && (
                    <div className="flex flex-col items-center gap-1">
                      <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase' as const, color: '#999' }}>Output</span>
                      <div className="flex gap-1">
                        {gm.outputThumbnails.slice(0, 3).map((thumb, ti) => {
                          const isActive = !viewingRef && ti === (index % (gm.outputThumbnails?.length || 1));
                          return (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              key={ti}
                              src={thumb}
                              alt={`Output ${ti + 1}`}
                              className="object-cover cursor-pointer"
                              onClick={() => setViewingRef(false)}
                              style={{
                                width: 52, height: 68, borderRadius: 8,
                                border: isActive ? '1.5px solid #60A5FA' : '1.5px solid rgba(0,0,0,0.06)',
                                boxShadow: isActive ? '0 0 0 1px #60A5FA' : 'none',
                                transition: 'border-color 0.15s, box-shadow 0.15s',
                              }}
                            />
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}

            {/* Scrollable content area: info rows + see all */}
            <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
              {/* Information rows */}
              <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' as const, color: '#999', padding: '14px 20px 8px' }}>Information</div>
              <div style={{ padding: '0 20px' }}>
                {meta?.score && (() => {
                  const s = meta.score.score;
                  const [fg, text, hint] = s == null ? ['#92400E', 'no face found', 'The scorer found no face in this image']
                    : s >= 0.6 ? ['#065F46', `${s.toFixed(2)} · same person`, 'ArcFace similarity to her dataset faces. 0.60 and up reads as the same person.']
                    : s >= 0.45 ? ['#92400E', `${s.toFixed(2)} · probably her`, '0.45 to 0.60: likely her, details drift.']
                    : ['#991B1B', `${s.toFixed(2)} · not her`, 'Under 0.45: a different face.'];
                  return (
                    <div className="flex items-center justify-between" style={{ padding: '11px 0', borderBottom: '1px solid rgba(0,0,0,0.06)' }} title={hint}>
                      <span style={{ fontSize: 13, color: '#999' }}>Face match</span>
                      <span style={{ fontSize: 13, fontWeight: 600, color: fg }}>{text}</span>
                    </div>
                  );
                })()}
                {gm?.feature && (
                  <div className="flex items-center justify-between" style={{ padding: '11px 0', borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
                    <span style={{ fontSize: 13, color: '#999' }}>Feature</span>
                    <span style={{ fontSize: 12, fontWeight: 600, padding: '3px 10px', borderRadius: 6, ...getFeatureBadgeStyle(gm.feature) }}>{gm.feature}</span>
                  </div>
                )}
                {gm?.model && (
                  <div className="flex items-center justify-between" style={{ padding: '11px 0', borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
                    <span style={{ fontSize: 13, color: '#999' }}>Model</span>
                    <span style={{ fontSize: 12, fontWeight: 600, padding: '3px 10px', borderRadius: 6, ...getModelBadgeStyle(gm.model) }}>{gm.model}</span>
                  </div>
                )}
                {gm?.quality && (
                  <div className="flex items-center justify-between" style={{ padding: '11px 0', borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
                    <span style={{ fontSize: 13, color: '#999' }}>Quality</span>
                    <span style={{ fontSize: 13, fontWeight: 500, color: '#111' }}>{gm.quality}</span>
                  </div>
                )}
                {gm?.aspectRatio && (
                  <div className="flex items-center justify-between" style={{ padding: '11px 0', borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
                    <span style={{ fontSize: 13, color: '#999' }}>Aspect Ratio</span>
                    <span style={{ fontSize: 13, fontWeight: 500, color: '#111' }}>{gm.aspectRatio}</span>
                  </div>
                )}
                {gm?.createdAt && (
                  <div className="flex items-center justify-between" style={{ padding: '11px 0' }}>
                    <span style={{ fontSize: 13, color: '#999' }}>Created</span>
                    <span style={{ fontSize: 13, fontWeight: 500, color: '#111' }}>{formatDate(gm.createdAt)}</span>
                  </div>
                )}
              </div>

              {/* See all expandable */}
              {(gm?.prompt || gm?.provider || gm?.resolution) && (
                <div style={{ borderTop: '1px solid rgba(0,0,0,0.06)' }}>
                  <button
                    className="w-full flex items-center justify-between transition-colors hover:bg-gray-50"
                    style={{ padding: '12px 20px', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 500, color: '#999', fontFamily: 'inherit' }}
                    onClick={() => setSeeAllOpen(!seeAllOpen)}
                  >
                    <span>See all</span>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#999" strokeWidth="2" strokeLinecap="round" style={{ transition: 'transform 0.25s', transform: seeAllOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}>
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </button>
                  <div style={{ maxHeight: seeAllOpen ? 400 : 0, overflow: 'hidden', transition: 'max-height 0.3s ease' }}>
                    <div style={{ padding: '0 20px 16px' }}>
                      {gm?.provider && (
                        <div className="flex items-center justify-between" style={{ padding: '8px 0', borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
                          <span style={{ fontSize: 12, color: '#999' }}>AI Provider</span>
                          <span style={{ fontSize: 12, color: '#555' }}>{gm.provider}</span>
                        </div>
                      )}
                      {gm?.resolution && (
                        <div className="flex items-center justify-between" style={{ padding: '8px 0', borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
                          <span style={{ fontSize: 12, color: '#999' }}>Resolution</span>
                          <span style={{ fontSize: 12, color: '#555' }}>{gm.resolution}</span>
                        </div>
                      )}
                      {gm?.duration !== undefined && (
                        <div className="flex items-center justify-between" style={{ padding: '8px 0', borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
                          <span style={{ fontSize: 12, color: '#999' }}>Duration</span>
                          <span style={{ fontSize: 12, color: '#555' }}>{gm.duration}s</span>
                        </div>
                      )}
                      {gm?.hasAudio !== undefined && (
                        <div className="flex items-center justify-between" style={{ padding: '8px 0', borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
                          <span style={{ fontSize: 12, color: '#999' }}>Audio</span>
                          <span style={{ fontSize: 12, color: gm.hasAudio ? '#16A34A' : '#999' }}>{gm.hasAudio ? 'Enabled' : 'Off'}</span>
                        </div>
                      )}
                      {gm?.cfgScale !== undefined && (
                        <div className="flex items-center justify-between" style={{ padding: '8px 0', borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
                          <span style={{ fontSize: 12, color: '#999' }}>CFG Scale</span>
                          <span style={{ fontSize: 12, color: '#555' }}>{gm.cfgScale}</span>
                        </div>
                      )}
                      {gm?.characterOrientation && (
                        <div className="flex items-center justify-between" style={{ padding: '8px 0', borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
                          <span style={{ fontSize: 12, color: '#999' }}>Orientation</span>
                          <span style={{ fontSize: 12, color: '#555' }}>{gm.characterOrientation === 'image' ? 'Image (preserves pose)' : 'Video (full motion)'}</span>
                        </div>
                      )}
                      {gm?.cameraFixed && (
                        <div className="flex items-center justify-between" style={{ padding: '8px 0', borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
                          <span style={{ fontSize: 12, color: '#999' }}>Camera</span>
                          <span style={{ fontSize: 12, color: '#555' }}>Fixed (tripod)</span>
                        </div>
                      )}
                      {gm?.seed !== undefined && gm.seed >= 0 && (
                        <div className="flex items-center justify-between" style={{ padding: '8px 0', borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
                          <span style={{ fontSize: 12, color: '#999' }}>Seed</span>
                          <span style={{ fontSize: 12, color: '#555', fontFamily: 'monospace' }}>{gm.seed}</span>
                        </div>
                      )}
                      {gm?.prompt && (
                        <div style={{ padding: '8px 0' }}>
                          <div style={{ fontSize: 12, color: '#999', marginBottom: 6 }}>Prompt</div>
                          <div style={{ fontSize: 12, lineHeight: 1.5, color: '#555', maxHeight: 120, overflowY: 'auto' }}>
                            {gm.prompt}
                          </div>
                        </div>
                      )}
                      {gm?.providerInput && (
                        <details style={{ padding: '8px 0' }}>
                          <summary style={{ fontSize: 12, color: '#999', cursor: 'pointer' }}>Sent to provider{typeof gm.providerInput.endpoint === 'string' ? ` · ${gm.providerInput.endpoint}` : ''}</summary>
                          <pre style={{ fontSize: 10, lineHeight: 1.4, color: '#555', maxHeight: 200, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all', margin: '6px 0 0', background: 'rgba(0,0,0,0.03)', padding: 6, borderRadius: 6 }}>
                            {JSON.stringify(Object.fromEntries(Object.entries(gm.providerInput).map(([k, v]) => [k, typeof v === 'string' && v.length > 120 ? v.slice(0, 120) + '…' : Array.isArray(v) ? v.map(x => typeof x === 'string' && x.length > 80 ? x.slice(0, 80) + '…' : x) : v])), null, 1)}
                          </pre>
                        </details>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Note */}
            {actions?.onNote && (
              <div style={{ padding: '10px 20px 12px', borderTop: '1px solid rgba(0,0,0,0.06)' }}>
                <label htmlFor="lightbox-note" style={{ display: 'block', fontSize: 12, color: '#999', marginBottom: 6 }}>Note</label>
                <textarea
                  id="lightbox-note"
                  key={`${index}:${meta?.note || ''}`}
                  defaultValue={meta?.note || ''}
                  rows={2}
                  placeholder="e.g. use for the next dataset"
                  onBlur={(e) => { if (e.target.value.trim() !== (meta?.note || '')) actions.onNote!(index, e.target.value); }}
                  style={{ width: '100%', boxSizing: 'border-box', fontSize: 12, lineHeight: 1.4, padding: '8px 10px', borderRadius: 8, border: '1px solid rgba(0,0,0,0.12)', background: '#fff', color: '#111', fontFamily: 'inherit', resize: 'vertical' }}
                />
                <div style={{ fontSize: 11, color: '#999', marginTop: 4 }}>Saves when you click away.</div>
              </div>
            )}

            {/* Action buttons */}
            <div style={{ padding: '16px 20px', marginTop: 'auto', borderTop: '1px solid rgba(0,0,0,0.06)', display: 'flex', flexDirection: 'column', gap: 10 }}>
              {/* Send to Remix + Send to Carousel — side by side */}
              {(actions?.onRemix || actions?.onCarouselImage) && (
                <div style={{ display: 'flex', gap: 8 }}>
                  {actions?.onRemix && (
                    <button
                      onClick={() => { actions.onRemix!(index); onClose(); }}
                      className="flex-1 flex items-center justify-center gap-2 transition-opacity hover:opacity-90 active:scale-[0.98]"
                      style={{ height: 42, borderRadius: 12, border: 'none', background: 'linear-gradient(135deg, #1D4ED8, #60A5FA)', color: 'white', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', letterSpacing: '0.01em' }}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="17 1 21 5 17 9" /><path d="M3 11V9a4 4 0 014-4h14" /><polyline points="7 23 3 19 7 15" /><path d="M21 13v2a4 4 0 01-4 4H3" /></svg>
                      {gm?.feature === 'Image Remix' ? 'Remix Again' : 'Remix'}
                    </button>
                  )}
                  {actions?.onCarouselImage && (
                    <button
                      onClick={() => { actions.onCarouselImage!(index); onClose(); }}
                      className="flex-1 flex items-center justify-center gap-2 transition-opacity hover:opacity-90 active:scale-[0.98]"
                      style={{ height: 42, borderRadius: 12, border: 'none', background: '#16A34A', color: 'white', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', letterSpacing: '0.01em' }}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="12" y="2" width="10" height="20" rx="2" ry="2" /><rect x="2" y="4" width="10" height="16" rx="2" ry="2" /></svg>
                      Carousel
                    </button>
                  )}
                </div>
              )}

              {/* Secondary row: Download, Star, More */}
              <div className="flex gap-2">
                {actions?.onDownload && (
                  <button
                    onClick={() => actions.onDownload!(index)}
                    className="flex-1 flex items-center justify-center gap-1.5 transition-colors hover:bg-gray-100"
                    style={{ height: 40, borderRadius: 12, border: '1px solid rgba(0,0,0,0.12)', background: '#FAFAFA', color: '#111', fontSize: 13, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit' }}
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#111" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
                    Download
                  </button>
                )}
                {actions?.onStar && (
                  <button
                    onClick={() => actions.onStar!(index)}
                    className="flex items-center justify-center"
                    style={{
                      width: 40, minWidth: 40, height: 40, borderRadius: 12, cursor: 'pointer',
                      border: meta?.starred ? '1px solid rgba(147,130,220,0.35)' : '1px solid rgba(0,0,0,0.12)',
                      background: meta?.starred ? 'linear-gradient(135deg, rgba(186,170,245,0.15), rgba(147,197,253,0.15))' : '#FAFAFA',
                      boxShadow: meta?.starred ? '0 0 8px rgba(167,139,250,0.2)' : 'none',
                      transition: 'all 0.2s ease',
                    }}
                    title={meta?.starred ? 'Unstar' : 'Add to Favorites'}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill={meta?.starred ? 'url(#starGrad)' : 'none'} stroke={meta?.starred ? 'url(#starGrad)' : '#111'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      {meta?.starred && (
                        <defs>
                          <linearGradient id="starGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                            <stop offset="0%" stopColor="#A78BFA" />
                            <stop offset="100%" stopColor="#60A5FA" />
                          </linearGradient>
                        </defs>
                      )}
                      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                    </svg>
                  </button>
                )}
                {/* More menu (three dots) */}
                <div ref={moreMenuRef} style={{ position: 'relative' }}>
                  <button
                    onClick={() => setMoreMenuOpen(!moreMenuOpen)}
                    className="flex items-center justify-center transition-colors hover:bg-gray-100"
                    style={{ width: 40, minWidth: 40, height: 40, borderRadius: 12, border: '1px solid rgba(0,0,0,0.12)', background: '#FAFAFA', color: '#111', cursor: 'pointer' }}
                    title="More options"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="1" /><circle cx="12" cy="5" r="1" /><circle cx="12" cy="19" r="1" /></svg>
                  </button>
                  {/* Popover menu */}
                  <div
                    style={{
                      position: 'absolute', bottom: 'calc(100% + 8px)', right: 0,
                      minWidth: 160, background: '#fff', border: '1px solid rgba(0,0,0,0.12)', borderRadius: 8,
                      boxShadow: '0 8px 24px rgba(0,0,0,0.12), 0 2px 6px rgba(0,0,0,0.06)',
                      padding: 4, opacity: moreMenuOpen ? 1 : 0, pointerEvents: moreMenuOpen ? 'auto' : 'none',
                      transform: moreMenuOpen ? 'translateY(0)' : 'translateY(4px)', transition: 'all 0.15s ease', zIndex: 20,
                    }}
                  >
                    {actions?.onUpscale && (
                      <button
                        onClick={() => { if (!meta?.upscaled) { setMoreMenuOpen(false); actions.onUpscale!(index); } }}
                        disabled={meta?.upscaled}
                        className="w-full flex items-center gap-2 transition-colors hover:bg-gray-50"
                        style={{ padding: '8px 12px', border: 'none', background: 'none', borderRadius: 6, cursor: meta?.upscaled ? 'default' : 'pointer', fontSize: 13, fontWeight: 500, color: meta?.upscaled ? '#999' : '#7C3AED', fontFamily: 'inherit', opacity: meta?.upscaled ? 0.6 : 1 }}
                      >
                        <svg width="15" height="15" viewBox="0 0 24 24" fill={meta?.upscaled ? '#A78BFA' : 'none'} stroke="#7C3AED" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l1.5 5.5L19 10l-5.5 1.5L12 17l-1.5-5.5L5 10l5.5-1.5L12 3z" /></svg>
                        {meta?.upscaled ? 'Upscaled' : 'Upscale to 4K'}
                      </button>
                    )}
                    {actions?.onDelete && (
                      <button
                        onClick={() => { setMoreMenuOpen(false); actions.onDelete!(index); }}
                        className="w-full flex items-center gap-2 transition-colors hover:bg-red-50"
                        style={{ padding: '8px 12px', border: 'none', background: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 500, color: '#DC2626', fontFamily: 'inherit' }}
                      >
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" /><line x1="10" y1="11" x2="10" y2="17" /><line x1="14" y1="11" x2="14" y2="17" /></svg>
                        Delete image
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Fallback: old-style action bar when no panel (legacy mode) */}
        {!hasPanel && actions && (actions.onStar || actions.onUpscale || actions.onRemix || actions.onDownload || actions.onDelete) && (
          <div
            className="absolute bottom-16 left-1/2 flex items-center gap-2 px-4 py-2.5 rounded-[20px]"
            style={{ transform: 'translateX(-50%)', background: 'rgba(255,255,255,0.95)', backdropFilter: 'blur(12px)', zIndex: 51, boxShadow: '0 4px 20px rgba(0,0,0,0.15)', border: '1px solid rgba(0,0,0,0.06)' }}
            onClick={(e) => e.stopPropagation()}
          >
            {actions.onStar && (
              <button onClick={() => actions.onStar!(index)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-[20px] text-xs font-medium" style={{ background: meta?.starred ? 'rgba(250,204,21,0.15)' : 'rgba(0,0,0,0.04)', color: meta?.starred ? '#d97706' : 'var(--color-text-secondary)' }} title={meta?.starred ? 'Unstar' : 'Star'}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill={meta?.starred ? '#facc15' : 'none'} stroke={meta?.starred ? '#facc15' : 'currentColor'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></svg>
                {meta?.starred ? 'Starred' : 'Star'}
              </button>
            )}
            {actions.onRemix && (
              <button onClick={() => { actions.onRemix!(index); onClose(); }} className="flex items-center gap-1.5 px-3 py-1.5 rounded-[20px] text-xs font-medium" style={{ background: 'rgba(0,0,0,0.04)', color: 'var(--color-text-secondary)' }} title="Send to Remix">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="17 1 21 5 17 9" /><path d="M3 11V9a4 4 0 014-4h14" /><polyline points="7 23 3 19 7 15" /><path d="M21 13v2a4 4 0 01-4 4H3" /></svg>
                Remix
              </button>
            )}
            {actions.onDownload && (
              <button onClick={() => actions.onDownload!(index)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-[20px] text-xs font-medium" style={{ background: 'rgba(0,0,0,0.04)', color: 'var(--color-text-secondary)' }} title="Download">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
                Download
              </button>
            )}
            {actions.onDelete && (
              <button onClick={() => actions.onDelete!(index)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-[20px] text-xs font-medium" style={{ background: 'var(--color-error-muted)', color: 'var(--color-error)' }} title="Delete">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" /></svg>
                Delete
              </button>
            )}
          </div>
        )}

      </div>
    </div>,
    document.body
  );
}
