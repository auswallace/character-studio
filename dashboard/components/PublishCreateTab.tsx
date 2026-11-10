'use client';

import { useState, useEffect } from 'react';
import ScheduleCalendarPopover from './ScheduleCalendarPopover';
import TimePickerPopover from './TimePickerPopover';
import LibraryPickerModal from './LibraryPickerModal';
import SchedulePreviewModal from './SchedulePreviewModal';

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
}

interface Generation {
  id: string;
  name: string;
  persona: string;
  starred: boolean;
  images: GenerationImage[];
}

interface Remix {
  id: string;
  name: string;
  persona: string;
  starred: boolean;
  variants: GenerationImage[];
}

// ─── Constants ────────────────────────────────────────────

const platforms = [
  { id: 'Instagram', label: 'Instagram', color: '#E1306C', abbr: 'IG' },
  { id: 'Twitter', label: 'X / Twitter', color: '#1DA1F2', abbr: 'X' },
  { id: 'Threads', label: 'Threads', color: '#333333', abbr: 'TH' },
  { id: 'TikTok', label: 'TikTok', color: '#00f2ea', abbr: 'TT' },
];

interface PendingDraft {
  id: string;
  persona: string;
  images: string[];
  caption_draft: string;
  platform: string;
}

interface PublishCreateTabProps {
  pendingDraft?: PendingDraft | null;
  onDraftConsumed?: () => void;
}

// Platform mapping from draft (lowercase/abbr) to Create tab (title case)
const draftPlatformMap: Record<string, string> = {
  ig: 'Instagram',
  x: 'Twitter',
  threads: 'Threads',
  tiktok: 'TikTok',
};

export default function PublishCreateTab({ pendingDraft, onDraftConsumed }: PublishCreateTabProps) {
  // ─── State ──────────────────────────────────────────────
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [generations, setGenerations] = useState<Generation[]>([]);
  const [loading, setLoading] = useState(true);

  const [selectedPersona, setSelectedPersona] = useState<string>('');
  const [selectedPlatforms, setSelectedPlatforms] = useState<Set<string>>(new Set(['Instagram']));
  const [selectedImages, setSelectedImages] = useState<Set<string>>(new Set());
  const [captionIG, setCaptionIG] = useState('');
  const [captionX, setCaptionX] = useState('');
  const [scheduleDate, setScheduleDate] = useState('');
  const [scheduleTime, setScheduleTime] = useState('');
  const [aiCaption, setAiCaption] = useState(true);
  const [captionThreads, setCaptionThreads] = useState('');
  const [captionTikTok, setCaptionTikTok] = useState('');

  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewMode, setPreviewMode] = useState<'schedule' | 'post-now'>('schedule');

  const [showFavorites, setShowFavorites] = useState(false);
  const [favoriteImages, setFavoriteImages] = useState<GenerationImage[]>([]);
  const [loadingFavorites, setLoadingFavorites] = useState(false);

  const [libraryOpen, setLibraryOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [postingNow, setPostingNow] = useState(false);
  const [generatingCaptions, setGeneratingCaptions] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  const currentPersona = personas.find(p => p.id === selectedPersona);

  // Filter images by current persona name
  const recentImages: GenerationImage[] = currentPersona
    ? generations
        .filter(g => g.persona === currentPersona.name)
        .flatMap(g => g.images)
    : [];

  const displayImages = showFavorites ? favoriteImages : recentImages;

  // ─── Pre-fill date from URL hash param (e.g., #publish.create?date=2026-03-25) ──
  useEffect(() => {
    const hash = window.location.hash;
    const match = hash.match(/[?&]date=(\d{4}-\d{2}-\d{2})/);
    if (match) {
      setScheduleDate(match[1]);
      // Clean the param from hash so it doesn't persist on re-navigation
      window.history.replaceState(null, '', '#publish.create');
    }
  }, []);

  // ─── Pre-fill from pending draft (coming from Drafts tab) ──
  useEffect(() => {
    if (!pendingDraft || personas.length === 0) return;

    // Find persona by name and set it
    const matchingPersona = personas.find(p => p.name === pendingDraft.persona);
    if (matchingPersona) {
      setSelectedPersona(matchingPersona.id);
    }

    // Set platform
    const mappedPlatform = draftPlatformMap[pendingDraft.platform];
    if (mappedPlatform) {
      setSelectedPlatforms(new Set([mappedPlatform]));
    }

    // Set images
    if (pendingDraft.images && pendingDraft.images.length > 0) {
      setSelectedImages(new Set(pendingDraft.images));
    }

    // Set caption on the mapped platform
    if (pendingDraft.caption_draft) {
      if (mappedPlatform === 'Instagram') setCaptionIG(pendingDraft.caption_draft);
      else if (mappedPlatform === 'Twitter') setCaptionX(pendingDraft.caption_draft);
      else if (mappedPlatform === 'Threads') setCaptionThreads(pendingDraft.caption_draft);
      else if (mappedPlatform === 'TikTok') setCaptionTikTok(pendingDraft.caption_draft);
    }

    // Consume the draft so it doesn't re-apply on next render
    onDraftConsumed?.();
  }, [pendingDraft, personas]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Fetch data on mount ────────────────────────────────

  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      try {
        const [configRes, genRes] = await Promise.all([
          fetch('/api/config'),
          fetch('/api/generations?limit=15'),
        ]);

        const configData = await configRes.json();
        const genData = await genRes.json();

        const fetchedPersonas: Persona[] = configData.personas || [];
        setPersonas(fetchedPersonas);
        if (fetchedPersonas.length > 0) {
          setSelectedPersona(fetchedPersonas[0].id);
        }

        setGenerations(genData.generations || []);
      } catch (err) {
        console.error('[PublishCreateTab] Failed to fetch data:', err);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  // ─── Fetch favorites when toggled on ────────────────────

  useEffect(() => {
    if (!showFavorites || !currentPersona) return;

    let cancelled = false;
    async function fetchFavorites() {
      setLoadingFavorites(true);
      try {
        const [genRes, remixRes] = await Promise.all([
          fetch(`/api/generations?limit=1000`),
          fetch(`/api/remix?limit=1000`),
        ]);
        const genData = await genRes.json();
        const remixData = await remixRes.json();

        if (cancelled) return;

        const personaName = currentPersona!.name;
        const starredGenImages: GenerationImage[] = (genData.generations || [])
          .filter((g: Generation) => g.starred && g.persona === personaName)
          .flatMap((g: Generation) => g.images);

        const starredRemixImages: GenerationImage[] = (remixData.remixes || [])
          .filter((r: Remix) => r.starred && r.persona === personaName)
          .flatMap((r: Remix) => r.variants);

        setFavoriteImages([...starredGenImages, ...starredRemixImages].slice(0, 15));
      } catch (err) {
        console.error('[PublishCreateTab] Failed to fetch favorites:', err);
      } finally {
        if (!cancelled) setLoadingFavorites(false);
      }
    }
    fetchFavorites();
    return () => { cancelled = true; };
  }, [showFavorites, currentPersona]);

  // ─── Helpers ────────────────────────────────────────────

  const togglePlatform = (id: string) => {
    setSelectedPlatforms(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  function imgUrl(img: GenerationImage): string {
    return img.thumbnails?.large?.url || img.url;
  }

  // ─── Create Post Handler ────────────────────────────────

  const handleCreatePost = async (postNow = false) => {
    if (!currentPersona) return;
    if (selectedPlatforms.size === 0) { setErrorMessage('Select at least one platform.'); return; }
    if (postNow && selectedImages.size === 0) { setErrorMessage('Select an image to post now.'); return; }

    if (postNow) setPostingNow(true);
    else setSubmitting(true);
    setErrorMessage('');
    setSuccessMessage('');

    try {
      const scheduleDatetime = scheduleDate
        ? `${scheduleDate}T${scheduleTime || '12:00'}:00.000Z`
        : undefined;

      const res = await fetch('/api/social-posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          persona: currentPersona.name,
          platforms: Array.from(selectedPlatforms),
          imageUrls: selectedImages.size > 0 ? Array.from(selectedImages) : undefined,
          captionIG: captionIG || undefined,
          captionTwitter: captionX || undefined,
          captionThreads: captionThreads || undefined,
          captionTikTok: captionTikTok || undefined,
          scheduleDate: scheduleDatetime,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setErrorMessage(err.error || 'Failed to create post.');
        return;
      }

      const { id: postId } = await res.json();

      // If "Post Now", immediately send to Late
      if (postNow && postId) {
        const lateRes = await fetch(`/api/social-posts/${postId}/send-to-late`, {
          method: 'POST',
        });

        if (!lateRes.ok) {
          const lateErr = await lateRes.json().catch(() => ({}));
          setErrorMessage(lateErr.error || 'Post created but failed to send to Late.');
          return;
        }

        const lateData = await lateRes.json();
        if (lateData.errors?.length > 0 && !lateData.success) {
          setErrorMessage(`Post created but Late errors: ${lateData.errors.join(', ')}`);
          return;
        }

        setSuccessMessage('Post sent to Late!');
      } else {
        setSuccessMessage('Post created!');
      }

      // Reset form
      setSelectedImages(new Set());
      setCaptionIG('');
      setCaptionX('');
      setCaptionThreads('');
      setCaptionTikTok('');
      setScheduleDate('');
      setScheduleTime('');
      setTimeout(() => setSuccessMessage(''), 5000);
    } catch {
      setErrorMessage('Network error. Try again.');
    } finally {
      setSubmitting(false);
      setPostingNow(false);
    }
  };

  // ─── Confirm Schedule Handler (called by preview modal) ─

  const handleConfirmSchedule = async () => {
    const scheduleDatetime = scheduleDate
      ? `${scheduleDate}T${scheduleTime || '12:00'}:00.000Z`
      : undefined;

    // 1. Save to Supabase
    const res = await fetch('/api/social-posts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        persona: currentPersona!.name,
        platforms: Array.from(selectedPlatforms),
        imageUrls: selectedImages.size > 0 ? Array.from(selectedImages) : undefined,
        captionIG: captionIG || undefined,
        captionTwitter: captionX || undefined,
        captionThreads: captionThreads || undefined,
        captionTikTok: captionTikTok || undefined,
        scheduleDate: scheduleDatetime,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to create post');
    }

    const { id: postId } = await res.json();

    // 2. Immediately send to Late
    const lateRes = await fetch(`/api/social-posts/${postId}/send-to-late`, {
      method: 'POST',
    });

    if (!lateRes.ok) {
      const lateErr = await lateRes.json().catch(() => ({}));
      throw new Error(lateErr.error || 'Failed to send to Late');
    }

    const lateData = await lateRes.json();
    if (lateData.errors?.length > 0 && !lateData.success) {
      throw new Error(lateData.errors.join(', '));
    }

    // 3. Reset form on success
    setSelectedImages(new Set());
    setCaptionIG('');
    setCaptionX('');
    setCaptionThreads('');
    setCaptionTikTok('');
    setScheduleDate('');
    setScheduleTime('');
  };

  // ─── Generate Captions Handler ──────────────────────────

  const handleGenerateCaptions = async () => {
    if (selectedImages.size === 0) { setErrorMessage('Select an image first.'); return; }
    if (selectedPlatforms.size === 0) { setErrorMessage('Select at least one platform.'); return; }

    setGeneratingCaptions(true);
    setErrorMessage('');

    try {
      const platformList = Array.from(selectedPlatforms);
      const results = await Promise.all(
        platformList.map(async (platform) => {
          const res = await fetch('/api/social-posts/_/generate-caption', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              platform,
              imageUrl: Array.from(selectedImages)[0],
              persona: currentPersona?.name,
            }),
          });
          if (!res.ok) return { platform, caption: '' };
          const data = await res.json();
          return { platform, caption: data.caption || '' };
        })
      );

      for (const { platform, caption } of results) {
        if (platform === 'Instagram') setCaptionIG(caption);
        if (platform === 'Twitter') setCaptionX(caption);
        if (platform === 'Threads') setCaptionThreads(caption);
        if (platform === 'TikTok') setCaptionTikTok(caption);
      }
    } catch {
      setErrorMessage('Failed to generate captions.');
    } finally {
      setGeneratingCaptions(false);
    }
  };

  // ─── Loading skeleton ──────────────────────────────────

  if (loading) {
    return (
      <div className="space-y-8 fade-in">
        {/* Header skeleton */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="skeleton w-8 h-8 rounded-lg" />
            <div className="skeleton h-5 w-40 rounded" />
          </div>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-6">
          <div className="space-y-6">
            {/* Persona + platforms skeleton */}
            <div className="flex items-start gap-5">
              <div>
                <div className="skeleton h-3 w-16 rounded mb-2" />
                <div className="skeleton h-10 w-44 rounded-xl" />
              </div>
              <div>
                <div className="skeleton h-3 w-20 rounded mb-2" />
                <div className="flex gap-2">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="skeleton h-10 w-14 rounded-xl" />
                  ))}
                </div>
              </div>
            </div>
            {/* Image grid skeleton */}
            <div>
              <div className="skeleton h-3 w-56 rounded mb-2" />
              <div className="grid grid-cols-4 sm:grid-cols-5 lg:grid-cols-6 gap-2">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="skeleton rounded-xl" style={{ aspectRatio: '4/5' }} />
                ))}
              </div>
            </div>
            {/* Caption skeleton */}
            <div className="space-y-4">
              <div className="skeleton h-3 w-20 rounded" />
              <div className="skeleton h-24 w-full rounded-xl" />
            </div>
          </div>
          {/* Preview card skeleton */}
          <div className="space-y-4">
            <div className="skeleton h-3 w-16 rounded" />
            <div className="skeleton rounded-xl" style={{ aspectRatio: '4/5' }} />
            <div className="skeleton h-20 w-full rounded-xl" />
          </div>
        </div>
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
    <div className="space-y-8 fade-in">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'var(--color-accent-green-muted)' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent-green)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </div>
          <h2 className="text-lg font-semibold" style={{ fontFamily: 'var(--font-display)' }}>Create New Post</h2>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-6">
        {/* Left — Main form */}
        <div className="space-y-6">
          {/* Persona + Platforms */}
          <div className="flex items-start gap-5 flex-wrap">
            {/* Persona picker */}
            <div>
              <label className="block text-xs font-medium mb-2 uppercase tracking-wider" style={{ color: 'var(--color-text-tertiary)' }}>Persona</label>
              <div className="flex items-center gap-2.5 px-3 py-2 rounded-xl border" style={{ background: '#FFFFFF', borderColor: 'var(--color-border)' }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {currentPersona?.faceRefs?.[0] ? (
                  <img src={currentPersona.faceRefs[0]} alt={currentPersona.name} className="w-6 h-6 rounded-full object-cover" style={{ border: '1.5px solid var(--color-border-hover)' }} />
                ) : (
                  <div className="w-6 h-6 rounded-full" style={{ background: 'var(--color-bg-tertiary)', border: '1.5px solid var(--color-border-hover)' }} />
                )}
                <select value={selectedPersona} onChange={(e) => setSelectedPersona(e.target.value)} className="bg-transparent text-sm font-medium cursor-pointer outline-none" style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-body)' }}>
                  {personas.map(p => (<option key={p.id} value={p.id} style={{ background: 'var(--color-bg-tertiary)' }}>{p.name}</option>))}
                </select>
              </div>
            </div>

            {/* Platform toggles */}
            <div>
              <label className="block text-xs font-medium mb-2 uppercase tracking-wider" style={{ color: 'var(--color-text-tertiary)' }}>Platforms</label>
              <div className="flex gap-2">
                {platforms.map(p => {
                  const active = selectedPlatforms.has(p.id);
                  return (
                    <button
                      key={p.id}
                      onClick={() => togglePlatform(p.id)}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-xl border text-xs font-medium transition-all duration-200"
                      style={{
                        background: active ? `${p.color}15` : 'var(--color-bg-card)',
                        borderColor: active ? p.color : 'var(--color-border)',
                        color: active ? p.color : 'var(--color-text-tertiary)',
                      }}
                    >
                      <div className="w-2 h-2 rounded-full" style={{ background: active ? p.color : 'var(--color-text-tertiary)', opacity: active ? 1 : 0.4 }} />
                      {p.abbr}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Image Selection */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--color-text-tertiary)' }}>
                Select Images <span style={{ fontWeight: 400, textTransform: 'none' }}>— click multiple for carousel</span>
              </label>
              {/* Recent / Favorites toggle */}
              <div className="flex rounded-[20px] overflow-hidden border" style={{ borderColor: 'var(--color-border)' }}>
                <button
                  onClick={() => setShowFavorites(false)}
                  className="px-3 py-1 text-[11px] font-medium transition-colors duration-150"
                  style={{
                    background: !showFavorites ? '#DBEAFE' : '#FFFFFF',
                    color: !showFavorites ? '#1E40AF' : 'var(--color-text-tertiary)',
                  }}
                >
                  Recent
                </button>
                <button
                  onClick={() => setShowFavorites(true)}
                  className="flex items-center gap-1 px-3 py-1 text-[11px] font-medium transition-colors duration-150"
                  style={{
                    background: showFavorites ? '#DBEAFE' : '#FFFFFF',
                    color: showFavorites ? '#1E40AF' : 'var(--color-text-tertiary)',
                    borderLeft: '1px solid var(--color-border)',
                  }}
                >
                  <svg width="10" height="10" viewBox="0 0 24 24" fill={showFavorites ? '#ffffff' : 'var(--color-text-tertiary)'} stroke="none">
                    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                  </svg>
                  Favorites
                </button>
              </div>
            </div>
            {loadingFavorites && showFavorites ? (
              <div className="rounded-xl border p-8 text-center" style={{ borderColor: 'var(--color-border)', background: '#FFFFFF' }}>
                <div className="w-5 h-5 border-2 border-current/30 border-t-current rounded-full animate-spin mx-auto mb-2" style={{ color: 'var(--color-accent-green)' }} />
                <p className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>Loading favorites...</p>
              </div>
            ) : displayImages.length === 0 ? (
              <div className="rounded-xl border p-8 text-center" style={{ borderColor: 'var(--color-border)', background: '#FFFFFF' }}>
                <p className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>
                  {showFavorites
                    ? `No favorited images for ${currentPersona?.name || 'this persona'}. Star images in the Library to see them here.`
                    : `No recent images for ${currentPersona?.name || 'this persona'}. Generate some images first.`
                  }
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-4 sm:grid-cols-5 lg:grid-cols-6 gap-2">
                {displayImages.map((img, i) => {
                  const displayUrl = imgUrl(img);
                  const fullUrl = img.url;
                  return (
                    <div
                      key={i}
                      onClick={() => setSelectedImages(prev => {
                        const next = new Set(prev);
                        if (next.has(fullUrl)) next.delete(fullUrl);
                        else next.add(fullUrl);
                        return next;
                      })}
                      className={`image-card relative rounded-xl overflow-hidden cursor-pointer group ${selectedImages.has(fullUrl) ? 'ring-2' : ''}`}
                      style={{ aspectRatio: '4/5', outlineColor: selectedImages.has(fullUrl) ? 'var(--color-accent-green)' : undefined, outlineWidth: selectedImages.has(fullUrl) ? '2px' : undefined, outlineStyle: selectedImages.has(fullUrl) ? 'solid' : undefined, outlineOffset: '1px' }}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={displayUrl} alt={`Option ${i + 1}`} className="w-full h-full object-cover" />
                      {selectedImages.has(fullUrl) && (
                        <div className="absolute top-2 right-2 w-5 h-5 rounded-full flex items-center justify-center" style={{ background: 'var(--color-accent-green)' }}>
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                        </div>
                      )}
                    </div>
                  );
                })}
                {/* Upload option */}
                <div className="drop-zone rounded-xl border-2 border-dashed flex flex-col items-center justify-center text-center p-3 cursor-pointer" style={{ borderColor: 'var(--color-border-hover)', background: '#FFFFFF', aspectRatio: '4/5' }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-tertiary)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
                  </svg>
                  <p className="text-[10px] mt-1" style={{ color: 'var(--color-text-tertiary)' }}>Upload</p>
                </div>
                {/* Library option */}
                <div
                  onClick={() => setLibraryOpen(true)}
                  className="rounded-xl border-2 border-dashed flex flex-col items-center justify-center text-center p-3 cursor-pointer transition-colors hover:border-[var(--color-accent-green)]"
                  style={{ borderColor: 'var(--color-border-hover)', background: '#FFFFFF', aspectRatio: '4/5' }}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-tertiary)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 19.5A2.5 2.5 0 016.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z" />
                  </svg>
                  <p className="text-[10px] mt-1" style={{ color: 'var(--color-text-tertiary)' }}>Library</p>
                </div>
              </div>
            )}
          </div>

          {/* Captions */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <label className="block text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--color-text-tertiary)' }}>Captions</label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={aiCaption} onChange={() => setAiCaption(!aiCaption)} className="w-4 h-4 rounded accent-emerald-600" />
                <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>Generate with AI</span>
              </label>
            </div>

            {selectedPlatforms.has('Instagram') && (
              <div>
                <div className="flex items-center gap-2 mb-1.5">
                  <div className="w-2 h-2 rounded-full" style={{ background: '#E1306C' }} />
                  <span className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>Instagram</span>
                </div>
                <textarea
                  value={captionIG} onChange={(e) => setCaptionIG(e.target.value)}
                  placeholder="Write your Instagram caption..."
                  rows={3}
                  className="w-full rounded-xl border px-4 py-3 text-sm resize-none outline-none transition-colors duration-200 placeholder:opacity-40"
                  style={{ background: 'var(--color-bg-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text-primary)', fontFamily: 'var(--font-body)' }}
                  onFocus={(e) => e.target.style.borderColor = 'var(--color-border-focus)'}
                  onBlur={(e) => e.target.style.borderColor = 'var(--color-border)'}
                />
              </div>
            )}

            {selectedPlatforms.has('Twitter') && (
              <div>
                <div className="flex items-center gap-2 mb-1.5">
                  <div className="w-2 h-2 rounded-full" style={{ background: '#1DA1F2' }} />
                  <span className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>X / Twitter</span>
                  <span className="text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>280 char max</span>
                </div>
                <textarea
                  value={captionX} onChange={(e) => setCaptionX(e.target.value)}
                  placeholder="Write your X caption..."
                  rows={2}
                  maxLength={280}
                  className="w-full rounded-xl border px-4 py-3 text-sm resize-none outline-none transition-colors duration-200 placeholder:opacity-40"
                  style={{ background: 'var(--color-bg-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text-primary)', fontFamily: 'var(--font-body)' }}
                  onFocus={(e) => e.target.style.borderColor = 'var(--color-border-focus)'}
                  onBlur={(e) => e.target.style.borderColor = 'var(--color-border)'}
                />
                <div className="text-right mt-1">
                  <span className="text-[10px]" style={{ color: captionX.length > 260 ? 'var(--color-error)' : 'var(--color-text-tertiary)' }}>{captionX.length}/280</span>
                </div>
              </div>
            )}

            {selectedPlatforms.has('Threads') && (
              <div>
                <div className="flex items-center gap-2 mb-1.5">
                  <div className="w-2 h-2 rounded-full" style={{ background: '#333333' }} />
                  <span className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>Threads</span>
                </div>
                <textarea
                  value={captionThreads} onChange={(e) => setCaptionThreads(e.target.value)}
                  placeholder="Conversational caption for Threads..."
                  rows={2}
                  className="w-full rounded-xl border px-4 py-3 text-sm resize-none outline-none transition-colors duration-200 placeholder:opacity-40"
                  style={{ background: 'var(--color-bg-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text-primary)', fontFamily: 'var(--font-body)' }}
                  onFocus={(e) => e.target.style.borderColor = 'var(--color-border-focus)'}
                  onBlur={(e) => e.target.style.borderColor = 'var(--color-border)'}
                />
              </div>
            )}

            {selectedPlatforms.has('TikTok') && (
              <div>
                <div className="flex items-center gap-2 mb-1.5">
                  <div className="w-2 h-2 rounded-full" style={{ background: '#00f2ea' }} />
                  <span className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>TikTok</span>
                </div>
                <textarea
                  value={captionTikTok} onChange={(e) => setCaptionTikTok(e.target.value)}
                  placeholder="Short, hooky TikTok caption..."
                  rows={2}
                  className="w-full rounded-xl border px-4 py-3 text-sm resize-none outline-none transition-colors duration-200 placeholder:opacity-40"
                  style={{ background: 'var(--color-bg-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text-primary)', fontFamily: 'var(--font-body)' }}
                  onFocus={(e) => e.target.style.borderColor = 'var(--color-border-focus)'}
                  onBlur={(e) => e.target.style.borderColor = 'var(--color-border)'}
                />
              </div>
            )}
          </div>

          {/* Schedule */}
          <div>
            <label className="block text-xs font-medium mb-2 uppercase tracking-wider" style={{ color: 'var(--color-text-tertiary)' }}>Schedule</label>
            <div className="flex items-center gap-3 flex-wrap">
              <ScheduleCalendarPopover
                value={scheduleDate}
                onChange={setScheduleDate}
              />
              <TimePickerPopover
                value={scheduleTime}
                onChange={setScheduleTime}
              />
              <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>or leave empty to add to queue</span>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-3 pt-2 flex-wrap">
            <button
              onClick={() => {
                if (!currentPersona || selectedPlatforms.size === 0) {
                  setErrorMessage('Select a persona and at least one platform.');
                  return;
                }
                setPreviewMode('schedule');
                setPreviewOpen(true);
              }}
              disabled={submitting || postingNow || !currentPersona || selectedPlatforms.size === 0}
              className="flex items-center gap-2.5 px-6 py-2.5 rounded-[20px] text-sm font-semibold transition-all duration-200 hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none"
              style={{
                background: '#FFFFFF',
                color: 'var(--color-accent-green)',
                fontFamily: 'var(--font-display)',
                border: '1.5px solid var(--color-accent-green)',
              }}
            >
              {submitting ? (
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
                </svg>
              )}
              {submitting ? 'Creating...' : scheduleDate ? 'Schedule Post' : 'Add to Queue'}
            </button>
            <button
              onClick={() => {
                if (!currentPersona || selectedPlatforms.size === 0 || selectedImages.size === 0) {
                  setErrorMessage('Select images and at least one platform.');
                  return;
                }
                setPreviewMode('post-now');
                setPreviewOpen(true);
              }}
              disabled={postingNow || submitting || !currentPersona || selectedPlatforms.size === 0 || selectedImages.size === 0}
              className="flex items-center gap-2.5 px-5 py-2.5 rounded-[20px] text-sm font-semibold transition-all duration-200 hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none"
              style={{
                background: '#FFFFFF',
                color: 'var(--color-text-primary)',
                fontFamily: 'var(--font-display)',
                border: '1px solid var(--color-border)',
              }}
            >
              {postingNow ? (
                <div className="w-4 h-4 border-2 border-current/30 border-t-current rounded-full animate-spin" />
              ) : (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
                </svg>
              )}
              {postingNow ? 'Posting...' : 'Post Now'}
            </button>
            {aiCaption && (
              <button
                onClick={handleGenerateCaptions}
                disabled={generatingCaptions || selectedImages.size === 0}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-colors duration-150 disabled:opacity-50 disabled:pointer-events-none"
                style={{ background: 'var(--color-bg-tertiary)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}
              >
                {generatingCaptions ? (
                  <div className="w-3.5 h-3.5 border-2 border-current/30 border-t-current rounded-full animate-spin" />
                ) : (
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 3l1.912 5.813a2 2 0 001.272 1.272L21 12l-5.816 1.915a2 2 0 00-1.272 1.272L12 21" />
                  </svg>
                )}
                {generatingCaptions ? 'Generating...' : 'Generate Captions'}
              </button>
            )}
            {successMessage && (
              <span className="text-xs font-medium px-3 py-1.5 rounded-lg" style={{ background: 'var(--color-accent-green-muted)', color: 'var(--color-accent-green)' }}>{successMessage}</span>
            )}
            {errorMessage && (
              <span className="text-xs font-medium px-3 py-1.5 rounded-lg" style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444' }}>{errorMessage}</span>
            )}
          </div>
        </div>

        {/* Right — Preview card */}
        <div className="space-y-4">
          <label className="block text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--color-text-tertiary)' }}>Preview</label>
          <div className="rounded-xl border overflow-hidden" style={{ background: '#FFFFFF', borderColor: 'var(--color-border)' }}>
            {/* Image preview */}
            <div className="relative" style={{ aspectRatio: '4/5', background: 'var(--color-bg-tertiary)' }}>
              {selectedImages.size > 0 ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={Array.from(selectedImages)[0]} alt="Preview" className="w-full h-full object-cover" />
                  {selectedImages.size > 1 && (
                    <span className="absolute top-2 left-2 px-2 py-0.5 rounded-full text-[10px] font-bold" style={{ background: 'var(--color-accent-green)', color: '#fff' }}>
                      {selectedImages.size} images
                    </span>
                  )}
                </>
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <div className="text-center">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-tertiary)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="mx-auto mb-2">
                      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" />
                    </svg>
                    <p className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>Select an image</p>
                  </div>
                </div>
              )}
            </div>

            {/* Preview details */}
            <div className="p-4 space-y-3">
              <div className="flex items-center gap-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {currentPersona?.faceRefs?.[0] ? (
                  <img src={currentPersona.faceRefs[0]} alt="" className="w-5 h-5 rounded-full object-cover" />
                ) : (
                  <div className="w-5 h-5 rounded-full" style={{ background: 'var(--color-bg-tertiary)' }} />
                )}
                <span className="text-xs font-medium" style={{ color: 'var(--color-text-primary)' }}>{currentPersona?.name || ''}</span>
              </div>

              {captionIG || captionX ? (
                <p className="text-xs leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
                  {captionIG || captionX}
                </p>
              ) : (
                <p className="text-xs italic" style={{ color: 'var(--color-text-tertiary)' }}>Caption will appear here...</p>
              )}

              <div className="flex items-center gap-2 pt-1" style={{ borderTop: '1px solid var(--color-border)' }}>
                {Array.from(selectedPlatforms).map(id => {
                  const p = platforms.find(pl => pl.id === id);
                  return p ? (
                    <span key={id} className="px-1.5 py-0.5 rounded text-[10px] font-bold" style={{ background: `${p.color}15`, color: p.color }}>
                      {p.abbr}
                    </span>
                  ) : null;
                })}
                {scheduleDate ? (
                  <span className="text-[10px] ml-auto" style={{ color: 'var(--color-text-tertiary)' }}>
                    {new Date(`${scheduleDate}T${scheduleTime || '12:00'}`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    {scheduleTime && ` at ${scheduleTime}`}
                  </span>
                ) : (
                  <span className="text-[10px] ml-auto" style={{ color: 'var(--color-text-tertiary)' }}>Queued</span>
                )}
              </div>
            </div>
          </div>

          {/* Tips */}
          <div className="p-3 rounded-xl" style={{ background: 'var(--color-bg-tertiary)' }}>
            <div className="flex items-center gap-1.5 mb-2">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent-green)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 3l1.912 5.813a2 2 0 001.272 1.272L21 12l-5.816 1.915a2 2 0 00-1.272 1.272L12 21" />
              </svg>
              <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--color-accent-green)' }}>Tips</span>
            </div>
            <ul className="space-y-1.5">
              <li className="text-[11px] leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
                • Best posting times: 2-4pm EST for IG, 11am-1pm for X
              </li>
              <li className="text-[11px] leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
                • Use &quot;Generate Captions&quot; to auto-create per-platform captions
              </li>
              <li className="text-[11px] leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
                • Posting to 3+ platforms increases reach by 40%
              </li>
            </ul>
          </div>
        </div>
      </div>

      <LibraryPickerModal
        open={libraryOpen}
        onClose={() => setLibraryOpen(false)}
        onDone={(urls) => {
          setSelectedImages(prev => {
            const next = new Set(prev);
            urls.forEach(u => next.add(u));
            return next;
          });
        }}
        persona={currentPersona?.name || ''}
        alreadySelected={selectedImages}
      />

      <SchedulePreviewModal
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        onConfirm={handleConfirmSchedule}
        persona={{
          name: currentPersona?.name || '',
          avatar: currentPersona?.faceRefs?.[0],
        }}
        platforms={Array.from(selectedPlatforms)}
        captions={{
          ig: captionIG,
          twitter: captionX,
          threads: captionThreads,
          tiktok: captionTikTok,
        }}
        images={Array.from(selectedImages)}
        scheduleDate={scheduleDate}
        scheduleTime={scheduleTime}
        mode={previewMode}
      />
    </div>
  );
}
