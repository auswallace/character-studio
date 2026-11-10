'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';

// --- Types ---

interface InspirationPost {
  id: string;
  username: string;
  images: string[];
  caption: string;
  likes: number;
  views: number;
  postDate: string;
  postUrl: string;
  favorite: boolean;
}

interface InspirationTabProps {
  subTab: 'instagram' | 'x' | 'favorites' | 'trends';
  onSendToCopy: (imageUrl: string) => void;
  onSendToRemix: (imageUrl: string) => void;
}

interface XPost {
  id: string;
  tweetId: string;
  sourceAccount: string;
  imageUrl: string;
  likes: number;
  retweets: number;
  bookmarks: number;
  views: number;
  engagementScore: number;
  status: string;
  postUrl: string;
  scrapedAt: string;
}

interface ScrapeSettings {
  postCount: number;
  sort: 'Top' | 'Latest';
  photosOnly: boolean;
}

// --- Helpers ---

/** If an image fails to load (CORS), retry through our proxy */
function handleImgError(e: React.SyntheticEvent<HTMLImageElement>) {
  const img = e.currentTarget;
  const src = img.src;
  if (src.includes('/api/inspiration/image-proxy')) return;
  img.src = `/api/inspiration/image-proxy?url=${encodeURIComponent(src)}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatDate(dateStr: string): string {
  if (!dateStr) return '';
  const parts = dateStr.split('T')[0].split('-');
  if (parts.length < 3) return dateStr;
  const monthIdx = parseInt(parts[1], 10) - 1;
  const day = parseInt(parts[2], 10);
  const year = parseInt(parts[0], 10);
  return `${MONTHS[monthIdx]} ${day}, ${year}`;
}

function formatNumber(n: number): string {
  return n.toLocaleString();
}

// --- Lightbox Sub-component ---

interface InspirationLightboxProps {
  post: InspirationPost;
  imageIndex: number;
  onImageIndexChange: (index: number) => void;
  onClose: () => void;
  onSendToCopy: (imageUrl: string) => void;
  onSendToRemix: (imageUrl: string) => void;
  onToggleFavorite: (post: InspirationPost) => void;
}

function InspirationLightbox({ post, imageIndex, onImageIndexChange, onClose, onSendToCopy, onSendToRemix, onToggleFavorite }: InspirationLightboxProps) {
  const [mounted, setMounted] = useState(false);
  const [captionExpanded, setCaptionExpanded] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    const original = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = original; };
  }, []);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
    if (e.key === 'ArrowLeft' && post.images.length > 1) {
      onImageIndexChange(Math.max(0, imageIndex - 1));
    }
    if (e.key === 'ArrowRight' && post.images.length > 1) {
      onImageIndexChange(Math.min(post.images.length - 1, imageIndex + 1));
    }
  }, [onClose, post.images.length, imageIndex, onImageIndexChange]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  if (!mounted) return null;

  const currentImageUrl = post.images[imageIndex];
  const hasMultiple = post.images.length > 1;
  const hasPrev = imageIndex > 0;
  const hasNext = imageIndex < post.images.length - 1;

  return createPortal(
    <div
      className="fixed inset-0 flex items-center justify-center"
      style={{ zIndex: 50, background: 'rgba(0, 0, 0, 0.70)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}
    >
      {/* Close button */}
      <button onClick={onClose} className="absolute top-4 right-4 w-10 h-10 rounded-full flex items-center justify-center transition-colors" style={{ background: 'rgba(255,255,255,0.1)', color: 'white', zIndex: 51 }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>

      <div className="flex flex-col items-center gap-4 px-4" style={{ maxWidth: '90vw', maxHeight: '95vh' }} onClick={(e) => e.stopPropagation()}>
        <div className="relative flex items-center justify-center">
          {hasMultiple && hasPrev && (
            <button onClick={() => onImageIndexChange(imageIndex - 1)} className="absolute w-10 h-10 rounded-full flex items-center justify-center transition-colors" style={{ background: 'rgba(255,255,255,0.15)', color: 'white', zIndex: 51, left: '-52px', top: '50%', transform: 'translateY(-50%)' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
            </button>
          )}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={currentImageUrl} alt={`${post.username} post image ${imageIndex + 1}`} className="object-contain rounded-xl" style={{ maxHeight: '70vh', maxWidth: '90vw' }} onError={handleImgError} />
          {hasMultiple && hasNext && (
            <button onClick={() => onImageIndexChange(imageIndex + 1)} className="absolute w-10 h-10 rounded-full flex items-center justify-center transition-colors" style={{ background: 'rgba(255,255,255,0.15)', color: 'white', zIndex: 51, right: '-52px', top: '50%', transform: 'translateY(-50%)' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
            </button>
          )}
        </div>

        {hasMultiple && (
          <div className="px-3 py-1 rounded-full text-xs font-medium" style={{ background: 'rgba(0,0,0,0.5)', color: 'rgba(255,255,255,0.8)' }}>
            {imageIndex + 1} / {post.images.length}
          </div>
        )}

        {post.caption && (
          <div className="w-full" style={{ maxWidth: 600 }}>
            <p className="text-sm leading-relaxed" style={{ color: 'rgba(255,255,255,0.85)', display: '-webkit-box', WebkitLineClamp: captionExpanded ? 'unset' : 3, WebkitBoxOrient: 'vertical', overflow: captionExpanded ? 'visible' : 'hidden' }}>
              {post.caption}
            </p>
            {post.caption.length > 150 && (
              <button onClick={() => setCaptionExpanded(!captionExpanded)} className="text-xs mt-1 font-medium" style={{ color: 'var(--color-accent-green)', opacity: 0.9 }}>
                {captionExpanded ? 'Show less' : 'Show more'}
              </button>
            )}
          </div>
        )}

        <div className="flex items-center gap-3 text-xs" style={{ color: 'rgba(255,255,255,0.6)' }}>
          <span className="flex items-center gap-1">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style={{ color: '#ef4444' }}>
              <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
            </svg>
            {formatNumber(post.likes)}
          </span>
          <span style={{ color: 'rgba(255,255,255,0.3)' }}>&#183;</span>
          <span>{formatDate(post.postDate)}</span>
          <span style={{ color: 'rgba(255,255,255,0.3)' }}>&#183;</span>
          <a href={post.postUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 transition-colors" style={{ color: 'rgba(255,255,255,0.6)' }}
            onMouseEnter={(e) => e.currentTarget.style.color = 'rgba(255,255,255,0.9)'}
            onMouseLeave={(e) => e.currentTarget.style.color = 'rgba(255,255,255,0.6)'}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" />
            </svg>
          </a>
        </div>

        <div className="flex items-center gap-3 mt-1">
          <button
            onClick={() => onToggleFavorite(post)}
            className="px-4 py-2 rounded-[20px] text-sm font-medium transition-colors flex items-center gap-2"
            style={{ background: post.favorite ? 'rgba(250,204,21,0.15)' : 'rgba(255,255,255,0.1)', color: post.favorite ? '#facc15' : '#fff', border: `1px solid ${post.favorite ? 'rgba(250,204,21,0.3)' : 'rgba(255,255,255,0.25)'}` }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill={post.favorite ? '#facc15' : 'none'} stroke={post.favorite ? '#facc15' : 'currentColor'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
            </svg>
            {post.favorite ? 'Favorited' : 'Favorite'}
          </button>
          <button onClick={() => { onSendToCopy(currentImageUrl); onClose(); }} className="px-4 py-2 rounded-[20px] text-sm font-medium transition-colors" style={{ background: 'var(--color-accent-green)', color: '#fff' }}
            onMouseEnter={(e) => e.currentTarget.style.background = 'var(--color-accent-green-hover)'}
            onMouseLeave={(e) => e.currentTarget.style.background = 'var(--color-accent-green)'}
          >
            Send to Copy
          </button>
          <button onClick={() => { onSendToRemix(currentImageUrl); onClose(); }} className="px-4 py-2 rounded-[20px] text-sm font-medium transition-colors" style={{ background: 'transparent', color: '#fff', border: '1px solid rgba(255,255,255,0.25)' }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.1)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.4)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.25)'; }}
          >
            Send to Remix
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// --- Image Grid (shared between Scraped Content & Favorites) ---

interface ImageGridProps {
  posts: InspirationPost[];
  groupByAccount?: boolean;
  onOpenLightbox: (post: InspirationPost) => void;
  onToggleFavorite: (post: InspirationPost) => void;
}

function ImageGrid({ posts, groupByAccount, onOpenLightbox, onToggleFavorite }: ImageGridProps) {
  if (posts.length === 0) return null;

  // Group by username if requested
  const groups: { username: string; posts: InspirationPost[] }[] = [];
  if (groupByAccount) {
    const map = new Map<string, InspirationPost[]>();
    for (const p of posts) {
      const existing = map.get(p.username);
      if (existing) existing.push(p);
      else map.set(p.username, [p]);
    }
    for (const [username, group] of map) {
      groups.push({ username, posts: group });
    }
  } else {
    groups.push({ username: '', posts });
  }

  return (
    <>
      {groups.map((group) => (
        <div key={group.username || 'all'} className="space-y-3">
          {/* Account section header */}
          {groupByAccount && (
            <div className="flex items-center gap-2 pt-2">
              <span className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>@{group.username}</span>
              <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>{group.posts.length} posts</span>
            </div>
          )}

          {/* Grid — matches Gallery sizing */}
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8 gap-2">
            {group.posts.map((post) => (
              <div
                key={post.id}
                className="group relative rounded-xl overflow-hidden cursor-pointer"
                style={{ aspectRatio: '4/5', background: 'var(--color-bg-tertiary)' }}
                onClick={() => onOpenLightbox(post)}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={post.images[0]} alt={`Post by ${post.username}`} loading="lazy" className="w-full h-full object-cover" onError={handleImgError} />

                {/* Carousel badge */}
                {post.images.length > 1 && (
                  <div className="absolute top-1.5 right-1.5 flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[10px] font-medium" style={{ background: 'rgba(0,0,0,0.6)', color: '#fff', zIndex: 2 }}>
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="2" y="2" width="13" height="13" rx="2" /><rect x="9" y="9" width="13" height="13" rx="2" />
                    </svg>
                    {post.images.length}
                  </div>
                )}

                {/* Star button — top left */}
                <button
                  onClick={(e) => { e.stopPropagation(); onToggleFavorite(post); }}
                  className="absolute top-1.5 left-1.5 w-6 h-6 rounded-md flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                  style={{ background: post.favorite ? 'rgba(250,204,21,0.3)' : 'rgba(0,0,0,0.5)', zIndex: 2 }}
                  title={post.favorite ? 'Unfavorite' : 'Favorite'}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill={post.favorite ? '#facc15' : 'none'} stroke={post.favorite ? '#facc15' : 'white'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                  </svg>
                </button>

                {/* Hover overlay */}
                <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex flex-col justify-end p-2" style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.65) 0%, rgba(0,0,0,0.15) 50%, transparent 100%)', zIndex: 1 }}>
                  {!groupByAccount && (
                    <p className="text-[10px] font-medium mb-0.5" style={{ color: '#fff' }}>@{post.username}</p>
                  )}
                  <div className="flex items-center gap-2 text-[10px]" style={{ color: 'rgba(255,255,255,0.75)' }}>
                    <span className="flex items-center gap-0.5">
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" style={{ color: '#ef4444' }}>
                        <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
                      </svg>
                      {formatNumber(post.likes)}
                    </span>
                    <span>{formatDate(post.postDate)}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </>
  );
}

// ═══════════════════════════════════════════════════════════
// SCRAPE SETTINGS POPOVER
// ═══════════════════════════════════════════════════════════

function ScrapeSettingsPopover({ settings, onUpdate, showPhotosOnly }: {
  settings: ScrapeSettings;
  onUpdate: (s: ScrapeSettings) => void;
  showPhotosOnly: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="w-9 h-9 rounded-xl flex items-center justify-center transition-colors"
        style={{ background: open ? 'var(--color-accent-green-muted)' : 'var(--color-bg-tertiary)', color: open ? 'var(--color-accent-green)' : 'var(--color-text-tertiary)' }}
        title="Scrape settings"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-2 rounded-xl border p-4 space-y-4 w-56" style={{ background: '#FFFFFF', borderColor: 'var(--color-border)', zIndex: 20, boxShadow: '0 8px 24px rgba(0,0,0,0.3)' }}>
          {/* Post count */}
          <div>
            <label className="text-xs font-medium mb-2 block" style={{ color: 'var(--color-text-secondary)' }}>Post count</label>
            <div className="flex gap-1.5">
              {[10, 20, 30, 50].map(n => (
                <button key={n} onClick={() => onUpdate({ ...settings, postCount: n })}
                  className="flex-1 px-2 py-1.5 rounded-[20px] text-xs font-medium transition-colors"
                  style={{ background: settings.postCount === n ? '#DBEAFE' : 'var(--color-bg-tertiary)', color: settings.postCount === n ? '#1E40AF' : 'var(--color-text-secondary)' }}
                >{n}</button>
              ))}
            </div>
          </div>
          {/* Sort */}
          <div>
            <label className="text-xs font-medium mb-2 block" style={{ color: 'var(--color-text-secondary)' }}>Sort</label>
            <div className="flex gap-1.5">
              {(['Top', 'Latest'] as const).map(s => (
                <button key={s} onClick={() => onUpdate({ ...settings, sort: s })}
                  className="flex-1 px-2 py-1.5 rounded-[20px] text-xs font-medium transition-colors"
                  style={{ background: settings.sort === s ? '#DBEAFE' : 'var(--color-bg-tertiary)', color: settings.sort === s ? '#1E40AF' : 'var(--color-text-secondary)' }}
                >{s}</button>
              ))}
            </div>
          </div>
          {/* Photos only -- only for X */}
          {showPhotosOnly && (
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>Photos only</label>
              <button
                onClick={() => onUpdate({ ...settings, photosOnly: !settings.photosOnly })}
                className="w-9 h-5 rounded-full transition-colors relative"
                style={{ background: settings.photosOnly ? 'var(--color-accent-green)' : 'var(--color-bg-tertiary)' }}
              >
                <div className="absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform" style={{ left: settings.photosOnly ? '18px' : '2px' }} />
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// SCRAPED CONTENT VIEW (Instagram)
// ═══════════════════════════════════════════════════════════

function ScrapedContentView({ posts, accounts, isLoading, isScraping, scrapeInput, scrapeError, activeAccount, syncingAccount, deletingAccount, scrapeSettings, totalCost, onScrapeInputChange, onScrape, onAccountClick, onResync, onDelete, onOpenLightbox, onToggleFavorite, onUpdateSettings }: {
  posts: InspirationPost[];
  accounts: { username: string; count: number }[];
  isLoading: boolean;
  isScraping: boolean;
  scrapeInput: string;
  scrapeError: string | null;
  activeAccount: string | null;
  syncingAccount: string | null;
  deletingAccount: string | null;
  scrapeSettings: ScrapeSettings;
  totalCost: number;
  onScrapeInputChange: (v: string) => void;
  onScrape: () => void;
  onAccountClick: (username: string) => void;
  onResync: (username: string) => void;
  onDelete: (username: string) => void;
  onOpenLightbox: (post: InspirationPost) => void;
  onToggleFavorite: (post: InspirationPost) => void;
  onUpdateSettings: (s: ScrapeSettings) => void;
}) {
  return (
    <div className="space-y-5">
      {/* ── Scrape Bar + Account Filter ─────────────────── */}
      <div className="rounded-xl border p-4" style={{ background: '#FFFFFF', borderColor: 'var(--color-border)' }}>
        <div className="flex items-center gap-3">
          <input
            type="text"
            value={scrapeInput}
            onChange={(e) => onScrapeInputChange(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !isScraping) onScrape(); }}
            placeholder="Enter Instagram username..."
            disabled={isScraping}
            className="flex-1 px-3.5 py-2 rounded-xl text-sm outline-none transition-colors"
            style={{ background: 'var(--color-bg-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text-primary)', fontFamily: 'var(--font-body)', opacity: isScraping ? 0.6 : 1 }}
          />
          <ScrapeSettingsPopover settings={scrapeSettings} onUpdate={onUpdateSettings} showPhotosOnly={false} />
          <button
            onClick={onScrape}
            disabled={isScraping || !scrapeInput.trim()}
            className="px-4 py-2 rounded-xl text-sm font-medium transition-colors flex items-center gap-2 flex-shrink-0"
            style={{ background: isScraping || !scrapeInput.trim() ? 'var(--color-bg-tertiary)' : 'var(--color-accent-green)', color: isScraping || !scrapeInput.trim() ? 'var(--color-text-tertiary)' : '#fff', cursor: isScraping || !scrapeInput.trim() ? 'not-allowed' : 'pointer' }}
          >
            {isScraping ? (
              <>
                <svg className="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10" strokeOpacity="0.3" /><path d="M12 2a10 10 0 0 1 10 10" /></svg>
                Scraping...
              </>
            ) : (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
                Scrape
              </>
            )}
          </button>
          <span className="text-xs flex-shrink-0" style={{ color: 'var(--color-text-tertiary)' }}>
            ${totalCost.toFixed(2)} spent
          </span>

          {/* Account filter pills — inline next to scrape */}
          {accounts.length > 0 && (
            <>
              <div style={{ width: 1, height: 28, background: 'var(--color-border)', flexShrink: 0 }} />
              <div className="flex items-center gap-1.5 flex-shrink-0 overflow-x-auto">
                <button
                  onClick={() => onAccountClick('')}
                  className="px-2.5 py-1.5 rounded-[20px] text-xs font-medium transition-colors flex-shrink-0"
                  style={{ background: !activeAccount ? '#DBEAFE' : 'var(--color-bg-tertiary)', color: !activeAccount ? '#1E40AF' : 'var(--color-text-secondary)' }}
                >
                  All
                </button>
                {accounts.map((acc) => {
                  const isActive = activeAccount === acc.username;
                  const isSyncing = syncingAccount === acc.username;
                  const isDeleting = deletingAccount === acc.username;
                  return (
                    <div key={acc.username} className="flex items-center gap-0.5 flex-shrink-0">
                      <button
                        onClick={() => onAccountClick(acc.username)}
                        className="px-2.5 py-1.5 rounded-l-lg text-xs font-medium transition-colors"
                        style={{ background: isActive ? '#DBEAFE' : 'var(--color-bg-tertiary)', color: isActive ? '#1E40AF' : 'var(--color-text-secondary)' }}
                      >
                        @{acc.username}
                      </button>
                      {/* Re-sync button */}
                      <button
                        onClick={(e) => { e.stopPropagation(); onResync(acc.username); }}
                        disabled={isSyncing || isDeleting}
                        className="py-1.5 px-1.5 text-xs transition-colors"
                        style={{ background: isActive ? '#DBEAFE' : 'var(--color-bg-tertiary)', color: isActive ? '#1E40AF' : 'var(--color-text-tertiary)', opacity: isSyncing || isDeleting ? 0.5 : 1, cursor: isSyncing || isDeleting ? 'not-allowed' : 'pointer' }}
                        title="Re-sync account"
                      >
                        {isSyncing ? (
                          <svg className="animate-spin" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10" strokeOpacity="0.3" /><path d="M12 2a10 10 0 0 1 10 10" /></svg>
                        ) : (
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" /></svg>
                        )}
                      </button>
                      {/* Delete button */}
                      <button
                        onClick={(e) => { e.stopPropagation(); onDelete(acc.username); }}
                        disabled={isSyncing || isDeleting}
                        className="py-1.5 px-1.5 rounded-r-lg text-xs transition-colors"
                        style={{ background: isActive ? '#DBEAFE' : 'var(--color-bg-tertiary)', color: isDeleting ? '#ef4444' : (isActive ? '#1E40AF' : 'var(--color-text-tertiary)'), opacity: isSyncing || isDeleting ? 0.5 : 1, cursor: isSyncing || isDeleting ? 'not-allowed' : 'pointer' }}
                        title="Delete account"
                      >
                        {isDeleting ? (
                          <svg className="animate-spin" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10" strokeOpacity="0.3" /><path d="M12 2a10 10 0 0 1 10 10" /></svg>
                        ) : (
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                        )}
                      </button>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>

        {scrapeError && (
          <p className="text-xs mt-2" style={{ color: 'var(--color-error)' }}>{scrapeError}</p>
        )}
      </div>

      {/* ── Grid / Loading / Empty ──────────────────────── */}
      {isLoading ? (
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8 gap-2">
          {Array.from({ length: 24 }).map((_, i) => (
            <div key={i} className="rounded-xl animate-pulse" style={{ aspectRatio: '4/5', background: 'var(--color-bg-tertiary)' }} />
          ))}
        </div>
      ) : posts.length === 0 ? (
        <div className="rounded-xl border flex flex-col items-center justify-center py-20" style={{ background: '#FFFFFF', borderColor: 'var(--color-border)' }}>
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center mb-4" style={{ background: 'var(--color-accent-green-muted)' }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent-green)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" />
            </svg>
          </div>
          <p className="text-sm font-medium mb-1" style={{ color: 'var(--color-text-primary)' }}>No inspiration yet</p>
          <p className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>Enter an Instagram username above to start browsing</p>
        </div>
      ) : (
        <ImageGrid posts={posts} groupByAccount={!activeAccount} onOpenLightbox={onOpenLightbox} onToggleFavorite={onToggleFavorite} />
      )}
    </div>
  );
}

// --- X Image Grid (grouped by account, like IG ImageGrid) ---

function XImageGrid({ posts, groupByAccount, onOpenLightbox }: {
  posts: XPost[];
  groupByAccount: boolean;
  onOpenLightbox: (post: InspirationPost) => void;
}) {
  if (posts.length === 0) return null;

  const groups: { account: string; posts: XPost[] }[] = [];
  if (groupByAccount) {
    const map = new Map<string, XPost[]>();
    for (const p of posts) {
      const existing = map.get(p.sourceAccount);
      if (existing) existing.push(p);
      else map.set(p.sourceAccount, [p]);
    }
    for (const [account, group] of map) {
      groups.push({ account, posts: group });
    }
  } else {
    groups.push({ account: '', posts });
  }

  return (
    <>
      {groups.map((group) => (
        <div key={group.account || 'all'} className="space-y-3">
          {groupByAccount && (
            <div className="flex items-center gap-2 pt-2">
              <span className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>{group.account.startsWith('@') ? '' : '@'}{group.account}</span>
              <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>{group.posts.length} posts</span>
            </div>
          )}

          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8 gap-2">
            {group.posts.map((post) => {
              const asInspirationPost: InspirationPost = {
                id: post.id,
                username: post.sourceAccount,
                images: [post.imageUrl],
                caption: '',
                likes: post.likes,
                views: post.views,
                postDate: post.scrapedAt,
                postUrl: post.postUrl,
                favorite: false,
              };
              return (
                <div
                  key={post.id}
                  className="group relative rounded-xl overflow-hidden cursor-pointer"
                  style={{ aspectRatio: '4/5', background: 'var(--color-bg-tertiary)' }}
                  onClick={() => onOpenLightbox(asInspirationPost)}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={post.imageUrl} alt={`Post by ${post.sourceAccount}`} loading="lazy" className="w-full h-full object-cover" onError={handleImgError} />

                  {/* Engagement score badge */}
                  <div className="absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded-md text-[10px] font-bold"
                    style={{ background: 'rgba(0,0,0,0.7)', color: '#10b981', zIndex: 2 }}>
                    {post.engagementScore.toLocaleString()}
                  </div>

                  {/* Hover overlay */}
                  <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex flex-col justify-end p-2" style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.65) 0%, rgba(0,0,0,0.15) 50%, transparent 100%)', zIndex: 1 }}>
                    {!groupByAccount && (
                      <p className="text-[10px] font-medium mb-0.5" style={{ color: '#fff' }}>{post.sourceAccount}</p>
                    )}
                    <div className="flex items-center gap-2 text-[10px]" style={{ color: 'rgba(255,255,255,0.75)' }}>
                      <span>{post.likes.toLocaleString()} likes</span>
                      <span>{post.retweets.toLocaleString()} RT</span>
                      <span>{post.bookmarks.toLocaleString()} saves</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </>
  );
}

// ═══════════════════════════════════════════════════════════
// X CONTENT VIEW
// ═══════════════════════════════════════════════════════════

function XContentView({ posts, accounts, isLoading, isScraping, scrapeInput, scrapeError, activeAccount, deletingAccount, scrapeSettings, totalCost, onScrapeInputChange, onScrape, onAccountClick, onDelete, onOpenLightbox, onUpdateSettings }: {
  posts: XPost[];
  accounts: { account: string; count: number }[];
  isLoading: boolean;
  isScraping: boolean;
  scrapeInput: string;
  scrapeError: string | null;
  activeAccount: string | null;
  deletingAccount: string | null;
  scrapeSettings: ScrapeSettings;
  totalCost: number;
  onScrapeInputChange: (v: string) => void;
  onScrape: () => void;
  onAccountClick: (account: string) => void;
  onDelete: (account: string) => void;
  onOpenLightbox: (post: InspirationPost) => void;
  onUpdateSettings: (s: ScrapeSettings) => void;
}) {
  // Filter posts by account if selected
  const filteredPosts = activeAccount
    ? posts.filter(p => p.sourceAccount === activeAccount)
    : posts;

  return (
    <div className="space-y-5">
      {/* Scrape Bar */}
      <div className="rounded-xl border p-4" style={{ background: '#FFFFFF', borderColor: 'var(--color-border)' }}>
        <div className="flex items-center gap-3">
          <input
            type="text"
            value={scrapeInput}
            onChange={(e) => onScrapeInputChange(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !isScraping) onScrape(); }}
            placeholder="Enter X username..."
            disabled={isScraping}
            className="flex-1 px-3.5 py-2 rounded-xl text-sm outline-none transition-colors"
            style={{ background: 'var(--color-bg-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text-primary)', fontFamily: 'var(--font-body)', opacity: isScraping ? 0.6 : 1 }}
          />
          <ScrapeSettingsPopover settings={scrapeSettings} onUpdate={onUpdateSettings} showPhotosOnly={true} />
          <button
            onClick={onScrape}
            disabled={isScraping || !scrapeInput.trim()}
            className="px-4 py-2 rounded-xl text-sm font-medium transition-colors flex items-center gap-2 flex-shrink-0"
            style={{ background: isScraping || !scrapeInput.trim() ? 'var(--color-bg-tertiary)' : 'var(--color-accent-green)', color: isScraping || !scrapeInput.trim() ? 'var(--color-text-tertiary)' : '#fff', cursor: isScraping || !scrapeInput.trim() ? 'not-allowed' : 'pointer' }}
          >
            {isScraping ? (
              <>
                <svg className="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10" strokeOpacity="0.3" /><path d="M12 2a10 10 0 0 1 10 10" /></svg>
                Scraping...
              </>
            ) : (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
                Scrape
              </>
            )}
          </button>
          <span className="text-xs flex-shrink-0" style={{ color: 'var(--color-text-tertiary)' }}>
            ${totalCost.toFixed(2)} spent
          </span>

          {/* Account filter pills */}
          {accounts.length > 0 && (
            <>
              <div style={{ width: 1, height: 28, background: 'var(--color-border)', flexShrink: 0 }} />
              <div className="flex items-center gap-1.5 flex-shrink-0 overflow-x-auto">
                <button
                  onClick={() => onAccountClick('')}
                  className="px-2.5 py-1.5 rounded-[20px] text-xs font-medium transition-colors flex-shrink-0"
                  style={{ background: !activeAccount ? '#DBEAFE' : 'var(--color-bg-tertiary)', color: !activeAccount ? '#1E40AF' : 'var(--color-text-secondary)' }}
                >
                  All
                </button>
                {accounts.map((acc) => {
                  const isActive = activeAccount === acc.account;
                  const isDeleting = deletingAccount === acc.account;
                  return (
                    <div key={acc.account} className="flex items-center gap-0.5 flex-shrink-0">
                      <button
                        onClick={() => onAccountClick(acc.account)}
                        className="px-2.5 py-1.5 rounded-l-lg text-xs font-medium transition-colors"
                        style={{ background: isActive ? '#DBEAFE' : 'var(--color-bg-tertiary)', color: isActive ? '#1E40AF' : 'var(--color-text-secondary)' }}
                      >
                        {acc.account}
                      </button>
                      {/* Delete button */}
                      <button
                        onClick={(e) => { e.stopPropagation(); onDelete(acc.account); }}
                        disabled={isDeleting}
                        className="py-1.5 px-1.5 rounded-r-lg text-xs transition-colors"
                        style={{ background: isActive ? '#DBEAFE' : 'var(--color-bg-tertiary)', color: isDeleting ? '#ef4444' : (isActive ? '#1E40AF' : 'var(--color-text-tertiary)'), opacity: isDeleting ? 0.5 : 1, cursor: isDeleting ? 'not-allowed' : 'pointer' }}
                        title="Delete account"
                      >
                        {isDeleting ? (
                          <svg className="animate-spin" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10" strokeOpacity="0.3" /><path d="M12 2a10 10 0 0 1 10 10" /></svg>
                        ) : (
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                        )}
                      </button>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>

        {scrapeError && (
          <p className="text-xs mt-2" style={{ color: 'var(--color-error)' }}>{scrapeError}</p>
        )}
      </div>

      {/* Grid / Loading / Empty */}
      {isLoading ? (
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8 gap-2">
          {Array.from({ length: 24 }).map((_, i) => (
            <div key={i} className="rounded-xl animate-pulse" style={{ aspectRatio: '4/5', background: 'var(--color-bg-tertiary)' }} />
          ))}
        </div>
      ) : filteredPosts.length === 0 ? (
        <div className="rounded-xl border flex flex-col items-center justify-center py-20" style={{ background: '#FFFFFF', borderColor: 'var(--color-border)' }}>
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center mb-4" style={{ background: 'var(--color-accent-green-muted)' }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent-green)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 4l11.733 16h4.267l-11.733-16zM4 20l6.768-6.768M13.232 10.768L20 4" />
            </svg>
          </div>
          <p className="text-sm font-medium mb-1" style={{ color: 'var(--color-text-primary)' }}>No X posts yet</p>
          <p className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>Enter an X username above to start scraping</p>
        </div>
      ) : (
        <XImageGrid posts={filteredPosts} groupByAccount={!activeAccount} onOpenLightbox={onOpenLightbox} />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// FAVORITES VIEW
// ═══════════════════════════════════════════════════════════

function FavoritesView({ onOpenLightbox, onToggleFavorite, onSendToCopy, onSendToRemix }: {
  onOpenLightbox: (post: InspirationPost) => void;
  onToggleFavorite: (post: InspirationPost) => void;
  onSendToCopy: (imageUrl: string) => void;
  onSendToRemix: (imageUrl: string) => void;
}) {
  const [favorites, setFavorites] = useState<InspirationPost[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setIsLoading(true);
      try {
        const res = await fetch('/api/inspiration?favorites=1&limit=100');
        if (res.ok) {
          const data = await res.json();
          setFavorites(data.posts || []);
        }
      } catch { /* silent */ }
      setIsLoading(false);
    })();
  }, []);

  // Listen for favorite toggling from parent (optimistic update)
  const handleToggle = useCallback((post: InspirationPost) => {
    onToggleFavorite(post);
    // Optimistically remove from favorites list
    setFavorites(prev => prev.filter(p => p.id !== post.id));
  }, [onToggleFavorite]);

  if (isLoading) {
    return (
      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8 gap-2">
        {Array.from({ length: 16 }).map((_, i) => (
          <div key={i} className="rounded-xl animate-pulse" style={{ aspectRatio: '4/5', background: 'var(--color-bg-tertiary)' }} />
        ))}
      </div>
    );
  }

  if (favorites.length === 0) {
    return (
      <div className="rounded-xl border flex flex-col items-center justify-center py-20" style={{ background: '#FFFFFF', borderColor: 'var(--color-border)' }}>
        <div className="w-12 h-12 rounded-2xl flex items-center justify-center mb-4" style={{ background: 'rgba(250,204,21,0.1)' }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#facc15" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
          </svg>
        </div>
        <p className="text-sm font-medium mb-1" style={{ color: 'var(--color-text-primary)' }}>No favorites yet</p>
        <p className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>Star posts in Scraped Content to save them here</p>
      </div>
    );
  }

  void onSendToCopy;
  void onSendToRemix;

  return (
    <ImageGrid posts={favorites} groupByAccount={false} onOpenLightbox={onOpenLightbox} onToggleFavorite={handleToggle} />
  );
}

// ═══════════════════════════════════════════════════════════
// TRENDS VIEW (placeholder)
// ═══════════════════════════════════════════════════════════

function TrendsView() {
  const trendCards = [
    {
      title: 'Top Performing Posts',
      description: 'Posts sorted by engagement rate across all scraped accounts. See which content styles, poses, and settings generate the most likes and views.',
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" /><polyline points="17 6 23 6 23 12" />
        </svg>
      ),
    },
    {
      title: 'Best Posting Times',
      description: 'Analyze when scraped accounts post and which time slots get the highest engagement. Optimize your scheduling based on real data.',
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
        </svg>
      ),
    },
    {
      title: 'Visual Style Analysis',
      description: 'Breakdown of content types: outdoor vs indoor, solo vs lifestyle, casual vs glam. Map what resonates to guide your generation prompts.',
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" />
        </svg>
      ),
    },
    {
      title: 'Engagement Heatmap',
      description: 'Weekly and monthly heatmap showing engagement patterns across all tracked accounts. Spot seasonal trends and content cycles.',
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
        </svg>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <div className="rounded-xl border p-5" style={{ background: '#FFFFFF', borderColor: 'var(--color-border)' }}>
        <div className="flex items-center gap-3 mb-1">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'var(--color-accent-green-muted)' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent-green)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" /><polyline points="17 6 23 6 23 12" />
            </svg>
          </div>
          <div>
            <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>Trends & Analytics</h3>
            <p className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>Coming soon — performance insights from your scraped content</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {trendCards.map((card) => (
          <div
            key={card.title}
            className="rounded-xl border p-5"
            style={{ background: '#FFFFFF', borderColor: 'var(--color-border)', opacity: 0.6 }}
          >
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'var(--color-bg-tertiary)', color: 'var(--color-text-tertiary)' }}>
                {card.icon}
              </div>
              <div>
                <h4 className="text-sm font-semibold mb-1" style={{ color: 'var(--color-text-primary)' }}>{card.title}</h4>
                <p className="text-xs leading-relaxed" style={{ color: 'var(--color-text-tertiary)' }}>{card.description}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════

export default function InspirationTab({ subTab, onSendToCopy, onSendToRemix }: InspirationTabProps) {
  // IG data state
  const [accounts, setAccounts] = useState<{ username: string; count: number }[]>([]);
  const [activeAccount, setActiveAccount] = useState<string | null>(null);
  const [posts, setPosts] = useState<InspirationPost[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isScraping, setIsScraping] = useState(false);
  const [scrapeInput, setScrapeInput] = useState('');
  const [scrapeError, setScrapeError] = useState<string | null>(null);
  const [syncingAccount, setSyncingAccount] = useState<string | null>(null);
  const [deletingAccount, setDeletingAccount] = useState<string | null>(null);

  // X posts state
  const [xPosts, setXPosts] = useState<XPost[]>([]);
  const [xAccounts, setXAccounts] = useState<{ account: string; count: number }[]>([]);
  const [xSelectedAccount, setXSelectedAccount] = useState<string | null>(null);
  const [xLoading, setXLoading] = useState(false);
  const [xDeletingAccount, setXDeletingAccount] = useState<string | null>(null);

  // Settings (persisted in localStorage)
  const [scrapeSettings, setScrapeSettings] = useState<ScrapeSettings>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('scrapeSettings');
        if (saved) return JSON.parse(saved);
      } catch { /* ignore */ }
    }
    return { postCount: 30, sort: 'Top' as const, photosOnly: true };
  });

  // Cost
  const [totalCost, setTotalCost] = useState<number>(0);

  // Lightbox state
  const [lightboxPost, setLightboxPost] = useState<InspirationPost | null>(null);
  const [lightboxImageIndex, setLightboxImageIndex] = useState(0);

  // Persist settings
  useEffect(() => {
    localStorage.setItem('scrapeSettings', JSON.stringify(scrapeSettings));
  }, [scrapeSettings]);

  // --- Data fetching ---

  const fetchAccounts = useCallback(async () => {
    try {
      const res = await fetch('/api/inspiration/accounts');
      if (res.ok) {
        const data = await res.json();
        setAccounts(data.accounts || []);
      }
    } catch { /* silent */ }
  }, []);

  const fetchPosts = useCallback(async (username?: string | null) => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams({ limit: '100' });
      if (username) params.set('username', username);
      const res = await fetch(`/api/inspiration?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setPosts(data.posts || []);
      }
    } catch { /* silent */ }
    setIsLoading(false);
  }, []);

  const fetchXPosts = useCallback(async (account?: string | null) => {
    setXLoading(true);
    try {
      const params = new URLSearchParams();
      if (account) params.set('account', account);
      params.set('limit', '100');
      const res = await fetch(`/api/inspiration/x-posts?${params}`);
      const data = await res.json();
      setXPosts(data.posts || []);
      // Derive accounts from ALL posts (not filtered)
      if (!account) {
        const accountMap = new Map<string, number>();
        for (const p of (data.posts || []) as XPost[]) {
          accountMap.set(p.sourceAccount, (accountMap.get(p.sourceAccount) || 0) + 1);
        }
        setXAccounts(Array.from(accountMap.entries()).map(([a, c]) => ({ account: a, count: c })).sort((a, b) => b.count - a.count));
      }
    } catch (err) {
      console.error('[InspirationTab] X posts fetch failed:', err);
    } finally {
      setXLoading(false);
    }
  }, []);

  const fetchCosts = useCallback(async () => {
    try {
      const res = await fetch('/api/inspiration/scrape-costs');
      const data = await res.json();
      setTotalCost(data.total_cost_usd || 0);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    fetchAccounts();
    fetchPosts();
    fetchXPosts();
    fetchCosts();
  }, [fetchAccounts, fetchPosts, fetchXPosts, fetchCosts]);

  useEffect(() => {
    fetchPosts(activeAccount);
  }, [activeAccount, fetchPosts]);

  // --- IG Scrape handler ---

  const handleScrape = useCallback(async () => {
    const username = scrapeInput.trim().replace(/^@/, '');
    if (!username) return;
    setIsScraping(true);
    setScrapeError(null);
    try {
      const res = await fetch('/api/inspiration/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, limit: scrapeSettings.postCount }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Scrape failed (${res.status})`);
      }
      setScrapeInput('');
      await Promise.all([fetchAccounts(), fetchPosts(activeAccount), fetchCosts()]);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Scrape failed';
      setScrapeError(message);
      setTimeout(() => setScrapeError(null), 5000);
    } finally {
      setIsScraping(false);
    }
  }, [scrapeInput, activeAccount, scrapeSettings.postCount, fetchAccounts, fetchPosts, fetchCosts]);

  // --- X Scrape handler ---

  const handleXScrape = useCallback(async () => {
    const username = scrapeInput.trim().replace(/^@/, '');
    if (!username || isScraping) return;
    setIsScraping(true);
    setScrapeError(null);
    try {
      const res = await fetch('/api/inspiration/scrape-x', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username,
          limit: scrapeSettings.postCount,
          sort: scrapeSettings.sort,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Scrape failed (${res.status})`);
      setScrapeInput('');
      await fetchXPosts();
      await fetchCosts();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'X scrape failed';
      setScrapeError(message);
      setTimeout(() => setScrapeError(null), 5000);
    } finally {
      setIsScraping(false);
    }
  }, [scrapeInput, isScraping, scrapeSettings, fetchXPosts, fetchCosts]);

  // --- Account filter ---

  const handleAccountClick = useCallback((username: string) => {
    setActiveAccount(prev => (!username || prev === username) ? null : username);
  }, []);

  const handleXAccountClick = useCallback((account: string) => {
    setXSelectedAccount(prev => (!account || prev === account) ? null : account);
  }, []);

  // --- Re-sync account ---

  const handleResyncAccount = useCallback(async (username: string) => {
    setSyncingAccount(username);
    try {
      const res = await fetch('/api/inspiration/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, limit: scrapeSettings.postCount }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Re-sync failed (${res.status})`);
      }
      await Promise.all([fetchAccounts(), fetchPosts(activeAccount), fetchCosts()]);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Re-sync failed';
      setScrapeError(message);
      setTimeout(() => setScrapeError(null), 5000);
    } finally {
      setSyncingAccount(null);
    }
  }, [activeAccount, scrapeSettings.postCount, fetchAccounts, fetchPosts, fetchCosts]);

  // --- Delete IG account ---

  const handleDeleteAccount = useCallback(async (username: string) => {
    if (!confirm(`Delete @${username} and all scraped posts? This cannot be undone.`)) return;
    setDeletingAccount(username);
    try {
      const res = await fetch(`/api/inspiration/accounts/${encodeURIComponent(username)}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Delete failed (${res.status})`);
      }
      // If we were filtering by this account, reset filter
      if (activeAccount === username) {
        setActiveAccount(null);
      }
      await Promise.all([fetchAccounts(), fetchPosts(activeAccount === username ? null : activeAccount)]);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Delete failed';
      setScrapeError(message);
      setTimeout(() => setScrapeError(null), 5000);
    } finally {
      setDeletingAccount(null);
    }
  }, [activeAccount, fetchAccounts, fetchPosts]);

  // --- Delete X account ---

  const handleDeleteXAccount = useCallback(async (account: string) => {
    const cleanUsername = account.replace(/^@/, '');
    if (!confirm(`Delete ${account} and all scraped X posts? This cannot be undone.`)) return;
    setXDeletingAccount(account);
    try {
      const res = await fetch(`/api/inspiration/x-accounts/${encodeURIComponent(cleanUsername)}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Delete failed (${res.status})`);
      }
      if (xSelectedAccount === account) {
        setXSelectedAccount(null);
      }
      await fetchXPosts();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Delete failed';
      setScrapeError(message);
      setTimeout(() => setScrapeError(null), 5000);
    } finally {
      setXDeletingAccount(null);
    }
  }, [xSelectedAccount, fetchXPosts]);

  // --- Favorite toggle ---

  const handleToggleFavorite = useCallback(async (post: InspirationPost) => {
    const newVal = !post.favorite;
    // Optimistic update in scraped posts
    setPosts(prev => prev.map(p => p.id === post.id ? { ...p, favorite: newVal } : p));
    // Update lightbox post if open
    setLightboxPost(prev => prev && prev.id === post.id ? { ...prev, favorite: newVal } : prev);
    try {
      await fetch('/api/inspiration/favorite', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: post.id, favorite: newVal }),
      });
    } catch { /* silent -- optimistic update stays */ }
  }, []);

  // --- Lightbox ---

  const openLightbox = useCallback((post: InspirationPost) => {
    setLightboxPost(post);
    setLightboxImageIndex(0);
  }, []);

  // --- Render ---

  return (
    <div>
      {subTab === 'instagram' && (
        <ScrapedContentView
          posts={posts}
          accounts={accounts}
          isLoading={isLoading}
          isScraping={isScraping}
          scrapeInput={scrapeInput}
          scrapeError={scrapeError}
          activeAccount={activeAccount}
          syncingAccount={syncingAccount}
          deletingAccount={deletingAccount}
          scrapeSettings={scrapeSettings}
          totalCost={totalCost}
          onScrapeInputChange={setScrapeInput}
          onScrape={handleScrape}
          onAccountClick={handleAccountClick}
          onResync={handleResyncAccount}
          onDelete={handleDeleteAccount}
          onOpenLightbox={openLightbox}
          onToggleFavorite={handleToggleFavorite}
          onUpdateSettings={setScrapeSettings}
        />
      )}

      {subTab === 'x' && (
        <XContentView
          posts={xPosts}
          accounts={xAccounts}
          isLoading={xLoading}
          isScraping={isScraping}
          scrapeInput={scrapeInput}
          scrapeError={scrapeError}
          activeAccount={xSelectedAccount}
          deletingAccount={xDeletingAccount}
          scrapeSettings={scrapeSettings}
          totalCost={totalCost}
          onScrapeInputChange={setScrapeInput}
          onScrape={handleXScrape}
          onAccountClick={handleXAccountClick}
          onDelete={handleDeleteXAccount}
          onOpenLightbox={openLightbox}
          onUpdateSettings={setScrapeSettings}
        />
      )}

      {subTab === 'favorites' && (
        <FavoritesView
          onOpenLightbox={openLightbox}
          onToggleFavorite={handleToggleFavorite}
          onSendToCopy={onSendToCopy}
          onSendToRemix={onSendToRemix}
        />
      )}

      {subTab === 'trends' && <TrendsView />}

      {/* Lightbox -- shared across all sub-tabs */}
      {lightboxPost && (
        <InspirationLightbox
          post={lightboxPost}
          imageIndex={lightboxImageIndex}
          onImageIndexChange={setLightboxImageIndex}
          onClose={() => setLightboxPost(null)}
          onSendToCopy={onSendToCopy}
          onSendToRemix={onSendToRemix}
          onToggleFavorite={handleToggleFavorite}
        />
      )}
    </div>
  );
}
