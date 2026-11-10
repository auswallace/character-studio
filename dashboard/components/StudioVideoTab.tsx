'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useActiveJobsContext } from '@/contexts/ActiveJobsContext';
import { readSSEStream } from '@/lib/sse';
import ActiveJobCard from './ActiveJobCard';
import { useToast } from './Toast';
import { VIDEO_MODELS, VIDEO_MODEL_NAMES, type VideoModelId } from '@/lib/video-providers/types';
import ImageLightbox, { type LightboxImage, type GenerationMeta } from './ImageLightbox';
import { ChevronDown, History, Image, Plus, Video, User, Sun, Star, Trash2, Maximize2, Volume2, VolumeX, X, Clapperboard, Camera, Aperture, Bookmark } from 'lucide-react';
import { SettingsChip, ChipOption, ChipSection } from './SettingsChip';
import { familyFor, assemblePrompt, CAMERA_MOVES, LENSES, WAN_REALISM, DRY_VOICE, realismPrompt, ANIMATE_SHARP } from '@/lib/video-presets';

// Models the Realism chip applies to. Veo: same phone-footage wording, plus the dry phone-mic voice when audio is on.
const REALISM_MODELS: string[] = [VIDEO_MODELS.WAN_2_2, VIDEO_MODELS.VEO_3_1];
import type { VideoPreset } from '@/app/api/presets/route';

// ─── TypeScript Interfaces ────────────────────────────────

interface Persona {
  id: string;
  name: string;
}

interface VideoOutput {
  id: string;
  url: string;
  thumbnailUrl: string | null;
  durationSeconds: number | null;
  hasAudio: boolean;
  fileSize: number | null;
}

interface VideoGeneration {
  id: string;
  name: string;
  personaId: string | null;
  videoModel: string;
  videoMode: string;
  prompt: string | null;
  sourceImageUrl: string | null;
  duration: number;
  aspectRatio: string;
  resolution: string;
  generateAudio: boolean;
  modelParams?: {
    cfgScale?: number;
    cameraFixed?: boolean;
    characterOrientation?: 'image' | 'video';
    seed?: number;
  };
  status: string;
  starred: boolean;
  createdAt: string;
  outputs: VideoOutput[];
}

// ─── Video Model Definitions ──────────────────────────────

interface VideoModelDef {
  id: VideoModelId;
  name: string;
  dotColor: string;
  costLabel: string;
  desc: string;
  mode: 'photo' | 'copy';   // photo = start from a still and describe it; copy = follow a motion video
  proven?: boolean;         // a real paid run finished after the Nov 2026 rebuild
}

// 2026-11-10: only proven models show in the menu. Set to true to see every model again.
const SHOW_UNPROVEN_VIDEO_MODELS = false;

const videoModels: VideoModelDef[] = [
  { id: VIDEO_MODELS.KLING_V3, name: 'Kling v3.0', dotColor: '#16A34A', costLabel: '~$1.12', desc: 'Image-to-video, CFG control', mode: 'photo' },
  { id: VIDEO_MODELS.KLING_O3, name: 'Kling O3 Omni', dotColor: '#0D9488', costLabel: '~$0.70', desc: 'Native audio + dialogue, 3-15s', mode: 'photo' },
  { id: VIDEO_MODELS.KLING_MOTION, name: 'Kling Motion', dotColor: '#06B6D4', costLabel: '~$0.56', desc: 'Motion transfer from ref', mode: 'copy' },
  { id: VIDEO_MODELS.WAN_ANIMATE, name: 'Wan Animate', dotColor: '#EA580C', costLabel: '$0.08/s', desc: 'Copy motion: your video drives her still. 720p, sound optional', mode: 'copy', proven: true },
  { id: VIDEO_MODELS.SEEDANCE_1_5, name: 'Seedance 1.5', dotColor: '#8B5CF6', costLabel: '~$0.26', desc: 'Native audio, lip sync', mode: 'photo' },
  { id: VIDEO_MODELS.SEEDANCE_2_0, name: 'Seedance 2.0', dotColor: '#A855F7', costLabel: '~$1.50', desc: 'Cinematic, physics, 15s', mode: 'photo' },
  { id: VIDEO_MODELS.SEEDANCE_2_5, name: 'Seedance 2.5', dotColor: '#A855F7', costLabel: 'TBD', desc: 'Single-shot up to 30s, audio', mode: 'photo' },
  { id: VIDEO_MODELS.VEO_3_1, name: 'Veo 3.1', dotColor: '#3B82F6', costLabel: '~$0.80', desc: 'Google cinematic audio', mode: 'photo', proven: true },
  { id: VIDEO_MODELS.GEMINI_OMNI_FLASH, name: 'Gemini Omni Flash', dotColor: '#2563EB', costLabel: '~$1.00', desc: 'Google, synced audio, cheap, 3-10s', mode: 'photo' },
  { id: VIDEO_MODELS.WAN_2_2, name: 'Wan 2.2 (LoRA)', dotColor: '#EA580C', costLabel: '$0.35', desc: 'Open model, takes a LoRA. 720p, 5 or 8s, no audio', mode: 'photo', proven: true },
];

const modelCardVideos: Record<string, string> = {
  [VIDEO_MODELS.KLING_V3]: '/model-cards/kling-v3.mp4',
  [VIDEO_MODELS.KLING_O3]: '/model-cards/kling-v3.mp4', // placeholder
  [VIDEO_MODELS.KLING_MOTION]: '/model-cards/kling-motion.mp4',
  [VIDEO_MODELS.WAN_ANIMATE]: '/model-cards/kling-motion.mp4', // placeholder
  [VIDEO_MODELS.SEEDANCE_1_5]: '/model-cards/seedance-15.mp4',
  [VIDEO_MODELS.SEEDANCE_2_0]: '/model-cards/seedance-20.mp4',
  [VIDEO_MODELS.SEEDANCE_2_5]: '/model-cards/seedance-20.mp4', // placeholder until a 2.5 preview is recorded
  [VIDEO_MODELS.VEO_3_1]: '/model-cards/veo-31.mp4',
  [VIDEO_MODELS.GEMINI_OMNI_FLASH]: '/model-cards/veo-31.mp4', // placeholder
  [VIDEO_MODELS.WAN_2_2]: '/model-cards/seedance-15.mp4', // placeholder
};

// Badge colors per model
const modelBadgeColors: Record<string, { bg: string; text: string }> = {
  [VIDEO_MODELS.KLING_V3]: { bg: 'rgba(22,163,74,0.12)', text: '#16A34A' },
  [VIDEO_MODELS.KLING_O3]: { bg: 'rgba(13,148,136,0.12)', text: '#0D9488' },
  [VIDEO_MODELS.KLING_MOTION]: { bg: 'rgba(6,182,212,0.12)', text: '#06B6D4' },
  [VIDEO_MODELS.WAN_ANIMATE]: { bg: 'rgba(234,88,12,0.12)', text: '#EA580C' },
  [VIDEO_MODELS.SEEDANCE_1_5]: { bg: 'rgba(139,92,246,0.12)', text: '#8B5CF6' },
  [VIDEO_MODELS.SEEDANCE_2_0]: { bg: 'rgba(168,85,247,0.12)', text: '#A855F7' },
  [VIDEO_MODELS.SEEDANCE_2_5]: { bg: 'rgba(168,85,247,0.12)', text: '#A855F7' },
  [VIDEO_MODELS.VEO_3_1]: { bg: 'rgba(59,130,246,0.12)', text: '#3B82F6' },
  [VIDEO_MODELS.GEMINI_OMNI_FLASH]: { bg: 'rgba(37,99,235,0.12)', text: '#2563EB' },
  [VIDEO_MODELS.WAN_2_2]: { bg: 'rgba(234,88,12,0.12)', text: '#EA580C' },
};

// CSS aspect-ratio for a card from the stored '9:16' style string. Cards take the
// video's real shape; a hard 16/9 box cropped portrait clips (first Seedance 2.5 test).
function cardAspect(r?: string | null): string {
  if (!r) return '16/9';
  const m = r.match(/^(\d+):(\d+)$/);
  return m ? `${m[1]}/${m[2]}` : '16/9';
}

// ─── Component ────────────────────────────────────────────

export default function StudioVideoTab() {
  // --- Data state ---
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [recentVideos, setRecentVideos] = useState<VideoGeneration[]>([]);
  const [loading, setLoading] = useState(true);

  // --- Active jobs ---
  const { activeJobs: allActiveJobs, addJob, updateJob, appendVideo, removeJob } = useActiveJobsContext();
  const activeJobs = allActiveJobs.filter(j => j.type === 'video');
  const { addToast } = useToast();

  // --- Form state ---
  const [selectedModel, setSelectedModel] = useState<VideoModelId>(VIDEO_MODELS.VEO_3_1);
  const [prompt, setPrompt] = useState('');
  const [negativePrompt, setNegativePrompt] = useState('');
  const [sourceImageUrl, setSourceImageUrl] = useState('');
  const [sourceImagePreview, setSourceImagePreview] = useState<string | null>(null);
  const [endImageUrl, setEndImageUrl] = useState('');
  const [endImagePreview, setEndImagePreview] = useState<string | null>(null);
  const [referenceVideoUrl, setReferenceVideoUrl] = useState('');
  const [referenceVideoPreview, setReferenceVideoPreview] = useState<string | null>(null);
  const [duration, setDuration] = useState(5);
  const [aspectRatio, setAspectRatio] = useState('9:16');
  const [ratioAuto, setRatioAuto] = useState(true);   // true = follow the start image; false = user override
  const [resolution, setResolution] = useState('1080p');
  const [generateAudio, setGenerateAudio] = useState(true);   // default model is Veo 3.1 (talking clips)
  const [cameraFixed, setCameraFixed] = useState(false);
  const [wanRealism, setWanRealism] = useState(true);   // Realism chip (Wan 2.2, Veo 3.1): phone-footage recipe + default negative prompt; dry voice when audio is on
  const [cfgScale, setCfgScale] = useState(0.5);
  const [seed, setSeed] = useState('');
  const [characterOrientation, setCharacterOrientation] = useState<'image' | 'video'>('image');
  const [keepOriginalSound, setKeepOriginalSound] = useState(true);
  // Copy motion: stills of her in the motion video's first frame (same pose, outfit, framing), made by /api/video/copy-still.
  const [stillPicks, setStillPicks] = useState<{ url: string; score: number | null }[]>([]);
  const [stillBusy, setStillBusy] = useState(false);
  const [refDuration, setRefDuration] = useState(0);   // seconds of the motion video; Wan Animate output is this long
  const [enhance, setEnhance] = useState(false);
  // --- Presets ("Moves") + camera + lens chips ---
  const [presets, setPresets] = useState<VideoPreset[]>([]);
  const [selectedPresetId, setSelectedPresetId] = useState<string>('');
  const [cameraMove, setCameraMove] = useState<string>('');
  const [lens, setLens] = useState<string>('none');
  const [showMoveDropdown, setShowMoveDropdown] = useState(false);
  const [showCameraDropdown, setShowCameraDropdown] = useState(false);
  const [showLensDropdown, setShowLensDropdown] = useState(false);
  const moveDropdownRef = useRef<HTMLDivElement | null>(null);
  const cameraDropdownRef = useRef<HTMLDivElement | null>(null);
  const lensDropdownRef = useRef<HTMLDivElement | null>(null);
  const [enhancing, setEnhancing] = useState(false);
  const [generating, setGenerating] = useState(false);

  // --- Lightbox state ---
  const [lightbox, setLightbox] = useState<{
    images: LightboxImage[];
    index: number;
    meta?: GenerationMeta;
    metas?: GenerationMeta[];
  } | null>(null);

  // --- UI state ---
  const [gridColumns, setGridColumns] = useState(2);
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
  const [gearOpen, setGearOpen] = useState(false);
  const [showDurationDropdown, setShowDurationDropdown] = useState(false);
  const [showRatioDropdown, setShowRatioDropdown] = useState(false);
  const [showResDropdown, setShowResDropdown] = useState(false);
  const [showCfgDropdown, setShowCfgDropdown] = useState(false);
  const [showModeDropdown, setShowModeDropdown] = useState(false);
  const [showAudioDropdown, setShowAudioDropdown] = useState(false);
  const [showCamLockDropdown, setShowCamLockDropdown] = useState(false);
  const [showSoundDropdown, setShowSoundDropdown] = useState(false);
  const startFrameRef = useRef<HTMLInputElement>(null);
  const endFrameRef = useRef<HTMLInputElement>(null);
  const videoUploadRef = useRef<HTMLInputElement>(null);
  const durationDropdownRef = useRef<HTMLDivElement>(null);
  const ratioDropdownRef = useRef<HTMLDivElement>(null);
  const resDropdownRef = useRef<HTMLDivElement>(null);
  const cfgDropdownRef = useRef<HTMLDivElement>(null);
  const modeDropdownRef = useRef<HTMLDivElement>(null);
  const audioDropdownRef = useRef<HTMLDivElement>(null);
  const camLockDropdownRef = useRef<HTMLDivElement>(null);
  const soundDropdownRef = useRef<HTMLDivElement>(null);

  // --- Load data + auto-recover stuck generations ---
  useEffect(() => {
    async function load() {
      try {
        // Auto-recover stuck generations on mount
        fetch('/api/video/recover', { method: 'POST' }).then(res => res.json()).then(data => {
          if (data.recovered > 0) {
            console.log(`[StudioVideoTab] Recovered ${data.recovered} stuck video(s)`);
            // Refresh videos after recovery
            fetch('/api/video?limit=20').then(r => r.json()).then(d => {
              setRecentVideos(d.videos || []);
            });
          }
        }).catch(() => { /* best effort */ });

        const [personaRes, videoRes] = await Promise.all([
          fetch('/api/config'),
          fetch('/api/video?limit=20'),
        ]);
        if (personaRes.ok) {
          const pData = await personaRes.json();
          setPersonas((pData.personas || []).map((p: Record<string, unknown>) => ({ id: p.id, name: p.name })));
        }
        if (videoRes.ok) {
          const vData = await videoRes.json();
          setRecentVideos(vData.videos || []);
        }
      } catch (err) {
        console.error('[StudioVideoTab] Load error:', err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  // --- Refresh videos after generation ---
  const refreshVideos = useCallback(async () => {
    try {
      const res = await fetch('/api/video?limit=20');
      if (res.ok) {
        const data = await res.json();
        setRecentVideos(data.videos || []);
      }
    } catch { /* best effort */ }
  }, []);

  // --- Poll while any video is still generating ---
  // Runs recover (which checks fal/wavespeed for stuck records) + refetches the list
  // every 15s. Effect re-runs when recentVideos changes; cleanup clears the interval
  // once nothing is generating.
  useEffect(() => {
    const hasGenerating = recentVideos.some(v => v.status === 'generating');
    if (!hasGenerating) return;
    const interval = setInterval(async () => {
      try {
        await fetch('/api/video/recover', { method: 'POST' });
        const res = await fetch('/api/video?limit=20');
        if (res.ok) {
          const data = await res.json();
          setRecentVideos(data.videos || []);
        }
      } catch { /* best effort */ }
    }, 15000);
    return () => clearInterval(interval);
  }, [recentVideos]);

  // --- File upload handlers ---
  // Upload to /api/video/upload via FormData, get back a public URL.
  // No base64 in request bodies — production-ready.
  const uploadToStorage = useCallback(async (file: File, type: string): Promise<string> => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('type', type);
    const res = await fetch('/api/video/upload', { method: 'POST', body: formData });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Upload failed' }));
      throw new Error(err.error || `Upload failed: ${res.status}`);
    }
    const data = await res.json();
    return data.url;
  }, []);

  const handleImageUpload = useCallback(async (file: File, setPreview: (v: string | null) => void, setUrl: (v: string) => void, type: string) => {
    // Show local preview immediately
    const localPreview = URL.createObjectURL(file);
    setPreview(localPreview);
    try {
      const publicUrl = await uploadToStorage(file, type);
      setUrl(publicUrl);
      addToast('Image uploaded', 'success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Upload failed';
      addToast(msg, 'error');
      setPreview(null);
    }
  }, [uploadToStorage, addToast]);

  const handleVideoUpload = useCallback(async (file: File) => {
    const localPreview = URL.createObjectURL(file);
    setReferenceVideoPreview(localPreview);
    setStillPicks([]);
    const probe = document.createElement('video'); probe.preload = 'metadata';
    probe.onloadedmetadata = () => { if (Number.isFinite(probe.duration)) setRefDuration(Math.ceil(probe.duration)); };
    probe.src = localPreview;
    try {
      const publicUrl = await uploadToStorage(file, 'reference');
      setReferenceVideoUrl(publicUrl);
      addToast('Video uploaded', 'success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Upload failed';
      addToast(msg, 'error');
      setReferenceVideoPreview(null);
    }
  }, [uploadToStorage, addToast]);

  // Copy motion, step 1: her still from the first frame of the motion video.
  const makeStill = useCallback(async () => {
    if (!referenceVideoUrl || stillBusy) return;
    setStillBusy(true); setStillPicks([]);
    try {
      const res = await fetch('/api/video/copy-still', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ videoUrl: referenceVideoUrl, count: 2 }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setStillPicks(data.stills || []);
      addToast('Pick the still you want', 'success');
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Still failed', 'error');
    } finally { setStillBusy(false); }
  }, [referenceVideoUrl, stillBusy, addToast]);

  // --- AI Enhance prompt ---
  const handleEnhancePrompt = useCallback(async () => {
    if (!prompt.trim() || enhancing) return;
    setEnhancing(true);
    try {
      const res = await fetch('/api/video/enhance-prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, model: selectedModel }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Enhancement failed' }));
        throw new Error(err.error);
      }
      const data = await res.json();
      if (data.enhanced) {
        setPrompt(data.enhanced);
        setEnhance(true);
        addToast('Prompt enhanced', 'success');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Enhancement failed';
      addToast(msg, 'error');
    } finally {
      setEnhancing(false);
    }
  }, [prompt, selectedModel, enhancing, addToast]);

  // --- Clipboard paste support (Cmd+V / Ctrl+V) ---
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        const file = item.getAsFile();
        if (!file) continue;

        if (item.type.startsWith('image/')) {
          // Image paste: source image first, then end frame
          if (!sourceImageUrl) {
            handleImageUpload(file, setSourceImagePreview, setSourceImageUrl, 'source');
          } else if (!endImageUrl) {
            handleImageUpload(file, setEndImagePreview, setEndImageUrl, 'end');
          }
          break;
        }

        if (item.type.startsWith('video/')) {
          // Video paste: for Kling Motion reference video slot
          if ((selectedModel === VIDEO_MODELS.KLING_MOTION || selectedModel === VIDEO_MODELS.WAN_ANIMATE) && !referenceVideoUrl) {
            handleVideoUpload(file);
          }
          break;
        }
      }
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [sourceImageUrl, endImageUrl, referenceVideoUrl, selectedModel, handleImageUpload, handleVideoUpload]);

  // Close model dropdown on outside click
  useEffect(() => {
    if (!modelDropdownOpen) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-model-dropdown]')) {
        setModelDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [modelDropdownOpen]);

  // Close gear popover on outside click
  useEffect(() => {
    if (!gearOpen) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-gear-popover]')) {
        setGearOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [gearOpen]);

  // One card shape for the whole grid: the most common ratio among loaded videos.
  // Videos that differ sit inside it letterboxed over a blurred copy of themselves.
  const dominantRatio = (() => {
    const counts: Record<string, number> = {};
    for (const v of recentVideos) counts[v.aspectRatio || '16/9'] = (counts[v.aspectRatio || '16/9'] || 0) + 1;
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    return top ? top[0] : aspectRatio;
  })();

  // Auto aspect ratio: measure the start image and pick the closest ratio the model supports.
  useEffect(() => {
    const src = sourceImagePreview || sourceImageUrl;
    if (!ratioAuto || !src) return;
    const img = new window.Image();
    img.onload = () => {
      const r = img.naturalWidth / img.naturalHeight;
      const supported = (selectedModel === VIDEO_MODELS.VEO_3_1 || selectedModel === VIDEO_MODELS.GEMINI_OMNI_FLASH)
        ? ['16:9', '9:16'] : ['16:9', '9:16', '1:1'];
      const target: Record<string, number> = { '16:9': 16 / 9, '9:16': 9 / 16, '1:1': 1 };
      const best = supported.reduce((a, b) => Math.abs(target[a] - r) < Math.abs(target[b] - r) ? a : b);
      setAspectRatio(best);
    };
    img.src = src;
  }, [sourceImagePreview, sourceImageUrl, selectedModel, ratioAuto]);

  // Load presets once
  useEffect(() => {
    fetch('/api/presets').then(r => r.ok ? r.json() : { presets: [] }).then(d => setPresets(d.presets || [])).catch(() => { /* table may not exist yet */ });
  }, []);

  // Build the prompt from preset + camera + lens whenever one of them changes
  const applyPreset = useCallback((presetId: string, cam: string, lensId: string, model: string) => {
    const preset = presets.find(p => p.id === presetId);
    if (!preset) return;
    const family = familyFor(model);
    const text = assemblePrompt({ presetPrompt: preset.prompts[family] || preset.prompts.kling || Object.values(preset.prompts)[0], family, camera: cam, lens: lensId });
    if (text) setPrompt(text);
  }, [presets]);

  // Close settings chip dropdowns on outside click
  useEffect(() => {
    const anyOpen = showDurationDropdown || showRatioDropdown || showResDropdown || showCfgDropdown || showModeDropdown || showAudioDropdown || showCamLockDropdown || showSoundDropdown || showMoveDropdown || showCameraDropdown || showLensDropdown;
    if (!anyOpen) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (showDurationDropdown && durationDropdownRef.current && !durationDropdownRef.current.contains(target)) setShowDurationDropdown(false);
      if (showRatioDropdown && ratioDropdownRef.current && !ratioDropdownRef.current.contains(target)) setShowRatioDropdown(false);
      if (showResDropdown && resDropdownRef.current && !resDropdownRef.current.contains(target)) setShowResDropdown(false);
      if (showCfgDropdown && cfgDropdownRef.current && !cfgDropdownRef.current.contains(target)) setShowCfgDropdown(false);
      if (showModeDropdown && modeDropdownRef.current && !modeDropdownRef.current.contains(target)) setShowModeDropdown(false);
      if (showAudioDropdown && audioDropdownRef.current && !audioDropdownRef.current.contains(target)) setShowAudioDropdown(false);
      if (showCamLockDropdown && camLockDropdownRef.current && !camLockDropdownRef.current.contains(target)) setShowCamLockDropdown(false);
      if (showSoundDropdown && soundDropdownRef.current && !soundDropdownRef.current.contains(target)) setShowSoundDropdown(false);
      if (showMoveDropdown && moveDropdownRef.current && !moveDropdownRef.current.contains(target)) setShowMoveDropdown(false);
      if (showCameraDropdown && cameraDropdownRef.current && !cameraDropdownRef.current.contains(target)) setShowCameraDropdown(false);
      if (showLensDropdown && lensDropdownRef.current && !lensDropdownRef.current.contains(target)) setShowLensDropdown(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showDurationDropdown, showRatioDropdown, showResDropdown, showCfgDropdown, showModeDropdown, showAudioDropdown, showCamLockDropdown, showSoundDropdown, showMoveDropdown, showCameraDropdown, showLensDropdown]);

  // --- Generate ---
  const handleGenerate = useCallback(async () => {
    if (generating) return;
    const runningCount = activeJobs.filter(j => j.status === 'running').length;
    if (runningCount >= 5) {
      addToast('Max 5 concurrent video jobs', 'error');
      return;
    }

    setGenerating(true);
    const jobId = crypto.randomUUID();

    addJob({
      id: jobId,
      type: 'video',
      status: 'running',
      persona: '',
      model: VIDEO_MODEL_NAMES[selectedModel],
      numImages: 1,
      notes: prompt.substring(0, 60),
      progress: 5,
      stage: 'Starting...',
      streamedImages: [],
      streamedVideos: [],
      startedAt: Date.now(),
    });

    try {
      const body: Record<string, unknown> = {
        model: selectedModel,
        // Wan 2.2 with Realism on: the box holds only the motion; the recipe wording is added here so the box stays short.
        // Realism on: your text is wrapped in the tested recipe; with audio on, the dry phone-mic line is added too.
        prompt: REALISM_MODELS.includes(selectedModel) && wanRealism ? realismPrompt(prompt, selectedModel !== VIDEO_MODELS.WAN_2_2 && generateAudio).prompt : prompt,
        negativePrompt: negativePrompt || (REALISM_MODELS.includes(selectedModel) && wanRealism ? realismPrompt(prompt, selectedModel !== VIDEO_MODELS.WAN_2_2 && generateAudio).negative : undefined),
        sourceImageUrl: sourceImageUrl || undefined,
        endImageUrl: endImageUrl || undefined,
        duration,
        aspectRatio,
        resolution,
        generateAudio,
        seed: seed ? parseInt(seed) : undefined,
      };

      // Model-specific params
      if (selectedModel === VIDEO_MODELS.KLING_V3) {
        body.cfgScale = cfgScale;
      } else if (selectedModel === VIDEO_MODELS.KLING_MOTION || selectedModel === VIDEO_MODELS.WAN_ANIMATE) {
        if (selectedModel === VIDEO_MODELS.WAN_ANIMATE) { body.animateMode = 'animate'; body.resolution = '720p'; body.duration = refDuration || duration; if (!prompt.trim()) body.prompt = ANIMATE_SHARP; }
        body.referenceVideoUrl = referenceVideoUrl || undefined;
        body.characterOrientation = characterOrientation;
        body.keepOriginalSound = keepOriginalSound;
      } else if (selectedModel === VIDEO_MODELS.SEEDANCE_1_5 || selectedModel === VIDEO_MODELS.SEEDANCE_2_0) {
        body.cameraFixed = cameraFixed;
      }

      const res = await fetch('/api/video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(errData.error || `HTTP ${res.status}`);
      }

      updateJob(jobId, { progress: 15, stage: 'Connected...' });

      // Unlock the generate button now that the job is queued.
      // The SSE stream runs in the background — don't block new submissions.
      setGenerating(false);

      await readSSEStream(res, {
        onVideo: (url, hasAudio) => {
          appendVideo(jobId, url, 95, 'Video ready!');
        },
        onImage: () => { /* not used for video */ },
        onProgress: (stage) => {
          updateJob(jobId, { stage });
        },
        onDone: (data) => {
          updateJob(jobId, {
            status: 'done',
            progress: 100,
            stage: 'Done!',
            resultRecordId: data.recordId,
            resultName: data.name,
            imageCount: data.imageCount,
          });
          addToast(`Video generated: ${data.name}`, 'success');
          refreshVideos();
        },
        onError: (message) => {
          updateJob(jobId, { status: 'error', errorMessage: message, stage: 'Failed' });
          addToast(`Video failed: ${message}`, 'error');
        },
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      updateJob(jobId, { status: 'error', errorMessage: errMsg, stage: 'Failed' });
      addToast(`Video failed: ${errMsg}`, 'error');
    } finally {
      setGenerating(false);
    }
  }, [
    generating, activeJobs, selectedModel, prompt, negativePrompt, sourceImageUrl, endImageUrl, refDuration,
    referenceVideoUrl, duration, aspectRatio, resolution, generateAudio, cameraFixed, cfgScale,
    seed, characterOrientation, keepOriginalSound, wanRealism,
    addJob, updateJob, appendVideo, addToast, refreshVideos,
  ]);

  // --- Star / Delete ---
  const handleStar = useCallback(async (id: string) => {
    const res = await fetch(`/api/video/${id}`, { method: 'PATCH' });
    if (res.ok) {
      setRecentVideos(prev => prev.map(v => v.id === id ? { ...v, starred: !v.starred } : v));
    }
  }, []);

  const handleDelete = useCallback(async (id: string) => {
    const res = await fetch(`/api/video/${id}`, { method: 'DELETE' });
    if (res.ok) {
      setRecentVideos(prev => prev.filter(v => v.id !== id));
      addToast('Video deleted', 'success');
    }
  }, [addToast]);

  // --- Prompt placeholders per model (hint text included in placeholder) ---
  const promptPlaceholders: Record<string, string> = {
    [VIDEO_MODELS.KLING_V3]: '[Shot type] + [Action] + [Scene] + [Camera] + [Style]\n\nExample: Wide shot: Woman turns slowly to camera, smiles naturally, hair catches soft morning light. Slight camera pan. Cinematic, warm tones.',
    [VIDEO_MODELS.KLING_O3]: 'Scene + Action + Dialogue in "quotes" + Sound · 3-15s · Native lip sync\n\nExample: Woman holds the product to camera and says "I switched last month and never looked back." Soft kitchen light, slow push-in.',
    [VIDEO_MODELS.KLING_MOTION]: 'Optional — motion comes from the reference video.\n\nDescribe lighting, atmosphere, styling. Leave empty to use reference motion as-is.',
    [VIDEO_MODELS.WAN_ANIMATE]: 'Optional. Leave empty and a tested realism prompt is sent for you.\n\n1. Drop the video.  2. Press "Her still from video".  3. Click one of the two stills.  4. Generate.',
    [VIDEO_MODELS.SEEDANCE_1_5]: 'Dialogue in "quotes" · Sound after Ambient: · Camera: fixed, slow pan, zoom in\n\nExample: Woman sits at desk, says "Let me show you something amazing."\nAmbient: keyboard typing, office hum.\nCamera: medium close-up, slow zoom. Warm light.',
    [VIDEO_MODELS.SEEDANCE_2_0]: 'Scene + Action + Dialogue + Sound + Camera · Up to 15s · Multi-shot scenes\n\nExample: Woman walks through sunlit garden, turns to camera, says "This is where the magic happens."\nAmbient: birds, gentle breeze. Camera: smooth tracking shot, shallow DOF. Cinematic.',
    [VIDEO_MODELS.SEEDANCE_2_5]: 'Scene + Action + Dialogue + Sound + Camera · Up to 30s in one shot\n\nExample: Woman holds the bottle up to camera, says "This is the only one I use now." Turns label toward lens.\nAmbient: quiet kitchen, morning light.',
    [VIDEO_MODELS.WAN_2_2]: 'Describe only the motion. With Realism on, the phone-footage wording is added for you. The clip keeps the start image\'s shape. No audio.\n\nExample: She turns her head toward the camera and smiles softly, hair moving slightly in the wind.',
    [VIDEO_MODELS.VEO_3_1]: 'Everything in one prompt: scene + dialogue + sound + music + camera\n\nExample: Close-up of woman in office. She says "This is incredible." Warm smile.\nAmbient: quiet office. Music: subtle piano.\nCamera: slow zoom in, shallow DOF.',
    [VIDEO_MODELS.GEMINI_OMNI_FLASH]: 'Scene + Action + Dialogue in "quotes" · 3-10s · Synced audio\n\nExample: Close-up, she lifts the jar and says "Two minutes, every morning." Natural light, handheld feel.',
  };

  const isMotion = selectedModel === VIDEO_MODELS.KLING_MOTION || selectedModel === VIDEO_MODELS.WAN_ANIMATE;   // both take a motion video + a character image
  const maxChars = selectedModel === VIDEO_MODELS.KLING_V3 ? 2500 : 3000;
  const canSubmit = !generating && (
    isMotion
      ? !!referenceVideoUrl && !!sourceImageUrl  // motion needs video + character image
      : !!prompt && !!sourceImageUrl              // all others need prompt + source image
  );

  // Cmd+Enter to generate
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && canSubmit) {
        e.preventDefault();
        handleGenerate();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [canSubmit, handleGenerate]);

  // ─── Render ─────────────────────────────────────────────

  return (
    <div style={{ position: 'relative', height: '100%', display: 'flex', flexDirection: 'column' }} className="fade-in">
      {/* Toolbar — matches CopyTab/CarouselTab exactly */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 0', flexShrink: 0 }}>
        <button
          style={{
            fontSize: 12, fontWeight: 500, color: '#999', background: 'none',
            border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center',
            gap: 5, padding: '4px 0', fontFamily: 'inherit',
          }}
        >
          <History size={13} />
          History
        </button>
        <input
          type="range"
          min={1}
          max={4}
          value={gridColumns}
          onChange={(e) => setGridColumns(Number(e.target.value))}
          className="grid-slider"
          style={{ width: 120, cursor: 'pointer' }}
        />
      </div>

      <style>{`
        .grid-slider {
          -webkit-appearance: none;
          appearance: none;
          height: 3px;
          background: #e0e0e0;
          border-radius: 2px;
          outline: none;
        }
        .grid-slider::-webkit-slider-thumb {
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
        .grid-slider::-webkit-slider-thumb:hover {
          box-shadow: 0 1px 6px rgba(0,0,0,0.3), 0 0 0 1px rgba(0,0,0,0.1);
        }
        .grid-slider::-moz-range-thumb {
          width: 14px;
          height: 14px;
          border-radius: 50%;
          background: #fff;
          box-shadow: 0 1px 4px rgba(0,0,0,0.2), 0 0 0 1px rgba(0,0,0,0.06);
          border: none;
          cursor: pointer;
        }
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

      {/* ========== FULL-WIDTH VIDEO GRID AREA ========== */}
      <div style={{ flex: 1, overflowY: 'auto', paddingBottom: 280 }}>

        {/* Error job cards — full width above grid */}
        {activeJobs.filter(j => j.status === 'error').length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 12 }}>
            {activeJobs.filter(j => j.status === 'error').map(job => (
              <ActiveJobCard key={job.id} job={job} />
            ))}
          </div>
        )}

        {/* Results grid */}
        {(recentVideos.length > 0 || activeJobs.some(j => j.status === 'running' || j.status === 'done')) ? (
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${gridColumns}, 1fr)`, gap: 6 }}>

            {/* Active running jobs — shimmer skeleton cards in grid */}
            {activeJobs.filter(j => j.status === 'running').map(job => {
              const stageLabel = (job.stage === 'Starting...' || job.stage === 'Connected...') ? 'Processing' : job.stage || 'Generating';
              return (
                <div
                  key={`job-${job.id}`}
                  style={{
                    aspectRatio: cardAspect(dominantRatio),
                    borderRadius: 12,
                    background: 'var(--color-bg-tertiary)',
                    border: '1px solid var(--color-border)',
                    position: 'relative',
                    overflow: 'hidden',
                  }}
                >
                  {/* Shimmer sweep */}
                  <div style={{
                    position: 'absolute', inset: 0,
                    background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.04) 50%, transparent 100%)',
                    backgroundSize: '200% 100%',
                    animation: 'shimmerSlide 1.8s ease-in-out infinite',
                  }} />
                  {/* Top-left status badge */}
                  <div style={{
                    position: 'absolute', top: 8, left: 8,
                    display: 'flex', alignItems: 'center', gap: 7,
                    background: 'rgba(255,255,255,0.85)', backdropFilter: 'blur(8px)',
                    boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
                    borderRadius: 24, padding: '6px 12px 6px 7px',
                  }}>
                    <svg width="20" height="20" viewBox="0 0 48 48" style={{ animation: 'spinPulse 3s ease-in-out infinite', flexShrink: 0 }}>
                      <defs>
                        <linearGradient id={`vidGrad-${job.id}`} x1="0%" y1="0%" x2="100%" y2="100%">
                          <stop offset="0%" stopColor="#1E293B"/>
                          <stop offset="100%" stopColor="#475569"/>
                        </linearGradient>
                      </defs>
                      <polygon points="24,4 42,14 42,34 24,44 6,34 6,14" fill={`url(#vidGrad-${job.id})`}/>
                      <circle cx="24" cy="24" r="9" fill="white"/>
                    </svg>
                    <span className="shimmer-text" style={{ fontSize: 14, fontWeight: 600, letterSpacing: '0.02em' }}>
                      {stageLabel.length > 30 ? stageLabel.substring(0, 30) + '...' : stageLabel}
                    </span>
                  </div>
                </div>
              );
            })}

            {/* Completed job videos (from active jobs, not yet in DB) */}
            {activeJobs.filter(j => j.status === 'done' && j.streamedVideos && j.streamedVideos.length > 0).map(job => (
              <div
                key={`done-${job.id}`}
                className="relative overflow-hidden cursor-pointer group"
                style={{
                  aspectRatio: cardAspect(dominantRatio), borderRadius: 12,
                  border: '1px solid var(--color-border)', background: 'var(--color-bg-tertiary)',
                }}
              >
                <video
                  src={job.streamedVideos![0]}
                  controls
                  preload="metadata"
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-all duration-200 pointer-events-none" />
                <button
                  onClick={() => removeJob(job.id)}
                  className="absolute top-2 right-2 w-7 h-7 rounded-lg flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                  style={{ background: 'rgba(0,0,0,0.5)', border: 'none', color: '#fff', cursor: 'pointer' }}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}

            {/* Recent videos from DB */}
            {recentVideos.map((v) => {
              const output = v.outputs[0];
              if (!output) return null;
              const badge = modelBadgeColors[v.videoModel] || { bg: '#F5F5F5', text: '#666' };

              return (
                <div
                  key={v.id}
                  className="relative overflow-hidden cursor-pointer group"
                  style={{
                    aspectRatio: cardAspect(dominantRatio), borderRadius: 12,
                    border: '1px solid var(--color-border)', background: 'var(--color-bg-tertiary)',
                  }}
                  onClick={() => {
                    const vids = recentVideos.filter(rv => rv.outputs[0]);
                    // Index into the FILTERED list. `vi` is the position in recentVideos, which still
                    // contains records with no output; using it shifted every card below one of those
                    // onto the wrong video/prompt/source image.
                    const lightboxIndex = Math.max(0, vids.findIndex(rv => rv.id === v.id));
                    setLightbox({
                      images: vids.map(rv => ({
                        url: rv.outputs[0].url,
                        label: rv.name,
                        type: 'video' as const,
                      })),
                      index: lightboxIndex,
                      metas: vids.map(rv => ({
                        genName: rv.name,
                        feature: 'Video' as const,
                        model: VIDEO_MODEL_NAMES[rv.videoModel as VideoModelId] || rv.videoModel,
                        aspectRatio: rv.aspectRatio,
                        createdAt: rv.createdAt,
                        prompt: rv.prompt || undefined,
                        resolution: rv.resolution,
                        sourceImageUrl: rv.sourceImageUrl || undefined,
                        duration: rv.duration,
                        hasAudio: rv.generateAudio,
                        cfgScale: rv.modelParams?.cfgScale,
                        cameraFixed: rv.modelParams?.cameraFixed,
                        characterOrientation: rv.modelParams?.characterOrientation,
                        seed: rv.modelParams?.seed,
                      })),
                    });
                  }}
                >
                  {v.aspectRatio !== dominantRatio && (
                    output.thumbnailUrl ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img src={output.thumbnailUrl} alt="" aria-hidden style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', filter: 'blur(24px) brightness(0.55) saturate(1.2)', transform: 'scale(1.15)' }} />
                    ) : (
                      <div style={{ position: 'absolute', inset: 0, background: '#111' }} />
                    )
                  )}
                  <video
                    src={output.url}
                    poster={output.thumbnailUrl ?? undefined}
                    controls
                    preload="none"
                    playsInline
                    style={{ position: 'relative', width: '100%', height: '100%', objectFit: v.aspectRatio === dominantRatio ? 'cover' : 'contain' }}
                  />
                  {/* Hover overlay */}
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-all duration-200 pointer-events-none" />
                  {/* Badges — top left */}
                  <div style={{ position: 'absolute', top: 6, left: 6, display: 'flex', gap: 4, pointerEvents: 'none' }}>
                    <span style={{ padding: '2px 7px', borderRadius: 6, fontSize: 10, fontWeight: 600, background: badge.bg, color: badge.text, backdropFilter: 'blur(4px)' }}>
                      {VIDEO_MODEL_NAMES[v.videoModel as VideoModelId] || v.videoModel}
                    </span>
                    <span style={{ padding: '2px 7px', borderRadius: 6, fontSize: 10, fontWeight: 600, background: 'rgba(0,0,0,0.55)', color: '#fff', backdropFilter: 'blur(4px)' }}>
                      {v.duration}s
                    </span>
                    {v.generateAudio && (
                      <span style={{ padding: '2px 7px', borderRadius: 6, fontSize: 10, fontWeight: 600, background: 'rgba(0,0,0,0.55)', color: '#fff', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center' }}>
                        <Volume2 size={10} />
                      </span>
                    )}
                  </div>
                  {/* Expand button — top right */}
                  <button
                    className="absolute top-2 right-2 w-7 h-7 rounded-lg flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    style={{ background: 'rgba(0,0,0,0.5)', border: 'none', color: '#fff', cursor: 'pointer' }}
                  >
                    <Maximize2 size={12} />
                  </button>
                  {/* Bottom action bar — slides up on hover */}
                  <div className="absolute bottom-0 left-0 w-full p-2 translate-y-full group-hover:translate-y-0 transition-transform duration-200">
                    <div className="flex gap-1.5">
                      <button
                        onClick={(e) => { e.stopPropagation(); handleStar(v.id); }}
                        className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg text-[10px] font-medium backdrop-blur-sm"
                        style={{ background: v.starred ? 'rgba(234,179,8,0.7)' : 'rgba(255,255,255,0.15)', color: 'white' }}
                      >
                        <Star size={10} fill={v.starred ? '#fff' : 'none'} />
                        {v.starred ? 'Starred' : 'Star'}
                      </button>
                      {v.prompt && (
                        <button
                          title="Save this prompt as a Move preset"
                          onClick={async (e) => {
                            e.stopPropagation();
                            const name = window.prompt('Preset name', v.name);
                            if (!name) return;
                            const family = familyFor(v.videoModel);
                            const res = await fetch('/api/presets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, category: 'user', prompts: { [family]: v.prompt }, sourceVideoId: v.id }) });
                            const data = await res.json();
                            if (!res.ok) { addToast(data.error || 'Could not save preset', 'error'); return; }
                            setPresets(prev => [...prev, data.preset]);
                            addToast(`Saved preset "${name}"`, 'success');
                          }}
                          className="py-1.5 px-2 rounded-lg backdrop-blur-sm"
                          style={{ background: 'rgba(255,255,255,0.15)', color: 'white' }}
                        >
                          <Bookmark size={11} />
                        </button>
                      )}
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDelete(v.id); }}
                        className="py-1.5 px-2 rounded-lg backdrop-blur-sm"
                        style={{ background: 'rgba(220,53,69,0.4)', color: 'white' }}
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : !loading ? (
          <div
            className="flex flex-col items-center justify-center py-16 rounded-xl border border-dashed"
            style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg-surface)' }}
          >
            <Video size={28} color="#ccc" style={{ marginBottom: 12 }} />
            <p className="text-sm font-medium mb-1" style={{ color: 'var(--color-text-secondary)' }}>No videos yet</p>
            <p className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>Select a model and generate your first video</p>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${gridColumns}, 1fr)`, gap: 6 }}>
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={`skel-${i}`} className="animate-pulse" style={{ aspectRatio: '16/9', borderRadius: 12, background: 'var(--color-bg-tertiary)' }} />
            ))}
          </div>
        )}
      </div>

      {/* Hidden file inputs */}
      <input ref={startFrameRef} type="file" accept="image/*" style={{ display: 'none' }}
        onChange={(e) => { if (e.target.files?.[0]) handleImageUpload(e.target.files[0], setSourceImagePreview, setSourceImageUrl, 'source'); }} />
      <input ref={endFrameRef} type="file" accept="image/*" style={{ display: 'none' }}
        onChange={(e) => { if (e.target.files?.[0]) handleImageUpload(e.target.files[0], setEndImagePreview, setEndImageUrl, 'end'); }} />
      <input ref={videoUploadRef} type="file" accept="video/mp4,video/quicktime" style={{ display: 'none' }}
        onChange={(e) => { if (e.target.files?.[0]) handleVideoUpload(e.target.files[0]); }} />

      {/* ═══════════════════════════════════════════════════ */}
      {/* FLOATING BOTTOM PANEL                               */}
      {/* ═══════════════════════════════════════════════════ */}
      <div style={{
        position: 'fixed', bottom: 20, left: 240, right: 20,
        maxWidth: 'clamp(700px, 75%, 1400px)', margin: '0 auto',
        background: 'var(--color-bg-primary)',
        border: '1px solid rgba(0,0,0,0.08)',
        borderRadius: 20,
        boxShadow: '0 8px 40px rgba(0,0,0,0.10), 0 2px 8px rgba(0,0,0,0.04)',
        zIndex: 100,
        display: 'flex', flexDirection: 'column',
        overflow: 'visible',
      }}>
        {/* Model selector trigger */}
        <div data-model-dropdown style={{
          display: 'flex', alignItems: 'center', padding: '10px 16px',
          borderBottom: '1px solid var(--color-border)', position: 'relative',
          borderRadius: '20px 20px 0 0', overflow: 'visible',
        }}>
          {/* The two jobs of this tab. Each has its own inputs and its own models. */}
          <div role="group" aria-label="What to make" style={{ display: 'flex', padding: 3, borderRadius: 12, background: 'var(--color-bg-surface)', border: '1px solid #e5e7eb', marginRight: 10, flexShrink: 0 }}>
            {([['photo', 'From a photo', 'Start from a still of her and describe what happens'], ['copy', 'Copy a video', 'Drop a video. She does the same moves in the same outfit']] as const).map(([id, label, tip]) => {
              const on = (isMotion ? 'copy' : 'photo') === id;
              return (
                <button key={id} type="button" title={tip} aria-pressed={on}
                  onClick={() => { if (on) return; setModelDropdownOpen(false); setSelectedModel(id === 'copy' ? VIDEO_MODELS.WAN_ANIMATE : VIDEO_MODELS.VEO_3_1); if (id === 'photo') setGenerateAudio(true); }}
                  style={{ padding: '6px 14px', borderRadius: 9, border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', background: on ? '#111827' : 'transparent', color: on ? '#fff' : '#555', transition: 'all 0.15s' }}>
                  {label}
                </button>
              );
            })}
          </div>
          <button
            onClick={() => setModelDropdownOpen(!modelDropdownOpen)}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '6px 12px', background: '#F0F0F3',
              border: '1px solid rgba(0,0,0,0.09)', borderRadius: 10,
              boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
              cursor: 'pointer', transition: 'all 0.15s', fontFamily: 'inherit',
            }}
          >
            <span style={{
              width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
              background: videoModels.find(m => m.id === selectedModel)?.dotColor,
            }} />
            <span style={{ fontSize: 13, fontWeight: 600, letterSpacing: -0.2 }}>
              {videoModels.find(m => m.id === selectedModel)?.name}
            </span>
            <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)', fontWeight: 400 }}>
              {videoModels.find(m => m.id === selectedModel)?.costLabel}
            </span>
            <ChevronDown size={12} style={{
              color: 'var(--color-text-tertiary)', marginLeft: 2,
              transition: 'transform 0.2s',
              transform: modelDropdownOpen ? 'rotate(180deg)' : 'rotate(0deg)',
            }} />
          </button>

          {/* Divider */}
          <div style={{ width: 1, height: 20, background: 'rgba(0,0,0,0.08)', flexShrink: 0, marginLeft: 6 }} />

          {/* Settings chips */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap', flex: 1, minWidth: 0, position: 'relative', zIndex: 250 }}>
              {/* Move chip — preset library ("Moves"), fills the prompt for this model's family */}
              {!isMotion && (() => {
                const current = presets.find(p => p.id === selectedPresetId);
                const cats = Array.from(new Set(presets.map(p => p.category)));
                return (
                  <SettingsChip
                    dropdownRef={moveDropdownRef} open={showMoveDropdown}
                    onToggle={() => { setShowMoveDropdown(!showMoveDropdown); setShowCameraDropdown(false); setShowLensDropdown(false); setShowDurationDropdown(false); setShowRatioDropdown(false); setShowResDropdown(false); setShowCfgDropdown(false); setShowAudioDropdown(false); setShowCamLockDropdown(false); }}
                    title="Move" label={current ? current.name : 'Move'} minWidth={230} maxHeight={360}
                    icon={<Clapperboard size={14} />}
                  >
                    {presets.length === 0 && <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', padding: '6px 8px' }}>No presets yet. Run supabase/migrations/20261104_video_presets.sql.</div>}
                    <ChipOption value="" selected={!selectedPresetId} onPick={() => { setSelectedPresetId(''); setShowMoveDropdown(false); }} label="None (free prompt)" />
                    {cats.map(cat => (
                      <div key={cat}>
                        <ChipSection label={cat} />
                        {presets.filter(p => p.category === cat).map(p => (
                          <ChipOption key={p.id} value={p.id} selected={selectedPresetId === p.id} label={p.name} hint={p.description || undefined}
                            onPick={(id) => { setSelectedPresetId(id); const cam = cameraMove || p.default_camera || ''; if (!cameraMove && p.default_camera) setCameraMove(p.default_camera); applyPreset(id, cam, lens, selectedModel); setShowMoveDropdown(false); }} />
                        ))}
                      </div>
                    ))}
                  </SettingsChip>
                );
              })()}

              {/* Camera chip — appends the move in this family's phrasing */}
              {!isMotion && (
                <SettingsChip
                  dropdownRef={cameraDropdownRef} open={showCameraDropdown}
                  onToggle={() => { setShowCameraDropdown(!showCameraDropdown); setShowMoveDropdown(false); setShowLensDropdown(false); setShowDurationDropdown(false); setShowRatioDropdown(false); setShowResDropdown(false); setShowCfgDropdown(false); setShowAudioDropdown(false); setShowCamLockDropdown(false); }}
                  title="Camera" label={CAMERA_MOVES.find(c => c.id === cameraMove)?.label || 'Camera'} minWidth={140}
                  icon={<Camera size={14} />}
                >
                  <ChipOption value="" selected={!cameraMove} onPick={() => { setCameraMove(''); if (selectedPresetId) applyPreset(selectedPresetId, '', lens, selectedModel); setShowCameraDropdown(false); }} label="Auto" />
                  {CAMERA_MOVES.map(c => (
                    <ChipOption key={c.id} value={c.id} selected={cameraMove === c.id} label={c.label}
                      onPick={(id) => { setCameraMove(id); if (selectedPresetId) applyPreset(selectedPresetId, id, lens, selectedModel); setShowCameraDropdown(false); }} />
                  ))}
                </SettingsChip>
              )}

              {/* Lens chip */}
              {!isMotion && (
                <SettingsChip
                  dropdownRef={lensDropdownRef} open={showLensDropdown}
                  onToggle={() => { setShowLensDropdown(!showLensDropdown); setShowMoveDropdown(false); setShowCameraDropdown(false); setShowDurationDropdown(false); setShowRatioDropdown(false); setShowResDropdown(false); setShowCfgDropdown(false); setShowAudioDropdown(false); setShowCamLockDropdown(false); }}
                  title="Lens" label={LENSES.find(l => l.id === lens)?.label || 'Lens'} minWidth={140}
                  icon={<Aperture size={14} />}
                >
                  {LENSES.map(l => (
                    <ChipOption key={l.id} value={l.id} selected={lens === l.id} label={l.label}
                      onPick={(id) => { setLens(id); if (selectedPresetId) applyPreset(selectedPresetId, cameraMove, id, selectedModel); setShowLensDropdown(false); }} />
                  ))}
                </SettingsChip>
              )}

              {/* Duration chip — all models except Motion */}
              {!isMotion && (() => {
                const opts = selectedModel === VIDEO_MODELS.KLING_V3 ? [3,5,10,15]
                  : selectedModel === VIDEO_MODELS.KLING_O3 ? [3,5,8,10,15]
                  : selectedModel === VIDEO_MODELS.GEMINI_OMNI_FLASH ? [3,5,8,10]
                  : selectedModel === VIDEO_MODELS.VEO_3_1 ? [4,6,8]
                  : selectedModel === VIDEO_MODELS.SEEDANCE_2_0 ? [5,10]
                  : selectedModel === VIDEO_MODELS.SEEDANCE_2_5 ? [5,10,15,20,30]
                  : selectedModel === VIDEO_MODELS.WAN_2_2 ? [5,8]
                  : [4,5,6,8,10,12];
                return (
                  <div ref={durationDropdownRef} style={{ position: 'relative' }}>
                    <div
                      onClick={() => { setShowDurationDropdown(!showDurationDropdown); setShowRatioDropdown(false); setShowResDropdown(false); setShowCfgDropdown(false); setShowModeDropdown(false); setShowAudioDropdown(false); setShowCamLockDropdown(false); setShowSoundDropdown(false); }}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 4,
                        padding: '5px 12px', borderRadius: 10,
                        background: showDurationDropdown ? '#EFF6FF' : 'var(--color-bg-surface)',
                        border: `1px solid ${showDurationDropdown ? '#1E40AF' : '#e5e7eb'}`,
                        fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit',
                        whiteSpace: 'nowrap' as const, transition: 'all 0.15s',
                      }}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={showDurationDropdown ? '#1E40AF' : '#888'} strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                      <span style={{ color: showDurationDropdown ? '#1E40AF' : '#555', fontWeight: showDurationDropdown ? 600 : 500, fontSize: 12 }}>{duration}s</span>
                      <ChevronDown size={11} style={{ color: showDurationDropdown ? '#1E40AF' : '#555', transition: 'transform 0.15s', transform: showDurationDropdown ? 'rotate(180deg)' : 'none' }} />
                    </div>
                    {showDurationDropdown && (
                      <div style={{
                        position: 'absolute', top: 'calc(100% + 6px)', left: 0,
                        background: 'var(--color-bg-primary)', border: '1px solid var(--color-border)',
                        borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,0.12), 0 2px 6px rgba(0,0,0,0.06)',
                        padding: 4, zIndex: 300, minWidth: 80,
                      }}>
                        <div style={{ fontSize: 9, fontWeight: 600, letterSpacing: 0.5, textTransform: 'uppercase', color: 'var(--color-text-tertiary)', padding: '4px 8px 2px' }}>Duration</div>
                        {opts.map(v => (
                          <div key={v} onClick={() => { setDuration(v); setShowDurationDropdown(false); }}
                            style={{
                              padding: '5px 8px', borderRadius: 6, cursor: 'pointer', fontSize: 11, fontWeight: 500,
                              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                              background: duration === v ? '#EFF6FF' : 'transparent',
                              color: duration === v ? '#1E40AF' : 'var(--color-text-secondary)',
                              transition: 'background 0.1s',
                            }}
                            onMouseEnter={e => { if (duration !== v) (e.currentTarget as HTMLDivElement).style.background = 'var(--color-bg-surface)'; }}
                            onMouseLeave={e => { if (duration !== v) (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
                          >
                            <span>{v}s</span>
                            {duration === v && <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#1E40AF' }} />}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Ratio chip — Seedance + Veo + Gemini (Kling O3 takes the ratio from the start image) */}
              {!isMotion && selectedModel !== VIDEO_MODELS.KLING_V3 && selectedModel !== VIDEO_MODELS.KLING_O3 && selectedModel !== VIDEO_MODELS.WAN_2_2 && (() => {
                const opts = (selectedModel === VIDEO_MODELS.VEO_3_1 || selectedModel === VIDEO_MODELS.GEMINI_OMNI_FLASH) ? ['16:9','9:16'] : ['16:9','9:16','1:1'];
                return (
                  <div ref={ratioDropdownRef} style={{ position: 'relative' }}>
                    <div
                      onClick={() => { setShowRatioDropdown(!showRatioDropdown); setShowDurationDropdown(false); setShowResDropdown(false); setShowCfgDropdown(false); setShowModeDropdown(false); setShowAudioDropdown(false); setShowCamLockDropdown(false); setShowSoundDropdown(false); }}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 4,
                        padding: '5px 12px', borderRadius: 10,
                        background: showRatioDropdown ? '#EFF6FF' : 'var(--color-bg-surface)',
                        border: `1px solid ${showRatioDropdown ? '#1E40AF' : '#e5e7eb'}`,
                        fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit',
                        whiteSpace: 'nowrap' as const, transition: 'all 0.15s',
                      }}
                    >
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="1" y="3" width="12" height="8" rx="1.5" stroke={showRatioDropdown ? '#1E40AF' : '#888'} strokeWidth="1.2" fill="none"/></svg>
                      <span style={{ color: showRatioDropdown ? '#1E40AF' : '#555', fontWeight: showRatioDropdown ? 600 : 500, fontSize: 12 }}>{ratioAuto ? `Auto · ${aspectRatio}` : aspectRatio}</span>
                      <ChevronDown size={11} style={{ color: showRatioDropdown ? '#1E40AF' : '#555', transition: 'transform 0.15s', transform: showRatioDropdown ? 'rotate(180deg)' : 'none' }} />
                    </div>
                    {showRatioDropdown && (
                      <div style={{
                        position: 'absolute', top: 'calc(100% + 6px)', left: 0,
                        background: 'var(--color-bg-primary)', border: '1px solid var(--color-border)',
                        borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,0.12), 0 2px 6px rgba(0,0,0,0.06)',
                        padding: 4, zIndex: 300, minWidth: 90,
                      }}>
                        <div style={{ fontSize: 9, fontWeight: 600, letterSpacing: 0.5, textTransform: 'uppercase', color: 'var(--color-text-tertiary)', padding: '4px 8px 2px' }}>Ratio</div>
                        <div onClick={() => { setRatioAuto(true); setShowRatioDropdown(false); }}
                          style={{ padding: '5px 8px', borderRadius: 6, cursor: 'pointer', fontSize: 11, fontWeight: 500, display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: ratioAuto ? '#EFF6FF' : 'transparent', color: ratioAuto ? '#1E40AF' : 'var(--color-text-secondary)' }}>
                          <span>Auto (match image)</span>
                          {ratioAuto && <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#1E40AF' }} />}
                        </div>
                        {opts.map(v => {
                          const previewW = v === '9:16' ? 10 : v === '1:1' ? 14 : 18;
                          const previewH = v === '16:9' ? 10 : v === '1:1' ? 14 : 18;
                          return (
                            <div key={v} onClick={() => { setAspectRatio(v); setRatioAuto(false); setShowRatioDropdown(false); }}
                              style={{
                                padding: '5px 8px', borderRadius: 6, cursor: 'pointer', fontSize: 11, fontWeight: 500,
                                display: 'flex', alignItems: 'center', gap: 8,
                                background: aspectRatio === v ? '#EFF6FF' : 'transparent',
                                color: aspectRatio === v ? '#1E40AF' : 'var(--color-text-secondary)',
                                transition: 'background 0.1s',
                              }}
                              onMouseEnter={e => { if (aspectRatio !== v) (e.currentTarget as HTMLDivElement).style.background = 'var(--color-bg-surface)'; }}
                              onMouseLeave={e => { if (aspectRatio !== v) (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
                            >
                              <div style={{ width: previewW, height: previewH, border: `1.5px solid ${aspectRatio === v ? '#1E40AF' : '#ccc'}`, borderRadius: 2, flexShrink: 0 }} />
                              <span>{v}</span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Resolution chip — Seedance + Veo */}
              {(selectedModel === VIDEO_MODELS.SEEDANCE_1_5 || selectedModel === VIDEO_MODELS.SEEDANCE_2_0 || selectedModel === VIDEO_MODELS.SEEDANCE_2_5 || selectedModel === VIDEO_MODELS.VEO_3_1) && (() => {
                const opts = selectedModel === VIDEO_MODELS.VEO_3_1 ? ['720p','1080p','4k'] : selectedModel === VIDEO_MODELS.SEEDANCE_2_5 ? ['480p','720p','1080p','4k'] : ['480p','720p','1080p'];
                return (
                  <div ref={resDropdownRef} style={{ position: 'relative' }}>
                    <div
                      onClick={() => { setShowResDropdown(!showResDropdown); setShowDurationDropdown(false); setShowRatioDropdown(false); setShowCfgDropdown(false); setShowModeDropdown(false); setShowAudioDropdown(false); setShowCamLockDropdown(false); setShowSoundDropdown(false); }}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 4,
                        padding: '5px 12px', borderRadius: 10,
                        background: showResDropdown ? '#EFF6FF' : 'var(--color-bg-surface)',
                        border: `1px solid ${showResDropdown ? '#1E40AF' : '#e5e7eb'}`,
                        fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit',
                        whiteSpace: 'nowrap' as const, transition: 'all 0.15s',
                      }}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={showResDropdown ? '#1E40AF' : '#888'} strokeWidth="2"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
                      <span style={{ color: showResDropdown ? '#1E40AF' : '#555', fontWeight: showResDropdown ? 600 : 500, fontSize: 12 }}>{resolution}</span>
                      <ChevronDown size={11} style={{ color: showResDropdown ? '#1E40AF' : '#555', transition: 'transform 0.15s', transform: showResDropdown ? 'rotate(180deg)' : 'none' }} />
                    </div>
                    {showResDropdown && (
                      <div style={{
                        position: 'absolute', top: 'calc(100% + 6px)', left: 0,
                        background: 'var(--color-bg-primary)', border: '1px solid var(--color-border)',
                        borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,0.12), 0 2px 6px rgba(0,0,0,0.06)',
                        padding: 4, zIndex: 300, minWidth: 90,
                      }}>
                        <div style={{ fontSize: 9, fontWeight: 600, letterSpacing: 0.5, textTransform: 'uppercase', color: 'var(--color-text-tertiary)', padding: '4px 8px 2px' }}>Resolution</div>
                        {opts.map(v => (
                          <div key={v} onClick={() => { setResolution(v); setShowResDropdown(false); }}
                            style={{
                              padding: '5px 8px', borderRadius: 6, cursor: 'pointer', fontSize: 11, fontWeight: 500,
                              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                              background: resolution === v ? '#EFF6FF' : 'transparent',
                              color: resolution === v ? '#1E40AF' : 'var(--color-text-secondary)',
                              transition: 'background 0.1s',
                            }}
                            onMouseEnter={e => { if (resolution !== v) (e.currentTarget as HTMLDivElement).style.background = 'var(--color-bg-surface)'; }}
                            onMouseLeave={e => { if (resolution !== v) (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
                          >
                            <span>{v}</span>
                            {resolution === v && <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#1E40AF' }} />}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* CFG Scale chip — Kling v3 only */}
              {selectedModel === VIDEO_MODELS.KLING_V3 && (() => {
                const cfgOpts = [0.0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0];
                return (
                  <div ref={cfgDropdownRef} style={{ position: 'relative' }}>
                    <div
                      onClick={() => { setShowCfgDropdown(!showCfgDropdown); setShowDurationDropdown(false); setShowRatioDropdown(false); setShowResDropdown(false); setShowModeDropdown(false); setShowAudioDropdown(false); setShowCamLockDropdown(false); setShowSoundDropdown(false); }}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 4,
                        padding: '5px 12px', borderRadius: 10,
                        background: showCfgDropdown ? '#EFF6FF' : 'var(--color-bg-surface)',
                        border: `1px solid ${showCfgDropdown ? '#1E40AF' : '#e5e7eb'}`,
                        fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit',
                        whiteSpace: 'nowrap' as const, transition: 'all 0.15s',
                      }}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={showCfgDropdown ? '#1E40AF' : '#888'} strokeWidth="2"><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></svg>
                      <span style={{ color: showCfgDropdown ? '#1E40AF' : '#555', fontWeight: showCfgDropdown ? 600 : 500, fontSize: 12 }}>CFG {cfgScale.toFixed(1)}</span>
                      <ChevronDown size={11} style={{ color: showCfgDropdown ? '#1E40AF' : '#555', transition: 'transform 0.15s', transform: showCfgDropdown ? 'rotate(180deg)' : 'none' }} />
                    </div>
                    {showCfgDropdown && (
                      <div style={{
                        position: 'absolute', top: 'calc(100% + 6px)', left: 0,
                        background: 'var(--color-bg-primary)', border: '1px solid var(--color-border)',
                        borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,0.12), 0 2px 6px rgba(0,0,0,0.06)',
                        padding: 4, zIndex: 300, minWidth: 80, maxHeight: 200, overflowY: 'auto',
                      }}>
                        <div style={{ fontSize: 9, fontWeight: 600, letterSpacing: 0.5, textTransform: 'uppercase', color: 'var(--color-text-tertiary)', padding: '4px 8px 2px' }}>CFG Scale</div>
                        {cfgOpts.map(v => (
                          <div key={v} onClick={() => { setCfgScale(v); setShowCfgDropdown(false); }}
                            style={{
                              padding: '5px 8px', borderRadius: 6, cursor: 'pointer', fontSize: 11, fontWeight: 500,
                              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                              background: cfgScale === v ? '#EFF6FF' : 'transparent',
                              color: cfgScale === v ? '#1E40AF' : 'var(--color-text-secondary)',
                              transition: 'background 0.1s',
                            }}
                            onMouseEnter={e => { if (cfgScale !== v) (e.currentTarget as HTMLDivElement).style.background = 'var(--color-bg-surface)'; }}
                            onMouseLeave={e => { if (cfgScale !== v) (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
                          >
                            <span>{v.toFixed(1)}</span>
                            {cfgScale === v && <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#1E40AF' }} />}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Realism toggle: Wan 2.2 and Veo 3.1 (adds the dry phone-mic voice when audio is on) */}
              {REALISM_MODELS.includes(selectedModel) && (
                <button type="button" onClick={() => setWanRealism(!wanRealism)} aria-pressed={wanRealism}
                  title={wanRealism ? `On: your text is sent as "${WAN_REALISM.before} <your text> ${WAN_REALISM.after}"${selectedModel !== VIDEO_MODELS.WAN_2_2 && generateAudio ? ` + "${DRY_VOICE.line}"` : ''}, with a negative prompt against plastic skin${selectedModel !== VIDEO_MODELS.WAN_2_2 && generateAudio ? ' and echo' : ''} (edit it under the gear).` : 'Off: your prompt is sent exactly as typed.'}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 12px', borderRadius: 10, border: `1px solid ${wanRealism ? '#16A34A' : '#e5e7eb'}`, background: wanRealism ? 'rgba(22,163,74,0.08)' : 'var(--color-bg-surface)', color: wanRealism ? '#065F46' : '#555', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: wanRealism ? '#16A34A' : '#bbb' }} /> Realism
                </button>
              )}
              {/* Audio chip — all except Motion and Wan (no audio) */}
              {!isMotion && selectedModel !== VIDEO_MODELS.WAN_2_2 && (
                <div ref={audioDropdownRef} style={{ position: 'relative' }}>
                  <div
                    onClick={() => { setShowAudioDropdown(!showAudioDropdown); setShowDurationDropdown(false); setShowRatioDropdown(false); setShowResDropdown(false); setShowCfgDropdown(false); setShowModeDropdown(false); setShowCamLockDropdown(false); setShowSoundDropdown(false); }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 4,
                      padding: '5px 12px', borderRadius: 10,
                      background: showAudioDropdown ? '#EFF6FF' : 'var(--color-bg-surface)',
                      border: `1px solid ${showAudioDropdown ? '#1E40AF' : '#e5e7eb'}`,
                      boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
                      fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit',
                      transition: 'all 0.15s',
                    }}
                  >
                    {generateAudio ? <Volume2 size={14} style={{ color: showAudioDropdown ? '#1E40AF' : '#888' }} /> : <VolumeX size={14} style={{ color: showAudioDropdown ? '#1E40AF' : '#888' }} />}
                    <span style={{ color: showAudioDropdown ? '#1E40AF' : '#555', fontWeight: showAudioDropdown ? 600 : 500, fontSize: 12 }}>Audio {generateAudio ? 'On' : 'Off'}</span>
                    <ChevronDown size={11} style={{ color: showAudioDropdown ? '#1E40AF' : '#555', transition: 'transform 0.15s', transform: showAudioDropdown ? 'rotate(180deg)' : 'none' }} />
                  </div>
                  {showAudioDropdown && (
                    <div style={{
                      position: 'absolute', top: 'calc(100% + 6px)', left: 0,
                      background: 'var(--color-bg-primary)', border: '1px solid var(--color-border)',
                      borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,0.12), 0 2px 6px rgba(0,0,0,0.06)',
                      padding: 4, zIndex: 300, minWidth: 80,
                    }}>
                      <div style={{ fontSize: 9, fontWeight: 600, letterSpacing: 0.5, textTransform: 'uppercase', color: 'var(--color-text-tertiary)', padding: '4px 8px 2px' }}>Audio</div>
                      {[true, false].map(v => (
                        <div key={String(v)} onClick={() => { setGenerateAudio(v); setShowAudioDropdown(false); }}
                          style={{
                            padding: '5px 8px', borderRadius: 6, cursor: 'pointer', fontSize: 11, fontWeight: 500,
                            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                            background: generateAudio === v ? '#EFF6FF' : 'transparent',
                            color: generateAudio === v ? '#1E40AF' : 'var(--color-text-secondary)',
                            transition: 'background 0.1s',
                          }}
                          onMouseEnter={e => { if (generateAudio !== v) (e.currentTarget as HTMLDivElement).style.background = 'var(--color-bg-surface)'; }}
                          onMouseLeave={e => { if (generateAudio !== v) (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
                        >
                          <span>{v ? 'On' : 'Off'}</span>
                          {generateAudio === v && <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#1E40AF' }} />}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Camera Lock chip — Seedance only */}
              {(selectedModel === VIDEO_MODELS.SEEDANCE_1_5 || selectedModel === VIDEO_MODELS.SEEDANCE_2_0) && (
                <div ref={camLockDropdownRef} style={{ position: 'relative' }}>
                  <div
                    onClick={() => { setShowCamLockDropdown(!showCamLockDropdown); setShowDurationDropdown(false); setShowRatioDropdown(false); setShowResDropdown(false); setShowCfgDropdown(false); setShowModeDropdown(false); setShowAudioDropdown(false); setShowSoundDropdown(false); }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 4,
                      padding: '5px 12px', borderRadius: 10,
                      background: showCamLockDropdown ? '#EFF6FF' : 'var(--color-bg-surface)',
                      border: `1px solid ${showCamLockDropdown ? '#1E40AF' : '#e5e7eb'}`,
                      boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
                      fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit',
                      transition: 'all 0.15s',
                    }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={showCamLockDropdown ? '#1E40AF' : '#888'} strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                    <span style={{ color: showCamLockDropdown ? '#1E40AF' : '#555', fontWeight: showCamLockDropdown ? 600 : 500, fontSize: 12 }}>Cam Lock {cameraFixed ? 'On' : 'Off'}</span>
                    <ChevronDown size={11} style={{ color: showCamLockDropdown ? '#1E40AF' : '#555', transition: 'transform 0.15s', transform: showCamLockDropdown ? 'rotate(180deg)' : 'none' }} />
                  </div>
                  {showCamLockDropdown && (
                    <div style={{
                      position: 'absolute', top: 'calc(100% + 6px)', left: 0,
                      background: 'var(--color-bg-primary)', border: '1px solid var(--color-border)',
                      borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,0.12), 0 2px 6px rgba(0,0,0,0.06)',
                      padding: 4, zIndex: 300, minWidth: 80,
                    }}>
                      <div style={{ fontSize: 9, fontWeight: 600, letterSpacing: 0.5, textTransform: 'uppercase', color: 'var(--color-text-tertiary)', padding: '4px 8px 2px' }}>Cam Lock</div>
                      {[true, false].map(v => (
                        <div key={String(v)} onClick={() => { setCameraFixed(v); setShowCamLockDropdown(false); }}
                          style={{
                            padding: '5px 8px', borderRadius: 6, cursor: 'pointer', fontSize: 11, fontWeight: 500,
                            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                            background: cameraFixed === v ? '#EFF6FF' : 'transparent',
                            color: cameraFixed === v ? '#1E40AF' : 'var(--color-text-secondary)',
                            transition: 'background 0.1s',
                          }}
                          onMouseEnter={e => { if (cameraFixed !== v) (e.currentTarget as HTMLDivElement).style.background = 'var(--color-bg-surface)'; }}
                          onMouseLeave={e => { if (cameraFixed !== v) (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
                        >
                          <span>{v ? 'On' : 'Off'}</span>
                          {cameraFixed === v && <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#1E40AF' }} />}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Kling Motion: Mode + Keep Sound chips */}
              {isMotion && (
                <>
                  <div ref={modeDropdownRef} style={{ position: 'relative', display: selectedModel === VIDEO_MODELS.WAN_ANIMATE ? 'none' : undefined }}>
                    <div
                      onClick={() => { setShowModeDropdown(!showModeDropdown); setShowDurationDropdown(false); setShowRatioDropdown(false); setShowResDropdown(false); setShowCfgDropdown(false); setShowAudioDropdown(false); setShowCamLockDropdown(false); setShowSoundDropdown(false); }}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 4,
                        padding: '5px 12px', borderRadius: 10,
                        background: showModeDropdown ? '#EFF6FF' : 'var(--color-bg-surface)',
                        border: `1px solid ${showModeDropdown ? '#1E40AF' : '#e5e7eb'}`,
                        fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit',
                        transition: 'all 0.15s',
                      }}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={showModeDropdown ? '#1E40AF' : '#888'} strokeWidth="2"><path d="m15 10-4 4 6.5 6.5a2.12 2.12 0 1 0 3-3L15 10z"/><path d="M18.5 13.5L20 12"/><path d="m2.5 21.5 7-4"/><path d="m4 16 4.5 4.5"/><path d="m11.5 6.5-1 1"/><path d="M16 2l-5.5 5.5"/></svg>
                      <span style={{ color: showModeDropdown ? '#1E40AF' : '#555', fontWeight: showModeDropdown ? 600 : 500, fontSize: 12 }}>
                        {characterOrientation === 'image' ? 'Image' : 'Video'}
                      </span>
                      <ChevronDown size={11} style={{ color: showModeDropdown ? '#1E40AF' : '#555', transition: 'transform 0.15s', transform: showModeDropdown ? 'rotate(180deg)' : 'none' }} />
                    </div>
                    {showModeDropdown && (
                      <div style={{
                        position: 'absolute', top: 'calc(100% + 6px)', left: 0,
                        background: 'var(--color-bg-primary)', border: '1px solid var(--color-border)',
                        borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,0.12), 0 2px 6px rgba(0,0,0,0.06)',
                        padding: 4, zIndex: 300, minWidth: 100,
                      }}>
                        <div style={{ fontSize: 9, fontWeight: 600, letterSpacing: 0.5, textTransform: 'uppercase', color: 'var(--color-text-tertiary)', padding: '4px 8px 2px' }}>Mode</div>
                        {(['image', 'video'] as const).map(v => (
                          <div key={v} onClick={() => { setCharacterOrientation(v); setShowModeDropdown(false); }}
                            style={{
                              padding: '5px 8px', borderRadius: 6, cursor: 'pointer', fontSize: 11, fontWeight: 500,
                              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                              background: characterOrientation === v ? '#EFF6FF' : 'transparent',
                              color: characterOrientation === v ? '#1E40AF' : 'var(--color-text-secondary)',
                              transition: 'background 0.1s',
                            }}
                            onMouseEnter={e => { if (characterOrientation !== v) (e.currentTarget as HTMLDivElement).style.background = 'var(--color-bg-surface)'; }}
                            onMouseLeave={e => { if (characterOrientation !== v) (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
                          >
                            <span>{v.charAt(0).toUpperCase() + v.slice(1)}</span>
                            {characterOrientation === v && <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#1E40AF' }} />}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <div ref={soundDropdownRef} style={{ position: 'relative' }}>
                    <div
                      onClick={() => { setShowSoundDropdown(!showSoundDropdown); setShowDurationDropdown(false); setShowRatioDropdown(false); setShowResDropdown(false); setShowCfgDropdown(false); setShowModeDropdown(false); setShowAudioDropdown(false); setShowCamLockDropdown(false); }}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 4,
                        padding: '5px 12px', borderRadius: 10,
                        background: showSoundDropdown ? '#EFF6FF' : 'var(--color-bg-surface)',
                        border: `1px solid ${showSoundDropdown ? '#1E40AF' : '#e5e7eb'}`,
                        fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit',
                        transition: 'all 0.15s',
                      }}
                    >
                      {keepOriginalSound ? <Volume2 size={14} style={{ color: showSoundDropdown ? '#1E40AF' : '#888' }} /> : <VolumeX size={14} style={{ color: showSoundDropdown ? '#1E40AF' : '#888' }} />}
                      <span style={{ color: showSoundDropdown ? '#1E40AF' : '#555', fontWeight: showSoundDropdown ? 600 : 500, fontSize: 12 }}>Sound {keepOriginalSound ? 'On' : 'Off'}</span>
                      <ChevronDown size={11} style={{ color: showSoundDropdown ? '#1E40AF' : '#555', transition: 'transform 0.15s', transform: showSoundDropdown ? 'rotate(180deg)' : 'none' }} />
                    </div>
                    {showSoundDropdown && (
                      <div style={{
                        position: 'absolute', top: 'calc(100% + 6px)', left: 0,
                        background: 'var(--color-bg-primary)', border: '1px solid var(--color-border)',
                        borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,0.12), 0 2px 6px rgba(0,0,0,0.06)',
                        padding: 4, zIndex: 300, minWidth: 80,
                      }}>
                        <div style={{ fontSize: 9, fontWeight: 600, letterSpacing: 0.5, textTransform: 'uppercase', color: 'var(--color-text-tertiary)', padding: '4px 8px 2px' }}>Sound</div>
                        {[true, false].map(v => (
                          <div key={String(v)} onClick={() => { setKeepOriginalSound(v); setShowSoundDropdown(false); }}
                            style={{
                              padding: '5px 8px', borderRadius: 6, cursor: 'pointer', fontSize: 11, fontWeight: 500,
                              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                              background: keepOriginalSound === v ? '#EFF6FF' : 'transparent',
                              color: keepOriginalSound === v ? '#1E40AF' : 'var(--color-text-secondary)',
                              transition: 'background 0.1s',
                            }}
                            onMouseEnter={e => { if (keepOriginalSound !== v) (e.currentTarget as HTMLDivElement).style.background = 'var(--color-bg-surface)'; }}
                            onMouseLeave={e => { if (keepOriginalSound !== v) (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
                          >
                            <span>{v ? 'On' : 'Off'}</span>
                            {keepOriginalSound === v && <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#1E40AF' }} />}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}

              {/* Gear icon for advanced settings */}
              <div data-gear-popover style={{ position: 'relative', marginLeft: 'auto' }}>
                <div
                  onClick={() => setGearOpen(!gearOpen)}
                  style={{
                    width: 28, height: 28, borderRadius: 8,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    cursor: 'pointer', border: '1px solid var(--color-border)',
                    background: 'var(--color-bg-primary)',
                    color: 'var(--color-text-tertiary)', transition: 'all 0.15s', flexShrink: 0,
                  }}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
                </div>
                {gearOpen && (
                  <div data-gear-popover style={{
                    position: 'absolute', top: 'calc(100% + 6px)', right: 0,
                    width: 260, background: 'var(--color-bg-primary)',
                    border: '1px solid var(--color-border)', borderRadius: 14,
                    boxShadow: '0 8px 32px rgba(0,0,0,0.12), 0 2px 6px rgba(0,0,0,0.04)',
                    padding: 14, display: 'flex', flexDirection: 'column', gap: 10, zIndex: 300,
                  }}>
                    <div style={{ fontSize: 9, fontWeight: 600, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--color-text-tertiary)' }}>Advanced</div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--color-text-secondary)' }}>Seed</span>
                      <input type="text" value={seed} onChange={(e) => setSeed(e.target.value.replace(/\D/g, ''))}
                        placeholder="Random" style={{
                          width: 70, padding: '3px 6px', border: '1px solid var(--color-border)',
                          borderRadius: 5, fontSize: 10, textAlign: 'right', fontFamily: 'inherit',
                          background: 'var(--color-bg-surface)',
                        }} />
                    </div>
                    {(selectedModel === VIDEO_MODELS.KLING_V3 || selectedModel === VIDEO_MODELS.VEO_3_1 || selectedModel === VIDEO_MODELS.WAN_2_2) && (
                      <>
                        <div style={{ height: 1, background: 'var(--color-border)' }} />
                        <div>
                          <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--color-text-secondary)' }}>Negative prompt</span>
                          <div style={{ fontSize: 9, color: 'var(--color-text-tertiary)' }}>What to avoid</div>
                        </div>
                        <textarea
                          value={negativePrompt}
                          onChange={(e) => setNegativePrompt(e.target.value)}
                          placeholder="blur, distort, low quality, watermark..."
                          style={{
                            height: 48, border: '1px solid var(--color-border)', borderRadius: 8,
                            padding: '6px 8px', fontFamily: 'inherit', fontSize: 10,
                            resize: 'none', background: 'var(--color-bg-surface)', color: '#666',
                          }}
                        />
                      </>
                    )}
                  </div>
                )}
              </div>
          </div>

          {/* Model dropdown card grid */}
          {modelDropdownOpen && (
            <div data-model-dropdown style={{
              position: 'absolute', top: 52, left: 16, right: 16, zIndex: 200,
              background: 'var(--color-bg-primary)',
              border: '1px solid var(--color-border)', borderRadius: 14,
              boxShadow: '0 8px 32px rgba(0,0,0,0.12), 0 2px 6px rgba(0,0,0,0.04)',
              padding: 8,
              display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8,
              animation: 'fadeIn 0.2s ease-out',
            }}>
              {videoModels.filter(m => m.mode === (isMotion ? 'copy' : 'photo') && (SHOW_UNPROVEN_VIDEO_MODELS || m.proven || m.id === selectedModel)).map(m => {
                const isActive = selectedModel === m.id;
                return (
                  <div
                    key={m.id}
                    onClick={() => {
                      setSelectedModel(m.id);
                      setModelDropdownOpen(false);
                      // Dialogue-first models: audio on by default, else the spoken line is dropped
                      if (m.id === VIDEO_MODELS.KLING_O3 || m.id === VIDEO_MODELS.GEMINI_OMNI_FLASH || m.id === VIDEO_MODELS.SEEDANCE_2_5) setGenerateAudio(true);
                      if (selectedPresetId) applyPreset(selectedPresetId, cameraMove, lens, m.id);
                    }}
                    style={{
                      borderRadius: 10,
                      border: `1.5px solid ${isActive ? m.dotColor : 'transparent'}`,
                      cursor: 'pointer', overflow: 'hidden',
                      background: isActive ? `${m.dotColor}08` : 'var(--color-bg-tertiary)',
                      transition: 'all 0.15s',
                    }}
                  >
                    {/* Video preview */}
                    <div style={{
                      height: 56,
                      position: 'relative',
                      overflow: 'hidden',
                      borderRadius: '9px 9px 0 0',
                    }}>
                      <video
                        src={modelCardVideos[m.id]}
                        autoPlay
                        loop
                        muted
                        playsInline
                        style={{
                          width: '100%',
                          height: '100%',
                          objectFit: 'cover',
                          display: 'block',
                        }}
                      />
                      <span style={{
                        position: 'absolute', top: 6, right: 6,
                        fontSize: 9, fontWeight: 600, color: m.dotColor,
                        background: 'rgba(255,255,255,0.8)', padding: '1px 5px',
                        borderRadius: 4, backdropFilter: 'blur(4px)',
                      }}>{m.costLabel}</span>
                    </div>
                    {/* Text */}
                    <div style={{ padding: '8px 10px 9px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 1 }}>
                        <span style={{ width: 5, height: 5, borderRadius: '50%', background: m.dotColor, flexShrink: 0 }} />
                        <span style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: -0.2 }}>{m.name}</span>
                      </div>
                      <div style={{ fontSize: 9.5, color: 'var(--color-text-tertiary)', paddingLeft: 10 }}>{m.desc}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Panel body */}
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'stretch', padding: 14, gap: 14, height: 200, background: '#FAFAFB', borderRadius: '0 0 20px 20px' }}>

          {/* IMAGE COLUMN */}
          <div style={{ flexShrink: 0, width: 240, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', gap: 6, flex: 1 }}>
              {isMotion ? (
                <>
                  {/* Motion to Copy */}
                  <div
                    onClick={() => videoUploadRef.current?.click()}
                    style={{
                      flex: 1, borderRadius: 10, position: 'relative',
                      border: referenceVideoPreview ? 'none' : '2px dashed rgba(0,0,0,0.12)',
                      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                      cursor: 'pointer', background: referenceVideoPreview ? '#000' : '#EDEDF0',
                      transition: 'border-color 0.15s', overflow: 'hidden',
                      gap: 4, fontSize: 10, color: 'var(--color-text-tertiary)',
                    }}
                  >
                    {referenceVideoPreview ? (
                      <>
                        <video src={referenceVideoPreview} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} muted />
                        <div
                          onClick={(e) => { e.stopPropagation(); setReferenceVideoPreview(null); setReferenceVideoUrl(''); }}
                          style={{
                            position: 'absolute', top: 4, right: 4, zIndex: 2,
                            width: 18, height: 18, borderRadius: '50%',
                            background: 'rgba(0,0,0,0.5)', display: 'flex',
                            alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
                          }}
                        >
                          <X size={10} style={{ color: '#fff' }} />
                        </div>
                      </>
                    ) : (
                      <>
                        <Video size={20} style={{ opacity: 0.35 }} />
                        <span style={{ fontWeight: 500 }}>Motion to Copy</span>
                        <span style={{ fontSize: 9, color: '#bbb' }}>.mp4 .mov</span>
                      </>
                    )}
                  </div>
                  {/* Your Character */}
                  <div
                    onClick={() => startFrameRef.current?.click()}
                    style={{
                      flex: 1, borderRadius: 10, position: 'relative',
                      border: sourceImagePreview ? 'none' : '2px dashed rgba(0,0,0,0.12)',
                      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                      cursor: 'pointer', background: sourceImagePreview ? 'transparent' : '#EDEDF0',
                      transition: 'border-color 0.15s', overflow: 'hidden',
                      gap: 4, fontSize: 10, color: 'var(--color-text-tertiary)',
                    }}
                  >
                    {sourceImagePreview ? (
                      <>
                        <img src={sourceImagePreview} alt="Character" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
                        <div
                          onClick={(e) => { e.stopPropagation(); setSourceImagePreview(null); setSourceImageUrl(''); }}
                          style={{
                            position: 'absolute', top: 4, right: 4, zIndex: 2,
                            width: 18, height: 18, borderRadius: '50%',
                            background: 'rgba(0,0,0,0.5)', display: 'flex',
                            alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
                          }}
                        >
                          <X size={10} style={{ color: '#fff' }} />
                        </div>
                      </>
                    ) : (
                      <>
                        <User size={20} style={{ opacity: 0.35 }} />
                        <span style={{ fontWeight: 500 }}>Your Character</span>
                      </>
                    )}
                    {/* Copy motion: make her still from the video's first frame, then pick one */}
                    {referenceVideoUrl && (
                      <div onClick={(e) => e.stopPropagation()} style={{ position: 'absolute', left: 4, right: 4, bottom: 4, zIndex: 3, display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {stillPicks.length > 0 && !stillPicks.some(p => p.url === sourceImageUrl) && (
                          <div style={{ alignSelf: 'center', padding: '2px 8px', borderRadius: 6, background: '#1E40AF', color: '#fff', fontSize: 10, fontWeight: 600 }}>Click one to use it</div>
                        )}
                        {stillPicks.length > 0 && (
                          <div style={{ display: 'flex', gap: 4 }}>
                            {stillPicks.map((p, i) => (
                              <img key={p.url} src={p.url} alt={`Still ${i + 1}`} title={p.score != null ? `Face match ${p.score.toFixed(2)}. Click to use.` : 'Click to use'}
                                onClick={() => { setSourceImageUrl(p.url); setSourceImagePreview(p.url); }}
                                style={{ flex: 1, minWidth: 0, height: 56, objectFit: 'cover', borderRadius: 6, cursor: 'pointer', border: sourceImageUrl === p.url ? '2px solid #1E40AF' : '2px solid #fff', boxShadow: '0 1px 4px rgba(0,0,0,0.25)' }} />
                            ))}
                          </div>
                        )}
                        <button type="button" onClick={makeStill} disabled={stillBusy}
                          title="Takes the first frame of the motion video and puts her in it: same pose, outfit and framing. About $0.02."
                          style={{ padding: '4px 6px', borderRadius: 6, border: 'none', background: 'rgba(17,17,17,0.82)', color: '#fff', fontSize: 10, fontWeight: 600, cursor: stillBusy ? 'wait' : 'pointer', fontFamily: 'inherit' }}>
                          {stillBusy ? 'Making her still...' : stillPicks.length ? 'Reroll her still' : 'Her still from video'}
                        </button>
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <>
                  {/* Start Frame */}
                  <div
                    onClick={() => startFrameRef.current?.click()}
                    style={{
                      flex: 1, borderRadius: 10, position: 'relative',
                      border: sourceImagePreview ? 'none' : '2px dashed rgba(0,0,0,0.12)',
                      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                      cursor: 'pointer', background: sourceImagePreview ? 'transparent' : '#EDEDF0',
                      transition: 'border-color 0.15s', overflow: 'hidden',
                      gap: 4, fontSize: 10, color: 'var(--color-text-tertiary)',
                    }}
                  >
                    {sourceImagePreview ? (
                      <>
                        <img src={sourceImagePreview} alt="Start" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
                        <div
                          onClick={(e) => { e.stopPropagation(); setSourceImagePreview(null); setSourceImageUrl(''); }}
                          style={{
                            position: 'absolute', top: 4, right: 4, zIndex: 2,
                            width: 18, height: 18, borderRadius: '50%',
                            background: 'rgba(0,0,0,0.5)', display: 'flex',
                            alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
                          }}
                        >
                          <X size={10} style={{ color: '#fff' }} />
                        </div>
                      </>
                    ) : (
                      <>
                        <Image size={20} style={{ opacity: 0.35 }} />
                        <span style={{ fontWeight: 500 }}>Start Frame</span>
                      </>
                    )}
                  </div>
                  {/* End Frame */}
                  <div
                    onClick={() => endFrameRef.current?.click()}
                    style={{
                      flex: 1, borderRadius: 10, position: 'relative',
                      border: endImagePreview ? 'none' : '2px dashed rgba(0,0,0,0.12)',
                      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                      cursor: 'pointer', background: endImagePreview ? 'transparent' : '#EDEDF0',
                      transition: 'border-color 0.15s', overflow: 'hidden', opacity: endImagePreview ? 1 : 0.7,
                      gap: 4, fontSize: 10, color: 'var(--color-text-tertiary)',
                    }}
                  >
                    {endImagePreview ? (
                      <>
                        <img src={endImagePreview} alt="End" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
                        <div
                          onClick={(e) => { e.stopPropagation(); setEndImagePreview(null); setEndImageUrl(''); }}
                          style={{
                            position: 'absolute', top: 4, right: 4, zIndex: 2,
                            width: 18, height: 18, borderRadius: '50%',
                            background: 'rgba(0,0,0,0.5)', display: 'flex',
                            alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
                          }}
                        >
                          <X size={10} style={{ color: '#fff' }} />
                        </div>
                      </>
                    ) : (
                      <>
                        <Plus size={20} style={{ opacity: 0.35 }} />
                        <span style={{ fontWeight: 500 }}>End Frame</span>
                        <span style={{ fontSize: 9, color: '#bbb' }}>(optional)</span>
                      </>
                    )}
                  </div>
                </>
              )}
            </div>
            <button
              style={{
                padding: '4px 0', fontSize: 10, color: 'var(--color-text-secondary)', textAlign: 'center',
                cursor: 'pointer', border: '1px solid var(--color-border)', borderRadius: 6,
                background: 'var(--color-bg-primary)', fontFamily: 'inherit',
              }}
            >
              Library
            </button>
          </div>

          {/* PROMPT COLUMN */}
          <div style={{ flex: 2, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
            <div style={{ position: 'relative', flex: 1, display: 'flex', borderRadius: 10, overflow: 'hidden' }}>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value.substring(0, maxChars))}
                placeholder={promptPlaceholders[selectedModel]}
                style={{
                  flex: 1, width: '100%', border: '1px solid rgba(0,0,0,0.10)', borderRadius: 10,
                  padding: '10px 12px', paddingBottom: 32, fontFamily: 'inherit', fontSize: 12,
                  lineHeight: 1.5, resize: 'none', background: '#FFFFFF',
                  boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.03)',
                  color: 'var(--color-text-primary)', transition: 'border-color 0.15s',
                }}
              />
              {/* Enhance button */}
              <button
                onClick={handleEnhancePrompt}
                disabled={!prompt.trim() || enhancing}
                style={{
                  position: 'absolute', bottom: 10, right: 10,
                  display: 'flex', alignItems: 'center', gap: 5,
                  padding: '3px 8px 3px 6px', borderRadius: 12,
                  border: `1px solid ${enhance ? 'rgba(59,130,246,0.3)' : 'var(--color-border)'}`,
                  background: enhancing ? '#E0E7FF' : enhance ? '#DBEAFE' : 'var(--color-bg-surface)',
                  fontSize: 10, fontWeight: 600,
                  color: enhance ? '#1E40AF' : 'var(--color-text-tertiary)',
                  cursor: !prompt.trim() || enhancing ? 'not-allowed' : 'pointer',
                  opacity: !prompt.trim() ? 0.5 : 1,
                  fontFamily: 'inherit',
                }}
              >
                <Sun size={12} style={enhancing ? { animation: 'spin 1s linear infinite' } : undefined} /> {enhancing ? 'Enhancing...' : 'Enhance'}
              </button>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center' }}>
              <span style={{ fontSize: 10, color: '#ccc' }}>{prompt.length}/{maxChars}</span>
            </div>
          </div>

          {/* GENERATE COLUMN */}
          <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', width: 170, gap: 0 }}>
            <button
              onClick={handleGenerate}
              disabled={!canSubmit}
              style={{
                width: '100%', padding: '16px 20px', borderRadius: 14,
                background: canSubmit ? 'linear-gradient(135deg, #0F172A, #1E293B 40%, #334155)' : '#E5E5E5',
                color: canSubmit ? '#fff' : '#999',
                border: 'none', cursor: canSubmit ? 'pointer' : 'not-allowed',
                fontFamily: 'inherit',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
                position: 'relative', overflow: 'hidden',
                transition: 'transform 0.15s, box-shadow 0.15s',
                boxShadow: canSubmit ? '0 4px 16px rgba(15,23,42,0.3)' : 'none',
              }}
              onMouseEnter={(e) => { if (canSubmit) { (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(-1px)'; (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 6px 24px rgba(15,23,42,0.4)'; } }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(0)'; if (canSubmit) (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 4px 16px rgba(15,23,42,0.3)'; }}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 2L9.5 6.5L14 8L9.5 9.5L8 14L6.5 9.5L2 8L6.5 6.5L8 2Z" fill="white"/></svg>
              <span style={{ fontSize: 15, fontWeight: 600, letterSpacing: -0.2 }}>Generate</span>
              <span style={{ fontSize: 11, fontWeight: 400, opacity: 0.55 }}>
                {videoModels.find(m => m.id === selectedModel)?.costLabel}
              </span>
            </button>
            <div style={{ textAlign: 'center', fontSize: 10, color: 'var(--color-text-tertiary)', marginTop: 8 }}>
              <kbd style={{ padding: '1px 5px', borderRadius: 4, background: 'var(--color-bg-surface)', border: '1px solid var(--color-border)', fontFamily: 'inherit', fontSize: 9, fontWeight: 600 }}>Cmd</kbd>
              {' + '}
              <kbd style={{ padding: '1px 5px', borderRadius: 4, background: 'var(--color-bg-surface)', border: '1px solid var(--color-border)', fontFamily: 'inherit', fontSize: 9, fontWeight: 600 }}>Enter</kbd>
            </div>
          </div>
        </div>
      </div>

      {/* Lightbox */}
      {lightbox && (
        <ImageLightbox
          images={lightbox.images}
          initialIndex={lightbox.index}
          onClose={() => setLightbox(null)}
          generationMeta={lightbox.meta}
          generationMetas={lightbox.metas}
          actions={{
            onStar: (i) => {
              const vid = recentVideos.filter(rv => rv.outputs[0])[i];
              if (vid) handleStar(vid.id);
            },
            onDelete: (i) => {
              const vid = recentVideos.filter(rv => rv.outputs[0])[i];
              if (vid) {
                handleDelete(vid.id);
                setLightbox(null);
              }
            },
          }}
          imageMeta={lightbox.images.map((_, i) => {
            const vid = recentVideos.filter(rv => rv.outputs[0])[i];
            return { starred: vid?.starred };
          })}
        />
      )}
    </div>
  );
}
