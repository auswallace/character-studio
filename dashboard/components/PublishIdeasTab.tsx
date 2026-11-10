'use client';

import { useState, useEffect, useCallback } from 'react';
import LibraryPickerModal from './LibraryPickerModal';

// ─── Types ────────────────────────────────────────────────

export interface PostIdea {
  id: string;
  persona: string;
  images: string[];
  caption_draft: string;
  platform: string;
  created_at: string;
  updated_at: string;
}

interface Persona {
  id: string;
  name: string;
  faceRefs: string[];
}

interface PublishIdeasTabProps {
  onFinalize?: (draft: PostIdea) => void;
}

const platformOptions = [
  { id: 'ig', label: 'Instagram', abbr: 'IG', color: '#E1306C' },
  { id: 'x', label: 'X / Twitter', abbr: 'X', color: '#1DA1F2' },
  { id: 'threads', label: 'Threads', abbr: 'TH', color: '#333333' },
  { id: 'tiktok', label: 'TikTok', abbr: 'TT', color: '#00f2ea' },
];

function getPlatformInfo(id: string) {
  return platformOptions.find(p => p.id === id) || platformOptions[0];
}

function formatDate(dateStr: string) {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ─── Loading Skeleton ─────────────────────────────────────

function DraftCardSkeleton() {
  return (
    <div
      className="rounded-xl border overflow-hidden animate-pulse"
      style={{ background: '#FFFFFF', borderColor: 'var(--color-border)' }}
    >
      <div className="aspect-[4/3]" style={{ background: 'var(--color-bg-tertiary)' }} />
      <div className="p-4 space-y-3">
        <div className="h-4 rounded w-3/4" style={{ background: 'var(--color-bg-tertiary)' }} />
        <div className="h-3 rounded w-full" style={{ background: 'var(--color-bg-tertiary)' }} />
        <div className="h-3 rounded w-1/2" style={{ background: 'var(--color-bg-tertiary)' }} />
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────

export default function PublishIdeasTab({ onFinalize }: PublishIdeasTabProps) {
  const [drafts, setDrafts] = useState<PostIdea[]>([]);
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);

  // New draft form state
  const [formPersona, setFormPersona] = useState('');
  const [formPlatform, setFormPlatform] = useState('ig');
  const [formImages, setFormImages] = useState<Set<string>>(new Set());
  const [formCaption, setFormCaption] = useState('');
  const [formSubmitting, setFormSubmitting] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);

  // Edit mode
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editCaption, setEditCaption] = useState('');
  const [editImages, setEditImages] = useState<Set<string>>(new Set());
  const [editLibraryOpen, setEditLibraryOpen] = useState(false);

  // Delete confirmation
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Hover tracking
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  // Lightbox
  const [lightboxImages, setLightboxImages] = useState<string[]>([]);
  const [lightboxIndex, setLightboxIndex] = useState(0);

  // ─── Lightbox keyboard navigation ──────────────────────

  useEffect(() => {
    if (lightboxImages.length === 0) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLightboxImages([]);
      if (e.key === 'ArrowRight') setLightboxIndex(prev => (prev + 1) % lightboxImages.length);
      if (e.key === 'ArrowLeft') setLightboxIndex(prev => (prev - 1 + lightboxImages.length) % lightboxImages.length);
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [lightboxImages]);

  // ─── Fetch data ─────────────────────────────────────────

  const fetchDrafts = useCallback(async () => {
    try {
      const res = await fetch('/api/post-ideas');
      const data = await res.json();
      if (data.ideas) setDrafts(data.ideas);
    } catch (err) {
      console.error('Failed to fetch drafts:', err);
    }
  }, []);

  useEffect(() => {
    async function init() {
      setLoading(true);
      try {
        const [configRes] = await Promise.all([
          fetch('/api/config'),
          fetchDrafts(),
        ]);
        const configData = await configRes.json();
        if (configData.personas) {
          setPersonas(configData.personas);
          if (!formPersona && configData.personas.length > 0) {
            setFormPersona(configData.personas[0].name);
          }
        }
      } catch (err) {
        console.error('Failed to initialize:', err);
      } finally {
        setLoading(false);
      }
    }
    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Create draft ────────────────────────────────────────

  const handleCreate = async () => {
    if (!formPersona) return;
    setFormSubmitting(true);
    try {
      const res = await fetch('/api/post-ideas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          persona: formPersona,
          platform: formPlatform,
          images: Array.from(formImages),
          caption_draft: formCaption,
        }),
      });
      if (res.ok) {
        setFormImages(new Set());
        setFormCaption('');
        setShowForm(false);
        await fetchDrafts();
      }
    } catch (err) {
      console.error('Failed to create draft:', err);
    } finally {
      setFormSubmitting(false);
    }
  };

  // ─── Update draft ────────────────────────────────────────

  const handleSaveDraft = async (id: string) => {
    try {
      await fetch(`/api/post-ideas/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          caption_draft: editCaption,
          images: Array.from(editImages),
        }),
      });
      setDrafts(prev => prev.map(d =>
        d.id === id ? { ...d, caption_draft: editCaption, images: Array.from(editImages), updated_at: new Date().toISOString() } : d
      ));
    } catch (err) {
      console.error('Failed to update draft:', err);
    } finally {
      setEditingId(null);
    }
  };

  // ─── Delete draft ────────────────────────────────────────

  const handleDelete = async (id: string) => {
    try {
      await fetch(`/api/post-ideas/${id}`, { method: 'DELETE' });
      setDrafts(prev => prev.filter(d => d.id !== id));
    } catch (err) {
      console.error('Failed to delete draft:', err);
    } finally {
      setDeletingId(null);
    }
  };

  // ─── Finalize draft → send to Create New ─────────────────

  const handleFinalize = (draft: PostIdea) => {
    if (onFinalize) {
      onFinalize(draft);
    }
  };

  // ─── Get persona for library picker ──────────────────────

  const getPersonaName = (name: string) => {
    return personas.find(p => p.name === name)?.name || personas[0]?.name || '';
  };

  // ─── Render ─────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2
            className="text-lg font-semibold"
            style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text-primary)' }}
          >
            Drafts
          </h2>
          <p className="text-sm mt-1" style={{ color: 'var(--color-text-secondary)' }}>
            Save posts with images and captions — finalize them when you&apos;re ready to schedule.
          </p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-2 px-4 py-2 rounded-[20px] text-sm font-medium transition-all duration-150"
          style={{
            background: showForm ? 'var(--color-bg-tertiary)' : '#FFFFFF',
            color: showForm ? 'var(--color-text-primary)' : 'var(--color-accent-green)',
            border: showForm ? 'none' : '1.5px solid var(--color-accent-green)',
          }}
        >
          {showForm ? (
            <>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
              Cancel
            </>
          ) : (
            <>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              New Draft
            </>
          )}
        </button>
      </div>

      {/* ─── New Draft Form ─────────────────────────────────── */}
      {showForm && (
        <div
          className="rounded-xl border p-5 space-y-4"
          style={{ background: '#FFFFFF', borderColor: 'var(--color-border)' }}
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Persona */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--color-text-secondary)' }}>
                Persona
              </label>
              <select
                value={formPersona}
                onChange={e => setFormPersona(e.target.value)}
                className="w-full px-3 py-2 rounded-lg text-sm border outline-none transition-colors"
                style={{
                  background: 'var(--color-bg-surface)',
                  borderColor: 'var(--color-border)',
                  color: 'var(--color-text-primary)',
                  fontFamily: 'var(--font-body)',
                }}
              >
                {personas.map(p => (
                  <option key={p.id} value={p.name}>{p.name}</option>
                ))}
              </select>
            </div>

            {/* Platform */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--color-text-secondary)' }}>
                Platform
              </label>
              <div className="flex gap-2">
                {platformOptions.map(p => (
                  <button
                    key={p.id}
                    onClick={() => setFormPlatform(p.id)}
                    className="flex-1 px-3 py-2 rounded-lg text-xs font-semibold transition-all duration-150 border"
                    style={{
                      background: formPlatform === p.id ? p.color + '22' : 'var(--color-bg-surface)',
                      borderColor: formPlatform === p.id ? p.color : 'var(--color-border)',
                      color: formPlatform === p.id ? p.color : 'var(--color-text-secondary)',
                    }}
                  >
                    {p.abbr}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Image Selection */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--color-text-secondary)' }}>
              Images
            </label>
            <div className="flex flex-wrap gap-2 items-center">
              {/* Selected image thumbnails */}
              {Array.from(formImages).map((url, i) => (
                <div key={i} className="relative w-16 h-16 rounded-lg overflow-hidden group">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt="" className="w-full h-full object-cover" />
                  <button
                    onClick={() => setFormImages(prev => {
                      const next = new Set(prev);
                      next.delete(url);
                      return next;
                    })}
                    className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>
              ))}
              {/* Add from Library button */}
              <button
                onClick={() => setLibraryOpen(true)}
                className="w-16 h-16 rounded-lg border-2 border-dashed flex flex-col items-center justify-center gap-0.5 transition-colors hover:border-[var(--color-accent-green)]"
                style={{ borderColor: 'var(--color-border-hover)', background: 'var(--color-bg-surface)' }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-tertiary)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 19.5A2.5 2.5 0 016.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z" />
                </svg>
                <span className="text-[9px]" style={{ color: 'var(--color-text-tertiary)' }}>Library</span>
              </button>
            </div>
            {formImages.size > 0 && (
              <p className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>
                {formImages.size} image{formImages.size !== 1 ? 's' : ''} selected
              </p>
            )}
          </div>

          {/* Caption */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--color-text-secondary)' }}>
              Caption Draft
            </label>
            <textarea
              value={formCaption}
              onChange={e => setFormCaption(e.target.value)}
              placeholder="Write a caption, notes, hashtags..."
              rows={3}
              className="w-full px-3 py-2 rounded-lg text-sm border outline-none transition-colors resize-none"
              style={{
                background: 'var(--color-bg-surface)',
                borderColor: 'var(--color-border)',
                color: 'var(--color-text-primary)',
                fontFamily: 'var(--font-body)',
              }}
            />
          </div>

          {/* Submit */}
          <div className="flex justify-end">
            <button
              onClick={handleCreate}
              disabled={formSubmitting || !formPersona}
              className="px-5 py-2 rounded-[20px] text-sm font-medium transition-all duration-150 disabled:opacity-50"
              style={{ background: '#FFFFFF', color: 'var(--color-accent-green)', border: '1.5px solid var(--color-accent-green)' }}
            >
              {formSubmitting ? 'Saving...' : 'Save Draft'}
            </button>
          </div>
        </div>
      )}

      {/* ─── Loading State ─────────────────────────────────── */}
      {loading && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => <DraftCardSkeleton key={i} />)}
        </div>
      )}

      {/* ─── Empty State ───────────────────────────────────── */}
      {!loading && drafts.length === 0 && (
        <div
          className="flex flex-col items-center justify-center py-20 rounded-xl border"
          style={{ background: '#FFFFFF', borderColor: 'var(--color-border)' }}
        >
          <svg
            width="48" height="48" viewBox="0 0 24 24" fill="none"
            stroke="var(--color-text-tertiary)" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"
            className="mb-4"
          >
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="16" y1="13" x2="8" y2="13" />
            <line x1="16" y1="17" x2="8" y2="17" />
          </svg>
          <p className="text-sm font-medium mb-1" style={{ color: 'var(--color-text-secondary)' }}>
            No drafts yet
          </p>
          <p className="text-xs mb-4" style={{ color: 'var(--color-text-tertiary)' }}>
            Save posts here before you&apos;re ready to schedule them.
          </p>
          <button
            onClick={() => setShowForm(true)}
            className="px-4 py-2 rounded-[20px] text-sm font-medium transition-all"
            style={{ background: '#FFFFFF', color: 'var(--color-accent-green)', border: '1.5px solid var(--color-accent-green)' }}
          >
            Create First Draft
          </button>
        </div>
      )}

      {/* ─── Drafts Grid ────────────────────────────────────── */}
      {!loading && drafts.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {drafts.map(draft => {
            const platform = getPlatformInfo(draft.platform);
            const hasImages = draft.images && draft.images.length > 0;
            const isHovered = hoveredId === draft.id;
            const isEditing = editingId === draft.id;
            const isDeleting = deletingId === draft.id;

            return (
              <div
                key={draft.id}
                className="rounded-xl border overflow-hidden transition-all duration-200 relative group"
                style={{
                  background: '#FFFFFF',
                  borderColor: isHovered ? 'var(--color-accent-green)' : 'var(--color-border)',
                  boxShadow: isHovered ? '0 4px 12px rgba(0,0,0,0.08)' : 'none',
                }}
                onMouseEnter={() => setHoveredId(draft.id)}
                onMouseLeave={() => setHoveredId(null)}
              >
                {/* Image area */}
                <div
                  className="relative aspect-[4/3] overflow-hidden"
                  style={{ background: 'var(--color-bg-tertiary)' }}
                >
                  {hasImages ? (
                    <>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={draft.images[0]}
                        alt=""
                        className="w-full h-full object-cover cursor-pointer"
                        loading="lazy"
                        onClick={(e) => {
                          e.stopPropagation();
                          setLightboxImages(draft.images);
                          setLightboxIndex(0);
                        }}
                      />
                      {draft.images.length > 1 && (
                        <span
                          className="absolute bottom-2 left-2 px-2 py-0.5 rounded-md text-[10px] font-bold"
                          style={{ background: 'rgba(0,0,0,0.65)', color: '#fff', backdropFilter: 'blur(4px)' }}
                        >
                          +{draft.images.length - 1} more
                        </span>
                      )}
                    </>
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <div className="text-center">
                        <svg
                          width="32" height="32" viewBox="0 0 24 24" fill="none"
                          stroke="var(--color-text-tertiary)" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"
                        >
                          <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                          <circle cx="8.5" cy="8.5" r="1.5" />
                          <polyline points="21 15 16 10 5 21" />
                        </svg>
                        <p className="text-[10px] mt-1" style={{ color: 'var(--color-text-tertiary)' }}>No images</p>
                      </div>
                    </div>
                  )}

                  {/* Persona badge — top left */}
                  <span
                    className="absolute top-2 left-2 px-2 py-0.5 rounded-md text-[10px] font-semibold uppercase tracking-wide"
                    style={{
                      background: 'rgba(0,0,0,0.65)',
                      color: '#fff',
                      backdropFilter: 'blur(4px)',
                    }}
                  >
                    {draft.persona}
                  </span>

                  {/* Platform badge — top right */}
                  <span
                    className="absolute top-2 right-2 px-2 py-0.5 rounded-md text-[10px] font-bold"
                    style={{
                      background: platform.color + 'dd',
                      color: '#fff',
                    }}
                  >
                    {platform.abbr}
                  </span>

                  {/* Hover action overlay */}
                  {isHovered && !isDeleting && !isEditing && (
                    <div
                      className="absolute inset-0 flex items-center justify-center gap-2 transition-opacity duration-150"
                      style={{ background: 'rgba(0,0,0,0.4)' }}
                    >
                      <button
                        onClick={() => {
                          setEditingId(draft.id);
                          setEditCaption(draft.caption_draft);
                          setEditImages(new Set(draft.images || []));
                        }}
                        className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                        style={{ background: 'rgba(255,255,255,0.9)', color: '#111' }}
                        title="Edit draft"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => setDeletingId(draft.id)}
                        className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                        style={{ background: 'rgba(239,68,68,0.9)', color: '#fff' }}
                        title="Delete draft"
                      >
                        Delete
                      </button>
                      <button
                        onClick={() => handleFinalize(draft)}
                        className="px-3 py-1.5 rounded-[20px] text-xs font-medium transition-all"
                        style={{ background: 'var(--color-accent-green)', color: '#fff' }}
                        title="Finalize — pick a date and schedule"
                      >
                        Finalize
                      </button>
                    </div>
                  )}
                </div>

                {/* Card body */}
                <div className="p-3.5 space-y-2">
                  {/* Edit mode */}
                  {isEditing ? (
                    <div className="space-y-3">
                      {/* Edit images */}
                      <div>
                        <label className="text-[10px] font-medium uppercase tracking-wider mb-1 block" style={{ color: 'var(--color-text-tertiary)' }}>
                          Images
                        </label>
                        <div className="flex flex-wrap gap-1.5 items-center">
                          {Array.from(editImages).map((url, i) => (
                            <div key={i} className="relative w-10 h-10 rounded overflow-hidden group/thumb">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={url} alt="" className="w-full h-full object-cover" />
                              <button
                                onClick={() => setEditImages(prev => {
                                  const next = new Set(prev);
                                  next.delete(url);
                                  return next;
                                })}
                                className="absolute inset-0 bg-black/50 opacity-0 group-hover/thumb:opacity-100 transition-opacity flex items-center justify-center"
                              >
                                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                                </svg>
                              </button>
                            </div>
                          ))}
                          <button
                            onClick={() => setEditLibraryOpen(true)}
                            className="w-10 h-10 rounded border-2 border-dashed flex items-center justify-center transition-colors hover:border-[var(--color-accent-green)]"
                            style={{ borderColor: 'var(--color-border-hover)', background: 'var(--color-bg-surface)' }}
                          >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-tertiary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                            </svg>
                          </button>
                        </div>
                      </div>
                      {/* Edit caption */}
                      <textarea
                        value={editCaption}
                        onChange={e => setEditCaption(e.target.value)}
                        rows={3}
                        autoFocus
                        className="w-full px-2.5 py-2 rounded-lg text-sm border outline-none resize-none"
                        style={{
                          background: 'var(--color-bg-surface)',
                          borderColor: 'var(--color-accent-green)',
                          color: 'var(--color-text-primary)',
                          fontFamily: 'var(--font-body)',
                        }}
                      />
                      <div className="flex gap-2 justify-end">
                        <button
                          onClick={() => setEditingId(null)}
                          className="px-3 py-1 rounded-md text-xs"
                          style={{ color: 'var(--color-text-secondary)' }}
                        >
                          Cancel
                        </button>
                        <button
                          onClick={() => handleSaveDraft(draft.id)}
                          className="px-3 py-1 rounded-[20px] text-xs font-medium"
                          style={{ background: 'var(--color-accent-green)', color: '#fff' }}
                        >
                          Save
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      {/* Caption display */}
                      <p
                        className="text-sm leading-relaxed"
                        style={{
                          color: draft.caption_draft ? 'var(--color-text-primary)' : 'var(--color-text-tertiary)',
                          fontFamily: 'var(--font-body)',
                          display: '-webkit-box',
                          WebkitLineClamp: 3,
                          WebkitBoxOrient: 'vertical',
                          overflow: 'hidden',
                          fontStyle: draft.caption_draft ? 'normal' : 'italic',
                        }}
                      >
                        {draft.caption_draft || 'No caption yet'}
                      </p>

                      {/* Meta row */}
                      <div className="flex items-center justify-between">
                        <p className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>
                          {formatDate(draft.created_at)}
                        </p>
                        {hasImages && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'var(--color-bg-tertiary)', color: 'var(--color-text-tertiary)' }}>
                            {draft.images.length} img{draft.images.length !== 1 ? 's' : ''}
                          </span>
                        )}
                      </div>
                    </>
                  )}
                </div>

                {/* Delete confirmation overlay */}
                {isDeleting && (
                  <div
                    className="absolute inset-0 flex flex-col items-center justify-center gap-3 z-10 rounded-xl"
                    style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)' }}
                  >
                    <p className="text-sm font-medium text-white">Delete this draft?</p>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setDeletingId(null)}
                        className="px-4 py-1.5 rounded-lg text-xs font-medium"
                        style={{ background: 'rgba(255,255,255,0.2)', color: '#fff' }}
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => handleDelete(draft.id)}
                        className="px-4 py-1.5 rounded-lg text-xs font-medium"
                        style={{ background: '#ef4444', color: '#fff' }}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ─── Library Picker for New Draft ─────────────────────── */}
      <LibraryPickerModal
        open={libraryOpen}
        onClose={() => setLibraryOpen(false)}
        onDone={(urls) => {
          setFormImages(prev => {
            const next = new Set(prev);
            urls.forEach(u => next.add(u));
            return next;
          });
        }}
        persona={getPersonaName(formPersona)}
        alreadySelected={formImages}
      />

      {/* ─── Library Picker for Edit Mode ────────────────────── */}
      <LibraryPickerModal
        open={editLibraryOpen}
        onClose={() => setEditLibraryOpen(false)}
        onDone={(urls) => {
          setEditImages(prev => {
            const next = new Set(prev);
            urls.forEach(u => next.add(u));
            return next;
          });
        }}
        persona={editingId ? getPersonaName(drafts.find(d => d.id === editingId)?.persona || '') : ''}
        alreadySelected={editImages}
      />

      {/* ─── Image Lightbox ───────────────────────────────────── */}
      {lightboxImages.length > 0 && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(8px)' }}
          onClick={() => setLightboxImages([])}
        >
          {/* Close button */}
          <button
            onClick={() => setLightboxImages([])}
            className="absolute top-4 right-4 w-10 h-10 rounded-full flex items-center justify-center transition-colors z-10"
            style={{ background: 'rgba(255,255,255,0.15)' }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>

          {/* Image counter */}
          {lightboxImages.length > 1 && (
            <div
              className="absolute top-4 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full text-xs font-medium"
              style={{ background: 'rgba(255,255,255,0.15)', color: '#fff' }}
            >
              {lightboxIndex + 1} / {lightboxImages.length}
            </div>
          )}

          {/* Previous arrow */}
          {lightboxImages.length > 1 && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setLightboxIndex(prev => (prev - 1 + lightboxImages.length) % lightboxImages.length);
              }}
              className="absolute left-4 w-10 h-10 rounded-full flex items-center justify-center transition-colors"
              style={{ background: 'rgba(255,255,255,0.15)' }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
          )}

          {/* Main image */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={lightboxImages[lightboxIndex]}
            alt=""
            className="max-w-[90vw] max-h-[85vh] object-contain rounded-lg"
            style={{ boxShadow: '0 8px 40px rgba(0,0,0,0.4)' }}
            onClick={(e) => e.stopPropagation()}
          />

          {/* Next arrow */}
          {lightboxImages.length > 1 && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setLightboxIndex(prev => (prev + 1) % lightboxImages.length);
              }}
              className="absolute right-4 w-10 h-10 rounded-full flex items-center justify-center transition-colors"
              style={{ background: 'rgba(255,255,255,0.15)' }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          )}

          {/* Thumbnail strip for multi-image */}
          {lightboxImages.length > 1 && (
            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex gap-2">
              {lightboxImages.map((url, i) => (
                <button
                  key={i}
                  onClick={(e) => {
                    e.stopPropagation();
                    setLightboxIndex(i);
                  }}
                  className="w-12 h-12 rounded-lg overflow-hidden transition-all duration-150"
                  style={{
                    border: i === lightboxIndex ? '2px solid var(--color-accent-green)' : '2px solid transparent',
                    opacity: i === lightboxIndex ? 1 : 0.5,
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt="" className="w-full h-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
