import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

// ─── PATCH /api/dev-tickets/[id] ────────────────────────
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { title, description, category, priority, status } = body;

    const fields: Record<string, unknown> = {};

    if (title !== undefined) fields.title = title;
    if (description !== undefined) fields.description = description;
    if (category !== undefined) fields.category = category;
    if (priority !== undefined) fields.priority = priority;
    if (status !== undefined) fields.status = status;

    if (Object.keys(fields).length === 0) {
      return NextResponse.json(
        { error: 'No fields to update' },
        { status: 400 }
      );
    }

    // Always set updated_at
    fields.updated_at = new Date().toISOString();

    // Handle completed_at based on status transitions
    if (status === 'Done') {
      fields.completed_at = new Date().toISOString();
    } else if (status !== undefined) {
      // Status changed to something other than Done — clear completed_at
      fields.completed_at = null;
    }

    const { data: ticket, error } = await supabase
      .from('dev_tickets')
      .update(fields)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('[dev-tickets] Update error:', error);
      return NextResponse.json(
        { error: 'Failed to update dev ticket' },
        { status: 500 }
      );
    }

    return NextResponse.json({ ticket });
  } catch (error) {
    console.error('[dev-tickets] PATCH Error:', error);
    return NextResponse.json(
      { error: 'Failed to update dev ticket' },
      { status: 500 }
    );
  }
}

// ─── DELETE /api/dev-tickets/[id] ───────────────────────
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const { error } = await supabase
      .from('dev_tickets')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('[dev-tickets] Delete error:', error);
      return NextResponse.json(
        { error: 'Failed to delete dev ticket' },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[dev-tickets] DELETE Error:', error);
    return NextResponse.json(
      { error: 'Failed to delete dev ticket' },
      { status: 500 }
    );
  }
}
