// dashboard/lib/http.ts
//
// Small request helpers for API routes.

import { NextRequest, NextResponse } from 'next/server';

export class BodyTooLargeError extends Error {
  constructor(public limitKb: number) { super(`Request body over ${limitKb} KB`); this.name = 'BodyTooLargeError'; }
}

/**
 * Parse a JSON body with a size ceiling. Next does not cap route-handler bodies,
 * so a hostile or buggy client could post hundreds of MB into request.json().
 */
export async function readJson<T = Record<string, unknown>>(request: NextRequest, maxKb = 256): Promise<T> {
  const declared = Number(request.headers.get('content-length') || 0);
  if (declared > maxKb * 1024) throw new BodyTooLargeError(maxKb);
  const text = await request.text();
  if (text.length > maxKb * 1024) throw new BodyTooLargeError(maxKb);
  return JSON.parse(text) as T;
}

/** Map our known error classes to the right HTTP status; everything else is 500. */
export function errorResponse(error: unknown, tag: string): NextResponse {
  const msg = error instanceof Error ? error.message : String(error);
  const name = error instanceof Error ? error.name : '';
  const status =
    name === 'SpendCapError' ? 429 :
    name === 'BodyTooLargeError' ? 413 :
    name === 'UnsafeUrlError' ? 403 :
    500;
  if (status === 500) console.error(`[${tag}] Error:`, msg);
  else console.warn(`[${tag}] ${name}: ${msg}`);
  return NextResponse.json({ error: msg }, { status });
}
