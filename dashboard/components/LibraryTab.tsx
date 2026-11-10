'use client';

import { useState, useEffect } from 'react';
import ImageLightbox, { type LightboxImage, type GenerationMeta } from './ImageLightbox';

interface ApiImage {
  url: string;
  filename: string;
  width: number;
  height: number;
  thumbnails?: {
    small?: { url: string; width: number; height: number };
    large?: { url: string; width: number; height: number };
    full?: { url: string; width: number; height: number };
  };
}

interface Generation {
  id: string;
  name: string;
  prompt: string;
  enhancedPrompt?: string;
  persona: string;
  images: string[];
  fullImages: { url: string; thumbnail: string }[];
  status: string;
  createdAt: string;
  starred: boolean;
  source: 'generation' | 'remix' | 'carousel' | 'video';
  mediaType?: 'image' | 'video';
  imageModel?: string;
  provider?: string | null;
  providerInput?: Record<string, unknown> | null;
  refImage?: string | null;
  resolution?: string;
  hasUpscaled?: boolean;
  error?: string | null;
}

interface ApiGeneration {
  id: string;
  name: string;
  prompt: string;
  persona: string;
  imageModel: string;
  images: ApiImage[];
  upscaledImages?: ApiImage[];
  promptImage: string | null;
  provider: string | null;
  providerInput?: Record<string, unknown> | null;
  error: string | null;
  status: string;
  createdAt: string;
  starred: boolean;
}

interface ApiRemix {
  id: string;
  name: string;
  heroImage: string;
  imageModel: string;
  remixPrompt: string;
  enhancedPrompt?: string;
  persona: string;
  variants: ApiImage[];
  upscaledImages?: ApiImage[];
  provider: string | null;
  providerInput?: Record<string, unknown> | null;
  status: string;
  createdAt: string;
  starred: boolean;
}

interface ApiCarousel {
  id: string;
  name: string;
  persona: string;
  imageModel: string;
  carouselSetId: string;
  promptTemplateKey: string;
  prompt?: string;
  enhancedPrompt?: string;
  variants: ApiImage[];
  upscaledImages?: ApiImage[];
  provider: string | null;
  providerInput?: Record<string, unknown> | null;
  status: string;
  createdAt: string;
  starred: boolean;
}

interface LibraryTabProps {
  onRemixImage?: (imageUrl: string) => void;
  onSendToCarousel?: (imageUrl: string) => void;
}

/** Returns the vertical color bar color based on model name */
function getModelColor(model?: string): string {
  if (!model) return '#94A3B8'; // slate fallback
  const lower = model.toLowerCase();
  if (/\sv\d+$/.test(lower)) return '#16A34A'; // trained character ("Samantha v1")
  if (lower.includes('nano') || lower.includes('nanobanana')) return '#FACC15'; // yellow
  if (lower.includes('seedream') || lower.includes('sd ') || lower.includes('sd4')) return '#818CF8'; // purple
  return '#94A3B8';
}

/** Returns badge style for model */
function getModelBadgeStyle(model?: string): { background: string; color: string; label: string } {
  if (!model) return { background: '#F1F5F9', color: '#64748B', label: 'Unknown' };
  const lower = model.toLowerCase();
  if (/\sv\d+$/.test(lower)) return { background: '#D1FAE5', color: '#065F46', label: model };   // trained character, e.g. "Samantha v1"
  if (lower.includes('nano') || lower.includes('nanobanana')) return { background: '#FEF3C7', color: '#92400E', label: 'Nano' };
  if (lower.includes('seedream')) return { background: '#E0E7FF', color: '#3730A3', label: 'Seedream' };
  return { background: '#F1F5F9', color: '#64748B', label: model };
}

export default function LibraryTab({ onRemixImage, onSendToCarousel }: LibraryTabProps) {
  const [filterPersona, setFilterPersona] = useState('all');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  // Real aspect ratio of each output thumbnail, measured when it loads, so tiles are not cropped to 4:5.
  const [ratios, setRatios] = useState<Record<string, number>>({});
  const [generations, setGenerations] = useState<Generation[]>([]);
  const [personaList, setPersonaList] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<Set<string>>(new Set());
  const [deletingRecords, setDeletingRecords] = useState<Set<string>>(new Set());

  // Pagination state
  const [pageSize, setPageSize] = useState(20);
  const [currentPage, setCurrentPage] = useState(0);

  // Collapsible state
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  // Lightbox state
  const [lightbox, setLightbox] = useState<{ images: LightboxImage[]; index: number; sourceId?: string; sourceName?: string; starred?: boolean; source?: 'generation' | 'remix' | 'carousel' | 'video'; genMeta?: GenerationMeta } | null>(null);

  // Download handler — fetch as blob to bypass cross-origin restrictions
  async function handleDownload(imageUrl: string, filename: string) {
    try {
      const res = await fetch(imageUrl);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Download failed:', err);
    }
  }

  useEffect(() => {
    async function fetchData() {
      try {
        const [genRes, remixRes, carouselRes, videoRes, configRes] = await Promise.all([
          fetch('/api/generations?limit=1000'),
          fetch('/api/remix?limit=1000'),
          fetch('/api/carousel?limit=1000'),
          fetch('/api/video?limit=1000'),
          fetch('/api/config'),
        ]);

        const genData = await genRes.json();
        const remixData = await remixRes.json();
        const carouselData = await carouselRes.json();
        const videoData = await videoRes.json();
        const configData = await configRes.json();

        // Map generations — keep both thumbnail and full URL
        const genMapped: Generation[] = (genData.generations || []).map((g: ApiGeneration) => {
          const firstImg = g.images?.[0];
          return {
            id: g.id,
            name: g.name,
            prompt: g.prompt,
            persona: g.persona,
            images: (g.images || []).map((img: ApiImage) => img.thumbnails?.large?.url || img.url),
            fullImages: (g.images || []).map((img: ApiImage) => ({
              url: img.url,
              thumbnail: img.thumbnails?.large?.url || img.url,
            })),
            status: g.status,
            createdAt: g.createdAt,
            starred: g.starred || false,
            source: 'generation' as const,
            imageModel: g.imageModel || '',
            provider: g.provider || null,
            providerInput: g.providerInput || null,
            refImage: g.promptImage,
            resolution: firstImg?.width && firstImg?.height ? `${firstImg.width}x${firstImg.height}` : undefined,
            hasUpscaled: (g.upscaledImages || []).length > 0,
            error: g.error || null,
          };
        });

        // Map remixes into the same shape
        const remixMapped: Generation[] = (remixData.remixes || []).map((r: ApiRemix) => {
          const firstImg = r.variants?.[0];
          return {
            id: r.id,
            name: r.name || 'Remix',
            prompt: r.remixPrompt || '',
            enhancedPrompt: r.enhancedPrompt || '',
            persona: r.persona || 'Remix',
            images: (r.variants || []).map((img: ApiImage) => img.thumbnails?.large?.url || img.url),
            fullImages: (r.variants || []).map((img: ApiImage) => ({
              url: img.url,
              thumbnail: img.thumbnails?.large?.url || img.url,
            })),
            status: r.status,
            createdAt: r.createdAt,
            starred: r.starred || false,
            source: 'remix' as const,
            imageModel: r.imageModel || '',
            provider: r.provider || null,
            providerInput: r.providerInput || null,
            refImage: r.heroImage,
            resolution: firstImg?.width && firstImg?.height ? `${firstImg.width}x${firstImg.height}` : undefined,
            hasUpscaled: (r.upscaledImages || []).length > 0,
          };
        });

        // Map carousels into the same shape
        const carouselMapped: Generation[] = (carouselData.carousels || []).map((c: ApiCarousel) => {
          const firstImg = c.variants?.[0];
          return {
            id: c.id,
            name: c.name || 'Carousel',
            prompt: c.prompt || '',
            enhancedPrompt: c.enhancedPrompt || '',
            persona: c.persona || 'Carousel',
            images: (c.variants || []).map((img: ApiImage) => img.thumbnails?.large?.url || img.url),
            fullImages: (c.variants || []).map((img: ApiImage) => ({
              url: img.url,
              thumbnail: img.thumbnails?.large?.url || img.url,
            })),
            status: c.status || 'done',
            createdAt: c.createdAt,
            starred: c.starred || false,
            source: 'carousel' as const,
            imageModel: c.imageModel || '',
            provider: c.provider || null,
            providerInput: c.providerInput || null,
            refImage: null,
            resolution: firstImg?.width && firstImg?.height ? `${firstImg.width}x${firstImg.height}` : undefined,
            hasUpscaled: (c.upscaledImages || []).length > 0,
          };
        });

        // Map videos into the same shape
        interface VideoOutput { url: string; thumbnailUrl: string | null; hasAudio: boolean; durationSeconds: number | null; }
        interface ApiVideo { id: string; name: string; prompt: string | null; videoModel: string; duration: number; aspectRatio: string; resolution: string; generateAudio: boolean; status: string; createdAt: string; starred: boolean; provider: string | null; sourceImageUrl: string | null; outputs: VideoOutput[]; }
        const videoMapped: Generation[] = (videoData.videos || []).filter((v: ApiVideo) => v.status === 'done' && v.outputs?.length > 0).map((v: ApiVideo) => {
          const output = v.outputs[0];
          const thumb = output.thumbnailUrl ?? output.url;
          return {
            id: v.id,
            name: v.name || 'Video',
            prompt: v.prompt || '',
            persona: 'Video',
            images: [thumb],
            fullImages: [{ url: output.url, thumbnail: thumb }],
            status: v.status,
            createdAt: v.createdAt,
            starred: v.starred || false,
            source: 'video' as const,
            mediaType: 'video' as const,
            imageModel: v.videoModel || '',
            provider: v.provider || null,
            refImage: v.sourceImageUrl,
            resolution: v.resolution,
          };
        });

        // Merge and sort by date (newest first)
        const all = [...genMapped, ...remixMapped, ...carouselMapped, ...videoMapped].sort(
          (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );

        setGenerations(all);

        // Extract persona names from config
        const names: string[] = (configData.personas || []).map((p: { name: string }) => p.name);
        setPersonaList(names);
      } catch (err) {
        console.error('Failed to fetch library data:', err);
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, []);

  // Delete handler
  async function handleDeleteImage(genId: string, imageUrl: string, source?: 'generation' | 'remix' | 'carousel' | 'video') {
    setDeleting(prev => new Set(prev).add(imageUrl));
    try {
      let endpoint: string;
      if (source === 'video') {
        // Video uses a different delete pattern — DELETE the whole record
        const res = await fetch(`/api/video/${genId}`, { method: 'DELETE' });
        if (res.ok) {
          setGenerations(prev => prev.filter(g => g.id !== genId));
        }
        setDeleting(prev => { const n = new Set(prev); n.delete(imageUrl); return n; });
        return;
      } else if (source === 'carousel') {
        endpoint = `/api/carousel/${genId}/delete-image`;
      } else if (source === 'remix') {
        endpoint = `/api/remix/${genId}/delete-image`;
      } else {
        endpoint = `/api/generations/${genId}/delete-image`;
      }
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl }),
      });
      if (res.ok) {
        setGenerations(prev => prev.map(g =>
          g.id === genId
            ? {
                ...g,
                images: g.images.filter((_, idx) => g.fullImages[idx]?.url !== imageUrl),
                fullImages: g.fullImages.filter(fi => fi.url !== imageUrl),
              }
            : g
        ));
      }
    } catch (err) {
      console.error('Failed to delete image:', err);
    } finally {
      setDeleting(prev => { const next = new Set(prev); next.delete(imageUrl); return next; });
    }
  }

  async function handleDeleteRecord(genId: string, source?: 'generation' | 'remix' | 'carousel' | 'video') {
    setDeletingRecords(prev => new Set(prev).add(genId));
    try {
      let res: Response;
      if (source === 'video') {
        res = await fetch(`/api/video/${genId}`, { method: 'DELETE' });
      } else {
        let endpoint: string;
        if (source === 'carousel') {
          endpoint = `/api/carousel/${genId}/delete-image`;
        } else if (source === 'remix') {
          endpoint = `/api/remix/${genId}/delete-image`;
        } else {
          endpoint = `/api/generations/${genId}/delete-image`;
        }
        res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ deleteAll: true }),
        });
      }
      if (res.ok) {
        setGenerations(prev => prev.filter(g => g.id !== genId));
      }
    } catch (err) {
      console.error('Failed to delete record:', err);
    } finally {
      setDeletingRecords(prev => { const next = new Set(prev); next.delete(genId); return next; });
    }
  }

  async function handleToggleStar(genId: string, currentStarred: boolean, source: 'generation' | 'remix' | 'carousel' | 'video') {
    setGenerations(prev => prev.map(g =>
      g.id === genId ? { ...g, starred: !currentStarred } : g
    ));
    try {
      let endpoint: string;
      if (source === 'video') {
        endpoint = `/api/video/${genId}`;
      } else if (source === 'carousel') {
        endpoint = `/api/carousel/${genId}/star`;
      } else if (source === 'generation') {
        endpoint = `/api/generations/${genId}/star`;
      } else {
        endpoint = `/api/remix/${genId}/star`;
      }
      const res = await fetch(endpoint, { method: 'PATCH' });
      if (!res.ok) {
        setGenerations(prev => prev.map(g =>
          g.id === genId ? { ...g, starred: currentStarred } : g
        ));
      }
    } catch {
      setGenerations(prev => prev.map(g =>
        g.id === genId ? { ...g, starred: currentStarred } : g
      ));
    }
  }

  const filtered = filterPersona === 'all'
    ? generations
    : generations.filter(g => g.persona === filterPersona);

  // Pagination
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(currentPage, totalPages - 1);
  const paginatedItems = filtered.slice(safePage * pageSize, (safePage + 1) * pageSize);

  // Group paginated items by date — with "Today" logic
  const today = new Date();
  const todayStr = today.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  const grouped = paginatedItems.reduce((acc, item) => {
    const d = new Date(item.createdAt);
    const dateStr = d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    const isToday = d.toDateString() === today.toDateString();
    const label = isToday ? `Today — ${todayStr}` : dateStr;
    if (!acc[label]) acc[label] = [];
    acc[label].push(item);
    return acc;
  }, {} as Record<string, Generation[]>);

  // Toggle expand/collapse
  function toggleExpanded(id: string) {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Persona pills data
  const personaPills = [
    { value: 'all', label: 'All' },
    ...personaList.map(name => ({ value: name, label: name })),
  ];

  const pageSizePills = [20, 50, 100];

  return (
    <div className="space-y-6 fade-in">
      {/* Filter Bar */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Persona filter pills */}
        {personaPills.map(pill => {
          const isActive = filterPersona === pill.value;
          return (
            <button
              key={pill.value}
              onClick={() => { setFilterPersona(pill.value); setCurrentPage(0); }}
              style={{
                background: isActive ? '#DBEAFE' : '#ffffff',
                color: isActive ? '#1E40AF' : '#666666',
                border: isActive ? '1px solid #DBEAFE' : '1px solid #E5E7EB',
                borderRadius: '20px',
                padding: '5px 14px',
                fontSize: '12px',
                fontWeight: isActive ? 600 : 400,
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
            >
              {pill.label}
            </button>
          );
        })}

        {/* Spacer */}
        <div style={{ flex: 1 }} />

        {/* Page size pills */}
        {pageSizePills.map(size => {
          const isActive = pageSize === size;
          return (
            <button
              key={size}
              onClick={() => { setPageSize(size); setCurrentPage(0); }}
              style={{
                background: isActive ? '#DBEAFE' : '#ffffff',
                color: isActive ? '#1E40AF' : '#666666',
                border: isActive ? '1px solid #DBEAFE' : '1px solid #E5E7EB',
                borderRadius: '20px',
                padding: '5px 12px',
                fontSize: '12px',
                fontWeight: isActive ? 600 : 400,
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
            >
              {size}
            </button>
          );
        })}

        {/* View mode toggle (hidden but preserved) */}
        <div className="flex rounded-lg overflow-hidden border" style={{ borderColor: 'var(--color-border)', marginLeft: '4px' }}>
          <button onClick={() => setViewMode('grid')} className="p-1.5 transition-colors" style={{ background: viewMode === 'grid' ? 'var(--color-bg-tertiary)' : 'var(--color-bg-card)' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={viewMode === 'grid' ? 'var(--color-text-primary)' : 'var(--color-text-tertiary)'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" />
            </svg>
          </button>
          <button onClick={() => setViewMode('list')} className="p-1.5 transition-colors" style={{ background: viewMode === 'list' ? 'var(--color-bg-tertiary)' : 'var(--color-bg-card)' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={viewMode === 'list' ? 'var(--color-text-primary)' : 'var(--color-text-tertiary)'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" /><line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" />
            </svg>
          </button>
        </div>
      </div>

      {/* Loading Skeletons */}
      {loading && (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="rounded-xl border p-4" style={{ background: 'var(--color-bg-card)', borderColor: 'var(--color-border)' }}>
              <div className="flex items-center gap-3 mb-3">
                <div className="skeleton rounded-md" style={{ width: 80, height: 16 }} />
                <div className="skeleton rounded-md" style={{ width: 60, height: 16 }} />
              </div>
              <div className="skeleton rounded-md mb-3" style={{ width: '60%', height: 12 }} />
              <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-2">
                {[1, 2, 3, 4].map((j) => (
                  <div key={j} className="skeleton rounded-lg" style={{ aspectRatio: '4/5' }} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Grouped Content */}
      {!loading && Object.entries(grouped).map(([date, items]) => (
        <div key={date}>
          {/* Date header */}
          <div style={{
            fontSize: '11px',
            fontWeight: 600,
            textTransform: 'uppercase' as const,
            letterSpacing: '1px',
            color: '#999999',
            paddingBottom: '8px',
            marginBottom: '12px',
            borderBottom: '1px solid var(--color-border)',
          }}>
            {date}
          </div>

          {viewMode === 'grid' ? (
            <div className="space-y-2.5">
              {items.map((item) => {
                const isExpanded = expandedIds.has(item.id);
                const modelColor = getModelColor(item.imageModel);
                const modelBadge = getModelBadgeStyle(item.imageModel);

                return (
                  <div
                    key={item.id}
                    className="overflow-hidden transition-all duration-200"
                    style={{
                      display: 'flex',
                      border: '1px solid var(--color-border)',
                      borderRadius: '12px',
                      background: '#ffffff',
                      marginBottom: '10px',
                    }}
                  >
                    {/* Vertical color line */}
                    <div style={{
                      width: '4px',
                      flexShrink: 0,
                      background: modelColor,
                      borderRadius: '12px 0 0 12px',
                    }} />

                    {/* Card content */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      {/* Clickable header */}
                      <div
                        onClick={() => toggleExpanded(item.id)}
                        className="w-full flex items-center justify-between transition-colors duration-150 hover:opacity-80 cursor-pointer"
                        style={{ padding: '10px 14px' }}
                      >
                        <div className="flex items-center gap-2.5 min-w-0" style={{ flex: 1 }}>
                          <div className="flex flex-col gap-1.5 min-w-0">
                            {/* Generation name */}
                            <span style={{
                              fontSize: '13px',
                              fontWeight: 600,
                              color: 'var(--color-text-primary)',
                              fontFamily: 'var(--font-display)',
                            }} className="truncate">{item.name}</span>

                            {/* Badges row */}
                            <div className="flex items-center gap-1.5 flex-wrap">
                              {/* Persona badge */}
                              <span style={{
                                fontSize: '9px',
                                fontWeight: 600,
                                padding: '2px 8px',
                                borderRadius: '10px',
                                background: '#DBEAFE',
                                color: '#1E40AF',
                              }}>{item.persona}</span>

                              {/* Model badge */}
                              {item.imageModel && (
                                <span style={{
                                  fontSize: '9px',
                                  fontWeight: 600,
                                  padding: '2px 8px',
                                  borderRadius: '10px',
                                  background: modelBadge.background,
                                  color: modelBadge.color,
                                }}>{modelBadge.label}</span>
                              )}

                              {/* Image count badge */}
                              <span style={{
                                fontSize: '9px',
                                fontWeight: 600,
                                padding: '2px 8px',
                                borderRadius: '10px',
                                background: '#D1FAE5',
                                color: '#065F46',
                              }}>{item.images.length} img</span>

                              {/* 4K badge */}
                              {item.hasUpscaled && (
                                <span style={{
                                  fontSize: '9px',
                                  fontWeight: 600,
                                  padding: '2px 8px',
                                  borderRadius: '10px',
                                  background: '#EDE9FE',
                                  color: '#5B21B6',
                                }}>4K</span>
                              )}

                              {/* Remix badge */}
                              {item.source === 'remix' && (
                                <span style={{
                                  fontSize: '9px',
                                  fontWeight: 600,
                                  padding: '2px 8px',
                                  borderRadius: '10px',
                                  background: '#DBEAFE',
                                  color: '#1E40AF',
                                }}>Remix</span>
                              )}

                              {item.source === 'carousel' && (
                                <span style={{
                                  fontSize: '9px',
                                  fontWeight: 600,
                                  padding: '2px 8px',
                                  borderRadius: '10px',
                                  background: '#FEE2E2',
                                  color: '#991B1B',
                                }}>Carousel</span>
                              )}
                            </div>

                            {item.error && (
                              <p className="text-xs mt-0.5 leading-snug" style={{ color: '#ef4444' }}>
                                {item.error}
                              </p>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-3 flex-shrink-0">
                          {/* Delete record button */}
                          <button
                            onClick={(e) => { e.stopPropagation(); handleDeleteRecord(item.id, item.source); }}
                            className="p-1.5 rounded-md transition-colors hover:bg-red-500/10"
                            style={{ color: 'var(--color-text-tertiary)' }}
                            title="Delete record"
                            disabled={deletingRecords.has(item.id)}
                          >
                            {deletingRecords.has(item.id) ? (
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="animate-spin"><circle cx="12" cy="12" r="10" strokeDasharray="32" strokeDashoffset="12" /></svg>
                            ) : (
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="hover:stroke-red-400"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" /></svg>
                            )}
                          </button>
                          {/* Timestamp */}
                          <span style={{ fontSize: '10px', color: '#cccccc' }}>
                            {new Date(item.createdAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                          </span>
                          {/* Chevron */}
                          <svg
                            width="12"
                            height="12"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="var(--color-text-tertiary)"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            style={{
                              transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
                              transition: 'transform 0.2s ease',
                            }}
                          >
                            <polyline points="9 6 15 12 9 18" />
                          </svg>
                        </div>
                      </div>

                      {/* Expanded content */}
                      {isExpanded && (
                        <div style={{ padding: '0 14px 14px', borderTop: '1px solid var(--color-border)' }}>
                          {/* Prompt text */}
                          <p
                            className="line-clamp-2 cursor-pointer"
                            style={{ fontSize: '11px', color: '#666666', lineHeight: 1.5, marginTop: '10px', marginBottom: '8px' }}
                            title="Click to expand"
                            onClick={(e) => { e.currentTarget.classList.toggle('line-clamp-2'); }}
                          >
                            <span className="font-medium" style={{ color: 'var(--color-accent)' }}>{item.source === 'remix' ? 'You asked' : 'Prompt'} — </span>{item.prompt}
                          </p>
                          {item.source === 'remix' && item.enhancedPrompt && (
                            <p
                              className="line-clamp-3 cursor-pointer"
                              style={{ fontSize: '11px', color: '#666666', lineHeight: 1.5, marginBottom: '10px' }}
                              title="Click to expand"
                              onClick={(e) => { e.currentTarget.classList.toggle('line-clamp-3'); }}
                            >
                              <span className="font-medium" style={{ color: '#3b82f6' }}>AI prompt — </span>{item.enhancedPrompt}
                            </p>
                          )}

                          <div className="flex gap-0">
                            {/* Reference image — left side */}
                            {item.refImage && (
                              <>
                                <div className="flex flex-col items-center gap-1.5 flex-shrink-0 pr-4">
                                  <span className="text-[9px] font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-tertiary)' }}>
                                    {item.source === 'remix' ? 'Hero' : 'Ref'}
                                  </span>
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img
                                    src={item.refImage}
                                    alt={item.source === 'remix' ? 'Hero image' : 'Reference image'}
                                    className="rounded-lg object-cover cursor-pointer hover:opacity-80 transition-opacity"
                                    style={{ width: '100px', height: '125px', border: '1px solid var(--color-border)' }}
                                    onClick={() => setLightbox({
                                      images: [{ url: item.refImage!, label: item.source === 'remix' ? 'Hero Image' : 'Reference Image' }],
                                      index: 0,
                                      sourceId: item.id,
                                      sourceName: item.name,
                                      starred: item.starred,
                                      source: item.source,
                                    })}
                                  />
                                </div>
                                {/* Vertical divider */}
                                <div className="flex-shrink-0 w-px self-stretch" style={{ background: 'var(--color-border)' }} />
                              </>
                            )}

                            {/* Output images — 4 column grid */}
                            <div className={`flex-1 min-w-0 grid grid-cols-4 gap-2 ${item.refImage ? 'pl-4' : ''}`}>
                            {item.images.map((img, i) => {
                              const fullUrl = item.fullImages[i]?.url || img;
                              return (
                                <div
                                  key={i}
                                  className={`image-card relative rounded-lg overflow-hidden cursor-pointer group ${deleting.has(fullUrl) ? 'opacity-40' : ''}`}
                                  style={{ aspectRatio: String(Math.min(Math.max(ratios[img] || 0.8, 0.5), 1.8)), alignSelf: 'start' }}
                                  onClick={() => setLightbox({
                                    images: item.fullImages.map((fi, idx) => ({ url: fi.url, label: `${item.name} #${idx + 1}` })),
                                    index: i,
                                    sourceId: item.id,
                                    sourceName: item.name,
                                    starred: item.starred,
                                    source: item.source,
                                  })}
                                >
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img
                                    src={img}
                                    alt={`${item.name} ${i + 1}`}
                                    onLoad={(e) => { const el = e.currentTarget; if (el.naturalWidth && !ratios[img]) setRatios(r => ({ ...r, [img]: el.naturalWidth / el.naturalHeight })); }}
                                    className="w-full h-full object-cover"
                                  />
                                  {/* Star — top left */}
                                  <button
                                    onClick={(e) => { e.stopPropagation(); handleToggleStar(item.id, item.starred, item.source); }}
                                    className="absolute top-2 left-2 w-7 h-7 rounded-md flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-10"
                                    style={{ background: item.starred ? 'rgba(250,204,21,0.3)' : 'rgba(0,0,0,0.5)' }}
                                    title={item.starred ? 'Unstar' : 'Star'}
                                  >
                                    <svg width="13" height="13" viewBox="0 0 24 24" fill={item.starred ? '#facc15' : 'none'} stroke={item.starred ? '#facc15' : 'white'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                                    </svg>
                                  </button>
                                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-all duration-200 flex items-end justify-center pb-2">
                                    <div className="opacity-0 group-hover:opacity-100 transition-opacity flex gap-1">
                                      <button
                                        onClick={(e) => { e.stopPropagation(); onRemixImage?.(fullUrl); }}
                                        className="py-1 px-2 rounded text-[10px] font-medium backdrop-blur-sm"
                                        style={{ background: 'rgba(255,255,255,0.15)', color: 'white' }}
                                      >Remix</button>
                                      <button
                                        onClick={(e) => { e.stopPropagation(); handleDownload(fullUrl, `${(item.persona || item.name || 'image').toLowerCase().replace(/[^a-z0-9]+/g, '-')}_${(item.createdAt || '').slice(0, 10).replace(/-/g, '')}_${item.id.slice(0, 8)}_${i + 1}.jpg`); }}
                                        className="py-1 px-1.5 rounded text-[10px] font-medium backdrop-blur-sm"
                                        style={{ background: 'rgba(255,255,255,0.15)', color: 'white' }}
                                        title="Download"
                                      >
                                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
                                      </button>
                                      <button
                                        onClick={(e) => { e.stopPropagation(); handleDeleteImage(item.id, fullUrl, item.source); }}
                                        className="py-1 px-1.5 rounded text-[10px] font-medium backdrop-blur-sm"
                                        style={{ background: 'rgba(220,53,69,0.4)', color: 'white' }}
                                        title="Delete"
                                      >
                                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" /></svg>
                                      </button>
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="space-y-2">
              {items.map((item) => {
                const modelColor = getModelColor(item.imageModel);
                return (
                  <div
                    key={item.id}
                    className="flex items-center gap-4 cursor-pointer transition-colors hover:border-opacity-50"
                    style={{
                      background: '#ffffff',
                      border: '1px solid var(--color-border)',
                      borderRadius: '12px',
                      overflow: 'hidden',
                    }}
                    onClick={() => {
                      if (item.fullImages.length > 0) {
                        setLightbox({
                          images: item.fullImages.map((fi, idx) => ({ url: fi.url, label: `${item.name} #${idx + 1}` })),
                          index: 0,
                          sourceId: item.id,
                          sourceName: item.name,
                          starred: item.starred,
                          source: item.source,
                        });
                      }
                    }}
                  >
                    {/* Vertical color line */}
                    <div style={{ width: '4px', alignSelf: 'stretch', background: modelColor, flexShrink: 0 }} />

                    <div className="flex items-center gap-4 flex-1 min-w-0 p-3">
                      {/* Ref image or thumbnails */}
                      {item.refImage ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={item.refImage} alt="Ref" className="w-10 h-12 rounded-md object-cover border flex-shrink-0" style={{ borderColor: 'var(--color-border)' }} />
                      ) : (
                        <div className="flex gap-1.5 flex-shrink-0">
                          {item.images.slice(0, 3).map((img, i) => (
                            <div key={i} className="w-10 h-12 rounded-md overflow-hidden">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={img} alt="" className="w-full h-full object-cover" />
                            </div>
                          ))}
                          {item.images.length > 3 && (
                            <div className="w-10 h-12 rounded-md flex items-center justify-center text-xs" style={{ background: 'var(--color-bg-tertiary)', color: 'var(--color-text-tertiary)' }}>
                              +{item.images.length - 3}
                            </div>
                          )}
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>{item.name}</span>
                          <span style={{ fontSize: '9px', fontWeight: 600, padding: '2px 8px', borderRadius: '10px', background: '#DBEAFE', color: '#1E40AF' }}>{item.persona}</span>
                          {item.imageModel && (
                            <span style={{ fontSize: '9px', fontWeight: 600, padding: '2px 8px', borderRadius: '10px', background: getModelBadgeStyle(item.imageModel).background, color: getModelBadgeStyle(item.imageModel).color }}>{getModelBadgeStyle(item.imageModel).label}</span>
                          )}
                          {item.source === 'remix' && <span style={{ fontSize: '9px', fontWeight: 600, padding: '2px 8px', borderRadius: '10px', background: '#DBEAFE', color: '#1E40AF' }}>Remix</span>}
                          {item.source === 'carousel' && <span style={{ fontSize: '9px', fontWeight: 600, padding: '2px 8px', borderRadius: '10px', background: '#FEE2E2', color: '#991B1B' }}>Carousel</span>}
                        </div>
                        <p className="text-xs truncate" style={{ color: 'var(--color-text-tertiary)' }}>{item.prompt}</p>
                        {item.error && (
                          <p className="text-xs mt-1 leading-snug" style={{ color: '#ef4444' }}>
                            {item.error}
                          </p>
                        )}
                      </div>
                      <span style={{ fontSize: '9px', fontWeight: 600, padding: '2px 8px', borderRadius: '10px', background: '#D1FAE5', color: '#065F46', flexShrink: 0 }}>{item.images.length} img</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ))}

      {/* Pagination */}
      {!loading && totalPages > 1 && (
        <div className="flex items-center justify-between pt-2">
          <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
            Showing {safePage * pageSize + 1}–{Math.min((safePage + 1) * pageSize, filtered.length)} of {filtered.length}
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setCurrentPage(p => Math.max(0, p - 1))}
              disabled={safePage === 0}
              className="px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              style={{ background: 'var(--color-bg-card)', borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}
            >
              Prev
            </button>
            {Array.from({ length: totalPages }, (_, i) => (
              <button
                key={i}
                onClick={() => setCurrentPage(i)}
                className="w-8 h-8 rounded-lg text-xs font-medium transition-colors"
                style={{
                  background: i === safePage ? 'var(--color-accent)' : 'var(--color-bg-card)',
                  color: i === safePage ? '#fff' : 'var(--color-text-tertiary)',
                  border: i === safePage ? 'none' : '1px solid var(--color-border)',
                }}
              >
                {i + 1}
              </button>
            ))}
            <button
              onClick={() => setCurrentPage(p => Math.min(totalPages - 1, p + 1))}
              disabled={safePage >= totalPages - 1}
              className="px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              style={{ background: 'var(--color-bg-card)', borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}
            >
              Next
            </button>
          </div>
        </div>
      )}

      {/* Empty state */}
      {!loading && generations.length === 0 && (
        <div className="text-center py-12" style={{ color: 'var(--color-text-tertiary)' }}>
          <p className="text-sm">No generations found</p>
        </div>
      )}

      {/* Lightbox */}
      {lightbox && (() => {
        const item = generations.find(g => g.id === lightbox.sourceId);
        const genMeta: GenerationMeta | undefined = item ? {
          personaName: item.persona,
          genName: item.name,
          feature: item.source === 'carousel' ? 'Image Carousel' : item.source === 'remix' ? 'Image Remix' : 'Image Copy',
          model: item.imageModel || undefined,
          quality: item.imageModel?.toLowerCase().includes('nanobanana') ? '4K' : '2K',
          createdAt: item.createdAt,
          prompt: item.prompt,
          provider: item.provider || undefined,
          providerInput: item.providerInput || null,
          resolution: item.resolution || undefined,
          refImage: item.refImage || undefined,
          outputThumbnails: item.images,
        } : undefined;
        return (
          <ImageLightbox
            images={lightbox.images}
            initialIndex={lightbox.index}
            onClose={() => setLightbox(null)}
            generationMeta={genMeta}
            actions={{
              onStar: () => { if (lightbox.sourceId) { handleToggleStar(lightbox.sourceId, lightbox.starred || false, lightbox.source || 'generation'); setLightbox(prev => prev ? { ...prev, starred: !prev.starred } : null); } },
              onRemix: onRemixImage ? (i) => { const url = lightbox.images[i]?.url; if (url) onRemixImage(url); } : undefined,
              onCarouselImage: onSendToCarousel ? (i) => { const url = lightbox.images[i]?.url; if (url) onSendToCarousel(url); } : undefined,
              onDownload: (i) => { const url = lightbox.images[i]?.url; if (url) handleDownload(url, `${(lightbox.sourceName || 'image').toLowerCase().replace(/[^a-z0-9]+/g, '-')}_${(lightbox.sourceId || 'x').slice(0, 8)}_${i + 1}.jpg`); },
              onDelete: (i) => { const url = lightbox.images[i]?.url; if (url && lightbox.sourceId) { handleDeleteImage(lightbox.sourceId, url, lightbox.source); setLightbox(null); } },
            }}
            imageMeta={lightbox.sourceId ? lightbox.images.map(() => ({ starred: lightbox.starred })) : undefined}
          />
        );
      })()}
    </div>
  );
}
