'use client';

import { useState, useEffect, useCallback } from 'react';

// ─── Types ────────────────────────────────────────────────

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

interface LibraryPickerModalProps {
  open: boolean;
  onClose: () => void;
  onDone: (selectedUrls: string[]) => void;
  persona: string;
  alreadySelected: Set<string>;
}

const PAGE_SIZE = 20;

// ─── Component ────────────────────────────────────────────

export default function LibraryPickerModal({
  open,
  onClose,
  onDone,
  persona,
  alreadySelected,
}: LibraryPickerModalProps) {
  const [tab, setTab] = useState<'recent' | 'favorites'>('recent');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Recent tab state
  const [recentImages, setRecentImages] = useState<GenerationImage[]>([]);
  const [loadingRecent, setLoadingRecent] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);

  // Favorites tab state
  const [favoriteImages, setFavoriteImages] = useState<GenerationImage[]>([]);
  const [loadingFavorites, setLoadingFavorites] = useState(false);
  const [favoritesLoaded, setFavoritesLoaded] = useState(false);

  // ─── Fetch recent images (paginated) ────────────────────

  const fetchRecentPage = useCallback(async (pageOffset: number, append: boolean) => {
    if (!persona) return;

    if (append) setLoadingMore(true);
    else setLoadingRecent(true);

    try {
      const res = await fetch(
        `/api/generations?persona=${encodeURIComponent(persona)}&limit=${PAGE_SIZE}&offset=${pageOffset}`
      );
      const data = await res.json();

      const gens: Generation[] = data.generations || [];
      const flat: GenerationImage[] = gens.flatMap(g => g.images || []);

      if (append) {
        setRecentImages(prev => [...prev, ...flat]);
      } else {
        setRecentImages(flat);
      }

      setHasMore(gens.length >= PAGE_SIZE);
    } catch (err) {
      console.error('[LibraryPickerModal] Recent fetch error:', err);
    } finally {
      setLoadingRecent(false);
      setLoadingMore(false);
    }
  }, [persona]);

  // ─── Fetch favorites (all starred) ──────────────────────

  const fetchFavorites = useCallback(async () => {
    if (!persona) return;

    setLoadingFavorites(true);
    try {
      const [genRes, remixRes] = await Promise.all([
        fetch(`/api/generations?limit=1000`),
        fetch(`/api/remix?limit=1000`),
      ]);
      const genData = await genRes.json();
      const remixData = await remixRes.json();

      const starredGenImages: GenerationImage[] = (genData.generations || [])
        .filter((g: Generation) => g.starred && g.persona === persona)
        .flatMap((g: Generation) => g.images);

      const starredRemixImages: GenerationImage[] = (remixData.remixes || [])
        .filter((r: Remix) => r.starred && r.persona === persona)
        .flatMap((r: Remix) => r.variants);

      setFavoriteImages([...starredGenImages, ...starredRemixImages]);
      setFavoritesLoaded(true);
    } catch (err) {
      console.error('[LibraryPickerModal] Favorites fetch error:', err);
    } finally {
      setLoadingFavorites(false);
    }
  }, [persona]);

  // ─── Reset + fetch on open ─────────────────────────────

  useEffect(() => {
    if (open) {
      setSelected(new Set());
      setTab('recent');
      setOffset(0);
      setHasMore(true);
      setRecentImages([]);
      setFavoriteImages([]);
      setFavoritesLoaded(false);
      fetchRecentPage(0, false);
    }
  }, [open, persona, fetchRecentPage]);

  // ─── Fetch favorites on tab switch ─────────────────────

  useEffect(() => {
    if (open && tab === 'favorites' && !favoritesLoaded && !loadingFavorites) {
      fetchFavorites();
    }
  }, [open, tab, favoritesLoaded, loadingFavorites, fetchFavorites]);

  // ─── Load more (recent only) ───────────────────────────

  const handleLoadMore = () => {
    const nextOffset = offset + PAGE_SIZE;
    setOffset(nextOffset);
    fetchRecentPage(nextOffset, true);
  };

  // ─── Toggle selection ──────────────────────────────────

  const toggleImage = (url: string) => {
    if (alreadySelected.has(url)) return;
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(url)) next.delete(url);
      else next.add(url);
      return next;
    });
  };

  // ─── Done handler ──────────────────────────────────────

  const handleDone = () => {
    onDone(Array.from(selected));
    onClose();
  };

  // ─── Don't render when closed ──────────────────────────

  if (!open) return null;

  const images = tab === 'recent' ? recentImages : favoriteImages;
  const isLoading = tab === 'recent' ? loadingRecent : loadingFavorites;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="rounded-[16px] border flex flex-col w-[90vw] max-w-[900px]"
        style={{
          background: 'var(--color-bg-primary)',
          borderColor: 'var(--color-border)',
          maxHeight: '85vh',
          boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)',
        }}
      >
        {/* ─── Header ────────────────────────────────────── */}
        <div
          className="flex items-center justify-between px-6 py-4 shrink-0"
          style={{ borderBottom: '1px solid var(--color-border)' }}
        >
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'var(--color-accent-green-muted)' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent-green)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 19.5A2.5 2.5 0 016.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z" />
              </svg>
            </div>
            <div>
              <h3 className="text-sm font-semibold" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text-primary)' }}>
                Select from Library
              </h3>
              <p className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
                {persona}{selected.size > 0 && ` \u00b7 ${selected.size} selected`}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Recent / Favorites toggle */}
            <div className="flex rounded-lg overflow-hidden border" style={{ borderColor: 'var(--color-border)' }}>
              <button
                onClick={() => setTab('recent')}
                className="px-3 py-1 text-[11px] font-medium transition-colors duration-150"
                style={{
                  background: tab === 'recent' ? 'var(--color-accent-green)' : 'var(--color-bg-tertiary)',
                  color: tab === 'recent' ? '#ffffff' : 'var(--color-text-tertiary)',
                }}
              >
                Recent
              </button>
              <button
                onClick={() => setTab('favorites')}
                className="flex items-center gap-1 px-3 py-1 text-[11px] font-medium transition-colors duration-150"
                style={{
                  background: tab === 'favorites' ? 'var(--color-accent-green)' : 'var(--color-bg-tertiary)',
                  color: tab === 'favorites' ? '#ffffff' : 'var(--color-text-tertiary)',
                  borderLeft: '1px solid var(--color-border)',
                }}
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill={tab === 'favorites' ? '#ffffff' : 'var(--color-text-tertiary)'} stroke="none">
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                </svg>
                Favorites
              </button>
            </div>

            <button
              onClick={onClose}
              className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors hover:opacity-80"
              style={{ background: 'var(--color-bg-tertiary)' }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-tertiary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        {/* ─── Image Grid ────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto px-6 py-4" style={{ minHeight: 0 }}>
          {isLoading ? (
            <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-7 gap-2">
              {Array.from({ length: 12 }).map((_, i) => (
                <div key={i} className="skeleton rounded-xl" style={{ aspectRatio: '4/5' }} />
              ))}
            </div>
          ) : images.length === 0 ? (
            <div className="py-16 text-center">
              <p className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>
                {tab === 'favorites'
                  ? `No favorited images for ${persona}. Star images in the Library to see them here.`
                  : `No images found for ${persona}.`
                }
              </p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-7 gap-2">
                {images.map((img, i) => {
                  const fullUrl = img.url;
                  const displayUrl = img.thumbnails?.large?.url || img.url;
                  const inPost = alreadySelected.has(fullUrl);
                  const isSelected = selected.has(fullUrl);

                  return (
                    <div
                      key={`${fullUrl}-${i}`}
                      onClick={() => toggleImage(fullUrl)}
                      className={`relative rounded-xl overflow-hidden group transition-all duration-150 ${
                        inPost ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'
                      }`}
                      style={{
                        aspectRatio: '4/5',
                        outlineColor: isSelected ? 'var(--color-accent-green)' : undefined,
                        outlineWidth: isSelected ? '2px' : undefined,
                        outlineStyle: isSelected ? 'solid' : undefined,
                        outlineOffset: '1px',
                      }}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={displayUrl}
                        alt={img.filename || `Image ${i + 1}`}
                        className="w-full h-full object-cover"
                        loading="lazy"
                      />

                      {/* Selected checkmark */}
                      {isSelected && (
                        <div
                          className="absolute top-2 right-2 w-5 h-5 rounded-full flex items-center justify-center"
                          style={{ background: 'var(--color-accent-green)' }}
                        >
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        </div>
                      )}

                      {/* "In post" label */}
                      {inPost && (
                        <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ background: 'rgba(0,0,0,0.6)', color: 'rgba(255,255,255,0.8)' }}>
                            In post
                          </span>
                        </div>
                      )}

                      {/* Hover highlight for clickable images */}
                      {!inPost && !isSelected && (
                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors duration-150" />
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Load More — only for recent tab */}
              {tab === 'recent' && hasMore && (
                <div className="flex justify-center pt-4">
                  <button
                    onClick={handleLoadMore}
                    disabled={loadingMore}
                    className="flex items-center gap-2 px-5 py-2 rounded-xl text-xs font-medium transition-colors disabled:opacity-50"
                    style={{
                      background: 'var(--color-bg-tertiary)',
                      color: 'var(--color-text-secondary)',
                      border: '1px solid var(--color-border)',
                    }}
                  >
                    {loadingMore ? (
                      <div className="w-3.5 h-3.5 border-2 border-current/30 border-t-current rounded-full animate-spin" />
                    ) : (
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="7 13 12 18 17 13" /><polyline points="7 6 12 11 17 6" />
                      </svg>
                    )}
                    {loadingMore ? 'Loading...' : 'Load More'}
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        {/* ─── Footer ────────────────────────────────────── */}
        <div
          className="flex items-center justify-between px-6 py-4 shrink-0"
          style={{ borderTop: '1px solid var(--color-border)' }}
        >
          <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
            {images.length} image{images.length !== 1 ? 's' : ''} loaded
          </span>
          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-[20px] text-xs font-medium transition-colors"
              style={{
                background: 'var(--color-bg-tertiary)',
                color: 'var(--color-text-secondary)',
                border: '1px solid var(--color-border)',
              }}
            >
              Cancel
            </button>
            <button
              onClick={handleDone}
              disabled={selected.size === 0}
              className="px-5 py-2 rounded-[20px] text-xs font-semibold transition-all duration-200 hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none"
              style={{
                background: 'var(--color-accent-green)',
                color: '#ffffff',
                fontFamily: 'var(--font-display)',
                boxShadow: selected.size > 0 ? '0 0 16px rgba(22, 163, 74, 0.15)' : 'none',
              }}
            >
              Done ({selected.size})
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
