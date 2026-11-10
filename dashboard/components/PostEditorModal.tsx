'use client';

import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import PlatformIcon, { platformColors } from './PlatformIcon';
import SchedulePreviewModal from './SchedulePreviewModal';

// --- Types ---

export interface PostImage {
  id: string;
  url: string;
  filename: string;
  thumbnailUrl: string;
}

export interface EditablePost {
  id: string;
  status: string;
  image: string;
  imageThumbnail: string | null;
  images: PostImage[];
  video: string | null;
  platforms: string[];
  persona: string;
  captionIG: string;
  captionTwitter: string;
  captionTikTok: string;
  captionThreads: string;
  scheduledFor: string;
  scheduleMode: string;
  title: string;
  notes: string;
  publishedUrls?: string;
  error?: string | null;
}

interface PostEditorModalProps {
  post: EditablePost;
  onClose: () => void;
  onSaved: () => void;
  onDeleted: () => void;
}

// Map platform display names to caption keys
const PLATFORM_CAPTION_MAP: Record<string, { key: keyof CaptionState; label: string; charLimit?: number }> = {
  Instagram: { key: 'captionIG', label: 'Instagram' },
  Twitter: { key: 'captionTwitter', label: 'X / Twitter', charLimit: 280 },
  Threads: { key: 'captionThreads', label: 'Threads' },
  TikTok: { key: 'captionTikTok', label: 'TikTok' },
};

interface CaptionState {
  captionIG: string;
  captionTwitter: string;
  captionThreads: string;
  captionTikTok: string;
}

export default function PostEditorModal({ post, onClose, onSaved, onDeleted }: PostEditorModalProps) {
  const [mounted, setMounted] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [generatingPlatform, setGeneratingPlatform] = useState<string | null>(null);
  const [sendingToLate, setSendingToLate] = useState(false);
  const [lateUrls, setLateUrls] = useState(post.publishedUrls || '');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  // Editable state
  const [captions, setCaptions] = useState<CaptionState>({
    captionIG: post.captionIG,
    captionTwitter: post.captionTwitter,
    captionThreads: post.captionThreads,
    captionTikTok: post.captionTikTok,
  });
  const [images, setImages] = useState<PostImage[]>(post.images || []);
  const [scheduledFor, setScheduledFor] = useState(post.scheduledFor || '');
  const [activeTab, setActiveTab] = useState<string>(() => {
    // Default to first targeted platform
    return post.platforms[0] || 'Instagram';
  });

  // Drag state for image reorder
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  // Portal mount guard
  useEffect(() => { setMounted(true); }, []);

  // Body scroll lock
  useEffect(() => {
    const original = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = original; };
  }, []);

  // Keyboard: Escape — dismiss delete confirm first, then exit edit mode, then close modal
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      if (confirmDelete) {
        setConfirmDelete(false);
      } else if (editing) {
        // Exit edit mode and revert changes instead of closing
        setCaptions({
          captionIG: post.captionIG,
          captionTwitter: post.captionTwitter,
          captionThreads: post.captionThreads,
          captionTikTok: post.captionTikTok,
        });
        setImages(post.images || []);
        setScheduledFor(post.scheduledFor || '');
        setEditing(false);
        setErrorMessage(null);
      } else {
        onClose();
      }
    }
  }, [onClose, confirmDelete, editing, post]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // Which platforms does this post target?
  const targetPlatforms = post.platforms.filter(p => PLATFORM_CAPTION_MAP[p]);

  // --- Drag & Drop handlers ---
  const handleDragStart = (idx: number) => {
    setDragIndex(idx);
  };

  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    setDragOverIndex(idx);
  };

  const handleDrop = (idx: number) => {
    if (dragIndex === null || dragIndex === idx) {
      setDragIndex(null);
      setDragOverIndex(null);
      return;
    }
    const newImages = [...images];
    const [moved] = newImages.splice(dragIndex, 1);
    newImages.splice(idx, 0, moved);
    setImages(newImages);
    setDragIndex(null);
    setDragOverIndex(null);
  };

  const handleDragEnd = () => {
    setDragIndex(null);
    setDragOverIndex(null);
  };

  // --- Caption change ---
  const handleCaptionChange = (key: keyof CaptionState, value: string) => {
    setCaptions(prev => ({ ...prev, [key]: value }));
  };

  // --- AI Caption Generation ---
  const handleGenerateCaption = async (platform: string) => {
    const imageUrl = images[0]?.url || post.image;
    if (!imageUrl) return;

    setGeneratingPlatform(platform);
    setErrorMessage(null);
    try {
      const res = await fetch(`/api/social-posts/${post.id}/generate-caption`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform,
          imageUrl,
          persona: post.persona,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        console.error('Caption generation failed:', err);
        setErrorMessage(err.error || 'Failed to generate caption. Try again.');
        return;
      }

      const data = await res.json();
      const captionKey = PLATFORM_CAPTION_MAP[platform]?.key;
      if (captionKey && data.caption) {
        setCaptions(prev => ({ ...prev, [captionKey]: data.caption }));
      }
    } catch (err) {
      console.error('Caption generation error:', err);
      setErrorMessage('Network error generating caption. Check your connection.');
    } finally {
      setGeneratingPlatform(null);
    }
  };

  // --- Save ---
  const handleSave = async () => {
    setSaving(true);
    setErrorMessage(null);
    try {
      const body: Record<string, unknown> = {
        captionIG: captions.captionIG,
        captionTwitter: captions.captionTwitter,
        captionThreads: captions.captionThreads,
        captionTikTok: captions.captionTikTok,
      };

      // Include scheduledFor if changed
      if (scheduledFor !== (post.scheduledFor || '')) {
        body.scheduledFor = scheduledFor;
      }

      // Only send images if order changed — use attachment IDs so the backend
      // reorders existing files without re-downloading (signed URLs expire)
      const orderChanged = images.some((img, i) => img.id !== (post.images[i]?.id));
      if (orderChanged && images.length > 0) {
        body.images = images.map(img => ({ id: img.id, url: img.url }));
      }

      const res = await fetch(`/api/social-posts/${post.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        console.error('Save failed:', err);
        setErrorMessage(err.error || 'Failed to save changes. Try again.');
        return;
      }

      setEditing(false);
      onSaved();
    } catch (err) {
      console.error('Save error:', err);
      setErrorMessage('Network error saving changes. Check your connection.');
    } finally {
      setSaving(false);
    }
  };

  // --- Delete ---
  const handleDelete = async () => {
    setDeleting(true);
    setErrorMessage(null);
    try {
      const res = await fetch(`/api/social-posts/${post.id}`, {
        method: 'DELETE',
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        console.error('Delete failed:', err);
        setErrorMessage(err.error || 'Failed to delete post. Try again.');
        return;
      }

      onDeleted();
    } catch (err) {
      console.error('Delete error:', err);
      setErrorMessage('Network error deleting post. Check your connection.');
    } finally {
      setDeleting(false);
    }
  };

  // --- Cancel ---
  const handleCancel = () => {
    setCaptions({
      captionIG: post.captionIG,
      captionTwitter: post.captionTwitter,
      captionThreads: post.captionThreads,
      captionTikTok: post.captionTikTok,
    });
    setImages(post.images || []);
    setScheduledFor(post.scheduledFor || '');
    setEditing(false);
    setConfirmDelete(false);
    setErrorMessage(null);
  };

  // --- Send to Late ---
  const handleSendToLate = async () => {
    setSendingToLate(true);
    setErrorMessage(null);
    try {
      const res = await fetch(`/api/social-posts/${post.id}/send-to-late`, {
        method: 'POST',
      });

      const data = await res.json();

      if (!res.ok) {
        setErrorMessage(data.error || 'Failed to send to Late');
        return;
      }

      if (data.errors?.length > 0 && data.publishedUrls?.length === 0) {
        setErrorMessage(data.errors.join('; '));
        return;
      }

      // Update local Late URLs so "View in Late" links appear immediately
      if (data.publishedUrls?.length > 0) {
        const existing = lateUrls;
        const newUrls = data.publishedUrls.join('\n');
        setLateUrls(existing ? `${existing}\n${newUrls}` : newUrls);
      }

      // Show partial errors if some platforms failed
      if (data.errors?.length > 0) {
        setErrorMessage(`Partial: ${data.errors.join('; ')}`);
      }

      onSaved(); // Refresh parent data
    } catch (err) {
      console.error('Send to Late error:', err);
      setErrorMessage('Network error sending to Late. Check your connection.');
    } finally {
      setSendingToLate(false);
    }
  };

  // --- Confirm Send to Late (throws on failure for preview modal state machine) ---
  const handleConfirmSendToLate = async () => {
    // Save changes first
    const body: Record<string, unknown> = {
      captionIG: captions.captionIG,
      captionTwitter: captions.captionTwitter,
      captionThreads: captions.captionThreads,
      captionTikTok: captions.captionTikTok,
    };
    if (scheduledFor !== (post.scheduledFor || '')) {
      body.scheduledFor = scheduledFor;
    }
    const orderChanged = images.some((img, i) => img.id !== (post.images[i]?.id));
    if (orderChanged && images.length > 0) {
      body.images = images.map(img => ({ id: img.id, url: img.url }));
    }

    const saveRes = await fetch(`/api/social-posts/${post.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!saveRes.ok) {
      const err = await saveRes.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to save changes');
    }

    // Then send to Late
    const lateRes = await fetch(`/api/social-posts/${post.id}/send-to-late`, {
      method: 'POST',
    });
    const lateData = await lateRes.json();
    if (!lateRes.ok) {
      throw new Error(lateData.error || 'Failed to send to Late');
    }
    if (lateData.errors?.length > 0 && lateData.publishedUrls?.length === 0) {
      throw new Error(lateData.errors.join('; '));
    }

    // Update local state
    if (lateData.publishedUrls?.length > 0) {
      const newUrls = lateData.publishedUrls.join('\n');
      setLateUrls(prev => prev ? `${prev}\n${newUrls}` : newUrls);
    }
    setEditing(false);
    onSaved();
  };

  const hasLateUrls = lateUrls.includes('getlate.dev');

  // --- Render ---
  const date = post.scheduledFor
    ? new Date(post.scheduledFor).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
    : 'Not scheduled';
  const time = post.scheduledFor
    ? new Date(post.scheduledFor).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    : '';

  const statusLower = post.status.toLowerCase();

  // Get active caption info
  const activeCaptionInfo = PLATFORM_CAPTION_MAP[activeTab];
  const activeCaptionKey = activeCaptionInfo?.key || 'captionIG';
  const activeCaptionValue = captions[activeCaptionKey] || '';
  const charLimit = activeCaptionInfo?.charLimit;
  const isOverLimit = charLimit ? activeCaptionValue.length > charLimit : false;

  if (!mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 flex items-center justify-center"
      style={{ zIndex: 50, background: 'rgba(0, 0, 0, 0.7)', backdropFilter: 'blur(4px)' }}
      onClick={editing ? handleCancel : onClose}
    >
      <div
        className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-[16px] shadow-2xl"
        style={{
          background: 'var(--color-bg-primary)',
          border: '1px solid var(--color-border)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="sticky top-0 flex items-center justify-between px-6 py-4 border-b z-10"
          style={{
            background: 'var(--color-bg-primary)',
            borderColor: 'var(--color-border)',
          }}
        >
          <button
            onClick={editing ? handleCancel : onClose}
            className="flex items-center gap-2 text-sm font-medium transition-colors hover:opacity-80"
            style={{ color: 'var(--color-text-secondary)' }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
            {editing ? 'Cancel' : 'Back'}
          </button>

          <div className="flex items-center gap-2">
            {!editing ? (
              <button
                onClick={() => setEditing(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
                style={{
                  background: 'var(--color-accent-green-muted)',
                  color: 'var(--color-accent-green)',
                }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                  <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                </svg>
                Edit
              </button>
            ) : null}
            <button
              onClick={() => setConfirmDelete(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
              style={{
                background: 'var(--color-error-muted)',
                color: 'var(--color-error)',
              }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
              </svg>
              Delete
            </button>
          </div>
        </div>

        {/* Delete Confirmation */}
        {confirmDelete && (
          <div
            className="mx-6 mt-4 p-4 rounded-xl border flex items-center justify-between"
            style={{
              background: 'var(--color-error-muted)',
              borderColor: 'rgba(248, 113, 113, 0.3)',
            }}
          >
            <span className="text-sm font-medium" style={{ color: 'var(--color-error)' }}>
              Delete this post permanently?
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setConfirmDelete(false)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
                style={{ background: 'var(--color-bg-primary)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="px-3 py-1.5 rounded-lg text-xs font-bold transition-colors"
                style={{
                  background: 'var(--color-error)',
                  color: '#fff',
                  opacity: deleting ? 0.6 : 1,
                }}
              >
                {deleting ? 'Deleting...' : 'Yes, Delete'}
              </button>
            </div>
          </div>
        )}

        {/* Error Banner */}
        {errorMessage && (
          <div
            className="mx-6 mt-4 p-3 rounded-xl border flex items-center justify-between gap-3"
            style={{
              background: 'var(--color-error-muted)',
              borderColor: 'rgba(248, 113, 113, 0.3)',
            }}
          >
            <span className="text-xs font-medium" style={{ color: 'var(--color-error)' }}>
              {errorMessage}
            </span>
            <button
              onClick={() => setErrorMessage(null)}
              className="flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center transition-colors hover:opacity-80"
              style={{ color: 'var(--color-error)' }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        )}

        {/* Image Gallery */}
        {images.length > 0 && (
          <div className="px-6 pt-5">
            <div className="flex gap-3 overflow-x-auto pb-2">
              {images.map((img, idx) => (
                <div
                  key={img.id || idx}
                  draggable={editing}
                  onDragStart={() => handleDragStart(idx)}
                  onDragOver={(e) => handleDragOver(e, idx)}
                  onDrop={() => handleDrop(idx)}
                  onDragEnd={handleDragEnd}
                  className="relative flex-shrink-0 rounded-xl overflow-hidden transition-all duration-150"
                  style={{
                    width: images.length === 1 ? '100%' : 160,
                    height: images.length === 1 ? 280 : 160,
                    border: dragOverIndex === idx
                      ? '2px solid var(--color-accent-green)'
                      : '2px solid transparent',
                    opacity: dragIndex === idx ? 0.5 : 1,
                    cursor: editing ? 'grab' : 'default',
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={img.thumbnailUrl || img.url}
                    alt={img.filename || `Image ${idx + 1}`}
                    className="w-full h-full object-cover"
                    draggable={false}
                  />
                  {/* Drag handle overlay */}
                  {editing && images.length > 1 && (
                    <div
                      className="absolute top-2 left-2 w-6 h-6 rounded-md flex items-center justify-center"
                      style={{ background: 'rgba(0,0,0,0.6)' }}
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round">
                        <line x1="8" y1="6" x2="16" y2="6" />
                        <line x1="8" y1="12" x2="16" y2="12" />
                        <line x1="8" y1="18" x2="16" y2="18" />
                      </svg>
                    </div>
                  )}
                  {/* Image number badge */}
                  {images.length > 1 && (
                    <div
                      className="absolute top-2 right-2 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold"
                      style={{ background: 'rgba(0,0,0,0.6)', color: 'white' }}
                    >
                      {idx + 1}
                    </div>
                  )}
                </div>
              ))}
            </div>
            {editing && images.length > 1 && (
              <p className="text-[10px] font-medium mt-1" style={{ color: 'var(--color-text-tertiary)' }}>
                Drag to reorder images
              </p>
            )}
          </div>
        )}

        {/* Late Links — Prominent Position */}
        <div className="px-6 pt-4">
          {hasLateUrls ? (
            <div className="flex flex-wrap gap-2">
              {lateUrls.split('\n').filter(line => line.includes('getlate.dev')).map((line, i) => {
                const urlMatch = line.match(/(https:\/\/getlate\.dev\/app\/post\/[a-f0-9]+)/i);
                const platformMatch = line.match(/^(\w+):/);
                const url = urlMatch?.[1];
                const platform = platformMatch?.[1] || 'Late';
                if (!url) return null;
                return (
                  <a
                    key={i}
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors hover:opacity-80"
                    style={{
                      background: 'var(--color-info-muted)',
                      color: 'var(--color-info)',
                      border: '1px solid rgba(59, 130, 246, 0.2)',
                    }}
                  >
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
                      <polyline points="15 3 21 3 21 9" />
                      <line x1="10" y1="14" x2="21" y2="3" />
                    </svg>
                    {platform} on Late
                  </a>
                );
              })}
            </div>
          ) : statusLower === 'failed' ? (
            <div className="flex items-center gap-2 p-3 rounded-xl" style={{ background: 'var(--color-error-muted)', border: '1px solid rgba(248, 113, 113, 0.2)' }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--color-error)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" />
              </svg>
              <span className="text-xs font-medium flex-1" style={{ color: 'var(--color-error)' }}>
                Failed to send to Late{post.error ? `: ${post.error}` : ''}
              </span>
              <button
                onClick={handleSendToLate}
                disabled={sendingToLate}
                className="ml-auto px-3 py-1 rounded-lg text-xs font-semibold transition-colors hover:opacity-90"
                style={{ background: 'var(--color-error)', color: '#fff' }}
              >
                {sendingToLate ? 'Retrying...' : 'Retry'}
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2 py-1">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-tertiary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>Not yet sent to Late</span>
            </div>
          )}
        </div>

        {/* Single image fallback when no images array */}
        {images.length === 0 && post.image && (
          <div className="px-6 pt-5">
            <div className="rounded-xl overflow-hidden" style={{ maxHeight: 280 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={post.imageThumbnail || post.image}
                alt=""
                className="w-full object-cover"
                style={{ maxHeight: 280 }}
              />
            </div>
          </div>
        )}

        {/* Caption Editor / Viewer */}
        <div className="px-6 pt-5">
          {/* Platform tabs */}
          {targetPlatforms.length > 0 && (
            <div className="flex border-b" style={{ borderColor: 'var(--color-border)' }}>
              {targetPlatforms.map(plat => {
                const info = PLATFORM_CAPTION_MAP[plat];
                if (!info) return null;
                const isActive = activeTab === plat;
                const color = platformColors[plat] || '#666';
                return (
                  <button
                    key={plat}
                    onClick={() => setActiveTab(plat)}
                    className="flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium transition-colors relative"
                    style={{
                      color: isActive ? color : 'var(--color-text-tertiary)',
                    }}
                  >
                    <PlatformIcon platform={plat} size={13} />
                    {info.label}
                    {isActive && (
                      <div
                        className="absolute bottom-0 left-2 right-2 h-[2px] rounded-full"
                        style={{ background: color }}
                      />
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {/* Caption content */}
          <div className="pt-4 pb-2">
            {editing ? (
              <>
                <textarea
                  value={activeCaptionValue}
                  onChange={(e) => handleCaptionChange(activeCaptionKey, e.target.value)}
                  rows={4}
                  className="w-full px-4 py-3 rounded-xl text-sm resize-none transition-colors"
                  style={{
                    background: 'var(--color-bg-surface)',
                    color: 'var(--color-text-primary)',
                    border: `1px solid ${isOverLimit ? 'var(--color-error)' : 'var(--color-border-focus)'}`,
                    outline: 'none',
                    fontFamily: 'var(--font-display)',
                  }}
                  placeholder={`Write a caption for ${activeTab}...`}
                />
                <div className="flex items-center justify-between mt-2">
                  {/* Character count */}
                  {charLimit && (
                    <span
                      className="text-[11px] font-medium"
                      style={{ color: isOverLimit ? 'var(--color-error)' : 'var(--color-text-tertiary)' }}
                    >
                      {activeCaptionValue.length} / {charLimit}
                    </span>
                  )}
                  {!charLimit && <span />}

                  {/* Generate with AI */}
                  <button
                    onClick={() => handleGenerateCaption(activeTab)}
                    disabled={generatingPlatform !== null}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
                    style={{
                      background: generatingPlatform === activeTab
                        ? 'var(--color-bg-tertiary)'
                        : 'linear-gradient(135deg, var(--color-accent-green-muted), var(--color-info-muted))',
                      color: generatingPlatform === activeTab
                        ? 'var(--color-text-tertiary)'
                        : 'var(--color-accent-green)',
                      border: '1px solid var(--color-border)',
                      cursor: generatingPlatform ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {generatingPlatform === activeTab ? (
                      <>
                        <svg
                          width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                          style={{ animation: 'spin 1s linear infinite' }}
                        >
                          <path d="M23 4v6h-6" /><path d="M1 20v-6h6" />
                          <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
                        </svg>
                        Generating...
                      </>
                    ) : (
                      <>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M12 3l1.912 5.813a2 2 0 001.272 1.272L21 12l-5.816 1.915a2 2 0 00-1.272 1.272L12 21l-1.912-5.813a2 2 0 00-1.272-1.272L3 12l5.816-1.915a2 2 0 001.272-1.272L12 3z" />
                        </svg>
                        Generate with AI
                      </>
                    )}
                  </button>
                </div>
              </>
            ) : (
              <div className="min-h-[80px]">
                {activeCaptionValue ? (
                  <p className="text-sm leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
                    {activeCaptionValue}
                  </p>
                ) : (
                  <p className="text-sm italic" style={{ color: 'var(--color-text-tertiary)' }}>
                    No caption for {activeTab}
                  </p>
                )}
                {charLimit && activeCaptionValue && (
                  <span
                    className="text-[10px] font-medium mt-2 inline-block"
                    style={{ color: isOverLimit ? 'var(--color-error)' : 'var(--color-text-tertiary)' }}
                  >
                    {activeCaptionValue.length} / {charLimit} characters
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Post Metadata */}
        <div
          className="mx-6 mt-2 mb-4 p-4 rounded-xl"
          style={{ background: 'var(--color-bg-tertiary)' }}
        >
          <div className="grid grid-cols-2 gap-y-3 gap-x-6 text-xs">
            <div>
              <span className="font-medium uppercase tracking-wider" style={{ color: 'var(--color-text-tertiary)', fontSize: '10px' }}>
                Persona
              </span>
              <p className="mt-0.5 font-medium" style={{ color: 'var(--color-text-primary)' }}>
                {post.persona || 'None'}
              </p>
            </div>
            <div>
              <span className="font-medium uppercase tracking-wider" style={{ color: 'var(--color-text-tertiary)', fontSize: '10px' }}>
                Platforms
              </span>
              <div className="flex items-center gap-1.5 mt-0.5">
                {post.platforms.map(p => (
                  <span key={p} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold" style={{ background: `${platformColors[p] || '#666'}15`, color: platformColors[p] || '#666' }}>
                    <PlatformIcon platform={p} size={10} />
                    {p === 'Twitter' ? 'X' : p}
                  </span>
                ))}
              </div>
            </div>
            <div>
              <span className="font-medium uppercase tracking-wider" style={{ color: 'var(--color-text-tertiary)', fontSize: '10px' }}>
                Scheduled
              </span>
              {editing ? (
                <input
                  type="datetime-local"
                  value={scheduledFor ? new Date(new Date(scheduledFor).getTime() - new Date(scheduledFor).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : ''}
                  onChange={(e) => setScheduledFor(e.target.value ? new Date(e.target.value).toISOString() : '')}
                  className="mt-0.5 w-full rounded-lg px-2 py-1 text-xs font-medium"
                  style={{
                    background: 'var(--color-bg-primary)',
                    color: 'var(--color-text-primary)',
                    border: '1px solid var(--color-border)',
                    colorScheme: 'dark',
                  }}
                />
              ) : (
                <p className="mt-0.5 font-medium" style={{ color: 'var(--color-text-primary)' }}>
                  {date}{time ? ` at ${time}` : ''}
                </p>
              )}
            </div>
            <div>
              <span className="font-medium uppercase tracking-wider" style={{ color: 'var(--color-text-tertiary)', fontSize: '10px' }}>
                Status
              </span>
              <p className="mt-0.5">
                {statusLower === 'published' ? (
                  <span className="px-2 py-0.5 rounded-md text-[10px] font-medium" style={{ background: 'var(--color-success-muted)', color: 'var(--color-success)' }}>Published</span>
                ) : statusLower === 'scheduled' ? (
                  <span className="px-2 py-0.5 rounded-md text-[10px] font-medium" style={{ background: 'var(--color-info-muted)', color: 'var(--color-info)' }}>Scheduled</span>
                ) : statusLower === 'failed' ? (
                  <span className="px-2 py-0.5 rounded-md text-[10px] font-medium" style={{ background: 'var(--color-error-muted)', color: 'var(--color-error)' }}>Failed</span>
                ) : (
                  <span className="px-2 py-0.5 rounded-md text-[10px] font-medium" style={{ background: 'var(--color-accent-green-muted)', color: 'var(--color-accent-green)' }}>Draft</span>
                )}
              </p>
            </div>
            {post.notes && (
              <div className="col-span-2">
                <span className="font-medium uppercase tracking-wider" style={{ color: 'var(--color-text-tertiary)', fontSize: '10px' }}>
                  Notes
                </span>
                <p className="mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
                  {post.notes}
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Action Buttons */}
        {editing ? (
          <div
            className="sticky bottom-0 flex items-center justify-end gap-3 px-6 py-4 border-t"
            style={{
              background: 'var(--color-bg-primary)',
              borderColor: 'var(--color-border)',
            }}
          >
            <button
              onClick={handleCancel}
              className="px-4 py-2 rounded-[20px] text-sm font-medium transition-colors"
              style={{
                background: 'var(--color-bg-tertiary)',
                color: 'var(--color-text-secondary)',
                border: '1px solid var(--color-border)',
              }}
            >
              Cancel
            </button>
            {!hasLateUrls && (
              <button
                onClick={() => setPreviewOpen(true)}
                disabled={saving || sendingToLate || isOverLimit}
                className="flex items-center gap-2 px-5 py-2 rounded-[20px] text-sm font-semibold transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
                style={{
                  background: saving || sendingToLate ? 'var(--color-bg-tertiary)' : 'var(--color-info)',
                  color: saving || sendingToLate ? 'var(--color-text-tertiary)' : '#ffffff',
                  fontFamily: 'var(--font-display)',
                  cursor: saving || sendingToLate || isOverLimit ? 'not-allowed' : 'pointer',
                }}
              >
                {sendingToLate ? (
                  <>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ animation: 'spin 1s linear infinite' }}>
                      <path d="M23 4v6h-6" /><path d="M1 20v-6h6" />
                      <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
                    </svg>
                    Sending to Late...
                  </>
                ) : (
                  <>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="22" y1="2" x2="11" y2="13" />
                      <polygon points="22 2 15 22 11 13 2 9 22 2" />
                    </svg>
                    Save & Send to Late
                  </>
                )}
              </button>
            )}
            <button
              onClick={handleSave}
              disabled={saving || isOverLimit}
              className="flex items-center gap-2 px-5 py-2 rounded-[20px] text-sm font-semibold transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
              style={{
                background: saving ? 'var(--color-bg-tertiary)' : 'var(--color-accent-green)',
                color: saving ? 'var(--color-text-tertiary)' : '#ffffff',
                fontFamily: 'var(--font-display)',
                boxShadow: saving ? 'none' : '0 0 24px rgba(22, 163, 74, 0.15), 0 1px 2px rgba(0,0,0,0.1)',
                cursor: saving || isOverLimit ? 'not-allowed' : 'pointer',
                opacity: isOverLimit ? 0.5 : 1,
              }}
            >
              {saving ? (
                <>
                  <svg
                    width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                    style={{ animation: 'spin 1s linear infinite' }}
                  >
                    <path d="M23 4v6h-6" /><path d="M1 20v-6h6" />
                    <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
                  </svg>
                  Saving...
                </>
              ) : (
                'Save Changes'
              )}
            </button>
          </div>
        ) : !hasLateUrls ? (
          <div
            className="sticky bottom-0 flex items-center justify-center px-6 py-4 border-t"
            style={{
              background: 'var(--color-bg-primary)',
              borderColor: 'var(--color-border)',
            }}
          >
            <button
              onClick={handleSendToLate}
              disabled={sendingToLate}
              className="flex items-center gap-2 px-6 py-2.5 rounded-[20px] text-sm font-semibold transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
              style={{
                background: sendingToLate ? 'var(--color-bg-tertiary)' : 'var(--color-info)',
                color: sendingToLate ? 'var(--color-text-tertiary)' : '#ffffff',
                fontFamily: 'var(--font-display)',
                boxShadow: sendingToLate ? 'none' : '0 0 24px rgba(59, 130, 246, 0.3), 0 1px 2px rgba(0,0,0,0.3)',
                cursor: sendingToLate ? 'not-allowed' : 'pointer',
              }}
            >
              {sendingToLate ? (
                <>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ animation: 'spin 1s linear infinite' }}>
                    <path d="M23 4v6h-6" /><path d="M1 20v-6h6" />
                    <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
                  </svg>
                  Sending to Late...
                </>
              ) : (
                <>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="22" y1="2" x2="11" y2="13" />
                    <polygon points="22 2 15 22 11 13 2 9 22 2" />
                  </svg>
                  Send to Late
                </>
              )}
            </button>
          </div>
        ) : null}
      </div>

      {previewOpen && (
        <SchedulePreviewModal
          open={previewOpen}
          onClose={() => setPreviewOpen(false)}
          onConfirm={handleConfirmSendToLate}
          persona={{
            name: post.persona,
          }}
          platforms={post.platforms}
          captions={{
            ig: captions.captionIG,
            twitter: captions.captionTwitter,
            threads: captions.captionThreads,
            tiktok: captions.captionTikTok,
          }}
          images={images.map(img => img.url)}
          scheduleDate={scheduledFor ? new Date(scheduledFor).toISOString().split('T')[0] : ''}
          scheduleTime={scheduledFor ? new Date(scheduledFor).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }) : ''}
          mode="schedule"
        />
      )}
    </div>,
    document.body
  );
}
