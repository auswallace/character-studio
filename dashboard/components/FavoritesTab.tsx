'use client';

import { useState, useEffect } from 'react';
import { Download, Maximize2, Trash2 } from 'lucide-react';
import ImageLightbox, { type LightboxImage, type GenerationMeta } from './ImageLightbox';

// ─── Types ────────────────────────────────────────────────

interface ApiImage {
  url: string;
  filename: string;
  width: number;
  height: number;
  thumbnails?: {
    small?: { url: string };
    large?: { url: string };
    full?: { url: string };
  };
}

interface ApiGeneration {
  id: string;
  name: string;
  persona: string;
  imageModel: string;
  images: ApiImage[];
  upscaledImages?: ApiImage[];
  createdAt: string;
  starred: boolean;
}

interface ApiRemix {
  id: string;
  name: string;
  persona: string;
  imageModel: string;
  variants: ApiImage[];
  upscaledImages?: ApiImage[];
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
  variants: ApiImage[];
  upscaledImages?: ApiImage[];
  createdAt: string;
  starred: boolean;
}

interface FlatImage {
  url: string;
  upscaledUrl?: string;
  thumbnail: string;
  filename: string;
  persona: string;
  model: string;
  genName: string;
  recordId: string;
  imageIndex: number;
  source: 'generation' | 'remix' | 'carousel';
  starred: boolean;
  createdAt: string;
}

interface FavoritesTabProps {
  onRemixImage?: (url: string) => void;
  onSendToCarousel?: (url: string) => void;
}

// ─── Component ────────────────────────────────────────────

export default function FavoritesTab({ onRemixImage, onSendToCarousel }: FavoritesTabProps) {
  const [images, setImages] = useState<FlatImage[]>([]);
  const [loading, setLoading] = useState(true);

  // Persona config (for avatar in lightbox)
  const [personaConfigs, setPersonaConfigs] = useState<{ name: string; faceRefs?: string[] }[]>([]);

  // Filters
  const [filterModel, setFilterModel] = useState('all');
  const [filterPersona, setFilterPersona] = useState('all');
  const [personaList, setPersonaList] = useState<string[]>([]);
  const [modelList, setModelList] = useState<string[]>([]);

  // Pagination
  const [pageSize, setPageSize] = useState(20);
  const [currentPage, setCurrentPage] = useState(0);

  // Lightbox
  const [lightbox, setLightbox] = useState<{ images: LightboxImage[]; index: number; sourceImages?: FlatImage[] } | null>(null);

  // Grid columns slider
  const [gridColumns, setGridColumns] = useState(5);

  // Deleting
  const [deleting, setDeleting] = useState<Set<string>>(new Set());

  // ─── Fetch + flatten (starred only) ─────────────────────

  useEffect(() => {
    async function fetchData() {
      try {
        const [genRes, remixRes, carouselRes, configRes] = await Promise.all([
          fetch('/api/generations?limit=1000'),
          fetch('/api/remix?limit=1000'),
          fetch('/api/carousel?limit=1000'),
          fetch('/api/config'),
        ]);

        const genData = await genRes.json();
        const remixData = await remixRes.json();
        const carouselData = await carouselRes.json();
        const configData = await configRes.json();

        // Flatten generation images
        const genImages: FlatImage[] = (genData.generations || []).flatMap((g: ApiGeneration) =>
          (g.images || []).map((img: ApiImage, idx: number) => ({
            url: img.url,
            upscaledUrl: g.upscaledImages?.find((u: ApiImage) => u.filename?.includes(`idx${idx}`) || u.filename === `upscaled_${idx + 1}.png`)?.url || undefined,
            thumbnail: img.thumbnails?.large?.url || img.url,
            filename: img.filename,
            persona: g.persona,
            model: g.imageModel || '',
            genName: g.name,
            recordId: g.id,
            imageIndex: idx,
            source: 'generation' as const,
            starred: g.starred || false,
            createdAt: g.createdAt || '',
          }))
        );

        // Flatten remix images
        const remixImages: FlatImage[] = (remixData.remixes || []).flatMap((r: ApiRemix) =>
          (r.variants || []).map((img: ApiImage, idx: number) => ({
            url: img.url,
            upscaledUrl: r.upscaledImages?.find((u: ApiImage) => u.filename?.includes(`idx${idx}`) || u.filename === `upscaled_${idx + 1}.png`)?.url || undefined,
            thumbnail: img.thumbnails?.large?.url || img.url,
            filename: img.filename,
            persona: r.persona,
            model: r.imageModel || '',
            genName: r.name,
            recordId: r.id,
            imageIndex: idx,
            source: 'remix' as const,
            starred: r.starred || false,
            createdAt: r.createdAt || '',
          }))
        );

        // Flatten carousel images
        const carouselImages: FlatImage[] = (carouselData.carousels || []).flatMap((c: ApiCarousel) =>
          (c.variants || []).map((img: ApiImage, idx: number) => ({
            url: img.url,
            upscaledUrl: c.upscaledImages?.find((u: ApiImage) => u.filename?.includes(`idx${idx}`) || u.filename === `upscaled_${idx + 1}.png`)?.url || undefined,
            thumbnail: img.thumbnails?.large?.url || img.url,
            filename: img.filename,
            persona: c.persona,
            model: c.imageModel || '',
            genName: c.name,
            recordId: c.id,
            imageIndex: idx,
            source: 'carousel' as const,
            starred: c.starred || false,
            createdAt: c.createdAt || '',
          }))
        );

        // Filter to starred only, sort by creation date (newest first)
        const all = [...genImages, ...remixImages, ...carouselImages]
          .filter(img => img.starred)
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        setImages(all);

        // Extract unique models from starred images
        const models = [...new Set(all.map(i => i.model).filter(Boolean))].sort();
        setModelList(models);

        // Persona list from config (store full configs for avatar lookup)
        const personas = configData.personas || [];
        const names: string[] = personas.map((p: { name: string }) => p.name);
        setPersonaList(names);
        setPersonaConfigs(personas);
      } catch (err) {
        console.error('[FavoritesTab] Failed to fetch:', err);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  // ─── Derived data ─────────────────────────────────────

  const filtered = images.filter(img => {
    if (filterModel !== 'all' && img.model !== filterModel) return false;
    if (filterPersona !== 'all' && img.persona !== filterPersona) return false;
    return true;
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(currentPage, totalPages - 1);
  const pageImages = filtered.slice(safePage * pageSize, (safePage + 1) * pageSize);

  // Reset page on filter/size change
  function changeFilter(setter: (v: string) => void, value: string) {
    setter(value);
    setCurrentPage(0);
  }
  function changePageSize(size: number) {
    setPageSize(size);
    setCurrentPage(0);
  }

  // ─── Download handler ─────────────────────────────────

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

  // ─── Delete handler ─────────────────────────────────

  async function handleDelete(img: FlatImage) {
    setDeleting(prev => new Set(prev).add(img.url));
    try {
      let endpoint: string;
      if (img.source === 'carousel') {
        endpoint = `/api/carousel/${img.recordId}/delete-image`;
      } else if (img.source === 'generation') {
        endpoint = `/api/generations/${img.recordId}/delete-image`;
      } else {
        endpoint = `/api/remix/${img.recordId}/delete-image`;
      }
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl: img.url }),
      });
      if (res.ok) {
        setImages(prev => prev.filter(i => i.url !== img.url));
      }
    } catch (err) {
      console.error('Delete failed:', err);
    } finally {
      setDeleting(prev => { const next = new Set(prev); next.delete(img.url); return next; });
    }
  }

  // ─── Star handler (unstar removes from grid) ──────────

  async function handleToggleStar(img: FlatImage) {
    // Optimistically remove all images from this record
    setImages(prev => prev.filter(i => i.recordId !== img.recordId));
    try {
      let endpoint: string;
      if (img.source === 'carousel') {
        endpoint = `/api/carousel/${img.recordId}/star`;
      } else if (img.source === 'generation') {
        endpoint = `/api/generations/${img.recordId}/star`;
      } else {
        endpoint = `/api/remix/${img.recordId}/star`;
      }
      const res = await fetch(endpoint, { method: 'PATCH' });
      if (!res.ok) {
        console.error('Failed to unstar');
      }
    } catch {
      console.error('Failed to unstar');
    }
  }

  // ─── Upscale handler ──────────────────────────────────

  const [upscaling, setUpscaling] = useState<Set<string>>(new Set());

  async function handleUpscale(img: FlatImage) {
    if (img.upscaledUrl) return;
    const key = `${img.recordId}-${img.imageIndex}`;
    setUpscaling(prev => new Set(prev).add(key));
    try {
      let endpoint: string;
      if (img.source === 'carousel') {
        endpoint = `/api/carousel/${img.recordId}/upscale`;
      } else if (img.source === 'generation') {
        endpoint = `/api/generations/${img.recordId}/upscale`;
      } else {
        endpoint = `/api/remix/${img.recordId}/upscale`;
      }
      await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageIndex: img.imageIndex }),
      });
    } catch {
      setUpscaling(prev => { const s = new Set(prev); s.delete(key); return s; });
    }
  }

  // ─── Loading skeleton ─────────────────────────────────

  if (loading) {
    return (
      <div className="space-y-6 fade-in">
        <div className="flex items-center gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="skeleton rounded-lg h-8 w-28" />
          ))}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${gridColumns}, 1fr)`, gap: 8 }}>
          {Array.from({ length: 16 }).map((_, i) => (
            <div key={i} className="skeleton rounded-xl" style={{ aspectRatio: '4/5' }} />
          ))}
        </div>
      </div>
    );
  }

  // ─── Render ───────────────────────────────────────────

  return (
    <div className="space-y-6 fade-in">
      {/* ── Row 1: Filters + Slider ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {/* Model dropdown */}
        <select
          value={filterModel}
          onChange={(e) => changeFilter(setFilterModel, e.target.value)}
          style={{ padding: '6px 12px', borderRadius: 20, fontSize: 12, fontWeight: 500, border: '1px solid var(--color-border)', background: 'var(--color-bg-surface)', color: 'var(--color-text-primary)', fontFamily: 'inherit', cursor: 'pointer', outline: 'none' }}
        >
          <option value="all">All Models</option>
          {modelList.map(m => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>

        {/* Persona dropdown */}
        <select
          value={filterPersona}
          onChange={(e) => changeFilter(setFilterPersona, e.target.value)}
          style={{ padding: '6px 12px', borderRadius: 20, fontSize: 12, fontWeight: 500, border: '1px solid var(--color-border)', background: 'var(--color-bg-surface)', color: 'var(--color-text-primary)', fontFamily: 'inherit', cursor: 'pointer', outline: 'none' }}
        >
          <option value="all">All Personas</option>
          {personaList.map(p => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>

        <div style={{ flex: 1 }} />

        {/* Grid size slider */}
        <input
          type="range"
          min={3}
          max={8}
          value={gridColumns}
          onChange={(e) => setGridColumns(Number(e.target.value))}
          className="fav-grid-slider"
          style={{ width: 120, cursor: 'pointer' }}
        />
      </div>

      {/* ── Row 2: Count + Pagination + Page size ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: -12 }}>
        <span style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>
          {filtered.length} favorite{filtered.length !== 1 ? 's' : ''}
        </span>

        <div style={{ flex: 1 }} />

        {/* Compact pagination */}
        {totalPages > 1 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <button
              onClick={() => setCurrentPage(p => Math.max(0, p - 1))}
              disabled={safePage === 0}
              style={{ width: 24, height: 24, borderRadius: '50%', border: '1px solid var(--color-border)', background: 'var(--color-bg-surface)', color: safePage === 0 ? '#ccc' : '#555', cursor: safePage === 0 ? 'default' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontFamily: 'inherit', padding: 0 }}
            >
              ‹
            </button>
            <span style={{ fontSize: 11, color: 'var(--color-text-secondary)', fontWeight: 500, minWidth: 60, textAlign: 'center' }}>
              {safePage + 1} of {totalPages}
            </span>
            <button
              onClick={() => setCurrentPage(p => Math.min(totalPages - 1, p + 1))}
              disabled={safePage >= totalPages - 1}
              style={{ width: 24, height: 24, borderRadius: '50%', border: '1px solid var(--color-border)', background: 'var(--color-bg-surface)', color: safePage >= totalPages - 1 ? '#ccc' : '#555', cursor: safePage >= totalPages - 1 ? 'default' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontFamily: 'inherit', padding: 0 }}
            >
              ›
            </button>
          </div>
        )}

        <div style={{ flex: 1 }} />

        {/* Page size dropdown */}
        <select
          value={pageSize}
          onChange={(e) => changePageSize(Number(e.target.value))}
          style={{ padding: '4px 10px', borderRadius: 20, fontSize: 11, fontWeight: 500, border: '1px solid var(--color-border)', background: 'var(--color-bg-surface)', color: 'var(--color-text-primary)', fontFamily: 'inherit', cursor: 'pointer', outline: 'none' }}
        >
          {[10, 20, 50, 100].map(n => (
            <option key={n} value={n}>{n} per page</option>
          ))}
        </select>
      </div>

      <style>{`
        .fav-grid-slider {
          -webkit-appearance: none;
          appearance: none;
          height: 3px;
          background: #e0e0e0;
          border-radius: 2px;
          outline: none;
        }
        .fav-grid-slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 14px;
          height: 14px;
          border-radius: 50%;
          background: #fff;
          box-shadow: 0 1px 4px rgba(0,0,0,0.2), 0 0 0 1px rgba(0,0,0,0.06);
          cursor: pointer;
          transition: box-shadow 150ms;
        }
        .fav-grid-slider::-webkit-slider-thumb:hover {
          box-shadow: 0 1px 6px rgba(0,0,0,0.3), 0 0 0 1px rgba(0,0,0,0.1);
        }
        .fav-grid-slider::-moz-range-thumb {
          width: 14px;
          height: 14px;
          border-radius: 50%;
          background: #fff;
          box-shadow: 0 1px 4px rgba(0,0,0,0.2), 0 0 0 1px rgba(0,0,0,0.06);
          border: none;
          cursor: pointer;
        }
      `}</style>

      {/* Image grid */}
      {pageImages.length === 0 ? (
        <div className="rounded-xl border p-12 text-center" style={{ borderColor: 'var(--color-border)', background: '#FFFFFF' }}>
          <div className="mb-3">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-tertiary)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ margin: '0 auto' }}>
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
            </svg>
          </div>
          <p className="text-sm font-medium" style={{ color: 'var(--color-text-secondary)' }}>No favorites yet.</p>
          <p className="text-xs mt-1" style={{ color: 'var(--color-text-tertiary)' }}>Star images in Gallery or Browse to see them here.</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${gridColumns}, 1fr)`, gap: 8 }}>
          {pageImages.map((img, i) => {
            const globalIndex = safePage * pageSize + i;
            return (
              <div
                key={`${img.url}-${i}`}
                className="image-card relative rounded-xl overflow-hidden cursor-pointer group"
                style={{ aspectRatio: '4/5' }}
                onClick={() => setLightbox({
                  images: filtered.map(fi => ({ url: fi.upscaledUrl || fi.url, label: fi.genName || fi.filename })),
                  index: globalIndex,
                  sourceImages: filtered,
                })}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={img.upscaledUrl || img.thumbnail}
                  alt={img.filename || `Image ${i + 1}`}
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
                {/* Hover overlay */}
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-all duration-200 flex items-end">
                  {/* Expand icon — top right */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setLightbox({
                        images: filtered.map(fi => ({ url: fi.upscaledUrl || fi.url, label: fi.genName || fi.filename })),
                        index: globalIndex,
                        sourceImages: filtered,
                      });
                    }}
                    className="absolute top-2 right-2 w-7 h-7 rounded-lg flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    style={{ background: 'rgba(0,0,0,0.5)' }}
                  >
                    <Maximize2 size={12} color="#fff" />
                  </button>
                  {/* Bottom action bar */}
                  <div className="w-full p-2 translate-y-full group-hover:translate-y-0 transition-transform duration-200">
                    <div className="flex gap-1.5 justify-end">
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDownload(img.url, img.filename || `image_${i + 1}.jpg`); }}
                        className="py-1.5 px-2 rounded-lg backdrop-blur-sm"
                        style={{ background: 'rgba(255,255,255,0.15)', color: 'white' }}
                        title="Download"
                      >
                        <Download size={11} />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDelete(img); }}
                        className="py-1.5 px-2 rounded-lg backdrop-blur-sm"
                        style={{ background: 'rgba(220,53,69,0.4)', color: 'white' }}
                        title="Delete"
                        disabled={deleting.has(img.url)}
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, paddingTop: 8 }}>
          <button
            onClick={() => setCurrentPage(p => Math.max(0, p - 1))}
            disabled={safePage === 0}
            style={{ width: 24, height: 24, borderRadius: '50%', border: '1px solid var(--color-border)', background: 'var(--color-bg-surface)', color: safePage === 0 ? '#ccc' : '#555', cursor: safePage === 0 ? 'default' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontFamily: 'inherit', padding: 0 }}
          >
            ‹
          </button>
          <span style={{ fontSize: 11, color: 'var(--color-text-secondary)', fontWeight: 500, minWidth: 60, textAlign: 'center' }}>
            {safePage + 1} of {totalPages}
          </span>
          <button
            onClick={() => setCurrentPage(p => Math.min(totalPages - 1, p + 1))}
            disabled={safePage >= totalPages - 1}
            style={{ width: 24, height: 24, borderRadius: '50%', border: '1px solid var(--color-border)', background: 'var(--color-bg-surface)', color: safePage >= totalPages - 1 ? '#ccc' : '#555', cursor: safePage >= totalPages - 1 ? 'default' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontFamily: 'inherit', padding: 0 }}
          >
            ›
          </button>
        </div>
      )}

      {/* Lightbox */}
      {lightbox && (() => {
        const currentImg = lightbox.sourceImages?.[lightbox.index];
        const matchedPersona = personaConfigs.find(p => p.name === currentImg?.persona);
        const genMeta: GenerationMeta | undefined = currentImg ? {
          personaName: currentImg.persona,
          personaAvatar: matchedPersona?.faceRefs?.[0],
          genName: currentImg.genName,
          feature: currentImg.source === 'carousel' ? 'Image Carousel' : currentImg.source === 'remix' ? 'Image Remix' : 'Image Copy',
          model: currentImg.model,
          quality: currentImg.model?.toLowerCase().includes('nanobanana') ? '4K' : '2K',
        } : undefined;
        return (
          <ImageLightbox
            images={lightbox.images}
            initialIndex={lightbox.index}
            onClose={() => setLightbox(null)}
            generationMeta={genMeta}
            actions={lightbox.sourceImages ? {
              onStar: (i) => { const img = lightbox.sourceImages![i]; if (img) { handleToggleStar(img); setLightbox(null); } },
              onUpscale: (i) => { const img = lightbox.sourceImages![i]; if (img) handleUpscale(img); },
              onRemix: onRemixImage ? (i) => { const url = lightbox.images[i]?.url; if (url) onRemixImage(url); } : undefined,
              onCarouselImage: onSendToCarousel ? (i) => { const url = lightbox.images[i]?.url; if (url) onSendToCarousel(url); } : undefined,
              onDownload: (i) => { const img = lightbox.sourceImages![i]; if (img) handleDownload(img.upscaledUrl || img.url, img.filename || `image_${i + 1}.jpg`); },
              onDelete: (i) => { const img = lightbox.sourceImages![i]; if (img) { handleDelete(img); setLightbox(null); } },
            } : undefined}
            imageMeta={lightbox.sourceImages?.map(img => ({ starred: true, upscaled: !!img.upscaledUrl }))}
          />
        );
      })()}
    </div>
  );
}
