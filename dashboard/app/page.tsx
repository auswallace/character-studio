'use client';

import { useState, useEffect, useRef } from 'react';
import { Home, Sparkles, Grid2x2, Send, Search, Code, Settings, Hexagon, ChevronDown, Video, type LucideProps } from 'lucide-react';
import StudioCopyTab from '@/components/StudioCopyTab';
import StudioRemixTab from '@/components/StudioRemixTab';
import StudioCarouselTab from '@/components/StudioCarouselTab';
import StudioVideoTab from '@/components/StudioVideoTab';
import StudioAdsTab from '@/components/StudioAdsTab';
import StudioCharacterTab from '@/components/StudioCharacterTab';
import StudioCreateTab from '@/components/StudioCreateTab';
import PublishTab from '@/components/PublishTab';
import PublishCreateTab from '@/components/PublishCreateTab';
import PublishIdeasTab, { PostIdea } from '@/components/PublishIdeasTab';
import LibraryTab from '@/components/LibraryTab';
import GalleryTab from '@/components/GalleryTab';
import FavoritesTab from '@/components/FavoritesTab';
import InspirationTab from '@/components/InspirationTab';
import DevProgressTab from '@/components/DevProgressTab';
import SettingsTab from '@/components/SettingsTab';
import HomeTab from '@/components/HomeTab';
import { ActiveJobsProvider } from '@/contexts/ActiveJobsContext';

type NavItem = {
  id: string;
  label: string;
  icon: React.FC<LucideProps>;
  children?: { id: string; label: string; hidden?: boolean }[];
  hidden?: boolean;   // kept in code, left out of the sidebar. Set false to bring a section back.
};

const navigation: NavItem[] = [
  {
    id: 'home',
    label: 'Home',
    icon: Home,
  },
  {
    id: 'studio',
    label: 'Studio',
    icon: Sparkles,
    children: [
      { id: 'studio.create', label: 'Create' },
      { id: 'studio.copy', label: 'Image Copy' },
      { id: 'studio.remix', label: 'Image Remix' },
      { id: 'studio.carousel', label: 'Image Carousel', hidden: true },
      { id: 'studio.video', label: 'Video' },
      { id: 'studio.ads', label: 'Ads', hidden: true },
      { id: 'studio.character', label: 'Character' },
    ],
  },
  {
    id: 'library',
    label: 'Library',
    icon: Grid2x2,
    children: [
      { id: 'library.gallery', label: 'Gallery' },
      { id: 'library.favorites', label: 'Favorites' },
      { id: 'library.browse', label: 'Browse', hidden: true },
    ],
  },
  {
    id: 'publish',
    label: 'Publish',
    icon: Send,
    hidden: true,   // 2026-11-10: posting from the phone apps instead (native sounds, AI label, better reach)
    children: [
      { id: 'publish.queue', label: 'Queue' },
      { id: 'publish.create', label: 'Create' },
      { id: 'publish.ideas', label: 'Ideas' },
    ],
  },
  {
    id: 'inspiration',
    label: 'Inspiration',
    hidden: true,   // 2026-11-10: hidden to cut clutter (with Carousel, Ads, Browse); comes back as the hook library
    icon: Search,
    children: [
      { id: 'inspiration.instagram', label: 'Instagram' },
      { id: 'inspiration.x', label: 'X' },
    ],
  },
  {
    id: 'development',
    label: 'Development',
    icon: Code,
    hidden: true,   // 2026-11-10: internal build tracker, not needed for posting
    children: [
      { id: 'development.progress', label: 'Progress' },
    ],
  },
];

export default function Dashboard() {
  const [activeRoute, setActiveRoute] = useState('home');
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['studio', 'publish', 'library', 'inspiration', 'development']));
  const [pendingRemixImage, setPendingRemixImage] = useState<string | null>(null);

  const handleRemixImage = (imageUrl: string) => {
    setPendingRemixImage(imageUrl);
    setActiveRoute('studio.remix');
  };

  const [pendingCopyImage, setPendingCopyImage] = useState<string | null>(null);
  const [pendingDraft, setPendingDraft] = useState<PostIdea | null>(null);

  const handleSendToCopy = (imageUrl: string) => {
    setPendingCopyImage(imageUrl);
    setActiveRoute('studio.copy');
  };

  const [pendingCarouselImage, setPendingCarouselImage] = useState<string | null>(null);

  const handleSendToCarousel = (imageUrl: string) => {
    setPendingCarouselImage(imageUrl);
    setActiveRoute('studio.carousel');
  };

  const handleSendToRemix = (imageUrl: string) => {
    setPendingRemixImage(imageUrl);
    setActiveRoute('studio.remix');
  };

  const handleFinalizeDraft = (draft: PostIdea) => {
    setPendingDraft(draft);
    setActiveRoute('publish.create');
  };

  // Guard: don't sync state->hash until we've read the hash on mount
  const hasInitialized = useRef(false);

  // Sync active route to URL hash so refresh preserves the tab
  useEffect(() => {
    if (!hasInitialized.current) return; // Don't overwrite hash before we've read it
    const currentHash = window.location.hash.slice(1);
    const currentRoute = currentHash.split('?')[0];
    // Only update hash if the route portion changed; preserve query params for one tick
    // so child components (e.g. PublishCreateTab) can read them on mount
    if (currentRoute !== activeRoute) {
      const hash = activeRoute === 'home' ? '' : `#${activeRoute}`;
      window.history.replaceState(null, '', hash || window.location.pathname);
    }
    requestAnimationFrame(() => window.scrollTo(0, 0));
  }, [activeRoute]);

  // Restore active tab from URL hash on mount + listen for back/forward
  // Strip query params from hash (e.g. #publish.create?date=2026-03-03 -> publish.create)
  useEffect(() => {
    if (window.location.hash) {
      const raw = window.location.hash.slice(1);
      setActiveRoute(raw.split('?')[0] || 'home');
    }
    hasInitialized.current = true;
    const onHashChange = () => {
      const raw = window.location.hash.slice(1);
      setActiveRoute(raw.split('?')[0] || 'home');
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const toggleSection = (id: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleNavClick = (item: NavItem) => {
    if (item.children) {
      // If has children, toggle expand and navigate to first child if not already in section
      const isExpanded = expandedSections.has(item.id);
      toggleSection(item.id);
      if (!isExpanded && !activeRoute.startsWith(item.id)) {
        setActiveRoute(item.children[0].id);
      }
    } else {
      setActiveRoute(item.id);
    }
  };

  // Determine which section is active
  const activeSection = activeRoute.split('.')[0];

  // Breadcrumb
  const getBreadcrumb = (): { section: string; page: string } | null => {
    if (activeRoute === 'home' || activeRoute === 'settings') return null;
    for (const item of navigation) {
      if (item.children) {
        const child = item.children.find(c => c.id === activeRoute);
        if (child) return { section: item.label, page: child.label };
      }
    }
    return null;
  };

  // Content title
  const getTitle = () => {
    if (activeRoute === 'home') return 'Home';
    if (activeRoute === 'settings') return 'Settings';
    for (const item of navigation) {
      if (item.id === activeRoute) return item.label;
      if (item.children) {
        const child = item.children.find(c => c.id === activeRoute);
        if (child) return child.label;
      }
    }
    return '';
  };

  const breadcrumb = getBreadcrumb();

  return (
    <ActiveJobsProvider>
    <div className="min-h-screen flex" style={{ background: 'var(--color-bg-primary)' }}>
      {/* ===== SIDEBAR ===== */}
      <aside
        className="sticky top-0 h-screen flex flex-col"
        style={{
          width: '220px',
          minWidth: '220px',
          background: 'var(--color-bg-surface)',
          borderRight: '1px solid var(--color-border)',
        }}
      >
        {/* Logo */}
        <button
          onClick={() => setActiveRoute('home')}
          className="flex items-center gap-2.5 px-4 h-14 w-full transition-opacity hover:opacity-80"
          style={{ borderBottom: '1px solid var(--color-border)' }}
        >
          <svg width="22" height="22" viewBox="0 0 48 48">
            <defs>
              <linearGradient id="logoGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#111111"/>
                <stop offset="100%" stopColor="#333333"/>
              </linearGradient>
            </defs>
            <polygon points="24,2 44,13 44,35 24,46 4,35 4,13" fill="url(#logoGrad)"/>
            <polygon points="24,10 36,17 36,31 24,38 12,31 12,17" fill="white" opacity="0.15"/>
            <circle cx="24" cy="24" r="8" fill="none" stroke="white" strokeWidth="2.5"/>
          </svg>
          <span
            className="tracking-wide"
            style={{
              fontFamily: 'var(--font-display)',
              color: 'var(--color-text-primary)',
              fontSize: '15px',
              fontWeight: 700,
            }}
          >
            OXIRA.AI
          </span>
        </button>

        {/* Navigation */}
        <nav className="flex-1 py-3 px-2.5 space-y-0.5 overflow-y-auto">
          {navigation.filter(item => !item.hidden).map((item) => {
            const Icon = item.icon;
            const isActive = activeSection === item.id;
            const isExpanded = expandedSections.has(item.id);
            const hasChildren = !!item.children;

            return (
              <div key={item.id}>
                {/* Parent item */}
                <button
                  onClick={() => handleNavClick(item)}
                  className="w-full flex items-center gap-2.5 rounded-lg transition-all duration-150"
                  style={{
                    padding: '8px 10px',
                    borderRadius: '8px',
                    fontSize: '13px',
                    fontWeight: isActive && !hasChildren ? 600 : 500,
                    color: isActive
                      ? (hasChildren ? 'var(--color-text-primary)' : 'var(--color-accent-blue-text)')
                      : 'var(--color-text-tertiary)',
                    background: isActive && !hasChildren ? 'var(--color-bg-active)' : 'transparent',
                  }}
                >
                  <Icon size={16} strokeWidth={1.8} />
                  <span className="flex-1 text-left">{item.label}</span>
                  {hasChildren && (
                    <ChevronDown
                      size={12}
                      strokeWidth={2}
                      style={{
                        color: 'var(--color-text-tertiary)',
                        transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                        transition: 'transform 0.2s ease',
                      }}
                    />
                  )}
                </button>

                {/* Children */}
                {hasChildren && isExpanded && (
                  <div className="ml-4 pl-3.5 mt-0.5 mb-1 space-y-0.5" style={{ borderLeft: '1px solid var(--color-border)' }}>
                    {item.children!.filter(child => !child.hidden).map((child) => {
                      const isChildActive = activeRoute === child.id;
                      return (
                        <button
                          key={child.id}
                          onClick={() => setActiveRoute(child.id)}
                          className="w-full text-left rounded-lg transition-all duration-150"
                          style={{
                            padding: '8px 10px',
                            borderRadius: '8px',
                            fontSize: '13px',
                            fontWeight: isChildActive ? 600 : 500,
                            color: isChildActive ? 'var(--color-accent-blue-text)' : 'var(--color-text-tertiary)',
                            background: isChildActive ? 'var(--color-bg-active)' : 'transparent',
                          }}
                        >
                          {child.label}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        {/* Bottom — Settings */}
        <div className="px-2.5 py-3" style={{ borderTop: '1px solid var(--color-border)' }}>
          <button
            onClick={() => setActiveRoute('settings')}
            className="w-full flex items-center gap-2.5 rounded-lg transition-all duration-150"
            style={{
              padding: '8px 10px',
              borderRadius: '8px',
              fontSize: '13px',
              fontWeight: activeRoute === 'settings' ? 600 : 500,
              color: activeRoute === 'settings' ? 'var(--color-accent-blue-text)' : 'var(--color-text-tertiary)',
              background: activeRoute === 'settings' ? 'var(--color-bg-active)' : 'transparent',
            }}
          >
            <Settings size={16} strokeWidth={1.8} />
            <span className="flex-1 text-left">Settings</span>
          </button>
        </div>
      </aside>

      {/* ===== MAIN CONTENT ===== */}
      <main className="flex-1 min-w-0">
        {/* Sticky header */}
        <div
          className="sticky top-0 z-40 flex items-center gap-2 px-7 h-14"
          style={{
            background: 'var(--color-bg-primary)',
            borderBottom: '1px solid var(--color-border)',
          }}
        >
          {breadcrumb && (
            <span style={{ color: 'var(--color-text-tertiary)', fontSize: '13px' }}>
              {breadcrumb.section}
            </span>
          )}
          {breadcrumb && (
            <span style={{ color: 'var(--color-text-tertiary)', fontSize: '13px' }}>
              /
            </span>
          )}
          <h1
            style={{
              fontFamily: 'var(--font-display)',
              color: 'var(--color-text-primary)',
              fontSize: '15px',
              fontWeight: 600,
            }}
          >
            {getTitle()}
          </h1>
        </div>

        {/* Content */}
        <div style={{ padding: '28px', background: 'var(--color-bg-primary)' }}>
          {activeRoute === 'home' && <HomeTab onNavigate={setActiveRoute} />}
          {/* Studio tabs stay mounted so user selections persist across tab switches */}
          <div style={{ display: activeRoute === 'studio.copy' ? 'block' : 'none' }}>
            <StudioCopyTab onRemixImage={handleRemixImage} onSendToCarousel={handleSendToCarousel} pendingCopyImage={pendingCopyImage} onCopyImageConsumed={() => setPendingCopyImage(null)} />
          </div>
          <div style={{ display: activeRoute === 'studio.remix' ? 'block' : 'none' }}>
            <StudioRemixTab
              pendingRemixImage={pendingRemixImage}
              onRemixImageConsumed={() => setPendingRemixImage(null)}
              onNavigate={setActiveRoute}
              onSendToCarousel={handleSendToCarousel}
            />
          </div>
          <div style={{ display: activeRoute === 'studio.carousel' ? 'block' : 'none' }}>
            <StudioCarouselTab
              pendingCarouselImage={pendingCarouselImage}
              onCarouselImageConsumed={() => setPendingCarouselImage(null)}
              onRemixImage={handleRemixImage}
            />
          </div>
          <div style={{ display: activeRoute === 'studio.video' ? 'block' : 'none' }}>
            <StudioVideoTab />
          </div>
          <div style={{ display: activeRoute === 'studio.ads' ? 'block' : 'none' }}>
            <StudioAdsTab />
          </div>
          <div style={{ display: activeRoute === 'studio.character' ? 'block' : 'none' }}>
            <StudioCharacterTab />
          </div>
          <div style={{ display: activeRoute === 'studio.create' ? 'block' : 'none' }}>
            <StudioCreateTab onNavigate={setActiveRoute} />
          </div>
          {/* Other tabs remount each visit for fresh data */}
          {activeRoute === 'publish.queue' && <PublishTab />}
          {activeRoute === 'publish.create' && <PublishCreateTab pendingDraft={pendingDraft} onDraftConsumed={() => setPendingDraft(null)} />}
          {activeRoute === 'publish.ideas' && <PublishIdeasTab onFinalize={handleFinalizeDraft} />}
          {activeRoute === 'library.browse' && <LibraryTab onRemixImage={handleRemixImage} onSendToCarousel={handleSendToCarousel} />}
          {activeRoute === 'library.gallery' && <GalleryTab onRemixImage={handleRemixImage} onSendToCarousel={handleSendToCarousel} />}
          {activeRoute === 'library.favorites' && <FavoritesTab onRemixImage={handleRemixImage} onSendToCarousel={handleSendToCarousel} />}
          {activeRoute === 'inspiration.instagram' && (
            <InspirationTab subTab="instagram" onSendToCopy={handleSendToCopy} onSendToRemix={handleSendToRemix} />
          )}
          {activeRoute === 'inspiration.x' && (
            <InspirationTab subTab="x" onSendToCopy={handleSendToCopy} onSendToRemix={handleSendToRemix} />
          )}
          {activeRoute === 'inspiration.favorites' && (
            <InspirationTab subTab="favorites" onSendToCopy={handleSendToCopy} onSendToRemix={handleSendToRemix} />
          )}
          {activeRoute === 'inspiration.trends' && (
            <InspirationTab subTab="trends" onSendToCopy={handleSendToCopy} onSendToRemix={handleSendToRemix} />
          )}
          {activeRoute === 'development.progress' && <DevProgressTab />}
          {activeRoute === 'settings' && <SettingsTab />}
        </div>
      </main>
    </div>
    </ActiveJobsProvider>
  );
}
