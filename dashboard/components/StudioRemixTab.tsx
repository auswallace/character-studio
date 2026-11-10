'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import ModelSettings, { useManifest, resolveParams } from './ModelSettings';
import IdentityChip, { identityBody, type IdentityMode } from './IdentityChip';
// Portal removed — fade-in no longer uses transform so fixed positioning works
import ImageLightbox, { type LightboxImage, type GenerationMeta } from './ImageLightbox';
import { useActiveJobsContext } from '@/contexts/ActiveJobsContext';
import { readSSEStream } from '@/lib/sse';
import ActiveJobCard from './ActiveJobCard';
import { useToast } from './Toast';
import { ChevronDown, Download, History, Maximize2, Shuffle, Trash2, X as XIcon } from 'lucide-react';
// IdentityLock and GenerationBox inlined into floating bottom panel

// ─── TypeScript Interfaces ────────────────────────────────

interface Persona {
  id: string;
  name: string;
  faceRefs: string[];
  bodyRefs: string[];
  traits: string;
  imageModel: string;
  activeCharacterId?: string | null;
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
}

interface RemixVariant {
  url: string;
  filename: string;
  thumbnails?: ImageThumbnails;
}

interface Remix {
  id: string;
  name: string;
  remixPrompt: string;
  imageModel: string;
  variants: RemixVariant[];
  status: string;
  persona: string;
  error?: string | null;
  numImages?: number;
  starred?: boolean;
  heroImage?: string | null;
  createdAt?: string;
}

// ─── Hardcoded image models ───────────────────────────────

const imageModels = [
  { id: 'nanobanana', name: 'Nanobanana Pro', maxImages: 4, description: 'Flagship 4K photorealism', iconColor: '#16A34A', iconLabel: 'G' },
  { id: 'nanobanana2', name: 'Nanobanana 2', maxImages: 4, description: 'Fast with style variety', iconColor: '#3B82F6', iconLabel: 'G' },
  { id: 'nanobanana21', name: 'Nanobanana 2.1', maxImages: 4, description: 'Newest Google model, 14 refs', iconColor: '#3B82F6', iconLabel: 'G' },
  { id: 'seedream50lite', name: 'Seedream 5.0 Lite', maxImages: 6, description: 'Newest ByteDance, 10 refs, cheap', iconColor: '#7C3AED', iconLabel: 'SD' },
  { id: 'seedream45', name: 'Seedream 4.5', maxImages: 6, description: 'Best quality, slower', iconColor: '#8B5CF6', iconLabel: 'SD' },
  { id: 'seedream40', name: 'Seedream 4.0', maxImages: 6, description: 'Reliable baseline', iconColor: '#6B7280', iconLabel: 'SD' },
] as const;

const ASPECT_RATIO_OPTIONS = [
  { value: '9:16', label: 'Portrait', w: 9, h: 16 },
  { value: '4:5', label: 'IG Post', w: 4, h: 5 },
  { value: '1:1', label: 'Square', w: 1, h: 1 },
  { value: '3:4', label: '', w: 3, h: 4 },
  { value: '4:3', label: '', w: 4, h: 3 },
  { value: '2:3', label: '', w: 2, h: 3 },
  { value: '3:2', label: '', w: 3, h: 2 },
  { value: '16:9', label: 'Landscape', w: 16, h: 9 },
  { value: '5:4', label: '', w: 5, h: 4 },
  { value: '21:9', label: 'Ultra Wide', w: 21, h: 9 },
];

// ─── Edit type classification ─────────────────────────────

type EditType = 'attribute' | 'background' | 'pose_expression' | 'removal';

const EDIT_TYPES: { id: EditType; label: string }[] = [
  { id: 'attribute', label: 'Attribute' },
  { id: 'background', label: 'Background' },
  { id: 'pose_expression', label: 'Pose' },
  { id: 'removal', label: 'Removal' },
];

function classifyEditType(prompt: string): EditType {
  const lower = prompt.toLowerCase();
  if (/remov|delet|eras|strip|take away|get rid/i.test(lower)) return 'removal';
  if (/background|scene|setting|environment|location|place|room|outdoor|indoor/i.test(lower)) return 'background';
  if (/pose|posing|position|expression|face|smile|look|stand|sit|lean|lay|kneel/i.test(lower)) return 'pose_expression';
  return 'attribute';
}

interface StudioRemixTabProps {
  pendingRemixImage?: string | null;
  onRemixImageConsumed?: () => void;
  onNavigate?: (route: string) => void;
  onSendToCarousel?: (url: string) => void;
}

export default function StudioRemixTab({ pendingRemixImage, onRemixImageConsumed, onNavigate, onSendToCarousel }: StudioRemixTabProps) {
  // ─── State ──────────────────────────────────────────────
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [recentImages, setRecentImages] = useState<GenerationImage[]>([]);
  const [remixResults, setRemixResults] = useState<Remix[]>([]);
  const [loading, setLoading] = useState(true);

  // --- Active jobs (concurrent remix) ---
  const { activeJobs: allActiveJobs, addJob, updateJob, appendImage, removeJob } = useActiveJobsContext();
  const activeJobs = allActiveJobs.filter(j => j.type === 'remix');
  const { addToast } = useToast();

  const [selectedPersona, setSelectedPersona] = useState<string>('');
  const [selectedModel, setSelectedModel] = useState<string>('nanobanana2');
  const [resolution, setResolution] = useState<'1k' | '2k' | '4k'>('2k');
  const [aspectRatio, setAspectRatio] = useState('9:16');
  // Extra fields of the selected model from its provider manifest (ratio/resolution keep their own chips). Sent as `params`.
  const [modelParams, setModelParams] = useState<Record<string, unknown>>({});
  // Trained versions (LoRAs) are entries in the model menu, same as Image Copy. loraCharId set = that LoRA renders.
  const [loraCharId, setLoraCharId] = useState<string | null>(null);
  const [readyChars, setReadyChars] = useState<{ id: string; name: string; base_model: string }[]>([]);
  const [identity, setIdentity] = useState<IdentityMode>('hybrid');   // used only when an image model is picked: 'hybrid' | 'refs'
  const { fields: modelFields } = useManifest(`model:${selectedModel}`);
  const [gridColumns, setGridColumns] = useState(4);
  const [showAspectDropdown, setShowAspectDropdown] = useState(false);
  const [showResDropdown, setShowResDropdown] = useState(false);
  const [showPersonaPicker, setShowPersonaPicker] = useState(false);
  const personaPickerRef = useRef<HTMLDivElement>(null);
  const [nsfw, setNsfw] = useState(false);
  const aspectDropdownRef = useRef<HTMLDivElement>(null);
  const resDropdownRef = useRef<HTMLDivElement>(null);
  const modelDropdownRef = useRef<HTMLDivElement>(null);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [remixPrompt, setRemixPrompt] = useState('');
  const [enhancePrompt, setEnhancePrompt] = useState(true);
  const [editType, setEditType] = useState<EditType>('attribute');

  const [numImages, setNumImages] = useState(2);
  const currentModel = imageModels.find(m => m.id === selectedModel) || imageModels[0];
  const isNanobananaModel = currentModel.id === 'nanobanana' || currentModel.id === 'nanobanana2' || currentModel.id === 'nanobanana21';

  // Clamp numImages when model changes
  useEffect(() => {
    if (numImages > currentModel.maxImages) setNumImages(currentModel.maxImages);
  }, [selectedModel, currentModel.maxImages, numImages]);

  // Drag/drop upload state
  const [heroImagePreview, setHeroImagePreview] = useState<string | null>(null);
  const [heroImageBase64, setHeroImageBase64] = useState<string | null>(null);
  const [heroSource, setHeroSource] = useState<'grid' | 'upload' | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Lightbox state
  const [lightbox, setLightbox] = useState<{ images: LightboxImage[]; index: number; sourceId?: string; sourceName?: string; meta?: Array<{ remixId: string; remixName: string; filename: string }> } | null>(null);

  // Expanded prompt state (click-to-expand)
  const [expandedPromptId, setExpandedPromptId] = useState<string | null>(null);

  // Tick timer for active job elapsed display
  const [, setTick] = useState(0);
  useEffect(() => {
    const hasRunning = activeJobs.some(j => j.status === 'running');
    if (!hasRunning) return;
    const interval = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(interval);
  }, [activeJobs]);

  // Hero image pagination (15 images per page + Library card = 16 slots)
  const [heroPage, setHeroPage] = useState(0);
  const IMAGES_PER_PAGE = 15;

  // Delete state
  const [deleting, setDeleting] = useState<Set<string>>(new Set());
  const [showDeleteAllConfirm, setShowDeleteAllConfirm] = useState<string | null>(null);

  // Model dropdown state
  const [showModelDropdown, setShowModelDropdown] = useState(false);
  const [showCountDropdown, setShowCountDropdown] = useState(false);
  const [promptFocused, setPromptFocused] = useState(false);

  const currentPersona = personas.find(p => p.id === selectedPersona);
  const loraChar = readyChars.find(c => c.id === loraCharId) || null;
  useEffect(() => {
    const pid = currentPersona?.id;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset when no persona is selected
    if (!pid) { setReadyChars([]); setLoraCharId(null); return; }
    let alive = true;
    fetch(`/api/characters?persona_id=${encodeURIComponent(pid)}`).then(r => r.json()).then(d => {
      if (!alive) return;
      const ready = ((d.characters || []) as { id: string; name: string; base_model: string; status: string }[]).filter(c => c.status === 'ready');
      setReadyChars(ready);
      setLoraCharId(ready.some(c => c.id === currentPersona?.activeCharacterId) ? currentPersona!.activeCharacterId! : null);
    }).catch(() => { if (alive) setReadyChars([]); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload only when the persona changes
  }, [currentPersona?.id]);

  // Auto-classify edit type from prompt
  useEffect(() => {
    if (remixPrompt.trim()) {
      setEditType(classifyEditType(remixPrompt));
    }
  }, [remixPrompt]);

  // ─── File handling (mirrors StudioCopyTab) ─────────────

  const handleFile = useCallback((file: File) => {
    if (!file.type.startsWith('image/')) return;
    const objectUrl = URL.createObjectURL(file);
    setHeroImagePreview(objectUrl);
    setHeroSource('upload');
    setSelectedImage(null); // Clear grid selection
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(',')[1];
      setHeroImageBase64(base64);
    };
    reader.readAsDataURL(file);
  }, []);

  // Allow pasting images from clipboard (Cmd+V / Ctrl+V)
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

  const clearHeroUpload = useCallback(() => {
    if (heroImagePreview) URL.revokeObjectURL(heroImagePreview);
    setHeroImagePreview(null);
    setHeroImageBase64(null);
    setHeroSource(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [heroImagePreview]);

  // ─── Download handler — fetch as blob to bypass cross-origin ──
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

  // ─── Star handler ──────────────────────────────────────
  async function handleToggleStar(remixId: string) {
    const remix = remixResults.find(r => r.id === remixId);
    if (!remix) return;
    const newStarred = !remix.starred;
    setRemixResults(prev => prev.map(r => r.id === remixId ? { ...r, starred: newStarred } : r));
    try {
      const res = await fetch(`/api/remix/${remixId}/star`, { method: 'PATCH' });
      if (!res.ok) {
        setRemixResults(prev => prev.map(r => r.id === remixId ? { ...r, starred: !newStarred } : r));
      }
    } catch { setRemixResults(prev => prev.map(r => r.id === remixId ? { ...r, starred: !newStarred } : r)); }
  }

  // ─── Delete handlers ──────────────────────────────────────

  async function handleDeleteImage(remixId: string, imageUrl: string) {
    setDeleting(prev => new Set(prev).add(imageUrl));
    try {
      const res = await fetch(`/api/remix/${remixId}/delete-image`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl }),
      });
      if (res.ok) {
        const result = await res.json();
        if (result.remaining === 0) {
          // All images gone — remove from visible list (record preserved in Supabase for analytics)
          setRemixResults(prev => prev.filter(r => r.id !== remixId));
        } else {
          setRemixResults(prev => prev.map(r =>
            r.id === remixId
              ? { ...r, variants: r.variants.filter(v => v.url !== imageUrl) }
              : r
          ));
        }
      }
    } catch (err) {
      console.error('Failed to delete remix image:', err);
    } finally {
      setDeleting(prev => { const next = new Set(prev); next.delete(imageUrl); return next; });
    }
  }

  async function handleDeleteAll(remixId: string) {
    setShowDeleteAllConfirm(null);
    try {
      const res = await fetch(`/api/remix/${remixId}/delete-image`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deleteAll: true }),
      });
      if (res.ok) {
        // Remove from visible list (record preserved in Supabase for analytics)
        setRemixResults(prev => prev.filter(r => r.id !== remixId));
      }
    } catch (err) {
      console.error('Failed to delete remix:', err);
    }
  }

  // ─── Fetch data on mount ────────────────────────────────

  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      try {
        const [configRes, remixRes] = await Promise.all([
          fetch('/api/config'),
          fetch('/api/remix?limit=15'),
        ]);

        const configData = await configRes.json();
        const remixData = await remixRes.json();

        const fetchedPersonas: Persona[] = configData.personas || [];
        setPersonas(fetchedPersonas);

        if (fetchedPersonas.length > 0 && !selectedPersona) {
          const defaultId = localStorage.getItem('pipeline:defaultPersona');
          const defaultPersona = defaultId ? fetchedPersonas.find((p: Persona) => p.id === defaultId) : null;
          const startPersona = defaultPersona || fetchedPersonas[0];
          setSelectedPersona(startPersona.id);
          // Fetch persona-specific images
          await fetchPersonaImages(startPersona.name);
        }

        setRemixResults(remixData.remixes || []);
      } catch (err) {
        console.error('[StudioRemixTab] Failed to fetch data:', err);
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
        (g: { images: GenerationImage[] }) => g.images || []
      );
      setRecentImages(allImages);
      setHeroPage(0);
    } catch (err) {
      console.error('[StudioRemixTab] Failed to fetch persona images:', err);
    }
  }

  useEffect(() => {
    if (!currentPersona) return;
    fetchPersonaImages(currentPersona.name);
    // Clear selections on persona change
    setSelectedImage(null);
    clearHeroUpload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPersona]);

  // ─── Consume pending remix image from cross-tab navigation ─────
  useEffect(() => {
    if (!pendingRemixImage) return;
    setSelectedImage(pendingRemixImage);
    setHeroSource('grid');
    setHeroImagePreview(null);
    setHeroImageBase64(null);
    onRemixImageConsumed?.();
  }, [pendingRemixImage, onRemixImageConsumed]);

  // ─── Refetch remixes helper ─────────────────────────────

  async function refetchRemixes() {
    try {
      const res = await fetch('/api/remix?limit=15');
      const data = await res.json();
      setRemixResults(data.remixes || []);
    } catch (err) {
      console.error('[StudioRemixTab] Failed to refetch remixes:', err);
    }
  }

  // ─── Fire-and-forget remix ─────────────────────────────

  function handleRemix() {
    const heroUrl = heroSource === 'upload' && heroImageBase64
      ? `data:image/jpeg;base64,${heroImageBase64}`
      : selectedImage;

    if (!heroUrl || !remixPrompt.trim() || !currentPersona) return;
    const runningCount = activeJobs.filter(j => j.status === 'running').length;
    if (runningCount >= 5) return;

    // Snapshot form values
    const jobId = crypto.randomUUID();
    const snapshot = {
      heroImageUrl: heroUrl,
      remixPrompt: remixPrompt.trim(),
      persona: currentPersona.name,
      model: imageModels.find(m => m.id === selectedModel)?.name || selectedModel,
      numImages: loraChar ? Math.min(numImages, 4) : numImages,
      enhancePrompt,
      resolution: isNanobananaModel && !loraChar ? resolution : undefined,
      aspectRatio,
      params: loraChar ? {} : resolveParams(modelFields, modelParams, ['aspect_ratio', 'resolution']),
      // LoRA picked: it renders. Image model picked: her LoRA stills (hybrid) or her reference photos.
      useCharacter: !!loraChar || (readyChars.length > 0 && identity === 'hybrid'),
      sceneEngine: (loraChar ? 'lora' : identityBody(identity).sceneEngine) as 'lora' | 'nano',
      characterId: loraChar?.id || (identity === 'hybrid' ? currentPersona.activeCharacterId || readyChars[0]?.id : undefined) || undefined,
    };

    // Create active job card
    addJob({
      id: jobId,
      type: 'remix',
      status: 'running',
      persona: snapshot.persona,
      model: snapshot.model,
      numImages: snapshot.numImages,
      notes: snapshot.remixPrompt,
      progress: 2,
      stage: 'Starting...',
      streamedImages: [],
      startedAt: Date.now(),
    });

    // Clear prompt only — keep hero image selected for quick re-remix
    setRemixPrompt('');

    // Fire and forget
    runRemix(jobId, snapshot);
  }

  async function runRemix(jobId: string, snapshot: {
    heroImageUrl: string;
    remixPrompt: string;
    persona: string;
    model: string;
    numImages: number;
    enhancePrompt: boolean;
    resolution?: '1k' | '2k' | '4k';
    aspectRatio: string;
    params?: Record<string, unknown>;
    useCharacter?: boolean;
    sceneEngine?: 'lora' | 'nano';
    characterId?: string;
  }) {
    const midBumpTimer = setTimeout(() => {
      updateJob(jobId, { progress: 50, stage: 'Generating variations — this takes a bit...' });
    }, 10000);

    try {
      updateJob(jobId, { progress: 5, stage: 'Calling API...' });

      const res = await fetch('/api/remix', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          heroImageUrl: snapshot.heroImageUrl,
          remixPrompt: snapshot.remixPrompt,
          persona: snapshot.persona,
          imageModel: snapshot.model,
          numImages: snapshot.numImages,
          enhancePrompt: snapshot.enhancePrompt,
          resolution: snapshot.resolution,
          aspectRatio: snapshot.aspectRatio,
          params: snapshot.params,
          useCharacter: snapshot.useCharacter,
          sceneEngine: snapshot.sceneEngine,
          characterId: snapshot.characterId,
        }),
      });

      clearTimeout(midBumpTimer);
      const isStream = res.headers.get('Content-Type')?.includes('text/event-stream');

      if (isStream) {
        // SSE path (Nanobanana)
        updateJob(jobId, { progress: 15, stage: 'Connected...' });
        let streamDone = false;

        await readSSEStream(res, {
          onImage: (url, index, total) => {
            const pct = 15 + ((index + 1) / total) * 80;
            appendImage(jobId, url, pct, `Image ${index + 1} of ${total} done`);
          },
          onProgress: (stage) => {
            updateJob(jobId, { stage });
          },
          onDone: (data) => {
            streamDone = true;
            updateJob(jobId, {
              status: 'done',
              progress: 100,
              stage: 'Done!',
              resultName: data.name,
              resultRecordId: data.recordId,
              imageCount: data.imageCount,
              failedCount: data.failedCount,
              elapsed: data.elapsed,
            });
          },
          onError: (message) => {
            console.warn('[StudioRemixTab] SSE error:', message);
            streamDone = true; // treat as stream complete so job doesn't hang
            updateJob(jobId, { status: 'error', errorMessage: message });
            addToast(`Remix failed: ${message}`, 'error');
            setTimeout(() => removeJob(jobId), 10000);
          },
        });

        if (streamDone) {
          await finalizeRemixJob(jobId);
        } else {
          updateJob(jobId, { status: 'error', errorMessage: 'Stream ended without completion' });
          setTimeout(() => removeJob(jobId), 10000);
        }
      } else if (res.ok) {
        // Non-streaming path (Seedream)
        const data = await res.json();
        updateJob(jobId, {
          status: 'done',
          progress: 100,
          stage: 'Done!',
          resultName: data.name,
          resultRecordId: data.recordId,
          imageCount: data.imageCount,
          failedCount: data.failedCount,
          elapsed: data.elapsed,
        });
        await finalizeRemixJob(jobId);
      } else {
        const err = await res.json().catch(() => ({}));
        updateJob(jobId, {
          status: 'error',
          errorMessage: err.error || `Remix failed (${res.status})`,
        });
        addToast(`Remix failed: ${err.error || 'Error ' + res.status}`, 'error');
        setTimeout(() => removeJob(jobId), 10000);
      }
    } catch (err) {
      clearTimeout(midBumpTimer);
      updateJob(jobId, {
        status: 'error',
        errorMessage: err instanceof Error ? err.message : 'Network error',
      });
      addToast(`Remix failed: ${err instanceof Error ? err.message : 'Network error'}`, 'error');
      setTimeout(() => removeJob(jobId), 10000);
    }
  }

  async function finalizeRemixJob(jobId: string) {
    await new Promise(resolve => setTimeout(resolve, 2500));
    await refetchRemixes();
    removeJob(jobId);
  }

  // ─── Get image display URL helper ──────────────────────

  function imgUrl(img: GenerationImage | RemixVariant): string {
    return img.thumbnails?.large?.url || img.url;
  }

  // ─── Derived ────────────────────────────────────────────

  const doneRemixes = remixResults.filter(r => r.variants.length > 0).slice(0, 15);
  const flatRemixImages = useMemo(() =>
    doneRemixes.flatMap(remix =>
      remix.variants.map((variant, idx) => ({
        url: variant.url,
        thumbnail: variant.thumbnails?.large?.url || variant.url,
        filename: variant.filename || `remix_${idx + 1}.jpg`,
        remixId: remix.id,
        remixName: remix.name || `remix_${remix.id.slice(-6)}`,
        imageIndex: idx,
        persona: remix.persona,
        model: remix.imageModel,
        prompt: remix.remixPrompt,
        createdAt: remix.createdAt,
        heroImage: remix.heroImage || undefined,
        allThumbnails: remix.variants.map(v => v.thumbnails?.large?.url || v.url),
      }))
    ),
    [doneRemixes]
  );
  const hasHero = (heroSource === 'upload' && heroImagePreview) || (heroSource === 'grid' && selectedImage) || selectedImage;

  // Total result count
  const totalResultCount = flatRemixImages.length + activeJobs.filter(j => j.status === 'running').reduce((acc, j) => acc + j.streamedImages.length, 0);

  // IdentityLock persona adapter
  const identityPersonas = useMemo(() =>
    personas.map(p => ({
      id: p.id,
      name: p.name,
      face_ref_url: p.faceRefs?.[0] || undefined,
    })),
    [personas]
  );

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

  // Hero image display URL for the bottom panel thumbnail
  const heroDisplayUrl = heroSource === 'upload' && heroImagePreview
    ? heroImagePreview
    : heroSource === 'grid' && selectedImage
      ? selectedImage
      : selectedImage || null;

  const canSubmitRemix = hasHero && remixPrompt.trim().length > 0 && activeJobs.filter(j => j.status === 'running').length < 5;

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
          className="grid-slider-remix"
          style={{ width: 120, cursor: 'pointer' }}
        />
      </div>
      <style>{`
        .grid-slider-remix {
          -webkit-appearance: none;
          appearance: none;
          height: 3px;
          background: #e0e0e0;
          border-radius: 2px;
          outline: none;
        }
        .grid-slider-remix::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 14px;
          height: 14px;
          border-radius: 50%;
          background: #fff;
          box-shadow: 0 1px 4px rgba(0,0,0,0.2), 0 0 0 1px rgba(0,0,0,0.06);
          cursor: pointer;
        }
        .grid-slider-remix::-moz-range-thumb {
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

        {/* Results grid — full width, with active jobs inline */}
        {(flatRemixImages.length > 0 || activeJobs.some(j => j.status === 'running')) ? (
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${gridColumns}, 1fr)`, gap: 8 }}>
            {/* Active job streamed images + skeleton placeholders */}
            {activeJobs.filter(j => j.status === 'running').flatMap(job => {
              const items: React.ReactNode[] = [];
              // Streamed images (already generated)
              job.streamedImages.forEach((url, idx) => {
                items.push(
                  <div
                    key={`job-${job.id}-img-${idx}`}
                    className="relative overflow-hidden fade-in cursor-pointer"
                    style={{ aspectRatio: '2/3', borderRadius: 12, border: '1px solid var(--color-border)' }}
                    onClick={() => setLightbox({
                      images: job.streamedImages.map((u, i) => ({ url: u, label: `Remixing #${i + 1}` })),
                      index: idx,
                    })}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={url} alt={`Remixing ${idx + 1}`} className="w-full h-full object-cover" />
                  </div>
                );
              });
              // Skeleton placeholders for remaining
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
                    {/* Shimmer sweep */}
                    <div style={{
                      position: 'absolute',
                      inset: 0,
                      background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.04) 50%, transparent 100%)',
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
                      <svg width="20" height="20" viewBox="0 0 48 48" style={{ animation: 'spinPulse 3s ease-in-out infinite', flexShrink: 0 }}>
                        <defs>
                          <linearGradient id={`remixGrad-${job.id}-${idx}`} x1="0%" y1="0%" x2="100%" y2="100%">
                            <stop offset="0%" stopColor="#1D4ED8"/>
                            <stop offset="100%" stopColor="#60A5FA"/>
                          </linearGradient>
                        </defs>
                        <polygon points="24,4 42,14 42,34 24,44 6,34 6,14" fill={`url(#remixGrad-${job.id}-${idx})`}/>
                        <circle cx="24" cy="24" r="9" fill="white"/>
                      </svg>
                      <span className="shimmer-text" style={{ fontSize: 14, fontWeight: 600, letterSpacing: '0.02em' }}>
                        {stageLabel}
                      </span>
                    </div>
                  </div>
                );
              }
              return items;
            })}
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
              .ref-img-wrapper:hover .ref-img-remove {
                opacity: 1 !important;
              }
              .panel-tooltip {
                position: relative;
              }
              .panel-tooltip .panel-tooltip-text {
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
              .panel-tooltip .panel-tooltip-text .tt-sub {
                display: block;
                font-size: 9px;
                font-weight: 400;
                color: rgba(255,255,255,0.55);
              }
              .panel-tooltip:hover .panel-tooltip-text {
                opacity: 1;
                transition-delay: 0.35s;
              }
            `}</style>
            {flatRemixImages.map((img, i) => (
              <div
                key={`${img.remixId}-${img.imageIndex}`}
                className="group"
                style={{
                  aspectRatio: '2/3',
                  borderRadius: 12,
                  overflow: 'hidden',
                  position: 'relative',
                  cursor: 'pointer',
                  opacity: deleting.has(img.url) ? 0.4 : 1,
                  transition: 'opacity 200ms',
                }}
                onClick={() => setLightbox({
                  images: flatRemixImages.map(fi => ({ url: fi.url, label: `${fi.remixName} #${fi.imageIndex + 1}` })),
                  index: i,
                  meta: flatRemixImages.map(fi => ({ remixId: fi.remixId, remixName: fi.remixName, filename: fi.filename })),
                })}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={img.thumbnail}
                  alt={`${img.remixName} #${img.imageIndex + 1}`}
                  style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                />
                {/* Hover overlay */}
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-all duration-200 flex items-end">
                  {/* Expand icon — top right */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setLightbox({
                        images: flatRemixImages.map(fi => ({ url: fi.url, label: `${fi.remixName} #${fi.imageIndex + 1}` })),
                        index: i,
                        meta: flatRemixImages.map(fi => ({ remixId: fi.remixId, remixName: fi.remixName, filename: fi.filename })),
                      });
                    }}
                    className="absolute top-2 right-2 w-7 h-7 rounded-lg flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    style={{ background: 'rgba(0,0,0,0.5)' }}
                  >
                    <Maximize2 size={12} color="#fff" />
                  </button>
                  {/* Bottom action bar */}
                  <div className="w-full p-2 translate-y-full group-hover:translate-y-0 transition-transform duration-200">
                    <div className="flex gap-1.5">
                      <button
                        onClick={(e) => { e.stopPropagation(); setSelectedImage(img.url); setHeroSource('grid'); setHeroImagePreview(null); setHeroImageBase64(null); }}
                        className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg text-[10px] font-medium backdrop-blur-sm"
                        style={{ background: 'rgba(255,255,255,0.15)', color: 'white' }}
                      >
                        <Shuffle size={10} />
                        Remix
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDownload(img.url, img.filename); }}
                        className="py-1.5 px-2 rounded-lg backdrop-blur-sm"
                        style={{ background: 'rgba(255,255,255,0.15)', color: 'white' }}
                        title="Download"
                      >
                        <Download size={11} />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDeleteImage(img.remixId, img.url); }}
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
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#ccc" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: 12 }}>
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" />
            </svg>
            <p style={{ fontSize: 13, fontWeight: 500, color: '#888', marginBottom: 4 }}>No remixes yet</p>
            <p style={{ fontSize: 12, color: '#bbb' }}>Select a hero image and describe what to change</p>
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
        {/* ── LEFT COLUMN: Identity + Hero ── */}
        <div style={{ padding: '16px 16px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          {/* Identity: selected persona (clickable to swap) */}
          <div ref={personaPickerRef} style={{ display: 'flex', gap: 6, flexShrink: 0, position: 'relative' }}>
            {(() => {
              const selected = identityPersonas.find(p => p.id === selectedPersona);
              if (!selected) return null;
              return (
                <div className="panel-tooltip" style={{ flexShrink: 0 }}>
                  <span className="panel-tooltip-text">Identity to insert</span>
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
                <button
                  onClick={() => { setSelectedPersona(''); setShowPersonaPicker(false); }}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '10px 14px', border: 'none', background: !selectedPersona ? 'var(--color-bg-tertiary)' : 'transparent', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--color-bg-tertiary)'; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = !selectedPersona ? 'var(--color-bg-tertiary)' : 'transparent'; }}
                >
                  <div style={{ width: 32, height: 40, borderRadius: 8, background: '#f0f0f0', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <XIcon size={12} color="#bbb" />
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 500, color: '#666' }}>None</div>
                  {!selectedPersona && <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ marginLeft: 'auto' }}><path d="M3 8.5L6.5 12L13 4" stroke="#16A34A" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                </button>
                {identityPersonas.map(persona => {
                  const isSelected = persona.id === selectedPersona;
                  return (
                    <button
                      key={persona.id}
                      onClick={() => { setSelectedPersona(persona.id); setShowPersonaPicker(false); }}
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

          {/* Hero image slot */}
          <div className="ref-img-wrapper panel-tooltip" style={{ position: 'relative', width: 100, height: 140, flexShrink: 0 }}>
            <span className="panel-tooltip-text">Target Image</span>
            <div
              onClick={() => { if (!heroDisplayUrl) fileInputRef.current?.click(); }}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                const remixImageUrl = e.dataTransfer.getData('text/x-remix-image');
                if (remixImageUrl) {
                  setSelectedImage(remixImageUrl);
                  setHeroSource('grid');
                  if (heroImagePreview) URL.revokeObjectURL(heroImagePreview);
                  setHeroImagePreview(null);
                  setHeroImageBase64(null);
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
                border: heroDisplayUrl ? '2px solid #3B82F6' : dragOver ? '2px dashed #1E40AF' : '1.5px dashed #d1d5db',
                background: heroDisplayUrl ? '#e5e7eb' : dragOver ? 'rgba(59,130,246,0.04)' : 'transparent',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'border-color 150ms, background 150ms',
              }}
            >
              {heroDisplayUrl ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={heroDisplayUrl} alt="Hero" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
                </>
              ) : (
                <>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#bbb" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                  <span style={{ fontSize: 8, color: '#bbb', fontWeight: 600, marginTop: 2 }}>Hero</span>
                </>
              )}
            </div>
            {heroDisplayUrl && (
              <button
                className="ref-img-remove"
                onClick={(e) => { e.stopPropagation(); setSelectedImage(null); setHeroSource(null); clearHeroUpload(); }}
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

        {/* ── MIDDLE COLUMN: Prompt + Controls ── */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: '18px 0 12px' }}>
          {/* Prompt row */}
          <div style={{ padding: '0 14px 8px', flex: 1, display: 'flex', flexDirection: 'column' }}>
          <textarea
            value={remixPrompt}
            onChange={(e) => setRemixPrompt(e.target.value)}
            onFocus={() => setPromptFocused(true)}
            onBlur={() => setPromptFocused(false)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && canSubmitRemix) {
                e.preventDefault();
                handleRemix();
              }
            }}
            placeholder="Describe what to change..."
            rows={3}
            style={{
              display: 'block',
              width: '100%',
              flex: 1,
              border: '1px solid',
              borderColor: promptFocused ? 'rgba(59,130,246,0.5)' : 'var(--color-border)',
              boxShadow: promptFocused ? '0 0 0 3px rgba(59,130,246,0.08)' : 'none',
              borderRadius: 10,
              outline: 'none',
              background: 'var(--color-bg-surface)',
              padding: '8px 12px',
              fontSize: 13,
              fontFamily: 'inherit',
              lineHeight: 1.5,
              color: 'var(--color-text-primary)',
              resize: 'none',
              transition: 'border-color 150ms, box-shadow 150ms',
            }}
          />
        </div>

        {/* Controls row */}
        <div style={{ padding: '0 14px', display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>

          {/* Model selector */}
          <div ref={modelDropdownRef} style={{ position: 'relative', flexShrink: 0 }}>
            <button
              type="button"
              onClick={() => { setShowModelDropdown(!showModelDropdown); setShowCountDropdown(false); setShowAspectDropdown(false); setShowResDropdown(false); }}
              style={{ padding: '5px 12px', borderRadius: 10, fontSize: 12, fontWeight: 500, border: '1px solid #e5e7eb', background: 'var(--color-bg-surface)', color: '#555', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'inherit', whiteSpace: 'nowrap' }}
            >
              <div style={{ width: 16, height: 16, borderRadius: 4, background: loraChar ? '#16A34A' : (currentModel?.iconColor || '#999'), display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, fontWeight: 700, color: '#fff' }}>{loraChar ? 'L' : currentModel?.iconLabel}</div>
              {loraChar ? `${loraChar.name.split(' (')[0]} · LoRA` : (currentModel?.name || 'Model')}
              <ChevronDown size={11} />
            </button>
            {showModelDropdown && (
              <div style={{ position: 'absolute', bottom: '100%', left: 0, marginBottom: 6, background: '#fff', border: '1px solid var(--color-border)', borderRadius: 14, boxShadow: '0 8px 24px rgba(0,0,0,0.12)', overflow: 'hidden', zIndex: 50, width: 280, maxHeight: 'min(70vh, 560px)', overflowY: 'auto' }}>
                {readyChars.length > 0 && (
                  <>
                    <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: 0.5, textTransform: 'uppercase', color: 'var(--color-text-tertiary)', padding: '10px 14px 4px' }}>Trained character (LoRA)</div>
                    {readyChars.map(c => (
                      <button key={c.id} type="button" onClick={() => { setLoraCharId(c.id); setShowModelDropdown(false); }}
                        style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '10px 14px', border: 'none', background: c.id === loraCharId ? 'var(--color-bg-tertiary)' : 'transparent', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}>
                        <div style={{ width: 28, height: 28, borderRadius: 8, background: '#16A34A', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, color: '#fff', flexShrink: 0 }}>L</div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-primary)' }}>{c.name}</div>
                          <div style={{ fontSize: 11, color: '#999', marginTop: 1 }}>Her LoRA renders the image{c.id === currentPersona?.activeCharacterId ? ' · active version' : ''}</div>
                        </div>
                        {c.id === loraCharId && <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 8.5L6.5 12L13 4" stroke="#16A34A" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                      </button>
                    ))}
                    <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: 0.5, textTransform: 'uppercase', color: 'var(--color-text-tertiary)', padding: '10px 14px 4px', borderTop: '1px solid var(--color-border)' }}>Image models</div>
                  </>
                )}
                {imageModels.map(m => (
                  <button
                    key={m.id}
                    onClick={() => { setSelectedModel(m.id); setLoraCharId(null); setShowModelDropdown(false); }}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '10px 14px', border: 'none', background: m.id === selectedModel && !loraChar ? 'var(--color-bg-tertiary)' : 'transparent', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--color-bg-tertiary)'; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = m.id === selectedModel && !loraChar ? 'var(--color-bg-tertiary)' : 'transparent'; }}
                  >
                    <div style={{ width: 28, height: 28, borderRadius: 8, background: m.iconColor, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, color: '#fff', flexShrink: 0 }}>{m.iconLabel}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-primary)' }}>{m.name}</div>
                      <div style={{ fontSize: 11, color: '#999', marginTop: 1 }}>{m.description}</div>
                    </div>
                    {m.id === selectedModel && !loraChar && <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 8.5L6.5 12L13 4" stroke="#16A34A" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Aspect Ratio selector */}
          <div ref={aspectDropdownRef} style={{ position: 'relative', flexShrink: 0 }}>
            <button
              type="button"
              onClick={() => { setShowAspectDropdown(!showAspectDropdown); setShowModelDropdown(false); setShowCountDropdown(false); setShowResDropdown(false); }}
              style={{ padding: '5px 12px', borderRadius: 10, fontSize: 12, fontWeight: 500, border: '1px solid #e5e7eb', background: 'var(--color-bg-surface)', color: '#555', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5, fontFamily: 'inherit', whiteSpace: 'nowrap' }}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="3" y="1" width="8" height="12" rx="1.5" stroke="#888" strokeWidth="1.2" fill="none"/></svg>
              {aspectRatio}
              <ChevronDown size={11} />
            </button>
            {showAspectDropdown && (
              <div style={{ position: 'absolute', bottom: '100%', left: 0, marginBottom: 6, background: '#fff', border: '1px solid var(--color-border)', borderRadius: 14, boxShadow: '0 8px 24px rgba(0,0,0,0.12)', zIndex: 50, width: 280, padding: '12px' }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#999', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>Aspect ratio</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 6 }}>
                  {ASPECT_RATIO_OPTIONS.map(ar => {
                    const isSelected = ar.value === aspectRatio;
                    const maxDim = 28;
                    const scale = maxDim / Math.max(ar.w, ar.h);
                    const rw = Math.round(ar.w * scale);
                    const rh = Math.round(ar.h * scale);
                    return (
                      <button
                        key={ar.value}
                        onClick={() => { setAspectRatio(ar.value); setShowAspectDropdown(false); }}
                        style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, padding: '8px 4px', border: isSelected ? '1.5px solid #1E40AF' : '1.5px solid transparent', borderRadius: 10, background: isSelected ? '#EFF6FF' : 'transparent', cursor: 'pointer', fontFamily: 'inherit' }}
                        onMouseEnter={(e) => { if (!isSelected) (e.currentTarget as HTMLButtonElement).style.background = 'var(--color-bg-tertiary)'; }}
                        onMouseLeave={(e) => { if (!isSelected) (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
                      >
                        <div style={{ width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <div style={{ width: rw, height: rh, borderRadius: 3, border: `1.5px solid ${isSelected ? '#1E40AF' : '#ccc'}`, background: isSelected ? '#DBEAFE' : '#f5f5f5' }} />
                        </div>
                        <span style={{ fontSize: 10, fontWeight: isSelected ? 600 : 400, color: isSelected ? '#1E40AF' : '#666' }}>{ar.value}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Resolution dropdown (Nanobanana only) */}
          {isNanobananaModel && !loraChar && (
            <div ref={resDropdownRef} style={{ position: 'relative', flexShrink: 0 }}>
              <button
                type="button"
                onClick={() => { setShowResDropdown(!showResDropdown); setShowModelDropdown(false); setShowCountDropdown(false); setShowAspectDropdown(false); }}
                style={{ padding: '5px 12px', borderRadius: 10, fontSize: 12, fontWeight: 500, border: '1px solid #e5e7eb', background: 'var(--color-bg-surface)', color: '#555', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5, fontFamily: 'inherit', whiteSpace: 'nowrap' }}
              >
                {resolution.toUpperCase()}
                <ChevronDown size={11} />
              </button>
              {showResDropdown && (
                <div style={{ position: 'absolute', bottom: '100%', left: 0, marginBottom: 6, background: '#fff', border: '1px solid var(--color-border)', borderRadius: 10, boxShadow: '0 4px 16px rgba(0,0,0,0.10)', overflow: 'hidden', zIndex: 50, minWidth: 80 }}>
                  {(['1k', '2k', '4k'] as const).map(r => (
                    <button key={r} onClick={() => { setResolution(r); setShowResDropdown(false); }} style={{ display: 'block', width: '100%', padding: '8px 14px', fontSize: 12, textAlign: 'left', border: 'none', background: r === resolution ? 'var(--color-bg-surface)' : 'transparent', fontWeight: r === resolution ? 600 : 400, color: 'var(--color-text-primary)', cursor: 'pointer', fontFamily: 'inherit' }}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--color-bg-surface)'; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = r === resolution ? 'var(--color-bg-surface)' : 'transparent'; }}
                    >{r.toUpperCase()}</button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Image count stepper */}
          <div className="panel-tooltip" style={{ display: 'flex', alignItems: 'center', border: '1px solid #e5e7eb', borderRadius: 10, overflow: 'hidden', flexShrink: 0 }}>
            <span className="panel-tooltip-text">Batch size</span>
            <button type="button" onClick={() => setNumImages(Math.max(1, numImages - 1))} disabled={numImages <= 1} style={{ width: 28, height: 28, border: 'none', background: 'var(--color-bg-surface)', cursor: numImages <= 1 ? 'not-allowed' : 'pointer', opacity: numImages <= 1 ? 0.3 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, color: '#555', fontFamily: 'inherit' }}>−</button>
            <span style={{ width: 24, textAlign: 'center', fontSize: 12, fontWeight: 600, color: '#333' }}>{numImages}</span>
            <button type="button" onClick={() => setNumImages(Math.min(currentModel?.maxImages || 4, numImages + 1))} disabled={numImages >= (currentModel?.maxImages || 4)} style={{ width: 28, height: 28, border: 'none', background: 'var(--color-bg-surface)', cursor: numImages >= (currentModel?.maxImages || 4) ? 'not-allowed' : 'pointer', opacity: numImages >= (currentModel?.maxImages || 4) ? 0.3 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, color: '#555', fontFamily: 'inherit' }}>+</button>
          </div>

          {!loraChar && <ModelSettings fields={modelFields} values={modelParams} onChange={setModelParams} hide={['aspect_ratio', 'resolution']} />}
          {!loraChar && readyChars.length > 0 && <IdentityChip value={identity === 'lora' ? 'hybrid' : identity} onChange={setIdentity} modes={['hybrid', 'refs']} />}

          {/* NSFW toggle (Seedream only) */}
          {!isNanobananaModel && !loraChar && (
            <button type="button" onClick={() => setNsfw(!nsfw)} style={{ padding: '5px 12px', borderRadius: 10, fontSize: 12, fontWeight: 500, border: '1px solid #e5e7eb', background: 'var(--color-bg-surface)', color: nsfw ? 'var(--color-error, #dc3545)' : '#555', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5, fontFamily: 'inherit', whiteSpace: 'nowrap', flexShrink: 0 }}>
              <div style={{ width: 22, height: 12, borderRadius: 6, background: nsfw ? 'var(--color-error, #dc3545)' : '#ddd', position: 'relative', transition: 'background 150ms' }}>
                <div style={{ position: 'absolute', top: 1.5, left: nsfw ? 11.5 : 1.5, width: 9, height: 9, borderRadius: '50%', background: '#fff', transition: 'left 150ms' }} />
              </div>
              NSFW
            </button>
          )}

          {/* Enhance with AI toggle */}
          <button type="button" onClick={() => setEnhancePrompt(!enhancePrompt)} style={{ padding: '5px 12px', borderRadius: 10, fontSize: 12, fontWeight: 500, border: '1px solid #e5e7eb', background: 'var(--color-bg-surface)', color: enhancePrompt ? '#1D4ED8' : '#555', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5, fontFamily: 'inherit', whiteSpace: 'nowrap', flexShrink: 0 }}>
            <div style={{ width: 22, height: 12, borderRadius: 6, background: enhancePrompt ? '#1D4ED8' : '#ddd', position: 'relative', transition: 'background 150ms' }}>
              <div style={{ position: 'absolute', top: 1.5, left: enhancePrompt ? 11.5 : 1.5, width: 9, height: 9, borderRadius: '50%', background: '#fff', transition: 'left 150ms' }} />
            </div>
            AI Enhance
          </button>

        </div>
        </div>

        {/* ── RIGHT COLUMN: Remix button ── */}
        <div style={{ padding: '24px 18px', display: 'flex', alignItems: 'center', flexShrink: 0 }}>
          <button
            type="button"
            onClick={() => { if (canSubmitRemix) handleRemix(); }}
            disabled={!canSubmitRemix}
            style={{
              padding: '14px 24px',
              borderRadius: 14,
              background: 'linear-gradient(135deg, #1D4ED8, #60A5FA)',
              color: '#fff',
              fontWeight: 600,
              fontSize: 14,
              border: 'none',
              cursor: canSubmitRemix ? 'pointer' : 'not-allowed',
              opacity: canSubmitRemix ? 1 : 0.5,
              transition: 'transform 150ms, opacity 150ms',
              fontFamily: 'inherit',
              whiteSpace: 'nowrap',
              boxShadow: '0 2px 10px rgba(96,165,250,0.3)',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
            onMouseEnter={(e) => { if (canSubmitRemix) (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1.03)'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1)'; }}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M8 2L9.5 6.5L14 8L9.5 9.5L8 14L6.5 9.5L2 8L6.5 6.5L8 2Z" fill="white"/></svg>
            Remix
          </button>
        </div>
      </div>

      {/* Lightbox */}
      {lightbox && (() => {
        const currentFlat = flatRemixImages[lightbox.index];
        const currentPersona = personas.find(p => p.name === currentFlat?.persona);
        const modelInfo = imageModels.find(m => m.id === currentFlat?.model || m.name === currentFlat?.model);
        const genMeta: GenerationMeta | undefined = currentFlat ? {
          personaName: currentFlat.persona,
          personaAvatar: currentPersona?.faceRefs?.[0],
          genName: currentFlat.remixName,
          feature: 'Image Remix',
          model: modelInfo?.name || currentFlat.model || undefined,
          quality: currentFlat.model?.includes('nanobanana') ? '4K' : '2K',
          createdAt: currentFlat.createdAt,
          prompt: currentFlat.prompt,
          refImage: currentFlat.heroImage || heroImagePreview || selectedImage || undefined,
          outputThumbnails: currentFlat.allThumbnails,
        } : undefined;
        return (
          <ImageLightbox
            images={lightbox.images}
            initialIndex={lightbox.index}
            onClose={() => setLightbox(null)}
            generationMeta={genMeta}
            imageMeta={lightbox.meta?.map(m => {
              const remix = remixResults.find(r => r.id === m.remixId);
              return { starred: remix?.starred || false };
            })}
            actions={{
              onStar: (i) => {
                const m = lightbox.meta?.[i];
                if (m) handleToggleStar(m.remixId);
              },
              onRemix: (i) => {
                const url = lightbox.images[i]?.url;
                if (url) { setHeroImagePreview(url); setHeroSource('grid'); setSelectedImage(url); }
              },
              onCarouselImage: onSendToCarousel ? (i) => {
                const url = lightbox.images[i]?.url;
                if (url) onSendToCarousel(url);
              } : undefined,
              onDownload: (i) => {
                const url = lightbox.images[i]?.url;
                const m = lightbox.meta?.[i];
                if (url) handleDownload(url, m?.filename || `remix_${i + 1}.jpg`);
              },
              onDelete: (i) => {
                const url = lightbox.images[i]?.url;
                const m = lightbox.meta?.[i];
                if (url && m) { handleDeleteImage(m.remixId, url); setLightbox(null); }
              },
            }}
          />
        );
      })()}

      {/* Close dropdowns on outside click */}
      {(showModelDropdown || showCountDropdown || showAspectDropdown || showResDropdown || showPersonaPicker) && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 15 }}
          onClick={() => { setShowModelDropdown(false); setShowCountDropdown(false); setShowAspectDropdown(false); setShowResDropdown(false); setShowPersonaPicker(false); }}
        />
      )}
    </div>
  );
}
