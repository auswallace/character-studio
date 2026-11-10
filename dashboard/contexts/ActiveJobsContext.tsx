'use client';

import { createContext, useContext, useState, useCallback, useEffect, useRef, type ReactNode } from 'react';

// ─── Types ───────────────────────────────────────────────

export interface ActiveJob {
  id: string;
  type: 'generate' | 'remix' | 'carousel' | 'video';
  status: 'running' | 'done' | 'error';
  persona: string;
  model: string;
  numImages: number;
  notes: string;
  progress: number;
  stage: string;
  streamedImages: string[];
  streamedVideos?: string[];
  resultName?: string;
  resultRecordId?: string;
  imageCount?: number;
  failedCount?: number;
  elapsed?: string;
  errorMessage?: string;
  startedAt: number;
}

interface ActiveJobsContextValue {
  activeJobs: ActiveJob[];
  addJob: (job: ActiveJob) => void;
  updateJob: (jobId: string, updates: Partial<ActiveJob>) => void;
  appendImage: (jobId: string, url: string, progress: number, stage: string) => void;
  appendVideo: (jobId: string, url: string, progress: number, stage: string) => void;
  removeJob: (jobId: string) => void;
}

// ─── Context ─────────────────────────────────────────────

const ActiveJobsContext = createContext<ActiveJobsContextValue | null>(null);

// ─── localStorage helpers ────────────────────────────────

const STORAGE_KEY = 'pipeline:activeJobs';
const MAX_AGE_MS = 10 * 60 * 1000; // 10 minutes — ignore older jobs

function saveToStorage(jobs: ActiveJob[]) {
  try {
    // Only persist running jobs (done/error are transient UI state)
    const running = jobs.filter(j => j.status === 'running');
    if (running.length > 0) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(running));
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch { /* localStorage not available */ }
}

function loadFromStorage(): ActiveJob[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const jobs: ActiveJob[] = JSON.parse(raw);
    const now = Date.now();
    // Only recover jobs less than MAX_AGE_MS old
    return jobs.filter(j => now - j.startedAt < MAX_AGE_MS);
  } catch {
    return [];
  }
}

// ─── Recovery: check Supabase for completed jobs ─────────

async function recoverJobStatuses(jobs: ActiveJob[]): Promise<ActiveJob[]> {
  if (jobs.length === 0) return jobs;

  // Only recover jobs that have a Supabase record ID
  const jobsWithRecords = jobs.filter(j => j.resultRecordId);
  const jobsWithoutRecords = jobs.filter(j => !j.resultRecordId);

  if (jobsWithRecords.length === 0) {
    // No record IDs — mark all as stale "processing" with a helpful message
    return jobs.map(j => ({
      ...j,
      stage: 'Processing — check back shortly...',
      progress: Math.max(j.progress, 50),
    }));
  }

  try {
    // Batch check: query generations and remixes for image counts
    const generateJobs = jobsWithRecords.filter(j => j.type === 'generate');
    const remixJobs = jobsWithRecords.filter(j => j.type === 'remix');

    const results = new Map<string, { imageCount: number; name?: string }>();

    if (generateJobs.length > 0) {
      const ids = generateJobs.map(j => j.resultRecordId!);
      const res = await fetch(`/api/generations?ids=${ids.join(',')}&recovery=true`);
      if (res.ok) {
        const data = await res.json();
        for (const gen of (data.generations || [])) {
          results.set(gen.id, {
            imageCount: gen.images?.length || 0,
            name: gen.name,
          });
        }
      }
    }

    if (remixJobs.length > 0) {
      const ids = remixJobs.map(j => j.resultRecordId!);
      const res = await fetch(`/api/remix?ids=${ids.join(',')}&recovery=true`);
      if (res.ok) {
        const data = await res.json();
        for (const rmx of (data.remixes || [])) {
          results.set(rmx.id, {
            imageCount: rmx.images?.length || 0,
            name: rmx.name,
          });
        }
      }
    }

    const carouselJobs = jobsWithRecords.filter(j => j.type === 'carousel');

    if (carouselJobs.length > 0) {
      const ids = carouselJobs.map(j => j.resultRecordId!);
      const res = await fetch(`/api/carousel?ids=${ids.join(',')}&recovery=true`);
      if (res.ok) {
        const data = await res.json();
        for (const c of (data.carousels || [])) {
          results.set(c.id, {
            imageCount: c.variants?.length || 0,
            name: c.name,
          });
        }
      }
    }

    const videoJobs = jobsWithRecords.filter(j => j.type === 'video');

    if (videoJobs.length > 0) {
      const ids = videoJobs.map(j => j.resultRecordId!);
      const res = await fetch(`/api/video?ids=${ids.join(',')}&recovery=true`);
      if (res.ok) {
        const data = await res.json();
        for (const v of (data.videos || [])) {
          results.set(v.id, {
            imageCount: v.outputs?.length || 0,
            name: v.name,
          });
        }
      }
    }

    // Update jobs based on Supabase results
    const updated = jobsWithRecords.map(job => {
      const result = results.get(job.resultRecordId!);
      if (result && result.imageCount > 0) {
        // Job completed — images exist in Supabase
        return {
          ...job,
          status: 'done' as const,
          progress: 100,
          stage: 'Complete',
          imageCount: result.imageCount,
          resultName: result.name || job.resultName,
        };
      }
      // No images yet — still processing or failed
      const age = Date.now() - job.startedAt;
      if (age > MAX_AGE_MS) {
        // Too old — likely failed silently
        return {
          ...job,
          status: 'error' as const,
          stage: 'Timed out — generation may have failed',
          errorMessage: 'Job exceeded maximum age. Check Library for results.',
        };
      }
      return {
        ...job,
        stage: 'Processing — images generating...',
        progress: Math.max(job.progress, 50),
      };
    });

    // Jobs without record IDs — still early stage, show processing
    const earlyJobs = jobsWithoutRecords.map(j => ({
      ...j,
      stage: 'Processing — waiting for server...',
      progress: Math.max(j.progress, 25),
    }));

    return [...updated, ...earlyJobs];
  } catch (err) {
    console.warn('[ActiveJobsContext] Recovery check failed:', err);
    // On error, just show processing state
    return jobs.map(j => ({
      ...j,
      stage: 'Processing — check back shortly...',
      progress: Math.max(j.progress, 50),
    }));
  }
}

// ─── Provider ────────────────────────────────────────────

export function ActiveJobsProvider({ children }: { children: ReactNode }) {
  const [activeJobs, setActiveJobs] = useState<ActiveJob[]>([]);
  const hydrated = useRef(false);

  // Hydrate from localStorage on mount (single instance — no race condition)
  useEffect(() => {
    if (hydrated.current) return;
    hydrated.current = true;

    const stored = loadFromStorage();
    if (stored.length > 0) {
      // Immediately show recovered jobs with "Recovering" state
      const recovering = stored.map(j => ({
        ...j,
        stage: 'Recovering — checking status...',
        progress: j.progress || 50,
      }));
      setActiveJobs(recovering);

      // Then check Supabase for actual completion status
      recoverJobStatuses(stored).then(updated => {
        setActiveJobs(prev => {
          // Merge recovered status with any new jobs that were added during recovery
          const recoveredIds = new Set(updated.map(j => j.id));
          const newJobs = prev.filter(j => !recoveredIds.has(j.id));
          return [...updated, ...newJobs];
        });
      });
    }
  }, []);

  // Persist to localStorage whenever jobs change (only after hydration)
  useEffect(() => {
    if (hydrated.current) {
      saveToStorage(activeJobs);
    }
  }, [activeJobs]);

  const addJob = useCallback((job: ActiveJob) => {
    setActiveJobs(prev => [job, ...prev]);
  }, []);

  const updateJob = useCallback((jobId: string, updates: Partial<ActiveJob>) => {
    setActiveJobs(prev => prev.map(j => j.id === jobId ? { ...j, ...updates } : j));
  }, []);

  const appendImage = useCallback((jobId: string, url: string, progress: number, stage: string) => {
    setActiveJobs(prev => prev.map(j =>
      j.id === jobId
        ? { ...j, streamedImages: [...j.streamedImages, url], progress, stage }
        : j
    ));
  }, []);

  const appendVideo = useCallback((jobId: string, url: string, progress: number, stage: string) => {
    setActiveJobs(prev => prev.map(j =>
      j.id === jobId
        ? { ...j, streamedVideos: [...(j.streamedVideos || []), url], progress, stage }
        : j
    ));
  }, []);

  const removeJob = useCallback((jobId: string) => {
    setActiveJobs(prev => prev.filter(j => j.id !== jobId));
  }, []);

  return (
    <ActiveJobsContext.Provider value={{ activeJobs, addJob, updateJob, appendImage, appendVideo, removeJob }}>
      {children}
    </ActiveJobsContext.Provider>
  );
}

// ─── Consumer hook ───────────────────────────────────────

export function useActiveJobsContext() {
  const ctx = useContext(ActiveJobsContext);
  if (!ctx) {
    throw new Error('useActiveJobsContext must be used within <ActiveJobsProvider>');
  }
  return ctx;
}
