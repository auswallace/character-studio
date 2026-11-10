// dashboard/lib/spend-guard.ts
//
// Daily spend cap. Every generation route calls assertSpendAllowed() before it
// touches a paid provider. Sums today's cost_usd across all generation tables
// (populated by lib/pricing.ts) and refuses when over MAX_DAILY_SPEND_USD.
//
// Default cap $25/day. Set MAX_DAILY_SPEND_USD in .env.local to change it, or 0 to disable.
// Cached for 30s so the check does not add a query to every single request.

import { supabase } from '@/lib/supabase';
import { isSimulating } from '@/lib/simulate';

const TABLES = ['video_generations', 'generations', 'remixes', 'carousels'] as const;
const CACHE_MS = 30_000;

let cache: { at: number; spent: number } | null = null;

export class SpendCapError extends Error {
  constructor(public spent: number, public cap: number) {
    super(`Daily spend cap reached: $${spent.toFixed(2)} of $${cap.toFixed(2)}. Raise MAX_DAILY_SPEND_USD or wait until tomorrow.`);
    this.name = 'SpendCapError';
  }
}

export function dailyCap(): number {
  const raw = process.env.MAX_DAILY_SPEND_USD;
  if (raw === undefined || raw === '') return 25;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 25;
}

export async function spentToday(): Promise<number> {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_MS) return cache.spent;

  const since = new Date(); since.setUTCHours(0, 0, 0, 0);
  let total = 0;
  for (const t of TABLES) {
    try {
      const { data, error } = await supabase.from(t).select('cost_usd').gte('created_at', since.toISOString()).not('cost_usd', 'is', null);
      if (error) continue; // column may not exist yet; fail open on read errors
      for (const row of data || []) total += Number((row as { cost_usd: number | null }).cost_usd) || 0;
    } catch { /* fail open */ }
  }
  cache = { at: now, spent: total };
  return total;
}

export class SimulateModeError extends Error {
  constructor() { super('Simulate mode is on (Settings > Providers) and this action has no simulator, so it was stopped before any paid call. Turn Simulate mode off to run it.'); this.name = 'SimulateModeError'; }
}

/**
 * Throws SpendCapError when today's tracked spend is at or over the cap.
 * Routes that can run simulated (image generation through the router or the trained character) pass
 * { simulable: true }. Every other paid route throws SimulateModeError while Simulate mode is on,
 * so "simulate" can never spend money by accident.
 */
export async function assertSpendAllowed(opts?: { simulable?: boolean }): Promise<void> {
  if (!opts?.simulable && await isSimulating()) throw new SimulateModeError();
  const cap = dailyCap();
  if (cap === 0) return;
  const spent = await spentToday();
  if (spent >= cap) throw new SpendCapError(spent, cap);
}

/** Forget the cached total (call after writing a new cost row). */
export function invalidateSpendCache(): void { cache = null; }
