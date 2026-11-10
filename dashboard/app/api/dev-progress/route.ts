import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

// ─── Types ──────────────────────────────────────────────────────

type Category = 'feature' | 'fix' | 'backlog';

interface ProgressItem {
  name: string;
  description: string;
  category: Category;
}

interface Session {
  number: number;
  title: string;
  items: ProgressItem[];
}

interface DayGroup {
  date: string;
  sessions: Session[];
}

interface ProgressStats {
  totalSessions: number;
  totalFeatures: number;
  totalFixes: number;
  totalBacklog: number;
  activeDays: number;
}

// ─── Auto-classification ────────────────────────────────────────

function classifyItem(name: string, description: string): Category {
  const text = `${name} ${description}`.toLowerCase();

  // Backlog checks first (more specific)
  if (
    text.includes('pending:') ||
    text.includes('pending —') ||
    text.includes('placeholder') ||
    text.includes('not started') ||
    text.includes('next up:') ||
    text.includes('action item') ||
    text.includes('still needs:') ||
    text.includes('not built yet')
  ) {
    return 'backlog';
  }

  // Fix checks — word-boundary regex to avoid false positives
  if (
    /\bfix(ed|es|ing)?\b/.test(text) ||
    /\bbug\b/.test(text) ||
    /\bhotfix\b/.test(text) ||
    /\bpatch(ed)?\b/.test(text) ||
    /\bregression\b/.test(text) ||
    /\brevert(ed)?\b/.test(text) ||
    /\bhydration error\b/.test(text)
  ) {
    return 'fix';
  }

  return 'feature';
}

// ─── Parser ─────────────────────────────────────────────────────

function parseProgressMd(content: string): { days: DayGroup[]; stats: ProgressStats } {
  const lines = content.split('\n');
  const days: DayGroup[] = [];
  let currentDay: DayGroup | null = null;
  let currentSession: Session | null = null;

  for (const line of lines) {
    // Date header: ## YYYY-MM-DD
    const dateMatch = line.match(/^## (\d{4}-\d{2}-\d{2})/);
    if (dateMatch) {
      currentDay = { date: dateMatch[1], sessions: [] };
      days.push(currentDay);
      currentSession = null;
      continue;
    }

    // Session header: ### Session N
    const sessionMatch = line.match(/^### Session (\d+)/);
    if (sessionMatch && currentDay) {
      currentSession = { number: parseInt(sessionMatch[1], 10), title: '', items: [] };
      currentDay.sessions.push(currentSession);
      continue;
    }

    // Section title: **Bold Title** (standalone line, not a list item)
    if (line.match(/^\*\*[^*]+\*\*\s*$/) && currentSession && !line.startsWith('-')) {
      const titleText = line.replace(/\*\*/g, '').trim();
      if (!currentSession.title) {
        currentSession.title = titleText;
      }
      continue;
    }

    // Item: - **Name** — Description  (supports em-dash, en-dash, and hyphen separators)
    const itemMatch = line.match(/^- \*\*([^*]+)\*\*\s*[—–-]\s*(.*)/);
    if (itemMatch && currentSession) {
      const name = itemMatch[1].trim();
      const description = itemMatch[2].trim();
      currentSession.items.push({
        name,
        description,
        category: classifyItem(name, description),
      });
      continue;
    }

    // Blockquote items (backlog/reminder notes): > ⚠️ ...
    const blockquoteMatch = line.match(/^>\s*[⚠️]*\s*(.*)/);
    if (blockquoteMatch && currentSession && blockquoteMatch[1].trim().length > 10) {
      const text = blockquoteMatch[1].trim();
      currentSession.items.push({
        name: text.length > 80 ? text.substring(0, 77) + '...' : text,
        description: text,
        category: 'backlog',
      });
      continue;
    }
  }

  // Compute stats
  let totalSessions = 0;
  let totalFeatures = 0;
  let totalFixes = 0;
  let totalBacklog = 0;

  for (const day of days) {
    for (const session of day.sessions) {
      totalSessions++;
      for (const item of session.items) {
        if (item.category === 'feature') totalFeatures++;
        else if (item.category === 'fix') totalFixes++;
        else totalBacklog++;
      }
    }
  }

  return {
    days,
    stats: {
      totalSessions,
      totalFeatures,
      totalFixes,
      totalBacklog,
      activeDays: days.length,
    },
  };
}

// ─── GET ────────────────────────────────────────────────────────

export async function GET() {
  try {
    // Try project root (one level up from dashboard/)
    const progressPath = path.resolve(process.cwd(), 'PROGRESS.md');
    const fallbackPath = path.resolve(process.cwd(), '..', 'PROGRESS.md');

    let content: string;
    if (fs.existsSync(progressPath)) {
      content = fs.readFileSync(progressPath, 'utf-8');
    } else if (fs.existsSync(fallbackPath)) {
      content = fs.readFileSync(fallbackPath, 'utf-8');
    } else {
      return NextResponse.json({ error: 'PROGRESS.md not found' }, { status: 404 });
    }

    const result = parseProgressMd(content);

    return NextResponse.json(result);
  } catch (err) {
    console.error('[dev-progress] Error:', err);
    return NextResponse.json({ error: 'Failed to parse progress' }, { status: 500 });
  }
}
