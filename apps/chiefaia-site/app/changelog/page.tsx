/**
 * /changelog — auto-generated from `git log origin/develop`. Last 30 PRs.
 *
 * Generated at build time via `scripts/generate-changelog.mjs`. The script
 * runs in `prebuild` + `predev`, so the data file is always fresh for the
 * deployed bundle.
 */

import type { Metadata } from 'next';
import { Badge, Card, CardDescription, CardHeader, CardTitle } from '@caia/ui';
import { loadChangelog } from '../../lib/changelog';

export const metadata: Metadata = {
  title: 'Changelog',
  description:
    'The last 30 merged PRs from develop. Auto-generated at build time from git log.',
  alternates: { canonical: '/changelog' },
};

export const dynamic = 'force-static';

export default function ChangelogPage() {
  const { entries, generatedAt, count } = loadChangelog();

  return (
    <div className="space-y-10">
      <header className="space-y-3">
        <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
          Changelog
        </p>
        <h1 className="text-4xl font-semibold tracking-tight text-foreground">
          What we shipped
        </h1>
        <p className="max-w-3xl text-muted-foreground">
          The last {count > 0 ? count : 30} merged PRs on develop. Auto-generated from{' '}
          <code className="rounded bg-muted px-1 py-0.5 text-xs">git log</code> at build
          time. Last refreshed{' '}
          <time dateTime={generatedAt}>{generatedAt.split('T')[0]}</time>.
        </p>
      </header>

      {entries.length === 0 ? (
        <Card data-testid="changelog-empty">
          <CardHeader>
            <CardTitle>No entries yet</CardTitle>
            <CardDescription>
              Build the site against a checkout with full git history to populate
              this list.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <ul className="space-y-4">
          {entries.map((entry) => (
            <li key={entry.sha} data-testid={`changelog-${entry.sha}`}>
              <Card>
                <CardHeader>
                  <div className="flex flex-wrap items-center gap-3">
                    <Badge variant="secondary">
                      <time dateTime={entry.date}>{entry.date}</time>
                    </Badge>
                    <Badge variant="outline">#{entry.pr}</Badge>
                    <code className="text-xs text-muted-foreground">{entry.sha}</code>
                  </div>
                  <CardTitle className="text-base font-medium">
                    {entry.subject}
                  </CardTitle>
                </CardHeader>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
