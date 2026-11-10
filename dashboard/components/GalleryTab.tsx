'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Download, Maximize2, Trash2, CheckSquare, X, Star, Check, Copy, ImagePlus, Database, Folder, FolderPlus, StickyNote } from 'lucide-react';
import ImageLightbox, { type GenerationMeta } from './ImageLightbox';
import { useToast } from './Toast';
import GalleryPromptBar, { loadStoredJobs, storeJobs, type GalleryJob } from './GalleryPromptBar';

// ─── Types ────────────────────────────────────────────────

interface ApiImage {
  url: string;
  filename: string;
  width: number;
  height: number;
  thumbnails?: {
    small?: { url: string };
    large?: { url: string };
    full?: { url: string };
  };
}

interface ApiGeneration {
  id: string;
  name: string;
  prompt?: string;
  persona: string;
  imageModel: string;
  images: ApiImage[];
  upscaledImages?: ApiImage[];
  createdAt: string;
  starred: boolean;
}

interface ApiRemix {
  id: string;
  name: string;
  prompt?: string;
  remixPrompt?: string;
  persona: string;
  imageModel: string;
  variants: ApiImage[];
  upscaledImages?: ApiImage[];
  createdAt: string;
  starred: boolean;
}

interface ApiCarousel {
  id: string;
  name: string;
  persona: string;
  imageModel: string;
  carouselSetId: string;
  promptTemplateKey: string;
  variants: ApiImage[];
  upscaledImages?: ApiImage[];
  createdAt: string;
  starred: boolean;
}

// Unique download name: persona_YYYYMMDD_<record>_<n>.ext. Old `image_1.jpg` names collided across generations.
function downloadName(fi: { persona?: string; createdAt?: string; recordId: string; imageIndex: number; filename?: string; mediaType?: string; url: string }): string {
  const slug = (fi.persona || 'image').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'image';
  const day = (fi.createdAt || '').slice(0, 10).replace(/-/g, '') || 'nodate';
  const ext = fi.mediaType === 'video' ? 'mp4' : (fi.filename || fi.url).match(/\.(png|webp|jpe?g|mp4)(\?|$)/i)?.[1]?.toLowerCase().replace('jpeg', 'jpg') || 'jpg';
  return `${slug}_${day}_${fi.recordId.slice(0, 8)}_${fi.imageIndex + 1}.${ext}`;
}

interface FlatImage {
  url: string;
  upscaledUrl?: string;
  thumbnail: string;
  filename: string;
  persona: string;
  model: string;
  genName: string;
  recordId: string;
  imageIndex: number;
  source: 'generation' | 'remix' | 'carousel' | 'video';
  mediaType?: 'image' | 'video';
  starred: boolean;
  createdAt: string;
  prompt?: string;
  ratio?: number;   // width / height when the API knows it; otherwise measured when the thumbnail loads
}

interface GalleryTabProps {
  onRemixImage?: (url: string) => void;
  onSendToCarousel?: (url: string) => void;
}

// ─── Component ────────────────────────────────────────────

export default function GalleryTab({ onRemixImage, onSendToCarousel }: GalleryTabProps) {
  const [images, setImages] = useState<FlatImage[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [filterPersona, setFilterPersona] = useState('all');
  const [filterModel, setFilterModel] = useState('all');
  const [filterSource, setFilterSource] = useState<'all' | 'generation' | 'remix' | 'carousel' | 'video'>('all');
  const [personaList, setPersonaList] = useState<string[]>([]);
  const [modelList, setModelList] = useState<string[]>([]);

  // Persona config (for avatar in lightbox)
  const [personaConfigs, setPersonaConfigs] = useState<{ id?: string; name: string; faceRefs?: string[]; activeCharacterId?: string | null }[]>([]);

  // Pagination
  const [pageSize, setPageSize] = useState(20);
  const [currentPage, setCurrentPage] = useState(0);

  // Lightbox
  const [lightbox, setLightbox] = useState<{ images: { url: string; label?: string; type?: 'image' | 'video' }[]; index: number } | null>(null);

  // Grid columns slider
  const [gridColumns, setGridColumns] = useState(5);
  // Real-shape rows: every thumbnail keeps its own aspect ratio and each row shares one height.
  // The slider sets the target row height (fewer "columns" = taller rows). Ratios the API did not
  // send are measured when the thumbnail loads.
  const [measured, setMeasured] = useState<Record<string, number>>({});
  const rowHeight = Math.round(1280 / gridColumns);
  const ratioOf = (img: FlatImage) => Math.min(Math.max(img.ratio || measured[img.thumbnail] || 0.8, 0.4), 2.4);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- restore the saved size after mount (reading storage during render breaks hydration)
    try { const v = Number(localStorage.getItem('gallery.gridColumns')); if (v >= 3 && v <= 8) setGridColumns(v); } catch { /* storage unavailable */ }
  }, []);
  const changeGridColumns = (v: number) => { setGridColumns(v); try { localStorage.setItem('gallery.gridColumns', String(v)); } catch { /* storage unavailable */ } };
  // "NEW" badge: results from the last 15 minutes. `now` is state so render stays pure.
  const [now, setNow] = useState(0);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- clock for the NEW badge, set after mount
  useEffect(() => { setNow(Date.now()); const t = setInterval(() => setNow(Date.now()), 60_000); return () => clearInterval(t); }, []);
  const isNew = (img: FlatImage) => now > 0 && now - new Date(img.createdAt).getTime() < 15 * 60_000;
  // Drag-box select: drag over the grid to select every tile the box touches (turns Select mode on).
  const gridRef = useRef<HTMLDivElement>(null);
  const dragStart = useRef<{ x: number; y: number; base: Set<string> } | null>(null);
  const suppressClick = useRef(false);
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [copiedKey, setCopiedKey] = useState('');
  const [bulkBusy, setBulkBusy] = useState('');
  // Prompt bar jobs: shown as tiles at the front of the grid. Failed ones survive a reload (localStorage).
  const [jobs, setJobs] = useState<GalleryJob[]>([]);
  const [jobsLoaded, setJobsLoaded] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const retryRef = useRef<((job: GalleryJob) => void) | null>(null);
  const [barReference, setBarReference] = useState<string | null>(null);   // "Use as reference" on a card attaches the image to the prompt bar
  // Folders: an image is in at most one folder (library_folder_items). 'all' = everything, 'none' = unfiled.
  const [folders, setFolders] = useState<{ id: string; name: string; count: number }[]>([]);
  const [folderMap, setFolderMap] = useState<Record<string, string>>({});
  const [filterFolder, setFilterFolder] = useState('all');
  // Notes: one free-text note per image, edited in the lightbox.
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [hoverVideo, setHoverVideo] = useState('');   // key of the video tile under the pointer: only that one plays
  useEffect(() => { fetch('/api/library/notes').then(r => r.json()).then(d => setNotes(d.notes || {})).catch(() => { /* notes are optional */ }); }, []);
  async function saveNote(img: FlatImage, text: string) {
    const key = `${img.source}:${img.recordId}:${img.imageIndex}`;
    try {
      const r = await fetch('/api/library/notes', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key, note: text }) });
      const d = await r.json(); if (!r.ok) throw new Error(d.error || 'note not saved');
      setNotes(n => { const next = { ...n }; if (d.note) next[key] = d.note; else delete next[key]; return next; });
    } catch (e) { addToast(e instanceof Error ? e.message : 'note not saved', 'error'); }
  }
  const loadFolders = useCallback(async () => {
    try { const d = await (await fetch('/api/library/folders')).json(); setFolders(d.folders || []); setFolderMap(d.items || {}); } catch { /* folders are optional */ }
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- initial load of the folder list
  useEffect(() => { loadFolders(); }, [loadFolders]);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- restore saved jobs after mount (storage is not readable during render)
  useEffect(() => { setJobs(loadStoredJobs()); setJobsLoaded(true); }, []);
  useEffect(() => { if (jobsLoaded) storeJobs(jobs.filter(j => j.status !== 'countdown')); }, [jobs, jobsLoaded]);

  // Deleting
  const [deleting, setDeleting] = useState<Set<string>>(new Set());

  // Select mode
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const { addToast } = useToast();

  // ─── Fetch + flatten ──────────────────────────────────

  useEffect(() => {
    async function fetchData() {
      try {
        const [genRes, remixRes, carouselRes, videoRes, configRes] = await Promise.all([
          fetch('/api/generations?limit=1000'),
          fetch('/api/remix?limit=1000'),
          fetch('/api/carousel?limit=1000'),
          fetch('/api/video?limit=1000'),
          fetch('/api/config'),
        ]);

        const genData = await genRes.json();
        const remixData = await remixRes.json();
        const carouselData = await carouselRes.json();
        const videoData = await videoRes.json();
        const configData = await configRes.json();

        // Flatten generation images
        const genImages: FlatImage[] = (genData.generations || []).flatMap((g: ApiGeneration) =>
          (g.images || []).map((img: ApiImage, idx: number) => ({
            url: img.url,
            upscaledUrl: g.upscaledImages?.find((u: ApiImage) => u.filename?.includes(`idx${idx}`) || u.filename === `upscaled_${idx + 1}.png`)?.url || undefined,
            thumbnail: img.thumbnails?.large?.url || img.url,
            ratio: img.width && img.height ? img.width / img.height : undefined,
            filename: img.filename,
            persona: g.persona,
            model: g.imageModel || '',
            genName: g.name,
            prompt: g.prompt || undefined,
            recordId: g.id,
            imageIndex: idx,
            source: 'generation' as const,
            starred: g.starred || false,
            createdAt: g.createdAt || '',
          }))
        );

        // Flatten remix images
        const remixImages: FlatImage[] = (remixData.remixes || []).flatMap((r: ApiRemix) =>
          (r.variants || []).map((img: ApiImage, idx: number) => ({
            url: img.url,
            upscaledUrl: r.upscaledImages?.find((u: ApiImage) => u.filename?.includes(`idx${idx}`) || u.filename === `upscaled_${idx + 1}.png`)?.url || undefined,
            thumbnail: img.thumbnails?.large?.url || img.url,
            ratio: img.width && img.height ? img.width / img.height : undefined,
            filename: img.filename,
            persona: r.persona,
            model: r.imageModel || '',
            genName: r.name,
            prompt: r.remixPrompt || r.prompt || undefined,
            recordId: r.id,
            imageIndex: idx,
            source: 'remix' as const,
            starred: r.starred || false,
            createdAt: r.createdAt || '',
          }))
        );

        // Flatten carousel images
        const carouselImages: FlatImage[] = (carouselData.carousels || []).flatMap((c: ApiCarousel) =>
          (c.variants || []).map((img: ApiImage, idx: number) => ({
            url: img.url,
            upscaledUrl: c.upscaledImages?.find((u: ApiImage) => u.filename?.includes(`idx${idx}`) || u.filename === `upscaled_${idx + 1}.png`)?.url || undefined,
            thumbnail: img.thumbnails?.large?.url || img.url,
            ratio: img.width && img.height ? img.width / img.height : undefined,
            filename: img.filename,
            persona: c.persona,
            model: c.imageModel || '',
            genName: c.name,
            recordId: c.id,
            imageIndex: idx,
            source: 'carousel' as const,
            starred: c.starred || false,
            createdAt: c.createdAt || '',
          }))
        );

        // Flatten video outputs
        interface VideoOutput { url: string; thumbnailUrl: string | null; hasAudio: boolean; durationSeconds: number | null; }
        interface ApiVideo { id: string; name: string; videoModel: string; duration: number; aspectRatio?: string; resolution: string; status: string; createdAt: string; starred: boolean; outputs: VideoOutput[]; }
        const videoImages: FlatImage[] = (videoData.videos || [])
          .filter((v: ApiVideo) => v.status === 'done' && v.outputs?.length > 0)
          .map((v: ApiVideo) => ({
            url: v.outputs[0].url,
            thumbnail: v.outputs[0].thumbnailUrl ?? v.outputs[0].url,
            ratio: (() => { const m = /^(\d+):(\d+)$/.exec(v.aspectRatio || ''); return m ? Number(m[1]) / Number(m[2]) : undefined; })(),
            filename: 'video.mp4',
            persona: 'Video',
            model: v.videoModel || '',
            genName: v.name,
            recordId: v.id,
            imageIndex: 0,
            source: 'video' as const,
            mediaType: 'video' as const,
            starred: v.starred || false,
            createdAt: v.createdAt || '',
          }));

        // Merge and sort by creation time (newest first)
        const all = [...genImages, ...remixImages, ...carouselImages, ...videoImages].sort(
          (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );
        setImages(all);

        // Extract unique models
        const models = [...new Set(all.map(i => i.model).filter(Boolean))].sort();
        setModelList(models);

        // Persona list from config (store full configs for avatar lookup)
        const personas = configData.personas || [];
        const names: string[] = personas.map((p: { name: string }) => p.name);
        setPersonaList(names);
        setPersonaConfigs(personas);
      } catch (err) {
        console.error('[GalleryTab] Failed to fetch:', err);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [reloadKey]);

  // ─── Derived data ─────────────────────────────────────

  const filtered = images.filter(img => {
    if (filterFolder !== 'all') {
      const f = folderMap[`${img.source}:${img.recordId}:${img.imageIndex}`];
      if (filterFolder === 'none' ? !!f : f !== filterFolder) return false;
    }
    if (filterPersona !== 'all' && img.persona !== filterPersona) return false;
    if (filterModel !== 'all' && img.model !== filterModel) return false;
    if (filterSource !== 'all' && img.source !== filterSource) return false;
    return true;
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(currentPage, totalPages - 1);
  const pageImages = filtered.slice(safePage * pageSize, (safePage + 1) * pageSize);

  // Reset page on filter/size change
  function changeFilter(setter: (v: string) => void, value: string) {
    setter(value);
    setCurrentPage(0);
  }
  function changePageSize(size: number) {
    setPageSize(size);
    setCurrentPage(0);
  }

  // ─── Download handler ─────────────────────────────────

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

  // ─── Delete handler ─────────────────────────────────

  async function handleDelete(img: FlatImage) {
    setDeleting(prev => new Set(prev).add(img.url));
    try {
      let res: Response;
      if (img.source === 'video') {
        res = await fetch(`/api/video/${img.recordId}`, { method: 'DELETE' });
      } else {
        let endpoint: string;
        if (img.source === 'carousel') {
          endpoint = `/api/carousel/${img.recordId}/delete-image`;
        } else if (img.source === 'generation') {
          endpoint = `/api/generations/${img.recordId}/delete-image`;
        } else {
          endpoint = `/api/remix/${img.recordId}/delete-image`;
        }
        res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageUrl: img.url }),
        });
      }
      if (res.ok) {
        setImages(prev => prev.filter(i => i.url !== img.url));
      }
    } catch (err) {
      console.error('Delete failed:', err);
    } finally {
      setDeleting(prev => { const next = new Set(prev); next.delete(img.url); return next; });
    }
  }

  // ─── Star handler ───────────────────────────────────

  async function handleToggleStar(img: FlatImage) {
    const newStarred = !img.starred;
    setImages(prev => prev.map(i =>
      i.recordId === img.recordId ? { ...i, starred: newStarred } : i
    ));
    try {
      let endpoint: string;
      if (img.source === 'video') {
        endpoint = `/api/video/${img.recordId}`;
      } else if (img.source === 'carousel') {
        endpoint = `/api/carousel/${img.recordId}/star`;
      } else if (img.source === 'generation') {
        endpoint = `/api/generations/${img.recordId}/star`;
      } else {
        endpoint = `/api/remix/${img.recordId}/star`;
      }
      const res = await fetch(endpoint, { method: 'PATCH' });
      if (!res.ok) {
        setImages(prev => prev.map(i =>
          i.recordId === img.recordId ? { ...i, starred: img.starred } : i
        ));
      }
    } catch {
      setImages(prev => prev.map(i =>
        i.recordId === img.recordId ? { ...i, starred: img.starred } : i
      ));
    }
  }

  // ─── Drag-box select ──────────────────────────────────

  function onGridMouseDown(e: React.MouseEvent) {
    if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return;
    dragStart.current = { x: e.clientX, y: e.clientY, base: e.shiftKey || selectMode ? new Set(selected) : new Set() };
    const move = (ev: MouseEvent) => {
      const st = dragStart.current; if (!st) return;
      const dx = ev.clientX - st.x, dy = ev.clientY - st.y;
      if (!suppressClick.current && Math.hypot(dx, dy) < 8) return;   // a click, not a drag
      suppressClick.current = true;
      const box = { x: Math.min(st.x, ev.clientX), y: Math.min(st.y, ev.clientY), w: Math.abs(dx), h: Math.abs(dy) };
      setMarquee(box);
      const next = new Set(st.base);
      gridRef.current?.querySelectorAll<HTMLElement>('[data-gkey]').forEach(el => {
        const r = el.getBoundingClientRect();
        if (r.left < box.x + box.w && r.right > box.x && r.top < box.y + box.h && r.bottom > box.y) next.add(el.dataset.gkey!);
      });
      setSelectMode(true);
      setSelected(next);
    };
    const up = () => {
      window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up);
      dragStart.current = null; setMarquee(null);
      setTimeout(() => { suppressClick.current = false; }, 0);   // swallow the click that ends the drag
    };
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
  }

  async function copyPrompt(img: FlatImage, key: string) {
    if (!img.prompt) return;
    try { await navigator.clipboard.writeText(img.prompt); setCopiedKey(key); setTimeout(() => setCopiedKey(''), 1500); } catch { addToast('Copy failed', 'error'); }
  }

  async function handleBulkDownload() {
    const list = getSelectedImages(); if (!list.length) return;
    setBulkBusy('download');
    for (const img of list) { await handleDownload(img.upscaledUrl || img.url, downloadName(img)); await new Promise(r => setTimeout(r, 250)); }
    setBulkBusy('');
    addToast(`Downloaded ${list.length} file${list.length === 1 ? '' : 's'}`, 'success');
  }

  // Adds the selected images to each image's own persona dataset (Character > Dataset). Videos are skipped.
  async function handleBulkAddToDataset() {
    const list = getSelectedImages().filter(i => i.mediaType !== 'video'); if (!list.length) return;
    setBulkBusy('dataset');
    const byPersona = new Map<string, string[]>();
    for (const img of list) { const id = personaConfigs.find(p => p.name === img.persona)?.id; if (id) byPersona.set(id, [...(byPersona.get(id) || []), img.url]); }
    let added = 0, sent = 0;
    try {
      for (const [persona_id, urls] of byPersona) {
        sent += urls.length;
        const r = await fetch('/api/characters/dataset', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ persona_id, urls }) });
        const d = await r.json(); if (!r.ok) throw new Error(d.error || 'add failed');
        added += d.added || 0;
      }
      const skipped = list.length - sent;
      addToast(`Added ${added} to the dataset${sent - added ? `, ${sent - added} already there` : ''}${skipped ? `, ${skipped} with no persona skipped` : ''}`, 'success');
    } catch (e) { addToast(e instanceof Error ? e.message : 'add failed', 'error'); }
    setBulkBusy('');
  }

  // ─── Folders ──────────────────────────────────────────

  async function createFolder(): Promise<string | null> {
    const name = window.prompt('Folder name'); if (!name?.trim()) return null;
    try {
      const r = await fetch('/api/library/folders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
      const d = await r.json(); if (!r.ok) throw new Error(d.error || 'could not create folder');
      await loadFolders(); return d.folder.id as string;
    } catch (e) { addToast(e instanceof Error ? e.message : 'could not create folder', 'error'); return null; }
  }
  async function deleteFolder(id: string) {
    const f = folders.find(x => x.id === id); if (!f) return;
    if (!window.confirm(`Delete the folder "${f.name}"? Its ${f.count} image${f.count === 1 ? '' : 's'} stay in the Library, unfiled.`)) return;
    try {
      const r = await fetch('/api/library/folders', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
      if (!r.ok) throw new Error((await r.json()).error || 'delete failed');
      setFilterFolder('all'); setCurrentPage(0); await loadFolders();
    } catch (e) { addToast(e instanceof Error ? e.message : 'delete failed', 'error'); }
  }
  // target: a folder id, 'none' (remove from folder) or 'new' (ask for a name first)
  async function handleBulkMove(target: string) {
    const keys = getSelectedImages().map(i => `${i.source}:${i.recordId}:${i.imageIndex}`); if (!keys.length || !target) return;
    let folder_id: string | null = target === 'none' ? null : target;
    if (target === 'new') { folder_id = await createFolder(); if (!folder_id) return; }
    setBulkBusy('move');
    try {
      const r = await fetch('/api/library/folders', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ folder_id, keys }) });
      const d = await r.json(); if (!r.ok) throw new Error(d.error || 'move failed');
      await loadFolders();
      addToast(folder_id ? `Moved ${d.moved} to the folder` : `Removed ${d.moved} from their folder`, 'success');
      setSelected(new Set());
    } catch (e) { addToast(e instanceof Error ? e.message : 'move failed', 'error'); }
    setBulkBusy('');
  }

  // ─── Select mode handlers ─────────────────────────────

  function toggleSelectMode() {
    if (selectMode) {
      setSelectMode(false);
      setSelected(new Set());
    } else {
      setSelectMode(true);
    }
  }

  function toggleImageSelect(img: FlatImage) {
    const key = `${img.source}:${img.recordId}:${img.imageIndex}`;
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selected.size === pageImages.length) {
      setSelected(new Set());
    } else {
      const all = new Set(pageImages.map(img => `${img.source}:${img.recordId}:${img.imageIndex}`));
      setSelected(all);
    }
  }

  function getSelectedImages(): FlatImage[] {
    return pageImages.filter(img => selected.has(`${img.source}:${img.recordId}:${img.imageIndex}`));
  }

  async function handleBulkDelete() {
    const toDelete = getSelectedImages();
    if (toDelete.length === 0) return;
    setBulkDeleting(true);

    const results = await Promise.allSettled(
      toDelete.map(async (img) => {
        let endpoint: string;
        if (img.source === 'carousel') endpoint = `/api/carousel/${img.recordId}/delete-image`;
        else if (img.source === 'generation') endpoint = `/api/generations/${img.recordId}/delete-image`;
        else endpoint = `/api/remix/${img.recordId}/delete-image`;

        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageUrl: img.url }),
        });
        if (!res.ok) throw new Error(`Failed to delete ${img.url}`);
        return img.url;
      })
    );

    const deletedUrls = results
      .filter((r): r is PromiseFulfilledResult<string> => r.status === 'fulfilled')
      .map(r => r.value);

    setImages(prev => prev.filter(i => !deletedUrls.includes(i.url)));
    setBulkDeleting(false);
    setShowDeleteConfirm(false);
    setSelectMode(false);
    setSelected(new Set());

    const failCount = results.filter(r => r.status === 'rejected').length;
    if (failCount > 0) {
      addToast(`Deleted ${deletedUrls.length} images (${failCount} failed)`, 'error');
    } else {
      addToast(`${deletedUrls.length} image${deletedUrls.length !== 1 ? 's' : ''} deleted`, 'success');
    }
  }

  async function handleBulkStar() {
    const toStar = getSelectedImages();
    if (toStar.length === 0) return;

    // Optimistically update all to starred
    const recordIds = new Set(toStar.map(img => img.recordId));
    setImages(prev => prev.map(i =>
      recordIds.has(i.recordId) ? { ...i, starred: true } : i
    ));

    const results = await Promise.allSettled(
      // Star per unique record (starring is per-generation, not per-image)
      [...recordIds].map(async (recordId) => {
        const img = toStar.find(i => i.recordId === recordId)!;
        let endpoint: string;
        if (img.source === 'carousel') endpoint = `/api/carousel/${recordId}/star`;
        else if (img.source === 'generation') endpoint = `/api/generations/${recordId}/star`;
        else endpoint = `/api/remix/${recordId}/star`;

        const res = await fetch(endpoint, { method: 'PATCH' });
        if (!res.ok) throw new Error(`Failed to star ${recordId}`);
      })
    );

    setSelectMode(false);
    setSelected(new Set());

    const failCount = results.filter(r => r.status === 'rejected').length;
    if (failCount > 0) {
      addToast(`Starred ${recordIds.size - failCount} items (${failCount} failed)`, 'error');
    } else {
      addToast(`${toStar.length} image${toStar.length !== 1 ? 's' : ''} added to favorites`, 'success');
    }
  }

  // Escape key exits select mode
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && selectMode) {
        setSelectMode(false);
        setSelected(new Set());
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectMode]);

  // ─── Upscale handler ──────────────────────────────────

  // Drive sync
  const [syncing, setSyncing] = useState(false);
  const [syncLog, setSyncLog] = useState<string[]>([]);
  const [syncResult, setSyncResult] = useState<string | null>(null);

  async function handleDriveSync() {
    setSyncing(true);
    setSyncLog([]);
    setSyncResult(null);

    try {
      const res = await fetch('/api/gdrive-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      const reader = res.body?.getReader();
      if (!reader) throw new Error('No stream');

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop() || '';

        for (const part of parts) {
          const eventMatch = part.match(/^event: (\w+)\ndata: (.+)$/m);
          if (!eventMatch) continue;
          const [, event, rawData] = eventMatch;
          const data = JSON.parse(rawData);

          if (event === 'log') {
            setSyncLog(prev => [...prev.slice(-50), data]);
          } else if (event === 'error') {
            setSyncLog(prev => [...prev.slice(-50), data]);
          } else if (event === 'done') {
            setSyncResult(data);
          }
        }
      }
    } catch (err) {
      setSyncResult('error');
      console.error('[GalleryTab] Drive sync failed:', err);
    } finally {
      setSyncing(false);
    }
  }

  const [upscaling, setUpscaling] = useState<Set<string>>(new Set());

  async function handleUpscale(img: FlatImage) {
    if (img.upscaledUrl) return; // already upscaled
    const key = `${img.recordId}-${img.imageIndex}`;
    setUpscaling(prev => new Set(prev).add(key));
    try {
      let endpoint: string;
      if (img.source === 'carousel') {
        endpoint = `/api/carousel/${img.recordId}/upscale`;
      } else if (img.source === 'generation') {
        endpoint = `/api/generations/${img.recordId}/upscale`;
      } else {
        endpoint = `/api/remix/${img.recordId}/upscale`;
      }
      await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageIndex: img.imageIndex }),
      });
    } catch {
      setUpscaling(prev => { const s = new Set(prev); s.delete(key); return s; });
    }
  }

  // ─── Loading skeleton ─────────────────────────────────

  if (loading) {
    return (
      <div className="space-y-6 fade-in">
        <div className="flex items-center gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="skeleton rounded-lg h-8 w-28" />
          ))}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${gridColumns}, 1fr)`, gap: 8 }}>
          {Array.from({ length: 16 }).map((_, i) => (
            <div key={i} className="skeleton rounded-xl" style={{ aspectRatio: '4/5' }} />
          ))}
        </div>
      </div>
    );
  }

  // ─── Render ───────────────────────────────────────────

  return (
    <div className="space-y-6 fade-in">
      {/* ── Folders ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        {[{ id: 'all', name: 'All', count: images.length }, { id: 'none', name: 'Unfiled', count: images.length - Object.keys(folderMap).length }, ...folders].map(f => {
          const on = filterFolder === f.id;
          return (
            <span key={f.id} style={{ display: 'inline-flex', alignItems: 'center', borderRadius: 20, border: `1px solid ${on ? '#111' : 'var(--color-border)'}`, background: on ? '#111' : 'var(--color-bg-primary)', color: on ? '#fff' : 'var(--color-text-secondary)', fontSize: 12, fontWeight: 500 }}>
              <button type="button" onClick={() => { setFilterFolder(f.id); setCurrentPage(0); }} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', border: 'none', background: 'transparent', color: 'inherit', font: 'inherit', cursor: 'pointer' }}>
                {f.id !== 'all' && f.id !== 'none' && <Folder size={12} />}{f.name}<span style={{ opacity: 0.7 }}>{Math.max(0, f.count)}</span>
              </button>
              {on && f.id !== 'all' && f.id !== 'none' && (
                <button type="button" onClick={() => deleteFolder(f.id)} title="Delete this folder (images stay in the Library)" aria-label={`Delete folder ${f.name}`} style={{ padding: '6px 10px 6px 0', border: 'none', background: 'transparent', color: 'inherit', cursor: 'pointer', display: 'inline-flex' }}><X size={12} /></button>
              )}
            </span>
          );
        })}
        <button type="button" onClick={() => createFolder()} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 20, border: '1px dashed var(--color-border)', background: 'transparent', color: 'var(--color-text-secondary)', fontSize: 12, fontWeight: 500, fontFamily: 'inherit', cursor: 'pointer' }}>
          <FolderPlus size={12} /> New folder
        </button>
      </div>

      {/* ── Row 1: Filters + Slider ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {/* Persona dropdown */}
        <select
          value={filterPersona}
          onChange={(e) => changeFilter(setFilterPersona, e.target.value)}
          style={{ padding: '6px 12px', borderRadius: 20, fontSize: 12, fontWeight: 500, border: '1px solid var(--color-border)', background: 'var(--color-bg-surface)', color: 'var(--color-text-primary)', fontFamily: 'inherit', cursor: 'pointer', outline: 'none' }}
        >
          <option value="all">All Personas</option>
          {personaList.map(p => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>

        {/* Model dropdown */}
        <select
          value={filterModel}
          onChange={(e) => changeFilter(setFilterModel, e.target.value)}
          style={{ padding: '6px 12px', borderRadius: 20, fontSize: 12, fontWeight: 500, border: '1px solid var(--color-border)', background: 'var(--color-bg-surface)', color: 'var(--color-text-primary)', fontFamily: 'inherit', cursor: 'pointer', outline: 'none' }}
        >
          <option value="all">All Models</option>
          {modelList.map(m => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>

        {/* Source type dropdown */}
        <select
          value={filterSource}
          onChange={(e) => changeFilter(setFilterSource as (v: string) => void, e.target.value)}
          style={{ padding: '6px 12px', borderRadius: 20, fontSize: 12, fontWeight: 500, border: '1px solid var(--color-border)', background: 'var(--color-bg-surface)', color: 'var(--color-text-primary)', fontFamily: 'inherit', cursor: 'pointer', outline: 'none' }}
        >
          <option value="all">All Types</option>
          <option value="generation">Copy</option>
          <option value="remix">Remix</option>
          <option value="carousel">Carousel</option>
          <option value="video">Video</option>
        </select>

        <div style={{ flex: 1 }} />

        {/* Select mode toggle */}
        <button
          onClick={toggleSelectMode}
          style={{
            padding: '6px 14px',
            borderRadius: 20,
            fontSize: 12,
            fontWeight: 500,
            border: selectMode ? '1px solid #1E40AF' : '1px solid var(--color-border)',
            background: selectMode ? '#1E40AF' : 'var(--color-bg-primary)',
            color: selectMode ? 'white' : 'var(--color-text-secondary)',
            fontFamily: 'inherit',
            cursor: 'pointer',
            transition: 'all 0.15s ease',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          {selectMode ? <X size={14} /> : <CheckSquare size={14} />}
          {selectMode ? 'Done' : 'Select'}
        </button>

        {/* Grid size slider */}
        <input
          type="range"
          min={3}
          max={8}
          value={gridColumns}
          onChange={(e) => changeGridColumns(Number(e.target.value))}
          title="Thumbnail size"
          aria-label="Thumbnail size"
          className="gallery-grid-slider"
          style={{ width: 120, cursor: 'pointer' }}
        />
      </div>

      {/* ── Row 2: Count + Pagination + Page size + Sync ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: -12 }}>
        <span style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>
          {filtered.length} image{filtered.length !== 1 ? 's' : ''}
        </span>
        {selectMode && (
          <button
            onClick={toggleSelectAll}
            style={{ fontSize: 12, fontWeight: 500, color: '#1E40AF', cursor: 'pointer', border: 'none', background: 'none', fontFamily: 'inherit', padding: 0, transition: 'opacity 0.15s' }}
          >
            {selected.size === pageImages.length ? 'Deselect All' : 'Select All'}
          </button>
        )}

        <div style={{ flex: 1 }} />

        {/* Compact pagination */}
        {totalPages > 1 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <button
              onClick={() => setCurrentPage(p => Math.max(0, p - 1))}
              disabled={safePage === 0}
              style={{ width: 24, height: 24, borderRadius: '50%', border: '1px solid var(--color-border)', background: 'var(--color-bg-surface)', color: safePage === 0 ? '#ccc' : '#555', cursor: safePage === 0 ? 'default' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontFamily: 'inherit', padding: 0 }}
            >
              ‹
            </button>
            <span style={{ fontSize: 11, color: 'var(--color-text-secondary)', fontWeight: 500, minWidth: 60, textAlign: 'center' }}>
              {safePage + 1} of {totalPages}
            </span>
            <button
              onClick={() => setCurrentPage(p => Math.min(totalPages - 1, p + 1))}
              disabled={safePage >= totalPages - 1}
              style={{ width: 24, height: 24, borderRadius: '50%', border: '1px solid var(--color-border)', background: 'var(--color-bg-surface)', color: safePage >= totalPages - 1 ? '#ccc' : '#555', cursor: safePage >= totalPages - 1 ? 'default' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontFamily: 'inherit', padding: 0 }}
            >
              ›
            </button>
          </div>
        )}

        <div style={{ flex: 1 }} />

        {/* Page size dropdown */}
        <select
          value={pageSize}
          onChange={(e) => changePageSize(Number(e.target.value))}
          style={{ padding: '4px 10px', borderRadius: 20, fontSize: 11, fontWeight: 500, border: '1px solid var(--color-border)', background: 'var(--color-bg-surface)', color: 'var(--color-text-primary)', fontFamily: 'inherit', cursor: 'pointer', outline: 'none' }}
        >
          {[10, 20, 50, 100].map(n => (
            <option key={n} value={n}>{n} per page</option>
          ))}
        </select>

        {/* Drive Sync */}
        <button
          onClick={handleDriveSync}
          disabled={syncing}
          className="flex items-center gap-1.5"
          style={{
            padding: '5px 12px',
            borderRadius: 20,
            fontSize: 11,
            fontWeight: 500,
            background: syncing ? 'var(--color-bg-tertiary)' : '#FFFFFF',
            color: syncing ? 'var(--color-text-tertiary)' : 'var(--color-accent-green)',
            border: '1px solid ' + (syncing ? 'var(--color-border)' : 'var(--color-accent-green)'),
            cursor: syncing ? 'not-allowed' : 'pointer',
            opacity: syncing ? 0.7 : 1,
            fontFamily: 'inherit',
          }}
          title="Upload unsynced images to Google Drive"
        >
          {syncing ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" style={{ animation: 'spin 1s linear infinite' }}>
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2.5" strokeDasharray="31.4 31.4" strokeLinecap="round" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <path d="M12 16V4M12 4L8 8M12 4L16 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M20 16V18C20 19.1 19.1 20 18 20H6C4.9 20 4 19.1 4 18V16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          )}
          {syncing ? 'Syncing...' : 'Sync Drive'}
        </button>
      </div>

      <style>{`
        .gallery-grid-slider {
          -webkit-appearance: none;
          appearance: none;
          height: 3px;
          background: #e0e0e0;
          border-radius: 2px;
          outline: none;
        }
        .gallery-grid-slider::-webkit-slider-thumb {
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
        .gallery-grid-slider::-webkit-slider-thumb:hover {
          box-shadow: 0 1px 6px rgba(0,0,0,0.3), 0 0 0 1px rgba(0,0,0,0.1);
        }
        .gallery-grid-slider::-moz-range-thumb {
          width: 14px;
          height: 14px;
          border-radius: 50%;
          background: #fff;
          box-shadow: 0 1px 4px rgba(0,0,0,0.2), 0 0 0 1px rgba(0,0,0,0.06);
          border: none;
          cursor: pointer;
        }
      `}</style>

      {/* Sync log panel */}
      {(syncLog.length > 0 || syncResult) && (
        <div
          className="rounded-xl border overflow-hidden"
          style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg-surface)' }}
        >
          <div className="flex items-center justify-between px-4 py-2" style={{ borderBottom: '1px solid var(--color-border)' }}>
            <span className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>
              Drive Sync {syncResult === 'success' ? '— Complete' : syncResult === 'error' ? '— Failed' : syncing ? '— Running...' : ''}
            </span>
            {!syncing && (
              <button
                onClick={() => { setSyncLog([]); setSyncResult(null); }}
                className="text-xs px-2 py-0.5 rounded hover:opacity-80 transition-opacity"
                style={{ color: 'var(--color-text-tertiary)' }}
              >
                Dismiss
              </button>
            )}
          </div>
          <div
            className="px-4 py-3 overflow-y-auto font-mono text-xs leading-relaxed"
            style={{ maxHeight: '200px', color: 'var(--color-text-secondary)' }}
          >
            {syncLog.map((line, i) => (
              <div key={i} style={{ whiteSpace: 'pre-wrap' }}>{line}</div>
            ))}
          </div>
        </div>
      )}

      {/* Image grid */}
      {pageImages.length === 0 && jobs.length === 0 ? (
        <div className="rounded-xl border p-12 text-center" style={{ borderColor: 'var(--color-border)', background: '#FFFFFF' }}>
          <p className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>No images match the current filters.</p>
        </div>
      ) : (
        <div ref={gridRef} onMouseDown={onGridMouseDown} style={{ display: 'flex', flexWrap: 'wrap', gap: 8, userSelect: 'none' }}>
          {/* Prompt bar jobs: one tile per job, in the shape it will come back in */}
          {safePage === 0 && jobs.map(job => {
            const m = /^(\d+):(\d+)$/.exec(job.aspect); const jr = m ? Number(m[1]) / Number(m[2]) : 0.8;
            const bad = job.status === 'failed' || job.status === 'interrupted';
            const tileBtn: React.CSSProperties = { fontSize: 11, fontWeight: 600, padding: '5px 10px', borderRadius: 8, border: '1px solid var(--color-border)', background: 'var(--color-bg-primary)', color: 'var(--color-text-primary)', cursor: 'pointer', fontFamily: 'inherit' };
            return (
              <div key={job.id} className={`relative rounded-xl overflow-hidden ${job.status === 'running' ? 'animate-pulse' : ''}`}
                style={{ flex: `${jr} 1 ${Math.round(rowHeight * jr)}px`, aspectRatio: String(jr), maxWidth: Math.round(rowHeight * jr * 1.6), minWidth: 0, border: `1px dashed ${bad ? '#DC2626' : '#93C5FD'}`, background: bad ? 'rgba(220,38,38,0.06)' : 'rgba(59,130,246,0.08)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 10, textAlign: 'center' }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: bad ? '#991B1B' : '#1E40AF' }}>
                  {job.status === 'countdown' ? 'Starting in 3 s' : job.status === 'running' ? (job.stage || 'Working...') : job.status === 'failed' ? 'Failed' : 'Interrupted by reload'}
                </span>
                <span style={{ fontSize: 11, color: 'var(--color-text-secondary)', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{job.prompt}</span>
                <span style={{ fontSize: 10, color: 'var(--color-text-tertiary)' }}>{job.persona} · {job.n} image{job.n === 1 ? '' : 's'} · {job.aspect}</span>
                {job.status === 'failed' && job.error && <span style={{ fontSize: 10, color: '#991B1B', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }} title={job.error}>{job.error}</span>}
                {job.status === 'interrupted' && <span style={{ fontSize: 10, color: 'var(--color-text-tertiary)' }}>If it finished, the result is in the grid.</span>}
                <div style={{ display: 'flex', gap: 6 }}>
                  {job.status === 'countdown' && <button type="button" style={tileBtn} onClick={() => window.dispatchEvent(new CustomEvent('gallery-job-cancel', { detail: job.id }))}>Cancel</button>}
                  {bad && <button type="button" style={tileBtn} onClick={() => retryRef.current?.(job)}>Retry</button>}
                  {bad && <button type="button" style={tileBtn} onClick={() => setJobs(js => js.filter(j => j.id !== job.id))}>Dismiss</button>}
                </div>
                {job.status === 'countdown' && <span aria-hidden="true" style={{ position: 'absolute', left: 0, bottom: 0, height: 3, background: '#2563EB', animation: 'galleryUndo 3s linear forwards' }} />}
              </div>
            );
          })}
          {pageImages.map((img, i) => {
            const r = ratioOf(img);
            const globalIndex = safePage * pageSize + i;
            const imgKey = `${img.source}:${img.recordId}:${img.imageIndex}`;
            const isSelected = selected.has(imgKey);
            return (
              <div
                key={`${img.url}-${i}`}
                data-gkey={imgKey}
                onMouseEnter={img.mediaType === 'video' ? () => setHoverVideo(imgKey) : undefined}
                onMouseLeave={img.mediaType === 'video' ? () => setHoverVideo('') : undefined}
                className={`image-card relative rounded-xl overflow-hidden cursor-pointer group`}
                style={{ flex: `${r} 1 ${Math.round(rowHeight * r)}px`, aspectRatio: String(r), maxWidth: Math.round(rowHeight * r * 1.6), minWidth: 0 }}
                onClick={() => {
                  if (suppressClick.current) return;
                  if (selectMode) {
                    toggleImageSelect(img);
                  } else {
                    setLightbox({
                      images: filtered.map(fi => ({ url: fi.upscaledUrl || fi.url, label: fi.genName || fi.filename, type: fi.mediaType === 'video' ? 'video' as const : 'image' as const })),
                      index: globalIndex,
                    });
                  }
                }}
              >
                {img.mediaType === 'video' ? (
                  <>
                    {img.thumbnail !== img.url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={img.thumbnail}
                        alt={img.filename || `Video ${i + 1}`}
                        onLoad={(e) => { const el = e.currentTarget; if (!img.ratio && el.naturalWidth && !measured[img.thumbnail]) setMeasured(m => ({ ...m, [img.thumbnail]: el.naturalWidth / el.naturalHeight })); }}
                        className="w-full h-full object-cover"
                        draggable={false}
                        style={{ transition: 'transform 0.2s ease' }}
                        loading="lazy"
                      />
                    ) : (
                      <div className="w-full h-full" style={{ background: '#1a1a1a' }} />
                    )}
                    {/* Hover preview: the clip plays muted only while the pointer is on this tile */}
                    {hoverVideo === imgKey && !selectMode && (
                      <video src={img.url} muted loop autoPlay playsInline className="absolute inset-0 w-full h-full object-cover pointer-events-none" />
                    )}
                    {/* Play icon overlay */}
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none" style={{ opacity: hoverVideo === imgKey && !selectMode ? 0 : 1, transition: 'opacity 0.15s' }}>
                      <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(4px)' }}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="white"><path d="M8 5v14l11-7z"/></svg>
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={img.upscaledUrl || img.thumbnail}
                      alt={img.filename || `Image ${i + 1}`}
                      onLoad={(e) => { const el = e.currentTarget; if (!img.ratio && el.naturalWidth && !measured[img.thumbnail]) setMeasured(m => ({ ...m, [img.thumbnail]: el.naturalWidth / el.naturalHeight })); }}
                      className="w-full h-full object-cover"
                        draggable={false}
                      style={{ transition: 'transform 0.2s ease', transform: selectMode && isSelected ? 'scale(1)' : undefined }}
                      loading="lazy"
                    />
                  </>
                )}

                {/* Select mode: overlay + circle */}
                {selectMode && (
                  <>
                    {/* Selection tint overlay */}
                    <div
                      className="absolute inset-0 pointer-events-none"
                      style={{
                        background: isSelected ? 'rgba(30, 64, 175, 0.06)' : 'transparent',
                        boxShadow: isSelected ? 'inset 0 0 0 3px #1E40AF' : 'none',
                        borderRadius: 12,
                        transition: 'all 0.2s ease',
                        zIndex: 3,
                      }}
                    />
                    {/* Selection circle */}
                    <div
                      style={{
                        position: 'absolute',
                        bottom: 10,
                        right: 10,
                        width: 26,
                        height: 26,
                        borderRadius: '50%',
                        border: isSelected ? '2px solid #1E40AF' : '2px solid rgba(255,255,255,0.85)',
                        background: isSelected ? '#1E40AF' : 'rgba(0,0,0,0.2)',
                        backdropFilter: 'blur(4px)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        zIndex: 5,
                        transition: 'all 0.2s cubic-bezier(0.34, 1.56, 0.64, 1)',
                        boxShadow: isSelected ? '0 2px 8px rgba(30, 64, 175, 0.45), inset 0 1px 1px rgba(255,255,255,0.25)' : 'none',
                      }}
                    >
                      <Check
                        size={14}
                        color="white"
                        strokeWidth={3}
                        style={{
                          opacity: isSelected ? 1 : 0,
                          transform: isSelected ? 'scale(1)' : 'scale(0.5)',
                          transition: 'all 0.15s ease',
                        }}
                      />
                    </div>
                  </>
                )}

                {notes[imgKey] && (
                  <span className="absolute pointer-events-none" title={notes[imgKey]} style={{ bottom: 8, left: 8, width: 22, height: 22, borderRadius: 6, background: 'rgba(255,255,255,0.92)', color: '#92400E', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><StickyNote size={12} /></span>
                )}
                {isNew(img) && (
                  <span className="absolute pointer-events-none" style={{ top: 8, left: 8, fontSize: 10, fontWeight: 700, letterSpacing: 0.5, padding: '2px 7px', borderRadius: 6, background: '#16A34A', color: '#fff' }}>NEW</span>
                )}
                {/* Normal mode: hover overlay */}
                {!selectMode && (
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-all duration-200 flex items-end">
                    {/* Expand icon — top right */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setLightbox({
                          images: filtered.map(fi => ({ url: fi.upscaledUrl || fi.url, label: fi.genName || fi.filename })),
                          index: globalIndex,
                        });
                      }}
                      className="absolute top-2 right-2 w-7 h-7 rounded-lg flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                      style={{ background: 'rgba(0,0,0,0.5)' }}
                    >
                      <Maximize2 size={12} color="#fff" />
                    </button>
                    {/* Bottom action bar */}
                    <div className="w-full p-2 translate-y-full group-hover:translate-y-0 transition-transform duration-200">
                      <div className="flex gap-1.5 justify-end">
                        {img.prompt && (
                          <button
                            onClick={(e) => { e.stopPropagation(); copyPrompt(img, imgKey); }}
                            className="py-1.5 px-2 rounded-lg backdrop-blur-sm"
                            style={{ background: 'rgba(255,255,255,0.15)', color: 'white' }}
                            title={copiedKey === imgKey ? 'Copied' : 'Copy prompt'}
                            aria-label="Copy prompt"
                          >
                            {copiedKey === imgKey ? <Check size={11} /> : <Copy size={11} />}
                          </button>
                        )}
                        {img.mediaType !== 'video' && (
                          <button
                            onClick={(e) => { e.stopPropagation(); setBarReference(img.url); }}
                            className="py-1.5 px-2 rounded-lg backdrop-blur-sm"
                            style={{ background: 'rgba(255,255,255,0.15)', color: 'white' }}
                            title="Use as reference (attaches it to the prompt bar below)"
                            aria-label="Use as reference"
                          >
                            <ImagePlus size={11} />
                          </button>
                        )}
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDownload(img.upscaledUrl || img.url, downloadName(img)); }}
                          className="py-1.5 px-2 rounded-lg backdrop-blur-sm"
                          style={{ background: 'rgba(255,255,255,0.15)', color: 'white' }}
                          title="Download"
                        >
                          <Download size={11} />
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDelete(img); }}
                          className="py-1.5 px-2 rounded-lg backdrop-blur-sm"
                          style={{ background: 'rgba(220,53,69,0.4)', color: 'white' }}
                          title="Delete"
                          disabled={deleting.has(img.url)}
                        >
                          <Trash2 size={11} />
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          {/* Spacer: keeps a short last row at its natural size instead of stretching it */}
          <div aria-hidden="true" style={{ flex: '100 1 0px' }} />
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, paddingTop: 8 }}>
          <button
            onClick={() => setCurrentPage(p => Math.max(0, p - 1))}
            disabled={safePage === 0}
            style={{ width: 24, height: 24, borderRadius: '50%', border: '1px solid var(--color-border)', background: 'var(--color-bg-surface)', color: safePage === 0 ? '#ccc' : '#555', cursor: safePage === 0 ? 'default' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontFamily: 'inherit', padding: 0 }}
          >
            ‹
          </button>
          <span style={{ fontSize: 11, color: 'var(--color-text-secondary)', fontWeight: 500, minWidth: 60, textAlign: 'center' }}>
            {safePage + 1} of {totalPages}
          </span>
          <button
            onClick={() => setCurrentPage(p => Math.min(totalPages - 1, p + 1))}
            disabled={safePage >= totalPages - 1}
            style={{ width: 24, height: 24, borderRadius: '50%', border: '1px solid var(--color-border)', background: 'var(--color-bg-surface)', color: safePage >= totalPages - 1 ? '#ccc' : '#555', cursor: safePage >= totalPages - 1 ? 'default' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontFamily: 'inherit', padding: 0 }}
          >
            ›
          </button>
        </div>
      )}

      <style>{`@keyframes galleryUndo { from { width: 100%; } to { width: 0%; } }`}</style>
      <GalleryPromptBar personas={personaConfigs} jobs={jobs} setJobs={setJobs} onFinished={() => setReloadKey(k => k + 1)} retryRef={retryRef} hidden={selectMode && selected.size > 0} reference={barReference} onClearReference={() => setBarReference(null)} />
      {marquee && (
        <div aria-hidden="true" style={{ position: 'fixed', left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h, border: '1px solid #1E40AF', background: 'rgba(30,64,175,0.12)', borderRadius: 4, pointerEvents: 'none', zIndex: 90 }} />
      )}
      {/* ── Floating Action Bar (select mode) ── */}
      {selectMode && selected.size > 0 && (
        <div
          style={{
            position: 'fixed',
            bottom: 32,
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'rgba(0, 0, 0, 0.65)',
            backdropFilter: 'blur(24px) saturate(1.6)',
            WebkitBackdropFilter: 'blur(24px) saturate(1.6)',
            borderRadius: 20,
            padding: '10px 8px 10px 20px',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            boxShadow: '0 4px 20px rgba(0,0,0,0.15), 0 12px 40px rgba(0,0,0,0.12)',
            zIndex: 100,
            animation: 'fadeIn 0.3s ease-out',
          }}
        >
          <span style={{ fontSize: 13, fontWeight: 600, color: 'white', whiteSpace: 'nowrap', marginRight: 8 }}>
            {selected.size} selected
          </span>
          <div style={{ width: 1, height: 24, background: 'rgba(255,255,255,0.15)', margin: '0 4px' }} />
          <button
            onClick={handleBulkDownload}
            disabled={bulkBusy !== ''}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '8px 14px', borderRadius: 14, border: 'none', fontFamily: 'inherit',
              fontSize: 12, fontWeight: 500, cursor: bulkBusy ? 'wait' : 'pointer',
              background: 'rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.9)',
              transition: 'all 0.15s ease', whiteSpace: 'nowrap',
            }}
          >
            <Download size={14} />
            {bulkBusy === 'download' ? 'Working...' : 'Download'}
          </button>
          <button
            onClick={handleBulkAddToDataset}
            disabled={bulkBusy !== ''}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '8px 14px', borderRadius: 14, border: 'none', fontFamily: 'inherit',
              fontSize: 12, fontWeight: 500, cursor: bulkBusy ? 'wait' : 'pointer',
              background: 'rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.9)',
              transition: 'all 0.15s ease', whiteSpace: 'nowrap',
            }}
          >
            <Database size={14} />
            {bulkBusy === 'dataset' ? 'Working...' : 'Add to dataset'}
          </button>
          <select
            aria-label="Move to folder"
            value=""
            disabled={bulkBusy !== ''}
            onChange={(e) => handleBulkMove(e.target.value)}
            style={{ padding: '8px 10px', borderRadius: 14, border: 'none', fontFamily: 'inherit', fontSize: 12, fontWeight: 500, cursor: 'pointer', background: 'rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.9)' }}
          >
            <option value="" style={{ color: '#111' }}>{bulkBusy === 'move' ? 'Moving...' : 'Move to folder'}</option>
            {folders.map(f => <option key={f.id} value={f.id} style={{ color: '#111' }}>{f.name}</option>)}
            <option value="new" style={{ color: '#111' }}>+ New folder</option>
            <option value="none" style={{ color: '#111' }}>Remove from folder</option>
          </select>
          <button
            onClick={handleBulkStar}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '8px 14px', borderRadius: 14, border: 'none', fontFamily: 'inherit',
              fontSize: 12, fontWeight: 500, cursor: 'pointer',
              background: 'rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.9)',
              transition: 'all 0.15s ease', whiteSpace: 'nowrap',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(245, 158, 11, 0.25)'; e.currentTarget.style.color = '#FCD34D'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.1)'; e.currentTarget.style.color = 'rgba(255,255,255,0.9)'; }}
          >
            <Star size={14} />
            Favorite
          </button>
          <button
            onClick={() => setShowDeleteConfirm(true)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '8px 14px', borderRadius: 14, border: 'none', fontFamily: 'inherit',
              fontSize: 12, fontWeight: 500, cursor: 'pointer',
              background: 'rgba(239, 68, 68, 0.15)', color: '#FCA5A5',
              transition: 'all 0.15s ease', whiteSpace: 'nowrap',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(239, 68, 68, 0.3)'; e.currentTarget.style.color = '#FEE2E2'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(239, 68, 68, 0.15)'; e.currentTarget.style.color = '#FCA5A5'; }}
          >
            <Trash2 size={14} />
            Delete
          </button>
          <div style={{ width: 1, height: 24, background: 'rgba(255,255,255,0.15)', margin: '0 4px' }} />
          <button
            onClick={toggleSelectMode}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '8px 14px', borderRadius: 14, border: 'none', fontFamily: 'inherit',
              fontSize: 12, fontWeight: 500, cursor: 'pointer',
              background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.6)',
              transition: 'all 0.15s ease', whiteSpace: 'nowrap',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.15)'; e.currentTarget.style.color = 'rgba(255,255,255,0.9)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.08)'; e.currentTarget.style.color = 'rgba(255,255,255,0.6)'; }}
          >
            Cancel
          </button>
        </div>
      )}

      {/* ── Delete Confirmation Modal ── */}
      {showDeleteConfirm && (
        <div
          style={{
            position: 'fixed', inset: 0,
            background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(4px)',
            zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
          onClick={() => setShowDeleteConfirm(false)}
        >
          <div
            style={{
              background: 'var(--color-bg-primary)', borderRadius: 16, padding: 28,
              width: 380, boxShadow: '0 24px 80px rgba(0,0,0,0.2)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>
              Delete {selected.size} image{selected.size !== 1 ? 's' : ''}?
            </h3>
            <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', lineHeight: 1.5, marginBottom: 20 }}>
              This will permanently remove the selected images from your library. This action cannot be undone.
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setShowDeleteConfirm(false)}
                style={{
                  padding: '8px 18px', borderRadius: 10, fontSize: 13, fontWeight: 500,
                  fontFamily: 'inherit', cursor: 'pointer', transition: 'all 0.15s ease',
                  border: '1px solid var(--color-border)', background: 'var(--color-bg-surface)',
                  color: 'var(--color-text-secondary)',
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleBulkDelete}
                disabled={bulkDeleting}
                style={{
                  padding: '8px 18px', borderRadius: 10, fontSize: 13, fontWeight: 500,
                  fontFamily: 'inherit', cursor: bulkDeleting ? 'not-allowed' : 'pointer',
                  transition: 'all 0.15s ease',
                  border: '1px solid #EF4444', background: bulkDeleting ? '#FCA5A5' : '#EF4444',
                  color: 'white', opacity: bulkDeleting ? 0.7 : 1,
                }}
              >
                {bulkDeleting ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Lightbox */}
      {lightbox && (() => {
        const safeIndex = Math.min(lightbox.index, filtered.length - 1);
        const currentImg = filtered[safeIndex];
        if (!currentImg) return null;
        // One info panel entry per image. A single entry for the opened image made every image you arrowed to
        // show the first image's model, name and date.
        const metas: GenerationMeta[] = filtered.map(fi => ({
          personaName: fi.persona,
          personaAvatar: personaConfigs.find(p => p.name === fi.persona)?.faceRefs?.[0],
          genName: fi.genName,
          feature: fi.source === 'video' ? 'Video' as const : fi.source === 'carousel' ? 'Image Carousel' as const : fi.source === 'remix' ? 'Image Remix' as const : 'Image Copy' as const,
          model: fi.model,
          createdAt: fi.createdAt,
          prompt: fi.prompt,
        }));
        return (
          <ImageLightbox
            images={lightbox.images}
            initialIndex={lightbox.index}
            onClose={() => setLightbox(null)}
            generationMetas={metas}
            generationMeta={metas[safeIndex]}
            imageMeta={filtered.map(fi => ({
              starred: fi.starred,
              upscaled: !!fi.upscaledUrl,
              note: notes[`${fi.source}:${fi.recordId}:${fi.imageIndex}`],
            }))}
            actions={{
              onNote: (i, text) => { const img = filtered[i]; if (img) saveNote(img, text); },
              onStar: (i) => {
                const img = filtered[i];
                if (img) handleToggleStar(img);
              },
              onUpscale: (i) => {
                const img = filtered[i];
                if (img) handleUpscale(img);
              },
              onRemix: onRemixImage ? (i) => {
                const img = filtered[i];
                if (img) onRemixImage(img.url);
              } : undefined,
              onCarouselImage: onSendToCarousel ? (i) => {
                const img = filtered[i];
                if (img) onSendToCarousel(img.url);
              } : undefined,
              onDownload: (i) => {
                const img = filtered[i];
                if (img) handleDownload(img.upscaledUrl || img.url, downloadName(img));
              },
              onDelete: (i) => {
                const img = filtered[i];
                if (img) {
                  handleDelete(img);
                  setLightbox(null);
                }
              },
            }}
          />
        );
      })()}
    </div>
  );
}
