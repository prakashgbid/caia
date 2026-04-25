import type { NextRequest } from 'next/server';

const CONDUCTOR_URL = process.env['CONDUCTOR_URL'] ?? 'http://localhost:7776';

export async function GET(req: NextRequest) {
  const params = new URLSearchParams(req.nextUrl.searchParams);
  params.set('export', 'csv');

  try {
    const res = await fetch(`${CONDUCTOR_URL}/timeline?${params.toString()}`, {
      next: { revalidate: 0 },
    });
    if (!res.ok) {
      return new Response('id,kind,actor,summary,subjectKind,subjectId,projectId,createdAt\n', {
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': 'attachment; filename="timeline.csv"',
        },
      });
    }
    const text = await res.text();
    return new Response(text, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': 'attachment; filename="conductor-timeline.csv"',
      },
    });
  } catch {
    return new Response('id,kind,actor,summary,subjectKind,subjectId,projectId,createdAt\n', {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': 'attachment; filename="timeline.csv"',
      },
    });
  }
}
