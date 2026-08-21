/**
 * ProjectCard — visual placeholder card for an existing mock project.
 *
 * Per STOL-5003 these cards are display-only: clicking does nothing yet
 * (continue-project is future scope), so the action is a disabled button
 * rather than a dead link.
 */

import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@caia/ui';
import { formatProjectDate, type MockProject } from '../lib/mock-data';

const statusVariant: Record<
  MockProject['status'],
  'default' | 'secondary' | 'outline'
> = {
  Live: 'default',
  'In pipeline': 'secondary',
  'Awaiting ratification': 'secondary',
  Draft: 'outline',
};

export function ProjectCard({ project }: { project: MockProject }) {
  return (
    <Card data-testid="project-card" className="flex h-full flex-col">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <CardTitle className="text-base">{project.name}</CardTitle>
          <Badge variant={statusVariant[project.status]}>{project.status}</Badge>
        </div>
        <CardDescription>{project.stageLabel}</CardDescription>
      </CardHeader>
      <CardContent className="mt-auto flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          Updated {formatProjectDate(project.lastUpdated)}
        </p>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled
          title="Continuing a project is coming soon"
        >
          Continue
        </Button>
      </CardContent>
    </Card>
  );
}
