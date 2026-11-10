import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

// ─── Constants ──────────────────────────────────────────
const VALID_CATEGORIES = [
  'Dashboard',
  'Pipeline',
  'X Reposter',
  'Twitter',
  'Video',
  'Content',
  'Infrastructure',
];

const VALID_PRIORITIES = ['High', 'Medium', 'Low'];

const STATUS_ORDER: Record<string, number> = {
  'In Progress': 0,
  'Open': 1,
  'Done': 2,
};

const PRIORITY_ORDER: Record<string, number> = {
  'High': 0,
  'Medium': 1,
  'Low': 2,
};

// ─── Interfaces ─────────────────────────────────────────
interface DevTicketRow {
  id: string;
  title: string;
  description: string | null;
  category: string;
  priority: string;
  status: string;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

// ─── GET /api/dev-tickets ───────────────────────────────
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const category = searchParams.get('category');

    let query = supabase
      .from('dev_tickets')
      .select('*');

    if (status) {
      query = query.eq('status', status);
    }
    if (category) {
      query = query.eq('category', category);
    }

    const { data: rows, error } = await query;

    if (error) {
      console.error('[dev-tickets] Supabase error:', error);
      return NextResponse.json(
        { error: 'Failed to fetch dev tickets' },
        { status: 500 }
      );
    }

    // Sort client-side: In Progress → Open → Done, then High → Medium → Low, then newest first
    const tickets = (rows as DevTicketRow[]).sort((a, b) => {
      const statusDiff = (STATUS_ORDER[a.status] ?? 99) - (STATUS_ORDER[b.status] ?? 99);
      if (statusDiff !== 0) return statusDiff;

      const priorityDiff = (PRIORITY_ORDER[a.priority] ?? 99) - (PRIORITY_ORDER[b.priority] ?? 99);
      if (priorityDiff !== 0) return priorityDiff;

      // Newest first within same status+priority
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });

    return NextResponse.json({ tickets });
  } catch (error) {
    console.error('[dev-tickets] GET Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch dev tickets' },
      { status: 500 }
    );
  }
}

// ─── POST /api/dev-tickets ──────────────────────────────
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { title, description, category, priority } = body;

    // Validate title
    if (!title || typeof title !== 'string' || title.trim().length === 0) {
      return NextResponse.json(
        { error: 'title is required and must be a non-empty string' },
        { status: 400 }
      );
    }

    // Validate category
    if (!category || !VALID_CATEGORIES.includes(category)) {
      return NextResponse.json(
        { error: `category must be one of: ${VALID_CATEGORIES.join(', ')}` },
        { status: 400 }
      );
    }

    // Validate priority (optional, defaults to Medium)
    const resolvedPriority = priority || 'Medium';
    if (!VALID_PRIORITIES.includes(resolvedPriority)) {
      return NextResponse.json(
        { error: `priority must be one of: ${VALID_PRIORITIES.join(', ')}` },
        { status: 400 }
      );
    }

    const insertFields: Record<string, unknown> = {
      title: title.trim(),
      category,
      priority: resolvedPriority,
      status: 'Open',
    };

    if (description !== undefined && description !== null) {
      insertFields.description = description;
    }

    const { data: ticket, error } = await supabase
      .from('dev_tickets')
      .insert(insertFields)
      .select()
      .single();

    if (error || !ticket) {
      console.error('[dev-tickets] Insert error:', error);
      return NextResponse.json(
        { error: 'Failed to create dev ticket' },
        { status: 500 }
      );
    }

    return NextResponse.json({ ticket }, { status: 201 });
  } catch (error) {
    console.error('[dev-tickets] POST Error:', error);
    return NextResponse.json(
      { error: 'Failed to create dev ticket' },
      { status: 500 }
    );
  }
}
