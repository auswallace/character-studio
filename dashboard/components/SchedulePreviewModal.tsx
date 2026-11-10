'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import PlatformIcon from './PlatformIcon';

// --- Types ---

interface SchedulePreviewModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
  persona: { name: string; avatar?: string };
  platforms: string[];
  captions: { ig: string; twitter: string; threads: string; tiktok: string };
  images: string[];
  scheduleDate?: string;
  scheduleTime?: string;
  mode: 'schedule' | 'post-now';
}

type ModalState = 'preview' | 'loading' | 'success' | 'failed';

// --- Platform Mockup Sub-Components ---

function PersonaAvatar({ avatar, name, size = 32 }: { avatar?: string; name: string; size?: number }) {
  if (avatar) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={avatar}
        alt={name}
        style={{
          width: size,
          height: size,
          borderRadius: '50%',
          objectFit: 'cover',
          flexShrink: 0,
        }}
      />
    );
  }
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: 'linear-gradient(135deg, #16A34A, #15803D)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        color: '#fff',
        fontSize: size * 0.4,
        fontWeight: 700,
      }}
    >
      {name.charAt(0).toUpperCase()}
    </div>
  );
}

function InstagramMockup({
  persona,
  caption,
  imageUrl,
}: {
  persona: { name: string; avatar?: string };
  caption: string;
  imageUrl: string;
}) {
  const handle = persona.name.toLowerCase().replace(/\s+/g, '');
  const truncated = caption.length > 125 ? caption.slice(0, 125) + '...' : caption;

  return (
    <div
      style={{
        background: '#000',
        borderRadius: 16,
        overflow: 'hidden',
        width: 280,
        flexShrink: 0,
        border: '1px solid rgba(255,255,255,0.1)',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px' }}>
        <PersonaAvatar avatar={persona.avatar} name={persona.name} size={32} />
        <span style={{ color: '#fff', fontSize: 13, fontWeight: 600 }}>{handle}</span>
      </div>
      {/* Image */}
      <div style={{ width: '100%', aspectRatio: '4/5', overflow: 'hidden' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imageUrl}
          alt=""
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        />
      </div>
      {/* Engagement icons */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '12px 14px 8px' }}>
        {/* Heart */}
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.8)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z" />
        </svg>
        {/* Comment */}
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.8)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
        </svg>
        {/* Share */}
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.8)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="22" y1="2" x2="11" y2="13" />
          <polygon points="22 2 15 22 11 13 2 9 22 2" />
        </svg>
        <div style={{ flex: 1 }} />
        {/* Bookmark */}
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.8)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z" />
        </svg>
      </div>
      {/* Caption */}
      <div style={{ padding: '0 14px 14px' }}>
        <p style={{ color: 'rgba(255,255,255,0.8)', fontSize: 12, lineHeight: 1.5, margin: 0 }}>
          <span style={{ fontWeight: 700, color: '#fff' }}>{handle}</span>{' '}
          {truncated}
        </p>
      </div>
    </div>
  );
}

function TwitterMockup({
  persona,
  caption,
  imageUrl,
}: {
  persona: { name: string; avatar?: string };
  caption: string;
  imageUrl: string;
}) {
  const handle = '@' + persona.name.toLowerCase().replace(/\s+/g, '');

  return (
    <div
      style={{
        background: '#15202b',
        borderRadius: 16,
        overflow: 'hidden',
        width: 280,
        flexShrink: 0,
        border: '1px solid rgba(255,255,255,0.1)',
        padding: 14,
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <PersonaAvatar avatar={persona.avatar} name={persona.name} size={40} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ color: '#fff', fontSize: 13, fontWeight: 700 }}>{persona.name}</span>
            <span style={{ color: '#8899a6', fontSize: 12 }}>{handle}</span>
            <span style={{ color: '#8899a6', fontSize: 12 }}>· now</span>
          </div>
          {/* Caption */}
          <p style={{ color: '#fff', fontSize: 13, lineHeight: 1.5, margin: '6px 0 10px' }}>
            {caption.length > 200 ? caption.slice(0, 200) + '...' : caption}
          </p>
          {/* Image */}
          <div style={{ borderRadius: 12, overflow: 'hidden', aspectRatio: '16/9' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={imageUrl}
              alt=""
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
            />
          </div>
          {/* Engagement row */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 }}>
            {/* Reply */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#8899a6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
              </svg>
              <span style={{ color: '#8899a6', fontSize: 11 }}>12</span>
            </div>
            {/* Retweet */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#8899a6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17 1l4 4-4 4" /><path d="M3 11V9a4 4 0 014-4h14" />
                <path d="M7 23l-4-4 4-4" /><path d="M21 13v2a4 4 0 01-4 4H3" />
              </svg>
              <span style={{ color: '#8899a6', fontSize: 11 }}>3</span>
            </div>
            {/* Heart */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#8899a6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z" />
              </svg>
              <span style={{ color: '#8899a6', fontSize: 11 }}>47</span>
            </div>
            {/* Views */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#8899a6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
              <span style={{ color: '#8899a6', fontSize: 11 }}>2.1K</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ThreadsMockup({
  persona,
  caption,
  imageUrl,
}: {
  persona: { name: string; avatar?: string };
  caption: string;
  imageUrl: string;
}) {
  const handle = '@' + persona.name.toLowerCase().replace(/\s+/g, '');

  return (
    <div
      style={{
        background: '#101010',
        borderRadius: 16,
        overflow: 'hidden',
        width: 280,
        flexShrink: 0,
        border: '1px solid rgba(255,255,255,0.1)',
        padding: 14,
      }}
    >
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        <PersonaAvatar avatar={persona.avatar} name={persona.name} size={36} />
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Name line */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ color: '#fff', fontSize: 13, fontWeight: 700 }}>{persona.name}</span>
            <span style={{ color: '#777', fontSize: 12 }}>{handle}</span>
          </div>
          {/* Caption */}
          <p style={{ color: '#e0e0e0', fontSize: 13, lineHeight: 1.5, margin: '8px 0 10px' }}>
            {caption.length > 180 ? caption.slice(0, 180) + '...' : caption}
          </p>
          {/* Image */}
          <div style={{ borderRadius: 12, overflow: 'hidden' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={imageUrl}
              alt=""
              style={{ width: '100%', objectFit: 'cover', display: 'block', maxHeight: 200 }}
            />
          </div>
          {/* Engagement */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 20, marginTop: 12 }}>
            {/* Heart */}
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#777" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z" />
            </svg>
            {/* Comment */}
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#777" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
            </svg>
            {/* Repost */}
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#777" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 1l4 4-4 4" /><path d="M3 11V9a4 4 0 014-4h14" />
              <path d="M7 23l-4-4 4-4" /><path d="M21 13v2a4 4 0 01-4 4H3" />
            </svg>
            {/* Share */}
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#777" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
}

function TikTokMockup({
  persona,
  caption,
  imageUrl,
}: {
  persona: { name: string; avatar?: string };
  caption: string;
  imageUrl: string;
}) {
  const handle = '@' + persona.name.toLowerCase().replace(/\s+/g, '');
  const shortCaption = caption.length > 60 ? caption.slice(0, 60) + '...' : caption;

  return (
    <div
      style={{
        width: 200,
        aspectRatio: '9/16',
        borderRadius: 16,
        overflow: 'hidden',
        position: 'relative',
        flexShrink: 0,
        border: '1px solid rgba(255,255,255,0.1)',
      }}
    >
      {/* Background image */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={imageUrl}
        alt=""
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          objectFit: 'cover',
        }}
      />
      {/* Bottom-left overlay: handle + caption */}
      <div
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 48,
          padding: '12px 10px',
          background: 'linear-gradient(transparent, rgba(0,0,0,0.7))',
        }}
      >
        <p
          style={{
            color: '#fff',
            fontSize: 12,
            fontWeight: 700,
            margin: '0 0 4px',
            textShadow: '0 1px 3px rgba(0,0,0,0.8)',
          }}
        >
          {handle}
        </p>
        <p
          style={{
            color: '#fff',
            fontSize: 11,
            lineHeight: 1.4,
            margin: 0,
            textShadow: '0 1px 3px rgba(0,0,0,0.8)',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {shortCaption}
        </p>
      </div>
      {/* Right side: vertical icons */}
      <div
        style={{
          position: 'absolute',
          right: 8,
          bottom: 60,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 16,
        }}
      >
        {/* Heart */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="white" stroke="none">
            <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z" />
          </svg>
          <span style={{ color: '#fff', fontSize: 10, fontWeight: 600, textShadow: '0 1px 3px rgba(0,0,0,0.8)' }}>1.2K</span>
        </div>
        {/* Comment */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="white" stroke="none">
            <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
          </svg>
          <span style={{ color: '#fff', fontSize: 10, fontWeight: 600, textShadow: '0 1px 3px rgba(0,0,0,0.8)' }}>24</span>
        </div>
        {/* Bookmark */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="white" stroke="none">
            <path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z" />
          </svg>
          <span style={{ color: '#fff', fontSize: 10, fontWeight: 600, textShadow: '0 1px 3px rgba(0,0,0,0.8)' }}>89</span>
        </div>
        {/* Share */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="white" stroke="none">
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
        </div>
      </div>
    </div>
  );
}

// --- Platform caption key mapping ---

const PLATFORM_CAPTION_MAP: Record<string, keyof SchedulePreviewModalProps['captions']> = {
  Instagram: 'ig',
  Twitter: 'twitter',
  Threads: 'threads',
  TikTok: 'tiktok',
};

// --- Main Component ---

export default function SchedulePreviewModal({
  open,
  onClose,
  onConfirm,
  persona,
  platforms,
  captions,
  images,
  scheduleDate,
  scheduleTime,
  mode,
}: SchedulePreviewModalProps) {
  const [mounted, setMounted] = useState(false);
  const [state, setState] = useState<ModalState>('preview');
  const [errorMessage, setErrorMessage] = useState('');
  const autoCloseRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Portal mount guard
  useEffect(() => {
    setMounted(true);
  }, []);

  // Reset state when modal opens
  useEffect(() => {
    if (open) {
      setState('preview');
      setErrorMessage('');
    }
    return () => {
      if (autoCloseRef.current) {
        clearTimeout(autoCloseRef.current);
      }
    };
  }, [open]);

  // Body scroll lock
  useEffect(() => {
    if (!open) return;
    const original = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = original;
    };
  }, [open]);

  // Keyboard: Escape to close (only in preview state)
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape' && state === 'preview') {
        onClose();
      }
    },
    [onClose, state]
  );

  useEffect(() => {
    if (!open) return;
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, handleKeyDown]);

  // --- Confirm handler ---
  const handleConfirm = async () => {
    setState('loading');
    setErrorMessage('');
    try {
      await onConfirm();
      setState('success');
      // Auto-close after 3s
      autoCloseRef.current = setTimeout(() => {
        onClose();
      }, 3000);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Something went wrong. Please try again.';
      setErrorMessage(message);
      setState('failed');
    }
  };

  // --- Retry handler ---
  const handleRetry = () => {
    handleConfirm();
  };

  // --- Navigate to calendar ---
  const handleViewCalendar = () => {
    if (autoCloseRef.current) {
      clearTimeout(autoCloseRef.current);
    }
    window.location.hash = 'publish';
    onClose();
  };

  // --- Format schedule display ---
  const formatScheduleDisplay = () => {
    if (!scheduleDate) return mode === 'post-now' ? 'Now' : 'Not scheduled';
    try {
      const dateStr = scheduleTime
        ? `${scheduleDate}T${scheduleTime}`
        : scheduleDate;
      const d = new Date(dateStr);
      const dateFormatted = d.toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'long',
        day: 'numeric',
      });
      if (scheduleTime) {
        const timeFormatted = d.toLocaleTimeString('en-US', {
          hour: 'numeric',
          minute: '2-digit',
        });
        return `${dateFormatted} at ${timeFormatted}`;
      }
      return dateFormatted;
    } catch {
      return scheduleDate;
    }
  };

  // First image for mockups
  const primaryImage = images[0] || '';

  if (!mounted || !open) return null;

  return createPortal(
    <div
      className="fixed inset-0 flex items-center justify-center"
      style={{ zIndex: 60, background: 'rgba(0, 0, 0, 0.7)', backdropFilter: 'blur(6px)' }}
      onClick={state === 'preview' ? onClose : undefined}
    >
      <div
        className="relative w-full max-w-4xl max-h-[92vh] overflow-y-auto rounded-[16px] shadow-2xl"
        style={{
          background: 'var(--color-bg-primary)',
          border: '1px solid var(--color-border)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* --- PREVIEW STATE --- */}
        {state === 'preview' && (
          <>
            {/* Header */}
            <div
              className="sticky top-0 flex items-center justify-between px-6 py-4 border-b z-10"
              style={{
                background: 'var(--color-bg-primary)',
                borderColor: 'var(--color-border)',
              }}
            >
              <h2
                className="text-base font-semibold"
                style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-display)' }}
              >
                Preview Your Post
              </h2>
              <button
                onClick={onClose}
                className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors hover:opacity-80"
                style={{ background: 'var(--color-bg-tertiary)', color: 'var(--color-text-secondary)' }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            {/* Platform Mockups */}
            <div className="px-6 pt-5">
              <div
                className="flex gap-4 overflow-x-auto pb-4"
                style={{
                  scrollSnapType: 'x mandatory',
                  justifyContent: platforms.length === 1 ? 'center' : undefined,
                }}
              >
                {platforms.map((platform) => {
                  const captionKey = PLATFORM_CAPTION_MAP[platform];
                  const captionText = captionKey ? captions[captionKey] : '';

                  if (!primaryImage) return null;

                  const mockupProps = {
                    persona,
                    caption: captionText,
                    imageUrl: primaryImage,
                  };

                  return (
                    <div
                      key={platform}
                      style={{ scrollSnapAlign: 'start' }}
                    >
                      {/* Platform label */}
                      <div className="flex items-center gap-2 mb-3">
                        <PlatformIcon platform={platform} size={14} />
                        <span
                          className="text-xs font-semibold uppercase tracking-wider"
                          style={{ color: 'var(--color-text-tertiary)' }}
                        >
                          {platform === 'Twitter' ? 'X' : platform}
                        </span>
                      </div>
                      {/* Mockup */}
                      {platform === 'Instagram' && <InstagramMockup {...mockupProps} />}
                      {platform === 'Twitter' && <TwitterMockup {...mockupProps} />}
                      {platform === 'Threads' && <ThreadsMockup {...mockupProps} />}
                      {platform === 'TikTok' && <TikTokMockup {...mockupProps} />}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Schedule Info Bar */}
            <div
              className="mx-6 mt-2 mb-4 p-4 rounded-xl flex items-center justify-between flex-wrap gap-3"
              style={{ background: 'var(--color-bg-tertiary)' }}
            >
              <div className="flex items-center gap-3">
                {/* Calendar icon */}
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center"
                  style={{
                    background:
                      mode === 'post-now'
                        ? 'var(--color-success-muted)'
                        : 'var(--color-info-muted)',
                  }}
                >
                  {mode === 'post-now' ? (
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="var(--color-success)"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <line x1="22" y1="2" x2="11" y2="13" />
                      <polygon points="22 2 15 22 11 13 2 9 22 2" />
                    </svg>
                  ) : (
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="var(--color-info)"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                      <line x1="16" y1="2" x2="16" y2="6" />
                      <line x1="8" y1="2" x2="8" y2="6" />
                      <line x1="3" y1="10" x2="21" y2="10" />
                    </svg>
                  )}
                </div>
                <div>
                  <p
                    className="text-sm font-semibold"
                    style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-display)' }}
                  >
                    {formatScheduleDisplay()}
                  </p>
                  <p className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
                    {persona.name} &middot;{' '}
                    {platforms.map((p) => (p === 'Twitter' ? 'X' : p)).join(', ')}
                  </p>
                </div>
              </div>
              {/* Platform badges */}
              <div className="flex items-center gap-1.5">
                {platforms.map((p) => (
                  <span
                    key={p}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold"
                    style={{
                      background: 'var(--color-bg-primary)',
                      color: 'var(--color-text-secondary)',
                      border: '1px solid var(--color-border)',
                    }}
                  >
                    <PlatformIcon platform={p} size={10} />
                    {p === 'Twitter' ? 'X' : p}
                  </span>
                ))}
              </div>
            </div>

            {/* Action Buttons */}
            <div
              className="sticky bottom-0 flex items-center justify-between gap-3 px-6 py-4 border-t"
              style={{
                background: 'var(--color-bg-primary)',
                borderColor: 'var(--color-border)',
              }}
            >
              <button
                onClick={onClose}
                className="flex items-center gap-2 px-5 py-2.5 rounded-[20px] text-sm font-medium transition-all duration-200 hover:opacity-80"
                style={{
                  background: 'transparent',
                  color: 'var(--color-text-secondary)',
                  border: '1px solid var(--color-border)',
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="15 18 9 12 15 6" />
                </svg>
                Go Back &amp; Edit
              </button>
              <button
                onClick={handleConfirm}
                className="flex items-center gap-2 px-6 py-2.5 rounded-[20px] text-sm font-semibold transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
                style={{
                  background: 'var(--color-accent-green)',
                  color: '#ffffff',
                  fontFamily: 'var(--font-display)',
                  boxShadow: '0 0 24px var(--color-accent-green-muted), 0 1px 2px rgba(0,0,0,0.3)',
                }}
              >
                {mode === 'post-now' ? (
                  <>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="22" y1="2" x2="11" y2="13" />
                      <polygon points="22 2 15 22 11 13 2 9 22 2" />
                    </svg>
                    Confirm &amp; Post Now
                  </>
                ) : (
                  <>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                      <line x1="16" y1="2" x2="16" y2="6" />
                      <line x1="8" y1="2" x2="8" y2="6" />
                      <line x1="3" y1="10" x2="21" y2="10" />
                    </svg>
                    Confirm &amp; Schedule
                  </>
                )}
              </button>
            </div>
          </>
        )}

        {/* --- LOADING STATE --- */}
        {state === 'loading' && (
          <div className="flex flex-col items-center justify-center py-20 px-6">
            {/* Spinner */}
            <div
              style={{
                width: 48,
                height: 48,
                border: '3px solid var(--color-border)',
                borderTopColor: 'var(--color-accent-green)',
                borderRadius: '50%',
                animation: 'spin 0.8s linear infinite',
              }}
            />
            <p
              className="mt-5 text-base font-semibold"
              style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-display)' }}
            >
              {mode === 'post-now' ? 'Publishing your post...' : 'Scheduling your post...'}
            </p>
            <p
              className="mt-1 text-sm"
              style={{ color: 'var(--color-text-tertiary)' }}
            >
              This may take a moment
            </p>
          </div>
        )}

        {/* --- SUCCESS STATE --- */}
        {state === 'success' && (
          <div className="flex flex-col items-center justify-center py-20 px-6">
            {/* Animated checkmark */}
            <div
              style={{
                width: 64,
                height: 64,
                borderRadius: '50%',
                background: 'var(--color-success-muted)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                animation: 'successBounce 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) forwards',
              }}
            >
              <svg
                width="32"
                height="32"
                viewBox="0 0 24 24"
                fill="none"
                stroke="var(--color-success)"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <p
              className="mt-5 text-lg font-semibold"
              style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-display)' }}
            >
              {mode === 'post-now' ? 'Post Published!' : `Scheduled for ${formatScheduleDisplay()}`}
            </p>
            <p
              className="mt-1 text-sm"
              style={{ color: 'var(--color-text-tertiary)' }}
            >
              {mode === 'post-now'
                ? 'Your post has been sent to Late for publishing.'
                : 'Your post has been queued and will be published on time.'}
            </p>
            <button
              onClick={handleViewCalendar}
              className="mt-6 flex items-center gap-2 px-5 py-2.5 rounded-[20px] text-sm font-semibold transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
              style={{
                background: 'var(--color-accent-green)',
                color: '#ffffff',
                fontFamily: 'var(--font-display)',
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                <line x1="16" y1="2" x2="16" y2="6" />
                <line x1="8" y1="2" x2="8" y2="6" />
                <line x1="3" y1="10" x2="21" y2="10" />
              </svg>
              View in Calendar
            </button>
          </div>
        )}

        {/* --- FAILED STATE --- */}
        {state === 'failed' && (
          <div className="flex flex-col items-center justify-center py-20 px-6">
            {/* Error icon */}
            <div
              style={{
                width: 64,
                height: 64,
                borderRadius: '50%',
                background: 'var(--color-error-muted)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <svg
                width="32"
                height="32"
                viewBox="0 0 24 24"
                fill="none"
                stroke="var(--color-error)"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="10" />
                <line x1="15" y1="9" x2="9" y2="15" />
                <line x1="9" y1="9" x2="15" y2="15" />
              </svg>
            </div>
            <p
              className="mt-5 text-lg font-semibold"
              style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-display)' }}
            >
              Scheduling Failed
            </p>
            <p
              className="mt-2 text-sm text-center max-w-sm"
              style={{ color: 'var(--color-text-secondary)' }}
            >
              {errorMessage || 'An unexpected error occurred. Please try again.'}
            </p>
            <div className="flex items-center gap-3 mt-6">
              <button
                onClick={onClose}
                className="flex items-center gap-2 px-5 py-2.5 rounded-[20px] text-sm font-medium transition-all duration-200 hover:opacity-80"
                style={{
                  background: 'transparent',
                  color: 'var(--color-text-secondary)',
                  border: '1px solid var(--color-border)',
                }}
              >
                Save as Draft
              </button>
              <button
                onClick={handleRetry}
                className="flex items-center gap-2 px-5 py-2.5 rounded-[20px] text-sm font-semibold transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
                style={{
                  background: 'var(--color-accent-green)',
                  color: '#ffffff',
                  fontFamily: 'var(--font-display)',
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M23 4v6h-6" />
                  <path d="M1 20v-6h6" />
                  <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
                </svg>
                Retry
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Inline CSS animation for success bounce */}
      <style>{`
        @keyframes successBounce {
          0% { transform: scale(0); opacity: 0; }
          60% { transform: scale(1.15); opacity: 1; }
          100% { transform: scale(1); opacity: 1; }
        }
      `}</style>
    </div>,
    document.body
  );
}
