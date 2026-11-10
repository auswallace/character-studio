'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import ImageLightbox, { type LightboxImage, type GenerationMeta } from './ImageLightbox';
import { useActiveJobsContext } from '@/contexts/ActiveJobsContext';
import { readSSEStream } from '@/lib/sse';
import ActiveJobCard from './ActiveJobCard';
import { useToast } from './Toast';
import { ChevronDown, Download, History, Layers, Maximize2, Plus, Trash2, X as XIcon } from 'lucide-react';

// ─── TypeScript Interfaces ────────────────────────────────

interface Persona {
  id: string;
  name: string;
  faceRefs: string[];
  bodyRefs: string[];
  traits: string;
  imageModel: string;
}

interface ImageThumbnails {
  small?: { url: string };
  large?: { url: string };
  full?: { url: string };
}

interface GenerationImage {
  url: string;
  filename: string;
  width?: number;
  height?: number;
  thumbnails?: ImageThumbnails;
  model?: string;
}

interface CarouselVariant {
  url: string;
  filename: string;
  thumbnails?: ImageThumbnails;
  angle_label?: string;
}

interface CarouselResult {
  id: string;
  name: string;
  carouselSetId: string | null;
  imageModel: string;
  variants: CarouselVariant[];
  status: string;
  persona: string;
  error?: string | null;
  starred?: boolean;
  sourceImageUrl?: string | null;
  prompt?: string | null;
  createdAt?: string;
  promptTemplateKey?: string;
}

// ─── Hardcoded image models ───────────────────────────────

const imageModels = [
  { id: 'nanobanana', name: 'Nanobanana Pro', iconColor: '#16A34A', iconLabel: 'G' },
  { id: 'nanobanana2', name: 'Nanobanana 2', iconColor: '#3B82F6', iconLabel: 'G' },
  { id: 'nanobanana21', name: 'Nanobanana 2.1', iconColor: '#3B82F6', iconLabel: 'G' },
  { id: 'seedream50lite', name: 'Seedream 5.0 Lite', iconColor: '#7C3AED', iconLabel: 'SD' },
  { id: 'seedream45', name: 'Seedream 4.5', iconColor: '#8B5CF6', iconLabel: 'SD' },
  { id: 'seedream40', name: 'Seedream 4.0', iconColor: '#6B7280', iconLabel: 'SD' },
] as const;

const ANGLE_LABELS: Record<string, string> = {
  'carousel:angle_left': '30\u00B0 Left Angle',
  'carousel:closeup': 'Medium Close-Up',
  'carousel:wide': 'Wide Environmental',
  'carousel:over_shoulder': 'Over-the-Shoulder',
};

const TEMPLATE_KEYS = [
  'carousel:angle_left',
  'carousel:closeup',
  'carousel:wide',
  'carousel:over_shoulder',
];

// ─── Props ────────────────────────────────────────────────

interface StudioCarouselTabProps {
  pendingCarouselImage?: string | null;
  onCarouselImageConsumed?: () => void;
  onRemixImage?: (url: string) => void;
}

export default function StudioCarouselTab({ pendingCarouselImage, onCarouselImageConsumed, onRemixImage }: StudioCarouselTabProps) {
  // ─── State ──────────────────────────────────────────────
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [recentImages, setRecentImages] = useState<GenerationImage[]>([]);
  const [recentCarousels, setRecentCarousels] = useState<CarouselResult[]>([]);
  const [loading, setLoading] = useState(true);

  // --- Active jobs (concurrent carousel) ---
  const { activeJobs: allActiveJobs, addJob, updateJob, appendImage, removeJob } = useActiveJobsContext();
  const activeJobs = allActiveJobs.filter(j => j.type === 'carousel');
  const { addToast } = useToast();

  const [selectedPersona, setSelectedPersona] = useState<string>('');
  const [selectedPersonaId, setSelectedPersonaId] = useState<string>('');
  const [selectedModel, setSelectedModel] = useState<string>('seedream45');
  const [gridColumns, setGridColumns] = useState(4);
  const [showPersonaPicker, setShowPersonaPicker] = useState(false);
  const personaPickerRef = useRef<HTMLDivElement>(null);
  const [showModelDropdown, setShowModelDropdown] = useState(false);
  const modelDropdownRef = useRef<HTMLDivElement>(null);

  // Source image
  const [sourceImagePreview, setSourceImagePreview] = useState<string | null>(null);
  const [sourceImageBase64, setSourceImageBase64] = useState<string | null>(null);
  const [sourceSource, setSourceSource] = useState<'grid' | 'upload' | null>(null);
  const [inheritedModel, setInheritedModel] = useState<string | null>(null);
  const [isExternalUpload, setIsExternalUpload] = useState(false);

  // Hero picker grid
  const [heroPage, setHeroPage] = useState(0);
  const IMAGES_PER_PAGE = 5;

  // Drag/drop
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Lightbox state
  const [lightbox, setLightbox] = useState<{ images: LightboxImage[]; index: number; meta?: Array<{ carouselId: string; carouselName: string; filename: string }> } | null>(null);

  // Notes
  const [notes, setNotes] = useState('');

  // Generating state
  const [generating, setGenerating] = useState(false);

  // Delete state
  const [deleting, setDeleting] = useState<Set<string>>(new Set());

  const currentPersona = personas.find(p => p.id === selectedPersona);

  // Tick timer for active job elapsed display
  const [, setTick] = useState(0);
  useEffect(() => {
    const hasRunning = activeJobs.some(j => j.status === 'running');
    if (!hasRunning) return;
    const interval = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(interval);
  }, [activeJobs]);

  // ─── Identity personas adapter ──────────────────────────
  const identityPersonas = useMemo(() =>
    personas.map(p => ({
      id: p.id,
      name: p.name,
      face_ref_url: p.faceRefs?.[0] || undefined,
    })),
    [personas]
  );

  // ─── File handling (mirrors StudioRemixTab) ─────────────

  const handleFile = useCallback((file: File) => {
    if (!file.type.startsWith('image/')) return;
    const objectUrl = URL.createObjectURL(file);
    setSourceImagePreview(objectUrl);
    setSourceSource('upload');
    setIsExternalUpload(true);
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(',')[1];
      setSourceImageBase64(base64);
    };
    reader.readAsDataURL(file);
  }, []);

  // Allow pasting images from clipboard
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) handleFile(file);
          break;
        }
      }
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [handleFile]);

  const clearSourceUpload = useCallback(() => {
    if (sourceImagePreview) URL.revokeObjectURL(sourceImagePreview);
    setSourceImagePreview(null);
    setSourceImageBase64(null);
    setSourceSource(null);
    setIsExternalUpload(false);
    setInheritedModel(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [sourceImagePreview]);

  // ─── Download handler ─────────────────────────────────────
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

  // ─── Delete handler ─────────────────────────────────────
  async function handleDeleteImage(carouselId: string, imageUrl: string) {
    setDeleting(prev => new Set(prev).add(imageUrl));
    try {
      const res = await fetch(`/api/carousel/${carouselId}/delete-image`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl }),
      });
      if (res.ok) {
        const result = await res.json();
        if (result.remaining === 0) {
          setRecentCarousels(prev => prev.filter(c => c.id !== carouselId));
        } else {
          setRecentCarousels(prev => prev.map(c =>
            c.id === carouselId
              ? { ...c, variants: c.variants.filter(v => v.url !== imageUrl) }
              : c
          ));
        }
      }
    } catch (err) {
      console.error('Failed to delete carousel image:', err);
    } finally {
      setDeleting(prev => { const next = new Set(prev); next.delete(imageUrl); return next; });
    }
  }

  // ─── Fetch data on mount ────────────────────────────────

  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      try {
        const [configRes, carouselRes] = await Promise.all([
          fetch('/api/config'),
          fetch('/api/carousel?limit=20'),
        ]);

        const configData = await configRes.json();
        const carouselData = await carouselRes.json();

        const fetchedPersonas: Persona[] = configData.personas || [];
        setPersonas(fetchedPersonas);

        if (fetchedPersonas.length > 0 && !selectedPersona) {
          const defaultId = localStorage.getItem('pipeline:carouselDefaultPersona');
          const defaultPersona = defaultId ? fetchedPersonas.find((p: Persona) => p.id === defaultId) : null;
          const startPersona = defaultPersona || fetchedPersonas[0];
          setSelectedPersona(startPersona.id);
          setSelectedPersonaId(startPersona.id);
          await fetchPersonaImages(startPersona.name);
        }

        setRecentCarousels(carouselData.carousels || []);
      } catch (err) {
        console.error('[StudioCarouselTab] Failed to fetch data:', err);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Re-fetch images when persona changes ─────────────

  async function fetchPersonaImages(personaName: string) {
    try {
      const res = await fetch(`/api/generations?limit=100&persona=${encodeURIComponent(personaName)}`);
      const data = await res.json();
      const allImages: GenerationImage[] = (data.generations || []).flatMap(
        (g: { images: GenerationImage[]; imageModel?: string }) =>
          (g.images || []).map(img => ({ ...img, model: g.imageModel || img.model }))
      );
      setRecentImages(allImages);
      setHeroPage(0);
    } catch (err) {
      console.error('[StudioCarouselTab] Failed to fetch persona images:', err);
    }
  }

  useEffect(() => {
    if (!currentPersona) return;
    fetchPersonaImages(currentPersona.name);
    // Clear selections on persona change
    clearSourceUpload();
    localStorage.setItem('pipeline:carouselDefaultPersona', currentPersona.id);
    setSelectedPersonaId(currentPersona.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPersona]);

  // ─── Consume pending carousel image from cross-tab navigation ───
  useEffect(() => {
    if (!pendingCarouselImage || personas.length === 0) return;
    setSourceImagePreview(pendingCarouselImage);
    setSourceSource('grid');
    setIsExternalUpload(false);
    onCarouselImageConsumed?.();
  }, [pendingCarouselImage, personas, onCarouselImageConsumed]);

  // ─── Refetch carousels helper ─────────────────────────────

  async function fetchRecentCarousels() {
    try {
      const res = await fetch('/api/carousel?limit=20');
      const data = await res.json();
      setRecentCarousels(data.carousels || []);
    } catch (err) {
      console.error('[StudioCarouselTab] Failed to refetch carousels:', err);
    }
  }

  // ─── Grid image select ────────────────────────────────────

  const handleGridImageSelect = (image: GenerationImage) => {
    setSourceImagePreview(image.url);
    setSourceSource('grid');
    setIsExternalUpload(false);
    if (image.model) {
      // Pre-select the model from the source image, but user can still change it
      const matchedModel = imageModels.find(m => m.name === image.model || m.id === image.model);
      if (matchedModel) {
        setSelectedModel(matchedModel.id);
      }
    }
    // Clear upload state
    setSourceImageBase64(null);
  };

  // ─── Generate Carousel (fires 4 parallel jobs) ─────────

  const handleGenerate = async () => {
    const sourceUrl = sourceSource === 'upload' && sourceImageBase64
      ? `data:image/jpeg;base64,${sourceImageBase64}`
      : sourceImagePreview;

    if (!sourceUrl || !currentPersona) return;
    setGenerating(true);

    const setId = crypto.randomUUID();
    const modelToSend = selectedModel;

    for (const key of TEMPLATE_KEYS) {
      const jobId = crypto.randomUUID();
      addJob({
        id: jobId,
        type: 'carousel',
        status: 'running',
        persona: currentPersona.name,
        model: imageModels.find(m => m.id === modelToSend)?.name || modelToSend,
        numImages: 1,
        notes: ANGLE_LABELS[key] || key,
        progress: 0,
        stage: 'Starting...',
        streamedImages: [],
        startedAt: Date.now(),
      });

      fetch('/api/carousel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceImageUrl: sourceUrl,
          promptTemplateKey: key,
          carouselSetId: setId,
          persona: currentPersona.name,
          personaId: selectedPersonaId,
          imageModel: modelToSend,
          notes: notes || undefined,
        }),
      }).then(async (res) => {
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: 'Unknown error' }));
          updateJob(jobId, { status: 'error', errorMessage: err.error, stage: 'Failed' });
          return;
        }

        const isStream = res.headers.get('Content-Type')?.includes('text/event-stream');

        if (isStream) {
          await readSSEStream(res, {
            onImage: (url) => appendImage(jobId, url, 80, 'Image received'),
            onProgress: (stage) => updateJob(jobId, { stage }),
            onDone: (data) => {
              updateJob(jobId, {
                status: 'done',
                progress: 100,
                stage: 'Complete',
                resultName: data.name,
                resultRecordId: data.recordId,
                imageCount: data.imageCount,
                failedCount: data.failedCount,
                elapsed: data.elapsed,
              });
              fetchRecentCarousels();
            },
            onError: (message) => updateJob(jobId, {
              status: 'error',
              errorMessage: message,
              stage: 'Failed',
            }),
          });
        } else if (res.ok) {
          const data = await res.json();
          updateJob(jobId, {
            status: 'done',
            progress: 100,
            stage: 'Complete',
            resultName: data.name,
            resultRecordId: data.recordId,
            imageCount: data.imageCount,
            failedCount: data.failedCount,
            elapsed: data.elapsed,
          });
          fetchRecentCarousels();
        }
      }).catch((err) => {
        updateJob(jobId, { status: 'error', errorMessage: err.message, stage: 'Network error' });
      });
    }

    addToast('Generating 4 carousel angles...', 'success');
    setGenerating(false);
  };

  // ─── Get image display URL helper ──────────────────────

  function imgUrl(img: GenerationImage | CarouselVariant): string {
    return img.thumbnails?.large?.url || img.url;
  }

  // ─── Derived ────────────────────────────────────────────

  // Group carousels by set ID for horizontal strips
  const groupedCarousels = useMemo(() => {
    const groups = new Map<string, CarouselResult[]>();
    for (const c of recentCarousels) {
      const key = c.carouselSetId || c.id;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(c);
    }
    return Array.from(groups.entries());
  }, [recentCarousels]);

  // Flat image list for lightbox navigation
  const flatCarouselImages = useMemo(() =>
    recentCarousels.flatMap(carousel =>
      carousel.variants.map((variant, idx) => ({
        url: variant.url,
        thumbnail: variant.thumbnails?.large?.url || variant.url,
        filename: `${(carousel.name || 'carousel').toLowerCase().replace(/[^a-z0-9]+/g, '-')}_${carousel.id.slice(0, 8)}_${idx + 1}.jpg`,
        carouselId: carousel.id,
        carouselName: carousel.name || `carousel_${carousel.id.slice(-6)}`,
        imageIndex: idx,
        persona: carousel.persona,
        model: carousel.imageModel,
        createdAt: carousel.createdAt,
        sourceImageUrl: carousel.sourceImageUrl || undefined,
        prompt: carousel.prompt || undefined,
        angleLabel: variant.angle_label || ANGLE_LABELS[carousel.promptTemplateKey || ''] || '',
        allThumbnails: carousel.variants.map(v => v.thumbnails?.large?.url || v.url),
      }))
    ),
    [recentCarousels]
  );

  const hasSource = (sourceSource === 'upload' && sourceImagePreview) || (sourceSource === 'grid' && sourceImagePreview);
  const sourceDisplayUrl = sourceSource === 'upload' && sourceImagePreview
    ? sourceImagePreview
    : sourceImagePreview || null;

  const canSubmit = hasSource && currentPersona && activeJobs.filter(j => j.status === 'running').length < 8;

  // Hero grid pagination
  const pagedImages = recentImages.slice(heroPage * IMAGES_PER_PAGE, (heroPage + 1) * IMAGES_PER_PAGE);
  const totalPages = Math.ceil(recentImages.length / IMAGES_PER_PAGE);

  // ─── Loading skeleton ──────────────────────────────────

  if (loading) {
    return (
      <div className="fade-in" style={{ position: 'relative', height: '100%', display: 'flex', flexDirection: 'column' }}>
        <div style={{ flex: 1, overflowY: 'auto', paddingBottom: 240 }}>
          <div className="grid grid-cols-3 gap-2" style={{ padding: '0 0 24px' }}>
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="skeleton rounded-xl" style={{ aspectRatio: '2/3' }} />
            ))}
          </div>
        </div>
        <div style={{ position: 'fixed', bottom: 20, left: 'calc(50% + 100px)', transform: 'translateX(-50%)', width: '75%', maxWidth: 'clamp(700px, 70%, 1400px)', height: 100, borderRadius: 20, background: '#fff' }} className="skeleton" />
      </div>
    );
  }

  // ─── Empty personas guard ──────────────────────────────

  if (personas.length === 0) {
    return (
      <div className="space-y-8 fade-in">
        <div className="text-center py-12">
          <p className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>No personas configured.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="fade-in" style={{ position: 'relative', height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0, marginTop: -16 }}>
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => { if (e.target.files?.[0]) handleFile(e.target.files[0]); }}
      />

      {/* ========== TOOLBAR: History + Column Slider ========== */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 0 6px',
          flexShrink: 0,
        }}
      >
        <button
          type="button"
          onClick={() => { window.location.hash = '#library.gallery'; }}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            padding: '5px 10px',
            borderRadius: 8,
            fontSize: 12,
            fontWeight: 500,
            border: 'none',
            background: 'transparent',
            color: '#999',
            cursor: 'pointer',
            fontFamily: 'inherit',
            transition: 'color 150ms',
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = '#333'; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = '#999'; }}
        >
          <History size={13} />
          History
        </button>
        <input
          type="range"
          min={3}
          max={8}
          value={gridColumns}
          onChange={(e) => setGridColumns(Number(e.target.value))}
          className="grid-slider-carousel"
          style={{ width: 120, cursor: 'pointer' }}
        />
      </div>
      <style>{`
        .grid-slider-carousel {
          -webkit-appearance: none;
          appearance: none;
          height: 3px;
          background: #e0e0e0;
          border-radius: 2px;
          outline: none;
        }
        .grid-slider-carousel::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 14px;
          height: 14px;
          border-radius: 50%;
          background: #fff;
          box-shadow: 0 1px 4px rgba(0,0,0,0.2), 0 0 0 1px rgba(0,0,0,0.06);
          cursor: pointer;
        }
        .grid-slider-carousel::-moz-range-thumb {
          width: 14px;
          height: 14px;
          border-radius: 50%;
          background: #fff;
          box-shadow: 0 1px 4px rgba(0,0,0,0.2), 0 0 0 1px rgba(0,0,0,0.06);
          border: none;
          cursor: pointer;
        }
      `}</style>

      {/* ═══ FULL-WIDTH SCROLLABLE CONTENT ═══ */}
      <div style={{ flex: 1, overflowY: 'auto', paddingBottom: 240 }}>

        {/* Error job cards */}
        {activeJobs.filter(j => j.status === 'error').length > 0 && (
          <div className="space-y-3" style={{ marginBottom: 16 }}>
            {activeJobs.filter(j => j.status === 'error').map(job => (
              <ActiveJobCard key={job.id} job={job} accentVar="--color-info" />
            ))}
          </div>
        )}

        {/* Results grid — flat grid with active jobs inline, matching Remix tab pattern */}
        {(flatCarouselImages.length > 0 || activeJobs.some(j => j.status === 'running')) ? (
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${gridColumns}, 1fr)`, gap: 8 }}>
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
              .shimmer-text-carousel {
                background: linear-gradient(90deg, #333 0%, #333 35%, #999 50%, #333 65%, #333 100%);
                background-size: 200% 100%;
                -webkit-background-clip: text;
                background-clip: text;
                -webkit-text-fill-color: transparent;
                animation: shimmerTextCarousel 2s ease-in-out infinite;
              }
              @keyframes shimmerTextCarousel {
                0% { background-position: 100% 0; }
                100% { background-position: -100% 0; }
              }
              .ref-img-wrapper-carousel:hover .ref-img-remove-carousel {
                opacity: 1 !important;
              }
              .panel-tooltip-carousel {
                position: relative;
              }
              .panel-tooltip-carousel .panel-tooltip-text-carousel {
                position: absolute;
                bottom: calc(100% + 6px);
                left: 50%;
                transform: translateX(-50%);
                background: rgba(0,0,0,0.78);
                backdrop-filter: blur(8px);
                color: #fff;
                font-size: 10px;
                font-weight: 500;
                text-align: center;
                white-space: nowrap;
                padding: 5px 10px;
                border-radius: 8px;
                pointer-events: none;
                opacity: 0;
                transition: opacity 0.15s ease;
                z-index: 10000;
                line-height: 1.4;
              }
              .panel-tooltip-carousel:hover .panel-tooltip-text-carousel {
                opacity: 1;
                transition-delay: 0.35s;
              }
            `}</style>
            {/* Active job streamed images + skeleton placeholders */}
            {activeJobs.filter(j => j.status === 'running').flatMap(job => {
              const items: React.ReactNode[] = [];
              // Streamed images
              job.streamedImages.forEach((url, idx) => {
                items.push(
                  <div
                    key={`job-${job.id}-img-${idx}`}
                    className="relative overflow-hidden fade-in cursor-pointer"
                    style={{ aspectRatio: '2/3', borderRadius: 12, border: '1px solid var(--color-border)' }}
                    onClick={() => setLightbox({
                      images: job.streamedImages.map((u, i) => ({ url: u, label: `Carousel #${i + 1}` })),
                      index: idx,
                    })}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={url} alt={`Carousel ${idx + 1}`} className="w-full h-full object-cover" />
                  </div>
                );
              });
              // Skeleton placeholders
              const remaining = Math.max(0, job.numImages - job.streamedImages.length);
              const stageLabel = (job.stage === 'Starting...' || job.stage === 'Calling API...' || job.stage === 'Connected...') ? 'Processing' : 'Generating';
              for (let idx = 0; idx < remaining; idx++) {
                items.push(
                  <div
                    key={`job-${job.id}-ph-${idx}`}
                    style={{
                      aspectRatio: '2/3',
                      borderRadius: 12,
                      background: 'var(--color-bg-tertiary)',
                      border: '1px solid var(--color-border)',
                      position: 'relative',
                      overflow: 'hidden',
                    }}
                  >
                    <div style={{
                      position: 'absolute',
                      inset: 0,
                      background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.04) 50%, transparent 100%)',
                      backgroundSize: '200% 100%',
                      animation: 'shimmerSlide 1.8s ease-in-out infinite',
                    }} />
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
                      <svg width="20" height="20" viewBox="0 0 48 48" style={{ animation: 'spinPulse 3s ease-in-out infinite', flexShrink: 0 }}>
                        <defs>
                          <linearGradient id={`carouselGrad-${job.id}-${idx}`} x1="0%" y1="0%" x2="100%" y2="100%">
                            <stop offset="0%" stopColor="#16A34A"/>
                            <stop offset="100%" stopColor="#4ADE80"/>
                          </linearGradient>
                        </defs>
                        <polygon points="24,4 42,14 42,34 24,44 6,34 6,14" fill={`url(#carouselGrad-${job.id}-${idx})`}/>
                        <circle cx="24" cy="24" r="9" fill="white"/>
                      </svg>
                      <span className="shimmer-text-carousel" style={{ fontSize: 14, fontWeight: 600, letterSpacing: '0.02em' }}>
                        {job.notes || stageLabel}
                      </span>
                    </div>
                  </div>
                );
              }
              return items;
            })}
            {/* Completed carousel images — flat grid like Remix */}
            {flatCarouselImages.map((fi, idx) => (
              <div
                key={`result-${fi.carouselId}-${fi.imageIndex}`}
                className="group"
                style={{
                  aspectRatio: '2/3',
                  borderRadius: 12,
                  overflow: 'hidden',
                  position: 'relative',
                  cursor: 'pointer',
                  opacity: deleting.has(fi.url) ? 0.4 : 1,
                  transition: 'opacity 200ms',
                }}
                onClick={() => setLightbox({
                  images: flatCarouselImages.map(f => ({ url: f.url, label: `${f.carouselName} #${f.imageIndex + 1}` })),
                  index: idx,
                  meta: flatCarouselImages.map(f => ({ carouselId: f.carouselId, carouselName: f.carouselName, filename: f.filename })),
                })}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={fi.thumbnail}
                  alt={fi.angleLabel || `Carousel #${idx + 1}`}
                  style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                />
                {/* Angle label badge */}
                {fi.angleLabel && (
                  <div style={{
                    position: 'absolute',
                    top: 8,
                    left: 8,
                    background: 'rgba(0,0,0,0.55)',
                    backdropFilter: 'blur(8px)',
                    color: '#fff',
                    fontSize: 10,
                    fontWeight: 600,
                    padding: '3px 8px',
                    borderRadius: 6,
                  }}>
                    {fi.angleLabel}
                  </div>
                )}
                {/* Hover overlay */}
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-all duration-200 flex items-end">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setLightbox({
                        images: flatCarouselImages.map(f => ({ url: f.url, label: `${f.carouselName} #${f.imageIndex + 1}` })),
                        index: idx,
                        meta: flatCarouselImages.map(f => ({ carouselId: f.carouselId, carouselName: f.carouselName, filename: f.filename })),
                      });
                    }}
                    className="absolute top-2 right-2 w-7 h-7 rounded-lg flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    style={{ background: 'rgba(0,0,0,0.5)' }}
                  >
                    <Maximize2 size={12} color="#fff" />
                  </button>
                  <div className="w-full p-2 translate-y-full group-hover:translate-y-0 transition-transform duration-200">
                    <div className="flex gap-1.5">
                      {onRemixImage && (
                        <button
                          onClick={(e) => { e.stopPropagation(); onRemixImage(fi.url); }}
                          className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg text-[10px] font-medium backdrop-blur-sm"
                          style={{ background: 'rgba(255,255,255,0.15)', color: 'white' }}
                        >
                          Remix
                        </button>
                      )}
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDownload(fi.url, fi.filename); }}
                        className="py-1.5 px-2 rounded-lg backdrop-blur-sm"
                        style={{ background: 'rgba(255,255,255,0.15)', color: 'white' }}
                        title="Download"
                      >
                        <Download size={11} />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDeleteImage(fi.carouselId, fi.url); }}
                        className="py-1.5 px-2 rounded-lg backdrop-blur-sm"
                        style={{ background: 'rgba(220,53,69,0.4)', color: 'white' }}
                        title="Delete"
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : !activeJobs.some(j => j.status === 'running') ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '48px 24px', borderRadius: 16, border: '1px dashed rgba(0,0,0,0.10)', background: '#FAFAFA' }}>
            <Layers size={22} color="#ccc" style={{ marginBottom: 12 }} />
            <p style={{ fontSize: 13, fontWeight: 500, color: '#888', marginBottom: 4 }}>No carousels yet</p>
            <p style={{ fontSize: 12, color: '#bbb' }}>Select a source image and generate multi-angle variations</p>
          </div>
        ) : null}
      </div>

      {/* ═══ FLOATING BOTTOM PANEL ═══ */}
      <div
        style={{
          position: 'fixed',
          bottom: 20,
          left: 240,
          right: 20,
          maxWidth: 'clamp(700px, 70%, 1400px)',
          marginLeft: 'auto',
          marginRight: 'auto',
          background: '#fff',
          borderRadius: 20,
          border: '1px solid rgba(255,255,255,0.6)',
          boxShadow: '0 12px 48px rgba(0,0,0,0.12), 0 4px 16px rgba(0,0,0,0.06)',
          zIndex: 9999,
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'stretch',
        }}
      >
        {/* ── LEFT COLUMN: Identity + Source Image ── */}
        <div style={{ padding: '16px 16px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          {/* Identity: selected persona (clickable to swap) */}
          <div ref={personaPickerRef} style={{ display: 'flex', gap: 6, flexShrink: 0, position: 'relative' }}>
            {(() => {
              const selected = identityPersonas.find(p => p.id === selectedPersona);
              if (!selected) return null;
              return (
                <div className="panel-tooltip-carousel" style={{ flexShrink: 0 }}>
                  <span className="panel-tooltip-text-carousel">Identity to insert</span>
                  <div
                    onClick={() => setShowPersonaPicker(!showPersonaPicker)}
                    className="persona-thumb-clickable"
                    style={{ position: 'relative', width: 100, height: 140, borderRadius: 12, overflow: 'hidden', border: '2px solid #1E40AF', background: selected.face_ref_url ? '#e5e7eb' : 'linear-gradient(135deg, #a78bfa 0%, #f472b6 100%)', cursor: 'pointer', transition: 'border-color 0.15s ease, box-shadow 0.15s ease' }}
                  >
                    {selected.face_ref_url && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={selected.face_ref_url} alt={selected.name} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
                    )}
                    <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: '3px 4px', fontSize: 9, fontWeight: 700, color: '#fff', textAlign: 'center', background: 'linear-gradient(to top, rgba(0,0,0,0.65), transparent)', lineHeight: 1.3 }}>
                      {selected.name}
                    </div>
                    <div className="persona-swap-overlay" style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0, transition: 'opacity 0.15s ease' }}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.3))' }}>
                        <polyline points="17 1 21 5 17 9" /><path d="M3 11V9a4 4 0 0 1 4-4h14" /><polyline points="7 23 3 19 7 15" /><path d="M21 13v2a4 4 0 0 1-4 4H3" />
                      </svg>
                    </div>
                  </div>
                </div>
              );
            })()}
            {showPersonaPicker && (
              <div style={{ position: 'absolute', bottom: '100%', left: 0, marginBottom: 6, background: '#fff', border: '1px solid var(--color-border)', borderRadius: 14, boxShadow: '0 8px 24px rgba(0,0,0,0.12)', overflow: 'hidden', zIndex: 50, width: 220 }}>
                {identityPersonas.map(persona => {
                  const isSelected = persona.id === selectedPersona;
                  return (
                    <button
                      key={persona.id}
                      onClick={() => { setSelectedPersona(persona.id); setSelectedPersonaId(persona.id); setShowPersonaPicker(false); }}
                      style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '10px 14px', border: 'none', background: isSelected ? 'var(--color-bg-tertiary)' : 'transparent', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--color-bg-tertiary)'; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = isSelected ? 'var(--color-bg-tertiary)' : 'transparent'; }}
                    >
                      <div style={{ width: 32, height: 40, borderRadius: 8, overflow: 'hidden', background: persona.face_ref_url ? '#e5e7eb' : 'linear-gradient(135deg, #a78bfa 0%, #f472b6 100%)', flexShrink: 0, position: 'relative' }}>
                        {persona.face_ref_url && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={persona.face_ref_url} alt={persona.name} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
                        )}
                      </div>
                      <div style={{ fontSize: 13, fontWeight: isSelected ? 600 : 500, color: 'var(--color-text-primary)' }}>{persona.name}</div>
                      {isSelected && <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ marginLeft: 'auto' }}><path d="M3 8.5L6.5 12L13 4" stroke="#16A34A" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Source image slot */}
          <div className="ref-img-wrapper-carousel panel-tooltip-carousel" style={{ position: 'relative', width: 100, height: 140, flexShrink: 0 }}>
            <span className="panel-tooltip-text-carousel">Source Image</span>
            <div
              onClick={() => { if (!sourceDisplayUrl) fileInputRef.current?.click(); }}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                const carouselImageUrl = e.dataTransfer.getData('text/x-carousel-image');
                if (carouselImageUrl) {
                  setSourceImagePreview(carouselImageUrl);
                  setSourceSource('grid');
                  setIsExternalUpload(false);
                  setSourceImageBase64(null);
                  return;
                }
                const file = e.dataTransfer.files?.[0];
                if (file) handleFile(file);
              }}
              style={{
                position: 'relative',
                width: 100,
                height: 140,
                borderRadius: 12,
                overflow: 'hidden',
                cursor: 'pointer',
                border: sourceDisplayUrl ? '2px solid #16A34A' : dragOver ? '2px dashed #16A34A' : '1.5px dashed #d1d5db',
                background: sourceDisplayUrl ? '#e5e7eb' : dragOver ? 'rgba(22,163,74,0.04)' : 'transparent',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'border-color 150ms, background 150ms',
              }}
            >
              {sourceDisplayUrl ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={sourceDisplayUrl} alt="Source" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
                </>
              ) : (
                <>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#bbb" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                  <span style={{ fontSize: 8, color: '#bbb', fontWeight: 600, marginTop: 2 }}>Source</span>
                </>
              )}
            </div>
            {sourceDisplayUrl && (
              <button
                className="ref-img-remove-carousel"
                onClick={(e) => { e.stopPropagation(); clearSourceUpload(); }}
                style={{
                  position: 'absolute', top: -8, right: -8,
                  width: 22, height: 22, borderRadius: '50%',
                  background: 'rgba(0,0,0,0.7)', border: '2px solid #fff',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  cursor: 'pointer',
                  opacity: 0, transition: 'opacity 0.15s ease',
                  boxShadow: '0 1px 4px rgba(0,0,0,0.2)',
                  zIndex: 2,
                }}
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* ── MIDDLE COLUMN: Image Grid + Model Picker ── */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: '12px 0' }}>
          {/* Image picker grid */}
          <div style={{ padding: '0 14px', flex: 1, display: 'flex', alignItems: 'center' }}>
            {pagedImages.length > 0 ? (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 4, width: '100%' }}>
                {pagedImages.map((img, i) => {
                  const isSelected = sourceImagePreview === img.url;
                  return (
                    <div
                      key={`grid-${heroPage}-${i}`}
                      onClick={() => handleGridImageSelect(img)}
                      style={{
                        aspectRatio: '2/3',
                        borderRadius: 6,
                        overflow: 'hidden',
                        cursor: 'pointer',
                        border: isSelected ? '2px solid #16A34A' : '1px solid var(--color-border)',
                        position: 'relative',
                        transition: 'border-color 150ms',
                      }}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={imgUrl(img)}
                        alt={`Image ${i + 1}`}
                        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                      />
                    </div>
                  );
                })}
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', minHeight: 60 }}>
                <span style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>No images for this persona</span>
              </div>
            )}
          </div>

          {/* Controls row */}
          <div style={{ padding: '6px 14px 0', display: 'flex', alignItems: 'center', gap: 6 }}>
            {/* Pagination */}
            {totalPages > 1 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginRight: 6 }}>
                <button
                  type="button"
                  onClick={() => setHeroPage(Math.max(0, heroPage - 1))}
                  disabled={heroPage === 0}
                  style={{ width: 24, height: 24, borderRadius: 6, border: '1px solid #e5e7eb', background: 'var(--color-bg-surface)', cursor: heroPage === 0 ? 'not-allowed' : 'pointer', opacity: heroPage === 0 ? 0.3 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: '#555', fontFamily: 'inherit' }}
                >
                  &lsaquo;
                </button>
                <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)', minWidth: 36, textAlign: 'center' }}>{heroPage + 1}/{totalPages}</span>
                <button
                  type="button"
                  onClick={() => setHeroPage(Math.min(totalPages - 1, heroPage + 1))}
                  disabled={heroPage >= totalPages - 1}
                  style={{ width: 24, height: 24, borderRadius: 6, border: '1px solid #e5e7eb', background: 'var(--color-bg-surface)', cursor: heroPage >= totalPages - 1 ? 'not-allowed' : 'pointer', opacity: heroPage >= totalPages - 1 ? 0.3 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: '#555', fontFamily: 'inherit' }}
                >
                  &rsaquo;
                </button>
              </div>
            )}

            {/* Model selector — always visible */}
            <div ref={modelDropdownRef} style={{ position: 'relative', flexShrink: 0 }}>
              <button
                type="button"
                onClick={() => setShowModelDropdown(!showModelDropdown)}
                style={{ padding: '5px 12px', borderRadius: 10, fontSize: 12, fontWeight: 500, border: '1px solid #e5e7eb', background: 'var(--color-bg-surface)', color: '#555', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'inherit', whiteSpace: 'nowrap' }}
              >
                <div style={{ width: 16, height: 16, borderRadius: 4, background: imageModels.find(m => m.id === selectedModel)?.iconColor || '#999', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, fontWeight: 700, color: '#fff' }}>
                  {imageModels.find(m => m.id === selectedModel)?.iconLabel}
                </div>
                {imageModels.find(m => m.id === selectedModel)?.name || 'Model'}
                <ChevronDown size={11} />
              </button>
              {showModelDropdown && (
                <div style={{ position: 'absolute', bottom: '100%', left: 0, marginBottom: 6, background: '#fff', border: '1px solid var(--color-border)', borderRadius: 14, boxShadow: '0 8px 24px rgba(0,0,0,0.12)', overflow: 'hidden', zIndex: 50, width: 220 }}>
                  {imageModels.map(m => (
                    <button
                      key={m.id}
                      onClick={() => { setSelectedModel(m.id); setShowModelDropdown(false); }}
                      style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '10px 14px', border: 'none', background: m.id === selectedModel ? 'var(--color-bg-tertiary)' : 'transparent', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--color-bg-tertiary)'; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = m.id === selectedModel ? 'var(--color-bg-tertiary)' : 'transparent'; }}
                    >
                      <div style={{ width: 24, height: 24, borderRadius: 6, background: m.iconColor, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 700, color: '#fff', flexShrink: 0 }}>{m.iconLabel}</div>
                      <div style={{ fontSize: 13, fontWeight: m.id === selectedModel ? 600 : 500, color: 'var(--color-text-primary)' }}>{m.name}</div>
                      {m.id === selectedModel && <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ marginLeft: 'auto' }}><path d="M3 8.5L6.5 12L13 4" stroke="#16A34A" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Upload button */}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              style={{ padding: '5px 12px', borderRadius: 10, fontSize: 12, fontWeight: 500, border: '1px solid #e5e7eb', background: 'var(--color-bg-surface)', color: '#555', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5, fontFamily: 'inherit', whiteSpace: 'nowrap', marginLeft: 'auto' }}
            >
              <Plus size={12} />
              Upload
            </button>
          </div>
        </div>

        {/* ── NOTES COLUMN — borderless, subtle bg ── */}
        <div style={{ width: 220, flexShrink: 0, padding: 12, display: 'flex', flexDirection: 'column' }}>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Pose & expression notes (e.g., smiling, arms crossed, looking away)..."
            style={{
              flex: 1,
              padding: '10px 12px',
              borderRadius: 10,
              border: 'none',
              background: 'var(--color-bg-tertiary)',
              fontSize: 12,
              fontFamily: 'inherit',
              color: 'var(--color-text-primary)',
              resize: 'none',
              outline: 'none',
              lineHeight: 1.5,
              transition: 'box-shadow 0.15s ease',
            }}
            onFocus={(e) => { e.currentTarget.style.boxShadow = '0 0 0 2px rgba(22,163,74,0.2)'; }}
            onBlur={(e) => { e.currentTarget.style.boxShadow = 'none'; }}
          />
        </div>

        {/* ── GENERATE COLUMN — green gradient matching mockup ── */}
        <div style={{ padding: '18px', display: 'flex', alignItems: 'center', flexShrink: 0 }}>
          <button
            type="button"
            onClick={() => { if (canSubmit) handleGenerate(); }}
            disabled={!canSubmit || generating}
            style={{
              padding: '14px 24px',
              borderRadius: 14,
              background: 'linear-gradient(135deg, #059669, #34D399)',
              color: '#fff',
              fontWeight: 600,
              fontSize: 14,
              border: 'none',
              cursor: canSubmit && !generating ? 'pointer' : 'not-allowed',
              opacity: canSubmit && !generating ? 1 : 0.5,
              transition: 'transform 150ms, opacity 150ms',
              fontFamily: 'inherit',
              whiteSpace: 'nowrap',
              boxShadow: '0 2px 10px rgba(5,150,105,0.3)',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
            onMouseEnter={(e) => { if (canSubmit && !generating) (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1.03)'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1)'; }}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M8 2L9.5 6.5L14 8L9.5 9.5L8 14L6.5 9.5L2 8L6.5 6.5L8 2Z" fill="white"/></svg>
            Carousel
          </button>
        </div>
      </div>

      {/* Lightbox */}
      {lightbox && (() => {
        const currentFlat = flatCarouselImages[lightbox.index];
        const currentPersonaObj = personas.find(p => p.name === currentFlat?.persona);
        const modelInfo = imageModels.find(m => m.id === currentFlat?.model || m.name === currentFlat?.model);
        // Find all images in the same carousel set for output thumbnails
        const currentCarousel = recentCarousels.find(c => c.id === currentFlat?.carouselId);
        const setId = currentCarousel?.carouselSetId;
        const setCarousels = setId ? recentCarousels.filter(c => c.carouselSetId === setId) : (currentCarousel ? [currentCarousel] : []);
        const setThumbnails = setCarousels.flatMap(c => c.variants.map(v => v.thumbnails?.large?.url || v.url));

        const genMeta: GenerationMeta | undefined = currentFlat ? {
          personaName: currentFlat.persona,
          personaAvatar: currentPersonaObj?.faceRefs?.[0],
          genName: currentFlat.carouselName,
          feature: 'Image Carousel',
          model: modelInfo?.name || currentFlat.model || undefined,
          quality: currentFlat.model?.includes('nanobanana') ? '4K' : '2K',
          createdAt: currentFlat.createdAt,
          prompt: currentFlat.prompt,
          refImage: currentFlat.sourceImageUrl || sourceImagePreview || undefined,
          outputThumbnails: setThumbnails.length > 0 ? setThumbnails : currentFlat.allThumbnails,
        } : undefined;
        return (
          <ImageLightbox
            images={lightbox.images}
            initialIndex={lightbox.index}
            onClose={() => setLightbox(null)}
            generationMeta={genMeta}
            actions={{
              onRemix: onRemixImage ? (i) => {
                const url = lightbox.images[i]?.url;
                if (url) onRemixImage(url);
              } : undefined,
              onDownload: (i) => {
                const url = lightbox.images[i]?.url;
                const m = lightbox.meta?.[i];
                if (url) handleDownload(url, m?.filename || `carousel_${i + 1}.jpg`);
              },
              onDelete: (i) => {
                const url = lightbox.images[i]?.url;
                const m = lightbox.meta?.[i];
                if (url && m) { handleDeleteImage(m.carouselId, url); setLightbox(null); }
              },
            }}
          />
        );
      })()}

      {/* Close dropdowns on outside click */}
      {(showModelDropdown || showPersonaPicker) && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 15 }}
          onClick={() => { setShowModelDropdown(false); setShowPersonaPicker(false); }}
        />
      )}
    </div>
  );
}
